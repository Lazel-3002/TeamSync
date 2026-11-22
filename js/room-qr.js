// "Telefonda aç": görüşmedeki odanın bağlantısını QR kod olarak gösterir.
//
// QR içeriği web uygulamasının adresidir (GitHub Pages, docs/app/):
//   https://lazel-3002.github.io/TeamSync/app/#join=<odaKimliği>
// • Telefonun kendi kamerasıyla okutulur; ayrı bir QR okuyucu gerekmez.
// • Android'de TeamSync uygulaması yüklüyse sayfa "Uygulamada aç" düğmesi
//   gösterir (teamsync://join/<oda>); yüklü değilse ya da iPhone'daysa oda
//   doğrudan tarayıcıda açılır. Böylece tek bir kod herkes için çalışır.
// QR yerelde üretilir (vendor/qrcode-generator.js), hiçbir sunucuya gitmez.
(function () {
  'use strict';

  const WEB_APP_URL = 'https://lazel-3002.github.io/TeamSync/app/';
  const ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

  const tr = (key, fallback) => (typeof window.t === 'function' ? window.t(key) : fallback) || fallback;

  function roomLink(roomId) {
    return WEB_APP_URL + '#join=' + encodeURIComponent(roomId);
  }

  function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return '';
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  }

  function close() {
    const el = document.getElementById('room-qr-modal');
    if (el) el.remove();
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  function open(roomId) {
    roomId = roomId || (window.state && window.state.room);
    if (typeof roomId !== 'string' || !ID_RE.test(roomId)) return;
    close();
    const link = roomLink(roomId);
    const wrap = document.createElement('div');
    wrap.id = 'room-qr-modal';
    wrap.className = 'room-qr-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'room-qr-title');
    wrap.innerHTML = `
      <div class="room-qr-card">
        <div class="room-qr-head">
          <h3 id="room-qr-title"></h3>
          <button type="button" class="room-qr-x" data-qr="close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>
        <div class="room-qr-code"></div>
        <p class="room-qr-desc"></p>
        <div class="room-qr-link"><code></code><button type="button" class="ts-pill-btn" data-qr="copy"></button></div>
      </div>`;
    wrap.querySelector('#room-qr-title').textContent = tr('roomQr.title', 'Telefondan katıl');
    wrap.querySelector('.room-qr-x').setAttribute('aria-label', tr('common.close', 'Kapat'));
    wrap.querySelector('.room-qr-code').innerHTML = qrSvg(link);
    wrap.querySelector('.room-qr-desc').textContent = tr('roomQr.desc', 'Telefonun kamerasıyla bu kodu okut. TeamSync uygulaması yüklüyse onda, değilse tarayıcıda açılır.');
    wrap.querySelector('.room-qr-link code').textContent = link;
    wrap.querySelector('[data-qr="copy"]').textContent = tr('roomQr.copyLink', 'Bağlantıyı kopyala');
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-qr]');
      if (e.target === wrap || (b && b.dataset.qr === 'close')) { close(); return; }
      if (b && b.dataset.qr === 'copy') {
        if (window.TSUI && window.TSUI.copyText) window.TSUI.copyText(link);
        else if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
      }
    });
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey, true);
    const x = wrap.querySelector('.room-qr-x');
    if (x) x.focus();
  }

  window.TSRoomQR = { open, close, roomLink };
})();
