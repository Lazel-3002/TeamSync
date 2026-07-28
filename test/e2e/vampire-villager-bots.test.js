const assert = require('assert');
const { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor } = require('./lib/harness');

// Ollama gerçekten çalışmıyor olsa bile bu testler botların davranışını
// doğrulayabilsin diye window.fetch sahte bir Ollama sunucusuyla değiştirilir.
async function installMockOllama(peer) {
  await evalJS(peer.client, `(() => {
    window.Math.random = () => 0; // sohbet/fallback rastgeleliğini deterministik yap
    window.__mockOllamaUp = true;
    window.__mockModels = ['gemma3:e2b', 'llama3:8b'];
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
      botseer: { isBot: true, operatorId: host, model: 'gemma3:e2b' }
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
          { id: 'botvoter', name: 'Bot Oycu', alive: true, isBot: true, operatorId: ${JSON.stringify(host)}, model: 'gemma3:e2b' },
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

    if (require.main === module) console.log('bot scenarios verified');
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports().then(() => console.log('PASS vampire-villager-bots')).catch(error => { console.error(error); process.exitCode = 1; });
}
