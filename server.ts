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
  downloadMediaMessage,
  prepareWAMessageMedia,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { buildMercadoLivreExtensionZip } from './mlExtensionBuilder.ts';
import {
  buildWhatsAppLinkPreviewMeta,
  cleanMarketplaceProductUrl,
  cleanOfferTitle,
  extractCouponFromMessageText,
  extractMercadoLivrePricingFromHtml,
  extractMercadoLivreProductUrlFromHtml,
  extractShopeeIdsFromUrl,
  isMercadoLivreProductUrl,
  isOfficialShortAffiliateLink,
  needsAffiliateReconversion,
  sanitizeShopeeOriginUrl,
  sanitizeShopeeSubIds,
} from './src/utils/affiliateUrlRules.ts';
import {
  FALLBACK_PLATFORM_CATEGORIES,
  PLATFORM_CYCLE_ORDER,
  type PlatformCategory,
  offerMatchesSearchPlan,
  offerMatchesTokens,
  parseMercadoLivreCategoriesHtml,
  parsePromobitCategoriesJson,
  parseShopeeCategoryTreeJson,
  pickStrictRoundRobinPage,
  resolveCategorySearchPlan,
} from './src/utils/catalogCategories.ts';
import {
  getHighResImageCandidateUrls,
  standardizeProductImageBuffer,
  type StandardizedProductImage,
} from './src/utils/imageStandardizer.ts';
import {
  getBrazilTimeInfo,
  isWithinDispatchWindow,
  pickRandomInt,
  resolveActiveDispatchTargets,
  selectProductsForAutoDispatch,
} from './src/utils/autoDispatchEngine.ts';
import { renderProductMessage } from './src/utils/templateEngine.ts';
import {
  INITIAL_AUTO_DISPATCH,
  INITIAL_INTEGRATIONS,
  INITIAL_MONITORING_RULES,
  INITIAL_TEMPLATES,
} from './src/data/initialData.ts';
import { detectGroupAdminRole } from './src/utils/memberMonitorAnalytics.ts';
import {
  DEFAULT_SEGMENT,
  createDefaultAutoDispatchForSegment,
  createDefaultMonitoringRulesForSegment,
  createDefaultTemplatesForSegment,
  dedupeSegmentNames,
  getGroupActiveSegments,
  getGroupMonitoredSegments,
  matchesSegment,
  normalizeSegmentName,
  resolveSegmentConfig,
} from './src/utils/segmentScoping.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const WA_SESSIONS_ROOT = path.resolve(__dirname, '.wa_sessions');
const CAPTURED_MEDIA_DIR = path.join(WA_SESSIONS_ROOT, 'captured_media');
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

async function expandShortUrlManually(
  rawUrl: string,
  maxHops = 6
): Promise<string> {
  let current = rawUrl.trim();
  for (let hop = 0; hop < maxHops; hop++) {
    try {
      const r = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(5500),
      });
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) {
        const nextUrl = new URL(loc, current).toString();
        const unwrapped = unwrapResolvedProductUrl(nextUrl, current);
        if (unwrapped === current) break;
        current = unwrapped;
        // Stop immediately once we hit a canonical Shopee product/opaanlp URL
        if (extractShopeeIdsFromUrl(current)) break;
        continue;
      }
      break;
    } catch {
      break;
    }
  }
  return current;
}

async function resolveCleanMercadoLivreProductUrl(
  rawUrl: string,
  htmlHint?: string
): Promise<string> {
  const input = unwrapResolvedProductUrl(rawUrl.trim(), rawUrl.trim());
  if (isMercadoLivreProductUrl(input)) {
    return cleanMarketplaceProductUrl(input, 'Mercado Livre');
  }

  if (htmlHint) {
    const fromHint = extractMercadoLivreProductUrlFromHtml(htmlHint);
    if (fromHint) return fromHint;
  }

  try {
    const res = await fetch(input, {
      redirect: 'follow',
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    const landed = res.url ? unwrapResolvedProductUrl(res.url, input) : input;
    if (isMercadoLivreProductUrl(landed)) {
      return cleanMarketplaceProductUrl(landed, 'Mercado Livre');
    }
    if (res.ok) {
      const html = await res.text();
      const extracted = extractMercadoLivreProductUrlFromHtml(html);
      if (extracted) return extracted;
    }
    return cleanMarketplaceProductUrl(landed, 'Mercado Livre');
  } catch {
    return cleanMarketplaceProductUrl(input, 'Mercado Livre');
  }
}

async function fetchShopeeProductOfferByItemId(
  itemId: string,
  credentials: any
): Promise<{
  title: string;
  imageUrl: string;
  discountPrice: number;
  originalPrice: number;
  discountPercent: number;
  offerLink: string;
  productLink: string;
} | null> {
  if (
    !itemId ||
    !/^\d+$/.test(itemId) ||
    !credentials?.shopee?.appId ||
    !credentials?.shopee?.apiSecret ||
    String(credentials.shopee.apiSecret).startsWith('shp_live_98a7')
  ) {
    return null;
  }
  try {
    const data = await callShopeeGraphql(
      credentials.shopee.appId,
      credentials.shopee.apiSecret,
      {
        query: `{ productOfferV2(itemId: ${itemId}, limit: 1) { nodes { itemId shopId productName imageUrl priceMin priceMax priceDiscountRate commissionRate offerLink productLink } } }`,
      }
    );
    const node = data?.productOfferV2?.nodes?.[0];
    if (!node) return null;
    const disc = parseFloat(String(node.priceMin || node.priceMax || '0')) || 0;
    const pct = Math.max(0, Math.min(95, Number(node.priceDiscountRate) || 0));
    const orig =
      pct > 0 && disc > 0
        ? Number((disc / (1 - pct / 100)).toFixed(2))
        : Math.max(disc, parseFloat(String(node.priceMax || '0')) || disc);
    return {
      title: String(node.productName || '').trim(),
      imageUrl: String(node.imageUrl || '').trim(),
      discountPrice: disc,
      originalPrice: orig,
      discountPercent: pct,
      offerLink: String(node.offerLink || '').trim(),
      productLink: String(node.productLink || '').trim(),
    };
  } catch {
    return null;
  }
}

async function convertShopeeAffiliateLink(
  rawUrl: string,
  credentials: any
): Promise<{
  affiliateUrl: string;
  cleanProductUrl: string;
  officialApi: boolean;
  shopId?: string;
  itemId?: string;
}> {
  let resolved = rawUrl.trim();
  const isShortShopee =
    /(?:^https?:\/\/)?(?:s\.shopee\.com\.br|shope\.ee|(?:[a-z]{2}\.)?shp\.ee|shpe\.site)\//i.test(
      resolved
    );
  if (isShortShopee || !extractShopeeIdsFromUrl(resolved)) {
    resolved = await expandShortUrlManually(resolved, 6);
  }

  const validOriginUrl = sanitizeShopeeOriginUrl(resolved);
  const ids = extractShopeeIdsFromUrl(validOriginUrl || resolved);
  const cleanProductUrl =
    validOriginUrl || cleanMarketplaceProductUrl(resolved, 'Shopee');

  const hasValidShopeeCreds =
    Boolean(credentials?.shopee?.appId) &&
    Boolean(credentials?.shopee?.apiSecret) &&
    !String(credentials.shopee.apiSecret).startsWith('shp_live_98a7');

  if (hasValidShopeeCreds) {
    if (validOriginUrl) {
      const safeSubIds = sanitizeShopeeSubIds(credentials?.shopee?.subIds);
      const attempts: Array<{ originUrl: string; subIds?: string[] }> = [];
      if (safeSubIds.length > 0) {
        attempts.push({ originUrl: validOriginUrl, subIds: safeSubIds });
      }
      attempts.push({ originUrl: validOriginUrl });

      for (const input of attempts) {
        try {
          const data = await callShopeeGraphql(
            credentials.shopee.appId,
            credentials.shopee.apiSecret,
            {
              query: `mutation($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }`,
              variables: { input },
            }
          );
          const shortLink = data?.generateShortLink?.shortLink;
          if (typeof shortLink === 'string' && /^https?:\/\//i.test(shortLink)) {
            return {
              affiliateUrl: shortLink,
              cleanProductUrl,
              officialApi: true,
              shopId: ids?.shopId,
              itemId: ids?.itemId,
            };
          }
        } catch (err: any) {
          const msg = String(err?.message || err || '');
          // If Shopee rejected the originUrl itself (error 11001), skip redundant retry without subIds
          if (/11001|invalid origin url/i.test(msg)) {
            break;
          }
        }
      }
    }

    // Secondary official Shopee lookup via productOfferV2(itemId) if generateShortLink rejected URL format
    if (ids?.itemId) {
      const offer = await fetchShopeeProductOfferByItemId(ids.itemId, credentials);
      if (offer?.offerLink && /^https?:\/\//i.test(offer.offerLink)) {
        return {
          affiliateUrl: offer.offerLink,
          cleanProductUrl: offer.productLink || cleanProductUrl,
          officialApi: true,
          shopId: ids.shopId,
          itemId: ids.itemId,
        };
      }
    }
  }

  return {
    affiliateUrl: formatAffiliateUrlFallback(cleanProductUrl, 'Shopee', credentials),
    cleanProductUrl,
    officialApi: false,
    shopId: ids?.shopId,
    itemId: ids?.itemId,
  };
}

async function convertMercadoLivreAffiliateLink(
  rawUrl: string,
  credentials: any,
  htmlHint?: string
): Promise<{
  affiliateUrl: string;
  cleanProductUrl: string;
  officialApi: boolean;
  viaExtension: boolean;
}> {
  const cleanProductUrl = await resolveCleanMercadoLivreProductUrl(rawUrl, htmlHint);
  const key = credentials?.mercadoLivre?.extensionKey?.trim();
  const tag = credentials?.mercadoLivre?.etiqueta?.trim();
  const session = resolveMlExtensionSession(key);

  if (session && (session.hasSsid || session.cookieHeader)) {
    const serverShort = await convertMlViaSyncedCookies(cleanProductUrl, session, tag);
    if (serverShort) {
      return {
        affiliateUrl: serverShort,
        cleanProductUrl,
        officialApi: true,
        viaExtension: true,
      };
    }
    const bridgeShort = await convertMlViaExtensionBridge(
      cleanProductUrl,
      session.extensionKey,
      tag
    );
    if (bridgeShort) {
      return {
        affiliateUrl: bridgeShort,
        cleanProductUrl,
        officialApi: true,
        viaExtension: true,
      };
    }
  }

  return {
    affiliateUrl: formatAffiliateUrlFallback(cleanProductUrl, 'Mercado Livre', credentials),
    cleanProductUrl,
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

interface CachedWaGroupEntry {
  remoteJid: string;
  name: string;
  membersCount: number;
  isOwner?: boolean;
  isAdmin?: boolean;
  isOwnerOrAdmin?: boolean;
}

interface CachedWaAccountGroups {
  updatedAt: string;
  phone?: string | null;
  name?: string | null;
  groups: CachedWaGroupEntry[];
}

interface PersistedLiveWaStats {
  memberEvents: MemberFlowEvent[];
  capturedByGroupJid: Record<string, { date: string; count: number; lastAt: string }>;
  cachedGroupsByAccount: Record<string, CachedWaAccountGroups>;
}

function normalizeServerGroupJid(jid?: string): string {
  if (!jid) return '';
  const trimmed = String(jid).trim();
  if (!trimmed) return '';
  const atIdx = trimmed.indexOf('@');
  if (atIdx < 0) return trimmed;
  const userPart = trimmed.slice(0, atIdx).split(':')[0];
  const domainPart = trimmed.slice(atIdx + 1).toLowerCase();
  return `${userPart}@${domainPart}`;
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
        cachedGroupsByAccount:
          parsed?.cachedGroupsByAccount && typeof parsed.cachedGroupsByAccount === 'object'
            ? parsed.cachedGroupsByAccount
            : {},
      };
    }
  } catch {
    // Ignore corrupted stats file
  }
  return { memberEvents: [], capturedByGroupJid: {}, cachedGroupsByAccount: {} };
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

function getBaileysSelfIdentifiers(accountId: string, sock?: WASocket | null): string[] {
  const ids: string[] = [];
  const push = (val: unknown) => {
    if (typeof val === 'string' && val.trim()) ids.push(val.trim());
  };
  const sockUser: any = sock?.user;
  push(sockUser?.id);
  push(sockUser?.lid);
  push(sockUser?.jid);
  try {
    const safeId = sanitizeAccountId(accountId);
    const credsFile = path.join(WA_SESSIONS_ROOT, safeId, 'creds.json');
    if (fs.existsSync(credsFile)) {
      const parsed = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
      push(parsed?.me?.id);
      push(parsed?.me?.lid);
      push(parsed?.me?.jid);
    }
  } catch {
    // Ignore disk read failure
  }
  return Array.from(new Set(ids));
}

function cacheBaileysGroupsForAccount(
  accountId: string,
  phone: string | null | undefined,
  name: string | null | undefined,
  groups: {
    remoteJid: string;
    name: string;
    membersCount: number;
    isOwner?: boolean;
    isAdmin?: boolean;
    isOwnerOrAdmin?: boolean;
  }[]
): void {
  if (!accountId || !Array.isArray(groups)) return;
  const safeId = sanitizeAccountId(accountId);
  liveWaStats.cachedGroupsByAccount[safeId] = {
    updatedAt: new Date().toISOString(),
    phone: phone || null,
    name: name || null,
    groups: groups.map((g) => ({
      remoteJid: normalizeServerGroupJid(g.remoteJid),
      name: String(g.name || g.remoteJid),
      membersCount: Math.max(0, Number(g.membersCount) || 0),
      isOwner: Boolean(g.isOwner),
      isAdmin: Boolean(g.isAdmin),
      isOwnerOrAdmin: Boolean(g.isOwnerOrAdmin || g.isOwner || g.isAdmin),
    })),
  };
  saveLiveWaStats();
}

function getFallbackCachedGroupsForAccount(accountId: string): {
  accountId: string;
  phone: string | null;
  name: string | null;
  groups: {
    remoteJid: string;
    name: string;
    membersCount: number;
    capturedToday: number;
    isOwner?: boolean;
    isAdmin?: boolean;
    isOwnerOrAdmin?: boolean;
  }[];
} | null {
  const safeId = sanitizeAccountId(accountId);
  const today = new Date().toISOString().slice(0, 10);
  const byJid = new Map<
    string,
    {
      remoteJid: string;
      name: string;
      membersCount: number;
      capturedToday: number;
      isOwner?: boolean;
      isAdmin?: boolean;
      isOwnerOrAdmin?: boolean;
    }
  >();
  let resolvedAccountId = safeId;
  let phone: string | null = null;
  let name: string | null = null;

  const exactCache = liveWaStats.cachedGroupsByAccount[safeId];
  const anyCacheEntry = exactCache
    ? ([safeId, exactCache] as const)
    : Object.entries(liveWaStats.cachedGroupsByAccount).find(
        ([, val]) => Array.isArray(val?.groups) && val.groups.length > 0
      );

  if (anyCacheEntry) {
    const [accKey, cacheData] = anyCacheEntry;
    resolvedAccountId = accKey;
    phone = cacheData.phone || null;
    name = cacheData.name || null;
    for (const g of cacheData.groups) {
      const jid = normalizeServerGroupJid(g.remoteJid);
      if (!jid.endsWith('@g.us')) continue;
      const cap = liveWaStats.capturedByGroupJid[jid];
      byJid.set(jid, {
        remoteJid: jid,
        name: g.name || jid,
        membersCount: Math.max(0, Number(g.membersCount) || 0),
        capturedToday: cap && cap.date === today ? cap.count : 0,
        isOwner: g.isOwner,
        isAdmin: g.isAdmin,
        isOwnerOrAdmin: g.isOwnerOrAdmin,
      });
    }
  }

  // Also enrich/fallback from persisted panel_state.json dispatchGroups if cache is empty
  if (byJid.size === 0 && Array.isArray(panelStore.state?.dispatchGroups)) {
    const matchingAcc = Array.isArray(panelStore.state?.accounts)
      ? panelStore.state.accounts.find(
          (a: any) =>
            a?.channel === 'WhatsApp' &&
            (sanitizeAccountId(String(a.id || '')) === safeId ||
              safeId === 'acc-wa-1' ||
              safeId === '__any__')
        )
      : null;
    if (matchingAcc) {
      resolvedAccountId = sanitizeAccountId(String(matchingAcc.id || safeId));
      phone = matchingAcc.phoneOrHandle || phone;
      name = matchingAcc.name || name;
    }
    for (const g of panelStore.state.dispatchGroups as any[]) {
      if (g?.channel !== 'WhatsApp') continue;
      const jid = normalizeServerGroupJid(String(g.remoteJid || ''));
      if (!jid.endsWith('@g.us')) continue;
      const cap = liveWaStats.capturedByGroupJid[jid];
      byJid.set(jid, {
        remoteJid: jid,
        name: String(g.name || jid),
        membersCount: Math.max(0, Number(g.membersCount) || 0),
        capturedToday: cap && cap.date === today ? cap.count : 0,
        isOwner: g.isOwner,
        isAdmin: g.isAdmin,
        isOwnerOrAdmin: g.isOwnerOrAdmin,
      });
    }
  }

  if (byJid.size === 0) return null;
  return {
    accountId: resolvedAccountId,
    phone,
    name,
    groups: Array.from(byJid.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  };
}

function recordBaileysMemberDelta(
  rawGroupJid: string,
  action: string,
  count: number
): void {
  const groupJid = normalizeServerGroupJid(rawGroupJid);
  if (!groupJid || count <= 0) return;
  if (action !== 'add' && action !== 'remove') return;
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const weekday = now.getDay();
  const existing = liveWaStats.memberEvents.find(
    (e) => e.date === dateKey && normalizeServerGroupJid(e.groupJid) === groupJid
  );
  if (existing) {
    existing.groupJid = groupJid;
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

  // Keep cached group participant count accurate in real time
  const delta = action === 'add' ? count : -count;
  for (const cache of Object.values(liveWaStats.cachedGroupsByAccount)) {
    const match = cache.groups.find((g) => normalizeServerGroupJid(g.remoteJid) === groupJid);
    if (match) {
      match.membersCount = Math.max(0, (match.membersCount || 0) + delta);
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
    const segKey = normalizeSegmentName(p.segment).toLowerCase();
    const urlKey = p.originalUrl
      ? `url:${segKey}::${String(p.originalUrl).split('?')[0]}`
      : '';
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

interface MonitoredGroupServerConfig {
  monitored: boolean;
  monitoredSegments: string[];
  useGroupImage: boolean;
  allowedMarketplaces: string[] | null;
}

function getMonitoredGroupConfigOnServer(groupJid: string): MonitoredGroupServerConfig {
  const norm = normalizeServerGroupJid(groupJid);
  if (!norm) {
    return { monitored: false, monitoredSegments: [], useGroupImage: false, allowedMarketplaces: null };
  }
  const st = panelStore.state;
  if (!st) {
    return { monitored: false, monitoredSegments: [], useGroupImage: false, allowedMarketplaces: null };
  }

  const savedPref = st.savedGroupPrefs?.[`wa:${norm}`];
  const match = Array.isArray(st.monitoringGroups)
    ? st.monitoringGroups.find((g: any) => normalizeServerGroupJid(g?.remoteJid) === norm)
    : null;

  const candidateSegments = match
    ? getGroupMonitoredSegments(match)
    : savedPref
    ? getGroupMonitoredSegments(savedPref)
    : [];

  const enabledSegments = candidateSegments.filter((seg) => {
    const segRules = resolveSegmentConfig(
      st.monitoringRulesBySegment,
      st.monitoringRules || INITIAL_MONITORING_RULES,
      seg,
      createDefaultMonitoringRulesForSegment
    );
    return segRules.enabled !== false;
  });

  const monitored = enabledSegments.length > 0;
  const useGroupImage = Boolean(match?.useGroupImage ?? savedPref?.useGroupImage ?? false);
  const rawMarkets =
    Array.isArray(match?.allowedMarketplaces) && match.allowedMarketplaces.length > 0
      ? match.allowedMarketplaces
      : Array.isArray(savedPref?.allowedMarketplaces) && savedPref.allowedMarketplaces.length > 0
      ? savedPref.allowedMarketplaces
      : null;

  return {
    monitored,
    monitoredSegments: enabledSegments,
    useGroupImage,
    allowedMarketplaces: rawMarkets,
  };
}

function isGroupMonitoredOnServer(groupJid: string): boolean {
  return getMonitoredGroupConfigOnServer(groupJid).monitored;
}

function unwrapWaMessageContent(msg: any): any {
  return (
    msg?.message?.ephemeralMessage?.message ||
    msg?.message?.viewOnceMessage?.message ||
    msg?.message?.viewOnceMessageV2?.message ||
    msg?.message ||
    null
  );
}

async function saveWaMessageImageToDisk(msg: any, sock: WASocket): Promise<string | null> {
  const inner = unwrapWaMessageContent(msg);
  if (!inner?.imageMessage) return null;
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: pino({ level: 'silent' }) as any,
        reuploadRequest: sock.updateMediaMessage,
      }
    )) as Buffer;
    if (!buffer || buffer.length < 200) return null;
    const mime = String(inner.imageMessage.mimetype || 'image/jpeg').toLowerCase();
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const filename = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    fs.mkdirSync(CAPTURED_MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(CAPTURED_MEDIA_DIR, filename), buffer);

    // Keep captured media directory tidy (max 250 recent files)
    try {
      const files = fs
        .readdirSync(CAPTURED_MEDIA_DIR)
        .map((f) => ({ f, mtime: fs.statSync(path.join(CAPTURED_MEDIA_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const old of files.slice(250)) {
        fs.rmSync(path.join(CAPTURED_MEDIA_DIR, old.f), { force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    return `/api/media/captured/${filename}`;
  } catch (err: any) {
    console.warn('[Monitoramento] Não foi possível baixar foto do grupo:', err?.message || err);
    return null;
  }
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
  groupImageUrl?: string | null;
}): Promise<void> {
  const { groupJid, text, groupImageUrl = null } = params;
  const normJid = normalizeServerGroupJid(groupJid);
  const groupCfg = getMonitoredGroupConfigOnServer(normJid);
  if (!groupCfg.monitored) return;

  const rawMatches = text.match(/https?:\/\/[^\s<>"')\]}]+/gi) || [];
  const candidateUrls = rawMatches
    .map((u) => u.replace(/[.,;!?]+$/, ''))
    .filter(
      (u) =>
        !/chat\.whatsapp\.com|wa\.me\/|whatsapp\.com\/channel|t\.me\/\+/i.test(u)
    );

  if (candidateUrls.length === 0) return;

  const st = panelStore.state || {};
  const lowerText = text.toLowerCase();
  const credentials = st.integrations || {};

  // Evaluate monitoring rules independently for each segment monitoring this group
  const segmentPlans = groupCfg.monitoredSegments
    .map((seg) => {
      const rules = resolveSegmentConfig(
        st.monitoringRulesBySegment,
        st.monitoringRules || INITIAL_MONITORING_RULES,
        seg,
        createDefaultMonitoringRulesForSegment
      );
      if (rules.enabled === false) return null;
      if (Array.isArray(rules.restrictedWords) && rules.restrictedWords.length > 0) {
        if (rules.restrictedWords.some((w: string) => w && lowerText.includes(w.toLowerCase()))) {
          return null;
        }
      }
      if (Array.isArray(rules.allowedWords) && rules.allowedWords.length > 0) {
        if (!rules.allowedWords.some((w: string) => w && lowerText.includes(w.toLowerCase()))) {
          return null;
        }
      }
      const avoidHours = Math.max(0, Number(rules.avoidDuplicateHours) || 0);
      return { segment: seg, avoidMs: avoidHours * 3600_000 };
    })
    .filter(Boolean) as { segment: string; avoidMs: number }[];

  if (segmentPlans.length === 0) return;

  const existingProducts: any[] = Array.isArray(st.products) ? st.products : [];

  for (const targetUrl of candidateUrls.slice(0, 2)) {
    const cleanBaseUrl = targetUrl.split('?')[0].toLowerCase();

    const eligiblePlans = segmentPlans.filter(({ segment, avoidMs }) => {
      const dedupeKey = `${segment.toLowerCase()}::${cleanBaseUrl}`;
      const lastTs = recentCapturedUrls.get(dedupeKey);
      if (avoidMs > 0 && lastTs && Date.now() - lastTs < avoidMs) {
        return false;
      }
      const alreadyExists = existingProducts.some((p) => {
        if (!matchesSegment(p?.segment, segment)) return false;
        const pUrl = String(p?.originalUrl || '').split('?')[0].toLowerCase();
        if (pUrl && pUrl === cleanBaseUrl) {
          if (avoidMs === 0) return true;
          const createdTs = Date.parse(String(p?.createdAt || ''));
          return !Number.isFinite(createdTs) || Date.now() - createdTs < avoidMs;
        }
        return false;
      });
      return !alreadyExists;
    });

    if (eligiblePlans.length === 0) continue;

    for (const plan of eligiblePlans) {
      recentCapturedUrls.set(`${plan.segment.toLowerCase()}::${cleanBaseUrl}`, Date.now());
    }

    try {
      const extracted = await extractOfferFromUrl(targetUrl, credentials, text);
      if (!extracted?.title || !extracted?.affiliateUrl) continue;

      // Ignore links that do not belong to any supported marketplace (e.g. nike.com.br)
      if (!extracted.knownMarketplace) {
        console.log(
          `[Monitoramento] Ignorado link fora dos marketplaces suportados (${extracted.originalUrl})`
        );
        continue;
      }

      // Enforce per-group marketplace filter configured in "Configurar Grupo Monitorado"
      if (
        groupCfg.allowedMarketplaces &&
        groupCfg.allowedMarketplaces.length > 0 &&
        !groupCfg.allowedMarketplaces.includes(extracted.knownMarketplace)
      ) {
        console.log(
          `[Monitoramento] Ignorado (${extracted.knownMarketplace}) — não habilitado para o grupo ${normJid}`
        );
        continue;
      }

      const disc = Number(extracted.discountPrice) || 0;
      const orig = Number(extracted.originalPrice) || disc;
      const pct = Number(extracted.discountPercent) || 0;
      const commPct = DEFAULT_COMMISSION_BY_PLATFORM[extracted.platform] || 10;
      const commVal = Number(((disc * commPct) / 100).toFixed(2));

      const chosenImageUrl =
        groupCfg.useGroupImage && groupImageUrl
          ? groupImageUrl
          : extracted.imageUrl || undefined;

      const createdAtIso = new Date().toISOString();
      const newCapturedProducts = eligiblePlans.map((plan, idx) => ({
        id: `prod-mon-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
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
        couponCode: extracted.couponCode || undefined,
        artworkKey: guessArtworkKeyFromTitle(extracted.title),
        customImageUrl: chosenImageUrl,
        isFavorite: false,
        isPrioritized: false,
        salesRank: 1,
        segment: plan.segment,
        createdAt: createdAtIso,
      }));

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
        products: [...newCapturedProducts, ...curList],
        monitoringGroups: updatedMonitoring,
      };
      panelStore.hasServerState = true;
      panelStore.version += 1;
      panelStore.updatedAt = createdAtIso;
      saveStoredPanelState();

      console.log(
        `[Monitoramento] Capturado (${extracted.platform}) do grupo ${normJid} para [${eligiblePlans
          .map((p) => p.segment)
          .join(', ')}]: ${extracted.title}${
          chosenImageUrl ? ' [com foto real]' : ' [sem foto]'
        }`
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
  if (imageSource.startsWith('/api/media/captured/')) {
    const safeName = path.basename(imageSource.split('?')[0]);
    if (/^[a-zA-Z0-9._-]+$/.test(safeName)) {
      const fullPath = path.join(CAPTURED_MEDIA_DIR, safeName);
      if (fs.existsSync(fullPath)) {
        try {
          return fs.readFileSync(fullPath);
        } catch {
          return null;
        }
      }
    }
    return null;
  }
  if (imageSource.startsWith('data:image/')) {
    const parts = imageSource.split(',');
    if (parts[1]) return Buffer.from(parts[1], 'base64');
  }
  if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
    const candidateUrls = getHighResImageCandidateUrls(imageSource);
    const baseHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };

    for (const candidateUrl of candidateUrls) {
      let origin = '';
      try {
        origin = new URL(candidateUrl).origin + '/';
      } catch {
        origin = '';
      }
      const attempts = origin
        ? [{ ...baseHeaders, Referer: origin }, baseHeaders]
        : [baseHeaders];

      for (const headers of attempts) {
        try {
          const res = await fetch(candidateUrl, {
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) {
            const contentType = String(res.headers.get('content-type') || '').toLowerCase();
            if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
              continue;
            }
            const ab = await res.arrayBuffer();
            if (ab.byteLength > 256) {
              return Buffer.from(ab);
            }
          }
        } catch {
          // Try next header set or fallback URL
        }
      }
    }
    console.warn(`[WhatsApp/Media] Falha ao baixar imagem: ${imageSource}`);
  }
  return null;
}

async function loadStandardizedProductImage(
  imageSource: string
): Promise<StandardizedProductImage | null> {
  const rawBuf = await loadImageBuffer(imageSource);
  if (!rawBuf) return null;
  try {
    return await standardizeProductImageBuffer(rawBuf, {
      size: 800,
      paddingRatio: 0.05,
      quality: 88,
      thumbSize: 192,
    });
  } catch (err: any) {
    console.warn(
      `[Media] Aviso ao padronizar imagem (${imageSource.slice(0, 80)}):`,
      err?.message || err
    );
    return null;
  }
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
        if (action === 'promote' || action === 'demote') {
          // Refresh owner/admin roles in background when admin status changes
          setTimeout(() => {
            if (entry.status !== 'open' || entry.sock !== sock) return;
            void sock
              .groupFetchAllParticipating()
              .then((participating: any) => {
                const selfIds = getBaileysSelfIdentifiers(safeId, sock);
                const unique = new Map<string, CachedWaGroupEntry>();
                for (const g of Object.values(participating || {}) as any[]) {
                  const gjid = normalizeServerGroupJid(String(g?.id || ''));
                  if (!gjid.endsWith('@g.us')) continue;
                  const membersCount = Number(g.participants?.length || g.size || 0);
                  const role = detectGroupAdminRole(g, selfIds);
                  const prev = unique.get(gjid);
                  if (!prev || membersCount > prev.membersCount) {
                    unique.set(gjid, {
                      remoteJid: gjid,
                      name: String(g.subject || gjid),
                      membersCount,
                      isOwner: role.isOwner,
                      isAdmin: role.isAdmin,
                      isOwnerOrAdmin: role.isOwnerOrAdmin,
                    });
                  }
                }
                if (unique.size > 0) {
                  cacheBaileysGroupsForAccount(
                    safeId,
                    entry.connectedPhone,
                    entry.connectedName,
                    Array.from(unique.values())
                  );
                }
              })
              .catch(() => {});
          }, 1000);
        }
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

        const monCfg = getMonitoredGroupConfigOnServer(jid);
        if (monCfg.monitored) {
          if (msg?.key?.fromMe) {
            recordBaileysCapturedLink(jid);
          }
          void (async () => {
            const groupImageUrl = monCfg.useGroupImage
              ? await saveWaMessageImageToDisk(msg, sock)
              : null;
            await processMonitoredGroupMessage({
              groupJid: jid,
              text,
              groupImageUrl,
            });
          })();
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

        // Warm-cache real participating groups (with owner/admin role flags) into baileys_live_stats.json shortly after connect
        setTimeout(() => {
          if (entry.status !== 'open' || entry.sock !== sock) return;
          void sock
            .groupFetchAllParticipating()
            .then((participating: any) => {
              const selfIds = getBaileysSelfIdentifiers(safeId, sock);
              const unique = new Map<string, CachedWaGroupEntry>();
              for (const g of Object.values(participating || {}) as any[]) {
                const jid = normalizeServerGroupJid(String(g?.id || ''));
                if (!jid.endsWith('@g.us')) continue;
                const membersCount = Number(g.participants?.length || g.size || 0);
                const role = detectGroupAdminRole(g, selfIds);
                const prev = unique.get(jid);
                if (!prev || membersCount > prev.membersCount) {
                  unique.set(jid, {
                    remoteJid: jid,
                    name: String(g.subject || jid),
                    membersCount,
                    isOwner: role.isOwner,
                    isAdmin: role.isAdmin,
                    isOwnerOrAdmin: role.isOwnerOrAdmin,
                  });
                }
              }
              if (unique.size > 0) {
                cacheBaileysGroupsForAccount(
                  safeId,
                  entry.connectedPhone,
                  entry.connectedName,
                  Array.from(unique.values())
                );
              }
            })
            .catch(() => {
              // Ignore transient warm-cache fetch failure
            });
        }, 1200);
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
          // CRITICAL: immediately mark as 'connecting' and detach closed socket so no caller hits a dead WS
          entry.status = 'connecting';
          entry.sock = null;
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

function detectKnownMarketplace(
  url: string
): 'Shopee' | 'Mercado Livre' | 'Amazon' | 'Magalu' | 'Netshoes' | 'AliExpress' | null {
  const lower = String(url || '').toLowerCase();
  if (
    lower.includes('mercadolivre') ||
    lower.includes('mercadolibre') ||
    lower.includes('meli.la')
  ) {
    return 'Mercado Livre';
  }
  if (
    lower.includes('amazon.') ||
    lower.includes('amzn.to') ||
    lower.includes('a.co/')
  ) {
    return 'Amazon';
  }
  if (
    lower.includes('magazineluiza') ||
    lower.includes('magazinevoce') ||
    lower.includes('magalu.com')
  ) {
    return 'Magalu';
  }
  if (lower.includes('netshoes.com')) return 'Netshoes';
  if (lower.includes('aliexpress.com') || lower.includes('s.click.aliexpress')) {
    return 'AliExpress';
  }
  if (lower.includes('shopee.com') || lower.includes('shope.ee')) {
    return 'Shopee';
  }
  return null;
}

function detectMarketplace(
  url: string
): 'Shopee' | 'Mercado Livre' | 'Amazon' | 'Magalu' | 'Netshoes' | 'AliExpress' {
  return detectKnownMarketplace(url) || 'Shopee';
}

function formatAffiliateUrlFallback(
  rawUrl: string,
  platform: string,
  credentials: any
): string {
  const clean = cleanMarketplaceProductUrl(rawUrl.trim(), platform);
  if (!clean) return rawUrl;

  if (platform === 'Mercado Livre') {
    const tag = credentials?.mercadoLivre?.etiqueta?.trim();
    if (!tag) return clean;
    try {
      const u = new URL(clean);
      u.searchParams.delete('ref');
      u.searchParams.delete('forceInApp');
      u.searchParams.set('matt_tool', tag);
      u.searchParams.set('matt_word', tag);
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
    const safeSub = sanitizeShopeeSubIds(credentials?.shopee?.subIds)[0];
    if (!safeSub) return clean;
    try {
      const u = new URL(clean);
      u.searchParams.set('uls_trackid', safeSub);
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
  bucketsByPlatform: Record<string, DiscoveredOffer[]>;
  cycleIndex: number;
  seenIds: string[];
  queryKey: string;
  shopeeCursor?: {
    termIdx: number;
    sortIdx: number;
    apiPage: number;
    exhausted: boolean;
  };
  promobitSearchCursor?: {
    termIdx: number;
    apiPage: number;
    exhausted: boolean;
  };
  promobitSubCursor?: {
    slugIdx: number;
    after: string | null;
    exhausted: boolean;
  };
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

/* ============================================================================
 * LIVE MARKETPLACE CATEGORIES CACHE (Mercado Livre, Shopee, Promobit + Curated)
 * ========================================================================== */
const CATEGORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const platformCategoriesCache = new Map<
  string,
  { categories: PlatformCategory[]; source: 'live' | 'catalog'; fetchedAt: number }
>();

async function getCategoriesForPlatform(
  platform: string
): Promise<{ categories: PlatformCategory[]; source: 'live' | 'catalog' }> {
  const key = platform?.trim() || 'Todas as Plataformas';
  const cached = platformCategoriesCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CATEGORY_CACHE_TTL_MS) {
    return { categories: cached.categories, source: cached.source };
  }

  let liveCategories: PlatformCategory[] = [];
  try {
    if (key === 'Mercado Livre') {
      const res = await fetch('https://www.mercadolivre.com.br/categorias', {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(9000),
      });
      if (res.ok) {
        const html = await res.text();
        liveCategories = parseMercadoLivreCategoriesHtml(html);
      }
    } else if (key === 'Shopee') {
      const res = await fetch('https://shopee.com.br/api/v4/pages/get_category_tree', {
        headers: {
          ...BROWSER_HEADERS,
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://shopee.com.br/',
        },
        signal: AbortSignal.timeout(9000),
      });
      if (res.ok) {
        const json = await res.json();
        liveCategories = parseShopeeCategoryTreeJson(json);
      }
    } else if (key === 'Todas as Plataformas') {
      const res = await fetch('https://api.promobit.com.br/categories', {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(9000),
      });
      if (res.ok) {
        const json = await res.json();
        liveCategories = parsePromobitCategoriesJson(json);
      }
    }
  } catch {
    // Fall back to curated authentic catalog below
  }

  if (liveCategories.length >= 5) {
    platformCategoriesCache.set(key, {
      categories: liveCategories,
      source: 'live',
      fetchedAt: Date.now(),
    });
    return { categories: liveCategories, source: 'live' };
  }

  const fallback =
    FALLBACK_PLATFORM_CATEGORIES[key] || FALLBACK_PLATFORM_CATEGORIES['Todas as Plataformas'];
  platformCategoriesCache.set(key, {
    categories: fallback,
    source: 'catalog',
    fetchedAt: Date.now(),
  });
  return { categories: fallback, source: 'catalog' };
}

async function fetchPromobitNextDataOffers(
  url: string,
  forcedPlatform:
    | 'Shopee'
    | 'Mercado Livre'
    | 'Amazon'
    | 'Magalu'
    | 'Netshoes'
    | 'AliExpress'
    | null,
  credentials: any
): Promise<DiscoveredOffer[]> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(8500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const nextMatch = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!nextMatch) return [];
    const parsed = JSON.parse(nextMatch[1]);
    const list = parsed?.props?.pageProps?.serverOffers?.offers || [];
    const items: DiscoveredOffer[] = [];
    for (const raw of list) {
      const mapped = mapRawPromobitItem(raw, forcedPlatform, credentials);
      if (mapped) items.push(mapped);
    }
    return items;
  } catch {
    return [];
  }
}

const PROMOBIT_STORE_QUERY_BY_PLATFORM: Record<string, string> = {
  'Mercado Livre': 'mercado livre',
  Amazon: 'amazon',
  Magalu: 'magazine luiza',
  Shopee: 'shopee',
  AliExpress: 'aliexpress',
  Netshoes: 'netshoes',
};

async function fetchPromobitSearchPage(
  term: string,
  credentials: any,
  page: number = 1
): Promise<{ offers: DiscoveredOffer[]; totalPages: number; hasMore: boolean }> {
  const q = term.trim();
  if (!q) return { offers: [], totalPages: 0, hasMore: false };
  try {
    const safePage = Math.max(1, page);
    const searchUrl = `https://api.promobit.com.br/search/result/offers?q=${encodeURIComponent(
      q
    )}&sort=relevance&page=${safePage}`;
    const res = await fetch(searchUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(8500),
    });
    if (!res.ok) return { offers: [], totalPages: 0, hasMore: false };
    const json = (await res.json()) as any;
    const rawList = Array.isArray(json?.offers)
      ? json.offers
      : Array.isArray(json?.active_offers)
      ? json.active_offers
      : [];
    const totalPages = Math.max(0, Number(json?.total) || 0);
    const items: DiscoveredOffer[] = [];
    for (const raw of rawList) {
      const mapped = mapRawPromobitItem(raw, null, credentials);
      if (mapped) items.push(mapped);
    }
    return {
      offers: items,
      totalPages,
      hasMore: safePage < totalPages && rawList.length > 0,
    };
  } catch {
    return { offers: [], totalPages: 0, hasMore: false };
  }
}

async function fetchPromobitSearchOffers(
  term: string,
  credentials: any
): Promise<DiscoveredOffer[]> {
  const res = await fetchPromobitSearchPage(term, credentials, 1);
  return res.offers;
}

async function fetchPromobitSubcategoryOffers(
  subcategorySlug: string,
  credentials: any,
  after?: string | null
): Promise<{ offers: DiscoveredOffer[]; nextAfter: string | null }> {
  const slug = subcategorySlug.trim();
  if (!slug) return { offers: [], nextAfter: null };
  try {
    const url = after
      ? `https://api.promobit.com.br/subcategories/${encodeURIComponent(
          slug
        )}/offers?limit=40&after=${encodeURIComponent(after)}`
      : `https://api.promobit.com.br/subcategories/${encodeURIComponent(slug)}/offers?limit=40`;
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(8500),
    });
    if (!res.ok) return { offers: [], nextAfter: null };
    const json = (await res.json()) as any;
    const rawList = Array.isArray(json?.offers) ? json.offers : [];
    const nextAfter =
      typeof json?.after === 'string' && json.after && json.after !== after ? json.after : null;
    const items: DiscoveredOffer[] = [];
    for (const raw of rawList) {
      const mapped = mapRawPromobitItem(raw, null, credentials);
      if (mapped) items.push(mapped);
    }
    return { offers: items, nextAfter: rawList.length > 0 ? nextAfter : null };
  } catch {
    return { offers: [], nextAfter: null };
  }
}

async function fetchPromobitStoreOffers(
  storeSlug: string,
  forcedPlatform:
    | 'Shopee'
    | 'Mercado Livre'
    | 'Amazon'
    | 'Magalu'
    | 'Netshoes'
    | 'AliExpress',
  credentials: any,
  after?: string | null
): Promise<{ offers: DiscoveredOffer[]; nextAfter: string | null }> {
  if (!storeSlug) return { offers: [], nextAfter: null };
  try {
    const url = after
      ? `https://api.promobit.com.br/stores/${encodeURIComponent(
          storeSlug
        )}/offers?limit=40&after=${encodeURIComponent(after)}`
      : `https://api.promobit.com.br/stores/${encodeURIComponent(storeSlug)}/offers?limit=40`;
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(8500),
    });
    if (!res.ok) return { offers: [], nextAfter: null };
    const json = (await res.json()) as any;
    const rawList = Array.isArray(json?.offers) ? json.offers : [];
    const nextAfter =
      typeof json?.after === 'string' && json.after && json.after !== after ? json.after : null;
    const items: DiscoveredOffer[] = [];
    for (const raw of rawList) {
      const mapped = mapRawPromobitItem(raw, forcedPlatform, credentials);
      if (mapped) items.push(mapped);
    }
    return { offers: items, nextAfter: rawList.length > 0 ? nextAfter : null };
  } catch {
    return { offers: [], nextAfter: null };
  }
}

async function fetchShopeeOfficialOffers(
  keyword: string | undefined,
  credentials: any,
  pageNum: number,
  limit: number,
  categoryLabel?: string,
  options?: { sortType?: number; productCatId?: number }
): Promise<{ offers: DiscoveredOffer[]; hasMore: boolean; errored?: boolean }> {
  if (
    !credentials?.shopee?.appId ||
    !credentials?.shopee?.apiSecret ||
    String(credentials.shopee.apiSecret).startsWith('shp_live_98a7')
  ) {
    return { offers: [], hasMore: false };
  }

  const safeLimit = Math.max(1, Math.min(50, limit));
  const sortType = options?.sortType ?? 2;
  const productCatId = options?.productCatId;
  const gqlQuery = {
    query: `query($keyword: String, $sortType: Int, $productCatId: Int, $page: Int, $limit: Int) {
      productOfferV2(keyword: $keyword, sortType: $sortType, productCatId: $productCatId, page: $page, limit: $limit) {
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
      keyword: keyword?.trim() || undefined,
      sortType,
      productCatId: typeof productCatId === 'number' && productCatId > 0 ? productCatId : undefined,
      page: Math.max(1, pageNum),
      limit: safeLimit,
    },
  };

  let data: any;
  try {
    data = await callShopeeGraphql(
      credentials.shopee.appId,
      credentials.shopee.apiSecret,
      gqlQuery
    );
  } catch {
    // Shopee throws error [10000] on certain single-word queries with sortType 1 or unsupported catIds.
    // Fail gracefully per query so deep pagination advances to the next sort/term without aborting the search.
    return { offers: [], hasMore: false, errored: true };
  }

  const nodes = data?.productOfferV2?.nodes || [];
  const hasMore = Boolean(data?.productOfferV2?.pageInfo?.hasNextPage || nodes.length >= safeLimit);
  const offers: DiscoveredOffer[] = [];

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
      category: categoryLabel || 'Vitrine Shopee API',
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

  return { offers, hasMore };
}

async function searchVerifiedLiveOffers(
  query: string,
  platform: string,
  credentials: any,
  options: {
    page?: number;
    limit?: number;
    cursor?: string | null;
    category?: string;
    subcategory?: string;
  } = {}
): Promise<{
  offers: DiscoveredOffer[];
  nextCursor: string | null;
  hasMore: boolean;
  warnings: string[];
}> {
  const cleanQuery = String(query || '').trim();
  const cleanCategory =
    options.category && options.category !== 'Todas as Categorias'
      ? String(options.category).trim()
      : '';
  const cleanSubcategory =
    options.subcategory && options.subcategory !== 'Todas as Subcategorias'
      ? String(options.subcategory).trim()
      : '';

  const pageSize = Math.max(1, Math.min(200, Number(options.limit) || 10));
  const pageNum = Math.max(1, Number(options.page) || 1);
  const isAllPlatforms = platform === 'Todas as Plataformas';

  const plan = resolveCategorySearchPlan({
    manualQuery: cleanQuery,
    category: cleanCategory,
    subcategory: cleanSubcategory,
  });

  const hasManualQuery =
    Boolean(cleanQuery) &&
    !/^(?:ofertas|ofertas do dia|promocoes|promoções|todas as categorias)$/i.test(cleanQuery);

  const queryKey = `${platform}::${cleanQuery.toLowerCase()}::${cleanCategory.toLowerCase()}::${cleanSubcategory.toLowerCase()}`;
  const cursorState =
    options.cursor && offerStreamCursors.get(options.cursor)?.queryKey === queryKey
      ? offerStreamCursors.get(options.cursor)
      : undefined;

  const warnings: string[] = [];
  const seenIds = new Set<string>(cursorState ? cursorState.seenIds : []);
  let currentAfter: string | null = cursorState ? cursorState.after : null;
  let reachedEnd = Boolean(cursorState && !cursorState.after);
  let officialHasMore = false;

  const bucketsByPlatform: Record<string, DiscoveredOffer[]> = {};
  for (const plat of PLATFORM_CYCLE_ORDER) {
    bucketsByPlatform[plat] = cursorState?.bucketsByPlatform?.[plat]
      ? [...cursorState.bucketsByPlatform[plat]]
      : [];
  }
  const singleResults: DiscoveredOffer[] = cursorState ? [...cursorState.overflow] : [];
  const startCycleIndex = cursorState ? cursorState.cycleIndex : 0;

  const addOffer = (item: DiscoveredOffer | null | undefined): boolean => {
    if (!item) return false;
    if (!isAllPlatforms && item.platform !== platform) return false;
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    if (isAllPlatforms) {
      if (!bucketsByPlatform[item.platform]) bucketsByPlatform[item.platform] = [];
      bucketsByPlatform[item.platform].push(item);
    } else {
      singleResults.push(item);
    }
    return true;
  };

  const countBufferedAll = () =>
    Object.values(bucketsByPlatform).reduce((sum, list) => sum + list.length, 0);

  const countPopulatedPlatforms = () =>
    PLATFORM_CYCLE_ORDER.filter((p) => (bucketsByPlatform[p]?.length || 0) > 0).length;

  const activeCategoryLabel = cleanSubcategory || cleanCategory || undefined;
  const wantShopee = platform === 'Shopee' || isAllPlatforms;
  const wantAli = platform === 'AliExpress' || isAllPlatforms;
  const wantML = platform === 'Mercado Livre' || isAllPlatforms;

  const officialOffersBuffer: DiscoveredOffer[] = [];
  const promobitPrimaryBuffer: DiscoveredOffer[] = [];

  const shopeeCursor = cursorState?.shopeeCursor
    ? { ...cursorState.shopeeCursor }
    : { termIdx: 0, sortIdx: 0, apiPage: 1, exhausted: false };
  const promobitSearchCursor = cursorState?.promobitSearchCursor
    ? { ...cursorState.promobitSearchCursor }
    : { termIdx: 0, apiPage: 1, exhausted: false };
  const promobitSubCursor = cursorState?.promobitSubCursor
    ? { ...cursorState.promobitSubCursor }
    : { slugIdx: 0, after: null as string | null, exhausted: false };

  // Helper to fetch official Shopee offers with deep multi-query & multi-sort pagination
  // plus strict offerMatchesSearchPlan filtering (prevents stickers/accessories in product subcategories)
  const fetchShopeeBucket = async () => {
    if (!wantShopee || shopeeCursor.exhausted) return;
    if (
      !credentials?.shopee?.appId ||
      !credentials?.shopee?.apiSecret ||
      String(credentials.shopee.apiSecret).startsWith('shp_live_98a7')
    ) {
      return;
    }
    try {
      const targetShopeeCount = isAllPlatforms
        ? Math.max(8, Math.min(24, pageSize))
        : Math.min(60, pageSize + 10);

      if (plan.isUnfiltered) {
        const res = await fetchShopeeOfficialOffers(
          undefined,
          credentials,
          shopeeCursor.apiPage,
          50,
          activeCategoryLabel,
          { sortType: 2 }
        );
        if (res.offers.length > 0) {
          officialOffersBuffer.push(...res.offers);
        }
        if (res.hasMore && res.offers.length > 0) {
          shopeeCursor.apiPage += 1;
          officialHasMore = true;
        } else {
          shopeeCursor.exhausted = true;
        }
        return;
      }

      const queryList: string[] = [];
      if (hasManualQuery && plan.deepQueryTerms.length === 0) {
        queryList.push(cleanQuery);
      } else {
        const sourceTerms =
          plan.deepQueryTerms.length > 0 ? plan.deepQueryTerms : plan.primaryTerms;
        for (const t of sourceTerms) {
          if (t && !queryList.includes(t)) queryList.push(t);
        }
        if (!plan.strictSubcategory) {
          for (const pt of plan.parentTerms.slice(0, 3)) {
            if (pt && !queryList.includes(pt)) queryList.push(pt);
          }
        }
      }

      if (queryList.length === 0) {
        shopeeCursor.exhausted = true;
        return;
      }

      // sortType 1 = Relevance (best match for product subcategories like "notebook ssd", "smart tv 4k"),
      // sortType 2 = Top Sales (great depth once relevance pages are exhausted)
      const sortOrder = [1, 2];
      const maxApiCalls = isAllPlatforms ? 4 : 6;
      let calls = 0;
      let collected = 0;
      const seenLocal = new Set<string>(seenIds);

      while (
        collected < targetShopeeCount &&
        calls < maxApiCalls &&
        shopeeCursor.termIdx < queryList.length
      ) {
        calls += 1;
        const kw = queryList[shopeeCursor.termIdx];
        const sortType = sortOrder[shopeeCursor.sortIdx] ?? 1;
        // Only apply global Shopee L1 catId when sortIdx === 0 and not errored previously;
        // broad multi-word queries already target the exact product cleanly even without catId.
        const useCatId =
          plan.shopeeCatId && shopeeCursor.sortIdx === 0 && kw.split(/\s+/).length <= 2
            ? plan.shopeeCatId
            : undefined;

        const res = await fetchShopeeOfficialOffers(
          kw,
          credentials,
          shopeeCursor.apiPage,
          50,
          activeCategoryLabel,
          { sortType, productCatId: useCatId }
        );

        let matchedInBatch = 0;
        for (const o of res.offers) {
          if (seenLocal.has(o.id)) continue;
          if (!offerMatchesSearchPlan(o, plan)) continue;
          seenLocal.add(o.id);
          officialOffersBuffer.push(o);
          collected += 1;
          matchedInBatch += 1;
        }

        // Advance cursor: continue paginating same (term, sortType) up to 5 pages while returning useful matches,
        // otherwise move cleanly to next sortType or next deepQueryTerm!
        if (!res.errored && res.hasMore && res.offers.length >= 15 && matchedInBatch > 0 && shopeeCursor.apiPage < 5) {
          shopeeCursor.apiPage += 1;
        } else {
          shopeeCursor.apiPage = 1;
          shopeeCursor.sortIdx += 1;
          if (shopeeCursor.sortIdx >= sortOrder.length) {
            shopeeCursor.sortIdx = 0;
            shopeeCursor.termIdx += 1;
          }
        }
      }

      if (shopeeCursor.termIdx >= queryList.length) {
        shopeeCursor.exhausted = true;
      } else {
        officialHasMore = true;
      }
    } catch (err: any) {
      warnings.push(`Shopee API: ${err.message}`);
    }
  };

  // Helper to fetch AliExpress official affiliate API if configured
  const fetchAliOfficialBucket = async () => {
    if (!wantAli || !credentials?.aliexpress?.appKey || !credentials?.aliexpress?.appSecret) {
      return;
    }
    try {
      const aliLimit = isAllPlatforms ? Math.max(4, Math.min(15, pageSize)) : Math.min(50, pageSize);
      const aliKw = hasManualQuery
        ? cleanQuery
        : plan.primaryTerms[0] || plan.parentTerms[0] || 'bluetooth';
      const aliRes = await callAliExpressApi(
        credentials.aliexpress.appKey,
        credentials.aliexpress.appSecret,
        'aliexpress.affiliate.product.query',
        {
          keywords: aliKw,
          target_currency: 'BRL',
          target_language: 'PT',
          ship_to_country: 'BR',
          tracking_id: credentials.aliexpress.trackingId || 'default',
          page_no: String(pageNum),
          page_size: String(aliLimit),
        }
      );
      const products =
        aliRes?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product ||
        [];
      if (products.length >= aliLimit) officialHasMore = true;
      for (const p of products) {
        const disc = parseFloat(p.target_sale_price || '0') || 0;
        const orig = parseFloat(p.target_original_price || String(disc)) || disc;
        const pct = parseInt(String(p.discount || '0').replace('%', ''), 10) || 0;
        const commPct = parseFloat(String(p.commission_rate || '8').replace('%', '')) || 8;
        officialOffersBuffer.push({
          id: `ali-${p.product_id}`,
          title: p.product_title,
          platform: 'AliExpress',
          category: activeCategoryLabel || 'AliExpress Brasil',
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
      warnings.push(`AliExpress API: ${err.message}`);
    }
  };

  // Helper to fetch Mercado Livre official OAuth API if configured
  const fetchMlOfficialBucket = async () => {
    if (
      !wantML ||
      !credentials?.mercadoLivre?.authCode ||
      String(credentials.mercadoLivre.authCode).startsWith('ml_sess_')
    ) {
      return;
    }
    try {
      const mlKw = hasManualQuery
        ? cleanQuery
        : plan.primaryTerms[0] || plan.parentTerms[0] || 'ofertas do dia';
      const mlLimit = isAllPlatforms ? Math.max(4, Math.min(15, pageSize)) : pageSize;
      const mlApiOffers = await searchMercadoLivre(mlKw, credentials, pageNum, mlLimit);
      if (mlApiOffers.length >= mlLimit) officialHasMore = true;
      officialOffersBuffer.push(...mlApiOffers);
    } catch (err: any) {
      warnings.push(`Mercado Livre API: ${err.message}`);
    }
  };

  // 1. Run official APIs + first-page live store/category/search feeds in parallel
  const shouldFetchInitialFeeds =
    !cursorState && pageNum === 1;

  // On subsequent pages for All Platforms, refresh Shopee official API page if Shopee bucket is running low
  const needMoreShopeeOnNextPage =
    !shouldFetchInitialFeeds &&
    wantShopee &&
    (isAllPlatforms ? (bucketsByPlatform['Shopee']?.length || 0) < 3 : singleResults.length < pageSize);

  const parallelTasks: Promise<void>[] = [];

  if (shouldFetchInitialFeeds || needMoreShopeeOnNextPage) {
    parallelTasks.push(fetchShopeeBucket());
  }
  if (shouldFetchInitialFeeds || (!isAllPlatforms && wantAli && singleResults.length < pageSize)) {
    parallelTasks.push(fetchAliOfficialBucket());
  }
  if (shouldFetchInitialFeeds || (!isAllPlatforms && wantML && singleResults.length < pageSize)) {
    parallelTasks.push(fetchMlOfficialBucket());
  }

  // Secondary candidate pool (parent-category fallback if narrow subcategory yields very few items)
  const secondaryCandidates: DiscoveredOffer[] = [];

  if (shouldFetchInitialFeeds) {
    if (plan.isUnfiltered) {
      // Unfiltered Vitrine: load live store feeds in parallel for deep, strictly balanced round-robin buckets!
      const storeTargets = isAllPlatforms
        ? PLATFORM_CYCLE_ORDER.map((plat) => ({
            plat,
            slug: STORE_SLUG_BY_PLATFORM[plat],
          })).filter((x) => Boolean(x.slug))
        : STORE_SLUG_BY_PLATFORM[platform]
        ? [{ plat: platform as any, slug: STORE_SLUG_BY_PLATFORM[platform] }]
        : [];

      for (const target of storeTargets) {
        parallelTasks.push(
          fetchPromobitStoreOffers(target.slug, target.plat as any, credentials, null).then(
            (res) => {
              promobitPrimaryBuffer.push(...res.offers);
              if (!isAllPlatforms && res.nextAfter) {
                currentAfter = res.nextAfter;
              }
            }
          )
        );
      }
    } else {
      // Filtered by manual query and/or Category + Subcategory:
      // Also check mapped Promobit category pages in parallel for broad category browsing
      if (!hasManualQuery && plan.promobitSlugs.length > 0 && !plan.strictSubcategory) {
        for (const catSlug of plan.promobitSlugs.slice(0, 2)) {
          parallelTasks.push(
            fetchPromobitNextDataOffers(
              `https://www.promobit.com.br/promocoes/${catSlug}/`,
              null,
              credentials
            ).then((items) => {
              for (const item of items) {
                if (!isAllPlatforms && item.platform !== platform) continue;
                if (offerMatchesSearchPlan(item, plan)) {
                  promobitPrimaryBuffer.push(item);
                } else {
                  secondaryCandidates.push(item);
                }
              }
            })
          );
        }
      }
    }
  }

  await Promise.all(parallelTasks);

  // Official API results ALWAYS take priority ahead of Promobit items — uniformly filtered through offerMatchesSearchPlan
  officialOffersBuffer.forEach((item) => {
    if (plan.isUnfiltered || offerMatchesSearchPlan(item, plan)) {
      addOffer(item);
    }
  });
  promobitPrimaryBuffer.forEach((item) => addOffer(item));

  // Deep paginated Promobit /search/result/offers (20 offers/page, store-targeted when single platform!)
  // Gives Mercado Livre, Amazon, Magalu, AliExpress, Netshoes, and All Platforms dozens of real filtered pages!
  const promobitQueryTerms: string[] = [];
  if (!plan.isUnfiltered) {
    if (hasManualQuery && plan.deepQueryTerms.length === 0) {
      promobitQueryTerms.push(cleanQuery);
    } else {
      const baseTerms =
        plan.deepQueryTerms.length > 0 ? plan.deepQueryTerms : plan.primaryTerms;
      for (const t of baseTerms) {
        if (t && !promobitQueryTerms.includes(t)) promobitQueryTerms.push(t);
      }
    }
  }

  const storeQuerySuffix = !isAllPlatforms ? PROMOBIT_STORE_QUERY_BY_PLATFORM[platform] || '' : '';

  const needsMoreFiltered = () => {
    if (isAllPlatforms) return countBufferedAll() < pageSize + 4;
    return singleResults.length < pageSize + 4;
  };

  if (!plan.isUnfiltered && !promobitSearchCursor.exhausted && promobitQueryTerms.length > 0) {
    // Skip Promobit search when single-platform Shopee already filled the page via official Shopee Affiliate API
    const skipForFullShopee = platform === 'Shopee' && singleResults.length >= pageSize;
    if (!skipForFullShopee) {
      const maxSearchCalls = isAllPlatforms ? 4 : 5;
      let searchCalls = 0;
      while (
        needsMoreFiltered() &&
        searchCalls < maxSearchCalls &&
        promobitSearchCursor.termIdx < promobitQueryTerms.length
      ) {
        searchCalls += 1;
        const baseTerm = promobitQueryTerms[promobitSearchCursor.termIdx];
        const effectiveTerm = storeQuerySuffix ? `${baseTerm} ${storeQuerySuffix}` : baseTerm;
        const res = await fetchPromobitSearchPage(
          effectiveTerm,
          credentials,
          promobitSearchCursor.apiPage
        );

        let addedInPage = 0;
        for (const item of res.offers) {
          if (!isAllPlatforms && item.platform !== platform) continue;
          if (!offerMatchesSearchPlan(item, plan)) continue;
          if (addOffer(item)) addedInPage += 1;
        }

        // Advance page if Promobit has more pages for this term (up to 6 pages per term = 120 offers/term!)
        if (res.hasMore && promobitSearchCursor.apiPage < 6 && res.offers.length > 0) {
          promobitSearchCursor.apiPage += 1;
          // If a page yielded 0 matching items after page 2, move to next term for fresher matches
          if (addedInPage === 0 && promobitSearchCursor.apiPage > 3) {
            promobitSearchCursor.apiPage = 1;
            promobitSearchCursor.termIdx += 1;
          }
        } else {
          promobitSearchCursor.apiPage = 1;
          promobitSearchCursor.termIdx += 1;
        }
      }

      if (promobitSearchCursor.termIdx >= promobitQueryTerms.length) {
        promobitSearchCursor.exhausted = true;
      }
    }
  }

  // Deep paginated Promobit /subcategories/{slug}/offers (40 offers/page with infinite `after` cursor)
  if (
    !plan.isUnfiltered &&
    needsMoreFiltered() &&
    !promobitSubCursor.exhausted &&
    plan.promobitSubcategorySlugs.length > 0
  ) {
    let subCalls = 0;
    const maxSubCalls = 4;
    while (
      needsMoreFiltered() &&
      subCalls < maxSubCalls &&
      promobitSubCursor.slugIdx < plan.promobitSubcategorySlugs.length
    ) {
      subCalls += 1;
      const slug = plan.promobitSubcategorySlugs[promobitSubCursor.slugIdx];
      const res = await fetchPromobitSubcategoryOffers(slug, credentials, promobitSubCursor.after);

      for (const item of res.offers) {
        if (!isAllPlatforms && item.platform !== platform) continue;
        if (!offerMatchesSearchPlan(item, plan)) continue;
        addOffer(item);
      }

      if (res.nextAfter && res.offers.length >= 15) {
        promobitSubCursor.after = res.nextAfter;
      } else {
        promobitSubCursor.after = null;
        promobitSubCursor.slugIdx += 1;
      }
    }

    if (promobitSubCursor.slugIdx >= plan.promobitSubcategorySlugs.length) {
      promobitSubCursor.exhausted = true;
    }
  }

  // 2. Walk paginated Promobit live store/global offers stream when we still need more items
  const needsMoreFromStream = () => {
    if (isAllPlatforms) {
      const totalBuffered = countBufferedAll();
      if (totalBuffered < pageSize) return true;
      if (plan.isUnfiltered && countPopulatedPlatforms() < 4 && totalBuffered < pageSize * 2) {
        return true;
      }
      return false;
    }
    return singleResults.length < pageSize;
  };

  const singleStoreSlug = !isAllPlatforms ? STORE_SLUG_BY_PLATFORM[platform] : undefined;
  const maxHops = plan.isUnfiltered ? 4 : singleStoreSlug ? 4 : 3;
  let hops = 0;

  while (needsMoreFromStream() && !reachedEnd && hops < maxHops) {
    hops += 1;
    try {
      if (singleStoreSlug) {
        // Walk the dedicated store stream (40 store-native offers per page!) instead of wasting hops on other stores
        const res = await fetchPromobitStoreOffers(
          singleStoreSlug,
          platform as any,
          credentials,
          currentAfter
        );
        if (res.offers.length === 0) {
          reachedEnd = true;
          break;
        }
        for (const item of res.offers) {
          if (!plan.isUnfiltered) {
            if (offerMatchesSearchPlan(item, plan)) {
              addOffer(item);
            } else if (
              !plan.strictSubcategory &&
              !hasManualQuery &&
              plan.parentMatchTokens.length > 0 &&
              offerMatchesTokens(item, plan.parentMatchTokens)
            ) {
              secondaryCandidates.push(item);
            }
          } else {
            addOffer(item);
          }
        }
        currentAfter = res.nextAfter;
        if (!currentAfter) {
          reachedEnd = true;
          break;
        }
        continue;
      }

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
        if (!isAllPlatforms && item.platform !== platform) continue;
        if (!plan.isUnfiltered) {
          if (offerMatchesSearchPlan(item, plan)) {
            addOffer(item);
          } else if (
            !plan.strictSubcategory &&
            !hasManualQuery &&
            plan.parentMatchTokens.length > 0 &&
            offerMatchesTokens(item, plan.parentMatchTokens)
          ) {
            secondaryCandidates.push(item);
          }
        } else {
          addOffer(item);
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

  // 3. Graceful parent-category widening ONLY for broad parent-category browsing (NEVER dump unrelated items when strictSubcategory is active!)
  if (!plan.isUnfiltered && !plan.strictSubcategory && !hasManualQuery) {
    const currentCount = isAllPlatforms ? countBufferedAll() : singleResults.length;
    if (currentCount < pageSize && secondaryCandidates.length > 0) {
      for (const cand of secondaryCandidates) {
        addOffer(cand);
      }
    }

    const afterSecondaryCount = isAllPlatforms ? countBufferedAll() : singleResults.length;
    if (afterSecondaryCount < 3 && plan.parentTerms.length > 0) {
      const parentSearchTerms = plan.parentTerms
        .filter((t) => !plan.primaryTerms.slice(0, 2).includes(t))
        .slice(0, 2);
      if (parentSearchTerms.length > 0) {
        const parentBatches = await Promise.all(
          parentSearchTerms.map((t) =>
            fetchPromobitSearchOffers(storeQuerySuffix ? `${t} ${storeQuerySuffix}` : t, credentials)
          )
        );
        for (const batch of parentBatches) {
          for (const item of batch) {
            if (!isAllPlatforms && item.platform !== platform) continue;
            addOffer(item);
          }
        }
      }
    }
  }

  const hasMorePromobitDeep =
    !plan.isUnfiltered &&
    ((!promobitSearchCursor.exhausted && promobitQueryTerms.length > 0) ||
      (!promobitSubCursor.exhausted && plan.promobitSubcategorySlugs.length > 0));

  // 4. Paginate strictly
  if (isAllPlatforms) {
    const picked = pickStrictRoundRobinPage(
      bucketsByPlatform,
      PLATFORM_CYCLE_ORDER,
      pageSize,
      startCycleIndex
    );
    const remainingTotal = Object.values(picked.remainingBuckets).reduce(
      (sum, list) => sum + list.length,
      0
    );
    const hasMore =
      remainingTotal > 0 ||
      officialHasMore ||
      hasMorePromobitDeep ||
      Boolean(currentAfter && !reachedEnd);

    const nextCursor = hasMore
      ? saveOfferStreamCursor({
          after: reachedEnd ? null : currentAfter,
          overflow: [],
          bucketsByPlatform: picked.remainingBuckets,
          cycleIndex: picked.nextCycleIndex,
          seenIds: Array.from(seenIds).slice(-1500),
          queryKey,
          shopeeCursor,
          promobitSearchCursor,
          promobitSubCursor,
        })
      : null;

    return {
      offers: picked.pageItems,
      nextCursor,
      hasMore,
      warnings,
    };
  }

  const pageOffers = singleResults.slice(0, pageSize);
  const remainingOverflow = singleResults.slice(pageSize);
  const hasMore =
    remainingOverflow.length > 0 ||
    officialHasMore ||
    hasMorePromobitDeep ||
    Boolean(currentAfter && !reachedEnd);

  const nextCursor = hasMore
    ? saveOfferStreamCursor({
        after: reachedEnd ? null : currentAfter,
        overflow: remainingOverflow,
        bucketsByPlatform: {},
        cycleIndex: 0,
        seenIds: Array.from(seenIds).slice(-1500),
        queryKey,
        shopeeCursor,
        promobitSearchCursor,
        promobitSubCursor,
      })
    : null;

  return {
    offers: pageOffers,
    nextCursor,
    hasMore,
    warnings,
  };
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

function isGenericBrandLogoImage(url: string): boolean {
  const lower = String(url || '').toLowerCase();
  if (!lower || !/^https?:\/\//i.test(lower)) return true;
  if (/\.(svg|ico)(\?|$)/i.test(lower)) return true;
  return /favicon|site-logo|brand-logo|mercadolivre[-_]logo|og[-_]logo|static-logo|sprite|default[-_]og|shopee[-_]logo|amazon[-_]logo/i.test(
    lower
  );
}

function titleTokenSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);
  const ta = new Set(norm(a));
  const tb = new Set(norm(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const w of ta) {
    if (tb.has(w)) hits++;
  }
  return hits / Math.min(ta.size, tb.size);
}

async function fetchMercadoLivreItemImageById(itemId: string): Promise<string> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return '';
    const data = (await res.json()) as any;
    const pic =
      data?.pictures?.[0]?.secure_url ||
      data?.pictures?.[0]?.url ||
      data?.secure_thumbnail ||
      data?.thumbnail ||
      '';
    if (!pic) return '';
    return String(pic)
      .replace(/^http:\/\//i, 'https://')
      .replace(/-I\.(jpg|jpeg|webp|png)$/i, '-O.$1');
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

  // For Shopee short links (s.shopee.com.br / shope.ee), expand redirect hops first so we get shopId/itemId cleanly
  if (/(?:s\.shopee\.com\.br|shope\.ee|shp\.ee|shpe\.site)\//i.test(originalInput)) {
    finalUrl = await expandShortUrlManually(originalInput, 6);
  }

  try {
    const res = await fetch(finalUrl, {
      redirect: 'follow',
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    if (res.url) finalUrl = unwrapResolvedProductUrl(res.url, finalUrl);
    if (res.ok) {
      html = await res.text();
    }
  } catch {
    // Continue with expanded URL + message hint + live search enrichment
  }

  const knownMarketplace =
    detectKnownMarketplace(finalUrl) || detectKnownMarketplace(originalInput);
  const platform = knownMarketplace || detectMarketplace(finalUrl);

  // Unwrap Mercado Livre /social/<competitor> pages to the real clean product URL
  let cleanProductUrl = cleanMarketplaceProductUrl(finalUrl, platform);
  if (platform === 'Mercado Livre' && !isMercadoLivreProductUrl(cleanProductUrl) && html) {
    const extractedMlUrl = extractMercadoLivreProductUrlFromHtml(html);
    if (extractedMlUrl) {
      cleanProductUrl = extractedMlUrl;
    }
  }

  let title = '';
  let imageUrl = '';
  let discountPrice = 0;
  let originalPrice = 0;

  const setCandidateImage = (candidate: string) => {
    if (imageUrl) return;
    const clean = decodeHtmlEntities(String(candidate || '').trim()).replace(/^\/\//, 'https://');
    if (clean && !isGenericBrandLogoImage(clean)) {
      imageUrl = clean;
    }
  };

  if (html) {
    // 0. Mercado Livre structured card extraction (featured card only: clean title, previous_price, current_price, discount_pct)
    if (platform === 'Mercado Livre') {
      const mlPricing = extractMercadoLivrePricingFromHtml(html);
      if (mlPricing.title) title = mlPricing.title;
      if (mlPricing.discountPrice && mlPricing.discountPrice > 0) {
        discountPrice = mlPricing.discountPrice;
      }
      if (mlPricing.originalPrice && mlPricing.originalPrice > 0) {
        originalPrice = mlPricing.originalPrice;
      }
    }

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
              const rawImg = Array.isArray(node.image)
                ? String(node.image[0]?.url || node.image[0] || '')
                : String(node.image?.url || node.image || '');
              setCandidateImage(rawImg);
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

    // 2. OpenGraph, Twitter & Meta Tags fallback
    const metaTitle =
      html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1] ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];

    const metaImages = [
      html.match(/property=["']og:image:secure_url["'][^>]*content=["']([^"']+)["']/i)?.[1],
      html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1],
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1],
      html.match(/name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1],
      html.match(/content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i)?.[1],
      html.match(/itemprop=["']image["'][^>]*content=["']([^"']+)["']/i)?.[1],
    ];
    for (const mi of metaImages) {
      if (mi) setCandidateImage(mi);
    }

    // 2B. Marketplace-specific high-res product photo patterns in HTML
    if (!imageUrl) {
      const marketplaceImgPatterns = [
        /https?:\/\/http2\.mlstatic\.com\/D_NQ_NP_[0-9A-Za-z_-]+\.(?:webp|jpg|jpeg|png)/i,
        /https?:\/\/down-[a-z]{2}\.img\.susercontent\.com\/file\/[0-9A-Za-z_-]+/i,
        /https?:\/\/cf\.shopee\.com\.br\/file\/[0-9A-Za-z_-]+/i,
        /https?:\/\/m\.media-amazon\.com\/images\/I\/[0-9A-Za-z+._%-]+\.(?:jpg|jpeg|png|webp)/i,
        /https?:\/\/a-static\.mlcdn\.com\.br\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/i,
        /https?:\/\/static\.netshoes\.com\.br\/produtos\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/i,
        /https?:\/\/ae01\.alicdn\.com\/kf\/[0-9A-Za-z_-]+\.(?:jpg|jpeg|png|webp)/i,
      ];
      for (const re of marketplaceImgPatterns) {
        const hit = html.match(re)?.[0];
        if (hit) {
          setCandidateImage(hit);
          if (imageUrl) break;
        }
      }
    }

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

  // 3A. Mercado Livre official Items API image lookup when HTML didn't expose image
  if (!imageUrl && platform === 'Mercado Livre') {
    const mlbMatch = (cleanProductUrl + ' ' + finalUrl + ' ' + html).match(/\b(MLB-?\d{7,14})\b/i);
    if (mlbMatch?.[1]) {
      const cleanItemId = mlbMatch[1].replace('-', '').toUpperCase();
      const apiImg = await fetchMercadoLivreItemImageById(cleanItemId);
      if (apiImg) setCandidateImage(apiImg);
    }
  }

  // 3A-Shopee. Official Shopee productOfferV2(itemId) lookup for real photo, title & price/discount
  if (platform === 'Shopee') {
    const shopeeIds = extractShopeeIdsFromUrl(cleanProductUrl) || extractShopeeIdsFromUrl(finalUrl);
    if (
      shopeeIds?.itemId &&
      (!title || !imageUrl || !discountPrice || originalPrice <= discountPrice)
    ) {
      const officialShopee = await fetchShopeeProductOfferByItemId(shopeeIds.itemId, credentials);
      if (officialShopee) {
        if (!title && officialShopee.title) title = officialShopee.title;
        if (!imageUrl && officialShopee.imageUrl) setCandidateImage(officialShopee.imageUrl);
        if (!discountPrice && officialShopee.discountPrice > 0) {
          discountPrice = officialShopee.discountPrice;
          originalPrice = officialShopee.originalPrice || officialShopee.discountPrice;
        } else if (
          officialShopee.originalPrice > discountPrice &&
          originalPrice <= discountPrice
        ) {
          originalPrice = officialShopee.originalPrice;
        }
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

  // 4. If WAF blocked direct HTML, enrich via URL slug or title + live verified database (ONLY if title matches!)
  const slugHint = humanizeUrlSlug(cleanProductUrl || finalUrl);
  const searchHint = title || slugHint;
  if ((!title || !discountPrice || !imageUrl) && searchHint && knownMarketplace) {
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
        const ranked = candidates
          .map((c) => ({
            item: c,
            score:
              titleTokenSimilarity(searchHint, c.title) +
              (c.platform === platform ? 0.15 : 0),
          }))
          .sort((a, b) => b.score - a.score);
        const bestMatch = ranked[0];
        if (bestMatch && bestMatch.score >= 0.45) {
          if (!imageUrl && bestMatch.item.imageUrl) {
            setCandidateImage(bestMatch.item.imageUrl);
          }
          if (!discountPrice && bestMatch.item.discountPrice) {
            discountPrice = bestMatch.item.discountPrice;
            originalPrice = bestMatch.item.originalPrice;
          }
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

  // Convert affiliate link using clean product URL (stripping competitor tags & generating user's own short link!)
  let affiliateUrl = formatAffiliateUrlFallback(cleanProductUrl, platform, credentials);
  if (platform === 'Shopee') {
    try {
      const shpConv = await convertShopeeAffiliateLink(cleanProductUrl, credentials);
      if (shpConv.affiliateUrl) {
        affiliateUrl = shpConv.affiliateUrl;
      }
      if (shpConv.cleanProductUrl) {
        cleanProductUrl = shpConv.cleanProductUrl;
      }
    } catch {
      // Keep fallback link
    }
  } else if (platform === 'Mercado Livre') {
    try {
      const mlConv = await convertMercadoLivreAffiliateLink(cleanProductUrl, credentials, html);
      if (mlConv.affiliateUrl) {
        affiliateUrl = mlConv.affiliateUrl;
      }
      if (mlConv.cleanProductUrl) {
        cleanProductUrl = mlConv.cleanProductUrl;
      }
    } catch {
      // Keep fallback link
    }
  }

  const cleanedTitle = cleanOfferTitle(title) || `Oferta ${platform}`;
  const couponCode = extractCouponFromMessageText(messageTextHint);

  return {
    title: cleanedTitle,
    platform,
    knownMarketplace,
    imageUrl,
    originalPrice: originalPrice || 99.9,
    discountPrice: discountPrice || 69.9,
    discountPercent: pct,
    originalUrl: cleanProductUrl || finalUrl,
    affiliateUrl,
    couponCode,
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
  app.set('trust proxy', true);
  app.use(express.json({ limit: '12mb' }));

  app.use('/api/mercadolivre/extension', (req, res, next) => {
    const reqOrigin = req.headers.origin;
    if (reqOrigin) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'buboflow-server', port: PORT });
  });

  app.get('/api/media/captured/:filename', (req, res) => {
    const safeName = path.basename(String(req.params.filename || ''));
    if (!/^[a-zA-Z0-9._-]+$/.test(safeName)) {
      return res.status(400).send('Invalid filename');
    }
    const fullPath = path.join(CAPTURED_MEDIA_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).send('Not found');
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(fullPath);
  });

  app.get('/api/media/proxy', async (req, res) => {
    const target = String(req.query.url || '').trim();
    if (!/^https?:\/\//i.test(target)) {
      return res.status(400).send('Invalid url');
    }
    try {
      const parsed = new URL(target);
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host.endsWith('.local') ||
        /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)
      ) {
        return res.status(403).send('Forbidden host');
      }
      const upstream = await fetch(target, {
        headers: {
          'User-Agent': BROWSER_HEADERS['User-Agent'],
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: parsed.origin + '/',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok) {
        return res.status(upstream.status).send('Image fetch failed');
      }
      const ct = upstream.headers.get('content-type') || 'image/jpeg';
      if (!ct.toLowerCase().startsWith('image/')) {
        return res.status(415).send('Not an image');
      }
      const ab = await upstream.arrayBuffer();
      if (ab.byteLength === 0 || ab.byteLength > 8 * 1024 * 1024) {
        return res.status(413).send('Invalid image size');
      }
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(ab));
    } catch {
      return res.status(502).send('Proxy error');
    }
  });

  // --------------------------------------------------------------------------
  // 0B. MERCADO LIVRE EXTENSION DOWNLOAD + SESSION SYNC + LINK BRIDGE
  // --------------------------------------------------------------------------
  const detectExtensionServerUrl = (req: express.Request, clientOrigin?: string): string => {
    const cleanClientOrigin = String(clientOrigin || '').trim().replace(/\/+$/, '');
    if (
      cleanClientOrigin &&
      /^https?:\/\//i.test(cleanClientOrigin) &&
      !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanClientOrigin)
    ) {
      return cleanClientOrigin.replace(/^http:\/\/([^/]+\.run\.app)/i, 'https://$1');
    }

    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwardedHost || req.get('host') || `localhost:${PORT}`;
    const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);

    if (isLocalHost) {
      if (cleanClientOrigin && /^https?:\/\//i.test(cleanClientOrigin)) {
        return cleanClientOrigin;
      }
      return `http://${host}`;
    }

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const proto = forwardedProto === 'http' && !host.endsWith('.run.app') ? 'http' : 'https';
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
    const session = (key && mlExtensionSessions[key]) || resolveMlExtensionSession(key);
    res.setHeader('Cache-Control', 'no-store');
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
    const nowIso = new Date().toISOString();
    mlExtensionSessions[cleanKey] = {
      extensionKey: cleanKey,
      etiqueta: String(etiqueta || prev?.etiqueta || '').trim(),
      cookieHeader: String(cookieHeader || ''),
      cookiesCount: Number(cookiesCount) || 0,
      hasSsid: Boolean(hasSsid),
      mlUserId: mlUserId ? String(mlUserId) : null,
      browserName: String(browserName || 'Navegador'),
      lastSyncAt: nowIso,
      lastPollAt: nowIso,
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
      panelStore.updatedAt = nowIso;
      saveStoredPanelState();
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      synced: true,
      extensionKey: cleanKey,
      hasSsid: Boolean(hasSsid),
      cookiesCount: Number(cookiesCount) || 0,
      syncedAt: nowIso,
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
          const mergedActiveSegments = dedupeSegmentNames([
            ...getGroupActiveSegments(cp),
            ...getGroupActiveSegments(ip),
          ]);
          const mergedMonitoredSegments = dedupeSegmentNames([
            ...getGroupMonitoredSegments(cp),
            ...getGroupMonitoredSegments(ip),
          ]);
          mergedPrefs[k] = {
            ...ip,
            ...cp,
            activeForOffers: mergedActiveSegments.length > 0,
            activeSegments: mergedActiveSegments,
            monitored: mergedMonitoredSegments.length > 0,
            monitoredSegments: mergedMonitoredSegments,
            useGroupImage: Boolean(cp.useGroupImage ?? ip.useGroupImage ?? false),
            allowedMarketplaces: cp.allowedMarketplaces ?? ip.allowedMarketplaces,
            isPriorityCapture: Boolean(cp.isPriorityCapture || ip.isPriorityCapture),
          };
        }
        const mergedMonitoringGroups = Array.isArray(cur.monitoringGroups) && cur.monitoringGroups.length > 0
          ? cur.monitoringGroups.map((m: any) => {
              const norm = normalizeServerGroupJid(m?.remoteJid);
              const pref = norm ? mergedPrefs[`wa:${norm}`] : null;
              if (!pref) return m;
              const segs = dedupeSegmentNames([
                ...getGroupMonitoredSegments(m),
                ...getGroupMonitoredSegments(pref),
              ]);
              return {
                ...m,
                monitored: segs.length > 0,
                monitoredSegments: segs,
                useGroupImage: Boolean(m.useGroupImage ?? pref.useGroupImage ?? false),
                allowedMarketplaces: m.allowedMarketplaces ?? pref.allowedMarketplaces,
              };
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
          autoDispatchBySegment: {
            ...(incoming.autoDispatchBySegment || {}),
            ...(cur.autoDispatchBySegment || {}),
          },
          templatesBySegment: {
            ...(incoming.templatesBySegment || {}),
            ...(cur.templatesBySegment || {}),
          },
          siteCaptureBySegment: {
            ...(incoming.siteCaptureBySegment || {}),
            ...(cur.siteCaptureBySegment || {}),
          },
          monitoringRulesBySegment: {
            ...(incoming.monitoringRulesBySegment || {}),
            ...(cur.monitoringRulesBySegment || {}),
          },
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

      // Normal browser edit: preserve any server-captured products & server auto-dispatched logs added while client was slightly behind
      const prevAutoDispatch = panelStore.state?.autoDispatch;
      const prevAutoDispatchBySegment = panelStore.state?.autoDispatchBySegment || {};
      const serverProducts: any[] = Array.isArray(panelStore.state.products)
        ? panelStore.state.products
        : [];
      const incomingProducts: any[] = Array.isArray(incoming.products)
        ? incoming.products
        : [];
      let finalProducts = incomingProducts;
      let finalSentLogs: any[] = Array.isArray(incoming.sentLogs) ? incoming.sentLogs : [];
      let finalTotalSent = Number(incoming.totalSentCount) || 0;

      if (Number(clientVersion) < panelStore.version) {
        const capturedMissing = serverProducts.filter(
          (p) =>
            String(p?.id || '').startsWith('prod-mon-') &&
            !incomingProducts.some((ip) => ip?.id === p.id)
        );
        if (capturedMissing.length > 0) {
          finalProducts = [...capturedMissing, ...incomingProducts];
        }

        const serverLogs: any[] = Array.isArray(panelStore.state.sentLogs)
          ? panelStore.state.sentLogs
          : [];
        const autoLogsMissing = serverLogs.filter(
          (l) =>
            String(l?.id || '').startsWith('sent-auto-') &&
            !finalSentLogs.some((il) => il?.id === l.id)
        );
        if (autoLogsMissing.length > 0) {
          finalSentLogs = [...autoLogsMissing, ...finalSentLogs];
        }
        finalTotalSent = Math.max(
          finalTotalSent,
          Number(panelStore.state.totalSentCount) || 0
        );
      }

      panelStore.state = reconcilePanelWithActiveMlExtension({
        ...incoming,
        products: finalProducts,
        sentLogs: finalSentLogs,
        totalSentCount: finalTotalSent,
      });
      panelStore.hasServerState = true;
      panelStore.version += 1;
      panelStore.updatedAt = new Date().toISOString();
      saveStoredPanelState();

      // If auto-dispatch was just enabled or interval shortened for any segment, adjust that segment's next run promptly
      const allSegments = dedupeSegmentNames([
        DEFAULT_SEGMENT,
        ...(Array.isArray(panelStore.state?.segments) ? panelStore.state.segments : []),
      ]);
      for (const seg of allSegments) {
        const prevCfg = resolveSegmentConfig(
          prevAutoDispatchBySegment,
          prevAutoDispatch || INITIAL_AUTO_DISPATCH,
          seg,
          createDefaultAutoDispatchForSegment
        );
        const nextCfg = resolveSegmentConfig(
          panelStore.state?.autoDispatchBySegment,
          panelStore.state?.autoDispatch || INITIAL_AUTO_DISPATCH,
          seg,
          createDefaultAutoDispatchForSegment
        );
        if (nextCfg?.enabled) {
          const rt = getAutoDispatchSegmentRuntime(seg);
          if (!prevCfg?.enabled) {
            rt.nextRunAt = Date.now() + 10_000;
          } else {
            const maxMs = Math.max(1, Number(nextCfg.maxIntervalMinutes) || 6) * 60_000;
            if (rt.nextRunAt > Date.now() + maxMs) {
              rt.nextRunAt = Date.now() + maxMs;
            }
          }
        }
      }

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
  // 0. REAL PLATFORM CATEGORIES & SUBCATEGORIES (Live Cached + Curated)
  // --------------------------------------------------------------------------
  app.get('/api/platforms/categories', async (req, res) => {
    try {
      const platform = String(req.query?.platform || 'Todas as Plataformas').trim();
      const result = await getCategoriesForPlatform(platform);
      res.json({
        ok: true,
        platform,
        source: result.source,
        categories: result.categories,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err.message || 'Falha ao carregar categorias da plataforma.',
        categories: FALLBACK_PLATFORM_CATEGORIES['Todas as Plataformas'],
      });
    }
  });

  // --------------------------------------------------------------------------
  // 1. UNIFIED MARKETPLACE LIVE SEARCH (Official APIs + Live Verified Feeds)
  // --------------------------------------------------------------------------
  app.post('/api/platforms/search', async (req, res) => {
    try {
      const {
        query = '',
        platform = 'Todas as Plataformas',
        category = 'Todas as Categorias',
        subcategory = 'Todas as Subcategorias',
        credentials = {},
        page = 1,
        limit = 10,
        cursor = null,
      } = req.body || {};

      const pageNum = Math.max(1, Number(page) || 1);
      const pageSize = Math.max(1, Math.min(200, Number(limit) || 10));
      const cleanQuery = String(query || '').trim();

      const liveRes = await searchVerifiedLiveOffers(cleanQuery, platform, credentials, {
        page: pageNum,
        limit: pageSize,
        cursor,
        category: String(category || 'Todas as Categorias'),
        subcategory: String(subcategory || 'Todas as Subcategorias'),
      });

      res.json({
        ok: true,
        offers: liveRes.offers,
        page: pageNum,
        limit: pageSize,
        nextCursor: liveRes.nextCursor,
        hasMore: liveRes.hasMore,
        warnings: liveRes.warnings,
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
      const originalInput = url.trim();
      const mergedCredentials = {
        ...(panelStore.state?.integrations || {}),
        ...credentials,
      };
      const initialPlatform = detectKnownMarketplace(originalInput);

      // Shopee: ALWAYS expand short links & clean competitor params BEFORE calling generateShortLink
      if (initialPlatform === 'Shopee') {
        const shpConv = await convertShopeeAffiliateLink(originalInput, mergedCredentials);
        return res.json({
          ok: true,
          platform: 'Shopee',
          originalProductUrl: shpConv.cleanProductUrl,
          affiliateUrl: shpConv.affiliateUrl,
          officialApi: shpConv.officialApi,
        });
      }

      // Mercado Livre: ALWAYS unwrap /sec/, meli.la, and /social/<competitor> to clean product URL BEFORE createLink
      if (initialPlatform === 'Mercado Livre') {
        const mlConv = await convertMercadoLivreAffiliateLink(originalInput, mergedCredentials);
        return res.json({
          ok: true,
          platform: 'Mercado Livre',
          originalProductUrl: mlConv.cleanProductUrl,
          affiliateUrl: mlConv.affiliateUrl,
          officialApi: mlConv.officialApi,
        });
      }

      // Generic / shortened link: expand redirects first to discover true marketplace
      let resolvedUrl = await expandShortUrlManually(originalInput, 6);
      const detected = detectMarketplace(resolvedUrl);

      if (detected === 'Shopee') {
        const shpConv = await convertShopeeAffiliateLink(resolvedUrl, mergedCredentials);
        return res.json({
          ok: true,
          platform: 'Shopee',
          originalProductUrl: shpConv.cleanProductUrl,
          affiliateUrl: shpConv.affiliateUrl,
          officialApi: shpConv.officialApi,
        });
      }

      if (detected === 'Mercado Livre') {
        const mlConv = await convertMercadoLivreAffiliateLink(resolvedUrl, mergedCredentials);
        return res.json({
          ok: true,
          platform: 'Mercado Livre',
          originalProductUrl: mlConv.cleanProductUrl,
          affiliateUrl: mlConv.affiliateUrl,
          officialApi: mlConv.officialApi,
        });
      }

      const cleanUrl = cleanMarketplaceProductUrl(resolvedUrl, detected);

      // Official AliExpress Link Generator if valid credentials exist
      if (
        detected === 'AliExpress' &&
        mergedCredentials?.aliexpress?.appKey &&
        mergedCredentials?.aliexpress?.appSecret
      ) {
        try {
          const aliRes = await callAliExpressApi(
            mergedCredentials.aliexpress.appKey,
            mergedCredentials.aliexpress.appSecret,
            'aliexpress.affiliate.link.generate',
            {
              promotion_link_type: '0',
              source_values: cleanUrl,
              tracking_id: mergedCredentials.aliexpress.trackingId || 'default',
            }
          );
          const gen =
            aliRes?.aliexpress_affiliate_link_generate_response?.resp_result?.result
              ?.promotion_links?.promotion_link?.[0]?.promotion_link;
          if (gen) {
            return res.json({
              ok: true,
              platform: detected,
              originalProductUrl: cleanUrl,
              affiliateUrl: gen,
              officialApi: true,
            });
          }
        } catch {
          // Fall back below
        }
      }

      const affiliateUrl = formatAffiliateUrlFallback(cleanUrl, detected, mergedCredentials);
      res.json({
        ok: true,
        platform: detected,
        originalProductUrl: cleanUrl,
        affiliateUrl,
        officialApi: false,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Auto-reconvert any stored products that still carry a competitor's /social/ or unconverted URL,
  // enrich ML products missing originalPrice/discountPercent or carrying "- R$" in title,
  // and clean legacy dummy coupon URL from the default Shopee template.
  async function reconvertStaleProductAffiliatesInStore(targetProductId?: string) {
    const st = panelStore.state;
    if (!st) {
      return { updatedCount: 0, products: [] as any[] };
    }

    let templatesUpdated = false;
    let nextTemplates = st.templates;
    if (!targetProductId && Array.isArray(st.templates)) {
      const shopeeCouponBlock = '\n\n🎟️ Resgate Cupons:\nhttps://s.shopee.com.br/8AXZEODUrk';
      nextTemplates = st.templates.map((tpl: any) => {
        let updatedTpl = tpl;

        // Restore fixed Shopee coupon block if it was previously stripped from default tpl-shopee
        if (
          updatedTpl?.id === 'tpl-shopee' &&
          typeof updatedTpl?.body === 'string' &&
          !updatedTpl.body.includes('Resgate Cupons') &&
          updatedTpl.body.includes('\n\n⚠️ Promoção sujeita a alteração a qualquer momento.')
        ) {
          templatesUpdated = true;
          updatedTpl = {
            ...updatedTpl,
            body: updatedTpl.body.replace(
              '\n\n⚠️ Promoção sujeita a alteração a qualquer momento.',
              `${shopeeCouponBlock}\n\n⚠️ Promoção sujeita a alteração a qualquer momento.`
            ),
          };
        }

        // Ensure default templates have a blank-line spacer between product name (cond-1) and De: (cond-2)
        if (
          Array.isArray(updatedTpl?.conditions) &&
          updatedTpl.conditions.length === 2 &&
          updatedTpl.conditions[0]?.variable === 'cta_ia' &&
          updatedTpl.conditions[1]?.variable === 'desconto_pct' &&
          !String(updatedTpl.conditions[0]?.elseText || '').includes('\n') &&
          !String(updatedTpl.conditions[1]?.thenText || '').startsWith('\n')
        ) {
          templatesUpdated = true;
          updatedTpl = {
            ...updatedTpl,
            conditions: [
              updatedTpl.conditions[0],
              {
                id: 'cond-space-1',
                variable: 'espaco',
                operator: 'sempre',
                thenText: '',
                elseText: '',
              },
              updatedTpl.conditions[1],
            ],
          };
        }

        return updatedTpl;
      });
    }

    const rawProducts = Array.isArray(st.products) ? st.products : [];
    const creds = st.integrations || {};
    const ownMlTag = creds?.mercadoLivre?.etiqueta?.trim() || '';
    let updatedCount = 0;

    const nextProducts = [];
    for (const prod of rawProducts) {
      if (targetProductId && prod.id !== targetProductId) {
        nextProducts.push(prod);
        continue;
      }

      let workingProd = prod;
      let changed = false;

      if (needsAffiliateReconversion(workingProd, ownMlTag)) {
        const sourceUrl = String(workingProd.originalUrl || workingProd.affiliateUrl || '').trim();
        if (sourceUrl) {
          try {
            if (workingProd.platform === 'Mercado Livre') {
              const conv = await convertMercadoLivreAffiliateLink(sourceUrl, creds);
              if (
                conv.affiliateUrl &&
                conv.affiliateUrl !== workingProd.affiliateUrl &&
                !/mercadolivre\.com\.br\/social\//i.test(conv.affiliateUrl)
              ) {
                workingProd = {
                  ...workingProd,
                  originalUrl: conv.cleanProductUrl || workingProd.originalUrl,
                  affiliateUrl: conv.affiliateUrl,
                };
                changed = true;
              }
            } else if (workingProd.platform === 'Shopee') {
              const known = detectKnownMarketplace(sourceUrl);
              if (known === 'Shopee') {
                const conv = await convertShopeeAffiliateLink(sourceUrl, creds);
                if (
                  conv.officialApi &&
                  conv.affiliateUrl &&
                  conv.affiliateUrl !== workingProd.affiliateUrl
                ) {
                  workingProd = {
                    ...workingProd,
                    originalUrl: conv.cleanProductUrl || workingProd.originalUrl,
                    affiliateUrl: conv.affiliateUrl,
                  };
                  changed = true;
                }
              }
            }
          } catch (err: any) {
            console.warn(
              '[Reconvert] Falha ao reconverter produto',
              workingProd.id,
              err?.message || err
            );
          }
        }
      }

      // Enrich Mercado Livre products with clean title and real De:/Por:/% OFF from their meli.la card
      const cleanedExistingTitle = cleanOfferTitle(workingProd.title || '');
      if (cleanedExistingTitle && cleanedExistingTitle !== workingProd.title) {
        workingProd = { ...workingProd, title: cleanedExistingTitle };
        changed = true;
      }

      const needsMlPricingRepair =
        workingProd.platform === 'Mercado Livre' &&
        (Number(workingProd.discountPercent || 0) <= 0 ||
          Number(workingProd.originalPrice || 0) <= Number(workingProd.discountPrice || 0));

      if (needsMlPricingRepair && workingProd.affiliateUrl) {
        try {
          const pageRes = await fetch(workingProd.affiliateUrl, {
            redirect: 'follow',
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(7000),
          });
          if (pageRes.ok) {
            const pageHtml = await pageRes.text();
            const mlPricing = extractMercadoLivrePricingFromHtml(pageHtml);
            const nextTitle = mlPricing.title || workingProd.title;
            const nextDisc =
              mlPricing.discountPrice && mlPricing.discountPrice > 0
                ? mlPricing.discountPrice
                : Number(workingProd.discountPrice || 0);
            const nextOrig =
              mlPricing.originalPrice && mlPricing.originalPrice > nextDisc
                ? mlPricing.originalPrice
                : Number(workingProd.originalPrice || nextDisc);
            const nextPct =
              nextOrig > nextDisc
                ? Math.round(((nextOrig - nextDisc) / nextOrig) * 100)
                : mlPricing.discountPercent || 0;
            if (
              nextTitle !== workingProd.title ||
              nextOrig !== workingProd.originalPrice ||
              nextDisc !== workingProd.discountPrice ||
              nextPct !== workingProd.discountPercent
            ) {
              const commPct =
                Number(workingProd.commissionPercent) ||
                DEFAULT_COMMISSION_BY_PLATFORM['Mercado Livre'] ||
                12;
              workingProd = {
                ...workingProd,
                title: nextTitle,
                originalPrice: nextOrig,
                discountPrice: nextDisc,
                discountPercent: nextPct,
                commissionValue: Number(((nextDisc * commPct) / 100).toFixed(2)),
              };
              changed = true;
            }
          }
        } catch (err: any) {
          console.warn(
            '[Reconvert] Falha ao atualizar preço/desconto ML de',
            workingProd.id,
            err?.message || err
          );
        }
      }

      if (changed) updatedCount += 1;
      nextProducts.push(workingProd);
    }

    if (updatedCount > 0 || templatesUpdated) {
      panelStore.state = {
        ...panelStore.state,
        products: nextProducts,
        templates: nextTemplates,
      };
      panelStore.version += 1;
      panelStore.updatedAt = new Date().toISOString();
      saveStoredPanelState();
      console.log(
        `[Afiliados] Atualização automática concluída: ${updatedCount} produto(s), template Shopee limpo=${templatesUpdated}.`
      );
    }

    return { updatedCount, products: nextProducts };
  }

  app.post('/api/products/reconvert-affiliates', async (req, res) => {
    try {
      const { productId } = req.body || {};
      const result = await reconvertStaleProductAffiliatesInStore(
        typeof productId === 'string' ? productId : undefined
      );
      res.json({
        ok: true,
        updatedCount: result.updatedCount,
        version: panelStore.version,
        products: result.products,
      });
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

      const standardizedTgImg = imageUrl
        ? await loadStandardizedProductImage(String(imageUrl))
        : null;

      for (const chatId of chatIds) {
        try {
          if (standardizedTgImg) {
            const form = new FormData();
            form.append('chat_id', String(chatId));
            form.append('caption', htmlText.slice(0, 1024));
            form.append('parse_mode', 'HTML');
            form.append(
              'photo',
              new Blob([new Uint8Array(standardizedTgImg.buffer)], { type: 'image/jpeg' }),
              'oferta.jpg'
            );
            const r = await fetch(`https://api.telegram.org/bot${cleanToken}/sendPhoto`, {
              method: 'POST',
              body: form,
            });
            const j = (await r.json()) as any;
            if (j.ok) {
              results.push({ chatId, ok: true });
              continue;
            }
          } else if (imageUrl) {
            if (String(imageUrl).startsWith('data:image/')) {
              const match = String(imageUrl).match(/^data:(image\/\w+);base64,(.+)$/);
              if (match) {
                const mime = match[1];
                const buffer = Buffer.from(match[2], 'base64');
                const form = new FormData();
                form.append('chat_id', String(chatId));
                form.append('caption', htmlText.slice(0, 1024));
                form.append('parse_mode', 'HTML');
                form.append('photo', new Blob([new Uint8Array(buffer)], { type: mime }), 'oferta.jpg');

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
    const cachedGroupsMap = new Map<
      string,
      {
        remoteJid: string;
        name: string;
        membersCount: number;
        accountId: string;
        isOwner?: boolean;
        isAdmin?: boolean;
        isOwnerOrAdmin?: boolean;
      }
    >();
    for (const [accId, cache] of Object.entries(liveWaStats.cachedGroupsByAccount || {})) {
      for (const g of cache?.groups || []) {
        const jid = normalizeServerGroupJid(g.remoteJid);
        if (!jid.endsWith('@g.us')) continue;
        const prev = cachedGroupsMap.get(jid);
        if (!prev || g.membersCount > prev.membersCount || (g.isOwnerOrAdmin !== undefined && prev.isOwnerOrAdmin === undefined)) {
          cachedGroupsMap.set(jid, {
            remoteJid: jid,
            name: g.name,
            membersCount: g.membersCount,
            accountId: accId,
            isOwner: g.isOwner,
            isAdmin: g.isAdmin,
            isOwnerOrAdmin: g.isOwnerOrAdmin,
          });
        }
      }
    }
    res.json({
      ok: true,
      memberEvents: liveWaStats.memberEvents,
      capturedTodayByJid: todayCaptures,
      cachedGroups: Array.from(cachedGroupsMap.values()),
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
        const findSession = () => {
          const exact = baileysSessions.get(safeId);
          if (exact) return exact;
          const allowFallback = safeId === 'acc-wa-1' || safeId === '__any__';
          if (allowFallback) {
            return (
              Array.from(baileysSessions.values()).find((s) => s.status === 'open' && s.sock) ||
              Array.from(baileysSessions.values()).find((s) => s.status === 'connecting')
            );
          }
          return undefined;
        };

        let session = findSession();

        // If session is temporarily reconnecting, wait briefly (up to 3.6s) for the socket to open
        if (session && session.status === 'connecting') {
          for (let waitIdx = 0; waitIdx < 12; waitIdx++) {
            await new Promise((r) => setTimeout(r, 300));
            session = findSession();
            if (!session || session.status === 'open' || session.status === 'closed') break;
          }
        }

        // If a registered session exists on disk but isn't open, kick off auto-reconnect safely
        if ((!session || session.status !== 'open' || !session.sock) && !loggedOutBaileysAccounts.has(safeId)) {
          const sessionDir = path.join(WA_SESSIONS_ROOT, safeId);
          const credsFile = path.join(sessionDir, 'creds.json');
          if (fs.existsSync(credsFile)) {
            void startBaileysSocket(safeId, { mode: 'qr' });
          }
        }

        if (!session || session.status !== 'open' || !session.sock) {
          const fallback = getFallbackCachedGroupsForAccount(safeId);
          if (fallback && fallback.groups.length > 0) {
            return res.json({
              ok: true,
              cached: true,
              reconnecting: true,
              accountId: fallback.accountId,
              phone: fallback.phone,
              name: fallback.name,
              groups: fallback.groups,
            });
          }
          return res.status(400).json({
            ok: false,
            error:
              'Conecte primeiro seu WhatsApp via QR Code ou Número de Telefone para puxar os grupos.',
          });
        }

        try {
          const participating = await session.sock.groupFetchAllParticipating();
          const selfIds = getBaileysSelfIdentifiers(session.accountId, session.sock);
          const today = new Date().toISOString().slice(0, 10);
          const uniqueByJid = new Map<
            string,
            {
              remoteJid: string;
              name: string;
              membersCount: number;
              capturedToday: number;
              isOwner: boolean;
              isAdmin: boolean;
              isOwnerOrAdmin: boolean;
            }
          >();
          for (const g of Object.values(participating || {}) as any[]) {
            const rawJid = String(g?.id || '').trim();
            if (!rawJid.endsWith('@g.us')) continue;
            const jid = normalizeServerGroupJid(rawJid);
            const cap = liveWaStats.capturedByGroupJid[jid] || liveWaStats.capturedByGroupJid[rawJid];
            const membersCount = Number(g.participants?.length || g.size || 0);
            const role = detectGroupAdminRole(g, selfIds);
            const existing = uniqueByJid.get(jid);
            if (!existing || membersCount > existing.membersCount) {
              uniqueByJid.set(jid, {
                remoteJid: jid,
                name: String(g.subject || jid),
                membersCount,
                capturedToday: cap && cap.date === today ? cap.count : 0,
                isOwner: role.isOwner,
                isAdmin: role.isAdmin,
                isOwnerOrAdmin: role.isOwnerOrAdmin,
              });
            }
          }
          const groups = Array.from(uniqueByJid.values()).sort((a, b) =>
            a.name.localeCompare(b.name, 'pt-BR')
          );
          cacheBaileysGroupsForAccount(
            session.accountId,
            session.connectedPhone,
            session.connectedName,
            groups
          );
          return res.json({
            ok: true,
            cached: false,
            reconnecting: false,
            accountId: session.accountId,
            phone: session.connectedPhone,
            name: session.connectedName,
            groups,
          });
        } catch (fetchErr: any) {
          // Socket closed mid-call (e.g. "Connection Closed"): mark connecting, auto-heal, and serve cached real groups!
          const msg = String(fetchErr?.message || 'Connection Closed');
          session.status = 'connecting';
          session.sock = null;
          void startBaileysSocket(session.accountId, { mode: 'qr' });

          const fallback = getFallbackCachedGroupsForAccount(session.accountId);
          if (fallback && fallback.groups.length > 0) {
            return res.json({
              ok: true,
              cached: true,
              reconnecting: true,
              accountId: session.accountId,
              phone: session.connectedPhone || fallback.phone,
              name: session.connectedName || fallback.name,
              groups: fallback.groups,
            });
          }
          return res.status(503).json({
            ok: false,
            reconnecting: true,
            error: `WhatsApp reconectando (${msg}). Aguarde alguns segundos e tente novamente.`,
          });
        }
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

  async function sendBaileysOfferToJids(params: {
    accountId?: string;
    remoteJids: string[];
    message: string;
    imageUrl?: string;
    enableLinkPreview?: boolean;
    mentionAll?: boolean;
  }): Promise<{
    ok: boolean;
    sentCount: number;
    results: { jid: string; ok: boolean; error?: string }[];
    error?: string;
  }> {
    const {
      accountId = 'acc-wa-1',
      remoteJids,
      message,
      imageUrl = '',
      enableLinkPreview = true,
      mentionAll = false,
    } = params;

    const safeId = sanitizeAccountId(String(accountId));
    const exact = baileysSessions.get(safeId);
    const session =
      exact && exact.status === 'open' && exact.sock
        ? exact
        : Array.from(baileysSessions.values()).find((s) => s.status === 'open' && s.sock);

    if (!session || session.status !== 'open' || !session.sock) {
      return {
        ok: false,
        sentCount: 0,
        results: [],
        error:
          'Sessão Baileys desconectada. Escaneie o QR Code ou conecte com número de telefone em Contas WhatsApp.',
      };
    }

    const results: { jid: string; ok: boolean; error?: string }[] = [];
    let standardizedImg: StandardizedProductImage | null = null;
    let mediaBuf: Buffer | null = null;
    if (imageUrl) {
      try {
        standardizedImg = await loadStandardizedProductImage(String(imageUrl));
        mediaBuf = standardizedImg ? standardizedImg.buffer : await loadImageBuffer(String(imageUrl));
      } catch {
        standardizedImg = null;
        mediaBuf = null;
      }
    }

    const previewMeta = enableLinkPreview
      ? buildWhatsAppLinkPreviewMeta(String(message))
      : null;
    let richLinkPreview: any = null;

    if (enableLinkPreview && previewMeta) {
      richLinkPreview = {
        'canonical-url': previewMeta.matchedUrl,
        'matched-text': previewMeta.matchedUrl,
        title: previewMeta.title,
        description: previewMeta.description,
      };

      if (mediaBuf) {
        try {
          const jpegBuf = standardizedImg ? standardizedImg.buffer : mediaBuf;
          const smallThumbBuf = standardizedImg?.smallThumbBuffer;

          if (typeof (session.sock as any).waUploadToServer === 'function') {
            const prepared = await prepareWAMessageMedia(
              {
                image: jpegBuf,
                mimetype: 'image/jpeg',
              },
              {
                upload: (session.sock as any).waUploadToServer,
                mediaTypeOverride: 'thumbnail-link',
              }
            );
            if (prepared?.imageMessage) {
              if (standardizedImg) {
                prepared.imageMessage.width = standardizedImg.width;
                prepared.imageMessage.height = standardizedImg.height;
              }
              richLinkPreview.highQualityThumbnail = prepared.imageMessage;
              richLinkPreview.jpegThumbnail =
                smallThumbBuf ||
                (prepared.imageMessage.jpegThumbnail
                  ? Buffer.from(prepared.imageMessage.jpegThumbnail)
                  : jpegBuf);
            } else if (smallThumbBuf) {
              richLinkPreview.jpegThumbnail = smallThumbBuf;
            }
          } else if (smallThumbBuf) {
            richLinkPreview.jpegThumbnail = smallThumbBuf;
          }
        } catch (thumbErr: any) {
          console.warn(
            '[Baileys] Aviso ao gerar miniatura de linkPreview:',
            thumbErr?.message || thumbErr
          );
        }
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

        if (enableLinkPreview && richLinkPreview) {
          const sent = await session.sock.sendMessage(jid, {
            text: String(message),
            linkPreview: richLinkPreview,
            ...(mentions ? { mentions } : {}),
          });
          markRecentOutgoingWaMsgId(sent?.key?.id);
        } else if (mediaBuf) {
          const imagePayload: any = {
            image: mediaBuf,
            mimetype: 'image/jpeg',
            caption: String(message),
            ...(standardizedImg
              ? {
                  width: standardizedImg.width,
                  height: standardizedImg.height,
                }
              : {}),
            ...(mentions ? { mentions } : {}),
          };
          const sent = await session.sock.sendMessage(jid, imagePayload);
          markRecentOutgoingWaMsgId(sent?.key?.id);
        } else {
          const sent = await session.sock.sendMessage(jid, {
            text: String(message),
            linkPreview: null,
            ...(mentions ? { mentions } : {}),
          });
          markRecentOutgoingWaMsgId(sent?.key?.id);
        }
        results.push({ jid, ok: true });
      } catch (err: any) {
        results.push({ jid, ok: false, error: err?.message || 'Erro ao enviar via Baileys' });
      }
    }

    const sentCount = results.filter((r) => r.ok).length;
    return {
      ok: sentCount > 0,
      sentCount,
      results,
      error: sentCount === 0 ? results[0]?.error || 'Falha ao entregar nos grupos.' : undefined,
    };
  }

  interface AutoDispatchSegmentRuntime {
    running: boolean;
    nextRunAt: number;
    lastRunAt: number;
    recentProductIds: string[];
  }

  const autoDispatchRuntimeBySegment = new Map<string, AutoDispatchSegmentRuntime>();

  function getAutoDispatchSegmentRuntime(segment?: string): AutoDispatchSegmentRuntime {
    const key = normalizeSegmentName(segment).toLowerCase();
    let rt = autoDispatchRuntimeBySegment.get(key);
    if (!rt) {
      rt = {
        running: false,
        nextRunAt: Date.now() + 25_000,
        lastRunAt: 0,
        recentProductIds: [],
      };
      autoDispatchRuntimeBySegment.set(key, rt);
    }
    return rt;
  }

  async function runAutoDispatchCycle(
    options: { manual?: boolean; segment?: string } = {}
  ): Promise<{
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    sentProductsCount: number;
    sentGroupsCount: number;
    titles: string[];
    error?: string;
  }> {
    const st = panelStore.state;
    if (!st) {
      return {
        ok: false,
        skipped: true,
        reason: 'no_state',
        sentProductsCount: 0,
        sentGroupsCount: 0,
        titles: [],
        error: 'Estado do painel ainda não carregado.',
      };
    }

    const targetSegment = normalizeSegmentName(
      options.segment || st.activeSegment || DEFAULT_SEGMENT
    );
    const segmentRuntime = getAutoDispatchSegmentRuntime(targetSegment);

    if (segmentRuntime.running) {
      return {
        ok: false,
        skipped: true,
        reason: 'already_running',
        sentProductsCount: 0,
        sentGroupsCount: 0,
        titles: [],
        error: `Já existe um disparo automático em execução no segmento "${targetSegment}".`,
      };
    }

    const cfg = resolveSegmentConfig(
      st.autoDispatchBySegment,
      st.autoDispatch || INITIAL_AUTO_DISPATCH,
      targetSegment,
      createDefaultAutoDispatchForSegment
    );
    if (!options.manual && !cfg?.enabled) {
      return {
        ok: false,
        skipped: true,
        reason: 'disabled',
        sentProductsCount: 0,
        sentGroupsCount: 0,
        titles: [],
      };
    }

    const effectiveCfg = cfg || createDefaultAutoDispatchForSegment();

    const brTime = getBrazilTimeInfo(new Date());
    const inWindow = isWithinDispatchWindow(
      effectiveCfg.startTime || '07:00',
      effectiveCfg.endTime || '22:00',
      brTime.totalMinutes
    );

    if (!options.manual && !inWindow) {
      return {
        ok: false,
        skipped: true,
        reason: 'outside_window',
        sentProductsCount: 0,
        sentGroupsCount: 0,
        titles: [],
      };
    }

    const targets = resolveActiveDispatchTargets({
      dispatchGroups: st.dispatchGroups,
      savedGroupPrefs: st.savedGroupPrefs,
      targetSegment,
    });

    const accounts: any[] = Array.isArray(st.accounts) ? st.accounts : [];
    const hasOpenBaileys = Array.from(baileysSessions.values()).some(
      (s) => s.status === 'open' && s.sock
    );
    const usableWaGroups = hasOpenBaileys ? targets.waGroups : [];
    const usableTgTargets = targets.tgGroups
      .map((tg) => {
        const acc = accounts.find(
          (a) => a.channel === 'Telegram' && (a.id === tg.accountId || a.apiToken)
        );
        return acc?.apiToken ? { ...tg, botToken: String(acc.apiToken) } : null;
      })
      .filter(Boolean) as { remoteJid: string; name: string; botToken: string }[];

    if (targets.waGroups.length === 0 && targets.tgGroups.length === 0) {
      return {
        ok: false,
        skipped: !options.manual,
        reason: 'no_active_groups',
        sentProductsCount: 0,
        sentGroupsCount: 0,
        titles: [],
        error: `Nenhum grupo com "Enviar Ofertas" ativado no segmento "${targetSegment}". Ative ao menos um grupo em Grupos de Envio.`,
      };
    }

    if (usableWaGroups.length === 0 && usableTgTargets.length === 0) {
      return {
        ok: false,
        skipped: !options.manual,
        reason: 'whatsapp_disconnected',
        sentProductsCount: 0,
        sentGroupsCount: 0,
        titles: [],
        error:
          'WhatsApp desconectado. Conecte sua conta em Canais → WhatsApp para iniciar os disparos.',
      };
    }

    const productsList = (Array.isArray(st.products) ? st.products : []).filter((p: any) =>
      matchesSegment(p?.segment, targetSegment)
    );
    const segmentSentLogs = (Array.isArray(st.sentLogs) ? st.sentLogs : []).filter((l: any) =>
      matchesSegment(l?.segment, targetSegment)
    );
    const chosenProducts = selectProductsForAutoDispatch({
      products: productsList,
      config: effectiveCfg,
      sentLogs: segmentSentLogs,
      recentAutoProductIds: segmentRuntime.recentProductIds,
    });

    if (chosenProducts.length === 0) {
      return {
        ok: false,
        skipped: !options.manual,
        reason: 'no_products',
        sentProductsCount: 0,
        sentGroupsCount: 0,
        titles: [],
        error: `Nenhum produto salvo na aba Produtos do segmento "${targetSegment}" para disparar.`,
      };
    }

    segmentRuntime.running = true;
    try {
      const integrations = st.integrations || INITIAL_INTEGRATIONS;
      const segmentTemplates = resolveSegmentConfig(
        st.templatesBySegment,
        st.templates || INITIAL_TEMPLATES,
        targetSegment,
        createDefaultTemplatesForSegment
      );
      const templates =
        Array.isArray(segmentTemplates) && segmentTemplates.length > 0
          ? segmentTemplates
          : INITIAL_TEMPLATES;

      let sentProductsCount = 0;
      let totalGroupDeliveries = 0;
      const sentTitles: string[] = [];
      let lastError: string | undefined;

      for (let i = 0; i < chosenProducts.length; i++) {
        let prod = { ...chosenProducts[i] };

        // Ensure affiliate link is always the user's own short link before sending
        if (needsAffiliateReconversion(prod, integrations?.mercadoLivre?.etiqueta)) {
          try {
            const extracted = await extractOfferFromUrl(
              prod.originalUrl || prod.affiliateUrl,
              integrations
            );
            if (
              extracted?.affiliateUrl &&
              !/mercadolivre\.com\.br\/social\//i.test(extracted.affiliateUrl)
            ) {
              prod = {
                ...prod,
                affiliateUrl: extracted.affiliateUrl,
                originalUrl: extracted.originalUrl || prod.originalUrl,
              };
              const curProducts = Array.isArray(panelStore.state?.products)
                ? panelStore.state.products
                : [];
              panelStore.state = {
                ...panelStore.state,
                products: curProducts.map((p: any) => (p.id === prod.id ? prod : p)),
              };
            }
          } catch {
            // Proceed with existing affiliate link
          }
        }

        const tpl =
          templates.find((t: any) => t.platform === prod.platform) ||
          templates[0] ||
          INITIAL_TEMPLATES[0];

        const message = renderProductMessage(prod, tpl, integrations);
        const imageUrl = prod.customImageUrl?.trim() || undefined;
        let deliveredForProduct = 0;
        const deliveredGroupNames: string[] = [];

        if (usableWaGroups.length > 0) {
          const waRes = await sendBaileysOfferToJids({
            accountId: usableWaGroups[0].accountId || 'acc-wa-1',
            remoteJids: usableWaGroups.map((g) => g.remoteJid),
            message,
            imageUrl,
            enableLinkPreview: tpl.enableLinkPreview,
          });
          if (waRes.ok && waRes.sentCount > 0) {
            deliveredForProduct += waRes.sentCount;
            for (const r of waRes.results) {
              if (r.ok) {
                const match = usableWaGroups.find(
                  (g) => normalizeServerGroupJid(g.remoteJid) === normalizeServerGroupJid(r.jid)
                );
                deliveredGroupNames.push(match?.name || r.jid);
              }
            }
          } else if (waRes.error) {
            lastError = waRes.error;
          }
        }

        const standardizedAutoTgImg =
          usableTgTargets.length > 0 && imageUrl
            ? await loadStandardizedProductImage(String(imageUrl))
            : null;
        const autoTgHtml =
          usableTgTargets.length > 0 ? whatsappToTelegramHtml(String(message)) : '';

        for (const tg of usableTgTargets) {
          try {
            let tgRes: Response;
            if (standardizedAutoTgImg) {
              const form = new FormData();
              form.append('chat_id', String(tg.remoteJid));
              form.append('caption', autoTgHtml.slice(0, 1024));
              form.append('parse_mode', 'HTML');
              form.append(
                'photo',
                new Blob([new Uint8Array(standardizedAutoTgImg.buffer)], { type: 'image/jpeg' }),
                'oferta.jpg'
              );
              tgRes = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendPhoto`, {
                method: 'POST',
                body: form,
              });
            } else {
              const endpoint = imageUrl
                ? `https://api.telegram.org/bot${tg.botToken}/sendPhoto`
                : `https://api.telegram.org/bot${tg.botToken}/sendMessage`;
              const bodyPayload = imageUrl
                ? {
                    chat_id: tg.remoteJid,
                    photo: imageUrl,
                    caption: autoTgHtml.slice(0, 1024),
                    parse_mode: 'HTML',
                  }
                : {
                    chat_id: tg.remoteJid,
                    text: autoTgHtml,
                    parse_mode: 'HTML',
                    disable_web_page_preview: !tpl.enableLinkPreview,
                  };
              tgRes = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload),
              });
            }
            if (tgRes.ok) {
              deliveredForProduct += 1;
              deliveredGroupNames.push(tg.name);
            }
          } catch (err: any) {
            lastError = err?.message || 'Erro ao enviar via Telegram';
          }
        }

        if (deliveredForProduct > 0) {
          sentProductsCount += 1;
          totalGroupDeliveries += deliveredForProduct;
          sentTitles.push(prod.title);

          segmentRuntime.recentProductIds.push(prod.id);
          if (segmentRuntime.recentProductIds.length >= productsList.length) {
            // Reset cycle once every saved product in this segment has had a turn
            segmentRuntime.recentProductIds = [prod.id];
          }

          const now = new Date();
          const nowFormatted = now.toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });

          const newLog = {
            id: `sent-auto-${Date.now()}-${i}`,
            title: prod.title,
            message,
            platform: prod.platform,
            groupsNames: deliveredGroupNames,
            sentAt: nowFormatted,
            sentAtIso: now.toISOString(),
            artworkKey: prod.artworkKey,
            customImageUrl: prod.customImageUrl,
            affiliateUrl: prod.affiliateUrl,
            segment: targetSegment,
          };

          const curState = panelStore.state || {};
          const prevProducts = Array.isArray(curState.products) ? curState.products : [];
          const prevLogs = Array.isArray(curState.sentLogs) ? curState.sentLogs : [];
          panelStore.state = {
            ...curState,
            products: prevProducts.filter((p: any) => p.id !== prod.id),
            sentLogs: [newLog, ...prevLogs],
            totalSentCount: (Number(curState.totalSentCount) || 0) + deliveredForProduct,
          };
          panelStore.hasServerState = true;
          panelStore.version += 1;
          panelStore.updatedAt = now.toISOString();
          saveStoredPanelState();

          console.log(
            `[Disparo Automático][${targetSegment}] Enviado e removido da fila de Produtos (${prod.platform}) "${prod.title.slice(0, 50)}" para ${deliveredForProduct} grupo(s) [${brTime.formattedHHMM} BRT].`
          );
        }

        // Small human-like pause between multiple products in the same run
        if (i < chosenProducts.length - 1) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }

      const nextIntervalMin = pickRandomInt(
        effectiveCfg.minIntervalMinutes || 2,
        effectiveCfg.maxIntervalMinutes || 6
      );
      segmentRuntime.lastRunAt = Date.now();
      segmentRuntime.nextRunAt = Date.now() + nextIntervalMin * 60_000;

      return {
        ok: sentProductsCount > 0,
        sentProductsCount,
        sentGroupsCount: totalGroupDeliveries,
        titles: sentTitles,
        error: sentProductsCount === 0 ? lastError || 'Não foi possível entregar a oferta.' : undefined,
      };
    } finally {
      segmentRuntime.running = false;
    }
  }

  app.post('/api/auto-dispatch/run-now', async (req, res) => {
    try {
      const requestedSegment =
        typeof req.body?.segment === 'string' && req.body.segment.trim()
          ? req.body.segment.trim()
          : undefined;
      const result = await runAutoDispatchCycle({ manual: true, segment: requestedSegment });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        sentProductsCount: 0,
        sentGroupsCount: 0,
        titles: [],
        error: err?.message || 'Erro interno ao executar disparo automático.',
      });
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
        const result = await sendBaileysOfferToJids({
          accountId: String(accountId),
          remoteJids: remoteJids.map((j: any) => String(j)),
          message: String(message),
          imageUrl: imageUrl ? String(imageUrl) : '',
          enableLinkPreview: Boolean(enableLinkPreview),
          mentionAll: Boolean(mentionAll),
        });
        if (!result.ok && result.results.length === 0) {
          return res.status(400).json({ ok: false, error: result.error });
        }
        return res.json({
          ok: result.ok,
          sentCount: result.sentCount,
          results: result.results,
          error: result.error,
        });
      }

      const results: { jid: string; ok: boolean; error?: string }[] = [];
      const cleanBase = String(baseUrl).trim().replace(/\/+$/, '');

      const standardizedExternalImg = imageUrl
        ? await loadStandardizedProductImage(String(imageUrl))
        : null;
      const standardizedBase64 = standardizedExternalImg
        ? standardizedExternalImg.buffer.toString('base64')
        : null;

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
                imageUrl: standardizedBase64
                  ? `data:image/jpeg;base64,${standardizedBase64}`
                  : imageUrl,
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
                ? {
                    phone: jid,
                    image: standardizedBase64
                      ? `data:image/jpeg;base64,${standardizedBase64}`
                      : imageUrl,
                    caption: message,
                  }
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
            const mediaValue = standardizedBase64
              ? standardizedBase64
              : String(imageUrl).startsWith('data:')
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
  // Automatically upgrade any older captured products still holding competitor /social/ links
  setTimeout(() => {
    void reconvertStaleProductAffiliatesInStore().catch(() => {});
  }, 1500);

  // 24/7 Server-Side Auto-Dispatch Scheduler per Segment (runs even when no browser tab is open)
  setInterval(() => {
    const st = panelStore.state;
    if (!st) return;
    const allSegments = dedupeSegmentNames([
      DEFAULT_SEGMENT,
      ...(Array.isArray(st.segments) ? st.segments : []),
    ]);
    const now = Date.now();
    for (const seg of allSegments) {
      const cfg = resolveSegmentConfig(
        st.autoDispatchBySegment,
        st.autoDispatch || INITIAL_AUTO_DISPATCH,
        seg,
        createDefaultAutoDispatchForSegment
      );
      if (!cfg?.enabled) continue;
      const rt = getAutoDispatchSegmentRuntime(seg);
      if (rt.running || now < rt.nextRunAt) continue;
      void runAutoDispatchCycle({ manual: false, segment: seg }).catch((err: any) => {
        console.warn(`[Disparo Automático][${seg}] Erro no ciclo automático:`, err?.message || err);
      });
    }
  }, 15_000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
