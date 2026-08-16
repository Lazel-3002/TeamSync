const assert = require('assert');
const { spawnPeer, cleanupPeer, createRoom, evalJS } = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9376, name: 'Poke Bot Lobby Testi' });
  try {
    await createRoom(peer);
    const result = JSON.parse(await evalJS(peer.client, `JSON.stringify((() => {
      document.getElementById('act-poke').click();
      const card = document.getElementById('poke-card');
      card.classList.remove('hidden');
      Object.assign(card.style, { position:'fixed', inset:'0', width:'100vw', height:'100vh', zIndex:'99999' });

      window.pokeActivityHandler({ type:'poke_join', slot:1, id:state.myId, name:'Gerçek Oyuncu', avatar:'' });
      window.pokeActivityHandler({ type:'poke_join', slot:1, id:'BOT_1', name:'Bot', avatar:'', requestedBy:state.myId });
      const occupiedSlotGuard = window.pokeState.p1.id === state.myId;

      window.pokeActivityHandler({ type:'poke_join', slot:2, id:'BOT', name:'Bot 2', avatar:'', requestedBy:state.myId });
      const botAdded = window.pokeState.p2.id === 'BOT';
      const botRemoveVisible = !document.getElementById('poke-remove-bot-2').classList.contains('hidden');

      window.pokeActivityHandler({ type:'poke_leave', slot:2, id:'BOT', requestedBy:state.myId });
      const botRemoved = window.pokeState.p2 === null;

      window.pokeActivityHandler({ type:'poke_withdraw' });
      window.pokeActivityHandler({ type:'poke_join', slot:1, id:'BOT_1', name:'Bot 1', avatar:'', requestedBy:state.myId });
      window.pokeActivityHandler({ type:'poke_join', slot:2, id:'BOT', name:'Bot 2', avatar:'', requestedBy:state.myId });
      state.isLobbyHost = true;
      const fighter = (id, name) => ({ id, name, evoName:name, apiName:name.toLowerCase(), pokemon:'https://play.pokemonshowdown.com/sprites/ani/pikachu.gif', type:'normal', types:['normal'], hp:250, maxHp:250, speed:70, stats:{hp:80, attack:100, defense:100, speed:70, 'special-attack':100, 'special-defense':100}, moves:[{name:'Tackle', type:'normal', power:40, accuracy:100, damage_class:'physical'}] });
      window.pokeActivityHandler({ type:'poke_reveal', team1:[fighter('BOT_1','Bot One')], team2:[fighter('BOT','Bot Two')], p1:fighter('BOT_1','Bot One'), p2:fighter('BOT','Bot Two') });
      return {
        occupiedSlotGuard,
        botAdded,
        botRemoveVisible,
        botRemoved,
        bothBots: window.pokeState.p1.id === 'BOT_1' && window.pokeState.p2.id === 'BOT',
        joinButtonsHidden: document.getElementById('poke-join-1').classList.contains('hidden') && document.getElementById('poke-join-2').classList.contains('hidden')
      };
    })())`));

    assert.deepStrictEqual(result, {
      occupiedSlotGuard: true,
      botAdded: true,
      botRemoveVisible: true,
      botRemoved: true,
      bothBots: true,
      joinButtonsHidden: true
    });
    await require('./lib/harness').waitFor(peer.client, `window.pokeState.status === 'revealed' && window.pokeState.round === 1 && window.pokeState.executingRound === null`, 10000, 'both bot actions');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) module.exports().catch(error => { console.error(error); process.exitCode = 1; });
