import {
  Marketplace,
  MessageTemplate,
  PlatformIntegrations,
  Product,
} from '../types';
import { cleanOfferTitle } from './affiliateUrlRules';
import {
  COND_MARKER_REGEX,
  evaluateTemplateCondition,
  hasInlineConditionMarkers,
  resolveDynamicTokens,
} from './templateBlocks';

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function detectMarketplaceFromUrl(url: string): Marketplace {
  const lower = url.toLowerCase();
  if (lower.includes('mercadolivre') || lower.includes('meli.la')) {
    return 'Mercado Livre';
  }
  if (lower.includes('amazon') || lower.includes('amzn.to')) {
    return 'Amazon';
  }
  if (lower.includes('magazineluiza') || lower.includes('magazinevoce') || lower.includes('magalu')) {
    return 'Magalu';
  }
  if (lower.includes('netshoes')) {
    return 'Netshoes';
  }
  if (lower.includes('aliexpress') || lower.includes('s.click.aliexpress')) {
    return 'AliExpress';
  }
  return 'Shopee';
}

export function buildAffiliateLink(
  rawUrl: string,
  platform: Marketplace,
  integrations: PlatformIntegrations
): string {
  const cleanUrl = rawUrl.trim() || 'https://shopee.com.br/oferta';
  const shortHash = Math.abs(
    cleanUrl.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7)
  )
    .toString(36)
    .slice(0, 6);

  switch (platform) {
    case 'Mercado Livre': {
      const tag = integrations.mercadoLivre.etiqueta || 'vipe6350064';
      if (cleanUrl.includes('meli.la/')) return cleanUrl;
      return `https://meli.la/${shortHash}?matt_tool=${encodeURIComponent(tag)}`;
    }
    case 'Shopee': {
      const sub = integrations.shopee.subIds[0];
      const base = `https://s.shopee.com.br/${shortHash.toUpperCase()}`;
      return sub ? `${base}?sub_id1=${encodeURIComponent(sub)}` : base;
    }
    case 'Amazon': {
      const tag = integrations.amazon.associateTag || 'divulgatudo-20';
      if (integrations.amazon.autoShorten) {
        return `https://amzn.to/${shortHash}?tag=${encodeURIComponent(tag)}`;
      }
      const sep = cleanUrl.includes('?') ? '&' : '?';
      return `${cleanUrl}${sep}tag=${encodeURIComponent(tag)}`;
    }
    case 'Magalu': {
      const store = integrations.magalu.partnerStore || 'divulgatudoofertas';
      return `https://www.magazinevoce.com.br/${encodeURIComponent(store)}/p/${shortHash}/`;
    }
    case 'Netshoes': {
      const sid = integrations.netshoes.accountSid || '4695120';
      return `https://www.netshoes.com.br/p/${shortHash}?utm_source=rakuten&sid=${encodeURIComponent(sid)}`;
    }
    case 'AliExpress': {
      const tracking = integrations.aliexpress.trackingId || 'divulgatudo';
      return `https://s.click.aliexpress.com/e/_${shortHash}?aff_trace_key=${encodeURIComponent(tracking)}`;
    }
  }
}

export function applyNominalCouponRule(
  text: string,
  platform: Marketplace,
  integrations: PlatformIntegrations
): string {
  if (platform !== 'Netshoes') return text;
  const { nominalCoupon, blockedCoupons } = integrations.netshoes;
  if (!nominalCoupon.trim() || blockedCoupons.length === 0) return text;

  let result = text;
  for (const blocked of blockedCoupons) {
    if (!blocked.trim()) continue;
    const regex = new RegExp(blocked.trim(), 'gi');
    result = result.replace(regex, nominalCoupon.trim());
  }
  return result;
}

export function buildStyledCta(
  title: string,
  ctaStyle: MessageTemplate['ctaStyle'],
  existingCta?: string
): string {
  const cleanTitle = cleanOfferTitle(title);
  if (ctaStyle === 'Urgência') {
    return `🚨 CORRE! ${cleanTitle} — oferta por tempo limitado!`;
  }
  if (ctaStyle === 'Direto') {
    return `🔥 ${cleanTitle}`;
  }
  if (ctaStyle === 'Descontraído') {
    return `😍 Olha esse achadinho: ${cleanTitle}!`;
  }
  return existingCta?.trim() || '';
}

export function renderProductMessage(
  product: Product,
  template: MessageTemplate,
  integrations: PlatformIntegrations
): string {
  const cleanTitle = cleanOfferTitle(product.title) || product.title;
  const styledCta = buildStyledCta(cleanTitle, template.ctaStyle, product.ctaHighlight);
  const hasRealDiscount =
    product.discountPercent > 0 && product.originalPrice > product.discountPrice;

  const vars: Record<string, string> = {
    '{{nome}}': cleanTitle,
    '{{cta_ia}}': styledCta || cleanTitle,
    '{{preco_original}}': `R$ ${formatBRL(product.originalPrice)}`,
    '{{preco_desconto}}': `R$ ${formatBRL(product.discountPrice)}`,
    '{{desconto_pct}}': String(Math.max(0, Math.round(product.discountPercent || 0))),
    '{{link}}': product.affiliateUrl,
    '{{link_app}}': product.affiliateUrl,
    '{{cupom}}': product.couponCode ? `🎟️ Use o cupom: *${product.couponCode}*` : '',
    '{{info_extra}}': product.extraInfo || '',
  };

  const seedText = `${product.id || ''}:${cleanTitle}`;

  const replaceTokens = (str: string) => {
    let out = resolveDynamicTokens(str, seedText);
    for (const [token, val] of Object.entries(vars)) {
      out = out.split(token).join(val);
    }
    return out;
  };

  const stripZeroDiscountArtifacts = (line: string): string => {
    if (hasRealDiscount) return line;
    return line
      .replace(/[ \t]*(?:🔥|⚡|💥)?[ \t]*\(?0%[ \t]*OFF\)?/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+$/, '');
  };

  const evalCtx = {
    styledCta,
    hasRealDiscount,
    discountPercent: product.discountPercent,
    couponCode: product.couponCode,
    extraInfo: product.extraInfo,
  };

  const normalizedBody = (template.body || '').replace(/\r\n/g, '\n');

  if (hasInlineConditionMarkers(normalizedBody)) {
    const condById = new Map((template.conditions || []).map((c) => [c.id, c]));
    const rawLines = normalizedBody.split('\n');
    const outputLines: string[] = [];

    for (const rawLine of rawLines) {
      const match = rawLine.match(COND_MARKER_REGEX);
      if (match) {
        const cond = condById.get(match[1]);
        if (!cond) continue;
        const markerIdx = match.index ?? 0;
        const rawPrefix = rawLine.slice(0, markerIdx);
        const rawSuffix = rawLine.slice(markerIdx + match[0].length);

        const passed = evaluateTemplateCondition(cond, evalCtx);
        const chosen = passed ? cond.thenText : cond.elseText || '';

        if (chosen.trim().length === 0) {
          // If the condition evaluated to empty, only keep surrounding text if it's real copy (not an orphan emoji prefix)
          const prefixRendered = stripZeroDiscountArtifacts(replaceTokens(rawPrefix));
          const suffixRendered = stripZeroDiscountArtifacts(replaceTokens(rawSuffix));
          const surroundingHasWord = /[A-Za-zÀ-ÿ0-9]/.test(
            `${prefixRendered}${suffixRendered}`
          );
          if (surroundingHasWord) {
            outputLines.push(`${prefixRendered}${suffixRendered}`.replace(/[ \t]+$/, ''));
          }
          continue;
        }

        const chosenLines = replaceTokens(chosen)
          .replace(/\r\n/g, '\n')
          .split('\n')
          .map((line) => stripZeroDiscountArtifacts(line));

        const hasAnyContent = chosenLines.some((l) => l.trim().length > 0);
        if (!hasAnyContent) continue;

        const renderedPrefix = stripZeroDiscountArtifacts(replaceTokens(rawPrefix));
        const renderedSuffix = stripZeroDiscountArtifacts(replaceTokens(rawSuffix));

        if (renderedPrefix.length > 0 && chosenLines.length > 0) {
          const trimmedPref = renderedPrefix.trim();
          const firstTrimmed = chosenLines[0].trimStart();
          // Avoid duplicating identical leading emoji like "💥 💥 Nome"
          if (trimmedPref.length > 0 && firstTrimmed.startsWith(trimmedPref)) {
            chosenLines[0] = firstTrimmed;
          } else {
            chosenLines[0] = `${renderedPrefix}${chosenLines[0]}`;
          }
        }
        if (renderedSuffix.length > 0 && chosenLines.length > 0) {
          chosenLines[chosenLines.length - 1] = `${chosenLines[chosenLines.length - 1]}${renderedSuffix}`;
        }

        outputLines.push(...chosenLines);
        continue;
      }

      const trimmedRaw = rawLine.trim();
      const replaced = stripZeroDiscountArtifacts(replaceTokens(rawLine));
      if (
        (trimmedRaw === '{{cupom}}' || trimmedRaw === '{{info_extra}}') &&
        replaced.trim() === ''
      ) {
        continue;
      }
      outputLines.push(replaced);
    }

    const cleanedLines = outputLines
      .map((line) => line.replace(/[ \t]+$/, ''))
      .filter((line, idx, arr) => {
        if (line === '' && idx > 0 && arr[idx - 1] === '') return false;
        return true;
      });

    const combined = cleanedLines.join('\n').trim();
    return applyNominalCouponRule(combined, product.platform, integrations);
  }

  // Legacy template fallback (when body has no [[cond:<id>]] inline markers)
  const bodyAlreadyHasTitle =
    normalizedBody.includes('{{nome}}') || normalizedBody.includes('{{cta_ia}}');

  const conditionLines: string[] = [];
  for (const cond of template.conditions || []) {
    if (cond.variable === 'espaco') {
      conditionLines.push('');
      continue;
    }
    if (cond.variable === 'cta_ia' && bodyAlreadyHasTitle) {
      continue;
    }
    const passed = evaluateTemplateCondition(cond, evalCtx);
    const chosen = passed ? cond.thenText : cond.elseText || '';
    if (chosen.length > 0) {
      const splitLines = replaceTokens(chosen)
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => stripZeroDiscountArtifacts(line));
      const hasAnyContent = splitLines.some((l) => l.trim().length > 0);
      if (hasAnyContent) {
        conditionLines.push(...splitLines);
      }
    }
  }

  const rawBodyLines = normalizedBody.split('\n');
  const bodyLines: string[] = [];
  for (const rawLine of rawBodyLines) {
    const trimmedRaw = rawLine.trim();
    const replaced = stripZeroDiscountArtifacts(replaceTokens(rawLine));
    if (
      (trimmedRaw === '{{cupom}}' || trimmedRaw === '{{info_extra}}') &&
      replaced.trim() === ''
    ) {
      continue;
    }
    bodyLines.push(replaced);
  }

  const allLines = [...conditionLines, ...bodyLines]
    .map((line) => line.replace(/[ \t]+$/, ''))
    .filter((line, idx, arr) => {
      if (line === '' && idx > 0 && arr[idx - 1] === '') return false;
      return true;
    });

  const combined = allLines.join('\n').trim();
  return applyNominalCouponRule(combined, product.platform, integrations);
}

export function getPreviewDomain(platform: Marketplace): string {
  switch (platform) {
    case 'Shopee':
      return 's.shopee.com.br';
    case 'Mercado Livre':
      return 'meli.la';
    case 'Amazon':
      return 'amzn.to';
    case 'Magalu':
      return 'magazinevoce.com.br';
    case 'Netshoes':
      return 'netshoes.com.br';
    case 'AliExpress':
      return 's.click.aliexpress.com';
  }
}

export function getDemoAffiliateUrlForPlatform(platform: Marketplace): string {
  switch (platform) {
    case 'Mercado Livre':
      return 'https://meli.la/29frSun';
    case 'Shopee':
      return 'https://s.shopee.com.br/9Kx2Ab';
    case 'Amazon':
      return 'https://amzn.to/4xYz12';
    case 'Magalu':
      return 'https://www.magazinevoce.com.br/sualoja/p/9kx2ab/';
    case 'Netshoes':
      return 'https://www.netshoes.com.br/p/9kx2ab';
    case 'AliExpress':
      return 'https://s.click.aliexpress.com/e/_9kx2ab';
  }
}

export function getDemoProductForPlatform(
  platform: Marketplace,
  realSample?: Product | null
): Product {
  const sampleUrl = getDemoAffiliateUrlForPlatform(platform);
  return {
    id: `demo-${platform.toLowerCase().replace(/\s+/g, '-')}`,
    title: realSample?.title
      ? cleanOfferTitle(realSample.title)
      : 'Tênis Nike Revolution 7 Masculino',
    ctaHighlight: '',
    platform,
    category: realSample?.category || 'Esportes e Atividades ao Ar Livre',
    originalPrice:
      realSample && realSample.originalPrice > realSample.discountPrice
        ? realSample.originalPrice
        : 399.9,
    discountPrice:
      realSample && realSample.discountPrice > 0 && realSample.originalPrice > realSample.discountPrice
        ? realSample.discountPrice
        : 199.9,
    discountPercent:
      realSample && realSample.discountPercent > 0 ? realSample.discountPercent : 50,
    commissionPercent: realSample?.commissionPercent || 12,
    commissionValue: realSample?.commissionValue || 23.99,
    affiliateUrl: sampleUrl,
    originalUrl: realSample?.originalUrl || sampleUrl,
    couponCode: realSample?.couponCode || 'OFERTA10',
    extraInfo: realSample?.extraInfo || 'Envio Rápido · Estoque Limitado',
    artworkKey: realSample?.artworkKey || 'sneaker',
    customImageUrl: realSample?.customImageUrl,
    isFavorite: false,
    isPrioritized: true,
    salesRank: 1,
    segment: 'Geral',
    createdAt: '2026-11-17T22:00:00Z',
  };
}
