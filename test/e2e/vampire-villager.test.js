const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnPeer, cleanupPeer, createRoom, evalJS } = require('./lib/harness');

async function installScenario(peer, roleMap, phase = 'night', deadIds = []) {
  const players = Object.keys(roleMap).map((id) => ({ id, name: id, alive: !deadIds.includes(id) }));
  await evalJS(peer.client, `(() => {
    const roles = ${JSON.stringify(roleMap)};
    const players = ${JSON.stringify(players)};
    window.state.vampire = {
      host: window.state.myId, started: true, phase: ${JSON.stringify(phase)}, round: 1,
      players, roles, localRole: roles[window.state.myId], settings: {}, actions: {}, used: {},
      pendingHunterId: null, privateNote: '', log: []
    };
    window.vampireVillagerHandler({ type: 'vv-role', role: roles[window.state.myId] }, window.state.myId);
    return window.state.myId;
  })()`);
}

async function state(peer) {
  return evalJS(peer.client, `JSON.parse(JSON.stringify(window.state.vampire))`);
}

async function botAction(peer, actor, action, targetId) {
  await evalJS(peer.client, `window.vampireVillagerHandler({ type: 'vv-action', action: ${JSON.stringify(action)}, targetId: ${JSON.stringify(targetId)} }, ${JSON.stringify(actor)}); 1`);
}

async function botVote(peer, actor, targetId) {
  await evalJS(peer.client, `window.vampireVillagerHandler({ type: 'vv-vote', targetId: ${JSON.stringify(targetId)} }, ${JSON.stringify(actor)}); 1`);
}

async function screenshot(peer) {
  const result = await peer.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const output = path.join(process.env.TEMP, 'teamsync-vampire-lobby.png');
  fs.writeFileSync(output, Buffer.from(result.result.data, 'base64'));
  return output;
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9406, name: 'Vampir Bot Testi' });
  try {
    await createRoom(peer);
    const host = await evalJS(peer.client, 'window.state.myId');

    // Lobi ayarları: geniş bir odada roller kart olarak üç sütuna yerleşmeli.
    await peer.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    await evalJS(peer.client, `(() => {
      const players = Array.from({ length: 14 }, (_, index) => ({ id: index === 0 ? window.state.myId : 'bot-' + index, name: index === 0 ? 'Kurucu' : 'Bot ' + index, alive: true }));
      window.state.vampire = { host: window.state.myId, started: false, phase: 'lobby', round: 0, players, roles: {}, localRole: null,
        settings: { vampireCount: 'auto', preset: 'balanced', phaseSeconds: 0, seer: true, oracle: false, fool: false, doctor: true, healer: false, hunter: true, warrior: false, spy: false, executioner: false }, actions: {}, used: {}, executionTargets: {}, winnerId: null, pendingHunterId: null, phaseEndsAt: 0, privateNote: '', log: [] };
      openCardFocused('vampire-card');
      window.vampireVillagerHandler({ type: 'vv-role', role: null }, window.state.myId);
      return 1;
    })()`);
    const lobbyLayout = await evalJS(peer.client, `(() => {
      const panel = document.querySelector('.vv-lobby-settings');
      const grid = document.querySelector('.vv-role-grid');
      const rect = panel.getBoundingClientRect();
      return { roleCount: document.querySelectorAll('.vv-role-toggle').length, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, width: rect.width, right: rect.right, viewport: document.documentElement.clientWidth };
    })()`);
    assert.strictEqual(lobbyLayout.roleCount, 9, JSON.stringify(lobbyLayout));
    assert.strictEqual(lobbyLayout.columns, 3, JSON.stringify(lobbyLayout));
    assert.ok(lobbyLayout.width >= 600 && lobbyLayout.right <= lobbyLayout.viewport, JSON.stringify(lobbyLayout));
    const lobbyScreenshot = await screenshot(peer);

    // Doktor koruması: vampir saldırısı hedefi elememeli.
    await installScenario(peer, { [host]: 'doctor', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' });
    await botAction(peer, 'vampir', 'vampire', host);
    await botAction(peer, host, 'doctor', host);
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    let game = await state(peer);
    assert.strictEqual(game.players.find(p => p.id === host).alive, true, 'Doktor koruması saldırıyı engellemedi');
    assert.strictEqual(game.phase, 'day', 'Korunan geceden sonra gündüz başlamadı');

    // Büyücü ve Casus gizli sonucu yalnızca rol sahibine almalı.
    await installScenario(peer, { [host]: 'seer', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' });
    await botAction(peer, host, 'seer', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.match(game.privateNote, /Vampir/, 'Büyücü vampir rolünü öğrenemedi');

    await installScenario(peer, { [host]: 'oracle', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' });
    await botAction(peer, host, 'oracle', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.match(game.privateNote, /vampir tarafında/, 'Kâhin taraf bilgisini alamadı');

    await installScenario(peer, { [host]: 'fool', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' });
    await botAction(peer, host, 'fool', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.match(game.privateNote, /köy tarafında/, 'Deli Köylü ters taraf bilgisini alamadı');

    await installScenario(peer, { [host]: 'spy', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' });
    await botAction(peer, host, 'spy', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.match(game.privateNote, /vampir tarafında/, 'Casus taraf bilgisini alamadı');

    // Şifacı, daha önce elenmiş oyuncuyu bir kez canlandırmalı.
    await installScenario(peer, { [host]: 'healer', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' }, 'night', ['koylu1']);
    await botAction(peer, host, 'healer', 'koylu1');
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.strictEqual(game.players.find(p => p.id === 'koylu1').alive, true, 'Şifacı elenmiş oyuncuyu canlandıramadı');
    assert.strictEqual(game.used.healer, true, 'Şifacı tek kullanımlık hakkı tüketilmedi');

    // Savaşçı vampiri gece elediğinde köy kazanmalı.
    await installScenario(peer, { [host]: 'warrior', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' });
    await botAction(peer, host, 'warrior', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.strictEqual(game.players.find(p => p.id === 'vampir').alive, false, 'Savaşçı vampiri eleyemedi');
    assert.strictEqual(game.phase, 'over', 'Son vampir elenince oyun bitmedi');

    // Avcı elendiğinde son atışıyla vampiri indirebilmeli.
    await installScenario(peer, { [host]: 'hunter', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' });
    await botAction(peer, 'vampir', 'vampire', host);
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.strictEqual(game.phase, 'hunter-shot', 'Avcı elenince son atış fazı açılmadı');
    await botAction(peer, host, 'hunter', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-hunter-end').click(); 1`);
    game = await state(peer);
    assert.strictEqual(game.players.find(p => p.id === 'vampir').alive, false, 'Avcının son atışı vampiri elemedi');

    // Bot oyları çoğunlukla vampiri sürmeli.
    await installScenario(peer, { [host]: 'villager', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' }, 'vote');
    await botVote(peer, host, 'vampir');
    await botVote(peer, 'koylu1', 'vampir');
    await botVote(peer, 'koylu2', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-vote-end').click(); 1`);
    game = await state(peer);
    assert.strictEqual(game.players.find(p => p.id === 'vampir').alive, false, 'Bot çoğunluk oyu vampiri sürmedi');
    assert.strictEqual(game.phase, 'over', 'Oy sonrası kazanma koşulu çalışmadı');

    // Cellat, gizli hedefi gündüz oylamasıyla sürülünce tek başına kazanmalı.
    await installScenario(peer, { [host]: 'executioner', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' }, 'vote');
    await evalJS(peer.client, `window.state.vampire.executionTargets = { [window.state.myId]: 'vampir' }; 1`);
    await botVote(peer, host, 'vampir');
    await botVote(peer, 'koylu1', 'vampir');
    await botVote(peer, 'koylu2', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-vote-end').click(); 1`);
    game = await state(peer);
    assert.strictEqual(game.winnerId, host, 'Cellat doğru hedef sürülünce tek başına kazanmadı');
    assert.strictEqual(game.phase, 'over', 'Cellat kazanınca oyun bitmedi');
    if (require.main === module) console.log(lobbyScreenshot);
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports().then(() => console.log('PASS vampire-villager')).catch(error => { console.error(error); process.exitCode = 1; });
}
