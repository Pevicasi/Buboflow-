import type { Coupon, Marketplace } from '../types';

export const DEFAULT_ML_COUPON_MAX_AGE_HOURS = 4;

export interface MlCouponResolutionResult {
  couponCode?: string;
  originalCouponCode?: string;
  status:
    | 'not_ml'
    | 'confirmed_sitewide'
    | 'fresh_captured'
    | 'applied_sitewide'
    | 'removed_invalid'
    | 'none';
  reason?: string;
  changed: boolean;
}

const FALSE_POSITIVE_COUPON_WORDS = new Set([
  'ATIVE',
  'ATIVAR',
  'ATIVADO',
  'FICOU',
  'AQUI',
  'GRATIS',
  'GRATUITO',
  'LINK',
  'SITE',
  'APP',
  'OFF',
  'HOJE',
  'PROMO',
  'PROMOCAO',
  'DESCONTO',
  'CLIQUE',
  'CLICK',
  'RESGATE',
  'RESGATAR',
  'PEGUE',
  'PEGAR',
  'CORRE',
  'CORRA',
  'APROVEITE',
  'VERIFIQUE',
  'DISPONIVEL',
  'FRETE',
  'LOJA',
  'LOJAS',
  'MERCADO',
  'LIVRE',
  'SHOPEE',
  'AMAZON',
  'MAGALU',
  'CUPOM',
  'CUPONS',
  'CODIGO',
  'OFERTA',
  'OFERTAS',
  'NOVO',
  'NOVA',
  'PARA',
  'COMPRE',
  'COMPRAR',
  'ACESSE',
  'CONFIRA',
  'VALIDO',
  'EXCLUSIVO',
  'LIMITADO',
  'PRODUTO',
  'PRODUTOS',
  'ANUNCIO',
  'CARRINHO',
  'CHECKOUT',
  'TESTE',
  'SELECAO',
  'PAGINA',
  'ABAIXO',
  'ACIMA',
  'DIRETO',
  'APLICAR',
  'APLIQUE',
  'APLICADO',
  'USAR',
  'UTILIZE',
]);

const PARTNER_SITE_BRAND_TOKENS = [
  'PROMOBIT',
  'PELANDO',
  'MELIUZ',
  'CUPONOMIA',
  'PICODI',
  'GATRY',
  'HARDMOB',
  'BUSCAPE',
  'BENCHPROMOS',
  'CUPOMVALIDO',
  'TECHTUDO',
  'OLHARDIGITAL',
  'CANALTECH',
  'THIAGORODRIGO',
  'DESCONTOPP',
];

export function getBrazilDateParts(now: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  isoDate: string;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const isoDate = formatter.format(now); // YYYY-MM-DD
  const [y, m, d] = isoDate.split('-').map((n) => Number(n));
  return { year: y, month: m, day: d, isoDate };
}

export function isFalsePositiveCouponCode(raw?: string): boolean {
  if (!raw || typeof raw !== 'string') return true;
  const code = raw.trim().toUpperCase();
  if (code.length < 4 || code.length > 24) return true;
  if (!/^[A-Z0-9_-]+$/.test(code)) return true;
  if (FALSE_POSITIVE_COUPON_WORDS.has(code)) return true;
  // Purely a calendar year like 2025 or 2026
  if (/^20[2-3]\d$/.test(code)) return true;
  return false;
}

/**
 * Rejects partner/competitor-branded exclusive coupons (e.g. MELIPROMOBIT, OBRAPROMOBIT,
 * PELANDO10) that belong to third-party deal sites and should never be sent or suggested.
 */
export function isPartnerExclusiveCouponCode(rawCode?: string, contextText?: string): boolean {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return false;
  if (PARTNER_SITE_BRAND_TOKENS.some((brand) => code.includes(brand))) {
    return true;
  }
  if (contextText) {
    const normalizedCtx = contextText.toUpperCase();
    if (
      /EXCLUSIV[OA]\s+(DO\s+|NO\s+)?(PROMOBIT|PELANDO|MELIUZ|CUPONOMIA|PICODI)/i.test(
        normalizedCtx
      )
    ) {
      return true;
    }
  }
  return false;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Extracts an embedded DDMM date from promotional coupon codes such as:
 * MODA1911, LOJASOFICIAIS1911, TECH1811, OFF1911, CUPOM2011.
 * Avoids false matches on years (2025/2026) or round numeric values (1000, 2000).
 */
export function extractEmbeddedCouponDate(
  rawCode: string,
  now: Date = new Date()
): { day: number; month: number; year: number; isoDate: string; label: string } | null {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;

  let dd = 0;
  let mm = 0;

  const slashMatch = code.match(/(?:^|[^0-9])(\d{2})[/-](\d{2})(?:[^0-9]|$)/);
  if (slashMatch) {
    dd = Number(slashMatch[1]);
    mm = Number(slashMatch[2]);
  } else {
    const suffixMatch = code.match(/[A-Z](\d{2})(\d{2})$/);
    if (!suffixMatch) return null;
    const raw4 = `${suffixMatch[1]}${suffixMatch[2]}`;
    if (/^20[2-3]\d$/.test(raw4) || /^(1000|1500|2000|2500|3000)$/.test(raw4)) {
      return null;
    }
    dd = Number(suffixMatch[1]);
    mm = Number(suffixMatch[2]);
  }

  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;

  const brt = getBrazilDateParts(now);
  const monthDiffSigned = (() => {
    let diff = mm - brt.month;
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;
    return diff;
  })();

  if (Math.abs(monthDiffSigned) > 2) {
    return null;
  }

  let resolvedYear = brt.year;
  if (brt.month <= 2 && mm >= 11) {
    resolvedYear = brt.year - 1;
  } else if (brt.month >= 11 && mm <= 2) {
    resolvedYear = brt.year + 1;
  }

  if (!isValidCalendarDate(resolvedYear, mm, dd)) {
    return null;
  }

  const ddStr = String(dd).padStart(2, '0');
  const mmStr = String(mm).padStart(2, '0');
  return {
    day: dd,
    month: mm,
    year: resolvedYear,
    isoDate: `${resolvedYear}-${mmStr}-${ddStr}`,
    label: `${ddStr}/${mmStr}`,
  };
}

export function isCouponDateExpired(
  code: string,
  now: Date = new Date()
): { expired: boolean; detectedDateLabel?: string } {
  const embedded = extractEmbeddedCouponDate(code, now);
  if (!embedded) return { expired: false };
  const brt = getBrazilDateParts(now);
  if (embedded.isoDate < brt.isoDate) {
    return { expired: true, detectedDateLabel: embedded.label };
  }
  return { expired: false, detectedDateLabel: embedded.label };
}

export function isIsoDateExpiredInBrazil(
  expiresAt?: string,
  now: Date = new Date()
): boolean {
  if (!expiresAt || !expiresAt.trim()) return false;
  const trimmed = expiresAt.trim();
  const brt = getBrazilDateParts(now);

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed < brt.isoDate;
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return false;
  return parsed.getTime() < now.getTime();
}

export function isCapturedProductCouponStale(
  createdAt?: string,
  now: Date = new Date()
): boolean {
  if (!createdAt || !createdAt.trim()) return false;
  const parsed = new Date(createdAt);
  if (isNaN(parsed.getTime())) return false;
  const createdBrt = getBrazilDateParts(parsed);
  const nowBrt = getBrazilDateParts(now);
  return createdBrt.isoDate < nowBrt.isoDate;
}

/**
 * Checks whether a captured coupon has exceeded the allowed age window.
 * - Always expires if captured on a previous calendar day in Brazil (America/Sao_Paulo).
 * - If maxAgeHours > 0 (default 4h), also expires once elapsed time exceeds maxAgeHours.
 * - If maxAgeHours === 0, valid until 23:59 BRT of the capture day.
 */
export function isCapturedCouponExpiredByAge(
  createdAt?: string,
  maxAgeHours: number = DEFAULT_ML_COUPON_MAX_AGE_HOURS,
  now: Date = new Date()
): boolean {
  if (!createdAt || !createdAt.trim()) return false;
  const parsed = new Date(createdAt);
  if (isNaN(parsed.getTime())) return false;
  if (isCapturedProductCouponStale(createdAt, now)) return true;
  if (Number.isFinite(maxAgeHours) && maxAgeHours > 0) {
    const elapsedMs = now.getTime() - parsed.getTime();
    if (elapsedMs > maxAgeHours * 3600_000) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the product carries a valid, fresh, non-expired captured coupon
 * so the auto-dispatch engine can prioritize sending it before the coupon expires.
 */
export function hasFreshValidCapturedCoupon(
  product: {
    platform: Marketplace;
    couponCode?: string;
    createdAt?: string;
  },
  maxAgeHours: number = DEFAULT_ML_COUPON_MAX_AGE_HOURS,
  now: Date = new Date()
): boolean {
  const code = product.couponCode?.trim().toUpperCase();
  if (!code) return false;
  if (isFalsePositiveCouponCode(code)) return false;
  if (isPartnerExclusiveCouponCode(code)) return false;
  if (isCouponDateExpired(code, now).expired) return false;
  if (isCapturedCouponExpiredByAge(product.createdAt, maxAgeHours, now)) return false;
  return true;
}

/**
 * Resolves the effective coupon for a product right before dispatch or during cleanup:
 *
 * Solution 1 (Safe Captured Coupon + Short TTL):
 * - Strips false positives (ATIVE, FICOU), partner-exclusive codes (MELIPROMOBIT),
 *   expired DDMM date codes (MODA1911, LOJASOFICIAIS1911), and captured coupons
 *   older than maxAgeHours (default 4h) or from a previous day.
 * - Keeps the product's original captured coupon ONLY while it is still fresh and valid.
 *
 * Solution 2 (Explicit Site-Wide User Coupon):
 * - NEVER guesses or applies external/category-restricted coupons onto arbitrary products.
 * - ONLY applies a user coupon from "Meus Cupons" when the user explicitly marked
 *   `isSiteWide: true` ("Vale no site inteiro") and the product meets minSpend & expiresAt.
 * - Otherwise sends cleanly WITHOUT a coupon.
 */
export function resolveEffectiveMlCoupon(params: {
  product: {
    platform: Marketplace;
    title: string;
    category?: string;
    discountPrice: number;
    couponCode?: string;
    createdAt?: string;
  };
  savedCoupons?: Coupon[];
  maxAgeHours?: number;
  now?: Date;
}): MlCouponResolutionResult {
  const {
    product,
    savedCoupons = [],
    maxAgeHours = DEFAULT_ML_COUPON_MAX_AGE_HOURS,
    now = new Date(),
  } = params;

  const originalRaw = product.couponCode?.trim();
  const originalCode = originalRaw ? originalRaw.toUpperCase() : undefined;

  if (product.platform !== 'Mercado Livre') {
    if (
      originalCode &&
      (isFalsePositiveCouponCode(originalCode) ||
        isPartnerExclusiveCouponCode(originalCode) ||
        isCouponDateExpired(originalCode, now).expired)
    ) {
      return {
        couponCode: undefined,
        originalCouponCode: originalCode,
        status: 'removed_invalid',
        reason: `Cupom "${originalCode}" removido por ser inválido ou expirado.`,
        changed: true,
      };
    }
    return {
      couponCode: originalCode,
      originalCouponCode: originalCode,
      status: 'not_ml',
      changed: false,
    };
  }

  // Filter ONLY user coupons explicitly confirmed as site-wide ("Vale no site inteiro")
  const siteWideUserMlCoupons = savedCoupons.filter((c) => {
    if (!c || c.isShowcase || !c.active || !c.isSiteWide) return false;
    if (c.platform !== 'Mercado Livre') return false;
    if (isFalsePositiveCouponCode(c.code)) return false;
    if (isPartnerExclusiveCouponCode(c.code, c.description)) return false;
    if (isIsoDateExpiredInBrazil(c.expiresAt, now)) return false;
    if (isCouponDateExpired(c.code, now).expired) return false;
    return true;
  });

  // Step 1: Validate existing coupon on product
  let rejectionReason: string | undefined;
  if (originalCode) {
    if (isFalsePositiveCouponCode(originalCode)) {
      rejectionReason = `"${originalCode}" é uma palavra comum capturada por engano, não um cupom.`;
    } else if (isPartnerExclusiveCouponCode(originalCode)) {
      rejectionReason = `Cupom ${originalCode} é exclusivo de site parceiro e foi bloqueado.`;
    } else {
      const dateCheck = isCouponDateExpired(originalCode, now);
      if (dateCheck.expired) {
        rejectionReason = `Cupom ${originalCode} tem data vencida (${dateCheck.detectedDateLabel}).`;
      } else {
        // Check if it matches an active site-wide coupon explicitly confirmed by the user
        const matchingSiteWide = siteWideUserMlCoupons.find(
          (c) => c.code.trim().toUpperCase() === originalCode
        );
        if (matchingSiteWide) {
          if (!matchingSiteWide.minSpend || product.discountPrice >= matchingSiteWide.minSpend) {
            return {
              couponCode: originalCode,
              originalCouponCode: originalCode,
              status: 'confirmed_sitewide',
              reason: `Confirmado como cupom de site inteiro em Meus Cupons.`,
              changed: false,
            };
          }
          rejectionReason = `Cupom ${originalCode} exige compra mínima de R$ ${matchingSiteWide.minSpend}.`;
        } else if (isCapturedCouponExpiredByAge(product.createdAt, maxAgeHours, now)) {
          rejectionReason =
            maxAgeHours > 0
              ? `Cupom ${originalCode} passou do limite de ${maxAgeHours}h (ou é de dia anterior) e foi removido para evitar cupom esgotado.`
              : `Cupom ${originalCode} foi capturado em dia anterior e removido.`;
        } else {
          // Captured recently on this exact product — keep it!
          return {
            couponCode: originalCode,
            originalCouponCode: originalCode,
            status: 'fresh_captured',
            reason: `Cupom original da oferta dentro do prazo de validade.`,
            changed: false,
          };
        }
      }
    }
  }

  // Step 2: ONLY apply a user coupon if explicitly marked "Vale no site inteiro" (`isSiteWide: true`)
  const eligibleSiteWide = siteWideUserMlCoupons.find(
    (c) => !c.minSpend || product.discountPrice >= c.minSpend
  );
  if (eligibleSiteWide) {
    const replacementCode = eligibleSiteWide.code.trim().toUpperCase();
    return {
      couponCode: replacementCode,
      originalCouponCode: originalCode,
      status: 'applied_sitewide',
      reason: rejectionReason
        ? `${rejectionReason} Aplicado cupom de site inteiro ${replacementCode}.`
        : `Aplicado cupom de site inteiro ${replacementCode}.`,
      changed: replacementCode !== originalCode,
    };
  }

  // Step 3: No valid site-wide coupon -> send cleanly without coupon
  if (originalCode) {
    return {
      couponCode: undefined,
      originalCouponCode: originalCode,
      status: 'removed_invalid',
      reason: rejectionReason || `Cupom ${originalCode} removido por estar expirado/inválido.`,
      changed: true,
    };
  }

  return {
    couponCode: undefined,
    originalCouponCode: undefined,
    status: 'none',
    changed: false,
  };
}
