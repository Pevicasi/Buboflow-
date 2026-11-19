import type { DispatchGroup } from '../types';
import type { BaileysMemberEvent } from './apiClient';

export type MemberMonitorPeriod =
  | 'Hoje'
  | 'Ontem'
  | 'Últimos 7 dias'
  | 'Mês Atual'
  | 'Mês Anterior'
  | 'Últimos 30 dias'
  | 'Personalizado';

export const MEMBER_MONITOR_PERIODS: MemberMonitorPeriod[] = [
  'Hoje',
  'Ontem',
  'Últimos 7 dias',
  'Mês Atual',
  'Mês Anterior',
  'Últimos 30 dias',
  'Personalizado',
];

export const WEEKDAY_NAMES_PT = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

export function normalizeMonitorGroupJid(jid?: string): string {
  if (!jid) return '';
  const trimmed = jid.trim();
  if (!trimmed) return '';
  const atIdx = trimmed.indexOf('@');
  if (atIdx < 0) return trimmed;
  const userPart = trimmed.slice(0, atIdx).split(':')[0];
  const domainPart = trimmed.slice(atIdx + 1).toLowerCase();
  return `${userPart}@${domainPart}`;
}

/**
 * Extracts normalized identity tokens (phone digits with BR 8/9-digit equivalence + LID digits)
 * so Baileys `me.id` / `me.lid` match WhatsApp group `owner`, `ownerPn`, and `participants`.
 */
function expandWaIdentityTokens(rawJid?: string | null): string[] {
  if (!rawJid) return [];
  const trimmed = String(rawJid).trim();
  if (!trimmed) return [];
  const beforeAt = trimmed.includes('@') ? trimmed.slice(0, trimmed.indexOf('@')) : trimmed;
  const base = beforeAt.split(':')[0].trim().toLowerCase();
  if (!base) return [];
  const tokens = new Set<string>([base]);
  const digits = base.replace(/\D/g, '');
  if (digits) {
    tokens.add(digits);
    // Brazil mobile 9th-digit equivalence: 55 + DDD (2) + 8 digits <-> 55 + DDD (2) + 9 + 8 digits
    if (digits.startsWith('55') && digits.length === 12) {
      tokens.add(`${digits.slice(0, 4)}9${digits.slice(4)}`);
    } else if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
      tokens.add(`${digits.slice(0, 4)}${digits.slice(5)}`);
    }
  }
  return Array.from(tokens);
}

export interface BaileysGroupParticipantLike {
  id?: string;
  jid?: string;
  lid?: string;
  phoneNumber?: string;
  admin?: string | null;
}

export interface BaileysGroupMetaLike {
  id?: string;
  owner?: string | null;
  ownerPn?: string | null;
  participants?: BaileysGroupParticipantLike[];
}

export function detectGroupAdminRole(
  groupMeta: BaileysGroupMetaLike,
  selfJids: Array<string | null | undefined>
): { isOwner: boolean; isAdmin: boolean; isOwnerOrAdmin: boolean } {
  const selfTokens = new Set<string>();
  for (const jid of selfJids) {
    for (const tok of expandWaIdentityTokens(jid)) {
      selfTokens.add(tok);
    }
  }
  if (selfTokens.size === 0) {
    return { isOwner: false, isAdmin: false, isOwnerOrAdmin: false };
  }

  const matchesSelf = (candidate?: string | null): boolean => {
    if (!candidate) return false;
    for (const tok of expandWaIdentityTokens(candidate)) {
      if (selfTokens.has(tok)) return true;
    }
    return false;
  };

  let isOwner = matchesSelf(groupMeta.owner) || matchesSelf(groupMeta.ownerPn);
  let isAdmin = isOwner;

  const participants = Array.isArray(groupMeta.participants) ? groupMeta.participants : [];
  for (const p of participants) {
    if (
      matchesSelf(p?.id) ||
      matchesSelf(p?.jid) ||
      matchesSelf(p?.lid) ||
      matchesSelf(p?.phoneNumber)
    ) {
      const role = String(p?.admin || '').toLowerCase();
      if (role === 'superadmin') {
        isOwner = true;
        isAdmin = true;
      } else if (role === 'admin') {
        isAdmin = true;
      }
    }
  }

  return {
    isOwner,
    isAdmin,
    isOwnerOrAdmin: isOwner || isAdmin,
  };
}

/**
 * Monitoramento de Membros ONLY monitors groups where the connected user is owner or admin.
 */
export function filterOwnerOrAdminGroups(groups: DispatchGroup[]): DispatchGroup[] {
  return (groups || []).filter((g) => Boolean(g.isOwnerOrAdmin || g.isOwner || g.isAdmin));
}

export function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDateKey(dateKey?: string): Date | null {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatDayLabel(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export interface PeriodDateRange {
  period: MemberMonitorPeriod;
  kpiStartKey: string;
  kpiEndKey: string;
  chartDays: { dateKey: string; label: string; weekday: number }[];
  kpiLabelSuffix: string;
}

export function getPeriodDateRange(
  period: MemberMonitorPeriod,
  nowInput: Date = new Date(),
  customStart?: string,
  customEnd?: string
): PeriodDateRange {
  const today = new Date(nowInput.getFullYear(), nowInput.getMonth(), nowInput.getDate());
  const buildRange = (start: Date, end: Date) => {
    const days: { dateKey: string; label: string; weekday: number }[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let guard = 0;
    while (cursor <= end && guard < 180) {
      days.push({
        dateKey: formatLocalDateKey(cursor),
        label: formatDayLabel(cursor),
        weekday: cursor.getDay(),
      });
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
    return days;
  };

  if (period === 'Personalizado') {
    const parsedStart = parseLocalDateKey(customStart);
    const parsedEnd = parseLocalDateKey(customEnd);
    const defaultStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    let start = parsedStart || defaultStart;
    let end = parsedEnd || today;
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    const days = buildRange(start, end);
    const chartStart =
      days.length < 3
        ? new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6)
        : start;
    return {
      period,
      kpiStartKey: formatLocalDateKey(start),
      kpiEndKey: formatLocalDateKey(end),
      chartDays: buildRange(chartStart, end),
      kpiLabelSuffix: `${formatDayLabel(start)}–${formatDayLabel(end)}`,
    };
  }

  if (period === 'Hoje') {
    const startChart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    const key = formatLocalDateKey(today);
    return {
      period,
      kpiStartKey: key,
      kpiEndKey: key,
      chartDays: buildRange(startChart, today),
      kpiLabelSuffix: 'Hoje',
    };
  }

  if (period === 'Ontem') {
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const startChart = new Date(
      yesterday.getFullYear(),
      yesterday.getMonth(),
      yesterday.getDate() - 6
    );
    const key = formatLocalDateKey(yesterday);
    return {
      period,
      kpiStartKey: key,
      kpiEndKey: key,
      chartDays: buildRange(startChart, yesterday),
      kpiLabelSuffix: 'Ontem',
    };
  }

  if (period === 'Mês Atual') {
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const chartStart =
      today.getDate() < 7
        ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
        : firstOfMonth;
    return {
      period,
      kpiStartKey: formatLocalDateKey(firstOfMonth),
      kpiEndKey: formatLocalDateKey(today),
      chartDays: buildRange(chartStart, today),
      kpiLabelSuffix: 'Mês Atual',
    };
  }

  if (period === 'Mês Anterior') {
    const firstPrev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastPrev = new Date(today.getFullYear(), today.getMonth(), 0);
    return {
      period,
      kpiStartKey: formatLocalDateKey(firstPrev),
      kpiEndKey: formatLocalDateKey(lastPrev),
      chartDays: buildRange(firstPrev, lastPrev),
      kpiLabelSuffix: 'Mês Anterior',
    };
  }

  if (period === 'Últimos 30 dias') {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    return {
      period,
      kpiStartKey: formatLocalDateKey(start),
      kpiEndKey: formatLocalDateKey(today),
      chartDays: buildRange(start, today),
      kpiLabelSuffix: '30 dias',
    };
  }

  // Default: Últimos 7 dias
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  return {
    period: 'Últimos 7 dias',
    kpiStartKey: formatLocalDateKey(start),
    kpiEndKey: formatLocalDateKey(today),
    chartDays: buildRange(start, today),
    kpiLabelSuffix: '7 dias',
  };
}

/**
 * Matches BuboFlow's exact Churn (%) formula:
 * `entries > 0 ? round1((exits / entries) * 100) : 0`
 * (e.g. 4 exits / 6 entries = 66.7%, 7 / 6 = 116.7%, 3 / 3 = 100%, 0 entries = 0%).
 */
export function formatBuboChurnPct(exits: number, entries: number): {
  value: number;
  label: string;
} {
  if (entries <= 0 || exits <= 0) return { value: 0, label: '0%' };
  const rounded = Math.round((exits / entries) * 1000) / 10;
  return {
    value: rounded,
    label: Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`,
  };
}

/** Kept as alias for backwards compatibility with existing callers/tests. */
export function formatChurnRatePct(exits: number, entries: number): {
  value: number;
  label: string;
} {
  return formatBuboChurnPct(exits, entries);
}

export function truncateGroupOptionLabel(name: string, maxLen = 38): string {
  const clean = (name || '').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Builds a smooth Catmull-Rom cubic Bezier SVG path through points (matches BuboFlow smooth curves).
 */
export function buildSmoothSvgPath(points: { x: number; y: number }[], tension = 0.25): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y}`;
  }
  let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export interface DailyFlowPoint {
  dateKey: string;
  label: string;
  weekday: number;
  entries: number;
  exits: number;
  net: number;
  total: number;
  movingAvg7d: number;
  churnPct: number;
  churnAvg7d: number;
}

export interface WeekdayPatternRow {
  day: string;
  weekday: number;
  entries: number;
  exits: number;
  avgEntries: number;
  avgExits: number;
  churnNum: number;
  churnPct: string;
}

export interface PerGroupMemberSummary {
  id: string;
  name: string;
  remoteJid: string;
  membersCount: number;
  entries: number;
  exits: number;
  net: number;
  churnLabel: string;
  activeForOffers: boolean;
  isOwner: boolean;
  isAdmin: boolean;
}

export interface MemberMonitorSummary {
  range: PeriodDateRange;
  ownedGroupsCount: number;
  targetGroups: DispatchGroup[];
  totalGroups: number;
  totalParticipants: number;
  /** Latest-day (or selected single-day) KPI snapshot matching BuboFlow's "Saldo Diário" & "Churn Diário" cards */
  todayStats: {
    entries: number;
    exits: number;
    net: number;
    churnNum: number;
    churnLabel: string;
  };
  periodStats: {
    entries: number;
    exits: number;
    net: number;
    churnNum: number;
    churnLabel: string;
    labelSuffix: string;
  };
  dailyFlow: DailyFlowPoint[];
  weekdayPatterns: WeekdayPatternRow[];
  perGroupBreakdown: PerGroupMemberSummary[];
}

export function computeMemberMonitorSummary(params: {
  groups: DispatchGroup[];
  memberEvents: BaileysMemberEvent[];
  selectedGroupId: string;
  period: MemberMonitorPeriod;
  now?: Date;
  customStartDate?: string;
  customEndDate?: string;
  /** Defaults to true: only monitor groups where the connected user is owner or admin. */
  onlyOwnerOrAdmin?: boolean;
}): MemberMonitorSummary {
  const {
    groups,
    memberEvents,
    selectedGroupId,
    period,
    now = new Date(),
    customStartDate,
    customEndDate,
    onlyOwnerOrAdmin = true,
  } = params;

  const eligibleGroups = onlyOwnerOrAdmin ? filterOwnerOrAdminGroups(groups) : groups;
  const range = getPeriodDateRange(period, now, customStartDate, customEndDate);
  const todayKey = formatLocalDateKey(now);

  const targetGroups =
    selectedGroupId === 'all'
      ? eligibleGroups
      : eligibleGroups.filter((g) => g.id === selectedGroupId);

  const targetJids = new Set(
    targetGroups.map((g) => normalizeMonitorGroupJid(g.remoteJid)).filter(Boolean)
  );

  const totalParticipants = targetGroups.reduce(
    (sum, g) => sum + Math.max(0, Number(g.membersCount) || 0),
    0
  );

  const relevantEvents =
    targetJids.size === 0
      ? []
      : memberEvents.filter((ev) => targetJids.has(normalizeMonitorGroupJid(ev.groupJid)));

  // Aggregate events by date
  const eventsByDate = new Map<string, { entries: number; exits: number }>();
  for (const ev of relevantEvents) {
    const prev = eventsByDate.get(ev.date) || { entries: 0, exits: 0 };
    prev.entries += Math.max(0, Number(ev.entries) || 0);
    prev.exits += Math.max(0, Number(ev.exits) || 0);
    eventsByDate.set(ev.date, prev);
  }

  // Daily KPI snapshot (today, or end date of period if Ontem/Mês Anterior/Personalizado)
  const kpiDayKey =
    period === 'Ontem' || period === 'Mês Anterior' || period === 'Personalizado'
      ? range.kpiEndKey
      : todayKey;
  const kpiDayAgg = eventsByDate.get(kpiDayKey) || { entries: 0, exits: 0 };
  const todayChurn = formatBuboChurnPct(kpiDayAgg.exits, kpiDayAgg.entries);

  // Aggregate full period totals within [kpiStartKey, kpiEndKey]
  let periodEntries = 0;
  let periodExits = 0;
  for (const ev of relevantEvents) {
    if (ev.date >= range.kpiStartKey && ev.date <= range.kpiEndKey) {
      periodEntries += Math.max(0, Number(ev.entries) || 0);
      periodExits += Math.max(0, Number(ev.exits) || 0);
    }
  }
  const periodNet = periodEntries - periodExits;
  const periodChurn = formatBuboChurnPct(periodExits, periodEntries);

  // Reconstruct daily totals accurately backward from today's real totalParticipants
  const chartEndKey = range.chartDays[range.chartDays.length - 1]?.dateKey || todayKey;
  let totalAtChartEnd = totalParticipants;
  for (const [dateKey, agg] of eventsByDate.entries()) {
    if (dateKey > chartEndKey && dateKey <= todayKey) {
      totalAtChartEnd = Math.max(0, totalAtChartEnd - (agg.entries - agg.exits));
    }
  }

  const baseDays = range.chartDays.map((d) => {
    const agg = eventsByDate.get(d.dateKey);
    const entries = agg?.entries || 0;
    const exits = agg?.exits || 0;
    return {
      dateKey: d.dateKey,
      label: d.label,
      weekday: d.weekday,
      entries,
      exits,
      net: entries - exits,
      churnPct: formatBuboChurnPct(exits, entries).value,
    };
  });

  const totals = new Array<number>(baseDays.length).fill(totalAtChartEnd);
  let running = totalAtChartEnd;
  for (let i = baseDays.length - 1; i > 0; i--) {
    running = Math.max(0, running - baseDays[i].net);
    totals[i - 1] = running;
  }

  // Compute 7-day rolling averages for Evolução (Média Móvel 7 dias) and Churn (Média 7 dias)
  const dailyFlow: DailyFlowPoint[] = baseDays.map((d, idx) => {
    const winStart = Math.max(0, idx - 6);
    const winLen = idx - winStart + 1;
    let sumTotal = 0;
    let sumChurn = 0;
    for (let j = winStart; j <= idx; j++) {
      sumTotal += totals[j];
      sumChurn += baseDays[j].churnPct;
    }
    return {
      ...d,
      total: totals[idx],
      movingAvg7d: Math.round((sumTotal / winLen) * 10) / 10,
      churnAvg7d: Math.round((sumChurn / winLen) * 10) / 10,
    };
  });

  // Weekday patterns (Média de Entradas, Média de Saídas, Média de Churn %) matching BuboFlow
  const weekdayOccurrences = new Array<number>(7).fill(0);
  const weekdayTotals = Array.from({ length: 7 }, () => ({ entries: 0, exits: 0 }));

  // Count how many times each weekday appears inside [kpiStartKey, kpiEndKey]
  const kpiStartDt = parseLocalDateKey(range.kpiStartKey);
  const kpiEndDt = parseLocalDateKey(range.kpiEndKey);
  if (kpiStartDt && kpiEndDt) {
    const c = new Date(kpiStartDt.getTime());
    let guard = 0;
    while (c <= kpiEndDt && guard < 180) {
      weekdayOccurrences[c.getDay()] += 1;
      c.setDate(c.getDate() + 1);
      guard += 1;
    }
  }

  for (const ev of relevantEvents) {
    if (ev.date >= range.kpiStartKey && ev.date <= range.kpiEndKey) {
      const wd = ev.weekday >= 0 && ev.weekday <= 6 ? ev.weekday : 0;
      weekdayTotals[wd].entries += Math.max(0, Number(ev.entries) || 0);
      weekdayTotals[wd].exits += Math.max(0, Number(ev.exits) || 0);
    }
  }

  const weekdayPatterns: WeekdayPatternRow[] = WEEKDAY_NAMES_PT.map((day, weekday) => {
    const occ = Math.max(1, weekdayOccurrences[weekday]);
    const entries = weekdayTotals[weekday].entries;
    const exits = weekdayTotals[weekday].exits;
    const avgEntries = Math.round((entries / occ) * 10) / 10;
    const avgExits = Math.round((exits / occ) * 10) / 10;
    const churn = formatBuboChurnPct(exits, entries);
    return {
      day,
      weekday,
      entries,
      exits,
      avgEntries,
      avgExits,
      churnNum: churn.value,
      churnPct: churn.label,
    };
  });

  // Per-group breakdown (ONLY owner/admin groups)
  const perGroupEvents = new Map<string, { entries: number; exits: number }>();
  for (const ev of memberEvents) {
    if (ev.date < range.kpiStartKey || ev.date > range.kpiEndKey) continue;
    const norm = normalizeMonitorGroupJid(ev.groupJid);
    if (!norm) continue;
    const prev = perGroupEvents.get(norm) || { entries: 0, exits: 0 };
    prev.entries += Math.max(0, Number(ev.entries) || 0);
    prev.exits += Math.max(0, Number(ev.exits) || 0);
    perGroupEvents.set(norm, prev);
  }

  const perGroupBreakdown: PerGroupMemberSummary[] = [...eligibleGroups]
    .map((g) => {
      const norm = normalizeMonitorGroupJid(g.remoteJid);
      const agg = (norm && perGroupEvents.get(norm)) || { entries: 0, exits: 0 };
      const membersCount = Math.max(0, Number(g.membersCount) || 0);
      const churn = formatBuboChurnPct(agg.exits, agg.entries);
      return {
        id: g.id,
        name: g.name,
        remoteJid: norm || g.remoteJid || '',
        membersCount,
        entries: agg.entries,
        exits: agg.exits,
        net: agg.entries - agg.exits,
        churnLabel: churn.label,
        activeForOffers: Boolean(g.activeForOffers),
        isOwner: Boolean(g.isOwner),
        isAdmin: Boolean(g.isAdmin || g.isOwner),
      };
    })
    .sort((a, b) => b.membersCount - a.membersCount || a.name.localeCompare(b.name, 'pt-BR'));

  return {
    range,
    ownedGroupsCount: eligibleGroups.length,
    targetGroups,
    totalGroups: targetGroups.length,
    totalParticipants,
    todayStats: {
      entries: kpiDayAgg.entries,
      exits: kpiDayAgg.exits,
      net: kpiDayAgg.entries - kpiDayAgg.exits,
      churnNum: todayChurn.value,
      churnLabel: todayChurn.label,
    },
    periodStats: {
      entries: periodEntries,
      exits: periodExits,
      net: periodNet,
      churnNum: periodChurn.value,
      churnLabel: periodChurn.label,
      labelSuffix: range.kpiLabelSuffix,
    },
    dailyFlow,
    weekdayPatterns,
    perGroupBreakdown,
  };
}
