import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPublicTelegramUsername,
  extractTelegramMonitoringMessagesFromUpdates,
  extractTelegramPublicChannelSubscribers,
  extractTelegramPublicChannelTitle,
  normalizeTelegramMonitoringTarget,
  parseTelegramPublicChannelHtml,
} from './telegramMonitoring.ts';

describe('Telegram monitoring target normalization', () => {
  it('parses @username, t.me URLs, t.me/s/ URLs, and numeric chat IDs', () => {
    assert.equal(extractPublicTelegramUsername('@DivulgaTudoOfertas'), 'divulgatudoofertas');
    assert.equal(
      extractPublicTelegramUsername('https://t.me/s/PromosBrasil_OFICIAL'),
      'promosbrasil_oficial'
    );
    assert.equal(extractPublicTelegramUsername('t.me/achadinhos_top?start=1'), 'achadinhos_top');

    const pub = normalizeTelegramMonitoringTarget('https://t.me/AchadosTech');
    assert.deepEqual(pub, {
      type: 'public_channel',
      remoteJid: '@achadostech',
      username: 'achadostech',
      publicFeedUrl: 'https://t.me/s/achadostech',
    });

    const chat = normalizeTelegramMonitoringTarget('-1001987654321');
    assert.deepEqual(chat, {
      type: 'chat_id',
      remoteJid: '-1001987654321',
    });
  });

  it('rejects private invite links and malformed targets', () => {
    assert.equal(normalizeTelegramMonitoringTarget('https://t.me/+AbCdEf12345'), null);
    assert.equal(normalizeTelegramMonitoringTarget('https://t.me/joinchat/AAA'), null);
    assert.equal(normalizeTelegramMonitoringTarget('https://evil.example/canal'), null);
    assert.equal(normalizeTelegramMonitoringTarget('ab'), null);
  });
});

describe('Telegram public channel HTML parser', () => {
  const sampleHtml = `
    <html>
      <head><meta property="og:title" content="Radar Ofertas Brasil – Telegram" /></head>
      <body>
        <div class="tgme_channel_info_header_title"><span>Radar Ofertas Brasil</span></div>
        <div class="tgme_channel_info_counter"><span class="counter_value">14.2K</span><span class="counter_type">subscribers</span></div>

        <div class="tgme_widget_message_wrap js-widget_message_wrap">
          <div class="tgme_widget_message" data-post="radarofertas/105">
            <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn4.telesco.pe/file/photo105.jpg')"></a>
            <div class="tgme_widget_message_text js-message_text">
              Air Fryer Philco 4L por R$ 219,90!<br/>
              <a href="https://mercadolivre.com/sec/abc123">Compre aqui</a>
            </div>
            <a class="tgme_widget_message_inline_button" href="https://s.shopee.com.br/xyz999">Ver na Shopee</a>
          </div>
        </div>

        <div class="tgme_widget_message_wrap js-widget_message_wrap">
          <div class="tgme_widget_message" data-post="radarofertas/104">
            <div class="tgme_widget_message_text js-message_text">
              Tênis Adidas por R$ 199,90 https://amzn.to/3Teste123
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  it('extracts title, subscribers, and posts sorted ascending by postId', () => {
    assert.equal(extractTelegramPublicChannelTitle(sampleHtml, 'radarofertas'), 'Radar Ofertas Brasil');
    assert.equal(extractTelegramPublicChannelSubscribers(sampleHtml), 14200);

    const posts = parseTelegramPublicChannelHtml(sampleHtml, '@RadarOfertas');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].postId, 104);
    assert.deepEqual(posts[0].urls, ['https://amzn.to/3Teste123']);

    assert.equal(posts[1].postId, 105);
    assert.equal(posts[1].channelKey, '@radarofertas');
    assert.equal(posts[1].imageUrl, 'https://cdn4.telesco.pe/file/photo105.jpg');
    assert.deepEqual(posts[1].urls, [
      'https://mercadolivre.com/sec/abc123',
      'https://s.shopee.com.br/xyz999',
    ]);
  });
});

describe('extractTelegramMonitoringMessagesFromUpdates', () => {
  it('extracts group/channel posts with text_link entities and inline buttons while ignoring private DMs', () => {
    const msgs = extractTelegramMonitoringMessagesFromUpdates([
      {
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: 999, type: 'private' },
          text: 'https://s.shopee.com.br/private',
        },
      },
      {
        update_id: 2,
        channel_post: {
          message_id: 22,
          chat: { id: -100555666777, type: 'channel', title: 'Canal Promo', username: 'CanalPromo' },
          caption: 'Oferta imperdível!',
          caption_entities: [{ type: 'text_link', url: 'https://meli.la/promo22' }],
          reply_markup: {
            inline_keyboard: [[{ text: 'Comprar', url: 'https://s.shopee.com.br/btn22' }]],
          },
        },
      },
    ]);

    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].chatId, '-100555666777');
    assert.equal(msgs[0].chatUsername, 'canalpromo');
    assert.deepEqual(msgs[0].urls, ['https://meli.la/promo22', 'https://s.shopee.com.br/btn22']);
  });
});
