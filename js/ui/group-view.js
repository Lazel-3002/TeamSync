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
  const ico = (name, size = 16) => (window.TSUI && typeof window.TSUI.icon === 'function' ? window.TSUI.icon(name, size) : '');
  const isRealFriend = fid => { const f = window.state.friends && window.state.friends[fid]; return !!(f && !f.temporary); };
  const isBlocked = fid => !!(window.TSBlock && window.TSBlock.isBlocked(fid));

  // Arkadaş olmayan üyenin çevrimiçi durumu grubun /eph kalp atışlarından gelir.
  function groupOnline(gid, fid) {
    if (fid === me()) return true;
    const rt = G().get(gid);
    const seen = rt && rt.online && rt.online.get(fid);
    if (seen && Date.now() - seen < 45000) return true;
    const f = window.state.friends && window.state.friends[fid];
    return !!(f && f.online);
  }

  function avatarFor(gid, fid, size, withStatus) {
    const friend = window.state.friends && window.state.friends[fid];
    const isMe = fid === me();
    const prof = isMe && window.TSProfile ? window.TSProfile.mine() : (window.TSProfile ? window.TSProfile.profileOf(fid) : null) || {};
    // Arkadaş olmayan üye: avatar profil yanıtından (res_profile.av) gelir.
    const src = isMe ? window.state.myAvatar : (friend && friend.avatar) || (prof && prof.avatarUrl) || undefined;
    const name = G().displayName(gid, fid);
    let status = null;
    if (withStatus) {
      if (isMe) status = window.TSStatus ? window.TSStatus.effective() : 'online';
      else if (isRealFriend(fid) && window.TSStatus) status = window.TSStatus.statusOf(fid);
      if (!isMe && (!status || status === 'offline')) status = groupOnline(gid, fid) ? 'online' : 'offline';
    }
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
        ? `<span class="dm-row-sub grp-row-call">${ico('phone', 12)}${esc(tr('groups.inCall'))} · ${window.TSUI.sinceHtml(g.call.startedAt)}</span>`
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

  // Çakışan çizimler (await sırasında gelen yeni olay) eski sonucu yazmasın.
  let callRenderToken = 0;
  async function renderCallArea() {
    const gid = current;
    const host = $('grp-call');
    if (!host || !gid || !G()) return;
    const token = ++callRenderToken;
    const rt = G().get(gid);
    const inThis = rt ? await G().inMyCall(rt) : false;
    if (token !== callRenderToken || gid !== current) return;
    // Arama durumu await'ten SONRA okunur (bayat "Katıl" yazılmasın).
    const call = G().activeCall(gid);
    const mine = inThis && G().myCall ? G().myCall(gid) : null;
    if ((call && call.participants.size) || mine) {
      const c = call && call.participants.size ? call : { ...mine, participants: new Map() };
      const people = Array.from(c.participants.keys());
      // Odadayım ama henüz kimseye bağlanmadım: işaret göndermiyorum.
      const connecting = !!(mine && !people.includes(me()));
      const members = rt ? rt.rec.members.length : 0;
      const canRingMissing = inThis && !connecting && people.length < members;
      const actions = inThis
        ? `${connecting ? `<span class="grp-call-note">${esc(tr('call.connecting'))}</span>` : ''}${canRingMissing ? `<button type="button" class="grp-call-btn is-ghost" data-grp-call="callring" title="${esc(tr('groups.ringMissingTitle'))}">${ico('bell', 14)}<span>${esc(tr('groups.ringMissing'))}</span></button>` : ''}<button type="button" class="grp-call-btn is-leave" data-grp-call="leave">${esc(tr('groups.leaveCall'))}</button>`
        : `<button type="button" class="grp-call-btn" data-grp-call="join">${esc(tr('groups.join'))}</button>`;
      host.innerHTML = `
        <div class="grp-call-live" title="${esc(tr('groups.callBy', { name: G().displayName(gid, c.startedBy) }))}">
          <span class="grp-call-caller">${avatarFor(gid, c.startedBy, 24)}</span>
          ${window.TSUI.sinceHtml(c.startedAt, 'grp-call-timer')}
          <span class="grp-call-people">${people.slice(0, 3).map(fid => avatarFor(gid, fid, 20)).join('')}${people.length > 3 ? `<span class="grp-more">+${people.length - 3}</span>` : ''}</span>
          ${actions}
        </div>`;
    } else {
      host.innerHTML = `
        <div class="grp-call-start">
          <button type="button" class="grp-call-btn grp-start-call" data-grp-call="meet" title="${esc(tr('groups.meetNowTitle'))}">${ico('video', 16) || PHONE_SVG}<span>${esc(tr('groups.meetNow'))}</span></button>
          <button type="button" class="grp-call-btn is-ghost grp-ring-all" data-grp-call="ringall" title="${esc(tr('groups.ringAllTitle'))}">${ico('phone', 16)}<span>${esc(tr('groups.ringAll'))}</span></button>
        </div>`;
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
      out += `<div class="dmx-msg" data-mid="${esc(e.id)}">${cont ? `<time class="dmx-hover-time">${esc(fmtTime(e.ts))}</time>` : ''}${tools}<div class="dmx-content">${jumbo ? `<span class="emoji-jumbo">${esc(text)}</span>` : esc(text)}${window.TSServerUI ? window.TSServerUI.inviteCardHtml(text) : ''}${reactionsHtml(e.id, reactions[e.id])}</div></div>`;
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
    const unconfirmed = new Set(Array.isArray(rt.rec.unconfirmed) ? rt.rec.unconfirmed : []);
    const requested = new Set(window.TSFriends && window.TSFriends.outgoingIds ? window.TSFriends.outgoingIds() : []);
    const iconBtn = (attr, fid, icon, label, cls = '') => `<button type="button" class="grp-m-act ${cls}" ${attr}="${esc(fid)}" title="${esc(label)}" aria-label="${esc(label)}">${ico(icon, 16)}</button>`;
    const rows = rt.rec.members.slice().sort((a, b) => (a.fid === owner ? -1 : b.fid === owner ? 1 : 0)).map(m => {
      const isMe = m.fid === me();
      const online = groupOnline(gid, m.fid);
      const friend = isRealFriend(m.fid);
      const blocked = !isMe && isBlocked(m.fid);
      if (!isMe && !friend) askProfile(m.fid);
      let hint = '';
      if (unconfirmed.has(m.fid)) hint = tr('groups.inviteUnconfirmed');
      else if (blocked) hint = tr('friends.blockedTag');
      else if (!isMe && !friend) hint = tr('friends.notFriend');
      let acts = '';
      if (!isMe && !friend && !blocked) {
        acts += requested.has(m.fid)
          ? `<span class="grp-m-state" title="${esc(tr('friends.requestPending'))}">${ico('clock', 14)}</span>`
          : iconBtn('data-grp-addfriend', m.fid, 'userPlus', tr('profile.addFriend'));
        acts += iconBtn('data-grp-block', m.fid, 'ban', tr('friends.block'), 'is-danger');
      }
      if (iAmOwner && !isMe) acts += iconBtn('data-kick', m.fid, 'userMinus', tr('groups.kick'), 'is-danger');
      return `
        <li class="grp-member ${online ? '' : 'is-offline'} ${!isMe && !friend ? 'is-nonfriend' : ''}" data-fid="${esc(m.fid)}">
          <button type="button" class="grp-member-main" data-grp-profile="${esc(m.fid)}">
            ${avatarFor(gid, m.fid, 32, true)}
            <span class="grp-member-name"><span class="grp-member-line"><span class="grp-member-text">${esc(G().displayName(gid, m.fid))}</span>${m.fid === owner ? `<span class="grp-owner" title="${esc(tr('groups.owner'))}">${CROWN_SVG}</span>` : ''}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
          </button>
          ${acts ? `<span class="grp-m-acts">${acts}</span>` : ''}
        </li>`;
    }).join('');
    const pending = (rt.rec.pendingInvites || []).map(fid => `<li class="grp-member is-pending">${window.TSUI.avatarHtml({ name: (window.state.friends[fid] || {}).name || fid, seed: fid, size: 32 })}<span class="grp-member-name">${esc((window.state.friends[fid] || {}).name || fid)}<small>${esc(tr('groups.invitePending'))}</small></span></li>`).join('');
    const used = seatsUsed(rt);
    const full = used >= G().MAX_MEMBERS;
    panel.innerHTML = `
      <div class="grp-panel">
        <div class="grp-panel-head">${esc(tr('groups.membersCount', { n: rt.rec.members.length }))}</div>
        <ul class="grp-member-list">${rows}${pending}</ul>
        <div class="grp-panel-actions">
          <button type="button" class="grp-panel-btn is-pri" data-grp-add ${full ? `disabled title="${esc(tr('groups.capReached', { max: G().MAX_MEMBERS }))}"` : ''}>${ico('userPlus', 16)}<span>${esc(tr('groups.addMembers'))}</span></button>
          ${full ? `<p class="grp-panel-note">${esc(tr('groups.capReached', { max: G().MAX_MEMBERS }))}</p>` : ''}
        </div>
        <div class="grp-panel-danger">
          <button type="button" class="grp-panel-btn is-danger" data-grp-leave>${ico('logOut', 16)}<span>${esc(tr('groups.leave'))}</span></button>
        </div>
      </div>`;
  }

  // Üye profil kartı: arkadaş olmayan üye için ad grup kaydından gelir.
  function showMemberCard(fid, anchor) {
    if (!window.TSProfile || !fid) return;
    if (fid === me()) window.TSProfile.showCard({ self: true }, anchor);
    else window.TSProfile.showCard({ friendId: fid, name: current ? G().displayName(current, fid) : fid, status: current && groupOnline(current, fid) ? 'online' : null }, anchor);
  }

  // Üye + bekleyen davet sayısı (25 üye sınırı bekleyen davetleri de sayar).
  function seatsUsed(rt) {
    const s = new Set(rt.rec.members.map(m => m.fid));
    (rt.rec.pendingInvites || []).forEach(f => s.add(f));
    (Array.isArray(rt.rec.unconfirmed) ? rt.rec.unconfirmed : []).forEach(f => s.add(f));
    return s.size;
  }

  // Arkadaş olmayan üyelerin profili (ad, avatar, çerçeve) P2P istenir; en çok 5 dk'da bir.
  const profileAsked = new Map();
  function askProfile(fid) {
    if (!window.TSProfile || !window.TSProfile.request) return;
    const now = Date.now();
    if (now - (profileAsked.get(fid) || 0) < 5 * 60 * 1000) return;
    profileAsked.set(fid, now);
    setTimeout(() => window.TSProfile.request(fid), 200 + Math.random() * 800);
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

  // ---------- kişi seçici (grup oluştur + gruba ekle: tek aile) ----------
  // Engellenenler aday değildir; sessize alınmış arkadaşlar eklenebilir.
  function friendCandidates(exclude) {
    const friends = window.state.friends || {};
    return Object.keys(friends)
      .filter(fid => { const f = friends[fid]; return f && f.name && !f.temporary && !isBlocked(fid) && !(exclude && exclude.has(fid)); })
      .map(fid => {
        const f = friends[fid];
        const status = window.TSStatus ? window.TSStatus.statusOf(fid) : (f.online ? 'online' : 'offline');
        return { fid, name: String(f.name), avatar: f.avatar, status };
      })
      .sort((a, b) => ((a.status === 'offline') - (b.status === 'offline')) || a.name.localeCompare(b.name));
  }

  function goAddFriendPage() {
    if (window.TSShell) window.TSShell.setView('friends');
    if (window.TSFriends) window.TSFriends.setTab('add');
  }

  // opts: { mode:'create'|'add', anchor, placement, candidates, preselect, max, emptyKey, onSubmit(ids, name, ui) }
  function openPicker(opts) {
    const { mode, candidates } = opts;
    const max = Math.max(0, opts.max);
    const selected = new Set((opts.preselect || []).filter(fid => candidates.some(c => c.fid === fid)).slice(0, max));
    const wrap = document.createElement('div');
    wrap.className = 'grp-pick';
    wrap.dataset.mode = mode;
    const title = tr(mode === 'create' ? 'groups.createTitle' : 'groups.addTitle');
    const help = tr(mode === 'create' ? 'groups.createHelp' : 'groups.addHelp');
    const head = `<div class="grp-pick-head"><div class="grp-pick-title">${esc(title)}</div><p class="grp-pick-help">${esc(help)}</p></div>`;
    const statusText = s => (window.TSUI.statusLabel ? window.TSUI.statusLabel(s) : s);

    if (!candidates.length || max <= 0) {
      const text = max <= 0 && candidates.length ? tr('groups.capReached', { max: G().MAX_MEMBERS }) : tr(opts.emptyKey);
      wrap.innerHTML = `${head}
        <div class="grp-pick-empty">
          <span class="grp-pick-empty-ico">${ico(max <= 0 && candidates.length ? 'users' : 'userPlus', 28)}</span>
          <p>${esc(text)}</p>
          ${max > 0 || !candidates.length ? `<button type="button" class="btn-sec grp-pick-goadd" data-pick="goadd">${ico('userPlus', 16)}<span>${esc(tr('groups.goAddFriend'))}</span></button>` : ''}
        </div>`;
      const pop = window.TSUI.popover(wrap, opts.anchor, { placement: opts.placement, cls: 'grp-pick-pop' });
      wrap.querySelector('[data-pick="goadd"]')?.addEventListener('click', () => { pop.close(); goAddFriendPage(); });
      setTimeout(() => wrap.querySelector('[data-pick="goadd"]')?.focus(), 30);
      return pop;
    }

    const withSearch = candidates.length > 6;
    wrap.innerHTML = `${head}
      ${withSearch ? `<label class="grp-pick-search">${ico('search', 16)}<input type="text" class="grp-pick-q" autocomplete="off" placeholder="${esc(tr('groups.searchFriends'))}" aria-label="${esc(tr('groups.searchFriends'))}" /></label>` : ''}
      <div class="grp-pick-list" role="group" aria-label="${esc(title)}">
        ${candidates.map(c => `
          <label class="grp-pick-row" data-fid="${esc(c.fid)}" data-q="${esc((c.name + ' ' + c.fid).toLocaleLowerCase())}">
            <input type="checkbox" class="grp-pick-cb" data-fid="${esc(c.fid)}" />
            ${window.TSUI.avatarHtml({ src: c.avatar, name: c.name, seed: c.fid, size: 32, status: c.status })}
            <span class="grp-pick-copy"><span class="grp-pick-name">${esc(c.name)}</span><small class="grp-pick-st s-${esc(c.status)}">${esc(statusText(c.status))}</small></span>
            <span class="grp-pick-box" aria-hidden="true">${ico('check', 14)}</span>
          </label>`).join('')}
        <div class="grp-pick-nomatch hidden">${esc(tr('groups.noMatch'))}</div>
      </div>
      ${mode === 'create' ? `<input type="text" class="grp-pick-name-input" maxlength="60" placeholder="${esc(tr('groups.nameOptional'))}" aria-label="${esc(tr('groups.nameOptional'))}" />` : ''}
      <div class="grp-pick-cap" aria-live="polite"></div>
      <div class="grp-pick-foot">
        <span class="grp-pick-count" aria-live="polite"></span>
        <button type="button" class="btn-pri grp-pick-go" disabled></button>
      </div>`;
    const pop = window.TSUI.popover(wrap, opts.anchor, { placement: opts.placement, cls: 'grp-pick-pop' });
    const btn = wrap.querySelector('.grp-pick-go');
    let busy = false;

    const sync = () => {
      const n = selected.size;
      wrap.querySelectorAll('.grp-pick-cb').forEach(cb => {
        const on = selected.has(cb.dataset.fid);
        cb.checked = on;
        cb.disabled = !on && n >= max;
        cb.closest('.grp-pick-row').classList.toggle('is-on', on);
        cb.closest('.grp-pick-row').classList.toggle('is-locked', !on && n >= max);
      });
      wrap.querySelector('.grp-pick-count').textContent = n ? tr('groups.pickedCount', { n }) : tr('groups.pickedNone');
      const cap = wrap.querySelector('.grp-pick-cap');
      const left = max - n;
      cap.textContent = left <= 0 ? tr('groups.capReached', { max: G().MAX_MEMBERS }) : (max < candidates.length ? tr('groups.capLeft', { n: left, max: G().MAX_MEMBERS }) : '');
      cap.classList.toggle('is-full', left <= 0);
      btn.disabled = busy || n === 0;
      if (!busy) {
        if (mode === 'create') btn.textContent = n === 1 && !(wrap.querySelector('.grp-pick-name-input')?.value || '').trim() ? tr('groups.createDm') : tr('groups.create');
        else btn.textContent = n > 1 ? tr('groups.addN', { n }) : tr('groups.add');
      }
    };
    const filter = () => {
      const q = (wrap.querySelector('.grp-pick-q')?.value || '').trim().toLocaleLowerCase();
      let shown = 0;
      wrap.querySelectorAll('.grp-pick-row').forEach(row => {
        const hit = !q || row.dataset.q.includes(q);
        row.classList.toggle('hidden', !hit);
        if (hit) shown++;
      });
      wrap.querySelector('.grp-pick-nomatch').classList.toggle('hidden', shown > 0);
    };
    const visibleBoxes = () => Array.from(wrap.querySelectorAll('.grp-pick-row:not(.hidden) .grp-pick-cb'));
    const submit = async () => {
      if (busy || !selected.size) return;
      busy = true;
      btn.disabled = true;
      btn.textContent = tr(mode === 'create' ? 'groups.creating' : 'groups.adding');
      try {
        await opts.onSubmit(Array.from(selected), (wrap.querySelector('.grp-pick-name-input')?.value || '').trim(), pop);
      } catch (e) {
        busy = false;
        sync();
      }
    };

    wrap.addEventListener('change', e => {
      const cb = e.target.closest('.grp-pick-cb');
      if (!cb) return;
      if (cb.checked && selected.size >= max) { cb.checked = false; return; }
      if (cb.checked) selected.add(cb.dataset.fid); else selected.delete(cb.dataset.fid);
      sync();
    });
    wrap.querySelector('.grp-pick-q')?.addEventListener('input', filter);
    wrap.querySelector('.grp-pick-name-input')?.addEventListener('input', sync);
    btn.addEventListener('click', submit);
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const boxes = visibleBoxes();
      if (!boxes.length) return;
      e.preventDefault();
      const i = boxes.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i < 0 ? 0 : Math.min(boxes.length - 1, i + 1)) : (i <= 0 ? -1 : i - 1);
      if (next < 0) (wrap.querySelector('.grp-pick-q') || boxes[0]).focus();
      else boxes[next].focus();
    });
    sync();
    setTimeout(() => (wrap.querySelector('.grp-pick-q') || wrap.querySelector('.grp-pick-cb'))?.focus(), 30);
    return pop;
  }

  // ---------- grup oluşturma ----------
  function openCreate(anchor, preselect = []) {
    const candidates = friendCandidates(null);
    const anyFriend = Object.values(window.state.friends || {}).some(f => f && f.name && !f.temporary);
    return openPicker({
      mode: 'create', anchor, placement: 'bottom', candidates, preselect,
      max: G().MAX_MEMBERS - 1,
      emptyKey: anyFriend ? 'groups.emptyNoFriends' : 'groups.noFriends',
      onSubmit: async (ids, name, pop) => {
        if (ids.length === 1 && !name) {
          pop.close();
          if (typeof window.openDM === 'function') window.openDM(ids[0]);
          return;
        }
        try {
          const res = await G().createGroup(ids, name);
          pop.close();
          if (res.pending.length) window.showToast(tr('groups.pendingInvites', { n: res.pending.length }), 'info');
          if (window.TSShell) window.TSShell.setView('group', res.gid);
        } catch (e) {
          window.showToast(tr('groups.createFailed'), 'danger');
          throw e;
        }
      }
    });
  }

  function openAddMembers(anchor) {
    const gid = current;
    const rt = gid && G().get(gid);
    if (!rt) return null;
    const inGroup = new Set(rt.rec.members.map(m => m.fid).concat(rt.rec.pendingInvites || []));
    const candidates = friendCandidates(inGroup);
    const anyOther = Object.keys(window.state.friends || {}).some(fid => { const f = window.state.friends[fid]; return f && f.name && !f.temporary && !isBlocked(fid); });
    return openPicker({
      mode: 'add', anchor, placement: 'left', candidates,
      max: G().MAX_MEMBERS - seatsUsed(rt),
      emptyKey: anyOther ? 'groups.emptyAllIn' : 'groups.emptyNoFriends',
      onSubmit: async (ids, _name, pop) => {
        const added = [];
        const later = [];
        for (const fid of ids) {
          const res = await G().invite(gid, fid);
          const name = G().displayName(gid, fid);
          const online = window.state.friends[fid] && window.state.friends[fid].online;
          if (res === 'pending' || (res === 'sent' && !online)) later.push(name);
          else if (res === 'sent') added.push(name);
        }
        pop.close();
        if (added.length) window.showToast(tr('groups.addedToast', { names: added.join(', ') }), 'ok');
        if (later.length) window.showToast(tr('groups.addedPendingToast', { names: later.join(', ') }), 'info');
        if (current === gid) renderMembers();
      }
    });
  }

  // ---------- gelen arama kartı ----------
  let ringEl = null;
  // opts.by: "Herkesi çağır" diyen kişi (yoksa aramayı başlatan gösterilir).
  function ring(gid, opts = {}) {
    const call = G().activeCall(gid);
    if (!call || (window.TSStatus && window.TSStatus.isDnd())) return;
    if (G().myCall && G().myCall(gid)) return;
    // Engellenen kişinin başlattığı / çağırdığı arama çalmaz (başlıkta "Katıl" yine görünür).
    if (window.TSBlock && (window.TSBlock.isBlocked(call.startedBy) || (opts.by && window.TSBlock.isBlocked(opts.by)))) return;
    // Aynı grup için kart zaten çalıyorsa yeniden başlatma (çift işaret / birleşen aramalar).
    if (ringEl && ringEl.isConnected && ringEl.dataset.gid === gid && !opts.by) return;
    if (ringEl) ringEl.remove();
    const who = opts.by || call.startedBy;
    ringEl = document.createElement('div');
    ringEl.className = 'grp-ring';
    ringEl.dataset.gid = gid;
    ringEl.setAttribute('data-i18n-ignore', '');
    ringEl.innerHTML = `
      <div class="grp-ring-av">${avatarFor(gid, who, 48)}</div>
      <div class="grp-ring-copy">
        <strong>${esc(G().displayName(gid, who))}</strong>
        <span>${esc(tr('groups.ringing', { group: G().groupTitle(gid) }))}</span>
      </div>
      <button type="button" class="grp-ring-btn is-join" data-ring="join" title="${esc(tr('groups.join'))}" aria-label="${esc(tr('groups.join'))}">${ico('phone', 20) || PHONE_SVG}</button>
      <button type="button" class="grp-ring-btn is-decline" data-ring="decline" title="${esc(tr('groups.decline'))}" aria-label="${esc(tr('groups.decline'))}">${ico('x', 20) || '×'}</button>`;
    document.body.appendChild(ringEl);
    if (typeof window.startRingLoop === 'function') window.startRingLoop('ring', 30000);
    else if (typeof window.playSound === 'function') window.playSound('on');
    const el = ringEl;
    const timer = setTimeout(() => {
      if (ringEl === el) { el.remove(); ringEl = null; if (window.stopRingLoop) window.stopRingLoop(); }
    }, 30000);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-ring]');
      if (!b) return;
      clearTimeout(timer);
      el.remove();
      if (ringEl === el) ringEl = null;
      if (window.stopRingLoop) window.stopRingLoop();
      if (b.dataset.ring === 'join') {
        if (window.TSShell) window.TSShell.setView('group', gid);
        // Arama bu arada bittiyse sessiz başlar: kimse yeniden çaldırılmaz.
        G().startOrJoinCall(gid, { ring: false });
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
      const act = b.dataset.grpCall;
      if (act === 'leave') {
        if (window.stopRingLoop) window.stopRingLoop();
        G().leaveCall(current);
      } else if (act === 'callring') {
        const res = G().ringMissing(current);
        if (res === 'sent') window.showToast(tr('groups.ringSent'), 'ok');
        else if (res === 'wait') window.showToast(tr('groups.ringWait'), 'info');
      } else {
        // "Herkesi ara": arayan tarafta kısa süre çalma sesi; "Toplantı başlat" sessiz.
        if (act === 'ringall' && window.startRingLoop) window.startRingLoop('ringback', 9000);
        G().startOrJoinCall(current, { ring: act === 'ringall' || act === 'start' });
      }
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
        showMemberCard(fid, who);
      }
    });
    $('grp-members-panel')?.addEventListener('click', async e => {
      const addFriend = e.target.closest('[data-grp-addfriend]');
      if (addFriend) {
        addFriend.disabled = true;
        if (typeof window.sendFriendRequestTo === 'function') await window.sendFriendRequestTo(addFriend.dataset.grpAddfriend);
        renderMembers();
        return;
      }
      const block = e.target.closest('[data-grp-block]');
      if (block) {
        const fid = block.dataset.grpBlock;
        if (window.TSFriends) await window.TSFriends.confirmBlock(fid, G().displayName(current, fid));
        renderMembers();
        return;
      }
      const who = e.target.closest('[data-grp-profile]');
      if (who) { showMemberCard(who.dataset.grpProfile, who); return; }
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
    // Arkadaş olmayan üyenin profili geldi / engel listesi değişti → üye paneli tazelenir.
    document.addEventListener('ts:profile', e => {
      const fid = e.detail && e.detail.fid;
      const rt = current && G() && G().get(current);
      if (rt && fid && rt.rec.members.some(m => m.fid === fid)) renderMembers();
    });
    document.addEventListener('ts:blocklist', () => { if (current) renderMembers(); });
    window.addEventListener('focus', () => { if (current && isViewing(current)) G().markRead(current); });
    if (window.TSTyping) window.TSTyping.onRender('grp:', renderTyping);
  }

  document.addEventListener('DOMContentLoaded', bind);

  window.TSGroupUI = { show, isViewing, listItems, stackHtml, openCreate, openAddMembers, ring, current: () => current, renderMessages };
})();
