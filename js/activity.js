// "Oynuyor" — renderer tarafı. Main süreçteki algılayıcı (electron/
// activity-detector.js) çalışan oyunu bildirir; burada presence'a eklenir,
// kullanıcı panelinde gösterilir ve Ayarlar > Oyun Etkinliği sayfası çizilir.
(function () {
  const api = window.electronAPI || {};
  const available = typeof api.activityGetState === 'function';
  let current = null;   // { id, name, source, steamAppId, startedAt, icon }
  let enabled = true;
  let lastState = null;
  let injected = false;

  const emit = () => document.dispatchEvent(new CustomEvent('ts:activity'));

  function sanitize(a) {
    if (!a || typeof a !== 'object' || typeof a.name !== 'string' || !a.name.trim()) return null;
    const startedAt = Number(a.startedAt);
    return {
      id: String(a.id || a.name),
      name: a.name.trim().slice(0, 80),
      source: a.source || 'custom',
      steamAppId: Number.isInteger(a.steamAppId) && a.steamAppId > 0 ? a.steamAppId : 0,
      startedAt: Number.isFinite(startedAt) && startedAt > 0 && startedAt <= Date.now() + 60000 ? startedAt : Date.now(),
      icon: typeof a.icon === 'string' && a.icon.startsWith('data:image/png;base64,') ? a.icon : ''
    };
  }

  const keyOf = a => (a ? `${a.id}|${a.startedAt}` : '');

  function setCurrent(a) {
    const next = sanitize(a);
    if (keyOf(next) === keyOf(current)) return;
    current = next;
    window.state.myActivity = current;
    if (typeof window.publishPresence === 'function') window.publishPresence();
    if (window.TSTiles) window.TSTiles.update('self');
    emit();
    if (isSettingsOpen()) renderSettings();
  }

  // Presence alanı: yalnızca oyunun adı, Steam appid'si ve geçen süre.
  function presenceField() {
    if (!current || !enabled) return null;
    const out = { k: 'play', n: current.name, el: Math.max(0, Date.now() - current.startedAt) };
    if (current.steamAppId) out.sid = current.steamAppId;
    return out;
  }

  // Kendi görünümüm için (kullanıcı paneli, kendi profil kartım).
  function mine() {
    if (!current || !enabled) return null;
    return { n: current.name, sid: current.steamAppId, startLocal: current.startedAt, icon: current.icon };
  }

  async function refreshState() {
    if (!available) return null;
    try {
      const s = await api.activityGetState();
      if (!s) return null;
      lastState = s;
      enabled = s.enabled !== false;
      if (!injected) setCurrent(s.current);
      return s;
    } catch (e) { return null; }
  }

  if (available) {
    try { api.onActivityChanged(a => { if (!injected) setCurrent(a); }); } catch (e) {}
    // Gizli oyun başlayınca/kapanınca Ayarlar sayfası güncel kalsın.
    try {
      api.onActivityState?.(s => {
        if (!s) return;
        lastState = s;
        if (isSettingsOpen()) renderSettings();
      });
    } catch (e) {}
    document.addEventListener('DOMContentLoaded', () => { setTimeout(refreshState, 1500); });
  }

  // ---------- Ayarlar > Oyun Etkinliği ----------
  function isSettingsOpen() {
    const panel = document.querySelector('[data-settings-content="activity"]');
    const modal = document.getElementById('settings-modal');
    return !!(panel && panel.classList.contains('active') && modal && !modal.classList.contains('hidden'));
  }

  function sourceLabel(source) {
    const { tr } = window.TSUI;
    return tr({ steam: 'activity.sourceSteam', epic: 'activity.sourceEpic', known: 'activity.sourceKnown' }[source] || 'activity.sourceCustom');
  }

  async function renderSettings() {
    const root = document.getElementById('settings-activity-root');
    if (!root) return;
    const { esc, tr, gameArtHtml, sinceHtml } = window.TSUI;
    if (!available) {
      root.innerHTML = `<div class="settings-card"><p>${esc(tr('activity.unavailable'))}</p></div>`;
      return;
    }
    // Ayarlar açılışında her zaman taze durum okunur: eski önbellekle
    // (ya da hiç durum yokken) gizle/göster yanlış yöne çevriliyordu.
    const s = await refreshState() || lastState || { enabled: true, custom: [], hidden: [], hiddenGames: [] };
    const cur = current;
    const hidden = new Set(s.hidden || []);
    // Eski main süreçten gelen durum yalnızca kimlik dizisi taşıyabilir.
    const hiddenGames = Array.isArray(s.hiddenGames) ? s.hiddenGames : (s.hidden || []).map(id => ({ id, name: '', steamAppId: 0 }));
    const hiddenCur = !cur && s.hiddenCurrent ? s.hiddenCurrent : null;
    const toggleBtn = (id, isHidden, name) => `<button type="button" class="btn-sec btn-sm act-toggle-hidden" data-hid="${esc(id)}" data-action="${isHidden ? 'show' : 'hide'}" data-name="${esc(name || '')}">${esc(tr(isHidden ? 'activity.show' : 'activity.hide'))}</button>`;
    const customRows = (s.custom || []).map(g => `
      <div class="act-game-row" data-id="${esc(g.id)}">
        <span class="act-game-icon">${window.TSUI.GAMEPAD_SVG}</span>
        <div class="act-game-copy"><strong>${esc(g.name)}</strong><small>${esc(g.exe)}${hidden.has(`custom:${g.id}`) ? ` · ${esc(tr('activity.hiddenBadge'))}` : ''}</small></div>
        ${toggleBtn(`custom:${g.id}`, hidden.has(`custom:${g.id}`), g.name)}
        <button type="button" class="btn-sec btn-sm act-remove" data-id="${esc(g.id)}">${esc(tr('activity.removeGame'))}</button>
      </div>`).join('');
    const sourceOf = id => (String(id).match(/^(steam|epic|known|custom):/) || [])[1] || 'custom';
    const hiddenRows = hiddenGames.map(h => `
      <div class="act-game-row act-hidden-row" data-hidden-id="${esc(h.id)}">
        ${gameArtHtml({ sid: h.steamAppId || 0 }, 36)}
        <div class="act-game-copy">
          <strong>${esc(h.name || tr('activity.hiddenUnknown'))}</strong>
          <small>${esc(sourceLabel(sourceOf(h.id)))}${h.name ? '' : ` · ${esc(tr('activity.hiddenIdLabel', { id: h.id }))}`}</small>
        </div>
        ${toggleBtn(h.id, true, h.name)}
      </div>`).join('');

    root.innerHTML = `
      <div class="settings-card settings-row">
        <div>
          <strong>${esc(tr('activity.enable'))}</strong>
          <p>${esc(tr('activity.enableDesc'))}</p>
        </div>
        <label class="switch"><input type="checkbox" id="act-enabled" ${s.enabled !== false ? 'checked' : ''}><span class="slider round"></span></label>
      </div>
      <h3 class="settings-section-title">${esc(tr('activity.current'))}</h3>
      <div class="settings-card act-current ${cur ? 'has-game' : ''}">
        ${cur ? `
          ${gameArtHtml({ sid: cur.steamAppId, icon: cur.icon }, 64)}
          <div class="act-current-copy">
            <strong>${esc(cur.name)}</strong>
            <small>${esc(sourceLabel(cur.source))}</small>
            <span class="act-current-time">${window.TSUI.GAMEPAD_SVG} ${sinceHtml(cur.startedAt)}</span>
          </div>
          ${toggleBtn(cur.id, false, cur.name)}
        ` : hiddenCur ? `
          ${gameArtHtml({ sid: hiddenCur.steamAppId || 0, icon: hiddenCur.icon || '' }, 64)}
          <div class="act-current-copy">
            <strong>${esc(hiddenCur.name)}</strong>
            <small>${esc(tr('activity.hiddenRunning'))}</small>
            <span class="act-hidden-pill">${window.TSUI.icon ? window.TSUI.icon('eyeOff', 13) : ''} ${esc(tr('activity.hiddenBadge'))}</span>
          </div>
          ${toggleBtn(hiddenCur.id, true, hiddenCur.name)}
        ` : `
          <span class="ts-game-art" style="--gs:64px"><span class="ts-game-fallback">${window.TSUI.GAMEPAD_SVG}</span></span>
          <div class="act-current-copy"><strong>${esc(tr('activity.none'))}</strong><small>${esc(tr('activity.noneDesc'))}</small></div>
        `}
      </div>
      <h3 class="settings-section-title">${esc(tr('activity.addTitle'))}</h3>
      <div class="settings-card act-add">
        <select id="act-add-pick"><option value="">${esc(tr('activity.addPick'))}</option></select>
        <input id="act-add-name" type="text" maxlength="80" placeholder="${esc(tr('activity.addName'))}" />
        <button type="button" class="btn-pri" id="act-add-btn">${esc(tr('activity.add'))}</button>
      </div>
      <h3 class="settings-section-title">${esc(tr('activity.registered'))}</h3>
      <div class="settings-card act-list">
        ${customRows || `<p class="muted">${esc(tr('activity.registeredEmpty'))}</p>`}
      </div>
      <h3 class="settings-section-title">${esc(tr('activity.hiddenTitle'))}</h3>
      <div class="settings-card act-list act-hidden-list" id="act-hidden-list">
        ${hiddenRows || `<p class="muted">${esc(tr('activity.hiddenEmpty'))}</p>`}
      </div>
      <div class="act-footer">
        <button type="button" class="btn-sec" id="act-rescan">${esc(tr('activity.rescan'))}</button>
        <span class="muted" id="act-rescan-status">${s.gameCount ? esc(tr('activity.rescanDone', { n: s.gameCount })) : ''}</span>
      </div>`;

    root.querySelector('#act-enabled').addEventListener('change', async e => {
      const next = await api.activitySetEnabled(e.target.checked);
      if (next) { lastState = next; enabled = next.enabled !== false; }
      if (!enabled) setCurrent(null);
      if (typeof window.publishPresence === 'function') window.publishPresence();
      emit();
    });
    // Yön düğmenin kendisinden okunur (data-action); lastState henüz
    // gelmemişken "göster" tıklaması oyunu yeniden gizliyordu.
    root.querySelectorAll('.act-toggle-hidden').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      const hide = btn.dataset.action === 'hide';
      lastState = await api.activitySetHidden(btn.dataset.hid, hide, btn.dataset.name || '') || lastState;
      renderSettings();
    }));
    root.querySelectorAll('.act-remove').forEach(btn => btn.addEventListener('click', async () => {
      lastState = await api.activityRemoveCustom(btn.dataset.id) || lastState;
      renderSettings();
    }));
    root.querySelector('#act-rescan').addEventListener('click', async () => {
      const status = root.querySelector('#act-rescan-status');
      status.textContent = tr('activity.rescanning');
      const next = await api.activityRescan();
      if (next) {
        lastState = next;
        status.textContent = tr('activity.rescanDone', { n: next.gameCount || 0 });
      }
    });
    const pick = root.querySelector('#act-add-pick');
    const nameInput = root.querySelector('#act-add-name');
    let running = [];
    pick.addEventListener('focus', async () => {
      if (running.length) return;
      try { running = await api.activityListRunning() || []; } catch (e) { running = []; }
      running.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.exe;
        opt.textContent = `${r.title || r.exe} — ${r.exe}`;
        opt.dataset.title = r.title || r.exe.replace(/\.exe$/i, '');
        opt.dataset.path = r.path || '';
        pick.appendChild(opt);
      });
    }, { once: false });
    pick.addEventListener('change', () => {
      const opt = pick.selectedOptions[0];
      if (opt && opt.value && !nameInput.value.trim()) nameInput.value = opt.dataset.title || '';
    });
    root.querySelector('#act-add-btn').addEventListener('click', async () => {
      const opt = pick.selectedOptions[0];
      if (!opt || !opt.value) return;
      const name = nameInput.value.trim() || opt.dataset.title || opt.value;
      lastState = await api.activityAddCustom({ exe: opt.value, name, path: opt.dataset.path }) || lastState;
      renderSettings();
    });
  }

  window.TSActivity = {
    presenceField,
    mine,
    renderSettings,
    refresh: refreshState,
    isEnabled: () => enabled,
    // E2E: sahte oyun enjekte et / temizle (null)
    _inject(fake) {
      injected = !!fake;
      setCurrent(fake ? { id: `test:${fake.name}`, source: 'custom', ...fake } : null);
    }
  };
})();
