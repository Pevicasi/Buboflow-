import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AutoDispatchConfig,
  ChannelAccount,
  ConvertedLinkItem,
  Coupon,
  DispatchGroup,
  DispatchQueue,
  Marketplace,
  MessageTemplate,
  MonitoringGroup,
  MonitoringRulesConfig,
  NavRoute,
  PlatformIntegrations,
  Product,
  SavedGroupPreference,
  ScheduledItem,
  SentLog,
  SiteCaptureConfig,
  ToastMessage,
  UserProfile,
} from '../types';
import {
  INITIAL_ACCOUNTS,
  INITIAL_AUTO_DISPATCH,
  INITIAL_COUPONS,
  INITIAL_DISPATCH_GROUPS,
  INITIAL_INTEGRATIONS,
  INITIAL_MONITORING_GROUPS,
  INITIAL_MONITORING_RULES,
  INITIAL_PRODUCTS,
  INITIAL_PROFILE,
  INITIAL_QUEUES,
  INITIAL_SCHEDULES,
  INITIAL_SEGMENTS,
  INITIAL_SENT_LOGS,
  INITIAL_SITE_CAPTURE,
  INITIAL_TEMPLATES,
} from '../data/initialData';
import { renderProductMessage } from '../utils/templateEngine';
import {
  clearAllLocalSessionBackups,
  fetchWhatsAppGroupsApi,
  getPanelStateApi,
  getSessionBackupsApi,
  listBaileysSessionsApi,
  loadLocalSessionBackups,
  restoreSessionBackupsApi,
  saveLocalSessionBackups,
  savePanelStateApi,
} from '../utils/apiClient';
import { renderArtworkFallbackDataUrl } from '../utils/artworkToImage';

const STORAGE_KEY = 'buboflow_panel_state_v1';
const SERVER_MIGRATED_KEY = 'buboflow_server_synced_v6';

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

const LEGACY_SCREENSHOT_GROUP_IDS = new Set(['grp-1', 'grp-2', 'grp-3', 'grp-4']);
const LEGACY_SCREENSHOT_MON_IDS = new Set([
  'mon-1',
  'mon-2',
  'mon-3',
  'mon-4',
  'mon-5',
  'mon-6',
  'mon-7',
  'mon-8',
]);
const LEGACY_SCREENSHOT_LOG_IDS = new Set(['sent-1', 'sent-2']);
const LEGACY_SCREENSHOT_GROUP_NAMES = new Set([
  'DIVULGA TUDO OFERTAS #2',
  'DIVULGA TUDO OFERTAS #1',
  'Divulga Tudo Ofertas',
  'Achados & Ofertas',
  'Radar Relâmpago Shopee',
  'Ofertas Tech & Casa ML',
  'Cupons Secretos Brasil',
  'Garimpo Moda & Fitness',
  'Alertas Amazon Prime',
  'Importados AliExpress VIP',
]);

export function normalizeGroupJid(jid?: string): string {
  if (!jid) return '';
  const trimmed = jid.trim();
  if (!trimmed) return '';
  const atIdx = trimmed.indexOf('@');
  if (atIdx < 0) return trimmed;
  const userPart = trimmed.slice(0, atIdx).split(':')[0];
  const domainPart = trimmed.slice(atIdx + 1).toLowerCase();
  return `${userPart}@${domainPart}`;
}

function canonicalGroupKey(channel: 'WhatsApp' | 'Telegram', remoteJid?: string): string {
  if (!remoteJid?.trim()) return '';
  if (channel === 'WhatsApp') {
    const norm = normalizeGroupJid(remoteJid);
    return norm ? `wa:${norm}` : '';
  }
  return `tg:${remoteJid.trim()}`;
}

function dedupeDispatchGroups(list: DispatchGroup[]): DispatchGroup[] {
  const byKey = new Map<string, DispatchGroup>();
  for (const g of list) {
    const key = canonicalGroupKey(g.channel, g.remoteJid) || `id:${g.id}`;
    const normJid = g.channel === 'WhatsApp' ? normalizeGroupJid(g.remoteJid) : g.remoteJid?.trim();
    const normalized: DispatchGroup = normJid ? { ...g, remoteJid: normJid } : g;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, normalized);
    } else {
      byKey.set(key, {
        ...existing,
        ...normalized,
        id: normalized.id || existing.id,
        activeForOffers: Boolean(existing.activeForOffers || normalized.activeForOffers),
        isPriorityCapture: Boolean(existing.isPriorityCapture || normalized.isPriorityCapture),
        isChannel: Boolean(existing.isChannel || normalized.isChannel),
        inviteUrl:
          normalized.inviteUrl && normalized.inviteUrl !== 'https://chat.whatsapp.com/'
            ? normalized.inviteUrl
            : existing.inviteUrl,
        membersCount: Math.max(existing.membersCount || 0, normalized.membersCount || 0),
      });
    }
  }
  return Array.from(byKey.values());
}

function dedupeMonitoringGroups(list: MonitoringGroup[]): MonitoringGroup[] {
  const byKey = new Map<string, MonitoringGroup>();
  for (const m of list) {
    const key = canonicalGroupKey(m.channel, m.remoteJid) || `id:${m.id}`;
    const normJid = m.channel === 'WhatsApp' ? normalizeGroupJid(m.remoteJid) : m.remoteJid?.trim();
    const normalized: MonitoringGroup = normJid ? { ...m, remoteJid: normJid } : m;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, normalized);
    } else {
      byKey.set(key, {
        ...existing,
        ...normalized,
        id: normalized.id || existing.id,
        monitored: Boolean(existing.monitored || normalized.monitored),
        capturedToday: Math.max(existing.capturedToday || 0, normalized.capturedToday || 0),
      });
    }
  }
  return Array.from(byKey.values());
}

function resolveAccountWaProvider(acc: ChannelAccount): 'baileys' | 'evolution' | 'zapi' | 'webhook' {
  if (acc.provider === 'zapi' || acc.provider === 'webhook' || acc.provider === 'evolution') {
    return acc.provider;
  }
  if (acc.webhookUrl) return 'webhook';
  if (acc.baseUrl && acc.apiToken) return 'evolution';
  return 'baileys';
}

interface PersistedState {
  cleanRealWhatsAppMigrationV5?: boolean;
  stripFictionalProductsV6?: boolean;
  darkMode: boolean;
  segments: string[];
  activeSegment: string;
  totalSentCount: number;
  accounts: ChannelAccount[];
  dispatchGroups: DispatchGroup[];
  monitoringGroups: MonitoringGroup[];
  savedGroupPrefs: Record<string, SavedGroupPreference>;
  products: Product[];
  coupons: Coupon[];
  templates: MessageTemplate[];
  queues: DispatchQueue[];
  schedules: ScheduledItem[];
  sentLogs: SentLog[];
  convertedLinks: ConvertedLinkItem[];
  autoDispatch: AutoDispatchConfig;
  siteCapture: SiteCaptureConfig;
  integrations: PlatformIntegrations;
  monitoringRules: MonitoringRulesConfig;
  profile: UserProfile;
}

const DEFAULT_PERSISTED: PersistedState = {
  cleanRealWhatsAppMigrationV5: true,
  stripFictionalProductsV6: true,
  darkMode: false,
  segments: INITIAL_SEGMENTS,
  activeSegment: 'Geral',
  totalSentCount: 0,
  accounts: INITIAL_ACCOUNTS,
  dispatchGroups: INITIAL_DISPATCH_GROUPS,
  monitoringGroups: INITIAL_MONITORING_GROUPS,
  savedGroupPrefs: {},
  products: INITIAL_PRODUCTS,
  coupons: INITIAL_COUPONS,
  templates: INITIAL_TEMPLATES,
  queues: INITIAL_QUEUES,
  schedules: INITIAL_SCHEDULES,
  sentLogs: INITIAL_SENT_LOGS,
  convertedLinks: [],
  autoDispatch: INITIAL_AUTO_DISPATCH,
  siteCapture: INITIAL_SITE_CAPTURE,
  integrations: INITIAL_INTEGRATIONS,
  monitoringRules: INITIAL_MONITORING_RULES,
  profile: INITIAL_PROFILE,
};

export interface AppContextValue extends PersistedState {
  route: NavRoute;
  setRoute: (route: NavRoute) => void;
  globalSearch: string;
  setGlobalSearch: (q: string) => void;
  toggleDarkMode: () => void;
  setActiveSegment: (seg: string) => void;
  addSegment: (name: string) => void;
  renameSegment: (oldName: string, newName: string) => void;
  deleteSegment: (name: string) => void;
  setAccounts: React.Dispatch<React.SetStateAction<ChannelAccount[]>>;
  setDispatchGroups: React.Dispatch<React.SetStateAction<DispatchGroup[]>>;
  setMonitoringGroups: React.Dispatch<React.SetStateAction<MonitoringGroup[]>>;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setCoupons: React.Dispatch<React.SetStateAction<Coupon[]>>;
  setTemplates: React.Dispatch<React.SetStateAction<MessageTemplate[]>>;
  setQueues: React.Dispatch<React.SetStateAction<DispatchQueue[]>>;
  setSchedules: React.Dispatch<React.SetStateAction<ScheduledItem[]>>;
  setConvertedLinks: React.Dispatch<React.SetStateAction<ConvertedLinkItem[]>>;
  setAutoDispatch: React.Dispatch<React.SetStateAction<AutoDispatchConfig>>;
  setSiteCapture: React.Dispatch<React.SetStateAction<SiteCaptureConfig>>;
  setIntegrations: React.Dispatch<React.SetStateAction<PlatformIntegrations>>;
  setMonitoringRules: React.Dispatch<React.SetStateAction<MonitoringRulesConfig>>;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  syncWhatsAppGroupsFromAccount: (
    targetAccount?: ChannelAccount,
    options?: { silent?: boolean }
  ) => Promise<{ ok: boolean; count: number; error?: string }>;
  dispatchOfferNow: (
    product: Product,
    targetSegments?: string[]
  ) => Promise<{ ok: boolean; sentCount: number; message: string; error?: string }>;
  dispatchCustomMessage: (params: {
    title: string;
    message: string;
    groupsNames: string[];
    groupIds?: string[];
    platform?: Marketplace;
    customImageUrl?: string;
    enableLinkPreview?: boolean;
    mentionAll?: boolean;
  }) => Promise<{ ok: boolean; sentCount: number; message: string; error?: string }>;
  getTemplateForPlatform: (platform: Marketplace) => MessageTemplate;
  toasts: ToastMessage[];
  notify: (title: string, description?: string, variant?: ToastMessage['variant']) => void;
  dismissToast: (id: string) => void;
  exportBackupJson: () => string;
  importBackupJson: (raw: string) => boolean;
  resetAllData: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function sanitizePersistedState(
  parsed: Partial<PersistedState>,
  options?: { preserveLiveConnectionState?: boolean }
): PersistedState {
  const wasMigrated = Boolean(parsed.cleanRealWhatsAppMigrationV5);
  const merged: PersistedState = {
    ...DEFAULT_PERSISTED,
    ...parsed,
    cleanRealWhatsAppMigrationV5: true,
    stripFictionalProductsV6: true,
    savedGroupPrefs: { ...(parsed.savedGroupPrefs || {}) },
    products: (parsed.products || []).filter(
      (p) => p && !FICTIONAL_PRODUCT_IDS.has(String(p.id))
    ),
  };

  // Preserve per-group user settings into savedGroupPrefs before hiding disconnected/legacy entries
  const cleanDispatch = dedupeDispatchGroups(
    (merged.dispatchGroups || []).filter((g) => {
      if (LEGACY_SCREENSHOT_GROUP_IDS.has(g.id)) return false;
      if (g.channel === 'WhatsApp' && !g.remoteJid?.trim()) return false;
      return true;
    })
  );

  const cleanMonitoring = dedupeMonitoringGroups(
    (merged.monitoringGroups || []).filter((m) => {
      if (LEGACY_SCREENSHOT_MON_IDS.has(m.id)) return false;
      if (m.channel === 'WhatsApp' && !m.remoteJid?.trim()) return false;
      return true;
    })
  );

  for (const g of cleanDispatch) {
    const key = canonicalGroupKey(g.channel, g.remoteJid);
    if (!key) continue;
    const prev = merged.savedGroupPrefs[key] || {};
    merged.savedGroupPrefs[key] = {
      ...prev,
      activeForOffers: Boolean(prev.activeForOffers || g.activeForOffers),
      segment: g.segment || prev.segment,
      inviteUrl: g.inviteUrl || prev.inviteUrl,
      isChannel: g.isChannel ?? prev.isChannel,
      isPriorityCapture: Boolean(prev.isPriorityCapture || g.isPriorityCapture),
    };
  }

  for (const m of cleanMonitoring) {
    const key = canonicalGroupKey(m.channel, m.remoteJid);
    if (!key) continue;
    const prev = merged.savedGroupPrefs[key] || {};
    merged.savedGroupPrefs[key] = {
      ...prev,
      monitored: Boolean(prev.monitored || m.monitored),
    };
  }

  // On boot, Baileys accounts start unverified until /api/whatsapp/baileys/sessions confirms live socket
  if (!options?.preserveLiveConnectionState) {
    merged.accounts = (merged.accounts || INITIAL_ACCOUNTS).map((acc) => {
      if (acc.channel === 'WhatsApp' && resolveAccountWaProvider(acc) === 'baileys') {
        return {
          ...acc,
          provider: 'baileys',
          connected: false,
          phoneOrHandle: 'Aguardando conexão',
        };
      }
      return acc;
    });

    // Hide Baileys WhatsApp groups on boot until live connection is confirmed (keeps Telegram & connected Evolution/Z-API)
    const connectedNonBaileysWaIds = new Set(
      merged.accounts
        .filter(
          (a) =>
            a.channel === 'WhatsApp' &&
            a.connected &&
            resolveAccountWaProvider(a) !== 'baileys'
        )
        .map((a) => a.id)
    );

    merged.dispatchGroups = cleanDispatch.filter(
      (g) => g.channel !== 'WhatsApp' || connectedNonBaileysWaIds.has(g.accountId)
    );
    merged.monitoringGroups = cleanMonitoring.filter(
      (m) => m.channel !== 'WhatsApp' || connectedNonBaileysWaIds.has(m.accountId)
    );
  } else {
    merged.accounts = merged.accounts || INITIAL_ACCOUNTS;
    merged.dispatchGroups = cleanDispatch;
    merged.monitoringGroups = cleanMonitoring;
  }

  // Strip screenshot sent logs ('sent-1', 'sent-2', or logs pointing only to fake screenshot groups)
  merged.sentLogs = (merged.sentLogs || []).filter((log) => {
    if (LEGACY_SCREENSHOT_LOG_IDS.has(log.id)) return false;
    if (
      !wasMigrated &&
      Array.isArray(log.groupsNames) &&
      log.groupsNames.length > 0 &&
      log.groupsNames.every((n) => LEGACY_SCREENSHOT_GROUP_NAMES.has(n))
    ) {
      return false;
    }
    return true;
  });

  if (!wasMigrated) {
    merged.queues = (merged.queues || []).filter(
      (q) => !(q.id === 'q-1' && q.name === 'teste' && q.totalCount === 0)
    );
    merged.totalSentCount = merged.sentLogs.reduce(
      (sum, log) => sum + Math.max(1, log.groupsNames?.length || 1),
      0
    );
    if (merged.siteCapture) {
      merged.siteCapture = {
        ...merged.siteCapture,
        slug:
          merged.siteCapture.slug === 'divulga-tudo-ofertas'
            ? 'grupo-vip-ofertas'
            : merged.siteCapture.slug,
        pageTitle:
          merged.siteCapture.pageTitle === 'DIVULGA TUDO OFERTAS VIP'
            ? 'GRUPO VIP DE OFERTAS'
            : merged.siteCapture.pageTitle,
      };
    }
  }

  return merged;
}

function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PERSISTED;
    const parsed = JSON.parse(raw);
    return sanitizePersistedState(parsed);
  } catch {
    return DEFAULT_PERSISTED;
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initial] = useState<PersistedState>(() => loadInitialState());

  const [route, setRoute] = useState<NavRoute>('dashboard');
  const [globalSearch, setGlobalSearch] = useState('');
  const [darkMode, setDarkMode] = useState(initial.darkMode);
  const [segments, setSegments] = useState<string[]>(initial.segments);
  const [activeSegment, setActiveSegment] = useState<string>(initial.activeSegment);
  const [totalSentCount, setTotalSentCount] = useState<number>(initial.totalSentCount);
  const [accounts, setAccounts] = useState<ChannelAccount[]>(initial.accounts);
  const [dispatchGroups, setDispatchGroupsRaw] = useState<DispatchGroup[]>(initial.dispatchGroups);
  const [monitoringGroups, setMonitoringGroupsRaw] = useState<MonitoringGroup[]>(
    initial.monitoringGroups
  );
  const [savedGroupPrefs, setSavedGroupPrefs] = useState<Record<string, SavedGroupPreference>>(
    initial.savedGroupPrefs || {}
  );
  const [products, setProducts] = useState<Product[]>(initial.products);
  const [coupons, setCoupons] = useState<Coupon[]>(initial.coupons);
  const [templates, setTemplates] = useState<MessageTemplate[]>(initial.templates);
  const [queues, setQueues] = useState<DispatchQueue[]>(initial.queues);
  const [schedules, setSchedules] = useState<ScheduledItem[]>(initial.schedules);
  const [sentLogs, setSentLogs] = useState<SentLog[]>(initial.sentLogs);
  const [convertedLinks, setConvertedLinks] = useState<ConvertedLinkItem[]>(initial.convertedLinks);
  const [autoDispatch, setAutoDispatch] = useState<AutoDispatchConfig>(initial.autoDispatch);
  const [siteCapture, setSiteCapture] = useState<SiteCaptureConfig>(initial.siteCapture);
  const [integrations, setIntegrations] = useState<PlatformIntegrations>(initial.integrations);
  const [monitoringRules, setMonitoringRules] = useState<MonitoringRulesConfig>(
    initial.monitoringRules
  );
  const [profile, setProfile] = useState<UserProfile>(initial.profile);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const activeSegmentRef = useRef(activeSegment);
  activeSegmentRef.current = activeSegment;
  const savedGroupPrefsRef = useRef(savedGroupPrefs);
  savedGroupPrefsRef.current = savedGroupPrefs;
  const productsRef = useRef(products);
  productsRef.current = products;
  const waSyncInFlightRef = useRef<Promise<{ ok: boolean; count: number; error?: string }> | null>(
    null
  );
  const serverVersionRef = useRef<number>(0);
  const hasHydratedServerRef = useRef<boolean>(false);
  const applyGenerationRef = useRef<number>(0);
  const consumedApplyGenRef = useRef<number>(0);
  const lastSyncedPayloadRef = useRef<string>('');
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDispatchGroups: React.Dispatch<React.SetStateAction<DispatchGroup[]>> = useCallback(
    (action) => {
      setDispatchGroupsRaw((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        return dedupeDispatchGroups(next);
      });
    },
    []
  );

  const setMonitoringGroups: React.Dispatch<React.SetStateAction<MonitoringGroup[]>> = useCallback(
    (action) => {
      setMonitoringGroupsRaw((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        return dedupeMonitoringGroups(next);
      });
    },
    []
  );

  // Sync changes on visible groups into savedGroupPrefs vault without ever wiping disconnected prefs
  useEffect(() => {
    if (dispatchGroups.length === 0 && monitoringGroups.length === 0) return;
    setSavedGroupPrefs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of dispatchGroups) {
        const key = canonicalGroupKey(g.channel, g.remoteJid);
        if (!key) continue;
        const cur = next[key] || {};
        if (
          cur.activeForOffers !== g.activeForOffers ||
          cur.segment !== g.segment ||
          cur.inviteUrl !== g.inviteUrl ||
          cur.isChannel !== g.isChannel ||
          cur.isPriorityCapture !== g.isPriorityCapture
        ) {
          next[key] = {
            ...cur,
            activeForOffers: g.activeForOffers,
            segment: g.segment,
            inviteUrl: g.inviteUrl,
            isChannel: g.isChannel,
            isPriorityCapture: g.isPriorityCapture,
          };
          changed = true;
        }
      }
      for (const m of monitoringGroups) {
        const key = canonicalGroupKey(m.channel, m.remoteJid);
        if (!key) continue;
        const cur = next[key] || {};
        if (cur.monitored !== m.monitored) {
          next[key] = { ...cur, monitored: m.monitored };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [dispatchGroups, monitoringGroups]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const notify = useCallback(
    (
      title: string,
      description?: string,
      variant: ToastMessage['variant'] = 'success'
    ) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, title, description, variant }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Canonical WhatsApp group reconciler:
   * 1. Checks live connected Baileys sessions + configured Evolution/Z-API accounts.
   * 2. If zero WhatsApp accounts are connected, hides WhatsApp groups immediately while keeping savedGroupPrefs intact.
   * 3. Otherwise collects real @g.us groups across active sessions, strictly deduplicated 1-to-1 by JID,
   *    restoring each group's saved settings (activeForOffers, monitored, segment, inviteUrl).
   */
  const syncWhatsAppGroupsFromAccount = useCallback(
    async (
      targetAccount?: ChannelAccount,
      options: { silent?: boolean } = {}
    ): Promise<{ ok: boolean; count: number; error?: string }> => {
      if (targetAccount && resolveAccountWaProvider(targetAccount) === 'webhook') {
        return {
          ok: false,
          count: 0,
          error: 'Modo Webhook não possui listagem automática de grupos.',
        };
      }

      if (waSyncInFlightRef.current) {
        const inFlightResult = await waSyncInFlightRef.current;
        if (!options.silent) {
          if (inFlightResult.ok) {
            notify(
              `${inFlightResult.count} grupo(s) reais sincronizados!`,
              inFlightResult.count > 0
                ? 'Ative a chave "Enviar Ofertas" nos grupos em que deseja disparar.'
                : 'Sua conta WhatsApp conectada não participa de nenhum grupo no momento.'
            );
          } else if (inFlightResult.error) {
            notify('Não foi possível puxar os grupos', inFlightResult.error, 'info');
          }
        }
        return inFlightResult;
      }

      const run = (async (): Promise<{ ok: boolean; count: number; error?: string }> => {
        try {
          // 1. Authoritative Baileys sessions snapshot from server
          const sessRes = await listBaileysSessionsApi().catch(() => ({
            ok: false,
            sessions: [] as {
              accountId: string;
              connected: boolean;
              status: string;
              phone?: string | null;
              name?: string | null;
            }[],
          }));

          const sessionsList = sessRes.ok && Array.isArray(sessRes.sessions) ? sessRes.sessions : [];
          const sessionMap = new Map(sessionsList.map((s) => [s.accountId, s]));
          const openBaileysSessions = sessionsList.filter((s) => s.connected);

          // Update accounts list accurately when we got a valid sessions response
          if (sessRes.ok) {
            setAccounts((prev): ChannelAccount[] => {
              const updated: ChannelAccount[] = [];
              for (const acc of prev) {
                if (acc.channel !== 'WhatsApp') {
                  updated.push(acc);
                  continue;
                }
                if (resolveAccountWaProvider(acc) !== 'baileys') {
                  updated.push(acc);
                  continue;
                }
                // Drop stale default 'acc-wa-1' placeholder when a real active session exists under another ID
                if (
                  acc.id === 'acc-wa-1' &&
                  !sessionMap.has('acc-wa-1') &&
                  openBaileysSessions.length > 0
                ) {
                  continue;
                }
                const live = sessionMap.get(acc.id);
                updated.push({
                  ...acc,
                  name: live?.name || acc.name,
                  provider: 'baileys',
                  connected: Boolean(live?.connected),
                  phoneOrHandle:
                    live?.phone ||
                    (live?.connected
                      ? acc.phoneOrHandle
                      : live?.status === 'connecting'
                      ? 'Reconectando WhatsApp...'
                      : 'Aguardando conexão'),
                });
              }

              for (const liveSess of openBaileysSessions) {
                if (!updated.some((a) => a.id === liveSess.accountId)) {
                  updated.push({
                    id: liveSess.accountId,
                    name: liveSess.name || liveSess.phone || 'WhatsApp Conectado',
                    channel: 'WhatsApp',
                    phoneOrHandle: liveSess.phone || 'Conectado via Baileys',
                    connected: true,
                    provider: 'baileys',
                  });
                }
              }

              return updated;
            });
          }

          // Collect all active WhatsApp sources to query
          type WaSource = {
            id: string;
            name: string;
            provider: 'baileys' | 'evolution' | 'zapi';
            baseUrl?: string;
            instanceName?: string;
            apiToken?: string;
            clientToken?: string;
          };

          const sourcesMap = new Map<string, WaSource>();

          for (const s of openBaileysSessions) {
            const matchingAcc = accountsRef.current.find((a) => a.id === s.accountId);
            sourcesMap.set(s.accountId, {
              id: s.accountId,
              name: s.name || matchingAcc?.name || s.phone || 'WhatsApp Conectado',
              provider: 'baileys',
            });
          }

          for (const acc of accountsRef.current) {
            if (acc.channel !== 'WhatsApp') continue;
            const prov = resolveAccountWaProvider(acc);
            if (prov === 'evolution' || prov === 'zapi') {
              const hasCreds =
                prov === 'evolution'
                  ? Boolean(acc.baseUrl && acc.instanceName && acc.apiToken)
                  : Boolean(acc.instanceName && acc.apiToken);
              if (acc.connected && hasCreds) {
                sourcesMap.set(acc.id, {
                  id: acc.id,
                  name: acc.name,
                  provider: prov,
                  baseUrl: acc.baseUrl,
                  instanceName: acc.instanceName,
                  apiToken: acc.apiToken,
                  clientToken: acc.clientToken,
                });
              }
            }
          }

          if (targetAccount && targetAccount.channel === 'WhatsApp') {
            const prov = resolveAccountWaProvider(targetAccount);
            if (prov === 'evolution' || prov === 'zapi') {
              sourcesMap.set(targetAccount.id, {
                id: targetAccount.id,
                name: targetAccount.name,
                provider: prov,
                baseUrl: targetAccount.baseUrl,
                instanceName: targetAccount.instanceName,
                apiToken: targetAccount.apiToken,
                clientToken: targetAccount.clientToken,
              });
            }
          }

          const sources = Array.from(sourcesMap.values());

          // If ZERO WhatsApp sessions are connected, hide WhatsApp groups from UI while preserving savedGroupPrefs
          if (sources.length === 0) {
            setDispatchGroups((prev) => prev.filter((g) => g.channel !== 'WhatsApp'));
            setMonitoringGroups((prev) => prev.filter((m) => m.channel !== 'WhatsApp'));
            return {
              ok: false,
              count: 0,
              error: 'Conecte primeiro seu WhatsApp via QR Code ou Número de Telefone para exibir os grupos.',
            };
          }

          const canonicalGroups = new Map<
            string,
            {
              remoteJid: string;
              name: string;
              membersCount: number;
              capturedToday: number;
              accountId: string;
              accountName: string;
            }
          >();

          let anySourceOk = false;
          let lastError: string | undefined;

          for (const src of sources) {
            const res = await fetchWhatsAppGroupsApi({
              provider: src.provider,
              accountId: src.id,
              baseUrl: src.baseUrl,
              instanceName: src.instanceName,
              apiToken: src.apiToken,
              clientToken: src.clientToken,
            });

            if (!res.ok || !Array.isArray(res.groups)) {
              if (res.error) lastError = res.error;
              continue;
            }

            anySourceOk = true;
            const resolvedAccId = res.accountId || src.id;
            const resolvedAccName = res.name || src.name;

            if (res.phone || res.name) {
              setAccounts((prev) =>
                prev.map((a) =>
                  a.id === resolvedAccId
                    ? {
                        ...a,
                        connected: true,
                        name: res.name || a.name,
                        phoneOrHandle: res.phone || a.phoneOrHandle,
                      }
                    : a
                )
              );
            }

            for (const grp of res.groups) {
              const normJid = normalizeGroupJid(grp.remoteJid);
              if (!normJid || !normJid.endsWith('@g.us')) continue;
              const existing = canonicalGroups.get(normJid);
              if (!existing) {
                canonicalGroups.set(normJid, {
                  remoteJid: normJid,
                  name: grp.name,
                  membersCount: grp.membersCount,
                  capturedToday: grp.capturedToday || 0,
                  accountId: resolvedAccId,
                  accountName: resolvedAccName,
                });
              } else {
                // Deduplicate strictly across sessions: 1 unique group entry per @g.us
                canonicalGroups.set(normJid, {
                  ...existing,
                  name: grp.name || existing.name,
                  membersCount: Math.max(existing.membersCount || 0, grp.membersCount || 0),
                  capturedToday: Math.max(existing.capturedToday || 0, grp.capturedToday || 0),
                });
              }
            }
          }

          if (!anySourceOk) {
            return {
              ok: false,
              count: 0,
              error: lastError || 'Não foi possível consultar os grupos da sessão conectada.',
            };
          }

          const prefsSnapshot = savedGroupPrefsRef.current;
          const uniqueLiveList = Array.from(canonicalGroups.values()).sort((a, b) =>
            a.name.localeCompare(b.name, 'pt-BR')
          );

          // Strictly replace all WhatsApp DispatchGroups with canonical deduplicated live groups + restored prefs
          setDispatchGroups((prev) => {
            const nonWhatsApp = prev.filter((g) => g.channel !== 'WhatsApp');
            const prevByJid = new Map<string, DispatchGroup>();
            for (const g of prev) {
              if (g.channel === 'WhatsApp' && g.remoteJid) {
                prevByJid.set(normalizeGroupJid(g.remoteJid), g);
              }
            }

            const syncedWaGroups: DispatchGroup[] = uniqueLiveList.map((grp) => {
              const saved = prefsSnapshot[`wa:${grp.remoteJid}`];
              const prevLive = prevByJid.get(grp.remoteJid);
              return {
                id: `grp-wa-${grp.remoteJid.replace(/[^a-zA-Z0-9]/g, '')}`,
                name: grp.name,
                channel: 'WhatsApp',
                accountId: grp.accountId,
                accountName: grp.accountName,
                remoteJid: grp.remoteJid,
                activeForOffers: saved?.activeForOffers ?? prevLive?.activeForOffers ?? false,
                isPriorityCapture: saved?.isPriorityCapture ?? prevLive?.isPriorityCapture ?? false,
                isChannel: saved?.isChannel ?? prevLive?.isChannel ?? false,
                membersCount: grp.membersCount,
                maxCapacity: 1024,
                inviteUrl: saved?.inviteUrl || prevLive?.inviteUrl || 'https://chat.whatsapp.com/',
                segment: saved?.segment || prevLive?.segment || activeSegmentRef.current || 'Geral',
              };
            });

            return [...nonWhatsApp, ...syncedWaGroups];
          });

          // Strictly replace all WhatsApp MonitoringGroups with canonical deduplicated live groups + restored prefs
          setMonitoringGroups((prev) => {
            const nonWhatsApp = prev.filter((m) => m.channel !== 'WhatsApp');
            const prevByJid = new Map<string, MonitoringGroup>();
            for (const m of prev) {
              if (m.channel === 'WhatsApp' && m.remoteJid) {
                prevByJid.set(normalizeGroupJid(m.remoteJid), m);
              }
            }

            const syncedMonGroups: MonitoringGroup[] = uniqueLiveList.map((grp) => {
              const saved = prefsSnapshot[`wa:${grp.remoteJid}`];
              const prevMon = prevByJid.get(grp.remoteJid);
              return {
                id: `mon-wa-${grp.remoteJid.replace(/[^a-zA-Z0-9]/g, '')}`,
                name: grp.name,
                channel: 'WhatsApp',
                accountId: grp.accountId,
                accountName: grp.accountName,
                remoteJid: grp.remoteJid,
                monitored: saved?.monitored ?? prevMon?.monitored ?? false,
                capturedToday: grp.capturedToday,
              };
            });

            return [...nonWhatsApp, ...syncedMonGroups];
          });

          if (openBaileysSessions.length > 0) {
            void getSessionBackupsApi()
              .then((b) => {
                if (!b.ok) return;
                const prev = loadLocalSessionBackups();
                saveLocalSessionBackups({
                  baileys: { ...prev.baileys, ...(b.baileys || {}) },
                  mlSessions: { ...prev.mlSessions, ...(b.mlSessions || {}) },
                });
              })
              .catch(() => {
                // Ignore transient error
              });
          }

          return { ok: true, count: uniqueLiveList.length };
        } catch (err: any) {
          return { ok: false, count: 0, error: err?.message };
        }
      })();

      waSyncInFlightRef.current = run;
      try {
        const result = await run;
        if (!options.silent) {
          if (result.ok) {
            notify(
              `${result.count} grupo(s) reais sincronizados!`,
              result.count > 0
                ? 'Ative a chave "Enviar Ofertas" nos grupos em que deseja disparar.'
                : 'Sua conta WhatsApp conectada não participa de nenhum grupo no momento.'
            );
          } else if (result.error) {
            notify('Não foi possível puxar os grupos', result.error, 'info');
          }
        }
        return result;
      } finally {
        if (waSyncInFlightRef.current === run) {
          waSyncInFlightRef.current = null;
        }
      }
    },
    [notify, setDispatchGroups, setMonitoringGroups]
  );

  // Background check on boot & every 30s: auto-restore wiped container sessions + sync WhatsApp groups
  useEffect(() => {
    let cancelled = false;

    const persistLatestServerBackups = async () => {
      try {
        const b = await getSessionBackupsApi();
        if (!cancelled && b.ok) {
          const prev = loadLocalSessionBackups();
          const hasAnyServer =
            Object.keys(b.baileys || {}).length > 0 ||
            Object.keys(b.mlSessions || {}).length > 0;
          if (hasAnyServer) {
            saveLocalSessionBackups({
              baileys: { ...prev.baileys, ...(b.baileys || {}) },
              mlSessions: { ...prev.mlSessions, ...(b.mlSessions || {}) },
            });
          }
        }
      } catch {
        // Ignore transient backup fetch error
      }
    };

    const runCheck = async (isBoot = false) => {
      if (cancelled) return;

      if (isBoot) {
        try {
          const localBackups = loadLocalSessionBackups();
          if (
            Object.keys(localBackups.baileys).length > 0 ||
            Object.keys(localBackups.mlSessions).length > 0
          ) {
            const rest = await restoreSessionBackupsApi(localBackups);
            if (!cancelled && (rest.restoredAccounts?.length || 0) > 0) {
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        } catch {
          // Ignore restore error
        }
      }

      if (cancelled) return;
      await syncWhatsAppGroupsFromAccount(undefined, { silent: true });

      // Poll rapidly while Baileys is still finishing WebSocket handshake ('connecting')
      for (let attempt = 0; attempt < 6; attempt++) {
        if (cancelled) break;
        try {
          const res = await listBaileysSessionsApi();
          if (cancelled || !res.ok) break;
          const stillConnecting = res.sessions?.some((s) => s.status === 'connecting');
          if (!stillConnecting) break;
          await new Promise((r) => setTimeout(r, 2000));
          if (!cancelled) {
            await syncWhatsAppGroupsFromAccount(undefined, { silent: true });
          }
        } catch {
          break;
        }
      }

      await persistLatestServerBackups();
    };

    void runCheck(true);
    const intervalId = setInterval(() => {
      void runCheck(false);
    }, 25000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [syncWhatsAppGroupsFromAccount]);

  const applyServerSnapshot = useCallback(
    (rawServerState: Record<string, any>, version: number, notifyNewCaptured = false) => {
      const cleaned = sanitizePersistedState(rawServerState as Partial<PersistedState>, {
        preserveLiveConnectionState: true,
      });

      if (notifyNewCaptured) {
        const currentIds = new Set(productsRef.current.map((p) => p.id));
        const newCaptured = cleaned.products.filter(
          (p) => !currentIds.has(p.id) && p.id.startsWith('prod-mon-')
        );
        if (newCaptured.length > 0) {
          notify(
            'Oferta capturada no monitoramento!',
            newCaptured[0].title.slice(0, 72)
          );
        }
      }

      serverVersionRef.current = version;
      applyGenerationRef.current += 1;

      setSegments(cleaned.segments);
      setActiveSegment(cleaned.activeSegment);
      setTotalSentCount(cleaned.totalSentCount);
      setSavedGroupPrefs(cleaned.savedGroupPrefs || {});
      setProducts(cleaned.products);
      setCoupons(cleaned.coupons);
      setTemplates(cleaned.templates);
      setQueues(cleaned.queues);
      setSchedules(cleaned.schedules);
      setSentLogs(cleaned.sentLogs);
      setConvertedLinks(cleaned.convertedLinks);
      setAutoDispatch(cleaned.autoDispatch);
      setSiteCapture(cleaned.siteCapture);
      setIntegrations(cleaned.integrations);
      setMonitoringRules(cleaned.monitoringRules);
      setProfile(cleaned.profile);

      // Update non-Baileys accounts from server while keeping live Baileys socket status intact
      setAccounts((prev) => {
        const liveBaileysMap = new Map(
          prev
            .filter((a) => a.channel === 'WhatsApp' && resolveAccountWaProvider(a) === 'baileys')
            .map((a) => [a.id, a])
        );
        const nextAccounts = (cleaned.accounts || []).map((acc) => {
          if (acc.channel === 'WhatsApp' && resolveAccountWaProvider(acc) === 'baileys') {
            const live = liveBaileysMap.get(acc.id);
            return live ? { ...acc, connected: live.connected, phoneOrHandle: live.phoneOrHandle, name: live.name } : acc;
          }
          return acc;
        });
        for (const [id, live] of liveBaileysMap.entries()) {
          if (live.connected && !nextAccounts.some((a) => a.id === id)) {
            nextAccounts.push(live);
          }
        }
        return nextAccounts;
      });

      // Merge dispatchGroups prefs onto currently visible live groups
      setDispatchGroups((prev) => {
        const serverPrefs = cleaned.savedGroupPrefs || {};
        const serverWaByJid = new Map(
          (cleaned.dispatchGroups || [])
            .filter((g) => g.channel === 'WhatsApp' && g.remoteJid)
            .map((g) => [normalizeGroupJid(g.remoteJid), g])
        );
        const liveWa = prev
          .filter((g) => g.channel === 'WhatsApp')
          .map((g) => {
            const norm = normalizeGroupJid(g.remoteJid);
            const pref = serverPrefs[`wa:${norm}`];
            const srv = serverWaByJid.get(norm);
            return {
              ...g,
              activeForOffers: pref?.activeForOffers ?? srv?.activeForOffers ?? g.activeForOffers,
              isPriorityCapture: pref?.isPriorityCapture ?? srv?.isPriorityCapture ?? g.isPriorityCapture,
              isChannel: pref?.isChannel ?? srv?.isChannel ?? g.isChannel,
              segment: pref?.segment || srv?.segment || g.segment,
              inviteUrl: pref?.inviteUrl || srv?.inviteUrl || g.inviteUrl,
            };
          });
        const nonWaFromServer = (cleaned.dispatchGroups || []).filter((g) => g.channel !== 'WhatsApp');
        return [...nonWaFromServer, ...liveWa];
      });

      // Merge monitoringGroups flags & capturedToday onto currently visible live groups
      setMonitoringGroups((prev) => {
        const serverPrefs = cleaned.savedGroupPrefs || {};
        const serverMonByJid = new Map(
          (cleaned.monitoringGroups || [])
            .filter((m) => m.channel === 'WhatsApp' && m.remoteJid)
            .map((m) => [normalizeGroupJid(m.remoteJid), m])
        );
        const liveWa = prev
          .filter((m) => m.channel === 'WhatsApp')
          .map((m) => {
            const norm = normalizeGroupJid(m.remoteJid);
            const pref = serverPrefs[`wa:${norm}`];
            const srv = serverMonByJid.get(norm);
            return {
              ...m,
              monitored: pref?.monitored ?? srv?.monitored ?? m.monitored,
              capturedToday: Math.max(m.capturedToday || 0, srv?.capturedToday || 0),
            };
          });
        const nonWaFromServer = (cleaned.monitoringGroups || []).filter(
          (m) => m.channel !== 'WhatsApp'
        );
        return [...nonWaFromServer, ...liveWa];
      });
    },
    [notify, setDispatchGroups, setMonitoringGroups]
  );

  // Initial server hydration + one-time safe browser migration + 4s polling across browsers (Chrome <-> Lemur)
  useEffect(() => {
    let cancelled = false;

    const initialBootstrap = async () => {
      try {
        const needsOneTimeMigration = !localStorage.getItem(SERVER_MIGRATED_KEY);
        const initialRes = await getPanelStateApi();
        if (cancelled) return;

        if (needsOneTimeMigration) {
          const migRes = await savePanelStateApi({
            clientVersion: initialRes.version || 0,
            migrateOnly: true,
            state: initial as unknown as Record<string, any>,
          });
          if (cancelled) return;
          localStorage.setItem(SERVER_MIGRATED_KEY, '1');
          if (migRes.ok && migRes.state) {
            applyServerSnapshot(migRes.state, migRes.version, false);
          } else if (initialRes.ok && initialRes.hasServerState && initialRes.state) {
            applyServerSnapshot(initialRes.state, initialRes.version, false);
          }
        } else if (initialRes.ok && initialRes.hasServerState && initialRes.state) {
          applyServerSnapshot(initialRes.state, initialRes.version, false);
        } else {
          const seedRes = await savePanelStateApi({
            clientVersion: 0,
            state: initial as unknown as Record<string, any>,
          });
          if (!cancelled && seedRes.ok && seedRes.state) {
            applyServerSnapshot(seedRes.state, seedRes.version, false);
          }
        }
      } catch {
        // Fallback silently to local state if server temporarily unavailable
      } finally {
        if (!cancelled) {
          hasHydratedServerRef.current = true;
        }
      }
    };

    const pollServerState = async () => {
      if (cancelled || !hasHydratedServerRef.current) return;
      try {
        const res = await getPanelStateApi(serverVersionRef.current);
        if (
          !cancelled &&
          res.ok &&
          !res.unchanged &&
          res.hasServerState &&
          res.state &&
          res.version > serverVersionRef.current
        ) {
          applyServerSnapshot(res.state, res.version, true);
        }
      } catch {
        // Ignore transient polling failures
      }
    };

    void initialBootstrap();
    const pollInterval = setInterval(() => {
      void pollServerState();
    }, 4000);

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void pollServerState();
      }
    };
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, [applyServerSnapshot, initial]);

  useEffect(() => {
    const snapshot: PersistedState = {
      cleanRealWhatsAppMigrationV5: true,
      stripFictionalProductsV6: true,
      darkMode,
      segments,
      activeSegment,
      totalSentCount,
      accounts,
      dispatchGroups,
      monitoringGroups,
      savedGroupPrefs,
      products,
      coupons,
      templates,
      queues,
      schedules,
      sentLogs,
      convertedLinks,
      autoDispatch,
      siteCapture,
      integrations,
      monitoringRules,
      profile,
    };
    const serialized = JSON.stringify(snapshot);
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Ignore quota errors
    }

    if (!hasHydratedServerRef.current) {
      return;
    }

    if (applyGenerationRef.current !== consumedApplyGenRef.current) {
      consumedApplyGenRef.current = applyGenerationRef.current;
      lastSyncedPayloadRef.current = serialized;
      return;
    }

    if (serialized === lastSyncedPayloadRef.current) {
      return;
    }

    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }

    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      void savePanelStateApi({
        clientVersion: serverVersionRef.current,
        state: snapshot as unknown as Record<string, any>,
      })
        .then((res) => {
          if (res.ok && res.version) {
            serverVersionRef.current = res.version;
            lastSyncedPayloadRef.current = serialized;
          }
        })
        .catch(() => {
          // Ignore transient network error; next edit or poll will recover
        });
    }, 350);
  }, [
    darkMode,
    segments,
    activeSegment,
    totalSentCount,
    accounts,
    dispatchGroups,
    monitoringGroups,
    savedGroupPrefs,
    products,
    coupons,
    templates,
    queues,
    schedules,
    sentLogs,
    convertedLinks,
    autoDispatch,
    siteCapture,
    integrations,
    monitoringRules,
    profile,
  ]);

  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  const addSegment = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || segments.includes(trimmed)) return;
    setSegments((prev) => [...prev, trimmed]);
    notify('Segmento criado', `O segmento "${trimmed}" foi adicionado.`);
  };

  const renameSegment = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || segments.includes(trimmed)) return;
    setSegments((prev) => prev.map((s) => (s === oldName ? trimmed : s)));
    if (activeSegment === oldName) setActiveSegment(trimmed);
    notify('Segmento atualizado', `Renomeado para "${trimmed}".`);
  };

  const deleteSegment = (name: string) => {
    if (name === 'Geral') {
      notify('Ação bloqueada', 'O segmento padrão "Geral" não pode ser removido.', 'error');
      return;
    }
    setSegments((prev) => prev.filter((s) => s !== name));
    if (activeSegment === name) setActiveSegment('Geral');
    notify('Segmento removido', `O segmento "${name}" foi excluído.`, 'info');
  };

  const getTemplateForPlatform = (platform: Marketplace): MessageTemplate => {
    return (
      templates.find((t) => t.platform === platform) ||
      templates[0] ||
      INITIAL_TEMPLATES[0]
    );
  };

  const sendToConnectedApis = async (params: {
    targetGroups: DispatchGroup[];
    message: string;
    imageUrl?: string;
    enableLinkPreview?: boolean;
    mentionAll?: boolean;
  }): Promise<{ ok: boolean; sentCount: number; error?: string }> => {
    const {
      targetGroups,
      message,
      imageUrl = '',
      enableLinkPreview = true,
      mentionAll = false,
    } = params;

    let waDelivered = 0;
    let tgDelivered = 0;
    const apiErrors: string[] = [];
    const currentAccounts = accountsRef.current;

    // 1. Group WhatsApp targets by accountId
    const waGroupsWithJid = targetGroups.filter(
      (g) => g.channel === 'WhatsApp' && g.remoteJid?.trim()
    );
    const waByAccount = new Map<string, string[]>();
    for (const g of waGroupsWithJid) {
      const list = waByAccount.get(g.accountId) || [];
      list.push(g.remoteJid!.trim());
      waByAccount.set(g.accountId, list);
    }

    for (const [accId, jids] of waByAccount.entries()) {
      const acc =
        currentAccounts.find((a) => a.id === accId && a.connected) ||
        currentAccounts.find((a) => a.channel === 'WhatsApp' && a.connected) ||
        currentAccounts.find((a) => a.id === accId) ||
        currentAccounts.find((a) => a.channel === 'WhatsApp');

      const provider = acc ? resolveAccountWaProvider(acc) : 'baileys';
      const baseUrl = acc?.baseUrl || acc?.webhookUrl || '';
      const hasConfig =
        provider === 'baileys'
          ? true
          : provider === 'zapi'
          ? Boolean(acc?.instanceName && acc?.apiToken)
          : provider === 'webhook'
          ? Boolean(baseUrl)
          : Boolean(baseUrl && acc?.instanceName && acc?.apiToken);

      if (!hasConfig) continue;

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            accountId: acc?.id || accId || 'acc-wa-1',
            baseUrl,
            instanceName: acc?.instanceName || '',
            apiToken: acc?.apiToken || '',
            clientToken: acc?.clientToken || '',
            remoteJids: jids,
            message,
            imageUrl,
            enableLinkPreview,
            mentionAll,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          waDelivered += Number(data.sentCount || 0);
        } else if (data.error) {
          apiErrors.push(data.error);
        } else if (Array.isArray(data.results) && data.results[0]?.error) {
          apiErrors.push(data.results[0].error);
        }
      } catch (err: any) {
        apiErrors.push(err.message || 'Falha de conexão com Baileys');
      }
    }

    // 2. Group Telegram targets by accountId (or fallback to first connected Telegram bot)
    const tgGroupsWithId = targetGroups.filter(
      (g) => g.channel === 'Telegram' && g.remoteJid?.trim()
    );
    const tgByAccount = new Map<string, string[]>();
    for (const g of tgGroupsWithId) {
      const list = tgByAccount.get(g.accountId) || [];
      list.push(g.remoteJid!.trim());
      tgByAccount.set(g.accountId, list);
    }

    for (const [accId, chatIds] of tgByAccount.entries()) {
      const acc =
        currentAccounts.find((a) => a.id === accId && a.connected && a.apiToken) ||
        currentAccounts.find((a) => a.channel === 'Telegram' && a.connected && a.apiToken);
      if (!acc?.apiToken) continue;

      try {
        const res = await fetch('/api/telegram/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            botToken: acc.apiToken,
            chatIds,
            message,
            imageUrl,
            enableLinkPreview,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          tgDelivered += Number(data.sentCount || 0);
        } else {
          const detail = data.results?.[0]?.error || data.error || 'Falha no envio';
          apiErrors.push(`Telegram (${acc.name}): ${detail}`);
        }
      } catch (err: any) {
        apiErrors.push(`Telegram (${acc.name}): ${err.message}`);
      }
    }

    const totalDelivered = waDelivered + tgDelivered;

    if (totalDelivered > 0) {
      const parts: string[] = [];
      if (waDelivered > 0) parts.push(`${waDelivered} grupo(s) WhatsApp (Baileys)`);
      if (tgDelivered > 0) parts.push(`${tgDelivered} canal/grupo(s) Telegram`);
      notify('Enviado automaticamente!', `Entregue em ${parts.join(' e ')}.`);
      return { ok: true, sentCount: totalDelivered };
    }

    const errMsg =
      apiErrors[0] ||
      'Nenhum grupo conectado apto para envio automático. Verifique sua conexão em Canais → WhatsApp.';
    notify('Não foi possível enviar automaticamente', errMsg, 'error');
    return { ok: false, sentCount: 0, error: errMsg };
  };

  const dispatchOfferNow = async (
    product: Product,
    targetSegments: string[] = [activeSegment]
  ): Promise<{ ok: boolean; sentCount: number; message: string; error?: string }> => {
    const tpl = getTemplateForPlatform(product.platform);
    const rendered = renderProductMessage(product, tpl, integrations);
    const activeGroups = dispatchGroups.filter(
      (g) =>
        g.activeForOffers &&
        (targetSegments.includes(g.segment) || targetSegments.includes('Geral'))
    );

    if (activeGroups.length === 0) {
      const errMsg =
        dispatchGroups.length === 0
          ? 'Conecte seu WhatsApp via Baileys em Canais → WhatsApp e ative seus grupos em Grupos de Envio.'
          : 'Vá em Grupos de Envio e ative a chave "Enviar Ofertas" nos grupos em que deseja disparar.';
      notify('Nenhum grupo ativo para envio', errMsg, 'info');
      return { ok: false, sentCount: 0, message: rendered, error: errMsg };
    }

    const resolvedImageUrl =
      product.customImageUrl?.trim() ||
      (await renderArtworkFallbackDataUrl(product.artworkKey));

    const delivery = await sendToConnectedApis({
      targetGroups: activeGroups,
      message: rendered,
      imageUrl: resolvedImageUrl,
      enableLinkPreview: tpl.enableLinkPreview,
    });

    if (!delivery.ok || delivery.sentCount === 0) {
      return { ok: false, sentCount: 0, message: rendered, error: delivery.error };
    }

    const groupNames = activeGroups.map((g) => g.name);
    const now = new Date();
    const nowFormatted = now.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const newLog: SentLog = {
      id: `sent-${Date.now()}`,
      title: product.title,
      message: rendered,
      platform: product.platform,
      groupsNames: groupNames,
      sentAt: nowFormatted,
      sentAtIso: now.toISOString(),
      artworkKey: product.artworkKey,
      customImageUrl: product.customImageUrl,
      affiliateUrl: product.affiliateUrl,
    };

    setSentLogs((prev) => [newLog, ...prev]);
    setTotalSentCount((prev) => prev + delivery.sentCount);

    return { ok: true, sentCount: delivery.sentCount, message: rendered };
  };

  const dispatchCustomMessage = async ({
    title,
    message,
    groupsNames,
    groupIds,
    platform = 'Shopee',
    customImageUrl,
    enableLinkPreview = true,
    mentionAll = false,
  }: {
    title: string;
    message: string;
    groupsNames: string[];
    groupIds?: string[];
    platform?: Marketplace;
    customImageUrl?: string;
    enableLinkPreview?: boolean;
    mentionAll?: boolean;
  }): Promise<{ ok: boolean; sentCount: number; message: string; error?: string }> => {
    const matchedGroups = groupIds?.length
      ? dispatchGroups.filter((g) => groupIds.includes(g.id))
      : groupsNames?.length
      ? dispatchGroups.filter((g) => groupsNames.includes(g.name))
      : dispatchGroups.filter((g) => g.activeForOffers);

    if (matchedGroups.length === 0) {
      const errMsg =
        'Selecione ou ative pelo menos um grupo real conectado ao WhatsApp/Telegram.';
      notify('Nenhum grupo selecionado para envio', errMsg, 'info');
      return { ok: false, sentCount: 0, message, error: errMsg };
    }

    const delivery = await sendToConnectedApis({
      targetGroups: matchedGroups,
      message,
      imageUrl: customImageUrl,
      enableLinkPreview,
      mentionAll,
    });

    if (!delivery.ok || delivery.sentCount === 0) {
      return { ok: false, sentCount: 0, message, error: delivery.error };
    }

    const resolvedNames = matchedGroups.map((g) => g.name);
    const now = new Date();
    const nowFormatted = now.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const newLog: SentLog = {
      id: `sent-${Date.now()}`,
      title,
      message,
      platform,
      groupsNames: resolvedNames,
      sentAt: nowFormatted,
      sentAtIso: now.toISOString(),
      customImageUrl,
    };

    setSentLogs((prev) => [newLog, ...prev]);
    setTotalSentCount((prev) => prev + delivery.sentCount);

    return { ok: true, sentCount: delivery.sentCount, message };
  };

  // Automatic Scheduler Checker (runs every 30s for due ScheduledItems)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setSchedules((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          if (item.status !== 'Pendente') return item;
          const due = new Date(item.scheduledAt);
          if (isNaN(due.getTime()) || due > now) return item;

          const targetGroups =
            item.groupIds.length > 0
              ? dispatchGroups.filter((g) => item.groupIds.includes(g.id))
              : dispatchGroups.filter((g) => g.activeForOffers);

          if (targetGroups.length === 0) {
            return item;
          }

          changed = true;
          dispatchCustomMessage({
            title: item.title,
            message: item.message,
            groupsNames: targetGroups.map((g) => g.name),
            groupIds: targetGroups.map((g) => g.id),
            platform: item.platform,
            customImageUrl: item.imageUrl,
          });

          if (item.recurrence === 'Recorrente') {
            const tomorrow = new Date(due.getTime() + 86400000);
            return {
              ...item,
              scheduledAt: tomorrow.toISOString().slice(0, 16),
            };
          }
          return { ...item, status: 'Enviado' as const };
        });
        return changed ? next : prev;
      });
    }, 30000);
    return () => clearInterval(timer);
  });

  const exportBackupJson = () => {
    const payload: PersistedState = {
      cleanRealWhatsAppMigrationV5: true,
      darkMode,
      segments,
      activeSegment,
      totalSentCount,
      accounts,
      dispatchGroups,
      monitoringGroups,
      savedGroupPrefs,
      products,
      coupons,
      templates,
      queues,
      schedules,
      sentLogs,
      convertedLinks,
      autoDispatch,
      siteCapture,
      integrations,
      monitoringRules,
      profile,
    };
    return JSON.stringify(payload, null, 2);
  };

  const importBackupJson = (raw: string): boolean => {
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (!parsed || typeof parsed !== 'object') return false;
      const cleaned = sanitizePersistedState({ ...parsed, cleanRealWhatsAppMigrationV5: true });
      setSegments(cleaned.segments);
      setActiveSegment(cleaned.activeSegment);
      setTotalSentCount(cleaned.totalSentCount);
      setAccounts(cleaned.accounts);
      setSavedGroupPrefs(cleaned.savedGroupPrefs);
      setDispatchGroups(cleaned.dispatchGroups);
      setMonitoringGroups(cleaned.monitoringGroups);
      setProducts(cleaned.products);
      setCoupons(cleaned.coupons);
      setTemplates(cleaned.templates);
      setQueues(cleaned.queues);
      setSchedules(cleaned.schedules);
      setSentLogs(cleaned.sentLogs);
      setConvertedLinks(cleaned.convertedLinks);
      setAutoDispatch(cleaned.autoDispatch);
      setSiteCapture(cleaned.siteCapture);
      setIntegrations(cleaned.integrations);
      setMonitoringRules(cleaned.monitoringRules);
      setProfile(cleaned.profile);
      notify('Backup restaurado', 'Seus dados locais foram importados com sucesso.');
      return true;
    } catch {
      notify('Erro na importação', 'O arquivo JSON selecionado é inválido.', 'error');
      return false;
    }
  };

  const resetAllData = () => {
    localStorage.removeItem(STORAGE_KEY);
    clearAllLocalSessionBackups();
    localStorage.setItem(SERVER_MIGRATED_KEY, '1');
    setSegments(DEFAULT_PERSISTED.segments);
    setActiveSegment(DEFAULT_PERSISTED.activeSegment);
    setTotalSentCount(0);
    setAccounts(DEFAULT_PERSISTED.accounts);
    setSavedGroupPrefs({});
    setDispatchGroups([]);
    setMonitoringGroups([]);
    setProducts(DEFAULT_PERSISTED.products);
    setCoupons(DEFAULT_PERSISTED.coupons);
    setTemplates(DEFAULT_PERSISTED.templates);
    setQueues([]);
    setSchedules([]);
    setSentLogs([]);
    setConvertedLinks([]);
    setAutoDispatch(DEFAULT_PERSISTED.autoDispatch);
    setSiteCapture(DEFAULT_PERSISTED.siteCapture);
    setIntegrations(DEFAULT_PERSISTED.integrations);
    setMonitoringRules(DEFAULT_PERSISTED.monitoringRules);
    setProfile(DEFAULT_PERSISTED.profile);
    void savePanelStateApi({
      clientVersion: serverVersionRef.current,
      forceReset: true,
      state: DEFAULT_PERSISTED as unknown as Record<string, any>,
    })
      .then((res) => {
        if (res.ok && res.state) {
          applyServerSnapshot(res.state, res.version, false);
        }
      })
      .catch(() => {
        // Ignore error
      });
    notify('Dados limpos', 'O painel foi redefinido e sincronizará apenas grupos reais conectados.', 'info');
  };

  return (
    <AppContext.Provider
      value={{
        cleanRealWhatsAppMigrationV5: true,
        route,
        setRoute,
        globalSearch,
        setGlobalSearch,
        darkMode,
        toggleDarkMode,
        segments,
        activeSegment,
        setActiveSegment,
        addSegment,
        renameSegment,
        deleteSegment,
        totalSentCount,
        accounts,
        setAccounts,
        dispatchGroups,
        setDispatchGroups,
        monitoringGroups,
        setMonitoringGroups,
        savedGroupPrefs,
        products,
        setProducts,
        coupons,
        setCoupons,
        templates,
        setTemplates,
        queues,
        setQueues,
        schedules,
        setSchedules,
        sentLogs,
        convertedLinks,
        setConvertedLinks,
        autoDispatch,
        setAutoDispatch,
        siteCapture,
        setSiteCapture,
        integrations,
        setIntegrations,
        monitoringRules,
        setMonitoringRules,
        profile,
        setProfile,
        syncWhatsAppGroupsFromAccount,
        dispatchOfferNow,
        dispatchCustomMessage,
        getTemplateForPlatform,
        toasts,
        notify,
        dismissToast,
        exportBackupJson,
        importBackupJson,
        resetAllData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return ctx;
}
