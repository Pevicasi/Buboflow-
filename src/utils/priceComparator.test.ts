import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductSearchQuery,
  computeProductMatchScore,
  selectBestCheaperOffer,
} from './priceComparator';

test('buildProductSearchQuery removes promotional noise and keeps core model tokens', () => {
  const q = buildProductSearchQuery('[OFERTA] Fone Bluetooth JBL Tune 520BT Preto Original R$ 249,90');
  assert.equal(q, 'fone bluetooth jbl tune 520bt');
});

test('computeProductMatchScore rejects accessories and conflicting storage/voltage specs', () => {
  assert.equal(
    computeProductMatchScore('Smartphone Samsung Galaxy A55 256GB 5G', 'Capa Capinha Samsung Galaxy A55 5G'),
    0
  );
  assert.equal(
    computeProductMatchScore('Smartphone Samsung Galaxy A55 256GB 5G', 'Smartphone Samsung Galaxy A55 128GB 5G'),
    0
  );
  assert.equal(
    computeProductMatchScore('Fritadeira Air Fryer Mondial 5L 220V', 'Fritadeira Air Fryer Mondial 5L 110V'),
    0
  );
  assert.ok(
    computeProductMatchScore(
      'Fone de Ouvido Bluetooth JBL Tune 520BT Preto',
      'Fone Ouvido JBL Tune 520BT Bluetooth Sem Fio'
    ) >= 0.55
  );
});

test('selectBestCheaperOffer picks genuinely cheaper exact match and ignores accessories or tiny differences', () => {
  const original = {
    title: 'Fone de Ouvido Bluetooth JBL Tune 520BT Preto',
    platform: 'Mercado Livre',
    discountPrice: 250,
    originalUrl: 'https://mercadolivre.com.br/jbl-520bt',
  };

  const candidates = [
    // Accessory priced too low (<45% and has "capa")
    {
      title: 'Capa Protetora Case Fone JBL Tune 520BT',
      platform: 'Shopee',
      discountPrice: 39.9,
      originalUrl: 'https://shopee.com.br/capa-520bt',
    },
    // Different model code (720bt instead of 520bt)
    {
      title: 'Fone de Ouvido Bluetooth JBL Tune 720BT',
      platform: 'Shopee',
      discountPrice: 205,
      originalUrl: 'https://shopee.com.br/jbl-720bt',
    },
    // Only 2% cheaper (below 5% threshold)
    {
      title: 'Fone de Ouvido Bluetooth JBL Tune 520BT',
      platform: 'Shopee',
      discountPrice: 245,
      originalUrl: 'https://shopee.com.br/jbl-520bt-a',
    },
    // Genuine cheaper match (20% cheaper)
    {
      title: 'Fone Ouvido Bluetooth JBL Tune 520BT Sem Fio',
      platform: 'Shopee',
      discountPrice: 199.9,
      originalUrl: 'https://shopee.com.br/jbl-520bt-b',
    },
  ];

  const picked = selectBestCheaperOffer(original, candidates, { minSavingsPercent: 5 });
  assert.ok(picked);
  assert.equal(picked.winner.discountPrice, 199.9);
  assert.equal(picked.winner.platform, 'Shopee');
  assert.equal(picked.savingsAmount, 50.1);
  assert.equal(picked.savingsPercent, 20);
});
