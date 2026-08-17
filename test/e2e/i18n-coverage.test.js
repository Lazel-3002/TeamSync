const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS } = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9410, name: 'I18N Coverage Test' });
  try {
    const initialLanguage = await evalJS(peer.client, `(() => {
      localStorage.removeItem('teamsync_language');
      return getUserLanguage();
    })()`);
    assert.strictEqual(initialLanguage, 'en');

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
        localVideoText: visibleText('#lvs-card'),
        inviteText: visibleText('#server-invites-modal'),
        dynamicText: (() => {
          const sample = document.createElement('div');
          sample.textContent = '🌐 Senin IP: 192.0.2.1 · 1 / 4 koltuk dolu';
          document.body.append(sample);
          translateLegacyStaticUI('en', sample);
          const text = sample.textContent;
          sample.remove();
          return text;
        })(),
        wordBoundaryText: translateLegacyValue('1 oyuncu · 0 oy', LEGACY_TEXT_EN),
        activityBadge: translateLegacyValue('POPÜLER', LEGACY_TEXT_EN),
        wheelStatus: translateLegacyValue('Sonuç: Deniz', LEGACY_TEXT_EN),
        leaveTitle: translateLegacyValue('Odadan Ayrıl', LEGACY_TEXT_EN),
        dynamicPlaceholder: (() => {
          const input = document.createElement('input');
          input.placeholder = '1. zorunlu seçenek';
          translateLegacyStaticUI('en', input);
          return input.placeholder;
        })(),
      };
    })()`);

    assert.strictEqual(result.language, 'en', JSON.stringify(result, null, 2));
    assert.deepStrictEqual(result.languageOptions, ['tr', 'en', 'de', 'es', 'fr', 'pt-BR', 'ru', 'ar', 'kk', 'tk', 'mn', 'zh-CN', 'ja'], JSON.stringify(result, null, 2));
    assert.strictEqual(result.subtitle, 'P2P • Serverless • Finds people automatically on the same Wi-Fi and can connect over the internet', JSON.stringify(result, null, 2));
    assert.strictEqual(result.incomingTitle, 'Incoming Friend Requests', JSON.stringify(result, null, 2));
    assert.strictEqual(result.incomingLead, 'Friend requests you receive appear here.', JSON.stringify(result, null, 2));
    assert.strictEqual(result.serverDmHint, 'Select a friend to start messaging.', JSON.stringify(result, null, 2));

    const availableCatalogs = await evalJS(peer.client, `SUPPORTED_LANGUAGES.map(language => ({ language, complete: hasCompleteLocaleCatalog(language) }))`);
    assert.ok(availableCatalogs.length === 13 && availableCatalogs.every(catalog => catalog.complete), JSON.stringify(availableCatalogs, null, 2));

    assert.match(result.inviteText, /Invite Your Friends/, JSON.stringify(result, null, 2));
    assert.strictEqual(result.dynamicText, '🌐 Your IP: 192.0.2.1 · 1 / 4 seats filled', JSON.stringify(result, null, 2));
    assert.strictEqual(result.wordBoundaryText, '1 player · 0 votes', JSON.stringify(result, null, 2));
    assert.strictEqual(result.activityBadge, 'POPULAR', JSON.stringify(result, null, 2));
    assert.strictEqual(result.wheelStatus, 'Result: Deniz', JSON.stringify(result, null, 2));
    assert.strictEqual(result.leaveTitle, 'Leave Room', JSON.stringify(result, null, 2));
    assert.strictEqual(result.dynamicPlaceholder, '1st required option', JSON.stringify(result, null, 2));
    assert.match(result.localVideoText, /Choose File/, JSON.stringify(result, null, 2));
    assert.match(result.localVideoText, /No file selected/, JSON.stringify(result, null, 2));
    assert.match(result.localVideoText, /Open Selected Video/, JSON.stringify(result, null, 2));
    assert.match(result.localVideoText, /Only play\/pause\/time is synchronized/, JSON.stringify(result, null, 2));
    assert.match(result.localVideoText, /Please choose the same video file/, JSON.stringify(result, null, 2));

    assert.ok(!/[çğıöşüÇĞİÖŞÜ]/.test(keySurfaces), `Turkish text leaked into English activity UI:\n${keySurfaces}`);

    const unsupportedLocale = await evalJS(peer.client, `(() => {
      applyUserLanguage('not-a-supported-locale');
      return {
        language: localStorage.getItem('teamsync_language'),
        documentLanguage: document.documentElement.lang,
        languageOptions: [...document.querySelectorAll('input[name="settings-language"]')].map(input => input.value)
      };
    })()`);
    assert.strictEqual(unsupportedLocale.language, 'en', JSON.stringify(unsupportedLocale, null, 2));
    assert.strictEqual(unsupportedLocale.documentLanguage, 'en', JSON.stringify(unsupportedLocale, null, 2));
    assert.deepStrictEqual(unsupportedLocale.languageOptions, ['tr', 'en', 'de', 'es', 'fr', 'pt-BR', 'ru', 'ar', 'kk', 'tk', 'mn', 'zh-CN', 'ja'], JSON.stringify(unsupportedLocale, null, 2));
  } finally {
    await cleanupPeer(peer);
  }
};
