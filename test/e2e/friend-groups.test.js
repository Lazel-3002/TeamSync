// Arkadaş grupları, 3 gerçek istemci: A (kurucu) B ve C'yi davet eder.
// Doğrulananlar: şifreli davet + anahtar değişimi, canlı mesaj (:kısa kod: →
// emoji), çevrimdışı üyenin geri gelince kaçırdıklarını tamamlaması, yazıyor
// göstergesinde kişinin kendi fiili, tepkiler, üye çıkarınca anahtar yenileme
// (çıkarılan kişi grubu kaybeder, kalanlar yeni anahtarla konuşmaya devam eder).
const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS, waitFor, waitForShell, makeFriends } = require('./lib/harness');

const q = JSON.stringify;
const texts = (peer, gid) => evalJS(peer.client, `TSGroups.loadEvents(${q(gid)}).then(evs => JSON.stringify(evs.filter(e => e.type === 'msg').map(e => e.body.text)))`, true).then(JSON.parse);

module.exports = async function run() {
  const a = await spawnPeer({ port: 9451, name: 'Grup A' });
  const b = await spawnPeer({ port: 9452, name: 'Grup B' });
  const c = await spawnPeer({ port: 9453, name: 'Grup C' });
  try {
    await Promise.all([waitForShell(a), waitForShell(b), waitForShell(c)]);
    const { fb } = await makeFriends(a, b);
    const { fb: fc } = await makeFriends(a, c);

    // A, B ve C'nin açık anahtarlarını profil yanıtıyla öğrenir.
    await evalJS(a.client, `TSProfile.request(${q(fb)}, 0, true); TSProfile.request(${q(fc)}, 0, true); 1`);
    await waitFor(a.client, `!!TSCrypto.peerKeys(${q(fb)}) && !!TSCrypto.peerKeys(${q(fc)})`, 25000, 'A learns keys');

    // 1) Grup kur
    const created = JSON.parse(await evalJS(a.client, `TSGroups.createGroup([${q(fb)}, ${q(fc)}], 'Test Grubu').then(r => JSON.stringify({ gid: r.gid, pending: r.pending }))`, true));
    assert.deepStrictEqual(created.pending, [], 'davetler bekletildi');
    const gid = created.gid;
    await waitFor(b.client, `!!TSGroups.get(${q(gid)})`, 20000, 'B receives invite');
    await waitFor(c.client, `!!TSGroups.get(${q(gid)})`, 20000, 'C receives invite');
    await waitFor(b.client, `TSGroups.get(${q(gid)}).rec.members.length === 3`, 15000, 'B knows all 3 members');
    // Davet teslimi doğrulanır (ilk /eph mesajı): bekleyen davetli kalmaz.
    await waitFor(a.client, `TSGroups.unconfirmed(${q(gid)}).length === 0 && TSGroups.list().find(g => g.gid === ${q(gid)}).unconfirmed.length === 0`, 20000, 'A: invites confirmed');
    assert.strictEqual(await evalJS(b.client, `TSGroups.groupTitle(${q(gid)})`), 'Test Grubu');
    // DM listesinde grup satırı
    await waitFor(b.client, `!!document.querySelector('#dm-list [data-gid=' + JSON.stringify(${q(gid)}) + ']')`, 5000, 'group row in DM list');

    // 2) Canlı mesaj + kısa kod
    await evalJS(a.client, `TSGroups.sendMessage(${q(gid)}, 'selam :thumbsup:').then(() => 1)`, true);
    await waitFor(b.client, `TSGroups.loadEvents(${q(gid)}).then(evs => evs.some(e => e.type === 'msg' && e.body.text.startsWith('selam 👍')))`, 15000, 'B gets live message');
    await waitFor(c.client, `TSGroups.loadEvents(${q(gid)}).then(evs => evs.some(e => e.type === 'msg' && e.body.text.startsWith('selam 👍')))`, 15000, 'C gets live message');

    // 3) C çevrimdışıyken B yazar; C dönünce kaçırdıklarını tamamlar
    await evalJS(c.client, `TSGroups.stop(); 1`);
    await evalJS(b.client, `TSGroups.sendMessage(${q(gid)}, 'C yokken 1').then(() => TSGroups.sendMessage(${q(gid)}, 'C yokken 2')).then(() => 1)`, true);
    await waitFor(a.client, `TSGroups.loadEvents(${q(gid)}).then(evs => evs.some(e => e.type === 'msg' && e.body.text === 'C yokken 2'))`, 15000, 'A gets B messages');
    await evalJS(c.client, `TSGroups.start().then(() => 1)`, true);
    await waitFor(c.client, `TSGroups.loadEvents(${q(gid)}).then(evs => evs.filter(e => e.type === 'msg' && e.body.text.startsWith('C yokken')).length === 2)`, 30000, 'C catches up after coming back');

    // 4) Yazıyor: B'nin kendi fiili A'da görünür
    await evalJS(b.client, `TSProfile.save({ typingVerb: 'mırlıyor 🐱' }); TSShell.setView('group', ${q(gid)}); 1`);
    await evalJS(a.client, `TSShell.setView('group', ${q(gid)}); 1`);
    // Gerçek yazma gibi: birkaç saniye boyunca tuşlara basılır (sinyaller QoS 0).
    let sawTyping = false;
    for (let i = 0; i < 5 && !sawTyping; i++) {
      await evalJS(b.client, `(() => { const i = document.getElementById('grp-input'); i.value += 'a'; i.dispatchEvent(new Event('input')); return 1; })()`);
      sawTyping = await waitFor(a.client, `(document.getElementById('grp-typing').textContent || '').includes('Grup B mırlıyor 🐱')`, 3600, 'typing').then(() => true, () => false);
    }
    assert.ok(sawTyping, "A, B'nin kendi yazıyor fiilini görmedi");

    // 5) Tepki: A, B'nin mesajına 🔥 bırakır → B'de sayaç
    const target = await evalJS(a.client, `TSGroups.loadEvents(${q(gid)}).then(evs => evs.find(e => e.type === 'msg' && e.body.text === 'C yokken 1').id)`, true);
    await evalJS(a.client, `TSGroups.react(${q(gid)}, ${q(target)}, '🔥', 'add').then(() => 1)`, true);
    await waitFor(b.client, `TSGroups.loadEvents(${q(gid)}).then(evs => evs.some(e => e.type === 'react' && e.body.target === ${q(target)} && e.body.e === '🔥'))`, 15000, 'B receives reaction');
    await waitFor(b.client, `!!document.querySelector('#grp-messages .rx[data-mid=' + JSON.stringify(${q(target)}) + ']')`, 5000, 'reaction chip rendered');

    // 5b) Grup araması, kurucu ayrılır: kalan ikisi bağlı kalır ve AYNI yeni kurucuda buluşur
    const connected = `Array.from(state.peers.values()).filter(p => p.pc && ['connected', 'completed'].includes(p.pc.iceConnectionState)).length`;
    await evalJS(a.client, `TSGroups.startOrJoinCall(${q(gid)}, { ring: false }).then(() => 1)`, true);
    await waitFor(b.client, `!!TSGroups.activeCall(${q(gid)})`, 15000, 'B sees call');
    await waitFor(c.client, `!!TSGroups.activeCall(${q(gid)})`, 15000, 'C sees call');
    assert.strictEqual(await evalJS(b.client, `!!document.querySelector('.grp-ring')`), false, 'sessiz arama çaldırdı');
    await evalJS(b.client, `TSGroups.startOrJoinCall(${q(gid)}).then(() => 1)`, true);
    await evalJS(c.client, `TSGroups.startOrJoinCall(${q(gid)}).then(() => 1)`, true);
    await waitFor(c.client, `${connected} >= 2`, 60000, 'C connected to A and B');
    await waitFor(b.client, `${connected} >= 2`, 60000, 'B connected to A and C');
    const aRoomId = await evalJS(a.client, `state.myId`);
    await waitFor(b.client, `state.founderId === ${q(aRoomId)}`, 15000, 'B: A is founder');
    await waitFor(c.client, `state.founderId === ${q(aRoomId)}`, 15000, 'C: A is founder');
    await evalJS(a.client, `TSGroups.leaveCall(${q(gid)}); 1`);
    await waitFor(b.client, `!state.peers.has(${q(aRoomId)})`, 45000, 'B notices founder left');
    await waitFor(c.client, `!state.peers.has(${q(aRoomId)})`, 45000, 'C notices founder left');
    await new Promise(r => setTimeout(r, 6000));
    const after = await Promise.all([b, c].map(p => evalJS(p.client, `JSON.stringify({ room: !!state.room, conn: ${connected}, f: state.founderId, me: state.myId, isF: !!state.isRoomFounder, tiles: document.querySelectorAll('#grid .ptile[data-tile-uid]').length })`).then(JSON.parse)));
    after.forEach((s, i) => {
      assert.ok(s.room && s.conn === 1 && s.tiles === 2, `kurucu ayrılınca ${i ? 'C' : 'B'} düştü: ${JSON.stringify(s)}`);
    });
    assert.ok(after[0].f && after[0].f === after[1].f && after[0].f !== aRoomId, 'yeni kurucuda anlaşılamadı: ' + JSON.stringify(after));
    assert.strictEqual(after.filter(s => s.isF).length, 1, 'tam bir kurucu olmalı: ' + JSON.stringify(after));
    // Geç katılan (eski kurucu) aynı kurucuyu görür
    await evalJS(a.client, `TSGroups.startOrJoinCall(${q(gid)}).then(() => 1)`, true);
    await waitFor(a.client, `${connected} >= 2`, 60000, 'A rejoins');
    await waitFor(a.client, `state.founderId === ${q(after[0].f)} && !state.isRoomFounder`, 20000, 'late joiner agrees on founder');
    for (const p of [a, b, c]) await evalJS(p.client, `TSGroups.leaveCall(${q(gid)}); 1`);
    await waitFor(a.client, `!TSGroups.activeCall(${q(gid)})`, 20000, 'call over');

    // 6) Çıkarma + anahtar yenileme
    await evalJS(a.client, `TSGroups.kick(${q(gid)}, ${q(fc)}).then(() => 1)`, true);
    await waitFor(c.client, `!TSGroups.get(${q(gid)})`, 20000, 'C loses the group');
    await waitFor(b.client, `TSGroups.get(${q(gid)}).rec.epoch === 2 && TSGroups.get(${q(gid)}).rec.members.length === 2`, 25000, 'B gets rotated key');
    await evalJS(a.client, `TSGroups.sendMessage(${q(gid)}, 'yeni anahtar').then(() => 1)`, true);
    await waitFor(b.client, `TSGroups.loadEvents(${q(gid)}).then(evs => evs.some(e => e.type === 'msg' && e.body.text === 'yeni anahtar'))`, 15000, 'B reads after rotation');
    const cTexts = await evalJS(c.client, `TSSpaceStore.eventsOf(${q(gid)}).then(evs => JSON.stringify(evs.map(e => e.body && e.body.text)))`, true);
    assert.ok(!String(cTexts).includes('yeni anahtar'), 'çıkarılan üye yeni mesajı gördü: ' + cTexts);
    const bTexts = await texts(b, gid);
    assert.ok(bTexts.includes('C yokken 1') && bTexts.includes('yeni anahtar'), JSON.stringify(bTexts));
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
    cleanupPeer(c);
  }
};

if (require.main === module) {
  module.exports().then(() => console.log('OK'), error => { console.error(error); process.exitCode = 1; });
}
