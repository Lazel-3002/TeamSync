// Kabuk genelinde paylaşılan küçük arayüz yardımcıları: avatar + durum
// noktası, süre biçimleme (oyun/arama sayaçları), tek merkezli saniye
// sayacı ve konumlanan açılır kartlar (popover). renderer.js'ten SONRA yüklenir;
// escapeHtml / safeAvatarUrl / t gibi globalleri çalışma anında kullanır.
(function () {
  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const tr = (key, vars) => (typeof window.t === 'function' ? window.t(key, vars) : key);

  // Kişiye özgü, temadan bağımsız okunaklı bir renk (avatar yoksa zemin).
  function colorFromString(value) {
    let hash = 0;
    const text = String(value || '?');
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 55% 45%)`;
  }

  const FRAMES = ['none', 'neon', 'gold', 'rainbow', 'flame', 'frost'];
  const STATUSES = ['online', 'idle', 'dnd', 'offline', 'invisible'];

  function safeImg(src) {
    if (!src || typeof src !== 'string') return '';
    try {
      return typeof window.safeAvatarUrl === 'function' ? (window.safeAvatarUrl(src) || '') : '';
    } catch (e) { return ''; }
  }

  // size: px. status: STATUSES veya null. frame: FRAMES. anim: hareketli GIF
  // (yalnızca açık kartta/hover'da oynatılır — donanım hızlandırma kapalıyken
  // listede onlarca GIF CPU'yu yer).
  function avatarHtml(opts = {}) {
    const size = opts.size || 32;
    const name = opts.name || '?';
    const src = safeImg(opts.src);
    const anim = opts.animate ? safeImg(opts.anim) : '';
    const frame = FRAMES.includes(opts.frame) ? opts.frame : 'none';
    const status = STATUSES.includes(opts.status) ? opts.status : null;
    const bg = opts.color && /^#[0-9a-f]{6}$/i.test(opts.color) ? opts.color : colorFromString(opts.seed || name);
    const inner = (anim || src)
      ? `<img class="ts-av-img" src="${esc(anim || src)}" alt="" draggable="false" loading="lazy" />`
      : `<span class="ts-av-initial" style="background:${bg}">${esc(String(name).trim().charAt(0).toUpperCase() || '?')}</span>`;
    const dot = status ? `<i class="ts-dot s-${status}" aria-hidden="true"></i>` : '';
    const cls = ['ts-av', frame !== 'none' ? `ts-frame ts-frame-${frame}` : '', opts.cls || ''].filter(Boolean).join(' ');
    // P2P profil resmi henüz bu cihazda değilse baş harf gösterilir; baytlar
    // gelince js/profile-media.js [data-tsm] işaretli avatarı yerinde günceller.
    const pending = !(anim || src) && window.TSProfileMedia ? window.TSProfileMedia.parse(opts.src) : null;
    const mark = pending ? ` data-tsm="${pending.h}"` : '';
    return `<span class="${cls}" style="--av:${size}px"${mark}>${inner}${dot}</span>`;
  }

  function statusLabel(status) {
    return tr(`status.${status === 'invisible' ? 'invisible' : (STATUSES.includes(status) ? status : 'offline')}`);
  }

  // 5:49, 1:02:03 — Discord'daki "Oynuyor" sayacı biçimi.
  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // Tek merkezli sayaç: [data-ts-since="<epoch ms>"] taşıyan her öğenin metni
  // saniyede bir güncellenir. setInterval kullanılır (rAF arka planda kısılır)
  // ve pencere görünmezken DOM'a hiç dokunulmaz.
  let tickTimer = null;
  // Yalnızca simge durumundayken (document.hidden) durur: pencere odakta
  // olmasa da (ör. oyun başka ekrandayken) sayaçlar akmaya devam etmeli.
  function tick() {
    if (document.hidden) return;
    const now = Date.now();
    document.querySelectorAll('[data-ts-since]').forEach(el => {
      const since = Number(el.dataset.tsSince);
      if (!Number.isFinite(since) || since <= 0) return;
      const text = formatElapsed(now - since);
      if (el.textContent !== text) el.textContent = text;
    });
  }
  function startTicker() {
    if (tickTimer) return;
    tickTimer = setInterval(tick, 1000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  function sinceHtml(since, cls = '') {
    if (!since) return '';
    return `<span class="ts-since ${cls}" data-ts-since="${Number(since)}">${formatElapsed(Date.now() - Number(since))}</span>`;
  }

  // Steam oyun görseli yalnızca appid'den YEREL olarak kurulur; karşı taraftan
  // gelen URL'ye asla gidilmez (IP sızdırma).
  function steamArt(appId, kind = 'capsule') {
    const id = Number(appId);
    if (!Number.isInteger(id) || id <= 0 || id > 99999999) return '';
    if (kind === 'header') return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
  }

  const GAMEPAD_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="11" x2="10" y2="11"></line><line x1="8" y1="9" x2="8" y2="13"></line><line x1="15" y1="12" x2="15.01" y2="12"></line><line x1="18" y1="10" x2="18.01" y2="10"></line><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"></path></svg>';

  // Oyun görseli: Steam kapak → header → gamepad ikonu. onerror zinciri
  // inline tutulur çünkü kartlar innerHTML ile üretiliyor.
  function gameArtHtml(activity, size = 56) {
    const first = activity && activity.sid ? steamArt(activity.sid) : '';
    const second = activity && activity.sid ? steamArt(activity.sid, 'header') : '';
    const local = activity && activity.icon && /^data:image\/png;base64,/.test(activity.icon) ? activity.icon : '';
    const fallback = `<span class="ts-game-fallback">${GAMEPAD_SVG}</span>`;
    if (!first && !local) return `<span class="ts-game-art" style="--gs:${size}px">${fallback}</span>`;
    const src = first || local;
    const onerr = second
      ? `if(!this.dataset.f){this.dataset.f=1;this.src='${second}';}else{this.replaceWith(Object.assign(document.createElement('span'),{className:'ts-game-fallback',innerHTML:${JSON.stringify(GAMEPAD_SVG).replace(/"/g, '&quot;')}}));}`
      : `this.replaceWith(Object.assign(document.createElement('span'),{className:'ts-game-fallback',innerHTML:${JSON.stringify(GAMEPAD_SVG).replace(/"/g, '&quot;')}}))`;
    return `<span class="ts-game-art" style="--gs:${size}px"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="${onerr}" /></span>`;
  }

  // ---------- Açılır kart (popover) ----------
  let openPopover = null;
  function closePopover() {
    if (!openPopover) return;
    const { el, onClose, cleanup, anchor } = openPopover;
    openPopover = null;
    cleanup();
    el.remove();
    if (anchor && anchor.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', 'false');
    if (typeof onClose === 'function') { try { onClose(); } catch (e) {} }
  }

  const isEl = a => !!(a && typeof a.getBoundingClientRect === 'function' && a.nodeType === 1);

  // Bu öğeye bağlı bir popover şu an açık mı?
  function isPopoverOpenFor(anchor) {
    return !!(openPopover && isEl(anchor) && openPopover.anchor === anchor);
  }

  // anchor: tıklanan öğe (ya da {x,y}); placement: 'right'|'top'|'bottom'|'left'
  // Aynı düğmeye ikinci tıklama açık popover'ı KAPATIR (aç/kapa). Bu durumda
  // dönen nesne belgeye eklenmemiş bir öğe taşır (closed: true): çağıranların
  // pop.el.querySelector(...) / addEventListener / reposition çağrıları
  // zararsız kalır, hiçbir şey ekranda görünmez.
  function popover(content, anchor, opts = {}) {
    if (!opts.noToggle && isPopoverOpenFor(anchor)) {
      closePopover();
      const ghost = document.createElement('div');
      if (typeof content === 'string') ghost.innerHTML = content; else ghost.appendChild(content);
      const noop = () => {};
      return { el: ghost, close: noop, reposition: noop, closed: true };
    }
    closePopover();
    const el = document.createElement('div');
    el.className = `ts-popover ${opts.cls || ''}`;
    el.setAttribute('role', opts.role || 'dialog');
    el.setAttribute('data-i18n-ignore', '');
    if (typeof content === 'string') el.innerHTML = content; else el.appendChild(content);
    el.style.visibility = 'hidden';
    document.body.appendChild(el);

    const place = () => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const r = el.getBoundingClientRect();
      let x; let y;
      const gap = 8;
      if (anchor && typeof anchor.getBoundingClientRect === 'function') {
        const a = anchor.getBoundingClientRect();
        const placement = opts.placement || 'right';
        if (placement === 'top') { x = a.left; y = a.top - r.height - gap; }
        else if (placement === 'bottom') { x = a.left; y = a.bottom + gap; }
        else if (placement === 'left') { x = a.left - r.width - gap; y = a.top; }
        else { x = a.right + gap; y = a.top; }
        if (placement === 'right' && x + r.width > vw - 8) x = a.left - r.width - gap;
        if (placement === 'top' && y < 43) y = a.bottom + gap;
      } else if (anchor && Number.isFinite(anchor.x)) {
        x = anchor.x; y = anchor.y;
      } else {
        x = (vw - r.width) / 2; y = Math.max(43, (vh - r.height) / 2);
      }
      x = Math.max(8, Math.min(x, vw - r.width - 8));
      y = Math.max(43, Math.min(y, vh - r.height - 8));
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      el.style.visibility = '';
    };
    place();

    const onDown = e => {
      if (el.contains(e.target)) return;
      if (anchor && anchor.contains && anchor.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.ts-popover-keep')) return;
      closePopover();
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } };
    const onResize = () => closePopover();
    let closed = false;
    // Dış tıklama dinleyicisi bir tur sonra eklenir (açan tıklama kapatmasın).
    // Popover o arada kapandıysa EKLENMEMELİ: yoksa sahipsiz kalan dinleyici
    // sonraki her popover'ı ilk tıklamada (içine bile olsa) kapatıyordu.
    setTimeout(() => { if (!closed) document.addEventListener('mousedown', onDown, true); }, 0);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    if (isEl(anchor)) anchor.setAttribute('aria-expanded', 'true');
    openPopover = {
      el,
      anchor: isEl(anchor) ? anchor : null,
      onClose: opts.onClose,
      cleanup: () => {
        closed = true;
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', onResize);
      }
    };
    // Yalnızca BU popover'ı kapatır: async bir işlem sonunda çağrılan close(),
    // araya açılmış başka bir popover'ı kapatmasın.
    const close = () => { if (openPopover && openPopover.el === el) closePopover(); };
    return { el, close, reposition: place };
  }

  // ---------- Ortak ikon seti (Lucide/Feather tarzı, 24x24, stroke) ----------
  // TSUI.icon('phone', 18) → satır içi <svg>. Bilinmeyen ad → ''.
  const ICONS = {
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    phoneOff: '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/>',
    video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    pencil: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    userMinus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    crown: '<path d="M2 18h20"/><path d="M3 18 2 7l5.5 4L12 4l4.5 7L22 7l-1 11"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
    volumeMute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    micOff: '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    chevronUp: '<polyline points="18 15 12 9 6 15"/>',
    chevronRight: '<polyline points="9 18 15 12 9 6"/>',
    chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    keyboard: '<rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
    gamepad: '<line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    bellOff: '<path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/>',
    pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    starFilled: '<polygon fill="currentColor" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    messageCircle: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    server: '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
    sliders: '<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>',
    devices: '<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 15v4"/><path d="M7 19h5"/><rect x="16" y="11" width="6" height="10" rx="2"/>',
    screenShare: '<path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m17 8 5-5"/><path d="M17 3h5v5"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    play: '<polygon points="6 4 20 12 6 20 6 4"/>',
    power: '<path d="M12 3v9"/><path d="M6 5.8a9 9 0 1 0 12 0"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>',
    bot: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="16" y1="13" x2="16" y2="15"/>',
    mousePointer: '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/>',
    hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
    key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    helpCircle: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    arrowDown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'
  };
  function icon(name, size = 18, strokeWidth = 2) {
    const inner = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : '';
    if (!inner) return '';
    const s = Number(size) || 18;
    const w = Number(strokeWidth) || 2;
    return `<svg class="ts-ico" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
  }

  function copyText(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      if (typeof window.showToast === 'function') window.showToast(tr('toast.idCopied'), 'ok');
    }).catch(() => {});
  }

  window.TSUI = {
    esc, tr, colorFromString, avatarHtml, statusLabel, formatElapsed, sinceHtml,
    steamArt, gameArtHtml, popover, closePopover, isPopoverOpenFor, copyText, FRAMES, GAMEPAD_SVG,
    startTicker, tick, icon, ICONS
  };
  startTicker();
})();
