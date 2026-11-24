import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  WHATSAPP_STATUS_FORMATS,
  buildWhatsAppStatusStorySvg,
  buildWhatsAppStatusTexts,
  normalizeStatusRecipientJids,
} from './whatsappStatusLab';

test('WHATSAPP_STATUS_FORMATS exposes all 6 testable Status options independently', () => {
  const ids = WHATSAPP_STATUS_FORMATS.map((f) => f.id);
  assert.deepEqual(ids, [
    'combo-card-then-link',
    'link-text-card',
    'story-card-photo',
    'raw-photo-caption',
    'combo-raw-then-link',
    'video-plus-link',
  ]);
});

test('buildWhatsAppStatusStorySvg generates valid 1080x1920 SVG convertible to JPEG via sharp', async () => {
  const svg = buildWhatsAppStatusStorySvg({
    title: 'Fritadeira Air Fryer Mondial Digital 4L Preta & Inox',
    platform: 'Mercado Livre',
    originalPrice: 499.9,
    discountPrice: 274.9,
    discountPercent: 45,
    couponCode: 'OFERTA10',
    themeColor: 'emerald',
    calloutText: 'Link clicável no próximo Status ->',
    hasProductPhoto: false,
  });

  assert.ok(svg.includes('1080'));
  assert.ok(svg.includes('1920'));
  assert.ok(svg.includes('45% OFF'));
  assert.ok(svg.includes('CUPOM: OFERTA10'));
  assert.ok(svg.includes('274,90'));
  assert.equal(svg.includes('& Inox'), false); // XML-escaped safely
  assert.ok(svg.includes('&amp; Inox'));

  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.equal(meta.format, 'jpeg');
});

test('buildWhatsAppStatusTexts shields BRL prices and includes clickable link text cleanly', () => {
  const texts = buildWhatsAppStatusTexts({
    title: 'Perfume Issey Miyake 125ml',
    platform: 'Mercado Livre',
    originalPrice: 374.99,
    discountPrice: 337.49,
    discountPercent: 10,
    couponCode: 'MELI10',
    affiliateUrl: 'https://meli.la/2UuezgV',
  });

  assert.equal(texts.fullCaption.replace(/\u2060/g, '').includes('R$ 337,49'), true);
  assert.ok(texts.fullCaption.includes('https://meli.la/2UuezgV'));
  assert.ok(texts.clickableLinkStatusText.includes('https://meli.la/2UuezgV'));
  assert.ok(texts.clickableLinkStatusText.includes('Cupom: *MELI10*'));
  assert.ok(texts.shortCalloutCaption.includes('próximo Status'));
});

test('normalizeStatusRecipientJids normalizes Brazilian phones, strips device suffixes, and excludes group JIDs', () => {
  const list = normalizeStatusRecipientJids({
    selfJids: ['558796801063:15@s.whatsapp.net', '191882730668130:2@lid'],
    rawPhones: ['(87) 99911-2233', '+55 11 98888-7777', '558796801063'],
    extraJids: ['120363000111@g.us', 'status@broadcast', '5511977776666@s.whatsapp.net'],
  });

  assert.deepEqual(list, [
    '558796801063@s.whatsapp.net',
    '191882730668130@lid',
    '5587999112233@s.whatsapp.net',
    '5511988887777@s.whatsapp.net',
    '5511977776666@s.whatsapp.net',
  ]);
});
