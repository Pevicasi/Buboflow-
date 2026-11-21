export interface ExtractedWaMessage {
  text: string;
  urls: string[];
}

export interface CapturedByGroupEntry {
  date: string;
  count: number;
  lastAt: string;
}

/**
 * Returns YYYY-MM-DD in Brazil time (America/Sao_Paulo, UTC-3),
 * preventing daily counters from resetting prematurely at 21:00 BRT (00:00 UTC).
 */
export function getBrazilDateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

/**
 * Recursively unwraps Baileys/WhatsApp container message types so captions,
 * images, buttons, and edited messages are never silently dropped.
 */
export function unwrapWaMessageRecursive(rawMessage: any): any {
  let cur = rawMessage;
  for (let depth = 0; depth < 8 && cur && typeof cur === 'object'; depth += 1) {
    if (cur.ephemeralMessage?.message) {
      cur = cur.ephemeralMessage.message;
      continue;
    }
    if (cur.viewOnceMessage?.message) {
      cur = cur.viewOnceMessage.message;
      continue;
    }
    if (cur.viewOnceMessageV2?.message) {
      cur = cur.viewOnceMessageV2.message;
      continue;
    }
    if (cur.viewOnceMessageV2Extension?.message) {
      cur = cur.viewOnceMessageV2Extension.message;
      continue;
    }
    if (cur.documentWithCaptionMessage?.message) {
      cur = cur.documentWithCaptionMessage.message;
      continue;
    }
    if (cur.editedMessage?.message) {
      cur = cur.editedMessage.message;
      continue;
    }
    if (cur.protocolMessage?.editedMessage) {
      cur = cur.protocolMessage.editedMessage;
      continue;
    }
    if (cur.associatedChildMessage?.message) {
      cur = cur.associatedChildMessage.message;
      continue;
    }
    break;
  }
  return cur || null;
}

function collectUrlsFromString(input: string): string[] {
  if (!input) return [];
  const matches = input.match(/https?:\/\/[^\s<>"')\]}]+/gi) || [];
  return matches.map((u) => u.replace(/[.,;!?]+$/, '')).filter(Boolean);
}

function collectUrlsFromInteractiveButtons(buttons: any[]): string[] {
  const found: string[] = [];
  if (!Array.isArray(buttons)) return found;
  for (const btn of buttons) {
    const rawParams = btn?.buttonParamsJson;
    if (typeof rawParams === 'string' && rawParams.trim()) {
      try {
        const parsed = JSON.parse(rawParams);
        for (const key of ['url', 'merchant_url', 'landing_url', 'webview_url']) {
          if (typeof parsed?.[key] === 'string' && /^https?:\/\//i.test(parsed[key])) {
            found.push(parsed[key].trim());
          }
        }
      } catch {
        found.push(...collectUrlsFromString(rawParams));
      }
    }
    const urlBtn = btn?.urlButton?.url;
    if (typeof urlBtn === 'string' && /^https?:\/\//i.test(urlBtn)) {
      found.push(urlBtn.trim());
    }
  }
  return found;
}

/**
 * Extracts full human-readable message text and all embedded URLs from any
 * WhatsApp message type (plain text, image/video/doc caption, link preview,
 * interactive/template CTA buttons, ephemeral/viewOnce/edited wrappers).
 */
export function extractTextAndUrlsFromWaMessage(msg: any): ExtractedWaMessage {
  const m = unwrapWaMessageRecursive(msg?.message);
  if (!m || typeof m !== 'object') return { text: '', urls: [] };

  const textParts: string[] = [];
  const extraUrls: string[] = [];

  const pushText = (val: unknown) => {
    if (typeof val === 'string' && val.trim()) {
      textParts.push(val.trim());
    }
  };
  const pushUrl = (val: unknown) => {
    if (typeof val === 'string' && /^https?:\/\//i.test(val.trim())) {
      extraUrls.push(val.trim().replace(/[.,;!?]+$/, ''));
    }
  };

  pushText(m.conversation);
  pushText(m.extendedTextMessage?.text);
  pushUrl(m.extendedTextMessage?.matchedText);
  pushUrl(m.extendedTextMessage?.canonicalUrl);

  pushText(m.imageMessage?.caption);
  pushText(m.videoMessage?.caption);
  pushText(m.documentMessage?.caption);

  pushText(m.buttonsMessage?.contentText);
  pushText(m.buttonsMessage?.footerText);
  pushText(m.buttonsResponseMessage?.selectedDisplayText);

  pushText(m.listMessage?.title);
  pushText(m.listMessage?.description);
  pushText(m.listMessage?.footerText);

  const hydrated =
    m.templateMessage?.hydratedTemplate ||
    m.templateMessage?.hydratedFourRowTemplate;
  if (hydrated) {
    pushText(hydrated.hydratedTitleText);
    pushText(hydrated.hydratedContentText);
    pushText(hydrated.hydratedFooterText);
    extraUrls.push(...collectUrlsFromInteractiveButtons(hydrated.hydratedButtons));
  }

  const interactive = m.interactiveMessage;
  if (interactive) {
    pushText(interactive.header?.title);
    pushText(interactive.header?.subtitle);
    pushText(interactive.body?.text);
    pushText(interactive.footer?.text);
    extraUrls.push(
      ...collectUrlsFromInteractiveButtons(interactive.nativeFlowMessage?.buttons)
    );
  }

  const combinedText = textParts.join('\n');
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const u of [...collectUrlsFromString(combinedText), ...extraUrls]) {
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }

  return {
    text: combinedText || urls.join('\n'),
    urls,
  };
}

const NON_OFFER_URL_RE =
  /chat\.whatsapp\.com|wa\.me\/|whatsapp\.com\/channel|t\.me\/|instagram\.com|facebook\.com|fb\.me\/|tiktok\.com|youtube\.com|youtu\.be|twitter\.com|x\.com\/|shopee\.com\.br\/m\/cupom|mercadolivre\.com\.br\/cupons(?:\/|$|\?)/i;

const PRIORITY_MARKETPLACE_URL_RE =
  /(?:meli\.la|mercadolivre\.com|mercadolibre\.com|s\.shopee\.com\.br|shope\.ee|shopee\.com\.br|amzn\.to|amazon\.com\.br|magazineluiza\.com\.br|magalu\.com|divulgador\.magalu\.com|netshoes\.com\.br|aliexpress\.com|s\.click\.aliexpress\.com)/i;

/**
 * Filters out group invites, social links, and generic coupon landing pages,
 * prioritizing known marketplace offer links ahead of generic shorteners.
 */
export function filterOfferCandidateUrls(urls: string[], maxCount = 3): string[] {
  const cleaned = urls
    .map((u) => String(u || '').trim().replace(/[.,;!?]+$/, ''))
    .filter((u) => /^https?:\/\//i.test(u) && !NON_OFFER_URL_RE.test(u));

  const unique = Array.from(new Set(cleaned));
  const priority = unique.filter((u) => PRIORITY_MARKETPLACE_URL_RE.test(u));
  const others = unique.filter((u) => !PRIORITY_MARKETPLACE_URL_RE.test(u));
  return [...priority, ...others].slice(0, Math.max(1, maxCount));
}

/**
 * Reads the canonical Brazil-day capture count for a group JID.
 */
export function getCanonicalCapturedTodayForGroup(
  normalizedJid: string,
  capturedByGroupJid: Record<string, CapturedByGroupEntry> | undefined,
  now: Date = new Date()
): number {
  if (!normalizedJid || !capturedByGroupJid) return 0;
  const entry = capturedByGroupJid[normalizedJid];
  if (!entry) return 0;
  return entry.date === getBrazilDateKey(now) ? Math.max(0, Number(entry.count) || 0) : 0;
}
