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
  window.electronAPI.getEnv().then((envVars) => {
    if (envVars && envVars.SUPABASE_URL && envVars.SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' && envVars.SUPABASE_ANON_KEY) {
      supabaseClient = window.supabase.createClient(envVars.SUPABASE_URL, envVars.SUPABASE_ANON_KEY);
      console.log('Supabase initialized successfully.');
    } else {
      console.warn('Supabase URL or Key missing in .env file');
    }
  }).catch(() => {});
}

const state = window.state;

// ==================== ARKA PLAN / GÜÇ YÖNETİMİ KÖPRÜSÜ ====================
// state.uiActive: pencere ön planda mı? SADECE görsel işleri (VU çubuğu,
// izleyici kilidi taraması gibi) atlamak için kullanılır. Ses işleme yolundaki
// hiçbir şey bu bayrakla durdurulmaz — aksi hâlde alt+tab'da ses bozulur.
state.uiActive = true;
if (window.electronAPI && typeof window.electronAPI.onWindowUiActive === 'function') {
  window.electronAPI.onWindowUiActive((active) => { state.uiActive = active !== false; });
} else {
  // Preload'da kanal açılmamışsa (contextBridge tuzağı) her şey ön plandaymış
  // gibi davranır: performans kazancı kaybolur ama işlevsellik bozulmaz.
  console.warn('onWindowUiActive preload üzerinden gelmedi — arka plan optimizasyonu devre dışı');
}

// Sesli oturum bildirimi: main süreç powerSaveBlocker'ı başlatır ve Windows
// süreç önceliğini yükseltir. Odaya girerken true, çıkarken false gönderilir.
function setVoiceSessionActive(active) {
  try {
    if (window.electronAPI && typeof window.electronAPI.setVoiceSession === 'function') {
      window.electronAPI.setVoiceSession(!!active);
    } else {
      console.warn('setVoiceSession preload üzerinden gelmedi — arka planda ses kısıtlaması önlenemez');
    }
  } catch (e) {}
}

function normalizeFilterText(text) {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    // Dotless ı is intentionally preserved: mapping it to i would turn the
    // ordinary Turkish word "sıkıntı" into the profanity substring "sik".
}

const badWordsList = ['amk', 'amq', 'aq', 'oç', 'piç', 'yarak', 'yarrak', 'amcık', 'sik', 'sikerim', 'siktir', 'orospu', 'göt', 'pezevenk', 'fuck', 'shit', 'bitch', 'asshole', 'döl', 'dol', 'meme', 'yarak', 'yarrag', 'yaraq', 'yarraq', 'sg', 'siktir', 'sktir', 'am', 'kaltak', 'sürtük', 'pç'];
const normalizedBadWords = [...new Set(badWordsList.map(normalizeFilterText))];

function isSubsequence(shortText, longText) {
  let i = 0;
  for (const ch of longText) {
    if (ch === shortText[i]) i++;
    if (i === shortText.length) return true;
  }
  return shortText.length > 0 && i === shortText.length;
}

function levenshteinDistance(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMinimum = current[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      rowMinimum = Math.min(rowMinimum, current[j]);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/** SFW matching intentionally errs on the side of blocking. */
function isProfaneText(text) {
  const normalized = normalizeFilterText(text);
  if (!normalized) return false;
  const compact = normalized.replace(/[^a-z0-9]+/g, '');
  const tokens = normalized.split(/[^a-z0-9]+/g).filter(Boolean);

  return normalizedBadWords.some((badWord) => {
    if (!badWord) return false;
    // Catches a profanity glued to another word or split by spaces/punctuation.
    const compactBadWord = badWord.replace(/[^a-z0-9]/g, '');
    const canMatchShortWord = compactBadWord.length >= 2 && badWord !== 'am';
    if ((badWord.length >= 3 || canMatchShortWord) && compact.includes(compactBadWord)) return true;
    // Keep the ordinary word "ama" clean, but still catch a punctuated "a.m".
    if (badWord === 'am' && /a[^a-z0-9]+m/i.test(normalized)) return true;
    return tokens.some((token) => {
      if (token === badWord) return true;
      // One/two character edits cover common typos and repeated letters.
      if (badWord.length >= 3 && token.length >= 3) {
        const typoLimit = badWord.length >= 6 ? 2 : 1;
        if (levenshteinDistance(token, badWord, typoLimit) <= typoLimit) return true;
      }
      // First/last-letter abbreviations such as "qy" for a longer profanity.
      return badWord.length >= 4 && token.length >= 2 && token.length < badWord.length &&
        token[0] === badWord[0] && token[token.length - 1] === badWord[badWord.length - 1] &&
        isSubsequence(token, badWord);
    });
  });
}

function filterProjection(text) {
  const compact = [];
  const originalIndexes = [];
  for (let i = 0; i < String(text || '').length; i++) {
    const normalizedChar = String(text[i])
      .toLocaleLowerCase('tr-TR')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '');
    for (const ch of normalizedChar) {
      if (/^[a-z0-9]$/i.test(ch)) {
        compact.push(ch);
        originalIndexes.push(i);
      }
    }
  }
  return { compact: compact.join(''), originalIndexes };
}

function maskCensoredSegment(segment) {
  return String(segment || '').replace(/[^\s]/gu, '█');
}

function censorProfaneText(text) {
  if (typeof text !== 'string' || !isProfaneText(text)) return text;

  const ranges = [];
  const projection = filterProjection(text);
  normalizedBadWords.forEach((badWord) => {
    const compactBadWord = badWord.replace(/[^a-z0-9]/g, '');
    if (compactBadWord.length < 2) return;
    let from = 0;
    while (from < projection.compact.length) {
      const found = projection.compact.indexOf(compactBadWord, from);
      if (found === -1) break;
      const first = projection.originalIndexes[found];
      const last = projection.originalIndexes[found + compactBadWord.length - 1];
      const originalSegment = first !== undefined && last !== undefined ? text.slice(first, last + 1) : '';
      const isUnseparatedShortAm = badWord === 'am' && !/[^a-z0-9]/i.test(originalSegment);
      if (first !== undefined && last !== undefined && !isUnseparatedShortAm) {
        let rangeStart = first;
        let rangeEnd = last + 1;
        while (rangeStart > 0 && /[^\p{L}\p{N}\s]/u.test(text[rangeStart - 1])) rangeStart--;
        while (rangeEnd < text.length && /[^\p{L}\p{N}\s]/u.test(text[rangeEnd])) rangeEnd++;
        ranges.push([rangeStart, rangeEnd]);
      }
      from = found + compactBadWord.length;
    }
  });

  // A fuzzy typo/abbreviation may not contain the exact bad-word substring;
  // in that case mask only its original token, not the surrounding sentence.
  const tokenPattern = /[\p{L}\p{N}]+/gu;
  let tokenMatch;
  while ((tokenMatch = tokenPattern.exec(text))) {
    const hasExactRange = ranges.some(([start, end]) =>
      start >= tokenMatch.index && end <= tokenPattern.lastIndex
    );
    if (isProfaneText(tokenMatch[0]) && !hasExactRange) {
      ranges.push([tokenMatch.index, tokenPattern.lastIndex]);
    }
  }

  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  ranges.forEach(([start, end]) => {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  });
  let result = text;
  for (let i = merged.length - 1; i >= 0; i--) {
    const [start, end] = merged[i];
    result = result.slice(0, start) + maskCensoredSegment(result.slice(start, end)) + result.slice(end);
  }
  return result;
}

function censoredTextHtml(text) {
  const safeText = escapeHtml(String(text || ''));
  const badge = '<span style="color:#f87171;font-size:11px;font-style:italic;margin-left:6px;">🛡 Sansürlendi</span>';
  return safeText ? `<span class="censored-text">${safeText}</span>${badge}` : badge;
}

function cleanText(text, isUsername = false) {
  if (!state.sfwMode || !text || typeof text !== 'string') return text;
  if (isProfaneText(text)) {
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
  const safeAvatar = safeAvatarUrl(base64Str);
  if (!safeAvatar || !state.sfwMode || !state.aiModel) return safeAvatar;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const preds = await state.aiModel.classify(img);
        const bad = preds.some(p => (p.className === 'Porn' || p.className === 'Hentai' || p.className === 'Sexy') && p.probability > 0.6);
        resolve(bad ? null : safeAvatar);
      } catch(e) { resolve(safeAvatar); }
    };
    img.onerror = () => resolve(safeAvatar);
    img.src = safeAvatar;
  });
}

const CHUNK_SIZE = 64 * 1024;
const MAX_DM_FILE_SIZE = 20 * 1024 * 1024;
// Room transfers are chunked and streamed from File.slice(), so the sender
// does not load the whole file at once. Receivers keep chunks in memory until
// the final Blob is created; keep a conservative aggregate cap for that peak.
const MAX_ROOM_FILE_SIZE = 250 * 1024 * 1024;
const MAX_PENDING_ROOM_BYTES = 300 * 1024 * 1024;
const MAX_PENDING_ROOM_FILES = 4;
const MAX_PENDING_DM_BYTES = 40 * 1024 * 1024;
const MAX_CONTROL_MESSAGE_SIZE = 512 * 1024;
const fileBuffer = new Map();
// Sohbette paylaşılan dosyaların blob URL'leri: revoke edilmezse dosyanın
// tüm içeriği uygulama kapanana kadar bellekte kalır (sohbet DOM'u
// temizlense bile). Odadan çıkarken topluca serbest bırakılır.
const chatBlobUrls = [];
function releaseChatBlobUrls() {
  chatBlobUrls.forEach(u => {
    try { URL.revokeObjectURL(u); } catch (e) {}
    // Koleksiyon kaydı da düşürülür, aksi halde Blob'lar registry'de asılı kalır.
    window.forgetChatMedia?.(u);
  });
  chatBlobUrls.length = 0;
}

// Bir dosyanın görsel olup olmadığını sağlam biçimde belirler.
// Bazı görseller boş/yanlış MIME ile gelir (panodan yapıştırma, uzantısız
// gönderim, application/octet-stream). Sadece MIME'a bakınca bunlar "dosya"
// sayılıp MOR .text-dl (yuvarlak kare) butonuyla gösteriliyordu; yuvarlak cam
// .dl-btn yerine. Bu yüzden MIME yetersizse dosya adı uzantısına da bakarız.
function isImageFile(name, mime) {
  if (mime && /^image\/(?!svg\+xml\b)/i.test(mime)) return true;
  return /\.(png|jpe?g|jfif|gif|webp|bmp|avif|ico|heic|heif|tiff?)$/i.test(name || '');
}

function isVideoFile(name, mime) {
  if (mime && mime.toLowerCase().startsWith('video/')) return true;
  return /\.(mp4|webm|mov|m4v|ogv)$/i.test(name || '');
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
    // qos:1 istenir: broker, publish tarafında QoS 1 ile gönderilen dosya/GIF
    // chunk'larını (teamsync/room/<id>/file) yine de min(pub,sub) kuralıyla
    // QoS 0'a düşürüp teslim ederdi — abonelik de QoS 1 istemeden publish'teki
    // QoS 1 hiçbir işe yaramaz.
    mqttClient.subscribe(`teamsync/room/${roomId}/#`, { qos: 1 });
    
    if (internetAnnounceInterval) clearInterval(internetAnnounceInterval);
    internetAnnounceInterval = setInterval(() => {
      if (mqttClient && mqttClient.connected) {
        mqttClient.publish(`teamsync/room/${roomId}/${myId}`, JSON.stringify({
          type: 'hello',
          id: myId,
          name: myName,
          // Kalıcı arkadaş kimliği (KNK-...): DM ve arkadaşlık istekleri
          // teamsync/user/<friendId>/events konusuna gider; oda içi oturum
          // UUID'siyle (myId) gönderilirse kimse dinlemediği için ulaşmaz.
          friendId: state.friendId || null,
          avatar: state.myAvatar || null,
          isRoomFounder: state.isRoomFounder,
          isModerator: state.moderators.has(myId),
          // Odaya giriş anı: kurucu ayrılınca halef "en erken giren" kuralıyla
          // seçilir; damga sahibinin kendisinden geldiği için herkeste aynıdır.
          joinedAt: state.joinedAt || 0,
          sfwMode: state.sfwMode,
          sfwChatBanEnabled: state.isRoomFounder ? !!state.sfwChatBanEnabled : undefined,
          sfwChatBanThreshold: state.isRoomFounder ? state.sfwChatBanThreshold : undefined,
          chatBannedIds: state.isRoomFounder ? Array.from(state.chatBannedIds || []) : undefined,
          turn: getShareableTurn(),
          // Yalnızca kurucu otoritesi taşınır: oda adı ve güncel yetkili
          // listesi kurucunun periyodik hello'suyla tüm katılımcılara (geç
          // katılanlar dahil) her 3 saniyede bir yayılır.
          roomName: state.isRoomFounder ? censorProfaneText(state.roomName) : undefined,
          moderators: state.isRoomFounder ? Array.from(state.moderators) : undefined,
          // Geç katılanların da öğrenmesi için kurucu otoritesiyle taşınan diğer
          // sunucu durumu: yasak listesi, susturulanlar ve ses bit hızı.
          bannedIds: state.isRoomFounder ? Array.from(state.bannedIds || []) : undefined,
          serverMutedIds: state.isRoomFounder ? Array.from(state.serverMutedIds || []) : undefined,
          audioBitrate: state.isRoomFounder ? getAudioBitrate() : undefined,
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
      if (!message || message.length > MAX_CONTROL_MESSAGE_SIZE + CHUNK_SIZE) return;
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
            if (f && header.fromId === f.peerId && chunk.length <= CHUNK_SIZE && f.received + chunk.length <= f.meta.size) {
              f.chunks.push(chunk);
              f.received += chunk.length;
              f.lastChunkAt = Date.now();
              const prog = document.getElementById(`prog-${header.id}`);
              if (prog) prog.style.width = (f.received / f.meta.size * 100) + '%';
            }
          } catch(err){}
        }
        return;
      }

      const data = JSON.parse(message.toString());
      if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string' || data.type.length > 64) return;
      if (typeof data.id !== 'string' || !isValidPeerId(data.id)) return;
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
          if (typeof data.sfwChatBanEnabled === 'boolean') state.sfwChatBanEnabled = data.sfwChatBanEnabled;
          if (Number.isFinite(data.sfwChatBanThreshold)) {
            state.sfwChatBanThreshold = Math.max(1, Math.min(100, Math.floor(data.sfwChatBanThreshold)));
          }
          if (Array.isArray(data.chatBannedIds)) state.chatBannedIds = new Set(data.chatBannedIds.filter(isValidPeerId).slice(0, 200));
          if (!state.isRoomFounder && data.roomName && state.roomName !== data.roomName) {
            state.roomName = state.sfwMode ? censorProfaneText(data.roomName) : data.roomName;
            const titleEl = document.getElementById('room-title');
            if (titleEl) titleEl.textContent = '# ' + state.roomName + (state.cryptoKey ? ' 🔒' : '');
          }
          if (Array.isArray(data.moderators)) {
            const incoming = new Set(data.moderators.filter(isValidPeerId).slice(0, 200));
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
            state.bannedIds = new Set(data.bannedIds.filter(isValidPeerId).slice(0, 200));
            if (state.bannedIds.has(state.myId)) {
              disconnectApp();
              document.getElementById('error-text').textContent = "Bu sunucudan kalıcı olarak yasaklandınız.";
              document.getElementById('error-modal').classList.remove('hidden');
            }
          }
          if (Array.isArray(data.serverMutedIds)) {
            state.serverMutedIds = new Set(data.serverMutedIds.filter(isValidPeerId).slice(0, 200));
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
        }
        applySharedTurn(data.turn);
        handlePeerDiscovered({ id: data.id, name: data.name, ip: 'internet', avatar: data.avatar, isFounder: data.isRoomFounder, isModerator: data.isModerator, friendId: data.friendId, joinedAt: data.joinedAt });
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
      } else if (data.type === 'room-broadcast' || data.type === 'room-private') {
        if (!data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)
          || (data.type === 'room-private' && data.target !== myId)) return;
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
  if (!isValidPeerId(id) || !signal || typeof signal !== 'object' || Array.isArray(signal)
      || typeof signal.type !== 'string' || signal.type.length > 32
      || !['offer', 'answer', 'ice', 'restart-req'].includes(signal.type)) return;
  if ((signal.sdp && (typeof signal.sdp !== 'object' || typeof signal.sdp.sdp !== 'string' || signal.sdp.sdp.length > 1_000_000))
      || (signal.candidate && JSON.stringify(signal.candidate).length > 100_000)) return;
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
      // Karşı taraf ekran sesi için fazladan bir ses m-line'ı gönderdiyse o
      // transceiver burada oluşmuştur; sahipleniyoruz ve 'recvonly'den
      // 'sendrecv'e çekiyoruz (kendi ekran sesimizi de yollayabilelim).
      // Eski sürümden gelen offer'da fazladan m-line YOKTUR → null döner,
      // her şey eskisi gibi çalışmaya devam eder.
      adoptScreenAudioTransceiver(peer);
      const answer = await peer.pc.createAnswer();
      answer.sdp = applyAudioSdpParams(answer.sdp);
      await peer.pc.setLocalDescription(answer);
      sendSignalToPeer(id, { type: 'answer', sdp: answer });
      // Biz zaten ekran paylaşıyorsak sesi yeni kurulan kanala ilet.
      pushScreenAudioIfSharing(peer);
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
  state.myAvatar = safeAvatarUrl(acc.avatar);
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
    const safeAccountAvatar = safeAvatarUrl(acc.avatar);
    if (safeAccountAvatar) {
      avatarHtml = `<img class="account-row-avatar" src="${escapeHtml(safeAccountAvatar)}" />`;
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
    
    const accountTrashButton = row.querySelector('.account-row-delete-btn');
    if (accountTrashButton) accountTrashButton.innerHTML = trashIconSvg();

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
  // Kota temizliği canlı mesajları bozmamalı. Büyük medya mevcut oturumda
  // görünmeye devam eder; gerekirse yalnızca localStorage'a yazılan kopyadan
  // eski dosya içeriği çıkarılır.
  const persistedDMs = Object.fromEntries(
    Object.entries(state.dms).map(([friendId, messages]) => [
      friendId,
      (messages || []).map(message => ({ ...message }))
    ])
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      localStorage.setItem('teamsync_dms', JSON.stringify(persistedDMs));
      return;
    } catch (e) {
      const fileMsgs = [];
      Object.values(persistedDMs).forEach(list => (list || []).forEach(m => {
        if ((m.type === 'image' || m.type === 'video' || m.type === 'file') && m.content) fileMsgs.push(m);
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
    invitesList.innerHTML = `<li class="muted" style="text-align: center; padding: 12px;">${t('invites.empty')}</li>`;
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
    flist.innerHTML = `<li class="muted menu-empty-friends" data-i18n="menu.noFriends">${escapeHtml(t('menu.noFriends'))}</li>`;
  } else {
    friendKeys.forEach(fId => {
      const f = state.friends[fId];
      const isOnline = f.online ? 'online' : '';
      // Oda bilgisi son presence paketinden kalmış olabilir. Çevrimdışı bir
      // arkadaş hiçbir zaman "Sunucuda" veya katılınabilir gösterilmemeli.
      const inRoom = Boolean(f.online && f.room);
      const safeFriendAvatar = safeAvatarUrl(f.avatar);
      const friendArg = safeInlineArg(fId);
      const avatarHtml = safeFriendAvatar
        ? `<img src="${escapeHtml(safeFriendAvatar)}" class="friend-avatar" />`
        : `<div class="friend-avatar" style="background: rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; font-size:16px;">👤</div>`;

      const li = document.createElement('li');
      li.className = 'friend-item';
      li.innerHTML = `
        <div class="friend-info" onclick="showFriendProfile(${friendArg})" style="cursor:pointer;" title="Profili Görüntüle">
          <div style="position:relative;">
            ${avatarHtml}
            <div class="friend-status ${isOnline}" id="${safeDomId('status-', fId)}" style="position:absolute; bottom:0; right:6px; border:2px solid #1e1e24; margin:0;"></div>
          </div>
          <div class="friend-copy">
            <b class="friend-name">${escapeHtml(f.name)}</b>
            ${inRoom ? '<div class="friend-presence"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="12"></circle></svg><span>Sunucuda</span></div>' : ''}
          </div>
        </div>
        <div class="friend-actions">
          <button class="icon-btn sm friend-action-chat" style="display: flex; align-items: center; justify-content: center;" onclick="openDM(${friendArg})" title="Mesaj Gönder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          </button>
          ${inRoom ? `<button class="icon-btn sm" style="display: flex; align-items: center; justify-content: center; background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.3);" onclick="requestJoinRoom(${friendArg})" title="Sunucusuna Katıl">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 12h4"></path><path d="M8 10v4"></path><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line></svg>
          </button>` : ''}
          <button class="icon-btn sm" style="display: flex; align-items: center; justify-content: center; background: ${f.isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(107, 114, 128, 0.2)'}; color: ${f.isMuted ? '#fca5a5' : '#9ca3af'}; border-color: ${f.isMuted ? 'rgba(239, 68, 68, 0.3)' : 'rgba(107, 114, 128, 0.3)'};" onclick="toggleMuteFriend(${friendArg})" title="${f.isMuted ? 'Sesi Aç' : 'Sessize Al / Engelle'}">
            ${f.isMuted 
              ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>` 
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`}
          </button>
          <button class="icon-btn sm" style="display: flex; align-items: center; justify-content: center; background: rgba(239, 68, 68, 0.2); color: #fca5a5; border-color: rgba(239, 68, 68, 0.3);" onclick="removeFriend(${friendArg})" title="Arkadaşlıktan Çıkar">
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
  if (f.online && f.room) badges.push({ text: '🟢 Sunucuda', color: '#10b981' });
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

// Gönderilen katılma isteği yanıtsız kalırsa kullanıcıya haber ver: karşı taraf
// çevrimdışıysa QoS-0 broker'da istek sessizce kaybolur, "bekleniyor" toast'ı
// sonsuza dek askıda kalmasın. Yanıt (kabul/ret) gelince zamanlayıcı iptal edilir.
let joinReqAnswerTimer = null;
let joinReqRetryTimer = null;

function publishJoinEvent(targetId, payload) {
  if (!isPersistentFriendId(targetId) || !state.globalMqtt || !state.globalMqtt.connected) return false;
  try {
    state.globalMqtt.publish(`teamsync/user/${targetId}/events`, JSON.stringify(payload), { qos: 1 });
    return true;
  } catch (error) {
    console.warn('Join event publish failed:', error && error.message ? error.message : error);
    return false;
  }
}

// Eski sürümlerde odada eklenen arkadaşlıklar kalıcı kimlik (KNK-...) yerine
// oturumluk oda UUID'siyle kaydedilebiliyordu. O konuya yapılan yayın karşıya
// ASLA ulaşmaz (kimse dinlemiyor) — istek/davet sessizce kaybolur. Sessiz
// kayıp yerine kullanıcıya kaydı yenilemesini açıkça söyle.
function isPersistentFriendId(id) {
  if (typeof id !== 'string' || !id) return false;
  // Bilinen-bozuk desen: çıplak UUID = oturumluk oda kimliği (state.myId).
  // KNK-'sız ama UUID olmayan kimlikler engellenmez (çok eski hesap formatı
  // hâlâ geçerli bir abonelik olabilir) — sadece kesin bozuk olanı yakala.
  const bareUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return !bareUuid.test(id);
}
function warnStaleFriendEntry(fId) {
  const f = state.friends[fId];
  showToast(`"${(f && f.name) || fId}" kaydı eski sürümden kalma, istek karşıya ulaşamıyor. Arkadaşlıktan çıkarıp yeniden ekleyin.`, 'warn');
}

window.requestJoinRoom = (fId) => {
  if (!isPersistentFriendId(fId)) { warnStaleFriendEntry(fId); return; }
  if (state.globalMqtt && state.globalMqtt.connected) {
    const request = {
      type: 'room_join_request',
      id: state.friendId,
      name: state.myName
    };
    clearInterval(joinReqRetryTimer);
    let attempts = 0;
    const publishRequest = () => {
      if (attempts++ >= 8 || !publishJoinEvent(fId, request)) {
        if (attempts >= 8) clearInterval(joinReqRetryTimer);
        return;
      }
    };
    publishRequest();
    joinReqRetryTimer = setInterval(publishRequest, 1500);
    showToast("Katılma isteği gönderildi, bekleniyor...", "info");
    clearTimeout(joinReqAnswerTimer);
    joinReqAnswerTimer = setTimeout(() => {
      clearInterval(joinReqRetryTimer);
      showToast("Katılma isteğine yanıt gelmedi; arkadaşın çevrimdışı olabilir.", "warn");
    }, 40000);
  } else {
    showToast("Bağlantı bekleniyor...", "warn");
  }
};

// Gelen katılma isteği: ekranı kaplayan modal yerine sağ üstte bildirim kartı
// (uzaktan kontrol isteğiyle aynı desen); kullanıcının o an yaptığı işi
// engellemez. 30 sn yanıtsız kalırsa otomatik ret — gönderen haber alır.
const JOIN_REQ_TIMEOUT_MS = 30000;
let joinReqTimer = null;

function showJoinRequestNote(id, name) {
  state.pendingJoinReq = { id, name };
  const nameEl = document.getElementById('join-req-name');
  if (nameEl) nameEl.textContent = name;
  const note = document.getElementById('join-request-note');
  if (!note) return;
  note.classList.remove('hidden');
  const bar = document.getElementById('join-req-timer-bar');
  if (bar) {
    bar.style.transition = 'none';
    bar.style.width = '100%';
    void bar.offsetWidth;
    bar.style.transition = `width ${JOIN_REQ_TIMEOUT_MS}ms linear`;
    bar.style.width = '0%';
  }
  clearTimeout(joinReqTimer);
  joinReqTimer = setTimeout(() => {
    if (state.pendingJoinReq && state.globalMqtt) {
      publishJoinEvent(state.pendingJoinReq.id, {
        type: 'room_join_declined',
        id: state.friendId,
        name: state.myName
      });
    }
    closeJoinRequestNote();
  }, JOIN_REQ_TIMEOUT_MS);
}

function closeJoinRequestNote() {
  clearTimeout(joinReqTimer);
  joinReqTimer = null;
  const note = document.getElementById('join-request-note');
  if (note) note.classList.add('hidden');
  state.pendingJoinReq = null;
}

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
  const safeProfileAvatar = safeAvatarUrl(avatar);
  if (safeProfileAvatar) {
    imgEl.src = safeProfileAvatar;
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

// ===== Lakap (yerel takma ad) ve kişi bazlı ses seviyesi ====================
// İkisi de SADECE bu cihazda localStorage'da tutulur, ağa asla gönderilmez.
// Anahtar kalıcı kullanıcı kimliğidir (cihaz id'si) — kişi odadan çıkıp girse,
// adını değiştirse bile lakap ve ses ayarı korunur. Lakabı yalnızca koyan görür.
const NICKNAMES_KEY = 'teamsync_nicknames';
const USER_VOLUMES_KEY = 'teamsync_user_volumes';
// Ekran paylaşımıyla gelen SİSTEM SESİ (müzik/oyun) mikrofondan BAĞIMSIZ
// ayarlanır: oyunun sesini kısarken kişinin konuşmasını kısmak istemeyiz.
// Bu yüzden ayrı bir localStorage haritası ve ayrı bir gain zinciri var —
// ama aynı yardımcı fonksiyonlar kullanılır, yalnızca "kanal" değişir.
const SCREEN_AUDIO_VOLUMES_KEY = 'teamsync_screen_audio_volumes';

function loadLocalJsonMap(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
  catch (e) { return {}; }
}
state.nicknames = loadLocalJsonMap(NICKNAMES_KEY);
state.userVolumes = loadLocalJsonMap(USER_VOLUMES_KEY);
state.screenAudioVolumes = loadLocalJsonMap(SCREEN_AUDIO_VOLUMES_KEY);

// Ses kanalları. 'mic' kişinin mikrofonu, 'screen' ekran paylaşımının sistem
// sesi. Aşağıdaki tüm ses yardımcıları (getUserVolume, ensurePeerBoostChain,
// rampPeerGain, applyPeerLimiter, applyPeerVolume, syncPeerVolumeControls...)
// bu tabloyu okuyarak çalışır; kanal başına kopyalanmış kod YOKTUR.
const AUDIO_CHANNEL_FIELDS = {
  mic: {
    store: 'userVolumes', key: USER_VOLUMES_KEY, label: 'Ses',
    el: 'audioEl', raw: 'rawAudioStream', src: 'gainSrc',
    gain: 'gainNode', lim: 'limiterNode', dest: 'gainDest', pump: 'volPump'
  },
  screen: {
    store: 'screenAudioVolumes', key: SCREEN_AUDIO_VOLUMES_KEY, label: 'Ekran sesi',
    el: 'screenAudioEl', raw: 'screenRawAudioStream', src: 'screenGainSrc',
    gain: 'screenGainNode', lim: 'screenLimiterNode', dest: 'screenGainDest', pump: 'screenVolPump'
  }
};
const AUDIO_CHANNELS = ['mic', 'screen'];
function channelFields(channel) { return AUDIO_CHANNEL_FIELDS[channel] || AUDIO_CHANNEL_FIELDS.mic; }

function getNickname(id) {
  const n = state.nicknames[id];
  return (typeof n === 'string' && n.trim()) ? n.trim() : null;
}

// Ekranda gösterilecek isim: lakap varsa lakap, yoksa gerçek isim.
function displayName(id, realName) {
  return getNickname(id) || realName;
}

function setNickname(id, nick) {
  const clean = (nick || '').trim().slice(0, 32);
  if (clean) state.nicknames[id] = clean;
  else delete state.nicknames[id];
  try { localStorage.setItem(NICKNAMES_KEY, JSON.stringify(state.nicknames)); } catch (e) {}
  refreshUserRowName(id);
}

// Oda listesindeki satırın isim metnini (lakap dahil) canlı günceller.
// Gerçek isim satırın dataset'inde tutulur (bkz: addUser / handlePeerDiscovered).
function refreshUserRowName(id) {
  const li = document.querySelector(`[data-uid="${id}"]`);
  if (!li) return;
  const t = li.querySelector('.uname-text');
  if (t) t.textContent = displayName(id, li.dataset.realName || '?');
}

// Kişi bazlı ses seviyesi: 0.0 – 2.0 (Discord'daki %0–%200 gibi).
// SAKLANAN DEĞER HER ZAMAN GAIN'DİR (doğrusal genlik çarpanı). Kullanıcıya
// gösterilen yüzde ise ALGISAL karşılığıdır: kulak logaritmik duyar, doğrusal
// bir slider'da %50 "yarı yükseklikte" duyulmaz (yalnızca ~3 dB düşer).
//   %0–100  : gain = (yüzde/100)^PERCEPTUAL_EXP  → %50 ≈ -10 dB (algısal yarı)
//   %100–200: doğrusal güçlendirme 1.0 → 2.0 (limiter ile kırpılmaya karşı korunur)
// Eğri her iki uçta sürekli ve monoton; %100 → gain 1.0 (birebir).
const PERCEPTUAL_EXP = 1.66;

function volumePercentToGain(pct) {
  const p = Math.min(Math.max(Number(pct) || 0, 0), 200);
  if (p <= 100) return Math.pow(p / 100, PERCEPTUAL_EXP);
  return 1 + (p - 100) / 100;
}

function volumeGainToPercent(gain) {
  const g = Math.min(Math.max(Number(gain) || 0, 0), 2);
  if (g <= 1) return Math.round(Math.pow(g, 1 / PERCEPTUAL_EXP) * 100);
  return Math.round(100 + (g - 1) * 100);
}

// channel: 'mic' (varsayılan) | 'screen'. Eski çağrılar parametresiz kaldığı
// için varsayılan her zaman mikrofon kanalıdır.
function getUserVolume(id, channel) {
  const F = channelFields(channel);
  const map = state[F.store] || {};
  const v = parseFloat(map[id]);
  if (!Number.isFinite(v)) return 1.0;
  return Math.min(Math.max(v, 0), 2);
}

// Slider'ların konuştuğu birim: algısal yüzde (0–200).
function getUserVolumePercent(id, channel) {
  return volumeGainToPercent(getUserVolume(id, channel));
}

function setUserVolumePercent(id, pct, channel) {
  setUserVolume(id, volumePercentToGain(pct), channel);
}

function setUserVolume(id, vol, channel) {
  const F = channelFields(channel);
  const map = state[F.store] || (state[F.store] = {});
  const v = Math.min(Math.max(vol, 0), 2);
  if (v === 1.0) delete map[id]; // varsayılan değeri saklamaya gerek yok
  else map[id] = v;
  try { localStorage.setItem(F.key, JSON.stringify(map)); } catch (e) {}
  const chan = AUDIO_CHANNEL_FIELDS[channel] ? channel : 'mic';
  applyPeerVolume(id, chan);
  syncPeerVolumeControls(id, chan);
}

// Aynı kişinin sesi iki yerden ayarlanabilir (sağ tık menüsü ve ekran/kamera
// kartındaki slider). Biri değişince diğeri sessizce güncellenir; ikisi de tek
// kaynağı (state.userVolumes) okur, paralel bir ses durumu tutulmaz.
// Her denetim kendi kanalını `data-volchan` ile taşır (yoksa 'mic'). channel
// verilmezse iki kanalın denetimleri de tazelenir.
function syncPeerVolumeControls(id, channel) {
  document.querySelectorAll(`[data-volfor="${id}"]`).forEach((el) => {
    const chan = el.dataset.volchan || 'mic';
    if (channel && chan !== channel) return;
    const pct = getUserVolumePercent(id, chan);
    const label = channelFields(chan).label;
    const role = el.dataset.volrole || (el.tagName === 'INPUT' ? 'slider' : 'value');
    if (role === 'slider') {
      el.value = String(pct); // adım yuvarlaması slider'a da yansısın (snap)
      el.title = pct === 0 ? 'Sessiz' : `${label}: %${pct}`;
    } else if (role === 'icon') {
      el.textContent = pct === 0 ? '🔇' : (pct > 100 ? '🔊' : '🔉');
      el.title = pct === 0 ? 'Sesi aç' : 'Sessize al';
    } else if (role === 'wrap') {
      el.classList.toggle('muted', pct === 0);
      return;
    } else {
      el.textContent = pct === 0 ? 'Sessiz' : `%${pct}`;
    }
    el.classList.toggle('is-muted', pct === 0);
    el.classList.toggle('is-boosted', pct > 100);
  });
}

// İnce ayar: Shift basılıyken slider %1'lik, normalde %5'lik adımlarla gider.
// (Adım "input" anında hesaplanır, böylece sürüklerken Shift'e basmak da işler.)
let volumeShiftHeld = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') volumeShiftHeld = true; });
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') volumeShiftHeld = false; });
window.addEventListener('blur', () => { volumeShiftHeld = false; });

function quantizeVolumePercent(pct) {
  const p = Math.min(Math.max(Number(pct) || 0, 0), 200);
  return volumeShiftHeld ? Math.round(p) : Math.round(p / 5) * 5;
}

// Sessize alma: seviyeyi %0 yapar, önceki seviyeyi hatırlar (tekrar basınca
// oraya döner). Ayrı bir "mute" durumu tutulmaz — tek kaynak yine ses seviyesi.
const peerVolumeBeforeMute = new Map();
function togglePeerMute(id, channel) {
  const chan = AUDIO_CHANNEL_FIELDS[channel] ? channel : 'mic';
  const memoKey = `${chan}:${id}`; // mikrofon ve ekran sesi birbirinin hafızasını ezmesin
  const pct = getUserVolumePercent(id, chan);
  if (pct === 0) {
    const prev = peerVolumeBeforeMute.get(memoKey);
    setUserVolumePercent(id, Number.isFinite(prev) && prev > 0 ? prev : 100, chan);
  } else {
    peerVolumeBeforeMute.set(memoKey, pct);
    setUserVolumePercent(id, 0, chan);
  }
  return getUserVolumePercent(id, chan) === 0;
}

// %100 üzeri güçlendirme <audio>.volume ile mümkün değil; WebAudio gain zinciri
// kurulur: rawStream → source → gain → destination → audioEl. audioEl oynatıcı
// olarak kalır, böylece hoparlör seçimi (setSinkId), sağırlaştırma (muted) ve
// ses yolu bekçisi (logVoicePathReport) aynen çalışmaya devam eder.
// Chromium bilinen davranışı: uzak WebRTC akışı bir medya elemanına bağlı
// değilse WebAudio'ya veri akmaz — bu yüzden sessiz bir "pompa" Audio tutulur.
// channel: 'mic' | 'screen' — ikisi de aynı zinciri kurar, yalnızca peer
// üzerindeki alan adları farklıdır (bkz. AUDIO_CHANNEL_FIELDS).
function ensurePeerBoostChain(peer, channel) {
  const F = channelFields(channel);
  if (peer[F.gain] || !peer[F.raw] || !peer[F.el]) return;
  try {
    if (!state.remoteAudioCtx) state.remoteAudioCtx = new AudioContext();
    const ctx = state.remoteAudioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(peer[F.raw]);
    const gain = ctx.createGain();
    // Yumuşak limiter: %100 üzerinde güçlendirirken tepe noktaları 0 dBFS'i
    // aşıp kırpılmasın (cızırtı/bozulma). ratio=1 & threshold=0 iken tamamen
    // saydamdır; bu yüzden zincirde hep durur, yalnızca parametreleri değişir
    // (düğüm bağlantısını değiştirmek tık sesi üretirdi). bkz. applyPeerLimiter
    const limiter = ctx.createDynamicsCompressor();
    const dest = ctx.createMediaStreamDestination();
    src.connect(gain);
    gain.connect(limiter);
    limiter.connect(dest);
    peer[F.lim] = limiter;
    applyPeerLimiter(peer, 1.0, channel);
    const pump = new Audio();
    pump.srcObject = peer[F.raw];
    pump.muted = true;
    pump.volume = 0;
    pump.play().catch(() => {});
    peer[F.pump] = pump;
    peer[F.src] = src;
    peer[F.gain] = gain;
    peer[F.dest] = dest;
    peer[F.el].srcObject = dest.stream;
    peer[F.el].play().catch(() => {});
  } catch (e) {
    console.warn('Ses güçlendirme zinciri kurulamadı, %100 ile sınırlanacak:', e);
    peer[F.gain] = null;
    peer[F.lim] = null;
  }
}

// gain.value'yu doğrudan atamak örnek sınırında basamak (zipper/klik) sesi
// üretir. ~20 ms'lik üstel yumuşatma ile hedefe gidilir; slider sürüklenirken
// onlarca kez çağrılsa bile çatırtı olmaz.
const PEER_GAIN_RAMP = 0.02;
function rampPeerGain(peer, value, channel) {
  const F = channelFields(channel);
  const node = peer[F.gain];
  const ctx = state.remoteAudioCtx;
  if (!node) return;
  if (!ctx) { node.gain.value = value; return; }
  try {
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(value, now, PEER_GAIN_RAMP);
  } catch (e) {
    node.gain.value = value;
  }
}

// Limiter yalnızca güçlendirmede (userVol > 1.0) devreye girer; altında
// ratio=1/threshold=0 ile tamamen saydamdır (sesi hiç renklendirmez).
function applyPeerLimiter(peer, userVol, channel) {
  const lim = peer[channelFields(channel).lim];
  if (!lim) return;
  const ctx = state.remoteAudioCtx;
  const now = ctx ? ctx.currentTime : 0;
  const boosting = userVol > 1.0;
  const set = (param, v) => {
    try { param.setValueAtTime(v, now); } catch (e) { try { param.value = v; } catch (e2) {} }
  };
  set(lim.threshold, boosting ? -3 : 0);
  set(lim.knee, boosting ? 3 : 0);
  set(lim.ratio, boosting ? 20 : 1);
  set(lim.attack, 0.003);
  set(lim.release, 0.25);
}

// Tek yetkili ses uygulayıcısı: kişi ayarı × ana ses × sağırlaştırma durumunu
// peer'in oynatıcısına uygular. Sağırlaştırma, ana ses ve kişi slider'ı hep
// bunu çağırır; böylece birbirlerinin ayarını ezmezler.
// channel verilmezse HER İKİ kanal da uygulanır — böylece ana ses / sağırlaştırma
// gibi eski (parametresiz) çağrılar ekran sesini de kapsar.
function applyPeerVolume(peerId, channel) {
  if (!AUDIO_CHANNEL_FIELDS[channel]) {
    AUDIO_CHANNELS.forEach(c => applyPeerVolume(peerId, c));
    return;
  }
  const peer = state.peers.get(peerId);
  const F = channelFields(channel);
  const el = peer && peer[F.el];
  if (!peer || !el) return; // ekran sesi hiç gelmemişse sessizce çık
  const userVol = getUserVolume(peerId, channel);
  if (state.deafened) {
    el.muted = true;
    el.volume = 0.0;
    if (peer[F.gain]) rampPeerGain(peer, 0.0, channel);
    return;
  }
  el.muted = false;
  // Zincir yalnızca güçlendirme için değil, KISMA için de kurulur: <audio>.volume
  // anlık atlar (çatırtı), gain düğümü yumuşak geçer. Kullanıcı sesi hiç
  // ellemediyse (tam %100) fazladan düğüm kurulmaz — varsayılan yol aynen kalır.
  if (userVol !== 1.0) ensurePeerBoostChain(peer, channel);
  const master = Math.min(Math.max(state.volume ?? 1.0, 0), 1);
  if (peer[F.gain]) {
    applyPeerLimiter(peer, userVol, channel);
    rampPeerGain(peer, userVol, channel);
    el.volume = master;
  } else {
    el.volume = Math.min(master * Math.min(userVol, 1.0), 1.0);
  }
}

// Bekçinin (logVoicePathReport) "oynatıcı sustu" tespitinde kullanılır:
// kullanıcı bu kişiyi bilerek %0'a çektiyse ses yolu sağlıklıdır.
function intendedPeerVolumeIsZero(peerId) {
  if (state.deafened) return true;
  const master = Math.min(Math.max(state.volume ?? 1.0, 0), 1);
  return master === 0 || getUserVolume(peerId) === 0;
}

// showConfirm ile aynı görsel dili taşıyan tek satırlık metin giriş modalı.
// Çözülen değer: girilen metin (boş olabilir) ya da iptalse null.
window.showPrompt = (title, message, defaultValue = '', placeholder = '') => {
  return new Promise((resolve) => {
    let modal = document.getElementById('generic-prompt-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'generic-prompt-modal';
      modal.className = 'hidden';
      modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 10000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px);';
      modal.innerHTML = `
        <div class="mcard" style="background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); width: 400px; padding: 24px; text-align: center;">
          <h3 id="generic-prompt-title" style="margin-top: 0; margin-bottom: 10px; font-size: 20px; color: #f8fafc;"></h3>
          <p id="generic-prompt-message" style="margin-bottom: 16px; color: #94a3b8; font-size: 14px; line-height: 1.5;"></p>
          <input id="generic-prompt-input" type="text" maxlength="32" style="width: 100%; box-sizing: border-box; padding: 10px 12px; margin-bottom: 20px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(15,23,42,0.8); color: #f8fafc; font-size: 15px; outline: none;" />
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="generic-prompt-ok" class="btn-pri" style="flex: 1; padding: 10px; border-radius: 8px; background: var(--acc, #6366f1); border: none; color: white; font-weight: bold; cursor: pointer; transition: 0.2s;">Kaydet</button>
            <button id="generic-prompt-cancel" class="btn-sec" style="flex: 1; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; font-weight: bold; cursor: pointer; transition: 0.2s;">İptal</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('generic-prompt-title').innerText = title;
    document.getElementById('generic-prompt-message').innerText = message;
    const input = document.getElementById('generic-prompt-input');
    input.value = defaultValue || '';
    input.placeholder = placeholder || '';
    modal.classList.remove('hidden');

    const okBtn = document.getElementById('generic-prompt-ok');
    const cancelBtn = document.getElementById('generic-prompt-cancel');

    const cleanup = () => {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    };
    const onOk = () => { cleanup(); resolve(input.value); };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = (e) => {
      if (e.key === 'Enter') onOk();
      else if (e.key === 'Escape') onCancel();
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    setTimeout(() => input.focus(), 50);
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

function markFriendOffline(friend) {
  if (!friend) return;
  friend.online = false;
  friend.room = null;
  friend.lastSeen = 0;
}

function trashIconSvg() {
  return `<svg class="trash-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path class="trash-icon-lid" d="M4 6.25h16v2H4zM8.2 4.25l.7-2h6.2l.7 2z" />
    <path class="trash-icon-body" d="M6.25 8.25h11.5l-1 13.25H7.25z" />
    <path class="trash-icon-lines" d="M9.5 11v7.25M12 11v7.25M14.5 11v7.25" />
  </svg>`;
}

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

// Arkadaşlık/presence kanalı da oda sinyalleşmesiyle aynı zaafı taşıyordu:
// TEK sabit broker (broker.emqx.io) down/hız-sınırlı/engelli olduğunda
// arkadaşlık isteği, sunucuya katılma isteği ve DM'ler sessizce HİÇ
// iletilmiyordu ("istek atılmıyor" şikayetinin kök nedeni). Aynı deterministik
// SIGNALING_BROKERS listesi ve rotasyon deseni burada da kullanılır — tam
// kesintide tüm istemciler sıradaki aynı yedek broker'da yeniden buluşur.
let globalMqttSessionId = 0;

function setupGlobalMQTT() {
  if (state.globalMqtt) return;
  connectGlobalBroker(0, ++globalMqttSessionId);
}

function connectGlobalBroker(idx, session) {
  if (session !== globalMqttSessionId) return; // çıkış/hesap değişimi: bayat rotasyon
  const brokerIndex = idx % SIGNALING_BROKERS.length;
  const brokerUrl = SIGNALING_BROKERS[brokerIndex];
  console.log(`🔗 Arkadaşlık broker'ı deneniyor (${brokerIndex + 1}/${SIGNALING_BROKERS.length}): ${brokerUrl}`);

  const client = mqtt.connect(brokerUrl, {
    clientId: 'glob-' + state.friendId + '-' + state.myId,
    keepalive: 60,
    reconnectPeriod: 1000,
    connectTimeout: 6000
  });
  state.globalMqtt = client;
  let reconnectAttempts = 0;

  // Aktif broker art arda 3 denemede bağlanamazsa ölü sayıp sıradakine geç
  // (setupInternetSignaling'deki rotate deseninin birebir karşılığı).
  const rotate = () => {
    if (session !== globalMqttSessionId || state.globalMqtt !== client) return;
    console.warn(`⚠️ Arkadaşlık broker'ı yanıt vermiyor (${brokerUrl}), sıradakine geçiliyor...`);
    try { client.end(true); } catch (e) {}
    connectGlobalBroker(brokerIndex + 1, session);
  };

  client.on('reconnect', () => {
    if (state.globalMqtt !== client) return;
    reconnectAttempts++;
    if (reconnectAttempts >= 3) rotate();
  });

  client.on('error', (err) => {
    if (state.globalMqtt !== client) return;
    console.error('MQTT global connection error:', err);
  });

  client.on('connect', () => {
    // Hesap değiştirme yarışı: çıkışta state.globalMqtt null'lanır ama eski
    // istemcinin geciken connect'i hâlâ ateşlenebilir — artık bizim değilse kapat.
    if (state.globalMqtt !== client) {
      try { client.end(true); } catch (e) {}
      return;
    }
    reconnectAttempts = 0;
    console.log(`🔗 Global MQTT (Arkadaşlık) bağlandı: ${brokerUrl}`);
    // qos:1: dm_file_start/dm_file_chunk publish'leri QoS 1 ile atılıyor;
    // abonelik QoS 0 kalırsa broker teslimde min(pub,sub)=0'a düşürür ve
    // büyük GIF/dosya transferlerinde tek chunk kaybı yine sessizce oluşur.
    client.subscribe(`teamsync/user/${state.friendId}/events`, { qos: 1 });

    // Açılışta eski oturumdan kalan "online" bayrağını sıfırla (yanlış çevrimiçi
    // göstermesin); gerçekten çevrimiçi olanlar en geç 5 sn içinde presence ile
    // yeniden işaretlenir.
    Object.keys(state.friends).forEach(fId => {
      markFriendOffline(state.friends[fId]);
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

          // Uygulama düzgün kapanırken açıkça online:false yayınlar. Önceki kod
          // her presence paketini çevrimiçi kabul ettiği için bu paket bile
          // arkadaşın yeşil görünmesine neden oluyordu.
          if (data.online === false) {
            markFriendOffline(state.friends[data.id]);
            if (wasOnline || oldRoom) renderFriends();
            return;
          }

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
            showJoinRequestNote(data.id, data.name);
            playSound('on');
            if (window.electronAPI && window.electronAPI.notify) window.electronAPI.notify('Katılma İsteği', `${data.name} odanıza katılmak istiyor.`);
          } else {
            state.globalMqtt.publish(`teamsync/user/${data.id}/events`, JSON.stringify({
              type: 'room_join_declined',
              id: state.friendId,
              name: state.myName
            }), { qos: 1 });
          }
        } else if (data.type === 'room_join_accepted') {
          if (state.joinAcceptanceRoom === data.roomId) return;
          state.joinAcceptanceRoom = data.roomId;
          clearInterval(joinReqRetryTimer);
          clearTimeout(joinReqAnswerTimer);
          showToast(`${data.name} isteğini kabul etti, bağlanılıyor...`, 'ok');
          document.getElementById('step-action').classList.add('hidden'); document.querySelector('.login-card').classList.remove('expanded');
          const joinIdInput = document.getElementById('join-id');
          const joinPwInput = document.getElementById('join-password');
          const btnJoin = document.getElementById('btn-join');
          if(joinIdInput && btnJoin) {
             // Route broker-driven joins through the same visible form state
             // as a manual join. This avoids starting getUserMedia and the
             // room operation while the action screen is still mounted.
             document.getElementById('step-join')?.classList.remove('hidden');
             joinIdInput.value = data.roomId;
             if(joinPwInput) joinPwInput.value = data.password || '';
             setTimeout(() => btnJoin.click(), 0);
          }
        } else if (data.type === 'room_join_declined') {
          clearInterval(joinReqRetryTimer);
          clearTimeout(joinReqAnswerTimer);
          showToast(`${data.name} katılma isteğini reddetti veya bir sunucuda değil.`, 'warn');
        } else if (data.type === 'server_invite_received') {
          // Davet spamı koruması: aynı kişiden 5 sn içinde gelen tekrar davetleri yok say
          const inviteNow = Date.now();
          if (!state.lastInviteReceivedAt) state.lastInviteReceivedAt = {};
          if (inviteNow - (state.lastInviteReceivedAt[data.id] || 0) >= 5000) {
            state.lastInviteReceivedAt[data.id] = inviteNow;
            showServerInviteNotification({ id: data.id, name: data.name, roomId: data.roomId, password: data.password });
          }
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
      markFriendOffline(state.friends[fId]);
      changed = true;
    }
  });

  // Sadece noktayı söndürmek yeterli değil: "Sunucuda" metni ve katıl butonu
  // da DOM'dan kaldırılmalı.
  if (changed) renderFriends();

  // Yarım kalan DM dosya transferleri: gönderen ortada çevrimdışı olursa
  // biriken base64 chunk'lar süresiz bellekte kalıyordu — 2 dk sessiz kalan
  // transfer düşürülür (aktif transferde her chunk lastChunkAt'i tazeler)
  Object.keys(state.incomingDMFiles || {}).forEach(fileId => {
    const f = state.incomingDMFiles[fileId];
    if (f && now - (f.lastChunkAt || 0) > 120000) {
      // Önceden tamamen sessizdi: chunk kaybı yüzünden yarım kalan bir GIF/dosya
      // hiçbir iz bırakmadan yok oluyordu. En azından alıcıya bildiriyoruz.
      const senderName = state.friends[f.fromId]?.name || 'Biri';
      showToast(`${senderName} bir dosya/GIF gönderdi ama transfer tamamlanamadı (bağlantı kopması). Tekrar göndermesini isteyebilirsin.`, 'warn');
      delete state.incomingDMFiles[fileId];
    }
  });

  // Oda dosya transferleri de bağlantı kopunca alınan Uint8Array parçalarını
  // bellekte tutmamalı. Aktif olmayan transferleri süre aşımında düşür.
  fileBuffer.forEach((f, fileId) => {
    if (f && now - (f.lastChunkAt || 0) > 120000) fileBuffer.delete(fileId);
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

let activeRoomOperation = null;

function beginRoomOperation(kind, roomLabel) {
  if (activeRoomOperation) activeRoomOperation.cancelled = true;
  const operation = { kind, roomLabel, cancelled: false };
  activeRoomOperation = operation;

  const modal = document.getElementById('room-operation-modal');
  const title = document.getElementById('room-operation-title');
  const detail = document.getElementById('room-operation-detail');
  const cancel = document.getElementById('room-operation-cancel');
  if (title) title.textContent = kind === 'join'
    ? `${roomLabel} Odasına Katılıyor`
    : `${roomLabel} Odası Oluşturuluyor`;
  if (detail) detail.textContent = kind === 'join'
    ? 'Oda aranıyor ve güvenli bağlantı hazırlanıyor…'
    : 'Oda ve ses bağlantısı hazırlanıyor…';
  if (modal) modal.classList.remove('hidden');

  if (cancel) cancel.onclick = () => {
    if (activeRoomOperation !== operation) return;
    operation.cancelled = true;
    state.isJoining = false;
    if (state.joinTimeout) {
      clearTimeout(state.joinTimeout);
      state.joinTimeout = null;
    }
    finishRoomOperation(operation);
    disconnectApp();

    const joinButton = document.getElementById('btn-join');
    if (joinButton) {
      joinButton.textContent = t('common.join');
      joinButton.disabled = false;
    }

    // İptalden sonra kullanıcıyı başladığı forma geri getir.
    const action = document.getElementById('step-action');
    const target = document.getElementById(kind === 'join' ? 'step-join' : 'step-create');
    if (action) action.classList.add('hidden');
    if (target) target.classList.remove('hidden');
  };
  return operation;
}

function finishRoomOperation(operation) {
  if (operation && activeRoomOperation !== operation) return;
  const modal = document.getElementById('room-operation-modal');
  if (modal) modal.classList.add('hidden');
  activeRoomOperation = null;
}

function roomOperationWasCancelled(operation) {
  if (!operation || !operation.cancelled) return false;
  disconnectApp();
  return true;
}

window.addEventListener('DOMContentLoaded', async () => {
  // Başlangıç menüsünün sol altına uygulama sürümünü yaz (package.json'dan).
  try {
    const verEl = document.getElementById('app-version');
    if (verEl && window.electronAPI && window.electronAPI.getAppVersion) {
      Promise.resolve(window.electronAPI.getAppVersion()).then((v) => {
        if (v) verEl.textContent = 'v' + v;
      }).catch(() => {});
    }
  } catch (e) { /* sürüm alınamazsa statik metin kalır */ }

  // Güncelleme butonu (ana menü sol alt). Durumlar main.js setupAutoUpdater'dan
  // 'update-status' ile gelir; 'downloaded' durumunda tıklama sessiz kurulum +
  // otomatik yeniden başlatma yapar (quitAndInstall). Dev modda buton gizli kalır.
  try {
    const upBtn = document.getElementById('update-btn');
    if (upBtn && window.electronAPI && window.electronAPI.updateGetStatus) {
      let upState = { state: 'idle' };
      let upResetTimer = null;
      const renderUpdateBtn = () => {
        const s = upState.state;
        if (s === 'dev') { upBtn.classList.add('hidden'); return; }
        upBtn.classList.remove('hidden');
        upBtn.disabled = (s === 'checking' || s === 'downloading');
        upBtn.classList.toggle('update-ready', s === 'downloaded');
        if (s === 'checking') upBtn.textContent = 'Denetleniyor…';
        else if (s === 'downloading') upBtn.textContent = 'Güncelleme indiriliyor… %' + (upState.percent || 0);
        else if (s === 'downloaded') upBtn.textContent = '🔄 Güncelle ve Yeniden Başlat' + (upState.version ? ' (v' + upState.version + ')' : '');
        else if (s === 'none') upBtn.textContent = '✓ Uygulama güncel';
        else if (s === 'error') upBtn.textContent = 'Güncelleme hatası — tekrar dene';
        else upBtn.textContent = 'Güncellemeleri Denetle';
        // "Güncel" bilgisi birkaç saniye görünüp normal etikete dönsün.
        if (upResetTimer) { clearTimeout(upResetTimer); upResetTimer = null; }
        if (s === 'none') {
          upResetTimer = setTimeout(() => { upState = { state: 'idle' }; renderUpdateBtn(); }, 4000);
        }
      };
      const applyStatus = (st) => { if (st && st.state) { upState = st; renderUpdateBtn(); } };
      window.electronAPI.onUpdateStatus(applyStatus);
      window.electronAPI.updateGetStatus().then(applyStatus).catch(() => {});
      upBtn.addEventListener('click', () => {
        if (upState.state === 'downloaded') { window.electronAPI.updateInstall(); return; }
        if (upState.state === 'checking' || upState.state === 'downloading') return;
        window.electronAPI.updateCheck().then(applyStatus).catch(() => {});
      });
      renderUpdateBtn();
    }
  } catch (e) { /* güncelleme UI kurulamazsa uygulama normal çalışmaya devam eder */ }

  // Donanım hızlandırma kapalıysa body'ye 'no-hw-accel' ekle: backdrop-filter
  // çalışmayacağı için cam buton opak nötr zemine düşer (bkz: style.css).
  if (window.electronAPI && window.electronAPI.getEffectiveHardwareAcceleration) {
    window.electronAPI.getEffectiveHardwareAcceleration()
      .then(on => { document.body.classList.toggle('no-hw-accel', !on); })
      .catch(() => {});
  }

  // İndirme bitti bildirimi. Dosyayı main süreç İndirilenler klasörüne yazar
  // (bkz. main.js will-download); burada tıklanınca klasörde gösteren bir
  // bildirim çıkar. Dosya adı ayrı bir düğümde tutulur ki dil değişiminde
  // yalnızca etiketler çevrilsin.
  if (window.electronAPI && window.electronAPI.onDownloadDone) {
    window.electronAPI.onDownloadDone((info) => {
      const container = document.getElementById('toast-container');
      if (!info || !info.ok) { showToast('İndirme tamamlanamadı', 'danger'); return; }
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = 'toast toast-ok toast-download';
      const label = document.createElement('span');
      label.textContent = 'İndirildi';
      const name = document.createElement('span');
      name.className = 'toast-file';
      name.textContent = info.name;
      const hint = document.createElement('span');
      hint.className = 'toast-hint';
      hint.textContent = 'Klasörde göster';
      toast.append(label, name, hint);
      toast.title = info.path;
      toast.addEventListener('click', () => {
        try { window.electronAPI.showInFolder(info.path); } catch (e) {}
      });
      container.appendChild(toast);
      setTimeout(() => toast.classList.add('show'), 10);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 6000);
    });
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
        `🌐 ${t('network.yourIp')}: <code>${ips[0].address}</code> (${t('network.discoveryHint')})`;
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
  async function deleteDeviceAccount(slot) {
    const accounts = getDeviceAccounts();
    const account = accounts.find(item => item.slot === slot);
    if (!account) return;
    const confirmed = await window.showConfirm(
      '⚠️ Hesabı Sil',
      `"${account.name || 'Anonim'}" hesabını bu cihazdan silmek istediğinize emin misiniz?`
    );
    if (!confirmed) return;

    const remaining = accounts.filter(item => item.slot !== slot);
    saveDeviceAccounts(remaining);
    if (getActiveSlot() === slot) {
      if (remaining.length) {
        remaining.sort((a, b) => a.slot - b.slot);
        localStorage.setItem(ACTIVE_SLOT_KEY, String(remaining[0].slot));
      } else {
        localStorage.removeItem(ACTIVE_SLOT_KEY);
      }
    }
    await renderDeviceAccounts();
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
    upsertDeviceAccount(getActiveSlot(), { name: state.myName, avatar: state.myAvatar, id: state.friendId });
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

    const deviceList = getDeviceAccounts();
    const legacyList = (await getAccounts()).filter(acc => acc && acc.id && !deviceList.some(device => device.id === acc.id));
    const list = [
      ...deviceList.map(acc => ({ ...acc, accountType: 'device' })),
      ...legacyList.map(acc => ({ ...acc, accountType: 'legacy' }))
    ];
    if (!list.length) {
      container.innerHTML = '<div class="muted" style="text-align:center; padding:16px;">Kayıtlı hesap bulunamadı.</div>';
      return;
    }
    const activeSlot = getActiveSlot();
    list.forEach(acc => {
      const row = document.createElement('div');
      row.className = 'account-row';
      const safeAccountAvatar = safeAvatarUrl(acc.avatar);
      const avatarHtml = safeAccountAvatar
        ? `<img class="account-row-avatar" src="${escapeHtml(safeAccountAvatar)}" />`
        : `<div class="account-row-avatar">👤</div>`;
      row.innerHTML = `
        ${avatarHtml}
        <div class="account-row-info">
          <div class="account-row-name">${escapeHtml(acc.name || 'Anonim')}</div>
          <div class="account-row-id">Bu cihazın kimliği · Hesap #${acc.slot + 1}${acc.slot === activeSlot ? ' · son kullanılan' : ''}</div>
        </div>
        <div class="account-row-actions">
          <button class="account-row-delete-btn" type="button" title="Hesabı Sil" aria-label="Hesabı Sil">🗑️</button>
        </div>
      `;
      const deviceTrashButton = row.querySelector('.account-row-delete-btn');
      if (deviceTrashButton) deviceTrashButton.innerHTML = trashIconSvg();
      if (acc.accountType === 'legacy') {
        const idEl = row.querySelector('.account-row-id');
        if (idEl) idEl.textContent = `Eski profil · ${acc.id}`;
      }
      if (acc.accountType === 'device' && acc.slot === activeSlot) {
        row.style.border = '1px solid var(--acc)';
      }
      const deleteButton = row.querySelector('.account-row-delete-btn');
      deleteButton.onclick = async event => {
        event.preventDefault();
        event.stopPropagation();
        if (acc.accountType === 'legacy') {
          const confirmed = await window.showConfirm(
            '⚠️ Hesabı Sil',
            `"${acc.name || 'Anonim'}" hesabını bu cihazdan silmek istediğinize emin misiniz?`
          );
          if (!confirmed) return;
          await deleteAccount(acc.id);
          await renderDeviceAccounts();
        } else {
          await deleteDeviceAccount(acc.slot);
        }
      };
      row.onclick = () => acc.accountType === 'legacy' ? loginWithAccount(acc) : deviceLogin(acc.slot);
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
    state.myAvatar = safeAvatarUrl(profile.avatar);
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

    upsertDeviceAccount(getActiveSlot(), { name: state.myName, avatar: state.myAvatar, id: state.friendId });

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
      globalMqttSessionId++; // bekleyen broker rotasyonlarını geçersiz kıl
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
    if (!targetId || targetId === state.friendId) return alert(t('alert.validId'));
    
    if (state.friends[targetId]) return alert(t('alert.alreadyFriend'));
    
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
        const targetId = state.pendingJoinReq.id;
        const response = {
          type: 'room_join_accepted',
          id: state.friendId,
          name: state.myName,
          roomId: state.room,
          password: state.password || ''
        };
        publishJoinEvent(targetId, response);
        [500, 1500].forEach(delay => setTimeout(() => publishJoinEvent(targetId, response), delay));
      }
      closeJoinRequestNote();
    });
  }

  if (joinReqDenyBtn) {
    joinReqDenyBtn.addEventListener('click', () => {
      clearInterval(joinReqRetryTimer);
      if (state.pendingJoinReq && state.globalMqtt) {
        state.globalMqtt.publish(`teamsync/user/${state.pendingJoinReq.id}/events`, JSON.stringify({
          type: 'room_join_declined',
          id: state.friendId,
          name: state.myName
        }), { qos: 1 });
      }
      closeJoinRequestNote();
    });
  }

  let lastServerInviteSentAt = 0;
  window.sendServerInvite = (fId) => {
    if (!isPersistentFriendId(fId)) { warnStaleFriendEntry(fId); return; }
    // Davet spamı koruması: 5 saniyede bir davet gönderilebilir
    const now = Date.now();
    const remaining = 5000 - (now - lastServerInviteSentAt);
    if (remaining > 0) {
      showToast(`Çok hızlısın! ${Math.ceil(remaining / 1000)} sn sonra tekrar davet atabilirsin.`, "warn");
      return;
    }
    if (state.globalMqtt && state.globalMqtt.connected) {
      lastServerInviteSentAt = now;
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
      const friendArg = safeInlineArg(fId);
      li.innerHTML = `
        <div class="friend-info">
          <div class="friend-status online"></div>
          <div><b>${escapeHtml(f.name)}</b></div>
        </div>
        <div class="friend-actions">
          <button class="btn-pri btn-sm" style="padding: 6px 12px; border-radius: 6px; cursor:pointer;" onclick="sendServerInvite(${friendArg})">Davet Et</button>
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

  const startApp = async (roomId, pw, useAI, pttMode, serverName, isJoining = false, useSFW = false, useGameMode = false, useRelay = false, roomOperation = null) => {
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
    state.sfwChatBanEnabled = false;
    state.sfwChatBanThreshold = 3;
    state.chatBannedIds = new Set();
    state.chatViolationCounts = new Map();
    state.gameMode = useGameMode;
    if (useSFW) {
       showToast("Yapay zeka modelleri yükleniyor (3MB), Lütfen bekleyin...", "info");
       await loadAIFilter();
       if (roomOperationWasCancelled(roomOperation)) return false;
    }
    document.getElementById('login').classList.add('hidden');
    state.room = roomId;
    // Sesli oturum başlıyor: Windows'un uygulamayı arka planda askıya
    // almasını/CPU'sunu kısmasını engelle (alt+tab'da ses bozulması).
    setVoiceSessionActive(true);
    state.password = pw;
    // RNNoise kiÅŸisel bir mikrofondur: oda/kurucu ayarÄ±ndan baÄŸÄ±msÄ±z olarak
    // yalnÄ±zca bu kullanÄ±cÄ±nÄ±n gÃ¶nderdiÄŸi sesi filtreler.
    state.useAI = localStorage.getItem(USER_NOISE_SUPPRESSION_KEY) !== '0';
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
    // Giriş sırası damgası: kurucu düştüğünde halef seçiminde kullanılır.
    state.joinedAt = Date.now();

    updateFounderMenuVisibility();

    try {
      state.cryptoKey = await setupCrypto(state.password);
      if (roomOperationWasCancelled(roomOperation)) return false;
      detectTunnelInterference(); // await yok: girişte bloklamasın, toast async gelsin
      await refreshDynamicTurn();
      if (roomOperationWasCancelled(roomOperation)) return false;
      await resolveTurnHostsViaDoH();
      if (roomOperationWasCancelled(roomOperation)) return false;
      await setupLocalAudio();
      if (roomOperationWasCancelled(roomOperation)) return false;
      if (!state.uiBound) {
        bindUI();
        initFileTransfer();
        setupVUMeter();
        await setupDeviceList();
        if (roomOperationWasCancelled(roomOperation)) return false;
        state.uiBound = true;
      }
      
      if (!isJoining) {
        document.getElementById('login').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        const tb = document.querySelector('.top-bar'); if(tb) tb.style.display = 'flex';
      }
      
      state.roomName = state.sfwMode ? censorProfaneText(serverName) : serverName;
      document.getElementById('room-title').textContent = '# ' + state.roomName + (state.cryptoKey ? ' 🔒' : '');
      document.getElementById('display-server-id').textContent = roomId;

      addUser({ id: 'self', name: `${state.myName} (${t('common.you')})`, mic: true, deaf: false, sharing: false, self: true, avatar: state.myAvatar, isFounder: state.isRoomFounder });
      
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
      return true;
    } catch (err) {
      finishRoomOperation(roomOperation);
      alert(`${t('alert.error')}: ${err.message}`);
      console.error(err);
      disconnectApp();
      return false;
    }
  };

  btnJoin.addEventListener('click', async () => {
    document.getElementById('error-modal').classList.add('hidden');
    const roomId = joinId.value.trim().toLowerCase();
    if (!roomId) return alert(t('alert.serverIdRequired'));
    
    const originalText = btnJoin.textContent;
    btnJoin.textContent = "Aranıyor...";
    btnJoin.disabled = true;

    state.isJoining = true;
    const useRelay = document.getElementById('join-useRelay') ? document.getElementById('join-useRelay').checked : false;
    const pttEnabled = localStorage.getItem('teamsync_ptt_enabled') === '1';
    const roomOperation = beginRoomOperation('join', roomId);
    const started = await startApp(roomId, joinPw.value, joinAi.checked, pttEnabled, "Sunucu " + roomId, true, false, false, useRelay, roomOperation);
    if (!started || roomOperation.cancelled) {
      btnJoin.textContent = originalText;
      btnJoin.disabled = false;
      return;
    }

    // Sunucu var mı kontrolü (15 saniye içinde kimse bulunamazsa iptal et)
    if (state.joinTimeout) clearTimeout(state.joinTimeout);
    state.joinTimeout = setTimeout(() => {
      btnJoin.textContent = originalText;
      btnJoin.disabled = false;
      
      if (!state.isJoining || state.room !== roomId) return;

      // Eğer hiç peer yoksa, sunucu yok demektir (veya boş)
      if (state.peers.size === 0) {
        finishRoomOperation(roomOperation);
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
    if (useSFW && isProfaneText(sName)) {
      showToast('Aile Dostu Yapay Zeka açıkken parti adı küfür veya uygunsuz ifade içeremez.', 'danger');
      return;
    }
    const useGameMode = document.getElementById('create-gameMode') ? document.getElementById('create-gameMode').checked : false;
    const useRelay = document.getElementById('create-useRelay') ? document.getElementById('create-useRelay').checked : false;
    const pttEnabled = localStorage.getItem('teamsync_ptt_enabled') === '1';
    // Sunucu oluştururken seçilen ses bit hızı (item 7). setMediaBitrates bunu
    // ilk bağlantıların SDP'sine uygular.
    const bitrateSel = document.getElementById('create-bitrate');
    state.audioBitrate = bitrateSel ? (parseInt(bitrateSel.value, 10) || 128) : 128;
    const roomOperation = beginRoomOperation('create', sName);
    const started = await startApp(odaId, createPw.value, createAi.checked, pttEnabled, sName, false, useSFW, useGameMode, useRelay, roomOperation);
    if (started && !roomOperation.cancelled) finishRoomOperation(roomOperation);
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
  const selectedMicId = localStorage.getItem(USER_MIC_DEVICE_KEY) || (sel && sel.value) || '';
  const deviceId = selectedMicId ? { exact: selectedMicId } : undefined;

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

  const audioConstraints = {
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
  };
  let raw;
  try {
    raw = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  } catch (error) {
    if (!selectedMicId) throw error;
    localStorage.removeItem(USER_MIC_DEVICE_KEY);
    delete audioConstraints.deviceId;
    raw = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  }

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
  state.micVolumeGainNode = vuCtx.createGain();
  state.micVolumeGainNode.gain.value = readPercentPreference(USER_MIC_VOLUME_KEY) / 100;
  state.gateGainNode.connect(state.micVolumeGainNode);
  
  const dest = vuCtx.createMediaStreamDestination();
  let highpassNode = null, lowpassNode = null, compressorNode = null, gainNodeInst = null;
  let rnnoiseFilterNode = null;

  if (useRnnoise) {
    try {
      rnnoiseFilterNode = await window.RNNoiseSuppression.createNoiseFilter({
        audioContext: vuCtx,
        onError: error => {
          console.error('RNNoise çalışma zamanı hatası:', error);
          // 'loading' da kabul edilir: worklet'in asenkron WASM kurulumu, statü
          // 'active' yazılmadan önce patlayabilir; o hatayı yutarsak filtre
          // sonsuza dek sessizlik üretir ve kimse kimseyi duyamaz.
          if (generation !== state.audioSetupGeneration) return;
          if (state.rnnoiseStatus !== 'active' && state.rnnoiseStatus !== 'loading') return;
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
      state.micVolumeGainNode.connect(rnnoiseFilterNode);
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

    state.micVolumeGainNode.connect(highpassNode);
    highpassNode.connect(lowpassNode);
    lowpassNode.connect(compressorNode);
    compressorNode.connect(gainNodeInst);
    gainNodeInst.connect(dest);

  } else {
    state.micVolumeGainNode.connect(dest);
  }
  state.processedStream = dest.stream;

  // Prevent Garbage Collection of WebAudio processing nodes by V8
  state.audioNodes = {
    vuSrc,
    vuAnalyser: state.vuAnalyser,
    gateGainNode: state.gateGainNode,
    micVolumeGainNode: state.micVolumeGainNode,
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
    state.micVolumeGainNode.connect(state.uiAnalyser);
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
  // Kirli-kontrol önbellekleri: aynı değeri tekrar yazmak Chromium'da stil
  // yeniden hesabı + düzen + boyama tetikler. Ölçüm: bu döngü saniyede 20 kez
  // koşuyor; her seferinde style.width + textContent yazmak, 23 backdrop-filter
  // ve 215 box-shadow taşıyan bir arayüzde boşuna yeniden boyama demekti.
  let lastBarPct = -1;
  let lastMutedBar = null;
  let lastDbText = '';
  let lastGateTarget = -1;
  let lastGateNode = null;
  let lastMeterPct = -1;
  let lastUiActive = true;

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
    // Ayarlar penceresindeki çubuklu ölçer yalnızca mikrofon testi açıkken
    // anlamlı; kapalıyken her tikte ~20 elemanı dolaşmanın karşılığı yok.
    // Test kapandığı anda bir kez sıfırlanır ki çubuklar dolu kalmasın.
    if (state.settingsMicTestActive) {
      const meterPct = Math.round(pct);
      if (meterPct !== lastMeterPct) { lastMeterPct = meterPct; updateSettingsMicMeter(pct); }
    } else if (lastMeterPct !== -1) {
      lastMeterPct = -1;
      updateSettingsMicMeter(0);
    }

    const isSpeaking = pct > state.micThreshold;

    // Yankı Kalkanı: karşı taraf konuşurken (sesi bizim hoparlörden çalıp
    // mikrofona geri sızabilirken) mikrofonu kıs. AEC'nin kaçırdığı yankıyı
    // keser; kullanıcı belirgin şekilde yüksek konuşursa (barge-in) kısılmaz.
    const echoDuck = state.echoShield && state.speakingPeers && state.speakingPeers.size > 0 &&
      pct < state.micThreshold + 15;

    if (state.gateGainNode && state.gateAudioCtx && state.gateAudioCtx.state !== 'closed') {
      // Bağlam askıya alınmışsa (Windows arka plan/EcoQoS) currentTime ilerlemez
      // ve kapı son değerinde donar — 0'da donarsa karşı taraf sizi hiç duymaz.
      if (state.gateAudioCtx.state === 'suspended') state.gateAudioCtx.resume().catch(() => {});
      const gateTarget = !isSpeaking ? 0 : (echoDuck ? 0.1 : 1);
      // Ses zinciri yeniden kurulduysa (setupLocalAudio yeni bir gainNode
      // üretir) önbellek geçersizdir; yeni düğüm varsayılan 1 kazançla gelir,
      // kirli-kontrol yüzünden kapalı kalması gereken kapı açık kalabilirdi.
      if (state.gateGainNode !== lastGateNode) { lastGateNode = state.gateGainNode; lastGateTarget = -1; }
      // Hedef değişmediyse yeni bir otomasyon olayı planlamaya gerek yok:
      // setTargetAtTime zaten üstel olarak hedefe yaklaşmayı sürdürür.
      if (gateTarget !== lastGateTarget) {
        lastGateTarget = gateTarget;
        state.gateGainNode.gain.setTargetAtTime(gateTarget, state.gateAudioCtx.currentTime, 0.05);
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

    // Görsel kısım: pencere ön planda değilken hiç çizme (ses yolu yukarıda
    // zaten işlendi — burası yalnızca gösterge). Ön plandayken de değer
    // değişmediyse DOM'a dokunma.
    const uiActive = state.uiActive !== false;
    if (uiActive) {
      // Arka plandan dönüldüyse önbellekleri sıfırla ki gösterge bayat kalmasın.
      if (!lastUiActive) { lastBarPct = -1; lastMutedBar = null; lastDbText = ''; }
      if (vuBar) {
        const barPct = Math.round(pct);
        if (barPct !== lastBarPct) { lastBarPct = barPct; vuBar.style.width = barPct + '%'; }
        const mutedBar = !isSpeaking;
        if (mutedBar !== lastMutedBar) {
          lastMutedBar = mutedBar;
          vuBar.classList.toggle('muted-bar', mutedBar);
        }
      }
      if (vuText) {
        const txt = db.toFixed(0) + ' dB';
        if (txt !== lastDbText) { lastDbText = txt; vuText.textContent = txt; }
      }
    }
    lastUiActive = uiActive;
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
    const savedMic = localStorage.getItem(USER_MIC_DEVICE_KEY) || '';
    fillAudioDeviceSelect(sel, devices, 'audioinput', t('settings.defaultMicrophone'), savedMic);
    if (sel) {
      sel.onchange = async () => {
        if (sel.value) localStorage.setItem(USER_MIC_DEVICE_KEY, sel.value);
        else localStorage.removeItem(USER_MIC_DEVICE_KEY);
        const settingsSelect = document.getElementById('user-mic-select');
        if (settingsSelect && [...settingsSelect.options].some(option => option.value === sel.value)) settingsSelect.value = sel.value;
        await setupLocalAudio();
        setupVUMeter();
      };
    }

    // Çıkış cihazı seçimi: yankı genelde ses hoparlörden çalıp mikrofona
    // geri girince oluşur; kulaklığı buradan seçmek bunu keser.
    const spk = document.getElementById('speaker-select');
    if (spk) {
      const saved = localStorage.getItem('teamsync_speaker_id') || '';
      fillAudioDeviceSelect(spk, devices, 'audiooutput', t('settings.defaultSpeaker'), saved);
      if (saved && ![...spk.options].some(o => o.value === saved)) localStorage.removeItem('teamsync_speaker_id');
      spk.onchange = () => {
        if (spk.value) localStorage.setItem('teamsync_speaker_id', spk.value);
        else localStorage.removeItem('teamsync_speaker_id');
        const settingsSelect = document.getElementById('user-speaker-select');
        if (settingsSelect && [...settingsSelect.options].some(option => option.value === spk.value)) settingsSelect.value = spk.value;
        applySpeakerToAll();
        showToast(t('settings.deviceChanged'), 'info');
      };
      applySpeakerToAll();
      // Cihaz takılıp çıkarıldığında sink'leri yeniden uygula: kulaklık
      // çekilince element sessizce ölü bir çıkışta kalabiliyor
      if (!state.deviceChangeHooked) {
        state.deviceChangeHooked = true;
        navigator.mediaDevices.addEventListener('devicechange', () => applySpeakerToAll());
      }
    }
    populateSettingsAudioDevices();
  } catch (e) {}
}

async function handlePeerDiscovered(peer) {
  if (!peer || !isValidPeerId(peer.id) || peer.id === state.myId) return;
  peer.name = typeof peer.name === 'string' ? peer.name.slice(0, 120) : 'Bilinmeyen';
  peer.avatar = safeAvatarUrl(peer.avatar);
  if (peer.friendId && !isValidPeerId(peer.friendId)) peer.friendId = null;

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
    // Avatar sonradan gelebilir/değişebilir (ör. peer profil fotoğrafını
    // güncellediğinde yeni announce ile yayılır) — profil kartı bunu okur.
    if (peer.avatar && existing.avatar !== peer.avatar) {
      existing.avatar = peer.avatar;
    }
    // Kalıcı kimlik periyodik hello ile gelir; DM/arkadaşlık isteklerinin
    // doğru konuya gidebilmesi için peer üzerinde güncel tutulur.
    if (peer.friendId) existing.friendId = peer.friendId;
    // Giriş damgası hello ile gelir (keşif anında bilinmeyebilir).
    if (typeof peer.joinedAt === 'number' && peer.joinedAt > 0) existing.joinedAt = peer.joinedAt;
    if (existing.name !== peer.name) {
      existing.name = peer.name;
      // Satırdaki gerçek ismi güncelle; ekranda lakap varsa lakap kalır.
      const li = document.querySelector(`[data-uid="${peer.id}"]`);
      if (li) li.dataset.realName = peer.name;
      refreshUserRowName(peer.id);

      const shown = displayName(peer.id, peer.name);
      const vlbl = document.querySelector(`#vc-${peer.id}-c .vlbl`);
      if (vlbl) vlbl.innerHTML = `<span class="live"></span> ${escapeHtml(shown)} • Kamera`;

      const slbl = document.querySelector(`#vc-${peer.id}-s .vlbl`);
      if (slbl) slbl.innerHTML = `<span class="live"></span> ${escapeHtml(shown)} • Ekran`;
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
    finishRoomOperation(activeRoomOperation);
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
  await createPeerConnection(peer.id, peer.name, isInitiator, peer.ip, peer.avatar);
  // createPeerConnection state.peers'a YENİ bir nesne koyar; keşifte gelen
  // kalıcı kimliği (varsa) o nesneye aktar ki ilk hello beklenmesin.
  const created = state.peers.get(peer.id);
  if (created && peer.friendId) created.friendId = peer.friendId;
  if (created && typeof peer.joinedAt === 'number' && peer.joinedAt > 0) created.joinedAt = peer.joinedAt;
  showToast(displayName(peer.id, peer.name) + ' bulundu', 'info');
}

setInterval(() => {
  const now = Date.now();
  state.peers.forEach((peer, id) => {
    if (peer.lastSeen && now - peer.lastSeen > 12000) {
      // MQTT geçici koparsa bile WebRTC bağlantısı sağlamsa peer'ı düşürme.
      // Ancak alt+F4/çökme durumunda ICE bir süre daha "connected" görünebiliyor
      // ve hello 3 saniyede bir geldiği için 30 saniyelik sessizlik artık
      // kesin ölümdür — aksi halde kurucu alt+F4 attığında sahiplik devri
      // (handleFounderLeft) hiç tetiklenmiyordu.
      const iceState = peer.pc ? peer.pc.iceConnectionState : null;
      const silentTooLong = now - peer.lastSeen > 30000;
      if (!silentTooLong && (iceState === 'connected' || iceState === 'completed')) return;
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
  // Merkezi konuşma algılama döngüsünden çıkar (bkz. runSpeakingDetection);
  // son kişi de gidince döngü kendini durdurur.
  if (typeof releaseSpeakingNode === 'function') releaseSpeakingNode(peerId);
  if (peer.mediaStreamSource) { try { peer.mediaStreamSource.disconnect(); } catch(e) {} }
  if (peer.analyser) { try { peer.analyser.disconnect(); } catch(e) {} }
  if (peer.silentGain) { try { peer.silentGain.disconnect(); } catch(e) {} }
  if (peer.audioCtx) { try { peer.audioCtx.close(); } catch(e) {} }
  // Kişi bazlı ses güçlendirme zinciri temizliği (bkz: ensurePeerBoostChain)
  if (peer.gainSrc) { try { peer.gainSrc.disconnect(); } catch(e) {} }
  if (peer.gainNode) { try { peer.gainNode.disconnect(); } catch(e) {} }
  if (peer.limiterNode) { try { peer.limiterNode.disconnect(); } catch(e) {} }
  if (peer.volPump) { try { peer.volPump.srcObject = null; peer.volPump.remove(); } catch(e) {} }
  if (peer.audioEl) { try { peer.audioEl.srcObject = null; peer.audioEl.remove(); } catch(e) {} }
  if (peer.videoEl) { try { peer.videoEl.srcObject = null; peer.videoEl.remove(); } catch(e) {} }
  // Ekran sesi kanalı temizliği (mikrofonunkiyle birebir aynı desen).
  if (peer.screenGainSrc) { try { peer.screenGainSrc.disconnect(); } catch(e) {} }
  if (peer.screenGainNode) { try { peer.screenGainNode.disconnect(); } catch(e) {} }
  if (peer.screenLimiterNode) { try { peer.screenLimiterNode.disconnect(); } catch(e) {} }
  if (peer.screenVolPump) { try { peer.screenVolPump.srcObject = null; peer.screenVolPump.remove(); } catch(e) {} }
  if (peer.screenAudioEl) { try { peer.screenAudioEl.srcObject = null; peer.screenAudioEl.remove(); } catch(e) {} }
  peer.screenGainSrc = peer.screenGainNode = peer.screenLimiterNode = null;
  peer.screenGainDest = peer.screenVolPump = peer.screenAudioEl = null;
  peer.screenRawAudioStream = null;
  peer.screenAudioTransceiver = null;
  peer.micTransceiver = null;
  state.peers.delete(peerId);
  const userEl = document.querySelector(`[data-uid="${peerId}"]`);
  if (userEl) userEl.remove();
  removeVideoCard(peerId, false);
  removeVideoCard(peerId, true);
  state.speakingPeers.delete(peerId);
  if (state.activeControl && state.activeControl.hostId === peerId) {
    document.getElementById('remote-stop').click();
  }
  // Beni kontrol eden kişi koptuysa girişleri kapat, pill'i kaldır.
  if (state.controlledBy === peerId) stopBeingControlled(false);
  // Bekleyen denetim teklifleri (her iki yön) peer gidince düşer.
  if (state.pendingControlOffer && state.pendingControlOffer.peerId === peerId) clearControlOffer();
  if (state.incomingControlOffer && state.incomingControlOffer.peerId === peerId) closeCtrlOfferNote();
  showToast(displayName(peerId, peer.name) + ' ayrıldı', 'warn');
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

  // Vampir Köylü: ayrılan kişi bir botun operatörüyse kurucu botu devralsın.
  if (typeof window.vampireVillagerPeerLeft === 'function') window.vampireVillagerPeerLeft(peerId);

  // Ortak Tarayıcı: bağlantısı kopan kurucuysa halef seç (kimseyi atmadan),
  // değilse sadece yetki listesinden düş
  if (state.sb && state.sb.host === peerId) {
    if (typeof sbHandleHostLeft === 'function') sbHandleHostLeft(peerId);
  } else if (state.sb && Array.isArray(state.sb.authorized) && state.sb.authorized.includes(peerId)) {
    state.sb.authorized = state.sb.authorized.filter(id => id !== peerId);
    if (state.sb.host === state.myId && typeof sbBroadcastAuth === 'function') sbBroadcastAuth();
  }

  if (typeof unoHandlePeerLeft === 'function') unoHandlePeerLeft(peerId);

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

// ===== EKRAN SESİ (sistem sesi) TAŞIMA KATMANI ==============================
// Sorun: getDisplayMedia ile yakalanan sistem sesi hiç GÖNDERİLMİYORDU; yalnız
// video track'i replaceTrack ile aktarılıyordu.
//
// Çözüm, video için zaten kullanılan desenin aynısı: bağlantı kurulurken
// FAZLADAN bir ses m-line'ı (transceiver) açılır ve paylaşım başlayınca track
// oraya replaceTrack ile takılır. Böylece yeniden müzakere (renegotiation)
// GEREKMEZ — offer/answer bir kez yapılır, sonrasında ses aç/kapa anlıktır.
//
// m-line sırası her iki tarafta da deterministiktir:
//   0: mikrofon sesi (addTrack)   1: video (addTrack)   2: EKRAN SESİ
// Buna rağmen sıraya GÜVENMİYORUZ: transceiver referansı peer üzerinde
// saklanır (peer.screenAudioTransceiver) ve gelen track'i ayırt etmek için
// e.transceiver ile karşılaştırılır — en güvenilir yol budur.
const SCREEN_AUDIO_BITRATE_BPS = 128000; // müzik/oyun sesi için (mikrofon ayrı)

// Ekran sesi transceiver'ını bulur. Kural: birden fazla ses transceiver'ı
// varsa SONUNCUSU ekran sesidir (fazladan m-line her zaman sona eklenir).
// Tek ses transceiver'ı varsa karşı taraf ESKİ SÜRÜMDÜR (SDP'sinde fazladan
// m-line yok) → null döner ve çağıranlar sessizce eski davranışa düşer.
function findScreenAudioTransceiver(peer) {
  const pc = peer && peer.pc;
  if (!pc || typeof pc.getTransceivers !== 'function') return null;
  let list;
  try { list = pc.getTransceivers(); } catch (e) { return null; }
  const audioTrs = list.filter(t => t && !t.stopped && (
    (t.sender && t.sender.track && t.sender.track.kind === 'audio') ||
    (t.receiver && t.receiver.track && t.receiver.track.kind === 'audio')
  ));
  if (audioTrs.length < 2) return null; // eski sürüm ya da henüz müzakere olmadı
  const last = audioTrs[audioTrs.length - 1];
  if (peer.micTransceiver && last === peer.micTransceiver) return null; // asla mikrofonu seçme
  return last;
}

// Transceiver'ı peer'e bağlar (idempotent). Answerer tarafında transceiver
// setRemoteDescription sırasında oluşur ve 'recvonly' başlar; kendi ekran
// sesimizi de gönderebilmek için sendrecv'e çekilir (bu answer'a yansır,
// ek müzakere gerektirmez).
function adoptScreenAudioTransceiver(peer) {
  if (!peer) return null;
  if (peer.screenAudioTransceiver && !peer.screenAudioTransceiver.stopped) {
    return peer.screenAudioTransceiver;
  }
  const tr = findScreenAudioTransceiver(peer);
  if (!tr) return null;
  peer.screenAudioTransceiver = tr;
  try { if (tr.direction !== 'sendrecv') tr.direction = 'sendrecv'; } catch (e) {}
  return tr;
}

// getVideoSender'ın ekran sesi karşılığı. Mikrofon sender'ıyla KARIŞMAZ:
// mikrofon addTrack ile eklendiği için ayrı bir transceiver'dadır ve
// findScreenAudioTransceiver onu açıkça eler.
function getScreenAudioSender(peer) {
  const tr = adoptScreenAudioTransceiver(peer);
  return tr ? tr.sender : null;
}

// Ekran sesi müzik/oyun taşır: konuşma için ayarlanmış varsayılanlar yetmez.
// Mikrofon gönderici parametrelerine DOKUNULMAZ.
async function applyScreenAudioQuality(sender) {
  if (!sender) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = SCREEN_AUDIO_BITRATE_BPS;
    try { params.encodings[0].networkPriority = 'high'; } catch (e) {}
    await sender.setParameters(params);
  } catch (e) {
    console.warn('Ekran sesi bit hızı uygulanamadı:', e && e.message ? e.message : e);
  }
}

// track null ise gönderim durur (paylaşım bitti). Karşı taraf eski sürümse
// sender bulunamaz — sessizce false döner, HATA/ÇÖKME olmaz.
function sendScreenAudioToPeer(peer, track) {
  const sender = getScreenAudioSender(peer);
  if (!sender) return false;
  sender.replaceTrack(track || null)
    .then(() => { if (track) applyScreenAudioQuality(sender); })
    .catch(e => console.warn('Ekran sesi track değişimi başarısız:', e && e.message ? e.message : e));
  return true;
}

// Halihazırda paylaşım yapıyorken bağlanan/yeniden müzakere eden peer'e
// mevcut ekran sesini iter.
function pushScreenAudioIfSharing(peer) {
  if (!peer || !state.isSharing || !state.screenStream) return;
  const track = state.screenStream.getAudioTracks()[0];
  if (track) sendScreenAudioToPeer(peer, track);
}

// SDP'de İKİNCİ (ve sonraki) ses bölümü ekran sesidir; oraya müzik için
// stereo + yüksek bit hızı yazılır. BİRİNCİ ses bölümü (mikrofon/konuşma)
// hiç değiştirilmez — onun ayarları setMediaBitrates'e aittir.
function setScreenAudioSdpParams(sdp) {
  if (!sdp) return sdp;
  let audioSectionSeen = 0;
  return sdp.split(/(?=^m=)/m).map((sec) => {
    if (!/^m=audio/.test(sec)) return sec;
    audioSectionSeen++;
    if (audioSectionSeen < 2) return sec; // mikrofon bölümü — dokunma
    const m = sec.match(/a=rtpmap:(\d+)\s+opus/i);
    if (!m) return sec;
    const pt = m[1];
    const opusParams =
      `maxaveragebitrate=${SCREEN_AUDIO_BITRATE_BPS};maxplaybackrate=48000;` +
      `sprop-maxcapturerate=48000;stereo=1;sprop-stereo=1;useinbandfec=1;usedtx=0`;
    const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
    if (fmtpRe.test(sec)) {
      return sec.replace(fmtpRe, (full, existing) => {
        const cleaned = existing.split(';')
          .filter(p => p && !/^(maxaveragebitrate|maxplaybackrate|sprop-maxcapturerate|stereo|sprop-stereo|useinbandfec|usedtx|cbr)=/i.test(p.trim()))
          .join(';');
        return `a=fmtp:${pt} ${cleaned ? cleaned + ';' : ''}${opusParams}`;
      });
    }
    return sec.replace(new RegExp(`(a=rtpmap:${pt}\\s+opus[^\\r\\n]*)`), `$1\r\na=fmtp:${pt} ${opusParams}`);
  }).join('');
}

// Offer/answer SDP'sine hem mikrofon hem ekran sesi parametrelerini uygular.
function applyAudioSdpParams(sdp) {
  return setScreenAudioSdpParams(setMediaBitrates(sdp));
}

// Alıcı taraf: ekran sesi AYRI bir <audio> üzerinden çalar. peer.audioEl'e
// KARIŞTIRILMAZ — yoksa tek slider iki sesi birden kısar ve mikrofon için
// kurulmuş gain zinciri müziği de etkilerdi.
// NOT: Paylaşım bitip yeniden başladığında ontrack TEKRAR TETİKLENMEZ
// (replaceTrack aynı uzak track üzerinden çalışır). Bu yüzden burada kurulan
// eleman/zincir paylaşım bitince YIKILMAZ, yalnızca sessizleşir.
function attachPeerScreenAudio(peerId, peer, e) {
  // e.streams[0] mikrofon/video gibi başka parçaları da taşıyabilir. Yalnızca bu
  // transceiver'ın ses parçasını bağla; aksi halde aynı ses hem mikrofon hem ekran
  // oynatıcısından çıkar ve kişisel seviye değişince yankı gibi duyulur.
  const stream = new MediaStream([e.track]);
  if (!peer.screenAudioEl) {
    const a = document.createElement('audio');
    a.autoplay = true;
    a.style.display = 'none';
    applySpeakerTo(a); // hoparlör seçimi ekran sesi için de geçerli
    document.body.appendChild(a);
    peer.screenAudioEl = a;
  }
  peer.screenRawAudioStream = stream;
  if (peer.screenGainNode && peer.screenGainSrc && state.remoteAudioCtx) {
    // Yeniden müzakerede zincir korunur (mikrofon kanalındaki desenin aynısı).
    try { peer.screenGainSrc.disconnect(); } catch (err) {}
    peer.screenGainSrc = state.remoteAudioCtx.createMediaStreamSource(stream);
    peer.screenGainSrc.connect(peer.screenGainNode);
    if (peer.screenVolPump) peer.screenVolPump.srcObject = stream;
  } else {
    peer.screenAudioEl.srcObject = stream;
  }
  applyPeerVolume(peerId, 'screen');
  peer.screenAudioEl.play().catch(err => console.warn('Ekran sesi oynatılamadı:', err));
  // Ekran sesi KONUŞMA ALGILAMASINA sokulmaz: müzik/oyun sesi kişiyi
  // "konuşuyor" gibi göstermemeli.
  console.log(`🔊 Ekran sesi track'i alındı: ${peer.name}`);
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
    // Kendini onar: ses verisi GELİYOR ama oynatıcı çalmıyor. Kullanıcı bu
    // kişiyi bilerek %0'a çektiyse (kişi bazlı ses) bu bir arıza değildir.
    if (inAudio && inAudio.bytesReceived > 0 && el && !state.deafened &&
        !intendedPeerVolumeIsZero(peerId) &&
        (el.paused || el.muted || el.volume === 0 || !el.srcObject)) {
      console.warn(`🔈 [${peer.name}] ses verisi geliyor ama oynatıcı çalmıyordu — oynatma yeniden başlatılıyor`);
      showToast(`${displayName(peerId, peer.name)} sesi oynatılamıyordu, oynatıcı yeniden başlatıldı`, 'warn');
      try {
        if (!el.srcObject && track) el.srcObject = new MediaStream([track]);
        applyPeerVolume(peerId); // 1.0'a sabitleme yerine kayıtlı ayarı uygula
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
    offer.sdp = applyAudioSdpParams(offer.sdp);
    peer.localCandidates = []; // ICE restart yeni ufrag üretir; eski adaylar geçersiz
    await peer.pc.setLocalDescription(offer);
    console.log(`🔄 ICE restart offer gönderiliyor → ${peer.name}`);
    sendSignalToPeer(peerId, { type: 'offer', sdp: peer.pc.localDescription });
  } catch (e) {
    console.warn('ICE restart başarısız:', e && e.message ? e.message : e);
  }
}

async function createPeerConnection(peerId, peerName, isInitiator, peerIp, peerAvatar) {
  if (state.peers.has(peerId)) return;
  const pc = new RTCPeerConnection({ 
    iceServers: getIceServers(),
    iceTransportPolicy: state.useRelay ? 'relay' : 'all'
  });

  if (state.localStream) state.localStream.getTracks().forEach(track => {
    pc.addTrack(track, state.localStream);
  });

  // Mikrofon transceiver'ını burada yakalıyoruz: ekran sesi transceiver'ını
  // ararken onu KESİN olarak elemek için tek güvenilir referans budur.
  let micTransceiver = null;
  try {
    micTransceiver = pc.getTransceivers().find(t => t.sender && t.sender.track && t.sender.track.kind === 'audio') || null;
  } catch (e) {}

  // Ekran sesi için FAZLADAN ses m-line'ı: yalnızca offer'ı üreten taraf açar.
  // Answerer'da bu transceiver setRemoteDescription sırasında kendiliğinden
  // oluşur ve adoptScreenAudioTransceiver ile sahiplenilir (bkz. processSignal).
  // Böylece karşı taraf ESKİ SÜRÜMSE answerer hiç fazladan m-line üretmez.
  let screenAudioTransceiver = null;
  if (isInitiator) {
    try {
      screenAudioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    } catch (e) {
      console.warn('Ekran sesi kanalı açılamadı (eski davranışa dönülüyor):', e && e.message ? e.message : e);
    }
  }

  const sender = getVideoSender(pc);
  if (sender) {
    if (state.isSharing && state.screenStream) {
      // Paylaşım sürerken katılan peer de aynı bit hızı sınırını almalı;
      // aksi halde geç gelenler sınırsız gönderim alır.
      sender.replaceTrack(state.screenStream.getVideoTracks()[0])
        .then(() => limitVideoBitrate(sender))
        .catch(console.error);
    }
  }
  // Zaten paylaşım yapıyorsak, offer üretilmeden ÖNCE ekran sesini takıyoruz —
  // böylece m-line en baştan track'li gider.
  if (screenAudioTransceiver && state.isSharing && state.screenStream) {
    const scrAudio = state.screenStream.getAudioTracks()[0];
    if (scrAudio) {
      screenAudioTransceiver.sender.replaceTrack(scrAudio)
        .then(() => applyScreenAudioQuality(screenAudioTransceiver.sender))
        .catch(e => console.warn('Ekran sesi takılamadı:', e && e.message ? e.message : e));
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
      // Mikrofon mu ekran sesi mi? İSİM/SIRA tahmini yapılmaz: gelen track'in
      // transceiver referansı ekran sesi transceiver'ıyla karşılaştırılır.
      // (adopt burada çağrılır çünkü answerer'da ontrack, setRemoteDescription
      // sonrası sahiplenme adımından ÖNCE tetiklenebiliyor.)
      adoptScreenAudioTransceiver(peer);
      if (peer.screenAudioTransceiver && e.transceiver && peer.screenAudioTransceiver === e.transceiver) {
        attachPeerScreenAudio(peerId, peer, e);
        return;
      }
      // Uzak MediaStream birden fazla parça içerebilir. Oynatıcıya bütün stream'i
      // vermek, video/ekran elemanlarının mikrofonu ikinci kez çalmasına yol açar.
      const audioStream = new MediaStream([e.track]);
      peer.rawAudioStream = audioStream;
      if (peer.gainNode && peer.gainSrc && state.remoteAudioCtx) {
        // Yeniden müzakerede (renegotiation) güçlendirme zinciri korunur:
        // yeni ham akış eski gain düğümüne bağlanır, oynatıcı dest'te kalır.
        try { peer.gainSrc.disconnect(); } catch (err) {}
        peer.gainSrc = state.remoteAudioCtx.createMediaStreamSource(audioStream);
        peer.gainSrc.connect(peer.gainNode);
        if (peer.volPump) peer.volPump.srcObject = audioStream;
      } else {
        peer.audioEl.srcObject = audioStream;
      }
      applyPeerVolume(peerId); // kayıtlı kişi sesi + ana ses + sağırlaştırma

      peer.audioEl.play().catch((err) => console.warn('Audio play failed:', err));
      setupSpeakingDetection(peerId, audioStream);
    } else if (e.track.kind === 'video') {
      // Video elemanına yalnızca video parçası gider; ses ayrı audioEl zincirinde.
      const videoStream = new MediaStream([e.track]);
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
    videoEl: (function(){ const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.muted = true; return v; })(),
    dc,
    name: peerName,
    // Profil kartı (showRoomUserProfile) avatarı buradan okur; eskiden bu
    // alan hiç set edilmediği için kartta fotoğraf asla görünmüyordu.
    avatar: peerAvatar || null,
    mic: true,
    deaf: false,
    sharing: false,
    // Ekran sesi kanalı: karşı taraf sistem sesi paylaşıyorsa true olur
    // (bkz. 'sharing' mesajı). Slider yalnızca bu doğruyken gösterilir.
    screenAudio: false,
    // Sıra tahminine güvenmemek için transceiver referansları saklanır.
    micTransceiver,
    screenAudioTransceiver,
    ip: peerIp,
    isInitiator,
    lastSeen: Date.now()
  });

  if (isInitiator) {
    const offer = await pc.createOffer();
    offer.sdp = applyAudioSdpParams(offer.sdp);
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
          }));
        }
        if (state.isSharing) dc.send(JSON.stringify({
          type: 'sharing',
          sharing: true,
          audio: !!(state.screenStream && state.screenStream.getAudioTracks().length)
        }));
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
          } else if (activeAct === 'uno') {
            if (typeof unoSyncNewPeer === 'function') unoSyncNewPeer(peerId);
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
            // Tahta artık nesne listesi olarak senkronlanır (parçalı wb2-sync);
            // eski JPEG anlık görüntüsü hem büyüktü hem de geri alma/silme
            // bilgisini taşımıyordu.
            if (typeof window.whiteboardSyncTo === 'function') window.whiteboardSyncTo(peerId);
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
      if (e.data.length > MAX_CONTROL_MESSAGE_SIZE) return;
      try {
        const msg = JSON.parse(e.data);
        console.log('📥 DC Mesajı alındı:', peerId, msg.type, msg);
        handleDataMessage(peerId, msg);
      } catch (err) {}
    } else {
      if (!(e.data instanceof ArrayBuffer) || e.data.byteLength > CHUNK_SIZE + 160) return;
      const buf = new Uint8Array(e.data);
      let pipeIdx = -1;
      for (let i=0; i<100; i++) { if(buf[i]===124) { pipeIdx=i; break; } } // '|'
      if (pipeIdx > 0) {
        const headerStr = new TextDecoder().decode(buf.slice(0, pipeIdx));
        const chunk = buf.slice(pipeIdx + 1);
        try {
          const header = JSON.parse(headerStr);
           const f = fileBuffer.get(header.id);
           if (f && header.fromId === peerId && f.peerId === peerId
               && chunk.length <= CHUNK_SIZE && f.received + chunk.length <= f.meta.size) {
              f.chunks.push(chunk);
            f.received += chunk.length;
            f.lastChunkAt = Date.now();
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
  if (!isValidPeerId(peerId) || !msg || typeof msg !== 'object' || Array.isArray(msg)
      || typeof msg.type !== 'string' || msg.type.length > 64) return;
  if (msg._mid) {
    if (typeof msg._mid !== 'string' || msg._mid.length > 128) return;
    if (processedMessages.has(msg._mid)) return;
    processedMessages.add(msg._mid);
    if (processedMessages.size > 500) {
      const first = processedMessages.values().next().value;
      processedMessages.delete(first);
    }
  }

  // Beyaz Tahta kendi paketlerini (wb2-* ve eski draw/wb-clear/wb-sync)
  // js/whiteboard.js içinde işler; burada yalnızca yönlendirilir. Modül
  // paketi tanıdıysa true döner ve zincir kısa devre olur.
  if (typeof window.whiteboardHandleMessage === 'function'
      && window.whiteboardHandleMessage(peerId, msg)) return;

  if (msg.type === 'founder_settings_update') {
    // Sunucu çapındaki ayarlar yalnızca gerçek kurucudan kabul edilir.
    if (peerId !== state.founderId) return;
    if (msg.friendsOnlyMode !== undefined) state.friendsOnlyMode = msg.friendsOnlyMode;
    if (msg.gameMode !== undefined) state.gameMode = msg.gameMode;
    if (msg.sfwChatBanEnabled !== undefined) state.sfwChatBanEnabled = !!msg.sfwChatBanEnabled;
    if (msg.sfwChatBanThreshold !== undefined) state.sfwChatBanThreshold = getSfwChatBanThreshold(msg.sfwChatBanThreshold);
    if (msg.sfwMode !== undefined) {
      state.sfwMode = msg.sfwMode;
      if (state.sfwMode && state.roomName) {
        state.roomName = censorProfaneText(state.roomName);
        const titleEl = document.getElementById('room-title');
        if (titleEl) titleEl.textContent = '# ' + state.roomName + (state.cryptoKey ? ' 🔒' : '');
      }
      if (state.sfwMode) loadAIFilter();
    }
    console.log('👑 Founder settings updated:', msg);
    return;
  } else if (msg.type === 'chat_ban') {
    if (peerId !== state.founderId) return;
    if (!msg.targetId || msg.targetId === state.myId) return;
    if (!state.chatBannedIds) state.chatBannedIds = new Set();
    if (msg.banned) {
      state.chatBannedIds.add(msg.targetId);
      const peer = state.peers.get(msg.targetId);
      if (peer) showToast(`${peer.name || 'Oyuncu'} sohbetten yasaklandı.`, 'danger');
    } else {
      state.chatBannedIds.delete(msg.targetId);
      if (state.chatViolationCounts) state.chatViolationCounts.delete(msg.targetId);
      const peer = state.peers.get(msg.targetId);
      if (peer) showToast(`${peer.name || 'Oyuncu'} için sohbet yasağı kaldırıldı.`, 'ok');
    }
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
    const incomingOtherLobbies = incomingLobbies
      .filter(l => l.hostId !== state.myId)
      .map(l => state.sfwMode ? {
        ...l,
        name: censorProfaneText(l.name || ''),
        hostName: censorProfaneText(l.hostName || '')
      } : l);
    
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
          if (typeof unoSyncNewPeer === 'function') unoSyncNewPeer(msg.peerId);
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
        } else if (lob.activity === 'vampire') {
          if (typeof window.vampireVillagerSyncPeer === 'function') window.vampireVillagerSyncPeer(msg.peerId);
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
      if (state.uno) state.uno.host = state.myId;
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
                        msg.type.startsWith('vv-') ||
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
    // Eski sürümler 'audio' alanını göndermez → undefined → false: ekran sesi
    // slider'ı gösterilmez, davranış eskisiyle birebir aynı kalır.
    peer.screenAudio = !!(msg.sharing && msg.audio);
    if (msg.sharing) {
      addVideoCard(peerId, displayName(peerId, peer.name), peer.videoEl, true);
    } else {
      removeVideoCard(peerId, true);
      if (state.activeControl && state.activeControl.hostId === peerId) {
        closeActiveControlSession(false);
        showToast('Ekran paylaşımı bittiği için denetim izni kapatıldı.', 'info');
      }
    }
    updateUserUI(peerId);
  } else if (msg.type === 'chat') {
    if (isChatBanned(peerId)) return;
    let isCensored = msg.isCensored || false;
    let safeText = msg.text || '';
    let violation = !!msg.sfwViolation;
    if (!isCensored) {
      const res = await checkTextWithAI(msg.text);
      if (!res.ok) {
        isCensored = true;
        violation = true;
        safeText = res.text || '';
      }
    }
    if (violation && registerSfwChatViolation(peerId)) return;
    appendChat(peerId, peer.name, safeText, isCensored);
  } else if (msg.type === 'chat-enc') {
    if (isChatBanned(peerId)) return;
    let isCensored = msg.isCensored || false;
    if (state.cryptoKey) {
      const dec = await decryptMsg(msg.data, state.cryptoKey);
      if (dec || dec === '') {
         let safeText = dec || '';
         let violation = !!msg.sfwViolation;
         if (!isCensored && dec !== '') {
            const res = await checkTextWithAI(dec);
            if (!res.ok) {
              isCensored = true;
              violation = true;
              safeText = res.text || '';
            }
         }
         if (violation && registerSfwChatViolation(peerId)) return;
         appendChat(peerId, peer.name, safeText, isCensored);
      } else {
         appendChat(peerId, peer.name, '🔒 [Şifre Çözülemedi]');
      }
    } else {
      appendChat(peerId, peer.name, '🔒 [Kilitli Mesaj]');
    }
  } else if (msg.type === 'file-meta') {
    const validId = typeof msg.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(msg.id);
    const validName = typeof msg.name === 'string' && msg.name.length > 0 && msg.name.length <= 255;
    const validSize = Number.isInteger(msg.size) && msg.size > 0 && msg.size <= MAX_ROOM_FILE_SIZE;
    const validMime = typeof msg.mime === 'string' && msg.mime.length <= 128;
    const pendingRoomBytes = Array.from(fileBuffer.values()).reduce((sum, entry) => sum + (entry.meta?.size || 0), 0);
    if (!validId || !validName || !validSize || !validMime || fileBuffer.has(msg.id) || fileBuffer.size >= MAX_PENDING_ROOM_FILES
      || pendingRoomBytes + msg.size > MAX_PENDING_ROOM_BYTES) return;
    fileBuffer.set(msg.id, {
      meta: { ...msg, name: safeFileName(msg.name), mime: msg.mime },
      peerId,
      chunks: [],
      received: 0,
      lastChunkAt: Date.now()
    });
    appendFileMsg(msg.id, safeFileName(msg.name), msg.size, true);
  } else if (msg.type === 'file-done') {
    const f = fileBuffer.get(msg.id);
    if (f && f.peerId !== peerId) return;
    if (f && f.received !== f.meta.size) {
      fileBuffer.delete(msg.id);
      return;
    }
    if (f && f.received === f.meta.size) {
      const blob = new Blob(f.chunks, { type: f.meta.mime });
      const url = URL.createObjectURL(blob);
      chatBlobUrls.push(url);
      // "Koleksiyona ekle" düğmesi bu kayıttan okur: CSP connect-src blob:
      // içermediği için blob URL'i sonradan fetch ile geri okunamıyor.
      window.registerChatMedia?.(url, blob, f.meta.name);
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
          aDl.download = safeFileName(f.meta.name);
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
    if (!state.isSharing) {
      rejectControlRequest(peerId, msg.reqId, 'not-sharing');
    } else if (state.controlledBy || state.pendingControlReq) {
      rejectControlRequest(peerId, msg.reqId, 'busy');
    } else {
      showControlModal(peerId, displayName(peerId, peer.name), msg.reqId);
    }
  } else if (msg.type === 'ctrl-res') {
    if (msg.accepted) {
      if (!peer.sharing) {
        showToast('Ekran paylaşılmadığı için denetim izni başlatılamadı.', 'warn');
        return;
      }
      state.activeControl = { hostId: peerId, hostName: displayName(peerId, peer.name) };
      state.controlOwner = 'host';
      remoteOwnerConfirmed = false;
      setRemotePointerActive(false);
      setHostPassivePointer(null, false);
      setAuthorizedCursorProfile(state.myName, state.myAvatar);
      document.getElementById('remote-name').textContent = displayName(peerId, peer.name) + ' Masaüstü';
      document.getElementById('remote-modal').classList.remove('hidden');
      if (peer.videoEl.srcObject) {
        document.getElementById('remote-vid').srcObject = peer.videoEl.srcObject;
      }
      updateControlRequestButton(peerId); // karttaki düğme "Denetimde" olur
    } else {
      const reasonText = msg.reason === 'not-sharing'
        ? 'Ekran paylaşılmadığı için denetim isteği gönderilemedi.'
        : msg.reason === 'busy'
          ? 'Denetim izni şu anda başka bir kullanıcıda.'
          : 'Kontrol isteği reddedildi.';
      showToast(reasonText, 'warn');
    }
  } else if (msg.type === 'ctrl-revoke') {
    // İki yönlü: kontrol EDEN vazgeçti → kontrol edilen taraf izni kapatır;
    // kontrol EDİLEN durdurdu → kontrol eden taraf pencereyi kapatır.
    if (state.controlledBy === peerId) {
      stopBeingControlled(false);
      showToast('Uzaktan kontrol sonlandırıldı.', 'info');
    }
    if (state.activeControl && state.activeControl.hostId === peerId) {
      closeActiveControlSession(false);
      showToast('Uzaktan kontrol izni kaldırıldı.', 'info');
    }
  } else if (msg.type === 'ctrl-pointer') {
    if (state.controlledBy === peerId && msg.point) {
      state.remoteControlPointer = msg.point;
      window.electronAPI.updateControlPointer({
        x: msg.point.x,
        y: msg.point.y,
        label: displayName(peerId, peer.name),
        avatar: peer.avatar || null
      });
    }
  } else if (msg.type === 'ctrl-takeover') {
    if (state.controlledBy === peerId) {
      await setHostControlOwner('remote', peerId, true);
    }
  } else if (msg.type === 'ctrl-release') {
    if (state.controlledBy === peerId) {
      await setHostControlOwner('host', peerId, true);
    }
  } else if (msg.type === 'ctrl-owner') {
    if (state.activeControl && state.activeControl.hostId === peerId) {
      state.controlOwner = msg.owner === 'remote' ? 'remote' : 'host';
      remoteOwnerConfirmed = state.controlOwner === 'remote';
      setRemotePointerActive(remoteOwnerConfirmed);
      setHostPassivePointer(msg.hostPoint, remoteOwnerConfirmed);
      if (remoteOwnerConfirmed && pendingTakeoverPoint) {
        sendCtrlEvent({ type: 'mousemove', x: pendingTakeoverPoint.x, y: pendingTakeoverPoint.y });
      }
      pendingTakeoverPoint = null;
    }
  } else if (msg.type === 'ctrl-offer') {
    // GÖREV 3 — ters yön: EKRANI PAYLAŞAN kişi istek beklemeden denetim teklif
    // etti. Otomatik ele geçirme YOK; izleyici açıkça kabul etmelidir.
    if (!peer.sharing) {
      broadcastTo(peerId, { type: 'ctrl-offer-res', accepted: false, reqId: msg.reqId, reason: 'not-sharing' });
    } else if (state.activeControl || state.incomingControlOffer) {
      broadcastTo(peerId, { type: 'ctrl-offer-res', accepted: false, reqId: msg.reqId, reason: 'busy' });
    } else {
      showControlOfferNote(peerId, displayName(peerId, peer.name), msg.reqId);
    }
  } else if (msg.type === 'ctrl-offer-cancel') {
    if (state.incomingControlOffer && state.incomingControlOffer.peerId === peerId) {
      closeCtrlOfferNote();
      showToast('Denetim teklifi geri çekildi.', 'info');
    }
  } else if (msg.type === 'ctrl-offer-res') {
    // Paylaşan taraf: teklif ettiğim kişi yanıtladı.
    if (!state.pendingControlOffer || state.pendingControlOffer.peerId !== peerId) return;
    clearControlOffer();
    if (!msg.accepted) {
      showToast(msg.reason === 'busy'
        ? 'Kullanıcı şu anda başka bir denetim oturumunda.'
        : 'Denetim teklifi reddedildi.', 'warn');
      return;
    }
    if (!state.isSharing) {
      broadcastTo(peerId, { type: 'ctrl-res', accepted: false, reqId: msg.reqId, reason: 'not-sharing' });
      return;
    }
    if (state.controlledBy) {
      broadcastTo(peerId, { type: 'ctrl-res', accepted: false, reqId: msg.reqId, reason: 'busy' });
      return;
    }
    // Oturum, isteğe dayalı akışla BİREBİR aynı şekilde açılır (ctrl-res);
    // karşı tarafta paralel bir kod yolu yoktur.
    grantControlTo(peerId, msg.reqId);
  } else if (msg.type === 'ctrl-event') {
    // DİKKAT: activeControl kontrol EDEN tarafta tutulur; kontrol EDİLEN taraf
    // gelen girdileri controlledBy üzerinden doğrular. (Önceden activeControl'e
    // bakılıyordu ve kontrol edilen tarafta hep null olduğundan hiçbir girdi
    // işlenmiyordu — "uzaktan kontrol çalışmıyor" hatası buydu.)
    if (state.controlledBy === peerId && state.controlOwner === 'remote') {
      window.electronAPI.sendRemoteInput(msg.event);
    }
  } else if (msg.type.startsWith('wt-')) {
    handleWTMessage(peerId, msg);
  } else if (msg.type.startsWith('uno-')) {
    handleUnoMessage(peerId, msg);
  } else if (msg.type.startsWith('vv-')) {
    if (window.vampireVillagerHandler) window.vampireVillagerHandler(msg, peerId);
  } else if (msg.type.startsWith('sb-')) {
    handleSBMessage(peerId, msg);
  } else if (msg.type.startsWith('poke_') || ['activity_change', 'poll_start', 'poll_vote', 'poll_end', 'lvs_sync', 'wheel_items', 'wheel_ready', 'wheel_reset', 'wheel_spin'].includes(msg.type)) {
    if (window.activityHandler) window.activityHandler(msg);
  }
}



// ================= KONUŞMA ALGILAMA: TEK MERKEZLİ DÖNGÜ =================
// ESKİ TASARIM (ve iki ayrı hatası):
//   Her katılımcı için AYRI bir requestAnimationFrame zinciri koşuyordu.
//   1) CPU: rAF ekran tazeleme hızında çalışır. Ölçüm (4 sahte peer, bu makine):
//      saniyede 800 geri çağırma, 18.6 ms/s saf JS — üstelik rAF zinciri asla
//      boşa düşmediği için Chromium çizim hattını sürekli ~200 fps'te tutuyordu.
//      Oysa iş sadece "konuşuyor" noktasını yakıp söndürmek.
//   2) ALT+TAB: rAF arka planda kısılır. Ölçüm: pencere simge durumuna
//      küçültülünce hız 801/s -> 282/s'ye düştü (-65%). Bu döngü aynı zamanda
//      askıya alınan AudioContext'i dirilten (resume) TEK yerdi ve
//      state.speakingPeers'ı besliyordu; speakingPeers ise Yankı Kalkanı'nın
//      (echoDuck) girdisi. Yani arka planda: gelen ses zinciri (ensurePeerBoostChain
//      remoteAudioCtx üzerinden akar) askıda kalabiliyor -> GELEN ses bozuluyor;
//      bayat speakingPeers yüzünden mikrofon kazancı 0.1'de takılı kalıyor ->
//      GİDEN ses bozuluyor.
// YENİ TASARIM: tüm katılımcılar tek bir setInterval'de, sabit ~16 Hz'de
// taranır. setInterval backgroundThrottling:false ile arka planda da işler
// (ölçümle doğrulandı: VU kapısı simge durumundayken de tam 20/s koştu).
const SPEAKING_POLL_MS = 60; // ~16 Hz: göz için yeterli, rAF'in 1/12'si kadar iş
const speakingNodes = new Map(); // peerId -> { source, analyser, silentGain, data }
let speakingLoopTimer = null;

function releaseSpeakingNode(peerId) {
  const n = speakingNodes.get(peerId);
  if (!n) return;
  try { n.source.disconnect(); } catch (e) {}
  try { n.analyser.disconnect(); } catch (e) {}
  try { n.silentGain.disconnect(); } catch (e) {}
  speakingNodes.delete(peerId);
}

function runSpeakingDetection() {
  // AudioContext canlı tutma: Windows arka plana atınca/EcoQoS devreye girince
  // bağlam 'suspended'a düşebiliyor. remoteAudioCtx yalnızca göstergeyi değil,
  // %100 üzeri ses güçlendirmesi açık olan kişilerin GELEN sesini de taşır
  // (bkz. ensurePeerBoostChain) — askıda kalırsa o kişileri hiç duyamazsınız.
  const audioCtx = state.remoteAudioCtx;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  if (state.gateAudioCtx && state.gateAudioCtx.state === 'suspended') {
    state.gateAudioCtx.resume().catch(() => {});
  }

  speakingNodes.forEach((n, peerId) => {
    if (!state.peers.has(peerId)) { releaseSpeakingNode(peerId); return; }
    n.analyser.getByteFrequencyData(n.data);
    let sum = 0;
    for (let i = 0; i < n.data.length; i++) sum += n.data[i];
    const avg = sum / n.data.length;
    const speaking = avg > 15;
    // Kirli-kontrol: DOM'a yalnızca durum GERÇEKTEN değiştiğinde dokunulur.
    if (speaking) {
      if (!state.speakingPeers.has(peerId)) {
        state.speakingPeers.set(peerId, true);
        updateUserUI(peerId);
      }
    } else if (state.speakingPeers.has(peerId)) {
      state.speakingPeers.delete(peerId);
      updateUserUI(peerId);
    }
  });

  // Kimse kalmadıysa döngüyü tamamen durdur (boştayken sıfır CPU).
  if (speakingNodes.size === 0) {
    clearInterval(speakingLoopTimer);
    speakingLoopTimer = null;
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
  releaseSpeakingNode(peerId); // aynı peer için yeniden kurulum: eskisini sızdırma
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

  speakingNodes.set(peerId, {
    source, analyser, silentGain,
    data: new Uint8Array(analyser.frequencyBinCount)
  });
  if (!speakingLoopTimer) speakingLoopTimer = setInterval(runSpeakingDetection, SPEAKING_POLL_MS);
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

// Kurucu odadan ayrıldığında (çıkış düğmesiyle ya da alt+F4/çökme sonrası
// zaman aşımıyla) sahiplik boşta kalmasın: önce hâlâ odada olan yetkililer,
// yetkili yoksa sıradan kullanıcılar arasından odaya EN ÖNCE giren kişi yeni
// kurucu olur. Giriş damgası (joinedAt) sahibinin hello'suyla yayıldığı için
// her istemci aynı sıralamayı hesaplar; eşitlikte id ile kırılır, böylece
// split-brain olmaz. (item 4)
function founderSuccessorId() {
  const alive = [];
  if (state.myId) alive.push({ id: state.myId, joinedAt: state.joinedAt || 0 });
  state.peers.forEach((peer, id) => {
    if (id === state.founderId) return;
    if (state.bannedIds && state.bannedIds.has(id)) return;
    alive.push({ id, joinedAt: peer.joinedAt || 0 });
  });
  // Damgası bilinmeyen (0) kişiler en sona düşmeli; yoksa hello'su henüz
  // gelmemiş biri "en erken giren" sanılır.
  const order = (a, b) => {
    const aj = a.joinedAt || Number.MAX_SAFE_INTEGER;
    const bj = b.joinedAt || Number.MAX_SAFE_INTEGER;
    if (aj !== bj) return aj - bj;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  };
  const mods = alive.filter(c => isPeerModerator(c.id)).sort(order);
  if (mods.length > 0) return mods[0].id;
  const plain = alive.slice().sort(order);
  return plain.length > 0 ? plain[0].id : null;
}

function handleFounderLeft(prevFounderId) {
  const newFounderId = founderSuccessorId();
  if (!newFounderId) {
    state.founderId = null;
    return;
  }
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

function isPeerScreenOpen(peerId) {
  const peer = state.peers.get(peerId);
  const screenShare = state.screenShares && state.screenShares[peerId];
  const screenCard = document.getElementById(`vc-${peerId}-s`);
  return Boolean(peer && peer.sharing && screenShare && screenShare.joined && screenCard);
}

// Denetim düğmesi iki yerde bulunur: katılımcı listesindeki küçük 🖱️ ve
// izlenen ekran kartının üzerindeki "Denetle" düğmesi (bkz. addVideoCard).
// İkisi de aynı koşula bağlıdır, bu yüzden hepsi birlikte güncellenir.
function updateControlRequestButton(peerId) {
  const buttons = document.querySelectorAll(`[data-ctrl="${peerId}"]`);
  if (!buttons.length) return;
  const canRequestControl = isPeerScreenOpen(peerId);
  const active = !!(state.activeControl && state.activeControl.hostId === peerId);
  buttons.forEach((button) => {
    button.disabled = !canRequestControl && !active;
    button.classList.toggle('is-active', active);
    button.title = active
      ? 'Denetim penceresini aç'
      : (canRequestControl
        ? 'Uzaktan kontrol iste'
        : 'Kontrol isteği göndermek için önce ekran paylaşımını açın');
    const label = button.querySelector('span');
    if (label) label.textContent = active ? 'Denetimde' : 'Denetle';
  });
}

function addUser({ id, name, mic, deaf, sharing, self, ip, avatar, isFounder }) {
  if (document.querySelector(`[data-uid="${id}"]`)) return;
  const li = document.createElement('li');
  li.className = 'user';
  li.dataset.uid = id;
  li.dataset.realName = name; // lakap sisteminde gerçek isim burada saklanır
  const shownName = self ? name : displayName(id, name);
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
      <div class="uname-text" style="font-weight:bold;">${escapeHtml(shownName)}</div>
    </div>
    <div class="uact" style="display:flex; align-items:center; gap:8px;">
      <div id="ping-${id}" class="uping" title="Gecikme" style="font-size:11px; font-weight:bold;">--ms</div>
      ${!self ? `<button data-ctrl="${id}" title="Uzaktan kontrol iste">🖱️</button>` : ''}
    </div>
  `;
  document.getElementById('users').appendChild(li);
  if (!self) {
    li.querySelector(`[data-ctrl="${id}"]`).addEventListener('click', () => requestControl(id));
    updateControlRequestButton(id);

    // Menü hem normal (sol) tıkla hem de sağ tıkla açılır (Discord gibi)
    const openMenu = (e) => {
      if (e.target.closest(`[data-ctrl="${id}"]`)) {
        return;
      }
      e.preventDefault();
      showUserContextMenu(e, id, name);
    };
    li.addEventListener('click', openMenu);
    li.addEventListener('contextmenu', openMenu);
  }
  updateEmptyGrid();
}

// Odadaki bir kullanıcının (sağ/sol tık menüsünden "Profili Görüntüle")
// kartını gösterir; avatar/rozetleri state.peers'tan, arkadaşlık ve
// aksiyonları mevcut showUserContextMenu mantığıyla aynı şekilde kurar.
// Oda içi oturum UUID'sini kişinin KALICI arkadaş kimliğine (KNK-...) çevirir.
// DM ve arkadaşlık istekleri teamsync/user/<friendId>/events konusuna yayınlanır
// ve herkes yalnızca kendi friendId konusunu dinler; oda UUID'siyle gönderilen
// mesajlar kimsenin dinlemediği bir konuya gittiği için asla ulaşmıyordu.
function resolvePeerFriendId(targetId) {
  if (state.friends[targetId]) return targetId; // zaten kalıcı kimlik
  const peer = state.peers.get(targetId);
  return (peer && peer.friendId) ? peer.friendId : null;
}

// DM açma ortak akışı: kalıcı kimlik yoksa (karşı taraf eski sürüm ya da hello
// henüz gelmedi) kullanıcıyı bilgilendir, sessizce kaybolan mesaj oluşturma.
function openServerDM(targetId, targetName) {
  const friendId = resolvePeerFriendId(targetId);
  if (!friendId) {
    showToast('Kullanıcının kimliği henüz alınamadı, birkaç saniye sonra tekrar deneyin.', 'warn');
    return;
  }
  if (!state.friends[friendId]) {
    state.friends[friendId] = { name: targetName, online: true, temporary: true };
  }
  openDM(friendId);
  document.getElementById('server-dm-modal').classList.remove('hidden');
}

function sendRoomFriendRequest(targetId) {
  const friendId = resolvePeerFriendId(targetId);
  if (!friendId) {
    showToast('Kullanıcının kimliği henüz alınamadı, birkaç saniye sonra tekrar deneyin.', 'warn');
    return;
  }
  if (state.globalMqtt && state.globalMqtt.connected) {
    state.globalMqtt.publish(`teamsync/user/${friendId}/events`, JSON.stringify({
      type: 'friend_request',
      id: state.friendId,
      name: state.myName
    }));
    showToast('Arkadaşlık isteği gönderildi!', 'ok');
  } else {
    showToast('Hata: Bağlantı hazır değil.', 'warn');
  }
}

function showRoomUserProfile(targetId, targetName) {
  const peer = state.peers.get(targetId);
  const friendId = resolvePeerFriendId(targetId);
  // "temporary" girişler DM için açılmış geçici kayıtlardır, gerçek arkadaşlık değildir.
  const isFriend = !!(friendId && state.friends[friendId] && !state.friends[friendId].temporary);

  const badges = [{ text: '🟢 Sunucuda', color: '#10b981' }];
  if (targetId === state.founderId) badges.unshift({ text: '👑 Kurucu', color: '#fbbf24' });
  else if (isPeerModerator(targetId)) badges.unshift({ text: '🛡️ Yetkili', color: '#3b82f6' });

  const actions = [
    {
      label: '💬 Mesaj Gönder',
      onClick: () => openServerDM(targetId, targetName)
    }
  ];

  if (isFriend) {
    actions.push({
      label: '❌ Arkadaşlıktan Çıkar',
      danger: true,
      onClick: () => removeFriend(friendId)
    });
  } else {
    actions.push({
      label: '➕ Arkadaş Ekle',
      onClick: () => sendRoomFriendRequest(targetId)
    });
  }

  const nick = getNickname(targetId);
  window.showProfileModal({
    name: nick || targetName,
    // Peer kaydında avatar yoksa (ör. announce'ta gelmemişse) arkadaş
    // listesindeki avatara geri düş — ikisi de aynı kalıcı kimliği kullanır.
    avatar: (peer && peer.avatar) || (state.friends[targetId] && state.friends[targetId].avatar) || null,
    // Lakap varsa gerçek isim ID satırında görünür kalsın
    idLabel: nick ? `${targetName} • ID: ${targetId}` : `ID: ${targetId}`,
    badges,
    actions
  });
}

// Sağ tık menüsündeki ses bloğu. channel: 'mic' | 'screen'. Tek gövde, iki
// kanal — data-volchan sayesinde syncPeerVolumeControls ikisini de tanır.
function buildMenuVolumeBlock(targetId, channel, labelText, hintText) {
  const chan = AUDIO_CHANNEL_FIELDS[channel] ? channel : 'mic';
  const volWrap = document.createElement('div');
  volWrap.className = 'ucm-vol' + (chan === 'screen' ? ' ucm-vol-screen' : '');
  volWrap.dataset.volfor = targetId;
  volWrap.dataset.volrole = 'wrap';
  volWrap.dataset.volchan = chan;
  const volHeader = document.createElement('div');
  volHeader.className = 'ucm-vol-header';
  const volLabel = document.createElement('span');
  volLabel.textContent = labelText;
  const volVal = document.createElement('span');
  volVal.className = 'ucm-vol-val';
  volVal.dataset.volfor = targetId;
  volVal.dataset.volrole = 'value';
  volVal.dataset.volchan = chan;
  volHeader.appendChild(volLabel);
  volHeader.appendChild(volVal);

  const volRow = document.createElement('div');
  volRow.className = 'ucm-vol-row';
  const volMute = document.createElement('button');
  volMute.className = 'ucm-vol-mute';
  volMute.type = 'button';
  volMute.dataset.volfor = targetId;
  volMute.dataset.volrole = 'icon';
  volMute.dataset.volchan = chan;
  const volRange = document.createElement('input');
  volRange.type = 'range';
  volRange.className = 'ucm-vol-slider';
  volRange.dataset.volfor = targetId;
  volRange.dataset.volrole = 'slider';
  volRange.dataset.volchan = chan;
  volRange.min = '0';
  volRange.max = '200';
  volRange.step = '1';

  volRange.addEventListener('input', (ev) => {
    setUserVolumePercent(targetId, quantizeVolumePercent(parseInt(ev.target.value, 10) || 0), chan);
  });
  // Çift tık → %100 (varsayılan)
  volRange.addEventListener('dblclick', () => setUserVolumePercent(targetId, 100, chan));
  volMute.addEventListener('click', () => togglePeerMute(targetId, chan));

  const volHint = document.createElement('div');
  volHint.className = 'ucm-vol-hint';
  volHint.textContent = hintText;

  // Slider'a tıklamak menüyü kapatmasın
  volWrap.addEventListener('click', (ev) => ev.stopPropagation());
  volRow.appendChild(volMute);
  volRow.appendChild(volRange);
  volWrap.appendChild(volHeader);
  volWrap.appendChild(volRow);
  volWrap.appendChild(volHint);
  return volWrap;
}

function showUserContextMenu(e, targetId, targetName) {
  const existing = document.getElementById('user-custom-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'user-custom-context-menu';
  menu.className = 'user-context-menu';
  
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const resolvedFriendId = resolvePeerFriendId(targetId);
  const isFriend = !!(resolvedFriendId && state.friends[resolvedFriendId] && !state.friends[resolvedFriendId].temporary);
  const nick = getNickname(targetId);

  // Başlık: lakap varsa lakap büyük, gerçek isim altında küçük gösterilir.
  const title = document.createElement('div');
  title.style.cssText = 'padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 4px;';
  const titleName = document.createElement('div');
  titleName.style.cssText = 'font-size: 12px; font-weight: bold; color: var(--txt-main);';
  titleName.textContent = nick || targetName;
  title.appendChild(titleName);
  if (nick) {
    const realNameEl = document.createElement('div');
    realNameEl.style.cssText = 'font-size: 10px; color: var(--txt-mut); margin-top: 1px;';
    realNameEl.textContent = targetName;
    title.appendChild(realNameEl);
  }
  menu.appendChild(title);

  // Kişi Bazlı Ses Seviyesi (Discord tarzı): %0–%200, sadece bu cihazda geçerli.
  // Yüzde ALGISAL ölçektedir (bkz. volumePercentToGain): %50 gerçekten "yarı
  // kadar yüksek" duyulur. Sessize alma düğmesi, çift tıkla %100'e sıfırlama ve
  // Shift ile %1'lik ince adım desteklenir.
  menu.appendChild(buildMenuVolumeBlock(targetId, 'mic', 'Kullanıcı Ses Seviyesi', 'Çift tık: %100 • Shift: ince ayar'));

  // Ekran (sistem) sesi satırı yalnızca kişi ses paylaşıyorken görünür.
  const menuPeer = state.peers.get(targetId);
  if (menuPeer && menuPeer.screenAudio) {
    menu.appendChild(buildMenuVolumeBlock(targetId, 'screen', '🖥 Ekran Sesi', 'Müzik/oyun sesi — mikrofondan bağımsız'));
  }
  // (Boyama, menü body'ye eklendikten sonra yapılır — bkz. aşağıdaki
  // syncPeerVolumeControls çağrısı; sync belge genelinde arama yapar.)

  // Profile Button
  const profileBtn = document.createElement('button');
  profileBtn.className = 'user-context-menu-item';
  profileBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> Profili Görüntüle';
  profileBtn.addEventListener('click', () => {
    showRoomUserProfile(targetId, targetName);
    menu.remove();
  });
  menu.appendChild(profileBtn);

  // Lakap Koy / Değiştir — lakap SADECE bu cihazda saklanır, kimseye gönderilmez.
  const nickBtn = document.createElement('button');
  nickBtn.className = 'user-context-menu-item';
  nickBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg> ' + (nick ? 'Lakabı Değiştir' : 'Lakap Koy');
  nickBtn.addEventListener('click', async () => {
    menu.remove();
    const result = await window.showPrompt(
      '✏️ Lakap Koy',
      `"${targetName}" için bir lakap belirle. Lakabı sadece sen görürsün; boş bırakıp kaydedersen lakap silinir.`,
      nick || '',
      'Lakap yaz...'
    );
    if (result === null) return; // iptal edildi
    setNickname(targetId, result);
    const newNick = getNickname(targetId);
    showToast(newNick ? `Lakap kaydedildi: ${newNick}` : 'Lakap kaldırıldı', 'ok');
  });
  menu.appendChild(nickBtn);

  // Friend Option Button
  const friendBtn = document.createElement('button');
  friendBtn.className = 'user-context-menu-item';
  if (isFriend) {
    friendBtn.classList.add('danger');
    friendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="23" y1="11" x2="17" y2="11"></line></svg> Arkadaşı Sil';
    friendBtn.addEventListener('click', async () => {
      if (await window.showConfirm('⚠️ Arkadaşı Sil', `"${targetName}" arkadaşını silmek istediğinize emin misiniz?`)) {
        removeFriend(resolvedFriendId);
        showToast('Arkadaş silindi', 'info');
      }
      menu.remove();
    });
  } else {
    friendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg> Arkadaş Ekle';
    friendBtn.addEventListener('click', () => {
      sendRoomFriendRequest(targetId);
      menu.remove();
    });
  }
  menu.appendChild(friendBtn);

  // Message Button
  const msgBtn = document.createElement('button');
  msgBtn.className = 'user-context-menu-item';
  msgBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> Mesaj Gönder';
  msgBtn.addEventListener('click', () => {
    openServerDM(targetId, targetName);
    menu.remove();
  });
  menu.appendChild(msgBtn);

  // GÖREV 2 notu: "Uzaktan Kontrol İste" buradan KALDIRILDI. Denetim istemek
  // artık izlenen ekranın üzerindeki "🖱️ Denetle" düğmesiyle tek tıkla yapılır
  // (bkz. addVideoCard) — araya seçim menüsü girmez.

  // GÖREV 3: Ters yön — EKRANI PAYLAŞAN kişi, istek beklemeden bir izleyiciye
  // denetim verebilir. Bu satır yalnızca kendi ekranımı paylaşırken görünür.
  if (state.isSharing) {
    const grantBtn = document.createElement('button');
    grantBtn.className = 'user-context-menu-item';
    const controllingThis = state.controlledBy === targetId;
    const busyWithOther = !!state.controlledBy && !controllingThis;
    const offerPending = !!(state.pendingControlOffer && state.pendingControlOffer.peerId === targetId);
    if (controllingThis) {
      grantBtn.classList.add('danger');
      grantBtn.innerHTML = '⛔ Denetimi Geri Al';
      grantBtn.addEventListener('click', () => {
        stopBeingControlled(true);
        showToast('Denetim geri alındı.', 'info');
        menu.remove();
      });
    } else {
      grantBtn.disabled = busyWithOther || offerPending;
      grantBtn.title = busyWithOther
        ? 'Denetim şu anda başka bir kullanıcıda.'
        : (offerPending ? 'Denetim teklifi gönderildi, yanıt bekleniyor.' : 'Bu kişiye denetim ver (istemesini beklemeden)');
      grantBtn.innerHTML = '🎮 ' + (offerPending ? 'Teklif gönderildi…' : 'Denetim Ver');
      grantBtn.addEventListener('click', () => {
        offerControl(targetId);
        menu.remove();
      });
    }
    menu.appendChild(grantBtn);
  }

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
  syncPeerVolumeControls(targetId); // ses satırını mevcut değerle boya

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

// ====================== ODAK / TAM EKRAN / KİLİT (v2) ======================
// Eski sistem odaklanan kartı DOM'da #focus-area içine taşıyordu (appendChild).
// iframe/webview içeren kartlar (Birlikte İzle, Ortak Tarayıcı) her taşımada
// sıfırdan yükleniyor, videolar duruyor, kilitliyken kapanan kart takılı
// kalıyordu. Yeni sistem kartı HİÇ taşımaz: kart .focused sınıfı alır ve boş
// yer tutucunun (#focus-area) kapladığı alana mutlak konumlandırılır
// (syncFocusLayout). Tam ekran da kartın kendisinde açılır — yine DOM
// taşıması olmadan.
let focusedCard = null;
let focusMinimized = false;

const FOCUS_CARD_TITLES = {
  'wb-card': 'Beyaz Tahta',
  'wt-card': 'Birlikte İzle',
  'sb-card': 'Ortak Tarayıcı',
  'uno-card': 'UNO',
  'poll-card': 'Anket',
  'lvs-card': 'Film Gecesi',
  'wheel-card': 'Şans Çarkı',
  'poke-card': 'PokeSavaş'
};

// Odaklı kartın kutusunu yer tutucununkine eşitler. Kart #grid'in çocuğu ama
// mutlak konumu .main'e göre çözülür (.main position:relative, #grid odak
// modunda konumlandırılmamış) — bu yüzden şerit yatay kaydırılsa da kart yerinde
// durur ve #grid'in overflow'una takılmaz.
function syncFocusLayout() {
  if (!focusedCard || focusMinimized || document.fullscreenElement) return;
  const main = document.querySelector('.main');
  const spacer = document.getElementById('focus-area');
  if (!main || !spacer) return;
  const m = main.getBoundingClientRect();
  const r = spacer.getBoundingClientRect();
  focusedCard.style.top = (r.top - m.top) + 'px';
  focusedCard.style.left = (r.left - m.left) + 'px';
  focusedCard.style.width = r.width + 'px';
  focusedCard.style.height = r.height + 'px';
}

function clearFocusInlineLayout(card) {
  card.style.top = '';
  card.style.left = '';
  card.style.width = '';
  card.style.height = '';
}

// Etkinlikler kendi içeriklerini sık sık yeniden çizer. Odak denetimleri aktif
// kartın çocuğu olduğu için bu çizimler veya etkinliğe özel katmanlar denetimleri
// görünmez bırakmamalı. Bu yardımcı, odak oturumu boyunca tek görünür yerleşimi
// yeniden kurar; kilitliyken denetimleri ayrıca sabit ve üst katmanda tutar.
function ensureFocusControlsVisible() {
  if (!focusedCard) return;
  const controls = document.getElementById('focus-controls');
  const main = document.querySelector('.main');
  if (!controls || !main) return;

  controls.classList.remove('hidden');
  controls.classList.toggle('focus-controls-minimized', focusMinimized);
  controls.classList.toggle('focus-controls-locked', !!state.focusLocked && !focusMinimized);

  const host = focusMinimized ? main : focusedCard;
  if (controls.parentElement !== host) host.appendChild(controls);
}

// Kilit düğmesinin görünümünü state.focusLocked ile eşitler. Kilit,
// exitFocus gibi düğme dışı yollardan da sıfırlanabildiği için
// görünüm güncellemesi tek yerden yapılmalı.
function updateFocusLockBtn() {
  const btn = document.getElementById('focus-lock-btn');
  if (!btn) return;
  btn.classList.toggle('locked', !!state.focusLocked);
  btn.innerHTML = state.focusLocked
    ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
    : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
  const sourceTitle = state.focusLocked ? 'Odak Kilidini Aç' : 'Odak Kilidi (yanlışlıkla çıkmayı engeller)';
  const dictionary = typeof LEGACY_TEXT_BY_LOCALE !== 'undefined' ? LEGACY_TEXT_BY_LOCALE[getUserLanguage()] : null;
  btn.title = dictionary ? (translateLegacyValue(sourceTitle, dictionary) || sourceTitle) : sourceTitle;
  ensureFocusControlsVisible();
  updateFocusFullscreenBtn();
  updateFocusExitBtn();
}

function updateFocusFullscreenBtn() {
  const btn = document.getElementById('focus-fullscreen-btn');
  if (!btn) return;
  const fs = !!document.fullscreenElement;
  const locked = !!state.focusLocked;
  btn.innerHTML = fs
    ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>'
    : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
  btn.disabled = locked;
  btn.setAttribute('aria-disabled', String(locked));
  btn.title = locked ? 'Tam ekran için önce odak kilidini aç' : (fs ? 'Tam Ekrandan Çık (F)' : 'Tam Ekran (F)');
}

function updateFocusExitBtn() {
  const btn = document.getElementById('focus-exit-btn');
  if (!btn) return;
  const locked = !!state.focusLocked;
  btn.innerHTML = focusMinimized
    ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>'
    : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
  btn.disabled = locked;
  btn.setAttribute('aria-disabled', String(locked));
  btn.title = locked ? 'Boyutu değiştirmek için önce odak kilidini aç' : (focusMinimized ? 'Tekrar Büyüt' : 'Küçült');
  btn.setAttribute('aria-label', btn.title);
}

function enterFocus(card) {
  if (!card || card.classList.contains('hidden') || focusedCard === card) return;
  if (focusedCard) {
    focusedCard.classList.remove('focused');
    focusedCard.classList.remove('focus-minimized');
    clearFocusInlineLayout(focusedCard);
  }
  focusedCard = card;
  focusMinimized = false;
  card.classList.add('focused');
  card.classList.remove('focus-minimized');
  card.dataset.focusedAt = String(Date.now());
  document.querySelector('.main').classList.add('focus-mode');
  document.getElementById('focus-area').classList.remove('hidden');
  // Denetimler kartın içinde durur ki tam ekranda da görünsün (tam ekranda
  // yalnızca fullscreen öğenin alt ağacı çizilir).
  ensureFocusControlsVisible();
  updateFocusLockBtn();
  updateFocusFullscreenBtn();
  updateFocusExitBtn();
  syncFocusLayout();
  // Yer tutucu bu karede daha yeni görünür oldu; kesin ölçüm sonraki karede.
  requestAnimationFrame(syncFocusLayout);
}

function minimizeFocus() {
  if (!focusedCard || focusMinimized || state.focusLocked) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  focusedCard.classList.remove('focused');
  focusedCard.classList.add('focus-minimized');
  clearFocusInlineLayout(focusedCard);
  document.querySelector('.main').classList.remove('focus-mode');
  document.getElementById('focus-area').classList.add('hidden');
  // Küçültülen kart şeritte ekran dışında kalabilir. Kontroller kartın içinde
  // bırakılırsa kullanıcı geri büyütme düğmesine de ulaşamaz. Küçültülmüş
  // durumda üçlü grubu ana alana taşı ve viewport'a sabitle.
  focusMinimized = true;
  ensureFocusControlsVisible();
  updateFocusFullscreenBtn();
  updateFocusExitBtn();
}

function restoreFocus() {
  if (!focusedCard || !focusMinimized || focusedCard.classList.contains('hidden') || state.focusLocked) return;
  focusMinimized = false;
  focusedCard.classList.remove('focus-minimized');
  focusedCard.classList.add('focused');
  focusedCard.dataset.focusedAt = String(Date.now());
  document.querySelector('.main').classList.add('focus-mode');
  document.getElementById('focus-area').classList.remove('hidden');
  ensureFocusControlsVisible();
  updateFocusFullscreenBtn();
  updateFocusExitBtn();
  syncFocusLayout();
  requestAnimationFrame(syncFocusLayout);
}

function exitFocus() {
  if (!focusedCard) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const card = focusedCard;
  focusedCard = null;
  focusMinimized = false;
  card.classList.remove('focused');
  card.classList.remove('focus-minimized');
  clearFocusInlineLayout(card);
  document.querySelector('.main').classList.remove('focus-mode');
  document.getElementById('focus-area').classList.add('hidden');
  const controls = document.getElementById('focus-controls');
  controls.classList.add('hidden');
  controls.classList.remove('focus-controls-minimized');
  controls.classList.remove('focus-controls-locked');
  // Denetimleri kartın içinden çıkar: kart gizlense/silinse bile kaybolmasınlar.
  document.querySelector('.main').appendChild(controls);
  // Kilit bir odak oturumuna aittir; odak bitince sıfırlanır.
  state.focusLocked = false;
  updateFocusLockBtn();
  updateFocusExitBtn();
}

// API uyumluluğu: aktivite modülleri (uno, shared-browser, whiteboard, ...)
// bu imzayla çağırıyor. Aynı kart → odaktan çık; programatik çıkışlar kilidi
// UMURSAMAZ (kilitliyken kapanan kartın odakta takılı kalması eski sistemin
// donma sebebiydi). Farklı karta geçiş ise kilitliyken engellenir.
function toggleFocus(card) {
  if (!card) return;
  if (focusedCard === card) {
    if (focusMinimized) restoreFocus();
    else exitFocus();
    return;
  }
  if (state.focusLocked && focusedCard) return;
  enterFocus(card);
}

async function toggleFocusFullscreen() {
  if (!focusedCard) return;
  if (state.focusLocked) {
    showToast('Odak kilitli — tam ekranı değiştirmek için önce kilidi aç', 'info');
    return;
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      if (focusMinimized) restoreFocus();
      await focusedCard.requestFullscreen();
    }
  } catch (err) {
    console.warn('fullscreen toggle failed:', err);
  }
}

// Bir aktivite kartını açar (hidden kaldırır), odaklanabilir yapar ve başka
// bir kart odakta değilse odağa alır. Aktivite açılış yollarının tamamı bunu
// kullanmalı — poll/lvs/wheel/poke kartlarının odak/tam ekran/kilit
// alamamasının sebebi bu adımların o yollarda hiç yapılmamasıydı.
function openCardFocused(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  makeCardFocusable(el);
  if (!focusedCard) enterFocus(el);
}

function makeCardFocusable(card) {
  if (card.dataset.focusable) return;
  card.dataset.focusable = 'true';
  const title = FOCUS_CARD_TITLES[card.id];
  if (title && !card.dataset.focusTitle) card.dataset.focusTitle = title;
  // Bazı etkinlik kontrolleri click olayını durdurur veya içeriklerini aynı
  // olay içinde yeniden çizer. Capture aşamasında alınan bu güvence, kilitli
  // odakta olay tamamlanınca denetimlerin hâlâ görünür ve doğru kartta olmasını
  // sağlar.
  card.addEventListener('click', () => {
    if (focusedCard !== card || !state.focusLocked) return;
    requestAnimationFrame(() => {
      if (focusedCard === card && state.focusLocked) ensureFocusControlsVisible();
    });
  }, true);
  card.addEventListener('click', (e) => {
    // Odaklı kartın içine tıklamak odağı BOZMAZ (etkinlik kullanılırken
    // kazara küçülme eski sistemin en can sıkıcı davranışıydı). Küçültme:
    // odak denetim çubuğu; tam çıkış: Esc veya programatik kapatma yolları.
    if (focusedCard === card) {
      if (focusMinimized && !e.target.closest('#focus-controls, .card-actions, .inactive-overlay')) restoreFocus();
      return;
    }
    // Odakta DEĞİLKEN karta yapılan her tıklama odağa alır (pencereye tıklayınca
    // öne gelmesi gibi). Eski uzun hariç listesi (u-hand, u-card, wt-player...)
    // burada tuzaktı: UNO oyun ekranı bu öğelerle kaplı olduğundan odaktan
    // çıkınca karta geri dönmek imkânsızlaşıyordu. Yalnızca tıklaması odak
    // dışında anlam taşıyan öğeler hariç (kapat/ses düğmeleri, katılım
    // overlay'i, odak denetimleri).
    if (e.target.closest('#focus-controls, .card-actions, .inactive-overlay')) return;
    if (state.focusLocked && focusedCard) {
      showToast('Odak kilitli — geçiş için önce kilidi aç', 'info');
      return;
    }
    enterFocus(card);
  });
  // Odaklı kartta boş alana çift tık = tam ekran aç/kapat.
  card.addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'CANVAS') return; // beyaz tahtada çizimi bozmasın
    if (e.target.closest('.sb-tools, .card-actions, button, select, input, label, .u-card, .u-swatch, .u-picker, .u-hand, #focus-controls, .mactions')) return;
    // Kilit, kazara boyut değişimlerini de engellemeli: kilitliyken çift tık
    // tam ekranı AÇMAZ ve KAPATMAZ. Kilit açıkken düğme ve F kısayolu da
    // engellendiğinden ekran yalnızca kilit açıldıktan sonra değişebilir.
    if (state.focusLocked) return;
    // Şeritteki karta çift tıklanınca ilk tık odağa alır; ikinci tık hemen
    // tam ekrana fırlatmasın — odağa yeni girildiyse bekle.
    if (Date.now() - (Number(card.dataset.focusedAt) || 0) < 500) return;
    if (focusedCard === card) toggleFocusFullscreen();
  });
}

function normalizeActivitySearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .trim();
}

function filterActivityCards(query = '') {
  const picker = document.getElementById('act-list-card');
  if (!picker) return;
  const normalizedQuery = normalizeActivitySearchText(query);
  const cards = Array.from(picker.querySelectorAll('.card-act-btn'));
  let visibleCount = 0;

  cards.forEach(card => {
    const searchableText = normalizeActivitySearchText(`${card.dataset.search || ''} ${card.textContent || ''}`);
    const matches = !normalizedQuery || searchableText.includes(normalizedQuery);
    card.classList.toggle('activity-filtered', !matches);
    if (matches) visibleCount += 1;
  });

  picker.classList.toggle('activity-picker-searching', Boolean(normalizedQuery));
  const count = picker.querySelector('.activity-section-hint');
  if (count) count.textContent = `${visibleCount} etkinlik`;
  const empty = document.getElementById('activity-empty');
  if (empty) empty.classList.toggle('hidden', visibleCount !== 0);
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
    btn.innerHTML = `<span style="font-size:24px; font-weight:bold;">+</span><br/>Katıl: ${escapeHtml(title)}`;
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

// Kart üstündeki ses kutusu. channel: 'mic' | 'screen'. İki kanal da AYNI
// yapıyı kullanır; yalnızca data-volchan ve etiket değişir — böylece
// syncPeerVolumeControls tek bir seçiciyle ikisini de boyar.
function buildCardVolumeBox(peerId, channel) {
  const chan = AUDIO_CHANNEL_FIELDS[channel] ? channel : 'mic';
  const volBox = document.createElement('div');
  volBox.className = 'vcard-vol' + (chan === 'screen' ? ' vcard-vol-screen' : '');
  if (chan === 'screen') volBox.title = 'Ekran (sistem) sesi — mikrofondan bağımsız';

  if (chan === 'screen') {
    const tag = document.createElement('span');
    tag.className = 'vcard-vol-tag';
    tag.textContent = '🖥';
    volBox.appendChild(tag);
  }

  const muteBtn = document.createElement('button');
  muteBtn.className = 'vcard-vol-btn';
  muteBtn.dataset.volfor = peerId;
  muteBtn.dataset.volrole = 'icon';
  muteBtn.dataset.volchan = chan;
  muteBtn.type = 'button';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.className = 'vol-slider';
  slider.min = '0'; slider.max = '200'; slider.step = '1';
  slider.dataset.volfor = peerId;
  slider.dataset.volrole = 'slider';
  slider.dataset.volchan = chan;
  const val = document.createElement('span');
  val.className = 'vcard-vol-val';
  val.dataset.volfor = peerId;
  val.dataset.volrole = 'value';
  val.dataset.volchan = chan;
  slider.addEventListener('input', (e) => {
    setUserVolumePercent(peerId, quantizeVolumePercent(parseInt(e.target.value, 10) || 0), chan);
  });
  // Çift tık: %100'e (varsayılana) sıfırla.
  slider.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    setUserVolumePercent(peerId, 100, chan);
  });
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePeerMute(peerId, chan);
  });
  [slider, volBox].forEach(el => el.addEventListener('click', e => e.stopPropagation()));
  volBox.appendChild(muteBtn);
  volBox.appendChild(slider);
  volBox.appendChild(val);
  return volBox;
}

function addVideoCard(peerId, peerName, videoEl, isScreen) {
  if (document.getElementById(`vc-${peerId}-${isScreen ? 's' : 'c'}`)) return;
  const card = document.createElement('div');
  card.id = `vc-${peerId}-${isScreen ? 's' : 'c'}`;
  card.className = 'vcard' + (isScreen ? ' screen' : '');
  card.appendChild(videoEl);
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  
  // Kişinin sesi TEK oynatıcıdan (peer.audioEl) çıkar. Video elemanı da aynı
  // MediaStream'i taşır (mikrofon ve video aynı akışta gelir); sesi açık
  // bırakılırsa kişi ÇİFT duyulur ve kart slider'ı yalnızca bu ikinci kopyayı
  // kısar — "ekran paylaşımında ses kısma" tuhaflığının kaynağı buydu.
  videoEl.muted = true;

  videoEl.play().catch(err => console.warn('videoEl play failed in addVideoCard:', err));

  const lbl = document.createElement('div');
  lbl.className = 'vlbl';
  lbl.innerHTML = `<span class="live"></span> ${escapeHtml(peerName)} ${isScreen ? '• Ekran' : ''}`;
  card.appendChild(lbl);

  if (peerId !== 'self') {
    const actions = document.createElement('div');
    actions.className = 'card-actions';

    // Kart slider'ı da kişi bazlı ses ayarının (state.userVolumes) ta kendisini
    // sürer: sağ tık menüsüyle aynı değeri gösterir, ikisi birbirini ezmez.
    actions.appendChild(buildCardVolumeBox(peerId, 'mic'));

    // Ekran sesi (sistem sesi) MİKROFONDAN AYRI kısılır. Yalnızca o kişi
    // gerçekten ses paylaşıyorken görünür (peer.screenAudio, 'sharing'
    // mesajının audio bayrağından gelir; eski sürümlerde hiç gelmez).
    const shPeer = state.peers.get(peerId);
    if (isScreen && shPeer && shPeer.screenAudio) {
      actions.appendChild(buildCardVolumeBox(peerId, 'screen'));
    }

    // GÖREV 2: "izliyorum → tek tıkla denetle". Ayrı bir menü/panel açılmaz;
    // denetim düğmesi izlenen ekranın üstünde durur.
    if (isScreen) {
      const ctrlBtn = document.createElement('button');
      ctrlBtn.className = 'vcard-ctrl-btn';
      ctrlBtn.type = 'button';
      ctrlBtn.dataset.ctrl = peerId;
      ctrlBtn.innerHTML = '🖱️ <span>Denetle</span>';
      ctrlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Zaten denetim oturumu açıksa düğme pencereyi geri getirir.
        if (state.activeControl && state.activeControl.hostId === peerId) {
          document.getElementById('remote-modal').classList.remove('hidden');
          return;
        }
        requestControl(peerId);
      });
      actions.appendChild(ctrlBtn);
    }

    card.appendChild(actions);
  }

  makeCardFocusable(card);
  document.getElementById('grid').appendChild(card);
  updateEmptyGrid();
  // Kart DOM'a girdikten SONRA boyanır (sync belge genelinde arar).
  if (peerId !== 'self') {
    syncPeerVolumeControls(peerId);
    updateControlRequestButton(peerId);
  }

  if (isScreen && peerId !== 'self') {
    if (!state.screenShares) state.screenShares = {};
    if (!state.screenShares[peerId]) state.screenShares[peerId] = { joined: false };
    
    if (!state.screenShares[peerId].joined) {
      videoEl.muted = true;
      showInactiveOverlay(card.id, 'Ekran Paylaşımı', () => {
         state.screenShares[peerId].joined = true;
         removeInactiveOverlay(card.id);
         // videoEl sessiz kalır: kişinin sesi peer.audioEl'den çıkar (çift ses
         // olmasın), ses seviyesi kart slider'ı / sağ tık menüsünden ayarlanır.
         updateControlRequestButton(peerId);
         if (!focusedCard) toggleFocus(card);
         videoEl.play().catch(err => console.warn('videoEl play failed on join click:', err));
      });
    } else {
      updateControlRequestButton(peerId);
      if (!focusedCard) toggleFocus(card);
    }
  }
}

function removeVideoCard(peerId, isScreen) {
  const el = document.getElementById(`vc-${peerId}-${isScreen ? 's' : 'c'}`);
  if (el) {
    if (focusedCard === el) exitFocus();
    el.remove();
  }
  if (isScreen && peerId !== 'self' && state.screenShares) {
    delete state.screenShares[peerId];
    updateControlRequestButton(peerId);
  }
  updateEmptyGrid();
}
function getSfwChatBanThreshold(value = state.sfwChatBanThreshold) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 3;
}

function isChatBanned(peerId) {
  return !!peerId && !!state.chatBannedIds && state.chatBannedIds.has(peerId);
}

function setChatBan(peerId, banned, announce = true) {
  if (!state.isRoomFounder || !peerId || peerId === state.myId) return false;
  if (!state.chatBannedIds) state.chatBannedIds = new Set();
  if (banned) state.chatBannedIds.add(peerId);
  else state.chatBannedIds.delete(peerId);
  if (!banned && state.chatViolationCounts) state.chatViolationCounts.delete(peerId);
  if (announce) broadcast({ type: 'chat_ban', targetId: peerId, banned: !!banned });
  return true;
}

function registerSfwChatViolation(peerId) {
  if (!state.isRoomFounder || !state.sfwMode || !state.sfwChatBanEnabled || !peerId || peerId === state.myId) return false;
  if (isChatBanned(peerId)) return true;
  if (!state.chatViolationCounts) state.chatViolationCounts = new Map();
  const count = (state.chatViolationCounts.get(peerId) || 0) + 1;
  state.chatViolationCounts.set(peerId, count);
  if (count < getSfwChatBanThreshold()) return false;
  setChatBan(peerId, true);
  const peer = state.peers.get(peerId);
  showToast(`${peer?.name || 'Oyuncu'} argo kullanım sınırını aştığı için sohbetten yasaklandı.`, 'danger');
  return true;
}

async function checkTextWithAI(text) {
  if (typeof text !== 'string') text = String(text || '');
  if (!state.sfwMode || !text) return { ok: true, text: text };
  
  const warning = "Üzgünüm, belirlediğim güvenlik protokolleri gereği bu tür içerikler (küfür, argo veya +18) oluşturamıyorum. Daha nazik veya farklı bir konuda yardımcı olabilirim.";

  if (isProfaneText(text)) {
    return { ok: false, warning: warning, text: censorProfaneText(text) };
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
          return { ok: false, warning: warning, text: '' };
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
  if (isChatBanned(state.myId)) {
    showToast('Sohbetten yasaklandığınız için mesaj gönderemezsiniz.', 'danger');
    input.value = '';
    return;
  }

  if (!state.peers.has(peer.id) && state.peers.size >= 100) return;

  const res = await checkTextWithAI(rawText);
  let textToSend = res.ok ? rawText : (res.text || '');
  let isCensored = !res.ok;

  if (!res.ok) {
     showToast(res.warning, 'danger');
  }
  
  if (state.cryptoKey) {
    const enc = await encryptMsg(textToSend, state.cryptoKey);
    broadcast({ type: 'chat-enc', data: enc, isCensored: isCensored, sfwViolation: !res.ok });
  } else {
    broadcast({ type: 'chat', text: textToSend, isCensored: isCensored, sfwViolation: !res.ok });
  }
  
  appendChat('self', state.myName, textToSend, isCensored);
  input.value = '';
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
       const t = formatUserTime(date);
       
       let msgHtml = textToHtmlEscape(msg.text);
       if (msg.isCensored) {
         msgHtml = censoredTextHtml(msg.text);
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
  saveChatToLocal(uid, name, text, isCensored); // geçmişe gerçek isim yazılır

  // Ekranda lakap görünür (varsa) — sadece bu cihazda geçerli.
  if (uid && uid !== 'self') name = displayName(uid, name);

  if (state.sfwMode) {
    if (typeof name === 'string') {
      const cleanedName = cleanText(name, true);
      if (cleanedName !== name) name = "Anonim";
    }
    if (!isCensored && typeof text === 'string') text = cleanText(text);
  }
  const wrap = document.getElementById('msgs');
  const t = formatUserTime(new Date());

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

    if (isCensored) msgHtml = censoredTextHtml(text);
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
    if (state.isLobbyHost && (msg.type === 'wt-load' || msg.type === 'uno-state' || msg.type === 'poll_start' || msg.type === 'wheel_ready')) {
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

function isValidPeerId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function safeInlineArg(value) {
  return escapeHtml(JSON.stringify(String(value)));
}

function safeDomId(prefix, value) {
  return `${prefix}${String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128)}`;
}

function safeAvatarUrl(value) {
  if (typeof value !== 'string' || value.length > 2 * 1024 * 1024) return '';
  if (/^https:\/\//i.test(value)) return value;
  if (/^data:image\/(?!svg\+xml\b)[a-z0-9.+-]+;base64,/i.test(value)) return value;
  return '';
}

function safeFileName(value) {
  return String(value || 'dosya').replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').slice(0, 255) || 'dosya';
}

function safeMediaUrl(value, type) {
  if (typeof value !== 'string' || value.length > 30 * 1024 * 1024) return '';
  if (type === 'image' && /^data:image\/svg\+xml/i.test(value)) return '';
  if (/^blob:/i.test(value)) return value;
  const prefix = type === 'image' ? 'data:image/' : type === 'video' ? 'data:video/' : 'data:';
  if (!value.toLowerCase().startsWith(prefix)) return '';
  if (type === 'file' && /^data:(?:text\/html|text\/javascript|application\/javascript|image\/svg\+xml)/i.test(value)) return '';
  return value;
}

const USER_LANGUAGE_KEY = 'teamsync_language';
const USER_TIME_FORMAT_KEY = 'teamsync_time_format';
const USER_THEME_KEY = 'teamsync_theme';
const USER_SIMPLE_UI_KEY = 'teamsync_simple_ui';
const USER_QUALITY_KEY = 'teamsync_media_quality';
const USER_MIC_DEVICE_KEY = 'teamsync_mic_device_id';
const USER_NOISE_SUPPRESSION_KEY = 'teamsync_noise_suppression';
const USER_MIC_VOLUME_KEY = 'teamsync_mic_volume';
const USER_SPEAKER_VOLUME_KEY = 'teamsync_speaker_volume';
const USER_STREAM_PREVIEWS_KEY = 'teamsync_stream_previews';
const USER_STREAM_FPS_KEY = 'teamsync_stream_fps';
const USER_SHARE_SYSTEM_AUDIO_KEY = 'teamsync_share_system_audio';
// A locale is selectable only when its complete, reviewed catalogue is
// available. Do not expose a partly translated locale and silently replace
// the rest of its interface with English: that produces a mixed-language UI
// and misrepresents the level of support.
const SUPPORTED_LANGUAGES = ['tr', 'en', 'de', 'es', 'fr', 'pt-BR', 'ru', 'ar', 'kk', 'tk', 'mn', 'zh-CN', 'ja'];
const LANGUAGE_META = {
  tr: { flag: '🇹🇷', name: 'Türkçe', native: 'Turkish', locale: 'tr-TR' },
  en: { flag: '🇬🇧', name: 'English', native: 'İngilizce', locale: 'en-GB' },
  de: { flag: '🇩🇪', name: 'Deutsch', native: 'German', locale: 'de-DE' },
  es: { flag: '🇪🇸', name: 'Español', native: 'Spanish', locale: 'es-ES' },
  fr: { flag: '🇫🇷', name: 'Français', native: 'French', locale: 'fr-FR' },
  'pt-BR': { flag: '🇧🇷', name: 'Português (Brasil)', native: 'Brazilian Portuguese', locale: 'pt-BR' },
  ru: { flag: '🇷🇺', name: 'Русский', native: 'Russian', locale: 'ru-RU' },
  ar: { flag: '🇸🇦', name: 'العربية', native: 'Arabic', locale: 'ar' },
  kk: { flag: '🇰🇿', name: 'Қазақша', native: 'Kazakh', locale: 'kk-KZ' },
  tk: { flag: '🇹🇲', name: 'Türkmençe', native: 'Turkmen', locale: 'tk-TM' },
  mn: { flag: '🇲🇳', name: 'Монгол', native: 'Mongolian', locale: 'mn-MN' },
  'zh-CN': { flag: '🇨🇳', name: '简体中文', native: 'Simplified Chinese', locale: 'zh-CN' },
  ja: { flag: '🇯🇵', name: '日本語', native: 'Japanese', locale: 'ja-JP' }
};

const I18N = {
  tr: {
    'common.settings': 'Ayarlar',
    'common.settingsShort': 'Ayar',
    'common.close': 'Kapat',
    'common.save': 'Kaydet',
    'common.back': 'Geri',
    'common.cancel': 'İptal',
    'common.send': 'Gönder',
    'common.sendFile': 'Dosya Gönder',
    'common.join': 'Katıl',
    'common.create': 'Oluştur',
    'common.optional': '(opsiyonel)',
    'common.you': 'sen',
    'common.messagePlaceholder': 'Mesaj yaz...',
    'menu.join': 'Sunucuya Katıl',
    'menu.joinDesc': 'Bir odaya giriş yap',
    'menu.create': 'Sunucu Oluştur',
    'menu.createDesc': 'Kendi odanı kur',
    'menu.friends': 'Arkadaşlar',
    'menu.noFriends': 'Henüz hiç arkadaşın yok.',
    'menu.switchAccount': 'Hesap Değiştir',
    'menu.changeName': 'Adı Değiştir',
    'menu.copyId': "ID'yi Kopyala",
    'menu.invites': 'Davetler',
    'menu.addFriend': 'Arkadaş Ekle',
    'menu.selectFriend': 'Mesajlaşmaya başlamak için bir arkadaş seç.',
    'menu.friendId': "Arkadaşının ID'si",
    'menu.sendFriendRequest': 'Arkadaşlık İsteği Gönder',
    'menu.serverId': 'Sunucu ID',
    'menu.serverName': 'Sunucu Adı',
    'menu.myServer': 'Benim Sunucum',
    'menu.gameRoom': 'Oyun Odası',
    'menu.noiseSuppression': 'RNNoise Gürültü Engelleme',
    'menu.noiseSuppressionDesc': 'Ücretsiz, açık kaynak RNNoise AI ile arka plan seslerini temizler.',
    'menu.relay': 'Sunucu Bilgisayarınız Olsun (Röle)',
    'menu.relayDesc': 'WebRTC bağlanmıyorsa bunu açın.',
    'menu.familyFriendly': 'Aile Dostu (Yapay Zeka Koruması)',
    'menu.familyFriendlyDesc': 'Küfürleri ve +18 içerikleri yapay zekayla engeller.',
    'menu.gameMode': 'Oyun Modu (Hafif Sürüm)',
    'menu.gameModeDesc': 'RAM/CPU kullanımını azaltır (15 FPS kilit, yavaş tarama). Oyun arkasında önerilir.',
    'menu.audioQuality': 'Ses Kalitesi (Bitrate)',
    'menu.audioQualityDesc': 'Yüksek değer daha net ses ve daha fazla internet kullanımı demektir.',
    'room.users': 'KULLANICILAR',
    'room.voiceTest': 'SES TESTİ',
    'room.chat': 'SOHBET',
    'room.waiting': 'Bağlantı Bekleniyor',
    'room.waitingDesc': 'Aynı oda anahtarını yazan biri bağlanınca burada görünecek.',
    // Sohbet/DM görsel önizleme (lightbox) katmanı
    'viewer.title': 'Görsel Önizleme',
    'viewer.download': 'İndir',
    'viewer.copy': 'Panoya Kopyala',
    'viewer.copied': 'Görsel panoya kopyalandı.',
    'viewer.copyFailed': 'Görsel panoya kopyalanamadı.',
    'viewer.zoomIn': 'Yakınlaştır',
    'viewer.zoomOut': 'Uzaklaştır',
    'viewer.rotateLeft': 'Sola Döndür',
    'viewer.rotateRight': 'Sağa Döndür',
    'viewer.prev': 'Önceki Görsel',
    'viewer.next': 'Sonraki Görsel',
    'viewer.fit': 'Sığdır',
    'viewer.actualSize': 'Gerçek Boyut',
    'viewer.toggleSize': 'Gerçek Boyut / Sığdır',
    'share.chooseSource': 'Ekran / Pencere Seç',
    'share.systemAudio': 'Sistem Sesini de Paylaş',
    'toolbar.voice': 'Ses',
    'toolbar.deafen': 'Sağır',
    'toolbar.ptt': 'Bas',
    'toolbar.screen': 'Ekran',
    'toolbar.board': 'Tahta',
    'toolbar.activity': 'Etkinlik',
    'toolbar.record': 'Kayıt',
    'toolbar.volume': 'Düzey',
    'toolbar.founder': 'Kurucu',
    'toolbar.voiceTitle': 'Mikrofon (M)',
    'toolbar.deafenTitle': 'Sağırlaştır (D)',
    'toolbar.screenTitle': 'Ekran Paylaş (S)',
    'toolbar.boardTitle': 'Beyaz Tahta (W)',
    'toolbar.activityTitle': 'Etkinlikler (E)',
    'toolbar.recordTitle': 'Kayıt (R)',
    'toolbar.volumeTitle': 'Ses Seviyesi',
    'toolbar.founderTitle': 'Kurucu Ayarları',
    'settings.personal': 'Kişisel Ayarlar',
    'settings.userSettings': 'KULLANICI AYARLARI',
    'settings.appSettings': 'UYGULAMA AYARLARI',
    'settings.general': 'Genel',
    'settings.generalLead': "TeamSync'in görünümünü ve performansını yönet.",
    'settings.simpleUi': 'Sade görünüm',
    'settings.simpleUiDesc': 'Gradyanları, renk karışımlarını ve parlama efektlerini kaldırarak yalnızca seçili renk paletini kullanır.',
    'settings.appearance': 'GÖRÜNÜM',
    'settings.backgroundTheme': 'Arka plan teması',
    'settings.backgroundThemeDesc': 'Kendine en rahat gelen görünümü seç. Tercihin yalnızca bu cihazda saklanır.',
    'settings.personalPreference': 'Kişisel tercih',
    'settings.themeAurora': 'Mevcut Mor',
    'settings.themeAuroraDesc': 'Canlı ve yumuşak',
    'settings.themeBlack': 'Gece Siyahı',
    'settings.themeBlackDesc': 'Saf ve dikkat dağıtmayan',
    'settings.themeNavy': 'Derin Lacivert',
    'settings.themeNavyDesc': 'Sakin ve odaklı',
    'settings.themeWhite': 'Temiz Beyaz',
    'settings.themeWhiteDesc': 'Aydınlık ve ferah',
    'settings.themeViolet': 'Mor & Beyaz',
    'settings.themeVioletDesc': 'Açık zemin, canlı mor',
    'settings.themeCustom': 'Kendi Teman',
    'settings.themeCustomDesc': 'Renkleri sen seç',
    'settings.themeCustomBg': 'Arka plan rengi',
    'settings.themeCustomAccent': 'Vurgu rengi',
    'settings.themeCustomButton': 'Buton rengi',
    'settings.themeCustomPresets': 'Hazır presetler:',
    'settings.themeHint': 'Seçimini önizleyebilir, Kaydet ile kalıcı hale getirebilirsin.',
    'settings.voice': 'Ses ve Görüntü',
    'settings.voiceLead': 'Mikrofon ve hoparlör cihazlarını, ses seviyelerini ve konuşma biçimini ayarla.',
    'settings.microphone': 'Mikrofon',
    'settings.speaker': 'Konuşmacı',
    'settings.defaultMicrophone': 'Windows Varsayılanı',
    'settings.defaultSpeaker': 'Windows Varsayılanı',
    'settings.micVolume': 'Mikrofon Ses Seviyesi',
    'settings.speakerVolume': 'Hoparlör Ses Seviyesi',
    'settings.micTest': 'Mikrofon Testi',
    'settings.stopMicTest': 'Testi Durdur',
    'settings.micMeter': 'Canlı mikrofon ses seviyesi',
    'settings.micTestHelp': 'Test sırasında konuş; çubuklar mikrofonundan gelen gerçek ses seviyesini gösterir.',
    'settings.micPermissionError': 'Mikrofon testi başlatılamadı. Mikrofon iznini ve aygıtı kontrol et.',
    'settings.broadcast': 'Yayın',
    'settings.broadcastLead': 'Ekran paylaşımının önizleme ve kalite davranışını ayarla.',
    'settings.showPreviews': 'Yayın Ön İzlemelerini göster',
    'settings.showPreviewsDesc': 'Paylaşacağın ekranı seçerken pencere önizlemelerini gösterir.',
    'settings.advancedBroadcast': 'Gelişmiş Yayın Ayarlarını Göster',
    'settings.advancedBroadcastDesc': 'Yayın kalitesi, kare hızı ve sistem sesi',
    'settings.frameRate': 'Yayın Kare Hızı',
    'settings.shareSystemAudio': 'Sistem sesini varsayılan olarak paylaş',
    'settings.shareSystemAudioDesc': 'Ekran paylaşım penceresi açıldığında sistem sesi seçeneğini açık getirir.',
    'settings.previewHidden': 'Önizleme gizli',
    'settings.deviceChanged': 'Ses cihazı değiştirildi.',
    'settings.connections': 'Bağlantılar',
    'settings.networkLead': 'Kısıtlı ağlarda bağlantı kurmak için özel TURN sunucusu kullan.',
    'settings.mediaLibrary': 'GIF ve Medya',
    'settings.mediaLibraryLead': 'Sık kullandığın GIF, fotoğraf ve kısa videoları bu cihazda sakla.',
    'settings.addMedia': 'Medya Ekle',
    'settings.dropMedia': 'GIF, fotoğraf veya videonu buraya bırak',
    'settings.dropMediaDesc': 'Dosya seçmek için tıklayabilirsin · Dosya başına en fazla 20 MB',
    'settings.mediaLocalTitle': 'Yalnızca bu bilgisayarda',
    'settings.mediaLocalDesc': 'Kütüphanendeki GIF, fotoğraf ve videolar yerel olarak saklanır; buluta yüklenmez.',
    'settings.savedMedia': 'kayıtlı medya',
    'settings.mediaAll': 'Tümü',
    'settings.mediaImages': 'Fotoğraflar',
    'settings.mediaVideos': 'Videolar',
    'settings.mediaEmpty': 'Kütüphanen henüz boş',
    'settings.mediaEmptyDesc': 'Eklediğin GIF ve görseller ataç menüsündeki “Kendi medyanı kullan” bölümünde görünecek.',
    'mediaPicker.title': 'Kendi medyanı kullan',
    'mediaPicker.lead': 'Kaydettiğin bir GIF, fotoğraf veya videoyu seçip gönder.',
    'mediaPicker.search': 'Ad veya #etiket ara...',
    'mediaPicker.empty': 'Gönderebileceğin kayıtlı medya yok',
    'mediaPicker.emptyDesc': 'Ayarlar → GIF ve Medya bölümünden kütüphanene içerik ekleyebilirsin.',
    'mediaPicker.openSettings': 'Medya Ayarlarını Aç',
    'mediaPicker.sendHint': 'Göndermek için bir medyaya tıkla',
    'mediaPicker.sent': 'Kayıtlı medya gönderildi.',
    'attach.title': 'Ne göndermek istiyorsun?',
    'attach.limit': 'En fazla 20 MB',
    'attach.external': 'Dışarıdan dosya seç',
    'attach.externalDesc': 'Fotoğraf, GIF, video veya dosya ekle',
    'attach.library': 'Kendi medyanı kullan',
    'attach.libraryDesc': 'Ayarlarda kaydettiğin GIF ve fotoğraflardan seç',
    'attach.selectFriend': 'Önce mesaj göndereceğin bir arkadaş seç.',
    'mediaLibrary.deleteTitle': 'Medyayı sil',
    'mediaLibrary.deleteConfirm': 'Bu medya kütüphanenden kalıcı olarak silinsin mi?',
    'mediaLibrary.deleted': 'Medya kütüphaneden silindi.',
    'mediaLibrary.delete': 'Sil',
    'mediaLibrary.added': 'Medya bu bilgisayardaki kütüphanene eklendi.',
    'mediaLibrary.duplicate': 'Bu medya zaten kütüphanende.',
    'mediaLibrary.tooLarge': 'Dosya 20 MB sınırını aşıyor.',
    'mediaLibrary.unsupported': 'Bu dosya fotoğraf, GIF veya desteklenen bir video değil.',
    'mediaLibrary.emptyFile': 'Dosya boş veya okunamıyor.',
    'mediaLibrary.storageError': 'Dosya bu bilgisayara kaydedilemedi. Boş disk alanını kontrol et.',
    'mediaLibrary.edit': 'İsim ve etiketleri düzenle',
    'mediaLibrary.send': 'Gönder',
    'mediaDetail.titleNew': 'Medyanı adlandır',
    'mediaDetail.titleEdit': 'İsim ve etiketleri düzenle',
    'mediaDetail.lead': 'Bir ad ve #etiket ver; kütüphanende saniyede bulursun.',
    'mediaDetail.nameLabel': 'Ad',
    'mediaDetail.namePlaceholder': 'Örn: dans eden kedi',
    'mediaDetail.tagsLabel': 'Etiketler',
    'mediaDetail.tagsPlaceholder': '#kedi #komik',
    'mediaDetail.tagsHint': 'Enter veya boşluk ile ekle · en fazla 8 etiket',
    'mediaDetail.suggested': 'Sık kullandıkların',
    'mediaDetail.skip': 'Atla',
    'mediaDetail.saveNext': 'Kaydet ve devam',
    'mediaDetail.saved': 'Medya bilgileri güncellendi.',
    'mediaDetail.tagLimit': 'En fazla 8 etiket ekleyebilirsin.',
    'mediaDetail.removeTag': 'Etiketi kaldır',
    'dm.fileTooLarge': 'DM üzerinden en fazla 20 MB dosya gönderebilirsin.',
    'dm.notConnected': 'Dosya göndermek için çevrimiçi bir arkadaş seç.',
    'settings.languageTime': 'Dil ve Zaman',
    'settings.languageLead': 'Arayüz dilini ve mesaj saatlerinin gösterimini seç.',
    'settings.hwaccel': 'Donanım Hızlandırma',
    'settings.hwaccelDesc': 'Daha akıcı arayüz ve efektler için GPU kullanır. Değişiklik yeniden başlatınca uygulanır.',
    'settings.ptt': 'Bas-Konuş',
    'settings.pttDesc': 'Yalnızca SPACE tuşuna basılıyken ses iletir.',
    'settings.quality': 'Kamera / Ekran Kalitesi',
    'settings.qualityHigh': 'Yüksek (1080p)',
    'settings.qualityMedium': 'Orta (720p)',
    'settings.qualityLow': 'Düşük (480p)',
    'settings.turnUrl': 'TURN URL / Credentials API',
    'settings.username': 'Kullanıcı Adı',
    'settings.password': 'Şifre',
    'settings.turnHelp': 'Bir kişinin TURN bilgisi girmesi yeterlidir; odadaki diğer katılımcılarla otomatik paylaşılır.',
    'settings.chooseLanguage': 'Bir dil seç',
    'settings.timeFormat': 'Zaman formatı',
    'settings.timeAuto': 'Otomatik',
    'settings.time12': '12 saatlik',
    'settings.time24': '24 saatlik',
    'settings.preview': 'Önizleme',
    'settings.savedLocally': 'Tercihler bu cihazda saklanır.',
    'settings.saved': 'Ayarlar kaydedildi!',
    'settings.hwSaved': 'Donanım hızlandırma tercihi kaydedildi. Yeniden başlatınca etkin olacak.'
  },
  en: {
    'common.settings': 'Settings',
    'common.settingsShort': 'Settings',
    'common.close': 'Close',
    'common.save': 'Save Changes',
    'common.back': 'Back',
    'common.cancel': 'Cancel',
    'common.send': 'Send',
    'common.sendFile': 'Send File',
    'common.join': 'Join',
    'common.create': 'Create',
    'common.optional': '(optional)',
    'common.you': 'you',
    'common.messagePlaceholder': 'Write a message...',
    'menu.join': 'Join a Server',
    'menu.joinDesc': 'Enter an existing room',
    'menu.create': 'Create a Server',
    'menu.createDesc': 'Start your own room',
    'menu.friends': 'Friends',
    'menu.noFriends': 'You do not have any friends yet.',
    'menu.switchAccount': 'Switch Account',
    'menu.changeName': 'Change Name',
    'menu.copyId': 'Copy ID',
    'menu.invites': 'Invites',
    'menu.addFriend': 'Add Friend',
    'menu.selectFriend': 'Select a friend to start messaging.',
    'menu.friendId': "Your friend's ID",
    'menu.sendFriendRequest': 'Send Friend Request',
    'menu.serverId': 'Server ID',
    'menu.serverName': 'Server Name',
    'menu.myServer': 'My Server',
    'menu.gameRoom': 'Game Room',
    'menu.noiseSuppression': 'RNNoise Noise Suppression',
    'menu.noiseSuppressionDesc': 'Removes background noise with free, open-source RNNoise AI.',
    'menu.relay': 'Use Your Computer as Relay',
    'menu.relayDesc': 'Enable this when WebRTC cannot connect.',
    'menu.familyFriendly': 'Family Friendly (AI Protection)',
    'menu.familyFriendlyDesc': 'Uses AI to block profanity and adult content.',
    'menu.gameMode': 'Game Mode (Lightweight)',
    'menu.gameModeDesc': 'Reduces RAM/CPU use (15 FPS cap and slower scans). Recommended behind games.',
    'menu.audioQuality': 'Audio Quality (Bitrate)',
    'menu.audioQualityDesc': 'Higher values provide clearer audio and use more bandwidth.',
    'room.users': 'USERS',
    'room.voiceTest': 'VOICE TEST',
    'room.chat': 'CHAT',
    'room.waiting': 'Waiting for Connection',
    'room.waitingDesc': 'Anyone entering the same room key will appear here.',
    // Chat/DM image preview (lightbox) layer
    'viewer.title': 'Image Preview',
    'viewer.download': 'Download',
    'viewer.copy': 'Copy to Clipboard',
    'viewer.copied': 'Image copied to the clipboard.',
    'viewer.copyFailed': 'The image could not be copied.',
    'viewer.zoomIn': 'Zoom In',
    'viewer.zoomOut': 'Zoom Out',
    'viewer.rotateLeft': 'Rotate Left',
    'viewer.rotateRight': 'Rotate Right',
    'viewer.prev': 'Previous Image',
    'viewer.next': 'Next Image',
    'viewer.fit': 'Fit',
    'viewer.actualSize': 'Actual Size',
    'viewer.toggleSize': 'Actual Size / Fit',
    'share.chooseSource': 'Choose a Screen / Window',
    'share.systemAudio': 'Share System Audio',
    'toolbar.voice': 'Voice',
    'toolbar.deafen': 'Deafen',
    'toolbar.ptt': 'Talk',
    'toolbar.screen': 'Screen',
    'toolbar.board': 'Board',
    'toolbar.activity': 'Activity',
    'toolbar.record': 'Record',
    'toolbar.volume': 'Volume',
    'toolbar.founder': 'Owner',
    'toolbar.voiceTitle': 'Microphone (M)',
    'toolbar.deafenTitle': 'Deafen (D)',
    'toolbar.screenTitle': 'Share Screen (S)',
    'toolbar.boardTitle': 'Whiteboard (W)',
    'toolbar.activityTitle': 'Activities (E)',
    'toolbar.recordTitle': 'Record (R)',
    'toolbar.volumeTitle': 'Volume Level',
    'toolbar.founderTitle': 'Owner Settings',
    'settings.personal': 'Personal Settings',
    'settings.userSettings': 'USER SETTINGS',
    'settings.appSettings': 'APP SETTINGS',
    'settings.general': 'General',
    'settings.generalLead': 'Manage the appearance and performance of TeamSync.',
    'settings.simpleUi': 'Simple appearance',
    'settings.simpleUiDesc': 'Uses only the selected color palette by removing gradients, mixed colors, and glow effects.',
    'settings.appearance': 'APPEARANCE',
    'settings.backgroundTheme': 'Background theme',
    'settings.backgroundThemeDesc': 'Choose the look that feels most comfortable. Your preference is stored only on this device.',
    'settings.personalPreference': 'Personal preference',
    'settings.themeAurora': 'Current Purple',
    'settings.themeAuroraDesc': 'Vibrant and soft',
    'settings.themeBlack': 'Midnight Black',
    'settings.themeBlackDesc': 'Pure and distraction-free',
    'settings.themeNavy': 'Deep Navy',
    'settings.themeNavyDesc': 'Calm and focused',
    'settings.themeWhite': 'Clean White',
    'settings.themeWhiteDesc': 'Bright and airy',
    'settings.themeViolet': 'Violet & White',
    'settings.themeVioletDesc': 'Light background, vivid violet',
    'settings.themeCustom': 'Custom Theme',
    'settings.themeCustomDesc': 'Pick your own colors',
    'settings.themeCustomBg': 'Background color',
    'settings.themeCustomAccent': 'Accent color',
    'settings.themeCustomButton': 'Button color',
    'settings.themeCustomPresets': 'Ready-made presets:',
    'settings.themeHint': 'Preview your choice, then select Save to keep it.',
    'settings.voice': 'Voice & Video',
    'settings.voiceLead': 'Choose microphone and speaker devices, volume levels, and voice behavior.',
    'settings.microphone': 'Microphone',
    'settings.speaker': 'Speaker',
    'settings.defaultMicrophone': 'Windows Default',
    'settings.defaultSpeaker': 'Windows Default',
    'settings.micVolume': 'Microphone Volume',
    'settings.speakerVolume': 'Speaker Volume',
    'settings.micTest': 'Mic Test',
    'settings.stopMicTest': 'Stop Test',
    'settings.micMeter': 'Live microphone level',
    'settings.micTestHelp': 'Speak during the test; the bars show the real level coming from your microphone.',
    'settings.micPermissionError': 'The microphone test could not start. Check microphone permission and your device.',
    'settings.broadcast': 'Broadcast',
    'settings.broadcastLead': 'Configure screen-share preview and quality behavior.',
    'settings.showPreviews': 'Show Broadcast Previews',
    'settings.showPreviewsDesc': 'Shows window previews while choosing the screen you want to share.',
    'settings.advancedBroadcast': 'Show Advanced Broadcast Settings',
    'settings.advancedBroadcastDesc': 'Broadcast quality, frame rate, and system audio',
    'settings.frameRate': 'Broadcast Frame Rate',
    'settings.shareSystemAudio': 'Share system audio by default',
    'settings.shareSystemAudioDesc': 'Opens the system-audio option enabled in the screen-share picker.',
    'settings.previewHidden': 'Preview hidden',
    'settings.deviceChanged': 'Audio device changed.',
    'settings.connections': 'Connections',
    'settings.networkLead': 'Use a custom TURN server to connect through restricted networks.',
    'settings.mediaLibrary': 'GIF & Media',
    'settings.mediaLibraryLead': 'Keep your favorite GIFs, photos, and short videos on this device.',
    'settings.addMedia': 'Add Media',
    'settings.dropMedia': 'Drop a GIF, photo, or video here',
    'settings.dropMediaDesc': 'Click to choose files · Up to 20 MB per file',
    'settings.mediaLocalTitle': 'Only on this computer',
    'settings.mediaLocalDesc': 'GIFs, photos, and videos in your library stay local and are not uploaded to the cloud.',
    'settings.savedMedia': 'saved items',
    'settings.mediaAll': 'All',
    'settings.mediaImages': 'Photos',
    'settings.mediaVideos': 'Videos',
    'settings.mediaEmpty': 'Your library is empty',
    'settings.mediaEmptyDesc': 'GIFs and photos you add will appear under “Use your media” in the attachment menu.',
    'mediaPicker.title': 'Use your media',
    'mediaPicker.lead': 'Choose and send a GIF, photo, or video you have saved.',
    'mediaPicker.search': 'Search by name or #tag...',
    'mediaPicker.empty': 'No saved media is ready to send',
    'mediaPicker.emptyDesc': 'Add content from Settings → GIF & Media.',
    'mediaPicker.openSettings': 'Open Media Settings',
    'mediaPicker.sendHint': 'Click an item to send it',
    'mediaPicker.sent': 'Saved media sent.',
    'attach.title': 'What would you like to send?',
    'attach.limit': 'Up to 20 MB',
    'attach.external': 'Choose an external file',
    'attach.externalDesc': 'Add a photo, GIF, video, or file',
    'attach.library': 'Use your media',
    'attach.libraryDesc': 'Choose from GIFs and photos saved in Settings',
    'attach.selectFriend': 'Select a friend before sending a message.',
    'mediaLibrary.deleteTitle': 'Delete media',
    'mediaLibrary.deleteConfirm': 'Permanently remove this item from your media library?',
    'mediaLibrary.deleted': 'Media removed from your library.',
    'mediaLibrary.delete': 'Delete',
    'mediaLibrary.added': 'Media added to this computer’s library.',
    'mediaLibrary.duplicate': 'This media is already in your library.',
    'mediaLibrary.tooLarge': 'The file exceeds the 20 MB limit.',
    'mediaLibrary.unsupported': 'This file is not a photo, GIF, or supported video.',
    'mediaLibrary.emptyFile': 'The file is empty or unreadable.',
    'mediaLibrary.storageError': 'The file could not be saved on this computer. Check free disk space.',
    'mediaLibrary.edit': 'Edit name and tags',
    'mediaLibrary.send': 'Send',
    'mediaDetail.titleNew': 'Name your media',
    'mediaDetail.titleEdit': 'Edit name and tags',
    'mediaDetail.lead': 'Give it a name and #tags so you can find it instantly.',
    'mediaDetail.nameLabel': 'Name',
    'mediaDetail.namePlaceholder': 'e.g. dancing cat',
    'mediaDetail.tagsLabel': 'Tags',
    'mediaDetail.tagsPlaceholder': '#cat #funny',
    'mediaDetail.tagsHint': 'Press Enter or space to add · up to 8 tags',
    'mediaDetail.suggested': 'Frequently used',
    'mediaDetail.skip': 'Skip',
    'mediaDetail.saveNext': 'Save and continue',
    'mediaDetail.saved': 'Media details updated.',
    'mediaDetail.tagLimit': 'You can add up to 8 tags.',
    'mediaDetail.removeTag': 'Remove tag',
    'dm.fileTooLarge': 'You can send files up to 20 MB in direct messages.',
    'dm.notConnected': 'Select an online friend before sending a file.',
    'settings.languageTime': 'Language & Time',
    'settings.languageLead': 'Choose the interface language and message time display.',
    'settings.hwaccel': 'Hardware Acceleration',
    'settings.hwaccelDesc': 'Uses the GPU for smoother visuals and effects. Applied after restarting the app.',
    'settings.ptt': 'Push to Talk',
    'settings.pttDesc': 'Transmits your voice only while the SPACE key is held.',
    'settings.quality': 'Camera / Screen Quality',
    'settings.qualityHigh': 'High (1080p)',
    'settings.qualityMedium': 'Medium (720p)',
    'settings.qualityLow': 'Low (480p)',
    'settings.turnUrl': 'TURN URL / Credentials API',
    'settings.username': 'Username',
    'settings.password': 'Password',
    'settings.turnHelp': 'Only one person needs to enter TURN details; they are shared automatically with the room.',
    'settings.chooseLanguage': 'Choose a language',
    'settings.timeFormat': 'Time format',
    'settings.timeAuto': 'Automatic',
    'settings.time12': '12-hour',
    'settings.time24': '24-hour',
    'settings.preview': 'Preview',
    'settings.savedLocally': 'Preferences are stored on this device.',
    'settings.saved': 'Settings saved!',
    'settings.hwSaved': 'Hardware acceleration preference saved. It will apply after restart.'
  }
};

// Eski ekranların tamamını tek seferde yeniden yazmadan dil değişimine dahil
// etmek için yalnızca sabit arayüz metinlerinde çalışan uyumluluk sözlüğü.
// Sohbet, arkadaş listesi ve kullanıcı adları özellikle kapsam dışıdır.
Object.assign(I18N.tr, {
  'app.subtitle': "P2P • Sunucusuz • Aynı Wi-Fi'da otomatik bulur, internetten bağlanılabilir",
  'network.connected': 'İnternet üzerinden bağlantı aktif',
  'network.yourIp': 'Senin IP',
  'network.discoveryHint': 'aynı ağdaki arkadaşın otomatik bulur',
  'invites.title': 'Gelen Arkadaşlık Davetleri',
  'invites.lead': 'Sana gelen arkadaşlık istekleri burada görünür.',
  'invites.empty': 'Bekleyen davet yok.',
  'alert.validId': 'Geçerli bir ID girin.',
  'alert.alreadyFriend': 'Bu kişi zaten arkadaşın!',
  'alert.error': 'Hata',
  'alert.serverIdRequired': 'Lütfen bir Sunucu ID girin!'
});
Object.assign(I18N.en, {
  'app.subtitle': 'P2P • Serverless • Finds people automatically on the same Wi-Fi and can connect over the internet',
  'network.connected': 'Internet connection is active',
  'network.yourIp': 'Your IP',
  'network.discoveryHint': 'friends on the same network find you automatically',
  'invites.title': 'Incoming Friend Requests',
  'invites.lead': 'Friend requests you receive appear here.',
  'invites.empty': 'No pending invitations.',
  'alert.validId': 'Enter a valid ID.',
  'alert.alreadyFriend': 'This person is already your friend!',
  'alert.error': 'Error',
  'alert.serverIdRequired': 'Enter a Server ID!'
});

// Ayarlar → Kısayollar paneli ve merkezi bastırma kapısının metinleri.
Object.assign(I18N.tr, {
  'settings.shortcuts': 'Kısayollar',
  'settings.shortcutsLead': 'Klavye kısayollarını aç, kapat veya yeniden ata.',
  'settings.shortcutsMaster': 'Kısayolları Etkinleştir',
  'settings.shortcutsMasterDesc': 'Kapatıldığında uygulamanın tüm klavye kısayolları devre dışı kalır.',
  'settings.shortcutsListTitle': 'Kısayol listesi',
  'settings.shortcutsResetAll': 'Tümünü varsayılana döndür',
  'settings.shortcutRebind': 'Değiştirmek için tıkla',
  'settings.shortcutListening': 'Tuşa basın…',
  'settings.shortcutReset': 'Varsayılana döndür',
  'settings.shortcutConflict': 'Bu tuş başka bir kısayolda kullanılıyor',
  'settings.shortcutUpdated': 'Kısayol güncellendi.',
  'settings.shortcutUnassigned': 'Atanmadı',
  'settings.shortcutsSafetyTitle': 'Her zaman açık güvenlik kısayolları',
  'settings.shortcutsSafetyDesc': 'Bu kısayollar kapatılamaz ve hiçbir durumda bastırılmaz.',
  'settings.shortcutsKillSwitch': 'Ctrl+X ×2 — uzaktan denetimi anında kes',
  'settings.shortcutsEscape': 'Esc — denetimden ve odak modundan çık',
  'settings.shortcutsPaused': 'Kısayollar duraklatıldı',
  'settings.shortcutsPausedDesc': 'Denetim, etkinlik ve yazı yazarken kısayollar otomatik olarak duraklatılır.',
  'settings.shortcutsPttNote': 'Aç/kapat: Ses ve Görüntü sekmesi',
  'settings.shortcutsAllOn': 'Kısayollar açıldı.',
  'settings.shortcutsAllOff': 'Kısayollar kapatıldı.',
  'shortcut.mic': 'Mikrofonu aç/kapat',
  'shortcut.micDesc': 'Kendi mikrofonunu susturur veya açar.',
  'shortcut.deafen': 'Sağırlaştır',
  'shortcut.deafenDesc': 'Tüm sesleri kapatır ve mikrofonunu susturur.',
  'shortcut.camera': 'Kamera',
  'shortcut.cameraDesc': 'Kamerayı açar veya kapatır.',
  'shortcut.share': 'Ekran paylaşımı',
  'shortcut.shareDesc': 'Ekran paylaşımını başlatır veya durdurur.',
  'shortcut.record': 'Kayıt',
  'shortcut.recordDesc': 'Oturum kaydını başlatır veya durdurur.',
  'shortcut.fullscreen': 'Tam ekran',
  'shortcut.fullscreenDesc': 'Odaktaki kartı tam ekrana alır veya geri döndürür.',
  'shortcut.ptt': 'Bas-Konuş tuşu',
  'shortcut.pttDesc': 'Basılı tutulduğu sürece mikrofonu açar.'
});
Object.assign(I18N.en, {
  'settings.shortcuts': 'Shortcuts',
  'settings.shortcutsLead': 'Turn keyboard shortcuts on or off, or assign new keys.',
  'settings.shortcutsMaster': 'Enable shortcuts',
  'settings.shortcutsMasterDesc': 'When turned off, every keyboard shortcut in the app is disabled.',
  'settings.shortcutsListTitle': 'Shortcut list',
  'settings.shortcutsResetAll': 'Reset all to defaults',
  'settings.shortcutRebind': 'Click to change',
  'settings.shortcutListening': 'Press a key…',
  'settings.shortcutReset': 'Reset to default',
  'settings.shortcutConflict': 'That key is already used by another shortcut',
  'settings.shortcutUpdated': 'Shortcut updated.',
  'settings.shortcutUnassigned': 'Unassigned',
  'settings.shortcutsSafetyTitle': 'Always-on safety shortcuts',
  'settings.shortcutsSafetyDesc': 'These shortcuts can never be disabled or suppressed.',
  'settings.shortcutsKillSwitch': 'Ctrl+X ×2 — instantly cut remote control',
  'settings.shortcutsEscape': 'Esc — leave remote control and focus mode',
  'settings.shortcutsPaused': 'Shortcuts paused',
  'settings.shortcutsPausedDesc': 'Shortcuts pause automatically while controlling a screen, during activities and while typing.',
  'settings.shortcutsPttNote': 'On/off: Voice & Video tab',
  'settings.shortcutsAllOn': 'Shortcuts enabled.',
  'settings.shortcutsAllOff': 'Shortcuts disabled.',
  'shortcut.mic': 'Toggle microphone',
  'shortcut.micDesc': 'Mutes or unmutes your own microphone.',
  'shortcut.deafen': 'Deafen',
  'shortcut.deafenDesc': 'Mutes every incoming sound and your microphone.',
  'shortcut.camera': 'Camera',
  'shortcut.cameraDesc': 'Turns your camera on or off.',
  'shortcut.share': 'Screen share',
  'shortcut.shareDesc': 'Starts or stops screen sharing.',
  'shortcut.record': 'Recording',
  'shortcut.recordDesc': 'Starts or stops the session recording.',
  'shortcut.fullscreen': 'Full screen',
  'shortcut.fullscreenDesc': 'Sends the focused card to full screen and back.',
  'shortcut.ptt': 'Push-to-talk key',
  'shortcut.pttDesc': 'Opens your microphone while the key is held down.'
});

// Locales deliberately inherit English rather than Turkish.  That guarantees
// a complete readable interface while a translated locale is being expanded;
// an untranslated key can never silently fall back to Turkish.
const makeLocale = overrides => ({ ...I18N.en, ...overrides });
I18N.de = makeLocale({
  'common.settings': 'Einstellungen', 'common.settingsShort': 'Einstellungen', 'common.close': 'Schließen', 'common.save': 'Änderungen speichern', 'common.back': 'Zurück', 'common.cancel': 'Abbrechen', 'common.send': 'Senden', 'common.join': 'Beitreten', 'common.create': 'Erstellen',
  'menu.join': 'Server beitreten', 'menu.joinDesc': 'Einem bestehenden Raum beitreten', 'menu.create': 'Server erstellen', 'menu.createDesc': 'Eigenen Raum starten', 'menu.friends': 'Freunde', 'menu.addFriend': 'Freund hinzufügen', 'menu.sendFriendRequest': 'Freundschaftsanfrage senden', 'menu.serverId': 'Server-ID',
  'room.users': 'BENUTZER', 'room.voiceTest': 'SPRACHTEST', 'room.chat': 'CHAT', 'toolbar.voice': 'Sprache', 'toolbar.deafen': 'Stummschalten', 'toolbar.screen': 'Bildschirm', 'toolbar.activity': 'Aktivität', 'toolbar.record': 'Aufnehmen', 'toolbar.volume': 'Lautstärke',
  'settings.languageTime': 'Sprache & Zeit', 'settings.languageLead': 'Wähle die Sprache der Oberfläche und die Zeitanzeige.', 'settings.chooseLanguage': 'Sprache auswählen', 'settings.timeFormat': 'Zeitformat', 'settings.timeAuto': 'Automatisch', 'settings.preview': 'Vorschau',
  'settings.general': 'Allgemein', 'settings.voice': 'Sprache & Video', 'settings.broadcast': 'Übertragung', 'settings.connections': 'Verbindungen', 'settings.mediaLibrary': 'GIFs & Medien'
});
I18N.es = makeLocale({
  'common.settings': 'Ajustes', 'common.settingsShort': 'Ajustes', 'common.close': 'Cerrar', 'common.save': 'Guardar cambios', 'common.back': 'Volver', 'common.cancel': 'Cancelar', 'common.send': 'Enviar', 'common.join': 'Unirse', 'common.create': 'Crear',
  'menu.join': 'Unirse a un servidor', 'menu.joinDesc': 'Entrar a una sala existente', 'menu.create': 'Crear un servidor', 'menu.createDesc': 'Iniciar tu propia sala', 'menu.friends': 'Amigos', 'menu.addFriend': 'Añadir amigo', 'menu.sendFriendRequest': 'Enviar solicitud de amistad', 'menu.serverId': 'ID del servidor',
  'room.users': 'USUARIOS', 'room.voiceTest': 'PRUEBA DE VOZ', 'room.chat': 'CHAT', 'toolbar.voice': 'Voz', 'toolbar.deafen': 'Ensordecer', 'toolbar.screen': 'Pantalla', 'toolbar.activity': 'Actividad', 'toolbar.record': 'Grabar', 'toolbar.volume': 'Volumen',
  'settings.languageTime': 'Idioma y hora', 'settings.languageLead': 'Elige el idioma de la interfaz y el formato de hora.', 'settings.chooseLanguage': 'Elige un idioma', 'settings.timeFormat': 'Formato de hora', 'settings.timeAuto': 'Automático', 'settings.preview': 'Vista previa',
  'settings.general': 'General', 'settings.voice': 'Voz y vídeo', 'settings.broadcast': 'Transmisión', 'settings.connections': 'Conexiones', 'settings.mediaLibrary': 'GIF y medios'
});
I18N.fr = makeLocale({
  'common.settings': 'Paramètres', 'common.settingsShort': 'Paramètres', 'common.close': 'Fermer', 'common.save': 'Enregistrer les modifications', 'common.back': 'Retour', 'common.cancel': 'Annuler', 'common.send': 'Envoyer', 'common.join': 'Rejoindre', 'common.create': 'Créer',
  'menu.join': 'Rejoindre un serveur', 'menu.joinDesc': 'Entrer dans une salle existante', 'menu.create': 'Créer un serveur', 'menu.createDesc': 'Créer votre propre salle', 'menu.friends': 'Amis', 'menu.addFriend': 'Ajouter un ami', 'menu.sendFriendRequest': 'Envoyer une demande d’ami', 'menu.serverId': 'ID du serveur',
  'room.users': 'UTILISATEURS', 'room.voiceTest': 'TEST VOCAL', 'room.chat': 'CHAT', 'toolbar.voice': 'Voix', 'toolbar.deafen': 'Assourdir', 'toolbar.screen': 'Écran', 'toolbar.activity': 'Activité', 'toolbar.record': 'Enregistrer', 'toolbar.volume': 'Volume',
  'settings.languageTime': 'Langue et heure', 'settings.languageLead': 'Choisissez la langue de l’interface et le format de l’heure.', 'settings.chooseLanguage': 'Choisir une langue', 'settings.timeFormat': 'Format de l’heure', 'settings.timeAuto': 'Automatique', 'settings.preview': 'Aperçu',
  'settings.general': 'Général', 'settings.voice': 'Voix et vidéo', 'settings.broadcast': 'Diffusion', 'settings.connections': 'Connexions', 'settings.mediaLibrary': 'GIF et médias'
});
I18N.pt = makeLocale({
  'common.settings': 'Configurações', 'common.settingsShort': 'Configurações', 'common.close': 'Fechar', 'common.save': 'Salvar alterações', 'common.back': 'Voltar', 'common.cancel': 'Cancelar', 'common.send': 'Enviar', 'common.join': 'Entrar', 'common.create': 'Criar',
  'menu.join': 'Entrar em um servidor', 'menu.joinDesc': 'Entrar em uma sala existente', 'menu.create': 'Criar um servidor', 'menu.createDesc': 'Iniciar sua própria sala', 'menu.friends': 'Amigos', 'menu.addFriend': 'Adicionar amigo', 'menu.sendFriendRequest': 'Enviar pedido de amizade', 'menu.serverId': 'ID do servidor',
  'room.users': 'USUÁRIOS', 'room.voiceTest': 'TESTE DE VOZ', 'room.chat': 'CHAT', 'toolbar.voice': 'Voz', 'toolbar.deafen': 'Silenciar', 'toolbar.screen': 'Tela', 'toolbar.activity': 'Atividade', 'toolbar.record': 'Gravar', 'toolbar.volume': 'Volume',
  'settings.languageTime': 'Idioma e hora', 'settings.languageLead': 'Escolha o idioma da interface e o formato da hora.', 'settings.chooseLanguage': 'Escolha um idioma', 'settings.timeFormat': 'Formato da hora', 'settings.timeAuto': 'Automático', 'settings.preview': 'Prévia',
  'settings.general': 'Geral', 'settings.voice': 'Voz e vídeo', 'settings.broadcast': 'Transmissão', 'settings.connections': 'Conexões', 'settings.mediaLibrary': 'GIFs e mídia'
});
I18N.ru = makeLocale({
  'common.settings': 'Настройки', 'common.settingsShort': 'Настройки', 'common.close': 'Закрыть', 'common.save': 'Сохранить изменения', 'common.back': 'Назад', 'common.cancel': 'Отмена', 'common.send': 'Отправить', 'common.join': 'Войти', 'common.create': 'Создать',
  'menu.join': 'Войти на сервер', 'menu.joinDesc': 'Войти в существующую комнату', 'menu.create': 'Создать сервер', 'menu.createDesc': 'Создать свою комнату', 'menu.friends': 'Друзья', 'menu.addFriend': 'Добавить друга', 'menu.sendFriendRequest': 'Отправить запрос в друзья', 'menu.serverId': 'ID сервера',
  'room.users': 'ПОЛЬЗОВАТЕЛИ', 'room.voiceTest': 'ПРОВЕРКА ГОЛОСА', 'room.chat': 'ЧАТ', 'toolbar.voice': 'Голос', 'toolbar.deafen': 'Отключить звук', 'toolbar.screen': 'Экран', 'toolbar.activity': 'Активность', 'toolbar.record': 'Запись', 'toolbar.volume': 'Громкость',
  'settings.languageTime': 'Язык и время', 'settings.languageLead': 'Выберите язык интерфейса и формат времени.', 'settings.chooseLanguage': 'Выберите язык', 'settings.timeFormat': 'Формат времени', 'settings.timeAuto': 'Автоматически', 'settings.preview': 'Предпросмотр',
  'settings.general': 'Общие', 'settings.voice': 'Голос и видео', 'settings.broadcast': 'Трансляция', 'settings.connections': 'Подключения', 'settings.mediaLibrary': 'GIF и медиа'
});

const LEGACY_TEXT_EN = {
  'İptal': 'Cancel',
  'Kapat': 'Close',
  'Bağlan': 'Connect',
  'Kopyala': 'Copy',
  'Uygula': 'Apply',
  'Gönder': 'Send',
  'Reddet': 'Deny',
  'Kabul Et': 'Accept',
  'Durdur': 'Stop',
  'Kontrolü Bırak': 'Release Control',
  'Manuel Bağlantı': 'Manual Connection',
  "Arkadaşının IP adresi (veya SDP teklifi/cevabı)": "Your friend's IP address (or SDP offer/answer)",
  'Çapraz Ağ Bağlantısı': 'Cross-Network Connection',
  'Aynı ağda değilseniz SDP alışverişi yapın.': 'Exchange SDP details when you are not on the same network.',
  'Senin Teklifin (arkadaşına gönder):': 'Your Offer (send to your friend):',
  'Arkadaşının Cevabı:': "Your Friend's Answer:",
  'Uzaktan Kontrol İsteği': 'Remote Control Request',
  'Sunucu Katılma İsteği': 'Server Join Request',
  'sunucuna katılmak istiyor.': 'wants to join your server.',
  'Birisi bilgisayarınızı kontrol etmek istiyor.': 'Someone wants to control your computer.',
  'Bilgisayarınız kontrol ediliyor': 'Your computer is being controlled',
  'Acil kapatma: Ctrl+X ×2': 'Emergency stop: Ctrl+X ×2',
  'Uzak Masaüstü': 'Remote Desktop',
  'Siyah imleci hareket ettirin. Kontrolü almak için ekrana tıklayın; bırakmak için ESC.': 'Move the dark cursor. Click the screen to take control; press ESC to release it.',
  'İzleme modu — kontrol için tıklayın': 'View mode — click to control',
  'Paylaşan': 'Sharer',
  'Kurucu Ayarları': 'Owner Settings',
  'Sadece sunucuyu kuran kişi bu ayarları görebilir.': 'Only the person who created the server can view these settings.',
  'Sadece Arkadaşlar Katılabilir': 'Friends Only',
  'Yapay Zeka Koruması (+18/Küfür Engelleyici)': 'AI Protection (Adult Content / Profanity)',
  'Oyun Modu (Hafif Sürüm)': 'Game Mode (Lightweight)',
  'Ses Kalitesi (Bitrate)': 'Audio Quality (Bitrate)',
  'Oyuncu Yönetimi': 'Player Management',
  'Sunucuda kimse yok.': 'No one is in the server.',
  'Sistem Sesini de Paylaş': 'Share System Audio',
  'Ekran / Pencere Seç': 'Choose a Screen / Window',
  'Beyaz Tahta': 'Whiteboard',
  'Fırça': 'Brush',
  'Dikdörtgen': 'Rectangle',
  'Çember': 'Circle',
  'Yazı': 'Text',
  'Temizle': 'Clear',
  // Beyaz Tahta v2 araç rayı ve denetimleri (bkz. js/whiteboard.js). Başlıklar
  // kısayol harfini taşıdığı için tam dize olarak çevrilir; parça eşleşmesine
  // bırakılırsa "Fırça (P)" gibi başlıklar yarı Türkçe kalabiliyor.
  'Seç (V)': 'Select (V)',
  'Fırça (P)': 'Brush (P)',
  'Fosforlu (H)': 'Highlighter (H)',
  'Silgi (E)': 'Eraser (E)',
  'Çizgi (L)': 'Line (L)',
  'Ok (A)': 'Arrow (A)',
  'Dikdörtgen (R)': 'Rectangle (R)',
  'Çember (O)': 'Circle (O)',
  'Yazı (T)': 'Text (T)',
  'Kaydır (Boşluk)': 'Pan (Space)',
  'Renk ve Kalınlık': 'Color and Thickness',
  'Renk': 'Color',
  'Kalınlık': 'Thickness',
  'Özel renk': 'Custom color',
  'Geri Al': 'Undo',
  'Yinele': 'Redo',
  'Izgara': 'Grid',
  'Zemin': 'Background',
  'PNG İndir': 'Download PNG',
  'Uzaklaştır': 'Zoom Out',
  'Yakınlaştır': 'Zoom In',
  'Sığdır': 'Fit',
  'Gerçek Boyut': 'Actual Size',
  'Tahta temizlendi — Ctrl+Z ile geri alabilirsin': 'Board cleared — press Ctrl+Z to undo',
  'Döndür': 'Rotate',
  'Seçimi döndürmek için sürükle': 'Drag to rotate the selection',
  'Fotoğraf Ekle': 'Add Photo',
  'Fotoğraf çok büyük': 'Photo is too large',
  'Fotoğraf yüklenemedi': 'Photo could not be loaded',
  // İndirme bildirimi (main.js will-download → renderer toast)
  'İndirildi': 'Downloaded',
  'Klasörde göster': 'Show in folder',
  'İndirme tamamlanamadı': 'Download could not be completed',
  'Etkinlikler': 'Activities',
  'Hızlı Anket': 'Quick Poll',
  'Şans Çarkı': 'Lucky Wheel',
  'Kelime Tahmin': 'Word Guess',
  'Henüz mesaj yok.': 'No messages yet.',
  'Arkadaş Seçin': 'Select a Friend',
  'Dosya Gönder': 'Send File',
  'Adı Değiştir': 'Change Name',
  "ID'yi Kopyala": 'Copy ID',
  'Davetler': 'Invites',
  'Arkadaş Ekle': 'Add Friend',
  'Güncelleme Günlüğü': 'Update Log',
  'İnternet Sunucusu Gecikmesi': 'Internet Server Latency',
  'Odak Kilidi (yanlışlıkla çıkmayı engeller)': 'Focus Lock (prevents accidental exit)',
  'Tam Ekran (F)': 'Fullscreen (F)',
  'Küçült': 'Minimize'
};
Object.assign(LEGACY_TEXT_EN, {
  'P2P • Sunucusuz • Aynı Wi-Fi’da otomatik bulur, internetten bağlanılabilir': 'P2P • Serverless • Finds people automatically on the same Wi-Fi and can connect over the internet',
  "P2P • Sunucusuz • Aynı Wi-Fi'da otomatik bulur, internetten bağlanılabilir": 'P2P • Serverless • Finds people automatically on the same Wi-Fi and can connect over the internet',
  'İnternet üzerinden bağlantı aktif': 'Internet connection is active',
  'Senin IP:': 'Your IP:',
  '(aynı ağdaki arkadaşın otomatik bulur)': '(friends on the same network find you automatically)',
  'Sana gelen arkadaşlık istekleri burada görünür.': 'Friend requests you receive appear here.',
  'Bekleyen davet yok.': 'No pending invitations.',
  'Gelen Arkadaşlık Davetleri': 'Incoming Friend Requests',
  'Mesajlar': 'Messages',
  'Mesajlaşmaya başlamak için bir arkadaş seç.': 'Select a friend to start messaging.',
  'Şu an çevrimiçi arkadaşın yok.': 'You do not have any friends online right now.',
  'Sadece çevrimiçi arkadaşların mesajlaşabilir.': 'Only online friends can be messaged.',
  'Arkadaşlar / Davet Et': 'Friends / Invite',
  'Sunucu ID:': 'SERVER ID:',
  'Çıkış': 'Output',
  '0 (Hep Açık)': '0 (Always Open)',
  'Ses Eşiği': 'Voice Threshold',
  'Yankı Kalkanı': 'Echo Shield',
  '(hoparlörden dinliyorsan)': '(when listening through speakers)',
  'Tüm ekran': 'Entire screen',
  'Ortak Tarayıcı': 'Shared Browser',
  'Birlikte web’de gezin': 'Browse the web together',
  "Birlikte web'de gezin": 'Browse the web together',
  'Video Oynatıcı': 'Video Player',
  'Senkron izleme odası': 'Synchronized watch room',
  'Hızlı Anket': 'Quick Poll',
  'Birlikte karar verin': 'Make a decision together',
  'Şans Çarkı': 'Lucky Wheel',
  'Rastgele kazanan seçin': 'Pick a random winner',
  'Vampir Köylü': 'Vampire Villager',
  'Gece hayatta kal, gündüz oylayın': 'Survive the night, vote by day',
  'Klasik kart oyunu': 'Classic card game',
  'Element arenası': 'Element arena',
  'PokeSavaş': 'PokeBattle',
  '⚔️ PokeSavaş ⚔️': '⚔️ PokeBattle ⚔️',
  'SAVAŞLARI': 'BATTLES',
  'Geri': 'Back',
  'Lobilere Göz At': 'Browse Lobbies',
  'Katılmak için bir lobi seçin veya yeni bir tane oluşturun.': 'Choose a lobby to join or create a new one.',
  'Aktif Lobi: 0 • Toplam Oyuncu: 0': 'Active Lobbies: 0 • Total Players: 0',
  'Yeni Lobi Oluştur': 'Create New Lobby',
  'Henüz aktif lobi yok. İlk lobiyi siz oluşturun!': 'There are no active lobbies yet. Create the first one!',
  'Oyuncu': 'Player',
  'Oyuncu:': 'Player:',
  'Toplam Oyuncu': 'Total Players',
  'Lobi:': 'Lobby:',
  'Lobi': 'Lobby',
  'Lobiler': 'Lobbies',
  'Lobileri': 'Lobbies',
  'Lobi kuralları': 'Lobby rules',
  'Yeni Lobi Kur': 'Create New Lobby',
  'Lobi hazırlanıyor…': 'Preparing lobby…',
  'Oyuncular bekleniyor': 'Waiting for players',
  'Lobi sohbeti hazır. İlk mesajı sen yaz.': 'Lobby chat is ready. Write the first message.',
  'Lobi mesajı': 'Lobby message',
  'Lobine mesaj yaz…': 'Write a message to your lobby…',
  'Oyunu Başlat': 'Start Game',
  'Başlat': 'Start',
  'Odadan Çık': 'Leave Room',
  'Kurallar': 'Rules',
  'UNO — Bekleme Salonu': 'UNO — Waiting Room',
  'Kaç kişilik?': 'How many players?',
  '+ Bot Ekle': '+ Add Bot',
  'Başlatınca boşlukları botla doldur': 'Fill empty seats with bots when starting',
  'En az 2 oyuncu gerekli. Arkadaşlarının katılmasını bekle…': 'At least 2 players are required. Waiting for friends to join…',
  'HIZLI ANKET': 'QUICK POLL',
  'TEAMSYNC KARAR ALANI': 'TEAMSYNC DECISION SPACE',
  'CANLI ÖNİZLEME': 'LIVE PREVIEW',
  'HAZIRLANIYOR': 'PREPARING',
  'Oylar oda içinde canlı ve eş zamanlı güncellenir.': 'Votes update live and simultaneously in the room.',
  'Oylama tamamlandı': 'Voting is complete',
  'Sonuçlar artık değiştirilemez.': 'Results can no longer be changed.',
  'CANLI SONUÇLAR': 'LIVE RESULTS',
  'ŞU AN ÖNDE': 'CURRENTLY LEADING',
  'Oylamayı bitir': 'End poll',
  'Yeni anket': 'New poll',
  '01 · SORUNU HAZIRLA': '01 · PREPARE THE QUESTION',
  'Soruyu yaz, seçenekleri belirle ve odadaki herkesin fikrini saniyeler içinde gör.': 'Write the question, set the options, and see everyone’s opinion in seconds.',
  'Hazır anketler': 'Ready-made polls',
  'Akşam planı': 'Evening plans',
  'Buluşma zamanı': 'Meeting time',
  'Hızlı karar': 'Quick decision',
  'Anket sorusu': 'Poll question',
  'Örn. Bu akşam ne oynayalım?': 'For example, what should we play tonight?',
  'Seçenekler': 'Options',
  'Seçenek ekle': 'Add option',
  'Oy değiştirilebilir': 'Votes can be changed',
  'Katılımcılar kararını güncelleyebilir.': 'Participants can update their decision.',
  'Anketi başlat': 'Start poll',
  'Canlı önizleme': 'Live preview',
  'Sorunu yazmaya başla': 'Start writing your question',
  'Sence en iyi seçenek hangisi?': 'Which option do you think is best?',
  'İlk seçenek': 'First option',
  'İkinci seçenek': 'Second option',
  'Anket sorusunu yazmalısın.': 'Enter a poll question.',
  'En az iki dolu seçenek gerekli.': 'At least two options are required.',
  'Seçeneklerin birbirinden farklı olmalı.': 'Options must be different from one another.',
  'Henüz oy yok': 'No votes yet',
  'oy': 'vote',
  ' oy': ' votes',
  'katılımcı': 'participant',
  'OYLAMA BİTTİ': 'VOTING ENDED',
  'OYLAMA AÇIK': 'VOTING OPEN',
  'Kesin sonuçlar': 'Final results',
  'Bir seçeneğe dokunarak oy ver': 'Choose an option to vote',
  'Oyunu değiştirebilirsin': 'You can change your vote',
  'Oyun kaydedildi': 'Vote recorded',
  'Bu anketin kesin sonuçları gösteriliyor.': 'The final results of this poll are shown.',
  'Oyunu sonuçlanana kadar değiştirebilirsin.': 'You can change your vote until the poll ends.',
  'Her katılımcının tek oy hakkı var.': 'Each participant has one vote.',
  'Sonuç bekleniyor': 'Waiting for results',
  'İlk sonuç burada görünecek.': 'The first result will appear here.',
  'TEAMSYNC OYUNU': 'TEAMSYNC GAME',
  '01 · ÇARKI HAZIRLA': '01 · PREPARE THE WHEEL',
  'Kararı çarka bırak. En az 2, en fazla 15 seçenek kullanabilirsin.': 'Leave the decision to the wheel. You can use at least 2 and at most 15 options.',
  'Takımlar': 'Teams',
  'Başlamak için en az 2 seçenek ekle.': 'Add at least 2 options to begin.',
  'Odadaki herkes aynı dönüşü ve aynı sonucu görür.': 'Everyone in the room sees the same spin and result.',
  '02 · ŞANSINI DENE': '02 · TRY YOUR LUCK',
  'Hazır olduğunda çevir': 'Spin when you are ready',
  'Çark hazır': 'Wheel ready',
  'ÇARKI ÇEVİR': 'SPIN THE WHEEL',
  'SEÇENEKLER': 'OPTIONS',
  'SONUÇ GEÇMİŞİ': 'RESULT HISTORY',
  'Seçenekleri düzenle': 'Edit options',
  'ÇARKIN SEÇİMİ': 'THE WHEEL’S PICK',
  'Şans bugün bu seçenekten yana.': 'Luck favors this option today.',
  'Sonucu kapat': 'Close result',
  'Tekrar çevir': 'Spin again',
  'Çarkın henüz boş': 'The wheel is still empty',
  'Yukarıdan bir seçenek ekle veya hazır bir liste seç.': 'Add an option above or choose a ready-made list.',
  'Seçeneklerini ekle': 'Add your options',
  'Yeni seçenek': 'New option',
  'Ekle': 'Add',
  'Çarkı hazırla': 'Prepare wheel',
  'Çarkı döndür': 'Spin the wheel',
  'Kazanan': 'Winner',
  'Seçenek bekleniyor': 'Waiting for options',
  'Pokemonunu Seç': 'Choose Your Pokémon',
  'Savaşmak istediğin türü ve ana Pokemonunu belirle.': 'Choose the type and main Pokémon you want to battle with.',
  'Savaştan Çekil': 'Withdraw from Battle',
  'Arena Bekleme Salonu': 'Arena Waiting Room',
  'Buraya Katıl': 'Join this slot',
  'Bot Ekle': 'Add Bot',
  'Rastgele Yetenekler (AÇIK)': 'Random Abilities (ON)',
  'Savaşı Başlat': 'Start Battle',
  'Savaşı Baslat': 'Start Battle',
  'POKE SAVAŞLARI': 'POKÉ BATTLES',
  'SEÇ • GELİŞTİR • SAVAŞ': 'CHOOSE • EVOLVE • BATTLE',
  'OYUNCU 1...': 'PLAYER 1...',
  'OYUNCU 2...': 'PLAYER 2...',
  'TÜR': 'TYPE',
  'CAN': 'HP',
  'SALDIRI': 'ATTACK',
  'SAVUNMA': 'DEFENSE',
  'HIZ': 'SPEED',
  'ÖZEL GÜÇ': 'SPECIAL POWER',
  'Savaş başlıyor...': 'The battle is starting...',
  'TÜR REHBERİ': 'TYPE GUIDE',
  'Saldırı Seç': 'Choose an attack',
  'Saldırı 1': 'Attack 1',
  'Saldırı 2': 'Attack 2',
  'Saldırı 3': 'Attack 3',
  'Saldırı 4': 'Attack 4',
  'Savaşı Bitirmek İstiyorum (Pes Et)': 'I Want to End the Battle (Surrender)',
  'Rakip pes etmek istiyor:': 'Your opponent wants to surrender:',
  'Affet': 'Accept surrender',
  'TEKRAR OYNA': 'PLAY AGAIN',
  'Sıradaki tur bekleniyor...': 'Waiting for the next round...',
  'Rakip Seçimini Yapıyor...': 'Opponent is choosing...',
  'Geri Dön': 'Go back',
  'Hangi Formla Savaşacaksın?': 'Which form will you battle with?',
  'Seçtiğin formun gerçek türleri, özellikleri ve öğrenebildiği saldırılar savaşa uygulanır.': 'The selected form’s real types, abilities, and learnable attacks are used in battle.',
  'Rakip Evrimini Seçiyor...': 'Opponent is choosing an evolution...',
  'Saldırılarını Seç': 'Choose your attacks',
  'Pokemonun için en fazla 4 gerçek saldırı seç. (0/4)': 'Choose up to 4 real attacks for your Pokémon. (0/4)',
  'Pokemonun için en fazla 4 gerçek saldırı seç. (': 'Choose up to 4 real attacks for your Pokémon. (',
  'Onayla': 'Confirm',
  'Rakip Bekleniyor...': 'Waiting for opponent...',
  'Pokémon Tür Kılavuzu': 'Pokémon Type Guide',
  'Pokemonun için en fazla 4 gerçek saldırı seç. (0/4)': 'Choose up to 4 real attacks for your Pokémon. (0/4)',
  'Güç:': 'Power:',
  'Hız:': 'Speed:',
  'Oyuncu 1 Bekleniyor...': 'Waiting for Player 1...',
  'Oyuncu 2 Bekleniyor...': 'Waiting for Player 2...',
  'Savaş alanı kuruluyor...': 'Preparing the battlefield...',
  'Senin sıran! Bir saldırı seç!': 'Your turn! Choose an attack!',
  'Saldırılar gerçekleşiyor...': 'Attacks are being resolved...',
  'Güç:': 'Power:',
  'Hız:': 'Speed:',
  'Öncelik:': 'Priority:',
  'Durum': 'Status',
  'ETKİSİZ': 'NO EFFECT',
  'AŞIRI ETKİLİ': 'EXTREMELY EFFECTIVE',
  'SÜPER ETKİLİ': 'SUPER EFFECTIVE',
  'ÇOK AZ ETKİLİ': 'BARELY EFFECTIVE',
  'ETKİSİ AZ': 'NOT VERY EFFECTIVE',
  'NORMAL ETKİ': 'NORMAL EFFECT',
  'Geçerli bir ID girin.': 'Enter a valid ID.',
  'Bu kişi zaten arkadaşın!': 'This person is already your friend!',
  'Lütfen bir Sunucu ID girin!': 'Enter a Server ID!',
  'TeamSync\'ten ayrılmak istermisiniz?': 'Do you want to leave TeamSync?',
  'Emin misiniz?': 'Are you sure?',
  'metered.ca\'dan ücretsiz hesap açıp buraya TURN bilgilerinizi girin. Kolay yol: Metered panelindeki "credentials API" adresini (https://...metered.live/api/v1/turn/credentials?apiKey=...) URL alanına yapıştırın, kullanıcı adı/şifre boş kalabilir. Odada TEK kişinin girmesi yeterli — diğerlerine otomatik paylaşılır.': 'Create a free account at metered.ca and enter your TURN details here. The easiest way is to paste the credentials API URL from the Metered panel (https://...metered.live/api/v1/turn/credentials?apiKey=...) into the URL field; username and password may be left blank. Only one person in the room needs to enter it — it is shared automatically with everyone else.'
});
// Labels rendered after the initial page load by activities and owner controls.
// Keep these in the same source dictionary so every locale catalog is audited
// against them and dynamic cards cannot silently remain in Turkish.
Object.assign(LEGACY_TEXT_EN, {
  'Botu Kaldır': 'Remove Bot',
  'Savaş formatı': 'Battle format',
  'Kurucu seçer': 'Chosen by the host',
  'Rastgele Pokémon (AÇIK)': 'Random Pokémon (ON)',
  'Manuel Takım Seçimi (KAPALI)': 'Manual Team Selection (OFF)',
  'OYUNCU 1': 'PLAYER 1',
  'OYUNCU 2': 'PLAYER 2',
  'Pokémon Değiştir': 'Switch Pokémon',
  'Bir Pokémon seç — bu tur saldırı yerine değiştirirsin': 'Choose a Pokémon — you will switch instead of attacking this turn',
  'Takımı Confirm': 'Confirm Team',
  'Takımı Onayla': 'Confirm Team',
  'Seçtiğin saldırılar': 'Selected attacks',
  'Henüz seçilmedi': 'Not selected yet',
  'SUNUCU ID:': 'SERVER ID:',
  '32 kbps (Düşük)': '32 kbps (Low)',
  '64 kbps': '64 kbps',
  '96 kbps': '96 kbps',
  '128 kbps (Önerilen)': '128 kbps (Recommended)',
  '192 kbps': '192 kbps',
  '256 kbps (Yüksek)': '256 kbps (High)',
  'Arkadaşlarını Davet Et': 'Invite Your Friends',
  'Çevrimiçi arkadaşlarını bu sunucuya davet et.': 'Invite your online friends to this server.',
  'Yeni': 'New',
  'UNO Lobileri': 'UNO Lobbies',
  '(sen)': '(you)',
  'koltuk dolu': 'seats filled',
  'Herkes hazır olduğunda "Başlat"a bas.': 'Press "Start" when everyone is ready.',
  'Kurucunun oyunu başlatması bekleniyor…': 'Waiting for the host to start the game…',
  'Sıra sende!': 'Your turn!',
  'Sıra sende! +': 'Your turn! +',
  'Sıra:': 'Turn:',
  'Çektiğin kart oynanabilir — at ya da beklet!': 'The card you drew can be played — play it or keep it!',
  'Renk seç': 'Choose a color',
  'Kırmızı': 'Red',
  'Sarı': 'Yellow',
  'Yeşil': 'Green',
  'Mavi': 'Blue',
  'Kart çek': 'Draw card',
  'Çektiğin kart oynanabilir!': 'The card you drew can be played!',
  'Oyna': 'Play',
  'Beklet': 'Keep',
  'Tekrar Oyna': 'Play Again',
  'Oyun Kuralları': 'Game Rules',
  'Kombo (Yığma)': 'Stacking',
  '+2/+4 yediğinde çekmek yerine elindeki +2 veya +4\'ü üstüne atabilirsin; ceza katlanarak sıradakine geçer. İstersen desteye tıklayıp cezayı normal çekersin.': 'When you receive a +2 or +4, you may play a +2 or +4 instead of drawing; the penalty stacks for the next player. You can still click the deck to draw the penalty normally.',
  'Bloklama': 'Blocking',
  '+2/+4 yiyeceğin sırada elinde Engel (⊘) varsa onu atıp cezayı bloklarsın; kart çekmezsin ve sıra düzgünce bir sonrakine geçer — Engel, cezayı savmak için kullanılmış olur.': 'If you hold a Block (⊘) when receiving a +2 or +4, play it to block the penalty. You do not draw and play continues to the next player.',
  'Başlangıç Kartı': 'Starting Cards',
  'Her oyuncunun oyuna kaç kartla başlayacağını belirler.': 'Sets how many cards each player starts with.',
  'Açık': 'On',
  'Kapalı': 'Off',
  'kart': 'cards',
  'Kurucu olarak kuralları buradan değiştirebilirsin.': 'As host, you can change the rules here.',
  'Kurallar oyun sırasında değiştirilemez.': 'Rules cannot be changed during a game.',
  'Kuralları yalnızca kurucu değiştirebilir.': 'Only the host can change the rules.',
  'Yetkilendir': 'Authorize',
  'Yetkilendirme': 'Authorization',
  'Ekranı Büyült': 'Enlarge Screen',
  'Yenile': 'Refresh',
  'Git': 'Go',
  'Odada başka kimse yok': 'There is nobody else in the room.',
  'Yetki Ver': 'Grant Access',
  'Yetkili': 'Authorized',
  'Geçerli bir YouTube linki girin': 'Enter a valid YouTube link.',
  'Mysal için Bu gece name oynayalım?': 'For example, what should we play tonight?',
  '1. zorunlu seçenek': '1st required option',
  '2. zorunlu seçenek': '2nd required option',
  '3. seçenek (isteğe bağlı)': '3rd option (optional)',
  '4. seçenek (isteğe bağlı)': '4th option (optional)',
  'Örn. Film izleyelim': 'For example, watch a movie',
  'Film izleyelim': 'Watch a movie',
  'Oyun oynayalım': 'Play a game',
  'Sohbet edelim': 'Chat',
  'Müzik dinleyelim': 'Listen to music',
  'Lobi hazıralanıyor…': 'Preparing lobby…',
  'Lobi hazırlanıyor…': 'Preparing lobby…',
  'VAMPİR KÖYLÜ': 'VAMPIRE VILLAGER',
  'SOSYAL ÇIKARIM OYUNU': 'SOCIAL DEDUCTION GAME',
  'Lobi kurucususun. Rolleri ve vampir sayısını aşağıdan ayarla.': 'You are the lobby host. Set the roles and vampire count below.',
  'Lobi kurucusunun kuralları ayarlamasını bekliyorsun.': 'Waiting for the lobby host to configure the rules.',
  'Gizli rolün:': 'Your secret role:',
  'İzleyici modundasın; gizli rolün yok.': 'You are spectating; you have no secret role.',
  'Lobi kuralları': 'Lobby rules',
  'Önce oyun tarzını seç, ardından özel rolleri istediğin gibi düzenle.': 'Choose a game style first, then tailor the special roles as you like.',
  'Hazır kural paketi': 'Rule preset',
  'Klasik': 'Classic',
  'Dengeli': 'Balanced',
  'Kaos': 'Chaos',
  'Yeni Lobi Kur': 'Create New Lobby',
  'Bu aşamada bekleyin.': 'Please wait during this phase.',
  'NORMAL': 'NORMAL', 'ATEŞ': 'FIRE', 'SU': 'WATER', 'ELEKTRİK': 'ELECTRIC', 'ÇİMEN': 'GRASS', 'BUZ': 'ICE',
  'DÖVÜŞ': 'FIGHTING', 'ZEHİR': 'POISON', 'TOPRAK': 'GROUND', 'UÇAN': 'FLYING', 'PSİŞİK': 'PSYCHIC', 'BÖCEK': 'BUG',
  'KAYA': 'ROCK', 'HAYALET': 'GHOST', 'EJDERHA': 'DRAGON', 'KARANLIK': 'DARK', 'ÇELİK': 'STEEL', 'PERİ': 'FAIRY',
  'OYUNCU 1...': 'PLAYER 1...', 'OYUNCU 2...': 'PLAYER 2...', 'HAZIRLANIYOR...': 'PREPARING...',
  'Tür çarpanları çift türlerde birleşir: Örneğin Ateş saldırısı Çimen/Böcek rakibe 4×, Su/Ejderha rakibe 0.25× etki eder.': 'Type multipliers combine for dual types: for example, a Fire attack deals 4× damage to a Grass/Bug opponent and 0.25× damage to a Water/Dragon opponent.',
  'Hasar Verir (2x)': 'Deals Damage (2x)',
  'Zayıf Vurur (0.5x)': 'Deals Reduced Damage (0.5x)',
  'Etki Etmez (0x)': 'No Effect (0x)',
  'Kişiye': 'None',
  'Tüm katılımcıların mikrofonunda RNNoise\'u açar veya kapatır. Değişiklik bağlantıyı kesmeden anında uygulanır.': 'Turns RNNoise on or off for every participant\'s microphone. The change applies instantly without disconnecting.',
  'Tüm katılımcıların ses bit hızını belirler. Yüksek değer daha net ses, daha fazla internet kullanımı demektir. Değişiklik anında herkese uygulanır.': 'Sets the audio bitrate for all participants. Higher values provide clearer audio but use more bandwidth. The change applies to everyone instantly.',
  'Aktif olduğunda, yalnızca şu an sunucuda bulunan herhangi bir kişinin arkadaş listesinde olanlar katılabilir. Yabancıların bağlantısı anında reddedilir.': 'When enabled, only people who are friends with someone currently in this server can join. Unknown connections are rejected immediately.',
  'Tüm katılımcıların sohbet mesajları ve profil fotoğrafları AI ile denetlenir.': 'All participants’ chat messages and profile photos are checked by AI.',
  'RAM/CPU kullanımını minimize eder (Ekran paylaşımlarını 15 FPS’e kilitler ve AI taramasını yavaşlatır).': 'Minimizes RAM/CPU usage (locks screen sharing to 15 FPS and slows AI scanning).',
  'Lobi: 0 • Oyuncu: 0': 'Lobby: 0 • Players: 0',
  'Lobi:': 'Lobby:',
  'Oyuncu:': 'Player:', 'Oyuncu': 'Player', 'oyuncu': 'player',
  'En az 2 oyuncu gerekli. Arkadaşların katılmasını bekle…': 'At least 2 players are required. Waiting for friends to join…',
  'ceza iptal': 'penalty blocked',
  'Odak kilidi açıldı': 'Focus lock unlocked',
  'Odak kilitlendi — tıklamalar odağı değiştirmez': 'Focus locked — clicks will not change focus',
  'Sıra sende değil.': 'It is not your turn.',
  'Kazandın!': 'You won!',
  'RAM/CPU kullanımını minimize eder (Ekran paylaşımlarını 15 FPS\'e kilitler ve AI taramasını yavaşlatır).': 'Minimizes RAM/CPU usage (locks screen sharing to 15 FPS and slows AI scanning).',
  'POPÜLER': 'POPULAR', 'KLASİK': 'CLASSIC', 'YENİ': 'NEW', 'SENKRON': 'SYNCED', 'ARENA': 'ARENA', 'PARTİ': 'PARTY', 'SOSYAL': 'SOCIAL',
  'YouTube Linki': 'YouTube URL',
  'Aç': 'Open',
  'Başlamak için 2 seçenek daha ekle.': 'Add 2 more options to begin.',
  'Başlamak için 1 seçenek daha ekle.': 'Add 1 more option to begin.',
  'Çark dönüyor': 'Wheel is spinning',
  'Sonuç:': 'Result:',
  'Odadan Ayrıl': 'Leave Room',
  'Takımı Bırakmam!': 'Keep My Team!',
  'Evet, Ayrıl': 'Yes, Leave',
  'Dosya Seç': 'Choose File',
  'Dosya seçilmedi': 'No file selected',
  'Seçili Videoyu Aç': 'Open Selected Video',
  '(Sadece play/pause/süre senkronize olur)': '(Only play/pause/time is synchronized)',
  'Lütfen bilgisayarınızdan aynı filmi seçin.': 'Please choose the same video file from your computer.',
  'Mor Gece': 'Purple Night', 'Kızıl Ateş': 'Crimson Fire', 'Orman Yeşili': 'Forest Green', 'Gün Batımı': 'Sunset', 'Okyanus Mavisi': 'Ocean Blue', 'Pembe Rüya': 'Pink Dream', 'Altın Çöl': 'Golden Desert', 'Buz Beyazı': 'Ice White', 'Mor & Beyaz': 'Purple & White'
});

const LEGACY_TEXT_TR = Object.fromEntries(Object.entries(LEGACY_TEXT_EN).map(([tr, en]) => [en, tr]));
// A locale must provide its own complete legacy dictionary before it can be
// exposed in settings.  Keeping the dictionaries explicit makes a fallback
// visible during review instead of silently turning a UI into another language.
const LEGACY_TEXT_BY_LOCALE = {
  tr: { ...Object.fromEntries(Object.keys(LEGACY_TEXT_EN).map(key => [key, key])), ...LEGACY_TEXT_TR },
  en: LEGACY_TEXT_EN
};

// Complete build-time catalogs are loaded before this renderer. They are kept
// separate from the application code so native reviewers can work in JSON and
// every supported language has an explicit structured + legacy dictionary.
Object.entries(window.TeamSyncLocaleCatalogs || {}).forEach(([locale, catalog]) => {
  if (!SUPPORTED_LANGUAGES.includes(locale)) return;
  I18N[locale] = { ...I18N.en, ...catalog.structured };
  LEGACY_TEXT_BY_LOCALE[locale] = catalog.legacy;
});

function translateLegacyValue(value, dictionary) {
  if (dictionary[value]) return dictionary[value];
  // Activity UIs commonly decorate labels with icons, counters or a user's
  // name (for example "🌐 Senin IP: 192…" and "1 / 4 koltuk dolu").  Exact
  // matching leaves those rows in Turkish after switching languages.  Replace
  // one substantial known fragment only, while chat/user content remains excluded
  // by translateLegacyStaticUI.
  let embeddedValue = value;
  let embeddedChanged = false;
  const candidates = Object.entries(dictionary)
    .filter(([source, target]) => source.length > 1 && source !== target)
    .sort(([a], [b]) => b.length - a.length);
  const hasDynamicNumericContext = /\d/.test(embeddedValue);
  for (const [source, target] of candidates) {
      if (!embeddedValue.includes(source)) continue;
      // A short label embedded in a whole sentence is usually dynamic game or
      // user content. Translating just that label produced mixed strings such
      // as "Your secret role: Büyücü". Keep the original coherent instead.
      if (source.length / Math.max(embeddedValue.length, 1) < 0.45 && !hasDynamicNumericContext) continue;
      // Do not turn a short standalone word such as "oy" (vote) into the
      // middle of a longer Turkish word such as "oyuncu" (player).
      if (/^[\p{L}\p{N}]+$/u.test(source)) {
        const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wholeWord = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
        if (!wholeWord.test(embeddedValue)) continue;
        embeddedValue = embeddedValue.replace(wholeWord, target);
      } else {
        embeddedValue = embeddedValue.split(source).join(target);
      }
      embeddedChanged = true;
  }
  return embeddedChanged ? embeddedValue : null;
}

function translateLegacyStaticUI(language, root = document.body) {
  if (!root) return;
  // Dynamic cards are authored in Turkish.  Any non-Turkish locale first
  // receives the complete English safety net so a language switch cannot
  // produce a mixed Turkish interface.
  const dictionary = LEGACY_TEXT_BY_LOCALE[language] || LEGACY_TEXT_EN;
  const excludedSelector = '[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-ignore], script, style, #chat, #dm-messages, #server-dm-messages, #friends-list, #users, #img-lightbox, .chat-msg, .dm-message, .uname-text, .vtitle, .vv-bot-memory';
  const visitText = node => {
    const parent = node.parentElement;
    if (!parent || parent.closest(excludedSelector)) return;
    const trimmed = node.nodeValue.trim();
    if (!state.legacyI18nText) state.legacyI18nText = new WeakMap();
    const sourceText = state.legacyI18nText.get(node) || trimmed;
    state.legacyI18nText.set(node, sourceText);
    const translated = translateLegacyValue(sourceText, dictionary);
    if (!translated) return;
    node.nodeValue = node.nodeValue.replace(trimmed, translated);
  };
  if (root.nodeType === Node.TEXT_NODE) {
    visitText(root);
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) visitText(node);
  }
  const elements = root.nodeType === Node.ELEMENT_NODE
    ? [root, ...root.querySelectorAll('[title], [placeholder]')]
    : [];
  elements.forEach(element => {
    if (element.closest(excludedSelector)) return;
    ['title', 'placeholder'].forEach(attribute => {
      const value = element.getAttribute(attribute);
      const translated = value && dictionary[value];
      // setAttribute emits an attribute mutation even when the value is unchanged.
      // The observer below processes title/placeholder mutations, so writing the
      // same Turkish value here used to schedule itself indefinitely on a locale
      // switch and freeze the renderer.
      if (translated && translated !== value) element.setAttribute(attribute, translated);
    });
  });
}

const APP_THEMES = new Set(['aurora', 'black', 'navy', 'white', 'violet', 'custom']);
const CUSTOM_BG_KEY = 'teamsync_custom_bg';
const CUSTOM_ACCENT_KEY = 'teamsync_custom_accent';
const CUSTOM_BUTTON_KEY = 'teamsync_custom_button';
const CUSTOM_THEME_DEFAULTS = { bg: '#1a1130', accent: '#a855f7', button: '#8b5cf6' };
// Kendi tema paletini oluştururken hazır seçim sunmak için: her preset bir
// arka plan + o arka planla kontrast oluşturan bir vurgu rengi + buton rengi
// üçlüsü. Presetlerde vurgu ve buton rengi aynı tonda başlar; kullanıcı
// istediğinde butonu vurgudan bağımsız olarak ayrıca değiştirebilir.
const CUSTOM_THEME_PRESETS = [
  { name: 'Mor Gece', bg: '#1b1130', accent: '#a855f7', button: '#a855f7' },
  { name: 'Kızıl Ateş', bg: '#2b1012', accent: '#f43f5e', button: '#f43f5e' },
  { name: 'Orman Yeşili', bg: '#0e1f18', accent: '#34d399', button: '#34d399' },
  { name: 'Gün Batımı', bg: '#2b1608', accent: '#fb923c', button: '#fb923c' },
  { name: 'Okyanus Mavisi', bg: '#071f2c', accent: '#22d3ee', button: '#22d3ee' },
  { name: 'Pembe Rüya', bg: '#260f21', accent: '#f472b6', button: '#f472b6' },
  { name: 'Altın Çöl', bg: '#241c08', accent: '#fbbf24', button: '#fbbf24' },
  { name: 'Buz Beyazı', bg: '#eef2f7', accent: '#2563eb', button: '#2563eb' },
  { name: 'Mor & Beyaz', bg: '#f6f4fc', accent: '#8b5cf6', button: '#8b5cf6' }
];

function getUserTheme() {
  const saved = localStorage.getItem(USER_THEME_KEY);
  return APP_THEMES.has(saved) ? saved : 'aurora';
}

function getSimpleUiEnabled() {
  return localStorage.getItem(USER_SIMPLE_UI_KEY) !== '0';
}

function applySimpleUi(enabled, persist = false) {
  const active = enabled !== false;
  document.documentElement.dataset.simpleUi = active ? '1' : '0';
  const input = document.getElementById('user-settings-simple-ui');
  if (input) input.checked = active;
  if (persist) localStorage.setItem(USER_SIMPLE_UI_KEY, active ? '1' : '0');
  return active;
}

function syncThemeSelection(theme = getUserTheme()) {
  const selected = APP_THEMES.has(theme) ? theme : 'aurora';
  const input = document.querySelector(`input[name="settings-theme"][value="${selected}"]`);
  if (input) input.checked = true;
  document.getElementById('settings-theme-custom-editor')?.classList.toggle('hidden', selected !== 'custom');
}

function hexLuminance(hex) {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return 0;
  const chan = v => { const x = parseInt(v, 16) / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * chan(c.slice(0, 2)) + 0.7152 * chan(c.slice(2, 4)) + 0.0722 * chan(c.slice(4, 6));
}

function getCustomThemeColors() {
  const bg = localStorage.getItem(CUSTOM_BG_KEY) || CUSTOM_THEME_DEFAULTS.bg;
  const accent = localStorage.getItem(CUSTOM_ACCENT_KEY) || CUSTOM_THEME_DEFAULTS.accent;
  const button = localStorage.getItem(CUSTOM_BUTTON_KEY) || CUSTOM_THEME_DEFAULTS.button;
  return { bg, accent, button };
}

// Renkleri :root'a canlı olarak uygular (önizleme dahil); persist=true iken
// localStorage'a yazar. Metin rengi arka planın luminansına göre otomatik
// seçilir, böylece açık bir arka plan seçilse bile yazılar okunaklı kalır.
// Buton rengi vurgu renginden bağımsız: butonlar üzerinden CSS var(--acc-btn)
// üzerinden okunur, diğer vurgular var(--acc) kullanmaya devam eder.
function applyCustomThemeColors({ bg, accent, button }, persist = false) {
  const root = document.documentElement.style;
  root.setProperty('--custom-bg', bg);
  root.setProperty('--custom-accent', accent);
  if (button) root.setProperty('--custom-button', button);
  const isLight = hexLuminance(bg) > 0.5;
  root.setProperty('--custom-text-main', isLight ? '#172033' : '#f5f5f5');
  root.setProperty('--custom-text-mut', isLight ? '#5b6472' : '#b7b2c4');
  if (persist) {
    localStorage.setItem(CUSTOM_BG_KEY, bg);
    localStorage.setItem(CUSTOM_ACCENT_KEY, accent);
    if (button) localStorage.setItem(CUSTOM_BUTTON_KEY, button);
  }
}

function markActiveCustomPreset(bg) {
  const target = (bg || '').toLowerCase();
  document.querySelectorAll('.settings-theme-preset-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.presetBg === target);
  });
}

function renderCustomThemePresets() {
  const wrap = document.getElementById('settings-theme-presets');
  if (!wrap || wrap.dataset.rendered) return;
  wrap.dataset.rendered = '1';
  CUSTOM_THEME_PRESETS.forEach(preset => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-theme-preset-swatch';
    btn.title = preset.name;
    btn.dataset.presetBg = preset.bg.toLowerCase();
    const dot = document.createElement('span');
    dot.className = 'settings-theme-preset-dot';
    dot.style.background = `linear-gradient(135deg, ${preset.bg} 45%, ${preset.accent})`;
    const name = document.createElement('span');
    name.className = 'settings-theme-preset-name';
    name.textContent = preset.name;
    btn.append(dot, name);
    btn.addEventListener('click', () => {
      const bgInput = document.getElementById('settings-custom-bg');
      const accentInput = document.getElementById('settings-custom-accent');
      const buttonInput = document.getElementById('settings-custom-button');
      const bgHex = document.getElementById('settings-custom-bg-hex');
      const accentHex = document.getElementById('settings-custom-accent-hex');
      const buttonHex = document.getElementById('settings-custom-button-hex');
      if (bgInput) bgInput.value = preset.bg;
      if (accentInput) accentInput.value = preset.accent;
      if (buttonInput) buttonInput.value = preset.button;
      if (bgHex) bgHex.value = preset.bg.toUpperCase();
      if (accentHex) accentHex.value = preset.accent.toUpperCase();
      if (buttonHex) buttonHex.value = preset.button.toUpperCase();
      applyCustomThemeColors({ bg: preset.bg, accent: preset.accent, button: preset.button });
      markActiveCustomPreset(preset.bg);
      applyUserTheme('custom');
    });
    wrap.appendChild(btn);
  });
}

function initCustomThemeEditor() {
  renderCustomThemePresets();
  const { bg, accent, button } = getCustomThemeColors();
  const bgInput = document.getElementById('settings-custom-bg');
  const accentInput = document.getElementById('settings-custom-accent');
  const buttonInput = document.getElementById('settings-custom-button');
  const bgHex = document.getElementById('settings-custom-bg-hex');
  const accentHex = document.getElementById('settings-custom-accent-hex');
  const buttonHex = document.getElementById('settings-custom-button-hex');
  if (bgInput) bgInput.value = bg;
  if (accentInput) accentInput.value = accent;
  if (buttonInput) buttonInput.value = button;
  if (bgHex) bgHex.value = bg.toUpperCase();
  if (accentHex) accentHex.value = accent.toUpperCase();
  if (buttonHex) buttonHex.value = button.toUpperCase();
  applyCustomThemeColors({ bg, accent, button });
  markActiveCustomPreset(bg);

  const HEX_RE = /^#[0-9a-f]{6}$/i;
  const sync = () => {
    const colors = { bg: bgInput?.value || bg, accent: accentInput?.value || accent, button: buttonInput?.value || button };
    applyCustomThemeColors(colors);
    markActiveCustomPreset(colors.bg);
    if (getUserTheme() === 'custom' || document.documentElement.dataset.theme === 'custom') applyUserTheme('custom');
  };
  bgInput?.addEventListener('input', () => { if (bgHex) bgHex.value = bgInput.value.toUpperCase(); sync(); });
  accentInput?.addEventListener('input', () => { if (accentHex) accentHex.value = accentInput.value.toUpperCase(); sync(); });
  buttonInput?.addEventListener('input', () => { if (buttonHex) buttonHex.value = buttonInput.value.toUpperCase(); sync(); });
  bgHex?.addEventListener('input', () => {
    const v = bgHex.value.trim();
    if (HEX_RE.test(v)) { if (bgInput) bgInput.value = v; sync(); }
  });
  accentHex?.addEventListener('input', () => {
    const v = accentHex.value.trim();
    if (HEX_RE.test(v)) { if (accentInput) accentInput.value = v; sync(); }
  });
  buttonHex?.addEventListener('input', () => {
    const v = buttonHex.value.trim();
    if (HEX_RE.test(v)) { if (buttonInput) buttonInput.value = v; sync(); }
  });
}

function applyUserTheme(theme, persist = false) {
  const selected = APP_THEMES.has(theme) ? theme : 'aurora';
  document.documentElement.dataset.theme = selected;
  if (persist) {
    localStorage.setItem(USER_THEME_KEY, selected);
    if (selected === 'custom') {
      const bgInput = document.getElementById('settings-custom-bg');
      const accentInput = document.getElementById('settings-custom-accent');
      const buttonInput = document.getElementById('settings-custom-button');
      const current = getCustomThemeColors();
      applyCustomThemeColors({ bg: bgInput?.value || current.bg, accent: accentInput?.value || current.accent, button: buttonInput?.value || current.button }, true);
    }
  }
  syncThemeSelection(selected);
  const customBg = selected === 'custom' ? getCustomThemeColors().bg : null;
  window.electronAPI?.setWindowTheme?.(selected, persist, customBg);
  return selected;
}

function getUserLanguage() {
  const saved = localStorage.getItem(USER_LANGUAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(saved) ? saved : 'en';
}

function hasCompleteLocaleCatalog(language) {
  const structured = I18N[language];
  const legacy = LEGACY_TEXT_BY_LOCALE[language];
  if (!structured || !legacy) return false;
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const structuredComplete = Object.keys(I18N.en).every(key => hasOwn(structured, key));
  // Turkish is restored from the English display value after a language switch;
  // all other locales translate the original Turkish display value.
  const legacySource = Object.keys(LEGACY_TEXT_EN);
  const legacyComplete = legacySource.every(key => hasOwn(legacy, key));
  return structuredComplete && legacyComplete;
}

function t(key) {
  const lang = getUserLanguage();
  return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || I18N.tr[key] || key;
}

function renderLanguageOptions() {
  const container = document.querySelector('.language-options');
  if (!container) return;
  const activeLanguage = getUserLanguage();
  const fragment = document.createDocumentFragment();
  SUPPORTED_LANGUAGES.forEach(language => {
    const meta = LANGUAGE_META[language];
    const label = document.createElement('label');
    label.className = 'language-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'settings-language';
    input.value = language;
    input.checked = language === activeLanguage;
    const flag = document.createElement('span');
    flag.className = 'language-flag';
    flag.textContent = meta.flag;
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = meta.name;
    const native = document.createElement('small');
    native.textContent = meta.native;
    copy.append(name, native);
    const mark = document.createElement('i');
    mark.textContent = '✓';
    label.append(input, flag, copy, mark);
    fragment.append(label);
  });
  container.replaceChildren(fragment);
}

function applyUserLanguage(language, persist = true) {
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
  if (persist) localStorage.setItem(USER_LANGUAGE_KEY, lang);
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const value = (I18N[lang] && I18N[lang][el.dataset.i18n]) || I18N.en[el.dataset.i18n] || I18N.tr[el.dataset.i18n];
    if (value) el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const value = (I18N[lang] && I18N[lang][el.dataset.i18nPlaceholder]) || I18N.en[el.dataset.i18nPlaceholder] || I18N.tr[el.dataset.i18nPlaceholder];
    if (value) el.placeholder = value;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const value = (I18N[lang] && I18N[lang][el.dataset.i18nTitle]) || I18N.en[el.dataset.i18nTitle] || I18N.tr[el.dataset.i18nTitle];
    if (value) {
      el.title = value;
      el.setAttribute('aria-label', value);
    }
  });
  translateLegacyStaticUI(lang);
  // Focus controls are moved in and out of the DOM, so refresh their titles
  // after every locale change instead of leaving the previous locale behind.
  if (typeof updateFocusLockBtn === 'function') updateFocusLockBtn();
  if (typeof updateFocusFullscreenBtn === 'function') updateFocusFullscreenBtn();
  if (typeof updateFocusExitBtn === 'function') updateFocusExitBtn();
  const selectedLanguage = document.querySelector(`input[name="settings-language"][value="${lang}"]`);
  if (selectedLanguage) selectedLanguage.checked = true;
  const createName = document.getElementById('create-name');
  if (createName && Object.values(I18N).map(locale => locale['menu.gameRoom']).includes(createName.value)) {
    createName.value = t('menu.gameRoom');
  }
  const selfName = document.querySelector('[data-uid="self"] .uname-text');
  if (selfName && state.myName) selfName.textContent = `${state.myName} (${t('common.you')})`;
  updateSettingsTimePreview();
  setMicTestButtonState(!!state.settingsMicTestActive);
  populateSettingsAudioDevices();
  window.TeamSyncMediaLibrary?.refresh();
}

function formatUserTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  const lang = getUserLanguage();
  const format = localStorage.getItem(USER_TIME_FORMAT_KEY) || 'auto';
  const options = { hour: '2-digit', minute: '2-digit' };
  if (format === '12') options.hour12 = true;
  if (format === '24') options.hour12 = false;
  const locale = format === 'auto' ? undefined : (LANGUAGE_META[lang]?.locale || LANGUAGE_META.en.locale);
  return date.toLocaleTimeString(locale, options);
}

function updateSettingsTimePreview() {
  const preview = document.getElementById('settings-time-preview');
  if (preview) preview.textContent = formatUserTime(new Date());
}

function readPercentPreference(key, fallback = 100) {
  const stored = localStorage.getItem(key);
  if (stored === null || stored === '') return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback;
}

function updateSettingsRange(id, value) {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}-value`);
  const safeValue = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  if (input) {
    input.value = String(safeValue);
    input.style.setProperty('--range-progress', `${safeValue}%`);
  }
  if (output) output.value = `${safeValue}%`;
}

function applyMicrophoneVolume(value, persist = true) {
  const percent = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  if (persist) localStorage.setItem(USER_MIC_VOLUME_KEY, String(percent));
  updateSettingsRange('user-mic-volume', percent);
  if (state.micVolumeGainNode && state.gateAudioCtx && state.gateAudioCtx.state !== 'closed') {
    state.micVolumeGainNode.gain.setTargetAtTime(percent / 100, state.gateAudioCtx.currentTime, 0.02);
  }
}

function applySpeakerVolume(value, persist = true) {
  const percent = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  if (persist) localStorage.setItem(USER_SPEAKER_VOLUME_KEY, String(percent));
  state.volume = percent / 100;
  updateSettingsRange('user-speaker-volume', percent);
  const roomSlider = document.getElementById('volslider');
  const roomValue = document.getElementById('volval');
  if (roomSlider) roomSlider.value = String(percent);
  if (roomValue) roomValue.textContent = `${percent}%`;
  state.peers.forEach((peer, peerId) => applyPeerVolume(peerId));
}

function fillAudioDeviceSelect(select, devices, kind, defaultLabel, savedValue) {
  if (!select) return;
  select.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = defaultLabel;
  select.appendChild(defaultOption);
  devices.filter(device => device.kind === kind && device.deviceId && device.deviceId !== 'default').forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${kind === 'audioinput' ? t('settings.microphone') : t('settings.speaker')} ${index + 1}`;
    select.appendChild(option);
  });
  if (savedValue && [...select.options].some(option => option.value === savedValue)) select.value = savedValue;
}

async function populateSettingsAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const savedMic = localStorage.getItem(USER_MIC_DEVICE_KEY) || document.getElementById('mic-select')?.value || '';
    const savedSpeaker = localStorage.getItem('teamsync_speaker_id') || document.getElementById('speaker-select')?.value || '';
    fillAudioDeviceSelect(document.getElementById('user-mic-select'), devices, 'audioinput', t('settings.defaultMicrophone'), savedMic);
    fillAudioDeviceSelect(document.getElementById('user-speaker-select'), devices, 'audiooutput', t('settings.defaultSpeaker'), savedSpeaker);
  } catch (error) {
    console.warn('Ayarlar ses cihazları listelenemedi:', error);
  }
}

function updateSettingsMicMeter(percent = 0) {
  const meter = document.getElementById('user-mic-meter');
  if (!meter) return;
  const safePercent = state.settingsMicTestActive ? Math.min(100, Math.max(0, percent)) : 0;
  const bars = meter.children;
  const activeCount = Math.round((safePercent / 100) * bars.length);
  // Kirli-kontrol: yanan çubuk sayısı değişmediyse hiçbir DOM yazımı yapma.
  // Bu fonksiyon VU döngüsünden saniyede 20 kez çağrılıyordu ve her çağrıda
  // tüm çubukları dolaşıp iki classList.toggle + bir setAttribute yazıyordu.
  if (meter.__lastActiveCount === activeCount) return;
  meter.__lastActiveCount = activeCount;
  const hotFrom = Math.round(bars.length * 0.82);
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    bar.classList.toggle('active', index < activeCount);
    bar.classList.toggle('hot', index < activeCount && index >= hotFrom);
  }
  meter.setAttribute('aria-valuenow', String(Math.round(safePercent)));
}

function setMicTestButtonState(active) {
  const button = document.getElementById('user-mic-test');
  if (!button) return;
  button.classList.toggle('testing', active);
  button.textContent = t(active ? 'settings.stopMicTest' : 'settings.micTest');
}

function stopSettingsMicTest() {
  state.settingsMicTestRequestId = (state.settingsMicTestRequestId || 0) + 1;
  state.settingsMicTestActive = false;
  setMicTestButtonState(false);
  updateSettingsMicMeter(0);
  if (!state.settingsMicTestOwnsStream) return;
  state.settingsMicTestOwnsStream = false;
  state.audioSetupGeneration++;
  if (state.rawMicStream) state.rawMicStream.getTracks().forEach(track => track.stop());
  if (state.localStream) state.localStream.getTracks().forEach(track => track.stop());
  if (state.gateAudioCtx && state.gateAudioCtx.state !== 'closed') {
    try { state.gateAudioCtx.close(); } catch (error) {}
  }
  if (state.vuInterval) clearInterval(state.vuInterval);
  state.vuInterval = null;
  state.rawMicStream = null;
  state.localStream = null;
  state.processedStream = null;
  state.vuAnalyser = null;
  state.uiAnalyser = null;
  state.gateGainNode = null;
  state.micVolumeGainNode = null;
}

async function toggleSettingsMicTest() {
  if (state.settingsMicTestActive) {
    stopSettingsMicTest();
    return;
  }
  const ownedStream = !state.room && !state.rawMicStream;
  const requestId = (state.settingsMicTestRequestId || 0) + 1;
  state.settingsMicTestRequestId = requestId;
  state.settingsMicTestOwnsStream = ownedStream;
  try {
    if (!state.vuAnalyser) await setupLocalAudio();
    if (state.settingsMicTestRequestId !== requestId) return;
    state.settingsMicTestActive = true;
    setMicTestButtonState(true);
    setupVUMeter();
  } catch (error) {
    if (state.settingsMicTestRequestId !== requestId) return;
    state.settingsMicTestOwnsStream = false;
    showToast(t('settings.micPermissionError'), 'warn');
  }
}

function setSettingsPanel(name) {
  document.querySelectorAll('[data-settings-panel]').forEach(button => {
    button.classList.toggle('active', button.dataset.settingsPanel === name);
  });
  document.querySelectorAll('[data-settings-content]').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.settingsContent === name);
  });
  if (name !== 'voice' && state.settingsMicTestActive) stopSettingsMicTest();
  if (name === 'media') window.TeamSyncMediaLibrary?.renderSettings();
  else window.releaseMediaLibrarySettingsUrls?.();
}

function openUserSettings(panel = 'general') {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  setSettingsPanel(panel);

  const profileName = document.getElementById('settings-profile-name');
  const profile = (() => {
    try { return JSON.parse(localStorage.getItem('teamsync_profile') || '{}'); } catch (e) { return {}; }
  })();
  if (profileName) profileName.textContent = (typeof state !== 'undefined' && state.myName) || profile.name || 'TeamSync';

  document.getElementById('user-turn-url').value = localStorage.getItem('teamsync_turn_url') || '';
  document.getElementById('user-turn-user').value = localStorage.getItem('teamsync_turn_user') || '';
  document.getElementById('user-turn-pass').value = localStorage.getItem('teamsync_turn_pass') || '';
  document.getElementById('user-settings-ptt').checked = localStorage.getItem('teamsync_ptt_enabled') === '1';
  const noiseSuppressionEl = document.getElementById('user-settings-noise-suppression');
  if (noiseSuppressionEl) noiseSuppressionEl.checked = localStorage.getItem(USER_NOISE_SUPPRESSION_KEY) !== '0';
  document.getElementById('user-quality-select').value = localStorage.getItem(USER_QUALITY_KEY) || document.getElementById('quality-select').value || 'medium';
  document.getElementById('user-stream-fps').value = localStorage.getItem(USER_STREAM_FPS_KEY) || '30';
  document.getElementById('user-stream-previews').checked = localStorage.getItem(USER_STREAM_PREVIEWS_KEY) !== '0';
  document.getElementById('user-share-system-audio').checked = localStorage.getItem(USER_SHARE_SYSTEM_AUDIO_KEY) !== '0';
  applyMicrophoneVolume(readPercentPreference(USER_MIC_VOLUME_KEY), false);
  applySpeakerVolume(readPercentPreference(USER_SPEAKER_VOLUME_KEY), false);
  populateSettingsAudioDevices();

  const language = getUserLanguage();
  const languageRadio = document.querySelector(`input[name="settings-language"][value="${language}"]`);
  if (languageRadio) languageRadio.checked = true;
  const timeFormat = localStorage.getItem(USER_TIME_FORMAT_KEY) || 'auto';
  const timeRadio = document.querySelector(`input[name="settings-time-format"][value="${timeFormat}"]`);
  if (timeRadio) timeRadio.checked = true;
  applySimpleUi(getSimpleUiEnabled());
  syncThemeSelection();
  updateSettingsTimePreview();

  const hwEl = document.getElementById('user-settings-hwaccel');
  if (hwEl && window.electronAPI && window.electronAPI.getHardwareAcceleration) {
    window.electronAPI.getHardwareAcceleration().then(on => { hwEl.checked = !!on; }).catch(() => {});
  }
}

async function saveUserSettings() {
  const turnUrl = document.getElementById('user-turn-url').value.trim();
  const turnUser = document.getElementById('user-turn-user').value.trim();
  const turnPass = document.getElementById('user-turn-pass').value.trim();
  const pttEnabled = document.getElementById('user-settings-ptt').checked;
  const noiseSuppressionEnabled = document.getElementById('user-settings-noise-suppression')?.checked !== false;
  const quality = document.getElementById('user-quality-select').value;
  const streamFps = document.getElementById('user-stream-fps').value;
  const showStreamPreviews = document.getElementById('user-stream-previews').checked;
  const shareSystemAudio = document.getElementById('user-share-system-audio').checked;
  const theme = document.querySelector('input[name="settings-theme"]:checked')?.value || getUserTheme();
  const simpleUi = document.getElementById('user-settings-simple-ui')?.checked !== false;

  localStorage.setItem('teamsync_turn_url', turnUrl);
  localStorage.setItem('teamsync_turn_user', turnUser);
  localStorage.setItem('teamsync_turn_pass', turnPass);
  localStorage.setItem('teamsync_ptt_enabled', pttEnabled ? '1' : '0');
  localStorage.setItem(USER_NOISE_SUPPRESSION_KEY, noiseSuppressionEnabled ? '1' : '0');
  localStorage.setItem(USER_QUALITY_KEY, quality);
  localStorage.setItem(USER_STREAM_FPS_KEY, streamFps);
  localStorage.setItem(USER_STREAM_PREVIEWS_KEY, showStreamPreviews ? '1' : '0');
  localStorage.setItem(USER_SHARE_SYSTEM_AUDIO_KEY, shareSystemAudio ? '1' : '0');
  applySimpleUi(simpleUi, true);
  applyUserTheme(theme, true);
  applyMicrophoneVolume(document.getElementById('user-mic-volume').value, true);
  applySpeakerVolume(document.getElementById('user-speaker-volume').value, true);

  // Oda içindeki eski çalışma yolları bu alanları kullanıyor; görünür ayar
  // merkezindeki değerlerle eşit tutarak mevcut ses/ağ davranışını koru.
  document.getElementById('turn-url').value = turnUrl;
  document.getElementById('turn-user').value = turnUser;
  document.getElementById('turn-pass').value = turnPass;
  document.getElementById('settings-ptt').checked = pttEnabled;
  document.getElementById('quality-select').value = quality;
  if (typeof state !== 'undefined' && state.room) applyPttMode(pttEnabled);
  await applyRoomNoiseSuppression(noiseSuppressionEnabled);

  const status = document.getElementById('settings-save-status');
  if (status) {
    status.textContent = t('settings.saved');
    setTimeout(() => {
      if (status) status.textContent = t('settings.savedLocally');
    }, 1800);
  }
  showToast(t('settings.saved'), 'ok');
}

function initUserSettings() {
  // Ayarlar hem ana menüden hem oda içinden açılır. Modal başlangıçta #app
  // altında tanımlı; #app ana menüde gizli olduğundan body'ye portal edilmelidir.
  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal && settingsModal.parentElement !== document.body) document.body.appendChild(settingsModal);
  state.useAI = localStorage.getItem(USER_NOISE_SUPPRESSION_KEY) !== '0';
  // RNNoise artÄ±k sunucu/oda politikasÄ± deÄŸil, kiÅŸisel ses ayarÄ±dÄ±r.
  // Eski kurulumlardan kalan oda ve katÄ±l ekranÄ± kontrollerini gÃ¶stermeyip
  // tek kaynaÄŸÄ± normal Ayarlar > Ses ve GÃ¶rÃ¼ntÃ¼ panelinde tutuyoruz.
  ['join-useAI', 'create-useAI'].forEach(id => {
    const input = document.getElementById(id);
    const option = input?.closest('.premium-option');
    // DOM dÄ±ÅŸÄ±na Ã§Ä±karmÄ±yoruz; eski olay baÄŸlayÄ±cÄ±larÄ± bu referanslarÄ±
    // kullanÄ±yor. GÃ¶rsel olarak gizleyip kiÅŸisel ayarÄ± tek kaynak tutuyoruz.
    if (option) option.style.display = 'none';
  });
  const legacyFounderNoise = document.getElementById('founder-noise-suppression');
  if (legacyFounderNoise) {
    const row = legacyFounderNoise.closest('div[style*="justify-content"]');
    if (row) {
      row.style.display = 'none';
      if (row.nextElementSibling) row.nextElementSibling.style.display = 'none';
    }
  }
  renderLanguageOptions();
  initCustomThemeEditor();
  applySimpleUi(getSimpleUiEnabled());
  applyUserTheme(getUserTheme());
  applyUserLanguage(getUserLanguage(), false);
  const quality = localStorage.getItem(USER_QUALITY_KEY);
  if (quality && document.getElementById('quality-select')) document.getElementById('quality-select').value = quality;
  applyMicrophoneVolume(readPercentPreference(USER_MIC_VOLUME_KEY), false);
  applySpeakerVolume(readPercentPreference(USER_SPEAKER_VOLUME_KEY), false);

  document.querySelectorAll('[data-settings-panel]').forEach(button => {
    button.addEventListener('click', () => setSettingsPanel(button.dataset.settingsPanel));
  });
  document.getElementById('menu-settings')?.addEventListener('click', () => openUserSettings('general'));
  document.getElementById('settings')?.addEventListener('click', () => openUserSettings('general'));
  document.getElementById('settings-v2-close')?.addEventListener('click', () => {
    stopSettingsMicTest();
    window.releaseMediaLibrarySettingsUrls?.();
    applySimpleUi(getSimpleUiEnabled());
    applyUserTheme(getUserTheme());
    document.getElementById('settings-modal').classList.add('hidden');
  });
  document.getElementById('settings-v2-save')?.addEventListener('click', saveUserSettings);
  document.getElementById('user-mic-test')?.addEventListener('click', toggleSettingsMicTest);
  document.getElementById('user-mic-volume')?.addEventListener('input', event => {
    applyMicrophoneVolume(event.target.value, true);
  });
  document.getElementById('user-speaker-volume')?.addEventListener('input', event => {
    applySpeakerVolume(event.target.value, true);
  });
  document.getElementById('user-mic-select')?.addEventListener('change', async event => {
    const value = event.target.value;
    if (value) localStorage.setItem(USER_MIC_DEVICE_KEY, value);
    else localStorage.removeItem(USER_MIC_DEVICE_KEY);
    const roomSelect = document.getElementById('mic-select');
    if (roomSelect && [...roomSelect.options].some(option => option.value === value)) roomSelect.value = value;
    if (state.room || state.rawMicStream) {
      await setupLocalAudio();
      setupVUMeter();
    }
    showToast(t('settings.deviceChanged'), 'info');
  });
  document.getElementById('user-speaker-select')?.addEventListener('change', event => {
    const value = event.target.value;
    if (value) localStorage.setItem('teamsync_speaker_id', value);
    else localStorage.removeItem('teamsync_speaker_id');
    const roomSelect = document.getElementById('speaker-select');
    if (roomSelect && [...roomSelect.options].some(option => option.value === value)) roomSelect.value = value;
    applySpeakerToAll();
    showToast(t('settings.deviceChanged'), 'info');
  });
  document.getElementById('user-broadcast-advanced-toggle')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    document.getElementById('user-broadcast-advanced')?.classList.toggle('hidden', !expanded);
  });

  document.querySelectorAll('input[name="settings-language"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) applyUserLanguage(radio.value, true);
    });
  });
  document.querySelectorAll('input[name="settings-time-format"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      localStorage.setItem(USER_TIME_FORMAT_KEY, radio.value);
      updateSettingsTimePreview();
    });
  });
  document.querySelectorAll('input[name="settings-theme"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) applyUserTheme(radio.value);
    });
  });
  document.getElementById('user-settings-simple-ui')?.addEventListener('change', event => {
    applySimpleUi(event.target.checked);
  });

  const hwEl = document.getElementById('user-settings-hwaccel');
  if (hwEl && window.electronAPI && window.electronAPI.setHardwareAcceleration) {
    hwEl.addEventListener('change', e => {
      window.electronAPI.setHardwareAcceleration(e.target.checked);
      showToast(t('settings.hwSaved'), 'info');
    });
  }
  if (navigator.mediaDevices && !state.settingsDeviceChangeHooked) {
    state.settingsDeviceChangeHooked = true;
    navigator.mediaDevices.addEventListener('devicechange', populateSettingsAudioDevices);
  }
  if (!state.legacyI18nObserver) {
    state.legacyI18nObserver = new MutationObserver(mutations => {
      const language = getUserLanguage();
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          translateLegacyStaticUI(language, mutation.target);
          return;
        }
        mutation.addedNodes.forEach(node => translateLegacyStaticUI(language, node));
      });
    });
    state.legacyI18nObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title', 'placeholder']
    });
  }
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && !document.getElementById('settings-modal')?.classList.contains('hidden')) {
      stopSettingsMicTest();
      window.releaseMediaLibrarySettingsUrls?.();
      document.getElementById('settings-modal').classList.add('hidden');
    }
  });
}

window.t = t;
window.applyUserLanguage = applyUserLanguage;
window.formatUserTime = formatUserTime;
window.openUserSettings = openUserSettings;
document.addEventListener('DOMContentLoaded', initUserSettings);

function bindUI() {
  const mic = document.getElementById('mic');
  const deaf = document.getElementById('deaf');
  const share = document.getElementById('share');
  const rec = document.getElementById('rec');
  const vol = document.getElementById('vol');
  const volpop = document.getElementById('volpop');
  const volslider = document.getElementById('volslider');
  const volval = document.getElementById('volval');
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
    
    // Sağırlaştır/aç: kayıtlı kişi bazlı ses + ana ses tek yerden uygulanır.
    state.peers.forEach((peer, peerId) => applyPeerVolume(peerId));

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
    applySpeakerVolume(e.target.value, true);
  });

  const shareCancel = document.getElementById('share-cancel');
  if (shareCancel) {
    shareCancel.addEventListener('click', () => {
      document.getElementById('share-modal').classList.add('hidden');
    });
  }

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

  const refreshSfwChatBanSettings = () => {
    const panel = document.getElementById('founder-sfw-chat-ban-settings');
    if (panel) panel.classList.toggle('hidden', !state.isRoomFounder || !state.sfwMode);
    const enabledEl = document.getElementById('founder-sfw-chat-ban');
    if (enabledEl) enabledEl.checked = !!state.sfwChatBanEnabled;
    const thresholdEl = document.getElementById('founder-sfw-chat-ban-threshold');
    if (thresholdEl) thresholdEl.value = String(getSfwChatBanThreshold());
  };

  document.getElementById('founder-settings').addEventListener('click', () => {
    document.getElementById('founder-settings-modal').classList.remove('hidden');
    document.getElementById('founder-friends-only').checked = state.friendsOnlyMode || false;
    document.getElementById('founder-sfw-mode').checked = state.sfwMode || false;
    refreshSfwChatBanSettings();
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
        nameSpan.innerHTML = escapeHtml(displayName(peerId, peer.name || 'Bilinmeyen')) + roleTag;
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

          const chatBanned = isChatBanned(peerId);
          const chatBanBtn = document.createElement('button');
          chatBanBtn.className = 'btn-sec btn-sm';
          chatBanBtn.style.padding = '4px 8px';
          chatBanBtn.style.fontSize = '12px';
          chatBanBtn.style.color = chatBanned ? 'var(--ok)' : '#fbbf24';
          chatBanBtn.style.borderColor = chatBanned ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.3)';
          chatBanBtn.innerHTML = chatBanned ? '💬 Sohbet yasağını kaldır' : '💬 Sohbetten yasakla';
          chatBanBtn.onclick = async () => {
            const action = chatBanned ? 'sohbet yasağı kaldırılsın mı?' : 'sohbetten yasaklansın mı?';
            if (!(await window.showConfirm('💬 Sohbet Moderasyonu', `"${peer.name}" ${action}`))) return;
            setChatBan(peerId, !chatBanned);
            showToast(chatBanned ? `${peer.name} için sohbet yasağı kaldırıldı.` : `${peer.name} sohbetten yasaklandı.`, 'info');
            document.getElementById('founder-settings').dispatchEvent(new Event('click'));
          };

          actionsDiv.appendChild(modBtn);
          actionsDiv.appendChild(transferBtn);
          actionsDiv.appendChild(banBtn);
          actionsDiv.appendChild(chatBanBtn);
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
    if (!state.isRoomFounder) {
      e.target.checked = !!state.sfwMode;
      return;
    }
    state.sfwMode = e.target.checked;
    if (state.sfwMode && state.roomName) {
      state.roomName = censorProfaneText(state.roomName);
      const titleEl = document.getElementById('room-title');
      if (titleEl) titleEl.textContent = '# ' + state.roomName + (state.cryptoKey ? ' 🔒' : '');
    }
    if (state.sfwMode) loadAIFilter();
    refreshSfwChatBanSettings();
    broadcast({
      type: 'founder_settings_update',
      sfwMode: state.sfwMode,
      sfwChatBanEnabled: !!state.sfwChatBanEnabled,
      sfwChatBanThreshold: getSfwChatBanThreshold()
    });
    showToast(state.sfwMode ? 'Yapay Zeka Koruması aktif!' : 'Yapay Zeka Koruması kapatıldı.', 'info');
  });

  document.getElementById('founder-sfw-chat-ban')?.addEventListener('change', (e) => {
    if (!state.isRoomFounder) return;
    state.sfwChatBanEnabled = !!e.target.checked;
    broadcast({ type: 'founder_settings_update', sfwChatBanEnabled: state.sfwChatBanEnabled });
    showToast(state.sfwChatBanEnabled ? 'Otomatik sohbet yasağı aktif.' : 'Otomatik sohbet yasağı kapatıldı.', 'info');
  });

  document.getElementById('founder-sfw-chat-ban-threshold')?.addEventListener('change', (e) => {
    if (!state.isRoomFounder) return;
    state.sfwChatBanThreshold = getSfwChatBanThreshold(e.target.value);
    e.target.value = String(state.sfwChatBanThreshold);
    broadcast({ type: 'founder_settings_update', sfwChatBanThreshold: state.sfwChatBanThreshold });
  });

  document.querySelectorAll('[data-sfw-chat-ban-step]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!state.isRoomFounder) return;
      const input = document.getElementById('founder-sfw-chat-ban-threshold');
      if (!input) return;
      const step = Number.parseInt(button.dataset.sfwChatBanStep, 10) || 0;
      input.value = String(getSfwChatBanThreshold(Number(input.value) + step));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  document.getElementById('founder-game-mode').addEventListener('change', (e) => {
    state.gameMode = e.target.checked;
    broadcast({ type: 'founder_settings_update', gameMode: state.gameMode });
    showToast(state.gameMode ? 'Oyun Modu aktif (15FPS/Düşük İşlemci)!' : 'Oyun Modu kapatıldı.', 'info');
  });

  document.getElementById('founder-noise-suppression').addEventListener('change', async (e) => {
    if (true) {
      e.target.checked = !!state.useAI;
      return;
    }

    const enabled = e.target.checked;
    e.target.disabled = true;
    try {
      await applyRoomNoiseSuppression(enabled);
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
    if (e.code === 'KeyF' && focusedCard) toggleFocusFullscreen();
    // Esc: tam ekrandayken tarayıcı zaten çıkarır; değilken (ve açık bir modal
    // yokken) odak modundan çıkar. Kilitliyse çıkmaz.
    if (e.code === 'Escape' && focusedCard && !document.fullscreenElement) {
      if (document.querySelector('.modal:not(.hidden)')) return;
      if (state.focusLocked) {
        showToast('Odak kilitli — çıkmak için önce kilidi aç', 'info');
        return;
      }
      exitFocus();
    }
  });

  document.getElementById('act-btn').addEventListener('click', () => {
    broadcast({ type: 'lobby-sync-request' });
    updateActivityCounts();
    const search = document.getElementById('activity-search');
    if (search) search.value = '';
    filterActivityCards('');
    document.getElementById('activities-modal').classList.remove('hidden');
    requestAnimationFrame(() => search?.focus({ preventScroll: true }));
  });
  document.getElementById('act-close').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
  });
  
  // e.detail > 1: çift tıklamanın ikinci click'i. Yutulmazsa çift tıklama
  // "aç + kapa" olup net etkisiz kalıyor — kullanıcı kilide çift tıklayınca
  // kilit tutmamış gibi görünüyordu. Üç düğmede de çift tık = tek işlem.
  document.getElementById('focus-lock-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail > 1) return;
    state.focusLocked = !state.focusLocked;
    updateFocusLockBtn();
    showToast(state.focusLocked ? 'Odak kilitlendi — tıklamalar odağı değiştirmez' : 'Odak kilidi açıldı', 'info');
  });

  document.getElementById('focus-fullscreen-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail > 1) return;
    toggleFocusFullscreen();
  });

  document.getElementById('focus-exit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail > 1) return;
    if (state.focusLocked) {
      showToast('Odak kilitli — çıkmak için önce kilidi aç', 'info');
      return;
    }
    if (focusMinimized) restoreFocus();
    else minimizeFocus();
  });

  // ESC ile tam ekrandan çıkış tarayıcı tarafından yapılır; buton görünümünü
  // ve kart yerleşimini her iki yönde de burada eşitleriz. (Eski sistemde bu
  // dinleyici yoktu — ESC sonrası durum bozuk kalıyordu.)
  document.addEventListener('fullscreenchange', () => {
    updateFocusFullscreenBtn();
    if (!document.fullscreenElement) {
      syncFocusLayout();
      requestAnimationFrame(syncFocusLayout);
    }
  });

  window.addEventListener('resize', syncFocusLayout);
  const focusSpacerRO = new ResizeObserver(() => syncFocusLayout());
  focusSpacerRO.observe(document.getElementById('focus-area'));
  focusSpacerRO.observe(document.querySelector('.main'));

  // Statik aktivite kartlarının tamamı baştan odaklanabilir olsun — hangi
  // yoldan açılırsa açılsın tıkla-büyüt çalışır. Ayrıca hepsi #grid'in İÇİNDE
  // olmalı: poke-card HTML'de yanlışlıkla .main'in doğrudan çocuğuydu; şerit
  // kuralları uygulanmayınca 620px'lik kart, başka bir kart odaklanınca yer
  // tutucuyu eziyor ve düzeni ekran dışına taşırıyordu. (Kartlar bu aşamada
  // gizli ve iframe'siz — taşımak güvenli.)
  const focusGrid = document.getElementById('grid');
  Object.keys(FOCUS_CARD_TITLES).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.parentElement !== focusGrid) focusGrid.appendChild(el);
    makeCardFocusable(el);
  });

  initActivitiesUI();
}

// Push-to-Talk artık kişisel bir kullanıcı ayarı (ayarlar modalı) — oda
// başlarken VEYA oda içindeyken ayar değiştirildiğinde bu fonksiyon çağrılır.
function applyPttMode(enabled) {
  state.pttMode = enabled;
  const pttBtn = document.getElementById('ptt');
  if (enabled) {
    // Tuş artık Ayarlar → Kısayollar panelinden değiştirilebilir; varsayılan Space.
    window.electronAPI.registerPTT(window.getPttAccelerator ? window.getPttAccelerator() : 'Space');
    if (pttBtn) pttBtn.classList.remove('hidden');
    if (!state.pttAttached) {
      window.electronAPI.onPTT(() => {
        if (!state.pttMode) return;
        state.pttActive = true;
        document.getElementById('ptt').classList.add('active');
        setMicEnabled(true);
      });
      document.addEventListener('keyup', (e) => {
        const isPttKey = window.matchesPttReleaseKey ? window.matchesPttReleaseKey(e) : e.code === 'Space';
        if (isPttKey && state.pttMode) {
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
  const showPreviews = localStorage.getItem(USER_STREAM_PREVIEWS_KEY) !== '0';
  const shareAudio = document.getElementById('share-audio');
  if (shareAudio) shareAudio.checked = localStorage.getItem(USER_SHARE_SYSTEM_AUDIO_KEY) !== '0';
  wrap.innerHTML = '';
  sources.forEach(s => {
    const div = document.createElement('div');
    div.className = `src${showPreviews ? '' : ' preview-hidden'}`;
    div.innerHTML = showPreviews
      ? `<img src="${s.thumbnail}" alt="" /><div>${escapeHtml(s.name)}</div>`
      : `<div class="source-preview-placeholder"><span>▣</span><small>${escapeHtml(t('settings.previewHidden'))}</small></div><div>${escapeHtml(s.name)}</div>`;
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
    const preferredFps = Number(localStorage.getItem(USER_STREAM_FPS_KEY)) || consts.frameRate.ideal || 30;
    const frameRate = state.gameMode ? 15 : Math.min(60, Math.max(15, preferredFps));
    if (window.electronAPI && window.electronAPI.setScreenShareSource) {
      window.electronAPI.setScreenShareSource(sourceId);
    }
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({
      audio: shareAudio,
      video: {
        width: consts.width,
        height: consts.height,
        frameRate: { ideal: frameRate, max: frameRate }
      }
    });
    const track = state.screenStream.getVideoTracks()[0];
    // Kullanıcı paylaşım penceresinde sesi paylaşmamayı seçmiş olabilir —
    // o zaman hiç ses track'i gelmez ve bu adım sessizce atlanır.
    const screenAudioTrack = state.screenStream.getAudioTracks()[0] || null;
    state.peers.forEach(peer => {
      const sender = getVideoSender(peer.pc);
      if (sender) {
        // limitVideoQuality DEĞİL: burada eskiden tanımsız bir applyVideoQuality
        // çağrılıyordu ve hata .catch içinde yutulduğu için kalite ayarı
        // (Yüksek/Orta/Düşük) gönderici bit hızına HİÇ uygulanmıyordu.
        sender.replaceTrack(track).then(() => limitVideoBitrate(sender)).catch(console.error);
      }
      // Ses için de aynı "önceden açılmış sender + replaceTrack" deseni:
      // yeniden müzakere YOK. Karşı taraf eski sürümse false döner, atlanır.
      if (screenAudioTrack) sendScreenAudioToPeer(peer, screenAudioTrack);
    });
    state.isSharing = true;
    document.getElementById('share').classList.add('off');
    // audio bayrağı: alıcı tarafta "Ekran Sesi" slider'ının görünürlüğünü
    // belirler. Eski sürümler bu alanı görmezden gelir.
    broadcast({ type: 'sharing', sharing: true, audio: !!screenAudioTrack });
    // Paylaşan kendi sistem sesini zaten hoparlöründen duyar; attachVideo
    // muted:true olduğu için burada YEREL OLARAK TEKRAR ÇALINMAZ (yankı olmaz).
    addVideoCard('self', `${state.myName} (${t('common.you')})`, attachVideo(state.screenStream), true);
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
    // Ekran sesi gönderimini durdur. Transceiver (m-line) YERİNDE KALIR —
    // tekrar paylaşınca yeniden müzakere gerekmesin diye.
    sendScreenAudioToPeer(peer, null);
  });
  state.screenStream = null;
  state.isSharing = false;
  if (state.pendingControlReq) {
    rejectControlRequest(state.pendingControlReq.peerId, state.pendingControlReq.reqId, 'not-sharing');
    closeCtrlModal();
  }
  // Paylaşım biterse bekleyen "denetim ver" teklifi de düşer.
  if (state.pendingControlOffer) {
    broadcastTo(state.pendingControlOffer.peerId, { type: 'ctrl-offer-cancel', reqId: state.pendingControlOffer.reqId });
    clearControlOffer();
  }
  if (state.controlledBy) stopBeingControlled(true);
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
  const peer = state.peers.get(peerId);
  if (!peer || !peer.sharing) {
    showToast('Denetim izni yalnızca ekran paylaşılırken istenebilir.', 'warn');
    return false;
  }
  if (!isPeerScreenOpen(peerId)) {
    showToast('Kontrol isteği göndermek için önce ekran paylaşımını açın.', 'warn');
    return false;
  }
  broadcastTo(peerId, { type: 'ctrl-req', reqId: 'req-' + Date.now() });
  showToast('Kontrol isteği gönderildi.', 'info');
  return true;
}

function rejectControlRequest(peerId, reqId, reason) {
  broadcastTo(peerId, { type: 'ctrl-res', accepted: false, reqId, reason });
}

// İstek, ekranı kaplayan modal yerine sağ üstte bildirim kartı olarak gösterilir;
// kullanıcının o an yaptığı işi engellemez. 30 sn yanıtsız kalırsa otomatik ret.
const CTRL_REQ_TIMEOUT_MS = 30000;
let ctrlReqTimer = null;

function showControlModal(peerId, peerName, reqId) {
  if (!state.isSharing) {
    rejectControlRequest(peerId, reqId, 'not-sharing');
    return false;
  }
  if (state.controlledBy || state.pendingControlReq) {
    rejectControlRequest(peerId, reqId, 'busy');
    return false;
  }
  state.pendingControlReq = { peerId, reqId };
  document.getElementById('ctrl-text').textContent = `${peerName} bilgisayarınızı kontrol etmek istiyor.`;
  const note = document.getElementById('ctrl-modal');
  note.classList.remove('hidden');
  const bar = document.getElementById('ctrl-timer-bar');
  if (bar) {
    bar.style.transition = 'none';
    bar.style.width = '100%';
    void bar.offsetWidth;
    bar.style.transition = `width ${CTRL_REQ_TIMEOUT_MS}ms linear`;
    bar.style.width = '0%';
  }
  clearTimeout(ctrlReqTimer);
  ctrlReqTimer = setTimeout(() => {
    if (state.pendingControlReq) {
      rejectControlRequest(state.pendingControlReq.peerId, state.pendingControlReq.reqId, 'timeout');
    }
    closeCtrlModal();
  }, CTRL_REQ_TIMEOUT_MS);
  return true;
}

document.getElementById('ctrl-accept').addEventListener('click', () => {
  if (state.pendingControlReq) {
    const request = state.pendingControlReq;
    if (!state.isSharing) {
      rejectControlRequest(request.peerId, request.reqId, 'not-sharing');
      closeCtrlModal();
      return;
    }
    if (state.controlledBy) {
      rejectControlRequest(request.peerId, request.reqId, 'busy');
      closeCtrlModal();
      return;
    }
    // Kabul: gelen ctrl-event'lerin işleneceği kaynak burada kaydedilir.
    grantControlTo(request.peerId, request.reqId);
  }
  closeCtrlModal();
});

// Denetimi fiilen başlatan TEK nokta: hem "izleyen istedi → kabul ettim"
// akışı hem de "paylaşan denetim verdi → izleyici kabul etti" akışı buradan
// geçer. Böylece controlledBy/controlOwner ve main süreç bildirimleri tek
// yerde kalır (paralel bir denetim sistemi kurulmaz).
function grantControlTo(peerId, reqId) {
  state.controlledBy = peerId;
  state.controlOwner = 'host';
  broadcastTo(peerId, { type: 'ctrl-res', accepted: true, reqId });
  window.electronAPI.setRemoteControl(true);
  window.electronAPI.setControlOwner('host');
  const pill = document.getElementById('ctrl-active-pill');
  updateHostControlPill();
  if (pill) pill.classList.remove('hidden');
}
document.getElementById('ctrl-deny').addEventListener('click', () => {
  if (state.pendingControlReq) {
    rejectControlRequest(state.pendingControlReq.peerId, state.pendingControlReq.reqId, 'denied');
  }
  closeCtrlModal();
});
function closeCtrlModal() {
  clearTimeout(ctrlReqTimer);
  ctrlReqTimer = null;
  document.getElementById('ctrl-modal').classList.add('hidden');
  state.pendingControlReq = null;
}

// ===== GÖREV 3: Paylaşan taraf istek beklemeden denetim verir ===============
// Akış:  paylaşan "Denetim Ver"  →(ctrl-offer)→  izleyicide kabul kartı
//        izleyici "Kabul Et"     →(ctrl-offer-res)→ paylaşan grantControlTo()
//        paylaşan               →(ctrl-res accepted)→ izleyicide oturum açılır
// İzleyici tarafında oturumun açılması, istek akışıyla AYNI ctrl-res koduyla
// olur. Kabul zorunludur: kimsenin ekranı habersiz ele geçirilemez.
let ctrlOfferTimer = null;   // paylaşan taraf: yanıt bekleme süresi
let ctrlOfferNoteTimer = null; // izleyici tarafı: kabul kartının süresi

function offerControl(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return false;
  if (!state.isSharing) {
    showToast('Denetim vermek için önce ekranınızı paylaşın.', 'warn');
    return false;
  }
  if (state.controlledBy) {
    showToast('Denetim şu anda başka bir kullanıcıda.', 'warn');
    return false;
  }
  if (state.pendingControlOffer) {
    showToast('Bekleyen bir denetim teklifiniz var.', 'warn');
    return false;
  }
  const reqId = 'offer-' + Date.now();
  state.pendingControlOffer = { peerId, reqId };
  broadcastTo(peerId, { type: 'ctrl-offer', reqId });
  showToast(`${displayName(peerId, peer.name)} kişisine denetim teklif edildi.`, 'info');
  clearTimeout(ctrlOfferTimer);
  ctrlOfferTimer = setTimeout(() => {
    if (state.pendingControlOffer && state.pendingControlOffer.reqId === reqId) {
      broadcastTo(peerId, { type: 'ctrl-offer-cancel', reqId });
      clearControlOffer();
      showToast('Denetim teklifi yanıtlanmadı.', 'warn');
    }
  }, CTRL_REQ_TIMEOUT_MS);
  return true;
}

function clearControlOffer() {
  clearTimeout(ctrlOfferTimer);
  ctrlOfferTimer = null;
  state.pendingControlOffer = null;
}

function showControlOfferNote(peerId, peerName, reqId) {
  const note = document.getElementById('ctrl-offer-modal');
  if (!note) return false;
  state.incomingControlOffer = { peerId, reqId };
  const text = document.getElementById('ctrl-offer-text');
  if (text) text.textContent = `${peerName} size kendi bilgisayarının denetimini vermek istiyor.`;
  note.classList.remove('hidden');
  const bar = document.getElementById('ctrl-offer-timer-bar');
  if (bar) {
    bar.style.transition = 'none';
    bar.style.width = '100%';
    void bar.offsetWidth;
    bar.style.transition = `width ${CTRL_REQ_TIMEOUT_MS}ms linear`;
    bar.style.width = '0%';
  }
  clearTimeout(ctrlOfferNoteTimer);
  ctrlOfferNoteTimer = setTimeout(() => {
    if (state.incomingControlOffer) {
      broadcastTo(state.incomingControlOffer.peerId, {
        type: 'ctrl-offer-res', accepted: false, reqId: state.incomingControlOffer.reqId, reason: 'timeout'
      });
    }
    closeCtrlOfferNote();
  }, CTRL_REQ_TIMEOUT_MS);
  return true;
}

function closeCtrlOfferNote() {
  clearTimeout(ctrlOfferNoteTimer);
  ctrlOfferNoteTimer = null;
  const note = document.getElementById('ctrl-offer-modal');
  if (note) note.classList.add('hidden');
  state.incomingControlOffer = null;
}

const ctrlOfferAcceptBtn = document.getElementById('ctrl-offer-accept');
if (ctrlOfferAcceptBtn) {
  ctrlOfferAcceptBtn.addEventListener('click', () => {
    const offer = state.incomingControlOffer;
    closeCtrlOfferNote();
    if (!offer) return;
    broadcastTo(offer.peerId, { type: 'ctrl-offer-res', accepted: true, reqId: offer.reqId });
  });
}
const ctrlOfferDenyBtn = document.getElementById('ctrl-offer-deny');
if (ctrlOfferDenyBtn) {
  ctrlOfferDenyBtn.addEventListener('click', () => {
    const offer = state.incomingControlOffer;
    closeCtrlOfferNote();
    if (!offer) return;
    broadcastTo(offer.peerId, { type: 'ctrl-offer-res', accepted: false, reqId: offer.reqId, reason: 'denied' });
  });
}

function updateHostControlPill() {
  if (!state.controlledBy) return;
  const peer = state.peers.get(state.controlledBy);
  const name = peer ? displayName(state.controlledBy, peer.name) : 'Diğer kullanıcı';
  const text = document.getElementById('ctrl-pill-text');
  if (text) {
    text.textContent = state.controlOwner === 'remote'
      ? `${name} kontrol ediyor — tıklayarak geri alın`
      : `Kontrol sizde — ${name} siyah imleçle izliyor`;
  }
}

async function setHostControlOwner(owner, peerId, notifyPeer) {
  if (!state.controlledBy || state.controlledBy !== peerId) return;
  const requestedOwner = owner === 'remote' ? 'remote' : 'host';
  const result = await window.electronAPI.setControlOwner(requestedOwner);
  state.controlOwner = result && result.owner === 'remote' ? 'remote' : 'host';
  updateHostControlPill();
  if (notifyPeer) {
    broadcastTo(peerId, {
      type: 'ctrl-owner',
      owner: state.controlOwner,
      hostPoint: result && result.hostPoint ? result.hostPoint : null
    });
  }
}

// Kontrol edilen tarafın izni kapatması (pill'deki Durdur veya karşı tarafın revoke'u).
function stopBeingControlled(notifyPeer) {
  if (notifyPeer && state.controlledBy) {
    broadcastTo(state.controlledBy, { type: 'ctrl-revoke' });
  }
  state.controlledBy = null;
  state.controlOwner = 'host';
  state.remoteControlPointer = null;
  window.electronAPI.setRemoteControl(false);
  const pill = document.getElementById('ctrl-active-pill');
  if (pill) pill.classList.add('hidden');
}

document.getElementById('ctrl-pill-stop').addEventListener('click', () => stopBeingControlled(true));

// GÜVENLİK kill-switch'i: denetim aktifken Ctrl+X'e iki kez basılınca main süreç
// (globalShortcut, pencere odakta olmasa bile) denetimi zaten kapatmıştır; burada
// UI temizlenir ve karşı tarafa ctrl-revoke gönderilir.
if (window.electronAPI.onRemoteControlKilled) {
  window.electronAPI.onRemoteControlKilled(() => {
    if (state.controlledBy) {
      stopBeingControlled(true);
      showToast('Denetim, güvenlik kısayoluyla (Ctrl+X ×2) kapatıldı.', 'info');
    }
  });
}

if (window.electronAPI.onLocalControlTakeover) {
  window.electronAPI.onLocalControlTakeover((data) => {
    if (!state.controlledBy) return;
    state.controlOwner = 'host';
    updateHostControlPill();
    broadcastTo(state.controlledBy, {
      type: 'ctrl-owner',
      owner: 'host',
      hostPoint: data && data.hostPoint ? data.hostPoint : null
    });
  });
}

function closeActiveControlSession(notifyHost) {
  if (notifyHost && state.activeControl) {
    broadcastTo(state.activeControl.hostId, { type: 'ctrl-revoke' });
  }
  remoteOwnerConfirmed = false;
  setRemotePointerActive(false);
  setHostPassivePointer(null, false);
  document.getElementById('remote-modal').classList.add('hidden');
  const formerHost = state.activeControl ? state.activeControl.hostId : null;
  state.activeControl = null;
  window.electronAPI.setRemoteControl(false);
  if (formerHost) updateControlRequestButton(formerHost); // düğme "Denetle"ye döner
}

document.getElementById('remote-stop').addEventListener('click', () => {
  closeActiveControlSession(true);
});

const remoteVid = document.getElementById('remote-vid');
const remoteWrap = remoteVid.closest('.rwrap');
const remotePointer = document.getElementById('remote-pointer');
const remotePointerAvatar = document.getElementById('remote-pointer-avatar');
const remotePointerAvatarFallback = document.getElementById('remote-pointer-avatar-fallback');
const remoteControlState = document.getElementById('remote-control-state');
const remoteControlStateText = document.getElementById('remote-control-state-text');
const remoteControlHelp = document.getElementById('remote-control-help');
const hostPassivePointer = document.getElementById('host-passive-pointer');
let remotePointerActive = false;
let remoteOwnerConfirmed = false;
let pendingTakeoverPoint = null;
let lastRemotePoint = null;
const remotePressedButtons = new Set();
const remotePressedKeys = new Set();

function safeCursorAvatar(value) {
  if (typeof value !== 'string' || value.length > 2_000_000) return '';
  return /^(https?:\/\/|data:image\/)/i.test(value) ? value : '';
}

function setAuthorizedCursorProfile(name, avatar) {
  if (remotePointerAvatarFallback) {
    remotePointerAvatarFallback.textContent = String(name || 'K').trim().charAt(0).toLocaleUpperCase('tr-TR') || 'K';
  }
  if (!remotePointerAvatar) return;
  const safeAvatar = safeCursorAvatar(avatar);
  if (safeAvatar) remotePointerAvatar.src = safeAvatar;
  else remotePointerAvatar.removeAttribute('src');
}

if (remotePointerAvatar) {
  remotePointerAvatar.addEventListener('error', () => remotePointerAvatar.removeAttribute('src'));
}

function setRemotePointerActive(active) {
  const nextActive = Boolean(active && state.activeControl);
  if (remotePointerActive && !nextActive && state.activeControl) {
    if (lastRemotePoint) {
      remotePressedButtons.forEach(button => {
        sendCtrlEvent({ type: 'mouseup', x: lastRemotePoint.x, y: lastRemotePoint.y, button });
      });
    }
    remotePressedKeys.forEach(key => sendCtrlEvent({ type: 'keyup', key }));
  }
  remotePointerActive = nextActive;
  remotePressedButtons.clear();
  remotePressedKeys.clear();
  if (remotePointer) remotePointer.classList.toggle('active', remotePointerActive);
  if (remoteControlState) remoteControlState.classList.toggle('active', remotePointerActive);
  if (remoteControlStateText) {
    remoteControlStateText.textContent = remotePointerActive
      ? 'Kontrol sizde — bırakmak için ESC'
      : 'İzleme modu — kontrol için tıklayın';
  }
  if (remoteControlHelp) {
    remoteControlHelp.textContent = remotePointerActive
      ? 'Beyaz imleç uzaktaki bilgisayarı kontrol ediyor. İzleme moduna dönmek için ESC.'
      : 'Siyah imleci hareket ettirin. Kontrolü almak için ekrana tıklayın; bırakmak için ESC.';
  }
}

function normalizedPointToOverlay(point) {
  if (!point || !remoteVid.videoWidth || !remoteVid.videoHeight) return null;
  const rect = remoteVid.getBoundingClientRect();
  const scale = Math.min(rect.width / remoteVid.videoWidth, rect.height / remoteVid.videoHeight);
  const pictureWidth = remoteVid.videoWidth * scale;
  const pictureHeight = remoteVid.videoHeight * scale;
  const pictureLeft = rect.left + (rect.width - pictureWidth) / 2;
  const pictureTop = rect.top + (rect.height - pictureHeight) / 2;
  const wrapRect = remoteWrap.getBoundingClientRect();
  return {
    overlayX: pictureLeft - wrapRect.left + Math.max(0, Math.min(1, point.x)) * pictureWidth,
    overlayY: pictureTop - wrapRect.top + Math.max(0, Math.min(1, point.y)) * pictureHeight
  };
}

function setHostPassivePointer(point, visible) {
  if (!hostPassivePointer) return;
  const overlayPoint = normalizedPointToOverlay(point);
  if (!visible || !overlayPoint) {
    hostPassivePointer.classList.remove('visible');
    return;
  }
  hostPassivePointer.style.transform = `translate3d(${overlayPoint.overlayX - 3}px, ${overlayPoint.overlayY - 3}px, 0)`;
  hostPassivePointer.classList.add('visible');
}

// Return coordinates inside the actual video picture. object-fit: contain can add
// letterboxing, so the element's full rectangle can map to the wrong screen point.
function remoteVideoPoint(e) {
  const rect = remoteVid.getBoundingClientRect();
  const sourceWidth = remoteVid.videoWidth || rect.width;
  const sourceHeight = remoteVid.videoHeight || rect.height;
  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const pictureWidth = sourceWidth * scale;
  const pictureHeight = sourceHeight * scale;
  const pictureLeft = rect.left + (rect.width - pictureWidth) / 2;
  const pictureTop = rect.top + (rect.height - pictureHeight) / 2;
  const localX = e.clientX - pictureLeft;
  const localY = e.clientY - pictureTop;
  if (localX < 0 || localY < 0 || localX > pictureWidth || localY > pictureHeight) return null;
  const wrapRect = remoteWrap.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, localX / pictureWidth)),
    y: Math.max(0, Math.min(1, localY / pictureHeight)),
    overlayX: e.clientX - wrapRect.left,
    overlayY: e.clientY - wrapRect.top
  };
}

function positionRemotePointer(point) {
  if (!remotePointer || !point) return;
  lastRemotePoint = point;
  remotePointer.style.transform = `translate3d(${point.overlayX - 3}px, ${point.overlayY - 3}px, 0)`;
  remotePointer.classList.add('visible');
}

const sendRemoteMove = throttle(point => {
  if (!state.activeControl || !point) return;
  broadcastTo(state.activeControl.hostId, { type: 'ctrl-pointer', point: { x: point.x, y: point.y } });
  if (remotePointerActive && remoteOwnerConfirmed) {
    sendCtrlEvent({ type: 'mousemove', x: point.x, y: point.y });
  } else if (remotePointerActive) {
    pendingTakeoverPoint = { x: point.x, y: point.y };
  }
}, 16);

remoteVid.addEventListener('mouseenter', e => {
  const point = remoteVideoPoint(e);
  if (point) positionRemotePointer(point);
});
remoteVid.addEventListener('mouseleave', () => {
  if (remotePointer) remotePointer.classList.remove('visible');
});
remoteVid.addEventListener('mousemove', e => {
  const point = remoteVideoPoint(e);
  if (!point) {
    if (remotePointer) remotePointer.classList.remove('visible');
    return;
  }
  positionRemotePointer(point);
  sendRemoteMove(point);
});
remoteVid.addEventListener('mousedown', e => {
  const point = remoteVideoPoint(e);
  if (!remotePointerActive || !remoteOwnerConfirmed || !point) return;
  e.preventDefault();
  remotePressedButtons.add(e.button);
  sendCtrlEvent({ type: 'mousedown', x: point.x, y: point.y, button: e.button });
});
remoteVid.addEventListener('mouseup', e => {
  const point = remoteVideoPoint(e);
  if (!remotePointerActive || !remoteOwnerConfirmed || !point || !remotePressedButtons.has(e.button)) return;
  e.preventDefault();
  remotePressedButtons.delete(e.button);
  sendCtrlEvent({ type: 'mouseup', x: point.x, y: point.y, button: e.button });
});
document.addEventListener('mouseup', e => {
  if (!remotePointerActive || !remotePressedButtons.has(e.button) || !lastRemotePoint) return;
  remotePressedButtons.delete(e.button);
  sendCtrlEvent({ type: 'mouseup', x: lastRemotePoint.x, y: lastRemotePoint.y, button: e.button });
});
remoteVid.addEventListener('click', e => {
  if (remotePointerActive || e.button !== 0) return;
  const point = remoteVideoPoint(e);
  if (!point) return;
  e.preventDefault();
  // Activation only takes control; it must not click an app remotely. Moving
  // aligns the real white system cursor with the black preview cursor.
  pendingTakeoverPoint = { x: point.x, y: point.y };
  remoteOwnerConfirmed = false;
  setRemotePointerActive(true);
  broadcastTo(state.activeControl.hostId, { type: 'ctrl-takeover', point: pendingTakeoverPoint });
});
remoteVid.addEventListener('wheel', e => {
  e.preventDefault();
  if (remotePointerActive && remoteOwnerConfirmed) sendCtrlEvent({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY });
}, { passive: false });
remoteVid.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (document.activeElement && document.activeElement.tagName === 'WEBVIEW') return;
  if (e.key === 'Escape' && state.activeControl && remotePointerActive) {
    e.preventDefault();
    broadcastTo(state.activeControl.hostId, { type: 'ctrl-release' });
    remoteOwnerConfirmed = false;
    setRemotePointerActive(false);
    setHostPassivePointer(null, false);
    return;
  }
  if (state.activeControl && remotePointerActive && remoteOwnerConfirmed && !e.repeat) {
    e.preventDefault();
    remotePressedKeys.add(e.key);
    sendCtrlEvent({ type: 'keydown', key: e.key });
  }
});
document.addEventListener('keyup', e => {
  if (document.activeElement && document.activeElement.tagName === 'WEBVIEW') return;
  if (state.activeControl && remotePointerActive && remoteOwnerConfirmed) {
    e.preventDefault();
    remotePressedKeys.delete(e.key);
    sendCtrlEvent({ type: 'keyup', key: e.key });
  }
});

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

// Gelen sunucu davetini tam ekran modal yerine sağ altta bildirim kartı olarak gösterir.
// Aynı anda tek davet bildirimi durur; 15 sn içinde yanıtlanmazsa kendiliğinden kapanır.
let activeInviteToast = null;
function showServerInviteNotification(invite) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Önceki davet bildirimi hâlâ açıksa kaldır, yenisi onun yerine geçsin
  if (activeInviteToast) {
    clearTimeout(activeInviteToast.timeout);
    activeInviteToast.el.remove();
    activeInviteToast = null;
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast-info invite-toast';
  toast.innerHTML = `
    <div class="invite-toast-text"><b>${escapeHtml(invite.name || 'Arkadaşın')}</b> seni sunucusuna davet ediyor.</div>
    <div class="invite-toast-actions">
      <button class="btn-sec btn-sm invite-toast-deny">Reddet</button>
      <button class="btn-pri btn-sm invite-toast-accept">Katıl</button>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);

  const dismiss = () => {
    clearTimeout(entry.timeout);
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
    if (activeInviteToast && activeInviteToast.el === toast) activeInviteToast = null;
  };

  toast.querySelector('.invite-toast-accept').addEventListener('click', () => {
    dismiss();
    acceptServerInvite(invite);
  });
  toast.querySelector('.invite-toast-deny').addEventListener('click', dismiss);

  const entry = { el: toast, timeout: setTimeout(dismiss, 15000) };
  activeInviteToast = entry;
}

// Daveti kabul et: odadaysa çık, giriş formunu doldurup katıl butonunu tetikle
function acceptServerInvite(invite) {
  if (state.room) disconnectApp();

  document.getElementById('step-action').classList.add('hidden');
  document.querySelector('.login-card').classList.remove('expanded');

  const joinIdInput = document.getElementById('join-id');
  const joinPwInput = document.getElementById('join-password');
  const btnJoin = document.getElementById('btn-join');
  if (joinIdInput && btnJoin) {
    joinIdInput.value = invite.roomId;
    if (joinPwInput) joinPwInput.value = invite.password || '';
    btnJoin.click();
  }
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

  ['wb-card', 'wt-card', 'sb-card', 'uno-card', 'poll-card', 'lvs-card', 'wheel-card', 'poke-card'].forEach(id => {
    if (id === except) return;
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
    // exitFocus tam ekranı da bırakır ve kilidi sıfırlar — kilitli/tam ekran
    // karttaki eski donma senaryoları burada kendiliğinden çözülür.
    if (focusedCard && focusedCard.id === id) exitFocus();
  });

  // Her şey kapanıyorsa odakta kalan başka ne varsa (ör. video kartı) onu da
  // bırak. Eski sistem burada kartı gizli #focus-area içinde yetim bırakıp
  // ekran paylaşımı kartını kaybediyordu; v2'de kart zaten #grid'de kalır.
  if (!except && focusedCard) exitFocus();

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
    state.uno.host = null;
    state.uno.started = false;
    state.uno.joinedActivity = false;
    state.uno.players = [];
    state.uno.hand = [];
    state.uno.hands = {};
    state.uno.winnerId = null;
    const g = document.getElementById('uno-game'); if (g) g.classList.add('hidden');
    const ov = document.getElementById('uno-over'); if (ov) ov.classList.add('hidden');
    const lb = document.getElementById('uno-lobby'); if (lb) lb.classList.remove('hidden');
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
  fileBuffer.clear();
  state.incomingDMFiles = {};
  
  const grid = document.getElementById('grid');
  // Beyaz Tahta da kapanır ve içeriği silinir: eskiden açık bırakılıyordu ve
  // bir sonraki odaya girildiğinde önceki odanın çizimleri wb2-sync ile
  // karşı tarafa gidiyordu.
  document.querySelectorAll('.vcard').forEach(el => el.classList.add('hidden'));
  if (typeof window.whiteboardReset === 'function') window.whiteboardReset();
  if (!document.getElementById('empty-state')) {
    const empty = document.createElement('div');
    empty.id = 'empty-state';
    empty.className = 'empty';
    empty.innerHTML = `<h2><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;"><circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49"></path><path d="M7.76 16.24a6 6 0 0 1 0-8.49"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M4.93 19.07a10 10 0 0 1 0-14.14"></path></svg> <span data-i18n="room.waiting">${escapeHtml(t('room.waiting'))}</span></h2><p data-i18n="room.waitingDesc">${escapeHtml(t('room.waitingDesc'))}</p>`;
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
  // Sesli oturum bitti: güç tasarrufu engeli ve yükseltilmiş süreç önceliği
  // kaldırılsın (boştayken pil/CPU tüketimini artırmasın).
  setVoiceSessionActive(false);
  state.pendingJoinReq = null;
  state.joinAcceptanceRoom = null;
  clearInterval(joinReqRetryTimer);
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
  
  document.getElementById('fbtn').addEventListener('click', event => {
    if (typeof window.openDMAttachmentMenu === 'function') window.openDMAttachmentMenu(event.currentTarget, 'finput', 'room');
    else document.getElementById('finput').click();
  });
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
  if (!file || file.size > MAX_ROOM_FILE_SIZE) {
    showToast('Dosya boyutu izin verilen sınırı aşıyor.', 'warn');
    return;
  }
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
      const header = new TextEncoder().encode(JSON.stringify({ id: fileId, fromId: state.myId }) + '|');
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
      const header = new TextEncoder().encode(JSON.stringify({ id: fileId, fromId: state.myId }) + '|');
      const msgBuf = new Uint8Array(header.length + chunk.length);
      msgBuf.set(header);
      msgBuf.set(chunk, header.length);

      try {
        // QoS 1: DM medya transferindeki aynı sessiz-chunk-kaybı riskini taşıyor.
        mqttClient.publish(`teamsync/room/${state.room}/file`, msgBuf, { qos: 1 });
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
    window.registerChatMedia?.(url, file, file.name);
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
  if (typeof initVampireVillager === 'function') initVampireVillager();
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
    const originalContent = m.content;
    const originalFileName = m.fileName;
    
    if (m.isCensored) {
       contentHtml = `<span style="color: #f87171; font-style: italic; font-weight: 500; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.2); display: inline-flex; align-items: center; gap: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg> Sansürlendi</span>`;
    } else if (m.expired) {
      // saveDMs kota budaması içeriği düşürmüş: kırık <img> yerine bilgi ver
      contentHtml = `<span style="color: #94a3b8; font-style: italic;">${escapeHtml(m.fileName || 'Dosya')} — eski dosya, yer açmak için kaldırıldı</span>`;
    } else if (m.type === 'image') {
      m.content = escapeHtml(safeMediaUrl(m.content, 'image'));
      m.fileName = escapeHtml(safeFileName(m.fileName || 'Gorsel'));
      // data-media-name: "Koleksiyona ekle" dosyayı özgün adıyla kaydetsin.
      contentHtml = `<img src="${m.content}" alt="${escapeHtml(m.fileName || 'Görsel')}" data-media-name="${escapeHtml(m.fileName || '')}" />`;
    } else if (m.type === 'video') {
      m.content = escapeHtml(safeMediaUrl(m.content, 'video'));
      m.fileName = escapeHtml(safeFileName(m.fileName || 'Video'));
      contentHtml = `<video src="${m.content}" controls playsinline preload="metadata" aria-label="${escapeHtml(m.fileName || 'Video')}" data-media-name="${escapeHtml(m.fileName || '')}"></video>`;
    } else if (m.type === 'file') {
      m.content = escapeHtml(safeMediaUrl(m.content, 'file'));
      m.fileName = escapeHtml(safeFileName(m.fileName || 'dosya'));
      contentHtml = `<a href="${m.content}" download="${m.fileName || 'dosya'}" style="color: #60a5fa; text-decoration: underline;">📁 ${escapeHtml(m.fileName || 'Dosya')} İndir</a>`;
    }

    m.content = originalContent;
    m.fileName = originalFileName;
    if (m.isCensored) contentHtml = censoredTextHtml(m.content);
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
  // Çevrimdışı arkadaşlar da listelenir: eski mesajlara bakmak ya da yeni
  // mesaj yazmak (karşı taraf tekrar bağlandığında iletilir) için filtrelemeye
  // gerek yok; sadece durumu online/offline noktasıyla ayırt ediyoruz.
  const friendIds = Object.keys(state.friends);

  if (friendIds.length === 0) {
    list.innerHTML = '<li class="muted" style="text-align: center; padding: 16px;">Henüz arkadaşın yok.</li>';
    return;
  }

  friendIds
    .sort((a, b) => (state.friends[b].online ? 1 : 0) - (state.friends[a].online ? 1 : 0))
    .forEach(fId => {
      const f = state.friends[fId];
      const isActive = state.activeDM === fId;
      const isOnline = !!f.online;
      const li = document.createElement('li');
      li.className = `server-dm-friend${isActive ? ' active' : ''}${isOnline ? '' : ' offline'}`;
      li.innerHTML = `<div class="friend-status ${isOnline ? 'online' : ''}"></div> <b>${escapeHtml(f.name)}</b>`;
      li.onmouseover = () => { if (!isActive) li.classList.add('hover'); };
      li.onmouseout = () => { if (!isActive) li.classList.remove('hover'); };
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
  let textToSend = res.ok ? text : (res.text || '');
  let isCensored = !res.ok;

  if (!res.ok) {
     showToast(res.warning, 'danger');
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
    fromName: state.myName, // alıcı bizi arkadaş listesinde tanımıyorsa isim buradan gelir
    msgType: 'text',
    content: textToSend,
    isCensored: isCensored
  }));
};

window.sendDMFile = async (file) => {
  if (!state.activeDM || !state.globalMqtt || !state.globalMqtt.connected) {
    showToast(t('dm.notConnected'), 'warn');
    return false;
  }
  const friendId = state.activeDM;
  
  if (file.size > MAX_DM_FILE_SIZE) {
    showToast(t('dm.fileTooLarge'), 'warn');
    return false;
  }

  let base64Data;
  try {
    base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(event.target.result);
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(file);
    });
  } catch (error) {
    console.error('DM file read error:', error);
    return false;
  }

  const isImage = isImageFile(file.name, file.type);
  const isVideo = isVideoFile(file.name, file.type);
  const msgType = isImage ? 'image' : (isVideo ? 'video' : 'file');

  if (!state.dms[friendId]) state.dms[friendId] = [];
  state.dms[friendId].push({ sender: 'me', type: msgType, content: base64Data, fileName: file.name, timestamp: Date.now() });
  saveDMs();
  renderDMs();

  // Fotoğraf/GIF/video kalıcı olarak kullanıcının kendi cihazında tutulur.
  // Büyük base64 içeriğini Supabase'e yüklemiyoruz.

  const dmChunkSize = 60000;
  const totalChunks = Math.ceil(base64Data.length / dmChunkSize);
  const fileId = crypto.randomUUID();

  // QoS 1 (en az bir kez teslim): dosya/GIF transferi onlarca-yüzlerce chunk'a
  // bölünüyor, varsayılan QoS 0'da tek bir chunk'ın broker'da sessizce
  // düşmesi (özellikle büyük GIF'lerde chunk sayısı arttıkça daha olası)
  // transferi hiçbir hata göstermeden tamamlanamaz bırakıyor ve karşı taraf
  // medyayı asla görmüyordu (bkz. 2dk'lık sessiz temizleme, aşağıda).
  state.globalMqtt.publish(`teamsync/user/${friendId}/events`, JSON.stringify({
    type: 'dm_file_start',
    fromId: state.friendId,
    fromName: state.myName,
    fileId,
    msgType,
    fileName: file.name,
    totalChunks
  }), { qos: 1 });

  for (let i = 0; i < totalChunks; i++) {
    const chunk = base64Data.substr(i * dmChunkSize, dmChunkSize);
    state.globalMqtt.publish(`teamsync/user/${friendId}/events`, JSON.stringify({
      type: 'dm_file_chunk',
      fromId: state.friendId,
      fileId,
      chunkIndex: i,
      data: chunk
    }), { qos: 1 });
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  return true;
};

state.incomingDMFiles = {};

window.receiveDM = async (fromId, data) => {
  if (typeof fromId !== 'string' || fromId.length > 128 || !data || typeof data !== 'object') return;
  if (!state.dms[fromId]) state.dms[fromId] = [];

  // Sunucudan (arkadaş olmayan birinden) gelen DM: gönderen listede yoksa
  // geçici bir kayıt aç ki mesaj görünür ve yanıtlanabilir olsun.
  if (!state.friends[fromId] && data.fromName) {
    state.friends[fromId] = { name: data.fromName, online: true, temporary: true };
    if (typeof renderFriends === 'function') renderFriends();
    if (typeof renderServerDMFriends === 'function') renderServerDMFriends();
  }

  if (data.type === 'dm_msg') {
    if (!['text', 'image', 'video', 'file'].includes(data.msgType) || typeof data.content !== 'string' || data.content.length > (data.msgType === 'text' ? 20_000 : 30 * 1024 * 1024)) return;
    let isCensored = data.isCensored || false;
    let safeContent = data.content;
    if (!isCensored && data.content) {
       const res = await checkTextWithAI(data.content);
       if (!res.ok) {
         isCensored = true;
         safeContent = res.text || '';
       }
    }
    
    pushDmMessage(fromId, { sender: 'them', type: data.msgType, content: safeContent, isCensored: isCensored, timestamp: Date.now() });
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
          icerik: safeContent,
          is_censored: isCensored
        }
      ]).then(({ error }) => {
        if (error) console.error('Supabase DM receive error:', error);
      });
    }
  }
  else if (data.type === 'dm_file_start') {
    const maxChunks = Math.ceil(MAX_DM_FILE_SIZE * 1.4 / 60000);
    const pendingDmBytes = Object.values(state.incomingDMFiles).reduce((sum, file) =>
      sum + (file.totalChunks || 0) * 60000, 0);
    if (typeof data.fileId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(data.fileId)
      || data.fromId !== fromId || !['image', 'video', 'file'].includes(data.msgType)
      || typeof data.fileName !== 'string' || data.fileName.length === 0 || data.fileName.length > 255
      || !Number.isInteger(data.totalChunks) || data.totalChunks < 1 || data.totalChunks > maxChunks
      || Object.keys(state.incomingDMFiles).length >= 4
      || pendingDmBytes + data.totalChunks * 60000 > MAX_PENDING_DM_BYTES) return;
    state.incomingDMFiles[data.fileId] = {
      fromId: data.fromId,
      msgType: data.msgType,
      fileName: safeFileName(data.fileName),
      totalChunks: data.totalChunks,
      chunks: [],
      receivedChunks: 0,
      lastChunkAt: Date.now()
    };
  }
  else if (data.type === 'dm_file_chunk') {
    const fileData = state.incomingDMFiles[data.fileId];
    if (fileData && data.fromId === fromId && Number.isInteger(data.chunkIndex)
      && data.chunkIndex >= 0 && data.chunkIndex < fileData.totalChunks
      && typeof data.data === 'string' && data.data.length > 0 && data.data.length <= 90_000) {
      fileData.lastChunkAt = Date.now();
      if (!fileData.chunks[data.chunkIndex]) {
        fileData.chunks[data.chunkIndex] = data.data;
        fileData.receivedChunks++;
      }
      if (fileData.receivedChunks === fileData.totalChunks) {
        const fullBase64 = fileData.chunks.join('');
        state.dms[fromId].push({ sender: 'them', type: fileData.msgType, content: fullBase64, fileName: fileData.fileName, timestamp: Date.now() });
        saveDMs();
        delete state.incomingDMFiles[data.fileId];
        
        if (state.activeDM === fromId) renderDMs();
        else showToast(`${state.friends[fromId]?.name || 'Biri'} sana bir dosya gönderdi.`, 'info');

        // Gelen medya da bulut veritabanına kopyalanmaz; yalnızca bu cihazdaki
        // sohbet durumu ve yerel kütüphane kullanılır.
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

  addEvt('dm-btn-file', 'click', event => window.openDMAttachmentMenu?.(event.currentTarget, 'dm-file-input'));
  addEvt('dm-file-input', 'change', async (e) => {
    if (e.target.files.length) await sendDMFile(e.target.files[0]);
    e.target.value = '';
  });

  addEvt('server-dm-btn-file', 'click', event => window.openDMAttachmentMenu?.(event.currentTarget, 'server-dm-file-input'));
  addEvt('server-dm-file-input', 'change', async (e) => {
    if (e.target.files.length) await sendDMFile(e.target.files[0]);
    e.target.value = '';
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
  const activities = ['wt', 'uno', 'sb', 'poll', 'lvs', 'wheel', 'poke', 'vampire'];
  const activitySearch = document.getElementById('activity-search');
  if (activitySearch) {
    activitySearch.addEventListener('input', () => filterActivityCards(activitySearch.value));
  }
  document.querySelectorAll('[data-activity-shortcut]').forEach(shortcut => {
    shortcut.addEventListener('click', () => {
      const card = document.getElementById(`card-act-${shortcut.dataset.activityShortcut}`);
      if (card) card.click();
    });
  });
  activities.forEach(act => {
    const card = document.getElementById(`card-act-${act}`);
    if (card) {
      card.addEventListener('click', () => {
        state.selectedLobbyActivity = act;
        
        // Show Lobbies Panel, Hide Activities List Panel
        document.getElementById('act-list-card').classList.add('hidden');
        document.getElementById('act-lobby-card').classList.remove('hidden');
        
        // Update Title
        const names = { uno: 'UNO', sb: 'Ortak Tarayıcı', poll: 'Hızlı Anket', lvs: 'Video Oynatıcı', wheel: 'Şans Çarkı', poke: 'PokeSavaş', vampire: 'Vampir Köylü' };
        document.getElementById('act-lobby-title').textContent = `${names[act]} Lobileri`;
        
        renderLobbiesList(act);
      });
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        card.click();
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
        const names = { uno: 'UNO', sb: 'Ortak Tarayıcı', poll: 'Hızlı Anket', lvs: 'Video Oynatıcı', wheel: 'Şans Çarkı', poke: 'PokeSavaş', vampire: 'Vampir Köylü' };
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
    const names = { uno: 'UNO', sb: 'Ortak Tarayıcı', poll: 'Hızlı Anket', lvs: 'Video Oynatıcı', wheel: 'Şans Çarkı', poke: 'PokeSavaş', vampire: 'Vampir Köylü' };
    const newLobby = {
      id: `LOB-${crypto.randomUUID()}`,
      activity: act,
      name: state.sfwMode
        ? censorProfaneText(`${state.myName}'in ${names[act]} Lobisi`)
        : `${state.myName}'in ${names[act]} Lobisi`,
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
    poke: { l: 0, p: 0 },
    vampire: { l: 0, p: 0 }
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
    
    const maxPlayers = 10;
    const playerCount = lob.players.length;
    const specCount = lob.spectators.length;
    
    const lobbyName = state.sfwMode ? censorProfaneText(lob.name || '') : (lob.name || '');
    const lobbyHostName = state.sfwMode ? censorProfaneText(lob.hostName || '') : (lob.hostName || '');
    const infoText = `Kurucu: ${escapeHtml(lobbyHostName)} • Oyuncular: ${playerCount}/${maxPlayers} ${specCount > 0 ? `(${specCount} İzleyici)` : ''}`;
    const statusText = lob.status === 'playing' ? '🎮 Devam Ediyor' : '⌛ Bekliyor';
    const statusColor = lob.status === 'playing' ? '#f59e0b' : 'var(--ok)';

    row.innerHTML = `
      <div>
        <div style="font-weight:bold; color:#fff;">${escapeHtml(lobbyName)}</div>
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
    if (lob.activity === 'vampire' && typeof window.vampireVillagerLeave === 'function') {
      window.vampireVillagerLeave();
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
  const pollNew = document.getElementById('poll-new');
  if (pollSetup && isSpec) pollSetup.classList.add('hidden');
  if (isSpec) {
    if (pollEnd) pollEnd.classList.add('hidden');
    if (pollNew) pollNew.classList.add('hidden');
  } else if (typeof window.syncPollHostControls === 'function') {
    window.syncPollHostControls();
  }
  const pollContainer = document.getElementById('poll-opts-container');
  if (pollContainer) pollContainer.style.pointerEvents = isSpec ? 'none' : 'auto';
  
  // Lucky Wheel
  const wheelSetup = document.getElementById('wheel-setup');
  const wheelSpin = document.getElementById('wheel-spin-btn');
  const wheelSpinAgain = document.getElementById('wheel-spin-again');
  const wheelReset = document.getElementById('wheel-reset-btn');
  if (wheelSetup && isSpec) wheelSetup.classList.add('hidden');
  if (wheelSpin) wheelSpin.classList.toggle('hidden', isSpec);
  if (wheelSpinAgain) wheelSpinAgain.classList.toggle('hidden', isSpec);
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

// İzleyici kilitlerini sürekli zorla.
// ESKİ: koşulsuz her 300 ms. Ölçüm: çağrı başına 0.15 ms ve ~25 getElementById
// + ~20 classList/style yazımı; 2300 düğümlü DOM'da saniyede 3.3 kez stil
// yeniden hesabı — kullanıcı hiçbir etkinliğe girmemiş olsa bile.
// YENİ: yalnızca bir etkinlik/lobi aktifken koş (zaten kilitlenecek bir şey
// ancak o zaman var). Lobiden çıkışta kilitleri kaldırmak için bir kez daha
// koşar, sonra tamamen susar. Pencere ön planda değilken de gereksiz.
let _specEnforceWasActive = false;
setInterval(() => {
  const active = !!state.activeLobbyId;
  if (!active && !_specEnforceWasActive) return; // aktivite yok: hiçbir iş yapma
  const runOnceMore = !active && _specEnforceWasActive;
  _specEnforceWasActive = active;
  if (!runOnceMore && state.uiActive === false) return; // arka planda çizmeye gerek yok
  window.checkSpectatorUI();
}, 500);



/* ===========================================================================
   SOHBET GÖRSEL ÖNİZLEME (LIGHTBOX)

   Kapsanan yollar:
   - Oda sohbeti: appendFileMsg() sonrası oluşan `.img-wrap > img.chat-img`
     (hem 'file-done' ile gelen hem de sendFile() ile giden görseller).
   - DM'ler: renderDMs() içindeki `.dm-msg img` (ana menü #dm-messages ve
     sunucu içi #server-dm-messages).

   Dinleyici, olay devri (event delegation) ile document üzerinde durur;
   sohbet listeleri innerHTML ile sürekli yeniden çizildiği için her görsele
   tek tek handler bağlamak güvenilir olmaz.
   =========================================================================== */

// Lightbox'ı açan görseller. Oda sohbetinde .chat-img sınıfı garanti;
// DM baloncuklarındaki <img>'lerin sınıfı yok, kapsayıcıdan yakalanır.
const LB_IMG_SELECTOR = 'img.chat-img, .dm-msg img';
// Ok tuşlarıyla gezilecek "aynı mesaj listesi"nin sınırı.
const LB_LIST_SELECTOR = '#msgs, #dm-messages, #server-dm-messages';
const LB_MIN_SCALE = 0.05;
const LB_MAX_SCALE = 24;
const LB_WHEEL_STEP = 1.0015; // deltaY başına çarpan (satır/sayfa modu normalize edilir)
const LB_BTN_STEP = 1.25;

const lb = {
  wired: false,
  open: false,
  root: null, stage: null, img: null,
  nameEl: null, counterEl: null, pctEl: null, fitEl: null,
  prevBtn: null, nextBtn: null, dlBtn: null,
  items: [], index: -1,
  scale: 1, fitScale: 1, rot: 0, tx: 0, ty: 0,
  natW: 0, natH: 0,
  dragging: false, moved: false, pointerId: null,
  dragX: 0, dragY: 0, dragTx: 0, dragTy: 0,
  lastFocus: null
};

function lbEnsure() {
  if (!lb.root) {
    lb.root = document.getElementById('img-lightbox');
    if (!lb.root) return false;
    lb.stage = document.getElementById('ilb-stage');
    lb.img = document.getElementById('ilb-img');
    lb.nameEl = document.getElementById('ilb-name');
    lb.counterEl = document.getElementById('ilb-counter');
    lb.pctEl = document.getElementById('ilb-zoom-pct');
    lb.fitEl = document.getElementById('ilb-fit-state');
    lb.prevBtn = document.getElementById('ilb-prev');
    lb.nextBtn = document.getElementById('ilb-next');
    lb.dlBtn = document.getElementById('ilb-download');
  }
  if (!lb.root || !lb.stage || !lb.img) return false;
  if (lb.wired) return true;
  lb.wired = true;

  // Boşluğa tıklayınca kapanır. Sürükleme sonrası gelen click yutulur.
  lb.root.addEventListener('click', (e) => {
    if (lb.moved) { lb.moved = false; return; }
    if (e.target === lb.root || e.target === lb.stage) lbClose();
  });
  lb.img.addEventListener('click', (e) => e.stopPropagation());
  lb.img.addEventListener('dblclick', (e) => {
    e.preventDefault();
    lbToggleActualSize(e.clientX, e.clientY);
  });
  lb.stage.addEventListener('dblclick', (e) => {
    if (e.target === lb.img) return;
    e.preventDefault();
    lbToggleActualSize(e.clientX, e.clientY);
  });

  // Fare tekerleği: imleç konumunu sabit tutarak yakınlaştırır.
  lb.stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;       // satır
    else if (e.deltaMode === 2) delta *= 400; // sayfa
    const factor = Math.pow(LB_WHEEL_STEP, -delta);
    lbZoomTo(lb.scale * factor, e.clientX, e.clientY, false);
  }, { passive: false });

  // Sürükleyerek gezinme (pan).
  lb.img.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    lb.dragging = true;
    lb.moved = false;
    lb.pointerId = e.pointerId;
    lb.dragX = e.clientX; lb.dragY = e.clientY;
    lb.dragTx = lb.tx; lb.dragTy = lb.ty;
    lb.img.classList.remove('ilb-anim');
    lb.img.classList.add('ilb-grabbing');
    try { lb.img.setPointerCapture(e.pointerId); } catch (err) {}
  });
  lb.img.addEventListener('pointermove', (e) => {
    if (!lb.dragging || e.pointerId !== lb.pointerId) return;
    const dx = e.clientX - lb.dragX;
    const dy = e.clientY - lb.dragY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) lb.moved = true;
    lb.tx = lb.dragTx + dx;
    lb.ty = lb.dragTy + dy;
    lbApply();
  });
  const endDrag = (e) => {
    if (!lb.dragging || (e && e.pointerId !== lb.pointerId)) return;
    lb.dragging = false;
    lb.pointerId = null;
    lb.img.classList.remove('ilb-grabbing');
    try { if (e) lb.img.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  lb.img.addEventListener('pointerup', endDrag);
  lb.img.addEventListener('pointercancel', endDrag);

  const bind = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handler(e); });
  };
  bind('ilb-close', () => lbClose());
  bind('ilb-prev', () => lbStep(-1));
  bind('ilb-next', () => lbStep(1));
  bind('ilb-zoom-in', () => lbZoomTo(lb.scale * LB_BTN_STEP, null, null, true));
  bind('ilb-zoom-out', () => lbZoomTo(lb.scale / LB_BTN_STEP, null, null, true));
  bind('ilb-zoom-label', () => lbToggleActualSize(null, null));
  bind('ilb-rotate-left', () => lbRotate(-90));
  bind('ilb-rotate-right', () => lbRotate(90));
  bind('ilb-copy', () => lbCopyImage());
  // İndirme, sohbetteki .dl-btn ile aynı mekanizmadır: <a download> + blob/data
  // URL. preventDefault edilmemeli, bu yüzden bind() kullanılmaz.
  if (lb.dlBtn) lb.dlBtn.addEventListener('click', (e) => e.stopPropagation());

  lb.img.addEventListener('load', () => {
    lb.natW = lb.img.naturalWidth || 1;
    lb.natH = lb.img.naturalHeight || 1;
    lbFit(false);
  });

  window.addEventListener('resize', () => { if (lb.open) lbFit(false); });
  return true;
}

function lbStageSize() {
  const r = lb.stage.getBoundingClientRect();
  return {
    w: r.width || window.innerWidth,
    h: r.height || window.innerHeight,
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2
  };
}

// Döndürme sonrası ekranda kapladığı kutu (0/90/180/270 için basit takas).
function lbRotatedSize() {
  const swapped = (Math.abs(lb.rot) % 180) === 90;
  return swapped ? { w: lb.natH, h: lb.natW } : { w: lb.natW, h: lb.natH };
}

function lbComputeFitScale() {
  const s = lbStageSize();
  const r = lbRotatedSize();
  if (!r.w || !r.h) return 1;
  // Üst/alt çubuklar ve yan oklar görseli örtmesin diye pay bırakılır.
  const padX = Math.min(120, s.w * 0.22);
  const padY = Math.min(150, s.h * 0.28);
  const availW = Math.max(80, s.w - padX);
  const availH = Math.max(80, s.h - padY);
  // Küçük görseller büyütülmez: "sığdır" en fazla gerçek boyuta kadar çıkar.
  return Math.max(LB_MIN_SCALE, Math.min(1, availW / r.w, availH / r.h));
}

function lbClamp() {
  const s = lbStageSize();
  const r = lbRotatedSize();
  const limX = Math.max(0, (r.w * lb.scale) / 2 - s.w / 2);
  const limY = Math.max(0, (r.h * lb.scale) / 2 - s.h / 2);
  lb.tx = limX === 0 ? 0 : Math.max(-limX, Math.min(limX, lb.tx));
  lb.ty = limY === 0 ? 0 : Math.max(-limY, Math.min(limY, lb.ty));
}

function lbApply() {
  lbClamp();
  lb.img.style.transform = 'translate(' + lb.tx + 'px, ' + lb.ty + 'px) rotate(' + lb.rot + 'deg) scale(' + lb.scale + ')';
  lb.img.classList.toggle('ilb-pannable', lb.scale > lb.fitScale + 0.001);
  lbUpdateUI();
}

function lbUpdateUI() {
  if (lb.pctEl) lb.pctEl.textContent = Math.round(lb.scale * 100) + '%';
  if (lb.fitEl) {
    // Gösterge MEVCUT durumu söyler: %100'de "Gerçek Boyut", sığdırıldığında
    // "Sığdır", serbest bir yakınlaştırmada boş kalır.
    const atActual = Math.abs(lb.scale - 1) < 0.005;
    const atFit = Math.abs(lb.scale - lb.fitScale) < 0.005;
    lb.fitEl.textContent = atActual ? t('viewer.actualSize') : (atFit ? t('viewer.fit') : '');
  }
}

function lbFit(animate) {
  lb.fitScale = lbComputeFitScale();
  lb.scale = lb.fitScale;
  lb.tx = 0;
  lb.ty = 0;
  lb.img.classList.toggle('ilb-anim', !!animate);
  lbApply();
}

// Yakınlaştırma. anchorX/anchorY verilirse o ekran noktası sabit kalır.
// Döndürme matrisi hesapta sadeleştiği için formül açıdan bağımsızdır.
function lbZoomTo(nextScale, anchorX, anchorY, animate) {
  const clamped = Math.max(LB_MIN_SCALE, Math.min(LB_MAX_SCALE, nextScale));
  if (Math.abs(clamped - lb.scale) < 1e-6) return;
  const s = lbStageSize();
  const ax = (anchorX == null) ? s.cx : anchorX;
  const ay = (anchorY == null) ? s.cy : anchorY;
  const k = clamped / lb.scale;
  lb.tx = (ax - s.cx) - k * ((ax - s.cx) - lb.tx);
  lb.ty = (ay - s.cy) - k * ((ay - s.cy) - lb.ty);
  lb.scale = clamped;
  lb.img.classList.toggle('ilb-anim', !!animate);
  lbApply();
}

// Çift tıklama / gösterge düğmesi: %100 <-> sığdır.
// Küçük görsellerde "sığdır" zaten %100 olduğundan geçişin görünür bir etkisi
// olsun diye o durumda %200'e çıkılır.
function lbToggleActualSize(anchorX, anchorY) {
  const atFit = Math.abs(lb.scale - lb.fitScale) < 0.005;
  if (!atFit) { lbFit(true); return; }
  const target = Math.abs(lb.fitScale - 1) < 0.005 ? 2 : 1;
  lbZoomTo(target, anchorX, anchorY, true);
}

function lbRotate(deg) {
  lb.rot = (((lb.rot + deg) % 360) + 360) % 360;
  lbFit(true);
}

// Görselin indirilebilir adı ve kaynağı. Oda sohbetinde zaten var olan
// .dl-btn bağlantısı yeniden kullanılır (doğru dosya adı oradadır).
function lbSourceInfo(el) {
  const wrap = el.closest('.img-wrap');
  const anchor = wrap ? wrap.querySelector('a.dl-btn[download]') : null;
  const name = (anchor && anchor.getAttribute('download')) || el.getAttribute('alt') || 'gorsel.png';
  const href = (anchor && anchor.getAttribute('href')) || el.currentSrc || el.src;
  return { name: name, href: href };
}

function lbShow(index, animate) {
  if (!lb.items.length) return;
  lb.index = Math.max(0, Math.min(lb.items.length - 1, index));
  const source = lb.items[lb.index];
  const info = lbSourceInfo(source);
  lb.rot = 0;
  lb.natW = 0;
  lb.natH = 0;
  lb.img.classList.remove('ilb-anim');
  lb.img.style.transform = 'translate(0px, 0px) rotate(0deg) scale(1)';
  lb.img.alt = info.name;
  lb.img.src = info.href;
  if (lb.nameEl) lb.nameEl.textContent = info.name;
  if (lb.counterEl) lb.counterEl.textContent = lb.items.length > 1 ? (lb.index + 1) + ' / ' + lb.items.length : '';
  if (lb.dlBtn) {
    lb.dlBtn.href = info.href;
    lb.dlBtn.setAttribute('download', info.name);
  }
  const many = lb.items.length > 1;
  if (lb.prevBtn) lb.prevBtn.classList.toggle('hidden', !many);
  if (lb.nextBtn) lb.nextBtn.classList.toggle('hidden', !many);
  // Önbellekten gelen görselde 'load' tetiklenmeyebilir.
  if (lb.img.complete && lb.img.naturalWidth) {
    lb.natW = lb.img.naturalWidth;
    lb.natH = lb.img.naturalHeight;
    lbFit(!!animate);
  }
}

function lbStep(dir) {
  if (lb.items.length < 2) return;
  const next = (lb.index + dir + lb.items.length) % lb.items.length;
  lbShow(next, false);
}

async function lbCopyImage() {
  // CSP connect-src blob:/data: içermediği için fetch() kullanılamaz; görsel
  // canvas üzerinden PNG'ye çevrilir (pano yalnızca PNG kabul eder).
  try {
    if (!lb.img || !lb.img.naturalWidth) throw new Error('image not ready');
    const canvas = document.createElement('canvas');
    canvas.width = lb.img.naturalWidth;
    canvas.height = lb.img.naturalHeight;
    canvas.getContext('2d').drawImage(lb.img, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast(t('viewer.copied'), 'ok');
  } catch (err) {
    console.warn('Lightbox kopyalama başarısız:', err);
    showToast(t('viewer.copyFailed'), 'danger');
  }
}

function lbKeyHandler(e) {
  if (!lb.open) return;
  let handled = true;
  switch (e.key) {
    case 'Escape': lbClose(); break;
    case 'ArrowLeft': lbStep(-1); break;
    case 'ArrowRight': lbStep(1); break;
    case '+': case '=': lbZoomTo(lb.scale * LB_BTN_STEP, null, null, true); break;
    case '-': case '_': lbZoomTo(lb.scale / LB_BTN_STEP, null, null, true); break;
    case '0': lbFit(true); break;
    case '1': lbZoomTo(1, null, null, true); break;
    case 'r': case 'R': lbRotate(e.shiftKey ? -90 : 90); break;
    default: handled = false;
  }
  if (!handled) return;
  // Uygulamanın genel kısayolları (M/D/S/W/E/R, Escape ile odak/modal kapatma,
  // uzak denetim tuş aktarımı) bu tuşları görmemeli.
  e.preventDefault();
  e.stopPropagation();
}

function openImageLightbox(imgEl) {
  if (!imgEl || !lbEnsure()) return;
  const list = imgEl.closest(LB_LIST_SELECTOR);
  const scope = list || imgEl.parentElement || document.body;
  const found = Array.from(scope.querySelectorAll(LB_IMG_SELECTOR));
  lb.items = found.length ? found : [imgEl];
  const at = lb.items.indexOf(imgEl);
  lb.lastFocus = document.activeElement;
  lb.open = true;
  lb.root.classList.remove('hidden');
  lb.root.setAttribute('aria-hidden', 'false');
  lb.root.setAttribute('aria-label', t('viewer.title'));
  document.addEventListener('keydown', lbKeyHandler, true);
  lbShow(at < 0 ? 0 : at, false);
  const closeBtn = document.getElementById('ilb-close');
  if (closeBtn) closeBtn.focus({ preventScroll: true });
}

function lbClose() {
  if (!lb.root) return;
  lb.open = false;
  lb.dragging = false;
  lb.root.classList.add('hidden');
  lb.root.setAttribute('aria-hidden', 'true');
  document.removeEventListener('keydown', lbKeyHandler, true);
  // Kaynak görsel listede kalmaya devam eder; burada yalnızca büyük çözülmüş
  // görüntü bellekten düşürülür (blob URL'i revoke EDİLMEZ).
  lb.img.removeAttribute('src');
  lb.items = [];
  lb.index = -1;
  if (lb.lastFocus && document.contains(lb.lastFocus)) {
    try { lb.lastFocus.focus({ preventScroll: true }); } catch (err) {}
  }
  lb.lastFocus = null;
}

window.openImageLightbox = openImageLightbox;
window.closeImageLightbox = lbClose;

// Sohbet listeleri innerHTML ile yeniden çizildiği için olay devri kullanılır.
document.addEventListener('click', (e) => {
  const target = e.target;
  if (!target || target.tagName !== 'IMG') return;
  if (target.closest('#img-lightbox')) return;
  if (!target.matches(LB_IMG_SELECTOR)) return;
  e.preventDefault();
  openImageLightbox(target);
});

/* ===========================================================================
 * KISAYOL MERKEZİ — Ayarlar → Kısayollar paneli + tek bastırma kapısı
 * ---------------------------------------------------------------------------
 * Tasarım notları (değiştirmeden önce oku):
 *
 * 1) Bu blok DOSYANIN SONUNDA durmak ZORUNDA. keydown dinleyicisi kabarma
 *    (bubble) fazında document'e bağlanır ve kayıt SIRASI davranışı belirler:
 *      - uzak denetimde tuşları karşı tarafa ileten dinleyici DAHA ÖNCE
 *        kayıtlıdır → önce o çalışır, tuş iletimi asla bozulmaz;
 *      - bindUI() içindeki ESKİ kısayol dinleyicisi odaya girerken, yani DAHA
 *        SONRA kayıtlanır → stopImmediatePropagation() ile susturulabilir.
 *    Blok yukarı taşınırsa bu sıra bozulur.
 *
 * 2) Eski dinleyici M/D/C/S/R/F tuşlarını modifier'a bakmadan işliyor. Yeniden
 *    atama ve tek tek kapatmanın anlamlı olması için bu tuşlar HER DURUMDA
 *    burada yutulur; eylemi yalnızca bu kapı yürütür.
 *
 * 3) GÜVENLİK İSTİSNALARI — bastırılmaz, kapatılamaz, yeniden atanamaz:
 *      - Ctrl+X ×2 kill-switch: main.js globalShortcut ile yönetilir, bu dosya
 *        ona hiç dokunmaz (bkz. main.js syncControlKillSwitch).
 *      - Escape: denetimi bırakma / odak modundan çıkış / modal kapatma yolu.
 *        Bu kapı Escape'i ASLA yutmaz ve ASLA bastırmaz.
 *      - Bas-Konuş (ptt): sesi kesmek güvenlik değil erişilebilirlik sorunu
 *        yaratır; bastırma kapısından muaftır, yalnızca yeniden atanabilir.
 * =========================================================================== */

const SHORTCUTS_ENABLED_KEY = 'teamsync_shortcuts_enabled';
const SHORTCUTS_BINDINGS_KEY = 'teamsync_shortcut_bindings';

// Eski dinleyicinin sahiplendiği tuşlar — bkz. tasarım notu (2).
const LEGACY_SHORTCUT_CODES = new Set(['KeyM', 'KeyD', 'KeyC', 'KeyS', 'KeyR', 'KeyF']);

// Bastırmadan muaf kısayollar (güvenlik/erişilebilirlik). Bkz. tasarım notu (3).
const SHORTCUT_SUPPRESSION_EXEMPT = new Set(['ptt']);

// Etkinlik/oyun kartları. Bunlardan biri önplandayken uygulama kısayolları
// tetiklenmez; modüller kendi klavye girdilerini kullanıyor.
const ACTIVITY_CARD_IDS = [
  'wb-card', 'wt-card', 'sb-card', 'uno-card', 'poll-card',
  'lvs-card', 'wheel-card', 'poke-card', 'vampire-card'
];

const SHORTCUT_DEFS = [
  {
    id: 'mic', nameKey: 'shortcut.mic', descKey: 'shortcut.micDesc',
    def: { code: 'KeyM' }, run: () => document.getElementById('mic')?.click()
  },
  {
    id: 'deafen', nameKey: 'shortcut.deafen', descKey: 'shortcut.deafenDesc',
    def: { code: 'KeyD' }, run: () => document.getElementById('deaf')?.click()
  },
  {
    id: 'camera', nameKey: 'shortcut.camera', descKey: 'shortcut.cameraDesc',
    def: { code: 'KeyC' }, run: () => document.getElementById('cam')?.click()
  },
  {
    id: 'share', nameKey: 'shortcut.share', descKey: 'shortcut.shareDesc',
    def: { code: 'KeyS' }, run: () => document.getElementById('share')?.click()
  },
  {
    id: 'record', nameKey: 'shortcut.record', descKey: 'shortcut.recordDesc',
    def: { code: 'KeyR' }, run: () => document.getElementById('rec')?.click()
  },
  {
    id: 'fullscreen', nameKey: 'shortcut.fullscreen', descKey: 'shortcut.fullscreenDesc',
    def: { code: 'KeyF' },
    run: () => { if (typeof focusedCard !== 'undefined' && focusedCard) toggleFocusFullscreen(); }
  },
  // Bas-Konuş main süreçte globalShortcut ile kayıtlı; burada yalnızca tuşu
  // saklanır. Aç/kapat anahtarı Ses ve Görüntü sekmesindeki "Bas-Konuş"tur.
  {
    id: 'ptt', nameKey: 'shortcut.ptt', descKey: 'shortcut.pttDesc',
    def: { code: 'Space' }, global: true, toggleable: false, run: null
  }
];

function shortcutDef(id) {
  return SHORTCUT_DEFS.find(def => def.id === id) || null;
}

function getShortcutsMasterEnabled() {
  return localStorage.getItem(SHORTCUTS_ENABLED_KEY) !== '0';
}

function readShortcutBindings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHORTCUTS_BINDINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeShortcutBindings(map) {
  try { localStorage.setItem(SHORTCUTS_BINDINGS_KEY, JSON.stringify(map)); } catch (e) {}
}

// Kaydedilmiş değer + varsayılan birleşimi. Kayıt yoksa varsayılan döner.
function getShortcutBinding(id) {
  const def = shortcutDef(id);
  if (!def) return null;
  const saved = readShortcutBindings()[id] || {};
  return {
    id,
    code: typeof saved.code === 'string' && saved.code ? saved.code : def.def.code,
    ctrl: 'ctrl' in saved ? !!saved.ctrl : !!def.def.ctrl,
    alt: 'alt' in saved ? !!saved.alt : !!def.def.alt,
    shift: 'shift' in saved ? !!saved.shift : !!def.def.shift,
    enabled: def.toggleable === false ? true : saved.enabled !== false
  };
}

function shortcutComboFromEvent(event) {
  return {
    code: event.code,
    ctrl: !!(event.ctrlKey || event.metaKey),
    alt: !!event.altKey,
    shift: !!event.shiftKey
  };
}

function shortcutBindingMatches(binding, combo) {
  if (!binding || !binding.code || !combo) return false;
  return binding.code === combo.code
    && !!binding.ctrl === !!combo.ctrl
    && !!binding.alt === !!combo.alt
    && !!binding.shift === !!combo.shift;
}

const SHORTCUT_KEY_LABELS = {
  Space: 'Space', Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Num Enter', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←',
  ArrowRight: '→', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/',
  Backquote: '`', CapsLock: 'CapsLock'
};

function shortcutKeyLabel(code) {
  if (!code) return '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return 'Num ' + code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return SHORTCUT_KEY_LABELS[code] || code;
}

function shortcutComboLabel(binding) {
  if (!binding || !binding.code) return t('settings.shortcutUnassigned');
  const parts = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(shortcutKeyLabel(binding.code));
  return parts.join(' + ');
}

// Electron accelerator biçimi (main.js globalShortcut.register bunu bekler).
function shortcutAcceleratorKey(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const map = {
    Space: 'Space', Escape: 'Escape', Enter: 'Return', NumpadEnter: 'Return', Tab: 'Tab',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down',
    ArrowLeft: 'Left', ArrowRight: 'Right', Minus: '-', Equal: '=', BracketLeft: '[',
    BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: '\'', Comma: ',',
    Period: '.', Slash: '/', Backquote: '`'
  };
  return map[code] || null;
}

function shortcutAccelerator(binding) {
  if (!binding) return null;
  const key = shortcutAcceleratorKey(binding.code);
  if (!key) return null;
  const parts = [];
  if (binding.ctrl) parts.push('CommandOrControl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/* --------------------------------------------------------------------------
 * BASTIRMA KAPISI — tüm kısayol kararları buradan geçer.
 * -------------------------------------------------------------------------- */

// Uzak denetim: hem denetleyen (activeControl) hem denetlenen (controlledBy)
// taraf. Bayraklar yalnızca OKUNUR.
function isRemoteControlEngaged() {
  try {
    if (typeof state !== 'undefined' && state && (state.activeControl || state.controlledBy)) return true;
  } catch (e) {}
  try {
    if (typeof remotePointerActive !== 'undefined' && remotePointerActive) return true;
  } catch (e) {}
  return false;
}

function isShortcutTypingTarget(node) {
  const el = node && node.nodeType === 1 ? node : null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Gömülü içerik (webview/iframe) tuşları kendi işler.
  if (tag === 'WEBVIEW' || tag === 'IFRAME') return true;
  return !!el.isContentEditable;
}

// Etkinlik/oyun önplanda mı? Odaklanmış kart bir etkinlik kartıysa ya da
// klavye odağı görünür bir etkinlik kartının içindeyse önplandadır.
function isActivityForeground() {
  try {
    if (typeof focusedCard !== 'undefined' && focusedCard && ACTIVITY_CARD_IDS.includes(focusedCard.id)) return true;
  } catch (e) {}
  const active = document.activeElement;
  for (const id of ACTIVITY_CARD_IDS) {
    const card = document.getElementById(id);
    if (!card || card.classList.contains('hidden')) continue;
    // Vampir Köylü tüm ekranı kaplar; görünür olması önplan demektir.
    if (id === 'vampire-card') return true;
    if (active && card.contains(active)) return true;
  }
  return false;
}

// Görsel önizleyici veya herhangi bir modal açıkken kısayollar durur.
function isShortcutOverlayForeground() {
  const lightbox = document.getElementById('img-lightbox');
  if (lightbox && !lightbox.classList.contains('hidden')) return true;
  return !!document.querySelector('.modal:not(.hidden)');
}

// Bastırma nedeni: 'control' | 'typing' | 'activity' | 'overlay' | null
function shortcutSuppressionReason(event) {
  if (isRemoteControlEngaged()) return 'control';
  if (isShortcutTypingTarget(event && event.target)) return 'typing';
  if (isShortcutTypingTarget(document.activeElement)) return 'typing';
  if (isActivityForeground()) return 'activity';
  if (isShortcutOverlayForeground()) return 'overlay';
  return null;
}

function isShortcutSuppressed(event) {
  return shortcutSuppressionReason(event) !== null;
}

// TEK KARAR NOKTASI. Her kısayol handler'ı bunu çağırır.
function shortcutsAllowed(id, event) {
  const binding = getShortcutBinding(id);
  if (!binding) return false;
  // Bkz. tasarım notu (3): muaf kısayollar ana anahtardan da bastırmadan da etkilenmez.
  if (SHORTCUT_SUPPRESSION_EXEMPT.has(id)) return true;
  if (!getShortcutsMasterEnabled()) return false;
  if (!binding.enabled) return false;
  return !isShortcutSuppressed(event);
}

/* --------------------------------------------------------------------------
 * KAPI DİNLEYİCİSİ
 * -------------------------------------------------------------------------- */

let shortcutRebindState = null;

function handleShortcutGateKeydown(event) {
  // Yeniden atama sürüyorsa tuşu window-capture dinleyicisi zaten yakaladı.
  if (shortcutRebindState) return;
  // Escape hiçbir zaman yutulmaz — güvenlik çıkış yolu (tasarım notu 3).
  if (event.code === 'Escape') return;
  const tag = event.target && event.target.tagName;
  // Eski dinleyici de bunları yok sayıyor; yutmak metin alanlarını bozar.
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const combo = shortcutComboFromEvent(event);
  const match = SHORTCUT_DEFS.find(def => def.run && shortcutBindingMatches(getShortcutBinding(def.id), combo));
  const swallow = !!match || LEGACY_SHORTCUT_CODES.has(event.code);
  if (!swallow) return;

  // Eski kısayol dinleyicisi (bindUI) bu tuşu görmemeli; yorumu burada yapılır.
  event.stopImmediatePropagation();
  if (!match) return;
  if (!shortcutsAllowed(match.id, event)) return;
  try { match.run(event); } catch (e) { console.warn('Kısayol çalıştırılamadı:', match.id, e); }
}

document.addEventListener('keydown', handleShortcutGateKeydown);

/* --------------------------------------------------------------------------
 * BAS-KONUŞ SENKRONU (main.js register-ptt)
 * -------------------------------------------------------------------------- */

function getPttAccelerator() {
  return shortcutAccelerator(getShortcutBinding('ptt')) || 'Space';
}

// applyPttMode() içindeki keyup karşılaştırması bunu kullanır.
function matchesPttReleaseKey(event) {
  const binding = getShortcutBinding('ptt');
  return !!binding && event.code === binding.code;
}

// Tuş değişince main süreçteki globalShortcut kaydını tazeler. PTT kapalıysa
// (state.pttMode false) hiçbir şey yapılmaz; açılınca applyPttMode kaydeder.
function applyPttShortcut() {
  try {
    if (typeof state === 'undefined' || !state || !state.pttMode) return;
    if (!window.electronAPI?.registerPTT) return;
    window.electronAPI.registerPTT(getPttAccelerator());
  } catch (e) {
    console.warn('PTT kısayolu güncellenemedi:', e);
  }
}

/* --------------------------------------------------------------------------
 * AYARLAR PANELİ
 * -------------------------------------------------------------------------- */

function setShortcutEnabled(id, enabled) {
  const map = readShortcutBindings();
  map[id] = Object.assign({}, map[id], { enabled: !!enabled });
  writeShortcutBindings(map);
  renderShortcutSettings();
}

function resetShortcut(id) {
  const def = shortcutDef(id);
  if (!def) return;
  const map = readShortcutBindings();
  delete map[id];
  writeShortcutBindings(map);
  renderShortcutSettings();
  if (id === 'ptt') applyPttShortcut();
}

function resetAllShortcuts() {
  try {
    localStorage.removeItem(SHORTCUTS_BINDINGS_KEY);
    localStorage.removeItem(SHORTCUTS_ENABLED_KEY);
  } catch (e) {}
  renderShortcutSettings();
  applyPttShortcut();
  showToast(t('settings.shortcutUpdated'), 'ok');
}

const SHORTCUT_MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'
]);

function cancelShortcutRebind() {
  if (!shortcutRebindState) return;
  const { button, previousLabel } = shortcutRebindState;
  shortcutRebindState = null;
  window.removeEventListener('keydown', onShortcutRebindKey, true);
  if (button) {
    button.classList.remove('listening');
    button.textContent = previousLabel;
  }
}

function onShortcutRebindKey(event) {
  if (!shortcutRebindState) return;
  // Yakalama fazında window'a bağlı: görsel önizleyici dahil hiçbir dinleyici
  // bu tuşu görmemeli, ayarlar modalı da Escape ile kapanmamalı.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (SHORTCUT_MODIFIER_CODES.has(event.code)) return; // sadece modifier: beklemeye devam
  if (event.code === 'Escape') { cancelShortcutRebind(); return; } // Escape ayrılmış

  const id = shortcutRebindState.id;
  const combo = shortcutComboFromEvent(event);
  if (!shortcutAcceleratorKey(combo.code)) { cancelShortcutRebind(); return; }
  const clash = SHORTCUT_DEFS.find(def => def.id !== id && shortcutBindingMatches(getShortcutBinding(def.id), combo));
  if (clash) {
    cancelShortcutRebind();
    showToast(`${t('settings.shortcutConflict')}: ${t(clash.nameKey)}`, 'warn');
    return;
  }
  const map = readShortcutBindings();
  map[id] = Object.assign({}, map[id], {
    code: combo.code, ctrl: combo.ctrl, alt: combo.alt, shift: combo.shift
  });
  writeShortcutBindings(map);
  cancelShortcutRebind();
  renderShortcutSettings();
  if (id === 'ptt') applyPttShortcut();
  showToast(t('settings.shortcutUpdated'), 'ok');
}

function beginShortcutRebind(id, button) {
  cancelShortcutRebind();
  shortcutRebindState = { id, button, previousLabel: button.textContent };
  button.classList.add('listening');
  button.textContent = t('settings.shortcutListening');
  window.addEventListener('keydown', onShortcutRebindKey, true);
  window.addEventListener('blur', cancelShortcutRebind, { once: true });
}

function renderShortcutSettings() {
  const list = document.getElementById('user-shortcuts-list');
  if (!list) return;
  cancelShortcutRebind();
  const master = getShortcutsMasterEnabled();
  const masterEl = document.getElementById('user-shortcuts-enabled');
  if (masterEl) masterEl.checked = master;
  list.classList.toggle('shortcuts-list-off', !master);

  const fragment = document.createDocumentFragment();
  SHORTCUT_DEFS.forEach(def => {
    const binding = getShortcutBinding(def.id);
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    row.dataset.shortcutId = def.id;

    const info = document.createElement('div');
    info.className = 'shortcut-info';
    const name = document.createElement('strong');
    name.textContent = t(def.nameKey);
    const desc = document.createElement('p');
    desc.textContent = t(def.descKey);
    info.append(name, desc);

    const keyBtn = document.createElement('button');
    keyBtn.type = 'button';
    keyBtn.className = 'shortcut-key';
    keyBtn.textContent = shortcutComboLabel(binding);
    keyBtn.title = t('settings.shortcutRebind');
    keyBtn.setAttribute('aria-label', `${t(def.nameKey)} — ${t('settings.shortcutRebind')}`);
    keyBtn.addEventListener('click', () => beginShortcutRebind(def.id, keyBtn));

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'shortcut-reset';
    resetBtn.textContent = '⟲';
    resetBtn.title = t('settings.shortcutReset');
    resetBtn.setAttribute('aria-label', t('settings.shortcutReset'));
    resetBtn.addEventListener('click', () => resetShortcut(def.id));

    row.append(info, keyBtn, resetBtn);

    if (def.toggleable === false) {
      const note = document.createElement('span');
      note.className = 'shortcut-note';
      note.textContent = t('settings.shortcutsPttNote');
      row.append(note);
    } else {
      const label = document.createElement('label');
      label.className = 'switch';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = binding.enabled;
      checkbox.addEventListener('change', () => setShortcutEnabled(def.id, checkbox.checked));
      const slider = document.createElement('span');
      slider.className = 'slider round';
      label.append(checkbox, slider);
      row.append(label);
      row.classList.toggle('shortcut-row-off', !binding.enabled);
    }
    fragment.append(row);
  });
  list.replaceChildren(fragment);
}

/* --------------------------------------------------------------------------
 * "Kısayollar duraklatıldı" rozeti (denetim sırasında)
 * -------------------------------------------------------------------------- */

let shortcutsPausedBadgeVisible = null;

function updateShortcutsPausedBadge() {
  const badge = document.getElementById('shortcuts-paused-badge');
  if (!badge) return;
  const show = getShortcutsMasterEnabled() && isRemoteControlEngaged();
  if (show === shortcutsPausedBadgeVisible) return;
  shortcutsPausedBadgeVisible = show;
  badge.classList.toggle('hidden', !show);
}

function initShortcutSettings() {
  const masterEl = document.getElementById('user-shortcuts-enabled');
  if (masterEl) {
    masterEl.addEventListener('change', () => {
      localStorage.setItem(SHORTCUTS_ENABLED_KEY, masterEl.checked ? '1' : '0');
      renderShortcutSettings();
      updateShortcutsPausedBadge();
      showToast(masterEl.checked ? t('settings.shortcutsAllOn') : t('settings.shortcutsAllOff'), 'info');
    });
  }
  document.getElementById('user-shortcuts-reset-all')?.addEventListener('click', resetAllShortcuts);
  // Panel her açılışta yeniden çizilir: dil değişimi ve dışarıdan yapılan
  // değişiklikler böylece görünür olur.
  document.querySelector('[data-settings-panel="shortcuts"]')?.addEventListener('click', renderShortcutSettings);
  renderShortcutSettings();
  updateShortcutsPausedBadge();
  setInterval(updateShortcutsPausedBadge, 700);
}

document.addEventListener('DOMContentLoaded', initShortcutSettings);

window.shortcutsAllowed = shortcutsAllowed;
window.isShortcutSuppressed = isShortcutSuppressed;
window.getPttAccelerator = getPttAccelerator;
window.matchesPttReleaseKey = matchesPttReleaseKey;
window.renderShortcutSettings = renderShortcutSettings;
