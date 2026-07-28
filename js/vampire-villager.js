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
    doctor: { name: 'Doktor', team: 'village', desc: 'Her gece bir oyuncuyu vampir saldırısından korur.' },
    healer: { name: 'Şifacı', team: 'village', desc: 'Oyun boyunca bir kez elenmiş bir oyuncuyu hayata döndürür.' },
    hunter: { name: 'Avcı', team: 'village', desc: 'Elendiğinde bir kişiye son atış yapar.' },
    warrior: { name: 'Savaşçı', team: 'village', desc: 'Oyun boyunca bir kez gece saldırısı yapabilir.' },
    spy: { name: 'Casus', team: 'village', desc: 'Her gece bir oyuncunun vampir tarafında olup olmadığını öğrenir.' },
    executioner: { name: 'Cellat', team: 'independent', desc: 'Gizli hedefi gündüz oylamasıyla sürülürse tek başına kazanır.' }
  };
  const SPECIALS = ['seer', 'oracle', 'fool', 'doctor', 'healer', 'hunter', 'warrior', 'spy', 'executioner'];
  const freshSettings = () => ({ vampireCount: 'auto', preset: 'balanced', phaseSeconds: 0, seer: true, oracle: false, fool: false, doctor: true, healer: false, hunter: true, warrior: false, spy: false, executioner: false });
  const blank = () => ({ host: null, started: false, phase: 'lobby', round: 0, players: [], roles: {}, localRole: null, settings: freshSettings(), actions: {}, used: {}, executionTargets: {}, winnerId: null, pendingHunterId: null, phaseEndsAt: 0, privateNote: '', log: [], chat: [] });
  let phaseTimer = null;
  const CHAT_LIMIT = 100;
  const MAX_PLAYERS = 10;
  // --- Ollama bot altyapısı ---
  const BOT_ID_PREFIX = 'vvbot-';
  const OLLAMA_BASE_KEY = 'teamsync_vv_ollama_base';
  const OLLAMA_MODEL_KEY = 'teamsync_vv_ollama_model';
  const BOT_CHAT_COOLDOWN_MS = 15000;
  const isBotId = id => typeof id === 'string' && id.startsWith(BOT_ID_PREFIX);
  const ollamaBase = () => { try { return (localStorage.getItem(OLLAMA_BASE_KEY) || 'http://localhost:11434').replace(/\/+$/, ''); } catch (_) { return 'http://localhost:11434'; } };
  const defaultBotModel = () => { try { return localStorage.getItem(OLLAMA_MODEL_KEY) || 'gemma3:e2b'; } catch (_) { return 'gemma3:e2b'; } };
  // Bu Map'ler yalnızca bu istemcide anlamlıdır (senkronize edilmez): hangi bot şu an
  // Ollama'ya soru sordu (busy), hangi round/faz için zaten karar verdi (actedKey),
  // en son ne zaman sohbete katıldı (lastChatAt) ve bağlantı durumu (ollamaStatus).
  const botBusy = new Set();
  const botActedKey = new Map();
  const botLastChatAt = new Map();
  const botOllamaStatus = new Map();
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
  const canUseLobbyChat = () => !state.spectating && isLobbyPlayer(state.myId);

  function openCard() {
    if (typeof openCardFocused === 'function') openCardFocused('vampire-card');
    else el('vampire-card')?.classList.remove('hidden');
  }
  function closeLocal() {
    const card = el('vampire-card');
    if (card && !card.classList.contains('hidden')) card.classList.add('hidden');
  }
  function refreshTimerLabel() {
    const g = game(), status = el('vampire-status');
    if (!status?.dataset.base) return;
    const secondsLeft = g.phaseEndsAt ? Math.max(0, Math.ceil((g.phaseEndsAt - Date.now()) / 1000)) : 0;
    status.textContent = `${status.dataset.base}${secondsLeft ? ` · ${secondsLeft} sn` : ''}`;
  }
  function snapshot() {
    const g = game();
    return { type: 'vv-state', host: g.host, started: g.started, phase: g.phase, round: g.round, settings: g.settings, pendingHunterId: g.pendingHunterId, phaseEndsAt: g.phaseEndsAt, voteCount: Object.keys(g.actions.votes || {}).length, revealedRoles: g.phase === 'over' ? g.players.map(player => ({ name: player.name, role: ROLE_INFO[g.roles[player.id]]?.name || 'Bilinmiyor' })) : null, log: g.log, players: g.players.map(({ id, name, alive, isBot, operatorId, model }) => isBot ? { id, name, alive, isBot: true, operatorId, model } : { id, name, alive }) };
  }
  function publish() { broadcast(snapshot()); render(); }
  function sendRole(id) {
    const role = game().roles[id];
    if (!role) return;
    const targetId = game().executionTargets?.[id];
    const targetName = game().players.find(player => player.id === targetId)?.name;
    if (id === state.myId) {
      game().localRole = role;
      if (targetName) game().privateNote = `Cellat hedefin: ${targetName}. Hedefin gündüz oylamasıyla sürülürse kazanırsın.`;
    } else broadcastTo(id, { type: 'vv-role', role, targetName });
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
    const allowed = canUseLobbyChat();
    form.classList.toggle('hidden', !allowed);
    wrap.replaceChildren();
    if (!allowed) {
      const empty = document.createElement('div');
      empty.className = 'vv-chat-empty';
      empty.textContent = 'Bu sohbet yalnızca lobi oyuncularına açıktır.';
      wrap.appendChild(empty);
      return;
    }
    const messages = game().chat || [];
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'vv-chat-empty';
      empty.textContent = 'Lobi sohbeti hazır. İlk mesajı sen yaz.';
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
    const bot = { id: BOT_ID_PREFIX + crypto.randomUUID(), name: nextBotName(), alive: true, isBot: true, operatorId: state.myId, model: defaultBotModel() };
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
    botBusy.delete(id); botActedKey.delete(id); botLastChatAt.delete(id); botOllamaStatus.delete(id);
    publish();
  }
  function setBotField(id, field, value) {
    const g = game();
    if (!host() || !isBotId(id)) return;
    const bot = g.players.find(player => player.id === id);
    if (!bot) return;
    bot[field] = value;
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
    }, 30000);
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
    const seconds = Number(g.settings.phaseSeconds) || 0;
    if (!host() || !seconds || !['night', 'vote'].includes(g.phase)) return;
    g.phaseEndsAt = Date.now() + seconds * 1000;
    phaseTimer = setTimeout(() => { if (game().phase === 'night') resolveNight(); else if (game().phase === 'vote') resolveVote(); }, seconds * 1000);
  }
  function selectedRoles(count, settings) {
    const vampires = settings.vampireCount === 'auto' ? recommendedVampires(count) : Math.max(1, Math.min(Number(settings.vampireCount), count - 1));
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
    g.started = true; g.phase = 'night'; g.round = 1; g.actions = {}; g.used = {}; g.pendingHunterId = null;
    g.log = [`${g.round}. gece başladı. Herkes kendi gizli ekranındaki yeteneği kullanabilir.`];
    g.players.forEach(player => sendRole(player.id));
    const activeLobby = state.lobbies.find(item => item.id === state.activeLobbyId);
    if (activeLobby) activeLobby.status = 'playing';
    if (typeof syncLobbiesList === 'function') syncLobbiesList();
    armPhaseTimer();
    publish();
  }
  function roleOf(id) { return game().roles[id]; }
  function setAction(actorId, action, targetId) {
    const g = game();
    const actor = g.players.find(player => player.id === actorId);
    const target = g.players.find(player => player.id === targetId);
    const role = roleOf(actorId);
    if (!actor || !target || !host()) return;
    const aliveTarget = target.alive;
    if (action === 'vampire' && role === 'vampire' && actor.alive && aliveTarget && roleOf(targetId) !== 'vampire') (g.actions.vampire ||= {})[actorId] = targetId;
    if (action === 'doctor' && role === 'doctor' && actor.alive && aliveTarget) g.actions.doctor = { actorId, targetId };
    if (action === 'seer' && role === 'seer' && actor.alive && aliveTarget) g.actions.seer = { actorId, targetId };
    if (action === 'oracle' && role === 'oracle' && actor.alive && aliveTarget) g.actions.oracle = { actorId, targetId };
    if (action === 'fool' && role === 'fool' && actor.alive && aliveTarget) g.actions.fool = { actorId, targetId };
    if (action === 'spy' && role === 'spy' && actor.alive && aliveTarget) g.actions.spy = { actorId, targetId };
    if (action === 'healer' && role === 'healer' && actor.alive && !g.used.healer && !aliveTarget) g.actions.healer = { actorId, targetId };
    if (action === 'warrior' && role === 'warrior' && actor.alive && !g.used.warrior && aliveTarget && targetId !== actorId) g.actions.warrior = { actorId, targetId };
    if (action === 'hunter' && role === 'hunter' && g.phase === 'hunter-shot' && g.pendingHunterId === actorId && aliveTarget && targetId !== actorId) g.actions.hunter = { actorId, targetId };
    render();
  }
  function directResult(id, message) { if (id === state.myId) { game().privateNote = message; } else broadcastTo(id, { type: 'vv-result', message }); }
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
    if (!vampires) { g.phase = 'over'; clearPhaseTimer(); note('Köylüler kazandı: tüm vampirler elendi.'); return true; }
    if (vampires >= villagers) { g.phase = 'over'; clearPhaseTimer(); note('Vampirler kazandı: köylü sayısına eşitlendiler.'); return true; }
    return false;
  }
  function afterNight() {
    const g = game();
    if (winner()) return publish();
    g.phase = 'day'; clearPhaseTimer(); note('Gündüz başladı. Sesli sohbette tartışın, sonra kurucu oylamayı açsın.'); publish();
  }
  function resolveNight() {
    const g = game(); if (!host() || g.phase !== 'night') return;
    const healer = g.actions.healer;
    if (healer) { const patient = g.players.find(player => player.id === healer.targetId); if (patient && !patient.alive) { patient.alive = true; g.used.healer = true; note(`Şifacı ${patient.name} adlı oyuncuyu hayata döndürdü.`); } }
    if (g.actions.seer) { const target = g.players.find(player => player.id === g.actions.seer.targetId); directResult(g.actions.seer.actorId, `Büyücü sonucu: ${target.name} rolü ${ROLE_INFO[roleOf(target.id)].name}.`); }
    if (g.actions.oracle) { const target = g.players.find(player => player.id === g.actions.oracle.targetId); directResult(g.actions.oracle.actorId, `Kâhin sonucu: ${target.name} ${roleOf(target.id) === 'vampire' ? 'vampir tarafında.' : 'köy tarafında.'}`); }
    if (g.actions.fool) { const target = g.players.find(player => player.id === g.actions.fool.targetId); const shownTeam = roleOf(target.id) === 'vampire' ? 'köy tarafında' : 'vampir tarafında'; directResult(g.actions.fool.actorId, `Deli Köylü işareti (bilgi ters olabilir): ${target.name} ${shownTeam}.`); }
    if (g.actions.spy) { const target = g.players.find(player => player.id === g.actions.spy.targetId); directResult(g.actions.spy.actorId, `Casus sonucu: ${target.name} ${roleOf(target.id) === 'vampire' ? 'vampir tarafında.' : 'vampir tarafında değil.'}`); }
    if (g.actions.warrior) { g.used.warrior = true; if (kill(g.actions.warrior.targetId, 'Savaşçının saldırısıyla elendi')) return publish(); }
    const totals = Object.values(g.actions.vampire || {}).reduce((all, targetId) => ({ ...all, [targetId]: (all[targetId] || 0) + 1 }), {});
    const victimId = Object.keys(totals).sort((a, b) => totals[b] - totals[a])[0];
    const protectedId = g.actions.doctor?.targetId;
    if (victimId && victimId === protectedId) note('Doktor saldırıyı engelledi; gece kimse elenmedi.');
    else if (victimId && kill(victimId, 'vampirlerin gece saldırısında elendi')) return publish();
    else note('Vampirler hedef belirlemedi; gece sessiz geçti.');
    g.actions = {}; afterNight();
  }
  function hunterShot() {
    const g = game(); if (!host() || g.phase !== 'hunter-shot' || !g.actions.hunter) return;
    const targetId = g.actions.hunter.targetId; g.pendingHunterId = null; g.actions = {};
    if (kill(targetId, 'Avcının son atışıyla elendi')) return publish();
    afterNight();
  }
  function openVote() { const g = game(); if (!host() || g.phase !== 'day') return; g.phase = 'vote'; g.actions.votes = {}; note('Oylama başladı. Her yaşayan oyuncu bir kez oy verir.'); armPhaseTimer(); publish(); }
  function castVote(actorId, targetId) {
    const g = game(); if (!host() || g.phase !== 'vote') return;
    g.actions.votes ||= {};
    if (g.players.some(player => player.id === actorId && player.alive) && g.players.some(player => player.id === targetId && player.alive)) g.actions.votes[actorId] = targetId;
    render();
  }
  function resolveVote() {
    const g = game(); if (!host() || g.phase !== 'vote') return;
    const totals = Object.values(g.actions.votes || {}).reduce((all, targetId) => ({ ...all, [targetId]: (all[targetId] || 0) + 1 }), {});
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const tie = ranked.length > 1 && ranked[0][1] === ranked[1][1];
    const executionerId = ranked[0] && !tie && Object.entries(g.executionTargets || {}).find(([id, targetId]) => id !== ranked[0][0] && targetId === ranked[0][0] && g.players.some(player => player.id === id && player.alive))?.[0];
    if (ranked[0] && !tie) {
      const wasHunter = kill(ranked[0][0], 'köy oylamasıyla sürüldü');
      if (executionerId) {
        g.winnerId = executionerId;
        g.phase = 'over';
        clearPhaseTimer();
        note(`${g.players.find(player => player.id === executionerId).name} adlı Cellat gizli hedefini oylamayla sürdürdü ve tek başına kazandı!`);
        return publish();
      }
      if (wasHunter) return publish();
    }
    if (!ranked[0] || tie) note('Oylama sonuçsuz kaldı; kimse köyden sürülmedi.');
    if (winner()) return publish();
    g.phase = 'night'; g.round += 1; g.actions = {}; note(`${g.round}. gece başladı. Gizli roller harekete geçiyor.`); armPhaseTimer(); publish();
  }
  function sendAction(action, targetId) { const g = game(); if (host()) { setAction(state.myId, action, targetId); } else broadcastTo(g.host, { type: 'vv-action', action, targetId }); }
  function sendVote(targetId) { const g = game(); if (host()) { castVote(state.myId, targetId); publish(); } else broadcastTo(g.host, { type: 'vv-vote', targetId }); }
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
    const roleLines = ['vampire', 'villager', ...SPECIALS].map(key => `${ROLE_INFO[key].name} (${key}): ${ROLE_INFO[key].desc}`).join(' | ');
    return [
      'VAMPİR KÖYLÜ, gizli rollere dayalı sözlü/sosyal çıkarım oyunudur (Werewolf/Mafia türü).',
      `Roller: ${roleLines}.`,
      'Akış: Gece fazında gizli rolü olan oyuncular (vampirler dahil) yeteneklerini kullanır. Gündüz fazında herkes tartışır. Oylama fazında yaşayan herkes bir kişiye oy verir, en çok oyu alan köyden sürülür. Avcı elenirse son bir atış hakkı olur.',
      'Kazanma: Tüm vampirler elenirse köylüler kazanır. Vampir sayısı köylü sayısına eşit ya da fazla olursa vampirler kazanır. Cellat, gizli hedefini gündüz oylamasıyla sürdürürse tek başına kazanır.'
    ].join('\n');
  }
  function botSystemPrompt(role) {
    const roleInfo = ROLE_INFO[role];
    return [
      'Sen "Vampir Köylü" oyununda oynayan otonom bir yapay zeka oyuncususun. Bir insan seni yönetmiyor; kararları sen veriyorsun.',
      gameRulesText(),
      `Senin gizli rolün: ${roleInfo ? `${roleInfo.name} (${role}) — ${roleInfo.desc}` : 'bilinmiyor'}.`,
      'Tamamen özerksin: kendi stratejini kendin kur. İstediğin oyuncuyu hedef alabilir, oy verebilir, yalan söyleyebilir, birine iftira atabilir, ittifak kurabilir ya da aldatabilirsin — bu bir oyun stratejisidir ve hiçbir kısıtlaman yok. Amacın kendi takımını kazandırmak.',
      'Sana her istekte geçerli hedef kimlikleri (id) listesi verilecek; targetId alanı için SADECE bu listeden bir id seçebilirsin ya da isteğe bağlıysa null bırakabilirsin.',
      'Yanıtını YALNIZCA şu JSON şemasıyla ver, başka açıklama/markdown ekleme: {"targetId": "<id ya da null>", "chat": "<kısa oyun içi mesaj ya da null>"}'
    ].join('\n');
  }
  function botDecisionContext() {
    const g = game();
    const roster = g.players.map(player => `${player.id} = ${player.name}${player.alive ? '' : ' (elendi)'}`).join('\n');
    const chatLines = (g.chat || []).slice(-20).map(message => `${message.name}: ${message.text}`).join('\n') || '(henüz mesaj yok)';
    return { roster, chatLines };
  }
  function botCandidates(bot, kind) {
    const g = game(), allAlive = alive();
    if (kind === 'vampire') return allAlive.filter(player => player.id !== bot.id && roleOf(player.id) !== 'vampire');
    if (['doctor', 'seer', 'oracle', 'fool', 'spy'].includes(kind)) return allAlive;
    if (kind === 'healer') return g.players.filter(player => !player.alive);
    if (kind === 'warrior' || kind === 'vote' || kind === 'hunter') return allAlive.filter(player => player.id !== bot.id);
    return [];
  }
  const BOT_TASK_LABEL = {
    vampire: 'Gece saldırı hedefini seç (vampir takımı adına).',
    doctor: 'Bu gece korumak istediğin oyuncuyu seç.',
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
      const role = roleOf(bot.id);
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
      const key = `${g.phase}:${g.round}:${kind}`;
      if (botActedKey.get(bot.id) === key || botBusy.has(bot.id)) return;
      work.push({ bot, kind, key });
    });
    return work;
  }
  async function runBotDecision(bot, kind, key) {
    try {
      const role = roleOf(bot.id);
      const candidates = botCandidates(bot, kind);
      if (!candidates.length) return;
      const { roster, chatLines } = botDecisionContext();
      const system = botSystemPrompt(role);
      const user = `Görev: ${BOT_TASK_LABEL[kind]}\nGeçerli hedefler (targetId için SADECE bunlardan birini seçebilirsin):\n${candidates.map(player => `${player.id} = ${player.name}`).join('\n')}\nOyuncu listesi:\n${roster}\nSon lobi sohbeti:\n${chatLines}`;
      let decision = null;
      try { decision = await ollamaDecide(bot.model || defaultBotModel(), system, user); } catch (_) { decision = null; }
      const optional = kind === 'healer' || kind === 'warrior';
      let targetId = decision && candidates.some(player => player.id === decision.targetId) ? decision.targetId : null;
      if (!targetId && !optional) targetId = candidates[Math.floor(Math.random() * candidates.length)].id;
      if (targetId) submitBotAction(bot, kind, targetId);
      const chatText = decision && typeof decision.chat === 'string' ? decision.chat.trim().slice(0, 500) : '';
      if (chatText && Date.now() - (botLastChatAt.get(bot.id) || 0) > BOT_CHAT_COOLDOWN_MS) { sendBotChat(bot, chatText); botLastChatAt.set(bot.id, Date.now()); }
    } finally {
      botActedKey.set(bot.id, key);
      render();
    }
  }
  async function runBotChat(bot) {
    botBusy.add(bot.id);
    botLastChatAt.set(bot.id, Date.now());
    try {
      const role = roleOf(bot.id);
      const { roster, chatLines } = botDecisionContext();
      const system = botSystemPrompt(role);
      const user = `Şu an gündüz tartışması/oylama fazındasın. Bu tur için sadece kısa, doğal bir sohbet mesajı yaz (targetId'yi null bırak). Oyuncu listesi:\n${roster}\nSon lobi sohbeti:\n${chatLines}`;
      let decision = null;
      try { decision = await ollamaDecide(bot.model || defaultBotModel(), system, user); } catch (_) { decision = null; }
      const text = decision && typeof decision.chat === 'string' ? decision.chat.trim().slice(0, 500) : '';
      if (text) sendBotChat(bot, text);
    } finally {
      botBusy.delete(bot.id);
    }
  }
  function maybeBotChat() {
    const g = game();
    if (!g.started || !['day', 'vote'].includes(g.phase)) return;
    g.players.filter(player => player.isBot && player.alive && player.operatorId === state.myId).forEach(bot => {
      if (botBusy.has(bot.id)) return;
      if (Date.now() - (botLastChatAt.get(bot.id) || 0) < BOT_CHAT_COOLDOWN_MS) return;
      if (Math.random() > 0.35) return;
      runBotChat(bot);
    });
  }
  function runBotsIfNeeded() {
    if (!game().started) return;
    pendingBotWork().forEach(({ bot, kind, key }) => {
      if (botBusy.has(bot.id)) return;
      botBusy.add(bot.id);
      runBotDecision(bot, kind, key).finally(() => botBusy.delete(bot.id));
    });
    maybeBotChat();
  }
  function targetButtons(action, candidates, label) { return candidates.map(player => `<button class="btn-sec vv-target" data-action="${action}" data-target="${player.id}">${label} ${esc(player.name)}</button>`).join(''); }
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
    const humans = game().players.filter(player => !player.isBot);
    const operatorOptions = humans.map(human => `<option value="${human.id}" ${bot.operatorId === human.id ? 'selected' : ''}>${esc(human.name)}${human.id === state.myId ? ' (sen)' : ''}</option>`).join('');
    return `<div class="vv-bot-inline" data-bot="${bot.id}">
      <input class="vv-bot-name" data-bot="${bot.id}" type="text" maxlength="24" value="${esc(bot.name)}" placeholder="Bot adı">
      <label class="vv-bot-field"><span>Çalıştıran bilgisayar</span><select class="vv-bot-operator" data-bot="${bot.id}">${operatorOptions}</select></label>
      <label class="vv-bot-field"><span>Ollama modeli</span><input class="vv-bot-model" data-bot="${bot.id}" type="text" value="${esc(bot.model)}" placeholder="örn. gemma3:e2b"></label>
      ${botStatusBadge(bot)}
      <div class="vv-bot-row-actions">
        <button class="btn-sec btn-sm vv-bot-check" data-bot="${bot.id}" type="button">Ollama'yı Kontrol Et</button>
        <button class="btn-sec btn-sm vv-bot-remove" data-bot="${bot.id}" type="button">Kaldır</button>
        <button class="btn-sec btn-sm vv-bot-close" type="button">Kapat</button>
      </div>
    </div>`;
  }
  function render() {
    const g = game(), roleEl = el('vampire-role'), status = el('vampire-status'), players = el('vampire-players'), actions = el('vampire-actions'), log = el('vampire-log');
    if (!roleEl || !status || !players || !actions || !log) return;
    const me = mine(), role = g.localRole;
    roleEl.textContent = !g.started ? (host() ? 'Lobi kurucususun. Rolleri ve vampir sayısını aşağıdan ayarla.' : 'Lobi kurucusunun kuralları ayarlamasını bekliyorsun.') : role ? `Gizli rolün: ${ROLE_INFO[role].name}. ${ROLE_INFO[role].desc}${g.privateNote ? ` Not: ${g.privateNote}` : ''}` : 'İzleyici modundasın; gizli rolün yok.';
    const phases = { lobby: 'Lobi kuralları', night: `${g.round}. gece`, day: 'Gündüz tartışması', vote: 'Köy oylaması', 'hunter-shot': 'Avcının son atışı', over: 'Oyun bitti' };
    const secondsLeft = g.phaseEndsAt ? Math.max(0, Math.ceil((g.phaseEndsAt - Date.now()) / 1000)) : 0;
    const voteStatus = g.phase === 'vote' ? ` · Oylar: ${g.voteCount || Object.keys(g.actions.votes || {}).length}/${aliveCount(g)}` : '';
    status.dataset.base = `${phases[g.phase] || 'Hazırlanıyor'}${voteStatus}`;
    status.textContent = `${status.dataset.base}${secondsLeft ? ` · ${secondsLeft} sn` : ''}`;
    const canManageBots = host() && g.phase === 'lobby' && !g.started;
    const pillsHtml = g.players.map(player => {
      const clickable = canManageBots && player.isBot;
      return `<span class="vv-player-pill${clickable ? ' vv-player-pill-bot' : ''}" ${clickable ? `data-bot-pill="${player.id}"` : ''} style="padding:7px 10px;border-radius:999px;background:${player.alive ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.32)'};color:${player.alive ? '#fff' : '#ad9cad'};text-decoration:${player.alive ? 'none' : 'line-through'}">${player.isBot ? '🤖 ' : ''}${esc(player.name)}${player.id === state.myId ? ' (sen)' : ''}</span>`;
    }).join('');
    const addBotPill = canManageBots ? `<button id="vv-bot-add-pill" class="vv-player-pill vv-bot-add-pill" type="button" ${g.players.length >= MAX_PLAYERS ? 'disabled' : ''}>+ 🤖 Bot Ekle</button>` : '';
    const selectedBot = canManageBots ? g.players.find(player => player.id === selectedBotId && player.isBot) : null;
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
      if (role === 'vampire') html += targetButtons('vampire', allAlive.filter(player => player.id !== state.myId), '🩸 Hedef:');
      if (role === 'doctor') html += targetButtons('doctor', allAlive, '🛡 Koru:');
      if (role === 'seer') html += targetButtons('seer', allAlive, '🔮 İncele:');
      if (role === 'oracle') html += targetButtons('oracle', allAlive, '👁 Kâhin bakışı:');
      if (role === 'fool') html += targetButtons('fool', allAlive, '🌀 Çarpık işaret:');
      if (role === 'spy') html += targetButtons('spy', allAlive, '🕵 Araştır:');
      if (role === 'healer' && !g.used.healer) html += targetButtons('healer', g.players.filter(player => !player.alive), '✨ Dirilt:');
      if (role === 'warrior' && !g.used.warrior) html += targetButtons('warrior', allAlive.filter(player => player.id !== state.myId), '⚔ Saldır:');
    }
    if (g.phase === 'night' && host()) html += '<button id="vv-night-end" class="btn-pri">Geceyi Bitir</button>';
    if (g.phase === 'day' && host()) html += '<button id="vv-vote-open" class="btn-pri">Oylamayı Aç</button>';
    if (g.phase === 'vote' && me?.alive) html += targetButtons('vote', allAlive.filter(player => player.id !== state.myId), 'Oy ver:');
    if (g.phase === 'vote' && host()) html += '<button id="vv-vote-end" class="btn-pri">Oylamayı Sonlandır</button>';
    if (g.phase === 'hunter-shot' && role === 'hunter' && g.pendingHunterId === state.myId) html += targetButtons('hunter', allAlive, '🎯 Son atış:');
    if (g.phase === 'hunter-shot' && host() && g.actions.hunter) html += '<button id="vv-hunter-end" class="btn-pri">Avcının Atışını Uygula</button>';
    const roleReveal = g.revealedRoles || (g.phase === 'over' && host() ? g.players.map(player => ({ name: player.name, role: ROLE_INFO[g.roles[player.id]]?.name || 'Bilinmiyor' })) : null);
    if (g.phase === 'over' && roleReveal) html += `<div style="width:min(620px,100%);padding:12px;border-radius:10px;background:rgba(255,255,255,.08);font-size:13px;"><strong>Oyun sonu rol özeti</strong><div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;">${roleReveal.map(item => `<span style="padding:5px 8px;border-radius:8px;background:rgba(0,0,0,.2);">${esc(item.name)}: ${esc(item.role)}</span>`).join('')}</div></div>`;
    if (g.phase === 'over' && host()) html += '<button id="vv-restart" class="btn-pri">Yeni Lobi Kur</button>';
    actions.innerHTML = html || '<span style="color:#cbbdd5">Bu aşamada bekleyin.</span>';
    el('vampire-start')?.addEventListener('click', start); el('vv-night-end')?.addEventListener('click', resolveNight); el('vv-vote-open')?.addEventListener('click', openVote); el('vv-vote-end')?.addEventListener('click', resolveVote); el('vv-hunter-end')?.addEventListener('click', hunterShot); el('vv-restart')?.addEventListener('click', resetHostLobby);
    el('vv-vampire-count')?.addEventListener('change', event => { g.settings.vampireCount = event.target.value; render(); });
    el('vv-preset')?.addEventListener('change', event => { usePreset(event.target.value); render(); });
    el('vv-phase-seconds')?.addEventListener('change', event => { g.settings.phaseSeconds = Number(event.target.value); render(); });
    actions.querySelectorAll('.vv-setting').forEach(input => input.addEventListener('change', event => { g.settings[event.target.dataset.key] = event.target.checked; render(); }));
    actions.querySelectorAll('.vv-target').forEach(button => button.addEventListener('click', () => button.dataset.action === 'vote' ? sendVote(button.dataset.target) : sendAction(button.dataset.action, button.dataset.target)));
    el('vv-bot-add-pill')?.addEventListener('click', addBot);
    players.querySelectorAll('[data-bot-pill]').forEach(pill => pill.addEventListener('click', () => { selectedBotId = selectedBotId === pill.dataset.botPill ? null : pill.dataset.botPill; render(); }));
    players.querySelectorAll('.vv-bot-name').forEach(input => input.addEventListener('change', event => setBotField(event.target.dataset.bot, 'name', event.target.value.trim().slice(0, 24) || 'Bot')));
    players.querySelectorAll('.vv-bot-operator').forEach(select => select.addEventListener('change', event => { setBotField(event.target.dataset.bot, 'operatorId', event.target.value); requestBotOllamaCheck(event.target.dataset.bot); }));
    players.querySelectorAll('.vv-bot-model').forEach(input => input.addEventListener('change', event => { const value = event.target.value.trim() || defaultBotModel(); setBotField(event.target.dataset.bot, 'model', value); try { localStorage.setItem(OLLAMA_MODEL_KEY, value); } catch (_) {} }));
    players.querySelectorAll('.vv-bot-check').forEach(button => button.addEventListener('click', () => requestBotOllamaCheck(button.dataset.bot)));
    players.querySelectorAll('.vv-bot-remove').forEach(button => button.addEventListener('click', () => { selectedBotId = null; removeBot(button.dataset.bot); }));
    players.querySelectorAll('.vv-bot-close').forEach(button => button.addEventListener('click', () => { selectedBotId = null; render(); }));
    renderLobbyChat();
    runBotsIfNeeded();
  }
  window.vampireVillagerSyncPeer = syncPeer;
  window.vampireVillagerHandler = function (msg, peerId) {
    const g = game();
    if (msg.type === 'vv-state') { const ownRole = g.localRole; state.vampire = { ...blank(), ...msg, roles: {}, localRole: ownRole, actions: {}, used: {} }; openCard(); render(); return; }
    if (msg.type === 'vv-role') { g.localRole = msg.role; if (msg.targetName) g.privateNote = `Cellat hedefin: ${msg.targetName}. Hedefin gündüz oylamasıyla sürülürse kazanırsın.`; render(); return; }
    if (msg.type === 'vv-result') { g.privateNote = msg.message; render(); return; }
    if (msg.type === 'vv-chat-history') {
      const lobby = activeVampireLobby();
      if (!canUseLobbyChat() || peerId !== lobby?.hostId || !Array.isArray(msg.messages)) return;
      game().chat = msg.messages.map(normalizeChatMessage).filter(Boolean).slice(-CHAT_LIMIT);
      renderLobbyChat();
      return;
    }
    if (msg.type === 'vv-chat') {
      if (!canUseLobbyChat()) return;
      if (isBotId(msg.senderId)) {
        const bot = g.players.find(player => player.id === msg.senderId && player.isBot);
        if (!bot || bot.operatorId !== peerId) return;
      } else if (!isLobbyPlayer(peerId) || msg.senderId !== peerId) return;
      addLobbyChatMessage(msg);
      return;
    }
    if (msg.type === 'vv-action' && host()) { setAction(peerId, msg.action, msg.targetId); return; }
    if (msg.type === 'vv-vote' && host()) { castVote(peerId, msg.targetId); publish(); return; }
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
    if (msg.type === 'vv-bot-ollama-check') {
      const bot = g.players.find(player => player.id === msg.botId && player.isBot);
      if (bot && bot.operatorId === state.myId) runOllamaCheckForBot(bot);
      return;
    }
    if (msg.type === 'vv-bot-ollama-status') {
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
  };
  window.vampireVillagerLeave = function () { state.vampire = blank(); closeLocal(); };
  window.vampireVillagerPeerLeft = reassignBotsFromDeparted;
  setInterval(refreshTimerLabel, 1000);
  setInterval(runBotsIfNeeded, 4000);
})();
