// Birebir ve toplantı aramaları (TSDirectCall).
//
// Arayan: yeni bir oda kurar (ID dc-…, rastgele şifre), karşı tarafa mevcut
// 'server_invite_received' olayını gönderir. Olaya eklenen alanlar
// (call:'direct'|'meeting', cid, title) eski istemcilerce yok sayılır; onlar
// her zamanki "seni sunucusuna davet ediyor" bildirimini görür, yani eski
// sürümlerle de arama kurulabilir.
// Aranan (yeni istemci): zil çalan bir kart görür (Kabul et / Reddet).
// Reddederse arayana 'call_decline', arayan vazgeçerse arananın kartı
// 'call_cancel' ile kapanır. Kimse 35 sn içinde katılmazsa arama biter.
// Arama ekranındaki "Aranıyor…" sahnesi js/teams/shell-teams.js'te; o,
// TSDirectCall.outgoing() ile kimin arandığını okur.
(function () {
  const $ = id => document.getElementById(id);
  const RING_MS = 35000;
  const esc = v => window.TSUI.esc(v);
  const tr = (k, v) => window.TSUI.tr(k, v);

  let outgoing = null; // { cid, fids:[], roomId, startedAt, timer, kind, title }
  let incoming = null; // { cid, fromId, name, invite, el, timer }

  const me = () => window.state.friendId;
  const friend = fid => (window.state.friends || {})[fid] || null;
  const mqttOk = () => !!(window.state.globalMqtt && window.state.globalMqtt.connected);

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }

  function publishTo(fid, payload) {
    if (!mqttOk()) return false;
    window.state.globalMqtt.publish(`teamsync/user/${fid}/events`, JSON.stringify(payload), { qos: 1 });
    return true;
  }

  function stopRing() {
    if (typeof window.stopRingLoop === 'function') window.stopRingLoop();
  }

  function inviteFids(fids, meta) {
    const st = window.state;
    fids.forEach(fid => publishTo(fid, {
      type: 'server_invite_received',
      id: me(),
      name: st.myName,
      roomId: st.room,
      password: st.password,
      call: meta.kind,
      cid: meta.cid,
      title: meta.title || ''
    }));
  }

  // ---------- Giden arama ----------
  async function startRoom(roomId, pw, title) {
    if (!window.TSRoom) return false;
    const ptt = localStorage.getItem('teamsync_ptt_enabled') === '1';
    window.state.isJoining = false;
    return window.TSRoom.start(roomId, pw, true, ptt, title, false);
  }

  // fids: aranacak arkadaşlar. kind: 'direct' (birebir) | 'meeting' (takvimden).
  async function call(fids, opts = {}) {
    fids = (Array.isArray(fids) ? fids : [fids]).filter(fid => friend(fid));
    if (!fids.length) return false;
    if (window.state.room) {
      // Zaten aramadaysak yeni oda kurmak yerine kişiyi mevcut aramaya çağır.
      inviteToCurrent(fids, opts);
      if (window.TSShell) window.TSShell.setView('call');
      return true;
    }
    if (!mqttOk()) { window.showToast(tr('call.connectionIssue'), 'warn'); return false; }
    const kind = opts.kind || 'direct';
    const f0 = friend(fids[0]);
    if (kind === 'direct' && fids.length === 1 && !f0.online) {
      window.showToast(tr('call.friendOffline', { name: f0.name || fids[0] }), 'warn');
    }
    const title = opts.title || (fids.length === 1
      ? tr('call.withName', { a: window.state.myName || '', b: f0.name || '' })
      : `${window.state.myName || ''} · ${fids.length + 1}`);
    const roomId = `dc-${randomHex(8)}`;
    const pw = randomHex(12);
    const cid = crypto.randomUUID();
    if (window.TSCallLog) {
      window.TSCallLog.expect({
        roomId, kind: kind === 'meeting' ? 'room' : 'direct', dir: 'out', title,
        target: fids.length === 1 ? { fid: fids[0], name: f0.name || '' } : null
      });
    }
    outgoing = { cid, fids, roomId, startedAt: Date.now(), kind, title, answered: false };
    document.dispatchEvent(new CustomEvent('ts:direct-call'));
    const ok = await startRoom(roomId, pw, title);
    if (!ok || window.state.room !== roomId) { outgoing = null; document.dispatchEvent(new CustomEvent('ts:direct-call')); return false; }
    inviteFids(fids, { kind, cid, title });
    if (typeof window.startRingLoop === 'function') window.startRingLoop('ringback', RING_MS);
    outgoing.timer = setTimeout(() => noAnswer(cid), RING_MS);
    return true;
  }

  // "Toplantı" → oda kur: kimseyi aramadan, ID'si paylaşılabilen şifresiz bir
  // oda açar (Takvim'den başlatılırsa davetlilere zil çalar).
  async function meet(title, fids = []) {
    if (window.state.room) {
      if (fids.length) inviteToCurrent(fids, { kind: 'meeting', title });
      if (window.TSShell) window.TSShell.setView('call');
      return true;
    }
    if (!mqttOk()) { window.showToast(tr('call.connectionIssue'), 'warn'); return false; }
    const roomId = `ts-${randomHex(4)}-${randomHex(2)}-${randomHex(2)}`;
    const name = title || tr('meet.defaultTitle', { name: window.state.myName || '' });
    if (window.TSCallLog) window.TSCallLog.expect({ roomId, kind: 'room', dir: 'out', title: name });
    const ok = await startRoom(roomId, '', name);
    if (!ok || window.state.room !== roomId) return false;
    const invitees = fids.filter(fid => friend(fid));
    if (invitees.length) {
      const cid = crypto.randomUUID();
      outgoing = { cid, fids: invitees, roomId, startedAt: Date.now(), kind: 'meeting', title: name, answered: false };
      inviteFids(invitees, { kind: 'meeting', cid, title: name });
      outgoing.timer = setTimeout(() => {
        // Toplantıda kimse gelmese de oda kapanmaz; yalnızca "Aranıyor…" biter.
        if (outgoing && outgoing.cid === cid && !outgoing.answered) { outgoing.answered = true; stopRing(); document.dispatchEvent(new CustomEvent('ts:direct-call')); }
      }, RING_MS);
      document.dispatchEvent(new CustomEvent('ts:direct-call'));
    }
    return true;
  }

  function inviteToCurrent(fids, opts = {}) {
    if (!window.state.room) return;
    const cid = (outgoing && outgoing.roomId === window.state.room && outgoing.cid) || crypto.randomUUID();
    inviteFids(fids, { kind: opts.kind || 'direct', cid, title: opts.title || window.state.roomName || '' });
    window.showToast(tr('toast.inviteSent'), 'ok');
  }

  function answered() {
    if (!outgoing || outgoing.answered) return;
    outgoing.answered = true;
    clearTimeout(outgoing.timer);
    stopRing();
    document.dispatchEvent(new CustomEvent('ts:direct-call'));
  }

  function noAnswer(cid) {
    if (!outgoing || outgoing.cid !== cid || outgoing.answered) return;
    stopRing();
    const names = outgoing.fids.map(fid => (friend(fid) || {}).name || fid).join(', ');
    outgoing.fids.forEach(fid => publishTo(fid, { type: 'call_cancel', fromId: me(), cid }));
    outgoing = null;
    window.showToast(tr('call.noAnswer', { name: names }), 'warn');
    if (window.state.room && window.state.peers.size === 0 && typeof window.disconnectApp === 'function') window.disconnectApp();
    document.dispatchEvent(new CustomEvent('ts:direct-call'));
  }

  // Arama bitti (biz ayrıldık): cevap gelmeden ayrıldıysak karşı tarafın zilini sustur.
  function onCallEnded() {
    stopRing();
    if (!outgoing) return;
    clearTimeout(outgoing.timer);
    if (!outgoing.answered) outgoing.fids.forEach(fid => publishTo(fid, { type: 'call_cancel', fromId: me(), cid: outgoing.cid }));
    outgoing = null;
    document.dispatchEvent(new CustomEvent('ts:direct-call'));
  }

  // ---------- Gelen arama ----------
  // renderer.js 'server_invite_received' içinde data.call varsa buraya gelir.
  function onIncoming(data) {
    if (!data || !data.id || !friend(data.id)) return false;
    if (window.state.room && window.state.room === data.roomId) return true;
    dismissIncoming();
    const f = friend(data.id);
    const name = (typeof window.getNickname === 'function' && window.getNickname(data.id)) || f.name || data.name || data.id;
    const el = document.createElement('div');
    el.className = 'dc-ring';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('data-i18n-ignore', '');
    const sub = data.call === 'meeting' && data.title ? data.title : tr('call.incoming');
    el.innerHTML = `
      <div class="dc-ring-av">${window.TSUI.avatarHtml({ src: f.avatar, name, seed: data.id, size: 56 })}</div>
      <div class="dc-ring-copy">
        <strong>${esc(tr('call.incomingFrom', { name }))}</strong>
        <small>${esc(sub)}</small>
      </div>
      <div class="dc-ring-actions">
        <button type="button" class="dc-ring-btn is-decline" data-dc="decline" title="${esc(tr('call.decline'))}" aria-label="${esc(tr('call.decline'))}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/></svg></button>
        <button type="button" class="dc-ring-btn is-accept" data-dc="accept" title="${esc(tr('call.accept'))}" aria-label="${esc(tr('call.accept'))}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></button>
      </div>`;
    document.body.appendChild(el);
    const invite = { id: data.id, name: data.name, roomId: data.roomId, password: data.password };
    incoming = { cid: data.cid, fromId: data.id, name, invite, el, kind: data.call, title: data.title || '' };
    incoming.timer = setTimeout(() => missed(data.cid), RING_MS);
    const dnd = window.TSStatus && window.TSStatus.effective && window.TSStatus.effective() === 'dnd';
    if (!dnd && typeof window.startRingLoop === 'function') window.startRingLoop('ring', RING_MS);
    if (typeof window.notify === 'function') { try { window.notify(tr('call.incomingFrom', { name }), sub); } catch (e) {} }
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-dc]');
      if (!b) return;
      if (b.dataset.dc === 'accept') accept(); else decline();
    });
    requestAnimationFrame(() => el.classList.add('show'));
    return true;
  }

  function dismissIncoming() {
    if (!incoming) return;
    clearTimeout(incoming.timer);
    stopRing();
    const el = incoming.el;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
    incoming = null;
  }

  function logIncoming(inc, dir) {
    if (!window.TSCallLog) return;
    window.TSCallLog.add({
      kind: inc.kind === 'meeting' ? 'room' : 'direct', dir, title: inc.title || '',
      roomId: inc.invite.roomId, start: Date.now(), end: Date.now(),
      peers: [{ fid: inc.fromId, name: inc.name }]
    });
  }

  function accept() {
    if (!incoming) return;
    const inc = incoming;
    dismissIncoming();
    if (window.TSCallLog) {
      window.TSCallLog.expect({
        roomId: String(inc.invite.roomId || '').toLowerCase(), kind: inc.kind === 'meeting' ? 'room' : 'direct', dir: 'in',
        title: inc.title || '', target: { fid: inc.fromId, name: inc.name }
      });
    }
    if (typeof window.acceptServerInvite === 'function') window.acceptServerInvite(inc.invite);
  }

  function decline() {
    if (!incoming) return;
    const inc = incoming;
    dismissIncoming();
    publishTo(inc.fromId, { type: 'call_decline', fromId: me(), cid: inc.cid });
    logIncoming(inc, 'declined');
  }

  function missed(cid) {
    if (!incoming || incoming.cid !== cid) return;
    const inc = incoming;
    dismissIncoming();
    logIncoming(inc, 'missed');
  }

  // call_decline / call_cancel (renderer.js kişisel olay kanalından)
  function onEvent(data) {
    if (!data || !data.fromId) return;
    if (data.type === 'call_cancel' && incoming && incoming.cid === data.cid && incoming.fromId === data.fromId) {
      missed(data.cid);
      return;
    }
    if (data.type === 'call_decline' && outgoing && outgoing.cid === data.cid && outgoing.fids.includes(data.fromId)) {
      const name = (friend(data.fromId) || {}).name || data.fromId;
      outgoing.fids = outgoing.fids.filter(fid => fid !== data.fromId);
      window.showToast(tr('call.declined', { name }), 'warn');
      if (!outgoing.fids.length && !outgoing.answered) {
        clearTimeout(outgoing.timer);
        stopRing();
        outgoing = null;
        if (window.state.room && window.state.peers.size === 0 && typeof window.disconnectApp === 'function') window.disconnectApp();
      }
      document.dispatchEvent(new CustomEvent('ts:direct-call'));
    }
  }

  // Biri bağlanınca zil susar ("Aranıyor…" sahnesi kalkar). Birebir (dc-)
  // odada karşı taraf ayrılıp 4 sn dönmezse arama Teams'teki gibi kendiliğinden biter.
  let directSeenPeer = false;
  let directEmptySince = 0;
  setInterval(() => {
    const st = window.state;
    if (outgoing && !outgoing.answered && st.room === outgoing.roomId && st.peers && st.peers.size > 0) answered();
    const direct = !!st.room && String(st.room).startsWith('dc-');
    if (!direct) { directSeenPeer = false; directEmptySince = 0; return; }
    // Oda kodu kopan eşi ancak ~12 sn sessizlikten sonra düşürür; birebirde
    // bağlantısı kopmuş (ICE failed/closed ya da 6 sn'dir sessiz + disconnected)
    // eşi şimdiden gitmiş say.
    const now = Date.now();
    let n = 0;
    if (st.peers) st.peers.forEach(p => {
      const ice = p && p.pc ? p.pc.iceConnectionState : null;
      const dead = ice === 'failed' || ice === 'closed' || (ice === 'disconnected' && p.lastSeen && now - p.lastSeen > 6000);
      if (!dead) n++;
    });
    if (n > 0) { directSeenPeer = true; directEmptySince = 0; return; }
    if (!directSeenPeer) return;
    if (!directEmptySince) { directEmptySince = Date.now(); return; }
    if (Date.now() - directEmptySince > 4000 && typeof window.disconnectApp === 'function') {
      directSeenPeer = false;
      directEmptySince = 0;
      window.disconnectApp();
      window.showToast(tr('call.ended'), 'info');
    }
  }, 700);

  document.addEventListener('ts:call', e => { if (!(e.detail && e.detail.active)) onCallEnded(); });
  document.addEventListener('keydown', e => {
    if (!incoming) return;
    if (e.key === 'Escape') decline();
  });

  window.TSDirectCall = {
    call, meet, inviteToCurrent, onIncoming, onEvent,
    outgoing: () => (outgoing && window.state.room === outgoing.roomId ? outgoing : null),
    incoming: () => incoming
  };
})();
