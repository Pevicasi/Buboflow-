/**
 * Pure parsing, URL normalization, HTML redirect extraction, and media extraction
 * helpers for the Video Downloader & Automation Group video command.
 *
 * Security notes:
 * - Shortcodes, video IDs, and paths are strictly allowlist-validated before
 *   constructing any downstream extractor URL.
 * - All network requests still pass through `assertSafePublicVideoUrl` and
 *   `fetchPublicVideoWithSafeRedirects` in `server.ts`.
 */

export interface InstagramVideoTarget {
  kind: 'reel' | 'p' | 'tv';
  shortcode: string;
}

export function detectVideoPlatformLabel(rawUrl: string): string {
  const lower = String(rawUrl || '').toLowerCase();
  if (lower.includes('shopee') || lower.includes('sv.shopee') || lower.includes('shp.ee')) {
    return 'Shopee Video';
  }
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return 'YouTube';
  }
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) {
    return 'Instagram Reels';
  }
  if (lower.includes('tiktok.com')) {
    return 'TikTok';
  }
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) {
    return 'Facebook Video';
  }
  if (lower.includes('pinterest.') || lower.includes('pin.it')) {
    return 'Pinterest Video';
  }
  return 'Vídeo';
}

export function decodeHtmlEntities(input: string): string {
  return String(input || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEscapedMediaUrl(raw: string): string {
  return String(raw || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u003F/gi, '?')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim();
}

/**
 * Extracts a strictly validated 11-char YouTube video ID from standard watch,
 * Shorts, youtu.be, live, or embed URLs.
 */
export function parseYouTubeVideoId(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isYouTuBe = host === 'youtu.be' || host.endsWith('.youtu.be');
  const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
  if (!isYouTuBe && !isYouTube) return null;

  let candidate = '';
  if (isYouTuBe) {
    candidate = parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
  } else {
    const vParam = parsed.searchParams.get('v');
    if (vParam) {
      candidate = vParam;
    } else {
      const pathMatch = parsed.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/i);
      if (pathMatch) candidate = pathMatch[1];
    }
  }

  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

/**
 * Extracts a strictly validated Instagram Reel / Post / TV shortcode from a URL.
 */
export function parseInstagramVideoTarget(rawUrl: string): InstagramVideoTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host !== 'instagram.com' &&
    !host.endsWith('.instagram.com') &&
    host !== 'instagr.am' &&
    !host.endsWith('.instagr.am')
  ) {
    return null;
  }

  const match = parsed.pathname.match(/\/(?:[A-Za-z0-9._-]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,40})(?:\/|$)/i);
  if (!match) return null;

  const rawKind = match[1].toLowerCase();
  const shortcode = match[2];
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(shortcode)) return null;

  const kind: 'reel' | 'p' | 'tv' = rawKind === 'p' ? 'p' : rawKind === 'tv' ? 'tv' : 'reel';
  return { kind, shortcode };
}

/**
 * Extracts a safe canonical TikTok pathname (e.g. `/@user/video/1234567890`)
 * from a resolved tiktok.com URL.
 */
export function parseTikTokVideoPath(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'tiktok.com' && !host.endsWith('.tiktok.com')) {
    return null;
  }

  const path = parsed.pathname;
  if (!/^\/(?:@[A-Za-z0-9._-]+\/(?:video|photo)\/\d+|t\/[A-Za-z0-9_-]+|v\/\d+|video\/\d+)\/?$/i.test(path)) {
    return null;
  }
  return path.replace(/\/+$/, '');
}

/**
 * Detects HTML / JavaScript transfer redirects used by shorteners like
 * `br.shp.ee/...` -> `sv.shopee.com.br/share-video/...` (`CONFIG={httpUrl:"..."}`,
 * `navigate_url=...`, `<meta http-equiv="refresh">`, `window.location.replace(...)`).
 */
export function extractHtmlRedirectUrl(html: string, currentUrl: string): string | null {
  const slice = String(html || '').slice(0, 200_000);
  const candidates: string[] = [];

  // 1. Shopee transfer page: var CONFIG={httpUrl:"https:\/\/sv.shopee.com.br\/share-video\/..."}
  const shopeeHttpUrl = slice.match(/\bhttpUrl\s*:\s*["'](https?:[^"']+)["']/i)?.[1];
  if (shopeeHttpUrl) {
    candidates.push(decodeEscapedMediaUrl(shopeeHttpUrl));
  }

  // 2. Shopee deepLinkUrl navigate_url parameter (URL-encoded target)
  const navUrlRaw = slice.match(/navigate_url=(https?%3A%2F%2F[^"'&\s\\]+)/i)?.[1];
  if (navUrlRaw) {
    try {
      candidates.push(decodeURIComponent(navUrlRaw));
    } catch {
      // ignore malformed URI encoding
    }
  }

  // 3. <meta http-equiv="refresh" content="0;url=https://...">
  const metaRefresh =
    slice.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"';\s>]+)/i)?.[1] ||
    slice.match(/<meta[^>]+content=["'][^"']*url=([^"';\s>]+)[^>]+http-equiv=["']?refresh["']?/i)?.[1];
  if (metaRefresh) {
    candidates.push(decodeHtmlEntities(metaRefresh));
  }

  // 4. Direct JS redirect patterns (window.location.replace("https://...") or location.href="https://...")
  const jsLoc =
    slice.match(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:[^"']+)["']/i)?.[1] ||
    slice.match(/(?:window\.)?location\.replace\(\s*["'](https?:[^"']+)["']\s*\)/i)?.[1];
  if (jsLoc) {
    candidates.push(decodeEscapedMediaUrl(jsLoc));
  }

  const normalizedCurrent = currentUrl.trim();
  for (const raw of candidates) {
    try {
      const resolved = new URL(raw, currentUrl).toString();
      if (
        /^https?:\/\//i.test(resolved) &&
        resolved !== normalizedCurrent &&
        resolved.split('#')[0] !== normalizedCurrent.split('#')[0]
      ) {
        return resolved;
      }
    } catch {
      // skip invalid candidate
    }
  }
  return null;
}

/**
 * Extracts direct Pinterest MP4 URLs and derives fallback `/720p/*.mp4`
 * candidates from Pinterest HLS `.m3u8` URLs.
 */
export function derivePinterestMp4CandidatesFromHtml(html: string): string[] {
  const slice = String(html || '').slice(0, 900_000);
  const found: string[] = [];
  const pushUnique = (u: string | undefined) => {
    if (!u) return;
    const clean = decodeEscapedMediaUrl(u);
    if (/^https?:\/\//i.test(clean) && !found.includes(clean)) {
      found.push(clean);
    }
  };

  for (const key of ['V_720P', 'V_EXP7', 'V_480P', 'V_EXP6', 'V_EXP5']) {
    const rx = new RegExp(`"${key}"\\s*:\\s*\\{[^}]*"url"\\s*:\\s*"(https?:[^"]+\\.mp4[^"]*)"`, 'i');
    pushUnique(slice.match(rx)?.[1]);
  }

  const directMatches = slice.match(/https?:\\?\/\\?\/v\d*\.pinimg\.com\/videos\/[^"'\\\s<>]+\.mp4(?:\?[^"'\\\s<>]*)?/gi) || [];
  for (const m of directMatches) {
    pushUnique(m);
  }

  const hlsMatches = slice.match(/https?:\\?\/\\?\/v\d*\.pinimg\.com\/videos\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/gi) || [];
  for (const rawHls of hlsMatches) {
    const hls = decodeEscapedMediaUrl(rawHls);
    // Pinterest CDN typically mirrors /iht/hls/.../*.m3u8 as /mc/720p/.../*.mp4 or /720p/.../*.mp4
    if (/\/hls\//i.test(hls)) {
      pushUnique(hls.replace(/\/iht\/hls\//i, '/mc/720p/').replace(/\.m3u8(?:\?.*)?$/i, '.mp4'));
      pushUnique(hls.replace(/\/hls\//i, '/720p/').replace(/\.m3u8(?:\?.*)?$/i, '.mp4'));
      pushUnique(hls.replace(/\/iht\/hls\//i, '/mc/expMp4/').replace(/\.m3u8(?:\?.*)?$/i, '_t4.mp4'));
    }
  }

  return found;
}

export function pickBestCliptoMp4(
  medias: unknown,
  options?: { requireAudio?: boolean }
): { url: string; quality?: string; sizeBytes?: number | null } | null {
  if (!Array.isArray(medias) || medias.length === 0) return null;
  const requireAudio = options?.requireAudio === true;

  const valid = medias.filter((item: any) => {
    if (!item || typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) return false;
    const ext = String(item.extension || '').toLowerCase();
    const mime = String(item.mimeType || '').toLowerCase();
    const type = String(item.type || '').toLowerCase();
    const isMp4 = ext === 'mp4' || mime.includes('video/mp4') || (!ext && type === 'video');
    if (!isMp4 || type === 'audio' || type === 'image') return false;
    if (requireAudio) {
      if (item.is_audio === false || item.audioAvailable === false) return false;
    }
    return true;
  });

  if (valid.length === 0) return null;

  const score = (item: any): number => {
    let s = 0;
    const q = String(item.quality || item.qualityLabel || '').toLowerCase();
    if (item.is_audio === true || item.audioAvailable === true || item.audioQuality) s += 1000;
    if (q.includes('hd') || q.includes('1080')) s += 500;
    else if (q.includes('720')) s += 400;
    else if (q.includes('480')) s += 300;
    else if (q.includes('360')) s += 200;
    else if (q.includes('sd')) s += 150;
    const h = Number(item.height || 0);
    if (Number.isFinite(h) && h > 0) s += Math.min(h, 1080) / 4;
    return s;
  };

  valid.sort((a, b) => score(b) - score(a));
  const best = valid[0];
  const sizeNum = Number(best.contentLength || best.size || 0);
  return {
    url: best.url,
    quality: typeof best.quality === 'string' ? best.quality : undefined,
    sizeBytes: Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : null,
  };
}

export function extractMediaFromHtml(
  html: string,
  baseUrl?: string
): {
  title: string;
  thumbnailUrl: string | null;
  directMp4Url: string | null;
  streamPathUrl: string | null;
} {
  const slice = String(html || '').slice(0, 600_000);

  const rawTitle =
    slice.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    slice.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
    slice.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    slice.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
    '';
  const title = decodeHtmlEntities(rawTitle).slice(0, 140);

  const rawImage =
    slice.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    slice.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i)?.[1] ||
    '';
  const decodedImg = decodeEscapedMediaUrl(rawImage);
  const thumbnailUrl = /^https?:\/\//i.test(decodedImg) ? decodedImg : null;

  const mp4Patterns: RegExp[] = [
    /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["'](https?:[^"']+)["']/i,
    /<meta[^>]+content=["'](https?:[^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["'](https?:[^"']+)["']/i,
    /<meta[^>]+content=["'](https?:[^"']+)["'][^>]+name=["']twitter:player:stream["']/i,
    /"(?:watermark_free_url|no_watermark_url|playable_url_quality_hd|browser_native_hd_url|browser_native_sd_url|hd_src_no_ratelimit|hd_src|sd_src_no_ratelimit|sd_src|playable_url|downloadAddr|playAddr|video_url|play_url|mp4Url|contentUrl)"\s*:\s*"(https?:[^"\\]+(?:\\\/[^"\\]+)*)"/i,
    /"V_720P"\s*:\s*\{[^}]*"url"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/i,
    /(https?:\/\/v\d*\.pinimg\.com\/videos\/mc\/[^"'\\\s<>]+\.mp4(?:\?[^"'\\\s<>]*)?)/i,
    /(https?:\/\/[^"'\\\s<>]+\.mp4(?:\?[^"'\\\s<>]*)?)/i,
  ];

  let directMp4Url: string | null = null;
  for (const rx of mp4Patterns) {
    const m = slice.match(rx)?.[1];
    if (m) {
      const candidate = decodeEscapedMediaUrl(m);
      if (/^https?:\/\//i.test(candidate) && !candidate.includes('blank.mp4')) {
        directMp4Url = candidate;
        break;
      }
    }
  }

  let streamPathUrl: string | null = null;
  const relStream =
    slice.match(/<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["'](\/[^"']+)["']/i)?.[1] ||
    slice.match(/<meta[^>]+content=["'](\/[^"']+)["'][^>]+name=["']twitter:player:stream["']/i)?.[1];
  if (relStream && baseUrl) {
    try {
      const resolved = new URL(decodeEscapedMediaUrl(relStream), baseUrl).toString();
      if (/^https?:\/\//i.test(resolved)) {
        streamPathUrl = resolved;
      }
    } catch {
      // ignore invalid relative URL
    }
  }

  return {
    title,
    thumbnailUrl,
    directMp4Url,
    streamPathUrl,
  };
}
