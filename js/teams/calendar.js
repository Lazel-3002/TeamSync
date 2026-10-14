// Takvim (TSCalendar): ay görünümü + seçili günün toplantıları + yaklaşanlar.
// Toplantılar hesap başına bu cihazda saklanır (sunucuya gitmez). Kaydederken
// davetlilere DM ile tek satırlık bir bilgi gider; vakti gelince "Başlat"
// oda kurup davetlilerin zilini çaldırır (js/teams/direct-call.js).
(function () {
  const $ = id => document.getElementById(id);
  const KEY = fid => `teamsync_calendar_${fid}`;
  const esc = v => window.TSUI.esc(v);
  const tr = (k, v) => window.TSUI.tr(k, v);
  const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
  const ICON_CAL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  const ICON_PREV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  const ICON_NEXT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const ICON_PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const ICON_VIDEO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="3"/><path d="M16 10.5 22 7v10l-6-3.5"/></svg>';
  const ICON_EDIT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

  let events = [];
  let loadedFor = null;
  let cursor = new Date(); // gösterilen ay
  let selected = dayKey(new Date());
  const notified = new Set();

  function dayKey(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }
  const locale = () => { try { return document.documentElement.lang || undefined; } catch (e) { return undefined; } };
  const fmtTime = ts => (typeof window.formatUserTime === 'function' ? window.formatUserTime(new Date(ts)) : new Date(ts).toLocaleTimeString());
  function fmtWhen(ts) {
    try { return `${new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ts))} ${fmtTime(ts)}`; } catch (e) { return new Date(ts).toLocaleString(); }
  }
  const durLabel = m => (m % 60 === 0 && m >= 60 ? tr('cal.hours', { n: m / 60 }) : tr('cal.minutes', { n: m }));

  function load() {
    const fid = window.state && window.state.friendId;
    if (!fid) return [];
    if (loadedFor === fid) return events;
    loadedFor = fid;
    try { events = JSON.parse(localStorage.getItem(KEY(fid)) || '[]'); } catch (e) { events = []; }
    if (!Array.isArray(events)) events = [];
    return events;
  }
  function save() {
    const fid = window.state && window.state.friendId;
    if (!fid) return;
    events.sort((a, b) => a.start - b.start);
    try { localStorage.setItem(KEY(fid), JSON.stringify(events)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('ts:calendar'));
  }

  const onDay = key => load().filter(e => dayKey(e.start) === key).sort((a, b) => a.start - b.start);
  const upcoming = () => load().filter(e => e.start + e.dur * 60000 > Date.now()).sort((a, b) => a.start - b.start).slice(0, 6);
  const todayRemaining = () => onDay(dayKey(new Date())).filter(e => e.start + e.dur * 60000 > Date.now()).length;
  const isLive = e => Date.now() >= e.start - 5 * 60000 && Date.now() < e.start + e.dur * 60000;

  function attendeesHtml(e, size = 22) {
    const friends = window.state.friends || {};
    const list = (e.attendees || []).filter(fid => friends[fid]).slice(0, 5);
    if (!list.length) return '';
    return `<span class="cal-att">${list.map(fid => window.TSUI.avatarHtml({ src: friends[fid].avatar, name: friends[fid].name, seed: fid, size })).join('')}${(e.attendees || []).length > 5 ? `<span class="cal-att-more">+${e.attendees.length - 5}</span>` : ''}</span>`;
  }

  function eventCardHtml(e) {
    const end = e.start + e.dur * 60000;
    return `
      <div class="cal-ev ${isLive(e) ? 'is-live' : ''} ${end < Date.now() ? 'is-past' : ''}" data-ev="${esc(e.id)}">
        <span class="cal-ev-bar"></span>
        <div class="cal-ev-main">
          <div class="cal-ev-time">${esc(fmtTime(e.start))} – ${esc(fmtTime(end))}</div>
          <div class="cal-ev-title">${esc(e.title)}</div>
          ${e.note ? `<div class="cal-ev-note">${esc(e.note)}</div>` : ''}
          ${attendeesHtml(e)}
        </div>
        <div class="cal-ev-actions">
          ${end > Date.now() ? `<button type="button" class="ts-pill-btn is-primary" data-cal-start="${esc(e.id)}">${ICON_VIDEO}<span>${esc(tr('cal.start'))}</span></button>` : ''}
          <button type="button" class="ts-icon-btn" data-cal-edit="${esc(e.id)}" title="${esc(tr('cal.edit'))}">${ICON_EDIT}</button>
        </div>
      </div>`;
  }

  function render() {
    const host = $('view-calendar');
    if (!host) return;
    load();
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    let monthLabel;
    try { monthLabel = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(cursor); } catch (e) { monthLabel = `${m + 1}/${y}`; }
    // Pazartesi başlangıçlı 6 haftalık ızgara
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7;
    const startDate = new Date(y, m, 1 - offset);
    const todayKey = dayKey(new Date());
    const weekdays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(2024, 0, 1 + i); // 1 Ocak 2024 Pazartesi
      try { weekdays.push(new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(d)); } catch (e) { weekdays.push(String(i)); }
    }
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      const key = dayKey(d);
      const evs = onDay(key);
      cells += `
        <button type="button" class="cal-cell ${d.getMonth() !== m ? 'is-out' : ''} ${key === todayKey ? 'is-today' : ''} ${key === selected ? 'is-selected' : ''}" data-day="${key}">
          <span class="cal-cell-num">${d.getDate()}</span>
          ${evs.slice(0, 2).map(e => `<span class="cal-chip">${esc(fmtTime(e.start))} ${esc(e.title)}</span>`).join('')}
          ${evs.length > 2 ? `<span class="cal-chip-more">+${evs.length - 2}</span>` : ''}
        </button>`;
    }
    const selDate = new Date(`${selected}T12:00:00`);
    let selLabel;
    try { selLabel = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(selDate); } catch (e) { selLabel = selected; }
    const dayEvents = onDay(selected);
    const up = upcoming();
    host.innerHTML = `
      <header class="view-header cal-header">
        <button class="vh-drawer" type="button" data-shell-drawer title="${esc(tr('shell.menu'))}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
        <div class="vh-title">${ICON_CAL}<span>${esc(tr('cal.title'))}</span></div>
        <div class="cal-nav">
          <button type="button" class="ts-pill-btn" data-cal-nav="today">${esc(tr('cal.today'))}</button>
          <button type="button" class="ts-icon-btn" data-cal-nav="prev" title="${esc(tr('cal.prev'))}">${ICON_PREV}</button>
          <button type="button" class="ts-icon-btn" data-cal-nav="next" title="${esc(tr('cal.next'))}">${ICON_NEXT}</button>
          <span class="cal-month-label">${esc(monthLabel)}</span>
        </div>
        <div class="vh-actions">
          <button type="button" class="ts-pill-btn is-primary" data-cal-new>${ICON_PLUS}<span>${esc(tr('cal.new'))}</span></button>
        </div>
      </header>
      <div class="cal-body">
        <section class="cal-month" aria-label="${esc(monthLabel)}">
          <div class="cal-weekdays">${weekdays.map(w => `<span>${esc(w)}</span>`).join('')}</div>
          <div class="cal-grid">${cells}</div>
        </section>
        <aside class="cal-side">
          <div class="cal-side-head">
            <h2>${esc(selLabel)}</h2>
            <button type="button" class="ts-icon-btn" data-cal-new-day="${selected}" title="${esc(tr('cal.new'))}">${ICON_PLUS}</button>
          </div>
          <div class="cal-day-list">${dayEvents.length ? dayEvents.map(eventCardHtml).join('') : `<p class="cal-empty">${esc(tr('cal.dayEmpty'))}</p>`}</div>
          <h3 class="cal-side-sub">${esc(tr('cal.upcoming'))}</h3>
          <div class="cal-up-list">${up.length ? up.map(e => `
            <button type="button" class="cal-up ${isLive(e) ? 'is-live' : ''}" data-day="${dayKey(e.start)}">
              <span class="cal-up-date"><b>${new Date(e.start).getDate()}</b><small>${esc((() => { try { return new Intl.DateTimeFormat(locale(), { month: 'short' }).format(new Date(e.start)); } catch (x) { return ''; } })())}</small></span>
              <span class="cal-up-copy"><strong>${esc(e.title)}</strong><small>${esc(fmtTime(e.start))} · ${esc(durLabel(e.dur))}</small></span>
            </button>`).join('') : `<p class="cal-empty">${esc(tr('cal.noUpcoming'))}</p>`}</div>
          <p class="cal-note">${esc(tr('cal.localOnly'))}</p>
        </aside>
      </div>`;
  }

  // ---------- Toplantı penceresi ----------
  function openEditor(ev, dayHint) {
    const friends = Object.entries(window.state.friends || {}).filter(([, f]) => f && f.name && !f.temporary)
      .sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
    const base = ev ? new Date(ev.start) : (() => {
      const d = dayHint ? new Date(`${dayHint}T12:00:00`) : new Date();
      const now = new Date();
      if (dayKey(d) === dayKey(now)) { d.setHours(now.getHours() + 1, 0, 0, 0); } else { d.setHours(20, 0, 0, 0); }
      return d;
    })();
    const sel = new Set(ev ? ev.attendees || [] : []);
    const dur = ev ? ev.dur : 60;
    const overlay = document.createElement('div');
    overlay.className = 'modal ts-dialog-overlay cal-dialog-overlay';
    overlay.setAttribute('data-i18n-ignore', '');
    overlay.innerHTML = `
      <form class="ts-dialog cal-dialog" role="dialog" aria-modal="true">
        <h2>${esc(tr(ev ? 'cal.edit' : 'cal.new'))}</h2>
        <label class="ts-field"><span>${esc(tr('cal.fieldTitle'))}</span><input name="title" type="text" maxlength="80" required value="${esc(ev ? ev.title : '')}" placeholder="${esc(tr('cal.titlePlaceholder'))}" /></label>
        <div class="ts-field-row">
          <label class="ts-field"><span>${esc(tr('cal.fieldDate'))}</span><input name="date" type="date" required value="${dayKey(base)}" /></label>
          <label class="ts-field"><span>${esc(tr('cal.fieldTime'))}</span><input name="time" type="time" required value="${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}" /></label>
          <label class="ts-field"><span>${esc(tr('cal.fieldDuration'))}</span><select name="dur">${DURATIONS.map(d => `<option value="${d}" ${d === dur ? 'selected' : ''}>${esc(durLabel(d))}</option>`).join('')}</select></label>
        </div>
        <div class="ts-field"><span>${esc(tr('cal.fieldAttendees'))}</span>
          <div class="cal-pick">${friends.length ? friends.map(([fid, f]) => `
            <label class="cal-pick-row">
              <input type="checkbox" name="att" value="${esc(fid)}" ${sel.has(fid) ? 'checked' : ''} />
              ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 24 })}
              <span>${esc(f.name)}</span>
            </label>`).join('') : `<p class="cal-empty">${esc(tr('cal.noFriends'))}</p>`}</div>
        </div>
        <label class="ts-field"><span>${esc(tr('cal.fieldNote'))}</span><textarea name="note" rows="2" maxlength="300" placeholder="${esc(tr('cal.notePlaceholder'))}">${esc(ev ? ev.note || '' : '')}</textarea></label>
        <div class="ts-dialog-actions">
          ${ev ? `<button type="button" class="ts-pill-btn is-danger" data-act="delete">${esc(tr('cal.delete'))}</button>` : ''}
          <span class="ts-spacer"></span>
          <button type="button" class="ts-pill-btn" data-act="cancel">${esc(tr('cal.cancel'))}</button>
          <button type="submit" class="ts-pill-btn is-primary">${esc(tr('cal.save'))}</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const close = () => overlay.remove();
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    form.querySelector('[data-act="cancel"]').addEventListener('click', close);
    const del = form.querySelector('[data-act="delete"]');
    if (del) del.addEventListener('click', () => {
      events = load().filter(x => x.id !== ev.id);
      save();
      close();
      render();
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form);
      const title = String(fd.get('title') || '').trim();
      if (!title) { window.showToast(tr('cal.needTitle'), 'warn'); return; }
      const start = new Date(`${fd.get('date')}T${fd.get('time')}:00`).getTime();
      if (!Number.isFinite(start)) return;
      const attendees = fd.getAll('att').map(String);
      const before = ev ? new Set(ev.attendees || []) : new Set();
      const timeChanged = ev && ev.start !== start;
      const rec = ev || { id: crypto.randomUUID(), createdAt: Date.now(), organizer: window.state.friendId };
      Object.assign(rec, { title, start, dur: Number(fd.get('dur')) || 60, attendees, note: String(fd.get('note') || '').trim().slice(0, 300) });
      if (!ev) load().push(rec);
      save();
      close();
      selected = dayKey(start);
      cursor = new Date(start);
      render();
      // Davetlilere tek satırlık DM (yeni eklenenler ya da saat değiştiyse hepsi)
      const notify = attendees.filter(fid => timeChanged || !before.has(fid));
      if (notify.length && typeof window.sendDMTextTo === 'function') {
        const text = tr('cal.inviteText', { title, when: fmtWhen(start) });
        notify.reduce((p, fid) => p.then(() => window.sendDMTextTo(fid, text)).catch(() => {}), Promise.resolve());
      }
      window.showToast(tr('cal.saved'), 'ok');
    });
    setTimeout(() => form.querySelector('input[name="title"]').focus(), 20);
  }

  function startEvent(id) {
    const e = load().find(x => x.id === id);
    if (!e || !window.TSDirectCall) return;
    e.startedAt = Date.now();
    save();
    window.TSDirectCall.meet(e.title, e.attendees || []);
  }

  // ---------- Hatırlatıcılar ----------
  function reminderCard(e, text) {
    const el = document.createElement('div');
    el.className = 'dc-ring cal-ring';
    el.setAttribute('data-i18n-ignore', '');
    el.innerHTML = `
      <div class="dc-ring-av cal-ring-icon">${ICON_CAL}</div>
      <div class="dc-ring-copy"><strong>${esc(e.title)}</strong><small>${esc(text)}</small></div>
      <div class="dc-ring-actions">
        <button type="button" class="ts-pill-btn" data-r="close">${esc(tr('common.close'))}</button>
        <button type="button" class="ts-pill-btn is-primary" data-r="start">${ICON_VIDEO}<span>${esc(tr('cal.startNow'))}</span></button>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); };
    const t = setTimeout(close, 60000);
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-r]');
      if (!b) return;
      clearTimeout(t);
      close();
      if (b.dataset.r === 'start') startEvent(e.id);
    });
  }

  function tick() {
    if (!window.state || !window.state.friendId) return;
    const now = Date.now();
    load().forEach(e => {
      if (e.startedAt) return;
      const k5 = `${e.id}:5`;
      const k0 = `${e.id}:0`;
      if (now >= e.start - 5 * 60000 && now < e.start - 60000 && !notified.has(k5)) {
        notified.add(k5);
        reminderCard(e, tr('cal.reminder', { title: e.title }));
      } else if (now >= e.start && now < e.start + 10 * 60000 && !notified.has(k0)) {
        notified.add(k0);
        notified.add(k5);
        reminderCard(e, tr('cal.startsNow', { title: e.title }));
      }
    });
    const badge = $('rail-calendar-badge');
    if (badge) {
      const n = todayRemaining();
      badge.textContent = String(n);
      badge.classList.toggle('hidden', !n);
    }
  }

  function bind() {
    const host = $('view-calendar');
    if (!host) return;
    host.addEventListener('click', e => {
      const nav = e.target.closest('[data-cal-nav]');
      if (nav) {
        const k = nav.dataset.calNav;
        if (k === 'today') { cursor = new Date(); selected = dayKey(new Date()); }
        else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + (k === 'next' ? 1 : -1), 1);
        render();
        return;
      }
      if (e.target.closest('[data-cal-new]')) { openEditor(null, selected); return; }
      const newDay = e.target.closest('[data-cal-new-day]');
      if (newDay) { openEditor(null, newDay.dataset.calNewDay); return; }
      const st = e.target.closest('[data-cal-start]');
      if (st) { startEvent(st.dataset.calStart); return; }
      const ed = e.target.closest('[data-cal-edit]');
      if (ed) { openEditor(load().find(x => x.id === ed.dataset.calEdit)); return; }
      const day = e.target.closest('[data-day]');
      if (day) {
        selected = day.dataset.day;
        const d = new Date(`${selected}T12:00:00`);
        if (d.getMonth() !== cursor.getMonth() || d.getFullYear() !== cursor.getFullYear()) cursor = new Date(d.getFullYear(), d.getMonth(), 1);
        render();
      }
    });
    host.addEventListener('dblclick', e => {
      const day = e.target.closest('.cal-cell[data-day]');
      if (day) openEditor(null, day.dataset.day);
    });
    document.addEventListener('ts:view', e => { if (e.detail && e.detail.view === 'calendar') render(); });
    document.addEventListener('ts:calendar', tick);
    setInterval(tick, 20000);
    setTimeout(tick, 3000);
  }

  document.addEventListener('DOMContentLoaded', bind);

  window.TSCalendar = { render, openEditor, startEvent, list: () => load().slice(), tick };
})();
