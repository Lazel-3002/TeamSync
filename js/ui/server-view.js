// Sunucu arayüzü: raydaki sunucu simgeleri, sol sütunda kanal listesi (ses
// kanallarında kim var + süre), metin kanalı görünümü (gruplanmış mesajlar,
// yanıt, düzenleme, tepki, yavaş mod), rollere göre gruplanmış üye listesi ve
// üye kartı. Motor: js/space/servers.js · pencereler: js/ui/server-dialogs.js
(function () {
  const $ = id => document.getElementById(id);
  const esc = v => window.TSUI.esc(v);
  const tr = (k, v) => window.TSUI.tr(k, v);
  const X = () => window.TSServers;
  const SS = () => window.TSServerState;
  const D = () => window.TSServerDialogs;
  const me = () => window.state.friendId;
  const GROUP_GAP = 7 * 60 * 1000;
  const PANEL_KEY = 'teamsync_server_members_panel';
  let activeSid = null;   // sol sütunda gösterilen sunucu
  let viewSid = null;     // ana alanda açık sunucu
  let viewCh = null;
  let renderToken = 0;
  let replyTo = null;     // { id, author, text }
  let editing = null;     // mesaj id
  const cooldown = new Map(); // `${sid}|${ch}` -> bitiş zamanı
  let cooldownTimer = null;

  const ICON = {
    hash: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
    voice: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-2.82-1.17l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.1 14H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.17-2.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9.9 3.1V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.9 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/></svg>',
    deaf: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 3-6.7"/><path d="M9.5 3.3A9 9 0 0 1 21 12v7"/></svg>',
    crown: '<svg viewBox="0 0 24 24" width="14" height="14" fill="#f0b232" stroke="none"><path d="M2 7l5 5 5-8 5 8 5-5-2 12H4z"/></svg>',
    host: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><line x1="6" y1="6.5" x2="6.01" y2="6.5"/><line x1="6" y1="17.5" x2="6.01" y2="17.5"/></svg>',
    react: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    reply: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
  };

  // ---------- yardımcılar ----------
  function initials(name) {
    const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toLocaleUpperCase('tr');
  }
  function serverIconHtml(name, icon, size = 48, seed) {
    if (icon && SS().validIcon(icon)) return `<img class="srv-icon-img" src="${esc(icon)}" alt="" draggable="false" style="width:${size}px;height:${size}px" />`;
    return `<span class="srv-icon-initials" style="background:${window.TSUI.colorFromString(seed || name)};font-size:${Math.round(size * 0.36)}px">${esc(initials(name))}</span>`;
  }

  const rtOf = sid => X() && X().get(sid);
  const stOf = sid => { const rt = rtOf(sid); return rt ? rt.st : null; };
  const P = () => SS().P;
  function permsIn(sid, ch) {
    const st = stOf(sid);
    return st ? (ch ? SS().channelPerms(st, me(), ch) : SS().basePerms(st, me())) : 0;
  }
  const can = (sid, bit, ch) => SS().has(permsIn(sid, ch), bit);
  function canManageAnything(sid) {
    const p = permsIn(sid);
    return [P().MANAGE_SERVER, P().MANAGE_ROLES, P().MANAGE_CHANNELS, P().KICK_MEMBERS, P().BAN_MEMBERS].some(b => SS().has(p, b));
  }

  function memberAvatar(sid, fid, size, withStatus) {
    const pres = X().memberPresence(sid, fid) || {};
    const name = X().memberName(sid, fid);
    const isMe = fid === me();
    const prof = window.TSProfile ? (isMe ? window.TSProfile.mine() : window.TSProfile.profileOf(fid)) : null;
    return window.TSUI.avatarHtml({
      src: isMe ? window.state.myAvatar : pres.av, name, seed: fid, size,
      status: withStatus ? (pres.online ? pres.st || 'online' : 'offline') : null,
      frame: prof && prof.frame, color: prof && prof.avatarColor
    });
  }

  function nameStyle(st, fid) {
    const color = st ? SS().memberColor(st, fid) : '';
    return color ? ` style="color:${esc(color)}"` : '';
  }

  function fmtTime(ts) {
    return typeof window.formatUserTime === 'function' ? window.formatUserTime(new Date(ts)) : new Date(ts).toLocaleTimeString();
  }

  // ---------- ray ----------
  function renderRail() {
    const host = $('rail-spaces');
    if (!host || !X()) return;
    const list = X().list();
    host.innerHTML = list.map(s => `
      <button type="button" class="rail-btn rail-server ${s.sid === activeSid ? 'active' : ''} ${s.online ? '' : 'is-offline'} ${s.unread ? 'has-unread' : ''}"
        data-sid="${esc(s.sid)}" title="${esc(s.name)}${s.online ? '' : ` — ${esc(tr('servers.offlineShort'))}`}" data-i18n-ignore>
        <span class="rail-pill"></span>
        <span class="rail-icon">${serverIconHtml(s.name, s.icon, 48, s.sid)}</span>
        ${s.mentions ? `<span class="rail-badge">${s.mentions > 99 ? '99+' : s.mentions}</span>` : ''}
      </button>`).join('') + (list.length ? '<div class="rail-sep rail-sep-servers"></div>' : '');
  }

  // ---------- sol sütun: kanal listesi ----------
  function setActiveServer(sid) {
    const changed = activeSid !== sid;
    activeSid = sid || null;
    if (changed) { renderRail(); renderSide(); }
  }

  function renderSide() {
    const sid = activeSid;
    const rt = sid && rtOf(sid);
    const nameEl = $('ss-name');
    const scroll = $('ss-scroll');
    const banner = $('ss-banner');
    if (!nameEl || !scroll) return;
    if (!rt) { nameEl.textContent = ''; scroll.innerHTML = ''; return; }
    const st = rt.st;
    nameEl.textContent = (st && st.name) || rt.rec.name || '';
    if (!st || !st.members[me()]) {
      scroll.innerHTML = `<div class="ss-empty">${esc(tr('servers.syncing'))}</div>`;
      renderBanner(sid, banner);
      return;
    }
    const online = X().isOnline(sid);
    const manage = can(sid, P().MANAGE_CHANNELS);
    const unread = rt.rec.unread || {};
    const mentions = rt.rec.mentions || {};
    const text = SS().visibleChannels(st, me(), 'text');
    const voice = SS().visibleChannels(st, me(), 'voice');
    const myVc = X().myVoiceChannel();
    const isPrivate = ch => { const o = ch.overrides && ch.overrides.everyone; return !!(o && (o.d & P().VIEW_CHANNEL)); };
    const head = (label, kind) => `
      <div class="ss-section">
        <span>${esc(label)}</span>
        ${manage ? `<button type="button" class="ss-add" data-add-ch="${kind}" title="${esc(tr('servers.createChannel'))}">${ICON.plus}</button>` : ''}
      </div>`;
    const textRows = text.map(ch => `
      <div class="ss-ch ${viewSid === sid && viewCh === ch.id ? 'active' : ''} ${unread[ch.id] ? 'has-unread' : ''}" data-ch="${esc(ch.id)}" data-kind="text" role="button" tabindex="0">
        <span class="ss-ch-icon">${ICON.hash}${isPrivate(ch) ? `<i class="ss-lock">${ICON.lock}</i>` : ''}</span>
        <span class="ss-ch-name">${esc(ch.name)}</span>
        ${mentions[ch.id] ? `<span class="ts-count-badge">${mentions[ch.id]}</span>` : ''}
        ${manage ? `<button type="button" class="ss-ch-gear" data-ch-settings="${esc(ch.id)}" title="${esc(tr('servers.editChannel'))}">${ICON.gear}</button>` : ''}
      </div>`).join('');
    const voiceRows = voice.map(ch => {
      const people = X().voiceOf(sid, ch.id);
      return `
      <div class="ss-ch ss-voice ${myVc && myVc.sid === sid && myVc.ch === ch.id ? 'is-connected' : ''}" data-ch="${esc(ch.id)}" data-kind="voice" role="button" tabindex="0">
        <span class="ss-ch-icon">${ICON.voice}${isPrivate(ch) ? `<i class="ss-lock">${ICON.lock}</i>` : ''}</span>
        <span class="ss-ch-name">${esc(ch.name)}</span>
        ${manage ? `<button type="button" class="ss-ch-gear" data-ch-settings="${esc(ch.id)}" title="${esc(tr('servers.editChannel'))}">${ICON.gear}</button>` : ''}
      </div>
      ${people.length ? `<ul class="ss-voice-people">${people.map(p => `
        <li class="ss-vp" data-member="${esc(p.fid)}">
          ${memberAvatar(sid, p.fid, 24, false)}
          <span class="ss-vp-name"${nameStyle(st, p.fid)}>${esc(X().memberName(sid, p.fid))}</span>
          ${p.live ? `<span class="ss-live">${esc(tr('servers.live'))}</span>` : ''}
          <span class="ss-vp-icons">${p.deaf ? ICON.deaf : p.mute ? ICON.micOff : ''}</span>
          ${window.TSUI.sinceHtml(p.since, 'ss-vp-time')}
        </li>`).join('')}</ul>` : ''}`;
    }).join('');
    scroll.classList.toggle('is-offline', !online);
    scroll.innerHTML = `
      ${head(tr('servers.textChannels'), 'text')}${textRows || `<div class="ss-empty-small">${esc(tr('servers.noTextChannels'))}</div>`}
      ${head(tr('servers.voiceChannels'), 'voice')}${voiceRows || `<div class="ss-empty-small">${esc(tr('servers.noVoiceChannels'))}</div>`}`;
    renderBanner(sid, banner);
  }

  function renderBanner(sid, banner) {
    if (!banner) return;
    const rt = rtOf(sid);
    const st = rt && rt.st;
    if (st && st.hostOffers.includes(me())) {
      banner.className = 'ss-banner is-offer';
      banner.innerHTML = `
        <strong>${esc(tr('servers.hostOfferTitle'))}</strong>
        <span>${esc(tr('servers.hostOfferBody', { name: X().memberName(sid, st.owner) }))}</span>
        <div class="ss-banner-actions">
          <button type="button" class="btn-pri btn-sm" data-host-offer="accept">${esc(tr('servers.accept'))}</button>
          <button type="button" class="btn-sec btn-sm" data-host-offer="decline">${esc(tr('servers.decline'))}</button>
        </div>`;
      return;
    }
    if (rt && !X().isOnline(sid)) {
      banner.className = 'ss-banner is-offline';
      banner.innerHTML = `<strong>${esc(tr('servers.offlineTitle'))}</strong><span>${esc(tr('servers.offlineBody'))}</span>`;
      return;
    }
    banner.className = 'ss-banner hidden';
    banner.innerHTML = '';
  }

  // ---------- sunucu menüsü (başlığa tıklayınca) ----------
  function openServerMenu(anchor) {
    const sid = activeSid;
    const st = stOf(sid);
    if (!st) return;
    const isOwner = st.owner === me();
    const items = [];
    if (can(sid, P().CREATE_INVITE)) items.push(['invite', tr('servers.invitePeople'), 'is-accent']);
    if (canManageAnything(sid)) items.push(['settings', tr('servers.settings')]);
    if (can(sid, P().MANAGE_CHANNELS)) items.push(['channel', tr('servers.createChannel')]);
    items.push(['hosting', tr('servers.hosting')]);
    items.push(['nick', tr('servers.changeNick')]);
    items.push(['read', tr('servers.markRead')]);
    items.push(isOwner ? ['delete', tr('servers.deleteServer'), 'is-danger'] : ['leave', tr('servers.leave'), 'is-danger']);
    const html = `<div class="ts-menu srv-menu">${items.map(([k, label, cls]) => `<button type="button" class="ts-menu-item ${cls || ''}" data-srv-menu="${k}">${esc(label)}</button>`).join('')}</div>`;
    const pop = window.TSUI.popover(html, anchor, { placement: 'bottom', cls: 'ts-menu-pop srv-menu-pop' });
    pop.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-srv-menu]');
      if (!b) return;
      pop.close();
      const k = b.dataset.srvMenu;
      if (k === 'invite') D().openInvite(sid);
      else if (k === 'settings') D().openSettings(sid);
      else if (k === 'channel') D().openCreateChannel(sid, 'text');
      else if (k === 'hosting') D().openSettings(sid, 'hosting');
      else if (k === 'nick') {
        const cur = (st.members[me()] || {}).name || '';
        const name = await window.showPrompt(tr('servers.changeNick'), tr('servers.changeNickDesc'), cur, cur);
        if (name != null && name.trim() && name.trim() !== cur) run(() => X().renameSelf(sid, name.trim()));
      } else if (k === 'read') {
        Object.keys(st.channels).forEach(ch => X().markRead(sid, ch));
        renderSide();
      } else if (k === 'leave') {
        if (await window.showConfirm(tr('servers.leave'), tr('servers.leaveConfirm', { name: st.name }))) {
          await X().leave(sid).catch(() => {});
          window.TSShell.setView('friends');
        }
      } else if (k === 'delete') {
        if (await window.showConfirm(tr('servers.deleteServer'), tr('servers.deleteConfirm', { name: st.name }))) run(() => X().deleteServer(sid));
      }
    });
  }

  // Motor eylemlerini çalıştırır, hatayı anlaşılır bir bildirime çevirir.
  async function run(fn) {
    try { return await fn(); } catch (e) { showError(e); return null; }
  }
  function showError(e) {
    const reason = (e && (e.reason || e.message)) || 'error';
    if (reason === 'slow') return;
    const key = {
      offline: 'servers.errOffline', perm: 'servers.errPerm', timeout: 'servers.errTimeout', clock: 'servers.errClock',
      invite: 'servers.errInvite', banned: 'servers.errBanned', notfound: 'servers.errNotFound', owner: 'servers.errOwner',
      network: 'servers.errNetwork'
    }[reason] || 'servers.errGeneric';
    window.showToast(tr(key), 'danger');
  }

  // ---------- metin kanalı görünümü ----------
  function pickChannel(sid) {
    const rt = rtOf(sid);
    const st = rt && rt.st;
    if (!st || !st.members[me()]) return null;
    const visible = SS().visibleChannels(st, me(), 'text');
    if (rt.rec.lastCh && visible.some(c => c.id === rt.rec.lastCh)) return rt.rec.lastCh;
    return visible.length ? visible[0].id : null;
  }

  function show(sid, ch) {
    if (!X() || !rtOf(sid)) return;
    const changedServer = viewSid !== sid;
    viewSid = sid;
    const next = ch || (changedServer || !viewCh ? pickChannel(sid) : viewCh);
    const changed = next !== viewCh || changedServer;
    viewCh = next;
    if (changed) { replyTo = null; editing = null; }
    setActiveServer(sid);
    renderHeader();
    renderComposer();
    renderMembers();
    renderMessages(true);
    renderTyping();
    renderSide();
    if (viewCh) {
      X().openChannel(sid, viewCh).then(() => { if (viewSid === sid) renderMessages(false); });
      if (changed) setTimeout(() => { const input = $('srv-input'); if (input && !input.disabled) input.focus(); }, 30);
    }
    renderRail();
  }

  function viewingChannel(sid) {
    if (!window.TSShell || window.TSShell.view() !== 'server' || viewSid !== sid || !document.hasFocus()) return null;
    return viewCh;
  }

  function renderHeader() {
    const st = stOf(viewSid);
    const ch = st && viewCh && st.channels[viewCh];
    const name = $('srvh-name');
    const topic = $('srvh-topic');
    if (name) name.textContent = ch ? ch.name : ((st && st.name) || '');
    if (topic) {
      topic.textContent = ch && ch.topic ? ch.topic : '';
      topic.title = topic.textContent;
    }
    const inviteBtn = $('srv-invite-btn');
    if (inviteBtn) inviteBtn.classList.toggle('hidden', !st || !can(viewSid, P().CREATE_INVITE));
    document.querySelector('.srvh-hash')?.classList.toggle('hidden', !ch);
  }

  function buildModel(events) {
    const deleted = new Set();
    const edits = {};
    const reactions = {};
    const byId = {};
    events.forEach(e => { if (e.type === 'msg') byId[e.id] = e; });
    events.forEach(e => {
      if (e.type === 'msg.del') deleted.add(e.body.target);
      else if (e.type === 'msg.edit') {
        const t = byId[e.body.target];
        if (t && t.author === e.author && (!edits[e.body.target] || edits[e.body.target].ts < e.ts)) edits[e.body.target] = e;
      } else if (e.type === 'react') {
        const byE = (reactions[e.body.target] = reactions[e.body.target] || {});
        const set = (byE[e.body.e] = byE[e.body.e] || new Set());
        if (e.body.op === 'remove') set.delete(e.author); else set.add(e.author);
      }
    });
    return { deleted, edits, reactions, byId };
  }

  function reactionsHtml(targetId, byEmoji) {
    if (!byEmoji) return '';
    const chips = Object.entries(byEmoji).filter(([, set]) => set.size).map(([e, set]) =>
      `<button type="button" class="rx ${set.has(me()) ? 'rx-mine' : ''}" data-srx="${esc(e)}" data-mid="${esc(targetId)}"><span class="rx-e">${esc(e)}</span><span class="rx-n">${set.size}</span></button>`).join('');
    return chips ? `<div class="rx-row">${chips}</div>` : '';
  }

  // Metin: HTML kaçışı + @anmalar + davet kartları
  function textHtml(sid, text) {
    let html = esc(text);
    const myName = window.state.myName;
    html = html.replace(/@([\p{L}\p{N}_.-]{2,40})/gu, (m, n) => {
      const mine = myName && n.toLocaleLowerCase('tr') === myName.toLocaleLowerCase('tr');
      const all = ['everyone', 'herkes'].includes(n.toLocaleLowerCase('tr'));
      return `<span class="srv-mention ${mine || all ? 'is-me' : ''}">${m}</span>`;
    });
    return html;
  }

  function inviteCardHtml(text) {
    const codes = [];
    String(text || '').replace(/teamsync:\/\/invite\/([A-HJ-NP-Z2-9]{10})/gi, (m, c) => { if (!codes.includes(c.toUpperCase())) codes.push(c.toUpperCase()); return m; });
    return codes.slice(0, 3).map(c => `<div class="inv-card" data-invite="${esc(c)}" data-i18n-ignore><div class="inv-card-label">${esc(tr('servers.inviteCardLabel'))}</div><div class="inv-card-body"><span class="inv-card-icon"></span><span class="inv-card-copy"><strong>${esc(tr('servers.inviteLoading'))}</strong><small></small></span><button type="button" class="btn-pri btn-sm inv-card-btn" disabled>${esc(tr('servers.joinShort'))}</button></div></div>`).join('');
  }

  async function renderMessages(forceBottom) {
    const sid = viewSid;
    const ch = viewCh;
    const host = $('srv-messages');
    if (!host) return;
    const rt = rtOf(sid);
    const st = rt && rt.st;
    if (!st || !st.members[me()]) {
      host.innerHTML = `<div class="srv-empty"><div class="srv-empty-icon">${serverIconHtml(rt ? rt.rec.name : '', rt ? rt.rec.icon : '', 80, sid)}</div><h2>${esc(rt ? rt.rec.name : '')}</h2><p>${esc(tr('servers.syncingLong'))}</p></div>`;
      return;
    }
    if (!ch) {
      host.innerHTML = `<div class="srv-empty"><div class="srv-empty-icon">${serverIconHtml(st.name, st.icon, 80, sid)}</div><h2>${esc(st.name)}</h2><p>${esc(tr('servers.noChannelsVisible'))}</p></div>`;
      return;
    }
    const token = ++renderToken;
    const events = await X().channelEvents(sid, ch, { newest: true, limit: 400 });
    if (token !== renderToken || sid !== viewSid || ch !== viewCh) return;
    const nearBottom = host.scrollHeight - host.clientHeight - host.scrollTop < 80;
    const prevHeight = host.scrollHeight;
    const prevTop = host.scrollTop;
    const { deleted, edits, reactions, byId } = buildModel(events);
    const channel = st.channels[ch];
    const loaded = rt.histLoaded && rt.histLoaded.get(ch);
    const canOlder = !X().isHost(sid) && X().isOnline(sid) && events.length >= 20 && (!loaded || loaded.more !== false);
    let out = `
      ${canOlder ? `<div class="srv-older"><button type="button" class="btn-sec btn-sm" data-older>${esc(tr('servers.loadOlder'))}</button></div>` : ''}
      <div class="dmx-intro srv-intro">
        <span class="srv-intro-hash">${ICON.hash}</span>
        <h2>${esc(tr('servers.welcomeChannel', { name: channel ? channel.name : '' }))}</h2>
        <p>${esc(tr('servers.channelStart', { name: channel ? channel.name : '' }))}</p>
      </div>`;
    let prev = null;
    let lastDay = null;
    let open = false;
    const close = () => { if (open) { out += '</div></div>'; open = false; } };
    const managesMsgs = can(sid, P().MANAGE_MESSAGES, ch);
    const canReact = can(sid, P().ADD_REACTIONS, ch);
    const canSend = can(sid, P().SEND_MESSAGES, ch);
    const msgs = events.filter(e => e.type === 'msg');
    const pending = X().pendingFor(sid, ch).filter(p => !byId[p.id]).map(p => ({ ...p, pending: true }));
    msgs.concat(pending).forEach(e => {
      if (deleted.has(e.id)) return;
      const day = new Date(e.ts).toDateString();
      if (day !== lastDay) {
        close();
        out += `<div class="dmx-day"><span>${esc(new Date(e.ts).toLocaleDateString())}</span></div>`;
        lastDay = day;
        prev = null;
      }
      const hasReply = e.body.reply && byId[e.body.reply];
      const cont = !hasReply && prev && prev.author === e.author && e.ts - prev.ts < GROUP_GAP;
      if (!cont) {
        close();
        const replyLine = hasReply ? (() => {
          const t = byId[e.body.reply];
          const tText = deleted.has(t.id) ? tr('servers.deletedMessage') : (edits[t.id] ? edits[t.id].body.text : t.body.text);
          return `<div class="srv-reply-ref" data-jump="${esc(t.id)}"><span class="srv-reply-curve"></span>${memberAvatar(sid, t.author, 16)}<strong${nameStyle(st, t.author)}>${esc(X().memberName(sid, t.author))}</strong><span>${esc(String(tText).slice(0, 120))}</span></div>`;
        })() : '';
        out += `
          <div class="dmx-group ${hasReply ? 'has-reply' : ''}" data-sender="${e.author === me() ? 'me' : 'them'}">
            ${replyLine}
            <button type="button" class="dmx-av" data-member="${esc(e.author)}">${memberAvatar(sid, e.author, 40)}</button>
            <div class="dmx-main">
              <div class="dmx-head"><button type="button" class="dmx-name" data-member="${esc(e.author)}"${nameStyle(st, e.author)}>${esc(X().memberName(sid, e.author))}</button><time>${esc(fmtTime(e.ts))}</time></div>`;
        open = true;
      }
      const edit = edits[e.id];
      const text = String(edit ? edit.body.text : e.body.text || '');
      const jumbo = window.TSEmoji && window.TSEmoji.isJumbo(text);
      const mine = e.author === me();
      const tools = e.pending ? '' : `<div class="msg-tools">
        ${canReact ? `<button type="button" class="msg-tool" data-sreact="${esc(e.id)}" title="${esc(tr('emoji.addReaction'))}">${ICON.react}</button>` : ''}
        ${canSend ? `<button type="button" class="msg-tool" data-sreply="${esc(e.id)}" title="${esc(tr('servers.reply'))}">${ICON.reply}</button>` : ''}
        ${mine ? `<button type="button" class="msg-tool" data-sedit="${esc(e.id)}" title="${esc(tr('servers.edit'))}">${ICON.edit}</button>` : ''}
        ${mine || managesMsgs ? `<button type="button" class="msg-tool is-danger" data-sdel="${esc(e.id)}" title="${esc(tr('groups.deleteMessage'))}">${ICON.trash}</button>` : ''}
      </div>`;
      const body = editing === e.id
        ? `<div class="srv-edit"><input type="text" class="srv-edit-input" maxlength="4000" value="${esc(text)}" /><small>${esc(tr('servers.editHint'))}</small></div>`
        : `${jumbo ? `<span class="emoji-jumbo">${esc(text)}</span>` : textHtml(sid, text)}${edit ? `<span class="srv-edited">${esc(tr('servers.edited'))}</span>` : ''}${inviteCardHtml(text)}`;
      out += `<div class="dmx-msg ${e.pending ? 'is-pending' : ''} ${mentionsMeText(st, e) ? 'is-mention' : ''}" data-mid="${esc(e.id)}">${cont ? `<time class="dmx-hover-time">${esc(fmtTime(e.ts))}</time>` : ''}${tools}<div class="dmx-content">${body}${reactionsHtml(e.id, reactions[e.id])}</div></div>`;
      prev = hasReply ? null : e;
      if (hasReply) prev = e;
    });
    close();
    host.innerHTML = out;
    if (editing) {
      const input = host.querySelector('.srv-edit-input');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
    if (forceBottom || nearBottom) host.scrollTop = host.scrollHeight;
    else if (host.scrollHeight !== prevHeight && prevTop < 40) host.scrollTop = host.scrollHeight - prevHeight + prevTop;
  }

  function mentionsMeText(st, e) {
    const name = window.state.myName;
    const text = String(e.body && e.body.text || '').toLocaleLowerCase('tr');
    if (!name || e.author === me()) return false;
    if (text.includes(`@${name.toLocaleLowerCase('tr')}`)) return true;
    return SS().has(SS().basePerms(st, e.author), P().MANAGE_SERVER) && (text.includes('@everyone') || text.includes('@herkes'));
  }

  // ---------- yazma alanı ----------
  function cooldownLeft() {
    const until = cooldown.get(`${viewSid}|${viewCh}`) || 0;
    return Math.max(0, until - Date.now());
  }

  function renderComposer() {
    const input = $('srv-input');
    const note = $('srv-composer-note');
    const area = document.querySelector('.srv-input-area');
    if (!input || !note) return;
    const sid = viewSid;
    const st = stOf(sid);
    const ch = st && viewCh && st.channels[viewCh];
    let disabled = false;
    let placeholder = ch ? tr('servers.messageTo', { name: ch.name }) : '';
    let noteHtml = '';
    if (!st || !ch) { disabled = true; placeholder = ''; }
    else if (!X().isOnline(sid)) { disabled = true; placeholder = tr('servers.offlineComposer'); }
    else if (!can(sid, P().SEND_MESSAGES, viewCh)) { disabled = true; placeholder = tr('servers.noSendPerm'); }
    const left = cooldownLeft();
    if (!disabled && left > 0) {
      disabled = true;
      placeholder = tr('servers.slowWait', { t: window.TSUI.formatElapsed(left + 999) });
    }
    if (st && ch && ch.slow && !disabled) noteHtml = `<span class="srv-slow-note">⏱ ${esc(tr('servers.slowOn', { t: slowLabel(ch.slow) }))}</span>`;
    if (replyTo) {
      noteHtml = `<span class="srv-replying">${esc(tr('servers.replyingTo', { name: X().memberName(sid, replyTo.author) }))}</span><button type="button" class="srv-reply-cancel" data-reply-cancel title="${esc(tr('common.close'))}">×</button>` + noteHtml;
    }
    input.disabled = disabled;
    input.placeholder = placeholder;
    area && area.classList.toggle('is-disabled', disabled);
    note.innerHTML = noteHtml;
    note.classList.toggle('hidden', !noteHtml);
    note.classList.toggle('is-reply', !!replyTo);
    if (left > 0 && !cooldownTimer) {
      cooldownTimer = setInterval(() => {
        if (cooldownLeft() <= 0) { clearInterval(cooldownTimer); cooldownTimer = null; }
        renderComposer();
      }, 1000);
    }
    const offline = $('srv-offline');
    if (offline) {
      const show = st && !X().isOnline(sid);
      offline.classList.toggle('hidden', !show);
      offline.innerHTML = show ? `<strong>${esc(tr('servers.offlineTitle'))}</strong> ${esc(tr('servers.offlineBody'))}` : '';
    }
  }

  function slowLabel(sec) {
    if (sec < 60) return tr('servers.seconds', { n: sec });
    if (sec < 3600) return tr('servers.minutes', { n: Math.round(sec / 60) });
    return tr('servers.hours', { n: Math.round(sec / 3600) });
  }

  async function send() {
    const input = $('srv-input');
    if (!input || !viewSid || !viewCh || input.disabled) return;
    const text = input.value;
    if (!text.trim()) return;
    const sid = viewSid;
    const ch = viewCh;
    const reply = replyTo ? replyTo.id : undefined;
    input.value = '';
    replyTo = null;
    if (window.TSTyping) window.TSTyping.localSent(`srv:${sid}:${ch}`);
    const st = stOf(sid);
    const channel = st && st.channels[ch];
    const exempt = can(sid, P().MANAGE_MESSAGES, ch) || can(sid, P().MANAGE_CHANNELS);
    if (channel && channel.slow && !exempt) cooldown.set(`${sid}|${ch}`, Date.now() + channel.slow * 1000);
    renderComposer();
    const p = X().sendMessage(sid, ch, text, reply);
    setTimeout(() => renderMessages(true), 30);
    try {
      await p;
    } catch (e) {
      if (e && e.reason === 'slow' && e.wait) cooldown.set(`${sid}|${ch}`, Date.now() + e.wait);
      else { cooldown.delete(`${sid}|${ch}`); if (!input.value) input.value = text; }
      showError(e);
      renderComposer();
    }
    renderMessages(true);
  }

  // ---------- üye listesi ----------
  function panelOpen() {
    try { return localStorage.getItem(PANEL_KEY) !== '0'; } catch (e) { return true; }
  }

  function renderMembers() {
    const panel = $('srv-members-panel');
    const sid = viewSid;
    const st = stOf(sid);
    $('view-server')?.classList.toggle('panel-open', panelOpen());
    $('srv-members-toggle')?.classList.toggle('active', panelOpen());
    if (!panel) return;
    if (!st) { panel.innerHTML = ''; return; }
    const hosts = new Set(st.hosts);
    const buckets = new Map(); // bölüm anahtarı -> {label, list}
    const hoisted = SS().sortedRoles(st).filter(r => r.hoist && r.id !== SS().EVERYONE);
    hoisted.forEach(r => buckets.set(r.id, { label: r.name, color: r.color, list: [] }));
    buckets.set('online', { label: tr('servers.onlineSection'), list: [] });
    buckets.set('offline', { label: tr('servers.offlineSection'), list: [] });
    Object.values(st.members).forEach(m => {
      const pres = X().memberPresence(sid, m.fid) || {};
      if (!pres.online) { buckets.get('offline').list.push(m); return; }
      const role = SS().hoistRole(st, m.fid);
      (role && buckets.has(role.id) ? buckets.get(role.id) : buckets.get('online')).list.push(m);
    });
    const row = m => {
      const pres = X().memberPresence(sid, m.fid) || {};
      const act = window.TSStatus && window.state.friends[m.fid] ? window.TSStatus.presenceOf(m.fid) : null;
      const sub = act && act.act && act.act.n ? `<span class="srv-member-sub">${window.TSUI.GAMEPAD_SVG}${esc(act.act.n)}</span>` : '';
      return `
        <li class="srv-member ${pres.online ? '' : 'is-offline'}" data-member="${esc(m.fid)}">
          ${memberAvatar(sid, m.fid, 32, true)}
          <span class="srv-member-copy">
            <span class="srv-member-line"><span class="srv-member-name"${nameStyle(st, m.fid)}>${esc(X().memberName(sid, m.fid))}</span>${m.fid === st.owner ? `<span class="srv-badge" title="${esc(tr('servers.owner'))}">${ICON.crown}</span>` : ''}${hosts.has(m.fid) ? `<span class="srv-badge srv-host-badge" title="${esc(tr('servers.hostBadge'))}">${ICON.host}</span>` : ''}</span>
            ${sub}
          </span>
        </li>`;
    };
    const byName = (a, b) => X().memberName(sid, a.fid).localeCompare(X().memberName(sid, b.fid), 'tr');
    panel.innerHTML = `<div class="srv-members">${Array.from(buckets.values()).filter(b => b.list.length).map(b =>
      `<div class="srv-members-head">${esc(b.label)} — ${b.list.length}</div><ul class="srv-member-list">${b.list.sort(byName).map(row).join('')}</ul>`).join('')}</div>`;
  }

  // ---------- üye kartı ----------
  function openMemberCard(sid, fid, anchor) {
    const rt = rtOf(sid);
    const st = rt && rt.st;
    if (!st) return;
    const m = st.members[fid] || st.former[fid];
    if (!m) return;
    const pres = X().memberPresence(sid, fid) || {};
    const isMe = fid === me();
    const isFriend = !!(window.state.friends && window.state.friends[fid]);
    const roles = SS().memberRoles(st, fid);
    const canRoles = can(sid, P().MANAGE_ROLES) && (isMe || SS().outranks(st, me(), fid));
    const assignable = canRoles ? SS().sortedRoles(st).filter(r => r.id !== SS().EVERYONE && SS().canManageRole(st, me(), r.id) && !roles.includes(r)) : [];
    const actions = [];
    if (!isMe && isFriend) actions.push(['dm', tr('servers.sendMessage')]);
    if (!isMe && !isFriend) actions.push(['friend', tr('servers.addFriend')]);
    if (!isMe && st.members[fid] && can(sid, P().KICK_MEMBERS) && SS().outranks(st, me(), fid)) actions.push(['kick', tr('servers.kick'), 'is-danger']);
    if (!isMe && can(sid, P().BAN_MEMBERS) && SS().outranks(st, me(), fid)) actions.push(['ban', tr('servers.ban'), 'is-danger']);
    if (!isMe && st.owner === me() && st.members[fid] && !st.hosts.includes(fid) && !st.hostOffers.includes(fid)) actions.push(['host', tr('servers.offerHost')]);
    const html = `
      <div class="srv-card">
        <div class="srv-card-banner" style="background:${esc(SS().memberColor(st, fid) || window.TSUI.colorFromString(fid))}"></div>
        <div class="srv-card-av">${memberAvatar(sid, fid, 80, true)}</div>
        <div class="srv-card-body">
          <div class="srv-card-name">${esc(X().memberName(sid, fid))}</div>
          <div class="srv-card-id">${esc(fid)}</div>
          ${st.members[fid] ? `<div class="srv-card-since">${esc(tr('servers.memberSince', { date: new Date(m.joinedAt).toLocaleDateString() }))}</div>` : ''}
          <div class="srv-card-label">${esc(tr('servers.roles'))}</div>
          <div class="srv-card-roles">
            ${roles.map(r => `<span class="srv-role-chip"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}${canRoles && SS().canManageRole(st, me(), r.id) ? `<button type="button" data-role-remove="${esc(r.id)}" title="${esc(tr('servers.removeRole'))}">×</button>` : ''}</span>`).join('')}
            ${!roles.length ? `<span class="srv-card-none">${esc(tr('servers.noRoles'))}</span>` : ''}
            ${assignable.length ? `<select class="srv-role-add"><option value="">＋ ${esc(tr('servers.addRole'))}</option>${assignable.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>` : ''}
          </div>
          ${actions.length ? `<div class="srv-card-actions">${actions.map(([k, label, cls]) => `<button type="button" class="btn-sec btn-sm ${cls || ''}" data-card-act="${k}">${esc(label)}</button>`).join('')}</div>` : ''}
        </div>
      </div>`;
    const pop = window.TSUI.popover(html, anchor, { placement: 'left', cls: 'srv-card-pop' });
    pop.el.addEventListener('change', e => {
      const sel = e.target.closest('.srv-role-add');
      if (sel && sel.value) { pop.close(); run(() => X().setMemberRoles(sid, fid, [sel.value], [])); }
    });
    pop.el.addEventListener('click', async e => {
      const rm = e.target.closest('[data-role-remove]');
      if (rm) { pop.close(); run(() => X().setMemberRoles(sid, fid, [], [rm.dataset.roleRemove])); return; }
      const b = e.target.closest('[data-card-act]');
      if (!b) return;
      pop.close();
      const k = b.dataset.cardAct;
      const name = X().memberName(sid, fid);
      if (k === 'dm' && typeof window.openDM === 'function') window.openDM(fid);
      else if (k === 'friend') {
        const input = $('friend-id-input');
        if (input) { input.value = fid; $('btn-add-friend')?.click(); }
      } else if (k === 'kick') {
        if (await window.showConfirm(tr('servers.kick'), tr('servers.kickConfirm', { name }))) run(() => X().kick(sid, fid));
      } else if (k === 'ban') {
        const reason = await window.showPrompt(tr('servers.ban'), tr('servers.banConfirm', { name }), '', tr('servers.banReason'));
        if (reason != null) run(() => X().ban(sid, fid, reason));
      } else if (k === 'host') {
        if (await window.showConfirm(tr('servers.offerHost'), tr('servers.offerHostConfirm', { name }))) {
          const ok = await run(() => X().offerHost(sid, fid));
          if (ok) window.showToast(tr('servers.offerHostSent', { name }), 'ok');
        }
      }
    });
  }

  // ---------- davet kartları (DM, grup, sunucu mesajlarında) ----------
  const hydrating = new Set();
  async function hydrateInvite(card) {
    const code = card.dataset.invite;
    card.dataset.ready = '1';
    if (!X() || hydrating.has(card)) return;
    hydrating.add(card);
    const copy = card.querySelector('.inv-card-copy');
    const icon = card.querySelector('.inv-card-icon');
    const btn = card.querySelector('.inv-card-btn');
    try {
      const info = await X().peekInvite(code);
      const joined = X().get(info.sid) && X().get(info.sid).st && X().get(info.sid).st.members[me()];
      icon.innerHTML = serverIconHtml(info.name, info.icon, 48, info.sid);
      copy.innerHTML = `<strong>${esc(info.name)}</strong><small><i class="inv-dot is-online"></i>${esc(tr('servers.onlineCount', { n: info.online }))} <i class="inv-dot"></i>${esc(tr('servers.memberCount', { n: info.members }))}</small>`;
      btn.disabled = false;
      btn.textContent = joined ? tr('servers.joined') : tr('servers.joinShort');
      btn.classList.toggle('is-joined', !!joined);
      btn.onclick = async () => {
        if (joined) { window.TSShell.setView('server', info.sid); return; }
        btn.disabled = true;
        btn.textContent = tr('servers.joining');
        const sid = await run(() => X().joinWithInvite(code));
        if (sid) { window.TSShell.setView('server', sid); window.showToast(tr('servers.joinedToast', { name: info.name }), 'ok'); }
        else { btn.disabled = false; btn.textContent = tr('servers.joinShort'); }
      };
    } catch (e) {
      icon.innerHTML = '<span class="inv-card-dead">?</span>';
      copy.innerHTML = `<strong>${esc(tr('servers.inviteInvalid'))}</strong><small>${esc(tr('servers.inviteInvalidDesc'))}</small>`;
      btn.remove();
    } finally {
      hydrating.delete(card);
    }
  }
  function hydrateAll(root) {
    (root || document).querySelectorAll('.inv-card[data-invite]:not([data-ready])').forEach(hydrateInvite);
  }

  // ---------- bağlama ----------
  function renderTyping() {
    const line = $('srv-typing');
    if (!line) return;
    const t = viewSid && viewCh && window.TSTyping ? window.TSTyping.text(`srv:${viewSid}:${viewCh}`) : '';
    line.innerHTML = t ? `<span class="typing-dots"><i></i><i></i><i></i></span><span>${esc(t)}</span>` : '';
  }

  function bind() {
    $('rail-spaces')?.addEventListener('click', e => {
      const b = e.target.closest('[data-sid]');
      if (b) window.TSShell.setView('server', b.dataset.sid);
    });
    $('rail-spaces')?.addEventListener('contextmenu', e => {
      const b = e.target.closest('[data-sid]');
      if (!b) return;
      e.preventDefault();
      window.TSShell.setView('server', b.dataset.sid);
      openServerMenu(b);
    });
    $('ss-header')?.addEventListener('click', e => openServerMenu(e.currentTarget));
    $('ss-banner')?.addEventListener('click', e => {
      const b = e.target.closest('[data-host-offer]');
      if (!b || !activeSid) return;
      if (b.dataset.hostOffer === 'accept') run(() => X().acceptHost(activeSid)).then(ok => { if (ok) window.showToast(tr('servers.nowHost'), 'ok'); });
      else run(() => X().declineHost(activeSid));
    });
    $('ss-scroll')?.addEventListener('click', e => {
      const add = e.target.closest('[data-add-ch]');
      if (add) { D().openCreateChannel(activeSid, add.dataset.addCh); return; }
      const gear = e.target.closest('[data-ch-settings]');
      if (gear) { e.stopPropagation(); D().openChannelSettings(activeSid, gear.dataset.chSettings); return; }
      const person = e.target.closest('.ss-vp[data-member]');
      if (person) { openMemberCard(activeSid, person.dataset.member, person); return; }
      const row = e.target.closest('.ss-ch[data-ch]');
      if (!row) return;
      if (row.dataset.kind === 'voice') {
        const vc = X().myVoiceChannel();
        if (vc && vc.sid === activeSid && vc.ch === row.dataset.ch) window.TSShell.setView('call');
        else X().joinVoice(activeSid, row.dataset.ch).then(() => renderSide());
      } else if (window.TSShell.view() === 'server' && viewSid === activeSid) show(activeSid, row.dataset.ch);
      else window.TSShell.setView('server', activeSid) || show(activeSid, row.dataset.ch);
    });
    $('ss-scroll')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.closest('.ss-ch')) e.target.click();
    });
    const input = $('srv-input');
    if (window.TSEmoji && input) window.TSEmoji.attach(input);
    input?.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });
    input?.addEventListener('input', () => { if (viewSid && viewCh && input.value.trim()) X().sendTyping(viewSid, viewCh); });
    input?.addEventListener('keydown', e => {
      if (e.key === 'Escape' && replyTo) { replyTo = null; renderComposer(); }
      if (e.key === 'ArrowUp' && !input.value) {
        // Discord gibi: boş kutuda ↑ son mesajını düzenler
        const mine = Array.from(document.querySelectorAll('#srv-messages .dmx-group[data-sender="me"] .dmx-msg:not(.is-pending)')).pop();
        if (mine) { editing = mine.dataset.mid; renderMessages(false); e.preventDefault(); }
      }
    });
    $('srv-send')?.addEventListener('click', send);
    $('srv-emoji-btn')?.addEventListener('click', e => {
      if (input.disabled) return;
      window.TSEmoji && window.TSEmoji.openPicker(e.currentTarget, emoji => { input.value += emoji; input.focus(); });
    });
    $('srv-composer-note')?.addEventListener('click', e => {
      if (e.target.closest('[data-reply-cancel]')) { replyTo = null; renderComposer(); }
    });
    $('srv-members-toggle')?.addEventListener('click', () => {
      try { localStorage.setItem(PANEL_KEY, panelOpen() ? '0' : '1'); } catch (e) {}
      renderMembers();
    });
    $('srv-invite-btn')?.addEventListener('click', () => viewSid && D().openInvite(viewSid, viewCh));
    $('srv-members-panel')?.addEventListener('click', e => {
      const row = e.target.closest('[data-member]');
      if (row) openMemberCard(viewSid, row.dataset.member, row);
    });
    const msgs = $('srv-messages');
    msgs?.addEventListener('click', async e => {
      const sid = viewSid;
      const ch = viewCh;
      const chip = e.target.closest('[data-srx]');
      if (chip) { run(() => X().react(sid, ch, chip.dataset.mid, chip.dataset.srx, chip.classList.contains('rx-mine') ? 'remove' : 'add')); return; }
      const reactBtn = e.target.closest('[data-sreact]');
      if (reactBtn && window.TSEmoji) {
        const mid = reactBtn.dataset.sreact;
        window.TSEmoji.openPicker(reactBtn, emoji => run(() => X().react(sid, ch, mid, emoji, 'add')), { placement: 'left' });
        return;
      }
      const replyBtn = e.target.closest('[data-sreply]');
      if (replyBtn) {
        const ev = await findEvent(replyBtn.dataset.sreply);
        if (ev) { replyTo = { id: ev.id, author: ev.author }; renderComposer(); $('srv-input')?.focus(); }
        return;
      }
      const editBtn = e.target.closest('[data-sedit]');
      if (editBtn) { editing = editBtn.dataset.sedit; renderMessages(false); return; }
      const del = e.target.closest('[data-sdel]');
      if (del) {
        if (e.shiftKey || await window.showConfirm(tr('groups.deleteMessage'), tr('servers.deleteMessageConfirm'))) run(() => X().deleteMessage(sid, ch, del.dataset.sdel));
        return;
      }
      const jump = e.target.closest('[data-jump]');
      if (jump) {
        const target = msgs.querySelector(`.dmx-msg[data-mid="${CSS.escape(jump.dataset.jump)}"]`);
        if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('is-flash'); setTimeout(() => target.classList.remove('is-flash'), 1200); }
        return;
      }
      const older = e.target.closest('[data-older]');
      if (older) {
        older.disabled = true;
        await X().loadOlder(sid, ch);
        renderMessages(false);
        return;
      }
      const who = e.target.closest('[data-member]');
      if (who) openMemberCard(sid, who.dataset.member, who);
    });
    msgs?.addEventListener('keydown', e => {
      const input = e.target.closest('.srv-edit-input');
      if (!input) return;
      if (e.key === 'Escape') { editing = null; renderMessages(false); }
      else if (e.key === 'Enter') {
        const mid = editing;
        const text = input.value.trim();
        editing = null;
        if (text) run(() => X().editMessage(viewSid, viewCh, mid, text));
        renderMessages(false);
      }
    });
    document.addEventListener('ts:servers', () => { renderRail(); renderSide(); if (window.TSFriends) window.TSFriends.renderBadges(); });
    document.addEventListener('ts:server', e => {
      const d = e.detail || {};
      if (d.removed) {
        if (viewSid === d.sid) { viewSid = null; viewCh = null; if (window.TSShell.view() === 'server') window.TSShell.setView('friends'); }
        if (activeSid === d.sid) setActiveServer(null);
        renderRail();
        return;
      }
      if (d.sid === activeSid) renderSide();
      renderRail();
      if (d.sid !== viewSid || window.TSShell.view() !== 'server') return;
      if (d.ctl || d.online || d.rekey || d.synced) {
        if (!viewCh || !stOf(viewSid) || !stOf(viewSid).channels[viewCh] || !SS().has(permsIn(viewSid, viewCh), P().VIEW_CHANNEL)) viewCh = pickChannel(viewSid);
        renderHeader();
        renderComposer();
        renderMembers();
        renderMessages(false);
        if (viewCh) X().openChannel(viewSid, viewCh);
      } else if (d.chs && d.chs.includes(viewCh)) {
        const viewing = viewingChannel(viewSid);
        if (viewing) X().markRead(viewSid, viewCh);
        renderMessages(d.added && d.added.some(r => r.author === me() && r.ch === viewCh));
      }
    });
    document.addEventListener('ts:server-presence', e => {
      if (e.detail && e.detail.sid === viewSid) { renderMembers(); renderComposer(); }
      if (e.detail && e.detail.sid === activeSid) renderSide();
      renderRail();
    });
    document.addEventListener('ts:server-voice', e => { if (e.detail && e.detail.sid === activeSid) renderSide(); });
    document.addEventListener('ts:server-history', e => { if (e.detail && e.detail.sid === viewSid && e.detail.ch === viewCh) renderMessages(false); });
    document.addEventListener('ts:server-host-offer', e => {
      const sid = e.detail && e.detail.sid;
      const st = stOf(sid);
      if (st && sid !== activeSid) window.showToast(tr('servers.hostOfferToast', { name: st.name }), 'info');
    });
    document.addEventListener('ts:view', () => { if (window.TSShell.view() !== 'server') renderSide(); });
    window.addEventListener('focus', () => { if (viewSid && viewingChannel(viewSid)) X().markRead(viewSid, viewCh); });
    if (window.TSTyping) window.TSTyping.onRender('srv:', renderTyping);
    // Davet kartlarını, hangi görünümde üretilirse üretilsin doldur
    new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches && n.matches('.inv-card[data-invite]:not([data-ready])')) hydrateInvite(n);
          else if (n.querySelector && n.querySelector('.inv-card[data-invite]:not([data-ready])')) hydrateAll(n);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    // Süreli yavaş mod / çevrimdışı durumları yavaş değişir: 5 sn'de bir tazele
    setInterval(() => { if (viewSid && window.TSShell.view() === 'server') renderComposer(); }, 5000);
  }

  async function findEvent(id) {
    const events = await X().channelEvents(viewSid, viewCh, { newest: true, limit: 400 });
    return events.find(e => e.id === id) || null;
  }

  document.addEventListener('DOMContentLoaded', bind);

  window.TSServerUI = {
    show, setActiveServer, renderRail, renderSide, viewingChannel, serverIconHtml, inviteCardHtml,
    openMemberCard, current: () => ({ sid: viewSid, ch: viewCh }), renderMessages, run, showError
  };
})();
