// DM ek özellikleri: tepkiler (👍 ❤️ 😂 …) ve güvenilir teslim.
//
// Tepki:  → { type:'dm_react', fromId, mid, e, op:'add'|'remove' }
// Teslim: alıcı her dm_msg için → { type:'dm_ack', fromId, mid }
//   Gönderen onaylanmamış metin mesajlarını bekletir ("gönderiliyor") ve
//   arkadaş yeniden çevrimiçi olunca aynı mid ile tekrar gönderir; alıcı mid ile
//   ayıklar. Yalnızca yeni sürüm arkadaşlar için (presence v≥2) — eski
//   istemciler ack göndermez ve mid'i tanımaz, onlara tekrar gönderilmez.
(function () {
  const OUTBOX_KEY = fid => `teamsync_dm_outbox_${fid}`;
  const MAX_TRIES = 20;
  let outbox = {};   // friendId -> [{ mid, payload, at, tries }]
  let loadedFor = null;

  function ensureLoaded() {
    const me = window.state.friendId;
    if (!me || loadedFor === me) return;
    loadedFor = me;
    try { outbox = JSON.parse(localStorage.getItem(OUTBOX_KEY(me)) || '{}') || {}; } catch (e) { outbox = {}; }
  }

  function persist() {
    const me = window.state.friendId;
    if (!me) return;
    try { localStorage.setItem(OUTBOX_KEY(me), JSON.stringify(outbox)); } catch (e) {}
  }

  const client = () => {
    const c = window.state.globalMqtt;
    return c && c.connected ? c : null;
  };

  function publish(fid, payload, qos = 0) {
    const c = client();
    if (!c || !fid) return false;
    try { c.publish(`teamsync/user/${fid}/events`, JSON.stringify(payload), { qos }); return true; } catch (e) { return false; }
  }

  function supportsAck(fid) {
    const p = window.state.presenceOf && window.state.presenceOf[fid];
    return !!(p && p.v >= 2);
  }

  function findMessage(fid, mid) {
    const list = (window.state.dms || {})[fid] || [];
    return list.find(m => m.id === mid || (m.mergedIds && m.mergedIds.includes(mid))) || null;
  }

  function rerender(fid) {
    if (typeof window.saveDMs === 'function') window.saveDMs();
    if (window.state.activeDM === fid && typeof window.renderDMs === 'function') window.renderDMs();
  }

  // ---------- Güvenilir teslim ----------
  // sendDMText gönderdikten sonra çağırır. true → mesaj "bekliyor" işaretlenmeli.
  function track(fid, payload) {
    ensureLoaded();
    if (!payload || !payload.mid || !supportsAck(fid)) return false;
    (outbox[fid] = outbox[fid] || []).push({ mid: payload.mid, payload, at: Date.now(), tries: 1 });
    if (outbox[fid].length > 200) outbox[fid] = outbox[fid].slice(-200);
    persist();
    return true;
  }

  function sendAck(toFid, mid) {
    if (typeof mid !== 'string' || !mid) return;
    publish(toFid, { type: 'dm_ack', fromId: window.state.friendId, mid });
  }

  function onAck(data) {
    ensureLoaded();
    const fid = data && data.fromId;
    const mid = data && data.mid;
    if (typeof fid !== 'string' || typeof mid !== 'string' || !outbox[fid]) return;
    const before = outbox[fid].length;
    outbox[fid] = outbox[fid].filter(item => item.mid !== mid);
    if (!outbox[fid].length) delete outbox[fid];
    if ((outbox[fid] || []).length !== before) persist();
    const m = findMessage(fid, mid);
    if (m && m.pending) { delete m.pending; rerender(fid); }
  }

  function resend(fid) {
    ensureLoaded();
    const list = outbox[fid];
    if (!list || !list.length || !client()) return;
    let i = 0;
    list.forEach(item => {
      if (item.tries >= MAX_TRIES) return;
      item.tries++;
      setTimeout(() => publish(fid, item.payload), 120 * i++);
    });
    outbox[fid] = list.filter(item => item.tries < MAX_TRIES);
    persist();
  }

  // Arkadaş çevrimiçi olunca bekleyenleri gönder; açıkken de 30 sn'de bir
  // (20 sn'den eski onaysızlar için) yeniden dene.
  function onFriendOnline(fid) { setTimeout(() => resend(fid), 1500); }
  setInterval(() => {
    ensureLoaded();
    const now = Date.now();
    Object.keys(outbox).forEach(fid => {
      const f = window.state.friends && window.state.friends[fid];
      if (!f || !f.online) return;
      if ((outbox[fid] || []).some(item => now - item.at > 20000)) resend(fid);
    });
  }, 30000);

  function isPending(fid, mid) {
    ensureLoaded();
    return !!(outbox[fid] || []).find(item => item.mid === mid);
  }

  // ---------- Tepkiler ----------
  function applyReaction(m, who, emoji, op) {
    m.reactions = m.reactions && typeof m.reactions === 'object' ? m.reactions : {};
    const list = new Set(m.reactions[emoji] || []);
    if (op === 'remove') list.delete(who); else list.add(who);
    if (list.size) m.reactions[emoji] = Array.from(list); else delete m.reactions[emoji];
    if (!Object.keys(m.reactions).length) delete m.reactions;
  }

  function validEmoji(e) {
    return typeof e === 'string' && e.length > 0 && e.length <= 16 && !/[<>"'&\s]/.test(e);
  }

  function toggle(fid, mid, emoji) {
    const m = findMessage(fid, mid);
    if (!m || !validEmoji(emoji)) return;
    const has = !!(m.reactions && (m.reactions[emoji] || []).includes('me'));
    const op = has ? 'remove' : 'add';
    applyReaction(m, 'me', emoji, op);
    rerender(fid);
    publish(fid, { type: 'dm_react', fromId: window.state.friendId, mid, e: emoji, op }, 1);
  }

  function onReact(data) {
    const fid = data && data.fromId;
    if (typeof fid !== 'string' || !window.state.friends[fid] || window.state.friends[fid].isMuted) return;
    if (typeof data.mid !== 'string' || !validEmoji(data.e)) return;
    const m = findMessage(fid, data.mid);
    if (!m) return;
    applyReaction(m, 'them', data.e, data.op === 'remove' ? 'remove' : 'add');
    rerender(fid);
  }

  function reactionsHtml(m) {
    if (!m || !m.reactions || !m.id) return '';
    const esc = window.TSUI.esc;
    const chips = Object.entries(m.reactions).map(([e, who]) => {
      const mine = who.includes('me');
      return `<button type="button" class="rx ${mine ? 'rx-mine' : ''}" data-rx="${esc(e)}" data-mid="${esc(m.id)}"><span class="rx-e">${esc(e)}</span><span class="rx-n">${who.length}</span></button>`;
    }).join('');
    return chips ? `<div class="rx-row">${chips}</div>` : '';
  }

  function bind() {
    const host = document.getElementById('dm-messages');
    if (!host) return;
    host.addEventListener('click', e => {
      const chip = e.target.closest('[data-rx]');
      if (chip) { toggle(window.state.activeDM, chip.dataset.mid, chip.dataset.rx); return; }
      const add = e.target.closest('[data-react-open]');
      if (add && window.TSEmoji) {
        const mid = add.dataset.reactOpen;
        window.TSEmoji.openPicker(add, emoji => toggle(window.state.activeDM, mid, emoji), { placement: 'left' });
      }
    });
  }
  document.addEventListener('DOMContentLoaded', bind);

  window.TSDMX = { track, sendAck, onAck, resend, onFriendOnline, isPending, toggle, onReact, reactionsHtml, _outbox: () => outbox };
})();
