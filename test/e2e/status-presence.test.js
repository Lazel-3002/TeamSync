// İki gerçek istemci arkadaşken kabuğun zengin presence alanlarını uçtan uca
// doğrular: durum (Rahatsız Etmeyin / Boşta / Görünmez), özel durum, oynanan
// oyun + sayaç, P2P profil çekme (ve Supabase dışı görsel reddi), arama
// kutucukları (sustur simgesi + oyun satırı).
const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
  createRoom,
  joinRoom,
  waitForPeerConnected,
  waitForShell,
  makeFriends,
} = require('./lib/harness');

module.exports = async function run() {
  const a = await spawnPeer({ port: 9431, name: 'Durum A' });
  const b = await spawnPeer({ port: 9432, name: 'Durum B' });
  try {
    await waitForShell(a);
    await waitForShell(b);
    const { fa } = await makeFriends(a, b);
    const q = JSON.stringify(fa);

    await waitFor(b.client, `!!(state.friends[${q}] && state.friends[${q}].online)`, 20000, 'B sees A online');

    // 1) Rahatsız Etmeyin → karşı tarafın listesinde kırmızı nokta
    await evalJS(a.client, `TSStatus.setStatus('dnd', '1h'); 1`);
    const rowSel = `document.querySelector('#friends-list [data-fid="' + ${q} + '"]')`;
    await waitFor(b.client, `TSStatus.statusOf(${q}) === 'dnd' && ${rowSel}?.dataset.status === 'dnd'`, 15000, 'dnd propagated');
    assert.strictEqual(await evalJS(a.client, `TSStatus.isDnd()`), true);

    // 2) Özel durum
    await evalJS(a.client, `TSStatus.setStatus('online'); TSStatus.setCustom({ text: 'kahve molası', emoji: '☕', clear: 'never' }); 1`);
    await waitFor(b.client, `TSStatus.presenceOf(${q})?.cs?.t === 'kahve molası' && TSStatus.statusOf(${q}) === 'online'`, 15000, 'custom status propagated');

    // 3) Otomatik boşta
    await evalJS(a.client, `TSStatus._setAutoIdle(true); 1`);
    await waitFor(b.client, `TSStatus.statusOf(${q}) === 'idle'`, 15000, 'auto idle propagated');
    await evalJS(a.client, `TSStatus._setAutoIdle(false); 1`);

    // 4) Oynanan oyun + sayaç (karşı tarafta en az 1:05)
    await evalJS(a.client, `TSActivity._inject({ name: 'E2E Game', steamAppId: 730, startedAt: Date.now() - 65000 }); 1`);
    await waitFor(b.client, `TSStatus.presenceOf(${q})?.act?.n === 'E2E Game'`, 15000, 'activity propagated');
    const timer = await evalJS(b.client, `(() => {
      TSProfile.showCard({ friendId: ${q} });
      TSUI.tick();
      const el = document.querySelector('.ts-profile-pop .pc-act-time .ts-since');
      return el ? el.textContent : null;
    })()`);
    assert.ok(timer, 'profil kartında oyun sayacı yok');
    const [mm, ss] = timer.split(':').map(Number);
    assert.ok(mm * 60 + ss >= 64, `sayaç ${timer} (>= 1:05 beklenirdi)`);
    const rowSub = await evalJS(b.client, `${rowSel}?.querySelector('.friend-sub')?.textContent || ''`);
    assert.ok(/E2E Game/.test(rowSub), 'arkadaş satırında oyun yok: ' + rowSub);
    await evalJS(b.client, `TSUI.closePopover(); 1`);

    // 5) P2P profil çekme: A profili kaydeder → B presence'taki sürümü görüp çeker
    await evalJS(a.client, `TSProfile.save({ bio: 'E2E hakkımda', bannerColor: '#ff0055', frame: 'gold', typingVerb: 'mırlıyor 🐱' }); 1`);
    await waitFor(b.client, `TSProfile.profileOf(${q})?.bio === 'E2E hakkımda'`, 20000, 'profile fetched');
    const fetched = await evalJS(b.client, `JSON.stringify(TSProfile.profileOf(${q}))`);
    const prof = JSON.parse(fetched);
    assert.strictEqual(prof.bannerColor, '#ff0055');
    assert.strictEqual(prof.frame, 'gold');
    assert.strictEqual(prof.typingVerb, 'mırlıyor 🐱');
    // Supabase dışı bir görsel adresi (IP sızdırma) kabul edilmez
    await evalJS(b.client, `TSProfile.onEvent({ type: 'res_profile', fromId: ${q}, rev: 999, profile: { bio: 'x', banner: { u: 'https://evil.example/pixel.png' }, anim: 'https://evil.example/a.gif' } }); 1`);
    const spoofed = JSON.parse(await evalJS(b.client, `JSON.stringify(TSProfile.profileOf(${q}))`));
    assert.strictEqual(spoofed.bannerUrl, '', 'Supabase dışı banner kabul edildi');
    assert.strictEqual(spoofed.avatarAnimUrl, '', 'Supabase dışı GIF kabul edildi');

    // 6) Arama kutucukları: herkes için bir kutucuk, susturma simgesi ve oyun satırı
    const roomId = await createRoom(a);
    await joinRoom(b, roomId);
    await waitForPeerConnected(a, 60000);
    await waitFor(a.client, `document.querySelectorAll('#grid .ptile[data-tile-uid]').length === 2`, 20000, 'A has 2 tiles');
    await waitFor(b.client, `document.querySelectorAll('#grid .ptile[data-tile-uid]').length === 2`, 20000, 'B has 2 tiles');
    await waitFor(b.client, `Array.from(document.querySelectorAll('#grid .ptile[data-tile-uid]')).some(t => t.dataset.tileUid !== 'self' && /E2E Game/.test(t.querySelector('.ptile-activity')?.textContent || ''))`, 15000, 'B sees A activity on tile');
    await evalJS(b.client, `document.getElementById('mic').click(); 1`);
    await waitFor(a.client, `Array.from(document.querySelectorAll('#grid .ptile[data-tile-uid]')).some(t => t.dataset.tileUid !== 'self' && t.classList.contains('is-muted'))`, 15000, 'mute icon propagated to tile');
    const views = await evalJS(a.client, `JSON.stringify({ view: document.body.dataset.view, railCall: !document.getElementById('rail-call').classList.contains('hidden'), mini: !document.getElementById('voice-mini').classList.contains('hidden') })`);
    assert.deepStrictEqual(JSON.parse(views), { view: 'call', railCall: true, mini: true });

    // 7) Görünmez → karşı tarafta çevrimdışı
    await evalJS(a.client, `TSStatus.setStatus('invisible'); 1`);
    await waitFor(b.client, `!state.friends[${q}].online`, 30000, 'invisible looks offline');
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
  }
};

if (require.main === module) {
  module.exports().then(() => console.log('OK'), error => { console.error(error); process.exitCode = 1; });
}
