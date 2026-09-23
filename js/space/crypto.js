// Grup (ve ileride sunucu) motorunun şifreleme katmanı — yalnızca WebCrypto.
//
// • Kimlik: hesap başına ECDSA P-256 (imza, "ik") + ECDH P-256 (anahtar
//   değişimi, "ek"). Özel anahtarlar DIŞA AKTARILAMAZ (extractable:false) ve
//   bu bilgisayarın IndexedDB'sinde CryptoKey olarak durur. Açık anahtarlar
//   profil yanıtıyla (res_profile.keys) arkadaşlara gider.
// • Arkadaş anahtarları ilk görüşte güvenilir (TOFU) kaydedilir; sonradan
//   değişirse kullanıcı uyarılır.
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

  let identity = null;       // { fid, sign, dh, ik, ek }
  let identityPromise = null;

  async function ensureIdentity() {
    const fid = window.state && window.state.friendId;
    if (!fid) return null;
    if (identity && identity.fid === fid) return identity;
    if (identityPromise && identityPromise.fid === fid) return identityPromise.p;
    const p = (async () => {
      let rec = await idbGet(fid).catch(() => null);
      if (!rec) {
        const sign = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        const dh = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        const ik = b64(await subtle.exportKey('spki', sign.publicKey));
        const ek = b64(await subtle.exportKey('spki', dh.publicKey));
        rec = { sign, dh, ik, ek, createdAt: Date.now() };
        await idbPut(fid, rec);
      }
      identity = { fid, sign: rec.sign, dh: rec.dh, ik: rec.ik, ek: rec.ek };
      return identity;
    })();
    identityPromise = { fid, p };
    return p;
  }

  function publicKeysSync() {
    const fid = window.state && window.state.friendId;
    return identity && identity.fid === fid ? { ik: identity.ik, ek: identity.ek } : null;
  }

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

  async function sign(obj) {
    const id = await ensureIdentity();
    const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, id.sign.privateKey, te.encode(canonical(obj)));
    return b64(sig);
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

  async function unwrap(wrapped, salt, info) {
    const id = await ensureIdentity();
    const epk = await importPub(wrapped.epk, 'ek');
    const bits = await subtle.deriveBits({ name: 'ECDH', public: epk }, id.dh.privateKey, 256);
    const key = await hkdfKey(bits, salt, info);
    return decrypt(key, wrapped.iv, wrapped.ct);
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

  // Yeni kayıt ya da değişiklikte true döner.
  function rememberPeer(fid, keys) {
    loadPeers();
    if (!fid || !keys || !validKey(keys.ik) || !validKey(keys.ek)) return false;
    const prev = peers[fid];
    if (prev && prev.ik === keys.ik && prev.ek === keys.ek) return false;
    if (prev && (prev.ik !== keys.ik || prev.ek !== keys.ek)) {
      const name = (window.state.friends[fid] && window.state.friends[fid].name) || fid;
      if (typeof window.showToast === 'function') window.showToast(window.TSUI.tr('groups.keyChanged', { name }), 'warn');
    }
    peers[fid] = { ik: keys.ik, ek: keys.ek, at: Date.now() };
    savePeers();
    document.dispatchEvent(new CustomEvent('ts:peerkeys', { detail: { fid } }));
    return true;
  }
  function peerKeys(fid) {
    loadPeers();
    return peers[fid] || null;
  }

  window.TSCrypto = {
    b64, unb64, canonical, ensureIdentity, publicKeysSync, sign, verify,
    aesKey, encrypt, decrypt, hmacHex, newGroupKey, wrapFor, unwrap,
    rememberPeer, peerKeys, validKey
  };
})();
