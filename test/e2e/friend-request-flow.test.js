// İki gerçek istemci arasında arkadaşlık isteği: A formdan gönderir, B'nin
// "Bekleyen" sekmesinde kabul/ret düğmeleriyle görünür, B kabul edince A'nın
// listesinde arkadaş olur ve giden istek kaybolur (E2E çevrimdışı kipi: MQTT).
const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
  waitStableIdentity,
} = require('./lib/harness');

module.exports = async function run() {
  const a = await spawnPeer({ port: 9393, name: 'Gonderen A' });
  const b = await spawnPeer({ port: 9394, name: 'Alici B' });
  try {
    const menu = `!document.getElementById('step-action').classList.contains('hidden')`;
    await waitFor(a.client, menu, 15000, 'A main menu');
    await waitFor(b.client, menu, 15000, 'B main menu');
    await waitStableIdentity(a);
    const fb = await waitStableIdentity(b);
    const connected = `!!(state.globalMqtt && state.globalMqtt.connected)`;
    await waitFor(a.client, connected, 20000, 'A broker');
    await waitFor(b.client, connected, 20000, 'B broker');

    await evalJS(a.client, `(async () => {
      document.getElementById('friend-id-input').value = ${JSON.stringify(fb.toLowerCase())};
      document.getElementById('btn-add-friend').click();
      await new Promise(r => setTimeout(r, 300));
      return 1;
    })()`, true);
    assert.strictEqual(await evalJS(a.client, `window.TSFriends.wasRequested(${JSON.stringify(fb)})`), true, 'A giden isteği kaydetmeli');

    await waitFor(b.client, `state.friendRequests.length === 1`, 20000, 'B isteği almalı');
    const ui = await evalJS(b.client, `(() => {
      window.TSFriends.setTab('pending');
      const row = document.querySelector('#pending-list .pending-item[data-dir="in"]');
      return {
        accept: !!(row && row.querySelector('[data-accept]')),
        reject: !!(row && row.querySelector('[data-reject]')),
        badge: document.getElementById('ftab-pending-badge').textContent
      };
    })()`);
    assert.deepStrictEqual(ui, { accept: true, reject: true, badge: '1' });

    await evalJS(b.client, `document.querySelector('#pending-list [data-accept]').click()`);
    const fa = await evalJS(a.client, 'state.friendId');
    assert.strictEqual(await evalJS(b.client, `!!(state.friends[${JSON.stringify(fa)}] && state.friendRequests.length === 0)`), true);

    await waitFor(a.client, `!!state.friends[${JSON.stringify(fb)}]`, 20000, 'A kabulü almalı');
    const after = await evalJS(a.client, `(() => {
      window.TSFriends.setTab('pending');
      return {
        name: state.friends[${JSON.stringify(fb)}].name,
        outgoing: window.TSFriends.outgoingIds().length
      };
    })()`);
    assert.deepStrictEqual(after, { name: 'Alici B', outgoing: 0 });

    // Grup "Arkadaş ekle" seçicisi: eklenecek kimse yoksa ölü birincil düğme yok;
    // aday varken seçim yapılana kadar düğme devre dışı.
    await evalJS(a.client, `TSProfile.request(${JSON.stringify(fb)}, 0, true); 1`);
    await waitFor(a.client, `!!TSCrypto.peerKeys(${JSON.stringify(fb)})`, 25000, 'A learns B keys');
    const gid = await evalJS(a.client, `TSGroups.createGroup([${JSON.stringify(fb)}], 'Picker').then(r => r.gid)`, true);
    const picker = await evalJS(a.client, `(async () => {
      TSShell.setView('group', ${JSON.stringify(gid)});
      await new Promise(r => setTimeout(r, 300));
      const clickAdd = () => document.querySelector('#grp-members-panel [data-grp-add]').click();
      clickAdd();
      await new Promise(r => setTimeout(r, 200));
      const empty = { go: !!document.querySelector('.grp-pick-pop .grp-pick-go'), goadd: !!document.querySelector('.grp-pick-pop [data-pick="goadd"]') };
      TSUI.closePopover();
      state.friends['KNK-PICKERTEST1'] = { name: 'Seçici Deneme', online: false };
      clickAdd();
      await new Promise(r => setTimeout(r, 200));
      const go = document.querySelector('.grp-pick-pop .grp-pick-go');
      const before = go.disabled;
      document.querySelector('.grp-pick-pop .grp-pick-row').click();
      await new Promise(r => setTimeout(r, 100));
      const after = go.disabled;
      TSUI.closePopover();
      delete state.friends['KNK-PICKERTEST1'];
      return { empty, before, after };
    })()`, true);
    assert.deepStrictEqual(picker, { empty: { go: false, goadd: true }, before: true, after: false });

    // Arkadaşlıktan çıkarma → "Çıkarılanlar"; ortak grup etkilenmez; çıkarılandan DM gelmez.
    const removed = await evalJS(b.client, `removeFriend(${JSON.stringify(fa)}, { skipConfirm: true }).then(() => ({
      friend: !!state.friends[${JSON.stringify(fa)}],
      list: TSFriends.removedList().map(r => r.fid + ':' + r.name),
      stillInGroup: !!TSGroups.get(${JSON.stringify(gid)})
    }))`, true);
    assert.deepStrictEqual(removed, { friend: false, list: [fa + ':Gonderen A'], stillInGroup: true });

    // Engelle: Çıkarılanlar'dan Engellenenler'e geçer; DM ve istek düşer.
    const blocked = await evalJS(b.client, `(() => {
      TSBlock.block(${JSON.stringify(fa)}, 'Gonderen A');
      TSFriends.setTab('blocked');
      return {
        blocked: TSBlock.isBlocked(${JSON.stringify(fa)}),
        removed: TSFriends.removedList().length,
        rows: document.querySelectorAll('#people-list .people-item').length,
        stored: !!localStorage.getItem('teamsync_blocked_' + state.friendId),
        notInProfile: !JSON.stringify(JSON.parse(localStorage.getItem('teamsync_profile') || '{}')).includes('blocked')
      };
    })()`);
    assert.deepStrictEqual(blocked, { blocked: true, removed: 0, rows: 1, stored: true, notInProfile: true });
    await evalJS(a.client, `(() => {
      state.globalMqtt.publish('teamsync/user/' + ${JSON.stringify(fb)} + '/events', JSON.stringify({ type: 'dm_msg', fromId: state.friendId, fromName: state.myName, msgType: 'text', content: 'engelli mesaj', mid: crypto.randomUUID() }), { qos: 1 });
      state.globalMqtt.publish('teamsync/user/' + ${JSON.stringify(fb)} + '/events', JSON.stringify({ type: 'friend_request', id: state.friendId, name: state.myName }), { qos: 1 });
      return 1;
    })()`);
    await new Promise(r => setTimeout(r, 3000));
    const dropped = await evalJS(b.client, `({
      dm: (state.dms[${JSON.stringify(fa)}] || []).some(m => m.content === 'engelli mesaj'),
      request: state.friendRequests.some(r => r.id === ${JSON.stringify(fa)}),
      temp: !!state.friends[${JSON.stringify(fa)}]
    })`);
    assert.deepStrictEqual(dropped, { dm: false, request: false, temp: false });

    // Engeli kaldır: arkadaşlık geri gelmez, liste boşalır.
    const unblocked = await evalJS(b.client, `(() => { TSFriends.unblockUser(${JSON.stringify(fa)}, true); return { blocked: TSBlock.isBlocked(${JSON.stringify(fa)}), friend: !!state.friends[${JSON.stringify(fa)}], rows: document.querySelectorAll('#people-list .people-item').length }; })()`);
    assert.deepStrictEqual(unblocked, { blocked: false, friend: false, rows: 0 });
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
  }
};

if (require.main === module) {
  module.exports().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
