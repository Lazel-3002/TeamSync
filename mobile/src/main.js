import { RoomSession } from './net/room.js';
import {
  isNative, startCallService, stopCallService, setAudioRoute, requestNotifications,
  notify, installApk, openExternal, onDeepLink, appVersion,
} from './native.js';
import { checkForUpdate } from './update.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d = '') { try { return localStorage.getItem('ts_m_' + k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ts_m_' + k, v); } catch (e) {} },
};
const RELEASES_URL = 'https://github.com/Lazel-3002/TeamSync/releases';
const ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

let session = null;
let timer = null;
let speaker = false;

document.body.classList.toggle('is-native', isNative());
document.body.classList.toggle('is-web', !isNative());
$('version').textContent = (isNative() ? 'Mobil ' : 'Web ') + appVersion() + ' · deneme';
$('name').value = store.get('name');
$('room').value = store.get('room');
$('noise').checked = store.get('noise', '1') !== '0';
$('turn-url').value = store.get('turn_url');
$('turn-user').value = store.get('turn_user');
$('turn-pass').value = store.get('turn_pass');
if (!isNative()) $('note').textContent = 'Web sürümü: tarayıcıdan sesli odaya katılırsın. Ekran kapanınca ya da sekme değişince tarayıcı sesi kesebilir; Android\'de uygulama daha sağlam.';

// Oda kimliği şu biçimlerden gelebilir: "ts-…", "teamsync://join/ts-…",
// "https://…/app/#join=ts-…", ya da boşluklu kopya.
function extractRoomId(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/(?:#join=|join\/)([A-Za-z0-9_-]{4,128})/) || s.match(/([A-Za-z0-9_-]{4,128})$/);
  const id = m ? decodeURIComponent(m[1]) : '';
  return ID_RE.test(id) ? id : '';
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

// Bağlantıyla gelen oda: kimliği doldur. Ad zaten kayıtlıysa tek dokunuş kalır.
function offerRoom(roomId) {
  if (!roomId) return;
  if (session && session.roomId === roomId) return;
  if (session) { toast('Önce bu odadan ayrıl.'); return; }
  $('room').value = roomId;
  store.set('room', roomId);
  if (!$('name').value.trim()) $('name').focus();
  else $('btn-join').focus();
  toast('Oda kimliği geldi. "Odaya katıl"a dokun.');
}

// --- Web: #join=<oda> ve Android tarayıcısında "Uygulamada aç" ---
function handleHash() {
  const id = extractRoomId(location.hash);
  if (id) offerRoom(id);
  if (!isNative() && /Android/i.test(navigator.userAgent)) {
    const room = id || extractRoomId($('room').value);
    const fallback = encodeURIComponent(RELEASES_URL);
    // Uygulama yüklü değilse tarayıcı GitHub sürümler sayfasına gider (APK oradan).
    $('btn-open-app').href = `intent://join/${room || ''}#Intent;scheme=teamsync;package=com.teamsync.mobile;S.browser_fallback_url=${fallback};end`;
    $('app-banner').classList.remove('hidden');
  }
}
window.addEventListener('hashchange', handleHash);
handleHash();

// --- Android: teamsync://join/<oda> ---
onDeepLink(url => offerRoom(extractRoomId(url)));

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('name').value.trim().slice(0, 20);
  const roomId = extractRoomId($('room').value);
  $('join-error').textContent = '';
  if (!name || !roomId) { $('join-error').textContent = 'Ad ve geçerli bir oda kimliği gerekli.'; return; }
  store.set('name', name);
  store.set('room', roomId);
  store.set('noise', $('noise').checked ? '1' : '0');
  const turnUrl = $('turn-url').value.trim();
  store.set('turn_url', turnUrl);
  store.set('turn_user', $('turn-user').value.trim());
  store.set('turn_pass', $('turn-pass').value);
  const turn = turnUrl && /^turns?:/.test(turnUrl)
    ? { urls: turnUrl, username: $('turn-user').value.trim(), credential: $('turn-pass').value }
    : null;

  $('btn-join').disabled = true;
  $('btn-join').textContent = 'Mikrofon izni bekleniyor…';
  session = new RoomSession({
    roomId, name, turn, noiseSuppression: $('noise').checked,
    onChange: render, onStatus: status, onLeft: left, onPeer: peerEvent,
  });
  window.__tsRoom = session; // tanı: chrome://inspect ve uyum testi buradan okur
  try {
    await session.start();
  } catch (err) {
    session = null;
    window.__tsRoom = null;
    $('btn-join').disabled = false;
    $('btn-join').textContent = 'Odaya katıl';
    $('join-error').textContent = err && err.name === 'NotAllowedError'
      ? (isNative()
        ? 'Mikrofon izni verilmedi. Ayarlar > Uygulamalar > TeamSync > İzinler kısmından açabilirsin.'
        : 'Mikrofon izni verilmedi. Adres çubuğundaki kilit simgesinden izin verebilirsin.')
      : 'Katılınamadı: ' + (err && err.message ? err.message : err);
    return;
  }
  $('btn-join').disabled = false;
  $('btn-join').textContent = 'Odaya katıl';
  $('room-id').textContent = roomId;
  $('join').classList.add('hidden');
  $('room-screen').classList.remove('hidden');
  // Ekran kilitlenince de görüşme sürsün: Android ön plan servisi.
  startCallService('TeamSync', 'Sesli odadasın');
  requestNotifications();
  if (!isNative() && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  speaker = false;
  setAudioRoute('earpiece');
  syncRouteButton();
  const t0 = Date.now();
  timer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    $('timer').textContent = h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }, 1000);
  render();
});

function status(kind) {
  const dot = $('status-dot');
  dot.className = 'dot' + (kind === 'online' ? ' ok' : kind === 'offline' ? ' bad' : '');
  $('status-text').textContent = {
    mic: 'Mikrofon açılıyor…',
    connecting: 'Sunuculara bağlanıyor…',
    online: 'Bağlı',
    offline: 'Bağlantı koptu, yeniden deneniyor…',
  }[kind] || kind;
}

// Uygulama arka plandayken (ekran kilitli, başka uygulamada) odaya biri
// girince ya da çıkınca bildirim.
function peerEvent(kind, peer) {
  if (!document.hidden) return;
  notify('TeamSync', kind === 'join' ? `${peer.name} odaya katıldı` : `${peer.name} odadan ayrıldı`);
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  if (!session) return;
  const peers = [...session.peers.values()];
  $('empty').classList.toggle('hidden', peers.length > 0);
  $('room-title').textContent = peers.length ? `Sesli oda · ${peers.length + 1} kişi` : 'Sesli oda';
  $('peers').innerHTML = peers.map(p => {
    const st = p.pc.connectionState;
    const stateText = st === 'connected' ? (p.mic ? 'Bağlı' : 'Mikrofonu kapalı')
      : st === 'failed' ? 'Bağlanamadı, yeniden deneniyor'
      : 'Bağlanıyor…';
    const route = st === 'connected' && p.route
      ? `<span class="tag ${p.route}">${p.route === 'relay' ? 'TURN' : 'Doğrudan'}</span>` : '';
    return `<li class="peer${p.speaking ? ' speaking' : ''}">
      <div class="avatar">${esc((p.name || '?').trim().charAt(0).toUpperCase() || '?')}</div>
      <div class="who"><strong>${esc(p.name)}</strong><span>${stateText}${p.plat === 'android' ? ' · telefon' : ''}</span></div>
      ${route}
    </li>`;
  }).join('');
  const brokers = session.brokers().map(b =>
    `<li><span class="dot ${b.connected ? 'ok' : 'bad'}"></span>${esc(b.url.replace('wss://', '').replace(/:\d+\/mqtt$/, ''))}</li>`);
  brokers.push(`<li><span class="dot ${session.noiseMode === 'rnnoise' ? 'ok' : ''}"></span>Gürültü engelleme: ${session.noiseMode === 'rnnoise' ? 'RNNoise' : 'telefonun kendi'}</li>`);
  $('diag').innerHTML = brokers.join('');
  const on = session.effectiveMic();
  $('btn-mic').setAttribute('aria-pressed', String(on));
  $('mic-label').textContent = session.serverMuted ? 'Kurucu susturdu' : on ? 'Mikrofon açık' : 'Mikrofon kapalı';
}

function syncRouteButton() {
  $('btn-route').setAttribute('aria-pressed', String(speaker));
  $('route-label').textContent = speaker ? 'Hoparlör' : 'Ahize';
}

$('btn-mic').addEventListener('click', () => { if (session) session.setMic(!session.micOn); });
$('btn-route').addEventListener('click', () => {
  speaker = !speaker;
  setAudioRoute(speaker ? 'speaker' : 'earpiece');
  syncRouteButton();
});
$('btn-leave').addEventListener('click', () => { if (session) session.leave('left'); });
$('btn-copy-room').addEventListener('click', async () => {
  if (!session) return;
  try { await navigator.clipboard.writeText(session.roomId); toast('Oda kimliği kopyalandı'); }
  catch (e) { toast(session.roomId); }
});

function left(reason) {
  clearInterval(timer);
  stopCallService();
  session = null;
  window.__tsRoom = null;
  $('room-screen').classList.add('hidden');
  $('join').classList.remove('hidden');
  $('join-error').textContent = reason === 'kicked' ? 'Oda kurucusu seni odadan çıkardı.'
    : reason === 'banned' ? 'Bu odaya girmen yasaklandı.' : '';
}

// Uygulama tamamen kapanırken odadan düzgün ayrıl.
window.addEventListener('pagehide', () => { if (session) session.leave('left'); });

// --- Güncelleme (yalnızca Android uygulaması) ---
let pendingUpdate = null;
async function runUpdateCheck() {
  if (!isNative()) return;
  try {
    pendingUpdate = await checkForUpdate(appVersion());
  } catch (e) { pendingUpdate = null; }
  if (!pendingUpdate) return;
  $('update-text').textContent = `Sürüm ${pendingUpdate.version} hazır. Şu an ${appVersion()} kullanıyorsun.`;
  $('update-banner').classList.remove('hidden');
  if (store.get('notified_update') !== pendingUpdate.version) {
    store.set('notified_update', pendingUpdate.version);
    notify('TeamSync güncellemesi', `Sürüm ${pendingUpdate.version} hazır. Açıp "Güncelle"ye dokun.`);
  }
}
$('btn-update').addEventListener('click', async () => {
  if (!pendingUpdate) return;
  const btn = $('btn-update');
  btn.disabled = true;
  btn.textContent = 'İndiriliyor…';
  try {
    await installApk(pendingUpdate.url);
    btn.textContent = 'Kurulum açıldı';
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (msg.includes('NEEDS_PERMISSION')) {
      toast('Açılan ekranda "Bu kaynaktan izin ver"i aç, sonra tekrar Güncelle\'ye dokun.');
    } else {
      toast('İndirilemedi; tarayıcıdan indirme sayfası açılıyor.');
      openExternal(RELEASES_URL);
    }
    btn.textContent = 'Güncelle';
  }
  btn.disabled = false;
});
runUpdateCheck();
document.addEventListener('visibilitychange', () => {
  // Günde en fazla birkaç kez: uygulama öne geldiğinde ve son denetimden 6 saat geçtiyse.
  if (document.hidden || !isNative()) return;
  const last = Number(store.get('update_checked_at', '0'));
  if (Date.now() - last < 6 * 60 * 60 * 1000) return;
  store.set('update_checked_at', String(Date.now()));
  runUpdateCheck();
});
