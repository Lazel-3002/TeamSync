const params = (() => {
  return window.__params || { name: '', room: '', password: '' };
})();

// E2EE MQTT INTERCEPTION
if (window.mqtt && window.CryptoJS) {
  const originalMqttConnect = window.mqtt.connect;
  window.mqtt.connect = function(url, options) {
      const client = originalMqttConnect.call(window.mqtt, url, options);
      
      const origPublish = client.publish.bind(client);
      client.publish = function(topic, message, opts, cb) {
          if (typeof message === 'string' && message.trim().startsWith('{')) {
              try {
                  const secret = topic.split('/')[2];
                  if (secret) {
                      const encrypted = CryptoJS.AES.encrypt(message, secret).toString();
                      message = 'E2EE:' + encrypted;
                  }
              } catch(e) { console.error("E2EE Encrypt Error", e); }
          }
          return origPublish(topic, message, opts, cb);
      };

      const origOn = client.on.bind(client);
      client.on = function(event, handler) {
          if (event === 'message') {
              return origOn(event, async (topic, message) => {
                  let msgStr = message.toString();
                  if (msgStr.startsWith('E2EE:')) {
                      try {
                          const secret = topic.split('/')[2];
                          if (secret) {
                              const decrypted = CryptoJS.AES.decrypt(msgStr.substring(5), secret);
                              msgStr = decrypted.toString(CryptoJS.enc.Utf8);
                              if (!msgStr) throw new Error("Mismatched key or corrupted data");
                              message = { toString: () => msgStr };
                          }
                      } catch(e) {
                          console.warn('E2EE Decryption failed (ignored)', topic);
                          return;
                      }
                  }
                  return handler(topic, message);
              });
          }
          return origOn(event, handler);
      };
      return client;
  };
}

// Initialize Supabase
let supabaseClient = null;
if (window.supabase && window.electronAPI) {
  const envVars = window.electronAPI.getEnv();
  if (envVars.SUPABASE_URL && envVars.SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' && envVars.SUPABASE_ANON_KEY) {
    supabaseClient = window.supabase.createClient(envVars.SUPABASE_URL, envVars.SUPABASE_ANON_KEY);
    console.log('Supabase initialized successfully.');
  } else {
    console.warn('Supabase URL or Key missing in .env file');
  }
}

const state = window.state;

const badWordsList = ['amk', 'amq', 'aq', 'oç', 'piç', 'yarak', 'yarrak', 'amcık', 'sik', 'sikerim', 'siktir', 'orospu', 'göt', 'pezevenk', 'fuck', 'shit', 'bitch', 'asshole', 'döl', 'dol', 'meme', 'yarak', 'yarrag', 'yaraq', 'yarraq', 'sg', 'siktir', 'sktir', 'am', 'kaltak', 'sürtük', 'pç'];
const badWordsRegex = new RegExp('\\b(' + badWordsList.join('|') + ')\\b', 'gi');

function cleanText(text, isUsername = false) {
  if (!state.sfwMode || !text || typeof text !== 'string') return text;
  if (text.match(badWordsRegex)) {
    if (isUsername) return "Anonim";
    return "Üzgünüm, belirlediğim güvenlik protokolleri gereği bu tür içerikler (küfür, argo veya +18) oluşturamıyorum. Daha nazik veya farklı bir konuda yardımcı olabilirim.";
  }
  return text;
}

async function loadAIFilter() {
  if (state.aiModel) return;
  
  if (window.nsfwjs) {
    state.aiModel = await window.nsfwjs.load();
    return;
  }
  
  return new Promise((resolve) => {
    const s1 = document.createElement('script');
    s1.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs';
    s1.onload = () => {
      // Load image filter (nsfwjs)
      const s2 = document.createElement('script');
      s2.src = 'https://unpkg.com/nsfwjs';
      s2.onload = async () => {
        try { 
          state.aiModel = await window.nsfwjs.load(); 
          
          // Load text embeddings model
          const s3 = document.createElement('script');
          s3.src = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/universal-sentence-encoder';
          s3.onload = async () => {
             try {
                state.useModel = await window.use.load();
                resolve();
             } catch(e) { resolve(); }
          };
          s3.onerror = resolve;
          document.head.appendChild(s3);
          
        } catch(e) { resolve(); }
      };
      s2.onerror = resolve;
      document.head.appendChild(s2);
    };
    s1.onerror = resolve;
    document.head.appendChild(s1);
  });
}

async function checkAvatar(base64Str) {
  if (!state.sfwMode || !state.aiModel || !base64Str) return base64Str;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const preds = await state.aiModel.classify(img);
        const bad = preds.some(p => (p.className === 'Porn' || p.className === 'Hentai' || p.className === 'Sexy') && p.probability > 0.6);
        resolve(bad ? null : base64Str);
      } catch(e) { resolve(base64Str); }
    };
    img.onerror = () => resolve(base64Str);
    img.src = base64Str;
  });
}

const CHUNK_SIZE = 64 * 1024;
const fileBuffer = new Map();

let mqttClient = null;
let internetAnnounceInterval = null;

function setupInternetSignaling(roomId, myId, myName) {
  if (mqttClient) mqttClient.end();
  
  // Sinyalleşmeyi HiveMQ üzerinden Cloudflare Oda ID'si ile yapıyoruz.
  let brokerUrl = 'wss://broker.emqx.io:8084/mqtt';

  mqttClient = mqtt.connect(brokerUrl, {
    clientId: 'sig-' + myId,
    keepalive: 60,
    reconnectPeriod: 1000
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT signaling connection error:', err);
  });
  
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
          avatar: state.myAvatar || null,
          isRoomFounder: state.isRoomFounder,
          sfwMode: state.sfwMode
        }));
      }
    }, 3000);

    // Broadcast a lobby-sync-request to get active lobbies from other players immediately!
    setTimeout(() => {
      broadcast({ type: 'lobby-sync-request' });
    }, 1000);
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
        if (data.isRoomFounder && data.sfwMode) {
           if (!state.sfwMode) {
               state.sfwMode = true;
               loadAIFilter();
           }
        }
        handlePeerDiscovered({ id: data.id, name: data.name, ip: 'internet', avatar: data.avatar, isFounder: data.isRoomFounder });
      } else if (data.type === 'signal' && data.target === myId) {
        let peer = state.peers.get(data.id);
        if (!peer) {
          await handlePeerDiscovered({ id: data.id, name: data.name || 'Bilinmeyen', ip: 'internet', avatar: data.avatar, isFounder: data.isRoomFounder });
          peer = state.peers.get(data.id);
        }
        if (peer) {
          peer.ip = 'internet';
          peer.lastSeen = Date.now();
          handleSignal(data.id, 'internet', data.signal);
        }
      } else if (data.type === 'room-broadcast') {
        console.log('📥 MQTT Broadcast alındı:', data.id, data.payload.type, data.payload);
        const peer = state.peers.get(data.id);
        if (peer) peer.lastSeen = Date.now();
        handleDataMessage(data.id, data.payload);
      } else if (data.type === 'room-private' && data.target === myId) {
        console.log('📥 MQTT Private alındı:', data.id, data.payload.type, data.payload);
        const peer = state.peers.get(data.id);
        if (peer) peer.lastSeen = Date.now();
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
  if (!id || id === state.myId) return;
  let peer = state.peers.get(id);
  if (!peer) {
    console.log(`📨 Signal received but peer not found, creating peer connection for id=${id}, ip=${ip}`);
    await handlePeerDiscovered({ id: id, name: 'Bilinmeyen Arkadaş', ip: ip });
    peer = state.peers.get(id);
    if (!peer) return;
  }
  peer.lastSeen = Date.now();
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
      answer.sdp = setMediaBitrates(answer.sdp);
      await peer.pc.setLocalDescription(answer);
      if (mqttClient && mqttClient.connected) {
        sendInternetSignal(id, { type: 'answer', sdp: answer });
      } else if (peer.ip && peer.ip !== 'internet') {
        window.electronAPI.sendUDPSignal(peer.ip, { type: 'answer', sdp: answer });
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
      if (signal.candidate) {
        // Skip null end-of-candidate marker to prevent RTCIceCandidate construction errors
        if (signal.candidate.sdpMid === null && signal.candidate.sdpMLineIndex === null && !signal.candidate.candidate) {
          return;
        }
        try {
          const iceCand = new RTCIceCandidate(signal.candidate);
          if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
            await peer.pc.addIceCandidate(iceCand);
          } else {
            peer.iceQueue.push(iceCand);
          }
        } catch (err) {
          console.warn('Failed to parse candidate:', err, signal.candidate);
        }
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

// Global Functions for Account Management
window.getAccounts = async function() {
  try {
    const data = await window.electronAPI.loadAccounts();
    return data || [];
  } catch (e) {
    return [];
  }
};

window.saveAccounts = async function(accounts) {
  try {
    await window.electronAPI.saveAccounts(accounts);
  } catch (e) {}
};

window.updateAccountInList = async function(profile) {
  const accounts = await getAccounts();
  const idx = accounts.findIndex(acc => acc.id === profile.id);
  const isDefault = idx !== -1 ? accounts[idx].isDefault : false;
  const accData = { ...profile, isDefault };
  if (idx !== -1) {
    accounts[idx] = accData;
  } else {
    accounts.push(accData);
  }
  await saveAccounts(accounts);
};

window.deleteAccount = async function(id) {
  let accounts = await getAccounts();
  accounts = accounts.filter(acc => acc.id !== id);
  await saveAccounts(accounts);
  
  // If we deleted the active profile, clear active profile
  const activeProfileStr = localStorage.getItem('teamsync_profile');
  if (activeProfileStr) {
    try {
      const activeProfile = JSON.parse(activeProfileStr);
      if (activeProfile.id === id) {
        localStorage.removeItem('teamsync_profile');
      }
    } catch(e){}
  }
};

window.loginWithAccount = function(acc) {
  state.myName = acc.name;
  state.friendId = acc.id;
  state.myAvatar = acc.avatar || null;
  state.myAvatarHash = acc.avatarHash || null;
  state.friends = acc.friends || {};
  state.friendRequests = acc.requests || [];
  
  // Set in localStorage as active profile
  localStorage.setItem('teamsync_profile', JSON.stringify({
    name: state.myName,
    id: state.friendId,
    avatar: state.myAvatar,
    avatarHash: state.myAvatarHash,
    friends: state.friends,
    requests: state.friendRequests
  }));
  
  document.getElementById('display-name').textContent = state.myName;
  document.getElementById('my-friend-id').textContent = state.friendId;
  
  if (state.myAvatar) {
    document.getElementById('my-avatar-img').src = state.myAvatar;
    document.getElementById('my-avatar-img').style.display = 'block';
    document.getElementById('my-avatar-default').style.display = 'none';
  } else {
    document.getElementById('my-avatar-img').style.display = 'none';
    document.getElementById('my-avatar-default').style.display = 'block';
  }
  
  document.getElementById('step-accounts').classList.add('hidden');
  document.getElementById('step-name').classList.add('hidden');
  document.getElementById('step-action').classList.remove('hidden');
  document.querySelector('.login-card').classList.add('expanded');
  
  renderFriends();
  setupGlobalMQTT();
};

window.renderAccountsList = async function() {
  const container = document.getElementById('accounts-list');
  if (!container) return;
  container.innerHTML = '';
  
  const accounts = await getAccounts();
  if (accounts.length === 0) {
    // Show step-name to create first account
    document.getElementById('step-accounts').classList.add('hidden');
    document.getElementById('step-name').classList.remove('hidden');
    document.getElementById('btn-back-accounts').classList.add('hidden');
    return;
  }
  
  accounts.forEach(acc => {
    const row = document.createElement('div');
    row.className = 'account-row';
    
    let avatarHtml = `<div class="account-row-avatar">👤</div>`;
    if (acc.avatar) {
      avatarHtml = `<img class="account-row-avatar" src="${acc.avatar}" />`;
    }
    
    row.innerHTML = `
      ${avatarHtml}
      <div class="account-row-info">
        <div class="account-row-name">${escapeHtml(acc.name)}</div>
        <div class="account-row-id">${acc.id}</div>
      </div>
      <div class="account-row-actions">
        <label class="account-row-checkbox-label" onclick="event.stopPropagation();">
          <input type="checkbox" class="default-chk" ${acc.isDefault ? 'checked' : ''} />
          Otomatik
        </label>
        <button class="account-row-delete-btn" title="Hesabı Sil" onclick="event.stopPropagation();">🗑️</button>
      </div>
    `;
    
    // Checkbox toggle handler
    const chk = row.querySelector('.default-chk');
    chk.onchange = async (e) => {
      e.stopPropagation();
      const accountsList = await getAccounts();
      accountsList.forEach(a => {
        if (a.id === acc.id) a.isDefault = chk.checked;
        else if (chk.checked) a.isDefault = false; // Only one default account
      });
      await saveAccounts(accountsList);
      await renderAccountsList();
    };
    
    // Delete button handler
    const delBtn = row.querySelector('.account-row-delete-btn');
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (await window.showConfirm('⚠️ Hesabı Sil', `"${acc.name}" hesabını bu cihazdan silmek istediğinize emin misiniz?`)) {
        await deleteAccount(acc.id);
        await renderAccountsList();
      }
    };
    
    // Click row to login
    row.onclick = () => {
      loginWithAccount(acc);
    };
    
    container.appendChild(row);
  });
};

async function saveProfile() {
  const profileData = {
    name: state.myName,
    id: state.friendId,
    avatar: state.myAvatar,
    avatarHash: state.myAvatarHash,
    friends: state.friends,
    requests: state.friendRequests
  };
  localStorage.setItem('teamsync_profile', JSON.stringify(profileData));
  await updateAccountInList(profileData);
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
            ${inRoom ? '<div style="font-size: 11px; color: var(--ok); margin-top: 2px; display:flex; align-items:center;"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="margin-right:4px;"><circle cx="12" cy="12" r="12"></circle></svg> Sunucuda</div>' : ''}
          </div>
        </div>
        <div class="friend-actions" style="display: flex; gap: 8px; align-items: center;">
          <button class="icon-btn sm" style="display: flex; align-items: center; justify-content: center; background: rgba(139, 92, 246, 0.2); color: #c4b5fd; border-color: rgba(139, 92, 246, 0.3);" onclick="openDM('${fId}')" title="Mesaj Gönder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          </button>
          ${inRoom ? `<button class="icon-btn sm" style="display: flex; align-items: center; justify-content: center; background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.3);" onclick="requestJoinRoom('${fId}')" title="Sunucusuna Katıl">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 12h4"></path><path d="M8 10v4"></path><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line></svg>
          </button>` : ''}
          <button class="icon-btn sm" style="display: flex; align-items: center; justify-content: center; background: ${f.isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(107, 114, 128, 0.2)'}; color: ${f.isMuted ? '#fca5a5' : '#9ca3af'}; border-color: ${f.isMuted ? 'rgba(239, 68, 68, 0.3)' : 'rgba(107, 114, 128, 0.3)'};" onclick="toggleMuteFriend('${fId}')" title="${f.isMuted ? 'Sesi Aç' : 'Sessize Al / Engelle'}">
            ${f.isMuted 
              ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>` 
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`}
          </button>
          <button class="icon-btn sm" style="display: flex; align-items: center; justify-content: center; background: rgba(239, 68, 68, 0.2); color: #fca5a5; border-color: rgba(239, 68, 68, 0.3);" onclick="removeFriend('${fId}')" title="Arkadaşlıktan Çıkar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="23" y1="11" x2="17" y2="11"></line></svg>
          </button>
        </div>
      `;
      flist.appendChild(li);
    });
  }
}

window.toggleMuteFriend = (fId) => {
  if (!state.friends[fId]) return;
  state.friends[fId].isMuted = !state.friends[fId].isMuted;
  saveProfile();
};

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

window.showConfirm = (title, message) => {
  return new Promise((resolve) => {
    let modal = document.getElementById('generic-confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'generic-confirm-modal';
      modal.className = 'hidden';
      modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 10000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px);';
      modal.innerHTML = `
        <div class="mcard" style="background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); width: 400px; padding: 24px; text-align: center;">
          <h3 id="generic-confirm-title" style="margin-top: 0; margin-bottom: 15px; font-size: 20px; color: #f8fafc;">⚠️ Onay</h3>
          <p id="generic-confirm-message" style="margin-bottom: 24px; color: #94a3b8; font-size: 15px; line-height: 1.5;">Emin misiniz?</p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="generic-confirm-yes" class="btn-pri" style="flex: 1; padding: 10px; border-radius: 8px; background: #ef4444; border: none; color: white; font-weight: bold; cursor: pointer; transition: 0.2s;">Evet</button>
            <button id="generic-confirm-no" class="btn-sec" style="flex: 1; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; font-weight: bold; cursor: pointer; transition: 0.2s;">İptal</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    
    document.getElementById('generic-confirm-title').innerText = title;
    document.getElementById('generic-confirm-message').innerText = message;
    modal.classList.remove('hidden');

    const yesBtn = document.getElementById('generic-confirm-yes');
    const noBtn = document.getElementById('generic-confirm-no');

    const cleanup = () => {
      modal.classList.add('hidden');
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
    };

    const onYes = () => { cleanup(); resolve(true); };
    const onNo = () => { cleanup(); resolve(false); };

    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
  });
};

window.removeFriend = async (id) => {
  const confirmed = await window.showConfirm('⚠️ Arkadaşlıktan Çıkar', 'Bu kişiyi arkadaşlıktan çıkarmak istediğine emin misin?');
  if (confirmed) {
    delete state.friends[id];
    saveProfile();
    if (state.globalMqtt) {
      state.globalMqtt.unsubscribe(`teamsync/user/${id}/presence`);
    }
  }
};

let presenceInterval = null;
let pingInterval = null;

function setupGlobalMQTT() {
  if (state.globalMqtt) return;
  state.globalMqtt = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
    clientId: 'glob-' + state.friendId + '-' + state.myId,
    keepalive: 60,
    reconnectPeriod: 1000
  });

  state.globalMqtt.on('error', (err) => {
    console.error('MQTT global connection error:', err);
  });
  
  state.globalMqtt.on('connect', () => {
    console.log('🔗 Global MQTT (Arkadaşlık) bağlandı');
    state.globalMqtt.subscribe(`teamsync/user/${state.friendId}/events`);
    
    Object.keys(state.friends).forEach(fId => {
      state.globalMqtt.subscribe(`teamsync/user/${fId}/presence`);
    });
    
    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(() => {
      if (state.globalMqtt && state.globalMqtt.connected) {
        state.globalMqtt.publish(`teamsync/user/${state.friendId}/presence`, JSON.stringify({
          online: true,
          id: state.friendId,
          name: state.myName,
          room: state.room || null,
          avatarHash: state.myAvatarHash || null
        }));
      }
    }, 5000);

    // Removed global MQTT ping logic for serverless operation
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
        let senderId = data.id || data.fromId;
        if (senderId && state.friends[senderId] && state.friends[senderId].isMuted) {
          const blockedEvents = ['dm_msg', 'dm_file_start', 'dm_file_chunk', 'room_join_request', 'server_invite_received'];
          if (blockedEvents.includes(data.type)) {
            return;
          }
        }
        
        // ping_latency_req removed for serverless operation

        if (data.type === 'friend_request') {
          if (!state.friends[data.id] && !state.friendRequests.find(r => r.id === data.id)) {
            state.friendRequests.push({ id: data.id, name: data.name });
            saveProfile();
            showToast(`${data.name} sana arkadaşlık isteği gönderdi!`, 'info');
            if (window.electronAPI && window.electronAPI.notify) window.electronAPI.notify('Arkadaşlık İsteği', `${data.name} sana arkadaşlık isteği gönderdi!`);
            renderFriends();
          }
        } else if (data.type === 'friend_accepted') {
          if (!state.friends[data.id]) {
            state.friends[data.id] = { name: data.name, online: false };
            saveProfile();
            showToast(`${data.name} arkadaşlık isteğini kabul etti!`, 'ok');
            if (window.electronAPI && window.electronAPI.notify) window.electronAPI.notify('İstek Kabul Edildi', `${data.name} arkadaşlık isteğini kabul etti!`);
            state.globalMqtt.subscribe(`teamsync/user/${data.id}/presence`);
            renderFriends();
          }
        } else if (data.type === 'room_join_request') {
          if (state.room) {
            state.pendingJoinReq = { id: data.id, name: data.name };
            const nameEl = document.getElementById('join-req-name');
            if (nameEl) nameEl.textContent = data.name;
            document.getElementById('join-request-modal').classList.remove('hidden');
            playSound('on');
            if (window.electronAPI && window.electronAPI.notify) window.electronAPI.notify('Katılma İsteği', `${data.name} odanıza katılmak istiyor.`);
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
              fromId: state.myId,
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


function getIceServers() {
  const customUrl = localStorage.getItem('teamsync_turn_url') || '';
  const customUser = localStorage.getItem('teamsync_turn_user') || '';
  const customPass = localStorage.getItem('teamsync_turn_pass') || '';

  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:74.125.250.129:19302' }, // IP fallback
    { urls: 'stun:162.159.207.0:3478' }    // IP fallback
  ];

  if (customUrl && customUser && customPass) {
    servers.push({
      urls: customUrl,
      username: customUser,
      credential: customPass
    });
  } else {
    // Varsayılan Metered.ca Open Relay (Public) - Domain ve IP ile
    servers.push(
      { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      // IP fallbacks
      { urls: 'turns:15.235.47.158:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turns:15.235.47.158:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:15.235.47.158:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:15.235.47.158:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:15.235.47.158:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    );
  }
  return servers;
}

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

  const isSecond = await window.electronAPI.isSecondInstance();
  const accountsList = await getAccounts();
  const defaultAcc = !isSecond ? accountsList.find(acc => acc.isDefault) : null;
  
  if (defaultAcc) {
    loginWithAccount(defaultAcc);
  } else {
    const savedProfile = localStorage.getItem('teamsync_profile');
    if (savedProfile) {
      try {
        const data = JSON.parse(savedProfile);
        const existing = accountsList.find(a => a.id === data.id);
        if (existing) {
          loginWithAccount(existing);
        } else {
          loginWithAccount(data);
        }
      } catch(e) {
        await showAccountsOrNameSetup();
      }
    } else {
      await showAccountsOrNameSetup();
    }
  }

  async function showAccountsOrNameSetup() {
    const accList = await getAccounts();
    if (accList.length > 0) {
      document.getElementById('step-accounts').classList.remove('hidden');
      await renderAccountsList();
    } else {
      document.getElementById('step-name').classList.remove('hidden');
    }
  }

  btnNextName.addEventListener('click', () => {
    const n = nameInp.value.trim() || 'Anonim';
    state.myName = n;
    state.friendId = `KNK-${crypto.randomUUID().toUpperCase()}`;
    displayName.textContent = n;
    document.getElementById('my-friend-id').textContent = state.friendId;
    
    saveProfile();
    
    stepName.classList.add('hidden');
    stepAction.classList.remove('hidden'); document.querySelector('.login-card').classList.add('expanded');
  });

  document.getElementById('btn-new-account').addEventListener('click', () => {
    document.getElementById('step-accounts').classList.add('hidden');
    document.getElementById('step-name').classList.remove('hidden');
    document.getElementById('btn-back-accounts').classList.remove('hidden');
  });

  document.getElementById('btn-back-accounts').addEventListener('click', async () => {
    document.getElementById('step-name').classList.add('hidden');
    document.getElementById('step-accounts').classList.remove('hidden');
    await renderAccountsList();
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (mqttClient) {
      mqttClient.end();
      mqttClient = null;
    }
    if (internetAnnounceInterval) {
      clearInterval(internetAnnounceInterval);
      internetAnnounceInterval = null;
    }
    if (presenceInterval) {
      clearInterval(presenceInterval);
      presenceInterval = null;
    }
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (state.globalMqtt) {
      try {
        state.globalMqtt.publish(`teamsync/user/${state.friendId}/presence`, JSON.stringify({
          online: false,
          id: state.friendId
        }));
      } catch (e) {}
      state.globalMqtt.end();
      state.globalMqtt = null;
    }
    
    localStorage.removeItem('teamsync_profile');
    
    state.myName = '';
    state.friendId = '';
    state.myAvatar = null;
    state.myAvatarHash = null;
    state.friends = {};
    state.friendRequests = [];
    
    document.getElementById('step-action').classList.add('hidden');
    document.querySelector('.login-card').classList.remove('expanded');
    document.getElementById('step-accounts').classList.remove('hidden');
    await renderAccountsList();
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

  const startApp = async (roomId, pw, useAI, pttMode, serverName, isJoining = false, useSFW = false, useGameMode = false) => {
    roomId = roomId.toLowerCase();
    state.sfwMode = useSFW;
    state.gameMode = useGameMode;
    if (useSFW) {
       showToast("Yapay zeka modelleri yükleniyor (3MB), Lütfen bekleyin...", "info");
       await loadAIFilter();
    }
    document.getElementById('login').classList.add('hidden');
    state.room = roomId;
    state.password = pw;
    state.useAI = useAI;
    state.pttMode = pttMode;
    state.isRoomFounder = !isJoining;
    state.friendsOnlyMode = false;
    
    if (state.isRoomFounder) {
      document.getElementById('founder-settings').classList.remove('hidden');
    } else {
      document.getElementById('founder-settings').classList.add('hidden');
    }

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
      
      addUser({ id: 'self', name: state.myName + ' (sen)', mic: true, deaf: false, sharing: false, self: true, avatar: state.myAvatar, isFounder: state.isRoomFounder });
      
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

    // Sunucu var mı kontrolü (15 saniye içinde kimse bulunamazsa iptal et)
    if (state.joinTimeout) clearTimeout(state.joinTimeout);
    state.joinTimeout = setTimeout(() => {
      btnJoin.textContent = originalText;
      btnJoin.disabled = false;
      
      if (!state.isJoining || state.room !== roomId) return;

      // Eğer hiç peer yoksa, sunucu yok demektir (veya boş)
      if (state.peers.size === 0) {
        disconnectApp();
        document.getElementById('error-text').textContent = "Böyle bir sunucu bulunamadı veya bağlantı zaman aşımına uğradı. Lütfen ID'yi kontrol edin.";
        document.getElementById('error-modal').classList.remove('hidden');
      }
    }, 15000);
  });

  btnCreate.addEventListener('click', async () => {
    document.getElementById('error-modal').classList.add('hidden');
    if (state.joinTimeout) clearTimeout(state.joinTimeout);
    state.isJoining = false;
    const sName = createName.value.trim() || 'Oyun Odası';
    
    // Gerçek P2P ID mantığı: Cloudflared tüneline gerek kalmadan eşsiz bir ID üretiyoruz
    const odaId = `ts-${crypto.randomUUID()}`;
    
    const useSFW = document.getElementById('create-useSFW').checked;
    const useGameMode = document.getElementById('create-gameMode') ? document.getElementById('create-gameMode').checked : false;
    startApp(odaId, createPw.value, createAi.checked, createPtt.checked, sName, false, useSFW, useGameMode);
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

function playNote(actx, freq, startTime, duration) {
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(actx.destination);
  
  osc.frequency.setValueAtTime(freq, startTime);
  
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.5, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  
  osc.start(startTime);
  osc.stop(startTime + duration + 0.1);
}

function playSound(type) {
  try {
    if (!state.sfxAudioCtx) {
      state.sfxAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const actx = state.sfxAudioCtx;
    if (actx.state === 'suspended') actx.resume().catch(console.error);

    const t = actx.currentTime + 0.02;

    if (type === 'on') {
      // Tam Discord Unmute (Açma) Sesi
      playNote(actx, 415, t, 0.08);
      playNote(actx, 554, t + 0.1, 0.08);
    } else if (type === 'off') {
      // Tam Discord Mute (Kapatma) Sesi
      playNote(actx, 415, t, 0.08);
      playNote(actx, 311, t + 0.1, 0.08);
    } else if (type === 'deafOn') {
      // Tam Discord Sağırlaştırma Kapatma (Undeafen)
      playNote(actx, 185, t, 0.08);
      playNote(actx, 233, t + 0.1, 0.08);
      playNote(actx, 277, t + 0.2, 0.08);
    } else if (type === 'deafOff') {
      // Tam Discord Sağırlaştırma (Deafen)
      playNote(actx, 277, t, 0.08);
      playNote(actx, 233, t + 0.1, 0.08);
      playNote(actx, 185, t + 0.2, 0.08);
    }
  } catch(e) {
    console.error("Audio error:", e);
  }
}

async function setupLocalAudio() {
  if (state.gateAudioCtx && state.gateAudioCtx.state !== 'closed') {
    try { state.gateAudioCtx.close(); } catch(e) {}
  }
  if (state.audioCtx && state.audioCtx.state !== 'closed') {
    try { state.audioCtx.close(); } catch(e) {}
  }
  if (state.rawMicStream) {
    state.rawMicStream.getTracks().forEach(t => t.stop());
  }

  const sel = document.getElementById('mic-select');
  const deviceId = sel && sel.value ? { exact: sel.value } : undefined;

  const raw = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId,
      echoCancellation: true,
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      sampleRate: { ideal: 48000 },
      channelCount: { ideal: 2 }
    }
  });

  state.rawMicStream = raw;

  const vuCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (vuCtx.state === 'suspended') {
    vuCtx.resume().catch(console.error);
  }
  state.gateAudioCtx = vuCtx;
  const vuSrc = vuCtx.createMediaStreamSource(raw);
  
  state.vuAnalyser = vuCtx.createAnalyser();
  state.vuAnalyser.fftSize = 512;
  vuSrc.connect(state.vuAnalyser);

  state.gateGainNode = vuCtx.createGain();
  vuSrc.connect(state.gateGainNode);
  
  const dest = vuCtx.createMediaStreamDestination();

  if (state.useAI) {
    const highpass = vuCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 80;

    const lowpass = vuCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 12000;

    const compressor = vuCtx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;

    const gainNode = vuCtx.createGain();
    gainNode.gain.value = 1.0;

    state.gateGainNode.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(dest);
  } else {
    state.gateGainNode.connect(dest);
  }

  state.processedStream = dest.stream;
  
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const blankVideoTrack = canvas.captureStream().getVideoTracks()[0];
  blankVideoTrack.enabled = false;
  state.processedStream.addTrack(blankVideoTrack);
  
  state.localStream = state.processedStream;

  state.uiAnalyser = vuCtx.createAnalyser();
  state.uiAnalyser.fftSize = 512;
  const finalSrc = vuCtx.createMediaStreamSource(state.localStream);
  finalSrc.connect(state.uiAnalyser);

  if (state.peers && state.peers.size > 0) {
    const newAudioTrack = state.localStream.getAudioTracks()[0];
    state.peers.forEach(peer => {
      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio');
      if (sender && newAudioTrack) sender.replaceTrack(newAudioTrack);
    });
  }

  if (state.micEnabled === false) {
    state.localStream.getAudioTracks().forEach(t => t.enabled = false);
    if (state.rawMicStream) state.rawMicStream.getAudioTracks().forEach(t => t.enabled = false);
  }
}

function setupVUMeter() {
  if (!state.vuAnalyser) return;
  const data = new Uint8Array(state.vuAnalyser.frequencyBinCount);
  let uiData;
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
      } else {
        state.gateGainNode.gain.setTargetAtTime(1, state.gateAudioCtx.currentTime, 0.05);
      }
    }

    let isActuallySpeaking = isSpeaking;
    if (state.uiAnalyser) {
      if (!uiData || uiData.length !== state.uiAnalyser.frequencyBinCount) {
        uiData = new Uint8Array(state.uiAnalyser.frequencyBinCount);
      }
      state.uiAnalyser.getByteFrequencyData(uiData);
      let sumUI = 0;
      for (let i = 0; i < uiData.length; i++) sumUI += uiData[i] * uiData[i];
      const rmsUI = Math.sqrt(sumUI / uiData.length);
      const dbUI = 20 * Math.log10(rmsUI / 255 || 0.0001);
      const pctUI = Math.min(100, Math.max(0, (dbUI + 60) * 100 / 60));
      isActuallySpeaking = pctUI > 2;
    }

    if (isActuallySpeaking) {
      if (!state.isSpeakingLocally) { state.isSpeakingLocally = true; updateUserUI('self'); }
    } else {
      if (state.isSpeakingLocally) { state.isSpeakingLocally = false; updateUserUI('self'); }
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
      await setupLocalAudio();
    });
  } catch (e) {}
}

async function handlePeerDiscovered(peer) {
  if (!peer || !peer.id || peer.id === state.myId) return;
  
  if (state.sfwMode) {
    const cleaned = cleanText(peer.name);
    if (cleaned !== peer.name) peer.name = "Anonim";
    if (peer.avatar) peer.avatar = await checkAvatar(peer.avatar);
  }
  
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
  
  if (state.isRoomFounder && state.friendsOnlyMode) {
    if (state.friends[peer.id]) {
      console.log('✅ Peer is founder\'s friend, allowing.');
    } else {
      console.log('⏳ Checking if peer is anyone\'s friend...');
      if (mqttClient && mqttClient.connected) {
        mqttClient.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({ type: 'check_friend', targetId: peer.id }));
      }
      peer.friendCheckTimeout = setTimeout(() => {
        console.log('❌ Peer is no one\'s friend, kicking:', peer.name);
        if (mqttClient && mqttClient.connected) {
          mqttClient.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({ type: 'kick_peer', targetId: peer.id, reason: 'Sadece arkadaşlar katılabilir.' }));
        }
        removePeer(peer.id);
      }, 3000);
    }
  }
  
  addUser({ id: peer.id, name: peer.name, mic: true, deaf: false, sharing: false, ip: peer.ip, avatar: peer.avatar, isFounder: peer.isFounder });
  
  if (state.lobbies && state.lobbies.length > 0) {
    setTimeout(() => {
      syncLobbiesList();
    }, 1500);
  }
  
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
  if (peer.mediaStreamSource) { try { peer.mediaStreamSource.disconnect(); } catch(e) {} }
  if (peer.analyser) { try { peer.analyser.disconnect(); } catch(e) {} }
  if (peer.audioCtx) { try { peer.audioCtx.close(); } catch(e) {} }
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

  // Lobby cleanup on peer disconnect
  let lobbyChanged = false;
  state.lobbies.forEach((lob, index) => {
    const wasPlayer = lob.players.some(p => p.id === peerId);
    const wasSpectator = lob.spectators.some(s => s.id === peerId);
    
    if (wasPlayer || wasSpectator) {
      lob.players = lob.players.filter(p => p.id !== peerId);
      lob.spectators = lob.spectators.filter(s => s.id !== peerId);
      lobbyChanged = true;
      
      if (lob.hostId === peerId) {
        const nextPlayer = lob.players[0]; // first remaining player
        if (nextPlayer) {
          lob.hostId = nextPlayer.id;
          lob.hostName = nextPlayer.name;
          
          if (nextPlayer.id === state.myId) {
            state.isLobbyHost = true;
            if (lob.activity === 'uno') {
              const hostSettings = document.getElementById('uno-host-settings');
              if (hostSettings) hostSettings.style.display = 'block';
              const startBtn = document.getElementById('uno-start-btn');
              if (startBtn) startBtn.classList.remove('hidden');
              const readyBtn = document.getElementById('uno-ready-btn');
              if (readyBtn) readyBtn.classList.add('hidden');
            }
          }
        } else {
          state.lobbies.splice(index, 1);
        }
      }
    }
  });

  if (lobbyChanged) {
    updateActivityCounts();
    if (state.selectedLobbyActivity) {
      renderLobbiesList(state.selectedLobbyActivity);
    }
    syncLobbiesList();
  }

  // Activity-specific cleanup on peer disconnect
  if (state.uno.players.has(peerId)) {
    state.uno.players.delete(peerId);
    
    if (state.uno.host === state.myId) {
      const idx = state.uno.turnOrder.indexOf(peerId);
      if (idx !== -1) {
        state.uno.turnOrder.splice(idx, 1);
        if (state.uno.turnIndex >= state.uno.turnOrder.length) {
          state.uno.turnIndex = 0;
        }
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
    } else {
      renderUnoLobby();
      if (state.uno.started) renderUnoGame();
    }
  }
}

function setMediaBitrates(sdp) {
  if (!sdp) return sdp;
  return sdp.replace(/a=fmtp:111(.*)/g, 'a=fmtp:111$1;maxaveragebitrate=128000;stereo=1;sprop-stereo=1;cbr=1');
}

async function createPeerConnection(peerId, peerName, isInitiator, peerIp) {
  if (state.peers.has(peerId)) return;
  const pc = new RTCPeerConnection({ iceServers: getIceServers() });

  if (state.localStream) state.localStream.getTracks().forEach(track => {
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
      if (mqttClient && mqttClient.connected) {
        sendInternetSignal(peerId, { type: 'ice', candidate: e.candidate });
      } else {
        const peer = state.peers.get(peerId);
        const ip = peer ? peer.ip : peerIp;
        if (ip && ip !== 'internet') {
          window.electronAPI.sendUDPSignal(ip, { type: 'ice', candidate: e.candidate });
        }
      }
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE state [${peerName}]:`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'closed') {
      removePeer(peerId);
    } else if (pc.iceConnectionState === 'failed') {
      console.warn(`⚠️ WebRTC connection failed to ${peerName}. Voice/Video might not work, falling back to MQTT for data.`);
      showToast(`${peerName} ile sesli/görüntülü bağlantı kurulamadı (Veri kanalı/MQTT aktif).`, 'warn');
      if (pc.restartIce) {
        try { pc.restartIce(); } catch(e) {}
      }
    } else if (pc.iceConnectionState === 'disconnected') {
      console.warn(`⚠️ WebRTC disconnected from ${peerName}, attempting ICE restart...`);
      if (pc.restartIce) {
        try { pc.restartIce(); } catch(e) {}
      }
    } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
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
      peer.audioEl.volume = state.deafened ? 0.0 : 1.0;
      peer.audioEl.muted = state.deafened;

      peer.audioEl.play().catch((err) => console.warn('Audio play failed:', err));
      setupSpeakingDetection(peerId, e.streams[0]);
    } else if (e.track.kind === 'video') {
      peer.videoEl.srcObject = e.streams[0];
      peer.videoEl.play().catch((err) => console.warn('peer.videoEl play failed in ontrack:', err));
      if (state.activeControl && state.activeControl.hostId === peerId) {
        const remoteVid = document.getElementById('remote-vid');
        remoteVid.srcObject = e.streams[0];
        remoteVid.play().catch((err) => console.warn('remote-vid play failed:', err));
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
    audioEl: (function(){ const a = document.createElement('audio'); a.autoplay = true; a.style.display = 'none'; document.body.appendChild(a); return a; })(),
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
    offer.sdp = setMediaBitrates(offer.sdp);
    await pc.setLocalDescription(offer);
    if (mqttClient && mqttClient.connected) {
      sendInternetSignal(peerId, { type: 'offer', sdp: offer });
    } else if (peerIp && peerIp !== 'internet') {
      window.electronAPI.sendUDPSignal(peerIp, { type: 'offer', sdp: offer });
    }
  }
}

function getActiveActivity() {
  if (!document.getElementById('wt-card').classList.contains('hidden')) return 'wt';
  if (!document.getElementById('uno-card').classList.contains('hidden')) return 'uno';
  if (!document.getElementById('sb-card').classList.contains('hidden')) return 'sb';
  if (!document.getElementById('poll-card').classList.contains('hidden')) return 'poll';
  if (!document.getElementById('lvs-card').classList.contains('hidden')) return 'lvs';
  if (!document.getElementById('wheel-card').classList.contains('hidden')) return 'wheel';
  if (!document.getElementById('wb-card').classList.contains('hidden')) return 'wb';
  return null;
}

function setupDataChannel(peerId, dc) {
  dc.binaryType = 'arraybuffer';
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
        if (state.lobbies && state.lobbies.length > 0) {
          dc.send(JSON.stringify({ type: 'lobby-list-sync', lobbies: state.lobbies }));
        }
        
        // Sync Hosted / Active Activities for late joiners
        const activeAct = getActiveActivity();
        if (activeAct) {
          if (activeAct === 'wt') {
            const url = document.getElementById('wt-url')?.value || '';
            const match = url.match(/(?:v=|youtu\.be\/)([^&]+)/);
            if (match) {
              dc.send(JSON.stringify({ type: 'wt-load', vid: match[1] }));
            }
          } else if (activeAct === 'sb' && state.sb.host === state.myId) {
            dc.send(JSON.stringify({ type: 'sb-start', host: state.myId, interactive: state.sb.interactive }));
            const currentUrl = document.getElementById('sb-url')?.value || '';
            if (currentUrl) dc.send(JSON.stringify({ type: 'sb-nav', url: currentUrl }));
          } else if (activeAct === 'uno' && state.uno.host === state.myId) {
            if (!state.uno.started) {
              dc.send(JSON.stringify({ type: 'uno-lobby', host: state.myId }));
              dc.send(JSON.stringify({ type: 'uno-lobby-sync', players: Array.from(state.uno.players.entries()) }));
            } else {
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
          } else if (activeAct === 'poke' && window.pokeState) {
            dc.send(JSON.stringify({ type: 'poke_sync', state: window.pokeState }));
          } else if (activeAct === 'poll') {
            if (window.pollState) {
              dc.send(JSON.stringify({ 
                type: 'poll_start', 
                q: window.pollState.q, 
                opts: window.pollState.opts, 
                id: window.pollState.id 
              }));
              // Also send current votes
              Object.keys(window.pollState.votes).forEach(opt => {
                const count = window.pollState.votes[opt] || 0;
                for (let i = 0; i < count; i++) {
                  dc.send(JSON.stringify({ type: 'poll_vote', pollId: window.pollState.id, opt }));
                }
              });
            }
          } else if (activeAct === 'wheel') {
            if (window.wheelItems && window.wheelItems.length > 0) {
              dc.send(JSON.stringify({ type: 'wheel_items', items: window.wheelItems }));
              dc.send(JSON.stringify({ type: 'wheel_ready' }));
            }
          } else if (activeAct === 'lvs') {
            const lvsPlayer = document.getElementById('lvs-player');
            if (lvsPlayer && !lvsPlayer.paused) {
              dc.send(JSON.stringify({
                type: 'lvs_sync',
                ev: 'play',
                time: lvsPlayer.currentTime,
                paused: false
              }));
            }
          } else if (activeAct === 'wb' && state.myId < peerId) {
            const wbData = document.getElementById('wb-canvas').toDataURL('image/jpeg', 0.5);
            dc.send(JSON.stringify({ type: 'wb-sync', data: wbData }));
          }
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
        console.log('📥 DC Mesajı alındı:', peerId, msg.type, msg);
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

const processedMessages = new Set();
async function handleDataMessage(peerId, msg) {
  if (msg && msg._mid) {
    if (processedMessages.has(msg._mid)) return;
    processedMessages.add(msg._mid);
    if (processedMessages.size > 500) {
      const first = processedMessages.values().next().value;
      processedMessages.delete(first);
    }
  }
  
  if (msg.type === 'founder_settings_update') {
    if (msg.friendsOnlyMode !== undefined) state.friendsOnlyMode = msg.friendsOnlyMode;
    if (msg.gameMode !== undefined) state.gameMode = msg.gameMode;
    if (msg.sfwMode !== undefined) {
      state.sfwMode = msg.sfwMode;
      if (state.sfwMode) loadAIFilter();
    }
    console.log('👑 Founder settings updated:', msg);
    return;
  } else if (msg.type === 'check_friend') {
    if (state.friends[msg.targetId]) {
      if (mqttClient && mqttClient.connected) {
        mqttClient.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({ type: 'friend_confirmed', targetId: msg.targetId, byId: state.myId }));
      }
    }
    return;
  } else if (msg.type === 'friend_confirmed') {
    if (state.isRoomFounder) {
      const peer = state.peers.get(msg.targetId);
      if (peer && peer.friendCheckTimeout) {
        clearTimeout(peer.friendCheckTimeout);
        peer.friendCheckTimeout = null;
        console.log(`✅ Peer ${peer.name} is confirmed as friend by ${msg.byId}, allowing.`);
      }
    }
    return;
  } else if (msg.type === 'kick_peer') {
    if (msg.targetId === state.myId) {
      disconnectApp();
      document.getElementById('error-text').textContent = "Sunucudan atıldınız: " + (msg.reason || "Bilinmeyen sebep.");
      document.getElementById('error-modal').classList.remove('hidden');
    } else {
      removePeer(msg.targetId);
    }
    return;
  } else if (msg.type === 'force_mute') {
    if (msg.targetId === state.myId) {
      state.serverMuted = true;
      setMicEnabled(false);
      showToast('Kurucu tarafından susturuldunuz!', 'danger');
    }
    return;
  }

  // Lobby system protocols - handle immediately without peer connection dependency
  if (msg.type === 'lobby-list-sync') {
    const incomingLobbies = msg.lobbies || [];
    
    // Keep our own hosted lobbies, and replace everything else with incoming lobbies hosted by others
    const myHostedLobbies = (state.lobbies || []).filter(l => l.hostId === state.myId);
    const incomingOtherLobbies = incomingLobbies.filter(l => l.hostId !== state.myId);
    
    state.lobbies = myHostedLobbies.concat(incomingOtherLobbies);
    console.log('🔄 Lobi listesi senkronize edildi. Güncel lobiler:', state.lobbies);

    updateActivityCounts();
    if (state.selectedLobbyActivity) {
      renderLobbiesList(state.selectedLobbyActivity);
    }
    if (state.activeLobbyId) {
      const activeLob = state.lobbies.find(l => l.id === state.activeLobbyId);
      if (activeLob) {
        if (activeLob.activity === 'uno') {
          state.uno.host = activeLob.hostId;
        } else if (activeLob.activity === 'sb') {
          state.sb.host = activeLob.hostId;
        }
      }
    }
    return;
  } else if (msg.type === 'lobby-join-req') {
    if (state.isLobbyHost && msg.lobbyId === state.activeLobbyId) {
      const lob = state.lobbies.find(l => l.id === state.activeLobbyId);
      if (lob) {
        if (msg.spectate) {
          if (!lob.spectators.some(s => s.id === msg.peerId)) {
            lob.spectators.push({ id: msg.peerId, name: msg.name });
          }
        } else {
          if (!lob.players.some(p => p.id === msg.peerId)) {
            lob.players.push({ id: msg.peerId, name: msg.name });
          }
        }
        syncLobbiesList();

        // Send direct synchronization state to the joining peer
        if (lob.activity === 'uno') {
          if (state.uno.started) {
            broadcastTo(msg.peerId, { 
              type: 'uno-sync', 
              host: state.myId,
              players: Array.from(state.uno.players.entries()),
              turnOrder: state.uno.turnOrder,
              turnIndex: state.uno.turnIndex,
              direction: state.uno.direction,
              discard: state.uno.discard,
              currentColor: state.uno.currentColor,
              handsCount: Array.from(state.uno.players.entries()).map(([id, p]) => ({ id, count: p.cardCount }))
            });
          } else {
            broadcastTo(msg.peerId, { type: 'uno-lobby', host: state.myId });
            broadcastTo(msg.peerId, { type: 'uno-lobby-sync', players: Array.from(state.uno.players.entries()) });
          }
        } else if (lob.activity === 'wt') {
          const url = document.getElementById('wt-url')?.value || '';
          const match = url.match(/(?:v=|youtu\.be\/)([^&]+)/);
          if (match) {
            broadcastTo(msg.peerId, { type: 'wt-load', vid: match[1] });
            if (state.wt.player && state.wt.player.getCurrentTime) {
              const time = state.wt.player.getCurrentTime();
              const isPlaying = state.wt.player.getPlayerState() === YT.PlayerState.PLAYING;
              broadcastTo(msg.peerId, { type: isPlaying ? 'wt-play' : 'wt-pause', time });
            }
          }
        } else if (lob.activity === 'poke') {
          if (window.pokeState) {
            broadcastTo(msg.peerId, { type: 'poke_sync', state: window.pokeState });
          }
        } else if (lob.activity === 'sb') {
          broadcastTo(msg.peerId, { type: 'sb-start', host: state.myId, interactive: state.sb.interactive });
          const currentUrl = document.getElementById('sb-url')?.value || '';
          if (currentUrl) {
            broadcastTo(msg.peerId, { type: 'sb-nav', url: currentUrl });
          }
        } else if (lob.activity === 'poll') {
          if (window.pollState) {
            broadcastTo(msg.peerId, { 
              type: 'poll_start', 
              q: window.pollState.q, 
              opts: window.pollState.opts, 
              id: window.pollState.id 
            });
            Object.keys(window.pollState.votes).forEach(opt => {
              const count = window.pollState.votes[opt] || 0;
              for (let i = 0; i < count; i++) {
                broadcastTo(msg.peerId, { type: 'poll_vote', pollId: window.pollState.id, opt });
              }
            });
          }
        } else if (lob.activity === 'wheel') {
          if (window.wheelItems && window.wheelItems.length > 0) {
            broadcastTo(msg.peerId, { type: 'wheel_items', items: window.wheelItems });
            broadcastTo(msg.peerId, { type: 'wheel_ready' });
          }
        } else if (lob.activity === 'lvs') {
          const lvsPlayer = document.getElementById('lvs-player');
          if (lvsPlayer) {
            broadcastTo(msg.peerId, {
              type: 'lvs_sync',
              ev: lvsPlayer.paused ? 'pause' : 'play',
              time: lvsPlayer.currentTime,
              paused: lvsPlayer.paused
            });
          }
        }
      }
    }
    return;
  } else if (msg.type === 'lobby-leave-req') {
    if (state.isLobbyHost && msg.lobbyId === state.activeLobbyId) {
      const lob = state.lobbies.find(l => l.id === state.activeLobbyId);
      if (lob) {
        lob.players = lob.players.filter(p => p.id !== msg.peerId);
        lob.spectators = lob.spectators.filter(s => s.id !== msg.peerId);
        syncLobbiesList();
      }
    }
    return;
  } else if (msg.type === 'lobby-promote-host') {
    if (msg.lobbyId === state.activeLobbyId) {
      state.isLobbyHost = true;
      state.uno.host = state.myId; // Enforce host change in UNO game too!
      const hostSettings = document.getElementById('uno-host-settings');
      if (hostSettings) hostSettings.style.display = 'block';
      const startBtn = document.getElementById('uno-start-btn');
      if (startBtn) startBtn.classList.remove('hidden');
      const readyBtn = document.getElementById('uno-ready-btn');
      if (readyBtn) readyBtn.classList.add('hidden');
    }
    return;
  } else if (msg.type === 'lobby-sync-request') {
    if (state.lobbies && state.lobbies.length > 0) {
      syncLobbiesList();
    }
    return;
  }

  const peer = state.peers.get(peerId);
  if (!peer) return;
  
  // Data Channel'dan gelen her veri (ping dahil) bu bağlantının hala çok sağlıklı olduğunu gösterir.
  // Bu yüzden MQTT sunucusu geçici olarak yavaşlasa/kopsa bile WebRTC bağlantımız kopmayacak!
  peer.lastSeen = Date.now();

  const isActivityMsg = msg.type.startsWith('wt-') || 
                        msg.type.startsWith('uno-') || 
                        msg.type.startsWith('sb-') || 
                        msg.type.startsWith('poke_') || 
                        ['activity_change', 'poll_start', 'poll_vote', 'poll_end', 'lvs_sync', 'wheel_items', 'wheel_ready', 'wheel_reset', 'wheel_spin'].includes(msg.type);

  if (isActivityMsg) {
    if (msg.lobbyId !== state.activeLobbyId) {
      return;
    }
  }

  if (msg.type === 'ping-req') {
    try {
      if (peer.dc && peer.dc.readyState === 'open') {
        peer.dc.send(JSON.stringify({ type: 'ping-res', ts: msg.ts }));
      }
    } catch(e) {}
  } else if (msg.type === 'ping-res') {
    const latency = Date.now() - msg.ts;
    // Exponential Moving Average for smoothing ping
    if (peer.smoothedPing === undefined) {
      peer.smoothedPing = latency;
    } else {
      peer.smoothedPing = Math.round(0.3 * latency + 0.7 * peer.smoothedPing);
    }
    const pingEl = document.getElementById(`ping-${peerId}`);
    if (pingEl) {
      pingEl.textContent = `${peer.smoothedPing}ms`;
      pingEl.className = 'uping ' + (peer.smoothedPing < 50 ? 'ping-good' : (peer.smoothedPing < 120 ? 'ping-ok' : 'ping-bad'));
    }
    
    // Update 'ping-self' based on average peer pings since we are serverless
    let totalPing = 0;
    let peerCount = 0;
    state.peers.forEach(p => {
      if (p.smoothedPing !== undefined) {
        totalPing += p.smoothedPing;
        peerCount++;
      }
    });
    const selfPingEl = document.getElementById('ping-self');
    if (selfPingEl && peerCount > 0) {
      const avgPing = Math.round(totalPing / peerCount);
      selfPingEl.textContent = `${avgPing}ms`;
      selfPingEl.className = 'uping ' + (avgPing < 50 ? 'ping-good' : (avgPing < 120 ? 'ping-ok' : 'ping-bad'));
    } else if (selfPingEl) {
      selfPingEl.textContent = `--ms`;
      selfPingEl.className = 'uping ping-ok';
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
    let isCensored = msg.isCensored || false;
    if (!isCensored) {
      const res = await checkTextWithAI(msg.text);
      if (!res.ok) isCensored = true;
    }
    appendChat(peerId, peer.name, msg.text || '', isCensored);
  } else if (msg.type === 'chat-enc') {
    let isCensored = msg.isCensored || false;
    if (state.cryptoKey) {
      const dec = await decryptMsg(msg.data, state.cryptoKey);
      if (dec || dec === '') {
         if (!isCensored && dec !== '') {
            const res = await checkTextWithAI(dec);
            if (!res.ok) isCensored = true;
         }
         appendChat(peerId, peer.name, dec || '', isCensored);
      } else {
         appendChat(peerId, peer.name, '🔒 [Şifre Çözülemedi]');
      }
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
  } else if (msg.type.startsWith('poke_') || ['activity_change', 'poll_start', 'poll_vote', 'poll_end', 'lvs_sync', 'wheel_items', 'wheel_ready', 'wheel_reset', 'wheel_spin'].includes(msg.type)) {
    if (window.activityHandler) window.activityHandler(msg);
  }
}



function setupSpeakingDetection(peerId, stream) {
  const peer = state.peers.get(peerId);
  if (!state.remoteAudioCtx || state.remoteAudioCtx.state === 'closed') {
    state.remoteAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const audioCtx = state.remoteAudioCtx;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  let sourceStream = stream;
  if (stream.getAudioTracks().length > 0) {
    try {
      sourceStream = new MediaStream([stream.getAudioTracks()[0].clone()]);
    } catch(e) {
      console.warn("Could not clone audio track", e);
    }
  }
  const source = audioCtx.createMediaStreamSource(sourceStream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  if (peer) {
    peer.mediaStreamSource = source;
    peer.analyser = analyser;
  }

  const data = new Uint8Array(analyser.frequencyBinCount);
  function check() {
    if (!state.peers.has(peerId)) {
      try { source.disconnect(); } catch(e) {}
      try { analyser.disconnect(); } catch(e) {}
      return;
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
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

function addUser({ id, name, mic, deaf, sharing, self, ip, avatar, isFounder }) {
  if (document.querySelector(`[data-uid="${id}"]`)) return;
  const li = document.createElement('li');
  li.className = 'user';
  li.dataset.uid = id;
  const avatarHtml = avatar 
    ? `<img src="${escapeHtml(avatar)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />`
    : name.charAt(0).toUpperCase();
  const fezHtml = isFounder ? `<img src="assets/fez.svg" class="founder-fez" />` : '';
  const nameClass = isFounder ? 'founder-name' : '';
  li.innerHTML = `
    <div class="av">
      ${fezHtml}
      ${avatarHtml}
      <div class="st"></div>
    </div>
    <div class="uname ${nameClass}" style="flex:1;">
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
    
    // Sleek context menu on clicking user in room
    li.addEventListener('click', (e) => {
      if (e.target.closest('.vol-slider') || e.target.closest(`[data-ctrl="${id}"]`)) {
        return;
      }
      e.preventDefault();
      showUserContextMenu(e, id, name);
    });
  }
  updateEmptyGrid();
}

function showUserContextMenu(e, targetId, targetName) {
  const existing = document.getElementById('user-custom-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'user-custom-context-menu';
  menu.className = 'user-context-menu';
  
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const isFriend = !!state.friends[targetId];

  const title = document.createElement('div');
  title.style.cssText = 'padding: 6px 12px; font-size: 11px; font-weight: bold; color: var(--txt-mut); border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 4px;';
  title.textContent = targetName;
  menu.appendChild(title);

  // Friend Option Button
  const friendBtn = document.createElement('button');
  friendBtn.className = 'user-context-menu-item';
  if (isFriend) {
    friendBtn.classList.add('danger');
    friendBtn.innerHTML = '👥 Arkadaşı Sil';
    friendBtn.addEventListener('click', async () => {
      if (await window.showConfirm('⚠️ Arkadaşı Sil', `"${targetName}" arkadaşını silmek istediğinize emin misiniz?`)) {
        removeFriend(targetId);
        showToast('Arkadaş silindi', 'info');
      }
      menu.remove();
    });
  } else {
    friendBtn.innerHTML = '➕ Arkadaş Ekle';
    friendBtn.addEventListener('click', () => {
      if (state.globalMqtt && state.globalMqtt.connected) {
        state.globalMqtt.publish(`teamsync/user/${targetId}/events`, JSON.stringify({
          type: 'friend_request',
          id: state.friendId,
          name: state.myName
        }));
        showToast('Arkadaşlık isteği gönderildi!', 'ok');
      } else {
        showToast('Hata: Bağlantı hazır değil.', 'warn');
      }
      menu.remove();
    });
  }
  menu.appendChild(friendBtn);

  // Message Button
  const msgBtn = document.createElement('button');
  msgBtn.className = 'user-context-menu-item';
  msgBtn.innerHTML = '💬 Mesaj Gönder';
  msgBtn.addEventListener('click', () => {
    if (!state.friends[targetId]) {
      state.friends[targetId] = { name: targetName, online: true, temporary: true };
    }
    openDM(targetId);
    document.getElementById('server-dm-modal').classList.remove('hidden');
    menu.remove();
  });
  menu.appendChild(msgBtn);

  // Remote Control Button
  const ctrlBtn = document.createElement('button');
  ctrlBtn.className = 'user-context-menu-item';
  ctrlBtn.innerHTML = '🖥️ Uzaktan Kontrol İste';
  ctrlBtn.addEventListener('click', () => {
    requestControl(targetId);
    menu.remove();
  });
  menu.appendChild(ctrlBtn);

  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'user-context-menu-item danger';
  closeBtn.style.cssText = 'border-top: 1px solid rgba(255,255,255,0.05); margin-top: 4px;';
  closeBtn.innerHTML = '✕ Kapat';
  closeBtn.addEventListener('click', () => {
    menu.remove();
  });
  menu.appendChild(closeBtn);

  document.body.appendChild(menu);

  const closeHandler = (event) => {
    if (!menu.contains(event.target)) {
      menu.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 50);
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
    document.getElementById('focus-fullscreen-btn').classList.add('hidden');
  } else {
    if (focusedCard) grid.appendChild(focusedCard);
    focusArea.appendChild(card);
    focusedCard = card;
    main.classList.add('focus-mode');
    focusArea.classList.remove('hidden');
    document.getElementById('focus-lock-btn').classList.remove('hidden');
    document.getElementById('focus-fullscreen-btn').classList.remove('hidden');
  }
}

function makeCardFocusable(card) {
  if (card.dataset.focusable) return;
  card.dataset.focusable = 'true';
  card.addEventListener('click', (e) => {
    if (e.target.closest('.sb-tools, .card-actions, button, select, input, label, .uno-card-ui, .ucc, .uno-player-list, .act-src, #uno-table, .uno-remote-player, #wt-player-container, .wt-tools, #focus-lock-btn, .inactive-overlay, #uno-uno-btn, #uno-catch-btn, #uno-color-picker, #uno-end-turn-btn, #uno-turn-indicator, #uno-dir-indicator, .mactions')) return;
    if (e.target.tagName === 'CANVAS' && focusedCard === card) return;
    toggleFocus(card);
  });
}

function showInactiveOverlay(cardId, title, onJoin) {
  if (state.activeLobbyId) {
    onJoin();
    return;
  }
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

  videoEl.play().catch(err => console.warn('videoEl play failed in addVideoCard:', err));

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
         videoEl.play().catch(err => console.warn('videoEl play failed on join click:', err));
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
async function checkTextWithAI(text) {
  if (typeof text !== 'string') text = String(text || '');
  if (!state.sfwMode || !text) return { ok: true, text: text };
  
  const warning = "Üzgünüm, belirlediğim güvenlik protokolleri gereği bu tür içerikler (küfür, argo veya +18) oluşturamıyorum. Daha nazik veya farklı bir konuda yardımcı olabilirim.";

  if (text.match(badWordsRegex)) {
    return { ok: false, warning: warning };
  }

  if (state.useModel && text.length > 5) {
    try {
       const inappropriatePhrases = [
         "cinsel ilişki", "seks yapmak", "çıplak kadın", "porno izle", "mastürbasyon", 
         "sikişmek", "sevişelim mi", "bana meme at", "kalktı", "azdırıcı",
         "soyun", "bakire misin", "amını yalayım", "götünü sikerim", "sikiş", "göğüslerini aç"
       ];
       const sentences = [text, ...inappropriatePhrases];
       const embeddings = await state.useModel.embed(sentences);
       const embeddingsArray = embeddings.arraySync();
       const targetEmbedding = embeddingsArray[0];
       
       let maxSimilarity = 0;
       for (let i = 1; i < embeddingsArray.length; i++) {
          const phraseEmbedding = embeddingsArray[i];
          let dotProduct = 0;
          let normA = 0;
          let normB = 0;
          for (let j = 0; j < targetEmbedding.length; j++) {
            dotProduct += targetEmbedding[j] * phraseEmbedding[j];
            normA += targetEmbedding[j] * targetEmbedding[j];
            normB += phraseEmbedding[j] * phraseEmbedding[j];
          }
          const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
          if (similarity > maxSimilarity) maxSimilarity = similarity;
       }
       
       if (maxSimilarity > 0.65) {
          return { ok: false, warning: warning };
       }
    } catch(e) {
      console.error("Metin yapay zeka analizi hatası:", e);
    }
  }

  return { ok: true, text: text };
}

document.getElementById('cform').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('cinput');
  const rawText = input.value.trim();
  if (!rawText) return;

  const res = await checkTextWithAI(rawText);
  let textToSend = rawText;
  let isCensored = false;

  if (!res.ok) {
     showToast(res.warning, 'danger');
     textToSend = '';
     isCensored = true;
  }
  
  if (state.cryptoKey) {
    const enc = await encryptMsg(textToSend, state.cryptoKey);
    broadcast({ type: 'chat-enc', data: enc, isCensored: isCensored });
  } else {
    broadcast({ type: 'chat', text: textToSend, isCensored: isCensored });
  }
  
  appendChat('self', state.myName, textToSend, isCensored);
  input.value = '';

  // Supabase Kayıt
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    supabaseClient.from('mesaj').insert([
      { icerik: textToSend, kullanici_adi: state.myName || 'Anonim' }
    ]).then(({ error }) => {
      if (error) console.error('Supabase mesaj kayıt hatası:', error);
      else console.log('Mesaj Supabase e kaydedildi.');
    });
  }
  });

function saveChatToLocal(uid, name, text, isCensored) {
  try {
    let history = JSON.parse(localStorage.getItem('chat_history_' + state.room) || '[]');
    history.push({ uid, name, text, isCensored, time: Date.now() });
    if (history.length > 500) history = history.slice(history.length - 500);
    localStorage.setItem('chat_history_' + state.room, JSON.stringify(history));
  } catch(e) {
    console.error('Local chat save error:', e);
  }
}

function loadLocalChatHistory() {
  try {
    const wrap = document.getElementById('msgs');
    wrap.innerHTML = '';
    const history = JSON.parse(localStorage.getItem('chat_history_' + state.room) || '[]');
    history.forEach(msg => {
       const div = document.createElement('div');
       div.className = 'msg';
       const date = new Date(msg.time);
       const t = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
       
       let msgHtml = textToHtmlEscape(msg.text);
       if (msg.isCensored) {
         msgHtml = '<span style="color: #f87171; font-style: italic; font-weight: 500; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.2); display: inline-flex; align-items: center; gap: 4px;"> Sansürlendi</span>';
       }
       div.innerHTML = '<span class="n">' + textToHtmlEscape(msg.name) + '</span><span class="t">' + t + '</span><div>' + msgHtml + '</div>';
       wrap.appendChild(div);
    });
    wrap.scrollTop = wrap.scrollHeight;
  } catch(e) {
    console.error('Error loading chat:', e);
  }
}

function textToHtmlEscape(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appendChat(uid, name, text, isCensored = false) {
  saveChatToLocal(uid, name, text, isCensored);

  if (state.sfwMode) {
    if (typeof name === 'string') {
      const cleanedName = cleanText(name, true);
      if (cleanedName !== name) name = "Anonim";
    }
    if (!isCensored && typeof text === 'string') text = cleanText(text);
  }
  const wrap = document.getElementById('msgs');
  const div = document.createElement('div');
  div.className = 'msg';
  const t = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  
  let msgHtml = escapeHtml(text);
  let notifyText = typeof text === 'string' ? text : String(text || '');

  if (isCensored) {
    msgHtml = `<span style="color: #f87171; font-style: italic; font-weight: 500; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.2); display: inline-flex; align-items: center; gap: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg> Sansürlendi</span>`;
    notifyText = "🚫 [Yapay Zeka Tarafından Sansürlendi]";
  }
  
  div.innerHTML = `<span class="n">${escapeHtml(name)}</span><span class="t">${t}</span><div>${msgHtml}</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  
  if (uid !== 'self') {
    if (window.electronAPI && window.electronAPI.notify) {
      window.electronAPI.notify(name, notifyText);
    }
  }
}

function broadcast(msg) {
  if (state.activeLobbyId) {
    msg.lobbyId = state.activeLobbyId;
    
    // Automatically transition lobby status to playing on match start messages
    if (state.isLobbyHost && (msg.type === 'uno-sync' || msg.type === 'wt-load' || msg.type === 'sb-start' || msg.type === 'poll_start' || msg.type === 'wheel_ready')) {
      const lob = state.lobbies.find(l => l.id === state.activeLobbyId);
      if (lob && lob.status === 'waiting') {
        lob.status = 'playing';
        setTimeout(() => syncLobbiesList(), 100);
      }
    }
  }
  
  if (!msg._mid) {
    msg._mid = crypto.randomUUID();
  }

  if (mqttClient && mqttClient.connected && state.room) {
    try {
      mqttClient.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({
        type: 'room-broadcast',
        id: state.myId,
        payload: msg
      }));
    } catch (e) {
      console.warn('MQTT broadcast failed:', e);
    }
  }

  const msgStr = JSON.stringify(msg);
  state.peers.forEach((peer, id) => {
    if (peer.dc && peer.dc.readyState === 'open') {
      try {
        console.log('📤 DC Broadcast gönderiliyor:', id, msg.type, msg);
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
    if (state.serverMuted) {
      showToast('Kurucu tarafından susturuldunuz. Sesinizi açamazsınız!', 'danger');
      return;
    }
    
    if (state.pttMode) {
      state.pttMode = false;
      window.electronAPI.unregisterPTT();
      document.getElementById('ptt').classList.add('hidden');
      setMicEnabled(true);
    }
    
    if (state.deafened) {
      state.preDeafenMic = true;
      document.getElementById('deaf').click();
      return;
    }
    
    const enabled = !state.micEnabled;
    setMicEnabled(enabled);
    playSound(enabled ? 'on' : 'off');
  });

  deaf.addEventListener('click', () => {
    state.deafened = !state.deafened;
    
    if (state.deafened) {
      state.preDeafenMic = state.micEnabled;
      if (state.micEnabled) {
        setMicEnabled(false);
      }
    } else {
      if (state.preDeafenMic) {
        setMicEnabled(true);
      }
    }
    
    // Mute/unmute Web Audio gain nodes and audio elements of all peers
    state.peers.forEach((peer, peerId) => {
      peer.audioEl.muted = state.deafened;
      if (peer.gainNode) {
        if (state.deafened) {
          peer.gainNode.gain.value = 0.0;
        } else {
          const slider = document.querySelector(`[data-vol="${peerId}"]`);
          const val = slider ? parseFloat(slider.value) : 1.0;
          peer.gainNode.gain.value = val;
        }
      } else {
        if (state.deafened) {
          peer.audioEl.volume = 0.0;
        } else {
          const slider = document.querySelector(`[data-vol="${peerId}"]`);
          const val = slider ? parseFloat(slider.value) : 1.0;
          peer.audioEl.volume = Math.min(val, 1.0);
        }
      }
    });

    deaf.classList.toggle('off', state.deafened);
    broadcast({ type: 'state', deaf: state.deafened });
    updateUserUI('self');
    playSound(state.deafened ? 'deafOff' : 'deafOn');
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
        answer.sdp = setMediaBitrates(answer.sdp);
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
    document.getElementById('turn-url').value = localStorage.getItem('teamsync_turn_url') || '';
    document.getElementById('turn-user').value = localStorage.getItem('teamsync_turn_user') || '';
    document.getElementById('turn-pass').value = localStorage.getItem('teamsync_turn_pass') || '';
  });

  document.getElementById('founder-settings').addEventListener('click', () => {
    document.getElementById('founder-settings-modal').classList.remove('hidden');
    document.getElementById('founder-friends-only').checked = state.friendsOnlyMode || false;
    document.getElementById('founder-sfw-mode').checked = state.sfwMode || false;
    document.getElementById('founder-game-mode').checked = state.gameMode || false;
    
    // Populate Player List
    const listEl = document.getElementById('founder-player-list');
    listEl.innerHTML = '';
    
    const peersArray = Array.from(state.peers.values());
    if (peersArray.length === 0) {
      listEl.innerHTML = '<div class="muted" style="text-align: center; font-size: 13px;">Sunucuda kimse yok.</div>';
    } else {
      peersArray.forEach(peer => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'space-between';
        div.style.background = 'rgba(255,255,255,0.05)';
        div.style.padding = '8px 12px';
        div.style.borderRadius = '6px';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = peer.name || 'Bilinmeyen';
        nameSpan.style.fontWeight = '500';
        
        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '8px';
        
        const muteBtn = document.createElement('button');
        muteBtn.className = 'btn-sec btn-sm';
        muteBtn.textContent = '🔇 Sustur';
        muteBtn.style.padding = '4px 8px';
        muteBtn.style.fontSize = '12px';
        muteBtn.onclick = () => {
          if (state.globalMqtt && state.room) {
            state.globalMqtt.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({ type: 'force_mute', targetId: peer.id }));
            showToast(`${peer.name} susturuldu.`, 'info');
          }
        };
        
        const kickBtn = document.createElement('button');
        kickBtn.className = 'btn-sec btn-sm';
        kickBtn.textContent = '👢 At';
        kickBtn.style.padding = '4px 8px';
        kickBtn.style.fontSize = '12px';
        kickBtn.style.color = 'var(--danger)';
        kickBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        kickBtn.onclick = () => {
          if (state.globalMqtt && state.room) {
            state.globalMqtt.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({ type: 'kick_peer', targetId: peer.id }));
            showToast(`${peer.name} atıldı.`, 'info');
          }
        };
        
        actionsDiv.appendChild(muteBtn);
        actionsDiv.appendChild(kickBtn);
        div.appendChild(nameSpan);
        div.appendChild(actionsDiv);
        listEl.appendChild(div);
      });
    }
  });

  document.getElementById('founder-settings-close').addEventListener('click', () => {
    document.getElementById('founder-settings-modal').classList.add('hidden');
  });

  document.getElementById('founder-friends-only').addEventListener('change', (e) => {
    state.friendsOnlyMode = e.target.checked;
    if (state.globalMqtt && state.room) {
      state.globalMqtt.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({ type: 'founder_settings_update', friendsOnlyMode: state.friendsOnlyMode }));
    }
    showToast(state.friendsOnlyMode ? 'Sadece arkadaşlar modu aktif!' : 'Sadece arkadaşlar modu kapatıldı.', 'info');
  });

  document.getElementById('founder-sfw-mode').addEventListener('change', (e) => {
    state.sfwMode = e.target.checked;
    if (state.sfwMode) loadAIFilter();
    if (state.globalMqtt && state.room) {
      state.globalMqtt.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({ type: 'founder_settings_update', sfwMode: state.sfwMode }));
    }
    showToast(state.sfwMode ? 'Yapay Zeka Koruması aktif!' : 'Yapay Zeka Koruması kapatıldı.', 'info');
  });
  
  document.getElementById('founder-game-mode').addEventListener('change', (e) => {
    state.gameMode = e.target.checked;
    if (state.globalMqtt && state.room) {
      state.globalMqtt.publish(`teamsync/room/${state.room}/broadcast`, JSON.stringify({ type: 'founder_settings_update', gameMode: state.gameMode }));
    }
    showToast(state.gameMode ? 'Oyun Modu aktif (15FPS/Düşük İşlemci)!' : 'Oyun Modu kapatıldı.', 'info');
  });
  
  document.getElementById('settings-save').addEventListener('click', () => {
    localStorage.setItem('teamsync_turn_url', document.getElementById('turn-url').value.trim());
    localStorage.setItem('teamsync_turn_user', document.getElementById('turn-user').value.trim());
    localStorage.setItem('teamsync_turn_pass', document.getElementById('turn-pass').value.trim());
    showToast('Ayarlar kaydedildi!', 'ok');
    document.getElementById('settings-modal').classList.add('hidden');
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
    broadcast({ type: 'lobby-sync-request' });
    updateActivityCounts();
    document.getElementById('activities-modal').classList.remove('hidden');
  });
  document.getElementById('act-close').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
  });
  
  document.getElementById('focus-lock-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    state.focusLocked = !state.focusLocked;
    const btn = document.getElementById('focus-lock-btn');
    btn.innerHTML = state.focusLocked ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>' : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
    btn.style.background = state.focusLocked ? 'rgba(220, 38, 38, 0.8)' : 'rgba(0,0,0,0.6)';
    btn.style.borderColor = state.focusLocked ? 'rgba(239, 68, 68, 1)' : 'rgba(255,255,255,0.2)';
    showToast(state.focusLocked ? 'Odak Kilitlendi' : 'Odak Kilidi Açıldı', 'info');
  });

  document.getElementById('focus-fullscreen-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const focusArea = document.getElementById('focus-area');
    if (!document.fullscreenElement) {
      if (focusArea.requestFullscreen) {
        await focusArea.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  });
  
  initActivitiesUI();
}

function setMicEnabled(enabled) {
  if (enabled && state.serverMuted) {
    enabled = false;
  }
  state.micEnabled = enabled;
  if (state.localStream) {
    state.localStream.getAudioTracks().forEach(t => t.enabled = enabled);
  }
  if (state.rawMicStream) {
    state.rawMicStream.getAudioTracks().forEach(t => t.enabled = enabled);
  }
  const micBtn = document.getElementById('mic');
  micBtn.classList.toggle('off', !enabled);
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
    if (window.electronAPI && window.electronAPI.setScreenShareSource) {
      window.electronAPI.setScreenShareSource(sourceId);
    }
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({
      audio: shareAudio,
      video: { frameRate: state.gameMode ? 15 : (consts.frameRate.ideal || 30) }
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
      a.download = `record-${Date.now()}.webm`;
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
  if (state.activeLobbyId) {
    msg.lobbyId = state.activeLobbyId;
  }
  if (!msg._mid) {
    msg._mid = crypto.randomUUID();
  }
  if (mqttClient && mqttClient.connected && state.room) {
    try {
      mqttClient.publish(`teamsync/room/${state.room}/private/${peerId}`, JSON.stringify({
        type: 'room-private',
        id: state.myId,
        target: peerId,
        payload: msg
      }));
    } catch (e) {
      console.warn('MQTT unicast failed:', e);
    }
  }

  const peer = state.peers.get(peerId);
  if (peer && peer.dc && peer.dc.readyState === 'open') {
    try {
      console.log('📤 DC Private gönderiliyor:', peerId, msg.type, msg);
      peer.dc.send(JSON.stringify(msg));
    } catch (e) {
      console.warn('Private WebRTC send error to', peerId, e);
    }
  }
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

function closeAllCards(leaveLobby = false, except = null) {
  if (leaveLobby) {
    leaveActiveLobby();
  }
  
  if (document.activeElement) {
    try { document.activeElement.blur(); } catch(e){}
  }

  // Odak modunu sıfırla ki boş kalıp UI'ı bloke etmesin
  state.focusLocked = false;

  ['wb-card', 'wt-card', 'sb-card', 'uno-card', 'poll-card', 'lvs-card', 'wheel-card', 'poke-card'].forEach(id => {
    if (id === except) return;
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
    if (focusedCard && focusedCard.id === id) {
      toggleFocus(focusedCard);
    }
  });

  // Eğer her şey kapanıyorsa (except yoksa), odak alanını kesin gizle
  if (!except) {
    document.querySelector('.main').classList.remove('focus-mode');
    document.getElementById('focus-area').classList.add('hidden');
    document.getElementById('focus-lock-btn').classList.add('hidden');
    document.getElementById('focus-fullscreen-btn').classList.add('hidden');
    focusedCard = null;
  }

  if (state.wt && except !== 'wt-card') {
    if (state.wt.player && state.wt.player.stopVideo) {
      try { state.wt.player.stopVideo(); } catch(e){}
    }
    state.wt.joinedActivity = false;
  }
  if (state.sb && except !== 'sb-card') {
    state.sb.joinedActivity = false;
    const sbWebview = document.getElementById('sb-webview');
    if (sbWebview) sbWebview.src = 'https://duckduckgo.com'; // Her zaman duckduckgo kalacak
  }
  if (state.uno && except !== 'uno-card') {
    state.uno.joinedActivity = false;
    state.uno.host = null;
    state.uno.players.clear();
    state.uno.started = false;
    const lobby = document.getElementById('uno-lobby');
    if (lobby) lobby.classList.remove('hidden');
    const ugame = document.getElementById('uno-game');
    if (ugame) ugame.classList.add('hidden');
  }

  if (window.pokeState && except !== 'poke-card') {
    window.pokeState = { p1: null, p2: null, spectators: [], round: 0, status: 'waiting' };
    const pLobby = document.getElementById('poke-lobby-view');
    if (pLobby) pLobby.classList.remove('hidden');
    const pGame = document.getElementById('poke-battle-view');
    if (pGame) pGame.classList.add('hidden');
  }

  const empty = document.getElementById('empty-state');
  if (empty) empty.classList.add('hidden');
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
  if (state.localStream) if (state.localStream) state.localStream.getTracks().forEach(t => t.stop());
  const tb = document.querySelector('.top-bar'); if(tb) tb.style.display = 'none';
  if (state.screenStream) state.screenStream.getTracks().forEach(t => t.stop());
  if (state.processedStream) state.processedStream.getTracks().forEach(t => t.stop());
  if (state.audioCtx && state.audioCtx.state !== 'closed') state.audioCtx.close();
  if (state.gateAudioCtx && state.gateAudioCtx.state !== 'closed') state.gateAudioCtx.close();
  if (state.remoteAudioCtx && state.remoteAudioCtx.state !== 'closed') {
    try { state.remoteAudioCtx.close(); } catch(e) {}
  }
  
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
    if (el.id !== 'wb-card') el.classList.add('hidden');
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

  const activePeers = Array.from(state.peers.values()).filter(p => p.dc && p.dc.readyState === 'open');
  
  if (activePeers.length > 0) {
    // Send via WebRTC Data Channels
    const metaMsg = JSON.stringify({ type: 'file-meta', id: fileId, name: file.name, size: file.size, mime: file.type });
    activePeers.forEach(peer => {
      try { peer.dc.send(metaMsg); } catch(e) {}
    });

    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const chunk = new Uint8Array(await slice.arrayBuffer());
      const header = new TextEncoder().encode(JSON.stringify({ id: fileId }) + '|');
      const msgBuf = new Uint8Array(header.length + chunk.length);
      msgBuf.set(header);
      msgBuf.set(chunk, header.length);

      for (const peer of activePeers) {
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

    const doneMsg = JSON.stringify({ type: 'file-done', id: fileId });
    activePeers.forEach(peer => {
      try { peer.dc.send(doneMsg); } catch(e) {}
    });
  } else if (mqttClient && mqttClient.connected && state.room) {
    // Fallback to MQTT (safe for small files, warning printed for larger files)
    if (file.size > 2 * 1024 * 1024) {
      showToast("Büyük dosyaları MQTT üzerinden göndermek yavaştır ve kopabilir. WebRTC bağlantısı kurulmasını bekleyin.", "warn");
    }
    broadcast({ type: 'file-meta', id: fileId, name: file.name, size: file.size, mime: file.type });

    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const chunk = new Uint8Array(await slice.arrayBuffer());
      const header = new TextEncoder().encode(JSON.stringify({ id: fileId }) + '|');
      const msgBuf = new Uint8Array(header.length + chunk.length);
      msgBuf.set(header);
      msgBuf.set(chunk, header.length);

      try {
        mqttClient.publish(`teamsync/room/${state.room}/file`, msgBuf);
      } catch (e) {
        console.warn('MQTT file send failed:', e);
      }
      
      offset += chunk.length;
      const prog = document.getElementById(`prog-${fileId}`);
      if (prog) prog.style.width = (offset / file.size * 100) + '%';
      
      await new Promise(r => setTimeout(r, 15)); // avoid flooding
    }
    broadcast({ type: 'file-done', id: fileId });
  }

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



function initActivitiesUI() {
  if (typeof initWhiteboard === 'function') initWhiteboard();
  if (typeof initWatchTogether === 'function') initWatchTogether();
  if (typeof initSharedBrowser === 'function') initSharedBrowser();
  if (typeof initUno === 'function') initUno();
  if (typeof initLuckyWheel === 'function') initLuckyWheel();
  if (typeof initPoke === 'function') initPoke();
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
    let contentHtml = escapeHtml(m.content || '');
    
    if (m.isCensored) {
       contentHtml = `<span style="color: #f87171; font-style: italic; font-weight: 500; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.2); display: inline-flex; align-items: center; gap: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg> Sansürlendi</span>`;
    } else if (m.type === 'image') {
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

window.sendDMText = async (text) => {
  if (!state.activeDM || !text.trim() || !state.globalMqtt || !state.globalMqtt.connected) return;
  const friendId = state.activeDM;
  
  const res = await checkTextWithAI(text);
  let textToSend = text;
  let isCensored = false;

  if (!res.ok) {
     showToast(res.warning, 'danger');
     textToSend = '';
     isCensored = true;
  }
  
  // Local store
  if (!state.dms[friendId]) state.dms[friendId] = [];
  state.dms[friendId].push({ sender: 'me', type: 'text', content: textToSend, isCensored: isCensored, timestamp: Date.now() });
  saveDMs();
  renderDMs();
  
  // MQTT send
  state.globalMqtt.publish(`teamsync/user/${friendId}/events`, JSON.stringify({
    type: 'dm_msg',
    fromId: state.myId,
    msgType: 'text',
    content: textToSend,
    isCensored: isCensored
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
      fromId: state.myId,
      fileId: fileId,
      msgType: msgType,
      fileName: file.name,
      totalChunks: totalChunks
    }));
    
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64Data.substr(i * CHUNK_SIZE, CHUNK_SIZE);
      state.globalMqtt.publish(`teamsync/user/${friendId}/events`, JSON.stringify({
        type: 'dm_file_chunk',
        fromId: state.myId,
        fileId: fileId,
        chunkIndex: i,
        data: chunk
      }));
    }
  };
  reader.readAsDataURL(file);
};

state.incomingDMFiles = {};

window.receiveDM = async (fromId, data) => {
  if (!state.dms[fromId]) state.dms[fromId] = [];
  
  if (data.type === 'dm_msg') {
    let isCensored = data.isCensored || false;
    if (!isCensored && data.content) {
       const res = await checkTextWithAI(data.content);
       if (!res.ok) isCensored = true;
    }
    
    state.dms[fromId].push({ sender: 'them', type: data.msgType, content: data.content, isCensored: isCensored, timestamp: Date.now() });
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
  
  // Custom Titlebar Events
  addEvt('tb-min', 'click', () => window.electronAPI && window.electronAPI.windowMin());
  addEvt('tb-max', 'click', () => window.electronAPI && window.electronAPI.windowMax());
  addEvt('tb-close', 'click', () => window.electronAPI && window.electronAPI.windowClose());
  addEvt('tb-forcequit', 'click', () => window.electronAPI && window.electronAPI.appQuitForce());

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
      img.onload = async () => {
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
        
        if (state.sfwMode && state.aiModel) {
          const checked = await checkAvatar(dataUrl);
          if (!checked) {
             showToast("Üzgünüm, belirlediğim güvenlik protokolleri gereği bu tür içerikler (küfür, argo veya +18) oluşturamıyorum. Daha nazik veya farklı bir konuda yardımcı olabilirim.", "danger");
             return;
          }
        }
        
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

  window.addEventListener('click', () => {
    if (state.sfxAudioCtx && state.sfxAudioCtx.state === 'suspended') {
      state.sfxAudioCtx.resume().catch(() => {});
    }
    if (state.remoteAudioCtx && state.remoteAudioCtx.state === 'suspended') {
      state.remoteAudioCtx.resume().then(() => console.log('🔊 Remote AudioContext resumed via user click.'));
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
    if (state.gateAudioCtx && state.gateAudioCtx.state === 'suspended') {
      state.gateAudioCtx.resume();
    }
  });

  // --- LOBBY SYSTEM UI BINDINGS ---
  const activities = ['wt', 'uno', 'sb', 'poll', 'lvs', 'wheel', 'poke'];
  activities.forEach(act => {
    const card = document.getElementById(`card-act-${act}`);
    if (card) {
      card.addEventListener('click', () => {
        state.selectedLobbyActivity = act;
        
        // Show Lobbies Panel, Hide Activities List Panel
        document.getElementById('act-list-card').classList.add('hidden');
        document.getElementById('act-lobby-card').classList.remove('hidden');
        
        // Update Title
        const names = { uno: 'UNO', sb: 'Ortak Tarayıcı', poll: 'Hızlı Anket', lvs: 'Video Oynatıcı', wheel: 'Şans Çarkı', poke: 'PokeSavaş' };
        document.getElementById('act-lobby-title').textContent = `${names[act]} Lobileri`;
        
        renderLobbiesList(act);
      });
    }

    const arrow = document.getElementById(`arrow-act-${act}`);
    if (arrow) {
      arrow.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent duplicate trigger
        state.selectedLobbyActivity = act;
        
        // Show Lobbies Panel, Hide Activities List Panel
        document.getElementById('act-list-card').classList.add('hidden');
        document.getElementById('act-lobby-card').classList.remove('hidden');
        
        // Update Title
        const names = { uno: 'UNO', sb: 'Ortak Tarayıcı', poll: 'Hızlı Anket', lvs: 'Video Oynatıcı', wheel: 'Şans Çarkı', poke: 'PokeSavaş' };
        document.getElementById('act-lobby-title').textContent = `${names[act]} Lobileri`;
        
        renderLobbiesList(act);
      });
    }
  });

  // Back Button inside Lobbies Panel
  document.getElementById('act-lobby-back').addEventListener('click', () => {
    state.selectedLobbyActivity = null;
    document.getElementById('act-lobby-card').classList.add('hidden');
    document.getElementById('act-list-card').classList.remove('hidden');
  });

  // Close Button inside Lobbies Panel
  document.getElementById('act-lobby-close').addEventListener('click', () => {
    state.selectedLobbyActivity = null;
    document.getElementById('activities-modal').classList.add('hidden');
    document.getElementById('act-lobby-card').classList.add('hidden');
    document.getElementById('act-list-card').classList.remove('hidden');
  });

  // Create New Lobby Button
  document.getElementById('btn-create-new-lobby').addEventListener('click', () => {
    const act = state.selectedLobbyActivity;
    if (!act) return;
    
    // Create new lobby
    const names = { uno: 'UNO', sb: 'Ortak Tarayıcı', poll: 'Hızlı Anket', lvs: 'Video Oynatıcı', wheel: 'Şans Çarkı', poke: 'PokeSavaş' };
    const newLobby = {
      id: `LOB-${crypto.randomUUID()}`,
      activity: act,
      name: `${state.myName}'in ${names[act]} Lobisi`,
      hostId: state.myId,
      hostName: state.myName,
      players: [{ id: state.myId, name: state.myName }],
      spectators: [],
      status: 'waiting'
    };
    
    state.lobbies.push(newLobby);
    state.activeLobbyId = newLobby.id;
    state.isLobbyHost = true;
    state.spectating = false;
    
    // Set the host in the state immediately before clicking the legacy button!
    if (act === 'uno') {
      state.uno.host = state.myId;
      state.uno.joinedActivity = true;
    } else if (act === 'wt') {
      state.wt.joinedActivity = true;
    } else if (act === 'sb') {
      state.sb.host = state.myId;
      state.sb.joinedActivity = true;
    }
    
    updateActivityCounts();
    syncLobbiesList();
    
    // Close activities modal and launch the activity
    document.getElementById('activities-modal').classList.add('hidden');
    document.getElementById('act-lobby-card').classList.add('hidden');
    document.getElementById('act-list-card').classList.remove('hidden');
    
    // Programmatically click the hidden original activity button to trigger the modular initialization
    const legacyBtn = document.getElementById(`act-${act}`);
    if (legacyBtn) legacyBtn.click();
  });
});

// --- LOBBY SYSTEM GLOBAL FUNCTIONS ---
window.updateActivityCounts = function() {
  const counts = {
    wt: { l: 0, p: 0 },
    uno: { l: 0, p: 0 },
    sb: { l: 0, p: 0 },
    poll: { l: 0, p: 0 },
    lvs: { l: 0, p: 0 },
    wheel: { l: 0, p: 0 },
    poke: { l: 0, p: 0 }
  };
  
  state.lobbies.forEach(lob => {
    if (counts[lob.activity] !== undefined) {
      counts[lob.activity].l += 1;
      counts[lob.activity].p += lob.players.length;
    }
  });

  // Update UI badges
  Object.keys(counts).forEach(act => {
    const badge = document.getElementById(`act-${act}-count`);
    if (badge) {
      const info = counts[act];
      badge.textContent = `Lobi: ${info.l} • Oyuncu: ${info.p}`;
      badge.classList.remove('hidden');
      if (info.l > 0) {
        badge.classList.add('vibrant');
      } else {
        badge.classList.remove('vibrant');
      }
    }
  });
};

window.syncLobbiesList = function() {
  broadcast({ type: 'lobby-list-sync', lobbies: state.lobbies });
};

window.renderLobbiesList = function(activity) {
  const container = document.getElementById('lobby-items-container');
  if (!container) return;
  container.innerHTML = '';

  const list = state.lobbies.filter(l => l.activity === activity);
  
  // Update stats display
  const totalLobbies = list.length;
  const totalPlayers = list.reduce((sum, lob) => sum + lob.players.length, 0);
  const statsEl = document.getElementById('act-lobby-stats');
  if (statsEl) {
    statsEl.textContent = `Aktif Lobi: ${totalLobbies} • Toplam Oyuncu: ${totalPlayers}`;
  }

  if (list.length === 0) {
    container.innerHTML = '<div class="muted" style="text-align:center; padding: 20px;">Henüz aktif lobi yok. İlk lobiyi siz oluşturun!</div>';
    return;
  }

  list.forEach(lob => {
    const row = document.createElement('div');
    row.className = 'lobby-row';
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);';
    
    const maxPlayers = lob.activity === 'uno' ? 4 : 10;
    const playerCount = lob.players.length;
    const specCount = lob.spectators.length;
    
    const infoText = `Kurucu: ${escapeHtml(lob.hostName)} • Oyuncular: ${playerCount}/${maxPlayers} ${specCount > 0 ? `(${specCount} İzleyici)` : ''}`;
    const statusText = lob.status === 'playing' ? '🎮 Devam Ediyor' : '⌛ Bekliyor';
    const statusColor = lob.status === 'playing' ? '#f59e0b' : 'var(--ok)';

    row.innerHTML = `
      <div>
        <div style="font-weight:bold; color:#fff;">${escapeHtml(lob.name)}</div>
        <div style="font-size:11px; color:var(--txt-mut); margin-top:2px;">${infoText}</div>
        <div style="font-size:10px; font-weight:bold; color:${statusColor}; margin-top:4px;">${statusText}</div>
      </div>
      <div style="display:flex; gap:8px;">
        ${lob.status === 'waiting' && playerCount < maxPlayers ? `<button class="btn-pri btn-sm join-btn" style="padding:4px 10px; font-size:12px;">Katıl</button>` : ''}
        <button class="btn-sec btn-sm spectate-btn" style="padding:4px 10px; font-size:12px;">İzle</button>
      </div>
    `;

    // Join Button handler
    const joinBtn = row.querySelector('.join-btn');
    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        joinLobby(lob.id, false);
      });
    }

    // Spectate Button handler
    const spectateBtn = row.querySelector('.spectate-btn');
    if (spectateBtn) {
      spectateBtn.addEventListener('click', () => {
        joinLobby(lob.id, true);
      });
    }

    container.appendChild(row);
  });
};

window.joinLobby = function(lobbyId, spectate = false) {
  state.activeLobbyId = lobbyId;
  state.spectating = spectate;
  
  const lob = state.lobbies.find(l => l.id === lobbyId);
  if (!lob) return;

  state.isLobbyHost = (lob.hostId === state.myId);

  // Set the host in the state immediately before clicking the legacy button!
  if (lob.activity === 'uno') {
    state.uno.host = lob.hostId;
    state.uno.joinedActivity = true;
  } else if (lob.activity === 'wt') {
    state.wt.joinedActivity = true;
  } else if (lob.activity === 'sb') {
    state.sb.host = lob.hostId;
    state.sb.joinedActivity = true;
  }

  broadcast({
    type: 'lobby-join-req',
    lobbyId,
    peerId: state.myId,
    name: state.myName,
    spectate
  });

  document.getElementById('activities-modal').classList.add('hidden');
  document.getElementById('act-lobby-card').classList.add('hidden');
  document.getElementById('act-list-card').classList.remove('hidden');

  const legacyBtn = document.getElementById(`act-${lob.activity}`);
  if (legacyBtn) legacyBtn.click();
};

window.leaveActiveLobby = function() {
  if (!state.activeLobbyId) return;
  const lobbyId = state.activeLobbyId;
  const lob = state.lobbies.find(l => l.id === lobbyId);
  
  if (lob) {
    if (lob.activity === 'uno') {
      broadcast({ type: 'uno-leave' });
    } else if (lob.activity === 'wt') {
      broadcast({ type: 'wt-leave' });
    } else if (lob.activity === 'sb') {
      broadcast({ type: 'sb-leave' });
    }
  }

  state.activeLobbyId = null;
  state.spectating = false;

  if (state.isLobbyHost) {
    state.isLobbyHost = false;
    const lobIdx = state.lobbies.findIndex(l => l.id === lobbyId);
    if (lobIdx !== -1) {
      const currentLob = state.lobbies[lobIdx];
      const nextPlayer = currentLob.players.find(p => p.id !== state.myId);
      if (nextPlayer) {
        currentLob.hostId = nextPlayer.id;
        currentLob.hostName = nextPlayer.name;
        currentLob.players = currentLob.players.filter(p => p.id !== state.myId);
        broadcastTo(nextPlayer.id, { type: 'lobby-promote-host', lobbyId });
      } else {
        state.lobbies.splice(lobIdx, 1);
      }
    }
  } else {
    if (lob) {
      broadcastTo(lob.hostId, { type: 'lobby-leave-req', lobbyId, peerId: state.myId });
    }
  }
  syncLobbiesList();
};

window.checkSpectatorUI = function() {
  const isSpec = state.spectating;
  
  // UNO
  const unoReady = document.getElementById('uno-ready-btn');
  const unoStart = document.getElementById('uno-start-btn');
  const unoMax = document.getElementById('uno-max-players');
  const unoBots = document.getElementById('uno-fill-bots');
  const unoUno = document.getElementById('uno-uno-btn');
  const unoCatch = document.getElementById('uno-catch-btn');
  const unoReplay = document.getElementById('uno-replay-btn');
  const unoDeck = document.getElementById('uno-deck');
  
  if (unoReady) unoReady.classList.toggle('hidden', isSpec);
  if (unoStart) unoStart.classList.toggle('hidden', isSpec);
  if (unoMax) unoMax.disabled = isSpec;
  if (unoBots) unoBots.disabled = isSpec;
  if (unoUno) unoUno.classList.toggle('hidden', isSpec);
  if (unoCatch) unoCatch.classList.toggle('hidden', isSpec);
  if (unoReplay) unoReplay.classList.toggle('hidden', isSpec);
  if (unoDeck) unoDeck.style.pointerEvents = isSpec ? 'none' : 'auto';
  
  // WatchTogether
  const wtUrl = document.getElementById('wt-url');
  const wtLoad = document.getElementById('wt-load');
  const wtContainer = document.getElementById('wt-player-container');
  if (wtUrl) wtUrl.disabled = isSpec;
  if (wtLoad) wtLoad.classList.toggle('hidden', isSpec);
  if (wtContainer) wtContainer.style.pointerEvents = isSpec ? 'none' : 'auto';
  
  // Shared Browser
  const sbOverlay = document.getElementById('sb-overlay');
  const sbUrl = document.getElementById('sb-url');
  const sbGo = document.getElementById('sb-go');
  const sbBack = document.getElementById('sb-back');
  const sbForward = document.getElementById('sb-forward');
  const sbRefresh = document.getElementById('sb-refresh');
  
  if (sbOverlay) sbOverlay.style.display = isSpec ? 'block' : 'none';
  if (sbUrl) sbUrl.disabled = isSpec;
  if (sbGo) sbGo.classList.toggle('hidden', isSpec);
  if (sbBack) sbBack.classList.toggle('hidden', isSpec);
  if (sbForward) sbForward.classList.toggle('hidden', isSpec);
  if (sbRefresh) sbRefresh.classList.toggle('hidden', isSpec);
  
  // Poll
  const pollSetup = document.getElementById('poll-setup');
  const pollEnd = document.getElementById('poll-end');
  if (pollSetup && isSpec) pollSetup.classList.add('hidden');
  if (pollEnd) pollEnd.classList.toggle('hidden', isSpec);
  const pollContainer = document.getElementById('poll-opts-container');
  if (pollContainer) pollContainer.style.pointerEvents = isSpec ? 'none' : 'auto';
  
  // Lucky Wheel
  const wheelSetup = document.getElementById('wheel-setup');
  const wheelSpin = document.getElementById('wheel-spin-btn');
  const wheelReset = document.getElementById('wheel-reset-btn');
  if (wheelSetup && isSpec) wheelSetup.classList.add('hidden');
  if (wheelSpin) wheelSpin.classList.toggle('hidden', isSpec);
  if (wheelReset) wheelReset.classList.toggle('hidden', isSpec);
  
  // Yerel Film (LVS)
  const lvsFile = document.getElementById('lvs-file');
  const lvsLoad = document.getElementById('lvs-load');
  const lvsPlayer = document.getElementById('lvs-player');
  if (lvsFile) lvsFile.classList.toggle('hidden', isSpec);
  if (lvsLoad) lvsLoad.classList.toggle('hidden', isSpec);
  if (lvsPlayer) {
    lvsPlayer.style.pointerEvents = isSpec ? 'none' : 'auto';
    if (isSpec) {
      lvsPlayer.removeAttribute('controls');
    } else {
      lvsPlayer.setAttribute('controls', 'true');
    }
  }
};

// Enforce spectator locks continuously
setInterval(window.checkSpectatorUI, 300);


