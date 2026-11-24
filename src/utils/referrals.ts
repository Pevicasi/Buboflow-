import type { ReferralEntry } from '../types';

export const REFERRAL_COMMISSION_PERCENT = 12;

export function isValidAsaasWalletId(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  // Asaas Wallet IDs are standard UUIDs (36 chars: 8-4-4-4-12 hex)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}

export function sanitizeReferralCode(raw: string): string {
  const cleaned = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toUpperCase()
    .slice(0, 24);
  return cleaned;
}

export function generateReferralCode(seed?: string): string {
  const base = sanitizeReferralCode(String(seed || '').split('@')[0] || '').slice(0, 8);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return base.length >= 3 ? `${base}${suffix}` : `BUBO${suffix}`;
}

export function calculateReferralSplit(
  planAmount: number,
  percent: number = REFERRAL_COMMISSION_PERCENT,
  walletId?: string
): {
  planAmount: number;
  percentualValue: number;
  commissionValue: number;
  asaasSplitPayload: { walletId: string; percentualValue: number }[];
} {
  const safeAmount = Math.max(0, Number(planAmount) || 0);
  const safePercent = Math.max(0, Math.min(100, Number(percent) || REFERRAL_COMMISSION_PERCENT));
  const commissionValue = Number(((safeAmount * safePercent) / 100).toFixed(2));
  const cleanWallet = String(walletId || '').trim();
  return {
    planAmount: Number(safeAmount.toFixed(2)),
    percentualValue: safePercent,
    commissionValue,
    asaasSplitPayload: cleanWallet
      ? [{ walletId: cleanWallet, percentualValue: safePercent }]
      : [],
  };
}

export interface ReferralStats {
  clicks: number;
  totalReferred: number;
  activeSubscribers: number;
  pendingCount: number;
  cancelledCount: number;
  totalEarned: number;
  monthlyRecurringForecast: number;
  conversionRate: number;
}

export function buildReferralStats(
  referrals: ReferralEntry[],
  clicks: number = 0
): ReferralStats {
  const safeClicks = Math.max(0, Math.floor(Number(clicks) || 0));
  let activeSubscribers = 0;
  let pendingCount = 0;
  let cancelledCount = 0;
  let totalEarned = 0;
  let monthlyRecurringForecast = 0;

  for (const r of referrals) {
    totalEarned += Number(r.totalCommissionPaid) || 0;
    if (r.status === 'Ativo') {
      activeSubscribers += 1;
      monthlyRecurringForecast += Number(r.monthlyCommission) || 0;
    } else if (r.status === 'Pendente') {
      pendingCount += 1;
    } else {
      cancelledCount += 1;
    }
  }

  const conversionRate =
    safeClicks > 0 ? Number(((referrals.length / safeClicks) * 100).toFixed(1)) : 0;

  return {
    clicks: safeClicks,
    totalReferred: referrals.length,
    activeSubscribers,
    pendingCount,
    cancelledCount,
    totalEarned: Number(totalEarned.toFixed(2)),
    monthlyRecurringForecast: Number(monthlyRecurringForecast.toFixed(2)),
    conversionRate,
  };
}

export interface ParsedAsaasWebhookEvent {
  event: string;
  paymentId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  externalReference: string;
  paymentValue: number;
  commissionValue: number;
  walletIdMatched: boolean;
  nextStatus: 'Ativo' | 'Pendente' | 'Cancelado';
  shouldCreditCommission: boolean;
}

export function parseAsaasWebhookEvent(
  payload: any,
  expectedWalletId?: string
): ParsedAsaasWebhookEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const event = String(payload.event || '').toUpperCase().trim();
  const payment = payload.payment;
  if (!event || !payment || typeof payment !== 'object') return null;

  const paymentValue = Math.max(0, Number(payment.value) || 0);
  const splits: any[] = Array.isArray(payment.split) ? payment.split : [];
  const cleanExpected = String(expectedWalletId || '').trim().toLowerCase();
  const matchedSplit = cleanExpected
    ? splits.find((s) => String(s?.walletId || '').trim().toLowerCase() === cleanExpected)
    : splits[0];

  const splitCommission = matchedSplit
    ? Number(
        matchedSplit.totalValue ??
          matchedSplit.fixedValue ??
          ((paymentValue * (Number(matchedSplit.percentualValue) || REFERRAL_COMMISSION_PERCENT)) /
            100)
      )
    : calculateReferralSplit(paymentValue).commissionValue;

  const isPaid = event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED';
  const isCancelled =
    event === 'PAYMENT_REFUNDED' ||
    event === 'PAYMENT_DELETED' ||
    event === 'PAYMENT_CHARGEBACK_REQUESTED';

  return {
    event,
    paymentId: String(payment.id || `pay-${Date.now()}`),
    customerId: String(payment.customer || ''),
    customerName: String(
      payment.customerName || payment.description || `Assinante ${String(payment.customer || '').slice(-6)}`
    ).trim(),
    customerEmail: String(payment.customerEmail || '').trim(),
    externalReference: String(payment.externalReference || '').trim(),
    paymentValue: Number(paymentValue.toFixed(2)),
    commissionValue: Number((Number.isFinite(splitCommission) ? splitCommission : 0).toFixed(2)),
    walletIdMatched: Boolean(matchedSplit),
    nextStatus: isPaid ? 'Ativo' : isCancelled ? 'Cancelado' : 'Pendente',
    shouldCreditCommission: isPaid,
  };
}
