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
  screenStream: null,
  processedStream: null,
  audioCtx: null,
  micEnabled: true,
  deafened: false,
  isSharing: false,
  isRecording: false,
  recordingStream: null,
  recorder: null,
  recordedChunks: [],
  recStart: 0,
  pttMode: false,
  friendId: '',
  friends: {},
  friendRequests: [],
  globalMqtt: null,
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
  micThreshold: 20,
  dms: {}, // { friendId: [ { sender: 'me'|'them', type: 'text'|'file', content: '...', timestamp: 123 }, ... ] }
  activeDM: null,
  myAvatar: null,
  myAvatarHash: null
};

const CHUNK_SIZE = 64 * 1024;
const fileBuffer = new Map();

let mqttClient = null;
let internetAnnounceInterval = null;

function setupInternetSignaling(roomId, myId, myName) {
  if (mqttClient) mqttClient.end();
  
  // Sinyalleşmeyi HiveMQ üzerinden Cloudflare Oda ID'si ile yapıyoruz.
  let brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

  mqttClient = mqtt.connect(brokerUrl);
  
  mqttClient.on('connect', () => {
    if (!mqttClient) return; // Prevent crash if disconnected during connection phase
    console.log('🌐 İnternet sunucusuna bağlanıldı (MQTT)');
    mqttClient.subscribe(`teamsync/room/${roomId}/#`);
    
    if (internetAnnounceInterval) clearInterval(internetAnnounceInterval);
    internetAnnounceInterval = setInterval(() => {
      if (mqttClient) {
        mqttClient.publish(`teamsync/room/${roomId}/${myId}`, JSON.stringify({
          type: 'hello',
          id: myId,
          name: myName,
          avatar: state.myAvatar || null
        }));
      }
    }, 3000);
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      if (topic.endsWith('/file')) {
        const buf = new Uint8Array(message);
        let pipeIdx = -1;
        for (let i = 0; i < 100; i++) {
          if (buf[i] === 124) { // '|'
            pipeIdx = i;
            break;
          }
        }
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
        return;
      }

      const data = JSON.parse(message.toString());
      if (data.id === myId) return;
      
      if (data.type === 'hello') {
        handlePeerDiscovered({ id: data.id, name: data.name, ip: 'internet', avatar: data.avatar });
      } else if (data.type === 'signal' && data.target === myId) {
        let peer = state.peers.get(data.id);
        if (!peer) {
          await handlePeerDiscovered({ id: data.id, name: data.name || 'Bilinmeyen', ip: 'internet', avatar: data.avatar });
          peer = state.peers.get(data.id);
        }
        if (peer) {
          peer.ip = 'internet';
          handleSignal(data.id, 'internet', data.signal);
        }
      } else if (data.type === 'room-broadcast') {
        handleDataMessage(data.id, data.payload);
      } else if (data.type === 'room-private' && data.target === myId) {
        handleDataMessage(data.id, data.payload);
      }
    } catch(e) {}
  });
}

function sendInternetSignal(targetId, signal) {
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(`teamsync/room/${state.room}/${targetId}`, JSON.stringify({
      type: 'signal',
      id: state.myId,
      name: state.myName,
      target: targetId,
      signal: signal
    }));
  }
}

async function handleSignal(id, ip, signal) {
  const peer = state.peers.get(id);
  if (!peer) return;
  if (!peer.ip) peer.ip = ip;
  if (!peer.iceQueue) peer.iceQueue = [];

  console.log(`📨 Signal received from ${peer.name}: ${signal.type}, ip=${ip}`);

  try {
    if (signal.type === 'offer') {
      // Update peer IP to the one the signal came from
      peer.ip = ip;
      if (peer.pc.signalingState !== 'stable') {
        console.warn('Received offer but signaling state is:', peer.pc.signalingState, '- rolling back');
        await peer.pc.setLocalDescription({ type: 'rollback' });
      }
      await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      if (ip === 'internet') {
        sendInternetSignal(id, { type: 'answer', sdp: answer });
      } else {
        window.electronAPI.sendUDPSignal(ip, { type: 'answer', sdp: answer });
      }
      // Process queued candidates
      while (peer.iceQueue.length) {
        await peer.pc.addIceCandidate(peer.iceQueue.shift());
      }
    } else if (signal.type === 'answer') {
      if (peer.pc.signalingState === 'have-local-offer') {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        // Process queued candidates
        while (peer.iceQueue.length) {
          await peer.pc.addIceCandidate(peer.iceQueue.shift());
        }
      } else {
        console.warn('Received answer but signaling state is:', peer.pc.signalingState);
      }
    } else if (signal.type === 'ice') {
      if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
        await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else {
        peer.iceQueue.push(new RTCIceCandidate(signal.candidate));
      }
    }
  } catch (e) {
    console.error('Signal handle error:', e);
  }
}

async function setupCrypto(password) {
  if (!password) return null;
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('teamsync-salt'), iterations: 100000, hash: 'SHA-256' },
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

function getAvatarHash(base64Str) {
  if (!base64Str) return null;
  let hash = 0;
  for (let i = 0; i < base64Str.length; i++) {
    hash = ((hash << 5) - hash) + base64Str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function saveProfile() {
  localStorage.setItem('teamsync_profile', JSON.stringify({
    name: state.myName,
    id: state.friendId,
    avatar: state.myAvatar,
    avatarHash: state.myAvatarHash,
    friends: state.friends,
    requests: state.friendRequests
  }));
  renderFriends();
}

function loadDMs() {
  const savedDMs = localStorage.getItem('teamsync_dms');
  if (savedDMs) {
    try { state.dms = JSON.parse(savedDMs); } catch(e) {}
  }
}

function saveDMs() {
  localStorage.setItem('teamsync_dms', JSON.stringify(state.dms));
}

function renderFriends() {
  const flist = document.getElementById('friends-list');
  const invitesBadge = document.getElementById('invite-badge');
  const invitesList = document.getElementById('invites-list');
  
  if (!flist || !invitesBadge || !invitesList) return;

  // Badge gösterimi - CSS'de default display:none
  if (state.friendRequests.length > 0) {
    invitesBadge.style.display = 'flex';
    invitesBadge.textContent = state.friendRequests.length;
  } else {
    invitesBadge.style.display = 'none';
  }
  
  // Render Invites
  invitesList.innerHTML = '';
  if (state.friendRequests.length === 0) {
    invitesList.innerHTML = '<li class="muted" style="text-align: center; padding: 12px;">Bekleyen davet yok.</li>';
  } else {
    state.friendRequests.forEach((req, idx) => {
      const li = document.createElement('li');
      li.className = 'invite-item';
      li.innerHTML = `
        <div style="font-size: 13px;"><b>${escapeHtml(req.name)}</b><br><span class="muted">${escapeHtml(req.id)}</span></div>
        <div class="invite-actions">
          <button class="icon-btn sm" style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.3);" onclick="acceptInvite(${idx})" title="Kabul Et">✓</button>
          <button class="icon-btn sm" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; border-color: rgba(239, 68, 68, 0.3);" onclick="rejectInvite(${idx})" title="Reddet">✕</button>
        </div>
      `;
      invitesList.appendChild(li);
    });
  }
  
  // Render Friends
  flist.innerHTML = '';
  const friendKeys = Object.keys(state.friends);
  if (friendKeys.length === 0) {
    flist.innerHTML = '<li class="muted menu-empty-friends">Henüz hiç arkadaşın yok.</li>';
  } else {
    friendKeys.forEach(fId => {
      const f = state.friends[fId];
      const isOnline = f.online ? 'online' : '';
      const inRoom = f.room ? true : false;
      const avatarHtml = f.avatar 
        ? `<img src="${escapeHtml(f.avatar)}" class="friend-avatar" />`
        : `<div class="friend-avatar" style="background: rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; font-size:16px;">👤</div>`;

      const li = document.createElement('li');
      li.className = 'friend-item';
      li.innerHTML = `
        <div class="friend-info">
          <div style="position:relative;">
            ${avatarHtml}
            <div class="friend-status ${isOnline}" id="status-${fId}" style="position:absolute; bottom:0; right:6px; border:2px solid #1e1e24; margin:0;"></div>
          </div>
          <div>
            <b>${escapeHtml(f.name)}</b>
            ${inRoom ? '<div style="font-size: 11px; color: var(--ok); margin-top: 2px;">🟢 Sunucuda</div>' : ''}
          </div>
        </div>
        <div class="friend-actions">
          <button class="icon-btn sm" style="background: rgba(139, 92, 246, 0.2); color: #c4b5fd; border-color: rgba(139, 92, 246, 0.3);" onclick="openDM('${fId}')" title="Mesaj Gönder">💬</button>
          ${inRoom ? `<button class="icon-btn sm" style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.3);" onclick="requestJoinRoom('${fId}')" title="Sunucusuna Katıl">🎮</button>` : ''}
          <button class="icon-btn sm" style="color: #fca5a5;" onclick="removeFriend('${fId}')" title="Arkadaşlıktan Çıkar">✕</button>
        </div>
      `;
      flist.appendChild(li);
    });
  }
}

window.requestJoinRoom = (fId) => {
  if (state.globalMqtt && state.globalMqtt.connected) {
    state.globalMqtt.publish(`teamsync/user/${fId}/events`, JSON.stringify({
      type: 'room_join_request',
      id: state.friendId,
      name: state.myName
    }));
    showToast("Katılma isteği gönderildi, bekleniyor...", "info");
  } else {
    showToast("Bağlantı bekleniyor...", "warn");
  }
};

window.acceptInvite = (idx) => {
  const req = state.friendRequests[idx];
  state.friends[req.id] = { name: req.name, online: false };
  state.friendRequests.splice(idx, 1);
  saveProfile();
  
  if (state.globalMqtt && state.globalMqtt.connected) {
    state.globalMqtt.publish(`teamsync/user/${req.id}/events`, JSON.stringify({
      type: 'friend_accepted',
      id: state.friendId,
      name: state.myName
    }));
    state.globalMqtt.subscribe(`teamsync/user/${req.id}/presence`);
  }
  showToast(`${req.name} ile arkadaş oldunuz!`, 'ok');
};

window.rejectInvite = (idx) => {
  state.friendRequests.splice(idx, 1);
  saveProfile();
};

window.removeFriend = (id) => {
  if (confirm('Bu kişiyi arkadaşlıktan çıkarmak istediğine emin misin?')) {
    delete state.friends[id];
    saveProfile();
    if (state.globalMqtt) {
      state.globalMqtt.unsubscribe(`teamsync/user/${id}/presence`);
    }
  }
};

let presenceInterval = null;

function setupGlobalMQTT() {
  if (state.globalMqtt) return;
  state.globalMqtt = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');
  
  state.globalMqtt.on('connect', () => {
    console.log('🔗 Global MQTT (Arkadaşlık) bağlandı');
    state.globalMqtt.subscribe(`teamsync/user/${state.friendId}/events`);
    
    Object.keys(state.friends).forEach(fId => {
      state.globalMqtt.subscribe(`teamsync/user/${fId}/presence`);
    });
    
    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(() => {
      state.globalMqtt.publish(`teamsync/user/${state.friendId}/presence`, JSON.stringify({
        online: true,
        id: state.friendId,
        name: state.myName,
        room: state.room || null,
        avatarHash: state.myAvatarHash || null
      }));
    }, 5000);

    setInterval(() => {
      if (state.globalMqtt && state.globalMqtt.connected) {
        state.globalMqtt.publish(`teamsync/user/${state.friendId}/events`, JSON.stringify({
          type: 'ping_latency_req',
          ts: Date.now()
        }));
      }
    }, 2000);
  });
  
  state.globalMqtt.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      if (topic.endsWith('/presence')) {
        if (state.friends[data.id]) {
          const wasOnline = state.friends[data.id].online;
          const oldRoom = state.friends[data.id].room;
          const oldAvatarHash = state.friends[data.id].avatarHash;
          
          state.friends[data.id].online = true;
          state.friends[data.id].lastSeen = Date.now();
          state.friends[data.id].room = data.room;
          state.friends[data.id].avatarHash = data.avatarHash;
          
          if (data.avatarHash && oldAvatarHash !== data.avatarHash) {
            state.globalMqtt.publish(`teamsync/user/${data.id}/events`, JSON.stringify({
              type: 'req_avatar',
              fromId: state.friendId
            }));
          }
          
          if (!wasOnline || oldRoom !== data.room || oldAvatarHash !== data.avatarHash) {
            renderFriends();
          } else {
            const dot = document.getElementById(`status-${data.id}`);
            if (dot) dot.classList.add('online');
          }
        }
      } else if (topic.endsWith('/events')) {
        if (data.type === 'ping_latency_req' && data.ts) {
          const latency = Date.now() - data.ts;
          const pingMsEl = document.getElementById('global-ping-ms');
          const pingDisp = document.getElementById('global-ping-display');
          if (pingMsEl && pingDisp) {
            pingMsEl.textContent = latency;
            pingDisp.className = 'global-ping ' + (latency < 100 ? 'ping-good' : (latency < 250 ? 'ping-ok' : 'ping-bad'));
          }
          const selfPingEl = document.getElementById('ping-self');
          if (selfPingEl) {
            selfPingEl.textContent = `${latency}ms`;
            selfPingEl.className = 'uping ' + (latency < 100 ? 'ping-good' : (latency < 250 ? 'ping-ok' : 'ping-bad'));
          }
          return;
        }

        if (data.type === 'friend_request') {
          if (!state.friends[data.id] && !state.friendRequests.find(r => r.id === data.id)) {
            state.friendRequests.push({ id: data.id, name: data.name });
            saveProfile();
            showToast(`${data.name} sana arkadaşlık isteği gönderdi!`, 'info');
            renderFriends();
          }
        } else if (data.type === 'friend_accepted') {
          if (!state.friends[data.id]) {
            state.friends[data.id] = { name: data.name, online: false };
            saveProfile();
            showToast(`${data.name} arkadaşlık isteğini kabul etti!`, 'ok');
            state.globalMqtt.subscribe(`teamsync/user/${data.id}/presence`);
            renderFriends();
          }
        } else if (data.type === 'room_join_request') {
          if (state.room) {
            state.pendingJoinReq = { id: data.id, name: data.name };
            document.getElementById('join-req-name').textContent = data.name;
            document.getElementById('join-request-modal').classList.remove('hidden');
          } else {
            state.globalMqtt.publish(`teamsync/user/${data.id}/events`, JSON.stringify({
              type: 'room_join_declined',
              id: state.friendId,
              name: state.myName
            }));
          }
        } else if (data.type === 'room_join_accepted') {
          showToast(`${data.name} isteğini kabul etti, bağlanılıyor...`, 'ok');
          document.getElementById('step-action').classList.add('hidden'); document.querySelector('.login-card').classList.remove('expanded');
          const ai = document.getElementById('join-useAI') ? document.getElementById('join-useAI').checked : true;
          const ptt = document.getElementById('join-usePTT') ? document.getElementById('join-usePTT').checked : false;
          // startApp'i direk cagiramayabiliriz eger degiskense ama event listener'in altinda veya global
          // Wait, startApp is scoped inside DOMContentLoaded in this code. Let's trigger a UI update or just dispatch an event?
          // I will fix startApp scope later. For now let's set values and click join.
          const joinIdInput = document.getElementById('join-id');
          const joinPwInput = document.getElementById('join-password');
          const btnJoin = document.getElementById('btn-join');
          if(joinIdInput && btnJoin) {
             joinIdInput.value = data.roomId;
             if(joinPwInput) joinPwInput.value = data.password || '';
             btnJoin.click();
          }
        } else if (data.type === 'room_join_declined') {
          showToast(`${data.name} katılma isteğini reddetti veya bir sunucuda değil.`, 'warn');
        } else if (data.type === 'server_invite_received') {
          state.pendingServerInvite = { id: data.id, name: data.name, roomId: data.roomId, password: data.password };
          document.getElementById('server-invite-name').textContent = data.name;
          document.getElementById('server-invite-received-modal').classList.remove('hidden');
        } else if (data.type === 'req_avatar') {
          if (state.myAvatar) {
            state.globalMqtt.publish(`teamsync/user/${data.fromId}/events`, JSON.stringify({
              type: 'res_avatar',
              fromId: state.friendId,
              avatar: state.myAvatar
            }));
          }
        } else if (data.type === 'res_avatar') {
          if (state.friends[data.fromId]) {
            state.friends[data.fromId].avatar = data.avatar;
            saveProfile();
          }
        } else if (data.type === 'dm_msg' || data.type === 'dm_file_start' || data.type === 'dm_file_chunk') {
          receiveDM(data.fromId, data);
        }
      }
    } catch(e) {}
  });
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  Object.keys(state.friends).forEach(fId => {
    if (state.friends[fId].online && now - (state.friends[fId].lastSeen || 0) > 15000) {
      state.friends[fId].online = false;
      const dot = document.getElementById(`status-${fId}`);
      if (dot) dot.classList.remove('online');
      changed = true;
    }
  });
}, 10000);


const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Açık kaynaklı ve public TURN sunucusu (Symmetric NAT aşmak için)
  { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
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
      stepAction.classList.remove('hidden'); document.querySelector('.login-card').classList.add('expanded');
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

  const savedProfile = localStorage.getItem('teamsync_profile');
  if (savedProfile) {
    try {
      const data = JSON.parse(savedProfile);
      state.myName = data.name || 'TeamSync';
      state.friendId = data.id || `KNK-${crypto.randomUUID().toUpperCase()}`;
      state.myAvatar = data.avatar || null;
      state.myAvatarHash = data.avatarHash || null;
      state.friends = data.friends || {};
      state.friendRequests = data.requests || [];
      
      displayName.textContent = state.myName;
      document.getElementById('my-friend-id').textContent = state.friendId;

      if (state.myAvatar) {
        document.getElementById('my-avatar-img').src = state.myAvatar;
        document.getElementById('my-avatar-img').style.display = 'block';
        document.getElementById('my-avatar-default').style.display = 'none';
      }
      
      stepName.classList.add('hidden');
      stepAction.classList.remove('hidden'); document.querySelector('.login-card').classList.add('expanded');
      
      renderFriends();
      setupGlobalMQTT();
    } catch(e) {}
  }

  btnNextName.addEventListener('click', () => {
    const n = nameInp.value.trim() || 'Anonim';
    state.myName = n;
    
    if (!state.friendId) {
      state.friendId = `KNK-${crypto.randomUUID().toUpperCase()}`;
    }
    
    displayName.textContent = n;
    document.getElementById('my-friend-id').textContent = state.friendId;
    
    saveProfile();
    
    stepName.classList.add('hidden');
    stepAction.classList.remove('hidden'); document.querySelector('.login-card').classList.add('expanded');
    
    setupGlobalMQTT();
  });

  document.getElementById('my-friend-id').addEventListener('click', () => {
    navigator.clipboard.writeText(state.friendId).then(() => {
      showToast('ID kopyalandı!', 'ok');
    });
  });

  document.getElementById('btn-copy-friend-id').addEventListener('click', () => {
    navigator.clipboard.writeText(state.friendId).then(() => {
      showToast('ID kopyalandı!', 'ok');
    });
  });

  document.getElementById('btn-edit-name').addEventListener('click', () => {
    document.getElementById('edit-name-input').value = state.myName;
    document.getElementById('edit-name-modal').classList.remove('hidden');
    document.getElementById('edit-name-input').focus();
  });

  document.getElementById('edit-name-cancel').addEventListener('click', () => {
    document.getElementById('edit-name-modal').classList.add('hidden');
  });

  document.getElementById('edit-name-save').addEventListener('click', () => {
    const newName = document.getElementById('edit-name-input').value.trim();
    if (newName.length > 0) {
      state.myName = newName;
      document.getElementById('display-name').textContent = state.myName;
      saveProfile();
      showToast('Adınız güncellendi!', 'ok');
      document.getElementById('edit-name-modal').classList.add('hidden');
    }
  });

  document.getElementById('btn-show-add-friend').addEventListener('click', () => {
    document.getElementById('step-action').classList.add('hidden'); document.querySelector('.login-card').classList.remove('expanded');
    document.getElementById('step-add-friend').classList.remove('hidden');
  });

  document.getElementById('btn-show-invites').addEventListener('click', () => {
    document.getElementById('invites-modal').classList.remove('hidden');
  });

  document.getElementById('invites-close').addEventListener('click', () => {
    document.getElementById('invites-modal').classList.add('hidden');
  });

  document.getElementById('btn-add-friend').addEventListener('click', () => {
    const targetId = document.getElementById('friend-id-input').value.trim().toUpperCase();
    if (!targetId || targetId === state.friendId) return alert("Geçerli bir ID girin.");
    
    if (state.friends[targetId]) return alert("Bu kişi zaten arkadaşın!");
    
    if (state.globalMqtt && state.globalMqtt.connected) {
      state.globalMqtt.publish(`teamsync/user/${targetId}/events`, JSON.stringify({
        type: 'friend_request',
        id: state.friendId,
        name: state.myName
      }));
      showToast("Arkadaşlık isteği gönderildi!", "ok");
      document.getElementById('friend-id-input').value = '';
      document.getElementById('step-add-friend').classList.add('hidden');
      document.getElementById('step-action').classList.remove('hidden'); document.querySelector('.login-card').classList.add('expanded');
    } else {
      showToast("Bağlantı bekleniyor...", "warn");
    }
  });

  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('step-join').classList.add('hidden');
      document.getElementById('step-create').classList.add('hidden');
      document.getElementById('step-add-friend').classList.add('hidden');
      document.getElementById('step-action').classList.remove('hidden'); document.querySelector('.login-card').classList.add('expanded');
    });
  });

  btnShowJoin.addEventListener('click', () => {
    stepAction.classList.add('hidden'); document.querySelector('.login-card').classList.remove('expanded');
    stepJoin.classList.remove('hidden');
  });

  btnShowCreate.addEventListener('click', () => {
    document.getElementById('error-modal').classList.add('hidden');
    stepAction.classList.add('hidden'); document.querySelector('.login-card').classList.remove('expanded');
    stepCreate.classList.remove('hidden');
  });

  const joinReqAcceptBtn = document.getElementById('join-req-accept');
  const joinReqDenyBtn = document.getElementById('join-req-deny');
  
  if (joinReqAcceptBtn) {
    joinReqAcceptBtn.addEventListener('click', () => {
      if (state.pendingJoinReq && state.room && state.globalMqtt) {
        state.globalMqtt.publish(`teamsync/user/${state.pendingJoinReq.id}/events`, JSON.stringify({
          type: 'room_join_accepted',
          id: state.friendId,
          name: state.myName,
          roomId: state.room,
          password: state.password || ''
        }));
      }
      document.getElementById('join-request-modal').classList.add('hidden');
      state.pendingJoinReq = null;
    });
  }

  if (joinReqDenyBtn) {
    joinReqDenyBtn.addEventListener('click', () => {
      if (state.pendingJoinReq && state.globalMqtt) {
        state.globalMqtt.publish(`teamsync/user/${state.pendingJoinReq.id}/events`, JSON.stringify({
          type: 'room_join_declined',
          id: state.friendId,
          name: state.myName
        }));
      }
      document.getElementById('join-request-modal').classList.add('hidden');
      state.pendingJoinReq = null;
    });
  }

  window.sendServerInvite = (fId) => {
    if (state.globalMqtt && state.globalMqtt.connected) {
      state.globalMqtt.publish(`teamsync/user/${fId}/events`, JSON.stringify({
        type: 'server_invite_received',
        id: state.friendId,
        name: state.myName,
        roomId: state.room,
        password: state.password
      }));
      showToast("Davet gönderildi!", "ok");
    } else {
      showToast("Bağlantı sorunu.", "warn");
    }
  };

  const renderServerFriends = () => {
    const list = document.getElementById('server-friends-list');
    if (!list) return;
    list.innerHTML = '';
    const onlineFriends = Object.keys(state.friends).filter(fId => state.friends[fId].online);
    
    if (onlineFriends.length === 0) {
      list.innerHTML = '<li class="muted" style="text-align: center; padding: 16px;">Şu an çevrimiçi arkadaşın yok.</li>';
      return;
    }
    
    onlineFriends.forEach(fId => {
      const f = state.friends[fId];
      // Aynı odada olanlara davet atma
      if (f.room === state.room && state.room) return; 

      const li = document.createElement('li');
      li.className = 'friend-item';
      li.innerHTML = `
        <div class="friend-info">
          <div class="friend-status online"></div>
          <div><b>${escapeHtml(f.name)}</b></div>
        </div>
        <div class="friend-actions">
          <button class="btn-pri btn-sm" style="padding: 6px 12px; border-radius: 6px; cursor:pointer;" onclick="sendServerInvite('${fId}')">Davet Et</button>
        </div>
      `;
      list.appendChild(li);
    });
    
    if (list.innerHTML === '') {
      list.innerHTML = '<li class="muted" style="text-align: center; padding: 16px;">Davet edilecek arkadaş bulunamadı.</li>';
    }
  };

  const btnShowServerInvites = document.getElementById('btn-show-server-invites');
  if (btnShowServerInvites) {
    btnShowServerInvites.addEventListener('click', () => {
      renderServerFriends();
      document.getElementById('server-invites-modal').classList.remove('hidden');
    });
  }
  
  const serverInvitesClose = document.getElementById('server-invites-close');
  if (serverInvitesClose) {
    serverInvitesClose.addEventListener('click', () => {
      document.getElementById('server-invites-modal').classList.add('hidden');
    });
  }

  const serverInviteAcceptBtn = document.getElementById('server-invite-accept');
  if (serverInviteAcceptBtn) {
    serverInviteAcceptBtn.addEventListener('click', () => {
      document.getElementById('server-invite-received-modal').classList.add('hidden');
      if (state.pendingServerInvite) {
        if (state.room) disconnectApp();
        
        document.getElementById('step-action').classList.add('hidden'); document.querySelector('.login-card').classList.remove('expanded');
        
        const joinIdInput = document.getElementById('join-id');
        const joinPwInput = document.getElementById('join-password');
        const btnJoin = document.getElementById('btn-join');
        if(joinIdInput && btnJoin) {
           joinIdInput.value = state.pendingServerInvite.roomId;
           if(joinPwInput) joinPwInput.value = state.pendingServerInvite.password || '';
           btnJoin.click();
        }
        state.pendingServerInvite = null;
      }
    });
  }

  const serverInviteDenyBtn = document.getElementById('server-invite-deny');
  if (serverInviteDenyBtn) {
    serverInviteDenyBtn.addEventListener('click', () => {
      document.getElementById('server-invite-received-modal').classList.add('hidden');
      state.pendingServerInvite = null;
    });
  }

  const startApp = async (roomId, pw, useAI, pttMode, serverName, isJoining = false) => {
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
      
      if (!isJoining) {
        document.getElementById('login').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        const tb = document.querySelector('.top-bar'); if(tb) tb.style.display = 'flex';
      }
      
      document.getElementById('room-title').textContent = '# ' + serverName + (state.cryptoKey ? ' 🔒' : '');
      document.getElementById('display-server-id').textContent = roomId;
      
      addUser({ id: 'self', name: state.myName + ' (sen)', mic: true, deaf: false, sharing: false, self: true, avatar: state.myAvatar });
      
      window.electronAPI.startDiscovery(state.myId, state.myName, state.room);
      setupInternetSignaling(state.room, state.myId, state.myName);
      
      if (!state.ipcAttached) {
        window.electronAPI.onPeerDiscovered((event, peer) => {
          handlePeerDiscovered(peer);
        });
        window.electronAPI.onUDPSignal(async (event, { id, ip, signal }) => {
          handleSignal(id, ip, signal);
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
    document.getElementById('error-modal').classList.add('hidden');
    const roomId = joinId.value.trim().toLowerCase();
    if (!roomId) return alert("Lütfen bir Sunucu ID girin!");
    
    const originalText = btnJoin.textContent;
    btnJoin.textContent = "Aranıyor...";
    btnJoin.disabled = true;

    state.isJoining = true;
    startApp(roomId, joinPw.value, joinAi.checked, joinPtt.checked, "Sunucu " + roomId, true);

    // Sunucu var mı kontrolü (4 saniye içinde kimse bulunamazsa iptal et)
    if (state.joinTimeout) clearTimeout(state.joinTimeout);
    state.joinTimeout = setTimeout(() => {
      btnJoin.textContent = originalText;
      btnJoin.disabled = false;
      
      if (!state.isJoining || state.room !== roomId) return;

      // Eğer hiç peer yoksa, sunucu yok demektir (veya boş)
      if (state.peers.size === 0) {
        disconnectApp();
        document.getElementById('error-text').textContent = "Böyle bir sunucu bulunamadı. Lütfen ID'yi kontrol edin.";
        document.getElementById('error-modal').classList.remove('hidden');
      }
    }, 4000);
  });

  btnCreate.addEventListener('click', async () => {
    document.getElementById('error-modal').classList.add('hidden');
    if (state.joinTimeout) clearTimeout(state.joinTimeout);
    state.isJoining = false;
    const sName = createName.value.trim() || 'Oyun Odası';
    
    // Gerçek P2P ID mantığı: Cloudflared tüneline gerek kalmadan eşsiz bir ID üretiyoruz
    const odaId = "teamsync-" + Math.random().toString(36).substring(2, 10) + "-" + Math.random().toString(36).substring(2, 6);
    
    startApp(odaId, createPw.value, createAi.checked, createPtt.checked, sName, false);
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
  
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const blankVideoTrack = canvas.captureStream().getVideoTracks()[0];
  blankVideoTrack.enabled = false;
  state.processedStream.addTrack(blankVideoTrack);
  
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
  
  if (state.isJoining) {
    state.isJoining = false;
    document.getElementById('login').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    const tb = document.querySelector('.top-bar'); if(tb) tb.style.display = 'flex';
    if (state.joinTimeout) {
      clearTimeout(state.joinTimeout);
      state.joinTimeout = null;
    }
    const btnJoin = document.getElementById('btn-join');
    if (btnJoin) {
      btnJoin.textContent = 'Katıl';
      btnJoin.disabled = false;
    }
  }

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

  const sender = pc.getSenders().find(s => s.track?.kind === 'video');
  if (sender) {
    if (state.isSharing && state.screenStream) {
      sender.replaceTrack(state.screenStream.getVideoTracks()[0]);
    }
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      const peer = state.peers.get(peerId);
      const ip = peer ? peer.ip : peerIp;
      if (ip === 'internet') {
        sendInternetSignal(peerId, { type: 'ice', candidate: e.candidate });
      } else if (ip) {
        window.electronAPI.sendUDPSignal(ip, { type: 'ice', candidate: e.candidate });
      }
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE state [${peerName}]:`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'closed') {
      removePeer(peerId);
    } else if (pc.iceConnectionState === 'failed') {
      console.warn(`⚠️ WebRTC connection failed to ${peerName}. Voice/Video might not work, falling back to MQTT for data.`);
      showToast(`${peerName} ile sesli/görüntülü bağlantı kurulamadı (Veri kanalı aktif).`, 'warn');
    } else if (pc.iceConnectionState === 'connected') {
      console.log(`✅ WebRTC connected to ${peerName}`);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state [${peerName}]:`, pc.connectionState);
  };

  pc.ontrack = (e) => {
    const peer = state.peers.get(peerId);
    if (!peer) return;
    console.log(`🎵 Track received from ${peerName}:`, e.track.kind);

    if (e.track.kind === 'audio') {
      peer.audioEl.srcObject = e.streams[0];
      
      try {
        if (!state.remoteAudioCtx) state.remoteAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (!peer.gainNode) {
          const source = state.remoteAudioCtx.createMediaStreamSource(e.streams[0]);
          peer.gainNode = state.remoteAudioCtx.createGain();
          peer.gainNode.gain.value = 1.0;
          source.connect(peer.gainNode);
          peer.gainNode.connect(state.remoteAudioCtx.destination);
          peer.audioEl.muted = true;
        }
      } catch(err) {
        peer.audioEl.volume = 1.0;
        peer.audioEl.muted = false;
      }

      peer.audioEl.play().catch((err) => console.warn('Audio play failed:', err));
      setupSpeakingDetection(peerId, e.streams[0]);
    } else if (e.track.kind === 'video') {
      peer.videoEl.srcObject = e.streams[0];
      if (state.activeControl && state.activeControl.hostId === peerId) {
        document.getElementById('remote-vid').srcObject = e.streams[0];
      }
    }
  };

  // Only the initiator creates the data channel.
  // The non-initiator receives it via ondatachannel.
  let dc = null;
  if (isInitiator) {
    dc = pc.createDataChannel('app', { ordered: true });
    setupDataChannel(peerId, dc);
  }

  pc.ondatachannel = (e) => {
    if (e.channel.label === 'app') {
      console.log(`📡 Data channel received from ${peerName}`);
      const peer = state.peers.get(peerId);
      if (peer) {
        peer.dc = e.channel;
      }
      setupDataChannel(peerId, e.channel);
    }
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
    ip: peerIp,
    lastSeen: Date.now()
  });

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (peerIp === 'internet') {
      sendInternetSignal(peerId, { type: 'offer', sdp: offer });
    } else if (peerIp) {
      window.electronAPI.sendUDPSignal(peerIp, { type: 'offer', sdp: offer });
    }
  }
}

function setupDataChannel(peerId, dc) {
  dc.onopen = () => {
    console.log('✅ DC açıldı:', peerId);
    // Make sure peer.dc points to this open channel
    const peer = state.peers.get(peerId);
    if (peer) {
      peer.dc = dc;
      // Send initial state so the peer knows our mic/deaf/share status
      try {
        if (peer.pingInterval) clearInterval(peer.pingInterval);
        peer.pingInterval = setInterval(() => {
          if (dc.readyState === 'open') {
            dc.send(JSON.stringify({ type: 'ping-req', ts: Date.now() }));
          }
        }, 2000);

        dc.send(JSON.stringify({ type: 'state', mic: state.micEnabled, deaf: state.deafened }));
        if (state.isSharing) dc.send(JSON.stringify({ type: 'sharing', sharing: true }));
        
        // Sync Hosted Activities
        if (state.uno.host === state.myId && !state.uno.started) {
          dc.send(JSON.stringify({ type: 'uno-lobby', host: state.myId }));
          dc.send(JSON.stringify({ type: 'uno-lobby-sync', players: Array.from(state.uno.players.entries()) }));
        } else if (state.uno.host === state.myId && state.uno.started) {
          dc.send(JSON.stringify({ 
            type: 'uno-sync', 
            host: state.myId,
            players: Array.from(state.uno.players.entries()),
            turnOrder: state.uno.turnOrder,
            turnIndex: state.uno.turnIndex,
            direction: state.uno.direction,
            discard: state.uno.discard,
            currentColor: state.uno.currentColor,
            handsCount: Array.from(state.uno.players.entries()).map(([id, p]) => ({ id, count: p.cardCount }))
          }));
        }
        if (state.sb.host === state.myId) {
          dc.send(JSON.stringify({ type: 'sb-start', host: state.myId, interactive: state.sb.interactive }));
          dc.send(JSON.stringify({ type: 'sb-nav', url: document.getElementById('sb-url').value }));
        }
        if (state.act.wt && state.wt.player) {
           const vid = document.getElementById('wt-input').value;
           if (vid) dc.send(JSON.stringify({ type: 'wt-load', vid }));
        }
        if (state.myId < peerId && !document.getElementById('wb-card').classList.contains('hidden')) {
           const wbData = document.getElementById('wb-canvas').toDataURL('image/jpeg', 0.5);
           dc.send(JSON.stringify({ type: 'wb-sync', data: wbData }));
        }
      } catch (e) {}
    }
  };
  dc.onclose = () => {
    console.log('DC kapandı:', peerId);
    const peer = state.peers.get(peerId);
    if (peer && peer.pingInterval) clearInterval(peer.pingInterval);
  };
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
  
  // Data Channel'dan gelen her veri (ping dahil) bu bağlantının hala çok sağlıklı olduğunu gösterir.
  // Bu yüzden MQTT sunucusu geçici olarak yavaşlasa/kopsa bile WebRTC bağlantımız kopmayacak!
  peer.lastSeen = Date.now();

  if (msg.type === 'ping-req') {
    try {
      if (peer.dc && peer.dc.readyState === 'open') {
        peer.dc.send(JSON.stringify({ type: 'ping-res', ts: msg.ts }));
      }
    } catch(e) {}
  } else if (msg.type === 'ping-res') {
    const latency = Date.now() - msg.ts;
    const pingEl = document.getElementById(`ping-${peerId}`);
    if (pingEl) {
      pingEl.textContent = `${latency}ms`;
      pingEl.className = 'uping ' + (latency < 50 ? 'ping-good' : (latency < 120 ? 'ping-ok' : 'ping-bad'));
    }
  } else if (msg.type === 'state') {
    if (msg.mic !== undefined) peer.mic = msg.mic;
    if (msg.deaf !== undefined) peer.deaf = msg.deaf;
    updateUserUI(peerId);
  } else if (msg.type === 'sharing') {
    peer.sharing = msg.sharing;
    if (msg.sharing) {
      addVideoCard(peerId, peer.name, peer.videoEl, true);
    } else {
      removeVideoCard(peerId, true);
    }
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
      document.getElementById('wb-card').classList.remove('hidden');
      makeCardFocusable(document.getElementById('wb-card'));
      if (!state.wbJoined) {
         showInactiveOverlay('wb-card', 'Beyaz Tahta', () => {
             state.wbJoined = true;
             removeInactiveOverlay('wb-card');
             if (!focusedCard) toggleFocus(document.getElementById('wb-card'));
         });
      }
      drawWb(msg.tool, msg.x0 * 1920, msg.y0 * 1080, msg.x1 * 1920, msg.y1 * 1080, msg.color, msg.size, msg.text);
    }
  } else if (msg.type === 'wb-clear') {
    state.wbContext.fillStyle = '#ffffff';
    state.wbContext.fillRect(0,0,1920,1080);
  } else if (msg.type === 'wb-sync') {
    const img = new Image();
    img.onload = () => {
      state.wbContext.drawImage(img, 0, 0);
      const wbCard = document.getElementById('wb-card');
      wbCard.classList.remove('hidden');
      makeCardFocusable(wbCard);
      if (!state.wbJoined) {
         showInactiveOverlay('wb-card', 'Beyaz Tahta', () => {
             state.wbJoined = true;
             removeInactiveOverlay('wb-card');
             if (!focusedCard) toggleFocus(wbCard);
         });
      }
      updateEmptyGrid();
    };
    img.src = msg.data;
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
    
    if (!state.sb.joinedActivity) {
      showInactiveOverlay('sb-card', 'Ortak Tarayıcı', () => {
         state.sb.joinedActivity = true;
         removeInactiveOverlay('sb-card');
         if (!focusedCard) toggleFocus(document.getElementById('sb-card'));
         if (state.sb.lastUrl) {
           state.sb.ignoreNextNav = true;
           document.getElementById('sb-webview').src = state.sb.lastUrl;
           document.getElementById('sb-url').value = state.sb.lastUrl;
         }
      });
    }
    
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
    state.sb.lastUrl = msg.url;
    if (!state.sb.joinedActivity) return;
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

function addUser({ id, name, mic, deaf, sharing, self, ip, avatar }) {
  if (document.querySelector(`[data-uid="${id}"]`)) return;
  const li = document.createElement('li');
  li.className = 'user';
  li.dataset.uid = id;
  const avatarHtml = avatar 
    ? `<img src="${escapeHtml(avatar)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />`
    : name.charAt(0).toUpperCase();
  li.innerHTML = `
    <div class="av">
      ${avatarHtml}
      <div class="st"></div>
    </div>
    <div class="uname" style="flex:1;">
      <div style="font-weight:bold;">${escapeHtml(name)}</div>
      ${!self ? `
        <div style="display:flex; align-items:center; margin-top:2px;" title="Ses Seviyesi">
          <span style="font-size:10px; margin-right:4px;">🔉</span>
          <input type="range" class="vol-slider" min="0" max="2" step="0.1" value="1" data-vol="${id}" style="width:60px; height:4px; accent-color:var(--ok); cursor:pointer;">
        </div>
      ` : ''}
    </div>
    <div class="uact" style="display:flex; align-items:center; gap:8px;">
      <div id="ping-${id}" class="uping" title="Gecikme" style="font-size:11px; font-weight:bold;">--ms</div>
      ${!self ? `<button data-ctrl="${id}" title="Uzaktan kontrol iste">🖱️</button>` : ''}
    </div>
  `;
  document.getElementById('users').appendChild(li);
  if (!self) {
    li.querySelector(`[data-ctrl="${id}"]`).addEventListener('click', () => requestControl(id));
    const volSlider = li.querySelector(`[data-vol="${id}"]`);
    if (volSlider) {
      volSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        const peer = state.peers.get(id);
        if (peer) {
          if (peer.gainNode) peer.gainNode.gain.value = val;
          else if (peer.audioEl) peer.audioEl.volume = Math.min(val, 1.0);
        }
      });
    }
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
  if (state.focusLocked) return;
  const main = document.querySelector('.main');
  const focusArea = document.getElementById('focus-area');
  const grid = document.getElementById('grid');

  if (focusedCard === card) {
    grid.appendChild(card);
    focusedCard = null;
    main.classList.remove('focus-mode');
    focusArea.classList.add('hidden');
    document.getElementById('focus-lock-btn').classList.add('hidden');
  } else {
    if (focusedCard) grid.appendChild(focusedCard);
    focusArea.appendChild(card);
    focusedCard = card;
    main.classList.add('focus-mode');
    focusArea.classList.remove('hidden');
    document.getElementById('focus-lock-btn').classList.remove('hidden');
  }
}

function makeCardFocusable(card) {
  if (card.dataset.focusable) return;
  card.dataset.focusable = 'true';
  card.addEventListener('click', (e) => {
    if (e.target.closest('.sb-tools, .card-actions, button, select, input, label, .uno-card-ui, .ucc, .uno-player-list, .act-src, #uno-table, .uno-remote-player, #wt-player-container, .wt-tools, #focus-lock-btn, .inactive-overlay')) return;
    if (e.target.tagName === 'CANVAS' && focusedCard === card) return;
    toggleFocus(card);
  });
}

function showInactiveOverlay(cardId, title, onJoin) {
  const card = document.getElementById(cardId);
  if (!card) return;
  
  let overlay = card.querySelector('.inactive-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'inactive-overlay';
    overlay.style.cssText = 'position: absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index: 50; display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius: 12px;';
    
    const btn = document.createElement('button');
    btn.className = 'btn-pri';
    btn.innerHTML = `<span style="font-size:24px; font-weight:bold;">+</span><br/>Katıl: ${title}`;
    btn.style.cssText = 'padding: 10px 20px; border-radius: 12px; display:flex; flex-direction:column; align-items:center; box-shadow: 0 4px 12px rgba(0,0,0,0.5); cursor: pointer; border: none; background: var(--acc); color: white;';
    
    btn.onclick = (e) => {
      e.stopPropagation();
      onJoin();
    };
    
    overlay.appendChild(btn);
    card.appendChild(overlay);
  }
}

function removeInactiveOverlay(cardId) {
  const card = document.getElementById(cardId);
  if (card) {
    const overlay = card.querySelector('.inactive-overlay');
    if (overlay) overlay.remove();
  }
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
  lbl.innerHTML = `<span class="live"></span> ${escapeHtml(peerName)} ${isScreen ? '• Ekran' : ''}`;
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
  
  if (isScreen && peerId !== 'self') {
    if (!state.screenShares) state.screenShares = {};
    if (!state.screenShares[peerId]) state.screenShares[peerId] = { joined: false };
    
    if (!state.screenShares[peerId].joined) {
      videoEl.muted = true;
      showInactiveOverlay(card.id, 'Ekran Paylaşımı', () => {
         state.screenShares[peerId].joined = true;
         removeInactiveOverlay(card.id);
         videoEl.muted = false;
         if (!focusedCard) toggleFocus(card);
      });
    } else {
      if (!focusedCard) toggleFocus(card);
    }
  }
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
  if (mqttClient && mqttClient.connected && state.room) {
    try {
      mqttClient.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({
        type: 'room-broadcast',
        id: state.myId,
        payload: msg
      }));
      return;
    } catch (e) {
      console.warn('MQTT broadcast failed, falling back to WebRTC:', e);
    }
  }

  const msgStr = JSON.stringify(msg);
  state.peers.forEach((peer, id) => {
    if (peer.dc && peer.dc.readyState === 'open') {
      try {
        peer.dc.send(msgStr);
      } catch (e) {
        console.warn('Broadcast send error to', id, e);
      }
    } else {
      console.warn('DC not open for peer:', id, 'state:', peer.dc ? peer.dc.readyState : 'null');
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function bindUI() {
  const mic = document.getElementById('mic');
  const deaf = document.getElementById('deaf');
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
    document.getElementById('ip-modal').classList.remove('hidden');
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
    document.getElementById('leave-modal').classList.remove('hidden');
  });

  document.getElementById('leave-cancel').addEventListener('click', () => {
    document.getElementById('leave-modal').classList.add('hidden');
  });

  document.getElementById('leave-confirm').addEventListener('click', () => {
    document.getElementById('leave-modal').classList.add('hidden');
    disconnectApp();
  });

  document.getElementById('error-ok').addEventListener('click', () => {
    document.getElementById('error-modal').classList.add('hidden');
  });


  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'KeyM') document.getElementById('mic')?.click();
    if (e.code === 'KeyD') document.getElementById('deaf')?.click();
    if (e.code === 'KeyC') document.getElementById('cam')?.click();
    if (e.code === 'KeyS') document.getElementById('share')?.click();
    if (e.code === 'KeyR') document.getElementById('rec')?.click();
  });

  document.getElementById('act-btn').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.remove('hidden');
  });
  document.getElementById('act-close').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
  });
  
  document.getElementById('focus-lock-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    state.focusLocked = !state.focusLocked;
    const btn = document.getElementById('focus-lock-btn');
    btn.textContent = state.focusLocked ? '🔒' : '🔓';
    btn.style.background = state.focusLocked ? 'rgba(220, 38, 38, 0.8)' : 'rgba(0,0,0,0.6)';
    btn.style.borderColor = state.focusLocked ? 'rgba(239, 68, 68, 1)' : 'rgba(255,255,255,0.2)';
    showToast(state.focusLocked ? 'Odak Kilitlendi' : 'Odak Kilidi Açıldı', 'info');
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
    if (sender) {
      const blankTrack = state.localStream ? state.localStream.getVideoTracks()[0] : null;
      sender.replaceTrack(blankTrack || null);
    }
  });
  state.screenStream = null;
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
      a.download = `teamsync-${Date.now()}.webm`;
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
  if (document.activeElement && document.activeElement.tagName === 'WEBVIEW') return;
  if (state.activeControl && !e.repeat) sendCtrlEvent({ type: 'keydown', key: e.key });
});
document.addEventListener('keyup', e => {
  if (document.activeElement && document.activeElement.tagName === 'WEBVIEW') return;
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
  if (mqttClient && mqttClient.connected && state.room) {
    try {
      mqttClient.publish(`teamsync/room/${state.room}/private/${peerId}`, JSON.stringify({
        type: 'room-private',
        id: state.myId,
        target: peerId,
        payload: msg
      }));
      return;
    } catch (e) {
      console.warn('MQTT unicast failed, falling back to WebRTC:', e);
    }
  }

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

function endUnoGame() {
  if (state.uno.host !== state.myId) return;
  state.uno.started = false;

  const rankings = [];
  Array.from(state.uno.players.entries()).forEach(([id, p]) => {
    let count = p.cardCount;
    if (id === state.myId) count = state.uno.myHand.length;
    else if (id.startsWith('bot-')) count = state.uno.botHands[id]?.length || 0;
    rankings.push({ id, name: p.name, count });
  });

  rankings.sort((a, b) => a.count - b.count);
  broadcast({ type: 'uno-game-over', rankings });
  showUnoGameOver(rankings);
}

function showUnoGameOver(rankings) {
  state.uno.started = false;
  document.getElementById('uno-game').classList.add('hidden');
  document.getElementById('uno-game-over').classList.remove('hidden');
  
  const container = document.getElementById('uno-rankings');
  container.innerHTML = '';
  rankings.forEach((r, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '👏';
    container.innerHTML += `
      <div style="background: rgba(0,0,0,0.6); padding: 10px 20px; border-radius: 8px; display: flex; justify-content: space-between; font-size: 18px; border: 1px solid rgba(255,255,255,0.2);">
        <span>${medal} ${escapeHtml(r.name)}</span>
        <span>${r.count} Kart</span>
      </div>
    `;
  });

  if (state.uno.host === state.myId) {
    document.getElementById('uno-replay-btn').classList.remove('hidden');
    document.getElementById('uno-replay-wait').classList.add('hidden');
  } else {
    document.getElementById('uno-replay-btn').classList.add('hidden');
    document.getElementById('uno-replay-wait').classList.remove('hidden');
  }
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

function limitVideoBitrate(sender) {
  try {
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    
    const q = document.getElementById('quality-select').value;
    let maxBitrate = 1500000; // default 1.5 Mbps
    if (q === 'high') maxBitrate = 4000000; // 4 Mbps
    if (q === 'low') maxBitrate = 500000; // 500 kbps
    
    params.encodings[0].maxBitrate = maxBitrate;
    sender.setParameters(params);
  } catch (e) {
    console.warn("Bitrate limit error:", e);
  }
}

function disconnectApp() {
  if (window.electronAPI && window.electronAPI.stopCloudflared) window.electronAPI.stopCloudflared();
  if (state.localStream) state.localStream.getTracks().forEach(t => t.stop());
  const tb = document.querySelector('.top-bar'); if(tb) tb.style.display = 'none';
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
  
  if (mqttClient) {
    mqttClient.end();
    mqttClient = null;
  }
  if (internetAnnounceInterval) {
    clearInterval(internetAnnounceInterval);
    internetAnnounceInterval = null;
  }

  state.room = null;
  state.pendingJoinReq = null;

  document.getElementById('app').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
  
  // Sadece step-action'ı göster
  document.getElementById('step-name').classList.add('hidden');
  document.getElementById('step-join').classList.add('hidden');
  document.getElementById('step-create').classList.add('hidden');
  document.getElementById('step-add-friend').classList.add('hidden');
  document.getElementById('step-action').classList.remove('hidden'); document.querySelector('.login-card').classList.add('expanded');
  
  // Arkadaş listesini güncelle (sunucudan çıktığımızı bildir)
  renderFriends();
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
    state.wbJoined = true;
    wbCard.classList.toggle('hidden');
    makeCardFocusable(document.getElementById('wb-card'));
    if (!wbCard.classList.contains('hidden') && !focusedCard) toggleFocus(wbCard);
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
    
    if (mqttClient && mqttClient.connected && state.room) {
      try {
        mqttClient.publish(`teamsync/room/${state.room}/file`, Buffer.from(msgBuf));
      } catch (e) {
        console.warn('MQTT file send failed:', e);
      }
    } else {
      for (const [_, peer] of state.peers) {
        if (peer.dc && peer.dc.readyState === 'open') {
          while (peer.dc.bufferedAmount > 2 * 1024 * 1024) {
            await new Promise(r => setTimeout(r, 50));
          }
          try { peer.dc.send(msgBuf); } catch(e){}
        }
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
window.onYouTubeIframeAPIReady = function() {
  state.wt.isReady = true;
};

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
    makeCardFocusable(document.getElementById('wt-card'));
    
    if (!state.wt.joinedActivity) {
      showInactiveOverlay('wt-card', 'YouTube', () => {
         state.wt.joinedActivity = true;
         removeInactiveOverlay('wt-card');
         if (!focusedCard) toggleFocus(document.getElementById('wt-card'));
         loadWTVideo(msg.vid);
      });
    } else {
      loadWTVideo(msg.vid);
    }
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
    const wtCard = document.getElementById('wt-card');
    
    if (!wtCard.classList.contains('hidden') && !state.wt.joinedActivity) {
      const btn = wtCard.querySelector('.inactive-overlay button');
      if (btn) btn.click();
      else if (!focusedCard) toggleFocus(wtCard);
      return;
    }
    
    state.wt.joinedActivity = true;
    wtCard.classList.remove('hidden');
    makeCardFocusable(wtCard);
    if (!focusedCard) toggleFocus(wtCard);
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
    const sbCard = document.getElementById('sb-card');
    
    if (state.sb.host && state.sb.host !== state.myId) {
      const btn = sbCard.querySelector('.inactive-overlay button');
      if (btn) btn.click();
      else if (!focusedCard) toggleFocus(sbCard);
      return;
    }

    state.sb.joinedActivity = true;
    sbCard.classList.remove('hidden');
    makeCardFocusable(sbCard);
    if (!focusedCard) toggleFocus(sbCard);
    
    const confirmModal = document.getElementById('custom-confirm');
    confirmModal.classList.remove('hidden');
    confirmModal.style.display = 'flex';
    
    const finishSbSetup = (interactive) => {
      confirmModal.classList.add('hidden');
      confirmModal.style.display = 'none';
      state.sb.interactive = interactive;
      state.sb.host = state.myId;
      document.getElementById('sb-overlay').style.display = 'none';
      document.getElementById('sb-url').disabled = false;
      broadcast({ type: 'sb-start', host: state.myId, interactive: state.sb.interactive });
    };

    document.getElementById('btn-confirm-yes').onclick = () => finishSbSetup(true);
    document.getElementById('btn-confirm-no').onclick = () => finishSbSetup(false);
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

  // Webview'e tıklandığında focus'u ver
  sbWebview.addEventListener('focus', () => {
    sbWebview.focus();
  });
  
  // Webview DOM hazır olduğunda keyboard input'u aktif et
  sbWebview.addEventListener('dom-ready', () => {
    sbWebview.focus();
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
    const unoCard = document.getElementById('uno-card');
    
    if (state.uno.host && state.uno.host !== state.myId) {
      const btn = unoCard.querySelector('.inactive-overlay button');
      if (btn) btn.click();
      else if (!focusedCard) toggleFocus(unoCard);
      return;
    }

    unoCard.classList.remove('hidden');
    makeCardFocusable(unoCard);
    if (!focusedCard) toggleFocus(unoCard);
    
    state.uno.host = state.myId;
    state.uno.joinedActivity = true;
    state.uno.players.set(state.myId, { name: state.myName, ready: true, cardCount: 0 });
    document.getElementById('uno-host-settings').style.display = 'block';
    document.getElementById('uno-ready-btn').classList.add('hidden');
    document.getElementById('uno-start-btn').classList.remove('hidden');
    document.getElementById('uno-max-players').disabled = false;
    document.getElementById('uno-fill-bots').disabled = false;
    
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

  document.getElementById('uno-fill-bots').addEventListener('change', (e) => {
    broadcast({ type: 'uno-fill', fill: e.target.checked });
  });

  document.getElementById('uno-uno-btn').addEventListener('click', () => {
    state.uno.saidUno = true;
    document.getElementById('uno-uno-btn').classList.add('hidden');
    broadcast({ type: 'uno-said' });
    showFloatingEmoji(state.myId, "UNO!");
  });

  document.getElementById('uno-catch-btn').addEventListener('click', () => {
    if (state.uno.catchTarget) {
      const targetId = state.uno.catchTarget;
      broadcast({ type: 'uno-catch', targetId: targetId });
      document.getElementById('uno-catch-btn').classList.add('hidden');
      
      if (state.uno.host === state.myId) {
        state.uno.catchTarget = null;
        broadcast({ type: 'uno-catch-success', targetId: targetId, catcherId: state.myId });
        showToast(state.uno.players.get(targetId)?.name + " YAKALANDI!", "warn");
        setTimeout(() => forceDrawCards(targetId, 2), 500);
      }
    }
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

  document.getElementById('uno-emojis').addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    const emoji = e.target.textContent;
    showFloatingEmoji(state.myId, emoji);
    broadcast({ type: 'uno-emoji', emoji });
  });

  document.getElementById('uno-replay-btn').addEventListener('click', () => {
    broadcast({ type: 'uno-lobby', host: state.myId });
    document.getElementById('uno-game-over').classList.add('hidden');
    document.getElementById('uno-lobby').classList.remove('hidden');
    state.uno.started = false;
  });
}

function handleUnoMessage(peerId, msg) {
  if (msg.type === 'uno-lobby') {
    if (!state.uno.host || state.uno.host === peerId) {
      state.uno.host = peerId;
      document.getElementById('uno-card').classList.remove('hidden');
      document.getElementById('uno-lobby').classList.remove('hidden');
      document.getElementById('uno-game').classList.add('hidden');
      document.getElementById('uno-game-over').classList.add('hidden');
      makeCardFocusable(document.getElementById('uno-card'));
      
      if (!state.uno.joinedActivity) {
         showInactiveOverlay('uno-card', 'UNO', () => {
             state.uno.joinedActivity = true;
             removeInactiveOverlay('uno-card');
             if (!focusedCard) toggleFocus(document.getElementById('uno-card'));
             
             if (!state.uno.players.has(state.myId)) {
               state.uno.players.set(state.myId, { name: state.myName, ready: false, cardCount: 0 });
               document.getElementById('uno-host-settings').style.display = 'block';
               document.getElementById('uno-max-players').disabled = true;
               document.getElementById('uno-fill-bots').disabled = true;
               document.getElementById('uno-ready-btn').classList.remove('hidden');
               document.getElementById('uno-start-btn').classList.add('hidden');
               document.getElementById('uno-ready-btn').textContent = 'Hazır Değilim';
               document.getElementById('uno-ready-btn').style.background = 'var(--warn)';
             }
             broadcast({ type: 'uno-join', name: state.myName, ready: state.uno.players.get(state.myId)?.ready || false });
         });
      } else {
        if (!state.uno.players.has(state.myId)) {
          state.uno.players.set(state.myId, { name: state.myName, ready: false, cardCount: 0 });
          document.getElementById('uno-host-settings').style.display = 'block';
          document.getElementById('uno-max-players').disabled = true;
          document.getElementById('uno-fill-bots').disabled = true;
          document.getElementById('uno-ready-btn').classList.remove('hidden');
          document.getElementById('uno-start-btn').classList.add('hidden');
          document.getElementById('uno-ready-btn').textContent = 'Hazır Değilim';
          document.getElementById('uno-ready-btn').style.background = 'var(--warn)';
        }
        broadcast({ type: 'uno-join', name: state.myName, ready: state.uno.players.get(state.myId)?.ready || false });
      }
    }
  } else if (msg.type === 'uno-join') {
    state.uno.players.set(peerId, { name: msg.name, ready: msg.ready, cardCount: 0 });
    if (state.uno.host === state.myId) {
      broadcast({ type: 'uno-lobby-sync', players: Array.from(state.uno.players.entries()) });
    }
    renderUnoLobby();
  } else if (msg.type === 'uno-ready') {
    const p = state.uno.players.get(peerId);
    if (p) {
      p.ready = msg.ready;
      if (state.uno.host === state.myId) {
        broadcast({ type: 'uno-lobby-sync', players: Array.from(state.uno.players.entries()) });
      }
      renderUnoLobby();
    }
  } else if (msg.type === 'uno-lobby-sync') {
    state.uno.players = new Map(msg.players);
    renderUnoLobby();
  } else if (msg.type === 'uno-sync') {
    state.uno.host = msg.host;
    state.uno.started = true;
    state.uno.players = new Map(msg.players);
    state.uno.turnOrder = msg.turnOrder;
    state.uno.turnIndex = msg.turnIndex;
    state.uno.direction = msg.direction;
    if (msg.myHand) state.uno.myHand = msg.myHand;
    state.uno.discard = msg.discard;
    state.uno.currentColor = msg.currentColor;
    msg.handsCount.forEach(h => {
      if (state.uno.players.has(h.id)) state.uno.players.get(h.id).cardCount = h.count;
    });
    
    document.getElementById('uno-card').classList.remove('hidden');
    document.getElementById('uno-lobby').classList.add('hidden');
    document.getElementById('uno-game').classList.remove('hidden');
    document.getElementById('uno-game-over').classList.add('hidden');
    makeCardFocusable(document.getElementById('uno-card'));
    if (!focusedCard) toggleFocus(document.getElementById('uno-card'));
    
    renderUnoGame();
  } else if (msg.type === 'uno-req-draw') {
    if (state.uno.host === state.myId) {
      if (state.uno.waitingForKeepOrPlay) return;
      const currentTurnId = state.uno.turnOrder[state.uno.turnIndex];
      if (currentTurnId !== peerId) return;
      
      if (state.uno.deck.length === 0) {
        const top = state.uno.discard.pop();
        state.uno.deck = state.uno.discard.sort(() => Math.random() - 0.5);
        state.uno.discard = [top];
      }
      const c = state.uno.deck.pop();
      const p = state.peers.get(peerId);
      if (p && p.dc && p.dc.readyState === 'open') {
        p.dc.send(JSON.stringify({ type: 'uno-draw-result', card: c, forced: false }));
      }
      if (state.uno.players.has(peerId)) state.uno.players.get(peerId).cardCount++;
      
      const topCard = state.uno.discard[state.uno.discard.length - 1];
      if (!canPlay(c, topCard)) {
        state.uno.turnIndex = getNextTurn();
      } else {
        state.uno.waitingForKeepOrPlay = peerId;
      }
      
      animateCardDraw(peerId);
      broadcast({ type: 'uno-draw-anim', pid: peerId });
      
      const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
      broadcast({
        type: 'uno-sync',
        host: state.uno.host,
        players: Array.from(state.uno.players.entries()),
        turnOrder: state.uno.turnOrder,
        turnIndex: state.uno.turnIndex,
        direction: state.uno.direction,
        discard: state.uno.discard,
        currentColor: state.uno.currentColor,
        handsCount
      });
      renderUnoGame();
    }
  } else if (msg.type === 'uno-draw-result') {
    msg.card._new = true;
    state.uno.myHand.push(msg.card);
    renderUnoGame();
    if (!msg.forced) {
      const topCard = state.uno.discard[state.uno.discard.length - 1];
      if (canPlay(msg.card, topCard)) {
        showDrawModal(msg.card, state.uno.myHand.length - 1);
      }
    }
  } else if (msg.type === 'uno-keep') {
    if (state.uno.host === state.myId) {
      state.uno.waitingForKeepOrPlay = null;
      state.uno.turnIndex = getNextTurn();
      if (state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
      const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
      broadcast({ type: 'uno-sync', host: state.uno.host, players: Array.from(state.uno.players.entries()), turnOrder: state.uno.turnOrder, turnIndex: state.uno.turnIndex, direction: state.uno.direction, discard: state.uno.discard, currentColor: state.uno.currentColor, handsCount });
      renderUnoGame();
    }
  } else if (msg.type === 'uno-draw-anim') {
    animateCardDraw(msg.pid);
  } else if (msg.type === 'uno-leave') {
    if (state.uno.host === peerId) {
      alert("Kurucu odadan çıktı. UNO iptal edildi.");
      document.getElementById('uno-close').click();
    } else {
      state.uno.players.delete(peerId);
      renderUnoLobby();
    }
  } else if (msg.type === 'uno-kicked') {
    if (msg.targetId === state.myId) {
       alert("Kurucu tarafından UNO'dan atıldınız!");
       document.getElementById('uno-close').click();
       state.uno.joinedActivity = false;
    } else {
       state.uno.players.delete(msg.targetId);
       renderUnoLobby();
    }
  } else if (msg.type === 'uno-max') {
    state.uno.maxPlayers = msg.max;
    if (state.uno.host !== state.myId) document.getElementById('uno-max-players').value = msg.max;
  } else if (msg.type === 'uno-fill') {
    if (state.uno.host !== state.myId) document.getElementById('uno-fill-bots').checked = msg.fill;
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
    document.getElementById('uno-game-over').classList.add('hidden');
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
    if (state.uno.host === state.myId) {
      state.uno.waitingForKeepOrPlay = null;
      if (state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
    }
    state.uno.triggerDiscardAnim = true;

    if (p && p.cardCount === 1 && !msg.saidUno) {
      if (pId === state.myId) {
        document.getElementById('uno-uno-btn').classList.remove('hidden');
      } else {
        if (state.uno.catchTimeout) clearTimeout(state.uno.catchTimeout);
        state.uno.catchTimeout = setTimeout(() => {
          state.uno.catchTarget = pId;
          document.getElementById('uno-catch-btn').classList.remove('hidden');
        }, 500);
      }
    }

    setTimeout(() => renderUnoGame(), 300);

    if (state.uno.host === state.myId) {
      if (p && p.cardCount === 0) {
        setTimeout(() => endUnoGame(), 800);
        return;
      }
      if (msg.drawCount > 0) {
        setTimeout(() => {
          const victimIndex = getNextTurn(1, msg.oldTurnIndex, msg.direction);
          const victimId = state.uno.turnOrder[victimIndex];
          forceDrawCards(victimId, msg.drawCount);
        }, 500);
      }
    }

  } else if (msg.type === 'uno-draw') {
    const pId = msg.botId || peerId;
    const p = state.uno.players.get(pId);
    if (p) p.cardCount += msg.count;
    state.uno.turnIndex = msg.nextTurnIndex;
    if (state.uno.host === state.myId && state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
    renderUnoGame();
  } else if (msg.type === 'uno-emoji') {
    showFloatingEmoji(peerId, msg.emoji);
  } else if (msg.type === 'uno-said') {
    if (state.uno.catchTarget === peerId) {
      clearTimeout(state.uno.catchTimeout);
      document.getElementById('uno-catch-btn').classList.add('hidden');
      state.uno.catchTarget = null;
    }
    showFloatingEmoji(peerId, "UNO!");
    showToast(state.uno.players.get(peerId)?.name + " UNO dedi!", "ok");
  } else if (msg.type === 'uno-catch') {
    if (state.uno.host === state.myId && state.uno.catchTarget === msg.targetId) {
      state.uno.catchTarget = null;
      broadcast({ type: 'uno-catch-success', targetId: msg.targetId, catcherId: peerId });
      showToast(state.uno.players.get(msg.targetId)?.name + " YAKALANDI!", "warn");
      setTimeout(() => forceDrawCards(msg.targetId, 2), 500);
    }
  } else if (msg.type === 'uno-catch-success') {
    state.uno.catchTarget = null;
    clearTimeout(state.uno.catchTimeout);
    document.getElementById('uno-catch-btn').classList.add('hidden');
    showToast(state.uno.players.get(msg.targetId)?.name + " UNO demeyi unuttuğu için YAKALANDI!", "warn");
  } else if (msg.type === 'uno-game-over') {
    showUnoGameOver(msg.rankings);
  }
}

function forceDrawCards(victimId, count) {
  if (state.uno.host !== state.myId) return;
  for (let i = 0; i < count; i++) {
    if (state.uno.deck.length === 0) {
      const top = state.uno.discard.pop();
      state.uno.deck = state.uno.discard.sort(() => Math.random() - 0.5);
      state.uno.discard = [top];
    }
    const c = state.uno.deck.pop();
    const p = state.uno.players.get(victimId);
    if (!p) continue;
    p.cardCount++;
    
    if (victimId === state.myId) {
      state.uno.myHand.push({ ...c, _new: true });
    } else if (victimId.startsWith('bot-')) {
      state.uno.botHands[victimId].push(c);
    } else {
      const peer = state.peers.get(victimId);
      if (peer && peer.dc && peer.dc.readyState === 'open') {
        peer.dc.send(JSON.stringify({ type: 'uno-draw-result', card: c, forced: true }));
      }
    }
    
    animateCardDraw(victimId);
    broadcast({ type: 'uno-draw-anim', pid: victimId });
  }

  const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
  broadcast({
    type: 'uno-sync',
    host: state.uno.host,
    players: Array.from(state.uno.players.entries()),
    turnOrder: state.uno.turnOrder,
    turnIndex: state.uno.turnIndex,
    direction: state.uno.direction,
    discard: state.uno.discard,
    currentColor: state.uno.currentColor,
    handsCount
  });
  renderUnoGame();
}

function renderUnoLobby() {
  const wrap = document.getElementById('uno-players');
  wrap.innerHTML = '';
  for (const [id, p] of state.uno.players) {
    const div = document.createElement('div');
    div.className = 'uno-p-item' + (p.ready ? ' ready' : '');
    
    let kickBtn = '';
    if (state.uno.host === state.myId && id !== state.myId && !id.startsWith('bot-')) {
      kickBtn = `<button class="btn-sec btn-sm" style="margin-left: 10px; padding: 2px 6px; font-size: 10px; background: rgba(255,0,0,0.5); color: white; border: none;" onclick="kickUnoPlayer('${id}', event)">X</button>`;
    }
    
    div.innerHTML = `<div class="st ${p.ready ? '' : 'muted'}"></div> <span>${escapeHtml(p.name)}</span> ${id === state.uno.host ? '👑' : ''} ${kickBtn}`;
    wrap.appendChild(div);
  }
}

window.kickUnoPlayer = (id, e) => {
  e.stopPropagation();
  if (confirm("Bu oyuncuyu atmak istediğinize emin misiniz?")) {
    broadcast({ type: 'uno-kicked', targetId: id });
    state.uno.players.delete(id);
    renderUnoLobby();
  }
};

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
  
  console.log("startUnoGame: myId=", state.myId, "turnOrder=", turnOrder, "hands length for me=", hands[state.myId]?.length);

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
  try {
    doRenderUnoGame();
  } catch (err) {
    console.error("UNO Render Error:", err);
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
  
  console.log("DEBUG: body contains uno-discard?", document.body.innerHTML.includes('uno-discard'));
  console.log("DEBUG: getElementById('uno-center')", document.getElementById('uno-center'));
  console.log("DEBUG: getElementById('uno-discard')", document.getElementById('uno-discard'));
  
  let discardDiv = document.getElementById('uno-discard');
  if (!discardDiv) {
    console.error("FATAL: uno-discard is MISSING from the DOM! Recreating it...");
    discardDiv = document.createElement('div');
    discardDiv.id = 'uno-discard';
    discardDiv.className = 'uno-card-ui empty';
    const center = document.getElementById('uno-center');
    if (center) center.appendChild(discardDiv);
    else return;
  }
  
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

  console.log("doRenderUnoGame: myHand size=", state.uno.myHand?.length);

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
    if (!state.uno.started) return;
    if (currentTurnId === state.myId) {
      if (state.uno.waitingForKeepOrPlay) return;
      const deckDiv = document.getElementById('uno-deck');
      deckDiv.style.transform = 'scale(0.9)';
      setTimeout(() => { deckDiv.style.transform = 'scale(1)'; }, 150);

      if (state.uno.host === state.myId) {
        if (state.uno.deck.length === 0) {
          const top = state.uno.discard.pop();
          state.uno.deck = state.uno.discard.sort(() => Math.random() - 0.5);
          state.uno.discard = [top];
        }
        const newCard = state.uno.deck.pop();
        state.uno.myHand.push({ ...newCard, _new: true });
        const p = state.uno.players.get(state.myId);
        if(p) p.cardCount++;
        
        const topCard = state.uno.discard[state.uno.discard.length - 1];
        let canPlayDrawn = canPlay(newCard, topCard);
        if (!canPlayDrawn) {
          state.uno.turnIndex = getNextTurn();
        } else {
          state.uno.waitingForKeepOrPlay = state.myId;
        }
        
        animateCardDraw(state.myId);
        broadcast({ type: 'uno-draw-anim', pid: state.myId });
        
        const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
        broadcast({
          type: 'uno-sync',
          host: state.uno.host,
          players: Array.from(state.uno.players.entries()),
          turnOrder: state.uno.turnOrder,
          turnIndex: state.uno.turnIndex,
          direction: state.uno.direction,
          discard: state.uno.discard,
          currentColor: state.uno.currentColor,
          handsCount
        });
        renderUnoGame();
        
        if (canPlayDrawn) {
          showDrawModal(newCard, state.uno.myHand.length - 1);
        }
      } else {
        broadcast({ type: 'uno-req-draw' });
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

function getNextTurn(skip = 1, currentIdx = state.uno.turnIndex, currentDir = state.uno.direction) {
  let len = state.uno.turnOrder.length;
  let next = (currentIdx + currentDir * skip) % len;
  if (next < 0) next += len;
  return next;
}

function animateCardDraw(pid) {
  const table = document.getElementById('uno-table');
  const deck = document.getElementById('uno-deck');
  if (!table || !deck) return;
  
  const deckRect = deck.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  
  const startX = deckRect.left - tableRect.left + (deckRect.width / 2);
  const startY = deckRect.top - tableRect.top + (deckRect.height / 2);
  
  let endX = startX;
  let endY = startY + 150; 
  
  if (pid === state.myId) {
    const hand = document.getElementById('uno-my-hand');
    if (hand) {
      const handRect = hand.getBoundingClientRect();
      endX = handRect.left - tableRect.left + (handRect.width / 2);
      endY = handRect.top - tableRect.top + (handRect.height / 2);
    }
  } else {
    const rp = Array.from(document.querySelectorAll('.uno-remote-player')).find(el => el.dataset.pid === pid);
    if (rp) {
      const rpRect = rp.getBoundingClientRect();
      endX = rpRect.left - tableRect.left + (rpRect.width / 2);
      endY = rpRect.top - tableRect.top + (rpRect.height / 2);
    }
  }
  
  const animCard = document.createElement('div');
  animCard.className = 'uno-card-ui back';
  animCard.textContent = 'UNO';
  animCard.style.position = 'absolute';
  animCard.style.left = `${startX}px`;
  animCard.style.top = `${startY}px`;
  animCard.style.transform = `translate(-50%, -50%) scale(0.8)`;
  animCard.style.transition = 'all 0.3s ease-out';
  animCard.style.zIndex = 150;
  
  table.appendChild(animCard);
  playSound('draw');
  
  animCard.getBoundingClientRect();
  
  animCard.style.left = `${endX}px`;
  animCard.style.top = `${endY}px`;
  animCard.style.transform = `translate(-50%, -50%) scale(0.3) rotate(180deg)`;
  animCard.style.opacity = '0';
  
  setTimeout(() => animCard.remove(), 350);
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
    
    let skip = 1;
    if (card.val === 'Rev') {
      state.uno.direction *= -1;
      if (state.uno.turnOrder.length === 2) skip = 2;
    }
    let drawCount = 0;
    if (card.val === 'Skip') skip = 2;
    if (card.val === '+2') { skip = 2; drawCount = 2; }
    if (card.val === '+4') { skip = 2; drawCount = 4; }
    
    const oldTurnIndex = state.uno.turnIndex;
    state.uno.turnIndex = getNextTurn(skip);
    
    state.uno.triggerDiscardAnim = true;
    
    let saidUno = false;
    if (state.uno.saidUno) {
      saidUno = true;
      state.uno.saidUno = false;
      document.getElementById('uno-uno-btn').classList.add('hidden');
    }
    
    if (state.uno.myHand.length === 1 && !saidUno) {
      document.getElementById('uno-uno-btn').classList.remove('hidden');
    } else {
      document.getElementById('uno-uno-btn').classList.add('hidden');
    }
    
    broadcast({ type: 'uno-play', card, color: chosenColor, direction: state.uno.direction, nextTurnIndex: state.uno.turnIndex, oldTurnIndex, drawCount, saidUno });
    renderUnoGame();
    
    if (state.uno.host === state.myId && drawCount > 0) {
      setTimeout(() => {
        const victimIndex = getNextTurn(1, oldTurnIndex, state.uno.direction);
        const victimId = state.uno.turnOrder[victimIndex];
        forceDrawCards(victimId, drawCount);
      }, 500);
    }
    
    if (state.uno.myHand.length === 0) {
      if (state.uno.host === state.myId) {
        setTimeout(() => endUnoGame(), 800);
      }
      return;
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
    
    let skip = 1;
    if (card.val === 'Rev') {
      state.uno.direction *= -1;
      if (state.uno.turnOrder.length === 2) skip = 2;
    }
    let drawCount = 0;
    if (card.val === 'Skip') skip = 2;
    if (card.val === '+2') { skip = 2; drawCount = 2; }
    if (card.val === '+4') { skip = 2; drawCount = 4; }
    
    const oldTurnIndex = state.uno.turnIndex;
    state.uno.turnIndex = getNextTurn(skip);
    
    let saidUno = false;
    if (botHand.length === 1) saidUno = Math.random() > 0.3; // Bot %70 ihtimalle UNO der
    if (saidUno) {
      broadcast({ type: 'uno-said' });
      showFloatingEmoji(botId, "UNO!");
    }
    
    broadcast({ type: 'uno-play', card, color: chosenColor, direction: state.uno.direction, nextTurnIndex: state.uno.turnIndex, botId, oldTurnIndex, drawCount, saidUno });
    playPopSound();
    animateRemotePlay(botId, card);
    state.uno.triggerDiscardAnim = true;
    setTimeout(() => renderUnoGame(), 300);
    
    if (drawCount > 0) {
      setTimeout(() => {
        const victimIndex = getNextTurn(1, oldTurnIndex, state.uno.direction);
        const victimId = state.uno.turnOrder[victimIndex];
        forceDrawCards(victimId, drawCount);
      }, 500);
    }
    
    if (botHand.length === 0) {
      setTimeout(() => endUnoGame(), 800);
      return;
    }
  } else {
    if (state.uno.deck.length > 0) {
      const newCard = state.uno.deck.pop();
      botHand.push(newCard);
      const p = state.uno.players.get(botId);
      if(p) p.cardCount++;
      
      const topCard = state.uno.discard[state.uno.discard.length - 1];
      const botCanPlay = canPlay(newCard, topCard);
      if (!botCanPlay) {
        state.uno.turnIndex = getNextTurn();
      }
      
      animateCardDraw(botId);
      broadcast({ type: 'uno-draw-anim', pid: botId });
      
      const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
      broadcast({
        type: 'uno-sync',
        host: state.uno.host,
        players: Array.from(state.uno.players.entries()),
        turnOrder: state.uno.turnOrder,
        turnIndex: state.uno.turnIndex,
        direction: state.uno.direction,
        discard: state.uno.discard,
        currentColor: state.uno.currentColor,
        handsCount
      });
      renderUnoGame();
      
      if (botCanPlay) {
        setTimeout(() => botPlay(botId), 1000);
      }
    } else {
      state.uno.turnIndex = getNextTurn();
      broadcast({ type: 'uno-draw', count: 0, nextTurnIndex: state.uno.turnIndex, botId }); 
      renderUnoGame();
    }
  }
}

function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    if (type === 'uno') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'draw') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    }
    
    osc.connect(gain);
    gain.connect(ctx.destination);
  } catch (e) {}
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

function showDrawModal(card, index) {
  const modal = document.getElementById('uno-draw-modal');
  const container = document.getElementById('uno-drawn-card-container');
  container.innerHTML = '';
  
  const cDiv = document.createElement('div');
  cDiv.className = `uno-card-ui ${card.color}`;
  cDiv.innerHTML = `<span class="mini tl">${card.val}</span> ${card.val} <span class="mini br">${card.val}</span>`;
  cDiv.style.transform = 'scale(1.5)';
  cDiv.style.margin = '20px';
  container.appendChild(cDiv);
  
  modal.classList.remove('hidden');
  
  document.getElementById('uno-keep-btn').onclick = () => {
    modal.classList.add('hidden');
    if (state.uno.host === state.myId) {
      state.uno.turnIndex = getNextTurn();
      if (state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
      const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
      broadcast({ type: 'uno-sync', host: state.uno.host, players: Array.from(state.uno.players.entries()), turnOrder: state.uno.turnOrder, turnIndex: state.uno.turnIndex, direction: state.uno.direction, discard: state.uno.discard, currentColor: state.uno.currentColor, handsCount });
      renderUnoGame();
    } else {
      broadcast({ type: 'uno-keep' });
    }
  };
  
  document.getElementById('uno-play-drawn-btn').onclick = () => {
    modal.classList.add('hidden');
    if (card.color === 'black') {
      document.getElementById('uno-color-picker').classList.remove('hidden');
      document.querySelectorAll('.ucc').forEach(btn => {
        btn.onclick = () => {
          const selectedColor = btn.dataset.color;
          document.getElementById('uno-color-picker').classList.add('hidden');
          playCard(index, selectedColor);
        };
      });
    } else {
      playCard(index);
    }
  };
}

// --- DIRECT MESSAGING LOGIC ---

window.openDM = (friendId) => {
  if (!state.friends[friendId]) return;
  state.activeDM = friendId;
  
  // Show DM panel in main menu
  document.getElementById('step-action').classList.add('dm-open'); document.querySelector('.login-card').classList.add('dm-open');
  
  // Also update server DM modal active name
  document.getElementById('dm-active-name').textContent = state.friends[friendId].name;
  document.getElementById('server-dm-active-name').textContent = state.friends[friendId].name;
  
  // Show input area in server modal
  const serverInputArea = document.getElementById('server-dm-input-area');
  if (serverInputArea) serverInputArea.style.display = 'flex';
  
  if (!state.dms[friendId]) state.dms[friendId] = [];
  
  renderDMs();
};

window.closeDM = () => {
  state.activeDM = null;
  document.getElementById('step-action').classList.remove('dm-open'); document.querySelector('.login-card').classList.remove('dm-open');
  
  document.getElementById('server-dm-active-name').textContent = 'Arkadaş Seçin';
  const serverInputArea = document.getElementById('server-dm-input-area');
  if (serverInputArea) serverInputArea.style.display = 'none';
  
  document.getElementById('dm-messages').innerHTML = '<div class="muted" style="text-align:center; margin-top:50px;">Mesajlaşmaya başlamak için bir arkadaş seç.</div>';
  document.getElementById('server-dm-messages').innerHTML = '<div class="muted" style="text-align:center; margin-top:50px;">Mesajlaşmaya başlamak için bir arkadaş seç.</div>';
};

window.renderDMs = () => {
  if (!state.activeDM) return;
  const friendId = state.activeDM;
  const messages = state.dms[friendId] || [];
  
  const html = messages.map(m => {
    const cls = m.sender === 'me' ? 'sent' : 'recv';
    let contentHtml = escapeHtml(m.content);
    
    if (m.type === 'image') {
      contentHtml = `<img src="${m.content}" />`;
    } else if (m.type === 'file') {
      contentHtml = `<a href="${m.content}" download="${m.fileName || 'dosya'}" style="color: #60a5fa; text-decoration: underline;">📁 ${escapeHtml(m.fileName || 'Dosya')} İndir</a>`;
    }
    
    return `<div class="dm-msg ${cls}">${contentHtml}</div>`;
  }).join('');
  
  const container = document.getElementById('dm-messages');
  if (container) {
    container.innerHTML = html || '<div class="muted" style="text-align:center; margin-top:50px;">Henüz mesaj yok.</div>';
    container.scrollTop = container.scrollHeight;
  }
  
  const serverContainer = document.getElementById('server-dm-messages');
  if (serverContainer) {
    serverContainer.innerHTML = html || '<div class="muted" style="text-align:center; margin-top:50px;">Henüz mesaj yok.</div>';
    serverContainer.scrollTop = serverContainer.scrollHeight;
  }
};

window.renderServerDMFriends = () => {
  const list = document.getElementById('server-dm-friend-list');
  if (!list) return;
  list.innerHTML = '';
  const onlineFriends = Object.keys(state.friends).filter(fId => state.friends[fId].online);
  
  if (onlineFriends.length === 0) {
    list.innerHTML = '<li class="muted" style="text-align: center; padding: 16px;">Şu an çevrimiçi arkadaşın yok.</li>';
    return;
  }
  
  onlineFriends.forEach(fId => {
    const f = state.friends[fId];
    const isActive = state.activeDM === fId;
    const li = document.createElement('li');
    li.style.cssText = `padding: 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s; color: #fff; background: ${isActive ? 'rgba(255,255,255,0.1)' : 'transparent'}; display: flex; align-items: center; gap: 8px;`;
    li.innerHTML = `<div class="friend-status online"></div> <b>${escapeHtml(f.name)}</b>`;
    li.onmouseover = () => { if (!isActive) li.style.background = 'rgba(255,255,255,0.05)'; };
    li.onmouseout = () => { if (!isActive) li.style.background = 'transparent'; };
    li.onclick = () => { openDM(fId); renderServerDMFriends(); };
    list.appendChild(li);
  });
};

window.sendDMText = (text) => {
  if (!state.activeDM || !text.trim() || !state.globalMqtt || !state.globalMqtt.connected) return;
  const friendId = state.activeDM;
  
  // Local store
  if (!state.dms[friendId]) state.dms[friendId] = [];
  state.dms[friendId].push({ sender: 'me', type: 'text', content: text, timestamp: Date.now() });
  saveDMs();
  renderDMs();
  
  // MQTT send
  state.globalMqtt.publish(`teamsync/user/${friendId}/events`, JSON.stringify({
    type: 'dm_msg',
    fromId: state.friendId,
    msgType: 'text',
    content: text
  }));
};

window.sendDMFile = (file) => {
  if (!state.activeDM || !state.globalMqtt || !state.globalMqtt.connected) return;
  const friendId = state.activeDM;
  
  if (file.size > 2 * 1024 * 1024) {
    alert("DM üzerinden en fazla 2MB boyutunda dosya gönderebilirsiniz. Lütfen daha küçük bir dosya seçin.");
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64Data = e.target.result;
    const isImage = file.type.startsWith('image/');
    const msgType = isImage ? 'image' : 'file';
    
    // Local store
    if (!state.dms[friendId]) state.dms[friendId] = [];
    state.dms[friendId].push({ sender: 'me', type: msgType, content: base64Data, fileName: file.name, timestamp: Date.now() });
    saveDMs();
    renderDMs();
    
    const CHUNK_SIZE = 60000; // ~60KB
    const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);
    const fileId = crypto.randomUUID();
    
    state.globalMqtt.publish(`teamsync/user/${friendId}/events`, JSON.stringify({
      type: 'dm_file_start',
      fromId: state.friendId,
      fileId: fileId,
      msgType: msgType,
      fileName: file.name,
      totalChunks: totalChunks
    }));
    
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64Data.substr(i * CHUNK_SIZE, CHUNK_SIZE);
      state.globalMqtt.publish(`teamsync/user/${friendId}/events`, JSON.stringify({
        type: 'dm_file_chunk',
        fromId: state.friendId,
        fileId: fileId,
        chunkIndex: i,
        data: chunk
      }));
    }
  };
  reader.readAsDataURL(file);
};

state.incomingDMFiles = {};

window.receiveDM = (fromId, data) => {
  if (!state.dms[fromId]) state.dms[fromId] = [];
  
  if (data.type === 'dm_msg') {
    state.dms[fromId].push({ sender: 'them', type: data.msgType, content: data.content, timestamp: Date.now() });
    saveDMs();
    if (state.activeDM === fromId) renderDMs();
    else showToast(`${state.friends[fromId]?.name || 'Biri'} sana mesaj gönderdi.`, 'info');
  } 
  else if (data.type === 'dm_file_start') {
    state.incomingDMFiles[data.fileId] = {
      fromId: data.fromId,
      msgType: data.msgType,
      fileName: data.fileName,
      totalChunks: data.totalChunks,
      chunks: []
    };
  }
  else if (data.type === 'dm_file_chunk') {
    const fileData = state.incomingDMFiles[data.fileId];
    if (fileData) {
      fileData.chunks[data.chunkIndex] = data.data;
      if (fileData.chunks.filter(c => c).length === fileData.totalChunks) {
        const fullBase64 = fileData.chunks.join('');
        state.dms[fromId].push({ sender: 'them', type: fileData.msgType, content: fullBase64, fileName: fileData.fileName, timestamp: Date.now() });
        saveDMs();
        delete state.incomingDMFiles[data.fileId];
        
        if (state.activeDM === fromId) renderDMs();
        else showToast(`${state.friends[fromId]?.name || 'Biri'} sana bir dosya gönderdi.`, 'info');
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  loadDMs(); // Load saved DM history
  
  const addEvt = (id, evt, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, handler);
  };
  
  addEvt('dm-close-btn', 'click', closeDM);
  addEvt('server-dm-close', 'click', () => {
    document.getElementById('server-dm-modal').classList.add('hidden');
    closeDM();
  });
  
  addEvt('dm-btn-send', 'click', () => {
    const inp = document.getElementById('dm-input');
    sendDMText(inp.value);
    inp.value = '';
  });
  addEvt('dm-input', 'keypress', (e) => {
    if (e.key === 'Enter') {
      sendDMText(e.target.value);
      e.target.value = '';
    }
  });

  addEvt('server-dm-btn-send', 'click', () => {
    const inp = document.getElementById('server-dm-input');
    sendDMText(inp.value);
    inp.value = '';
  });
  addEvt('server-dm-input', 'keypress', (e) => {
    if (e.key === 'Enter') {
      sendDMText(e.target.value);
      e.target.value = '';
    }
  });

  addEvt('dm-btn-file', 'click', () => document.getElementById('dm-file-input').click());
  addEvt('dm-file-input', 'change', (e) => {
    if (e.target.files.length) sendDMFile(e.target.files[0]);
  });

  addEvt('server-dm-btn-file', 'click', () => document.getElementById('server-dm-file-input').click());
  addEvt('server-dm-file-input', 'change', (e) => {
    if (e.target.files.length) sendDMFile(e.target.files[0]);
  });

  addEvt('btn-edit-avatar', 'click', () => {
    document.getElementById('my-avatar-input').click();
  });
  
  addEvt('my-avatar-input', 'change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 128;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        state.myAvatar = dataUrl;
        state.myAvatarHash = getAvatarHash(dataUrl);
        document.getElementById('my-avatar-img').src = dataUrl;
        document.getElementById('my-avatar-img').style.display = 'block';
        document.getElementById('my-avatar-default').style.display = 'none';
        saveProfile();
        // Send a ping immediately to update friends
        if (state.globalMqtt && state.globalMqtt.connected) {
          state.globalMqtt.publish(`teamsync/user/${state.friendId}/presence`, JSON.stringify({
            online: true,
            id: state.friendId,
            name: state.myName,
            room: state.room || null,
            avatarHash: state.myAvatarHash
          }));
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  addEvt('btn-show-server-dms', 'click', () => {
    document.getElementById('server-dm-modal').classList.remove('hidden');
    renderServerDMFriends();
  });
});

window.addEventListener('DOMContentLoaded', () => {
  const broadcastActivityMsg = (msg) => {
    state.peers.forEach((peer) => {
      if (peer.dc && peer.dc.readyState === 'open') {
        peer.dc.send(JSON.stringify(msg));
      }
    });
  };

  const closeAllCards = () => {
    ['wb-card', 'wt-card', 'sb-card', 'uno-card', 'poll-card', 'lvs-card', 'wheel-card'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    const empty = document.getElementById('empty-state');
    if (empty) empty.classList.add('hidden');
  };

  const setActivity = (act) => {
    closeAllCards();
    document.getElementById('activities-modal').classList.add('hidden');
    state.peers.forEach(peer => {
      if(peer.dc && peer.dc.readyState === 'open') {
        peer.dc.send(JSON.stringify({ type: 'activity_change', activity: act }));
      }
    });
    if (act === 'poll') document.getElementById('poll-card').classList.remove('hidden');
    if (act === 'lvs') document.getElementById('lvs-card').classList.remove('hidden');
    if (act === 'wheel') document.getElementById('wheel-card').classList.remove('hidden');
  };

  document.getElementById('act-poll')?.addEventListener('click', () => setActivity('poll'));
  document.getElementById('act-lvs')?.addEventListener('click', () => setActivity('lvs'));
  document.getElementById('act-wheel')?.addEventListener('click', () => setActivity('wheel'));

  document.getElementById('poll-close')?.addEventListener('click', () => closeAllCards());
  document.getElementById('lvs-close')?.addEventListener('click', () => closeAllCards());
  document.getElementById('wheel-close')?.addEventListener('click', () => closeAllCards());

  let pollState = null;
  document.getElementById('poll-create')?.addEventListener('click', () => {
    const q = document.getElementById('poll-q').value.trim();
    const opts = [
      document.getElementById('poll-opt1').value.trim(),
      document.getElementById('poll-opt2').value.trim(),
      document.getElementById('poll-opt3').value.trim(),
      document.getElementById('poll-opt4').value.trim()
    ].filter(o => o.length > 0);
    if (!q || opts.length < 2) return alert('Soru ve en az 2 seçenek girin!');
    
    const msg = { type: 'poll_start', q, opts, id: Date.now() };
    broadcastActivityMsg(msg);
    handlePollStart(msg, true);
  });

  const handlePollStart = (data, isHost) => {
    pollState = { id: data.id, q: data.q, opts: data.opts, votes: {}, myVote: null };
    data.opts.forEach(o => pollState.votes[o] = 0);
    
    document.getElementById('poll-setup').classList.add('hidden');
    document.getElementById('poll-view').classList.remove('hidden');
    document.getElementById('poll-view-q').textContent = data.q;
    
    const endBtn = document.getElementById('poll-end');
    if (isHost) endBtn.classList.remove('hidden');
    else endBtn.classList.add('hidden');
    
    renderPoll();
  };

  const renderPoll = () => {
    if(!pollState) return;
    const cont = document.getElementById('poll-opts-container');
    cont.innerHTML = '';
    let total = Object.values(pollState.votes).reduce((a,b)=>a+b,0);
    document.getElementById('poll-total-votes').textContent = `${total} Oy`;
    
    pollState.opts.forEach(opt => {
      const v = pollState.votes[opt] || 0;
      const pct = total === 0 ? 0 : Math.round((v/total)*100);
      
      const el = document.createElement('div');
      el.className = 'poll-opt' + (pollState.myVote === opt ? ' voted' : '');
      el.innerHTML = `
        <div class="poll-bar" style="width: ${pct}%"></div>
        <div class="poll-opt-text">
          <span>${opt}</span>
          <span>${v} (${pct}%)</span>
        </div>
      `;
      el.onclick = () => {
        if(pollState.myVote === opt) return;
        const old = pollState.myVote;
        pollState.myVote = opt;
        broadcastActivityMsg({ type: 'poll_vote', pollId: pollState.id, opt, old });
        
        pollState.votes[opt]++;
        if(old && pollState.votes[old] > 0) pollState.votes[old]--;
        renderPoll();
      };
      cont.appendChild(el);
    });
  };

  document.getElementById('poll-end')?.addEventListener('click', () => {
    broadcastActivityMsg({ type: 'poll_end' });
    endPoll();
  });
  const endPoll = () => {
    pollState = null;
    document.getElementById('poll-setup').classList.remove('hidden');
    document.getElementById('poll-view').classList.add('hidden');
  };

  const lvsPlayer = document.getElementById('lvs-player');
  let lvsSyncing = false;
  
  document.getElementById('lvs-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(file) {
      const url = URL.createObjectURL(file);
      lvsPlayer.src = url;
      document.getElementById('lvs-empty').style.display = 'none';
      lvsPlayer.style.display = 'block';
    }
  });
  
  const sendLvsSync = (evType) => {
    if(lvsSyncing) return;
    broadcastActivityMsg({
      type: 'lvs_sync',
      ev: evType,
      time: lvsPlayer.currentTime,
      paused: lvsPlayer.paused
    });
  };
  
  lvsPlayer.addEventListener('play', () => sendLvsSync('play'));
  lvsPlayer.addEventListener('pause', () => sendLvsSync('pause'));
  lvsPlayer.addEventListener('seeked', () => sendLvsSync('seeked'));

  const handleLvsSync = (data) => {
    lvsSyncing = true;
    if(Math.abs(lvsPlayer.currentTime - data.time) > 1) {
      lvsPlayer.currentTime = data.time;
    }
    if(data.ev === 'play' && lvsPlayer.paused) lvsPlayer.play().catch(()=>{});
    if(data.ev === 'pause' && !lvsPlayer.paused) lvsPlayer.pause();
    setTimeout(() => lvsSyncing = false, 300);
  };

  let wheelItems = [];
  const canvas = document.getElementById('wheel-canvas');
  const ctx = canvas?.getContext('2d');
  let currentRotation = 0;
  
  const drawWheel = () => {
    if(!ctx) return;
    ctx.clearRect(0,0,350,350);
    const cx = 175, cy = 175, r = 170;
    if(wheelItems.length === 0) {
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); 
      ctx.fillStyle = '#333'; ctx.fill(); return;
    }
    
    const slice = (Math.PI*2) / wheelItems.length;
    const colors = ['#f87171','#60a5fa','#34d399','#fbbf24','#a78bfa','#f472b6','#38bdf8','#a3e635','#facc15','#fb923c'];
    
    for(let i=0; i<wheelItems.length; i++) {
      const ang = i*slice;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, ang, ang+slice);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.stroke();
      
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang + slice/2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#000';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(wheelItems[i], r - 20, 6);
      ctx.restore();
    }
  };

  const renderWheelItems = () => {
    const list = document.getElementById('wheel-items-list');
    list.innerHTML = '';
    wheelItems.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'wheel-item-row';
      row.innerHTML = `<span>${it}</span><button class="btn-sec btn-sm" style="padding:2px 6px;">✕</button>`;
      row.querySelector('button').onclick = () => {
        wheelItems.splice(idx, 1);
        renderWheelItems();
        drawWheel();
        broadcastActivityMsg({type: 'wheel_items', items: wheelItems});
      };
      list.appendChild(row);
    });
  };

  document.getElementById('wheel-add-item')?.addEventListener('click', () => {
    const inp = document.getElementById('wheel-new-item');
    const val = inp.value.trim().substring(0,15);
    if(val && wheelItems.length < 15) {
      wheelItems.push(val);
      inp.value = '';
      renderWheelItems();
      drawWheel();
      broadcastActivityMsg({type: 'wheel_items', items: wheelItems});
    }
  });

  document.getElementById('wheel-ready')?.addEventListener('click', () => {
    if(wheelItems.length < 2) return alert('En az 2 öğe ekleyin!');
    document.getElementById('wheel-setup').classList.add('hidden');
    document.getElementById('wheel-play').classList.remove('hidden');
  });

  document.getElementById('wheel-spin-btn')?.addEventListener('click', () => {
    if(wheelItems.length < 2) return;
    const spins = 5 + Math.random() * 5; 
    const deg = spins * 360;
    const targetDeg = currentRotation + deg;
    broadcastActivityMsg({type: 'wheel_spin', targetDeg});
    handleWheelSpin(targetDeg);
  });

  const handleWheelSpin = (targetDeg) => {
    currentRotation = targetDeg;
    canvas.style.transform = `rotate(${currentRotation}deg)`;
    
    setTimeout(() => {
      const actualDeg = currentRotation % 360;
      const sliceDeg = 360 / wheelItems.length;
      const topAngle = (270 - actualDeg + 360) % 360;
      let winnerIdx = Math.floor(topAngle / sliceDeg);
      if(winnerIdx < 0) winnerIdx = 0;
      if(winnerIdx >= wheelItems.length) winnerIdx = wheelItems.length - 1;
      
      const winner = wheelItems[winnerIdx];
      document.getElementById('wheel-winner-text').textContent = winner;
      document.getElementById('wheel-winner-overlay').classList.remove('hidden');
    }, 4100);
  };
  
  document.getElementById('wheel-winner-close')?.addEventListener('click', () => {
    document.getElementById('wheel-winner-overlay').classList.add('hidden');
  });

  drawWheel();

  setInterval(() => {
    state.peers.forEach(peer => {
      if(peer.dc && peer.dc.readyState === 'open' && !peer._activityHooked) {
        peer._activityHooked = true;
        peer.dc.addEventListener('message', (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if(data.type === 'activity_change') {
              closeAllCards();
              if (data.activity === 'poll') document.getElementById('poll-card').classList.remove('hidden');
              if (data.activity === 'lvs') document.getElementById('lvs-card').classList.remove('hidden');
              if (data.activity === 'wheel') document.getElementById('wheel-card').classList.remove('hidden');
            }
            if(data.type === 'poll_start') handlePollStart(data, false);
            if(data.type === 'poll_vote' && pollState && pollState.id === data.pollId) {
              pollState.votes[data.opt]++;
              if(data.old && pollState.votes[data.old] > 0) pollState.votes[data.old]--;
              renderPoll();
            }
            if(data.type === 'poll_end') endPoll();
            if(data.type === 'lvs_sync') handleLvsSync(data);
            if(data.type === 'wheel_items') {
              wheelItems = data.items;
              renderWheelItems();
              drawWheel();
            }
            if(data.type === 'wheel_spin') handleWheelSpin(data.targetDeg);
          } catch(e) {}
        });
      }
    });
  }, 1000);
});
