// Arkadaş grupları (grup DM + grup araması) — "her üye bir sunucu".
//
// Her grup, imzalı olaylardan oluşan ve TÜM üyelerin kendi bilgisayarında
// sakladığı bir günlüktür. Trafik herkese açık MQTT aracıları üzerinden, grup
// anahtarıyla (AES-GCM) şifreli gider; konu adları anahtardan türetilir,
// dışarıdan tahmin edilemez:
//   teamsync/s/<T>/ev        imzalı olaylar (mesaj, tepki, üye, ad, arama)
//   teamsync/s/<T>/eph       geçici: kalp atışı, yazıyor, arama işaretleri
//   teamsync/s/<T>/to/<H>    yalnızca bir üyeye giden eşitleme yanıtları
// Çevrimdışıyken kaçırılanlar, çevrimiçi olan herhangi bir üyeden tamamlanır
// (kalp atışındaki "son olay zamanı / olay sayısı" karşılaştırmasıyla).
// Davet: grup anahtarı alıcının açık ECDH anahtarına sarılıp kişisel konuya
// gider (grp_invite). Kurucu birini çıkarınca anahtar yenilenir (grp_key);
// çıkarılan kişi yeni mesajları okuyamaz.
(function () {
  const MAX_MEMBERS = 25;
  const HB_EVERY = 20000;
  const BEACON_EVERY = 5000;
  const CALL_STALE = 13000;
  const CALL_PRUNE_EVERY = 2000; // ölü aramalar tetik beklemeden ≤15 sn'de kaybolur
  const JOIN_WAIT = 12000;       // "Katıl": bu sürede kimse yoksa yeni arama sessizce başlar
  const RING_FRESH = 45000;      // daha eski aramalar için zil çalmaz (geç gelen / yeniden açan)
  const CALLRING_GAP = 30000;    // "Herkesi çağır" en sık 30 sn'de bir
  const INVITE_RETRY_MIN = 60000;
  const INVITE_RETRY_MAX = 30 * 60000;
  const INVITE_RETRY_CAP = 40;
  const MAX_TEXT = 4000;
  const BATCH = 30;
  const SKEW = 5 * 60 * 1000;

  const C = () => window.TSCrypto;
  const S = () => window.TSSpaceStore;
  const me = () => window.state.friendId;
  const tr = (k, v) => window.TSUI.tr(k, v);
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  const groups = new Map();  // gid -> runtime
  const byTopic = new Map(); // T -> gid
  const invitesInFlight = new Set();
  let started = false;
  let startPromise = null;
  let timers = [];

  // ---------- yardımcılar ----------
  const client = () => {
    const c = window.state.globalMqtt;
    return c && c.connected ? c : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const validFid = f => typeof f === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(f);
  const cleanName = n => String(n || '').replace(/[\r\n<>]+/g, ' ').trim().slice(0, 60);

  function memberOf(rt, fid, ts) {
    const m = rt.rec.members.find(x => x.fid === fid);
    if (m) return m;
    const f = (rt.rec.former || []).find(x => x.fid === fid && (ts == null || ts <= x.removedAt + SKEW));
    return f || null;
  }

  // ---------- hesap kimliği / çoklu anahtar ----------
  // Üye kaydı: { fid, name, ik, ek, joinedAt, old?: [{ ik, ek }] }. `old`,
  // doğrulanmış "member.rekey" kaydıyla (eski anahtarın imzası) geride kalan
  // anahtarlardır: geçmiş olayların imzası bunlarla doğrulanır. Eski sürüm
  // istemciler bu alanı bilmez ve yok sayar.
  const MAX_OLD = 4;
  const REKEY_T = 'ts-rekey-v1';
  const keysOf = m => (m ? [m.ik].concat((m.old || []).map(o => o && o.ik)).filter(Boolean) : []);
  function cleanOld(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(o => o && C().validKey(o.ik) && (o.ek == null || C().validKey(o.ek))).slice(0, MAX_OLD).map(o => (o.ek ? { ik: o.ik, ek: o.ek } : { ik: o.ik }));
  }
  function memberFromWire(m) {
    const out = { fid: m.fid, name: cleanName(m.name), ik: m.ik, ek: m.ek, joinedAt: Number(m.joinedAt) || Date.now() };
    const old = cleanOld(m.old).filter(o => o.ik !== m.ik);
    if (old.length) out.old = old;
    return out;
  }
  const myEntry = rt => rt.rec.members.find(m => m.fid === me()) || null;
  // Grubun tüm (benim dışımdaki) üyeleri yeni sürüm mü? (kalp atışında v:2)
  const allV2 = rt => rt.rec.members.every(m => m.fid === me() || (rt.rec.v2 || []).includes(m.fid));
  function markV2(rt, fid) {
    if ((rt.rec.v2 || []).includes(fid)) return;
    rt.rec.v2 = (rt.rec.v2 || []).concat(fid).slice(-MAX_MEMBERS * 2);
    saveRec(rt).catch(() => {});
  }
  // Bu grupta hangi anahtarımla imzalarım? Hesap anahtarına geçtiysem ama
  // grupta henüz eski sürüm üye varsa (o yalnızca eski cihaz anahtarımı
  // tanır) ve o anahtar bu cihazdaysa onunla; yoksa hesap anahtarıyla.
  function myKeyChoice(rt) {
    const mine = myEntry(rt);
    if (!mine) return null;
    const acct = C().accountKeysSync();
    const dev = C().deviceKeysSync();
    if (acct && mine.ik === acct.ik) {
      if (dev && keysOf(mine).includes(dev.ik) && !allV2(rt)) return dev.ik;
      return acct.ik;
    }
    return C().holds(mine.ik) ? mine.ik : null;
  }
  async function verifyAnyKey(keys, obj, sig) {
    for (const k of keys) { if (k && await C().verify(k, obj, sig)) return true; }
    return false;
  }
  // Kişisel olay (grp_invite / grp_key) imzaları: `sig` (eski sürümler bunu
  // doğrular, sig2 dahil tüm alanlar üzerinde) + isteğe bağlı `sig2` (diğer
  // anahtarımla, sig/sig2 hariç alanlar üzerinde).
  async function signPersonal(rt, payload, forOld) {
    const mine = myEntry(rt);
    const acct = C().accountKeysSync();
    const dev = C().deviceKeysSync();
    const mineKeys = keysOf(mine);
    const primary = forOld && dev && mineKeys.includes(dev.ik) ? dev.ik : myKeyChoice(rt);
    const other = [acct && acct.ik, dev && dev.ik].find(k => k && k !== primary && mineKeys.includes(k) && C().holds(k));
    if (other && !forOld) payload.sig2 = await C().sign(payload, other);
    payload.sig = await C().sign(payload, primary);
    return payload;
  }
  async function verifyPersonal(data, keys) {
    const { sig, ...withSig2 } = data;
    if (await verifyAnyKey(keys, withSig2, sig)) return true;
    if (typeof data.sig2 === 'string') {
      const { sig2, ...base } = withSig2;
      if (await verifyAnyKey(keys, base, sig2)) return true;
    }
    return false;
  }
  // Davet/anahtar yükü için üye listesi. Eski sürüm alıcıya göç etmiş üyeler
  // (ben dahil) göç ÖNCESİ anahtarlarıyla gider: o sürüm yalnızca onları
  // doğrulayabilir ve bu üyelerin kaynak cihazları eski üye varken o
  // anahtarla imzalar (myKeyChoice).
  function wireMembers(rt, forOld) {
    return rt.rec.members.map(m => {
      const o = { fid: m.fid, name: m.name, ik: m.ik, ek: m.ek, joinedAt: m.joinedAt };
      const prev = (m.old || [])[0];
      if (forOld && prev && prev.ek && C().validKey(prev.ik) && C().validKey(prev.ek)) { o.ik = prev.ik; o.ek = prev.ek; return o; }
      const old = cleanOld(m.old);
      if (old.length) o.old = old;
      return o;
    });
  }
  const peerIsOld = fid => { const p = C().peerKeys(fid); return !(p && p.acct); };

  // ---------- anahtar göçü (member.rekey) ----------
  // Eski cihaz anahtarıyla imzalı kayıt: "bu üyenin yeni anahtarları bunlar";
  // nsig = yeni ik'nin aynı içerik üzerindeki imzası (sahiplik kanıtı).
  // Olay günlüğüne YAZILMAZ (eski sürümlerde sayaç uyuşmazlığı ve sonsuz
  // eşitleme olmasın): rec.rekeys'te tutulur, /ev'de {k:'rk'}, kalp atışında
  // (yazarınki) ve eşitleme yanıtında (hepsi) taşınır.
  const rekeyStatement = (gid, b) => ({ t: REKEY_T, gid, fid: b.fid, ik: b.ik, ek: b.ek, prev: b.prev });
  async function makeRekey(rt) {
    const acct = C().accountKeysSync();
    const mine = myEntry(rt);
    if (!acct || !mine || mine.ik === acct.ik || !C().holds(mine.ik)) return null;
    const body = { fid: me(), ik: acct.ik, ek: acct.ek, prev: mine.ik };
    body.nsig = await C().sign(rekeyStatement(rt.rec.gid, body), acct.ik);
    const ev = { id: crypto.randomUUID(), gid: rt.rec.gid, author: me(), type: 'member.rekey', body, ts: Date.now() };
    return { ...ev, sig: await C().sign(ev, mine.ik) };
  }
  async function applyRekey(rt, r) {
    if (!validShape(r) || r.type !== 'member.rekey' || r.gid !== rt.rec.gid || !r.body || r.author !== r.body.fid) return false;
    const b = r.body;
    if (!C().validKey(b.ik) || !C().validKey(b.ek) || !C().validKey(b.prev) || typeof b.nsig !== 'string') return false;
    const m = rt.rec.members.find(x => x.fid === r.author) || (rt.rec.former || []).find(x => x.fid === r.author);
    if (!m || m.ik === b.ik || m.ik !== b.prev) return false;
    const { sig, ...ev } = r;
    if (!(await C().verify(b.prev, ev, sig))) return false;
    if (!(await C().verify(b.ik, rekeyStatement(rt.rec.gid, b), b.nsig))) return false;
    if (m.ik !== b.prev) return false;   // eşzamanlı uygulama
    m.old = [{ ik: m.ik, ek: m.ek }].concat(m.old || []).filter((o, i, a) => o.ik !== b.ik && a.findIndex(x => x.ik === o.ik) === i).slice(0, MAX_OLD);
    m.ik = b.ik;
    m.ek = b.ek;
    rt.rec.rekeys = (rt.rec.rekeys || []).filter(x => x && x.id !== r.id).concat(r).slice(-50);
    await saveRec(rt);
    if (r.author !== me()) C().notePeerMigration(r.author, b.prev, { ik: b.ik, ek: b.ek });
    emit('ts:group', { gid: rt.rec.gid, rekey: r.author });
    return true;
  }
  async function applyRekeys(rt, list) {
    if (!Array.isArray(list)) return;
    const sorted = list.filter(validShape).slice(0, 60).sort((a, b) => a.ts - b.ts);
    for (const r of sorted) { try { await applyRekey(rt, r); } catch (e) {} }
  }
  const myLastRekey = rt => (rt.rec.rekeys || []).filter(r => r && r.author === me()).pop() || null;

  // Bu cihazda hesap kimliği varken grupta hâlâ eski cihaz anahtarımla
  // kayıtlıysam: göç kaydını yayınla.
  async function migrateGroups() {
    if (!C().accountKeysSync()) return;
    for (const rt of Array.from(groups.values())) {
      try {
        const r = await makeRekey(rt);
        if (!r) continue;
        if (await applyRekey(rt, r)) await pub(rt, topics(rt).ev, { k: 'rk', r }, 1);
      } catch (e) { console.warn('Grup anahtar göçü:', e && e.message); }
    }
  }
  document.addEventListener('ts:identity', () => {
    if (!started) return;
    migrateGroups().catch(() => {});
    setTimeout(() => { lastEpochAsk = 0; askOwnEpochs(); }, 1500);
  });

  function displayName(rt, fid) {
    if (fid === me()) return window.state.myName || fid;
    const friend = window.state.friends && window.state.friends[fid];
    const m = memberOf(rt, fid);
    return (friend && friend.name) || (m && m.name) || fid;
  }

  function groupTitle(rt) {
    if (rt.rec.name) return rt.rec.name;
    const others = rt.rec.members.filter(m => m.fid !== me()).map(m => displayName(rt, m.fid));
    return others.length ? others.join(', ') : tr('groups.untitled');
  }

  // ---------- aktivasyon ----------
  async function activate(rec) {
    const old = groups.get(rec.gid);
    if (old) unsubscribe(old);
    const key = await C().aesKey(rec.key);
    const T = (await C().hmacHex(rec.key, `topic:v1|${rec.gid}|${rec.epoch}`)).slice(0, 24);
    const toMine = (await C().hmacHex(rec.key, `to|${me()}`)).slice(0, 16);
    const rt = {
      rec, key, T, toMine,
      lastTs: old ? old.lastTs : 0,
      count: old ? old.count : 0,
      online: old ? old.online : new Map(),
      call: old ? old.call : null,
      myCall: old ? old.myCall : null,
      seenCalls: old ? old.seenCalls : new Set(),
      seenRings: old ? old.seenRings : new Set(),
      lastCallRing: old ? old.lastCallRing : 0,
      callKey: '',
      syncing: 0
    };
    // Arama oda kimliği önbelleği: inMyCall her 2-5 sn'de sorulur.
    rt.callRoomId = (await callRoom(rt)).id;
    if (old) byTopic.delete(old.T);
    groups.set(rec.gid, rt);
    byTopic.set(T, rec.gid);
    if (!old) {
      const newest = await S().eventsOf(rec.gid, { newest: true, limit: 1 }).catch(() => []);
      rt.lastTs = newest.length ? newest[0].ts : 0;
      rt.count = await S().countOf(rec.gid).catch(() => 0);
    }
    subscribe(rt);
    return rt;
  }

  function topics(rt) {
    return {
      ev: `teamsync/s/${rt.T}/ev`,
      eph: `teamsync/s/${rt.T}/eph`,
      to: `teamsync/s/${rt.T}/to/${rt.toMine}`
    };
  }

  function subscribe(rt) {
    const c = client();
    if (!c) return;
    const t = topics(rt);
    c.subscribe(t.ev, { qos: 1 });
    c.subscribe(t.eph, { qos: 0 });
    c.subscribe(t.to, { qos: 1 });
    setTimeout(() => sendEph(rt, { k: 'probe' }), 400 + Math.random() * 600);
  }

  function unsubscribe(rt) {
    const c = client();
    if (!c) return;
    const t = topics(rt);
    try { c.unsubscribe([t.ev, t.eph, t.to]); } catch (e) {}
  }

  async function saveRec(rt) {
    await S().putSpace(rt.rec);
  }

  // ---------- şifreli yayın ----------
  async function seal(rt, inner) {
    const { iv, ct } = await C().encrypt(rt.key, JSON.stringify(inner));
    return JSON.stringify({ v: 1, e: rt.rec.epoch, iv, ct });
  }

  async function pub(rt, topic, inner, qos = 0) {
    const c = client();
    if (!c) return false;
    const body = await seal(rt, inner);
    if (body.length > 60000) return false;
    c.publish(topic, body, { qos });
    return true;
  }

  const sendEph = (rt, inner) => pub(rt, topics(rt).eph, { ...inner, fid: me() }, 0).catch(() => false);

  // ---------- olaylar ----------
  async function makeEvent(gid, type, body) {
    const ev = { id: crypto.randomUUID(), gid, author: me(), type, body, ts: Date.now() };
    const rt = groups.get(gid);
    const sig = await C().sign(ev, rt ? myKeyChoice(rt) : null);
    return { ...ev, sig };
  }

  async function publishEvent(gid, type, body) {
    const rt = groups.get(gid);
    if (!rt) throw new Error('no-group');
    const rec = await makeEvent(gid, type, body);
    await ingest(rt, [rec], 'local');
    await pub(rt, topics(rt).ev, { k: 'ev', ev: rec }, 1);
    return rec;
  }

  function validShape(r) {
    return r && typeof r === 'object' && typeof r.id === 'string' && r.id.length <= 64
      && typeof r.gid === 'string' && validFid(r.author) && typeof r.type === 'string' && r.type.length <= 32
      && Number.isFinite(r.ts) && typeof r.sig === 'string' && r.body && typeof r.body === 'object';
  }

  // Olayları doğrular, depolar ve etkilerini uygular.
  async function ingest(rt, records, source) {
    const list = records.filter(validShape).filter(r => r.gid === rt.rec.gid && r.ts <= Date.now() + SKEW)
      .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
    const accepted = [];
    for (const r of list) {
      if (await S().hasEvent(r.id)) continue;
      const m = memberOf(rt, r.author, r.ts);
      if (!m || !m.ik) continue;
      const { sig, ...ev } = r;
      // Üyenin güncel ya da göçle geride kalmış anahtarlarından biri.
      if (source !== 'local' && !(await verifyAnyKey(keysOf(m), ev, sig))) continue;
      if (!checkPermission(rt, r)) continue;
      accepted.push(r);
      applyEffects(rt, r);
    }
    if (!accepted.length) return [];
    const added = await S().addEvents(accepted);
    if (!added.length) return [];
    added.forEach(r => {
      if (r.ts > rt.lastTs) rt.lastTs = r.ts;
      rt.count++;
    });
    // Okunmamış: başkasından gelen ve görmediğim mesajlar
    const incoming = added.filter(r => r.type === 'msg' && r.author !== me());
    if (incoming.length) {
      const viewing = window.TSGroupUI && window.TSGroupUI.isViewing(rt.rec.gid);
      if (!viewing) {
        rt.rec.unread = (rt.rec.unread || 0) + incoming.length;
        if (source !== 'sync' && !(window.TSStatus && window.TSStatus.isDnd())) {
          const last = incoming[incoming.length - 1];
          window.showToast(`${displayName(rt, last.author)} → ${groupTitle(rt)}: ${String(last.body.text || '').slice(0, 80)}`, 'info');
        }
      }
      incoming.forEach(r => { if (window.TSTyping) window.TSTyping.remoteStopped(`grp:${rt.rec.gid}`, r.author); });
    }
    await saveRec(rt);
    // Budanan olaylar sayaçtan da düşülmeli: yoksa kalp atışındaki şişmiş `n`,
    // yeniden başlamış (sayısını depodan okuyan) üyelerde sonsuz eşitleme ister.
    S().prune(rt.rec.gid).then(k => { if (k) rt.count = Math.max(0, rt.count - k); }).catch(() => {});
    if (rt.rec.removed && !rt.removedHandled) {
      // Kurucu beni çıkardı: grubu bu bilgisayardan kaldır.
      rt.removedHandled = true;
      if (rt.myCall) leaveCall(rt.rec.gid);
      unsubscribe(rt);
      byTopic.delete(rt.T);
      groups.delete(rt.rec.gid);
      S().deleteSpace(rt.rec.gid).catch(() => {});
      window.showToast(tr('groups.removedToast', { group: groupTitle(rt) }), 'warn');
      emit('ts:group', { gid: rt.rec.gid, removed: true });
      return added;
    }
    emit('ts:group', { gid: rt.rec.gid, added });
    return added;
  }

  function checkPermission(rt, r) {
    const owner = rt.rec.owner;
    switch (r.type) {
      case 'msg': return typeof r.body.text === 'string' && r.body.text.length > 0 && r.body.text.length <= MAX_TEXT;
      case 'react': return typeof r.body.target === 'string' && typeof r.body.e === 'string' && r.body.e.length <= 16;
      case 'msg.del': return typeof r.body.target === 'string';
      case 'rename': return typeof r.body.name === 'string';
      case 'member.add': return validFid(r.body.fid) && C().validKey(r.body.ik) && C().validKey(r.body.ek);
      case 'member.remove': return r.author === owner && validFid(r.body.fid);
      case 'member.leave': return r.author === r.body.fid;
      case 'call.start': return typeof r.body.callId === 'string';
      default: return false;
    }
  }

  function applyEffects(rt, r) {
    const rec = rt.rec;
    if (r.type === 'rename') rec.name = cleanName(r.body.name);
    else if (r.type === 'member.add') {
      if (!rec.members.find(m => m.fid === r.body.fid) && rec.members.length < MAX_MEMBERS) {
        rec.members.push({ fid: r.body.fid, name: cleanName(r.body.name), ik: r.body.ik, ek: r.body.ek, joinedAt: r.ts });
        rec.former = (rec.former || []).filter(f => f.fid !== r.body.fid);
      }
    } else if (r.type === 'member.remove' || r.type === 'member.leave') {
      const fid = r.body.fid;
      const m = rec.members.find(x => x.fid === fid);
      if (m) {
        rec.members = rec.members.filter(x => x.fid !== fid);
        rec.former = (rec.former || []).concat({ ...m, removedAt: r.ts });
      }
      if (fid === me()) {
        rec.removed = true;
      } else if (fid === rec.owner) {
        // Kurucu ayrıldı: en eski üye kurucu olur (herkes aynı sonuca varır).
        const next = rec.members.slice().sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))[0];
        rec.owner = next ? next.fid : null;
        if (rec.owner === me()) setTimeout(() => rotateKey(rec.gid).catch(() => {}), 1500);
      } else if (rec.owner === me() && r.type === 'member.leave') {
        setTimeout(() => rotateKey(rec.gid).catch(() => {}), 1500);
      }
    }
  }

  // ---------- gelen MQTT ----------
  async function onMqtt(topic, message) {
    const parts = topic.split('/');
    const T = parts[2];
    const kind = parts[3];
    const gid = byTopic.get(T);
    if (!gid) return;
    const rt = groups.get(gid);
    if (!rt) return;
    let inner;
    try {
      const env = JSON.parse(message.toString());
      if (!env || env.v !== 1 || env.e !== rt.rec.epoch) return;
      inner = JSON.parse(await C().decrypt(rt.key, env.iv, env.ct));
    } catch (e) { return; }
    if (!inner || typeof inner !== 'object') return;
    if (kind === 'ev' && inner.k === 'rk') {
      await applyRekey(rt, inner.r);
    } else if (kind === 'ev' && inner.k === 'ev') {
      const added = await ingest(rt, [inner.ev], 'live');
      // Güncel anahtarla imzalı olay yayınlayan davetli grubu almış demektir.
      if (added.length && inner.ev) confirmMember(rt, inner.ev.author);
    } else if (kind === 'eph') {
      onEphemeral(rt, inner);
    } else if (kind === 'to' && inner.k === 'sres' && Array.isArray(inner.events)) {
      // Önce anahtar göçleri: aynı partideki yeni anahtarla imzalı olaylar doğrulansın.
      if (Array.isArray(inner.rk)) await applyRekeys(rt, inner.rk);
      await ingest(rt, inner.events.slice(0, BATCH * 2), 'sync');
      if (inner.done) rt.syncing = 0;
    }
  }

  function onEphemeral(rt, m) {
    const fid = m.fid;
    if (!validFid(fid) || fid === me() || !memberOf(rt, fid)) return;
    rt.online.set(fid, Date.now());
    // /eph zarfı güncel dönem anahtarıyla açıldı (onMqtt e === epoch denetler):
    // gönderen grubu almış demektir → davet teslimi doğrulandı.
    confirmMember(rt, fid);
    if (m.k === 'probe') {
      setTimeout(() => sendHeartbeat(rt), 100 + Math.random() * 900);
    } else if (m.k === 'hb') {
      if (m.v === 2) markV2(rt, fid);
      if (m.rk && m.rk.author === fid) applyRekey(rt, m.rk).catch(() => {});
      if (m.epoch === rt.rec.epoch && (rt.rec.pendingKeys || []).includes(fid)) {
        rt.rec.pendingKeys = rt.rec.pendingKeys.filter(x => x !== fid);
        saveRec(rt).catch(() => {});
      }
      const theirLast = Number(m.last) || 0;
      const theirN = Number(m.n) || 0;
      if (theirLast > rt.lastTs + 1000 || (theirN > rt.count && theirLast >= rt.lastTs)) {
        const since = theirN > rt.count ? Math.max(0, rt.lastTs - 6 * 3600 * 1000) : Math.max(0, rt.lastTs - 120000);
        requestSync(rt, fid, since);
      }
      emit('ts:group-presence', { gid: rt.rec.gid });
    } else if (m.k === 'sreq' && m.to === me()) {
      serveSync(rt, fid, Number(m.since) || 0).catch(() => {});
    } else if (m.k === 'typing') {
      if (window.TSTyping) window.TSTyping.remoteTyping(`grp:${rt.rec.gid}`, fid, displayName(rt, fid), m.tv);
    } else if (m.k === 'call') {
      onCallBeacon(rt, fid, m);
    } else if (m.k === 'callleave') {
      if (rt.call && rt.call.callId === m.callId) {
        rt.call.participants.delete(fid);
        refreshCall(rt);
      }
    } else if (m.k === 'callring') {
      onCallRing(rt, fid, m);
    }
  }

  // ---------- davet teslim onayı ----------
  // Gönderilen davet (QoS 1) çevrimdışı arkadaşa hiç ulaşmayabilir: MQTT
  // istemcisi rastgele clientId + temiz oturumla bağlanır, aracı saklamaz.
  // Bu yüzden davetli, gruptan imzalı olay ya da /eph mesajı gelene kadar
  // rec.unconfirmed içinde tutulur (kalıcı) ve yeniden gönderilir.
  function markUnconfirmed(rt, fid) {
    const list = rt.rec.unconfirmed || [];
    if (!list.includes(fid)) rt.rec.unconfirmed = list.concat(fid);
    rt.rec.inviteTries = rt.rec.inviteTries || {};
    const prev = rt.rec.inviteTries[fid];
    rt.rec.inviteTries[fid] = { n: prev ? prev.n + 1 : 1, at: Date.now() };
  }

  function confirmMember(rt, fid) {
    if (!rt || !validFid(fid) || !(rt.rec.unconfirmed || []).includes(fid)) return;
    rt.rec.unconfirmed = rt.rec.unconfirmed.filter(x => x !== fid);
    if (rt.rec.inviteTries) delete rt.rec.inviteTries[fid];
    saveRec(rt).catch(() => {});
    emit('ts:group-presence', { gid: rt.rec.gid });
  }

  // Yeniden gönderim: arkadaş çevrimiçiyken, artan aralıkla (1 dk → 30 dk), en çok 40 kez.
  async function resendInvites(rt, onlyFid, force) {
    const list = (rt.rec.unconfirmed || []).slice();
    let changed = false;
    for (const fid of list) {
      if (onlyFid && fid !== onlyFid) continue;
      const m = rt.rec.members.find(x => x.fid === fid);
      if (!m || !m.ek) { rt.rec.unconfirmed = rt.rec.unconfirmed.filter(x => x !== fid); changed = true; continue; }
      const friend = window.state.friends && window.state.friends[fid];
      if (!friend || !friend.online) continue;
      const tries = (rt.rec.inviteTries || {})[fid] || { n: 0, at: 0 };
      if (tries.n >= INVITE_RETRY_CAP) continue;
      const gap = Math.min(INVITE_RETRY_MAX, INVITE_RETRY_MIN * Math.pow(2, Math.max(0, tries.n - 1)));
      // Arkadaş yeni çevrimiçi olduysa (force) aralık 20 sn'ye iner.
      if (Date.now() - tries.at < (force ? 20000 : gap)) continue;
      if (await sendInvite(rt, fid, { ik: m.ik, ek: m.ek })) { markUnconfirmed(rt, fid); changed = true; }
      await sleep(40);
    }
    if (changed) await saveRec(rt);
  }

  function sendHeartbeat(rt) {
    // v:2 → yeni sürüm (hesap anahtarlarını tanır); rk → kendi son anahtar göçüm.
    const hb = { k: 'hb', epoch: rt.rec.epoch, last: rt.lastTs, n: rt.count, v: 2 };
    const rk = myLastRekey(rt);
    if (rk) hb.rk = rk;
    return sendEph(rt, hb);
  }

  function requestSync(rt, fromFid, since) {
    const now = Date.now();
    if (rt.syncing && now - rt.syncing < 10000) return;
    rt.syncing = now;
    sendEph(rt, { k: 'sreq', to: fromFid, since });
  }

  async function serveSync(rt, toFid, since) {
    if (!memberOf(rt, toFid)) return;
    const events = await S().eventsOf(rt.rec.gid, { since, limit: 2000 });
    const toTopic = `teamsync/s/${rt.T}/to/${(await C().hmacHex(rt.rec.key, `to|${toFid}`)).slice(0, 16)}`;
    const rk = (rt.rec.rekeys || []).slice(-20);
    if (!events.length) { await pub(rt, toTopic, { k: 'sres', events: [], done: true, ...(rk.length ? { rk } : {}) }, 1); return; }
    if (rk.length) await pub(rt, toTopic, { k: 'sres', events: [], done: false, rk }, 1);
    for (let i = 0; i < events.length; i += BATCH) {
      const chunk = events.slice(i, i + BATCH);
      const done = i + BATCH >= events.length;
      // 60 KB sınırı: gerekirse parçayı küçült
      let slice = chunk;
      while (slice.length > 1 && JSON.stringify(slice).length > 40000) slice = slice.slice(0, Math.ceil(slice.length / 2));
      if (slice.length < chunk.length) { i -= (chunk.length - slice.length); }
      await pub(rt, toTopic, { k: 'sres', events: slice, done: done && slice.length === chunk.length }, 1);
      await sleep(70);
    }
  }

  // ---------- aramalar ----------
  async function callRoom(rt) {
    const id = `gc-${(await C().hmacHex(rt.rec.key, `call|${rt.rec.gid}|${rt.rec.epoch}`)).slice(0, 24)}`;
    const pw = (await C().hmacHex(rt.rec.key, `callpw|${rt.rec.gid}|${rt.rec.epoch}`)).slice(0, 24);
    return { id, pw };
  }

  // Arama yalnızca en az bir CANLI katılımcı varken vardır. Başkaları
  // CALL_STALE boyunca işaret göndermezse düşer; ben ise yalnızca gerçekten o
  // odadaysam ve aramam buysa katılımcıyım (kendi kaydım bayatlayamaz).
  function inMyCallSync(rt) {
    return !!(rt && rt.callRoomId && window.state.room && window.state.room === rt.callRoomId);
  }

  function activeCall(rt) {
    if (!rt.call) return null;
    const now = Date.now();
    const mineLive = !!(rt.myCall && rt.myCall.callId === rt.call.callId && inMyCallSync(rt));
    rt.call.participants.forEach((seen, fid) => {
      if (fid === me() ? !mineLive : now - seen > CALL_STALE) rt.call.participants.delete(fid);
    });
    if (!rt.call.participants.size) { rt.call = null; return null; }
    return rt.call;
  }

  // Eşzamanlı iki aramadan hangisi kalır: daha eski olan; aynı milisaniyede
  // başlatıldıysa küçük callId (herkeste aynı sonuç).
  const callBefore = (x, y) => x.startedAt < y.startedAt || (x.startedAt === y.startedAt && x.callId < y.callId);

  function onCallBeacon(rt, fid, m) {
    if (typeof m.callId !== 'string' || m.callId.length > 64 || !Number.isFinite(m.startedAt) || !validFid(m.startedBy)) return;
    const fresh = !rt.call || rt.call.callId !== m.callId;
    if (fresh) {
      // Aynı anda iki arama başlatılırsa daha eski olan kazanır (gönderen de
      // aynı kuralla eskisine geçer → herkes TEK aramada buluşur).
      if (rt.call && rt.call.participants.size && !callBefore(m, rt.call)) {
        rt.call.participants.set(fid, Date.now());
        rt.seenCalls.add(m.callId);
        refreshCall(rt);
        return;
      }
      rt.call = { callId: m.callId, startedAt: Math.min(m.startedAt, Date.now()), startedBy: m.startedBy, ring: m.ring !== false, participants: new Map() };
    }
    rt.call.participants.set(fid, Date.now());
    if (rt.myCall && rt.myCall.callId !== rt.call.callId && callBefore(rt.call, rt.myCall)) {
      rt.myCall = { callId: rt.call.callId, startedAt: rt.call.startedAt, startedBy: rt.call.startedBy, ring: !!rt.call.ring };
    }
    if (!rt.seenCalls.has(m.callId)) {
      rt.seenCalls.add(m.callId);
      // Zil: yalnızca arayan "Herkesi ara" dediyse (ring:false = sessiz
      // toplantı; eski istemcilerde alan yok → çalar) VE arama yeni
      // başladıysa. Sonradan çevrimiçi olan / uygulamayı yeniden açan biri
      // 20 dk'lık bir arama için zil duymaz, yalnızca başlığı görür.
      const young = Date.now() - rt.call.startedAt < RING_FRESH;
      if (m.ring !== false && young && !rt.myCall && !window.state.room && window.TSGroupUI) window.TSGroupUI.ring(rt.rec.gid);
    }
    refreshCall(rt);
  }

  // "Herkesi çağır": aramadaki biri, aramada olmayan üyeleri çaldırır.
  function onCallRing(rt, fid, m) {
    if (typeof m.rid !== 'string' || m.rid.length > 64 || rt.seenRings.has(m.rid)) return;
    rt.seenRings.add(m.rid);
    if (rt.seenRings.size > 200) rt.seenRings.delete(rt.seenRings.values().next().value);
    if (typeof m.callId === 'string' && Number.isFinite(m.startedAt) && validFid(m.startedBy)) {
      onCallBeacon(rt, fid, { callId: m.callId, startedAt: m.startedAt, startedBy: m.startedBy, ring: false });
    }
    if (rt.myCall || window.state.room || !window.TSGroupUI) return;
    window.TSGroupUI.ring(rt.rec.gid, { by: fid });
  }

  const callKeyOf = c => (c ? `${c.callId}|${Array.from(c.participants.keys()).sort().join(',')}` : '');

  function refreshCall(rt) {
    rt.callKey = callKeyOf(activeCall(rt));
    emit('ts:group-call', { gid: rt.rec.gid });
  }

  // Ölü aramayı (son katılımcı işaret göndermeyi bıraktı) yeniden çizim
  // tetiği beklemeden düşürür; yalnızca değişiklik olunca olay yayar.
  function pruneCalls() {
    for (const rt of groups.values()) {
      const key = callKeyOf(activeCall(rt));
      if (key !== rt.callKey) { rt.callKey = key; emit('ts:group-call', { gid: rt.rec.gid }); }
    }
  }

  async function inMyCall(rt) {
    return inMyCallSync(rt);
  }

  const beaconOf = rt => ({ k: 'call', callId: rt.myCall.callId, startedAt: rt.myCall.startedAt, startedBy: rt.myCall.startedBy, ring: !!rt.myCall.ring, name: window.state.myName });

  // Benim katılımımı bitiren TEK yol: callleave gönderir, yerel durumu temizler.
  function endMyCall(rt) {
    if (!rt || !rt.myCall) return;
    const callId = rt.myCall.callId;
    rt.myCall = null;
    if (rt.joinTimer) { clearTimeout(rt.joinTimer); rt.joinTimer = null; }
    sendEph(rt, { k: 'callleave', callId });
    if (rt.call && rt.call.callId === callId) rt.call.participants.delete(me());
    refreshCall(rt);
  }

  function announceMyCall(rt) {
    if (!rt || !rt.myCall) return;
    if (!rt.call || rt.call.callId !== rt.myCall.callId) rt.call = { ...rt.myCall, participants: new Map() };
    rt.call.participants.set(me(), Date.now());
    sendEph(rt, beaconOf(rt));
    refreshCall(rt);
  }

  async function beaconLoop() {
    for (const gid of Array.from(groups.keys())) {
      const rt = groups.get(gid);
      if (!rt || !rt.myCall) continue;
      if (!inMyCallSync(rt)) { endMyCall(rt); continue; } // aramadan çıkıldı / başka odaya geçildi
      // Bağlanırken (henüz kimseye ulaşmadan) katılımcı ilan edilmez: aksi
      // hâlde ölü bir aramaya "Katıl" diyen herkes hayalet katılımcı olurdu.
      if (window.state.isJoining && !(window.state.peers && window.state.peers.size)) continue;
      if (!rt.call || rt.call.callId !== rt.myCall.callId) rt.call = { ...rt.myCall, participants: new Map() };
      rt.call.participants.set(me(), Date.now());
      await sendEph(rt, beaconOf(rt));
    }
    pruneCalls();
  }

  function showCallScreenNow() {
    // Katılan taraf ilk eş bağlanana kadar #app'i gizli tutuyordu (renderer
    // startApp): arama ekranı "Bağlanıyor…" ile hemen açılsın.
    const app = document.getElementById('app');
    if (app && app.classList.contains('hidden')) app.classList.toggle('hidden', false);
    const tb = document.querySelector('.top-bar');
    if (tb) tb.style.display = 'flex';
  }

  // "Katıl" dendi ama JOIN_WAIT içinde odada kimse yok (bayat başlık): kullanıcıyı
  // dışarı atma — aynı odada yeni bir aramanın ilk katılımcısı yap (zil yok).
  function joinFallback(gid, roomId, callId) {
    const rt = groups.get(gid);
    if (!rt) return;
    rt.joinTimer = null;
    if (!rt.myCall || rt.myCall.callId !== callId || window.state.room !== roomId) return;
    if (!window.state.isJoining || (window.state.peers && window.state.peers.size)) return;
    if (rt.call && rt.call.callId === callId) rt.call = null;
    rt.myCall = { callId: crypto.randomUUID(), startedAt: Date.now(), startedBy: me(), ring: false };
    if (window.TSRoom && typeof window.TSRoom.claimFounder === 'function') window.TSRoom.claimFounder();
    else window.state.isJoining = false;
    publishEvent(gid, 'call.start', { callId: rt.myCall.callId, ring: false }).catch(() => {});
    announceMyCall(rt);
  }

  // opts.ring: true (varsayılan) = "Herkesi ara" (üyelerde zil çalar),
  // false = "Toplantı başlat" (sessiz; üyeler yalnızca başlığı görür).
  // Etkin bir arama varsa her iki durumda da ona katılınır.
  const callBusy = new Set();
  async function startOrJoinCall(gid, opts) {
    if (!groups.get(gid) || !window.TSRoom || callBusy.has(gid)) return false;
    callBusy.add(gid);
    try { return await startOrJoinInner(gid, !(opts && opts.ring === false)); }
    finally { callBusy.delete(gid); }
  }

  async function startOrJoinInner(gid, ringAll) {
    let rt = groups.get(gid);
    const { id, pw } = await callRoom(rt);
    if (window.state.room === id) { if (window.TSShell) window.TSShell.setView('call'); return true; }
    if (window.state.room) {
      const ok = typeof window.showConfirm === 'function' ? await window.showConfirm(tr('groups.leaveCurrentTitle'), tr('groups.leaveCurrentBody')) : true;
      if (!ok) return false;
      window.disconnectApp();
      await sleep(400);
    }
    // Her await'ten sonra çalışma zamanı yeniden alınır: anahtar yenilenince
    // activate() rt nesnesini değiştirir, eskisine yazılanlar kaybolurdu.
    rt = groups.get(gid);
    if (!rt) return false;
    const ptt = localStorage.getItem('teamsync_ptt_enabled') === '1';
    const title = groupTitle(rt);
    const current = activeCall(rt);
    const others = current ? Array.from(current.participants.keys()).filter(f => f !== me()) : [];
    if (others.length) {
      const callId = current.callId;
      const mine = { callId, startedAt: current.startedAt, startedBy: current.startedBy, ring: !!current.ring };
      rt.myCall = mine;
      window.state.isJoining = true;
      const ok = await window.TSRoom.start(id, pw, true, ptt, title, true);
      rt = groups.get(gid);
      if (!ok || window.state.room !== id) {
        if (rt && rt.myCall === mine) rt.myCall = null;
        if (!window.state.room) window.state.isJoining = false;
        if (rt) refreshCall(rt);
        return false;
      }
      showCallScreenNow();
      if (rt) {
        if (rt.joinTimer) clearTimeout(rt.joinTimer);
        rt.joinTimer = setTimeout(() => joinFallback(gid, id, callId), JOIN_WAIT);
      }
      return true;
    }
    const mine = { callId: crypto.randomUUID(), startedAt: Date.now(), startedBy: me(), ring: ringAll };
    rt.myCall = mine;
    window.state.isJoining = false;
    const ok = await window.TSRoom.start(id, pw, true, ptt, title, false);
    rt = groups.get(gid);
    if (!rt) return false;
    if (!ok || window.state.room !== id) {
      if (rt.myCall === mine) rt.myCall = null;
      refreshCall(rt);
      return false;
    }
    if (!rt.myCall) rt.myCall = mine;
    // Sessiz başlatmada da sohbete "arama başlattı" satırı düşer.
    publishEvent(gid, 'call.start', { callId: mine.callId, ring: ringAll }).catch(() => {});
    announceMyCall(rt);
    return true;
  }

  function leaveCall(gid) {
    const rt = groups.get(gid);
    if (rt) endMyCall(rt);
    if (window.state.room) window.disconnectApp();
  }

  // Aramadayken, henüz katılmamış üyeleri çaldırır (gönderen 30 sn'de bir).
  function ringMissing(gid) {
    const rt = groups.get(gid);
    if (!rt || !rt.myCall || !inMyCallSync(rt)) return 'nocall';
    const now = Date.now();
    if (now - (rt.lastCallRing || 0) < CALLRING_GAP) return 'wait';
    rt.lastCallRing = now;
    sendEph(rt, { k: 'callring', rid: crypto.randomUUID(), callId: rt.myCall.callId, startedAt: rt.myCall.startedAt, startedBy: rt.myCall.startedBy });
    return 'sent';
  }

  // Arama ekranının "Ayrıl"ı (ya da başka bir yoldan çıkış) beni hemen düşürür.
  document.addEventListener('ts:call', e => {
    if (e.detail && e.detail.active) return;
    groups.forEach(rt => { if (rt.myCall && !inMyCallSync(rt)) endMyCall(rt); });
  });

  // ---------- oluşturma / davet ----------
  function memberEntryForMe() {
    const keys = C().publicKeysSync();
    return { fid: me(), name: window.state.myName || me(), ik: keys.ik, ek: keys.ek, joinedAt: Date.now() };
  }

  async function createGroup(friendIds, name) {
    await C().ensureIdentity();
    const gid = crypto.randomUUID();
    const rec = {
      gid, name: cleanName(name), owner: me(), epoch: 1, key: C().newGroupKey(),
      members: [memberEntryForMe()], former: [], createdAt: Date.now(),
      unread: 0, pendingInvites: [], pendingKeys: []
    };
    await S().putSpace(rec);
    const rt = await activate(rec);
    const pending = [];
    const ready = [];
    // Önce herkesi günlüğe ekle, sonra davetleri tam üye listesiyle gönder:
    // böylece her davetli diğerlerini de baştan tanır.
    for (const fid of friendIds.slice(0, MAX_MEMBERS - 1)) {
      const keys = validFid(fid) && fid !== me() ? C().peerKeys(fid) : null;
      if (!keys) { pending.push(fid); continue; }
      const friend = window.state.friends[fid] || {};
      await publishEvent(gid, 'member.add', { fid, name: cleanName(friend.name || fid), ik: keys.ik, ek: keys.ek });
      ready.push({ fid, keys });
    }
    for (const { fid, keys } of ready) {
      await sendInvite(rt, fid, keys);
      markUnconfirmed(rt, fid); // MQTT bağlı değilse de: çevrimiçi olunca yeniden gönderilir
    }
    rt.rec.pendingInvites = pending.slice();
    await saveRec(rt);
    pending.forEach(fid => { if (window.TSProfile) window.TSProfile.request(fid, 0, true); });
    emit('ts:group', { gid });
    return { gid, pending, rt };
  }

  async function wrapKeyFor(rt, ekB64, purpose) {
    return C().wrapFor(ekB64, JSON.stringify({ key: rt.rec.key, epoch: rt.rec.epoch }), rt.rec.gid, purpose);
  }

  async function invite(gid, fid) {
    const rt = groups.get(gid);
    if (!rt || !validFid(fid) || fid === me()) return 'invalid';
    if (rt.rec.members.find(m => m.fid === fid)) return 'already';
    // 25 sınırı: üyeler (onaylanmamış davetliler dahil; onlar zaten members'ta)
    // + anahtarı beklenen davetliler (bu kişi hariç: retryPending onu yeniden dener).
    const memberIds = new Set(rt.rec.members.map(m => m.fid));
    const waiting = new Set([...(rt.rec.pendingInvites || []), ...(rt.rec.unconfirmed || [])].filter(f => f !== fid && !memberIds.has(f)));
    if (memberIds.size + waiting.size >= MAX_MEMBERS) return 'full';
    const keys = C().peerKeys(fid);
    if (!keys) {
      if (!(rt.rec.pendingInvites || []).includes(fid)) rt.rec.pendingInvites = (rt.rec.pendingInvites || []).concat(fid);
      await saveRec(rt);
      if (window.TSProfile) window.TSProfile.request(fid, 0, true);
      return 'pending';
    }
    const friend = window.state.friends[fid] || {};
    // Önce günlüğe ekle (herkes yeni üyeyi ve anahtarlarını öğrensin)
    await publishEvent(gid, 'member.add', { fid, name: cleanName(friend.name || fid), ik: keys.ik, ek: keys.ek });
    const cur = groups.get(gid) || rt;
    await sendInvite(cur, fid, keys);
    markUnconfirmed(cur, fid);
    cur.rec.pendingInvites = (cur.rec.pendingInvites || []).filter(x => x !== fid);
    await saveRec(cur);
    return 'sent';
  }

  async function sendInvite(rt, fid, keys) {
    const c = client();
    if (!c) return false;
    const wrapped = await wrapKeyFor(rt, keys.ek, 'grp-invite');
    const forOld = peerIsOld(fid);
    const payload = {
      type: 'grp_invite', fromId: me(), fromName: window.state.myName, gid: rt.rec.gid, epoch: rt.rec.epoch,
      name: rt.rec.name, owner: rt.rec.owner, createdAt: rt.rec.createdAt,
      members: wireMembers(rt, forOld),
      wrapped, ts: Date.now()
    };
    if (!forOld && (rt.rec.rekeys || []).length) payload.rk = rt.rec.rekeys.slice(-20);
    await signPersonal(rt, payload, forOld);
    c.publish(`teamsync/user/${fid}/events`, JSON.stringify(payload), { qos: 1 });
    return true;
  }

  // Grup anahtarını KENDİ diğer cihazlarıma (aynı hesap, kendi kişisel konum)
  // hesap ek'ime sarılmış olarak iletir: yeni bir anahtar dönemi kodla eklenen
  // cihaza da ulaşsın. Yalnızca hesabın anahtarlarıyla imzalanabildiği için
  // alıcı cihaz kendi üye kaydımın anahtarlarıyla doğrular.
  async function deliverToOwnDevices(rt) {
    const c = client();
    const acct = C().accountKeysSync();
    const mine = myEntry(rt);
    if (!c || !acct || !mine || !keysOf(mine).includes(acct.ik)) return false;
    const wrapped = await wrapKeyFor(rt, acct.ek, 'grp-key');
    const payload = {
      type: 'grp_key', fromId: me(), gid: rt.rec.gid, epoch: rt.rec.epoch, name: rt.rec.name, owner: rt.rec.owner,
      members: wireMembers(rt, false), wrapped, ts: Date.now(), own: 1
    };
    if ((rt.rec.rekeys || []).length) payload.rk = rt.rec.rekeys.slice(-20);
    payload.sig = await C().sign(payload, acct.ik);
    c.publish(`teamsync/user/${me()}/events`, JSON.stringify(payload), { qos: 1 });
    return true;
  }

  // Kendi diğer cihazım hangi dönemleri bildiğini sordu (acct_dev 'gkreq'):
  // daha yeni dönemde olduğum gruplar için anahtarı yeniden ilet.
  async function onOwnDeviceEpochs(list) {
    if (!started || !Array.isArray(list)) return;
    const theirs = new Map(list.filter(x => Array.isArray(x) && typeof x[0] === 'string').map(x => [x[0], Number(x[1]) || 0]));
    for (const rt of Array.from(groups.values())) {
      if (rt.rec.removed) continue;
      const e = theirs.has(rt.rec.gid) ? theirs.get(rt.rec.gid) : 0;
      if (e < rt.rec.epoch) { await deliverToOwnDevices(rt).catch(() => false); await sleep(40); }
    }
  }
  function ownEpochs() {
    return Array.from(groups.values()).filter(rt => !rt.rec.removed).slice(0, 40).map(rt => [rt.rec.gid, rt.rec.epoch]);
  }

  // Çıkarma/ayrılma sonrası kurucu anahtarı yeniler.
  async function rotateKey(gid) {
    const rt = groups.get(gid);
    if (!rt || rt.rec.owner !== me()) return;
    rt.rec.key = C().newGroupKey();
    rt.rec.epoch += 1;
    rt.rec.pendingKeys = rt.rec.members.filter(m => m.fid !== me()).map(m => m.fid);
    await saveRec(rt);
    const next = await activate(rt.rec);
    await deliverKeys(next);
    await deliverToOwnDevices(next).catch(() => false);
    emit('ts:group', { gid });
  }

  async function deliverKeys(rt, onlyFid) {
    const c = client();
    if (!c) return;
    for (const m of rt.rec.members) {
      if (m.fid === me() || !m.ek) continue;
      if (onlyFid && m.fid !== onlyFid) continue;
      if (!(rt.rec.pendingKeys || []).includes(m.fid)) continue;
      const wrapped = await wrapKeyFor(rt, m.ek, 'grp-key');
      const forOld = !(rt.rec.v2 || []).includes(m.fid) && peerIsOld(m.fid);
      const payload = {
        type: 'grp_key', fromId: me(), gid: rt.rec.gid, epoch: rt.rec.epoch, name: rt.rec.name, owner: rt.rec.owner,
        members: wireMembers(rt, forOld),
        wrapped, ts: Date.now()
      };
      if (!forOld && (rt.rec.rekeys || []).length) payload.rk = rt.rec.rekeys.slice(-20);
      await signPersonal(rt, payload, forOld);
      c.publish(`teamsync/user/${m.fid}/events`, JSON.stringify(payload), { qos: 1 });
      await sleep(40);
    }
  }

  function validMembers(list) {
    return Array.isArray(list) && list.length >= 1 && list.length <= MAX_MEMBERS
      && list.every(m => m && validFid(m.fid) && C().validKey(m.ik) && C().validKey(m.ek));
  }

  async function onPersonalEvent(raw) {
    await ensureStarted();
    // renderer.js'in eklediği yerel işaretler imzanın parçası değildir.
    const data = raw && typeof raw === 'object' ? { ...raw } : raw;
    if (!data || !validFid(data.fromId) || typeof data.gid !== 'string' || data.gid.length > 64) return;
    const friend = window.state.friends[data.fromId];
    if (data.type === 'grp_invite') {
      // Yalnızca (engellenmemiş) arkadaşlardan davet kabul edilir.
      // Sessize alınmış arkadaşın daveti kabul edilir (sessiz = yalnızca bildirim yok).
      if (!friend || friend.temporary || (window.TSBlock && window.TSBlock.isBlocked(data.fromId))) return;
      if (!validMembers(data.members) || !data.members.find(m => m.fid === me())) return;
      // Davet, teslim doğrulanana kadar yeniden gönderilir: aynı davetin
      // kopyaları (eşzamanlı gelenler dahil) yalnızca bir kez işlenir.
      const have = groups.get(data.gid);
      if ((have && have.rec.epoch >= data.epoch && !have.rec.removed) || invitesInFlight.has(data.gid)) {
        if (have) setTimeout(() => sendHeartbeat(have), 200 + Math.random() * 600); // davet edene "aldım" sinyali
        return;
      }
      invitesInFlight.add(data.gid);
      setTimeout(() => invitesInFlight.delete(data.gid), 10000);
      const sender = data.members.find(m => m.fid === data.fromId);
      if (!sender) return;
      // İmza, arkadaş için SABİTLENMİŞ anahtarlardan biriyle (güncel ya da
      // doğrulanmış göçle geride kalan) atılmış olmalı; sabit yoksa (ilk
      // görüş) davetteki kendi kaydı kabul edilir.
      const known = C().peerKeys(data.fromId);
      const trusted = known ? C().trustedIks(data.fromId) : keysOf(memberFromWire(sender));
      if (!(await verifyPersonal(data, trusted))) return;
      if (!known) C().rememberPeer(data.fromId, { ik: sender.ik, ek: sender.ek });
      const existing = groups.get(data.gid);
      if (existing && existing.rec.epoch >= data.epoch && !existing.rec.removed) return;
      let keyInfo;
      try { keyInfo = JSON.parse(await C().unwrap(data.wrapped, data.gid, 'grp-invite')); } catch (e) { return; }
      if (!keyInfo || typeof keyInfo.key !== 'string' || keyInfo.epoch !== data.epoch) return;
      const rec = {
        gid: data.gid, name: cleanName(data.name), owner: validFid(data.owner) ? data.owner : data.fromId,
        epoch: data.epoch, key: keyInfo.key,
        members: data.members.map(memberFromWire),
        former: existing ? existing.rec.former || [] : [], createdAt: Number(data.createdAt) || Date.now(),
        unread: existing ? existing.rec.unread || 0 : 0, pendingInvites: [], pendingKeys: []
      };
      // Göç kayıtları (imzalı) başkalarına eşitleme yanıtında iletilmek üzere saklanır.
      if (Array.isArray(data.rk)) rec.rekeys = data.rk.filter(validShape).slice(-20);
      await S().putSpace(rec);
      const rt = await activate(rec);
      window.showToast(tr('groups.invitedToast', { name: friend.name || data.fromName || data.fromId, group: groupTitle(rt) }), 'ok');
      emit('ts:group', { gid: rec.gid });
    } else if (data.type === 'grp_key') {
      const rt = groups.get(data.gid);
      // Kurucudan ya da (aynı hesabın) kendi diğer cihazımdan.
      const fromSelf = data.fromId === me();
      if (!rt || data.epoch <= rt.rec.epoch || (data.fromId !== rt.rec.owner && !fromSelf)) return;
      const owner = memberOf(rt, data.fromId);
      if (!owner || !validMembers(data.members) || !data.members.find(m => m.fid === me())) return;
      if (fromSelf && !validFid(data.owner)) return;
      if (!(await verifyPersonal(data, keysOf(owner)))) return;
      if (Array.isArray(data.rk)) await applyRekeys(rt, data.rk);
      let keyInfo;
      try { keyInfo = JSON.parse(await C().unwrap(data.wrapped, data.gid, 'grp-key')); } catch (e) { return; }
      if (!keyInfo || keyInfo.epoch !== data.epoch) return;
      rt.rec.key = keyInfo.key;
      rt.rec.epoch = data.epoch;
      // Bildiğim eski anahtarlar (göç geçmişi) yeni listede yoksa korunur.
      const prevMembers = new Map(rt.rec.members.map(m => [m.fid, m]));
      rt.rec.members = data.members.map(w => {
        const m = memberFromWire(w);
        const p = prevMembers.get(m.fid);
        if (p) {
          const merged = cleanOld([{ ik: p.ik, ek: p.ek }].concat(p.old || [], m.old || [])).filter((o, i, a) => o.ik !== m.ik && a.findIndex(x => x.ik === o.ik) === i);
          if (merged.length) m.old = merged.slice(0, MAX_OLD);
        }
        return m;
      });
      rt.rec.owner = data.owner;
      await saveRec(rt);
      const next = await activate(rt.rec);
      setTimeout(() => sendHeartbeat(next), 300);
      emit('ts:group', { gid: data.gid });
    }
  }

  // Arkadaş çevrimiçi olunca: anahtarı yoksa profil iste, bekleyen davet /
  // anahtar teslimlerini yap.
  function onFriendOnline(fid) {
    if (!started) return;
    if (!C().peerKeys(fid) && window.TSProfile) setTimeout(() => window.TSProfile.request(fid, 0, true), 800 + Math.random() * 1500);
    setTimeout(() => retryPending(fid, true).catch(() => {}), 2500);
  }

  async function retryPending(onlyFid, cameOnline) {
    for (const gid of Array.from(groups.keys())) {
      let rt = groups.get(gid);
      if (!rt) continue;
      for (const fid of (rt.rec.pendingInvites || []).slice()) {
        if (onlyFid && fid !== onlyFid) continue;
        if (C().peerKeys(fid)) await invite(gid, fid);
      }
      rt = groups.get(gid);
      if (!rt) continue;
      if ((rt.rec.unconfirmed || []).length) await resendInvites(rt, onlyFid, !!cameOnline);
      rt = groups.get(gid);
      if (rt && (rt.rec.pendingKeys || []).length && rt.rec.owner === me()) await deliverKeys(rt, onlyFid);
    }
  }

  // ---------- kullanıcı eylemleri ----------
  async function sendMessage(gid, text) {
    let t = String(text || '').trim();
    if (!t) return null;
    if (window.TSEmoji) t = window.TSEmoji.replaceShortcodes(t);
    if (typeof window.checkTextWithAI === 'function') {
      const res = await window.checkTextWithAI(t);
      if (res && !res.ok) { window.showToast(res.warning, 'danger'); t = res.text || ''; if (!t) return null; }
    }
    return publishEvent(gid, 'msg', { text: t.slice(0, MAX_TEXT) });
  }
  const react = (gid, target, e, op) => publishEvent(gid, 'react', { target, e, op: op === 'remove' ? 'remove' : 'add' });
  const deleteMessage = (gid, target) => publishEvent(gid, 'msg.del', { target });
  const rename = (gid, name) => publishEvent(gid, 'rename', { name: cleanName(name) });

  async function kick(gid, fid) {
    const rt = groups.get(gid);
    if (!rt || rt.rec.owner !== me() || fid === me()) return;
    await publishEvent(gid, 'member.remove', { fid });
    await rotateKey(gid);
  }

  async function leave(gid) {
    const rt = groups.get(gid);
    if (!rt) return;
    if (rt.myCall) leaveCall(gid);
    try { await publishEvent(gid, 'member.leave', { fid: me() }); } catch (e) {}
    await sleep(300);
    unsubscribe(rt);
    byTopic.delete(rt.T);
    groups.delete(gid);
    await S().deleteSpace(gid);
    emit('ts:group', { gid, removed: true });
  }

  function sendTyping(gid) {
    const rt = groups.get(gid);
    if (!rt || !window.TSTyping) return;
    window.TSTyping.localActivity(`grp:${gid}`, tv => sendEph(rt, { k: 'typing', tv }));
  }

  // Her seferinde depodan okunur (IndexedDB, ≤400 olay hızlı). Bellekte ayrı
  // bir kopya tutmak eşzamanlı yüklemelerde eski anlık görüntünün yeniyi
  // ezmesine yol açıyordu.
  async function loadEvents(gid, limit = 400) {
    if (!groups.get(gid)) return [];
    return S().eventsOf(gid, { newest: true, limit });
  }

  function markRead(gid) {
    const rt = groups.get(gid);
    if (!rt || !rt.rec.unread) return;
    rt.rec.unread = 0;
    saveRec(rt).catch(() => {});
    emit('ts:group', { gid });
  }

  // ---------- yaşam döngüsü ----------
  function ensureStarted() {
    if (started) return Promise.resolve();
    return start();
  }

  function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (!me() || !C() || !S()) return;
      await C().ensureIdentity();
      const recs = await S().allSpaces().catch(() => []);
      for (const rec of recs) {
        if (rec.removed || rec.kind === 'server') continue; // sunucular: js/space/servers.js
        try { await activate(rec); } catch (e) { console.warn('Grup açılamadı:', rec.gid, e && e.message); }
      }
      started = true;
      timers.push(setInterval(() => groups.forEach(rt => sendHeartbeat(rt)), HB_EVERY));
      timers.push(setInterval(() => beaconLoop().catch(() => {}), BEACON_EVERY));
      timers.push(setInterval(() => retryPending().catch(() => {}), 60000));
      timers.push(setInterval(pruneCalls, CALL_PRUNE_EVERY));
      emit('ts:group', {});
      // Hesap kimliğine geçiş (eski cihaz anahtarıyla imzalı göç kaydı) ve
      // kendi diğer cihazlarımdan kaçırdığım anahtar dönemlerini isteme.
      setTimeout(() => migrateGroups().catch(() => {}), 500);
      setTimeout(() => askOwnEpochs(), 3000);
    })().catch(e => { console.warn('Gruplar başlatılamadı:', e && e.message); startPromise = null; });
    return startPromise;
  }

  function stop() {
    timers.forEach(t => clearInterval(t));
    timers = [];
    groups.forEach(rt => unsubscribe(rt));
    groups.clear();
    byTopic.clear();
    started = false;
    startPromise = null;
    S() && S().reset();
  }

  function onConnect() {
    groups.forEach(rt => subscribe(rt));
    if (started) setTimeout(() => askOwnEpochs(), 3000);
  }

  // acct_dev 'gkreq': kendi diğer cihazlarım daha yeni bir anahtar dönemindeyse
  // (kurucu ben değilken de) bana iletsin (js/net-settings.js).
  let lastEpochAsk = 0;
  function askOwnEpochs() {
    const now = Date.now();
    if (!started || now - lastEpochAsk < 20000 || !C().accountKeysSync()) return;
    const ns = window.TSNetSettings;
    if (!ns || typeof ns.sendOwn !== 'function' || window.state.accountKind !== 'cloud') return;
    lastEpochAsk = now;
    ns.sendOwn({ k: 'gkreq', g: ownEpochs() }).catch(() => {});
  }

  // Mesaj yedeğinden (js/msg-backup.js) depoya yazılmış bir grup kaydını açar.
  // Başlamadıysak start() zaten depodan okur.
  async function adopt(rec) {
    if (!started || !rec || rec.removed || rec.kind === 'server' || groups.get(rec.gid)) return false;
    await activate(rec);
    emit('ts:group', { gid: rec.gid });
    setTimeout(() => { lastEpochAsk = 0; askOwnEpochs(); }, 1500);
    return true;
  }

  document.addEventListener('ts:peerkeys', e => {
    const fid = e.detail && e.detail.fid;
    if (fid && started) retryPending(fid).catch(() => {});
  });

  // ---------- görünüm yardımcıları ----------
  function list() {
    return Array.from(groups.values()).filter(rt => !rt.rec.removed).map(rt => ({
      gid: rt.rec.gid, title: groupTitle(rt), members: rt.rec.members, owner: rt.rec.owner,
      unread: rt.rec.unread || 0, lastTs: rt.lastTs || rt.rec.createdAt, call: activeCall(rt),
      // Daveti gönderilmiş ama grubu aldığı henüz doğrulanmamış üyeler (fid[]).
      unconfirmed: (rt.rec.unconfirmed || []).slice(),
      inMyCall: !!(rt.myCall && inMyCallSync(rt))
    }));
  }
  const get = gid => groups.get(gid) || null;
  const totalUnread = () => Array.from(groups.values()).reduce((a, rt) => a + (rt.rec.unread || 0), 0);

  window.TSGroups = {
    start, stop, onConnect, onMqtt, onPersonalEvent, onFriendOnline, adopt, onOwnDeviceEpochs, askOwnEpochs, migrateGroups,
    createGroup, invite, kick, leave, rename, sendMessage, react, deleteMessage, sendTyping,
    startOrJoinCall, leaveCall, ringMissing, inMyCall, callRoom, activeCall: gid => { const rt = groups.get(gid); return rt ? activeCall(rt) : null; },
    myCall: gid => { const rt = groups.get(gid); return rt && rt.myCall && inMyCallSync(rt) ? { ...rt.myCall } : null; },
    unconfirmed: gid => { const rt = groups.get(gid); return rt ? (rt.rec.unconfirmed || []).slice() : []; },
    loadEvents, markRead, list, get, groupTitle: gid => { const rt = groups.get(gid); return rt ? groupTitle(rt) : ''; },
    displayName: (gid, fid) => { const rt = groups.get(gid); return rt ? displayName(rt, fid) : fid; },
    totalUnread, MAX_MEMBERS,
    _sendHeartbeat: gid => { const rt = groups.get(gid); return rt ? sendHeartbeat(rt) : null; }
  };
})();
