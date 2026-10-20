// Arkadaşlık isteği posta kutusu (supabase/friend_requests.sql): olmayan ID
// reddedilir, çevrimdışıyken gelen istek ve kabul açılışta senkronlanır.
// Supabase RPC'leri sahte istemciyle taklit edilir (E2E çevrimdışı kipi).
const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
  waitStableIdentity,
} = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9391, name: 'Mailbox Test' });
  try {
    await waitFor(
      peer.client,
      `!document.getElementById('step-action').classList.contains('hidden')`,
      10000,
      'main menu'
    );
    await waitStableIdentity(peer);

    await evalJS(peer.client, `(() => {
      window.__rpcCalls = [];
      window.__rpcReplies = {};
      state.accountKind = 'cloud';
      supabaseClient = {
        rpc: async (fn, args) => {
          window.__rpcCalls.push({ fn, args });
          const reply = window.__rpcReplies[fn];
          return { data: typeof reply === 'function' ? reply(args) : (reply === undefined ? null : reply), error: null };
        },
        auth: { getSession: async () => ({ data: { session: null } }) }
      };
      return 1;
    })()`, true);

    // 1) Olmayan ID: hata gösterilir, "gönderildi" denmez, giden kaydı oluşmaz.
    const notFound = await evalJS(peer.client, `(async () => {
      window.__rpcReplies.send_friend_request = 'not_found';
      document.getElementById('friend-id-input').value = 'KNK-DOESNOTEXIST';
      document.getElementById('btn-add-friend').click();
      await new Promise(r => setTimeout(r, 300));
      const msg = document.getElementById('add-friend-msg');
      return {
        text: msg ? msg.textContent : '',
        isError: msg ? msg.classList.contains('error') : false,
        requested: window.TSFriends.wasRequested('KNK-DOESNOTEXIST')
      };
    })()`, true);
    assert.strictEqual(notFound.isError, true, 'hata mesajı gösterilmeli');
    assert.ok(notFound.text.length > 0, 'hata metni boş olmamalı');
    assert.strictEqual(notFound.requested, false, 'olmayan ID giden isteklere eklenmemeli');

    // 2) Var olan ID: istek kaydedilir.
    const sent = await evalJS(peer.client, `(async () => {
      window.__rpcReplies.send_friend_request = 'ok';
      document.getElementById('friend-id-input').value = 'knk-realfriend';
      document.getElementById('btn-add-friend').click();
      await new Promise(r => setTimeout(r, 300));
      const call = window.__rpcCalls.filter(c => c.fn === 'send_friend_request').pop();
      return { to: call && call.args.p_to, requested: window.TSFriends.wasRequested('KNK-REALFRIEND') };
    })()`, true);
    assert.deepStrictEqual(sent, { to: 'KNK-REALFRIEND', requested: true });

    // 3) Senkron: çevrimdışıyken gelen istek listeye düşer, bizim kabul edilen
    //    isteğimiz arkadaşa dönüşür ve satırı temizlenir.
    const synced = await evalJS(peer.client, `(async () => {
      const me = state.friendId;
      window.__rpcCalls = [];
      window.__rpcReplies.list_friend_requests = [
        { from_id: 'KNK-INCOMING1', to_id: me, from_name: 'Gelen Kişi', to_name: null, status: 'pending', created_at: new Date().toISOString() },
        { from_id: me, to_id: 'KNK-REALFRIEND', from_name: 'x', to_name: 'Gerçek Arkadaş', status: 'accepted', created_at: new Date().toISOString() }
      ];
      await syncFriendRequests();
      return {
        incoming: state.friendRequests.map(r => r.id + ':' + r.name),
        friend: state.friends['KNK-REALFRIEND'] ? state.friends['KNK-REALFRIEND'].name : null,
        cleared: window.__rpcCalls.some(c => c.fn === 'clear_friend_request' && c.args.p_to === 'KNK-REALFRIEND')
      };
    })()`, true);
    assert.deepStrictEqual(synced.incoming, ['KNK-INCOMING1:Gelen Kişi']);
    assert.strictEqual(synced.friend, 'Gerçek Arkadaş');
    assert.strictEqual(synced.cleared, true);

    // Bekleyen sekmesinde ve rozette görünür.
    const pending = await evalJS(peer.client, `(() => {
      window.TSFriends.setTab('pending');
      return {
        rows: document.querySelectorAll('#pending-list .pending-item[data-dir="in"]').length,
        badge: document.getElementById('ftab-pending-badge').textContent
      };
    })()`, true);
    assert.deepStrictEqual(pending, { rows: 1, badge: '1' });

    // 4) Ret sunucuya da iletilir; ikinci senkron aynı isteği geri getirmez.
    const rejected = await evalJS(peer.client, `(async () => {
      window.__rpcCalls = [];
      rejectInvite(0);
      window.__rpcReplies.list_friend_requests = [];
      await syncFriendRequests();
      const call = window.__rpcCalls.find(c => c.fn === 'respond_friend_request');
      return { args: call && call.args, left: state.friendRequests.length };
    })()`, true);
    assert.deepStrictEqual(rejected, { args: { p_from: 'KNK-INCOMING1', p_accept: false }, left: 0 });

    // 5) RPC kurulmamışsa (null) eski MQTT akışı çalışmaya devam eder.
    const fallback = await evalJS(peer.client, `(async () => {
      window.__rpcReplies.send_friend_request = undefined;
      const err = await deliverFriendRequest('KNK-LEGACYPATH');
      return { err, requested: window.TSFriends.wasRequested('KNK-LEGACYPATH') };
    })()`, true);
    assert.deepStrictEqual(fallback, { err: null, requested: true });

    // 6) Eski sürümden kalan bozuk giden kayıt ("E") listeden atılır; sunucuda
    //    olmayan eski giden istek sunucuya taşınır, ID yoksa listeden düşer.
    const legacy = await evalJS(peer.client, `(async () => {
      const key = 'teamsync_outgoing_requests_' + state.friendId;
      localStorage.setItem(key, JSON.stringify([
        { id: 'E', at: Date.now() },
        { id: 'KNK-OLDGHOST', at: Date.now() },
        { id: 'KNK-OLDREAL', at: Date.now() }
      ]));
      window.__rpcCalls = [];
      window.__rpcReplies.list_friend_requests = [];
      window.__rpcReplies.send_friend_request = args => args.p_to === 'KNK-OLDGHOST' ? 'not_found' : 'ok';
      await syncFriendRequests();
      window.TSFriends.setTab('pending');
      return {
        ids: window.TSFriends.outgoingIds(),
        sentTo: window.__rpcCalls.filter(c => c.fn === 'send_friend_request').map(c => c.args.p_to).sort(),
        rows: document.querySelectorAll('#pending-list .pending-item[data-dir="out"]').length
      };
    })()`, true);
    assert.deepStrictEqual(legacy, {
      ids: ['KNK-OLDREAL'],
      sentTo: ['KNK-OLDGHOST', 'KNK-OLDREAL'],
      rows: 1
    });

    // 7) Sunucu üye kartı gizli formdan istek atar: hata toast olarak görünmeli.
    const hiddenForm = await evalJS(peer.client, `(async () => {
      window.TSFriends.setTab('online');
      window.__rpcReplies.send_friend_request = 'not_found';
      const toasts = [];
      const orig = window.showToast;
      window.showToast = (msg, kind) => { toasts.push(kind); return orig(msg, kind); };
      try {
        document.getElementById('friend-id-input').value = 'KNK-NOBODYHERE';
        document.getElementById('btn-add-friend').click();
        await new Promise(r => setTimeout(r, 300));
      } finally {
        window.showToast = orig;
      }
      return toasts;
    })()`, true);
    assert.deepStrictEqual(hiddenForm, ['warn']);
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
