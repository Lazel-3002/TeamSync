// Discord tarzı kabuk: sunucu rayı + DM sütunu + kullanıcı paneli + görünüm
// yönlendiricisi (Arkadaşlar / DM / Arama).
//
// Eski akışlar (giriş adımları, oda kurma/katılma formları, disconnectApp)
// DEĞİŞMEDEN çalışmaya devam eder; kabuk onların bıraktığı izleri (hangi adım
// görünür, #app gizli mi) MutationObserver ile izleyip kendini ayarlar:
//   • giriş yapıldı (state.friendId + giriş adımları gizli)  → kabuk açılır
//   • #step-join / #step-create görünür ve #login açık       → "Hızlı Arama" katmanı
//   • #app görünür                                            → arama görünümü
// Değişmezler: #app.hidden ⇔ oda yok. #step-action DOM'da kalır (eski kod ve
// E2E testleri onu kullanır) ama kabuk açıkken CSS ile hep gizlidir.
(function () {
  const $ = id => document.getElementById(id);
  const isHidden = el => !el || el.classList.contains('hidden');
  const MIC_PREF = 'teamsync_prejoin_mute';
  const DEAF_PREF = 'teamsync_prejoin_deaf';
  const LAST_VIEW = 'teamsync_shell_last_view';

  let active = false;
  let inCall = false;
  let view = 'friends';
  let viewParam = null;
  let lastHome = { view: 'friends', param: null };
  let chatUnread = 0;

  function readLastHome() {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_VIEW) || 'null');
      if (saved && (saved.view === 'friends' || saved.view === 'dm' || saved.view === 'group')) lastHome = saved;
    } catch (e) {}
  }

  // ---------- Başlangıç: DOM yerleşimi ----------
  function relocate() {
    // #app içindeki modallar/notlar body'ye: #app gizliyken (ör. katılma zaman
    // aşımında #error-modal) görünmez kalıyorlardı.
    const app = $('app');
    if (app) {
      Array.from(app.children).forEach(child => {
        if (child.matches('aside.sidebar, main.main')) return;
        document.body.appendChild(child);
      });
    }
    const move = (id, host) => { const el = $(id); const h = typeof host === 'string' ? $(host) || document.querySelector(host) : host; if (el && h) h.appendChild(el); };
    move('friends-list', document.querySelector('#view-friends .friends-list-host'));
    // DM paneli: mesajlar + giriş alanı DM görünümüne
    const dmHost = $('dm-main-host');
    const dmMsgs = $('dm-messages');
    const dmInput = document.querySelector('.menu-right .dm-input-area');
    if (dmHost && dmMsgs) dmHost.appendChild(dmMsgs);
    if (dmHost && dmInput) dmHost.appendChild(dmInput);
    // Arkadaş ekleme alanı
    const addHost = $('add-friend-host');
    if (addHost) {
      move('friend-id-input', addHost);
      move('btn-add-friend', addHost);
      const input = $('friend-id-input');
      if (input) input.setAttribute('data-i18n-placeholder', 'friends.addPlaceholder');
    }
    // Güncelleme düğmeleri rayın altına (eski ana menü kabukta gizli)
    move('update-btn', 'rail-bottom');
    const updatesBtn = $('btn-show-updates');
    if (updatesBtn) {
      updatesBtn.removeAttribute('style');
      updatesBtn.className = 'rail-btn rail-action rail-updates';
      updatesBtn.innerHTML = `<span class="rail-icon">${updatesBtn.innerHTML}</span>`;
      $('rail-bottom')?.appendChild(updatesBtn);
    }
    // Oda üst çubuğu: oda adı + bağlantı noktası solda, sohbet düğmesi sağda
    const topBar = document.querySelector('#app .top-bar');
    if (topBar) {
      const lead = document.createElement('div');
      lead.className = 'call-topbar-lead';
      lead.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
      const title = $('room-title');
      const conn = $('conn');
      if (title) lead.appendChild(title);
      if (conn) lead.appendChild(conn);
      topBar.prepend(lead);
      const chatBtn = document.createElement('button');
      chatBtn.id = 'btn-call-chat';
      chatBtn.type = 'button';
      chatBtn.className = 'call-chat-btn';
      chatBtn.setAttribute('data-i18n-title', 'call.toggleChat');
      chatBtn.title = window.TSUI.tr('call.toggleChat');
      chatBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span id="call-chat-badge" class="ts-count-badge hidden">0</span>';
      topBar.appendChild(chatBtn);
    }
    // Ayrıl düğmesi kontrol çubuğunun sonuna (Discord'daki kırmızı telefon)
    const leave = $('leave');
    const bar = document.querySelector('#app .bar');
    if (leave && bar) {
      const group = document.createElement('div');
      group.className = 'bar-group call-leave-group';
      leave.classList.add('call-leave-btn');
      leave.setAttribute('data-i18n-title', 'shell.disconnect');
      leave.title = window.TSUI.tr('shell.disconnect');
      leave.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/></svg>';
      group.appendChild(leave);
      bar.appendChild(group);
    }
    // Sağ panel (eski sidebar): sekmeler — Sohbet | Kişiler
    const sidebar = document.querySelector('#app > aside.sidebar');
    if (sidebar) {
      sidebar.classList.add('call-side');
      const header = sidebar.querySelector('.sidebar-header');
      if (header) {
        header.innerHTML = '';
        header.classList.add('call-side-tabs');
        header.innerHTML = `
          <button type="button" class="call-side-tab active" data-call-tab="chat" data-i18n="call.chat">${window.TSUI.esc(window.TSUI.tr('call.chat'))}</button>
          <button type="button" class="call-side-tab" data-call-tab="people" data-i18n="call.people">${window.TSUI.esc(window.TSUI.tr('call.people'))}</button>
          <button type="button" class="call-side-close" data-i18n-title="common.close" title="Kapat">×</button>`;
      }
      // Kişiler sekmesine ait öğeler
      Array.from(sidebar.children).forEach(child => {
        if (child === header) return;
        const isChat = child.classList.contains('chat') || (child.classList.contains('lbl') && child.getAttribute('data-i18n') === 'room.chat');
        child.classList.add(isChat ? 'cp-chat' : 'cp-people');
      });
      sidebar.dataset.tab = 'chat';
    }
  }

  // ---------- Görünüm yönlendiricisi ----------
  function setView(next, param) {
    if (next === 'call' && !inCall) {
      next = lastHome.view;
      param = lastHome.param;
    }
    if (next === 'dm' && !(param && window.state.friends && window.state.friends[param])) {
      next = 'friends';
      param = null;
    }
    if (next === 'group' && !(param && window.TSGroups && window.TSGroups.get(param))) {
      next = 'friends';
      param = null;
    }
    view = next;
    viewParam = param || null;
    if (next !== 'call') {
      lastHome = { view: next, param: viewParam };
      try { localStorage.setItem(LAST_VIEW, JSON.stringify(lastHome)); } catch (e) {}
    }
    $('view-friends')?.classList.toggle('hidden', next !== 'friends');
    $('view-dm')?.classList.toggle('hidden', next !== 'dm');
    $('view-group')?.classList.toggle('hidden', next !== 'group');
    $('view-call')?.classList.toggle('is-bg', next !== 'call');
    document.body.dataset.view = next;
    $('rail-home')?.classList.toggle('active', next !== 'call');
    $('rail-call')?.classList.toggle('active', next === 'call');
    $('side-friends')?.classList.toggle('active', next === 'friends');
    document.body.classList.remove('shell-drawer-open');
    if (next === 'dm' && window.TSDM) window.TSDM.show(viewParam);
    if (next === 'group' && window.TSGroupUI) window.TSGroupUI.show(viewParam);
    if (window.TSDM) window.TSDM.markActive(next === 'dm' ? viewParam : null, next === 'group' ? viewParam : null);
    if (next === 'call') {
      // Odak modundaki kart gizliyken ölçülemez; geri dönünce hizala.
      requestAnimationFrame(() => { if (typeof window.syncFocusLayout === 'function') window.syncFocusLayout(); });
    }
    document.dispatchEvent(new CustomEvent('ts:view', { detail: { view: next, param: viewParam } }));
  }

  function isCallVisible() {
    return !active || view === 'call';
  }

  // ---------- Giriş / çıkış ----------
  function enter() {
    if (active) return;
    active = true;
    readLastHome();
    document.body.classList.add('shell-active');
    $('shell')?.classList.remove('hidden');
    renderUserPanel();
    if (window.TSFriends) window.TSFriends.render();
    if (window.TSDM) window.TSDM.renderList();
    setView(lastHome.view, lastHome.param);
    // Arkadaş grupları (js/space/groups.js): kayıtlı grupları aç, konulara abone ol.
    if (window.TSGroups) window.TSGroups.start().then(() => {
      if (lastHome.view === 'group' && view === 'friends') setView('group', lastHome.param);
    });
  }

  function exit() {
    if (!active) return;
    active = false;
    window.TSUI.closePopover();
    if (window.TSGroups) window.TSGroups.stop();
    document.body.classList.remove('shell-active', 'qc-open', 'shell-drawer-open');
    $('shell')?.classList.add('hidden');
  }

  // ---------- Arama başlangıcı / bitişi ----------
  function onCallStart() {
    inCall = true;
    chatUnread = 0;
    updateChatBadge();
    $('rail-call')?.classList.remove('hidden');
    $('voice-mini')?.classList.remove('hidden');
    updateVoiceMini();
    applyPrejoinPrefs();
    setView('call');
  }

  function onCallEnd() {
    // Discord gibi: sustur/sağır tercihi aramadan sonra da korunur.
    try {
      localStorage.setItem(MIC_PREF, window.state.selfMicOn === false || window.state.micEnabled === false ? '1' : '0');
      localStorage.setItem(DEAF_PREF, window.state.deafened ? '1' : '0');
    } catch (e) {}
    inCall = false;
    $('rail-call')?.classList.add('hidden');
    $('voice-mini')?.classList.add('hidden');
    $('app')?.classList.remove('side-open');
    if (window.TSTiles) window.TSTiles.clear();
    setView(lastHome.view, lastHome.param);
    renderUserPanel();
  }

  function applyPrejoinPrefs() {
    // setupLocalAudio tamamlandıktan sonra (#app görünür olduğunda) uygulanır.
    setTimeout(() => {
      const wantDeaf = localStorage.getItem(DEAF_PREF) === '1';
      const wantMute = localStorage.getItem(MIC_PREF) === '1';
      if (wantDeaf && !window.state.deafened) $('deaf')?.click();
      else if (wantMute && window.state.micEnabled && !window.state.deafened) $('mic')?.click();
      renderUserPanel();
    }, 200);
  }

  function updateVoiceMini() {
    const room = $('vm-room');
    if (!room) return;
    const name = window.state.roomName || window.state.room || '';
    room.textContent = name;
  }

  // ---------- Kullanıcı paneli ----------
  function renderUserPanel() {
    const avatarHost = $('up-avatar');
    if (!avatarHost) return;
    const st = window.TSStatus ? window.TSStatus.effective() : 'online';
    const prof = window.TSProfile ? window.TSProfile.mine() : {};
    avatarHost.innerHTML = window.TSUI.avatarHtml({
      src: window.state.myAvatar, name: window.state.myName, seed: window.state.friendId,
      size: 32, status: st, frame: prof.frame, color: prof.avatarColor
    });
    const nameEl = $('up-name');
    if (nameEl) nameEl.textContent = window.state.myName || '';
    const sub = $('up-sub');
    if (sub) {
      const act = window.TSActivity ? window.TSActivity.mine() : null;
      const custom = window.TSStatus ? window.TSStatus.customActive() : null;
      sub.classList.remove('is-activity');
      if (act) {
        sub.classList.add('is-activity');
        sub.innerHTML = `${window.TSUI.GAMEPAD_SVG}<span class="up-sub-text">${window.TSUI.esc(act.n)}</span>`;
      } else if (custom) {
        sub.textContent = `${custom.e ? `${custom.e} ` : ''}${custom.t || ''}`;
      } else {
        sub.textContent = window.TSUI.statusLabel(st);
      }
    }
    const micOff = inCall ? !window.state.micEnabled : localStorage.getItem(MIC_PREF) === '1';
    const deafOff = inCall ? !!window.state.deafened : localStorage.getItem(DEAF_PREF) === '1';
    const mic = $('up-mic');
    const deaf = $('up-deaf');
    if (mic) {
      mic.classList.toggle('is-off', micOff || deafOff);
      mic.title = window.TSUI.tr(micOff ? 'shell.unmute' : 'shell.mute');
    }
    if (deaf) {
      deaf.classList.toggle('is-off', deafOff);
      deaf.title = window.TSUI.tr(deafOff ? 'shell.undeafen' : 'shell.deafen');
    }
    const myIdEl = $('friends-my-id');
    if (myIdEl) myIdEl.textContent = window.state.friendId || '';
  }

  function toggleMic() {
    if (inCall) { $('mic')?.click(); setTimeout(renderUserPanel, 0); return; }
    const deaf = localStorage.getItem(DEAF_PREF) === '1';
    if (deaf) {
      localStorage.setItem(DEAF_PREF, '0');
      localStorage.setItem(MIC_PREF, '0');
    } else {
      localStorage.setItem(MIC_PREF, localStorage.getItem(MIC_PREF) === '1' ? '0' : '1');
    }
    if (typeof window.playSound === 'function') window.playSound(localStorage.getItem(MIC_PREF) === '1' ? 'off' : 'on');
    renderUserPanel();
  }

  function toggleDeaf() {
    if (inCall) { $('deaf')?.click(); setTimeout(renderUserPanel, 0); return; }
    const next = localStorage.getItem(DEAF_PREF) === '1' ? '0' : '1';
    localStorage.setItem(DEAF_PREF, next);
    if (typeof window.playSound === 'function') window.playSound(next === '1' ? 'off' : 'on');
    renderUserPanel();
  }

  // ---------- Sağ panel (arama sohbeti) ----------
  function updateChatBadge() {
    const badge = $('call-chat-badge');
    if (!badge) return;
    badge.textContent = chatUnread > 99 ? '99+' : String(chatUnread);
    badge.classList.toggle('hidden', chatUnread === 0);
  }

  function setCallSide(open, tab) {
    const app = $('app');
    const sidebar = document.querySelector('#app > aside.sidebar');
    if (!app || !sidebar) return;
    if (tab) {
      sidebar.dataset.tab = tab;
      sidebar.querySelectorAll('.call-side-tab').forEach(b => b.classList.toggle('active', b.dataset.callTab === tab));
    }
    app.classList.toggle('side-open', !!open);
    $('btn-call-chat')?.classList.toggle('active', !!open);
    if (open && sidebar.dataset.tab === 'chat') {
      chatUnread = 0;
      updateChatBadge();
      const msgs = $('msgs');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }
    requestAnimationFrame(() => { if (typeof window.syncFocusLayout === 'function') window.syncFocusLayout(); });
  }

  function onRoomChat() {
    const app = $('app');
    const sidebar = document.querySelector('#app > aside.sidebar');
    const open = app && app.classList.contains('side-open') && sidebar && sidebar.dataset.tab === 'chat' && view === 'call';
    if (open) return;
    chatUnread++;
    updateChatBadge();
  }

  // ---------- Hızlı Arama (eski oda kur / katıl) ----------
  function openQuickCall(kind) {
    window.TSUI.closePopover();
    const login = $('login');
    if (login) login.classList.remove('hidden');
    const btn = $(kind === 'join' ? 'btn-show-join' : 'btn-show-create');
    if (btn) btn.click();
    syncState();
    setTimeout(() => {
      const input = $(kind === 'join' ? 'join-id' : 'create-name');
      if (input) input.focus();
    }, 50);
  }

  function closeQuickCall() {
    const visibleStep = ['step-join', 'step-create', 'step-add-friend'].map($).find(el => el && !isHidden(el));
    const back = visibleStep && visibleStep.querySelector('.btn-back');
    if (back) back.click();
    else $('login')?.classList.add('hidden');
    syncState();
  }

  function showAddMenu(anchor) {
    const { esc, tr } = window.TSUI;
    const html = `
      <div class="ts-menu ts-add-menu">
        <div class="ts-menu-title">${esc(tr('shell.quickCall'))}</div>
        <button type="button" class="ts-menu-card" data-qc="create">
          <span class="ts-menu-card-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></span>
          <span><strong>${esc(tr('shell.quickCallCreate'))}</strong><small>${esc(tr('shell.quickCallCreateDesc'))}</small></span>
        </button>
        <button type="button" class="ts-menu-card" data-qc="join">
          <span class="ts-menu-card-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>
          <span><strong>${esc(tr('shell.quickCallJoin'))}</strong><small>${esc(tr('shell.quickCallJoinDesc'))}</small></span>
        </button>
        <div class="ts-menu-note"><strong>${esc(tr('shell.serversSoon'))}</strong><small>${esc(tr('shell.serversSoonDesc'))}</small></div>
      </div>`;
    const pop = window.TSUI.popover(html, anchor, { placement: 'right', cls: 'ts-menu-pop' });
    pop.el.addEventListener('click', e => {
      const btn = e.target.closest('[data-qc]');
      if (!btn) return;
      if (inCall) {
        window.showToast(window.TSUI.tr('shell.youInCall'), 'warn');
        pop.close();
        setView('call');
        return;
      }
      openQuickCall(btn.dataset.qc);
    });
  }

  // ---------- Hızlı geçiş (Ctrl+K) ----------
  function openSwitcher() {
    const { esc, tr, avatarHtml } = window.TSUI;
    const overlay = document.createElement('div');
    overlay.className = 'modal ts-switcher';
    overlay.setAttribute('data-i18n-ignore', '');
    overlay.innerHTML = `
      <div class="ts-switcher-card" role="dialog" aria-modal="true">
        <input type="text" class="ts-switcher-input" autocomplete="off" placeholder="${esc(tr('shell.switcherPlaceholder'))}" />
        <div class="ts-switcher-list"></div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    const list = overlay.querySelector('.ts-switcher-list');
    let items = [];
    let sel = 0;
    const close = () => overlay.remove();
    const render = () => {
      const q = input.value.trim().toLocaleLowerCase();
      items = Object.keys(window.state.friends || {})
        .map(fid => ({ fid, f: window.state.friends[fid] }))
        .filter(({ f, fid }) => !q || String(f.name || '').toLocaleLowerCase().includes(q) || fid.toLowerCase().includes(q))
        .sort((a, b) => (b.f.online ? 1 : 0) - (a.f.online ? 1 : 0))
        .slice(0, 12);
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.innerHTML = items.length ? items.map(({ fid, f }, i) => `
        <button type="button" class="ts-switcher-item ${i === sel ? 'sel' : ''}" data-fid="${esc(fid)}">
          ${avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 24, status: window.TSStatus ? window.TSStatus.statusOf(fid) : null })}
          <span>${esc(f.name || fid)}</span><small>${esc(fid)}</small>
        </button>`).join('') : `<div class="ts-switcher-empty">${esc(tr('shell.switcherEmpty'))}</div>`;
    };
    const go = fid => { close(); if (fid && typeof window.openDM === 'function') window.openDM(fid); };
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[sel]) go(items[sel].fid);
    });
    list.addEventListener('click', e => { const b = e.target.closest('[data-fid]'); if (b) go(b.dataset.fid); });
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    render();
    setTimeout(() => input.focus(), 20);
  }

  // ---------- Durum izleme ----------
  function syncState() {
    const loggedIn = !!window.state.friendId && isHidden($('step-auth')) && isHidden($('step-accounts')) && isHidden($('step-name'));
    if (loggedIn && !active) enter();
    else if (!loggedIn && active) exit();
    const login = $('login');
    const formOpen = ['step-join', 'step-create', 'step-add-friend'].some(id => !isHidden($(id)));
    document.body.classList.toggle('qc-open', active && !isHidden(login) && formOpen);
    const callVisible = !isHidden($('app'));
    if (callVisible !== inCall) {
      if (callVisible) onCallStart(); else onCallEnd();
    }
  }

  function observe() {
    const mo = new MutationObserver(() => syncState());
    ['step-auth', 'step-accounts', 'step-name', 'step-action', 'step-join', 'step-create', 'step-add-friend', 'login', 'app']
      .forEach(id => { const el = $(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
  }

  // ---------- Bağlama ----------
  function bind() {
    $('rail-home')?.addEventListener('click', () => setView(lastHome.view === 'call' ? 'friends' : lastHome.view, lastHome.param));
    $('rail-call')?.addEventListener('click', () => setView('call'));
    $('rail-add')?.addEventListener('click', e => showAddMenu(e.currentTarget));
    $('rail-search')?.addEventListener('click', () => window.showToast(window.TSUI.tr('shell.searchSoon'), 'info'));
    $('side-friends')?.addEventListener('click', () => setView('friends'));
    $('side-search-btn')?.addEventListener('click', openSwitcher);
    $('side-new-dm')?.addEventListener('click', e => {
      if (window.TSGroupUI) window.TSGroupUI.openCreate(e.currentTarget); else openSwitcher();
    });
    $('vm-open')?.addEventListener('click', () => setView('call'));
    $('vm-leave')?.addEventListener('click', () => { if (typeof window.disconnectApp === 'function') window.disconnectApp(); });
    $('up-profile')?.addEventListener('click', e => window.TSProfile && window.TSProfile.showSelfPanel(e.currentTarget));
    $('up-mic')?.addEventListener('click', toggleMic);
    $('up-deaf')?.addEventListener('click', toggleDeaf);
    $('up-settings')?.addEventListener('click', () => window.openUserSettings && window.openUserSettings('general'));
    $('friends-copy-id')?.addEventListener('click', () => window.TSUI.copyText(window.state.friendId));
    $('btn-call-chat')?.addEventListener('click', () => {
      const app = $('app');
      const sidebar = document.querySelector('#app > aside.sidebar');
      const open = app.classList.contains('side-open');
      if (open && sidebar.dataset.tab !== 'chat') setCallSide(true, 'chat');
      else setCallSide(!open, 'chat');
    });
    document.querySelector('#app > aside.sidebar')?.addEventListener('click', e => {
      const tab = e.target.closest('[data-call-tab]');
      if (tab) setCallSide(true, tab.dataset.callTab);
      if (e.target.closest('.call-side-close')) setCallSide(false);
    });
    document.addEventListener('click', e => {
      if (e.target.closest('[data-shell-drawer]')) document.body.classList.toggle('shell-drawer-open');
    });
    // Katman arka planına tıklayınca / Esc ile Hızlı Arama kapanır.
    $('login')?.addEventListener('mousedown', e => {
      if (document.body.classList.contains('qc-open') && e.target === $('login')) closeQuickCall();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.body.classList.contains('qc-open')) closeQuickCall();
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK' && active) { e.preventDefault(); openSwitcher(); }
    });
    // Oda içi #mic/#deaf ile de panel güncel kalsın.
    ['mic', 'deaf'].forEach(id => $(id)?.addEventListener('click', () => setTimeout(renderUserPanel, 0)));
    $('error-ok')?.addEventListener('click', () => $('error-modal')?.classList.add('hidden'));
    document.addEventListener('ts:status', renderUserPanel);
    document.addEventListener('ts:activity', renderUserPanel);
    document.addEventListener('ts:profile', e => { if (!e.detail || e.detail.fid === window.state.friendId) renderUserPanel(); });
    // Oda adı sonradan (kurucunun hello'suyla) gelir.
    const title = $('room-title');
    if (title) new MutationObserver(updateVoiceMini).observe(title, { childList: true, characterData: true, subtree: true });
  }

  function init() {
    relocate();
    bind();
    observe();
    syncState();
  }

  window.TSShell = {
    setView, enter, exit, isCallVisible, openQuickCall, closeQuickCall,
    renderUserPanel, onRoomChat, setCallSide, openSwitcher,
    isActive: () => active,
    inCall: () => inCall,
    view: () => view,
    viewParam: () => viewParam,
    onSelfVoiceState: renderUserPanel,
    onFriendsRendered() {
      if (window.TSFriends) window.TSFriends.afterRender();
      if (window.TSDM) window.TSDM.renderList();
      renderUserPanel();
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
