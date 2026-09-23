// "Yazıyor…" göstergesi. Her kişi kendi fiilini gönderir (profil düzenleyicideki
// "Yazıyor efekti": "mırlıyor 🐱", "havlıyor 🐶"...), karşı taraf onu gösterir:
// "Lazel mırlıyor 🐱…". En fazla 3 sn'de bir sinyal, 6 sn gösterim; görünmezken
// hiç gönderilmez.
//   1:1  → teamsync/user/<arkadaş>/events  { type:'dm_typing', fromId, name, tv }
//   grup → grubun şifreli geçici konusu      { t:'typing', tv } (js/space/groups.js)
(function () {
  const SEND_EVERY = 3000;
  const SHOW_FOR = 6000;
  const typers = {};     // scope -> { fid: { name, tv, until } }
  const lastSent = {};   // scope -> ms
  const renderers = {};  // scope-prefix -> () => void

  function sanitizeVerb(v) {
    if (typeof v !== 'string') return '';
    return Array.from(v.replace(/[\r\n<>]+/g, ' ').trim()).slice(0, 24).join('');
  }

  function myVerb() {
    const v = window.TSProfile ? window.TSProfile.mine().typingVerb : '';
    return sanitizeVerb(v);
  }

  function canSend() {
    return !(window.TSStatus && window.TSStatus.isInvisible());
  }

  // Yerel giriş alanı değişti → gerekirse sinyal gönder.
  function localActivity(scope, sendFn) {
    if (!canSend()) return;
    const now = Date.now();
    if (now - (lastSent[scope] || 0) < SEND_EVERY) return;
    lastSent[scope] = now;
    try { sendFn(myVerb()); } catch (e) {}
  }

  function localSent(scope) {
    lastSent[scope] = 0;
  }

  function remoteTyping(scope, fid, name, tv) {
    if (!fid) return;
    (typers[scope] = typers[scope] || {})[fid] = {
      name: String(name || '?').slice(0, 40),
      tv: sanitizeVerb(tv),
      until: Date.now() + SHOW_FOR
    };
    render(scope);
  }

  function remoteStopped(scope, fid) {
    if (typers[scope] && typers[scope][fid]) {
      delete typers[scope][fid];
      render(scope);
    }
  }

  function active(scope) {
    const now = Date.now();
    const map = typers[scope] || {};
    return Object.entries(map).filter(([, v]) => v.until > now).map(([fid, v]) => ({ fid, ...v }));
  }

  function text(scope) {
    const list = active(scope);
    if (!list.length) return '';
    const tr = window.TSUI.tr;
    const parts = list.slice(0, 3).map(p => `${p.name} ${p.tv || tr('typing.default')}`);
    const more = list.length > 3 ? ` ${tr('typing.more', { n: list.length - 3 })}` : '';
    return `${parts.join(', ')}${more}…`;
  }

  function render(scope) {
    Object.entries(renderers).forEach(([prefix, fn]) => { if (scope.startsWith(prefix)) fn(); });
  }

  // Görünümler kendi satırlarını kaydeder (örn. 'dm:' → DM görünümü).
  function onRender(prefix, fn) { renderers[prefix] = fn; }

  // Süresi dolan göstergeleri temizle.
  setInterval(() => {
    const now = Date.now();
    Object.keys(typers).forEach(scope => {
      const map = typers[scope];
      let changed = false;
      Object.keys(map).forEach(fid => { if (map[fid].until <= now) { delete map[fid]; changed = true; } });
      if (changed) render(scope);
    });
  }, 1000);

  // ---------- 1:1 DM ----------
  function sendDmTyping(fid) {
    localActivity(`dm:${fid}`, tv => {
      const client = window.state.globalMqtt;
      if (!client || !client.connected || !fid) return;
      client.publish(`teamsync/user/${fid}/events`, JSON.stringify({ type: 'dm_typing', fromId: window.state.friendId, name: window.state.myName, tv }));
    });
  }

  function onDmTypingEvent(data) {
    const fid = data && data.fromId;
    if (typeof fid !== 'string' || !window.state.friends[fid] || window.state.friends[fid].isMuted) return;
    remoteTyping(`dm:${fid}`, fid, window.state.friends[fid].name || data.name, data.tv);
  }

  function bindDm() {
    const input = document.getElementById('dm-input');
    if (!input) return;
    input.addEventListener('input', () => {
      const fid = window.state.activeDM;
      if (fid && input.value.trim()) sendDmTyping(fid);
    });
    const line = document.createElement('div');
    line.id = 'dm-typing';
    line.className = 'typing-line';
    line.setAttribute('data-i18n-ignore', '');
    line.setAttribute('aria-live', 'polite');
    const host = document.getElementById('dm-main-host');
    if (host) host.appendChild(line);
    onRender('dm:', () => {
      const fid = window.state.activeDM;
      const t = fid ? text(`dm:${fid}`) : '';
      line.innerHTML = t ? `<span class="typing-dots"><i></i><i></i><i></i></span><span>${window.TSUI.esc(t)}</span>` : '';
    });
    document.addEventListener('ts:view', () => render('dm:'));
  }

  document.addEventListener('DOMContentLoaded', bindDm);

  window.TSTyping = {
    localActivity, localSent, remoteTyping, remoteStopped, text, onRender, onDmTypingEvent, sanitizeVerb, myVerb
  };
})();
