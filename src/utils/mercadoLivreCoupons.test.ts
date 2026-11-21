import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEmbeddedCouponDate,
  hasFreshValidCapturedCoupon,
  isCapturedCouponExpiredByAge,
  isCouponDateExpired,
  isFalsePositiveCouponCode,
  isPartnerExclusiveCouponCode,
  resolveEffectiveMlCoupon,
} from './mercadoLivreCoupons.ts';
import { extractCouponFromMessageText } from './affiliateUrlRules.ts';
import { selectProductsForAutoDispatch } from './autoDispatchEngine.ts';
import type { AutoDispatchConfig, Coupon, Product } from '../types.ts';

const NOW_NOV_20_16H_BRT = new Date('2026-11-20T19:00:00.000Z'); // 16:00 BRT on 20/11/2026

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-ml-1',
    title: 'Fone Bluetooth JBL Tune 520BT Preto',
    platform: 'Mercado Livre',
    category: 'Eletrônicos',
    originalPrice: 299,
    discountPrice: 189,
    discountPercent: 37,
    commissionPercent: 8,
    commissionValue: 15.12,
    salesRank: 1,
    originalUrl: 'https://mercadolivre.com/sec/abc123',
    affiliateUrl: 'https://mercadolivre.com/sec/abc123',
    artworkKey: 'airfryer',
    isFavorite: false,
    isPrioritized: false,
    createdAt: '2026-11-20T17:00:00.000Z', // 14:00 BRT (2h ago)
    segment: 'Geral',
    ...overrides,
  };
}

test('isFalsePositiveCouponCode and isPartnerExclusiveCouponCode block invalid and partner codes', () => {
  assert.equal(isFalsePositiveCouponCode('ATIVE'), true);
  assert.equal(isFalsePositiveCouponCode('FICOU'), true);
  assert.equal(isFalsePositiveCouponCode('CLIQUE'), true);
  assert.equal(isFalsePositiveCouponCode('2026'), true);
  assert.equal(isFalsePositiveCouponCode('VOCE10'), false);

  assert.equal(isPartnerExclusiveCouponCode('MELIPROMOBIT'), true);
  assert.equal(isPartnerExclusiveCouponCode('OBRAPROMOBIT'), true);
  assert.equal(isPartnerExclusiveCouponCode('PELANDO15'), true);
  assert.equal(isPartnerExclusiveCouponCode('CUPONOMIA10'), true);
  assert.equal(isPartnerExclusiveCouponCode('VOCE10'), false);
});

test('extractEmbeddedCouponDate & isCouponDateExpired detect expired DDMM coupons accurately', () => {
  const moda = extractEmbeddedCouponDate('MODA1911', NOW_NOV_20_16H_BRT);
  assert.equal(moda?.day, 19);
  assert.equal(moda?.month, 11);
  assert.equal(moda?.label, '19/11');

  assert.equal(extractEmbeddedCouponDate('PROD2026', NOW_NOV_20_16H_BRT), null);
  assert.equal(extractEmbeddedCouponDate('DESC1000', NOW_NOV_20_16H_BRT), null);

  assert.equal(isCouponDateExpired('MODA1911', NOW_NOV_20_16H_BRT).expired, true);
  assert.equal(isCouponDateExpired('LOJASOFICIAIS1911', NOW_NOV_20_16H_BRT).expired, true);
  assert.equal(isCouponDateExpired('TECH1811', NOW_NOV_20_16H_BRT).expired, true);
  assert.equal(isCouponDateExpired('BLACK2011', NOW_NOV_20_16H_BRT).expired, false);

  // Dec -> Jan year wrap-around
  const jan2_2027 = new Date('2027-01-02T15:00:00.000Z');
  assert.equal(isCouponDateExpired('OFF3012', jan2_2027).expired, true);
  assert.equal(isCouponDateExpired('OFF0501', jan2_2027).expired, false);
});

test('extractCouponFromMessageText filters out false positives and partner-exclusive codes', () => {
  assert.equal(
    extractCouponFromMessageText('🔥 Oferta! Cupom: ATIVE no anúncio para ter desconto'),
    undefined
  );
  assert.equal(
    extractCouponFromMessageText('🎟️ Use o cupom: MELIPROMOBIT no carrinho'),
    undefined
  );
  assert.equal(
    extractCouponFromMessageText('Use o cupom: VOCE10 no carrinho'),
    'VOCE10'
  );
});

test('isCapturedCouponExpiredByAge enforces 4-hour TTL and previous-day expiry', () => {
  // 2 hours ago (14:00 BRT -> 16:00 BRT): valid under 4h TTL
  assert.equal(
    isCapturedCouponExpiredByAge('2026-11-20T17:00:00.000Z', 4, NOW_NOV_20_16H_BRT),
    false
  );
  // 5 hours ago (11:00 BRT -> 16:00 BRT): expired under 4h TTL
  assert.equal(
    isCapturedCouponExpiredByAge('2026-11-20T14:00:00.000Z', 4, NOW_NOV_20_16H_BRT),
    true
  );
  // 5 hours ago under 0 (same day): still valid on same day
  assert.equal(
    isCapturedCouponExpiredByAge('2026-11-20T14:00:00.000Z', 0, NOW_NOV_20_16H_BRT),
    false
  );
  // Yesterday 22:00 BRT even if < 24h: always expired
  assert.equal(
    isCapturedCouponExpiredByAge('2026-11-20T01:00:00.000Z', 0, NOW_NOV_20_16H_BRT),
    true
  );
});

test('resolveEffectiveMlCoupon enforces Solutions 1 + 2: 4h TTL and explicit isSiteWide user coupons only', () => {
  const nonSiteWideCoupon: Coupon = {
    id: 'cup-manual-1',
    code: 'GANHEDESCONTO',
    description: 'Itens elegíveis',
    discountText: '25% OFF',
    platform: 'Mercado Livre',
    active: true,
    isAutomatic: false,
    isSiteWide: false,
    isShowcase: false,
    expiresAt: '2026-12-31',
    segment: 'Geral',
  };

  const siteWideCoupon: Coupon = {
    id: 'cup-global-1',
    code: 'GLOBAL10ML',
    description: 'Vale no site inteiro acima de R$ 100',
    discountText: '10% OFF',
    platform: 'Mercado Livre',
    active: true,
    isAutomatic: true,
    isSiteWide: true,
    isShowcase: false,
    minSpend: 100,
    expiresAt: '2026-12-31',
    segment: 'Geral',
  };

  // 1) Keeps fresh original captured coupon within 4h window
  const resFresh = resolveEffectiveMlCoupon({
    product: makeProduct({ couponCode: 'VOCE10', createdAt: '2026-11-20T17:00:00.000Z' }),
    savedCoupons: [nonSiteWideCoupon],
    maxAgeHours: 4,
    now: NOW_NOV_20_16H_BRT,
  });
  assert.equal(resFresh.couponCode, 'VOCE10');
  assert.equal(resFresh.status, 'fresh_captured');

  // 2) Strips captured coupon older than 4h and NEVER applies a non-siteWide coupon
  const resAgedOut = resolveEffectiveMlCoupon({
    product: makeProduct({ couponCode: 'VOCE10', createdAt: '2026-11-20T13:00:00.000Z' }),
    savedCoupons: [nonSiteWideCoupon],
    maxAgeHours: 4,
    now: NOW_NOV_20_16H_BRT,
  });
  assert.equal(resAgedOut.couponCode, undefined);
  assert.equal(resAgedOut.status, 'removed_invalid');

  // 3) Strips expired date coupon MODA1911 and partner coupon MELIPROMOBIT
  const resExpiredDate = resolveEffectiveMlCoupon({
    product: makeProduct({ couponCode: 'MODA1911', createdAt: '2026-11-20T18:30:00.000Z' }),
    savedCoupons: [nonSiteWideCoupon],
    maxAgeHours: 4,
    now: NOW_NOV_20_16H_BRT,
  });
  assert.equal(resExpiredDate.couponCode, undefined);
  assert.equal(resExpiredDate.status, 'removed_invalid');

  const resPartner = resolveEffectiveMlCoupon({
    product: makeProduct({ couponCode: 'MELIPROMOBIT', createdAt: '2026-11-20T18:30:00.000Z' }),
    savedCoupons: [nonSiteWideCoupon],
    maxAgeHours: 4,
    now: NOW_NOV_20_16H_BRT,
  });
  assert.equal(resPartner.couponCode, undefined);
  assert.equal(resPartner.status, 'removed_invalid');

  // 4) Applies explicit isSiteWide coupon when price >= minSpend, skips when < minSpend
  const resSiteWideOk = resolveEffectiveMlCoupon({
    product: makeProduct({ couponCode: undefined, discountPrice: 189 }),
    savedCoupons: [nonSiteWideCoupon, siteWideCoupon],
    maxAgeHours: 4,
    now: NOW_NOV_20_16H_BRT,
  });
  assert.equal(resSiteWideOk.couponCode, 'GLOBAL10ML');
  assert.equal(resSiteWideOk.status, 'applied_sitewide');

  const resSiteWideTooCheap = resolveEffectiveMlCoupon({
    product: makeProduct({ couponCode: undefined, discountPrice: 59 }),
    savedCoupons: [siteWideCoupon],
    maxAgeHours: 4,
    now: NOW_NOV_20_16H_BRT,
  });
  assert.equal(resSiteWideTooCheap.couponCode, undefined);
  assert.equal(resSiteWideTooCheap.status, 'none');
});

test('selectProductsForAutoDispatch prioritizes products with fresh valid coupons (soonest-to-expire first)', () => {
  const noCouponOld = makeProduct({
    id: 'ml-no-coupon',
    title: 'Produto sem cupom',
    couponCode: undefined,
    createdAt: '2026-11-20T18:50:00.000Z', // 10 min ago
  });
  const expiredCouponProd = makeProduct({
    id: 'ml-expired-coupon',
    title: 'Produto com cupom vencido',
    couponCode: 'VOCE10',
    createdAt: '2026-11-20T12:00:00.000Z', // 7h ago (expired!)
  });
  const freshCouponNewer = makeProduct({
    id: 'ml-fresh-newer',
    title: 'Produto com cupom novo (30min)',
    couponCode: 'CUPOMNOVO',
    createdAt: '2026-11-20T18:30:00.000Z', // 30 min ago
  });
  const freshCouponSoonest = makeProduct({
    id: 'ml-fresh-soonest',
    title: 'Produto com cupom prestes a vencer (3h atrás)',
    couponCode: 'CUPOM3H',
    createdAt: '2026-11-20T16:00:00.000Z', // 3h ago (still valid < 4h, expires first!)
  });

  assert.equal(hasFreshValidCapturedCoupon(expiredCouponProd, 4, NOW_NOV_20_16H_BRT), false);
  assert.equal(hasFreshValidCapturedCoupon(freshCouponSoonest, 4, NOW_NOV_20_16H_BRT), true);

  const cfg: AutoDispatchConfig = {
    enabled: true,
    startTime: '00:00',
    endTime: '23:59',
    minIntervalMinutes: 5,
    maxIntervalMinutes: 5,
    minProductsPerRun: 3,
    maxProductsPerRun: 3,
    distribution: {
      Shopee: 0,
      'Mercado Livre': 100,
      Amazon: 0,
      Magalu: 0,
      Netshoes: 0,
      AliExpress: 0,
    },
    sendOrder: 'Mais Recentes',
    mlCouponMaxAgeHours: 4,
    prioritizeCouponProducts: true,
  };

  const picked = selectProductsForAutoDispatch({
    products: [noCouponOld, expiredCouponProd, freshCouponNewer, freshCouponSoonest],
    config: cfg,
    now: NOW_NOV_20_16H_BRT,
  });

  assert.equal(picked.length, 3);
  // 1st: fresh coupon captured 3h ago (soonest to expire)
  assert.equal(picked[0].id, 'ml-fresh-soonest');
  // 2nd: fresh coupon captured 30min ago
  assert.equal(picked[1].id, 'ml-fresh-newer');
  // 3rd: falls back to normal sendOrder (Mais Recentes -> noCouponOld, not expiredCouponProd)
  assert.equal(picked[2].id, 'ml-no-coupon');
});
