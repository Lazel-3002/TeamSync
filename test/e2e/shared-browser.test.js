// Ortak Tarayıcı regresyon testi: iki gerçek kullanıcı aynı odada.
//  - Ev sahibi tarayıcıyı açar (onay modalı yok), misafir katıl butonuyla gelir
//  - Gezinme misafire senkronize olur, misafir de gezinebilir (spectate yok)
//  - Yankı fırtınası yok: senkron sonrası hiçbir taraf kendiliğinden yeniden
//    yüklenmez (eskiden did-navigate yankısı sonsuz reload ping-pongu yapardı)
const assert = require('assert');
const http = require('http');
const { spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected, evalJS, waitFor } = require('./lib/harness');

// Gerçek medya çözme gerektirmeyen, JS ile kontrol edilebilir sahte bir
// <video> elemanı: sb-video-sync döngüsü sadece document.querySelector('video')
// üzerinden currentTime/paused okur/yazar, gerçek bir medya dosyasına ihtiyaç yok.
const FAKE_VIDEO_PAGE = `<html><body>
<div id="adbox"></div>
<video id="v"></video>
<script>
  const v = document.getElementById('v');
  let t = 0;
  let paused = false;
  Object.defineProperty(v, 'currentTime', { get: () => t, set: (val) => { t = val; } });
  Object.defineProperty(v, 'paused', { get: () => paused, configurable: true });
  v.play = () => { paused = false; return Promise.resolve(); };
  v.pause = () => { paused = true; };
  setInterval(() => { if (!paused) t += 1; }, 1000);
  window.__getT = () => t;
  window.__isPaused = () => paused;
</script>
</body></html>`;

function startLocalSite(port) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    if (req.url.startsWith('/fake-video')) {
      res.end(FAKE_VIDEO_PAGE);
    } else {
      res.end(`<html><head><title>${req.url}</title></head><body>page ${req.url}</body></html>`);
    }
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

    // sb-webview'de statik bir src="..." OLMAMALI. Böyle bir attribute varsa,
    // webview daha kimse Ortak Tarayıcı'yı açmadan HEMEN gerçek bir internet
    // isteği başlatır; host/misafir kısa süre sonra webview'i başka bir
    // adrese yönlendirirse, gecikmiş "varsayılan sayfa yüklendi" olayı bizim
    // gezinmemizin üstüne binip onu sessizce geçersiz kılabiliyordu (herkes
    // farklı sayfalarda kalıyordu, hiçbir hata/log olmadan). Varsayılan sayfa
    // artık SADECE kullanıcı Ortak Tarayıcı'yı gerçekten açtığında, kontrollü
    // bir şekilde JS ile yükleniyor (initSharedBrowser'daki act-sb host dalı).
    for (const p of [a, b]) {
      assert.strictEqual(
        await evalJS(p.client, `document.getElementById('sb-webview').getAttribute('src')`),
        null,
        'sb-webview statik bir src attribute\'üne sahip - bu, ilk gezinmeyle yarışan gizli bir arka plan yüklemesi başlatıp senkronu bozabilir'
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

    // 7/24 katılım: misafir Kapat'a basar -> SADECE kendisi çıkar, host'un
    // oturumu yaşamaya devam eder (eskiden herkesinki kapanıyordu)
    await evalJS(b.client, `document.getElementById('sb-close').click(); 1`);
    await new Promise(r => setTimeout(r, 2000));
    assert.strictEqual(
      await evalJS(b.client, `document.getElementById('sb-card').classList.contains('hidden')`),
      true, 'misafir Kapat sonrası kendi kartı kapanmadı');
    assert.strictEqual(
      await evalJS(a.client, `document.getElementById('sb-card').classList.contains('hidden')`),
      false, 'misafirin Kapat\'ı host\'un oturumunu da kapattı');

    // Host'un 5 sn'lik sb-state beacon'ı misafire host'u ve güncel adresi
    // yeniden öğretir -> Aktiviteler'den her an tekrar katılabilir
    const hostId = await evalJS(a.client, `state.myId`);
    await waitFor(b.client, `state.sb.host === ${JSON.stringify(hostId)} ? 'yes' : null`, 15000, 'beacon host bilgisini getirdi');
    await evalJS(b.client, `document.getElementById('act-sb').click(); 1`);
    await waitFor(b.client, `!document.getElementById('sb-card').classList.contains('hidden') && state.sb.joinedActivity ? 'yes' : null`, 10000, 'misafir yeniden katıldı');
    await waitFor(b.client, webviewUrlExpr('/while-typing'), 20000, 'misafir yeniden katılınca güncel sayfaya geldi');

    // Geç katılan video senkronu: video senkron döngüsü sadece oynatma durumu
    // ÖNCEKİ ölçüme göre DEĞİŞTİĞİNDE yayın yapar (sürekli oynayan bir videoda
    // durum hemen hemen hiç değişmez). Host'un videosu bir süredir oynarken
    // (yayın durmuş/stabilize olmuşken) katılan biri bu yüzden host bir
    // sonraki duraklat/oynat/atlama yapana kadar HİÇ senkronlanamıyor, videoyu
    // baştan/yanlış bir noktadan izliyordu. sb-joined mesajı bunu düzeltir.
    await navigateVia(a, 'http://127.0.0.1:9877/fake-video');
    await waitFor(b.client, webviewUrlExpr('/fake-video'), 20000, 'misafir sahte-video sayfasına geldi');
    await evalJS(b.client, `document.getElementById('sb-close').click(); 1`); // misafir çıkar, host oynatmaya devam eder
    await new Promise(r => setTimeout(r, 6000)); // host'un videosu bir süre "oynasın", lastVideoState stabilize olsun
    const hostTBeforeRejoin = await evalJS(a.client, `document.getElementById('sb-webview').executeJavaScript("window.__getT()")`, true);
    await evalJS(b.client, `document.getElementById('act-sb').click(); 1`); // misafir geç katılır (sb-joined tetiklenir)
    await waitFor(b.client, webviewUrlExpr('/fake-video'), 20000, 'misafir geç katılınca video sayfasına geldi');
    await new Promise(r => setTimeout(r, 3000)); // sb-joined -> lastVideoState sıfırlama -> bir sonraki 1sn'lik tık round-trip'i
    const guestT = await evalJS(b.client, `document.getElementById('sb-webview').executeJavaScript("window.__getT()")`, true);
    const hostTNow = await evalJS(a.client, `document.getElementById('sb-webview').executeJavaScript("window.__getT()")`, true);
    assert.ok(Math.abs(guestT - hostTNow) <= 3,
      `geç katılan misafir host'un video pozisyonuna senkronlanmadı: misafir=${guestT} host(katılım öncesi)=${hostTBeforeRejoin} host(şimdi)=${hostTNow}`);

    // Misafir de video durumunu yayınlayabilmeli (sadece host değil): misafir
    // videoyu durdurunca host'takinin de durması lazım. Eskiden video-sync
    // sadece host'tan yayınlanıyordu; bir misafirin durdur/oynat aksiyonu
    // hiçbir yere gitmiyordu, üstelik host'un rutin senkron yayını misafirin
    // KENDİ duraklatmasını bile geri açabiliyordu.
    await evalJS(b.client, `document.getElementById('sb-webview').executeJavaScript("document.getElementById('v').pause()")`, true);
    await new Promise(r => setTimeout(r, 3000));
    const hostPausedAfterGuestPause = await evalJS(a.client, `document.getElementById('sb-webview').executeJavaScript("window.__isPaused()")`, true);
    assert.strictEqual(hostPausedAfterGuestPause, true,
      'misafirin video durdurması host\'a hiç yansımadı (video-sync hâlâ sadece host\'tan mı yayınlanıyor?)');
    // Devam eden testler için tekrar oynat
    await evalJS(b.client, `document.getElementById('sb-webview').executeJavaScript("document.getElementById('v').play()")`, true);
    await new Promise(r => setTimeout(r, 2000));

    // Reklam sırasında video-sync YAYINLANMAMALI/UYGULANMAMALI: reklamın
    // kendi zaman çizelgesi asıl içerikle alakasız bir referans. Eskiden
    // ad-skip'in çılgınca ileri sardığı reklam zamanı "gerçek video pozisyonu"
    // sanılıp diğer tarafa yayınlanıyordu — reklamı görmeyen taraf o anlamsız
    // zamana ışınlanıyordu ("reklam gören geride/ileride kalıyor" şikayeti).
    const guestTBeforeAd = await evalJS(b.client, `document.getElementById('sb-webview').executeJavaScript("window.__getT()")`, true);
    await evalJS(a.client, `document.getElementById('sb-webview').executeJavaScript(\`
      document.getElementById('adbox').className = 'ad-showing';
      document.getElementById('v').currentTime = 9999;
    \`)`, true);
    await new Promise(r => setTimeout(r, 3000));
    const guestTDuringAd = await evalJS(b.client, `document.getElementById('sb-webview').executeJavaScript("window.__getT()")`, true);
    assert.ok(guestTDuringAd < guestTBeforeAd + 20,
      `host'un reklam süresi (9999) misafire sızdı, misafir anlamsız bir zamana ışınlandı: ${guestTDuringAd}`);
    await evalJS(a.client, `document.getElementById('sb-webview').executeJavaScript(\`document.getElementById('adbox').className = '';\`)`, true);

    // Yankı-bastırma penceresi (2.5sn) YALNIZCA gerçek uzak-senkron
    // yankısını susturmalı — bir senkron az önce oturduktan hemen sonra
    // sayfadaki bir linke tıklanırsa (page-initiated navigation, will-navigate
    // ile işaretlenir) bu bastırmadan MUAF olmalı. Eskiden herhangi bir yerel
    // gezinme bu pencereye denk gelirse sessizce yayınlanmıyordu ve tıklayan
    // kişi kimseye haber vermeden farklı bir sayfada tek başına kalıyordu.
    await navigateVia(a, 'http://127.0.0.1:9877/click-sync-landing');
    await waitFor(b.client, webviewUrlExpr('/click-sync-landing'), 20000, 'guest senkrona indi');
    await evalJS(b.client, `
      document.getElementById('sb-webview').executeJavaScript("window.location.href = 'http://127.0.0.1:9877/click-after-sync';")
    `, true);
    await waitFor(a.client, webviewUrlExpr('/click-after-sync'), 10000,
      'host, senkrondan hemen sonra misafirin linke tıklamasını görmedi (bastırma penceresi gerçek tıklamayı da yutuyor)');

    // Eş-zamanlı çakışan gezinme yarışı: host ve misafir neredeyse aynı anda
    // farklı adreslere giderse (host->/race-host, misafir->/race-guest),
    // damgasız (ts'siz) eski koddaki mesaj-varış-sırasına bağlı çözüm iki
    // tarafı KALICI OLARAK farklı sayfalarda bırakabiliyordu (split-brain).
    // En yeni damga her zaman kazanmalı, böylece ikisi de aynı adrese yakınsar.
    await evalJS(a.client, `(() => {
      document.getElementById('sb-url').value = 'http://127.0.0.1:9877/race-host';
      document.getElementById('sb-go').click();
      return 1;
    })()`);
    await new Promise(r => setTimeout(r, 40));
    await evalJS(b.client, `(() => {
      document.getElementById('sb-url').value = 'http://127.0.0.1:9877/race-guest';
      document.getElementById('sb-go').click();
      return 1;
    })()`);
    await new Promise(r => setTimeout(r, 6000));
    const raceHostUrl = await evalJS(a.client, `(() => { try { return document.getElementById('sb-webview').getURL(); } catch (e) { return null; } })()`);
    const raceGuestUrl = await evalJS(b.client, `(() => { try { return document.getElementById('sb-webview').getURL(); } catch (e) { return null; } })()`);
    assert.strictEqual(raceHostUrl, raceGuestUrl,
      `eş-zamanlı gezinme yarışı sonrası taraflar farklı sayfalarda kaldı (split-brain): host=${raceHostUrl} misafir=${raceGuestUrl}`);
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
    site.close();
  }
};
