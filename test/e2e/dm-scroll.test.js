// Regression guard: a long friend conversation must stay inside the DM panel,
// remain manually scrollable, and return to the latest message after rendering.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, getPageTarget, cdp, evalJS, waitFor } = require('./lib/harness');

module.exports = async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsync-dm-scroll-'));
  const proc = launch(9310, userDataDir);

  try {
    const page = await getPageTarget(9310);
    const client = cdp(page.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Runtime.enable');
    await waitFor(client, `document.readyState === 'complete' && typeof window.renderDMs === 'function'`, 15000, 'DM UI ready');

    const metrics = await evalJS(client, `(() => {
      const friendId = 'scroll-test-friend';
      const step = document.getElementById('step-action');
      document.querySelectorAll('#login .login-card > div').forEach(el => el.classList.add('hidden'));
      document.getElementById('login').classList.remove('hidden');
      document.querySelector('.login-card').classList.add('expanded', 'dm-open');
      step.classList.remove('hidden');
      step.classList.add('dm-open');

      window.state.friends[friendId] = { name: 'Kaydırma Testi', online: true };
      window.state.activeDM = friendId;
      window.state.dms[friendId] = Array.from({ length: 80 }, (_, i) => ({
        sender: i % 2 ? 'me' : 'them',
        type: 'text',
        content: 'Test mesajı ' + (i + 1) + ' — uzun konuşma içeriği',
        timestamp: Date.now() + i
      }));
      window.renderDMs();

      const main = document.getElementById('dm-messages');
      const mainPanel = document.querySelector('.menu-right');
      const mainInput = mainPanel.querySelector('.dm-input-area');
      const initialMain = {
        scrollable: main.scrollHeight > main.clientHeight,
        atBottom: Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop) <= 2,
        overflowY: getComputedStyle(main).overflowY,
        inputContained: mainInput.getBoundingClientRect().bottom <= mainPanel.getBoundingClientRect().bottom + 1
      };

      main.scrollTop = 0;
      const manuallyScrolled = main.scrollTop === 0;
      window.state.dms[friendId].push({ sender: 'me', type: 'text', content: 'Yeni gönderilen mesaj' });
      window.renderDMs();
      const returnedToBottom = Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop) <= 2;

      const serverModal = document.getElementById('server-dm-modal');
      serverModal.classList.remove('hidden');
      document.getElementById('server-dm-input-area').style.display = 'flex';
      window.renderDMs();
      const server = document.getElementById('server-dm-messages');
      const serverPanel = server.parentElement;
      const serverInput = document.getElementById('server-dm-input-area');
      const serverMetrics = {
        scrollable: server.scrollHeight > server.clientHeight,
        atBottom: Math.abs(server.scrollHeight - server.clientHeight - server.scrollTop) <= 2,
        overflowY: getComputedStyle(server).overflowY,
        inputContained: serverInput.getBoundingClientRect().bottom <= serverPanel.getBoundingClientRect().bottom + 1
      };

      return { initialMain, manuallyScrolled, returnedToBottom, serverMetrics };
    })()`);

    const failures = [];
    if (!metrics.initialMain.scrollable) failures.push('ana DM mesaj listesi taşınca kaydırılabilir olmadı');
    if (metrics.initialMain.overflowY !== 'auto') failures.push('ana DM overflow-y auto değil');
    if (!metrics.initialMain.atBottom) failures.push('ana DM ilk çizimde son mesaja kaymadı');
    if (!metrics.initialMain.inputContained) failures.push('ana DM giriş alanı panel dışına taştı');
    if (!metrics.manuallyScrolled) failures.push('ana DM elle yukarı kaydırılamadı');
    if (!metrics.returnedToBottom) failures.push('yeni mesaj çizildikten sonra ana DM sona kaymadı');
    if (!metrics.serverMetrics.scrollable) failures.push('sunucu DM mesaj listesi taşınca kaydırılabilir olmadı');
    if (metrics.serverMetrics.overflowY !== 'auto') failures.push('sunucu DM overflow-y auto değil');
    if (!metrics.serverMetrics.atBottom) failures.push('sunucu DM son mesaja kaymadı');
    if (!metrics.serverMetrics.inputContained) failures.push('sunucu DM giriş alanı panel dışına taştı');

    if (failures.length) {
      throw new Error(failures.join('; ') + ' | metrics=' + JSON.stringify(metrics));
    }
  } finally {
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }
};
