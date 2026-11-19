import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function createExtensionPngIcon(size: number): Buffer {
  // Valid RGBA PNG: Mercado Livre warm yellow circle inside emerald badge
  const raw = Buffer.alloc(size * (1 + size * 4));
  const half = size / 2;
  const rOuter = size * 0.47;
  const rInner = size * 0.25;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const dist = Math.hypot(dx, dy);

      if (dist <= rInner) {
        // Warm yellow center (#FACC15)
        raw[px] = 250;
        raw[px + 1] = 204;
        raw[px + 2] = 21;
        raw[px + 3] = 255;
      } else if (dist <= rOuter) {
        // Emerald green badge (#15803D)
        raw[px] = 21;
        raw[px + 1] = 128;
        raw[px + 2] = 61;
        raw[px + 3] = 255;
      } else {
        // Transparent outside
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface ZipEntryInput {
  name: string;
  data: Buffer | string;
}

export function createZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const rawBuf = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, 'utf-8');
    const compressedBuf = zlib.deflateRawSync(rawBuf);
    const fileCrc = crc32(rawBuf);

    // Local File Header (30 bytes + name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(fileCrc, 14);
    localHeader.writeUInt32LE(compressedBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localParts.push(localHeader, nameBuf, compressedBuf);

    // Central Directory Header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(fileCrc, 16);
    centralHeader.writeUInt32LE(compressedBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + compressedBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

export function buildMercadoLivreExtensionZip(options: {
  serverUrl: string;
  extensionKey: string;
  etiqueta: string;
}): Buffer {
  const rawServerUrl = String(options.serverUrl || '').trim().replace(/\/+$/, '');
  const cleanServerUrl = rawServerUrl.replace(/^http:\/\/([^/]+\.run\.app)/i, 'https://$1');
  const cleanKey = String(options.extensionKey || '').trim();
  const cleanTag = String(options.etiqueta || '').trim();

  const hostPerms = [
    'https://*.mercadolivre.com.br/*',
    'https://*.mercadolibre.com/*',
    'https://meli.la/*',
    'https://*.run.app/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ];
  if (cleanServerUrl && !hostPerms.includes(`${cleanServerUrl}/*`)) {
    hostPerms.push(`${cleanServerUrl}/*`);
  }

  const contentMatches = [
    'https://*.run.app/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ];
  if (
    cleanServerUrl &&
    !/^https:\/\/[^/]+\.run\.app$/i.test(cleanServerUrl) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanServerUrl)
  ) {
    contentMatches.push(`${cleanServerUrl}/*`);
  }

  const manifestJson = JSON.stringify(
    {
      manifest_version: 3,
      name: 'Conector Mercado Livre Afiliados',
      version: '1.1.0',
      description:
        'Sincroniza sua sessão do Mercado Livre com o painel e gera links curtos /sec/ automaticamente no PC ou no Lemur Browser (Android).',
      permissions: ['cookies', 'storage', 'alarms', 'activeTab', 'tabs'],
      host_permissions: hostPerms,
      content_scripts: [
        {
          matches: contentMatches,
          all_frames: true,
          run_at: 'document_idle',
          js: ['content_bridge.js'],
        },
      ],
      action: {
        default_popup: 'popup.html',
        default_title: 'Conector Mercado Livre',
        default_icon: {
          '16': 'icon16.png',
          '48': 'icon48.png',
          '128': 'icon128.png',
        },
      },
      background: {
        service_worker: 'background.js',
      },
      icons: {
        '16': 'icon16.png',
        '48': 'icon48.png',
        '128': 'icon128.png',
      },
    },
    null,
    2
  );

  const configJson = JSON.stringify(
    {
      serverUrl: cleanServerUrl,
      extensionKey: cleanKey,
      etiqueta: cleanTag,
    },
    null,
    2
  );

  const contentBridgeJs = `(() => {
  if (window.__buboflowBridgeInstalled) return;
  window.__buboflowBridgeInstalled = true;

  function isBuboFlowPanel() {
    return document.documentElement?.dataset?.buboflowPanel === '1';
  }

  function readPanelConfig() {
    const ds = document.documentElement?.dataset || {};
    return {
      serverUrl: window.location.origin.replace(/\\/+$/, ''),
      extensionKey: String(ds.buboflowMlKey || '').trim(),
      etiqueta: String(ds.buboflowMlTag || '').trim(),
    };
  }

  let announcedReady = false;
  let lastReportedSig = '';

  function announceAndReport(triggerAutoSync) {
    if (!isBuboFlowPanel()) return;
    const cfg = readPanelConfig();
    if (!announcedReady) {
      announcedReady = true;
      window.postMessage(
        { source: 'buboflow-extension', type: 'EXTENSION_READY', version: '1.1.0' },
        '*'
      );
    }
    const sig = cfg.serverUrl + '|' + cfg.extensionKey + '|' + cfg.etiqueta;
    if (cfg.extensionKey && (sig !== lastReportedSig || triggerAutoSync)) {
      lastReportedSig = sig;
      try {
        chrome.runtime.sendMessage(
          {
            type: 'PANEL_DETECTED',
            payload: cfg,
            autoSync: Boolean(triggerAutoSync),
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      } catch {}
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'buboflow-panel') return;

    if (data.type === 'PANEL_CONFIG' || data.type === 'EXTENSION_PING') {
      announcedReady = false;
      announceAndReport(data.type === 'PANEL_CONFIG');
      return;
    }

    if (data.type === 'REQUEST_SYNC') {
      const cfg = readPanelConfig();
      const payload = {
        serverUrl: cfg.serverUrl,
        extensionKey: String(data.extensionKey || cfg.extensionKey || '').trim(),
        etiqueta: String(data.etiqueta || cfg.etiqueta || '').trim(),
      };
      try {
        chrome.runtime.sendMessage({ type: 'SYNC_NOW', payload }, (res) => {
          void chrome.runtime.lastError;
          window.postMessage(
            {
              source: 'buboflow-extension',
              type: 'ML_SYNC_RESULT',
              ok: Boolean(res?.ok),
              hasSsid: Boolean(res?.hasSsid),
              cookiesCount: Number(res?.cookiesCount || 0),
              extensionKey: res?.extensionKey || payload.extensionKey,
              error: res?.error || null,
            },
            '*'
          );
        });
      } catch {}
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isBuboFlowPanel()) {
      return false;
    }

    if (msg?.type === 'GET_PANEL_CONFIG') {
      sendResponse({ ok: true, ...readPanelConfig() });
      return false;
    }

    if (msg?.type === 'RELAY_FETCH') {
      (async () => {
        try {
          const path = String(msg.path || '');
          const res = await fetch(path, {
            method: msg.method || 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: msg.body !== undefined ? JSON.stringify(msg.body) : undefined,
          });
          const contentType = res.headers.get('content-type') || '';
          const text = await res.text();
          let json = null;
          if (contentType.includes('application/json') || text.trim().startsWith('{')) {
            try {
              json = JSON.parse(text);
            } catch {}
          }
          if (!res.ok || !json) {
            sendResponse({
              ok: false,
              status: res.status,
              error:
                json?.error ||
                ('O painel respondeu HTTP ' + res.status + ' (resposta não-JSON).'),
            });
            return;
          }
          if (path.includes('/api/mercadolivre/extension/sync') && json.ok) {
            window.postMessage(
              {
                source: 'buboflow-extension',
                type: 'ML_SYNC_RESULT',
                ok: true,
                hasSsid: Boolean(json.hasSsid),
                cookiesCount: Number(json.cookiesCount || 0),
                extensionKey: json.extensionKey || msg.body?.extensionKey || '',
              },
              '*'
            );
          }
          sendResponse({ ok: true, status: res.status, json });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err?.message || 'Erro de rede ao enviar pelo painel.',
          });
        }
      })();
      return true;
    }

    return false;
  });

  const observer = new MutationObserver(() => {
    if (isBuboFlowPanel()) {
      announceAndReport(false);
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-buboflow-panel', 'data-buboflow-ml-key', 'data-buboflow-ml-tag'],
  });

  setTimeout(() => announceAndReport(true), 250);
  setTimeout(() => announceAndReport(false), 1500);
})();
`;

  const backgroundJs = `const DEFAULT_CONFIG = {
  serverUrl: ${JSON.stringify(cleanServerUrl)},
  extensionKey: ${JSON.stringify(cleanKey)},
  etiqueta: ${JSON.stringify(cleanTag)},
};

let pollTimer = null;

function normalizeServerUrl(raw) {
  let u = String(raw || '').trim().replace(/\\/+$/, '');
  if (!u) return '';
  if (!/^https?:\\/\\//i.test(u)) {
    u = /^(localhost|127\\.0\\.0\\.1)(:\\d+)?/i.test(u) ? 'http://' + u : 'https://' + u;
  }
  // Cloud Run / AI Studio preview URLs always require HTTPS (HTTP redirects break POST)
  u = u.replace(/^http:\\/\\/([^/]+\\.run\\.app)/i, 'https://$1');
  return u;
}

async function getConfig() {
  const stored = await chrome.storage.local.get(['serverUrl', 'extensionKey', 'etiqueta']);
  return {
    serverUrl: normalizeServerUrl(stored.serverUrl || DEFAULT_CONFIG.serverUrl || ''),
    extensionKey: String(stored.extensionKey || DEFAULT_CONFIG.extensionKey || '').trim(),
    etiqueta: String(stored.etiqueta || DEFAULT_CONFIG.etiqueta || '').trim(),
  };
}

async function saveConfig(partial) {
  const cur = await getConfig();
  const next = {
    serverUrl: normalizeServerUrl(
      partial.serverUrl !== undefined ? partial.serverUrl : cur.serverUrl
    ),
    extensionKey: String(
      partial.extensionKey !== undefined ? partial.extensionKey : cur.extensionKey
    ).trim(),
    etiqueta: String(
      partial.etiqueta !== undefined ? partial.etiqueta : cur.etiqueta
    ).trim(),
  };
  await chrome.storage.local.set(next);
  return next;
}

async function rememberPanelFrame(tabId, frameId, cfg) {
  if (typeof tabId !== 'number') return;
  await chrome.storage.local.set({
    lastPanelFrame: {
      tabId,
      frameId: typeof frameId === 'number' ? frameId : 0,
      serverUrl: normalizeServerUrl(cfg?.serverUrl || ''),
      seenAt: Date.now(),
    },
  });
}

function sendTabMessageSafe(tabId, message, frameId) {
  return new Promise((resolve) => {
    try {
      const cb = (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(resp || null);
      };
      if (typeof frameId === 'number') {
        chrome.tabs.sendMessage(tabId, message, { frameId }, cb);
      } else {
        chrome.tabs.sendMessage(tabId, message, cb);
      }
    } catch {
      resolve(null);
    }
  });
}

async function findLivePanelTarget() {
  const stored = await chrome.storage.local.get(['lastPanelFrame']);
  const saved = stored.lastPanelFrame;
  if (saved && typeof saved.tabId === 'number') {
    const ping = await sendTabMessageSafe(
      saved.tabId,
      { type: 'GET_PANEL_CONFIG' },
      saved.frameId
    );
    if (ping?.ok && ping.serverUrl) {
      return {
        tabId: saved.tabId,
        frameId: saved.frameId,
        config: {
          serverUrl: normalizeServerUrl(ping.serverUrl),
          extensionKey: String(ping.extensionKey || '').trim(),
          etiqueta: String(ping.etiqueta || '').trim(),
        },
      };
    }
  }

  try {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const allTabs = await chrome.tabs.query({});
    const seen = new Set();
    const ordered = [...activeTabs, ...allTabs].filter((t) => {
      if (!t || typeof t.id !== 'number' || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    for (const tab of ordered) {
      const ping = await sendTabMessageSafe(tab.id, { type: 'GET_PANEL_CONFIG' });
      if (ping?.ok && ping.serverUrl) {
        const foundCfg = {
          serverUrl: normalizeServerUrl(ping.serverUrl),
          extensionKey: String(ping.extensionKey || '').trim(),
          etiqueta: String(ping.etiqueta || '').trim(),
        };
        await rememberPanelFrame(tab.id, undefined, foundCfg);
        return { tabId: tab.id, frameId: undefined, config: foundCfg };
      }
    }
  } catch {}

  return null;
}

async function postToPanelServer(path, body, serverUrl, liveTarget) {
  const target = liveTarget || (await findLivePanelTarget());
  if (target) {
    const relayed = await sendTabMessageSafe(
      target.tabId,
      { type: 'RELAY_FETCH', path, method: 'POST', body },
      target.frameId
    );
    if (relayed && relayed.ok && relayed.json) {
      return {
        ok: true,
        json: relayed.json,
        via: 'panel_bridge',
        serverUrl: target.config.serverUrl,
      };
    }
  }

  const cleanUrl = normalizeServerUrl(serverUrl);
  if (!cleanUrl) {
    return { ok: false, error: 'URL do painel não configurada.' };
  }

  try {
    const res = await fetch(cleanUrl + path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let json = null;
    if (contentType.includes('application/json') || text.trim().startsWith('{')) {
      try {
        json = JSON.parse(text);
      } catch {}
    }

    if (!res.ok || !json) {
      const isHtml = /<html|<!doctype/i.test(text);
      return {
        ok: false,
        error: isHtml
          ? 'O endereço do painel exigiu login ou expirou (HTTP ' +
            res.status +
            '). Deixe o painel aberto neste navegador e toque em Sincronizar novamente.'
          : json?.error ||
            'Servidor retornou HTTP ' + res.status + '. Verifique a URL do painel.',
      };
    }

    return { ok: true, json, via: 'direct', serverUrl: cleanUrl };
  } catch (err) {
    return {
      ok: false,
      error:
        (err?.message || 'Erro de rede') +
        ' — verifique se a URL do painel começa com https:// e está aberta neste navegador.',
    };
  }
}

async function readMercadoLivreCookies() {
  const [mlBr, mlCom] = await Promise.all([
    chrome.cookies.getAll({ domain: 'mercadolivre.com.br' }).catch(() => []),
    chrome.cookies.getAll({ domain: 'mercadolibre.com' }).catch(() => []),
  ]);
  const map = new Map();
  for (const c of [...mlBr, ...mlCom]) {
    if (!c || !c.name) continue;
    map.set(c.name + '@' + c.domain, c);
  }
  const cookies = Array.from(map.values());
  const byName = new Map();
  for (const c of cookies) {
    if (!byName.has(c.name) || String(c.domain).includes('mercadolivre.com.br')) {
      byName.set(c.name, c.value);
    }
  }
  const cookieHeader = Array.from(byName.entries())
    .map(([k, v]) => k + '=' + v)
    .join('; ');
  const hasSsid = Boolean(
    byName.get('ssid') || byName.get('nsa_session') || byName.get('orguseridp')
  );
  const mlUserId = byName.get('orguseridp') || byName.get('c_ui-user-id') || null;
  return {
    cookieHeader,
    cookiesCount: byName.size,
    hasSsid,
    mlUserId,
  };
}

function extractShortUrlFromJson(data) {
  if (!data) return null;
  const direct =
    data.short_url ||
    data.shortUrl ||
    data.url ||
    data.link ||
    data.affiliate_url ||
    data?.urls?.[0]?.short_url ||
    data?.urls?.[0]?.shortUrl ||
    data?.data?.short_url ||
    data?.data?.urls?.[0]?.short_url;
  if (typeof direct === 'string' && /^https?:\\/\\//i.test(direct)) {
    return direct;
  }
  try {
    const raw = JSON.stringify(data);
    const match = raw.match(/https?:\\/\\/(?:www\\.)?(?:mercadolivre\\.com\\/sec\\/|meli\\.la\\/)[a-zA-Z0-9_-]+/);
    if (match) return match[0];
  } catch {}
  return null;
}

async function createShortLinkInBrowser(targetUrl, overrideTag) {
  const cfg = await getConfig();
  const tag = (overrideTag || cfg.etiqueta || '').trim();
  const cleanUrl = String(targetUrl || '').trim();
  if (!cleanUrl) return { ok: false, error: 'URL vazia.' };

  const endpoints = [
    {
      url: 'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink',
      bodies: [
        { urls: [cleanUrl], tag: tag || undefined },
        { url: cleanUrl, tag: tag || undefined },
      ],
    },
    {
      url: 'https://www.mercadolivre.com.br/afiliados/api/v2/affiliates/createLink',
      bodies: [
        { urls: [cleanUrl], tag: tag || undefined },
        { url: cleanUrl, tag: tag || undefined },
      ],
    },
  ];

  let lastStatus = 0;
  let lastError = '';

  for (const ep of endpoints) {
    for (const body of ep.bodies) {
      try {
        const res = await fetch(ep.url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/plain, */*',
            'x-requested-with': 'XMLHttpRequest',
          },
          body: JSON.stringify(body),
        });
        lastStatus = res.status;
        const text = await res.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {}
        const shortUrl = extractShortUrlFromJson(parsed);
        if (res.ok && shortUrl) {
          return { ok: true, shortUrl };
        }
        lastError = parsed?.message || parsed?.error || ('HTTP ' + res.status);
      } catch (err) {
        lastError = err?.message || 'Falha de rede';
      }
    }
  }

  return {
    ok: false,
    status: lastStatus,
    error:
      lastStatus === 401 || lastStatus === 403
        ? 'Faça login no Mercado Livre Afiliados neste navegador primeiro.'
        : lastError || 'Não foi possível gerar o link curto /sec/.',
  };
}

async function syncSessionWithServer(preferLivePanel = true) {
  let cfg = await getConfig();
  const liveTarget = await findLivePanelTarget();

  if (liveTarget?.config?.serverUrl && preferLivePanel) {
    cfg = await saveConfig({
      serverUrl: liveTarget.config.serverUrl,
      extensionKey: liveTarget.config.extensionKey || cfg.extensionKey,
      etiqueta: liveTarget.config.etiqueta || cfg.etiqueta,
    });
  }

  if (!cfg.serverUrl || !cfg.extensionKey) {
    return {
      ok: false,
      error: 'Abra o painel neste navegador ou preencha a URL (https://...) e a Chave.',
    };
  }

  const cookieData = await readMercadoLivreCookies();
  const payload = {
    extensionKey: cfg.extensionKey,
    etiqueta: cfg.etiqueta,
    cookieHeader: cookieData.cookieHeader,
    cookiesCount: cookieData.cookiesCount,
    hasSsid: cookieData.hasSsid,
    mlUserId: cookieData.mlUserId,
    browserName: navigator.userAgent.includes('Android')
      ? 'Android Extension Browser'
      : 'Desktop Chrome',
    syncedAt: new Date().toISOString(),
  };

  const result = await postToPanelServer(
    '/api/mercadolivre/extension/sync',
    payload,
    cfg.serverUrl,
    liveTarget
  );

  const ok = Boolean(result.ok && result.json?.ok);
  const errorMsg = ok ? null : result.json?.error || result.error || 'Falha ao sincronizar.';

  await chrome.storage.local.set({
    lastSyncAt: new Date().toISOString(),
    lastSyncOk: ok,
    lastSyncError: errorMsg,
    lastSyncServerUrl: result.serverUrl || cfg.serverUrl,
    lastSyncVia: result.via || null,
    lastHasSsid: cookieData.hasSsid,
    lastCookiesCount: cookieData.cookiesCount,
  });

  return {
    ok,
    hasSsid: cookieData.hasSsid,
    cookiesCount: cookieData.cookiesCount,
    mlUserId: cookieData.mlUserId,
    extensionKey: cfg.extensionKey,
    etiqueta: cfg.etiqueta,
    serverUrl: result.serverUrl || cfg.serverUrl,
    via: result.via || null,
    error: errorMsg,
  };
}

async function pollServerBridgeJobs() {
  const cfg = await getConfig();
  if (!cfg.serverUrl || !cfg.extensionKey) return;
  try {
    const liveTarget = await findLivePanelTarget();
    const pollKey = liveTarget?.config?.extensionKey || cfg.extensionKey;
    const pollUrl = liveTarget?.config?.serverUrl || cfg.serverUrl;
    const res = await postToPanelServer(
      '/api/mercadolivre/extension/poll',
      { extensionKey: pollKey },
      pollUrl,
      liveTarget
    );
    if (!res.ok || !res.json) return;
    const json = res.json;
    if (json && json.job && json.job.id && json.job.url) {
      const conv = await createShortLinkInBrowser(json.job.url, json.job.etiqueta);
      await postToPanelServer(
        '/api/mercadolivre/extension/job-result',
        {
          extensionKey: pollKey,
          jobId: json.job.id,
          ok: conv.ok,
          shortUrl: conv.shortUrl || null,
          error: conv.error || null,
        },
        pollUrl,
        liveTarget
      );
    }
  } catch {}
}

function scheduleBridgeHeartbeat() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    void pollServerBridgeJobs();
  }, 4000);
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    serverUrl: normalizeServerUrl(DEFAULT_CONFIG.serverUrl),
    extensionKey: DEFAULT_CONFIG.extensionKey,
    etiqueta: DEFAULT_CONFIG.etiqueta,
    lastSyncOk: false,
    lastSyncError: null,
  });
  chrome.alarms.create('ml_sync_alarm', { periodInMinutes: 1 });
  scheduleBridgeHeartbeat();
  void syncSessionWithServer(true);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('ml_sync_alarm', { periodInMinutes: 1 });
  scheduleBridgeHeartbeat();
  void syncSessionWithServer(true);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ml_sync_alarm') {
    scheduleBridgeHeartbeat();
    void syncSessionWithServer(true);
    void pollServerBridgeJobs();
  }
});

scheduleBridgeHeartbeat();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'PANEL_DETECTED' && msg.payload?.serverUrl) {
      const next = await saveConfig({
        serverUrl: msg.payload.serverUrl,
        extensionKey: msg.payload.extensionKey || undefined,
        etiqueta: msg.payload.etiqueta || undefined,
      });
      await rememberPanelFrame(sender?.tab?.id, sender?.frameId, next);
      if (msg.autoSync) {
        void syncSessionWithServer(true);
      }
      sendResponse({ ok: true, config: next });
      return;
    }

    if (msg?.type === 'GET_STATE') {
      const liveTarget = await findLivePanelTarget();
      if (liveTarget?.config?.serverUrl) {
        await saveConfig({
          serverUrl: liveTarget.config.serverUrl,
          extensionKey: liveTarget.config.extensionKey || undefined,
          etiqueta: liveTarget.config.etiqueta || undefined,
        });
      }
      const cfg = await getConfig();
      const cookies = await readMercadoLivreCookies();
      const meta = await chrome.storage.local.get([
        'lastSyncAt',
        'lastSyncOk',
        'lastSyncError',
        'lastSyncServerUrl',
        'lastSyncVia',
      ]);
      sendResponse({
        ok: true,
        config: cfg,
        cookies,
        meta,
        panelDetected: Boolean(liveTarget),
      });
      return;
    }

    if (msg?.type === 'SAVE_CONFIG') {
      const next = await saveConfig(msg.payload || {});
      sendResponse({ ok: true, config: next });
      return;
    }

    if (msg?.type === 'SYNC_NOW') {
      const liveTarget = await findLivePanelTarget();
      if (msg.payload) {
        await saveConfig(msg.payload);
      }
      // If the live panel is open right behind the popup, prefer its live origin & key when stored ones are stale
      const preferLive = Boolean(liveTarget?.config?.serverUrl);
      const result = await syncSessionWithServer(preferLive);
      void pollServerBridgeJobs();
      sendResponse(result);
      return;
    }

    if (msg?.type === 'CONVERT_URL') {
      const conv = await createShortLinkInBrowser(msg.url, msg.etiqueta);
      sendResponse(conv);
      return;
    }

    sendResponse({ ok: false, error: 'Ação desconhecida' });
  })();
  return true;
});
`;

  const popupHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Conector Mercado Livre</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; padding: 14px; width: 340px; background: #f8fafc; color: #0f172a; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .title { font-size: 14px; font-weight: 700; }
    .badge { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 8px; white-space: nowrap; }
    .ok { background: #dcfce7; color: #166534; }
    .warn { background: #fef3c7; color: #92400e; }
    .err { background: #fee2e2; color: #991b1b; }
    label { display: block; font-size: 11px; font-weight: 600; color: #475569; margin: 8px 0 4px; }
    input { width: 100%; padding: 8px 10px; border-radius: 10px; border: 1px solid #cbd5e1; font-size: 12px; font-family: monospace; }
    button { width: 100%; margin-top: 8px; padding: 10px 12px; border: 0; border-radius: 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .btn-primary { background: #15803d; color: #fff; }
    .btn-primary:disabled { opacity: 0.6; }
    .btn-secondary { background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1; }
    .status { margin-top: 10px; font-size: 11px; line-height: 1.45; padding: 8px 10px; border-radius: 10px; background: #f1f5f9; color: #334155; word-break: break-word; }
    .status.ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .status.err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .link-out { margin-top: 8px; padding: 8px; border-radius: 8px; background: #ecfdf5; border: 1px solid #a7f3d0; font-family: monospace; font-size: 11px; color: #065f46; word-break: break-all; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <div class="title">Conector Mercado Livre</div>
      <span id="mlBadge" class="badge warn">Verificando...</span>
    </div>

    <label for="extensionKey">Chave de Conexão do Painel</label>
    <input id="extensionKey" type="text" placeholder="bbf_..." />

    <label for="etiqueta">Etiqueta de Afiliado</label>
    <input id="etiqueta" type="text" placeholder="ex: vipe6350064" />

    <label for="serverUrl">URL do Painel</label>
    <input id="serverUrl" type="text" placeholder="https://..." />

    <button id="btnSync" class="btn-primary">Sincronizar Sessão Agora</button>
    <button id="btnOpenMl" class="btn-secondary">Abrir Mercado Livre Afiliados</button>
    <button id="btnConvertTab" class="btn-secondary">Converter Link da Aba Atual (/sec/)</button>

    <div id="statusBox" class="status">Carregando sessão...</div>
    <div id="shortOut" class="link-out"></div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
`;

  const popupJs = `const $ = (id) => document.getElementById(id);

function setStatus(text, tone = '') {
  const el = $('statusBox');
  el.textContent = text;
  el.className = 'status' + (tone ? ' ' + tone : '');
}

function updateBadge(hasSsid, cookiesCount) {
  const badge = $('mlBadge');
  if (hasSsid) {
    badge.className = 'badge ok';
    badge.textContent = 'ML Logado (' + cookiesCount + ' cookies)';
  } else {
    badge.className = 'badge warn';
    badge.textContent = 'Faça login no ML';
  }
}

async function init() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!resp || !resp.ok) {
    setStatus('Erro ao iniciar extensão.', 'err');
    return;
  }
  $('extensionKey').value = resp.config.extensionKey || '';
  $('etiqueta').value = resp.config.etiqueta || '';
  $('serverUrl').value = resp.config.serverUrl || '';
  updateBadge(resp.cookies.hasSsid, resp.cookies.cookiesCount);

  if (resp.meta?.lastSyncOk && resp.meta?.lastSyncAt) {
    const sameServer =
      !resp.meta.lastSyncServerUrl ||
      resp.meta.lastSyncServerUrl === resp.config.serverUrl;
    if (sameServer && resp.cookies.hasSsid) {
      setStatus(
        'Sincronizado com o painel às ' +
          new Date(resp.meta.lastSyncAt).toLocaleTimeString('pt-BR') +
          (resp.panelDetected ? ' (Painel detectado automaticamente).' : '.'),
        'ok'
      );
      return;
    }
  }

  if (resp.meta?.lastSyncError) {
    setStatus('Última tentativa falhou: ' + resp.meta.lastSyncError, 'err');
    return;
  }

  if (resp.cookies.hasSsid) {
    setStatus(
      resp.panelDetected
        ? 'Painel e conta ML detectados! Toque em "Sincronizar Sessão Agora".'
        : 'Conta Mercado Livre detectada! Abra o painel neste navegador e toque em "Sincronizar Sessão Agora".'
    );
  } else {
    setStatus('Toque em "Abrir Mercado Livre Afiliados", entre na sua conta e depois toque em "Sincronizar Sessão Agora".');
  }
}

$('btnSync').addEventListener('click', async () => {
  $('btnSync').disabled = true;
  setStatus('Sincronizando cookies e chave com o painel...');
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'SYNC_NOW',
      payload: {
        extensionKey: $('extensionKey').value.trim(),
        etiqueta: $('etiqueta').value.trim(),
        serverUrl: $('serverUrl').value.trim(),
      },
    });
    if (res?.extensionKey) $('extensionKey').value = res.extensionKey;
    if (res?.etiqueta) $('etiqueta').value = res.etiqueta;
    if (res?.serverUrl) $('serverUrl').value = res.serverUrl;
    updateBadge(Boolean(res?.hasSsid), Number(res?.cookiesCount || 0));
    if (res?.ok) {
      setStatus(
        res.hasSsid
          ? 'Conectado e sincronizado com sucesso! O painel já recebeu sua sessão do Mercado Livre.'
          : 'Conectado ao painel, mas o login do Mercado Livre ainda não foi detectado neste navegador.',
        res.hasSsid ? 'ok' : ''
      );
    } else {
      setStatus('Falha ao sincronizar: ' + (res?.error || 'Verifique a URL do painel (https://).'), 'err');
    }
  } catch (err) {
    setStatus('Erro ao comunicar com a extensão: ' + (err?.message || 'recarregue a extensão.'), 'err');
  } finally {
    $('btnSync').disabled = false;
  }
});

$('btnOpenMl').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.mercadolivre.com.br/afiliados/linkbuilder' });
});

$('btnConvertTab').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url || '';
  if (!tabUrl || !/mercadolivre|mercadolibre|meli\\.la/i.test(tabUrl)) {
    setStatus('Abra a página de um produto do Mercado Livre primeiro.');
    return;
  }
  setStatus('Gerando link curto /sec/ com sua conta logada...');
  const res = await chrome.runtime.sendMessage({
    type: 'CONVERT_URL',
    url: tabUrl,
    etiqueta: $('etiqueta').value.trim(),
  });
  if (res?.ok && res.shortUrl) {
    const out = $('shortOut');
    out.style.display = 'block';
    out.textContent = res.shortUrl;
    try {
      await navigator.clipboard.writeText(res.shortUrl);
      setStatus('Link /sec/ gerado e copiado!', 'ok');
    } catch {
      setStatus('Link /sec/ gerado com sucesso!', 'ok');
    }
  } else {
    setStatus(
      res?.error || 'Não foi possível gerar o link /sec/. Verifique se está inscrito no Mercado Livre Afiliados.',
      'err'
    );
  }
});

void init();
`;

  const readmeTxt = `CONECTOR MERCADO LIVRE AFILIADOS v1.1.0 (PC & ANDROID LEMUR BROWSER)
====================================================================

COMO INSTALAR/ATUALIZAR NO CELULAR ANDROID (LEMUR BROWSER):
1. Abra o painel no Lemur Browser e toque em "Baixar Extensão (.zip)".
2. No Lemur Browser, vá em Extensões -> remova a versão antiga (se houver).
3. Ative o "Modo Desenvolvedor", toque em "+ (from .zip/.crx)" e selecione o novo .zip.
4. Volte para a aba do painel — a extensão detecta automaticamente a URL e a Chave ativas!
5. Abra a extensão e toque em "Sincronizar Sessão Agora" (ou clique em "Sincronizar agora" direto no painel).

COMO INSTALAR NO PC (GOOGLE CHROME):
1. Descompacte este arquivo .zip em uma pasta.
2. Acesse chrome://extensions e ative o "Modo do desenvolvedor".
3. Clique em "Carregar sem compactação" e escolha a pasta descompactada.
4. Deixe o painel aberto e clique em "Sincronizar Sessão Agora".
`;

  return createZipBuffer([
    { name: 'manifest.json', data: manifestJson },
    { name: 'config.json', data: configJson },
    { name: 'content_bridge.js', data: contentBridgeJs },
    { name: 'background.js', data: backgroundJs },
    { name: 'popup.html', data: popupHtml },
    { name: 'popup.js', data: popupJs },
    { name: 'README.txt', data: readmeTxt },
    { name: 'icon16.png', data: createExtensionPngIcon(16) },
    { name: 'icon48.png', data: createExtensionPngIcon(48) },
    { name: 'icon128.png', data: createExtensionPngIcon(128) },
  ]);
}
