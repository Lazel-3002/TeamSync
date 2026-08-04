// Odak modunda (Etkinlik / Ekran / Tahta) sol panel ile alt çubuğun
// kaybolmadığını doğrular. Regresyon: `.app:has(> .main.focus-mode) > .sidebar
// { display:none }` + `.main.focus-mode > .bar { justify-content:flex-start }`
// yüzünden odağa girer girmez sunucudaki kişiler ve sohbet tamamen yok oluyor,
// alt çubuktaki düğmeler de ekranın soluna yapışıyordu.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
} = require('./lib/harness');

async function inspectFocusLayout(peer) {
  return evalJS(
    peer.client,
    `(() => {
       const viewport = {
         width: document.documentElement.clientWidth,
         height: document.documentElement.clientHeight,
       };
       const box = (element) => {
         if (!element) return null;
         const rect = element.getBoundingClientRect();
         const style = getComputedStyle(element);
         return {
           display: style.display,
           visibility: style.visibility,
           left: rect.left,
           top: rect.top,
           right: rect.right,
           bottom: rect.bottom,
           width: rect.width,
           height: rect.height,
           insideViewport:
             rect.left >= -0.5 &&
             rect.top >= -0.5 &&
             rect.right <= viewport.width + 0.5 &&
             rect.bottom <= viewport.height + 0.5,
         };
       };
       const bar = document.querySelector('.bar');
       const groups = Array.from(bar.querySelectorAll(':scope > .bar-group'));
       const groupRects = groups.map(g => g.getBoundingClientRect());
       const barRect = bar.getBoundingClientRect();
       const contentLeft = Math.min(...groupRects.map(r => r.left));
       const contentRight = Math.max(...groupRects.map(r => r.right));
       const controlIds = ['mic', 'deaf', 'share', 'wb-btn', 'act-btn', 'rec', 'vol', 'settings', 'leave'];
       return {
         viewport,
         focusMode: document.querySelector('.main').classList.contains('focus-mode'),
         focused: !!document.querySelector('.vcard.focused'),
         sidebar: box(document.querySelector('.sidebar')),
         users: box(document.getElementById('users')),
         chat: box(document.querySelector('.chat')),
         chatInput: box(document.getElementById('cinput')),
         topBar: box(document.querySelector('.top-bar')),
         main: box(document.querySelector('.main')),
         card: box(document.getElementById('wb-card')),
         bar: box(bar),
         barContent: {
           left: contentLeft,
           right: contentRight,
           center: (contentLeft + contentRight) / 2,
           barCenter: (barRect.left + barRect.right) / 2,
           overflowing: contentRight - contentLeft > barRect.width,
         },
         controls: controlIds.map(id => {
           const element = document.getElementById(id);
           if (!element) return { id, missing: true };
           const info = box(element);
           return { id, ...info };
         }),
       };
     })()`
  );
}

// skipIds: dar pencerede sol panel (dolayısıyla oradaki 'leave' düğmesi)
// kasten gizlendiği için o durumda listeden çıkarılır.
function unavailableControls(result, skipIds = []) {
  return result.controls.filter(control =>
    !skipIds.includes(control.id) && (
      control.missing ||
      control.display === 'none' ||
      control.visibility === 'hidden' ||
      control.width === 0 ||
      control.height === 0 ||
      !control.insideViewport
    )
  );
}

async function shot(peer, name) {
  if (require.main !== module) return;
  const screenshot = await peer.client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const screenshotPath = path.join(process.env.TEMP || os.tmpdir(), name);
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
  console.log(screenshotPath);
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9379, name: 'Focus Sidebar Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await createRoom(peer);

    const beforeFocus = await inspectFocusLayout(peer);
    assert.notStrictEqual(beforeFocus.sidebar.display, 'none', JSON.stringify(beforeFocus, null, 2));
    const sidebarWidthBefore = beforeFocus.sidebar.width;

    await evalJS(
      peer.client,
      `document.getElementById('wb-card').classList.remove('hidden');
       makeCardFocusable(document.getElementById('wb-card'));
       enterFocus(document.getElementById('wb-card'));
       1`
    );
    await new Promise(resolve => setTimeout(resolve, 300));

    const focused = await inspectFocusLayout(peer);
    const dump = JSON.stringify(focused, null, 2);
    assert.strictEqual(focused.focusMode, true, dump);
    assert.strictEqual(focused.focused, true, dump);

    // 1) Sol panel odakta da duruyor ve daralmıyor.
    assert.notStrictEqual(focused.sidebar.display, 'none', dump);
    assert.strictEqual(focused.sidebar.visibility, 'visible', dump);
    assert.strictEqual(focused.sidebar.width, sidebarWidthBefore, dump);
    assert.ok(focused.sidebar.width >= 260, dump);

    // 2) Kullanıcı listesi ve sohbet gerçekten görünür.
    for (const [label, item] of [['users', focused.users], ['chat', focused.chat], ['chatInput', focused.chatInput]]) {
      assert.notStrictEqual(item.display, 'none', label + ' gizli: ' + dump);
      assert.ok(item.width > 0 && item.height > 0, label + ' sıfır boyutlu: ' + dump);
      assert.strictEqual(item.insideViewport, true, label + ' ekran dışı: ' + dump);
    }

    // 3) Üst çubuk (SUNUCU ID / Mesajlar / Arkadaşlar) odakta kayboluyor.
    assert.notStrictEqual(focused.topBar.display, 'none', dump);
    assert.ok(focused.topBar.height > 0, dump);

    // 4) Odaklı kart panelin üstüne binmiyor ve ekran içinde.
    assert.ok(focused.card.left >= focused.sidebar.right - 1, dump);
    assert.strictEqual(focused.card.insideViewport, true, dump);
    assert.ok(focused.card.width >= 240 && focused.card.height >= 180, dump);

    // 5) Alt çubuktaki düğmeler sola yapışmıyor; hepsi tıklanabilir.
    assert.strictEqual(focused.barContent.overflowing, false, dump);
    assert.ok(
      Math.abs(focused.barContent.center - focused.barContent.barCenter) <= 24,
      'alt çubuk ortalı değil: ' + dump
    );
    assert.deepStrictEqual(unavailableControls(focused), [], dump);

    await shot(peer, 'teamsync-focus-sidebar-wide.png');

    // 6) Dar pencerede panel yine gizlenir; kart ince şeride düşmez.
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 850,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    const narrow = await inspectFocusLayout(peer);
    const narrowDump = JSON.stringify(narrow, null, 2);
    assert.strictEqual(narrow.sidebar.display, 'none', narrowDump);
    assert.ok(narrow.card.width >= 240 && narrow.card.height >= 180, narrowDump);
    assert.strictEqual(narrow.card.insideViewport, true, narrowDump);
    assert.deepStrictEqual(unavailableControls(narrow, ['leave']), [], narrowDump);

    await shot(peer, 'teamsync-focus-sidebar-narrow.png');

    // 7) Odaktan çıkınca panel yine yerinde.
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evalJS(peer.client, `exitFocus(); 1`);
    await new Promise(resolve => setTimeout(resolve, 300));
    const afterFocus = await inspectFocusLayout(peer);
    assert.strictEqual(afterFocus.focusMode, false, JSON.stringify(afterFocus, null, 2));
    assert.strictEqual(afterFocus.sidebar.width, sidebarWidthBefore, JSON.stringify(afterFocus, null, 2));
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
