// Direkt mesajlar: yan sütundaki DM listesi (okunmamış sayaçlarıyla) ve
// Discord tarzı DM görünümü (başlık, gruplanmış mesajlar, profil paneli).
// Mesaj gönderme/alma hâlâ renderer.js'teki sendDMText/receiveDM'de; bu dosya
// yalnızca görünümü ve okunmamış/gizlenmiş DM durumunu yönetir.
(function () {
  const $ = id => document.getElementById(id);
  const UNREAD_KEY = fid => `teamsync_dm_unread_${fid}`;
  const HIDDEN_KEY = fid => `teamsync_dm_hidden_${fid}`;
  const PANEL_KEY = 'teamsync_dm_profile_panel';
  const GROUP_GAP = 7 * 60 * 1000;

  let unread = {};
  let hiddenAt = {};
  let loadedFor = null;

  const { esc, tr } = { esc: v => window.TSUI.esc(v), tr: (k, v) => window.TSUI.tr(k, v) };

  function ensureLoaded() {
    const fid = window.state.friendId;
    if (!fid || loadedFor === fid) return;
    loadedFor = fid;
    try { unread = JSON.parse(localStorage.getItem(UNREAD_KEY(fid)) || '{}') || {}; } catch (e) { unread = {}; }
    try { hiddenAt = JSON.parse(localStorage.getItem(HIDDEN_KEY(fid)) || '{}') || {}; } catch (e) { hiddenAt = {}; }
  }

  function persist() {
    const fid = window.state.friendId;
    if (!fid) return;
    try {
      localStorage.setItem(UNREAD_KEY(fid), JSON.stringify(unread));
      localStorage.setItem(HIDDEN_KEY(fid), JSON.stringify(hiddenAt));
    } catch (e) {}
  }

  function totalUnread() {
    ensureLoaded();
    return Object.values(unread).reduce((a, b) => a + (Number(b) || 0), 0);
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

  function renderList() {
    const host = $('dm-list');
    if (!host) return;
    const ids = listIds();
    const active = currentDmView();
    if (!ids.length) {
      host.innerHTML = `<li class="dm-list-empty">${esc(tr('shell.noDms'))}</li>`;
      return;
    }
    const friends = window.state.friends || {};
    host.innerHTML = ids.map(fid => {
      const f = friends[fid] || {};
      const st = window.TSStatus ? window.TSStatus.statusOf(fid) : (f.online ? 'online' : 'offline');
      const sub = subLine(fid);
      const n = unread[fid] || 0;
      const nick = typeof window.getNickname === 'function' ? window.getNickname(fid) : '';
      return `
        <li class="dm-row ${fid === active ? 'active' : ''} ${n ? 'has-unread' : ''} ${st === 'offline' ? 'is-offline' : ''}" data-fid="${esc(fid)}">
          ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 32, status: st })}
          <span class="dm-row-copy">
            <span class="dm-row-name">${esc(nick || f.name || fid)}</span>
            ${sub ? `<span class="dm-row-sub ${sub.cls}">${sub.html}</span>` : ''}
          </span>
          ${n ? `<span class="ts-count-badge">${n > 99 ? '99+' : n}</span>` : ''}
          <button type="button" class="dm-row-close" data-close="${esc(fid)}" title="${esc(tr('shell.closeDm'))}">×</button>
        </li>`;
    }).join('');
  }

  function markActive(fid) {
    document.querySelectorAll('#dm-list .dm-row').forEach(li => li.classList.toggle('active', li.dataset.fid === fid));
  }

  // ---------- DM görünümü ----------
  function panelOpen() {
    try { return localStorage.getItem(PANEL_KEY) !== '0'; } catch (e) { return true; }
  }

  function renderHeader(fid) {
    const f = (window.state.friends || {})[fid] || {};
    const st = window.TSStatus ? window.TSStatus.statusOf(fid) : 'offline';
    const p = window.TSStatus ? window.TSStatus.presenceOf(fid) : null;
    const who = $('dmh-who');
    if (who) {
      const sub = p && p.cs ? `${p.cs.e ? p.cs.e + ' ' : ''}${p.cs.t || ''}` : (p && p.act ? tr('activity.playingLine', { name: p.act.n }) : '');
      who.innerHTML = `
        ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 24, status: st })}
        <span class="dmh-name">${esc(f.name || fid)}</span>
        ${sub ? `<span class="dmh-sub">${esc(sub)}</span>` : ''}`;
    }
    const input = $('dm-input');
    if (input) input.placeholder = tr('dm.messageTo', { name: f.name || fid });
    const panel = $('dm-profile-panel');
    const open = panelOpen();
    $('view-dm')?.classList.toggle('panel-open', open);
    $('dmh-profile-toggle')?.classList.toggle('active', open);
    if (panel && open && window.TSProfile) {
      if (window.TSProfile.request) window.TSProfile.request(fid);
      const m = window.TSProfile.friendModel(fid);
      panel.innerHTML = window.TSProfile.cardHtml(m, { cls: 'pc-panel' });
    }
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

  // ---------- Gruplanmış mesaj listesi ----------
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return tr('dm.today');
    if (same(d, y)) return tr('dm.yesterday');
    let locale;
    try { locale = document.documentElement.lang || undefined; } catch (e) {}
    try { return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(d); } catch (e) { return d.toDateString(); }
  }

  const fmtTime = ts => (typeof window.formatUserTime === 'function' ? window.formatUserTime(new Date(ts)) : new Date(ts).toLocaleTimeString());

  // rendered: [{ m, html }] — html: mesajın içerik HTML'i (renderer.js dmContentHtml)
  function groupedHtml(fid, rendered) {
    const f = (window.state.friends || {})[fid] || {};
    const prof = window.TSProfile ? window.TSProfile.mine() : {};
    const intro = `
      <div class="dmx-intro">
        ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 80 })}
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
        const name = isMe ? (window.state.myName || tr('dm.me')) : (f.name || fid);
        const av = isMe
          ? window.TSUI.avatarHtml({ src: window.state.myAvatar, name, seed: window.state.friendId, size: 40, frame: prof.frame, color: prof.avatarColor })
          : window.TSUI.avatarHtml({ src: f.avatar, name, seed: fid, size: 40 });
        out += `
          <div class="dmx-group" data-sender="${isMe ? 'me' : 'them'}">
            <button type="button" class="dmx-av" data-dmx-profile="${isMe ? 'self' : esc(fid)}">${av}</button>
            <div class="dmx-main">
              <div class="dmx-head"><button type="button" class="dmx-name" data-dmx-profile="${isMe ? 'self' : esc(fid)}">${esc(name)}</button>${ts ? `<time>${esc(dayLabel(ts))} ${esc(fmtTime(ts))}</time>` : ''}</div>`;
        groupOpen = true;
      }
      out += `<div class="dmx-msg dm-msg ${m.sender === 'me' ? 'sent' : 'recv'}" ${m.id ? `data-mid="${esc(m.id)}"` : ''}>${cont && ts ? `<time class="dmx-hover-time">${esc(fmtTime(ts))}</time>` : ''}<div class="dmx-content">${html}</div></div>`;
      prev = m;
    });
    closeGroup();
    return out;
  }

  function bind() {
    $('dm-list')?.addEventListener('click', e => {
      const close = e.target.closest('[data-close]');
      if (close) {
        e.stopPropagation();
        ensureLoaded();
        const fid = close.dataset.close;
        hiddenAt[fid] = Date.now();
        delete unread[fid];
        persist();
        if (currentDmView() === fid && window.TSShell) window.TSShell.setView('friends');
        renderList();
        if (window.TSFriends) window.TSFriends.renderBadges();
        return;
      }
      const row = e.target.closest('[data-fid]');
      if (row && typeof window.openDM === 'function') window.openDM(row.dataset.fid);
    });
    $('dm-list')?.addEventListener('contextmenu', e => {
      const row = e.target.closest('[data-fid]');
      if (!row || !window.TSProfile) return;
      e.preventDefault();
      window.TSProfile.showCard({ friendId: row.dataset.fid }, row);
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

  window.TSDM = { renderList, show, markActive, onReceived, clearUnread, totalUnread, groupedHtml, isViewing };
})();
