// Arkadaşlar sayfası: Çevrimiçi / Tümü / Bekleyen / Engellenen / Arkadaş Ekle
// sekmeleri + "Şimdi Aktif" sütunu. Satırların kendisi hâlâ renderer.js'teki
// renderFriends() tarafından çizilir (tek yazar); burada yalnızca filtre,
// sayaçlar, bekleyen istekler ve rozetler yönetilir.
(function () {
  const $ = id => document.getElementById(id);
  const TAB_KEY = 'teamsync_friends_tab';
  const OUT_KEY = fid => `teamsync_outgoing_requests_${fid}`;
  const ID_RE = /^[A-Za-z0-9_-]{3,128}$/;
  // Çıkarılanlar / Engellenenler YALNIZCA bu cihazda, hesap başına tutulur;
  // saveProfile() bunları Supabase'e göndermez (sunucuda olabildiğince az veri).
  const REMOVED_KEY = fid => `teamsync_removed_friends_${fid}`;
  const BLOCK_KEY = fid => `teamsync_blocked_${fid}`;
  const LIST_MAX = 300;
  const TABS = ['online', 'all', 'pending', 'removed', 'blocked', 'add'];
  let tab = 'online';
  try { tab = localStorage.getItem(TAB_KEY) || 'online'; } catch (e) {}
  if (!TABS.includes(tab)) tab = 'online';

  const { esc, tr } = { esc: v => window.TSUI.esc(v), tr: (k, v) => window.TSUI.tr(k, v) };
  const ico = (name, size = 16) => (window.TSUI && typeof window.TSUI.icon === 'function' ? window.TSUI.icon(name, size) : '');
  const toast = (text, kind) => { if (typeof window.showToast === 'function') window.showToast(text, kind || 'info'); };

  // ---------- yerel listeler (Çıkarılanlar / Engellenenler) ----------
  function readList(key) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
    return Array.isArray(list) ? list.filter(r => r && typeof r.fid === 'string' && ID_RE.test(r.fid)) : [];
  }
  function writeList(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list.slice(-LIST_MAX))); } catch (e) {}
  }
  // Avatar yalnızca küçükse ya da bir URL ise saklanır (base64 resimler localStorage'ı şişirmesin).
  // Profil görseli tanımlayıcıları (tsm:…, js/profile-media.js) kısa olduğu için
  // olduğu gibi saklanır; TSUI.avatarHtml bunları yerel depodan / P2P çözer.
  function keepAvatar(src) {
    if (typeof src !== 'string' || !src) return undefined;
    if (window.TSProfileMedia && typeof window.TSProfileMedia.isRef === 'function' && window.TSProfileMedia.isRef(src)) return src;
    if (/^https:\/\//.test(src) && src.length < 600) return src;
    if (/^data:image\//.test(src) && src.length < 48000) return src;
    return undefined;
  }
  const cleanName = (name, fid) => String(name || '').replace(/[\r\n\t<>]+/g, ' ').trim().slice(0, 60) || fid;

  let blockCache = { owner: null, set: new Set() };
  function blockSet() {
    const fid = window.state && window.state.friendId;
    if (blockCache.owner !== fid) blockCache = { owner: fid, set: new Set(fid ? readList(BLOCK_KEY(fid)).map(r => r.fid) : []) };
    return blockCache.set;
  }
  function blockedList() {
    const fid = window.state.friendId;
    return fid ? readList(BLOCK_KEY(fid)) : [];
  }
  function emitBlock(fid, blocked) {
    document.dispatchEvent(new CustomEvent('ts:blocklist', { detail: { fid, blocked } }));
  }
  // Ham kayıt işlemleri (onaysız). Kullanıcı eylemleri aşağıdaki confirmBlock/unblockUser.
  function blockRecord(fid, name, extra) {
    const me = window.state.friendId;
    if (!me || !ID_RE.test(fid || '') || fid === me) return false;
    const list = blockedList().filter(r => r.fid !== fid);
    list.push({ fid, name: cleanName(name, fid), avatar: keepAvatar(extra && extra.avatar), blockedAt: Date.now() });
    writeList(BLOCK_KEY(me), list);
    blockCache.owner = null;
    forgetRemoved(fid, true);
    emitBlock(fid, true);
    return true;
  }
  function unblockRecord(fid) {
    const me = window.state.friendId;
    if (!me) return false;
    const list = blockedList();
    const next = list.filter(r => r.fid !== fid);
    if (next.length === list.length) return false;
    writeList(BLOCK_KEY(me), next);
    blockCache.owner = null;
    emitBlock(fid, false);
    return true;
  }
  const isBlocked = fid => typeof fid === 'string' && blockSet().has(fid);

  function removedList() {
    const fid = window.state.friendId;
    if (!fid) return [];
    const friends = window.state.friends || {};
    const list = readList(REMOVED_KEY(fid));
    // Yeniden arkadaş olan (ya da engellenen) kişi listeden kendiliğinden düşer.
    const pruned = list.filter(r => !(friends[r.fid] && !friends[r.fid].temporary) && !isBlocked(r.fid));
    if (pruned.length !== list.length) writeList(REMOVED_KEY(fid), pruned);
    return pruned;
  }
  function recordRemoved(fid, name, avatar) {
    const me = window.state.friendId;
    if (!me || !ID_RE.test(fid || '') || isBlocked(fid)) return;
    const list = readList(REMOVED_KEY(me)).filter(r => r.fid !== fid);
    list.push({ fid, name: cleanName(name, fid), avatar: keepAvatar(avatar), removedAt: Date.now() });
    writeList(REMOVED_KEY(me), list);
  }
  function forgetRemoved(fid, quiet) {
    const me = window.state.friendId;
    if (!me) return;
    const list = readList(REMOVED_KEY(me));
    const next = list.filter(r => r.fid !== fid);
    if (next.length !== list.length) writeList(REMOVED_KEY(me), next);
    if (!quiet) render();
  }
  const wasRemoved = fid => removedList().some(r => r.fid === fid);

  function outgoing() {
    const fid = window.state.friendId;
    if (!fid) return [];
    let list = [];
    try { list = JSON.parse(localStorage.getItem(OUT_KEY(fid)) || '[]'); } catch (e) {}
    if (!Array.isArray(list)) list = [];
    const now = Date.now();
    const friends = window.state.friends || {};
    // Kimlik desenine uymayan kayıtlar (eski sürüm "E" gibi her girdiyi
    // giden istek diye kaydediyordu) hiçbir kişiye ulaşamaz: atılır.
    const pruned = list.filter(r => r && typeof r.id === 'string' && ID_RE.test(r.id) && !(friends[r.id] && !friends[r.id].temporary) && now - (r.at || 0) < 30 * 24 * 3600 * 1000);
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

  // Sunucudaki posta kutusundan gelen (ör. başka cihazdan gönderilmiş) istek.
  function rememberOutgoing(id, at, name) {
    const list = outgoing();
    const found = list.find(r => r.id === id);
    if (found) {
      if (!name || found.name === name) return;
      found.name = name;
    } else {
      list.push({ id, at: at || Date.now(), name: name || undefined });
    }
    saveOutgoing(list);
    render();
  }

  function dropOutgoing(id) {
    saveOutgoing(outgoing().filter(r => r.id !== id));
    render();
  }

  // kind: ''|'ok'|'error'|'warn'|'loading'; action: { label, act, fid } satır içi düğme.
  function showAddMessage(text, kind, action) {
    const el = $('add-friend-msg');
    if (!el) return;
    const icon = { ok: 'check', error: 'alert', warn: 'alert', loading: 'clock' }[kind] || '';
    el.className = `add-friend-msg ${kind || ''}`;
    el.setAttribute('role', kind === 'error' || kind === 'warn' ? 'alert' : 'status');
    if (!text) { el.textContent = ''; return; }
    el.innerHTML = `${icon ? `<span class="afm-ico">${ico(icon, 15)}</span>` : ''}<span class="afm-text">${esc(text)}</span>${action ? `<button type="button" class="afm-act" data-afm="${esc(action.act)}" data-fid="${esc(action.fid || '')}">${esc(action.label)}</button>` : ''}`;
  }

  // ---------- kullanıcı eylemleri: engelle / engeli kaldır / tekrar ekle ----------
  function nameOf(fid, fallback) {
    const f = (window.state.friends || {})[fid];
    const rec = blockedList().find(r => r.fid === fid) || removedList().find(r => r.fid === fid);
    return (f && f.name) || fallback || (rec && rec.name) || fid;
  }

  async function confirmBlock(fid, name) {
    if (!ID_RE.test(fid || '') || fid === window.state.friendId) return false;
    const f = (window.state.friends || {})[fid];
    const isFriend = !!(f && !f.temporary);
    const who = nameOf(fid, name);
    const ok = await window.showConfirm(tr('friends.blockTitle', { name: who }), tr(isFriend ? 'friends.blockConfirmFriend' : 'friends.blockConfirm'));
    if (!ok) return false;
    applyBlock(fid, who);
    return true;
  }

  function applyBlock(fid, name) {
    const st = window.state;
    const f = (st.friends || {})[fid];
    const avatar = f && f.avatar;
    blockRecord(fid, name, { avatar });
    if (f) {
      // Arkadaşlık önce kalkar; kişi Çıkarılanlar'a DEĞİL Engellenenler'e düşer.
      delete st.friends[fid];
      if (st.globalMqtt) { try { st.globalMqtt.unsubscribe(`teamsync/user/${fid}/presence`); } catch (e) {} }
    }
    const before = (st.friendRequests || []).length;
    st.friendRequests = (st.friendRequests || []).filter(r => r.id !== fid);
    if (outgoing().some(r => r.id === fid)) {
      saveOutgoing(outgoing().filter(r => r.id !== fid));
      if (typeof window.clearOutgoingFriendRequest === 'function') window.clearOutgoingFriendRequest(fid);
    }
    if (f || before !== st.friendRequests.length) { if (typeof window.saveProfile === 'function') window.saveProfile(); }
    if (typeof window.renderFriends === 'function') window.renderFriends();
    toast(tr('friends.blockedToast', { name }), 'info');
    render();
  }

  function unblockUser(fid, quiet) {
    const who = nameOf(fid);
    if (!unblockRecord(fid)) return false;
    if (!quiet) toast(tr('friends.unblockedToast', { name: who }), 'ok');
    render();
    return true;
  }

  async function requestFriend(fid) {
    if (typeof window.sendFriendRequestTo !== 'function') return null;
    const res = await window.sendFriendRequestTo(fid);
    render();
    return res;
  }

  function setTab(next) {
    tab = TABS.includes(next) ? next : 'online';
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
    const listTab = tab === 'online' || tab === 'all';
    const peopleTab = tab === 'removed' || tab === 'blocked';
    $('friends-pane-list')?.classList.toggle('hidden', !listTab);
    $('friends-pane-people')?.classList.toggle('hidden', !peopleTab);
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
      const passesTab = li.dataset.temp !== '1' && (tab === 'online' ? li.dataset.online === '1' : true);
      if (passesTab && !miss) visible++;
    });
    const countKey = tab === 'online' ? 'friends.countOnline' : 'friends.countAll';
    const count = $('friends-count');
    if (count) count.textContent = tr(countKey, { n: visible });
    const empty = $('friends-empty');
    if (empty) {
      const emptyKey = q ? 'friends.emptySearch' : tab === 'online' ? 'friends.emptyOnline' : 'friends.emptyAll';
      empty.innerHTML = `<div class="friends-empty-art">${window.TSUI.GAMEPAD_SVG}</div><p>${esc(tr(emptyKey))}</p>`;
      empty.classList.toggle('hidden', visible > 0 || !listTab);
    }
    if (peopleTab) renderPeople();
    renderPending();
    renderActiveNow();
    renderBadges();
  }

  function fmtDate(ts) {
    try {
      const lang = document.documentElement.lang || undefined;
      return new Date(ts).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return new Date(ts).toLocaleDateString(); }
  }

  // Çıkarılanlar / Engellenenler sekmeleri
  function renderPeople() {
    const host = $('people-list');
    if (!host) return;
    const blocked = tab === 'blocked';
    const rows = (blocked ? blockedList() : removedList()).slice().sort((a, b) => ((b.blockedAt || b.removedAt || 0) - (a.blockedAt || a.removedAt || 0)));
    const count = $('people-count');
    if (count) count.textContent = tr(blocked ? 'friends.countBlocked' : 'friends.countRemoved', { n: rows.length });
    if (!rows.length) {
      host.innerHTML = `<li class="friends-empty people-empty"><div class="friends-empty-art">${ico(blocked ? 'shield' : 'userMinus', 40) || window.TSUI.GAMEPAD_SVG}</div><p>${esc(tr(blocked ? 'friends.emptyBlocked' : 'friends.emptyRemoved'))}</p></li>`;
      return;
    }
    const requested = new Set(outgoing().map(r => r.id));
    const btn = (act, icon, label, cls = '') => `<button type="button" class="people-btn ${cls}" data-p-act="${act}">${ico(icon, 15)}<span>${esc(label)}</span></button>`;
    host.innerHTML = rows.map(r => {
      const when = tr(blocked ? 'friends.blockedAt' : 'friends.removedAt', { date: fmtDate(blocked ? r.blockedAt : r.removedAt) });
      let actions;
      if (blocked) {
        actions = btn('unblock', 'unlock', tr('friends.unblock')) + btn('unblock-add', 'userPlus', tr('profile.addFriend'));
      } else {
        actions = (requested.has(r.fid)
          ? `<span class="people-state">${ico('clock', 14)}${esc(tr('friends.requestPending'))}</span>`
          : btn('readd', 'userPlus', tr('friends.readd'), 'is-pri'))
          + btn('block', 'ban', tr('friends.block'), 'is-danger')
          + `<button type="button" class="people-btn is-icon" data-p-act="forget" title="${esc(tr('friends.forget'))}" aria-label="${esc(tr('friends.forget'))}">${ico('x', 15)}</button>`;
      }
      return `
        <li class="people-item ${blocked ? 'is-blocked' : 'is-removed'}" data-fid="${esc(r.fid)}" data-name="${esc(r.name)}">
          ${window.TSUI.avatarHtml({ src: r.avatar, name: r.name, seed: r.fid, size: 36 })}
          <div class="people-copy"><b>${esc(r.name)}</b><small>${esc(when)} · ${esc(r.fid)}</small></div>
          <div class="people-actions">${actions}</div>
        </li>`;
    }).join('');
  }

  async function onPeopleClick(e) {
    const b = e.target.closest('[data-p-act]');
    const row = b && b.closest('.people-item');
    if (!row) return;
    const fid = row.dataset.fid;
    const name = row.dataset.name || fid;
    const act = b.dataset.pAct;
    if (act === 'forget') forgetRemoved(fid);
    else if (act === 'block') await confirmBlock(fid, name);
    else if (act === 'unblock') unblockUser(fid);
    else if (act === 'readd') { b.disabled = true; await requestFriend(fid); }
    else if (act === 'unblock-add') {
      if (!(await window.showConfirm(tr('friends.unblock'), tr('friends.unblockAddConfirm', { name }), { danger: false }))) return;
      unblockUser(fid, true);
      await requestFriend(fid);
    }
  }

  // Arkadaş satırındaki "..." menüsü (renderer.js renderFriends çağırır).
  function openRowMenu(fid, anchor) {
    const f = (window.state.friends || {})[fid];
    if (!f || !window.TSUI) return;
    const row = (icon, k, label, cls = '') => `<button type="button" class="ts-menu-row ${cls}" data-fmenu="${k}">${ico(icon, 18)}<span class="ts-menu-text"><span>${esc(label)}</span></span></button>`;
    const pop = window.TSUI.popover(`
      <div class="ts-menu ts-row-menu friend-row-menu" data-i18n-ignore>
        ${row('user', 'profile', tr('friends.viewProfile'))}
        ${row(f.isMuted ? 'bell' : 'bellOff', 'mute', tr(f.isMuted ? 'profile.unmute' : 'profile.mute'))}
        ${row('copy', 'copy', tr('status.copyId'))}
        <div class="ts-menu-sep"></div>
        ${row('userMinus', 'remove', tr('friends.removeTitle'), 'is-danger')}
        ${row('ban', 'block', tr('friends.block'), 'is-danger')}
      </div>`, anchor, { placement: 'bottom' });
    pop.el.addEventListener('click', e => {
      const b = e.target.closest('[data-fmenu]');
      if (!b) return;
      pop.close();
      const k = b.dataset.fmenu;
      if (k === 'profile' && window.TSProfile) window.TSProfile.showCard({ friendId: fid }, anchor);
      else if (k === 'mute' && typeof window.toggleMuteFriend === 'function') window.toggleMuteFriend(fid);
      else if (k === 'copy') window.TSUI.copyText(fid);
      else if (k === 'remove' && typeof window.removeFriend === 'function') window.removeFriend(fid);
      else if (k === 'block') confirmBlock(fid, f.name);
    });
  }

  function renderPending() {
    const host = $('pending-list');
    if (!host) return;
    const incoming = (window.state.friendRequests || []).map((r, idx) => ({ ...r, idx, dir: 'in' }));
    const out = outgoing().map(r => ({ ...r, dir: 'out', name: r.name || (window.state.friends[r.id] && window.state.friends[r.id].name) || r.id }));
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
    setBadge('rail-home-badge', dmUnread);
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
      else if (can) {
        const id = can.dataset.cancel;
        saveOutgoing(outgoing().filter(r => r.id !== id));
        if (typeof window.clearOutgoingFriendRequest === 'function') window.clearOutgoingFriendRequest(id);
        render();
      }
    });
    $('active-now-list')?.addEventListener('click', e => {
      const join = e.target.closest('[data-join]');
      if (join) { if (typeof window.requestJoinRoom === 'function') window.requestJoinRoom(join.dataset.join); return; }
      const card = e.target.closest('[data-fid]');
      if (card && window.TSProfile) window.TSProfile.showCard({ friendId: card.dataset.fid, placement: 'left' }, card);
    });
    $('people-list')?.addEventListener('click', e => { onPeopleClick(e).catch(() => {}); });
    $('add-friend-msg')?.addEventListener('click', e => {
      const b = e.target.closest('[data-afm]');
      if (!b) return;
      if (b.dataset.afm === 'pending') setTab('pending');
      else if (b.dataset.afm === 'unblock' && b.dataset.fid) {
        unblockUser(b.dataset.fid);
        showAddMessage('');
      }
    });
    const input = $('friend-id-input');
    input?.addEventListener('input', () => showAddMessage(''));
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-add-friend')?.click(); });
    // Yapıştırılan ID: boşluklar atılır, büyük harfe çevrilir ("knk-ab cd" → "KNK-ABCD").
    input?.addEventListener('paste', e => {
      const text = e.clipboardData && e.clipboardData.getData('text');
      if (!text) return;
      e.preventDefault();
      input.value = normalizeId(text);
      showAddMessage('');
    });
    document.addEventListener('ts:presence', () => { renderActiveNow(); });
    document.addEventListener('ts:blocklist', () => { if (tab === 'blocked' || tab === 'removed') render(); });
  }

  // "  knk-1a2b 3c4d " → "KNK-1A2B3C4D"; metin içinde bir KNK- kimliği varsa o alınır.
  function normalizeId(raw) {
    let s = String(raw || '').replace(/\s+/g, '').toUpperCase();
    const m = s.match(/KNK-[A-Z0-9_-]{3,124}/);
    if (m) s = m[0];
    return s;
  }

  document.addEventListener('DOMContentLoaded', bind);

  window.TSFriends = {
    render,
    afterRender: render,
    setTab,
    onFriendRequestSent,
    rememberOutgoing,
    dropOutgoing,
    outgoingIds: () => outgoing().map(r => r.id),
    wasRequested: id => outgoing().some(r => r.id === id),
    addFriendError: text => showAddMessage(text, 'error'),
    showAddMessage,
    normalizeId,
    renderBadges,
    openRowMenu,
    confirmBlock,
    unblockUser,
    recordRemoved,
    forgetRemoved,
    removedList,
    wasRemoved
  };

  // Engel listesi (yalnızca yerel). Kişisel olaylar renderer.js'te, herhangi bir
  // işleyiciden ÖNCE bununla süzülür; grup araması zili de bunu sorabilir.
  window.TSBlock = {
    isBlocked,
    list: () => blockedList().map(r => ({ ...r })),
    // Onaysız engelle: arkadaşsa arkadaşlığı da kaldırır (kullanıcı arayüzü confirmBlock kullanır).
    block: (fid, name) => {
      if (!ID_RE.test(fid || '') || fid === window.state.friendId) return false;
      applyBlock(fid, nameOf(fid, name));
      return true;
    },
    unblock: fid => unblockRecord(fid)
  };
})();
