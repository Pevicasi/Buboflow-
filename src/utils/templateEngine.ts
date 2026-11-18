import {
  Marketplace,
  MessageTemplate,
  PlatformIntegrations,
  Product,
} from '../types';

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

export function renderProductMessage(
  product: Product,
  template: MessageTemplate,
  integrations: PlatformIntegrations
): string {
  const vars: Record<string, string> = {
    '{{nome}}': product.title,
    '{{cta_ia}}': product.ctaHighlight || product.title,
    '{{preco_original}}': `R$ ${formatBRL(product.originalPrice)}`,
    '{{preco_desconto}}': `R$ ${formatBRL(product.discountPrice)}`,
    '{{desconto_pct}}': String(product.discountPercent),
    '{{link}}': product.affiliateUrl,
    '{{link_app}}': product.affiliateUrl,
    '{{cupom}}': product.couponCode ? `🎟️ Use o cupom: *${product.couponCode}*` : '',
    '{{info_extra}}': product.extraInfo || '',
  };

  const replaceTokens = (str: string) => {
    let out = str;
    for (const [token, val] of Object.entries(vars)) {
      out = out.split(token).join(val);
    }
    return out;
  };

  const conditionLines: string[] = [];
  for (const cond of template.conditions) {
    let passed = false;
    if (cond.variable === 'cta_ia') {
      passed = Boolean(product.ctaHighlight && product.ctaHighlight.trim().length > 0);
    } else if (cond.variable === 'desconto_pct') {
      const threshold = cond.compareValue ?? 0;
      passed = product.discountPercent > threshold;
    } else if (cond.variable === 'cupom') {
      passed = Boolean(product.couponCode && product.couponCode.trim().length > 0);
    } else if (cond.variable === 'info_extra') {
      passed = Boolean(product.extraInfo && product.extraInfo.trim().length > 0);
    }

    const chosen = passed ? cond.thenText : cond.elseText || '';
    if (chosen.trim()) {
      conditionLines.push(replaceTokens(chosen));
    }
  }

  let bodyRendered = replaceTokens(template.body);

  // Clean up empty lines caused by optional empty tokens such as {{cupom}}
  const allLines = [
    ...(conditionLines.length > 0 ? conditionLines : []),
    ...bodyRendered.split('\n'),
  ]
    .map((line) => line.trimEnd())
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
