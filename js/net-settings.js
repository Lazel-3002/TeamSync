// Ayarlar > Bağlantılar (index.html data-settings-content="network").
//  1) Bağlantı durumu ve testi: sinyal sunucuları (MQTT), doğrudan bağlantı
//     (STUN / NAT davranışı, WARP), aracı sunucu (TURN, uygulamanın kendi
//     getIceServers yapılandırması) ve DNS (main.js net-dns-check). Aramadayken
//     kişi kişi bağlantı tipi / ping / kayıp (getStats, 2 sn'de bir; sayfa
//     kapanınca durur).
//  2) Hesabın açık olduğu cihazlar: sunucudaki device_accounts satırları (yeni
//     sütun yok) + "şu an açık" bilgisi kişisel MQTT konusundan. Aynı hesabın
//     cihazları arasındaki mesajlar (`acct_dev`) hesap kodundan türetilen
//     anahtarla AES-GCM şifrelidir (main.js get-account-channel-key): yalnızca
//     aynı kodu taşıyan cihazlar okuyabilir / üretebilir.
//       { type:'acct_dev', fromId:<KNK>, d:<base64 iv|şifreli> }
//       içerik: { k:'hello', q?:1, nm, os, dv, ts, n } | { k:'signout', to:<deviceId|'*'>, dv, ts, n }
//               | { k:'bkreq' } / { k:'bkkey', to:<deviceId>, key:<hex K> } (js/msg-backup.js)
//  3) Yeni cihaz bağlama: giriş kodu (renderer.js TSAccountCode, Hesap ve
//     Cihaz ile aynı önbellek) + kodu yenileme (main.js code-rotation).
//  4) Kurucu ayarı: kendi kurduğum odalar için varsayılan (yerel) ve canlı oda
//     ayarı (renderer.js setRoomAutoHost; kurucu paneliyle aynı yol).
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : key);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = (name, size = 16) => (window.TSUI && typeof window.TSUI.icon === 'function' ? window.TSUI.icon(name, size) : '');
  const st = () => window.state || {};
  const DEVICE_RE = /^[0-9a-f]{40}$/;
  const ONLINE_FRESH_MS = 45000;
  const ASK_EVERY_MS = 15000;

  const withTimeout = (p, ms, fallback) => Promise.race([
    Promise.resolve(p).catch(() => fallback),
    new Promise(r => setTimeout(() => r(fallback), ms))
  ]);

  // ---------------------------------------------------------------- görünürlük
  function isOpen() {
    const modal = $('settings-modal');
    const panel = document.querySelector('[data-settings-content="network"]');
    return !!modal && !modal.classList.contains('hidden') && !!panel && panel.classList.contains('active');
  }

  let ticker = null;
  let tickCount = 0;
  function open() {
    buildChecks();
    buildPeersInfo();
    renderChecks();
    renderPeers();
    renderFounder(true);
    renderNewDevice();
    loadDevices();
    askOwnDevices();
    if (!ticker) ticker = setInterval(onTick, 2000);
  }
  function onTick() {
    if (!isOpen()) {
      clearInterval(ticker);
      ticker = null;
      lossPrev.clear();
      return;
    }
    tickCount++;
    if (!running) renderChecks();
    renderPeers();
    renderFounder(false);
    renderDevices(false);
    if (tickCount % Math.round(ASK_EVERY_MS / 2000) === 0) askOwnDevices();
  }

  // "Bu ne demek?" düğmesi + açılır açıklama (klavyeyle kullanılabilir: <button>).
  function infoToggle(id, textKey) {
    const wrap = document.createElement('div');
    wrap.className = 'net-info-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'net-info-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'net-info-' + id);
    btn.innerHTML = `${ico('helpCircle', 14)}<span>${esc(tr('net.whatIs'))}</span>`;
    const panel = document.createElement('div');
    panel.className = 'net-info';
    panel.id = 'net-info-' + id;
    panel.hidden = true;
    const keys = Array.isArray(textKey) ? textKey : [textKey];
    panel.innerHTML = keys.map(k => `<p>${esc(tr(k))}</p>`).join('');
    btn.addEventListener('click', () => {
      const show = panel.hidden;
      panel.hidden = !show;
      btn.setAttribute('aria-expanded', String(show));
    });
    return { btn, panel, wrap };
  }

  // ------------------------------------------------------------- 1) durum/test
  const CHECKS = [
    { id: 'sig', icon: 'server', label: 'net.sigLabel', info: 'net.sigInfo' },
    { id: 'direct', icon: 'zap', label: 'net.directLabel', info: 'net.directInfo' },
    { id: 'turn', icon: 'shuffle', label: 'net.turnLabel', info: 'net.turnInfo' },
    { id: 'dns', icon: 'globe', label: 'net.dnsLabel', info: 'net.dnsInfo' }
  ];
  const STATE_KEY = { ok: 'net.stateOk', warn: 'net.stateWarn', bad: 'net.stateBad', idle: 'net.stateIdle', checking: 'net.stateChecking' };
  let results = null;     // son testin sonuçları { sig:{state,verdict,detail}, ... }
  let lastTestAt = 0;
  let running = false;
  let dnsProvider = null;

  function buildChecks() {
    const list = $('net-checks');
    if (!list) return;
    list.innerHTML = '';
    CHECKS.forEach(c => {
      const li = document.createElement('li');
      li.className = 'net-check';
      li.dataset.check = c.id;
      li.dataset.state = 'idle';
      const info = infoToggle(c.id, c.info);
      li.innerHTML = `<span class="net-dot" aria-hidden="true"></span>
        <span class="net-check-icon" aria-hidden="true">${ico(c.icon, 18)}</span>
        <div class="net-check-body">
          <div class="net-check-top"><strong>${esc(tr(c.label))}</strong><span class="net-state-label"></span></div>
          <p class="net-verdict"></p>
          <p class="net-detail"></p>
        </div>`;
      li.querySelector('.net-check-body').append(info.btn, info.panel);
      list.append(li);
    });
    const btn = $('net-test-btn');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', runTest);
    }
    if (btn) setTestButton();
  }

  function setTestButton() {
    const btn = $('net-test-btn');
    if (!btn) return;
    btn.disabled = running;
    btn.setAttribute('aria-busy', String(running));
    const key = running ? 'net.testRunning' : (results ? 'net.testAgain' : 'net.testRun');
    btn.setAttribute('data-i18n', key);
    btn.textContent = tr(key);
  }

  function turnEntries() {
    try { return getIceServers().filter(s => iceEntryHasTurn(s)); } catch (e) { return []; }
  }
  function stunEntries() {
    try { return getIceServers().filter(s => !iceEntryHasTurn(s, false)); } catch (e) { return []; }
  }
  function providerName(p) {
    return ({ cloudflare: 'Cloudflare', quad9: 'Quad9', google: 'Google' })[p] || tr('net.dnsProviderSystem');
  }
  function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return url; }
  }

  // Test yapılmadıysa satırlar uygulamanın şu anki durumundan doldurulur.
  function liveChecks() {
    const s = st();
    const out = {};
    const brokers = s.globalMqtt && typeof s.globalMqtt.brokers === 'function' ? s.globalMqtt.brokers() : [];
    const up = brokers.filter(b => b.connected).length;
    out.sig = up
      ? { state: 'ok', verdict: tr('net.sigLive', { n: up, total: brokers.length }), detail: brokers.filter(b => b.connected).map(b => hostOf(b.url)).join(' · ') }
      : { state: brokers.length ? 'bad' : 'idle', verdict: tr('net.sigLiveNone'), detail: '' };
    if (s.warpDetected) out.direct = { state: 'warn', verdict: tr('net.directWarp'), detail: '' };
    else if (s.symmetricNatDetected) out.direct = { state: 'warn', verdict: tr('net.directSym'), detail: '' };
    else out.direct = { state: 'idle', verdict: tr('net.directIdle'), detail: '' };
    const turns = turnEntries().length;
    const needs = !!(s.warpDetected || s.symmetricNatDetected);
    out.turn = turns
      ? { state: 'idle', verdict: tr('net.turnConfigured', { n: turns }), detail: Array.isArray(s.sharedTurn) && s.sharedTurn.length ? tr('net.turnShared') : '' }
      : { state: needs ? 'warn' : 'idle', verdict: tr(needs ? 'net.turnNoneNeeded' : 'net.turnNone'), detail: '' };
    out.dns = dnsProvider === 'system'
      ? { state: 'idle', verdict: tr('net.dnsSystem'), detail: '' }
      : { state: 'idle', verdict: tr('net.dnsLive', { provider: providerName(dnsProvider || 'cloudflare') }), detail: '' };
    return out;
  }

  function renderChecks() {
    const list = $('net-checks');
    if (!list) return;
    if (!dnsProvider && window.electronAPI && window.electronAPI.getDnsProvider) {
      window.electronAPI.getDnsProvider().then(p => { dnsProvider = p || 'cloudflare'; }).catch(() => {});
    }
    const live = liveChecks();
    CHECKS.forEach(c => {
      const li = list.querySelector(`[data-check="${c.id}"]`);
      if (!li) return;
      const r = running ? { state: 'checking', verdict: tr('net.testRunning'), detail: '' } : ((results && results[c.id]) || live[c.id]);
      li.dataset.state = r.state;
      li.querySelector('.net-state-label').textContent = tr(STATE_KEY[r.state] || 'net.stateIdle');
      li.querySelector('.net-verdict').textContent = r.verdict || '';
      const d = li.querySelector('.net-detail');
      d.textContent = r.detail || '';
      d.hidden = !r.detail;
    });
    const sum = $('net-test-summary');
    if (sum) {
      if (running) sum.textContent = tr('net.summaryRunning');
      else if (!results) sum.textContent = tr('net.summaryIdle');
      else {
        const bad = CHECKS.some(c => results[c.id] && (results[c.id].state === 'bad' || results[c.id].state === 'warn'));
        sum.textContent = `${tr(bad ? 'net.summaryIssues' : 'net.summaryOk')} ${tr('net.summaryTime', { time: typeof formatUserTime === 'function' ? formatUserTime(new Date(lastTestAt)) : new Date(lastTestAt).toLocaleTimeString() })}`;
      }
    }
  }

  // Geçici bir MQTT istemcisiyle broker'a bağlanıp kendi konusuna yazdığı
  // mesajın geri dönüş süresini ölçer (gerçek gidiş-dönüş).
  function probeBroker(url) {
    return new Promise(resolve => {
      let done = false;
      let connected = false;
      let client = null;
      const topic = 'teamsync/diag/' + Math.random().toString(16).slice(2) + Date.now().toString(16);
      const fin = r => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { if (client) client.end(true); } catch (e) {}
        resolve(r);
      };
      const timer = setTimeout(() => fin({ url, ok: connected, ms: null }), 9000);
      try {
        client = window.mqtt.connect(url, {
          clientId: 'diag-' + Math.random().toString(16).slice(2, 10),
          reconnectPeriod: 0, connectTimeout: 8000, keepalive: 30, clean: true
        });
      } catch (e) { fin({ url, ok: false }); return; }
      client.on('connect', () => {
        connected = true;
        client.on('message', (tp) => { if (tp === topic) fin({ url, ok: true, ms: Math.round(performance.now() - t1) }); });
        let t1 = performance.now();
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) { fin({ url, ok: true, ms: null }); return; }
          t1 = performance.now();
          client.publish(topic, JSON.stringify({ p: 1 }));
        });
      });
      client.on('error', () => { if (!connected) fin({ url, ok: false }); });
    });
  }

  async function testSignalling() {
    const urls = (typeof SIGNALING_BROKERS !== 'undefined' && Array.isArray(SIGNALING_BROKERS)) ? SIGNALING_BROKERS : [];
    const res = await Promise.all(urls.map(u => probeBroker(u)));
    const ok = res.filter(r => r.ok);
    const detail = res.map(r => `${hostOf(r.url)}: ${r.ok ? (r.ms != null ? r.ms + ' ms' : 'OK') : tr('net.sigNoAnswer')}`).join(' · ');
    if (!ok.length) return { state: 'bad', verdict: tr('net.sigNone'), detail };
    if (ok.length < res.length) return { state: 'warn', verdict: tr('net.sigSome', { n: ok.length, total: res.length }), detail };
    return { state: 'ok', verdict: tr('net.sigOk'), detail };
  }

  async function gather(config, ms, stopWhen) {
    const pc = new RTCPeerConnection(config);
    const cands = [];
    try {
      pc.createDataChannel('diag');
      const done = new Promise(res => {
        pc.onicecandidate = e => {
          if (!e.candidate) { res(); return; }
          const line = e.candidate.candidate || '';
          cands.push(line);
          if (stopWhen && stopWhen(line)) res();
        };
        pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') res(); };
      });
      await pc.setLocalDescription(await pc.createOffer());
      await withTimeout(done, ms);
    } finally {
      try { pc.close(); } catch (e) {}
    }
    return cands;
  }

  const SRFLX_RE = /^candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ srflx(?:.*? raddr (\S+) rport (\d+))?/i;

  async function testDirect() {
    const warpP = window.electronAPI && window.electronAPI.detectWarp
      ? withTimeout(window.electronAPI.detectWarp(), 6000, null) : Promise.resolve(null);
    const cands = await gather({ iceServers: stunEntries() }, 7000).catch(() => []);
    const warp = await warpP;
    const srflx = cands.map(l => SRFLX_RE.exec(l)).filter(Boolean);
    // Aynı yerel soketten (raddr:rport) iki farklı dış port = simetrik NAT
    // (renderer.js noteNatBehaviourFromCandidate ile aynı ölçüt).
    const byBase = {};
    let symmetric = false;
    srflx.forEach(m => {
      if (!m[5] || m[5] === '0') return;
      const base = `${m[4]}:${m[5]}`;
      (byBase[base] = byBase[base] || new Set()).add(m[3]);
      if (byBase[base].size > 1) symmetric = true;
    });
    const cgnat = srflx.some(m => typeof isCgnatAddress === 'function' && isCgnatAddress(m[2]));
    if (symmetric) st().symmetricNatDetected = true;
    const detail = cgnat ? tr('net.directCgnat') : '';
    if (!srflx.length) return { state: 'bad', verdict: tr('net.directNone'), detail, symmetric, none: true, warp: !!warp };
    if (warp) return { state: 'warn', verdict: tr('net.directWarp'), detail, symmetric, warp: true };
    if (symmetric) return { state: 'warn', verdict: tr('net.directSym'), detail, symmetric };
    return { state: 'ok', verdict: tr('net.directOk'), detail, symmetric };
  }

  async function testTurn() {
    const customUrl = localStorage.getItem('teamsync_turn_url') || '';
    if (customUrl.startsWith('http') && !(Array.isArray(st().dynamicTurnServers) && st().dynamicTurnServers.length) && typeof refreshDynamicTurn === 'function') {
      await withTimeout(refreshDynamicTurn(), 3500);
    }
    const servers = turnEntries();
    if (!servers.length) return { state: 'idle', verdict: tr('net.turnNone'), detail: '', none: true };
    const cands = await gather({ iceServers: servers, iceTransportPolicy: 'relay' }, 9000, l => / typ relay /.test(l)).catch(() => []);
    const relay = cands.some(l => / typ relay /.test(l));
    const shared = Array.isArray(st().sharedTurn) && st().sharedTurn.length ? tr('net.turnShared') : '';
    return relay
      ? { state: 'ok', verdict: tr('net.turnOk'), detail: shared }
      : { state: 'bad', verdict: tr('net.turnBad'), detail: shared };
  }

  async function testDns() {
    const api = window.electronAPI;
    if (!api || !api.netDnsCheck) return { state: 'idle', verdict: tr('net.dnsLive', { provider: providerName(dnsProvider) }), detail: '' };
    const r = await withTimeout(api.netDnsCheck(), 7000, null);
    const provider = (r && r.provider) || dnsProvider || 'cloudflare';
    dnsProvider = provider;
    const name = providerName(provider);
    if (r && r.ok) return { state: 'ok', verdict: tr('net.dnsOk', { provider: name, ms: r.ms }), detail: provider === 'system' ? tr('net.dnsSystem') : '' };
    return { state: 'bad', verdict: tr('net.dnsBad', { provider: name }), detail: r && r.error ? r.error : '' };
  }

  async function runTest() {
    if (running) return;
    running = true;
    setTestButton();
    renderChecks();
    const fail = (key) => ({ state: 'bad', verdict: tr(key), detail: '' });
    try {
      const [sig, direct, turn, dns] = await Promise.all([
        withTimeout(testSignalling(), 14000, fail('net.sigNone')),
        withTimeout(testDirect(), 14000, fail('net.directNone')),
        withTimeout(testTurn(), 14000, fail('net.turnBad')),
        withTimeout(testDns(), 14000, fail('net.dnsBad'))
      ]);
      // İnternet hiç yoksa "doğrudan bağlantı yok" yanıltıcı olur: sebep ağın kendisi.
      const noNet = sig.state === 'bad' && direct && direct.none;
      if (noNet) Object.assign(direct, { verdict: tr('net.directNoNet') });
      // Aracı sunucu ayarlı değilse ve bu ağ doğrudan bağlantıyı zorlaştırıyorsa uyar.
      if (!noNet && turn.none && direct && (direct.symmetric || direct.warp || direct.none)) {
        Object.assign(turn, { state: 'warn', verdict: tr('net.turnNoneNeeded') });
      }
      results = { sig, direct, turn, dns };
      lastTestAt = Date.now();
    } catch (e) {
      console.warn('[net] test hatası', e);
    } finally {
      running = false;
      setTestButton();
      renderChecks();
    }
  }

  // ------------------------------------------------------- 1b) aramadakiler
  const lossPrev = new Map();   // peerId -> { lost, recv }

  function buildPeersInfo() {
    const card = $('net-peers') && $('net-peers').closest('.net-card');
    const head = card && card.querySelector('.net-card-head');
    if (!head) return;
    head.querySelectorAll('.net-info-btn').forEach(n => n.remove());
    card.querySelectorAll('.net-info').forEach(n => n.remove());
    const info = infoToggle('call', 'net.callInfo');
    head.append(info.btn);
    card.append(info.panel);
  }

  async function peerStats(peerId, peer) {
    const out = { type: 'connecting', rtt: null, loss: null };
    if (!peer || !peer.pc) return out;
    let stats;
    try { stats = await peer.pc.getStats(); } catch (e) { return out; }
    const byId = {};
    stats.forEach(r => { byId[r.id] = r; });
    let pairId = null;
    stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId; });
    if (!pairId) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pairId = r.id; });
    const cp = pairId && byId[pairId];
    if (cp) {
      const l = byId[cp.localCandidateId] || {};
      const rm = byId[cp.remoteCandidateId] || {};
      out.type = (l.candidateType === 'relay' || rm.candidateType === 'relay') ? 'relay' : 'direct';
      if (Number.isFinite(cp.currentRoundTripTime)) out.rtt = Math.round(cp.currentRoundTripTime * 1000);
    }
    if (out.rtt == null && Number.isFinite(peer.smoothedPing)) out.rtt = Math.round(peer.smoothedPing);
    let lost = 0, recv = 0, any = false;
    stats.forEach(r => {
      if (r.type === 'inbound-rtp' && r.kind === 'audio') { any = true; lost += r.packetsLost || 0; recv += r.packetsReceived || 0; }
    });
    if (any) {
      const prev = lossPrev.get(peerId);
      lossPrev.set(peerId, { lost, recv });
      const dl = prev ? lost - prev.lost : lost;
      const dr = prev ? recv - prev.recv : recv;
      if (dl + dr > 0) out.loss = Math.max(0, Math.round((dl / (dl + dr)) * 1000) / 10);
      else if (prev) out.loss = 0;
    }
    return out;
  }

  let peersBusy = false;
  async function renderPeers() {
    const box = $('net-peers');
    if (!box || peersBusy) return;
    const s = st();
    if (!s.room) {
      lossPrev.clear();
      box.innerHTML = `<p class="settings-help net-empty">${esc(tr('net.callNone'))}</p>`;
      return;
    }
    const peers = s.peers ? Array.from(s.peers.entries()) : [];
    if (!peers.length) {
      box.innerHTML = `<p class="settings-help net-empty">${esc(tr('net.callAlone'))}</p>`;
      return;
    }
    peersBusy = true;
    try {
      const rows = await Promise.all(peers.map(async ([id, p]) => ({ id, p, s: await peerStats(id, p) })));
      box.innerHTML = rows.map(({ id, p, s: x }) => {
        const name = (typeof displayName === 'function' ? displayName(id, p.name || '') : p.name) || '—';
        let q = 'idle';
        if (x.type !== 'connecting') {
          const rtt = x.rtt == null ? 0 : x.rtt;
          const loss = x.loss == null ? 0 : x.loss;
          q = (rtt > 300 || loss > 5) ? 'bad' : ((rtt > 150 || loss > 2 || x.type === 'relay') ? 'warn' : 'ok');
        }
        const typeLabel = x.type === 'relay' ? tr('net.callRelay') : x.type === 'direct' ? tr('net.callDirect') : tr('net.callConnecting');
        const typeIcon = x.type === 'relay' ? 'shuffle' : x.type === 'direct' ? 'zap' : 'clock';
        return `<div class="net-peer" data-state="${q}" data-type="${x.type}">
          <span class="net-dot" aria-hidden="true"></span>
          <strong class="net-peer-name">${esc(name)}</strong>
          <span class="net-peer-type">${ico(typeIcon, 14)}<span>${esc(typeLabel)}</span></span>
          <span class="net-peer-metric">${x.rtt != null ? esc(tr('net.callPing', { ms: x.rtt })) : ''}</span>
          <span class="net-peer-metric">${x.loss != null ? esc(tr('net.callLoss', { p: x.loss })) : ''}</span>
        </div>`;
      }).join('');
    } finally {
      peersBusy = false;
    }
  }

  // ------------------------------------------------ 2) kendi cihazlarım (P2P)
  let myInfo = null;
  async function myDevice() {
    if (myInfo) return myInfo;
    try { myInfo = window.electronAPI && window.electronAPI.getDeviceInfo ? await window.electronAPI.getDeviceInfo() : null; } catch (e) { myInfo = null; }
    return myInfo;
  }

  let chan = null;   // { fid, slot, key }
  async function channelKey() {
    const s = st();
    if (s.accountKind !== 'cloud' || !s.friendId || !window.TSAccounts || !window.electronAPI || !window.electronAPI.getAccountChannelKey) return null;
    const slot = window.TSAccounts.currentSlot();
    if (chan && chan.fid === s.friendId && chan.slot === slot) return chan.key;
    let hex = null;
    try { hex = await window.electronAPI.getAccountChannelKey(slot); } catch (e) {}
    if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return null;
    const raw = new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    chan = { fid: s.friendId, slot, key };
    return key;
  }

  const b64 = bytes => { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

  async function sendOwn(inner) {
    const s = st();
    const c = s.globalMqtt;
    if (!c || !c.connected) return false;
    const key = await channelKey();
    const me = await myDevice();
    if (!key || !me || !DEVICE_RE.test(me.deviceId || '')) return false;
    const body = { ...inner, dv: me.deviceId, ts: Date.now(), n: Math.random().toString(36).slice(2, 12) };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(s.friendId) }, key, new TextEncoder().encode(JSON.stringify(body))));
    const all = new Uint8Array(iv.length + ct.length);
    all.set(iv, 0);
    all.set(ct, iv.length);
    try {
      c.publish(`teamsync/user/${s.friendId}/events`, JSON.stringify({ type: 'acct_dev', fromId: s.friendId, d: b64(all) }), { qos: 1 });
      return true;
    } catch (e) { return false; }
  }

  const online = new Map();      // deviceId -> { at, nm, os }
  const seenNonces = new Map();  // nonce -> at
  let lastHelloReply = 0;
  let inbox = [];
  let signingOut = false;

  async function onAccountEvent(data) {
    if (!data || typeof data.d !== 'string' || data.d.length > 4000) return;
    const now = Date.now();
    inbox = inbox.filter(x => now - x < 60000);
    if (inbox.length > 60) return;
    inbox.push(now);
    const key = await channelKey().catch(() => null);
    if (!key) return;
    let body;
    try {
      const all = unb64(data.d);
      if (all.length < 13) return;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: new TextEncoder().encode(st().friendId) }, key, all.slice(12));
      body = JSON.parse(new TextDecoder().decode(plain));
    } catch (e) { return; }   // başka hesabın / eski kodun anahtarı: yok say
    if (!body || typeof body !== 'object' || !DEVICE_RE.test(body.dv || '')) return;
    if (!Number.isFinite(body.ts) || Math.abs(now - body.ts) > 120000) return;
    if (typeof body.n !== 'string' || seenNonces.has(body.n)) return;
    seenNonces.set(body.n, now);
    if (seenNonces.size > 300) seenNonces.forEach((at, n) => { if (now - at > 130000) seenNonces.delete(n); });
    const me = await myDevice();
    if (!me || body.dv === me.deviceId) return;
    if (body.k === 'hello') {
      online.set(body.dv, {
        at: now,
        nm: typeof body.nm === 'string' ? body.nm.slice(0, 80) : '',
        os: typeof body.os === 'string' ? body.os.slice(0, 80) : ''
      });
      if (body.q && now - lastHelloReply > 3000) {
        lastHelloReply = now;
        sendOwn({ k: 'hello', nm: me.deviceName || '', os: me.osName || '' });
      }
      if (isOpen()) renderDevices(false);
    } else if (body.k === 'signout') {
      if (body.to !== '*' && body.to !== me.deviceId) return;
      if (signingOut || !window.TSAccounts || typeof window.TSAccounts.remoteSignOut !== 'function') return;
      signingOut = true;
      try {
        await window.TSAccounts.remoteSignOut();
        setTimeout(() => { if (typeof showToast === 'function') showToast(tr('net.devRemoteSignedOut'), 'warn'); }, 400);
      } finally {
        setTimeout(() => { signingOut = false; }, 5000);
      }
    } else if (body.k === 'bkreq' || body.k === 'bkkey') {
      // Mesaj yedeği anahtarı isteği / yanıtı (js/msg-backup.js).
      if (window.TSBackup) window.TSBackup.onOwnDevice(body, me.deviceId);
    } else if (body.k === 'idreq' || body.k === 'idkey') {
      // Hesap kimliği (uçtan uca şifreleme anahtarları) isteği / yanıtı (js/space/dm-e2ee.js).
      if (window.TSE2E && window.TSE2E.onOwnDevice) window.TSE2E.onOwnDevice(body, me.deviceId);
    } else if (body.k === 'gkreq') {
      // Kendi diğer cihazım grup anahtar dönemlerini soruyor (js/space/groups.js).
      if (window.TSGroups && window.TSGroups.onOwnDeviceEpochs) window.TSGroups.onOwnDeviceEpochs(body.g);
    }
  }

  async function askOwnDevices() {
    const me = await myDevice();
    if (!me) return;
    sendOwn({ k: 'hello', q: 1, nm: me.deviceName || '', os: me.osName || '' }).catch(() => {});
  }

  // --------------------------------------------------- 2) cihaz listesi (UI)
  let devRows = null;          // device_accounts satırları (null = okunamadı)
  let devLoadedFor = null;
  let devSig = '';

  async function loadDevices() {
    const s = st();
    await myDevice();
    devRows = null;
    devLoadedFor = s.friendId || null;
    if (s.accountKind === 'cloud' && typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        const sess = await withTimeout(supabaseClient.auth.getSession(), 5000, null);
        const uid = sess && sess.data && sess.data.session && sess.data.session.user && sess.data.session.user.id;
        if (uid) {
          const res = await withTimeout(supabaseClient.from('device_accounts')
            .select('device_id, device_name, os_name, last_seen, kind')
            .eq('user_id', uid).order('last_seen', { ascending: false }).limit(20), 8000, null);
          if (res && !res.error && Array.isArray(res.data)) devRows = res.data;
        }
      } catch (e) { devRows = null; }
    }
    renderDevices(true);
  }

  function goAccountButton() {
    return `<button type="button" class="settings-test-button net-go-account">${ico('devices', 15)}<span>${esc(tr('net.goAccount'))}</span></button>`;
  }
  function bindGoAccount(root) {
    root.querySelectorAll('.net-go-account').forEach(b => b.addEventListener('click', () => {
      if (typeof setSettingsPanel === 'function') setSettingsPanel('account');
    }));
  }

  function renderDevices(force) {
    const box = $('net-devices');
    if (!box) return;
    const s = st();
    const me = myInfo;
    const now = Date.now();
    const isOnline = id => { const o = online.get(id); return !!o && now - o.at < ONLINE_FRESH_MS; };
    const cloud = s.accountKind === 'cloud';
    const list = [];
    if (cloud) {
      (devRows || []).forEach(r => {
        if (!r || !DEVICE_RE.test(r.device_id || '') || (me && r.device_id === me.deviceId)) return;
        const o = online.get(r.device_id);
        list.push({ id: r.device_id, name: r.device_name || (o && o.nm) || '', os: r.os_name || (o && o.os) || '', last: r.last_seen, on: isOnline(r.device_id) });
      });
      online.forEach((o, id) => {
        if (!isOnline(id) || list.some(d => d.id === id) || (me && id === me.deviceId)) return;
        list.push({ id, name: o.nm, os: o.os, last: null, on: true });
      });
      list.sort((a, b) => (b.on - a.on) || String(b.last || '').localeCompare(String(a.last || '')));
    }
    const sig = JSON.stringify([s.accountKind, devRows ? 1 : 0, me && me.deviceId, list.map(d => [d.id, d.on, d.last, d.name])]);
    if (!force && sig === devSig) return;
    devSig = sig;

    const row = (d, mine) => `<div class="net-device${mine ? ' is-this' : ''}" data-device="${esc(d.id || '')}" data-state="${d.on ? 'ok' : 'idle'}">
        <span class="net-device-icon" aria-hidden="true">${ico('monitor', 18)}</span>
        <div class="net-device-main">
          <div class="net-device-top"><strong>${esc(d.name || tr('net.devUnnamed'))}</strong>${mine ? `<span class="settings-account-active">${esc(tr('net.devThis'))}</span>` : ''}</div>
          <span class="net-device-sub">${esc([d.os, !mine && d.last && typeof formatUserDateTime === 'function' ? tr('net.devLastLogin', { time: formatUserDateTime(d.last) }) : ''].filter(Boolean).join(' · '))}</span>
        </div>
        <span class="net-device-status"><span class="net-dot" aria-hidden="true"></span><span>${esc(tr(d.on ? 'net.devOnline' : 'net.devOffline'))}</span></span>
        ${mine ? '' : `<button type="button" class="settings-test-button net-signout-btn" data-signout="${esc(d.id)}" ${d.on ? '' : `disabled title="${esc(tr('net.devOfflineHint'))}"`}>${ico('logOut', 14)}<span>${esc(tr('net.devSignOut'))}</span></button>`}
      </div>`;

    const meRow = { id: me ? me.deviceId : '', name: me ? me.deviceName : '', os: me ? me.osName : '', on: true };
    let html = `<div class="net-devices">${row(meRow, true)}${list.map(d => row(d, false)).join('')}</div>`;
    if (!cloud) {
      html += `<div class="settings-callout net-callout" role="note">${ico('info', 18)}<p>${esc(tr('net.devLegacy'))}</p></div>${goAccountButton()}`;
    } else {
      if (!devRows) html += `<p class="settings-help">${esc(tr('net.devServerUnreachable'))}</p>`;
      else if (!list.length) html += `<p class="settings-help">${esc(tr('net.devNoOthers'))}</p>`;
      html += `<div class="net-actions"><button type="button" id="net-signout-all" class="settings-test-button net-danger-btn">${ico('logOut', 15)}<span>${esc(tr('net.devSignOutAll'))}</span></button></div>`;
    }
    box.innerHTML = html;
    const info = infoToggle('devices', 'net.devInfo');
    box.append(info.btn, info.panel);
    bindGoAccount(box);
    box.querySelectorAll('[data-signout]').forEach(b => b.addEventListener('click', () => signOutDevice(b.dataset.signout)));
    $('net-signout-all')?.addEventListener('click', signOutAll);
  }

  async function signOutDevice(deviceId) {
    if (!DEVICE_RE.test(deviceId || '')) return;
    const r = (devRows || []).find(x => x.device_id === deviceId);
    const o = online.get(deviceId);
    const name = (r && r.device_name) || (o && o.nm) || tr('net.devUnnamed');
    const ok = await window.showConfirm(tr('net.devSignOutTitle'), tr('net.devSignOutConfirm', { name }), { danger: true, confirmText: tr('net.devSignOut') });
    if (!ok) return;
    const sent = await sendOwn({ k: 'signout', to: deviceId });
    showToast(tr(sent ? 'net.devSent' : 'net.devSendFailed'), sent ? 'ok' : 'danger');
    if (sent) { online.delete(deviceId); renderDevices(true); }
  }

  async function signOutAll() {
    const ok = await window.showConfirm(tr('net.devSignOutAllTitle'), tr('net.devSignOutAllConfirm'), { danger: true, confirmText: tr('net.devSignOutAll') });
    if (!ok) return;
    const sent = await sendOwn({ k: 'signout', to: '*' });
    let server = false;
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      try { const { error } = await supabaseClient.auth.signOut({ scope: 'others' }); server = !error; } catch (e) {}
    }
    showToast(tr(sent || server ? 'net.devSentAll' : 'net.devSendFailed'), sent || server ? 'ok' : 'danger');
    if (sent) { online.clear(); renderDevices(true); }
  }

  // ------------------------------------------------------ 3) yeni cihaz bağla
  async function renderNewDevice() {
    const box = $('net-newdev');
    if (!box) return;
    const s = st();
    if (s.accountKind !== 'cloud') {
      box.innerHTML = `<div class="settings-callout net-callout" role="note">${ico('info', 18)}<p>${esc(tr('net.newLegacy'))}</p></div>${goAccountButton()}`;
      bindGoAccount(box);
      return;
    }
    const acc = window.TSAccounts;
    const slot = acc ? acc.currentSlot() : 0;
    const imported = !!(acc && acc.isImportedSlot(slot));
    const steps = ['net.newStep1', 'net.newStep2', 'net.newStep3'];
    // Mesaj yedeği açıksa DM geçmişi, gruplar ve sunucu listesi de gelir.
    const backupOn = !!(window.TSBackup && window.TSBackup.isActive());
    box.innerHTML = `
      <ol class="net-steps">${steps.map((k, i) => `<li><span class="net-step-num" aria-hidden="true">${i + 1}</span><span>${esc(tr(k))}</span></li>`).join('')}</ol>
      <label class="settings-field-label" for="net-login-code">${esc(tr('net.newCodeLabel'))}</label>
      <div class="settings-code-row">
        <code id="net-login-code" class="settings-code is-masked" tabindex="0">${'•'.repeat(32)}</code>
        <button id="net-login-code-toggle" class="settings-test-button" type="button">${esc(tr('settings.show'))}</button>
        <button id="net-login-code-copy" class="settings-test-button" type="button">${esc(tr('settings.copy'))}</button>
      </div>
      <p id="net-login-code-missing" class="settings-help" hidden>${esc(tr('net.newNoCode'))}</p>
      <div class="settings-callout is-warn" role="note">${ico('alert', 18)}<p>${esc(tr('net.newWarn'))}</p></div>
      <p class="settings-help">${esc(tr('net.newSlots', { n: acc ? acc.count() : 0, max: acc ? acc.max : 3 }))}</p>
      <div class="net-moves">
        <div><strong>${ico('check', 14)}<span>${esc(tr('net.newMovesTitle'))}</span></strong><p>${esc(tr('net.newMoves'))}</p><p>${esc(tr('net.newMovesAvatar'))}</p><p class="net-moves-keys">${ico('lock', 13)}<span>${esc(tr(backupOn ? 'net.newMovesKeysBackup' : 'net.newMovesKeys'))}</span></p>${backupOn ?`<p class="net-moves-backup" data-backup="on">${ico('shield', 13)}<span>${esc(tr('net.newMovesBackup'))}</span></p>` : ''}</div>
        <div><strong>${ico('monitor', 14)}<span>${esc(tr('net.newStaysTitle'))}</span></strong><p>${esc(tr(backupOn ? 'net.newStaysBackup' : 'net.newStays'))}</p></div>
      </div>
      <div class="net-rotate">
        <div><strong>${esc(tr('net.newRotate'))}</strong><p>${esc(tr(imported ? 'net.newRotateImported' : 'net.newRotateDesc'))}</p></div>
        ${imported ? '' : `<button id="net-rotate-btn" class="settings-test-button net-danger-btn" type="button">${ico('refresh', 14)}<span>${esc(tr('net.newRotate'))}</span></button>`}
      </div>`;
    const codeEl = $('net-login-code');
    const toggle = $('net-login-code-toggle');
    const copy = $('net-login-code-copy');
    toggle.addEventListener('click', () => { if (window.TSAccountCode && window.TSAccountCode.has()) window.TSAccountCode.toggle(codeEl, toggle); });
    copy.addEventListener('click', () => window.TSAccountCode && window.TSAccountCode.copy());
    $('net-rotate-btn')?.addEventListener('click', rotateCode);
    const has = window.TSAccountCode ? await window.TSAccountCode.load() : false;
    toggle.disabled = !has;
    copy.disabled = !has;
    const miss = $('net-login-code-missing');
    if (miss) miss.hidden = has;
  }

  // Giriş kodunu yenileme. Sıra: açık cihazlara (eski anahtarla) çıkış
  // komutu → yeni sayaç "pending" diske → Supabase parolası → commit. Ağ
  // hatasında pending bırakılır: renderer.js deviceLogin önce eski, olmazsa
  // yeni parolayla dener; sahibi kendi hesabından asla kilitlenmez.
  async function rotateCode() {
    const btn = $('net-rotate-btn');
    const acc = window.TSAccounts;
    const api = window.electronAPI;
    if (!acc || !api || !api.codeRotation || typeof supabaseClient === 'undefined' || !supabaseClient) {
      showToast(tr('net.newRotateFailed'), 'danger');
      return;
    }
    const slot = acc.currentSlot();
    if (acc.isImportedSlot(slot)) return;
    const ok = await window.showConfirm(tr('net.newRotateTitle'), tr('net.newRotateConfirm'), { danger: true, confirmText: tr('net.newRotate') });
    if (!ok) return;
    if (btn) btn.disabled = true;
    try {
      await sendOwn({ k: 'signout', to: '*' }).catch(() => false);
      const begin = await api.codeRotation(slot, 'begin');
      if (!begin || !begin.password) throw new Error('storage');
      const { error } = await supabaseClient.auth.updateUser({ password: begin.password });
      if (error) {
        const netErr = error.name === 'AuthRetryableFetchError' || !error.status || error.status >= 500;
        if (!netErr) await api.codeRotation(slot, 'abort');
        throw error;
      }
      await api.codeRotation(slot, 'commit');
      try { await supabaseClient.auth.signOut({ scope: 'others' }); } catch (e) {}
      chan = null;
      online.clear();
      showToast(tr('net.newRotateDone'), 'ok');
      await renderNewDevice();
      renderDevices(true);
    } catch (e) {
      showToast(tr('net.newRotateFailed') + (e && e.message ? e.message : ''), 'danger');
      if (btn) btn.disabled = false;
    }
  }

  // ----------------------------------------------------------- 4) kurucu
  let founderSig = '';
  function renderFounder(force) {
    const box = $('net-founder');
    if (!box) return;
    const s = st();
    const inRoom = !!s.room;
    const mine = inRoom && !!s.isRoomFounder;
    const sig = `${inRoom}|${mine}`;
    if (force || sig !== founderSig || !$('net-autohost-default')) {
      founderSig = sig;
      box.innerHTML = `
        <div class="net-card-head"><strong>${ico('crown', 16)}<span>${esc(tr('net.founderLabel'))}</span></strong></div>
        <p class="settings-help net-founder-text">${esc(tr('net.founderWhat'))}</p>
        <p class="settings-help net-founder-text">${esc(tr('net.founderAuto'))}</p>
        <div class="settings-row net-switch-row">
          <div><strong id="net-autohost-default-label">${esc(tr('net.founderDefault'))}</strong><p>${esc(tr('net.founderDefaultDesc'))}</p></div>
          <label class="switch"><input type="checkbox" id="net-autohost-default" aria-labelledby="net-autohost-default-label"><span class="slider round"></span></label>
        </div>
        ${inRoom ? `<div class="settings-row net-switch-row">
          <div><strong id="net-autohost-room-label">${esc(tr('net.founderRoom'))}</strong><p id="net-autohost-room-desc">${esc(tr(mine ? 'net.founderRoomMine' : 'net.founderRoomOther'))}</p></div>
          <label class="switch"><input type="checkbox" id="net-autohost-room" aria-labelledby="net-autohost-room-label" aria-describedby="net-autohost-room-desc" ${mine ? '' : 'disabled'}><span class="slider round"></span></label>
        </div>` : ''}`;
      const info = infoToggle('founder', 'net.founderOff');
      box.append(info.btn, info.panel);
      $('net-autohost-default').addEventListener('change', e => {
        const on = !!e.target.checked;
        if (typeof setAutoHostDefault === 'function') setAutoHostDefault(on);
        if (st().room && st().isRoomFounder && typeof setRoomAutoHost === 'function') setRoomAutoHost(on);
        renderFounder(false);
      });
      $('net-autohost-room')?.addEventListener('change', e => {
        if (typeof setRoomAutoHost !== 'function' || !setRoomAutoHost(e.target.checked)) e.target.checked = !!st().autoHost;
      });
    }
    const def = $('net-autohost-default');
    if (def && typeof getAutoHostDefault === 'function') def.checked = getAutoHostDefault();
    const room = $('net-autohost-room');
    if (room) room.checked = !!s.autoHost;
  }

  document.addEventListener('ts:autohost', () => { if (isOpen()) renderFounder(false); });
  document.addEventListener('ts:founder', () => { if (isOpen()) renderFounder(false); });

  // Gelişmiş (DNS / TURN) aç-kapa.
  function bindAdvanced() {
    const btn = $('net-advanced-toggle');
    const body = $('net-advanced');
    if (!btn || !body || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const show = body.classList.contains('hidden');
      body.classList.toggle('hidden', !show);
      btn.setAttribute('aria-expanded', String(show));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAdvanced);
  else bindAdvanced();

  window.TSNetSettings = { open, runTest, onAccountEvent, askOwnDevices, isOpen, sendOwn, _state: () => ({ results, running, online: Array.from(online.keys()) }) };
})();
