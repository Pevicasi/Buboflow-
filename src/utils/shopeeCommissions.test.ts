import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShopeeCommissionAnalytics,
  mapShopeeOrderStatus,
  normalizeShopeeConversionNode,
  parseShopeeSubId,
  resolveShopeeCommissionDateRange,
  summarizeShopeeCommissions,
} from './shopeeCommissions.ts';

describe('resolveShopeeCommissionDateRange', () => {
  const fixedNow = new Date('2026-03-15T17:30:00.000Z');

  it('resolves Ontem in America/Sao_Paulo calendar day', () => {
    const res = resolveShopeeCommissionDateRange({ period: 'Ontem', now: fixedNow });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.range.startDateStr, '2026-03-14');
      assert.equal(res.range.endDateStr, '2026-03-14');
      assert.equal(res.range.endSec - res.range.startSec, 86399);
    }
  });

  it('resolves Mês Atual and Mês Anterior across February', () => {
    const curr = resolveShopeeCommissionDateRange({ period: 'Mês Atual', now: fixedNow });
    assert.equal(curr.ok, true);
    if (curr.ok) {
      assert.equal(curr.range.startDateStr, '2026-03-01');
      assert.equal(curr.range.endDateStr, '2026-03-15');
    }

    const prev = resolveShopeeCommissionDateRange({ period: 'Mês Anterior', now: fixedNow });
    assert.equal(prev.ok, true);
    if (prev.ok) {
      assert.equal(prev.range.startDateStr, '2026-02-01');
      assert.equal(prev.range.endDateStr, '2026-02-28');
    }
  });

  it('validates Personalizado ranges (valid, inverted, >92 days)', () => {
    const valid = resolveShopeeCommissionDateRange({
      period: 'Personalizado',
      startDate: '2026-02-01',
      endDate: '2026-03-10',
      now: fixedNow,
    });
    assert.equal(valid.ok, true);

    const inverted = resolveShopeeCommissionDateRange({
      period: 'Personalizado',
      startDate: '2026-03-12',
      endDate: '2026-03-01',
      now: fixedNow,
    });
    assert.equal(inverted.ok, false);

    const tooLong = resolveShopeeCommissionDateRange({
      period: 'Personalizado',
      startDate: '2025-10-01',
      endDate: '2026-03-01',
      now: fixedNow,
    });
    assert.equal(tooLong.ok, false);
  });
});

describe('normalizeShopeeConversionNode & buildShopeeCommissionAnalytics', () => {
  it('maps Shopee statuses accurately including UNPAID', () => {
    assert.equal(mapShopeeOrderStatus('COMPLETED'), 'Concluído');
    assert.equal(mapShopeeOrderStatus('PENDING'), 'Pendente');
    assert.equal(mapShopeeOrderStatus('CANCELLED'), 'Cancelado');
    assert.equal(mapShopeeOrderStatus('UNPAID'), 'Não pago');
  });

  it('parses utmContent into clean Sub ID labels', () => {
    assert.equal(parseShopeeSubId('----'), 'Não identificado');
    assert.equal(parseShopeeSubId(''), 'Não identificado');
    assert.equal(parseShopeeSubId('zap-grupo1---'), 'zap / grupo1');
  });

  it('matches exact BuboFlow metrics on real Shopee conversionReport payload', () => {
    const n1 = normalizeShopeeConversionNode(
      {
        conversionId: 243882184148333,
        conversionStatus: 'COMPLETED',
        purchaseTime: 1790182984,
        netCommission: '0.8697',
        totalCommission: '0.8697',
        shopeeCommissionCapped: '0.8697',
        sellerCommission: '0',
        utmContent: '----',
        orders: [
          {
            orderId: '260924SNK4BJP2',
            orderStatus: 'COMPLETED',
            items: [
              {
                shopId: 594301568,
                itemId: 23598087634,
                itemName: 'Kit com 125, 250, 375 ou 500 Unidades de Elástico Plástico Silicone',
                itemPrice: '28.99',
                actualAmount: '28.99',
                qty: 1,
                imageUrl: 'https://cf.shopee.com.br/file/sample.jpg',
                itemTotalCommission: '0.8697',
                itemShopeeCommissionCapped: '0.8697',
                itemSellerCommission: '0',
                itemShopeeCommissionRate: '3.00%',
                itemSellerCommissionRate: '0.00%',
                globalCategoryLv1Name: 'Casa e Decoração',
                attributionType: 'ORDERED_IN_SAME_SHOP',
              },
            ],
          },
        ],
      },
      0
    );

    const n2 = normalizeShopeeConversionNode(
      {
        conversionId: 242701948160106,
        conversionStatus: 'CANCELLED',
        purchaseTime: 1789002749,
        netCommission: '0',
        totalCommission: '0',
        shopeeCommissionCapped: '0',
        sellerCommission: '0',
        utmContent: '----',
        orders: [
          {
            orderId: '260910MDQNX2SU',
            orderStatus: 'CANCELLED',
            items: [
              {
                shopId: 709990445,
                itemId: 20705549413,
                itemName: 'Pistola Elétrica Para Pintura',
                itemPrice: '135.9',
                actualAmount: '122.31',
                qty: 1,
                itemTotalCommission: '0',
                globalCategoryLv1Name: 'Casa e Decoração',
                attributionType: 'ORDERED_IN_SAME_SHOP',
              },
            ],
          },
        ],
      },
      1
    );

    const summary = summarizeShopeeCommissions([n1, n2]);
    assert.equal(summary.totalCommission, 0.87);
    assert.equal(summary.totalSalesAmount, 28.99);
    assert.equal(summary.approvedCount, 1);
    assert.equal(summary.cancelledCount, 1);

    const analytics = buildShopeeCommissionAnalytics([n1, n2]);
    assert.equal(analytics.netCommission, 0.87);
    assert.equal(analytics.commissionPerOrder, 0.87);
    assert.equal(analytics.commissionRateOfGmv, 3);
    assert.equal(analytics.validGmv, 28.99);
    assert.equal(analytics.validItemsSold, 1);
    assert.equal(analytics.avgPricePerItem, 28.99);
    assert.equal(analytics.validOrders, 1);
    assert.equal(analytics.invalidOrders, 1);
    assert.equal(analytics.avgTicket, 28.99);
    assert.equal(analytics.realizationRate, 50);
    assert.equal(analytics.statusCounts.completed, 1);
    assert.equal(analytics.statusCounts.cancelled, 1);
    assert.equal(analytics.directSales.sharePercent, 100);
    assert.equal(analytics.indirectSales.sharePercent, 0);
    assert.equal(analytics.composition.shopeeCommission, 0.87);
    assert.equal(analytics.composition.sellerCommission, 0);
    assert.equal(analytics.bySubId[0].subId, 'Não identificado');
    assert.equal(analytics.bySubId[0].commission, 0.87);
    assert.equal(analytics.topProducts[0].qtySold, 1);
    assert.equal(analytics.topProducts[0].totalCommission, 0.87);
    assert.equal(
      analytics.topProducts[0].productUrl,
      'https://shopee.com.br/product/594301568/23598087634'
    );
    assert.equal(analytics.topCategories[0].category, 'Casa e Decoração');
    assert.equal(analytics.topCategories[0].commission, 0.87);
  });
});
