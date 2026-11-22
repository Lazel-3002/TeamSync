// Grup (ve ileride sunucu) motorunun şifreleme katmanı — yalnızca WebCrypto.
//
// • Kimlik: HESAP başına ECDSA P-256 (imza, "ik") + ECDH P-256 (anahtar
//   değişimi, "ek"), hesabın tüm cihazlarında aynı (aşağıda "account").
//   Özel anahtarlar main.js DPAPI deposunda; burada yalnızca dışa
//   aktarılamaz CryptoKey. Eski cihaz anahtarı ("device") göç için kalır.
//   Açık anahtarlar presence (ak), profil yanıtı (res_profile.keys) ve
//   arkadaşlık isteği ile arkadaşlara gider.
// • Arkadaş anahtarları ilk görüşte güvenilir (TOFU) kaydedilir; sonradan
//   değişirse kullanıcı kabul edene kadar yeni anahtar kullanılmaz.
// • Grup anahtarı AES-GCM-256; davetlerde alıcının ek'ine geçici ECDH + HKDF
//   ile sarılarak gönderilir.
(function () {
  const subtle = window.crypto.subtle;
  const te = new TextEncoder();
  const td = new TextDecoder();

  // ---------- yardımcılar ----------
  function b64(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    const bin = atob(String(str || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(bytes) {
    return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Anahtarları sıralı, deterministik JSON (imzalar için)
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  const randomBytes = n => window.crypto.getRandomValues(new Uint8Array(n));

  // ---------- kimlik anahtarları (IndexedDB) ----------
  const ID_DB = 'ts-identity';
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(ID_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly');
      const r = tx.objectStore('keys').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbPut(key, value) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      tx.objectStore('keys').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // İki tür kimlik:
  // • account — HESAP kimliği (tüm kendi cihazlarda aynı). Özel anahtarlar
  //   main.js 'account-identity' (DPAPI) deposunda PKCS#8; burada yalnızca
  //   dışa aktarılamaz CryptoKey olarak tutulur. Yalnızca hesabın kaynak cihazı
  //   (eski tip hesap ya da kodla EKLENMEMİŞ sunucu hesabı) üretir; kodla eklenen
  //   cihaz onu yedekten (K ile şifreli) ya da acct_dev kanalından alır.
  // • device — eski sürümün cihaz başına anahtarı (IndexedDB ts-identity,
  //   dışa aktarılamaz). Göç için ve eski sürüm üyeli gruplara imza için kalır.
  const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
  const MIG_T = 'ts-acct-migrate-v1';
  const migrationStatement = (fid, ik, ek) => ({ t: MIG_T, fid, ik, ek });

  let ids = null;            // { fid, account, device, mig }
  let idsPromise = null;
  let accountTry = 0;
  let accountRetrying = false;
  let deviceOnly = false;    // yalnızca E2E testleri: eski sürümü taklit eder

  const aidApi = () => (window.electronAPI && typeof window.electronAPI.accountIdentity === 'function') ? window.electronAPI.accountIdentity : null;

  // Hesap kimliğini bu cihaz üretebilir mi? Kodla eklenmiş hesaplar asla
  // üretmez (aksi hâlde aynı hesabın iki kimliği olur, arkadaşlar "anahtar
  // değişti" uyarısı görür); hesap türü henüz belli değilse de üretilmez.
  function mayCreateAccount() {
    const s = window.state || {};
    if (s.accountKind === 'legacy') return true;
    if (s.accountKind !== 'cloud' || !window.TSAccounts || typeof window.TSAccounts.isImportedSlot !== 'function') return false;
    try { return !window.TSAccounts.isImportedSlot(window.TSAccounts.currentSlot()); } catch (e) { return false; }
  }

  async function loadDevice(fid, create) {
    let rec = await idbGet(fid).catch(() => null);
    if (!rec && create) {
      const sign = await subtle.generateKey(ECDSA, false, ['sign', 'verify']);
      const dh = await subtle.generateKey(ECDH, false, ['deriveBits']);
      const ik = b64(await subtle.exportKey('spki', sign.publicKey));
      const ek = b64(await subtle.exportKey('spki', dh.publicKey));
      rec = { sign, dh, ik, ek, createdAt: Date.now() };
      await idbPut(fid, rec);
    }
    return rec ? { kind: 'device', sign: rec.sign, dh: rec.dh, ik: rec.ik, ek: rec.ek } : null;
  }

  async function importAccount(rec) {
    const sk = await subtle.importKey('pkcs8', unb64(rec.sk), ECDSA, false, ['sign']);
    const dk = await subtle.importKey('pkcs8', unb64(rec.dk), ECDH, false, ['deriveBits']);
    return { kind: 'account', sign: { privateKey: sk }, dh: { privateKey: dk }, ik: rec.ik, ek: rec.ek };
  }

  async function signWith(privateKey, obj) {
    return b64(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, te.encode(canonical(obj))));
  }

  async function loadAccount(fid, device) {
    const api = aidApi();
    if (!api || deviceOnly) return null;
    let rec = await api(fid, 'get').catch(() => null);
    if (!rec && mayCreateAccount()) {
      // Üretim anında DIŞA AKTARILABİLİR (kendi cihazlara taşınabilsin); ham
      // bayt yalnızca main sürecindeki DPAPI deposuna yazılır.
      const sign = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
      const dh = await subtle.generateKey(ECDH, true, ['deriveBits']);
      const out = {
        v: 1, fid,
        sk: b64(await subtle.exportKey('pkcs8', sign.privateKey)),
        dk: b64(await subtle.exportKey('pkcs8', dh.privateKey)),
        ik: b64(await subtle.exportKey('spki', sign.publicKey)),
        ek: b64(await subtle.exportKey('spki', dh.publicKey))
      };
      // Göç kanıtı: eski cihaz anahtarı yeni hesap anahtarlarını imzalar.
      if (device) out.mig = { ik: device.ik, sig: await signWith(device.sign.privateKey, migrationStatement(fid, out.ik, out.ek)) };
      rec = await api(fid, 'set', out).catch(() => null);
    }
    if (!rec || rec.fid !== fid) return null;
    return { acct: await importAccount(rec), mig: rec.mig || null };
  }

  function announceIdentity(fid) {
    setTimeout(() => document.dispatchEvent(new CustomEvent('ts:identity', { detail: { fid, account: true } })), 0);
  }

  async function buildIds(fid) {
    const existing = await loadDevice(fid, false);
    let a = null;
    try { a = await loadAccount(fid, existing); } catch (e) { console.warn('Hesap kimliği yüklenemedi:', e && e.message); }
    // Hesap kimliği yoksa (kodla eklenmiş, henüz gelmedi) eski davranış: cihaz anahtarı.
    const device = existing || (a ? null : await loadDevice(fid, true));
    return { fid, account: a ? a.acct : null, device, mig: a ? a.mig : null };
  }

  async function ensureIds() {
    const fid = window.state && window.state.friendId;
    if (!fid) return null;
    if (ids && ids.fid === fid) {
      if (!ids.account && !deviceOnly && !accountRetrying && Date.now() - accountTry > 5000) {
        accountRetrying = true;
        accountTry = Date.now();
        try {
          const a = await loadAccount(fid, ids.device);
          if (a && ids && ids.fid === fid && !ids.account) { ids.account = a.acct; ids.mig = a.mig; announceIdentity(fid); }
        } catch (e) {} finally { accountRetrying = false; }
      }
      return ids;
    }
    if (idsPromise && idsPromise.fid === fid) return idsPromise.p;
    accountTry = Date.now();
    const p = (async () => {
      const r = await buildIds(fid);
      if (window.state && window.state.friendId === fid) {
        ids = r;
        if (r.account) announceIdentity(fid);
      }
      return r;
    })();
    // Başarısız bir deneme (ör. IndexedDB geçici hatası) önbellekte kalırsa bu
    // hesapta hiçbir imza/şifre işlemi uygulama yeniden başlayana dek çalışmaz.
    p.catch(() => { if (idsPromise && idsPromise.p === p) idsPromise = null; });
    idsPromise = { fid, p };
    return p;
  }

  const withFid = (r, x) => (x ? { fid: r.fid, ...x } : null);
  const primaryOf = r => (r ? (r.account || r.device) : null);

  async function ensureIdentity() {
    const r = await ensureIds();
    return r ? withFid(r, primaryOf(r)) : null;
  }
  const cur = () => {
    const fid = window.state && window.state.friendId;
    return ids && ids.fid === fid ? ids : null;
  };
  function publicKeysSync() {
    const p = primaryOf(cur());
    return p ? { ik: p.ik, ek: p.ek } : null;
  }
  function accountKeysSync() {
    const r = cur();
    return r && r.account ? { ik: r.account.ik, ek: r.account.ek } : null;
  }
  function deviceKeysSync() {
    const r = cur();
    return r && r.device ? { ik: r.device.ik, ek: r.device.ek } : null;
  }
  const migrationProofSync = () => { const r = cur(); return r && r.account && r.mig ? { ...r.mig } : null; };
  // ik veya ek ile eşleşen (bu cihazda özel anahtarı olan) kimlik.
  async function identityFor(pub) {
    const r = await ensureIds();
    if (!r) return null;
    const hit = [r.account, r.device].find(x => x && pub && (x.ik === pub || x.ek === pub));
    return withFid(r, hit || primaryOf(r));
  }
  function holds(pub) {
    const r = cur();
    return !!(r && pub && [r.account, r.device].some(x => x && (x.ik === pub || x.ek === pub)));
  }

  // Kendi diğer cihazıma (yedek / acct_dev) taşınacak kimlik. Yalnızca
  // js/msg-backup.js ve js/net-settings.js çağırır; ham özel anahtar
  // ŞİFRELENMEDEN hiçbir yere gönderilmemeli ve günlüğe yazılmamalı.
  async function exportAccountIdentity() {
    const fid = window.state && window.state.friendId;
    const api = aidApi();
    if (!fid || !api || deviceOnly) return null;
    const rec = await api(fid, 'get').catch(() => null);
    if (!rec || rec.fid !== fid) return null;
    const out = { fid, sk: rec.sk, dk: rec.dk, ik: rec.ik, ek: rec.ek };
    if (rec.mig) out.mig = { ik: rec.mig.ik, sig: rec.mig.sig };
    return out;
  }

  async function pairMatches(privB64, pubB64, alg) {
    const priv = await subtle.importKey('pkcs8', unb64(privB64), alg, true, alg.name === 'ECDSA' ? ['sign'] : ['deriveBits']);
    const pub = await subtle.importKey('spki', unb64(pubB64), alg, true, alg.name === 'ECDSA' ? ['verify'] : []);
    const a = await subtle.exportKey('jwk', priv);
    const b = await subtle.exportKey('jwk', pub);
    return a.crv === 'P-256' && a.x === b.x && a.y === b.y;
  }

  // Kendi diğer cihazımdan gelen hesap kimliğini kurar. Dönüş: 'ok' |
  // 'same' | 'conflict' | 'invalid'.
  async function installAccountIdentity(m) {
    const fid = window.state && window.state.friendId;
    const api = aidApi();
    const okB64 = v => typeof v === 'string' && /^[A-Za-z0-9+/=]{80,400}$/.test(v);
    if (!fid || !api || !m || m.fid !== fid || !['sk', 'dk', 'ik', 'ek'].every(k => okB64(m[k]))) return 'invalid';
    try {
      if (!(await pairMatches(m.sk, m.ik, ECDSA)) || !(await pairMatches(m.dk, m.ek, ECDH))) return 'invalid';
    } catch (e) { return 'invalid'; }
    const r = await ensureIds();
    if (r && r.account) return r.account.ik === m.ik && r.account.ek === m.ek ? 'same' : 'conflict';
    const rec = { v: 1, fid, sk: m.sk, dk: m.dk, ik: m.ik, ek: m.ek };
    if (m.mig && okB64(m.mig.ik) && typeof m.mig.sig === 'string') rec.mig = { ik: m.mig.ik, sig: m.mig.sig };
    const saved = await api(fid, 'set', rec).catch(() => null);
    if (!saved || saved.ik !== m.ik || saved.ek !== m.ek) return 'conflict';
    const acct = await importAccount(saved);
    const now = cur();
    if (now && !now.account) { now.account = acct; now.mig = saved.mig || null; announceIdentity(fid); }
    return 'ok';
  }

  function forgetIdentity() { ids = null; idsPromise = null; }

  // ---------- imza ----------
  const pubCache = new Map();
  async function importPub(b64spki, kind) {
    const key = `${kind}:${b64spki}`;
    if (pubCache.has(key)) return pubCache.get(key);
    const alg = kind === 'ik' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'ECDH', namedCurve: 'P-256' };
    const usages = kind === 'ik' ? ['verify'] : [];
    const k = await subtle.importKey('spki', unb64(b64spki), alg, true, usages);
    pubCache.set(key, k);
    return k;
  }

  // ik verilirse o açık anahtarın kimliğiyle (bu cihazda varsa) imzalar;
  // yoksa birincil kimlikle (hesap, yoksa cihaz).
  async function sign(obj, ik) {
    const id = ik ? await identityFor(ik) : await ensureIdentity();
    return signWith(id.sign.privateKey, obj);
  }

  async function verify(ikB64, obj, sigB64) {
    try {
      if (typeof ikB64 !== 'string' || typeof sigB64 !== 'string') return false;
      const k = await importPub(ikB64, 'ik');
      return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, unb64(sigB64), te.encode(canonical(obj)));
    } catch (e) { return false; }
  }

  // ---------- simetrik ----------
  async function aesKey(rawB64) {
    return subtle.importKey('raw', unb64(rawB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(key, text) {
    const iv = randomBytes(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function decrypt(key, ivB64, ctB64) {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(ctB64));
    return td.decode(pt);
  }
  async function hmacHex(rawB64, label) {
    const k = await subtle.importKey('raw', unb64(rawB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await subtle.sign('HMAC', k, te.encode(label)));
  }
  function newGroupKey() { return b64(randomBytes(32)); }

  // ---------- anahtar sarma (davet / anahtar yenileme) ----------
  async function hkdfKey(sharedBits, salt, info) {
    const base = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(salt), info: te.encode(info) },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Alıcının açık ek'ine sarar: { epk, iv, ct }
  async function wrapFor(recipientEkB64, secretText, salt, info) {
    const recipient = await importPub(recipientEkB64, 'ek');
    const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
    const key = await hkdfKey(bits, salt, info);
    const { iv, ct } = await encrypt(key, secretText);
    return { epk: b64(await subtle.exportKey('spki', eph.publicKey)), iv, ct };
  }

  // Gönderen hangi ek'imi biliyorsa (hesap ya da eski cihaz) onunla açılır.
  async function unwrap(wrapped, salt, info) {
    const r = await ensureIds();
    const epk = await importPub(wrapped.epk, 'ek');
    let lastErr = new Error('no-identity');
    for (const id of [r && r.account, r && r.device].filter(Boolean)) {
      try {
        const bits = await subtle.deriveBits({ name: 'ECDH', public: epk }, id.dh.privateKey, 256);
        const key = await hkdfKey(bits, salt, info);
        return await decrypt(key, wrapped.iv, wrapped.ct);
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // ---------- arkadaş anahtarları (TOFU) ----------
  const PEER_KEY = me => `teamsync_peer_keys_${me}`;
  let peers = {};
  let peersFor = null;
  function loadPeers() {
    const me = window.state && window.state.friendId;
    if (!me || peersFor === me) return;
    peersFor = me;
    try { peers = JSON.parse(localStorage.getItem(PEER_KEY(me)) || '{}') || {}; } catch (e) { peers = {}; }
  }
  function savePeers() {
    const me = window.state && window.state.friendId;
    if (!me) return;
    try { localStorage.setItem(PEER_KEY(me), JSON.stringify(peers)); } catch (e) {}
  }
  const validKey = k => typeof k === 'string' && k.length >= 80 && k.length <= 200 && /^[A-Za-z0-9+/=]+$/.test(k);

  // Kayıt: { ik, ek, at, acct?, old?: [ik], rx?, pend?: { ik, ek, acct, at } }
  //  acct — bu anahtarlar arkadaşın HESAP kimliği (yeni sürüm; v2 DM mümkün)
  //  old  — doğrulanmış göçle (eski cihaz anahtarının imzası) geride kalan ik'ler
  //  rx   — bu anahtarla v2 şifreli olay alındı (artık eski sarmalı reddedilir)
  //  pend — İLK görülen anahtardan farklı, doğrulanmamış yeni anahtar: kullanıcı
  //         "Kabul et" diyene kadar kullanılmaz (TOFU).
  const emitPeer = detail => document.dispatchEvent(new CustomEvent('ts:peerkeys', { detail }));
  const peerName = fid => (window.state.friends && window.state.friends[fid] && window.state.friends[fid].name) || fid;

  function markPending(fid, keys, acct) {
    const prev = peers[fid];
    if (!prev) return;
    prev.pend = { ik: keys.ik, ek: keys.ek, acct: !!acct, at: Date.now() };
    savePeers();
    if (typeof window.showToast === 'function') window.showToast(window.TSUI.tr('e2e.keyChangedToast', { name: peerName(fid) }), 'warn');
    emitPeer({ fid, changed: true });
  }

  function migratePeer(fid, keys) {
    const prev = peers[fid];
    const old = prev ? [prev.ik].concat(prev.old || []).filter((k, i, a) => k && k !== keys.ik && a.indexOf(k) === i).slice(0, 4) : [];
    peers[fid] = { ik: keys.ik, ek: keys.ek, at: Date.now(), acct: true, old };
    savePeers();
    emitPeer({ fid, migrated: true });
    return true;
  }

  async function verifyMigration(fid, keys, proof) {
    loadPeers();
    const prev = peers[fid];
    if (!prev || !proof || typeof proof.sig !== 'string' || !validKey(proof.ik)) return false;
    if (proof.ik !== prev.ik) return false;
    return verify(proof.ik, migrationStatement(fid, keys.ik, keys.ek), proof.sig);
  }

  // Yeni kayıt ya da kabul edilen değişiklikte true döner. opts: { acct, proof }
  function rememberPeer(fid, keys, opts = {}) {
    loadPeers();
    if (!fid || !keys || !validKey(keys.ik) || !validKey(keys.ek)) return false;
    const acct = !!opts.acct;
    const prev = peers[fid];
    if (!prev) {
      peers[fid] = { ik: keys.ik, ek: keys.ek, at: Date.now(), acct };
      savePeers();
      emitPeer({ fid });
      return true;
    }
    if (prev.ik === keys.ik && prev.ek === keys.ek) {
      if (acct && !prev.acct) { prev.acct = true; savePeers(); emitPeer({ fid }); }
      return false;
    }
    if ((prev.old || []).includes(keys.ik)) return false;               // eski anahtar yeniden görünüyor
    if (prev.pend && prev.pend.ik === keys.ik && prev.pend.ek === keys.ek) return false;
    if (prev.acct && !acct) return false;                               // hesap anahtarı eski cihaz anahtarına inmez
    if (acct && !prev.acct && opts.proof) {
      // Eski cihaz anahtarından hesap anahtarına göç: kanıt doğrulanırsa sessizce.
      verifyMigration(fid, keys, opts.proof).then(ok => {
        loadPeers();
        const p = peers[fid];
        if (!p || p.ik !== prev.ik) return;
        if (ok) migratePeer(fid, keys); else markPending(fid, keys, acct);
      }).catch(() => {});
      return false;
    }
    markPending(fid, keys, acct);
    return false;
  }

  // Grup/sunucu günlüğünde eski anahtarla imzalı, doğrulanmış göç kaydı.
  function notePeerMigration(fid, oldIk, keys) {
    loadPeers();
    const prev = peers[fid];
    if (!prev || prev.ik !== oldIk || !validKey(keys.ik) || !validKey(keys.ek)) return false;
    if (prev.ik === keys.ik) return false;
    return migratePeer(fid, keys);
  }

  function acceptPeerKey(fid) {
    loadPeers();
    const prev = peers[fid];
    if (!prev || !prev.pend) return false;
    const p = prev.pend;
    const old = [prev.ik].concat(prev.old || []).filter((k, i, a) => k && k !== p.ik && a.indexOf(k) === i).slice(0, 4);
    peers[fid] = { ik: p.ik, ek: p.ek, at: Date.now(), acct: !!p.acct, old };
    savePeers();
    emitPeer({ fid, accepted: true });
    return true;
  }

  function markRx(fid) {
    loadPeers();
    const prev = peers[fid];
    if (!prev || prev.rx) return;
    prev.rx = Date.now();
    savePeers();
    emitPeer({ fid, rx: true });
  }

  function peerKeys(fid) {
    loadPeers();
    return peers[fid] || null;
  }
  function trustedIks(fid) {
    const p = peerKeys(fid);
    return p ? [p.ik].concat(p.old || []) : [];
  }
  // Yedek için (bekleyen değişiklikler hariç) ve yedekten geri yükleme.
  function peersSnapshot() {
    loadPeers();
    const out = {};
    Object.keys(peers).forEach(fid => {
      const p = peers[fid];
      if (!p || !validKey(p.ik) || !validKey(p.ek)) return;
      out[fid] = { ik: p.ik, ek: p.ek, acct: !!p.acct, rx: p.rx ? 1 : 0, old: (p.old || []).slice(0, 4) };
    });
    return out;
  }
  function importPeer(fid, p) {
    loadPeers();
    if (!fid || !p || peers[fid] || !validKey(p.ik) || !validKey(p.ek)) return false;
    peers[fid] = { ik: p.ik, ek: p.ek, at: Date.now(), acct: !!p.acct, old: Array.isArray(p.old) ? p.old.filter(validKey).slice(0, 4) : [] };
    if (p.rx) peers[fid].rx = Date.now();
    savePeers();
    emitPeer({ fid });
    return true;
  }

  // ---------- testler (yalnızca TEAMSYNC_E2E_OFFLINE) ----------
  const testHooks = {
    // true: hesap kimliği hiç yüklenmez/üretilmez (eski sürüm istemcisi gibi)
    deviceOnly(on) { deviceOnly = !!on; ids = null; idsPromise = null; return ensureIdentity().then(() => 1); },
    reload() { ids = null; idsPromise = null; return ensureIdentity().then(() => 1); }
  };

  window.TSCrypto = {
    b64, unb64, canonical, ensureIdentity, publicKeysSync, accountKeysSync, deviceKeysSync, migrationProofSync,
    identityFor, holds, sign, verify, migrationStatement,
    aesKey, encrypt, decrypt, hmacHex, newGroupKey, wrapFor, unwrap,
    rememberPeer, peerKeys, trustedIks, acceptPeerKey, notePeerMigration, markRx, peersSnapshot, importPeer, validKey,
    exportAccountIdentity, installAccountIdentity, forgetIdentity,
    isDeviceOnly: () => deviceOnly,
    get _test() { return window.__tsE2EOffline ? testHooks : undefined; }
  };
})();
