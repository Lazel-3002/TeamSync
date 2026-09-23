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
      syncing: 0
    };
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
    const sig = await C().sign(ev);
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
      if (source !== 'local' && !(await C().verify(m.ik, ev, sig))) continue;
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
    S().prune(rt.rec.gid).catch(() => {});
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
    if (kind === 'ev' && inner.k === 'ev') {
      await ingest(rt, [inner.ev], 'live');
    } else if (kind === 'eph') {
      onEphemeral(rt, inner);
    } else if (kind === 'to' && inner.k === 'sres' && Array.isArray(inner.events)) {
      await ingest(rt, inner.events.slice(0, BATCH * 2), 'sync');
      if (inner.done) rt.syncing = 0;
    }
  }

  function onEphemeral(rt, m) {
    const fid = m.fid;
    if (!validFid(fid) || fid === me() || !memberOf(rt, fid)) return;
    rt.online.set(fid, Date.now());
    if (m.k === 'probe') {
      setTimeout(() => sendHeartbeat(rt), 100 + Math.random() * 900);
    } else if (m.k === 'hb') {
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
    }
  }

  function sendHeartbeat(rt) {
    return sendEph(rt, { k: 'hb', epoch: rt.rec.epoch, last: rt.lastTs, n: rt.count });
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
    if (!events.length) { await pub(rt, toTopic, { k: 'sres', events: [], done: true }, 1); return; }
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

  function activeCall(rt) {
    if (!rt.call) return null;
    const now = Date.now();
    rt.call.participants.forEach((seen, fid) => { if (now - seen > CALL_STALE) rt.call.participants.delete(fid); });
    if (!rt.call.participants.size) { rt.call = null; return null; }
    return rt.call;
  }

  function onCallBeacon(rt, fid, m) {
    if (typeof m.callId !== 'string' || !Number.isFinite(m.startedAt) || !validFid(m.startedBy)) return;
    const fresh = !rt.call || rt.call.callId !== m.callId;
    if (fresh) {
      // Aynı anda iki arama başlatılırsa daha eski olan kazanır.
      if (rt.call && rt.call.participants.size && rt.call.startedAt <= m.startedAt) {
        rt.call.participants.set(fid, Date.now());
        refreshCall(rt);
        return;
      }
      rt.call = { callId: m.callId, startedAt: Math.min(m.startedAt, Date.now()), startedBy: m.startedBy, participants: new Map() };
    }
    rt.call.participants.set(fid, Date.now());
    if (rt.myCall && rt.myCall.callId !== rt.call.callId && rt.call.startedAt < rt.myCall.startedAt) {
      rt.myCall = { callId: rt.call.callId, startedAt: rt.call.startedAt, startedBy: rt.call.startedBy };
    }
    if (fresh && !rt.seenCalls.has(m.callId)) {
      rt.seenCalls.add(m.callId);
      if (!rt.myCall && !window.state.room && window.TSGroupUI) window.TSGroupUI.ring(rt.rec.gid);
    }
    refreshCall(rt);
  }

  function refreshCall(rt) {
    activeCall(rt);
    emit('ts:group-call', { gid: rt.rec.gid });
  }

  async function inMyCall(rt) {
    if (!window.state.room) return false;
    const { id } = await callRoom(rt);
    return window.state.room === id;
  }

  async function beaconLoop() {
    for (const rt of groups.values()) {
      if (rt.myCall && await inMyCall(rt)) {
        await sendEph(rt, { k: 'call', ...rt.myCall, name: window.state.myName });
        if (!rt.call || rt.call.callId !== rt.myCall.callId) {
          rt.call = { ...rt.myCall, participants: new Map() };
        }
        rt.call.participants.set(me(), Date.now());
      } else if (rt.myCall && !window.state.room) {
        // Aramadan çıkıldı
        await sendEph(rt, { k: 'callleave', callId: rt.myCall.callId });
        if (rt.call) rt.call.participants.delete(me());
        rt.myCall = null;
      }
      refreshCall(rt);
    }
  }

  async function startOrJoinCall(gid) {
    const rt = groups.get(gid);
    if (!rt || !window.TSRoom) return;
    const { id, pw } = await callRoom(rt);
    if (window.state.room === id) { window.TSShell && window.TSShell.setView('call'); return; }
    if (window.state.room) {
      const ok = typeof window.showConfirm === 'function' ? await window.showConfirm(tr('groups.leaveCurrentTitle'), tr('groups.leaveCurrentBody')) : true;
      if (!ok) return;
      window.disconnectApp();
      await sleep(400);
    }
    const ptt = localStorage.getItem('teamsync_ptt_enabled') === '1';
    const current = activeCall(rt);
    if (current && current.participants.size) {
      rt.myCall = { callId: current.callId, startedAt: current.startedAt, startedBy: current.startedBy };
      window.state.isJoining = true;
      window.showToast(tr('groups.joiningCall'), 'info');
      const ok = await window.TSRoom.start(id, pw, true, ptt, groupTitle(rt), true);
      if (!ok) { rt.myCall = null; return; }
      setTimeout(() => {
        if (window.state.room === id && window.state.isJoining && window.state.peers.size === 0) {
          window.state.isJoining = false;
          window.disconnectApp();
          rt.myCall = null;
          window.showToast(tr('groups.callGone'), 'warn');
        }
      }, 15000);
    } else {
      rt.myCall = { callId: crypto.randomUUID(), startedAt: Date.now(), startedBy: me() };
      window.state.isJoining = false;
      const ok = await window.TSRoom.start(id, pw, true, ptt, groupTitle(rt), false);
      if (!ok) { rt.myCall = null; return; }
      publishEvent(gid, 'call.start', { callId: rt.myCall.callId }).catch(() => {});
    }
    rt.call = { ...rt.myCall, participants: new Map([[me(), Date.now()]]) };
    await sendEph(rt, { k: 'call', ...rt.myCall, name: window.state.myName });
    refreshCall(rt);
  }

  function leaveCall(gid) {
    const rt = groups.get(gid);
    if (rt && rt.myCall) sendEph(rt, { k: 'callleave', callId: rt.myCall.callId });
    if (window.state.room) window.disconnectApp();
    if (rt) { rt.myCall = null; if (rt.call) rt.call.participants.delete(me()); refreshCall(rt); }
  }

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
    for (const { fid, keys } of ready) await sendInvite(rt, fid, keys);
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
    if (rt.rec.members.length >= MAX_MEMBERS) return 'full';
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
    await sendInvite(rt, fid, keys);
    rt.rec.pendingInvites = (rt.rec.pendingInvites || []).filter(x => x !== fid);
    await saveRec(rt);
    return 'sent';
  }

  async function sendInvite(rt, fid, keys) {
    const c = client();
    if (!c) return false;
    const wrapped = await wrapKeyFor(rt, keys.ek, 'grp-invite');
    const payload = {
      type: 'grp_invite', fromId: me(), fromName: window.state.myName, gid: rt.rec.gid, epoch: rt.rec.epoch,
      name: rt.rec.name, owner: rt.rec.owner, createdAt: rt.rec.createdAt,
      members: rt.rec.members.map(({ fid: f, name, ik, ek, joinedAt }) => ({ fid: f, name, ik, ek, joinedAt })),
      wrapped, ts: Date.now()
    };
    payload.sig = await C().sign(payload);
    c.publish(`teamsync/user/${fid}/events`, JSON.stringify(payload), { qos: 1 });
    return true;
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
      const payload = {
        type: 'grp_key', fromId: me(), gid: rt.rec.gid, epoch: rt.rec.epoch, name: rt.rec.name, owner: rt.rec.owner,
        members: rt.rec.members.map(({ fid: f, name, ik, ek, joinedAt }) => ({ fid: f, name, ik, ek, joinedAt })),
        wrapped, ts: Date.now()
      };
      payload.sig = await C().sign(payload);
      c.publish(`teamsync/user/${m.fid}/events`, JSON.stringify(payload), { qos: 1 });
      await sleep(40);
    }
  }

  function validMembers(list) {
    return Array.isArray(list) && list.length >= 1 && list.length <= MAX_MEMBERS
      && list.every(m => m && validFid(m.fid) && C().validKey(m.ik) && C().validKey(m.ek));
  }

  async function onPersonalEvent(data) {
    await ensureStarted();
    if (!data || !validFid(data.fromId) || typeof data.gid !== 'string' || data.gid.length > 64) return;
    const friend = window.state.friends[data.fromId];
    if (data.type === 'grp_invite') {
      // Yalnızca (engellenmemiş) arkadaşlardan davet kabul edilir.
      if (!friend || friend.temporary || friend.isMuted) return;
      if (!validMembers(data.members) || !data.members.find(m => m.fid === me())) return;
      const sender = data.members.find(m => m.fid === data.fromId);
      if (!sender) return;
      const known = C().peerKeys(data.fromId);
      if (known && known.ik !== sender.ik) return; // anahtar uyuşmazlığı
      const { sig, ...unsigned } = data;
      if (!(await C().verify(sender.ik, unsigned, sig))) return;
      if (!known) C().rememberPeer(data.fromId, { ik: sender.ik, ek: sender.ek });
      const existing = groups.get(data.gid);
      if (existing && existing.rec.epoch >= data.epoch && !existing.rec.removed) return;
      let keyInfo;
      try { keyInfo = JSON.parse(await C().unwrap(data.wrapped, data.gid, 'grp-invite')); } catch (e) { return; }
      if (!keyInfo || typeof keyInfo.key !== 'string' || keyInfo.epoch !== data.epoch) return;
      const rec = {
        gid: data.gid, name: cleanName(data.name), owner: validFid(data.owner) ? data.owner : data.fromId,
        epoch: data.epoch, key: keyInfo.key,
        members: data.members.map(m => ({ fid: m.fid, name: cleanName(m.name), ik: m.ik, ek: m.ek, joinedAt: Number(m.joinedAt) || Date.now() })),
        former: existing ? existing.rec.former || [] : [], createdAt: Number(data.createdAt) || Date.now(),
        unread: existing ? existing.rec.unread || 0 : 0, pendingInvites: [], pendingKeys: []
      };
      await S().putSpace(rec);
      const rt = await activate(rec);
      window.showToast(tr('groups.invitedToast', { name: friend.name || data.fromName || data.fromId, group: groupTitle(rt) }), 'ok');
      emit('ts:group', { gid: rec.gid });
    } else if (data.type === 'grp_key') {
      const rt = groups.get(data.gid);
      if (!rt || data.epoch <= rt.rec.epoch || data.fromId !== rt.rec.owner) return;
      const owner = memberOf(rt, data.fromId);
      if (!owner || !validMembers(data.members) || !data.members.find(m => m.fid === me())) return;
      const { sig, ...unsigned } = data;
      if (!(await C().verify(owner.ik, unsigned, sig))) return;
      let keyInfo;
      try { keyInfo = JSON.parse(await C().unwrap(data.wrapped, data.gid, 'grp-key')); } catch (e) { return; }
      if (!keyInfo || keyInfo.epoch !== data.epoch) return;
      rt.rec.key = keyInfo.key;
      rt.rec.epoch = data.epoch;
      rt.rec.members = data.members.map(m => ({ fid: m.fid, name: cleanName(m.name), ik: m.ik, ek: m.ek, joinedAt: Number(m.joinedAt) || Date.now() }));
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
    setTimeout(() => retryPending(fid).catch(() => {}), 2500);
  }

  async function retryPending(onlyFid) {
    for (const rt of groups.values()) {
      for (const fid of (rt.rec.pendingInvites || []).slice()) {
        if (onlyFid && fid !== onlyFid) continue;
        if (C().peerKeys(fid)) await invite(rt.rec.gid, fid);
      }
      if ((rt.rec.pendingKeys || []).length && rt.rec.owner === me()) await deliverKeys(rt, onlyFid);
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
      emit('ts:group', {});
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
  }

  document.addEventListener('ts:peerkeys', e => {
    const fid = e.detail && e.detail.fid;
    if (fid && started) retryPending(fid).catch(() => {});
  });

  // ---------- görünüm yardımcıları ----------
  function list() {
    return Array.from(groups.values()).filter(rt => !rt.rec.removed).map(rt => ({
      gid: rt.rec.gid, title: groupTitle(rt), members: rt.rec.members, owner: rt.rec.owner,
      unread: rt.rec.unread || 0, lastTs: rt.lastTs || rt.rec.createdAt, call: activeCall(rt)
    }));
  }
  const get = gid => groups.get(gid) || null;
  const totalUnread = () => Array.from(groups.values()).reduce((a, rt) => a + (rt.rec.unread || 0), 0);

  window.TSGroups = {
    start, stop, onConnect, onMqtt, onPersonalEvent, onFriendOnline,
    createGroup, invite, kick, leave, rename, sendMessage, react, deleteMessage, sendTyping,
    startOrJoinCall, leaveCall, inMyCall, callRoom, activeCall: gid => { const rt = groups.get(gid); return rt ? activeCall(rt) : null; },
    loadEvents, markRead, list, get, groupTitle: gid => { const rt = groups.get(gid); return rt ? groupTitle(rt) : ''; },
    displayName: (gid, fid) => { const rt = groups.get(gid); return rt ? displayName(rt, fid) : fid; },
    totalUnread, MAX_MEMBERS,
    _sendHeartbeat: gid => { const rt = groups.get(gid); return rt ? sendHeartbeat(rt) : null; }
  };
})();
