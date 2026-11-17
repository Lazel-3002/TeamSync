// Profil kartı + profil düzenleyici + arkadaşlardan P2P profil çekme.
//
// Zengin profil (bio, arka plan, çerçeve, hareketli avatar, vurgu rengi,
// "yazıyor" efekti) sahibinin cihazında tutulur ve arkadaşlara kişisel MQTT
// konusu üzerinden istenince gönderilir:
//   → teamsync/user/<hedef>/events  { type:'req_profile', fromId, have }
//   ← teamsync/user/<isteyen>/events { type:'res_profile', fromId, rev, profile }
// Presence'taki `pr` (profil sürümü) arttığında önbellek tazelenir.
// Görseller sunucuya HİÇ yüklenmez (js/profile-media.js): profilde yalnızca
// `tsm:<fid>:<sha256>:<bayt>` tanımlayıcısı dolaşır, baytlar sahibinden P2P
// istenir. Eski sürümler için Supabase "avatars" kovası adresleri yalnızca
// OKUNUR; başka hiçbir uzak adres kabul edilmez (IP sızdırma).
// Kendi profilimde `legacy: {av, an, bn}` eski kova adreslerini, ilgili resim
// değişene dek eski sürüm arkadaşlara göndermek için tutar.
(function () {
  const EXT_KEY = fid => `teamsync_profile_ext::${fid}`;
  const CACHE_KEY = 'teamsync_profile_cache';
  const CACHE_MAX = 200;
  const DEFAULT = { rev: 0, bio: '', bannerColor: '', bannerUrl: '', avatarColor: '', avatarAnimUrl: '', avatarRef: '', frame: 'none', accent: '', typingVerb: '' };
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

  // Saklanabilir görsel değeri: P2P tanımlayıcısı ya da eski kova adresi.
  // (Çizim için her zaman mediaSrc → TSProfileMedia.src kullanılır.)
  function legacyMedia(url) {
    if (typeof url !== 'string' || !url) return '';
    if (!SUPABASE_MEDIA_RE.test(url)) return '';
    if (mediaPrefix && !url.startsWith(mediaPrefix)) return '';
    return url;
  }
  function safeMedia(url) {
    if (typeof url !== 'string' || !url) return '';
    if (window.TSProfileMedia && window.TSProfileMedia.isRef(url)) return url;
    return legacyMedia(url);
  }
  const isMediaRef = v => !!(window.TSProfileMedia && window.TSProfileMedia.isRef(v));
  const mediaSrc = v => (window.TSProfileMedia ? window.TSProfileMedia.src(v) : legacyMedia(v));

  function sanitizeProfile(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const banner = p.banner && typeof p.banner === 'object' ? p.banner : {};
    const pm = p.pm && typeof p.pm === 'object' ? p.pm : {};
    const frame = window.TSUI.FRAMES.includes(p.frame) ? p.frame : 'none';
    const verb = typeof p.tv === 'string' ? p.tv : (typeof p.typingVerb === 'string' ? p.typingVerb : '');
    const lg = p.legacy && typeof p.legacy === 'object' ? p.legacy : null;
    const out = {
      bio: typeof p.bio === 'string' ? p.bio.slice(0, 190) : '',
      bannerColor: HEX.test(banner.c || p.bannerColor || '') ? (banner.c || p.bannerColor) : '',
      // Yeni istemcilerde `pm` (P2P tanımlayıcıları) önce gelir; eski alanlar eski sürümler içindir.
      bannerUrl: (isMediaRef(pm.bn) && pm.bn) || safeMedia(p.bannerUrl || '') || legacyMedia(banner.u || ''),
      avatarColor: HEX.test(p.avatarColor || '') ? p.avatarColor : '',
      avatarAnimUrl: (isMediaRef(pm.an) && pm.an) || safeMedia(p.avatarAnimUrl || '') || legacyMedia(p.anim || ''),
      avatarRef: (isMediaRef(pm.av) && pm.av) || (isMediaRef(p.avatarRef) ? p.avatarRef : ''),
      frame,
      accent: HEX.test(p.accent || '') ? p.accent : '',
      typingVerb: Array.from(verb.replace(/[\r\n<>]+/g, ' ').trim()).slice(0, 24).join('')
    };
    if (lg) out.legacy = { av: legacyMedia(lg.av), an: legacyMedia(lg.an), bn: legacyMedia(lg.bn) };
    return out;
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

  // Eski sürüm arkadaşlar yalnızca banner.u / anim / av alanlarını (Supabase
  // kovası adresleri) tanır: resim değişene dek eski adres gönderilmeye devam
  // eder. Yeni istemciler `pm` içindeki P2P tanımlayıcılarını kullanır.
  function wirePayload(p) {
    const out = { bio: p.bio, frame: p.frame };
    const lg = p.legacy || {};
    const oldBanner = legacyMedia(p.bannerUrl) || legacyMedia(lg.bn);
    const oldAnim = legacyMedia(p.avatarAnimUrl) || legacyMedia(lg.an);
    if (p.bannerColor || oldBanner) out.banner = { c: p.bannerColor || undefined, u: oldBanner || undefined };
    if (p.avatarColor) out.avatarColor = p.avatarColor;
    if (oldAnim) out.anim = oldAnim;
    if (p.accent) out.accent = p.accent;
    if (p.typingVerb) out.tv = p.typingVerb;
    const pm = {};
    if (isMediaRef(p.bannerUrl)) pm.bn = p.bannerUrl;
    if (isMediaRef(p.avatarAnimUrl)) pm.an = p.avatarAnimUrl;
    if (isMediaRef(window.state.myAvatar)) pm.av = window.state.myAvatar;
    if (Object.keys(pm).length) out.pm = pm;
    return out;
  }

  async function syncToSupabase() {
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
      if (window.state && window.state.accountKind !== 'cloud') return; // eski tip hesap: bulut hesabı başkasının olabilir
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) return;
      // Ayrı güncelleme: profile_ext sütunu yoksa (SQL kurulmadı) yalnızca bu
      // çağrı başarısız olur, isim/arkadaş eşitlemesi etkilenmez.
      // Yalnızca metin: P2P tanımlayıcıları + eski kova adresleri; resim verisi
      // (data:/blob:) TSProfileMedia.serverSafe ile atılır.
      const ext = window.TSProfileMedia ? window.TSProfileMedia.serverSafe(exportExt(), 'profile_ext') : exportExt();
      await supabaseClient.from('profiles').update({ profile_ext: ext }).eq('id', session.user.id);
    } catch (e) {}
  }

  // opts.exactLegacy: `next.legacy` olduğu gibi yazılır (taşıma / avatar).
  // Aksi hâlde (düzenleyici) değişen resmin eski kova adresi silinir: eski
  // sürüm arkadaşlar o resim için baş harfe / renge düşer.
  function saveMine(next, opts = {}) {
    ensureLoaded();
    const prev = window.state.myProfile || {};
    const clean = sanitizeProfile(next);
    const lg = opts.exactLegacy ? { ...(clean.legacy || {}) } : { ...(prev.legacy || {}) };
    if (!opts.exactLegacy) {
      if ((clean.bannerUrl || '') !== (prev.bannerUrl || '')) lg.bn = '';
      if ((clean.avatarAnimUrl || '') !== (prev.avatarAnimUrl || '')) lg.an = '';
    }
    clean.legacy = lg;
    if (!clean.avatarRef && !(next && 'avatarRef' in next)) clean.avatarRef = prev.avatarRef || '';
    if (!opts.exactLegacy && (clean.avatarRef || '') !== (prev.avatarRef || '')) lg.av = '';
    window.state.myProfile = { ...DEFAULT, ...clean, rev: (prev.rev || 0) + 1 };
    persistLocal();
    if (typeof window.saveProfile === 'function') window.saveProfile();
    syncToSupabase();
    if (typeof window.publishPresence === 'function') window.publishPresence();
    document.dispatchEvent(new CustomEvent('ts:profile', { detail: { fid: window.state.friendId } }));
  }

  // Mevcut profile küçük bir yama (avatar tanımlayıcısı, eski adreslerin
  // taşınması): fn(mevcut) → yeni profil; legacy olduğu gibi yazılır.
  function updateMine(fn) {
    ensureLoaded();
    const cur = { ...window.state.myProfile, legacy: { ...(window.state.myProfile.legacy || {}) } };
    saveMine(fn(cur), { exactLegacy: true });
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

  function request(fid, wantRev, force) {
    if (!fid || fid === window.state.friendId || !/^[A-Za-z0-9_-]{3,128}$/.test(fid)) return;
    const have = cache[fid] && !force ? cache[fid].rev : 0;
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

  const lastRevRequest = {};
  // Presence her geldiğinde çağrılır: önbellek eskiyse (en fazla 15 sn'de bir)
  // yeniden ister — tek bir kayıp yanıt profili sonsuza dek eski bırakmasın.
  function onRevSeen(fid, rev) {
    if ((cache[fid] ? cache[fid].rev : 0) >= rev) return;
    const now = Date.now();
    if (now - (lastRevRequest[fid] || 0) < 15000) return;
    lastRevRequest[fid] = now;
    setTimeout(() => request(fid, rev), Math.random() * 1500);
  }

  async function answer(toFid) {
    if (!toFid || !/^[A-Za-z0-9_-]{3,128}$/.test(toFid)) return;
    if (window.TSStatus && window.TSStatus.isInvisible()) return;
    if (window.TSBlock && window.TSBlock.isBlocked(toFid)) return; // engellenen profilimi göremez
    const now = Date.now();
    const p = mine();
    // Aynı sürümü 10 sn içinde tekrar gönderme; ama yeni bir sürüm (profil
    // az önce değiştiyse) sınıra takılmadan gider.
    const last = lastAnswered[toFid];
    if (last && now - last.at < 10000 && last.rev === (p.rev || 0)) return;
    lastAnswered[toFid] = { at: now, rev: p.rev || 0 };
    // Açık kimlik anahtarları (grup davetleri için; js/space/crypto.js).
    let keys = null;
    try { if (window.TSCrypto) { await window.TSCrypto.ensureIdentity(); keys = window.TSCrypto.publicKeysSync(); } } catch (e) {}
    const payload = { type: 'res_profile', fromId: window.state.friendId, rev: p.rev || 0, profile: wirePayload(p) };
    if (keys) payload.keys = keys;
    // Arkadaş olmayan grup üyeleri presence görmez: avatar burada. `av` yalnızca
    // eski sürümler için eski kova adresi; yeni istemciler profile.pm.av'yi kullanır.
    const av = window.TSProfileMedia ? window.TSProfileMedia.legacyAvatar() : legacyMedia(window.state.myAvatar);
    if (av) payload.av = av;
    publishTo(toFid, payload, 1);
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
      // Ortak bir grubun üyesi (arkadaş olmasa da) kabul edilir: üye panelinde ad/avatar.
      const sharesGroup = !!(window.TSGroups && window.TSGroups.list && window.TSGroups.list().some(g => g.members.some(m => m.fid === fid)));
      if (!pending[fid] && !(window.state.friends && window.state.friends[fid]) && !cache[fid] && !sharesGroup) return;
      const r = Number.isInteger(data.rev) ? data.rev : 0;
      if (data.keys && window.TSCrypto && window.state.friends && window.state.friends[fid]) window.TSCrypto.rememberPeer(fid, data.keys);
      const prof = sanitizeProfile(data.profile);
      delete prof.legacy;
      const foreign = v => isMediaRef(v) && window.TSProfileMedia.parse(v).fid !== fid;
      if (foreign(prof.bannerUrl)) prof.bannerUrl = '';
      if (foreign(prof.avatarAnimUrl)) prof.avatarAnimUrl = '';
      // Avatar: P2P tanımlayıcısı (yalnız sahibinin kendi kimliğiyle) ya da eski kova adresi.
      const ref = prof.avatarRef && window.TSProfileMedia && (window.TSProfileMedia.parse(prof.avatarRef) || {}).fid === fid ? prof.avatarRef : '';
      cache[fid] = { rev: r, profile: { ...prof, avatarRef: ref, avatarUrl: ref || legacyMedia(data.av) }, at: Date.now() };
      // Arkadaşın listedeki avatarı da yenilensin (baytlar gelene dek eskisi kalır).
      if (ref && window.state.friends && window.state.friends[fid] && window.TSProfileMedia) window.TSProfileMedia.adoptFriendAvatar(fid, ref);
      saveCache();
      if (pending[fid]) { clearTimeout(pending[fid].timer); delete pending[fid]; }
      document.dispatchEvent(new CustomEvent('ts:profile', { detail: { fid } }));
    }
  }

  // ---------- Kart modeli ----------
  // hint: arkadaş olmayan grup üyesi için { name, status } (js/ui/group-view.js).
  function friendModel(fid, hint) {
    const f = (window.state.friends || {})[fid] || {};
    let st = window.TSStatus ? window.TSStatus.statusOf(fid) : (f.online ? 'online' : 'offline');
    if (hint && hint.status && st === 'offline') st = hint.status;
    const pres = window.TSStatus ? window.TSStatus.presenceOf(fid) : null;
    const prof = profileOf(fid) || { ...DEFAULT };
    const nick = typeof window.getNickname === 'function' ? window.getNickname(fid) : '';
    return {
      kind: 'friend',
      fid,
      name: nick || f.name || (hint && hint.name) || fid,
      realName: f.name || '',
      avatar: f.avatar || prof.avatarUrl || undefined,
      blocked: !!(window.TSBlock && window.TSBlock.isBlocked(fid)),
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
    const img = mediaSrc(p.bannerUrl);
    if (img) return `background-image:url('${esc(img)}');background-color:${p.bannerColor ? esc(p.bannerColor) : 'var(--bg-dark)'}`;
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
        <div class="pc-banner ${mediaSrc(p.bannerUrl) ? 'has-img' : ''}" style="${bannerStyle(p, m.fid || m.name)}"></div>
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
  // Düzen: birincil eylem tam genişlik en üstte, ikincil eylemler eşit bir
  // satırda, yıkıcı eylemler (çıkar / engelle) en altta daha sakin bir satırda.
  function actionButtons(m) {
    const b = (action, label, cls = '') => `<button type="button" class="pc-btn ${cls}" data-pc-action="${action}">${esc(label)}</button>`;
    let pri = '';
    const sec = [];
    const danger = [];
    if (m.kind === 'self') {
      sec.push(b('edit-profile', tr('profile.editProfile')));
    } else if (m.kind === 'friend' && m.blocked) {
      sec.push(b('unblock', tr('friends.unblock')));
    } else {
      const groupOnly = m.kind === 'friend' && !m.isFriend; // ortak gruptaki arkadaş olmayan üye
      if (m.fid && !groupOnly) pri = b('message', tr('profile.sendMessage'), 'pc-btn-pri');
      if (m.kind === 'friend' && m.isFriend) {
        sec.push(b('mute', tr(m.muted ? 'profile.unmute' : 'profile.mute')));
        danger.push(b('remove', tr('profile.removeFriend'), 'pc-btn-danger'));
        danger.push(b('block', tr('friends.block'), 'pc-btn-danger'));
      } else if (groupOnly && m.fid) {
        pri = b('request', tr('profile.addFriend'), 'pc-btn-pri');
        danger.push(b('block', tr('friends.block'), 'pc-btn-danger'));
      } else if (m.kind === 'room' && m.roomPeerId) {
        sec.push(b('add-friend', tr('profile.addFriend')));
      }
    }
    const row = (items, cls) => items.length ? `<div class="pc-actions-row ${cls}">${items.join('')}</div>` : '';
    const html = (pri ? row([pri], 'is-pri') : '') + row(sec, 'is-sec') + row(danger, 'is-danger');
    return html ? `<div class="pc-actions">${html}</div>` : '';
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
      else if (action === 'request') { close(); typeof window.sendFriendRequestTo === 'function' && window.sendFriendRequestTo(m.fid); }
      else if (action === 'block') { close(); window.TSFriends && window.TSFriends.confirmBlock(m.fid, m.name); }
      else if (action === 'unblock') { close(); window.TSFriends && window.TSFriends.unblockUser(m.fid); }
      else if (action === 'edit-profile') { close(); window.openUserSettings && window.openUserSettings('profile'); }
    });
  }

  let openCard = null; // { key, refresh }

  function showCard(target, anchor) {
    let modelFn;
    // Odadan kendi kartını açmak (showRoomUserProfile(state.myId)) da "ben"
    // kartıdır: arkadaş ekle / engelle değil, "Profili düzenle" gösterilir.
    const st = window.state || {};
    const isMe = target.self
      || (target.roomPeerId && (target.roomPeerId === 'self' || target.roomPeerId === st.myId))
      || (target.friendId && target.friendId === st.friendId);
    if (isMe) modelFn = () => selfModel();
    else if (target.roomPeerId) modelFn = () => roomPeerModel(target.roomPeerId, target.name);
    else if (target.friendId) modelFn = () => friendModel(target.friendId, target);
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
  let editorPreview = () => {};
  let editorPick = () => {};

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
            <p class="pe-help pe-local-note" data-pe-local-note>${window.TSUI.icon ? window.TSUI.icon('lock', 14) : ''}<span>${esc(tr('profile.mediaLocalNote'))}</span></p>
            <div class="pe-inline">
              <button type="button" class="btn-pri btn-sm" data-pe="change-avatar">${esc(tr('profile.changeAvatar'))}</button>
              <input type="file" class="hidden" accept="image/png,image/jpeg,image/webp,image/gif" data-pe-file="avatar" />
            </div>
            <div class="pe-media-msg hidden" data-pe-msg="avatar" role="alert"></div>
          </div>
          <div class="pe-field">
            <label>${esc(tr('profile.animatedAvatar'))}</label>
            <p class="pe-help">${esc(tr('profile.animatedAvatarDesc'))}</p>
            <div class="pe-inline">
              <button type="button" class="btn-sec btn-sm" data-pe="upload-gif">${esc(tr('profile.uploadGif'))}</button>
              <button type="button" class="btn-sec btn-sm ${draft.avatarAnimUrl ? '' : 'hidden'}" data-pe="remove-gif">${esc(tr('profile.remove'))}</button>
              <input type="file" class="hidden" accept="image/gif" data-pe-file="gif" />
            </div>
            <div class="pe-media-msg hidden" data-pe-msg="gif" role="alert"></div>
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
            <div class="pe-media-msg hidden" data-pe-msg="banner" role="alert"></div>
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
    // Görseller bu cihazda işlenir ve saklanır (js/profile-media.js); hiçbir
    // bayt sunucuya gitmez. Hata, ilgili alanın altında satır içi gösterilir.
    const PM = () => window.TSProfileMedia;
    const showMsg = (kind, text, tone) => {
      root.querySelectorAll('[data-pe-msg]').forEach(el => {
        const on = el.dataset.peMsg === kind && !!text;
        el.classList.toggle('hidden', !on);
        el.classList.toggle('is-error', on && tone === 'error');
        el.innerHTML = on ? `${window.TSUI.icon ? window.TSUI.icon(tone === 'error' ? 'alert' : 'info', 14) : ''}<span>${esc(text)}</span>` : '';
      });
    };
    const handleFile = (kind, run) => root.querySelector(`[data-pe-file="${kind}"]`).addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file || !PM()) return;
      showMsg(kind, tr('profile.mediaProcessing'), 'info');
      try {
        await run(file);
        showMsg(kind, '');
      } catch (err) {
        if (!(err instanceof PM().MediaError)) console.warn('[profil] görsel işlenemedi', err);
        showMsg(kind, PM().errorText(err), 'error');
      }
      preview();
    });
    handleFile('avatar', async file => {
      await PM().setOwnAvatarFromFile(file);
      draft.avatarRef = window.state.myAvatar;
      window.showToast(tr('profile.avatarSaved'), 'ok');
    });
    handleFile('gif', async file => {
      const res = await PM().processAnimAvatar(file);
      draft.avatarAnimUrl = res.ref;
      // İlk kare sabit avatar olur (listeler, hareket oynatmayan yerler); Kaydet'te uygulanır.
      draft._still = res.firstFrameRef;
      draft._stillFor = res.ref;
    });
    handleFile('banner', async file => {
      const res = await PM().processBanner(file);
      draft.bannerUrl = res.ref;
    });

    editorPreview = preview;
    editorPick = pick;
    // root kalıcı bir öğe (yalnızca içi yeniden yazılıyor): dinleyici bir kez
    // bağlanmalı. Her renderEditor'da yeniden eklendiğinde Ayarlar > Profil N
    // kez açıldıktan sonra "Kaydet" saveMine'ı N kez çağırıyor, her kayıt da
    // dinleyici sayısını katlıyordu.
    if (root.dataset.peBound) return;
    root.dataset.peBound = '1';
    root.addEventListener('click', e => {
      const btn = e.target.closest('[data-pe]');
      if (!btn || !draft) return;
      const a = btn.dataset.pe;
      if (a === 'edit-name') document.getElementById('btn-edit-name')?.click();
      else if (a === 'change-avatar') editorPick('avatar');
      else if (a === 'upload-gif') editorPick('gif');
      else if (a === 'remove-gif') { draft.avatarAnimUrl = ''; editorPreview(); }
      else if (a === 'upload-banner') editorPick('banner');
      else if (a === 'remove-banner') { draft.bannerUrl = ''; editorPreview(); }
      else if (a === 'reset') renderEditor();
      else if (a === 'save') {
        if (draft._still && draft._stillFor === draft.avatarAnimUrl) {
          draft.avatarRef = draft._still;
          window.state.myAvatar = draft._still;
          window.state.myAvatarHash = typeof window.getAvatarHash === 'function' ? window.getAvatarHash(draft._still) : null;
        }
        saveMine(draft);
        if (window.TSProfileMedia) window.TSProfileMedia.renderOwnAvatarImg();
        window.showToast(tr('profile.saved'), 'ok');
        renderEditor();
      }
    });
  }

  // Eski showFriendProfile / showRoomUserProfile yerine yeni kart.
  window.showFriendProfile = (fid, anchor) => showCard({ friendId: fid }, anchor);
  window.showRoomUserProfile = (peerId, name, anchor) => showCard({ roomPeerId: peerId, name }, anchor);

  window.TSProfile = {
    rev, mine, exportExt, importExt, profileOf, request, onRevSeen, onEvent,
    save: next => saveMine(next),
    updateMine,
    showCard, showSelfPanel, cardHtml, friendModel, selfModel, renderEditor,
    typingVerbOf: fid => (profileOf(fid) || {}).typingVerb || '',
    _safeMedia: safeMedia,
    isEditorDirty: editorDirty
  };
})();
