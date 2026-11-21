export interface DispatchWhatsAppAccountLike {
  id: string;
  name?: string;
  channel?: string;
  connected?: boolean;
  activeForDispatch?: boolean;
  provider?: string;
}

export interface WhatsAppDispatchTargetLike {
  remoteJid: string;
  name?: string;
  accountId?: string;
}

export interface WhatsAppAccountDispatchBatch {
  accountId: string;
  remoteJids: string[];
  targets: WhatsAppDispatchTargetLike[];
}

export function sanitizeDispatchAccountId(rawId: string | undefined | null): string {
  const cleaned = String(rawId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned || 'acc-wa-1';
}

/**
 * Backward-compatible default: accounts without an explicit `activeForDispatch: false`
 * are considered active for sending offers.
 */
export function isWhatsAppAccountActiveForDispatch(
  acc: Pick<DispatchWhatsAppAccountLike, 'activeForDispatch'> | null | undefined
): boolean {
  if (!acc) return true;
  return acc.activeForDispatch !== false;
}

/**
 * Returns the list of WhatsApp accounts eligible to send offers right now.
 * - When `openSessionIds` is provided (server Baileys check), only accounts whose
 *   sanitized ID matches an open Baileys socket are eligible.
 * - If an open Baileys session exists on the server that is not yet in `accounts`,
 *   it is treated as active by default (unless explicitly disabled in `accounts`).
 * - When `openSessionIds` is omitted (client check), filters to `channel === 'WhatsApp'`,
 *   `connected !== false`, and `activeForDispatch !== false`.
 */
export function resolveActiveWhatsAppAccounts<T extends DispatchWhatsAppAccountLike>(
  accounts: T[],
  openSessionIds?: Iterable<string>
): { activeAccounts: T[]; hasAnyConnectedOrOpen: boolean } {
  const waAccounts = (Array.isArray(accounts) ? accounts : []).filter(
    (a) => !a.channel || a.channel === 'WhatsApp'
  );

  if (openSessionIds) {
    const openSet = new Set(
      Array.from(openSessionIds)
        .map((id) => sanitizeDispatchAccountId(id))
        .filter(Boolean)
    );
    const hasAnyConnectedOrOpen = openSet.size > 0;
    if (!hasAnyConnectedOrOpen) {
      return { activeAccounts: [], hasAnyConnectedOrOpen: false };
    }

    const bySanitized = new Map<string, T>();
    for (const acc of waAccounts) {
      bySanitized.set(sanitizeDispatchAccountId(acc.id), acc);
    }

    const activeAccounts: T[] = [];
    const seen = new Set<string>();

    // Preserve user's account ordering first
    for (const acc of waAccounts) {
      const safeId = sanitizeDispatchAccountId(acc.id);
      if (!openSet.has(safeId) || seen.has(safeId)) continue;
      seen.add(safeId);
      if (isWhatsAppAccountActiveForDispatch(acc)) {
        activeAccounts.push(acc);
      }
    }

    // Include any open Baileys session not yet mirrored in `accounts`
    for (const safeId of openSet) {
      if (seen.has(safeId)) continue;
      const existing = bySanitized.get(safeId);
      if (!existing) {
        activeAccounts.push({
          id: safeId,
          channel: 'WhatsApp',
          connected: true,
          activeForDispatch: true,
        } as T);
      }
    }

    return { activeAccounts, hasAnyConnectedOrOpen };
  }

  const connectedWa = waAccounts.filter((a) => a.connected);
  const activeAccounts = connectedWa.filter((a) => isWhatsAppAccountActiveForDispatch(a));
  return {
    activeAccounts,
    hasAnyConnectedOrOpen: connectedWa.length > 0,
  };
}

/**
 * Groups WhatsApp target JIDs by the active sending account:
 * - When `rotateAccounts` is true and 2+ active accounts are available, routes the entire
 *   dispatch through the next account in round-robin order (`rotationCursor % activeAccounts.length`)
 *   and returns `nextRotationCursor` so consecutive dispatches alternate evenly between numbers.
 * - Otherwise, if a group's own `accountId` is active (and connected/open), sends via that account;
 *   if paused/disabled/disconnected, routes to the first active WhatsApp account.
 * - If ALL connected WhatsApp accounts are disabled for dispatch, returns empty batches
 *   with `allDisabled: true` so NO offers are dispatched via WhatsApp.
 */
export function groupWhatsAppTargetsByActiveAccount<
  T extends DispatchWhatsAppAccountLike,
  G extends WhatsAppDispatchTargetLike,
>(
  targets: G[],
  accounts: T[],
  openSessionIds?: Iterable<string>,
  options?: {
    rotateAccounts?: boolean;
    rotationCursor?: number;
  }
): {
  batches: WhatsAppAccountDispatchBatch[];
  hasAnyConnectedOrOpen: boolean;
  allDisabled: boolean;
  rotatedAccountId?: string;
  nextRotationCursor: number;
} {
  const cursor = Math.max(0, Math.floor(Number(options?.rotationCursor) || 0));
  const { activeAccounts, hasAnyConnectedOrOpen } = resolveActiveWhatsAppAccounts(
    accounts,
    openSessionIds
  );

  if (!hasAnyConnectedOrOpen) {
    return {
      batches: [],
      hasAnyConnectedOrOpen: false,
      allDisabled: false,
      nextRotationCursor: cursor,
    };
  }
  if (activeAccounts.length === 0) {
    return {
      batches: [],
      hasAnyConnectedOrOpen: true,
      allDisabled: true,
      nextRotationCursor: cursor,
    };
  }

  // Round-robin rotation across active WhatsApp numbers
  if (options?.rotateAccounts && activeAccounts.length >= 2) {
    const chosenAcc = activeAccounts[cursor % activeAccounts.length];
    const dedupedTargets: G[] = [];
    const seenJids = new Set<string>();
    for (const target of targets) {
      const jid = String(target?.remoteJid || '').trim();
      if (!jid) continue;
      const norm = jid.toLowerCase();
      if (seenJids.has(norm)) continue;
      seenJids.add(norm);
      dedupedTargets.push(target);
    }

    if (dedupedTargets.length === 0) {
      return {
        batches: [],
        hasAnyConnectedOrOpen: true,
        allDisabled: false,
        nextRotationCursor: cursor,
      };
    }

    return {
      batches: [
        {
          accountId: chosenAcc.id,
          remoteJids: dedupedTargets.map((t) => String(t.remoteJid).trim()),
          targets: dedupedTargets,
        },
      ],
      hasAnyConnectedOrOpen: true,
      allDisabled: false,
      rotatedAccountId: chosenAcc.id,
      nextRotationCursor: (cursor + 1) % activeAccounts.length,
    };
  }

  const activeBySanitized = new Map<string, T>();
  for (const acc of activeAccounts) {
    activeBySanitized.set(sanitizeDispatchAccountId(acc.id), acc);
  }
  const fallbackAcc = activeAccounts[0];

  const batchMap = new Map<string, { targets: G[]; seenJids: Set<string> }>();
  for (const target of targets) {
    const jid = String(target?.remoteJid || '').trim();
    if (!jid) continue;
    const preferredSafeId = target.accountId
      ? sanitizeDispatchAccountId(target.accountId)
      : '';
    const chosenAcc =
      (preferredSafeId ? activeBySanitized.get(preferredSafeId) : undefined) || fallbackAcc;
    const chosenId = chosenAcc.id;

    let entry = batchMap.get(chosenId);
    if (!entry) {
      entry = { targets: [], seenJids: new Set<string>() };
      batchMap.set(chosenId, entry);
    }
    const normJid = jid.toLowerCase();
    if (!entry.seenJids.has(normJid)) {
      entry.seenJids.add(normJid);
      entry.targets.push(target);
    }
  }

  const batches: WhatsAppAccountDispatchBatch[] = [];
  for (const [accountId, entry] of batchMap.entries()) {
    if (entry.targets.length === 0) continue;
    batches.push({
      accountId,
      remoteJids: entry.targets.map((t) => String(t.remoteJid).trim()),
      targets: entry.targets,
    });
  }

  return {
    batches,
    hasAnyConnectedOrOpen: true,
    allDisabled: false,
    nextRotationCursor: cursor,
  };
}
