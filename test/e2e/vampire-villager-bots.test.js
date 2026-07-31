const assert = require('assert');
const { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor } = require('./lib/harness');

// Ollama gerçekten çalışmıyor olsa bile bu testler botların davranışını
// doğrulayabilsin diye window.fetch sahte bir Ollama sunucusuyla değiştirilir.
async function installMockOllama(peer) {
  await evalJS(peer.client, `(() => {
    window.Math.random = () => 0; // sohbet/fallback rastgeleliğini deterministik yap
    window.__mockOllamaUp = true;
    window.__mockModels = ['gemma3:1b', 'llama3:8b'];
    window.__mockChatResponse = { targetId: null, chat: null };
    window.__mockChatFail = false;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/api/tags')) {
        if (!window.__mockOllamaUp) throw new Error('mock: connection refused');
        return { ok: true, json: async () => ({ models: window.__mockModels.map(name => ({ name })) }) };
      }
      if (u.includes('/api/chat')) {
        if (window.__mockChatFail) throw new Error('mock: chat failed');
        const content = typeof window.__mockChatResponse === 'function'
          ? window.__mockChatResponse(JSON.parse(opts.body))
          : window.__mockChatResponse;
        return { ok: true, json: async () => ({ message: { content: JSON.stringify(content) } }) };
      }
      throw new Error('unexpected fetch in test: ' + u);
    };
    return 1;
  })()`);
}

async function setLobbyPhaseState(peer, hostId, extraPlayers = []) {
  await evalJS(peer.client, `(() => {
    window.state.vampire = {
      host: ${JSON.stringify(hostId)}, started: false, phase: 'lobby', round: 0,
      players: [{ id: ${JSON.stringify(hostId)}, name: 'Kurucu', alive: true }, ...${JSON.stringify(extraPlayers)}],
      roles: {}, localRole: null,
      settings: { vampireCount: 'auto', preset: 'balanced', phaseSeconds: 0, seer: true, oracle: false, fool: false, doctor: true, healer: false, hunter: true, warrior: false, spy: false, executioner: false },
      actions: {}, used: {}, executionTargets: {}, winnerId: null, pendingHunterId: null, phaseEndsAt: 0, privateNote: '', log: [], chat: []
    };
    openCardFocused('vampire-card');
    window.vampireVillagerHandler({ type: 'vv-role', role: null }, window.state.myId);
    return 1;
  })()`);
}

// Bot sohbeti activeVampireLobby()'ye (state.lobbies içindeki 'vampire' lobisine)
// bağlı olduğundan, oyun senaryosuyla eşleşen bir lobi kaydı da kurulmalı.
async function setupLobbyRecord(peer, hostId, players) {
  await evalJS(peer.client, `(() => {
    window.state.activeLobbyId = 'test-lobby';
    window.state.isLobbyHost = true;
    window.state.lobbies = [{
      id: 'test-lobby', hostId: ${JSON.stringify(hostId)}, hostName: 'Kurucu', activity: 'vampire', status: 'playing',
      players: ${JSON.stringify(players)}.map(p => ({ id: p.id, name: p.name, isBot: !!p.isBot })),
      spectators: []
    }];
    return 1;
  })()`);
}

async function installNightScenario(peer, hostId, roleMap, botOverrides = {}) {
  const players = Object.keys(roleMap).map(id => ({ id, name: id, alive: true, ...(botOverrides[id] || {}) }));
  await setupLobbyRecord(peer, hostId, players);
  await evalJS(peer.client, `(() => {
    const roles = ${JSON.stringify(roleMap)};
    const players = ${JSON.stringify(players)};
    window.state.vampire = {
      host: ${JSON.stringify(hostId)}, started: true, phase: 'night', round: 1,
      players, roles, localRole: roles[window.state.myId], settings: {}, actions: {}, used: {},
      pendingHunterId: null, privateNote: '', log: [], chat: []
    };
    window.vampireVillagerHandler({ type: 'vv-role', role: roles[window.state.myId] }, window.state.myId);
    return 1;
  })()`);
}

async function state(peer) {
  return evalJS(peer.client, `JSON.parse(JSON.stringify(window.state.vampire))`);
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9420, name: 'Bot Testi' });
  try {
    await createRoom(peer);
    const host = await evalJS(peer.client, 'window.state.myId');
    await installMockOllama(peer);

    // --- Bot yönetim arayüzü: isim pili satırından ekleme, tıklayınca satır-içi
    // düzenleyici açılması, isim/model/operator değiştirme, kaldırma ---
    await setLobbyPhaseState(peer, host);
    await evalJS(peer.client, `document.getElementById('vv-bot-add-pill').click(); document.getElementById('vv-bot-add-pill').click(); 1`);
    let layout = await evalJS(peer.client, `(() => ({
      pills: document.querySelectorAll('[data-bot-pill]').length,
      names: Array.from(document.querySelectorAll('[data-bot-pill]')).map(p => p.textContent.trim()),
      startDisabled: document.getElementById('vampire-start').disabled
    }))()`);
    assert.strictEqual(layout.pills, 2, JSON.stringify(layout));
    assert.deepStrictEqual(layout.names, ['🤖 Bot 1', '🤖 Bot 2'], JSON.stringify(layout));
    assert.strictEqual(layout.startDisabled, true, 'Botlarla birlikte 3 oyuncu varken başlat düğmesi hâlâ kapalı olmalı: ' + JSON.stringify(layout));

    await evalJS(peer.client, `document.getElementById('vv-bot-add-pill').click(); 1`);
    layout = await evalJS(peer.client, `(() => ({
      pills: document.querySelectorAll('[data-bot-pill]').length,
      startDisabled: document.getElementById('vampire-start').disabled
    }))()`);
    assert.strictEqual(layout.pills, 3, JSON.stringify(layout));
    assert.strictEqual(layout.startDisabled, false, 'Kurucu + 3 bot (4 oyuncu) ile oyun başlatılabilmeli: ' + JSON.stringify(layout));

    // Bot pili henüz düzenleyici açmadan önce inline editör görünmemeli
    assert.strictEqual(await evalJS(peer.client, `!!document.querySelector('.vv-bot-inline')`), false, 'Tıklanmadan bot editörü açık olmamalı');

    // Pile tıklayınca satır-içi editör açılmalı
    await evalJS(peer.client, `document.querySelector('[data-bot-pill]').click(); 1`);
    assert.strictEqual(await evalJS(peer.client, `!!document.querySelector('.vv-bot-inline')`), true, 'Bot pili tıklanınca editör açılmadı');

    // İsim değişikliği
    await evalJS(peer.client, `(() => {
      const input = document.querySelector('.vv-bot-name');
      input.value = 'Deli Dumrul';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    let game = await state(peer);
    assert.strictEqual(game.players.find(p => p.isBot && p.name === 'Deli Dumrul') !== undefined, true, 'Bot ismi güncellenmedi');

    // Model değişikliği
    await evalJS(peer.client, `(() => {
      const input = document.querySelector('.vv-bot-model');
      input.value = 'llama3:8b';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    game = await state(peer);
    assert.strictEqual(game.players.find(p => p.name === 'Deli Dumrul').model, 'llama3:8b', 'Bot modeli güncellenmedi');

    // Operatör her zaman lobideki gerçek bir insana ayarlanabilmeli (burada tek insan: kurucu)
    const operatorOptions = await evalJS(peer.client, `Array.from(document.querySelector('.vv-bot-operator').options).map(o => o.value)`);
    assert.deepStrictEqual(operatorOptions, [host], JSON.stringify(operatorOptions));

    // Ollama kontrolü: sahte sunucu ayakta, "Bağlı" rozeti görünmeli
    await evalJS(peer.client, `document.querySelector('.vv-bot-check').click(); 1`);
    await waitFor(peer.client, `document.querySelector('.vv-bot-status.ok') ? 'yes' : null`, 5000, 'ollama check ok badge');

    // Kapat düğmesi editörü gizlemeli ama botu silmemeli
    await evalJS(peer.client, `document.querySelector('.vv-bot-close').click(); 1`);
    assert.strictEqual(await evalJS(peer.client, `!!document.querySelector('.vv-bot-inline')`), false, 'Kapat düğmesi editörü kapatmadı');
    assert.strictEqual(await evalJS(peer.client, `document.querySelectorAll('[data-bot-pill]').length`), 3, 'Kapat düğmesi yanlışlıkla bot sildi');

    // Bot kaldırma (pile tekrar tıkla, editörü aç, kaldır'a bas)
    await evalJS(peer.client, `document.querySelector('[data-bot-pill]').click(); 1`);
    const removedCountBefore = await evalJS(peer.client, `document.querySelectorAll('[data-bot-pill]').length`);
    await evalJS(peer.client, `document.querySelector('.vv-bot-remove').click(); 1`);
    const removedCountAfter = await evalJS(peer.client, `document.querySelectorAll('[data-bot-pill]').length`);
    assert.strictEqual(removedCountAfter, removedCountBefore - 1, 'Bot kaldırılmadı');
    assert.strictEqual(await evalJS(peer.client, `!!document.querySelector('.vv-bot-inline')`), false, 'Bot kaldırılınca editör hâlâ açık kaldı');

    // --- Bot otonom gece kararı: mock Ollama geçerli bir hedef döndürünce uygulanmalı ---
    await evalJS(peer.client, `window.__mockChatResponse = { targetId: ${JSON.stringify(host)}, chat: 'Sizden şüpheleniyorum.' }; 1`);
    await installNightScenario(peer, host, { [host]: 'villager', vampir: 'vampire', botseer: 'seer' }, {
      botseer: { isBot: true, operatorId: host, model: 'gemma3:1b' }
    });
    await waitFor(peer.client, `window.state.vampire.actions && window.state.vampire.actions.seer ? 'yes' : null`, 8000, 'bot seer decision applied');
    game = await state(peer);
    assert.strictEqual(game.actions.seer.actorId, 'botseer', JSON.stringify(game.actions));
    assert.strictEqual(game.actions.seer.targetId, host, 'Bot, mock Ollama yanıtındaki geçerli hedefi seçmedi');
    // Bot sohbeti de otonom şekilde gönderilmeli (targetId ile birlikte chat alanı da geldi)
    await waitFor(peer.client, `(window.state.vampire.chat || []).some(m => m.senderId === 'botseer') ? 'yes' : null`, 8000, 'bot chat message sent');

    // --- Ollama hata verse/çökse bile oyun tıkanmamalı: geçerli rastgele hedefe düşmeli ---
    await evalJS(peer.client, `window.__mockChatFail = true; 1`);
    await setupLobbyRecord(peer, host, [
      { id: host, name: 'Kurucu' },
      { id: 'botvoter', name: 'Bot Oycu', isBot: true },
      { id: 'koylu1', name: 'koylu1' }
    ]);
    await evalJS(peer.client, `(() => {
      window.state.vampire = {
        host: ${JSON.stringify(host)}, started: true, phase: 'vote', round: 1,
        players: [
          { id: ${JSON.stringify(host)}, name: 'Kurucu', alive: true },
          { id: 'botvoter', name: 'Bot Oycu', alive: true, isBot: true, operatorId: ${JSON.stringify(host)}, model: 'gemma3:1b' },
          { id: 'koylu1', name: 'koylu1', alive: true }
        ],
        roles: { ${JSON.stringify(host)}: 'villager', botvoter: 'villager', koylu1: 'villager' },
        localRole: 'villager', settings: {}, actions: { votes: {} }, used: {},
        pendingHunterId: null, privateNote: '', log: [], chat: []
      };
      window.vampireVillagerHandler({ type: 'vv-role', role: 'villager' }, window.state.myId);
      return 1;
    })()`);
    await waitFor(peer.client, `window.state.vampire.actions.votes && window.state.vampire.actions.votes.botvoter ? 'yes' : null`, 8000, 'bot fallback vote applied despite ollama failure');
    game = await state(peer);
    assert.ok([host, 'koylu1'].includes(game.actions.votes.botvoter), 'Ollama hata verdiğinde bot geçerli bir hedefe rastgele oy vermedi: ' + JSON.stringify(game.actions));

    // --- Sistem promptu (karakter): editörden yazılır, oyuncu nesnesine işlenir
    // ve Ollama'ya giden system mesajına girer ---
    await evalJS(peer.client, `window.__mockChatFail = false; window.__mockChatResponse = (body) => { window.__lastBody = body; return { dusunce: 'Şüpheliyim.', targetId: null, chat: null }; }; 1`);
    await setLobbyPhaseState(peer, host);
    await evalJS(peer.client, `document.getElementById('vv-bot-add-pill').click(); document.querySelector('[data-bot-pill]').click(); 1`);
    const personaText = 'Sürekli şiir okuyan huysuz bir demircisin.';
    await evalJS(peer.client, `(() => {
      const area = document.querySelector('.vv-bot-persona');
      area.value = ${JSON.stringify(personaText)};
      area.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    game = await state(peer);
    const personaBot = game.players.find(p => p.isBot);
    assert.strictEqual(personaBot.persona, personaText, 'Sistem promptu bota işlenmedi: ' + JSON.stringify(personaBot));

    // --- Hafıza: rol, gizli sonuç, sohbet ve kendi kararı bot hafızasına düşmeli ---
    await installNightScenario(peer, host, { [host]: 'villager', vampir: 'vampire', botsair: 'seer', koylu1: 'villager' }, {
      botsair: { isBot: true, operatorId: host, model: 'gemma3:1b', persona: personaText }
    });
    // Kurucu rol dağıtımını yaptığında bot rolünü öğrenir ve hafızasına yazar.
    await evalJS(peer.client, `window.vampireVillagerHandler({ type: 'vv-bot-role', botId: 'botsair', role: 'seer', teammates: [] }, ${JSON.stringify(host)}); 1`);
    await evalJS(peer.client, `window.__mockChatResponse = (body) => { window.__lastBody = body; return { dusunce: 'Vampiri arıyorum.', targetId: 'vampir', chat: 'Bence vampir aramızda.' }; }; 1`);
    await waitFor(peer.client, `window.state.vampire.actions && window.state.vampire.actions.seer ? 'yes' : null`, 8000, 'bot seer decision with persona');
    const prompt = await evalJS(peer.client, `(() => {
      const body = window.__lastBody || {};
      const system = (body.messages || []).find(m => m.role === 'system')?.content || '';
      const user = (body.messages || []).find(m => m.role === 'user')?.content || '';
      return {
        model: body.model,
        hasPersona: system.includes(${JSON.stringify(personaText)}),
        hasMemorySection: user.includes('Hafızan'),
        hasChatSection: user.includes('Son lobi sohbeti'),
        leaksOtherRoles: user.includes('koylu1 = koylu1 (villager)')
          || user.includes('vampir = vampir (vampire)')
          || system.includes('koylu1 = koylu1')
      };
    })()`);
    assert.deepStrictEqual(prompt, {
      model: 'gemma3:1b',
      hasPersona: true,
      hasMemorySection: true,
      hasChatSection: true,
      leaksOtherRoles: false
    }, 'Bot promptuna başka oyuncuların rolleri sızdı: ' + JSON.stringify(prompt));

    // Gece çözülünce büyücü sonucu yalnızca bota özel olarak hafızasına yazılmalı
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    // Oyun sohbeti yalnız gündüz meclisinde açıktır; konuşulanlar bot hafızasına gitmeli.
    await evalJS(peer.client, `window.vampireVillagerHandler({ type: 'vv-chat', id: 'm1', senderId: 'koylu1', text: 'Ben doktorum, dün gece kurucuyu korudum.', sentAt: Date.now() }, 'koylu1'); 1`);
    await evalJS(peer.client, `(() => { const pill = Array.from(document.querySelectorAll('[data-bot-pill]'))[0]; pill && pill.click(); return 1; })()`);
    const memoryPanel = await evalJS(peer.client, `document.querySelector('.vv-bot-memory')?.textContent || ''`);
    assert.match(memoryPanel, /Gizli rolün: Büyücü/, 'Bot rolünü hafızasına yazmadı: ' + memoryPanel);
    assert.match(memoryPanel, /Büyücü sonucu/, 'Gizli gece sonucu bot hafızasına gitmedi: ' + memoryPanel);
    assert.match(memoryPanel, /koylu1 sohbette dedi ki/, 'Sohbet mesajı bot hafızasına gitmedi: ' + memoryPanel);
    assert.match(memoryPanel, /Düşüncen: Vampiri arıyorum/, 'Botun kendi muhakemesi hafızaya yazılmadı: ' + memoryPanel);
    const privateNote = (await state(peer)).privateNote || '';
    assert.ok(!privateNote.includes('Büyücü sonucu'), 'Bota özel sonuç insan oyuncuya sızdı: ' + privateNote);

    // --- Başka bir bilgisayarda çalışan bot: rolünü kurucudan mesajla öğrenmeli ---
    await evalJS(peer.client, `(() => {
      window.__lastBody = null;
      window.state.vampire = {
        host: 'uzak-kurucu', started: true, phase: 'night', round: 2,
        players: [
          { id: 'uzak-kurucu', name: 'Uzak Kurucu', alive: true },
          { id: 'vvbot-uzak', name: 'Uzak Bot', alive: true, isBot: true, operatorId: window.state.myId, model: 'gemma3:1b', persona: '' },
          { id: 'koylu1', name: 'koylu1', alive: true },
          { id: 'koylu2', name: 'koylu2', alive: true }
        ],
        roles: {}, localRole: 'villager', settings: {}, actions: {}, used: {},
        pendingHunterId: null, privateNote: '', log: [], chat: []
      };
      window.vampireVillagerHandler({ type: 'vv-bot-role', botId: 'vvbot-uzak', role: 'vampire', teammates: [{ id: 'koylu2', name: 'koylu2' }] }, 'uzak-kurucu');
      return 1;
    })()`);
    await waitFor(peer.client, `(window.__lastBody && (window.__lastBody.messages || []).some(m => m.role === 'system' && m.content.includes('Senin gizli rolün: Vampir (vampire)'))) ? 'yes' : null`, 9000, 'uzak bot rolünü öğrenip gece kararı üretmeli');
    const remotePrompt = await evalJS(peer.client, `(() => {
      const user = (window.__lastBody.messages || []).find(m => m.role === 'user')?.content || '';
      return { mentionsTeammate: user.includes('takım arkadaşların'), offersTeammateAsTarget: /koylu2 = koylu2/.test(user.split('Oyuncu listesi')[0]) };
    })()`);
    assert.strictEqual(remotePrompt.mentionsTeammate, true, 'Vampir botun takım arkadaşı hafızasına yazılmadı: ' + JSON.stringify(remotePrompt));
    assert.strictEqual(remotePrompt.offersTeammateAsTarget, false, 'Vampir bota takım arkadaşı hedef olarak sunuldu: ' + JSON.stringify(remotePrompt));

    // --- Sistem promptu oyunun kurallarını ve anlık durumu içermeli (küçük modeller için) ---
    const rulesPrompt = await evalJS(peer.client, `(() => {
      const system = (window.__lastBody.messages || []).find(m => m.role === 'system')?.content || '';
      return {
        hasRules: system.includes('OYUNUN KURALLARI'),
        hasPhases: system.includes('1) GECE') && system.includes('2) GÜNDÜZ') && system.includes('3) OYLAMA'),
        hasWinCondition: system.includes('Tüm vampirler elenirse'),
        hasRoleList: system.includes('Büyücü (seer)') && system.includes('Doktor (doctor)'),
        hasSituation: system.includes('ŞU ANKİ DURUM'),
        hasChatRule: system.includes('Sana bir soru sorulduysa'),
        hasAveragePlayerRule: system.includes('Kusursuz veya her şeyi bilen biri değilsin'),
        hasEvidenceDiscipline: system.includes('İddia ile doğrulanmış bilgiyi ayır'),
        hasRoleStrategy: system.includes('ROL STRATEJİN'),
        hasSuspicionSchema: system.includes('"supheler"'),
        hasJsonExample: system.includes('Örnek doğru yanıt')
      };
    })()`);
    assert.deepStrictEqual(rulesPrompt, {
      hasRules: true, hasPhases: true, hasWinCondition: true, hasRoleList: true, hasSituation: true, hasChatRule: true,
      hasAveragePlayerRule: true, hasEvidenceDiscipline: true, hasRoleStrategy: true, hasSuspicionSchema: true, hasJsonExample: true
    }, JSON.stringify(rulesPrompt));

    // --- Model seçimi: panel açılınca o bilgisayardaki modeller listeden seçilebilmeli ---
    await setLobbyPhaseState(peer, host);
    await evalJS(peer.client, `document.getElementById('vv-bot-add-pill').click(); 1`);
    await evalJS(peer.client, `document.querySelector('[data-bot-pill]').click(); 1`);
    await waitFor(peer.client, `document.querySelector('select.vv-bot-model') ? 'yes' : null`, 6000, 'model listesi otomatik yüklenmeli');
    const modelPicker = await evalJS(peer.client, `(() => {
      const select = document.querySelector('select.vv-bot-model');
      return { options: Array.from(select.options).map(o => o.value), value: select.value };
    })()`);
    assert.deepStrictEqual(modelPicker.options, ['gemma3:1b', 'llama3:8b'], JSON.stringify(modelPicker));
    await evalJS(peer.client, `(() => {
      const select = document.querySelector('select.vv-bot-model');
      select.value = 'llama3:8b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    game = await state(peer);
    assert.strictEqual(game.players.find(p => p.isBot).model, 'llama3:8b', 'Listeden seçilen model bota işlenmedi');

    // --- Konuşma dili: yalnızca uygulamanın desteklediği 13 dil sunulmalı,
    // seçim bot durumuna ve Ollama sistem promptuna taşınmalı. ---
    const languagePicker = await evalJS(peer.client, `(() => {
      const select = document.querySelector('.vv-bot-language');
      return { options: Array.from(select.options).map(o => o.value), value: select.value };
    })()`);
    assert.deepStrictEqual(languagePicker.options, ['tr', 'en', 'de', 'es', 'fr', 'pt-BR', 'ru', 'ar', 'kk', 'tk', 'mn', 'zh-CN', 'ja'], JSON.stringify(languagePicker));
    await evalJS(peer.client, `(() => {
      const select = document.querySelector('.vv-bot-language');
      select.value = 'de';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    game = await state(peer);
    assert.strictEqual(game.players.find(p => p.isBot).language, 'de', 'Bot konuşma dili güncellenmedi');
    await evalJS(peer.client, `window.__mockChatFail = false; window.__mockChatResponse = (body) => { window.__lastBody = body; return { dusunce: 'Prüfe einen Spieler.', targetId: ${JSON.stringify(host)}, chat: null, supheler: [] }; }; 1`);
    await installNightScenario(peer, host, { [host]: 'villager', vampir: 'vampire', botlang: 'seer' }, {
      botlang: { isBot: true, operatorId: host, model: 'gemma3:1b', language: 'de' }
    });
    await waitFor(peer.client, `window.state.vampire.actions?.seer?.actorId === 'botlang' ? 'yes' : null`, 8000, 'dil seçilmiş bot karar vermeli');
    const languagePrompt = await evalJS(peer.client, `(() => {
      const system = (window.__lastBody.messages || []).find(m => m.role === 'system')?.content || '';
      const user = (window.__lastBody.messages || []).find(m => m.role === 'user')?.content || '';
      return { germanOnly: system.includes('Yalnızca Deutsch (de) konuş'), hasBeliefTable: user.includes('Şüphe tablon') };
    })()`);
    assert.deepStrictEqual(languagePrompt, { germanOnly: true, hasBeliefTable: true }, JSON.stringify(languagePrompt));

    // --- Kanıt tabanlı yedek karar: Büyücü tarafından doğrulanmış vampir,
    // Ollama çöktüğünde rastgele biri yerine oylama hedefi olmalı. ---
    await evalJS(peer.client, `window.__mockChatResponse = { dusunce: 'Vampiri kontrol ediyorum.', targetId: 'vampir', chat: null, supheler: [] }; 1`);
    await installNightScenario(peer, host, { [host]: 'villager', vampir: 'vampire', botintel: 'seer', koylu1: 'villager' }, {
      botintel: { isBot: true, operatorId: host, model: 'gemma3:1b', language: 'tr' }
    });
    await waitFor(peer.client, `window.state.vampire.actions?.seer?.actorId === 'botintel' ? 'yes' : null`, 8000, 'kanıt botu gece incelemesi');
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    await evalJS(peer.client, `(() => {
      window.__mockChatFail = true;
      window.state.vampire.phase = 'vote';
      window.state.vampire.actions = { votes: {} };
      window.vampireVillagerHandler({ type: 'vv-role', role: 'villager' }, ${JSON.stringify(host)});
      return 1;
    })()`);
    await waitFor(peer.client, `window.state.vampire.actions?.votes?.botintel ? 'yes' : null`, 8000, 'kanıta dayalı yedek oy');
    game = await state(peer);
    assert.strictEqual(game.actions.votes.botintel, 'vampir', 'Bot doğrulanmış vampir yerine rastgele hedef seçti: ' + JSON.stringify(game.actions));

    // --- Sohbet iknası: model kapalıyken bile insanın gerekçeli suçlaması botun
    // şüphe tablosuna girmeli ve bot kendi oyunu bu kanaate göre kullanmalı. ---
    await setupLobbyRecord(peer, host, [
      { id: host, name: 'Kurucu' },
      { id: 'vvbot-ikna', name: 'Sorgucu', isBot: true },
      { id: 'iknaci', name: 'İknacı' },
      { id: 'supheli', name: 'Ali' }
    ]);
    await evalJS(peer.client, `(() => {
      window.__mockChatFail = true;
      window.state.vampire = {
        host: ${JSON.stringify(host)}, started: true, phase: 'day', round: 3,
        players: [
          { id: ${JSON.stringify(host)}, name: 'Kurucu', alive: true },
          { id: 'vvbot-ikna', name: 'Sorgucu', alive: true, isBot: true, operatorId: ${JSON.stringify(host)}, model: 'gemma3:1b', language: 'tr' },
          { id: 'iknaci', name: 'İknacı', alive: true },
          { id: 'supheli', name: 'Ali', alive: true }
        ],
        roles: { ${JSON.stringify(host)}: 'villager', 'vvbot-ikna': 'villager', iknaci: 'villager', supheli: 'vampire' },
        localRole: 'villager', settings: {}, actions: {}, used: {}, doctorHistory: {},
        pendingHunterId: null, privateNote: '', log: [], chat: []
      };
      window.vampireVillagerHandler({ type: 'vv-chat', id: 'ikna-1', senderId: 'iknaci', text: 'Ali çok şüpheli, sözleri çelişti; bence Ali vampir, ona oy verelim.', sentAt: Date.now() }, 'iknaci');
      window.state.vampire.phase = 'vote';
      window.state.vampire.actions = { votes: {} };
      window.vampireVillagerHandler({ type: 'vv-role', role: 'villager' }, window.state.myId);
      return 1;
    })()`);
    await waitFor(peer.client, `window.state.vampire.actions?.votes?.['vvbot-ikna'] ? 'yes' : null`, 8000, 'ikna edilen bot kendi oyunu kullanmalı');
    game = await state(peer);
    assert.strictEqual(game.actions.votes['vvbot-ikna'], 'supheli', 'Bot sohbet iddiasını değerlendirip kendi oyuna yansıtmadı: ' + JSON.stringify(game.actions));

    // --- Kanıtsız suçlama: "bence Bot1 vampir" gibi boş bir iddia hedefi
    // otomatik suçlu yapmamalı; diğer botlar kanıt istemeli ve suçlayana şüphe duymalı. ---
    await setupLobbyRecord(peer, host, [
      { id: host, name: 'Kurucu' },
      { id: 'suclayan', name: 'Suclayan' },
      { id: 'vvbot-hedef', name: 'Bot 2', isBot: true },
      { id: 'vvbot-gozlem', name: 'Bot 3', isBot: true }
    ]);
    await evalJS(peer.client, `(() => {
      window.__mockChatFail = true;
      window.state.vampire = {
        host: ${JSON.stringify(host)}, started: true, phase: 'day', round: 4,
        players: [
          { id: ${JSON.stringify(host)}, name: 'Kurucu', alive: true },
          { id: 'suclayan', name: 'Suclayan', alive: true },
          { id: 'vvbot-hedef', name: 'Bot 2', alive: true, isBot: true, operatorId: ${JSON.stringify(host)}, model: 'gemma3:1b', language: 'tr' },
          { id: 'vvbot-gozlem', name: 'Bot 3', alive: true, isBot: true, operatorId: ${JSON.stringify(host)}, model: 'gemma3:1b', language: 'tr' }
        ],
        roles: { ${JSON.stringify(host)}: 'vampire', suclayan: 'villager', 'vvbot-hedef': 'villager', 'vvbot-gozlem': 'villager' },
        localRole: 'vampire', settings: {}, actions: {}, used: {}, doctorHistory: {},
        pendingHunterId: null, privateNote: '', log: [], chat: []
      };
      window.vampireVillagerHandler({ type: 'vv-chat', id: 'bos-suclama-1', senderId: 'suclayan', text: 'bence katil bot2', sentAt: Date.now() }, 'suclayan');
      return 1;
    })()`);
    await waitFor(peer.client, `(window.state.vampire.chat || []).some(m => m.senderId === 'vvbot-hedef' && /Somut kanıtın ne/i.test(m.text)) && (window.state.vampire.chat || []).some(m => m.senderId === 'vvbot-gozlem' && /somut|kanıt değil/i.test(m.text)) ? 'yes' : null`, 10000, 'bot2 ve diğer bot kanıtsız suçlamaya cevap vermeli');
    await evalJS(peer.client, `(() => {
      window.state.vampire.phase = 'vote';
      window.state.vampire.actions = { votes: {} };
      window.vampireVillagerHandler({ type: 'vv-role', role: 'vampire' }, window.state.myId);
      return 1;
    })()`);
    await waitFor(peer.client, `window.state.vampire.actions?.votes?.['vvbot-hedef'] && window.state.vampire.actions?.votes?.['vvbot-gozlem'] ? 'yes' : null`, 9000, 'botlar kanıtsız suçlama sonrası kendi oylarını kullanmalı');
    game = await state(peer);
    assert.strictEqual(game.actions.votes['vvbot-hedef'], 'suclayan', 'Suçlanan bot kanıtsız suçlayana şüphe yöneltmedi: ' + JSON.stringify(game.actions));
    assert.strictEqual(game.actions.votes['vvbot-gozlem'], 'suclayan', 'Diğer bot kanıtsız suçlayana şüphe yöneltmedi: ' + JSON.stringify(game.actions));

    // --- Sohbet: adı geçince/soru sorulunca bot cevap vermeli ---
    await evalJS(peer.client, `window.__mockChatFail = false; window.__mockChatResponse = (body) => { window.__lastBody = body; return { dusunce: 'Bana soruyorlar.', targetId: null, chat: 'Ben dün gece evimdeydim, kimseye dokunmadım.' }; }; 1`);
    await setupLobbyRecord(peer, host, [
      { id: host, name: 'Kurucu' },
      { id: 'vvbot-cevap', name: 'Cevapci', isBot: true },
      { id: 'koylu1', name: 'koylu1' }
    ]);
    await evalJS(peer.client, `(() => {
      window.state.vampire = {
        host: ${JSON.stringify(host)}, started: true, phase: 'day', round: 2,
        players: [
          { id: ${JSON.stringify(host)}, name: 'Kurucu', alive: true },
          { id: 'vvbot-cevap', name: 'Cevapci', alive: true, isBot: true, operatorId: ${JSON.stringify(host)}, model: 'gemma3:1b', persona: '' },
          { id: 'koylu1', name: 'koylu1', alive: true }
        ],
        roles: { ${JSON.stringify(host)}: 'villager', 'vvbot-cevap': 'villager', koylu1: 'villager' },
        localRole: 'villager', settings: {}, actions: {}, used: {},
        pendingHunterId: null, privateNote: '', log: [],
        chat: [{ id: 'soru1', senderId: 'koylu1', name: 'koylu1', text: 'Cevapci sen dün gece neredeydin?', sentAt: Date.now() }]
      };
      window.vampireVillagerHandler({ type: 'vv-role', role: 'villager' }, window.state.myId);
      return 1;
    })()`);
    await waitFor(peer.client, `(window.state.vampire.chat || []).some(m => m.senderId === 'vvbot-cevap') ? 'yes' : null`, 9000, 'bot kendisine sorulan soruya cevap vermeli');
    const replyPrompt = await evalJS(peer.client, `(() => {
      const user = (window.__lastBody.messages || []).find(m => m.role === 'user')?.content || '';
      return { quotesQuestion: user.includes('Cevapci sen dün gece neredeydin?'), tellsToAnswer: user.includes('Ona kısaca cevap ver') };
    })()`);
    assert.deepStrictEqual(replyPrompt, { quotesQuestion: true, tellsToAnswer: true }, JSON.stringify(replyPrompt));

    // Ollama kapalı olsa bile bot tamamen susmamalı; seçili dilde yerleşik,
    // kısa bir oyuncu cevabı üretmeli.
    await evalJS(peer.client, `(() => {
      window.__mockChatFail = true;
      window.vampireVillagerHandler({ type: 'vv-chat', id: 'soru2', senderId: 'koylu1', text: 'Bence Cevapci vampir, ondan şüpheleniyorum.', sentAt: Date.now() }, 'koylu1');
      return 1;
    })()`);
    await waitFor(peer.client, `(window.state.vampire.chat || []).filter(m => m.senderId === 'vvbot-cevap').length >= 2 ? 'yes' : null`, 9000, 'ollama yokken bot yedek sohbeti');
    const fallbackReply = await evalJS(peer.client, `(window.state.vampire.chat || []).filter(m => m.senderId === 'vvbot-cevap').at(-1)?.text || ''`);
    assert.match(fallbackReply, /Somut kanıtın ne/, 'Bot suçlanınca kendini savunup kanıt istemedi: ' + fallbackReply);

    // --- İnsan ve bot hedefleri + doktor kurtarışı + ödül/ceza:
    // Vampir bot başka bir botu hedefleyebilmeli, doktor bot da aynı botu seçip
    // ölümü engelleyebilmeli. Sonuç herkese duyurulurken pekiştirme özel hafızada kalmalı. ---
    await evalJS(peer.client, `window.__rewardBodies = []; window.__mockChatFail = false; window.__mockChatResponse = (body) => {
      window.__rewardBodies.push(body);
      return { dusunce: 'Bu hedefi seçiyorum.', targetId: 'vvbot-kurban', chat: null, supheler: [] };
    }; 1`);
    await installNightScenario(peer, host, {
      [host]: 'villager',
      'vvbot-vampir': 'vampire',
      'vvbot-doktor': 'doctor',
      'vvbot-kurban': 'villager',
      insan: 'villager'
    }, {
      'vvbot-vampir': { isBot: true, operatorId: host, model: 'gemma3:1b', language: 'tr' },
      'vvbot-doktor': { isBot: true, operatorId: host, model: 'gemma3:1b', language: 'tr' },
      'vvbot-kurban': { isBot: true, operatorId: host, model: 'gemma3:1b', language: 'tr' }
    });
    await waitFor(peer.client, `window.state.vampire.actions?.vampire?.['vvbot-vampir'] === 'vvbot-kurban' && window.state.vampire.actions?.doctor?.targetId === 'vvbot-kurban' ? 'yes' : null`, 9000, 'vampir ve doktor bot hedefleri');
    const mixedTargets = await evalJS(peer.client, `(() => {
      const users = (window.__rewardBodies || []).map(body => (body.messages || []).find(m => m.role === 'user')?.content || '');
      return {
        offersHuman: users.some(text => text.includes(${JSON.stringify(host + ' = ' + host)})),
        offersBot: users.some(text => text.includes('vvbot-kurban = vvbot-kurban')),
        hasRewardContext: users.every(text => text.includes('Ödül/ceza durumun'))
      };
    })()`);
    assert.deepStrictEqual(mixedTargets, { offersHuman: true, offersBot: true, hasRewardContext: true }, 'Bot hedef listesi insan ve botları birlikte sunmadı: ' + JSON.stringify(mixedTargets));
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.strictEqual(game.players.find(player => player.id === 'vvbot-kurban').alive, true, 'Doktorun seçtiği bot hedef ölmemeliydi');
    assert.ok(game.log.some(line => line.includes('Doktor bir kişinin ölümünü engelledi') && line.includes('kimse ölmedi')), 'Doktor kurtarışı herkese duyurulmadı: ' + JSON.stringify(game.log));
    const protectedRewards = await evalJS(peer.client, `(() => {
      const memoryOf = id => {
        const pill = document.querySelector('[data-bot-pill="' + id + '"]');
        if (!document.querySelector('.vv-bot-inline[data-bot="' + id + '"]')) pill?.click();
        return document.querySelector('.vv-bot-inline[data-bot="' + id + '"] .vv-bot-memory')?.textContent || '';
      };
      const vampire = memoryOf('vvbot-vampir');
      const doctor = memoryOf('vvbot-doktor');
      return { vampire, doctor };
    })()`);
    assert.match(protectedRewards.vampire, /Ceza -10.*doktor tarafından kurtarıldı/i, 'Başarısız vampir saldırısı cezalandırılmadı: ' + protectedRewards.vampire);
    assert.match(protectedRewards.doctor, /Ödül \+14.*saldırısını engelledin/i, 'Başarılı doktor koruması ödüllendirilmedi: ' + protectedRewards.doctor);

    // Vampir bot gerçek oyuncuyu da öldürebilmeli; gece bitiş duyurusu isimle görünmeli.
    await evalJS(peer.client, `window.__mockChatResponse = { dusunce: 'İnsan hedefi seçiyorum.', targetId: 'insan-hedef', chat: null, supheler: [] }; 1`);
    await installNightScenario(peer, host, {
      [host]: 'villager',
      'vvbot-vampir2': 'vampire',
      'insan-hedef': 'villager',
      'vvbot-tanik': 'villager'
    }, {
      'vvbot-vampir2': { isBot: true, operatorId: host, model: 'gemma3:1b', language: 'tr' },
      'vvbot-tanik': { isBot: true, operatorId: host, model: 'gemma3:1b', language: 'tr' }
    });
    await waitFor(peer.client, `window.state.vampire.actions?.vampire?.['vvbot-vampir2'] === 'insan-hedef' ? 'yes' : null`, 9000, 'vampir bot gerçek oyuncu hedefi');
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.strictEqual(game.players.find(player => player.id === 'insan-hedef').alive, false, 'Vampir bot gerçek oyuncuyu öldüremedi');
    assert.ok(game.log.some(line => line.includes('insan-hedef') && line.includes('gece sona erdiğinde') && line.includes('öldü')), 'Gece ölümü isimle duyurulmadı: ' + JSON.stringify(game.log));

    if (require.main === module) console.log('bot scenarios verified');
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports().then(() => console.log('PASS vampire-villager-bots')).catch(error => { console.error(error); process.exitCode = 1; });
}
