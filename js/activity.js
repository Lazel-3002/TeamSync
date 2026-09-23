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
    const s = lastState || await refreshState() || { enabled: true, custom: [], hidden: [] };
    const cur = current;
    const hidden = new Set(s.hidden || []);
    const customRows = (s.custom || []).map(g => `
      <div class="act-game-row" data-id="${esc(g.id)}">
        <span class="act-game-icon">${window.TSUI.GAMEPAD_SVG}</span>
        <div class="act-game-copy"><strong>${esc(g.name)}</strong><small>${esc(g.exe)}</small></div>
        <button type="button" class="btn-sec btn-sm act-toggle-hidden" data-hid="custom:${esc(g.id)}">${esc(tr(hidden.has(`custom:${g.id}`) ? 'activity.show' : 'activity.hide'))}</button>
        <button type="button" class="btn-sec btn-sm act-remove" data-id="${esc(g.id)}">${esc(tr('activity.removeGame'))}</button>
      </div>`).join('');
    const hiddenOthers = (s.hidden || []).filter(id => !id.startsWith('custom:'));
    const hiddenRows = hiddenOthers.map(id => `
      <div class="act-game-row muted-row">
        <span class="act-game-icon">${window.TSUI.GAMEPAD_SVG}</span>
        <div class="act-game-copy"><strong>${esc(id.replace(/^(steam|epic|known):/, ''))}</strong><small>${esc(id)}</small></div>
        <button type="button" class="btn-sec btn-sm act-toggle-hidden" data-hid="${esc(id)}">${esc(tr('activity.show'))}</button>
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
          <button type="button" class="btn-sec btn-sm act-toggle-hidden" data-hid="${esc(cur.id)}">${esc(tr('activity.hide'))}</button>
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
        ${customRows || hiddenRows ? customRows + hiddenRows : `<p class="muted">${esc(tr('activity.registeredEmpty'))}</p>`}
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
    root.querySelectorAll('.act-toggle-hidden').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.hid;
      const isHidden = (lastState && lastState.hidden || []).includes(id);
      lastState = await api.activitySetHidden(id, !isHidden) || lastState;
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
