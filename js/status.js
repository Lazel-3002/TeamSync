// Durum sistemi: Aktif / Boşta / Rahatsız Etmeyin / Görünmez (+ süreler),
// özel durum mesajı, otomatik boşta ve arkadaşların presence'ından gelen
// zengin alanlar (durum, özel durum, oynanan oyun, profil sürümü).
//
// Presence paketine eklenen alanlar (hepsi opsiyonel; eski istemciler yok sayar):
//   v:2, st:'online'|'idle'|'dnd', cs:{t,e}, act:{k:'play',n,el,sid}, pr:<rev>
// Görünmez: presence HİÇ yayınlanmaz (arkadaşlar 15 sn içinde çevrimdışı görür),
// geçişte üç kez {online:false} gönderilir (QoS 0 kaybolabilir).
(function () {
  const STATUS_KEY = fid => `teamsync_status_${fid}`;
  const IDLE_KEY = 'teamsync_auto_idle_minutes';
  const DURATIONS = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '8h': 8 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    forever: null
  };
  const CUSTOM_CLEAR = {
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    today: 'today',
    never: null
  };
  const VALID = ['online', 'idle', 'dnd', 'invisible'];

  window.state.presence = { status: 'online', until: null, custom: null, autoIdle: false };
  window.state.presenceOf = window.state.presenceOf || {};
  window.state.roomPresenceOf = window.state.roomPresenceOf || {};
  let loadedFor = null;

  const emit = () => document.dispatchEvent(new CustomEvent('ts:status'));

  function load() {
    const fid = window.state.friendId;
    if (!fid) return;
    loadedFor = fid;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STATUS_KEY(fid)) || 'null'); } catch (e) {}
    const p = window.state.presence;
    p.status = saved && VALID.includes(saved.status) ? saved.status : 'online';
    p.until = saved && Number.isFinite(saved.until) ? saved.until : null;
    p.custom = saved && saved.custom && typeof saved.custom === 'object' ? sanitizeCustom(saved.custom, true) : null;
    p.autoIdle = false;
  }

  function save() {
    const fid = window.state.friendId;
    if (!fid) return;
    const p = window.state.presence;
    try {
      localStorage.setItem(STATUS_KEY(fid), JSON.stringify({ status: p.status, until: p.until, custom: p.custom }));
    } catch (e) {}
  }

  function ensureLoaded() {
    if (window.state.friendId && loadedFor !== window.state.friendId) load();
  }

  // Süresi dolan durum/özel durumu temizler. Değişiklik olduysa true.
  function expire() {
    const p = window.state.presence;
    const now = Date.now();
    let changed = false;
    if (p.until && now >= p.until) { p.status = 'online'; p.until = null; changed = true; }
    if (p.custom && p.custom.until && now >= p.custom.until) { p.custom = null; changed = true; }
    if (changed) save();
    return changed;
  }

  function rawStatus() {
    ensureLoaded();
    expire();
    return window.state.presence.status;
  }

  function effective() {
    const status = rawStatus();
    if (status === 'online' && window.state.presence.autoIdle) return 'idle';
    return status;
  }

  const isDnd = () => effective() === 'dnd';
  const isInvisible = () => effective() === 'invisible';

  function sanitizeCustom(raw, keepUntil) {
    if (!raw || typeof raw !== 'object') return null;
    const text = typeof raw.t === 'string' ? raw.t.replace(/[\r\n]+/g, ' ').trim().slice(0, 128)
      : (typeof raw.text === 'string' ? raw.text.replace(/[\r\n]+/g, ' ').trim().slice(0, 128) : '');
    const emojiRaw = typeof raw.e === 'string' ? raw.e : (typeof raw.emoji === 'string' ? raw.emoji : '');
    const emoji = Array.from(emojiRaw.trim()).slice(0, 8).join('');
    if (!text && !emoji) return null;
    const out = { t: text, e: emoji };
    if (keepUntil && Number.isFinite(raw.until)) out.until = raw.until;
    return out;
  }

  function customActive() {
    ensureLoaded();
    expire();
    const c = window.state.presence.custom;
    return c ? { t: c.t, e: c.e } : null;
  }

  function endOfToday() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }

  function publishNow() {
    if (typeof window.publishPresence === 'function') window.publishPresence();
  }

  function publishOfflineBurst() {
    [0, 700, 1600].forEach(delay => setTimeout(() => {
      if (!isInvisible()) return;
      const client = window.state.globalMqtt;
      if (client && client.connected && window.state.friendId) {
        try {
          client.publish(`teamsync/user/${window.state.friendId}/presence`, JSON.stringify({ online: false, id: window.state.friendId }));
        } catch (e) {}
      }
    }, delay));
  }

  function setStatus(status, durationKey = 'forever') {
    if (!VALID.includes(status)) return;
    ensureLoaded();
    const wasInvisible = isInvisible();
    const p = window.state.presence;
    p.status = status;
    const dur = DURATIONS[durationKey];
    p.until = status === 'online' || dur == null ? null : Date.now() + dur;
    save();
    if (status === 'invisible') publishOfflineBurst();
    else publishNow();
    if (wasInvisible && status !== 'invisible') publishNow();
    emit();
  }

  function setCustom({ text, emoji, clear }) {
    ensureLoaded();
    const c = sanitizeCustom({ t: text, e: emoji });
    const p = window.state.presence;
    if (!c) {
      p.custom = null;
    } else {
      const rule = CUSTOM_CLEAR[clear];
      c.until = rule === 'today' ? endOfToday() : (typeof rule === 'number' ? Date.now() + rule : null);
      p.custom = c;
    }
    save();
    publishNow();
    emit();
  }

  function untilOf() {
    ensureLoaded();
    return window.state.presence.until;
  }

  // ---------- Presence paketi ----------
  function buildPresence(base) {
    const status = effective();
    if (status === 'invisible') return null;
    const payload = { ...base, v: 2, st: status };
    const cs = customActive();
    if (cs) payload.cs = cs;
    const act = window.TSActivity && window.TSActivity.presenceField ? window.TSActivity.presenceField() : null;
    if (act) payload.act = act;
    const rev = window.TSProfile && window.TSProfile.rev ? window.TSProfile.rev() : 0;
    if (rev) payload.pr = rev;
    return payload;
  }

  // Oda hello'suna eklenen hafif alan (oda içi kutucuklar için). Görünmezken
  // bile odadakiler seni zaten görüyor; "çevrimiçi" gösterilir.
  function roomPresence() {
    const status = effective();
    const out = { st: status === 'invisible' ? 'online' : status };
    const act = window.TSActivity && window.TSActivity.presenceField ? window.TSActivity.presenceField() : null;
    if (act) out.act = act;
    return out;
  }

  function sanitizeAct(raw, prev) {
    if (!raw || typeof raw !== 'object') return null;
    const name = typeof raw.n === 'string' ? raw.n.replace(/[\r\n]+/g, ' ').trim().slice(0, 80) : '';
    if (!name) return null;
    const sid = Number.isInteger(raw.sid) && raw.sid > 0 && raw.sid < 1e8 ? raw.sid : 0;
    const el = Number(raw.el);
    const elapsed = Number.isFinite(el) && el >= 0 ? Math.min(el, 7 * 24 * 3600 * 1000) : 0;
    const candidate = Date.now() - elapsed;
    // Başlangıç anı yerel saatle sabitlenir: karşı bilgisayarın saati farklı
    // olsa da sayaç kaymaz; 5 sn'den az oynamalar yeniden hesaplanmaz.
    const startLocal = prev && prev.n === name && Math.abs(prev.startLocal - candidate) < 5000 ? prev.startLocal : candidate;
    return { k: 'play', n: name, sid, startLocal };
  }

  // Arkadaşın presence'ı işlenir. Arkadaş listesinin yeniden çizilmesi
  // gerekiyorsa (durum/özel durum/oyun değişti) true döner.
  function ingestPresence(fid, data) {
    if (!fid || !data) return false;
    const prev = window.state.presenceOf[fid] || {};
    const st = ['online', 'idle', 'dnd'].includes(data.st) ? data.st : 'online';
    const cs = sanitizeCustom(data.cs);
    const act = sanitizeAct(data.act, prev.act);
    const pr = Number.isInteger(data.pr) && data.pr > 0 ? data.pr : 0;
    const v = Number.isInteger(data.v) ? data.v : 1;
    const next = { st, cs, act, pr, v, at: Date.now() };
    window.state.presenceOf[fid] = next;
    const changed = prev.st !== next.st
      || (prev.cs ? `${prev.cs.e}|${prev.cs.t}` : '') !== (cs ? `${cs.e}|${cs.t}` : '')
      || (prev.act ? `${prev.act.n}|${prev.act.sid}|${prev.act.startLocal}` : '') !== (act ? `${act.n}|${act.sid}|${act.startLocal}` : '');
    if (pr && window.TSProfile && window.TSProfile.onRevSeen) window.TSProfile.onRevSeen(fid, pr);
    if (changed) document.dispatchEvent(new CustomEvent('ts:presence', { detail: { fid } }));
    return changed;
  }

  function clearPresence(fid) {
    if (window.state.presenceOf[fid]) {
      delete window.state.presenceOf[fid];
      document.dispatchEvent(new CustomEvent('ts:presence', { detail: { fid } }));
    }
  }

  function ingestRoomPresence(peerId, data) {
    if (!peerId || !data || typeof data !== 'object') return;
    const prev = window.state.roomPresenceOf[peerId] || {};
    const st = ['online', 'idle', 'dnd'].includes(data.st) ? data.st : 'online';
    const act = sanitizeAct(data.act, prev.act);
    window.state.roomPresenceOf[peerId] = { st, act };
    const changed = prev.st !== st || (prev.act ? `${prev.act.n}|${prev.act.startLocal}` : '') !== (act ? `${act.n}|${act.startLocal}` : '');
    if (changed && window.TSTiles) window.TSTiles.update(peerId);
  }

  // Arkadaşın görünen durumu. Çevrimdışı arkadaş asla oyun/durum göstermez.
  function statusOf(fid) {
    const friend = window.state.friends && window.state.friends[fid];
    if (!friend || !friend.online) return 'offline';
    const p = window.state.presenceOf[fid];
    return p && p.st ? p.st : 'online';
  }

  function presenceOf(fid) {
    const friend = window.state.friends && window.state.friends[fid];
    if (!friend || !friend.online) return null;
    return window.state.presenceOf[fid] || null;
  }

  // ---------- Otomatik boşta ----------
  function idleMinutes() {
    const v = parseInt(localStorage.getItem(IDLE_KEY) || '10', 10);
    return Number.isFinite(v) && v >= 1 ? Math.min(v, 240) : 10;
  }

  function setAutoIdle(value) {
    const p = window.state.presence;
    const next = !!value && !window.state.room;
    if (p.autoIdle === next) return;
    p.autoIdle = next;
    publishNow();
    emit();
  }

  async function pollIdle() {
    if (!window.state.friendId) return;
    let seconds = 0;
    try { seconds = await window.electronAPI?.getSystemIdleTime?.(); } catch (e) { return; }
    if (!Number.isFinite(seconds)) return;
    if (seconds >= idleMinutes() * 60) setAutoIdle(true);
    else if (seconds < 15) setAutoIdle(false);
  }
  setInterval(pollIdle, 30 * 1000);
  try {
    window.electronAPI?.onPowerEvent?.(name => {
      if (name === 'lock-screen' || name === 'suspend') setAutoIdle(true);
      else if (name === 'unlock-screen' || name === 'resume') pollIdle();
    });
  } catch (e) {}
  // Kullanıcı uygulamada bir şeye dokunduysa beklemeden aktif ol.
  ['mousedown', 'keydown'].forEach(evt => document.addEventListener(evt, () => {
    if (window.state.presence.autoIdle) setAutoIdle(false);
  }, true));

  // Süresi dolan "Rahatsız Etmeyin 1 saat" vb. kendiliğinden geri döner.
  setInterval(() => {
    if (!window.state.friendId) return;
    ensureLoaded();
    const wasInvisible = window.state.presence.status === 'invisible';
    if (expire()) {
      if (wasInvisible) publishNow();
      publishNow();
      emit();
    }
  }, 30 * 1000);

  // ---------- Özel durum penceresi ----------
  function openCustomDialog() {
    const { esc, tr } = window.TSUI;
    const current = customActive() || { t: '', e: '' };
    const overlay = document.createElement('div');
    overlay.className = 'modal ts-custom-status-modal';
    overlay.setAttribute('data-i18n-ignore', '');
    overlay.innerHTML = `
      <div class="mcard ts-cs-card" role="dialog" aria-modal="true">
        <h3>${esc(tr('status.customTitle'))}</h3>
        <div class="ts-cs-row">
          <input class="ts-cs-emoji" maxlength="8" value="${esc(current.e)}" placeholder="🙂" aria-label="${esc(tr('status.customEmoji'))}" />
          <input class="ts-cs-text" maxlength="128" value="${esc(current.t)}" placeholder="${esc(tr('status.customPlaceholder'))}" />
        </div>
        <label class="ts-cs-label">${esc(tr('status.clearAfter'))}</label>
        <select class="ts-cs-clear">
          <option value="today">${esc(tr('status.clearToday'))}</option>
          <option value="4h">${esc(tr('status.clear4h'))}</option>
          <option value="1h">${esc(tr('status.clear1h'))}</option>
          <option value="30m">${esc(tr('status.clear30m'))}</option>
          <option value="never">${esc(tr('status.clearNever'))}</option>
        </select>
        <div class="mactions">
          <button type="button" class="btn-sec ts-cs-clearbtn">${esc(tr('status.clearCustom'))}</button>
          <button type="button" class="btn-sec ts-cs-cancel">${esc(tr('common.cancel'))}</button>
          <button type="button" class="btn-pri ts-cs-save">${esc(tr('common.save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.ts-cs-cancel').onclick = close;
    overlay.querySelector('.ts-cs-clearbtn').onclick = () => { setCustom({}); close(); };
    const save = () => {
      setCustom({
        text: overlay.querySelector('.ts-cs-text').value,
        emoji: overlay.querySelector('.ts-cs-emoji').value,
        clear: overlay.querySelector('.ts-cs-clear').value
      });
      close();
    };
    overlay.querySelector('.ts-cs-save').onclick = save;
    overlay.querySelector('.ts-cs-text').addEventListener('keydown', e => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') close();
    });
    setTimeout(() => overlay.querySelector('.ts-cs-text').focus(), 30);
  }

  window.TSStatus = {
    effective, rawStatus, isDnd, isInvisible, setStatus, setCustom, customActive, untilOf,
    buildPresence, roomPresence, ingestPresence, clearPresence, ingestRoomPresence,
    statusOf, presenceOf, openCustomDialog, idleMinutes,
    DURATIONS: Object.keys(DURATIONS),
    _setAutoIdle: setAutoIdle
  };
})();
