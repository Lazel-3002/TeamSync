// Sunucu pencereleri: oluştur, davetle katıl, davet et (süre + kullanım
// sınırı), kanal oluştur / kanal ayarları (yavaş mod + kanal izinleri),
// sunucu ayarları (genel, roller, üyeler, davetler, yasaklar, barındırma) ve
// Sunucu Keşfet. Motor: js/space/servers.js
(function () {
  const esc = v => window.TSUI.esc(v);
  const tr = (k, v) => window.TSUI.tr(k, v);
  const X = () => window.TSServers;
  const SS = () => window.TSServerState;
  const UI = () => window.TSServerUI;
  const me = () => window.state.friendId;
  const P = () => SS().P;
  const DAY = 86400000;
  const EXPIRY = [[DAY, 'servers.exp1d'], [3 * DAY, 'servers.exp3d'], [7 * DAY, 'servers.exp7d'], [30 * DAY, 'servers.exp30d'], [0, 'servers.expNever']];
  const MAX_USES = [0, 1, 5, 10, 25, 50, 100];
  const PERM_ORDER = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'ADD_REACTIONS', 'CONNECT', 'CREATE_INVITE', 'MANAGE_MESSAGES', 'MANAGE_CHANNELS', 'MANAGE_ROLES', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MANAGE_SERVER', 'ADMINISTRATOR'];
  const ROLE_COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b'];
  const run = fn => UI().run(fn);

  const stOf = sid => { const rt = X().get(sid); return rt ? rt.st : null; };
  const can = (sid, bit, ch) => {
    const st = stOf(sid);
    return !!st && SS().has(ch ? SS().channelPerms(st, me(), ch) : SS().basePerms(st, me()), bit);
  };

  // ---------- genel pencere ----------
  function modal(inner, { cls = '', onClose } = {}) {
    const overlay = document.createElement('div');
    overlay.className = `srv-modal-overlay ${cls}`;
    overlay.setAttribute('data-i18n-ignore', '');
    overlay.innerHTML = `<div class="srv-modal" role="dialog" aria-modal="true">${inner}</div>`;
    document.body.appendChild(overlay);
    const onKey = e => {
      if (e.key !== 'Escape' || document.querySelector('.ts-popover, .emoji-ac:not(.hidden)')) return;
      if (overlay !== Array.from(document.querySelectorAll('.srv-modal-overlay')).pop()) return;
      e.stopPropagation();
      close();
    };
    const close = () => {
      if (!overlay.isConnected) return;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    overlay.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
    return { el: overlay.querySelector('.srv-modal'), overlay, close };
  }

  // Seçilen görseli ortadan kare kırpar, küçük bir webp/jpeg veri URL'sine çevirir
  // (sunucu simgesi kontrol olayıyla herkese kopyalanır: ≤ ~38 KB).
  async function fileToIcon(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('type');
    if (file.size > 10 * 1024 * 1024) throw new Error('size');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      for (const [size, q] of [[128, 0.85], [112, 0.75], [96, 0.7], [80, 0.6], [64, 0.55]]) {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        let out = c.toDataURL('image/webp', q);
        if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', q);
        if (out.length <= 38000) return out;
      }
      throw new Error('size');
    } finally { URL.revokeObjectURL(url); }
  }

  function iconPicker(current, name, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'srv-icon-pick';
    let value = current || '';
    const render = () => {
      wrap.innerHTML = `
        <label class="srv-icon-drop ${value ? 'has-icon' : ''}">
          ${value ? `<img src="${esc(value)}" alt="" />` : `<span class="srv-icon-drop-empty"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><small>${esc(tr('servers.upload'))}</small></span>`}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
        </label>
        ${value ? `<button type="button" class="srv-link-btn" data-icon-clear>${esc(tr('servers.removeIcon'))}</button>` : ''}`;
    };
    wrap.addEventListener('change', async e => {
      const input = e.target.closest('input[type=file]');
      if (!input || !input.files[0]) return;
      try { value = await fileToIcon(input.files[0]); render(); onChange(value); } catch (err) { window.showToast(tr('servers.iconError'), 'danger'); }
    });
    wrap.addEventListener('click', e => { if (e.target.closest('[data-icon-clear]')) { value = ''; render(); onChange(''); } });
    render();
    return wrap;
  }

  // ---------- sunucu oluştur ----------
  function openCreate() {
    let icon = '';
    const m = modal(`
      <button type="button" class="srv-modal-x" data-close aria-label="${esc(tr('common.close'))}">×</button>
      <div class="srv-modal-head">
        <h2>${esc(tr('servers.createTitle'))}</h2>
        <p>${esc(tr('servers.createLead'))}</p>
      </div>
      <div class="srv-modal-body">
        <div class="srv-create-icon"></div>
        <label class="srv-field"><span>${esc(tr('servers.serverName'))}</span><input type="text" class="srv-create-name" maxlength="60" /></label>
        <p class="srv-note">${esc(tr('servers.hostedNote'))}</p>
      </div>
      <div class="srv-modal-foot">
        <button type="button" class="btn-sec" data-close>${esc(tr('common.cancel'))}</button>
        <button type="button" class="btn-pri srv-create-go">${esc(tr('servers.createBtn'))}</button>
      </div>`, { cls: 'srv-create-modal' });
    const nameInput = m.el.querySelector('.srv-create-name');
    nameInput.value = tr('servers.defaultName', { name: window.state.myName || '' }).slice(0, 60);
    m.el.querySelector('.srv-create-icon').appendChild(iconPicker('', nameInput.value, v => { icon = v; }));
    const go = m.el.querySelector('.srv-create-go');
    const submit = async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      go.disabled = true;
      go.textContent = tr('servers.creating');
      const sid = await run(() => X().createServer({ name, icon }));
      if (!sid) { go.disabled = false; go.textContent = tr('servers.createBtn'); return; }
      m.close();
      window.TSShell.setView('server', sid);
      setTimeout(() => openInvite(sid), 250);
    };
    go.addEventListener('click', submit);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 30);
  }

  // ---------- davetle katıl ----------
  function openJoin(prefill) {
    const m = modal(`
      <button type="button" class="srv-modal-x" data-close aria-label="${esc(tr('common.close'))}">×</button>
      <div class="srv-modal-head">
        <h2>${esc(tr('servers.joinTitle'))}</h2>
        <p>${esc(tr('servers.joinLead'))}</p>
      </div>
      <div class="srv-modal-body">
        <label class="srv-field"><span>${esc(tr('servers.inviteLink'))}</span><input type="text" class="srv-join-input" placeholder="teamsync://invite/ABCDE23456" autocomplete="off" /></label>
        <div class="srv-join-examples">${esc(tr('servers.joinExamples'))}<code>teamsync://invite/ABCDE23456</code><code>ABCDE-23456</code></div>
        <div class="srv-join-preview"></div>
      </div>
      <div class="srv-modal-foot">
        <button type="button" class="btn-sec" data-close>${esc(tr('common.cancel'))}</button>
        <button type="button" class="btn-pri srv-join-go" disabled>${esc(tr('servers.joinBtn'))}</button>
      </div>`, { cls: 'srv-join-modal' });
    const input = m.el.querySelector('.srv-join-input');
    const preview = m.el.querySelector('.srv-join-preview');
    const go = m.el.querySelector('.srv-join-go');
    let code = null;
    let token = 0;
    const check = async () => {
      const c = X().parseInvite(input.value);
      if (c === code) return;
      code = c;
      go.disabled = true;
      if (!c) { preview.innerHTML = input.value.trim() ? `<div class="srv-join-err">${esc(tr('servers.inviteBadFormat'))}</div>` : ''; return; }
      const my = ++token;
      preview.innerHTML = `<div class="srv-join-wait">${esc(tr('servers.inviteLooking'))}</div>`;
      try {
        const info = await X().peekInvite(c);
        if (my !== token) return;
        preview.innerHTML = `
          <div class="srv-join-card">
            <span class="srv-join-icon">${UI().serverIconHtml(info.name, info.icon, 56, info.sid)}</span>
            <span><strong>${esc(info.name)}</strong><small><i class="inv-dot is-online"></i>${esc(tr('servers.onlineCount', { n: info.online }))} <i class="inv-dot"></i>${esc(tr('servers.memberCount', { n: info.members }))}</small>${info.desc ? `<em>${esc(info.desc)}</em>` : ''}</span>
          </div>`;
        go.disabled = false;
      } catch (e) {
        if (my !== token) return;
        preview.innerHTML = `<div class="srv-join-err">${esc(tr(e && e.reason === 'invite' ? 'servers.errInvite' : 'servers.inviteNotFound'))}</div>`;
      }
    };
    input.addEventListener('input', check);
    const submit = async () => {
      if (!code || go.disabled) return;
      go.disabled = true;
      go.textContent = tr('servers.joining');
      const sid = await run(() => X().joinWithInvite(code));
      if (!sid) { go.disabled = false; go.textContent = tr('servers.joinBtn'); return; }
      m.close();
      window.TSShell.setView('server', sid);
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    if (prefill) { input.value = prefill; check(); }
    setTimeout(() => input.focus(), 30);
  }

  // ---------- davet et ----------
  function reusableInvite(st) {
    const now = Date.now();
    return SS().liveInvites(st, now).filter(i => i.by === me() && !i.pub && !i.max && i.exp && i.exp - now > 3 * DAY)
      .sort((a, b) => b.exp - a.exp)[0] || null;
  }

  function expiryText(inv) {
    if (!inv.exp) return tr('servers.inviteNeverExpires');
    const left = inv.exp - Date.now();
    const days = Math.max(1, Math.round(left / DAY));
    return left < DAY ? tr('servers.inviteExpiresHours', { n: Math.max(1, Math.round(left / 3600000)) }) : tr('servers.inviteExpiresDays', { n: days });
  }

  function openInvite(sid, ch) {
    const st = stOf(sid);
    if (!st) return;
    const chName = ch && st.channels[ch] ? st.channels[ch].name : '';
    const m = modal(`
      <button type="button" class="srv-modal-x" data-close aria-label="${esc(tr('common.close'))}">×</button>
      <div class="srv-modal-head srv-modal-head-left">
        <h2>${esc(tr('servers.inviteTitle', { name: st.name }))}</h2>
        ${chName ? `<p class="srv-invite-ch"># ${esc(chName)}</p>` : ''}
      </div>
      <div class="srv-modal-body">
        <input type="text" class="srv-invite-search" placeholder="${esc(tr('servers.searchFriends'))}" />
        <ul class="srv-invite-friends"></ul>
        <div class="srv-field-label">${esc(tr('servers.orSendLink'))}</div>
        <div class="srv-invite-link"><input type="text" readonly value="${esc(tr('servers.creatingInvite'))}" /><button type="button" class="btn-pri btn-sm" data-copy disabled>${esc(tr('servers.copy'))}</button></div>
        <div class="srv-invite-meta"><span class="srv-invite-exp"></span> <button type="button" class="srv-link-btn" data-edit-inv>${esc(tr('servers.editInvite'))}</button></div>
        <div class="srv-invite-edit hidden">
          <label class="srv-field"><span>${esc(tr('servers.expireAfter'))}</span><select class="srv-inv-exp">${EXPIRY.map(([ms, k]) => `<option value="${ms}" ${ms === 7 * DAY ? 'selected' : ''}>${esc(tr(k))}</option>`).join('')}</select></label>
          <label class="srv-field"><span>${esc(tr('servers.maxUses'))}</span><select class="srv-inv-max">${MAX_USES.map(n => `<option value="${n}">${n ? esc(tr('servers.usesN', { n })) : esc(tr('servers.usesUnlimited'))}</option>`).join('')}</select></label>
          <button type="button" class="btn-pri btn-sm" data-new-inv>${esc(tr('servers.generateLink'))}</button>
        </div>
      </div>`, { cls: 'srv-invite-modal' });
    let invite = reusableInvite(st);
    const linkInput = m.el.querySelector('.srv-invite-link input');
    const copyBtn = m.el.querySelector('[data-copy]');
    const setInvite = inv => {
      invite = inv;
      linkInput.value = inv ? X().inviteLink(inv.code) : '';
      copyBtn.disabled = !inv;
      m.el.querySelector('.srv-invite-exp').textContent = inv ? `${expiryText(inv)}${inv.max ? ` · ${tr('servers.usesLeft', { n: inv.max - inv.uses })}` : ''}` : '';
      renderFriends();
    };
    const make = async (expMs, max) => {
      linkInput.value = tr('servers.creatingInvite');
      copyBtn.disabled = true;
      const code = await run(() => X().createInvite(sid, { expMs, max }));
      const fresh = code && stOf(sid) && stOf(sid).invites[code];
      if (fresh) setInvite(fresh);
      else { linkInput.value = X().isOnline(sid) ? tr('servers.errGeneric') : tr('servers.errOffline'); }
    };
    const invited = new Set();
    const renderFriends = () => {
      const q = (m.el.querySelector('.srv-invite-search').value || '').toLocaleLowerCase('tr');
      const members = stOf(sid) ? stOf(sid).members : {};
      const friends = Object.entries(window.state.friends || {}).filter(([fid, f]) => f && f.name && !f.temporary && !members[fid])
        .filter(([fid, f]) => !q || f.name.toLocaleLowerCase('tr').includes(q) || fid.toLowerCase().includes(q))
        .sort((a, b) => (b[1].online ? 1 : 0) - (a[1].online ? 1 : 0) || a[1].name.localeCompare(b[1].name, 'tr'));
      m.el.querySelector('.srv-invite-friends').innerHTML = friends.length ? friends.map(([fid, f]) => `
        <li class="srv-invite-row">
          ${window.TSUI.avatarHtml({ src: f.avatar, name: f.name, seed: fid, size: 32, status: window.TSStatus ? window.TSStatus.statusOf(fid) : null })}
          <span class="srv-invite-name">${esc(f.name)}</span>
          <button type="button" class="btn-sec btn-sm ${invited.has(fid) ? 'is-done' : ''}" data-invite-fid="${esc(fid)}" ${!invite || invited.has(fid) ? 'disabled' : ''}>${esc(invited.has(fid) ? tr('servers.invited') : tr('servers.inviteBtn'))}</button>
        </li>`).join('') : `<li class="srv-invite-empty">${esc(tr('servers.noFriendsToInvite'))}</li>`;
    };
    m.el.querySelector('.srv-invite-search').addEventListener('input', renderFriends);
    m.el.addEventListener('click', async e => {
      const inv = e.target.closest('[data-invite-fid]');
      if (inv && invite) {
        const fid = inv.dataset.inviteFid;
        invited.add(fid);
        renderFriends();
        const ok = window.sendDMTextTo && await window.sendDMTextTo(fid, X().inviteLink(invite.code));
        if (!ok) { invited.delete(fid); renderFriends(); window.showToast(tr('servers.errNetwork'), 'danger'); }
        return;
      }
      if (e.target.closest('[data-copy]') && invite) {
        window.TSUI.copyText(X().inviteLink(invite.code));
        copyBtn.textContent = tr('servers.copied');
        setTimeout(() => { copyBtn.textContent = tr('servers.copy'); }, 1500);
        return;
      }
      if (e.target.closest('[data-edit-inv]')) { m.el.querySelector('.srv-invite-edit').classList.toggle('hidden'); return; }
      if (e.target.closest('[data-new-inv]')) {
        m.el.querySelector('.srv-invite-edit').classList.add('hidden');
        make(Number(m.el.querySelector('.srv-inv-exp').value), Number(m.el.querySelector('.srv-inv-max').value));
      }
    });
    if (!can(sid, P().CREATE_INVITE)) { linkInput.value = tr('servers.errPerm'); renderFriends(); }
    else if (invite) setInvite(invite);
    else { renderFriends(); make(7 * DAY, 0); }
  }

  // ---------- kanal oluştur ----------
  function openCreateChannel(sid, kind = 'text') {
    const st = stOf(sid);
    if (!st) return;
    const roles = SS().sortedRoles(st).filter(r => r.id !== SS().EVERYONE);
    const canPrivate = can(sid, P().MANAGE_ROLES);
    const m = modal(`
      <button type="button" class="srv-modal-x" data-close aria-label="${esc(tr('common.close'))}">×</button>
      <div class="srv-modal-head srv-modal-head-left"><h2>${esc(tr('servers.createChannel'))}</h2></div>
      <div class="srv-modal-body">
        <div class="srv-field-label">${esc(tr('servers.channelType'))}</div>
        <label class="srv-kind"><input type="radio" name="srv-kind" value="text" ${kind !== 'voice' ? 'checked' : ''} /><span class="srv-kind-icon">#</span><span><strong>${esc(tr('servers.kindText'))}</strong><small>${esc(tr('servers.kindTextDesc'))}</small></span></label>
        <label class="srv-kind"><input type="radio" name="srv-kind" value="voice" ${kind === 'voice' ? 'checked' : ''} /><span class="srv-kind-icon">🔊</span><span><strong>${esc(tr('servers.kindVoice'))}</strong><small>${esc(tr('servers.kindVoiceDesc'))}</small></span></label>
        <label class="srv-field"><span>${esc(tr('servers.channelName'))}</span><input type="text" class="srv-ch-name" maxlength="40" placeholder="${esc(tr('servers.newChannelPh'))}" /></label>
        ${canPrivate ? `
          <label class="srv-switch-row"><span><strong>🔒 ${esc(tr('servers.privateChannel'))}</strong><small>${esc(tr('servers.privateChannelDesc'))}</small></span><input type="checkbox" class="srv-ch-private" /></label>
          <div class="srv-private-roles hidden">${roles.length ? roles.map(r => `<label class="srv-check"><input type="checkbox" value="${esc(r.id)}" /><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</label>`).join('') : `<small class="srv-note">${esc(tr('servers.privateNoRoles'))}</small>`}</div>` : ''}
      </div>
      <div class="srv-modal-foot">
        <button type="button" class="btn-sec" data-close>${esc(tr('common.cancel'))}</button>
        <button type="button" class="btn-pri srv-ch-go">${esc(tr('servers.createChannelBtn'))}</button>
      </div>`);
    const name = m.el.querySelector('.srv-ch-name');
    m.el.querySelector('.srv-ch-private')?.addEventListener('change', e => m.el.querySelector('.srv-private-roles').classList.toggle('hidden', !e.target.checked));
    const go = m.el.querySelector('.srv-ch-go');
    const submit = async () => {
      const k = m.el.querySelector('input[name=srv-kind]:checked').value;
      const n = SS().channelName(name.value || tr(k === 'voice' ? 'servers.defaultVoice' : 'servers.newChannelPh'), k);
      if (!n) { name.focus(); return; }
      let overrides;
      if (m.el.querySelector('.srv-ch-private')?.checked) {
        overrides = { everyone: { a: 0, d: P().VIEW_CHANNEL }, [`u:${me()}`]: { a: P().VIEW_CHANNEL, d: 0 } };
        m.el.querySelectorAll('.srv-private-roles input:checked').forEach(cb => { overrides[cb.value] = { a: P().VIEW_CHANNEL, d: 0 }; });
      }
      go.disabled = true;
      const ok = await run(() => X().createChannel(sid, { name: n, kind: k, overrides }));
      if (ok) m.close(); else go.disabled = false;
    };
    go.addEventListener('click', submit);
    name.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    setTimeout(() => name.focus(), 30);
  }

  // ---------- kanal ayarları ----------
  const SLOW_LABEL = s => (s === 0 ? tr('servers.slowOff') : s < 60 ? tr('servers.seconds', { n: s }) : s < 3600 ? tr('servers.minutes', { n: s / 60 }) : tr('servers.hours', { n: s / 3600 }));

  function openChannelSettings(sid, chId) {
    const st0 = stOf(sid);
    const ch0 = st0 && st0.channels[chId];
    if (!ch0) return;
    const canPerms = can(sid, P().MANAGE_ROLES);
    const draft = JSON.parse(JSON.stringify(ch0.overrides || {}));
    const cols = ch0.kind === 'voice' ? ['VIEW_CHANNEL', 'CONNECT'] : ['VIEW_CHANNEL', 'SEND_MESSAGES', 'ADD_REACTIONS', 'MANAGE_MESSAGES'];
    const m = modal(`
      <button type="button" class="srv-modal-x" data-close aria-label="${esc(tr('common.close'))}">×</button>
      <div class="srv-modal-head srv-modal-head-left"><h2>${ch0.kind === 'voice' ? '🔊' : '#'} ${esc(ch0.name)}</h2><p>${esc(tr('servers.channelSettings'))}</p></div>
      <div class="srv-modal-body">
        <label class="srv-field"><span>${esc(tr('servers.channelName'))}</span><input type="text" class="srv-cs-name" maxlength="40" value="${esc(ch0.name)}" /></label>
        ${ch0.kind === 'text' ? `
          <label class="srv-field"><span>${esc(tr('servers.channelTopic'))}</span><textarea class="srv-cs-topic" maxlength="300" rows="2">${esc(ch0.topic || '')}</textarea></label>
          <label class="srv-field"><span>${esc(tr('servers.slowMode'))}</span><select class="srv-cs-slow">${SS().SLOW_STEPS.map(s => `<option value="${s}" ${s === ch0.slow ? 'selected' : ''}>${esc(SLOW_LABEL(s))}</option>`).join('')}</select><small>${esc(tr('servers.slowModeDesc'))}</small></label>` : ''}
        ${canPerms ? `<div class="srv-field-label">${esc(tr('servers.channelPerms'))}</div><p class="srv-note">${esc(tr('servers.channelPermsDesc'))}</p><div class="srv-perm-grid"></div>
          <div class="srv-perm-add"><select class="srv-perm-add-sel"></select></div>` : ''}
        <div class="srv-cs-move">
          <button type="button" class="btn-sec btn-sm" data-move="up">↑ ${esc(tr('servers.moveUp'))}</button>
          <button type="button" class="btn-sec btn-sm" data-move="down">↓ ${esc(tr('servers.moveDown'))}</button>
          <button type="button" class="btn-sec btn-sm is-danger" data-delete-ch>${esc(tr('servers.deleteChannel'))}</button>
        </div>
      </div>
      <div class="srv-modal-foot">
        <button type="button" class="btn-sec" data-close>${esc(tr('common.cancel'))}</button>
        <button type="button" class="btn-pri srv-cs-save">${esc(tr('servers.save'))}</button>
      </div>`, { cls: 'srv-chset-modal' });

    const state3 = (key, perm) => {
      const o = draft[key];
      const bit = P()[perm];
      if (!o) return 0;
      if (o.a & bit) return 1;
      if (o.d & bit) return -1;
      return 0;
    };
    const labelOf = key => {
      const st = stOf(sid);
      if (key === SS().EVERYONE) return { name: '@everyone', color: '' };
      if (key.startsWith('u:')) return { name: `👤 ${X().memberName(sid, key.slice(2))}`, color: '' };
      const r = st && st.roles[key];
      return { name: r ? r.name : key, color: r ? r.color : '' };
    };
    const renderGrid = () => {
      const grid = m.el.querySelector('.srv-perm-grid');
      if (!grid) return;
      grid.style.setProperty('--cols', cols.length);
      const st = stOf(sid);
      const keys = [SS().EVERYONE, ...SS().sortedRoles(st).filter(r => r.id !== SS().EVERYONE && draft[r.id]).map(r => r.id), ...Object.keys(draft).filter(k => k.startsWith('u:'))];
      grid.innerHTML = `
        <div class="srv-perm-row srv-perm-headrow"><span></span>${cols.map(c => `<span class="srv-perm-colhead">${esc(tr(`servers.permShort.${c}`))}</span>`).join('')}<span></span></div>
        ${keys.map(k => {
          const l = labelOf(k);
          return `<div class="srv-perm-row" data-key="${esc(k)}">
            <span class="srv-perm-who"${l.color ? ` style="color:${esc(l.color)}"` : ''}>${esc(l.name)}</span>
            ${cols.map(c => { const v = state3(k, c); return `<button type="button" class="srv-tri ${v === 1 ? 'is-allow' : v === -1 ? 'is-deny' : ''}" data-perm="${c}" title="${esc(tr(v === 1 ? 'servers.allow' : v === -1 ? 'servers.deny' : 'servers.inherit'))}">${v === 1 ? '✓' : v === -1 ? '✕' : '/'}</button>`; }).join('')}
            ${k !== SS().EVERYONE ? `<button type="button" class="srv-perm-rm" data-rm-key title="${esc(tr('servers.remove'))}">×</button>` : '<span></span>'}
          </div>`;
        }).join('')}`;
      const sel = m.el.querySelector('.srv-perm-add-sel');
      if (sel) {
        const addable = SS().sortedRoles(st).filter(r => r.id !== SS().EVERYONE && !draft[r.id]);
        const people = Object.values(st.members).filter(mm => !draft[`u:${mm.fid}`]).slice(0, 100);
        sel.innerHTML = `<option value="">＋ ${esc(tr('servers.addRoleOrMember'))}</option>${addable.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}${people.map(p => `<option value="u:${esc(p.fid)}">👤 ${esc(X().memberName(sid, p.fid))}</option>`).join('')}`;
      }
    };
    m.el.addEventListener('click', async e => {
      const tri = e.target.closest('.srv-tri');
      if (tri) {
        const key = tri.closest('[data-key]').dataset.key;
        const bit = P()[tri.dataset.perm];
        const o = draft[key] || { a: 0, d: 0 };
        const cur = o.a & bit ? 1 : o.d & bit ? -1 : 0;
        const next = cur === 0 ? 1 : cur === 1 ? -1 : 0;
        o.a &= ~bit; o.d &= ~bit;
        if (next === 1) o.a |= bit; else if (next === -1) o.d |= bit;
        draft[key] = o;
        renderGrid();
        return;
      }
      const rm = e.target.closest('[data-rm-key]');
      if (rm) { delete draft[rm.closest('[data-key]').dataset.key]; renderGrid(); return; }
      const mv = e.target.closest('[data-move]');
      if (mv) { run(() => X().moveChannel(sid, chId, mv.dataset.move)); return; }
      if (e.target.closest('[data-delete-ch]')) {
        if (await window.showConfirm(tr('servers.deleteChannel'), tr('servers.deleteChannelConfirm', { name: ch0.name }))) {
          const ok = await run(() => X().deleteChannel(sid, chId));
          if (ok) m.close();
        }
      }
    });
    m.el.querySelector('.srv-perm-add-sel')?.addEventListener('change', e => {
      if (e.target.value) { draft[e.target.value] = { a: 0, d: 0 }; renderGrid(); }
    });
    m.el.querySelector('.srv-cs-save').addEventListener('click', async () => {
      const st = stOf(sid);
      const ch = st && st.channels[chId];
      if (!ch) { m.close(); return; }
      const patch = {};
      const n = SS().channelName(m.el.querySelector('.srv-cs-name').value, ch.kind);
      if (n && n !== ch.name) patch.name = n;
      const topic = m.el.querySelector('.srv-cs-topic');
      if (topic && topic.value.trim() !== (ch.topic || '')) patch.topic = topic.value.trim();
      const slow = m.el.querySelector('.srv-cs-slow');
      if (slow && Number(slow.value) !== ch.slow) patch.slow = Number(slow.value);
      if (canPerms) {
        const clean = {};
        Object.entries(draft).forEach(([k, o]) => { if (o.a || o.d) clean[k] = o; });
        if (JSON.stringify(clean) !== JSON.stringify(ch.overrides || {})) patch.overrides = clean;
      }
      if (!Object.keys(patch).length) { m.close(); return; }
      const ok = await run(() => X().updateChannel(sid, chId, patch));
      if (ok) { m.close(); window.showToast(tr('servers.saved'), 'ok'); }
    });
    renderGrid();
  }

  // ---------- sunucu ayarları ----------
  function openSettings(sid, tab) {
    if (!stOf(sid)) return;
    const overlay = document.createElement('div');
    overlay.className = 'srv-settings';
    overlay.setAttribute('data-i18n-ignore', '');
    document.body.appendChild(overlay);
    let current = tab || null;
    let roleSel = null;
    let roleDraft = null;
    let overviewDraft = null;
    let memberQuery = '';

    const tabs = () => {
      const st = stOf(sid);
      const list = [];
      if (can(sid, P().MANAGE_SERVER)) list.push(['overview', tr('servers.tabOverview')]);
      if (can(sid, P().MANAGE_ROLES)) list.push(['roles', tr('servers.tabRoles')]);
      if (can(sid, P().KICK_MEMBERS) || can(sid, P().BAN_MEMBERS) || can(sid, P().MANAGE_ROLES)) list.push(['members', tr('servers.tabMembers')]);
      if (can(sid, P().CREATE_INVITE) || can(sid, P().MANAGE_SERVER)) list.push(['invites', tr('servers.tabInvites')]);
      if (can(sid, P().BAN_MEMBERS)) list.push(['bans', tr('servers.tabBans')]);
      list.push(['hosting', tr('servers.tabHosting')]);
      if (st && st.owner === me()) list.push(['delete', tr('servers.deleteServer'), 'is-danger']);
      return list;
    };

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('ts:server', onServer);
    };
    const onKey = e => {
      if (e.key !== 'Escape' || document.querySelector('.ts-popover, .srv-modal-overlay')) return;
      e.stopPropagation();
      close();
    };
    const onServer = e => {
      const d = e.detail || {};
      if (d.sid !== sid) return;
      if (d.removed || !stOf(sid)) { close(); return; }
      if (d.ctl || d.online) render(true);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('ts:server', onServer);

    function render(fromEvent) {
      const st = stOf(sid);
      if (!st) { close(); return; }
      const list = tabs();
      if (!current || !list.some(([k]) => k === current)) current = list[0][0];
      if (fromEvent && (current === 'overview' && overviewDraft && overviewDraft.dirty)) return;
      if (fromEvent && current === 'roles' && roleDraft && roleDraft.dirty) return;
      overlay.innerHTML = `
        <nav class="srv-set-nav">
          <div class="srv-set-nav-inner">
            <div class="srv-set-nav-title">${esc(st.name)}</div>
            ${list.map(([k, label, cls]) => `<button type="button" class="srv-set-tab ${k === current ? 'active' : ''} ${cls || ''}" data-tab="${k}">${esc(label)}</button>`).join('')}
          </div>
        </nav>
        <main class="srv-set-main"><div class="srv-set-content">${content(st)}</div></main>
        <button type="button" class="srv-set-close" data-set-close><span>×</span><small>ESC</small></button>`;
      after(st);
    }

    function content(st) {
      switch (current) {
        case 'overview': return overviewHtml(st);
        case 'roles': return rolesHtml(st);
        case 'members': return membersHtml(st);
        case 'invites': return invitesHtml(st);
        case 'bans': return bansHtml(st);
        case 'hosting': return hostingHtml(st);
        case 'delete': return deleteHtml(st);
        default: return '';
      }
    }

    // --- genel bakış ---
    function overviewHtml(st) {
      if (!overviewDraft) overviewDraft = { name: st.name, desc: st.desc || '', icon: st.icon || '', public: !!st.public, dirty: false };
      return `
        <h2>${esc(tr('servers.tabOverview'))}</h2>
        <div class="srv-ov">
          <div class="srv-ov-icon"></div>
          <div class="srv-ov-fields">
            <label class="srv-field"><span>${esc(tr('servers.serverName'))}</span><input type="text" class="srv-ov-name" maxlength="60" value="${esc(overviewDraft.name)}" /></label>
            <label class="srv-field"><span>${esc(tr('servers.description'))}</span><textarea class="srv-ov-desc" maxlength="300" rows="3" placeholder="${esc(tr('servers.descriptionPh'))}">${esc(overviewDraft.desc)}</textarea></label>
          </div>
        </div>
        <label class="srv-switch-row"><span><strong>${esc(tr('servers.publicTitle'))}</strong><small>${esc(tr('servers.publicDesc'))}</small></span><input type="checkbox" class="srv-ov-public" ${overviewDraft.public ? 'checked' : ''} /></label>
        <div class="srv-save-bar ${overviewDraft.dirty ? '' : 'hidden'}"><span>${esc(tr('servers.unsaved'))}</span><button type="button" class="srv-link-btn" data-ov-reset>${esc(tr('servers.reset'))}</button><button type="button" class="btn-pri btn-sm" data-ov-save>${esc(tr('servers.save'))}</button></div>`;
    }

    // --- roller ---
    function rolesHtml(st) {
      const roles = SS().sortedRoles(st);
      if (!roleSel || !st.roles[roleSel]) roleSel = roles[0] ? roles[0].id : null;
      const role = st.roles[roleSel];
      if (role && (!roleDraft || roleDraft.id !== role.id)) roleDraft = { id: role.id, name: role.name, color: role.color, hoist: role.hoist, perms: role.perms, dirty: false };
      const editable = role && SS().canManageRole(st, me(), role.id);
      const counts = {};
      Object.values(st.members).forEach(mm => mm.roles.forEach(r => { counts[r] = (counts[r] || 0) + 1; }));
      const permRows = PERM_ORDER.map(name => {
        const bit = P()[name];
        const on = !!(roleDraft && (roleDraft.perms & bit));
        const grantable = SS().permsGrantable(st, me(), bit);
        return `<label class="srv-switch-row srv-perm-switch ${!editable || !grantable ? 'is-locked' : ''}"><span><strong>${esc(tr(`servers.perm.${name}`))}</strong><small>${esc(tr(`servers.permDesc.${name}`))}</small></span><input type="checkbox" data-perm-bit="${bit}" ${on ? 'checked' : ''} ${!editable || !grantable ? 'disabled' : ''} /></label>`;
      }).join('');
      return `
        <h2>${esc(tr('servers.tabRoles'))}</h2>
        <p class="srv-note">${esc(tr('servers.rolesLead'))}</p>
        <div class="srv-roles">
          <div class="srv-roles-list">
            <button type="button" class="btn-pri btn-sm srv-role-new" data-role-new>${esc(tr('servers.createRole'))}</button>
            ${roles.map(r => `<button type="button" class="srv-role-item ${r.id === roleSel ? 'active' : ''}" data-role-sel="${esc(r.id)}"><i style="background:${esc(r.color || '#99aab5')}"></i><span>${esc(r.name)}</span><small>${r.id === SS().EVERYONE ? '' : counts[r.id] || 0}</small></button>`).join('')}
          </div>
          <div class="srv-role-edit">
            ${role ? `
              ${!editable ? `<p class="srv-warn">${esc(tr('servers.roleLocked'))}</p>` : ''}
              ${role.id !== SS().EVERYONE ? `
                <label class="srv-field"><span>${esc(tr('servers.roleName'))}</span><input type="text" class="srv-role-name" maxlength="32" value="${esc(roleDraft.name)}" ${editable ? '' : 'disabled'} /></label>
                <div class="srv-field-label">${esc(tr('servers.roleColor'))}</div>
                <div class="srv-colors">${['', ...ROLE_COLORS].map(c => `<button type="button" class="srv-color ${roleDraft.color === c ? 'active' : ''}" data-color="${c}" style="background:${c || '#99aab5'}" ${editable ? '' : 'disabled'} title="${c || tr('servers.defaultColor')}"></button>`).join('')}<input type="color" class="srv-color-custom" value="${esc(roleDraft.color || '#99aab5')}" ${editable ? '' : 'disabled'} /></div>
                <label class="srv-switch-row"><span><strong>${esc(tr('servers.roleHoist'))}</strong><small>${esc(tr('servers.roleHoistDesc'))}</small></span><input type="checkbox" class="srv-role-hoist" ${roleDraft.hoist ? 'checked' : ''} ${editable ? '' : 'disabled'} /></label>` : `<p class="srv-note">${esc(tr('servers.everyoneDesc'))}</p>`}
              <div class="srv-field-label">${esc(tr('servers.permissions'))}</div>
              ${permRows}
              ${role.id !== SS().EVERYONE && editable ? `
                <div class="srv-role-actions">
                  <button type="button" class="btn-sec btn-sm" data-role-move="up">↑ ${esc(tr('servers.moveUp'))}</button>
                  <button type="button" class="btn-sec btn-sm" data-role-move="down">↓ ${esc(tr('servers.moveDown'))}</button>
                  <button type="button" class="btn-sec btn-sm is-danger" data-role-delete>${esc(tr('servers.deleteRole'))}</button>
                </div>` : ''}` : ''}
          </div>
        </div>
        <div class="srv-save-bar ${roleDraft && roleDraft.dirty ? '' : 'hidden'}"><span>${esc(tr('servers.unsaved'))}</span><button type="button" class="srv-link-btn" data-role-reset>${esc(tr('servers.reset'))}</button><button type="button" class="btn-pri btn-sm" data-role-save>${esc(tr('servers.save'))}</button></div>`;
    }

    // --- üyeler ---
    function membersHtml(st) {
      const q = memberQuery.toLocaleLowerCase('tr');
      const members = Object.values(st.members).filter(mm => !q || X().memberName(sid, mm.fid).toLocaleLowerCase('tr').includes(q) || mm.fid.toLowerCase().includes(q))
        .sort((a, b) => a.joinedAt - b.joinedAt);
      return `
        <h2>${esc(tr('servers.tabMembers'))} <small>${Object.keys(st.members).length}</small></h2>
        <input type="text" class="srv-member-search" placeholder="${esc(tr('servers.searchMembers'))}" value="${esc(memberQuery)}" />
        <ul class="srv-set-members">${members.map(mm => {
          const roles = SS().memberRoles(st, mm.fid);
          const acts = [];
          if (mm.fid !== me() && SS().outranks(st, me(), mm.fid)) {
            if (can(sid, P().KICK_MEMBERS)) acts.push(`<button type="button" class="btn-sec btn-sm is-danger" data-m-kick="${esc(mm.fid)}">${esc(tr('servers.kick'))}</button>`);
            if (can(sid, P().BAN_MEMBERS)) acts.push(`<button type="button" class="btn-sec btn-sm is-danger" data-m-ban="${esc(mm.fid)}">${esc(tr('servers.ban'))}</button>`);
          }
          return `<li class="srv-set-member" data-fid="${esc(mm.fid)}">
            ${window.TSUI.avatarHtml({ src: (X().memberPresence(sid, mm.fid) || {}).av, name: X().memberName(sid, mm.fid), seed: mm.fid, size: 36 })}
            <span class="srv-set-member-copy"><strong${SS().memberColor(st, mm.fid) ? ` style="color:${esc(SS().memberColor(st, mm.fid))}"` : ''}>${esc(X().memberName(sid, mm.fid))}${mm.fid === st.owner ? ' 👑' : ''}</strong><small>${esc(mm.fid)} · ${esc(tr('servers.memberSince', { date: new Date(mm.joinedAt).toLocaleDateString() }))}</small>
              <span class="srv-card-roles">${roles.map(r => `<span class="srv-role-chip"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</span>`).join('')}</span></span>
            <span class="srv-set-member-acts"><button type="button" class="btn-sec btn-sm" data-m-card="${esc(mm.fid)}">${esc(tr('servers.manage'))}</button>${acts.join('')}</span>
          </li>`;
        }).join('')}</ul>`;
    }

    // --- davetler ---
    function invitesHtml(st) {
      const now = Date.now();
      const manage = can(sid, P().MANAGE_SERVER);
      const live = SS().liveInvites(st, now).sort((a, b) => b.at - a.at);
      return `
        <h2>${esc(tr('servers.tabInvites'))}</h2>
        <p class="srv-note">${esc(tr('servers.invitesLead'))}</p>
        ${can(sid, P().CREATE_INVITE) ? `<button type="button" class="btn-pri btn-sm" data-inv-new>${esc(tr('servers.createInvite'))}</button>` : ''}
        <table class="srv-table">
          <thead><tr><th>${esc(tr('servers.inviter'))}</th><th>${esc(tr('servers.inviteCode'))}</th><th>${esc(tr('servers.uses'))}</th><th>${esc(tr('servers.expires'))}</th><th></th></tr></thead>
          <tbody>${live.length ? live.map(inv => {
            const mine = inv.by === me();
            const visible = mine || manage;
            return `<tr>
              <td>${esc(X().memberName(sid, inv.by))}</td>
              <td><code>${visible ? esc(inv.code) : '••••••••••'}</code>${inv.pub ? ` <span class="srv-pill">${esc(tr('servers.publicPill'))}</span>` : ''}</td>
              <td>${inv.uses}${inv.max ? ` / ${inv.max}` : ''}</td>
              <td>${esc(expiryText(inv))}</td>
              <td>${visible ? `<button type="button" class="srv-link-btn" data-inv-copy="${esc(inv.code)}">${esc(tr('servers.copy'))}</button>` : ''}${mine || manage ? ` <button type="button" class="srv-link-btn is-danger" data-inv-revoke="${esc(inv.code)}">${esc(tr('servers.revoke'))}</button>` : ''}</td>
            </tr>`;
          }).join('') : `<tr><td colspan="5" class="srv-table-empty">${esc(tr('servers.noInvites'))}</td></tr>`}</tbody>
        </table>`;
    }

    // --- yasaklar ---
    function bansHtml(st) {
      const bans = Object.values(st.bans).sort((a, b) => b.at - a.at);
      return `
        <h2>${esc(tr('servers.tabBans'))} <small>${bans.length}</small></h2>
        <ul class="srv-set-members">${bans.length ? bans.map(b => `
          <li class="srv-set-member">
            ${window.TSUI.avatarHtml({ name: b.name || b.fid, seed: b.fid, size: 36 })}
            <span class="srv-set-member-copy"><strong>${esc(b.name || b.fid)}</strong><small>${esc(b.fid)} · ${esc(new Date(b.at).toLocaleDateString())} · ${esc(tr('servers.bannedBy', { name: X().memberName(sid, b.by) }))}</small>${b.reason ? `<em>${esc(b.reason)}</em>` : ''}</span>
            <span class="srv-set-member-acts"><button type="button" class="btn-sec btn-sm" data-unban="${esc(b.fid)}">${esc(tr('servers.unban'))}</button></span>
          </li>`).join('') : `<li class="srv-table-empty">${esc(tr('servers.noBans'))}</li>`}</ul>`;
    }

    // --- barındırma ---
    function hostingHtml(st) {
      const online = new Set(X().onlineHosts(sid));
      const isOwner = st.owner === me();
      const rt = X().get(sid);
      const candidates = Object.values(st.members).filter(mm => !st.hosts.includes(mm.fid) && !st.hostOffers.includes(mm.fid));
      const approxMb = rt ? ((rt.count * 700 + rt.ctl.length * 900) / 1048576) : 0;
      return `
        <h2>${esc(tr('servers.tabHosting'))}</h2>
        <p class="srv-note">${esc(tr('servers.hostingLead'))}</p>
        <div class="srv-host-status ${online.size ? 'is-up' : 'is-down'}">
          <strong>${esc(online.size ? tr('servers.hostingUp', { n: online.size }) : tr('servers.hostingDown'))}</strong>
          <small>${esc(tr('servers.hostingMax', { n: SS().LIMITS.hosts }))}</small>
        </div>
        <div class="srv-field-label">${esc(tr('servers.hosts'))}</div>
        <ul class="srv-set-members">${st.hosts.map(h => `
          <li class="srv-set-member">
            ${window.TSUI.avatarHtml({ src: (X().memberPresence(sid, h) || {}).av, name: X().memberName(sid, h), seed: h, size: 36, status: online.has(h) ? 'online' : 'offline' })}
            <span class="srv-set-member-copy"><strong>${esc(X().memberName(sid, h))}</strong><small>${esc(h === st.owner ? tr('servers.ownerHost') : tr('servers.coHost'))} · ${esc(online.has(h) ? tr('servers.onlineNow') : tr('servers.offlineNow'))}</small></span>
            <span class="srv-set-member-acts">
              ${isOwner && h !== st.owner ? `<button type="button" class="btn-sec btn-sm is-danger" data-host-revoke="${esc(h)}">${esc(tr('servers.removeHost'))}</button>` : ''}
              ${h === me() && !isOwner ? `<button type="button" class="btn-sec btn-sm is-danger" data-host-resign>${esc(tr('servers.resignHost'))}</button>` : ''}
            </span>
          </li>`).join('')}
          ${st.hostOffers.map(h => `
          <li class="srv-set-member is-pending">
            ${window.TSUI.avatarHtml({ name: X().memberName(sid, h), seed: h, size: 36 })}
            <span class="srv-set-member-copy"><strong>${esc(X().memberName(sid, h))}</strong><small>${esc(tr('servers.offerPending'))}</small></span>
            <span class="srv-set-member-acts">${isOwner ? `<button type="button" class="btn-sec btn-sm" data-host-revoke="${esc(h)}">${esc(tr('servers.cancelOffer'))}</button>` : ''}${h === me() ? `<button type="button" class="btn-pri btn-sm" data-host-accept>${esc(tr('servers.accept'))}</button>` : ''}</span>
          </li>`).join('')}
        </ul>
        ${isOwner && st.hosts.length + st.hostOffers.length < SS().LIMITS.hosts ? `
          <div class="srv-host-offer">
            <select class="srv-host-cand"><option value="">${esc(tr('servers.pickMember'))}</option>${candidates.map(mm => `<option value="${esc(mm.fid)}">${esc(X().memberName(sid, mm.fid))}</option>`).join('')}</select>
            <button type="button" class="btn-pri btn-sm" data-host-offer-send>${esc(tr('servers.offerHost'))}</button>
          </div>` : ''}
        <div class="srv-field-label">${esc(tr('servers.thisComputer'))}</div>
        <p class="srv-note">${esc(X().isHost(sid) ? tr('servers.storageHost', { n: rt ? rt.count : 0, mb: approxMb.toFixed(1) }) : tr('servers.storageMember', { n: rt ? rt.count : 0 }))}</p>`;
    }

    function deleteHtml(st) {
      return `
        <h2>${esc(tr('servers.deleteServer'))}</h2>
        <p class="srv-warn">${esc(tr('servers.deleteLead', { name: st.name }))}</p>
        <label class="srv-field"><span>${esc(tr('servers.typeName'))}</span><input type="text" class="srv-del-confirm" placeholder="${esc(st.name)}" /></label>
        <button type="button" class="btn-pri btn-danger" data-delete-go disabled>${esc(tr('servers.deleteServer'))}</button>`;
    }

    function after(st) {
      if (current === 'overview') {
        const host = overlay.querySelector('.srv-ov-icon');
        host.appendChild(iconPicker(overviewDraft.icon, overviewDraft.name, v => { overviewDraft.icon = v; markOv(); }));
      }
      if (current === 'members') {
        const input = overlay.querySelector('.srv-member-search');
        input.addEventListener('input', () => {
          memberQuery = input.value;
          const pos = input.selectionStart;
          render();
          const again = overlay.querySelector('.srv-member-search');
          again.focus();
          again.setSelectionRange(pos, pos);
        });
      }
      if (current === 'delete') {
        const input = overlay.querySelector('.srv-del-confirm');
        input.addEventListener('input', () => { overlay.querySelector('[data-delete-go]').disabled = input.value.trim() !== st.name; });
      }
    }

    function markOv() {
      overviewDraft.dirty = true;
      overlay.querySelector('.srv-save-bar')?.classList.remove('hidden');
    }
    function markRole() {
      roleDraft.dirty = true;
      overlay.querySelector('.srv-save-bar')?.classList.remove('hidden');
    }

    overlay.addEventListener('input', e => {
      if (e.target.matches('.srv-ov-name')) { overviewDraft.name = e.target.value; markOv(); }
      else if (e.target.matches('.srv-ov-desc')) { overviewDraft.desc = e.target.value; markOv(); }
      else if (e.target.matches('.srv-role-name')) { roleDraft.name = e.target.value; markRole(); }
      else if (e.target.matches('.srv-color-custom')) { roleDraft.color = e.target.value; markRole(); overlay.querySelectorAll('.srv-color').forEach(b => b.classList.remove('active')); }
    });
    overlay.addEventListener('change', e => {
      if (e.target.matches('.srv-ov-public')) { overviewDraft.public = e.target.checked; markOv(); }
      else if (e.target.matches('.srv-role-hoist')) { roleDraft.hoist = e.target.checked; markRole(); }
      else if (e.target.matches('[data-perm-bit]')) {
        const bit = Number(e.target.dataset.permBit);
        if (e.target.checked) roleDraft.perms |= bit; else roleDraft.perms &= ~bit;
        markRole();
      }
    });
    overlay.addEventListener('click', async e => {
      const st = stOf(sid);
      if (!st) return;
      if (e.target.closest('[data-set-close]')) { close(); return; }
      const t = e.target.closest('[data-tab]');
      if (t) {
        if ((overviewDraft && overviewDraft.dirty) || (roleDraft && roleDraft.dirty)) {
          if (!(await window.showConfirm(tr('servers.unsavedTitle'), tr('servers.unsavedBody')))) return;
        }
        current = t.dataset.tab;
        overviewDraft = null;
        roleDraft = null;
        render();
        return;
      }
      // genel bakış
      if (e.target.closest('[data-ov-reset]')) { overviewDraft = null; render(); return; }
      if (e.target.closest('[data-ov-save]')) {
        const d = overviewDraft;
        const patch = {};
        if (d.name.trim() && d.name.trim() !== st.name) patch.name = d.name.trim();
        if (d.desc.trim() !== (st.desc || '')) patch.desc = d.desc.trim();
        if (d.icon !== (st.icon || '')) patch.icon = d.icon;
        let ok = true;
        if (Object.keys(patch).length) ok = !!(await run(() => X().updateServer(sid, patch)));
        if (ok && d.public !== !!st.public) ok = (await run(() => X().setPublic(sid, d.public))) !== null;
        if (ok) { overviewDraft = null; render(); window.showToast(tr('servers.saved'), 'ok'); }
        return;
      }
      // roller
      const sel = e.target.closest('[data-role-sel]');
      if (sel) {
        if (roleDraft && roleDraft.dirty && !(await window.showConfirm(tr('servers.unsavedTitle'), tr('servers.unsavedBody')))) return;
        roleSel = sel.dataset.roleSel;
        roleDraft = null;
        render();
        return;
      }
      if (e.target.closest('[data-role-new]')) {
        const ok = await run(() => X().createRole(sid, { name: tr('servers.newRole'), color: '', perms: SS().DEFAULT_EVERYONE & SS().basePerms(st, me()), hoist: false }));
        if (ok) { const fresh = SS().sortedRoles(stOf(sid)).find(r => r.pos === 1); roleSel = fresh ? fresh.id : roleSel; roleDraft = null; render(); }
        return;
      }
      const color = e.target.closest('[data-color]');
      if (color && roleDraft) {
        roleDraft.color = color.dataset.color;
        overlay.querySelectorAll('.srv-color').forEach(b => b.classList.toggle('active', b === color));
        markRole();
        return;
      }
      if (e.target.closest('[data-role-reset]')) { roleDraft = null; render(); return; }
      if (e.target.closest('[data-role-save]')) {
        const role = st.roles[roleDraft.id];
        if (!role) return;
        const patch = {};
        if (role.id !== SS().EVERYONE) {
          if (roleDraft.name.trim() && roleDraft.name.trim() !== role.name) patch.name = roleDraft.name.trim();
          if (roleDraft.color !== role.color) patch.color = roleDraft.color;
          if (roleDraft.hoist !== role.hoist) patch.hoist = roleDraft.hoist;
        }
        if (roleDraft.perms !== role.perms) patch.perms = roleDraft.perms;
        if (Object.keys(patch).length) {
          const ok = await run(() => X().updateRole(sid, role.id, patch));
          if (!ok) return;
          window.showToast(tr('servers.saved'), 'ok');
        }
        roleDraft = null;
        render();
        return;
      }
      const mv = e.target.closest('[data-role-move]');
      if (mv) { run(() => X().moveRole(sid, roleSel, mv.dataset.roleMove)); return; }
      if (e.target.closest('[data-role-delete]')) {
        const role = st.roles[roleSel];
        if (role && await window.showConfirm(tr('servers.deleteRole'), tr('servers.deleteRoleConfirm', { name: role.name }))) {
          const ok = await run(() => X().deleteRole(sid, role.id));
          if (ok) { roleSel = null; roleDraft = null; render(); }
        }
        return;
      }
      // üyeler
      const card = e.target.closest('[data-m-card]');
      if (card) { UI().openMemberCard(sid, card.dataset.mCard, card); return; }
      const kick = e.target.closest('[data-m-kick]');
      if (kick) {
        const name = X().memberName(sid, kick.dataset.mKick);
        if (await window.showConfirm(tr('servers.kick'), tr('servers.kickConfirm', { name }))) run(() => X().kick(sid, kick.dataset.mKick));
        return;
      }
      const ban = e.target.closest('[data-m-ban]');
      if (ban) {
        const name = X().memberName(sid, ban.dataset.mBan);
        const reason = await window.showPrompt(tr('servers.ban'), tr('servers.banConfirm', { name }), '', tr('servers.banReason'));
        if (reason != null) run(() => X().ban(sid, ban.dataset.mBan, reason));
        return;
      }
      // davetler
      if (e.target.closest('[data-inv-new]')) { openInvite(sid); return; }
      const copy = e.target.closest('[data-inv-copy]');
      if (copy) { window.TSUI.copyText(X().inviteLink(copy.dataset.invCopy)); return; }
      const revoke = e.target.closest('[data-inv-revoke]');
      if (revoke) { run(() => X().revokeInvite(sid, revoke.dataset.invRevoke)); return; }
      // yasaklar
      const unban = e.target.closest('[data-unban]');
      if (unban) { run(() => X().unban(sid, unban.dataset.unban)); return; }
      // barındırma
      const hr = e.target.closest('[data-host-revoke]');
      if (hr) { run(() => X().revokeHost(sid, hr.dataset.hostRevoke)); return; }
      if (e.target.closest('[data-host-resign]')) {
        if (await window.showConfirm(tr('servers.resignHost'), tr('servers.resignConfirm'))) run(() => X().resignHost(sid));
        return;
      }
      if (e.target.closest('[data-host-accept]')) { run(() => X().acceptHost(sid)); return; }
      if (e.target.closest('[data-host-offer-send]')) {
        const fid = overlay.querySelector('.srv-host-cand').value;
        if (fid) run(() => X().offerHost(sid, fid)).then(ok => { if (ok) window.showToast(tr('servers.offerHostSent', { name: X().memberName(sid, fid) }), 'ok'); });
        return;
      }
      // sil
      if (e.target.closest('[data-delete-go]')) {
        const ok = await run(() => X().deleteServer(sid));
        if (ok) close();
      }
    });
    render();
  }

  // ---------- Sunucu Keşfet ----------
  function openDiscover() {
    const m = modal(`
      <button type="button" class="srv-modal-x" data-close aria-label="${esc(tr('common.close'))}">×</button>
      <div class="srv-discover-hero">
        <h2>${esc(tr('servers.discoverTitle'))}</h2>
        <p>${esc(tr('servers.discoverLead'))}</p>
        <input type="text" class="srv-discover-search" placeholder="${esc(tr('servers.discoverSearch'))}" />
      </div>
      <div class="srv-discover-list"><div class="srv-discover-wait"><span class="srv-spinner"></span>${esc(tr('servers.discoverLoading'))}</div></div>
      <div class="srv-discover-foot"><button type="button" class="srv-link-btn" data-refresh>${esc(tr('servers.refresh'))}</button> · <button type="button" class="srv-link-btn" data-join-code>${esc(tr('servers.haveInvite'))}</button></div>`, { cls: 'srv-discover-modal' });
    let results = [];
    const render = () => {
      const q = (m.el.querySelector('.srv-discover-search').value || '').toLocaleLowerCase('tr');
      const list = results.filter(r => !q || r.name.toLocaleLowerCase('tr').includes(q) || (r.desc || '').toLocaleLowerCase('tr').includes(q));
      const mine = new Set(X().list().map(s => s.name));
      m.el.querySelector('.srv-discover-list').innerHTML = list.length ? list.map(r => `
        <div class="srv-discover-card">
          <span class="srv-discover-icon">${UI().serverIconHtml(r.name, r.icon, 56, r.code)}</span>
          <span class="srv-discover-copy"><strong>${esc(r.name)}</strong>${r.desc ? `<em>${esc(r.desc)}</em>` : ''}<small><i class="inv-dot is-online"></i>${esc(tr('servers.onlineCount', { n: r.online }))} <i class="inv-dot"></i>${esc(tr('servers.memberCount', { n: r.members }))}</small></span>
          <button type="button" class="btn-pri btn-sm" data-dcode="${esc(r.code)}">${esc(mine.has(r.name) ? tr('servers.open') : tr('servers.joinShort'))}</button>
        </div>`).join('') : `<div class="srv-discover-empty">${esc(results.length ? tr('servers.discoverNoMatch') : tr('servers.discoverEmpty'))}</div>`;
    };
    const load = async () => {
      m.el.querySelector('.srv-discover-list').innerHTML = `<div class="srv-discover-wait"><span class="srv-spinner"></span>${esc(tr('servers.discoverLoading'))}</div>`;
      try { results = await X().discover(); } catch (e) { results = []; }
      if (m.overlay.isConnected) render();
    };
    m.el.querySelector('.srv-discover-search').addEventListener('input', render);
    m.el.addEventListener('click', async e => {
      if (e.target.closest('[data-refresh]')) { load(); return; }
      if (e.target.closest('[data-join-code]')) { m.close(); openJoin(); return; }
      const b = e.target.closest('[data-dcode]');
      if (!b) return;
      b.disabled = true;
      b.textContent = tr('servers.joining');
      const sid = await run(() => X().joinWithInvite(b.dataset.dcode));
      if (sid) { m.close(); window.TSShell.setView('server', sid); } else { b.disabled = false; b.textContent = tr('servers.joinShort'); }
    });
    load();
    setTimeout(() => m.el.querySelector('.srv-discover-search').focus(), 30);
  }

  // ---------- teamsync://invite/... bağlantıları (electron/deep-link.js) ----------
  let pendingLink = null;
  function handleLink(link) {
    if (!link || !X() || !X().parseInvite(link)) return;
    if (window.TSShell && window.TSShell.isActive()) openJoin(link);
    else pendingLink = link; // giriş yapılınca açılır (flushPendingLink)
  }
  function flushPendingLink() {
    if (!pendingLink) return;
    const link = pendingLink;
    pendingLink = null;
    setTimeout(() => openJoin(link), 600);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const api = window.electronAPI;
    if (!api || typeof api.onDeepLink !== 'function') return;
    api.onDeepLink(handleLink);
    api.takeDeepLink().then(handleLink).catch(() => {});
  });

  window.TSServerDialogs = { openCreate, openJoin, openInvite, openCreateChannel, openChannelSettings, openSettings, openDiscover, fileToIcon, flushPendingLink };
})();
