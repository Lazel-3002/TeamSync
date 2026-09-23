// Arama görünümündeki katılımcı kutucukları (Discord'daki gibi herkes için
// büyük avatarlı bir kutu). Eskiden yalnızca ekran paylaşanların kartı vardı;
// sesli katılımcılar ızgarada hiç görünmüyordu.
//
// Kutucuklar #grid içinde .ptile[data-tile-uid] olarak durur. data-uid ve
// .vcard KULLANILMAZ: renderer.js belge genelinde [data-uid] ve .vcard arıyor
// (kullanıcı listesi satırları, odak sistemi).
(function () {
  const tiles = new Map(); // uid -> { el, key }
  const $ = id => document.getElementById(id);
  const esc = v => window.TSUI.esc(v);
  const tr = (k, v) => window.TSUI.tr(k, v);

  const MIC_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/></svg>';
  const DEAF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 3-6.7"/><path d="M9.5 3.3A9 9 0 0 1 21 12v7"/></svg>';

  function grid() { return $('grid'); }

  function safeId(uid) {
    return `pt-${String(uid).replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }

  function peerInfo(uid) {
    if (uid === 'self') {
      const prof = window.TSProfile ? window.TSProfile.mine() : {};
      return {
        name: window.state.myName || '',
        avatar: window.state.myAvatar,
        seed: window.state.friendId,
        micOff: !window.state.micEnabled,
        deaf: !!window.state.deafened,
        speaking: !!window.state.isSpeakingLocally && !!window.state.micEnabled,
        sharing: !!window.state.isSharing,
        activity: window.TSActivity ? window.TSActivity.mine() : null,
        status: window.TSStatus ? window.TSStatus.effective() : 'online',
        profile: prof,
        self: true
      };
    }
    const peer = window.state.peers.get(uid);
    if (!peer) return null;
    const fid = peer.friendId || null;
    const friendPresence = fid && window.TSStatus ? window.TSStatus.presenceOf(fid) : null;
    const roomPresence = (window.state.roomPresenceOf || {})[uid] || {};
    const prof = fid && window.TSProfile ? (window.TSProfile.profileOf(fid) || {}) : {};
    const nameShown = typeof window.displayName === 'function' ? window.displayName(uid, peer.name || '?') : (peer.name || '?');
    return {
      name: nameShown,
      avatar: peer.avatar,
      seed: fid || uid,
      micOff: peer.mic === false,
      deaf: !!peer.deaf,
      speaking: window.state.speakingPeers.has(uid) && peer.mic !== false,
      sharing: !!peer.sharing,
      activity: roomPresence.act || (friendPresence && friendPresence.act) || null,
      status: roomPresence.st || (friendPresence && friendPresence.st) || 'online',
      profile: prof,
      self: false
    };
  }

  function tileBg(info) {
    const p = info.profile || {};
    const c = p.bannerColor || p.accent || p.avatarColor;
    return /^#[0-9a-f]{6}$/i.test(c || '') ? c : window.TSUI.colorFromString(info.seed || info.name);
  }

  function render(uid) {
    const entry = tiles.get(uid);
    if (!entry) return;
    const info = peerInfo(uid);
    if (!info) return;
    const act = info.activity;
    // Görsel anahtar: yalnızca gerçekten değişen içerik yeniden çizilir
    // (konuşma halkası sınıfla değişir, HTML'e dokunmaz).
    const key = [info.name, info.avatar, info.micOff, info.deaf, info.sharing, act ? `${act.n}|${act.sid}|${act.startLocal}` : '', info.profile.frame, info.profile.avatarAnimUrl, tileBg(info)].join('§');
    const el = entry.el;
    el.classList.toggle('speaking', info.speaking);
    el.classList.toggle('is-muted', info.micOff);
    el.classList.toggle('is-deaf', info.deaf);
    el.classList.toggle('is-sharing', info.sharing);
    if (entry.key === key) return;
    entry.key = key;
    el.style.setProperty('--tile-bg', tileBg(info));
    el.innerHTML = `
      <div class="ptile-center">
        ${window.TSUI.avatarHtml({ src: info.avatar, name: info.name, seed: info.seed, size: 80, frame: info.profile.frame, anim: info.profile.avatarAnimUrl, animate: false, color: info.profile.avatarColor, cls: 'ptile-av' })}
      </div>
      ${info.sharing ? `<span class="ptile-live">${esc(tr('call.live'))}</span>` : ''}
      <div class="ptile-lbl">
        ${info.deaf ? `<span class="ptile-ico">${DEAF}</span>` : (info.micOff ? `<span class="ptile-ico">${MIC_OFF}</span>` : '')}
        <span class="ptile-name">${esc(info.name)}</span>
      </div>
      ${act ? `<div class="ptile-activity" title="${esc(act.n)}">${window.TSUI.GAMEPAD_SVG}<span>${esc(act.n)}</span>${window.TSUI.sinceHtml(act.startLocal)}</div>` : ''}`;
  }

  function ensureInviteTile() {
    const g = grid();
    if (!g) return;
    let invite = g.querySelector('.ptile-invite');
    const alone = tiles.size <= 1;
    if (alone && !invite && tiles.size === 1) {
      invite = document.createElement('button');
      invite.type = 'button';
      invite.className = 'ptile ptile-invite';
      invite.setAttribute('data-i18n-ignore', '');
      invite.innerHTML = `
        <span class="ptile-invite-icon"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg></span>
        <strong>${esc(tr('call.inviteTitle'))}</strong>
        <small>${esc(tr('call.inviteDesc'))}</small>`;
      invite.addEventListener('click', () => $('btn-show-server-invites')?.click());
      const last = Array.from(g.querySelectorAll('.ptile[data-tile-uid]')).pop();
      if (last) last.after(invite); else g.prepend(invite);
    } else if (!alone && invite) {
      invite.remove();
    }
  }

  function add(uid) {
    const g = grid();
    if (!g || tiles.has(uid)) return;
    const el = document.createElement('div');
    el.className = 'ptile';
    el.id = safeId(uid);
    el.dataset.tileUid = uid;
    el.setAttribute('data-i18n-ignore', '');
    el.tabIndex = 0;
    const open = e => {
      e.preventDefault();
      if (uid === 'self') {
        if (window.TSProfile) window.TSProfile.showCard({ self: true, placement: 'right' }, el);
      } else if (typeof window.showUserContextMenu === 'function') {
        const peer = window.state.peers.get(uid);
        window.showUserContextMenu(e, uid, peer ? peer.name : '');
      }
    };
    el.addEventListener('click', open);
    el.addEventListener('contextmenu', open);
    // Kendi kutum en başta, sonra katılma sırası; etkinlik kartlarından önce.
    const existing = Array.from(g.querySelectorAll('.ptile[data-tile-uid]'));
    if (uid === 'self' || !existing.length) {
      const empty = g.querySelector('.empty');
      if (uid === 'self') g.prepend(el); else if (empty) empty.after(el); else g.prepend(el);
    } else {
      existing[existing.length - 1].after(el);
    }
    tiles.set(uid, { el, key: '' });
    render(uid);
    ensureInviteTile();
    if (typeof window.updateEmptyGrid === 'function') window.updateEmptyGrid();
  }

  function remove(uid) {
    const entry = tiles.get(uid);
    if (!entry) return;
    entry.el.remove();
    tiles.delete(uid);
    ensureInviteTile();
  }

  function update(uid) {
    if (!tiles.has(uid)) return;
    render(uid);
  }

  function updateAll() {
    tiles.forEach((_, uid) => render(uid));
  }

  function clear() {
    tiles.forEach(entry => entry.el.remove());
    tiles.clear();
    grid()?.querySelector('.ptile-invite')?.remove();
  }

  document.addEventListener('ts:presence', updateAll);
  document.addEventListener('ts:profile', updateAll);
  document.addEventListener('ts:activity', () => update('self'));
  document.addEventListener('ts:status', () => update('self'));

  window.TSTiles = { add, remove, update, updateAll, clear, has: uid => tiles.has(uid) };
})();
