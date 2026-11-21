import {
  isCouponDateExpired,
  isFalsePositiveCouponCode,
  isPartnerExclusiveCouponCode,
} from './mercadoLivreCoupons.ts';

export function sanitizeShopeeSubIds(rawSubIds?: string[] | null): string[] {
  if (!Array.isArray(rawSubIds)) return [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of rawSubIds) {
    const sanitized = String(raw || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 50);
    if (!sanitized) continue;
    const key = sanitized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(sanitized);
    if (clean.length >= 5) break;
  }
  return clean;
}

export function extractShopeeIdsFromUrl(
  rawUrl: string
): { shopId: string; itemId: string } | null {
  if (!rawUrl) return null;
  const clean = rawUrl.trim();
  const opaaOrProduct = clean.match(
    /shopee\.com(?:\.br)?\/(?:opaanlp|product|universal-link\/product)\/(\d+)\/(\d+)/i
  );
  if (opaaOrProduct) {
    return { shopId: opaaOrProduct[1], itemId: opaaOrProduct[2] };
  }
  const slugDot = clean.match(/-i\.(\d+)\.(\d+)(?:[/?#]|$)/i);
  if (slugDot) {
    return { shopId: slugDot[1], itemId: slugDot[2] };
  }
  const shopPath = clean.match(/shopee\.com(?:\.br)?\/[^/?#]+\/(\d{5,})\/(\d{6,})(?:[/?#]|$)/i);
  if (shopPath) {
    return { shopId: shopPath[1], itemId: shopPath[2] };
  }
  return null;
}

function decodeExtractedUrl(raw: string): string {
  return raw
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u003F/gi, '?')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim();
}

export function isMercadoLivreProductUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/mercadolivre\.com\.br|mercadolibre\.com/i.test(u.hostname)) return false;
    if (/\/social\//i.test(u.pathname)) return false;
    return (
      /\/p\/MLB\d+/i.test(u.pathname) ||
      /\/up\/MLBU\d+/i.test(u.pathname) ||
      /\/MLB-?\d+/i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

export function cleanMarketplaceProductUrl(rawUrl: string, platform?: string): string {
  const trimmed = decodeExtractedUrl(String(rawUrl || ''));
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  const isShopee =
    platform === 'Shopee' ||
    lower.includes('shopee.com') ||
    lower.includes('shope.ee');
  if (isShopee) {
    const ids = extractShopeeIdsFromUrl(trimmed);
    if (ids) {
      return `https://shopee.com.br/product/${ids.shopId}/${ids.itemId}`;
    }
    try {
      const u = new URL(trimmed);
      const stripKeys = [
        'uls_trackid',
        'mmp_pid',
        'gads_t_sig',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'af_siteid',
        'af_channel',
        'af_adset',
        'pid',
        'c',
        'smtt',
        'sp_atk',
        'xptdk',
        '__mobile__',
        'exp_group',
      ];
      for (const k of stripKeys) u.searchParams.delete(k);
      u.hash = '';
      return u.toString();
    } catch {
      return trimmed;
    }
  }

  const isMl =
    platform === 'Mercado Livre' ||
    lower.includes('mercadolivre.com') ||
    lower.includes('mercadolibre.com');
  if (isMl) {
    try {
      const u = new URL(trimmed);
      if (isMercadoLivreProductUrl(trimmed)) {
        // Strip all tracking/affiliate query params & polycard hash from product URL
        return `${u.origin}${u.pathname}`;
      }
      const stripMl = [
        'matt_word',
        'matt_tool',
        'matt_tool_id',
        'matt_event_ts',
        'matt_d2id',
        'matt_tracing_id',
        'ref',
        'forceInApp',
        'tracking_id',
        'reco_id',
        'reco_client',
        'reco_backend',
        'reco_backend_type',
        'reco_item_pos',
        'source',
        'c_id',
        'c_uid',
        'wid',
        'sid',
      ];
      for (const k of stripMl) u.searchParams.delete(k);
      u.hash = '';
      return u.toString();
    } catch {
      return trimmed;
    }
  }

  // Amazon, Magalu, Netshoes, AliExpress — strip competitor affiliate/tracking params
  try {
    const u = new URL(trimmed);
    const stripGeneric = [
      'tag',
      'linkCode',
      'linkId',
      'ascsubtag',
      'ref',
      'ref_',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'sid',
      'awc',
      'aw_affid',
      'aff_fcid',
      'aff_fsk',
      'aff_platform',
      'aff_trace_key',
      'sk',
    ];
    for (const k of stripGeneric) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return trimmed;
  }
}

export function extractMercadoLivreProductUrlFromHtml(html: string): string | null {
  if (!html) return null;

  const normalizeCandidate = (raw?: string | null): string | null => {
    if (!raw) return null;
    const decoded = decodeExtractedUrl(raw);
    if (!isMercadoLivreProductUrl(decoded)) return null;
    return cleanMarketplaceProductUrl(decoded, 'Mercado Livre');
  };

  // 1. Featured "Ir para produto" JSON action link on Mercado Livre /social/<handle> pages
  const actionLinkPatterns = [
    /"id"\s*:\s*"show_product"[^}]{0,300}"url"\s*:\s*"(https?:[^"]+)"/i,
    /"text"\s*:\s*"Ir para produto"[^}]{0,300}"url"\s*:\s*"(https?:[^"]+)"/i,
    /"url"\s*:\s*"(https?:[^"]+)"[^}]{0,200}"id"\s*:\s*"show_product"/i,
  ];
  for (const re of actionLinkPatterns) {
    const m = html.match(re);
    const clean = normalizeCandidate(m?.[1]);
    if (clean) return clean;
  }

  // 2. Featured card anchor (c_id=/home/card-featured/element) — never recommendation cards below
  const featuredCardRegex =
    /https?:(?:\\u002F|\/){2}(?:www\.|produto\.)?mercadolivre\.com\.br[^"'\\<>\s]+(?:c_id=\/home\/card-featured\/element|c_id=%2Fhome%2Fcard-featured%2Felement)[^"'<>\s]*/gi;
  const featuredHits = html.match(featuredCardRegex) || [];
  for (const hit of featuredHits) {
    const clean = normalizeCandidate(hit);
    if (clean) return clean;
  }

  // 3. Direct HTML <a href="...">Ir para produto</a>
  const anchorHit =
    html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>[^<]{0,60}Ir para produto/i)?.[1] ||
    html.match(/Ir para produto[\s\S]{0,250}href=["'](https?:\/\/[^"']+)["']/i)?.[1];
  const fromAnchor = normalizeCandidate(anchorHit);
  if (fromAnchor) return fromAnchor;

  // 4. Canonical / og:url ONLY if it is an actual product URL (never /social/)
  const canonicalHit =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["'](https?:\/\/[^"']+)["']/i)?.[1] ||
    html.match(/property=["']og:url["'][^>]*content=["'](https?:\/\/[^"']+)["']/i)?.[1];
  const fromCanonical = normalizeCandidate(canonicalHit);
  if (fromCanonical) return fromCanonical;

  // 5. Fallback: first clean /p/MLB or /up/MLBU or produto.mercadolivre.com.br/MLB- link that is NOT inside affiliate-profile-recommendations
  const allProductUrls =
    html.match(
      /https?:(?:\\u002F|\/){2}(?:www\.|produto\.)?mercadolivre\.com\.br(?:\\u002F|\/)[^"'<>\s]+/gi
    ) || [];
  for (const candidate of allProductUrls) {
    if (/affiliate-profile-recommendations|v2p-recommendations/i.test(candidate)) continue;
    const clean = normalizeCandidate(candidate);
    if (clean) return clean;
  }

  return null;
}

export function isOfficialShortAffiliateLink(
  url: string,
  platform?: string
): boolean {
  const trimmed = String(url || '').trim();
  if (!trimmed) return false;
  if (platform === 'Mercado Livre') {
    return /^https?:\/\/(?:www\.)?(?:meli\.la\/[a-zA-Z0-9_-]+|mercadolivre\.com\/sec\/[a-zA-Z0-9_-]+)\/?$/i.test(
      trimmed
    );
  }
  if (platform === 'Shopee') {
    return /^https?:\/\/(?:s\.shopee\.com\.br|shope\.ee)\/[a-zA-Z0-9_-]+\/?$/i.test(
      trimmed
    );
  }
  return false;
}

export function needsAffiliateReconversion(
  product: {
    platform?: string;
    affiliateUrl?: string;
    originalUrl?: string;
  },
  ownMlTag?: string
): boolean {
  const platform = product.platform || '';
  const aff = String(product.affiliateUrl || '').trim();
  const orig = String(product.originalUrl || '').trim();

  if (!aff) return true;

  if (platform === 'Mercado Livre') {
    // Any /social/<handle> link (especially another affiliate's) MUST be reconverted to our short link!
    if (/mercadolivre\.com\.br\/social\//i.test(aff)) return true;
    // Any link with a different matt_word or ref param MUST be reconverted
    try {
      const u = new URL(aff);
      const word = u.searchParams.get('matt_word');
      if (word && ownMlTag && word.toLowerCase() !== ownMlTag.toLowerCase()) {
        return true;
      }
      if (u.searchParams.has('ref')) return true;
    } catch {
      return true;
    }
    // Prefer official short affiliate link (meli.la or mercadolivre.com/sec/)
    if (!isOfficialShortAffiliateLink(aff, 'Mercado Livre')) return true;
    return false;
  }

  if (platform === 'Shopee') {
    if (!isOfficialShortAffiliateLink(aff, 'Shopee')) return true;
    // If affiliateUrl is identical to the competitor's original shortlink, it wasn't converted!
    if (orig && aff.toLowerCase() === orig.toLowerCase()) return true;
    return false;
  }

  return false;
}

export function cleanOfferTitle(rawTitle: string): string {
  return String(rawTitle || '')
    .replace(/\s*[-–|]\s*R\$\s*\d{1,4}(?:\.\d{3})*(?:,\d{2})?\s*$/i, '')
    .replace(/\s*\|\s*(?:Mercado\s*Livre|Shopee\s*Brasil|Shopee|Amazon\.com\.br|Magazine\s*Luiza|Magalu|Netshoes|AliExpress)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractMercadoLivrePricingFromHtml(html: string): {
  title?: string;
  originalPrice?: number;
  discountPrice?: number;
  discountPercent?: number;
} {
  if (!html) return {};

  // Scope to featured card (before recommendation sections below) so we never pull another product's price
  const recoMarkers = [
    'affiliate-profile-recommendations',
    'v2p-recommendations',
    'Você também pode gostar',
  ];
  let featuredSlice = html;
  for (const marker of recoMarkers) {
    const idx = featuredSlice.indexOf(marker);
    if (idx > 200) {
      featuredSlice = featuredSlice.slice(0, idx);
    }
  }

  const out: {
    title?: string;
    originalPrice?: number;
    discountPrice?: number;
    discountPercent?: number;
  } = {};

  const titleMatch = featuredSlice.match(
    /"title"\s*:\s*\{\s*"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i
  );
  if (titleMatch?.[1]) {
    try {
      const decoded = JSON.parse(`"${titleMatch[1]}"`);
      const cleaned = cleanOfferTitle(decoded);
      if (cleaned.length >= 4) out.title = cleaned;
    } catch {
      const cleaned = cleanOfferTitle(titleMatch[1]);
      if (cleaned.length >= 4) out.title = cleaned;
    }
  }

  const prevMatch =
    featuredSlice.match(/"previous_price"\s*:\s*\{[^}]*"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i) ||
    featuredSlice.match(/"original_price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (prevMatch?.[1]) {
    const val = parseFloat(prevMatch[1]);
    if (Number.isFinite(val) && val > 0) out.originalPrice = val;
  }

  const currMatch =
    featuredSlice.match(/"current_price"\s*:\s*\{[^}]*"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i) ||
    featuredSlice.match(/"price"\s*:\s*\{[^}]*"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (currMatch?.[1]) {
    const val = parseFloat(currMatch[1]);
    if (Number.isFinite(val) && val > 0) out.discountPrice = val;
  }

  const pctMatch =
    featuredSlice.match(/"discount_pct"\s*:\s*(\d{1,2})/i) ||
    featuredSlice.match(/"discount_label"\s*:\s*\{[^}]*"text"\s*:\s*"(\d{1,2})%\s*OFF/i);
  if (pctMatch?.[1]) {
    const pct = parseInt(pctMatch[1], 10);
    if (Number.isFinite(pct) && pct > 0 && pct < 100) out.discountPercent = pct;
  }

  if (
    !out.discountPercent &&
    out.originalPrice &&
    out.discountPrice &&
    out.originalPrice > out.discountPrice
  ) {
    out.discountPercent = Math.round(
      ((out.originalPrice - out.discountPrice) / out.originalPrice) * 100
    );
  }

  return out;
}

export function extractCouponFromMessageText(text: string): string | undefined {
  if (!text) return undefined;
  const m = text.match(
    /(?:cupom|código|codigo|use\s+o\s+cupom)\s*[:\-]?\s*[*`]?([A-Z0-9]{4,24})[*`]?/i
  );
  if (!m?.[1]) return undefined;
  const candidate = m[1].toUpperCase();
  if (isFalsePositiveCouponCode(candidate) || isPartnerExclusiveCouponCode(candidate)) {
    return undefined;
  }
  if (isCouponDateExpired(candidate).expired) {
    return undefined;
  }
  return candidate;
}

export function buildWhatsAppLinkPreviewMeta(message: string): {
  matchedUrl: string;
  domain: string;
  title: string;
  description: string;
} | null {
  const raw = String(message || '');
  const urlMatch = raw.match(/https?:\/\/[^\s<>"')\]}]+/i);
  if (!urlMatch?.[0]) return null;
  const matchedUrl = urlMatch[0].replace(/[.,;!?]+$/, '');
  let domain = '';
  try {
    domain = new URL(matchedUrl).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }

  const cleanLines = raw
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/[*~_`]/g, '')
        .trim()
    )
    .filter(Boolean);

  const rawTitleLine =
    cleanLines.find(
      (line) =>
        !/^(?:de:|por:|compre aqui|resgate|promoção sujeita|use o cupom)/i.test(
          line.replace(/^[^\p{L}\p{N}]+/u, '')
        )
    ) || `Oferta em ${domain}`;

  const title = rawTitleLine
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
    .slice(0, 110) || `Oferta em ${domain}`;

  const priceLines = cleanLines
    .filter((line) => /(?:R\$\s*\d|%\s*OFF|De:|Por:)/i.test(line))
    .slice(0, 2);
  const description =
    priceLines.length > 0
      ? priceLines.join(' · ').slice(0, 140)
      : `Confira esta oferta em ${domain}`;

  return { matchedUrl, domain, title, description };
}

export function getLinkPreviewStoreTitle(domain: string): string {
  const lower = String(domain || '').toLowerCase().trim();
  if (/(?:shopee|shp\.ee)/i.test(lower)) return 'Shopee';
  if (/(?:meli\.la|mercadolivre|mercadolibre)/i.test(lower)) return 'Mercado Livre';
  if (/(?:amzn\.to|amazon)/i.test(lower)) return 'Amazon';
  if (/(?:magalu|magazinevoce|magazineluiza)/i.test(lower)) return 'Magalu';
  if (/aliexpress/i.test(lower)) return 'AliExpress';
  if (/netshoes/i.test(lower)) return 'Netshoes';
  return lower || 'Oferta';
}

export function buildBaileysLinkPreviewPayload(
  message: string,
  includeDetails: boolean = false
): {
  'canonical-url': string;
  'matched-text': string;
  title: string;
  description?: string;
} | null {
  const meta = buildWhatsAppLinkPreviewMeta(message);
  if (!meta) return null;
  if (includeDetails) {
    return {
      'canonical-url': meta.matchedUrl,
      'matched-text': meta.matchedUrl,
      title: meta.title,
      description: meta.description,
    };
  }
  // WhatsApp Android/iOS require a non-empty `title` on extendedTextMessage to render the
  // link preview card and its highQualityThumbnail image. Using only the short store name
  // keeps the product photo visible without duplicating the product title or prices.
  return {
    'canonical-url': meta.matchedUrl,
    'matched-text': meta.matchedUrl,
    title: getLinkPreviewStoreTitle(meta.domain),
  };
}

export function interleaveOffersByPlatform<T extends { platform?: string }>(
  offers: T[]
): T[] {
  if (!Array.isArray(offers) || offers.length <= 1) return offers || [];
  const buckets = new Map<string, T[]>();
  for (const item of offers) {
    const key = String(item?.platform || 'Outros');
    const list = buckets.get(key) || [];
    list.push(item);
    buckets.set(key, list);
  }
  const queues = Array.from(buckets.values());
  const interleaved: T[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const q of queues) {
      const next = q.shift();
      if (next !== undefined) {
        interleaved.push(next);
        added = true;
      }
    }
  }
  return interleaved;
}

/**
 * Validates and normalizes a Shopee URL for the official GraphQL `generateShortLink(originUrl)` API.
 * - Unwraps `/universal-link?redir=...` and `/buyer/login?next=...` redirects.
 * - Canonicalizes any recognized product URL into `https://shopee.com.br/product/<shopId>/<itemId>`.
 * - Rejects shortener hosts (`s.shopee.com.br`, `shp.ee`, `br.shp.ee`, `shope.ee`), login/captcha walls,
 *   and non-Shopee hosts that trigger Shopee API `error [11001]: Params Error : invalid origin url`.
 */
export function sanitizeShopeeOriginUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let candidate = rawUrl.trim().replace(/[),.;!?]+$/, '');
  if (!/^https?:\/\//i.test(candidate)) return null;

  // Unwrap redirect wrappers (universal-link / buyer login) up to 3 hops
  for (let hop = 0; hop < 3; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }
    const unwrapped =
      parsed.searchParams.get('redir') ||
      parsed.searchParams.get('next') ||
      parsed.searchParams.get('url');
    if (unwrapped && /^https?:\/\//i.test(unwrapped)) {
      candidate = unwrapped.trim();
      continue;
    }
    break;
  }

  const ids = extractShopeeIdsFromUrl(candidate);
  if (ids?.shopId && ids?.itemId) {
    return `https://shopee.com.br/product/${ids.shopId}/${ids.itemId}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  // Shopee GraphQL strictly rejects shortener domains & non-shopee.com.br hosts
  if (host !== 'shopee.com.br' && host !== 'www.shopee.com.br') {
    return null;
  }

  const pathname = parsed.pathname || '/';
  // Reject login, verification, captcha, and universal-link wrapper paths without product target
  if (
    /^\/(?:buyer\/login|verify|universal-link|api\/|error)/i.test(pathname) ||
    pathname.length > 500
  ) {
    return null;
  }

  const cleaned = cleanMarketplaceProductUrl(`https://shopee.com.br${pathname}${parsed.search}`, 'Shopee');
  try {
    const finalParsed = new URL(cleaned);
    if (finalParsed.hostname.toLowerCase() !== 'shopee.com.br') return null;
    finalParsed.hash = '';
    return finalParsed.toString();
  } catch {
    return null;
  }
}

const WHATSAPP_WORD_JOINER = '\u2060';

/**
 * Prevents WhatsApp Android from falsely turning Brazilian Real prices (e.g. R$ 495,00,
 * R$ 150,11, R$ 1.198,18, R$ 2.099,00) into green underlined clickable phone/code links.
 * Inserts invisible non-breaking Word Joiners (U+2060) between adjacent characters of the
 * numeric portion after "R$", keeping visible rendering, line wrapping, bold/strikethrough
 * markers, and URLs completely intact.
 */
export function shieldWhatsAppCurrencyNumbers(text: string): string {
  const input = String(text ?? '');
  if (!input) return input;
  return input.replace(
    /(R\$\s*)(\d(?:[\d.,\u2060]*\d)?)/gi,
    (_match, prefix: string, rawAmount: string) => {
      const cleanAmount = rawAmount.replace(/\u2060/g, '');
      if (cleanAmount.length < 2) return `${prefix}${cleanAmount}`;
      const shielded = cleanAmount.split('').join(WHATSAPP_WORD_JOINER);
      return `${prefix}${shielded}`;
    }
  );
}



