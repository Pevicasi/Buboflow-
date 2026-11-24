import { Marketplace, PlatformIntegrations, ReferralEntry } from '../types';
import { PlatformCategory } from './catalogCategories';
import type {
  ResolvedDateRange,
  ShopeeCommissionAnalytics,
  ShopeeCommissionItem,
  ShopeeCommissionSummary,
} from './shopeeCommissions';
import type { ReferralStats } from './referrals';

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
  period?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  maxPages?: number;
}): Promise<{
  ok: boolean;
  conversions?: ShopeeCommissionItem[];
  summary?: ShopeeCommissionSummary;
  analytics?: ShopeeCommissionAnalytics;
  range?: ResolvedDateRange;
  pagesFetched?: number;
  hasMore?: boolean;
  syncedAt?: string;
  error?: string;
}> {
  const res = await fetch('/api/platforms/shopee-commissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function verifyTelegramBotApi(
  botToken: string,
  options?: { knownChatIds?: string[]; targetInputs?: string[] }
): Promise<import('./telegramSync').TelegramSyncResponse> {
  const res = await fetch('/api/telegram/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      botToken,
      knownChatIds: options?.knownChatIds || [],
      targetInputs: options?.targetInputs || [],
    }),
  });
  return res.json();
}

export async function resolveTelegramChatsApi(
  botToken: string,
  targets: string[]
): Promise<import('./telegramSync').TelegramSyncResponse> {
  const res = await fetch('/api/telegram/resolve-chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken, targets }),
  });
  return res.json();
}

export async function cleanupExpiredMlCouponsApi(params?: {
  maxAgeHours?: number;
  segment?: string;
  purgePromobitCoupons?: boolean;
}): Promise<{
  ok: boolean;
  checkedCount: number;
  removedCount: number;
  replacedCount: number;
  keptCount: number;
  version?: number;
  products?: any[];
  coupons?: any[];
  error?: string;
}> {
  const res = await fetch('/api/coupons/mercadolivre/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
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
  includeLinkPreviewDetails?: boolean;
  mentionAll?: boolean;
  allowInactiveAccount?: boolean;
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

export async function runAutoDispatchNowApi(segment?: string): Promise<{
  ok: boolean;
  sentProductsCount: number;
  sentGroupsCount: number;
  titles: string[];
  segment?: string;
  error?: string;
}> {
  const res = await fetch('/api/auto-dispatch/run-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(segment ? { segment } : {}),
  });
  return res.json();
}

export async function executeAutomationCommandApi(params: {
  command: string;
  segment?: string;
  sendToGroup?: boolean;
}): Promise<{
  ok: boolean;
  commandType: string;
  replyText: string;
  previewText?: string;
  previewImageUrl?: string;
  version?: number;
  state?: Record<string, any> | null;
  error?: string;
}> {
  const res = await fetch('/api/automation-group/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function createAutomationGroupApi(params: {
  segment?: string;
  accountId?: string;
}): Promise<{
  ok: boolean;
  group?: {
    id: string;
    name: string;
    remoteJid: string;
    accountId: string;
    accountName: string;
    description: string;
    descriptionApplied: boolean;
    welcomeSent?: boolean;
  };
  version?: number;
  state?: Record<string, any> | null;
  error?: string;
}> {
  const res = await fetch('/api/automation-group/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function sendAutomationGroupWelcomeApi(params: {
  segment?: string;
  groupJid?: string;
  updateDescription?: boolean;
}): Promise<{
  ok: boolean;
  welcomeSent?: boolean;
  descriptionApplied?: boolean;
  error?: string;
}> {
  const res = await fetch('/api/automation-group/welcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function runDispatchQueueNextApi(queueId: string): Promise<{
  ok: boolean;
  sentCount: number;
  productTitle?: string;
  completed?: boolean;
  nextRunAt?: string;
  version?: number;
  state?: Record<string, any> | null;
  error?: string;
}> {
  const res = await fetch('/api/queues/run-next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId }),
  });
  return res.json();
}

export interface ExtractedVideoResponse {
  ok: boolean;
  platformLabel?: string;
  title?: string;
  thumbnailUrl?: string | null;
  cleanUrl?: string;
  directMp4Url?: string | null;
  canDirectDownload?: boolean;
  fileSizeBytes?: number | null;
  note?: string;
  error?: string;
}

export async function extractVideoApi(url: string): Promise<ExtractedVideoResponse> {
  const res = await fetch('/api/videos/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return res.json();
}

export function buildVideoDownloadUrl(
  videoUrl: string,
  filename?: string,
  inline?: boolean
): string {
  const params = new URLSearchParams({ url: videoUrl });
  if (filename?.trim()) params.set('filename', filename.trim());
  if (inline) params.set('inline', '1');
  return `/api/videos/download?${params.toString()}`;
}

export async function addTelegramMonitoringTargetApi(params: {
  target: string;
  customName?: string;
}): Promise<{
  ok: boolean;
  group?: {
    name: string;
    remoteJid: string;
    username?: string;
    subscribers?: number;
    sourceType: 'public_channel' | 'chat_id';
    previewPostsCount?: number;
  };
  error?: string;
}> {
  const res = await fetch('/api/telegram/monitoring/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function checkTelegramMonitoringNowApi(params?: {
  captureRecentCount?: number;
}): Promise<{
  ok: boolean;
  checkedCount?: number;
  newPostsCount?: number;
  version?: number;
  state?: Record<string, any> | null;
  error?: string;
}> {
  const res = await fetch('/api/telegram/monitoring/check-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  return res.json();
}

export interface ReferralSummaryResponse {
  ok: boolean;
  referralCode?: string;
  referralActive?: boolean;
  asaasWalletId?: string;
  asaasConfigured?: boolean;
  asaasEnv?: 'production' | 'sandbox';
  webhookConfigured?: boolean;
  commissionPercent?: number;
  clicks?: number;
  stats?: ReferralStats;
  referrals?: ReferralEntry[];
  splitConfig?: {
    walletId: string | null;
    percentualValue: number;
    asaasSplitPayload: { walletId: string; percentualValue: number }[];
  };
  asaasVerified?: boolean;
  asaasVerificationNote?: string;
  error?: string;
}

export async function getReferralsSummaryApi(): Promise<ReferralSummaryResponse> {
  const res = await fetch('/api/referrals/summary', { cache: 'no-store' });
  return res.json();
}

export async function activateReferralsApi(params: {
  walletId: string;
  referralCode?: string;
  acceptedTerms: boolean;
}): Promise<ReferralSummaryResponse> {
  const res = await fetch('/api/referrals/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function saveReferralRecordApi(params: {
  id?: string;
  name: string;
  email?: string;
  planName?: string;
  planValue: number;
  status: 'Ativo' | 'Pendente' | 'Cancelado';
  totalCommissionPaid?: number;
}): Promise<ReferralSummaryResponse> {
  const res = await fetch('/api/referrals/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function deleteReferralRecordApi(id: string): Promise<ReferralSummaryResponse> {
  const res = await fetch(`/api/referrals/record/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function previewWhatsAppStatusCardApi(params: {
  title: string;
  platform?: string;
  originalPrice?: number;
  discountPrice: number;
  discountPercent?: number;
  couponCode?: string;
  imageUrl?: string;
  themeColor?: string;
  calloutText?: string;
}): Promise<{ ok: boolean; imageDataUrl?: string; error?: string }> {
  const res = await fetch('/api/whatsapp/status/preview-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function sendWhatsAppStatusTestApi(params: {
  accountId: string;
  format: import('./whatsappStatusLab').WhatsAppStatusFormat;
  audienceMode: import('./whatsappStatusLab').WhatsAppStatusAudienceMode;
  testPhones?: string[];
  testGroupJid?: string;
  themeColor?: string;
  fontStyle?: number;
  title: string;
  platform: string;
  originalPrice?: number;
  discountPrice: number;
  discountPercent?: number;
  couponCode?: string;
  affiliateUrl: string;
  imageUrl?: string;
  videoUrl?: string;
}): Promise<{
  ok: boolean;
  format?: string;
  accountId?: string;
  accountName?: string;
  recipientCount?: number;
  recipientPreview?: string[];
  postedSteps?: string[];
  sentAt?: string;
  error?: string;
}> {
  const res = await fetch('/api/whatsapp/status/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

