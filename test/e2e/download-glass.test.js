const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, getPageTarget, cdp, evalJS, waitFor } = require('./lib/harness');

async function inspectButton(hardwareAcceleration, port) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsync-download-glass-'));
  fs.writeFileSync(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ hardwareAcceleration }),
    'utf8'
  );

  const proc = launch(port, userDataDir);
  let client;
  try {
    const page = await getPageTarget(port);
    client = cdp(page.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await waitFor(client, `document.readyState === 'complete'`, 15000, 'page load');
    await waitFor(
      client,
      `document.body.classList.contains('no-hw-accel') === ${!hardwareAcceleration}`,
      5000,
      'effective hardware acceleration class'
    );

    await evalJS(client, `
      (() => {
        const host = document.createElement('div');
        host.id = 'download-glass-probe';
        host.className = 'img-wrap';
        host.style.cssText = 'position:fixed;left:40px;top:40px;width:220px;height:160px;z-index:99999;background:linear-gradient(135deg,#22d3ee,#6366f1,#ec4899)';
        host.innerHTML = '<div class="chat-img" style="width:220px;height:160px"></div><a class="dl-btn" href="data:text/plain,teamsync" download="teamsync.txt" aria-label="Download"><svg viewBox="0 0 24 24"><path d="M12 3v12"></path></svg></a>';
        const button = host.querySelector('.dl-btn');
        button.addEventListener('click', event => {
          event.preventDefault();
          window.__downloadGlassClicked = true;
        });
        document.body.appendChild(host);
      })()
    `);

    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 235, y: 65 });
    await new Promise(resolve => setTimeout(resolve, 350));

    const result = await evalJS(client, `
      (() => {
        const button = document.querySelector('#download-glass-probe .dl-btn');
        const wrapper = document.getElementById('download-glass-probe');
        const style = getComputedStyle(button);
        const wrapperStyle = getComputedStyle(wrapper);
        button.click();
        return {
          bodyFallback: document.body.classList.contains('no-hw-accel'),
          width: style.width,
          height: style.height,
          radius: style.borderRadius,
          background: style.backgroundColor,
          backdrop: style.backdropFilter || style.webkitBackdropFilter,
          opacity: style.opacity,
          cursor: style.cursor,
          wrapperRadius: wrapperStyle.borderRadius,
          wrapperOverflow: wrapperStyle.overflow,
          clicked: window.__downloadGlassClicked === true
        };
      })()
    `);

    return result;
  } finally {
    try { if (client) client.ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }
}

module.exports = async function downloadGlassTest() {
  const accelerated = await inspectButton(true, 9341);
  assert.strictEqual(accelerated.bodyFallback, false);
  assert.strictEqual(accelerated.width, '34px');
  assert.strictEqual(accelerated.height, '34px');
  assert.strictEqual(accelerated.radius, '11px');
  assert.strictEqual(accelerated.wrapperRadius, '10px');
  assert.strictEqual(accelerated.wrapperOverflow, 'hidden');
  assert.strictEqual(accelerated.cursor, 'pointer');
  assert.notStrictEqual(accelerated.backdrop, 'none');
  assert.strictEqual(accelerated.opacity, '1');
  assert.strictEqual(accelerated.clicked, true);

  const fallback = await inspectButton(false, 9342);
  assert.strictEqual(fallback.bodyFallback, true);
  assert.strictEqual(fallback.width, '34px');
  assert.strictEqual(fallback.height, '34px');
  assert.strictEqual(fallback.radius, '11px');
  assert.strictEqual(fallback.backdrop, 'none');
  assert.match(fallback.background, /^rgba?\(38, 46, 66(?:, 0\.9)?\)$/);
  assert.strictEqual(fallback.opacity, '1');
  assert.strictEqual(fallback.clicked, true);
};
