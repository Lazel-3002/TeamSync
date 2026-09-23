// TURN yapılandırma makinesi regresyon testi (ağ/gerçek TURN gerektirmez).
//
// Kod iki kademeli çalışır (bkz. renderer.js buildTurnUrlList):
//   DAR MOD (varsayılan): host başına en fazla 3 URL — kullanıcının yazdığı
//     URL + turn:host:443?transport=tcp + turns:host:443?transport=tcp.
//     Amaç ICE toplamayı hızlı tutmak: her ölü URL, her ağ arayüzü için ayrı
//     bir Allocate açıp toplamayı ~40 sn "gathering" durumunda bırakabiliyor.
//   GENİŞ MOD (state.iceWideMode): ilk toplama relay adayı üretemezse açılır;
//     :80 varyantları ve DoH önbelleğindeki IP-literal kopyalar eklenir.
//
// Bu test o iki kademeyi ayrı ayrı doğrular. Ayrıca:
//   - turns: (TLS) ASLA IP-literale çevrilmemeli (sertifika ad doğrulaması)
//   - kimlik bilgileri host girdisinde taşınmalı
//   - detectTunnelInterference patlamadan çalışıp state.warpDetected'ı boolean yapmalı
//   - isJunkIceCandidate çöp adayları (Teredo/link-local/loopback) elemeli
const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS } = require('./lib/harness');

module.exports = async function run() {
  const p = await spawnPeer({ port: 9309, name: 'TurnCfg' });
  try {
    // getIceServers() artık host başına TEK girdi döndürüyor ve urls bir DİZİ;
    // "s.urls === '...'" varsayan eski kontroller sessizce hiçbir şey ölçmez.
    const setup = `
      localStorage.setItem('teamsync_turn_url', 'turns:ornek.turn.example.com:443?transport=tcp');
      localStorage.setItem('teamsync_turn_user', 'kullanici');
      localStorage.setItem('teamsync_turn_pass', 'sifre');
      localStorage.setItem('teamsync_turn_ip_cache', JSON.stringify({
        'ornek.turn.example.com': { ips: ['203.0.113.7'], ts: Date.now() }
      }));`;
    const flatten = `getIceServers().flatMap(s => Array.isArray(s.urls) ? s.urls : [s.urls])`;

    // --- DAR MOD ---
    const narrow = await evalJS(p.client, `(() => {
      ${setup}
      state.iceWideMode = false;
      return ${flatten};
    })()`);

    for (const expected of [
      'turns:ornek.turn.example.com:443?transport=tcp',
      'turn:ornek.turn.example.com:443?transport=tcp'
    ]) {
      assert.ok(narrow.includes(expected), `dar modda eksik: ${expected}
üretilen: ${narrow.join('\n')}`);
    }
    assert.ok(!narrow.some(u => /:80(\?|$)/.test(u)),
      `dar mod :80 varyantı üretmemeli (ICE toplamayı yavaşlatır): ${narrow.join(', ')}`);
    assert.ok(!narrow.some(u => /203\.0\.113\.7/.test(u)),
      `dar mod IP-literal kopya üretmemeli: ${narrow.join(', ')}`);
    const turnCount = narrow.filter(u => /^turns?:/.test(u)).length;
    assert.ok(turnCount <= 3, `dar modda host başına en fazla 3 TURN URL bekleniyor, ${turnCount} üretildi`);

    // --- GENİŞ MOD ---
    const wide = await evalJS(p.client, `(() => {
      ${setup}
      state.iceWideMode = true;
      return ${flatten};
    })()`);

    for (const expected of [
      'turn:ornek.turn.example.com:80',
      'turn:ornek.turn.example.com:443',
      'turn:ornek.turn.example.com:80?transport=tcp',
      'turn:ornek.turn.example.com:443?transport=tcp',
      'turns:ornek.turn.example.com:443?transport=tcp',
      'turn:203.0.113.7:443?transport=tcp',
      'turn:203.0.113.7:80?transport=tcp'
    ]) {
      assert.ok(wide.includes(expected), `geniş modda eksik: ${expected}
üretilen: ${wide.join('\n')}`);
    }
    assert.ok(!wide.some(u => u.startsWith('turns:203.0.113.7')),
      'turns: (TLS) URL IP-literale çevrilmiş — sertifika doğrulaması kırılır');

    // Kimlik bilgileri TURN girdisinde durmalı (hepsi aynı host/kullanıcı).
    const creds = await evalJS(p.client, `(() => {
      state.iceWideMode = true;
      const entry = getIceServers().find(s => {
        const list = Array.isArray(s.urls) ? s.urls : [s.urls];
        return list.some(u => u.startsWith('turn:203.0.113.7'));
      });
      return entry ? entry.username + ':' + entry.credential : 'GIRDI YOK';
    })()`);
    assert.strictEqual(creds, 'kullanici:sifre', 'IP varyantlarını taşıyan girdide kimlik bilgileri yok');

    // W3C: 32'den fazla iceServer girdisi SESSİZCE yok sayılır.
    const entryCount = await evalJS(p.client, `getIceServers().length`);
    assert.ok(entryCount <= 32, `iceServer girdi sayısı 32 sınırını aştı: ${entryCount}`);

    // WARP tespiti çağrılabilir olmalı ve boolean bırakmalı (WARP'ın o an
    // açık olup olmadığından bağımsız — CI/normal makinede false döner)
    const warp = await evalJS(p.client, `(async () => { await detectTunnelInterference(); return typeof state.warpDetected; })()`, true);
    assert.strictEqual(warp, 'boolean', 'detectTunnelInterference state.warpDetected boolean bırakmadı');

    // TURN varken WARP algılandıysa ilk taşıma politikası relay olmalı; TURN
    // yokken relay anlamsızdır ve 'all'da kalınmalı (yoksa hiç bağlanılamaz).
    const policy = await evalJS(p.client, `(() => {
      ${setup}
      const before = state.warpDetected;
      state.warpDetected = true;
      const withTurn = preferredIceTransportPolicy();
      localStorage.removeItem('teamsync_turn_url');
      localStorage.removeItem('teamsync_turn_user');
      localStorage.removeItem('teamsync_turn_pass');
      state.dynamicTurnServers = [];
      state.sharedTurn = [];
      const withoutTurn = preferredIceTransportPolicy();
      state.warpDetected = before;
      return { withTurn, withoutTurn };
    })()`);
    assert.strictEqual(policy.withTurn, 'relay', 'WARP + TURN varken relay ile başlanmalı');
    assert.strictEqual(policy.withoutTurn, 'all', 'TURN yokken relay-only kilitlenmeye yol açar');

    // NAT davranışı ölçümü. Relay kararı CGNAT ADRESİNE değil, NAT'ın
    // simetrik olup olmadığına bağlanmalı: taşıyıcı NAT'ların çoğu cone
    // çalışır ve doğrudan P2P kurulur; relay'e zorlamak gereksiz gecikme
    // ve bant genişliği demektir. Simetrik NAT'ın imzası: aynı yerel port
    // (rport) iki farklı dış porta eşleniyor.
    const nat = await evalJS(p.client, `(() => {
      ${setup}
      const wasWarp = state.warpDetected;
      state.warpDetected = false;

      // 1) Cone NAT: iki STUN sunucusu da aynı dış portu görür.
      state.symmetricNatDetected = false;
      state.cgnatDetected = false;
      state.srflxByLocalPort = {};
      noteNatBehaviourFromCandidate({ candidate: 'candidate:1 1 udp 1677729535 78.190.202.3 30964 typ srflx raddr 192.168.1.5 rport 55567' });
      noteNatBehaviourFromCandidate({ candidate: 'candidate:2 1 udp 1677729535 78.190.202.3 30964 typ srflx raddr 192.168.1.5 rport 55567' });
      const coneSymmetric = state.symmetricNatDetected;
      const conePolicy = preferredIceTransportPolicy();

      // 2) Simetrik NAT: aynı yerel port, iki farklı dış port.
      state.symmetricNatDetected = false;
      state.srflxByLocalPort = {};
      noteNatBehaviourFromCandidate({ candidate: 'candidate:1 1 udp 1677729535 78.190.202.3 30964 typ srflx raddr 192.168.1.5 rport 55567' });
      noteNatBehaviourFromCandidate({ candidate: 'candidate:2 1 udp 1677729535 78.190.202.3 41022 typ srflx raddr 192.168.1.5 rport 55567' });
      const symmetric = state.symmetricNatDetected;
      const symmetricPolicy = preferredIceTransportPolicy();

      // 3) CGNAT adresi yalnızca TANI amaçlı işaretlenir, politikayı
      //    tek başına değiştirmez (cone CGNAT'ta doğrudan P2P kurulur).
      state.symmetricNatDetected = false;
      state.cgnatDetected = false;
      state.srflxByLocalPort = {};
      noteNatBehaviourFromCandidate({ candidate: 'candidate:1 1 udp 1677729535 100.82.160.55 30964 typ srflx raddr 192.168.1.5 rport 55567' });
      const cgnatFlag = state.cgnatDetected;
      const cgnatPolicy = preferredIceTransportPolicy();

      // 4) Host adayı ölçüme hiç girmemeli.
      state.srflxByLocalPort = {};
      const hostParsed = parseSrflxCandidate('candidate:1 1 udp 2113937151 192.168.1.5 55567 typ host');

      state.symmetricNatDetected = false;
      state.cgnatDetected = false;
      state.srflxByLocalPort = {};
      state.warpDetected = wasWarp;
      return { coneSymmetric, conePolicy, symmetric, symmetricPolicy, cgnatFlag, cgnatPolicy, hostParsed };
    })()`);
    assert.strictEqual(nat.coneSymmetric, false, 'aynı dış port cone NAT demek, simetrik işaretlenmemeli');
    assert.strictEqual(nat.conePolicy, 'all', 'cone NAT relay\'e zorlanmamalı');
    assert.strictEqual(nat.symmetric, true, 'aynı yerel port için farklı dış portlar simetrik NAT demek');
    assert.strictEqual(nat.symmetricPolicy, 'relay', 'simetrik NAT + TURN varken relay ile başlanmalı');
    assert.strictEqual(nat.cgnatFlag, true, 'CGNAT adresi tanı için işaretlenmeli');
    assert.strictEqual(nat.cgnatPolicy, 'all', 'CGNAT adresi TEK BAŞINA relay gerekçesi olmamalı');
    assert.strictEqual(nat.hostParsed, null, 'host adayı srflx olarak ayrıştırılmamalı');

    // Çöp aday filtresi: Teredo/link-local/loopback elenmeli, gerçek adaylar
    // (host/srflx/relay, mDNS dahil) elenMEmeli. Çöp adaylar TURN
    // CreatePermission 600 hatası tetikleyip tüm relay bağlantısını
    // budatabiliyor (saha logundan; WARP altında tek çalışan yol relay).
    const junkResults = await evalJS(p.client, `JSON.stringify([
      isJunkIceCandidate({ candidate: 'candidate:1 1 udp 2113937151 2001:0:14c9:d804:3019:b5eb:97e3:5b98 55570 typ host' }),
      isJunkIceCandidate({ candidate: 'candidate:2 1 udp 2113937151 fe80::1234:5678:9abc:def0 55571 typ host' }),
      isJunkIceCandidate({ candidate: 'candidate:3 1 udp 2113937151 127.0.0.1 55563 typ host' }),
      isJunkIceCandidate({ candidate: 'candidate:4 1 udp 2113937151 ::1 55564 typ host' }),
      isJunkIceCandidate({ candidate: 'candidate:5 1 udp 2113937151 192.168.1.5 55567 typ host' }),
      isJunkIceCandidate({ candidate: 'candidate:6 1 udp 1677729535 104.28.164.103 55568 typ srflx raddr 0.0.0.0 rport 0' }),
      isJunkIceCandidate({ candidate: 'candidate:7 1 udp 41885695 49.13.142.65 20621 typ relay raddr 0.0.0.0 rport 0' }),
      isJunkIceCandidate({ candidate: 'candidate:8 1 udp 2113937151 a1b2c3d4-e5f6.local 55569 typ host' }),
      isJunkIceCandidate({ candidate: '' })
    ])`);
    assert.strictEqual(junkResults, JSON.stringify([true, true, true, true, false, false, false, false, false]),
      'isJunkIceCandidate yanlış sınıflandırma yaptı: ' + junkResults);
  } finally {
    cleanupPeer(p);
  }
};
