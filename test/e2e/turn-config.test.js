// TURN yapılandırma makinesi regresyon testi (ağ/gerçek TURN gerektirmez):
//  - expandTurnFamily: kayıtlı tek taşıma türünden udp/tcp/tls tüm ailesi üretilmeli
//    (WARP gibi araçlar bazı günler UDP'yi, bazı günler DNS'i bozuyor; tek
//    çalışan varyant bağlantıyı kurtarır)
//  - expandTurnWithIpVariants: DoH önbelleğindeki IP'lerden, tcp varyantları
//    DAHİL turn: URL'lerinin IP-literal kopyaları üretilmeli (DNS tamamen
//    ölüyken kalan tek yol turn:IP:...?transport=tcp)
//  - turns: (TLS) IP'ye çevrilMEmeli (sertifika ana bilgisayar adı ister)
//  - detectTunnelInterference patlamadan çalışıp state.warpDetected'ı boolean yapmalı
const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS } = require('./lib/harness');

module.exports = async function run() {
  const p = await spawnPeer({ port: 9309, name: 'TurnCfg' });
  try {
    const urls = await evalJS(p.client, `(() => {
      localStorage.setItem('teamsync_turn_url', 'turns:ornek.turn.example.com:443?transport=tcp');
      localStorage.setItem('teamsync_turn_user', 'kullanici');
      localStorage.setItem('teamsync_turn_pass', 'sifre');
      localStorage.setItem('teamsync_turn_ip_cache', JSON.stringify({
        'ornek.turn.example.com': { ips: ['203.0.113.7'], ts: Date.now() }
      }));
      return getIceServers().map(s => s.urls);
    })()`);

    // Aile: kullanıcı SADECE turns: girdi; udp/tcp varyantları türetilmeli
    for (const expected of [
      'turn:ornek.turn.example.com:80',
      'turn:ornek.turn.example.com:443',
      'turn:ornek.turn.example.com:80?transport=tcp',
      'turn:ornek.turn.example.com:443?transport=tcp',
      'turns:ornek.turn.example.com:443?transport=tcp'
    ]) {
      assert.ok(urls.includes(expected), `aile varyantı eksik: ${expected}\nüretilen: ${urls.join('\n')}`);
    }

    // IP varyantları: tcp dahil turn: kopyaları; turns: IP'ye çevrilmemeli
    for (const expected of [
      'turn:203.0.113.7:80',
      'turn:203.0.113.7:443',
      'turn:203.0.113.7:80?transport=tcp',
      'turn:203.0.113.7:443?transport=tcp'
    ]) {
      assert.ok(urls.includes(expected), `IP varyantı eksik: ${expected}\nüretilen: ${urls.join('\n')}`);
    }
    assert.ok(!urls.some(u => u.startsWith('turns:203.0.113.7')),
      'turns: (TLS) URL IP-literale çevrilmiş — sertifika doğrulaması kırılır');

    // Kimlik bilgileri kopyalara taşınmalı
    const creds = await evalJS(p.client, `getIceServers()
      .filter(s => s.urls === 'turn:203.0.113.7:443?transport=tcp')
      .map(s => s.username + ':' + s.credential).join('|')`);
    assert.strictEqual(creds, 'kullanici:sifre', 'IP+tcp varyantına kimlik bilgileri kopyalanmadı');

    // WARP tespiti çağrılabilir olmalı ve boolean bırakmalı (WARP'ın o an
    // açık olup olmadığından bağımsız — CI/normal makinede false döner)
    const warp = await evalJS(p.client, `(async () => { await detectTunnelInterference(); return typeof state.warpDetected; })()`, true);
    assert.strictEqual(warp, 'boolean', 'detectTunnelInterference state.warpDetected boolean bırakmadı');

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
