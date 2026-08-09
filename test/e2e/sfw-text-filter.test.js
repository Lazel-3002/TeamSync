const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS } = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9414, name: 'SFW Text Filter Test' });
  try {
    const result = await evalJS(peer.client, `(() => {
      state.sfwMode = true;
      const samples = {
        spaced: checkTextWithAI('döl lü yumurta'),
        joined: checkTextWithAI('döllü-yumurta'),
        typo: checkTextWithAI('siktirr'),
        embedded: checkTextWithAI('pezevenkli'),
        abbreviation: checkTextWithAI('sir'),
        punctuated: checkTextWithAI('o.ç. (mesaj)'),
        commaSeparated: checkTextWithAI('o,ç, mesaj'),
        parenSeparated: checkTextWithAI('o(ç) mesaj'),
        clean: checkTextWithAI('merhaba arkadaşlar'),
        ordinaryTurkish: checkTextWithAI('bugün biraz sıkıntı var'),
        partial: censorProfaneText('döllü yumurtalı omlet'),
        punctuationPartial: censorProfaneText('selam o.ç. kardeşim'),
        moderation: (() => {
          state.isRoomFounder = true;
          state.sfwMode = true;
          state.sfwChatBanEnabled = true;
          state.sfwChatBanThreshold = 2;
          state.chatBannedIds = new Set();
          state.chatViolationCounts = new Map();
          return {
            first: registerSfwChatViolation('peer-test'),
            second: registerSfwChatViolation('peer-test'),
            banned: isChatBanned('peer-test'),
            manualBan: setChatBan('manual-peer', true, false) && isChatBanned('manual-peer'),
            manualUnban: setChatBan('manual-peer', false, false) && !isChatBanned('manual-peer')
          };
        })()
      };
      return Promise.all(Object.entries(samples).map(async ([key, value]) => [
        key,
        value && typeof value.then === 'function' ? (await value).ok : value
      ])).then(entries => Object.fromEntries(entries));
    })()`, true);

    assert.strictEqual(result.spaced, false, JSON.stringify(result));
    assert.strictEqual(result.joined, false, JSON.stringify(result));
    assert.strictEqual(result.typo, false, JSON.stringify(result));
    assert.strictEqual(result.embedded, false, JSON.stringify(result));
    assert.strictEqual(result.abbreviation, false, JSON.stringify(result));
    assert.strictEqual(result.punctuated, false, JSON.stringify(result));
    assert.strictEqual(result.commaSeparated, false, JSON.stringify(result));
    assert.strictEqual(result.parenSeparated, false, JSON.stringify(result));
    assert.strictEqual(result.clean, true, JSON.stringify(result));
    assert.strictEqual(result.ordinaryTurkish, true, JSON.stringify(result));
    assert.strictEqual(result.partial, '███lü yumurtalı omlet', JSON.stringify(result));
    assert.strictEqual(result.punctuationPartial, 'selam ████ kardeşim', JSON.stringify(result));
    assert.deepStrictEqual(result.moderation, {
      first: false, second: true, banned: true, manualBan: true, manualUnban: true
    }, JSON.stringify(result));
  } finally {
    cleanupPeer(peer);
  }
};
