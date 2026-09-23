#!/usr/bin/env node
/*
 * TeamSync ağ tanılaması — "mobil veride neden konuşamıyoruz?" sorusunun
 * kesin cevabı. Hiçbir bağımlılık kullanmaz, uygulamayı açmaya gerek yoktur:
 *
 *   npm run diag:net
 *   npm run diag:net -- --turn turn:sunucu.com:3478 --user KULLANICI --pass SIFRE
 *
 * Ölçtükleri:
 *   1) STUN erişimi ve genel IP
 *   2) NAT tipi (aynı yerel soketten iki farklı STUN sunucusu) — dış port
 *      hedefe göre değişiyorsa NAT simetriktir ve TURN relay şart olur
 *   3) CGNAT (genel IP 100.64.0.0/10 taşıyıcı NAT aralığında mı) — bu adres
 *      dışarıdan erişilemez, yani burada relay barındırılamaz; ama NAT cone
 *      ise giden bağlantıyla delik açma yine de çalışır
 *   4) Cloudflare WARP / tünel açık mı
 *   5) Sinyalleşme brokerlarına (MQTT over WSS) erişim
 *   6) Yapılandırılmış TURN sunucusuna gerçek Allocate isteği
 *
 * Çıkış kodu: sesli görüşme kurulabilecek bir yol bulunduysa 0, bulunamadıysa 1.
 */
const dgram = require('dgram');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const https = require('https');

const MAGIC = 0x2112A442;
const STUN_BIND_REQ = 0x0001, STUN_BIND_OK = 0x0101;
const TURN_ALLOC_REQ = 0x0003, TURN_ALLOC_OK = 0x0103;
const ATTR = {
  USERNAME: 0x0006, MSGINT: 0x0008, ERRCODE: 0x0009, REALM: 0x0014,
  NONCE: 0x0015, XOR_RELAY: 0x0016, XOR_MAPPED: 0x0020, REQ_TRANSPORT: 0x0019,
  SOFTWARE: 0x8022,
};

const pad4 = n => (4 - (n % 4)) % 4;

function attr(type, val) {
  const b = Buffer.alloc(4 + val.length + pad4(val.length));
  b.writeUInt16BE(type, 0);
  b.writeUInt16BE(val.length, 2);
  val.copy(b, 4);
  return b;
}

function buildMsg(type, tid, attrs, creds) {
  let body = Buffer.concat(attrs);
  if (creds) {
    // MESSAGE-INTEGRITY: uzun süreli kimlik doğrulama (RFC 5389 §15.4).
    // HMAC, uzunluk alanı MESSAGE-INTEGRITY'yi DE içerecek şekilde hesaplanır.
    const hdr = Buffer.alloc(20);
    hdr.writeUInt16BE(type, 0);
    hdr.writeUInt16BE(body.length + 24, 2);
    hdr.writeUInt32BE(MAGIC, 4);
    tid.copy(hdr, 8);
    const key = crypto.createHash('md5')
      .update(`${creds.user}:${creds.realm}:${creds.pass}`, 'binary').digest();
    const mac = crypto.createHmac('sha1', key).update(Buffer.concat([hdr, body])).digest();
    body = Buffer.concat([body, attr(ATTR.MSGINT, mac)]);
  }
  const hdr = Buffer.alloc(20);
  hdr.writeUInt16BE(type, 0);
  hdr.writeUInt16BE(body.length, 2);
  hdr.writeUInt32BE(MAGIC, 4);
  tid.copy(hdr, 8);
  return Buffer.concat([hdr, body]);
}

function parseMsg(buf) {
  if (!buf || buf.length < 20) return null;
  const out = { type: buf.readUInt16BE(0), attrs: {} };
  let off = 20;
  const end = Math.min(buf.length, 20 + buf.readUInt16BE(2));
  while (off + 4 <= end) {
    const t = buf.readUInt16BE(off), l = buf.readUInt16BE(off + 2);
    out.attrs[t] = buf.slice(off + 4, off + 4 + l);
    off += 4 + l + pad4(l);
  }
  return out;
}

function xorAddr(v) {
  if (!v || v.length < 8 || v.readUInt8(1) !== 0x01) return null;
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  const ip = [];
  for (let i = 0; i < 4; i++) ip.push(v.readUInt8(4 + i) ^ ((MAGIC >>> (24 - 8 * i)) & 0xff));
  return `${ip.join('.')}:${port}`;
}

const errText = v => (!v || v.length < 4) ? null : `${v.readUInt8(2) * 100 + v.readUInt8(3)} ${v.slice(4).toString('utf8')}`;

function udpTx(host, port, msg, timeout = 3000, sock = null) {
  return new Promise(resolve => {
    const own = !sock;
    const s = sock || dgram.createSocket('udp4');
    let done = false;
    const onMsg = m => fin({ msg: parseMsg(m) });
    const fin = r => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.off('message', onMsg);
      if (own) { try { s.close(); } catch (e) {} }
      resolve(r);
    };
    const timer = setTimeout(() => fin({ error: 'zaman asimi' }), timeout);
    s.on('message', onMsg);
    s.once('error', e => fin({ error: e.message }));
    s.send(msg, port, host, e => { if (e) fin({ error: e.message }); });
  });
}

function tcpTx(host, port, msg, timeout = 6000) {
  return new Promise(resolve => {
    let done = false, buf = Buffer.alloc(0);
    const sock = net.connect({ host, port });
    const fin = r => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (e) {} resolve(r); };
    const timer = setTimeout(() => fin({ error: 'zaman asimi' }), timeout);
    sock.on('connect', () => sock.write(msg));
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 20 && buf.length >= 20 + buf.readUInt16BE(2)) fin({ msg: parseMsg(buf) });
    });
    sock.on('error', e => fin({ error: e.message }));
    sock.on('close', () => fin({ error: 'baglanti kapandi' }));
  });
}

async function stunBind(host, port, sock) {
  const msg = buildMsg(STUN_BIND_REQ, crypto.randomBytes(12), [attr(ATTR.SOFTWARE, Buffer.from('teamsync-diag'))]);
  const r = await udpTx(host, port, msg, 3000, sock);
  if (r.error) return { ok: false, error: r.error };
  if (!r.msg || r.msg.type !== STUN_BIND_OK) return { ok: false, error: 'beklenmeyen yanit' };
  return { ok: true, mapped: xorAddr(r.msg.attrs[ATTR.XOR_MAPPED]) };
}

async function turnAllocate(host, port, user, pass, transport) {
  const tx = transport === 'tcp' ? tcpTx : udpTx;
  const reqTransport = Buffer.alloc(4);
  reqTransport.writeUInt8(17, 0); // UDP relay
  const first = await tx(host, port, buildMsg(TURN_ALLOC_REQ, crypto.randomBytes(12), [attr(ATTR.REQ_TRANSPORT, reqTransport)]));
  if (first.error) return { ok: false, error: first.error };
  const realmB = first.msg && first.msg.attrs[ATTR.REALM];
  const nonceB = first.msg && first.msg.attrs[ATTR.NONCE];
  if (!realmB || !nonceB) {
    return { ok: false, error: 'sunucu realm/nonce vermedi (' + (errText(first.msg && first.msg.attrs[ATTR.ERRCODE]) || 'TURN sunucusu degil') + ')' };
  }
  const realm = realmB.toString('utf8');
  const second = await tx(host, port, buildMsg(TURN_ALLOC_REQ, crypto.randomBytes(12), [
    attr(ATTR.REQ_TRANSPORT, reqTransport),
    attr(ATTR.USERNAME, Buffer.from(user, 'utf8')),
    attr(ATTR.REALM, realmB),
    attr(ATTR.NONCE, nonceB),
  ], { user, pass, realm }));
  if (second.error) return { ok: false, realm, error: second.error };
  if (second.msg && second.msg.type === TURN_ALLOC_OK) {
    return { ok: true, realm, relay: xorAddr(second.msg.attrs[ATTR.XOR_RELAY]) };
  }
  return { ok: false, realm, error: errText(second.msg && second.msg.attrs[ATTR.ERRCODE]) || 'reddedildi' };
}

function wsProbe(host, port, path) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let done = false;
    const fin = r => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (e) {} resolve(r); };
    const timer = setTimeout(() => fin({ ok: false, error: 'zaman asimi' }), 8000);
    const CRLF = String.fromCharCode(13, 10);
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      sock.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`,
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Protocol: mqtt',
        '', '',
      ].join(CRLF));
    });
    let buf = '';
    sock.on('data', d => {
      buf += d.toString('latin1');
      if (buf.includes(CRLF + CRLF)) fin({ ok: /\b101\b/.test(buf.split(CRLF)[0]), ms: Date.now() - t0 });
    });
    sock.on('error', e => fin({ ok: false, error: e.message }));
  });
}

function detectWarp() {
  return new Promise(resolve => {
    const req = https.get({ host: '1.1.1.1', path: '/cdn-cgi/trace', timeout: 5000 }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        const m = /(?:^|\n)warp=(on|plus)(?:\n|$)/.exec(data);
        resolve(m ? m[1] : null);
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// 100.64.0.0/10 = RFC 6598, taşıyıcı sınıfı NAT (CGNAT). Mobil operatörlerin
// neredeyse tamamı burayı kullanır ve bu aralıkta doğrudan P2P kurulamaz.
const isCgnat = ip => {
  const p = (ip || '').split('.').map(Number);
  return p[0] === 100 && p[1] >= 64 && p[1] <= 127;
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)$/.exec(argv[i]);
    if (m) out[m[1]] = argv[i + 1];
  }
  return out;
}

const line = () => console.log('-'.repeat(64));

(async () => {
  const args = parseArgs(process.argv.slice(2));
  console.log('');
  console.log('TeamSync ağ tanılaması');
  line();

  // 1) STUN + genel IP
  console.log('');
  console.log('[1/5] STUN sunucuları ve genel IP');
  const sock = dgram.createSocket('udp4');
  await new Promise(r => sock.bind(0, r));
  const stunTargets = [
    ['stun.l.google.com', 19302],
    ['stun.cloudflare.com', 3478],
    ['stun.nextcloud.com', 443],
  ];
  const mapped = [];
  for (const [h, p] of stunTargets) {
    const r = await stunBind(h, p, sock);
    console.log(`   ${r.ok ? 'OK  ' : 'HATA'} ${h}:${p} -> ${r.ok ? r.mapped : r.error}`);
    if (r.ok && r.mapped) mapped.push(r.mapped);
  }
  sock.close();

  if (!mapped.length) {
    console.log('');
    console.log('   !! Hiçbir STUN sunucusuna ulaşılamadı: UDP tamamen kapalı görünüyor.');
    console.log('      Bu ağda ses yalnızca TCP/TLS taşıyan bir TURN sunucusuyla kurulabilir.');
  }

  // 2) NAT tipi — aynı yerel soket, farklı sunucular
  console.log('');
  console.log('[2/5] NAT tipi');
  const ports = new Set(mapped.map(m => m.split(':')[1]));
  const publicIp = mapped.length ? mapped[0].split(':')[0] : null;
  let symmetric = false;
  if (mapped.length < 2) {
    console.log('   ?  Yeterli yanıt yok, NAT tipi belirlenemedi.');
  } else if (ports.size === 1) {
    console.log(`   OK   Cone NAT (endpoint-independent) — genel adres ${publicIp}:${[...ports][0]}`);
    console.log('        Doğrudan P2P bu ağda genelde kurulur.');
  } else {
    symmetric = true;
    console.log(`   !!   SİMETRİK NAT — her hedef için farklı port (${[...ports].join(', ')})`);
    console.log('        Doğrudan P2P bu ağda çalışmaz; TURN relay ZORUNLU.');
  }
  if (publicIp && isCgnat(publicIp)) {
    console.log(`   !!   CGNAT: ${publicIp} operatörün taşıyıcı NAT aralığında (RFC 6598).`);
    console.log('        Bu bağlantı dışarıdan adreslenemez: port yönlendirme işe yaramaz,');
    console.log('        burada relay/sunucu BARINDIRAMAZSIN. NAT cone ise (yukarıya bakın)');
    console.log('        giden bağlantıyla delik açma yine de çalışır.');
  }

  // 3) Tünel
  console.log('');
  console.log('[3/5] Tünel / VPN');
  const warp = await detectWarp();
  console.log(warp
    ? `   !!   Cloudflare WARP açık (warp=${warp}) — doğrudan P2P neredeyse hep düşer, TURN gerekir.`
    : '   OK   Cloudflare WARP kapalı.');

  // 4) Sinyalleşme brokerları
  console.log('');
  console.log('[4/5] Sinyalleşme brokerları (MQTT over WSS)');
  const brokers = [
    ['broker.emqx.io', 8084, '/mqtt'],
    ['broker.hivemq.com', 8884, '/mqtt'],
    ['test.mosquitto.org', 8081, '/mqtt'],
  ];
  let brokerOk = 0;
  for (const [h, p, path] of brokers) {
    const r = await wsProbe(h, p, path);
    if (r.ok) brokerOk++;
    console.log(`   ${r.ok ? 'OK  ' : 'HATA'} wss://${h}:${p}${path}${r.ok ? ` (${r.ms} ms)` : ` — ${r.error}`}`);
  }
  if (!brokerOk) {
    console.log('   !!   Hiçbir brokera ulaşılamadı: bu ağda oda/arkadaş sinyalleşmesi hiç çalışmaz.');
  }

  // 5) TURN
  console.log('');
  console.log('[5/5] TURN relay');
  const turnUrl = args.turn || process.env.TEAMSYNC_TURN_URL || '';
  const turnUser = args.user || process.env.TEAMSYNC_TURN_USER || '';
  const turnPass = args.pass || process.env.TEAMSYNC_TURN_PASS || '';
  let turnOk = false;
  if (!turnUrl || !turnUser || !turnPass) {
    console.log('   ?    TURN yapılandırılmadı.');
    console.log('        Test etmek için:');
    console.log('        npm run diag:net -- --turn turn:sunucu.com:3478 --user AD --pass SIFRE');
  } else {
    const m = /^(turns?):([^:?/]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/i.exec(turnUrl.trim());
    if (!m) {
      console.log(`   HATA TURN URL çözümlenemedi: ${turnUrl}`);
    } else {
      const host = m[2];
      const port = Number(m[3] || (m[1].toLowerCase() === 'turns' ? 5349 : 3478));
      // UDP ve TCP ayrı ayrı denenir: mobil ağlarda UDP sıkça kapalı olur ve
      // yalnızca ?transport=tcp yolu ayakta kalır.
      for (const transport of ['udp', 'tcp']) {
        const r = await turnAllocate(host, port, turnUser, turnPass, transport);
        if (r.ok) turnOk = true;
        console.log(`   ${r.ok ? 'OK  ' : 'HATA'} ${turnUrl} (${transport}) -> ${r.ok ? `relay ${r.relay}` : r.error}`);
      }
    }
  }

  // Sonuç
  console.log('');
  line();
  console.log('');
  console.log('SONUÇ');
  // CGNAT tek başına relay gerekçesi DEĞİL: taşıyıcı NAT'ların çoğu cone
  // çalışır ve delik açma kurulur. Belirleyici olan simetrik NAT ve tünel.
  const needsRelay = symmetric || !!warp;
  if (!brokerOk) {
    console.log('   !! Sinyalleşme yok: bu ağda uygulama hiç bağlanamaz (brokerlar engelli).');
  } else if (turnOk) {
    console.log('   OK TURN relay çalışıyor — mobil veri ve simetrik NAT dahil her ağda ses kurulabilir.');
  } else if (needsRelay) {
    console.log('   !! Bu ağ TURN relay olmadan çalışmaz (simetrik NAT veya tünel).');
    console.log('      Ayarlar > Bağlantılar bölümüne çalışan bir TURN sunucusu girin.');
    console.log('      Odada TEK kişinin girmesi yeterli; bilgiler diğerlerine otomatik paylaşılır.');
  } else {
    console.log('   OK Doğrudan P2P bu ağda kurulabilir.');
    console.log('   !! Ama karşı taraf mobil veride / simetrik NAT arkasındaysa TURN yine gerekir.');
  }
  console.log('');
  process.exit(brokerOk && (turnOk || !needsRelay) ? 0 : 1);
})();
