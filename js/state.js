window.state = {
  myId: crypto.randomUUID(),
  myName: '',
  room: '',
  password: '',
  peers: new Map(),
  localStream: null,
  screenStream: null,
  processedStream: null,
  audioCtx: null,
  remoteAudioCtx: null,
  rnnoiseFilterNode: null,
  rnnoiseActive: false,
  rnnoiseStatus: 'off',
  audioSetupGeneration: 0,
  noiseSuppressionApplyPromise: null,
  // micEnabled = EFEKTİF mikrofon durumu (diğer kodun okuduğu). selfMicOn =
  // kullanıcının KENDİ tercihi. Efektif = selfMicOn && !serverMuted. Kurucu
  // susturması kalkınca kullanıcının kendi tercihi geri uygulanır (iki değişken).
  micEnabled: true,
  selfMicOn: true,
  serverMuted: false,
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
  // Yerel lakaplar ve kişi bazlı ses seviyeleri (id → değer). SADECE bu
  // cihazda localStorage'da tutulur, ağa gönderilmez; renderer.js açılışta
  // teamsync_nicknames / teamsync_user_volumes anahtarlarından doldurur.
  nicknames: {},
  userVolumes: {},
  friendRequests: [],
  globalMqtt: null,
  pttActive: false,
  volume: 1.0,
  useAI: true,
  activeControl: null,      // kontrol EDEN taraf: { hostId } (kimin masaüstünü yönetiyorum)
  controlledBy: null,       // kontrol EDİLEN taraf: beni yöneten peer'in id'si
  pendingControlReq: null,
  speakingPeers: new Map(),
  analyser: null,
  gainNode: null,
  cryptoKey: null,
  wbContext: null,
  drawing: false,
  micThreshold: 3,
  dms: {},
  activeDM: null,
  myAvatar: null,
  myAvatarHash: null,
  act: { wt: false, uno: false },
  wt: { player: null, isReady: false, lastAction: 0, ignoreNextEvent: false, joinedActivity: false },
  sb: { host: null, startedAt: 0, appliedRemoteUrl: '', remoteNavTs: 0, joinedActivity: false, lastUrl: '', lastVideoState: null, lastNavTs: 0, lastVideoSyncTs: 0, remoteVideoSyncTs: 0, authorized: [], authTs: 0, lastActionTs: 0, lastRoutineSyncTs: 0 },
  // UNO — host-yetkili kart oyunu (bkz. js/uno.js). Herkese açık alanlar tüm
  // istemcilerde; deck/hands yalnızca host'ta doludur.
  uno: {
    host: null,
    started: false,
    joinedActivity: false,
    maxPlayers: 4,   // kurucu "kaç kişilik" ayarı (2-8)
    botTimer: null,  // host: bot hamlesi zamanlayıcısı
    players: [],     // [{id, name, count, isBot?}]
    hand: [],        // benim elim [{color, value}]
    turnId: null,
    turnIndex: 0,    // host tarafında sıra indeksi
    dir: 1,
    color: null,
    top: null,
    pile: [],        // ıskartanın en üstteki son ~5 kartı (yığın görünümü)
    playSeq: 0,      // oynanan kart sayacı (ıskarta "slam" animasyonu için)
    actionSeq: 0,    // her eylem grubu sayacı — uçan kart animasyonları için
    events: [],      // son eylem grubu: [{kind:'play'|'draw', actorId, count}]
    rules: { stack: false, block: false, startCards: 7 }, // ev kuralları (kurucu ayarlar, herkes görür)
    pendingCount: 0, // bekleyen +2/+4 ceza kartı sayısı (kombo/blok kuralları açıkken)
    pendingKind: null, // 'draw2' | 'wild4' — yığının tabanındaki ceza türü
    awaitId: null,   // desteden çektiği kart oynanabilir olup "At / Beklet" kararı beklenen oyuncu
    awaitCard: null, // host-only: o oyuncunun çektiği kart (yalnız bu kart oynanabilir)
    deck: [],        // host-only
    discard: [],     // host-only
    hands: {},       // host-only: id -> [cards]
    winnerId: null
  },
  lobbies: [],
  activeLobbyId: null,
  isLobbyHost: false,
  spectating: false,
  selectedLobbyActivity: null,
  sfwMode: false,
  aiModel: null,
  gameMode: false,
  // Sunucu geneli ses bit hızı (kbps). Kurucu, sunucu oluştururken ve kurucu
  // ayarlarından değiştirebilir; tüm katılımcılara yayılır. (item 7)
  audioBitrate: 128,
  moderators: new Set(),
  // Kurucu/yetkili tarafından susturulan oyuncuların id'leri — sustur/aç
  // butonunun durumunu (toggle) belirlemek için tüm istemcilerde tutulur.
  serverMutedIds: new Set(),
  // Kurucunun kalıcı olarak yasakladığı oyuncuların id'leri; bu odaya tekrar
  // giremezler. Kurucu tarafında localStorage'a da yazılır (bkz: room bans).
  bannedIds: new Set(),
  founderId: null,
  roomName: null
};
