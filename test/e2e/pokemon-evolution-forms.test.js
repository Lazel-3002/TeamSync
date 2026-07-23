const fs = require('fs');
const path = require('path');
const {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
  waitFor,
} = require('./lib/harness');

async function inspectFamily(peer, baseName, expectedCount, screenshotName) {
  await evalJS(
    peer.client,
    `window.pokeActivityHandler({
      type: 'poke_action_base_select',
      id: state.myId,
      baseName: ${JSON.stringify(baseName)},
      typeStr: 'normal',
      types: ['normal']
    }); 1`
  );
  await waitFor(
    peer.client,
    `document.querySelectorAll('#poke-evolution-selection-flex .poke-evo-card').length === ${expectedCount}`,
    10000,
    `${baseName} evolution cards`
  );
  await new Promise(resolve => setTimeout(resolve, 2500));

  const details = JSON.parse(await evalJS(
    peer.client,
    `JSON.stringify(Array.from(
      document.querySelectorAll('#poke-evolution-selection-flex .poke-evo-card')
    ).map(card => ({
      name: card.querySelector('.poke-evo-name')?.textContent.trim(),
      stage: card.querySelector('.poke-evo-stage')?.textContent.trim(),
      types: Array.from(card.querySelectorAll('.poke-type-badge')).map(item => item.textContent.trim()),
      imageLoaded: Boolean(card.querySelector('img')?.naturalWidth)
    })))`
  ));

  const screenshot = await peer.client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const screenshotPath = path.join(process.env.TEMP, screenshotName);
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
  return { details, screenshotPath };
}

async function run() {
  const peer = await spawnPeer({ port: 9371, name: 'Evrim Testi' });
  try {
    await createRoom(peer);
    await evalJS(
      peer.client,
      `(() => {
         document.getElementById('act-poke').click();
         // Odak modu v2 kartı .focused + position:absolute !important ile
         // yer tutucuya sabitler; testin aşağıdaki tam-ekran hack'i çalışsın
         // diye önce odaktan çık (lazy evrim görselleri viewport'a sığmalı).
         if (typeof exitFocus === 'function') exitFocus();
         const pokeTestCard = document.getElementById('poke-card');
         pokeTestCard.classList.remove('hidden');
         Object.assign(pokeTestCard.style, {
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
         return 1;
       })()`
    );
    await waitFor(
      peer.client,
      `!document.getElementById('poke-base-selection-modal').classList.contains('hidden')`,
      10000,
      'base selection'
    );

    const rockruff = await inspectFamily(
      peer,
      'rockruff',
      5,
      'teamsync-rockruff-complete-evolutions.png'
    );
    const meltan = await inspectFamily(
      peer,
      'meltan',
      3,
      'teamsync-meltan-complete-evolutions.png'
    );

    const selectedApiName = await evalJS(
      peer.client,
      `Array.from(document.querySelectorAll('#poke-evolution-selection-flex .poke-evo-card'))
         .find(card => card.querySelector('.poke-evo-name')?.textContent.trim() === 'Melmetal')
         ?.click();
       window.pokeState.p1.apiName`
    );

    const names = list => list.map(item => item.name);
    if (names(rockruff.details).join('|') !==
        'Rockruff|Rockruff Own Tempo|Lycanroc Midday|Lycanroc Midnight|Lycanroc Dusk') {
      throw new Error(`Rockruff forms are incomplete: ${JSON.stringify(rockruff.details)}`);
    }
    if (names(meltan.details).join('|') !==
        'Meltan|Melmetal|Gigantamax Melmetal') {
      throw new Error(`Meltan evolution is incomplete: ${JSON.stringify(meltan.details)}`);
    }
    if (rockruff.details.some(item => !item.imageLoaded) ||
        meltan.details.some(item => !item.imageLoaded)) {
      throw new Error('One or more evolution images failed to load');
    }
    if (selectedApiName !== 'melmetal') {
      throw new Error(`Selected API form was not preserved: ${selectedApiName}`);
    }

    console.log(JSON.stringify({ rockruff, meltan, selectedApiName }, null, 2));
  } finally {
    cleanupPeer(peer);
  }
}

module.exports = run;

if (require.main === module) {
  run().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
