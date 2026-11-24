import { shieldWhatsAppCurrencyNumbers } from './affiliateUrlRules.ts';

export type WhatsAppStatusFormat =
  | 'story-card-photo'
  | 'raw-photo-caption'
  | 'link-text-card'
  | 'combo-card-then-link'
  | 'combo-raw-then-link'
  | 'video-plus-link';

export type WhatsAppStatusAudienceMode =
  | 'self_and_test'
  | 'test_group'
  | 'all_group_contacts';

export interface WhatsAppStatusThemePreset {
  id: string;
  label: string;
  bgHex: string;
  gradientBottomHex: string;
  accentHex: string;
}

export const WHATSAPP_STATUS_THEMES: WhatsAppStatusThemePreset[] = [
  {
    id: 'emerald',
    label: 'Verde Oferta',
    bgHex: '#064E3B',
    gradientBottomHex: '#022C22',
    accentHex: '#10B981',
  },
  {
    id: 'slate',
    label: 'Preto Estúdio',
    bgHex: '#0F172A',
    gradientBottomHex: '#020617',
    accentHex: '#22C55E',
  },
  {
    id: 'cobalt',
    label: 'Azul Confiança',
    bgHex: '#1E3A8A',
    gradientBottomHex: '#0F172A',
    accentHex: '#38BDF8',
  },
  {
    id: 'crimson',
    label: 'Vermelho Urgência',
    bgHex: '#7F1D1D',
    gradientBottomHex: '#450A0A',
    accentHex: '#F97316',
  },
  {
    id: 'violet',
    label: 'Roxo Destaque',
    bgHex: '#4C1D95',
    gradientBottomHex: '#2E1065',
    accentHex: '#A78BFA',
  },
];

export const WHATSAPP_STATUS_FONTS: { id: number; label: string }[] = [
  { id: 0, label: 'Padrão (Sans)' },
  { id: 1, label: 'Serifa Clássica' },
  { id: 5, label: 'Negrito Forte' },
  { id: 2, label: 'Manuscrita' },
];

export interface WhatsAppStatusFormatMeta {
  id: WhatsAppStatusFormat;
  title: string;
  badge: string;
  screensCount: 1 | 2;
  clickableLink: 'Sim (direto na tela)' | 'Na legenda da foto' | 'No 2º Status em sequência';
  summary: string;
  pros: string;
  tradeoff: string;
}

export const WHATSAPP_STATUS_FORMATS: WhatsAppStatusFormatMeta[] = [
  {
    id: 'combo-card-then-link',
    title: 'Combo Duplo (Card Visual + Link Clicável)',
    badge: 'Recomendado',
    screensCount: 2,
    clickableLink: 'No 2º Status em sequência',
    summary:
      'Posta primeiro uma arte vertical 9:16 montada automaticamente com a foto, preço e selo OFF; 2 segundos depois posta o Status colorido com card clicável.',
    pros: 'Une vitrine visual bonita + link 100% clicável no próximo toque.',
    tradeoff: 'Usa 2 telas seguidas por oferta no carrossel de Status.',
  },
  {
    id: 'link-text-card',
    title: 'Só Link Clicável (Fundo Colorido + Miniatura)',
    badge: '100% Clicável',
    screensCount: 1,
    clickableLink: 'Sim (direto na tela)',
    summary:
      'Posta 1 Status de texto colorido com a prévia oficial do link, miniatura da foto do produto, título, preço e link sublinhado clicável na tela.',
    pros: 'Link abre direto com 1 toque em qualquer celular e usa só 1 tela.',
    tradeoff: 'A foto aparece dentro da caixinha de prévia (menor que uma foto em tela cheia).',
  },
  {
    id: 'story-card-photo',
    title: 'Card Visual 9:16 Único (Arte + Legenda)',
    badge: 'Visual Alto',
    screensCount: 1,
    clickableLink: 'Na legenda da foto',
    summary:
      'Gera uma imagem 1080×1920 com foto grande, selo de desconto, De/Por e cupom dentro da arte, e envia como foto única com o link na legenda.',
    pros: 'Visual profissional em 1 única tela, chama muita atenção no carrossel.',
    tradeoff: 'Em alguns aparelhos, o link dentro da legenda de foto exige abrir "Ler mais".',
  },
  {
    id: 'raw-photo-caption',
    title: 'Foto Original + Legenda Completa',
    badge: 'Simples',
    screensCount: 1,
    clickableLink: 'Na legenda da foto',
    summary:
      'Envia a foto quadrada original do produto sem arte em volta, acompanhada da legenda tradicional (nome, De/Por, cupom e link).',
    pros: 'Rápido e idêntico ao padrão limpo de foto do catálogo.',
    tradeoff: 'Mesma limitação do WhatsApp: link fica na legenda abaixo da foto.',
  },
  {
    id: 'combo-raw-then-link',
    title: 'Combo Simples (Foto Original + Link Clicável)',
    badge: '2 Telas Leve',
    screensCount: 2,
    clickableLink: 'No 2º Status em sequência',
    summary:
      'Posta a foto grande original do produto com chamada curta e, 2 segundos depois, posta o Status de link clicável com miniatura.',
    pros: 'Foto grande limpa na 1ª tela + link clicável garantido na 2ª tela.',
    tradeoff: 'Usa 2 telas seguidas por oferta.',
  },
  {
    id: 'video-plus-link',
    title: 'Vídeo Curto + Link Clicável (Reels / Shopee)',
    badge: 'Vídeo',
    screensCount: 2,
    clickableLink: 'No 2º Status em sequência',
    summary:
      'Baixa o vídeo limpo do link (Instagram, Shopee Vídeo, TikTok ou MP4 direto), posta no Status e envia o Status de link clicável logo em seguida.',
    pros: 'Maior retenção e prova visual do produto em movimento.',
    tradeoff: 'Exige informar um link de vídeo válido (até ~15MB).',
  },
];

function escapeXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapTextLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      if (lines.length >= maxLines) break;
      current = word.slice(0, maxCharsPerLine);
    } else {
      lines.push(word.slice(0, maxCharsPerLine));
      if (lines.length >= maxLines) break;
      current = '';
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines) {
    const joined = lines.join(' ');
    if (joined.length < words.join(' ').length && !lines[maxLines - 1].endsWith('...')) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(3, maxCharsPerLine - 3)) + '...';
    }
  }
  return lines;
}

export function formatBrlPlain(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 'R$ 0,00';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ');
}

export function buildWhatsAppStatusStorySvg(params: {
  title: string;
  platform?: string;
  originalPrice?: number;
  discountPrice: number;
  discountPercent?: number;
  couponCode?: string;
  themeColor?: string;
  calloutText?: string;
  hasProductPhoto?: boolean;
}): string {
  const theme =
    WHATSAPP_STATUS_THEMES.find(
      (t) => t.id === params.themeColor || t.bgHex.toLowerCase() === String(params.themeColor || '').toLowerCase()
    ) || WHATSAPP_STATUS_THEMES[0];

  const platformLabel = String(params.platform || 'Oferta').trim();
  const discPrice = Number(params.discountPrice) || 0;
  const origPrice = Number(params.originalPrice) || 0;
  const pct =
    Number(params.discountPercent) > 0
      ? Math.round(Number(params.discountPercent))
      : origPrice > discPrice && discPrice > 0
      ? Math.round(((origPrice - discPrice) / origPrice) * 100)
      : 0;
  const hasOriginalStrike = origPrice > discPrice && discPrice > 0;
  const coupon = String(params.couponCode || '').trim().toUpperCase();
  const titleLines = wrapTextLines(params.title || 'Oferta Selecionada', 30, 3);
  const callout =
    String(params.calloutText || '').trim() || 'Link clicável no próximo Status ->';

  const priceBlockTop = 1235;
  const currentPriceY = hasOriginalStrike ? priceBlockTop + 125 : priceBlockTop + 72;
  const couponY = currentPriceY + 90;

  return `<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="${escapeXml(theme.bgHex)}" />
      <stop offset="100%" stop-color="${escapeXml(theme.gradientBottomHex)}" />
    </linearGradient>
    <linearGradient id="ctaGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${escapeXml(theme.accentHex)}" />
      <stop offset="100%" stop-color="#16A34A" />
    </linearGradient>
  </defs>

  <rect width="1080" height="1920" fill="url(#bgGrad)" />

  <!-- Top Store Tag -->
  <rect x="330" y="110" width="420" height="58" rx="14" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)" stroke-width="2" />
  <text x="540" y="148" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="28" font-weight="bold" fill="#FFFFFF">${escapeXml(platformLabel.toUpperCase())}</text>

  <!-- Title Above Product Showcase -->
  ${titleLines
    .map(
      (line, idx) =>
        `<text x="540" y="${238 + idx * 54}" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="42" font-weight="bold" fill="#F8FAFC">${escapeXml(line)}</text>`
    )
    .join('\n  ')}

  <!-- Crisp White Product Showcase Box -->
  <rect x="120" y="400" width="840" height="790" rx="40" fill="#FFFFFF" />
  ${
    !params.hasProductPhoto
      ? `<text x="540" y="805" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="36" fill="#64748B">Foto do Produto</text>`
      : ''
  }

  ${
    pct > 0
      ? `<g>
    <rect x="695" y="432" width="230" height="72" rx="18" fill="#EA580C" />
    <text x="810" y="479" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="36" font-weight="bold" fill="#FFFFFF">${pct}% OFF</text>
  </g>`
      : ''
  }

  <!-- Pricing Block -->
  ${
    hasOriginalStrike
      ? `<text x="540" y="${priceBlockTop + 34}" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="38" fill="#CBD5E1" text-decoration="line-through">De: ${escapeXml(formatBrlPlain(origPrice))}</text>`
      : ''
  }

  <text x="540" y="${currentPriceY}" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="94" font-weight="bold" fill="#4ADE80">Por ${escapeXml(formatBrlPlain(discPrice))}</text>

  ${
    coupon
      ? `<g>
    <rect x="240" y="${couponY - 48}" width="600" height="74" rx="16" fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.28)" stroke-width="2" />
    <text x="540" y="${couponY}" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="34" font-weight="bold" fill="#FEF08A">CUPOM: ${escapeXml(coupon)}</text>
  </g>`
      : ''
  }

  <!-- Bottom Action Strip -->
  <rect x="120" y="1690" width="840" height="104" rx="22" fill="url(#ctaGrad)" />
  <text x="540" y="1754" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="34" font-weight="bold" fill="#FFFFFF">${escapeXml(callout)}</text>
</svg>`;
}

export function buildWhatsAppStatusTexts(params: {
  title: string;
  platform?: string;
  originalPrice?: number;
  discountPrice: number;
  discountPercent?: number;
  couponCode?: string;
  affiliateUrl: string;
}): {
  fullCaption: string;
  shortCalloutCaption: string;
  clickableLinkStatusText: string;
  cardCaption: string;
} {
  const title = String(params.title || 'Oferta Especial').trim();
  const disc = Number(params.discountPrice) || 0;
  const orig = Number(params.originalPrice) || 0;
  const pct =
    Number(params.discountPercent) > 0
      ? Math.round(Number(params.discountPercent))
      : orig > disc && disc > 0
      ? Math.round(((orig - disc) / orig) * 100)
      : 0;
  const coupon = String(params.couponCode || '').trim().toUpperCase();
  const link = String(params.affiliateUrl || '').trim();

  const priceParts: string[] = [];
  if (orig > disc && disc > 0) {
    priceParts.push(`De: ~${formatBrlPlain(orig)}~ ❌`);
  }
  priceParts.push(`*💸 Por: ${formatBrlPlain(disc)} 🔥*${pct > 0 ? ` (${pct}% OFF)` : ''}`);
  if (coupon) {
    priceParts.push(`🎟️ Cupom: *${coupon}*`);
  }

  const fullCaption = shieldWhatsAppCurrencyNumbers(
    [
      `💥 *${title}*`,
      '',
      ...priceParts,
      '',
      `🔗 Compre aqui: ${link}`,
    ].join('\n')
  );

  const shortCalloutCaption = shieldWhatsAppCurrencyNumbers(
    `💥 *${title}*\n💸 *${formatBrlPlain(disc)}* · 👉 Toque no próximo Status para abrir o link!`
  );

  const cardCaption = shieldWhatsAppCurrencyNumbers(
    `💥 ${title}\n\n🔗 Compre aqui: ${link}`
  );

  const clickableLinkStatusText = shieldWhatsAppCurrencyNumbers(
    [
      `💥 ${title}`,
      orig > disc && disc > 0
        ? `De ${formatBrlPlain(orig)} por *${formatBrlPlain(disc)}*${pct > 0 ? ` (${pct}% OFF)` : ''}`
        : `Por apenas *${formatBrlPlain(disc)}*`,
      ...(coupon ? [`Cupom: *${coupon}*`] : []),
      '',
      `🔗 ${link}`,
    ].join('\n')
  );

  return {
    fullCaption,
    shortCalloutCaption,
    clickableLinkStatusText,
    cardCaption,
  };
}

/**
 * Normalizes a list of raw Brazilian phone strings and known WhatsApp JIDs into
 * deduplicated `@s.whatsapp.net` / `@lid` recipient JIDs for `status@broadcast`.
 */
export function normalizeStatusRecipientJids(params: {
  rawPhones?: string[];
  selfJids?: string[];
  extraJids?: string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const pushJid = (raw?: string) => {
    const val = String(raw || '').trim();
    if (!val) return;
    if (val.includes('@')) {
      const [left, domainRaw] = val.split('@');
      const domain = (domainRaw || '').toLowerCase();
      if (domain === 'g.us' || domain === 'broadcast' || domain === 'newsletter') return;
      const cleanUser = left.split(':')[0].trim();
      if (!cleanUser) return;
      const normalized = `${cleanUser}@${domain}`;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
      return;
    }
    let digits = val.replace(/\D/g, '');
    if (digits.length < 10) return;
    if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
      digits = `55${digits}`;
    }
    const normalized = `${digits}@s.whatsapp.net`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  };

  for (const j of params.selfJids || []) pushJid(j);
  for (const p of params.rawPhones || []) pushJid(p);
  for (const j of params.extraJids || []) pushJid(j);

  return out;
}
