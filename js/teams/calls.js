// Aramalar sayfası (TSCallsView): solda hızlı arama (arkadaşlar), sağda
// günlere ayrılmış arama geçmişi (js/teams/call-log.js). Raydaki rozet
// görülmemiş cevapsız aramaları sayar.
(function () {
  const $ = id => document.getElementById(id);
  const esc = v => window.TSUI.esc(v);
  const tr = (k, v) => window.TSUI.tr(k, v);
  const PHONE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  const CHAT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.6-.7L3 21l1.6-4.6A8 8 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>';
  const DIR_ICON = {
    out: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>',
    in: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="7" x2="7" y2="17"/><polyline points="16 17 7 17 7 8"/></svg>',
    missed: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="7" x2="7" y2="17"/><polyline points="16 17 7 17 7 8"/><line x1="15" y1="3" x2="21" y2="9"/><line x1="21" y1="3" x2="15" y2="9"/></svg>',
    declined: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>'
  };
  let filter = 'all';

  const locale = () => { try { return document.documentElement.lang || undefined; } catch (e) { return undefined; } };
  const fmtTime = ts => (typeof window.formatUserTime === 'function' ? window.formatUserTime(new Date(ts)) : new Date(ts).toLocaleTimeString());

  function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }

  function bucket(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sod = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((sod(now) - sod(d)) / 86400000);
    if (days <= 0) return tr('calls.today');
    if (days === 1) return tr('calls.yesterday');
    try { return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(d); } catch (e) { return d.toDateString(); }
  }

  function kindLabel(k) {
    return tr(k === 'group' ? 'calls.group' : k === 'server' ? 'calls.server' : k === 'direct' ? 'dmh.voiceCall' : 'calls.room');
  }

  function dirLabel(e) {
    if (e.dir === 'missed') return tr('calls.missed');
    if (e.dir === 'declined') return tr('calls.declined');
    return tr(e.dir === 'in' ? 'calls.incoming' : 'calls.outgoing');
  }

  function entryHtml(e) {
    const friends = window.state.friends || {};
    const peers = (e.peers || []).filter(p => p && (p.fid || p.name));
    const first = peers[0];
    const f = first && first.fid ? friends[first.fid] : null;
    const names = peers.map(p => (p.fid && friends[p.fid] && friends[p.fid].name) || p.name || p.fid).filter(Boolean);
    const title = e.kind === 'direct' && names.length ? names.join(', ') : (e.title || names.join(', ') || tr('calls.withYouOnly'));
    const sub = e.kind === 'direct' ? '' : (names.length ? names.join(', ') : tr('calls.withYouOnly'));
    const av = first
      ? window.TSUI.avatarHtml({ src: f && f.avatar, name: (f && f.name) || first.name || '?', seed: first.fid || first.name, size: 36, status: first.fid && window.TSStatus ? window.TSStatus.statusOf(first.fid) : null })
      : `<span class="calls-room-ico">${PHONE}</span>`;
    const dur = e.dir === 'missed' || e.dir === 'declined' ? '' : (e.answered === false ? tr('calls.unanswered') : fmtDuration((e.end || Date.now()) - (e.connectedAt || e.start)));
    const callable = first && first.fid && friends[first.fid];
    return `
      <li class="calls-row is-${esc(e.dir)}" data-entry="${esc(e.id)}">
        ${av}
        <span class="calls-copy">
          <strong>${esc(title)}</strong>
          <small><span class="calls-dir">${DIR_ICON[e.dir] || DIR_ICON.out}${esc(dirLabel(e))}</span> · ${esc(kindLabel(e.kind))}${sub ? ` · ${esc(sub)}` : ''}</small>
        </span>
        <span class="calls-meta"><time>${esc(fmtTime(e.start))}</time>${dur ? `<small>${esc(dur)}</small>` : ''}</span>
        <span class="calls-actions">
          ${callable ? `<button type="button" class="ts-icon-btn" data-call-msg="${esc(first.fid)}" title="${esc(tr('calls.message'))}">${CHAT}</button>
          <button type="button" class="ts-icon-btn is-call" data-call-back="${esc(first.fid)}" title="${esc(tr('calls.callBack'))}">${PHONE}</button>` : ''}
        </span>
      </li>`;
  }

  function render() {
    const host = $('view-calls');
    if (!host || !window.TSCallLog) return;
    const all = window.TSCallLog.list();
    const list = filter === 'missed' ? all.filter(e => e.dir === 'missed' || e.dir === 'declined') : all;
    const groups = [];
    list.forEach(e => {
      const b = bucket(e.start);
      const g = groups[groups.length - 1];
      if (g && g.label === b) g.items.push(e); else groups.push({ label: b, items: [e] });
    });
    const friends = Object.entries(window.state.friends || {}).filter(([, f]) => f && f.name && !f.temporary)
      .sort((a, b) => {
        const sa = window.TSStatus ? window.TSStatus.statusOf(a[0]) : 'offline';
        const sb = window.TSStatus ? window.TSStatus.statusOf(b[0]) : 'offline';
        return (sa === 'offline') - (sb === 'offline') || String(a[1].name).localeCompare(String(b[1].name));
      });
    host.innerHTML = `
      <header class="view-header calls-header">
        <button class="vh-drawer" type="button" data-shell-drawer title="${esc(tr('shell.menu'))}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
        <div class="vh-title">${PHONE}<span>${esc(tr('calls.title'))}</span></div>
        <div class="calls-filters">
          <button type="button" class="chat-chip ${filter === 'all' ? 'active' : ''}" data-calls-filter="all">${esc(tr('calls.filterAll'))}</button>
          <button type="button" class="chat-chip ${filter === 'missed' ? 'active' : ''}" data-calls-filter="missed">${esc(tr('calls.filterMissed'))}</button>
        </div>
        <div class="vh-actions">${all.length ? `<button type="button" class="ts-pill-btn" data-calls-clear>${esc(tr('calls.clear'))}</button>` : ''}</div>
      </header>
      <div class="calls-body">
        <aside class="calls-speed">
          <h3>${esc(tr('calls.speedDial'))}</h3>
          ${friends.length ? `<ul>${friends.map(([fid, f]) => `
            <li class="calls-speed-row">
              ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 32, status: window.TSStatus ? window.TSStatus.statusOf(fid) : null })}
              <span class="calls-speed-name">${esc(f.name)}</span>
              <button type="button" class="ts-icon-btn is-call" data-call-back="${esc(fid)}" title="${esc(tr('dmh.voiceCall'))}">${PHONE}</button>
            </li>`).join('')}</ul>` : `<p class="cal-empty">${esc(tr('calls.noFriends'))}</p>`}
        </aside>
        <section class="calls-history">
          ${groups.length ? groups.map(g => `
            <h3 class="calls-day">${esc(g.label)}</h3>
            <ul class="calls-list">${g.items.map(entryHtml).join('')}</ul>`).join('') : `
            <div class="calls-empty">
              <span class="calls-empty-ico">${PHONE}</span>
              <strong>${esc(tr('calls.empty'))}</strong>
              <p>${esc(tr('calls.emptyLead'))}</p>
            </div>`}
        </section>
      </div>`;
  }

  function renderBadge() {
    const badge = $('rail-calls-badge');
    if (!badge || !window.TSCallLog) return;
    const n = window.TSShell && window.TSShell.view() === 'calls' ? 0 : window.TSCallLog.unseenMissed();
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', !n);
  }

  function bind() {
    const host = $('view-calls');
    if (!host) return;
    host.addEventListener('click', async e => {
      const f = e.target.closest('[data-calls-filter]');
      if (f) { filter = f.dataset.callsFilter; render(); return; }
      if (e.target.closest('[data-calls-clear]')) {
        const ok = typeof window.showConfirm === 'function' ? await window.showConfirm(tr('calls.clear'), tr('calls.clearConfirm')) : true;
        if (ok) { window.TSCallLog.clear(); render(); }
        return;
      }
      const back = e.target.closest('[data-call-back]');
      if (back && window.TSDirectCall) { window.TSDirectCall.call(back.dataset.callBack); return; }
      const msg = e.target.closest('[data-call-msg]');
      if (msg && typeof window.openDM === 'function') window.openDM(msg.dataset.callMsg);
    });
    document.addEventListener('ts:view', e => {
      if (e.detail && e.detail.view === 'calls') {
        render();
        if (window.TSCallLog) window.TSCallLog.markSeen();
      }
      renderBadge();
    });
    document.addEventListener('ts:calllog', () => {
      renderBadge();
      if (window.TSShell && window.TSShell.view() === 'calls') render();
    });
    document.addEventListener('ts:presence', () => { if (window.TSShell && window.TSShell.view() === 'calls') render(); });
  }

  document.addEventListener('DOMContentLoaded', bind);
  window.TSCallsView = { render, renderBadge, fmtDuration };
})();
