import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
import { needsAffiliateReconversion } from '../utils/affiliateUrlRules';
import {
  groupWhatsAppTargetsByActiveAccount,
  isWhatsAppAccountActiveForDispatch,
} from '../utils/whatsappAccountDispatch';
import {
  clearAllLocalSessionBackups,
  convertLinkApi,
  fetchWhatsAppGroupsApi,
  getPanelStateApi,
  getSessionBackupsApi,
  listBaileysSessionsApi,
  loadLocalSessionBackups,
  restoreSessionBackupsApi,
  saveLocalSessionBackups,
  savePanelStateApi,
} from '../utils/apiClient';
import {
  DEFAULT_SEGMENT,
  createDefaultAutoDispatchForSegment,
  createDefaultMonitoringRulesForSegment,
  createDefaultSiteCaptureForSegment,
  createDefaultTemplatesForSegment,
  dedupeSegmentNames,
  deleteSegmentFromMap,
  getGroupActiveSegments,
  getGroupMonitoredSegments,
  isGroupActiveInSegment,
  normalizeSegmentName,
  removeSegmentFromList,
  renameSegmentInMap,
  replaceSegmentInList,
  resolveSegmentConfig,
} from '../utils/segmentScoping';
import { getGroupAllMatchKeys, getGroupExclusionKey } from '../utils/telegramSync';
import {
  DEFAULT_ML_COUPON_MAX_AGE_HOURS,
  resolveEffectiveMlCoupon,
} from '../utils/mercadoLivreCoupons';

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
      const mergedActiveSegments = dedupeSegmentNames([
        ...getGroupActiveSegments(existing),
        ...getGroupActiveSegments(normalized),
      ]);
      byKey.set(key, {
        ...existing,
        ...normalized,
        id: normalized.id || existing.id,
        username: normalized.username || existing.username,
        activeForOffers: mergedActiveSegments.length > 0,
        activeSegments: mergedActiveSegments,
        isPriorityCapture: Boolean(existing.isPriorityCapture || normalized.isPriorityCapture),
        isChannel: Boolean(existing.isChannel || normalized.isChannel),
        isOwner: normalized.isOwner ?? existing.isOwner,
        isAdmin: normalized.isAdmin ?? existing.isAdmin,
        canPostMessages: normalized.canPostMessages ?? existing.canPostMessages,
        isOwnerOrAdmin:
          normalized.isOwnerOrAdmin ??
          existing.isOwnerOrAdmin ??
          (normalized.isOwner || normalized.isAdmin || existing.isOwner || existing.isAdmin
            ? true
            : undefined),
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
      const mergedMonSegments = dedupeSegmentNames([
        ...getGroupMonitoredSegments(existing),
        ...getGroupMonitoredSegments(normalized),
      ]);
      byKey.set(key, {
        ...existing,
        ...normalized,
        id: normalized.id || existing.id,
        monitored: mergedMonSegments.length > 0,
        monitoredSegments: mergedMonSegments,
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
  whatsappRotationEnabled?: boolean;
  accounts: ChannelAccount[];
  dispatchGroups: DispatchGroup[];
  monitoringGroups: MonitoringGroup[];
  savedGroupPrefs: Record<string, SavedGroupPreference>;
  excludedDispatchGroupKeys?: string[];
  excludedMonitoringGroupKeys?: string[];
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
  autoDispatchBySegment?: Record<string, AutoDispatchConfig>;
  templatesBySegment?: Record<string, MessageTemplate[]>;
  siteCaptureBySegment?: Record<string, SiteCaptureConfig>;
  monitoringRulesBySegment?: Record<string, MonitoringRulesConfig>;
  profile: UserProfile;
}

const DEFAULT_PERSISTED: PersistedState = {
  cleanRealWhatsAppMigrationV5: true,
  stripFictionalProductsV6: true,
  darkMode: false,
  segments: INITIAL_SEGMENTS,
  activeSegment: DEFAULT_SEGMENT,
  totalSentCount: 0,
  whatsappRotationEnabled: false,
  accounts: INITIAL_ACCOUNTS,
  dispatchGroups: INITIAL_DISPATCH_GROUPS,
  monitoringGroups: INITIAL_MONITORING_GROUPS,
  savedGroupPrefs: {},
  excludedDispatchGroupKeys: [],
  excludedMonitoringGroupKeys: [],
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
  autoDispatchBySegment: { [DEFAULT_SEGMENT]: INITIAL_AUTO_DISPATCH },
  templatesBySegment: { [DEFAULT_SEGMENT]: INITIAL_TEMPLATES },
  siteCaptureBySegment: { [DEFAULT_SEGMENT]: INITIAL_SITE_CAPTURE },
  monitoringRulesBySegment: { [DEFAULT_SEGMENT]: INITIAL_MONITORING_RULES },
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
  whatsappRotationEnabled: boolean;
  setWhatsappRotationEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setAccounts: React.Dispatch<React.SetStateAction<ChannelAccount[]>>;
  setDispatchGroups: React.Dispatch<React.SetStateAction<DispatchGroup[]>>;
  setMonitoringGroups: React.Dispatch<React.SetStateAction<MonitoringGroup[]>>;
  excludedDispatchGroupKeys: string[];
  excludedMonitoringGroupKeys: string[];
  removeDispatchGroup: (group: DispatchGroup) => void;
  removeMonitoringGroup: (group: MonitoringGroup) => void;
  restoreExcludedDispatchGroups: () => Promise<void>;
  restoreExcludedMonitoringGroups: () => Promise<void>;
  unexcludeDispatchGroupKeys: (keys: string[]) => void;
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
    segment?: string;
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
    whatsappRotationEnabled: Boolean(parsed.whatsappRotationEnabled),
    savedGroupPrefs: { ...(parsed.savedGroupPrefs || {}) },
    excludedDispatchGroupKeys: Array.from(
      new Set(
        (parsed.excludedDispatchGroupKeys || [])
          .filter((k): k is string => typeof k === 'string' && Boolean(k.trim()))
      )
    ),
    excludedMonitoringGroupKeys: Array.from(
      new Set(
        (parsed.excludedMonitoringGroupKeys || [])
          .filter((k): k is string => typeof k === 'string' && Boolean(k.trim()))
      )
    ),
    products: (parsed.products || []).filter(
      (p) => p && !FICTIONAL_PRODUCT_IDS.has(String(p.id))
    ),
  };

  const excludedDispatchSet = new Set(merged.excludedDispatchGroupKeys || []);
  const excludedMonitoringSet = new Set(merged.excludedMonitoringGroupKeys || []);

  // Preserve per-group user settings into savedGroupPrefs before hiding disconnected/legacy entries
  const cleanDispatch = dedupeDispatchGroups(
    (merged.dispatchGroups || []).filter((g) => {
      if (LEGACY_SCREENSHOT_GROUP_IDS.has(g.id)) return false;
      if (g.channel === 'WhatsApp' && !g.remoteJid?.trim()) return false;
      if (getGroupAllMatchKeys(g).some((k) => excludedDispatchSet.has(k))) return false;
      return true;
    })
  );

  const cleanMonitoring = dedupeMonitoringGroups(
    (merged.monitoringGroups || []).filter((m) => {
      if (LEGACY_SCREENSHOT_MON_IDS.has(m.id)) return false;
      if (m.channel === 'WhatsApp' && !m.remoteJid?.trim()) return false;
      if (getGroupAllMatchKeys(m).some((k) => excludedMonitoringSet.has(k))) return false;
      return true;
    })
  );

  for (const g of cleanDispatch) {
    const key = canonicalGroupKey(g.channel, g.remoteJid);
    if (!key) continue;
    const prev = merged.savedGroupPrefs[key] || {};
    const resolvedActiveSegs = Array.isArray(g.activeSegments)
      ? dedupeSegmentNames(g.activeSegments)
      : Array.isArray(prev.activeSegments)
      ? dedupeSegmentNames(prev.activeSegments)
      : dedupeSegmentNames([...getGroupActiveSegments(prev), ...getGroupActiveSegments(g)]);
    merged.savedGroupPrefs[key] = {
      ...prev,
      activeForOffers: resolvedActiveSegs.length > 0,
      activeSegments: resolvedActiveSegs,
      segment: g.segment || prev.segment || DEFAULT_SEGMENT,
      inviteUrl: g.inviteUrl || prev.inviteUrl,
      isChannel: g.isChannel ?? prev.isChannel,
      isPriorityCapture: Boolean(prev.isPriorityCapture || g.isPriorityCapture),
      isOwner: g.isOwner ?? prev.isOwner,
      isAdmin: g.isAdmin ?? prev.isAdmin,
      isOwnerOrAdmin: g.isOwnerOrAdmin ?? prev.isOwnerOrAdmin,
    };
  }

  for (const m of cleanMonitoring) {
    const key = canonicalGroupKey(m.channel, m.remoteJid);
    if (!key) continue;
    const prev = merged.savedGroupPrefs[key] || {};
    const resolvedMonSegs = Array.isArray(m.monitoredSegments)
      ? dedupeSegmentNames(m.monitoredSegments)
      : Array.isArray(prev.monitoredSegments)
      ? dedupeSegmentNames(prev.monitoredSegments)
      : dedupeSegmentNames([...getGroupMonitoredSegments(prev), ...getGroupMonitoredSegments(m)]);
    merged.savedGroupPrefs[key] = {
      ...prev,
      monitored: resolvedMonSegs.length > 0,
      monitoredSegments: resolvedMonSegs,
      useGroupImage: m.useGroupImage ?? prev.useGroupImage ?? false,
      allowedMarketplaces: m.allowedMarketplaces ?? prev.allowedMarketplaces,
    };
  }

  // Ensure per-segment configuration maps exist and keep 'Geral' synced with legacy fields
  const geralAuto = parsed.autoDispatchBySegment?.[DEFAULT_SEGMENT] || merged.autoDispatch || INITIAL_AUTO_DISPATCH;
  const geralTemplates = parsed.templatesBySegment?.[DEFAULT_SEGMENT] || merged.templates || INITIAL_TEMPLATES;
  const geralSite = parsed.siteCaptureBySegment?.[DEFAULT_SEGMENT] || merged.siteCapture || INITIAL_SITE_CAPTURE;
  const geralRules = parsed.monitoringRulesBySegment?.[DEFAULT_SEGMENT] || merged.monitoringRules || INITIAL_MONITORING_RULES;

  merged.autoDispatch = geralAuto;
  merged.templates = geralTemplates;
  merged.siteCapture = geralSite;
  merged.monitoringRules = geralRules;
  merged.autoDispatchBySegment = {
    ...(parsed.autoDispatchBySegment || {}),
    [DEFAULT_SEGMENT]: geralAuto,
  };
  merged.templatesBySegment = {
    ...(parsed.templatesBySegment || {}),
    [DEFAULT_SEGMENT]: geralTemplates,
  };
  merged.siteCaptureBySegment = {
    ...(parsed.siteCaptureBySegment || {}),
    [DEFAULT_SEGMENT]: geralSite,
  };
  merged.monitoringRulesBySegment = {
    ...(parsed.monitoringRulesBySegment || {}),
    [DEFAULT_SEGMENT]: geralRules,
  };

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
  const [whatsappRotationEnabled, setWhatsappRotationEnabled] = useState<boolean>(
    Boolean(initial.whatsappRotationEnabled)
  );
  const [accounts, setAccounts] = useState<ChannelAccount[]>(initial.accounts);
  const [dispatchGroups, setDispatchGroupsRaw] = useState<DispatchGroup[]>(initial.dispatchGroups);
  const [monitoringGroups, setMonitoringGroupsRaw] = useState<MonitoringGroup[]>(
    initial.monitoringGroups
  );
  const [savedGroupPrefs, setSavedGroupPrefs] = useState<Record<string, SavedGroupPreference>>(
    initial.savedGroupPrefs || {}
  );
  const [excludedDispatchGroupKeys, setExcludedDispatchGroupKeys] = useState<string[]>(
    initial.excludedDispatchGroupKeys || []
  );
  const [excludedMonitoringGroupKeys, setExcludedMonitoringGroupKeys] = useState<string[]>(
    initial.excludedMonitoringGroupKeys || []
  );
  const [products, setProducts] = useState<Product[]>(initial.products);
  const [coupons, setCoupons] = useState<Coupon[]>(initial.coupons);
  const [templatesBySegment, setTemplatesBySegment] = useState<Record<string, MessageTemplate[]>>(
    () => ({
      ...(initial.templatesBySegment || {}),
      [DEFAULT_SEGMENT]:
        initial.templatesBySegment?.[DEFAULT_SEGMENT] || initial.templates || INITIAL_TEMPLATES,
    })
  );
  const [queues, setQueues] = useState<DispatchQueue[]>(initial.queues);
  const [schedules, setSchedules] = useState<ScheduledItem[]>(initial.schedules);
  const [sentLogs, setSentLogs] = useState<SentLog[]>(initial.sentLogs);
  const [convertedLinks, setConvertedLinks] = useState<ConvertedLinkItem[]>(initial.convertedLinks);
  const [autoDispatchBySegment, setAutoDispatchBySegment] = useState<
    Record<string, AutoDispatchConfig>
  >(() => ({
    ...(initial.autoDispatchBySegment || {}),
    [DEFAULT_SEGMENT]:
      initial.autoDispatchBySegment?.[DEFAULT_SEGMENT] ||
      initial.autoDispatch ||
      INITIAL_AUTO_DISPATCH,
  }));
  const [siteCaptureBySegment, setSiteCaptureBySegment] = useState<
    Record<string, SiteCaptureConfig>
  >(() => ({
    ...(initial.siteCaptureBySegment || {}),
    [DEFAULT_SEGMENT]:
      initial.siteCaptureBySegment?.[DEFAULT_SEGMENT] ||
      initial.siteCapture ||
      INITIAL_SITE_CAPTURE,
  }));
  const [integrations, setIntegrations] = useState<PlatformIntegrations>(initial.integrations);
  const [monitoringRulesBySegment, setMonitoringRulesBySegment] = useState<
    Record<string, MonitoringRulesConfig>
  >(() => ({
    ...(initial.monitoringRulesBySegment || {}),
    [DEFAULT_SEGMENT]:
      initial.monitoringRulesBySegment?.[DEFAULT_SEGMENT] ||
      initial.monitoringRules ||
      INITIAL_MONITORING_RULES,
  }));
  const [profile, setProfile] = useState<UserProfile>(initial.profile);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const templates = useMemo(
    () =>
      resolveSegmentConfig(
        templatesBySegment,
        INITIAL_TEMPLATES,
        activeSegment,
        createDefaultTemplatesForSegment
      ),
    [templatesBySegment, activeSegment]
  );

  const autoDispatch = useMemo(
    () =>
      resolveSegmentConfig(
        autoDispatchBySegment,
        INITIAL_AUTO_DISPATCH,
        activeSegment,
        createDefaultAutoDispatchForSegment
      ),
    [autoDispatchBySegment, activeSegment]
  );

  const siteCapture = useMemo(
    () =>
      resolveSegmentConfig(
        siteCaptureBySegment,
        INITIAL_SITE_CAPTURE,
        activeSegment,
        createDefaultSiteCaptureForSegment
      ),
    [siteCaptureBySegment, activeSegment]
  );

  const monitoringRules = useMemo(
    () =>
      resolveSegmentConfig(
        monitoringRulesBySegment,
        INITIAL_MONITORING_RULES,
        activeSegment,
        createDefaultMonitoringRulesForSegment
      ),
    [monitoringRulesBySegment, activeSegment]
  );

  const setTemplates: React.Dispatch<React.SetStateAction<MessageTemplate[]>> = useCallback(
    (action) => {
      const seg = normalizeSegmentName(activeSegmentRef.current);
      setTemplatesBySegment((prev) => {
        const cur = resolveSegmentConfig(
          prev,
          INITIAL_TEMPLATES,
          seg,
          createDefaultTemplatesForSegment
        );
        const next = typeof action === 'function' ? action(cur) : action;
        return { ...prev, [seg]: next };
      });
    },
    []
  );

  const setAutoDispatch: React.Dispatch<React.SetStateAction<AutoDispatchConfig>> = useCallback(
    (action) => {
      const seg = normalizeSegmentName(activeSegmentRef.current);
      setAutoDispatchBySegment((prev) => {
        const cur = resolveSegmentConfig(
          prev,
          INITIAL_AUTO_DISPATCH,
          seg,
          createDefaultAutoDispatchForSegment
        );
        const next = typeof action === 'function' ? action(cur) : action;
        return { ...prev, [seg]: next };
      });
    },
    []
  );

  const setSiteCapture: React.Dispatch<React.SetStateAction<SiteCaptureConfig>> = useCallback(
    (action) => {
      const seg = normalizeSegmentName(activeSegmentRef.current);
      setSiteCaptureBySegment((prev) => {
        const cur = resolveSegmentConfig(
          prev,
          INITIAL_SITE_CAPTURE,
          seg,
          createDefaultSiteCaptureForSegment
        );
        const next = typeof action === 'function' ? action(cur) : action;
        return { ...prev, [seg]: next };
      });
    },
    []
  );

  const setMonitoringRules: React.Dispatch<React.SetStateAction<MonitoringRulesConfig>> =
    useCallback((action) => {
      const seg = normalizeSegmentName(activeSegmentRef.current);
      setMonitoringRulesBySegment((prev) => {
        const cur = resolveSegmentConfig(
          prev,
          INITIAL_MONITORING_RULES,
          seg,
          createDefaultMonitoringRulesForSegment
        );
        const next = typeof action === 'function' ? action(cur) : action;
        return { ...prev, [seg]: next };
      });
    }, []);

  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const whatsappRotationEnabledRef = useRef(whatsappRotationEnabled);
  whatsappRotationEnabledRef.current = whatsappRotationEnabled;
  const waRotationCursorRef = useRef(0);
  const activeSegmentRef = useRef(activeSegment);
  activeSegmentRef.current = activeSegment;
  const savedGroupPrefsRef = useRef(savedGroupPrefs);
  savedGroupPrefsRef.current = savedGroupPrefs;
  const excludedDispatchKeysRef = useRef(excludedDispatchGroupKeys);
  excludedDispatchKeysRef.current = excludedDispatchGroupKeys;
  const excludedMonitoringKeysRef = useRef(excludedMonitoringGroupKeys);
  excludedMonitoringKeysRef.current = excludedMonitoringGroupKeys;
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
        const nextActiveSegs = getGroupActiveSegments(g);
        const activeSegsChanged =
          JSON.stringify(cur.activeSegments ?? null) !== JSON.stringify(nextActiveSegs);
        if (
          cur.activeForOffers !== g.activeForOffers ||
          activeSegsChanged ||
          cur.segment !== g.segment ||
          cur.inviteUrl !== g.inviteUrl ||
          cur.isChannel !== g.isChannel ||
          cur.isPriorityCapture !== g.isPriorityCapture ||
          cur.isOwner !== g.isOwner ||
          cur.isAdmin !== g.isAdmin ||
          cur.isOwnerOrAdmin !== g.isOwnerOrAdmin
        ) {
          next[key] = {
            ...cur,
            activeForOffers: nextActiveSegs.length > 0,
            activeSegments: nextActiveSegs,
            segment: g.segment,
            inviteUrl: g.inviteUrl,
            isChannel: g.isChannel,
            isPriorityCapture: g.isPriorityCapture,
            isOwner: g.isOwner,
            isAdmin: g.isAdmin,
            isOwnerOrAdmin: g.isOwnerOrAdmin,
          };
          changed = true;
        }
      }
      for (const m of monitoringGroups) {
        const key = canonicalGroupKey(m.channel, m.remoteJid);
        if (!key) continue;
        const cur = next[key] || {};
        const nextMarkets = m.allowedMarketplaces;
        const marketsChanged =
          JSON.stringify(cur.allowedMarketplaces || null) !== JSON.stringify(nextMarkets || null);
        const nextMonSegs = getGroupMonitoredSegments(m);
        const monSegsChanged =
          JSON.stringify(cur.monitoredSegments ?? null) !== JSON.stringify(nextMonSegs);
        if (
          cur.monitored !== m.monitored ||
          monSegsChanged ||
          Boolean(cur.useGroupImage) !== Boolean(m.useGroupImage) ||
          marketsChanged
        ) {
          next[key] = {
            ...cur,
            monitored: nextMonSegs.length > 0,
            monitoredSegments: nextMonSegs,
            useGroupImage: Boolean(m.useGroupImage),
            allowedMarketplaces: nextMarkets,
          };
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
          const activeOrReconnectingBaileys = sessionsList.filter(
            (s) => s.connected || s.status === 'connecting'
          );

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
                  activeOrReconnectingBaileys.length > 0
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

              for (const liveSess of activeOrReconnectingBaileys) {
                if (!updated.some((a) => a.id === liveSess.accountId)) {
                  updated.push({
                    id: liveSess.accountId,
                    name: liveSess.name || liveSess.phone || 'WhatsApp Conectado',
                    channel: 'WhatsApp',
                    phoneOrHandle:
                      liveSess.phone ||
                      (liveSess.connected ? 'Conectado via Baileys' : 'Reconectando WhatsApp...'),
                    connected: Boolean(liveSess.connected),
                    provider: 'baileys',
                  });
                }
              }

              return updated;
            });
          }

          // Collect all active WhatsApp sources to query (including briefly reconnecting Baileys sessions)
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

          for (const s of activeOrReconnectingBaileys) {
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

          // If ZERO WhatsApp sessions exist (neither open nor reconnecting), hide WhatsApp groups while preserving savedGroupPrefs
          if (sources.length === 0) {
            if (sessRes.ok) {
              setDispatchGroups((prev) => prev.filter((g) => g.channel !== 'WhatsApp'));
              setMonitoringGroups((prev) => prev.filter((m) => m.channel !== 'WhatsApp'));
            }
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
              isOwner?: boolean;
              isAdmin?: boolean;
              isOwnerOrAdmin?: boolean;
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
                  isOwner: grp.isOwner,
                  isAdmin: grp.isAdmin,
                  isOwnerOrAdmin: grp.isOwnerOrAdmin,
                });
              } else {
                // Deduplicate strictly across sessions: 1 unique group entry per @g.us
                canonicalGroups.set(normJid, {
                  ...existing,
                  name: grp.name || existing.name,
                  membersCount: Math.max(existing.membersCount || 0, grp.membersCount || 0),
                  capturedToday: Math.max(existing.capturedToday || 0, grp.capturedToday || 0),
                  isOwner: grp.isOwner ?? existing.isOwner,
                  isAdmin: grp.isAdmin ?? existing.isAdmin,
                  isOwnerOrAdmin: grp.isOwnerOrAdmin ?? existing.isOwnerOrAdmin,
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
          const excludedDispatchSet = new Set(excludedDispatchKeysRef.current || []);
          const excludedMonitoringSet = new Set(excludedMonitoringKeysRef.current || []);
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

            const syncedWaGroups: DispatchGroup[] = uniqueLiveList
              .filter((grp) => !excludedDispatchSet.has(`wa:${grp.remoteJid}`))
              .map((grp) => {
                const saved = prefsSnapshot[`wa:${grp.remoteJid}`];
                const prevLive = prevByJid.get(grp.remoteJid);
                const restoredActiveSegs = Array.isArray(saved?.activeSegments)
                  ? dedupeSegmentNames(saved.activeSegments)
                  : Array.isArray(prevLive?.activeSegments)
                  ? dedupeSegmentNames(prevLive.activeSegments)
                  : getGroupActiveSegments(saved ?? prevLive);
                return {
                  id: `grp-wa-${grp.remoteJid.replace(/[^a-zA-Z0-9]/g, '')}`,
                  name: grp.name,
                  channel: 'WhatsApp',
                  accountId: grp.accountId,
                  accountName: grp.accountName,
                  remoteJid: grp.remoteJid,
                  activeForOffers: restoredActiveSegs.length > 0,
                  activeSegments: restoredActiveSegs,
                  isPriorityCapture: saved?.isPriorityCapture ?? prevLive?.isPriorityCapture ?? false,
                  isChannel: saved?.isChannel ?? prevLive?.isChannel ?? false,
                  membersCount: grp.membersCount,
                  maxCapacity: 1024,
                  inviteUrl: saved?.inviteUrl || prevLive?.inviteUrl || 'https://chat.whatsapp.com/',
                  segment: saved?.segment || prevLive?.segment || DEFAULT_SEGMENT,
                  isOwner: grp.isOwner ?? saved?.isOwner ?? prevLive?.isOwner,
                  isAdmin: grp.isAdmin ?? saved?.isAdmin ?? prevLive?.isAdmin,
                  isOwnerOrAdmin:
                    grp.isOwnerOrAdmin ?? saved?.isOwnerOrAdmin ?? prevLive?.isOwnerOrAdmin,
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

            const syncedMonGroups: MonitoringGroup[] = uniqueLiveList
              .filter((grp) => !excludedMonitoringSet.has(`wa:${grp.remoteJid}`))
              .map((grp) => {
                const saved = prefsSnapshot[`wa:${grp.remoteJid}`];
                const prevMon = prevByJid.get(grp.remoteJid);
                const restoredMonSegs = Array.isArray(saved?.monitoredSegments)
                  ? dedupeSegmentNames(saved.monitoredSegments)
                  : Array.isArray(prevMon?.monitoredSegments)
                  ? dedupeSegmentNames(prevMon.monitoredSegments)
                  : getGroupMonitoredSegments(saved ?? prevMon);
                return {
                  id: `mon-wa-${grp.remoteJid.replace(/[^a-zA-Z0-9]/g, '')}`,
                  name: grp.name,
                  channel: 'WhatsApp',
                  accountId: grp.accountId,
                  accountName: grp.accountName,
                  remoteJid: grp.remoteJid,
                  monitored: restoredMonSegs.length > 0,
                  monitoredSegments: restoredMonSegs,
                  useGroupImage: saved?.useGroupImage ?? prevMon?.useGroupImage ?? false,
                  allowedMarketplaces:
                    saved?.allowedMarketplaces ?? prevMon?.allowedMarketplaces,
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
      if (!notifyNewCaptured) {
        setActiveSegment(
          cleaned.segments.includes(cleaned.activeSegment) ? cleaned.activeSegment : DEFAULT_SEGMENT
        );
      } else if (!cleaned.segments.includes(activeSegmentRef.current)) {
        setActiveSegment(DEFAULT_SEGMENT);
      }
      setTotalSentCount(cleaned.totalSentCount);
      setWhatsappRotationEnabled(Boolean(cleaned.whatsappRotationEnabled));
      setSavedGroupPrefs(cleaned.savedGroupPrefs || {});
      setExcludedDispatchGroupKeys(cleaned.excludedDispatchGroupKeys || []);
      setExcludedMonitoringGroupKeys(cleaned.excludedMonitoringGroupKeys || []);
      setProducts(cleaned.products);
      setCoupons(cleaned.coupons);
      setTemplatesBySegment(
        cleaned.templatesBySegment || { [DEFAULT_SEGMENT]: cleaned.templates }
      );
      setQueues(cleaned.queues);
      setSchedules(cleaned.schedules);
      setSentLogs(cleaned.sentLogs);
      setConvertedLinks(cleaned.convertedLinks);
      setAutoDispatchBySegment(
        cleaned.autoDispatchBySegment || { [DEFAULT_SEGMENT]: cleaned.autoDispatch }
      );
      setSiteCaptureBySegment(
        cleaned.siteCaptureBySegment || { [DEFAULT_SEGMENT]: cleaned.siteCapture }
      );
      setIntegrations(cleaned.integrations);
      setMonitoringRulesBySegment(
        cleaned.monitoringRulesBySegment || { [DEFAULT_SEGMENT]: cleaned.monitoringRules }
      );
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

      // Merge dispatchGroups prefs onto currently visible live groups (or hydrate persisted real WA groups on first load)
      setDispatchGroups((prev) => {
        const excludedSet = new Set(cleaned.excludedDispatchGroupKeys || []);
        const serverPrefs = cleaned.savedGroupPrefs || {};
        const serverWaList = (cleaned.dispatchGroups || []).filter(
          (g) =>
            g.channel === 'WhatsApp' &&
            g.remoteJid &&
            !getGroupAllMatchKeys(g).some((k) => excludedSet.has(k))
        );
        const serverWaByJid = new Map(
          serverWaList.map((g) => [normalizeGroupJid(g.remoteJid), g])
        );
        const prevWa = prev.filter(
          (g) =>
            g.channel === 'WhatsApp' &&
            !getGroupAllMatchKeys(g).some((k) => excludedSet.has(k))
        );
        const liveWa =
          prevWa.length > 0
            ? prevWa.map((g) => {
                const norm = normalizeGroupJid(g.remoteJid);
                const pref = serverPrefs[`wa:${norm}`];
                const srv = serverWaByJid.get(norm);
                const resolvedSegs = Array.isArray(pref?.activeSegments)
                  ? dedupeSegmentNames(pref.activeSegments)
                  : Array.isArray(srv?.activeSegments)
                  ? dedupeSegmentNames(srv.activeSegments)
                  : getGroupActiveSegments(pref ?? srv ?? g);
                return {
                  ...g,
                  membersCount: Math.max(g.membersCount || 0, srv?.membersCount || 0),
                  activeForOffers: resolvedSegs.length > 0,
                  activeSegments: resolvedSegs,
                  isPriorityCapture:
                    pref?.isPriorityCapture ?? srv?.isPriorityCapture ?? g.isPriorityCapture,
                  isChannel: pref?.isChannel ?? srv?.isChannel ?? g.isChannel,
                  segment: pref?.segment || srv?.segment || g.segment,
                  inviteUrl: pref?.inviteUrl || srv?.inviteUrl || g.inviteUrl,
                  isOwner: g.isOwner ?? srv?.isOwner ?? pref?.isOwner,
                  isAdmin: g.isAdmin ?? srv?.isAdmin ?? pref?.isAdmin,
                  isOwnerOrAdmin:
                    g.isOwnerOrAdmin ?? srv?.isOwnerOrAdmin ?? pref?.isOwnerOrAdmin,
                };
              })
            : serverWaList;
        const nonWaFromServer = (cleaned.dispatchGroups || []).filter(
          (g) =>
            g.channel !== 'WhatsApp' &&
            !getGroupAllMatchKeys(g).some((k) => excludedSet.has(k))
        );
        return [...nonWaFromServer, ...liveWa];
      });

      // Merge monitoringGroups flags & capturedToday onto currently visible live groups (or hydrate on first load)
      setMonitoringGroups((prev) => {
        const excludedSet = new Set(cleaned.excludedMonitoringGroupKeys || []);
        const serverPrefs = cleaned.savedGroupPrefs || {};
        const serverMonList = (cleaned.monitoringGroups || []).filter(
          (m) =>
            m.channel === 'WhatsApp' &&
            m.remoteJid &&
            !getGroupAllMatchKeys(m).some((k) => excludedSet.has(k))
        );
        const serverMonByJid = new Map(
          serverMonList.map((m) => [normalizeGroupJid(m.remoteJid), m])
        );
        const prevMonWa = prev.filter(
          (m) =>
            m.channel === 'WhatsApp' &&
            !getGroupAllMatchKeys(m).some((k) => excludedSet.has(k))
        );
        const liveWa =
          prevMonWa.length > 0
            ? prevMonWa.map((m) => {
                const norm = normalizeGroupJid(m.remoteJid);
                const pref = serverPrefs[`wa:${norm}`];
                const srv = serverMonByJid.get(norm);
                const resolvedMonSegs = Array.isArray(pref?.monitoredSegments)
                  ? dedupeSegmentNames(pref.monitoredSegments)
                  : Array.isArray(srv?.monitoredSegments)
                  ? dedupeSegmentNames(srv.monitoredSegments)
                  : getGroupMonitoredSegments(pref ?? srv ?? m);
                return {
                  ...m,
                  monitored: resolvedMonSegs.length > 0,
                  monitoredSegments: resolvedMonSegs,
                  useGroupImage:
                    pref?.useGroupImage ?? srv?.useGroupImage ?? m.useGroupImage ?? false,
                  allowedMarketplaces:
                    pref?.allowedMarketplaces ??
                    srv?.allowedMarketplaces ??
                    m.allowedMarketplaces,
                  capturedToday:
                    typeof srv?.capturedToday === 'number'
                      ? srv.capturedToday
                      : m.capturedToday || 0,
                };
              })
            : serverMonList;
        const nonWaFromServer = (cleaned.monitoringGroups || []).filter(
          (m) =>
            m.channel !== 'WhatsApp' &&
            !getGroupAllMatchKeys(m).some((k) => excludedSet.has(k))
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
    const geralTemplates = templatesBySegment[DEFAULT_SEGMENT] || INITIAL_TEMPLATES;
    const geralAutoDispatch = autoDispatchBySegment[DEFAULT_SEGMENT] || INITIAL_AUTO_DISPATCH;
    const geralSiteCapture = siteCaptureBySegment[DEFAULT_SEGMENT] || INITIAL_SITE_CAPTURE;
    const geralMonitoringRules =
      monitoringRulesBySegment[DEFAULT_SEGMENT] || INITIAL_MONITORING_RULES;

    const snapshot: PersistedState = {
      cleanRealWhatsAppMigrationV5: true,
      stripFictionalProductsV6: true,
      darkMode,
      segments,
      activeSegment,
      totalSentCount,
      whatsappRotationEnabled,
      accounts,
      dispatchGroups,
      monitoringGroups,
      savedGroupPrefs,
      excludedDispatchGroupKeys,
      excludedMonitoringGroupKeys,
      products,
      coupons,
      templates: geralTemplates,
      queues,
      schedules,
      sentLogs,
      convertedLinks,
      autoDispatch: geralAutoDispatch,
      siteCapture: geralSiteCapture,
      integrations,
      monitoringRules: geralMonitoringRules,
      autoDispatchBySegment,
      templatesBySegment,
      siteCaptureBySegment,
      monitoringRulesBySegment,
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
    whatsappRotationEnabled,
    accounts,
    dispatchGroups,
    monitoringGroups,
    savedGroupPrefs,
    excludedDispatchGroupKeys,
    excludedMonitoringGroupKeys,
    products,
    coupons,
    templatesBySegment,
    queues,
    schedules,
    sentLogs,
    convertedLinks,
    autoDispatchBySegment,
    siteCaptureBySegment,
    integrations,
    monitoringRulesBySegment,
    profile,
  ]);

  // Publish live panel config to the Mercado Livre browser extension bridge (auto-sync URL & key)
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const key = integrations.mercadoLivre.extensionKey?.trim() || '';
    const tag = integrations.mercadoLivre.etiqueta?.trim() || '';
    document.documentElement.dataset.buboflowPanel = '1';
    document.documentElement.dataset.buboflowMlKey = key;
    document.documentElement.dataset.buboflowMlTag = tag;

    window.postMessage(
      {
        source: 'buboflow-panel',
        type: 'PANEL_CONFIG',
        serverUrl: window.location.origin,
        extensionKey: key,
        etiqueta: tag,
      },
      '*'
    );
  }, [integrations.mercadoLivre.extensionKey, integrations.mercadoLivre.etiqueta]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'buboflow-extension') return;

      if (data.type === 'ML_SYNC_RESULT' && data.ok) {
        if (data.extensionKey && typeof data.extensionKey === 'string') {
          setIntegrations((prev) =>
            prev.mercadoLivre.extensionKey === data.extensionKey
              ? prev
              : {
                  ...prev,
                  mercadoLivre: {
                    ...prev.mercadoLivre,
                    extensionKey: data.extensionKey,
                  },
                }
          );
        }
        window.dispatchEvent(new CustomEvent('buboflow:ml-synced', { detail: data }));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  const addSegment = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || segments.includes(trimmed)) return;
    setSegments((prev) => [...prev, trimmed]);
    setAutoDispatchBySegment((prev) => ({
      ...prev,
      [trimmed]: prev[trimmed] || createDefaultAutoDispatchForSegment(),
    }));
    setTemplatesBySegment((prev) => ({
      ...prev,
      [trimmed]: prev[trimmed] || createDefaultTemplatesForSegment(),
    }));
    setSiteCaptureBySegment((prev) => ({
      ...prev,
      [trimmed]: prev[trimmed] || createDefaultSiteCaptureForSegment(trimmed),
    }));
    setMonitoringRulesBySegment((prev) => ({
      ...prev,
      [trimmed]: prev[trimmed] || createDefaultMonitoringRulesForSegment(),
    }));
    notify(
      'Segmento criado',
      `O segmento "${trimmed}" foi adicionado com produtos, grupos e configurações independentes.`
    );
  };

  const renameSegment = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || segments.includes(trimmed) || oldName === DEFAULT_SEGMENT) return;
    setSegments((prev) => prev.map((s) => (s === oldName ? trimmed : s)));
    if (activeSegment === oldName) setActiveSegment(trimmed);

    setAutoDispatchBySegment((prev) => renameSegmentInMap(prev, oldName, trimmed));
    setTemplatesBySegment((prev) => renameSegmentInMap(prev, oldName, trimmed));
    setSiteCaptureBySegment((prev) => renameSegmentInMap(prev, oldName, trimmed));
    setMonitoringRulesBySegment((prev) => renameSegmentInMap(prev, oldName, trimmed));

    setProducts((prev) =>
      prev.map((p) => (p.segment === oldName ? { ...p, segment: trimmed } : p))
    );
    setQueues((prev) =>
      prev.map((q) => (q.segment === oldName ? { ...q, segment: trimmed } : q))
    );
    setSchedules((prev) =>
      prev.map((s) => (s.segment === oldName ? { ...s, segment: trimmed } : s))
    );
    setCoupons((prev) =>
      prev.map((c) => (c.segment === oldName ? { ...c, segment: trimmed } : c))
    );
    setSentLogs((prev) =>
      prev.map((l) => (l.segment === oldName ? { ...l, segment: trimmed } : l))
    );
    setDispatchGroups((prev) =>
      prev.map((g) => {
        const nextActive = replaceSegmentInList(getGroupActiveSegments(g), oldName, trimmed) || [];
        return {
          ...g,
          segment: g.segment === oldName ? trimmed : g.segment,
          activeSegments: nextActive,
          activeForOffers: nextActive.length > 0,
        };
      })
    );
    setMonitoringGroups((prev) =>
      prev.map((m) => {
        const nextMon = replaceSegmentInList(getGroupMonitoredSegments(m), oldName, trimmed) || [];
        return {
          ...m,
          monitoredSegments: nextMon,
          monitored: nextMon.length > 0,
        };
      })
    );
    setSavedGroupPrefs((prev) => {
      const next: Record<string, SavedGroupPreference> = {};
      for (const [k, pref] of Object.entries(prev)) {
        const nextActive = replaceSegmentInList(pref.activeSegments, oldName, trimmed);
        const nextMon = replaceSegmentInList(pref.monitoredSegments, oldName, trimmed);
        next[k] = {
          ...pref,
          segment: pref.segment === oldName ? trimmed : pref.segment,
          ...(nextActive !== undefined
            ? { activeSegments: nextActive, activeForOffers: nextActive.length > 0 }
            : {}),
          ...(nextMon !== undefined
            ? { monitoredSegments: nextMon, monitored: nextMon.length > 0 }
            : {}),
        };
      }
      return next;
    });
    notify('Segmento atualizado', `Renomeado para "${trimmed}".`);
  };

  const deleteSegment = (name: string) => {
    if (name === DEFAULT_SEGMENT) {
      notify('Ação bloqueada', 'O segmento padrão "Geral" não pode ser removido.', 'error');
      return;
    }
    setSegments((prev) => prev.filter((s) => s !== name));
    if (activeSegment === name) setActiveSegment(DEFAULT_SEGMENT);

    setAutoDispatchBySegment((prev) => deleteSegmentFromMap(prev, name));
    setTemplatesBySegment((prev) => deleteSegmentFromMap(prev, name));
    setSiteCaptureBySegment((prev) => deleteSegmentFromMap(prev, name));
    setMonitoringRulesBySegment((prev) => deleteSegmentFromMap(prev, name));

    setProducts((prev) =>
      prev.map((p) => (p.segment === name ? { ...p, segment: DEFAULT_SEGMENT } : p))
    );
    setQueues((prev) =>
      prev.map((q) => (q.segment === name ? { ...q, segment: DEFAULT_SEGMENT } : q))
    );
    setSchedules((prev) =>
      prev.map((s) => (s.segment === name ? { ...s, segment: DEFAULT_SEGMENT } : s))
    );
    setCoupons((prev) =>
      prev.map((c) => (c.segment === name ? { ...c, segment: DEFAULT_SEGMENT } : c))
    );
    setSentLogs((prev) =>
      prev.map((l) => (l.segment === name ? { ...l, segment: DEFAULT_SEGMENT } : l))
    );
    setDispatchGroups((prev) =>
      prev.map((g) => {
        const nextActive = removeSegmentFromList(getGroupActiveSegments(g), name) || [];
        return {
          ...g,
          segment: g.segment === name ? DEFAULT_SEGMENT : g.segment,
          activeSegments: nextActive,
          activeForOffers: nextActive.length > 0,
        };
      })
    );
    setMonitoringGroups((prev) =>
      prev.map((m) => {
        const nextMon = removeSegmentFromList(getGroupMonitoredSegments(m), name) || [];
        return {
          ...m,
          monitoredSegments: nextMon,
          monitored: nextMon.length > 0,
        };
      })
    );
    setSavedGroupPrefs((prev) => {
      const next: Record<string, SavedGroupPreference> = {};
      for (const [k, pref] of Object.entries(prev)) {
        const nextActive = removeSegmentFromList(pref.activeSegments, name);
        const nextMon = removeSegmentFromList(pref.monitoredSegments, name);
        next[k] = {
          ...pref,
          segment: pref.segment === name ? DEFAULT_SEGMENT : pref.segment,
          ...(nextActive !== undefined
            ? { activeSegments: nextActive, activeForOffers: nextActive.length > 0 }
            : {}),
          ...(nextMon !== undefined
            ? { monitoredSegments: nextMon, monitored: nextMon.length > 0 }
            : {}),
        };
      }
      return next;
    });
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
    includeLinkPreviewDetails?: boolean;
    mentionAll?: boolean;
  }): Promise<{ ok: boolean; sentCount: number; error?: string }> => {
    const {
      targetGroups,
      message,
      imageUrl = '',
      enableLinkPreview = true,
      includeLinkPreviewDetails = false,
      mentionAll = false,
    } = params;

    let waDelivered = 0;
    let tgDelivered = 0;
    const apiErrors: string[] = [];
    const currentAccounts = accountsRef.current;

    // 1. Route WhatsApp targets strictly through accounts enabled for offer dispatch
    const waGroupsWithJid = targetGroups.filter(
      (g) => g.channel === 'WhatsApp' && g.remoteJid?.trim()
    );
    if (waGroupsWithJid.length > 0) {
      const waAccounts = currentAccounts.filter((a) => a.channel === 'WhatsApp');
      const waPlan = groupWhatsAppTargetsByActiveAccount(
        waGroupsWithJid.map((g) => ({
          remoteJid: g.remoteJid!.trim(),
          name: g.name,
          accountId: g.accountId,
        })),
        waAccounts,
        undefined,
        {
          rotateAccounts: whatsappRotationEnabledRef.current,
          rotationCursor: waRotationCursorRef.current,
        }
      );

      if (waPlan.allDisabled) {
        apiErrors.push(
          'Nenhum número de WhatsApp está ativo para envio de ofertas. Ative ao menos um número em Canais → WhatsApp.'
        );
      } else {
        const batchesToSend =
          waPlan.batches.length > 0
            ? waPlan.batches
            : // Fallback when account connected flag hasn't hydrated yet on client: keep active-only check on server
              Array.from(
                waGroupsWithJid.reduce((map, g) => {
                  const list = map.get(g.accountId) || [];
                  list.push(g.remoteJid!.trim());
                  map.set(g.accountId, list);
                  return map;
                }, new Map<string, string[]>())
              ).map(([accountId, remoteJids]) => ({ accountId, remoteJids, targets: [] }));

        for (const batch of batchesToSend) {
          const acc =
            waAccounts.find(
              (a) => a.id === batch.accountId && a.connected && isWhatsAppAccountActiveForDispatch(a)
            ) ||
            waAccounts.find((a) => a.connected && isWhatsAppAccountActiveForDispatch(a)) ||
            waAccounts.find(
              (a) => a.id === batch.accountId && isWhatsAppAccountActiveForDispatch(a)
            ) ||
            waAccounts.find((a) => isWhatsAppAccountActiveForDispatch(a));

          if (waAccounts.length > 0 && !acc) {
            apiErrors.push(
              'Nenhum número de WhatsApp está ativo para envio de ofertas. Ative ao menos um número em Canais → WhatsApp.'
            );
            break;
          }

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
                accountId: acc?.id || batch.accountId || 'acc-wa-1',
                baseUrl,
                instanceName: acc?.instanceName || '',
                apiToken: acc?.apiToken || '',
                clientToken: acc?.clientToken || '',
                remoteJids: batch.remoteJids,
                message,
                imageUrl,
                enableLinkPreview,
                includeLinkPreviewDetails,
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
        if (waDelivered > 0 && whatsappRotationEnabledRef.current) {
          waRotationCursorRef.current = waPlan.nextRotationCursor;
        }
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
    let effectiveProduct = product;
    if (needsAffiliateReconversion(product, integrations.mercadoLivre.etiqueta)) {
      try {
        const conv = await convertLinkApi({
          url: product.originalUrl || product.affiliateUrl,
          credentials: integrations,
        });
        if (
          conv.ok &&
          conv.affiliateUrl &&
          !/mercadolivre\.com\.br\/social\//i.test(conv.affiliateUrl)
        ) {
          effectiveProduct = {
            ...product,
            affiliateUrl: conv.affiliateUrl,
            originalUrl: conv.originalProductUrl || product.originalUrl,
          };
          setProducts((prev) =>
            prev.map((p) => (p.id === product.id ? effectiveProduct : p))
          );
        }
      } catch {
        // Proceed with existing link if offline
      }
    }

    const normalizedTargets = dedupeSegmentNames(
      targetSegments.length > 0 ? targetSegments : [activeSegment]
    );
    const primaryTargetSeg = normalizedTargets[0] || normalizeSegmentName(activeSegment);
    const segAutoDispatch = resolveSegmentConfig(
      autoDispatchBySegment,
      INITIAL_AUTO_DISPATCH,
      primaryTargetSeg,
      createDefaultAutoDispatchForSegment
    );

    if (effectiveProduct.platform === 'Mercado Livre' || effectiveProduct.couponCode) {
      const segCoupons = coupons.filter((c) => {
        const cSeg = normalizeSegmentName(c.segment);
        return cSeg.toLowerCase() === primaryTargetSeg.toLowerCase();
      });
      const maxAgeHours =
        typeof segAutoDispatch.mlCouponMaxAgeHours === 'number'
          ? segAutoDispatch.mlCouponMaxAgeHours
          : DEFAULT_ML_COUPON_MAX_AGE_HOURS;
      const couponResolution = resolveEffectiveMlCoupon({
        product: effectiveProduct,
        savedCoupons: segCoupons,
        maxAgeHours,
        now: new Date(),
      });
      if (couponResolution.changed) {
        effectiveProduct = {
          ...effectiveProduct,
          couponCode: couponResolution.couponCode || undefined,
        };
      }
    }

    const segTemplates = resolveSegmentConfig(
      templatesBySegment,
      INITIAL_TEMPLATES,
      primaryTargetSeg,
      createDefaultTemplatesForSegment
    );
    const tpl =
      segTemplates.find((t) => t.platform === effectiveProduct.platform) ||
      segTemplates[0] ||
      INITIAL_TEMPLATES[0];
    const rendered = renderProductMessage(effectiveProduct, tpl, integrations);
    const activeGroups = dispatchGroups.filter((g) =>
      normalizedTargets.some((seg) => isGroupActiveInSegment(g, seg))
    );

    if (activeGroups.length === 0) {
      const errMsg =
        dispatchGroups.length === 0
          ? 'Conecte seu WhatsApp via Baileys em Canais → WhatsApp e ative seus grupos em Grupos de Envio.'
          : `Vá em Grupos de Envio no segmento "${primaryTargetSeg}" e ative a chave "Enviar Ofertas" nos grupos em que deseja disparar.`;
      notify('Nenhum grupo ativo para envio', errMsg, 'info');
      return { ok: false, sentCount: 0, message: rendered, error: errMsg };
    }

    const resolvedImageUrl = effectiveProduct.customImageUrl?.trim() || undefined;

    const delivery = await sendToConnectedApis({
      targetGroups: activeGroups,
      message: rendered,
      imageUrl: resolvedImageUrl,
      enableLinkPreview: tpl.enableLinkPreview,
      includeLinkPreviewDetails: Boolean(tpl.includeLinkPreviewDetails),
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
      title: effectiveProduct.title,
      message: rendered,
      platform: effectiveProduct.platform,
      groupsNames: groupNames,
      sentAt: nowFormatted,
      sentAtIso: now.toISOString(),
      artworkKey: effectiveProduct.artworkKey,
      customImageUrl: effectiveProduct.customImageUrl,
      affiliateUrl: effectiveProduct.affiliateUrl,
      segment: primaryTargetSeg,
    };

    setSentLogs((prev) => [newLog, ...prev]);
    setTotalSentCount((prev) => prev + delivery.sentCount);
    setProducts((prev) => prev.filter((p) => p.id !== effectiveProduct.id));

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
    segment,
  }: {
    title: string;
    message: string;
    groupsNames: string[];
    groupIds?: string[];
    platform?: Marketplace;
    customImageUrl?: string;
    enableLinkPreview?: boolean;
    mentionAll?: boolean;
    segment?: string;
  }): Promise<{ ok: boolean; sentCount: number; message: string; error?: string }> => {
    const targetSeg = normalizeSegmentName(segment || activeSegmentRef.current);
    const matchedGroups = groupIds?.length
      ? dispatchGroups.filter((g) => groupIds.includes(g.id))
      : groupsNames?.length
      ? dispatchGroups.filter((g) => groupsNames.includes(g.name))
      : dispatchGroups.filter((g) => isGroupActiveInSegment(g, targetSeg));

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
      segment: targetSeg,
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

          const itemSeg = normalizeSegmentName(item.segment);
          const targetGroups =
            item.groupIds.length > 0
              ? dispatchGroups.filter((g) => item.groupIds.includes(g.id))
              : dispatchGroups.filter((g) => isGroupActiveInSegment(g, itemSeg));

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
            segment: itemSeg,
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

  const removeDispatchGroup = useCallback(
    (group: DispatchGroup) => {
      const keysToExclude = getGroupAllMatchKeys(group);
      const primaryKey = getGroupExclusionKey(group);
      if (primaryKey && !keysToExclude.includes(primaryKey)) {
        keysToExclude.push(primaryKey);
      }
      setDispatchGroupsRaw((prev) => prev.filter((g) => g.id !== group.id));
      if (keysToExclude.length > 0) {
        setExcludedDispatchGroupKeys((prev) => {
          const next = Array.from(new Set([...prev, ...keysToExclude]));
          excludedDispatchKeysRef.current = next;
          return next;
        });
      }
      notify(
        'Grupo/canal excluído',
        `"${group.name}" foi removido da lista de envio. Você pode restaurar quando quiser.`,
        'info'
      );
    },
    [notify]
  );

  const removeMonitoringGroup = useCallback(
    (group: MonitoringGroup) => {
      const keysToExclude = getGroupAllMatchKeys(group);
      const primaryKey = getGroupExclusionKey(group);
      if (primaryKey && !keysToExclude.includes(primaryKey)) {
        keysToExclude.push(primaryKey);
      }
      setMonitoringGroupsRaw((prev) => prev.filter((m) => m.id !== group.id));
      if (keysToExclude.length > 0) {
        setExcludedMonitoringGroupKeys((prev) => {
          const next = Array.from(new Set([...prev, ...keysToExclude]));
          excludedMonitoringKeysRef.current = next;
          return next;
        });
      }
      notify(
        'Grupo excluído do monitoramento',
        `"${group.name}" foi removido da lista. Você pode restaurar quando quiser.`,
        'info'
      );
    },
    [notify]
  );

  const unexcludeDispatchGroupKeys = useCallback((keys: string[]) => {
    if (!keys.length) return;
    const dropSet = new Set(keys.map((k) => k.trim()).filter(Boolean));
    setExcludedDispatchGroupKeys((prev) => {
      const next = prev.filter((k) => !dropSet.has(k));
      excludedDispatchKeysRef.current = next;
      return next;
    });
  }, []);

  const restoreExcludedDispatchGroups = useCallback(async () => {
    excludedDispatchKeysRef.current = [];
    setExcludedDispatchGroupKeys([]);
    await syncWhatsAppGroupsFromAccount(undefined, { silent: true });
    notify(
      'Exclusões limpas',
      'Grupos do WhatsApp foram restaurados. Para canais do Telegram removidos, clique em "Importar Canais por @" ou "Sincronizar da API".',
      'success'
    );
  }, [notify, syncWhatsAppGroupsFromAccount]);

  const restoreExcludedMonitoringGroups = useCallback(async () => {
    excludedMonitoringKeysRef.current = [];
    setExcludedMonitoringGroupKeys([]);
    await syncWhatsAppGroupsFromAccount(undefined, { silent: true });
    notify(
      'Grupos restaurados',
      'Os grupos excluídos do monitoramento voltaram a aparecer na lista.',
      'success'
    );
  }, [notify, syncWhatsAppGroupsFromAccount]);

  const exportBackupJson = () => {
    const payload: PersistedState = {
      cleanRealWhatsAppMigrationV5: true,
      darkMode,
      segments,
      activeSegment,
      totalSentCount,
      whatsappRotationEnabled,
      accounts,
      dispatchGroups,
      monitoringGroups,
      savedGroupPrefs,
      excludedDispatchGroupKeys,
      excludedMonitoringGroupKeys,
      products,
      coupons,
      templates: templatesBySegment[DEFAULT_SEGMENT] || INITIAL_TEMPLATES,
      queues,
      schedules,
      sentLogs,
      convertedLinks,
      autoDispatch: autoDispatchBySegment[DEFAULT_SEGMENT] || INITIAL_AUTO_DISPATCH,
      siteCapture: siteCaptureBySegment[DEFAULT_SEGMENT] || INITIAL_SITE_CAPTURE,
      integrations,
      monitoringRules: monitoringRulesBySegment[DEFAULT_SEGMENT] || INITIAL_MONITORING_RULES,
      autoDispatchBySegment,
      templatesBySegment,
      siteCaptureBySegment,
      monitoringRulesBySegment,
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
      setWhatsappRotationEnabled(Boolean(cleaned.whatsappRotationEnabled));
      setAccounts(cleaned.accounts);
      setSavedGroupPrefs(cleaned.savedGroupPrefs);
      setExcludedDispatchGroupKeys(cleaned.excludedDispatchGroupKeys || []);
      setExcludedMonitoringGroupKeys(cleaned.excludedMonitoringGroupKeys || []);
      setDispatchGroups(cleaned.dispatchGroups);
      setMonitoringGroups(cleaned.monitoringGroups);
      setProducts(cleaned.products);
      setCoupons(cleaned.coupons);
      setTemplatesBySegment(
        cleaned.templatesBySegment || { [DEFAULT_SEGMENT]: cleaned.templates }
      );
      setQueues(cleaned.queues);
      setSchedules(cleaned.schedules);
      setSentLogs(cleaned.sentLogs);
      setConvertedLinks(cleaned.convertedLinks);
      setAutoDispatchBySegment(
        cleaned.autoDispatchBySegment || { [DEFAULT_SEGMENT]: cleaned.autoDispatch }
      );
      setSiteCaptureBySegment(
        cleaned.siteCaptureBySegment || { [DEFAULT_SEGMENT]: cleaned.siteCapture }
      );
      setIntegrations(cleaned.integrations);
      setMonitoringRulesBySegment(
        cleaned.monitoringRulesBySegment || { [DEFAULT_SEGMENT]: cleaned.monitoringRules }
      );
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
    setWhatsappRotationEnabled(false);
    setAccounts(DEFAULT_PERSISTED.accounts);
    setSavedGroupPrefs({});
    setExcludedDispatchGroupKeys([]);
    setExcludedMonitoringGroupKeys([]);
    setDispatchGroups([]);
    setMonitoringGroups([]);
    setProducts(DEFAULT_PERSISTED.products);
    setCoupons(DEFAULT_PERSISTED.coupons);
    setTemplatesBySegment({ [DEFAULT_SEGMENT]: DEFAULT_PERSISTED.templates });
    setQueues([]);
    setSchedules([]);
    setSentLogs([]);
    setConvertedLinks([]);
    setAutoDispatchBySegment({ [DEFAULT_SEGMENT]: DEFAULT_PERSISTED.autoDispatch });
    setSiteCaptureBySegment({ [DEFAULT_SEGMENT]: DEFAULT_PERSISTED.siteCapture });
    setIntegrations(DEFAULT_PERSISTED.integrations);
    setMonitoringRulesBySegment({ [DEFAULT_SEGMENT]: DEFAULT_PERSISTED.monitoringRules });
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
        whatsappRotationEnabled,
        setWhatsappRotationEnabled,
        accounts,
        setAccounts,
        dispatchGroups,
        setDispatchGroups,
        monitoringGroups,
        setMonitoringGroups,
        excludedDispatchGroupKeys,
        excludedMonitoringGroupKeys,
        removeDispatchGroup,
        removeMonitoringGroup,
        restoreExcludedDispatchGroups,
        restoreExcludedMonitoringGroups,
        unexcludeDispatchGroupKeys,
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
        autoDispatchBySegment,
        templatesBySegment,
        siteCaptureBySegment,
        monitoringRulesBySegment,
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
