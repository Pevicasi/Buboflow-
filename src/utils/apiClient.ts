import { Marketplace, PlatformIntegrations } from '../types';
import { PlatformCategory } from './catalogCategories';

export interface LiveOfferResult {
  id: string;
  title: string;
  platform: Marketplace;
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

export async function fetchPlatformCategoriesApi(platform: string): Promise<{
  ok: boolean;
  platform?: string;
  source?: 'live' | 'catalog';
  categories: PlatformCategory[];
  error?: string;
}> {
  const res = await fetch(
    `/api/platforms/categories?platform=${encodeURIComponent(platform || 'Todas as Plataformas')}`
  );
  return res.json();
}

export async function searchPlatformsApi(params: {
  query: string;
  platform: string;
  category?: string;
  subcategory?: string;
  credentials: PlatformIntegrations;
  page?: number;
  limit?: number;
  cursor?: string | null;
}): Promise<{
  ok: boolean;
  offers: LiveOfferResult[];
  page?: number;
  limit?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
  warnings?: string[];
  error?: string;
}> {
  const res = await fetch('/api/platforms/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function testPlatformApi(params: {
  platform: Marketplace;
  credentials: PlatformIntegrations;
}): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('/api/platforms/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function extractOfferUrlApi(params: {
  url: string;
  credentials: PlatformIntegrations;
}): Promise<{
  ok: boolean;
  offer?: {
    title: string;
    platform: Marketplace;
    imageUrl: string;
    originalPrice: number;
    discountPrice: number;
    discountPercent: number;
    originalUrl: string;
    affiliateUrl: string;
  };
  error?: string;
}> {
  const res = await fetch('/api/platforms/extract-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function convertLinkApi(params: {
  url: string;
  credentials: PlatformIntegrations;
}): Promise<{
  ok: boolean;
  platform?: Marketplace;
  originalProductUrl?: string;
  affiliateUrl?: string;
  officialApi?: boolean;
  error?: string;
}> {
  const res = await fetch('/api/platforms/convert-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function reconvertProductAffiliatesApi(productId?: string): Promise<{
  ok: boolean;
  updatedCount?: number;
  version?: number;
  error?: string;
}> {
  const res = await fetch('/api/products/reconvert-affiliates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(productId ? { productId } : {}),
  });
  return res.json();
}

export async function fetchShopeeCommissionsApi(params: {
  credentials: PlatformIntegrations;
  days?: number;
}): Promise<{
  ok: boolean;
  conversions?: {
    id: string;
    product: string;
    qty: number;
    commission: number;
    status: string;
  }[];
  error?: string;
}> {
  const res = await fetch('/api/platforms/shopee-commissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function verifyTelegramBotApi(botToken: string): Promise<{
  ok: boolean;
  bot?: { id: number; name: string; username: string };
  discoveredChats?: { id: string; title: string; type: string; username?: string }[];
  error?: string;
}> {
  const res = await fetch('/api/telegram/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken }),
  });
  return res.json();
}

export async function sendTelegramApi(params: {
  botToken: string;
  chatIds: string[];
  message: string;
  imageUrl?: string;
  enableLinkPreview?: boolean;
}): Promise<{
  ok: boolean;
  sentCount?: number;
  results?: { chatId: string; ok: boolean; error?: string }[];
  error?: string;
}> {
  const res = await fetch('/api/telegram/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export interface BaileysSessionInfo {
  ok: boolean;
  accountId?: string;
  connected: boolean;
  status: 'connecting' | 'qr_ready' | 'pairing_ready' | 'open' | 'closed';
  qrBase64?: string | null;
  pairingCode?: string | null;
  phone?: string | null;
  name?: string | null;
  error?: string | null;
}

export async function connectBaileysApi(params: {
  accountId: string;
  mode: 'qr' | 'pairing';
  phoneNumber?: string;
  forceNew?: boolean;
}): Promise<BaileysSessionInfo> {
  const res = await fetch('/api/whatsapp/baileys/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function getBaileysStatusApi(accountId: string): Promise<BaileysSessionInfo> {
  const res = await fetch(`/api/whatsapp/baileys/status/${encodeURIComponent(accountId)}`);
  return res.json();
}

export async function logoutBaileysApi(accountId: string): Promise<{ ok: boolean }> {
  removeLocalBaileysBackup(accountId);
  const res = await fetch('/api/whatsapp/baileys/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  return res.json();
}

export async function listBaileysSessionsApi(): Promise<{
  ok: boolean;
  sessions: {
    accountId: string;
    connected: boolean;
    status: string;
    phone?: string | null;
    name?: string | null;
  }[];
}> {
  const res = await fetch('/api/whatsapp/baileys/sessions');
  return res.json();
}

export async function getWhatsAppQrApi(params: {
  provider: 'baileys' | 'evolution' | 'zapi' | 'webhook';
  accountId?: string;
  baseUrl?: string;
  instanceName?: string;
  apiToken?: string;
  clientToken?: string;
}): Promise<{
  ok: boolean;
  qrBase64?: string | null;
  pairingCode?: string | null;
  connected?: boolean;
  state?: string;
  error?: string;
}> {
  const res = await fetch('/api/whatsapp/qrcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export interface BaileysMemberEvent {
  date: string;
  weekday: number;
  groupJid: string;
  entries: number;
  exits: number;
}

export async function getBaileysLiveStatsApi(): Promise<{
  ok: boolean;
  memberEvents: BaileysMemberEvent[];
  capturedTodayByJid: Record<string, number>;
  cachedGroups?: {
    remoteJid: string;
    name: string;
    membersCount: number;
    accountId?: string;
    isOwner?: boolean;
    isAdmin?: boolean;
    isOwnerOrAdmin?: boolean;
  }[];
}> {
  const res = await fetch('/api/whatsapp/baileys/live-stats', { cache: 'no-store' });
  return res.json();
}

export async function fetchWhatsAppGroupsApi(params: {
  provider: 'baileys' | 'evolution' | 'zapi' | 'webhook';
  accountId?: string;
  baseUrl?: string;
  instanceName?: string;
  apiToken?: string;
  clientToken?: string;
}): Promise<{
  ok: boolean;
  cached?: boolean;
  reconnecting?: boolean;
  accountId?: string;
  phone?: string | null;
  name?: string | null;
  groups?: {
    remoteJid: string;
    name: string;
    membersCount: number;
    capturedToday?: number;
    isOwner?: boolean;
    isAdmin?: boolean;
    isOwnerOrAdmin?: boolean;
  }[];
  error?: string;
}> {
  const res = await fetch('/api/whatsapp/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function sendWhatsAppApi(params: {
  provider: 'baileys' | 'evolution' | 'zapi' | 'webhook';
  accountId?: string;
  baseUrl?: string;
  instanceName?: string;
  apiToken?: string;
  clientToken?: string;
  remoteJids: string[];
  message: string;
  imageUrl?: string;
  enableLinkPreview?: boolean;
  mentionAll?: boolean;
}): Promise<{
  ok: boolean;
  sentCount?: number;
  results?: { jid: string; ok: boolean; error?: string }[];
  error?: string;
}> {
  const res = await fetch('/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export interface MlExtensionStatus {
  ok: boolean;
  synced: boolean;
  extensionKey?: string;
  etiqueta?: string;
  hasSsid: boolean;
  bridgeOnline: boolean;
  cookiesCount: number;
  mlUserId?: string | null;
  browserName?: string;
  lastSyncAt?: string;
  lastPollAt?: string | null;
}

export async function getMlExtensionStatusApi(extensionKey: string): Promise<MlExtensionStatus> {
  const res = await fetch(
    `/api/mercadolivre/extension/status?key=${encodeURIComponent(extensionKey)}`
  );
  return res.json();
}

export async function disconnectMlExtensionApi(
  extensionKey: string
): Promise<{ ok: boolean }> {
  const res = await fetch('/api/mercadolivre/extension/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extensionKey }),
  });
  return res.json();
}

export function getMlExtensionDownloadUrl(extensionKey: string, etiqueta?: string): string {
  const qs = new URLSearchParams({
    key: extensionKey,
    ...(etiqueta?.trim() ? { etiqueta: etiqueta.trim() } : {}),
  });
  return `/api/mercadolivre/extension.zip?${qs.toString()}`;
}

export async function fetchMlExtensionPackageApi(
  extensionKey: string,
  etiqueta?: string
): Promise<{ ok: boolean; blob?: Blob; filename?: string; serverUrl?: string; error?: string }> {
  const res = await fetch('/api/mercadolivre/extension/package', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      extensionKey,
      etiqueta: etiqueta?.trim() || '',
      clientOrigin: typeof window !== 'undefined' ? window.location.origin : '',
    }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    filename?: string;
    base64?: string;
    serverUrl?: string;
    error?: string;
  };
  if (!json.ok || !json.base64) {
    return { ok: false, error: json.error || 'Falha ao gerar o arquivo .zip.' };
  }
  const bin = atob(json.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return { ok: false, error: 'Pacote .zip inválido retornado pelo servidor.' };
  }
  return {
    ok: true,
    blob: new Blob([bytes], { type: 'application/zip' }),
    filename: json.filename || 'extensao-mercadolivre-afiliados.zip',
    serverUrl: json.serverUrl,
  };
}

export interface PanelStateResponse {
  ok: boolean;
  hasServerState?: boolean;
  unchanged?: boolean;
  version: number;
  updatedAt?: string;
  state?: Record<string, any> | null;
  error?: string;
}

export async function getPanelStateApi(sinceVersion?: number): Promise<PanelStateResponse> {
  const qs = sinceVersion && sinceVersion > 0 ? `?since=${encodeURIComponent(String(sinceVersion))}` : '';
  const res = await fetch(`/api/panel/state${qs}`, { cache: 'no-store' });
  return res.json();
}

export async function savePanelStateApi(params: {
  clientVersion: number;
  migrateOnly?: boolean;
  forceReset?: boolean;
  state: Record<string, any>;
}): Promise<PanelStateResponse> {
  const res = await fetch('/api/panel/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

const SESSION_BACKUPS_STORAGE_KEY = 'buboflow_wa_backups_v1';

export interface StoredSessionBackups {
  baileys: Record<string, { bundle: string; savedAt: number; phone?: string | null; name?: string | null }>;
  mlSessions: Record<string, any>;
}

export function loadLocalSessionBackups(): StoredSessionBackups {
  try {
    const raw = localStorage.getItem(SESSION_BACKUPS_STORAGE_KEY);
    if (!raw) return { baileys: {}, mlSessions: {} };
    const parsed = JSON.parse(raw);
    return {
      baileys: parsed?.baileys && typeof parsed.baileys === 'object' ? parsed.baileys : {},
      mlSessions: parsed?.mlSessions && typeof parsed.mlSessions === 'object' ? parsed.mlSessions : {},
    };
  } catch {
    return { baileys: {}, mlSessions: {} };
  }
}

export function saveLocalSessionBackups(data: StoredSessionBackups): void {
  try {
    localStorage.setItem(SESSION_BACKUPS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors
  }
}

export function removeLocalBaileysBackup(accountId: string): void {
  try {
    const safeId = String(accountId || 'acc-wa-1').replace(/[^a-zA-Z0-9_-]/g, '_');
    const cur = loadLocalSessionBackups();
    if (cur.baileys[safeId] || cur.baileys[accountId]) {
      delete cur.baileys[safeId];
      delete cur.baileys[accountId];
      saveLocalSessionBackups(cur);
    }
  } catch {
    // Ignore errors
  }
}

export function clearAllLocalSessionBackups(): void {
  try {
    localStorage.removeItem(SESSION_BACKUPS_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export async function getSessionBackupsApi(): Promise<{ ok: boolean } & StoredSessionBackups> {
  const res = await fetch('/api/sessions/backups', { cache: 'no-store' });
  return res.json();
}

export async function restoreSessionBackupsApi(payload: StoredSessionBackups): Promise<{
  ok: boolean;
  restoredAccounts?: string[];
  restoredMlKeys?: string[];
}> {
  const res = await fetch('/api/sessions/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function runAutoDispatchNowApi(): Promise<{
  ok: boolean;
  sentProductsCount: number;
  sentGroupsCount: number;
  titles: string[];
  error?: string;
}> {
  const res = await fetch('/api/auto-dispatch/run-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
}
