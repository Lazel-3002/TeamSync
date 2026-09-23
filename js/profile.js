// Profil kartı + profil düzenleyici + arkadaşlardan P2P profil çekme.
//
// Zengin profil (bio, arka plan, çerçeve, hareketli avatar, vurgu rengi,
// "yazıyor" efekti) sahibinin cihazında tutulur ve arkadaşlara kişisel MQTT
// konusu üzerinden istenince gönderilir:
//   → teamsync/user/<hedef>/events  { type:'req_profile', fromId, have }
//   ← teamsync/user/<isteyen>/events { type:'res_profile', fromId, rev, profile }
// Presence'taki `pr` (profil sürümü) arttığında önbellek tazelenir.
// Görseller YALNIZCA Supabase public "avatars" kovasından kabul edilir: bir
// arkadaş kendi sunucusundaki bir resmi göstererek IP'ni öğrenemesin.
(function () {
  const EXT_KEY = fid => `teamsync_profile_ext::${fid}`;
  const CACHE_KEY = 'teamsync_profile_cache';
  const CACHE_MAX = 200;
  const DEFAULT = { rev: 0, bio: '', bannerColor: '', bannerUrl: '', avatarColor: '', avatarAnimUrl: '', frame: 'none', accent: '', typingVerb: '' };
  const HEX = /^#[0-9a-f]{6}$/i;
  const SUPABASE_MEDIA_RE = /^https:\/\/[a-z0-9-]{8,40}\.supabase\.co\/storage\/v1\/object\/public\/avatars\/[A-Za-z0-9/_.-]{1,160}(\?[A-Za-z0-9=&._-]{0,60})?$/;

  window.state.myProfile = { ...DEFAULT };
  let loadedFor = null;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { cache = {}; }
  const pending = {};        // fid -> { rev, tries, timer }
  const lastAnswered = {};   // fid -> ms
  let mediaPrefix = null;

  (async () => {
    try {
      const env = await window.electronAPI?.getEnv?.();
      if (env && env.SUPABASE_URL) mediaPrefix = `${String(env.SUPABASE_URL).replace(/\/+$/, '')}/storage/v1/object/public/avatars/`;
    } catch (e) {}
  })();

  const { esc, tr } = { esc: v => window.TSUI.esc(v), tr: (k, v) => window.TSUI.tr(k, v) };

  function safeMedia(url) {
    if (typeof url !== 'string' || !url) return '';
    if (!SUPABASE_MEDIA_RE.test(url)) return '';
    if (mediaPrefix && !url.startsWith(mediaPrefix)) return '';
    return url;
  }

  function sanitizeProfile(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const banner = p.banner && typeof p.banner === 'object' ? p.banner : {};
    const frame = window.TSUI.FRAMES.includes(p.frame) ? p.frame : 'none';
    const verb = typeof p.tv === 'string' ? p.tv : (typeof p.typingVerb === 'string' ? p.typingVerb : '');
    return {
      bio: typeof p.bio === 'string' ? p.bio.slice(0, 190) : '',
      bannerColor: HEX.test(banner.c || p.bannerColor || '') ? (banner.c || p.bannerColor) : '',
      bannerUrl: safeMedia(banner.u || p.bannerUrl || ''),
      avatarColor: HEX.test(p.avatarColor || '') ? p.avatarColor : '',
      avatarAnimUrl: safeMedia(p.anim || p.avatarAnimUrl || ''),
      frame,
      accent: HEX.test(p.accent || '') ? p.accent : '',
      typingVerb: Array.from(verb.replace(/[\r\n<>]+/g, ' ').trim()).slice(0, 24).join('')
    };
  }

  // ---------- Kendi profilim ----------
  function ensureLoaded() {
    const fid = window.state.friendId;
    if (!fid || loadedFor === fid) return;
    loadedFor = fid;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(EXT_KEY(fid)) || 'null'); } catch (e) {}
    window.state.myProfile = { ...DEFAULT, ...(saved ? sanitizeProfile(saved) : {}), rev: saved && Number.isInteger(saved.rev) ? saved.rev : 0 };
  }

  function mine() {
    ensureLoaded();
    return window.state.myProfile;
  }

  function rev() {
    return mine().rev || 0;
  }

  function persistLocal() {
    const fid = window.state.friendId;
    if (!fid) return;
    try { localStorage.setItem(EXT_KEY(fid), JSON.stringify(window.state.myProfile)); } catch (e) {}
  }

  // Hesap dosyası / Supabase'ten gelen kopyayı içe al (yerelden yeniyse).
  function importExt(ext) {
    if (!ext || typeof ext !== 'object') return;
    ensureLoaded();
    const incomingRev = Number.isInteger(ext.rev) ? ext.rev : 0;
    if (incomingRev <= (window.state.myProfile.rev || 0)) return;
    window.state.myProfile = { ...DEFAULT, ...sanitizeProfile(ext), rev: incomingRev };
    persistLocal();
  }

  function exportExt() {
    return { ...mine() };
  }

  function wirePayload(p) {
    const out = { bio: p.bio, frame: p.frame };
    if (p.bannerColor || p.bannerUrl) out.banner = { c: p.bannerColor || undefined, u: p.bannerUrl || undefined };
    if (p.avatarColor) out.avatarColor = p.avatarColor;
    if (p.avatarAnimUrl) out.anim = p.avatarAnimUrl;
    if (p.accent) out.accent = p.accent;
    if (p.typingVerb) out.tv = p.typingVerb;
    return out;
  }

  async function syncToSupabase() {
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) return;
      // Ayrı güncelleme: profile_ext sütunu yoksa (SQL kurulmadı) yalnızca bu
      // çağrı başarısız olur, isim/arkadaş eşitlemesi etkilenmez.
      await supabaseClient.from('profiles').update({ profile_ext: exportExt() }).eq('id', session.user.id);
    } catch (e) {}
  }

  function saveMine(next) {
    ensureLoaded();
    window.state.myProfile = { ...DEFAULT, ...sanitizeProfile(next), rev: (window.state.myProfile.rev || 0) + 1 };
    persistLocal();
    if (typeof window.saveProfile === 'function') window.saveProfile();
    syncToSupabase();
    if (typeof window.publishPresence === 'function') window.publishPresence();
    document.dispatchEvent(new CustomEvent('ts:profile', { detail: { fid: window.state.friendId } }));
  }

  // ---------- Arkadaş profilleri (P2P) ----------
  function saveCache() {
    const entries = Object.entries(cache);
    if (entries.length > CACHE_MAX) {
      entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      cache = Object.fromEntries(entries.slice(0, CACHE_MAX));
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
  }

  function profileOf(fid) {
    if (fid && fid === window.state.friendId) return mine();
    const entry = cache[fid];
    return entry ? { ...DEFAULT, ...entry.profile, rev: entry.rev } : null;
  }

  function publishTo(fid, payload, qos = 0) {
    const client = window.state.globalMqtt;
    if (!client || !client.connected || !fid) return false;
    try { client.publish(`teamsync/user/${fid}/events`, JSON.stringify(payload), { qos }); return true; } catch (e) { return false; }
  }

  function request(fid, wantRev) {
    if (!fid || fid === window.state.friendId || !/^[A-Za-z0-9_-]{3,128}$/.test(fid)) return;
    const have = cache[fid] ? cache[fid].rev : 0;
    if (wantRev && have >= wantRev) return;
    if (pending[fid]) return;
    const job = { tries: 0, timer: null };
    pending[fid] = job;
    const attempt = () => {
      if (pending[fid] !== job) return;
      if (job.tries++ >= 3) {
        // Yanıt gelmedi (çevrimdışı/eski sürüm): kartlardaki "yükleniyor" kalksın.
        delete pending[fid];
        document.dispatchEvent(new CustomEvent('ts:profile', { detail: { fid } }));
        return;
      }
      publishTo(fid, { type: 'req_profile', fromId: window.state.friendId, have });
      job.timer = setTimeout(attempt, 3000);
    };
    attempt();
  }

  function onRevSeen(fid, rev) {
    if ((cache[fid] ? cache[fid].rev : 0) >= rev) return;
    // Presence'ta her yeni sürüm yalnızca bir kez tetikler.
    setTimeout(() => request(fid, rev), Math.random() * 1500);
  }

  function answer(toFid) {
    if (!toFid || !/^[A-Za-z0-9_-]{3,128}$/.test(toFid)) return;
    if (window.TSStatus && window.TSStatus.isInvisible()) return;
    const now = Date.now();
    if (now - (lastAnswered[toFid] || 0) < 10000) return;
    lastAnswered[toFid] = now;
    const p = mine();
    publishTo(toFid, { type: 'res_profile', fromId: window.state.friendId, rev: p.rev || 0, profile: wirePayload(p) }, 1);
  }

  function onEvent(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'req_profile') {
      answer(data.fromId);
    } else if (data.type === 'res_profile') {
      const fid = data.fromId;
      if (typeof fid !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(fid)) return;
      if (JSON.stringify(data).length > 8192) return;
      // İstemediğimiz ya da tanımadığımız birinin profilini önbelleğe alma.
      if (!pending[fid] && !(window.state.friends && window.state.friends[fid]) && !cache[fid]) return;
      const r = Number.isInteger(data.rev) ? data.rev : 0;
      cache[fid] = { rev: r, profile: sanitizeProfile(data.profile), at: Date.now() };
      saveCache();
      if (pending[fid]) { clearTimeout(pending[fid].timer); delete pending[fid]; }
      document.dispatchEvent(new CustomEvent('ts:profile', { detail: { fid } }));
    }
  }

  // ---------- Kart modeli ----------
  function friendModel(fid) {
    const f = (window.state.friends || {})[fid] || {};
    const st = window.TSStatus ? window.TSStatus.statusOf(fid) : (f.online ? 'online' : 'offline');
    const pres = window.TSStatus ? window.TSStatus.presenceOf(fid) : null;
    const prof = profileOf(fid) || { ...DEFAULT };
    const nick = typeof window.getNickname === 'function' ? window.getNickname(fid) : '';
    return {
      kind: 'friend',
      fid,
      name: nick || f.name || fid,
      realName: f.name || '',
      avatar: f.avatar,
      status: st,
      custom: pres && pres.cs ? pres.cs : null,
      activity: pres && pres.act ? pres.act : null,
      inVoice: !!(f.online && f.room),
      profile: prof,
      isFriend: !!(f && f.name && !f.temporary),
      muted: !!f.isMuted,
      loading: !cache[fid] && st !== 'offline' && !!pending[fid]
    };
  }

  function selfModel(draftProfile) {
    const st = window.TSStatus ? window.TSStatus.effective() : 'online';
    return {
      kind: 'self',
      fid: window.state.friendId,
      name: window.state.myName || '',
      avatar: window.state.myAvatar,
      status: st,
      custom: window.TSStatus ? window.TSStatus.customActive() : null,
      activity: window.TSActivity ? window.TSActivity.mine() : null,
      inVoice: !!window.state.room,
      profile: draftProfile || mine(),
      isFriend: false
    };
  }

  function roomPeerModel(peerId, name) {
    const peer = window.state.peers && window.state.peers.get(peerId);
    const fid = typeof window.resolvePeerFriendId === 'function' ? window.resolvePeerFriendId(peerId) : null;
    if (fid && window.state.friends[fid] && !window.state.friends[fid].temporary) {
      const m = friendModel(fid);
      m.roomPeerId = peerId;
      return m;
    }
    const rp = (window.state.roomPresenceOf || {})[peerId] || {};
    const prof = fid ? (profileOf(fid) || { ...DEFAULT }) : { ...DEFAULT };
    const nick = typeof window.getNickname === 'function' ? window.getNickname(peerId) : '';
    return {
      kind: 'room',
      fid,
      roomPeerId: peerId,
      name: nick || (peer && peer.name) || name || '?',
      avatar: peer && peer.avatar,
      status: rp.st || 'online',
      custom: null,
      activity: rp.act || null,
      inVoice: true,
      profile: prof,
      isFriend: false,
      loading: !!fid && !cache[fid] && !!pending[fid]
    };
  }

  // ---------- Kart HTML ----------
  function bannerStyle(p, fallbackSeed) {
    if (p.bannerUrl) return `background-image:url('${esc(p.bannerUrl)}');background-color:${esc(p.bannerColor || '#1e1f22')}`;
    if (p.bannerColor) return `background-color:${esc(p.bannerColor)}`;
    if (p.accent) return `background-color:${esc(p.accent)}`;
    return `background-color:${window.TSUI.colorFromString(fallbackSeed || '?')}`;
  }

  function activityHtml(act, compact) {
    if (!act) return '';
    const { gameArtHtml, sinceHtml, GAMEPAD_SVG } = window.TSUI;
    return `
      <div class="pc-section pc-activity ${compact ? 'compact' : ''}">
        <div class="pc-label">${esc(tr('profile.playing'))}</div>
        <div class="pc-act-row">
          ${gameArtHtml({ sid: act.sid, icon: act.icon }, compact ? 48 : 64)}
          <div class="pc-act-copy">
            <strong>${esc(act.n)}</strong>
            <span class="pc-act-time">${GAMEPAD_SVG}${sinceHtml(act.startLocal)}</span>
          </div>
        </div>
      </div>`;
  }

  function cardHtml(m, opts = {}) {
    const p = m.profile || DEFAULT;
    const avatar = window.TSUI.avatarHtml({
      src: m.avatar, name: m.name, seed: m.fid || m.name, size: 80, status: m.status,
      frame: p.frame, anim: p.avatarAnimUrl, animate: true, color: p.avatarColor
    });
    const custom = m.custom && (m.custom.t || m.custom.e)
      ? `<div class="pc-bubble">${m.custom.e ? `<span class="pc-bubble-emoji">${esc(m.custom.e)}</span>` : ''}${esc(m.custom.t || '')}</div>`
      : (m.kind === 'self' && !opts.preview ? `<button type="button" class="pc-bubble pc-bubble-empty" data-pc-action="custom-status">+ ${esc(tr('status.setCustom'))}</button>` : '');
    const accent = p.accent ? `--pc-accent:${esc(p.accent)};` : '';
    const idLine = m.fid ? `<button type="button" class="pc-id" data-pc-action="copy-id" title="${esc(tr('status.copyId'))}">${esc(m.fid)}</button>` : '';
    const realName = m.realName && m.realName !== m.name ? `<div class="pc-realname">${esc(m.realName)}</div>` : '';
    const voice = m.inVoice && m.kind === 'friend'
      ? `<div class="pc-voice"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>${esc(tr('profile.inVoice'))}</div>`
      : '';
    const bio = p.bio ? `<div class="pc-section"><div class="pc-label">${esc(tr('profile.aboutMe'))}</div><div class="pc-bio">${esc(p.bio)}</div></div>` : '';
    const loading = m.loading ? `<div class="pc-loading">${esc(tr('profile.loading'))}</div>` : '';
    return `
      <div class="pc ${opts.cls || ''}" style="${accent}" data-i18n-ignore>
        <div class="pc-banner ${p.bannerUrl ? 'has-img' : ''}" style="${bannerStyle(p, m.fid || m.name)}"></div>
        <div class="pc-head">
          <div class="pc-avatar">${avatar}</div>
          ${custom}
        </div>
        <div class="pc-body">
          <div class="pc-name">${esc(m.name)}</div>
          ${realName}
          ${idLine}
          ${voice}
          ${activityHtml(m.activity, opts.compact)}
          ${bio}
          ${loading}
          ${opts.actionsHtml || ''}
        </div>
      </div>`;
  }

  // ---------- Kartı göster ----------
  function actionButtons(m) {
    if (m.kind === 'self') return '';
    const btns = [];
    if (m.fid) btns.push(`<button type="button" class="pc-btn pc-btn-pri" data-pc-action="message">${esc(tr('profile.sendMessage'))}</button>`);
    if (m.kind === 'friend' && m.isFriend) {
      btns.push(`<button type="button" class="pc-btn" data-pc-action="mute">${esc(tr(m.muted ? 'profile.unmute' : 'profile.mute'))}</button>`);
      btns.push(`<button type="button" class="pc-btn pc-btn-danger" data-pc-action="remove">${esc(tr('profile.removeFriend'))}</button>`);
    } else if (m.kind === 'room' && m.roomPeerId) {
      btns.push(`<button type="button" class="pc-btn" data-pc-action="add-friend">${esc(tr('profile.addFriend'))}</button>`);
    }
    return btns.length ? `<div class="pc-actions">${btns.join('')}</div>` : '';
  }

  function bindCardActions(root, m, close) {
    root.addEventListener('click', e => {
      const btn = e.target.closest('[data-pc-action]');
      if (!btn) return;
      const action = btn.dataset.pcAction;
      if (action === 'copy-id') window.TSUI.copyText(m.fid);
      else if (action === 'custom-status') { close(); window.TSStatus && window.TSStatus.openCustomDialog(); }
      else if (action === 'message') {
        close();
        if (m.kind === 'room' && m.roomPeerId && typeof window.openServerDM === 'function' && !(window.state.friends[m.fid])) window.openServerDM(m.roomPeerId, m.name);
        else if (typeof window.openDM === 'function') window.openDM(m.fid);
      } else if (action === 'mute') { close(); window.toggleMuteFriend && window.toggleMuteFriend(m.fid); }
      else if (action === 'remove') { close(); window.removeFriend && window.removeFriend(m.fid); }
      else if (action === 'add-friend') { close(); typeof window.sendRoomFriendRequest === 'function' && window.sendRoomFriendRequest(m.roomPeerId); }
    });
  }

  let openCard = null; // { key, refresh }

  function showCard(target, anchor) {
    let modelFn;
    if (target.self) modelFn = () => selfModel();
    else if (target.roomPeerId) modelFn = () => roomPeerModel(target.roomPeerId, target.name);
    else if (target.friendId) modelFn = () => friendModel(target.friendId);
    else return;
    let m = modelFn();
    if (m.fid && m.kind !== 'self') { request(m.fid); m = modelFn(); }
    const wrap = document.createElement('div');
    wrap.innerHTML = cardHtml(m, { actionsHtml: actionButtons(m) });
    const pop = window.TSUI.popover(wrap, anchor, {
      cls: 'ts-profile-pop',
      placement: target.placement || 'right',
      onClose: () => { openCard = null; }
    });
    const close = () => pop.close();
    bindCardActions(pop.el, m, close);
    openCard = {
      key: m.fid,
      refresh: () => {
        const next = modelFn();
        wrap.innerHTML = cardHtml(next, { actionsHtml: actionButtons(next) });
        pop.reposition();
      }
    };
    return pop;
  }

  // ---------- Kendi panelim (kullanıcı paneline tıklayınca) ----------
  const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const CHEVRON = '<svg class="ts-menu-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  function durationMenu(status) {
    const items = [['15m', 'status.for15m'], ['1h', 'status.for1h'], ['8h', 'status.for8h'], ['24h', 'status.for24h'], ['3d', 'status.for3d'], ['forever', 'status.forever']];
    return `<div class="ts-submenu">${items.map(([key, label]) =>
      `<button type="button" class="ts-menu-row" data-set-status="${status}" data-duration="${key}">${esc(tr(label))}</button>`).join('')}</div>`;
  }

  function statusRow(status, current) {
    const desc = status === 'dnd' ? `<small>${esc(tr('status.dndDesc'))}</small>` : status === 'invisible' ? `<small>${esc(tr('status.invisibleDesc'))}</small>` : '';
    const hasSub = status !== 'online';
    return `
      <div class="ts-menu-row ${hasSub ? 'has-sub' : ''} ${current === status ? 'is-current' : ''}" ${hasSub ? '' : `data-set-status="online" data-duration="forever"`} role="menuitem" tabindex="0">
        <i class="ts-dot ts-dot-inline s-${status}"></i>
        <span class="ts-menu-text"><span>${esc(tr(`status.${status}`))}</span>${desc}</span>
        ${hasSub ? CHEVRON : (current === status ? CHECK : '')}
        ${hasSub ? durationMenu(status) : ''}
      </div>`;
  }

  function showSelfPanel(anchor) {
    const render = () => {
      const m = selfModel();
      const raw = window.TSStatus ? window.TSStatus.rawStatus() : 'online';
      const until = window.TSStatus ? window.TSStatus.untilOf() : null;
      const untilText = until ? `<small>${esc(tr('status.until', { time: (typeof window.formatUserTime === 'function' ? window.formatUserTime(new Date(until)) : new Date(until).toLocaleTimeString()) }))}</small>` : '';
      const menu = `
        <div class="pc-menu">
          <button type="button" class="ts-menu-row" data-self-action="edit-profile">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            <span class="ts-menu-text"><span>${esc(tr('status.editProfile'))}</span></span>
          </button>
          <div class="ts-menu-sep"></div>
          <div class="ts-menu-row has-sub" role="menuitem" tabindex="0">
            <i class="ts-dot ts-dot-inline s-${raw}"></i>
            <span class="ts-menu-text"><span>${esc(tr(`status.${raw}`))}</span>${untilText}</span>
            ${CHEVRON}
            <div class="ts-submenu ts-submenu-up">
              ${statusRow('online', raw)}
              <div class="ts-menu-sep"></div>
              ${statusRow('idle', raw)}
              ${statusRow('dnd', raw)}
              ${statusRow('invisible', raw)}
            </div>
          </div>
          <button type="button" class="ts-menu-row" data-self-action="custom-status">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
            <span class="ts-menu-text"><span>${esc(tr(m.custom ? 'status.editCustom' : 'status.setCustom'))}</span></span>
          </button>
          <div class="ts-menu-sep"></div>
          <button type="button" class="ts-menu-row" data-self-action="copy-id">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span class="ts-menu-text"><span>${esc(tr('status.copyId'))}</span></span>
          </button>
          <button type="button" class="ts-menu-row" data-self-action="switch-account">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            <span class="ts-menu-text"><span>${esc(tr('status.switchAccount'))}</span></span>
          </button>
        </div>`;
      return cardHtml(m, { cls: 'pc-self', actionsHtml: menu, compact: true });
    };
    const wrap = document.createElement('div');
    wrap.innerHTML = render();
    const pop = window.TSUI.popover(wrap, anchor, { cls: 'ts-profile-pop ts-self-pop', placement: 'top', onClose: () => { openCard = null; } });
    const close = () => pop.close();
    pop.el.addEventListener('click', e => {
      const set = e.target.closest('[data-set-status]');
      if (set) {
        window.TSStatus && window.TSStatus.setStatus(set.dataset.setStatus, set.dataset.duration || 'forever');
        close();
        return;
      }
      const sub = e.target.closest('.ts-menu-row.has-sub');
      if (sub && !e.target.closest('.ts-submenu .ts-menu-row:not(.has-sub)')) {
        sub.classList.toggle('open');
        return;
      }
      const act = e.target.closest('[data-self-action]');
      if (act) {
        const a = act.dataset.selfAction;
        close();
        if (a === 'edit-profile') window.openUserSettings && window.openUserSettings('profile');
        else if (a === 'custom-status') window.TSStatus && window.TSStatus.openCustomDialog();
        else if (a === 'copy-id') window.TSUI.copyText(window.state.friendId);
        else if (a === 'switch-account') {
          // Aramadayken hesap değiştirmek odayı yarım bırakırdı: önce ayrıl.
          if (window.state.room && typeof window.disconnectApp === 'function') window.disconnectApp();
          document.getElementById('btn-logout')?.click();
        }
        return;
      }
      const pcAct = e.target.closest('[data-pc-action]');
      if (pcAct && pcAct.dataset.pcAction === 'copy-id') window.TSUI.copyText(window.state.friendId);
      else if (pcAct && pcAct.dataset.pcAction === 'custom-status') { close(); window.TSStatus && window.TSStatus.openCustomDialog(); }
    });
    openCard = { key: window.state.friendId, refresh: () => { wrap.innerHTML = render(); pop.reposition(); } };
    return pop;
  }

  // Açık kartı canlı tut (profil geldi / durum değişti).
  const refreshOpen = e => {
    if (!openCard) return;
    const fid = e && e.detail && e.detail.fid;
    if (!fid || fid === openCard.key) openCard.refresh();
  };
  document.addEventListener('ts:profile', refreshOpen);
  document.addEventListener('ts:presence', refreshOpen);
  document.addEventListener('ts:status', () => { if (openCard && openCard.key === window.state.friendId) openCard.refresh(); });
  document.addEventListener('ts:activity', () => { if (openCard && openCard.key === window.state.friendId) openCard.refresh(); });

  // ---------- Profil düzenleyici (Ayarlar > Profil) ----------
  let draft = null;

  function editorDirty() {
    if (!draft) return false;
    const cur = mine();
    return ['bio', 'bannerColor', 'bannerUrl', 'avatarColor', 'avatarAnimUrl', 'frame', 'accent', 'typingVerb']
      .some(k => (draft[k] || '') !== (cur[k] || ''));
  }

  function renderEditor() {
    const root = document.getElementById('settings-profile-root');
    if (!root) return;
    draft = { ...mine() };
    const frames = window.TSUI.FRAMES.map(f => `
      <button type="button" class="pe-frame ${draft.frame === f ? 'active' : ''}" data-frame="${f}" title="${esc(tr(`profile.frame${f.charAt(0).toUpperCase()}${f.slice(1)}`))}">
        ${window.TSUI.avatarHtml({ src: window.state.myAvatar, name: window.state.myName, size: 44, frame: f })}
        <span>${esc(tr(`profile.frame${f.charAt(0).toUpperCase()}${f.slice(1)}`))}</span>
      </button>`).join('');
    root.innerHTML = `
      <div class="pe-grid">
        <div class="pe-form">
          <div class="pe-field">
            <label>${esc(tr('profile.displayName'))}</label>
            <div class="pe-inline">
              <span class="pe-name">${esc(window.state.myName || '')}</span>
              <button type="button" class="btn-sec btn-sm" data-pe="edit-name">${esc(tr('profile.editName'))}</button>
            </div>
          </div>
          <div class="pe-field">
            <label>${esc(tr('profile.avatar'))}</label>
            <div class="pe-inline">
              <button type="button" class="btn-pri btn-sm" data-pe="change-avatar">${esc(tr('profile.changeAvatar'))}</button>
            </div>
          </div>
          <div class="pe-field">
            <label>${esc(tr('profile.animatedAvatar'))}</label>
            <p class="pe-help">${esc(tr('profile.animatedAvatarDesc'))}</p>
            <div class="pe-inline">
              <button type="button" class="btn-sec btn-sm" data-pe="upload-gif">${esc(tr('profile.uploadGif'))}</button>
              <button type="button" class="btn-sec btn-sm ${draft.avatarAnimUrl ? '' : 'hidden'}" data-pe="remove-gif">${esc(tr('profile.remove'))}</button>
              <input type="file" class="hidden" accept="image/gif" data-pe-file="gif" />
            </div>
          </div>
          <div class="pe-field">
            <label>${esc(tr('profile.avatarColor'))}</label>
            <div class="pe-inline"><input type="color" data-pe-input="avatarColor" value="${esc(draft.avatarColor || '#5865f2')}" /></div>
          </div>
          <div class="pe-field">
            <label>${esc(tr('profile.banner'))}</label>
            <p class="pe-help">${esc(tr('profile.bannerDesc'))}</p>
            <div class="pe-inline">
              <input type="color" data-pe-input="bannerColor" value="${esc(draft.bannerColor || '#5865f2')}" title="${esc(tr('profile.bannerColor'))}" />
              <button type="button" class="btn-sec btn-sm" data-pe="upload-banner">${esc(tr('profile.uploadBanner'))}</button>
              <button type="button" class="btn-sec btn-sm ${draft.bannerUrl ? '' : 'hidden'}" data-pe="remove-banner">${esc(tr('profile.remove'))}</button>
              <input type="file" class="hidden" accept="image/png,image/jpeg,image/gif,image/webp" data-pe-file="banner" />
            </div>
          </div>
          <div class="pe-field">
            <label>${esc(tr('profile.frame'))}</label>
            <div class="pe-frames">${frames}</div>
          </div>
          <div class="pe-field">
            <label>${esc(tr('profile.accent'))}</label>
            <div class="pe-inline"><input type="color" data-pe-input="accent" value="${esc(draft.accent || '#5865f2')}" /></div>
          </div>
          <div class="pe-field">
            <label>${esc(tr('profile.bio'))}</label>
            <textarea data-pe-input="bio" maxlength="190" rows="4" placeholder="${esc(tr('profile.bioPlaceholder'))}">${esc(draft.bio || '')}</textarea>
          </div>
          <div class="pe-field">
            <label>${esc(tr('profile.typingVerb'))}</label>
            <p class="pe-help">${esc(tr('profile.typingVerbDesc'))}</p>
            <input type="text" data-pe-input="typingVerb" maxlength="24" value="${esc(draft.typingVerb || '')}" placeholder="${esc(tr('profile.typingVerbPlaceholder'))}" />
            <div class="pe-typing-preview" data-pe-typing></div>
          </div>
        </div>
        <div class="pe-preview">
          <div class="pe-preview-label">${esc(tr('profile.preview'))}</div>
          <div data-pe-preview></div>
        </div>
      </div>
      <div class="pe-savebar hidden" data-pe-savebar>
        <span>${esc(tr('profile.unsaved'))}</span>
        <button type="button" class="btn-sec btn-sm" data-pe="reset">${esc(tr('profile.reset'))}</button>
        <button type="button" class="btn-pri btn-sm" data-pe="save">${esc(tr('profile.saveChanges'))}</button>
      </div>`;

    const preview = () => {
      root.querySelector('[data-pe-preview]').innerHTML = cardHtml(selfModel(draft), { preview: true });
      const verb = (draft.typingVerb || '').trim() || tr('profile.typingVerbPlaceholder');
      root.querySelector('[data-pe-typing]').textContent = tr('profile.typingPreview', { name: window.state.myName || 'Lazel', verb });
      root.querySelector('[data-pe-savebar]').classList.toggle('hidden', !editorDirty());
      root.querySelectorAll('.pe-frame').forEach(b => b.classList.toggle('active', b.dataset.frame === draft.frame));
      root.querySelector('[data-pe="remove-gif"]').classList.toggle('hidden', !draft.avatarAnimUrl);
      root.querySelector('[data-pe="remove-banner"]').classList.toggle('hidden', !draft.bannerUrl);
    };
    preview();

    root.querySelectorAll('[data-pe-input]').forEach(input => input.addEventListener('input', () => {
      draft[input.dataset.peInput] = input.value;
      preview();
    }));
    root.querySelectorAll('.pe-frame').forEach(b => b.addEventListener('click', () => { draft.frame = b.dataset.frame; preview(); }));

    const pick = kind => root.querySelector(`[data-pe-file="${kind}"]`).click();
    root.querySelector('[data-pe-file="gif"]').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (file.type !== 'image/gif') return window.showToast(tr('profile.gifOnly'), 'warn');
      if (file.size > 2 * 1024 * 1024) return window.showToast(tr('profile.fileTooLarge'), 'warn');
      const url = await uploadMedia(file, 'avatar_anim.gif', 'image/gif');
      if (!url) return;
      draft.avatarAnimUrl = url;
      // Eski istemciler için ilk kare normal avatar olur.
      firstFrameAvatar(file);
      preview();
    });
    root.querySelector('[data-pe-file="banner"]').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const ext = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.type];
      if (!ext) return window.showToast(tr('profile.imageOnly'), 'warn');
      if (file.size > 4 * 1024 * 1024) return window.showToast(tr('profile.fileTooLarge'), 'warn');
      const url = await uploadMedia(file, `banner.${ext}`, file.type);
      if (!url) return;
      draft.bannerUrl = url;
      preview();
    });

    root.addEventListener('click', e => {
      const btn = e.target.closest('[data-pe]');
      if (!btn) return;
      const a = btn.dataset.pe;
      if (a === 'edit-name') document.getElementById('btn-edit-name')?.click();
      else if (a === 'change-avatar') document.getElementById('my-avatar-input')?.click();
      else if (a === 'upload-gif') pick('gif');
      else if (a === 'remove-gif') { draft.avatarAnimUrl = ''; preview(); }
      else if (a === 'upload-banner') pick('banner');
      else if (a === 'remove-banner') { draft.bannerUrl = ''; preview(); }
      else if (a === 'reset') renderEditor();
      else if (a === 'save') {
        saveMine(draft);
        window.showToast(tr('profile.saved'), 'ok');
        renderEditor();
      }
    });
  }

  async function uploadMedia(blob, name, contentType) {
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) throw new Error('no-client');
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) throw new Error('no-session');
      const path = `${session.user.id}/${name}`;
      const { error } = await supabaseClient.storage.from('avatars')
        .upload(path, blob, { upsert: true, contentType, cacheControl: '604800' });
      if (error) throw error;
      const { data } = supabaseClient.storage.from('avatars').getPublicUrl(path);
      return safeMedia(`${data.publicUrl}?v=${Date.now().toString(36)}`) || null;
    } catch (e) {
      console.warn('Profil medyası yüklenemedi:', e && e.message);
      window.showToast(tr('profile.uploadFailed'), 'danger');
      return null;
    }
  }

  // GIF'in ilk karesini 128px JPEG avatar yapar (eski istemciler + listeler).
  function firstFrameAvatar(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
        const publicUrl = typeof window.uploadAvatarToStorage === 'function' ? await window.uploadAvatarToStorage(blob) : null;
        if (publicUrl) {
          window.state.myAvatar = publicUrl;
          if (typeof window.saveProfile === 'function') window.saveProfile();
          if (typeof window.publishPresence === 'function') window.publishPresence();
          document.dispatchEvent(new CustomEvent('ts:profile', { detail: { fid: window.state.friendId } }));
        }
      } catch (e) {} finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  // Eski showFriendProfile / showRoomUserProfile yerine yeni kart.
  window.showFriendProfile = (fid, anchor) => showCard({ friendId: fid }, anchor);
  window.showRoomUserProfile = (peerId, name, anchor) => showCard({ roomPeerId: peerId, name }, anchor);

  window.TSProfile = {
    rev, mine, exportExt, importExt, profileOf, request, onRevSeen, onEvent,
    save: saveMine,
    showCard, showSelfPanel, cardHtml, friendModel, selfModel, renderEditor,
    typingVerbOf: fid => (profileOf(fid) || {}).typingVerb || '',
    _safeMedia: safeMedia,
    isEditorDirty: editorDirty
  };
})();
