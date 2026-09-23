// Sohbetteki GIF'i koleksiyona ekleme düğmesi ve mesaj pencerelerinin
// sürüklenerek yükseltilmesi.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnPeer, cleanupPeer, evalJS, waitFor } = require('./lib/harness');

// 1x1 saydam GIF (media-library testindeki ile aynı örnek).
const GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9412, name: 'Media Collect Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 860,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Bildirim ve düğme metinleri Türkçe beklendiği için dil sabitlenir.
    await evalJS(peer.client, `applyUserLanguage('tr'); 1`);

    // --- DM baloncuğundaki GIF (data: URL yolu) ---
    await evalJS(
      peer.client,
      `(() => {
        state.friends['collect-friend'] = { name: 'Koleksiyon Arkadaşı', online: true };
        state.dms['collect-friend'] = [{
          sender: 'recv',
          type: 'image',
          fileName: 'parti.gif',
          content: 'data:image/gif;base64,${GIF_BASE64}'
        }];
        openDM('collect-friend');
        return true;
      })()`
    );

    const hoverState = await waitFor(
      peer.client,
      `(() => {
        const media = document.querySelector('#dm-messages .dm-msg img');
        if (!media) return null;
        media.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1 }));
        const button = document.getElementById('media-collect-btn');
        if (!button || button.classList.contains('hidden')) return null;
        const mediaRect = media.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return {
          label: button.textContent.trim(),
          mediaName: media.dataset.mediaName,
          // Düğme görselin sol üst köşesine oturmalı (indirme düğmesi sağ üstte).
          offsetLeft: Math.round(buttonRect.left - mediaRect.left),
          offsetTop: Math.round(buttonRect.top - mediaRect.top)
        };
      })()`,
      6000,
      'koleksiyon düğmesi DM görselinde'
    );
    assert.strictEqual(hoverState.label, 'Koleksiyona ekle', JSON.stringify(hoverState, null, 2));
    assert.strictEqual(hoverState.mediaName, 'parti.gif', JSON.stringify(hoverState, null, 2));
    assert.ok(Math.abs(hoverState.offsetLeft - 8) <= 1, JSON.stringify(hoverState, null, 2));
    assert.ok(Math.abs(hoverState.offsetTop - 8) <= 1, JSON.stringify(hoverState, null, 2));

    await evalJS(peer.client, `document.getElementById('media-collect-btn').click(); 1`);
    const dmDetail = await waitFor(
      peer.client,
      `(() => {
        const modal = document.getElementById('media-detail-modal');
        if (!modal || modal.classList.contains('hidden')) return null;
        return {
          name: document.getElementById('media-detail-name').value,
          buttonHidden: document.getElementById('media-collect-btn').classList.contains('hidden')
        };
      })()`,
      6000,
      'DM GIF için adlandırma penceresi'
    );
    assert.strictEqual(dmDetail.name, 'parti.gif', JSON.stringify(dmDetail, null, 2));
    assert.strictEqual(dmDetail.buttonHidden, true, JSON.stringify(dmDetail, null, 2));

    await evalJS(peer.client, `document.getElementById('media-detail-save').click(); 1`);
    await waitFor(
      peer.client,
      `document.getElementById('media-detail-modal').classList.contains('hidden')`,
      6000,
      'adlandırma penceresi kapandı'
    );

    const savedFromDM = await evalJS(
      peer.client,
      `(async () => {
        const items = await TeamSyncMediaLibrary.getItems();
        const saved = items.find(item => item.name === 'parti.gif');
        return {
          count: items.length,
          kind: saved ? saved.kind : null,
          type: saved ? saved.type : null,
          size: saved ? saved.blob.size : 0
        };
      })()`,
      true
    );
    assert.strictEqual(savedFromDM.count, 1, JSON.stringify(savedFromDM, null, 2));
    assert.strictEqual(savedFromDM.kind, 'gif', JSON.stringify(savedFromDM, null, 2));
    assert.strictEqual(savedFromDM.type, 'image/gif', JSON.stringify(savedFromDM, null, 2));
    assert.ok(savedFromDM.size > 0, JSON.stringify(savedFromDM, null, 2));

    // Aynı GIF ikinci kez eklenmek istenirse parmak izi eşleşmeli (kopya birikmez).
    const duplicateState = await evalJS(
      peer.client,
      `(async () => {
        document.querySelectorAll('#toast-container .toast').forEach(toast => toast.remove());
        const media = document.querySelector('#dm-messages .dm-msg img');
        await TeamSyncMediaCollect.collectFrom(media);
        await new Promise(resolve => setTimeout(resolve, 400));
        return {
          count: (await TeamSyncMediaLibrary.getItems()).length,
          toastText: [...document.querySelectorAll('#toast-container .toast')].map(toast => toast.textContent).join(' | '),
          detailHidden: document.getElementById('media-detail-modal').classList.contains('hidden')
        };
      })()`,
      true
    );
    assert.strictEqual(duplicateState.count, 1, JSON.stringify(duplicateState, null, 2));
    assert.match(duplicateState.toastText, /zaten kütüphanende/, JSON.stringify(duplicateState, null, 2));
    assert.strictEqual(duplicateState.detailHidden, true, JSON.stringify(duplicateState, null, 2));

    // --- Oda sohbetindeki GIF (blob: URL yolu) ---
    // CSP connect-src blob: içermediği için blob URL geri okunamaz; kaynak
    // registerChatMedia() kaydından çözülmeli.
    const roomCollect = await evalJS(
      peer.client,
      `(async () => {
        const bytes = Uint8Array.from(atob('${GIF_BASE64}'), character => character.charCodeAt(0));
        const blob = new Blob([bytes, new Uint8Array(64)], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);
        const wrap = document.createElement('div');
        wrap.className = 'img-wrap';
        wrap.innerHTML = '<img class="chat-img" src="' + url + '" />';
        document.getElementById('msgs').appendChild(wrap);
        const media = wrap.querySelector('img');

        const beforeRegister = TeamSyncMediaCollect.isCollectable(media);
        window.registerChatMedia(url, blob, 'oda-dansi.gif');
        const afterRegister = TeamSyncMediaCollect.isCollectable(media);
        // collectFrom, adlandırma penceresi kapanana kadar çözülmez; await edilmez.
        window.__collectPromise = TeamSyncMediaCollect.collectFrom(media);
        return { beforeRegister, afterRegister };
      })()`,
      true
    );
    assert.strictEqual(roomCollect.beforeRegister, false, JSON.stringify(roomCollect, null, 2));
    assert.strictEqual(roomCollect.afterRegister, true, JSON.stringify(roomCollect, null, 2));

    const roomDetail = await waitFor(
      peer.client,
      `(() => {
        const modal = document.getElementById('media-detail-modal');
        if (!modal || modal.classList.contains('hidden')) return null;
        return { name: document.getElementById('media-detail-name').value };
      })()`,
      6000,
      'oda GIF için adlandırma penceresi'
    );
    assert.strictEqual(roomDetail.name, 'oda-dansi.gif', JSON.stringify(roomDetail, null, 2));

    await evalJS(peer.client, `document.getElementById('media-detail-save').click(); 1`);
    await waitFor(
      peer.client,
      `document.getElementById('media-detail-modal').classList.contains('hidden')`,
      6000,
      'oda GIF adlandırma penceresi kapandı'
    );
    const roomSaved = await evalJS(
      peer.client,
      `(async () => {
        const items = await TeamSyncMediaLibrary.getItems();
        return { count: items.length, names: items.map(item => item.name).sort() };
      })()`,
      true
    );
    assert.strictEqual(roomSaved.count, 2, JSON.stringify(roomSaved, null, 2));
    assert.deepStrictEqual(roomSaved.names, ['oda-dansi.gif', 'parti.gif'], JSON.stringify(roomSaved, null, 2));

    // --- Sunucu içi Mesajlar modalini sürükleyerek yükseltme ---
    const serverResize = await evalJS(
      peer.client,
      `(() => {
        document.getElementById('server-dm-modal').classList.remove('hidden');
        const card = document.querySelector('.mcard.server-dm-card');
        const handle = document.querySelector('[data-dm-resize="server"]');
        const before = Math.round(card.getBoundingClientRect().height);
        const start = handle.getBoundingClientRect().top;
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 3, clientY: start }));
        handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 3, clientY: start - 150 }));
        handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3, clientY: start - 150 }));
        const after = Math.round(card.getBoundingClientRect().height);
        // Aşırı sürükleme ekranı taşırmamalı.
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 4, clientY: start }));
        handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 4, clientY: start - 4000 }));
        handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 4, clientY: start - 4000 }));
        return {
          before,
          after,
          clamped: Math.round(card.getBoundingClientRect().height),
          viewport: window.innerHeight,
          messagesScrollable: document.getElementById('server-dm-messages').scrollHeight >= 0
        };
      })()`
    );
    assert.strictEqual(serverResize.before, 500, JSON.stringify(serverResize, null, 2));
    assert.ok(serverResize.after > serverResize.before, JSON.stringify(serverResize, null, 2));
    assert.ok(serverResize.clamped <= serverResize.viewport, JSON.stringify(serverResize, null, 2));
    assert.strictEqual(serverResize.messagesScrollable, true, JSON.stringify(serverResize, null, 2));

    // --- Arama görünümünde sohbet, sağ paneli tamamen doldurur ---
    // (Discord tarzı kabuk: sürükleme tutamacı yok, panel sekmeli.)
    const roomChatPanel = await evalJS(
      peer.client,
      `(() => {
        document.getElementById('server-dm-modal').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        window.TSShell.setView('call');
        window.TSShell.setCallSide(true, 'chat');
        const chat = document.querySelector('.chat');
        const side = document.querySelector('#app > .sidebar');
        const handle = chat.querySelector('[data-dm-resize="roomChat"]');
        const chatRect = chat.getBoundingClientRect();
        const sideRect = side.getBoundingClientRect();
        return {
          handleHidden: getComputedStyle(handle).display === 'none',
          chatFillsPanel: chatRect.height >= sideRect.height - 60,
          formInside: document.querySelector('.cform').getBoundingClientRect().bottom <= chatRect.bottom + 1,
          formVisible: document.querySelector('.cform').getBoundingClientRect().height > 0
        };
      })()`
    );
    assert.deepStrictEqual(roomChatPanel, { handleHidden: true, chatFillsPanel: true, formInside: true, formVisible: true }, JSON.stringify(roomChatPanel, null, 2));

    await peer.client.send('Page.enable');
    const shot = await peer.client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const shotPath = path.join(process.env.TEMP, 'teamsync-media-collect-resize.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));

    console.log(JSON.stringify({
      hoverState, dmDetail, savedFromDM, duplicateState, roomCollect, roomSaved,
      serverResize, roomChatPanel, shotPath
    }, null, 2));
  } finally {
    cleanupPeer(peer);
  }
};
