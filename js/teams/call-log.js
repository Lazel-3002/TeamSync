// Arama geçmişi (TSCallLog): bu cihazda, hesap başına localStorage'da tutulur.
// Hiçbir şey sunucuya gitmez (bkz. HANDOFF.md: sohbet/arama içeriği bulutta
// tutulmaz).
//
// Kayıtlar iki yoldan gelir:
//   • Oturum izleme: kabuk 'ts:call' olayıyla arama başladığını/bittiğini
//     bildirir; bu dosya aramadaki arkadaşları (peer.friendId) toplar ve
//     bitişte süresiyle birlikte kaydeder. Oda türü ID önekinden çıkar:
//     dc- birebir, gc- grup, sv- sunucu ses kanalı, diğerleri klasik oda.
//   • Açık kayıt: js/teams/direct-call.js cevapsız / reddedilen gelen
//     aramaları (oturum hiç açılmadan) add() ile yazar; giden aramanın yönü
//     ve kime yapıldığı expect() ile önceden bildirilir.
(function () {
  const KEY = fid => `teamsync_call_log_${fid}`;
  const SEEN_KEY = fid => `teamsync_call_log_seen_${fid}`;
  const MAX = 200;
  let cache = null;
  let cacheFor = null;
  let session = null;
  let pending = null;
  let sampler = null;

  const me = () => (window.state && window.state.friendId) || '';

  function load() {
    const fid = me();
    if (!fid) return [];
    if (cacheFor === fid && cache) return cache;
    cacheFor = fid;
    try { cache = JSON.parse(localStorage.getItem(KEY(fid)) || '[]'); } catch (e) { cache = []; }
    if (!Array.isArray(cache)) cache = [];
    return cache;
  }

  function save() {
    const fid = me();
    if (!fid || !cache) return;
    cache = cache.sort((a, b) => b.start - a.start).slice(0, MAX);
    try { localStorage.setItem(KEY(fid), JSON.stringify(cache)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('ts:calllog'));
  }

  function kindOf(roomId) {
    const id = String(roomId || '');
    if (id.startsWith('dc-')) return 'direct';
    if (id.startsWith('gc-')) return 'group';
    if (id.startsWith('sv-')) return 'server';
    return 'room';
  }

  function add(entry) {
    const list = load();
    const e = Object.assign({ id: crypto.randomUUID(), start: Date.now(), end: 0, peers: [], dir: 'out', kind: 'room' }, entry);
    list.unshift(e);
    save();
    return e.id;
  }

  function update(id, patch) {
    const e = load().find(x => x.id === id);
    if (!e) return;
    Object.assign(e, patch);
    save();
  }

  function clear() {
    cache = [];
    save();
  }

  // Bir sonraki arama oturumuna eklenecek bilgi (yön, birebir aramadaki kişi).
  function expect(meta) {
    pending = Object.assign({ at: Date.now() }, meta);
  }

  function peersNow() {
    const out = [];
    const peers = (window.state && window.state.peers) || new Map();
    peers.forEach(p => {
      if (!p) return;
      const fid = p.friendId || null;
      out.push({ fid, name: p.name || '' });
    });
    return out;
  }

  function sample() {
    if (!session) return;
    peersNow().forEach(p => {
      const key = p.fid || `n:${p.name}`;
      if (!session.seen[key]) session.seen[key] = p;
      else if (p.name) session.seen[key].name = p.name;
    });
    if (peersNow().length && !session.connectedAt) session.connectedAt = Date.now();
  }

  function begin() {
    const st = window.state || {};
    const roomId = st.room || '';
    const meta = pending && Date.now() - pending.at < 60000 && (!pending.roomId || pending.roomId === roomId) ? pending : null;
    pending = null;
    session = {
      id: crypto.randomUUID(),
      roomId,
      kind: (meta && meta.kind) || kindOf(roomId),
      dir: (meta && meta.dir) || (st.isJoining ? 'in' : 'out'),
      title: (meta && meta.title) || st.roomName || '',
      target: (meta && meta.target) || null,
      start: Date.now(),
      connectedAt: 0,
      seen: {}
    };
    if (session.target) session.seen[session.target.fid] = { fid: session.target.fid, name: session.target.name || '' };
    clearInterval(sampler);
    sampler = setInterval(sample, 3000);
    setTimeout(sample, 800);
  }

  function finish() {
    if (!session) return;
    sample();
    clearInterval(sampler);
    sampler = null;
    const s = session;
    session = null;
    const peers = Object.values(s.seen).filter(p => p.fid !== me()).slice(0, 12);
    add({
      id: s.id, kind: s.kind, dir: s.dir, title: s.title, roomId: s.roomId,
      start: s.start, end: Date.now(), connectedAt: s.connectedAt || 0,
      answered: !!s.connectedAt, peers
    });
  }

  // Cevapsız gelen aramalar "Aramalar" rozetinde sayılır; görünüm açılınca sıfırlanır.
  function unseenMissed() {
    const fid = me();
    if (!fid) return 0;
    let seen = 0;
    try { seen = Number(localStorage.getItem(SEEN_KEY(fid)) || 0); } catch (e) {}
    return load().filter(e => e.dir === 'missed' && e.start > seen).length;
  }

  function markSeen() {
    const fid = me();
    if (!fid) return;
    try { localStorage.setItem(SEEN_KEY(fid), String(Date.now())); } catch (e) {}
    document.dispatchEvent(new CustomEvent('ts:calllog'));
  }

  document.addEventListener('ts:call', e => {
    if (e.detail && e.detail.active) begin(); else finish();
  });
  window.addEventListener('beforeunload', finish);

  window.TSCallLog = {
    list: () => load().slice(), add, update, clear, expect, kindOf, unseenMissed, markSeen,
    current: () => session
  };
})();
