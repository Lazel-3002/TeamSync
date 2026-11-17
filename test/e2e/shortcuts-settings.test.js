// Ayarlar → Kısayollar paneli + merkezi bastırma kapısı regresyonu.
//
// Kapsam:
//   1. Panel açılıyor ve her kısayol için satır üretiliyor.
//   2. Yeniden atama (rebind) akışı tuş kombinasyonunu yakalayıp saklıyor.
//   3. Çakışan tuş reddediliyor.
//   4. Ana anahtar kapalıyken mikrofon kısayolu mikrofonu DEĞİŞTİRMİYOR.
//   5. Uzak denetim taklidi sırasında kısayollar bastırılıyor ve rozet görünüyor.
//   6. Escape hiçbir durumda yutulmuyor (güvenlik çıkış yolu).
const assert = require('assert');
const { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor } = require('./lib/harness');

// CDP üzerinden gerçek bir keydown göndermek yerine, uygulamanın gördüğü
// olayla birebir aynı olan KeyboardEvent'i document'e dağıtırız: kapı
// dinleyicisi document üzerinde kabarma fazında durduğu için yol aynıdır.
function dispatchKey(client, code, options = {}) {
  const init = JSON.stringify(Object.assign({ code, key: code.replace('Key', '').toLowerCase(), bubbles: true, cancelable: true }, options));
  return evalJS(client, `document.dispatchEvent(new KeyboardEvent('keydown', ${init})); 1`);
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9412, name: 'Shortcuts Test' });
  try {
    await evalJS(peer.client, `document.getElementById('menu-settings').click(); 1`);
    await evalJS(peer.client, `document.querySelector('[data-settings-panel="shortcuts"]').click(); 1`);
    await new Promise(r => setTimeout(r, 200));

    const panel = await evalJS(peer.client, `(() => {
      const nav = document.querySelector('[data-settings-panel="shortcuts"]');
      const content = document.querySelector('[data-settings-content="shortcuts"]');
      const rows = [...document.querySelectorAll('#user-shortcuts-list .shortcut-row')];
      return {
        navActive: nav.classList.contains('active'),
        panelActive: content.classList.contains('active'),
        panelVisible: content.getBoundingClientRect().height > 0,
        ids: rows.map(r => r.dataset.shortcutId),
        keys: rows.map(r => r.querySelector('.shortcut-key').textContent),
        toggles: rows.map(r => !!r.querySelector('input[type=checkbox]')),
      };
    })()`);
    assert.strictEqual(panel.navActive, true, JSON.stringify(panel, null, 2));
    assert.strictEqual(panel.panelActive, true, JSON.stringify(panel, null, 2));
    assert.strictEqual(panel.panelVisible, true, JSON.stringify(panel, null, 2));
    assert.deepStrictEqual(panel.ids, ['mic', 'deafen', 'camera', 'share', 'record', 'fullscreen', 'ptt'], JSON.stringify(panel, null, 2));
    assert.deepStrictEqual(panel.keys, ['M', 'D', 'C', 'S', 'R', 'F', 'Space'], JSON.stringify(panel, null, 2));
    // PTT satırının aç/kapat anahtarı yok (Ses sekmesindeki Bas-Konuş yönetir).
    assert.deepStrictEqual(panel.toggles, [true, true, true, true, true, true, false], JSON.stringify(panel, null, 2));

    // --- 2. Yeniden atama: mic -> Ctrl+Shift+K -----------------------------
    await evalJS(peer.client, `document.querySelector('.shortcut-row[data-shortcut-id="mic"] .shortcut-key').click(); 1`);
    const listening = await evalJS(peer.client, `document.querySelector('.shortcut-row[data-shortcut-id="mic"] .shortcut-key').classList.contains('listening')`);
    assert.strictEqual(listening, true, 'rebind dinleme moduna geçmedi');
    await evalJS(peer.client, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'K', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); 1`);
    await new Promise(r => setTimeout(r, 150));

    const rebound = await evalJS(peer.client, `(() => ({
      label: document.querySelector('.shortcut-row[data-shortcut-id="mic"] .shortcut-key').textContent,
      stored: JSON.parse(localStorage.getItem('teamsync_shortcut_bindings') || '{}').mic,
    }))()`);
    assert.strictEqual(rebound.label, 'Ctrl + Shift + K', JSON.stringify(rebound, null, 2));
    assert.deepStrictEqual(rebound.stored, { code: 'KeyK', ctrl: true, alt: false, shift: true }, JSON.stringify(rebound, null, 2));

    // --- 3. Çakışma: deafen'a aynı kombinasyon verilemez --------------------
    await evalJS(peer.client, `document.querySelector('.shortcut-row[data-shortcut-id="deafen"] .shortcut-key').click(); 1`);
    await evalJS(peer.client, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'K', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); 1`);
    await new Promise(r => setTimeout(r, 150));
    const clash = await evalJS(peer.client, `(() => ({
      label: document.querySelector('.shortcut-row[data-shortcut-id="deafen"] .shortcut-key').textContent,
      stored: JSON.parse(localStorage.getItem('teamsync_shortcut_bindings') || '{}').deafen || null,
    }))()`);
    assert.strictEqual(clash.label, 'D', JSON.stringify(clash, null, 2));
    assert.strictEqual(clash.stored, null, JSON.stringify(clash, null, 2));

    // Varsayılana döndür ve modalı kapat, odaya gir.
    await evalJS(peer.client, `document.getElementById('user-shortcuts-reset-all').click(); 1`);
    await evalJS(peer.client, `document.getElementById('settings-v2-close').click(); 1`);
    await createRoom(peer);
    await waitFor(peer.client, `document.getElementById('mic') ? 1 : null`, 15000, 'toolbar');
    await new Promise(r => setTimeout(r, 500));

    // --- 4. Kısayollar açıkken M mikrofonu değiştirir ----------------------
    const before = await evalJS(peer.client, `!!window.state.micEnabled`);
    await dispatchKey(peer.client, 'KeyM');
    await new Promise(r => setTimeout(r, 250));
    const afterOn = await evalJS(peer.client, `!!window.state.micEnabled`);
    assert.notStrictEqual(afterOn, before, 'kısayollar açıkken M mikrofonu değiştirmedi');

    // --- 5. Ana anahtar kapalıyken M hiçbir şey yapmamalı -------------------
    await evalJS(peer.client, `localStorage.setItem('teamsync_shortcuts_enabled', '0'); 1`);
    const beforeOff = await evalJS(peer.client, `!!window.state.micEnabled`);
    await dispatchKey(peer.client, 'KeyM');
    await new Promise(r => setTimeout(r, 250));
    const afterOff = await evalJS(peer.client, `!!window.state.micEnabled`);
    assert.strictEqual(afterOff, beforeOff, 'ana anahtar kapalıyken M yine de mikrofonu değiştirdi');
    await evalJS(peer.client, `localStorage.setItem('teamsync_shortcuts_enabled', '1'); 1`);

    // --- 6. Tek tek kapatma: sadece mikrofon açık kalsın --------------------
    await evalJS(peer.client, `localStorage.setItem('teamsync_shortcut_bindings', JSON.stringify({ deafen: { enabled: false } })); 1`);
    const deafBefore = await evalJS(peer.client, `!!window.state.deafened`);
    await dispatchKey(peer.client, 'KeyD');
    await new Promise(r => setTimeout(r, 250));
    const deafAfter = await evalJS(peer.client, `!!window.state.deafened`);
    assert.strictEqual(deafAfter, deafBefore, 'kapatılmış sağırlaştırma kısayolu yine de tetiklendi');

    const micStillWorks = await evalJS(peer.client, `(() => {
      const before = !!window.state.micEnabled;
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true, cancelable: true }));
      return { before, after: !!window.state.micEnabled };
    })()`);
    assert.notStrictEqual(micStillWorks.after, micStillWorks.before, 'tek tek kapatma mikrofon kısayolunu da kapattı');
    await evalJS(peer.client, `localStorage.removeItem('teamsync_shortcut_bindings'); 1`);

    // --- 7. Uzak denetim taklidi: bastırma + rozet --------------------------
    const suppressed = await evalJS(peer.client, `(() => {
      window.state.controlledBy = 'fake-peer-id';
      const before = !!window.state.micEnabled;
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true, cancelable: true }));
      const after = !!window.state.micEnabled;
      const reason = window.isShortcutSuppressed();
      const allowed = window.shortcutsAllowed('mic');
      return { before, after, reason, allowed };
    })()`);
    assert.strictEqual(suppressed.after, suppressed.before, 'denetim sırasında mikrofon kısayolu tetiklendi');
    assert.strictEqual(suppressed.reason, true, JSON.stringify(suppressed, null, 2));
    assert.strictEqual(suppressed.allowed, false, JSON.stringify(suppressed, null, 2));

    const badge = await waitFor(
      peer.client,
      `document.getElementById('shortcuts-paused-badge').classList.contains('hidden') ? null : 'shown'`,
      4000,
      'kısayollar duraklatıldı rozeti'
    );
    assert.strictEqual(badge, 'shown');

    // --- 8. Escape asla yutulmaz (güvenlik çıkış yolu) ---------------------
    const escapePasses = await evalJS(peer.client, `(() => {
      let seen = false;
      const probe = () => { seen = true; };
      document.addEventListener('keydown', probe);
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
      document.removeEventListener('keydown', probe);
      return seen;
    })()`);
    assert.strictEqual(escapePasses, true, 'Escape kapı tarafından yutuldu — güvenlik çıkışı bozuldu');

    await evalJS(peer.client, `window.state.controlledBy = null; 1`);

    // --- 9. Metin girişindeyken kısayol tetiklenmez ------------------------
    const typing = await evalJS(peer.client, `(() => {
      const input = document.getElementById('msg') || document.querySelector('input[type=text]');
      if (!input) return { skipped: true };
      input.focus();
      const before = !!window.state.micEnabled;
      input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true, cancelable: true }));
      const after = !!window.state.micEnabled;
      input.blur();
      return { before, after };
    })()`);
    if (!typing.skipped) {
      assert.strictEqual(typing.after, typing.before, 'metin girişindeyken mikrofon kısayolu tetiklendi');
    }

    // --- 10. Ses > Bas-Konuş tuşu ile Kısayollar satırı aynı kaydı kullanır ---
    // Ses sayfasından atanan tuş Kısayollar satırına ve açıklamaya yansımalı;
    // Kısayollar'dan atanan tuş da Ses sayfasına.
    const press = code => `window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: 'x', bubbles: true, cancelable: true }))`;
    const pttView = `(() => ({
      voiceKey: document.getElementById('user-ptt-key').textContent.trim(),
      voiceDisabled: document.getElementById('user-ptt-key').disabled,
      desc: document.getElementById('user-settings-ptt-desc').textContent.trim(),
      legacyDesc: document.getElementById('settings-ptt-desc').textContent.trim(),
      shortcutKey: document.querySelector('.shortcut-row[data-shortcut-id="ptt"] .shortcut-key').textContent.trim(),
      msg: document.getElementById('user-ptt-key-msg').textContent.trim(),
      stored: JSON.parse(localStorage.getItem('teamsync_shortcut_bindings') || '{}').ptt || null
    }))()`;
    await evalJS(peer.client, `localStorage.removeItem('teamsync_shortcut_bindings'); localStorage.setItem('teamsync_language', 'tr'); applyUserLanguage('tr'); openUserSettings('voice'); 1`);
    let ptt = await evalJS(peer.client, pttView);
    assert.strictEqual(ptt.voiceKey, 'Space', JSON.stringify(ptt));
    assert.strictEqual(ptt.voiceDisabled, true, 'Bas-Konuş kapalıyken tuş seçici devre dışı olmalı: ' + JSON.stringify(ptt));
    assert.strictEqual(ptt.desc, 'Yalnızca Space tuşuna basılıyken ses iletir.', JSON.stringify(ptt));

    await evalJS(peer.client, `(() => { const cb = document.getElementById('user-settings-ptt'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await evalJS(peer.client, `document.getElementById('user-ptt-key').click(); 1`);
    const pttListening = await evalJS(peer.client, `document.getElementById('user-ptt-key').classList.contains('listening')`);
    assert.strictEqual(pttListening, true, 'tuş seçici dinleme durumuna geçmeli');
    await evalJS(peer.client, `${press('F8')}; 1`);
    ptt = await evalJS(peer.client, pttView);
    assert.strictEqual(ptt.voiceKey, 'F8', JSON.stringify(ptt));
    assert.strictEqual(ptt.shortcutKey, 'F8', 'Kısayollar satırı güncellenmeli: ' + JSON.stringify(ptt));
    assert.strictEqual(ptt.desc, 'Yalnızca F8 tuşuna basılıyken ses iletir.', JSON.stringify(ptt));
    assert.strictEqual(ptt.legacyDesc, ptt.desc, JSON.stringify(ptt));
    assert.strictEqual(ptt.stored && ptt.stored.code, 'F8', JSON.stringify(ptt));

    // Esc iptal eder, tuş değişmez.
    await evalJS(peer.client, `document.getElementById('user-ptt-key').click(); ${press('Escape')}; 1`);
    ptt = await evalJS(peer.client, pttView);
    assert.strictEqual(ptt.voiceKey, 'F8', 'Esc tuşu değiştirmemeli: ' + JSON.stringify(ptt));

    // Başka kısayolun tuşu: çakışma mesajı, tuş değişmez.
    await evalJS(peer.client, `document.getElementById('user-ptt-key').click(); ${press('KeyM')}; 1`);
    ptt = await evalJS(peer.client, pttView);
    assert.strictEqual(ptt.voiceKey, 'F8', JSON.stringify(ptt));
    assert.ok(ptt.msg.length > 0, 'çakışma mesajı görünmeli: ' + JSON.stringify(ptt));

    // Kısayollar sayfasından atama → Ses sayfası ve açıklama.
    await evalJS(peer.client, `setSettingsPanel('shortcuts'); document.querySelector('.shortcut-row[data-shortcut-id="ptt"] .shortcut-key').click(); 1`);
    await evalJS(peer.client, `${press('KeyV')}; 1`);
    ptt = await evalJS(peer.client, pttView);
    assert.strictEqual(ptt.shortcutKey, 'V', JSON.stringify(ptt));
    assert.strictEqual(ptt.voiceKey, 'V', 'Ses sayfası güncellenmeli: ' + JSON.stringify(ptt));
    assert.strictEqual(ptt.desc, 'Yalnızca V tuşuna basılıyken ses iletir.', JSON.stringify(ptt));

    // Varsayılana dön
    await evalJS(peer.client, `document.getElementById('user-ptt-key-reset').click(); 1`);
    ptt = await evalJS(peer.client, pttView);
    assert.strictEqual(ptt.voiceKey, 'Space', JSON.stringify(ptt));
    assert.strictEqual(ptt.shortcutKey, 'Space', JSON.stringify(ptt));
    assert.strictEqual(ptt.stored, null, JSON.stringify(ptt));
  } finally {
    cleanupPeer(peer);
  }
};
