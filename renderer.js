const params = (() => {
  return window.__params || { name: '', room: '', password: '' };
})();

const state = {
  myId: crypto.randomUUID(),
  myName: '',
  room: '',
  password: '',
  peers: new Map(),
  localStream: null,
  cameraStream: null,
  screenStream: null,
  processedStream: null,
  audioCtx: null,
  micEnabled: true,
  deafened: false,
  cameraOn: false,
  isSharing: false,
  isRecording: false,
  recordingStream: null,
  recorder: null,
  recordedChunks: [],
  recStart: 0,
  pttMode: false,
  pttActive: false,
  volume: 1.0,
  useAI: true,
  activeControl: null,
  pendingControlReq: null,
  speakingPeers: new Map(),
  analyser: null,
  gainNode: null,
  cryptoKey: null,
  wbContext: null,
  drawing: false,
  micThreshold: 20
};

const CHUNK_SIZE = 64 * 1024;
const fileBuffer = new Map();

async function setupCrypto(password) {
  if (!password) return null;
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('kanka-salt'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
}

async function encryptMsg(text, key) {
  if (!key) return null;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { cipher: Array.from(new Uint8Array(cipher)), iv: Array.from(iv) };
}

async function decryptMsg(data, key) {
  if (!key) return null;
  try {
    const dec = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(data.iv) }, key, new Uint8Array(data.cipher)
    );
    return new TextDecoder().decode(dec);
  } catch (e) { return null; }
}

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

window.addEventListener('DOMContentLoaded', async () => {
  const stepName = document.getElementById('step-name');
  const stepAction = document.getElementById('step-action');
  const stepJoin = document.getElementById('step-join');
  const stepCreate = document.getElementById('step-create');

  const nameInp = document.getElementById('name');
  const btnNextName = document.getElementById('btn-next-name');
  const displayName = document.getElementById('display-name');

  const btnShowJoin = document.getElementById('btn-show-join');
  const btnShowCreate = document.getElementById('btn-show-create');
  
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      stepJoin.classList.add('hidden');
      stepCreate.classList.add('hidden');
      stepAction.classList.remove('hidden');
    });
  });

  const btnJoin = document.getElementById('btn-join');
  const joinId = document.getElementById('join-id');
  const joinPw = document.getElementById('join-password');
  const joinAi = document.getElementById('join-useAI');
  const joinPtt = document.getElementById('join-usePTT');

  const btnCreate = document.getElementById('btn-create');
  const createName = document.getElementById('create-name');
  const createPw = document.getElementById('create-password');
  const createAi = document.getElementById('create-useAI');
  const createPtt = document.getElementById('create-usePTT');

  try {
    const ips = await window.electronAPI.getLocalIPs();
    if (ips.length) {
      document.getElementById('my-ip').innerHTML =
        `🌐 Senin IP: <code>${ips[0].address}</code> (aynı ağdaki arkadaşın otomatik bulur)`;
    }
  } catch (e) {}

  btnNextName.addEventListener('click', () => {
    const n = nameInp.value.trim() || 'Anonim';
    state.myName = n;
    displayName.textContent = n;
    stepName.classList.add('hidden');
    stepAction.classList.remove('hidden');
  });

  btnShowJoin.addEventListener('click', () => {
    stepAction.classList.add('hidden');
    stepJoin.classList.remove('hidden');
  });

  btnShowCreate.addEventListener('click', () => {
    stepAction.classList.add('hidden');
    stepCreate.classList.remove('hidden');
  });

  const startApp = async (roomId, pw, useAI, pttMode, serverName) => {
    state.room = roomId;
    state.password = pw;
    state.useAI = useAI;
    state.pttMode = pttMode;

    try {
      state.cryptoKey = await setupCrypto(state.password);
      await setupLocalAudio();
      if (!state.uiBound) {
        bindUI();
        initWhiteboard();
        initFileTransfer();
        setupVUMeter();
        await setupDeviceList();
        state.uiBound = true;
      }
      
      document.getElementById('login').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      document.getElementById('room-title').textContent = '# ' + serverName + (state.cryptoKey ? ' 🔒' : '');
      document.getElementById('display-server-id').textContent = roomId;
      
      addUser({ id: 'self', name: state.myName + ' (sen)', mic: true, deaf: false, sharing: false, self: true });
      
      window.electronAPI.startDiscovery(state.myId, state.myName, state.room);
      if (!state.ipcAttached) {
        window.electronAPI.onPeerDiscovered((event, peer) => {
          handlePeerDiscovered(peer);
        });
        window.electronAPI.onUDPSignal(async (event, { id, ip, signal }) => {
          const peer = state.peers.get(id);
          if (!peer) return;
          if (!peer.ip) peer.ip = ip;
          try {
            if (signal.type === 'offer') {
              await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
              const answer = await peer.pc.createAnswer();
              await peer.pc.setLocalDescription(answer);
              window.electronAPI.sendUDPSignal(ip, { type: 'answer', sdp: answer });
            } else if (signal.type === 'answer') {
              await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            } else if (signal.type === 'ice') {
              await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
          } catch (e) {
            console.error('Signal handle error:', e);
          }
        });
        state.ipcAttached = true;
      }

      if (state.pttMode) {
        window.electronAPI.registerPTT('Space');
        if (!state.pttAttached) {
          window.electronAPI.onPTT(() => {
            if (!state.pttMode) return;
            state.pttActive = true;
            document.getElementById('ptt').classList.add('active');
            setMicEnabled(true);
          });
          document.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && state.pttMode) {
              state.pttActive = false;
              document.getElementById('ptt').classList.remove('active');
              setMicEnabled(false);
            }
          });
          state.pttAttached = true;
        }
      }

      setConnStatus(true);
    } catch (err) {
      alert('Hata: ' + err.message);
      console.error(err);
    }
  };

  btnJoin.addEventListener('click', () => {
    const roomId = joinId.value.trim().toUpperCase();
    if (!roomId) return alert("Lütfen bir Sunucu ID girin!");
    startApp(roomId, joinPw.value, joinAi.checked, joinPtt.checked, "Sunucu " + roomId);
  });

  btnCreate.addEventListener('click', () => {
    const sName = createName.value.trim() || 'Oyun Odası';
    const newRoomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    startApp(newRoomId, createPw.value, createAi.checked, createPtt.checked, sName);
  });

  document.getElementById('btn-copy-id').addEventListener('click', () => {
    const idText = document.getElementById('display-server-id').textContent;
    navigator.clipboard.writeText(idText).then(() => {
      showToast('ID Kopyalandı: ' + idText, 'ok');
    });
  });
});

function setConnStatus(connected) {
  const dot = document.getElementById('conn');
  if (dot) dot.classList.toggle('on', !!connected);
}

function playSound(type) {
  try {
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.connect(gain);
    gain.connect(actx.destination);

    if (type === 'on') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, actx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, actx.currentTime + 0.1);
      gain.gain.setValueAtTime(0, actx.currentTime);
      gain.gain.linearRampToValueAtTime(0.1, actx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, actx.currentTime + 0.15);
      osc.start(actx.currentTime);
      osc.stop(actx.currentTime + 0.15);
    } else if (type === 'off') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, actx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, actx.currentTime + 0.1);
      gain.gain.setValueAtTime(0, actx.currentTime);
      gain.gain.linearRampToValueAtTime(0.1, actx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, actx.currentTime + 0.15);
      osc.start(actx.currentTime);
      osc.stop(actx.currentTime + 0.15);
    }
  } catch(e) {}
}

async function setupLocalAudio() {
  const raw = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1
    }
  });

  const vuCtx = new (window.AudioContext || window.webkitAudioContext)();
  state.gateAudioCtx = vuCtx;
  const vuSrc = vuCtx.createMediaStreamSource(raw);
  
  state.vuAnalyser = vuCtx.createAnalyser();
  state.vuAnalyser.fftSize = 512;
  vuSrc.connect(state.vuAnalyser);

  state.gateGainNode = vuCtx.createGain();
  vuSrc.connect(state.gateGainNode);
  
  const dest = vuCtx.createMediaStreamDestination();
  state.gateGainNode.connect(dest);

  let gatedStream = dest.stream;

  if (state.useAI) {
    try {
      state.processedStream = await applyAIDenoise(gatedStream);
    } catch (e) {
      console.warn('AI denoise başarısız:', e);
      state.processedStream = gatedStream;
    }
  } else {
    state.processedStream = gatedStream;
  }
  state.localStream = state.processedStream;
}

async function applyAIDenoise(stream) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  state.audioCtx = audioCtx;
  const source = audioCtx.createMediaStreamSource(stream);

  const highpass = audioCtx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 80;

  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 12000;

  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 30;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.25;

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.0;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(compressor);
  compressor.connect(gainNode);

  const dest = audioCtx.createMediaStreamDestination();
  gainNode.connect(dest);

  return dest.stream;
}

function setupVUMeter() {
  if (!state.vuAnalyser) return;
  const data = new Uint8Array(state.vuAnalyser.frequencyBinCount);
  const vuBar = document.getElementById('vu');
  const vuText = document.getElementById('vu-text');

  function update() {
    if (!state.vuAnalyser) return;
    state.vuAnalyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const db = 20 * Math.log10(rms / 255 || 0.0001);
    const pct = Math.min(100, Math.max(0, (db + 60) * 100 / 60));

    const isSpeaking = pct > state.micThreshold;
    
    if (state.gateGainNode && state.gateAudioCtx) {
      if (!isSpeaking) {
        state.gateGainNode.gain.setTargetAtTime(0, state.gateAudioCtx.currentTime, 0.05);
        if (state.isSpeakingLocally) { state.isSpeakingLocally = false; updateUserUI('self'); }
      } else {
        state.gateGainNode.gain.setTargetAtTime(1, state.gateAudioCtx.currentTime, 0.05);
        if (!state.isSpeakingLocally) { state.isSpeakingLocally = true; updateUserUI('self'); }
      }
    }

    if (vuBar) {
      vuBar.style.width = pct + '%';
      vuBar.classList.toggle('muted-bar', !isSpeaking);
    }
    if (vuText) vuText.textContent = db.toFixed(0) + ' dB';
    requestAnimationFrame(update);
  }
  update();
}

async function setupDeviceList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const sel = document.getElementById('mic-select');
    sel.innerHTML = '';
    devices.filter(d => d.kind === 'audioinput').forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || 'Mikrofon ' + (sel.children.length + 1);
      sel.appendChild(opt);
    });
    sel.addEventListener('change', async () => {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: sel.value }, echoCancellation: true, autoGainControl: true }
      });
      const newTrack = newStream.getAudioTracks()[0];
      state.localStream.getAudioTracks().forEach(t => state.localStream.removeTrack(t));
      state.localStream.addTrack(newTrack);
      state.peers.forEach(peer => {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) sender.replaceTrack(newTrack);
      });
    });
  } catch (e) {}
}

async function handlePeerDiscovered(peer) {
  if (state.peers.has(peer.id)) {
    const existing = state.peers.get(peer.id);
    existing.lastSeen = Date.now();
    if (existing.name !== peer.name) {
      existing.name = peer.name;
      const userEl = document.querySelector(`[data-uid="${peer.id}"] .uname`);
      if (userEl) userEl.textContent = escapeHtml(peer.name);
      
      const vlbl = document.querySelector(`#vc-${peer.id}-c .vlbl`);
      if (vlbl) vlbl.innerHTML = `<span class="live"></span> ${escapeHtml(peer.name)} • Kamera`;
      
      const slbl = document.querySelector(`#vc-${peer.id}-s .vlbl`);
      if (slbl) slbl.innerHTML = `<span class="live"></span> ${escapeHtml(peer.name)} • Ekran`;
    }
    return;
  }

  console.log('🔍 Peer bulundu:', peer.name, peer.ip);
  addUser({ id: peer.id, name: peer.name, mic: true, deaf: false, sharing: false, ip: peer.ip });
  const isInitiator = state.myId > peer.id;
  await createPeerConnection(peer.id, peer.name, isInitiator, peer.ip);
  showToast(peer.name + ' bulundu', 'info');
}

setInterval(() => {
  const now = Date.now();
  state.peers.forEach((peer, id) => {
    if (peer.lastSeen && now - peer.lastSeen > 12000) {
      console.log('⏳ Peer zaman aşımına uğradı:', peer.name);
      removePeer(id);
    }
  });
}, 5000);

function removePeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;
  if (peer.pc) peer.pc.close();
  if (peer.dc) peer.dc.close();
  state.peers.delete(peerId);
  const userEl = document.querySelector(`[data-uid="${peerId}"]`);
  if (userEl) userEl.remove();
  removeVideoCard(peerId, false);
  removeVideoCard(peerId, true);
  state.speakingPeers.delete(peerId);
  if (state.activeControl && state.activeControl.hostId === peerId) {
    document.getElementById('remote-stop').click();
  }
  showToast(peer.name + ' ayrıldı', 'warn');
  updateEmptyGrid();
}

async function createPeerConnection(peerId, peerName, isInitiator, peerIp) {
  if (state.peers.has(peerId)) return;
  const pc = new RTCPeerConnection({ iceServers: ICE });

  state.localStream.getTracks().forEach(track => {
    pc.addTrack(track, state.localStream);
  });
  pc.onicecandidate = (e) => {
    if (e.candidate && peerIp) {
      window.electronAPI.sendUDPSignal(peerIp, { type: 'ice', candidate: e.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
      removePeer(peerId);
    }
  };

  pc.ontrack = (e) => {
    const peer = state.peers.get(peerId);
    if (!peer) return;

    if (e.track.kind === 'audio') {
      peer.audioEl.srcObject = e.streams[0];
      peer.audioEl.volume = state.volume;
      peer.audioEl.play().catch(() => {});
      setupSpeakingDetection(peerId, e.streams[0]);
    } else if (e.track.kind === 'video') {
      peer.videoEl.srcObject = e.streams[0];
      if (state.activeControl && state.activeControl.hostId === peerId) {
        document.getElementById('remote-vid').srcObject = e.streams[0];
      } else {
        addVideoCard(peerId, peerName, peer.videoEl, e.track.label.includes('screen') || peer.sharing);
      }
    }
  };

  const dc = pc.createDataChannel('app', { ordered: true });
  setupDataChannel(peerId, dc);

  pc.ondatachannel = (e) => {
    if (e.channel.label === 'app') setupDataChannel(peerId, e.channel);
  };

  state.peers.set(peerId, {
    pc,
    audioEl: document.createElement('audio'),
    videoEl: document.createElement('video'),
    dc,
    name: peerName,
    mic: true,
    deaf: false,
    sharing: false,
    camera: false,
    ip: peerIp,
    lastSeen: Date.now()
  });

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (peerIp) {
      window.electronAPI.sendUDPSignal(peerIp, { type: 'offer', sdp: offer });
    }
  }
}

function setupDataChannel(peerId, dc) {
  dc.onopen = () => console.log('DC açıldı:', peerId);
  dc.onclose = () => console.log('DC kapandı:', peerId);
  dc.onmessage = async (e) => {
    if (typeof e.data === 'string') {
      try {
        const msg = JSON.parse(e.data);
        handleDataMessage(peerId, msg);
      } catch (err) {}
    } else {
      const buf = new Uint8Array(e.data);
      let pipeIdx = -1;
      for (let i=0; i<100; i++) { if(buf[i]===124) { pipeIdx=i; break; } } // '|'
      if (pipeIdx > 0) {
        const headerStr = new TextDecoder().decode(buf.slice(0, pipeIdx));
        const chunk = buf.slice(pipeIdx + 1);
        try {
          const header = JSON.parse(headerStr);
          const f = fileBuffer.get(header.id);
          if (f) {
            f.chunks.push(chunk);
            f.received += chunk.length;
            const prog = document.getElementById(`prog-${header.id}`);
            if (prog) prog.style.width = (f.received / f.meta.size * 100) + '%';
          }
        } catch(err){}
      }
    }
  };
}

async function handleDataMessage(peerId, msg) {
  const peer = state.peers.get(peerId);
  if (!peer) return;

  if (msg.type === 'state') {
    if (msg.mic !== undefined) peer.mic = msg.mic;
    if (msg.deaf !== undefined) peer.deaf = msg.deaf;
    updateUserUI(peerId);
  } else if (msg.type === 'sharing') {
    peer.sharing = msg.sharing;
    updateUserUI(peerId);
  } else if (msg.type === 'camera') {
    peer.camera = msg.on;
    updateUserUI(peerId);
  } else if (msg.type === 'chat') {
    appendChat(peerId, peer.name, msg.text);
  } else if (msg.type === 'chat-enc') {
    if (state.cryptoKey) {
      const dec = await decryptMsg(msg.data, state.cryptoKey);
      if (dec) appendChat(peerId, peer.name, dec);
      else appendChat(peerId, peer.name, '🔒 [Şifre Çözülemedi]');
    } else {
      appendChat(peerId, peer.name, '🔒 [Kilitli Mesaj]');
    }
  } else if (msg.type === 'draw') {
    if (state.wbContext) {
      drawWb(msg.tool, msg.x0 * 1920, msg.y0 * 1080, msg.x1 * 1920, msg.y1 * 1080, msg.color, msg.size, msg.text);
    }
  } else if (msg.type === 'wb-clear') {
    if (state.wbContext) {
      state.wbContext.fillStyle = '#ffffff';
      state.wbContext.fillRect(0,0,1920,1080);
    }
  } else if (msg.type === 'file-meta') {
    fileBuffer.set(msg.id, { meta: msg, chunks: [], received: 0 });
    appendFileMsg(msg.id, msg.name, msg.size, true);
  } else if (msg.type === 'file-done') {
    const f = fileBuffer.get(msg.id);
    if (f) {
      const blob = new Blob(f.chunks, { type: f.meta.mime });
      const url = URL.createObjectURL(blob);
      const div = document.getElementById('file-' + msg.id);
      if (div) {
        if (f.meta.mime.startsWith('image/')) {
          div.innerHTML = '';
          div.style.background = 'transparent';
          div.style.border = 'none';
          div.style.padding = '0';
          
          const imgWrap = document.createElement('div');
          imgWrap.className = 'img-wrap';
          imgWrap.style.marginTop = '0';
          imgWrap.innerHTML = `
            <img src="${url}" class="chat-img" />
            <a href="${url}" download="${f.meta.name}" class="dl-btn" title="İndir">⬇️</a>
          `;
          div.appendChild(imgWrap);
        } else {
          const btnGroup = document.createElement('div');
          btnGroup.style.display = 'flex';
          btnGroup.style.gap = '8px';
          btnGroup.style.marginTop = '8px';
          
          const aDl = document.createElement('a');
          aDl.href = url;
          aDl.download = f.meta.name;
          aDl.className = 'text-dl';
          aDl.innerHTML = `⬇️ İndir`;
          btnGroup.appendChild(aDl);
          
          if (f.meta.mime.startsWith('text/') || f.meta.mime === 'application/pdf') {
            const aView = document.createElement('a');
            aView.href = url;
            aView.target = '_blank';
            aView.className = 'text-dl view-btn';
            aView.innerHTML = `👁️ İçine Bak`;
            btnGroup.appendChild(aView);
          }
          
          div.querySelector('.prog-wrap').replaceWith(btnGroup);
        }
      }
      fileBuffer.delete(msg.id);
    }
  } else if (msg.type === 'ctrl-req') {
    showControlModal(peerId, peer.name, msg.reqId);
  } else if (msg.type === 'ctrl-res') {
    if (msg.accepted) {
      state.activeControl = { hostId: peerId };
      document.getElementById('remote-name').textContent = peer.name + ' Masaüstü';
      document.getElementById('remote-modal').classList.remove('hidden');
      if (peer.videoEl.srcObject) {
        document.getElementById('remote-vid').srcObject = peer.videoEl.srcObject;
      }
    } else {
      alert('Kontrol isteği reddedildi.');
    }
  } else if (msg.type === 'ctrl-revoke') {
    document.getElementById('remote-modal').classList.add('hidden');
    state.activeControl = null;
    alert('Uzaktan kontrol izni kaldırıldı.');
  } else if (msg.type === 'ctrl-event') {
    if (state.activeControl && state.activeControl.hostId === peerId) {
      window.electronAPI.sendRemoteInput(msg.event);
    }
  } else if (msg.type.startsWith('wt-')) {
    handleWTMessage(peerId, msg);
  } else if (msg.type.startsWith('uno-')) {
    handleUnoMessage(peerId, msg);
  } else if (msg.type.startsWith('sb-')) {
    handleSBMessage(peerId, msg);
  }
}

function handleSBMessage(peerId, msg) {
  if (msg.type === 'sb-start') {
    state.sb.host = msg.host;
    state.sb.interactive = msg.interactive;
    document.getElementById('sb-card').classList.remove('hidden');
    makeCardFocusable(document.getElementById('sb-card'));
    
    const sUrl = document.getElementById('sb-url');
    const sOverlay = document.getElementById('sb-overlay');
    if (!state.sb.interactive && state.sb.host !== state.myId) {
      sUrl.disabled = true;
      sOverlay.style.display = 'block';
    } else {
      sUrl.disabled = false;
      sOverlay.style.display = 'none';
    }
  } else if (msg.type === 'sb-nav') {
    state.sb.ignoreNextNav = true;
    document.getElementById('sb-webview').src = msg.url;
    document.getElementById('sb-url').value = msg.url;
  }
}

function setupSpeakingDetection(peerId, stream) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  function check() {
    if (!state.peers.has(peerId)) return;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length;
    if (avg > 15) {
      if (!state.speakingPeers.has(peerId)) {
        state.speakingPeers.set(peerId, true);
        updateUserUI(peerId);
      }
    } else {
      if (state.speakingPeers.has(peerId)) {
        state.speakingPeers.delete(peerId);
        updateUserUI(peerId);
      }
    }
    requestAnimationFrame(check);
  }
  check();
}

function addUser({ id, name, mic, deaf, sharing, self, ip }) {
  if (document.querySelector(`[data-uid="${id}"]`)) return;
  const li = document.createElement('li');
  li.className = 'user';
  li.dataset.uid = id;
  li.innerHTML = `
    <div class="av">
      ${name.charAt(0).toUpperCase()}
      <div class="st"></div>
    </div>
    <div class="uname">${escapeHtml(name)}</div>
    <div class="uact">
      ${!self ? `<button data-ctrl="${id}" title="Uzaktan kontrol iste">🖱️</button>` : ''}
    </div>
  `;
  document.getElementById('users').appendChild(li);
  if (!self) {
    li.querySelector(`[data-ctrl="${id}"]`).addEventListener('click', () => requestControl(id));
  }
  updateEmptyGrid();
}

function updateUserUI(uid) {
  const peer = state.peers.get(uid);
  const isSelf = uid === 'self';
  const item = document.querySelector(`[data-uid="${uid}"]`);
  if (!item) return;

  const st = item.querySelector('.st');
  st.className = 'st';
  if (isSelf) {
    if (!state.micEnabled) st.classList.add('muted');
    else if (state.deafened) st.classList.add('deaf');
    else if (state.isSpeakingLocally) st.classList.add('speaking');
  } else if (peer) {
    if (state.speakingPeers.has(uid) && peer.mic) st.classList.add('speaking');
    else if (peer.deaf) st.classList.add('deaf');
    else if (!peer.mic) st.classList.add('muted');
    if (peer.sharing) st.classList.add('share');
  }
}

function updateEmptyGrid() {
  const grid = document.getElementById('grid');
  const empty = grid.querySelector('.empty');
  const hasContent = grid.querySelector('.vcard');
  if (hasContent && empty) empty.remove();
}

let focusedCard = null;

function toggleFocus(card) {
  const main = document.querySelector('.main');
  const focusArea = document.getElementById('focus-area');
  const grid = document.getElementById('grid');

  if (focusedCard === card) {
    grid.appendChild(card);
    focusedCard = null;
    main.classList.remove('focus-mode');
    focusArea.classList.add('hidden');
  } else {
    if (focusedCard) grid.appendChild(focusedCard);
    focusArea.appendChild(card);
    focusedCard = card;
    main.classList.add('focus-mode');
    focusArea.classList.remove('hidden');
  }
}

function makeCardFocusable(card) {
  if (card.dataset.focusable) return;
  card.dataset.focusable = "true";
  card.addEventListener('click', (e) => {
    if (e.target.closest('.sb-tools, .card-actions, button, select, input, label, .uno-card-ui, .ucc, .uno-player-list, .act-src, #uno-table, .uno-remote-player, #wt-player-container, .wt-tools')) return;
    if (e.target.tagName === 'CANVAS' && focusedCard === card) return;
    toggleFocus(card);
  });
}

function addVideoCard(peerId, peerName, videoEl, isScreen) {
  if (document.getElementById(`vc-${peerId}-${isScreen ? 's' : 'c'}`)) return;
  const card = document.createElement('div');
  card.id = `vc-${peerId}-${isScreen ? 's' : 'c'}`;
  card.className = 'vcard' + (isScreen ? ' screen' : '');
  card.appendChild(videoEl);
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  
  if (peerId === 'self') videoEl.muted = true;
  else videoEl.muted = false;

  const lbl = document.createElement('div');
  lbl.className = 'vlbl';
  lbl.innerHTML = `<span class="live"></span> ${escapeHtml(peerName)} ${isScreen ? '• Ekran' : '• Kamera'}`;
  card.appendChild(lbl);
  
  if (peerId !== 'self') {
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.className = 'vol-slider';
    slider.min = '0'; slider.max = '1'; slider.step = '0.05'; slider.value = '1';
    slider.title = 'Ses Seviyesi';
    slider.addEventListener('input', e => { videoEl.volume = e.target.value; });
    slider.addEventListener('click', e => e.stopPropagation());
    actions.appendChild(slider);
    card.appendChild(actions);
  }

  makeCardFocusable(card);
  document.getElementById('grid').appendChild(card);
  updateEmptyGrid();
}

function removeVideoCard(peerId, isScreen) {
  const el = document.getElementById(`vc-${peerId}-${isScreen ? 's' : 'c'}`);
  if (el) {
    if (focusedCard === el) toggleFocus(el);
    el.remove();
  }
  updateEmptyGrid();
}

document.getElementById('cform').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('cinput');
  const text = input.value.trim();
  if (!text) return;

  if (state.cryptoKey) {
    const enc = await encryptMsg(text, state.cryptoKey);
    broadcast({ type: 'chat-enc', data: enc });
  } else {
    broadcast({ type: 'chat', text });
  }
  
  appendChat('self', state.myName, text);
  input.value = '';
});

function appendChat(uid, name, text) {
  const wrap = document.getElementById('msgs');
  const div = document.createElement('div');
  div.className = 'msg';
  const t = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `<span class="n">${escapeHtml(name)}</span><span class="t">${t}</span><div>${escapeHtml(text)}</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function broadcast(msg) {
  state.peers.forEach(peer => {
    if (peer.dc && peer.dc.readyState === 'open') {
      peer.dc.send(JSON.stringify(msg));
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function bindUI() {
  const mic = document.getElementById('mic');
  const deaf = document.getElementById('deaf');
  const cam = document.getElementById('cam');
  const share = document.getElementById('share');
  const rec = document.getElementById('rec');
  const vol = document.getElementById('vol');
  const volpop = document.getElementById('volpop');
  const volslider = document.getElementById('volslider');
  const volval = document.getElementById('volval');
  const addip = document.getElementById('addip');
  const leave = document.getElementById('leave');

  const micThresh = document.getElementById('mic-thresh');
  if (micThresh) {
    micThresh.addEventListener('input', e => {
      state.micThreshold = parseInt(e.target.value);
    });
  }

  mic.addEventListener('click', () => {
    if (state.pttMode) {
      state.pttMode = false;
      window.electronAPI.unregisterPTT();
      document.getElementById('ptt').classList.add('hidden');
      setMicEnabled(true);
    }
    const enabled = !state.micEnabled;
    setMicEnabled(enabled);
    playSound(enabled ? 'on' : 'off');
  });

  deaf.addEventListener('click', () => {
    state.deafened = !state.deafened;
    state.peers.forEach(p => { p.audioEl.muted = state.deafened; });
    deaf.classList.toggle('off', state.deafened);
    deaf.querySelector('.icon').textContent = state.deafened ? '🔇' : '🎧';
    broadcast({ type: 'state', deaf: state.deafened });
    updateUserUI('self');
    playSound(state.deafened ? 'off' : 'on');
  });

  cam.addEventListener('click', async () => {
    if (state.cameraOn) {
      stopCamera();
      playSound('off');
    } else {
      await startCamera();
      playSound('on');
    }
  });

  share.addEventListener('click', async () => {
    if (state.isSharing) {
      stopScreenShare();
      playSound('off');
    } else {
      await showShareModal();
      playSound('on');
    }
  });

  rec.addEventListener('click', () => {
    if (state.isRecording) {
      stopRecording();
      playSound('off');
    } else {
      startRecording();
      playSound('on');
    }
  });

  vol.addEventListener('click', () => volpop.classList.toggle('hidden'));
  volslider.addEventListener('input', (e) => {
    state.volume = parseInt(e.target.value) / 100;
    volval.textContent = e.target.value + '%';
    state.peers.forEach(p => { p.audioEl.volume = state.volume; });
  });

  const shareCancel = document.getElementById('share-cancel');
  if (shareCancel) {
    shareCancel.addEventListener('click', () => {
      document.getElementById('share-modal').classList.add('hidden');
    });
  }

  addip.addEventListener('click', () => {
    document.getElementById('ip-modal').classList.remove('hidden');
  });
  document.getElementById('ip-cancel').addEventListener('click', () => {
    document.getElementById('ip-modal').classList.add('hidden');
  });
  document.getElementById('ip-ok').addEventListener('click', () => {
    const ip = document.getElementById('ip-input').value.trim();
    if (ip) {
      window.electronAPI.directConnect(ip);
      showToast(ip + ' adresine ping gönderildi.', 'info');
    }
    document.getElementById('ip-modal').classList.add('hidden');
    document.getElementById('ip-input').value = '';
  });

  const addsdp = document.getElementById('addsdp');
  if (addsdp) {
    addsdp.addEventListener('click', async () => {
      document.getElementById('sdp-modal').classList.remove('hidden');
      document.getElementById('my-offer').value = 'Hazırlanıyor... Lütfen bekleyin.';
      
      let targetPeer = null;
      let targetId = null;

      if (state.peers.size === 0) {
        targetId = crypto.randomUUID();
        addUser({ id: targetId, name: 'Bilinmeyen (SDP)', mic: true, deaf: false, sharing: false });
        await createPeerConnection(targetId, 'Bilinmeyen (SDP)', true, null);
        targetPeer = state.peers.get(targetId);
      } else {
        for (const [id, peer] of state.peers) {
          targetId = id;
          targetPeer = peer;
          break;
        }
      }

      if (targetPeer.pc.iceGatheringState === 'complete') {
        document.getElementById('my-offer').value = btoa(JSON.stringify(targetPeer.pc.localDescription));
        document.getElementById('my-offer').dataset.targetId = targetId;
      } else {
        targetPeer.pc.addEventListener('icegatheringstatechange', () => {
          if (targetPeer.pc.iceGatheringState === 'complete') {
            document.getElementById('my-offer').value = btoa(JSON.stringify(targetPeer.pc.localDescription));
            document.getElementById('my-offer').dataset.targetId = targetId;
          }
        });
      }
    });
  }

  document.getElementById('sdp-cancel').addEventListener('click', () => {
    document.getElementById('sdp-modal').classList.add('hidden');
  });

  document.getElementById('copy-offer').addEventListener('click', () => {
    const offerText = document.getElementById('my-offer').value;
    navigator.clipboard.writeText(offerText);
    showToast('Teklif kopyalandı!', 'ok');
  });

  document.getElementById('sdp-apply').addEventListener('click', async () => {
    const friendSdpB64 = document.getElementById('friend-answer').value.trim();
    if (!friendSdpB64) return;
    try {
      const friendSdp = JSON.parse(atob(friendSdpB64));
      
      if (friendSdp.type === 'offer') {
        const newId = crypto.randomUUID();
        addUser({ id: newId, name: 'Bilinmeyen (SDP)', mic: true, deaf: false, sharing: false });
        await createPeerConnection(newId, 'Bilinmeyen (SDP)', false, null);
        const peer = state.peers.get(newId);
        await peer.pc.setRemoteDescription(new RTCSessionDescription(friendSdp));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        
        document.getElementById('my-offer').value = 'Cevap hazırlanıyor (ICE)...';
        if (peer.pc.iceGatheringState === 'complete') {
          document.getElementById('my-offer').value = btoa(JSON.stringify(peer.pc.localDescription));
          showToast('Cevap oluşturuldu, lütfen arkadaşına gönder.', 'info');
        } else {
          peer.pc.addEventListener('icegatheringstatechange', () => {
            if (peer.pc.iceGatheringState === 'complete') {
              document.getElementById('my-offer').value = btoa(JSON.stringify(peer.pc.localDescription));
              showToast('Cevap oluşturuldu, lütfen arkadaşına gönder.', 'info');
            }
          });
        }
      } else {
        const targetId = document.getElementById('my-offer').dataset.targetId;
        if (targetId && state.peers.has(targetId)) {
          const peer = state.peers.get(targetId);
          await peer.pc.setRemoteDescription(new RTCSessionDescription(friendSdp));
          showToast('Bağlantı kuruluyor...', 'info');
        }
      }
      
      document.getElementById('sdp-modal').classList.add('hidden');
      document.getElementById('friend-answer').value = '';
    } catch (e) {
      showToast('Geçersiz SDP metni.', 'danger');
    }
  });

  document.getElementById('settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
  });
  document.getElementById('settings-close').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });

  leave.addEventListener('click', () => {
    if (confirm('Odadan ayrılmak istediğine emin misin?')) {
      if (state.localStream) state.localStream.getTracks().forEach(t => t.stop());
      if (state.cameraStream) state.cameraStream.getTracks().forEach(t => t.stop());
      if (state.screenStream) state.screenStream.getTracks().forEach(t => t.stop());
      if (state.processedStream) state.processedStream.getTracks().forEach(t => t.stop());
      if (state.audioCtx && state.audioCtx.state !== 'closed') state.audioCtx.close();
      if (state.gateAudioCtx && state.gateAudioCtx.state !== 'closed') state.gateAudioCtx.close();
      
      if (window.electronAPI.stopDiscovery) {
        window.electronAPI.stopDiscovery();
      }
      
      for (const id of state.peers.keys()) {
        removePeer(id);
      }
      state.peers.clear();
      state.speakingPeers.clear();
      
      document.getElementById('users').innerHTML = '';
      document.getElementById('msgs').innerHTML = '';
      
      const grid = document.getElementById('grid');
      document.querySelectorAll('.vcard').forEach(el => {
        if (el.id !== 'wb-card') el.remove();
      });
      if (!document.getElementById('empty-state')) {
        const empty = document.createElement('div');
        empty.id = 'empty-state';
        empty.className = 'empty';
        empty.innerHTML = '<h2>👋 Bağlantı Bekleniyor</h2><p>Aynı oda anahtarını yazan biri bağlanınca burada görünecek.</p>';
        grid.prepend(empty);
      }
      
      if (state.pttMode) {
        window.electronAPI.unregisterPTT();
      }
      
      document.getElementById('app').classList.add('hidden');
      document.getElementById('login').classList.remove('hidden');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'KeyM') mic.click();
    if (e.code === 'KeyD') deaf.click();
    if (e.code === 'KeyC') cam.click();
    if (e.code === 'KeyS') share.click();
    if (e.code === 'KeyR') rec.click();
  });

  document.getElementById('act-btn').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.remove('hidden');
  });
  document.getElementById('act-close').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
  });
  
  initActivitiesUI();
}

function setMicEnabled(enabled) {
  state.micEnabled = enabled;
  state.localStream.getAudioTracks().forEach(t => t.enabled = enabled);
  const micBtn = document.getElementById('mic');
  micBtn.classList.toggle('off', !enabled);
  micBtn.querySelector('.icon').textContent = enabled ? '🎤' : '🚫';
  broadcast({ type: 'state', mic: enabled });
  updateUserUI('self');
}

async function startCamera() {
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: getVideoConstraints()
    });
    const track = state.cameraStream.getVideoTracks()[0];
    state.peers.forEach(peer => {
      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(track);
      else peer.pc.addTrack(track, state.cameraStream);
    });
    state.cameraOn = true;
    document.getElementById('cam').classList.add('off');
    broadcast({ type: 'camera', on: true });
    addVideoCard('self', state.myName + ' (sen)', attachVideo(state.cameraStream), false);
  } catch (err) {
    alert('Kamera hatası: ' + err.message);
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(t => t.stop());
  }
  state.peers.forEach(peer => {
    const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) sender.replaceTrack(null);
  });
  state.cameraOn = false;
  document.getElementById('cam').classList.remove('off');
  broadcast({ type: 'camera', on: false });
  removeVideoCard('self', false);
}

function attachVideo(stream) {
  const v = document.createElement('video');
  v.srcObject = stream;
  v.autoplay = true;
  v.muted = true;
  v.playsInline = true;
  return v;
}

async function showShareModal() {
  const sources = await window.electronAPI.getSources();
  const wrap = document.getElementById('sources');
  wrap.innerHTML = '';
  sources.forEach(s => {
    const div = document.createElement('div');
    div.className = 'src';
    div.innerHTML = `<img src="${s.thumbnail}" /><div>${escapeHtml(s.name)}</div>`;
    div.addEventListener('click', () => {
      document.getElementById('share-modal').classList.add('hidden');
      startScreenShare(s.id);
    });
    wrap.appendChild(div);
  });
  document.getElementById('share-modal').classList.remove('hidden');
}

async function startScreenShare(sourceId) {
  try {
    const consts = getVideoConstraints();
    const shareAudio = document.getElementById('share-audio').checked;
    state.screenStream = await navigator.mediaDevices.getUserMedia({
      audio: shareAudio ? {
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId }
      } : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: consts.frameRate.ideal || 30
        }
      }
    });
    const track = state.screenStream.getVideoTracks()[0];
    state.peers.forEach(peer => {
      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(track);
      else peer.pc.addTrack(track, state.screenStream);
    });
    state.isSharing = true;
    document.getElementById('share').classList.add('off');
    broadcast({ type: 'sharing', sharing: true });
    addVideoCard('self', state.myName + ' (sen)', attachVideo(state.screenStream), true);
    track.onended = () => stopScreenShare();
  } catch (err) {
    alert('Ekran paylaşım hatası: ' + err.message);
  }
}

function stopScreenShare() {
  if (state.screenStream) {
    state.screenStream.getTracks().forEach(t => t.stop());
  }
  state.peers.forEach(peer => {
    const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) sender.replaceTrack(null);
  });
  state.isSharing = false;
  document.getElementById('share').classList.remove('off');
  broadcast({ type: 'sharing', sharing: false });
  removeVideoCard('self', true);
}

function startRecording() {
  const tracks = [...state.localStream.getAudioTracks()];
  state.peers.forEach(peer => {
    if (peer.audioEl.srcObject) {
      peer.audioEl.srcObject.getAudioTracks().forEach(t => tracks.push(t));
    }
  });
  const stream = new MediaStream(tracks);
  state.recordingStream = stream;

  try {
    state.recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    state.recordedChunks = [];
    state.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.recordedChunks.push(e.data);
    };
    state.recorder.onstop = () => {
      const blob = new Blob(state.recordedChunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kanka-voice-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };
    state.recorder.start(1000);
    state.isRecording = true;
    document.getElementById('rec').classList.add('rec');
  } catch (e) {
    alert('Kayıt başlatılamadı: ' + e.message);
  }
}

function stopRecording() {
  if (state.recorder && state.isRecording) {
    state.recorder.stop();
    state.isRecording = false;
    document.getElementById('rec').classList.remove('rec');
  }
}

function requestControl(peerId) {
  broadcastTo(peerId, { type: 'ctrl-req', reqId: 'req-' + Date.now() });
  alert('Kontrol isteği gönderildi.');
}

function showControlModal(peerId, peerName, reqId) {
  state.pendingControlReq = { peerId, reqId };
  document.getElementById('ctrl-text').textContent = `${peerName} bilgisayarınızı kontrol etmek istiyor. Onaylıyor musunuz?`;
  document.getElementById('ctrl-modal').classList.remove('hidden');
}

document.getElementById('ctrl-accept').addEventListener('click', () => {
  if (state.pendingControlReq) {
    broadcastTo(state.pendingControlReq.peerId, { type: 'ctrl-res', accepted: true });
    window.electronAPI.setRemoteControl(true);
  }
  closeCtrlModal();
});
document.getElementById('ctrl-deny').addEventListener('click', () => {
  if (state.pendingControlReq) {
    broadcastTo(state.pendingControlReq.peerId, { type: 'ctrl-res', accepted: false });
  }
  closeCtrlModal();
});
function closeCtrlModal() {
  document.getElementById('ctrl-modal').classList.add('hidden');
  state.pendingControlReq = null;
}

document.getElementById('remote-stop').addEventListener('click', () => {
  if (state.activeControl) {
    broadcastTo(state.activeControl.hostId, { type: 'ctrl-revoke' });
  }
  document.getElementById('remote-modal').classList.add('hidden');
  state.activeControl = null;
  window.electronAPI.setRemoteControl(false);
});

const remoteVid = document.getElementById('remote-vid');
remoteVid.addEventListener('mousedown', e => sendCtrlEvent({ type: 'mousedown', x: relX(e), y: relY(e), button: e.button }));
remoteVid.addEventListener('mouseup', e => sendCtrlEvent({ type: 'mouseup', x: relX(e), y: relY(e), button: e.button }));
remoteVid.addEventListener('mousemove', throttle(e => sendCtrlEvent({ type: 'mousemove', x: relX(e), y: relY(e) }), 16));
remoteVid.addEventListener('wheel', e => { e.preventDefault(); sendCtrlEvent({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY }); });
remoteVid.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (state.activeControl && !e.repeat) sendCtrlEvent({ type: 'keydown', key: e.key });
});
document.addEventListener('keyup', e => {
  if (state.activeControl) sendCtrlEvent({ type: 'keyup', key: e.key });
  if (e.key === 'Escape' && state.activeControl) document.getElementById('remote-stop').click();
});

function relX(e) { return (e.clientX - remoteVid.getBoundingClientRect().left) / remoteVid.clientWidth; }
function relY(e) { return (e.clientY - remoteVid.getBoundingClientRect().top) / remoteVid.clientHeight; }

function sendCtrlEvent(event) {
  if (!state.activeControl) return;
  broadcastTo(state.activeControl.hostId, { type: 'ctrl-event', event });
}

function broadcastTo(peerId, msg) {
  const peer = state.peers.get(peerId);
  if (peer && peer.dc && peer.dc.readyState === 'open') peer.dc.send(JSON.stringify(msg));
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function throttle(fn, wait) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= wait) { last = now; fn(...args); }
  };
}

function getVideoConstraints() {
  const q = document.getElementById('quality-select').value;
  if (q === 'high') return { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } };
  if (q === 'low') return { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 15 } };
  return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
}

function initWhiteboard() {
  const canvas = document.getElementById('wb-canvas');
  state.wbContext = canvas.getContext('2d');
  
  canvas.width = 1920;
  canvas.height = 1080;
  state.wbContext.fillStyle = '#ffffff';
  state.wbContext.fillRect(0,0,1920,1080);

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.offsetX * (1920 / rect.width),
      y: e.offsetY * (1080 / rect.height)
    };
  }

  let startX = 0, startY = 0;
  let isDrawingShape = false;
  let tempCanvasData = null;
  const wbCard = document.getElementById('wb-card');
  
  canvas.addEventListener('mousedown', e => {
    if (focusedCard !== wbCard) return;
    state.drawing = true;
    const pos = getPos(e);
    startX = pos.x; startY = pos.y;
    const tool = document.getElementById('wb-tool').value;
    if (tool !== 'pen') {
      isDrawingShape = true;
      tempCanvasData = state.wbContext.getImageData(0,0,1920, 1080);
    }
  });
  
  canvas.addEventListener('mousemove', e => {
    if (!state.drawing) return;
    const pos = getPos(e);
    const tool = document.getElementById('wb-tool').value;
    const color = document.getElementById('wb-color').value;
    const size = document.getElementById('wb-size').value;
    
    if (tool === 'pen') {
      drawWb(tool, startX, startY, pos.x, pos.y, color, size);
      broadcast({ type: 'draw', tool, x0: startX/1920, y0: startY/1080, x1: pos.x/1920, y1: pos.y/1080, color, size });
      startX = pos.x; startY = pos.y;
    } else if (isDrawingShape) {
      state.wbContext.putImageData(tempCanvasData, 0, 0);
      drawWb(tool, startX, startY, pos.x, pos.y, color, size);
    }
  });
  
  window.addEventListener('mouseup', e => {
    if (state.drawing && isDrawingShape && e.target === canvas) {
      const pos = getPos(e);
      const tool = document.getElementById('wb-tool').value;
      const color = document.getElementById('wb-color').value;
      const size = document.getElementById('wb-size').value;
      
      if (tool === 'text') {
        const text = prompt('Yazılacak metin:');
        if (text) {
          drawWb('text', startX, startY, pos.x, pos.y, color, size, text);
          broadcast({ type: 'draw', tool: 'text', x0: startX/1920, y0: startY/1080, color, size, text });
        } else {
          state.wbContext.putImageData(tempCanvasData, 0, 0);
        }
      } else {
        broadcast({ type: 'draw', tool, x0: startX/1920, y0: startY/1080, x1: pos.x/1920, y1: pos.y/1080, color, size });
      }
    }
    state.drawing = false;
    isDrawingShape = false;
  });
  
  makeCardFocusable(wbCard);

  document.getElementById('wb-btn').addEventListener('click', () => {
    wbCard.classList.toggle('hidden');
  });

  document.getElementById('wb-close').addEventListener('click', (e) => {
    e.stopPropagation();
    if (focusedCard === wbCard) toggleFocus(wbCard);
    wbCard.classList.add('hidden');
  });
  
  document.getElementById('wb-clear').addEventListener('click', (e) => {
    e.stopPropagation();
    state.wbContext.fillStyle = '#ffffff';
    state.wbContext.fillRect(0,0,1920,1080);
    broadcast({ type: 'wb-clear' });
  });
}

function drawWb(tool, x0, y0, x1, y1, color, size, text='') {
  const ctx = state.wbContext;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 2;
  ctx.lineCap = 'round';
  
  if (tool === 'pen') {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  } else if (tool === 'rect') {
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.stroke();
  } else if (tool === 'circle') {
    ctx.ellipse(x0, y0, Math.abs(x1 - x0), Math.abs(y1 - y0), 0, 0, 2 * Math.PI);
    ctx.stroke();
  } else if (tool === 'text') {
    ctx.font = `${size * 6}px Inter`;
    ctx.fillText(text, x0, y0);
  }
  ctx.closePath();
}

function initFileTransfer() {
  const dropOverlay = document.getElementById('drop-overlay');
  
  document.addEventListener('dragover', e => { e.preventDefault(); dropOverlay.classList.add('active'); });
  document.addEventListener('dragleave', e => { if(e.target === dropOverlay) dropOverlay.classList.remove('active'); });
  document.addEventListener('drop', e => {
    e.preventDefault(); dropOverlay.classList.remove('active');
    if (e.dataTransfer.files.length) sendFile(e.dataTransfer.files[0]);
  });
  
  document.getElementById('fbtn').addEventListener('click', () => document.getElementById('finput').click());
  document.getElementById('finput').addEventListener('change', (e) => {
    if (e.target.files.length) sendFile(e.target.files[0]);
  });
}

function appendFileMsg(fileId, name, size, incoming) {
  const wrap = document.getElementById('msgs');
  const div = document.createElement('div');
  div.className = 'msg-file';
  div.id = 'file-' + fileId;
  div.innerHTML = `
    <div class="icon">📄</div>
    <div class="info">
      <div class="name">${escapeHtml(name)}</div>
      <div class="muted">${(size/1024/1024).toFixed(2)} MB</div>
      <div class="prog-wrap"><div class="prog" id="prog-${fileId}"></div></div>
    </div>
  `;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

async function sendFile(file) {
  const fileId = crypto.randomUUID();
  appendFileMsg(fileId, file.name, file.size, false);
  broadcast({ type: 'file-meta', id: fileId, name: file.name, size: file.size, mime: file.type });
  
  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const chunk = new Uint8Array(await slice.arrayBuffer());
    const header = new TextEncoder().encode(JSON.stringify({ id: fileId }) + '|');
    const msgBuf = new Uint8Array(header.length + chunk.length);
    msgBuf.set(header);
    msgBuf.set(chunk, header.length);
    
    for (const [_, peer] of state.peers) {
      if (peer.dc && peer.dc.readyState === 'open') {
        while (peer.dc.bufferedAmount > 2 * 1024 * 1024) {
          await new Promise(r => setTimeout(r, 50));
        }
        try { peer.dc.send(msgBuf); } catch(e){}
      }
    }
    
    offset += chunk.length;
    const prog = document.getElementById(`prog-${fileId}`);
    if (prog) prog.style.width = (offset / file.size * 100) + '%';
  }
  broadcast({ type: 'file-done', id: fileId });

  const div = document.getElementById('file-' + fileId);
  if (div) {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) {
      div.innerHTML = '';
      div.style.background = 'transparent';
      div.style.border = 'none';
      div.style.padding = '0';
      
      const imgWrap = document.createElement('div');
      imgWrap.className = 'img-wrap';
      imgWrap.style.marginTop = '0';
      imgWrap.innerHTML = `
        <img src="${url}" class="chat-img" />
        <a href="${url}" download="${file.name}" class="dl-btn" title="İndir">⬇️</a>
      `;
      div.appendChild(imgWrap);
    } else {
      const btnGroup = document.createElement('div');
      btnGroup.style.display = 'flex';
      btnGroup.style.gap = '8px';
      btnGroup.style.marginTop = '8px';
      
      const aDl = document.createElement('a');
      aDl.href = url;
      aDl.download = file.name;
      aDl.className = 'text-dl';
      aDl.innerHTML = `⬇️ İndir`;
      btnGroup.appendChild(aDl);
      
      if (file.type.startsWith('text/') || file.type === 'application/pdf') {
        const aView = document.createElement('a');
        aView.href = url;
        aView.target = '_blank';
        aView.className = 'text-dl view-btn';
        aView.innerHTML = `👁️ İçine Bak`;
        btnGroup.appendChild(aView);
      }
      
    }
  }
}

// ====== WATCH TOGETHER ======
function onYouTubeIframeAPIReady() {
  state.wt.isReady = true;
}

function loadWTVideo(vid) {
  if (!state.wt.player) {
    state.wt.player = new YT.Player('wt-player', {
      height: '100%',
      width: '100%',
      videoId: vid,
      playerVars: { 'autoplay': 1, 'controls': 1, 'origin': 'https://www.youtube.com' },
      events: {
        'onStateChange': onWTStateChange
      }
    });
  } else {
    state.wt.player.loadVideoById(vid);
  }
}

function onWTStateChange(event) {
  if (state.wt.ignoreNextEvent) {
    state.wt.ignoreNextEvent = false;
    return;
  }
  const now = Date.now();
  if (now - state.wt.lastAction < 500) return;
  
  if (event.data == YT.PlayerState.PLAYING) {
    const time = state.wt.player.getCurrentTime();
    broadcast({ type: 'wt-play', time });
    state.wt.lastAction = now;
  } else if (event.data == YT.PlayerState.PAUSED) {
    const time = state.wt.player.getCurrentTime();
    broadcast({ type: 'wt-pause', time });
    state.wt.lastAction = now;
  }
}

function handleWTMessage(peerId, msg) {
  if (msg.type === 'wt-load') {
    document.getElementById('activities-modal').classList.add('hidden');
    document.getElementById('wt-card').classList.remove('hidden');
    loadWTVideo(msg.vid);
  } else if (msg.type === 'wt-play') {
    if (state.wt.player && state.wt.player.playVideo) {
      state.wt.ignoreNextEvent = true;
      if (Math.abs(state.wt.player.getCurrentTime() - msg.time) > 2) {
        state.wt.player.seekTo(msg.time);
      }
      state.wt.player.playVideo();
    }
  } else if (msg.type === 'wt-pause') {
    if (state.wt.player && state.wt.player.pauseVideo) {
      state.wt.ignoreNextEvent = true;
      state.wt.player.seekTo(msg.time);
      state.wt.player.pauseVideo();
    }
  }
}

// ====== UNO GAME ======
state.act = { wt: false, uno: false };
state.wt = { player: null, isReady: false, lastAction: 0, ignoreNextEvent: false };
state.sb = { host: null, interactive: false, ignoreNextNav: false };
state.uno = {
  host: null,
  players: new Map(), // id -> { name, ready, cardCount }
  maxPlayers: 4,
  started: false,
  myHand: [],
  deck: [],
  discard: [],
  turnIndex: 0,
  direction: 1,
  currentColor: '',
  turnOrder: [],
  botHands: {},
  botTimeout: null
};

function initActivitiesUI() {
  document.getElementById('act-wt').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
    document.getElementById('wt-card').classList.remove('hidden');
    makeCardFocusable(document.getElementById('wt-card'));
    if (!focusedCard) toggleFocus(document.getElementById('wt-card'));
  });
  
  document.getElementById('wt-close').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('wt-card').classList.add('hidden');
    if (focusedCard === document.getElementById('wt-card')) toggleFocus(document.getElementById('wt-card'));
    if (state.wt.player && state.wt.player.stopVideo) state.wt.player.stopVideo();
  });
  
  document.getElementById('wt-load').addEventListener('click', (e) => {
    e.stopPropagation();
    const url = document.getElementById('wt-url').value;
    const match = url.match(/(?:v=|youtu\.be\/)([^&]+)/);
    if (match) {
      const vid = match[1];
      broadcast({ type: 'wt-load', vid });
      loadWTVideo(vid);
    } else {
      showToast('Geçerli bir YouTube linki girin', 'warn');
    }
  });

  document.getElementById('act-sb').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
    document.getElementById('sb-card').classList.remove('hidden');
    makeCardFocusable(document.getElementById('sb-card'));
    if (!focusedCard) toggleFocus(document.getElementById('sb-card'));
    
    if (confirm("Ortak Tarayıcıyı başlatıyorsunuz. Diğer kullanıcılar tarayıcıyla etkileşime girebilsin mi (tıklama, sayfa değiştirme)?\n\nTamam = Evet (Herkes Tıklayabilir)\nİptal = Hayır (Sadece Kurucu Tıklayabilir)")) {
      state.sb.interactive = true;
    } else {
      state.sb.interactive = false;
    }
    state.sb.host = state.myId;
    document.getElementById('sb-overlay').style.display = 'none';
    document.getElementById('sb-url').disabled = false;
    broadcast({ type: 'sb-start', host: state.myId, interactive: state.sb.interactive });
  });

  const sbWebview = document.getElementById('sb-webview');
  const sbUrl = document.getElementById('sb-url');
  
  document.getElementById('sb-close').addEventListener('click', (e) => {
    e.stopPropagation();
    broadcast({ type: 'sb-close' });
    document.getElementById('sb-card').classList.add('hidden');
    if (focusedCard === document.getElementById('sb-card')) toggleFocus(document.getElementById('sb-card'));
    sbWebview.src = 'https://www.google.com';
  });

  document.getElementById('sb-go').addEventListener('click', (e) => {
    e.stopPropagation();
    let url = sbUrl.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    sbWebview.src = url;
  });
  sbUrl.addEventListener('click', () => {
    document.getElementById('sb-webview').blur();
    sbUrl.focus();
  });

  sbUrl.addEventListener('focus', () => {
    document.getElementById('sb-webview').blur();
  });

  sbUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('sb-go').click();
  });

  document.getElementById('sb-back').addEventListener('click', (e) => {
    e.stopPropagation();
    if (sbWebview.canGoBack()) sbWebview.goBack();
  });
  document.getElementById('sb-forward').addEventListener('click', (e) => {
    e.stopPropagation();
    if (sbWebview.canGoForward()) sbWebview.goForward();
  });
  document.getElementById('sb-refresh').addEventListener('click', (e) => {
    e.stopPropagation();
    sbWebview.reload();
  });

  sbWebview.addEventListener('did-navigate', (e) => {
    if (document.activeElement !== sbUrl) {
      sbUrl.value = e.url;
    }
    if (state.sb.ignoreNextNav) {
      state.sb.ignoreNextNav = false;
      return;
    }
    if (state.sb.host === state.myId || state.sb.interactive) {
      broadcast({ type: 'sb-nav', url: e.url });
    }
  });

  sbWebview.addEventListener('did-navigate-in-page', (e) => {
    if (document.activeElement !== sbUrl) {
      sbUrl.value = e.url;
    }
    if (state.sb.ignoreNextNav) {
      state.sb.ignoreNextNav = false;
      return;
    }
    if (state.sb.host === state.myId || state.sb.interactive) {
      broadcast({ type: 'sb-nav', url: e.url });
    }
  });

  document.getElementById('act-uno').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
    document.getElementById('uno-card').classList.remove('hidden');
    makeCardFocusable(document.getElementById('uno-card'));
    if (!focusedCard) toggleFocus(document.getElementById('uno-card'));
    
    state.uno.host = state.myId;
    state.uno.players.set(state.myId, { name: state.myName, ready: true, cardCount: 0 });
    document.getElementById('uno-host-settings').style.display = 'block';
    document.getElementById('uno-ready-btn').classList.add('hidden');
    document.getElementById('uno-start-btn').classList.remove('hidden');
    
    broadcast({ type: 'uno-lobby', host: state.myId });
    renderUnoLobby();
  });

  document.getElementById('uno-close').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('uno-card').classList.add('hidden');
    if (focusedCard === document.getElementById('uno-card')) toggleFocus(document.getElementById('uno-card'));
    state.uno.host = null;
    state.uno.players.clear();
    state.uno.started = false;
    document.getElementById('uno-lobby').classList.remove('hidden');
    document.getElementById('uno-game').classList.add('hidden');
    broadcast({ type: 'uno-leave' });
  });

  document.getElementById('uno-ready-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const p = state.uno.players.get(state.myId);
    if (p) {
      p.ready = !p.ready;
      document.getElementById('uno-ready-btn').textContent = p.ready ? 'Hazırım' : 'Hazır Değilim';
      document.getElementById('uno-ready-btn').style.background = p.ready ? 'var(--ok)' : 'var(--warn)';
      broadcast({ type: 'uno-ready', ready: p.ready });
      renderUnoLobby();
    }
  });

  document.getElementById('uno-start-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const fillBots = document.getElementById('uno-fill-bots').checked;
    const totalPlayers = fillBots ? state.uno.maxPlayers : state.uno.players.size;
    if (totalPlayers < 2) {
      alert("En az 2 kişi olmalı!");
      return;
    }
    let allReady = true;
    for (const [id, p] of state.uno.players) {
      if (!p.ready) allReady = false;
    }
    if (!allReady) {
      alert("Herkes hazır değil!");
      return;
    }
    startUnoGame();
  });

  document.getElementById('uno-max-players').addEventListener('change', (e) => {
    state.uno.maxPlayers = parseInt(e.target.value);
    broadcast({ type: 'uno-max', max: state.uno.maxPlayers });
  });

  document.getElementById('uno-sort-color').addEventListener('click', () => {
    state.uno.myHand.sort((a, b) => {
      if (a.color === 'black' && b.color !== 'black') return 1;
      if (b.color === 'black' && a.color !== 'black') return -1;
      if (a.color === b.color) return a.val.localeCompare(b.val);
      return a.color.localeCompare(b.color);
    });
    renderUnoGame();
  });

  document.getElementById('uno-sort-num').addEventListener('click', () => {
    state.uno.myHand.sort((a, b) => {
      const aIsNum = !isNaN(parseInt(a.val));
      const bIsNum = !isNaN(parseInt(b.val));
      
      if (!aIsNum && bIsNum) return 1;
      if (!bIsNum && aIsNum) return -1;
      
      if (aIsNum && bIsNum) {
        if (a.val === b.val) return a.color.localeCompare(b.color);
        return parseInt(a.val) - parseInt(b.val);
      }
      
      const order = { 'Skip': 1, 'Rev': 2, '+2': 3, 'Color': 4, '+4': 5 };
      const aO = order[a.val] || 0;
      const bO = order[b.val] || 0;
      if (aO !== bO) return aO - bO;
      
      return a.color.localeCompare(b.color);
    });
    renderUnoGame();
  });

  document.querySelectorAll('.uno-emoji-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const emoji = e.target.textContent;
      showFloatingEmoji(state.myId, emoji);
      broadcast({ type: 'uno-emoji', emoji });
    });
  });
}

function handleUnoMessage(peerId, msg) {
  if (msg.type === 'uno-lobby') {
    if (!state.uno.host || state.uno.host === peerId) {
      state.uno.host = peerId;
      document.getElementById('uno-card').classList.remove('hidden');
      document.getElementById('uno-lobby').classList.remove('hidden');
      document.getElementById('uno-game').classList.add('hidden');
      makeCardFocusable(document.getElementById('uno-card'));
      if (!focusedCard) toggleFocus(document.getElementById('uno-card'));
      
      if (!state.uno.players.has(state.myId)) {
        state.uno.players.set(state.myId, { name: state.myName, ready: false, cardCount: 0 });
        document.getElementById('uno-host-settings').style.display = 'none';
        document.getElementById('uno-ready-btn').classList.remove('hidden');
        document.getElementById('uno-start-btn').classList.add('hidden');
        document.getElementById('uno-ready-btn').textContent = 'Hazır Değilim';
        document.getElementById('uno-ready-btn').style.background = 'var(--warn)';
      }
      broadcast({ type: 'uno-join', name: state.myName, ready: state.uno.players.get(state.myId)?.ready || false });
    }
  } else if (msg.type === 'uno-join') {
    state.uno.players.set(peerId, { name: msg.name, ready: msg.ready, cardCount: 0 });
    renderUnoLobby();
  } else if (msg.type === 'uno-ready') {
    const p = state.uno.players.get(peerId);
    if (p) { p.ready = msg.ready; renderUnoLobby(); }
  } else if (msg.type === 'uno-lobby-sync') {
    state.uno.players = new Map(msg.players);
    renderUnoLobby();
  } else if (msg.type === 'uno-leave') {
    if (state.uno.host === peerId) {
      alert("Kurucu odadan çıktı. UNO iptal edildi.");
      document.getElementById('uno-close').click();
    } else {
      state.uno.players.delete(peerId);
      renderUnoLobby();
    }
  } else if (msg.type === 'uno-max') {
    state.uno.maxPlayers = msg.max;
  } else if (msg.type === 'uno-start') {
    state.uno.started = true;
    state.uno.turnOrder = msg.turnOrder;
    state.uno.turnIndex = msg.turnIndex;
    state.uno.direction = msg.direction;
    state.uno.myHand = msg.hands[state.myId] || [];
    for (const id of state.uno.turnOrder) {
      if (state.uno.players.has(id)) {
        state.uno.players.get(id).cardCount = msg.hands[id]?.length || 0;
      }
    }
    state.uno.discard = [msg.firstCard];
    state.uno.currentColor = msg.firstCard.color;
    
    document.getElementById('uno-lobby').classList.add('hidden');
    document.getElementById('uno-game').classList.remove('hidden');
    renderUnoGame();
  } else if (msg.type === 'uno-play') {
    playPopSound();
    const pId = msg.botId || peerId;
    if (pId !== state.myId) animateRemotePlay(pId, msg.card);
    
    const p = state.uno.players.get(pId);
    if (p) p.cardCount--;
    state.uno.discard.push(msg.card);
    state.uno.currentColor = msg.color || msg.card.color;
    state.uno.turnIndex = msg.nextTurnIndex;
    state.uno.direction = msg.direction;
    if (state.uno.host === state.myId && state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
    state.uno.triggerDiscardAnim = true;
    setTimeout(() => renderUnoGame(), 300);
  } else if (msg.type === 'uno-draw') {
    const pId = msg.botId || peerId;
    const p = state.uno.players.get(pId);
    if (p) p.cardCount += msg.count;
    state.uno.turnIndex = msg.nextTurnIndex;
    if (state.uno.host === state.myId && state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
    renderUnoGame();
  } else if (msg.type === 'uno-emoji') {
    showFloatingEmoji(peerId, msg.emoji);
  }
}

function renderUnoLobby() {
  const wrap = document.getElementById('uno-players');
  wrap.innerHTML = '';
  for (const [id, p] of state.uno.players) {
    const div = document.createElement('div');
    div.className = 'uno-p-item' + (p.ready ? ' ready' : '');
    div.innerHTML = `<div class="st ${p.ready ? '' : 'muted'}"></div> <span>${escapeHtml(p.name)}</span> ${id === state.uno.host ? '👑' : ''}`;
    wrap.appendChild(div);
  }
}

function getUnoDeck() {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const deck = [];
  for (let c of colors) {
    deck.push({ color: c, val: '0' });
    for (let i = 1; i <= 9; i++) {
      deck.push({ color: c, val: i.toString() });
      deck.push({ color: c, val: i.toString() });
    }
    deck.push({ color: c, val: 'Skip' }); deck.push({ color: c, val: 'Skip' });
    deck.push({ color: c, val: 'Rev' }); deck.push({ color: c, val: 'Rev' });
    deck.push({ color: c, val: '+2' }); deck.push({ color: c, val: '+2' });
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'black', val: 'Color' });
    deck.push({ color: 'black', val: '+4' });
  }
  return deck.sort(() => Math.random() - 0.5);
}

function startUnoGame() {
  const fillBots = document.getElementById('uno-fill-bots').checked;
  if (fillBots) {
    let botIndex = 1;
    while (state.uno.players.size < state.uno.maxPlayers) {
      const bId = 'bot-' + botIndex;
      state.uno.players.set(bId, { name: '🤖 Bot ' + botIndex, ready: true, cardCount: 0 });
      botIndex++;
    }
    broadcast({ type: 'uno-lobby-sync', players: Array.from(state.uno.players.entries()) });
  }

  const deck = getUnoDeck();
  const hands = {};
  const turnOrder = Array.from(state.uno.players.keys());
  state.uno.botHands = {};
  for (const id of turnOrder) {
    hands[id] = [];
    for (let i = 0; i < 7; i++) hands[id].push(deck.pop());
    if (id.startsWith('bot-')) state.uno.botHands[id] = hands[id];
  }
  let firstCard = deck.pop();
  while (firstCard.color === 'black' || firstCard.val === 'Skip' || firstCard.val === 'Rev' || firstCard.val === '+2') {
    deck.unshift(firstCard);
    firstCard = deck.pop();
  }
  
  const startMsg = {
    type: 'uno-start',
    turnOrder, turnIndex: 0, direction: 1,
    hands, firstCard
  };
  
  state.uno.started = true;
  state.uno.deck = deck;
  state.uno.turnOrder = turnOrder;
  state.uno.turnIndex = 0;
  state.uno.direction = 1;
  state.uno.myHand = hands[state.myId];
  for (const id of turnOrder) {
    if (state.uno.players.has(id)) state.uno.players.get(id).cardCount = hands[id].length;
  }
  state.uno.discard = [firstCard];
  state.uno.currentColor = firstCard.color;

  broadcast(startMsg);
  
  document.getElementById('uno-lobby').classList.add('hidden');
  document.getElementById('uno-game').classList.remove('hidden');
  renderUnoGame();
}

function renderUnoGame() {
  if (document.startViewTransition) {
    document.startViewTransition(() => doRenderUnoGame());
  } else {
    doRenderUnoGame();
  }
}

function doRenderUnoGame() {
  if (!state.uno.started) return;
  
  const currentTurnId = state.uno.turnOrder[state.uno.turnIndex];
  const pName = state.uno.players.get(currentTurnId)?.name || 'Bilinmiyor';
  document.getElementById('uno-turn-name').textContent = pName;
  document.getElementById('uno-turn-indicator').style.background = (currentTurnId === state.myId) ? 'var(--ok)' : 'rgba(0,0,0,0.6)';
  
  if (currentTurnId.startsWith('bot-') && state.myId === state.uno.host) {
    if (state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
    state.uno.botTimeout = setTimeout(() => {
      botPlay(currentTurnId);
    }, 1500);
  }
  
  document.getElementById('uno-dir-indicator').textContent = state.uno.direction === 1 ? '🔃' : '🔄';
  
  const topCard = state.uno.discard[state.uno.discard.length - 1];
  const discardDiv = document.getElementById('uno-discard');
  discardDiv.className = `uno-card-ui ${state.uno.currentColor}`;
  if (state.uno.triggerDiscardAnim) {
    discardDiv.style.transform = 'scale(1.2)';
    setTimeout(() => { discardDiv.style.transform = 'scale(1)'; }, 150);
    state.uno.triggerDiscardAnim = false;
  }
  
  if (state.uno.currentColor !== topCard.color && topCard.color === 'black') {
     discardDiv.innerHTML = `<span class="mini tl">${topCard.val}</span> ${topCard.val} <span class="mini br">${topCard.val}</span>`;
     discardDiv.style.borderColor = state.uno.currentColor;
  } else {
     discardDiv.innerHTML = `<span class="mini tl">${topCard.val}</span> ${topCard.val} <span class="mini br">${topCard.val}</span>`;
     discardDiv.style.borderColor = 'white';
  }

  const table = document.getElementById('uno-table');
  table.querySelectorAll('.uno-remote-player').forEach(el => el.remove());
  
  const otherPlayers = [];
  let idx = state.uno.turnOrder.indexOf(state.myId);
  for (let i = 1; i < state.uno.turnOrder.length; i++) {
    const nextIdx = (idx + i) % state.uno.turnOrder.length;
    otherPlayers.push(state.uno.turnOrder[nextIdx]);
  }

  const angles = [];
  if (otherPlayers.length === 1) {
    angles.push(270);
  } else if (otherPlayers.length === 2) {
    angles.push(210, 330);
  } else if (otherPlayers.length === 3) {
    angles.push(180, 270, 0);
  }

  otherPlayers.forEach((id, i) => {
    const rp = document.createElement('div');
    rp.className = 'uno-remote-player';
    const angle = angles[i] || 0;
    const rad = angle * Math.PI / 180;
    const radiusX = 35; 
    const radiusY = 30; 
    
    rp.dataset.pid = id;
    rp.style.left = `calc(50% + ${Math.cos(rad) * radiusX}%)`;
    rp.style.top = `calc(50% + ${Math.sin(rad) * radiusY}%)`;
    rp.style.transform = `translate(-50%, -50%)`;
    
    const pInfo = state.uno.players.get(id);
    if (!pInfo) return;
    
    rp.innerHTML = `
      <div class="card-count" style="border-color: ${id === currentTurnId ? 'var(--ok)' : 'transparent'}">${pInfo.cardCount}</div>
      <div class="uname">${escapeHtml(pInfo.name)}</div>
    `;
    table.appendChild(rp);
  });

  const handDiv = document.getElementById('uno-my-hand');
  handDiv.innerHTML = '';
  state.uno.myHand.forEach((c, cIdx) => {
    const cDiv = document.createElement('div');
    cDiv.className = `uno-card-ui ${c.color}`;
    if (c._new) {
      cDiv.classList.add('draw-anim');
      delete c._new;
    }
    cDiv.innerHTML = `<span class="mini tl">${c.val}</span> ${c.val} <span class="mini br">${c.val}</span>`;
    
    cDiv.addEventListener('click', () => {
      if (currentTurnId !== state.myId) return;
      if (canPlay(c, topCard)) {
        if (c.color === 'black') {
          document.getElementById('uno-color-picker').classList.remove('hidden');
          document.querySelectorAll('.ucc').forEach(btn => {
            btn.onclick = () => {
              const selectedColor = btn.dataset.color;
              document.getElementById('uno-color-picker').classList.add('hidden');
              playCard(cIdx, selectedColor);
            };
          });
        } else {
          playCard(cIdx);
        }
      } else {
        showToast("Bu kartı oynayamazsın!", "warn");
      }
    });
    handDiv.appendChild(cDiv);
  });

  document.getElementById('uno-deck').onclick = () => {
    if (currentTurnId === state.myId) {
      if (state.uno.host === state.myId) {
        if (state.uno.deck.length === 0) {
          showToast("Deste Bitti!", "warn");
          return;
        }
        const newCard = state.uno.deck.pop();
        state.uno.myHand.push({ ...newCard, _new: true });
        const p = state.uno.players.get(state.myId);
        if(p) p.cardCount++;
        state.uno.turnIndex = getNextTurn();
        broadcast({ type: 'uno-draw', count: 1, nextTurnIndex: state.uno.turnIndex });
        renderUnoGame();
      } else {
        showToast("Host deste dağıtımı özelliği eklenmeli, şu an sadelik için kısıtlı.", "info");
      }
    }
  };
}

function canPlay(card, topCard) {
  if (card.color === 'black') return true;
  if (card.color === state.uno.currentColor) return true;
  if (card.val === topCard.val) return true;
  return false;
}

function getNextTurn(skip = 1) {
  let len = state.uno.turnOrder.length;
  let next = (state.uno.turnIndex + state.uno.direction * skip) % len;
  if (next < 0) next += len;
  return next;
}

function playCard(index, chosenColor = null) {
  playPopSound();
  const handDiv = document.getElementById('uno-my-hand');
  const cardEl = handDiv.children[index];
  if (cardEl) {
    cardEl.classList.add('play-anim');
  }
  
  setTimeout(() => {
    const card = state.uno.myHand.splice(index, 1)[0];
    const p = state.uno.players.get(state.myId);
    if (p) p.cardCount--;
    
    state.uno.discard.push(card);
    state.uno.currentColor = chosenColor || card.color;
    
    if (card.val === 'Rev') state.uno.direction *= -1;
    let skip = 1;
    if (card.val === 'Skip') skip = 2;
    
    state.uno.turnIndex = getNextTurn(skip);
    
    state.uno.triggerDiscardAnim = true;
    broadcast({ type: 'uno-play', card, color: chosenColor, direction: state.uno.direction, nextTurnIndex: state.uno.turnIndex });
    renderUnoGame();
    
    if (state.uno.myHand.length === 0) {
      showToast("KAZANDIN!", "ok");
    } else if (state.uno.myHand.length === 1) {
      const ub = document.getElementById('uno-uno-btn');
      if (ub) {
        ub.classList.remove('hidden');
        setTimeout(() => ub.classList.add('hidden'), 3000);
      }
    }
  }, 250);
}

function botPlay(botId) {
  if (!state.uno.started || state.myId !== state.uno.host) return;
  
  const botHand = state.uno.botHands[botId];
  if (!botHand) return;
  
  const topCard = state.uno.discard[state.uno.discard.length - 1];
  
  let validIndex = -1;
  for (let i = 0; i < botHand.length; i++) {
    if (canPlay(botHand[i], topCard)) {
      validIndex = i;
      break;
    }
  }
  
  if (validIndex !== -1) {
    const card = botHand.splice(validIndex, 1)[0];
    const p = state.uno.players.get(botId);
    if (p) p.cardCount--;
    
    state.uno.discard.push(card);
    let chosenColor = card.color;
    if (chosenColor === 'black') {
      const colors = ['red', 'blue', 'green', 'yellow'];
      chosenColor = colors[Math.floor(Math.random() * colors.length)];
    }
    state.uno.currentColor = chosenColor;
    
    if (card.val === 'Rev') state.uno.direction *= -1;
    let skip = 1;
    if (card.val === 'Skip') skip = 2;
    state.uno.turnIndex = getNextTurn(skip);
    
    broadcast({ type: 'uno-play', card, color: chosenColor, direction: state.uno.direction, nextTurnIndex: state.uno.turnIndex, botId });
    playPopSound();
    animateRemotePlay(botId, card);
    state.uno.triggerDiscardAnim = true;
    setTimeout(() => renderUnoGame(), 300);
    
    if (botHand.length === 0) {
      showToast(p.name + " KAZANDI!", "ok");
    }
  } else {
    if (state.uno.deck.length > 0) {
      const newCard = state.uno.deck.pop();
      botHand.push(newCard);
      const p = state.uno.players.get(botId);
      if(p) p.cardCount++;
      state.uno.turnIndex = getNextTurn();
      broadcast({ type: 'uno-draw', count: 1, nextTurnIndex: state.uno.turnIndex, botId });
      renderUnoGame();
    } else {
      state.uno.turnIndex = getNextTurn();
      broadcast({ type: 'uno-draw', count: 0, nextTurnIndex: state.uno.turnIndex, botId }); 
      renderUnoGame();
    }
  }
}

function playPopSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 800;
    noise.connect(noiseFilter);
    
    const noiseGain = ctx.createGain();
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    noiseGain.gain.setValueAtTime(0.5, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    osc.start(ctx.currentTime);
    noise.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
    noise.stop(ctx.currentTime + 0.1);
  } catch (e) {}
}

function showFloatingEmoji(pid, emoji) {
  let target = document.getElementById('uno-table');
  let x = '50%';
  let y = '80%';
  
  if (pid !== state.myId) {
    const rp = Array.from(document.querySelectorAll('.uno-remote-player')).find(el => el.dataset.pid === pid);
    if (rp) {
      x = rp.style.left;
      y = rp.style.top;
    }
  }

  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = x;
  el.style.top = y;
  target.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function animateRemotePlay(pId, card) {
  const table = document.getElementById('uno-table');
  const rp = Array.from(document.querySelectorAll('.uno-remote-player')).find(el => el.dataset.pid === pId);
  if (!rp) return;
  
  const dummy = document.createElement('div');
  dummy.className = `uno-card-ui ${card.color}`;
  dummy.style.position = 'absolute';
  dummy.style.left = rp.style.left;
  dummy.style.top = rp.style.top;
  dummy.style.transform = 'translate(-50%, -50%) scale(0.5)';
  dummy.style.zIndex = 100;
  dummy.style.transition = 'all 0.3s ease-out';
  dummy.innerHTML = `<span class="mini tl">${card.val}</span> ${card.val} <span class="mini br">${card.val}</span>`;
  table.appendChild(dummy);
  
  setTimeout(() => {
    dummy.style.left = '50%';
    dummy.style.top = '50%';
    dummy.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 10);
  
  setTimeout(() => dummy.remove(), 300);
}
