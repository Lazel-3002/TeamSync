// Bilgisayarda barındırılan sunucular, 3 gerçek istemci (arkadaş DEĞİLLER):
// A sunucuyu kurar ve barındırır; B ve C davet koduyla katılır.
// Doğrulananlar: davet (PBKDF2 buluşma + anahtar sarma), barındırıcı onayı,
// roller + özel kanal izinleri (barındırıcı yetkisiz mesajı reddeder), yavaş
// mod (muaf rol hariç), barındırıcı yokken salt okunur arayüz, ortak
// barındırıcı teklifi + tüm geçmişin kopyalanması, sahip çevrimdışıyken ortak
// barındırıcının onaylaması, sahibin dönünce eksiklerini tamamlaması, ses
// kanalı doluluğu + P2P bağlantı, atma + anahtar yenileme.
const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS, waitFor, waitForShell, waitStableIdentity, waitForPeerConnected } = require('./lib/harness');

const q = JSON.stringify;
const texts = (peer, sid, ch) => evalJS(peer.client, `TSServers.channelEvents(${q(sid)}, ${q(ch)}, { limit: 500 }).then(evs => JSON.stringify(evs.filter(e => e.type === 'msg').map(e => e.body.text)))`, true).then(JSON.parse);
const reasonOf = (peer, expr) => evalJS(peer.client, `(${expr}).then(() => 'ok', e => (e && (e.reason || e.message)) || 'error')`, true);

module.exports = async function run() {
  const a = await spawnPeer({ port: 9461, name: 'Sunucu A' });
  const b = await spawnPeer({ port: 9462, name: 'Sunucu B' });
  const c = await spawnPeer({ port: 9463, name: 'Sunucu C' });
  try {
    await Promise.all([waitForShell(a), waitForShell(b), waitForShell(c)]);
    const [fa, fb, fc] = await Promise.all([waitStableIdentity(a), waitStableIdentity(b), waitStableIdentity(c)]);

    // 1) Kurulum: varsayılan metin + ses kanalı, sahip = A, A barındırıcı
    const sid = await evalJS(a.client, `TSServers.createServer({ name: 'Test Sunucusu' })`, true);
    const chans = JSON.parse(await evalJS(a.client, `JSON.stringify(Object.values(TSServers.get(${q(sid)}).st.channels).map(c => ({ id: c.id, kind: c.kind, name: c.name })))`));
    const textCh = chans.find(x => x.kind === 'text').id;
    const voiceCh = chans.find(x => x.kind === 'voice').id;
    assert.strictEqual(chans.length, 2, JSON.stringify(chans));
    assert.ok(await evalJS(a.client, `TSServers.isHost(${q(sid)}) && TSServers.isOnline(${q(sid)})`));
    await waitFor(a.client, `!!document.querySelector('#rail-spaces [data-sid=' + JSON.stringify(${q(sid)}) + ']')`, 5000, 'server icon in rail');

    // 2) Davet: B önce önizler, sonra katılır; C de katılır
    const code = await evalJS(a.client, `TSServers.createInvite(${q(sid)}, { expMs: 7 * 86400000, max: 0 })`, true);
    assert.ok(/^[A-HJ-NP-Z2-9]{10}$/.test(code), code);
    const peek = JSON.parse(await evalJS(b.client, `TSServers.peekInvite(${q(code)}).then(JSON.stringify)`, true));
    assert.strictEqual(peek.name, 'Test Sunucusu');
    assert.strictEqual(peek.sid, sid);
    assert.strictEqual(await evalJS(b.client, `TSServers.joinWithInvite(${q(code)})`, true), sid);
    await waitFor(b.client, `(TSServers.get(${q(sid)}) || {}).st && !!TSServers.get(${q(sid)}).st.members[${q(fb)}]`, 20000, 'B has control log with self');
    assert.strictEqual(await evalJS(c.client, `TSServers.joinWithInvite(${q('teamsync://invite/' + code)})`, true), sid);
    await waitFor(c.client, `(TSServers.get(${q(sid)}) || {}).st && !!TSServers.get(${q(sid)}).st.members[${q(fc)}]`, 20000, 'C has control log with self');
    await waitFor(b.client, `Object.keys(TSServers.get(${q(sid)}).st.members).length === 3`, 15000, 'B sees 3 members');
    assert.strictEqual(await evalJS(a.client, `TSServers.get(${q(sid)}).st.invites[${q(code)}].uses`), 2);

    // 3) Mesaj: B yazar → A onaylar → C görür (kısa kod → emoji)
    const acc = await evalJS(b.client, `TSServers.sendMessage(${q(sid)}, ${q(textCh)}, 'merhaba :thumbsup:').then(r => r.acc.h)`, true);
    assert.strictEqual(acc, fa, 'mesajı sahip onaylamalı');
    await waitFor(c.client, `TSServers.channelEvents(${q(sid)}, ${q(textCh)}).then(evs => evs.some(e => e.type === 'msg' && e.body.text.startsWith('merhaba 👍')))`, 15000, 'C gets message');
    // Arayüz: kanal görünümü + üye listesi
    await evalJS(c.client, `TSShell.setView('server', ${q(sid)}); 1`);
    await waitFor(c.client, `Array.from(document.querySelectorAll('#srv-messages .dmx-msg')).some(m => m.textContent.includes('merhaba 👍'))`, 8000, 'message rendered');
    await waitFor(c.client, `document.querySelectorAll('#srv-members-panel .srv-member').length === 3`, 8000, 'member list rendered');
    await waitFor(c.client, `document.body.dataset.home === 'server' && document.querySelectorAll('#ss-scroll .ss-ch').length === 2`, 5000, 'channel list rendered');
    const bLastMsgAt = Date.now();

    // 4) Rol + özel kanal: yalnızca Mod rolü görür; B yazamaz
    const P = JSON.parse(await evalJS(a.client, `JSON.stringify(TSServerState.P)`));
    await evalJS(a.client, `TSServers.createRole(${q(sid)}, { name: 'Mod', color: '#22c55e', perms: TSServerState.DEFAULT_EVERYONE | ${P.MANAGE_MESSAGES}, hoist: true }).then(() => 1)`, true);
    const rid = await evalJS(a.client, `Object.values(TSServers.get(${q(sid)}).st.roles).find(r => r.name === 'Mod').id`);
    await evalJS(a.client, `TSServers.setMemberRoles(${q(sid)}, ${q(fc)}, [${q(rid)}], []).then(() => 1)`, true);
    await evalJS(a.client, `TSServers.createChannel(${q(sid)}, { name: 'gizli', kind: 'text', overrides: { everyone: { a: 0, d: ${P.VIEW_CHANNEL} }, ${q(rid)}: { a: ${P.VIEW_CHANNEL}, d: 0 } } }).then(() => 1)`, true);
    const secretCh = await evalJS(a.client, `Object.values(TSServers.get(${q(sid)}).st.channels).find(c => c.name === 'gizli').id`);
    await waitFor(b.client, `!!TSServers.get(${q(sid)}).st.channels[${q(secretCh)}]`, 15000, 'B learns channel exists');
    await waitFor(c.client, `TSServerState.visibleChannels(TSServers.get(${q(sid)}).st, ${q(fc)}).some(c => c.id === ${q(secretCh)})`, 15000, 'C (Mod) sees private channel');
    assert.ok(!(await evalJS(b.client, `TSServerState.visibleChannels(TSServers.get(${q(sid)}).st, ${q(fb)}).some(c => c.id === ${q(secretCh)})`)), 'B özel kanalı görmemeli');
    await waitFor(c.client, `document.querySelectorAll('#ss-scroll .ss-ch').length === 3`, 5000, 'C sidebar shows private channel');
    assert.strictEqual(await reasonOf(b, `TSServers.sendMessage(${q(sid)}, ${q(secretCh)}, 'sızma denemesi')`), 'perm', 'barındırıcı yetkisiz mesajı reddetmeli');
    await evalJS(c.client, `TSServers.sendMessage(${q(sid)}, ${q(secretCh)}, 'modlara özel').then(() => 1)`, true);
    // Barındırıcı, kanalı göremeyen B'ye geçmiş vermez
    await evalJS(b.client, `TSServers.openChannel(${q(sid)}, ${q(secretCh)}).then(() => 1)`, true);
    assert.deepStrictEqual(await texts(b, sid, secretCh), [], 'B özel kanal geçmişini almamalı');

    // 5) Yavaş mod: 10 sn; B ikinci mesajda reddedilir, Mod (C) muaf
    await evalJS(a.client, `TSServers.updateChannel(${q(sid)}, ${q(textCh)}, { slow: 10, topic: 'Kurallar' }).then(() => 1)`, true);
    await waitFor(b.client, `TSServers.get(${q(sid)}).st.channels[${q(textCh)}].slow === 10`, 15000, 'B sees slow mode');
    // B'nin son mesajının (3. adım) üzerinden 10 sn geçsin ki ilk mesaj yavaş moda takılmasın
    await new Promise(r => setTimeout(r, Math.max(0, 11000 - (Date.now() - bLastMsgAt))));
    assert.strictEqual(await reasonOf(b, `TSServers.sendMessage(${q(sid)}, ${q(textCh)}, 'yavaş 1')`), 'ok');
    assert.strictEqual(await reasonOf(b, `TSServers.sendMessage(${q(sid)}, ${q(textCh)}, 'yavaş 2')`), 'slow');
    assert.strictEqual(await reasonOf(c, `TSServers.sendMessage(${q(sid)}, ${q(textCh)}, 'mod 1')`), 'ok');
    assert.strictEqual(await reasonOf(c, `TSServers.sendMessage(${q(sid)}, ${q(textCh)}, 'mod 2')`), 'ok');

    // 6) Barındırıcı yok → salt okunur
    await evalJS(a.client, `TSServers.stop(); 1`);
    await evalJS(b.client, `TSServers._rt(${q(sid)}).hostsSeen.clear(); TSShell.setView('server', ${q(sid)}); 1`);
    assert.strictEqual(await evalJS(b.client, `TSServers.isOnline(${q(sid)})`), false);
    assert.strictEqual(await reasonOf(b, `TSServers.sendMessage(${q(sid)}, ${q(textCh)}, 'kimse yok')`), 'offline');
    await waitFor(b.client, `document.getElementById('srv-input').disabled && !document.getElementById('srv-offline').classList.contains('hidden')`, 8000, 'offline composer');
    await evalJS(a.client, `TSServers.start().then(() => 1)`, true);
    await waitFor(b.client, `TSServers.isOnline(${q(sid)})`, 15000, 'server back online for B');
    await waitFor(b.client, `!document.getElementById('srv-input').disabled || document.getElementById('srv-input').placeholder.includes('10')`, 10000, 'composer enabled again');

    // 7) Ortak barındırıcı: A teklif eder, B kabul eder, tüm geçmişi alır
    await evalJS(a.client, `TSServers.offerHost(${q(sid)}, ${q(fb)}).then(() => 1)`, true);
    await waitFor(b.client, `TSServers.get(${q(sid)}).st.hostOffers.includes(${q(fb)})`, 15000, 'B sees host offer');
    await evalJS(b.client, `TSServers.acceptHost(${q(sid)}).then(() => 1)`, true);
    await waitFor(b.client, `TSServers.isHost(${q(sid)})`, 10000, 'B is host');
    const aCount = await evalJS(a.client, `TSServers._rt(${q(sid)}).count`);
    await waitFor(b.client, `TSServers._rt(${q(sid)}).count >= ${aCount}`, 30000, 'B copies full history as host');
    assert.ok((await texts(b, sid, secretCh)).includes('modlara özel'), 'barındırıcı tüm geçmişi tutar');

    // 8) Sahip çevrimdışı: C'nin mesajını B onaylar; A dönünce tamamlar
    await evalJS(a.client, `TSServers.stop(); 1`);
    await evalJS(c.client, `TSServers._rt(${q(sid)}).hostsSeen.delete(${q(fa)}); 1`);
    await waitFor(c.client, `TSServers.isOnline(${q(sid)}) && TSServers.onlineHosts(${q(sid)}).includes(${q(fb)})`, 20000, 'C sees B hosting');
    await new Promise(r => setTimeout(r, 1000));
    const acc2 = await evalJS(c.client, `TSServers.sendMessage(${q(sid)}, ${q(textCh)}, 'sahip yokken').then(r => r.acc.h)`, true);
    assert.strictEqual(acc2, fb, 'ortak barındırıcı onaylamalı');
    await evalJS(a.client, `TSServers.start().then(() => 1)`, true);
    await waitFor(a.client, `TSServers.channelEvents(${q(sid)}, ${q(textCh)}).then(evs => evs.some(e => e.type === 'msg' && e.body.text === 'sahip yokken'))`, 40000, 'A catches up from co-host');

    // 9) Ses kanalı: A girer, B listede görür, B de girip bağlanır
    await evalJS(a.client, `TSServers.joinVoice(${q(sid)}, ${q(voiceCh)})`, true);
    await waitFor(b.client, `TSServers.voiceOf(${q(sid)}, ${q(voiceCh)}).some(p => p.fid === ${q(fa)})`, 15000, 'B sees A in voice channel');
    await evalJS(b.client, `TSShell.setView('server', ${q(sid)}); 1`);
    await waitFor(b.client, `!!document.querySelector('#ss-scroll .ss-vp[data-member=' + JSON.stringify(${q(fa)}) + ']')`, 8000, 'voice occupant rendered');
    await evalJS(b.client, `TSServers.joinVoice(${q(sid)}, ${q(voiceCh)})`, true);
    await waitForPeerConnected(b, 45000);
    await waitFor(a.client, `TSServers.voiceOf(${q(sid)}, ${q(voiceCh)}).length === 2`, 15000, 'A sees both in voice');
    await evalJS(a.client, `disconnectApp(); 1`);
    await evalJS(b.client, `disconnectApp(); 1`);

    // 10) Atma + anahtar yenileme: C sunucuyu kaybeder, B yeni anahtarla devam eder
    await evalJS(a.client, `TSServers.kick(${q(sid)}, ${q(fc)}).then(() => 1)`, true);
    await waitFor(c.client, `!TSServers.get(${q(sid)})`, 20000, 'C removed');
    await waitFor(b.client, `TSServers._rt(${q(sid)}).rec.epoch === 2`, 25000, 'B gets rotated key');
    await waitFor(a.client, `TSServers.onlineHosts(${q(sid)}).includes(${q(fb)})`, 20000, 'A sees B on new epoch');
    await evalJS(b.client, `TSServers.sendMessage(${q(sid)}, ${q(textCh)}, 'yeni anahtar').then(() => 1)`, true);
    await waitFor(a.client, `TSServers.channelEvents(${q(sid)}, ${q(textCh)}).then(evs => evs.some(e => e.type === 'msg' && e.body.text === 'yeni anahtar'))`, 15000, 'A reads after rotation');
    const cLeft = await evalJS(c.client, `TSSpaceStore.channelEvents(${q(sid)}, ${q(textCh)}, { limit: 500 }).then(evs => evs.length)`, true);
    assert.strictEqual(cLeft, 0, 'atılan üyenin yerel kopyası silinmeli');
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
    cleanupPeer(c);
  }
};
