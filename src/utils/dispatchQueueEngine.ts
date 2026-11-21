export interface DispatchQueueLike {
  id: string;
  name: string;
  sentCount: number;
  totalCount: number;
  active: boolean;
  productIds: string[];
  intervalMinutes: number;
  segment?: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface QueueProductLike {
  id: string;
  title?: string;
}

export function computeQueueNextRunIso(intervalMinutes: number, fromMs: number = Date.now()): string {
  const safeMinutes = Math.max(1, Math.min(1440, Math.round(Number(intervalMinutes) || 15)));
  return new Date(fromMs + safeMinutes * 60_000).toISOString();
}

/**
 * Finds the next valid product ID in the queue starting from `sentCount`.
 * Skips any IDs whose products were deleted from the catalog.
 */
export function resolveNextQueueProduct<P extends QueueProductLike>(
  queue: DispatchQueueLike,
  products: P[]
): { product: P; nextIndex: number } | null {
  const ids = Array.isArray(queue.productIds) ? queue.productIds : [];
  if (ids.length === 0) return null;

  const startIndex = Math.max(0, Math.floor(Number(queue.sentCount) || 0));
  if (startIndex >= ids.length) return null;

  const byId = new Map<string, P>();
  for (const p of products) {
    if (p?.id) byId.set(p.id, p);
  }

  for (let idx = startIndex; idx < ids.length; idx += 1) {
    const found = byId.get(ids[idx]);
    if (found) {
      return { product: found, nextIndex: idx + 1 };
    }
  }

  return null;
}

/**
 * Determines whether a queue is ready to dispatch its next item automatically on the server.
 */
export function isDispatchQueueDue(queue: DispatchQueueLike, nowMs: number = Date.now()): boolean {
  if (!queue?.active) return false;
  const ids = Array.isArray(queue.productIds) ? queue.productIds : [];
  if (ids.length === 0) return false;
  const sent = Math.max(0, Math.floor(Number(queue.sentCount) || 0));
  if (sent >= ids.length) return false;

  if (queue.nextRunAt) {
    const nextMs = Date.parse(queue.nextRunAt);
    if (Number.isFinite(nextMs)) {
      return nowMs >= nextMs;
    }
  }

  if (queue.lastRunAt) {
    const lastMs = Date.parse(queue.lastRunAt);
    const intervalMs = Math.max(1, Number(queue.intervalMinutes) || 15) * 60_000;
    if (Number.isFinite(lastMs)) {
      return nowMs - lastMs >= intervalMs;
    }
  }

  // Active queue that has never run yet is due immediately
  return true;
}
