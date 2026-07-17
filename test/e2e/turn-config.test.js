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
  } finally {
    cleanupPeer(p);
  }
};
