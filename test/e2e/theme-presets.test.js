// Ayarlar > Genel > tema kartları: her kartın gösterdiği renkler (zemin,
// vurgu, buton) arayüze birebir uygulanan renkler olmalı. Önceden
// css/refresh.css :root sabit kehribar vurgu tanımladığı için "Mevcut Mor"
// kartı mor/pembe/mavi gösterirken Kaydet düğmesi, seçili kart çerçevesi ve
// kenar menü vurgusu kehribar görünüyordu.
const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS, waitFor, waitForShell } = require('./lib/harness');

// Sayfa içinde çalışan ölçüm: kartın beyan ettiği renkleri ve gerçek
// hesaplanmış stilleri döndürür.
const MEASURE = `(() => {
  // Renk geçiş animasyonları ölçümü yanıltmasın (kimlik test ediliyor, animasyon değil).
  if (!document.getElementById('theme-test-no-transition')) {
    const st = document.createElement('style');
    st.id = 'theme-test-no-transition';
    st.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(st);
  }
  document.body.offsetHeight;
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')'; };
  const probe = (cls, prop) => {
    const el = document.createElement(cls ? 'button' : 'div');
    if (cls) el.className = cls;
    el.style.position = 'fixed'; el.style.left = '-9999px';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = { bg: cs.backgroundColor, color: cs.color };
    el.remove();
    return out;
  };
  const token = name => {
    const el = document.createElement('div');
    el.style.color = 'var(' + name + ')';
    document.body.appendChild(el);
    const v = getComputedStyle(el).color;
    el.remove();
    return v;
  };
  const active = document.querySelector('#settings-theme-presets .settings-theme-preset-swatch.active, #settings-saved-palettes .settings-theme-preset-swatch.active');
  const nav = document.querySelector('#settings-modal .settings-nav-item.active');
  const save = document.getElementById('settings-v2-save');
  const legacySave = document.getElementById('settings-save');
  const link = document.getElementById('settings-device-copy-all');
  // lch()/color(srgb …)/oklab() gibi biçimleri tek bir rgb() biçimine çevir.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const norm = v => {
    if (typeof v !== 'string' || !v) return v;
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = v; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return d[3] === 255 ? 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')' : 'rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', ' + (d[3] / 255).toFixed(2) + ')';
  };
  const deep = o => { if (typeof o === 'string') return norm(o); if (o && typeof o === 'object') { for (const k of Object.keys(o)) if (k !== 'theme' && k !== 'activeId') o[k] = deep(o[k]); } return o; };
  return deep({
    theme: document.documentElement.dataset.theme,
    activeId: active && active.dataset.presetId,
    declared: active && { bg: rgb(active.dataset.presetBg), accent: rgb(active.dataset.presetAccent), button: rgb(active.dataset.presetButton) },
    tokens: { bg: token('--bg-dark'), accent: token('--acc'), button: token('--acc-btn'), ink: token('--acc-ink'), txt: token('--txt-main'), mut: token('--txt-mut'), btnFg: token('--acc-btn-fg') },
    body: getComputedStyle(document.body).backgroundColor,
    save: { bg: getComputedStyle(save).backgroundColor, color: getComputedStyle(save).color },
    legacySave: { bg: getComputedStyle(legacySave).backgroundColor, color: getComputedStyle(legacySave).color },
    btnPri: probe('btn-pri'),
    // Uygulamanın diğer dolgulu birincil düğmeleri (grup seçici "Ekle", panel/kişi
    // düğmeleri, hap düğmeler, profil kartı): hepsi kartın buton rengini almalı.
    otherPrimaries: ['btn-pri grp-pick-go', 'grp-panel-btn is-pri', 'people-btn is-pri', 'ts-pill-btn is-primary', 'grp-call-btn', 'pc-btn-pri']
      .map(cls => { const host = document.getElementById('shell-main') || document.body; const el = document.createElement('button'); el.className = cls; host.appendChild(el); const v = getComputedStyle(el).backgroundColor; el.remove(); return v; }),
    card: active && getComputedStyle(active).borderTopColor,
    nav: nav && getComputedStyle(nav).color,
    link: link && getComputedStyle(link).color,
    activeBadge: (() => { const el = document.createElement('span'); el.className = 'settings-account-active'; document.getElementById('settings-device-accounts-list')?.appendChild(el); const v = getComputedStyle(el).color; el.remove(); return v; })(),
  });
})()`;

const parse = s => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const lum = s => {
  const [r, g, b] = parse(s).map(v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const dist = (a, b) => { const p = parse(a), q = parse(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const AMBERS = ['rgb(239, 188, 131)', 'rgb(244, 204, 160)', 'rgb(240, 178, 50)'];

function check(m, label, isAmber) {
  const info = label + ' ' + JSON.stringify(m, null, 1);
  if (process.env.THEME_TEST_VERBOSE) {
    console.log(label.padEnd(26), 'kaydet', contrast(m.save.color, m.save.bg).toFixed(2), 'yazı', contrast(m.tokens.txt, m.tokens.bg).toFixed(2),
      'soluk', contrast(m.tokens.mut, m.tokens.bg).toFixed(2), 'vurgu-yazı', contrast(m.tokens.ink, m.tokens.bg).toFixed(2));
  }
  assert.ok(m.declared, 'aktif kart yok: ' + info);
  assert.strictEqual(m.tokens.bg, m.declared.bg, 'zemin: ' + info);
  assert.strictEqual(m.body, m.declared.bg, 'body zemini: ' + info);
  assert.strictEqual(m.tokens.accent, m.declared.accent, 'vurgu: ' + info);
  assert.strictEqual(m.tokens.button, m.declared.button, 'buton: ' + info);
  assert.strictEqual(m.save.bg, m.declared.button, 'Kaydet: ' + info);
  assert.strictEqual(m.legacySave.bg, m.declared.button, 'eski Kaydet: ' + info);
  assert.strictEqual(m.btnPri.bg, m.declared.button, '.btn-pri: ' + info);
  m.otherPrimaries.forEach((bg, i) => assert.strictEqual(bg, m.declared.button, `birincil düğme #${i}: ` + info));
  assert.strictEqual(m.card, m.declared.accent, 'seçili kart çerçevesi: ' + info);
  assert.strictEqual(m.nav, m.tokens.ink, 'menü vurgusu: ' + info);
  assert.strictEqual(m.link, m.tokens.ink, 'bağlantı: ' + info);
  assert.strictEqual(m.activeBadge, m.tokens.ink, 'Etkin rozeti: ' + info);
  assert.ok(contrast(m.save.color, m.save.bg) >= 4.5, 'Kaydet yazı kontrastı: ' + info);
  assert.ok(contrast(m.tokens.txt, m.tokens.bg) >= 7, 'ana yazı kontrastı: ' + info);
  assert.ok(contrast(m.tokens.mut, m.tokens.bg) >= 3.5, 'soluk yazı kontrastı: ' + info);
  assert.ok(contrast(m.tokens.ink, m.tokens.bg) >= 3, 'vurgu yazı kontrastı: ' + info);
  if (!isAmber) {
    for (const v of [m.save.bg, m.card, m.nav, m.link, m.activeBadge, m.btnPri.bg]) {
      for (const amber of AMBERS) assert.ok(dist(v, amber) > 40, 'kehribar sızıntısı ' + v + ': ' + info);
    }
  }
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9441, name: 'Tema Testi' });
  const c = peer.client;
  try {
    await waitForShell(peer);
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await evalJS(c, `openUserSettings('general'); 1`);
    await waitFor(c, `document.querySelectorAll('#settings-theme-presets .settings-theme-preset-swatch').length >= 20`, 10000, 'tema kartları');

    // Kayıtlı palet de aynı kart yolundan geçmeli.
    await evalJS(c, `(() => {
      localStorage.setItem('teamsync_saved_palettes', JSON.stringify([{ id: 'saved-test', name: 'Test', bg: '#0b2a23', accent: '#14b8a6', button: '#0f766e', savedAt: 1 }]));
      renderSavedPalettes();
      return 1;
    })()`);

    const cards = await evalJS(c, `[...document.querySelectorAll('#settings-theme-presets .settings-theme-preset-swatch, #settings-saved-palettes .settings-theme-preset-swatch')].map(b => ({ id: b.dataset.presetId, accent: b.dataset.presetAccent }))`);
    assert.ok(cards.length >= 21, JSON.stringify(cards));

    for (const card of cards) {
      // Önizleme
      await evalJS(c, `document.querySelector('.settings-theme-preset-swatch[data-preset-id="${card.id}"]').click(); 1`);
      await new Promise(r => setTimeout(r, 60));
      const isAmber = card.id === 'amber';
      const preview = await evalJS(c, MEASURE);
      assert.strictEqual(preview.activeId, card.id, 'seçili kart: ' + JSON.stringify(preview));
      check(preview, 'önizleme ' + card.id, isAmber);
    }

    // Kaydet + kapat + yeniden aç: yerleşik bir tema ve bir palet.
    for (const id of ['aurora', 'graphite', 'aqua', 'saved-test']) {
      await evalJS(c, `document.querySelector('.settings-theme-preset-swatch[data-preset-id="${id}"]').click(); 1`);
      await evalJS(c, `document.getElementById('settings-v2-save').click(); 1`);
      await new Promise(r => setTimeout(r, 300));
      await evalJS(c, `document.getElementById('settings-v2-close')?.click(); 1`);
      await new Promise(r => setTimeout(r, 200));
      await evalJS(c, `openUserSettings('general'); 1`);
      await new Promise(r => setTimeout(r, 200));
      const after = await evalJS(c, MEASURE);
      assert.strictEqual(after.activeId, id, 'kaydedilen kart: ' + JSON.stringify(after));
      check(after, 'kayıt sonrası ' + id, false);
    }

    // Kaydedilmiş özel palet sayfa yeniden yüklendiğinde de aynı.
    await evalJS(c, `window.__themeTestBeforeReload = 1; location.reload(); 1`);
    await waitFor(c, `!window.__themeTestBeforeReload && document.readyState === 'complete' && typeof openUserSettings === 'function'`, 40000, 'yeniden yükleme');
    await new Promise(r => setTimeout(r, 1500));
    await evalJS(c, `openUserSettings('general'); 1`);
    await new Promise(r => setTimeout(r, 600));
    const reloaded = await evalJS(c, MEASURE);
    assert.strictEqual(reloaded.activeId, 'saved-test', JSON.stringify(reloaded));
    check(reloaded, 'yeniden yükleme', false);
    console.log('theme-presets: ' + cards.length + ' kart doğrulandı');
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports().then(() => { console.log('PASS'); process.exit(0); }, e => { console.error(e); process.exit(1); });
}
