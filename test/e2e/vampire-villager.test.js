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
    const closeRestoresLayout = await evalJS(peer.client, `(() => {
      openCardFocused('vampire-card');
      document.getElementById('vampire-close').click();
      return {
        hidden: document.getElementById('vampire-card').classList.contains('hidden'),
        focusMode: document.querySelector('.main').classList.contains('focus-mode'),
        focusAreaHidden: document.getElementById('focus-area').classList.contains('hidden')
      };
    })()`);
    assert.deepStrictEqual(closeRestoresLayout, { hidden: true, focusMode: false, focusAreaHidden: true }, JSON.stringify(closeRestoresLayout));

    // Etkinlik kartı: emoji yerine oyun afişi ve özgün ikon kullanılmalı.
    const activityCover = await evalJS(peer.client, `(() => {
      const card = document.getElementById('card-act-vampire');
      const image = card?.querySelector('.activity-vampire-cover-image');
      return {
        hasCard: !!card,
        hasCover: !!image,
        source: image?.getAttribute('src') || '',
        hasCustomIcon: !!card?.querySelector('.activity-icon-vampire svg')
      };
    })()`);
    assert.deepStrictEqual(activityCover, {
      hasCard: true,
      hasCover: true,
      source: 'assets/vampire-villager-cover-v3.png',
      hasCustomIcon: true
    }, JSON.stringify(activityCover));

    // Yeni Gece Meclisi kabuğu: faz akışı, bağımsız oyun masası ve bilgi rayı
    // erişilebilir DOM yapısında hazır olmalı.
    const gameShell = await evalJS(peer.client, `(() => ({
      hasAmbient: document.querySelectorAll('#vampire-card .vv-ambient').length === 2,
      phaseSteps: document.querySelectorAll('#vampire-card [data-vv-step]').length,
      hasStage: !!document.querySelector('#vampire-card .vv-game-stage'),
      hasSideRail: !!document.querySelector('#vampire-card .vv-side-rail')
    }))()`);
    assert.deepStrictEqual(gameShell, {
      hasAmbient: true,
      phaseSteps: 3,
      hasStage: true,
      hasSideRail: true
    }, JSON.stringify(gameShell));

    // Kişisel arka plan teması: dört seçenek görünmeli, önizleme anlık çalışmalı
    // ve Kaydet ile cihazdaki tercih olarak kalmalı.
    await evalJS(peer.client, `openUserSettings('general'); 1`);
    const themeLayout = await evalJS(peer.client, `(() => ({
      optionCount: document.querySelectorAll('input[name="settings-theme"]').length,
      selected: document.querySelector('input[name="settings-theme"]:checked')?.value,
      visible: !document.getElementById('settings-modal').classList.contains('hidden')
    }))()`);
    assert.strictEqual(themeLayout.optionCount, 6, JSON.stringify(themeLayout));
    assert.strictEqual(themeLayout.selected, 'aurora', JSON.stringify(themeLayout));
    assert.strictEqual(themeLayout.visible, true, JSON.stringify(themeLayout));
    const savedTheme = await evalJS(peer.client, `(() => {
      const black = document.querySelector('input[name="settings-theme"][value="black"]');
      black.checked = true;
      black.dispatchEvent(new Event('change', { bubbles: true }));
      const preview = document.documentElement.dataset.theme;
      document.getElementById('settings-v2-save').click();
      return { preview, saved: localStorage.getItem('teamsync_theme') };
    })()`);
    assert.deepStrictEqual(savedTheme, { preview: 'black', saved: 'black' }, JSON.stringify(savedTheme));
    await evalJS(peer.client, `(() => { document.getElementById('settings-v2-close').click(); return 1; })()`);

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
      return { roleCount: document.querySelectorAll('.vv-role-toggle').length, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, width: rect.width, right: rect.right, viewport: document.documentElement.clientWidth, hasRoleSigil: !!document.querySelector('#vampire-role .vv-role-sigil'), phase: document.getElementById('vampire-card').dataset.phase };
    })()`);
    assert.strictEqual(lobbyLayout.roleCount, 9, JSON.stringify(lobbyLayout));
    assert.strictEqual(lobbyLayout.columns, 3, JSON.stringify(lobbyLayout));
    assert.ok(lobbyLayout.width >= 600 && lobbyLayout.right <= lobbyLayout.viewport, JSON.stringify(lobbyLayout));
    assert.strictEqual(lobbyLayout.hasRoleSigil, true, JSON.stringify(lobbyLayout));
    assert.strictEqual(lobbyLayout.phase, 'lobby', JSON.stringify(lobbyLayout));
    const lobbyScreenshot = await screenshot(peer);

    await peer.client.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 820, deviceScaleFactor: 1, mobile: false });
    const mobileLayout = await evalJS(peer.client, `(() => ({
      columns: getComputedStyle(document.querySelector('#vampire-card .vv-card-body')).gridTemplateColumns.split(' ').length,
      playerColumns: getComputedStyle(document.getElementById('vampire-players')).gridTemplateColumns.split(' ').length,
      overflow: document.getElementById('vampire-card').scrollWidth <= document.getElementById('vampire-card').clientWidth + 1
    }))()`);
    assert.deepStrictEqual(mobileLayout, { columns: 1, playerColumns: 2, overflow: true }, JSON.stringify(mobileLayout));

    // Kullanıcının raporladığı orta genişlik: sağ ray ekran dışına taşmamalı ve
    // özel tema rengi oyun yüzeyinin ortasından sızmamalı.
    await peer.client.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    const mediumCustomTheme = await evalJS(peer.client, `(() => {
      document.documentElement.dataset.theme = 'custom';
      document.documentElement.style.setProperty('--bg-dark', '#0b332f');
      document.documentElement.style.setProperty('--bg-panel', '#0d3d37');
      const card = document.getElementById('vampire-card');
      const body = card.querySelector('.vv-card-body');
      return {
        columns: getComputedStyle(body).gridTemplateColumns.split(' ').length,
        cardBackground: getComputedStyle(card).backgroundColor,
        overflow: card.scrollWidth <= card.clientWidth + 1
      };
    })()`);
    assert.deepStrictEqual(mediumCustomTheme, { columns: 1, cardBackground: 'rgb(11, 51, 47)', overflow: true }, JSON.stringify(mediumCustomTheme));
    await evalJS(peer.client, `document.documentElement.dataset.theme = 'aurora'; 1`);
    await peer.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });

    // Oyun başlangıcı rol perdesi ve hedef geri bildirimi: vampir av seçmeden
    // geceyi bitirememeli; seçilen kart açıkça işaretlenmeli.
    await installScenario(peer, { [host]: 'vampire', koylu1: 'villager', koylu2: 'villager', koylu3: 'villager' });
    const revealState = await evalJS(peer.client, `(() => ({
      visible: !document.getElementById('vv-role-reveal').classList.contains('hidden'),
      title: document.getElementById('vv-reveal-title').textContent,
      endDisabled: document.getElementById('vv-night-end').disabled
    }))()`);
    assert.deepStrictEqual(revealState, { visible: true, title: 'Vampir', endDisabled: true }, JSON.stringify(revealState));
    const targetSelection = await evalJS(peer.client, `(() => {
      document.getElementById('vv-reveal-close').click();
      const target = document.querySelector('.vv-target[data-action="vampire"]');
      target.click();
      return {
        selected: target.classList.contains('is-selected') || !!document.querySelector('.vv-target.is-selected'),
        pressed: document.querySelector('.vv-target.is-selected')?.getAttribute('aria-pressed'),
        label: document.querySelector('.vv-target.is-selected small')?.textContent,
        endDisabled: document.getElementById('vv-night-end').disabled
      };
    })()`);
    assert.deepStrictEqual(targetSelection, { selected: true, pressed: 'true', label: 'Seçildi', endDisabled: false }, JSON.stringify(targetSelection));

    // Doktor koruması: vampir saldırısı hedefi elememeli.
    await installScenario(peer, { [host]: 'doctor', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' });
    await botAction(peer, 'vampir', 'vampire', host);
    await botAction(peer, host, 'doctor', host);
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    let game = await state(peer);
    assert.strictEqual(game.players.find(p => p.id === host).alive, true, 'Doktor koruması saldırıyı engellemedi');
    assert.strictEqual(game.phase, 'day', 'Korunan geceden sonra gündüz başlamadı');
    assert.strictEqual(game.doctorHistory[host], host, 'Doktorun önceki koruma hedefi kaydedilmedi');
    const consecutiveProtection = await evalJS(peer.client, `(() => {
      window.state.vampire.phase = 'night';
      window.state.vampire.round = 2;
      window.state.vampire.actions = {};
      window.vampireVillagerHandler({ type: 'vv-action', action: 'doctor', targetId: window.state.myId }, window.state.myId);
      const repeatedAccepted = !!window.state.vampire.actions.doctor;
      window.vampireVillagerHandler({ type: 'vv-action', action: 'doctor', targetId: 'koylu1' }, window.state.myId);
      return { repeatedAccepted, nextTarget: window.state.vampire.actions.doctor?.targetId || null };
    })()`);
    assert.deepStrictEqual(consecutiveProtection, { repeatedAccepted: false, nextTarget: 'koylu1' }, 'Doktor aynı kişiyi iki gece üst üste koruyabildi: ' + JSON.stringify(consecutiveProtection));

    // Büyücü ve Casus gizli sonucu yalnızca rol sahibine almalı.
    await installScenario(peer, { [host]: 'seer', vampir: 'vampire', koylu1: 'villager', koylu2: 'villager' });
    await botAction(peer, host, 'seer', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-night-end').click(); 1`);
    game = await state(peer);
    assert.match(game.privateNote, /Vampir/, 'Büyücü vampir rolünü öğrenemedi');
    const seerIntelUi = await evalJS(peer.client, `document.querySelector('#vv-council .vv-private-intel')?.textContent || ''`);
    assert.match(seerIntelUi, /Büyücü sonucu: vampir rolü Vampir/, 'Büyücü sonucu gündüzde gizli bilgi panelinde görünmedi: ' + seerIntelUi);

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
    const councilUi = await evalJS(peer.client, `(() => ({ visible: !document.getElementById('vv-council').classList.contains('hidden'), mainHidden: getComputedStyle(document.querySelector('#vampire-card .vv-game-stage')).display === 'none', chatInCouncil: document.querySelector('#vv-council-chat-slot .vv-lobby-chat') !== null, voteCards: document.querySelectorAll('#vv-council .vv-vote-card').length }))()`);
    assert.deepStrictEqual(councilUi, { visible: true, mainHidden: true, chatInCouncil: true, voteCards: 3 }, 'Gündüz oylaması ayrı meclis ekranına taşınmadı: ' + JSON.stringify(councilUi));
    await botVote(peer, host, 'vampir');
    await botVote(peer, 'koylu1', 'vampir');
    await botVote(peer, 'koylu2', 'vampir');
    await evalJS(peer.client, `document.getElementById('vv-vote-end').click(); 1`);
    game = await state(peer);
    assert.strictEqual(game.players.find(p => p.id === 'vampir').alive, false, 'Bot çoğunluk oyu vampiri sürmedi');
    assert.strictEqual(game.phase, 'over', 'Oy sonrası kazanma koşulu çalışmadı');
    assert.strictEqual(game.winnerTeam, 'village', 'Kazanan köy tarafı kaydedilmedi');
    const endgameUi = await evalJS(peer.client, `(() => ({ visible: !document.getElementById('vv-endgame').classList.contains('hidden'), roles: document.querySelectorAll('#vv-endgame .vv-reveal-roster article').length, title: document.getElementById('vv-endgame-title')?.textContent || '' }))()`);
    assert.strictEqual(endgameUi.visible, true, 'Oyun sonu ekranı açılmadı');
    assert.strictEqual(endgameUi.roles, 4, 'Finalde bütün oyuncuların rolleri açıklanmadı');
    assert.match(endgameUi.title, /Köylüler/, 'Kazanan taraf final ekranında yazılmadı');

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
    // A normal participant must not be able to forge authoritative state, a
    // secret role, or preload a night action while the game is in daytime.
    const messageGuards = await evalJS(peer.client, `(() => {
      window.state.vampire = {
        host: window.state.myId, started: true, phase: 'day', round: 2,
        players: [
          { id: window.state.myId, name: 'Kurucu', alive: true },
          { id: 'attacker', name: 'SaldÄ±rgan', alive: true }
        ],
        roles: { [window.state.myId]: 'vampire', attacker: 'villager' },
        localRole: 'vampire', settings: {}, actions: {}, used: {},
        pendingHunterId: null, privateNote: '', log: [], chat: []
      };
      window.vampireVillagerHandler({ type: 'vv-state', host: 'attacker', phase: 'over', players: [] }, 'attacker');
      const forgedStateIgnored = window.state.vampire.host === window.state.myId && window.state.vampire.phase === 'day';
      window.vampireVillagerHandler({ type: 'vv-role', role: 'villager' }, 'attacker');
      const forgedRoleIgnored = window.state.vampire.localRole === 'vampire';
      window.vampireVillagerHandler({ type: 'vv-action', action: 'vampire', targetId: 'attacker' }, window.state.myId);
      return { forgedStateIgnored, forgedRoleIgnored, actionPreloadBlocked: !window.state.vampire.actions.vampire };
    })()`);
    assert.deepStrictEqual(messageGuards, {
      forgedStateIgnored: true,
      forgedRoleIgnored: true,
      actionPreloadBlocked: true
    }, JSON.stringify(messageGuards));
    if (require.main === module) console.log(lobbyScreenshot);
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports().then(() => console.log('PASS vampire-villager')).catch(error => { console.error(error); process.exitCode = 1; });
}
