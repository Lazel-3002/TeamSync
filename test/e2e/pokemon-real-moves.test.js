const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
  waitFor,
} = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9372, name: 'Gerçek Saldırı Testi' });
  try {
    await createRoom(peer);
    await evalJS(
      peer.client,
      `(() => {
         document.getElementById('act-poke').click();
         const testCard = document.getElementById('poke-card');
         testCard.classList.remove('hidden');
         Object.assign(testCard.style, {
           position: 'fixed',
           inset: '0',
           width: '100vw',
           height: '100vh',
           zIndex: '99999',
           borderRadius: '0'
         });
         window.pokeActivityHandler({
           type: 'poke_join',
           slot: 1,
           id: state.myId,
           name: state.myName,
           avatar: state.myAvatar
         });
         window.pokeActivityHandler({
           type: 'poke_join',
           slot: 2,
           id: 'BOT',
           name: 'Taktik Ustası Bot',
           avatar: ''
         });
         window.pokeActivityHandler({ type: 'poke_start', randomMoves: false });
         window.pokeActivityHandler({
           type: 'poke_action_base_select',
           id: state.myId,
           baseName: 'machop',
           typeStr: 'fighting',
           types: ['fighting']
         });
         return 1;
       })()`
    );

    await waitFor(
      peer.client,
      `Array.from(document.querySelectorAll('#poke-evolution-selection-flex .poke-evo-card'))
        .some(card => card.querySelector('.poke-evo-name')?.textContent.trim() === 'Gigantamax Machamp')`,
      10000,
      'Gigantamax Machamp form'
    );
    await evalJS(
      peer.client,
      `Array.from(document.querySelectorAll('#poke-evolution-selection-flex .poke-evo-card'))
        .find(card => card.querySelector('.poke-evo-name')?.textContent.trim() === 'Gigantamax Machamp')
        .click(); 1`
    );
    await waitFor(
      peer.client,
      `document.querySelectorAll('#poke-move-selection-list .manual-move-card').length >= 4`,
      15000,
      'canonical Machamp moves'
    );

    const result = await evalJS(
      peer.client,
      `(() => {
         const cards = Array.from(document.querySelectorAll('#poke-move-selection-list .manual-move-card'));
         const names = cards.map(card =>
           card.querySelector('span')?.childNodes[0]?.textContent.trim()
         );
         cards.slice(0, 4).forEach(card => card.click());
         return {
           apiName: window.pokeState.p1.apiName,
           moveSourceApiName: window.POKEMON_FAMILIES
             .find(family => family.baseName === 'machop')
             .evolutions
             .find(form => form.apiName === 'machamp-gmax')
             .moveSourceApiName,
           names,
           infoIconCount: document.querySelectorAll(
             '#poke-move-selection-list .move-info-icon'
           ).length,
           requiredCount: document.getElementById('poke-move-required-count').textContent,
           confirmEnabled: !document.getElementById('poke-confirm-moves-btn').disabled
         };
       })()`
    );

    assert.strictEqual(result.apiName, 'machamp-gmax');
    assert.strictEqual(result.moveSourceApiName, 'machamp');
    assert.ok(result.names.length >= 4, 'Gigantamax Machamp has fewer than four moves');
    assert.ok(!result.names.includes('STRUGGLE'), 'Struggle fallback is still visible');
    assert.ok(
      result.names.includes('DYNAMIC PUNCH') || result.names.includes('CLOSE COMBAT'),
      `Canonical Machamp attacks are missing: ${result.names.join(', ')}`
    );
    assert.strictEqual(result.infoIconCount, result.names.length);
    assert.strictEqual(result.requiredCount, '4');
    assert.strictEqual(result.confirmEnabled, true);

    const screenshot = await peer.client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const screenshotPath = path.join(
      process.env.TEMP,
      'teamsync-gigantamax-machamp-real-moves.png'
    );
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
    console.log(JSON.stringify({
      apiName: result.apiName,
      moveSourceApiName: result.moveSourceApiName,
      moveCount: result.names.length,
      sampleMoves: result.names.slice(0, 15),
      infoIconCount: result.infoIconCount,
      requiredCount: result.requiredCount,
      confirmEnabled: result.confirmEnabled,
      screenshotPath,
    }, null, 2));
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
