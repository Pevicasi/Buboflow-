import {
  AutoDispatchConfig,
  DispatchGroup,
  Marketplace,
  Product,
  SavedGroupPreference,
  SentLog,
} from '../types';

export function parseTimeToMinutes(hhmm: string, fallbackMinutes = 0): number {
  const match = String(hhmm || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallbackMinutes;
  const h = Math.max(0, Math.min(23, Number(match[1])));
  const m = Math.max(0, Math.min(59, Number(match[2])));
  return h * 60 + m;
}

export function getBrazilTimeInfo(date: Date = new Date()): {
  hours: number;
  minutes: number;
  totalMinutes: number;
  formattedHHMM: string;
} {
  try {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hRaw = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const mRaw = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const hours = Number.isFinite(hRaw) ? hRaw % 24 : date.getHours();
    const minutes = Number.isFinite(mRaw) ? mRaw : date.getMinutes();
    return {
      hours,
      minutes,
      totalMinutes: hours * 60 + minutes,
      formattedHHMM: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    };
  } catch {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return {
      hours,
      minutes,
      totalMinutes: hours * 60 + minutes,
      formattedHHMM: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    };
  }
}

export function isWithinDispatchWindow(
  startTime: string,
  endTime: string,
  currentMinutes: number
): boolean {
  const start = parseTimeToMinutes(startTime, 7 * 60);
  const end = parseTimeToMinutes(endTime, 22 * 60);
  if (start === end) return true;
  if (start < end) {
    return currentMinutes >= start && currentMinutes <= end;
  }
  // Overnight window (e.g. 22:00 -> 06:00)
  return currentMinutes >= start || currentMinutes <= end;
}

export function pickRandomInt(
  min: number,
  max: number,
  rng: () => number = Math.random
): number {
  const lo = Math.max(1, Math.floor(Number.isFinite(min) ? min : 1));
  const hi = Math.max(lo, Math.floor(Number.isFinite(max) ? max : lo));
  if (lo === hi) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function normalizeTextKey(val?: string): string {
  return String(val || '')
    .trim()
    .toLowerCase();
}

function sortCandidatesByOrder(
  list: Product[],
  sendOrder: AutoDispatchConfig['sendOrder'],
  rng: () => number
): Product[] {
  const copy = [...list];
  switch (sendOrder) {
    case 'Mais Recentes':
      return copy.sort(
        (a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')
      );
    case 'Priorizados Primeiro':
      return copy.sort((a, b) => {
        if (Boolean(a.isPrioritized) !== Boolean(b.isPrioritized)) {
          return a.isPrioritized ? -1 : 1;
        }
        if (Boolean(a.isFavorite) !== Boolean(b.isFavorite)) {
          return a.isFavorite ? -1 : 1;
        }
        return Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '');
      });
    case 'Maior Comissão':
      return copy.sort((a, b) => {
        const diffVal = (Number(b.commissionValue) || 0) - (Number(a.commissionValue) || 0);
        if (diffVal !== 0) return diffVal;
        return (Number(b.commissionPercent) || 0) - (Number(a.commissionPercent) || 0);
      });
    case 'Aleatório':
    default: {
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }
  }
}

function pickProportionalPlatform(
  availablePlatforms: Marketplace[],
  distribution: Record<Marketplace, number>,
  recentPlatformCounts: Record<string, number>,
  lastPlatform: string | null,
  lastPlatformStreak: number,
  rng: () => number
): Marketplace | null {
  if (availablePlatforms.length === 0) return null;

  const weighted = availablePlatforms
    .map((p) => ({ platform: p, weight: Math.max(0, Number(distribution?.[p]) || 0) }))
    .filter((item) => item.weight > 0);

  // If all weights are 0 (or configured platforms ran out of stock), return null so sendOrder
  // (Priorizados Primeiro, Maior Comissão, Mais Recentes, Aleatório) operates freely across all products.
  if (weighted.length === 0) return null;

  // If user configured percentages (>0) and at least one configured platform has products,
  // STRICTLY honor only those configured platforms using smooth proportional deficit scheduling.
  const activePool = weighted;

  const totalWeight = activePool.reduce((sum, item) => sum + item.weight, 0);

  // Anti-streak guard: when multiple weighted platforms have stock, never let one platform exceed
  // its natural max consecutive run (for 50/50, maxStreak = 1 -> strict alternation A, B, A, B;
  // for 70/30, maxStreak = 3 -> smooth A, A, B, A, A, B) even if older historical logs were skewed.
  let eligiblePool = activePool;
  if (activePool.length > 1 && lastPlatform && lastPlatformStreak > 0) {
    const lastEntry = activePool.find((item) => item.platform === lastPlatform);
    if (lastEntry) {
      const share = lastEntry.weight / totalWeight;
      const maxStreak = share <= 0.5 ? 1 : Math.max(1, Math.ceil(share / (1 - share)));
      if (lastPlatformStreak >= maxStreak) {
        const others = activePool.filter((item) => item.platform !== lastPlatform);
        if (others.length > 0) {
          eligiblePool = others;
        }
      }
    }
  }

  const totalRecentForActive = activePool.reduce(
    (sum, item) => sum + (recentPlatformCounts[item.platform] || 0),
    0
  );

  // Highest deficit = (targetShare * (totalRecent + 1)) - actualRecentCount.
  let bestScore = -Infinity;
  let bestCandidates: Marketplace[] = [];

  for (const item of eligiblePool) {
    const share = item.weight / totalWeight;
    const actual = recentPlatformCounts[item.platform] || 0;
    const expectedNext = share * (totalRecentForActive + 1);
    const repeatPenalty =
      lastPlatform && item.platform === lastPlatform && activePool.length > 1 ? 0.0001 : 0;
    const score = expectedNext - actual - repeatPenalty;

    if (score > bestScore + 1e-9) {
      bestScore = score;
      bestCandidates = [item.platform];
    } else if (Math.abs(score - bestScore) <= 1e-9) {
      bestCandidates.push(item.platform);
    }
  }

  if (bestCandidates.length === 1) return bestCandidates[0];
  return bestCandidates[Math.floor(rng() * bestCandidates.length)];
}

export interface SelectAutoDispatchParams {
  products: Product[];
  config: AutoDispatchConfig;
  sentLogs?: SentLog[];
  recentAutoProductIds?: string[];
  rng?: () => number;
}

/**
 * Picks 1..N products from saved Produtos respecting:
 * - minProductsPerRun / maxProductsPerRun
 * - strict proportional platform distribution (smooth deficit + anti-streak: 50/50 strictly alternates!)
 * - sendOrder ('Aleatório', 'Mais Recentes', 'Priorizados Primeiro', 'Maior Comissão')
 * - avoiding immediate repeats until all eligible products have cycled
 */
export function selectProductsForAutoDispatch({
  products,
  config,
  sentLogs = [],
  recentAutoProductIds = [],
  rng = Math.random,
}: SelectAutoDispatchParams): Product[] {
  const validProducts = (products || []).filter(
    (p) => p && p.id && p.title && (p.affiliateUrl || p.originalUrl)
  );
  if (validProducts.length === 0) return [];

  const desiredCount = Math.min(
    validProducts.length,
    pickRandomInt(config.minProductsPerRun || 1, config.maxProductsPerRun || 1, rng)
  );

  // Build lookup of recently sent products (from session queue + recent sentLogs)
  const sentUrls = new Set<string>();
  const sentTitles = new Set<string>();
  const recentIds = new Set(recentAutoProductIds);

  // Track recent auto-dispatched platform counts (last 10 auto-dispatches) for proportional balancing
  const recentPlatformCounts: Record<string, number> = {};
  const autoLogs = (sentLogs || []).filter((l) => String(l?.id || '').startsWith('sent-auto-'));
  const recentAutoWindow = autoLogs.slice(0, 10);
  let lastDispatchedPlatform: string | null = recentAutoWindow[0]?.platform || null;
  let lastPlatformStreak = 0;
  if (lastDispatchedPlatform) {
    for (const log of recentAutoWindow) {
      if (log.platform === lastDispatchedPlatform) {
        lastPlatformStreak += 1;
      } else {
        break;
      }
    }
  }

  for (const log of recentAutoWindow) {
    if (log.platform) {
      recentPlatformCounts[log.platform] = (recentPlatformCounts[log.platform] || 0) + 1;
    }
  }

  // Consider logs from the last 12 hours as "already sent in this cycle"
  const cutoffMs = Date.now() - 12 * 3600_000;
  for (const log of (sentLogs || []).slice(0, 60)) {
    const ts = log.sentAtIso ? Date.parse(log.sentAtIso) : NaN;
    if (Number.isFinite(ts) && ts < cutoffMs) continue;
    if (log.affiliateUrl) sentUrls.add(normalizeTextKey(log.affiliateUrl));
    if (log.title) sentTitles.add(normalizeTextKey(log.title));
  }

  const isAlreadySent = (p: Product) =>
    recentIds.has(p.id) ||
    (p.affiliateUrl && sentUrls.has(normalizeTextKey(p.affiliateUrl))) ||
    sentTitles.has(normalizeTextKey(p.title));

  const freshPool = validProducts.filter((p) => !isAlreadySent(p));
  // If every product has already been sent, recycle the full catalog so auto-dispatch keeps working
  const workingPool = freshPool.length > 0 ? [...freshPool] : [...validProducts];

  const chosen: Product[] = [];
  const chosenIds = new Set<string>();

  for (let slot = 0; slot < desiredCount; slot++) {
    const remaining = workingPool.filter((p) => !chosenIds.has(p.id));
    if (remaining.length === 0) break;

    const platformsPresent = Array.from(new Set(remaining.map((p) => p.platform)));
    const targetPlatform = pickProportionalPlatform(
      platformsPresent,
      config.distribution,
      recentPlatformCounts,
      lastDispatchedPlatform,
      lastPlatformStreak,
      rng
    );

    const platformCandidates = targetPlatform
      ? remaining.filter((p) => p.platform === targetPlatform)
      : remaining;

    const sorted = sortCandidatesByOrder(
      platformCandidates.length > 0 ? platformCandidates : remaining,
      config.sendOrder,
      rng
    );

    const nextProduct = sorted[0];
    if (nextProduct) {
      chosen.push(nextProduct);
      chosenIds.add(nextProduct.id);
      recentPlatformCounts[nextProduct.platform] =
        (recentPlatformCounts[nextProduct.platform] || 0) + 1;
      if (lastDispatchedPlatform === nextProduct.platform) {
        lastPlatformStreak += 1;
      } else {
        lastDispatchedPlatform = nextProduct.platform;
        lastPlatformStreak = 1;
      }
    }
  }

  return chosen;
}

export interface ResolvedAutoDispatchTargets {
  waGroups: { remoteJid: string; name: string; accountId?: string }[];
  tgGroups: { remoteJid: string; name: string; accountId?: string }[];
}

export function resolveActiveDispatchTargets(state: {
  dispatchGroups?: DispatchGroup[];
  savedGroupPrefs?: Record<string, SavedGroupPreference>;
  activeSegment?: string;
}): ResolvedAutoDispatchTargets {
  const waByJid = new Map<string, { remoteJid: string; name: string; accountId?: string }>();
  const tgByJid = new Map<string, { remoteJid: string; name: string; accountId?: string }>();

  const groups = Array.isArray(state.dispatchGroups) ? state.dispatchGroups : [];
  for (const g of groups) {
    if (!g || !g.activeForOffers || !g.remoteJid) continue;
    const jid = String(g.remoteJid).trim();
    if (!jid) continue;
    if (g.channel === 'WhatsApp') {
      waByJid.set(jid.toLowerCase(), {
        remoteJid: jid,
        name: g.name || jid,
        accountId: g.accountId,
      });
    } else if (g.channel === 'Telegram') {
      tgByJid.set(jid, {
        remoteJid: jid,
        name: g.name || jid,
        accountId: g.accountId,
      });
    }
  }

  // Fallback: if browser is closed and dispatchGroups was stripped on boot, check savedGroupPrefs for active WhatsApp groups
  const prefs = state.savedGroupPrefs || {};
  for (const [key, pref] of Object.entries(prefs)) {
    if (!pref?.activeForOffers) continue;
    if (key.startsWith('wa:')) {
      const jid = key.slice(3).trim();
      if (jid && !waByJid.has(jid.toLowerCase())) {
        waByJid.set(jid.toLowerCase(), { remoteJid: jid, name: jid });
      }
    }
  }

  return {
    waGroups: Array.from(waByJid.values()),
    tgGroups: Array.from(tgByJid.values()),
  };
}
