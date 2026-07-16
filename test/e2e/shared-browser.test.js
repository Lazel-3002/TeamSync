// Ortak Tarayıcı regresyon testi: iki gerçek kullanıcı aynı odada.
//  - Ev sahibi tarayıcıyı açar (onay modalı yok), misafir katıl butonuyla gelir
//  - Gezinme misafire senkronize olur, misafir de gezinebilir (spectate yok)
//  - Yankı fırtınası yok: senkron sonrası hiçbir taraf kendiliğinden yeniden
//    yüklenmez (eskiden did-navigate yankısı sonsuz reload ping-pongu yapardı)
const assert = require('assert');
const http = require('http');
const { spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected, evalJS, waitFor } = require('./lib/harness');

function startLocalSite(port) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><head><title>${req.url}</title></head><body>page ${req.url}</body></html>`);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function armNavCounter(peer) {
  await evalJS(peer.client, `(() => {
    window.__navs = 0;
    const wv = document.getElementById('sb-webview');
    wv.addEventListener('did-navigate', () => window.__navs++);
    wv.addEventListener('did-navigate-in-page', () => window.__navs++);
    return 1;
  })()`);
}

async function navigateVia(peer, url) {
  await evalJS(peer.client, `(() => {
    document.getElementById('sb-url').value = ${JSON.stringify(url)};
    document.getElementById('sb-go').click();
    return 1;
  })()`);
}

function webviewUrlExpr(substr) {
  return `(() => {
    try { return document.getElementById('sb-webview').getURL().includes(${JSON.stringify(substr)}) ? 'yes' : null; }
    catch (e) { return null; }
  })()`;
}

module.exports = async function run() {
  const site = await startLocalSite(9877);
  const a = await spawnPeer({ port: 9307, name: 'SBHost' });
  const b = await spawnPeer({ port: 9308, name: 'SBGuest' });
  try {
    const roomId = await createRoom(a);
    await joinRoom(b, roomId);
    await waitForPeerConnected(a);
    await waitForPeerConnected(b);

    // Spectate kalıntıları tamamen silinmiş olmalı
    for (const p of [a, b]) {
      assert.strictEqual(
        await evalJS(p.client, `document.getElementById('custom-confirm') === null && document.getElementById('sb-overlay') === null`),
        true, 'spectate kalıntısı (custom-confirm / sb-overlay) hâlâ DOM\'da'
      );
    }

    // Ev sahibi tarayıcıyı açar — onay modalı olmadan direkt açılmalı
    await evalJS(a.client, `document.getElementById('act-sb').click(); 1`);
    const hostCardOpen = await waitFor(a.client,
      `!document.getElementById('sb-card').classList.contains('hidden') && state.sb.host === state.myId ? 'yes' : null`,
      10000, 'host sb-card open');
    assert.strictEqual(hostCardOpen, 'yes');

    // Misafirde kart + katıl butonu görünmeli ("others can't come" regresyonu)
    await waitFor(b.client, `!document.getElementById('sb-card').classList.contains('hidden') ? 'yes' : null`, 15000, 'guest sb-card visible');
    await waitFor(b.client, `!!document.querySelector('#sb-card .inactive-overlay button') ? 'yes' : null`, 10000, 'guest join button');
    await evalJS(b.client, `document.querySelector('#sb-card .inactive-overlay button').click(); 1`);
    await waitFor(b.client, `state.sb.joinedActivity ? 'yes' : null`, 5000, 'guest joined');

    // Ev sahibi gezinir -> misafir takip etmeli
    await navigateVia(a, 'http://127.0.0.1:9877/host-page');
    await waitFor(b.client, webviewUrlExpr('/host-page'), 20000, 'guest followed host nav');

    // Yankı fırtınası regresyonu: senkron oturduktan sonra kimse kendiliğinden
    // yeniden yüklenmemeli
    await new Promise(r => setTimeout(r, 3000)); // yönlendirme/senkron otursun
    await armNavCounter(a);
    await armNavCounter(b);
    await new Promise(r => setTimeout(r, 8000));
    const navsA = await evalJS(a.client, `window.__navs`);
    const navsB = await evalJS(b.client, `window.__navs`);
    assert.strictEqual(navsA, 0, `ev sahibi kendiliğinden yenileniyor (8sn'de ${navsA} gezinme)`);
    assert.strictEqual(navsB, 0, `misafir kendiliğinden yenileniyor (8sn'de ${navsB} gezinme)`);

    // Misafir de gezinebilmeli (spectate kaldırıldı) -> ev sahibi takip eder
    await navigateVia(b, 'http://127.0.0.1:9877/guest-page');
    await waitFor(a.client, webviewUrlExpr('/guest-page'), 20000, 'host followed guest nav');

    // Misafir gezinmesi sonrası da sistem durulmalı (ping-pong yok)
    await new Promise(r => setTimeout(r, 3000));
    await armNavCounter(a);
    await armNavCounter(b);
    await new Promise(r => setTimeout(r, 8000));
    const navsA2 = await evalJS(a.client, `window.__navs`);
    const navsB2 = await evalJS(b.client, `window.__navs`);
    assert.strictEqual(navsA2, 0, `misafir gezinmesi sonrası ev sahibi sürekli yenileniyor (${navsA2})`);
    assert.strictEqual(navsB2, 0, `misafir gezinmesi sonrası misafir sürekli yenileniyor (${navsB2})`);

    // Adres çubuğunda yazarken gelen senkron değeri ezmemeli
    await evalJS(b.client, `(() => {
      const u = document.getElementById('sb-url');
      u.focus(); u.value = 'kullanici-yaziyor';
      return 1;
    })()`);
    await navigateVia(a, 'http://127.0.0.1:9877/while-typing');
    await waitFor(b.client, webviewUrlExpr('/while-typing'), 20000, 'guest followed while typing');
    const typedKept = await evalJS(b.client, `document.getElementById('sb-url').value`);
    assert.strictEqual(typedKept, 'kullanici-yaziyor', 'sb-nav adres çubuğundaki yazıyı ezdi');
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
    site.close();
  }
};
