import {
  AutoDispatchConfig,
  DispatchGroup,
  MessageTemplate,
  MonitoringRulesConfig,
  SiteCaptureConfig,
} from '../types';
import {
  INITIAL_AUTO_DISPATCH,
  INITIAL_MONITORING_RULES,
  INITIAL_SITE_CAPTURE,
  INITIAL_TEMPLATES,
} from '../data/initialData';

export const DEFAULT_SEGMENT = 'Geral';

export function normalizeSegmentName(segment?: string | null): string {
  const trimmed = String(segment || '').trim();
  return trimmed || DEFAULT_SEGMENT;
}

export function matchesSegment(
  itemSegment: string | undefined | null,
  activeSegment: string
): boolean {
  return (
    normalizeSegmentName(itemSegment).toLowerCase() ===
    normalizeSegmentName(activeSegment).toLowerCase()
  );
}

export function dedupeSegmentNames(list?: (string | null | undefined)[]): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const clean = String(raw || '').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

export function getGroupActiveSegments(
  group:
    | {
        activeForOffers?: boolean;
        activeSegments?: string[];
        segment?: string;
      }
    | null
    | undefined
): string[] {
  if (!group) return [];
  if (Array.isArray(group.activeSegments)) {
    return dedupeSegmentNames(group.activeSegments);
  }
  if (group.activeForOffers) {
    return [normalizeSegmentName(group.segment)];
  }
  return [];
}

export function isGroupActiveInSegment(
  group:
    | {
        activeForOffers?: boolean;
        activeSegments?: string[];
        segment?: string;
      }
    | null
    | undefined,
  segment: string
): boolean {
  const target = normalizeSegmentName(segment).toLowerCase();
  return getGroupActiveSegments(group).some((s) => s.toLowerCase() === target);
}

export function toggleGroupSegmentMembership(
  currentSegments: string[],
  segment: string,
  enable: boolean
): string[] {
  const target = normalizeSegmentName(segment);
  const targetKey = target.toLowerCase();
  const cleaned = dedupeSegmentNames(currentSegments);
  if (enable) {
    return cleaned.some((s) => s.toLowerCase() === targetKey) ? cleaned : [...cleaned, target];
  }
  return cleaned.filter((s) => s.toLowerCase() !== targetKey);
}

export function getGroupMonitoredSegments(
  group:
    | {
        monitored?: boolean;
        monitoredSegments?: string[];
      }
    | null
    | undefined
): string[] {
  if (!group) return [];
  if (Array.isArray(group.monitoredSegments)) {
    return dedupeSegmentNames(group.monitoredSegments);
  }
  if (group.monitored) {
    return [DEFAULT_SEGMENT];
  }
  return [];
}

export function isGroupMonitoredInSegment(
  group:
    | {
        monitored?: boolean;
        monitoredSegments?: string[];
      }
    | null
    | undefined,
  segment: string
): boolean {
  const target = normalizeSegmentName(segment).toLowerCase();
  return getGroupMonitoredSegments(group).some((s) => s.toLowerCase() === target);
}

/**
 * Determines whether an owner/admin group belongs to the active segment in Monitoramento de Membros.
 * - Any group explicitly active in `activeSegment` is included.
 * - In the default 'Geral' segment, unassigned owner/admin groups (not active in any segment yet)
 *   are also shown so newly connected WhatsApp groups appear immediately in 'Geral'.
 * - Non-Geral segments (e.g. 'BELEZA') only show owner/admin groups activated for that segment.
 */
export function isOwnerGroupInSegment(
  group: Pick<DispatchGroup, 'activeForOffers' | 'activeSegments' | 'segment'>,
  activeSegment: string
): boolean {
  const target = normalizeSegmentName(activeSegment).toLowerCase();
  const activeSegs = getGroupActiveSegments(group);
  if (activeSegs.some((s) => s.toLowerCase() === target)) return true;
  if (target === DEFAULT_SEGMENT.toLowerCase() && activeSegs.length === 0) return true;
  return false;
}

export function slugifySegmentName(segment: string): string {
  const base = normalizeSegmentName(segment)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'geral';
}

export function createDefaultAutoDispatchForSegment(): AutoDispatchConfig {
  return {
    ...INITIAL_AUTO_DISPATCH,
    enabled: false,
    distribution: { ...INITIAL_AUTO_DISPATCH.distribution },
  };
}

export function createDefaultSiteCaptureForSegment(segment: string): SiteCaptureConfig {
  const cleanName = normalizeSegmentName(segment);
  const slug =
    cleanName === DEFAULT_SEGMENT
      ? INITIAL_SITE_CAPTURE.slug
      : `ofertas-${slugifySegmentName(cleanName)}`;
  return {
    ...INITIAL_SITE_CAPTURE,
    slug,
    selectedGroupIds: [],
    pageTitle:
      cleanName === DEFAULT_SEGMENT
        ? INITIAL_SITE_CAPTURE.pageTitle
        : `OFERTAS ${cleanName.toUpperCase()} VIP`,
    advantages: [...INITIAL_SITE_CAPTURE.advantages],
  };
}

export function createDefaultMonitoringRulesForSegment(): MonitoringRulesConfig {
  return {
    ...INITIAL_MONITORING_RULES,
    restrictedWords: [],
    allowedWords: [],
    automationGroupId: '',
  };
}

export function createDefaultTemplatesForSegment(): MessageTemplate[] {
  return INITIAL_TEMPLATES.map((tpl) => ({
    ...tpl,
    conditions: tpl.conditions.map((c) => ({ ...c })),
  }));
}

export function resolveSegmentConfig<T>(
  bySegment: Record<string, T> | undefined,
  legacyGeral: T,
  segment: string,
  createDefault: (seg: string) => T
): T {
  const seg = normalizeSegmentName(segment);
  if (bySegment && Object.prototype.hasOwnProperty.call(bySegment, seg) && bySegment[seg] != null) {
    return bySegment[seg];
  }
  if (seg === DEFAULT_SEGMENT) {
    return legacyGeral;
  }
  return createDefault(seg);
}

export function renameSegmentInMap<T>(
  map: Record<string, T> | undefined,
  oldName: string,
  newName: string
): Record<string, T> {
  const next: Record<string, T> = { ...(map || {}) };
  if (Object.prototype.hasOwnProperty.call(next, oldName)) {
    next[newName] = next[oldName];
    delete next[oldName];
  }
  return next;
}

export function deleteSegmentFromMap<T>(
  map: Record<string, T> | undefined,
  name: string
): Record<string, T> {
  const next: Record<string, T> = { ...(map || {}) };
  delete next[name];
  return next;
}

export function replaceSegmentInList(
  list: string[] | undefined,
  oldName: string,
  newName: string
): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return dedupeSegmentNames(list.map((s) => (s === oldName ? newName : s)));
}

export function removeSegmentFromList(
  list: string[] | undefined,
  name: string
): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return dedupeSegmentNames(list.filter((s) => s !== name));
}
