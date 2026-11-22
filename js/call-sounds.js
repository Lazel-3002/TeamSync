// Arama sesleri (TSCallSounds): Ayarlar > Ses > "Arama sesleri".
//
// Gelen arama ('ring') ve giden arama / çalma sesi ('ringback') için ayrı seçim:
// Normal (eski ses) + Yumuşak / Klasik zil / Dijital (hepsi Web Audio ile
// üretilir, ses dosyası yok) + "Kendi sesim" (+ gelen için "Sessiz").
// renderer.js'teki startRingLoop / stopRingLoop buraya devreder; tüm zil
// çağrı noktaları (birebir arama, grup kartı, "Herkesi ara") aynı yoldan geçer.
//
// Kendi ses dosyası YALNIZCA bu cihazda, IndexedDB 'ts-call-sounds' içinde
// saklanır (cihaz başına; hoparlör/mikrofon seçimi gibi bir cihaz tercihi).
// Hiçbir yere yüklenmez, kimseye gönderilmez, mesaj yedeğine girmez.
(function () {
  const IN = 'in', OUT = 'out';
  const KEY = { in: 'teamsync_call_sound_in', out: 'teamsync_call_sound_out', vol: 'teamsync_call_sound_vol' };
  const DB_NAME = 'ts-call-sounds';
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_SECONDS = 30;
  const PREVIEW_MS = 5000;
  const BUILTIN = ['normal', 'soft', 'classic', 'digital'];
  const EXT_OK = /\.(mp3|ogg|oga|opus|wav|m4a|aac|mp4|webm|weba)$/i;

  const tr = (k, v) => (window.TSUI ? window.TSUI.tr(k, v) : (typeof window.t === 'function' ? window.t(k, v) : k));
  const esc = v => (window.TSUI ? window.TSUI.esc(v) : String(v == null ? '' : v));
  const ico = (n, s = 16) => (window.TSUI && window.TSUI.icon ? window.TSUI.icon(n, s) : '');
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  // ---------- ayarlar ----------
  function choice(slot) {
    const v = lsGet(KEY[slot]) || 'normal';
    if (BUILTIN.includes(v) || v === 'custom' || (slot === IN && v === 'silent')) return v;
    return 'normal';
  }
  function volume() {
    const n = Number(lsGet(KEY.vol));
    return lsGet(KEY.vol) == null || !Number.isFinite(n) ? 80 : Math.max(0, Math.min(100, Math.round(n)));
  }

  // ---------- yerel depo (IndexedDB) ----------
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  }
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const meta = { in: null, out: null };      // { name, size, duration, type }
  const buffers = { in: null, out: null };   // çözülmüş AudioBuffer önbelleği
  let metaLoaded = null;
  function loadMeta() {
    if (!metaLoaded) {
      metaLoaded = Promise.all([IN, OUT].map(slot => idb('readonly', s => s.get(slot)).then(rec => {
        meta[slot] = rec && rec.bytes ? { name: rec.name, size: rec.size, duration: rec.duration, type: rec.type } : null;
      }).catch(() => { meta[slot] = null; }))).then(() => { renderSoon(); });
    }
    return metaLoaded;
  }

  async function decode(bytes) {
    // Ses cihazı tutmayan bir bağlamda çözülür; çalarken ringCtx'e verilir.
    const off = new OfflineAudioContext(1, 1, 44100);
    return off.decodeAudioData(bytes.slice(0));
  }
  let warnedFallback = false;
  async function customBuffer(slot) {
    if (buffers[slot]) return buffers[slot];
    const rec = await idb('readonly', s => s.get(slot));
    if (!rec || !rec.bytes) throw new Error('missing');
    buffers[slot] = await decode(rec.bytes);
    return buffers[slot];
  }

  // ---------- dosya doğrulama ----------
  function sniff(b) {
    const s = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
    if (b.length < 12) return null;
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'wav';
    if (s(0, 4) === 'OggS') return 'ogg';
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'webm';
    if (s(4, 4) === 'ftyp') return 'm4a';
    if (s(0, 3) === 'ID3') return 'mp3';
    if (b[0] === 0xFF && (b[1] & 0xF6) === 0xF0) return 'aac';   // ADTS
    if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return 'mp3';   // MPEG çerçeve senkronu
    return null;
  }
  function mb(n) {
    return (n / 1048576).toLocaleString(document.documentElement.lang || undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  }
  // Başarılıysa { name, size, duration, type, bytes } döner, değilse { error }.
  async function validate(file) {
    if (!file) return { error: tr('callSounds.errType') };
    if (file.size > MAX_BYTES) return { error: tr('callSounds.errSize', { size: mb(file.size) }) };
    const bytes = await file.arrayBuffer();
    const type = sniff(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16)));
    if (!type || !EXT_OK.test(file.name || '')) return { error: tr('callSounds.errType') };
    let buf;
    try { buf = await decode(bytes); } catch (e) { return { error: tr('callSounds.errDecode') }; }
    if (!buf || !buf.duration) return { error: tr('callSounds.errDecode') };
    if (buf.duration > MAX_SECONDS + 0.05) return { error: tr('callSounds.errLong') };
    return { name: String(file.name).slice(0, 120), size: file.size, duration: buf.duration, type, bytes, buf };
  }
  async function storeCustom(slot, file) {
    const v = await validate(file);
    if (v.error) return v;
    await idb('readwrite', s => s.put({ name: v.name, size: v.size, duration: v.duration, type: v.type, bytes: v.bytes, savedAt: Date.now() }, slot));
    meta[slot] = { name: v.name, size: v.size, duration: v.duration, type: v.type };
    buffers[slot] = v.buf;
    lsSet(KEY[slot], 'custom');
    return { ok: true };
  }
  async function removeCustom(slot) {
    if (session && session.slot === slot && session.sound === 'custom') stop();
    await idb('readwrite', s => s.delete(slot)).catch(() => {});
    meta[slot] = null;
    buffers[slot] = null;
    if (choice(slot) === 'custom') lsSet(KEY[slot], 'normal');
  }

  // ---------- çalma motoru ----------
  let ctx = null;
  let sinkApplied = null;
  function audioCtx() {
    if (!ctx || ctx.state === 'closed') { ctx = new (window.AudioContext || window.webkitAudioContext)(); sinkApplied = null; }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Arama sesi de odadaki sesler gibi Ayarlar'da seçilen hoparlörden çıkar.
    let id = '';
    try { id = typeof window.getActiveSpeakerDeviceId === 'function' ? (window.getActiveSpeakerDeviceId() || '') : ''; } catch (e) {}
    if (typeof ctx.setSinkId === 'function' && sinkApplied !== id) {
      sinkApplied = id;
      ctx.setSinkId(id).catch(() => { sinkApplied = ''; ctx.setSinkId('').catch(() => {}); });
    }
    return ctx;
  }

  // Tek nota: yumuşak atak + üstel sönüm. opt.filter = alçak geçiren kesim (Hz).
  function note(ac, dest, f, t, dur, opt = {}) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    const peak = opt.peak == null ? 0.5 : opt.peak;
    const atk = opt.attack || 0.02;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let out = g;
    if (opt.filter) {
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opt.filter;
      g.connect(lp);
      out = lp;
    }
    osc.connect(g);
    out.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  // Klasik zil: iki metal tını 25 ms aralıkla titreşir (eski telefon çanı).
  function bellBurst(ac, dest, t, len) {
    for (let x = 0; x < len; x += 0.05) {
      note(ac, dest, 1180, t + x, 0.045, { peak: 0.22, attack: 0.004, type: 'triangle' });
      note(ac, dest, 1480, t + x + 0.025, 0.045, { peak: 0.16, attack: 0.004, type: 'triangle' });
    }
  }
  // Her ses: { ring: [periyot ms, çal(ac, dest, t)], ringback: [...] }
  const TONES = {
    normal: {
      ring: [2200, (ac, d, t) => [0, 0.25, 0.5, 0.75].forEach((x, i) => note(ac, d, i % 2 ? 659 : 784, t + x, 0.2))],
      ringback: [3000, (ac, d, t) => { note(ac, d, 440, t, 0.9); note(ac, d, 480, t, 0.9); }]
    },
    soft: {
      // Do-Mi-Sol yükselen marimba benzeri üçlü, uzun ve yumuşak sönüm.
      ring: [2600, (ac, d, t) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        note(ac, d, f, t + i * 0.18, 0.9, { type: 'triangle', peak: 0.32, attack: 0.03, filter: 2400 });
        note(ac, d, f * 2, t + i * 0.18, 0.35, { peak: 0.05, attack: 0.03 });
      })],
      ringback: [3000, (ac, d, t) => { note(ac, d, 659.25, t, 0.8, { type: 'triangle', peak: 0.3, attack: 0.04, filter: 2000 }); note(ac, d, 523.25, t + 0.35, 1.0, { type: 'triangle', peak: 0.3, attack: 0.04, filter: 2000 }); }]
    },
    classic: {
      // "Zırrr zırrr": iki kısa çan patlaması.
      ring: [3000, (ac, d, t) => { bellBurst(ac, d, t, 0.4); bellBurst(ac, d, t + 0.6, 0.4); }],
      // Avrupa çalma sesi: 425 Hz, 1 sn.
      ringback: [3000, (ac, d, t) => note(ac, d, 425, t, 1.0, { peak: 0.45, attack: 0.03 })]
    },
    digital: {
      // Kare dalga, alçak geçirenle yumuşatılmış hızlı üçlü bip, iki kez.
      ring: [2000, (ac, d, t) => [0, 0.12, 0.24, 0.6, 0.72, 0.84].forEach(x => note(ac, d, 1318.5, t + x, 0.09, { type: 'square', peak: 0.16, attack: 0.005, filter: 3200 }))],
      ringback: [2500, (ac, d, t) => [0, 0.2].forEach(x => note(ac, d, 880, t + x, 0.12, { type: 'square', peak: 0.14, attack: 0.005, filter: 2600 }))]
    }
  };

  let session = null; // { id, slot, kind, sound, master, timer, stopTimer, src, preview, fallback }
  let seq = 0;
  const listeners = new Set();
  function changed() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

  function stop() {
    const s = session;
    if (!s) return;
    session = null;
    clearInterval(s.timer);
    clearTimeout(s.stopTimer);
    try { if (s.src) s.src.stop(); } catch (e) {}
    try { s.master.gain.cancelScheduledValues(0); s.master.gain.value = 0; s.master.disconnect(); } catch (e) {}
    changed();
  }

  function startTone(s, name) {
    const [period, play] = TONES[name][s.kind];
    s.sound = name;
    const once = () => { try { play(s.ac, s.master, s.ac.currentTime + 0.02); } catch (e) { console.error('Ring error:', e); stop(); } };
    once();
    s.timer = setInterval(() => { if (session === s) once(); }, period);
  }

  // kind: 'ring' (gelen) | 'ringback' (giden). maxMs sonra kendiliğinden susar.
  function start(kind, maxMs = 30000, opts = {}) {
    stop();
    const slot = kind === 'ringback' ? OUT : IN;
    const sel = opts.sound || choice(slot);
    const s = { id: ++seq, slot, kind: kind === 'ringback' ? 'ringback' : 'ring', sound: sel, preview: !!opts.preview, startedAt: Date.now() };
    session = s;
    s.stopTimer = setTimeout(() => { if (session === s) stop(); }, maxMs);
    if (sel === 'silent') { changed(); return; }
    let ac;
    try { ac = audioCtx(); } catch (e) { console.error('Ring error:', e); session = null; clearTimeout(s.stopTimer); return; }
    s.ac = ac;
    s.master = ac.createGain();
    s.master.gain.value = volume() / 100;
    s.master.connect(ac.destination);
    if (sel !== 'custom') { startTone(s, sel); changed(); return; }
    // Kendi sesim: önbellekteyse anında, değilse IndexedDB'den çözülüp başlar.
    s.sound = 'custom';
    const go = buf => {
      if (session !== s) return;
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(s.master);
      src.start(ac.currentTime + 0.01);
      s.src = src;
      s.bufferDuration = buf.duration;
      changed();
    };
    const fail = e => {
      if (session !== s) return;
      if (!warnedFallback) { warnedFallback = true; console.warn('[call-sounds] kendi arama sesi okunamadı, Normal sese dönüldü:', e && e.message ? e.message : e); }
      s.fallback = true;
      startTone(s, 'normal');
      changed();
    };
    if (buffers[slot]) go(buffers[slot]);
    else customBuffer(slot).then(go, fail);
    changed();
  }

  function setVolume(v) {
    lsSet(KEY.vol, String(Math.max(0, Math.min(100, Math.round(Number(v) || 0)))));
    if (session && session.master) session.master.gain.value = volume() / 100;
  }

  // ---------- Ayarlar arayüzü ----------
  const host = () => document.getElementById('settings-call-sounds');
  const msgs = { in: '', out: '' };
  const uploads = { in: 0, out: 0 };
  let renderTimer = null;
  function renderSoon() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 0); }

  function fmtDur(sec) {
    const s = Math.max(1, Math.round(sec || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function options(slot) {
    const list = [['normal', 'callSounds.normal'], ['soft', 'callSounds.soft'], ['classic', 'callSounds.classic'], ['digital', 'callSounds.digital'], ['custom', 'callSounds.custom']];
    if (slot === IN) list.push(['silent', 'callSounds.silent']);
    const cur = choice(slot);
    return list.map(([v, k]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(tr(k))}</option>`).join('');
  }
  function rowHtml(slot) {
    const cur = choice(slot);
    const m = meta[slot];
    const playing = session && session.preview && session.slot === slot;
    const file = m
      ? `<span class="cs-file-name" title="${esc(m.name)}">${esc(m.name)}</span><span class="cs-file-info">${esc(fmtDur(m.duration))} · ${esc(m.size >= 1048576 ? mb(m.size) + ' MB' : Math.max(1, Math.round(m.size / 1024)) + ' KB')}</span>`
      : `<span class="cs-file-name is-empty">${esc(tr('callSounds.noFile'))}</span>`;
    return `
      <div class="cs-row" data-cs-slot="${slot}">
        <div class="cs-row-main">
          <div class="cs-row-copy">
            <label for="cs-select-${slot}"><strong>${esc(tr(slot === IN ? 'callSounds.incoming' : 'callSounds.outgoing'))}</strong></label>
            <p>${esc(tr(slot === IN ? 'callSounds.incomingDesc' : 'callSounds.outgoingDesc'))}</p>
          </div>
          <div class="cs-controls">
            <select id="cs-select-${slot}" class="settings-select cs-select" data-cs="select">${options(slot)}</select>
            <button type="button" class="settings-test-button cs-play${playing ? ' is-playing' : ''}" data-cs="play" aria-pressed="${playing ? 'true' : 'false'}"${cur === 'silent' ? ' disabled' : ''}>${ico(playing ? 'stop' : 'play', 14)}<span>${esc(tr(playing ? 'callSounds.stop' : 'callSounds.listen'))}</span></button>
          </div>
        </div>
        <div class="cs-file${cur === 'custom' ? '' : ' hidden'}">
          <span class="cs-file-ico">${ico('music', 16)}</span>
          <span class="cs-file-copy">${file}</span>
          <span class="cs-file-actions">
            <button type="button" class="settings-test-button cs-pick" data-cs="pick">${ico('upload', 14)}<span>${esc(tr('callSounds.pick'))}</span></button>
            ${m ? `<button type="button" class="cs-remove" data-cs="remove">${ico('trash', 14)}<span>${esc(tr('callSounds.remove'))}</span></button>` : ''}
          </span>
          <input type="file" class="cs-input hidden" data-cs="input" accept=".mp3,.ogg,.oga,.opus,.wav,.m4a,.aac,.mp4,.webm,.weba,audio/*" tabindex="-1" aria-hidden="true">
        </div>
        <p class="cs-msg${msgs[slot] ? '' : ' hidden'}" role="alert">${esc(msgs[slot])}</p>
      </div>`;
  }
  function render() {
    const el = host();
    if (!el) return;
    const v = volume();
    el.innerHTML = `
      <h3 class="settings-section-title">${esc(tr('callSounds.title'))}</h3>
      <p class="settings-help cs-lead">${esc(tr('callSounds.lead'))}</p>
      ${rowHtml(IN)}
      ${rowHtml(OUT)}
      <div class="cs-vol">
        <div class="settings-range-heading">
          <label for="cs-volume">${esc(tr('callSounds.volume'))}</label>
          <output id="cs-volume-value">${v}%</output>
        </div>
        <input id="cs-volume" class="settings-range" type="range" min="0" max="100" value="${v}" style="--range-progress:${v}%">
      </div>`;
  }
  // Önizleme düğmesinin görünümü (tam yeniden çizim seçimi / odak kaybetmesin diye).
  function syncPlayButtons() {
    const el = host();
    if (!el) return;
    el.querySelectorAll('.cs-row').forEach(row => {
      const slot = row.dataset.csSlot;
      const b = row.querySelector('[data-cs="play"]');
      if (!b) return;
      const playing = !!(session && session.preview && session.slot === slot);
      if (b.classList.contains('is-playing') === playing) return;
      b.classList.toggle('is-playing', playing);
      b.setAttribute('aria-pressed', playing ? 'true' : 'false');
      b.innerHTML = `${ico(playing ? 'stop' : 'play', 14)}<span>${esc(tr(playing ? 'callSounds.stop' : 'callSounds.listen'))}</span>`;
    });
  }
  listeners.add(syncPlayButtons);

  function setMsg(slot, text) {
    msgs[slot] = text || '';
    const p = host() && host().querySelector(`.cs-row[data-cs-slot="${slot}"] .cs-msg`);
    if (p) { p.textContent = msgs[slot]; p.classList.toggle('hidden', !msgs[slot]); }
  }
  function preview(slot) {
    if (session && session.preview && session.slot === slot) { stop(); return; }
    start(slot === OUT ? 'ringback' : 'ring', PREVIEW_MS, { preview: true });
  }

  function bind() {
    const el = host();
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('change', async e => {
      const row = e.target.closest('.cs-row');
      if (e.target.id === 'cs-volume') return;
      if (!row) return;
      const slot = row.dataset.csSlot;
      if (e.target.dataset.cs === 'select') {
        lsSet(KEY[slot], e.target.value);
        setMsg(slot, '');
        if (session && session.preview) stop();
        render();
      } else if (e.target.dataset.cs === 'input') {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        row.classList.add('is-busy');
        const tok = ++uploads[slot];
        let res;
        try { res = await storeCustom(slot, file); } catch (err) { res = { error: tr('callSounds.errSave') }; }
        row.classList.remove('is-busy');
        // Arka arkaya seçilen dosyalarda yalnızca sonuncunun mesajı görünür.
        if (tok === uploads[slot]) msgs[slot] = res.error || '';
        render();
      }
    });
    el.addEventListener('input', e => {
      if (e.target.id !== 'cs-volume') return;
      setVolume(e.target.value);
      e.target.style.setProperty('--range-progress', e.target.value + '%');
      const out = document.getElementById('cs-volume-value');
      if (out) out.textContent = e.target.value + '%';
    });
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-cs]');
      const row = e.target.closest('.cs-row');
      if (!b || !row) return;
      const slot = row.dataset.csSlot;
      if (b.dataset.cs === 'play') preview(slot);
      else if (b.dataset.cs === 'pick') row.querySelector('[data-cs="input"]').click();
      else if (b.dataset.cs === 'remove') { msgs[slot] = ''; await removeCustom(slot); render(); }
    });
  }

  function init() {
    render();
    bind();
    loadMeta();
    // Ayarlar kapanınca önizleme susar.
    const modal = document.getElementById('settings-modal');
    if (modal) {
      new MutationObserver(() => {
        if (session && session.preview && modal.classList.contains('hidden')) stop();
      }).observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.TSCallSounds = { start, stop, render, choice, volume, setVolume, validate, sniff, _store: storeCustom, _remove: removeCustom };
  // Testler ve hata ayıklama için: şu an ne çalıyor (yalnızca okuma, içerik yok).
  window.__tsRingDebug = () => session ? {
    playing: true, kind: session.kind, slot: session.slot, sound: session.sound, preview: session.preview,
    fallback: !!session.fallback, buffer: !!session.src, bufferDuration: session.bufferDuration || 0,
    gain: session.master ? session.master.gain.value : 0
  } : { playing: false };
})();
