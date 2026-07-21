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
// Sohbette paylaşılan dosyaların blob URL'leri: revoke edilmezse dosyanın
// tüm içeriği uygulama kapanana kadar bellekte kalır (sohbet DOM'u
// temizlense bile). Odadan çıkarken topluca serbest bırakılır.
const chatBlobUrls = [];
function releaseChatBlobUrls() {
  chatBlobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  chatBlobUrls.length = 0;
}

// Bir dosyanın görsel olup olmadığını sağlam biçimde belirler.
// Bazı görseller boş/yanlış MIME ile gelir (panodan yapıştırma, uzantısız
// gönderim, application/octet-stream). Sadece MIME'a bakınca bunlar "dosya"
// sayılıp MOR .text-dl (yuvarlak kare) butonuyla gösteriliyordu; yuvarlak cam
// .dl-btn yerine. Bu yüzden MIME yetersizse dosya adı uzantısına da bakarız.
function isImageFile(name, mime) {
  if (mime && mime.toLowerCase().startsWith('image/')) return true;
  return /\.(png|jpe?g|jfif|gif|webp|bmp|avif|svg|ico|heic|heif|tiff?)$/i.test(name || '');
}

let mqttClient = null;
let internetAnnounceInterval = null;

// Sinyalleşme yalnızca tek bir genel broker'a bağlıydı; o broker down,
// hız-sınırlı veya (kurumsal/ülke) engelli olduğunda hiçbir odaya girilemiyor
// ve reconnectPeriod sonsuza dek aynı ölü broker'ı zorluyordu. Artık sıralı bir
// yedek listesi var: aktif broker üst üste birkaç denemede yanıt vermezse
// otomatik olarak sıradakine geçilir. Tüm eşler AYNI deterministik sırayı
// denediği için tam bir kesintide hepsi aynı yedek broker'da yeniden buluşur.
const SIGNALING_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt'
];
// Her yeni oturum (oda katılımı) bayat istemci geri çağrılarını ve bekleyen
// broker rotasyonlarını geçersiz kılmak için bu kimliği artırır.
let mqttSessionId = 0;

function setupInternetSignaling(roomId, myId, myName) {
  if (mqttClient) { try { mqttClient.end(true); } catch (e) {} }
  const session = ++mqttSessionId;
  let brokerIndex = 0;
  let reconnectAttempts = 0;

  const connectBroker = (idx) => {
    if (session !== mqttSessionId) return; // oturum kapandı ya da yenilendi
    brokerIndex = idx % SIGNALING_BROKERS.length;
    const brokerUrl = SIGNALING_BROKERS[brokerIndex];
    console.log(`🌐 Sinyalleşme broker'ı deneniyor (${brokerIndex + 1}/${SIGNALING_BROKERS.length}): ${brokerUrl}`);

    const client = mqtt.connect(brokerUrl, {
      clientId: 'sig-' + myId + '-' + Math.random().toString(16).slice(2, 8),
      keepalive: 60,
      reconnectPeriod: 1000,
      connectTimeout: 6000
    });
    mqttClient = client;
    reconnectAttempts = 0;

    // Aktif broker birkaç kez üst üste bağlanamazsa sıradakine geç. mqtt.js her
    // yeniden deneme öncesi 'reconnect' yayar; art arda 3 deneme (~ilk timeout +
    // 3sn) başarısız olursa bu broker'ı ölü sayıp döndürüyoruz.
    const rotate = () => {
      if (session !== mqttSessionId || mqttClient !== client) return;
      console.warn(`⚠️ Broker yanıt vermiyor (${brokerUrl}), sıradaki broker'a geçiliyor...`);
      try { client.end(true); } catch (e) {}
      connectBroker(brokerIndex + 1);
    };

    client.on('reconnect', () => {
      if (mqttClient !== client) return;
      reconnectAttempts++;
      if (reconnectAttempts >= 3) rotate();
    });

    client.on('error', (err) => {
      if (mqttClient !== client) return;
      console.error('MQTT signaling connection error:', err && err.message ? err.message : err);
    });

    client.on('connect', () => {
      if (mqttClient !== client) return; // bayat istemci geri çağrısı yok sayılır
      reconnectAttempts = 0;
    console.log('🌐 İnternet sunucusuna bağlanıldı (MQTT)');
    mqttClient.subscribe(`teamsync/room/${roomId}/#`);
    
    if (internetAnnounceInterval) clearInterval(internetAnnounceInterval);
    internetAnnounceInterval = setInterval(() => {
      if (mqttClient && mqttClient.connected) {
        mqttClient.publish(`teamsync/room/${roomId}/${myId}`, JSON.stringify({
          type: 'hello',
          id: myId,
          name: myName,
          avatar: state.myAvatar || null,
          isRoomFounder: state.isRoomFounder,
          isModerator: state.moderators.has(myId),
          sfwMode: state.sfwMode,
          turn: getShareableTurn(),
          // Yalnızca kurucu otoritesi taşınır: oda adı ve güncel yetkili
          // listesi kurucunun periyodik hello'suyla tüm katılımcılara (geç
          // katılanlar dahil) her 3 saniyede bir yayılır.
          roomName: state.isRoomFounder ? state.roomName : undefined,
          moderators: state.isRoomFounder ? Array.from(state.moderators) : undefined,
          // Geç katılanların da öğrenmesi için kurucu otoritesiyle taşınan diğer
          // sunucu durumu: yasak listesi, susturulanlar ve ses bit hızı.
          bannedIds: state.isRoomFounder ? Array.from(state.bannedIds || []) : undefined,
          serverMutedIds: state.isRoomFounder ? Array.from(state.serverMutedIds || []) : undefined,
          audioBitrate: state.isRoomFounder ? getAudioBitrate() : undefined,
          noiseSuppressionEnabled: state.isRoomFounder ? !!state.useAI : undefined
        }));
      }
    }, 3000);

    // Broadcast a lobby-sync-request to get active lobbies from other players immediately!
    setTimeout(() => {
      broadcast({ type: 'lobby-sync-request' });
    }, 1000);
  });

    client.on('message', async (topic, message) => {
    if (mqttClient !== client) return; // bayat broker'dan gelen mesajları yut
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
        if (data.isRoomFounder) {
          // Kurucunun otoritesi: oda adı ve yetkili listesi her hello'da
          // senkronize edilir — geç katılanlar da en geç 3 saniyede öğrenir.
          state.founderId = data.id;
          if (!state.isRoomFounder && data.roomName && state.roomName !== data.roomName) {
            state.roomName = data.roomName;
            const titleEl = document.getElementById('room-title');
            if (titleEl) titleEl.textContent = '# ' + data.roomName + (state.cryptoKey ? ' 🔒' : '');
          }
          if (Array.isArray(data.moderators)) {
            const incoming = new Set(data.moderators);
            const changed = incoming.size !== state.moderators.size || [...incoming].some(id => !state.moderators.has(id));
            if (changed) {
              const affected = new Set([...incoming, ...state.moderators]);
              state.moderators = incoming;
              affected.forEach(id => refreshUserRoleBadge(id));
              if (state.myId && affected.has(state.myId)) updateFounderMenuVisibility();
            }
          }
          // Yasak listesi (item 3) ve susturulanlar (item 5): kurucu otoritesiyle
          // eşitlenir. Yasaklıysam anında düşürülürüm.
          if (Array.isArray(data.bannedIds)) {
            state.bannedIds = new Set(data.bannedIds);
            if (state.bannedIds.has(state.myId)) {
              disconnectApp();
              document.getElementById('error-text').textContent = "Bu sunucudan kalıcı olarak yasaklandınız.";
              document.getElementById('error-modal').classList.remove('hidden');
            }
          }
          if (Array.isArray(data.serverMutedIds)) {
            state.serverMutedIds = new Set(data.serverMutedIds);
            const iAmMuted = state.serverMutedIds.has(state.myId);
            // Kurucu susturması değiştiyse efektif durumu güncelle; kendi
            // tercihim (selfMicOn) korunur, susturma kalkınca geri uygulanır.
            if (iAmMuted !== !!state.serverMuted) {
              state.serverMuted = iAmMuted;
              applyMicState();
            }
          }
          // Ses bit hızı (item 7): kurucu değeriyle eşitlenir ve uygulanır.
          if (typeof data.audioBitrate === 'number' && data.audioBitrate !== state.audioBitrate) {
            state.audioBitrate = data.audioBitrate;
            applyAudioBitrateToPeers();
          }
          // Kurucunun RNNoise tercihi oda durumunun parçasıdır. Periyodik hello
          // sayesinde sonradan katılanlar da kendi giriş ekranı tercihlerinden
          // bağımsız olarak sunucunun güncel ayarını alır.
          if (!state.isRoomFounder
              && typeof data.noiseSuppressionEnabled === 'boolean'
              && data.noiseSuppressionEnabled !== state.useAI) {
            await applyRoomNoiseSuppression(data.noiseSuppressionEnabled);
          }
        }
        applySharedTurn(data.turn);
        handlePeerDiscovered({ id: data.id, name: data.name, ip: 'internet', avatar: data.avatar, isFounder: data.isRoomFounder, isModerator: data.isModerator });
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
  };

  connectBroker(0);
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
  // KRİTİK: Aynı sinyal iki kanaldan (UDP + MQTT) neredeyse aynı anda
  // gelebilir. handleSignal async olduğu için iki işleme iç içe girip
  // signalingState'i bozuyor ve answer üretimi InvalidStateError ile
  // çöküyordu. Sinyalleri peer başına SIRAYLA işliyoruz.
  peer.signalChain = (peer.signalChain || Promise.resolve())
    .then(() => processSignal(id, ip, signal))
    .catch(e => console.error('Signal chain error:', e && e.message ? e.message : e));
  return peer.signalChain;
}

// Teredo (2001:0::/32), link-local (fe80::) ve loopback ICE adayları hem
// gönderilirken hem alınırken elenir. Bunlar iki eş arasında gerçek bir yol
// oluşturamaz ama iki ciddi zarar veriyorlar:
//  - TURN CreatePermission bu adreslere izin isteyince sunucu hata (saha
//    loglarında code=600) dönebiliyor ve Chromium hatada TÜM TURN bağlantısını
//    buduyor ("pruned connection") — tek bir çöp aday, WARP altında tek
//    çalışan yol olan kendi relay tahsisimizi öldürüyor (TURN üzerinden
//    inen veri kendi açtığımız soketten geldiği için VPN'in bozduğu
//    dışarıdan-içeri yönünden etkilenmeyen TEK yol relay'dir);
//  - ICE kontrol matrisini şişirip kurulumUu yavaşlatıyorlar (kullanıcıda
//    Radmin/WSL/Teredo gibi bir sürü sanal arayüz var).
function isJunkIceCandidate(cand) {
  const line = ((cand && cand.candidate) || '').toLowerCase();
  if (!line) return false;
  const addr = line.split(' ')[4] || '';
  if (addr.startsWith('127.') || addr === '::1') return true;       // loopback
  if (addr.startsWith('fe80:')) return true;                        // link-local
  if (addr.startsWith('2001:0:') || addr.startsWith('2001:0000:')) return true; // Teredo
  return false;
}

async function processSignal(id, ip, signal) {
  const peer = state.peers.get(id);
  if (!peer || !peer.pc) return;
  peer.lastSeen = Date.now();
  if (!peer.ip) peer.ip = ip;
  if (!peer.iceQueue) peer.iceQueue = [];

  console.log(`📨 Signal received from ${peer.name}: ${signal.type}, ip=${ip}`);

  try {
    if (signal.type === 'offer') {
      // Aynı offer'ın kopyası (iki kanaldan veya karşı tarafın tekrar denemesi):
      // yeniden uygulamak yerine mevcut cevabı (answer) TEKRAR GÖNDER.
      // Karşı taraf ilk cevabı kaçırmış olabilir (MQTT aboneliği geç kuruldu,
      // paket düştü vs.) — sadece atlamak kalıcı kilitlenme yaratıyor.
      if (peer.pc.signalingState === 'stable' && peer.pc.remoteDescription &&
          peer.pc.remoteDescription.sdp === signal.sdp.sdp) {
        if (peer.pc.localDescription && peer.pc.localDescription.type === 'answer') {
          console.log('Duplicate offer: mevcut answer + adaylar tekrar gönderiliyor.');
          sendSignalToPeer(id, { type: 'answer', sdp: peer.pc.localDescription });
          (peer.localCandidates || []).forEach(c => sendSignalToPeer(id, { type: 'ice', candidate: c }));
        }
        return;
      }
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
      sendSignalToPeer(id, { type: 'answer', sdp: answer });
      // Process queued candidates
      while (peer.iceQueue.length) {
        await peer.pc.addIceCandidate(peer.iceQueue.shift());
      }
    } else if (signal.type === 'restart-req') {
      // Initiator olmayan taraf bağlantı kopukluğu fark etti; offer'ı biz üretiriz.
      if (peer.isInitiator) attemptIceRestart(id);
    } else if (signal.type === 'answer') {
      if (peer.pc.signalingState === 'have-local-offer') {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        // Process queued candidates
        while (peer.iceQueue.length) {
          await peer.pc.addIceCandidate(peer.iceQueue.shift());
        }
      } else {
        console.warn('Received answer but signaling state is:', peer.pc.signalingState, '(muhtemelen çift kanal kopyası, atlandı)');
      }
    } else if (signal.type === 'ice') {
      if (signal.candidate) {
        // Skip null end-of-candidate marker to prevent RTCIceCandidate construction errors
        if (signal.candidate.sdpMid === null && signal.candidate.sdpMLineIndex === null && !signal.candidate.candidate) {
          return;
        }
        if (isJunkIceCandidate(signal.candidate)) return; // çöp aday (teredo/loopback/link-local)
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
    console.error('Signal handle error:', e && e.message ? e.message : e, '(signal:', signal.type + ', state:', peer.pc.signalingState + ')');
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
    // 'block' varsayılan SVG'yi sol üste yapıştırıyordu — .profile-avatar'ın
    // flex ortalaması ancak display:flex ile korunur
    document.getElementById('my-avatar-default').style.display = 'flex';
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
  if (window.syncActiveDeviceAccount) window.syncActiveDeviceAccount();
  renderFriends();

  if (supabaseClient) {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) {
        await supabaseClient.from('profiles').update({
          name: state.myName,
          avatar: state.myAvatar,
          friends: state.friends,
          requests: state.friendRequests,
          updated_at: new Date().toISOString()
        }).eq('id', session.user.id);
      }
    } catch (e) {
      console.error("Supabase profile sync error:", e);
    }
  }
}

// Profil fotoğrafını Supabase Storage'daki "avatars" bucket'ına yükler ve
// herkesin erişebileceği kalıcı bir public URL döner. Yükleme başarısız olursa
// null döner; çağıran taraf base64'e geri düşebilir.
async function uploadAvatarToStorage(blob) {
  if (!supabaseClient || !blob) return null;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;
    const path = `${session.user.id}.jpg`;
    const { error } = await supabaseClient.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
    if (error) throw error;
    const { data } = supabaseClient.storage.from('avatars').getPublicUrl(path);
    // Aynı yol üzerine yazıldığı için <img> önbelleğini kırmak üzere zaman damgası ekliyoruz.
    return `${data.publicUrl}?t=${Date.now()}`;
  } catch (e) {
    console.error('Avatar Supabase Storage yükleme hatası:', e);
    return null;
  }
}

function loadDMs() {
  const savedDMs = localStorage.getItem('teamsync_dms');
  if (savedDMs) {
    try { state.dms = JSON.parse(savedDMs); } catch(e) {}
  }
}

function saveDMs() {
  // DM geçmişi (base64 dosya içerikleriyle birlikte) sınırsız büyüyordu:
  // hem bellekte hem localStorage'da (~10MB kota). Arkadaş başına son 100
  // mesaj tutulur; kota yine dolarsa en eski dosya/görsel içerikleri
  // düşürülür (metin mesajlarına dokunulmaz).
  const DM_LIMIT = 100;
  Object.keys(state.dms).forEach(fId => {
    if (Array.isArray(state.dms[fId]) && state.dms[fId].length > DM_LIMIT) {
      state.dms[fId] = state.dms[fId].slice(-DM_LIMIT);
    }
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      localStorage.setItem('teamsync_dms', JSON.stringify(state.dms));
      return;
    } catch (e) {
      const fileMsgs = [];
      Object.values(state.dms).forEach(list => (list || []).forEach(m => {
        if ((m.type === 'image' || m.type === 'file') && m.content) fileMsgs.push(m);
      }));
      if (fileMsgs.length === 0) {
        console.warn('DM geçmişi kaydedilemedi (kota):', e && e.message);
        return;
      }
      fileMsgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      fileMsgs.slice(0, Math.max(1, Math.ceil(fileMsgs.length / 2))).forEach(m => {
        m.content = '';
        m.expired = true;
      });
    }
  }
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
        <div class="friend-info" onclick="showFriendProfile('${fId}')" style="cursor:pointer;" title="Profili Görüntüle">
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

window.showFriendProfile = (fId) => {
  const f = state.friends[fId];
  if (!f) return;
  const badges = [];
  if (f.room) badges.push({ text: '🟢 Sunucuda', color: '#10b981' });
  else if (f.online) badges.push({ text: '🟢 Çevrimiçi', color: '#10b981' });
  else badges.push({ text: '⚪ Çevrimdışı', color: '#94a3b8' });

  window.showProfileModal({
    name: f.name,
    avatar: f.avatar,
    idLabel: `ID: ${fId}`,
    badges,
    actions: [
      { label: '💬 Mesaj Gönder', onClick: () => openDM(fId) },
      { label: '❌ Arkadaşlıktan Çıkar', danger: true, onClick: () => window.removeFriend(fId) }
    ]
  });
};

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

// Arkadaş listesinde ve oda içindeki kullanıcı listesinde ortak kullanılan
// profil kartı. Kimlik uzayı (arkadaş kodu vs. oda oturum id'si) çağrı
// yerine göre değiştiği için rozet/aksiyon listesi çağıran tarafından
// verilir; modal yalnızca gösterimden sorumludur.
window.showProfileModal = ({ name, avatar, idLabel, badges = [], actions = [] }) => {
  let modal = document.getElementById('profile-view-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'profile-view-modal';
    modal.className = 'hidden';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 10000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px);';
    modal.innerHTML = `
      <div class="mcard" style="background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); width: 320px; padding: 24px; text-align: center;">
        <div style="width: 84px; height: 84px; margin: 0 auto 14px; position: relative;">
          <img id="profile-view-avatar-img" style="display:none; width: 84px; height: 84px; border-radius: 50%; object-fit: cover; border: 3px solid rgba(255,255,255,0.1);" />
          <div id="profile-view-avatar-default" style="width: 84px; height: 84px; border-radius: 50%; background: rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center; font-size: 34px; border: 3px solid rgba(255,255,255,0.1);">👤</div>
        </div>
        <h3 id="profile-view-name" style="margin: 0 0 6px; font-size: 19px; color: #f8fafc; word-break: break-word;"></h3>
        <div id="profile-view-badges" style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap; margin-bottom: 8px;"></div>
        <div id="profile-view-id" class="muted" style="font-size: 12px; margin-bottom: 18px;"></div>
        <div id="profile-view-actions" style="display:flex; flex-direction:column; gap:8px;"></div>
        <button id="profile-view-close" class="btn-sec" style="width:100%; margin-top:12px; padding:10px; border-radius:8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color:white; cursor:pointer;">Kapat</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('profile-view-close').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  }

  document.getElementById('profile-view-name').textContent = name || 'Bilinmeyen';
  document.getElementById('profile-view-id').textContent = idLabel || '';

  const imgEl = document.getElementById('profile-view-avatar-img');
  const defEl = document.getElementById('profile-view-avatar-default');
  if (avatar) {
    imgEl.src = avatar;
    imgEl.style.display = 'block';
    defEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none';
    defEl.style.display = 'flex';
  }

  const badgesEl = document.getElementById('profile-view-badges');
  badgesEl.innerHTML = '';
  badges.forEach(({ text, color }) => {
    const b = document.createElement('span');
    b.textContent = text;
    b.style.cssText = `font-size: 11px; font-weight: bold; padding: 3px 9px; border-radius: 20px; background: ${color}22; color: ${color}; border: 1px solid ${color}55;`;
    badgesEl.appendChild(b);
  });

  const actionsEl = document.getElementById('profile-view-actions');
  actionsEl.innerHTML = '';
  actions.forEach(({ label, danger, onClick }) => {
    const btn = document.createElement('button');
    btn.className = danger ? 'btn-sec' : 'btn-pri';
    btn.style.cssText = danger
      ? 'padding:10px; border-radius:8px; color:#fca5a5; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); cursor:pointer;'
      : 'padding:10px; border-radius:8px; cursor:pointer;';
    btn.textContent = label;
    btn.onclick = () => { modal.classList.add('hidden'); onClick(); };
    actionsEl.appendChild(btn);
  });

  modal.classList.remove('hidden');
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

// Kendi çevrimiçi durumumu (ad, oda, avatar URL) arkadaşlara yayınlar.
function publishPresence() {
  if (state.globalMqtt && state.globalMqtt.connected) {
    state.globalMqtt.publish(`teamsync/user/${state.friendId}/presence`, JSON.stringify({
      online: true,
      id: state.friendId,
      name: state.myName,
      room: state.room || null,
      avatarHash: state.myAvatarHash || null,
      // Avatar bir Supabase URL'iyse presence ile paylaş (kısa); base64 ise
      // gönderme, eski avatarHash/req_avatar akışına bırak.
      avatar: (typeof state.myAvatar === 'string' && state.myAvatar.startsWith('http')) ? state.myAvatar : undefined
    }));
  }
}

function setupGlobalMQTT() {
  if (state.globalMqtt) return;
  const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
    clientId: 'glob-' + state.friendId + '-' + state.myId,
    keepalive: 60,
    reconnectPeriod: 1000
  });
  state.globalMqtt = client;

  client.on('error', (err) => {
    console.error('MQTT global connection error:', err);
  });

  client.on('connect', () => {
    // Hesap değiştirme yarışı: çıkışta state.globalMqtt null'lanır ama eski
    // istemcinin geciken connect'i hâlâ ateşlenebilir — artık bizim değilse kapat.
    if (state.globalMqtt !== client) {
      try { client.end(true); } catch (e) {}
      return;
    }
    console.log('🔗 Global MQTT (Arkadaşlık) bağlandı');
    client.subscribe(`teamsync/user/${state.friendId}/events`);

    // Açılışta eski oturumdan kalan "online" bayrağını sıfırla (yanlış çevrimiçi
    // göstermesin); gerçekten çevrimiçi olanlar en geç 5 sn içinde presence ile
    // yeniden işaretlenir.
    Object.keys(state.friends).forEach(fId => {
      state.friends[fId].online = false;
      client.subscribe(`teamsync/user/${fId}/presence`);
    });
    renderFriends();

    // Kendi presence'ımı hemen yayınla ki arkadaşlar beklemeden görsün.
    publishPresence();

    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(publishPresence, 5000);

    // Removed global MQTT ping logic for serverless operation
  });
  
  client.on('message', (topic, message) => {
    if (state.globalMqtt !== client) return; // eski hesabın istemcisi, yok say
    try {
      const data = JSON.parse(message.toString());
      if (topic.endsWith('/presence')) {
        if (state.friends[data.id]) {
          const wasOnline = state.friends[data.id].online;
          const oldRoom = state.friends[data.id].room;
          const oldAvatarHash = state.friends[data.id].avatarHash;
          const oldAvatar = state.friends[data.id].avatar;

          state.friends[data.id].online = true;
          state.friends[data.id].lastSeen = Date.now();
          state.friends[data.id].room = data.room;
          state.friends[data.id].avatarHash = data.avatarHash;

          // Presence bir Supabase avatar URL'i taşıyorsa doğrudan kullan;
          // base64 P2P alışverişine (req_avatar) gerek kalmaz.
          let avatarChanged = false;
          if (typeof data.avatar === 'string' && data.avatar.startsWith('http') && data.avatar !== oldAvatar) {
            state.friends[data.id].avatar = data.avatar;
            avatarChanged = true;
          } else if (data.avatarHash && oldAvatarHash !== data.avatarHash) {
            // Eski istemciler / base64 avatarlar için geri uyumluluk.
            state.globalMqtt.publish(`teamsync/user/${data.id}/events`, JSON.stringify({
              type: 'req_avatar',
              fromId: state.friendId
            }));
          }

          if (!wasOnline || oldRoom !== data.room || oldAvatarHash !== data.avatarHash || avatarChanged) {
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
            // Arkadaş listesini hemen yeniden çiz: yeni gelen profil fotoğrafı
            // uygulamayı yeniden başlatmadan görünür olsun (item 8).
            renderFriends();
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

  // Yarım kalan DM dosya transferleri: gönderen ortada çevrimdışı olursa
  // biriken base64 chunk'lar süresiz bellekte kalıyordu — 2 dk sessiz kalan
  // transfer düşürülür (aktif transferde her chunk lastChunkAt'i tazeler)
  Object.keys(state.incomingDMFiles || {}).forEach(fileId => {
    const f = state.incomingDMFiles[fileId];
    if (f && now - (f.lastChunkAt || 0) > 120000) {
      delete state.incomingDMFiles[fileId];
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
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];

  // NOT: openrelay.metered.ca (openrelayproject) servisi kapandı; ölü TURN
  // sunucuları ICE toplamayı yavaşlatıp bağlantıyı geciktirdiği için listeden
  // çıkarıldı. CGNAT/simetrik NAT arkasındaki kullanıcılar için ayarlardan
  // kendi TURN bilgilerinizi girin (ör. metered.ca / expressturn.com ücretsiz hesap).
  // TURN URL alanına https://... yazılırsa API'den otomatik çekilir (aşağıya bkz).
  if (customUrl && customUrl.startsWith('http')) {
    // API modunda gerçek sunucular refreshDynamicTurn() ile state'e yüklenir.
  } else if (customUrl && customUser && customPass) {
    // Virgülle ayrılmış birden çok URL desteklenir (aynı kullanıcı adı/şifre ile)
    customUrl.split(',').map(u => u.trim()).filter(Boolean).forEach(u => {
      servers.push({ urls: u, username: customUser, credential: customPass });
    });
  }

  // Metered API'den otomatik çekilen sunucular
  if (Array.isArray(state.dynamicTurnServers)) {
    state.dynamicTurnServers.forEach(s => { if (s && s.urls) servers.push(s); });
  }

  // Odadaki başka bir üyenin (ör. kurucunun) paylaştığı TURN bilgileri:
  // tek kişinin TURN girmesi odadaki herkesin bağlanabilmesine yeter.
  if (Array.isArray(state.sharedTurn)) {
    state.sharedTurn.forEach(s => {
      if (s && typeof s.urls === 'string' && /^turns?:/.test(s.urls)) servers.push(s);
    });
  }
  return expandTurnWithIpVariants(expandTurnFamily(servers));
}

// Yapılandırılmış her TURN ana bilgisayarı için tüm taşıma varyantlarını
// üretir: udp:80, udp:443, tcp:80, tcp:443 ve tls:443. WARP gibi VPN/tünel
// araçları bazı günler UDP'yi (CreatePermission 600), bazı günler DNS'i
// (-105) bozuyor; kullanıcının kayıtlı listesinde çoğu zaman tek taşıma
// türü var ve o tür bozulunca hiçbir çalışan yol kalmıyordu. Var olmayan
// kombinasyonlar (ör. Metered'de düz TCP:443) sadece aday üretmez, ICE
// toplamayı bloklamaz. Ardından expandTurnWithIpVariants, tcp varyantları
// dahil turn: URL'lerinin IP-literal kopyalarını ekler — böylece DNS ve UDP
// AYNI ANDA bozuk olsa bile turn:IP:80?transport=tcp yolu ayakta kalır.
function expandTurnFamily(servers) {
  const seen = new Set(servers.map(s => (s && typeof s.urls === 'string') ? s.urls : ''));
  const out = servers.slice();
  servers.forEach(s => {
    if (!s || typeof s.urls !== 'string' || !s.username || !s.credential) return;
    const p = parseTurnHost(s.urls);
    if (!p || isIpLiteral(p.host)) return;
    [
      `turn:${p.host}:80`,
      `turn:${p.host}:443`,
      `turn:${p.host}:80?transport=tcp`,
      `turn:${p.host}:443?transport=tcp`,
      `turns:${p.host}:443?transport=tcp`
    ].forEach(url => {
      if (seen.has(url)) return;
      seen.add(url);
      out.push({ urls: url, username: s.username, credential: s.credential });
    });
  });
  return out;
}

// ---- TURN DNS dayanıklılığı (WARP/VPN/DPI araçlarına karşı) ----
// Cloudflare WARP gibi araçlar yerel DNS'i bozabiliyor (socket_manager
// errorcode -105: TURN sunucu adı çözülemiyor). Bu durumda TURN hiç
// devreye giremediği için bağlantı tamamen düşüyor. Çözüm: sunucu adları
// DoH ile (IP-literal uç noktalar üzerinden, yerel DNS'e hiç dokunmadan)
// çözülüp turn: URL'lerinin IP tabanlı kopyaları listeye eklenir.
// turns: (TLS) sertifika ana bilgisayar adı doğrulaması gerektirdiğinden
// IP'ye çevrilmez; TLS yedeği zaten ad tabanlı girişte duruyor.

function getTurnIpCache() {
  try { return JSON.parse(localStorage.getItem('teamsync_turn_ip_cache') || '{}'); } catch (e) { return {}; }
}

function parseTurnHost(url) {
  const m = /^(turns?):([^:?\/]+)(:\d+)?(\?.*)?$/.exec((url || '').trim());
  if (!m) return null;
  return { scheme: m[1], host: m[2], port: m[3] || '', query: m[4] || '' };
}

function isIpLiteral(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes('[');
}

function expandTurnWithIpVariants(servers) {
  const cache = getTurnIpCache();
  const seen = new Set(servers.map(s => typeof s.urls === 'string' ? s.urls : ''));
  const out = servers.slice();
  servers.forEach(s => {
    if (!s || typeof s.urls !== 'string') return;
    const p = parseTurnHost(s.urls);
    // Sadece turn: (TLS'siz) URL'ler IP'ye çevrilebilir
    if (!p || p.scheme !== 'turn' || isIpLiteral(p.host)) return;
    const entry = cache[p.host];
    if (!entry || !Array.isArray(entry.ips)) return;
    entry.ips.slice(0, 2).forEach(ip => {
      const url = `turn:${ip}${p.port}${p.query}`;
      if (seen.has(url)) return;
      seen.add(url);
      out.push({ urls: url, username: s.username, credential: s.credential });
    });
  });
  return out;
}

// Ana bilgisayar adını yerel DNS'i atlayarak çözer. Uç noktalar IP-literal
// olduğu için bozuk yerel DNS bu isteği etkileyemez.
async function dohResolve(host) {
  const endpoints = [
    { url: `https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`, headers: { accept: 'application/dns-json' } },
    { url: `https://8.8.8.8/resolve?name=${encodeURIComponent(host)}&type=A`, headers: {} }
  ];
  // Metered gibi servislerin DNS'i her sorguda TEK (ve her seferinde farklı)
  // relay düğümü dönebiliyor; düğümlerin sağlığı da birbirinden bağımsız.
  // Tek IP'ye mahkûm kalmamak için iki uçtan da sorup benzersiz IP'leri
  // biriktiriyoruz — bozuk bir düğüme denk gelirsek diğerleri kurtarır.
  const ips = new Set();
  for (let round = 0; round < 2 && ips.size < 2; round++) {
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url, { headers: ep.headers, signal: AbortSignal.timeout(4000) });
        const data = await res.json();
        (data.Answer || [])
          .filter(a => a && a.type === 1 && /^\d{1,3}(\.\d{1,3}){3}$/.test(a.data))
          .forEach(a => ips.add(a.data));
      } catch (e) {}
      if (ips.size >= 4) break;
    }
  }
  return [...ips];
}

// Yapılandırılmış tüm TURN ana bilgisayar adlarını DoH ile çözüp önbelleğe
// yazar. Çözüm başarısız olursa eski önbellek (son bilinen IP'ler) kalır.
async function resolveTurnHostsViaDoH() {
  const hosts = new Set();
  // turns: hostları da toplanır: kullanıcı SADECE turns: girmiş olsa bile
  // expandTurnFamily o hosttan turn: (udp/tcp) varyantları üretir ve bunların
  // IP-literal kopyaları için çözülmüş IP gerekir.
  const collect = u => {
    const p = parseTurnHost(u);
    if (p && !isIpLiteral(p.host)) hosts.add(p.host);
  };
  (localStorage.getItem('teamsync_turn_url') || '').split(',').forEach(collect);
  if (Array.isArray(state.dynamicTurnServers)) state.dynamicTurnServers.forEach(s => s && collect(s.urls));
  if (Array.isArray(state.sharedTurn)) state.sharedTurn.forEach(s => s && collect(s.urls));
  if (!hosts.size) return;
  const cache = getTurnIpCache();
  let changed = false;
  for (const host of hosts) {
    const ips = await dohResolve(host);
    if (ips.length) {
      // Eski önbellekteki IP'lerle birleştir (yeniler önde): düğüm sağlığı
      // zamanla değişiyor, bilinen alternatif düğümleri elde tutmak tek
      // bozuk düğüme kilitlenmeyi önler.
      const prev = (cache[host] && Array.isArray(cache[host].ips)) ? cache[host].ips : [];
      const merged = [...new Set([...ips, ...prev])].slice(0, 4);
      cache[host] = { ips: merged, ts: Date.now() };
      changed = true;
      console.log(`🧭 TURN DoH çözümü: ${host} → ${merged.join(', ')}`);
    }
  }
  if (changed) localStorage.setItem('teamsync_turn_ip_cache', JSON.stringify(cache));
}

// TURN URL alanına bir Metered credential API adresi yazılırsa
// (https://ORNEK.metered.live/api/v1/turn/credentials?apiKey=XXX)
// sunucu listesini otomatik indirir.
async function refreshDynamicTurn() {
  const customUrl = localStorage.getItem('teamsync_turn_url') || '';
  if (!customUrl.startsWith('http')) return;
  try {
    const res = await fetch(customUrl);
    const list = await res.json();
    if (Array.isArray(list)) {
      state.dynamicTurnServers = list.filter(s => s && typeof s.urls === 'string').slice(0, 8);
      console.log('🌍 TURN API üzerinden', state.dynamicTurnServers.length, 'sunucu alındı');
    }
  } catch (e) {
    console.warn('TURN API isteği başarısız:', e && e.message ? e.message : e);
    showToast('TURN API adresinden sunucu listesi alınamadı, ayarları kontrol edin.', 'warn');
  }
}

// Paylaşılabilir TURN yapılandırması (hello mesajıyla odaya yayınlanır)
function getShareableTurn() {
  const out = [];
  const customUrl = localStorage.getItem('teamsync_turn_url') || '';
  const customUser = localStorage.getItem('teamsync_turn_user') || '';
  const customPass = localStorage.getItem('teamsync_turn_pass') || '';
  if (customUrl && !customUrl.startsWith('http') && customUser && customPass) {
    customUrl.split(',').map(u => u.trim()).filter(Boolean).forEach(u => {
      out.push({ urls: u, username: customUser, credential: customPass });
    });
  }
  if (Array.isArray(state.dynamicTurnServers)) {
    state.dynamicTurnServers.forEach(s => {
      if (s && typeof s.urls === 'string' && /^turns?:/.test(s.urls)) out.push(s);
    });
  }
  return out.length ? out.slice(0, 4) : null;
}

// Odadaki bir üyeden gelen TURN yapılandırmasını uygula. Kurulmakta olan/
// başarısız bağlantılar yeni sunucularla yeniden denenir.
function applySharedTurn(turnList) {
  if (!Array.isArray(turnList) || !turnList.length) return;
  const clean = turnList.filter(s =>
    s && typeof s.urls === 'string' && /^turns?:/.test(s.urls) &&
    typeof (s.username || '') === 'string' && typeof (s.credential || '') === 'string'
  ).slice(0, 4);
  if (!clean.length) return;
  const serialized = JSON.stringify(clean);
  if (state.sharedTurnSerialized === serialized) return; // zaten uygulandı
  state.sharedTurn = clean;
  state.sharedTurnSerialized = serialized;
  console.log('🔁 Odadan TURN yapılandırması alındı:', clean.map(s => s.urls).join(', '));
  showToast('Odadan TURN sunucu bilgisi alındı, bağlantılar güçlendiriliyor...', 'info');
  // Paylaşılan sunucu adlarını da DoH ile çöz; tamamlanınca bağlanamayan
  // peer'lara IP varyantlarını da içeren güncel yapılandırma uygulanır.
  resolveTurnHostsViaDoH().then(() => {
    state.peers.forEach((peer, peerId) => {
      const st = peer.pc ? peer.pc.iceConnectionState : null;
      if (st === 'connected' || st === 'completed') return;
      try {
        peer.pc.setConfiguration({
          iceServers: getIceServers(),
          iceTransportPolicy: state.useRelay ? 'relay' : 'all'
        });
      } catch (e) {}
    });
  }).catch(() => {});
  state.peers.forEach((peer, peerId) => {
    const st = peer.pc ? peer.pc.iceConnectionState : null;
    if (st === 'connected' || st === 'completed') return;
    try {
      peer.pc.setConfiguration({
        iceServers: getIceServers(),
        iceTransportPolicy: state.useRelay ? 'relay' : 'all'
      });
      peer.lastRestartAt = 0; // hemen denemeye izin ver
      attemptIceRestart(peerId);
    } catch (e) {
      console.warn('setConfiguration başarısız:', e && e.message ? e.message : e);
    }
  });
}

// Cloudflare WARP (veya benzeri, trafiği Cloudflare'den geçiren bir tünel)
// açık mı? 1.1.1.1/cdn-cgi/trace IP-literal olduğu için bozuk DNS'ten
// etkilenmez; yanıttaki warp=on/plus alanı isteğin WARP tünelinden çıktığını
// söyler. Amaç: kullanıcıyı erken uyarmak ve tanı mesajlarını isabetli kılmak
// (WARP altında doğrudan P2P neredeyse hep düşer, TURN şart).
async function detectTunnelInterference() {
  try {
    // Ana süreç üzerinden: /cdn-cgi/trace CORS başlığı göndermediği için
    // renderer fetch'i "Failed to fetch" ile düşer, main process düşmez.
    const warp = (window.electronAPI && window.electronAPI.detectWarp)
      ? await window.electronAPI.detectWarp()
      : null;
    if (!warp) { state.warpDetected = false; return; }
    state.warpDetected = true;
    console.warn('🛡️ Cloudflare WARP algılandı (warp=' + warp + ') — doğrudan P2P büyük olasılıkla çalışmaz, TURN yolları önceliklendirilecek');
    const hasTurn = getIceServers().some(s => typeof s.urls === 'string' && /^turns?:/.test(s.urls) && s.username);
    showToast(hasTurn
      ? '🛡️ Cloudflare WARP algılandı — bağlantı TURN üzerinden kurulacak, sorun olursa otomatik onarılır'
      : '🛡️ Cloudflare WARP algılandı — sesli bağlantı için Ayarlar > TURN bölümüne bir TURN hesabı girin (odada tek kişinin girmesi yeterli)', 'warn');
  } catch (e) {}
}

// Bağlantı kurulamayınca sebebini kullanıcıya söyle
async function diagnoseIceFailure(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer || !peer.pc) return;
  try {
    const stats = await peer.pc.getStats();
    const types = new Set();
    stats.forEach(r => {
      if (r.type === 'local-candidate' && r.candidateType) types.add(r.candidateType);
    });
    console.log('🩺 ICE tanı — yerel aday türleri:', [...types].join(', ') || 'yok');
    const hasTurnConfigured = getIceServers().some(s => typeof s.urls === 'string' && s.urls.startsWith('turn'));
    if (!types.has('srflx') && !types.has('relay')) {
      showToast('Ağınız STUN/UDP trafiğini engelliyor görünüyor (güvenlik duvarı/okul-iş ağı). TURN sunucusu şart.', 'danger');
    } else if (!hasTurnConfigured) {
      showToast(state.warpDetected
        ? 'WARP açıkken doğrudan P2P kurulamaz; Ayarlar > TURN bölümüne bir TURN hesabı girin (tek kişinin girmesi yeterli, odaya otomatik paylaşılır).'
        : 'Doğrudan P2P kurulamadı: muhtemelen iki taraf da kısıtlı NAT/CGNAT arkasında. Ayarlar > TURN bölümüne ücretsiz bir TURN hesabı girin (tek kişinin girmesi yeterli, odaya otomatik paylaşılır).', 'danger');
    } else if (!types.has('relay')) {
      showToast(state.warpDetected
        ? 'TURN sunucusuna WARP tüneli üzerinden ulaşılamadı. Tüm taşıma varyantları (UDP/TCP/TLS + IP) denenmeye devam ediyor; düzelmezse WARP\'ı kapatın.'
        : 'TURN sunucunuza bağlanılamadı. VPN/WARP/DPI aracı (ör. Cloudflare WARP) kullanıyorsanız kapatıp tekrar deneyin; yoksa TURN bilgilerini kontrol edin.', 'danger');
    }
  } catch (e) {}
}

window.addEventListener('DOMContentLoaded', async () => {
  // Başlangıç menüsünün sol altına uygulama sürümünü yaz (package.json'dan).
  try {
    const verEl = document.getElementById('app-version');
    if (verEl && window.electronAPI && window.electronAPI.getAppVersion) {
      const v = window.electronAPI.getAppVersion();
      if (v) verEl.textContent = 'v' + v;
    }
  } catch (e) { /* sürüm alınamazsa statik metin kalır */ }

  // Donanım hızlandırma kapalıysa body'ye 'no-hw-accel' ekle: backdrop-filter
  // çalışmayacağı için cam buton opak nötr zemine düşer (bkz: style.css).
  if (window.electronAPI && window.electronAPI.getEffectiveHardwareAcceleration) {
    window.electronAPI.getEffectiveHardwareAcceleration()
      .then(on => { document.body.classList.toggle('no-hw-accel', !on); })
      .catch(() => {});
  }

  // TEŞHİS: DIAG açıkken, DOM'a eklenen GERÇEK indirme butonlarını yakalayıp
  // ana sürece yolla (computed renk + hangi eleman). Kullanıcının gördüğü mor
  // butonun kesin kimliğini öğrenmek için — sentetik probe yerine canlı DOM.
  if (window.electronAPI && window.electronAPI.diagEnabled) {
    window.electronAPI.diagEnabled().then(on => {
      if (!on) return;
      const cap = (el) => {
        try {
          const cs = getComputedStyle(el);
          window.electronAPI.diagCapture({
            tag: el.tagName, className: el.className,
            download: el.getAttribute && el.getAttribute('download'),
            parentClass: el.parentElement ? el.parentElement.className : '',
            backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage,
            borderRadius: cs.borderRadius, width: cs.width, height: cs.height,
            outerHTML: (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 260),
          });
        } catch (e) {}
      };
      const scan = (node) => {
        if (!node || node.nodeType !== 1) return;
        if (node.matches && node.matches('a[download], .dl-btn, .text-dl, .msg-file a')) cap(node);
        if (node.querySelectorAll) node.querySelectorAll('a[download], .dl-btn, .text-dl, .msg-file a').forEach(cap);
      };
      new MutationObserver(muts => muts.forEach(m => m.addedNodes && m.addedNodes.forEach(scan)))
        .observe(document.body, { childList: true, subtree: true });
      scan(document.body);
    }).catch(() => {});
  }

  const stepName = document.getElementById('step-name');
  const stepAction = document.getElementById('step-action');
  const stepJoin = document.getElementById('step-join');
  const stepCreate = document.getElementById('step-create');

  const nameInp = document.getElementById('name');
  const btnNextName = document.getElementById('btn-next-name');
  const displayName = document.getElementById('display-name');

  const btnShowJoin = document.getElementById('btn-show-join');
  const btnShowCreate = document.getElementById('btn-show-create');

  const btnShowUpdates = document.getElementById('btn-show-updates');
  if (btnShowUpdates) {
    btnShowUpdates.addEventListener('click', () => {
      document.getElementById('update-log-modal').classList.remove('hidden');
    });
  }
  const updateLogClose = document.getElementById('update-log-close');
  if (updateLogClose) {
    updateLogClose.addEventListener('click', () => {
      document.getElementById('update-log-modal').classList.add('hidden');
    });
  }

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

  const btnCreate = document.getElementById('btn-create');
  const createName = document.getElementById('create-name');
  const createPw = document.getElementById('create-password');
  const createAi = document.getElementById('create-useAI');

  try {
    const ips = await window.electronAPI.getLocalIPs();
    if (ips.length) {
      document.getElementById('my-ip').innerHTML =
        `🌐 Senin IP: <code>${ips[0].address}</code> (aynı ağdaki arkadaşın otomatik bulur)`;
    }
  } catch (e) {}

  // --- Cihaza Bağlı Otomatik Kimlik (Supabase) ---
  // E-posta/şifre formu kaldırıldı. İlk açılışta main süreci 256-bit rastgele
  // bir cihaz gizli anahtarı üretir ve DPAPI ile şifreli saklar; giriş
  // bilgileri o anahtardan türetilir, kullanıcıya hiçbir yerde gösterilmez.
  const authStatusText = document.getElementById('auth-status-text');
  const btnRetryAuth = document.getElementById('btn-retry-auth');
  const authVisual = document.getElementById('auth-visual');

  function setAuthStatus(msg, isError = false) {
    if (authStatusText) {
      authStatusText.textContent = msg;
      authStatusText.style.color = isError ? '#f87171' : '';
    }
    if (authVisual) authVisual.classList.toggle('error', isError);
    if (btnRetryAuth) btnRetryAuth.classList.toggle('hidden', !isError);
  }

  // Aynı cihazdaki hesaplar: hepsi tek cihaz kimliğini paylaşır, slot numarası
  // ile ayrılır. Kayıt defteri sadece görünüm içindir (isim/avatar); kimlik
  // bilgileri her zaman main sürecinden türetilir.
  const DEVICE_ACCOUNTS_KEY = 'teamsync_device_accounts';
  const ACTIVE_SLOT_KEY = 'teamsync_active_slot';

  function getDeviceAccounts() {
    try { return JSON.parse(localStorage.getItem(DEVICE_ACCOUNTS_KEY)) || []; } catch (e) { return []; }
  }
  function saveDeviceAccounts(list) {
    localStorage.setItem(DEVICE_ACCOUNTS_KEY, JSON.stringify(list));
  }
  function getActiveSlot() {
    const s = parseInt(localStorage.getItem(ACTIVE_SLOT_KEY), 10);
    return Number.isInteger(s) && s >= 0 ? s : 0;
  }
  function upsertDeviceAccount(slot, patch) {
    const list = getDeviceAccounts();
    const idx = list.findIndex(a => a.slot === slot);
    if (idx !== -1) list[idx] = { ...list[idx], ...patch };
    else list.push({ slot, name: 'Anonim', avatar: null, ...patch });
    list.sort((a, b) => a.slot - b.slot);
    saveDeviceAccounts(list);
  }
  window.syncActiveDeviceAccount = () => {
    upsertDeviceAccount(getActiveSlot(), { name: state.myName, avatar: state.myAvatar });
  };

  async function deviceLogin(slot) {
    if (!Number.isInteger(slot) || slot < 0) slot = getActiveSlot();
    document.getElementById('step-accounts').classList.add('hidden');
    document.getElementById('step-name').classList.add('hidden');
    document.getElementById('step-auth').classList.remove('hidden');
    if (!supabaseClient) {
      setAuthStatus('Sunucu yapılandırması eksik (.env dosyasını kontrol edin).', true);
      return;
    }
    if (!window.electronAPI || !window.electronAPI.getDeviceCredentials) {
      setAuthStatus('Cihaz kimliği API bulunamadı (preload güncel değil).', true);
      return;
    }
    setAuthStatus('Cihaz kimliği doğrulanıyor...');
    try {
      const creds = await window.electronAPI.getDeviceCredentials(slot);
      let { data, error } = await supabaseClient.auth.signInWithPassword({
        email: creds.email,
        password: creds.password
      });
      if (error) {
        // Bu slotun hesabı henüz yok — bir kez oluşturulur.
        setAuthStatus('Bu cihaz için yeni hesap oluşturuluyor...');
        const signUpRes = await supabaseClient.auth.signUp({
          email: creds.email,
          password: creds.password,
          options: { data: { display_name: 'Anonim' } }
        });
        if (signUpRes.error) throw signUpRes.error;
        data = signUpRes.data;
        if (!data.session) {
          throw new Error('Sunucu e-posta onayı bekliyor; Supabase panelinden "Confirm email" kapatılmalı.');
        }
      }
      localStorage.setItem(ACTIVE_SLOT_KEY, String(slot));
      await loadSupabaseProfile(data.user.id);
    } catch (e) {
      console.error('Device login error:', e);
      setAuthStatus('Giriş yapılamadı: ' + (e.message || e), true);
    }
  }

  if (btnRetryAuth) btnRetryAuth.addEventListener('click', () => deviceLogin());

  // "Hesap Değiştir" ekranı: bu cihazda açılmış hesapların listesi
  async function renderDeviceAccounts() {
    const container = document.getElementById('accounts-list');
    if (!container) return;
    document.getElementById('step-auth').classList.add('hidden');
    document.getElementById('step-name').classList.add('hidden');
    document.getElementById('step-accounts').classList.remove('hidden');
    container.innerHTML = '';

    const list = getDeviceAccounts();
    if (!list.length) {
      await deviceLogin(0);
      return;
    }
    const activeSlot = getActiveSlot();
    list.forEach(acc => {
      const row = document.createElement('div');
      row.className = 'account-row';
      const avatarHtml = acc.avatar
        ? `<img class="account-row-avatar" src="${acc.avatar}" />`
        : `<div class="account-row-avatar">👤</div>`;
      row.innerHTML = `
        ${avatarHtml}
        <div class="account-row-info">
          <div class="account-row-name">${escapeHtml(acc.name || 'Anonim')}</div>
          <div class="account-row-id">Bu cihazın kimliği · Hesap #${acc.slot + 1}${acc.slot === activeSlot ? ' · son kullanılan' : ''}</div>
        </div>
      `;
      if (acc.slot === activeSlot) {
        row.style.border = '1px solid var(--acc)';
      }
      row.onclick = () => deviceLogin(acc.slot);
      container.appendChild(row);
    });
  }

  async function checkSession() {
    if (!supabaseClient) {
      console.warn("Supabase client is not initialized.");
      document.getElementById('step-auth').classList.remove('hidden');
      setAuthStatus('Sunucu yapılandırması eksik (.env dosyasını kontrol edin).', true);
      return;
    }
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (session) {
        console.log("Active Supabase session found.");
        await loadSupabaseProfile(session.user.id);
      } else {
        await deviceLogin();
      }
    } catch (e) {
      console.error("Session check error:", e);
      await deviceLogin();
    }
  }

  async function loadSupabaseProfile(userId) {
    try {
      let { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      // Retry once if not found (in case database trigger is running)
      if ((error || !profile) && error?.code === 'PGRST116') {
        console.log("Profile not found immediately, retrying in 500ms...");
        await new Promise(resolve => setTimeout(resolve, 500));
        const retryResult = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();
        if (retryResult.data) {
          profile = retryResult.data;
          error = null;
        }
      }

      if (error || !profile) {
        console.warn("Profile not found in database, creating a default one.");
        const { data: { user } } = await supabaseClient.auth.getUser();
        const nickname = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Anonim';
        const newFriendId = `KNK-${crypto.randomUUID().toUpperCase()}`;
        
        const newProfile = {
          id: userId,
          name: nickname,
          friend_id: newFriendId,
          avatar: null,
          friends: {},
          requests: []
        };
        
        const { error: insertError } = await supabaseClient
          .from('profiles')
          .insert([newProfile]);
        
        if (insertError) {
          console.warn("Insert failed, trying one last fetch:", insertError);
          const finalResult = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
          if (finalResult.data) {
            loginWithProfileData(finalResult.data);
            return;
          }
          throw insertError;
        }
        
        loginWithProfileData(newProfile);
      } else {
        loginWithProfileData(profile);
      }
    } catch (e) {
      console.error("Load profile error:", e);
      showToast("Profil yüklenirken hata oluştu: " + e.message, "danger");
      document.getElementById('step-auth').classList.remove('hidden');
      setAuthStatus('Profil yüklenemedi: ' + e.message, true);
    }
  }

  function loginWithProfileData(profile) {
    state.myName = profile.name;
    state.friendId = profile.friend_id;
    state.myAvatar = profile.avatar || null;
    state.myAvatarHash = null;
    state.friends = profile.friends || {};
    state.friendRequests = profile.requests || [];

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
      document.getElementById('my-avatar-default').style.display = 'flex';
    }

    document.getElementById('step-auth').classList.add('hidden');
    document.getElementById('step-accounts').classList.add('hidden');
    document.getElementById('step-name').classList.add('hidden');
    document.getElementById('step-action').classList.remove('hidden');
    document.querySelector('.login-card').classList.add('expanded');

    upsertDeviceAccount(getActiveSlot(), { name: state.myName, avatar: state.myAvatar });

    renderFriends();
    setupGlobalMQTT();
  }

  // Start checkSession
  await checkSession();

  btnNextName.addEventListener('click', () => {
    const n = nameInp.value.trim() || 'Anonim';
    state.myName = n;
    state.friendId = `KNK-${crypto.randomUUID().toUpperCase()}`;
    displayName.textContent = n;
    document.getElementById('my-friend-id').textContent = state.friendId;

    saveProfile();
    setupGlobalMQTT();

    stepName.classList.add('hidden');
    stepAction.classList.remove('hidden'); document.querySelector('.login-card').classList.add('expanded');
  });

  document.getElementById('btn-new-account').addEventListener('click', () => {
    if (supabaseClient) {
      // Aynı cihaz kimliği altında yeni slot aç
      const list = getDeviceAccounts();
      const nextSlot = list.length ? Math.max(...list.map(a => a.slot)) + 1 : 0;
      deviceLogin(nextSlot);
      return;
    }
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
    
    // Supabase Sign Out
    if (supabaseClient) {
      try {
        await supabaseClient.auth.signOut();
      } catch (e) {
        console.error("Supabase signOut error:", e);
      }
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
    // Hesap seçici: bu cihazda açılmış hesaplar listelenir, yenisi oluşturulabilir
    await renderDeviceAccounts();
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

  const startApp = async (roomId, pw, useAI, pttMode, serverName, isJoining = false, useSFW = false, useGameMode = false, useRelay = false) => {
    roomId = roomId.toLowerCase();
    state.useRelay = useRelay;
    if (useRelay) {
      const turnUrl = localStorage.getItem('teamsync_turn_url') || '';
      const hasCustomTurn = turnUrl.startsWith('http') || (turnUrl && localStorage.getItem('teamsync_turn_user') && localStorage.getItem('teamsync_turn_pass'));
      if (!hasCustomTurn) {
        state.useRelay = false;
        showToast('Relay (TURN) modu için ayarlardan kendi TURN sunucu bilgilerinizi girmelisiniz. Normal modda devam ediliyor.', 'warn');
      }
    }
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
    state.moderators = new Set();
    state.serverMutedIds = new Set();
    // Susturma her odaya özeldir: yeni sunucuya geçince susturma sıfırlanır,
    // aksi halde başka sunucuda da susturulmuş kalıyordunuz.
    state.serverMuted = false;
    // Kurucu, bu odaya ait kalıcı yasak listesini diskten yükler; katılan biri
    // ise liste kurucunun hello mesajıyla senkronize edilir.
    state.bannedIds = state.isRoomFounder ? loadRoomBans(roomId) : new Set();
    state.founderId = state.isRoomFounder ? state.myId : null;

    updateFounderMenuVisibility();

    try {
      state.cryptoKey = await setupCrypto(state.password);
      detectTunnelInterference(); // await yok: girişte bloklamasın, toast async gelsin
      await refreshDynamicTurn();
      await resolveTurnHostsViaDoH();
      await setupLocalAudio();
      if (!state.uiBound) {
        bindUI();
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
      
      state.roomName = serverName;
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

      if (pttMode) applyPttMode(true);

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
    const useRelay = document.getElementById('join-useRelay') ? document.getElementById('join-useRelay').checked : false;
    const pttEnabled = localStorage.getItem('teamsync_ptt_enabled') === '1';
    startApp(roomId, joinPw.value, joinAi.checked, pttEnabled, "Sunucu " + roomId, true, false, false, useRelay);

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
    const useRelay = document.getElementById('create-useRelay') ? document.getElementById('create-useRelay').checked : false;
    const pttEnabled = localStorage.getItem('teamsync_ptt_enabled') === '1';
    // Sunucu oluştururken seçilen ses bit hızı (item 7). setMediaBitrates bunu
    // ilk bağlantıların SDP'sine uygular.
    const bitrateSel = document.getElementById('create-bitrate');
    state.audioBitrate = bitrateSel ? (parseInt(bitrateSel.value, 10) || 128) : 128;
    startApp(odaId, createPw.value, createAi.checked, pttEnabled, sName, false, useSFW, useGameMode, useRelay);
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

async function setupLocalAudio(options = {}) {
  const generation = ++state.audioSetupGeneration;
  const forceSystemSuppression = options.forceSystemSuppression === true;
  const previousLocalStream = state.localStream;

  if (state.rnnoiseFilterNode && window.RNNoiseSuppression) {
    window.RNNoiseSuppression.releaseFilter(state.rnnoiseFilterNode);
  }
  state.rnnoiseFilterNode = null;
  state.rnnoiseActive = false;
  state.rnnoiseStatus = state.useAI
    ? (forceSystemSuppression ? 'fallback' : 'loading')
    : 'off';

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

  let useRnnoise = !!state.useAI
    && !forceSystemSuppression
    && !!window.RNNoiseSuppression
    && window.RNNoiseSuppression.isSupported();
  if (state.useAI && !useRnnoise && !forceSystemSuppression) {
    state.rnnoiseStatus = 'fallback';
    if (!state.rnnoiseFallbackNotified) {
      state.rnnoiseFallbackNotified = true;
      showToast('RNNoise desteklenmiyor; sistem gürültü engelleme etkinleştirildi', 'warn');
    }
  }

  if (generation !== state.audioSetupGeneration) return;

  const raw = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId,
      echoCancellation: true,
      // RNNoise kendi AI modelini çalıştırırken Chromium'un gürültü/AGC
      // işlemesini kapat; iki işlemciyi üst üste bindirmek konuşmayı boğar.
      noiseSuppression: { ideal: !!state.useAI && !useRnnoise },
      autoGainControl: { ideal: !!state.useAI && !useRnnoise },
      sampleRate: { ideal: 48000 },
      // Yankı iptali (AEC) Chromium'da yalnızca mono yakalamada güvenilir
      // çalışır; stereo istek AEC'yi sessizce devre dışı bırakabiliyor
      // (crbug 1071108). Sesli sohbet için stereonun bir faydası da yok.
      channelCount: { ideal: 1 }
    }
  });

  if (generation !== state.audioSetupGeneration) {
    raw.getTracks().forEach(track => track.stop());
    return;
  }

  state.rawMicStream = raw;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let vuCtx;
  try {
    vuCtx = new AudioContextClass({ sampleRate: 48000, latencyHint: 'interactive' });
  } catch (error) {
    vuCtx = new AudioContextClass();
  }
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
  let highpassNode = null, lowpassNode = null, compressorNode = null, gainNodeInst = null;
  let rnnoiseFilterNode = null;

  if (useRnnoise) {
    try {
      rnnoiseFilterNode = await window.RNNoiseSuppression.createNoiseFilter({
        audioContext: vuCtx,
        onError: error => {
          console.error('RNNoise çalışma zamanı hatası:', error);
          if (generation !== state.audioSetupGeneration || state.rnnoiseStatus !== 'active') return;
          state.rnnoiseStatus = 'fallback';
          showToast('RNNoise durdu; ses kesilmeden sistem filtresine geçiliyor', 'warn');
          setTimeout(() => {
            if (generation === state.audioSetupGeneration) {
              setupLocalAudio({ forceSystemSuppression: true }).catch(console.error);
            }
          }, 0);
        }
      });
      if (generation !== state.audioSetupGeneration) {
        window.RNNoiseSuppression.releaseFilter(rnnoiseFilterNode);
        raw.getTracks().forEach(track => track.stop());
        try { vuCtx.close(); } catch (error) {}
        return;
      }
      state.gateGainNode.connect(rnnoiseFilterNode);
      rnnoiseFilterNode.connect(dest);
      state.rnnoiseFilterNode = rnnoiseFilterNode;
      state.rnnoiseActive = true;
      state.rnnoiseStatus = 'active';
    } catch (error) {
      console.warn('RNNoise filtresi başlatılamadı; sistem gürültü engellemeye dönülüyor:', error);
      raw.getTracks().forEach(track => track.stop());
      try { vuCtx.close(); } catch (closeError) {}
      state.rnnoiseStatus = 'fallback';
      if (!state.rnnoiseFallbackNotified) {
        state.rnnoiseFallbackNotified = true;
        showToast('RNNoise başlatılamadı; sistem gürültü engelleme etkinleştirildi', 'warn');
      }
      if (generation === state.audioSetupGeneration) {
        return setupLocalAudio({ forceSystemSuppression: true });
      }
      return;
    }
  } else if (state.useAI) {
    highpassNode = vuCtx.createBiquadFilter();
    highpassNode.type = 'highpass';
    highpassNode.frequency.value = 80;

    lowpassNode = vuCtx.createBiquadFilter();
    lowpassNode.type = 'lowpass';
    lowpassNode.frequency.value = 12000;

    compressorNode = vuCtx.createDynamicsCompressor();
    compressorNode.threshold.value = -24;
    compressorNode.knee.value = 30;
    compressorNode.ratio.value = 4;
    compressorNode.attack.value = 0.01;
    compressorNode.release.value = 0.25;

    gainNodeInst = vuCtx.createGain();
    gainNodeInst.gain.value = 1.0;

    state.gateGainNode.connect(highpassNode);
    highpassNode.connect(lowpassNode);
    lowpassNode.connect(compressorNode);
    compressorNode.connect(gainNodeInst);
    gainNodeInst.connect(dest);

  } else {
    state.gateGainNode.connect(dest);
  }
  state.processedStream = dest.stream;

  // Prevent Garbage Collection of WebAudio processing nodes by V8
  state.audioNodes = {
    vuSrc,
    vuAnalyser: state.vuAnalyser,
    gateGainNode: state.gateGainNode,
    dest,
    highpassNode,
    lowpassNode,
    compressorNode,
    gainNodeInst,
    rnnoiseFilterNode
  };

  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const blankVideoTrack = canvas.captureStream().getVideoTracks()[0];
  blankVideoTrack.enabled = false;

  const finalStream = new MediaStream();
  state.processedStream.getAudioTracks().forEach(t => finalStream.addTrack(t));
  finalStream.addTrack(blankVideoTrack);
  
  state.localStream = finalStream;

  state.uiAnalyser = vuCtx.createAnalyser();
  state.uiAnalyser.fftSize = 512;
  if (rnnoiseFilterNode) {
    rnnoiseFilterNode.connect(state.uiAnalyser);
  } else if (gainNodeInst) {
    gainNodeInst.connect(state.uiAnalyser);
  } else {
    state.gateGainNode.connect(state.uiAnalyser);
  }

  if (state.peers && state.peers.size > 0) {
    const newAudioTrack = state.localStream.getAudioTracks()[0];
    const replacements = [];
    state.peers.forEach(peer => {
      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio');
      if (sender && newAudioTrack) replacements.push(sender.replaceTrack(newAudioTrack));
    });
    await Promise.allSettled(replacements);
  }

  if (previousLocalStream && previousLocalStream !== state.localStream) {
    previousLocalStream.getTracks().forEach(track => track.stop());
  }

  if (state.micEnabled === false) {
    state.localStream.getAudioTracks().forEach(t => t.enabled = false);
    if (state.rawMicStream) state.rawMicStream.getAudioTracks().forEach(t => t.enabled = false);
  }
}

// Kurucu anahtarı değiştiğinde mikrofon işleme zincirini yeniden kurup mevcut
// RTCPeerConnection'ların ses göndericisini replaceTrack ile değiştirir. Böylece
// bağlantı kopmaz. Hızlı art arda değişikliklerde son istek mutlaka uygulanır.
async function applyRoomNoiseSuppression(enabled) {
  state.useAI = !!enabled;
  const founderToggle = document.getElementById('founder-noise-suppression');
  if (founderToggle) founderToggle.checked = state.useAI;

  if (!state.room || !state.localStream) return;
  if (state.noiseSuppressionApplyPromise) return state.noiseSuppressionApplyPromise;

  const applyPromise = (async () => {
    while (state.room && state.localStream) {
      const requestedValue = state.useAI;
      await setupLocalAudio();
      if (requestedValue === state.useAI) break;
    }
  })();

  state.noiseSuppressionApplyPromise = applyPromise;
  try {
    await applyPromise;
  } finally {
    if (state.noiseSuppressionApplyPromise === applyPromise) {
      state.noiseSuppressionApplyPromise = null;
    }
  }
}

function setupVUMeter() {
  if (!state.vuAnalyser) return;
  let data;
  let uiData;
  const vuBar = document.getElementById('vu');
  const vuText = document.getElementById('vu-text');

  function update() {
    if (!state.vuAnalyser) return;
    if (!data || data.length !== state.vuAnalyser.frequencyBinCount) {
      data = new Uint8Array(state.vuAnalyser.frequencyBinCount);
    }
    state.vuAnalyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const db = 20 * Math.log10(rms / 255 || 0.0001);
    const pct = Math.min(100, Math.max(0, (db + 60) * 100 / 60));

    const isSpeaking = pct > state.micThreshold;

    // Yankı Kalkanı: karşı taraf konuşurken (sesi bizim hoparlörden çalıp
    // mikrofona geri sızabilirken) mikrofonu kıs. AEC'nin kaçırdığı yankıyı
    // keser; kullanıcı belirgin şekilde yüksek konuşursa (barge-in) kısılmaz.
    const echoDuck = state.echoShield && state.speakingPeers && state.speakingPeers.size > 0 &&
      pct < state.micThreshold + 15;

    if (state.gateGainNode && state.gateAudioCtx && state.gateAudioCtx.state !== 'closed') {
      if (!isSpeaking) {
        state.gateGainNode.gain.setTargetAtTime(0, state.gateAudioCtx.currentTime, 0.05);
      } else {
        state.gateGainNode.gain.setTargetAtTime(echoDuck ? 0.1 : 1, state.gateAudioCtx.currentTime, 0.05);
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
  }

  // DİKKAT: Burada requestAnimationFrame KULLANILMAMALI. Pencere simge durumuna
  // küçültüldüğünde/oyunun arkasında kaldığında rAF durur ve gürültü kapısı
  // (gateGainNode) son değerinde donar; 0'da donarsa karşı taraf sizi hiç
  // duyamaz. setInterval + backgroundThrottling:false ile kapı her zaman işler.
  if (state.vuInterval) clearInterval(state.vuInterval);
  state.vuInterval = setInterval(update, 50);
}

// Seçili ses çıkış cihazını (hoparlör/kulaklık) bir medya elementine uygular.
// Boş id = sistem varsayılanı (setSinkId('') varsayılana döner).
function applySpeakerTo(el) {
  if (!el || typeof el.setSinkId !== 'function') return;
  const id = localStorage.getItem('teamsync_speaker_id') || '';
  el.setSinkId(id).catch(e => {
    // Kayıtlı cihaz artık yok/değişmiş (cihaz id'leri kalıcı değildir):
    // varsayılana dönmezsek ses "geliyor ama duyulmuyor" gibi görünür.
    console.warn('setSinkId başarısız, varsayılan hoparlöre dönülüyor:', e && e.message ? e.message : e);
    if (id) {
      localStorage.removeItem('teamsync_speaker_id');
      el.setSinkId('').catch(() => {});
      showToast('Kayıtlı ses çıkış cihazı bulunamadı, varsayılan hoparlöre dönüldü', 'warn');
    }
  });
}

function applySpeakerToAll() {
  document.querySelectorAll('audio, video').forEach(applySpeakerTo);
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
    sel.onchange = async () => {
      await setupLocalAudio();
    };

    // Çıkış cihazı seçimi: yankı genelde ses hoparlörden çalıp mikrofona
    // geri girince oluşur; kulaklığı buradan seçmek bunu keser.
    const spk = document.getElementById('speaker-select');
    if (spk) {
      spk.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'Varsayılan Çıkış';
      spk.appendChild(def);
      devices.filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default').forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || 'Hoparlör ' + spk.children.length;
        spk.appendChild(opt);
      });
      const saved = localStorage.getItem('teamsync_speaker_id') || '';
      if (saved && [...spk.options].some(o => o.value === saved)) spk.value = saved;
      else if (saved) { localStorage.removeItem('teamsync_speaker_id'); } // cihaz artık yok
      spk.onchange = () => {
        if (spk.value) localStorage.setItem('teamsync_speaker_id', spk.value);
        else localStorage.removeItem('teamsync_speaker_id');
        applySpeakerToAll();
        showToast('Ses çıkış cihazı değiştirildi', 'info');
      };
      applySpeakerToAll();
      // Cihaz takılıp çıkarıldığında sink'leri yeniden uygula: kulaklık
      // çekilince element sessizce ölü bir çıkışta kalabiliyor
      if (!state.deviceChangeHooked) {
        state.deviceChangeHooked = true;
        navigator.mediaDevices.addEventListener('devicechange', () => applySpeakerToAll());
      }
    }
  } catch (e) {}
}

async function handlePeerDiscovered(peer) {
  if (!peer || !peer.id || peer.id === state.myId) return;

  // Kalıcı yasak kontrolü (item 3): yasaklı biri odaya giremez. Kurucu ayrıca
  // yasaklıyı aktif olarak atar (kick), diğer istemciler sadece bağlantı kurmaz.
  if (state.bannedIds && state.bannedIds.has(peer.id)) {
    if (state.isRoomFounder) {
      broadcast({ type: 'ban_peer', targetId: peer.id });
    }
    if (state.peers.has(peer.id)) removePeer(peer.id);
    return;
  }

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
      broadcast({ type: 'check_friend', targetId: peer.id });
      peer.friendCheckTimeout = setTimeout(() => {
        console.log('❌ Peer is no one\'s friend, kicking:', peer.name);
        broadcast({ type: 'kick_peer', targetId: peer.id, reason: 'Sadece arkadaşlar katılabilir.' });
        removePeer(peer.id);
      }, 3000);
    }
  }

  if (peer.isFounder) state.founderId = peer.id;
  if (peer.isModerator) state.moderators.add(peer.id);

  addUser({ id: peer.id, name: peer.name, mic: true, deaf: false, sharing: false, ip: peer.ip, avatar: peer.avatar, isFounder: peer.isFounder });
  updateFounderMenuVisibility();
  
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
      // MQTT geçici koparsa bile WebRTC bağlantısı sağlamsa peer'ı düşürme
      const iceState = peer.pc ? peer.pc.iceConnectionState : null;
      if (iceState === 'connected' || iceState === 'completed') return;
      console.log('⏳ Peer zaman aşımına uğradı:', peer.name);
      removePeer(id);
    }
  });
}, 5000);

function removePeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;
  if (peer.connWatchdog) clearInterval(peer.connWatchdog);
  if (peer.pingInterval) clearInterval(peer.pingInterval);
  if (peer.pc) peer.pc.close();
  if (peer.dc) peer.dc.close();
  if (peer.mediaStreamSource) { try { peer.mediaStreamSource.disconnect(); } catch(e) {} }
  if (peer.analyser) { try { peer.analyser.disconnect(); } catch(e) {} }
  if (peer.silentGain) { try { peer.silentGain.disconnect(); } catch(e) {} }
  if (peer.audioCtx) { try { peer.audioCtx.close(); } catch(e) {} }
  if (peer.audioEl) { try { peer.audioEl.srcObject = null; peer.audioEl.remove(); } catch(e) {} }
  if (peer.videoEl) { try { peer.videoEl.srcObject = null; peer.videoEl.remove(); } catch(e) {} }
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

  // Ortak Tarayıcı: bağlantısı kopan kurucuysa halef seç (kimseyi atmadan),
  // değilse sadece yetki listesinden düş
  if (state.sb && state.sb.host === peerId) {
    if (typeof sbHandleHostLeft === 'function') sbHandleHostLeft(peerId);
  } else if (state.sb && Array.isArray(state.sb.authorized) && state.sb.authorized.includes(peerId)) {
    state.sb.authorized = state.sb.authorized.filter(id => id !== peerId);
    if (state.sb.host === state.myId && typeof sbBroadcastAuth === 'function') sbBroadcastAuth();
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

  // Ayrılan peer kurucuysa sahiplik boşta kalmasın diye halef (moderatör) seç.
  // (item 4) Not: state.peers.delete(peerId) yukarıda çalıştığı için aday
  // filtresi ayrılan kurucuyu doğru şekilde hariç tutar.
  if (peerId === state.founderId) {
    handleFounderLeft(peerId);
  }
}

// Ses bit hızı (kbps) kurucu tarafından ayarlanabilir; SDP içindeki Opus
// fmtp satırına maxaveragebitrate olarak yazılır. Varsayılan 128 kbps. (item 7)
function getAudioBitrate() {
  const v = parseInt(state.audioBitrate, 10);
  return (Number.isFinite(v) && v >= 8 && v <= 512) ? v : 128;
}

// Opus için yüksek kalite fmtp parametreleri. Not: Opus payload numarası her
// zaman 111 değildir — SDP'den dinamik bulunur, yoksa fmtp satırı eklenir.
// cbr=1 (sabit bit hızı) kaldırıldı; VBR daha iyi ses/oran verir. useinbandfec
// paket kaybında sesi netleştirir, maxplaybackrate 48kHz tam bant sağlar.
function setMediaBitrates(sdp) {
  if (!sdp) return sdp;
  const bps = getAudioBitrate() * 1000;
  const m = sdp.match(/a=rtpmap:(\d+)\s+opus/i);
  if (!m) return sdp;
  const pt = m[1];
  const opusParams =
    `maxaveragebitrate=${bps};maxplaybackrate=48000;sprop-maxcapturerate=48000;` +
    `stereo=1;sprop-stereo=1;useinbandfec=1;usedtx=0`;
  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (fmtpRe.test(sdp)) {
    // Mevcut satırdan çakışan Opus parametrelerini temizleyip yenilerini ekle.
    return sdp.replace(fmtpRe, (full, existing) => {
      const cleaned = existing.split(';')
        .filter(p => p && !/^(maxaveragebitrate|maxplaybackrate|sprop-maxcapturerate|stereo|sprop-stereo|useinbandfec|usedtx|cbr)=/i.test(p.trim()))
        .join(';');
      return `a=fmtp:${pt} ${cleaned ? cleaned + ';' : ''}${opusParams}`;
    });
  }
  // fmtp satırı yoksa Opus rtpmap satırının hemen ardına ekle.
  return sdp.replace(new RegExp(`(a=rtpmap:${pt}\\s+opus[^\\r\\n]*)`), `$1\r\na=fmtp:${pt} ${opusParams}`);
}

// Mevcut (kurulu) bağlantılara ses bit hızını yeniden anlaşma olmadan uygular:
// her peer'ın ses göndericisinin encodings.maxBitrate değeri güncellenir. Yeni
// bağlantılar için ise setMediaBitrates SDP üzerinden çalışır. (item 7)
async function applyAudioBitrateToPeers() {
  const maxBitrate = getAudioBitrate() * 1000;
  for (const [, peer] of state.peers) {
    if (!peer.pc) continue;
    const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'audio');
    if (!sender) continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = maxBitrate;
      await sender.setParameters(params);
    } catch (e) {
      console.warn('Ses bit hızı uygulanamadı:', e);
    }
  }
}

function getVideoSender(pc) {
  if (!pc) return null;
  let sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
  if (!sender) {
    const transceiver = pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video');
    if (transceiver) sender = transceiver.sender;
  }
  return sender;
}

function sendSignalToPeer(peerId, signal) {
  // KRİTİK: RTCSessionDescription/RTCIceCandidate HOST nesnelerdir; kendi
  // (own) özellikleri yoktur, type/sdp prototip getter'ıdır. Bu nesneler
  // preload'daki contextBridge'den geçerken {} haline gelir ve karşı tarafta
  // "type null" hatasıyla LAN/UDP sinyalleşmesini tamamen bozar.
  // JSON turu (toJSON kullanır) ile düz nesneye çevirerek gönderiyoruz.
  signal = JSON.parse(JSON.stringify(signal));
  const peer = state.peers.get(peerId);
  // Yedeklilik: iki taraftan birinin MQTT'si kopuk olabilir (halka açık broker
  // güvenilmez). Hem MQTT hem LAN/UDP üzerinden gönderiyoruz; alıcı taraf
  // çift kopyaları sıralı işleyip ayıklıyor.
  if (mqttClient && mqttClient.connected) {
    sendInternetSignal(peerId, signal);
  }
  if (peer && peer.ip && peer.ip !== 'internet') {
    window.electronAPI.sendUDPSignal(peer.ip, signal);
  }
}

// Kademeli tırmanma: 2+ başarısız denemeden sonra (veya ses-bekçisi
// forceRelayNext işaretlediyse) ve elde TURN varsa yerel aday politikası
// relay-zorunluya çekilir. WARP/VPN altında "yaşıyor görünen ama ölü"
// doğrudan yollar tekrar tekrar seçilebiliyor; relay bunları tamamen eler.
// Politika yalnızca KENDİ adaylarımızı filtreler, bu yüzden İKİ ROL İÇİN DE
// uygulanır: relay-only'ye çekilen taraf, karşı tarafın sürümü/rolü ne
// olursa olsun kendi GELEN yönünü kendi TURN relay'inden geçmeye zorlar —
// "o beni duyuyor ama ben onu duyamıyorum" asimetrisinin panzehiri budur
// (karşı taraf artık bize sadece relay adresimizden ulaşabilir). TURN'ün
// kendisi ulaşılamaz çıkarsa kilitlenmemek için 2 relay denemesinden sonra
// tekrar 'all'a dönülür (4'lük döngü: all, all, relay, relay, ...).
function applyIceEscalationPolicy(peer) {
  peer.restartCount = (peer.restartCount || 0) + 1;
  if (state.useRelay) return; // kullanıcı zaten kalıcı relay modunda
  const servers = getIceServers();
  const hasTurn = servers.some(s => typeof s.urls === 'string' && /^turns?:/.test(s.urls) && s.username);
  const wantRelay = hasTurn && (peer.forceRelayNext || (peer.restartCount % 4) >= 2);
  peer.forceRelayNext = false;
  try {
    peer.pc.setConfiguration({ iceServers: servers, iceTransportPolicy: wantRelay ? 'relay' : 'all' });
    if (wantRelay) console.log(`🛰️ ${peer.name}: yerel adaylar relay-zorunluya çekildi (deneme ${peer.restartCount})`);
  } catch (e) {}
}

// Ses yolunun uçtan uca fotoğrafı: seçili aday çifti, gelen/giden RTP
// sayaçları, alıcı track durumu ve oynatıcı (audioEl) durumu tek satırda
// loglanır — "duymuyorum" şikayetinde sorunun ağda mı (gelen paket yok)
// yoksa oynatmada mı (paket var ama element çalmıyor) olduğunu kesin söyler.
// Ayrıca kendini onarır: veri geldiği halde oynatıcı duruyorsa yeniden başlatır.
async function logVoicePathReport(peerId, tag) {
  const peer = state.peers.get(peerId);
  if (!peer || !peer.pc) return;
  try {
    const stats = await peer.pc.getStats();
    const byId = {};
    stats.forEach(r => { byId[r.id] = r; });
    let pairId = null;
    stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId; });
    if (!pairId) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pairId = r.id; });
    let pair = 'yok';
    if (pairId && byId[pairId]) {
      const cp = byId[pairId];
      const l = byId[cp.localCandidateId] || {};
      const rm = byId[cp.remoteCandidateId] || {};
      pair = `${l.candidateType || '?'}/${l.protocol || '?'}<->${rm.candidateType || '?'}/${rm.protocol || '?'}`;
    }
    let inAudio = null, outAudio = null;
    stats.forEach(r => {
      if (r.type === 'inbound-rtp' && r.kind === 'audio') inAudio = r;
      if (r.type === 'outbound-rtp' && r.kind === 'audio') outAudio = r;
    });
    const recv = peer.pc.getReceivers().find(r => r.track && r.track.kind === 'audio');
    const track = recv && recv.track;
    const el = peer.audioEl;
    console.log(`🩺 SES YOLU [${peer.name}] (${tag}): pair=${pair}` +
      ` | gelen=${inAudio ? `${inAudio.packetsReceived}pkt/${inAudio.bytesReceived}B` : 'YOK'}` +
      ` | giden=${outAudio ? `${outAudio.packetsSent}pkt` : 'YOK'}` +
      ` | track=${track ? `${track.readyState}${track.muted ? '/RTP-YOK(muted)' : ''}` : 'YOK'}` +
      ` | oynatıcı=${el ? `paused=${el.paused} vol=${el.volume} muted=${el.muted} sink=${el.sinkId || 'default'} src=${el.srcObject ? 'var' : 'YOK'}` : 'YOK'}` +
      ` | deafen=${state.deafened}`);
    // Kendini onar: ses verisi GELİYOR ama oynatıcı çalmıyor
    if (inAudio && inAudio.bytesReceived > 0 && el && !state.deafened &&
        (el.paused || el.muted || el.volume === 0 || !el.srcObject)) {
      console.warn(`🔈 [${peer.name}] ses verisi geliyor ama oynatıcı çalmıyordu — oynatma yeniden başlatılıyor`);
      showToast(`${peer.name} sesi oynatılamıyordu, oynatıcı yeniden başlatıldı`, 'warn');
      try {
        if (!el.srcObject && track) el.srcObject = new MediaStream([track]);
        el.muted = false;
        el.volume = 1.0;
        await el.play();
      } catch (e) {}
    }
  } catch (e) {}
}

// pc.restartIce() tek başına yeni bir offer üretip GÖNDERMEZ; onnegotiationneeded
// dinlenmediği için hiçbir işe yaramıyordu. Bu fonksiyon initiator tarafında
// gerçek bir iceRestart offer'ı üretip sinyal kanalından yollar. Initiator değilsek
// karşı taraftan restart isteriz.
async function attemptIceRestart(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer || !peer.pc) return;
  const now = Date.now();
  if (peer.lastRestartAt && now - peer.lastRestartAt < 5000) return;
  peer.lastRestartAt = now;

  if (!peer.isInitiator) {
    // Restart'ı karşı taraf başlatacak ama KENDİ politikamızı şimdi ayarlarız:
    // gelecek offer'a vereceğimiz cevap yalnızca bu politikadaki adayları içerir.
    applyIceEscalationPolicy(peer);
    sendSignalToPeer(peerId, { type: 'restart-req' });
    return;
  }

  try {
    // Cevap (answer) henüz gelmediyse yeni offer üretme; mevcut offer'ı
    // tekrar gönder (sinyal kaybına karşı). Yeni offer üretmek ICE sürecini
    // sıfırlayıp kurulmakta olan bağlantıyı bozuyor.
    if (peer.pc.signalingState === 'have-local-offer' && peer.pc.localDescription) {
      console.log(`🔁 Cevap bekleniyor, mevcut offer + adaylar tekrar gönderiliyor → ${peer.name}`);
      sendSignalToPeer(peerId, { type: 'offer', sdp: peer.pc.localDescription });
      (peer.localCandidates || []).forEach(c => sendSignalToPeer(peerId, { type: 'ice', candidate: c }));
      return;
    }
    if (peer.pc.signalingState !== 'stable') {
      try { await peer.pc.setLocalDescription({ type: 'rollback' }); } catch (e) {}
    }
    applyIceEscalationPolicy(peer);
    const offer = await peer.pc.createOffer({ iceRestart: true });
    offer.sdp = setMediaBitrates(offer.sdp);
    peer.localCandidates = []; // ICE restart yeni ufrag üretir; eski adaylar geçersiz
    await peer.pc.setLocalDescription(offer);
    console.log(`🔄 ICE restart offer gönderiliyor → ${peer.name}`);
    sendSignalToPeer(peerId, { type: 'offer', sdp: peer.pc.localDescription });
  } catch (e) {
    console.warn('ICE restart başarısız:', e && e.message ? e.message : e);
  }
}

async function createPeerConnection(peerId, peerName, isInitiator, peerIp) {
  if (state.peers.has(peerId)) return;
  const pc = new RTCPeerConnection({ 
    iceServers: getIceServers(),
    iceTransportPolicy: state.useRelay ? 'relay' : 'all'
  });

  if (state.localStream) state.localStream.getTracks().forEach(track => {
    pc.addTrack(track, state.localStream);
  });

  const sender = getVideoSender(pc);
  if (sender) {
    if (state.isSharing && state.screenStream) {
      sender.replaceTrack(state.screenStream.getVideoTracks()[0]);
    }
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      if (isJunkIceCandidate(e.candidate)) return; // çöp adayı hiç yayınlama
      // Adayları sakla: karşı taraf ilk gönderimi kaçırırsa (abonelik gecikmesi,
      // paket kaybı) offer/answer tekrarıyla birlikte yeniden gönderilirler.
      const p = state.peers.get(peerId);
      if (p) {
        p.localCandidates = p.localCandidates || [];
        try { p.localCandidates.push(JSON.parse(JSON.stringify(e.candidate))); } catch (err) {}
      }
      sendSignalToPeer(peerId, { type: 'ice', candidate: e.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE state [${peerName}]:`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'closed') {
      removePeer(peerId);
    } else if (pc.iceConnectionState === 'failed') {
      console.warn(`⚠️ WebRTC connection failed to ${peerName}, ICE restart deneniyor...`);
      showToast(`${peerName} ile sesli/görüntülü bağlantı kurulamadı, yeniden deneniyor...`, 'warn');
      diagnoseIceFailure(peerId);
      attemptIceRestart(peerId);
    } else if (pc.iceConnectionState === 'disconnected') {
      console.warn(`⚠️ WebRTC disconnected from ${peerName}, 3sn içinde düzelmezse ICE restart...`);
      setTimeout(() => {
        const p = state.peers.get(peerId);
        if (p && p.pc === pc && pc.iceConnectionState === 'disconnected') {
          attemptIceRestart(peerId);
        }
      }, 3000);
    } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      const pr = state.peers.get(peerId);
      // audioStallRestarts BİLEREK burada sıfırlanmıyor: karşı tarafta hiç
      // ses track'i yoksa her restart yine "connected"la biter; sayaç burada
      // sıfırlansaydı üst sınır işlevsiz kalır, sonsuz restart döngüsü olurdu.
      // Sayaç yalnızca ses gerçekten akınca (bekçide) sıfırlanır.
      if (pr) pr.restartCount = 0;
      console.log(`✅ WebRTC connected to ${peerName}`);
      // Bağlantıdan 15 sn sonra ses yolunun fotoğrafını logla (sorun
      // bildirimlerinde "ağ mı, oynatma mı" ayrımını kesinleştirir)
      setTimeout(() => logVoicePathReport(peerId, 'bağlantı+15sn'), 15000);
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
      const audioStream = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([e.track]);
      peer.audioEl.srcObject = audioStream;
      peer.audioEl.volume = state.deafened ? 0.0 : 1.0;
      peer.audioEl.muted = state.deafened;

      peer.audioEl.play().catch((err) => console.warn('Audio play failed:', err));
      setupSpeakingDetection(peerId, audioStream);
    } else if (e.track.kind === 'video') {
      const videoStream = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([e.track]);
      peer.videoEl.srcObject = videoStream;
      peer.videoEl.play().catch((err) => console.warn('peer.videoEl play failed in ontrack:', err));
      if (state.activeControl && state.activeControl.hostId === peerId) {
        const remoteVid = document.getElementById('remote-vid');
        remoteVid.srcObject = videoStream;
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
    audioEl: (function(){ const a = document.createElement('audio'); a.autoplay = true; a.style.display = 'none'; applySpeakerTo(a); document.body.appendChild(a); return a; })(),
    videoEl: (function(){ const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; applySpeakerTo(v); return v; })(),
    dc,
    name: peerName,
    mic: true,
    deaf: false,
    sharing: false,
    ip: peerIp,
    isInitiator,
    lastSeen: Date.now()
  });

  if (isInitiator) {
    const offer = await pc.createOffer();
    offer.sdp = setMediaBitrates(offer.sdp);
    await pc.setLocalDescription(offer);
    sendSignalToPeer(peerId, { type: 'offer', sdp: offer });
  }

  // Sinyal kaybına karşı bekçi: offer/answer MQTT/UDP üzerinde kaybolursa
  // bağlantı sonsuza dek "new/checking"de kalıyordu. Initiator bağlantı
  // kurulana kadar periyodik olarak yeni offer üretip tekrar dener.
  const peerRef = state.peers.get(peerId);
  peerRef.connWatchdog = setInterval(() => {
    const p = state.peers.get(peerId);
    if (!p || p.pc !== pc) { clearInterval(peerRef.connWatchdog); return; }
    const st = pc.iceConnectionState;
    if (st === 'connected' || st === 'completed') {
      p.checkingSince = null;
      // 30 sn'de bir ses yolu fotoğrafı: teşhis logu + oynatma kendini onarır
      // (ör. ses verisi geldiği halde oynatıcı durmuşsa play ile diriltilir)
      p.voiceReportTick = (p.voiceReportTick || 0) + 1;
      if (p.voiceReportTick % 3 === 0) logVoicePathReport(peerId, 'periyodik');
      // "Bağlı görünüyor ama ses akmıyor" bekçisi: WARP/VPN tünellerinde ICE
      // başarılı sayılan ama medyayı taşımayan yollar seçilebiliyor. Karşı
      // taraf mikrofonunu kapatsa bile WebRTC sessizlik paketleri gönderir
      // (track.enabled=false, DTX yok) — sağlıklı bağlantıda inbound-rtp
      // audio baytları HER ZAMAN artar. ~20 sn hiç artmazsa ICE restart
      // (relay tırmanması attemptIceRestart içinde). Karşı tarafta hiç ses
      // track'i yoksa (mikrofon açılamamış) restart çare olmaz; sonsuz
      // döngüye girmemek için üst sınır var.
      pc.getStats().then((stats) => {
        let bytes = 0;
        stats.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') bytes += (r.bytesReceived || 0); });
        const pp = state.peers.get(peerId);
        if (!pp || pp.pc !== pc) return;
        if (pp.lastAudioBytes != null && bytes <= pp.lastAudioBytes) {
          pp.audioStallTicks = (pp.audioStallTicks || 0) + 1;
          if (pp.audioStallTicks >= 2 && (pp.audioStallRestarts || 0) < 3) {
            console.warn(`🔇 ${peerName} bağlı görünüyor ama ses akmıyor (${bytes} bayt), relay-zorunlu ICE restart deneniyor...`);
            if ((pp.audioStallRestarts || 0) === 0) {
              showToast(`${peerName} tarafından ses alınamıyor, bağlantı relay üzerinden onarılıyor...`, 'warn');
            }
            pp.audioStallTicks = 0;
            pp.audioStallRestarts = (pp.audioStallRestarts || 0) + 1;
            logVoicePathReport(peerId, 'ses-kesintisi-' + pp.audioStallRestarts);
            // Kullanıcı zaten ~20 sn sessizlik bekledi: sayaç döngüsünü
            // beklemeden İLK denemede relay'e zorla. Kritik: bağlantı her
            // restart'ta "başarılı" görünüp restartCount'u sıfırlattığı için
            // sayaç tabanlı tırmanma sessiz-ama-bağlı vakalarında ASLA
            // devreye giremiyordu ("o beni duydu, ben onu duyamadım").
            pp.forceRelayNext = true;
            pp.lastRestartAt = 0;
            attemptIceRestart(peerId);
          }
        } else {
          pp.audioStallTicks = 0;
          if (bytes > (pp.lastAudioBytes || 0)) {
            if (pp.audioStallRestarts) {
              console.log(`🔊 ${peerName} tarafından ses tekrar akıyor (onarım başarılı)`);
              showToast(`${peerName} ile ses bağlantısı onarıldı`, 'info');
            }
            pp.audioStallRestarts = 0;
            pp.forceRelayNext = false;
          }
        }
        pp.lastAudioBytes = bytes;
      }).catch(() => {});
      return;
    }
    if (pc.connectionState === 'closed') { clearInterval(peerRef.connWatchdog); return; }
    // 'checking' sürecine karışma; ICE aday denemeleri 30sn'ye kadar sürebilir.
    if (st === 'checking') {
      if (!p.checkingSince) p.checkingSince = Date.now();
      if (Date.now() - p.checkingSince < 30000) return;
    } else {
      p.checkingSince = null;
    }
    console.log(`⏱️ ${peerName} ile hâlâ bağlantı yok (${st}), yeniden deneniyor...`);
    attemptIceRestart(peerId);
  }, 10000);
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
        // İnternet sinyallemesi olmasa bile geç katılan kişi kurucunun oda
        // genelindeki RNNoise tercihini açık veri kanalından hemen alır.
        if (state.isRoomFounder) {
          dc.send(JSON.stringify({
            type: 'founder_settings_update',
            noiseSuppressionEnabled: !!state.useAI
          }));
        }
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
            const currentUrl = document.getElementById('sb-url')?.value || '';
            dc.send(JSON.stringify({ type: 'sb-start', host: state.myId, interactive: true, startedAt: state.sb.startedAt, url: currentUrl, auth: (state.sb.authorized || []).slice() }));
            if (currentUrl) dc.send(JSON.stringify({ type: 'sb-nav', url: currentUrl, ts: Date.now() }));
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
    // Sunucu çapındaki ayarlar yalnızca gerçek kurucudan kabul edilir.
    if (peerId !== state.founderId) return;
    if (msg.friendsOnlyMode !== undefined) state.friendsOnlyMode = msg.friendsOnlyMode;
    if (msg.gameMode !== undefined) state.gameMode = msg.gameMode;
    if (msg.sfwMode !== undefined) {
      state.sfwMode = msg.sfwMode;
      if (state.sfwMode) loadAIFilter();
    }
    if (typeof msg.noiseSuppressionEnabled === 'boolean'
        && msg.noiseSuppressionEnabled !== state.useAI) {
      await applyRoomNoiseSuppression(msg.noiseSuppressionEnabled);
      showToast(msg.noiseSuppressionEnabled
        ? 'Kurucu RNNoise gürültü engellemeyi açtı.'
        : 'Kurucu RNNoise gürültü engellemeyi kapattı.', 'info');
    }
    console.log('👑 Founder settings updated:', msg);
    return;
  } else if (msg.type === 'check_friend') {
    if (state.friends[msg.targetId]) {
      broadcast({ type: 'friend_confirmed', targetId: msg.targetId, byId: state.myId });
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
    // Yetki doğrulaması: gönderen (peerId) hedefe at uygulayabiliyor olmalı.
    // Moderatör kurucuyu/başka moderatörü atamaz; yetkisiz kimse atamaz.
    if (!canModerateTarget(peerId, msg.targetId)) return;
    if (msg.targetId === state.myId) {
      disconnectApp();
      document.getElementById('error-text').textContent = "Sunucudan atıldınız: " + (msg.reason || "Bilinmeyen sebep.");
      document.getElementById('error-modal').classList.remove('hidden');
    } else {
      removePeer(msg.targetId);
    }
    return;
  } else if (msg.type === 'force_mute') {
    // Yetki doğrulaması: moderatör kurucuyu/başka moderatörü susturamaz.
    if (!canModerateTarget(peerId, msg.targetId)) return;
    // Tüm istemciler susturulanlar listesini tutar; böylece kurucu panelindeki
    // sustur/aç butonu doğru durumu (toggle) gösterebilir. (item 5)
    if (!state.serverMutedIds) state.serverMutedIds = new Set();
    state.serverMutedIds.add(msg.targetId);
    if (msg.targetId === state.myId) {
      // Kurucu susturması: kendi tercihini (selfMicOn) ezmeden efektif durumu
      // güncelle. Susturma kalkınca kendi tercihin geri gelecek.
      state.serverMuted = true;
      applyMicState();
      showToast('Kurucu tarafından susturuldunuz!', 'danger');
    }
    return;
  } else if (msg.type === 'force_unmute') {
    // Susturmayı kaldırma yetkisi de aynı kurala tabidir. (item 5)
    if (!canModerateTarget(peerId, msg.targetId)) return;
    if (!state.serverMutedIds) state.serverMutedIds = new Set();
    state.serverMutedIds.delete(msg.targetId);
    if (msg.targetId === state.myId) {
      // Kurucu susturması kalktı: kendi tercihin (selfMicOn) geri uygulanır.
      // Susturulmadan önce mikrofonun açıksa açılır, kendin kapattıysan kapalı kalır.
      state.serverMuted = false;
      applyMicState();
      showToast('Susturmanız kaldırıldı.', 'ok');
    }
    return;
  } else if (msg.type === 'ban_peer') {
    // Yalnızca kurucu kalıcı yasaklayabilir. Yasak listesi tüm istemcilerde
    // tutulur; yasaklı kişi hiçbir peer ile bağlantı kuramaz. (item 3)
    if (peerId !== state.founderId) return;
    if (!state.bannedIds) state.bannedIds = new Set();
    state.bannedIds.add(msg.targetId);
    if (msg.targetId === state.myId) {
      disconnectApp();
      document.getElementById('error-text').textContent = "Bu sunucudan kalıcı olarak yasaklandınız.";
      document.getElementById('error-modal').classList.remove('hidden');
    } else {
      removePeer(msg.targetId);
    }
    return;
  } else if (msg.type === 'set_bitrate') {
    // Sunucu geneli ses bit hızı; yalnızca kurucu değiştirebilir. (item 7)
    if (peerId !== state.founderId) return;
    const kbps = parseInt(msg.value, 10);
    if (Number.isFinite(kbps)) {
      state.audioBitrate = kbps;
      applyAudioBitrateToPeers();
    }
    return;
  } else if (msg.type === 'set_moderator') {
    // Yalnızca kurucu yetki verebilir/alabilir.
    if (peerId !== state.founderId) return;
    if (msg.value) state.moderators.add(msg.targetId);
    else state.moderators.delete(msg.targetId);
    refreshUserRoleBadge(msg.targetId);
    if (msg.targetId === state.myId) {
      updateFounderMenuVisibility();
      showToast(msg.value ? 'Kurucu sana yetki verdi! Artık oyuncuları susturup atabilirsin.' : 'Yetkin alındı.', msg.value ? 'ok' : 'info');
    }
    return;
  } else if (msg.type === 'transfer_ownership') {
    // Yalnızca mevcut kurucu sahipliği devredebilir.
    if (peerId !== state.founderId) return;
    state.founderId = msg.targetId;
    state.moderators.delete(msg.targetId);
    if (msg.targetId === state.myId) {
      state.isRoomFounder = true;
      // Kurucu olan biri sunucu tarafından susturulmuş kalmasın: kendi
      // susturmanı temizle (susturulup sonra kurucu yapılma durumu).
      if (state.serverMutedIds) state.serverMutedIds.delete(state.myId);
      if (state.serverMuted) { state.serverMuted = false; applyMicState(); }
      updateFounderMenuVisibility();
      showToast('Sunucunun yeni sahibi sen oldun!', 'ok');
    }
    refreshUserRoleBadge(msg.targetId);
    if (msg.fromId) refreshUserRoleBadge(msg.fromId);
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
          if (typeof sbUpdateControlsUI === 'function') sbUpdateControlsUI();
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
          const currentUrl = document.getElementById('sb-url')?.value || '';
          broadcastTo(msg.peerId, { type: 'sb-start', host: state.myId, interactive: true, startedAt: state.sb.startedAt, url: currentUrl, auth: (state.sb.authorized || []).slice() });
          if (currentUrl) {
            broadcastTo(msg.peerId, { type: 'sb-nav', url: currentUrl, ts: Date.now() });
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
    // Lobisiz (doğrudan butonla açılan) aktivitelerde msg.lobbyId undefined,
    // alıcıda activeLobbyId null olur; katı !== karşılaştırması bu ikisini
    // farklı sayıp mesajı sessizce düşürüyordu (misafir Ortak Tarayıcı'ya
    // hiç gelemiyordu). İkisini de null'a normalize et.
    if ((msg.lobbyId || null) !== (state.activeLobbyId || null)) {
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
    
    // Supabase Kayıt (Gelen Oda Mesajı)
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      // Alıcılar (kendimiz + odadaki diğer kişiler - gönderen hariç)
      const otherNamesList = [state.myName || 'Anonim'];
      const otherIdsList = [state.myId || 'Anonim'];
      for (const [id, p] of state.peers.entries()) {
        if (id !== peerId) {
          otherNamesList.push(p.name || 'Anonim');
          otherIdsList.push(id);
        }
      }
      const otherNames = otherNamesList.join(', ');
      const otherIds = otherIdsList.join(', ');

      supabaseClient.from('mesaj').insert([
        {
          gonderen_id: peerId,
          gonderen_adi: peer.name || 'Anonim',
          alici_id: otherIds,
          alici_adi: otherNames,
          tip: 'oda',
          oda_adi: state.room || '',
          icerik: msg.text || '',
          is_censored: isCensored
        }
      ]).then(({ error }) => {
        if (error) console.error('Supabase room message insert error:', error);
      });
    }
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
         
         // Supabase Kayıt (Gelen Şifreli Oda Mesajı - Çözülmüş Hali)
         if (typeof supabaseClient !== 'undefined' && supabaseClient) {
           const otherNamesList = [state.myName || 'Anonim'];
           const otherIdsList = [state.myId || 'Anonim'];
           for (const [id, p] of state.peers.entries()) {
             if (id !== peerId) {
               otherNamesList.push(p.name || 'Anonim');
               otherIdsList.push(id);
             }
           }
           const otherNames = otherNamesList.join(', ');
           const otherIds = otherIdsList.join(', ');

           supabaseClient.from('mesaj').insert([
             {
               gonderen_id: peerId,
               gonderen_adi: peer.name || 'Anonim',
               alici_id: otherIds,
               alici_adi: otherNames,
               tip: 'oda',
               oda_adi: state.room || '',
               icerik: dec || '',
               is_censored: isCensored
             }
            ]).then(({ error }) => {
              if (error) console.error('Supabase room encrypted message insert error:', error);
            });
         }
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
      chatBlobUrls.push(url);
      const div = document.getElementById('file-' + msg.id);
      if (div) {
        if (isImageFile(f.meta.name, f.meta.mime)) {
          div.innerHTML = '';
          div.style.background = 'transparent';
          div.style.border = 'none';
          div.style.padding = '0';
          
          const imgWrap = document.createElement('div');
          imgWrap.className = 'img-wrap';
          imgWrap.style.marginTop = '0';
          imgWrap.innerHTML = `
            <img src="${url}" class="chat-img" />
            <a href="${url}" download="${f.meta.name}" class="dl-btn" title="İndir" aria-label="İndir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><g class="dl-arrow"><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></g></svg></a>
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
          aDl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> İndir`;
          btnGroup.appendChild(aDl);
          
          if (f.meta.mime.startsWith('text/') || f.meta.mime === 'application/pdf') {
            const aView = document.createElement('a');
            aView.href = url;
            aView.target = '_blank';
            aView.className = 'text-dl view-btn';
            aView.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> İçine Bak`;
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
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  analyser.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  if (peer) {
    peer.mediaStreamSource = source;
    peer.analyser = analyser;
    peer.silentGain = silentGain;
  }

  const data = new Uint8Array(analyser.frequencyBinCount);
  function check() {
    if (!state.peers.has(peerId)) {
      try { source.disconnect(); } catch(e) {}
      try { analyser.disconnect(); } catch(e) {}
      try { silentGain.disconnect(); } catch(e) {}
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

// Odayı yönetebilme yetkisi: kurucu her zaman yetkili, moderatörler ise
// kurucunun kendilerine verdiği kısmi yetkiyle (sustur/at) sınırlı.
function canManageRoom() {
  return !!(state.isRoomFounder || (state.moderators && state.moderators.has(state.myId)));
}

function isPeerModerator(id) {
  return !!(state.moderators && state.moderators.has(id));
}

// Bir aktörün (actorId) hedef oyuncuya (targetId) sustur/at uygulama yetkisi var mı?
// Kurucu herkese uygulayabilir. Moderatör yalnızca sıradan oyunculara uygulayabilir;
// kurucuya veya başka bir moderatöre uygulayamaz. Yetkisiz kişiler hiçbir şey yapamaz.
// Hem UI (butonları gizlemek) hem de gelen mesajları doğrulamak için kullanılır.
function canModerateTarget(actorId, targetId) {
  const actorIsFounder = actorId === state.founderId;
  const actorIsMod = isPeerModerator(actorId);
  if (!actorIsFounder && !actorIsMod) return false; // yetkisiz kişi hiçbir şey yapamaz
  if (actorIsFounder) return true;                   // kurucu her oyuncuya uygulayabilir
  // Aktör moderatör: kurucuya veya başka bir moderatöre dokunamaz.
  if (targetId === state.founderId) return false;
  if (isPeerModerator(targetId)) return false;
  return true;
}

// --- Kalıcı yasak (ban) sistemi -------------------------------------------
// Yasak listesi kurucu tarafında oda kimliğine göre localStorage'da tutulur;
// böylece kurucu uygulamayı kapatıp açsa bile yasaklar korunur.
function roomBansKey(roomId) { return 'teamsync_bans_' + roomId; }

function loadRoomBans(roomId) {
  try {
    const raw = localStorage.getItem(roomBansKey(roomId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (e) { return new Set(); }
}

function saveRoomBans(roomId) {
  try {
    localStorage.setItem(roomBansKey(roomId), JSON.stringify(Array.from(state.bannedIds || [])));
  } catch (e) { /* kota dolu olabilir; yoksay */ }
}

// Kurucu odadan ayrıldığında sahiplik boşta kalmasın: hâlâ odada olan en küçük
// id'li moderatör deterministik olarak yeni kurucu olur (tüm istemciler aynı
// seçimi yapar, split-brain olmaz). Moderatör yoksa oda sahipsiz kalır ve eski
// kurucu geri dönebilir. (item 4)
function handleFounderLeft(prevFounderId) {
  const candidates = Array.from(state.moderators || [])
    .filter(id => id === state.myId || state.peers.has(id))
    .sort();
  if (candidates.length === 0) {
    state.founderId = null;
    return;
  }
  const newFounderId = candidates[0];
  state.founderId = newFounderId;
  state.moderators.delete(newFounderId);
  if (newFounderId === state.myId) {
    state.isRoomFounder = true;
    // Yeni kurucu artık yetkili hello'sunu göndermeye başlar (moderatör/ban/oda
    // adı senkronizasyonu). Yasak listesini kendi diskine de yazar.
    if (state.room) saveRoomBans(state.room);
    // Kurucu olan biri susturulmuş kalmasın.
    if (state.serverMutedIds) state.serverMutedIds.delete(state.myId);
    if (state.serverMuted) { state.serverMuted = false; applyMicState(); }
    updateFounderMenuVisibility();
    showToast('Kurucu ayrıldı — sunucunun yeni sahibi sen oldun!', 'ok');
  }
  refreshUserRoleBadge(newFounderId);
  if (prevFounderId) refreshUserRoleBadge(prevFounderId);
}

// Oda listesindeki bir kullanıcının kurucu (fez) / yetkili (kalkan) rozetini
// addUser() ile aynı DOM yapısını yeniden kullanarak canlı günceller — sahiplik
// devri veya yetki verme/alma sonrası tam liste yeniden çizilmeden çalışır.
function refreshUserRoleBadge(id) {
  // Kendi satırımız listede 'self' data-uid'siyle tutuluyor (bkz: addUser
  // çağrısı), state.myId ile değil.
  const domId = id === state.myId ? 'self' : id;
  const li = document.querySelector(`[data-uid="${domId}"]`);
  if (!li) return;
  const av = li.querySelector('.av');
  const uname = li.querySelector('.uname');
  if (!av || !uname) return;
  av.querySelectorAll('.founder-fez, .mod-badge').forEach(el => el.remove());
  const isFounder = id === state.founderId;
  if (isFounder) {
    const img = document.createElement('img');
    img.src = 'assets/fez.svg';
    img.className = 'founder-fez';
    av.prepend(img);
    uname.classList.add('founder-name');
  } else {
    uname.classList.remove('founder-name');
    if (isPeerModerator(id)) {
      const badge = document.createElement('div');
      badge.className = 'mod-badge';
      badge.title = 'Yetkili';
      badge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>';
      av.prepend(badge);
    }
  }
}

// Kurucu menüsü düğmesi hem kurucuya hem de yetki verilmiş moderatörlere
// görünür olmalı; modal içindeki sunucu ayarları ve yetki/devir butonları
// yalnızca kurucuya özel kalır (bkz: founder-settings-modal click handler).
function updateFounderMenuVisibility() {
  const btn = document.getElementById('founder-settings');
  if (!btn) return;
  if (canManageRoom()) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
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

// Odadaki bir kullanıcının (sağ/sol tık menüsünden "Profili Görüntüle")
// kartını gösterir; avatar/rozetleri state.peers'tan, arkadaşlık ve
// aksiyonları mevcut showUserContextMenu mantığıyla aynı şekilde kurar.
function showRoomUserProfile(targetId, targetName) {
  const peer = state.peers.get(targetId);
  const isFriend = !!state.friends[targetId];

  const badges = [{ text: '🟢 Sunucuda', color: '#10b981' }];
  if (targetId === state.founderId) badges.unshift({ text: '👑 Kurucu', color: '#fbbf24' });
  else if (isPeerModerator(targetId)) badges.unshift({ text: '🛡️ Yetkili', color: '#3b82f6' });

  const actions = [
    {
      label: '💬 Mesaj Gönder',
      onClick: () => {
        if (!state.friends[targetId]) {
          state.friends[targetId] = { name: targetName, online: true, temporary: true };
        }
        openDM(targetId);
        document.getElementById('server-dm-modal').classList.remove('hidden');
      }
    }
  ];

  if (isFriend) {
    actions.push({
      label: '❌ Arkadaşlıktan Çıkar',
      danger: true,
      onClick: () => removeFriend(targetId)
    });
  } else {
    actions.push({
      label: '➕ Arkadaş Ekle',
      onClick: () => {
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
      }
    });
  }

  window.showProfileModal({
    name: targetName,
    avatar: peer ? peer.avatar : null,
    idLabel: `ID: ${targetId}`,
    badges,
    actions
  });
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

  // Profile Button
  const profileBtn = document.createElement('button');
  profileBtn.className = 'user-context-menu-item';
  profileBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> Profili Görüntüle';
  profileBtn.addEventListener('click', () => {
    showRoomUserProfile(targetId, targetName);
    menu.remove();
  });
  menu.appendChild(profileBtn);

  // Friend Option Button
  const friendBtn = document.createElement('button');
  friendBtn.className = 'user-context-menu-item';
  if (isFriend) {
    friendBtn.classList.add('danger');
    friendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="23" y1="11" x2="17" y2="11"></line></svg> Arkadaşı Sil';
    friendBtn.addEventListener('click', async () => {
      if (await window.showConfirm('⚠️ Arkadaşı Sil', `"${targetName}" arkadaşını silmek istediğinize emin misiniz?`)) {
        removeFriend(targetId);
        showToast('Arkadaş silindi', 'info');
      }
      menu.remove();
    });
  } else {
    friendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg> Arkadaş Ekle';
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
  msgBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> Mesaj Gönder';
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
  ctrlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg> Uzaktan Kontrol İste';
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

// Kilit düğmesinin görünümünü state.focusLocked ile eşitler. Kilit,
// closeAllCards gibi düğme dışı yollardan da sıfırlanabildiği için
// görünüm güncellemesi tek yerden yapılmalı.
function updateFocusLockBtn() {
  const btn = document.getElementById('focus-lock-btn');
  if (!btn) return;
  btn.innerHTML = state.focusLocked ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>' : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
  btn.style.background = state.focusLocked ? 'rgba(220, 38, 38, 0.8)' : 'rgba(0,0,0,0.6)';
  btn.style.borderColor = state.focusLocked ? 'rgba(239, 68, 68, 1)' : 'rgba(255,255,255,0.2)';
}

function toggleFocus(card) {
  if (state.focusLocked) return;
  const main = document.querySelector('.main');
  const focusArea = document.getElementById('focus-area');
  const grid = document.getElementById('grid');

  if (focusedCard === card) {
    // Odak alanı tam ekrandayken gizlenirse görünmez bir tam ekran katmanı
    // olarak kalıp tüm tıklamaları yutuyor — önce tam ekrandan çık.
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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

  // Supabase Kayıt (Oda Mesajı Gönderimi)
  console.log('cform submit triggered, message:', textToSend);
  console.log('supabaseClient exists?', !!supabaseClient);
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    console.log('Attempting to insert room message into Supabase...');
    
    // Alıcılar (odadaki diğer tüm kişiler)
    const otherNames = Array.from(state.peers.values()).map(p => p.name || 'Anonim').join(', ');
    const otherIds = Array.from(state.peers.keys()).join(', ');

    supabaseClient.from('mesaj').insert([
      {
        gonderen_id: state.myId || 'Anonim',
        gonderen_adi: state.myName || 'Anonim',
        alici_id: otherIds || null,
        alici_adi: otherNames || null,
        tip: 'oda',
        oda_adi: state.room || '',
        icerik: textToSend,
        is_censored: isCensored
      }
    ]).then(
      (result) => {
        console.log('Supabase room insert resolved:', result);
        if (result.error) console.error('Supabase room insert error:', result.error);
        else console.log('Oda mesajı Supabase\'e başarıyla kaydedildi.');
      },
      (error) => {
        console.error('Supabase room insert rejected:', error);
      }
    );
  }
  });

function saveChatToLocal(uid, name, text, isCensored) {
  // Oda sohbetlerini yerel depolamaya (localStorage) kaydetmiyoruz (Geçici oda sohbeti)
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

// Art arda aynı kişiden gelen birebir aynı mesaj (spam) her seferinde yeni
// balon açmak yerine mevcut balona yarı saydam "×N" rozeti ekleyerek gösterilir.
let lastChatEntry = null; // { uid, text, isCensored, el, count, badgeEl }

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
  const t = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  let notifyText = typeof text === 'string' ? text : String(text || '');
  if (isCensored) notifyText = "🚫 [Yapay Zeka Tarafından Sansürlendi]";

  if (lastChatEntry && lastChatEntry.uid === uid && lastChatEntry.text === text && lastChatEntry.isCensored === isCensored && wrap.contains(lastChatEntry.el)) {
    lastChatEntry.count++;
    if (!lastChatEntry.badgeEl) {
      const badge = document.createElement('span');
      badge.className = 'msg-repeat-badge';
      lastChatEntry.el.querySelector('.t').insertAdjacentElement('afterend', badge);
      lastChatEntry.badgeEl = badge;
    }
    lastChatEntry.badgeEl.textContent = `×${lastChatEntry.count}`;
    lastChatEntry.el.querySelector('.t').textContent = t;
    wrap.scrollTop = wrap.scrollHeight;
  } else {
    const div = document.createElement('div');
    div.className = 'msg';

    let msgHtml = escapeHtml(text);
    if (isCensored) {
      msgHtml = `<span style="color: #f87171; font-style: italic; font-weight: 500; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.2); display: inline-flex; align-items: center; gap: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg> Sansürlendi</span>`;
    }

    div.innerHTML = `<span class="n">${escapeHtml(name)}</span><span class="t">${t}</span><div>${msgHtml}</div>`;
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
    lastChatEntry = { uid, text, isCensored, el: div, count: 1, badgeEl: null };
  }

  if (uid !== 'self') {
    if (window.electronAPI && window.electronAPI.notify) {
      window.electronAPI.notify(name, notifyText);
    }
  }
}

function broadcast(msg) {
  if (state.activeLobbyId) {
    msg.lobbyId = state.activeLobbyId;
    
    // Automatically transition lobby status to playing on match start messages.
    // sb-start (Ortak Tarayıcı) HARİÇ: paylaşımlı tarayıcı her an katılınabilir
    // olacak şekilde tasarlandı (host beacon, 7/24 katılım), "maç başladı"
    // kavramı yok — dahil edilirse lobi oluşturulur oluşturulmaz Katıl butonu
    // kayboluyordu (status hemen 'playing' oluyordu).
    if (state.isLobbyHost && (msg.type === 'uno-sync' || msg.type === 'wt-load' || msg.type === 'poll_start' || msg.type === 'wheel_ready')) {
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

  const echoShield = document.getElementById('echo-shield');
  if (echoShield) {
    state.echoShield = localStorage.getItem('teamsync_echo_shield') === '1';
    echoShield.checked = state.echoShield;
    echoShield.onchange = () => {
      state.echoShield = echoShield.checked;
      localStorage.setItem('teamsync_echo_shield', state.echoShield ? '1' : '0');
      showToast(state.echoShield
        ? 'Yankı Kalkanı açık: karşı taraf konuşurken mikrofonun kısılır'
        : 'Yankı Kalkanı kapalı', 'info');
    };
  }

  mic.addEventListener('click', () => {
    if (state.serverMuted) {
      // Kurucu kendi susturmasını kaldırabilir (örn. susturulup sonra kurucu
      // yapılan biri). Sıradan oyuncu kaldıramaz.
      if (state.isRoomFounder) {
        state.serverMuted = false;
        if (state.serverMutedIds) state.serverMutedIds.delete(state.myId);
        broadcast({ type: 'force_unmute', targetId: state.myId });
        applyMicState();
        playSound('on');
        showToast('Kendi susturmanı kaldırdın.', 'ok');
        return;
      }
      showToast('Kurucu tarafından susturuldunuz. Sesinizi açamazsınız!', 'danger');
      return;
    }

    if (state.pttMode) {
      applyPttMode(false);
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
    document.getElementById('settings-ptt').checked = localStorage.getItem('teamsync_ptt_enabled') === '1';
    // Donanım hızlandırma tercihini main sürecinden (settings.json) oku.
    const hwEl = document.getElementById('settings-hwaccel');
    if (hwEl && window.electronAPI && window.electronAPI.getHardwareAcceleration) {
      window.electronAPI.getHardwareAcceleration().then(on => { hwEl.checked = !!on; }).catch(() => {});
    }
  });

  // Donanım hızlandırma anahtarı: tercihi kaydeder; yeniden başlatınca etkin olur.
  const hwAccelEl = document.getElementById('settings-hwaccel');
  if (hwAccelEl && window.electronAPI && window.electronAPI.setHardwareAcceleration) {
    hwAccelEl.addEventListener('change', (e) => {
      window.electronAPI.setHardwareAcceleration(e.target.checked);
      showToast('Donanım hızlandırma tercihi kaydedildi. Uygulamayı yeniden başlatınca etkin olacak.', 'info');
    });
  }

  document.getElementById('founder-settings').addEventListener('click', () => {
    document.getElementById('founder-settings-modal').classList.remove('hidden');
    document.getElementById('founder-friends-only').checked = state.friendsOnlyMode || false;
    document.getElementById('founder-sfw-mode').checked = state.sfwMode || false;
    document.getElementById('founder-game-mode').checked = state.gameMode || false;
    document.getElementById('founder-noise-suppression').checked = !!state.useAI;
    const bitrateEl = document.getElementById('founder-bitrate');
    if (bitrateEl) bitrateEl.value = String(getAudioBitrate());

    // Sunucu çapındaki ayarlar (arkadaş-only/AI koruması/oyun modu) ve devir/yetki
    // butonları yalnızca kurucuya özel; moderatörler yalnızca sustur/at yapabilir.
    const ownerOnly = document.getElementById('founder-owner-only-settings');
    ownerOnly.classList.toggle('hidden', !state.isRoomFounder);
    document.getElementById('founder-modal-title-text').textContent = state.isRoomFounder ? 'Kurucu Ayarları' : 'Oyuncu Yönetimi (Yetkili)';
    document.getElementById('founder-modal-subtitle').textContent = state.isRoomFounder
      ? 'Sadece sunucuyu kuran kişi bu ayarları görebilir.'
      : 'Kurucu tarafından sana yetki verildi: oyuncuları susturabilir veya atabilirsin.';

    // Populate Player List
    const listEl = document.getElementById('founder-player-list');
    listEl.innerHTML = '';

    // NOT: state.peers'taki peer objeleri kendi id'sini içermez (yalnızca
    // Map anahtarı olarak tutulur) — entries() ile alıp peerId'yi ayrıca
    // taşımak gerekiyor, yoksa targetId undefined gider.
    const peersArray = Array.from(state.peers.entries());
    if (peersArray.length === 0) {
      listEl.innerHTML = '<div class="muted" style="text-align: center; font-size: 13px;">Sunucuda kimse yok.</div>';
    } else {
      peersArray.forEach(([peerId, peer]) => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'space-between';
        div.style.background = 'rgba(255,255,255,0.05)';
        div.style.padding = '8px 12px';
        div.style.borderRadius = '6px';
        div.style.flexWrap = 'wrap';
        div.style.gap = '6px';

        const nameSpan = document.createElement('span');
        const roleTag = isPeerModerator(peerId) ? ' <span style="color:#60a5fa; font-size:11px; font-weight:normal;">(Yetkili)</span>' : '';
        nameSpan.innerHTML = escapeHtml(peer.name || 'Bilinmeyen') + roleTag;
        nameSpan.style.fontWeight = '500';

        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '8px';
        actionsDiv.style.flexWrap = 'wrap';

        // Sustur/Sesini Aç toggle: kişi hâlihazırda susturulmuşsa buton "Sesini
        // Aç" olur ve force_unmute gönderir; değilse "Sustur" olup force_mute
        // gönderir. (item 5)
        const isMuted = state.serverMutedIds && state.serverMutedIds.has(peerId);
        const muteBtn = document.createElement('button');
        muteBtn.className = 'btn-sec btn-sm';
        const muteIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12"></path><path d="M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2"></path><path d="M19 10v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
        const unmuteIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
        muteBtn.innerHTML = isMuted ? unmuteIcon + ' Sesini Aç' : muteIcon + ' Sustur';
        muteBtn.style.padding = '4px 8px';
        muteBtn.style.fontSize = '12px';
        muteBtn.onclick = () => {
          if (isMuted) {
            broadcast({ type: 'force_unmute', targetId: peerId });
            if (state.serverMutedIds) state.serverMutedIds.delete(peerId);
            showToast(`${peer.name} susturması kaldırıldı.`, 'info');
          } else {
            broadcast({ type: 'force_mute', targetId: peerId });
            if (!state.serverMutedIds) state.serverMutedIds = new Set();
            state.serverMutedIds.add(peerId);
            showToast(`${peer.name} susturuldu.`, 'info');
          }
          // Butonu güncellemek için paneli tazele.
          document.getElementById('founder-settings').dispatchEvent(new Event('click'));
        };

        const kickBtn = document.createElement('button');
        kickBtn.className = 'btn-sec btn-sm';
        kickBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> At';
        kickBtn.style.padding = '4px 8px';
        kickBtn.style.fontSize = '12px';
        kickBtn.style.color = 'var(--danger)';
        kickBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        kickBtn.onclick = async () => {
          if (!(await window.showConfirm('⚠️ Oyuncuyu At', `"${peer.name}" sunucudan atılsın mı?`))) return;
          broadcast({ type: 'kick_peer', targetId: peerId });
          showToast(`${peer.name} atıldı.`, 'info');
        };

        // Moderatörler kurucuyu veya başka moderatörü susturup atamaz —
        // bu durumda sustur/at butonları hiç gösterilmez. Kurucu için her
        // zaman gösterilir. (Sunucu tarafı doğrulama için bkz: canModerateTarget
        // kullanımı, kick_peer/force_mute mesaj işleyicileri.)
        if (canModerateTarget(state.myId, peerId)) {
          actionsDiv.appendChild(muteBtn);
          actionsDiv.appendChild(kickBtn);
        } else {
          const protectedNote = document.createElement('span');
          protectedNote.style.cssText = 'font-size:11px; color:var(--txt-mut);';
          protectedNote.textContent = 'Korumalı';
          actionsDiv.appendChild(protectedNote);
        }

        // Yetki verme/alma ve sahiplik devri yalnızca kurucuya özel.
        if (state.isRoomFounder) {
          const modBtn = document.createElement('button');
          modBtn.className = 'btn-sec btn-sm';
          const nowMod = isPeerModerator(peerId);
          modBtn.textContent = nowMod ? '🛡️ Yetkiyi Al' : '🛡️ Yetki Ver';
          modBtn.style.padding = '4px 8px';
          modBtn.style.fontSize = '12px';
          modBtn.onclick = async () => {
            const confirmMsg = nowMod
              ? `"${peer.name}" adlı kişinin yetkilisi (moderatör) yetkisi alınsın mı?`
              : `"${peer.name}" adlı kişiye yetkili (moderatör) yetkisi verilsin mi? Bu kişi oyuncuları susturabilir ve atabilir.`;
            if (!(await window.showConfirm(nowMod ? '⚠️ Yetkiyi Al' : '👑 Yetki Ver', confirmMsg))) return;
            if (nowMod) state.moderators.delete(peerId); else state.moderators.add(peerId);
            broadcast({ type: 'set_moderator', targetId: peerId, value: !nowMod });
            refreshUserRoleBadge(peerId);
            showToast(nowMod ? `${peer.name} adlı kişinin yetkisi alındı.` : `${peer.name} adlı kişiye yetki verildi.`, 'info');
            // Listeyi tazele
            document.getElementById('founder-settings').dispatchEvent(new Event('click'));
          };

          const transferBtn = document.createElement('button');
          transferBtn.className = 'btn-sec btn-sm';
          transferBtn.style.padding = '4px 8px';
          transferBtn.style.fontSize = '12px';
          transferBtn.style.color = '#fbbf24';
          transferBtn.style.borderColor = 'rgba(251, 191, 36, 0.3)';
          transferBtn.innerHTML = '👑 Devret';
          transferBtn.onclick = async () => {
            if (!(await window.showConfirm('👑 Sahipliği Devret', `Sunucu sahipliğini "${peer.name}" adlı kişiye devretmek istediğine emin misin? Bu işlemden sonra kurucu yetkisini kaybedeceksin.`))) return;
            const oldFounderId = state.myId;
            state.isRoomFounder = false;
            state.founderId = peerId;
            state.moderators.delete(peerId);
            broadcast({ type: 'transfer_ownership', targetId: peerId, fromId: oldFounderId });
            refreshUserRoleBadge(oldFounderId);
            refreshUserRoleBadge(peerId);
            updateFounderMenuVisibility();
            document.getElementById('founder-settings-modal').classList.add('hidden');
            showToast(`Sunucu sahipliği ${peer.name} adlı kişiye devredildi.`, 'info');
          };

          // Kalıcı yasak butonu (yalnızca kurucu). Yasaklanan kişi bu odaya bir
          // daha giremez. (item 3)
          const banBtn = document.createElement('button');
          banBtn.className = 'btn-sec btn-sm';
          banBtn.style.padding = '4px 8px';
          banBtn.style.fontSize = '12px';
          banBtn.style.color = 'var(--danger)';
          banBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
          banBtn.innerHTML = '🚫 Yasakla';
          banBtn.onclick = async () => {
            if (!(await window.showConfirm('🚫 Kalıcı Yasakla', `"${peer.name}" bu sunucudan kalıcı olarak yasaklansın mı? Bu kişi bir daha bu odaya giremez.`))) return;
            if (!state.bannedIds) state.bannedIds = new Set();
            state.bannedIds.add(peerId);
            if (state.room) saveRoomBans(state.room);
            broadcast({ type: 'ban_peer', targetId: peerId });
            removePeer(peerId);
            showToast(`${peer.name} kalıcı olarak yasaklandı.`, 'info');
            document.getElementById('founder-settings').dispatchEvent(new Event('click'));
          };

          actionsDiv.appendChild(modBtn);
          actionsDiv.appendChild(transferBtn);
          actionsDiv.appendChild(banBtn);
        }

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
    broadcast({ type: 'founder_settings_update', friendsOnlyMode: state.friendsOnlyMode });
    showToast(state.friendsOnlyMode ? 'Sadece arkadaşlar modu aktif!' : 'Sadece arkadaşlar modu kapatıldı.', 'info');
  });

  document.getElementById('founder-sfw-mode').addEventListener('change', (e) => {
    state.sfwMode = e.target.checked;
    if (state.sfwMode) loadAIFilter();
    broadcast({ type: 'founder_settings_update', sfwMode: state.sfwMode });
    showToast(state.sfwMode ? 'Yapay Zeka Koruması aktif!' : 'Yapay Zeka Koruması kapatıldı.', 'info');
  });

  document.getElementById('founder-game-mode').addEventListener('change', (e) => {
    state.gameMode = e.target.checked;
    broadcast({ type: 'founder_settings_update', gameMode: state.gameMode });
    showToast(state.gameMode ? 'Oyun Modu aktif (15FPS/Düşük İşlemci)!' : 'Oyun Modu kapatıldı.', 'info');
  });

  document.getElementById('founder-noise-suppression').addEventListener('change', async (e) => {
    if (!state.isRoomFounder) {
      e.target.checked = !!state.useAI;
      return;
    }

    const enabled = e.target.checked;
    e.target.disabled = true;
    try {
      await applyRoomNoiseSuppression(enabled);
      broadcast({ type: 'founder_settings_update', noiseSuppressionEnabled: enabled });
      showToast(enabled
        ? 'RNNoise gürültü engelleme tüm katılımcılar için açıldı.'
        : 'RNNoise gürültü engelleme tüm katılımcılar için kapatıldı.', 'ok');
    } catch (error) {
      console.error('RNNoise sunucu ayarı uygulanamadı:', error);
      e.target.checked = !enabled;
      await applyRoomNoiseSuppression(!enabled).catch(console.error);
      showToast('RNNoise ayarı değiştirilemedi.', 'error');
    } finally {
      e.target.disabled = false;
    }
  });

  // Ses bit hızı değişince: kendi göndericine anında uygula ve tüm katılımcılara
  // yayınla; herkes kendi göndericisine uygular. (item 7)
  const founderBitrateEl = document.getElementById('founder-bitrate');
  if (founderBitrateEl) {
    founderBitrateEl.addEventListener('change', (e) => {
      const kbps = parseInt(e.target.value, 10) || 128;
      state.audioBitrate = kbps;
      applyAudioBitrateToPeers();
      broadcast({ type: 'set_bitrate', value: kbps });
      showToast(`Ses kalitesi ${kbps} kbps olarak ayarlandı.`, 'ok');
    });
  }
  
  document.getElementById('settings-save').addEventListener('click', () => {
    localStorage.setItem('teamsync_turn_url', document.getElementById('turn-url').value.trim());
    localStorage.setItem('teamsync_turn_user', document.getElementById('turn-user').value.trim());
    localStorage.setItem('teamsync_turn_pass', document.getElementById('turn-pass').value.trim());
    const pttEnabled = document.getElementById('settings-ptt').checked;
    localStorage.setItem('teamsync_ptt_enabled', pttEnabled ? '1' : '0');
    // Odadaysak canlı uygula: bir sonraki sunucuya katılmayı beklemeye gerek yok
    if (state.room) applyPttMode(pttEnabled);
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
    updateFocusLockBtn();
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

// Push-to-Talk artık kişisel bir kullanıcı ayarı (ayarlar modalı) — oda
// başlarken VEYA oda içindeyken ayar değiştirildiğinde bu fonksiyon çağrılır.
function applyPttMode(enabled) {
  state.pttMode = enabled;
  const pttBtn = document.getElementById('ptt');
  if (enabled) {
    window.electronAPI.registerPTT('Space');
    if (pttBtn) pttBtn.classList.remove('hidden');
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
  } else {
    window.electronAPI.unregisterPTT();
    if (pttBtn) { pttBtn.classList.add('hidden'); pttBtn.classList.remove('active'); }
    state.pttActive = false;
    if (state.micEnabled === false && !state.deafened) setMicEnabled(true);
  }
}

// Kullanıcının KENDİ mikrofon tercihini ayarlar (self-mute). Kurucu susturması
// bu tercihi ezmez; yalnızca efektif duruma etki eder. Böylece kurucu susturmayı
// kaldırınca kullanıcı susturulmadan önce mikrofonu açıksa geri açılır, kendisi
// kapatmışsa kapalı kalır.
function setMicEnabled(enabled) {
  state.selfMicOn = !!enabled;
  applyMicState();
}

// İki bağımsız değişkeni birleştirip efektif mikrofon durumunu uygular:
//   efektif = selfMicOn (kendi tercihi) && !serverMuted (kurucu susturması).
function applyMicState() {
  const active = !!state.selfMicOn && !state.serverMuted;
  state.micEnabled = active; // efektif durum — diğer kod bunu okur
  if (state.localStream) {
    state.localStream.getAudioTracks().forEach(t => t.enabled = active);
  }
  if (state.rawMicStream) {
    state.rawMicStream.getAudioTracks().forEach(t => t.enabled = active);
  }
  const micBtn = document.getElementById('mic');
  if (micBtn) micBtn.classList.toggle('off', !active);
  broadcast({ type: 'state', mic: active });
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
      const sender = getVideoSender(peer.pc);
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
    const sender = getVideoSender(peer.pc);
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
      // Kayıt indirildi; chunk'lar tutulursa kaydın tamamı bellekte kalır
      state.recordedChunks = [];
      state.recorder = null;
      state.recordingStream = null;
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

// Aynı mesaj (ör. "X sana mesaj gönderdi") art arda spam gibi gelirse her
// seferinde yeni bir toast yığmak yerine görünürdeki toast'ı "(N)" sayacıyla
// güncelleyip zamanlayıcısını sıfırlıyoruz.
let lastToast = null; // { msg, type, el, count, hideTimeout, removeTimeout }

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  if (lastToast && lastToast.msg === msg && lastToast.type === type && document.body.contains(lastToast.el)) {
    lastToast.count++;
    lastToast.el.textContent = `${msg} (${lastToast.count})`;
    lastToast.el.classList.remove('show');
    void lastToast.el.offsetWidth; // reflow: tekrar tetiklemek için animasyonu sıfırla
    lastToast.el.classList.add('show');
    clearTimeout(lastToast.hideTimeout);
    clearTimeout(lastToast.removeTimeout);
    lastToast.hideTimeout = setTimeout(() => {
      lastToast.el.classList.remove('show');
      lastToast.removeTimeout = setTimeout(() => lastToast.el.remove(), 300);
    }, 3000);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);

  const entry = { msg, type, el: toast, count: 1, hideTimeout: null, removeTimeout: null };
  entry.hideTimeout = setTimeout(() => {
    toast.classList.remove('show');
    entry.removeTimeout = setTimeout(() => toast.remove(), 300);
  }, 3000);
  lastToast = entry;
}

// Ortak Tarayıcı durumunu ve webview'i tamamen sıfırlar. Hem kart kapanışında
// (closeAllCards) hem odadan çıkışta (disconnectApp) çağrılır: webview src'si
// sıfırlanmazsa kart gizli kalsa bile içindeki video sesi çalmaya devam ediyor.
function resetSharedBrowserState() {
  if (!state.sb) return;
  state.sb.joinedActivity = false;
  state.sb.host = null;
  state.sb.startedAt = 0;
  state.sb.lastUrl = '';
  state.sb.lastNavTs = 0;
  state.sb.lastVideoSyncTs = 0;
  state.sb.remoteVideoSyncTs = 0;
  state.sb.lastVideoState = null;
  state.sb.lastActionTs = 0;
  state.sb.lastRoutineSyncTs = 0;
  state.sb.authorized = [];
  state.sb.authTs = 0;
  // Reset gezinmesi yayınlanmasın diye "uzaktan uygulanmış" say
  state.sb.appliedRemoteUrl = 'https://duckduckgo.com';
  state.sb.remoteNavTs = Date.now();
  const sbWebview = document.getElementById('sb-webview');
  if (sbWebview) {
    // Önce çalan medyayı kesin durdur: kart bu noktada çoktan display:none
    // olabiliyor ve gizli webview'de src ataması güvenilir değil — eskiden
    // video arka planda sesiyle birlikte çalmaya devam edebiliyordu.
    if (typeof sbStopPlayback === 'function') sbStopPlayback();
    // Park hedefi about:blank (duckduckgo değil): anında commit olur, sayfayı
    // kesin öldürür ve gecikmiş bir uzak yüklemenin, kullanıcının sonraki
    // gezinmesini ezmesi gibi bir yarış bırakmaz. Host kartı yeniden açarken
    // duckduckgo'yu zaten kendisi yükler (act-sb handler'ındaki about:blank
    // kontrolü), misafir de kurucunun adresine gider.
    try { sbWebview.src = 'about:blank'; } catch (e) {}
    // Gezinmenin gerçekten tuttuğunu doğrula; tutmadıysa park edene dek dene
    // (gizli webview'de src ataması sessizce başarısız olabiliyor ve YouTube
    // oynatıcısı arka planda videoyu yeniden başlatabiliyordu)
    if (typeof sbEnsureParked === 'function') setTimeout(() => sbEnsureParked(0), 800);
  }
  if (typeof sbUpdateControlsUI === 'function') sbUpdateControlsUI();
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
  updateFocusLockBtn();

  // Kapanan kart tam ekran odaktaysa tam ekranı da bırak; yoksa gizlenmiş
  // odak alanı görünmez bir tam ekran katmanı olarak tüm tıklamaları yutar
  // (UNO'yu tam ekran + kilitliyken kapatınca UI'ın donması bunun sonucuydu).
  if (document.fullscreenElement && !(except && focusedCard && focusedCard.id === except)) {
    document.exitFullscreen().catch(() => {});
  }

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
    resetSharedBrowserState();
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
  // Odadan çıkarken Ortak Tarayıcı'yı sıfırla — kart aşağıda sadece
  // GİZLENİYOR; webview boşaltılmazsa izlenen videonun sesi odadan
  // çıktıktan sonra da arka planda çalmaya devam ediyordu.
  resetSharedBrowserState();
  if (window.electronAPI && window.electronAPI.stopCloudflared) window.electronAPI.stopCloudflared();
  if (state.localStream) state.localStream.getTracks().forEach(t => t.stop());
  const tb = document.querySelector('.top-bar'); if(tb) tb.style.display = 'none';
  if (state.screenStream) state.screenStream.getTracks().forEach(t => t.stop());
  if (state.processedStream) state.processedStream.getTracks().forEach(t => t.stop());
  if (state.rawMicStream) { state.rawMicStream.getTracks().forEach(t => t.stop()); state.rawMicStream = null; }
  if (state.rnnoiseFilterNode && window.RNNoiseSuppression) {
    window.RNNoiseSuppression.releaseFilter(state.rnnoiseFilterNode);
  }
  state.rnnoiseFilterNode = null;
  state.rnnoiseActive = false;
  state.rnnoiseStatus = 'off';
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
  lastChatEntry = null;
  releaseChatBlobUrls();
  
  const grid = document.getElementById('grid');
  document.querySelectorAll('.vcard').forEach(el => {
    if (el.id !== 'wb-card') el.classList.add('hidden');
  });
  if (!document.getElementById('empty-state')) {
    const empty = document.createElement('div');
    empty.id = 'empty-state';
    empty.className = 'empty';
    empty.innerHTML = '<h2><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;"><circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49"></path><path d="M7.76 16.24a6 6 0 0 1 0-8.49"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M4.93 19.07a10 10 0 0 1 0-14.14"></path></svg> Bağlantı Bekleniyor</h2><p>Aynı oda anahtarını yazan biri bağlanınca burada görünecek.</p>';
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
  state.moderators = new Set();
  state.serverMutedIds = new Set();
  state.bannedIds = new Set();
  // Sunucudan çıkınca susturma da kalkar (odaya özel).
  state.serverMuted = false;
  state.founderId = null;
  document.getElementById('founder-settings').classList.add('hidden');

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
    chatBlobUrls.push(url);
    if (isImageFile(file.name, file.type)) {
      div.innerHTML = '';
      div.style.background = 'transparent';
      div.style.border = 'none';
      div.style.padding = '0';
      
      const imgWrap = document.createElement('div');
      imgWrap.className = 'img-wrap';
      imgWrap.style.marginTop = '0';
      imgWrap.innerHTML = `
        <img src="${url}" class="chat-img" />
        <a href="${url}" download="${file.name}" class="dl-btn" title="İndir" aria-label="İndir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><g class="dl-arrow"><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></g></svg></a>
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
      aDl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> İndir`;
      btnGroup.appendChild(aDl);
      
      if (file.type.startsWith('text/') || file.type === 'application/pdf') {
        const aView = document.createElement('a');
        aView.href = url;
        aView.target = '_blank';
        aView.className = 'text-dl view-btn';
        aView.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> İçine Bak`;
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
    } else if (m.expired) {
      // saveDMs kota budaması içeriği düşürmüş: kırık <img> yerine bilgi ver
      contentHtml = `<span style="color: #94a3b8; font-style: italic;">${escapeHtml(m.fileName || 'Dosya')} — eski dosya, yer açmak için kaldırıldı</span>`;
    } else if (m.type === 'image') {
      contentHtml = `<img src="${m.content}" />`;
    } else if (m.type === 'file') {
      contentHtml = `<a href="${m.content}" download="${m.fileName || 'dosya'}" style="color: #60a5fa; text-decoration: underline;">📁 ${escapeHtml(m.fileName || 'Dosya')} İndir</a>`;
    }

    if (m.count > 1) {
      contentHtml += `<span class="msg-repeat-badge">×${m.count}</span>`;
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

// Aynı kişiden/bize art arda gelen birebir aynı metin mesajı (spam) yeni bir
// balon olarak eklenmez; son mesajın tekrar sayacı (×N) artırılır.
function pushDmMessage(friendId, entry) {
  const list = state.dms[friendId];
  const last = list[list.length - 1];
  if (last && entry.type === 'text' && last.type === 'text' && last.sender === entry.sender && last.content === entry.content && !!last.isCensored === !!entry.isCensored) {
    last.count = (last.count || 1) + 1;
    last.timestamp = entry.timestamp;
  } else {
    list.push(entry);
  }
}

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
  pushDmMessage(friendId, { sender: 'me', type: 'text', content: textToSend, isCensored: isCensored, timestamp: Date.now() });
  saveDMs();
  renderDMs();
  
  // Supabase Kayıt (Giden DM)
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    supabaseClient.from('mesaj').insert([
      {
        gonderen_id: state.friendId || 'Anonim',
        gonderen_adi: state.myName || 'Anonim',
        alici_id: friendId,
        alici_adi: state.friends[friendId]?.name || 'Arkadaş',
        tip: 'dm',
        icerik: textToSend,
        is_censored: isCensored
      }
    ]).then(({ error }) => {
      if (error) console.error('Supabase DM send error:', error);
    });
  }

  // MQTT send
  state.globalMqtt.publish(`teamsync/user/${friendId}/events`, JSON.stringify({
    type: 'dm_msg',
    fromId: state.friendId,
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
  reader.onload = async (e) => {
    const base64Data = e.target.result;
    const isImage = isImageFile(file.name, file.type);
    const msgType = isImage ? 'image' : 'file';

    // Local store
    if (!state.dms[friendId]) state.dms[friendId] = [];
    state.dms[friendId].push({ sender: 'me', type: msgType, content: base64Data, fileName: file.name, timestamp: Date.now() });
    saveDMs();
    renderDMs();

    // Supabase Kayıt (Giden DM Dosyası)
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      supabaseClient.from('mesaj').insert([
        {
          gonderen_id: state.friendId || 'Anonim',
          gonderen_adi: state.myName || 'Anonim',
          alici_id: friendId,
          alici_adi: state.friends[friendId]?.name || 'Arkadaş',
          tip: 'dm',
          icerik: `[${msgType === 'image' ? 'Görsel' : 'Dosya'}: ${file.name}] ${base64Data}`,
          is_censored: false
        }
      ]).then(({ error }) => {
        if (error) console.error('Supabase DM file send error:', error);
      });
    }

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
      await new Promise(r => setTimeout(r, 15));
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
    
    pushDmMessage(fromId, { sender: 'them', type: data.msgType, content: data.content, isCensored: isCensored, timestamp: Date.now() });
    saveDMs();
    if (state.activeDM === fromId) renderDMs();
    else showToast(`${state.friends[fromId]?.name || 'Biri'} sana mesaj gönderdi.`, 'info');

    // Supabase Kayıt (Gelen DM)
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      supabaseClient.from('mesaj').insert([
        {
          gonderen_id: fromId,
          gonderen_adi: state.friends[fromId]?.name || 'Arkadaş',
          alici_id: state.friendId || 'Anonim',
          alici_adi: state.myName || 'Anonim',
          tip: 'dm',
          icerik: data.content,
          is_censored: isCensored
        }
      ]).then(({ error }) => {
        if (error) console.error('Supabase DM receive error:', error);
      });
    }
  } 
  else if (data.type === 'dm_file_start') {
    state.incomingDMFiles[data.fileId] = {
      fromId: data.fromId,
      msgType: data.msgType,
      fileName: data.fileName,
      totalChunks: data.totalChunks,
      chunks: [],
      lastChunkAt: Date.now()
    };
  }
  else if (data.type === 'dm_file_chunk') {
    const fileData = state.incomingDMFiles[data.fileId];
    if (fileData) {
      fileData.lastChunkAt = Date.now();
      fileData.chunks[data.chunkIndex] = data.data;
      if (fileData.chunks.filter(c => c).length === fileData.totalChunks) {
        const fullBase64 = fileData.chunks.join('');
        state.dms[fromId].push({ sender: 'them', type: fileData.msgType, content: fullBase64, fileName: fileData.fileName, timestamp: Date.now() });
        saveDMs();
        delete state.incomingDMFiles[data.fileId];
        
        if (state.activeDM === fromId) renderDMs();
        else showToast(`${state.friends[fromId]?.name || 'Biri'} sana bir dosya gönderdi.`, 'info');

        // Supabase Kayıt (Gelen DM Dosyası)
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
          supabaseClient.from('mesaj').insert([
            {
              gonderen_id: fromId,
              gonderen_adi: state.friends[fromId]?.name || 'Arkadaş',
              alici_id: state.friendId || 'Anonim',
              alici_adi: state.myName || 'Anonim',
              tip: 'dm',
              icerik: `[${fileData.msgType === 'image' ? 'Görsel' : 'Dosya'}: ${fileData.fileName}] ${fullBase64}`,
              is_censored: false
            }
          ]).then(({ error }) => {
            if (error) console.error('Supabase DM file receive error:', error);
          });
        }
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
        
        // Profil fotoğrafını Supabase Storage'a yükle; başarılı olursa base64
        // yerine kalıcı public URL kullan. Yükleme başarısızsa base64'e düş.
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
        const publicUrl = await uploadAvatarToStorage(blob);
        const avatarSrc = publicUrl || dataUrl;

        state.myAvatar = avatarSrc;
        state.myAvatarHash = getAvatarHash(avatarSrc);
        document.getElementById('my-avatar-img').src = avatarSrc;
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
            avatarHash: state.myAvatarHash,
            // Supabase URL'i kısa olduğundan doğrudan presence ile paylaşılır;
            // arkadaşlar fotoğrafı base64 alışverişi olmadan yükleyebilir.
            avatar: (typeof avatarSrc === 'string' && avatarSrc.startsWith('http')) ? avatarSrc : undefined
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
      state.sb.authorized = [];
      state.sb.authTs = Date.now();
      if (typeof sbUpdateControlsUI === 'function') sbUpdateControlsUI();
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
        ${lob.activity !== 'sb' ? `<button class="btn-sec btn-sm spectate-btn" style="padding:4px 10px; font-size:12px;">İzle</button>` : ''}
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
    if (typeof sbUpdateControlsUI === 'function') sbUpdateControlsUI();
    // Host'un video senkron döngüsü yalnızca oynatma durumu değiştiğinde yayın
    // yapar; lobi üzerinden katılan bir misafir de aynı "geç katılan hiç
    // senkronlanamıyor" sorununu yaşamasın diye host'a haber ver.
    broadcast({ type: 'sb-joined' });
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
  
  // Shared Browser: izleyici (spectate) modu kaldırıldı — katılan herkes
  // etkileşimli olduğundan burada hiçbir sb kontrolü kilitlenmez.

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


