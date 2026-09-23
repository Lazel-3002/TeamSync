// Sunucu durum hesaplayıcısı (js/space/server-state.js) — Electron gerektirmez.
// Yetki bit alanı, rol hiyerarşisi, kanal geçersiz kılmaları, davet süreleri,
// yasaklar, barındırıcılar, yavaş mod ve olay sırasından bağımsızlık.
const assert = require('assert');
const S = require('../../js/space/server-state.js');

const K = n => 'A'.repeat(90) + String(n).padStart(4, '0'); // geçerli görünümlü açık anahtar
let seq = 0;
const T0 = 1_700_000_000_000;
function ev(author, type, body, extra = {}) {
  seq += 1;
  return { id: `e${String(seq).padStart(5, '0')}`, gid: 'srv1', author, type, body, ts: T0 + seq * 1000, ...extra };
}

module.exports = async () => {
  const { P } = S;
  const events = [];
  const add = (...a) => { const e = ev(...a); events.push(e); return e; };

  add('OWNER', 'srv.create', { name: 'Gece Meclisi', member: { name: 'Lazel', ik: K(1), ek: K(2) } });
  add('OWNER', 'ch.create', { id: 'ch-genel', name: 'Genel Sohbet', kind: 'text' });
  add('OWNER', 'ch.create', { id: 'ch-ses1', name: 'Oyun Odası', kind: 'voice' });
  add('OWNER', 'invite.create', { code: 'ABCDEFGH23', exp: T0 + 7 * 86400000, max: 3 });
  add('ALICE', 'member.join', { name: 'Alice', ik: K(3), ek: K(4), inv: 'ABCDEFGH23' });
  add('BOB', 'member.join', { name: 'Bob', ik: K(5), ek: K(6), inv: 'ABCDEFGH23' });
  add('MALLORY', 'member.join', { name: 'Mal', ik: K(7), ek: K(8), inv: 'ZZZZZZZZZZ' }); // olmayan davet

  let st = S.derive(events);
  assert.ok(st, 'durum oluşmalı');
  assert.strictEqual(st.owner, 'OWNER');
  assert.strictEqual(st.channels['ch-genel'].name, 'genel-sohbet', 'metin kanalı adı küçük harf + tire');
  assert.strictEqual(st.channels['ch-ses1'].name, 'Oyun Odası', 'ses kanalı adı serbest');
  assert.deepStrictEqual(Object.keys(st.members).sort(), ['ALICE', 'BOB', 'OWNER']);
  assert.strictEqual(st.invites.ABCDEFGH23.uses, 2);
  assert.strictEqual(S.basePerms(st, 'OWNER'), S.ALL);
  assert.ok(S.has(S.channelPerms(st, 'ALICE', 'ch-genel'), P.SEND_MESSAGES));
  assert.ok(!S.has(S.basePerms(st, 'ALICE'), P.MANAGE_CHANNELS));

  // Yetkisiz kanal oluşturma atlanır
  add('ALICE', 'ch.create', { id: 'ch-alice', name: 'alice', kind: 'text' });
  st = S.derive(events);
  assert.ok(!st.channels['ch-alice'], 'yetkisiz üye kanal açamamalı');

  // Roller: Admin (her şey) ve Mod (kanal + mesaj yönetimi + atma)
  add('OWNER', 'role.create', { id: 'r-mod', name: 'Mod', color: '#22c55e', perms: P.MANAGE_CHANNELS | P.MANAGE_MESSAGES | P.KICK_MEMBERS | P.MANAGE_ROLES, hoist: true });
  add('OWNER', 'role.create', { id: 'r-admin', name: 'Admin', color: '#ef4444', perms: P.ADMINISTRATOR, hoist: true });
  st = S.derive(events);
  // Yeni rol en alta girer: sonra açılan Admin, Mod'un altında kalır
  assert.strictEqual(st.roles['r-admin'].pos, 1);
  assert.strictEqual(st.roles['r-mod'].pos, 2);
  // Admin'i Mod'un üstüne taşı
  add('OWNER', 'role.move', { id: 'r-admin', dir: 'up' });
  add('OWNER', 'member.roles', { fid: 'ALICE', add: ['r-admin'] });
  add('OWNER', 'member.roles', { fid: 'BOB', add: ['r-mod'] });
  st = S.derive(events);
  assert.strictEqual(st.roles['r-admin'].pos, 2);
  assert.strictEqual(st.roles['r-mod'].pos, 1);
  assert.strictEqual(S.basePerms(st, 'ALICE'), S.ALL, 'yönetici her şeye sahip');
  assert.strictEqual(S.memberColor(st, 'ALICE'), '#ef4444');

  // Hiyerarşi: Mod (Bob) Admin'i (Alice) atamaz; Mod kanal açabilir
  add('BOB', 'member.kick', { fid: 'ALICE' });
  add('BOB', 'ch.create', { id: 'ch-mod', name: 'mod log', kind: 'text' });
  // Mod, sahip olmadığı izni (BAN) içeren rol oluşturamaz
  add('BOB', 'role.create', { id: 'r-bad', name: 'Bad', perms: P.BAN_MEMBERS });
  // Mod kendisinden üstteki Admin rolünü veremez
  add('BOB', 'member.roles', { fid: 'BOB', add: ['r-admin'] });
  st = S.derive(events);
  assert.ok(st.members.ALICE, 'mod, admin’i atamamalı');
  assert.ok(st.channels['ch-mod'], 'mod kanal açabilmeli');
  assert.ok(!st.roles['r-bad'], 'sahip olmadığı izni veremez');
  assert.ok(!st.members.BOB.roles.includes('r-admin'), 'üst rolü kendine veremez');

  // Özel kanal: @everyone görünmez, Mod rolü görür; Bob'a yazma yasağı
  add('OWNER', 'ch.create', { id: 'ch-gizli', name: 'gizli', kind: 'text' });
  add('OWNER', 'ch.update', { id: 'ch-gizli', overrides: { everyone: { a: 0, d: P.VIEW_CHANNEL }, 'r-mod': { a: P.VIEW_CHANNEL, d: 0 }, 'u:BOB': { a: 0, d: P.SEND_MESSAGES } } });
  add('OWNER', 'invite.create', { code: 'CDEFGHJK45', exp: 0, max: 0 });
  add('CAROL', 'member.join', { name: 'Carol', ik: K(9), ek: K(10), inv: 'CDEFGHJK45' });
  st = S.derive(events);
  assert.ok(!S.has(S.channelPerms(st, 'CAROL', 'ch-gizli'), P.VIEW_CHANNEL), 'herkes gizli kanalı görmemeli');
  assert.ok(S.has(S.channelPerms(st, 'BOB', 'ch-gizli'), P.VIEW_CHANNEL), 'mod gizli kanalı görmeli');
  assert.ok(!S.has(S.channelPerms(st, 'BOB', 'ch-gizli'), P.SEND_MESSAGES), 'üyeye özel yazma yasağı');
  assert.ok(S.has(S.channelPerms(st, 'ALICE', 'ch-gizli'), P.SEND_MESSAGES), 'yönetici geçersiz kılmalardan etkilenmez');
  assert.deepStrictEqual(S.visibleChannels(st, 'CAROL', 'text').map(c => c.id), ['ch-genel', 'ch-mod']);
  assert.deepStrictEqual(S.visibleChannels(st, 'BOB', 'text').map(c => c.id), ['ch-genel', 'ch-mod', 'ch-gizli']);
  assert.strictEqual(S.checkMessage(st, { author: 'BOB', ch: 'ch-gizli', type: 'msg', body: { text: 'selam' }, ts: T0 }).reason, 'perm');
  assert.ok(S.checkMessage(st, { author: 'CAROL', ch: 'ch-genel', type: 'msg', body: { text: 'selam' }, ts: T0 }).ok);

  // Davet: süresi dolan ve kullanım sınırı dolan davetler
  add('OWNER', 'invite.create', { code: 'EXPRDHJK22', exp: T0 + seq * 1000 + 2000, max: 0 });
  seq += 5; // zaman ilerler (davetin süresi dolar)
  add('DAVE', 'member.join', { name: 'Dave', ik: K(11), ek: K(12), inv: 'EXPRDHJK22' });
  add('ERIN', 'member.join', { name: 'Erin', ik: K(13), ek: K(14), inv: 'ABCDEFGH23' }); // 3. kullanım: olur
  add('FRANK', 'member.join', { name: 'Frank', ik: K(15), ek: K(16), inv: 'ABCDEFGH23' }); // 4.: sınır dolu
  st = S.derive(events);
  assert.ok(!st.members.DAVE, 'süresi dolmuş davet kabul edilmemeli');
  assert.ok(st.members.ERIN, 'sınır içindeki kullanım kabul');
  assert.ok(!st.members.FRANK, 'kullanım sınırı dolu');
  assert.strictEqual(st.invites.ABCDEFGH23.uses, 3);

  // Yasak: üyeyi çıkarır, yeniden katılamaz; kaldırılınca katılabilir
  add('ALICE', 'ban.add', { fid: 'ERIN', reason: 'spam' });
  add('ERIN', 'member.join', { name: 'Erin', ik: K(13), ek: K(14), inv: 'CDEFGHJK45' });
  st = S.derive(events);
  assert.ok(!st.members.ERIN && st.bans.ERIN, 'yasaklı üye çıkarılır ve geri giremez');
  assert.strictEqual(st.former.ERIN.reason, 'ban');
  add('ALICE', 'ban.remove', { fid: 'ERIN' });
  add('ERIN', 'member.join', { name: 'Erin', ik: K(13), ek: K(14), inv: 'CDEFGHJK45' });
  st = S.derive(events);
  assert.ok(st.members.ERIN && !st.bans.ERIN, 'yasak kalkınca davetle katılabilir');
  assert.deepStrictEqual(st.members.ERIN.roles, [], 'geri gelen üyenin rolleri sıfırdır');

  // Barındırıcılar: yalnızca sahip teklif eder; kabul edince barındırıcı olur
  add('ALICE', 'host.offer', { fid: 'BOB' });            // sahip değil: atlanır
  add('OWNER', 'host.offer', { fid: 'BOB' });
  add('OWNER', 'host.offer', { fid: 'CAROL' });
  add('BOB', 'host.accept', {});
  add('CAROL', 'host.decline', {});
  st = S.derive(events);
  assert.deepStrictEqual(st.hosts, ['OWNER', 'BOB']);
  assert.deepStrictEqual(st.hostOffers, []);
  add('ALICE', 'member.kick', { fid: 'BOB' }); // admin, mod'u atar → barındırıcılıktan da düşer
  st = S.derive(events);
  assert.deepStrictEqual(st.hosts, ['OWNER']);
  assert.ok(!st.members.BOB);

  // Yavaş mod: 10 sn; muaf olmayan üye beklemeli, mod muaf
  add('OWNER', 'ch.update', { id: 'ch-genel', slow: 10, topic: 'Kurallar: kibar ol' });
  add('OWNER', 'ch.update', { id: 'ch-genel', slow: 7 }); // izinli adım değil: atlanır
  st = S.derive(events);
  assert.strictEqual(st.channels['ch-genel'].slow, 10);
  const slow = S.checkMessage(st, { author: 'CAROL', ch: 'ch-genel', type: 'msg', body: { text: 'a' }, ts: T0 }, { now: T0 + 4000, lastMsgAt: T0 });
  assert.strictEqual(slow.reason, 'slow');
  assert.ok(slow.wait > 5000 && slow.wait <= 6000);
  assert.ok(S.checkMessage(st, { author: 'CAROL', ch: 'ch-genel', type: 'msg', body: { text: 'a' }, ts: T0 }, { now: T0 + 11000, lastMsgAt: T0 }).ok);
  assert.ok(S.checkMessage(st, { author: 'ALICE', ch: 'ch-genel', type: 'msg', body: { text: 'a' }, ts: T0 }, { now: T0 + 1000, lastMsgAt: T0 }).ok, 'yönetici yavaş moddan muaf');
  // Başkasının mesajını silmek MANAGE_MESSAGES ister
  const target = { id: 'm1', author: 'ALICE', ch: 'ch-genel', type: 'msg' };
  assert.strictEqual(S.checkMessage(st, { author: 'CAROL', ch: 'ch-genel', type: 'msg.del', body: { target: 'm1' } }, { target }).reason, 'perm');
  assert.ok(S.checkMessage(st, { author: 'ALICE', ch: 'ch-genel', type: 'msg.del', body: { target: 'm1' } }, { target }).ok);

  // Rol silme: üyelerden ve kanal geçersiz kılmalarından temizlenir, sıralar kayar
  add('OWNER', 'role.delete', { id: 'r-mod' });
  st = S.derive(events);
  assert.ok(!st.roles['r-mod'] && !st.channels['ch-gizli'].overrides['r-mod']);
  assert.strictEqual(st.roles['r-admin'].pos, 1);

  // Sıradan bağımsızlık: olaylar karıştırılınca aynı durum
  const shuffled = events.slice().sort(() => Math.random() - 0.5);
  const a = JSON.stringify(S.derive(events));
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(JSON.stringify(S.derive(events.slice().sort(() => Math.random() - 0.5))), a, 'olay sırası sonucu değiştirmemeli');
  }
  assert.strictEqual(JSON.stringify(S.derive(shuffled)), a);

  // Anahtar geçmişi ve barındırıcı geçmişi (imza doğrulaması için)
  assert.deepStrictEqual(st.keys.ERIN, [K(13)]);
  assert.ok(st.everHosts.includes('BOB'), 'atılan eski barındırıcının geçmiş onayları geçerli kalır');
  // Sabitlenmiş kuruluş: daha eski tarihli sahte srv.create sahipliği alamaz
  const fake = { id: 'e00000', gid: 'srv1', author: 'MALLORY', type: 'srv.create', body: { name: 'Ele geçir', member: { name: 'M', ik: K(7), ek: K(8) } }, ts: T0 - 5000 };
  assert.strictEqual(S.derive(events.concat(fake)).owner, 'MALLORY', 'sabitleme olmadan en eski kuruluş kazanır');
  assert.strictEqual(S.derive(events.concat(fake), { genesis: 'e00001' }).owner, 'OWNER', 'sabitlenmiş kuruluş korunur');

  // Sunucuyu yalnızca sahip silebilir; silindikten sonra hiçbir olay uygulanmaz
  add('ALICE', 'srv.delete', {});
  st = S.derive(events);
  assert.ok(!st.deleted);
  add('OWNER', 'srv.delete', {});
  add('OWNER', 'srv.update', { name: 'Yeni' });
  st = S.derive(events);
  assert.ok(st.deleted && st.name === 'Gece Meclisi');
};

if (require.main === module) {
  module.exports().then(() => console.log('OK'), error => { console.error(error); process.exitCode = 1; });
}
