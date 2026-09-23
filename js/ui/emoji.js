// Emoji: ":thumbsup:" → 👍 dönüşümü, ":" + 2 harften sonra açılan otomatik
// tamamlama, yalnızca emojiden oluşan mesajlar için büyük gösterim ve tepki /
// emoji seçicisi. Veri: resources/emoji/shortcodes.js (emojibase, MIT).
(function () {
  const data = window.TeamSyncEmoji || { codes: {}, popular: [] };
  const codes = data.codes || {};
  const names = Object.keys(codes);
  const popularRank = new Map((data.popular || []).map((n, i) => [n, i]));
  const TOKEN_RE = /(^|[\s(])(:([a-z0-9_+\-]{2,40}))$/i;
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '💀', '👀'];

  const esc = v => (window.TSUI ? window.TSUI.esc(v) : String(v));
  const tr = (k, v) => (window.TSUI ? window.TSUI.tr(k, v) : k);

  function replaceShortcodes(text) {
    if (typeof text !== 'string' || text.indexOf(':') === -1) return text;
    return text.replace(/:([a-z0-9_+\-]{1,40}):/gi, (m, name) => codes[name.toLowerCase()] || m);
  }

  // Yalnızca emoji (en fazla 27 grafem) → büyük gösterim (Discord "jumbo")
  const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Modifier}|‍|️|\s)+$/u;
  function isJumbo(text) {
    if (typeof text !== 'string') return false;
    const t = text.trim();
    if (!t || t.length > 120 || /\d/.test(t.replace(/[#*0-9]️?⃣/g, ''))) return false;
    if (!EMOJI_ONLY_RE.test(t)) return false;
    const count = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)).filter(s => s.segment.trim()).length;
    return count > 0 && count <= 27;
  }

  function search(query, limit = 8) {
    const q = String(query || '').toLowerCase();
    if (q.length < 2) return [];
    const prefix = [];
    const contains = [];
    for (const n of names) {
      const i = n.indexOf(q);
      if (i === 0) prefix.push(n);
      else if (i > 0) contains.push(n);
      if (prefix.length > 200) break;
    }
    const rank = n => (popularRank.has(n) ? popularRank.get(n) : 1000) + n.length / 100;
    prefix.sort((a, b) => rank(a) - rank(b));
    contains.sort((a, b) => rank(a) - rank(b));
    const seen = new Set();
    const out = [];
    for (const n of prefix.concat(contains)) {
      const e = codes[n];
      if (seen.has(e)) continue;
      seen.add(e);
      out.push({ name: n, emoji: e });
      if (out.length >= limit) break;
    }
    return out;
  }

  // ---------- Otomatik tamamlama ----------
  let popup = null; // { el, input, items, sel, start }

  function closePopup() {
    if (popup) { popup.el.remove(); popup = null; }
  }

  function tokenAtCaret(input) {
    const pos = input.selectionStart;
    if (pos == null || pos !== input.selectionEnd) return null;
    const before = input.value.slice(0, pos);
    const m = before.match(TOKEN_RE);
    if (!m) return null;
    return { query: m[3], start: pos - m[2].length, end: pos };
  }

  function renderPopup(input, token) {
    const items = search(token.query, 8);
    if (!items.length) { closePopup(); return; }
    if (!popup || popup.input !== input) {
      closePopup();
      const el = document.createElement('div');
      el.className = 'emoji-ac';
      el.setAttribute('data-i18n-ignore', '');
      document.body.appendChild(el);
      popup = { el, input, items: [], sel: 0, start: 0 };
      el.addEventListener('mousedown', e => {
        const row = e.target.closest('[data-i]');
        if (!row) return;
        e.preventDefault();
        popup.sel = Number(row.dataset.i);
        choose();
      });
    }
    popup.items = items;
    popup.start = token.start;
    popup.sel = Math.min(popup.sel, items.length - 1);
    popup.el.innerHTML = `<div class="emoji-ac-head">${esc(tr('emoji.matching', { q: token.query }))}</div>` + items.map((it, i) =>
      `<div class="emoji-ac-row ${i === popup.sel ? 'sel' : ''}" data-i="${i}"><span class="emoji-ac-e">${it.emoji}</span><span>:${esc(it.name)}:</span></div>`).join('');
    const r = input.getBoundingClientRect();
    popup.el.style.left = `${Math.round(r.left)}px`;
    popup.el.style.width = `${Math.round(Math.min(Math.max(r.width, 240), 420))}px`;
    popup.el.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
  }

  function choose() {
    if (!popup) return;
    const it = popup.items[popup.sel];
    const input = popup.input;
    if (!it) { closePopup(); return; }
    const pos = input.selectionStart;
    input.value = input.value.slice(0, popup.start) + it.emoji + ' ' + input.value.slice(pos);
    const caret = popup.start + it.emoji.length + 1;
    input.setSelectionRange(caret, caret);
    closePopup();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  const attached = new WeakSet();
  function attach(input) {
    if (!input || attached.has(input)) return;
    attached.add(input);
    input.addEventListener('input', () => {
      const token = tokenAtCaret(input);
      if (token) renderPopup(input, token); else if (popup && popup.input === input) closePopup();
    });
    input.addEventListener('blur', () => setTimeout(() => { if (popup && popup.input === input) closePopup(); }, 120));
    input.addEventListener('click', () => { if (popup && popup.input === input && !tokenAtCaret(input)) closePopup(); });
  }

  // Yakalama aşamasında: açık açılır listede Enter/Tab/oklar gönderme yerine
  // seçim yapar; gönderimden hemen önce kısa kodlar emojiye çevrilir.
  document.addEventListener('keydown', e => {
    const input = e.target;
    if (popup && input === popup.input) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopImmediatePropagation();
        const n = popup.items.length;
        popup.sel = (popup.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        renderPopup(input, { query: (tokenAtCaret(input) || {}).query || '', start: popup.start });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); choose(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closePopup(); return; }
    }
    if (e.key === 'Enter' && input && attached.has(input) && !e.isComposing) {
      const next = replaceShortcodes(input.value);
      if (next !== input.value) input.value = next;
    }
  }, true);
  // Gönder düğmesine tıklanınca da dönüştür (düğmenin kendi işleyicisinden önce).
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('[data-emoji-send-for]');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.emojiSendFor);
    if (input) input.value = replaceShortcodes(input.value);
  }, true);
  document.addEventListener('submit', e => {
    const input = e.target.querySelector && e.target.querySelector('input[type="text"], input:not([type])');
    if (input && attached.has(input)) input.value = replaceShortcodes(input.value);
  }, true);

  // ---------- Emoji seçici (tepkiler + giriş alanındaki düğme) ----------
  function openPicker(anchor, onPick, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'emoji-picker';
    const grid = list => list.map(it => `<button type="button" class="ep-e" data-e="${esc(it.emoji)}" title=":${esc(it.name)}:">${it.emoji}</button>`).join('');
    const popularItems = (data.popular || []).map(n => ({ name: n, emoji: codes[n] })).filter(x => x.emoji);
    wrap.innerHTML = `
      <div class="ep-quick">${QUICK_REACTIONS.map(e => `<button type="button" class="ep-e ep-quick-e" data-e="${e}">${e}</button>`).join('')}</div>
      <input type="text" class="ep-search" placeholder="${esc(tr('emoji.search'))}" />
      <div class="ep-grid">${grid(popularItems)}</div>`;
    const pop = window.TSUI.popover(wrap, anchor, { cls: 'emoji-picker-pop', placement: opts.placement || 'top' });
    const input = wrap.querySelector('.ep-search');
    const gridEl = wrap.querySelector('.ep-grid');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      gridEl.innerHTML = q.length >= 2 ? grid(search(q, 64)) : grid(popularItems);
      pop.reposition();
    });
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-e]');
      if (!b) return;
      pop.close();
      onPick(b.dataset.e);
    });
    setTimeout(() => input.focus(), 30);
    return pop;
  }

  document.addEventListener('DOMContentLoaded', () => {
    ['dm-input', 'cinput'].forEach(id => attach(document.getElementById(id)));
    const dmSend = document.getElementById('dm-btn-send');
    if (dmSend) dmSend.dataset.emojiSendFor = 'dm-input';
  });

  window.TSEmoji = { replaceShortcodes, isJumbo, search, attach, openPicker, QUICK_REACTIONS, _codes: codes };
})();
