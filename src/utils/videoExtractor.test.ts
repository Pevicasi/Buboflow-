import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEscapedMediaUrl,
  decodeHtmlEntities,
  derivePinterestMp4CandidatesFromHtml,
  detectVideoPlatformLabel,
  extractHtmlRedirectUrl,
  extractMediaFromHtml,
  parseInstagramVideoTarget,
  parseTikTokVideoPath,
  parseYouTubeVideoId,
  pickBestCliptoMp4,
} from './videoExtractor';

describe('videoExtractor helpers', () => {
  it('parses Instagram reel, reels, p, tv, and username-prefixed URLs', () => {
    assert.deepEqual(parseInstagramVideoTarget('https://www.instagram.com/reel/Dd1gQBsCWE8/?igsh=abc'), {
      kind: 'reel',
      shortcode: 'Dd1gQBsCWE8',
    });
    assert.deepEqual(parseInstagramVideoTarget('https://instagram.com/reels/DH3tWudxIKB/'), {
      kind: 'reel',
      shortcode: 'DH3tWudxIKB',
    });
    assert.deepEqual(parseInstagramVideoTarget('https://www.instagram.com/nasa/reel/Dd1gQBsCWE8/'), {
      kind: 'reel',
      shortcode: 'Dd1gQBsCWE8',
    });
    assert.deepEqual(parseInstagramVideoTarget('https://www.instagram.com/p/C8_4vN4xH6p/'), {
      kind: 'p',
      shortcode: 'C8_4vN4xH6p',
    });
    assert.equal(parseInstagramVideoTarget('https://www.instagram.com/accounts/login/'), null);
    assert.equal(parseInstagramVideoTarget('https://evil-instagram.com/reel/Dd1gQBsCWE8/'), null);
  });

  it('parses YouTube watch, Shorts, youtu.be, and embed URLs strictly', () => {
    assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=5s'), 'jNQXAC9IVRw');
    assert.equal(parseYouTubeVideoId('https://youtu.be/kJQP7kiw5Fk?si=abc'), 'kJQP7kiw5Fk');
    assert.equal(parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeVideoId('https://m.youtube.com/watch?v=aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
    assert.equal(parseYouTubeVideoId('https://evil-youtube.com/watch?v=jNQXAC9IVRw'), null);
    assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=short'), null);
    assert.equal(detectVideoPlatformLabel('https://youtu.be/kJQP7kiw5Fk'), 'YouTube');
  });

  it('parses valid TikTok video paths and rejects untrusted hosts or traversal', () => {
    assert.equal(
      parseTikTokVideoPath('https://www.tiktok.com/@tiktok/video/7106594312292453675?is_from_webapp=1'),
      '/@tiktok/video/7106594312292453675'
    );
    assert.equal(parseTikTokVideoPath('https://vm.tiktok.com/t/ZM812345/'), '/t/ZM812345');
    assert.equal(parseTikTokVideoPath('https://evil.com/@tiktok/video/7106594312292453675'), null);
    assert.equal(parseTikTokVideoPath('https://www.tiktok.com/../../etc/passwd'), null);
  });

  it('extracts Shopee br.shp.ee JS transfer redirect (CONFIG.httpUrl) automatically', () => {
    const html = `
      <script>
        var CONFIG={httpUrl:"https:\\/\\/sv.shopee.com.br\\/share-video\\/rCHY-cNbCgC2H8EbAAAAAA==?c=share_web\\u0026pid=sv",deepLinkUrl:"shopeebr:\\/\\/reactPath?navigate_url=https%3A%2F%2Fsv.shopee.com.br%2Fshare-video%2FrCHY-cNbCgC2H8EbAAAAAA%3D%3D"};
      </script>
    `;
    const nextUrl = extractHtmlRedirectUrl(html, 'https://br.shp.ee/slf2o8n6?fromSource=copy_link');
    assert.equal(
      nextUrl,
      'https://sv.shopee.com.br/share-video/rCHY-cNbCgC2H8EbAAAAAA==?c=share_web&pid=sv'
    );
  });

  it('derives Pinterest MP4 candidates from V_720P and HLS m3u8 URLs', () => {
    const html = `
      {"V_HLSV4":{"url":"https://v1.pinimg.com/videos/iht/hls/ab/cd/ef/sample.m3u8"}}
    `;
    const cands = derivePinterestMp4CandidatesFromHtml(html);
    assert.ok(cands.includes('https://v1.pinimg.com/videos/mc/720p/ab/cd/ef/sample.mp4'));
    assert.ok(cands.includes('https://v1.pinimg.com/videos/iht/720p/ab/cd/ef/sample.mp4'));
  });

  it('picks best MP4 stream from Clipto media list prioritizing HD and audio', () => {
    const picked = pickBestCliptoMp4([
      { url: 'https://cdn.example.com/sd.mp4', extension: 'mp4', quality: 'SD', type: 'video' },
      { url: 'https://cdn.example.com/hd.mp4', extension: 'mp4', quality: 'HD', type: 'video' },
      { url: 'https://cdn.example.com/audio.mp3', extension: 'mp3', type: 'audio' },
    ]);
    assert.equal(picked?.url, 'https://cdn.example.com/hd.mp4');
  });

  it('decodes HTML entities and escaped media URLs cleanly', () => {
    assert.equal(
      decodeHtmlEntities('NASA on Instagram: &quot;What&#x27;s up &amp; more&quot;'),
      'NASA on Instagram: "What\'s up & more"'
    );
    assert.equal(
      decodeEscapedMediaUrl('https:\\/\\/cdn.example.com\\/v\\/clip.mp4?a=1\\u0026b=2'),
      'https://cdn.example.com/v/clip.mp4?a=1&b=2'
    );
  });

  it('extracts title, thumbnail, direct MP4, and relative twitter:player:stream', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Oferta Rel&acirc;mpago &quot;Shopee&quot;" />
          <meta property="og:image" content="https://cdn.example.com/thumb.jpg?a=1&amp;b=2" />
          <meta name="twitter:player:stream" content="/videos/Dd1gQBsCWE8/1?audio=1" />
        </head>
      </html>
    `;
    const res = extractMediaFromHtml(html, 'https://www.eeinstagram.com/reel/Dd1gQBsCWE8/');
    assert.equal(res.thumbnailUrl, 'https://cdn.example.com/thumb.jpg?a=1&b=2');
    assert.equal(res.streamPathUrl, 'https://www.eeinstagram.com/videos/Dd1gQBsCWE8/1?audio=1');
    assert.equal(detectVideoPlatformLabel('https://www.instagram.com/reel/Dd1gQBsCWE8/'), 'Instagram Reels');
  });
});
