/* Vampir Köylü — kurucu yetkili, gizli rollü sosyal çıkarım oyunu. */
(function () {
  const el = id => document.getElementById(id);
  const esc = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ROLE_INFO = {
    vampire: { name: 'Vampir', team: 'vampire', desc: 'Her gece vampir takımıyla bir hedef seçer.' },
    villager: { name: 'Köylü', team: 'village', desc: 'Gündüz tartışır ve vampirleri oylamayla bulmaya çalışır.' },
    seer: { name: 'Büyücü', team: 'village', desc: 'Her gece bir oyuncunun tam rolünü öğrenir.' },
    oracle: { name: 'Kâhin', team: 'village', desc: 'Her gece bir oyuncunun vampir tarafında olup olmadığını öğrenir.' },
    fool: { name: 'Deli Köylü', team: 'village', desc: 'Her gece bir kişiyi araştırır; ancak aldığı taraf bilgisi her zaman ters çıkar.' },
    doctor: { name: 'Doktor', team: 'village', desc: 'Her gece bir oyuncuyu korur; aynı hedefi iki gece üst üste seçemez.' },
    healer: { name: 'Şifacı', team: 'village', desc: 'Oyun boyunca bir kez elenmiş bir oyuncuyu hayata döndürür.' },
    hunter: { name: 'Avcı', team: 'village', desc: 'Elendiğinde bir kişiye son atış yapar.' },
    warrior: { name: 'Savaşçı', team: 'village', desc: 'Oyun boyunca bir kez gece saldırısı yapabilir.' },
    spy: { name: 'Casus', team: 'village', desc: 'Her gece bir oyuncunun vampir tarafında olup olmadığını öğrenir.' },
    executioner: { name: 'Cellat', team: 'independent', desc: 'Gizli hedefi gündüz oylamasıyla sürülürse tek başına kazanır.' }
  };
  const ROLE_ART = {
    vampire: { glyph: '♜', label: 'KAN YEMİNİ' }, villager: { glyph: '⌂', label: 'KÖY HALKI' },
    seer: { glyph: '✦', label: 'GİZLİ BİLGİ' }, oracle: { glyph: '◉', label: 'KEHANET' },
    fool: { glyph: '◌', label: 'ÇARPIK SEZGİ' }, doctor: { glyph: '✚', label: 'KORUYUCU' },
    healer: { glyph: '❋', label: 'TEK KULLANIM' }, hunter: { glyph: '⌖', label: 'SON ATIŞ' },
    warrior: { glyph: '⚔', label: 'TEK KULLANIM' }, spy: { glyph: '◇', label: 'GÖZLEMCİ' },
    executioner: { glyph: '†', label: 'BAĞIMSIZ' }
  };
  const SPECIALS = ['seer', 'oracle', 'fool', 'doctor', 'healer', 'hunter', 'warrior', 'spy', 'executioner'];
  const freshSettings = () => ({ vampireCount: 'auto', preset: 'balanced', phaseSeconds: 0, seer: true, oracle: false, fool: false, doctor: true, healer: false, hunter: true, warrior: false, spy: false, executioner: false });
  const blank = () => ({ host: null, started: false, phase: 'lobby', round: 0, players: [], roles: {}, localRole: null, localTeammates: [], localDoctorLastTargetId: null, privateIntel: [], doctorHistory: {}, settings: freshSettings(), actions: {}, used: {}, executionTargets: {}, winnerId: null, winnerTeam: null, pendingHunterId: null, phaseEndsAt: 0, voteAttempt: 0, voteCandidates: null, lastElimination: null, privateNote: '', log: [], chat: [] });
  let phaseTimer = null;
  let roleRevealTimer = null;
  let roleRevealKey = null;
  const localSelections = new Map();
  const CHAT_LIMIT = 100;
  const MAX_PLAYERS = 10;
  // --- Ollama bot altyapısı ---
  const BOT_ID_PREFIX = 'vvbot-';
  const OLLAMA_BASE_KEY = 'teamsync_vv_ollama_base';
  const OLLAMA_MODEL_KEY = 'teamsync_vv_ollama_model';
  const DEFAULT_BOT_MODEL = 'gemma3:1b';
  const LEGACY_BOT_MODELS = new Set(['gemma3:e2b']);
  const BOT_CHAT_COOLDOWN_MS = 6500;
  const BOT_REPLY_COOLDOWN_MS = 2500; // birisi bota soru sorduysa daha hizli cevap verir
  const BOT_GLOBAL_CHAT_GAP_MS = 2500;
  const BOT_LANGUAGE_CODES = typeof SUPPORTED_LANGUAGES !== 'undefined'
    ? [...SUPPORTED_LANGUAGES]
    : ['tr', 'en', 'de', 'es', 'fr', 'pt-BR', 'ru', 'ar', 'kk', 'tk', 'mn', 'zh-CN', 'ja'];
  const BOT_LANGUAGE_FALLBACKS = {
    tr: 'Türkçe', en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', 'pt-BR': 'Português (Brasil)',
    ru: 'Русский', ar: 'العربية', kk: 'Қазақша', tk: 'Türkmençe', mn: 'Монгол', 'zh-CN': '简体中文', ja: '日本語'
  };
  const isBotId = id => typeof id === 'string' && id.startsWith(BOT_ID_PREFIX);
  const ollamaBase = () => { try { return (localStorage.getItem(OLLAMA_BASE_KEY) || 'http://localhost:11434').replace(/\/+$/, ''); } catch (_) { return 'http://localhost:11434'; } };
  const defaultBotModel = () => {
    try {
      const saved = localStorage.getItem(OLLAMA_MODEL_KEY);
      if (saved && !LEGACY_BOT_MODELS.has(saved)) return saved;
      // Eski sürümlerdeki gemma3:e2b etiketi Ollama'da yoktu. Var olan
      // kurulumları sessizce küçük, geçerli metin modeli gemma3:1b'ye taşı.
      if (saved) localStorage.setItem(OLLAMA_MODEL_KEY, DEFAULT_BOT_MODEL);
      return DEFAULT_BOT_MODEL;
    } catch (_) {
      return DEFAULT_BOT_MODEL;
    }
  };
  // Bu Map'ler yalnızca bu istemcide anlamlıdır (senkronize edilmez): hangi bot şu an
  // Ollama'ya soru sordu (busy), hangi round/faz için zaten karar verdi (actedKey),
  // en son ne zaman sohbete katıldı (lastChatAt) ve bağlantı durumu (ollamaStatus).
  const botBusy = new Set();
  const botActedKey = new Map();
  const botLastChatAt = new Map();
  const botOllamaStatus = new Map();
  const botLastAnswered = new Map(); // bot hangi sohbet mesajina cevap verdi
  let botLastGlobalChatAt = 0;
  let botChatCursor = 0;
  let botChatPhaseKey = '';
  // Botun hafızası: yalnızca o botu çalıştıran (operatör) bilgisayarda tutulur.
  // Gizli rol sonuçları, kendi kararları/düşünceleri ve gördüğü olaylar burada birikir.
  const botMemory = new Map();
  // Her botun oyuncular hakkındaki yapılandırılmış kanaati. Gizli rol sonuçları
  // güçlü kanıt, sohbetten modelin çıkardığı yorumlar ise sınırlı ve değişebilir
  // şüphe olarak tutulur. Böylece bot her tur sıfırdan veya tamamen rastgele düşünmez.
  const botBeliefs = new Map();
  // Botun gizli rolü ve (vampirse) takım arkadaşları da yalnızca operatör bilgisayarda bilinir;
  // kurucu bunları rol dağıtımında tek tek operatörlere iletir.
  const botRoles = new Map();
  const botTeammates = new Map();
  const botDoctorLastTargets = new Map();
  const botProcessedChatClaims = new Map();
  // Her botun rol eylemlerinden öğrendiği özel pekiştirme puanı.
  // Başka oyuncuların gizli rolleri bu alana veya model bağlamına yazılmaz.
  const botRewardScores = new Map();
  let botOutcomeRewardKey = '';
  const MEMORY_LIMIT = 60;
  const DEFAULT_PERSONA = 'Sakin ama şüpheci bir oyuncusun. Kısa, doğal ve tutarlı konuşursun.';
  const defaultBotLanguage = () => {
    const selected = typeof getUserLanguage === 'function' ? getUserLanguage() : 'tr';
    return BOT_LANGUAGE_CODES.includes(selected) ? selected : 'tr';
  };
  const botLanguageName = code => {
    const meta = typeof LANGUAGE_META !== 'undefined' ? LANGUAGE_META[code] : null;
    return meta?.name || BOT_LANGUAGE_FALLBACKS[code] || BOT_LANGUAGE_FALLBACKS.tr;
  };
  function rememberBotBelief(botId, targetId, delta, reason, source = 'yorum') {
    if (!game().players.some(player => player.id === botId && player.isBot) || !targetId || botId === targetId) return;
    const scoreDelta = Math.max(-100, Math.min(100, Number(delta) || 0));
    const beliefs = botBeliefs.get(botId) || new Map();
    const current = beliefs.get(targetId) || { score: 0, evidence: [] };
    current.score = Math.max(-100, Math.min(100, current.score + scoreDelta));
    if (reason) current.evidence = [...current.evidence, { reason: String(reason).slice(0, 180), source }].slice(-5);
    beliefs.set(targetId, current);
    botBeliefs.set(botId, beliefs);
  }
  function botBeliefSummary(botId) {
    const g = game();
    const beliefs = botBeliefs.get(botId) || new Map();
    return g.players.filter(player => player.id !== botId).map(player => {
      const belief = beliefs.get(player.id) || { score: 0, evidence: [] };
      const latest = belief.evidence.slice(-2).map(item => `${item.source}: ${item.reason}`).join(' | ') || 'henüz somut kanıt yok';
      return `${player.id} = ${player.name}: şüphe ${belief.score}/100; ${latest}`;
    }).join('\n') || '(değerlendirilecek oyuncu yok)';
  }
  function applyDecisionBeliefs(bot, decision) {
    if (!Array.isArray(decision?.supheler)) return;
    const validIds = new Set(game().players.filter(player => player.id !== bot.id).map(player => player.id));
    decision.supheler.slice(0, 3).forEach(item => {
      if (!item || !validIds.has(item.targetId)) return;
      // Sohbet yorumu kesin bilgi değildir; tek kararda kanaati en fazla 20 puan oynatır.
      const delta = Math.max(-20, Math.min(20, Number(item.delta) || 0));
      rememberBotBelief(bot.id, item.targetId, delta, item.neden || 'Sohbet ve davranış değerlendirmesi', 'çıkarım');
    });
  }
  const mentionKey = value => String(value || '').normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, '');
  const foldChatText = value => String(value || '').normalize('NFKD').toLocaleLowerCase('tr-TR').replace(/\p{M}+/gu, '')
    .replace(/[çćč]/g, 'c').replace(/[ğ]/g, 'g').replace(/[ı]/g, 'i').replace(/[ö]/g, 'o').replace(/[şš]/g, 's').replace(/[ü]/g, 'u')
    .replace(/[^\p{L}\p{N}?]+/gu, ' ').replace(/\s+/g, ' ').trim();
  function mentionsPlayer(text, name) {
    const normalText = String(text || '').toLocaleLowerCase('tr-TR');
    const normalName = String(name || '').toLocaleLowerCase('tr-TR').trim();
    const compactName = mentionKey(name);
    return (normalName.length >= 3 && normalText.includes(normalName)) || (compactName.length >= 3 && mentionKey(normalText).includes(compactName));
  }
  function analyzeChatClaim(message) {
    const text = String(message?.text || '').toLocaleLowerCase('tr-TR');
    const folded = foldChatText(text);
    const targets = game().players.filter(player => player.alive && player.id !== message?.senderId && mentionsPlayer(text, player.name));
    const denial = /vampir degil|katil degil|suclu degil|suphelenmiyorum|supelenmiyorum|masum|temiz|guveniyorum|guvenilir|iyi biri|koylu|innocent|not (a )?vampire|i trust|no es vampiro|inocente|pas vampire|unschuldig/.test(folded);
    const strongAccusation = /vampir|katil|oldur|suphe|supel|supe duy|yalan|suclu|hain|oy ver|atalim|surgun|killer|murderer|suspect|suspicious|vampire|liar|guilty|vote (for|out)|vampiro|sospech|culpable|mentiro|menteur|verdachtig|lugner/.test(folded);
    const weakSuspicion = targets.length > 0 && /bence|sanirim|galiba|olabilir|kesin o|gibi geliyor|guven vermiyo|guvenmiyorum|icime sinmi|sessiz|garip|tuhaf|i think|maybe|probably|dont trust|doesnt feel right/.test(folded);
    const accusation = !denial && (strongAccusation || weakSuspicion);
    const hasEvidence = /cunku|nedeni|sebebi|kanit|oyunu|oy verdi|oy degist|gece|once|sonra|dedi|soyledi|celis|savun|koru|hedef|oldu|sonuc|sessiz|guven vermiyor|because|voted|last night|said|changed|contradict/.test(folded);
    return { text, folded, denial, accusation, hasEvidence, baseless: accusation && targets.length > 0 && !hasEvidence, targets };
  }
  function applyChatPersuasion(bot, message) {
    if (!game().started || !['day', 'vote'].includes(game().phase) || !message || message.senderId === bot.id) return;
    const processed = botProcessedChatClaims.get(bot.id) || new Set();
    if (processed.has(message.id)) return;
    processed.add(message.id);
    botProcessedChatClaims.set(bot.id, processed.size > 80 ? new Set([...processed].slice(-60)) : processed);
    const claim = analyzeChatClaim(message);
    if (!claim.accusation && !claim.denial) return;
    const speakerScore = botBeliefs.get(bot.id)?.get(message.senderId)?.score || 0;
    const credibility = Math.max(.35, Math.min(1.25, 1 - speakerScore / 160));
    claim.targets.filter(player => player.id !== bot.id).forEach(target => {
      if (botKnownVampires(bot.id).has(target.id)) return;
      const base = claim.accusation ? (claim.hasEvidence ? 14 : 3) : -10;
      const delta = Math.round(base * credibility);
      rememberBotBelief(bot.id, target.id, delta, `${message.name}: “${String(message.text).slice(0, 110)}”`, 'sohbet iddiası');
      addBotMemory(bot.id, `${message.name}, ${target.name} hakkında ${claim.accusation ? (claim.hasEvidence ? 'gerekçeli bir suçlama' : 'kanıtsız bir suçlama') : 'savunucu bir iddia'} sundu; bunu kesin bilgi değil, tartışma sinyali olarak değerlendirdin.`, 'ikna');
    });
    if (claim.baseless && message.senderId !== bot.id && !botKnownVampires(bot.id).has(message.senderId)) {
      rememberBotBelief(bot.id, message.senderId, 10, `${message.name}, ${claim.targets.map(player => player.name).join(', ')} hakkında somut olay göstermeden kesin suçlama yaptı.`, 'kanıtsız suçlama');
      addBotMemory(bot.id, `${message.name} somut bir gece, oy veya çelişki göstermeden suçlama yaptı; bu yüzden suçlayanın güvenilirliği azaldı.`, 'sosyal okuma');
    }
  }
  function addBotMemory(botId, text, kind) {
    if (!text) return;
    const g = game();
    const list = botMemory.get(botId) || [];
    const entry = { round: g.round, phase: g.phase, kind: kind || 'olay', text: String(text).slice(0, 400) };
    if (list.some(item => item.text === entry.text && item.round === entry.round && item.phase === entry.phase)) return;
    botMemory.set(botId, [...list, entry].slice(-MEMORY_LIMIT));
  }
  const botMemoryLines = botId => (botMemory.get(botId) || []).map(item => `[${item.round}. tur/${item.phase}] ${item.text}`);
  function applyBotReward(botId, delta, reason) {
    const bot = game().players.find(player => player.id === botId && player.isBot);
    if (!bot || !Number.isFinite(Number(delta))) return;
    const amount = Math.round(Number(delta));
    const total = Math.max(-500, Math.min(500, (botRewardScores.get(botId) || 0) + amount));
    botRewardScores.set(botId, total);
    addBotMemory(botId, `${amount >= 0 ? 'Ödül' : 'Ceza'} ${amount >= 0 ? '+' : ''}${amount} (toplam ${total}): ${reason}`, 'pekiştirme');
  }
  function rewardBot(botId, delta, reason) {
    const bot = game().players.find(player => player.id === botId && player.isBot);
    if (!host() || !bot) return;
    if (bot.operatorId === state.myId) applyBotReward(botId, delta, reason);
    else broadcastTo(bot.operatorId, { type: 'vv-bot-reward', botId, delta, reason });
  }
  function rewardGameOutcome(team, winnerId = null) {
    const g = game();
    const key = `${g.round}:${team}:${winnerId || ''}`;
    if (botOutcomeRewardKey === key) return;
    botOutcomeRewardKey = key;
    g.players.filter(player => player.isBot).forEach(bot => {
      const won = team === 'executioner'
        ? bot.id === winnerId
        : ROLE_INFO[roleOf(bot.id)]?.team === team;
      rewardBot(bot.id, won ? 24 : -16, won ? 'Takımın oyunu kazandı; işe yarayan kararlarını koru.' : 'Takımın oyunu kaybetti; hatalı şüphe ve hedeflerini yeniden değerlendir.');
    });
  }
  const botRewardSummary = botId => `Toplam pekiştirme puanın: ${botRewardScores.get(botId) || 0}. Ödül alan karar örüntülerini koru; ceza alanları aynı kanıt olmadan tekrarlama.`;
  function clearBotBrains() {
    botBusy.clear(); botActedKey.clear(); botLastChatAt.clear(); botLastAnswered.clear();
    botOllamaStatus.clear(); botMemory.clear(); botBeliefs.clear(); botRoles.clear(); botTeammates.clear(); botDoctorLastTargets.clear(); botProcessedChatClaims.clear(); botRewardScores.clear();
    botLastGlobalChatAt = 0; botChatCursor = 0; botChatPhaseKey = ''; botOutcomeRewardKey = '';
  }
  // Kurucuda roller g.roles'te durur; uzaktaki operatörde yalnızca kendi botunun rolü bilinir.
  const botRoleOf = botId => game().roles[botId] || botRoles.get(botId) || null;
  function botKnownVampires(botId) {
    const g = game();
    if (botRoleOf(botId) !== 'vampire') return new Set();
    if (host()) return new Set(g.players.filter(player => g.roles[player.id] === 'vampire').map(player => player.id));
    return new Set([...(botTeammates.get(botId) || []), botId]);
  }
  // Kurucudan gelen olay günlüğü, o bilgisayarda çalışan botların hafızasına da yazılır.
  function rememberPublicLog(lines) {
    if (!game().started) return; // lobi kurulum satırları hafızayı kirletmesin
    const localBots = game().players.filter(player => player.isBot && player.operatorId === state.myId);
    if (!localBots.length) return;
    [...(lines || [])].reverse().forEach(line => localBots.forEach(bot => addBotMemory(bot.id, `Herkesin gördüğü olay: ${line}`, 'olay')));
  }
  let selectedBotId = null; // oyuncu isimlerinin göründüğü üst satırda hangi botun ayarları açık
  const game = () => state.vampire || (state.vampire = blank());
  const host = () => game().host === state.myId;
  const alive = () => game().players.filter(player => player.alive);
  const aliveCount = g => g.players.filter(player => player.alive).length;
  const mine = () => game().players.find(player => player.id === state.myId);
  const note = message => { const g = game(); g.log = [message, ...g.log].slice(0, 9); };
  const recommendedVampires = count => count <= 5 ? 1 : count <= 7 ? 2 : Math.max(2, Math.floor(count / 3));
  const activeVampireLobby = () => (state.lobbies || []).find(lobby => lobby.id === state.activeLobbyId && lobby.activity === 'vampire') || null;
  const isLobbyPlayer = id => !!activeVampireLobby()?.players?.some(player => player.id === id);
  const canSeeLobbyChat = () => !state.spectating && isLobbyPlayer(state.myId);
  const canUseLobbyChat = () => canSeeLobbyChat() && (!game().started || (mine()?.alive && ['day', 'vote'].includes(game().phase)));

  function openCard() {
    if (typeof openCardFocused === 'function') openCardFocused('vampire-card');
    else el('vampire-card')?.classList.remove('hidden');
  }
  function closeLocal() {
    const card = el('vampire-card');
    if (!card || card.classList.contains('hidden')) return;
    // The activity can be closed while it owns focus mode.  Hiding it first
    // leaves .main.focus-mode and the focus spacer active, producing the blank
    // or broken layout reported after leaving Vampire Villager.
    if (card.classList.contains('focused') && typeof exitFocus === 'function') exitFocus();
    card.classList.add('hidden');
  }
  function hideRoleReveal() {
    if (roleRevealTimer) clearTimeout(roleRevealTimer);
    roleRevealTimer = null;
    el('vv-role-reveal')?.classList.add('hidden');
  }
  function showRoleReveal(role, teammates = [], targetName = '') {
    const g = game();
    if (!g.started || !ROLE_INFO[role]) return;
    const key = `${g.host}:${g.round}:${role}`;
    if (roleRevealKey === key) return;
    roleRevealKey = key;
    const overlay = el('vv-role-reveal');
    if (!overlay) return;
    overlay.dataset.role = role;
    overlay.dataset.team = ROLE_INFO[role].team;
    if (roleRevealTimer) clearTimeout(roleRevealTimer);
    const art = ROLE_ART[role] || { glyph: '◆', label: 'GİZLİ ROL' };
    el('vv-reveal-eyebrow').textContent = `${art.label} · GİZLİ ROLÜN`;
    el('vv-reveal-sigil').textContent = art.glyph;
    el('vv-reveal-title').textContent = ROLE_INFO[role].name;
    el('vv-reveal-description').textContent = ROLE_INFO[role].desc;
    const team = el('vv-reveal-team');
    const teamText = role === 'vampire' && teammates.length
      ? `Vampir takımın: ${teammates.map(item => item.name).join(', ')}`
      : targetName ? `Gizli hedefin: ${targetName}` : '';
    team.textContent = teamText;
    team.classList.toggle('hidden', !teamText);
    overlay.classList.remove('hidden');
    const card = el('vampire-card');
    if (card) card.scrollTop = 0;
    roleRevealTimer = setTimeout(hideRoleReveal, 5000);
  }
  function refreshTimerLabel() {
    const g = game(), status = el('vampire-status');
    if (!status?.dataset.base) return;
    const secondsLeft = g.phaseEndsAt ? Math.max(0, Math.ceil((g.phaseEndsAt - Date.now()) / 1000)) : 0;
    status.textContent = `${status.dataset.base}${secondsLeft ? ` · ${secondsLeft} sn` : ''}`;
  }
  function snapshot() {
    const g = game();
    return { type: 'vv-state', host: g.host, started: g.started, phase: g.phase, round: g.round, settings: g.settings, pendingHunterId: g.pendingHunterId, phaseEndsAt: g.phaseEndsAt, voteCount: Object.keys(g.actions.votes || {}).length, voteAttempt: g.voteAttempt || 0, voteCandidates: g.voteCandidates || null, lastElimination: g.lastElimination, winnerId: g.winnerId, winnerTeam: g.winnerTeam, revealedRoles: g.phase === 'over' ? g.players.map(player => { const role = g.roles[player.id]; return { id: player.id, name: player.name, alive: player.alive, role, roleName: ROLE_INFO[role]?.name || 'Bilinmiyor', team: ROLE_INFO[role]?.team || 'unknown' }; }) : null, log: g.log, players: g.players.map(({ id, name, alive, isBot, operatorId, model, persona, language }) => isBot ? { id, name, alive, isBot: true, operatorId, model, persona, language: BOT_LANGUAGE_CODES.includes(language) ? language : 'tr' } : { id, name, alive }) };
  }
  function publish() { broadcast(snapshot()); rememberPublicLog(game().log); render(); }
  function sendRole(id) {
    const g = game();
    const role = g.roles[id];
    if (!role) return;
    const targetId = g.executionTargets?.[id];
    const targetName = g.players.find(player => player.id === targetId)?.name;
    const teammates = role === 'vampire'
      ? g.players.filter(player => player.id !== id && g.roles[player.id] === 'vampire').map(player => ({ id: player.id, name: player.name }))
      : [];
    const bot = g.players.find(player => player.id === id && player.isBot);
    if (bot) {
      if (bot.operatorId === state.myId) applyBotRole(id, role, targetName, teammates);
      else broadcastTo(bot.operatorId, { type: 'vv-bot-role', botId: id, role, targetName, teammates });
      return;
    }
    if (id === state.myId) {
      g.localRole = role;
      g.localTeammates = teammates;
      if (targetName) g.privateNote = `Cellat hedefin: ${targetName}. Hedefin gündüz oylamasıyla sürülürse kazanırsın.`;
      showRoleReveal(role, teammates, targetName);
    } else broadcastTo(id, { type: 'vv-role', role, targetName, teammates });
  }
  function applyBotRole(botId, role, targetName, teammates) {
    botRoles.set(botId, role);
    botTeammates.set(botId, (teammates || []).map(item => item.id));
    (teammates || []).forEach(item => rememberBotBelief(botId, item.id, -100, `${item.name} doğrulanmış vampir takım arkadaşın`, 'gizli bilgi'));
    addBotMemory(botId, `Gizli rolün: ${ROLE_INFO[role]?.name || role}. ${ROLE_INFO[role]?.desc || ''}`, 'rol');
    if (teammates?.length) addBotMemory(botId, `Vampir takım arkadaşların: ${teammates.map(item => item.name).join(', ')}. Onlara asla saldırma ve oy verme.`, 'rol');
    if (targetName) addBotMemory(botId, `Cellat hedefin: ${targetName}. Onu gündüz oylamasıyla sürdürürsen tek başına kazanırsın.`, 'rol');
    render();
  }
  function syncPeer(id) {
    // İzleyiciler oyun/sohbet senkronizasyonu almaz; bu oyun yalnızca oyuncu lobisine özeldir.
    if (!isLobbyPlayer(id)) return;
    broadcastTo(id, snapshot());
    if (game().started && game().roles[id]) sendRole(id);
    if (game().chat.length) broadcastTo(id, { type: 'vv-chat-history', messages: game().chat.slice(-CHAT_LIMIT) });
  }
  function normalizeChatMessage(raw) {
    const lobby = activeVampireLobby();
    if (!lobby || !raw || typeof raw !== 'object' || !isLobbyPlayer(raw.senderId)) return null;
    const text = String(raw.text || '').trim().slice(0, 500);
    if (!text) return null;
    const player = lobby.players.find(item => item.id === raw.senderId);
    return {
      id: String(raw.id || `${raw.senderId}-${raw.sentAt || Date.now()}`),
      senderId: raw.senderId,
      name: player?.name || 'Oyuncu',
      text,
      sentAt: Number(raw.sentAt) || Date.now()
    };
  }
  function renderLobbyChat() {
    const wrap = el('vv-chat-messages'), form = el('vv-chat-form');
    if (!wrap || !form) return;
    const allowed = canSeeLobbyChat();
    form.classList.toggle('hidden', !canUseLobbyChat());
    wrap.replaceChildren();
    if (!allowed) {
      const empty = document.createElement('div');
      empty.className = 'vv-chat-empty';
      empty.textContent = game().started && !mine()?.alive ? 'Elendiğin için meclis sohbetini yalnızca izleyebilirsin.' : 'Sohbet yalnızca lobide ve gündüz meclisinde açıktır.';
      wrap.appendChild(empty);
      return;
    }
    const messages = game().chat || [];
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'vv-chat-empty';
      empty.textContent = game().started ? 'Meclis açıldı. İlk iddiayı sen ortaya at.' : 'Lobi sohbeti hazır. İlk mesajı sen yaz.';
      wrap.appendChild(empty);
      return;
    }
    messages.forEach(message => {
      const item = document.createElement('article');
      item.className = `vv-chat-message${message.senderId === state.myId ? ' mine' : ''}`;
      const time = new Date(message.sentAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `<div class="vv-chat-meta"><span class="vv-chat-name">${esc(message.name)}</span><time class="vv-chat-time">${time}</time></div><div class="vv-chat-text">${esc(message.text)}</div>`;
      wrap.appendChild(item);
    });
    wrap.scrollTop = wrap.scrollHeight;
  }
  function addLobbyChatMessage(raw) {
    const message = normalizeChatMessage(raw);
    if (!message) return;
    const g = game();
    if (g.chat.some(item => item.id === message.id)) return;
    g.chat = [...g.chat, message].slice(-CHAT_LIMIT);
    renderLobbyChat();
    // Sohbette geçen her mesaj, bu bilgisayarda çalışan botların hafızasına düşer.
    g.players.filter(player => player.isBot && player.operatorId === state.myId && player.id !== message.senderId)
      .forEach(bot => { addBotMemory(bot.id, `${message.name} sohbette dedi ki: ${message.text}`, 'sohbet'); applyChatPersuasion(bot, message); });
    runBotsIfNeeded();
  }
  function sendLobbyChat() {
    const input = el('vv-chat-input');
    if (!input || !canUseLobbyChat()) return;
    const text = input.value.trim();
    if (!text) return;
    const message = { type: 'vv-chat', id: crypto.randomUUID(), senderId: state.myId, text: text.slice(0, 500), sentAt: Date.now() };
    addLobbyChatMessage(message);
    input.value = '';
    activeVampireLobby().players.forEach(player => {
      if (player.id !== state.myId) broadcastTo(player.id, message);
    });
  }
  function resetHostLobby() {
    const g = game();
    hideRoleReveal(); roleRevealKey = null; localSelections.clear();
    clearBotBrains();
    const lobby = state.lobbies.find(item => item.id === state.activeLobbyId);
    state.vampire = { ...blank(), host: state.myId, settings: g.settings || freshSettings(), players: (lobby?.players || [{ id: state.myId, name: state.myName }]).map(p => ({ ...p, alive: true })), log: ['Kurucu lobi kurallarını ayarlıyor. En az 4 oyuncu gerekir.'] };
    openCard(); publish();
  }
  function usePreset(key) {
    const g = game();
    const base = freshSettings();
    const presets = {
      classic: { vampireCount: 'auto' },
      balanced: { seer: true, doctor: true, hunter: true },
      chaos: { seer: true, oracle: true, fool: true, doctor: true, healer: true, hunter: true, warrior: true, spy: true, executioner: true }
    };
    g.settings = { ...base, ...(presets[key] || presets.balanced), preset: key, phaseSeconds: g.settings.phaseSeconds || 0 };
  }
  // --- Bot yönetimi (yalnızca kurucu, lobi fazında) ---
  function nextBotName() {
    const used = new Set(game().players.filter(player => player.isBot).map(player => player.name));
    let index = 1;
    while (used.has(`Bot ${index}`)) index++;
    return `Bot ${index}`;
  }
  function addBot() {
    const g = game();
    if (!host() || g.started || g.players.length >= MAX_PLAYERS) return;
    const lobby = state.lobbies.find(item => item.id === state.activeLobbyId);
    const bot = { id: BOT_ID_PREFIX + crypto.randomUUID(), name: nextBotName(), alive: true, isBot: true, operatorId: state.myId, model: defaultBotModel(), persona: DEFAULT_PERSONA, language: defaultBotLanguage() };
    g.players = [...g.players, bot];
    if (lobby) { lobby.players = [...lobby.players, { id: bot.id, name: bot.name, isBot: true }]; if (typeof syncLobbiesList === 'function') syncLobbiesList(); }
    publish();
    requestBotOllamaCheck(bot.id);
  }
  function removeBot(id) {
    const g = game();
    if (!host() || g.started || !isBotId(id)) return;
    g.players = g.players.filter(player => player.id !== id);
    const lobby = state.lobbies.find(item => item.id === state.activeLobbyId);
    if (lobby) { lobby.players = lobby.players.filter(player => player.id !== id); if (typeof syncLobbiesList === 'function') syncLobbiesList(); }
    botBusy.delete(id); botActedKey.delete(id); botLastChatAt.delete(id); botLastAnswered.delete(id);
    botOllamaStatus.delete(id); botMemory.delete(id); botBeliefs.delete(id); botRoles.delete(id); botTeammates.delete(id);
    publish();
  }
  function setBotField(id, field, value) {
    const g = game();
    if (!host() || !isBotId(id)) return;
    const bot = g.players.find(player => player.id === id);
    if (!bot) return;
    if (field === 'language') bot[field] = BOT_LANGUAGE_CODES.includes(value) ? value : 'tr';
    else bot[field] = value;
    if (field === 'name') {
      const lobby = state.lobbies.find(item => item.id === state.activeLobbyId);
      const lobbyPlayer = lobby?.players.find(player => player.id === id);
      if (lobbyPlayer) lobbyPlayer.name = value;
      if (typeof syncLobbiesList === 'function') syncLobbiesList();
    }
    publish();
  }
  function reassignBotsFromDeparted(peerId) {
    // Bir botun beynini çalıştıran (operatör) kişi odadan ayrılırsa kurucu devralır ki oyun tıkanmasın.
    const g = game();
    if (!host() || peerId === state.myId) return;
    let changed = false;
    g.players.filter(player => player.isBot && player.operatorId === peerId).forEach(bot => {
      bot.operatorId = state.myId;
      note(`${bot.name} adlı bot artık kurucunun bilgisayarında çalışıyor (önceki operatör ayrıldı).`);
      changed = true;
    });
    if (changed) { publish(); g.players.filter(player => player.isBot && player.operatorId === state.myId).forEach(bot => requestBotOllamaCheck(bot.id)); }
  }
  // --- Ollama istemcisi ---
  async function ollamaFetch(pathName, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${ollamaBase()}${pathName}`, { ...options, signal: controller.signal });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
  async function checkOllamaStatus() {
    try {
      const data = await ollamaFetch('/api/tags', { method: 'GET' }, 6000);
      const models = (data.models || []).map(item => item.name).filter(Boolean);
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }
  async function ollamaDecide(model, systemPrompt, userPrompt) {
    const data = await ollamaFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        stream: false,
        format: 'json',
        options: { temperature: 0.9 }
      })
    }, 9000);
    return JSON.parse(data?.message?.content || '{}');
  }
  async function runOllamaCheckForBot(bot) {
    botOllamaStatus.set(bot.id, { state: 'checking' });
    render();
    const result = await checkOllamaStatus();
    const detail = result.ok ? `${result.models.length} model bulundu` : (result.error || 'bağlantı hatası');
    botOllamaStatus.set(bot.id, { state: result.ok ? 'ok' : 'error', detail, models: result.models || [] });
    render();
    const payload = { type: 'vv-bot-ollama-status', botId: bot.id, ok: result.ok, detail, models: result.models || [] };
    const lobby = activeVampireLobby();
    (lobby?.players || []).forEach(player => { if (player.id !== state.myId && !isBotId(player.id)) broadcastTo(player.id, payload); });
  }
  function requestBotOllamaCheck(botId) {
    const bot = game().players.find(player => player.id === botId && player.isBot);
    if (!bot) return;
    if (bot.operatorId === state.myId) runOllamaCheckForBot(bot);
    else broadcastTo(bot.operatorId, { type: 'vv-bot-ollama-check', botId });
  }
  function clearPhaseTimer() { if (phaseTimer) clearTimeout(phaseTimer); phaseTimer = null; game().phaseEndsAt = 0; }
  function armPhaseTimer() {
    const g = game(); clearPhaseTimer();
    const configuredSeconds = Number(g.settings.phaseSeconds);
    const seconds = Number.isFinite(configuredSeconds) ? Math.min(120, Math.max(0, configuredSeconds)) : 0;
    if (!host() || !seconds || !['night', 'vote'].includes(g.phase)) return;
    const phase = g.phase;
    const round = g.round;
    const phaseEndsAt = Date.now() + seconds * 1000;
    g.phaseEndsAt = phaseEndsAt;
    phaseTimer = setTimeout(() => {
      const current = game();
      // clearTimeout cannot stop a callback that is already queued.  Do not let
      // such a stale callback resolve a newer round or a manually changed phase.
      if (current.phase !== phase || current.round !== round || current.phaseEndsAt !== phaseEndsAt) return;
      if (phase === 'night') resolveNight(true); else resolveVote();
    }, seconds * 1000);
  }
  function selectedRoles(count, settings) {
    const maxVampires = Math.max(1, count - 1);
    const requested = Number(settings.vampireCount);
    const vampires = settings.vampireCount === 'auto' || !Number.isFinite(requested)
      ? recommendedVampires(count)
      : Math.max(1, Math.min(requested, maxVampires));
    const capacity = Math.max(0, count - vampires - 1); // en az bir normal köylü kalsın
    const special = SPECIALS.filter(role => settings[role]).slice(0, capacity);
    return { vampires, special, ignored: SPECIALS.filter(role => settings[role]).slice(capacity) };
  }
  function start() {
    const g = game();
    if (!host()) return;
    const lobby = state.lobbies.find(item => item.id === state.activeLobbyId);
    g.players = (lobby?.players || g.players).map(player => ({ ...player, alive: true }));
    if (g.players.length < 4) return;
    const setup = selectedRoles(g.players.length, g.settings);
    const bag = [...Array(setup.vampires).fill('vampire'), ...setup.special, ...Array(g.players.length - setup.vampires - setup.special.length).fill('villager')];
    const shuffled = [...g.players].sort(() => Math.random() - 0.5);
    g.roles = Object.fromEntries(shuffled.map((player, index) => [player.id, bag[index]]));
    g.executionTargets = {};
    g.players.filter(player => g.roles[player.id] === 'executioner').forEach(executioner => {
      const candidates = g.players.filter(player => player.id !== executioner.id);
      g.executionTargets[executioner.id] = candidates[Math.floor(Math.random() * candidates.length)]?.id || null;
    });
    hideRoleReveal(); roleRevealKey = null; localSelections.clear();
    g.started = true; g.phase = 'night'; g.round = 1; g.actions = {}; g.used = {}; g.doctorHistory = {}; g.localDoctorLastTargetId = null; g.privateIntel = []; g.privateNote = ''; botDoctorLastTargets.clear(); botRewardScores.clear(); botOutcomeRewardKey = ''; g.pendingHunterId = null; g.winnerId = null; g.winnerTeam = null; g.voteAttempt = 0; g.voteCandidates = null; g.lastElimination = null;
    g.log = [`${g.round}. gece başladı. Herkes kendi gizli ekranındaki yeteneği kullanabilir.`];
    g.players.forEach(player => sendRole(player.id));
    const activeLobby = state.lobbies.find(item => item.id === state.activeLobbyId);
    if (activeLobby) activeLobby.status = 'playing';
    if (typeof syncLobbiesList === 'function') syncLobbiesList();
    armPhaseTimer();
    publish();
  }
  function roleOf(id) { return game().roles[id]; }
  function lastDoctorTargetFor(actorId) {
    const g = game();
    if (host()) return g.doctorHistory?.[actorId] || null;
    if (actorId === state.myId) return g.localDoctorLastTargetId || null;
    return botDoctorLastTargets.get(actorId) || null;
  }
  function recordDoctorTarget(actorId, targetId) {
    const g = game(), actor = g.players.find(player => player.id === actorId);
    if (!actor || !targetId) return;
    (g.doctorHistory ||= {})[actorId] = targetId;
    if (actor.isBot) {
      if (actor.operatorId === state.myId) botDoctorLastTargets.set(actorId, targetId);
      else broadcastTo(actor.operatorId, { type: 'vv-bot-doctor-history', botId: actorId, targetId });
    } else if (actorId === state.myId) g.localDoctorLastTargetId = targetId;
    else broadcastTo(actorId, { type: 'vv-doctor-history', targetId });
  }
  function setAction(actorId, action, targetId) {
    const g = game();
    const actor = g.players.find(player => player.id === actorId);
    const target = g.players.find(player => player.id === targetId);
    const role = roleOf(actorId);
    if (!actor || !target || !host()) return false;
    // Actions are host-authoritative and valid only in their own phase.  Without
    // this gate, a forged data-channel message could preload a night action.
    if (action === 'hunter' ? g.phase !== 'hunter-shot' : g.phase !== 'night') return false;
    const aliveTarget = target.alive;
    let accepted = false;
    if (action === 'vampire' && role === 'vampire' && actor.alive && aliveTarget && roleOf(targetId) !== 'vampire') { (g.actions.vampire ||= {})[actorId] = targetId; accepted = true; }
    if (action === 'doctor' && role === 'doctor' && actor.alive && aliveTarget && lastDoctorTargetFor(actorId) !== targetId) { g.actions.doctor = { actorId, targetId }; accepted = true; }
    if (action === 'seer' && role === 'seer' && actor.alive && aliveTarget) { g.actions.seer = { actorId, targetId }; accepted = true; }
    if (action === 'oracle' && role === 'oracle' && actor.alive && aliveTarget) { g.actions.oracle = { actorId, targetId }; accepted = true; }
    if (action === 'fool' && role === 'fool' && actor.alive && aliveTarget) { g.actions.fool = { actorId, targetId }; accepted = true; }
    if (action === 'spy' && role === 'spy' && actor.alive && aliveTarget) { g.actions.spy = { actorId, targetId }; accepted = true; }
    if (action === 'healer' && role === 'healer' && actor.alive && !g.used.healer && !aliveTarget) { g.actions.healer = { actorId, targetId }; accepted = true; }
    if (action === 'warrior' && role === 'warrior' && actor.alive && !g.used.warrior && aliveTarget && targetId !== actorId) { g.actions.warrior = { actorId, targetId }; accepted = true; }
    if (action === 'hunter' && role === 'hunter' && g.phase === 'hunter-shot' && g.pendingHunterId === actorId && aliveTarget && targetId !== actorId) { g.actions.hunter = { actorId, targetId }; accepted = true; }
    render();
    return accepted;
  }
  // Gizli sonuç bir bota aitse, mesaj o botu çalıştıran bilgisayara gider ve
  // orada botun hafızasına yazılır; başka kimse görmez.
  function directResult(id, message, intel) {
    if (game().players.find(player => player.id === id)?.isBot) return deliverBotNote(id, message, intel);
    if (id === state.myId) receivePrivateResult(message, intel);
    else broadcastTo(id, { type: 'vv-result', message, intel });
  }
  function receivePrivateResult(message, intel) {
    const g = game();
    g.privateNote = message;
    g.privateIntel = [...(g.privateIntel || []), { id: `${g.round}-${Date.now()}-${Math.random()}`, round: g.round, message, targetId: intel?.targetId || null }].slice(-8);
  }
  function deliverBotNote(botId, message, intel) {
    const bot = game().players.find(player => player.id === botId && player.isBot);
    if (!bot) return;
    if (bot.operatorId === state.myId) {
      addBotMemory(botId, `Sana özel bilgi: ${message}`, 'gizli');
      if (intel?.targetId) rememberBotBelief(botId, intel.targetId, intel.delta, intel.reason || message, 'doğrulanmış gizli bilgi');
      render();
    } else broadcastTo(bot.operatorId, { type: 'vv-bot-note', botId, message, intel });
  }
  function kill(id, reason) {
    const g = game(); const player = g.players.find(item => item.id === id);
    if (!player?.alive) return false;
    player.alive = false; note(`${player.name} ${reason}.`);
    if (roleOf(id) === 'hunter') { clearPhaseTimer(); g.pendingHunterId = id; g.phase = 'hunter-shot'; directResult(id, 'Avcı olarak elendin. Son atışını seç!'); return true; }
    return false;
  }
  function winner() {
    const g = game(); const remaining = alive();
    if (g.winnerId) return true;
    const vampires = remaining.filter(player => roleOf(player.id) === 'vampire').length;
    const villagers = remaining.filter(player => ROLE_INFO[roleOf(player.id)]?.team === 'village').length;
    if (!vampires) { g.phase = 'over'; g.winnerTeam = 'village'; clearPhaseTimer(); note('Köylüler kazandı: tüm vampirler elendi.'); rewardGameOutcome('village'); return true; }
    if (vampires >= villagers) { g.phase = 'over'; g.winnerTeam = 'vampire'; clearPhaseTimer(); note('Vampirler kazandı: köylü sayısına eşitlendiler.'); rewardGameOutcome('vampire'); return true; }
    return false;
  }
  function afterNight() {
    const g = game();
    if (winner()) return publish();
    g.phase = 'day'; clearPhaseTimer(); note('Gündüz başladı. Sesli sohbette tartışın, sonra kurucu oylamayı açsın.'); publish();
  }
  function requiredLocalNightAction() {
    const g = game();
    if (!host() || g.phase !== 'night' || !mine()?.alive) return null;
    const role = roleOf(state.myId);
    if (!['vampire', 'doctor', 'seer', 'oracle', 'fool', 'spy'].includes(role)) return null;
    if (role === 'vampire') return (g.actions.vampire || {})[state.myId] ? null : role;
    return g.actions[role]?.actorId === state.myId ? null : role;
  }
  function pendingLocalBotNightCount() {
    const g = game();
    if (!host() || g.phase !== 'night') return 0;
    return g.players.filter(bot => {
      if (!bot.isBot || !bot.alive || bot.operatorId !== state.myId) return false;
      const role = botRoleOf(bot.id);
      if (!['vampire', 'doctor', 'seer', 'oracle', 'fool', 'spy'].includes(role)) return false;
      if (role === 'vampire') return !(g.actions.vampire || {})[bot.id];
      return g.actions[role]?.actorId !== bot.id;
    }).length;
  }
  function resolveNight(force = false) {
    const g = game(); if (!host() || g.phase !== 'night') return;
    const missingAction = requiredLocalNightAction();
    if (!force && missingAction) {
      if (typeof showToast === 'function') showToast('Önce gece hedefini seçmelisin.', 'warn');
      render();
      return;
    }
    if (g.actions.doctor) recordDoctorTarget(g.actions.doctor.actorId, g.actions.doctor.targetId);
    const healer = g.actions.healer;
    if (healer) { const patient = g.players.find(player => player.id === healer.targetId); if (patient && !patient.alive) { patient.alive = true; g.used.healer = true; note(`Şifacı ${patient.name} adlı oyuncuyu hayata döndürdü.`); rewardBot(healer.actorId, 10, `${patient.name} başarıyla hayata döndürüldü.`); } }
    if (g.actions.seer) {
      const target = g.players.find(player => player.id === g.actions.seer.targetId); const foundRole = roleOf(target.id);
      directResult(g.actions.seer.actorId, `Büyücü sonucu: ${target.name} rolü ${ROLE_INFO[foundRole].name}.`, { targetId: target.id, delta: foundRole === 'vampire' ? 100 : -85, reason: `${target.name} rolü doğrulanmış olarak ${ROLE_INFO[foundRole].name}` });
      rewardBot(g.actions.seer.actorId, foundRole === 'vampire' ? 10 : 4, foundRole === 'vampire' ? 'İncelemen bir vampiri ortaya çıkardı.' : 'İncelemen yeni ve doğrulanmış rol bilgisi sağladı.');
    }
    if (g.actions.oracle) {
      const target = g.players.find(player => player.id === g.actions.oracle.targetId); const vampireSide = roleOf(target.id) === 'vampire';
      directResult(g.actions.oracle.actorId, `Kâhin sonucu: ${target.name} ${vampireSide ? 'vampir tarafında.' : 'köy tarafında.'}`, { targetId: target.id, delta: vampireSide ? 100 : -75, reason: `${target.name} tarafı doğrulandı: ${vampireSide ? 'vampir' : 'köy'}` });
      rewardBot(g.actions.oracle.actorId, vampireSide ? 10 : 4, vampireSide ? 'Kehanetin vampir tarafındaki birini buldu.' : 'Kehanetin yeni taraf bilgisi sağladı.');
    }
    if (g.actions.fool) {
      const target = g.players.find(player => player.id === g.actions.fool.targetId); const shownTeam = roleOf(target.id) === 'vampire' ? 'köy tarafında' : 'vampir tarafında';
      directResult(g.actions.fool.actorId, `Deli Köylü işareti (bilgi ters olabilir): ${target.name} ${shownTeam}.`, { targetId: target.id, delta: 0, reason: `${target.name} hakkında ters olabileceği bilinen güvenilmez işaret alındı` });
      rewardBot(g.actions.fool.actorId, 2, 'Yeni bir işaret topladın; ters olabileceğini unutmadan kullan.');
    }
    if (g.actions.spy) {
      const target = g.players.find(player => player.id === g.actions.spy.targetId); const vampireSide = roleOf(target.id) === 'vampire';
      directResult(g.actions.spy.actorId, `Casus sonucu: ${target.name} ${vampireSide ? 'vampir tarafında.' : 'vampir tarafında değil.'}`, { targetId: target.id, delta: vampireSide ? 95 : -70, reason: `${target.name} için casusluk sonucu: ${vampireSide ? 'vampir' : 'vampir değil'}` });
      rewardBot(g.actions.spy.actorId, vampireSide ? 10 : 4, vampireSide ? 'Casusluğun vampir tarafındaki birini buldu.' : 'Casusluğun yeni taraf bilgisi sağladı.');
    }
    if (g.actions.warrior) {
      g.used.warrior = true;
      const hitVampire = roleOf(g.actions.warrior.targetId) === 'vampire';
      rewardBot(g.actions.warrior.actorId, hitVampire ? 18 : -14, hitVampire ? 'Saldırın bir vampiri vurdu.' : 'Saldırın vampir olmayan bir oyuncuyu vurdu.');
      if (kill(g.actions.warrior.targetId, 'Savaşçının saldırısıyla elendi')) return publish();
    }
    const totals = Object.values(g.actions.vampire || {}).reduce((all, targetId) => ({ ...all, [targetId]: (all[targetId] || 0) + 1 }), {});
    const victimId = Object.keys(totals).sort((a, b) => totals[b] - totals[a])[0];
    const protectedId = g.actions.doctor?.targetId;
    Object.entries(g.actions.vampire || {}).forEach(([actorId, targetId]) => {
      if (targetId !== victimId) rewardBot(actorId, -4, 'Vampir takımıyla aynı hedefte birleşemedin.');
      else if (victimId === protectedId) rewardBot(actorId, -10, 'Seçtiğin kurban doktor tarafından kurtarıldı; saldırı başarısız oldu.');
      else rewardBot(actorId, 14, 'Seçtiğin kurban gece saldırısında öldü.');
    });
    if (g.actions.doctor) {
      const blocked = !!victimId && victimId === protectedId;
      rewardBot(g.actions.doctor.actorId, blocked ? 14 : -5, blocked ? 'Koruduğun oyuncuya gelen vampir saldırısını engelledin.' : 'Bu gece koruduğun oyuncuya vampir saldırısı gelmedi.');
    }
    if (victimId && victimId === protectedId) note('Gece sona erdi: Doktor bir kişinin ölümünü engelledi; bu gece kimse ölmedi.');
    else if (victimId && kill(victimId, 'gece sona erdiğinde vampirlerin saldırısında öldü')) return publish();
    else note('Vampirler hedef belirlemedi; gece sessiz geçti.');
    g.actions = {}; afterNight();
  }
  function hunterShot() {
    const g = game(); if (!host() || g.phase !== 'hunter-shot' || !g.actions.hunter) return;
    const hunterAction = g.actions.hunter;
    const targetId = hunterAction.targetId; g.pendingHunterId = null; g.actions = {};
    const hitVampire = roleOf(targetId) === 'vampire';
    rewardBot(hunterAction.actorId, hitVampire ? 18 : -14, hitVampire ? 'Son atışın bir vampiri vurdu.' : 'Son atışın vampir olmayan bir oyuncuyu vurdu.');
    if (kill(targetId, 'Avcının son atışıyla elendi')) return publish();
    afterNight();
  }
  function openVote() { const g = game(); if (!host() || g.phase !== 'day') return; g.phase = 'vote'; g.actions.votes = {}; g.voteAttempt = 1; g.voteCandidates = null; note('Oylama başladı. Her yaşayan oyuncu bir kez oy verir.'); armPhaseTimer(); publish(); }
  function castVote(actorId, targetId) {
    const g = game(); if (!host() || g.phase !== 'vote') return;
    g.actions.votes ||= {};
    const allowed = !g.voteCandidates?.length || g.voteCandidates.includes(targetId);
    if (allowed && actorId !== targetId && g.players.some(player => player.id === actorId && player.alive) && g.players.some(player => player.id === targetId && player.alive)) g.actions.votes[actorId] = targetId;
    render();
  }
  function resolveVote() {
    const g = game(); if (!host() || g.phase !== 'vote') return;
    const totals = Object.values(g.actions.votes || {}).reduce((all, targetId) => ({ ...all, [targetId]: (all[targetId] || 0) + 1 }), {});
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const tie = ranked.length > 1 && ranked[0][1] === ranked[1][1];
    if (!ranked[0]) { note('Henüz oy kullanılmadı; oylama açık kalıyor.'); return publish(); }
    if (tie && (g.voteAttempt || 1) < 2) {
      g.voteAttempt = 2;
      g.voteCandidates = ranked.filter(([, count]) => count === ranked[0][1]).map(([id]) => id);
      g.actions.votes = {};
      clearPhaseTimer();
      note(`Oylar eşitlendi. ${g.voteCandidates.length} aday arasında son tur başladı.`);
      armPhaseTimer();
      return publish();
    }
    const eliminatedId = tie ? ranked.filter(([, count]) => count === ranked[0][1]).map(([id]) => id).sort()[0] : ranked[0][0];
    const executionerId = Object.entries(g.executionTargets || {}).find(([id, targetId]) => id !== eliminatedId && targetId === eliminatedId && g.players.some(player => player.id === id && player.alive))?.[0];
    if (eliminatedId) {
      const eliminated = g.players.find(player => player.id === eliminatedId);
      const eliminatedRole = roleOf(eliminatedId);
      g.lastElimination = { id: eliminatedId, name: eliminated?.name || 'Oyuncu', role: eliminatedRole, roleName: ROLE_INFO[eliminatedRole]?.name || 'Bilinmiyor', team: ROLE_INFO[eliminatedRole]?.team || 'unknown', reason: tie ? 'İkinci eşitlikte kura' : 'Köy oylaması' };
      Object.entries(g.actions.votes || {}).forEach(([actorId, targetId]) => {
        const actor = g.players.find(player => player.id === actorId && player.isBot);
        if (!actor) return;
        if (targetId !== eliminatedId) rewardBot(actorId, -2, 'Oyun elenen aday üzerinde birleşmedi; oy gerekçeni yeniden değerlendir.');
        else {
          const actorRole = roleOf(actorId);
          if (actorRole === 'vampire') rewardBot(actorId, eliminatedRole === 'vampire' ? -12 : 10, eliminatedRole === 'vampire' ? 'Oyun vampir takımından birinin sürülmesine katkı sağladı.' : 'Oyun köy tarafındaki birinin sürülmesine katkı sağladı.');
          else if (actorRole === 'executioner') {
            const hitTarget = g.executionTargets?.[actorId] === eliminatedId;
            rewardBot(actorId, hitTarget ? 18 : -3, hitTarget ? 'Oyun gizli hedefinin sürülmesini sağladı.' : 'Oyun gizli hedefin yerine başka birini sürdürdü.');
          } else rewardBot(actorId, eliminatedRole === 'vampire' ? 12 : -8, eliminatedRole === 'vampire' ? 'Oyun bir vampirin sürülmesine katkı sağladı.' : 'Oyun vampir olmayan bir oyuncunun sürülmesine katkı sağladı.');
        }
      });
      const wasHunter = kill(eliminatedId, tie ? 'ikinci eşitlikte kura ile sürüldü' : 'köy oylamasıyla sürüldü');
      if (executionerId) {
        g.winnerId = executionerId;
        g.winnerTeam = 'executioner';
        g.phase = 'over';
        clearPhaseTimer();
        note(`${g.players.find(player => player.id === executionerId).name} adlı Cellat gizli hedefini oylamayla sürdürdü ve tek başına kazandı!`);
        rewardGameOutcome('executioner', executionerId);
        return publish();
      }
      if (wasHunter) return publish();
    }
    if (winner()) return publish();
    g.phase = 'vote-result'; g.actions = {}; g.voteCandidates = null; clearPhaseTimer(); publish();
  }
  function continueAfterVoteResult() {
    const g = game(); if (!host() || g.phase !== 'vote-result') return;
    g.phase = 'night'; g.round += 1; g.actions = {}; g.lastElimination = null; note(`${g.round}. gece başladı. Gizli roller harekete geçiyor.`); armPhaseTimer(); publish();
  }
  const selectionKey = action => `${game().round}:${game().phase}:${action}`;
  function selectedTargetFor(action) {
    const g = game();
    if (host()) {
      if (action === 'vampire') return (g.actions.vampire || {})[state.myId] || null;
      if (action === 'vote') return (g.actions.votes || {})[state.myId] || null;
      return g.actions[action]?.actorId === state.myId ? g.actions[action].targetId : null;
    }
    return localSelections.get(selectionKey(action)) || null;
  }
  function sendAction(action, targetId) {
    const g = game();
    localSelections.set(selectionKey(action), targetId);
    if (host()) setAction(state.myId, action, targetId);
    else { render(); broadcastTo(g.host, { type: 'vv-action', action, targetId }); }
  }
  function sendVote(targetId) {
    const g = game();
    localSelections.set(selectionKey('vote'), targetId);
    if (host()) { castVote(state.myId, targetId); publish(); }
    else { render(); broadcastTo(g.host, { type: 'vv-vote', targetId }); }
  }
  function submitBotAction(bot, kind, targetId) {
    const g = game();
    if (kind === 'vote') { if (host()) { castVote(bot.id, targetId); publish(); } else broadcastTo(g.host, { type: 'vv-bot-vote', botId: bot.id, targetId }); return; }
    if (host()) setAction(bot.id, kind, targetId); else broadcastTo(g.host, { type: 'vv-bot-action', botId: bot.id, action: kind, targetId });
  }
  function sendBotChat(bot, text) {
    const lobby = activeVampireLobby();
    if (!lobby) return;
    const message = { type: 'vv-chat', id: crypto.randomUUID(), senderId: bot.id, text, sentAt: Date.now() };
    addLobbyChatMessage(message);
    lobby.players.forEach(player => { if (player.id !== state.myId) broadcastTo(player.id, message); });
  }
  // --- Bot beyni: kurallar + rol + sohbet geçmişini Ollama'ya gönderip karar alma ---
  function gameRulesText() {
    const roleLines = ['vampire', 'villager', ...SPECIALS].map(key => `- ${ROLE_INFO[key].name} (${key}): ${ROLE_INFO[key].desc}`).join('\n');
    return [
      'OYUNUN KURALLARI (küçük modeller için sade anlatım):',
      'VAMPİR KÖYLÜ, gizli rollere dayalı bir sosyal çıkarım oyunudur (Werewolf/Mafia türü). Her oyuncunun gizli bir rolü vardır ve kimse başkasının rolünü bilmez.',
      'Roller:',
      roleLines,
      'Fazlar sırayla tekrar eder:',
      '1) GECE: Herkes susar. Vampirler ortak bir kurban seçer. Doktor kendisi dahil yaşayan bir kişiyi korur, fakat önceki gece koruduğu kişiyi hemen tekrar seçemez. Büyücü/Kâhin/Casus/Deli Köylü bir kişiyi araştırır ve gizli bir bilgi alır (Deli Köylünün aldığı bilgi her zaman terstir). Şifacı ölü birini bir kez diriltebilir, Savaşçı bir kez saldırabilir.',
      '2) GÜNDÜZ: Gece kimin öldüğü herkese açıklanır. Herkes sohbette konuşur, suçlar, savunur, soru sorar ve bilgi paylaşır. İstersen rolünü açıklarsın ya da yalan söylersin.',
      '3) OYLAMA: Yaşayan herkes bir kişiye oy verir. En çok oyu alan köyden sürülür ve elenir. İlk eşitlikte yalnızca eşit adaylarla son tur yapılır; ikinci eşitlikte kura tek kişiyi sürgün eder. Avcı elenirse ölürken bir kişiyi vurur.',
      'Kazanma: Tüm vampirler elenirse KÖY kazanır. Vampir sayısı yaşayan köylü sayısına eşitlenirse VAMPİRLER kazanır. Cellat, gizli hedefi gündüz oylamasıyla sürülürse tek başına kazanır.',
      'Bilmen gerekenler: Elenen oyuncu bir daha konuşamaz ve oy veremez. Gece yaptığın seçimi kimse görmez, gündüz söylediğin her şeyi herkes görür. Aldığın gizli bilgileri hafızandan takip et; kimin ne dediğini ve kimin kime oy verdiğini unutma.'
    ].join('\n');
  }
  // Botun içinde bulunduğu anlık durum: küçük modeller bunu kurallardan çıkaramaz, açıkça yazılır.
  function situationText() {
    const g = game();
    const phaseText = { lobby: 'Oyun henüz başlamadı, lobide bekliyor ve sohbet ediyorsunuz', night: `${g.round}. GECE (kimse konuşmuyor, gizli seçim zamanı)`, day: `${g.round}. GÜNDÜZ tartışması (herkes konuşuyor)`, vote: `${g.round}. tur OYLAMA fazı`, 'vote-result': 'Oylama sonucu ve sürgün kimliği açıklanıyor', 'hunter-shot': 'Avcının son atışı', over: 'Oyun bitti' }[g.phase] || g.phase;
    const living = alive().map(player => player.name).join(', ') || 'yok';
    const dead = g.players.filter(player => !player.alive).map(player => player.name).join(', ');
    return `ŞU ANKİ DURUM: ${phaseText}. Yaşayanlar: ${living}.${dead ? ` Elenenler: ${dead}.` : ' Henüz kimse elenmedi.'}`;
  }
  function roleStrategyText(role) {
    const strategies = {
      vampire: 'Vampirsin: takım arkadaşlarını hedef alma veya gereksiz yere suçlama. Köyün güvendiği ya da bilgi rolü olabilecek kişileri gece ele. Gündüz gerçek sohbet çelişkilerini seçerek büyütebilir, şüpheyi başka yöne çekebilir ve takım arkadaşını ölçülü biçimde savunabilirsin. Yalanın tutarlı ve kontrol edilebilir olsun: olmayan bir gece sonucunu kesin gerçek diye uydurma; gerekirse belirsiz gözlem, davranış yorumu veya sahte ama sürdürülebilir bir rol iddiası kullan. Çok saldırganlaşıp kendini belli etme.',
      villager: 'Köylüsün: kesin bilgiye sahipmiş gibi davranma. Çelişkileri, oy davranışını ve savunmaları kıyasla; zayıf kanıtta fikrini değiştirmeye açık ol.',
      seer: 'Büyücüsün: daha önce incelemediğin kişileri araştır. Doğrulanmış vampiri uygun zamanda paylaş; köylü sonucu masumiyet için güçlü ama kusursuz olmayan dayanak olarak kullan.',
      oracle: 'Kâhinsin: taraf sonuçlarını biriktir, aynı kişiyi boşa tekrar inceleme ve bilgi açıklarken gece hedefi olmamayı düşün.',
      fool: 'Deli Köylüsün: sonuçlarının ters olduğunu biliyorsun; sonucu tek başına kanıt sayma, diğer davranışlarla karşılaştır.',
      doctor: 'Doktorsun: kendin dahil bilgi rolü iddiasındaki veya köy için değerli görünen kişiyi koru. Aynı kişiyi iki gece üst üste koruyamazsın; geçerli adaylardan yeni bir hedef seç.',
      healer: 'Şifacısın: tek hakkını erken ve değersiz kullanma; köye bilgi sağlayan veya güçlü biçimde masum görünen birini diriltmeyi tercih et.',
      hunter: 'Avcısın: son atışta en yüksek şüpheliyi seç; sırf seni suçladı diye birini vurma.',
      warrior: 'Savaşçısın: tek saldırını orta veya güçlü kanıt oluşmadan harcama.',
      spy: 'Casussun: taraf bilgisini biriktir, doğruladığın vampiri köye aktarırken kendi güvenliğini de düşün.',
      executioner: 'Cellatsın: gizli hedefinin sürülmesini sağlamaya çalış; hedefe karşı inandırıcı ama ölçülü bir dava kur ve bağımsız rolünü gizle.'
    };
    return strategies[role] || strategies.villager;
  }
  function botSystemPrompt(bot, role) {
    const roleInfo = ROLE_INFO[role];
    const persona = (bot?.persona || '').trim();
    const languageCode = BOT_LANGUAGE_CODES.includes(bot?.language) ? bot.language : 'tr';
    const languageName = botLanguageName(languageCode);
    return [
      `Sen "Vampir Köylü" oyununda oynayan otonom bir oyuncusun. Adın: ${bot?.name || 'Bot'}. Bir insan seni yönetmiyor; kararları sen veriyorsun.`,
      persona ? `Karakterin (bu kişilikle konuş ve oyna): ${persona}` : '',
      gameRulesText(),
      `Senin gizli rolün: ${roleInfo ? `${roleInfo.name} (${role}) — ${roleInfo.desc}` : 'oyun başlamadı, henüz rolün yok'}.`,
      situationText(),
      `ROL STRATEJİN: ${roleStrategyText(role)}`,
      'ORTALAMA OYUNCU SEVİYESİ: Kusursuz veya her şeyi bilen biri değilsin. Yalnızca sana verilen gizli bilgiler, açık olaylar ve sohbette gördüklerin üzerinden çıkarım yap. İddia ile doğrulanmış bilgiyi ayır; kanıt zayıfsa emin olmadığını söyle ve yeni bilgi gelince fikrini değiştirebil.',
      'KARAR DİSİPLİNİ: Önce en fazla üç somut gözlemi tart, sonra hedef seç. Aynı suçlamayı kanıtsız tekrarlama, rastgele hedef değiştirme, elenmiş oyuncuyu hedefleme ve kendi gizli bilgilerinle çelişme. Şüphe tablosundaki puan bir yardımcıdır; gerekçesiz kesin gerçek değildir. İnsanların sohbetteki iddiaları seni ikna edebilir ama bunları doğrulanmış bilgi sayma; iddiayı söyleyenin güvenilirliğini ve karşı savunmayı da tart.',
      'PEKİŞTİRMELİ ÖĞRENME: Kendi önceki eylemlerinden ödül veya ceza alırsın. Ödül alan kararların hangi kanıta dayandığını hatırla; ceza alan hedefleri körü körüne tekrarlama. Yine de tek bir sonuçtan kesin kural çıkarma ve yalnızca sana gösterilen bilgilerle düşün.',
      `SOHBET DİLİ: Yalnızca ${languageName} (${languageCode}) konuş. Başka dilde kelime veya cümle karıştırma. Oyuncu adlarını aynen koru. Sana bir soru sorulduysa ya da adın geçtiyse cevap ver. Mesajın doğal ve kısa olsun (çoğunlukla 1, en fazla 2 cümle); "yapay zeka", prompt veya model olduğundan bahsetme.`,
      'SOSYAL OYUN: Rolüne uygunsa bilgi paylaşabilir, savunma yapabilir, soru sorabilir veya aldatabilirsin. Biri senden şüphelenirse suçlamayı görmezden gelme: somut kanıtını sor, iddiasındaki boşluğu göster veya gerçek bir olayla karşı savunma yap. Bir oyuncu başka birini yalnızca “bence vampir” diyerek, gece/oy/çelişki gibi hiçbir somut gerekçe göstermeden suçlarsa hedefi hemen suçlu sayma; suçlayandan kanıt iste ve kanıtsız baskıyı suçlayanın güvenilirliği aleyhine değerlendir. Başkasını suçlarken yalnızca gördüğün sohbet, oy davranışı ve açık olaylardan gerçek bir gerekçe seç; gerekçe yoksa kesin hüküm yerine soru sor. Ancak gerçek bir ortalama oyuncu gibi ölçülü ol; her mesajda rol açıklama, sürekli aynı kişiye yüklenme veya hiçbir dayanak olmadan kesin konuşma.',
      'Sana her istekte geçerli hedef kimlikleri (id) listesi verilecek; targetId alanı için SADECE bu listeden bir id seçebilirsin ya da isteğe bağlıysa null bırakabilirsin.',
      'ÇOK ÖNEMLİ: Yanıtın SADECE tek bir JSON nesnesi olsun; açıklama, markdown veya kod bloğu yazma. Şema: {"dusunce":"<kanıta dayalı kısa özel muhakeme>","targetId":"<geçerli id veya null>","chat":"<seçilen dilde kısa mesaj veya null>","supheler":[{"targetId":"<oyuncu id>","delta":<-20 ile 20>,"neden":"<kısa gerekçe>"}]}',
      'supheler alanı yalnızca bu tur gördüğün davranışların kanaatini nasıl değiştirdiğini anlatır: pozitif delta daha şüpheli, negatif delta daha güvenilir demektir. Kesin gizli sonuçlar sistem tarafından ayrıca işlenir.',
      'Örnek doğru yanıt: {"dusunce":"Ali savunmasını değiştirdi ama kesin kanıtım yok.","targetId":"abc-123","chat":"Ali, önceki sözünle bu söylediğin çelişiyor; açıklar mısın?","supheler":[{"targetId":"abc-123","delta":12,"neden":"savunması değişti"}]}'
    ].filter(Boolean).join('\n');
  }
  function botDecisionContext(bot) {
    const g = game();
    const roster = g.players.map(player => `${player.id} = ${player.name}${player.alive ? '' : ' (elendi)'}`).join('\n');
    const chatLines = (g.chat || []).slice(-20).map(message => `${message.name}: ${message.text}`).join('\n') || '(henüz mesaj yok)';
    const memoryLines = botMemoryLines(bot.id).slice(-25).join('\n') || '(hafızan henüz boş)';
    const eventLines = (g.log || []).slice(0, 8).join('\n') || '(henüz olay yok)';
    const beliefLines = botBeliefSummary(bot.id);
    const rewardLine = botRewardSummary(bot.id);
    return { roster, chatLines, memoryLines, eventLines, beliefLines, rewardLine };
  }
  function botCandidates(bot, kind) {
    const g = game(), allAlive = alive();
    if (kind === 'vampire') { const friends = botKnownVampires(bot.id); return allAlive.filter(player => player.id !== bot.id && !friends.has(player.id)); }
    if (kind === 'doctor') { const previous = lastDoctorTargetFor(bot.id); return allAlive.filter(player => player.id !== previous); }
    if (['seer', 'oracle', 'fool', 'spy'].includes(kind)) return allAlive;
    if (kind === 'healer') return g.players.filter(player => !player.alive);
    const votePool = g.voteCandidates?.length ? allAlive.filter(player => g.voteCandidates.includes(player.id)) : allAlive;
    if (kind === 'vote' && botRoleOf(bot.id) === 'vampire') { const friends = botKnownVampires(bot.id); return votePool.filter(player => player.id !== bot.id && !friends.has(player.id)); }
    if (kind === 'vote') return votePool.filter(player => player.id !== bot.id);
    if (kind === 'warrior' || kind === 'hunter') return allAlive.filter(player => player.id !== bot.id);
    return [];
  }
  function fallbackBotTarget(bot, kind, candidates) {
    if (!candidates.length) return null;
    const beliefs = botBeliefs.get(bot.id) || new Map();
    const ranked = candidates.map(player => {
      const belief = beliefs.get(player.id) || { score: 0, evidence: [] };
      return { player, score: belief.score || 0, evidenceCount: belief.evidence?.length || 0 };
    });
    const stable = (a, b) => String(a.player.id).localeCompare(String(b.player.id));
    if (['seer', 'oracle', 'fool', 'spy'].includes(kind)) {
      // Ortalama bilgi rolü aynı kişiyi tekrar tekrar incelemek yerine bilinmeyene gider.
      ranked.sort((a, b) => a.evidenceCount - b.evidenceCount || Math.abs(a.score) - Math.abs(b.score) || stable(a, b));
      return ranked[0].player.id;
    }
    if (kind === 'doctor' || kind === 'healer' || kind === 'vampire') {
      // Doktor/şifacı en güvendiğini, vampir ise köyün güvenilir kalabilecek üyesini seçer.
      ranked.sort((a, b) => a.score - b.score || b.evidenceCount - a.evidenceCount || stable(a, b));
      if (kind === 'healer' && ranked[0].score > -25) return null;
      return ranked[0].player.id;
    }
    // Oy, savaşçı ve avcı için en kuvvetli şüphe öne çıkar.
    ranked.sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount || stable(a, b));
    if (kind === 'warrior' && ranked[0].score < 45) return null;
    return ranked[0].player.id;
  }
  const BOT_TASK_LABEL = {
    vampire: 'Gece saldırı hedefini seç (vampir takımı adına).',
    doctor: 'Bu gece korumak istediğin oyuncuyu seç. Önceki geceki hedefin geçerli adaylardan çıkarılmıştır.',
    seer: 'Bu gece tam rolünü öğrenmek istediğin oyuncuyu seç.',
    oracle: 'Bu gece vampir tarafında olup olmadığını öğrenmek istediğin oyuncuyu seç.',
    fool: 'Bu gece araştırmak istediğin oyuncuyu seç (unutma: sonuç sana ters gösterilecek).',
    spy: 'Bu gece vampir tarafında olup olmadığını araştırmak istediğin oyuncuyu seç.',
    healer: 'İstersen elenmiş bir oyuncuyu diriltmek için seç (tek kullanımlık hakkın); istemiyorsan targetId null bırak.',
    warrior: 'İstersen gece saldırısı yapmak için hedef seç (tek kullanımlık hakkın); istemiyorsan targetId null bırak.',
    hunter: 'Elendin; son atış hakkın için bir hedef seç.',
    vote: 'Gündüz oylamasında köyden sürülmesini istediğin oyuncuya oy ver.'
  };
  function pendingBotWork() {
    const g = game();
    if (!g.started || g.phase === 'over') return [];
    const work = [];
    g.players.filter(player => player.isBot && player.alive && player.operatorId === state.myId).forEach(bot => {
      const role = botRoleOf(bot.id);
      let kind = null;
      if (g.phase === 'night') {
        if (role === 'vampire' && !(g.actions.vampire || {})[bot.id]) kind = 'vampire';
        else if (role === 'doctor' && g.actions.doctor?.actorId !== bot.id) kind = 'doctor';
        else if (role === 'seer' && g.actions.seer?.actorId !== bot.id) kind = 'seer';
        else if (role === 'oracle' && g.actions.oracle?.actorId !== bot.id) kind = 'oracle';
        else if (role === 'fool' && g.actions.fool?.actorId !== bot.id) kind = 'fool';
        else if (role === 'spy' && g.actions.spy?.actorId !== bot.id) kind = 'spy';
        else if (role === 'healer' && !g.used.healer && g.actions.healer?.actorId !== bot.id && botCandidates(bot, 'healer').length) kind = 'healer';
        else if (role === 'warrior' && !g.used.warrior && g.actions.warrior?.actorId !== bot.id) kind = 'warrior';
      } else if (g.phase === 'vote') {
        if (!(g.actions.votes || {})[bot.id]) kind = 'vote';
      } else if (g.phase === 'hunter-shot') {
        if (g.pendingHunterId === bot.id && g.actions.hunter?.actorId !== bot.id) kind = 'hunter';
      }
      if (!kind) return;
      const key = `${g.phase}:${g.round}:${kind}:${kind === 'vote' ? (g.voteAttempt || 1) : 0}`;
      if (botActedKey.get(bot.id) === key || botBusy.has(bot.id)) return;
      work.push({ bot, kind, key });
    });
    return work;
  }
  async function runBotDecision(bot, kind, key) {
    try {
      const role = botRoleOf(bot.id);
      const candidates = botCandidates(bot, kind);
      if (!candidates.length) return;
      const { roster, chatLines, memoryLines, eventLines, beliefLines, rewardLine } = botDecisionContext(bot);
      const system = botSystemPrompt(bot, role);
      const user = `Görev: ${BOT_TASK_LABEL[kind]}\nGeçerli hedefler (targetId için SADECE bunlardan birini seçebilirsin; listede hem gerçek oyuncular hem botlar olabilir):\n${candidates.map(player => `${player.id} = ${player.name}`).join('\n')}\nOyuncu listesi:\n${roster}\nŞüphe tablon (-100 güvenilir, +100 çok şüpheli; puanlar kesin gerçek değildir):\n${beliefLines}\nÖdül/ceza durumun:\n${rewardLine}\nHafızan (yalnızca sen biliyorsun):\n${memoryLines}\nSon olaylar:\n${eventLines}\nSon lobi sohbeti:\n${chatLines}`;
      let decision = null;
      const ollamaUnavailable = botOllamaStatus.get(bot.id)?.state === 'error';
      if (!ollamaUnavailable) { try { decision = await ollamaDecide(bot.model || defaultBotModel(), system, user); } catch (_) { decision = null; } }
      const optional = kind === 'healer' || kind === 'warrior';
      applyDecisionBeliefs(bot, decision);
      let targetId = decision && candidates.some(player => player.id === decision.targetId) ? decision.targetId : null;
      const fallback = !targetId && (!optional || !decision);
      if (fallback) targetId = fallbackBotTarget(bot, kind, candidates);
      if (typeof decision?.dusunce === 'string' && decision.dusunce.trim()) addBotMemory(bot.id, `Düşüncen: ${decision.dusunce.trim()}`, 'dusunce');
      if (targetId) {
        submitBotAction(bot, kind, targetId);
        const targetName = game().players.find(player => player.id === targetId)?.name || targetId;
        addBotMemory(bot.id, `${BOT_TASK_LABEL[kind]} → ${targetName}${fallback ? ' (kanıt ve rol stratejisine göre yedek seçim)' : ''}`, 'karar');
      }
      const chatText = decision && typeof decision.chat === 'string' ? decision.chat.trim().slice(0, 500) : '';
      if (chatText && Date.now() - (botLastChatAt.get(bot.id) || 0) > BOT_CHAT_COOLDOWN_MS) {
        sendBotChat(bot, chatText); botLastChatAt.set(bot.id, Date.now());
        addBotMemory(bot.id, `Sohbette sen dedin ki: ${chatText}`, 'sohbet');
      }
    } finally {
      botActedKey.set(bot.id, key);
      render();
    }
  }
  function fallbackBotChat(bot, addressedBy) {
    const g = game();
    const code = BOT_LANGUAGE_CODES.includes(bot.language) ? bot.language : 'tr';
    const beliefs = botBeliefs.get(bot.id) || new Map();
    const candidates = alive().filter(player => player.id !== bot.id && !botKnownVampires(bot.id).has(player.id));
    const suspect = [...candidates].sort((a, b) => (beliefs.get(b.id)?.score || 0) - (beliefs.get(a.id)?.score || 0))[0];
    const suspectName = suspect?.name || candidates[0]?.name || 'arkadaşlar';
    const score = suspect ? (beliefs.get(suspect.id)?.score || 0) : 0;
    const publicEvidence = suspect ? (beliefs.get(suspect.id)?.evidence || []).filter(item => !String(item.source).includes('gizli')).slice(-1)[0] : null;
    const phrases = {
      tr: { lobby: 'Hazırım, güzel bir oyun olsun.', reply: 'Buradayım; söylediklerini düşünüyorum, biraz daha açıklar mısın?', suspect: `${suspectName} şu an bana daha şüpheli geliyor; savunmasını duymak istiyorum.`, question: `${suspectName}, bu tur en çok kimden şüpheleniyorsun?` },
      en: { lobby: 'I am ready. Let us have a good game.', reply: 'I am here and thinking about what you said. Can you explain a little more?', suspect: `${suspectName} looks more suspicious to me right now. I want to hear a defense.`, question: `${suspectName}, who do you suspect most this round?` },
      de: { lobby: 'Ich bin bereit. Auf ein gutes Spiel.', reply: 'Ich bin da und denke über deine Aussage nach. Kannst du das genauer erklären?', suspect: `${suspectName} wirkt für mich gerade verdächtiger. Ich möchte eine Erklärung hören.`, question: `${suspectName}, wen verdächtigst du in dieser Runde am meisten?` },
      es: { lobby: 'Estoy listo. Que tengamos una buena partida.', reply: 'Estoy aquí y pensando en lo que dijiste. ¿Puedes explicarlo un poco más?', suspect: `${suspectName} me parece más sospechoso ahora. Quiero escuchar su defensa.`, question: `${suspectName}, ¿de quién sospechas más esta ronda?` },
      fr: { lobby: 'Je suis prêt. Faisons une bonne partie.', reply: 'Je suis là et je réfléchis à ce que tu as dit. Peux-tu préciser ?', suspect: `${suspectName} me paraît plus suspect pour le moment. Je veux entendre sa défense.`, question: `${suspectName}, qui soupçonnes-tu le plus ce tour-ci ?` },
      'pt-BR': { lobby: 'Estou pronto. Que seja uma boa partida.', reply: 'Estou aqui e pensando no que você disse. Pode explicar melhor?', suspect: `${suspectName} parece mais suspeito agora. Quero ouvir a defesa.`, question: `${suspectName}, de quem você mais suspeita nesta rodada?` },
      ru: { lobby: 'Я готов. Пусть игра будет хорошей.', reply: 'Я здесь и обдумываю твои слова. Можешь объяснить подробнее?', suspect: `${suspectName} сейчас кажется мне подозрительнее. Хочу услышать объяснение.`, question: `${suspectName}, кого ты больше всего подозреваешь в этом раунде?` },
      ar: { lobby: 'أنا جاهز. أتمنى أن تكون لعبة جيدة.', reply: 'أنا هنا وأفكر فيما قلته. هل يمكنك التوضيح أكثر؟', suspect: `${suspectName} يبدو أكثر إثارة للشك الآن. أريد سماع دفاعه.`, question: `${suspectName}، من تشتبه به أكثر في هذه الجولة؟` },
      kk: { lobby: 'Мен дайынмын. Жақсы ойын болсын.', reply: 'Мен осындамын, айтқаныңды ойлап отырмын. Толығырақ түсіндіресің бе?', suspect: `${suspectName} қазір маған күмәндірек көрінеді. Оның жауабын тыңдағым келеді.`, question: `${suspectName}, осы айналымда кімнен көбірек күмәнданасың?` },
      tk: { lobby: 'Men taýýar. Gowy oýun bolsun.', reply: 'Men şu ýerde, aýdanlaryň hakda pikir edýärin. Has giňişleýin düşündirersiňmi?', suspect: `${suspectName} häzir maňa has şübheli görünýär. Jogabyny eşitmek isleýärin.`, question: `${suspectName}, bu tapgyrda kimden has köp şübhelenýärsiň?` },
      mn: { lobby: 'Би бэлэн. Сайхан тоглоцгооё.', reply: 'Би энд байна, хэлснийг чинь бодож байна. Илүү тодорхой тайлбарлаж болох уу?', suspect: `${suspectName} одоогоор надад илүү сэжигтэй санагдаж байна. Тайлбарыг нь сонсмоор байна.`, question: `${suspectName}, энэ тойрогт хэнийг хамгийн их сэжиглэж байна?` },
      'zh-CN': { lobby: '我准备好了，祝大家玩得开心。', reply: '我在听，也在思考你说的话。能再解释清楚一点吗？', suspect: `${suspectName}现在看起来更可疑，我想听听解释。`, question: `${suspectName}，这一轮你最怀疑谁？` },
      ja: { lobby: '準備できました。いい試合にしましょう。', reply: '聞いています。もう少し詳しく説明してもらえますか？', suspect: `${suspectName}が今は少し怪しく見えます。説明を聞きたいです。`, question: `${suspectName}、このラウンドで一番疑っているのは誰ですか？` }
    };
    const set = phrases[code] || phrases.tr;
    if (!g.started) return set.lobby;
    if (addressedBy?.challengeBaseless) {
      const target = addressedBy.targetNames?.join(', ') || 'o oyuncu';
      if (code === 'tr') return `${addressedBy.name}, ${target} hakkında hangi somut olaya dayanıyorsun? Sadece “bence” demek kanıt değil.`;
      if (code === 'en') return `${addressedBy.name}, what concrete event supports your claim about ${target}? Saying “I think so” is not evidence.`;
      return set.reply;
    }
    if (addressedBy?.accusation) {
      if (code === 'tr') return `${addressedBy.name}, benden şüpheleniyorsan hangi sözüm veya oyum yüzünden olduğunu söyle. Somut kanıtın ne?`;
      if (code === 'en') return `${addressedBy.name}, if you suspect me, say which statement or vote caused it. What is your evidence?`;
      return set.reply;
    }
    if (addressedBy) return set.reply;
    if (publicEvidence && score >= 12) {
      if (code === 'tr') return `${suspectName}'den şüpheleniyorum; gerekçem şu: ${String(publicEvidence.reason).slice(0, 135)}. ${suspectName}, buna cevabın ne?`;
      if (code === 'en') return `I suspect ${suspectName}; my reason is: ${String(publicEvidence.reason).slice(0, 135)}. ${suspectName}, how do you answer that?`;
    }
    return score >= 20 ? set.suspect : set.question;
  }
  async function runBotChat(bot, addressedBy) {
    botBusy.add(bot.id);
    botLastChatAt.set(bot.id, Date.now());
    try {
      const role = botRoleOf(bot.id);
      const g = game();
      const { roster, chatLines, memoryLines, eventLines, beliefLines, rewardLine } = botDecisionContext(bot);
      const system = botSystemPrompt(bot, role);
      const task = addressedBy
        ? addressedBy.challengeBaseless
          ? `${addressedBy.name}, ${addressedBy.targetNames?.join(', ') || 'bir oyuncu'} hakkında hiçbir somut gece, oy veya çelişki gerekçesi göstermeden suçlama yaptı: "${addressedBy.text}"\nBu kanıtsız suçlamaya itiraz et; hangi somut olaya dayandığını sor. Hedefi hemen suçlu kabul etme ve kısa konuş (targetId null olsun).`
          : addressedBy.accusation
          ? `${addressedBy.name} sohbette doğrudan senden şüphelendi veya seni suçladı: "${addressedBy.text}"\nSuçlamayı görmezden gelme. Kısa ama gerçek bir savunma yap; hangi somut kanıta dayandığını sor ve elindeki açık olaylardan uygunsa bir karşı gerekçe göster. Uydurma olay anlatma (targetId null olsun).`
          : `${addressedBy.name} sohbette sana sesleniyor ya da soru soruyor: "${addressedBy.text}"\nOna kısaca cevap ver (targetId null olsun). İstersen sen de karşı soru sor.`
        : g.started
          ? 'Sohbete kendi başına katıl: şüpheni söyle, birine soru sor, savunma yap ya da bilgi paylaş. Kısa tek bir mesaj yaz (targetId null olsun).'
          : 'Oyun daha başlamadı, lobide bekliyorsunuz. Kısa ve samimi bir lobi mesajı yaz (targetId null olsun).';
      const user = `${task}\nOyuncu listesi:\n${roster}\nŞüphe tablon (-100 güvenilir, +100 çok şüpheli; puanlar kesin gerçek değildir):\n${beliefLines}\nÖdül/ceza durumun:\n${rewardLine}\nHafızan (yalnızca sen biliyorsun):\n${memoryLines}\nSon olaylar:\n${eventLines}\nSon lobi sohbeti:\n${chatLines}`;
      let decision = null;
      const ollamaUnavailable = botOllamaStatus.get(bot.id)?.state === 'error';
      if (!ollamaUnavailable) { try { decision = await ollamaDecide(bot.model || defaultBotModel(), system, user); } catch (_) { decision = null; } }
      applyDecisionBeliefs(bot, decision);
      if (typeof decision?.dusunce === 'string' && decision.dusunce.trim()) addBotMemory(bot.id, `Düşüncen: ${decision.dusunce.trim()}`, 'dusunce');
      const generated = decision && typeof decision.chat === 'string' ? decision.chat.trim().slice(0, 500) : '';
      const text = generated || fallbackBotChat(bot, addressedBy);
      if (text) { sendBotChat(bot, text); addBotMemory(bot.id, `Sohbette sen dedin ki: ${text}`, 'sohbet'); }
    } finally {
      botBusy.delete(bot.id);
    }
  }
  // Son mesaj botun adını anıyorsa ya da soru soruyorsa, bot cevap vermek için öne geçer.
  function addressedMessageFor(bot) {
    const g = game();
    const recent = [...(g.chat || [])].slice(-5).reverse().filter(message => message.senderId !== bot.id && Date.now() - (message.sentAt || 0) <= 90000 && botLastAnswered.get(bot.id) !== message.id);
    const analyzed = recent.map(message => {
      const text = String(message.text || '').toLocaleLowerCase('tr-TR');
      const claim = analyzeChatClaim(message);
      const named = mentionsPlayer(text, bot.name);
      return { ...message, named, asked: text.includes('?'), accusation: named && claim.accusation, challengeBaseless: claim.baseless && !named && !botKnownVampires(bot.id).has(message.senderId), targetNames: claim.targets.map(player => player.name) };
    });
    return analyzed.find(message => message.accusation)
      || analyzed.find(message => message.challengeBaseless)
      || analyzed.find(message => message.named || message.asked)
      || null;
  }
  function maybeBotChat() {
    const g = game();
    if (g.started && !['day', 'vote'].includes(g.phase)) return; // gece/av fazında kimse konuşmaz
    if (!g.started && g.phase !== 'lobby') return;
    const phaseKey = `${g.started ? 'game' : 'lobby'}:${g.round}:${g.phase}`;
    if (botChatPhaseKey !== phaseKey) {
      botChatPhaseKey = phaseKey;
      botLastGlobalChatAt = Date.now() - BOT_GLOBAL_CHAT_GAP_MS;
      botChatCursor = 0;
    }
    const bots = g.players.filter(player => player.isBot && player.alive !== false && player.operatorId === state.myId && !botBusy.has(player.id));
    if (!bots.length) return;
    const now = Date.now();
    const addressedCandidates = bots.map(bot => ({ bot, message: addressedMessageFor(bot) })).filter(item => item.message && now - (botLastChatAt.get(item.bot.id) || 0) >= BOT_REPLY_COOLDOWN_MS);
    if (addressedCandidates.length) {
      const picked = addressedCandidates[botChatCursor++ % addressedCandidates.length];
      botLastAnswered.set(picked.bot.id, picked.message.id);
      botLastGlobalChatAt = now;
      runBotChat(picked.bot, picked.message);
      return;
    }
    if (now - botLastGlobalChatAt < BOT_GLOBAL_CHAT_GAP_MS) return;
    const ready = bots.filter(bot => now - (botLastChatAt.get(bot.id) || 0) >= BOT_CHAT_COOLDOWN_MS);
    if (!ready.length) return;
    const picked = ready[botChatCursor++ % ready.length];
    botLastGlobalChatAt = now;
    runBotChat(picked, null);
  }
  function runBotsIfNeeded() {
    if (!game().started) { maybeBotChat(); return; }
    pendingBotWork().forEach(({ bot, kind, key }) => {
      if (botBusy.has(bot.id)) return;
      botBusy.add(bot.id);
      runBotDecision(bot, kind, key).finally(() => botBusy.delete(bot.id));
    });
    maybeBotChat();
  }
  function targetButtons(action, candidates, label) {
    if (!candidates.length) return '<div class="vv-waiting"><i></i>Bu yetenek için uygun hedef yok.</div>';
    const icons = { vampire: '◆', doctor: '✚', seer: '✦', oracle: '◉', fool: '◌', spy: '◇', healer: '❋', warrior: '⚔', vote: '✓', hunter: '⌖' };
    const selectedId = selectedTargetFor(action);
    return `<div class="vv-target-grid">${candidates.map(player => `<button class="btn-sec vv-target${selectedId === player.id ? ' is-selected' : ''}" data-action="${action}" data-target="${player.id}" aria-pressed="${selectedId === player.id}"><span class="vv-target-icon">${selectedId === player.id ? '✓' : (icons[action] || '•')}</span><span class="vv-target-name">${esc(player.name)}</span><small>${selectedId === player.id ? 'Seçildi' : esc(label)}</small></button>`).join('')}</div>`;
  }
  function botStatusBadge(bot) {
    const status = botOllamaStatus.get(bot.id);
    if (!status || status.state === 'idle') return '<span class="vv-bot-status idle">Kontrol edilmedi</span>';
    if (status.state === 'checking') return '<span class="vv-bot-status checking">Kontrol ediliyor…</span>';
    if (status.state === 'ok') return `<span class="vv-bot-status ok">Bağlı ✓ ${esc(status.detail || '')}</span>`;
    return `<span class="vv-bot-status err">Bağlantı yok ✗ ${esc(status.detail || '')}</span>`;
  }
  // Bot ayarları, herkesin isminin göründüğü üst satırdaki bot pilinin
  // altında küçük bir panel olarak açılır (ayrı bir bölüme gerek yok).
  function botInlineEditor(bot) {
    const canEdit = host();
    const canRemove = host() && !game().started;
    const lock = canEdit ? '' : ' disabled';
    const humans = game().players.filter(player => !player.isBot);
    const operatorOptions = humans.map(human => `<option value="${human.id}" ${bot.operatorId === human.id ? 'selected' : ''}>${esc(human.name)}${human.id === state.myId ? ' (sen)' : ''}</option>`).join('');
    const detected = botOllamaStatus.get(bot.id)?.models || [];
    const modelList = `vv-models-${bot.id}`;
    const selectedLanguage = BOT_LANGUAGE_CODES.includes(bot.language) ? bot.language : 'tr';
    const languageOptions = BOT_LANGUAGE_CODES.map(code => {
      const meta = typeof LANGUAGE_META !== 'undefined' ? LANGUAGE_META[code] : null;
      return `<option value="${code}" ${selectedLanguage === code ? 'selected' : ''}>${esc(meta?.flag || '')} ${esc(botLanguageName(code))}</option>`;
    }).join('');
    const memory = botMemoryLines(bot.id);
    const memoryHtml = bot.operatorId === state.myId
      ? (memory.length ? memory.slice(-12).reverse().map(line => `<div>• ${esc(line)}</div>`).join('') : '<div class="vv-bot-memory-empty">Oyun başlayınca rolü, gizli sonuçları, sohbeti ve kendi kararlarını buraya yazacak.</div>')
      : `<div class="vv-bot-memory-empty">Bu botun hafızası ${esc(operatorName(bot))} adlı oyuncunun bilgisayarında tutuluyor.</div>`;
    return `<div class="vv-bot-inline" data-bot="${bot.id}">
      <input class="vv-bot-name" data-bot="${bot.id}" type="text" maxlength="24" value="${esc(bot.name)}" placeholder="Bot adı"${lock}>
      <label class="vv-bot-field"><span>Çalıştıran bilgisayar</span><select class="vv-bot-operator" data-bot="${bot.id}"${lock}>${operatorOptions}</select></label>
      <label class="vv-bot-field"><span>Model (${esc(operatorName(bot))} bilgisayarındaki)</span>${detected.length
        ? `<select class="vv-bot-model" data-bot="${bot.id}"${lock}>${[...new Set([...detected, bot.model].filter(Boolean))].map(name => `<option value="${esc(name)}" ${name === bot.model ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`
        : `<input class="vv-bot-model" data-bot="${bot.id}" type="text" list="${modelList}" value="${esc(bot.model)}" placeholder="Modeller yükleniyor…"${lock}><datalist id="${modelList}"></datalist>`}</label>
      <label class="vv-bot-field"><span>Konuşacağı dil</span><select class="vv-bot-language" data-bot="${bot.id}"${lock}>${languageOptions}</select></label>
      <label class="vv-bot-field vv-bot-field-wide"><span>Sistem promptu (karakter)</span><textarea class="vv-bot-persona" data-bot="${bot.id}" rows="3" maxlength="600" placeholder="${esc(DEFAULT_PERSONA)}"${lock}>${esc(bot.persona || '')}</textarea></label>
      ${botStatusBadge(bot)}
      <div class="vv-bot-memory"><strong>HAFIZASI</strong>${memoryHtml}</div>
      <div class="vv-bot-row-actions">
        <button class="btn-sec btn-sm vv-bot-check" data-bot="${bot.id}" type="button">Ollama'yı Kontrol Et</button>
        ${canRemove ? `<button class="btn-sec btn-sm vv-bot-remove" data-bot="${bot.id}" type="button">Kaldır</button>` : ''}
        <button class="btn-sec btn-sm vv-bot-close" type="button">Kapat</button>
      </div>
    </div>`;
  }
  const operatorName = bot => game().players.find(player => player.id === bot.operatorId)?.name || 'bilinmeyen oyuncu';
  function playerInitials(name) {
    return String(name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('tr-TR');
  }
  function privateIntelMarkup(g) {
    const intel = [...(g.privateIntel || [])].reverse();
    if (!intel.length) return '';
    return `<section class="vv-private-intel"><header><span>✦</span><div><strong>YALNIZCA SENİN GÖRDÜĞÜN BİLGİLER</strong><small>Bu sonuçlar diğer oyunculara gösterilmez.</small></div></header><div>${intel.map(item => `<article><span>${item.round}. GECE</span><p>${esc(item.message)}</p></article>`).join('')}</div></section>`;
  }
  function renderCouncil(g, me) {
    const council = el('vv-council'), content = el('vv-council-content');
    if (!council || !content) return;
    const active = ['day', 'vote', 'vote-result'].includes(g.phase);
    council.classList.toggle('hidden', !active);
    if (!active) { content.innerHTML = ''; return; }
    if (g.phase === 'vote-result') {
      const result = g.lastElimination;
      content.innerHTML = `<div class="vv-exile-screen">
        <span class="vv-council-kicker">KÖYÜN KARARI</span>
        <div class="vv-exile-avatar" data-team="${esc(result?.team || 'unknown')}">${esc(playerInitials(result?.name))}</div>
        <h2 id="vv-council-title">${esc(result?.name || 'Bir oyuncu')} sürgün edildi</h2>
        <p>Kimliği artık gizli değil.</p>
        <div class="vv-exile-role" data-team="${esc(result?.team || 'unknown')}"><span>${esc(ROLE_ART[result?.role]?.glyph || '◇')}</span><strong>${esc(result?.roleName || 'Bilinmiyor')}</strong><small>${result?.team === 'vampire' ? 'VAMPİR TARAFI' : result?.team === 'village' ? 'KÖY TARAFI' : 'BAĞIMSIZ'}</small></div>
        ${host() ? '<button id="vv-result-continue" class="btn-pri vv-council-primary">Geceye Geç</button>' : '<div class="vv-waiting"><i></i>Kurucunun geceyi başlatması bekleniyor.</div>'}
      </div>`;
      return;
    }
    const voting = g.phase === 'vote';
    const allowedIds = g.voteCandidates?.length ? new Set(g.voteCandidates) : null;
    const candidates = g.players.filter(player => player.alive && player.id !== state.myId && (!allowedIds || allowedIds.has(player.id)));
    const selectedId = selectedTargetFor('vote');
    const roster = g.players.filter(player => player.alive).map(player => `<div class="vv-council-person${player.id === state.myId ? ' is-me' : ''}"><span>${esc(playerInitials(player.name))}</span><strong>${esc(player.name)}</strong><small>${player.isBot ? 'YAPAY OYUNCU' : player.id === state.myId ? 'SEN' : 'MECLİSTE'}</small></div>`).join('');
    const cards = candidates.map(player => `<button class="vv-vote-card vv-target${selectedId === player.id ? ' is-selected' : ''}" data-action="vote" data-target="${player.id}" aria-pressed="${selectedId === player.id}"><span class="vv-vote-avatar">${esc(playerInitials(player.name))}</span><span class="vv-vote-copy"><strong>${esc(player.name)}</strong><small>${selectedId === player.id ? 'OYUN KAYDEDİLDİ' : 'OY VERMEK İÇİN SEÇ'}</small></span><i>${selectedId === player.id ? '✓' : '◇'}</i></button>`).join('');
    const voteCount = g.voteCount || Object.keys(g.actions.votes || {}).length;
    const total = aliveCount(g);
    content.innerHTML = `<header class="vv-council-hero">
      <div><span class="vv-council-kicker">${voting ? (g.voteAttempt > 1 ? 'SON TUR · EŞİTLİK' : 'ACİL OYLAMA') : 'GÜNDÜZ MECLİSİ'}</span><h2 id="vv-council-title">${voting ? 'Şüphelini seç, kararını mühürle' : 'Konuş. Sorgula. Çelişkileri yakala.'}</h2><p>${voting ? 'Her yaşayan oyuncunun tek oyu var. En çok oyu alan kişi sürgün edilir.' : 'Oyun sohbeti yalnızca bu ekranda açık. Botlar da iddialara cevap verir ve birbirlerini sorgular.'}</p></div>
      <div class="vv-council-round"><span>${String(g.round).padStart(2, '0')}</span><small>TUR</small></div>
    </header>
    ${privateIntelMarkup(g)}
    ${voting ? `<div class="vv-vote-progress"><div><strong>${voteCount}/${total}</strong><span>oy kullanıldı</span></div><i><b style="width:${Math.min(100, total ? voteCount / total * 100 : 0)}%"></b></i></div><div class="vv-vote-grid">${cards || '<div class="vv-waiting"><i></i>Bu turda seçebileceğin aday yok.</div>'}</div>` : `<div class="vv-council-roster">${roster}</div>`}
    <div class="vv-council-admin">${!voting && host() ? '<button id="vv-vote-open" class="btn-pri vv-council-primary">Oylamayı Başlat</button>' : ''}${voting && host() ? `<button id="vv-vote-end" class="btn-pri vv-council-primary" ${voteCount ? '' : 'disabled'}>${voteCount < total ? `Oyları Say · ${voteCount}/${total}` : 'Oyları Say ve Sürgün Et'}</button>` : ''}</div>`;
  }
  function renderEndgame(g) {
    const panel = el('vv-endgame');
    if (!panel) return;
    const active = g.phase === 'over';
    panel.classList.toggle('hidden', !active);
    if (!active) { panel.innerHTML = ''; return; }
    const roles = g.revealedRoles || (host() ? g.players.map(player => { const role = g.roles[player.id]; return { id: player.id, name: player.name, alive: player.alive, role, roleName: ROLE_INFO[role]?.name || 'Bilinmiyor', team: ROLE_INFO[role]?.team || 'unknown' }; }) : []);
    const winnerName = g.winnerId ? g.players.find(player => player.id === g.winnerId)?.name : '';
    const title = g.winnerTeam === 'vampire' ? 'Vampirler kazandı' : g.winnerTeam === 'executioner' ? `${winnerName || 'Cellat'} kazandı` : 'Köylüler kazandı';
    const subtitle = g.winnerTeam === 'vampire' ? 'Köyde karşı koyacak yeterli kişi kalmadı.' : g.winnerTeam === 'executioner' ? 'Gizli hedef oylamayla sürgün edildi.' : 'Son vampir de meclisten silindi.';
    panel.innerHTML = `<div class="vv-winner-seal" data-team="${esc(g.winnerTeam || 'village')}">${g.winnerTeam === 'vampire' ? '♜' : g.winnerTeam === 'executioner' ? '†' : '⌂'}</div><span class="vv-council-kicker">OYUN SONA ERDİ</span><h2 id="vv-endgame-title">${esc(title)}</h2><p>${esc(subtitle)}</p><div class="vv-reveal-roster">${roles.map(item => `<article data-team="${esc(item.team)}" class="${item.alive ? 'is-alive' : 'is-dead'}"><span class="vv-end-avatar">${esc(playerInitials(item.name))}</span><div><strong>${esc(item.name)}</strong><small>${item.alive ? 'HAYATTA KALDI' : 'ELENDİ'}</small></div><em>${esc(ROLE_ART[item.role]?.glyph || '◇')} ${esc(item.roleName)}</em></article>`).join('')}</div>${host() ? '<button id="vv-restart" class="btn-pri vv-council-primary">Yeni Lobi Kur</button>' : ''}`;
  }
  function render() {
    const g = game(), roleEl = el('vampire-role'), status = el('vampire-status'), players = el('vampire-players'), actions = el('vampire-actions'), log = el('vampire-log');
    if (!roleEl || !status || !players || !actions || !log) return;
    const me = mine(), role = g.localRole;
    const card = el('vampire-card');
    if (card) {
      card.dataset.phase = g.phase; card.dataset.role = role || 'hidden';
      card.classList.toggle('vv-council-mode', ['day', 'vote', 'vote-result'].includes(g.phase));
      card.classList.toggle('vv-endgame-mode', g.phase === 'over');
    }
    const chatPanel = document.querySelector('#vampire-card .vv-lobby-chat');
    const chatSlot = el('vv-council-chat-slot');
    const sideRail = document.querySelector('#vampire-card .vv-side-rail');
    if (chatPanel && chatSlot && sideRail) {
      if (['day', 'vote'].includes(g.phase)) chatSlot.appendChild(chatPanel); else sideRail.appendChild(chatPanel);
      chatPanel.classList.toggle('hidden', g.started && !['day', 'vote'].includes(g.phase));
      const chatTitle = el('vv-lobby-chat-title');
      const chatSub = chatPanel.querySelector('.vv-lobby-chat-head span');
      if (chatTitle) chatTitle.textContent = g.started ? 'MECLİS SOHBETİ' : 'LOBİ SOHBETİ';
      if (chatSub) chatSub.textContent = g.started ? 'Yaşayan oyuncular ve botlar burada tartışır' : 'Yalnızca bu lobinin oyuncuları';
    }
    if (!g.started) {
      roleEl.innerHTML = `<span class="vv-role-sigil">◈</span><div class="vv-role-copy"><span>MECLİS HAZIRLIĞI</span><strong>${host() ? 'Geceyi sen kuruyorsun' : 'Kurucu hazırlanıyor'}</strong><p>${host() ? 'Oyun tarzını, vampir sayısını ve özel rolleri belirle. Denge özeti her seçimin ardından güncellenir.' : 'Kurucu kuralları belirlerken diğer oyuncularla sohbet edebilirsin.'}</p></div>`;
    } else if (role && ROLE_INFO[role]) {
      const art = ROLE_ART[role] || { glyph: '◆', label: 'GİZLİ ROL' };
      roleEl.innerHTML = `<span class="vv-role-sigil">${art.glyph}</span><div class="vv-role-copy"><span>${art.label} · GİZLİ ROLÜN</span><strong>${esc(ROLE_INFO[role].name)}</strong><p>${esc(ROLE_INFO[role].desc)}</p>${g.privateNote ? `<em>${esc(g.privateNote)}</em>` : ''}</div>`;
    } else {
      roleEl.innerHTML = '<span class="vv-role-sigil">◌</span><div class="vv-role-copy"><span>İZLEYİCİ</span><strong>Meclisi dışarıdan izliyorsun</strong><p>Gizli rolün ve oyun aksiyonun bulunmuyor.</p></div>';
    }
    const phases = { lobby: 'Lobi kuralları', night: `${g.round}. gece`, day: 'Gündüz tartışması', vote: 'Köy oylaması', 'vote-result': 'Sürgün kararı', 'hunter-shot': 'Avcının son atışı', over: 'Oyun bitti' };
    const secondsLeft = g.phaseEndsAt ? Math.max(0, Math.ceil((g.phaseEndsAt - Date.now()) / 1000)) : 0;
    const voteStatus = g.phase === 'vote' ? ` · Oylar: ${g.voteCount || Object.keys(g.actions.votes || {}).length}/${aliveCount(g)}` : '';
    status.dataset.base = `${phases[g.phase] || 'Hazırlanıyor'}${voteStatus}`;
    status.textContent = `${status.dataset.base}${secondsLeft ? ` · ${secondsLeft} sn` : ''}`;
    const canManageBots = host() && g.phase === 'lobby' && !g.started;
    const pillsHtml = g.players.map((player, index) => {
      const clickable = player.isBot && (host() || player.operatorId === state.myId);
      if (player.isBot) return `<span class="vv-player-pill vv-player-pill-bot${player.alive ? '' : ' is-dead'}" ${clickable ? `data-bot-pill="${player.id}"` : ''}>🤖 ${esc(player.name)}</span>`;
      const initials = player.isBot ? 'AI' : playerInitials(player.name);
      return `<span class="vv-player-pill${clickable ? ' vv-player-pill-bot' : ''}${player.alive ? '' : ' is-dead'}" ${clickable ? `data-bot-pill="${player.id}"` : ''}><span class="vv-player-avatar">${esc(initials)}</span><span class="vv-player-copy"><strong>${esc(player.name)}${player.id === state.myId ? ' · Sen' : ''}</strong><small>${player.alive ? `Masa ${String(index + 1).padStart(2, '0')}` : 'Elendi'}</small></span></span>`;
    }).join('');
    const addBotPill = canManageBots ? `<button id="vv-bot-add-pill" class="vv-player-pill vv-bot-add-pill" type="button" ${g.players.length >= MAX_PLAYERS ? 'disabled' : ''}>+ Yapay oyuncu ekle</button>` : '';
    const selectedBot = g.players.find(player => player.id === selectedBotId && player.isBot && (host() || player.operatorId === state.myId)) || null;
    players.innerHTML = pillsHtml + addBotPill + (selectedBot ? botInlineEditor(selectedBot) : '');
    log.innerHTML = g.log.length ? g.log.map(line => `<div>• ${esc(line)}</div>`).join('') : '<div>Henüz olay yok.</div>';
    const allAlive = alive(); let html = '';
    if (g.phase === 'lobby') {
      if (host()) {
        const setup = selectedRoles(g.players.length, g.settings);
        const checks = SPECIALS.map(key => `<label class="vv-role-toggle" data-role="${key}"><input class="vv-setting" data-key="${key}" type="checkbox" ${g.settings[key] ? 'checked' : ''}><span class="vv-role-check"></span><span>${ROLE_INFO[key].name}</span></label>`).join('');
        html = `<section class="vv-lobby-settings">
          <header class="vv-settings-head"><span class="vv-settings-kicker">VAMPİR KÖYLÜ</span><strong>Lobi kuralları</strong><p>Önce oyun tarzını seç, ardından özel rolleri istediğin gibi düzenle.</p></header>
          <div class="vv-setting-grid">
            <label class="vv-field"><span>Hazır kural paketi</span><select id="vv-preset"><option value="classic" ${g.settings.preset === 'classic' ? 'selected' : ''}>Klasik</option><option value="balanced" ${g.settings.preset === 'balanced' ? 'selected' : ''}>Dengeli</option><option value="chaos" ${g.settings.preset === 'chaos' ? 'selected' : ''}>Kaos</option></select></label>
            <label class="vv-field"><span>Gece / oylama süresi</span><select id="vv-phase-seconds"><option value="0" ${Number(g.settings.phaseSeconds) === 0 ? 'selected' : ''}>Kurucu bitirir</option><option value="60" ${Number(g.settings.phaseSeconds) === 60 ? 'selected' : ''}>60 saniye</option><option value="90" ${Number(g.settings.phaseSeconds) === 90 ? 'selected' : ''}>90 saniye</option><option value="120" ${Number(g.settings.phaseSeconds) === 120 ? 'selected' : ''}>120 saniye</option></select></label>
            <label class="vv-field"><span>Vampir sayısı</span><select id="vv-vampire-count"><option value="auto" ${g.settings.vampireCount === 'auto' ? 'selected' : ''}>Otomatik · ${recommendedVampires(g.players.length)}</option><option value="1" ${g.settings.vampireCount === '1' ? 'selected' : ''}>1 vampir</option><option value="2" ${g.settings.vampireCount === '2' ? 'selected' : ''}>2 vampir</option><option value="3" ${g.settings.vampireCount === '3' ? 'selected' : ''}>3 vampir</option></select></label>
          </div>
          <div class="vv-role-section"><div class="vv-role-section-title"><strong>Özel roller</strong><span>İstediğin rolleri aç</span></div><div class="vv-role-grid">${checks}</div></div>
          <div class="vv-role-summary"><span>DAĞILIM</span><p>${setup.vampires} Vampir · ${setup.special.map(key => ROLE_INFO[key].name).join(', ') || 'Özel rol yok'} · Köylüler${setup.ignored.length ? `<em>Yer olmadığı için kapalı: ${setup.ignored.map(key => ROLE_INFO[key].name).join(', ')}</em>` : ''}</p></div>
          <button id="vampire-start" class="btn-pri vv-start-button" ${g.players.length < 4 ? 'disabled' : ''}>Oyunu Başlat <span>${g.players.length}/4+</span></button>
        </section>`;
      } else html = '<span style="color:#cbbdd5">Kurucunun oyunu başlatmasını bekleyin.</span>';
    }
    if (g.phase === 'night' && me?.alive) {
      if (role === 'vampire') {
        const teammateIds = new Set((g.localTeammates || []).map(item => item.id));
        html += targetButtons('vampire', allAlive.filter(player => player.id !== state.myId && !teammateIds.has(player.id) && (!host() || roleOf(player.id) !== 'vampire')), 'Av seç');
      }
      if (role === 'doctor') {
        const previous = lastDoctorTargetFor(state.myId);
        html += targetButtons('doctor', allAlive.filter(player => player.id !== previous), 'Koru');
        if (previous) html += `<div class="vv-action-rule">Önceki gece koruduğun <strong>${esc(g.players.find(player => player.id === previous)?.name || 'oyuncu')}</strong> bu gece tekrar seçilemez.</div>`;
      }
      if (role === 'seer') html += targetButtons('seer', allAlive, 'Rolünü gör');
      if (role === 'oracle') html += targetButtons('oracle', allAlive, 'Tarafını sez');
      if (role === 'fool') html += targetButtons('fool', allAlive, 'İşaret ara');
      if (role === 'spy') html += targetButtons('spy', allAlive, 'Araştır');
      if (role === 'healer' && !g.used.healer) html += targetButtons('healer', g.players.filter(player => !player.alive), 'Hayata döndür');
      if (role === 'warrior' && !g.used.warrior) html += targetButtons('warrior', allAlive.filter(player => player.id !== state.myId), 'Saldır');
    }
    if (g.phase === 'night' && host()) {
      const missingAction = requiredLocalNightAction();
      const pendingBots = pendingLocalBotNightCount();
      const blocked = !!missingAction || pendingBots > 0;
      const buttonText = missingAction ? (missingAction === 'vampire' ? 'Önce avını seç' : 'Önce gece hedefini seç') : pendingBots ? `Bot kararları bekleniyor · ${pendingBots}` : 'Geceyi Bitir';
      html += `<button id="vv-night-end" class="btn-pri" ${blocked ? 'disabled' : ''}>${buttonText}</button>`;
    }
    if (g.phase === 'hunter-shot' && role === 'hunter' && g.pendingHunterId === state.myId) html += targetButtons('hunter', allAlive, 'Son atış');
    if (g.phase === 'hunter-shot' && host() && g.actions.hunter) html += '<button id="vv-hunter-end" class="btn-pri">Avcının Atışını Uygula</button>';
    const actionTitles = { night: ['GECE AKSİYONU', role && ROLE_INFO[role] ? `${ROLE_INFO[role].name} olarak kararını ver` : 'Gece sürüyor'], day: ['GÜNDÜZ MECLİSİ', 'Sesli kanalda tartışın'], vote: ['KÖY KARARI', 'Şüphelendiğin kişiye oy ver'], 'hunter-shot': ['SON SÖZ', 'Avcının son atışı'], over: ['PERDE KAPANDI', 'Roller açığa çıktı'] };
    if (g.phase !== 'lobby' && actionTitles[g.phase]) {
      const [eyebrow, title] = actionTitles[g.phase];
      html = `<div class="vv-action-intro"><div><span>${eyebrow}</span><strong>${esc(title)}</strong></div><small>${me?.alive ? 'Kararın diğer oyunculardan gizlidir.' : 'Bu turu izliyorsun.'}</small></div>${html}`;
    }
    if (g.started && !['day', 'vote', 'vote-result', 'over'].includes(g.phase)) html = `${privateIntelMarkup(g)}${html}`;
    actions.innerHTML = html || '<div class="vv-waiting"><i></i>Bu aşamada diğer oyuncuların kararları bekleniyor.</div>';
    renderCouncil(g, me);
    renderEndgame(g);
    el('vampire-start')?.addEventListener('click', start); el('vv-night-end')?.addEventListener('click', resolveNight); el('vv-vote-open')?.addEventListener('click', openVote); el('vv-vote-end')?.addEventListener('click', resolveVote); el('vv-result-continue')?.addEventListener('click', continueAfterVoteResult); el('vv-hunter-end')?.addEventListener('click', hunterShot); el('vv-restart')?.addEventListener('click', resetHostLobby);
    el('vv-vampire-count')?.addEventListener('change', event => { g.settings.vampireCount = event.target.value; render(); });
    el('vv-preset')?.addEventListener('change', event => { usePreset(event.target.value); render(); });
    el('vv-phase-seconds')?.addEventListener('change', event => { g.settings.phaseSeconds = Number(event.target.value); render(); });
    actions.querySelectorAll('.vv-setting').forEach(input => input.addEventListener('change', event => { g.settings[event.target.dataset.key] = event.target.checked; render(); }));
    actions.querySelectorAll('.vv-target').forEach(button => button.addEventListener('click', () => button.dataset.action === 'vote' ? sendVote(button.dataset.target) : sendAction(button.dataset.action, button.dataset.target)));
    el('vv-council')?.querySelectorAll('.vv-target').forEach(button => button.addEventListener('click', () => sendVote(button.dataset.target)));
    el('vv-bot-add-pill')?.addEventListener('click', addBot);
    players.querySelectorAll('[data-bot-pill]').forEach(pill => pill.addEventListener('click', () => {
      const id = pill.dataset.botPill;
      selectedBotId = selectedBotId === id ? null : id;
      // Panel açılır açılmaz o bilgisayardaki model listesi çekilsin.
      if (selectedBotId && !botOllamaStatus.get(selectedBotId)) requestBotOllamaCheck(selectedBotId);
      render();
    }));
    players.querySelectorAll('.vv-bot-name').forEach(input => input.addEventListener('change', event => setBotField(event.target.dataset.bot, 'name', event.target.value.trim().slice(0, 24) || 'Bot')));
    players.querySelectorAll('.vv-bot-operator').forEach(select => select.addEventListener('change', event => { setBotField(event.target.dataset.bot, 'operatorId', event.target.value); requestBotOllamaCheck(event.target.dataset.bot); }));
    players.querySelectorAll('.vv-bot-model').forEach(input => input.addEventListener('change', event => { const value = event.target.value.trim() || defaultBotModel(); setBotField(event.target.dataset.bot, 'model', value); try { localStorage.setItem(OLLAMA_MODEL_KEY, value); } catch (_) {} }));
    players.querySelectorAll('.vv-bot-language').forEach(select => select.addEventListener('change', event => setBotField(event.target.dataset.bot, 'language', event.target.value)));
    players.querySelectorAll('.vv-bot-persona').forEach(area => area.addEventListener('change', event => setBotField(event.target.dataset.bot, 'persona', event.target.value.trim().slice(0, 600))));
    players.querySelectorAll('.vv-bot-check').forEach(button => button.addEventListener('click', () => requestBotOllamaCheck(button.dataset.bot)));
    players.querySelectorAll('.vv-bot-remove').forEach(button => button.addEventListener('click', () => { selectedBotId = null; removeBot(button.dataset.bot); }));
    players.querySelectorAll('.vv-bot-close').forEach(button => button.addEventListener('click', () => { selectedBotId = null; render(); }));
    renderLobbyChat();
    runBotsIfNeeded();
  }
  window.vampireVillagerSyncPeer = syncPeer;
  window.vampireVillagerHandler = function (msg, peerId) {
    const g = game();
    if (!msg || typeof msg !== 'object') return;
    // State, roles and private results must come from the elected host only.
    // A participant could otherwise overwrite the local game with a forged
    // snapshot or grant itself a role through the peer data channel.
    if (msg.type === 'vv-state') {
      if (typeof msg.host !== 'string' || peerId !== msg.host || (g.host && peerId !== g.host)) return;
      const ownRole = g.localRole; const ownTeammates = g.localTeammates; const ownDoctorLastTargetId = g.localDoctorLastTargetId; const privateIntel = g.privateIntel; const chat = g.chat;
      if (!msg.started) { hideRoleReveal(); roleRevealKey = null; localSelections.clear(); }
      state.vampire = { ...blank(), ...msg, roles: {}, localRole: ownRole, localTeammates: ownTeammates, localDoctorLastTargetId: ownDoctorLastTargetId, privateIntel, chat, actions: {}, used: {} };
      rememberPublicLog(msg.log); openCard(); render(); return;
    }
    if (msg.type === 'vv-role') {
      if (peerId !== g.host) return;
      g.localRole = msg.role;
      g.localTeammates = Array.isArray(msg.teammates) ? msg.teammates : [];
      if (msg.targetName) g.privateNote = `Cellat hedefin: ${msg.targetName}. Hedefin gündüz oylamasıyla sürülürse kazanırsın.`;
      render();
      showRoleReveal(msg.role, g.localTeammates, msg.targetName);
      return;
    }
    if (msg.type === 'vv-result') { if (peerId !== g.host) return; receivePrivateResult(msg.message, msg.intel); render(); return; }
    if (msg.type === 'vv-doctor-history') { if (peerId !== g.host || typeof msg.targetId !== 'string') return; g.localDoctorLastTargetId = msg.targetId; render(); return; }
    if (msg.type === 'vv-bot-doctor-history') {
      const bot = g.players.find(player => player.id === msg.botId && player.isBot);
      if (peerId !== g.host || !bot || bot.operatorId !== state.myId || typeof msg.targetId !== 'string') return;
      botDoctorLastTargets.set(msg.botId, msg.targetId); render(); return;
    }
    if (msg.type === 'vv-chat-history') {
      const lobby = activeVampireLobby();
      if (!canSeeLobbyChat() || peerId !== lobby?.hostId || !Array.isArray(msg.messages)) return;
      game().chat = msg.messages.map(normalizeChatMessage).filter(Boolean).slice(-CHAT_LIMIT);
      renderLobbyChat();
      return;
    }
    if (msg.type === 'vv-chat') {
      if (!canSeeLobbyChat()) return;
      if (g.started && (!['day', 'vote'].includes(g.phase) || !g.players.some(player => player.id === msg.senderId && player.alive))) return;
      if (isBotId(msg.senderId)) {
        const bot = g.players.find(player => player.id === msg.senderId && player.isBot);
        if (!bot || bot.operatorId !== peerId) return;
      } else if (!isLobbyPlayer(peerId) || msg.senderId !== peerId) return;
      addLobbyChatMessage(msg);
      return;
    }
    if (msg.type === 'vv-action' && host()) {
      if (setAction(peerId, msg.action, msg.targetId)) broadcastTo(peerId, { type: 'vv-action-ack', action: msg.action, targetId: msg.targetId, phase: g.phase, round: g.round });
      return;
    }
    if (msg.type === 'vv-action-ack') {
      if (peerId !== g.host || msg.phase !== g.phase || msg.round !== g.round) return;
      localSelections.set(selectionKey(msg.action), msg.targetId); render(); return;
    }
    if (msg.type === 'vv-vote' && host()) { castVote(peerId, msg.targetId); broadcastTo(peerId, { type: 'vv-action-ack', action: 'vote', targetId: msg.targetId, phase: g.phase, round: g.round }); publish(); return; }
    if (msg.type === 'vv-bot-action' && host()) {
      const bot = g.players.find(player => player.id === msg.botId && player.isBot);
      if (bot && bot.operatorId === peerId) setAction(msg.botId, msg.action, msg.targetId);
      return;
    }
    if (msg.type === 'vv-bot-vote' && host()) {
      const bot = g.players.find(player => player.id === msg.botId && player.isBot);
      if (bot && bot.operatorId === peerId) { castVote(msg.botId, msg.targetId); publish(); }
      return;
    }
    if (msg.type === 'vv-bot-role') {
      // Yalnızca kurucudan gelen rol bilgisi kabul edilir ve yalnızca kendi botlarımız için.
      const bot = g.players.find(player => player.id === msg.botId && player.isBot);
      if (peerId !== g.host || !bot || bot.operatorId !== state.myId) return;
      applyBotRole(msg.botId, msg.role, msg.targetName, msg.teammates);
      return;
    }
    if (msg.type === 'vv-bot-note') {
      const bot = g.players.find(player => player.id === msg.botId && player.isBot);
      if (peerId !== g.host || !bot || bot.operatorId !== state.myId) return;
      addBotMemory(msg.botId, `Sana özel bilgi: ${msg.message}`, 'gizli');
      if (msg.intel?.targetId) rememberBotBelief(msg.botId, msg.intel.targetId, msg.intel.delta, msg.intel.reason || msg.message, 'doğrulanmış gizli bilgi');
      render();
      return;
    }
    if (msg.type === 'vv-bot-ollama-check') {
      const bot = g.players.find(player => player.id === msg.botId && player.isBot);
      if (peerId === g.host && bot && bot.operatorId === state.myId) runOllamaCheckForBot(bot);
      return;
    }
    if (msg.type === 'vv-bot-reward') {
      const bot = g.players.find(player => player.id === msg.botId && player.isBot);
      if (peerId !== g.host || !bot || bot.operatorId !== state.myId) return;
      applyBotReward(msg.botId, msg.delta, String(msg.reason || '').slice(0, 240));
      render();
      return;
    }
    if (msg.type === 'vv-bot-ollama-status') {
      const bot = g.players.find(player => player.id === msg.botId && player.isBot);
      if (!bot || bot.operatorId !== peerId) return;
      botOllamaStatus.set(msg.botId, { state: msg.ok ? 'ok' : 'error', detail: msg.detail, models: msg.models || [] });
      render();
      return;
    }
  };
  window.initVampireVillager = function () {
    el('act-vampire')?.addEventListener('click', () => {
      if (state.activeLobbyId && !state.isLobbyHost) {
        if (state.spectating) { showToast('Vampir Köylü lobisine yalnızca oyuncular katılabilir.', 'warn'); return; }
        openCard(); render();
      } else resetHostLobby();
    });
    el('vampire-close')?.addEventListener('click', () => { if (typeof leaveActiveLobby === 'function' && state.activeLobbyId) leaveActiveLobby(); closeLocal(); });
    el('vv-chat-form')?.addEventListener('submit', event => { event.preventDefault(); sendLobbyChat(); });
    el('vv-reveal-close')?.addEventListener('click', hideRoleReveal);
  };
  window.vampireVillagerLeave = function () { clearPhaseTimer(); hideRoleReveal(); roleRevealKey = null; localSelections.clear(); clearBotBrains(); state.vampire = blank(); closeLocal(); };
  window.vampireVillagerPeerLeft = reassignBotsFromDeparted;
  setInterval(refreshTimerLabel, 1000);
  setInterval(runBotsIfNeeded, 4000);
})();
