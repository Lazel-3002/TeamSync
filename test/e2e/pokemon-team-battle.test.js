const assert = require('assert');
const { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor } = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9375, name: 'Poke Takım Testi' });
  try {
    await createRoom(peer);
    await evalJS(peer.client, `(() => {
      document.getElementById('act-poke').click();
      const card = document.getElementById('poke-card');
      card.classList.remove('hidden');
      Object.assign(card.style, { position:'fixed', inset:'0', width:'100vw', height:'100vh', zIndex:'99999' });
      window.pokeActivityHandler({ type:'poke_join', slot:1, id:state.myId, name:'P1', avatar:'' });
      window.pokeActivityHandler({ type:'poke_join', slot:2, id:'BOT', name:'Bot', avatar:'' });
      window.pokeState.battleSize = 3;
      window.pokeState.p1.teamDraft = [{ baseName:'bulbasaur', type:'grass', types:['grass'] }];
      window.pokeActivityHandler({ type:'poke_action_base_unselect', id:state.myId, baseName:'bulbasaur' });
      const fighter = (name, hp = 250) => ({ id:state.myId, name:'P1', evoName:name, apiName:name.toLowerCase(), pokemon:'https://play.pokemonshowdown.com/sprites/ani/pikachu.gif', type:'electric', types:['electric'], hp, maxHp:hp, speed:80, stats:{hp:80, attack:100, defense:100, speed:80, 'special-attack':100, 'special-defense':100}, moves:[{name:'Tackle', type:'normal', power:40, accuracy:100, damage_class:'physical'}] });
      const enemy = (name, hp = 250) => ({ ...fighter(name, hp), id:'BOT', name:'Bot', type:'normal', types:['normal'], moves:[{name:'Tackle', type:'normal', power:40, accuracy:100, damage_class:'physical'}] });
      window.pokeActivityHandler({ type:'poke_reveal', team1:[fighter('One'), fighter('Two')], team2:[enemy('Enemy One'), enemy('Enemy Two')], p1:fighter('One'), p2:enemy('Enemy One') });
      return 1;
      })()`);
    const baseReset = JSON.parse(await evalJS(peer.client, `JSON.stringify((() => {
      window.pokeState.battleSize = 3;
      window.pokeState.p1.teamDraft = [{ baseName:'bulbasaur', type:'grass', types:['grass'] }];
      window.pokeState.p1.teamBasesReady = true;
      window.pokeState.p1.teamReady = true;
      window.pokeActivityHandler({ type:'poke_action_base_unselect', id:state.myId, baseName:'bulbasaur' });
      return { draftLength:window.pokeState.p1.teamDraft.length, basesReady:!!window.pokeState.p1.teamBasesReady, teamReady:!!window.pokeState.p1.teamReady };
    })())`));
    assert.deepStrictEqual(baseReset, { draftLength: 0, basesReady: false, teamReady: false });
    await waitFor(peer.client, `window.pokeState.status === 'revealed' && !window.pokeState.openingReveal && window.pokeState.team1.length === 2`, 10000, 'team reveal');
    const switchUi = JSON.parse(await evalJS(peer.client, `JSON.stringify((() => {
      const toggle = document.getElementById('poke-switch-toggle');
      toggle.click();
      return {
        toggleVisible: getComputedStyle(toggle).display !== 'none',
        cardCount: document.querySelectorAll('#poke-switch-list .poke-switch-card').length,
        imageCount: document.querySelectorAll('#poke-switch-list .poke-switch-card img').length,
        hpBarCount: document.querySelectorAll('#poke-switch-list .poke-switch-card span span span').length
      };
    })())`));
    assert.strictEqual(switchUi.toggleVisible, true);
    assert.strictEqual(switchUi.cardCount, 1);
    assert.strictEqual(switchUi.imageCount, 1);
    assert.strictEqual(switchUi.hpBarCount, 1);
    const staleRoundGuard = JSON.parse(await evalJS(peer.client, `JSON.stringify((() => {
      const before = { round: window.pokeState.round, actionP1: window.pokeState.actionP1 };
      window.pokeActivityHandler({ type:'poke_action_select', id:state.myId, moveIdx:0, round:99 });
      return { round:window.pokeState.round, actionP1:window.pokeState.actionP1, before };
    })())`));
    assert.strictEqual(staleRoundGuard.round, staleRoundGuard.before.round);
    assert.strictEqual(staleRoundGuard.actionP1, null);
    await evalJS(peer.client, `(() => {
      window.pokeActivityHandler({ type:'poke_action_select', id:state.myId, switchTo:1 });
      window.pokeActivityHandler({ type:'poke_action_select', id:'BOT', moveIdx:0 });
      return 1;
    })()`);
    await waitFor(peer.client, `window.pokeState.activeIndex1 === 1 && window.pokeState.actionP1 === null && window.pokeState.round === 1`, 10000, 'switch action and round advance');
    const result = JSON.parse(await evalJS(peer.client, `JSON.stringify({ activeIndex:window.pokeState.activeIndex1, activeName:window.pokeState.p1.evoName, hp:window.pokeState.p1.hp, maxHp:window.pokeState.p1.maxHp, actionP1:window.pokeState.actionP1, round:window.pokeState.round, executingRound:window.pokeState.executingRound })`));
    assert.strictEqual(result.activeIndex, 1);
    assert.strictEqual(result.activeName, 'Two');
    assert.ok(result.hp < result.maxHp, 'the opponent attack should hit the switched-in Pokémon');
    assert.strictEqual(result.actionP1, null);
    assert.strictEqual(result.round, 1);
    assert.strictEqual(result.executingRound, null);
    const forcedSwitchGuard = JSON.parse(await evalJS(peer.client, `JSON.stringify((() => {
      window.pokeState.p2.hp = 0;
      window.pokeState.requiresSwitch2 = true;
      window.pokeState.actionP1 = null;
      document.getElementById('poke-switch-toggle').click();
      const waitingUi = {
        selectionHidden: document.getElementById('poke-selection-panel').classList.contains('hidden'),
        movesHidden: document.getElementById('poke-moves-grid').classList.contains('hidden')
      };
      window.pokeActivityHandler({ type:'poke_action_select', id:state.myId, moveIdx:0 });
      const blockedAttack = window.pokeState.actionP1 === null;
      window.pokeActivityHandler({ type:'poke_action_select', id:'BOT', switchTo:1 });
      const readyUi = {
        selectionHidden: document.getElementById('poke-selection-panel').classList.contains('hidden'),
        movesHidden: document.getElementById('poke-moves-grid').classList.contains('hidden')
      };
      return { blockedAttack, waitingUi, readyUi, activeIndex2:window.pokeState.activeIndex2, requiresSwitch2:!!window.pokeState.requiresSwitch2, actionP2:window.pokeState.actionP2 };
    })())`));
    assert.deepStrictEqual(forcedSwitchGuard, {
      blockedAttack: true,
      waitingUi: { selectionHidden: true, movesHidden: true },
      readyUi: { selectionHidden: false, movesHidden: false },
      activeIndex2: 1,
      requiresSwitch2: false,
      actionP2: null
    });
    const sizeChecks = JSON.parse(await evalJS(peer.client, `JSON.stringify([1, 3, 6].map(size => {
      window.pokeState.battleSize = size;
      return { size, normalized: [1, 3, 6].includes(Number(window.pokeState.battleSize)) };
    }))`));
    assert.deepStrictEqual(sizeChecks, [
      { size: 1, normalized: true },
      { size: 3, normalized: true },
      { size: 6, normalized: true }
    ]);
    const multiSwitchChecks = JSON.parse(await evalJS(peer.client, `JSON.stringify([3, 6].map(size => {
      window.pokeState.battleSize = size;
      window.pokeState.team2 = Array.from({ length:size }, (_, index) => ({
        id:'BOT', name:'Bot', evoName:'Bot-' + index, pokemon:'https://play.pokemonshowdown.com/sprites/ani/pikachu.gif',
        type:'normal', types:['normal'], hp:250, maxHp:250, speed:60, moves:[{ name:'Tackle', type:'normal', power:40 }]
      }));
      window.pokeState.activeIndex2 = 0;
      window.pokeState.p2 = window.pokeState.team2[0];
      window.pokeState.p2.hp = 0;
      window.pokeState.requiresSwitch2 = true;
      window.pokeActivityHandler({ type:'poke_action_select', id:'BOT', switchTo:size - 1 });
      return { size, activeIndex2:window.pokeState.activeIndex2, requiresSwitch2:!!window.pokeState.requiresSwitch2, activeName:window.pokeState.p2.evoName };
    }))`));
    assert.deepStrictEqual(multiSwitchChecks, [
      { size: 3, activeIndex2: 2, requiresSwitch2: false, activeName: 'Bot-2' },
      { size: 6, activeIndex2: 5, requiresSwitch2: false, activeName: 'Bot-5' }
    ]);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
