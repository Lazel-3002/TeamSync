/* TeamSync — özel renk seçici.
 *
 * Electron'da <input type="color"> tıklanınca Chromium'un yerel Windows
 * diyaloğu açılıyor; görünümü CSS ile değiştirilemiyor. Burada o diyaloğu
 * capture aşamasında iptal edip yerine uygulamanın temasını kullanan bir
 * popover açıyoruz.
 *
 * Mevcut koda dokunmuyoruz: seçim yapıldıkça inputun value'su güncellenip
 * 'input', kapanışta 'change' olayı fırlatılıyor. Böylece renderer.js'teki
 * tema senkronu ve whiteboard.js'teki kalem rengi aynen çalışmaya devam eder.
 *
 * Devre dışı bırakmak için: <input type="color" data-native-color="true">
 */
(() => {
  'use strict';
  if (window.__tsColorPicker) return;

  const RECENT_KEY = 'teamsync_color_recents';
  const RECENT_MAX = 10;

  const PRESETS = [
    '#ffffff', '#d1d5db', '#9ca3af', '#4b5563', '#1f2937',
    '#000000', '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
    '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'
  ];

  const STRINGS = {
    en: { title: 'Color picker', recent: 'Recent', eyedropper: 'Pick color from screen' },
    tr: { title: 'Renk seçici', recent: 'Son kullanılan', eyedropper: 'Ekrandan renk seç' },
    de: { title: 'Farbwähler', recent: 'Zuletzt', eyedropper: 'Farbe vom Bildschirm wählen' },
    es: { title: 'Selector de color', recent: 'Recientes', eyedropper: 'Elegir color de la pantalla' },
    fr: { title: 'Sélecteur de couleur', recent: 'Récents', eyedropper: 'Choisir une couleur à l’écran' },
    'pt-BR': { title: 'Seletor de cores', recent: 'Recentes', eyedropper: 'Escolher cor da tela' },
    ru: { title: 'Выбор цвета', recent: 'Недавние', eyedropper: 'Выбрать цвет с экрана' },
    ar: { title: 'منتقي الألوان', recent: 'الأخيرة', eyedropper: 'اختر لونًا من الشاشة' },
    kk: { title: 'Түс таңдағыш', recent: 'Соңғылары', eyedropper: 'Экраннан түс таңдау' },
    tk: { title: 'Reňk saýlaýjy', recent: 'Soňkylar', eyedropper: 'Ekrandan reňk saýla' },
    mn: { title: 'Өнгө сонгогч', recent: 'Сүүлийн', eyedropper: 'Дэлгэцээс өнгө сонгох' },
    'zh-CN': { title: '颜色选择器', recent: '最近使用', eyedropper: '从屏幕取色' },
    ja: { title: 'カラーピッカー', recent: '最近の色', eyedropper: '画面から色を選択' }
  };

  function t(key) {
    let lang = 'en';
    try { lang = localStorage.getItem('teamsync_language') || 'en'; } catch { /* yoksay */ }
    return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key];
  }

  /* ------------------------------- renk matematiği ------------------------ */

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function normalizeHex(raw) {
    if (typeof raw !== 'string') return null;
    let v = raw.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(v)) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    if (!/^[0-9a-f]{6}$/i.test(v)) return null;
    return '#' + v.toLowerCase();
  }

  function hexToRgb(hex) {
    const v = normalizeHex(hex) || '#000000';
    return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16) };
  }

  const rgbToHex = ({ r, g, b }) =>
    '#' + [r, g, b].map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');

  function rgbToHsv({ r, g, b }) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  function hsvToRgb({ h, s, v }) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
  }

  // Seçili renk açık mı? (imlecin ve çerçevenin okunur kalması için)
  const isLight = ({ r, g, b }) => (0.299 * r + 0.587 * g + 0.114 * b) > 150;

  /* ------------------------------- son renkler ---------------------------- */

  function loadRecents() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(raw) ? raw.map(normalizeHex).filter(Boolean).slice(0, RECENT_MAX) : [];
    } catch { return []; }
  }

  function pushRecent(hex) {
    const value = normalizeHex(hex);
    if (!value) return;
    const list = loadRecents().filter(c => c !== value);
    list.unshift(value);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* yoksay */ }
  }

  /* --------------------------------- stiller ------------------------------ */

  const CSS = `
.tscp-panel {
  position: fixed; z-index: 1000000; width: 272px; padding: 14px;
  display: grid; gap: 12px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--txt-main, #f8fafc) 13%, transparent);
  background: color-mix(in srgb, var(--bg-card, #1e293b) 94%, #000 6%);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow: 0 26px 60px rgba(0, 0, 0, .46), 0 4px 14px rgba(0, 0, 0, .28),
              inset 0 1px 0 color-mix(in srgb, var(--txt-main, #fff) 8%, transparent);
  color: var(--txt-main, #f8fafc);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 12px; line-height: 1.4;
  user-select: none; -webkit-user-select: none;
  animation: tscp-in .16s cubic-bezier(.22, 1, .36, 1);
  transform-origin: var(--tscp-origin, top left);
}
@keyframes tscp-in { from { opacity: 0; transform: translateY(-6px) scale(.97); } to { opacity: 1; transform: none; } }
.tscp-panel.tscp-closing { animation: tscp-out .1s ease forwards; pointer-events: none; }
@keyframes tscp-out { to { opacity: 0; transform: translateY(-4px) scale(.985); } }
@media (prefers-reduced-motion: reduce) { .tscp-panel, .tscp-panel.tscp-closing { animation: none; } }

/* --- doygunluk / parlaklık alanı --- */
.tscp-sv {
  position: relative; height: 148px; border-radius: 12px; cursor: crosshair;
  background:
    linear-gradient(to top, #000, rgba(0, 0, 0, 0)),
    linear-gradient(to right, #fff, hsl(var(--tscp-hue, 0) 100% 50%));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .14), inset 0 0 0 2px rgba(0, 0, 0, .12);
  touch-action: none;
}
.tscp-sv:focus-visible { outline: 2px solid var(--acc-light, #818cf8); outline-offset: 3px; }
.tscp-sv-dot {
  position: absolute; width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid #fff; background: transparent;
  transform: translate(-50%, -50%); pointer-events: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .5), 0 1px 4px rgba(0, 0, 0, .45), inset 0 0 0 1px rgba(0, 0, 0, .28);
}

/* --- ton şeridi + önizleme + damlalık --- */
.tscp-row { display: flex; align-items: center; gap: 10px; }
.tscp-eye {
  flex: none; width: 30px; height: 30px; display: grid; place-items: center;
  border-radius: 9px; cursor: pointer; color: var(--txt-mut, #94a3b8);
  border: 1px solid color-mix(in srgb, var(--txt-main, #fff) 14%, transparent);
  background: color-mix(in srgb, var(--txt-main, #fff) 5%, transparent);
  transition: color .15s ease, background .15s ease, border-color .15s ease, transform .12s ease;
}
.tscp-eye:hover { color: var(--txt-main, #fff); background: color-mix(in srgb, var(--acc, #6366f1) 22%, transparent); border-color: color-mix(in srgb, var(--acc-light, #818cf8) 60%, transparent); }
.tscp-eye:active { transform: scale(.94); }
.tscp-eye:focus-visible { outline: 2px solid var(--acc-light, #818cf8); outline-offset: 2px; }
.tscp-eye svg { width: 15px; height: 15px; }
.tscp-preview {
  flex: none; width: 30px; height: 30px; border-radius: 50%;
  background: var(--tscp-color, #000);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .35), inset 0 0 0 1px rgba(255, 255, 255, .22), 0 3px 8px rgba(0, 0, 0, .3);
}
.tscp-hue {
  position: relative; flex: 1; height: 12px; border-radius: 999px; cursor: pointer;
  background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .22), inset 0 1px 2px rgba(0, 0, 0, .2);
  touch-action: none;
}
.tscp-hue:focus-visible { outline: 2px solid var(--acc-light, #818cf8); outline-offset: 4px; }
.tscp-hue-dot {
  position: absolute; top: 50%; width: 18px; height: 18px; border-radius: 50%;
  background: hsl(var(--tscp-hue, 0) 100% 50%); border: 2px solid #fff;
  transform: translate(-50%, -50%); pointer-events: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .4), 0 2px 6px rgba(0, 0, 0, .4);
}

/* --- hex / rgb kutuları --- */
.tscp-fields { display: grid; grid-template-columns: 1.7fr repeat(3, 1fr); gap: 6px; }
.tscp-field { display: grid; gap: 4px; min-width: 0; }
.tscp-field input {
  width: 100%; box-sizing: border-box; padding: 7px 6px; text-align: center;
  border-radius: 8px; border: 1px solid color-mix(in srgb, var(--txt-main, #fff) 14%, transparent);
  background: color-mix(in srgb, var(--txt-main, #fff) 5%, transparent);
  color: var(--txt-main, #f8fafc);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
  transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
}
.tscp-field input:hover { border-color: color-mix(in srgb, var(--txt-main, #fff) 26%, transparent); }
.tscp-field input:focus {
  outline: none; background: color-mix(in srgb, var(--txt-main, #fff) 8%, transparent);
  border-color: var(--acc-light, #818cf8);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--acc, #6366f1) 26%, transparent);
}
.tscp-field span {
  text-align: center; font-size: 9px; font-weight: 800; letter-spacing: .09em;
  text-transform: uppercase; color: var(--txt-mut, #94a3b8);
}

/* --- hazır renkler / son kullanılanlar --- */
.tscp-sep { display: flex; align-items: center; gap: 8px; margin-top: -2px; }
.tscp-sep::after { content: ''; flex: 1; height: 1px; background: color-mix(in srgb, var(--txt-main, #fff) 12%, transparent); }
.tscp-sep b { font-size: 9px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--txt-mut, #94a3b8); }
.tscp-swatches { display: grid; grid-template-columns: repeat(10, 1fr); gap: 5px; }
.tscp-swatch {
  position: relative; width: 100%; aspect-ratio: 1; padding: 0; border-radius: 6px; cursor: pointer;
  border: 1px solid rgba(0, 0, 0, .3);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .16);
  transition: transform .13s cubic-bezier(.22, 1, .36, 1), box-shadow .13s ease;
}
.tscp-swatch:hover { transform: translateY(-2px) scale(1.08); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .3), 0 4px 10px rgba(0, 0, 0, .34); }
.tscp-swatch:active { transform: scale(.96); }
.tscp-swatch:focus-visible { outline: 2px solid var(--acc-light, #818cf8); outline-offset: 2px; }
.tscp-swatch.tscp-active { box-shadow: 0 0 0 2px var(--bg-card, #1e293b), 0 0 0 4px var(--acc-light, #818cf8); }

/* Açık temalarda yarı saydam beyaz kaplamalar kontrastsız kalıyor. */
:root:is([data-theme="white"], [data-theme="violet"]) .tscp-panel {
  background: rgba(255, 255, 255, .97); color: #172033;
  border-color: rgba(31, 41, 55, .14);
  box-shadow: 0 26px 60px rgba(31, 41, 55, .22), 0 4px 14px rgba(31, 41, 55, .12);
}
:root:is([data-theme="white"], [data-theme="violet"]) .tscp-field input,
:root:is([data-theme="white"], [data-theme="violet"]) .tscp-eye { background: #fff; border-color: #d9dfeb; color: #172033; }
:root:is([data-theme="white"], [data-theme="violet"]) .tscp-field span,
:root:is([data-theme="white"], [data-theme="violet"]) .tscp-sep b { color: #667085; }
:root:is([data-theme="white"], [data-theme="violet"]) .tscp-sep::after { background: rgba(31, 41, 55, .12); }
:root:is([data-theme="white"], [data-theme="violet"]) .tscp-swatch { border-color: rgba(31, 41, 55, .28); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35); }
:root:is([data-theme="white"], [data-theme="violet"]) .tscp-swatch.tscp-active { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--acc, #6366f1); }

/* Panelde display:grid/flex var; [hidden] tek başına gizlemeye yetmiyor. */
.tscp-panel[hidden], .tscp-panel [hidden] { display: none !important; }

/* --- tetikleyici kutucuklar --- *
 * Yerel swatch'ın kendi kenarlığı ve iç boşluğu rengi küçültüp donuk
 * gösteriyordu; kutuyu baştan sona renk yapıp kenarlığı biz veriyoruz. */
input[type="color"] {
  -webkit-appearance: none; appearance: none;
  cursor: pointer; transition: box-shadow .16s ease, transform .12s ease;
}
input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; border-radius: inherit; }
input[type="color"]::-webkit-color-swatch { border: none; border-radius: inherit; }
input[type="color"]:focus-visible { outline: 2px solid var(--acc-light, #818cf8); outline-offset: 2px; }
input[type="color"].tscp-open {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bg-card, #1e293b) 90%, transparent),
              0 0 0 4px color-mix(in srgb, var(--acc-light, #818cf8) 90%, transparent);
}
.wb-custom-color input[type="color"]:hover, .settings-theme-custom-swatch-wrap input[type="color"]:hover { transform: scale(1.03); }
`;

  /* --------------------------------- iskelet ------------------------------ */

  const EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';

  let panel = null, els = null, styleTag = null;
  let target = null;          // açık olan <input type="color">
  let startValue = null;      // Esc ile geri dönülecek değer
  let hsv = { h: 0, s: 0, v: 0 };
  let editingField = null;    // kullanıcı yazarken o kutuyu ezmeyelim
  let suppressOpen = false;   // aynı inputa tekrar tıklayınca kapansın, açılmasın
  let closeTimer = 0;

  function ensureStyles() {
    if (styleTag && styleTag.isConnected) return;
    styleTag = document.createElement('style');
    styleTag.id = 'tscp-styles';
    styleTag.textContent = CSS;
    document.head.appendChild(styleTag);
  }

  function build() {
    if (panel && panel.isConnected) return;
    ensureStyles();
    panel = document.createElement('div');
    panel.className = 'tscp-panel';
    panel.setAttribute('role', 'dialog');
    panel.innerHTML = `
      <div class="tscp-sv" tabindex="0" role="application"><i class="tscp-sv-dot"></i></div>
      <div class="tscp-row">
        <button type="button" class="tscp-eye">${EYE_SVG}</button>
        <i class="tscp-preview"></i>
        <div class="tscp-hue" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="359"><i class="tscp-hue-dot"></i></div>
      </div>
      <div class="tscp-fields">
        <label class="tscp-field"><input type="text" data-tscp-field="hex" maxlength="7" spellcheck="false" autocomplete="off"><span>HEX</span></label>
        <label class="tscp-field"><input type="text" data-tscp-field="r" maxlength="3" inputmode="numeric" spellcheck="false" autocomplete="off"><span>R</span></label>
        <label class="tscp-field"><input type="text" data-tscp-field="g" maxlength="3" inputmode="numeric" spellcheck="false" autocomplete="off"><span>G</span></label>
        <label class="tscp-field"><input type="text" data-tscp-field="b" maxlength="3" inputmode="numeric" spellcheck="false" autocomplete="off"><span>B</span></label>
      </div>
      <div class="tscp-swatches" data-tscp-presets></div>
      <div class="tscp-sep" data-tscp-recent-head hidden><b></b></div>
      <div class="tscp-swatches" data-tscp-recents hidden></div>`;
    document.body.appendChild(panel);

    els = {
      sv: panel.querySelector('.tscp-sv'),
      svDot: panel.querySelector('.tscp-sv-dot'),
      hue: panel.querySelector('.tscp-hue'),
      hueDot: panel.querySelector('.tscp-hue-dot'),
      eye: panel.querySelector('.tscp-eye'),
      presets: panel.querySelector('[data-tscp-presets]'),
      recents: panel.querySelector('[data-tscp-recents]'),
      recentHead: panel.querySelector('[data-tscp-recent-head]'),
      fields: {}
    };
    panel.querySelectorAll('[data-tscp-field]').forEach(input => { els.fields[input.dataset.tscpField] = input; });

    PRESETS.forEach(hex => els.presets.appendChild(makeSwatch(hex)));
    wire();
  }

  function makeSwatch(hex) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tscp-swatch';
    b.dataset.tscpSwatch = hex;
    b.style.background = hex;
    b.title = hex.toUpperCase();
    b.setAttribute('aria-label', hex.toUpperCase());
    return b;
  }

  /* -------------------------------- etkileşim ----------------------------- */

  function wire() {
    // Doygunluk/parlaklık alanı — sürükleyerek seçim.
    dragify(els.sv, e => {
      const r = els.sv.getBoundingClientRect();
      setHsv({
        s: clamp((e.clientX - r.left) / r.width, 0, 1),
        v: 1 - clamp((e.clientY - r.top) / r.height, 0, 1)
      });
    });

    dragify(els.hue, e => {
      const r = els.hue.getBoundingClientRect();
      setHsv({ h: clamp((e.clientX - r.left) / r.width, 0, 1) * 359.999 });
    });

    els.sv.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.1 : 0.01;
      if (e.key === 'ArrowLeft') setHsv({ s: clamp(hsv.s - step, 0, 1) });
      else if (e.key === 'ArrowRight') setHsv({ s: clamp(hsv.s + step, 0, 1) });
      else if (e.key === 'ArrowUp') setHsv({ v: clamp(hsv.v + step, 0, 1) });
      else if (e.key === 'ArrowDown') setHsv({ v: clamp(hsv.v - step, 0, 1) });
      else return;
      e.preventDefault();
    });

    els.hue.addEventListener('keydown', e => {
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setHsv({ h: (hsv.h - step + 360) % 360 });
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setHsv({ h: (hsv.h + step) % 360 });
      else return;
      e.preventDefault();
    });

    // Panel açıkken tuşlar uygulamanın global kısayollarına (M/D/C/S/R gibi)
    // düşmesin — yerel diyalog da odağı aldığında aynısını yapıyor. Kendi
    // dinleyicilerimiz çalışsın diye bunu panelin üzerinde, yükselme
    // aşamasında kesiyoruz.
    panel.addEventListener('keydown', e => {
      if (e.key === 'Tab') return;
      if (e.key === 'Enter' && (e.target === els.sv || e.target === els.hue)) {
        e.preventDefault();
        close(true);
      }
      e.stopPropagation();
    });

    // Hazır renk / son kullanılan.
    panel.addEventListener('click', e => {
      const swatch = e.target.closest('[data-tscp-swatch]');
      if (swatch) setHex(swatch.dataset.tscpSwatch);
    });

    // Damlalık (Chromium EyeDropper API'si).
    els.eye.addEventListener('click', async () => {
      if (!window.EyeDropper) return;
      try {
        const picked = await new window.EyeDropper().open();
        const hex = normalizeHex(picked && picked.sRGBHex);
        if (hex) setHex(hex);
      } catch { /* kullanıcı vazgeçti */ }
    });

    // Hex ve R/G/B kutuları.
    Object.entries(els.fields).forEach(([key, input]) => {
      input.addEventListener('focus', () => { editingField = key; input.select(); });
      input.addEventListener('blur', () => { editingField = null; paint(); });

      input.addEventListener('input', () => {
        if (key === 'hex') {
          const hex = normalizeHex(input.value);
          if (hex) setHex(hex, { skipField: 'hex' });
          return;
        }
        const digits = input.value.replace(/[^0-9]/g, '').slice(0, 3);
        if (digits !== input.value) input.value = digits;
        if (!digits) return;
        const rgb = hexToRgb(currentHex());
        rgb[key] = clamp(parseInt(digits, 10), 0, 255);
        setHex(rgbToHex(rgb), { skipField: key });
      });

      input.addEventListener('keydown', e => {
        if (key !== 'hex' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          const step = e.shiftKey ? 10 : 1;
          const rgb = hexToRgb(currentHex());
          rgb[key] = clamp(rgb[key] + (e.key === 'ArrowUp' ? step : -step), 0, 255);
          setHex(rgbToHex(rgb), { skipField: null });
          input.select();
          e.preventDefault();
          return;
        }
        if (e.key === 'Enter') { e.preventDefault(); close(true); }
      });
    });
  }

  // Pointer sürüklemesini tek yerde topla: yakala + taşı + bırak.
  function dragify(el, onMove) {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      el.focus({ preventScroll: true });
      onMove(e);
      e.preventDefault();
      const move = ev => onMove(ev);
      const up = ev => {
        el.releasePointerCapture?.(ev.pointerId);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  /* ----------------------------- durum & boyama --------------------------- */

  const currentHex = () => rgbToHex(hsvToRgb(hsv));

  function setHsv(patch, opts) {
    hsv = { ...hsv, ...patch };
    commitValue(currentHex(), opts);
  }

  function setHex(hex, opts) {
    const value = normalizeHex(hex);
    if (!value) return;
    const next = rgbToHsv(hexToRgb(value));
    // Gri tonlarda ton bilgisi kaybolur; şeridin başa zıplamaması için koru.
    hsv = { h: next.s === 0 ? hsv.h : next.h, s: next.s, v: next.v };
    commitValue(value, opts);
  }

  function commitValue(hex, opts = {}) {
    paint(opts.skipField === undefined ? editingField : opts.skipField);
    if (!target || target.value === hex) return;
    target.value = hex;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function paint(skipField) {
    if (!panel) return;
    const hex = currentHex();
    const rgb = hexToRgb(hex);
    panel.style.setProperty('--tscp-hue', String(Math.round(hsv.h)));
    panel.style.setProperty('--tscp-color', hex);
    els.svDot.style.left = (hsv.s * 100) + '%';
    els.svDot.style.top = ((1 - hsv.v) * 100) + '%';
    els.svDot.style.borderColor = isLight(rgb) ? 'rgba(15,23,42,.85)' : '#fff';
    els.hueDot.style.left = (hsv.h / 360 * 100) + '%';
    els.hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    els.sv.setAttribute('aria-label', hex.toUpperCase());

    if (skipField !== 'hex') els.fields.hex.value = hex.toUpperCase();
    ['r', 'g', 'b'].forEach(k => { if (skipField !== k) els.fields[k].value = String(rgb[k]); });

    panel.querySelectorAll('[data-tscp-swatch]').forEach(sw => {
      sw.classList.toggle('tscp-active', sw.dataset.tscpSwatch === hex);
    });
  }

  function renderRecents() {
    const list = loadRecents();
    els.recents.innerHTML = '';
    els.recentHead.hidden = els.recents.hidden = list.length === 0;
    els.recentHead.querySelector('b').textContent = t('recent');
    list.forEach(hex => els.recents.appendChild(makeSwatch(hex)));
  }

  /* ------------------------------ konumlandırma --------------------------- */

  function place() {
    if (!panel || !target) return;
    const r = target.getBoundingClientRect();
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const gap = 10, edge = 10;

    const left = clamp(r.left, edge, Math.max(edge, window.innerWidth - w - edge));
    let top = r.bottom + gap;
    let origin = 'top left';
    if (top + h > window.innerHeight - edge) {
      const above = r.top - gap - h;
      if (above >= edge) { top = above; origin = 'bottom left'; }
      else top = Math.max(edge, window.innerHeight - h - edge);
    }
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
    panel.style.setProperty('--tscp-origin', origin);
  }

  /* -------------------------------- aç / kapa ----------------------------- */

  function open(input) {
    if (target === input) return;
    if (target) close(true);
    clearTimeout(closeTimer);
    build();
    target = input;
    startValue = normalizeHex(input.value) || '#000000';
    panel.classList.remove('tscp-closing');
    panel.setAttribute('aria-label', t('title'));
    panel.hidden = false;
    els.eye.hidden = !window.EyeDropper;
    els.eye.title = t('eyedropper');
    els.eye.setAttribute('aria-label', t('eyedropper'));
    renderRecents();
    hsv = rgbToHsv(hexToRgb(startValue));
    paint();
    place();
    input.classList.add('tscp-open');
    input.setAttribute('aria-expanded', 'true');
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    els.sv.focus({ preventScroll: true });
  }

  function close(commit) {
    if (!target) return;
    const input = target;
    const finalValue = commit ? (normalizeHex(input.value) || startValue) : startValue;
    target = null;

    if (!commit && input.value !== startValue) {
      input.value = startValue;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (commit && finalValue !== startValue) {
      pushRecent(finalValue);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    input.classList.remove('tscp-open');
    input.removeAttribute('aria-expanded');
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);

    panel.classList.add('tscp-closing');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!target && panel) { panel.hidden = true; panel.classList.remove('tscp-closing'); }
    }, 110);
  }

  /* ------------------------- yerel diyaloğun iptali ----------------------- */

  const pickerInput = node => (node instanceof Element ? node.closest('input[type="color"]') : null);

  const eligible = input => !!input && !input.disabled && !input.readOnly && input.dataset.nativeColor !== 'true';

  document.addEventListener('pointerdown', e => {
    if (panel && !panel.hidden && panel.contains(e.target)) return;
    const hit = pickerInput(e.target);
    if (target) {
      const reclick = hit === target;
      close(true);
      suppressOpen = reclick;          // aynı kutuya basınca sadece kapansın
      if (reclick) return;
    }
    if (eligible(hit)) e.preventDefault();   // metin imleci / odak sıçraması olmasın
  }, true);

  // Yerel Windows diyaloğu 'click' ile açılır; capture aşamasında kesiyoruz.
  document.addEventListener('click', e => {
    const hit = pickerInput(e.target);
    if (!eligible(hit)) return;
    e.preventDefault();
    if (suppressOpen) { suppressOpen = false; return; }
    open(hit);
  }, true);

  document.addEventListener('keydown', e => {
    if (target && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();             // ayarlar/tahta paneli de kapanmasın
      close(false);
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const active = document.activeElement;
    if (!eligible(active) || active.type !== 'color') return;
    e.preventDefault();
    open(active);
  }, true);

  window.addEventListener('blur', () => { if (target) close(true); });

  window.__tsColorPicker = {
    open,
    close,
    /** Dışarıdan da açılabilsin: window.__tsColorPicker.attach(inputEl) */
    attach(input) { if (eligible(input)) open(input); }
  };
})();
