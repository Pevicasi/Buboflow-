import net from 'node:net';
import dns from 'node:dns/promises';

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = String(ip || '').trim().toLowerCase();
  if (!clean) return true;

  // Handle IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
  if (clean.startsWith('::ffff:')) {
    const mapped = clean.slice(7);
    if (net.isIPv4(mapped)) {
      return isPrivateOrReservedIp(mapped);
    }
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // ULA fc00::/7
    if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
      return true; // link-local fe80::/10
    }
    if (clean.startsWith('ff')) return true; // multicast
    return false;
  }

  return true;
}

export function validatePublicVideoUrlSyntax(rawUrl: string): {
  ok: boolean;
  url?: URL;
  error?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return { ok: false, error: 'URL de vídeo inválida. Informe um link completo com https://.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Apenas links http:// ou https:// são permitidos.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URLs com credenciais embutidas não são permitidas.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return { ok: false, error: 'Endereço interno ou local não é permitido.' };
  }

  if (net.isIP(host) && isPrivateOrReservedIp(host)) {
    return { ok: false, error: 'Endereço IP privado ou reservado não é permitido.' };
  }

  return { ok: true, url: parsed };
}

/**
 * Validates URL syntax AND resolves DNS records to block private/loopback/metadata IPs.
 */
export async function assertSafePublicVideoUrl(rawUrl: string): Promise<URL> {
  const syntax = validatePublicVideoUrlSyntax(rawUrl);
  if (!syntax.ok || !syntax.url) {
    throw new Error(syntax.error || 'URL inválida.');
  }

  const host = syntax.url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!net.isIP(host)) {
    let records: { address: string }[];
    try {
      records = await dns.lookup(host, { all: true });
    } catch {
      throw new Error('Não foi possível resolver o domínio do vídeo informado.');
    }
    if (!records || records.length === 0) {
      throw new Error('Domínio do vídeo sem endereço público válido.');
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new Error('Destino bloqueado por apontar para endereço de rede privado.');
      }
    }
  }

  return syntax.url;
}

/**
 * Fetches a public video URL following up to `maxRedirects` hops while validating
 * EVERY redirect target against SSRF / private IP rules.
 */
export async function fetchPublicVideoWithSafeRedirects(
  rawUrl: string,
  options?: {
    timeoutMs?: number;
    maxRedirects?: number;
    headers?: Record<string, string>;
  }
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options?.maxRedirects ?? 5;
  const timeoutMs = options?.timeoutMs ?? 12_000;
  let currentUrl = (await assertSafePublicVideoUrl(rawUrl)).toString();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: options?.headers,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return { response: res, finalUrl: currentUrl };
      }
      const nextResolved = new URL(location, currentUrl).toString();
      currentUrl = (await assertSafePublicVideoUrl(nextResolved)).toString();
      continue;
    }

    return { response: res, finalUrl: currentUrl };
  }

  throw new Error('Muitos redirecionamentos ao acessar o link do vídeo.');
}

export function sanitizeDownloadFilename(rawName: string | undefined, fallback: string = 'video-buboflow.mp4'): string {
  const base = String(rawName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.{2,}/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  if (!base) return fallback;
  return /\.(mp4|webm|mov)$/i.test(base) ? base : `${base}.mp4`;
}
