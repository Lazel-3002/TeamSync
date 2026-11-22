// Kişisel olaylar için UÇTAN UCA ŞİFRELEME (v2 zarf) — window.TSE2E.
//
// DM'ler, dosyalar, yazıyor/tepki/onay, arama sinyalleri, grup davetleri,
// profil istekleri… herkese açık MQTT aracılarında `teamsync/user/<fid>/events`
// konusundan gider. Eskiden tek "koruma", anahtarı konunun 3. parçası (= alıcının
// HERKESE AÇIK arkadaşlık kimliği) olan CryptoJS sarmalıydı (renderer.js başı) —
// ve o bile hiç devreye girmiyordu (mqtt.connect salt okunur): olaylar DÜZ JSON
// gidiyordu. "Eski yol" (legacy) = düz JSON; eski sürümler yalnızca onu anlar.
//
// v2: hesap kimlikleri (js/space/crypto.js) arasında statik-statik ECDH →
// HKDF-SHA256 (yöne özel: gönderen→alıcı) → AES-GCM-256, her mesajda rastgele
// 12 bayt IV. Zarf (konuya giden tek şey):
//   TS2E:{"v":1,"f":<gönderen>,"t":<alıcı>,"ts":<ms>,"n":<iv b64>,
//         "sk":<gönderen ek parmak izi>,"rk":<alıcı ek parmak izi>,"c":<şifreli b64>}
// AAD = "TS2E|1|f|t|ts|n|sk|rk". Olay türü ve tüm alanlar şifreli içeriktedir
// (GCM ile doğrulanır); aracı yalnızca kimin kime ne zaman yazdığını görür.
// Yeniden oynatma: |şimdi−ts| ≤ 30 dk ve (gönderen, IV) 61 dk boyunca bir kez.
// İmza yok: statik ECDH anahtarını yalnızca iki taraf türetebilir (üçüncü kişi
// sahte mesaj üretemez); inkâr edilebilirlik korunur.
//
// Uyumluluk: arkadaşın HESAP anahtarı bilinmiyorsa (eski sürüm / henüz
// gelmedi) eski sarmal kullanılır ve DM "şifresiz gönderildi" işaretlenir.
// Arkadaştan bir kez geçerli v2 alındıktan sonra o arkadaştan gelen eski
// sarmallı olaylar REDDEDİLİR (düşürme saldırısı). İstisna: arkadaşlık isteği /
// kabulü (yabancılardan gelir) ve kendi cihazlarımın acct_dev kanalı.
(function () {
  'use strict';

  const PREFIX = 'TS2E:';
  const WINDOW = 30 * 60 * 1000;
  const KEEP = 61 * 60 * 1000;
  const HOLD_MS = 3 * 60 * 1000;
  const HOLD_MAX = 200;
  const EXEMPT = new Set(['friend_request', 'friend_accepted', 'acct_dev']);
  const FID_RE = /^[A-Za-z0-9_-]{3,128}$/;
  const TOPIC_RE = /^teamsync\/user\/([A-Za-z0-9_-]{3,128})\/events$/;

  const subtle = window.crypto.subtle;
  const te = new TextEncoder();
  const td = new TextDecoder();
  const C = () => window.TSCrypto;
  const st = () => window.state || {};
  const me = () => st().friendId;
  const validFid = f => typeof f === 'string' && FID_RE.test(f);

  const stats = { sealed: 0, opened: 0, legacyOut: 0, legacyIn: 0, replay: 0, stale: 0, downgrade: 0, auth: 0, held: 0, bad: 0 };

  // ---------------------------------------------------------- parmak izleri
  const kidCache = new Map();
  async function kid(ek) {
    if (kidCache.has(ek)) return kidCache.get(ek);
    const h = new Uint8Array(await subtle.digest('SHA-256', te.encode('ts-kid|' + ek)));
    const v = Array.from(h.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (kidCache.size > 500) kidCache.clear();
    kidCache.set(ek, v);
    return v;
  }

  // ------------------------------------------------------- anahtar türetme
  const keyCache = new Map();
  function dirKey(from, to, ekFrom, ekTo, myEk, peerEk) {
    const ck = `${from}|${to}|${ekFrom}|${ekTo}`;
    if (!keyCache.has(ck)) {
      keyCache.set(ck, (async () => {
        const id = await C().identityFor(myEk);
        if (!id || id.ek !== myEk) throw new Error('no-account-identity');
        const pub = await subtle.importKey('spki', C().unb64(peerEk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, id.dh.privateKey, 256);
        const base = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('teamsync-dm-v2'), info: te.encode(`ts-dm-v2|${from}|${to}|${ekFrom}|${ekTo}`) },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      })().catch(e => { keyCache.delete(ck); throw e; }));
      if (keyCache.size > 400) keyCache.delete(keyCache.keys().next().value);
    }
    return keyCache.get(ck);
  }
  const aadOf = e => te.encode(`TS2E|1|${e.f}|${e.t}|${e.ts}|${e.n}|${e.sk}|${e.rk}`);

  // ------------------------------------------------------------ durum
  function canEncryptTo(fid) {
    if (!validFid(fid) || fid === me() || !C()) return false;
    const mine = C().accountKeysSync();
    const p = C().peerKeys(fid);
    return !!(mine && p && p.acct);
  }
  // 'e2ee' | 'plain' | 'changed'
  function status(fid) {
    const p = C() ? C().peerKeys(fid) : null;
    if (p && p.pend) return { mode: 'changed', pend: true, e2ee: canEncryptTo(fid) };
    return { mode: canEncryptTo(fid) ? 'e2ee' : 'plain', confirmed: !!(p && p.rx) };
  }

  // ------------------------------------------------------------ mühürleme
  async function seal(toFid, json) {
    const mine = C().accountKeysSync();
    const p = C().peerKeys(toFid);
    const from = me();
    if (!mine || !p || !p.acct || !from) return null;
    const key = await dirKey(from, toFid, mine.ek, p.ek, mine.ek, p.ek);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const env = { v: 1, f: from, t: toFid, ts: Date.now(), n: C().b64(iv), sk: await kid(mine.ek), rk: await kid(p.ek) };
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(env) }, key, te.encode(json));
    env.c = C().b64(ct);
    stats.sealed++;
    return PREFIX + JSON.stringify(env);
  }

  // Gönderim: küresel MQTT istemcisinin publish'i sarılır. Başka birinin kişisel
  // konusuna giden JSON olaylar sırayla (dosya parçaları karışmasın) mühürlenir.
  async function prepare(fid, message) {
    let data;
    try { data = JSON.parse(message); } catch (e) { return message; }
    if (!data || typeof data !== 'object') return message;
    let force = false;
    if (data.__plain === 1) { force = true; delete data.__plain; message = JSON.stringify(data); }
    if (!force && !EXEMPT.has(data.type) && needsIdentity()) {
      // Kodla eklenmiş cihaz, hesap kimliği gelmeden hesap anahtarı bilinen
      // arkadaşa şifresiz yazmaz (o arkadaş zaten reddederdi): DM kuyrukta
      // kalır, kimlik gelince yeniden gönderilir.
      const p = C().peerKeys(fid);
      if (p && p.acct) throw new Error('identity-pending');
    }
    if (force || EXEMPT.has(data.type) || !canEncryptTo(fid)) { stats.legacyOut++; return message; }
    const env = await seal(fid, message);
    if (!env) throw new Error('seal-failed');   // anahtar biliniyorken asla düz metne düşülmez
    return env;
  }

  function attach(client) {
    if (!client || client.__tse2e) return client;
    const orig = client.publish.bind(client);
    let chain = Promise.resolve();
    client.publish = function (topic, message, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = undefined; }
      const m = typeof topic === 'string' ? TOPIC_RE.exec(topic) : null;
      if (!m || m[1] === me() || typeof message !== 'string') return orig(topic, message, opts, cb);
      chain = chain.then(async () => {
        let out;
        try { out = await prepare(m[1], message); } catch (e) {
          console.warn('TS2E: olay gönderilmedi (şifrelenemedi):', e && e.message);
          return;
        }
        try { orig(topic, out, opts, cb); } catch (e) {}
      });
      return client;
    };
    client.__tse2e = true;
    return client;
  }

  // ------------------------------------------------------------ yeniden oynatma
  let seen = null;
  let seenFor = null;
  let seenSaveTimer = null;
  const SEEN_KEY = fid => `teamsync_e2e_seen_${fid}`;
  function seenMap() {
    const fid = me();
    if (seenFor !== fid) {
      seenFor = fid;
      try { seen = new Map(Object.entries(JSON.parse(localStorage.getItem(SEEN_KEY(fid)) || '{}') || {})); } catch (e) { seen = new Map(); }
    }
    return seen;
  }
  function rememberNonce(k) {
    const map = seenMap();
    const now = Date.now();
    map.set(k, now);
    if (map.size > 4000) map.forEach((at, key) => { if (now - at > KEEP) map.delete(key); });
    if (map.size > 20000) { const drop = map.size - 15000; let i = 0; for (const key of map.keys()) { if (i++ >= drop) break; map.delete(key); } }
    if (!seenSaveTimer) {
      const fid = seenFor;
      seenSaveTimer = setTimeout(() => {
        seenSaveTimer = null;
        if (fid !== seenFor) return;
        const cut = Date.now() - KEEP;
        const obj = {};
        seen.forEach((at, key) => { if (at > cut) obj[key] = at; });
        try { localStorage.setItem(SEEN_KEY(fid), JSON.stringify(obj)); } catch (e) {}
      }, 2000);
    }
  }

  // ------------------------------------------------------------ alma
  const held = new Map();   // fid -> [{ str, deliver, at }]
  function hold(fid, str, deliver) {
    const now = Date.now();
    const list = (held.get(fid) || []).filter(h => now - h.at < HOLD_MS);
    if (list.length >= HOLD_MAX) list.shift();
    list.push({ str, deliver, at: now });
    held.set(fid, list);
    stats.held++;
    askKeys(fid);
  }
  const lastAsk = new Map();
  function askKeys(fid) {
    const now = Date.now();
    if (now - (lastAsk.get(fid) || 0) < 20000) return;
    lastAsk.set(fid, now);
    if (window.TSProfile && window.TSProfile.request) window.TSProfile.request(fid, 0, true);
  }
  function release(fid) {
    const list = held.get(fid);
    if (!list || !list.length) return;
    held.delete(fid);
    const now = Date.now();
    list.filter(h => now - h.at < HOLD_MS).forEach(h => enqueue(h.str, h.deliver));
  }

  // Dönüş: { data, from } | null (düşürüldü/bekletildi)
  async function open(str, deliver) {
    let env;
    try { env = JSON.parse(str.slice(PREFIX.length)); } catch (e) { stats.bad++; return null; }
    const my = me();
    if (!env || env.v !== 1 || env.t !== my || !validFid(env.f) || env.f === my || !Number.isFinite(env.ts)
      || typeof env.n !== 'string' || typeof env.c !== 'string' || typeof env.sk !== 'string' || typeof env.rk !== 'string') { stats.bad++; return null; }
    if (Math.abs(Date.now() - env.ts) > WINDOW) { stats.stale++; return null; }
    const nk = `${env.f}|${env.n}`;
    if (seenMap().has(nk)) { stats.replay++; return null; }
    const mine = C() && C().accountKeysSync();
    if (!mine) { await C().ensureIdentity().catch(() => null); if (!C().accountKeysSync()) { stats.bad++; return null; } }
    const myAcct = C().accountKeysSync();
    if (env.rk !== await kid(myAcct.ek)) { stats.bad++; return null; }
    const p = C().peerKeys(env.f);
    if (!p || env.sk !== await kid(p.ek)) {
      // Göndereni (ya da yeni anahtarını) henüz tanımıyoruz: kısa süre bekletilir,
      // profil (anahtarlar) istenir. Bekleyen anahtar değişikliği kabul edilene
      // kadar da bekler.
      hold(env.f, str, deliver);
      return null;
    }
    let plain;
    try {
      const key = await dirKey(env.f, my, p.ek, myAcct.ek, myAcct.ek, p.ek);
      plain = await subtle.decrypt({ name: 'AES-GCM', iv: C().unb64(env.n), additionalData: aadOf(env) }, key, C().unb64(env.c));
    } catch (e) { stats.auth++; return null; }
    if (seenMap().has(nk)) { stats.replay++; return null; }
    rememberNonce(nk);
    let data;
    try { data = JSON.parse(td.decode(plain)); } catch (e) { stats.bad++; return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { stats.bad++; return null; }
    const claimed = data.fromId || data.id;
    if (claimed && claimed !== env.f) { stats.bad++; return null; }
    stats.opened++;
    C().markRx(env.f);
    return { data, from: env.f };
  }

  // Eski sarmallı (ya da düz) olay: düşürme kuralı.
  function legacyAllowed(data) {
    if (!data || typeof data !== 'object') return false;
    if (EXEMPT.has(data.type)) return true;
    const sender = data.fromId || data.id;
    if (!validFid(sender) || sender === me()) return true;
    const p = C() ? C().peerKeys(sender) : null;
    if (p && p.acct && p.rx && C().accountKeysSync()) {
      stats.downgrade++;
      console.warn('TS2E: şifreli konuşulan kişiden şifresiz olay reddedildi (tür: ' + String(data.type).slice(0, 24) + ')');
      return false;
    }
    stats.legacyIn++;
    return true;
  }

  let rxChain = Promise.resolve();
  function enqueue(str, deliver) {
    rxChain = rxChain.then(async () => {
      if (str.startsWith(PREFIX)) {
        const res = await open(str, deliver);
        if (res) deliver(res.data, res.from);
        return;
      }
      let data;
      try { data = JSON.parse(str); } catch (e) { return; }
      if (legacyAllowed(data)) deliver(data, null);
    }).catch(e => console.warn('TS2E: gelen olay işlenemedi:', e && e.message));
  }
  // renderer.js: kendi kişisel konuma gelen her şey buradan, SIRAYLA geçer.
  function receive(str, deliver) { enqueue(String(str), deliver); }

  // ------------------------------------------------------------ anahtar dağıtımı
  // Presence'a eklenen alan: { ak: { i, e } } (yalnızca hesap kimliği varken).
  function presenceFields() {
    if (C()) C().ensureIdentity().catch(() => {});  // kaynak cihaz: kimlik üretimi/yeniden deneme
    const a = C() && C().accountKeysSync();
    return a ? { ak: { i: a.ik, e: a.ek } } : {};
  }
  const lastProfileAsk = new Map();
  function onAdvert(fid, ak) {
    if (!validFid(fid) || fid === me() || !ak || !C() || !C().validKey(ak.i) || !C().validKey(ak.e)) return;
    const p = C().peerKeys(fid);
    if (!p) { C().rememberPeer(fid, { ik: ak.i, ek: ak.e }, { acct: true }); return; }
    if (p.ik === ak.i && p.ek === ak.e) { if (!p.acct) C().rememberPeer(fid, { ik: ak.i, ek: ak.e }, { acct: true }); return; }
    if ((p.old || []).includes(ak.i) || (p.pend && p.pend.ik === ak.i)) return;
    // Sabitlenmiş HESAP anahtarı değişti: kullanıcı kabul edene kadar bekleyen
    // değişiklik (uyarı). Yeni anahtar hiçbir şeyde kullanılmaz; v2 profil
    // isteği eski anahtarla şifreli gideceği için karşı taraf yanıt veremezdi.
    if (p.acct) { C().rememberPeer(fid, { ik: ak.i, ek: ak.e }, { acct: true }); return; }
    // Eski cihaz anahtarı sabit: göç kanıtı (mk) profil yanıtıyla gelir.
    const now = Date.now();
    if (now - (lastProfileAsk.get(fid) || 0) < 60000) return;
    lastProfileAsk.set(fid, now);
    if (window.TSProfile && window.TSProfile.request) window.TSProfile.request(fid, 0, true);
  }

  // ------------------------------------------------------------ kendi cihazlarım
  // Kodla eklenmiş (kimliği olmayan) cihaz, açık bir kendi cihazından hesap
  // kimliğini acct_dev kanalıyla ister (hesap kodundan türeyen anahtarla
  // AES-GCM; yalnızca aynı hesabın cihazları açabilir). Mesaj yedeği (K) de
  // aynı kimliği taşır (js/msg-backup.js).
  function needsIdentity() {
    const s = st();
    if (!C() || C().isDeviceOnly() || C().accountKeysSync() || s.accountKind !== 'cloud' || !window.TSAccounts) return false;
    try { return window.TSAccounts.isImportedSlot(window.TSAccounts.currentSlot()); } catch (e) { return false; }
  }
  let lastIdReply = 0;
  let idBusy = false;
  async function onOwnDevice(body, myDeviceId) {
    if (!body || !C()) return;
    if (body.k === 'idreq') {
      if (Date.now() - lastIdReply < 3000 || !C().accountKeysSync()) return;
      lastIdReply = Date.now();
      const id = await C().exportAccountIdentity().catch(() => null);
      const ns = window.TSNetSettings;
      if (id && ns && typeof ns.sendOwn === 'function') ns.sendOwn({ k: 'idkey', to: body.dv, id }).catch(() => {});
    } else if (body.k === 'idkey') {
      if (body.to !== myDeviceId || !body.id || idBusy || C().accountKeysSync()) return;
      idBusy = true;
      try {
        const res = await C().installAccountIdentity(body.id);
        if (res === 'ok' && typeof window.showToast === 'function') window.showToast(window.TSUI.tr('e2e.identityReceived'), 'ok');
        if (res === 'conflict') console.warn('TS2E: kendi cihazımdan gelen kimlik buradakiyle çelişiyor; yok sayıldı');
      } finally { idBusy = false; }
    }
  }
  setInterval(() => {
    if (!needsIdentity()) return;
    const ns = window.TSNetSettings;
    if (ns && typeof ns.sendOwn === 'function') ns.sendOwn({ k: 'idreq' }).catch(() => {});
  }, 20000);

  function accept(fid) {
    if (!C() || !C().acceptPeerKey(fid)) return false;
    // Bekleyen DM'ler yeniden gönderilsin, bekletilen gelenler açılsın.
    if (window.TSDMX && window.TSDMX.onFriendOnline) window.TSDMX.onFriendOnline(fid);
    return true;
  }

  // ------------------------------------------------------------ güvenlik kodu
  // İki tarafın hesap anahtarlarından 12 hane; iki kişi yüz yüze karşılaştırır.
  const codeCache = new Map();
  async function safetyCode(fid) {
    const mine = C() && C().accountKeysSync();
    const p = C() && C().peerKeys(fid);
    if (!mine || !p || !p.acct || !me()) return null;
    const a = { f: me(), k: `${mine.ik}.${mine.ek}` };
    const b = { f: fid, k: `${p.ik}.${p.ek}` };
    const [x, y] = a.f < b.f ? [a, b] : [b, a];
    const ck = `${x.f}|${x.k}|${y.f}|${y.k}`;
    if (codeCache.has(ck)) return codeCache.get(ck);
    const h = new Uint8Array(await subtle.digest('SHA-256', te.encode(`ts-safety-v1|${ck}`)));
    let n = 0n;
    for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(h[i]);
    const digits = (n % 1000000000000n).toString().padStart(12, '0');
    const code = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
    codeCache.set(ck, code);
    return code;
  }
  const syncCodes = new Map();
  function safetyCodeSync(fid) {
    const v = syncCodes.get(fid);
    safetyCode(fid).then(code => {
      if (!code) return;
      const changed = syncCodes.get(fid) !== code;
      syncCodes.set(fid, code);
      if (changed) document.querySelectorAll(`[data-safety-fid="${CSS.escape(fid)}"] .pc-safety-code`).forEach(el => { el.textContent = code; });
    }).catch(() => {});
    return v || null;
  }

  document.addEventListener('ts:peerkeys', e => {
    const fid = e.detail && e.detail.fid;
    if (fid) { syncCodes.delete(fid); release(fid); }
    // Kişiler listesindeki "anahtar değişti" rozeti
    if (e.detail && (e.detail.changed || e.detail.accepted) && typeof window.renderFriends === 'function') {
      try { window.renderFriends(); } catch (err) {}
    }
  });
  document.addEventListener('ts:identity', () => {
    keyCache.clear();
    held.forEach((_, fid) => release(fid));
    // Kimlik beklerken gönderilemeyen DM'ler şimdi (şifreli) gitsin.
    const friends = st().friends || {};
    if (window.TSDMX && window.TSDMX.onFriendOnline) Object.keys(friends).forEach(fid => { if (friends[fid] && friends[fid].online) window.TSDMX.onFriendOnline(fid); });
  });

  window.TSE2E = {
    PREFIX, EXEMPT, attach, receive, canEncryptTo, status, presenceFields, onAdvert, accept, onOwnDevice, needsIdentity,
    safetyCode, safetyCodeSync, isEnvelope: s => typeof s === 'string' && s.startsWith(PREFIX),
    stats: () => ({ ...stats })
  };
})();
