// Arkadaşlar sayfası: Çevrimiçi / Tümü / Bekleyen / Engellenen / Arkadaş Ekle
// sekmeleri + "Şimdi Aktif" sütunu. Satırların kendisi hâlâ renderer.js'teki
// renderFriends() tarafından çizilir (tek yazar); burada yalnızca filtre,
// sayaçlar, bekleyen istekler ve rozetler yönetilir.
(function () {
  const $ = id => document.getElementById(id);
  const TAB_KEY = 'teamsync_friends_tab';
  const OUT_KEY = fid => `teamsync_outgoing_requests_${fid}`;
  let tab = 'online';
  try { tab = localStorage.getItem(TAB_KEY) || 'online'; } catch (e) {}

  const { esc, tr } = { esc: v => window.TSUI.esc(v), tr: (k, v) => window.TSUI.tr(k, v) };

  function outgoing() {
    const fid = window.state.friendId;
    if (!fid) return [];
    let list = [];
    try { list = JSON.parse(localStorage.getItem(OUT_KEY(fid)) || '[]'); } catch (e) {}
    if (!Array.isArray(list)) list = [];
    const now = Date.now();
    const friends = window.state.friends || {};
    const pruned = list.filter(r => r && typeof r.id === 'string' && !(friends[r.id] && !friends[r.id].temporary) && now - (r.at || 0) < 30 * 24 * 3600 * 1000);
    if (pruned.length !== list.length) saveOutgoing(pruned);
    return pruned;
  }

  function saveOutgoing(list) {
    const fid = window.state.friendId;
    if (!fid) return;
    try { localStorage.setItem(OUT_KEY(fid), JSON.stringify(list.slice(-100))); } catch (e) {}
  }

  function onFriendRequestSent(id) {
    const list = outgoing().filter(r => r.id !== id);
    list.push({ id, at: Date.now() });
    saveOutgoing(list);
    showAddMessage(tr('friends.requestSentTo', { id }), 'ok');
    render();
  }

  function showAddMessage(text, kind) {
    const el = $('add-friend-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = `add-friend-msg ${kind || ''}`;
  }

  function setTab(next) {
    tab = next;
    try { localStorage.setItem(TAB_KEY, tab); } catch (e) {}
    render();
    if (tab === 'add') setTimeout(() => $('friend-id-input')?.focus(), 30);
  }

  function friendRows() {
    return Array.from(document.querySelectorAll('#friends-list > .friend-item'));
  }

  function render() {
    const list = $('friends-list');
    if (!list) return;
    document.querySelectorAll('#friends-tabs [data-ftab]').forEach(b => b.classList.toggle('active', b.dataset.ftab === tab));
    const listTab = tab === 'online' || tab === 'all' || tab === 'blocked';
    $('friends-pane-list')?.classList.toggle('hidden', !listTab);
    $('friends-pane-pending')?.classList.toggle('hidden', tab !== 'pending');
    $('friends-pane-add')?.classList.toggle('hidden', tab !== 'add');
    list.dataset.filter = listTab ? tab : 'all';

    // Arama filtresi + görünen sayısı
    const q = ($('friends-search')?.value || '').trim().toLocaleLowerCase();
    let visible = 0;
    friendRows().forEach(li => {
      const name = (li.querySelector('.friend-name')?.textContent || '').toLocaleLowerCase();
      const miss = !!q && !name.includes(q) && !(li.dataset.fid || '').toLowerCase().includes(q);
      li.classList.toggle('fl-search-miss', miss);
      const passesTab = li.dataset.temp !== '1' && (
        tab === 'blocked' ? li.dataset.muted === '1'
          : tab === 'online' ? li.dataset.online === '1'
            : true);
      if (passesTab && !miss) visible++;
    });
    const countKey = tab === 'online' ? 'friends.countOnline' : tab === 'blocked' ? 'friends.countBlocked' : 'friends.countAll';
    const count = $('friends-count');
    if (count) count.textContent = tr(countKey, { n: visible });
    const empty = $('friends-empty');
    if (empty) {
      const emptyKey = q ? 'friends.emptySearch' : tab === 'online' ? 'friends.emptyOnline' : tab === 'blocked' ? 'friends.emptyBlocked' : 'friends.emptyAll';
      empty.innerHTML = `<div class="friends-empty-art">${window.TSUI.GAMEPAD_SVG}</div><p>${esc(tr(emptyKey))}</p>`;
      empty.classList.toggle('hidden', visible > 0 || !listTab);
    }
    renderPending();
    renderActiveNow();
    renderBadges();
  }

  function renderPending() {
    const host = $('pending-list');
    if (!host) return;
    const incoming = (window.state.friendRequests || []).map((r, idx) => ({ ...r, idx, dir: 'in' }));
    const out = outgoing().map(r => ({ ...r, dir: 'out', name: (window.state.friends[r.id] && window.state.friends[r.id].name) || r.id }));
    const all = [...incoming, ...out];
    const count = $('pending-count');
    if (count) count.textContent = tr('friends.countPending', { n: all.length });
    if (!all.length) {
      host.innerHTML = `<li class="friends-empty"><div class="friends-empty-art">${window.TSUI.GAMEPAD_SVG}</div><p>${esc(tr('friends.emptyPending'))}</p></li>`;
      return;
    }
    host.innerHTML = all.map(r => `
      <li class="pending-item" data-dir="${r.dir}">
        ${window.TSUI.avatarHtml({ name: r.name, seed: r.id, size: 32 })}
        <div class="pending-copy"><b>${esc(r.name || r.id)}</b><small>${esc(tr(r.dir === 'in' ? 'friends.incoming' : 'friends.outgoing'))} · ${esc(r.id)}</small></div>
        <div class="pending-actions">
          ${r.dir === 'in' ? `<button type="button" class="round-act ok" data-accept="${r.idx}" title="${esc(tr('friends.accept'))}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg></button>` : ''}
          <button type="button" class="round-act danger" ${r.dir === 'in' ? `data-reject="${r.idx}"` : `data-cancel="${esc(r.id)}"`} title="${esc(tr(r.dir === 'in' ? 'friends.reject' : 'friends.cancelRequest'))}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </li>`).join('');
  }

  function renderActiveNow() {
    const host = $('active-now-list');
    if (!host) return;
    const friends = window.state.friends || {};
    const rows = Object.keys(friends).filter(fid => {
      const f = friends[fid];
      if (!f || !f.online || f.temporary) return false;
      const p = window.TSStatus ? window.TSStatus.presenceOf(fid) : null;
      return !!(p && p.act) || !!f.room;
    });
    if (!rows.length) {
      host.innerHTML = `<div class="active-now-empty"><strong>${esc(tr('friends.activeNowEmpty'))}</strong><p>${esc(tr('friends.activeNowDesc'))}</p></div>`;
      return;
    }
    host.innerHTML = rows.map(fid => {
      const f = friends[fid];
      const p = window.TSStatus.presenceOf(fid) || {};
      const act = p.act;
      const st = window.TSStatus.statusOf(fid);
      return `
        <div class="an-card" data-fid="${esc(fid)}">
          <div class="an-head">
            ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 32, status: st })}
            <div class="an-copy"><b>${esc(f.name)}</b><small>${act ? esc(act.n) : esc(tr('friends.inVoice'))}</small></div>
            ${act ? window.TSUI.gameArtHtml({ sid: act.sid }, 32) : ''}
          </div>
          ${act ? `<div class="an-activity">${window.TSUI.GAMEPAD_SVG}<span>${esc(act.n)}</span>${window.TSUI.sinceHtml(act.startLocal, 'an-time')}</div>` : ''}
          ${f.room ? `<button type="button" class="an-join" data-join="${esc(fid)}">${esc(tr('friends.joinRoom'))}</button>` : ''}
        </div>`;
    }).join('');
  }

  function renderBadges() {
    const pendingIn = (window.state.friendRequests || []).length;
    const setBadge = (id, n) => {
      const el = $(id);
      if (!el) return;
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.toggle('hidden', !n);
    };
    setBadge('side-requests-badge', pendingIn);
    setBadge('ftab-pending-badge', pendingIn);
    const dmUnread = window.TSDM ? window.TSDM.totalUnread() : 0;
    setBadge('rail-home-badge', pendingIn + dmUnread);
  }

  function bind() {
    $('friends-tabs')?.addEventListener('click', e => {
      const b = e.target.closest('[data-ftab]');
      if (b) setTab(b.dataset.ftab);
    });
    $('friends-search')?.addEventListener('input', render);
    $('pending-list')?.addEventListener('click', e => {
      const acc = e.target.closest('[data-accept]');
      const rej = e.target.closest('[data-reject]');
      const can = e.target.closest('[data-cancel]');
      if (acc && typeof window.acceptInvite === 'function') window.acceptInvite(Number(acc.dataset.accept));
      else if (rej && typeof window.rejectInvite === 'function') window.rejectInvite(Number(rej.dataset.reject));
      else if (can) { saveOutgoing(outgoing().filter(r => r.id !== can.dataset.cancel)); render(); }
    });
    $('active-now-list')?.addEventListener('click', e => {
      const join = e.target.closest('[data-join]');
      if (join) { if (typeof window.requestJoinRoom === 'function') window.requestJoinRoom(join.dataset.join); return; }
      const card = e.target.closest('[data-fid]');
      if (card && window.TSProfile) window.TSProfile.showCard({ friendId: card.dataset.fid, placement: 'left' }, card);
    });
    $('friend-id-input')?.addEventListener('input', () => showAddMessage(''));
    $('friend-id-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-add-friend')?.click(); });
    document.addEventListener('ts:presence', () => { renderActiveNow(); });
  }

  document.addEventListener('DOMContentLoaded', bind);

  window.TSFriends = {
    render,
    afterRender: render,
    setTab,
    onFriendRequestSent,
    addFriendError: text => showAddMessage(text, 'error'),
    renderBadges
  };
})();
