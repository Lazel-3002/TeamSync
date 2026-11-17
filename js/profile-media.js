// Profil görselleri (avatar, hareketli avatar, arka plan): SUNUCUYA HİÇ GİTMEZ.
//
// - Seçilen resim bu cihazda işlenir (yeniden kodlanır / boyut sınırı) ve
//   hesap başına bir IndexedDB veritabanında (`ts-pmedia-<friendId>`) içerik
//   özetiyle (SHA-256) saklanır.
// - Profilde / presence'ta / oda hello'sunda resim adresi yerine kısa bir
//   tanımlayıcı dolaşır:  tsm:<sahibinin friendId'si>:<sha256 hex>:<bayt>
//   (yalnızca metin; Supabase'e de yalnızca bu metin yazılabilir).
// - Tanımlayıcıyı gören ama baytlara sahip olmayan istemci, sahibinden kişisel
//   MQTT konusu üzerinden ister:
//     → teamsync/user/<sahip>/events   { type:'req_pmedia', fromId, dv, h, m? }
//     ← teamsync/user/<isteyen>/events { type:'res_pmedia', fromId, h, s, n, i, d }
//       (d = en fazla 45 000 baytlık parçanın base64'ü, DM dosya parçalarıyla
//        aynı boy sınıfı; QoS 1, parçalar arası 25 ms)
//     ← { type:'res_pmedia', fromId, h, e:'gone' }  (o resim artık profilimde değil)
//   Alıcı boyutu + SHA-256'yı + dosya imzasını doğrular, yerel önbelleğe
//   (en fazla 64 MB, en eski kullanılan silinir) koyar ve blob: adresinden çizer.
// - Eski (Supabase "avatars" kovası) adresler yalnızca OKUNUR: eski sürüm
//   arkadaşların resimleri görünmeye devam eder; kendi eski resimlerim ilk
//   açılışta bir kez indirilip yerel depoya alınır.
(function () {
  'use strict';

  const REF_RE = /^tsm:([A-Za-z0-9_-]{3,128}):([0-9a-f]{64}):(\d{1,8})$/;
  const LEGACY_RE = /^https:\/\/[a-z0-9-]{8,40}\.supabase\.co\/storage\/v1\/object\/public\/avatars\/[A-Za-z0-9/_.-]{1,160}(\?[A-Za-z0-9=&._-]{0,60})?$/;
  const DATA_IMG_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i;
  const FID_RE = /^[A-Za-z0-9_-]{3,128}$/;
  const HASH_RE = /^[0-9a-f]{64}$/;

  const KB = 1024;
  const MB = 1024 * 1024;
  const LIMITS = {
    avatarPx: 256,
    avatarBytes: 60 * KB,       // hedef (kalite düşürülerek)
    bannerW: 1200,
    bannerH: 400,
    bannerBytes: 300 * KB,      // hedef
    gifBytes: 1 * MB,           // GIF yeniden kodlanamaz: kesin sınır
    inputBytes: 20 * MB,        // yeniden kodlanacak sabit resim için giriş sınırı
    itemBytes: 2 * MB,          // ağdan kabul edilen en büyük tek öğe (eski 2 MB GIF'ler taşınabilsin)
    cacheBytes: 64 * MB
  };
  const CHUNK = 45000;          // ham bayt → 60 000 karakter base64
  const PACE_MS = 25;
  const SERVE_FULL_EVERY = 3 * 60 * 1000;
  const SERVE_MAX_ACTIVE = 2;
  const SERVE_MAX_QUEUE = 8;
  const FETCH_MAX_ACTIVE = 4;

  const st = () => window.state || {};
  const me = () => st().friendId || '';
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);

  // ---------- Tanımlayıcı / temizleyiciler ----------
  function parse(ref) {
    if (typeof ref !== 'string') return null;
    const m = REF_RE.exec(ref);
    if (!m) return null;
    const s = Number(m[3]);
    if (!(s > 0 && s <= LIMITS.itemBytes)) return null;
    return { fid: m[1], h: m[2], s };
  }
  const isRef = v => !!parse(v);
  const isLegacyUrl = v => typeof v === 'string' && v.length < 400 && LEGACY_RE.test(v);
  const isLocalDataImage = v => typeof v === 'string' && v.length <= 2 * MB && DATA_IMG_RE.test(v.slice(0, 64)) && DATA_IMG_RE.test(v);
  const makeRef = (fid, h, s) => `tsm:${fid}:${h}:${s}`;

  // Saklanabilir değer: tanımlayıcı, eski kova adresi ya da (yalnız yerelde
  // duran) eski base64 avatar. Rastgele uzak adresler (IP sızdırma) reddedilir.
  function safeRef(v) {
    if (typeof v !== 'string' || !v) return '';
    if (isRef(v) || isLegacyUrl(v)) return v;
    if (isLocalDataImage(v)) return v;
    return '';
  }
  // Ağdan gelen yeni alanlar için: yalnızca tanımlayıcı ya da eski kova adresi.
  function safeWireRef(v) {
    return (isRef(v) || isLegacyUrl(v)) ? v : '';
  }

  // ---------- Bellek: hash → blob: adresi ----------
  const urls = new Map();       // h -> objectURL
  const ownUrls = new Set();    // bu modülün ürettiği blob: adresleri
  const fallbacks = new Map();  // yeni ref -> eski değer (yeni gelene dek eskisi görünsün)

  function urlFor(h, blob) {
    let u = urls.get(h);
    if (u) return u;
    u = URL.createObjectURL(blob);
    urls.set(h, u);
    ownUrls.add(u);
    return u;
  }

  function resetMemory() {
    urls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
    urls.clear();
    ownUrls.clear();
    loading.clear();
    fallbacks.clear();
  }

  // Çizim çözücüsü: TEK giriş noktası (renderer.js safeAvatarUrl → burası).
  function src(v) {
    if (typeof v !== 'string' || !v) return '';
    const r = parse(v);
    if (r) {
      const u = urls.get(r.h);
      if (u) return u;
      ensure(r);
      const fb = fallbacks.get(v);
      return fb && fb !== v ? src(fb) : '';
    }
    if (v.startsWith('blob:')) return ownUrls.has(v) ? v : '';
    if (isLegacyUrl(v)) return v;
    if (isLocalDataImage(v)) return v;
    return '';
  }

  // ---------- IndexedDB (hesap başına) ----------
  let dbp = null;
  let dbFor = null;
  function db(fid) {
    const owner = fid || me();
    if (!owner) return Promise.reject(new Error('no-account'));
    if (owner !== dbFor || !dbp) {
      dbFor = owner;
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(`ts-pmedia-${owner}`, 1);
        req.onupgradeneeded = () => {
          const s = req.result.createObjectStore('m', { keyPath: 'h' });
          s.createIndex('at', 'at');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('idb-open'));
        req.onblocked = () => reject(new Error('idb-blocked'));
      });
      dbp.catch(() => { if (dbFor === owner) { dbp = null; dbFor = null; } });
    }
    return dbp;
  }

  function reqP(r) {
    return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  }

  async function idbGet(h) {
    const d = await db();
    return reqP(d.transaction('m', 'readonly').objectStore('m').get(h));
  }

  async function idbPut(rec) {
    const d = await db();
    const t = d.transaction('m', 'readwrite');
    t.objectStore('m').put(rec);
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('abort')); });
  }

  async function idbAll() {
    const d = await db();
    return reqP(d.transaction('m', 'readonly').objectStore('m').getAll());
  }

  // Önbellek sınırı: sahibi ben olmayan (ya da artık profilimde olmayan)
  // kayıtlar en eski kullanılandan başlayarak silinir.
  let evictTimer = null;
  function scheduleEvict() {
    clearTimeout(evictTimer);
    evictTimer = setTimeout(() => evict().catch(() => {}), 1500);
  }
  async function evict() {
    const own = ownHashes();
    const all = (await idbAll()).filter(r => !own.has(r.h));
    let total = all.reduce((a, r) => a + (r.size || 0), 0);
    if (total <= LIMITS.cacheBytes) return;
    all.sort((a, b) => (a.at || 0) - (b.at || 0));
    const d = await db();
    const t = d.transaction('m', 'readwrite');
    const s = t.objectStore('m');
    for (const r of all) {
      if (total <= LIMITS.cacheBytes) break;
      s.delete(r.h);
      total -= r.size || 0;
      const u = urls.get(r.h);
      if (u) { urls.delete(r.h); ownUrls.delete(u); try { URL.revokeObjectURL(u); } catch (e) {} }
    }
  }

  // ---------- Bayt yardımcıları ----------
  function sniff(b) {
    if (!b || b.length < 12) return '';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return '';
  }

  async function sha256Hex(bytes) {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(d), x => x.toString(16).padStart(2, '0')).join('');
  }

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const fmtSize = n => (n >= MB
    ? `${n % MB === 0 ? n / MB : (n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB`
    : `${Math.max(1, Math.round(n / KB))} KB`);

  class MediaError extends Error {
    constructor(code, info) { super(code); this.code = code; this.info = info || {}; }
  }

  function errorText(err) {
    const code = err && err.code;
    const info = (err && err.info) || {};
    if (code === 'type') return tr(info.gif ? 'profile.mediaGifOnly' : 'profile.mediaType');
    if (code === 'size') return tr('profile.mediaTooLarge', { size: fmtSize(info.size || 0), limit: fmtSize(info.limit || 0) });
    if (code === 'decode') return tr('profile.mediaDecode');
    if (code === 'sfw') return tr('toast.aiContentBlocked');
    return tr('profile.mediaStore');
  }

  // ---------- Depoya al ----------
  // bytes: Uint8Array. own: profilimde kullanılacak (önbellekten silinmez).
  async function ingest(bytes, opts = {}) {
    const mime = sniff(bytes);
    if (!mime) throw new MediaError('type');
    const h = await sha256Hex(bytes);
    const blob = new Blob([bytes], { type: mime });
    try {
      await idbPut({ h, blob, mime, size: bytes.length, at: Date.now(), from: opts.from || me() });
    } catch (e) {
      console.warn('[pmedia] yerel depoya yazılamadı', e && e.message);
      throw new MediaError('store');
    }
    urlFor(h, blob);
    if (!opts.own) scheduleEvict();
    return { h, s: bytes.length, mime, ref: makeRef(opts.owner || me(), h, bytes.length) };
  }

  // ---------- Resim işleme ----------
  async function readBytes(file) {
    try { return new Uint8Array(await file.arrayBuffer()); } catch (e) { throw new MediaError('decode'); }
  }

  async function decode(bytes, mime) {
    try {
      return await createImageBitmap(new Blob([bytes], { type: mime }));
    } catch (e) {
      throw new MediaError('decode');
    }
  }

  async function encodeCanvas(canvas, maxBytes) {
    let last = null;
    for (const q of [0.86, 0.78, 0.68, 0.56, 0.45, 0.35]) {
      let blob = await new Promise(res => canvas.toBlob(res, 'image/webp', q));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', q));
      if (!blob) throw new MediaError('decode');
      last = blob;
      if (blob.size <= maxBytes) break;
    }
    return new Uint8Array(await last.arrayBuffer());
  }

  function drawCover(bmp, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const target = w / h;
    let sw = bmp.width, sh = bmp.height;
    if (sw / sh > target) sw = Math.round(sh * target); else sh = Math.round(sw / target);
    const sx = Math.round((bmp.width - sw) / 2), sy = Math.round((bmp.height - sh) / 2);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    return canvas;
  }

  async function staticAvatarFromBitmap(bmp) {
    const px = LIMITS.avatarPx;
    const canvas = drawCover(bmp, px, px);
    return encodeCanvas(canvas, LIMITS.avatarBytes);
  }

  async function sfwCheck(bytes, mime) {
    const s = st();
    if (!s.sfwMode || !s.aiModel || typeof window.checkAvatar !== 'function') return;
    const dataUrl = `data:${mime};base64,${toB64(bytes)}`;
    const ok = await window.checkAvatar(dataUrl);
    if (!ok) throw new MediaError('sfw');
  }

  // Sabit avatar: ortadan kare kırpılır, 256 px WebP (≈ ≤ 60 KB).
  async function processAvatar(file) {
    if (!file) throw new MediaError('decode');
    if (file.size > LIMITS.inputBytes) throw new MediaError('size', { size: file.size, limit: LIMITS.inputBytes });
    const raw = await readBytes(file);
    const mime = sniff(raw);
    if (!mime) throw new MediaError('type');
    const bmp = await decode(raw, mime);
    try {
      const out = await staticAvatarFromBitmap(bmp);
      await sfwCheck(out, sniff(out) || 'image/webp');
      return ingest(out, { own: true });
    } finally { try { bmp.close(); } catch (e) {} }
  }

  // Hareketli avatar: yalnızca GIF, ≤ 1 MB, olduğu gibi; ilk kare sabit avatar olur.
  async function processAnimAvatar(file) {
    if (!file) throw new MediaError('decode');
    const raw = await readBytes(file);
    const mime = sniff(raw);
    if (mime !== 'image/gif') throw new MediaError('type', { gif: true });
    if (raw.length > LIMITS.gifBytes) throw new MediaError('size', { size: raw.length, limit: LIMITS.gifBytes });
    const bmp = await decode(raw, mime);
    try {
      const first = await staticAvatarFromBitmap(bmp);
      await sfwCheck(first, sniff(first) || 'image/webp');
      const anim = await ingest(raw, { own: true });
      const still = await ingest(first, { own: true });
      return { ...anim, firstFrameRef: still.ref };
    } finally { try { bmp.close(); } catch (e) {} }
  }

  // Arka plan: sabit resim 3:1 kırpılıp en fazla 1200×400 WebP (≈ ≤ 300 KB);
  // GIF olduğu gibi (≤ 1 MB).
  async function processBanner(file) {
    if (!file) throw new MediaError('decode');
    if (file.size > LIMITS.inputBytes) throw new MediaError('size', { size: file.size, limit: LIMITS.inputBytes });
    const raw = await readBytes(file);
    const mime = sniff(raw);
    if (!mime) throw new MediaError('type');
    if (mime === 'image/gif') {
      if (raw.length > LIMITS.gifBytes) throw new MediaError('size', { size: raw.length, limit: LIMITS.gifBytes });
      const bmp = await decode(raw, mime);
      try { await sfwCheck(raw, mime); } finally { try { bmp.close(); } catch (e) {} }
      return ingest(raw, { own: true });
    }
    const bmp = await decode(raw, mime);
    try {
      const w = Math.min(LIMITS.bannerW, Math.max(3, bmp.width));
      const h = Math.max(1, Math.round(w / 3));
      const out = await encodeCanvas(drawCover(bmp, w, Math.min(h, LIMITS.bannerH)), LIMITS.bannerBytes);
      await sfwCheck(out, sniff(out) || 'image/webp');
      return ingest(out, { own: true });
    } finally { try { bmp.close(); } catch (e) {} }
  }

  // ---------- Kendi profilim ----------
  function profile() { return window.TSProfile ? window.TSProfile.mine() : {}; }

  function ownHashes() {
    const out = new Set();
    const add = v => { const r = parse(v); if (r && r.fid === me()) out.add(r.h); };
    add(st().myAvatar);
    const p = profile();
    add(p.avatarRef); add(p.bannerUrl); add(p.avatarAnimUrl);
    return out;
  }

  // Eski sürüm istemciler için gönderilecek eski avatar adresi (değiştirene dek).
  function legacyAvatar() {
    const p = profile();
    const l = p.legacy && p.legacy.av;
    if (isLegacyUrl(l)) return l;
    return isLegacyUrl(st().myAvatar) ? st().myAvatar : '';
  }

  // publishPresence tabanına eklenen alanlar.
  function presenceFields() {
    const out = {};
    const legacy = legacyAvatar();
    if (legacy) out.avatar = legacy;
    if (isRef(st().myAvatar)) out.avr = st().myAvatar;
    return out;
  }

  // profiles.avatar sütununa yazılabilecek TEK değer: eski kova adresi ya da null.
  function serverAvatar() {
    return legacyAvatar() || null;
  }

  function renderOwnAvatarImg() {
    const img = document.getElementById('my-avatar-img');
    const def = document.getElementById('my-avatar-default');
    if (!img) return;
    const u = src(st().myAvatar);
    if (u) {
      if (img.getAttribute('src') !== u) img.src = u;
      img.style.display = 'block';
      if (def) def.style.display = 'none';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      if (def) def.style.display = 'flex';
    }
  }

  // Yeni sabit avatarı uygula (dosyadan ya da GIF'in ilk karesinden).
  function applyOwnAvatar(ref) {
    const s = st();
    s.myAvatar = ref;
    s.myAvatarHash = typeof window.getAvatarHash === 'function' ? window.getAvatarHash(ref) : null;
    if (window.TSProfile && window.TSProfile.updateMine) {
      // updateMine → saveProfile + profile_ext + publishPresence + ts:profile
      window.TSProfile.updateMine(p => ({ ...p, avatarRef: ref, legacy: { ...(p.legacy || {}), av: '' } }));
    } else {
      if (typeof window.saveProfile === 'function') window.saveProfile();
      if (typeof window.publishPresence === 'function') window.publishPresence();
    }
    renderOwnAvatarImg();
    notifyAll(me());
  }

  async function setOwnAvatarFromFile(file) {
    const res = await processAvatar(file);
    applyOwnAvatar(res.ref);
    return res;
  }

  // ---------- Ağ: istek / yanıt ----------
  function publishTo(fid, payload, qos = 0) {
    const c = st().globalMqtt;
    if (!c || !c.connected || !FID_RE.test(fid || '')) return false;
    try { c.publish(`teamsync/user/${fid}/events`, JSON.stringify(payload), { qos }); return true; } catch (e) { return false; }
  }

  const loading = new Map();   // h -> Promise<boolean>
  const wants = new Map();     // h -> { fid, s, n, chunks, got, tries, lastAt, partials, timer, resolve, nextAt }
  let activeFetches = 0;
  const fetchQueue = [];

  // Çözücünün tetiklediği yükleme: önce yerel depo, yoksa sahibinden iste.
  function ensure(r) {
    if (!r || urls.has(r.h)) return Promise.resolve(true);
    if (loading.has(r.h)) return loading.get(r.h);
    if (!me()) return Promise.resolve(false);
    const p = (async () => {
      try {
        const rec = await idbGet(r.h);
        if (rec && rec.blob) {
          urlFor(r.h, rec.blob);
          if (Date.now() - (rec.at || 0) > 3600 * 1000) { rec.at = Date.now(); idbPut(rec).catch(() => {}); }
          notify(r.h, r.fid);
          return true;
        }
      } catch (e) {}
      if (r.fid === me() && !st().globalMqtt) return false;
      return fetchRemote(r);
    })();
    loading.set(r.h, p);
    p.then(ok => { if (!ok) setTimeout(() => { if (loading.get(r.h) === p) loading.delete(r.h); }, 1000); });
    return p;
  }

  function prefetch(ref) {
    const r = parse(ref);
    return r ? ensure(r) : Promise.resolve(false);
  }

  function fetchRemote(r) {
    return new Promise(resolve => {
      let w = wants.get(r.h);
      if (w) { w.resolvers.push(resolve); return; }
      w = { fid: r.fid, s: r.s, n: Math.ceil(r.s / CHUNK), chunks: new Map(), got: 0, tries: 0, partials: 0, lastAt: 0, timer: null, resolvers: [resolve], nextAt: 0, active: false };
      wants.set(r.h, w);
      schedule(r.h);
    });
  }

  function schedule(h) {
    const w = wants.get(h);
    if (!w || w.active) return;
    if (activeFetches >= FETCH_MAX_ACTIVE) { if (!fetchQueue.includes(h)) fetchQueue.push(h); return; }
    startFetch(h);
  }

  function startFetch(h) {
    const w = wants.get(h);
    if (!w) return;
    w.active = true;
    activeFetches++;
    w.tries++;
    w.lastAt = Date.now();
    w.chunks.clear(); w.got = 0; w.partials = 0;
    publishTo(w.fid, { type: 'req_pmedia', fromId: me(), dv: st().myId || '', h }, 1);
    armTimer(h);
  }

  function armTimer(h) {
    const w = wants.get(h);
    if (!w) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => onTimeout(h), w.got ? 8000 : 15000);
  }

  function finishFetch(h, ok) {
    const w = wants.get(h);
    if (!w) return;
    clearTimeout(w.timer);
    if (w.active) { w.active = false; activeFetches = Math.max(0, activeFetches - 1); }
    if (ok !== null) {
      wants.delete(h);
      w.resolvers.forEach(fn => { try { fn(ok); } catch (e) {} });
    }
    const next = fetchQueue.shift();
    if (next) schedule(next);
  }

  function onTimeout(h) {
    const w = wants.get(h);
    if (!w) return;
    // Bir kısmı geldiyse yalnızca eksik parçaları iste (en fazla 3 kez).
    if (w.got > 0 && w.partials < 3) {
      w.partials++;
      const missing = [];
      for (let i = 0; i < w.n && missing.length < 64; i++) if (!w.chunks.has(i)) missing.push(i);
      publishTo(w.fid, { type: 'req_pmedia', fromId: me(), dv: st().myId || '', h, m: missing }, 1);
      armTimer(h);
      return;
    }
    // Sahibi çevrimdışı / yanıt yok: bekle, çevrimiçi olunca (presence) ya da
    // artan aralıklarla yeniden dene. Bu sırada eski resim / baş harf görünür.
    finishFetch(h, null);
    w.nextAt = Date.now() + Math.min(5 * 60 * 1000, 30000 * Math.pow(2, Math.max(0, w.tries - 1)));
    w.timer = setTimeout(() => { if (wants.get(h) === w && !w.active) schedule(h); }, w.nextAt - Date.now());
    if (w.tries >= 8) {
      // Bu oturumda vazgeç; çözücü bir sonraki çizimde yeniden tetikleyebilir.
      clearTimeout(w.timer);
      wants.delete(h);
      loading.delete(h);
      w.resolvers.forEach(fn => { try { fn(false); } catch (e) {} });
    }
  }

  // Arkadaş çevrimiçi göründü: onu bekleyen istekleri hemen dene.
  function onPeerOnline(fid) {
    wants.forEach((w, h) => {
      if (w.fid === fid && !w.active && Date.now() - w.lastAt > 10000) { clearTimeout(w.timer); schedule(h); }
    });
  }

  async function onChunk(data) {
    const h = data.h;
    const w = wants.get(h);
    if (!w || data.fromId !== w.fid) return;
    if (data.e === 'gone') {
      loading.delete(h);
      finishFetch(h, false);
      return;
    }
    const n = Math.ceil(w.s / CHUNK);
    if (data.s !== w.s || data.n !== n || !Number.isInteger(data.i) || data.i < 0 || data.i >= n) return;
    if (typeof data.d !== 'string' || data.d.length > Math.ceil(CHUNK / 3) * 4 + 4) return;
    if (w.chunks.has(data.i)) return;
    let bytes;
    try { bytes = fromB64(data.d); } catch (e) { return; }
    const expected = data.i === n - 1 ? w.s - CHUNK * (n - 1) : CHUNK;
    if (bytes.length !== expected) return;
    w.chunks.set(data.i, bytes);
    w.got++;
    if (!w.active) { w.active = true; activeFetches++; }
    armTimer(h);
    if (w.got < n) return;
    clearTimeout(w.timer);
    const all = new Uint8Array(w.s);
    for (let i = 0; i < n; i++) all.set(w.chunks.get(i), i * CHUNK);
    w.chunks.clear();
    let ok = false;
    try {
      const hh = await sha256Hex(all);
      if (hh === h && sniff(all)) {
        await ingest(all, { own: false, owner: w.fid, from: w.fid });
        ok = true;
      } else {
        console.warn('[pmedia] doğrulanamayan resim reddedildi', h.slice(0, 12));
      }
    } catch (e) {
      console.warn('[pmedia] alınan resim saklanamadı', e && e.message);
    }
    finishFetch(h, ok);
    if (ok) notify(h, w.fid);
    else loading.delete(h);
  }

  // ---------- Sunma (sahibi olarak) ----------
  const served = new Map();     // `${fid}|${h}` -> { at, partials }
  let serving = 0;
  const serveQueue = [];

  function sharesGroup(fid) {
    try { return !!(window.TSGroups && window.TSGroups.list && window.TSGroups.list().some(g => (g.members || []).some(m => m.fid === fid))); } catch (e) { return false; }
  }
  function sharesServer(fid) {
    try {
      if (!window.TSServers || !window.TSServers.list) return false;
      return window.TSServers.list().some(s => {
        const rt = window.TSServers.get(s.sid);
        return !!(rt && rt.st && rt.st.members && rt.st.members[fid]);
      });
    } catch (e) { return false; }
  }
  function sharesRoom(fid) {
    try {
      const peers = st().peers;
      if (!peers || !st().room) return false;
      for (const p of peers.values()) if (p && p.friendId === fid) return true;
    } catch (e) {}
    return false;
  }

  // Kim isteyebilir: arkadaşlar (geçici kayıtlar dahil), ortak grup / sunucu
  // üyeleri, aynı odadakiler ve kendi öbür cihazlarım. Engellenenler asla.
  function mayFetch(fid) {
    if (!FID_RE.test(fid || '')) return false;
    if (window.TSBlock && typeof window.TSBlock.isBlocked === 'function' && window.TSBlock.isBlocked(fid)) return false;
    if (fid === me()) return true;
    const f = st().friends && st().friends[fid];
    if (f) return true;
    return sharesGroup(fid) || sharesServer(fid) || sharesRoom(fid);
  }

  function onRequest(data) {
    const to = data.fromId;
    if (!FID_RE.test(to || '') || !HASH_RE.test(data.h || '')) return;
    if (to === me() && data.dv && data.dv === st().myId) return; // kendi isteğim
    if (window.TSStatus && window.TSStatus.isInvisible && window.TSStatus.isInvisible()) return;
    if (!mayFetch(to)) return;
    if (!ownHashes().has(data.h)) {
      publishTo(to, { type: 'res_pmedia', fromId: me(), h: data.h, e: 'gone' }, 1);
      return;
    }
    const key = `${to}|${data.h}`;
    const now = Date.now();
    const rec = served.get(key);
    let only = null;
    if (Array.isArray(data.m) && data.m.length) {
      // Eksik parça isteği: son tam gönderimden sonra en fazla 3 kez.
      if (!rec || now - rec.at > SERVE_FULL_EVERY || rec.partials >= 3) return;
      rec.partials++;
      only = data.m.filter(i => Number.isInteger(i) && i >= 0 && i < 1000).slice(0, 64);
    } else {
      if (rec && now - rec.at < SERVE_FULL_EVERY) return;
      served.set(key, { at: now, partials: 0 });
      if (served.size > 500) served.delete(served.keys().next().value);
    }
    if (serveQueue.some(j => j.key === key && !j.only && !only)) return;
    if (serveQueue.length >= SERVE_MAX_QUEUE) return;
    serveQueue.push({ key, to, h: data.h, only });
    pumpServe();
  }

  function pumpServe() {
    while (serving < SERVE_MAX_ACTIVE && serveQueue.length) {
      const job = serveQueue.shift();
      serving++;
      sendMedia(job).catch(() => {}).finally(() => { serving--; pumpServe(); });
    }
  }

  async function sendMedia(job) {
    const rec = await idbGet(job.h);
    if (!rec || !rec.blob) return;
    const bytes = new Uint8Array(await rec.blob.arrayBuffer());
    const n = Math.ceil(bytes.length / CHUNK);
    const list = job.only || Array.from({ length: n }, (_, i) => i);
    for (const i of list) {
      if (i >= n) continue;
      const part = bytes.subarray(i * CHUNK, Math.min(bytes.length, (i + 1) * CHUNK));
      if (!publishTo(job.to, { type: 'res_pmedia', fromId: me(), h: job.h, s: bytes.length, n, i, d: toB64(part) }, 1)) return;
      await new Promise(r => setTimeout(r, PACE_MS));
    }
  }

  function onEvent(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'req_pmedia') onRequest(data);
    else if (data.type === 'res_pmedia' && HASH_RE.test(data.h || '') && FID_RE.test(data.fromId || '')) onChunk(data).catch(() => {});
  }

  // ---------- Canlı güncelleme ----------
  let friendsTimer = null;
  function notify(h, fid) {
    const u = urls.get(h);
    if (u) {
      // TSUI.avatarHtml henüz çözülemeyen tanımlayıcıyı [data-tsm] ile işaretler:
      // baş harfi yerinde resme çevir.
      document.querySelectorAll(`[data-tsm="${h}"]`).forEach(el => {
        const ini = el.querySelector('.ts-av-initial');
        if (!ini) return;
        const img = document.createElement('img');
        img.className = 'ts-av-img';
        img.alt = '';
        img.draggable = false;
        img.src = u;
        ini.replaceWith(img);
        el.removeAttribute('data-tsm');
      });
    }
    document.dispatchEvent(new CustomEvent('ts:profile-media', { detail: { h, fid } }));
    notifyAll(fid);
  }

  function notifyAll(fid) {
    if (fid && fid === me()) renderOwnAvatarImg();
    if (fid) document.dispatchEvent(new CustomEvent('ts:profile', { detail: { fid } }));
    clearTimeout(friendsTimer);
    friendsTimer = setTimeout(() => { if (typeof window.renderFriends === 'function') { try { window.renderFriends(); } catch (e) {} } }, 120);
  }

  // Arkadaşın yeni avatar tanımlayıcısı: baytlar gelene dek eski resim kalır.
  const adopting = new Map();
  function adoptFriendAvatar(fid, ref) {
    const r = parse(ref);
    const f = st().friends && st().friends[fid];
    if (!r || !f || f.avatar === ref || adopting.get(fid) === ref) return;
    adopting.set(fid, ref);
    if (f.avatar) fallbacks.set(ref, f.avatar);
    ensure(r).then(ok => {
      if (adopting.get(fid) !== ref) return;
      adopting.delete(fid);
      const cur = st().friends && st().friends[fid];
      if (!ok || !cur) return;
      cur.avatar = ref;
      if (typeof window.saveProfile === 'function') window.saveProfile();
      notifyAll(fid);
    });
  }

  // ---------- Hesap açılışı + eski resimlerin taşınması ----------
  let accountFor = null;
  function onAccount() {
    const fid = me();
    if (!fid || accountFor === fid) return;
    accountFor = fid;
    resetMemory();
    wants.forEach(w => clearTimeout(w.timer));
    wants.clear();
    fetchQueue.length = 0;
    activeFetches = 0;
    const p = profile();
    if (isRef(p.avatarRef) && parse(p.avatarRef).fid === fid) {
      st().myAvatar = p.avatarRef;
    }
    renderOwnAvatarImg();
    [st().myAvatar, p.bannerUrl, p.avatarAnimUrl].forEach(v => { const r = parse(v); if (r) ensure(r); });
    setTimeout(() => migrate(fid).catch(e => console.warn('[pmedia] taşıma', e && e.message)), 1500);
  }

  async function fetchLegacy(url) {
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error('http ' + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 4 * MB) throw new Error('too-large');
    return buf;
  }

  async function migrate(fid) {
    if (fid !== me() || window.__tsE2EOffline) return;
    const doneKey = `teamsync_pmedia_migrated::${fid}`;
    let state0 = {};
    try { state0 = JSON.parse(localStorage.getItem(doneKey) || '{}') || {}; } catch (e) {}
    if (state0.done || (state0.tries || 0) >= 5) return;
    const p = profile();
    const s = st();
    const patch = {};
    const legacy = { ...(p.legacy || {}) };
    let failed = false;

    const toFile = (bytes) => new Blob([bytes], { type: sniff(bytes) || 'application/octet-stream' });
    // Avatar: eski kova adresi ya da (yükleme başarısız olduğu için) yerel base64
    if (!isRef(s.myAvatar) && (isLegacyUrl(s.myAvatar) || isLocalDataImage(s.myAvatar))) {
      try {
        const bytes = isLegacyUrl(s.myAvatar) ? await fetchLegacy(s.myAvatar) : fromB64(s.myAvatar.split(',')[1] || '');
        const res = await processAvatar(toFile(bytes));
        if (isLegacyUrl(s.myAvatar)) legacy.av = s.myAvatar;
        patch.avatarRef = res.ref;
      } catch (e) { failed = true; console.warn('[pmedia] eski avatar alınamadı', e && (e.code || e.message)); }
    }
    if (isLegacyUrl(p.avatarAnimUrl)) {
      try {
        const bytes = await fetchLegacy(p.avatarAnimUrl);
        if (sniff(bytes) !== 'image/gif' || bytes.length > LIMITS.itemBytes) throw new Error('bad-gif');
        const res = await ingest(bytes, { own: true });
        legacy.an = p.avatarAnimUrl;
        patch.avatarAnimUrl = res.ref;
      } catch (e) { failed = true; console.warn('[pmedia] eski GIF alınamadı', e && (e.code || e.message)); }
    }
    if (isLegacyUrl(p.bannerUrl)) {
      try {
        const bytes = await fetchLegacy(p.bannerUrl);
        let res;
        if (sniff(bytes) === 'image/gif') {
          if (bytes.length > LIMITS.itemBytes) throw new Error('bad-gif');
          res = await ingest(bytes, { own: true });
        } else {
          res = await processBanner(toFile(bytes));
        }
        legacy.bn = p.bannerUrl;
        patch.bannerUrl = res.ref;
      } catch (e) { failed = true; console.warn('[pmedia] eski arka plan alınamadı', e && (e.code || e.message)); }
    }
    if (fid !== me()) return;
    if (Object.keys(patch).length && window.TSProfile && window.TSProfile.updateMine) {
      if (patch.avatarRef) {
        s.myAvatar = patch.avatarRef;
        s.myAvatarHash = typeof window.getAvatarHash === 'function' ? window.getAvatarHash(patch.avatarRef) : null;
      }
      window.TSProfile.updateMine(cur => ({ ...cur, ...patch, legacy }));
      renderOwnAvatarImg();
      notifyAll(fid);
    }
    try { localStorage.setItem(doneKey, JSON.stringify(failed ? { tries: (state0.tries || 0) + 1 } : { done: true })); } catch (e) {}
  }

  // ---------- Sunucuya yazım koruması ----------
  // Supabase'e giden her satır buradan geçer: data:/blob: değerler ve makul bir
  // adres uzunluğunu aşan metinler atılır (resim baytı sunucuya ASLA gitmez).
  function serverSafe(value, path = 'row', depth = 0) {
    if (depth > 6) return undefined;
    if (typeof value === 'string') {
      if (/^\s*(data|blob):/i.test(value) || value.length > 2048) {
        console.warn(`[pmedia] sunucuya yazılmadı (resim verisi/uzun değer): ${path}`);
        return null;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((v, i) => serverSafe(v, `${path}[${i}]`, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => { out[k] = serverSafe(value[k], `${path}.${k}`, depth + 1); });
      return out;
    }
    return value;
  }

  window.TSProfileMedia = {
    parse, isRef, isLegacyUrl, safeRef, safeWireRef, src, prefetch, ensure: ref => prefetch(ref),
    processAvatar, processAnimAvatar, processBanner, setOwnAvatarFromFile, applyOwnAvatar,
    errorText, MediaError, LIMITS, fmtSize,
    presenceFields, serverAvatar, legacyAvatar, ownHashes, serverSafe,
    onEvent, onPeerOnline, adoptFriendAvatar, onAccount, renderOwnAvatarImg,
    _sha256Hex: sha256Hex, _sniff: sniff, _idbGet: idbGet
  };
})();
