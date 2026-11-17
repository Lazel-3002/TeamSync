// Uçtan uca şifreli MESAJ YEDEĞİ (Ayarlar > Hesap ve Cihaz > Mesaj yedeği).
//
// Sunucuya (Supabase, public.msg_backup) yalnızca şunlar gider:
//   id    = HMAC_K("dm|<arkadaş>|<mesaj>") vb., 128 bit hex — açık kimlik yok
//   conv  = HMAC_K("dm|<arkadaş>") / ("g|<grup>") / ("sv|<sunucu>")
//   ts    = dakikaya yuvarlanmış zaman, v = biçim sürümü
//   nonce + ct = AES-GCM(K_enc, JSON zarf), AAD = "tsb1|<id>" (satırlar takas edilemez)
// K: hesap başına rastgele 256 bit; main.js'te DPAPI ile saklanır (backup-key
// IPC). Sunucu K'yı ya da onu türetebileceği hiçbir şeyi görmez (Supabase
// parolası K'nın kaynağı DEĞİLDİR). K yeni cihaza ya TS2 giriş koduyla ya da
// hesabın açık bir cihazından `acct_dev` kanalıyla ({k:'bkreq'} / {k:'bkkey'})
// gelir. Sunucudaki "keycheck" satırı, cihazdaki K'nın yedekle eşleştiğini
// doğrular.
//
// Yedeklenen: DM metinleri (+ tepki, sayaç, zaman); metin olmayan DM'lerde
// yalnızca {tür, dosya adı, zaman} — İÇERİK ASLA (sealRow'daki sert koruma
// data:/blob: ile başlayan her metni reddeder). Arkadaş grubu kayıtları (grup
// anahtarı dahil) + imzalı metin olayları. Sunucu (sv-) üyelik kayıtları.
// Sunucu kanal mesajları yedeklenmez (barındırıcılar zaten verir).
(function () {
  'use strict';

  const TABLE = 'msg_backup';
  const FORMAT = 1;
  const PLAIN_MAX = 60000;                // bayt; sunucu: octet_length(ct) ≤ 65536
  const QUOTA = 20 * 1024 * 1024;         // kullanıcı başına (istemcide uygulanır)
  const PRUNE_TO = 18 * 1024 * 1024;
  const BATCH = 40;
  const PAGE = 500;
  const DEBOUNCE = 3000;
  const BACKOFF = [5000, 15000, 60000, 300000];
  const KEY_ASK_EVERY = 20000;
  const USAGE_EVERY = 10 * 60 * 1000;
  const GROUP_TYPES = new Set(['msg', 'msg.del', 'react', 'rename', 'member.add', 'member.remove', 'member.leave']);
  const REC_DROP = ['unread', 'mentions', 'unconfirmed', 'readAt', 'lastCh', 'dirPublished'];
  const SIG_RE = /iVBORw0KGgo|\/9j\/|R0lGOD|UklGR|AAAAIGZ0eX|JVBERi0/;

  const $ = id => document.getElementById(id);
  const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : key);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = (name, size = 16) => (window.TSUI && typeof window.TSUI.icon === 'function' ? window.TSUI.icon(name, size) : '');
  const st = () => window.state || {};
  const api = () => window.electronAPI || {};
  const te = new TextEncoder();
  const td = new TextDecoder();
  const subtle = window.crypto.subtle;
  const validFid = f => typeof f === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(f);
  const toast = (msg, kind) => { if (typeof window.showToast === 'function') window.showToast(msg, kind); };
  const withTimeout = (p, ms, fallback) => Promise.race([
    Promise.resolve(p).catch(e => ({ error: e || { message: 'error' } })),
    new Promise(r => setTimeout(() => r(fallback), ms))
  ]);
  const TIMEOUT = { error: { message: 'timeout' } };

  // Testler sahte bir istemci verebilir (test/e2e/message-backup.test.js).
  let override = null;
  const db = () => override || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);

  // ------------------------------------------------------------ bayt yardımcıları
  const hex = bytes => Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  function unhex(str) {
    const s = String(str || '').replace(/^\\x/, '');
    if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('bad-hex');
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  const pgBytes = bytes => '\\x' + hex(bytes);
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  const fpOf = env => fnv(JSON.stringify(env)) + ':' + JSON.stringify(env).length;
  const minuteIso = ts => {
    const n = Number(ts);
    const v = Number.isFinite(n) && n > 0 ? n : Date.now();
    return new Date(Math.floor(v / 60000) * 60000).toISOString();
  };
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });

  // ------------------------------------------------------------ gizlilik koruması
  // Şifrelemeden HEMEN önce: data:/blob: ile başlayan herhangi bir metin ya da
  // dosya baytı gibi görünen uzun base64 → hata. Düz metin sınırı da burada.
  function assertPlainSafe(env, text) {
    const walk = v => {
      if (typeof v === 'string') {
        const head = v.trimStart().slice(0, 5).toLowerCase();
        if (head === 'data:' || head === 'blob:') throw err('unsafe', 'data/blob url in backup');
        if (v.length >= 512 && /^[A-Za-z0-9+/=\s]+$/.test(v) && SIG_RE.test(v)) throw err('unsafe', 'file bytes in backup');
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k]));
    };
    walk(env);
    if (te.encode(text).length > PLAIN_MAX) throw err('toolarge', 'plaintext too large');
  }
  // Sunucuya giden gövde: yalnızca hex/ISO olmalı. Son bir kez denetlenir.
  function assertBodySafe(body) {
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    if (/data:|blob:/i.test(s) || SIG_RE.test(s)) throw err('unsafe', 'unsafe upload body');
    return true;
  }

  // ------------------------------------------------------------------- anahtarlar
  async function deriveKeys(keyHex) {
    const base = await subtle.importKey('raw', unhex(keyHex), 'HKDF', false, ['deriveKey']);
    const p = info => ({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('teamsync-backup-v1'), info: te.encode(info) });
    const enc = await subtle.deriveKey(p('enc'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const mac = await subtle.deriveKey(p('mac'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    return { hex: keyHex, enc, mac };
  }

  async function hid(my, label) {
    const hit = my.hidCache.get(label);
    if (hit) return hit;
    const v = hex(await subtle.sign('HMAC', my.keys.mac, te.encode(label))).slice(0, 32);
    if (my.hidCache.size > 200000) my.hidCache.clear();
    my.hidCache.set(label, v);
    return v;
  }

  async function sealRow(keys, id, env) {
    const text = JSON.stringify(env);
    assertPlainSafe(env, text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('tsb1|' + id) }, keys.enc, te.encode(text));
    return { nonce: pgBytes(iv), ct: pgBytes(ct), size: ct.byteLength };
  }

  async function openRow(keys, row) {
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unhex(row.nonce), additionalData: te.encode('tsb1|' + row.id) }, keys.enc, unhex(row.ct));
    const env = JSON.parse(td.decode(plain));
    if (!env || typeof env !== 'object' || typeof env.k !== 'string') throw new Error('bad-env');
    return env;
  }

  // ------------------------------------------------------------ yerel durum
  const PREFS_KEY = fid => `teamsync_backup_${fid}`;
  function loadPrefs(fid) {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY(fid)) || '{}') || {}; } catch (e) { return {}; }
  }
  function savePrefs(my) {
    try { localStorage.setItem(PREFS_KEY(my.fid), JSON.stringify(my.prefs)); } catch (e) {}
  }

  // Gönderilenler: id → { fp, size, kind, conv } (IndexedDB ts-backup-<KNK>).
  // Bu, kalıcı kuyruğun ta kendisidir: yeniden başlatmada yerel veri ile bu
  // harita karşılaştırılır, eksik/değişen ne varsa gönderilir.
  function idbOpen(fid) {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('ts-backup-' + fid, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('sent');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function loadSent(my) {
    my.idb = await idbOpen(my.fid);
    return new Promise(resolve => {
      const out = new Map();
      const req = my.idb.transaction('sent').objectStore('sent').openCursor();
      req.onsuccess = e => { const c = e.target.result; if (!c) { resolve(out); return; } out.set(c.key, c.value); c.continue(); };
      req.onerror = () => resolve(out);
    });
  }
  function saveSent(my, entries) {
    entries.forEach(([id, v]) => { if (v) my.sent.set(id, v); else my.sent.delete(id); });
    if (!my.idb || !entries.length) return Promise.resolve();
    return new Promise(resolve => {
      try {
        const t = my.idb.transaction('sent', 'readwrite');
        const s = t.objectStore('sent');
        entries.forEach(([id, v]) => { if (v) s.put(v, id); else s.delete(id); });
        t.oncomplete = () => resolve();
        t.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  }
  function clearSent(my) {
    my.sent.clear();
    if (!my.idb) return Promise.resolve();
    return new Promise(resolve => {
      try { const t = my.idb.transaction('sent', 'readwrite'); t.objectStore('sent').clear(); t.oncomplete = () => resolve(); t.onerror = () => resolve(); } catch (e) { resolve(); }
    });
  }

  // ------------------------------------------------------------ çalışma durumu
  let rt = null;

  function setStatus(my, status) {
    if (rt !== my) return;
    my.status = status;
    updateCardStatus();
    document.dispatchEvent(new CustomEvent('ts:backup', { detail: { status } }));
  }

  async function uidOf(c) {
    try {
      const res = await withTimeout(c.auth.getSession(), 8000, null);
      const u = res && res.data && res.data.session && res.data.session.user;
      return u && u.id ? u.id : null;
    } catch (e) { return null; }
  }

  function retryLater(my, fn) {
    if (rt !== my) return;
    clearTimeout(my.retryTimer);
    const wait = BACKOFF[Math.min(my.retry, BACKOFF.length - 1)];
    my.retry++;
    my.retryTimer = setTimeout(() => { if (rt === my) fn(); }, wait);
  }

  async function start() {
    const s = st();
    if (!s.friendId) return;
    if (rt && rt.fid === s.friendId && rt.kind === s.accountKind) { if (rt.keys) schedule(rt); return; }
    stop();
    const my = {
      fid: s.friendId, kind: s.accountKind, slot: null, uid: null, keys: null,
      prefs: loadPrefs(s.friendId), sent: new Map(), status: 'idle', pending: 0, retry: 0,
      timer: null, retryTimer: null, keyTimer: null, hidCache: new Map(),
      dirty: { dm: true, spaces: true, full: true }, addedEvents: [], keycheckUp: false, idb: null
    };
    rt = my;
    if (s.accountKind !== 'cloud' || !window.TSAccounts) { setStatus(my, 'legacy'); return; }
    my.slot = window.TSAccounts.currentSlot();
    try { my.sent = await loadSent(my); } catch (e) { my.sent = new Map(); }
    if (rt !== my) { try { my.idb && my.idb.close(); } catch (e) {} return; }
    await boot(my);
  }

  function stop() {
    const my = rt;
    rt = null;
    if (!my) return;
    clearTimeout(my.timer);
    clearTimeout(my.retryTimer);
    clearInterval(my.keyTimer);
    try { my.idb && my.idb.close(); } catch (e) {}
    progress(null);
  }

  async function fetchKeycheck(my) {
    const c = db();
    if (!c || !my.uid) return { ok: false };
    const res = await withTimeout(c.from(TABLE).select('id,nonce,ct').eq('user_id', my.uid).eq('id', 'keycheck').limit(1), 15000, TIMEOUT);
    if (!res || res.error) return { ok: false };
    return { ok: true, row: Array.isArray(res.data) && res.data.length ? res.data[0] : null };
  }

  async function keyMatches(keys, row) {
    try { const env = await openRow(keys, row); return env.k === 'keycheck'; } catch (e) { return false; }
  }

  async function uploadKeycheck(my) {
    const row = { user_id: my.uid, id: 'keycheck', conv: 'keycheck', ts: minuteIso(Date.now()), v: FORMAT, deleted: false };
    Object.assign(row, await sealRow(my.keys, 'keycheck', { k: 'keycheck', at: Date.now() }));
    delete row.size;
    assertBodySafe([row]);
    const res = await withTimeout(db().from(TABLE).upsert([row], { onConflict: 'user_id,id' }), 15000, TIMEOUT);
    if (!res || res.error) throw err('net', (res && res.error && res.error.message) || 'upload');
    my.keycheckUp = true;
  }

  // 'ok' | 'needKey' | 'offline' | 'off'
  async function ensureKey(my) {
    const kc = await fetchKeycheck(my);
    if (!kc.ok) return 'offline';
    my.hadRemote = !!kc.row;
    my.keycheckUp = !!kc.row;
    let keyHex = null;
    try { keyHex = await api().backupKey(my.slot, 'get'); } catch (e) { keyHex = null; }
    if (keyHex) {
      const keys = await deriveKeys(keyHex);
      if (!kc.row || await keyMatches(keys, kc.row)) { my.keys = keys; my.mismatch = false; return 'ok'; }
      my.mismatch = true;
      return 'needKey';
    }
    if (kc.row) return 'needKey';
    if (my.prefs.enabled === false) return 'off';
    // Sunucuda bu hesabın yedeği yok: anahtarı bu cihaz üretir.
    try { keyHex = await api().backupKey(my.slot, 'create'); } catch (e) { keyHex = null; }
    if (!keyHex) return 'offline';
    my.keys = await deriveKeys(keyHex);
    return 'ok';
  }

  async function boot(my) {
    if (rt !== my) return;
    const c = db();
    if (!c || !api().backupKey) { setStatus(my, 'noserver'); return; }
    my.uid = my.uid || await uidOf(c);
    if (rt !== my) return;
    if (!my.uid) { setStatus(my, 'offline'); retryLater(my, () => boot(my)); return; }
    const res = await ensureKey(my).catch(() => 'offline');
    if (rt !== my) return;
    if (res === 'offline') { setStatus(my, 'offline'); retryLater(my, () => boot(my)); return; }
    if (res === 'off') { setStatus(my, 'off'); return; }
    if (res === 'needKey') { setStatus(my, 'needKey'); askKeyLoop(my); return; }
    my.retry = 0;
    await afterKey(my);
  }

  async function afterKey(my) {
    if (rt !== my) return;
    clearInterval(my.keyTimer);
    if (!my.prefs.restoredAt) {
      if (my.hadRemote) await restore({ auto: true });
      else { my.prefs.restoredAt = Date.now(); savePrefs(my); }
    }
    if (rt !== my) return;
    if (my.prefs.enabled === false) { setStatus(my, 'off'); return; }
    my.dirty.full = true;
    setStatus(my, my.prefs.lastOk ? 'ok' : 'working');
    schedule(my, 300);
  }

  // ------------------------------------------- K'yı kendi diğer cihazından iste
  function askKeyLoop(my) {
    clearInterval(my.keyTimer);
    const ask = () => {
      if (rt !== my || my.keys) { clearInterval(my.keyTimer); return; }
      const ns = window.TSNetSettings;
      if (ns && typeof ns.sendOwn === 'function') ns.sendOwn({ k: 'bkreq' }).catch(() => {});
    };
    ask();
    my.keyTimer = setInterval(ask, KEY_ASK_EVERY);
  }

  // js/net-settings.js onAccountEvent: şifresi çözülmüş, tazelik/nonce
  // denetiminden geçmiş acct_dev içeriği.
  async function onOwnDevice(body, myDeviceId) {
    const my = rt;
    if (!my || !body) return;
    if (body.k === 'bkreq') {
      if (!my.keys || Date.now() - (my.lastKeyReply || 0) < 3000) return;
      my.lastKeyReply = Date.now();
      const ns = window.TSNetSettings;
      if (ns && typeof ns.sendOwn === 'function') ns.sendOwn({ k: 'bkkey', to: body.dv, key: my.keys.hex }).catch(() => {});
    } else if (body.k === 'bkkey') {
      if (my.keys || body.to !== myDeviceId || typeof body.key !== 'string' || !/^[0-9a-f]{64}$/.test(body.key)) return;
      if (my.keyBusy) return;
      my.keyBusy = true;
      try {
        const keys = await deriveKeys(body.key);
        const kc = await fetchKeycheck(my);
        if (!kc.ok) return;                                    // doğrulanamadı: sormaya devam
        if (kc.row && !(await keyMatches(keys, kc.row))) return; // eski/yanlış anahtar
        const saved = await api().backupKey(my.slot, 'set', body.key, !!my.mismatch);
        if (saved !== body.key || rt !== my) return;
        my.keys = keys;
        my.mismatch = false;
        my.hadRemote = !!kc.row;
        my.keycheckUp = !!kc.row;
        toast(tr('backup.keyReceived'), 'ok');
        await afterKey(my);
      } catch (e) {
        console.warn('Yedek anahtarı alınamadı:', e && e.message);
      } finally { my.keyBusy = false; }
    }
  }

  // ------------------------------------------------------------ toplama (diff)
  function dmEnvelope(fid, m) {
    const type = ['text', 'image', 'video', 'file'].includes(m.type) ? m.type : 'file';
    const out = { k: 'dm', f: fid, id: m.id, s: m.sender === 'me' ? 'me' : 'them', t: type, ts: Number(m.timestamp) || 0 };
    if (type === 'text') {
      out.c = String(m.content == null ? '' : m.content);
      if (m.isCensored) out.cen = 1;
      if (m.count > 1) out.n = m.count | 0;
      if (Array.isArray(m.mergedIds) && m.mergedIds.length) out.mi = m.mergedIds.slice(-50);
    } else if (m.fileName) {
      out.fn = String(m.fileName).slice(0, 255);   // içerik (data: URL) ASLA
    }
    if (m.reactions && typeof m.reactions === 'object' && Object.keys(m.reactions).length) out.rx = m.reactions;
    return out;
  }

  async function collectDMs(my, want) {
    const dms = st().dms || {};
    let assigned = false;
    for (const fid of Object.keys(dms)) {
      const list = dms[fid];
      if (!Array.isArray(list) || !validFid(fid)) continue;
      const conv = await hid(my, 'dm|' + fid);
      for (const m of list) {
        if (!m || typeof m !== 'object') continue;
        // Kimliksiz eski mesajlar (eski istemciler) bir kez kalıcı kimlik alır.
        if (typeof m.id !== 'string' || !m.id) { m.id = window.crypto.randomUUID(); assigned = true; }
        want.set(await hid(my, `dm|${fid}|${m.id}`), { conv, ts: m.timestamp, kind: 'dm', env: dmEnvelope(fid, m) });
      }
    }
    if (assigned && typeof window.saveDMs === 'function') window.saveDMs();
  }

  function cleanRec(rec) {
    const out = {};
    Object.keys(rec).forEach(k => {
      if (REC_DROP.includes(k)) return;
      const v = rec[k];
      if (typeof v === 'string' && /^\s*(data:|blob:)/i.test(v)) return; // ör. sunucu simgesi
      out[k] = v;
    });
    return out;
  }

  async function addGroupEvents(my, want, conv, gid, events, lookup) {
    const byId = new Map(events.map(e => [e.id, e]));
    for (const ev of events) {
      if (!ev || !GROUP_TYPES.has(ev.type) || ev.type === 'msg.del') continue;
      const id = await hid(my, `g|${gid}|e|${ev.id}`);
      if (!want.has(id)) want.set(id, { conv, ts: ev.ts, kind: 'ge', env: { k: 'ge', ev } });
    }
    for (const ev of events) {
      if (!ev || ev.type !== 'msg.del') continue;
      want.set(await hid(my, `g|${gid}|e|${ev.id}`), { conv, ts: ev.ts, kind: 'ge', env: { k: 'ge', ev } });
      const target = ev.body && ev.body.target;
      if (typeof target !== 'string') continue;
      const orig = byId.get(target) || (lookup ? await lookup(target) : null);
      // Silinen mesajın içeriği sunucuda kalmasın: satır "deleted" işaretlenir.
      if (orig && orig.type === 'msg' && orig.author === ev.author) {
        want.set(await hid(my, `g|${gid}|e|${target}`), { conv, ts: orig.ts, kind: 'ge', env: { k: 'del' }, del: true });
      }
    }
  }

  async function collectSpaces(my, want, full) {
    const S = window.TSSpaceStore;
    if (!S) return;
    const recs = await S.allSpaces().catch(() => null);
    if (!recs) return;
    const groupConv = new Map();
    my.liveConvs = new Set();
    for (const rec of recs) {
      if (!rec || typeof rec.gid !== 'string' || rec.removed) continue;
      if (rec.kind === 'server') {
        const conv = await hid(my, 'sv|' + rec.gid);
        my.liveConvs.add(conv);
        want.set(await hid(my, `sv|${rec.gid}|rec`), { conv, ts: rec.joinedAt || rec.createdAt, kind: 'rec', env: { k: 'sv', rec: cleanRec(rec) } });
        continue;
      }
      const conv = await hid(my, 'g|' + rec.gid);
      my.liveConvs.add(conv);
      groupConv.set(rec.gid, conv);
      want.set(await hid(my, `g|${rec.gid}|rec`), { conv, ts: rec.createdAt, kind: 'rec', env: { k: 'g', rec: cleanRec(rec) } });
      if (full) {
        const evs = await S.eventsOf(rec.gid, { limit: 20000 }).catch(() => []);
        await addGroupEvents(my, want, conv, rec.gid, evs, null);
      }
    }
    if (!full && my.addedEvents.length) {
      const byGid = new Map();
      my.addedEvents.forEach(e => { if (groupConv.has(e.gid)) (byGid.get(e.gid) || byGid.set(e.gid, []).get(e.gid)).push(e); });
      for (const [gid, evs] of byGid) await addGroupEvents(my, want, groupConv.get(gid), gid, evs, id => S.getEvent(id).catch(() => null));
    }
    my.addedEvents = [];
    my.spacesScanned = true;
  }

  // ------------------------------------------------------------ gönderim
  function schedule(my, delay = DEBOUNCE) {
    if (!my || rt !== my || !my.keys || my.prefs.enabled === false || my.restoring) return;
    clearTimeout(my.timer);
    my.timer = setTimeout(() => flush(my).catch(e => console.warn('Mesaj yedeği:', e && e.message)), delay);
  }

  async function uploadBatch(my, items) {
    const rows = [];
    const done = [];
    for (const it of items) {
      try {
        const sealed = await sealRow(my.keys, it.id, it.w.env);
        rows.push({ user_id: my.uid, id: it.id, conv: it.w.conv, ts: minuteIso(it.w.ts), v: FORMAT, nonce: sealed.nonce, ct: sealed.ct, deleted: !!it.w.del });
        done.push([it.id, { fp: it.fp, size: sealed.size, kind: it.w.kind, conv: it.w.conv }]);
      } catch (e) {
        if (e && (e.code === 'unsafe' || e.code === 'toolarge')) {
          // Yedeklenemez kayıt (ör. "data:" ile başlayan metin): atlanır, değişmedikçe yeniden denenmez.
          console.warn('Mesaj yedeği: kayıt atlandı (' + e.code + ')');
          done.push([it.id, { fp: it.fp, size: 0, kind: it.w.kind, conv: it.w.conv, skipped: 1 }]);
        } else throw e;
      }
    }
    if (rows.length) {
      assertBodySafe(rows);
      const res = await withTimeout(db().from(TABLE).upsert(rows, { onConflict: 'user_id,id' }), 20000, TIMEOUT);
      if (!res || res.error) throw err('net', (res && res.error && res.error.message) || 'upload');
    }
    // Kullanım tahmini (kart: "N kayıt · X KB"): üzerine yazılan satırın eski
    // boyutu düşülür; yeni satır sayılır, silinmiş işaretine dönen düşülür.
    // Yalnız bayt artırılıyordu: kart gerçek sunucuda "0 kayıt · 3 KB" diyordu.
    let added = 0;
    let counted = 0;
    const delIds = new Set(rows.filter(r => r.deleted).map(r => r.id));
    done.forEach(([id, v]) => {
      const prev = my.sent.get(id);
      const wasCounted = !!prev && !prev.skipped && prev.fp !== 'p' && !/\|d$/.test(prev.fp || '');
      added += (v.size || 0) - (prev && prev.fp !== 'p' ? prev.size || 0 : 0);
      const isCounted = !v.skipped && !delIds.has(id);
      counted += (isCounted ? 1 : 0) - (wasCounted ? 1 : 0);
    });
    await saveSent(my, done);
    my.prefs.usage = my.prefs.usage || { bytes: 0, count: 0, at: 0 };
    my.prefs.usage.bytes = Math.max(0, (my.prefs.usage.bytes || 0) + added);
    my.prefs.usage.count = Math.max(0, (my.prefs.usage.count || 0) + counted);
  }

  async function deleteRows(my, ids) {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const res = await withTimeout(db().from(TABLE).delete().eq('user_id', my.uid).in('id', chunk), 20000, TIMEOUT);
      if (!res || res.error) throw err('net', (res && res.error && res.error.message) || 'delete');
    }
  }

  async function flush(my) {
    if (rt !== my || !my.keys || my.prefs.enabled === false || my.restoring) return;
    if (my.flushing) { my.again = true; return; }
    my.flushing = true;
    const full = my.dirty.full;
    try {
      const want = new Map();
      if (my.dirty.dm || full) await collectDMs(my, want);
      my.spacesScanned = false;
      if (my.dirty.spaces || full || my.addedEvents.length) await collectSpaces(my, want, full);
      my.dirty = { dm: false, spaces: false, full: false };
      const todo = [];
      for (const [id, w] of want) {
        const fp = fpOf(w.env) + (w.del ? '|d' : '');
        const prev = my.sent.get(id);
        if (prev && (prev.fp === fp || prev.fp === 'p')) continue;
        todo.push({ id, w, fp });
      }
      // Bu bilgisayarda artık olmayan (ayrılınan) grup/sunucu satırları silinir.
      const gone = [];
      if (full && my.spacesScanned && my.liveConvs) {
        my.sent.forEach((v, id) => { if ((v.kind === 'rec' || v.kind === 'ge') && v.fp !== 'p' && !my.liveConvs.has(v.conv)) gone.push(id); });
      }
      my.pending = todo.length + gone.length;
      if (my.pending || !my.keycheckUp) setStatus(my, 'working');
      if (!my.keycheckUp) await uploadKeycheck(my);
      for (let i = 0; i < todo.length; i += BATCH) {
        if (rt !== my) return;
        await uploadBatch(my, todo.slice(i, i + BATCH));
        my.pending = Math.max(0, todo.length - i - BATCH) + gone.length;
        updateCardStatus();
      }
      if (gone.length) {
        await deleteRows(my, gone);
        await saveSent(my, gone.map(id => [id, null]));
      }
      my.pending = 0;
      my.retry = 0;
      if (todo.length || gone.length || !my.prefs.lastOk) my.prefs.lastOk = Date.now();
      savePrefs(my);
      const u = my.prefs.usage || {};
      if (!u.at || Date.now() - u.at > USAGE_EVERY || (u.bytes || 0) > QUOTA * 0.95) await refreshUsage(my).catch(() => {});
      setStatus(my, 'ok');
    } catch (e) {
      if (rt !== my) return;
      my.dirty.full = true;   // eksik kalanlar bir sonraki taramada yeniden bulunur
      if (!(e && e.code === 'net')) console.warn('Mesaj yedeği gönderilemedi:', e && e.message);
      setStatus(my, 'offline');
      retryLater(my, () => schedule(my, 0));
    } finally {
      my.flushing = false;
      if (my.again && rt === my) { my.again = false; schedule(my); }
    }
  }

  // Sunucudaki kullanım (id, ts, size — içerik indirilmez) + kota budaması.
  async function listUsage(my) {
    const out = [];
    let last = '';
    for (;;) {
      const res = await withTimeout(db().from(TABLE).select('id,ts,size,deleted').eq('user_id', my.uid).gt('id', last).order('id', { ascending: true }).limit(1000), 20000, TIMEOUT);
      if (!res || res.error) throw err('net', 'usage');
      const page = res.data || [];
      out.push(...page);
      if (page.length < 1000) break;
      last = page[page.length - 1].id;
    }
    return out;
  }

  async function refreshUsage(my) {
    if (rt !== my || !my.uid || !db()) return;
    const list = await listUsage(my);
    let bytes = list.reduce((a, r) => a + (Number(r.size) || 0), 0);
    if (bytes > QUOTA) {
      const recIds = new Set();
      my.sent.forEach((v, id) => { if (v.kind === 'rec') recIds.add(id); });
      const victims = [];
      list.filter(r => r.id !== 'keycheck' && !recIds.has(r.id))
        .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
        .some(r => { if (bytes <= PRUNE_TO) return true; victims.push(r.id); bytes -= Number(r.size) || 0; return false; });
      if (victims.length) {
        await deleteRows(my, victims);
        await saveSent(my, victims.map(id => [id, { ...(my.sent.get(id) || {}), fp: 'p' }]));
        const gone = new Set(victims);
        for (let i = list.length - 1; i >= 0; i--) if (gone.has(list[i].id)) list.splice(i, 1);
      }
    }
    my.prefs.usage = {
      bytes: list.reduce((a, r) => a + (Number(r.size) || 0), 0),
      count: list.filter(r => r.id !== 'keycheck' && !r.deleted).length,
      at: Date.now()
    };
    savePrefs(my);
    updateCardStatus();
  }

  // ------------------------------------------------------------ geri yükleme
  function fromEnv(env) {
    const m = { id: env.id, sender: env.s === 'me' ? 'me' : 'them', type: env.t, content: env.t === 'text' ? String(env.c || '') : '', timestamp: Number(env.ts) || 0 };
    if (env.t === 'text') {
      if (env.cen) m.isCensored = true;
      if (env.n > 1) m.count = env.n;
      if (Array.isArray(env.mi)) m.mergedIds = env.mi;
    } else {
      if (env.fn) m.fileName = String(env.fn);
      m.restored = true;
    }
    if (env.rx && typeof env.rx === 'object') m.reactions = env.rx;
    return m;
  }

  async function restore({ auto = false } = {}) {
    const my = rt;
    if (!my) return null;
    if (my.restoring) return null;
    if (!my.keys) { if (!auto) toast(tr('backup.needKey'), 'warn'); return null; }
    const c = db();
    if (!c || !my.uid) { if (!auto) toast(tr('backup.statusOffline'), 'warn'); return null; }
    my.restoring = true;
    clearTimeout(my.timer);
    setStatus(my, 'restoring');
    const counts = { dm: 0, groups: 0, gev: 0, servers: 0, rows: 0, bad: 0 };
    my.restoreRows = 0;
    progress(0);
    try {
      const dmEnvs = [];
      const recs = [];
      const evs = new Map();
      const sentAdds = [];
      let last = '';
      for (;;) {
        const res = await withTimeout(c.from(TABLE).select('id,conv,ts,v,nonce,ct,deleted').eq('user_id', my.uid).gt('id', last).order('id', { ascending: true }).limit(PAGE), 30000, TIMEOUT);
        if (!res || res.error) throw err('net', (res && res.error && res.error.message) || 'download');
        const page = res.data || [];
        for (const row of page) {
          counts.rows++;
          if (!row || row.id === 'keycheck') continue;
          let env;
          try { env = await openRow(my.keys, row); } catch (e) { counts.bad++; continue; }
          const size = Math.max(0, (String(row.ct || '').length - 2) / 2);
          if (row.deleted || env.k === 'del') { sentAdds.push([row.id, { fp: fpOf(env) + '|d', size, kind: 'ge', conv: row.conv }]); continue; }
          if (env.k === 'dm' && validFid(env.f) && typeof env.id === 'string') {
            dmEnvs.push(env);
            sentAdds.push([row.id, { fp: fpOf(env), size, kind: 'dm', conv: row.conv }]);
          } else if ((env.k === 'g' || env.k === 'sv') && env.rec && typeof env.rec.gid === 'string' && typeof env.rec.key === 'string') {
            recs.push({ kind: env.k, rec: env.rec, row, env, size });
          } else if (env.k === 'ge' && env.ev && typeof env.ev.gid === 'string' && typeof env.ev.id === 'string') {
            (evs.get(env.ev.gid) || evs.set(env.ev.gid, []).get(env.ev.gid)).push(env.ev);
            sentAdds.push([row.id, { fp: fpOf(env), size, kind: 'ge', conv: row.conv }]);
          }
        }
        my.restoreRows = counts.rows;
        progress(counts.rows);
        if (rt !== my) return null;
        if (page.length < PAGE) break;
        last = page[page.length - 1].id;
      }

      // 1) Özel mesajlar: id ile tekilleştir; yerelde olan yereldeki gibi kalır.
      const s = st();
      if (dmEnvs.length && s.friendId === my.fid) {
        s.dms = s.dms || {};
        const touched = new Set();
        dmEnvs.forEach(env => {
          const list = s.dms[env.f] || (s.dms[env.f] = []);
          const local = list.find(m => m && (m.id === env.id || (Array.isArray(m.mergedIds) && m.mergedIds.includes(env.id))));
          if (local) {
            if (env.n > (local.count || 1)) local.count = env.n;
            if (env.rx && !local.reactions) local.reactions = env.rx;
            return;
          }
          list.push(fromEnv(env));
          touched.add(env.f);
          counts.dm++;
        });
        touched.forEach(f => s.dms[f].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
        if (typeof window.saveDMs === 'function') window.saveDMs();
      }

      // 2) Gruplar ve sunucular: yerelde olmayan kayıtlar eklenir.
      const S = window.TSSpaceStore;
      const adoptG = [];
      const adoptS = [];
      if (S && (recs.length || evs.size)) {
        const local = new Map((await S.allSpaces().catch(() => [])).map(r => [r.gid, r]));
        for (const r of recs) {
          const rec = r.rec;
          if (r.kind === 'g' && rec.kind === 'server') continue;
          if (r.kind === 'sv' && rec.kind !== 'server') continue;
          if (!local.has(rec.gid)) {
            const stored = r.kind === 'g' ? { ...rec, unread: 0 } : { ...rec, unread: {}, mentions: {}, readAt: {}, lastCh: null };
            await S.putSpace(stored);
            local.set(rec.gid, stored);
            if (r.kind === 'g') { adoptG.push(stored); counts.groups++; } else { adoptS.push(stored); counts.servers++; }
          }
          sentAdds.push([r.row.id, { fp: fpOf(r.env), size: r.size, kind: 'rec', conv: r.row.conv }]);
        }
        for (const [gid, list] of evs) {
          const rec = local.get(gid);
          if (!rec || rec.kind === 'server' || rec.removed) continue;
          const added = await S.addEvents(list.filter(e => e.gid === gid)).catch(() => []);
          counts.gev += added.length;
        }
      }
      await saveSent(my, sentAdds);
      if (rt !== my) return null;
      for (const rec of adoptG) { try { if (window.TSGroups && window.TSGroups.adopt) await window.TSGroups.adopt(rec); } catch (e) {} }
      for (const rec of adoptS) { try { if (window.TSServers && window.TSServers.adopt) await window.TSServers.adopt(rec); } catch (e) {} }
      if (counts.gev) evs.forEach((_, gid) => document.dispatchEvent(new CustomEvent('ts:group', { detail: { gid } })));

      rerenderAll();
      my.prefs.restoredAt = Date.now();
      savePrefs(my);
      const any = counts.dm + counts.groups + counts.gev + counts.servers;
      toast(any ? tr('backup.restoreDone', { dm: counts.dm, groups: counts.groups, gmsg: counts.gev, servers: counts.servers }) : tr('backup.restoreNothing'), 'ok');
      my.lastRestore = counts;
      return counts;
    } catch (e) {
      toast(tr('backup.restoreFailed') + (e && e.message ? e.message : ''), 'danger');
      return null;
    } finally {
      my.restoring = false;
      progress(null);
      if (rt === my) {
        setStatus(my, my.prefs.enabled === false ? 'off' : 'ok');
        my.dirty.full = true;
        schedule(my, 500);
      }
    }
  }

  function rerenderAll() {
    try { if (typeof window.renderDMs === 'function' && st().activeDM) window.renderDMs(); } catch (e) {}
    try { if (window.TSDM && window.TSDM.renderList) window.TSDM.renderList(); } catch (e) {}
    try { if (window.TSGroupUI && window.TSGroupUI.renderMessages) window.TSGroupUI.renderMessages(); } catch (e) {}
    document.dispatchEvent(new CustomEvent('ts:servers', { detail: {} }));
  }

  // Hesaba ait tüm satırları sil (yedekleme de kapanır; K yerelde kalır).
  async function deleteServerBackup() {
    const my = rt;
    if (!my || !my.uid || !db()) { toast(tr('backup.statusOffline'), 'warn'); return false; }
    const res = await withTimeout(db().from(TABLE).delete().eq('user_id', my.uid), 30000, TIMEOUT);
    if (!res || res.error) { toast(tr('backup.deleteFailed') + ((res && res.error && res.error.message) || ''), 'danger'); return false; }
    clearTimeout(my.timer);
    await clearSent(my);
    my.keycheckUp = false;
    my.prefs.enabled = false;
    my.prefs.lastOk = null;
    my.prefs.usage = { bytes: 0, count: 0, at: Date.now() };
    savePrefs(my);
    setStatus(my, 'off');
    toast(tr('backup.deleted'), 'ok');
    return true;
  }

  async function setEnabled(on) {
    const my = rt;
    if (!my) return;
    my.prefs.enabled = !!on;
    savePrefs(my);
    if (!on) { clearTimeout(my.timer); setStatus(my, 'off'); return; }
    if (my.keys) { my.dirty.full = true; setStatus(my, 'working'); schedule(my, 200); }
    else { my.retry = 0; await boot(my); }
  }

  // ------------------------------------------------------------ ilerleme göstergesi
  function progress(n) {
    let el = $('backup-progress');
    if (n == null) { if (el) el.remove(); updateCardStatus(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'backup-progress';
      el.className = 'backup-progress';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.innerHTML = `${ico('refresh', 15)}<span class="backup-progress-text">${esc(n ? tr('backup.restoring', { n }) : tr('backup.restoringStart'))}</span><span class="backup-progress-bar" aria-hidden="true"><span></span></span>`;
    updateCardStatus();
  }

  // ------------------------------------------------------------ ayarlar kartı
  function formatBytes(b) {
    const n = Number(b) || 0;
    const locale = (typeof LANGUAGE_META !== 'undefined' && typeof getUserLanguage === 'function' && LANGUAGE_META[getUserLanguage()]) ? LANGUAGE_META[getUserLanguage()].locale : undefined;
    const f = (v, d) => v.toLocaleString(locale, { maximumFractionDigits: d });
    if (n < 1024 * 1024) return `${f(Math.max(0, n) / 1024, 0)} KB`;
    return `${f(n / (1024 * 1024), 1)} MB`;
  }

  function statusInfo() {
    const my = rt;
    if (!my) return { state: 'idle', text: tr('backup.statusNever') };
    switch (my.status) {
      case 'needKey': return { state: 'warn', text: tr('backup.needKey') };
      case 'noserver':
      case 'offline': return { state: 'warn', text: tr('backup.statusOffline') };
      case 'off': return { state: 'idle', text: tr('backup.statusOff') };
      case 'restoring': return { state: 'checking', text: my.restoreRows ? tr('backup.restoring', { n: my.restoreRows }) : tr('backup.restoringStart') };
      case 'working': if (my.pending) return { state: 'checking', text: tr('backup.statusPending', { n: my.pending }) };
      // fallthrough
      default: {
        const u = my.prefs.usage || {};
        if (!my.prefs.lastOk) return { state: my.status === 'working' ? 'checking' : 'idle', text: tr(my.status === 'working' ? 'backup.statusWorking' : 'backup.statusNever') };
        const count = u.at ? u.count : Array.from(my.sent.values()).filter(v => v.fp !== 'p' && !v.skipped && !/\|d$/.test(v.fp)).length;
        const time = typeof formatUserDateTime === 'function' ? formatUserDateTime(my.prefs.lastOk) : new Date(my.prefs.lastOk).toLocaleString();
        return { state: 'ok', text: tr('backup.statusLine', { time, count, used: formatBytes(u.bytes || 0), quota: formatBytes(QUOTA) }) };
      }
    }
  }

  function updateCardStatus() {
    const box = $('backup-status');
    if (!box) return;
    const info = statusInfo();
    box.dataset.state = info.state;
    const text = box.querySelector('.backup-status-text');
    if (text && text.textContent !== info.text) text.textContent = info.text;
    const my = rt;
    const restoreBtn = $('backup-restore-btn');
    if (restoreBtn) restoreBtn.disabled = !my || !my.keys || !!my.restoring;
    const delBtn = $('backup-delete-btn');
    if (delBtn) delBtn.disabled = !my || !my.uid || !!my.restoring;
    const sw = $('backup-enabled');
    if (sw && my) sw.checked = my.prefs.enabled !== false;
  }

  function renderCard() {
    const box = $('settings-backup-card');
    if (!box) return;
    const s = st();
    if (s.friendId && (!rt || rt.fid !== s.friendId || rt.kind !== s.accountKind)) start();
    const head = `<h3 class="settings-section-title backup-title">${ico('shield', 15)}<span>${esc(tr('backup.title'))}</span></h3>`;
    if (s.accountKind !== 'cloud') {
      box.innerHTML = `${head}
        <div class="settings-callout net-callout" role="note">${ico('info', 18)}<p>${esc(tr('backup.legacy'))}</p></div>
        <button type="button" id="backup-go-migrate" class="settings-test-button net-go-account">${ico('server', 15)}<span>${esc(tr('backup.goMigrate'))}</span></button>`;
      $('backup-go-migrate').addEventListener('click', () => {
        const target = $('settings-login-code-legacy') || $('settings-migrate-legacy');
        if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const btn = $('settings-migrate-legacy');
        if (btn) setTimeout(() => btn.focus(), 250);
      });
      return;
    }
    const facts = [
      ['check', 'backup.what'],
      ['image', 'backup.noMedia'],
      ['lock', 'backup.encrypted'],
      ['alert', 'backup.lost']
    ];
    box.innerHTML = `${head}
      <div class="settings-row net-switch-row backup-switch-row">
        <div><strong id="backup-enabled-label">${esc(tr('backup.switch'))}</strong><p id="backup-enabled-desc">${esc(tr('backup.switchDesc'))}</p></div>
        <label class="switch"><input type="checkbox" id="backup-enabled" aria-labelledby="backup-enabled-label" aria-describedby="backup-enabled-desc"><span class="slider round"></span></label>
      </div>
      <p id="backup-status" class="backup-status" role="status" aria-live="polite"><span class="net-dot" aria-hidden="true"></span><span class="backup-status-text"></span></p>
      <ul class="backup-facts">${facts.map(([i, k]) => `<li>${ico(i, 15)}<span>${esc(tr(k))}</span></li>`).join('')}</ul>
      <div class="net-actions backup-actions">
        <button type="button" id="backup-restore-btn" class="settings-test-button net-go-account">${ico('refresh', 15)}<span>${esc(tr('backup.restore'))}</span></button>
        <button type="button" id="backup-delete-btn" class="settings-test-button net-danger-btn">${ico('trash', 15)}<span>${esc(tr('backup.delete'))}</span></button>
      </div>`;
    $('backup-enabled').checked = !rt || rt.prefs.enabled !== false;
    $('backup-enabled').addEventListener('change', e => setEnabled(e.target.checked));
    $('backup-restore-btn').addEventListener('click', () => restore({ auto: false }));
    $('backup-delete-btn').addEventListener('click', async () => {
      const ok = await window.showConfirm(tr('backup.deleteTitle'), tr('backup.deleteConfirm'), { danger: true, confirmText: tr('backup.deleteYes') });
      if (ok) await deleteServerBackup();
    });
    updateCardStatus();
    if (rt && rt.keys && rt.uid && (!rt.prefs.usage || !rt.prefs.usage.at || Date.now() - rt.prefs.usage.at > 60000)) refreshUsage(rt).catch(() => {});
  }

  // ------------------------------------------------------------ olay kancaları
  function noteDmChange() {
    const my = rt;
    if (!my || !my.keys) return;
    my.dirty.dm = true;
    schedule(my);
  }

  document.addEventListener('ts:group', e => {
    const my = rt;
    if (!my || !my.keys) return;
    const d = (e && e.detail) || {};
    if (Array.isArray(d.added) && d.added.length) my.addedEvents.push(...d.added.filter(r => r && GROUP_TYPES.has(r.type)));
    if (d.removed) my.dirty.full = true;
    my.dirty.spaces = true;
    schedule(my);
  });
  document.addEventListener('ts:servers', () => {
    const my = rt;
    if (!my || !my.keys || my.restoring) return;
    my.dirty.spaces = true;
    schedule(my);
  });
  window.addEventListener('online', () => { const my = rt; if (!my) return; if (my.keys) schedule(my, 500); else if (my.status === 'offline') { my.retry = 0; boot(my); } });

  window.TSBackup = {
    start, stop, restore, renderCard, noteDmChange, onOwnDevice, setEnabled, deleteServerBackup,
    // Bağlantılar > Yeni cihaz bağlama metni için.
    isActive: () => !!(rt && rt.keys && rt.prefs.enabled !== false && st().accountKind === 'cloud'),
    status: () => (rt ? { status: rt.status, pending: rt.pending, hasKey: !!rt.keys, enabled: rt.prefs.enabled !== false, lastOk: rt.prefs.lastOk || null, restoredAt: rt.prefs.restoredAt || null, usage: rt.prefs.usage || null, sent: rt.sent.size, lastRestore: rt.lastRestore || null } : null),
    flushNow: () => (rt && rt.keys ? flush(rt) : Promise.resolve()),
    QUOTA, PLAIN_MAX,
    // Testler için: sahte sunucu istemcisi ve gizlilik korumaları.
    setClient: c => { override = c || null; },
    _guard: { assertPlainSafe: env => assertPlainSafe(env, JSON.stringify(env)), assertBodySafe }
  };
})();
