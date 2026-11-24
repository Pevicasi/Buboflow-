import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERRAL_COMMISSION_PERCENT,
  buildReferralStats,
  calculateReferralSplit,
  isValidAsaasWalletId,
  parseAsaasWebhookEvent,
  sanitizeReferralCode,
} from './referrals.ts';

describe('Asaas referral helpers', () => {
  it('validates Asaas UUID Wallet IDs strictly', () => {
    assert.equal(isValidAsaasWalletId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), true);
    assert.equal(isValidAsaasWalletId('A1B2C3D4-E5F6-7890-ABCD-EF1234567890'), true);
    assert.equal(isValidAsaasWalletId('not-a-uuid'), false);
    assert.equal(isValidAsaasWalletId(''), false);
  });

  it('sanitizes referral codes safely', () => {
    assert.equal(sanitizeReferralCode('  João Promo! @2026 '), 'JOAOPROMO2026');
    assert.equal(sanitizeReferralCode('../hack?foo=bar'), 'HACKFOOBAR');
  });

  it('calculates 12% recurring split payload accurately', () => {
    const split = calculateReferralSplit(
      197,
      REFERRAL_COMMISSION_PERCENT,
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    );
    assert.equal(split.percentualValue, 12);
    assert.equal(split.commissionValue, 23.64);
    assert.deepEqual(split.asaasSplitPayload, [
      { walletId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', percentualValue: 12 },
    ]);
  });

  it('aggregates referral KPIs accurately', () => {
    const stats = buildReferralStats(
      [
        {
          id: 'r1',
          name: 'Ana',
          email: 'ana@ex.com',
          planName: 'Pro',
          planValue: 100,
          monthlyCommission: 12,
          totalCommissionPaid: 36,
          status: 'Ativo',
          createdAt: '2026-01-01',
        },
        {
          id: 'r2',
          name: 'Bruno',
          email: 'bruno@ex.com',
          planName: 'Pro',
          planValue: 100,
          monthlyCommission: 12,
          totalCommissionPaid: 0,
          status: 'Pendente',
          createdAt: '2026-02-01',
        },
        {
          id: 'r3',
          name: 'Carla',
          email: 'carla@ex.com',
          planName: 'Pro',
          planValue: 100,
          monthlyCommission: 12,
          totalCommissionPaid: 12,
          status: 'Cancelado',
          createdAt: '2026-01-15',
        },
      ],
      30
    );

    assert.equal(stats.clicks, 30);
    assert.equal(stats.totalReferred, 3);
    assert.equal(stats.activeSubscribers, 1);
    assert.equal(stats.pendingCount, 1);
    assert.equal(stats.cancelledCount, 1);
    assert.equal(stats.totalEarned, 48);
    assert.equal(stats.monthlyRecurringForecast, 12);
    assert.equal(stats.conversionRate, 10);
  });

  it('parses Asaas payment webhook events for confirmed and refunded payments', () => {
    const wallet = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const confirmed = parseAsaasWebhookEvent(
      {
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: 'pay_001',
          customer: 'cus_123',
          customerName: 'Lucas Silva',
          customerEmail: 'lucas@teste.com',
          value: 150,
          split: [{ walletId: wallet, percentualValue: 12, totalValue: 18 }],
        },
      },
      wallet
    );

    assert.ok(confirmed);
    assert.equal(confirmed?.paymentId, 'pay_001');
    assert.equal(confirmed?.commissionValue, 18);
    assert.equal(confirmed?.walletIdMatched, true);
    assert.equal(confirmed?.nextStatus, 'Ativo');
    assert.equal(confirmed?.shouldCreditCommission, true);

    const refunded = parseAsaasWebhookEvent(
      {
        event: 'PAYMENT_REFUNDED',
        payment: { id: 'pay_002', customer: 'cus_123', value: 150 },
      },
      wallet
    );
    assert.ok(refunded);
    assert.equal(refunded?.nextStatus, 'Cancelado');
    assert.equal(refunded?.shouldCreditCommission, false);
  });
});
