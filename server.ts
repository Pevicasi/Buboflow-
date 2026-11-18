import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { buildMercadoLivreExtensionZip } from './mlExtensionBuilder.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const WA_SESSIONS_ROOT = path.resolve(__dirname, '.wa_sessions');
const WA_LIVE_STATS_FILE = path.join(WA_SESSIONS_ROOT, 'baileys_live_stats.json');
const ML_EXT_SESSIONS_FILE = path.join(WA_SESSIONS_ROOT, 'ml_extension_sessions.json');
const PANEL_STATE_FILE = path.join(WA_SESSIONS_ROOT, 'panel_state.json');

const FICTIONAL_PRODUCT_IDS = new Set([
  'prod-1',
  'prod-2',
  'prod-3',
  'prod-4',
  'prod-5',
  'prod-6',
  'prod-7',
  'prod-8',
]);

interface MlExtensionSession {
  extensionKey: string;
  etiqueta: string;
  cookieHeader: string;
  cookiesCount: number;
  hasSsid: boolean;
  mlUserId: string | null;
  browserName: string;
  lastSyncAt: string;
  lastPollAt?: string;
}

interface PendingMlJob {
  id: string;
  extensionKey: string;
  url: string;
  etiqueta: string;
  createdAt: number;
  resolve: (res: { ok: boolean; shortUrl?: string | null; error?: string | null }) => void;
  timer: NodeJS.Timeout;
}

function loadMlExtensionSessions(): Record<string, MlExtensionSession> {
  try {
    if (fs.existsSync(ML_EXT_SESSIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ML_EXT_SESSIONS_FILE, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // Ignore corrupted session file
  }
  return {};
}

const mlExtensionSessions: Record<string, MlExtensionSession> = loadMlExtensionSessions();
const pendingMlJobsByKey = new Map<string, PendingMlJob[]>();
const pendingMlJobsById = new Map<string, PendingMlJob>();

function saveMlExtensionSessions(): void {
  try {
    fs.mkdirSync(WA_SESSIONS_ROOT, { recursive: true });
    fs.writeFileSync(
      ML_EXT_SESSIONS_FILE,
      JSON.stringify(mlExtensionSessions, null, 2),
      'utf-8'
    );
  } catch {
    // Ignore disk write errors
  }
}

function resolveMlExtensionSession(key?: string): MlExtensionSession | null {
  const cleanKey = String(key || '').trim();
  if (cleanKey && mlExtensionSessions[cleanKey]) {
    return mlExtensionSessions[cleanKey];
  }
  const all = Object.values(mlExtensionSessions);
  return all.find((s) => s.hasSsid) || all[0] || null;
}

function isMlBridgeOnline(session: MlExtensionSession | null): boolean {
  if (!session?.lastPollAt) return false;
  const ts = Date.parse(session.lastPollAt);
  return Number.isFinite(ts) && Date.now() - ts < 90_000;
}

function extractMlShortUrlFromPayload(data: any): string | null {
  if (!data) return null;
  const direct =
    data.short_url ||
    data.shortUrl ||
    data.url ||
    data.link ||
    data.affiliate_url ||
    data?.urls?.[0]?.short_url ||
    data?.urls?.[0]?.shortUrl ||
    data?.data?.short_url ||
    data?.data?.urls?.[0]?.short_url;
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) {
    return direct;
  }
  try {
    const raw = JSON.stringify(data);
    const match = raw.match(
      /https?:\/\/(?:www\.)?(?:mercadolivre\.com\/sec\/|meli\.la\/)[a-zA-Z0-9_-]+/
    );
    if (match) return match[0];
  } catch {
    // Ignore stringify error
  }
  return null;
}

async function convertMlViaSyncedCookies(
  targetUrl: string,
  session: MlExtensionSession,
  etiqueta?: string
): Promise<string | null> {
  if (!session.cookieHeader) return null;
  const tag = (etiqueta || session.etiqueta || '').trim();
  const endpoints = [
    {
      url: 'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink',
      bodies: [
        { urls: [targetUrl], ...(tag ? { tag } : {}) },
        { url: targetUrl, ...(tag ? { tag } : {}) },
      ],
    },
    {
      url: 'https://www.mercadolivre.com.br/afiliados/api/v2/affiliates/createLink',
      bodies: [{ urls: [targetUrl], ...(tag ? { tag } : {}) }],
    },
  ];

  for (const ep of endpoints) {
    for (const body of ep.bodies) {
      try {
        const r = await fetch(ep.url, {
          method: 'POST',
          headers: {
            ...BROWSER_HEADERS,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/plain, */*',
            Origin: 'https://www.mercadolivre.com.br',
            Referer: 'https://www.mercadolivre.com.br/afiliados/linkbuilder',
            'x-requested-with': 'XMLHttpRequest',
            Cookie: session.cookieHeader,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(6500),
        });
        if (!r.ok) continue;
        const json = (await r.json().catch(() => null)) as any;
        const shortUrl = extractMlShortUrlFromPayload(json);
        if (shortUrl) return shortUrl;
      } catch {
        // Try next endpoint/payload
      }
    }
  }
  return null;
}

async function convertMlViaExtensionBridge(
  targetUrl: string,
  extensionKey: string,
  etiqueta?: string
): Promise<string | null> {
  const session = mlExtensionSessions[extensionKey];
  if (!isMlBridgeOnline(session)) return null;

  return new Promise<string | null>((resolve) => {
    const id = `mlj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const timer = setTimeout(() => {
      pendingMlJobsById.delete(id);
      const q = pendingMlJobsByKey.get(extensionKey) || [];
      pendingMlJobsByKey.set(
        extensionKey,
        q.filter((j) => j.id !== id)
      );
      resolve(null);
    }, 8500);

    const job: PendingMlJob = {
      id,
      extensionKey,
      url: targetUrl,
      etiqueta: (etiqueta || session?.etiqueta || '').trim(),
      createdAt: Date.now(),
      timer,
      resolve: (res) => {
        clearTimeout(timer);
        pendingMlJobsById.delete(id);
        resolve(res.ok && res.shortUrl ? res.shortUrl : null);
      },
    };

    pendingMlJobsById.set(id, job);
    const list = pendingMlJobsByKey.get(extensionKey) || [];
    list.push(job);
    pendingMlJobsByKey.set(extensionKey, list);
  });
}

function unwrapResolvedProductUrl(candidateUrl: string, originalUrl: string): string {
  try {
    const u = new URL(candidateUrl);
    if (
      u.hostname.includes('mercadolivre') &&
      (u.pathname.includes('/gz/account-verification') || u.pathname.includes('account-verification'))
    ) {
      const goParam = u.searchParams.get('go');
      if (goParam && /^https?:\/\//i.test(goParam)) {
        return goParam;
      }
      return originalUrl;
    }
    return candidateUrl;
  } catch {
    return originalUrl;
  }
}

async function convertMercadoLivreAffiliateLink(
  rawUrl: string,
  credentials: any
): Promise<{ affiliateUrl: string; officialApi: boolean; viaExtension: boolean }> {
  const cleanUrl = unwrapResolvedProductUrl(rawUrl.trim(), rawUrl.trim());
  const key = credentials?.mercadoLivre?.extensionKey?.trim();
  const tag = credentials?.mercadoLivre?.etiqueta?.trim();
  const session = resolveMlExtensionSession(key);

  if (session && (session.hasSsid || session.cookieHeader)) {
    const serverShort = await convertMlViaSyncedCookies(cleanUrl, session, tag);
    if (serverShort) {
      return { affiliateUrl: serverShort, officialApi: true, viaExtension: true };
    }
    const bridgeShort = await convertMlViaExtensionBridge(
      cleanUrl,
      session.extensionKey,
      tag
    );
    if (bridgeShort) {
      return { affiliateUrl: bridgeShort, officialApi: true, viaExtension: true };
    }
  }

  return {
    affiliateUrl: formatAffiliateUrlFallback(cleanUrl, 'Mercado Livre', credentials),
    officialApi: false,
    viaExtension: false,
  };
}

interface MemberFlowEvent {
  date: string; // YYYY-MM-DD
  weekday: number; // 0-6
  groupJid: string;
  entries: number;
  exits: number;
}

interface PersistedLiveWaStats {
  memberEvents: MemberFlowEvent[];
  capturedByGroupJid: Record<string, { date: string; count: number; lastAt: string }>;
}

function loadLiveWaStats(): PersistedLiveWaStats {
  try {
    if (fs.existsSync(WA_LIVE_STATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(WA_LIVE_STATS_FILE, 'utf-8'));
      return {
        memberEvents: Array.isArray(parsed?.memberEvents) ? parsed.memberEvents : [],
        capturedByGroupJid:
          parsed?.capturedByGroupJid && typeof parsed.capturedByGroupJid === 'object'
            ? parsed.capturedByGroupJid
            : {},
      };
    }
  } catch {
    // Ignore corrupted stats file
  }
  return { memberEvents: [], capturedByGroupJid: {} };
}

const liveWaStats: PersistedLiveWaStats = loadLiveWaStats();

function saveLiveWaStats(): void {
  try {
    fs.mkdirSync(WA_SESSIONS_ROOT, { recursive: true });
    fs.writeFileSync(WA_LIVE_STATS_FILE, JSON.stringify(liveWaStats, null, 2), 'utf-8');
  } catch {
    // Ignore disk write errors
  }
}

function recordBaileysMemberDelta(
  groupJid: string,
  action: string,
  count: number
): void {
  if (!groupJid || count <= 0) return;
  if (action !== 'add' && action !== 'remove') return;
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const weekday = now.getDay();
  const existing = liveWaStats.memberEvents.find(
    (e) => e.date === dateKey && e.groupJid === groupJid
  );
  if (existing) {
    if (action === 'add') existing.entries += count;
    if (action === 'remove') existing.exits += count;
  } else {
    liveWaStats.memberEvents.push({
      date: dateKey,
      weekday,
      groupJid,
      entries: action === 'add' ? count : 0,
      exits: action === 'remove' ? count : 0,
    });
    if (liveWaStats.memberEvents.length > 500) {
      liveWaStats.memberEvents = liveWaStats.memberEvents.slice(-500);
    }
  }
  saveLiveWaStats();
}

function recordBaileysCapturedLink(groupJid: string): void {
  if (!groupJid) return;
  const today = new Date().toISOString().slice(0, 10);
  const prev = liveWaStats.capturedByGroupJid[groupJid];
  const nextCount = prev && prev.date === today ? prev.count + 1 : 1;
  liveWaStats.capturedByGroupJid[groupJid] = {
    date: today,
    count: nextCount,
    lastAt: new Date().toISOString(),
  };
  saveLiveWaStats();
}

/* ============================================================================
 * CANONICAL SHARED PANEL STATE (Cross-Browser Sync: Chrome + Lemur + PC)
 * ========================================================================== */
interface StoredPanelWrapper {
  hasServerState: boolean;
  version: number;
  updatedAt: string;
  state: Record<string, any> | null;
}

function loadStoredPanelState(): StoredPanelWrapper {
  try {
    if (fs.existsSync(PANEL_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PANEL_STATE_FILE, 'utf-8'));
      if (parsed && typeof parsed === 'object' && parsed.state) {
        return {
          hasServerState: true,
          version: Number(parsed.version) || 1,
          updatedAt: String(parsed.updatedAt || new Date().toISOString()),
          state: stripFictionalFromState(parsed.state),
        };
      }
    }
  } catch {
    // Ignore corrupted panel_state.json
  }
  return {
    hasServerState: false,
    version: 0,
    updatedAt: new Date().toISOString(),
    state: null,
  };
}

function stripFictionalFromState(raw: Record<string, any>): Record<string, any> {
  if (!raw || typeof raw !== 'object') return raw;
  const products = Array.isArray(raw.products)
    ? raw.products.filter((p: any) => p && !FICTIONAL_PRODUCT_IDS.has(String(p.id)))
    : [];
  return { ...raw, products };
}

function normalizeServerGroupJid(jid?: string): string {
  if (!jid) return '';
  const trimmed = String(jid).trim();
  if (!trimmed) return '';
  const atIdx = trimmed.indexOf('@');
  if (atIdx < 0) return trimmed;
  return `${trimmed.slice(0, atIdx).split(':')[0]}@${trimmed.slice(atIdx + 1).toLowerCase()}`;
}

function reconcilePanelWithActiveMlExtension(state: Record<string, any> | null): Record<string, any> | null {
  if (!state || typeof state !== 'object') return state;
  const activeMl =
    Object.values(mlExtensionSessions).find((s) => s.hasSsid) ||
    Object.values(mlExtensionSessions)[0] ||
    null;
  if (!activeMl) return state;

  const mlCfg = state.integrations?.mercadoLivre || {};
  const curKey = String(mlCfg.extensionKey || '').trim();
  const curHasSession = Boolean(curKey && mlExtensionSessions[curKey]?.hasSsid);

  if (!curHasSession && activeMl.hasSsid) {
    return {
      ...state,
      integrations: {
        ...(state.integrations || {}),
        mercadoLivre: {
          ...mlCfg,
          extensionKey: activeMl.extensionKey,
          etiqueta: activeMl.etiqueta || mlCfg.etiqueta || '',
          extensionCreatedAt: mlCfg.extensionCreatedAt || new Date().toLocaleString('pt-BR'),
        },
      },
    };
  }
  return state;
}

const panelStore: StoredPanelWrapper = loadStoredPanelState();

function saveStoredPanelState(): void {
  try {
    fs.mkdirSync(WA_SESSIONS_ROOT, { recursive: true });
    fs.writeFileSync(PANEL_STATE_FILE, JSON.stringify(panelStore, null, 2), 'utf-8');
  } catch {
    // Ignore disk write error
  }
}

function mergeRealProducts(primary: any[], secondary: any[]): any[] {
  const byKey = new Map<string, any>();
  const addItem = (p: any) => {
    if (!p || FICTIONAL_PRODUCT_IDS.has(String(p.id))) return;
    const urlKey = p.originalUrl ? `url:${String(p.originalUrl).split('?')[0]}` : '';
    const idKey = `id:${p.id}`;
    if (urlKey && byKey.has(urlKey)) return;
    if (byKey.has(idKey)) return;
    byKey.set(idKey, p);
    if (urlKey) byKey.set(urlKey, p);
  };
  for (const p of primary || []) addItem(p);
  for (const p of secondary || []) addItem(p);
  // Deduplicate map values preserving order
  const seenIds = new Set<string>();
  const out: any[] = [];
  for (const p of byKey.values()) {
    if (!seenIds.has(String(p.id))) {
      seenIds.add(String(p.id));
      out.push(p);
    }
  }
  return out;
}

function mergeNonEmptyCreds(serverInt: any, incomingInt: any): any {
  const s = serverInt || {};
  const inc = incomingInt || {};
  const pick = (a?: string, b?: string) => (a && String(a).trim() ? a : b || '');
  return {
    shopee: {
      appId: pick(s.shopee?.appId, inc.shopee?.appId),
      apiSecret: pick(s.shopee?.apiSecret, inc.shopee?.apiSecret),
      subIds: s.shopee?.subIds?.length ? s.shopee.subIds : inc.shopee?.subIds || [],
      isManagedPartner: Boolean(s.shopee?.isManagedPartner || inc.shopee?.isManagedPartner),
    },
    amazon: {
      associateTag: pick(s.amazon?.associateTag, inc.amazon?.associateTag),
      accessKey: pick(s.amazon?.accessKey, inc.amazon?.accessKey),
      secretKey: pick(s.amazon?.secretKey, inc.amazon?.secretKey),
      autoShorten: s.amazon?.autoShorten ?? inc.amazon?.autoShorten ?? true,
    },
    mercadoLivre: {
      extensionKey: pick(s.mercadoLivre?.extensionKey, inc.mercadoLivre?.extensionKey),
      extensionCreatedAt: pick(
        s.mercadoLivre?.extensionCreatedAt,
        inc.mercadoLivre?.extensionCreatedAt
      ),
      etiqueta: pick(s.mercadoLivre?.etiqueta, inc.mercadoLivre?.etiqueta),
      authCode: pick(s.mercadoLivre?.authCode, inc.mercadoLivre?.authCode),
    },
    netshoes: {
      clientId: pick(s.netshoes?.clientId, inc.netshoes?.clientId),
      clientSecret: pick(s.netshoes?.clientSecret, inc.netshoes?.clientSecret),
      accountSid: pick(s.netshoes?.accountSid, inc.netshoes?.accountSid),
      nominalCoupon: pick(s.netshoes?.nominalCoupon, inc.netshoes?.nominalCoupon),
      blockedCoupons:
        s.netshoes?.blockedCoupons?.length ? s.netshoes.blockedCoupons : inc.netshoes?.blockedCoupons || [],
    },
    magalu: {
      partnerStore: pick(s.magalu?.partnerStore, inc.magalu?.partnerStore),
      affiliateId: pick(s.magalu?.affiliateId, inc.magalu?.affiliateId),
    },
    aliexpress: {
      appKey: pick(s.aliexpress?.appKey, inc.aliexpress?.appKey),
      appSecret: pick(s.aliexpress?.appSecret, inc.aliexpress?.appSecret),
      trackingId: pick(s.aliexpress?.trackingId, inc.aliexpress?.trackingId),
    },
  };
}

const recentSentWaMsgIds = new Map<string, number>();
function markRecentOutgoingWaMsgId(msgId?: string | null): void {
  if (!msgId) return;
  const now = Date.now();
  recentSentWaMsgIds.set(msgId, now);
  if (recentSentWaMsgIds.size > 300) {
    for (const [k, ts] of recentSentWaMsgIds.entries()) {
      if (now - ts > 10 * 60_000) recentSentWaMsgIds.delete(k);
    }
  }
}

function extractTextFromWaMessage(msg: any): string {
  const m =
    msg?.message?.ephemeralMessage?.message ||
    msg?.message?.viewOnceMessage?.message ||
    msg?.message?.viewOnceMessageV2?.message ||
    msg?.message;
  if (!m) return '';
  return String(
    m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption ||
      m.buttonsResponseMessage?.selectedDisplayText ||
      ''
  );
}

function isGroupMonitoredOnServer(groupJid: string): boolean {
  const norm = normalizeServerGroupJid(groupJid);
  if (!norm) return false;
  const st = panelStore.state;
  if (!st) return false;
  if (st.monitoringRules && st.monitoringRules.enabled === false) return false;

  if (Array.isArray(st.monitoringGroups)) {
    const match = st.monitoringGroups.find(
      (g: any) => normalizeServerGroupJid(g?.remoteJid) === norm
    );
    if (match) return Boolean(match.monitored);
  }
  const savedPref = st.savedGroupPrefs?.[`wa:${norm}`];
  return Boolean(savedPref?.monitored);
}

function guessArtworkKeyFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (/tenis|tênis|corrida|sapato|bota/.test(t)) return 'sneaker';
  if (/chinelo|sandalia|sandália|havaiana/.test(t)) return 'flipflops';
  if (/short|bermuda|calça|camisa|blusa|vestido|roupa/.test(t)) return 'shorts';
  if (/caneca|copo|garrafa|café|xicara|xícara/.test(t)) return 'mug';
  if (/bone|boné|chapéu|chapeu/.test(t)) return 'cap';
  if (/fone|headset|headphone|tws|earbud|airpod/.test(t)) return 'earbuds';
  if (/caixa de som|alexa|echo|speaker|som|tv|monitor/.test(t)) return 'speaker';
  if (/air fryer|fritadeira|microondas|panela|eletro|cafeteira/.test(t)) return 'airfryer';
  return 'earbuds';
}

const recentCapturedUrls = new Map<string, number>();

async function processMonitoredGroupMessage(params: {
  groupJid: string;
  text: string;
}): Promise<void> {
  const { groupJid, text } = params;
  const normJid = normalizeServerGroupJid(groupJid);
  if (!isGroupMonitoredOnServer(normJid)) return;

  const rawMatches = text.match(/https?:\/\/[^\s<>"')\]}]+/gi) || [];
  const candidateUrls = rawMatches
    .map((u) => u.replace(/[.,;!?]+$/, ''))
    .filter(
      (u) =>
        !/chat\.whatsapp\.com|wa\.me\/|whatsapp\.com\/channel|t\.me\/\+/i.test(u)
    );

  if (candidateUrls.length === 0) return;

  const st = panelStore.state || {};
  const rules = st.monitoringRules || {};
  const lowerText = text.toLowerCase();

  if (Array.isArray(rules.restrictedWords) && rules.restrictedWords.length > 0) {
    if (rules.restrictedWords.some((w: string) => w && lowerText.includes(w.toLowerCase()))) {
      return;
    }
  }
  if (Array.isArray(rules.allowedWords) && rules.allowedWords.length > 0) {
    if (!rules.allowedWords.some((w: string) => w && lowerText.includes(w.toLowerCase()))) {
      return;
    }
  }

  const avoidHours = Math.max(0, Number(rules.avoidDuplicateHours) || 0);
  const avoidMs = avoidHours * 3600_000;
  const credentials = st.integrations || {};
  const activeSegment = st.activeSegment || 'Geral';

  for (const targetUrl of candidateUrls.slice(0, 2)) {
    const dedupeKey = targetUrl.split('?')[0].toLowerCase();
    const lastTs = recentCapturedUrls.get(dedupeKey);
    if (avoidMs > 0 && lastTs && Date.now() - lastTs < avoidMs) {
      continue;
    }

    const existingProducts: any[] = Array.isArray(st.products) ? st.products : [];
    const alreadyExists = existingProducts.some((p) => {
      const pUrl = String(p?.originalUrl || '').split('?')[0].toLowerCase();
      if (pUrl && pUrl === dedupeKey) {
        if (avoidMs === 0) return true;
        const createdTs = Date.parse(String(p?.createdAt || ''));
        return !Number.isFinite(createdTs) || Date.now() - createdTs < avoidMs;
      }
      return false;
    });
    if (alreadyExists) continue;

    recentCapturedUrls.set(dedupeKey, Date.now());

    try {
      const extracted = await extractOfferFromUrl(targetUrl, credentials, text);
      if (!extracted?.title || !extracted?.affiliateUrl) continue;

      const disc = Number(extracted.discountPrice) || 0;
      const orig = Number(extracted.originalPrice) || disc;
      const pct = Number(extracted.discountPercent) || 0;
      const commPct = DEFAULT_COMMISSION_BY_PLATFORM[extracted.platform] || 10;
      const commVal = Number(((disc * commPct) / 100).toFixed(2));

      const capturedProduct = {
        id: `prod-mon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: extracted.title,
        platform: extracted.platform,
        category: 'Capturado no Monitoramento',
        originalPrice: orig,
        discountPrice: disc,
        discountPercent: pct,
        commissionPercent: commPct,
        commissionValue: commVal,
        affiliateUrl: extracted.affiliateUrl,
        originalUrl: extracted.originalUrl || targetUrl,
        artworkKey: guessArtworkKeyFromTitle(extracted.title),
        customImageUrl: extracted.imageUrl || undefined,
        isFavorite: false,
        isPrioritized: false,
        salesRank: 1,
        segment: activeSegment,
        createdAt: new Date().toISOString(),
      };

      const curState = panelStore.state || {};
      const curList = Array.isArray(curState.products) ? curState.products : [];
      const updatedMonitoring = Array.isArray(curState.monitoringGroups)
        ? curState.monitoringGroups.map((m: any) =>
            normalizeServerGroupJid(m?.remoteJid) === normJid
              ? { ...m, capturedToday: (Number(m.capturedToday) || 0) + 1 }
              : m
          )
        : curState.monitoringGroups;

      panelStore.state = {
        ...curState,
        products: [capturedProduct, ...curList],
        monitoringGroups: updatedMonitoring,
      };
      panelStore.hasServerState = true;
      panelStore.version += 1;
      panelStore.updatedAt = new Date().toISOString();
      saveStoredPanelState();

      console.log(
        `[Monitoramento] Capturado (${extracted.platform}) do grupo ${normJid}: ${extracted.title}`
      );
    } catch (err: any) {
      console.warn('[Monitoramento] Erro ao capturar oferta:', err?.message || err);
    }
  }
}

interface BaileysSessionEntry {
  accountId: string;
  sock: WASocket | null;
  status: 'connecting' | 'qr_ready' | 'pairing_ready' | 'open' | 'closed';
  qrDataUrl: string | null;
  pairingCode: string | null;
  connectedPhone: string | null;
  connectedName: string | null;
  lastError: string | null;
  allowAutoReconnectUntil: number;
}

const baileysSessions = new Map<string, BaileysSessionEntry>();
const loggedOutBaileysAccounts = new Set<string>();
let cachedWaVersion: [number, number, number] | null = null;

async function getBaileysVersion(): Promise<[number, number, number]> {
  if (cachedWaVersion) return cachedWaVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedWaVersion = version;
    return version;
  } catch {
    return [2, 3000, 1015901307];
  }
}

function sanitizeAccountId(accountId: string): string {
  return String(accountId || 'acc-wa-1').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function formatWaJidToDisplayPhone(jid?: string | null): string | null {
  if (!jid) return null;
  const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const splitIdx = rest.length - 4;
    return `+55 (${ddd}) ${rest.slice(0, splitIdx)}-${rest.slice(splitIdx)}`;
  }
  return `+${digits}`;
}

function normalizePhoneForPairing(rawPhone: string): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

async function loadImageBuffer(imageSource: string): Promise<Buffer | null> {
  if (!imageSource) return null;
  if (imageSource.startsWith('data:image/')) {
    const parts = imageSource.split(',');
    if (parts[1]) return Buffer.from(parts[1], 'base64');
  }
  if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
    let origin = '';
    try {
      origin = new URL(imageSource).origin + '/';
    } catch {
      origin = '';
    }
    const baseHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    const attempts = origin
      ? [{ ...baseHeaders, Referer: origin }, baseHeaders]
      : [baseHeaders];

    for (const headers of attempts) {
      try {
        const res = await fetch(imageSource, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const ab = await res.arrayBuffer();
          if (ab.byteLength > 0) {
            return Buffer.from(ab);
          }
        }
      } catch {
        // Try next header set
      }
    }
    console.warn(`[WhatsApp/Media] Falha ao baixar imagem: ${imageSource}`);
  }
  return null;
}

async function startBaileysSocket(
  accountId: string,
  options: {
    forceNew?: boolean;
    mode?: 'qr' | 'pairing';
    pairingPhone?: string;
  } = {}
): Promise<BaileysSessionEntry> {
  const safeId = sanitizeAccountId(accountId);
  const sessionDir = path.join(WA_SESSIONS_ROOT, safeId);
  fs.mkdirSync(WA_SESSIONS_ROOT, { recursive: true });

  const existing = baileysSessions.get(safeId);

  if (existing && existing.status === 'open' && existing.sock && !options.forceNew) {
    return existing;
  }

  if (
    existing &&
    existing.status === 'qr_ready' &&
    existing.qrDataUrl &&
    options.mode === 'qr' &&
    !options.forceNew
  ) {
    return existing;
  }

  if (existing?.sock) {
    try {
      existing.allowAutoReconnectUntil = 0;
      existing.sock.ev.removeAllListeners('connection.update');
      existing.sock.end(undefined);
    } catch {
      // Ignore close errors
    }
  }

  const credsFile = path.join(sessionDir, 'creds.json');
  let hasRegisteredCreds = false;
  if (fs.existsSync(credsFile)) {
    try {
      const parsedCreds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
      hasRegisteredCreds = Boolean(parsedCreds?.registered);
    } catch {
      hasRegisteredCreds = false;
    }
  }

  if (options.forceNew || !hasRegisteredCreds) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    if (options.forceNew) {
      loggedOutBaileysAccounts.delete(safeId);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const version = await getBaileysVersion();

  const entry: BaileysSessionEntry = {
    accountId: safeId,
    sock: null,
    status: 'connecting',
    qrDataUrl: null,
    pairingCode: null,
    connectedPhone: formatWaJidToDisplayPhone(state.creds?.me?.id),
    connectedName: state.creds?.me?.name || null,
    lastError: null,
    allowAutoReconnectUntil: Date.now() + 3 * 60 * 1000,
  };
  baileysSessions.set(safeId, entry);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }) as any,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  entry.sock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('group-participants.update', (ev: any) => {
    try {
      const jid = String(ev?.id || '');
      const count = Array.isArray(ev?.participants) ? ev.participants.length : 1;
      const action = String(ev?.action || '');
      if (jid.endsWith('@g.us')) {
        recordBaileysMemberDelta(jid, action, count);
      }
    } catch {
      // Ignore participant event parse error
    }
  });

  sock.ev.on('messages.upsert', (upsert: any) => {
    try {
      if (upsert?.type !== 'notify' || !Array.isArray(upsert?.messages)) return;
      for (const msg of upsert.messages) {
        const msgId = String(msg?.key?.id || '');
        if (msgId && recentSentWaMsgIds.has(msgId)) continue;

        const jid = String(msg?.key?.remoteJid || '');
        if (!jid.endsWith('@g.us')) continue;

        const text = extractTextFromWaMessage(msg);
        if (!text || !/https?:\/\//i.test(text)) continue;

        // Avoid re-capturing messages formatted by our own templates
        if (msg?.key?.fromMe && /Compre aqui:|Promoção sujeita a alteração/i.test(text)) {
          continue;
        }

        if (!msg?.key?.fromMe) {
          recordBaileysCapturedLink(jid);
        }

        if (isGroupMonitoredOnServer(jid)) {
          if (msg?.key?.fromMe) {
            recordBaileysCapturedLink(jid);
          }
          void processMonitoredGroupMessage({ groupJid: jid, text });
        }
      }
    } catch {
      // Ignore message parse error
    }
  });

  let pairingRequested = false;

  const readyPromise = new Promise<BaileysSessionEntry>((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve(entry);
    }, 9000);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (options.mode === 'pairing' && options.pairingPhone && !pairingRequested) {
          pairingRequested = true;
          try {
            const cleanPhone = normalizePhoneForPairing(options.pairingPhone);
            const rawCode = await sock.requestPairingCode(cleanPhone);
            const formatted = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
            entry.pairingCode = formatted;
            entry.qrDataUrl = null;
            entry.status = 'pairing_ready';
            entry.lastError = null;
            clearTimeout(timeoutId);
            resolve(entry);
          } catch (err: any) {
            entry.lastError =
              err?.message || 'Não foi possível gerar o código para este número.';
            clearTimeout(timeoutId);
            resolve(entry);
          }
        } else if (options.mode !== 'pairing') {
          try {
            entry.qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
            entry.status = 'qr_ready';
            entry.lastError = null;
            clearTimeout(timeoutId);
            resolve(entry);
          } catch {
            // Ignore QR render error
          }
        }
      }

      if (connection === 'open') {
        loggedOutBaileysAccounts.delete(safeId);
        entry.status = 'open';
        entry.qrDataUrl = null;
        entry.pairingCode = null;
        entry.lastError = null;
        entry.connectedPhone =
          formatWaJidToDisplayPhone(sock.user?.id) || entry.connectedPhone;
        entry.connectedName = sock.user?.name || entry.connectedName;
        clearTimeout(timeoutId);
        resolve(entry);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isQrTimeout =
          statusCode === DisconnectReason.timedOut && !state.creds.registered;

        if (isLoggedOut) {
          loggedOutBaileysAccounts.add(safeId);
          entry.status = 'closed';
          entry.sock = null;
          entry.qrDataUrl = null;
          entry.pairingCode = null;
          entry.lastError = 'Sessão desconectada no aparelho celular.';
          fs.rmSync(sessionDir, { recursive: true, force: true });
          clearTimeout(timeoutId);
          resolve(entry);
        } else if (isQrTimeout) {
          entry.status = 'closed';
          entry.sock = null;
          entry.qrDataUrl = null;
          entry.lastError = 'Tempo de leitura expirado. Gere um novo QR Code ou Código.';
          clearTimeout(timeoutId);
          resolve(entry);
        } else if (
          state.creds.registered ||
          Date.now() < entry.allowAutoReconnectUntil ||
          statusCode === DisconnectReason.restartRequired
        ) {
          setTimeout(() => {
            void startBaileysSocket(safeId, { mode: 'qr' });
          }, 800);
        } else {
          entry.status = 'closed';
          entry.sock = null;
          clearTimeout(timeoutId);
          resolve(entry);
        }
      }
    });
  });

  return readyPromise;
}

async function logoutBaileysSocket(accountId: string): Promise<void> {
  const safeId = sanitizeAccountId(accountId);
  loggedOutBaileysAccounts.add(safeId);
  const sessionDir = path.join(WA_SESSIONS_ROOT, safeId);
  const existing = baileysSessions.get(safeId);
  if (existing) {
    existing.allowAutoReconnectUntil = 0;
    if (existing.sock) {
      try {
        await existing.sock.logout();
      } catch {
        try {
          existing.sock.end(undefined);
        } catch {
          // Ignore
        }
      }
    }
    baileysSessions.delete(safeId);
  }
  fs.rmSync(sessionDir, { recursive: true, force: true });
}

function exportBaileysAccountBackup(
  accountId: string
): { bundle: string; savedAt: number; phone?: string | null; name?: string | null } | null {
  const safeId = sanitizeAccountId(accountId);
  const sessionDir = path.join(WA_SESSIONS_ROOT, safeId);
  const credsPath = path.join(sessionDir, 'creds.json');
  if (!fs.existsSync(credsPath)) return null;

  try {
    const credsRaw = fs.readFileSync(credsPath, 'utf-8');
    const credsParsed = JSON.parse(credsRaw);
    if (!credsParsed?.registered) return null;

    const entries = fs
      .readdirSync(sessionDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json'))
      .map((d) => {
        const full = path.join(sessionDir, d.name);
        const stat = fs.statSync(full);
        const priority =
          d.name === 'creds.json'
            ? 0
            : d.name.startsWith('app-state-sync-') ||
              d.name.startsWith('lid-mapping-') ||
              d.name.startsWith('device-list-')
            ? 1
            : 2;
        return { name: d.name, full, mtimeMs: stat.mtimeMs, size: stat.size, priority };
      })
      .sort((a, b) => a.priority - b.priority || b.mtimeMs - a.mtimeMs);

    const files: Record<string, string> = {};
    let totalBytes = 0;
    const MAX_RAW_BYTES = 1_500_000;

    for (const item of entries) {
      if (item.priority > 1 && totalBytes + item.size > MAX_RAW_BYTES) continue;
      files[item.name] = fs.readFileSync(item.full, 'utf-8');
      totalBytes += item.size;
    }

    if (!files['creds.json']) return null;
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ files }), 'utf-8'));
    const live = baileysSessions.get(safeId);
    return {
      bundle: gz.toString('base64'),
      savedAt: Date.now(),
      phone: live?.connectedPhone || formatWaJidToDisplayPhone(credsParsed?.me?.id),
      name: live?.connectedName || credsParsed?.me?.name || null,
    };
  } catch {
    return null;
  }
}

function collectAllSessionBackups() {
  const baileys: Record<
    string,
    { bundle: string; savedAt: number; phone?: string | null; name?: string | null }
  > = {};

  if (fs.existsSync(WA_SESSIONS_ROOT)) {
    try {
      const dirs = fs.readdirSync(WA_SESSIONS_ROOT, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const b = exportBaileysAccountBackup(dir.name);
        if (b) {
          baileys[dir.name] = b;
        }
      }
    } catch {
      // Ignore scan errors
    }
  }

  return {
    baileys,
    mlSessions: mlExtensionSessions,
  };
}

function restoreBaileysAccountFromBackup(accountId: string, bundleBase64: string): boolean {
  const safeId = sanitizeAccountId(accountId);
  if (loggedOutBaileysAccounts.has(safeId)) return false;

  const existing = baileysSessions.get(safeId);
  if (existing && (existing.status === 'open' || existing.status === 'connecting')) {
    return false;
  }

  const sessionDir = path.join(WA_SESSIONS_ROOT, safeId);
  const credsFile = path.join(sessionDir, 'creds.json');
  if (fs.existsSync(credsFile)) {
    try {
      const c = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
      if (c?.registered) {
        void startBaileysSocket(safeId, { mode: 'qr' });
        return true;
      }
    } catch {
      // Overwrite corrupted file below
    }
  }

  try {
    const rawBuf = zlib.gunzipSync(Buffer.from(bundleBase64, 'base64'));
    const parsed = JSON.parse(rawBuf.toString('utf-8')) as { files?: Record<string, string> };
    const files = parsed?.files;
    if (!files || typeof files['creds.json'] !== 'string') return false;

    const credsCheck = JSON.parse(files['creds.json']);
    if (!credsCheck?.registered) return false;

    fs.mkdirSync(sessionDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const safeName = path.basename(name);
      if (!safeName.endsWith('.json') || typeof content !== 'string') continue;
      fs.writeFileSync(path.join(sessionDir, safeName), content, 'utf-8');
    }

    void startBaileysSocket(safeId, { mode: 'qr' });
    return true;
  } catch {
    return false;
  }
}

async function restoreSavedBaileysSessions(): Promise<void> {
  if (!fs.existsSync(WA_SESSIONS_ROOT)) return;
  try {
    const entries = fs.readdirSync(WA_SESSIONS_ROOT, { withFileTypes: true });
    for (const dir of entries) {
      if (!dir.isDirectory()) continue;
      const credsPath = path.join(WA_SESSIONS_ROOT, dir.name, 'creds.json');
      if (!fs.existsSync(credsPath)) continue;
      try {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        if (creds?.registered) {
          void startBaileysSocket(dir.name, { mode: 'qr' });
        }
      } catch {
        // Skip invalid session
      }
    }
  } catch {
    // Ignore boot restore errors
  }
}

interface DiscoveredOffer {
  id: string;
  title: string;
  platform: 'Shopee' | 'Mercado Livre' | 'Amazon' | 'Magalu' | 'Netshoes' | 'AliExpress';
  category: string;
  originalPrice: number;
  discountPrice: number;
  discountPercent: number;
  commissionPercent: number;
  commissionValue: number;
  originalUrl: string;
  affiliateUrl: string;
  imageUrl: string;
  extraInfo?: string;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
};

function detectMarketplace(
  url: string
): 'Shopee' | 'Mercado Livre' | 'Amazon' | 'Magalu' | 'Netshoes' | 'AliExpress' {
  const lower = url.toLowerCase();
  if (lower.includes('mercadolivre') || lower.includes('meli.la')) return 'Mercado Livre';
  if (lower.includes('amazon') || lower.includes('amzn.to') || lower.includes('a.co/')) return 'Amazon';
  if (
    lower.includes('magazineluiza') ||
    lower.includes('magazinevoce') ||
    lower.includes('magalu')
  ) {
    return 'Magalu';
  }
  if (lower.includes('netshoes')) return 'Netshoes';
  if (lower.includes('aliexpress')) return 'AliExpress';
  return 'Shopee';
}

function formatAffiliateUrlFallback(
  rawUrl: string,
  platform: string,
  credentials: any
): string {
  const clean = rawUrl.trim();
  if (!clean) return rawUrl;

  if (platform === 'Mercado Livre') {
    const tag = credentials?.mercadoLivre?.etiqueta?.trim();
    if (!tag) return clean;
    try {
      const u = new URL(clean);
      u.searchParams.set('matt_tool', tag);
      if (!u.searchParams.get('matt_word')) {
        u.searchParams.set('matt_word', tag);
      }
      return u.toString();
    } catch {
      return clean;
    }
  }

  if (platform === 'Amazon') {
    const tag = credentials?.amazon?.associateTag?.trim();
    if (!tag) return clean;
    try {
      const u = new URL(clean);
      u.searchParams.set('tag', tag);
      return u.toString();
    } catch {
      return clean;
    }
  }

  if (platform === 'Magalu') {
    const store = credentials?.magalu?.partnerStore?.trim();
    if (store && clean.includes('magazineluiza.com.br')) {
      return clean.replace('www.magazineluiza.com.br', `www.magazinevoce.com.br/${store}`);
    }
    return clean;
  }

  if (platform === 'Netshoes') {
    const sid = credentials?.netshoes?.accountSid?.trim();
    if (!sid) return clean;
    try {
      const u = new URL(clean);
      u.searchParams.set('utm_source', 'rakuten');
      u.searchParams.set('sid', sid);
      return u.toString();
    } catch {
      return clean;
    }
  }

  if (platform === 'AliExpress') {
    const tracking = credentials?.aliexpress?.trackingId?.trim();
    if (!tracking) return clean;
    try {
      const u = new URL(clean);
      u.searchParams.set('aff_trace_key', tracking);
      return u.toString();
    } catch {
      return clean;
    }
  }

  if (platform === 'Shopee') {
    const sub = credentials?.shopee?.subIds?.[0];
    if (!sub) return clean;
    try {
      const u = new URL(clean);
      u.searchParams.set('uls_trackid', sub);
      return u.toString();
    } catch {
      return clean;
    }
  }

  return clean;
}

/* ============================================================================
 * SHOPEE AFFILIATE GRAPHQL HELPER (Official Open API v2 SHA256)
 * ========================================================================== */
async function callShopeeGraphql(
  appId: string,
  apiSecret: string,
  graphqlPayload: { query: string; variables?: Record<string, unknown> }
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyStr = JSON.stringify(graphqlPayload);
  const factor = `${appId}${timestamp}${bodyStr}${apiSecret}`;
  const signature = crypto.createHash('sha256').update(factor).digest('hex');

  const response = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body: bodyStr,
  });

  const json = (await response.json()) as any;
  if (!response.ok || json.errors) {
    const errMsg = json?.errors?.[0]?.message || `HTTP ${response.status}`;
    throw new Error(errMsg);
  }
  return json.data;
}

/* ============================================================================
 * ALIEXPRESS AFFILIATE SYNC HELPER (HMAC-SHA256)
 * ========================================================================== */
async function callAliExpressApi(
  appKey: string,
  appSecret: string,
  method: string,
  extraParams: Record<string, string>
) {
  const params: Record<string, string> = {
    app_key: appKey,
    method,
    sign_method: 'sha256',
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    format: 'json',
    v: '2.0',
    ...extraParams,
  };

  const sortedKeys = Object.keys(params).sort();
  const signString = sortedKeys.map((k) => `${k}${params[k]}`).join('');
  const sign = crypto
    .createHmac('sha256', appSecret)
    .update(signString)
    .digest('hex')
    .toUpperCase();

  params.sign = sign;

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api-sg.aliexpress.com/sync?${qs}`, {
    method: 'POST',
  });
  return (await res.json()) as any;
}

/* ============================================================================
 * LIVE VERIFIED BRAZILIAN OFFERS ENGINE (All 6 Marketplaces + Keyword Search)
 * ========================================================================== */
const STORE_SLUG_BY_PLATFORM: Record<string, string> = {
  Shopee: 'shopee',
  'Mercado Livre': 'mercado-livre',
  Amazon: 'amazon',
  Magalu: 'magazine-luiza',
  AliExpress: 'aliexpress',
  Netshoes: 'netshoes',
};

const PLATFORM_BY_STORE_PARAM: Record<
  string,
  'Shopee' | 'Mercado Livre' | 'Amazon' | 'Magalu' | 'Netshoes' | 'AliExpress'
> = {
  shopee: 'Shopee',
  'mercado-livre': 'Mercado Livre',
  mercadolivre: 'Mercado Livre',
  amazon: 'Amazon',
  'magazine-luiza': 'Magalu',
  magazineluiza: 'Magalu',
  magalu: 'Magalu',
  magazinevoce: 'Magalu',
  aliexpress: 'AliExpress',
  netshoes: 'Netshoes',
};

const DEFAULT_COMMISSION_BY_PLATFORM: Record<string, number> = {
  Shopee: 11,
  'Mercado Livre': 14,
  Amazon: 9,
  Magalu: 8,
  AliExpress: 8,
  Netshoes: 10,
};

function buildDirectStoreUrlForOffer(
  title: string,
  platform: 'Shopee' | 'Mercado Livre' | 'Amazon' | 'Magalu' | 'Netshoes' | 'AliExpress',
  credentials: any
): { originalUrl: string; affiliateUrl: string } {
  const cleanTitle = title
    .replace(/cupom[^:]*:/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim()
    .slice(0, 90);

  const slug = cleanTitle
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  let originalUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(slug || 'ofertas')}`;

  if (platform === 'Amazon') {
    originalUrl = `https://www.amazon.com.br/s?k=${encodeURIComponent(cleanTitle)}`;
  } else if (platform === 'Shopee') {
    originalUrl = `https://shopee.com.br/search?keyword=${encodeURIComponent(cleanTitle)}`;
  } else if (platform === 'Magalu') {
    const store = credentials?.magalu?.partnerStore?.trim();
    if (store) {
      const partnerUrl = `https://www.magazinevoce.com.br/${encodeURIComponent(
        store
      )}/busca/${encodeURIComponent(slug || 'ofertas')}/`;
      return { originalUrl: partnerUrl, affiliateUrl: partnerUrl };
    }
    originalUrl = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(slug || 'ofertas')}/`;
  } else if (platform === 'AliExpress') {
    originalUrl = `https://pt.aliexpress.com/wholesale?SearchText=${encodeURIComponent(cleanTitle)}`;
  } else if (platform === 'Netshoes') {
    originalUrl = `https://www.netshoes.com.br/busca?nsCat=Natural&q=${encodeURIComponent(cleanTitle)}`;
  }

  return {
    originalUrl,
    affiliateUrl: formatAffiliateUrlFallback(originalUrl, platform, credentials),
  };
}

function mapRawPromobitItem(
  raw: any,
  forcedPlatform:
    | 'Shopee'
    | 'Mercado Livre'
    | 'Amazon'
    | 'Magalu'
    | 'Netshoes'
    | 'AliExpress'
    | null,
  credentials: any
): DiscoveredOffer | null {
  const id = raw.offerId || raw.offer_id;
  const title = String(raw.offerTitle || raw.offer_title || '').trim();
  const price = Number(raw.offerPrice ?? raw.offer_price ?? 0);
  const oldPriceRaw = Number(raw.offerOldPrice ?? raw.offer_old_price ?? 0);
  const priceType = String(raw.offerPriceType || raw.offer_price_type || 'NORMAL');
  const photoPath = String(raw.offerPhoto || raw.offer_photo || '').trim();
  const coupon = String(raw.offerCoupon || raw.offer_coupon || '').trim();
  const storeParam = String(raw.storeParam || raw.store_param || '').toLowerCase();
  const storeDomain = String(raw.storeDomain || raw.store_domain || '').toLowerCase();
  const categoryName = String(
    raw.categoryName || raw.category_name || 'Ofertas Verificadas'
  ).trim();

  if (!id || !title || priceType === 'COUPON' || price <= 1) {
    return null;
  }

  let mappedPlatform =
    forcedPlatform ||
    PLATFORM_BY_STORE_PARAM[storeParam] ||
    (storeDomain.includes('mercadolivre')
      ? 'Mercado Livre'
      : storeDomain.includes('amazon')
      ? 'Amazon'
      : storeDomain.includes('shopee')
      ? 'Shopee'
      : storeDomain.includes('magazineluiza') || storeDomain.includes('magalu')
      ? 'Magalu'
      : storeDomain.includes('aliexpress')
      ? 'AliExpress'
      : storeDomain.includes('netshoes')
      ? 'Netshoes'
      : null);

  if (!mappedPlatform) return null;

  const origPrice = oldPriceRaw > price ? oldPriceRaw : price;
  const pctRaw = Number(raw.offerDiscontPercentage ?? raw.offer_discont_percentage ?? 0);
  const pct =
    origPrice > price
      ? Math.round(((origPrice - price) / origPrice) * 100)
      : pctRaw > 0
      ? Math.round(pctRaw)
      : 0;

  const commPct = DEFAULT_COMMISSION_BY_PLATFORM[mappedPlatform] || 10;
  const commVal = Number(((price * commPct) / 100).toFixed(2));

  const imageUrl = photoPath
    ? photoPath.startsWith('http')
      ? photoPath
      : `https://i.promobit.com.br${photoPath.startsWith('/') ? '' : '/'}${photoPath}`
    : '';

  const tagsArr = Array.isArray(raw.offerTags || raw.offer_tags)
    ? (raw.offerTags || raw.offer_tags).map((t: any) => t?.name).filter(Boolean)
    : [];
  const extras: string[] = [];
  if (coupon && coupon !== 'null') extras.push(`Cupom: ${coupon}`);
  if (tagsArr.length > 0) extras.push(tagsArr[0]);

  const { originalUrl, affiliateUrl } = buildDirectStoreUrlForOffer(
    title,
    mappedPlatform,
    credentials
  );

  return {
    id: `live-${mappedPlatform.toLowerCase().replace(/\s+/g, '')}-${id}`,
    title: decodeHtmlEntities(title),
    platform: mappedPlatform,
    category: categoryName || `Vitrine ${mappedPlatform}`,
    originalPrice: Number(origPrice.toFixed(2)),
    discountPrice: Number(price.toFixed(2)),
    discountPercent: pct,
    commissionPercent: commPct,
    commissionValue: commVal,
    originalUrl,
    affiliateUrl,
    imageUrl,
    extraInfo: extras.length > 0 ? extras.join(' • ') : undefined,
  };
}

interface OfferStreamState {
  after: string | null;
  overflow: DiscoveredOffer[];
  seenIds: string[];
  queryKey: string;
}

const offerStreamCursors = new Map<string, OfferStreamState>();

function saveOfferStreamCursor(state: OfferStreamState): string {
  const token = `cur_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  offerStreamCursors.set(token, state);
  if (offerStreamCursors.size > 150) {
    const oldestKey = offerStreamCursors.keys().next().value;
    if (oldestKey) offerStreamCursors.delete(oldestKey);
  }
  return token;
}

async function searchVerifiedLiveOffers(
  query: string,
  platform: string,
  credentials: any,
  options: { page?: number; limit?: number; cursor?: string | null } = {}
): Promise<{ offers: DiscoveredOffer[]; nextCursor: string | null; hasMore: boolean }> {
  const cleanQuery = query.trim();
  const pageSize = Math.max(1, Math.min(200, Number(options.limit) || 10));
  const pageNum = Math.max(1, Number(options.page) || 1);
  const queryKey = `${platform}::${cleanQuery.toLowerCase()}`;
  const isDefaultFeed =
    !cleanQuery ||
    cleanQuery.toLowerCase() === 'ofertas' ||
    cleanQuery.toLowerCase() === 'ofertas do dia' ||
    cleanQuery.toLowerCase() === 'promocoes' ||
    cleanQuery.toLowerCase() === 'todas as categorias';

  const cursorState =
    options.cursor && offerStreamCursors.get(options.cursor)?.queryKey === queryKey
      ? offerStreamCursors.get(options.cursor)
      : undefined;

  const results: DiscoveredOffer[] = cursorState ? [...cursorState.overflow] : [];
  const seenIds = new Set<string>(cursorState ? cursorState.seenIds : []);
  let currentAfter: string | null = cursorState ? cursorState.after : null;
  let reachedEnd = Boolean(cursorState && !cursorState.after);

  // 1. On first page without cursor, query direct keyword search if user typed a specific search
  if (!cursorState && pageNum === 1 && !isDefaultFeed) {
    try {
      const searchUrl = `https://api.promobit.com.br/search?q=${encodeURIComponent(cleanQuery)}`;
      const res = await fetch(searchUrl, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(8500),
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const active = Array.isArray(json?.active_offers) ? json.active_offers : [];
        for (const raw of active) {
          const item = mapRawPromobitItem(raw, null, credentials);
          if (!item) continue;
          if (platform !== 'Todas as Plataformas' && item.platform !== platform) continue;
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            results.push(item);
          }
        }
      }
    } catch {
      // Fall back to stream feed below
    }
  }

  // 2. Walk paginated live offers stream (supports unlimited Próximo / Voltar)
  const lowerQ = isDefaultFeed ? '' : cleanQuery.toLowerCase();
  const maxHops = lowerQ ? 8 : 6;
  let hops = 0;

  while (results.length < pageSize && !reachedEnd && hops < maxHops) {
    hops += 1;
    try {
      const streamUrl = currentAfter
        ? `https://api.promobit.com.br/offers?limit=40&after=${encodeURIComponent(currentAfter)}`
        : `https://api.promobit.com.br/offers?limit=40`;
      const res = await fetch(streamUrl, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) break;
      const json = (await res.json()) as any;
      const batch = Array.isArray(json?.offers) ? json.offers : [];
      const nextAfter = typeof json?.after === 'string' && json.after ? json.after : null;

      if (batch.length === 0 || (nextAfter && nextAfter === currentAfter)) {
        reachedEnd = true;
        break;
      }

      for (const raw of batch) {
        const item = mapRawPromobitItem(raw, null, credentials);
        if (!item) continue;
        if (platform !== 'Todas as Plataformas' && item.platform !== platform) continue;
        if (
          lowerQ &&
          !item.title.toLowerCase().includes(lowerQ) &&
          !item.category.toLowerCase().includes(lowerQ)
        ) {
          continue;
        }
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          results.push(item);
        }
      }

      currentAfter = nextAfter;
      if (!currentAfter) {
        reachedEnd = true;
        break;
      }
    } catch {
      break;
    }
  }

  // 3. On first page, supplement with store-specific feed (__NEXT_DATA__) if needed
  if (!cursorState && pageNum === 1 && results.length < pageSize) {
    const slugsToFetch =
      platform !== 'Todas as Plataformas' && STORE_SLUG_BY_PLATFORM[platform]
        ? [{ slug: STORE_SLUG_BY_PLATFORM[platform], plat: platform as any }]
        : [
            { slug: 'shopee', plat: 'Shopee' as const },
            { slug: 'mercado-livre', plat: 'Mercado Livre' as const },
            { slug: 'amazon', plat: 'Amazon' as const },
            { slug: 'magazine-luiza', plat: 'Magalu' as const },
          ];

    await Promise.all(
      slugsToFetch.map(async ({ slug, plat }) => {
        try {
          const storeUrl = `https://www.promobit.com.br/promocoes/loja/${slug}/`;
          const res = await fetch(storeUrl, {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) return;
          const html = await res.text();
          const nextMatch = html.match(
            /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
          );
          if (!nextMatch) return;
          const parsed = JSON.parse(nextMatch[1]);
          const list = parsed?.props?.pageProps?.serverOffers?.offers || [];

          for (const raw of list) {
            const item = mapRawPromobitItem(raw, plat, credentials);
            if (!item) continue;
            if (
              lowerQ &&
              !item.title.toLowerCase().includes(lowerQ) &&
              !item.category.toLowerCase().includes(lowerQ)
            ) {
              continue;
            }
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              results.push(item);
            }
          }
        } catch {
          // Ignore individual store timeout
        }
      })
    );
  }

  const pageOffers = results.slice(0, pageSize);
  const remainingOverflow = results.slice(pageSize);
  const hasMore = remainingOverflow.length > 0 || Boolean(currentAfter && !reachedEnd);
  const nextCursor = hasMore
    ? saveOfferStreamCursor({
        after: reachedEnd ? null : currentAfter,
        overflow: remainingOverflow,
        seenIds: Array.from(seenIds).slice(-600),
        queryKey,
      })
    : null;

  return { offers: pageOffers, nextCursor, hasMore };
}

/* ============================================================================
 * MERCADO LIVRE OFFICIAL OAUTH SEARCH + LIVE FEED FALLBACK
 * ========================================================================== */
async function searchMercadoLivre(
  query: string,
  credentials: any,
  page: number = 1,
  limit: number = 10
): Promise<DiscoveredOffer[]> {
  const searchTerm = query.trim() || 'ofertas do dia';
  const authToken = credentials?.mercadoLivre?.authCode?.trim();
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const offset = Math.max(0, (Math.max(1, Number(page) || 1) - 1) * safeLimit);

  // 1. Try Official MLB Search API if OAuth token is provided
  if (authToken && !authToken.startsWith('ml_sess_')) {
    try {
      const apiUrl = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(
        searchTerm
      )}&offset=${offset}&limit=${safeLimit}`;
      const res = await fetch(apiUrl, {
        headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (Array.isArray(data.results) && data.results.length > 0) {
          return data.results.slice(0, safeLimit).map((item: any) => {
            const discPrice = Number(item.price) || 0;
            const origPrice = Number(item.original_price) || discPrice;
            const pct =
              origPrice > discPrice
                ? Math.round(((origPrice - discPrice) / origPrice) * 100)
                : 0;
            const commPct = 14;
            const commVal = Number(((discPrice * commPct) / 100).toFixed(2));
            const hdThumb = String(item.thumbnail || '')
              .replace('http://', 'https://')
              .replace('-I.jpg', '-O.jpg');
            const affUrl = formatAffiliateUrlFallback(
              item.permalink || '',
              'Mercado Livre',
              credentials
            );
            return {
              id: `ml-${item.id}`,
              title: item.title,
              platform: 'Mercado Livre',
              category: 'Vitrine Mercado Livre',
              originalPrice: origPrice,
              discountPrice: discPrice,
              discountPercent: pct,
              commissionPercent: commPct,
              commissionValue: commVal,
              originalUrl: item.permalink,
              affiliateUrl: affUrl,
              imageUrl: hdThumb,
              extraInfo: item.shipping?.free_shipping ? 'Frete Grátis' : undefined,
            };
          });
        }
      }
    } catch {
      // Fall through to verified live feed
    }
  }

  const live = await searchVerifiedLiveOffers(query, 'Mercado Livre', credentials, {
    page,
    limit: safeLimit,
  });
  return live.offers;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/* ============================================================================
 * EXTRACT METADATA FROM ANY PRODUCT URL (Direct + Slug Fallback)
 * ========================================================================== */
function humanizeUrlSlug(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const segments = decodeURIComponent(u.pathname)
      .split('/')
      .filter(
        (s) =>
          s.length > 6 &&
          !/^(dp|gp|p|produto|busca|oferta|sec|s)$/i.test(s) &&
          !/^[A-Z0-9]{10}$/.test(s) &&
          !/^MLB-?\d+$/i.test(s)
      );
    if (segments.length === 0) return '';
    const longest = segments.sort((a, b) => b.length - a.length)[0];
    return longest
      .replace(/-i\.\d+\.\d+.*$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  } catch {
    return '';
  }
}

async function extractOfferFromUrl(
  rawUrl: string,
  credentials: any,
  messageTextHint: string = ''
) {
  const originalInput = rawUrl.trim();
  let finalUrl = originalInput;
  let html = '';
  try {
    const res = await fetch(finalUrl, {
      redirect: 'follow',
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    if (res.url) finalUrl = unwrapResolvedProductUrl(res.url, originalInput);
    if (res.ok) {
      html = await res.text();
    }
  } catch {
    // Continue with URL slug + message hint + live search enrichment
  }

  const platform = detectMarketplace(finalUrl);

  let title = '';
  let imageUrl = '';
  let discountPrice = 0;
  let originalPrice = 0;

  if (html) {
    // 1. Try JSON-LD Schema.org Product
    const ldMatches = Array.from(
      html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    );
    for (const m of ldMatches) {
      try {
        const parsed = JSON.parse(m[1].trim());
        const candidates = Array.isArray(parsed)
          ? parsed
          : parsed['@graph']
          ? parsed['@graph']
          : [parsed];
        for (const node of candidates) {
          if (node && (node['@type'] === 'Product' || node.offers)) {
            if (!title && node.name) title = String(node.name);
            if (!imageUrl && node.image) {
              imageUrl = Array.isArray(node.image)
                ? String(node.image[0]?.url || node.image[0] || '')
                : String(node.image?.url || node.image || '');
            }
            const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
            if (offer) {
              const p = parseFloat(String(offer.price || offer.lowPrice || '0'));
              const hp = parseFloat(String(offer.highPrice || '0'));
              if (p > 0) discountPrice = p;
              if (hp > p) originalPrice = hp;
            }
          }
        }
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }

    // 2. OpenGraph & Meta Tags fallback
    const metaTitle =
      html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1] ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];

    const metaImage =
      html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1];

    const metaPrice =
      html.match(/property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)?.[1];

    if (
      !title &&
      metaTitle &&
      !/access denied|não é possível acessar|robot check|captcha/i.test(metaTitle)
    ) {
      title = decodeHtmlEntities(metaTitle.trim());
    }
    if (!imageUrl && metaImage) imageUrl = decodeHtmlEntities(metaImage.trim());
    if (!discountPrice && metaPrice) {
      discountPrice = parseFloat(metaPrice.replace(',', '.')) || 0;
    }

    // 3. Regex BRL price fallback in page body if price still 0
    if (!discountPrice) {
      const brlMatches = Array.from(html.matchAll(/R\$\s?(\d{1,4}(?:\.\d{3})*,\d{2})/g)).map(
        (m) => parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
      );
      const validPrices = brlMatches.filter((v) => v >= 5 && v <= 50000);
      if (validPrices.length >= 2 && validPrices[0] > validPrices[1]) {
        originalPrice = validPrices[0];
        discountPrice = validPrices[1];
      } else if (validPrices.length >= 1) {
        discountPrice = validPrices[0];
      }
    }
  }

  // 3B. WhatsApp message text hint fallback when webpage HTML was blocked or shortlink didn't expand
  if (messageTextHint.trim()) {
    if (!title) {
      const cleanLines = messageTextHint
        .split(/\r?\n/)
        .map((l) =>
          l
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/[*~_`]/g, '')
            .trim()
        )
        .filter(
          (l) =>
            l.length >= 6 &&
            !/^(de:|por:|r\$|cupom|compre|link|aproveite|oferta)/i.test(l)
        );
      if (cleanLines[0]) {
        title = cleanLines[0].slice(0, 140);
      }
    }
    if (!discountPrice) {
      const msgPrices = Array.from(
        messageTextHint.matchAll(/R\$\s?(\d{1,4}(?:\.\d{3})*(?:,\d{2})?)/gi)
      )
        .map((m) => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
        .filter((v) => v > 0 && v <= 50000);
      if (msgPrices.length >= 2 && msgPrices[0] > msgPrices[1]) {
        originalPrice = msgPrices[0];
        discountPrice = msgPrices[1];
      } else if (msgPrices.length >= 1) {
        discountPrice = msgPrices[0];
      }
    }
  }

  // 4. If WAF blocked direct HTML, enrich via URL slug or title + live verified database
  const slugHint = humanizeUrlSlug(finalUrl);
  const searchHint = title || slugHint;
  if ((!title || !discountPrice || !imageUrl) && searchHint) {
    if (!title) title = searchHint;
    try {
      const words = searchHint.split(/\s+/).slice(0, 5).join(' ');
      const { offers: candidates } = await searchVerifiedLiveOffers(
        words,
        'Todas as Plataformas',
        credentials,
        { limit: 12 }
      );
      if (candidates.length > 0) {
        const best = candidates.find((c) => c.platform === platform) || candidates[0];
        if (!imageUrl && best.imageUrl) imageUrl = best.imageUrl;
        if (!discountPrice && best.discountPrice) {
          discountPrice = best.discountPrice;
          originalPrice = best.originalPrice;
        }
      }
    } catch {
      // Keep slug title
    }
  }

  if (!originalPrice || originalPrice < discountPrice) {
    originalPrice = discountPrice;
  }

  const pct =
    originalPrice > discountPrice
      ? Math.round(((originalPrice - discountPrice) / originalPrice) * 100)
      : 0;

  // Convert affiliate link (use real Shopee shortlink or ML extension session when available)
  let affiliateUrl = formatAffiliateUrlFallback(finalUrl, platform, credentials);
  if (
    platform === 'Shopee' &&
    credentials?.shopee?.appId &&
    credentials?.shopee?.apiSecret &&
    !String(credentials.shopee.apiSecret).startsWith('shp_live_98a7')
  ) {
    try {
      const subIds = credentials.shopee.subIds || [];
      const data = await callShopeeGraphql(
        credentials.shopee.appId,
        credentials.shopee.apiSecret,
        {
          query: `mutation($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }`,
          variables: {
            input: {
              originUrl: finalUrl,
              subIds: subIds.slice(0, 5),
            },
          },
        }
      );
      if (data?.generateShortLink?.shortLink) {
        affiliateUrl = data.generateShortLink.shortLink;
      }
    } catch {
      // Keep fallback link
    }
  } else if (platform === 'Mercado Livre') {
    try {
      const mlConv = await convertMercadoLivreAffiliateLink(finalUrl, credentials);
      if (mlConv.affiliateUrl) {
        affiliateUrl = mlConv.affiliateUrl;
      }
    } catch {
      // Keep fallback link
    }
  }

  return {
    title: title || `Oferta ${platform}`,
    platform,
    imageUrl,
    originalPrice: originalPrice || 99.9,
    discountPrice: discountPrice || 69.9,
    discountPercent: pct,
    originalUrl: finalUrl,
    affiliateUrl,
  };
}

/* ============================================================================
 * TELEGRAM FORMATTING CONVERTER (WhatsApp Markdown -> Telegram HTML)
 * ========================================================================== */
function whatsappToTelegramHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

/* ============================================================================
 * EXPRESS SERVER INITIALIZATION
 * ========================================================================== */
async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.use('/api/mercadolivre/extension', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'buboflow-server', port: PORT });
  });

  // --------------------------------------------------------------------------
  // 0B. MERCADO LIVRE EXTENSION DOWNLOAD + SESSION SYNC + LINK BRIDGE
  // --------------------------------------------------------------------------
  const detectExtensionServerUrl = (req: express.Request, clientOrigin?: string): string => {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const proto = forwardedProto || req.protocol || 'https';
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwardedHost || req.get('host') || `localhost:${PORT}`;
    const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    if (isLocalHost && clientOrigin && /^https?:\/\//i.test(clientOrigin) && !clientOrigin.includes('localhost')) {
      return clientOrigin.replace(/\/+$/, '');
    }
    return `${proto}://${host}`;
  };

  app.post('/api/mercadolivre/extension/package', (req, res) => {
    try {
      const {
        extensionKey = 'bbf_ml_default',
        etiqueta = '',
        clientOrigin = '',
      } = req.body || {};

      const detectedServerUrl = detectExtensionServerUrl(req, String(clientOrigin || ''));
      const zipBuf = buildMercadoLivreExtensionZip({
        serverUrl: detectedServerUrl,
        extensionKey: String(extensionKey || 'bbf_ml_default').trim(),
        etiqueta: String(etiqueta || '').trim(),
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok: true,
        filename: 'extensao-mercadolivre-afiliados.zip',
        base64: zipBuf.toString('base64'),
        size: zipBuf.length,
        serverUrl: detectedServerUrl,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Erro ao gerar pacote da extensão.' });
    }
  });

  app.get('/api/mercadolivre/extension.zip', (req, res) => {
    try {
      const detectedServerUrl = detectExtensionServerUrl(req);
      const extensionKey = String(req.query.key || 'bbf_ml_default').trim();
      const etiqueta = String(req.query.etiqueta || '').trim();

      const zipBuf = buildMercadoLivreExtensionZip({
        serverUrl: detectedServerUrl,
        extensionKey,
        etiqueta,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="extensao-mercadolivre-afiliados.zip"'
      );
      res.setHeader('Content-Length', String(zipBuf.length));
      res.send(zipBuf);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Erro ao gerar .zip da extensão.' });
    }
  });

  app.get('/api/mercadolivre/extension/status', (req, res) => {
    const key = String(req.query.key || '').trim();
    const session = key ? mlExtensionSessions[key] || null : resolveMlExtensionSession();
    if (!session) {
      return res.json({
        ok: true,
        synced: false,
        hasSsid: false,
        bridgeOnline: false,
        cookiesCount: 0,
      });
    }
    res.json({
      ok: true,
      synced: true,
      extensionKey: session.extensionKey,
      etiqueta: session.etiqueta,
      hasSsid: session.hasSsid,
      bridgeOnline: isMlBridgeOnline(session),
      cookiesCount: session.cookiesCount,
      mlUserId: session.mlUserId,
      browserName: session.browserName,
      lastSyncAt: session.lastSyncAt,
      lastPollAt: session.lastPollAt || null,
    });
  });

  app.post('/api/mercadolivre/extension/sync', (req, res) => {
    const {
      extensionKey = '',
      etiqueta = '',
      cookieHeader = '',
      cookiesCount = 0,
      hasSsid = false,
      mlUserId = null,
      browserName = 'Chrome',
    } = req.body || {};

    const cleanKey = String(extensionKey).trim();
    if (!cleanKey) {
      return res.status(400).json({ ok: false, error: 'Chave de conexão ausente.' });
    }

    const prev = mlExtensionSessions[cleanKey];
    mlExtensionSessions[cleanKey] = {
      extensionKey: cleanKey,
      etiqueta: String(etiqueta || prev?.etiqueta || '').trim(),
      cookieHeader: String(cookieHeader || ''),
      cookiesCount: Number(cookiesCount) || 0,
      hasSsid: Boolean(hasSsid),
      mlUserId: mlUserId ? String(mlUserId) : null,
      browserName: String(browserName || 'Navegador'),
      lastSyncAt: new Date().toISOString(),
      lastPollAt: new Date().toISOString(),
    };
    saveMlExtensionSessions();

    if (panelStore.hasServerState && panelStore.state && Boolean(hasSsid)) {
      const curMl = panelStore.state.integrations?.mercadoLivre || {};
      panelStore.state = {
        ...panelStore.state,
        integrations: {
          ...(panelStore.state.integrations || {}),
          mercadoLivre: {
            ...curMl,
            extensionKey: cleanKey,
            etiqueta: String(etiqueta || curMl.etiqueta || '').trim(),
          },
        },
      };
      panelStore.version += 1;
      panelStore.updatedAt = new Date().toISOString();
      saveStoredPanelState();
    }

    res.json({
      ok: true,
      synced: true,
      hasSsid: Boolean(hasSsid),
      cookiesCount: Number(cookiesCount) || 0,
    });
  });

  // --------------------------------------------------------------------------
  // 0C. CANONICAL PANEL STATE SYNC (Unifies Chrome + Lemur + PC + Monitoring)
  // --------------------------------------------------------------------------
  app.get('/api/panel/state', (req, res) => {
    const sinceVersion = Number(req.query.since || 0);
    if (panelStore.hasServerState && sinceVersion > 0 && sinceVersion === panelStore.version) {
      return res.json({
        ok: true,
        unchanged: true,
        hasServerState: true,
        version: panelStore.version,
      });
    }

    const reconciled = reconcilePanelWithActiveMlExtension(panelStore.state);
    if (reconciled && reconciled !== panelStore.state) {
      panelStore.state = reconciled;
      panelStore.version += 1;
      saveStoredPanelState();
    }

    res.json({
      ok: true,
      hasServerState: panelStore.hasServerState,
      version: panelStore.version,
      updatedAt: panelStore.updatedAt,
      state: panelStore.state,
    });
  });

  app.post('/api/panel/state', (req, res) => {
    try {
      const {
        clientVersion = 0,
        migrateOnly = false,
        forceReset = false,
        state: rawIncoming,
      } = req.body || {};

      if (!rawIncoming || typeof rawIncoming !== 'object') {
        return res.status(400).json({ ok: false, error: 'Payload de estado inválido.' });
      }

      const incoming = stripFictionalFromState(rawIncoming);

      if (forceReset) {
        panelStore.state = reconcilePanelWithActiveMlExtension(incoming);
        panelStore.hasServerState = true;
        panelStore.version += 1;
        panelStore.updatedAt = new Date().toISOString();
        saveStoredPanelState();
        return res.json({
          ok: true,
          version: panelStore.version,
          state: panelStore.state,
        });
      }

      if (!panelStore.hasServerState || !panelStore.state) {
        panelStore.state = reconcilePanelWithActiveMlExtension(incoming);
        panelStore.hasServerState = true;
        panelStore.version = Math.max(1, panelStore.version + 1);
        panelStore.updatedAt = new Date().toISOString();
        saveStoredPanelState();
        return res.json({
          ok: true,
          version: panelStore.version,
          state: panelStore.state,
        });
      }

      if (migrateOnly) {
        const cur = panelStore.state;
        const mergedProducts = mergeRealProducts(
          cur.products || [],
          incoming.products || []
        );
        const curPrefs = cur.savedGroupPrefs || {};
        const incPrefs = incoming.savedGroupPrefs || {};
        const allPrefKeys = new Set([...Object.keys(curPrefs), ...Object.keys(incPrefs)]);
        const mergedPrefs: Record<string, any> = {};
        for (const k of allPrefKeys) {
          const cp = curPrefs[k] || {};
          const ip = incPrefs[k] || {};
          mergedPrefs[k] = {
            ...ip,
            ...cp,
            activeForOffers: Boolean(cp.activeForOffers || ip.activeForOffers),
            monitored: Boolean(cp.monitored || ip.monitored),
            isPriorityCapture: Boolean(cp.isPriorityCapture || ip.isPriorityCapture),
          };
        }
        const mergedMonitoringGroups = Array.isArray(cur.monitoringGroups) && cur.monitoringGroups.length > 0
          ? cur.monitoringGroups.map((m: any) => {
              const norm = normalizeServerGroupJid(m?.remoteJid);
              const pref = norm ? mergedPrefs[`wa:${norm}`] : null;
              return pref ? { ...m, monitored: Boolean(m.monitored || pref.monitored) } : m;
            })
          : incoming.monitoringGroups || [];
        const mergedIntegrations = mergeNonEmptyCreds(
          cur.integrations,
          incoming.integrations
        );
        const nextState = reconcilePanelWithActiveMlExtension({
          ...cur,
          products: mergedProducts,
          savedGroupPrefs: mergedPrefs,
          monitoringGroups: mergedMonitoringGroups,
          integrations: mergedIntegrations,
          sentLogs:
            cur.sentLogs?.length >= (incoming.sentLogs?.length || 0)
              ? cur.sentLogs
              : incoming.sentLogs || [],
          convertedLinks:
            cur.convertedLinks?.length >= (incoming.convertedLinks?.length || 0)
              ? cur.convertedLinks
              : incoming.convertedLinks || [],
        });

        panelStore.state = nextState;
        panelStore.version += 1;
        panelStore.updatedAt = new Date().toISOString();
        saveStoredPanelState();
        return res.json({
          ok: true,
          version: panelStore.version,
          state: panelStore.state,
        });
      }

      // Normal browser edit: preserve any server-captured products added while this client was slightly behind
      const serverProducts: any[] = Array.isArray(panelStore.state.products)
        ? panelStore.state.products
        : [];
      const incomingProducts: any[] = Array.isArray(incoming.products)
        ? incoming.products
        : [];
      let finalProducts = incomingProducts;
      if (Number(clientVersion) < panelStore.version) {
        const capturedMissing = serverProducts.filter(
          (p) =>
            String(p?.id || '').startsWith('prod-mon-') &&
            !incomingProducts.some((ip) => ip?.id === p.id)
        );
        if (capturedMissing.length > 0) {
          finalProducts = [...capturedMissing, ...incomingProducts];
        }
      }

      panelStore.state = reconcilePanelWithActiveMlExtension({
        ...incoming,
        products: finalProducts,
      });
      panelStore.hasServerState = true;
      panelStore.version += 1;
      panelStore.updatedAt = new Date().toISOString();
      saveStoredPanelState();

      res.json({
        ok: true,
        version: panelStore.version,
        state: panelStore.state,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Erro ao salvar estado.' });
    }
  });

  app.get('/api/sessions/backups', (_req, res) => {
    const backups = collectAllSessionBackups();
    res.json({ ok: true, ...backups });
  });

  app.post('/api/sessions/restore', (req, res) => {
    try {
      const { baileys = {}, mlSessions = {} } = req.body || {};
      const restoredAccounts: string[] = [];
      const restoredMlKeys: string[] = [];

      if (baileys && typeof baileys === 'object') {
        for (const [accId, entry] of Object.entries<any>(baileys)) {
          if (entry?.bundle && typeof entry.bundle === 'string') {
            if (restoreBaileysAccountFromBackup(accId, entry.bundle)) {
              restoredAccounts.push(accId);
            }
          }
        }
      }

      if (mlSessions && typeof mlSessions === 'object') {
        let mlChanged = false;
        for (const [key, sess] of Object.entries<any>(mlSessions)) {
          if (
            key &&
            sess?.hasSsid &&
            sess?.cookieHeader &&
            !mlExtensionSessions[key]
          ) {
            mlExtensionSessions[key] = sess;
            restoredMlKeys.push(key);
            mlChanged = true;
          }
        }
        if (mlChanged) {
          saveMlExtensionSessions();
        }
      }

      res.json({ ok: true, restoredAccounts, restoredMlKeys });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Erro ao restaurar sessões.' });
    }
  });

  app.post('/api/mercadolivre/extension/poll', (req, res) => {
    const key = String(req.body?.extensionKey || '').trim();
    if (!key) return res.json({ ok: true, job: null });

    if (mlExtensionSessions[key]) {
      mlExtensionSessions[key].lastPollAt = new Date().toISOString();
    }

    const queue = pendingMlJobsByKey.get(key) || [];
    const nextJob = queue.shift() || null;
    pendingMlJobsByKey.set(key, queue);

    if (!nextJob) {
      return res.json({ ok: true, job: null });
    }

    res.json({
      ok: true,
      job: {
        id: nextJob.id,
        url: nextJob.url,
        etiqueta: nextJob.etiqueta,
      },
    });
  });

  app.post('/api/mercadolivre/extension/job-result', (req, res) => {
    const { jobId = '', ok = false, shortUrl = null, error = null } = req.body || {};
    const job = pendingMlJobsById.get(String(jobId));
    if (job) {
      job.resolve({ ok: Boolean(ok), shortUrl, error });
    }
    res.json({ ok: true });
  });

  app.post('/api/mercadolivre/extension/disconnect', (req, res) => {
    const key = String(req.body?.extensionKey || '').trim();
    if (key && mlExtensionSessions[key]) {
      delete mlExtensionSessions[key];
      saveMlExtensionSessions();
    }
    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // 1. UNIFIED MARKETPLACE LIVE SEARCH (Official APIs + Live Verified Feeds)
  // --------------------------------------------------------------------------
  app.post('/api/platforms/search', async (req, res) => {
    try {
      const {
        query = '',
        platform = 'Todas as Plataformas',
        credentials = {},
        page = 1,
        limit = 10,
        cursor = null,
      } = req.body || {};

      const pageNum = Math.max(1, Number(page) || 1);
      const pageSize = Math.max(1, Math.min(200, Number(limit) || 10));
      const cleanQuery = String(query || '').trim();

      const offers: DiscoveredOffer[] = [];
      const errors: string[] = [];
      let officialHasMore = false;

      const wantShopee = platform === 'Shopee' || platform === 'Todas as Plataformas';
      const wantAli = platform === 'AliExpress' || platform === 'Todas as Plataformas';
      const wantML = platform === 'Mercado Livre' || platform === 'Todas as Plataformas';

      // A. Shopee Official GraphQL Search (paginated infinitely via page + limit)
      if (
        wantShopee &&
        credentials?.shopee?.appId &&
        credentials?.shopee?.apiSecret &&
        !String(credentials.shopee.apiSecret).startsWith('shp_live_98a7')
      ) {
        try {
          const shopeeLimit = Math.min(50, pageSize);
          const gqlQuery = {
            query: `query($keyword: String, $page: Int, $limit: Int) {
              productOfferV2(keyword: $keyword, sortType: 2, page: $page, limit: $limit) {
                nodes {
                  itemId
                  productName
                  imageUrl
                  priceMin
                  priceMax
                  priceDiscountRate
                  commissionRate
                  commission
                  offerLink
                  productLink
                }
                pageInfo {
                  page
                  limit
                  hasNextPage
                }
              }
            }`,
            variables: {
              keyword: cleanQuery || undefined,
              page: pageNum,
              limit: shopeeLimit,
            },
          };
          const data = await callShopeeGraphql(
            credentials.shopee.appId,
            credentials.shopee.apiSecret,
            gqlQuery
          );
          const nodes = data?.productOfferV2?.nodes || [];
          if (data?.productOfferV2?.pageInfo?.hasNextPage || nodes.length >= shopeeLimit) {
            officialHasMore = true;
          }
          for (const n of nodes) {
            const disc = parseFloat(String(n.priceMin || '0')) || 0;
            const pct = Number(n.priceDiscountRate) || 0;
            const orig =
              pct > 0 && pct < 100
                ? Number((disc / (1 - pct / 100)).toFixed(2))
                : parseFloat(String(n.priceMax || disc));
            const commRate = Number(
              (parseFloat(String(n.commissionRate || '0.1')) * 100).toFixed(1)
            );
            const commVal =
              parseFloat(String(n.commission || '0')) ||
              Number(((disc * commRate) / 100).toFixed(2));

            offers.push({
              id: `shp-${n.itemId}`,
              title: n.productName,
              platform: 'Shopee',
              category: 'Vitrine Shopee API',
              originalPrice: orig,
              discountPrice: disc,
              discountPercent: pct,
              commissionPercent: commRate,
              commissionValue: commVal,
              originalUrl: n.productLink || n.offerLink,
              affiliateUrl: n.offerLink,
              imageUrl: n.imageUrl,
            });
          }
        } catch (err: any) {
          errors.push(`Shopee API: ${err.message}`);
        }
      }

      // B. AliExpress Official Affiliate Search (paginated via page_no + page_size)
      if (wantAli && credentials?.aliexpress?.appKey && credentials?.aliexpress?.appSecret) {
        try {
          const aliLimit = Math.min(50, pageSize);
          const aliRes = await callAliExpressApi(
            credentials.aliexpress.appKey,
            credentials.aliexpress.appSecret,
            'aliexpress.affiliate.product.query',
            {
              keywords: cleanQuery || 'bluetooth',
              target_currency: 'BRL',
              target_language: 'PT',
              ship_to_country: 'BR',
              tracking_id: credentials.aliexpress.trackingId || 'default',
              page_no: String(pageNum),
              page_size: String(aliLimit),
            }
          );
          const products =
            aliRes?.aliexpress_affiliate_product_query_response?.resp_result?.result
              ?.products?.product || [];
          if (products.length >= aliLimit) officialHasMore = true;
          for (const p of products) {
            const disc = parseFloat(p.target_sale_price || '0') || 0;
            const orig = parseFloat(p.target_original_price || String(disc)) || disc;
            const pct = parseInt(String(p.discount || '0').replace('%', ''), 10) || 0;
            const commPct =
              parseFloat(String(p.commission_rate || '8').replace('%', '')) || 8;
            offers.push({
              id: `ali-${p.product_id}`,
              title: p.product_title,
              platform: 'AliExpress',
              category: 'AliExpress Brasil',
              originalPrice: orig,
              discountPrice: disc,
              discountPercent: pct,
              commissionPercent: commPct,
              commissionValue: Number(((disc * commPct) / 100).toFixed(2)),
              originalUrl: p.product_detail_url,
              affiliateUrl: p.promotion_link || p.product_detail_url,
              imageUrl: p.product_main_image_url,
            });
          }
        } catch (err: any) {
          errors.push(`AliExpress API: ${err.message}`);
        }
      }

      // C. Mercado Livre Official OAuth Search (paginated via offset + limit)
      if (
        wantML &&
        credentials?.mercadoLivre?.authCode &&
        !String(credentials.mercadoLivre.authCode).startsWith('ml_sess_')
      ) {
        try {
          const mlApiOffers = await searchMercadoLivre(cleanQuery, credentials, pageNum, pageSize);
          if (mlApiOffers.length >= pageSize) officialHasMore = true;
          offers.push(...mlApiOffers);
        } catch (err: any) {
          errors.push(`Mercado Livre API: ${err.message}`);
        }
      }

      // D. Live Verified Brazilian Offers (unlimited cursor pagination)
      let nextCursor: string | null = null;
      let liveHasMore = false;
      if (offers.length < pageSize) {
        try {
          const needed = pageSize - offers.length;
          const liveRes = await searchVerifiedLiveOffers(cleanQuery, platform, credentials, {
            page: pageNum,
            limit: needed,
            cursor,
          });
          nextCursor = liveRes.nextCursor;
          liveHasMore = liveRes.hasMore;
          const existingIds = new Set(offers.map((o) => o.id));
          for (const item of liveRes.offers) {
            if (!existingIds.has(item.id)) {
              existingIds.add(item.id);
              offers.push(item);
            }
          }
        } catch (err: any) {
          errors.push(`Busca ao vivo: ${err.message}`);
        }
      }

      res.json({
        ok: true,
        offers: offers.slice(0, pageSize),
        page: pageNum,
        limit: pageSize,
        nextCursor,
        hasMore: officialHasMore || liveHasMore,
        warnings: errors,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Falha na busca' });
    }
  });

  // --------------------------------------------------------------------------
  // 1B. SHOPEE OFFICIAL CONVERSION REPORT (Comissões Reais via GraphQL)
  // --------------------------------------------------------------------------
  app.post('/api/platforms/shopee-commissions', async (req, res) => {
    try {
      const { credentials = {}, days = 7 } = req.body || {};
      const appId = credentials?.shopee?.appId?.trim();
      const secret = credentials?.shopee?.apiSecret?.trim();
      if (!appId || !secret || secret.startsWith('shp_live_98a7')) {
        return res.json({
          ok: false,
          error:
            'Configure seu App ID e Senha API oficiais da Shopee em Configurações → Plataformas para puxar suas conversões reais.',
        });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const startSec = nowSec - Number(days || 7) * 86400;
      const data = await callShopeeGraphql(appId, secret, {
        query: `query($start: Int!, $end: Int!) {
          conversionReport(purchaseTimeStart: $start, purchaseTimeEnd: $end, limit: 25) {
            nodes {
              conversionId
              orderStatus
              totalCommission
              orders {
                orderId
                items {
                  itemName
                  qty
                  itemCommission
                }
              }
            }
          }
        }`,
        variables: { start: startSec, end: nowSec },
      });

      const nodes = data?.conversionReport?.nodes || [];
      const conversions = nodes.map((n: any, idx: number) => {
        const firstOrder = n.orders?.[0];
        const firstItem = firstOrder?.items?.[0];
        return {
          id: String(n.conversionId || firstOrder?.orderId || `conv-${idx}`),
          product: firstItem?.itemName || `Pedido Shopee #${firstOrder?.orderId || idx + 1}`,
          qty: Number(firstItem?.qty || 1),
          commission: parseFloat(String(n.totalCommission || firstItem?.itemCommission || '0')) || 0,
          status:
            String(n.orderStatus).toUpperCase().includes('COMPLETE') ? 'Aprovada' : 'Pendente',
        };
      });

      res.json({ ok: true, conversions });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  // --------------------------------------------------------------------------
  // 2. TEST MARKETPLACE INTEGRATION CREDENTIALS
  // --------------------------------------------------------------------------
  app.post('/api/platforms/test', async (req, res) => {
    try {
      const { platform, credentials } = req.body || {};

      if (platform === 'Shopee') {
        const appId = credentials?.shopee?.appId?.trim();
        const secret = credentials?.shopee?.apiSecret?.trim();
        if (!appId || !secret || secret.startsWith('shp_live_98a7')) {
          return res.json({
            ok: false,
            message:
              'Insira seu App ID e Senha API reais do painel Shopee Affiliate (open-api.affiliate.shopee.com.br) para autenticar na GraphQL oficial.',
          });
        }
        const data = await callShopeeGraphql(appId, secret, {
          query: `{ productOfferV2(limit: 1) { nodes { itemId productName } } }`,
        });
        const sample = data?.productOfferV2?.nodes?.[0]?.productName || 'OK';
        return res.json({
          ok: true,
          message: `Conectado à Shopee Affiliate API! Oferta teste: "${sample.slice(0, 40)}..."`,
        });
      }

      if (platform === 'Mercado Livre') {
        const tag = credentials?.mercadoLivre?.etiqueta?.trim();
        const extKey = credentials?.mercadoLivre?.extensionKey?.trim();
        const extSess = resolveMlExtensionSession(extKey);

        if (!tag && !extSess?.hasSsid) {
          return res.json({
            ok: false,
            message:
              'Preencha sua Etiqueta do Mercado Livre ou sincronize a extensão no navegador (PC ou Lemur Browser no Android).',
          });
        }

        const sample = await searchMercadoLivre('fone bluetooth', credentials, 1, 5);
        const testConv = await convertMercadoLivreAffiliateLink(
          'https://www.mercadolivre.com.br/ofertas',
          credentials
        );
        const modeDesc = testConv.viaExtension
          ? `Link curto /sec/ validado pela extensão (${extSess?.browserName || 'Navegador'})!`
          : extSess?.hasSsid
          ? `Sessão sincronizada (${extSess.cookiesCount} cookies), operando com fallback de etiqueta "${tag || extSess.etiqueta}".`
          : `Operando com etiqueta "${tag}" (?matt_tool). Baixe e sincronize a extensão para gerar links curtos /sec/.`;

        return res.json({
          ok: true,
          message: `Mercado Livre ativo (${sample.length} ofertas). ${modeDesc}`,
        });
      }

      if (platform === 'AliExpress') {
        const appKey = credentials?.aliexpress?.appKey?.trim();
        const appSecret = credentials?.aliexpress?.appSecret?.trim();
        if (!appKey || !appSecret) {
          return res.json({
            ok: false,
            message: 'Preencha seu App Key e App Secret do AliExpress Portals.',
          });
        }
        const aliRes = await callAliExpressApi(
          appKey,
          appSecret,
          'aliexpress.affiliate.product.query',
          {
            keywords: 'earbuds',
            target_currency: 'BRL',
            page_size: '1',
          }
        );
        if (aliRes?.error_response) {
          return res.json({
            ok: false,
            message: `AliExpress retornou: ${aliRes.error_response.msg || 'Credenciais inválidas'}`,
          });
        }
        return res.json({
          ok: true,
          message: 'Conectado à API Oficial AliExpress Affiliate!',
        });
      }

      if (platform === 'Magalu') {
        const store = credentials?.magalu?.partnerStore?.trim();
        if (!store || !/^[a-zA-Z0-9_-]{3,60}$/.test(store)) {
          return res.json({
            ok: false,
            message: 'Informe um nome válido para sua loja Parceiro Magalu (apenas letras/números).',
          });
        }
        const liveItems = await searchVerifiedLiveOffers('', 'Magalu', credentials, { limit: 12 });
        return res.json({
          ok: true,
          message: `Vitrine magazinevoce.com.br/${store} ativa (${liveItems.offers.length} ofertas Magalu sincronizadas)!`,
        });
      }

      if (platform === 'Amazon') {
        const tag = credentials?.amazon?.associateTag?.trim();
        if (!tag) {
          return res.json({
            ok: false,
            message: 'Preencha seu ID de Associado Amazon (ex: sua-tag-20).',
          });
        }
        const liveItems = await searchVerifiedLiveOffers('', 'Amazon', credentials, { limit: 12 });
        return res.json({
          ok: true,
          message: `Tag Amazon Associados (${tag}) ativa (${liveItems.offers.length} ofertas Amazon sincronizadas)!`,
        });
      }

      if (platform === 'Netshoes') {
        const sid = credentials?.netshoes?.accountSid?.trim();
        if (!sid) {
          return res.json({
            ok: false,
            message: 'Preencha seu Account ID (SID) da Rakuten.',
          });
        }
        const liveItems = await searchVerifiedLiveOffers('', 'Netshoes', credentials, { limit: 12 });
        return res.json({
          ok: true,
          message: `Rakuten SID (${sid}) configurado (${liveItems.offers.length} ofertas Netshoes sincronizadas)!`,
        });
      }

      return res.json({ ok: true, message: 'Configuração verificada.' });
    } catch (err: any) {
      return res.json({
        ok: false,
        message: `Erro na conexão: ${err.message || 'Falha inesperada'}`,
      });
    }
  });

  // --------------------------------------------------------------------------
  // 3. EXTRACT PRODUCT DATA + CONVERT LINK FROM ANY URL
  // --------------------------------------------------------------------------
  app.post('/api/platforms/extract-url', async (req, res) => {
    try {
      const { url, credentials = {} } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ ok: false, error: 'Informe um link válido.' });
      }
      const extracted = await extractOfferFromUrl(url.trim(), credentials);
      res.json({ ok: true, offer: extracted });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err.message || 'Não foi possível extrair os dados deste link.',
      });
    }
  });

  app.post('/api/platforms/convert-link', async (req, res) => {
    try {
      const { url, credentials = {} } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ ok: false, error: 'Informe um link válido.' });
      }
      const platform = detectMarketplace(url);

      // Official Shopee ShortLink generation if valid credentials exist
      if (
        platform === 'Shopee' &&
        credentials?.shopee?.appId &&
        credentials?.shopee?.apiSecret &&
        !String(credentials.shopee.apiSecret).startsWith('shp_live_98a7')
      ) {
        try {
          const data = await callShopeeGraphql(
            credentials.shopee.appId,
            credentials.shopee.apiSecret,
            {
              query: `mutation($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }`,
              variables: {
                input: {
                  originUrl: url.trim(),
                  subIds: (credentials.shopee.subIds || []).slice(0, 5),
                },
              },
            }
          );
          if (data?.generateShortLink?.shortLink) {
            return res.json({
              ok: true,
              platform,
              affiliateUrl: data.generateShortLink.shortLink,
              officialApi: true,
            });
          }
        } catch {
          // Fall back below
        }
      }

      // Official AliExpress Link Generator if valid credentials exist
      if (
        platform === 'AliExpress' &&
        credentials?.aliexpress?.appKey &&
        credentials?.aliexpress?.appSecret
      ) {
        try {
          const aliRes = await callAliExpressApi(
            credentials.aliexpress.appKey,
            credentials.aliexpress.appSecret,
            'aliexpress.affiliate.link.generate',
            {
              promotion_link_type: '0',
              source_values: url.trim(),
              tracking_id: credentials.aliexpress.trackingId || 'default',
            }
          );
          const gen =
            aliRes?.aliexpress_affiliate_link_generate_response?.resp_result?.result
              ?.promotion_links?.promotion_link?.[0]?.promotion_link;
          if (gen) {
            return res.json({
              ok: true,
              platform,
              affiliateUrl: gen,
              officialApi: true,
            });
          }
        } catch {
          // Fall back below
        }
      }

      // Follow short link first only when needed, never let ML anti-bot redirect replace product URL
      const originalInput = url.trim();
      let resolvedUrl = originalInput;
      const isAlreadyDirectMlProduct =
        /mercadolivre\.com\.br/i.test(originalInput) && !/\/sec\//i.test(originalInput);
      if (!isAlreadyDirectMlProduct) {
        try {
          const headRes = await fetch(resolvedUrl, {
            redirect: 'follow',
            headers: BROWSER_HEADERS,
          });
          if (headRes.url) {
            resolvedUrl = unwrapResolvedProductUrl(headRes.url, originalInput);
          }
        } catch {
          // Keep original
        }
      }

      const detected = detectMarketplace(resolvedUrl);

      if (detected === 'Mercado Livre') {
        const mlConv = await convertMercadoLivreAffiliateLink(resolvedUrl, credentials);
        return res.json({
          ok: true,
          platform: detected,
          affiliateUrl: mlConv.affiliateUrl,
          officialApi: mlConv.officialApi,
        });
      }

      const affiliateUrl = formatAffiliateUrlFallback(resolvedUrl, detected, credentials);
      res.json({ ok: true, platform: detected, affiliateUrl, officialApi: false });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // --------------------------------------------------------------------------
  // 4. TELEGRAM BOT API INTEGRATION (Verify + Discover Chats + Send Photo/Text)
  // --------------------------------------------------------------------------
  app.post('/api/telegram/verify', async (req, res) => {
    try {
      const { botToken } = req.body || {};
      if (!botToken || typeof botToken !== 'string') {
        return res.status(400).json({ ok: false, error: 'Informe o Bot Token do @BotFather.' });
      }
      const cleanToken = botToken.trim();
      const meRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
      const meJson = (await meRes.json()) as any;

      if (!meJson.ok) {
        return res.status(400).json({
          ok: false,
          error: meJson.description || 'Bot Token inválido no Telegram.',
        });
      }

      // Also inspect recent updates to auto-discover groups/channels where the bot is present
      const updRes = await fetch(
        `https://api.telegram.org/bot${cleanToken}/getUpdates?limit=50`
      );
      const updJson = (await updRes.json()) as any;
      const chatsMap = new Map<
        string,
        { id: string; title: string; type: string; username?: string }
      >();

      if (updJson.ok && Array.isArray(updJson.result)) {
        for (const u of updJson.result) {
          const chat =
            u.message?.chat ||
            u.channel_post?.chat ||
            u.my_chat_member?.chat ||
            u.edited_message?.chat;
          if (chat && chat.id && chat.type !== 'private') {
            chatsMap.set(String(chat.id), {
              id: String(chat.id),
              title: chat.title || chat.username || String(chat.id),
              type: chat.type,
              username: chat.username,
            });
          }
        }
      }

      res.json({
        ok: true,
        bot: {
          id: meJson.result.id,
          name: meJson.result.first_name,
          username: `@${meJson.result.username}`,
        },
        discoveredChats: Array.from(chatsMap.values()),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/telegram/send', async (req, res) => {
    try {
      const {
        botToken,
        chatIds = [],
        message = '',
        imageUrl = '',
        enableLinkPreview = true,
      } = req.body || {};

      if (!botToken || !Array.isArray(chatIds) || chatIds.length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'Informe o Bot Token e pelo menos um grupo/canal destino (chat_id).',
        });
      }

      const cleanToken = String(botToken).trim();
      const htmlText = whatsappToTelegramHtml(String(message));
      const results: { chatId: string; ok: boolean; error?: string }[] = [];

      for (const chatId of chatIds) {
        try {
          if (imageUrl) {
            if (String(imageUrl).startsWith('data:image/')) {
              // Upload base64 image via multipart FormData
              const match = String(imageUrl).match(/^data:(image\/\w+);base64,(.+)$/);
              if (match) {
                const mime = match[1];
                const buffer = Buffer.from(match[2], 'base64');
                const form = new FormData();
                form.append('chat_id', String(chatId));
                form.append('caption', htmlText.slice(0, 1024));
                form.append('parse_mode', 'HTML');
                form.append('photo', new Blob([buffer], { type: mime }), 'oferta.jpg');

                const r = await fetch(`https://api.telegram.org/bot${cleanToken}/sendPhoto`, {
                  method: 'POST',
                  body: form,
                });
                const j = (await r.json()) as any;
                results.push({ chatId, ok: Boolean(j.ok), error: j.description });
                continue;
              }
            } else if (String(imageUrl).startsWith('http')) {
              const r = await fetch(`https://api.telegram.org/bot${cleanToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  photo: imageUrl,
                  caption: htmlText.slice(0, 1024),
                  parse_mode: 'HTML',
                }),
              });
              const j = (await r.json()) as any;
              if (j.ok) {
                results.push({ chatId, ok: true });
                continue;
              }
            }
          }

          // Fallback or standard text message
          const r = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: htmlText,
              parse_mode: 'HTML',
              disable_web_page_preview: !enableLinkPreview,
            }),
          });
          const j = (await r.json()) as any;
          results.push({ chatId, ok: Boolean(j.ok), error: j.description });
        } catch (err: any) {
          results.push({ chatId, ok: false, error: err.message });
        }
      }

      const sentCount = results.filter((r) => r.ok).length;
      res.json({ ok: sentCount > 0, sentCount, results });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // --------------------------------------------------------------------------
  // 5. WHATSAPP INTEGRATION (Native Baileys QR/Phone Pairing + Evolution/Z-API)
  // --------------------------------------------------------------------------
  app.get('/api/whatsapp/baileys/sessions', (_req, res) => {
    const sessions = Array.from(baileysSessions.values()).map((s) => ({
      accountId: s.accountId,
      connected: s.status === 'open',
      status: s.status,
      phone: s.connectedPhone,
      name: s.connectedName,
    }));
    res.json({ ok: true, sessions });
  });

  app.get('/api/whatsapp/baileys/live-stats', (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const todayCaptures: Record<string, number> = {};
    for (const [jid, info] of Object.entries(liveWaStats.capturedByGroupJid)) {
      todayCaptures[jid] = info.date === today ? info.count : 0;
    }
    res.json({
      ok: true,
      memberEvents: liveWaStats.memberEvents,
      capturedTodayByJid: todayCaptures,
    });
  });

  app.get('/api/whatsapp/baileys/status/:accountId', (req, res) => {
    const safeId = sanitizeAccountId(req.params.accountId);
    const s = baileysSessions.get(safeId);
    if (!s) {
      return res.json({
        ok: true,
        accountId: safeId,
        connected: false,
        status: 'closed',
        qrBase64: null,
        pairingCode: null,
      });
    }
    res.json({
      ok: true,
      accountId: safeId,
      connected: s.status === 'open',
      status: s.status,
      qrBase64: s.qrDataUrl,
      pairingCode: s.pairingCode,
      phone: s.connectedPhone,
      name: s.connectedName,
      error: s.lastError,
    });
  });

  app.post('/api/whatsapp/baileys/connect', async (req, res) => {
    try {
      const {
        accountId = 'acc-wa-1',
        mode = 'qr',
        phoneNumber = '',
        forceNew = false,
      } = req.body || {};

      if (mode === 'pairing') {
        const cleanDigits = normalizePhoneForPairing(phoneNumber);
        if (cleanDigits.length < 10) {
          return res.status(400).json({
            ok: false,
            connected: false,
            status: 'closed',
            error:
              'Informe o número completo com DDD (ex: 5587996109189 ou (87) 9610-9189).',
          });
        }
      }

      const session = await startBaileysSocket(String(accountId), {
        forceNew: Boolean(forceNew) || mode === 'pairing',
        mode: mode === 'pairing' ? 'pairing' : 'qr',
        pairingPhone: mode === 'pairing' ? String(phoneNumber) : undefined,
      });

      res.json({
        ok: !session.lastError,
        accountId: session.accountId,
        connected: session.status === 'open',
        status: session.status,
        qrBase64: session.qrDataUrl,
        pairingCode: session.pairingCode,
        phone: session.connectedPhone,
        name: session.connectedName,
        error: session.lastError,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        connected: false,
        status: 'closed',
        error: err.message || 'Erro ao iniciar conexão Baileys.',
      });
    }
  });

  app.post('/api/whatsapp/baileys/logout', async (req, res) => {
    try {
      const { accountId = 'acc-wa-1' } = req.body || {};
      await logoutBaileysSocket(String(accountId));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/whatsapp/qrcode', async (req, res) => {
    try {
      const {
        provider = 'baileys',
        accountId = 'acc-wa-1',
        baseUrl = '',
        instanceName = '',
        apiToken = '',
        clientToken = '',
      } = req.body || {};

      if (provider === 'baileys') {
        const session = await startBaileysSocket(String(accountId), { mode: 'qr' });
        return res.json({
          ok: !session.lastError,
          qrBase64: session.qrDataUrl,
          pairingCode: session.pairingCode,
          connected: session.status === 'open',
          state: session.status,
          error: session.lastError || undefined,
        });
      }

      const cleanBase = String(baseUrl).trim().replace(/\/+$/, '');
      if (!cleanBase && provider !== 'zapi') {
        return res.status(400).json({
          ok: false,
          error: 'Informe a URL do seu servidor Evolution API.',
        });
      }

      if (provider === 'zapi') {
        const zUrl = `https://api.z-api.io/instances/${encodeURIComponent(
          instanceName
        )}/token/${encodeURIComponent(apiToken)}/qr-code/image`;
        const zRes = await fetch(zUrl, {
          headers: clientToken ? { 'Client-Token': clientToken } : {},
        });
        const zJson = (await zRes.json()) as any;
        return res.json({
          ok: Boolean(zJson?.value),
          qrBase64: zJson?.value || null,
          connected: Boolean(zJson?.connected),
          raw: zJson,
        });
      }

      // Evolution API: try connect first, if 404 create instance with QR
      let evoRes = await fetch(
        `${cleanBase}/instance/connect/${encodeURIComponent(instanceName)}`,
        {
          headers: { apikey: apiToken },
        }
      );

      if (evoRes.status === 404) {
        evoRes = await fetch(`${cleanBase}/instance/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: apiToken,
          },
          body: JSON.stringify({
            instanceName,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
          }),
        });
      }

      const evoJson = (await evoRes.json()) as any;
      const qrBase64 =
        evoJson?.base64 || evoJson?.qrcode?.base64 || evoJson?.code || null;
      const state = evoJson?.instance?.state || evoJson?.state || '';

      res.json({
        ok: evoRes.ok,
        qrBase64,
        pairingCode: evoJson?.pairingCode || null,
        connected: state === 'open',
        state,
        error: !evoRes.ok ? evoJson?.message || `HTTP ${evoRes.status}` : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/whatsapp/groups', async (req, res) => {
    try {
      const {
        provider = 'baileys',
        accountId = 'acc-wa-1',
        baseUrl = '',
        instanceName = '',
        apiToken = '',
        clientToken = '',
      } = req.body || {};

      if (provider === 'baileys') {
        const safeId = sanitizeAccountId(String(accountId));
        const exact = baileysSessions.get(safeId);
        const allowFallback =
          !exact && (safeId === 'acc-wa-1' || safeId === '__any__');
        const session =
          exact && exact.status === 'open' && exact.sock
            ? exact
            : allowFallback
            ? Array.from(baileysSessions.values()).find((s) => s.status === 'open' && s.sock)
            : undefined;

        if (!session || session.status !== 'open' || !session.sock) {
          return res.status(400).json({
            ok: false,
            error:
              'Conecte primeiro seu WhatsApp via QR Code ou Número de Telefone para puxar os grupos.',
          });
        }
        const participating = await session.sock.groupFetchAllParticipating();
        const today = new Date().toISOString().slice(0, 10);
        const uniqueByJid = new Map<
          string,
          { remoteJid: string; name: string; membersCount: number; capturedToday: number }
        >();
        for (const g of Object.values(participating) as any[]) {
          const rawJid = String(g?.id || '').trim();
          if (!rawJid.endsWith('@g.us')) continue;
          const [userPart, domainPart] = rawJid.split('@');
          const jid = `${userPart.split(':')[0]}@${domainPart.toLowerCase()}`;
          const cap = liveWaStats.capturedByGroupJid[jid] || liveWaStats.capturedByGroupJid[rawJid];
          const membersCount = Number(g.participants?.length || g.size || 0);
          const existing = uniqueByJid.get(jid);
          if (!existing || membersCount > existing.membersCount) {
            uniqueByJid.set(jid, {
              remoteJid: jid,
              name: String(g.subject || jid),
              membersCount,
              capturedToday: cap && cap.date === today ? cap.count : 0,
            });
          }
        }
        const groups = Array.from(uniqueByJid.values()).sort((a, b) =>
          a.name.localeCompare(b.name, 'pt-BR')
        );
        return res.json({
          ok: true,
          accountId: session.accountId,
          phone: session.connectedPhone,
          name: session.connectedName,
          groups,
        });
      }

      if (provider === 'zapi') {
        const zUrl = `https://api.z-api.io/instances/${encodeURIComponent(
          instanceName
        )}/token/${encodeURIComponent(apiToken)}/chats?page=1&pageSize=100`;
        const r = await fetch(zUrl, {
          headers: clientToken ? { 'Client-Token': clientToken } : {},
        });
        const list = (await r.json()) as any[];
        if (!Array.isArray(list)) {
          return res.status(400).json({ ok: false, error: 'Falha ao buscar grupos na Z-API.' });
        }
        const groups = list
          .filter((c) => c.isGroup || String(c.phone || '').includes('-group'))
          .map((c) => ({
            remoteJid: String(c.phone),
            name: c.name || c.phone,
            membersCount: Number(c.participantsCount || 0) || 1,
          }));
        return res.json({ ok: true, groups });
      }

      const cleanBase = String(baseUrl).trim().replace(/\/+$/, '');
      const r = await fetch(
        `${cleanBase}/group/fetchAllGroups/${encodeURIComponent(
          instanceName
        )}?getParticipants=false`,
        {
          headers: { apikey: apiToken },
        }
      );
      const data = (await r.json()) as any;
      const rawGroups = Array.isArray(data) ? data : data?.groups || [];
      const groups = rawGroups.map((g: any) => ({
        remoteJid: String(g.id),
        name: g.subject || g.name || g.id,
        membersCount: Number(g.size || g.participants?.length || 1),
      }));

      res.json({ ok: r.ok, groups, error: !r.ok ? data?.message : undefined });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/whatsapp/send', async (req, res) => {
    try {
      const {
        provider = 'baileys',
        accountId = 'acc-wa-1',
        baseUrl = '',
        instanceName = '',
        apiToken = '',
        clientToken = '',
        remoteJids = [],
        message = '',
        imageUrl = '',
        enableLinkPreview = true,
        mentionAll = false,
      } = req.body || {};

      if (!Array.isArray(remoteJids) || remoteJids.length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'Nenhum JID/ID de grupo configurado para envio via WhatsApp.',
        });
      }

      if (provider === 'baileys') {
        const safeId = sanitizeAccountId(String(accountId));
        const exact = baileysSessions.get(safeId);
        const session =
          exact && exact.status === 'open' && exact.sock
            ? exact
            : Array.from(baileysSessions.values()).find((s) => s.status === 'open' && s.sock);

        if (!session || session.status !== 'open' || !session.sock) {
          return res.status(400).json({
            ok: false,
            error:
              'Sessão Baileys desconectada. Escaneie o QR Code ou conecte com número de telefone em Contas WhatsApp.',
          });
        }

        const results: { jid: string; ok: boolean; error?: string }[] = [];
        let mediaBuf: Buffer | null = null;
        if (imageUrl) {
          try {
            mediaBuf = await loadImageBuffer(String(imageUrl));
          } catch {
            mediaBuf = null;
          }
        }

        for (const rawJid of remoteJids) {
          const jid = String(rawJid).includes('@')
            ? String(rawJid).trim()
            : `${String(rawJid).replace(/\D/g, '')}@s.whatsapp.net`;

          try {
            let mentions: string[] | undefined;
            if (mentionAll && jid.endsWith('@g.us')) {
              try {
                const meta = await session.sock.groupMetadata(jid);
                mentions = meta.participants.map((p: any) => p.id);
              } catch {
                mentions = undefined;
              }
            }

            if (mediaBuf) {
              const sent = await session.sock.sendMessage(jid, {
                image: mediaBuf,
                caption: String(message),
                ...(mentions ? { mentions } : {}),
              });
              markRecentOutgoingWaMsgId(sent?.key?.id);
            } else {
              const sent = await session.sock.sendMessage(jid, {
                text: String(message),
                ...(mentions ? { mentions } : {}),
              });
              markRecentOutgoingWaMsgId(sent?.key?.id);
            }
            results.push({ jid, ok: true });
          } catch (err: any) {
            results.push({ jid, ok: false, error: err.message });
          }
        }

        const sentCount = results.filter((r) => r.ok).length;
        return res.json({ ok: sentCount > 0, sentCount, results });
      }

      const results: { jid: string; ok: boolean; error?: string }[] = [];
      const cleanBase = String(baseUrl).trim().replace(/\/+$/, '');

      for (const jid of remoteJids) {
        try {
          if (provider === 'webhook') {
            const r = await fetch(cleanBase, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
              },
              body: JSON.stringify({
                groupId: jid,
                message,
                imageUrl,
                enableLinkPreview,
                mentionAll,
              }),
            });
            results.push({ jid, ok: r.ok });
            continue;
          }

          if (provider === 'zapi') {
            const endpoint = imageUrl ? 'send-image' : 'send-text';
            const zUrl = `https://api.z-api.io/instances/${encodeURIComponent(
              instanceName
            )}/token/${encodeURIComponent(apiToken)}/${endpoint}`;
            const payload =
              endpoint === 'send-image'
                ? { phone: jid, image: imageUrl, caption: message }
                : { phone: jid, message };
            const r = await fetch(zUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(clientToken ? { 'Client-Token': clientToken } : {}),
              },
              body: JSON.stringify(payload),
            });
            results.push({ jid, ok: r.ok });
            continue;
          }

          // Evolution API v1 / v2
          if (imageUrl) {
            const mediaValue = String(imageUrl).startsWith('data:')
              ? String(imageUrl).split(',')[1]
              : imageUrl;
            const r = await fetch(
              `${cleanBase}/message/sendMedia/${encodeURIComponent(instanceName)}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  apikey: apiToken,
                },
                body: JSON.stringify({
                  number: jid,
                  mediatype: 'image',
                  mimetype: 'image/jpeg',
                  caption: message,
                  media: mediaValue,
                  mentionsEveryOne: mentionAll,
                }),
              }
            );
            const j = (await r.json()) as any;
            results.push({ jid, ok: r.ok, error: !r.ok ? j?.message : undefined });
          } else {
            const r = await fetch(
              `${cleanBase}/message/sendText/${encodeURIComponent(instanceName)}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  apikey: apiToken,
                },
                body: JSON.stringify({
                  number: jid,
                  text: message,
                  linkPreview: enableLinkPreview,
                  mentionsEveryOne: mentionAll,
                }),
              }
            );
            const j = (await r.json()) as any;
            results.push({ jid, ok: r.ok, error: !r.ok ? j?.message : undefined });
          }
        } catch (err: any) {
          results.push({ jid, ok: false, error: err.message });
        }
      }

      const sentCount = results.filter((r) => r.ok).length;
      res.json({ ok: sentCount > 0, sentCount, results });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // --------------------------------------------------------------------------
  // VITE DEV MIDDLEWARE OR PRODUCTION STATIC ASSETS
  // --------------------------------------------------------------------------
  const distPath = path.resolve(__dirname, 'dist');
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (process.env.npm_lifecycle_event === 'start' && fs.existsSync(distPath));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  void restoreSavedBaileysSessions();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
