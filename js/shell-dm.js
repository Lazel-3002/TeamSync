// Direkt mesajlar: yan sütundaki sohbet listesi (Sabitlenenler / Sohbetler,
// filtre çipleri, son mesaj önizlemesi + saat, okunmamış sayaçları) ve DM
// görünümü (çevrimiçi / son görülme başlığı, baloncuklu mesajlar, profil paneli).
// Mesaj gönderme/alma hâlâ renderer.js'teki sendDMText/receiveDM'de; bu dosya
// yalnızca görünümü ve okunmamış/gizlenmiş/sabitlenmiş sohbet durumunu yönetir.
(function () {
  const $ = id => document.getElementById(id);
  const UNREAD_KEY = fid => `teamsync_dm_unread_${fid}`;
  const HIDDEN_KEY = fid => `teamsync_dm_hidden_${fid}`;
  const PIN_KEY = fid => `teamsync_chat_pins_${fid}`;
  const PANEL_KEY = 'teamsync_dm_profile_panel';
  const FILTER_KEY = 'teamsync_chat_filter';
  const COLLAPSE_KEY = 'teamsync_chat_collapsed';
  const GROUP_GAP = 7 * 60 * 1000;
  const REACT_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
  const MORE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
  const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  const PIN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
  const USER_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>';
  const X_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  let unread = {};
  let hiddenAt = {};
  let pins = [];
  let loadedFor = null;
  let filter = null;
  let collapsed = {};
  try { filter = localStorage.getItem(FILTER_KEY) || null; } catch (e) {}
  try { collapsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}') || {}; } catch (e) { collapsed = {}; }

  const { esc, tr } = { esc: v => window.TSUI.esc(v), tr: (k, v) => window.TSUI.tr(k, v) };

  function ensureLoaded() {
    const fid = window.state.friendId;
    if (!fid || loadedFor === fid) return;
    loadedFor = fid;
    try { unread = JSON.parse(localStorage.getItem(UNREAD_KEY(fid)) || '{}') || {}; } catch (e) { unread = {}; }
    try { hiddenAt = JSON.parse(localStorage.getItem(HIDDEN_KEY(fid)) || '{}') || {}; } catch (e) { hiddenAt = {}; }
    try { pins = JSON.parse(localStorage.getItem(PIN_KEY(fid)) || '[]'); } catch (e) { pins = []; }
    if (!Array.isArray(pins)) pins = [];
  }

  function persist() {
    const fid = window.state.friendId;
    if (!fid) return;
    try {
      localStorage.setItem(UNREAD_KEY(fid), JSON.stringify(unread));
      localStorage.setItem(HIDDEN_KEY(fid), JSON.stringify(hiddenAt));
      localStorage.setItem(PIN_KEY(fid), JSON.stringify(pins));
    } catch (e) {}
  }

  function totalUnread() {
    ensureLoaded();
    const groupsUnread = window.TSGroups ? window.TSGroups.totalUnread() : 0;
    return Object.values(unread).reduce((a, b) => a + (Number(b) || 0), 0) + groupsUnread;
  }

  function lastTimestamp(fid) {
    const list = (window.state.dms || {})[fid] || [];
    const last = list[list.length - 1];
    return last ? (last.timestamp || 0) : 0;
  }

  function isViewing(fid) {
    return window.TSShell && window.TSShell.isActive() && window.TSShell.view() === 'dm'
      && window.state.activeDM === fid && document.hasFocus();
  }

  // renderer.js receiveDM → her gelen mesajda çağrılır.
  function onReceived(fid) {
    ensureLoaded();
    if (hiddenAt[fid]) delete hiddenAt[fid];
    if (!isViewing(fid)) unread[fid] = (unread[fid] || 0) + 1;
    persist();
    renderList();
    if (window.TSFriends) window.TSFriends.renderBadges();
  }

  function clearUnread(fid) {
    ensureLoaded();
    if (!unread[fid]) return;
    delete unread[fid];
    persist();
    renderList();
    if (window.TSFriends) window.TSFriends.renderBadges();
  }

  window.addEventListener('focus', () => {
    const fid = window.state.activeDM;
    if (fid && isViewing(fid)) clearUnread(fid);
  });

  function unhide(fid) {
    ensureLoaded();
    if (hiddenAt[fid]) { delete hiddenAt[fid]; persist(); }
  }

  // ---------- Yan sütun listesi ----------
  function listIds() {
    ensureLoaded();
    const dms = window.state.dms || {};
    const friends = window.state.friends || {};
    const ids = new Set(Object.keys(dms).filter(fid => (dms[fid] || []).length && friends[fid]));
    if (window.state.activeDM && friends[window.state.activeDM]) ids.add(window.state.activeDM);
    return Array.from(ids)
      .filter(fid => !hiddenAt[fid] || lastTimestamp(fid) > hiddenAt[fid] || fid === currentDmView())
      .sort((a, b) => lastTimestamp(b) - lastTimestamp(a));
  }

  function currentDmView() {
    return window.TSShell && window.TSShell.view() === 'dm' ? window.TSShell.viewParam() : null;
  }

  function subLine(fid) {
    const p = window.TSStatus ? window.TSStatus.presenceOf(fid) : null;
    if (p && p.act) return { cls: 'is-activity', html: `${esc(tr('activity.playingLine', { name: p.act.n }))}` };
    if (p && p.cs) return { cls: '', html: `${p.cs.e ? esc(p.cs.e) + ' ' : ''}${esc(p.cs.t || '')}` };
    return null;
  }

  // Son mesajın tek satırlık önizlemesi: "Siz: Bir resim gönderdi" gibi.
  function previewOf(m) {
    if (!m) return '';
    let text;
    if (m.type === 'image') text = tr('chat.sentPhoto');
    else if (m.type === 'video') text = tr('chat.sentVideo');
    else if (m.type === 'file') text = tr('chat.sentFile');
    else text = m.isCensored ? '•••' : String(m.content || '').replace(/\s+/g, ' ').trim();
    return m.sender === 'me' ? tr('chat.you', { text }) : text;
  }

  function uiLocale() {
    try { return document.documentElement.lang || undefined; } catch (e) { return undefined; }
  }

  // Listede kısa zaman: bugün → 21:35, dün → Dün, bu hafta → Çar, daha eski → 11.10
  function shortTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (days <= 0) return fmtTime(ts);
    if (days === 1) return tr('dm.yesterday');
    try {
      if (days < 7) return new Intl.DateTimeFormat(uiLocale(), { weekday: 'short' }).format(d);
      const sameYear = d.getFullYear() === now.getFullYear();
      return new Intl.DateTimeFormat(uiLocale(), sameYear ? { day: 'numeric', month: 'numeric' } : { day: 'numeric', month: 'numeric', year: '2-digit' }).format(d);
    } catch (e) { return d.toLocaleDateString(); }
  }

  const pinKey = item => (item.gid ? `g:${item.gid}` : `f:${item.fid}`);
  function isPinned(item) { ensureLoaded(); return pins.includes(pinKey(item)); }
  function togglePin(item) {
    ensureLoaded();
    const k = pinKey(item);
    pins = pins.includes(k) ? pins.filter(x => x !== k) : [k].concat(pins);
    persist();
    renderList();
  }

  function setFilter(next) {
    filter = filter === next ? null : next;
    try { if (filter) localStorage.setItem(FILTER_KEY, filter); else localStorage.removeItem(FILTER_KEY); } catch (e) {}
    renderList();
  }

  function renderList() {
    const host = $('dm-list');
    if (!host) return;
    ensureLoaded();
    document.querySelectorAll('#chat-filters [data-cf]').forEach(b => {
      b.classList.toggle('active', b.dataset.cf === filter);
      b.setAttribute('aria-pressed', b.dataset.cf === filter ? 'true' : 'false');
    });
    const active = currentDmView();
    const activeGroup = window.TSShell && window.TSShell.view() === 'group' ? window.TSShell.viewParam() : null;
    const friends = window.state.friends || {};
    const dms = window.state.dms || {};
    const items = listIds().map(fid => {
      const list = dms[fid] || [];
      const st = window.TSStatus ? window.TSStatus.statusOf(fid) : (friends[fid] && friends[fid].online ? 'online' : 'offline');
      return { fid, ts: lastTimestamp(fid), unread: unread[fid] || 0, online: st !== 'offline' && st !== 'invisible', st, last: list[list.length - 1] };
    });
    (window.TSGroups ? window.TSGroups.list() : [])
      .forEach(g => items.push({ gid: g.gid, ts: g.lastTs || 0, unread: g.unread || 0, online: !!g.call, g }));
    if (!items.length) {
      host.innerHTML = `<li class="dm-list-empty">${esc(tr('chat.startHint'))}</li>`;
      return;
    }
    const pass = it => !filter
      || (filter === 'unread' && it.unread > 0)
      || (filter === 'groups' && !!it.gid)
      || (filter === 'online' && it.online);
    const shown = items.filter(it => pass(it) || it.fid === active || it.gid === activeGroup).sort((a, b) => b.ts - a.ts);
    if (!shown.length) {
      host.innerHTML = `<li class="dm-list-empty">${esc(tr('chat.noFilterMatch'))}</li>`;
      return;
    }
    const pinned = shown.filter(isPinned).sort((a, b) => pins.indexOf(pinKey(a)) - pins.indexOf(pinKey(b)));
    const rest = shown.filter(it => !isPinned(it));
    const section = (key, label, list) => {
      if (!list.length) return '';
      const closed = !!collapsed[key];
      return `
        <li class="dm-sec ${closed ? 'is-collapsed' : ''}" data-sec="${key}">
          <button type="button" class="dm-sec-btn" data-sec-toggle="${key}" aria-expanded="${closed ? 'false' : 'true'}">${CHEVRON_SVG}<span>${esc(label)}</span></button>
        </li>
        ${closed ? '' : list.map(it => (it.gid ? groupRowHtml(it) : dmRowHtml(it))).join('')}`;
    };
    host.innerHTML = section('pinned', tr('chat.pinned'), pinned) + section('recent', tr('chat.recent'), rest);

    function moreBtn(it) {
      return `<button type="button" class="dm-row-more" data-row-menu="${esc(pinKey(it))}" title="${esc(tr('dmh.more'))}">${MORE_SVG}</button>`;
    }

    function dmRowHtml(it) {
      const fid = it.fid;
      const f = friends[fid] || {};
      const nick = typeof window.getNickname === 'function' ? window.getNickname(fid) : '';
      const sub = it.last ? { cls: '', html: esc(previewOf(it.last)) } : subLine(fid);
      const n = it.unread;
      return `
        <li class="dm-row chat-row ${fid === active ? 'active' : ''} ${n ? 'has-unread' : ''} ${it.st === 'offline' ? 'is-offline' : ''}" data-fid="${esc(fid)}">
          ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 36, status: it.st })}
          <span class="dm-row-copy">
            <span class="dm-row-top"><span class="dm-row-name">${esc(nick || f.name || fid)}</span><time class="dm-row-time">${esc(shortTime(it.ts))}</time></span>
            <span class="dm-row-sub ${sub ? sub.cls : ''}">${sub ? sub.html : ''}</span>
          </span>
          ${n ? `<span class="ts-count-badge">${n > 99 ? '99+' : n}</span>` : ''}
          ${moreBtn(it)}
        </li>`;
    }

    function groupRowHtml(it) {
      const g = it.g;
      const stack = window.TSGroupUI && window.TSGroupUI.stackHtml ? window.TSGroupUI.stackHtml(g.gid, g.members, 36) : '';
      const sub = g.call
        ? `<span class="dm-row-sub grp-row-call">🔊 ${esc(tr('groups.inCall'))} · ${window.TSUI.sinceHtml(g.call.startedAt)}</span>`
        : `<span class="dm-row-sub">${esc(tr('groups.memberCount', { n: g.members.length }))}</span>`;
      return `
        <li class="dm-row chat-row grp-row ${g.gid === activeGroup ? 'active' : ''} ${g.unread ? 'has-unread' : ''}" data-gid="${esc(g.gid)}">
          ${stack}
          <span class="dm-row-copy">
            <span class="dm-row-top"><span class="dm-row-name">${esc(g.title)}</span><time class="dm-row-time">${esc(shortTime(it.ts))}</time></span>
            ${sub}
          </span>
          ${g.unread ? `<span class="ts-count-badge">${g.unread > 99 ? '99+' : g.unread}</span>` : ''}
          ${moreBtn(it)}
        </li>`;
    }
  }

  function markActive(fid, gid) {
    document.querySelectorAll('#dm-list .dm-row').forEach(li => li.classList.toggle('active', (!!fid && li.dataset.fid === fid) || (!!gid && li.dataset.gid === gid)));
  }

  // Satırın "…" menüsü: sabitle, profil, listeden kaldır.
  function openRowMenu(key, anchor) {
    const isGroup = key.startsWith('g:');
    const id = key.slice(2);
    const item = isGroup ? { gid: id } : { fid: id };
    const row = (icon, action, label, cls = '') => `<button type="button" class="ts-menu-row ${cls}" data-rm="${action}">${icon}<span class="ts-menu-text"><span>${esc(label)}</span></span></button>`;
    const pop = window.TSUI.popover(`
      <div class="ts-menu ts-row-menu">
        ${row(PIN_SVG, 'pin', tr(isPinned(item) ? 'chat.unpin' : 'chat.pin'))}
        ${isGroup ? '' : `${row(USER_SVG, 'profile', tr('dm.toggleProfile'))}<div class="ts-menu-sep"></div>${row(X_SVG, 'close', tr('dmh.closeChat'), 'is-danger')}`}
      </div>`, anchor, { placement: 'right' });
    pop.el.addEventListener('click', e => {
      const b = e.target.closest('[data-rm]');
      if (!b) return;
      pop.close();
      if (b.dataset.rm === 'pin') togglePin(item);
      else if (b.dataset.rm === 'profile' && window.TSProfile) window.TSProfile.showCard({ friendId: id }, anchor);
      else if (b.dataset.rm === 'close') hideChat(id);
    });
  }

  function hideChat(fid) {
    ensureLoaded();
    hiddenAt[fid] = Date.now();
    delete unread[fid];
    persist();
    if (currentDmView() === fid && window.TSShell) window.TSShell.setView('friends');
    renderList();
    if (window.TSFriends) window.TSFriends.renderBadges();
  }

  // ---------- DM görünümü ----------
  function panelOpen() {
    // Varsayılan kapalı; kullanıcı açarsa hatırlanır.
    try { return localStorage.getItem(PANEL_KEY) === '1'; } catch (e) { return false; }
  }

  // "Çevrimiçi" / "Uzakta" / "Son görülme 3 saat önce". Son görülme zamanını
  // js/teams/shell-teams.js (TSLastSeen) tutar; yoksa yalnızca "Çevrimdışı".
  function presenceText(fid) {
    const st = window.TSStatus ? window.TSStatus.statusOf(fid) : 'offline';
    const f = (window.state.friends || {})[fid] || {};
    if (f.room && st !== 'offline' && st !== 'invisible') return { st, text: tr('presence.inCall') };
    if (st === 'online') return { st, text: tr('presence.online') };
    if (st === 'idle') return { st, text: tr('presence.away') };
    if (st === 'dnd') return { st, text: tr('presence.busy') };
    const when = window.TSLastSeen ? window.TSLastSeen.label(fid) : '';
    return { st: 'offline', text: when ? tr('presence.lastSeen', { when }) : tr('presence.offline') };
  }

  function renderHeader(fid) {
    const f = (window.state.friends || {})[fid] || {};
    const st = window.TSStatus ? window.TSStatus.statusOf(fid) : 'offline';
    const p = window.TSStatus ? window.TSStatus.presenceOf(fid) : null;
    const who = $('dmh-who');
    if (who) {
      const pres = presenceText(fid);
      const extra = p && p.cs ? `${p.cs.e ? p.cs.e + ' ' : ''}${p.cs.t || ''}` : (p && p.act ? tr('activity.playingLine', { name: p.act.n }) : '');
      const nick = typeof window.getNickname === 'function' ? window.getNickname(fid) : '';
      who.innerHTML = `
        ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 32, status: st })}
        <span class="dmh-copy">
          <span class="dmh-name">${esc(nick || f.name || fid)}</span>
          <span class="dmh-sub dmh-presence s-${esc(pres.st)}">${esc(pres.text)}${extra ? ` · ${esc(extra)}` : ''}</span>
        </span>`;
    }
    const input = $('dm-input');
    if (input) input.placeholder = tr('composer.placeholder');
    const panel = $('dm-profile-panel');
    const open = panelOpen();
    $('view-dm')?.classList.toggle('panel-open', open);
    $('dmh-profile-toggle')?.classList.toggle('active', open);
    if (panel && open && window.TSProfile) {
      if (window.TSProfile.request) window.TSProfile.request(fid);
      const m = window.TSProfile.friendModel(fid);
      panel.innerHTML = window.TSProfile.cardHtml(m, { cls: 'pc-panel' });
    }
    document.dispatchEvent(new CustomEvent('ts:dm-header', { detail: { fid } }));
  }

  function show(fid) {
    if (!fid) return;
    unhide(fid);
    if (window.state.activeDM !== fid && typeof window.openDM === 'function') {
      // openDM → renderDMs; görünüme kendi yolumuzla geldiysek aktif DM'yi eşitle.
      window.state.activeDM = fid;
      if (!window.state.dms[fid]) window.state.dms[fid] = [];
      if (typeof window.renderDMs === 'function') window.renderDMs();
    }
    renderHeader(fid);
    clearUnread(fid);
    renderList();
    setTimeout(() => $('dm-input')?.focus(), 30);
  }

  // ---------- Baloncuklu mesaj listesi ----------
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return tr('dm.today');
    if (same(d, y)) return tr('dm.yesterday');
    try { return new Intl.DateTimeFormat(uiLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(d); } catch (e) { return d.toDateString(); }
  }

  const fmtTime = ts => (typeof window.formatUserTime === 'function' ? window.formatUserTime(new Date(ts)) : new Date(ts).toLocaleTimeString());

  // rendered: [{ m, html }] — html: mesajın içerik HTML'i (renderer.js dmContentHtml)
  // Düzen: karşı taraf solda (küçük avatar + ad + saat), siz sağda (yalnızca saat).
  function groupedHtml(fid, rendered) {
    const f = (window.state.friends || {})[fid] || {};
    const intro = `
      <div class="dmx-intro">
        ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 64 })}
        <h2>${esc(f.name || fid)}</h2>
        <div class="dmx-intro-id">${esc(fid)}</div>
        <p>${esc(tr('dm.startOfHistory', { name: f.name || fid }))}</p>
      </div>`;
    if (!rendered.length) return `${intro}<div class="dmx-empty">${esc(tr('dm.noMessages'))}</div>`;
    let out = intro;
    let prev = null;
    let groupOpen = false;
    const closeGroup = () => { if (groupOpen) { out += '</div></div>'; groupOpen = false; } };
    rendered.forEach(({ m, html }) => {
      const ts = m.timestamp || 0;
      const sameDay = prev && new Date(prev.timestamp || 0).toDateString() === new Date(ts).toDateString();
      if (!prev || !sameDay) {
        closeGroup();
        if (ts) out += `<div class="dmx-day"><span>${esc(dayLabel(ts))}</span></div>`;
      }
      const cont = prev && sameDay && prev.sender === m.sender && ts - (prev.timestamp || 0) < GROUP_GAP;
      if (!cont) {
        closeGroup();
        const isMe = m.sender === 'me';
        const name = f.name || fid;
        const when = ts ? `<time title="${esc(dayLabel(ts))} ${esc(fmtTime(ts))}">${esc(fmtTime(ts))}</time>` : '';
        out += `
          <div class="dmx-group" data-sender="${isMe ? 'me' : 'them'}">
            ${isMe ? '' : `<button type="button" class="dmx-av" data-dmx-profile="${esc(fid)}">${window.TSUI.avatarHtml({ src: f.avatar, name, seed: fid, size: 32 })}</button>`}
            <div class="dmx-main">
              <div class="dmx-head">${isMe ? '' : `<button type="button" class="dmx-name" data-dmx-profile="${esc(fid)}">${esc(name)}</button>`}${when}</div>`;
        groupOpen = true;
      }
      const tools = m.id ? `<div class="msg-tools"><button type="button" class="msg-tool" data-react-open="${esc(m.id)}" title="${esc(tr('emoji.addReaction'))}">${REACT_SVG}</button></div>` : '';
      const media = m.type === 'image' || m.type === 'video' ? 'is-media' : (m.type === 'file' ? 'is-file' : '');
      out += `<div class="dmx-msg dm-msg ${m.sender === 'me' ? 'sent' : 'recv'} ${media} ${m.pending ? 'is-pending' : ''}" ${m.id ? `data-mid="${esc(m.id)}"` : ''}>${cont && ts ? `<time class="dmx-hover-time">${esc(fmtTime(ts))}</time>` : ''}${tools}<div class="dmx-content">${html}</div></div>`;
      prev = m;
    });
    closeGroup();
    return out;
  }

  function bind() {
    $('chat-filters')?.addEventListener('click', e => {
      const chip = e.target.closest('[data-cf]');
      if (chip) setFilter(chip.dataset.cf);
    });
    $('dm-list')?.addEventListener('click', e => {
      const sec = e.target.closest('[data-sec-toggle]');
      if (sec) {
        const k = sec.dataset.secToggle;
        collapsed[k] = !collapsed[k];
        try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch (err) {}
        renderList();
        return;
      }
      const more = e.target.closest('[data-row-menu]');
      if (more) {
        e.stopPropagation();
        openRowMenu(more.dataset.rowMenu, more);
        return;
      }
      const close = e.target.closest('[data-close]');
      if (close) {
        e.stopPropagation();
        hideChat(close.dataset.close);
        return;
      }
      const grp = e.target.closest('[data-gid]');
      if (grp && window.TSShell) { window.TSShell.setView('group', grp.dataset.gid); return; }
      const row = e.target.closest('[data-fid]');
      if (row && typeof window.openDM === 'function') window.openDM(row.dataset.fid);
    });
    $('dm-list')?.addEventListener('contextmenu', e => {
      const row = e.target.closest('[data-fid], [data-gid]');
      if (!row) return;
      e.preventDefault();
      openRowMenu(row.dataset.gid ? `g:${row.dataset.gid}` : `f:${row.dataset.fid}`, row);
    });
    $('dmh-who')?.addEventListener('click', e => {
      const fid = window.state.activeDM;
      if (fid && window.TSProfile) window.TSProfile.showCard({ friendId: fid, placement: 'bottom' }, e.currentTarget);
    });
    $('dmh-profile-toggle')?.addEventListener('click', () => {
      try { localStorage.setItem(PANEL_KEY, panelOpen() ? '0' : '1'); } catch (e) {}
      if (window.state.activeDM) renderHeader(window.state.activeDM);
    });
    $('dm-messages')?.addEventListener('click', e => {
      const who = e.target.closest('[data-dmx-profile]');
      if (!who || !window.TSProfile) return;
      if (who.dataset.dmxProfile === 'self') window.TSProfile.showCard({ self: true }, who);
      else window.TSProfile.showCard({ friendId: who.dataset.dmxProfile }, who);
    });
    $('dm-profile-panel')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-pc-action]');
      if (!btn) return;
      const fid = window.state.activeDM;
      if (btn.dataset.pcAction === 'copy-id') window.TSUI.copyText(fid);
    });
    const refresh = e => {
      const fid = e && e.detail && e.detail.fid;
      renderList();
      if (window.TSShell && window.TSShell.view() === 'dm' && (!fid || fid === window.state.activeDM)) renderHeader(window.state.activeDM);
    };
    document.addEventListener('ts:presence', refresh);
    document.addEventListener('ts:profile', refresh);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    // openDM / openServerDM artık DM görünümüne gider (arama arka planda sürer).
    const origOpen = window.openDM;
    if (typeof origOpen === 'function') {
      window.openDM = fid => {
        origOpen(fid);
        if (window.TSShell && window.TSShell.isActive() && window.state.friends[fid]) {
          unhide(fid);
          window.TSShell.setView('dm', fid);
        }
      };
    }
    const origServer = window.openServerDM;
    if (typeof origServer === 'function') {
      window.openServerDM = (targetId, name) => {
        origServer(targetId, name);
        if (window.TSShell && window.TSShell.isActive() && window.state.activeDM) {
          $('server-dm-modal')?.classList.add('hidden');
          window.TSShell.setView('dm', window.state.activeDM);
        }
      };
    }
  });

  window.TSDM = {
    renderList, show, markActive, onReceived, clearUnread, totalUnread, groupedHtml, isViewing,
    presenceText, previewOf, shortTime, dayLabel, hideChat, togglePin, isPinned, renderHeader
  };
})();
