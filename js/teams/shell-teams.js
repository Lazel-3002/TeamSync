// Teams'ten esinlenen kabuk parçaları (js/shell-core.js'in üstüne):
//   • TSLastSeen: arkadaşların "son görülme" zamanı (bu cihazda tutulur)
//   • Ray: Takvim, Aramalar, Toplantı (oda kur + ID ile katıl + planla),
//     Ayarlar, hesap menüsü (durum, ID, hesap değiştir)
//   • Sohbet başlığı: sesli/görüntülü arama, kişi ekle, sohbette ara, diğer
//     menüsü ve Sohbet / Dosyalar / Fotoğraflar sekmeleri
//   • Arama ekranı: kontrol çubuğu üst çubuğa taşınır (etiketli düğmeler),
//     süre sayacı, yalnızken "Aranıyor…" sahnesi, birebirde kendi önizlemen
//     sağ altta küçük kutuda.
(function () {
  const $ = id => document.getElementById(id);
  const esc = v => window.TSUI.esc(v);
  const tr = (k, v) => window.TSUI.tr(k, v);
  const svg = (d, w = 20, sw = 2) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    video: '<rect x="2" y="6" width="14" height="12" rx="3"/><path d="M16 10.5 22 7v10l-6-3.5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    bellOff: '<path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.6-.7L3 21l1.6-4.6A8 8 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
    people: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    addUser: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    up: '<polyline points="18 15 12 9 6 15"/>',
    down: '<polyline points="6 9 12 15 18 9"/>'
  };

  // =====================================================================
  // Son görülme
  // =====================================================================
  const TSLastSeen = (() => {
    const KEY = fid => `teamsync_last_seen_${fid}`;
    let map = {};
    let mapFor = null;
    let dirty = false;
    const load = () => {
      const me = window.state && window.state.friendId;
      if (!me || mapFor === me) return;
      mapFor = me;
      try { map = JSON.parse(localStorage.getItem(KEY(me)) || '{}') || {}; } catch (e) { map = {}; }
    };
    const save = () => {
      if (!dirty || !mapFor) return;
      dirty = false;
      try { localStorage.setItem(KEY(mapFor), JSON.stringify(map)); } catch (e) {}
    };
    function scan() {
      load();
      const friends = (window.state && window.state.friends) || {};
      const now = Date.now();
      Object.keys(friends).forEach(fid => {
        const st = window.TSStatus ? window.TSStatus.statusOf(fid) : (friends[fid].online ? 'online' : 'offline');
        if (st !== 'offline' && st !== 'invisible' && friends[fid].online) {
          if (!map[fid] || now - map[fid] > 5000) { map[fid] = now; dirty = true; }
        }
      });
    }
    function label(fid) {
      load();
      const ts = map[fid];
      if (!ts) return '';
      const diff = Date.now() - ts;
      if (diff < 90 * 1000) return tr('presence.justNow');
      if (diff < 60 * 60 * 1000) return tr('presence.minutesAgo', { n: Math.max(1, Math.round(diff / 60000)) });
      const d = new Date(ts);
      const now = new Date();
      const sod = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
      const days = Math.round((sod(now) - sod(d)) / 86400000);
      const time = typeof window.formatUserTime === 'function' ? window.formatUserTime(d) : d.toLocaleTimeString();
      if (days === 0) return tr('presence.hoursAgo', { n: Math.max(1, Math.round(diff / 3600000)) });
      if (days === 1) return tr('presence.yesterday', { time });
      if (days < 7) return tr('presence.daysAgo', { n: days });
      let locale;
      try { locale = document.documentElement.lang || undefined; } catch (e) {}
      try { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(d); } catch (e) { return d.toLocaleDateString(); }
    }
    setInterval(() => { scan(); save(); }, 10000);
    document.addEventListener('ts:presence', () => { scan(); });
    window.addEventListener('beforeunload', () => { scan(); save(); });
    function mark(fid, ts = Date.now()) { load(); map[fid] = ts; dirty = true; save(); }
    return { label, scan, mark, at: fid => { load(); return map[fid] || 0; } };
  })();
  window.TSLastSeen = TSLastSeen;

  // =====================================================================
  // Ray: Toplantı / Hesap / Ayarlar
  // =====================================================================
  function inCall() { return !!(window.TSShell && window.TSShell.inCall()); }

  function meetNow(title) {
    if (inCall()) { window.showToast(tr('shell.youInCall'), 'warn'); window.TSShell.setView('call'); return; }
    if (window.TSDirectCall) window.TSDirectCall.meet(title || '');
  }

  function joinById(id) {
    id = String(id || '').trim();
    if (!id) { window.showToast(tr('meet.needId'), 'warn'); return false; }
    if (inCall()) { window.showToast(tr('shell.youInCall'), 'warn'); window.TSShell.setView('call'); return false; }
    // Eski "ID ile katıl" formunu görünmeden doldurup çalıştırır (aynı doğrulamalar).
    $('btn-show-join')?.click();
    const input = $('join-id');
    const pw = $('join-password');
    if (!input) return false;
    input.value = id;
    if (pw) pw.value = '';
    $('btn-join')?.click();
    return true;
  }

  function openMeetMenu(anchor) {
    const html = `
      <div class="ts-menu meet-menu" data-i18n-ignore>
        <div class="meet-head"><strong>${esc(tr('meet.title'))}</strong><small>${esc(tr('meet.lead'))}</small></div>
        <button type="button" class="ts-menu-card meet-create" data-meet="create">
          <span class="ts-menu-card-icon">${svg(ICON.video, 22)}</span>
          <span><strong>${esc(tr('meet.create'))}</strong><small>${esc(tr('meet.createDesc'))}</small></span>
        </button>
        <form class="meet-join" data-meet-form>
          <label for="meet-join-id">${esc(tr('meet.joinLabel'))}</label>
          <div class="meet-join-row">
            <input id="meet-join-id" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(tr('meet.joinPlaceholder'))}" />
            <button type="submit" class="ts-pill-btn is-primary">${esc(tr('meet.joinBtn'))}</button>
          </div>
        </form>
        <button type="button" class="ts-menu-row" data-meet="schedule">${svg(ICON.cal, 18)}<span class="ts-menu-text"><span>${esc(tr('meet.schedule'))}</span><small>${esc(tr('meet.scheduleDesc'))}</small></span></button>
        <button type="button" class="ts-menu-row" data-meet="advanced">${svg(ICON.link, 18)}<span class="ts-menu-text"><span>${esc(tr('meet.advanced'))}</span></span></button>
      </div>`;
    const pop = window.TSUI.popover(html, anchor, { placement: 'right', cls: 'ts-menu-pop' });
    pop.el.addEventListener('click', e => {
      const b = e.target.closest('[data-meet]');
      if (!b) return;
      pop.close();
      const k = b.dataset.meet;
      if (k === 'create') meetNow();
      else if (k === 'schedule') { window.TSShell.setView('calendar'); setTimeout(() => window.TSCalendar && window.TSCalendar.openEditor(null), 60); }
      else if (k === 'advanced') {
        if (inCall()) { window.showToast(tr('shell.youInCall'), 'warn'); return; }
        window.TSShell.openQuickCall('join');
      }
    });
    pop.el.querySelector('[data-meet-form]')?.addEventListener('submit', e => {
      e.preventDefault();
      const v = pop.el.querySelector('#meet-join-id').value;
      if (joinById(v)) pop.close();
    });
    setTimeout(() => pop.el.querySelector('#meet-join-id')?.focus(), 30);
  }

  function openAccountMenu(anchor) {
    const st = window.TSStatus ? window.TSStatus.effective() : 'online';
    const prof = window.TSProfile ? window.TSProfile.mine() : {};
    const custom = window.TSStatus && window.TSStatus.customActive ? window.TSStatus.customActive() : null;
    const html = `
      <div class="ts-menu acc-menu" data-i18n-ignore>
        <div class="acc-head">
          ${window.TSUI.avatarHtml({ src: window.state.myAvatar, name: window.state.myName, seed: window.state.friendId, size: 48, status: st, frame: prof.frame, color: prof.avatarColor })}
          <span class="acc-copy">
            <strong>${esc(window.state.myName || '')}</strong>
            <small class="acc-status s-${esc(st)}">${esc(window.TSUI.statusLabel(st))}${custom ? ` · ${esc(`${custom.e ? custom.e + ' ' : ''}${custom.t || ''}`)}` : ''}</small>
            <code>${esc(window.state.friendId || '')}</code>
          </span>
        </div>
        <button type="button" class="ts-menu-row" data-acc="profile">${svg(ICON.user, 18)}<span class="ts-menu-text"><span>${esc(tr('acc.editProfile'))}</span><small>${esc(tr('acc.status'))}</small></span></button>
        <button type="button" class="ts-menu-row" data-acc="copy">${svg(ICON.copy, 18)}<span class="ts-menu-text"><span>${esc(tr('acc.copyId'))}</span></span></button>
        <button type="button" class="ts-menu-row" data-acc="settings">${svg(ICON.gear, 18)}<span class="ts-menu-text"><span>${esc(tr('acc.settings'))}</span></span></button>
        <div class="ts-menu-sep"></div>
        <button type="button" class="ts-menu-row" data-acc="switch">${svg(ICON.swap, 18)}<span class="ts-menu-text"><span>${esc(tr('acc.switch'))}</span><small>${esc(tr('acc.switchDesc'))}</small></span></button>
      </div>`;
    const pop = window.TSUI.popover(html, anchor, { placement: 'right', cls: 'ts-menu-pop' });
    pop.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-acc]');
      if (!b) return;
      const k = b.dataset.acc;
      pop.close();
      if (k === 'profile' && window.TSProfile) window.TSProfile.showSelfPanel(anchor);
      else if (k === 'copy') window.TSUI.copyText(window.state.friendId);
      else if (k === 'settings') window.openUserSettings && window.openUserSettings('general');
      else if (k === 'switch') {
        if (window.state.room) {
          const ok = typeof window.showConfirm === 'function' ? await window.showConfirm(tr('acc.switch'), tr('groups.leaveCurrentBody')) : true;
          if (!ok) return;
          window.disconnectApp();
        }
        $('btn-logout')?.click();
      }
    });
  }

  // =====================================================================
  // Sohbet başlığı: arama düğmeleri, diğer menüsü, sekmeler, sohbette ara
  // =====================================================================
  let dmTab = 'chat';
  let dmTabFid = null;

  function activeFid() { return window.state.activeDM; }

  function setDmTab(tab) {
    dmTab = tab;
    const view = $('view-dm');
    if (view) view.dataset.dmtab = tab;
    document.querySelectorAll('#dmh-tabs [data-dmtab]').forEach(b => {
      b.classList.toggle('active', b.dataset.dmtab === tab);
      b.setAttribute('aria-selected', b.dataset.dmtab === tab ? 'true' : 'false');
    });
    $('dm-media-pane')?.classList.toggle('hidden', tab === 'chat');
    if (tab !== 'chat') renderMediaPane();
    else setTimeout(() => $('dm-input')?.focus(), 20);
  }

  function renderMediaPane() {
    const host = $('dm-media-pane');
    const fid = activeFid();
    if (!host || !fid) return;
    const f = (window.state.friends || {})[fid] || {};
    const msgs = ((window.state.dms || {})[fid] || []).filter(m => !m.expired && !m.isCensored && m.content);
    const who = m => (m.sender === 'me' ? (window.state.myName || tr('dm.me')) : (f.name || fid));
    const when = m => (m.timestamp && window.TSDM ? `${window.TSDM.dayLabel(m.timestamp)}` : '');
    if (dmTab === 'photos') {
      const media = msgs.filter(m => m.type === 'image' || m.type === 'video').reverse();
      host.innerHTML = media.length ? `<div class="dm-photos">${media.map(m => {
        const src = esc(m.content);
        const name = esc(m.fileName || '');
        return m.type === 'image'
          ? `<figure class="dm-photo"><img src="${src}" class="chat-img" alt="${name}" data-media-name="${name}" loading="lazy" /><figcaption>${esc(tr('dmh.sharedBy', { name: who(m), when: when(m) }))}</figcaption></figure>`
          : `<figure class="dm-photo is-video"><video src="${src}" controls preload="metadata" playsinline></video><figcaption>${esc(tr('dmh.sharedBy', { name: who(m), when: when(m) }))}</figcaption></figure>`;
      }).join('')}</div>` : `<div class="dm-media-empty">${svg(ICON.file, 40, 1.5)}<p>${esc(tr('dmh.noPhotos'))}</p></div>`;
      return;
    }
    const files = msgs.filter(m => m.type === 'file').reverse();
    host.innerHTML = files.length ? `<ul class="dm-files">${files.map(m => {
      const name = m.fileName || 'dosya';
      const ext = (String(name).split('.').pop() || '').slice(0, 4).toUpperCase();
      return `
        <li class="dm-file-row">
          <span class="dm-file-ico" data-ext="${esc(ext)}">${svg(ICON.file, 22)}<b>${esc(ext)}</b></span>
          <span class="dm-file-copy"><strong>${esc(name)}</strong><small>${esc(tr('dmh.sharedBy', { name: who(m), when: when(m) }))}</small></span>
          <a class="ts-icon-btn" href="${esc(m.content)}" download="${esc(name)}" title="${esc(tr('dmh.download'))}">${svg(ICON.download, 18)}</a>
        </li>`;
    }).join('')}</ul>` : `<div class="dm-media-empty">${svg(ICON.file, 40, 1.5)}<p>${esc(tr('dmh.noFiles'))}</p></div>`;
  }

  // --- Sohbette ara ---
  let findHits = [];
  let findIdx = -1;
  function openFind() {
    const bar = $('dm-find');
    if (!bar) return;
    if (dmTab !== 'chat') setDmTab('chat');
    if (!bar.dataset.ready) {
      bar.dataset.ready = '1';
      bar.innerHTML = `
        ${svg(ICON.search, 16)}
        <input type="text" class="dm-find-input" autocomplete="off" placeholder="${esc(tr('dmh.findPlaceholder'))}" />
        <span class="dm-find-count"></span>
        <button type="button" class="ts-icon-btn" data-find="prev" title="↑">${svg(ICON.up, 16)}</button>
        <button type="button" class="ts-icon-btn" data-find="next" title="↓">${svg(ICON.down, 16)}</button>
        <button type="button" class="ts-icon-btn" data-find="close" title="${esc(tr('common.close'))}">${svg(ICON.x, 16)}</button>`;
      const input = bar.querySelector('input');
      input.addEventListener('input', () => runFind(input.value));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
      });
      bar.addEventListener('click', e => {
        const b = e.target.closest('[data-find]');
        if (!b) return;
        if (b.dataset.find === 'close') closeFind(); else stepFind(b.dataset.find === 'prev' ? -1 : 1);
      });
    }
    bar.classList.remove('hidden');
    $('dmh-search')?.classList.add('active');
    const input = bar.querySelector('input');
    input.focus();
    input.select();
    if (input.value) runFind(input.value);
  }
  function closeFind() {
    const bar = $('dm-find');
    if (!bar) return;
    bar.classList.add('hidden');
    $('dmh-search')?.classList.remove('active');
    clearFind();
  }
  function clearFind() {
    findHits = [];
    findIdx = -1;
    const box = $('dm-messages');
    box?.classList.remove('is-finding');
    box?.querySelectorAll('.find-hit, .find-current').forEach(el => el.classList.remove('find-hit', 'find-current'));
  }
  function runFind(q) {
    clearFind();
    const box = $('dm-messages');
    const count = document.querySelector('#dm-find .dm-find-count');
    q = String(q || '').trim().toLocaleLowerCase();
    if (!box || !q) { if (count) count.textContent = ''; return; }
    box.classList.add('is-finding');
    findHits = Array.from(box.querySelectorAll('.dmx-msg')).filter(el => (el.querySelector('.dmx-content')?.textContent || '').toLocaleLowerCase().includes(q));
    findHits.forEach(el => el.classList.add('find-hit'));
    if (count) count.textContent = findHits.length ? tr('dmh.findCount', { n: findHits.length }) : tr('dmh.findNone');
    findIdx = findHits.length;
    stepFind(-1);
  }
  function stepFind(dir) {
    if (!findHits.length) return;
    findHits[findIdx]?.classList.remove('find-current');
    findIdx = (findIdx + dir + findHits.length) % findHits.length;
    const el = findHits[findIdx];
    el.classList.add('find-current');
    el.scrollIntoView({ block: 'center' });
  }

  function openDmMore(anchor) {
    const fid = activeFid();
    if (!fid) return;
    const f = (window.state.friends || {})[fid] || {};
    const pinned = window.TSDM && window.TSDM.isPinned({ fid });
    const row = (icon, k, label, cls = '') => `<button type="button" class="ts-menu-row ${cls}" data-dm-more="${k}">${svg(icon, 18)}<span class="ts-menu-text"><span>${esc(label)}</span></span></button>`;
    const pop = window.TSUI.popover(`
      <div class="ts-menu ts-row-menu" data-i18n-ignore>
        ${row(ICON.user, 'profile', tr('dm.toggleProfile'))}
        ${row(ICON.pin, 'pin', tr(pinned ? 'chat.unpin' : 'chat.pin'))}
        ${row(f.isMuted ? ICON.bell : ICON.bellOff, 'mute', tr(f.isMuted ? 'dmh.unmute' : 'dmh.mute'))}
        ${row(ICON.copy, 'copy', tr('dmh.copyId'))}
        <div class="ts-menu-sep"></div>
        ${row(ICON.x, 'close', tr('dmh.closeChat'), 'is-danger')}
      </div>`, anchor, { placement: 'bottom' });
    pop.el.addEventListener('click', e => {
      const b = e.target.closest('[data-dm-more]');
      if (!b) return;
      pop.close();
      const k = b.dataset.dmMore;
      if (k === 'profile') $('dmh-profile-toggle')?.click();
      else if (k === 'pin' && window.TSDM) window.TSDM.togglePin({ fid });
      else if (k === 'mute' && typeof window.toggleMuteFriend === 'function') window.toggleMuteFriend(fid);
      else if (k === 'copy') window.TSUI.copyText(fid);
      else if (k === 'close' && window.TSDM) window.TSDM.hideChat(fid);
    });
  }

  // =====================================================================
  // Arama ekranı
  // =====================================================================
  const TOOL_LABELS = {
    'btn-call-chat': 'call.toolChat',
    'btn-call-people': 'call.toolPeople',
    'btn-show-server-invites': 'call.toolInvite',
    'mic': 'call.toolMic',
    'deaf': 'call.toolDeafen',
    'ptt': 'call.toolPtt',
    'share': 'call.toolShare',
    'wb-btn': 'call.toolBoard',
    'act-btn': 'call.toolActivity',
    'rec': 'call.toolRecord',
    'vol': 'call.toolVolume',
    'founder-settings': 'call.toolFounder',
    'settings': 'call.toolSettings',
    'leave': 'call.toolLeave'
  };

  function setLabel(btn, key) {
    let lbl = btn.querySelector(':scope > .lbl');
    if (!lbl) {
      lbl = document.createElement('span');
      lbl.className = 'lbl';
      btn.appendChild(lbl);
    }
    lbl.setAttribute('data-i18n', key);
    lbl.textContent = tr(key);
  }

  function buildCallToolbar() {
    const topBar = document.querySelector('#app .top-bar');
    const bar = document.querySelector('#app .bar');
    if (!topBar || !bar || topBar.dataset.teams) return;
    topBar.dataset.teams = '1';
    topBar.classList.add('call-topbar');
    // Sol: süre + oda adı + oda ID'si (kopyala)
    const lead = topBar.querySelector('.call-topbar-lead');
    if (lead) {
      const timer = document.createElement('span');
      timer.id = 'call-timer';
      timer.className = 'call-timer';
      timer.setAttribute('data-i18n-ignore', '');
      timer.textContent = '--:--';
      lead.prepend(timer);
      lead.querySelector('svg')?.remove();
      const idChip = document.createElement('span');
      idChip.className = 'call-id-chip';
      const label = topBar.querySelector(':scope > span:not(#display-server-id)');
      if (label) label.remove();
      const idEl = $('display-server-id');
      const copy = $('btn-copy-id');
      if (idEl) { idEl.removeAttribute('style'); idChip.appendChild(idEl); }
      if (copy) {
        copy.removeAttribute('style');
        copy.className = 'call-id-copy';
        copy.setAttribute('data-i18n-title', 'call.copyRoomId');
        copy.title = tr('call.copyRoomId');
        idChip.appendChild(copy);
      }
      lead.appendChild(idChip);
    }
    topBar.querySelectorAll(':scope > div[style*="width: 1px"]').forEach(el => el.remove());

    // Sağ: etiketli düğme grupları — Sohbet/Kişiler/Davet | Diğer | Mikrofon/Kulaklık/Paylaş | Ayrıl.
    // Az kullanılanlar (Tahta, Etkinlik, Kayıt, Ses düzeyi, Kurucu, Ayarlar) "Diğer"
    // menüsünde durur; kısayollar (W/E/R) gizli düğmeye .click() ile çalışmaya devam eder.
    const mk = cls => { const g = document.createElement('div'); g.className = `bar-group ${cls}`; return g; };
    const gView = mk('bar-view');
    const gTools = mk('bar-tools');
    const gMedia = mk('bar-media');
    const more = document.createElement('button');
    more.id = 'btn-call-more';
    more.type = 'button';
    more.className = 'btn call-more-btn';
    more.setAttribute('aria-haspopup', 'true');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('data-i18n-title', 'call.toolMore');
    more.title = tr('call.toolMore');
    more.innerHTML = svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>', 20);
    gTools.appendChild(more);
    const panel = document.createElement('div');
    panel.id = 'call-more-panel';
    panel.className = 'call-more-panel hidden';
    panel.setAttribute('role', 'menu');
    const gLeave = bar.querySelector('.call-leave-group') || mk('call-leave-group');

    const chatBtn = $('btn-call-chat');
    if (chatBtn) { chatBtn.classList.add('btn'); gView.appendChild(chatBtn); }
    const people = document.createElement('button');
    people.id = 'btn-call-people';
    people.type = 'button';
    people.className = 'btn call-chat-btn';
    people.setAttribute('data-i18n-title', 'call.people');
    people.title = tr('call.people');
    people.innerHTML = svg(ICON.people, 20);
    gView.appendChild(people);
    const invite = $('btn-show-server-invites');
    if (invite) {
      invite.removeAttribute('style');
      invite.className = 'btn call-invite-btn';
      invite.innerHTML = svg(ICON.addUser, 20);
      invite.setAttribute('data-i18n-title', 'call.inviteSomeone');
      invite.title = tr('call.inviteSomeone');
      gView.appendChild(invite);
    }
    const volWrap = bar.querySelector('.vol-wrap');
    ['wb-btn', 'act-btn', 'rec'].forEach(id => { const b = $(id); if (b) panel.appendChild(b); });
    if (volWrap) panel.appendChild(volWrap);
    ['founder-settings', 'settings'].forEach(id => { const b = $(id); if (b) panel.appendChild(b); });
    ['mic', 'deaf', 'ptt', 'share'].forEach(id => { const b = $(id); if (b) gMedia.appendChild(b); });
    Array.from(bar.querySelectorAll(':scope > .bar-group')).forEach(g => { if (g !== gLeave) g.remove(); });
    bar.prepend(gView, gTools, gMedia);
    bar.appendChild(gLeave);
    Object.keys(TOOL_LABELS).forEach(id => { const b = $(id) || panel.querySelector(`#${id}`); if (b) setLabel(b, TOOL_LABELS[id]); });
    setLabel(more, 'call.toolMore');
    topBar.appendChild(bar);
    // Panel .main içinde durur: .bar yatay kaydırılabildiği için (overflow) içinde kırpılırdı.
    const main = topBar.parentElement;
    main.appendChild(panel);
    const placePanel = () => {
      const m = main.getBoundingClientRect();
      const r = more.getBoundingClientRect();
      const w = panel.offsetWidth || 240;
      panel.style.top = `${r.bottom - m.top + 6}px`;
      panel.style.left = `${Math.max(8, Math.min(r.left - m.left, m.width - w - 8))}px`;
    };
    const setMore = open => {
      panel.classList.toggle('hidden', !open);
      more.classList.toggle('active', open);
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) placePanel();
      else $('volpop')?.classList.add('hidden');
    };
    more.addEventListener('click', e => { e.stopPropagation(); setMore(panel.classList.contains('hidden')); });
    panel.addEventListener('click', e => {
      // Ses düzeyi kendi açılır kaydırıcısını gösterir; diğerleri menüyü kapatır.
      const b = e.target.closest('button');
      if (b && b.id !== 'vol' && !e.target.closest('#volpop')) setMore(false);
    });
    document.addEventListener('mousedown', e => {
      if (panel.classList.contains('hidden')) return;
      if (e.target.closest('#call-more-panel, #btn-call-more')) return;
      setMore(false);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.classList.contains('hidden')) setMore(false); });
    window.addEventListener('resize', () => { if (!panel.classList.contains('hidden')) placePanel(); });

    people.addEventListener('click', () => {
      const app = $('app');
      const side = document.querySelector('#app > aside.sidebar');
      const open = app.classList.contains('side-open') && side && side.dataset.tab === 'people';
      window.TSShell.setCallSide(!open, 'people');
      people.classList.toggle('active', !open);
    });
    // Yan panel durumuyla düğme vurgularını eşitle.
    const sideEl = document.querySelector('#app > aside.sidebar');
    const syncSideBtns = () => {
      const open = $('app').classList.contains('side-open');
      const tab = sideEl ? sideEl.dataset.tab : '';
      chatBtn?.classList.toggle('active', open && tab === 'chat');
      people.classList.toggle('active', open && tab === 'people');
    };
    new MutationObserver(syncSideBtns).observe($('app'), { attributes: true, attributeFilter: ['class'] });
    if (sideEl) new MutationObserver(syncSideBtns).observe(sideEl, { attributes: true, attributeFilter: ['data-tab'] });

    // Orta sahne: yalnızken büyük avatar + "Aranıyor…" / "Bekleniyor"
    const stage = document.createElement('div');
    stage.id = 'call-stage';
    stage.className = 'call-stage';
    stage.setAttribute('data-i18n-ignore', '');
    const grid = $('grid');
    if (grid) grid.before(stage);
    stage.addEventListener('click', e => {
      const b = e.target.closest('[data-stage]');
      if (!b) return;
      if (b.dataset.stage === 'invite') $('btn-show-server-invites')?.click();
      else if (b.dataset.stage === 'copy') $('btn-copy-id')?.click();
    });
  }

  // --- süre sayacı ---
  let connectedAt = 0;
  function tickTimer() {
    const el = $('call-timer');
    if (!el) return;
    if (!inCall()) { connectedAt = 0; el.textContent = '--:--'; return; }
    const peers = window.state.peers ? window.state.peers.size : 0;
    if (peers > 0 && !connectedAt) connectedAt = Date.now();
    if (!connectedAt) { el.textContent = '--:--'; return; }
    const s = Math.floor((Date.now() - connectedAt) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    el.textContent = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // --- sahne: yalnız / birebir ---
  let stageKey = '';
  function syncStage() {
    const main = document.querySelector('#view-call .main');
    const grid = $('grid');
    const stage = $('call-stage');
    if (!main || !grid || !stage) return;
    // remove() özniteliği değişmese de yeniden yazar ve gözlemciyi tetikler; toggle(false) yazmaz.
    if (!inCall()) { main.classList.toggle('stage-solo', false); main.classList.toggle('stage-duo', false); stageKey = ''; return; }
    const tiles = Array.from(grid.querySelectorAll('.ptile[data-tile-uid]'));
    const remote = tiles.filter(t => t.dataset.tileUid !== 'self');
    const cardOpen = Array.from(grid.querySelectorAll('.vcard')).some(c => !c.classList.contains('hidden') && !c.classList.contains('ptile'));
    const focus = main.classList.contains('focus-mode');
    const solo = !focus && !cardOpen && remote.length === 0 && tiles.length > 0;
    const duo = !focus && !cardOpen && remote.length === 1;
    main.classList.toggle('stage-solo', solo);
    main.classList.toggle('stage-duo', duo);
    if (!solo) { stageKey = ''; return; }
    const out = window.TSDirectCall ? window.TSDirectCall.outgoing() : null;
    const ringing = out && !out.answered;
    const target = ringing && out.fids.length ? out.fids[0] : null;
    const f = target ? (window.state.friends || {})[target] : null;
    const key = [ringing ? 'r' : 'w', target, f && f.avatar, window.state.myAvatar, window.state.room].join('|');
    if (key === stageKey) return;
    stageKey = key;
    const prof = window.TSProfile ? window.TSProfile.mine() : {};
    const av = f
      ? window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: target, size: 132 })
      : window.TSUI.avatarHtml({ src: window.state.myAvatar, name: window.state.myName, seed: window.state.friendId, size: 132, frame: prof.frame, color: prof.avatarColor });
    stage.innerHTML = `
      <div class="call-stage-av ${ringing ? 'is-ringing' : ''}">${av}</div>
      <strong class="call-stage-title">${esc(ringing ? tr('call.calling') : tr('call.waiting'))}</strong>
      ${ringing && f ? `<span class="call-stage-sub">${esc(f.name || '')}${out.fids.length > 1 ? ` +${out.fids.length - 1}` : ''}</span>` : ''}
      ${ringing ? '' : `
      <div class="call-stage-actions">
        <button type="button" class="ts-pill-btn is-primary" data-stage="invite">${svg(ICON.addUser, 16)}<span>${esc(tr('call.inviteSomeone'))}</span></button>
        <button type="button" class="ts-pill-btn" data-stage="copy">${svg(ICON.copy, 16)}<span>${esc(tr('call.copyRoomId'))}</span></button>
      </div>`}`;
  }

  // =====================================================================
  // Bağlama
  // =====================================================================
  function bind() {
    // Logo = ana sayfa (Kişiler)
    $('rail-brand')?.addEventListener('click', () => window.TSShell.setView('friends'));
    $('rail-calendar')?.addEventListener('click', () => window.TSShell.setView('calendar'));
    $('rail-calls')?.addEventListener('click', () => window.TSShell.setView('calls'));
    $('rail-meet')?.addEventListener('click', e => openMeetMenu(e.currentTarget));
    $('rail-settings')?.addEventListener('click', () => window.openUserSettings && window.openUserSettings('general'));
    $('rail-account')?.addEventListener('click', e => openAccountMenu(e.currentTarget));
    $('side-meet-now')?.addEventListener('click', () => meetNow());

    $('dmh-voice-call')?.addEventListener('click', () => { const fid = activeFid(); if (fid && window.TSDirectCall) window.TSDirectCall.call(fid); });
    $('dmh-add-people')?.addEventListener('click', e => {
      const fid = activeFid();
      if (window.TSGroupUI) window.TSGroupUI.openCreate(e.currentTarget, fid ? [fid] : []);
    });
    $('dmh-search')?.addEventListener('click', () => { if ($('dm-find')?.classList.contains('hidden')) openFind(); else closeFind(); });
    $('dmh-more')?.addEventListener('click', e => openDmMore(e.currentTarget));
    $('dmh-tabs')?.addEventListener('click', e => {
      const b = e.target.closest('[data-dmtab]');
      if (b) setDmTab(b.dataset.dmtab);
    });
    document.addEventListener('ts:dm-header', e => {
      const fid = e.detail && e.detail.fid;
      if (fid !== dmTabFid) {
        dmTabFid = fid;
        closeFind();
        setDmTab('chat');
      } else if (dmTab !== 'chat') renderMediaPane();
    });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF' && window.TSShell && window.TSShell.view() === 'dm') {
        e.preventDefault();
        openFind();
      }
    });
    // Yeni mesaj gelince açık arama sonuçlarını tazele.
    const dmBox = $('dm-messages');
    if (dmBox) new MutationObserver(() => {
      const bar = $('dm-find');
      if (bar && !bar.classList.contains('hidden')) {
        const q = bar.querySelector('input')?.value;
        if (q) runFind(q);
      }
      if (dmTab !== 'chat') renderMediaPane();
    }).observe(dmBox, { childList: true });

    document.addEventListener('ts:call', () => { connectedAt = 0; tickTimer(); syncStage(); });
    document.addEventListener('ts:direct-call', () => { stageKey = ''; syncStage(); });
    const grid = $('grid');
    if (grid) new MutationObserver(syncStage).observe(grid, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] });
    const main = document.querySelector('#view-call .main');
    if (main) new MutationObserver(syncStage).observe(main, { attributes: true, attributeFilter: ['class'] });
    setInterval(() => { tickTimer(); syncStage(); }, 1000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildCallToolbar();
    bind();
  });

  window.TSTeams = { meetNow, joinById, openMeetMenu, openAccountMenu, setDmTab, openFind, closeFind, syncStage };
})();
