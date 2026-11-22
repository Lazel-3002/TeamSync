// Sesli oda oturumu — masaüstü odasıyla birebir aynı tel protokolü
// (renderer.js setupInternetSignaling / processSignal / createPeerConnection):
//
//   abonelik : teamsync/room/<oda>/#                (qos 1)
//   hello    : teamsync/room/<oda>/<benimId>        3 sn'de bir
//   sinyal   : teamsync/room/<oda>/<hedefId>        {type:'signal', id, name, target, signal}
//              signal.type ∈ offer | answer | ice | restart-req
//   veri     : WebRTC 'app' kanalı (initiator açar) — state, ping-req/ping-res,
//              kurucu komutları (kick_peer, ban_peer, force_mute) YALNIZCA buradan.
//
// Kim offer üretir: masaüstündeki kural `isInitiator = myId > peer.id`.
// Telefon kimliği '-' ile başlar ('-' izin verilen en küçük karakter); böylece
// PC her zaman offer'ı üretir, telefon cevaplar. Telefon ↔ telefon için iki
// taraf da '-' ile başladığından kural yine tek bir initiator seçer.

import { createMultiBrokerClient } from './mqtt-multi.js';

const HELLO_MS = 3000;
const PEER_GONE_MS = 12000;   // masaüstü de 12 sn sessiz eşi düşürür
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const isValidId = v => typeof v === 'string' && ID_RE.test(v);

function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return '-m' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

function isJunkCandidate(cand) {
  const line = ((cand && cand.candidate) || '').toLowerCase();
  if (!line) return false;
  const addr = line.split(' ')[4] || '';
  return addr.startsWith('127.') || addr === '::1' || addr.startsWith('fe80:')
    || addr.startsWith('2001:0:') || addr.startsWith('2001:0000:');
}

function turnEntriesFrom(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(s => s && (typeof s.urls === 'string' || Array.isArray(s.urls))
    && [].concat(s.urls).every(u => typeof u === 'string' && /^turns?:/.test(u))
    && typeof s.username === 'string' && typeof s.credential === 'string').slice(0, 6);
}

export class RoomSession {
  constructor({ roomId, name, turn, noiseSuppression = true, onChange, onStatus, onLeft, onPeer }) {
    this.roomId = roomId;
    this.name = name;
    this.myId = randomId();
    this.userTurn = turnEntriesFrom(turn ? [turn] : []);
    this.sharedTurn = [];
    this.peers = new Map();
    this.founderId = null;
    this.micOn = true;
    this.serverMuted = false;
    this.joinedAt = Date.now();
    this.onChange = onChange || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onLeft = onLeft || (() => {});
    this.onPeer = onPeer || (() => {});
    this.wantRnnoise = !!noiseSuppression;
    this.noiseMode = 'system';
    this.audioCtx = null;
  }

  iceServers() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      ...this.userTurn,
      ...this.sharedTurn,
    ];
  }

  async start() {
    this.onStatus('mic');
    await this.setupMic();
    this.applyMic();
    this.onStatus('connecting');
    const client = createMultiBrokerClient('oda', () => 'sig-' + this.myId + '-' + Math.random().toString(16).slice(2, 8));
    this.mqtt = client;
    client.on('connect', () => {
      client.subscribe(`teamsync/room/${this.roomId}/#`, { qos: 1 });
      this.sendHello();
      this.onStatus('online');
    });
    client.on('close', () => this.onStatus('offline'));
    client.on('brokers', () => this.onChange());
    client.on('message', (topic, message) => this.onMqtt(topic, message));
    this.helloTimer = setInterval(() => this.sendHello(), HELLO_MS);
    this.sweepTimer = setInterval(() => this.sweep(), 2000);
  }

  // Mikrofon zinciri. RNNoise (masaüstündeki gürültü engelleme, vendor/rnnoise)
  // açıksa: ham mikrofon → RNNoise → gönderilen akış; telefonun kendi gürültü
  // azaltması o zaman kapatılır (ikisi üst üste sesi bozar). Kurulamazsa
  // telefonun kendi gürültü azaltmasına dönülür.
  async setupMic() {
    const rn = window.RNNoiseSuppression;
    const tryRn = this.wantRnnoise && rn && rn.isSupported();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: !tryRn, autoGainControl: true },
      video: false,
    });
    this.sendStream = this.stream;
    if (!tryRn) return;
    try {
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      const node = await rn.createNoiseFilter({ audioContext: ctx, onError: () => this.rnnoiseFailed() });
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(this.stream).connect(node);
      node.connect(dest);
      this.micCtx = ctx;
      this.rnNode = node;
      this.sendStream = dest.stream;
      this.noiseMode = 'rnnoise';
    } catch (e) {
      console.warn('RNNoise kurulamadı, telefonun kendi gürültü azaltması kullanılıyor:', e);
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
      });
      this.sendStream = this.stream;
    }
  }

  // Çalışırken RNNoise durursa sessizlik gitmesin: ham mikrofona geç.
  rnnoiseFailed() {
    if (this.noiseMode !== 'rnnoise') return;
    this.noiseMode = 'system';
    const raw = this.stream.getAudioTracks()[0];
    this.sendStream = this.stream;
    this.peers.forEach(p => p.pc.getSenders().forEach(sn => { if (sn.track && sn.track.kind === 'audio') sn.replaceTrack(raw).catch(() => {}); }));
    this.onChange();
  }

  sendHello() {
    if (!this.mqtt || !this.mqtt.connected) return;
    this.mqtt.publish(`teamsync/room/${this.roomId}/${this.myId}`, JSON.stringify({
      type: 'hello',
      id: this.myId,
      name: this.name,
      friendId: null,
      avatar: null,
      isRoomFounder: false,
      isModerator: false,
      joinedAt: this.joinedAt,
      // Kendi TURN'ümüzü odadakilerle paylaş (masaüstü getShareableTurn ile aynı).
      turn: this.userTurn.length ? this.userTurn : undefined,
      // Yeni alan: PC eşin telefondan katıldığını görebilsin. Eski sürümler yok sayar.
      plat: 'android',
    }));
  }

  onMqtt(topic, message) {
    if (!message || message.length > 2_000_000 || topic.endsWith('/file')) return;
    let data;
    try { data = JSON.parse(new TextDecoder().decode(message)); } catch (e) { return; }
    if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !isValidId(data.id) || data.id === this.myId) return;

    if (data.type === 'hello') {
      if (data.isRoomFounder && (!this.founderId || this.founderId === data.id || !this.peers.has(this.founderId))) this.founderId = data.id;
      const shared = turnEntriesFrom(data.turn);
      if (shared.length && JSON.stringify(shared) !== JSON.stringify(this.sharedTurn)) this.sharedTurn = shared;
      this.discover(data.id, data.name, data.plat);
    } else if (data.type === 'signal' && data.target === this.myId) {
      const peer = this.discover(data.id, data.name);
      if (peer) this.queueSignal(peer, data.signal);
    }
  }

  discover(id, name, plat) {
    let peer = this.peers.get(id);
    const cleanName = typeof name === 'string' && name.trim() ? name.slice(0, 60) : 'Bilinmeyen';
    if (peer) {
      peer.lastSeen = Date.now();
      if (peer.name !== cleanName) { peer.name = cleanName; this.onChange(); }
      if (plat) peer.plat = plat;
      return peer;
    }
    peer = this.createPeer(id, cleanName, this.myId > id);
    if (plat) peer.plat = plat;
    return peer;
  }

  createPeer(id, name, isInitiator) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    const peer = {
      id, name, pc, isInitiator, dc: null, lastSeen: Date.now(), iceQueue: [], localCandidates: [],
      chain: Promise.resolve(), mic: true, speaking: false, route: '', audio: null,
    };
    this.peers.set(id, peer);
    this.sendStream.getTracks().forEach(t => pc.addTrack(t, this.sendStream));

    pc.onicecandidate = (e) => {
      if (!e.candidate || isJunkCandidate(e.candidate)) return;
      const c = JSON.parse(JSON.stringify(e.candidate));
      peer.localCandidates.push(c);
      this.signal(id, { type: 'ice', candidate: c });
    };
    pc.ontrack = (e) => {
      if (e.track.kind !== 'audio') return;
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (!peer.audio) {
        peer.audio = document.createElement('audio');
        peer.audio.autoplay = true;
        peer.audio.playsInline = true;
        document.body.appendChild(peer.audio);
      }
      // Masaüstü ekran sesi için ikinci bir ses kanalı açabilir; ilk akış mikrofondur.
      if (!peer.audio.srcObject) {
        peer.audio.srcObject = stream;
        peer.audio.play().catch(() => {});
        this.watchLevel(peer, stream);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.detectRoute(peer);
        if (!peer.announced) { peer.announced = true; this.onPeer('join', peer); }
      }
      if (pc.connectionState === 'failed' && peer.isInitiator) this.restart(peer);
      if (pc.connectionState === 'failed' && !peer.isInitiator) this.signal(id, { type: 'restart-req' });
      this.onChange();
    };
    if (isInitiator) {
      this.bindChannel(peer, pc.createDataChannel('app', { ordered: true }));
      this.makeOffer(peer);
      // Masaüstüyle aynı bekçi: bağlanana kadar offer'ı yinele.
      peer.watchdog = setInterval(() => {
        if (!this.peers.has(id) || ['connected', 'closed'].includes(pc.connectionState)) { clearInterval(peer.watchdog); return; }
        if (pc.signalingState === 'have-local-offer') this.signal(id, { type: 'offer', sdp: JSON.parse(JSON.stringify(pc.localDescription)) });
      }, 5000);
    }
    pc.ondatachannel = (e) => { if (e.channel.label === 'app') this.bindChannel(peer, e.channel); };
    this.onChange();
    return peer;
  }

  async makeOffer(peer, iceRestart = false) {
    try {
      const offer = await peer.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await peer.pc.setLocalDescription(offer);
      this.signal(peer.id, { type: 'offer', sdp: JSON.parse(JSON.stringify(peer.pc.localDescription)) });
    } catch (e) { console.warn('offer', e); }
  }

  restart(peer) {
    try { peer.pc.setConfiguration({ iceServers: this.iceServers() }); } catch (e) {}
    this.makeOffer(peer, true);
  }

  queueSignal(peer, signal) {
    peer.chain = peer.chain.then(() => this.processSignal(peer, signal)).catch(e => console.warn('signal', e));
  }

  async processSignal(peer, signal) {
    if (!signal || typeof signal !== 'object' || !['offer', 'answer', 'ice', 'restart-req'].includes(signal.type)) return;
    const pc = peer.pc;
    peer.lastSeen = Date.now();
    if (signal.type === 'offer') {
      if (!signal.sdp || typeof signal.sdp.sdp !== 'string') return;
      if (pc.signalingState === 'stable' && pc.remoteDescription && pc.remoteDescription.sdp === signal.sdp.sdp) {
        // Kopya offer: cevabı ve adayları yeniden gönder (karşı taraf kaçırmış olabilir).
        if (pc.localDescription && pc.localDescription.type === 'answer') {
          this.signal(peer.id, { type: 'answer', sdp: JSON.parse(JSON.stringify(pc.localDescription)) });
          peer.localCandidates.forEach(c => this.signal(peer.id, { type: 'ice', candidate: c }));
        }
        return;
      }
      if (pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' });
      // Yeni TURN bilgisi gelmiş olabilir.
      try { pc.setConfiguration({ iceServers: this.iceServers() }); } catch (e) {}
      await pc.setRemoteDescription(signal.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signal(peer.id, { type: 'answer', sdp: JSON.parse(JSON.stringify(pc.localDescription)) });
      while (peer.iceQueue.length) await pc.addIceCandidate(peer.iceQueue.shift());
    } else if (signal.type === 'answer') {
      if (pc.signalingState !== 'have-local-offer' || !signal.sdp) return;
      await pc.setRemoteDescription(signal.sdp);
      while (peer.iceQueue.length) await pc.addIceCandidate(peer.iceQueue.shift());
    } else if (signal.type === 'ice') {
      const c = signal.candidate;
      if (!c || (!c.candidate && c.sdpMid == null && c.sdpMLineIndex == null) || isJunkCandidate(c)) return;
      if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(c);
      else peer.iceQueue.push(c);
    } else if (signal.type === 'restart-req') {
      if (peer.isInitiator) this.restart(peer);
    }
  }

  signal(targetId, signal) {
    if (!this.mqtt) return;
    this.mqtt.publish(`teamsync/room/${this.roomId}/${targetId}`, JSON.stringify({
      type: 'signal', id: this.myId, name: this.name, target: targetId, signal,
    }));
  }

  bindChannel(peer, dc) {
    peer.dc = dc;
    dc.onopen = () => { try { dc.send(JSON.stringify({ type: 'state', mic: this.effectiveMic(), deaf: false })); } catch (e) {} };
    dc.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      peer.lastSeen = Date.now();
      if (msg.type === 'ping-req') { try { dc.send(JSON.stringify({ type: 'ping-res', ts: msg.ts })); } catch (err) {} return; }
      if (msg.type === 'state') {
        if (typeof msg.mic === 'boolean') peer.mic = msg.mic;
        this.onChange();
        return;
      }
      // Yetki gerektiren komutlar: yalnızca kurucudan ve yalnızca veri kanalından.
      if (peer.id !== this.founderId) return;
      if ((msg.type === 'kick_peer' || msg.type === 'ban_peer') && msg.targetId === this.myId) {
        this.leave(msg.type === 'ban_peer' ? 'banned' : 'kicked');
      } else if (msg.type === 'force_mute' && msg.targetId === this.myId) {
        this.serverMuted = true; this.applyMic();
      } else if (msg.type === 'force_unmute' && msg.targetId === this.myId) {
        this.serverMuted = false; this.applyMic();
      }
    };
  }

  effectiveMic() { return this.micOn && !this.serverMuted; }

  applyMic() {
    const on = this.effectiveMic();
    if (this.stream) this.stream.getAudioTracks().forEach(t => { t.enabled = on; });
    this.peers.forEach(p => { if (p.dc && p.dc.readyState === 'open') { try { p.dc.send(JSON.stringify({ type: 'state', mic: on })); } catch (e) {} } });
    this.onChange();
  }

  setMic(on) { this.micOn = !!on; this.applyMic(); }

  async detectRoute(peer) {
    try {
      const stats = await peer.pc.getStats();
      let pair = null;
      stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
      if (!pair) stats.forEach(s => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
      const local = pair && stats.get(pair.localCandidateId);
      const remote = pair && stats.get(pair.remoteCandidateId);
      peer.route = (local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay') ? 'relay' : 'direct';
      this.onChange();
    } catch (e) {}
  }

  watchLevel(peer, stream) {
    try {
      this.audioCtx = this.audioCtx || new AudioContext();
      const src = this.audioCtx.createMediaStreamSource(stream);
      const an = this.audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      peer.levelTimer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const speaking = Math.sqrt(sum / buf.length) > 0.04;
        if (speaking !== peer.speaking) { peer.speaking = speaking; this.onChange(); }
      }, 200);
    } catch (e) {}
  }

  sweep() {
    const now = Date.now();
    this.peers.forEach(p => {
      if (now - p.lastSeen > PEER_GONE_MS) this.dropPeer(p.id);
    });
  }

  dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    if (p.announced && !this.left) this.onPeer('leave', p);
    clearInterval(p.watchdog);
    clearInterval(p.levelTimer);
    try { p.pc.close(); } catch (e) {}
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    this.onChange();
  }

  brokers() { return this.mqtt ? this.mqtt.brokers() : []; }

  leave(reason = 'left') {
    if (this.left) return;
    this.left = true;
    clearInterval(this.helloTimer);
    clearInterval(this.sweepTimer);
    [...this.peers.keys()].forEach(id => this.dropPeer(id));
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.rnNode && window.RNNoiseSuppression) window.RNNoiseSuppression.releaseFilter(this.rnNode);
    if (this.micCtx) { try { this.micCtx.close(); } catch (e) {} }
    if (this.mqtt) this.mqtt.end();
    if (this.audioCtx) { try { this.audioCtx.close(); } catch (e) {} }
    this.onLeft(reason);
  }
}
