// Shared CDP driving helpers for the E2E regression suite. Launches real
// Electron instances with fake media devices and drives them over the
// Chrome DevTools Protocol using only Node's built-in fetch/WebSocket.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_DIR = path.join(__dirname, '..', '..', '..');
const ELECTRON_BIN = require('electron');

function launch(port, userDataDir) {
  const args = [
    APP_DIR,
    `--remote-debugging-port=${port}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--user-data-dir=${userDataDir}`,
  ];
  return spawn(ELECTRON_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function getPageTarget(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('no page target on port ' + port);
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  async function send(method, params = {}) {
    await ready;
    const thisId = ++id;
    return new Promise((resolve) => {
      pending.set(thisId, resolve);
      ws.send(JSON.stringify({ id: thisId, method, params }));
    });
  }
  return { send, ready, ws };
}

async function evalJS(client, expression, awaitPromise = false) {
  const res = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (res.result && res.result.exceptionDetails) {
    throw new Error('Eval error: ' + JSON.stringify(res.result.exceptionDetails));
  }
  return res.result && res.result.result ? res.result.result.value : undefined;
}

async function waitFor(client, expression, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = await evalJS(client, expression); if (v) return v; } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('waitFor timeout: ' + label);
}

async function clickWhenReady(client, elemId, timeoutMs = 10000) {
  await waitFor(client, `!!document.getElementById(${JSON.stringify(elemId)})`, timeoutMs, elemId);
  await evalJS(client, `document.getElementById(${JSON.stringify(elemId)}).click(); 1`);
}

async function setValueWhenReady(client, elemId, value, timeoutMs = 10000) {
  await waitFor(client, `!!document.getElementById(${JSON.stringify(elemId)})`, timeoutMs, elemId);
  await evalJS(client, `document.getElementById(${JSON.stringify(elemId)}).value = ${JSON.stringify(value)}; 1`);
}

// Launches one Electron instance in a fresh profile and drives it through
// the name step, as a brand-new (never-logged-in) user would experience it.
async function spawnPeer({ port, name }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanka-e2e-'));
  const proc = launch(port, userDataDir);
  const page = await getPageTarget(port);
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Runtime.enable');

  await waitFor(client, `document.readyState === 'complete'`, 15000, 'page load');
  // Let the async DOMContentLoaded setup (getLocalIPs await, listener binding) finish.
  await new Promise(r => setTimeout(r, 2500));
  await setValueWhenReady(client, 'name', name, 15000);
  await clickWhenReady(client, 'btn-next-name', 5000);
  await new Promise(r => setTimeout(r, 500));

  return { client, proc, userDataDir, port, name };
}

function cleanupPeer(peer) {
  try { peer.proc.kill(); } catch (e) {}
  try { fs.rmSync(peer.userDataDir, { recursive: true, force: true }); } catch (e) {}
}

async function createRoom(peer) {
  await clickWhenReady(peer.client, 'btn-show-create', 5000);
  await new Promise(r => setTimeout(r, 300));
  await clickWhenReady(peer.client, 'btn-create', 5000);
  return waitFor(
    peer.client,
    `(document.getElementById('app') && !document.getElementById('app').classList.contains('hidden')) ? (window.state && window.state.room) : null`,
    20000,
    'room created'
  );
}

async function joinRoom(peer, roomId) {
  await clickWhenReady(peer.client, 'btn-show-join', 5000);
  await new Promise(r => setTimeout(r, 300));
  await setValueWhenReady(peer.client, 'join-id', roomId, 5000);
  await clickWhenReady(peer.client, 'btn-join', 5000);
}

async function waitForPeerConnected(peer, timeoutMs = 40000) {
  return waitFor(
    peer.client,
    `(window.state && window.state.peers && Array.from(window.state.peers.values()).some(p => p.pc && (p.pc.iceConnectionState === 'connected' || p.pc.iceConnectionState === 'completed'))) ? 'yes' : null`,
    timeoutMs,
    'peer connected'
  );
}

module.exports = {
  APP_DIR, launch, getPageTarget, cdp, evalJS, waitFor, clickWhenReady, setValueWhenReady,
  spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected,
};
