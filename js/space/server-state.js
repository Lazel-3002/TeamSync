// Sunucu durumunun SAF (ağ/depo bilmeyen) hesaplayıcısı: yetki bit alanı,
// rol hiyerarşisi, kanal izin geçersiz kılmaları ve kontrol olaylarından
// deterministik durum çıkarma. Aynı olay kümesini alan her bilgisayar aynı
// sonuca varır (olaylar (ts, id) sırasıyla uygulanır, her olay o andaki
// duruma göre yetki denetiminden geçer; yetkisiz olay sessizce atlanır).
// Hem tarayıcıda (window.TSServerState) hem Node testlerinde (require) çalışır.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TSServerState = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const P = {
    VIEW_CHANNEL: 1 << 0,
    SEND_MESSAGES: 1 << 1,
    ADD_REACTIONS: 1 << 2,
    CONNECT: 1 << 3,
    MANAGE_MESSAGES: 1 << 4,
    MANAGE_CHANNELS: 1 << 5,
    MANAGE_ROLES: 1 << 6,
    CREATE_INVITE: 1 << 7,
    KICK_MEMBERS: 1 << 8,
    BAN_MEMBERS: 1 << 9,
    MANAGE_SERVER: 1 << 10,
    ADMINISTRATOR: 1 << 11
  };
  const ALL = (1 << 12) - 1;
  const DEFAULT_EVERYONE = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.ADD_REACTIONS | P.CONNECT | P.CREATE_INVITE;
  // Kanal bazında geçersiz kılınabilen izinler
  const CHANNEL_MASK = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.ADD_REACTIONS | P.CONNECT | P.MANAGE_MESSAGES;
  const EVERYONE = 'everyone';
  const SLOW_STEPS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
  const LIMITS = { channels: 60, roles: 40, members: 500, invites: 100, hosts: 5, topic: 300, desc: 300, icon: 40000 };
  const DAY = 24 * 3600 * 1000;
  const SKEW = 5 * 60 * 1000;

  // ---------- doğrulama yardımcıları ----------
  const validFid = f => typeof f === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(f);
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(id);
  const validKey = k => typeof k === 'string' && k.length >= 80 && k.length <= 200 && /^[A-Za-z0-9+/=]+$/.test(k);
  const validCode = c => typeof c === 'string' && /^[A-HJ-NP-Z2-9]{10}$/.test(c);
  const isInt = n => Number.isInteger(n) && n >= 0;
  const cleanName = (n, max = 60) => String(n == null ? '' : n).replace(/[\r\n\t<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  // Metin kanalı adları Discord gibi: küçük harf, boşluk yerine tire.
  function channelName(n, kind) {
    if (kind === 'voice') return cleanName(n, 40);
    return String(n == null ? '' : n).toLocaleLowerCase('tr').trim().replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '').replace(/-{2,}/g, '-').slice(0, 40);
  }
  const validColor = c => c === '' || (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
  const validIcon = i => i === '' || (typeof i === 'string' && i.length <= LIMITS.icon && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(i));

  // ---------- durum ----------
  function createState(ev) {
    const b = ev.body || {};
    const m = b.member || {};
    if (!validFid(ev.author) || !validKey(m.ik) || !validKey(m.ek)) return null;
    const name = cleanName(b.name, 60);
    if (!name) return null;
    return {
      sid: ev.gid,
      owner: ev.author,
      name,
      icon: validIcon(b.icon) ? b.icon : '',
      desc: '',
      public: false,
      createdAt: ev.ts,
      deleted: false,
      hosts: [ev.author],
      everHosts: [ev.author],
      hostOffers: [],
      // İmza doğrulaması için: üyenin bu sunucuda kullandığı tüm açık imza
      // anahtarları (yeniden kurulumla değişebilir; eski olaylar eskisiyle imzalı).
      keys: { [ev.author]: [m.ik] },
      roles: { [EVERYONE]: { id: EVERYONE, name: '@everyone', color: '', perms: DEFAULT_EVERYONE, pos: 0, hoist: false } },
      channels: {},
      members: { [ev.author]: { fid: ev.author, name: cleanName(m.name, 40) || ev.author, ik: m.ik, ek: m.ek, roles: [], joinedAt: ev.ts } },
      former: {},
      bans: {},
      invites: {},
      applied: 1,
      last: ev.ts
    };
  }

  function isMember(st, fid) { return !!(st && st.members[fid]); }

  function basePerms(st, fid) {
    if (!st || !st.members[fid]) return 0;
    if (fid === st.owner) return ALL;
    let perms = st.roles[EVERYONE] ? st.roles[EVERYONE].perms : 0;
    for (const rid of st.members[fid].roles) {
      const r = st.roles[rid];
      if (r) perms |= r.perms;
    }
    return (perms & P.ADMINISTRATOR) ? ALL : perms;
  }

  // Discord algoritması: taban → @everyone geçersiz kılması → rollerin
  // birleşik geçersiz kılması (önce ret, sonra izin) → üyeye özel.
  function channelPerms(st, fid, chId) {
    let perms = basePerms(st, fid);
    if (perms === ALL) return ALL;
    const ch = st.channels[chId];
    if (!ch) return 0;
    const ov = ch.overrides || {};
    const apply = o => { if (o) { perms &= ~o.d; perms |= o.a; } };
    apply(ov[EVERYONE]);
    let allow = 0;
    let deny = 0;
    for (const rid of st.members[fid].roles) {
      const o = ov[rid];
      if (o) { allow |= o.a; deny |= o.d; }
    }
    perms &= ~deny;
    perms |= allow;
    apply(ov[`u:${fid}`]);
    if (!(perms & P.VIEW_CHANNEL)) return 0;
    return perms;
  }

  const has = (perms, bit) => (perms & bit) === bit;

  function highestPos(st, fid) {
    if (fid === st.owner) return Infinity;
    const m = st.members[fid];
    if (!m) return -1;
    return m.roles.reduce((max, rid) => Math.max(max, st.roles[rid] ? st.roles[rid].pos : 0), 0);
  }

  // actor, target üzerinde işlem yapabilir mi (at/yasakla/rol değiştir)?
  function outranks(st, actor, target) {
    if (target === st.owner) return false;
    if (actor === st.owner) return true;
    return highestPos(st, actor) > highestPos(st, target);
  }

  function canManageRole(st, actor, rid) {
    const role = st.roles[rid];
    if (!role) return false;
    if (actor === st.owner) return true;
    if (!has(basePerms(st, actor), P.MANAGE_ROLES)) return false;
    return role.pos < highestPos(st, actor);
  }

  // Sahip olmadığın izni veremezsin (sahip/yönetici hariç).
  function permsGrantable(st, actor, perms) {
    const mine = basePerms(st, actor);
    return mine === ALL || (perms & ~mine) === 0;
  }

  function removeMember(st, fid, ts, reason) {
    const m = st.members[fid];
    if (!m) return;
    delete st.members[fid];
    st.former[fid] = { fid, name: m.name, ik: m.ik, ek: m.ek, leftAt: ts, reason };
    st.hosts = st.hosts.filter(h => h !== fid);
    st.hostOffers = st.hostOffers.filter(h => h !== fid);
  }

  function inviteUsable(st, code, ts) {
    const inv = st.invites[code];
    if (!inv || inv.revoked) return false;
    if (inv.exp && ts > inv.exp) return false;
    if (inv.max && inv.uses >= inv.max) return false;
    return true;
  }

  function cleanOverrides(st, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    const keys = Object.keys(raw);
    if (keys.length > 60) return null;
    for (const k of keys) {
      const o = raw[k];
      const okKey = k === EVERYONE || st.roles[k] || (k.startsWith('u:') && validFid(k.slice(2)));
      if (!okKey || !o || !isInt(o.a) || !isInt(o.d)) return null;
      const a = o.a & CHANNEL_MASK;
      const d = o.d & CHANNEL_MASK & ~a;
      if (a || d) out[k] = { a, d };
    }
    return out;
  }

  // Tek bir kontrol olayını uygular; uygulandıysa true.
  function apply(st, ev) {
    if (st.deleted) return false;
    const a = ev.author;
    const b = ev.body || {};
    const perms = basePerms(st, a);
    const member = isMember(st, a);
    switch (ev.type) {
      case 'srv.update': {
        if (!has(perms, P.MANAGE_SERVER)) return false;
        if (b.name !== undefined) { const n = cleanName(b.name, 60); if (!n) return false; st.name = n; }
        if (b.icon !== undefined) { if (!validIcon(b.icon)) return false; st.icon = b.icon; }
        if (b.desc !== undefined) st.desc = cleanName(b.desc, LIMITS.desc);
        if (b.public !== undefined) st.public = !!b.public;
        return true;
      }
      case 'srv.delete': {
        if (a !== st.owner) return false;
        st.deleted = true;
        return true;
      }
      case 'ch.create': {
        if (!has(perms, P.MANAGE_CHANNELS)) return false;
        if (!validId(b.id) || st.channels[b.id] || Object.keys(st.channels).length >= LIMITS.channels) return false;
        const kind = b.kind === 'voice' ? 'voice' : 'text';
        const name = channelName(b.name, kind);
        if (!name) return false;
        const same = Object.values(st.channels).filter(c => c.kind === kind);
        st.channels[b.id] = {
          id: b.id, name, kind, topic: cleanName(b.topic, LIMITS.topic), slow: 0, overrides: {},
          pos: same.reduce((m, c) => Math.max(m, c.pos), -1) + 1, createdAt: ev.ts
        };
        if (b.overrides) {
          const ov = cleanOverrides(st, b.overrides);
          if (ov && has(perms, P.MANAGE_ROLES)) st.channels[b.id].overrides = ov;
        }
        return true;
      }
      case 'ch.update': {
        const ch = st.channels[b.id];
        if (!ch || !has(perms, P.MANAGE_CHANNELS)) return false;
        let ov = null;
        if (b.overrides !== undefined) {
          if (!has(perms, P.MANAGE_ROLES)) return false;
          ov = cleanOverrides(st, b.overrides);
          if (!ov) return false;
        }
        if (b.slow !== undefined && !SLOW_STEPS.includes(b.slow)) return false;
        if (b.name !== undefined) { const n = channelName(b.name, ch.kind); if (!n) return false; ch.name = n; }
        if (b.topic !== undefined) ch.topic = cleanName(b.topic, LIMITS.topic);
        if (b.slow !== undefined) ch.slow = b.slow;
        if (ov) ch.overrides = ov;
        return true;
      }
      case 'ch.move': {
        const ch = st.channels[b.id];
        if (!ch || !has(perms, P.MANAGE_CHANNELS) || (b.dir !== 'up' && b.dir !== 'down')) return false;
        const list = sortedChannels(st, ch.kind);
        const i = list.findIndex(c => c.id === ch.id);
        const j = b.dir === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= list.length) return false;
        list.forEach((c, k) => { c.pos = k; });
        const other = list[j];
        other.pos = i;
        ch.pos = j;
        return true;
      }
      case 'ch.delete': {
        if (!st.channels[b.id] || !has(perms, P.MANAGE_CHANNELS)) return false;
        delete st.channels[b.id];
        return true;
      }
      case 'role.create': {
        if (!has(perms, P.MANAGE_ROLES) || !validId(b.id) || st.roles[b.id] || b.id === EVERYONE) return false;
        if (Object.keys(st.roles).length >= LIMITS.roles) return false;
        const rp = isInt(b.perms) ? b.perms & ALL : 0;
        if (!permsGrantable(st, a, rp) || !validColor(b.color || '')) return false;
        const name = cleanName(b.name, 32);
        if (!name) return false;
        // Discord gibi: yeni rol en alta (@everyone'ın hemen üstüne) girer.
        Object.values(st.roles).forEach(r => { if (r.id !== EVERYONE) r.pos += 1; });
        st.roles[b.id] = { id: b.id, name, color: b.color || '', perms: rp, pos: 1, hoist: !!b.hoist };
        return true;
      }
      case 'role.update': {
        const role = st.roles[b.id];
        if (!role || !canManageRole(st, a, b.id)) return false;
        if (b.perms !== undefined) {
          if (!isInt(b.perms)) return false;
          const rp = b.perms & ALL;
          // Yalnızca DEĞİŞEN izinler için "sahip olmadığını veremezsin" kuralı
          if (!permsGrantable(st, a, rp ^ role.perms)) return false;
          role.perms = rp;
        }
        if (b.id !== EVERYONE) {
          if (b.name !== undefined) { const n = cleanName(b.name, 32); if (!n) return false; role.name = n; }
          if (b.color !== undefined) { if (!validColor(b.color)) return false; role.color = b.color; }
          if (b.hoist !== undefined) role.hoist = !!b.hoist;
        }
        return true;
      }
      case 'role.move': {
        const role = st.roles[b.id];
        if (!role || b.id === EVERYONE || (b.dir !== 'up' && b.dir !== 'down')) return false;
        const target = role.pos + (b.dir === 'up' ? 1 : -1);
        const other = Object.values(st.roles).find(r => r.pos === target && r.id !== EVERYONE);
        if (!other) return false;
        if (!canManageRole(st, a, role.id) || !canManageRole(st, a, other.id)) return false;
        other.pos = role.pos;
        role.pos = target;
        return true;
      }
      case 'role.delete': {
        const role = st.roles[b.id];
        if (!role || b.id === EVERYONE || !canManageRole(st, a, b.id)) return false;
        delete st.roles[b.id];
        Object.values(st.roles).forEach(r => { if (r.pos > role.pos) r.pos -= 1; });
        Object.values(st.members).forEach(m => { m.roles = m.roles.filter(r => r !== b.id); });
        Object.values(st.channels).forEach(c => { if (c.overrides[b.id]) delete c.overrides[b.id]; });
        return true;
      }
      case 'member.join': {
        if (member || st.bans[a]) return false;
        if (!validKey(b.ik) || !validKey(b.ek) || !validCode(b.inv)) return false;
        if (Object.keys(st.members).length >= LIMITS.members) return false;
        if (!inviteUsable(st, b.inv, ev.ts)) return false;
        st.invites[b.inv].uses += 1;
        delete st.former[a];
        if (!(st.keys[a] || []).includes(b.ik)) st.keys[a] = (st.keys[a] || []).concat(b.ik);
        st.members[a] = { fid: a, name: cleanName(b.name, 40) || a, ik: b.ik, ek: b.ek, roles: [], joinedAt: ev.ts };
        return true;
      }
      case 'member.leave': {
        if (!member || a === st.owner) return false;
        removeMember(st, a, ev.ts, 'leave');
        return true;
      }
      case 'member.kick': {
        if (!isMember(st, b.fid) || !has(perms, P.KICK_MEMBERS) || !outranks(st, a, b.fid)) return false;
        removeMember(st, b.fid, ev.ts, 'kick');
        return true;
      }
      case 'member.roles': {
        const target = st.members[b.fid];
        if (!target || !has(perms, P.MANAGE_ROLES)) return false;
        const add = Array.isArray(b.add) ? b.add : [];
        const rem = Array.isArray(b.remove) ? b.remove : [];
        if (add.length + rem.length === 0 || add.length + rem.length > 20) return false;
        // Kendinden üstteki birine rol veremezsin (kendine verebilirsin)
        if (b.fid !== a && !outranks(st, a, b.fid)) return false;
        if (![...add, ...rem].every(rid => rid !== EVERYONE && canManageRole(st, a, rid))) return false;
        target.roles = target.roles.filter(r => !rem.includes(r));
        add.forEach(r => { if (!target.roles.includes(r)) target.roles.push(r); });
        return true;
      }
      case 'member.rename': {
        if (!member) return false;
        const n = cleanName(b.name, 40);
        if (!n) return false;
        st.members[a].name = n;
        return true;
      }
      case 'ban.add': {
        if (!validFid(b.fid) || b.fid === st.owner || b.fid === a || !has(perms, P.BAN_MEMBERS)) return false;
        if (isMember(st, b.fid) && !outranks(st, a, b.fid)) return false;
        st.bans[b.fid] = { fid: b.fid, by: a, at: ev.ts, reason: cleanName(b.reason, 120), name: (st.members[b.fid] || st.former[b.fid] || {}).name || '' };
        removeMember(st, b.fid, ev.ts, 'ban');
        return true;
      }
      case 'ban.remove': {
        if (!st.bans[b.fid] || !has(perms, P.BAN_MEMBERS)) return false;
        delete st.bans[b.fid];
        return true;
      }
      case 'invite.create': {
        if (!has(perms, P.CREATE_INVITE) || !validCode(b.code) || st.invites[b.code]) return false;
        const live = Object.values(st.invites).filter(i => inviteUsable(st, i.code, ev.ts));
        if (live.length >= LIMITS.invites) return false;
        const exp = b.exp === 0 ? 0 : Number(b.exp);
        if (exp !== 0 && !(Number.isFinite(exp) && exp > ev.ts && exp <= ev.ts + 31 * DAY)) return false;
        if (!isInt(b.max) || b.max > 1000) return false;
        st.invites[b.code] = { code: b.code, by: a, at: ev.ts, exp, max: b.max, uses: 0, revoked: false, pub: !!b.pub };
        return true;
      }
      case 'invite.revoke': {
        const inv = st.invites[b.code];
        if (!inv || inv.revoked) return false;
        if (inv.by !== a && !has(perms, P.MANAGE_SERVER)) return false;
        inv.revoked = true;
        return true;
      }
      case 'host.offer': {
        if (a !== st.owner || !isMember(st, b.fid) || st.hosts.includes(b.fid) || st.hostOffers.includes(b.fid)) return false;
        if (st.hosts.length >= LIMITS.hosts) return false;
        st.hostOffers.push(b.fid);
        return true;
      }
      case 'host.accept': {
        if (!st.hostOffers.includes(a) || st.hosts.length >= LIMITS.hosts) return false;
        st.hostOffers = st.hostOffers.filter(f => f !== a);
        st.hosts.push(a);
        if (!st.everHosts.includes(a)) st.everHosts.push(a);
        return true;
      }
      case 'host.decline': {
        if (!st.hostOffers.includes(a)) return false;
        st.hostOffers = st.hostOffers.filter(f => f !== a);
        return true;
      }
      case 'host.revoke': {
        if (a !== st.owner || b.fid === st.owner) return false;
        if (!st.hosts.includes(b.fid) && !st.hostOffers.includes(b.fid)) return false;
        st.hosts = st.hosts.filter(f => f !== b.fid);
        st.hostOffers = st.hostOffers.filter(f => f !== b.fid);
        return true;
      }
      case 'host.resign': {
        if (a === st.owner || !st.hosts.includes(a)) return false;
        st.hosts = st.hosts.filter(f => f !== a);
        return true;
      }
      default:
        return false;
    }
  }

  const CONTROL_TYPES = new Set([
    'srv.create', 'srv.update', 'srv.delete', 'ch.create', 'ch.update', 'ch.move', 'ch.delete',
    'role.create', 'role.update', 'role.move', 'role.delete',
    'member.join', 'member.leave', 'member.kick', 'member.roles', 'member.rename',
    'ban.add', 'ban.remove', 'invite.create', 'invite.revoke',
    'host.offer', 'host.accept', 'host.decline', 'host.revoke', 'host.resign'
  ]);
  const MESSAGE_TYPES = new Set(['msg', 'msg.edit', 'msg.del', 'react']);
  const isControl = type => CONTROL_TYPES.has(type);
  const isMessage = type => MESSAGE_TYPES.has(type);

  const order = (x, y) => (x.ts - y.ts) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

  // Kontrol olaylarından durumu baştan kurar. rejected: uygulanmayan olay id'leri.
  // opts.genesis: sunucunun sabitlenmiş srv.create olay id'si. Verilirse başka
  // srv.create'ler yok sayılır (daha eski tarihli sahte bir kuruluşla sahipliği
  // ele geçirme girişimine karşı).
  function derive(events, opts = {}) {
    const list = events.filter(e => e && isControl(e.type)).slice().sort(order);
    let st = null;
    const rejected = [];
    for (const ev of list) {
      if (!st) {
        if (ev.type === 'srv.create' && (!opts.genesis || ev.id === opts.genesis)) st = createState(ev);
        if (!st) rejected.push(ev.id);
        continue;
      }
      if (ev.type === 'srv.create') { rejected.push(ev.id); continue; }
      let ok = false;
      try { ok = apply(st, ev); } catch (e) { ok = false; }
      if (ok) { st.applied += 1; st.last = Math.max(st.last, ev.ts); } else rejected.push(ev.id);
    }
    if (st) st.rejected = rejected;
    return st;
  }

  // Bir mesaj olayının kabul edilebilirliği (barındırıcılar uygular).
  // ctx: { now, lastMsgAt (bu kanalda yazarın son mesaj zamanı), target (hedef mesaj olayı) }
  function checkMessage(st, ev, ctx = {}) {
    if (!st || st.deleted) return { ok: false, reason: 'gone' };
    if (!isMember(st, ev.author)) return { ok: false, reason: 'member' };
    const ch = st.channels[ev.ch];
    if (!ch) return { ok: false, reason: 'channel' };
    const cp = channelPerms(st, ev.author, ev.ch);
    const b = ev.body || {};
    switch (ev.type) {
      case 'msg': {
        if (ch.kind !== 'text') return { ok: false, reason: 'channel' };
        if (!has(cp, P.VIEW_CHANNEL | P.SEND_MESSAGES)) return { ok: false, reason: 'perm' };
        if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 4000) return { ok: false, reason: 'shape' };
        if (b.reply !== undefined && (typeof b.reply !== 'string' || b.reply.length > 64)) return { ok: false, reason: 'shape' };
        const exempt = has(cp, P.MANAGE_MESSAGES) || has(basePerms(st, ev.author), P.MANAGE_CHANNELS);
        if (ch.slow && !exempt && ctx.lastMsgAt) {
          const wait = ch.slow * 1000 - ((ctx.now || ev.ts) - ctx.lastMsgAt);
          if (wait > 500) return { ok: false, reason: 'slow', wait };
        }
        return { ok: true };
      }
      case 'msg.edit': {
        if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 4000) return { ok: false, reason: 'shape' };
        if (!ctx.target || ctx.target.author !== ev.author || ctx.target.type !== 'msg') return { ok: false, reason: 'perm' };
        return { ok: true };
      }
      case 'msg.del': {
        if (!ctx.target || ctx.target.ch !== ev.ch) return { ok: false, reason: 'target' };
        if (ctx.target.author !== ev.author && !has(cp, P.MANAGE_MESSAGES)) return { ok: false, reason: 'perm' };
        return { ok: true };
      }
      case 'react': {
        if (!has(cp, P.VIEW_CHANNEL | P.ADD_REACTIONS)) return { ok: false, reason: 'perm' };
        if (typeof b.target !== 'string' || typeof b.e !== 'string' || !b.e || b.e.length > 16) return { ok: false, reason: 'shape' };
        return { ok: true };
      }
      default:
        return { ok: false, reason: 'type' };
    }
  }

  // ---------- görünüm yardımcıları ----------
  function sortedChannels(st, kind) {
    return Object.values(st.channels).filter(c => !kind || c.kind === kind)
      .sort((x, y) => (x.pos - y.pos) || (x.createdAt - y.createdAt) || (x.id < y.id ? -1 : 1));
  }
  function visibleChannels(st, fid, kind) {
    return sortedChannels(st, kind).filter(c => has(channelPerms(st, fid, c.id), P.VIEW_CHANNEL));
  }
  function sortedRoles(st) {
    return Object.values(st.roles).sort((x, y) => y.pos - x.pos);
  }
  function memberRoles(st, fid) {
    const m = st.members[fid];
    if (!m) return [];
    return m.roles.map(r => st.roles[r]).filter(Boolean).sort((x, y) => y.pos - x.pos);
  }
  function memberColor(st, fid) {
    const r = memberRoles(st, fid).find(x => x.color);
    return r ? r.color : '';
  }
  function hoistRole(st, fid) {
    return memberRoles(st, fid).find(x => x.hoist) || null;
  }
  function liveInvites(st, now) {
    return Object.values(st.invites).filter(i => inviteUsable(st, i.code, now));
  }

  return {
    P, ALL, DEFAULT_EVERYONE, CHANNEL_MASK, EVERYONE, SLOW_STEPS, LIMITS, SKEW,
    validFid, validId, validKey, validCode, cleanName, channelName, validIcon,
    isControl, isMessage, derive, apply, checkMessage,
    basePerms, channelPerms, has, highestPos, outranks, canManageRole, permsGrantable, inviteUsable,
    sortedChannels, visibleChannels, sortedRoles, memberRoles, memberColor, hoistRole, liveInvites
  };
});
