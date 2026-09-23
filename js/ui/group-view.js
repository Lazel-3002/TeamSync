// Arkadaş grubu görünümü: Teams tarzı başlık (arayan avatarı + 00:12 sayacı +
// "Katıl"), gruplanmış mesajlar + tepkiler, üye paneli, grup oluşturma
// penceresi ve gelen grup araması kartı. Motor: js/space/groups.js.
(function () {
  const $ = id => document.getElementById(id);
  const esc = v => window.TSUI.esc(v);
  const tr = (k, v) => window.TSUI.tr(k, v);
  const G = () => window.TSGroups;
  const me = () => window.state.friendId;
  const PANEL_KEY = 'teamsync_group_members_panel';
  const GROUP_GAP = 7 * 60 * 1000;
  let current = null;
  let renderToken = 0;

  const PHONE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  const REACT_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
  const TRASH_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
  const CROWN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="#f0b232" stroke="none"><path d="M2 7l5 5 5-8 5 8 5-5-2 12H4z"/></svg>';

  // ---------- yardımcılar ----------
  function avatarFor(gid, fid, size, withStatus) {
    const friend = window.state.friends && window.state.friends[fid];
    const isMe = fid === me();
    const src = isMe ? window.state.myAvatar : friend && friend.avatar;
    const name = G().displayName(gid, fid);
    let status = null;
    if (withStatus) status = isMe ? (window.TSStatus ? window.TSStatus.effective() : 'online') : (friend && window.TSStatus ? window.TSStatus.statusOf(fid) : null);
    const prof = isMe && window.TSProfile ? window.TSProfile.mine() : (window.TSProfile ? window.TSProfile.profileOf(fid) : null) || {};
    return window.TSUI.avatarHtml({ src, name, seed: fid, size, status, frame: prof && prof.frame, color: prof && prof.avatarColor });
  }

  function stackHtml(gid, members, size = 32) {
    const others = members.filter(m => m.fid !== me()).slice(0, 2);
    if (!others.length) return `<span class="grp-stack" style="--st:${size}px">${avatarFor(gid, me(), size)}</span>`;
    return `<span class="grp-stack ${others.length > 1 ? 'is-duo' : ''}" style="--st:${size}px">${others.map(m => avatarFor(gid, m.fid, others.length > 1 ? Math.round(size * 0.72) : size)).join('')}</span>`;
  }

  function isViewing(gid) {
    return !!(window.TSShell && window.TSShell.isActive() && window.TSShell.view() === 'group' && current === gid && document.hasFocus());
  }

  // ---------- DM listesindeki grup satırları (js/shell-dm.js çağırır) ----------
  function listItems(activeGid) {
    if (!G()) return [];
    return G().list().map(g => {
      const sub = g.call
        ? `<span class="dm-row-sub grp-row-call">🔊 ${esc(tr('groups.inCall'))} · ${window.TSUI.sinceHtml(g.call.startedAt)}</span>`
        : `<span class="dm-row-sub">${esc(tr('groups.memberCount', { n: g.members.length }))}</span>`;
      return {
        ts: g.lastTs || 0,
        html: `
          <li class="dm-row grp-row ${g.gid === activeGid ? 'active' : ''} ${g.unread ? 'has-unread' : ''}" data-gid="${esc(g.gid)}">
            ${stackHtml(g.gid, g.members, 32)}
            <span class="dm-row-copy">
              <span class="dm-row-name">${esc(g.title)}</span>
              ${sub}
            </span>
            ${g.unread ? `<span class="ts-count-badge">${g.unread > 99 ? '99+' : g.unread}</span>` : ''}
          </li>`
      };
    });
  }

  // ---------- başlık + arama alanı ----------
  function renderHeader() {
    const gid = current;
    const rt = gid && G().get(gid);
    if (!rt) return;
    const who = $('grp-who');
    if (who) {
      who.innerHTML = `${stackHtml(gid, rt.rec.members, 26)}<span class="dmh-name">${esc(G().groupTitle(gid))}</span>`;
    }
    const count = $('grp-member-count');
    if (count) count.textContent = String(rt.rec.members.length);
    const input = $('grp-input');
    if (input) input.placeholder = tr('groups.messageTo', { name: G().groupTitle(gid) });
    renderCallArea();
  }

  async function renderCallArea() {
    const gid = current;
    const host = $('grp-call');
    if (!host || !gid) return;
    const call = G().activeCall(gid);
    const rt = G().get(gid);
    const inThis = rt ? await G().inMyCall(rt) : false;
    if (gid !== current) return;
    if (call && call.participants.size) {
      const people = Array.from(call.participants.keys());
      host.innerHTML = `
        <div class="grp-call-live" title="${esc(tr('groups.callBy', { name: G().displayName(gid, call.startedBy) }))}">
          <span class="grp-call-caller">${avatarFor(gid, call.startedBy, 24)}</span>
          ${window.TSUI.sinceHtml(call.startedAt, 'grp-call-timer')}
          <span class="grp-call-people">${people.slice(0, 3).map(fid => avatarFor(gid, fid, 20)).join('')}${people.length > 3 ? `<span class="grp-more">+${people.length - 3}</span>` : ''}</span>
          ${inThis
            ? `<button type="button" class="grp-call-btn is-leave" data-grp-call="leave">${esc(tr('groups.leaveCall'))}</button>`
            : `<button type="button" class="grp-call-btn" data-grp-call="join">${esc(tr('groups.join'))}</button>`}
        </div>`;
    } else {
      host.innerHTML = `<button type="button" class="vh-icon-btn grp-start-call" data-grp-call="start" title="${esc(tr('groups.startCall'))}">${PHONE_SVG}</button>`;
    }
  }

  // ---------- mesajlar ----------
  function buildModel(events) {
    const deleted = new Set();
    const reactions = {}; // target -> emoji -> Set(fid)
    events.forEach(e => {
      if (e.type === 'msg.del') {
        const target = events.find(x => x.id === e.body.target);
        if (target && target.author === e.author) deleted.add(e.body.target);
      } else if (e.type === 'react') {
        const byE = (reactions[e.body.target] = reactions[e.body.target] || {});
        const set = (byE[e.body.e] = byE[e.body.e] || new Set());
        if (e.body.op === 'remove') set.delete(e.author); else set.add(e.author);
      }
    });
    return { deleted, reactions };
  }

  function systemLine(gid, e) {
    const who = esc(G().displayName(gid, e.author));
    if (e.type === 'member.add') return tr('groups.sysAdded', { who, target: esc(e.body.name || e.body.fid) });
    if (e.type === 'member.remove') return tr('groups.sysRemoved', { who, target: esc(G().displayName(gid, e.body.fid)) });
    if (e.type === 'member.leave') return tr('groups.sysLeft', { who });
    if (e.type === 'rename') return tr('groups.sysRenamed', { who, name: esc(e.body.name) });
    if (e.type === 'call.start') return tr('groups.sysCall', { who });
    return '';
  }

  function fmtTime(ts) {
    return typeof window.formatUserTime === 'function' ? window.formatUserTime(new Date(ts)) : new Date(ts).toLocaleTimeString();
  }

  function reactionsHtml(targetId, byEmoji) {
    if (!byEmoji) return '';
    const chips = Object.entries(byEmoji).filter(([, set]) => set.size).map(([e, set]) =>
      `<button type="button" class="rx ${set.has(me()) ? 'rx-mine' : ''}" data-grx="${esc(e)}" data-mid="${esc(targetId)}"><span class="rx-e">${esc(e)}</span><span class="rx-n">${set.size}</span></button>`).join('');
    return chips ? `<div class="rx-row">${chips}</div>` : '';
  }

  async function renderMessages(forceBottom) {
    const gid = current;
    const host = $('grp-messages');
    if (!host || !gid) return;
    const token = ++renderToken;
    const events = await G().loadEvents(gid);
    if (token !== renderToken || gid !== current) return;
    const nearBottom = host.scrollHeight - host.clientHeight - host.scrollTop < 80;
    const { deleted, reactions } = buildModel(events);
    const rt = G().get(gid);
    let out = `
      <div class="dmx-intro">
        ${stackHtml(gid, rt.rec.members, 80)}
        <h2>${esc(G().groupTitle(gid))}</h2>
        <p>${esc(tr('groups.startOfHistory'))}</p>
      </div>`;
    let prev = null;
    let lastDay = null;
    let open = false;
    const close = () => { if (open) { out += '</div></div>'; open = false; } };
    events.forEach(e => {
      if (e.type === 'react' || e.type === 'msg.del') return;
      const day = new Date(e.ts).toDateString();
      if (day !== lastDay) {
        close();
        out += `<div class="dmx-day"><span>${esc(new Date(e.ts).toLocaleDateString())}</span></div>`;
        lastDay = day;
        prev = null;
      }
      if (e.type !== 'msg') {
        close();
        const line = systemLine(gid, e);
        if (line) out += `<div class="grp-sys"><span>${line}</span><time>${esc(fmtTime(e.ts))}</time></div>`;
        prev = null;
        return;
      }
      if (deleted.has(e.id)) return;
      const cont = prev && prev.author === e.author && e.ts - prev.ts < GROUP_GAP;
      if (!cont) {
        close();
        out += `
          <div class="dmx-group" data-sender="${e.author === me() ? 'me' : 'them'}">
            <button type="button" class="dmx-av" data-grp-profile="${esc(e.author)}">${avatarFor(gid, e.author, 40)}</button>
            <div class="dmx-main">
              <div class="dmx-head"><button type="button" class="dmx-name" data-grp-profile="${esc(e.author)}">${esc(G().displayName(gid, e.author))}</button><time>${esc(fmtTime(e.ts))}</time></div>`;
        open = true;
      }
      const text = String(e.body.text || '');
      const jumbo = window.TSEmoji && window.TSEmoji.isJumbo(text);
      const tools = `<div class="msg-tools"><button type="button" class="msg-tool" data-greact="${esc(e.id)}" title="${esc(tr('emoji.addReaction'))}">${REACT_SVG}</button>${e.author === me() ? `<button type="button" class="msg-tool" data-gdel="${esc(e.id)}" title="${esc(tr('groups.deleteMessage'))}">${TRASH_SVG}</button>` : ''}</div>`;
      out += `<div class="dmx-msg" data-mid="${esc(e.id)}">${cont ? `<time class="dmx-hover-time">${esc(fmtTime(e.ts))}</time>` : ''}${tools}<div class="dmx-content">${jumbo ? `<span class="emoji-jumbo">${esc(text)}</span>` : esc(text)}${reactionsHtml(e.id, reactions[e.id])}</div></div>`;
      prev = e;
    });
    close();
    host.innerHTML = out;
    if (forceBottom || nearBottom) host.scrollTop = host.scrollHeight;
  }

  // ---------- üye paneli ----------
  function panelOpen() {
    try { return localStorage.getItem(PANEL_KEY) !== '0'; } catch (e) { return true; }
  }

  function renderMembers() {
    const gid = current;
    const panel = $('grp-members-panel');
    const rt = gid && G().get(gid);
    if (!panel || !rt) return;
    $('view-group')?.classList.toggle('panel-open', panelOpen());
    $('grp-members-toggle')?.classList.toggle('active', panelOpen());
    const owner = rt.rec.owner;
    const iAmOwner = owner === me();
    const rows = rt.rec.members.slice().sort((a, b) => (a.fid === owner ? -1 : b.fid === owner ? 1 : 0)).map(m => {
      const online = m.fid === me() || (rt.online.get(m.fid) && Date.now() - rt.online.get(m.fid) < 45000) || (window.state.friends[m.fid] && window.state.friends[m.fid].online);
      return `
        <li class="grp-member ${online ? '' : 'is-offline'}" data-fid="${esc(m.fid)}">
          ${avatarFor(gid, m.fid, 32, true)}
          <span class="grp-member-name"><span class="grp-member-line">${esc(G().displayName(gid, m.fid))}${m.fid === owner ? `<span class="grp-owner" title="${esc(tr('groups.owner'))}">${CROWN_SVG}</span>` : ''}</span></span>
          ${iAmOwner && m.fid !== me() ? `<button type="button" class="grp-kick" data-kick="${esc(m.fid)}" title="${esc(tr('groups.kick'))}">×</button>` : ''}
        </li>`;
    }).join('');
    const pending = (rt.rec.pendingInvites || []).map(fid => `<li class="grp-member is-pending">${window.TSUI.avatarHtml({ name: (window.state.friends[fid] || {}).name || fid, seed: fid, size: 32 })}<span class="grp-member-name">${esc((window.state.friends[fid] || {}).name || fid)}<small>${esc(tr('groups.invitePending'))}</small></span></li>`).join('');
    panel.innerHTML = `
      <div class="grp-panel">
        <div class="grp-panel-head">${esc(tr('groups.membersCount', { n: rt.rec.members.length }))}</div>
        <ul class="grp-member-list">${rows}${pending}</ul>
        ${rt.rec.members.length < G().MAX_MEMBERS ? `<button type="button" class="grp-panel-btn" data-grp-add>${esc(tr('groups.addMembers'))}</button>` : ''}
        <button type="button" class="grp-panel-btn is-danger" data-grp-leave>${esc(tr('groups.leave'))}</button>
      </div>`;
  }

  // ---------- görünüm ----------
  function show(gid) {
    if (!G() || !G().get(gid)) return;
    const changed = current !== gid;
    current = gid;
    G().markRead(gid);
    renderHeader();
    renderMembers();
    renderMessages(true);
    renderTyping();
    if (changed) setTimeout(() => $('grp-input')?.focus(), 30);
    if (window.TSDM) window.TSDM.renderList();
  }

  function renderTyping() {
    const line = $('grp-typing');
    if (!line) return;
    const t = current && window.TSTyping ? window.TSTyping.text(`grp:${current}`) : '';
    line.innerHTML = t ? `<span class="typing-dots"><i></i><i></i><i></i></span><span>${esc(t)}</span>` : '';
  }

  // ---------- grup oluşturma ----------
  function openCreate(anchor, preselect = []) {
    const friends = Object.entries(window.state.friends || {}).filter(([, f]) => f && f.name && !f.temporary)
      .sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
    const selected = new Set(preselect);
    const wrap = document.createElement('div');
    wrap.className = 'grp-create';
    const max = G().MAX_MEMBERS - 1;
    const render = () => {
      const q = (wrap.querySelector('.grp-create-search')?.value || '').toLocaleLowerCase();
      const list = friends.filter(([fid, f]) => !q || f.name.toLocaleLowerCase().includes(q) || fid.toLowerCase().includes(q));
      wrap.querySelector('.grp-create-list').innerHTML = list.length ? list.map(([fid, f]) => `
        <label class="grp-create-row">
          ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 32, status: window.TSStatus ? window.TSStatus.statusOf(fid) : null })}
          <span class="grp-create-name">${esc(f.name)}</span>
          <input type="checkbox" data-fid="${esc(fid)}" ${selected.has(fid) ? 'checked' : ''} />
        </label>`).join('') : `<div class="grp-create-empty">${esc(tr('groups.noFriends'))}</div>`;
      wrap.querySelector('.grp-create-count').textContent = tr('groups.selectedCount', { n: selected.size, max });
      const btn = wrap.querySelector('.grp-create-go');
      btn.disabled = selected.size === 0;
      btn.textContent = selected.size === 1 ? tr('groups.createDm') : tr('groups.create');
    };
    wrap.innerHTML = `
      <div class="grp-create-title">${esc(tr('groups.selectFriends'))}</div>
      <div class="grp-create-count"></div>
      <input type="text" class="grp-create-search" placeholder="${esc(tr('groups.searchFriends'))}" />
      <div class="grp-create-list"></div>
      <input type="text" class="grp-create-name-input" maxlength="60" placeholder="${esc(tr('groups.nameOptional'))}" />
      <button type="button" class="btn-pri grp-create-go"></button>`;
    const pop = window.TSUI.popover(wrap, anchor, { placement: 'bottom', cls: 'grp-create-pop' });
    wrap.querySelector('.grp-create-search').addEventListener('input', render);
    wrap.addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox][data-fid]');
      if (!cb) return;
      if (cb.checked && selected.size >= max) { cb.checked = false; return; }
      if (cb.checked) selected.add(cb.dataset.fid); else selected.delete(cb.dataset.fid);
      render();
    });
    wrap.querySelector('.grp-create-go').addEventListener('click', async () => {
      const ids = Array.from(selected);
      if (!ids.length) return;
      if (ids.length === 1 && !wrap.querySelector('.grp-create-name-input').value.trim()) {
        pop.close();
        if (typeof window.openDM === 'function') window.openDM(ids[0]);
        return;
      }
      const btn = wrap.querySelector('.grp-create-go');
      btn.disabled = true;
      btn.textContent = tr('groups.creating');
      try {
        const res = await G().createGroup(ids, wrap.querySelector('.grp-create-name-input').value);
        pop.close();
        if (res.pending.length) window.showToast(tr('groups.pendingInvites', { n: res.pending.length }), 'info');
        if (window.TSShell) window.TSShell.setView('group', res.gid);
      } catch (e) {
        btn.disabled = false;
        render();
        window.showToast(tr('groups.createFailed'), 'danger');
      }
    });
    render();
    setTimeout(() => wrap.querySelector('.grp-create-search')?.focus(), 30);
    return pop;
  }

  function openAddMembers(anchor) {
    const rt = current && G().get(current);
    if (!rt) return;
    const inGroup = new Set(rt.rec.members.map(m => m.fid).concat(rt.rec.pendingInvites || []));
    const friends = Object.entries(window.state.friends || {}).filter(([fid, f]) => f && f.name && !f.temporary && !inGroup.has(fid));
    const wrap = document.createElement('div');
    wrap.className = 'grp-create';
    wrap.innerHTML = `
      <div class="grp-create-title">${esc(tr('groups.addMembers'))}</div>
      <div class="grp-create-list">${friends.length ? friends.map(([fid, f]) => `
        <label class="grp-create-row">
          ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 32 })}
          <span class="grp-create-name">${esc(f.name)}</span>
          <input type="checkbox" data-fid="${esc(fid)}" />
        </label>`).join('') : `<div class="grp-create-empty">${esc(tr('groups.noMoreFriends'))}</div>`}</div>
      <button type="button" class="btn-pri grp-create-go">${esc(tr('groups.add'))}</button>`;
    const pop = window.TSUI.popover(wrap, anchor, { placement: 'left', cls: 'grp-create-pop' });
    wrap.querySelector('.grp-create-go').addEventListener('click', async () => {
      const ids = Array.from(wrap.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.dataset.fid);
      pop.close();
      let pending = 0;
      for (const fid of ids) { if ((await G().invite(current, fid)) === 'pending') pending++; }
      if (pending) window.showToast(tr('groups.pendingInvites', { n: pending }), 'info');
      renderMembers();
    });
  }

  // ---------- gelen arama kartı ----------
  let ringEl = null;
  function ring(gid) {
    const call = G().activeCall(gid);
    if (!call || (window.TSStatus && window.TSStatus.isDnd())) return;
    if (ringEl) ringEl.remove();
    ringEl = document.createElement('div');
    ringEl.className = 'grp-ring';
    ringEl.setAttribute('data-i18n-ignore', '');
    ringEl.innerHTML = `
      <div class="grp-ring-av">${avatarFor(gid, call.startedBy, 48)}</div>
      <div class="grp-ring-copy">
        <strong>${esc(G().displayName(gid, call.startedBy))}</strong>
        <span>${esc(tr('groups.ringing', { group: G().groupTitle(gid) }))}</span>
      </div>
      <button type="button" class="grp-ring-btn is-join" data-ring="join" title="${esc(tr('groups.join'))}">${PHONE_SVG}</button>
      <button type="button" class="grp-ring-btn is-decline" data-ring="decline" title="${esc(tr('groups.decline'))}">×</button>`;
    document.body.appendChild(ringEl);
    if (typeof window.playSound === 'function') window.playSound('on');
    const el = ringEl;
    const timer = setTimeout(() => { if (ringEl === el) { el.remove(); ringEl = null; } }, 30000);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-ring]');
      if (!b) return;
      clearTimeout(timer);
      el.remove();
      if (ringEl === el) ringEl = null;
      if (b.dataset.ring === 'join') {
        if (window.TSShell) window.TSShell.setView('group', gid);
        G().startOrJoinCall(gid);
      }
    });
  }

  // ---------- bağlama ----------
  function send() {
    const input = $('grp-input');
    if (!input || !current) return;
    const text = input.value;
    if (!text.trim()) return;
    input.value = '';
    if (window.TSTyping) window.TSTyping.localSent(`grp:${current}`);
    G().sendMessage(current, text).then(() => renderMessages(true)).catch(() => window.showToast(tr('groups.sendFailed'), 'danger'));
  }

  function bind() {
    const input = $('grp-input');
    if (window.TSEmoji && input) window.TSEmoji.attach(input);
    input?.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });
    input?.addEventListener('input', () => { if (current && input.value.trim()) G().sendTyping(current); });
    $('grp-send')?.addEventListener('click', send);
    $('grp-emoji-btn')?.addEventListener('click', e => {
      window.TSEmoji && window.TSEmoji.openPicker(e.currentTarget, emoji => {
        input.value += emoji;
        input.focus();
      });
    });
    $('grp-members-toggle')?.addEventListener('click', () => {
      try { localStorage.setItem(PANEL_KEY, panelOpen() ? '0' : '1'); } catch (e) {}
      renderMembers();
    });
    $('grp-who')?.addEventListener('click', async () => {
      if (!current || typeof window.showPrompt !== 'function') return;
      const name = await window.showPrompt(tr('groups.rename'), tr('groups.renameDesc'), G().groupTitle(current), tr('groups.untitled'));
      if (name != null && name.trim()) G().rename(current, name.trim());
    });
    $('grp-call')?.addEventListener('click', e => {
      const b = e.target.closest('[data-grp-call]');
      if (!b || !current) return;
      if (b.dataset.grpCall === 'leave') G().leaveCall(current);
      else G().startOrJoinCall(current);
    });
    $('grp-messages')?.addEventListener('click', e => {
      const chip = e.target.closest('[data-grx]');
      if (chip) {
        const mine = chip.classList.contains('rx-mine');
        G().react(current, chip.dataset.mid, chip.dataset.grx, mine ? 'remove' : 'add');
        return;
      }
      const reactBtn = e.target.closest('[data-greact]');
      if (reactBtn && window.TSEmoji) {
        const mid = reactBtn.dataset.greact;
        window.TSEmoji.openPicker(reactBtn, emoji => G().react(current, mid, emoji, 'add'), { placement: 'left' });
        return;
      }
      const del = e.target.closest('[data-gdel]');
      if (del) { G().deleteMessage(current, del.dataset.gdel); return; }
      const who = e.target.closest('[data-grp-profile]');
      if (who && window.TSProfile) {
        const fid = who.dataset.grpProfile;
        if (fid === me()) window.TSProfile.showCard({ self: true }, who);
        else if (window.state.friends[fid]) window.TSProfile.showCard({ friendId: fid }, who);
      }
    });
    $('grp-members-panel')?.addEventListener('click', async e => {
      const kick = e.target.closest('[data-kick]');
      if (kick) {
        const name = G().displayName(current, kick.dataset.kick);
        if (await window.showConfirm(tr('groups.kick'), tr('groups.kickConfirm', { name }))) G().kick(current, kick.dataset.kick);
        return;
      }
      if (e.target.closest('[data-grp-add]')) { openAddMembers(e.target.closest('[data-grp-add]')); return; }
      if (e.target.closest('[data-grp-leave]')) {
        if (await window.showConfirm(tr('groups.leave'), tr('groups.leaveConfirm', { group: G().groupTitle(current) }))) {
          const gid = current;
          current = null;
          if (window.TSShell) window.TSShell.setView('friends');
          G().leave(gid);
        }
      }
    });
    document.addEventListener('ts:group', e => {
      const d = e.detail || {};
      if (window.TSDM) window.TSDM.renderList();
      if (window.TSFriends) window.TSFriends.renderBadges();
      if (!current) return;
      if (d.removed && d.gid === current) {
        current = null;
        if (window.TSShell && window.TSShell.view() === 'group') window.TSShell.setView('friends');
        return;
      }
      if (!d.gid || d.gid === current) {
        if (window.TSShell && window.TSShell.view() === 'group') {
          if (isViewing(current)) G().markRead(current);
          renderHeader();
          renderMembers();
          renderMessages(d.added && d.added.some(r => r.author === me()));
        }
      }
    });
    document.addEventListener('ts:group-call', e => {
      if (e.detail && e.detail.gid === current) renderCallArea();
      if (window.TSDM) window.TSDM.renderList();
    });
    document.addEventListener('ts:group-presence', e => {
      if (e.detail && e.detail.gid === current) renderMembers();
    });
    window.addEventListener('focus', () => { if (current && isViewing(current)) G().markRead(current); });
    if (window.TSTyping) window.TSTyping.onRender('grp:', renderTyping);
  }

  document.addEventListener('DOMContentLoaded', bind);

  window.TSGroupUI = { show, isViewing, listItems, openCreate, ring, current: () => current, renderMessages };
})();
