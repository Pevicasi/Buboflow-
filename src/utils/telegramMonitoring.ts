export interface TelegramMonitoredPost {
  postId: number;
  channelKey: string;
  text: string;
  urls: string[];
  imageUrl: string | null;
}

export interface TelegramBotIncomingMessage {
  updateId: number;
  chatId: string;
  chatUsername?: string;
  chatTitle?: string;
  messageId: number;
  text: string;
  urls: string[];
}

export function extractPublicTelegramUsername(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // https://t.me/s/username or https://t.me/username or telegram.me/username
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([a-zA-Z][a-zA-Z0-9_]{3,31})(?:[/?#].*)?$/i
  );
  if (urlMatch?.[1]) {
    const slug = urlMatch[1].toLowerCase();
    if (slug === 'joinchat' || slug === 'addlist' || slug === 'share') return null;
    return slug;
  }

  // @username or bare username
  const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(stripped)) {
    return stripped.toLowerCase();
  }

  return null;
}

export function normalizeTelegramMonitoringTarget(raw: string): {
  type: 'public_channel' | 'chat_id';
  remoteJid: string;
  username?: string;
  publicFeedUrl?: string;
} | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^-?\d{5,20}$/.test(trimmed)) {
    return {
      type: 'chat_id',
      remoteJid: trimmed,
    };
  }

  const username = extractPublicTelegramUsername(trimmed);
  if (!username) return null;

  return {
    type: 'public_channel',
    remoteJid: `@${username}`,
    username,
    publicFeedUrl: `https://t.me/s/${username}`,
  };
}

function decodeHtmlEntities(input: string): string {
  return String(input || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    });
}

function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractTelegramPublicChannelTitle(html: string, fallbackUsername: string): string {
  const titleMatch =
    html.match(/class="tgme_channel_info_header_title"[^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
    html.match(/<title>([^<]+)<\/title>/i);

  if (titleMatch?.[1]) {
    const cleaned = stripHtmlToText(titleMatch[1])
      .replace(/\s*[-–—|]\s*Telegram\s*$/i, '')
      .trim();
    if (cleaned) return cleaned;
  }
  return `@${fallbackUsername}`;
}

export function extractTelegramPublicChannelSubscribers(html: string): number {
  const m = html.match(
    /class="tgme_channel_info_counter"[^>]*>[\s\S]*?class="counter_value"[^>]*>([^<]+)<\/span>/i
  );
  if (!m?.[1]) return 0;
  const raw = m[1].trim().replace(/\s+/g, '');
  const mult = /m$/i.test(raw) ? 1_000_000 : /k$/i.test(raw) ? 1_000 : 1;
  const num = parseFloat(raw.replace(/[km]$/i, '').replace(',', '.'));
  return Number.isFinite(num) && num > 0 ? Math.round(num * mult) : 0;
}

export function parseTelegramPublicChannelHtml(
  html: string,
  username: string
): TelegramMonitoredPost[] {
  if (!html || typeof html !== 'string') return [];
  const cleanUser = username.replace(/^@/, '').toLowerCase();
  const blocks = html.split('<div class="tgme_widget_message_wrap');
  const posts: TelegramMonitoredPost[] = [];

  for (let i = 1; i < blocks.length; i += 1) {
    const block = blocks[i];
    const postAttr = block.match(/data-post="([^"]+)"/i)?.[1] || '';
    const postIdMatch = postAttr.match(/\/(\d+)$/);
    if (!postIdMatch?.[1]) continue;
    const postId = Number(postIdMatch[1]);
    if (!Number.isFinite(postId) || postId <= 0) continue;

    // Extract main message text block (avoiding reply preview text when possible)
    const textMatches = Array.from(
      block.matchAll(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)
    );
    const mainTextHtml = textMatches.length > 0 ? textMatches[textMatches.length - 1][1] : '';
    const text = stripHtmlToText(mainTextHtml);

    // Collect URLs from href attributes inside message text & inline keyboard buttons + plain text
    const urlSet = new Set<string>();
    const addUrl = (rawUrl: string) => {
      const decoded = decodeHtmlEntities(rawUrl).trim().replace(/[.,;!?]+$/, '');
      if (!/^https?:\/\//i.test(decoded)) return;
      if (/^https?:\/\/(?:t\.me|telegram\.me)\//i.test(decoded)) return;
      urlSet.add(decoded);
    };

    for (const m of mainTextHtml.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
      addUrl(m[1]);
    }
    for (const m of block.matchAll(
      /class="tgme_widget_message_inline_button[^"]*"[^>]*href="(https?:\/\/[^"]+)"/gi
    )) {
      addUrl(m[1]);
    }
    for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]}]+/gi)) {
      addUrl(m[0]);
    }

    // Extract photo preview URL if present
    const imgMatch = block.match(
      /class="tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\('?(https?:\/\/[^'")]+)'?\)/i
    );
    const imageUrl = imgMatch?.[1] ? decodeHtmlEntities(imgMatch[1]) : null;

    if (!text && urlSet.size === 0) continue;

    posts.push({
      postId,
      channelKey: `@${cleanUser}`,
      text,
      urls: Array.from(urlSet),
      imageUrl,
    });
  }

  posts.sort((a, b) => a.postId - b.postId);
  return posts;
}

export function extractTelegramMonitoringMessagesFromUpdates(
  updates: any[]
): TelegramBotIncomingMessage[] {
  if (!Array.isArray(updates) || updates.length === 0) return [];
  const results: TelegramBotIncomingMessage[] = [];

  for (const u of updates) {
    if (!u || typeof u !== 'object') continue;
    const updateId = Number(u.update_id || 0);
    const msg = u.channel_post || u.message || u.edited_channel_post || u.edited_message;
    if (!msg || !msg.chat || msg.chat.type === 'private') continue;

    const text = String(msg.text || msg.caption || '').trim();
    const entities: any[] = [
      ...(Array.isArray(msg.entities) ? msg.entities : []),
      ...(Array.isArray(msg.caption_entities) ? msg.caption_entities : []),
    ];

    const urlSet = new Set<string>();
    for (const ent of entities) {
      if (ent?.type === 'text_link' && typeof ent.url === 'string' && /^https?:\/\//i.test(ent.url)) {
        urlSet.add(ent.url.trim());
      }
    }
    const inlineRows: any[] = Array.isArray(msg.reply_markup?.inline_keyboard)
      ? msg.reply_markup.inline_keyboard
      : [];
    for (const row of inlineRows) {
      if (!Array.isArray(row)) continue;
      for (const btn of row) {
        if (typeof btn?.url === 'string' && /^https?:\/\//i.test(btn.url)) {
          urlSet.add(btn.url.trim());
        }
      }
    }
    for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]}]+/gi)) {
      urlSet.add(m[0].replace(/[.,;!?]+$/, ''));
    }

    if (!text && urlSet.size === 0) continue;

    results.push({
      updateId,
      chatId: String(msg.chat.id),
      chatUsername: msg.chat.username ? String(msg.chat.username).toLowerCase() : undefined,
      chatTitle: msg.chat.title ? String(msg.chat.title) : undefined,
      messageId: Number(msg.message_id || 0),
      text,
      urls: Array.from(urlSet),
    });
  }

  return results;
}
