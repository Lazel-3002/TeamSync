const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  spawnPeer, cleanupPeer, evalJS, waitFor, waitStableIdentity,
} = require('./lib/harness');

// Uçtan uca şifreli mesaj yedeği (js/msg-backup.js). Gerçek sunucu GEREKMEZ:
// her pencereye bellek içi sahte bir Supabase istemcisi verilir (user_id'ye
// göre RLS'i taklit eder); "sunucu" satırları test sürecinde A'dan B'ye
// kopyalanır.
//  1) A: DM (metin + görsel) ve grup mesajları → şifreli satırlar; satırlarda
//     düz metin, arkadaş/grup kimliği, data: yok; gizlilik korumaları fırlatır.
//  2) B, A'nın TS2 koduyla girer → geri yükleme → aynı DM metinleri ve grup
//     sohbeti; görsel yalnızca kayıt (içerik yok); silinen grup mesajı yok.
//  3) TS1 kodu (K yok) → B anahtarı A açıkken acct_dev ile alır → geri yükler.
//  4) Kod yenileme K'yı değiştirmez.
// TEAMSYNC_SHOTS=<klasör> verilirse ekran görüntüleri oraya yazılır.
const SHOTS = process.env.TEAMSYNC_SHOTS || '';
const UID = '6d1f6a8e-0c4b-4c55-9a51-3f0a8d1b2c3d';
const FRIEND = 'KNK-7A3C2B1E-90AB-4CDE-8F12-3456789ABCDE';
const TEXTS = ['merhaba cem bu bir deneme', 'selam A nasılsın', 'grup merhaba A', 'grup selam C'];
const DELETED = 'bu grup mesajı silinecek';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function shot(peer, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise(r => setTimeout(r, 200));
  const res = await peer.client.send('Page.captureScreenshot', { format: 'png' });
  if (res.result && res.result.data) fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(res.result.data, 'base64'));
}
const clearToasts = peer => evalJS(peer.client, `(() => { const c = document.getElementById('toast-container'); if (c) c.innerHTML = ''; return 1; })()`);

// Sahte Supabase istemcisi (yalnızca msg_backup ve auth.getSession).
function fakeClient(uid, rows, delayMs) {
  return `(() => {
    const db = { uid: ${JSON.stringify(uid)}, rows: ${JSON.stringify(rows || [])}, bodies: [], delay: ${delayMs | 0}, offline: false };
    window.__fakeDb = db;
    const pick = (r, f) => f.every(([op, c, v]) => op === 'eq' ? r[c] === v : op === 'gt' ? String(r[c]) > String(v) : op === 'in' ? v.includes(r[c]) : true);
    function from(table) {
      const q = { op: 'select', cols: '*', f: [], order: null, limit: null, payload: null };
      const run = () => {
        if (table !== 'msg_backup') return { data: null, error: { message: 'unknown table' } };
        if (db.offline) return { data: null, error: { message: 'offline' } };
        if (q.op === 'upsert') {
          db.bodies.push(JSON.stringify(q.payload));
          for (const r of q.payload) {
            if (r.user_id !== db.uid) return { data: null, error: { message: 'rls' } };
            if ((r.ct.length - 2) / 2 > 65536) return { data: null, error: { message: 'check' } };
            const row = { ...r, size: (r.ct.length - 2) / 2 };
            const i = db.rows.findIndex(x => x.user_id === r.user_id && x.id === r.id);
            if (i >= 0) db.rows[i] = row; else db.rows.push(row);
          }
          return { data: null, error: null };
        }
        let list = db.rows.filter(r => r.user_id === db.uid).filter(r => pick(r, q.f));   // RLS
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
        then(ok, bad) { return new Promise(r => setTimeout(r, q.op === 'select' ? db.delay : 0)).then(run).then(ok, bad); }
      };
      return api;
    }
    TSBackup.setClient({ from, auth: { getSession: async () => ({ data: { session: { user: { id: db.uid } } } }) } });
    window.__bkHist = [];
    document.addEventListener('ts:backup', e => window.__bkHist.push(e.detail.status));
    return 1;
  })()`;
}

async function settled(peer, label) {
  await evalJS(peer.client, `TSBackup.flushNow().then(() => 1)`, true);
  await waitFor(peer.client, `(() => { const s = TSBackup.status(); return s && s.hasKey && s.status === 'ok' && s.pending === 0; })()`, 30000, label);
}

// B'yi A'nın hesabına geçirir (Kodla Giriş Yap'ın yaptığı yerel adımlar).
async function becomeAccount(peer, slot, fid) {
  await evalJS(peer.client, `(() => {
    TSBackup.stop();
    const list = JSON.parse(localStorage.getItem('teamsync_device_accounts') || '[]').filter(a => a.slot !== ${slot});
    list.push({ slot: ${slot}, name: 'Yedek A', id: ${JSON.stringify(fid)} });
    localStorage.setItem('teamsync_device_accounts', JSON.stringify(list));
    state.accountKind = 'cloud'; state.deviceSlot = ${slot}; state.friendId = ${JSON.stringify(fid)};
    switchDMAccount();
    state.friends[${JSON.stringify(FRIEND)}] = { name: 'Cem', online: false };
    setupGlobalMQTT();
    return 1;
  })()`);
  await waitFor(peer.client, `!!(state.globalMqtt && state.globalMqtt.connected && globalMqttIdentity === ${JSON.stringify(fid)})`, 30000, 'kişisel konu');
}

function assertNoLeak(rows, bodies, secrets) {
  const all = JSON.stringify(rows) + bodies.join('');
  for (const s of secrets) assert.ok(!all.includes(s), 'sunucu verisinde açık metin/kimlik: ' + s);
  assert.ok(!/data:|blob:/i.test(all), 'sunucu verisinde data:/blob:');
  assert.ok(!/iVBORw0KGgo|\/9j\/|R0lGOD|UklGR/.test(all), 'sunucu verisinde görsel imzası');
  for (const r of rows) {
    assert.ok(/^[0-9a-f]{32}$/.test(r.id) || r.id === 'keycheck', 'opak id: ' + r.id);
    assert.ok(/^[0-9a-f]{32}$/.test(r.conv) || r.conv === 'keycheck', 'opak conv: ' + r.conv);
    assert.ok(/^\\x[0-9a-f]+$/.test(r.ct) && /^\\x[0-9a-f]{24}$/.test(r.nonce), 'bytea hex');
    assert.ok(/:00\.000Z$/.test(r.ts), 'dakikaya yuvarlanmış ts: ' + r.ts);
  }
}

module.exports = async function run() {
  const a = await spawnPeer({ port: 9811, name: 'Yedek A' });
  let b = null;
  try {
    await a.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
    await evalJS(a.client, `applyUserLanguage('tr'); 1`);
    const fa = await waitStableIdentity(a);
    await evalJS(a.client, `state.accountKind = 'cloud'; state.deviceSlot = 0; 1`);
    const ts1Before = await evalJS(a.client, `window.electronAPI.getAccountCode(0)`, true);
    assert.match(ts1Before, /^TS1-/, 'yedek açılmadan önce TS1');

    // ---- 1) A: yedek açılır, K üretilir, kod TS2 olur.
    await evalJS(a.client, fakeClient(UID, []));
    await evalJS(a.client, `TSBackup.start().then(() => 1)`, true);
    await waitFor(a.client, `(() => { const s = TSBackup.status(); return s && s.hasKey; })()`, 20000, 'A anahtarı');
    const codeA = await evalJS(a.client, `window.electronAPI.getAccountCode(0)`, true);
    assert.match(codeA, /^TS2-[0-9a-f]{40}-0-[A-Za-z0-9_-]{43}-[A-Za-z0-9_-]{43}$/, codeA);
    assert.strictEqual(codeA.slice(4, codeA.length - 44), ts1Before.slice(4), 'TS2 = TS1 + K');

    // DM: gönder, al, görsel al.
    await evalJS(a.client, `(async () => {
      state.friends[${JSON.stringify(FRIEND)}] = { name: 'Cem', online: false };
      state.activeDM = ${JSON.stringify(FRIEND)};
      await window.sendDMText(${JSON.stringify(TEXTS[0])});
      await window.receiveDM(${JSON.stringify(FRIEND)}, { type: 'dm_msg', msgType: 'text', content: ${JSON.stringify(TEXTS[1])}, mid: crypto.randomUUID() });
      await window.receiveDM(${JSON.stringify(FRIEND)}, { type: 'dm_msg', msgType: 'image', content: ${JSON.stringify(PNG)}, mid: crypto.randomUUID() });
      state.dms[${JSON.stringify(FRIEND)}][2].fileName = 'tatil.png';
      saveDMs();
      return 1;
    })()`, true);

    // Grup: sahte üye C (gerçek ECDSA anahtarı) + A'nın ve C'nin mesajları + silinen mesaj.
    const gid = await evalJS(a.client, `(async () => {
      await TSGroups.start();
      const F = ${JSON.stringify(FRIEND)};
      const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const dh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const ik = TSCrypto.b64(await crypto.subtle.exportKey('spki', sign.publicKey));
      const ek = TSCrypto.b64(await crypto.subtle.exportKey('spki', dh.publicKey));
      TSCrypto.rememberPeer(F, { ik, ek });
      const { gid } = await TSGroups.createGroup([F], 'Proje ekibi');
      await TSGroups.sendMessage(gid, ${JSON.stringify(TEXTS[2])});
      const rt = TSGroups.get(gid);
      const ev = { id: crypto.randomUUID(), gid, author: F, type: 'msg', body: { text: ${JSON.stringify(TEXTS[3])} }, ts: Date.now() };
      const sig = TSCrypto.b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sign.privateKey, new TextEncoder().encode(TSCrypto.canonical(ev))));
      const sealed = await TSCrypto.encrypt(rt.key, JSON.stringify({ k: 'ev', ev: { ...ev, sig } }));
      await TSGroups.onMqtt('teamsync/s/' + rt.T + '/ev', JSON.stringify({ v: 1, e: rt.rec.epoch, iv: sealed.iv, ct: sealed.ct }));
      const del = await TSGroups.sendMessage(gid, ${JSON.stringify(DELETED)});
      await TSGroups.deleteMessage(gid, del.id);
      return gid;
    })()`, true);
    const aEvents = await evalJS(a.client, `TSSpaceStore.eventsOf(${JSON.stringify(gid)}).then(l => l.filter(e => e.type === 'msg').map(e => e.body.text))`, true);
    assert.ok(aEvents.includes(TEXTS[3]), 'C mesajı A\'da doğrulandı: ' + JSON.stringify(aEvents));

    await settled(a, 'A yedekledi');
    const server = await evalJS(a.client, `({ rows: __fakeDb.rows, bodies: __fakeDb.bodies })`);
    console.log(`    sunucu satırları: ${server.rows.length}, yükleme gövdesi: ${server.bodies.length}`);
    assert.ok(server.rows.length >= 9, 'beklenen satır sayısı: ' + server.rows.length);
    assertNoLeak(server.rows, server.bodies, [...TEXTS, DELETED, FRIEND, fa, gid, 'tatil.png', 'Proje ekibi', 'Cem']);
    assert.ok(server.rows.some(r => r.deleted), 'silinen grup mesajı "deleted" işaretli olmalı');
    assert.ok(server.rows.every(r => r.user_id === UID));

    // Gizlilik korumaları (birim tarzı).
    const guard = await evalJS(a.client, `(() => {
      const throws = f => { try { f(); return false; } catch (e) { return e.code || true; } };
      return {
        dataUrl: throws(() => TSBackup._guard.assertPlainSafe({ k: 'dm', c: ${JSON.stringify(PNG)} })),
        blob: throws(() => TSBackup._guard.assertPlainSafe({ k: 'dm', x: [{ y: 'blob:https://x/1' }] })),
        big: throws(() => TSBackup._guard.assertPlainSafe({ k: 'dm', c: 'a'.repeat(70000) })),
        b64: throws(() => TSBackup._guard.assertPlainSafe({ k: 'dm', c: 'iVBORw0KGgo' + 'A'.repeat(600) })),
        ok: throws(() => TSBackup._guard.assertPlainSafe({ k: 'dm', c: 'normal mesaj: data yok' })),
        body: throws(() => TSBackup._guard.assertBodySafe([{ ct: 'data:image/png;base64,AAA' }])),
        bodyOk: throws(() => TSBackup._guard.assertBodySafe(__fakeDb.bodies.join(''))),
      };
    })()`);
    assert.deepStrictEqual(guard, { dataUrl: 'unsafe', blob: 'unsafe', big: 'toolarge', b64: 'unsafe', ok: false, body: 'unsafe', bodyOk: false }, JSON.stringify(guard));

    // Ayarlar > Hesap ve Cihaz > Mesaj yedeği kartı.
    await clearToasts(a);
    await evalJS(a.client, `openUserSettings('account'); 1`);
    await waitFor(a.client, `!!document.getElementById('backup-enabled') && /Son yedek/.test(document.getElementById('backup-status').textContent)`, 15000, 'kart');
    const card = await evalJS(a.client, `(() => ({
      on: document.getElementById('backup-enabled').checked,
      status: document.getElementById('backup-status').textContent,
      text: document.getElementById('settings-backup-card').textContent,
      restoreDisabled: document.getElementById('backup-restore-btn').disabled,
    }))()`);
    assert.ok(card.on && !card.restoreDisabled, JSON.stringify(card));
    assert.ok(/Son yedek: .+ · \d+ kayıt · .+ \/ 20 MB/.test(card.status), card.status);
    assert.ok(card.text.includes('asla sunucuya yüklenmez') && card.text.includes('kurtaramayız'), card.text);
    await evalJS(a.client, `document.getElementById('settings-backup-card').scrollIntoView({ block: 'center' }); 1`);
    await shot(a, 'backup-card-aurora');
    await evalJS(a.client, `applyUserTheme('white'); 1`);
    await shot(a, 'backup-card-white');
    // Silme onayı (iptal edilir).
    await evalJS(a.client, `document.getElementById('backup-delete-btn').click(); 1`);
    await waitFor(a.client, `(() => { const m = document.getElementById('generic-confirm-modal'); return !!m && !m.classList.contains('hidden'); })()`, 5000, 'silme onayı');
    const confirmText = await evalJS(a.client, `document.getElementById('generic-confirm-modal').textContent`);
    assert.ok(confirmText.includes('Sunucudaki yedek silinsin mi?'), confirmText);
    await shot(a, 'backup-delete-confirm-white');
    await evalJS(a.client, `applyUserTheme('aurora'); 1`);
    await shot(a, 'backup-delete-confirm-aurora');
    await evalJS(a.client, `(document.getElementById('generic-confirm-no') || document.querySelector('#generic-confirm-modal .btn-sec, #generic-confirm-modal button:not(.btn-pri)')).click(); 1`);
    // Bağlantılar > Yeni cihaz bağlama: yedek satırı.
    await evalJS(a.client, `setSettingsPanel('network'); 1`);
    await waitFor(a.client, `!!document.querySelector('#net-newdev [data-backup="on"]')`, 10000, 'yeni cihaz yedek satırı');
    await evalJS(a.client, `document.getElementById('settings-v2-close').click(); 1`);

    // ---- 2) B: TS2 koduyla giriş → geri yükleme.
    b = await spawnPeer({ port: 9812, name: 'Yedek B' });
    await b.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
    await evalJS(b.client, `applyUserLanguage('tr'); 1`);
    await waitStableIdentity(b);
    const imp = await evalJS(b.client, `window.electronAPI.importAccountCode(${JSON.stringify(codeA)})`, true);
    assert.ok(imp && imp.ok && imp.slot >= 1000 && imp.backupKey === true, JSON.stringify(imp));
    await becomeAccount(b, imp.slot, fa);
    const rowsNow = await evalJS(a.client, `__fakeDb.rows`);
    const foreign = { ...rowsNow[0], user_id: '00000000-0000-0000-0000-000000000001', id: 'f'.repeat(32) };
    await evalJS(b.client, fakeClient(UID, [...rowsNow, foreign], 1200));
    await evalJS(b.client, `TSBackup.start(); 1`);
    await waitFor(b.client, `!!document.getElementById('backup-progress')`, 15000, 'ilerleme');
    await clearToasts(b);
    await shot(b, 'backup-restore-progress-aurora');
    await waitFor(b.client, `(() => { const s = TSBackup.status(); return s && s.lastRestore && !document.getElementById('backup-progress'); })()`, 60000, 'B geri yükledi');
    const bRes = await evalJS(b.client, `(async () => {
      const list = state.dms[${JSON.stringify(FRIEND)}] || [];
      const evs = await TSSpaceStore.eventsOf(${JSON.stringify(gid)});
      const g = TSGroups.list().find(x => x.gid === ${JSON.stringify(gid)});
      const img = list.find(m => m.type === 'image');
      return {
        texts: list.filter(m => m.type === 'text').map(m => m.content),
        img: img ? { content: img.content, restored: !!img.restored, fileName: img.fileName, html: dmContentHtml(img) } : null,
        gtexts: evs.filter(e => e.type === 'msg').map(e => e.body.text),
        group: g ? g.title : null,
        last: TSBackup.status().lastRestore,
      };
    })()`, true);
    console.log('    B geri yükleme:', JSON.stringify(bRes.last));
    assert.deepStrictEqual(bRes.texts, [TEXTS[0], TEXTS[1]], JSON.stringify(bRes));
    assert.ok(bRes.img && bRes.img.content === '' && bRes.img.restored && bRes.img.fileName === 'tatil.png', JSON.stringify(bRes.img));
    assert.ok(!bRes.img.html.includes('<img') && bRes.img.html.includes('yalnızca kaydı geri geldi'), bRes.img.html);
    assert.ok(bRes.gtexts.includes(TEXTS[2]) && bRes.gtexts.includes(TEXTS[3]), JSON.stringify(bRes.gtexts));
    assert.ok(!bRes.gtexts.includes(DELETED), 'silinen grup mesajı geri gelmemeli');
    assert.strictEqual(bRes.group, 'Proje ekibi');
    await clearToasts(b);
    await evalJS(b.client, `TSShell.setView('dm', ${JSON.stringify(FRIEND)}); 1`);
    await waitFor(b.client, `!!document.querySelector('.dm-restored-stub')`, 10000, 'DM görünümünde kayıt');
    await shot(b, 'backup-restored-dm-aurora');
    await evalJS(b.client, `TSShell.setView('group', ${JSON.stringify(gid)}); 1`);
    await new Promise(r => setTimeout(r, 1200));
    await shot(b, 'backup-restored-group-aurora');
    await waitFor(b.client, `(() => { const s = TSBackup.status(); return s.status === 'ok' && s.pending === 0; })()`, 20000, 'B sakin');
    const reup = await evalJS(b.client, `__fakeDb.bodies.length`);
    assert.ok(reup <= 1, 'geri yüklenen kayıtlar yeniden yüklenmemeli (gövde: ' + reup + ')');

    // ---- 3) TS1 kodu (K yok) → anahtar A'dan acct_dev ile.
    const ts1 = 'TS1' + codeA.slice(3, codeA.length - 44);
    await evalJS(b.client, `(async () => {
      TSBackup.stop();
      await window.electronAPI.forgetImportedAccount(${imp.slot});
      localStorage.removeItem('teamsync_backup_' + ${JSON.stringify(fa)});
      await new Promise(r => { const q = indexedDB.deleteDatabase('ts-backup-' + ${JSON.stringify(fa)}); q.onsuccess = q.onerror = q.onblocked = r; });
      state.dms = {}; saveDMs();
      return 1;
    })()`, true);
    const imp1 = await evalJS(b.client, `window.electronAPI.importAccountCode(${JSON.stringify(ts1)})`, true);
    assert.ok(imp1 && imp1.ok && imp1.backupKey === false, JSON.stringify(imp1));
    assert.strictEqual(await evalJS(b.client, `window.electronAPI.backupKey(${imp1.slot}, 'get')`, true), null, 'TS1 ile K gelmez');
    await becomeAccount(b, imp1.slot, fa);
    await evalJS(b.client, fakeClient(UID, await evalJS(a.client, `__fakeDb.rows`), 0));
    await evalJS(b.client, `TSBackup.start(); 1`);
    await waitFor(b.client, `window.__bkHist.includes('needKey')`, 20000, 'needKey');
    // Anahtar beklenirken gösterilen metin (durum çoktan değişmiş olabilir).
    const needText = await evalJS(b.client, `t('backup.needKey')`);
    assert.ok(needText.includes('diğer bilgisayarı aç'), needText);
    await evalJS(b.client, `openUserSettings('account'); 1`);
    await waitFor(b.client, `!!document.querySelector('#backup-status .backup-status-text') && document.querySelector('#backup-status .backup-status-text').textContent.length > 5`, 15000, 'B kartı');
    await evalJS(b.client, `document.getElementById('settings-backup-card').scrollIntoView({ block: 'center' }); 1`);
    await clearToasts(b);
    await shot(b, 'backup-card-ts1-b');
    console.log('    B (TS1) geçmiş:', JSON.stringify(await evalJS(b.client, `window.__bkHist`)));
    await waitFor(b.client, `(() => { const s = TSBackup.status(); return s && s.hasKey && s.lastRestore; })()`, 60000, 'B anahtarı acct_dev ile aldı ve geri yükledi');
    const b2 = await evalJS(b.client, `(state.dms[${JSON.stringify(FRIEND)}] || []).filter(m => m.type === 'text').map(m => m.content)`);
    assert.deepStrictEqual(b2, [TEXTS[0], TEXTS[1]]);
    const kA = await evalJS(a.client, `window.electronAPI.backupKey(0, 'get')`, true);
    const kB = await evalJS(b.client, `window.electronAPI.backupKey(${imp1.slot}, 'get')`, true);
    assert.ok(kA && kA === kB, 'iki cihazda aynı K');
    await evalJS(b.client, `document.getElementById('settings-v2-close').click(); 1`);

    // ---- 4) Kod yenileme K'yı korur.
    const r1 = await evalJS(a.client, `window.electronAPI.codeRotation(0, 'begin')`, true);
    assert.ok(r1 && r1.password);
    await evalJS(a.client, `window.electronAPI.codeRotation(0, 'commit')`, true);
    const codeRot = await evalJS(a.client, `window.electronAPI.getAccountCode(0)`, true);
    assert.match(codeRot, /^TS2-/);
    assert.notStrictEqual(codeRot, codeA, 'kod değişmeli');
    assert.strictEqual(codeRot.slice(-43), codeA.slice(-43), 'K aynı kalmalı');
    assert.strictEqual(await evalJS(a.client, `window.electronAPI.backupKey(0, 'get')`, true), kA);
  } finally {
    cleanupPeer(a);
    if (b) cleanupPeer(b);
  }
};

if (require.main === module) {
  module.exports().then(() => { console.log('PASS message-backup'); process.exit(0); })
    .catch((e) => { console.error('FAIL message-backup', e); process.exit(1); });
}
