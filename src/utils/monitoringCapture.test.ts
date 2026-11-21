import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBrazilDateKey,
  unwrapWaMessageRecursive,
  extractTextAndUrlsFromWaMessage,
  filterOfferCandidateUrls,
  getCanonicalCapturedTodayForGroup,
} from './monitoringCapture.ts';

test('getBrazilDateKey uses America/Sao_Paulo day so 21:42 BRT does not roll over to next day', () => {
  // 2026-11-21T00:42:00Z is 2026-11-20 21:42 in Brazil (UTC-3)
  const lateNightBr = new Date('2026-11-21T00:42:00.000Z');
  assert.equal(getBrazilDateKey(lateNightBr), '2026-11-20');

  // 2026-11-21T03:05:00Z is 2026-11-21 00:05 in Brazil (UTC-3)
  const afterMidnightBr = new Date('2026-11-21T03:05:00.000Z');
  assert.equal(getBrazilDateKey(afterMidnightBr), '2026-11-21');
});

test('unwrapWaMessageRecursive and extractTextAndUrlsFromWaMessage handle nested, edited, and interactive CTA messages', () => {
  const nestedImageMsg = {
    message: {
      ephemeralMessage: {
        message: {
          viewOnceMessageV2: {
            message: {
              imageMessage: {
                caption: '🔥 Oferta relâmpago https://meli.la/1AbCdEf',
              },
            },
          },
        },
      },
    },
  };

  assert.ok(unwrapWaMessageRecursive(nestedImageMsg.message)?.imageMessage);
  const extractedNested = extractTextAndUrlsFromWaMessage(nestedImageMsg);
  assert.deepEqual(extractedNested.urls, ['https://meli.la/1AbCdEf']);

  const interactiveMsg = {
    message: {
      interactiveMessage: {
        header: { title: 'Tênis Nike Revolution' },
        body: { text: 'De R$ 399 por R$ 199' },
        nativeFlowMessage: {
          buttons: [
            {
              name: 'cta_url',
              buttonParamsJson: JSON.stringify({
                display_text: 'Comprar',
                url: 'https://s.shopee.com.br/8AXZEODUrk',
              }),
            },
          ],
        },
      },
    },
  };
  const extractedInteractive = extractTextAndUrlsFromWaMessage(interactiveMsg);
  assert.match(extractedInteractive.text, /Tênis Nike Revolution/);
  assert.deepEqual(extractedInteractive.urls, ['https://s.shopee.com.br/8AXZEODUrk']);

  const editedMsg = {
    message: {
      protocolMessage: {
        editedMessage: {
          extendedTextMessage: {
            text: 'Link corrigido: https://mercadolivre.com/sec/2XyZ123.',
          },
        },
      },
    },
  };
  const extractedEdited = extractTextAndUrlsFromWaMessage(editedMsg);
  assert.deepEqual(extractedEdited.urls, ['https://mercadolivre.com/sec/2XyZ123']);
});

test('filterOfferCandidateUrls skips social/invite/coupon landing links and prioritizes marketplace offers', () => {
  const urls = [
    'https://chat.whatsapp.com/ABC123',
    'https://instagram.com/promos',
    'https://shopee.com.br/m/cupom-de-desconto',
    'https://bit.ly/generic123',
    'https://meli.la/1AbCdEf',
    'https://s.shopee.com.br/9ZZZ123',
  ];
  const filtered = filterOfferCandidateUrls(urls, 3);
  assert.deepEqual(filtered, [
    'https://meli.la/1AbCdEf',
    'https://s.shopee.com.br/9ZZZ123',
    'https://bit.ly/generic123',
  ]);
});

test('getCanonicalCapturedTodayForGroup respects Brazil date rollover cleanly', () => {
  const stats = {
    '120363360755129657@g.us': {
      date: '2026-11-20',
      count: 14,
      lastAt: '2026-11-21T00:30:00.000Z',
    },
  };
  // Still 20/11 at 21:42 BRT
  assert.equal(
    getCanonicalCapturedTodayForGroup(
      '120363360755129657@g.us',
      stats,
      new Date('2026-11-21T00:42:00.000Z')
    ),
    14
  );
  // Resets to 0 at 00:05 BRT on 21/11
  assert.equal(
    getCanonicalCapturedTodayForGroup(
      '120363360755129657@g.us',
      stats,
      new Date('2026-11-21T03:05:00.000Z')
    ),
    0
  );
});
