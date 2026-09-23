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
    return `<span class="${cls}" style="--av:${size}px">${inner}${dot}</span>`;
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
    const { el, onClose, cleanup } = openPopover;
    openPopover = null;
    cleanup();
    el.remove();
    if (typeof onClose === 'function') { try { onClose(); } catch (e) {} }
  }

  // anchor: tıklanan öğe (ya da {x,y}); placement: 'right'|'top'|'bottom'|'left'
  function popover(content, anchor, opts = {}) {
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
    setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    openPopover = {
      el,
      onClose: opts.onClose,
      cleanup: () => {
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', onResize);
      }
    };
    return { el, close: closePopover, reposition: place };
  }

  function copyText(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      if (typeof window.showToast === 'function') window.showToast(tr('toast.idCopied'), 'ok');
    }).catch(() => {});
  }

  window.TSUI = {
    esc, tr, colorFromString, avatarHtml, statusLabel, formatElapsed, sinceHtml,
    steamArt, gameArtHtml, popover, closePopover, copyText, FRAMES, GAMEPAD_SVG,
    startTicker, tick
  };
  startTicker();
})();
