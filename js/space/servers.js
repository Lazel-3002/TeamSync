// Sunucular — "bilgisayarda barındırılan" Discord tarzı topluluklar.
//
// Bir sunucu, imzalı olaylardan oluşan bir günlüktür (js/space/server-state.js
// kuralları). Günlüğün tamamını SAHİP + sahibin teklifini kabul eden ORTAK
// BARINDIRICILAR tutar; üyeler gördüklerini önbelleğe alır. Hiçbir
// barındırıcı çevrimiçi değilse sunucu gri görünür ve salt okunurdur.
//
// Akış: üye olayını imzalar → /sub konusuna gönderir → çevrimiçi bir
// barındırıcı yetki / yavaş mod / yasak denetimini yapar, kendi imzasıyla
// "onaylar" (acc) ve /ev konusuna yayınlar → herkes iki imzayı da doğrular.
// Kontrol olayları (rol, kanal, üye, davet...) her bilgisayarda yeniden
// hesaplanır; yetkisiz bir kontrol olayı barındırıcıdan geçse bile uygulanmaz.
//
// Konular (T/H grup anahtarından türetilir, dışarıdan tahmin edilemez):
//   teamsync/s/<T>/ev      onaylı olaylar (herkes)
//   teamsync/s/<T>/sub     onay bekleyen gönderimler (barındırıcılar)
//   teamsync/s/<T>/eph     kalp atışı, yazıyor, ses kanalı dolulukları, istekler
//   teamsync/s/<T>/to/<H>  tek üyeye giden eşitleme yanıtları
//   teamsync/inv/<P>       davet buluşma noktası (P = PBKDF2(davet kodu))
//   teamsync/dir/v1/<D>    herkese açık sunucu dizini (kalıcı/retained)
// Atma/yasaklamada anahtar yenilenir; üyeler yeni anahtarı barındırıcının
// kişisel konusundan ister (srv_kreq → srv_key).
(function () {
  const HOST_HB = 10000;
  const MEMBER_HB = 30000;
  const HOST_STALE = 26000;
  const MEMBER_STALE = 75000;
  const VOICE_EVERY = 5000;
  const VOICE_STALE = 14000;
  const SUB_TIMEOUT = 4500;
  const SUB_TRIES = 3;
  const HOST_CAP = 100000;
  const MEMBER_CAP = 20000;
  const SKEW = 5 * 60 * 1000;
  const CHUNK_BYTES = 38000;
  const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const SS = () => window.TSServerState;
  const C = () => window.TSCrypto;
  const S = () => window.TSSpaceStore;
  const me = () => window.state && window.state.friendId;
  const tr = (k, v) => window.TSUI.tr(k, v);
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const subtle = window.crypto.subtle;
  const te = new TextEncoder();

  const servers = new Map();    // sid -> runtime
  const byTopic = new Map();    // T -> sid
  const invTopics = new Map();  // davet konusu -> { sid, code, key }
  const replyWaiters = new Map(); // davet yanıt konusu -> fn(message)
  let dirCollector = null;
  let started = false;
  let startPromise = null;
  let timers = [];

  const client = () => {
    const c = window.state && window.state.globalMqtt;
    return c && c.connected ? c : null;
  };
  const validFid = f => typeof f === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(f);
  const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const randHex = n => hex(window.crypto.getRandomValues(new Uint8Array(n)));

  async function sha256hex(text) {
    return hex(await subtle.digest('SHA-256', te.encode(text)));
  }

  // ---------- davet kodu türetimi (yavaş: kaba kuvvete karşı) ----------
  const inviteCache = new Map();
  function inviteMaterial(code) {
    if (inviteCache.has(code)) return inviteCache.get(code);
    const p = (async () => {
      const base = await subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
      const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('teamsync-invite-v1'), iterations: 60000 }, base, 384));
      const key = await subtle.importKey('raw', bits.slice(16, 48), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      return { topic: `teamsync/inv/${hex(bits.slice(0, 16))}`, key };
    })();
    inviteCache.set(code, p);
    return p;
  }

  function newInviteCode() {
    const bytes = window.crypto.getRandomValues(new Uint8Array(10));
    return Array.from(bytes).map(b => INVITE_ALPHABET[b % 32]).join('');
  }

  // "teamsync://invite/ABCDE23456", "ABCDE-23456" ya da çıplak kod
  function parseInvite(text) {
    const m = String(text || '').toUpperCase().match(/(?:TEAMSYNC:\/\/INVITE\/)?\b([A-HJ-NP-Z2-9]{5})-?([A-HJ-NP-Z2-9]{5})\b/);
    return m ? m[1] + m[2] : null;
  }
  const inviteLink = code => `teamsync://invite/${code}`;

  // ---------- çalışma zamanı ----------
  function topics(rt) {
    return {
      ev: `teamsync/s/${rt.T}/ev`,
      sub: `teamsync/s/${rt.T}/sub`,
      eph: `teamsync/s/${rt.T}/eph`,
      to: `teamsync/s/${rt.T}/to/${rt.toMine}`
    };
  }

  async function toTopicOf(rt, fid) {
    const cacheKey = `${rt.rec.epoch}|${fid}`;
    if (!rt.toCache.has(cacheKey)) rt.toCache.set(cacheKey, `teamsync/s/${rt.T}/to/${(await C().hmacHex(rt.rec.key, `to|${fid}`)).slice(0, 16)}`);
    return rt.toCache.get(cacheKey);
  }

  // ---------- ikili (üye ↔ üye) şifreleme ----------
  // Özel kanal trafiği ve tek kişiye giden yanıtlar sunucu anahtarıyla değil,
  // iki üyenin kimlik ECDH anahtarlarından türetilen ortak anahtarla şifrelenir:
  // sunucu anahtarını bilen diğer üyeler (ya da değiştirilmiş bir istemci)
  // göremedikleri kanalın mesajlarını okuyamaz.
  const pairCache = new Map();
  function peerEk(rt, fid) {
    const m = rt.st && (rt.st.members[fid] || rt.st.former[fid]);
    // Yeni katılan: kontrol günlüğü gelmeden önce, davet yanıtındaki barındırıcı anahtarı
    return (m && m.ek) || (rt.bootKeys && rt.bootKeys[fid]) || null;
  }
  function pairKey(rt, fid) {
    const ek = peerEk(rt, fid);
    if (!ek) return Promise.reject(new Error('no-peer-key'));
    const cacheKey = `${rt.rec.gid}|${fid}|${ek}`;
    if (!pairCache.has(cacheKey)) {
      pairCache.set(cacheKey, (async () => {
        const id = await C().ensureIdentity();
        const pub = await subtle.importKey('spki', C().unb64(ek), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
        const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, id.dh.privateKey, 256);
        const base = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        const pair = [me(), fid].sort().join('|');
        return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(`srv-pair|${rt.rec.gid}`), info: te.encode(pair) },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      })().catch(e => { pairCache.delete(cacheKey); throw e; }));
    }
    return pairCache.get(cacheKey);
  }
  async function boxFor(rt, fid, inner) {
    const { iv, ct } = await C().encrypt(await pairKey(rt, fid), JSON.stringify(inner));
    return { from: me(), iv, ct };
  }
  async function unbox(rt, m) {
    if (!validFid(m.from) || typeof m.iv !== 'string' || typeof m.ct !== 'string') return null;
    try { return JSON.parse(await C().decrypt(await pairKey(rt, m.from), m.iv, m.ct)); } catch (e) { return null; }
  }
  // Tek bir üyeye (onun /to/ konusuna) ikili şifreli gönderim
  async function sendTo(rt, fid, inner) {
    return pub(rt, await toTopicOf(rt, fid), { k: 'box', ...(await boxFor(rt, fid, inner)) }, 1);
  }

  // Bir kanal herkese açık değilse (en az bir üye göremiyorsa) "kısıtlı"dır.
  function canView(st, fid, ch) {
    return SS().has(SS().channelPerms(st, fid, ch), SS().P.VIEW_CHANNEL);
  }
  function restricted(st, ch) {
    if (!st || !st.channels[ch]) return false;
    return Object.keys(st.members).some(fid => !canView(st, fid, ch));
  }

  const isHost = rt => !!(rt && rt.st && rt.st.hosts.includes(me()));
  const isMemberRt = rt => !!(rt && rt.st && rt.st.members[me()]);

  function onlineHosts(rt) {
    if (!rt.st) return [];
    const now = Date.now();
    const list = rt.st.hosts.filter(h => h === me() ? isHost(rt) : (rt.hostsSeen.get(h) && now - rt.hostsSeen.get(h).at < HOST_STALE));
    return list.sort((a, b) => (a === rt.st.owner ? -1 : b === rt.st.owner ? 1 : (a < b ? -1 : 1)));
  }
  const isOnline = rt => onlineHosts(rt).length > 0;
  function hostRank(rt) {
    const i = onlineHosts(rt).indexOf(me());
    return i < 0 ? 99 : i;
  }
  // İstek gönderilecek barındırıcı (kendim değil): sahip önce
  function pickHost(rt) {
    return onlineHosts(rt).find(h => h !== me()) || null;
  }

  async function activate(rec) {
    const old = servers.get(rec.gid);
    if (old) { unsubscribe(old); byTopic.delete(old.T); }
    const key = await C().aesKey(rec.key);
    const T = (await C().hmacHex(rec.key, `srv:v1|${rec.gid}|${rec.epoch}`)).slice(0, 24);
    const toMine = (await C().hmacHex(rec.key, `to|${me()}`)).slice(0, 16);
    let rt = old;
    if (rt) Object.assign(rt, { rec, key, T, toMine, subscribedHost: false });
    else {
      rt = {
        rec, key, T, toMine, st: null, ctl: [], ctlIds: new Set(), orphans: [], msgOrphans: [], dirAt: 0,
        hostsSeen: new Map(), membersSeen: new Map(), voice: new Map(), myVoice: null,
        pending: new Map(), lastMsgAt: new Map(), toCache: new Map(), histLoaded: new Map(),
        count: 0, last: 0, ctlSyncAt: 0, ctlSyncFail: 0, hostSyncAt: 0, keyReqAt: 0, presenceTimer: null,
        subscribedHost: false, invSubs: new Map()
      };
      servers.set(rec.gid, rt);
      rt.ctl = await S().controlOf(rec.gid).catch(() => []);
      rt.ctl.forEach(r => rt.ctlIds.add(r.id));
      const newest = await S().eventsOf(rec.gid, { newest: true, limit: 1 }).catch(() => []);
      rt.last = newest.length ? newest[0].ts : 0;
      rt.count = await S().countOf(rec.gid).catch(() => 0);
      rederive(rt, [], 'load');
    }
    byTopic.set(T, rec.gid);
    subscribe(rt);
    return rt;
  }

  function subscribe(rt) {
    const c = client();
    if (!c) return;
    const t = topics(rt);
    c.subscribe(t.ev, { qos: 1 });
    c.subscribe(t.eph, { qos: 0 });
    c.subscribe(t.to, { qos: 1 });
    rt.subscribedHost = false;
    syncHostRole(rt);
    setTimeout(() => sendEph(rt, { k: 'probe' }), 300 + Math.random() * 700);
  }

  function unsubscribe(rt) {
    const c = client();
    if (!c) return;
    const t = topics(rt);
    try { c.unsubscribe([t.ev, t.eph, t.to, t.sub]); } catch (e) {}
    rt.invSubs.forEach((p, topic) => { try { c.unsubscribe(topic); } catch (e) {} invTopics.delete(topic); });
    rt.invSubs.clear();
    rt.subscribedHost = false;
  }

  // Barındırıcı olunca /sub ve davet konularına abone ol, bırakınca çık.
  function syncHostRole(rt) {
    const c = client();
    if (!c) return;
    const host = isHost(rt);
    if (host && !rt.subscribedHost) {
      c.subscribe(topics(rt).sub, { qos: 1 });
      rt.subscribedHost = true;
      setTimeout(() => sendHostHb(rt), 200);
    } else if (!host && rt.subscribedHost) {
      try { c.unsubscribe(topics(rt).sub); } catch (e) {}
      rt.subscribedHost = false;
    }
    refreshInviteSubs(rt).catch(() => {});
  }

  async function refreshInviteSubs(rt) {
    const c = client();
    if (!c) return;
    const want = new Set();
    const waits = [];
    if (isHost(rt) && rt.st) {
      for (const inv of SS().liveInvites(rt.st, Date.now())) {
        const mat = await inviteMaterial(inv.code);
        want.add(mat.topic);
        invTopics.set(mat.topic, { sid: rt.rec.gid, code: inv.code, key: mat.key });
        // Abonelik onayı beklenir (aynı anda çalışan iki tazeleme de aynı sözü
        // bekler): davet oluşturulur oluşturulmaz gelen istek kaybolmasın.
        if (!rt.invSubs.has(mat.topic)) {
          rt.invSubs.set(mat.topic, new Promise(resolve => {
            c.subscribe(mat.topic, { qos: 1 }, () => resolve());
            setTimeout(resolve, 5000);
          }));
        }
        waits.push(rt.invSubs.get(mat.topic));
      }
    }
    await Promise.all(waits);
    rt.invSubs.forEach((p, topic) => {
      if (want.has(topic)) return;
      try { c.unsubscribe(topic); } catch (e) {}
      rt.invSubs.delete(topic);
      invTopics.delete(topic);
    });
  }

  async function saveRec(rt) { await S().putSpace(rt.rec); }

  // ---------- şifreli yayın ----------
  async function seal(rt, inner) {
    const { iv, ct } = await C().encrypt(rt.key, JSON.stringify(inner));
    return JSON.stringify({ v: 1, e: rt.rec.epoch, iv, ct });
  }
  async function pub(rt, topic, inner, qos = 0) {
    const c = client();
    if (!c) return false;
    const body = await seal(rt, inner);
    if (body.length > 62000) return false;
    c.publish(topic, body, { qos });
    return true;
  }
  const sendEph = (rt, inner) => pub(rt, topics(rt).eph, { ...inner, fid: me() }, 0).catch(() => false);

  // Olay listesini ~38 KB'lık parçalara bölüp tek bir üyeye sırayla gönderir.
  async function sendChunks(rt, fid, k, events, extra = {}) {
    if (!events.length) { await sendTo(rt, fid, { k, events: [], done: true, ...extra }); return; }
    let chunk = [];
    let size = 0;
    const flush = async done => {
      await sendTo(rt, fid, { k, events: chunk, done, ...extra });
      chunk = [];
      size = 0;
      if (!done) await sleep(60);
    };
    for (let i = 0; i < events.length; i++) {
      const len = JSON.stringify(events[i]).length;
      if (len > CHUNK_BYTES) continue;
      if (size + len > CHUNK_BYTES && chunk.length) await flush(false);
      chunk.push(events[i]);
      size += len;
    }
    await flush(true);
  }

  // ---------- doğrulama ----------
  function validShape(r) {
    return r && typeof r === 'object' && typeof r.id === 'string' && r.id.length <= 64
      && typeof r.gid === 'string' && validFid(r.author) && typeof r.type === 'string' && r.type.length <= 32
      && Number.isFinite(r.ts) && typeof r.sig === 'string' && r.sig.length < 200 && r.body && typeof r.body === 'object'
      && (r.ch === undefined || (typeof r.ch === 'string' && r.ch.length <= 40));
  }

  async function verifyAny(keys, obj, sig) {
    for (const k of keys || []) {
      if (k && await C().verify(k, obj, sig)) return true;
    }
    return false;
  }

  // true: geçerli · false: geçersiz · 'later': henüz tanınmayan yazar/barındırıcı
  async function verifyRecord(rt, r, st) {
    const acc = r.acc;
    if (!acc || !validFid(acc.h) || typeof acc.hs !== 'string' || !Number.isFinite(acc.at)) return false;
    let authorKeys;
    if (r.type === 'srv.create') {
      if (r.id !== rt.rec.genesis) return false;
      authorKeys = [r.body.member && r.body.member.ik];
    } else if (r.type === 'member.join') {
      authorKeys = [r.body.ik];
    } else {
      if (!st) return 'later';
      authorKeys = st.keys[r.author];
      if (!authorKeys) return 'later';
    }
    const { sig, acc: _acc, ...ev } = r;
    if (!(await verifyAny(authorKeys, ev, sig))) return false;
    let hostKeys;
    if (r.type === 'srv.create') hostKeys = acc.h === r.author ? authorKeys : null;
    else {
      if (!st || !st.everHosts.includes(acc.h)) return 'later';
      hostKeys = st.keys[acc.h];
    }
    if (!hostKeys) return 'later';
    return verifyAny(hostKeys, { id: r.id, a: sig, h: acc.h, at: acc.at }, acc.hs);
  }

  // ---------- olayları alma ----------
  async function ingest(rt, records, source) {
    const now = Date.now();
    const list = (records || []).filter(validShape).filter(r => r.gid === rt.rec.gid && r.ts <= now + SKEW);
    const ctlNew = list.filter(r => SS().isControl(r.type) && !rt.ctlIds.has(r.id));
    const msgNew = list.filter(r => SS().isMessage(r.type));
    // Onayı beklenen kendi gönderimlerim (tekrar gelse bile) çözülsün
    list.forEach(r => { if (rt.ctlIds.has(r.id)) resolvePending(rt, r.id, r); });
    const ctlAdded = ctlNew.length ? await ingestControl(rt, ctlNew, source) : [];
    const msgAdded = msgNew.length ? await ingestMessages(rt, msgNew, source) : [];
    ctlAdded.forEach(r => resolvePending(rt, r.id, r));
    return ctlAdded.concat(msgAdded);
  }

  async function ingestControl(rt, cands, source) {
    const now = Date.now();
    const seen = new Set();
    let pending = cands.concat(rt.orphans.filter(o => now - o.at < 10 * 60 * 1000).map(o => o.r))
      .filter(r => { if (seen.has(r.id) || rt.ctlIds.has(r.id)) return false; seen.add(r.id); return true; });
    rt.orphans = [];
    const accepted = [];
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      const st = accepted.length ? SS().derive(rt.ctl.concat(accepted), { genesis: rt.rec.genesis }) : rt.st;
      const next = [];
      for (const r of pending) {
        const ok = source === 'local' ? true : await verifyRecord(rt, r, st);
        if (ok === true) { accepted.push(r); progress = true; } else if (ok === 'later') next.push(r);
      }
      pending = next;
    }
    pending.forEach(r => rt.orphans.push({ r, at: now }));
    if (!accepted.length) return [];
    const added = await S().addControl(accepted);
    added.forEach(r => { rt.ctl.push(r); rt.ctlIds.add(r.id); });
    if (added.length) rederive(rt, added, source);
    if (added.length && rt.msgOrphans.length) {
      const retry = rt.msgOrphans.splice(0);
      setTimeout(() => ingestMessages(rt, retry, 'live').catch(() => {}), 0);
    }
    return added;
  }

  async function ingestMessages(rt, recs, source) {
    const st = rt.st;
    if (!st) { requestCtl(rt); return []; }
    const accepted = [];
    let needCtl = false;
    const host = isHost(rt);
    for (const r of recs.sort((a, b) => a.ts - b.ts)) {
      if (!r.ch) continue;
      // Göremediğim kanalın olayını saklamam (barındırıcılar her şeyi tutar)
      if (!host && st.channels[r.ch] && !canView(st, me(), r.ch)) continue;
      if (await S().hasEvent(r.id)) { resolvePending(rt, r.id, r); continue; }
      if (source !== 'local') {
        const v = await verifyRecord(rt, r, st);
        if (v !== true) {
          // Yazarı henüz tanımıyorum (katılma olayı gelmedi): kontrol eşitlemesinden sonra yeniden dene
          if (v === 'later') { needCtl = true; if (rt.msgOrphans.length < 200) rt.msgOrphans.push(r); }
          continue;
        }
        if (source === 'live') {
          // Canlı olaylarda yetkiyi de denetle (geçmişte yetki farklı olabilir)
          const target = r.type === 'msg' ? null : await S().getEvent(r.body.target);
          const chk = SS().checkMessage(st, r, { target: target || undefined });
          if (!chk.ok && !(chk.reason === 'target' || (chk.reason === 'perm' && !target && r.type !== 'react'))) continue;
        }
      }
      accepted.push(r);
    }
    if (needCtl) requestCtl(rt);
    if (!accepted.length) return [];
    const added = await S().addEvents(accepted);
    const viewing = window.TSServerUI ? window.TSServerUI.viewingChannel(rt.rec.gid) : null;
    let unreadChanged = false;
    added.forEach(r => {
      if (r.ts > rt.last) rt.last = r.ts;
      rt.count++;
      if (r.type === 'msg') {
        const key = `${r.ch}|${r.author}`;
        if (!rt.lastMsgAt.has(key) || rt.lastMsgAt.get(key) < r.ts) rt.lastMsgAt.set(key, r.ts);
        if (r.author !== me() && source !== 'sync-old') {
          if (window.TSTyping) window.TSTyping.remoteStopped(`srv:${rt.rec.gid}:${r.ch}`, r.author);
          const joinedAt = (st.members[me()] || {}).joinedAt || 0;
          const unseen = r.ts > (rt.rec.readAt && rt.rec.readAt[r.ch] || joinedAt);
          if (unseen && viewing !== r.ch) {
            rt.rec.unread = rt.rec.unread || {};
            rt.rec.unread[r.ch] = (rt.rec.unread[r.ch] || 0) + 1;
            if (mentionsMe(rt, r)) {
              rt.rec.mentions = rt.rec.mentions || {};
              rt.rec.mentions[r.ch] = (rt.rec.mentions[r.ch] || 0) + 1;
              if (source === 'live' && !(window.TSStatus && window.TSStatus.isDnd())) {
                const ch = st.channels[r.ch];
                window.showToast(`${memberName(rt, r.author)} → ${st.name} #${ch ? ch.name : ''}: ${String(r.body.text).slice(0, 80)}`, 'info');
              }
            }
            unreadChanged = true;
          }
        }
      }
      resolvePending(rt, r.id, r);
    });
    if (unreadChanged || added.length) saveRec(rt).catch(() => {});
    if (rt.count > (isHost(rt) ? HOST_CAP : MEMBER_CAP) + 500) {
      S().prune(rt.rec.gid).then(n => { rt.count -= n || 0; }).catch(() => {});
    }
    emit('ts:server', { sid: rt.rec.gid, added, chs: Array.from(new Set(added.map(r => r.ch))) });
    return added;
  }

  // @ad ile anılma; @everyone / @herkes yalnızca sunucuyu yönetebilenlerden.
  function mentionsMe(rt, r) {
    const name = window.state && window.state.myName;
    const text = r.body && r.body.text;
    if (!name || typeof text !== 'string') return false;
    const low = text.toLocaleLowerCase('tr');
    if (low.includes(`@${name.toLocaleLowerCase('tr')}`)) return true;
    const canPingAll = rt.st && SS().has(SS().basePerms(rt.st, r.author), SS().P.MANAGE_SERVER);
    return canPingAll && (low.includes('@everyone') || low.includes('@herkes'));
  }

  // Kontrol günlüğünden durumu yeniden kurar ve sonuçlarını uygular.
  function rederive(rt, added, source) {
    const prevHost = isHost(rt);
    rt.st = SS().derive(rt.ctl, { genesis: rt.rec.genesis });
    const st = rt.st;
    if (st) {
      rt.rec.name = st.name;
      rt.rec.icon = st.icon;
      rt.rec.owner = st.owner;
      rt.rec.cn = rt.ctl.length;
      if (source !== 'load') saveRec(rt).catch(() => {});
      if (st.deleted) { removeLocal(rt, 'deleted'); return; }
      // Atılma/yasak yalnızca yeni gelen bir olayla anlaşılır: parça parça gelen
      // bir eşitlemenin yarısında (atıldım → yeniden katıldım) yanlış silme olmasın.
      const mine = st.former[me()];
      const fresh = source === 'live' || source === 'local';
      if (fresh && !st.members[me()] && mine && mine.leftAt >= (rt.rec.joinedAt || 0) - SKEW && mine.reason !== 'leave') {
        removeLocal(rt, mine.reason);
        return;
      }
      if (st.hostOffers.includes(me()) && source !== 'load') emit('ts:server-host-offer', { sid: rt.rec.gid });
    }
    if (prevHost !== isHost(rt) || isHost(rt)) syncHostRole(rt);
    if (!prevHost && isHost(rt) && source !== 'load') {
      // Yeni barındırıcı: tüm geçmişi diğer barındırıcılardan çek
      setTimeout(() => requestHostSync(rt, 0), 1500);
    }
    if (isHost(rt) && source !== 'load') scheduleDirectory(rt);
    emit('ts:server', { sid: rt.rec.gid, ctl: true, added });
  }

  // ---------- gönderim (üye → barındırıcı) ----------
  async function submit(sid, type, body, ch) {
    const rt = servers.get(sid);
    if (!rt || !rt.st) throw new Error('no-server');
    if (!isOnline(rt)) throw Object.assign(new Error('offline'), { reason: 'offline' });
    await C().ensureIdentity();
    const ev = { id: crypto.randomUUID(), gid: sid, author: me(), type, body, ts: Date.now() };
    if (ch) ev.ch = ch;
    const sig = await C().sign(ev);
    const r = { ...ev, sig };
    if (isHost(rt)) {
      const res = await hostAccept(rt, r, 'self');
      if (!res.ok) throw Object.assign(new Error(res.reason), res);
      return res.rec;
    }
    return new Promise((resolve, reject) => {
      const p = { r, tries: 0, resolve, reject, ch, timer: null };
      rt.pending.set(r.id, p);
      const attempt = () => {
        if (!rt.pending.has(r.id)) return;
        if (p.tries >= SUB_TRIES) {
          rt.pending.delete(r.id);
          emit('ts:server', { sid, pending: true, chs: [ch] });
          reject(Object.assign(new Error('timeout'), { reason: 'timeout' }));
          return;
        }
        p.tries += 1;
        if (r.ch && restricted(rt.st, r.ch)) {
          // Kısıtlı kanal: her çevrimiçi barındırıcıya ayrı ayrı, ikili şifreli
          onlineHosts(rt).filter(h => h !== me()).forEach(h => {
            boxFor(rt, h, r).then(box => pub(rt, topics(rt).sub, { k: 'psub', to: h, ...box }, 1)).catch(() => {});
          });
        } else {
          pub(rt, topics(rt).sub, { k: 'sub', r }, 1).catch(() => {});
        }
        p.timer = setTimeout(attempt, SUB_TIMEOUT);
      };
      attempt();
      emit('ts:server', { sid, pending: true, chs: [ch] });
    });
  }

  function resolvePending(rt, id, rec) {
    const p = rt.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    rt.pending.delete(id);
    p.resolve(rec);
  }

  function pendingFor(sid, ch) {
    const rt = servers.get(sid);
    if (!rt) return [];
    return Array.from(rt.pending.values()).filter(p => p.ch === ch && p.r.type === 'msg').map(p => p.r);
  }

  // ---------- barındırıcı: onay ----------
  async function lastMsgTime(rt, ch, fid) {
    const key = `${ch}|${fid}`;
    if (rt.lastMsgAt.has(key)) return rt.lastMsgAt.get(key);
    const recent = await S().channelEvents(rt.rec.gid, ch, { newest: true, limit: 200 }).catch(() => []);
    const mine = recent.filter(e => e.type === 'msg' && e.author === fid).pop();
    const at = mine ? mine.ts : 0;
    rt.lastMsgAt.set(key, at);
    return at;
  }

  async function hostAccept(rt, r, source) {
    if (!isHost(rt) || !validShape(r) || r.gid !== rt.rec.gid) return { ok: false, reason: 'shape' };
    const now = Date.now();
    if (Math.abs(r.ts - now) > SKEW) return { ok: false, reason: 'clock' };
    const isCtl = SS().isControl(r.type);
    if (!isCtl && !SS().isMessage(r.type)) return { ok: false, reason: 'type' };
    const existing = isCtl ? rt.ctl.find(x => x.id === r.id) : await S().getEvent(r.id);
    if (existing) {
      if (source === 'sub') {
        if (existing.ch && restricted(rt.st, existing.ch)) sendTo(rt, existing.author, { k: 'pev', r: existing }).catch(() => {});
        else pub(rt, topics(rt).ev, { k: 'ev', r: existing }, 1).catch(() => {});
      }
      return { ok: true, rec: existing };
    }
    if (source !== 'self') {
      const keys = r.type === 'member.join' ? [r.body.ik] : (rt.st.keys[r.author] || []);
      const { sig, acc, ...ev } = r;
      if (!(await verifyAny(keys, ev, sig))) return { ok: false, reason: 'sig' };
    }
    if (isCtl) {
      if (r.type === 'srv.create') return { ok: false, reason: 'type' };
      const trial = SS().derive(rt.ctl.concat([{ ...r, acc: { h: me(), at: now } }]), { genesis: rt.rec.genesis });
      if (!trial || trial.rejected.includes(r.id)) {
        const reason = r.type === 'member.join' ? (rt.st.bans[r.author] ? 'banned' : (SS().inviteUsable(rt.st, r.body.inv, now) ? 'perm' : 'invite')) : 'perm';
        return { ok: false, reason };
      }
    } else {
      if (!r.ch) return { ok: false, reason: 'shape' };
      const target = r.type === 'msg' ? null : await S().getEvent(r.body && r.body.target);
      const lastAt = r.type === 'msg' ? await lastMsgTime(rt, r.ch, r.author) : 0;
      const chk = SS().checkMessage(rt.st, r, { now, lastMsgAt: lastAt, target: target || undefined });
      if (!chk.ok) return chk;
    }
    // Birden çok barındırıcı çevrimiçiyse sıradaki beklesin; ilk onaylayan yayınlar.
    if (source === 'sub' || source === 'invite') {
      const rank = hostRank(rt);
      if (rank > 0) {
        await sleep(Math.min(rank, 4) * 700);
        const done = isCtl ? rt.ctl.find(x => x.id === r.id) : await S().getEvent(r.id);
        if (done) return { ok: true, rec: done };
      }
    }
    const acc = { h: me(), at: now };
    acc.hs = await C().sign({ id: r.id, a: r.sig, h: acc.h, at: acc.at });
    const rec = { ...r, acc };
    await ingest(rt, [rec], 'local');
    if (rec.ch && restricted(rt.st, rec.ch)) await deliverPrivate(rt, rec);
    else await pub(rt, topics(rt).ev, { k: 'ev', r: rec }, 1);
    if (r.type === 'member.kick' || r.type === 'ban.add') scheduleRotate(rt);
    return { ok: true, rec };
  }

  // Kısıtlı kanal olayı: yalnızca görebilen (ve barındırıcı) çevrimiçi üyelere
  // tek tek, ikili şifreli. Çevrimdışı olanlar kanalı açınca geçmişten alır.
  async function deliverPrivate(rt, rec) {
    const now = Date.now();
    const to = new Set([rec.author]);
    onlineHosts(rt).forEach(h => to.add(h));
    rt.membersSeen.forEach((v, fid) => { if (now - v.at < MEMBER_STALE) to.add(fid); });
    to.delete(me());
    for (const fid of to) {
      if (!rt.st.members[fid]) continue;
      if (!rt.st.hosts.includes(fid) && !canView(rt.st, fid, rec.ch)) continue;
      await sendTo(rt, fid, { k: 'pev', r: rec }).catch(() => {});
    }
  }

  async function onSubmission(rt, r) {
    const res = await hostAccept(rt, r, 'sub');
    if (!res.ok && validFid(r.author) && res.reason !== 'shape' && hostRank(rt) === 0) {
      sendTo(rt, r.author, { k: 'rej', id: r.id, reason: res.reason, wait: res.wait || 0 }).catch(() => {});
    }
  }

  // ---------- gelen MQTT ----------
  async function onMqtt(topic, message) {
    if (topic.startsWith('teamsync/inv/')) return onInvite(topic, message);
    if (topic.startsWith('teamsync/dir/')) return onDir(topic, message);
    const parts = topic.split('/');
    const sid = byTopic.get(parts[2]);
    if (!sid) return;
    const rt = servers.get(sid);
    if (!rt) return;
    let inner;
    try {
      const env = JSON.parse(message.toString());
      if (!env || env.v !== 1 || env.e !== rt.rec.epoch) return;
      inner = JSON.parse(await C().decrypt(rt.key, env.iv, env.ct));
    } catch (e) { return; }
    if (!inner || typeof inner !== 'object') return;
    const kind = parts[3];
    if (kind === 'ev' && inner.k === 'ev') await ingest(rt, [inner.r], 'live');
    else if (kind === 'sub' && inner.k === 'sub' && isHost(rt)) await onSubmission(rt, inner.r);
    else if (kind === 'sub' && inner.k === 'psub' && inner.to === me() && isHost(rt)) {
      const r = await unbox(rt, inner);
      if (r && r.author === inner.from) await onSubmission(rt, r);
    }
    else if (kind === 'eph') onEph(rt, inner);
    else if (kind === 'to') await onDirect(rt, inner);
  }

  function notePresence(rt) {
    if (rt.presenceTimer) return;
    rt.presenceTimer = setTimeout(() => {
      rt.presenceTimer = null;
      emit('ts:server-presence', { sid: rt.rec.gid });
    }, 800);
  }

  function onEph(rt, m) {
    const fid = m.fid;
    if (!validFid(fid) || fid === me()) return;
    // Kontrol günlüğü henüz yok (yeni katıldım): ilk kalp atan barındırıcıdan iste
    if (!rt.st) { if (m.k === 'hhb' && peerEk(rt, fid)) requestCtl(rt, fid); return; }
    if (!rt.st.members[fid]) { if (m.k === 'hhb') requestCtl(rt); return; }
    const now = Date.now();
    const prev = rt.membersSeen.get(fid);
    const av = window.TSProfile && typeof m.av === 'string' ? window.TSProfile._safeMedia(m.av) : '';
    rt.membersSeen.set(fid, { at: now, hid: !!m.hid, st: ['online', 'idle', 'dnd'].includes(m.st) ? m.st : 'online', av: av || (prev && prev.av) || '' });
    if (!prev || now - prev.at > MEMBER_STALE) notePresence(rt);
    switch (m.k) {
      case 'hhb':
        if (!rt.st.hosts.includes(fid)) return;
        {
          const was = rt.hostsSeen.get(fid);
          rt.hostsSeen.set(fid, { at: now, cn: Number(m.cn) || 0, clast: Number(m.clast) || 0, n: Number(m.n) || 0, last: Number(m.last) || 0 });
          if (!was || now - was.at > HOST_STALE) { notePresence(rt); emit('ts:server', { sid: rt.rec.gid, online: true }); }
          if ((Number(m.cn) || 0) > rt.ctl.length || (Number(m.clast) || 0) > (rt.st.last || 0)) requestCtl(rt, fid);
          if (isHost(rt)) {
            const theirN = Number(m.n) || 0;
            const theirLast = Number(m.last) || 0;
            if (theirN > rt.count + 2 || theirLast > rt.last + 2000) requestHostSync(rt, theirN - rt.count > 200 || !rt.last ? 0 : rt.last - 30 * 60 * 1000, fid);
          }
        }
        break;
      case 'probe':
        if (isHost(rt)) setTimeout(() => sendHostHb(rt), 100 + Math.random() * 800);
        else setTimeout(() => sendMemberHb(rt), 300 + Math.random() * 2500);
        break;
      case 'creq':
        if (m.to === me() && isHost(rt)) serveCtl(rt, fid).catch(() => {});
        break;
      case 'hreq':
        if (m.to === me() && isHost(rt)) serveHistory(rt, fid, m).catch(() => {});
        break;
      case 'hsreq':
        if (m.to === me() && isHost(rt) && rt.st.hosts.includes(fid)) serveHostSync(rt, fid, Number(m.since) || 0).catch(() => {});
        break;
      case 'typing':
        if (typeof m.ch === 'string' && window.TSTyping) window.TSTyping.remoteTyping(`srv:${rt.rec.gid}:${m.ch}`, fid, memberName(rt, fid), m.tv);
        break;
      case 'vc':
        onVoiceBeacon(rt, fid, m);
        break;
      case 'vcl':
        if (typeof m.ch === 'string' && rt.voice.get(m.ch)) { rt.voice.get(m.ch).delete(fid); emit('ts:server-voice', { sid: rt.rec.gid }); }
        break;
      case 'rekey':
        if (Number(m.epoch) > rt.rec.epoch && rt.st.hosts.includes(fid)) requestKey(rt, true);
        break;
      default:
        break;
    }
  }

  async function onDirect(rt, outer) {
    // /to/ trafiği her zaman ikili şifrelidir (gönderen + ben)
    if (outer.k !== 'box') return;
    const m = await unbox(rt, outer);
    if (!m || typeof m !== 'object') return;
    if (m.k === 'pev' && m.r) {
      await ingest(rt, [m.r], 'live');
      return;
    }
    if (m.k === 'cres' && Array.isArray(m.events)) {
      const before = rt.ctl.length;
      await ingest(rt, m.events.slice(0, 400), 'sync');
      if (m.done) {
        rt.ctlSyncFail = rt.ctl.length === before ? rt.ctlSyncFail + 1 : 0;
        emit('ts:server', { sid: rt.rec.gid, synced: true });
      }
    } else if ((m.k === 'hres' || m.k === 'hsres') && Array.isArray(m.events)) {
      await ingest(rt, m.events.slice(0, 400), 'sync');
      if (m.k === 'hres' && m.done && typeof m.ch === 'string') {
        rt.histLoaded.set(m.ch, { at: Date.now(), more: !!m.more });
        const w = rt.histWaiters && rt.histWaiters.get(m.rid);
        if (w) { rt.histWaiters.delete(m.rid); w(!!m.more); }
        emit('ts:server-history', { sid: rt.rec.gid, ch: m.ch, more: !!m.more });
      }
    } else if (m.k === 'rej' && typeof m.id === 'string') {
      const p = rt.pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        rt.pending.delete(m.id);
        p.reject(Object.assign(new Error(m.reason || 'rejected'), { reason: m.reason, wait: Number(m.wait) || 0 }));
        emit('ts:server', { sid: rt.rec.gid, pending: true, chs: [p.ch] });
      }
    }
  }

  // ---------- kalp atışı + eşitleme ----------
  function myPresenceBits() {
    const st = window.TSStatus ? window.TSStatus.effective() : 'online';
    const av = window.TSProfile && window.state.myAvatar ? window.TSProfile._safeMedia(window.state.myAvatar) : '';
    return { st: st === 'invisible' ? undefined : st, av: av || undefined };
  }
  function sendHostHb(rt) {
    if (!isHost(rt)) return null;
    return sendEph(rt, { k: 'hhb', cn: rt.ctl.length, clast: rt.st ? rt.st.last : 0, n: rt.count, last: rt.last, ...myPresenceBits() });
  }
  function sendMemberHb(rt) {
    if (isHost(rt)) return sendHostHb(rt);
    // Görünmez: çevrimiçi gösterilmem ama özel kanal mesajları bana ulaşsın
    if (window.TSStatus && window.TSStatus.isInvisible()) return sendEph(rt, { k: 'hb', hid: 1 });
    return sendEph(rt, { k: 'hb', ...myPresenceBits() });
  }

  function requestCtl(rt, hostFid) {
    const now = Date.now();
    const backoff = rt.ctlSyncFail > 2 ? 5 * 60 * 1000 : 15000;
    if (now - rt.ctlSyncAt < backoff) return;
    const to = hostFid || pickHost(rt);
    if (!to || to === me()) return;
    rt.ctlSyncAt = now;
    sendEph(rt, { k: 'creq', to });
  }

  function requestHostSync(rt, since, hostFid) {
    const now = Date.now();
    if (now - rt.hostSyncAt < 30000) return;
    const to = hostFid || pickHost(rt);
    if (!to || to === me()) return;
    rt.hostSyncAt = now;
    sendEph(rt, { k: 'hsreq', to, since });
  }

  async function serveCtl(rt, toFid) {
    if (!rt.st.members[toFid]) return;
    const events = rt.ctl.slice().sort((a, b) => a.ts - b.ts);
    await sendChunks(rt, toFid, 'cres', events);
  }

  async function serveHistory(rt, toFid, m) {
    if (typeof m.ch !== 'string' || !rt.st.members[toFid]) return;
    if (!SS().has(SS().channelPerms(rt.st, toFid, m.ch), SS().P.VIEW_CHANNEL)) return;
    const limit = Math.min(Math.max(Number(m.limit) || 100, 10), 200);
    const events = await S().channelEvents(rt.rec.gid, m.ch, {
      after: Number.isFinite(m.after) ? m.after : -Infinity,
      before: Number.isFinite(m.before) ? m.before : Infinity,
      limit, newest: true
    });
    await sendChunks(rt, toFid, 'hres', events, { ch: m.ch, more: events.length >= limit, rid: m.rid });
  }

  async function serveHostSync(rt, toFid, since) {
    await serveCtl(rt, toFid);
    const events = await S().eventsOf(rt.rec.gid, { since, limit: HOST_CAP });
    await sendChunks(rt, toFid, 'hsres', events);
  }

  // Kanal açılınca eksik geçmişi bir barındırıcıdan iste.
  async function openChannel(sid, ch) {
    const rt = servers.get(sid);
    if (!rt) return;
    markRead(sid, ch);
    rt.rec.lastCh = ch;
    saveRec(rt).catch(() => {});
    if (isHost(rt)) return;
    const loaded = rt.histLoaded.get(ch);
    if (loaded && Date.now() - loaded.at < 60000) return;
    const newest = await S().channelEvents(sid, ch, { newest: true, limit: 1 }).catch(() => []);
    return requestHistory(rt, ch, newest.length ? { after: newest[0].ts - 60000, limit: 150 } : { limit: 100 });
  }

  async function loadOlder(sid, ch) {
    const rt = servers.get(sid);
    if (!rt || isHost(rt)) return false;
    const oldest = await S().channelEvents(sid, ch, { newest: false, limit: 1 }).catch(() => []);
    if (!oldest.length) return false;
    return requestHistory(rt, ch, { before: oldest[0].ts, limit: 60 });
  }

  function requestHistory(rt, ch, opts) {
    const to = pickHost(rt);
    if (!to) return Promise.resolve(false);
    const rid = randHex(6);
    rt.histWaiters = rt.histWaiters || new Map();
    return new Promise(resolve => {
      const t = setTimeout(() => { rt.histWaiters.delete(rid); resolve(false); }, 8000);
      rt.histWaiters.set(rid, more => { clearTimeout(t); resolve(more); });
      sendEph(rt, { k: 'hreq', to, ch, rid, ...opts });
    });
  }

  // ---------- anahtar yenileme ----------
  function scheduleRotate(rt) {
    clearTimeout(rt.rotateTimer);
    rt.rotateTimer = setTimeout(() => rotateKey(rt).catch(e => console.warn('Sunucu anahtarı yenilenemedi:', e && e.message)), 1500);
  }

  async function rotateKey(rt) {
    if (!isHost(rt)) return;
    const epoch = rt.rec.epoch + 1;
    await sendEph(rt, { k: 'rekey', epoch });
    await sleep(200);
    rt.rec.key = C().newGroupKey();
    rt.rec.epoch = epoch;
    rt.rec.keyFrom = me();
    await saveRec(rt);
    await activate(rt.rec);
    const now = Date.now();
    for (const [fid, info] of rt.membersSeen) {
      if (now - info.at < MEMBER_STALE && rt.st.members[fid]) { await sendKey(rt, fid); await sleep(40); }
    }
    emit('ts:server', { sid: rt.rec.gid, rekey: true });
  }

  async function sendKey(rt, fid) {
    const c = client();
    const m = rt.st && rt.st.members[fid];
    if (!c || !m || !m.ek) return;
    const wrapped = await C().wrapFor(m.ek, JSON.stringify({ key: rt.rec.key, epoch: rt.rec.epoch }), rt.rec.gid, 'srv-key');
    const payload = { type: 'srv_key', fromId: me(), sid: rt.rec.gid, epoch: rt.rec.epoch, wrapped, ts: Date.now() };
    payload.sig = await C().sign(payload);
    c.publish(`teamsync/user/${fid}/events`, JSON.stringify(payload), { qos: 1 });
  }

  // Anahtar yenilendi (ya da uzun süre barındırıcı görünmüyor): barındırıcılardan iste.
  async function requestKey(rt, urgent) {
    const c = client();
    if (!c || !rt.st || isHost(rt) && !urgent) return;
    const now = Date.now();
    if (now - rt.keyReqAt < (urgent ? 5000 : 120000)) return;
    rt.keyReqAt = now;
    const payload = { type: 'srv_kreq', fromId: me(), sid: rt.rec.gid, epoch: rt.rec.epoch, ts: now };
    payload.sig = await C().sign(payload);
    rt.st.hosts.filter(h => h !== me()).forEach(h => c.publish(`teamsync/user/${h}/events`, JSON.stringify(payload), { qos: 1 }));
  }

  const kreqSeen = new Map();
  async function onPersonalEvent(data) {
    await ensureStarted();
    if (!data || !validFid(data.fromId) || typeof data.sid !== 'string') return;
    const rt = servers.get(data.sid);
    if (!rt || !rt.st) return;
    const { sig, ...unsigned } = data;
    if (typeof sig !== 'string' || Math.abs(Date.now() - Number(data.ts)) > SKEW) return;
    if (data.type === 'srv_kreq') {
      if (!isHost(rt)) return;
      const k = `${data.sid}|${data.fromId}`;
      if (Date.now() - (kreqSeen.get(k) || 0) < 8000) return;
      kreqSeen.set(k, Date.now());
      if (!(await verifyAny(rt.st.keys[data.fromId], unsigned, sig))) return;
      if (rt.st.members[data.fromId]) {
        if (Number(data.epoch) < rt.rec.epoch) await sendKey(rt, data.fromId);
      } else if (rt.st.former[data.fromId] && rt.st.former[data.fromId].reason !== 'leave') {
        const c = client();
        if (!c) return;
        const gone = { type: 'srv_gone', fromId: me(), sid: data.sid, fid: data.fromId, reason: rt.st.former[data.fromId].reason, ts: Date.now() };
        gone.sig = await C().sign(gone);
        c.publish(`teamsync/user/${data.fromId}/events`, JSON.stringify(gone), { qos: 1 });
      }
    } else if (data.type === 'srv_key') {
      if (!rt.st.everHosts.includes(data.fromId) || !Number.isInteger(data.epoch)) return;
      const sameEpochBetter = data.epoch === rt.rec.epoch && rt.rec.keyFrom && data.fromId < rt.rec.keyFrom;
      if (data.epoch < rt.rec.epoch || (data.epoch === rt.rec.epoch && !sameEpochBetter)) return;
      if (!(await verifyAny(rt.st.keys[data.fromId], unsigned, sig))) return;
      let info;
      try { info = JSON.parse(await C().unwrap(data.wrapped, data.sid, 'srv-key')); } catch (e) { return; }
      if (!info || typeof info.key !== 'string' || info.epoch !== data.epoch) return;
      rt.rec.key = info.key;
      rt.rec.epoch = info.epoch;
      rt.rec.keyFrom = data.fromId;
      await saveRec(rt);
      await activate(rt.rec);
      emit('ts:server', { sid: data.sid, rekey: true });
    } else if (data.type === 'srv_gone') {
      if (data.fid !== me() || !rt.st.hosts.includes(data.fromId)) return;
      if (!(await verifyAny(rt.st.keys[data.fromId], unsigned, sig))) return;
      removeLocal(rt, data.reason === 'ban' ? 'ban' : 'kick');
    }
  }

  // ---------- davetler ----------
  function serverCard(rt) {
    const now = Date.now();
    const online = new Set(onlineHosts(rt));
    rt.membersSeen.forEach((v, fid) => { if (now - v.at < MEMBER_STALE && rt.st.members[fid]) online.add(fid); });
    online.add(me());
    return {
      sid: rt.rec.gid, genesis: rt.rec.genesis, owner: rt.st.owner, name: rt.st.name, icon: rt.st.icon || '',
      desc: rt.st.desc || '', members: Object.keys(rt.st.members).length, online: online.size
    };
  }

  async function onInvite(topic, message) {
    const waiter = replyWaiters.get(topic);
    if (waiter) { waiter(message); return; }
    const entry = invTopics.get(topic);
    if (!entry) return;
    const rt = servers.get(entry.sid);
    if (!rt || !isHost(rt) || !rt.st) return;
    let msg;
    try { msg = JSON.parse(message.toString()); } catch (e) { return; }
    if (!msg || typeof msg.n !== 'string' || !/^[a-f0-9]{16,32}$/.test(msg.n)) return;
    const reply = async payload => {
      const c = client();
      if (!c) return;
      const box = await C().encrypt(entry.key, JSON.stringify(payload));
      c.publish(`${topic}/r/${msg.n}`, JSON.stringify(box), { qos: 1 });
    };
    if (!SS().inviteUsable(rt.st, entry.code, Date.now())) { if (hostRank(rt) === 0) reply({ k: 'err', reason: 'invite' }); return; }
    if (msg.k === 'peek') {
      if (hostRank(rt) > 0) await sleep(hostRank(rt) * 900);
      reply({ k: 'info', ...serverCard(rt), exp: rt.st.invites[entry.code].exp });
    } else if (msg.k === 'join' && msg.box) {
      let req;
      try { req = JSON.parse(await C().decrypt(entry.key, msg.box.iv, msg.box.ct)); } catch (e) { return; }
      const ev = req && req.ev;
      if (!validShape(ev) || ev.type !== 'member.join' || ev.gid !== rt.rec.gid || ev.body.inv !== entry.code) return;
      let already = rt.st.members[ev.author];
      if (!already) {
        const res = await hostAccept(rt, ev, 'invite');
        if (!res.ok) { reply({ k: 'err', reason: res.reason }); return; }
        already = rt.st.members[ev.author];
      }
      if (!already || already.ek !== ev.body.ek) { reply({ k: 'err', reason: 'member' }); return; }
      const wrapped = await C().wrapFor(ev.body.ek, JSON.stringify({ key: rt.rec.key, epoch: rt.rec.epoch }), rt.rec.gid, 'srv-join');
      reply({ k: 'ok', ...serverCard(rt), epoch: rt.rec.epoch, wrapped, host: me(), hek: (await C().ensureIdentity()).ek });
    }
  }

  // Davet konusuna bir istek atıp tek yanıt bekler.
  async function inviteRequest(code, payload, timeoutMs = 9000) {
    const c = client();
    if (!c) throw Object.assign(new Error('offline'), { reason: 'network' });
    const mat = await inviteMaterial(code);
    const n = randHex(12);
    const replyTopic = `${mat.topic}/r/${n}`;
    return new Promise((resolve, reject) => {
      let retry = null;
      const done = (fn, v) => {
        clearTimeout(timer);
        clearInterval(retry);
        replyWaiters.delete(replyTopic);
        try { c.unsubscribe(replyTopic); } catch (e) {}
        fn(v);
      };
      const timer = setTimeout(() => done(reject, Object.assign(new Error('notfound'), { reason: 'notfound' })), timeoutMs);
      replyWaiters.set(replyTopic, async message => {
        try {
          const box = JSON.parse(message.toString());
          const res = JSON.parse(await C().decrypt(mat.key, box.iv, box.ct));
          if (res.k === 'err') done(reject, Object.assign(new Error(res.reason), { reason: res.reason }));
          else done(resolve, res);
        } catch (e) { /* başka birinin çöpü: bekle */ }
      });
      const body = JSON.stringify({ ...payload, n });
      c.subscribe(replyTopic, { qos: 1 }, () => {
        c.publish(mat.topic, body, { qos: 1 });
        // Herkese açık aracıda tek paket kaybı katılmayı düşürmesin: yinelenen
        // istek zararsızdır (barındırıcı aynı olay kimliğini tekrar onaylamaz).
        retry = setInterval(() => { if (replyWaiters.has(replyTopic)) c.publish(mat.topic, body, { qos: 1 }); }, 3000);
      });
    });
  }

  const peekCache = new Map();
  async function peekInvite(input) {
    const code = parseInvite(input);
    if (!code) throw Object.assign(new Error('notfound'), { reason: 'notfound' });
    const cached = peekCache.get(code);
    if (cached && Date.now() - cached.at < 60000) return cached.info;
    const info = await inviteRequest(code, { k: 'peek' });
    if (!info || typeof info.sid !== 'string' || typeof info.genesis !== 'string') throw Object.assign(new Error('notfound'), { reason: 'notfound' });
    peekCache.set(code, { at: Date.now(), info });
    return info;
  }

  async function joinWithInvite(input) {
    await ensureStarted();
    const code = parseInvite(input);
    if (!code) throw Object.assign(new Error('notfound'), { reason: 'notfound' });
    const id = await C().ensureIdentity();
    const info = await peekInvite(code);
    if (servers.has(info.sid) && isMemberRt(servers.get(info.sid))) return info.sid;
    const ev = {
      id: crypto.randomUUID(), gid: info.sid, author: me(), type: 'member.join',
      body: { name: SS().cleanName(window.state.myName || me(), 40), ik: id.ik, ek: id.ek, inv: code }, ts: Date.now()
    };
    const sig = await C().sign(ev);
    const mat = await inviteMaterial(code);
    const box = await C().encrypt(mat.key, JSON.stringify({ ev: { ...ev, sig } }));
    const res = await inviteRequest(code, { k: 'join', box }, 12000);
    let keyInfo;
    try { keyInfo = JSON.parse(await C().unwrap(res.wrapped, info.sid, 'srv-join')); } catch (e) { throw Object.assign(new Error('key'), { reason: 'key' }); }
    if (!keyInfo || typeof keyInfo.key !== 'string' || !Number.isInteger(keyInfo.epoch)) throw Object.assign(new Error('key'), { reason: 'key' });
    const existing = servers.get(info.sid);
    const rec = {
      gid: info.sid, kind: 'server', key: keyInfo.key, epoch: keyInfo.epoch, keyFrom: res.host,
      genesis: info.genesis, owner: info.owner, name: SS().cleanName(info.name, 60), icon: SS().validIcon(info.icon) ? info.icon : '',
      createdAt: Date.now(), joinedAt: ev.ts - 1000, unread: {}, mentions: {}, readAt: {}, lastCh: null,
      order: existing ? existing.rec.order : Date.now()
    };
    await S().putSpace(rec);
    const rt = await activate(rec);
    if (SS().validKey(res.hek)) rt.bootKeys = { [res.host]: res.hek };
    // Kontrol günlüğünü hemen iste (probe'a gelen barındırıcı kalp atışını beklemeden)
    rt.hostsSeen.set(res.host, { at: Date.now(), cn: 0, clast: 0, n: 0, last: 0 });
    rt.ctlSyncAt = 0;
    requestCtl(rt, res.host);
    emit('ts:servers', { sid: info.sid });
    return info.sid;
  }

  // ---------- herkese açık dizin ----------
  function scheduleDirectory(rt) {
    clearTimeout(rt.dirTimer);
    rt.dirTimer = setTimeout(() => publishDirectory(rt).catch(() => {}), 4000);
  }

  async function publishDirectory(rt) {
    const c = client();
    if (!c || !isHost(rt) || hostRank(rt) !== 0 || !rt.st) return;
    const topic = `teamsync/dir/v1/${(await sha256hex(`dir|${rt.rec.gid}`)).slice(0, 24)}`;
    const pubInv = SS().liveInvites(rt.st, Date.now()).find(i => i.pub && !i.exp && !i.max);
    if (!rt.st.public || !pubInv) {
      if (rt.rec.dirPublished) {
        c.publish(topic, '', { qos: 1, retain: true });
        rt.rec.dirPublished = false;
        saveRec(rt).catch(() => {});
      }
      return;
    }
    const id = await C().ensureIdentity();
    const card = serverCard(rt);
    const beacon = {
      v: 1, name: card.name, desc: card.desc, icon: card.icon.length <= 16000 ? card.icon : '',
      members: card.members, online: card.online, code: pubInv.code, at: Date.now(), h: me(), ik: id.ik
    };
    beacon.sig = await C().sign(beacon);
    c.publish(topic, JSON.stringify(beacon), { qos: 1, retain: true });
    rt.rec.dirPublished = true;
    saveRec(rt).catch(() => {});
  }

  async function onDir(topic, message) {
    if (!dirCollector) return;
    let b;
    try { b = JSON.parse(message.toString()); } catch (e) { return; }
    if (!b || b.v !== 1 || !SS().validCode(b.code) || typeof b.name !== 'string' || !Number.isFinite(b.at)) return;
    if (Date.now() - b.at > 30 * 60 * 1000 || b.at > Date.now() + SKEW) return;
    const { sig, ...unsigned } = b;
    if (!(await C().verify(b.ik, unsigned, sig))) return;
    dirCollector.set(topic, {
      code: b.code, name: SS().cleanName(b.name, 60), desc: SS().cleanName(b.desc, 300),
      icon: SS().validIcon(b.icon) ? b.icon : '', members: Number(b.members) || 0, online: Number(b.online) || 0, at: b.at
    });
  }

  async function discover() {
    const c = client();
    if (!c) throw Object.assign(new Error('network'), { reason: 'network' });
    dirCollector = new Map();
    c.subscribe('teamsync/dir/v1/+', { qos: 0 });
    await sleep(3500);
    try { c.unsubscribe('teamsync/dir/v1/+'); } catch (e) {}
    const list = Array.from(dirCollector.values());
    dirCollector = null;
    const mine = new Set(Array.from(servers.values()).map(rt => rt.rec.name));
    return list.sort((a, b) => (b.online - a.online) || (b.members - a.members)).map(x => ({ ...x, joinedName: mine.has(x.name) }));
  }

  // ---------- ses kanalları ----------
  async function voiceRoom(rt, ch) {
    const id = `sv-${(await C().hmacHex(rt.rec.key, `voice|${rt.rec.gid}|${ch}|${rt.rec.epoch}`)).slice(0, 24)}`;
    const pw = (await C().hmacHex(rt.rec.key, `vpw|${rt.rec.gid}|${ch}|${rt.rec.epoch}`)).slice(0, 24);
    return { id, pw };
  }

  function onVoiceBeacon(rt, fid, m) {
    if (typeof m.ch !== 'string' || !rt.st.channels[m.ch] || !Number.isFinite(m.since)) return;
    // Aynı kişi başka bir kanalda görünüyorsa oradan kaldır
    rt.voice.forEach((map, ch) => { if (ch !== m.ch) map.delete(fid); });
    if (!rt.voice.has(m.ch)) rt.voice.set(m.ch, new Map());
    const map = rt.voice.get(m.ch);
    const fresh = !map.has(fid);
    map.set(fid, { since: Math.min(m.since, Date.now()), seen: Date.now(), mute: !!m.mute, deaf: !!m.deaf, live: !!m.live });
    if (fresh || m.changed) emit('ts:server-voice', { sid: rt.rec.gid });
  }

  function voiceOf(sid, ch) {
    const rt = servers.get(sid);
    if (!rt) return [];
    const map = rt.voice.get(ch);
    if (!map) return [];
    const now = Date.now();
    map.forEach((v, fid) => { if (fid !== me() && now - v.seen > VOICE_STALE) map.delete(fid); });
    return Array.from(map.entries()).map(([fid, v]) => ({ fid, ...v })).sort((a, b) => a.since - b.since);
  }

  function myVoiceState() {
    return {
      mute: window.state.micEnabled === false || window.state.selfMicOn === false || !!window.state.deafened,
      deaf: !!window.state.deafened,
      live: !!(window.state.screenStream || window.state.isSharing)
    };
  }

  async function voiceLoop() {
    for (const rt of servers.values()) {
      if (!rt.myVoice) continue;
      if (window.state.room === rt.myVoice.room) {
        const vs = myVoiceState();
        const changed = rt.myVoice.lastState !== JSON.stringify(vs);
        rt.myVoice.lastState = JSON.stringify(vs);
        await sendEph(rt, { k: 'vc', ch: rt.myVoice.ch, since: rt.myVoice.since, ...vs, changed });
        if (!rt.voice.has(rt.myVoice.ch)) rt.voice.set(rt.myVoice.ch, new Map());
        rt.voice.get(rt.myVoice.ch).set(me(), { since: rt.myVoice.since, seen: Date.now(), ...vs });
        if (changed) emit('ts:server-voice', { sid: rt.rec.gid });
      } else if (!window.state.room || window.state.room !== rt.myVoice.room) {
        await sendEph(rt, { k: 'vcl', ch: rt.myVoice.ch });
        const map = rt.voice.get(rt.myVoice.ch);
        if (map) map.delete(me());
        rt.myVoice = null;
        emit('ts:server-voice', { sid: rt.rec.gid });
      }
    }
  }

  async function joinVoice(sid, ch) {
    const rt = servers.get(sid);
    if (!rt || !rt.st || !window.TSRoom) return false;
    const channel = rt.st.channels[ch];
    if (!channel || channel.kind !== 'voice') return false;
    if (!SS().has(SS().channelPerms(rt.st, me(), ch), SS().P.CONNECT)) { window.showToast(tr('servers.noConnect'), 'warn'); return false; }
    if (!isOnline(rt)) { window.showToast(tr('servers.offlineVoice'), 'warn'); return false; }
    const { id, pw } = await voiceRoom(rt, ch);
    if (window.state.room === id) { window.TSShell && window.TSShell.setView('call'); return true; }
    if (window.state.room) {
      // Başka bir kanaldan/aramadan geçiş: Discord gibi sormadan geç
      servers.forEach(other => { if (other.myVoice) other.myVoice.room = null; });
      window.disconnectApp();
      await sleep(400);
    }
    const ptt = localStorage.getItem('teamsync_ptt_enabled') === '1';
    window.state.isJoining = false;
    rt.myVoice = { ch, since: Date.now(), room: id };
    const ok = await window.TSRoom.start(id, pw, true, ptt, `${rt.st.name} · ${channel.name}`, false);
    if (!ok) { rt.myVoice = null; return false; }
    await voiceLoop();
    return true;
  }

  function leaveVoice() {
    if (window.state.room && typeof window.disconnectApp === 'function') window.disconnectApp();
  }

  function myVoiceChannel() {
    for (const rt of servers.values()) {
      if (rt.myVoice && window.state.room === rt.myVoice.room) return { sid: rt.rec.gid, ch: rt.myVoice.ch };
    }
    return null;
  }

  // ---------- oluşturma ----------
  async function createServer({ name, icon }) {
    await ensureStarted();
    const id = await C().ensureIdentity();
    const sid = crypto.randomUUID();
    const now = Date.now();
    const genesis = {
      id: crypto.randomUUID(), gid: sid, author: me(), type: 'srv.create', ts: now,
      body: { name: SS().cleanName(name, 60) || 'Sunucu', icon: SS().validIcon(icon || '') ? (icon || '') : '', member: { name: SS().cleanName(window.state.myName || me(), 40), ik: id.ik, ek: id.ek } }
    };
    const rec = {
      gid: sid, kind: 'server', key: C().newGroupKey(), epoch: 1, keyFrom: me(), genesis: genesis.id, owner: me(),
      name: genesis.body.name, icon: genesis.body.icon, createdAt: now, joinedAt: now - 1000,
      unread: {}, mentions: {}, readAt: {}, lastCh: null, order: now
    };
    await S().putSpace(rec);
    const rt = await activate(rec);
    const stamp = async ev => {
      const sig = await C().sign(ev);
      const acc = { h: me(), at: Date.now() };
      acc.hs = await C().sign({ id: ev.id, a: sig, h: acc.h, at: acc.at });
      return { ...ev, sig, acc };
    };
    await ingest(rt, [await stamp(genesis)], 'local');
    const textId = `t-${randHex(5)}`;
    const voiceId = `v-${randHex(5)}`;
    await submit(sid, 'ch.create', { id: textId, name: tr('servers.defaultText'), kind: 'text' });
    await submit(sid, 'ch.create', { id: voiceId, name: tr('servers.defaultVoice'), kind: 'voice' });
    rt.rec.lastCh = textId;
    await saveRec(rt);
    emit('ts:servers', { sid });
    return sid;
  }

  // ---------- eylemler ----------
  const act = (type, bodyFn) => async (sid, ...args) => submit(sid, type, bodyFn(...args));
  const newId = prefix => `${prefix}-${randHex(5)}`;

  async function sendMessage(sid, ch, text, reply) {
    let t = String(text || '').trim();
    if (!t) return null;
    if (window.TSEmoji) t = window.TSEmoji.replaceShortcodes(t);
    if (typeof window.checkTextWithAI === 'function') {
      const res = await window.checkTextWithAI(t);
      if (res && !res.ok) { window.showToast(res.warning, 'danger'); t = res.text || ''; if (!t) return null; }
    }
    const body = { text: t.slice(0, 4000) };
    if (reply) body.reply = reply;
    return submit(sid, 'msg', body, ch);
  }

  async function createInvite(sid, { expMs = 7 * 86400000, max = 0, pub = false } = {}) {
    const code = newInviteCode();
    await submit(sid, 'invite.create', { code, exp: expMs ? Date.now() + expMs : 0, max, pub: pub || undefined });
    const rt = servers.get(sid);
    if (rt && isHost(rt)) await refreshInviteSubs(rt).catch(() => {});
    return code;
  }

  // Herkese açık yapma: süresiz, sınırsız bir "herkese açık" davet de gerekir.
  async function setPublic(sid, value) {
    const rt = servers.get(sid);
    if (!rt || !rt.st) return;
    if (value && !SS().liveInvites(rt.st, Date.now()).some(i => i.pub && !i.exp && !i.max)) {
      await createInvite(sid, { expMs: 0, max: 0, pub: true });
    }
    await submit(sid, 'srv.update', { public: !!value });
    scheduleDirectory(rt);
  }

  async function leave(sid) {
    const rt = servers.get(sid);
    if (!rt) return;
    if (rt.st && rt.st.owner === me()) throw Object.assign(new Error('owner'), { reason: 'owner' });
    if (rt.myVoice) leaveVoice();
    if (isOnline(rt) && isMemberRt(rt)) { try { await submit(sid, 'member.leave', {}); } catch (e) {} }
    removeLocal(rt, 'left');
  }

  function removeLocal(rt, reason) {
    if (rt.removed) return;
    rt.removed = true;
    if (rt.myVoice && window.state.room === rt.myVoice.room) leaveVoice();
    unsubscribe(rt);
    byTopic.delete(rt.T);
    servers.delete(rt.rec.gid);
    rt.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('gone')); });
    S().deleteSpace(rt.rec.gid).catch(() => {});
    const name = (rt.st && rt.st.name) || rt.rec.name || '';
    if (reason === 'kick') window.showToast(tr('servers.kickedToast', { name }), 'warn');
    else if (reason === 'ban') window.showToast(tr('servers.bannedToast', { name }), 'warn');
    else if (reason === 'deleted') window.showToast(tr('servers.deletedToast', { name }), 'warn');
    emit('ts:server', { sid: rt.rec.gid, removed: true, reason });
    emit('ts:servers', { sid: rt.rec.gid });
  }

  function markRead(sid, ch) {
    const rt = servers.get(sid);
    if (!rt) return;
    rt.rec.readAt = rt.rec.readAt || {};
    rt.rec.readAt[ch] = Date.now();
    const had = (rt.rec.unread && rt.rec.unread[ch]) || (rt.rec.mentions && rt.rec.mentions[ch]);
    if (rt.rec.unread) delete rt.rec.unread[ch];
    if (rt.rec.mentions) delete rt.rec.mentions[ch];
    if (had) { saveRec(rt).catch(() => {}); emit('ts:servers', { sid }); }
  }

  function sendTyping(sid, ch) {
    const rt = servers.get(sid);
    if (!rt || !window.TSTyping) return;
    window.TSTyping.localActivity(`srv:${sid}:${ch}`, tv => sendEph(rt, { k: 'typing', ch, tv }));
  }

  // ---------- yaşam döngüsü ----------
  function ensureStarted() {
    if (started) return Promise.resolve();
    return start();
  }

  function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (!me() || !C() || !S() || !SS()) return;
      await C().ensureIdentity();
      const recs = await S().allSpaces().catch(() => []);
      for (const rec of recs) {
        if (rec.kind !== 'server') continue;
        try { await activate(rec); } catch (e) { console.warn('Sunucu açılamadı:', rec.gid, e && e.message); }
      }
      started = true;
      timers.push(setInterval(() => servers.forEach(rt => { if (isHost(rt)) sendHostHb(rt); }), HOST_HB));
      timers.push(setInterval(() => servers.forEach(rt => { if (!isHost(rt)) sendMemberHb(rt); }), MEMBER_HB));
      timers.push(setInterval(() => voiceLoop().catch(() => {}), VOICE_EVERY));
      timers.push(setInterval(() => {
        const now = Date.now();
        servers.forEach(rt => {
          if (isHost(rt)) {
            refreshInviteSubs(rt).catch(() => {});
            if (rt.st && rt.st.public && now - rt.dirAt > 5 * 60 * 1000) { rt.dirAt = now; publishDirectory(rt).catch(() => {}); }
            return;
          }
          // Barındırıcı yoksa (ya da anahtar yenilendiyse) yeni anahtarı iste
          if (!isOnline(rt) && rt.st && now - (rt.rec.joinedAt || 0) > 60000) requestKey(rt, false).catch(() => {});
          if (rt.pendingOnline !== isOnline(rt)) { rt.pendingOnline = isOnline(rt); emit('ts:servers', { sid: rt.rec.gid }); }
        });
      }, 30000));
      emit('ts:servers', {});
    })().catch(e => { console.warn('Sunucular başlatılamadı:', e && e.message); startPromise = null; });
    return startPromise;
  }

  function stop() {
    timers.forEach(t => clearInterval(t));
    timers = [];
    servers.forEach(rt => { unsubscribe(rt); rt.pending.forEach(p => clearTimeout(p.timer)); });
    servers.clear();
    byTopic.clear();
    invTopics.clear();
    started = false;
    startPromise = null;
  }

  function onConnect() {
    servers.forEach(rt => subscribe(rt));
  }

  // ---------- görünüm yardımcıları ----------
  function memberName(rt, fid) {
    if (fid === me()) return window.state.myName || fid;
    const friend = window.state.friends && window.state.friends[fid];
    const m = rt.st && (rt.st.members[fid] || rt.st.former[fid]);
    return (friend && friend.name) || (m && m.name) || fid;
  }

  function list() {
    return Array.from(servers.values()).filter(rt => !rt.removed).map(rt => {
      const unread = Object.values(rt.rec.unread || {}).reduce((a, n) => a + n, 0);
      const mentions = Object.values(rt.rec.mentions || {}).reduce((a, n) => a + n, 0);
      return {
        sid: rt.rec.gid, name: (rt.st && rt.st.name) || rt.rec.name || '?', icon: (rt.st && rt.st.icon) || rt.rec.icon || '',
        online: isOnline(rt), host: isHost(rt), owner: rt.st ? rt.st.owner : rt.rec.owner, unread, mentions,
        ready: !!(rt.st && rt.st.members[me()]), order: rt.rec.order || rt.rec.createdAt || 0
      };
    }).sort((a, b) => a.order - b.order);
  }

  function memberPresence(sid, fid) {
    const rt = servers.get(sid);
    if (!rt) return null;
    if (fid === me()) return { online: true, st: window.TSStatus ? window.TSStatus.effective() : 'online', av: window.state.myAvatar };
    const friend = window.state.friends && window.state.friends[fid];
    const seen = rt.membersSeen.get(fid);
    const online = (seen && !seen.hid && Date.now() - seen.at < MEMBER_STALE) || !!(friend && friend.online);
    let st = online ? ((seen && seen.st) || 'online') : 'offline';
    if (friend && window.TSStatus) st = window.TSStatus.statusOf(fid) || st;
    return { online, st, av: (friend && friend.avatar) || (seen && seen.av) || '' };
  }

  const totalUnread = () => list().reduce((a, s) => a + s.mentions, 0);

  window.TSServers = {
    start, stop, onConnect, onMqtt, onPersonalEvent,
    createServer, joinWithInvite, peekInvite, parseInvite, inviteLink, discover, setPublic,
    list, get: sid => servers.get(sid) || null, isOnline: sid => isOnline(servers.get(sid) || {}),
    isHost: sid => isHost(servers.get(sid)), onlineHosts: sid => { const rt = servers.get(sid); return rt ? onlineHosts(rt) : []; },
    memberName: (sid, fid) => { const rt = servers.get(sid); return rt ? memberName(rt, fid) : fid; },
    memberPresence, totalUnread, markRead, openChannel, loadOlder, pendingFor, sendTyping,
    channelEvents: (sid, ch, opts) => S().channelEvents(sid, ch, opts),
    // mesajlar
    sendMessage,
    editMessage: (sid, ch, target, text) => submit(sid, 'msg.edit', { target, text: String(text || '').trim().slice(0, 4000) }, ch),
    deleteMessage: (sid, ch, target) => submit(sid, 'msg.del', { target }, ch),
    react: (sid, ch, target, e, op) => submit(sid, 'react', { target, e, op: op === 'remove' ? 'remove' : 'add' }, ch),
    // sunucu / kanal / rol / üye yönetimi
    updateServer: act('srv.update', patch => patch),
    deleteServer: act('srv.delete', () => ({})),
    createChannel: (sid, { name, kind, topic, overrides }) => submit(sid, 'ch.create', { id: newId(kind === 'voice' ? 'v' : 't'), name, kind, topic, overrides }),
    updateChannel: act('ch.update', (id, patch) => ({ id, ...patch })),
    moveChannel: act('ch.move', (id, dir) => ({ id, dir })),
    deleteChannel: act('ch.delete', id => ({ id })),
    createRole: act('role.create', r => ({ id: newId('r'), name: r.name, color: r.color || '', perms: r.perms || 0, hoist: !!r.hoist })),
    updateRole: act('role.update', (id, patch) => ({ id, ...patch })),
    moveRole: act('role.move', (id, dir) => ({ id, dir })),
    deleteRole: act('role.delete', id => ({ id })),
    setMemberRoles: act('member.roles', (fid, add, remove) => ({ fid, add: add || [], remove: remove || [] })),
    renameSelf: act('member.rename', name => ({ name })),
    kick: act('member.kick', fid => ({ fid })),
    ban: act('ban.add', (fid, reason) => ({ fid, reason: reason || '' })),
    unban: act('ban.remove', fid => ({ fid })),
    createInvite,
    revokeInvite: act('invite.revoke', code => ({ code })),
    offerHost: act('host.offer', fid => ({ fid })),
    acceptHost: act('host.accept', () => ({})),
    declineHost: act('host.decline', () => ({})),
    revokeHost: act('host.revoke', fid => ({ fid })),
    resignHost: act('host.resign', () => ({})),
    leave,
    // ses
    joinVoice, leaveVoice, voiceOf, myVoiceChannel, voiceRoom: (sid, ch) => voiceRoom(servers.get(sid), ch),
    // test/hata ayıklama
    _sendHeartbeat: sid => { const rt = servers.get(sid); return rt ? sendMemberHb(rt) : null; },
    _rt: sid => servers.get(sid)
  };
})();
