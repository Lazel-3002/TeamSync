const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS } = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9410, name: 'I18N Coverage Test' });
  try {
    const result = await evalJS(peer.client, `(() => {
      applyUserLanguage('en');
      const read = selector => document.querySelector(selector)?.textContent.trim() || '';
      const visibleText = selector => {
        const copy = document.querySelector(selector).cloneNode(true);
        copy.querySelectorAll('script, style').forEach(node => node.remove());
        return copy.innerText;
      };
      const activityText = [...document.querySelectorAll('#activities-modal .activity-name, #activities-modal .activity-copy p')]
        .map(node => node.textContent.trim()).join(' | ');
      return {
        language: document.documentElement.lang,
        languageOptions: [...document.querySelectorAll('input[name="settings-language"]')].map(input => input.value),
        subtitle: read('[data-i18n="app.subtitle"]'),
        incomingTitle: read('[data-i18n="invites.title"]'),
        incomingLead: read('[data-i18n="invites.lead"]'),
        serverDmHint: read('#server-dm-messages .muted'),
        activityText,
        lobbyText: visibleText('#act-lobby-card'),
        pollText: visibleText('#poll-card'),
        wheelText: visibleText('#wheel-card'),
        pokeText: visibleText('#poke-card'),
      };
    })()`);

    assert.strictEqual(result.language, 'en', JSON.stringify(result, null, 2));
    assert.deepStrictEqual(result.languageOptions, ['tr', 'en', 'de', 'es', 'fr', 'pt', 'ru'], JSON.stringify(result, null, 2));
    assert.strictEqual(result.subtitle, 'P2P • Serverless • Finds people automatically on the same Wi-Fi and can connect over the internet', JSON.stringify(result, null, 2));
    assert.strictEqual(result.incomingTitle, 'Incoming Friend Requests', JSON.stringify(result, null, 2));
    assert.strictEqual(result.incomingLead, 'Friend requests you receive appear here.', JSON.stringify(result, null, 2));
    assert.strictEqual(result.serverDmHint, 'Select a friend to start messaging.', JSON.stringify(result, null, 2));

    const keySurfaces = [result.activityText, result.lobbyText, result.pollText, result.wheelText, result.pokeText].join('\n');
    assert.ok(!/[çğıöşüÇĞİÖŞÜ]/.test(keySurfaces), `Turkish text leaked into English activity UI:\n${keySurfaces}`);

    const localeChecks = await evalJS(peer.client, `(() => ['de', 'es', 'fr', 'pt', 'ru'].map(language => {
      applyUserLanguage(language);
      return {
        language,
        documentLanguage: document.documentElement.lang,
        heading: document.querySelector('[data-settings-content="language"] h2').textContent,
        subtitle: document.querySelector('[data-i18n="app.subtitle"]').textContent,
        activityText: [...document.querySelectorAll('#activities-modal .activity-name, #activities-modal .activity-copy p')]
          .map(node => node.textContent).join(' ')
      };
    }))()`);
    localeChecks.forEach(check => {
      assert.strictEqual(check.documentLanguage, check.language, JSON.stringify(check, null, 2));
      assert.ok(check.heading.length > 0 && check.subtitle.length > 0, JSON.stringify(check, null, 2));
      assert.ok(!/[çğıöşüÇĞİÖŞÜ]/.test(`${check.subtitle} ${check.activityText}`), `Turkish text leaked into ${check.language}: ${JSON.stringify(check)}`);
    });
  } finally {
    await cleanupPeer(peer);
  }
};
