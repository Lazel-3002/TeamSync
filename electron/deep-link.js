// teamsync:// bağlantıları (sunucu davetleri): Windows protokol kaydı,
// çalışan örneğe iletim ve renderer'a teslim.
//
// Uygulama birden çok örneğe izin verir (her ikinci örnek ayrı bir
// userData ile açılır, bkz. main.js kilit dosyası). Tarayıcıda / başka bir
// uygulamada tıklanan davet bağlantısı Windows'ta yeni bir örnek başlatır:
// o örnek bağlantıyı adlandırılmış kanal (named pipe) üzerinden çalışan
// örneğe iletip kapanır; çalışan örnek yoksa bağlantıyı kendisi açar.
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PROTOCOL = 'teamsync';
const LINK_RE = /^teamsync:\/\/invite\/[A-HJ-NP-Z2-9]{5}-?[A-HJ-NP-Z2-9]{5}\/?$/i;

function pipePath() {
  let user = 'user';
  try { user = os.userInfo().username || 'user'; } catch (e) {}
  user = user.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\teamsync-links-${user}`
    : path.join(os.tmpdir(), `teamsync-links-${user}.sock`);
}

function normalize(link) {
  const s = String(link || '').trim();
  return LINK_RE.test(s) ? s.replace(/\/$/, '') : null;
}

function linkFromArgv(argv) {
  for (const a of argv || []) {
    if (typeof a === 'string' && a.toLowerCase().startsWith(`${PROTOCOL}://`)) return normalize(a);
  }
  return null;
}

// İkinci örnek: bağlantıyı çalışan örneğe iletir. true → iletildi.
function forwardToPrimary(link, timeoutMs = 1500) {
  return new Promise(resolve => {
    let connected = false;
    let settled = false;
    const finish = ok => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
    const sock = net.connect(pipePath());
    const timer = setTimeout(() => { try { sock.destroy(); } catch (e) {} finish(false); }, timeoutMs);
    sock.on('connect', () => { connected = true; sock.end(`${link}\n`); });
    sock.on('close', () => finish(connected));
    sock.on('error', () => finish(false));
  });
}

// Çalışan örnek: diğer örneklerden gelen bağlantıları dinler.
function listen(onLink) {
  const p = pipePath();
  if (process.platform !== 'win32') { try { fs.unlinkSync(p); } catch (e) {} }
  const server = net.createServer(sock => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', d => { buf += d; if (buf.length > 256) sock.destroy(); });
    sock.on('end', () => { const link = normalize(buf); if (link) onLink(link); });
    sock.on('error', () => {});
  });
  server.on('error', () => {}); // başka bir örnek zaten dinliyorsa sessizce vazgeç
  try { server.listen(p); } catch (e) {}
  return server;
}

// Windows'a "teamsync:// bağlantılarını bu uygulama açar" kaydı (HKCU).
// Paketli sürümde kurulum da kaydeder; geliştirme sürümünde (npm start) de
// kaydedilir ki davetler denenebilsin. E2E testleri kayıt yapmaz.
function register(app) {
  if (process.env.TEAMSYNC_E2E_OFFLINE === '1') return false;
  try {
    if (app.isPackaged) return app.setAsDefaultProtocolClient(PROTOCOL);
    return app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
  } catch (e) { return false; }
}

module.exports = { PROTOCOL, linkFromArgv, forwardToPrimary, listen, register, normalize };
