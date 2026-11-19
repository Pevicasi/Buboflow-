import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWhatsAppLinkPreviewMeta,
  cleanMarketplaceProductUrl,
  cleanOfferTitle,
  extractCouponFromMessageText,
  extractMercadoLivrePricingFromHtml,
  extractMercadoLivreProductUrlFromHtml,
  extractShopeeIdsFromUrl,
  interleaveOffersByPlatform,
  isOfficialShortAffiliateLink,
  needsAffiliateReconversion,
  sanitizeShopeeOriginUrl,
  sanitizeShopeeSubIds,
} from './affiliateUrlRules';
import {
  computeMemberMonitorSummary,
  detectGroupAdminRole,
  filterOwnerOrAdminGroups,
  formatBuboChurnPct,
  formatChurnRatePct,
  truncateGroupOptionLabel,
} from './memberMonitorAnalytics';
import { getDemoProductForPlatform, renderProductMessage } from './templateEngine';
import {
  buildDynamicToken,
  parseInlineSegments,
  parseTemplateDocument,
  resolveDynamicTokens,
  serializeInlineSegments,
  serializeTemplateDocument,
} from './templateBlocks';
import {
  isWithinDispatchWindow,
  parseTimeToMinutes,
  resolveActiveDispatchTargets,
  selectProductsForAutoDispatch,
} from './autoDispatchEngine';
import { INITIAL_AUTO_DISPATCH, INITIAL_INTEGRATIONS, INITIAL_TEMPLATES } from '../data/initialData';
import sharp from 'sharp';
import {
  getHighResImageCandidateUrls,
  standardizeProductImageBuffer,
} from './imageStandardizer';
import {
  PLATFORM_CYCLE_ORDER,
  offerMatchesSearchPlan,
  offerMatchesTokens,
  parseMercadoLivreCategoriesHtml,
  parsePromobitCategoriesJson,
  parseShopeeCategoryTreeJson,
  pickStrictRoundRobinPage,
  resolveCategorySearchPlan,
} from './catalogCategories';

test('sanitizeShopeeSubIds removes underscores and non-alphanumeric chars', () => {
  assert.deepEqual(sanitizeShopeeSubIds(['whatsapp_vip', 'grupo-01!', '  Promo Top  ']), [
    'whatsappvip',
    'grupo01',
    'PromoTop',
  ]);
  assert.deepEqual(sanitizeShopeeSubIds(['a_1', 'a1', 'b', 'c', 'd', 'e', 'f']), [
    'a1',
    'b',
    'c',
    'd',
    'e',
  ]);
});

test('extractMercadoLivreProductUrlFromHtml pulls featured show_product URL and strips competitor params', () => {
  const html = `
    <script>
      {"type":"action_links","action_links":[{"id":"show_product","type":"link","text":"Ir para produto","url":"https:\\u002F\\u002Fwww.mercadolivre.com.br\\u002Flavadora-mondial\\u002Fp\\u002FMLB19603205?matt_event_ts=1795&matt_tool_id=78072114#polycard_client=recommendations_home_affiliate-profile"}]}
      {"url":"https://www.mercadolivre.com.br/other-reco/p/MLB999999?source=affiliate-profile#c_id=/home/affiliate-profile-recommendations/element"}
    </script>
  `;
  assert.equal(
    extractMercadoLivreProductUrlFromHtml(html),
    'https://www.mercadolivre.com.br/lavadora-mondial/p/MLB19603205'
  );
});

test('extractMercadoLivreProductUrlFromHtml ignores recommendation links when card-featured exists', () => {
  const html = `
    <a href="https://www.mercadolivre.com.br/reco-item/p/MLB111111#c_id=/home/affiliate-profile-recommendations/element">Reco</a>
    <a href="https://www.mercadolivre.com.br/tenis-puma/p/MLB222222?matt_tool_id=78072114#c_id=/home/card-featured/element&amp;wid=MLB555">Featured</a>
  `;
  assert.equal(
    extractMercadoLivreProductUrlFromHtml(html),
    'https://www.mercadolivre.com.br/tenis-puma/p/MLB222222'
  );
});

test('extractShopeeIdsFromUrl and cleanMarketplaceProductUrl canonicalize opaanlp and -i.shop.item URLs', () => {
  const opaaUrl =
    'https://shopee.com.br/opaanlp/123456/789012345?__mobile__=1&gads_t_sig=abc&mmp_pid=an_999&uls_trackid=xyz&utm_source=an_999';
  assert.deepEqual(extractShopeeIdsFromUrl(opaaUrl), {
    shopId: '123456',
    itemId: '789012345',
  });
  assert.equal(
    cleanMarketplaceProductUrl(opaaUrl, 'Shopee'),
    'https://shopee.com.br/product/123456/789012345'
  );

  const seoUrl = 'https://shopee.com.br/Caneca-Gamer-325ml-i.1821431551.58213233379?sp_atk=abc&xptdk=def';
  assert.equal(
    cleanMarketplaceProductUrl(seoUrl, 'Shopee'),
    'https://shopee.com.br/product/1821431551/58213233379'
  );
});

test('needsAffiliateReconversion flags competitor ML social links and unconverted Shopee links', () => {
  assert.equal(
    needsAffiliateReconversion(
      {
        platform: 'Mercado Livre',
        originalUrl: 'https://www.mercadolivre.com.br/social/spacepechinshow?matt_word=busqy&matt_tool=78072114&ref=ABC',
        affiliateUrl: 'https://www.mercadolivre.com.br/social/spacepechinshow?matt_word=busqy&matt_tool=vipe6350064&ref=ABC',
      },
      'vipe6350064'
    ),
    true
  );

  assert.equal(
    needsAffiliateReconversion(
      {
        platform: 'Mercado Livre',
        originalUrl: 'https://www.mercadolivre.com.br/lavadora/p/MLB19603205',
        affiliateUrl: 'https://meli.la/11XgVzZ',
      },
      'vipe6350064'
    ),
    false
  );

  assert.equal(
    needsAffiliateReconversion(
      {
        platform: 'Shopee',
        originalUrl: 'https://s.shopee.com.br/Competitor123',
        affiliateUrl: 'https://s.shopee.com.br/Competitor123',
      }
    ),
    true
  );

  assert.equal(
    needsAffiliateReconversion(
      {
        platform: 'Shopee',
        originalUrl: 'https://shopee.com.br/product/123456/789012345',
        affiliateUrl: 'https://s.shopee.com.br/LouWOMduO',
      }
    ),
    false
  );

  assert.equal(isOfficialShortAffiliateLink('https://meli.la/11XgVzZ', 'Mercado Livre'), true);
  assert.equal(isOfficialShortAffiliateLink('https://mercadolivre.com/sec/2AbCdEf', 'Mercado Livre'), true);
  assert.equal(isOfficialShortAffiliateLink('https://s.shopee.com.br/LouWOMduO', 'Shopee'), true);
});

test('cleanOfferTitle strips trailing price and marketplace suffix', () => {
  assert.equal(
    cleanOfferTitle('Camiseta Nike Sportswear Tee Icon Futura Masculina - R$ 85,49'),
    'Camiseta Nike Sportswear Tee Icon Futura Masculina'
  );
  assert.equal(
    cleanOfferTitle('Fone Bluetooth TWS | Mercado Livre'),
    'Fone Bluetooth TWS'
  );
});

test('extractMercadoLivrePricingFromHtml extracts featured price and ignores recommendation cards', () => {
  const html = `
    <div id="featured">
      {"title":{"text":"Camiseta Nike Sportswear Tee Icon Futura Masculina"},
       "previous_price":{"value":129.99,"currency":"BRL"},
       "current_price":{"value":85.49,"currency":"BRL"},
       "discount_label":{"text":"34% OFF no Pix"},"discount_pct":34}
    </div>
    <div id="affiliate-profile-recommendations">
      {"title":{"text":"Outro Produto Errado"},
       "previous_price":{"value":999.90},"current_price":{"value":10.00},"discount_pct":99}
    </div>
  `;
  const parsed = extractMercadoLivrePricingFromHtml(html);
  assert.equal(parsed.title, 'Camiseta Nike Sportswear Tee Icon Futura Masculina');
  assert.equal(parsed.originalPrice, 129.99);
  assert.equal(parsed.discountPrice, 85.49);
  assert.equal(parsed.discountPercent, 34);
});

test('extractCouponFromMessageText captures coupon code and ignores generic words', () => {
  assert.equal(extractCouponFromMessageText('Use o cupom: MELI30OFF para pagar menos!'), 'MELI30OFF');
  assert.equal(extractCouponFromMessageText('Resgate o cupom aqui no site'), undefined);
});

test('renderProductMessage adds blank line before De:, keeps Shopee coupons block, and supports Enter newlines', () => {
  const mlTemplate = INITIAL_TEMPLATES.find((t) => t.id === 'tpl-ml')!;
  const shopeeTemplate = INITIAL_TEMPLATES.find((t) => t.id === 'tpl-shopee')!;

  assert.equal(shopeeTemplate.body.includes('https://s.shopee.com.br/8AXZEODUrk'), true);

  const discountedMsg = renderProductMessage(
    {
      ...getDemoProductForPlatform('Mercado Livre'),
      title: 'Camiseta Nike Sportswear Tee Icon Futura Masculina - R$ 85,49',
      originalPrice: 129.99,
      discountPrice: 85.49,
      discountPercent: 34,
      affiliateUrl: 'https://meli.la/29frSun',
      couponCode: undefined,
    },
    mlTemplate,
    INITIAL_INTEGRATIONS
  );

  // Blank line between product name and De:, followed by Por: and inline SE (3) % OFF
  assert.match(
    discountedMsg,
    /💥 Camiseta Nike Sportswear Tee Icon Futura Masculina\n\nDe: ~R\$ 129,99~ ❌/
  );
  assert.equal(discountedMsg.includes('- R$ 85,49'), false);
  assert.match(discountedMsg, /\*💸 Por: R\$ 85,49 🔥\*\n34% OFF/);
  assert.match(discountedMsg, /https:\/\/meli\.la\/29frSun/);

  // Legacy template (without [[cond:...]] markers) still works seamlessly via fallback
  const legacyEnterMsg = renderProductMessage(
    {
      ...getDemoProductForPlatform('Mercado Livre'),
      title: 'Produto Teste',
      originalPrice: 200,
      discountPrice: 100,
      discountPercent: 50,
      affiliateUrl: 'https://meli.la/test1',
      couponCode: undefined,
    },
    {
      ...mlTemplate,
      body: '*💸 Por: {{preco_desconto}}* 🔥 {{desconto_pct}}% OFF\n\n🔗 {{link}}',
      conditions: [
        {
          id: 'c1',
          variable: 'cta_ia',
          operator: 'existe',
          thenText: '{{cta_ia}}\n',
          elseText: '💥 {{nome}}\n',
        },
        {
          id: 'c2',
          variable: 'desconto_pct',
          operator: 'maior_que',
          compareValue: 0,
          thenText: 'De: ~{{preco_original}}~ ❌',
        },
      ],
    },
    INITIAL_INTEGRATIONS
  );
  assert.match(legacyEnterMsg, /💥 Produto Teste\n\nDe: ~R\$ 200,00~ ❌/);

  const zeroDiscountMsg = renderProductMessage(
    {
      ...getDemoProductForPlatform('Mercado Livre'),
      title: 'Produto Sem Desconto - R$ 50,00',
      originalPrice: 50,
      discountPrice: 50,
      discountPercent: 0,
      affiliateUrl: 'https://meli.la/abc123',
      couponCode: undefined,
    },
    mlTemplate,
    INITIAL_INTEGRATIONS
  );

  assert.equal(zeroDiscountMsg.includes('0% OFF'), false);
  assert.equal(zeroDiscountMsg.includes('De:'), false);

  const urgentMsg = renderProductMessage(
    {
      ...getDemoProductForPlatform('Shopee'),
      title: 'Fone Bluetooth',
      originalPrice: 100,
      discountPrice: 60,
      discountPercent: 40,
      affiliateUrl: 'https://s.shopee.com.br/Test123',
      couponCode: 'SHOPEE10',
    },
    { ...shopeeTemplate, ctaStyle: 'Urgência' },
    INITIAL_INTEGRATIONS
  );

  assert.match(urgentMsg, /🚨 CORRE! Fone Bluetooth — oferta por tempo limitado!\n\nDe: ~R\$ 100,00~ ❌/);
  assert.match(urgentMsg, /Use o cupom: \*SHOPEE10\*/);
  assert.match(urgentMsg, /🎟️ Resgate Cupons:\nhttps:\/\/s\.shopee\.com\.br\/8AXZEODUrk/);

  assert.match(getDemoProductForPlatform('Mercado Livre').affiliateUrl, /^https:\/\/meli\.la\//);
  assert.match(getDemoProductForPlatform('Shopee').affiliateUrl, /^https:\/\/s\.shopee\.com\.br\//);
});

test('buildWhatsAppLinkPreviewMeta extracts matchedUrl, domain, title, and price description', () => {
  const msg =
    '💥 Camiseta Nike Sportswear\n\nDe: ~R$ 129,99~ ❌\n*💸 Por: R$ 85,49* 🔥 34% OFF\n\n🔗 Compre aqui:\nhttps://meli.la/29frSun';
  const meta = buildWhatsAppLinkPreviewMeta(msg);
  assert.ok(meta);
  assert.equal(meta.matchedUrl, 'https://meli.la/29frSun');
  assert.equal(meta.domain, 'meli.la');
  assert.equal(meta.title, 'Camiseta Nike Sportswear');
  assert.match(meta.description, /R\$ 129,99/);
  assert.match(meta.description, /R\$ 85,49/);
});

test('interleaveOffersByPlatform mixes marketplaces evenly instead of grouping one platform first', () => {
  const mixed = interleaveOffersByPlatform([
    { id: '1', platform: 'Shopee' },
    { id: '2', platform: 'Shopee' },
    { id: '3', platform: 'Shopee' },
    { id: '4', platform: 'Mercado Livre' },
    { id: '5', platform: 'Mercado Livre' },
    { id: '6', platform: 'Amazon' },
  ]);
  assert.deepEqual(
    mixed.map((m) => m.platform),
    ['Shopee', 'Mercado Livre', 'Amazon', 'Shopee', 'Mercado Livre', 'Shopee']
  );
});

test('pickStrictRoundRobinPage cycles strictly 1-by-1 across platforms and preserves cycle cursor across pages', () => {
  const buckets = {
    'Mercado Livre': [
      { id: 'ml-1', platform: 'Mercado Livre' },
      { id: 'ml-2', platform: 'Mercado Livre' },
      { id: 'ml-3', platform: 'Mercado Livre' },
    ],
    Shopee: [
      { id: 'sh-1', platform: 'Shopee' },
      { id: 'sh-2', platform: 'Shopee' },
      { id: 'sh-3', platform: 'Shopee' },
    ],
    Amazon: [
      { id: 'am-1', platform: 'Amazon' },
      { id: 'am-2', platform: 'Amazon' },
      { id: 'am-3', platform: 'Amazon' },
    ],
    Magalu: [
      { id: 'mg-1', platform: 'Magalu' },
      { id: 'mg-2', platform: 'Magalu' },
      { id: 'mg-3', platform: 'Magalu' },
    ],
    AliExpress: [
      { id: 'al-1', platform: 'AliExpress' },
      { id: 'al-2', platform: 'AliExpress' },
      { id: 'al-3', platform: 'AliExpress' },
    ],
    Netshoes: [
      { id: 'nt-1', platform: 'Netshoes' },
      { id: 'nt-2', platform: 'Netshoes' },
      { id: 'nt-3', platform: 'Netshoes' },
    ],
  };

  const page1 = pickStrictRoundRobinPage(buckets, PLATFORM_CYCLE_ORDER, 10, 0);
  assert.deepEqual(
    page1.pageItems.map((i) => i.platform),
    [
      'Mercado Livre',
      'Shopee',
      'Amazon',
      'Magalu',
      'AliExpress',
      'Netshoes',
      'Mercado Livre',
      'Shopee',
      'Amazon',
      'Magalu',
    ]
  );
  assert.equal(page1.nextCycleIndex, 4);

  const page2 = pickStrictRoundRobinPage(
    page1.remainingBuckets,
    PLATFORM_CYCLE_ORDER,
    8,
    page1.nextCycleIndex
  );
  assert.deepEqual(
    page2.pageItems.map((i) => i.platform),
    [
      'AliExpress',
      'Netshoes',
      'Mercado Livre',
      'Shopee',
      'Amazon',
      'Magalu',
      'AliExpress',
      'Netshoes',
    ]
  );
  assert.equal(page2.nextCycleIndex, 0);
});

test('pickStrictRoundRobinPage cleanly repeats over a 3-platform subset when other stores have no offers', () => {
  const subset = {
    'Mercado Livre': [
      { id: 'ml-1', platform: 'Mercado Livre' },
      { id: 'ml-2', platform: 'Mercado Livre' },
    ],
    Shopee: [
      { id: 'sh-1', platform: 'Shopee' },
      { id: 'sh-2', platform: 'Shopee' },
    ],
    Amazon: [
      { id: 'am-1', platform: 'Amazon' },
      { id: 'am-2', platform: 'Amazon' },
    ],
  };

  const p1 = pickStrictRoundRobinPage(subset, PLATFORM_CYCLE_ORDER, 6, 0);
  assert.deepEqual(
    p1.pageItems.map((i) => i.platform),
    ['Mercado Livre', 'Shopee', 'Amazon', 'Mercado Livre', 'Shopee', 'Amazon']
  );
});

test('resolveCategorySearchPlan and offerMatchesTokens map real ML and Shopee categories to effective search terms and slugs', () => {
  const mlPlan = resolveCategorySearchPlan({
    category: 'Celulares e Telefones',
    subcategory: 'Celulares e Smartphones',
  });
  assert.equal(mlPlan.isUnfiltered, false);
  assert.ok(mlPlan.promobitSlugs.includes('smartphones-tablets-e-telefones'));
  assert.equal(
    offerMatchesTokens({ title: 'Smartphone Samsung Galaxy A55 5G 256GB' }, mlPlan.matchTokens),
    true
  );
  assert.equal(
    offerMatchesTokens({ title: 'Jogo de Panelas Tramontina 5 Peças' }, mlPlan.matchTokens),
    false
  );

  const shopeePlan = resolveCategorySearchPlan({
    category: 'Roupas Femininas',
    subcategory: 'Vestidos',
  });
  assert.ok(shopeePlan.primaryTerms.some((t) => t.toLowerCase().includes('vestido')));
  assert.ok(shopeePlan.promobitSlugs.includes('moda-e-calcados-femininos'));
  assert.equal(
    offerMatchesTokens({ title: 'Vestido Midi Floral Manga Curta Feminino' }, shopeePlan.matchTokens),
    true
  );
});

test('live category parsers parse Mercado Livre HTML, Shopee category tree JSON, and Promobit JSON', () => {
  const mlHtml = `
    <div class="categories__container">
      <h2 class="categories__title"><a href="https://www.mercadolivre.com.br/c/celulares-e-telefones">Celulares e Telefones</a></h2>
      <h3 class="categories__subtitle-title">Celulares e Smartphones</h3>
      <h3 class="categories__subtitle-title">Acessórios para Celulares</h3>
    </div>
    <div class="categories__container">
      <h2 class="categories__title"><a href="https://www.mercadolivre.com.br/c/imoveis">Imóveis</a></h2>
      <h3 class="categories__subtitle-title">Casas</h3>
    </div>
  `;
  const mlCats = parseMercadoLivreCategoriesHtml(mlHtml);
  assert.equal(mlCats.length, 1);
  assert.equal(mlCats[0].name, 'Celulares e Telefones');
  assert.deepEqual(
    mlCats[0].subcategories.map((s) => s.name),
    ['Celulares e Smartphones', 'Acessórios para Celulares']
  );

  const shopeeJson = {
    data: {
      category_list: [
        {
          catid: 100017,
          display_name: 'Roupas Femininas',
          children: [
            { catid: 100103, display_name: 'Vestidos' },
            { catid: 100104, display_name: 'Blusas' },
          ],
        },
      ],
    },
  };
  const shpCats = parseShopeeCategoryTreeJson(shopeeJson);
  assert.equal(shpCats.length, 1);
  assert.equal(shpCats[0].name, 'Roupas Femininas');
  assert.deepEqual(
    shpCats[0].subcategories.map((s) => s.name),
    ['Vestidos', 'Blusas']
  );

  const pbJson = {
    categories: [
      {
        category_id: 1,
        category_name: 'Informática',
        category_url: 'informatica',
        subcategories: [{ subcategory_id: 11, subcategory_name: 'Notebooks', subcategory_param: 'notebooks' }],
      },
    ],
  };
  const pbCats = parsePromobitCategoriesJson(pbJson);
  assert.equal(pbCats.length, 1);
  assert.equal(pbCats[0].slug, 'informatica');
  assert.equal(pbCats[0].subcategories[0].name, 'Notebooks');
});

test('templateBlocks parses/serializes inline [[cond:...]] documents, migrates legacy templates, and resolves dynamic chips', () => {
  const shopeeTpl = INITIAL_TEMPLATES.find((t) => t.id === 'tpl-shopee')!;
  const parsed = parseTemplateDocument(shopeeTpl.body, shopeeTpl.conditions);

  const condNodes = parsed.nodes.filter((n) => n.type === 'condition');
  assert.equal(condNodes.length, 3);
  assert.equal(condNodes[0].prefix, '💥 ');
  assert.equal(condNodes[0].condId, 'cond-1');
  assert.equal(condNodes[1].condId, 'cond-2');
  assert.equal(condNodes[2].condId, 'cond-3');

  // Round-trip serialization must preserve exact body and condition order
  const roundTripped = serializeTemplateDocument(parsed.nodes, parsed.conditions);
  assert.equal(roundTripped.body, shopeeTpl.body);
  assert.deepEqual(
    roundTripped.conditions.map((c) => c.id),
    ['cond-1', 'cond-2', 'cond-3']
  );

  // Legacy template without [[cond:...]] migrates into inline nodes (espaco -> blank line)
  const legacyParsed = parseTemplateDocument('*Por {{preco_desconto}}*', [
    { id: 'l1', variable: 'cta_ia', operator: 'existe', thenText: '{{cta_ia}}', elseText: '💥 {{nome}}' },
    { id: 'l-sp', variable: 'espaco', operator: 'sempre', thenText: '' },
    { id: 'l2', variable: 'desconto_pct', operator: 'maior_que', compareValue: 0, thenText: 'De: ~{{preco_original}}~' },
  ]);
  assert.equal(legacyParsed.nodes[0].type, 'condition');
  assert.equal(legacyParsed.nodes[1].type, 'line');
  assert.equal(legacyParsed.nodes[1].type === 'line' ? legacyParsed.nodes[1].text : null, '');
  assert.equal(legacyParsed.nodes[2].type, 'condition');
  assert.equal(legacyParsed.nodes[3].type, 'line');
  assert.equal(legacyParsed.conditions.length, 2);

  // Inline variable & dynamic chip parsing + serialization
  const dynToken = buildDynamicToken(['Corre!', 'Aproveite!']);
  const line = `De: ~{{preco_original}}~ ${dynToken} ❌`;
  const segs = parseInlineSegments(line);
  assert.equal(segs.filter((s) => s.type === 'var').length, 1);
  assert.equal(segs.filter((s) => s.type === 'dynamic').length, 1);
  assert.equal(serializeInlineSegments(segs), line);

  const resolved = resolveDynamicTokens(`🔥 ${dynToken}`, 'prod-seed-1');
  assert.ok(resolved === '🔥 Corre!' || resolved === '🔥 Aproveite!');
});

test('autoDispatchEngine evaluates time windows, respects platform distribution/sendOrder, cycles without repeats, and resolves active groups', () => {
  assert.equal(parseTimeToMinutes('07:30'), 450);
  assert.equal(isWithinDispatchWindow('07:00', '22:00', 12 * 60), true);
  assert.equal(isWithinDispatchWindow('07:00', '22:00', 23 * 60), false);
  // Overnight window (22:00 -> 06:00)
  assert.equal(isWithinDispatchWindow('22:00', '06:00', 23 * 60), true);
  assert.equal(isWithinDispatchWindow('22:00', '06:00', 3 * 60), true);
  assert.equal(isWithinDispatchWindow('22:00', '06:00', 14 * 60), false);

  const sampleProducts = [
    {
      ...getDemoProductForPlatform('Shopee'),
      id: 'p-shp-1',
      title: 'Produto Shopee 1',
      commissionValue: 15,
      isPrioritized: false,
      createdAt: '2026-11-18T10:00:00Z',
    },
    {
      ...getDemoProductForPlatform('Mercado Livre'),
      id: 'p-ml-1',
      title: 'Produto ML Priorizado',
      commissionValue: 45,
      isPrioritized: true,
      createdAt: '2026-11-18T12:00:00Z',
    },
  ];

  // Priorizados Primeiro + 0% distribution picks prioritized product first
  const pickedPriority = selectProductsForAutoDispatch({
    products: sampleProducts,
    config: {
      ...INITIAL_AUTO_DISPATCH,
      minProductsPerRun: 1,
      maxProductsPerRun: 1,
      distribution: { Shopee: 0, 'Mercado Livre': 0, Amazon: 0, Magalu: 0, Netshoes: 0, AliExpress: 0 },
      sendOrder: 'Priorizados Primeiro',
    },
    rng: () => 0.2,
  });
  assert.equal(pickedPriority.length, 1);
  assert.equal(pickedPriority[0].id, 'p-ml-1');

  // After p-ml-1 is already sent, next cycle automatically picks p-shp-1 without repeating
  const pickedSecond = selectProductsForAutoDispatch({
    products: sampleProducts,
    config: {
      ...INITIAL_AUTO_DISPATCH,
      minProductsPerRun: 1,
      maxProductsPerRun: 1,
      distribution: { Shopee: 0, 'Mercado Livre': 0, Amazon: 0, Magalu: 0, Netshoes: 0, AliExpress: 0 },
      sendOrder: 'Priorizados Primeiro',
    },
    recentAutoProductIds: ['p-ml-1'],
    rng: () => 0.2,
  });
  assert.equal(pickedSecond.length, 1);
  assert.equal(pickedSecond[0].id, 'p-shp-1');

  // Active targets resolve from both dispatchGroups and savedGroupPrefs fallback
  const targets = resolveActiveDispatchTargets({
    dispatchGroups: [],
    savedGroupPrefs: {
      'wa:120363000111@g.us': { activeForOffers: true },
      'wa:120363000222@g.us': { activeForOffers: false },
    },
  });
  assert.equal(targets.waGroups.length, 1);
  assert.equal(targets.waGroups[0].remoteJid, '120363000111@g.us');
});

test('getHighResImageCandidateUrls upgrades Mercado Livre, Amazon, and Shopee low-res thumbnails with safe fallbacks', () => {
  const mlCandidates = getHighResImageCandidateUrls(
    'https://http2.mlstatic.com/D_NQ_NP_734419-MLA106986505080_022026-P.webp'
  );
  assert.deepEqual(mlCandidates, [
    'https://http2.mlstatic.com/D_NQ_NP_734419-MLA106986505080_022026-F.webp',
    'https://http2.mlstatic.com/D_NQ_NP_734419-MLA106986505080_022026-O.webp',
    'https://http2.mlstatic.com/D_NQ_NP_734419-MLA106986505080_022026-O.jpg',
    'https://http2.mlstatic.com/D_NQ_NP_734419-MLA106986505080_022026-P.webp',
  ]);

  const amzCandidates = getHighResImageCandidateUrls(
    'https://m.media-amazon.com/images/I/61abc123._AC_SX300_.jpg'
  );
  assert.deepEqual(amzCandidates, [
    'https://m.media-amazon.com/images/I/61abc123._AC_SL1000_.jpg',
    'https://m.media-amazon.com/images/I/61abc123._AC_SX300_.jpg',
  ]);

  const shpCandidates = getHighResImageCandidateUrls(
    'https://down-br.img.susercontent.com/file/br-11134207-7r98o-abc123_tn'
  );
  assert.deepEqual(shpCandidates, [
    'https://down-br.img.susercontent.com/file/br-11134207-7r98o-abc123',
    'https://down-br.img.susercontent.com/file/br-11134207-7r98o-abc123_tn',
  ]);
});

test('standardizeProductImageBuffer produces identical 800x800 uncropped JPEGs across wide, tall, square, and transparent inputs', async () => {
  const inputs = await Promise.all([
    // Ultra-wide (4:1 sunglasses-like WebP)
    sharp({ create: { width: 600, height: 150, channels: 3, background: { r: 20, g: 30, b: 180 } } })
      .webp()
      .toBuffer(),
    // Tall portrait (1:3 sneaker/bottle-like JPEG)
    sharp({ create: { width: 300, height: 900, channels: 3, background: { r: 180, g: 30, b: 20 } } })
      .jpeg()
      .toBuffer(),
    // Square 800x800 JPEG
    sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 20, g: 140, b: 60 } } })
      .jpeg()
      .toBuffer(),
    // Transparent PNG (wide 400x250)
    sharp({ create: { width: 400, height: 250, channels: 4, background: { r: 100, g: 40, b: 200, alpha: 0.9 } } })
      .png()
      .toBuffer(),
  ]);

  for (const buf of inputs) {
    const out = await standardizeProductImageBuffer(buf);
    assert.equal(out.width, 800);
    assert.equal(out.height, 800);
    assert.equal(out.mimetype, 'image/jpeg');
    assert.equal(out.thumbWidth, 192);
    assert.equal(out.thumbHeight, 192);

    const mainMeta = await sharp(out.buffer).metadata();
    assert.equal(mainMeta.format, 'jpeg');
    assert.equal(mainMeta.width, 800);
    assert.equal(mainMeta.height, 800);

    const thumbMeta = await sharp(out.smallThumbBuffer).metadata();
    assert.equal(thumbMeta.format, 'jpeg');
    assert.equal(thumbMeta.width, 192);
    assert.equal(thumbMeta.height, 192);

    // Check top-left margin pixel (5, 5) is clean white (never clipped product bleeding to edge)
    // and center pixel (400, 400) contains the colored product (not blank!)
    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    const cornerIdx = (5 * info.width + 5) * info.channels;
    assert.ok(data[cornerIdx] >= 250 && data[cornerIdx + 1] >= 250 && data[cornerIdx + 2] >= 250);

    const centerIdx = (400 * info.width + 400) * info.channels;
    const isCenterNonWhite =
      data[centerIdx] < 235 || data[centerIdx + 1] < 235 || data[centerIdx + 2] < 235;
    assert.equal(isCenterNonWhite, true);
  }
});

test('autoDispatchEngine strictly alternates 50% Shopee / 50% Mercado Livre without streaks, ignores 0% platforms while stock exists, and drains catalog', () => {
  let pool = [
    ...Array.from({ length: 6 }, (_, i) => ({
      ...getDemoProductForPlatform('Shopee'),
      id: `shp-${i + 1}`,
      title: `Oferta Shopee ${i + 1}`,
      affiliateUrl: `https://s.shopee.com.br/item${i + 1}`,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      ...getDemoProductForPlatform('Mercado Livre'),
      id: `ml-${i + 1}`,
      title: `Oferta ML ${i + 1}`,
      affiliateUrl: `https://meli.la/item${i + 1}`,
    })),
    {
      ...getDemoProductForPlatform('Amazon'),
      id: 'amz-1',
      title: 'Oferta Amazon 1',
      affiliateUrl: 'https://amzn.to/item1',
    },
  ];

  // Simulate historical skew (3 consecutive ML dispatches earlier) — anti-streak + deficit must immediately balance and alternate!
  const sentLogs: any[] = [
    { id: 'sent-auto-prev-3', platform: 'Mercado Livre', title: 'Old ML 3', sentAtIso: new Date().toISOString() },
    { id: 'sent-auto-prev-2', platform: 'Mercado Livre', title: 'Old ML 2', sentAtIso: new Date().toISOString() },
    { id: 'sent-auto-prev-1', platform: 'Mercado Livre', title: 'Old ML 1', sentAtIso: new Date().toISOString() },
  ];

  const config = {
    ...INITIAL_AUTO_DISPATCH,
    minProductsPerRun: 1,
    maxProductsPerRun: 1,
    distribution: {
      Shopee: 50,
      'Mercado Livre': 50,
      Amazon: 0,
      Magalu: 0,
      Netshoes: 0,
      AliExpress: 0,
    },
    sendOrder: 'Aleatório' as const,
  };

  const dispatchedPlatforms: string[] = [];
  for (let cycle = 0; cycle < 10; cycle++) {
    const picked = selectProductsForAutoDispatch({
      products: pool,
      config,
      sentLogs,
      rng: () => 0.3,
    });
    assert.equal(picked.length, 1);
    const prod = picked[0];
    dispatchedPlatforms.push(prod.platform);
    // Simulate removal from Produtos after dispatch + prepending auto log
    pool = pool.filter((p) => p.id !== prod.id);
    sentLogs.unshift({
      id: `sent-auto-run-${cycle}`,
      platform: prod.platform,
      title: prod.title,
      affiliateUrl: prod.affiliateUrl,
      sentAtIso: new Date().toISOString(),
    });
  }

  // Must start with Shopee (since last was ML) and strictly alternate without consecutive repeats!
  assert.deepEqual(dispatchedPlatforms, [
    'Shopee',
    'Mercado Livre',
    'Shopee',
    'Mercado Livre',
    'Shopee',
    'Mercado Livre',
    'Shopee',
    'Mercado Livre',
    'Shopee',
    'Mercado Livre',
  ]);
  // 10 removed from 13 -> 3 remaining (1 Shopee, 1 ML, 1 Amazon)
  assert.equal(pool.length, 3);
  assert.equal(pool.filter((p) => p.platform === 'Amazon').length, 1);
});

test('offerMatchesSearchPlan strictly separates real products from accessories across Notebooks, Smartphones, and Smart TVs while allowing accessory subcategories', () => {
  const notebooksPlan = resolveCategorySearchPlan({
    category: 'Computadores e Acessórios',
    subcategory: 'Notebooks',
  });
  assert.equal(notebooksPlan.strictSubcategory, true);
  assert.ok(notebooksPlan.deepQueryTerms.length >= 6);
  assert.equal(
    offerMatchesSearchPlan({ title: 'Notebook Lenovo IdeaPad 1i Intel Core i5 8GB 512GB SSD', discountPrice: 2399 }, notebooksPlan),
    true
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Apple MacBook Air M2 13" 256GB', discountPrice: 5899 }, notebooksPlan),
    true
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Kit 36 Adesivos Etiquetas Escolar Notebook Caderno', discountPrice: 11.9 }, notebooksPlan),
    false
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Mini Jesus Sentado Decoração', discountPrice: 13.99 }, notebooksPlan),
    false
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Mochila Executiva para Notebook 15.6 Impermeável', discountPrice: 89.9 }, notebooksPlan),
    false
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Base Cooler Suporte Refrigerado para Notebook', discountPrice: 65.0 }, notebooksPlan),
    false
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Smartphone Samsung Galaxy S24 256GB 5G', discountPrice: 3499 }, notebooksPlan),
    false
  );

  const phonesPlan = resolveCategorySearchPlan({
    category: 'Celulares e Dispositivos',
    subcategory: 'Celulares',
  });
  assert.equal(
    offerMatchesSearchPlan({ title: 'Smartphone Samsung Galaxy A55 5G 256GB 8GB RAM', discountPrice: 1699 }, phonesPlan),
    true
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Smartphone realme 16x 5G 256GB', discountPrice: 1499 }, phonesPlan),
    true
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Capinha Silicone Anti-Impacto para Smartphone iPhone 15', discountPrice: 19.9 }, phonesPlan),
    false
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Película Vidro Temperado 3D para Celular Galaxy S24', discountPrice: 14.9 }, phonesPlan),
    false
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Suportes Dobráveis de Mesa para Smartphone', discountPrice: 10.5 }, phonesPlan),
    false
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Carregador Turbo 65W USB-C para Celular', discountPrice: 49.9 }, phonesPlan),
    false
  );

  const tvPlan = resolveCategorySearchPlan({
    category: 'Eletrônicos',
    subcategory: 'Smart TVs',
  });
  assert.equal(
    offerMatchesSearchPlan({ title: 'Smart TV Samsung 50" Crystal UHD 4K', discountPrice: 2199 }, tvPlan),
    true
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Suporte Articulado de Parede para Smart TV 32 a 65', discountPrice: 59.9 }, tvPlan),
    false
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Controle Remoto Compatível Smart TV Samsung 4K', discountPrice: 29.9 }, tvPlan),
    false
  );

  // Accessory subcategories MUST allow accessories!
  const accessoryPlan = resolveCategorySearchPlan({
    category: 'Celulares e Dispositivos',
    subcategory: 'Capas e Películas',
  });
  assert.equal(accessoryPlan.excludedPatterns.length, 0);
  assert.equal(
    offerMatchesSearchPlan({ title: 'Capinha Silicone Anti-Impacto para iPhone 15', discountPrice: 19.9 }, accessoryPlan),
    true
  );

  // Mercado Livre / Shopee primary subcategories that end with "e Acessórios" MUST still enforce strict product rules!
  const mlSmartwatchPlan = resolveCategorySearchPlan({
    category: 'Celulares e Telefones',
    subcategory: 'Smartwatches e Acessórios',
  });
  assert.ok(mlSmartwatchPlan.promobitSubcategorySlugs.includes('smartwatch-smartband'));
  assert.equal(
    offerMatchesSearchPlan({ title: 'Smartwatch Samsung Galaxy Watch7 44mm Bluetooth', discountPrice: 1199 }, mlSmartwatchPlan),
    true
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Pulseira Silicone para Smartwatch Apple Watch', discountPrice: 29.9 }, mlSmartwatchPlan),
    false
  );

  const mlTvPlan = resolveCategorySearchPlan({
    category: 'Eletrônicos, Áudio e Vídeo',
    subcategory: 'Televisores',
  });
  assert.ok(mlTvPlan.promobitSubcategorySlugs.includes('tv'));
  assert.equal(
    offerMatchesSearchPlan({ title: 'LG Smart TV 50UN85 4K NanoCell AI', discountPrice: 2199 }, mlTvPlan),
    true
  );
  assert.equal(
    offerMatchesSearchPlan({ title: 'Suporte Universal para TV 32 a 75 Polegadas', discountPrice: 49.9 }, mlTvPlan),
    false
  );

  // Pure ML accessory subcategory MUST still allow TV mounts/accessories
  const mlTvAccPlan = resolveCategorySearchPlan({
    category: 'Eletrônicos, Áudio e Vídeo',
    subcategory: 'Acessórios para TV',
  });
  assert.equal(mlTvAccPlan.excludedPatterns.length, 0);
  assert.equal(
    offerMatchesSearchPlan({ title: 'Suporte Universal para TV 32 a 75 Polegadas', discountPrice: 49.9 }, mlTvAccPlan),
    true
  );
});

test('sanitizeShopeeOriginUrl unwraps redirects, canonicalizes product URLs, and rejects shorteners/login walls that trigger error 11001', () => {
  // Unwrap buyer/login?next=... into canonical product URL
  assert.equal(
    sanitizeShopeeOriginUrl(
      'https://shopee.com.br/buyer/login?next=https%3A%2F%2Fshopee.com.br%2FProduto-Top-i.12345.67890'
    ),
    'https://shopee.com.br/product/12345/67890'
  );
  // Unwrap universal-link?redir=... into canonical product URL
  assert.equal(
    sanitizeShopeeOriginUrl(
      'https://shopee.com.br/universal-link?redir=https%3A%2F%2Fshopee.com.br%2Fopaanlp%2F111%2F222%3Futm_source%3Dabc'
    ),
    'https://shopee.com.br/product/111/222'
  );
  // Valid non-product Shopee landing page (e.g. coupons) is preserved cleanly
  assert.equal(
    sanitizeShopeeOriginUrl('https://shopee.com.br/m/cupons-diarios#top'),
    'https://shopee.com.br/m/cupons-diarios'
  );
  // Shortener hosts and bare login/verify pages MUST return null (preventing error 11001)
  assert.equal(sanitizeShopeeOriginUrl('https://s.shopee.com.br/7pAbCdEf'), null);
  assert.equal(sanitizeShopeeOriginUrl('https://br.shp.ee/abc123'), null);
  assert.equal(sanitizeShopeeOriginUrl('https://shopee.com.br/buyer/login'), null);
  assert.equal(sanitizeShopeeOriginUrl('https://shopee.com.br/verify/captcha'), null);
  assert.equal(sanitizeShopeeOriginUrl('https://google.com/foo'), null);
});

test('detectGroupAdminRole identifies owner/superadmin/admin via phone JID, BR 9th-digit variant, and @lid while rejecting regular participants', () => {
  const selfIds = ['558796801063:15@s.whatsapp.net', '191882730668130:15@lid'];

  // Superadmin matched via @lid
  assert.deepEqual(
    detectGroupAdminRole(
      {
        owner: '191882730668130@lid',
        participants: [
          { id: '191882730668130@lid', admin: 'superadmin' },
          { id: '5511999999999@s.whatsapp.net', admin: null },
        ],
      },
      selfIds
    ),
    { isOwner: true, isAdmin: true, isOwnerOrAdmin: true }
  );

  // Admin matched via Brazilian 9th-digit phone equivalence (5587996801063 vs 558796801063)
  assert.deepEqual(
    detectGroupAdminRole(
      {
        owner: '5511988887777@s.whatsapp.net',
        participants: [
          { id: '5511988887777@s.whatsapp.net', admin: 'superadmin' },
          { id: '5587996801063@s.whatsapp.net', admin: 'admin' },
        ],
      },
      selfIds
    ),
    { isOwner: false, isAdmin: true, isOwnerOrAdmin: true }
  );

  // Regular participant (admin: null) in third-party group MUST return false
  assert.deepEqual(
    detectGroupAdminRole(
      {
        owner: '5511988887777@s.whatsapp.net',
        participants: [
          { id: '5511988887777@s.whatsapp.net', admin: 'superadmin' },
          { id: '191882730668130@lid', admin: null },
        ],
      },
      selfIds
    ),
    { isOwner: false, isAdmin: false, isOwnerOrAdmin: false }
  );
});

test('formatBuboChurnPct matches exact BuboFlow screenshot calculations (exits / entries * 100)', () => {
  assert.equal(formatBuboChurnPct(4, 6).label, '66.7%');
  assert.equal(formatBuboChurnPct(5, 8).label, '62.5%');
  assert.equal(formatBuboChurnPct(7, 6).label, '116.7%');
  assert.equal(formatBuboChurnPct(1, 0).label, '0%');
  assert.equal(formatBuboChurnPct(1, 7).label, '14.3%');
  assert.equal(formatBuboChurnPct(3, 3).label, '100%');
  assert.equal(formatChurnRatePct(4, 6).label, '66.7%');
});

test('computeMemberMonitorSummary strictly filters to owner/admin groups, supports Personalizado range, and computes BuboFlow rolling metrics', () => {
  const now = new Date(2026, 10, 19, 12, 0, 0); // 2026-11-19 (Thursday = weekday 4)
  const groups: any[] = [
    {
      id: 'g1',
      name: 'Meu Grupo VIP Ofertas',
      channel: 'WhatsApp',
      remoteJid: '120363429566277668@g.us',
      membersCount: 1024,
      activeForOffers: true,
      isOwner: true,
      isAdmin: true,
      isOwnerOrAdmin: true,
    },
    {
      id: 'g2',
      name: 'Grupo automação',
      channel: 'WhatsApp',
      remoteJid: '120363430908374507@g.us',
      membersCount: 3,
      activeForOffers: true,
      isOwner: false,
      isAdmin: true,
      isOwnerOrAdmin: true,
    },
    {
      id: 'g3-third-party',
      name: 'Grupo de Terceiros (Apenas Participante)',
      channel: 'WhatsApp',
      remoteJid: '120363404987922345@g.us',
      membersCount: 963,
      activeForOffers: false,
      isOwner: false,
      isAdmin: false,
      isOwnerOrAdmin: false,
    },
  ];

  // filterOwnerOrAdminGroups excludes third-party participant group
  assert.deepEqual(
    filterOwnerOrAdminGroups(groups).map((g) => g.id),
    ['g1', 'g2']
  );

  const events = [
    { date: '2026-11-19', weekday: 4, groupJid: '120363429566277668@g.us', entries: 6, exits: 4 },
    // Third-party group event MUST be ignored when onlyOwnerOrAdmin is true
    { date: '2026-11-19', weekday: 4, groupJid: '120363404987922345@g.us', entries: 50, exits: 20 },
    { date: '2026-11-18', weekday: 3, groupJid: '120363429566277668@g.us', entries: 10, exits: 2 },
  ];

  // All owned/admin groups, Hoje
  const todaySummary = computeMemberMonitorSummary({
    groups,
    memberEvents: events,
    selectedGroupId: 'all',
    period: 'Hoje',
    now,
  });
  assert.equal(todaySummary.ownedGroupsCount, 2);
  assert.equal(todaySummary.totalGroups, 2);
  assert.equal(todaySummary.totalParticipants, 1027); // 1024 + 3 (excludes 963 third-party)
  assert.equal(todaySummary.todayStats.entries, 6);
  assert.equal(todaySummary.todayStats.exits, 4);
  assert.equal(todaySummary.todayStats.net, 2);
  assert.equal(todaySummary.todayStats.churnLabel, '66.7%');
  assert.equal(todaySummary.dailyFlow[todaySummary.dailyFlow.length - 1].total, 1027);
  // Day before (18/11) reconstructed: 1027 - (+2 on 19/11) = 1025
  assert.equal(todaySummary.dailyFlow[todaySummary.dailyFlow.length - 2].total, 1025);
  // Day before 18/11 (17/11): 1025 - (+8 on 18/11) = 1017
  assert.equal(todaySummary.dailyFlow[todaySummary.dailyFlow.length - 3].total, 1017);
  // 7-day rolling averages are populated on every daily point
  assert.ok(todaySummary.dailyFlow.every((d) => Number.isFinite(d.movingAvg7d) && Number.isFinite(d.churnAvg7d)));

  // Period switch: Ontem scopes strictly to 2026-11-18 (+10 / -2 = +8, churn 20%)
  const yesterdaySummary = computeMemberMonitorSummary({
    groups,
    memberEvents: events,
    selectedGroupId: 'all',
    period: 'Ontem',
    now,
  });
  assert.equal(yesterdaySummary.periodStats.entries, 10);
  assert.equal(yesterdaySummary.periodStats.exits, 2);
  assert.equal(yesterdaySummary.periodStats.net, 8);
  assert.equal(yesterdaySummary.periodStats.churnLabel, '20%');
  assert.equal(yesterdaySummary.dailyFlow[yesterdaySummary.dailyFlow.length - 1].dateKey, '2026-11-18');
  assert.equal(yesterdaySummary.dailyFlow[yesterdaySummary.dailyFlow.length - 1].total, 1025);

  // Personalizado custom range (17/11 -> 19/11 = 3 days)
  const customSummary = computeMemberMonitorSummary({
    groups,
    memberEvents: events,
    selectedGroupId: 'g1',
    period: 'Personalizado',
    customStartDate: '2026-11-17',
    customEndDate: '2026-11-19',
    now,
  });
  assert.equal(customSummary.totalGroups, 1);
  assert.equal(customSummary.totalParticipants, 1024);
  assert.equal(customSummary.dailyFlow.length, 3);
  assert.equal(customSummary.periodStats.entries, 16);
  assert.equal(customSummary.periodStats.exits, 6);
  assert.equal(customSummary.periodStats.net, 10);
  assert.equal(customSummary.periodStats.churnLabel, '37.5%');

  // Per-group breakdown sorted by membersCount desc and includes role flags
  assert.deepEqual(
    todaySummary.perGroupBreakdown.map((g) => ({ id: g.id, isOwner: g.isOwner, isAdmin: g.isAdmin })),
    [
      { id: 'g1', isOwner: true, isAdmin: true },
      { id: 'g2', isOwner: false, isAdmin: true },
    ]
  );

  // Option truncation keeps mobile <select> compact
  assert.ok(truncateGroupOptionLabel(groups[2].name, 36).length <= 36);
});



