// İki gerçek istemci: (1) DM ek özellikleri — kısa kod → emoji, yazıyor
// göstergesinde kişinin kendi fiili, tepki, çevrimdışı arkadaşa giden mesajın
// "bekliyor" kalıp arkadaş dönünce teslim edilmesi; (2) grup araması — A arar,
// B'de çalma kartı + Teams tarzı başlık (arayan, sayaç, "Katıl"), B katılır,
// iki taraf da aynı odada iki kutucuk görür.
const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS, waitFor, waitForShell, makeFriends, waitForPeerConnected } = require('./lib/harness');

const q = JSON.stringify;

module.exports = async function run() {
  const a = await spawnPeer({ port: 9455, name: 'Arayan A' });
  const b = await spawnPeer({ port: 9456, name: 'Aranan B' });
  try {
    await Promise.all([waitForShell(a), waitForShell(b)]);
    const { fa, fb } = await makeFriends(a, b);
    await waitFor(a.client, `!!(state.friends[${q(fb)}] && state.friends[${q(fb)}].online && state.presenceOf[${q(fb)}] && state.presenceOf[${q(fb)}].v >= 2)`, 20000, 'A sees B online (v2)');

    // ---------- DM: kısa kod + tepki ----------
    await evalJS(a.client, `openDM(${q(fb)}); sendDMText('merhaba :heart:').then(() => 1)`, true);
    await waitFor(b.client, `(state.dms[${q(fa)}] || []).some(m => m.content === 'merhaba ❤️')`, 15000, 'B gets DM with emoji');
    // B gönderene onay yollar → A'da "bekliyor" kalkar
    await waitFor(a.client, `(state.dms[${q(fb)}] || []).every(m => !m.pending)`, 15000, 'A message acknowledged');
    const mid = await evalJS(b.client, `state.dms[${q(fa)}].find(m => m.content === 'merhaba ❤️').id`);
    await evalJS(b.client, `openDM(${q(fa)}); TSDMX.toggle(${q(fa)}, ${q(mid)}, '👍'); 1`);
    await waitFor(a.client, `(() => { const m = state.dms[${q(fb)}].find(x => x.id === ${q(mid)}); return !!(m && m.reactions && (m.reactions['👍'] || []).includes('them')); })()`, 15000, 'A sees reaction');
    await waitFor(a.client, `!!document.querySelector('#dm-messages .rx')`, 5000, 'reaction chip in DM view');

    // ---------- DM: yazıyor (kişinin kendi fiili) ----------
    await evalJS(b.client, `TSProfile.save({ typingVerb: 'havlıyor 🐶' }); 1`);
    let sawTyping = false;
    for (let i = 0; i < 5 && !sawTyping; i++) {
      await evalJS(b.client, `(() => { const el = document.getElementById('dm-input'); el.value += 'x'; el.dispatchEvent(new Event('input')); return 1; })()`);
      sawTyping = await waitFor(a.client, `(document.getElementById('dm-typing').textContent || '').includes('Aranan B havlıyor 🐶')`, 3600, 'typing').then(() => true, () => false);
    }
    assert.ok(sawTyping, 'A, B yazarken fiilini görmedi');

    // ---------- DM: çevrimdışı arkadaşa mesaj bekler, dönünce iletilir ----------
    await evalJS(b.client, `(() => { state.globalMqtt.end(true); state.globalMqtt = null; if (typeof presenceInterval !== 'undefined') clearInterval(presenceInterval); return 1; })()`);
    await waitFor(a.client, `!state.friends[${q(fb)}].online`, 30000, 'A sees B offline');
    await evalJS(a.client, `sendDMText('sen yokken yazdım').then(() => 1)`, true);
    assert.strictEqual(await evalJS(a.client, `state.dms[${q(fb)}].find(m => m.content === 'sen yokken yazdım').pending === true`), true, 'mesaj bekliyor işaretlenmedi');
    await evalJS(b.client, `setupGlobalMQTT(); 1`);
    await waitFor(b.client, `(state.dms[${q(fa)}] || []).some(m => m.content === 'sen yokken yazdım')`, 40000, 'B receives queued DM after coming back');
    await waitFor(a.client, `!state.dms[${q(fb)}].find(m => m.content === 'sen yokken yazdım').pending`, 20000, 'queued DM acknowledged');
    const copies = await evalJS(b.client, `state.dms[${q(fa)}].filter(m => m.content === 'sen yokken yazdım').reduce((n, m) => n + (m.count || 1), 0)`);
    assert.strictEqual(copies, 1, 'tekrar gönderim çift mesaj üretti');

    // ---------- Grup araması ----------
    await evalJS(a.client, `TSProfile.request(${q(fb)}, 0, true); 1`);
    await waitFor(a.client, `!!TSCrypto.peerKeys(${q(fb)})`, 20000, 'A learns B keys');
    const gid = await evalJS(a.client, `TSGroups.createGroup([${q(fb)}], 'Arama Grubu').then(r => r.gid)`, true);
    await waitFor(b.client, `!!TSGroups.get(${q(gid)})`, 20000, 'B joins group');
    await evalJS(b.client, `TSShell.setView('group', ${q(gid)}); 1`);
    await evalJS(a.client, `TSShell.setView('group', ${q(gid)}); TSGroups.startOrJoinCall(${q(gid)}).then(() => 1)`, true);
    await waitFor(a.client, `!!state.room && document.body.dataset.view === 'call'`, 15000, 'A in call');
    // B: çalma kartı + Teams tarzı başlık
    await waitFor(b.client, `!!document.querySelector('.grp-ring')`, 15000, 'B rings');
    await waitFor(b.client, `(() => { const btn = document.querySelector('#grp-call .grp-call-btn'); const t = document.querySelector('#grp-call .grp-call-timer'); return !!(btn && t && btn.dataset.grpCall === 'join'); })()`, 10000, 'B header shows Join + timer');
    await new Promise(r => setTimeout(r, 1500));
    const timerText = await evalJS(b.client, `(TSUI.tick(), document.querySelector('#grp-call .grp-call-timer').textContent)`);
    assert.ok(/^\d+:\d{2}$/.test(timerText), 'sayaç biçimi: ' + timerText);
    // B katılır (çalma kartındaki Katıl)
    await evalJS(b.client, `document.querySelector('.grp-ring [data-ring="join"]').click(); 1`);
    await waitForPeerConnected(b, 45000);
    await waitFor(b.client, `document.body.dataset.view === 'call' && document.querySelectorAll('#grp-call .grp-call-btn, #grid .ptile[data-tile-uid]').length >= 2`, 20000, 'B in call with tiles');
    await waitFor(a.client, `document.querySelectorAll('#grid .ptile[data-tile-uid]').length === 2`, 20000, 'A sees 2 tiles');
    await waitFor(a.client, `(() => { const c = TSGroups.activeCall(${q(gid)}); return !!(c && c.participants.size === 2); })()`, 15000, 'A sees both participants');
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
  }
};

if (require.main === module) {
  module.exports().then(() => console.log('OK'), error => { console.error(error); process.exitCode = 1; });
}
