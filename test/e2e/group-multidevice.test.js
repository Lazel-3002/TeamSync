const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  spawnPeer, cleanupPeer, evalJS, waitFor, waitStableIdentity, makeFriends,
} = require('./lib/harness');

// Hesap kimliği + çoklu cihaz grupları (js/space/crypto.js, js/space/groups.js).
//  1) Göç: A eski sürüm gibi (yalnızca cihaz anahtarı) C ile grup kurar ve
//     yazar. A güncellenir → hesap kimliği üretilir, eski cihaz anahtarıyla
//     imzalı "member.rekey" yayınlanır; C kabul eder (üye anahtarı + arkadaş
//     sabiti göç eder), A'nın hesap anahtarıyla imzalı yeni mesajı C görür.
//  2) A'nın şifreli yedeği (sahte sunucu) → A2 TS2 koduyla girer, geri yükler:
//     hesap kimliği yedekten gelir; A2'nin grup mesajı C'de A olarak görünür.
//  3) A bir üyeyi çıkarır → anahtar yenilenir; A2 yeni dönemi kendi kişisel
//     konusundan alır ve C'nin yeni mesajını okur.
// TEAMSYNC_SHOTS=<klasör> verilirse ekran görüntüleri oraya yazılır.
const SHOTS = process.env.TEAMSYNC_SHOTS || '';
const UID = '0b5c2a11-7e1d-4f7a-9a41-6c2f1e7d9b10';
const rnd = () => Math.random().toString(36).slice(2, 9);

async function shot(peer, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise(r => setTimeout(r, 300));
  const res = await peer.client.send('Page.captureScreenshot', { format: 'png' });
  if (res.result && res.result.data) fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(res.result.data, 'base64'));
}
const clearToasts = peer => evalJS(peer.client, `(() => { const c = document.getElementById('toast-container'); if (c) c.innerHTML = ''; return 1; })()`);

// Sahte Supabase istemcisi (msg_backup + auth.getSession) — message-backup.test.js ile aynı.
function fakeClient(uid, rows) {
  return `(() => {
    const db = { uid: ${JSON.stringify(uid)}, rows: ${JSON.stringify(rows || [])}, bodies: [] };
    window.__fakeDb = db;
    const pick = (r, f) => f.every(([op, c, v]) => op === 'eq' ? r[c] === v : op === 'gt' ? String(r[c]) > String(v) : op === 'in' ? v.includes(r[c]) : true);
    function from(table) {
      const q = { op: 'select', cols: '*', f: [], order: null, limit: null, payload: null };
      const run = () => {
        if (table !== 'msg_backup') return { data: null, error: { message: 'unknown table' } };
        if (q.op === 'upsert') {
          db.bodies.push(JSON.stringify(q.payload));
          for (const r of q.payload) {
            const row = { ...r, size: (r.ct.length - 2) / 2 };
            const i = db.rows.findIndex(x => x.user_id === r.user_id && x.id === r.id);
            if (i >= 0) db.rows[i] = row; else db.rows.push(row);
          }
          return { data: null, error: null };
        }
        let list = db.rows.filter(r => r.user_id === db.uid).filter(r => pick(r, q.f));
        if (q.op === 'delete') { db.rows = db.rows.filter(r => !list.includes(r)); return { data: null, error: null }; }
        if (q.order) list = list.slice().sort((a, b) => (String(a[q.order]) < String(b[q.order]) ? -1 : 1));
        if (q.limit != null) list = list.slice(0, q.limit);
        const cols = q.cols.split(',');
        return { data: list.map(r => Object.fromEntries(cols.map(c => [c, r[c]]))), error: null };
      };
      const api = {
        select(c) { q.op = 'select'; q.cols = c; return api; },
        upsert(p) { q.op = 'upsert'; q.payload = p; return api; },
        delete() { q.op = 'delete'; return api; },
        eq(c, v) { q.f.push(['eq', c, v]); return api; },
        gt(c, v) { q.f.push(['gt', c, v]); return api; },
        in(c, v) { q.f.push(['in', c, v]); return api; },
        order(c) { q.order = c; return api; },
        limit(n) { q.limit = n; return api; },
        then(ok, bad) { return Promise.resolve().then(run).then(ok, bad); }
      };
      return api;
    }
    TSBackup.setClient({ from, auth: { getSession: async () => ({ data: { session: { user: { id: db.uid } } } }) } });
    return 1;
  })()`;
}

const member = (peer, gid, fid) => evalJS(peer.client, `(() => { const rt = TSGroups.get(${JSON.stringify(gid)}); const m = rt && rt.rec.members.find(x => x.fid === ${JSON.stringify(fid)}); return m ? { ik: m.ik, ek: m.ek, old: (m.old || []).map(o => o.ik) } : null; })()`);
const groupTexts = (peer, gid) => evalJS(peer.client, `TSSpaceStore.eventsOf(${JSON.stringify(gid)}).then(l => l.filter(e => e.type === 'msg').map(e => ({ a: e.author, t: e.body.text })))`, true);

module.exports = async function run() {
  const peers = [];
  try {
    const a = await spawnPeer({ port: 9631, name: 'Ayten' }); peers.push(a);
    const c = await spawnPeer({ port: 9632, name: 'Cem' }); peers.push(c);
    for (const p of [a, c]) {
      await p.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await evalJS(p.client, `applyUserLanguage('tr'); applyUserTheme('aurora'); 1`);
    }
    // ---- A: güncelleme ÖNCESİ durum (yalnızca cihaz anahtarı, hesap kimliği yok)
    const fa0 = await waitStableIdentity(a);
    await evalJS(a.client, `TSCrypto._test.deviceOnly(true).then(() => window.electronAPI.accountIdentity(${JSON.stringify(fa0)}, 'delete')).then(() => 1)`, true);
    const devA = await evalJS(a.client, `TSCrypto.publicKeysSync()`);
    assert.ok(devA && !(await evalJS(a.client, `TSCrypto.accountKeysSync()`)), 'A eski sürüm gibi');
    const { fa, fb: fc } = await makeFriends(a, c);
    assert.strictEqual(fa, fa0);
    await evalJS(a.client, `TSGroups.start().then(() => { TSProfile.request(${JSON.stringify(fc)}, 0, true); return 1; })`, true);
    await evalJS(c.client, `TSGroups.start().then(() => 1)`, true);
    await waitFor(a.client, `!!TSCrypto.peerKeys(${JSON.stringify(fc)})`, 30000, 'A, C\'nin anahtarını aldı');
    const gid = await evalJS(a.client, `TSGroups.createGroup([${JSON.stringify(fc)}], 'Proje').then(r => r.gid)`, true);
    await waitFor(c.client, `!!TSGroups.get(${JSON.stringify(gid)})`, 40000, 'C davet aldı');
    const OLD_MSG = 'eski-anahtarla-' + rnd();
    await evalJS(a.client, `TSGroups.sendMessage(${JSON.stringify(gid)}, ${JSON.stringify(OLD_MSG)}).then(() => 1)`, true);
    await waitFor(c.client, `TSSpaceStore.eventsOf(${JSON.stringify(gid)}).then(l => l.some(e => e.body && e.body.text === ${JSON.stringify(OLD_MSG)}))`, 30000, 'C eski anahtarlı mesajı aldı');
    assert.strictEqual((await member(c, gid, fa)).ik, devA.ik, 'C, A\'yı cihaz anahtarıyla tanıyor');

    // ---- A güncellenir: hesap kimliği + göç kaydı
    await evalJS(a.client, `TSCrypto._test.deviceOnly(false)`, true);
    await waitFor(a.client, `!!TSCrypto.accountKeysSync()`, 20000, 'A hesap kimliği');
    const acctA = await evalJS(a.client, `TSCrypto.accountKeysSync()`);
    assert.notStrictEqual(acctA.ik, devA.ik);
    assert.strictEqual((await evalJS(a.client, `TSCrypto.migrationProofSync()`)).ik, devA.ik, 'göç kanıtı eski cihaz anahtarıyla');
    await waitFor(c.client, `(() => { const rt = TSGroups.get(${JSON.stringify(gid)}); const m = rt && rt.rec.members.find(x => x.fid === ${JSON.stringify(fa)}); return !!(m && m.ik === ${JSON.stringify(acctA.ik)}); })()`, 40000, 'C göç kaydını kabul etti');
    const mC = await member(c, gid, fa);
    assert.ok(mC.old.includes(devA.ik), 'eski anahtar geçmiş için saklandı');
    await waitFor(c.client, `(() => { const p = TSCrypto.peerKeys(${JSON.stringify(fa)}); return !!(p && p.acct && p.ik === ${JSON.stringify(acctA.ik)} && !p.pend); })()`, 30000, 'C\'nin arkadaş sabiti göç etti (uyarısız)');
    // C'nin kalp atışı (v:2) A'ya ulaşınca A hesap anahtarıyla imzalar.
    await waitFor(a.client, `(TSGroups.get(${JSON.stringify(gid)}).rec.v2 || []).includes(${JSON.stringify(fc)})`, 40000, 'A, C\'yi yeni sürüm olarak gördü');
    const NEW_MSG = 'hesap-anahtariyla-' + rnd();
    const sent = await evalJS(a.client, `TSGroups.sendMessage(${JSON.stringify(gid)}, ${JSON.stringify(NEW_MSG)}).then(ev => ev.sig)`, true);
    await waitFor(c.client, `TSSpaceStore.eventsOf(${JSON.stringify(gid)}).then(l => l.some(e => e.body && e.body.text === ${JSON.stringify(NEW_MSG)}))`, 30000, 'C hesap anahtarlı mesajı aldı');
    const signedBy = await evalJS(c.client, `(async () => { const ev = (await TSSpaceStore.eventsOf(${JSON.stringify(gid)})).find(e => e.body && e.body.text === ${JSON.stringify(NEW_MSG)}); const { sig, ...rest } = ev; return (await TSCrypto.verify(${JSON.stringify(acctA.ik)}, rest, sig)) ? 'acct' : 'other'; })()`, true);
    assert.strictEqual(signedBy, 'acct', 'yeni mesaj hesap anahtarıyla imzalı');
    assert.ok(sent);

    // ---- A'nın yedeği (sahte sunucu): kimlik + grup + olaylar
    await evalJS(a.client, `state.accountKind = 'cloud'; state.deviceSlot = 0; 1`);
    await evalJS(a.client, fakeClient(UID, []));
    await evalJS(a.client, `TSBackup.start().then(() => 1)`, true);
    await waitFor(a.client, `(() => { const s = TSBackup.status(); return s && s.hasKey; })()`, 20000, 'A yedek anahtarı');
    await evalJS(a.client, `TSBackup.flushNow().then(() => 1)`, true);
    await waitFor(a.client, `(() => { const s = TSBackup.status(); return s && s.status === 'ok' && s.pending === 0; })()`, 30000, 'A yedekledi');
    const rows = await evalJS(a.client, `__fakeDb.rows`);
    const bodies = (await evalJS(a.client, `__fakeDb.bodies`)).join('');
    const pkcs8 = await evalJS(a.client, `TSCrypto.exportAccountIdentity().then(x => x.sk)`, true);
    assert.ok(!bodies.includes(pkcs8.slice(0, 40)) && !bodies.includes(acctA.ik.slice(0, 40)), 'kimlik sunucuya şifresiz gitmemeli');
    const code = await evalJS(a.client, `window.electronAPI.getAccountCode(0)`, true);
    assert.match(code, /^TS2-/);
    console.log(`    yedek satırları: ${rows.length}`);

    // ---- A2: TS2 koduyla ikinci cihaz
    const a2 = await spawnPeer({ port: 9633, name: 'Ayten iki' }); peers.push(a2);
    await a2.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await evalJS(a2.client, `applyUserLanguage('tr'); 1`);
    await waitStableIdentity(a2);
    const imp = await evalJS(a2.client, `window.electronAPI.importAccountCode(${JSON.stringify(code)})`, true);
    assert.ok(imp && imp.ok && imp.slot >= 1000 && imp.backupKey === true, JSON.stringify(imp));
    await evalJS(a2.client, `(() => {
      TSBackup.stop();
      const list = JSON.parse(localStorage.getItem('teamsync_device_accounts') || '[]').filter(x => x.slot !== ${imp.slot});
      list.push({ slot: ${imp.slot}, name: 'Ayten', id: ${JSON.stringify(fa)} });
      localStorage.setItem('teamsync_device_accounts', JSON.stringify(list));
      state.accountKind = 'cloud'; state.deviceSlot = ${imp.slot}; state.friendId = ${JSON.stringify(fa)}; state.myName = 'Ayten';
      switchDMAccount();
      state.friends[${JSON.stringify(fc)}] = { name: 'Cem', online: false };
      setupGlobalMQTT();
      return 1;
    })()`);
    await waitFor(a2.client, `!!(state.globalMqtt && state.globalMqtt.connected && globalMqttIdentity === ${JSON.stringify(fa)})`, 30000, 'A2 kişisel konu');
    assert.strictEqual(await evalJS(a2.client, `TSCrypto.ensureIdentity().then(() => TSCrypto.accountKeysSync())`, true), null, 'kodla eklenen cihaz kimlik ÜRETMEZ');
    await evalJS(a2.client, `TSGroups.start().then(() => 1)`, true);
    await evalJS(a2.client, fakeClient(UID, rows));
    await evalJS(a2.client, `TSBackup.start(); 1`);
    await waitFor(a2.client, `(() => { const s = TSBackup.status(); return s && s.lastRestore && !document.getElementById('backup-progress'); })()`, 60000, 'A2 geri yükledi');
    await waitFor(a2.client, `(() => { const k = TSCrypto.accountKeysSync(); return !!(k && k.ik === ${JSON.stringify(acctA.ik)}); })()`, 20000, 'A2 hesap kimliği yedekten');
    await waitFor(a2.client, `!!TSGroups.get(${JSON.stringify(gid)})`, 20000, 'A2 grubu açtı');
    assert.strictEqual((await member(a2, gid, fa)).ik, acctA.ik, 'A2 kendi kaydını hesap anahtarıyla görüyor');
    assert.ok(await evalJS(a2.client, `!!(TSCrypto.peerKeys(${JSON.stringify(fc)}) || {}).ik`), 'C\'nin anahtarı yedekten');

    // A2 gruba yazar → C kabul eder, A olarak gösterir.
    const A2_MSG = 'ikinci-cihazdan-' + rnd();
    await evalJS(a2.client, `TSGroups.sendMessage(${JSON.stringify(gid)}, ${JSON.stringify(A2_MSG)}).then(() => 1)`, true);
    await waitFor(c.client, `TSSpaceStore.eventsOf(${JSON.stringify(gid)}).then(l => l.some(e => e.body && e.body.text === ${JSON.stringify(A2_MSG)} && e.author === ${JSON.stringify(fa)}))`, 30000, 'C, A2\'nin mesajını kabul etti');
    await waitFor(a.client, `TSSpaceStore.eventsOf(${JSON.stringify(gid)}).then(l => l.some(e => e.body && e.body.text === ${JSON.stringify(A2_MSG)}))`, 30000, 'A (ilk cihaz) da gördü');
    await clearToasts(c);
    await evalJS(c.client, `TSShell.setView('group', ${JSON.stringify(gid)}); 1`);
    await waitFor(c.client, `(document.getElementById('grp-messages') || {}).textContent && document.getElementById('grp-messages').textContent.includes(${JSON.stringify(A2_MSG)})`, 15000, 'C görünümünde');
    const shown = await evalJS(c.client, `(() => { const box = document.getElementById('grp-messages'); return box.textContent; })()`);
    assert.ok(shown.includes('Ayten'), 'A2 mesajı A adıyla');
    await shot(c, 'e2e-group-a2-on-c');

    // ---- Anahtar yenileme: A sahte bir üyeyi ekleyip çıkarır.
    const F = 'KNK-F00DCAFE-1111-4222-8333-' + Date.now().toString(16).toUpperCase().padStart(12, '0').slice(-12);
    const epoch0 = await evalJS(a.client, `TSGroups.get(${JSON.stringify(gid)}).rec.epoch`);
    await evalJS(a.client, `(async () => {
      const F = ${JSON.stringify(F)};
      const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const dh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const ik = TSCrypto.b64(await crypto.subtle.exportKey('spki', sign.publicKey));
      const ek = TSCrypto.b64(await crypto.subtle.exportKey('spki', dh.publicKey));
      state.friends[F] = { name: 'Fatih', online: false };
      TSCrypto.rememberPeer(F, { ik, ek });
      await TSGroups.invite(${JSON.stringify(gid)}, F);
      await new Promise(r => setTimeout(r, 1500));
      await TSGroups.kick(${JSON.stringify(gid)}, F);
      return 1;
    })()`, true);
    const epoch1 = await evalJS(a.client, `TSGroups.get(${JSON.stringify(gid)}).rec.epoch`);
    assert.ok(epoch1 > epoch0, 'anahtar dönemi arttı');
    await waitFor(c.client, `TSGroups.get(${JSON.stringify(gid)}).rec.epoch === ${epoch1}`, 30000, 'C yeni dönemde');
    await waitFor(a2.client, `TSGroups.get(${JSON.stringify(gid)}).rec.epoch === ${epoch1}`, 30000, 'A2 yeni dönemi kendi konusundan aldı');
    const ROT_MSG = 'yeni-donem-' + rnd();
    await evalJS(c.client, `TSGroups.sendMessage(${JSON.stringify(gid)}, ${JSON.stringify(ROT_MSG)}).then(() => 1)`, true);
    await waitFor(a2.client, `TSSpaceStore.eventsOf(${JSON.stringify(gid)}).then(l => l.some(e => e.body && e.body.text === ${JSON.stringify(ROT_MSG)}))`, 30000, 'A2 yeni dönemin mesajını okudu');
    const ROT_A2 = 'yeni-donem-a2-' + rnd();
    await evalJS(a2.client, `TSGroups.sendMessage(${JSON.stringify(gid)}, ${JSON.stringify(ROT_A2)}).then(() => 1)`, true);
    await waitFor(c.client, `TSSpaceStore.eventsOf(${JSON.stringify(gid)}).then(l => l.some(e => e.body && e.body.text === ${JSON.stringify(ROT_A2)}))`, 30000, 'C, A2\'nin yeni dönem mesajını aldı');
    // Eski (cihaz anahtarlı) mesaj C'de hâlâ duruyor ve doğrulanabiliyor.
    const cTexts = (await groupTexts(c, gid)).map(x => x.t);
    for (const t of [OLD_MSG, NEW_MSG, A2_MSG, ROT_MSG, ROT_A2]) assert.ok(cTexts.includes(t), 'C\'de eksik: ' + t);
    const oldOk = await evalJS(c.client, `(async () => { const ev = (await TSSpaceStore.eventsOf(${JSON.stringify(gid)})).find(e => e.body && e.body.text === ${JSON.stringify(OLD_MSG)}); const { sig, ...rest } = ev; return TSCrypto.verify(${JSON.stringify(devA.ik)}, rest, sig); })()`, true);
    assert.ok(oldOk, 'eski mesaj eski anahtarla doğrulanıyor');
  } finally {
    peers.forEach(cleanupPeer);
  }
};

if (require.main === module) {
  module.exports().then(() => { console.log('PASS group-multidevice'); process.exit(0); })
    .catch((e) => { console.error('FAIL group-multidevice', e); process.exit(1); });
}
