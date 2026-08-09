// Beyaz Tahta v2 — araç rayı, çizim, geçmiş ve ağ sözleşmesi.
// Ağ katmanı gerçek WebRTC yerine iki uçtan taklit edilir: giden paketler
// broadcast() sarmalanarak yakalanır, gelen paketler doğrudan
// whiteboardHandleMessage() ile uygulanır. Böylece protokolün iki yönü de
// bağlantı kurulumunun zamanlamasına bağlı olmadan doğrulanır.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor } = require('./lib/harness');

// Tuval üzerinde yüzde konumundan gerçek fare olayları üretir.
const strokeScript = points => `(() => {
  const canvas = document.getElementById('wb-canvas');
  const box = canvas.getBoundingClientRect();
  const at = (fx, fy) => ({ x: box.left + box.width * fx, y: box.top + box.height * fy });
  const fire = (type, p, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: p.x, clientY: p.y,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons
  }));
  const pts = ${JSON.stringify(points)}.map(([fx, fy]) => at(fx, fy));
  fire('pointerdown', pts[0], 1);
  for (const p of pts.slice(1)) fire('pointermove', p, 1);
  window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, clientX: pts[pts.length - 1].x, clientY: pts[pts.length - 1].y,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0
  }));
  return window.whiteboard.opCount;
})()`;

async function screenshot(peer, name) {
  const result = await peer.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const output = path.join(process.env.TEMP || os.tmpdir(), name);
  fs.writeFileSync(output, Buffer.from(result.result.data, 'base64'));
  return output;
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9422, name: 'Whiteboard Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 820, deviceScaleFactor: 1, mobile: false,
    });
    await createRoom(peer);

    // --- açılış: araç çubuğu düğmesi tahtayı açar ve odağa alır -------------
    await evalJS(peer.client, `document.getElementById('wb-btn').click(); 1`);
    await waitFor(peer.client, `!document.getElementById('wb-card').classList.contains('hidden')`, 5000, 'board open');
    await new Promise(r => setTimeout(r, 400));

    const opened = await evalJS(peer.client, `(() => {
      const card = document.getElementById('wb-card');
      const canvas = document.getElementById('wb-canvas');
      return {
        focused: card.classList.contains('focused'),
        tools: [...document.querySelectorAll('#wb-rail [data-tool]')].map(b => b.dataset.tool),
        activeTool: document.querySelector('#wb-rail [data-tool].active')?.dataset.tool,
        swatches: document.querySelectorAll('#wb-swatches .wb-swatch').length,
        canvasWidth: canvas.getBoundingClientRect().width,
        canvasHeight: canvas.getBoundingClientRect().height,
        backingWidth: canvas.width,
        paper: card.dataset.paper,
        zoom: document.getElementById('wb-zoom-level').textContent,
        undoDisabled: document.getElementById('wb-undo').disabled,
        toolbarActive: document.getElementById('wb-btn').classList.contains('wb-open'),
      };
    })()`);
    assert.strictEqual(opened.focused, true, JSON.stringify(opened, null, 2));
    assert.deepStrictEqual(opened.tools,
      ['select', 'pen', 'highlighter', 'eraser', 'line', 'arrow', 'rect', 'ellipse', 'text', 'hand'],
      JSON.stringify(opened, null, 2));
    assert.strictEqual(opened.activeTool, 'pen', JSON.stringify(opened, null, 2));
    assert.strictEqual(opened.swatches, 10, JSON.stringify(opened, null, 2));
    assert.ok(opened.canvasWidth > 300 && opened.canvasHeight > 200, JSON.stringify(opened, null, 2));
    assert.ok(opened.backingWidth >= opened.canvasWidth, JSON.stringify(opened, null, 2));
    assert.strictEqual(opened.undoDisabled, true, JSON.stringify(opened, null, 2));
    assert.strictEqual(opened.toolbarActive, true, JSON.stringify(opened, null, 2));

    // --- yerleşim: denetimler kartın içinde ve odak denetimleriyle çakışmıyor
    const layout = await evalJS(peer.client, `(() => {
      const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      return {
        card: box(document.getElementById('wb-card')),
        rail: box(document.getElementById('wb-rail')),
        chip: box(document.querySelector('#wb-card .wb-chip')),
        actions: box(document.querySelector('#wb-card .wb-actions')),
        zoom: box(document.querySelector('#wb-card .wb-zoom')),
        focusControls: box(document.getElementById('focus-controls')),
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      };
    })()`);
    const inside = (child, parent) => child.left >= parent.left - 1 && child.right <= parent.right + 1
      && child.top >= parent.top - 1 && child.bottom <= parent.bottom + 1;
    assert.ok(inside(layout.rail, layout.card), JSON.stringify(layout, null, 2));
    assert.ok(inside(layout.actions, layout.card), JSON.stringify(layout, null, 2));
    assert.ok(inside(layout.zoom, layout.card), JSON.stringify(layout, null, 2));
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    assert.ok(!overlaps(layout.zoom, layout.focusControls), JSON.stringify(layout, null, 2));
    assert.ok(!overlaps(layout.actions, layout.focusControls), JSON.stringify(layout, null, 2));
    // Ray, başlık rozetiyle ve yakınlaştırma kutusuyla üst üste binmemeli.
    assert.ok(!overlaps(layout.rail, layout.chip), JSON.stringify(layout, null, 2));
    assert.ok(!overlaps(layout.rail, layout.zoom), JSON.stringify(layout, null, 2));
    assert.ok(!overlaps(layout.rail, layout.actions), JSON.stringify(layout, null, 2));
    assert.ok(layout.card.right <= layout.viewport.width + 1, JSON.stringify(layout, null, 2));

    // --- giden paketleri yakala -------------------------------------------
    await evalJS(peer.client, `(() => {
      window.__wbSent = [];
      const original = window.broadcast;
      window.broadcast = msg => { try { window.__wbSent.push(JSON.parse(JSON.stringify(msg))); } catch (e) {} return original(msg); };
      return 1;
    })()`);

    // --- kalemle çizim ------------------------------------------------------
    const afterStroke = await evalJS(peer.client, strokeScript([[0.3, 0.4], [0.4, 0.45], [0.5, 0.5], [0.6, 0.55]]));
    assert.strictEqual(afterStroke, 1, 'kalem darbesi bir nesne bırakmalı');

    const sent = await evalJS(peer.client, `(() => {
      const types = window.__wbSent.map(m => m.type);
      const add = window.__wbSent.find(m => m.type === 'wb2-add');
      return {
        types: [...new Set(types)],
        liveCount: types.filter(t => t === 'wb2-live').length,
        addOp: add ? { t: add.ops[0].t, c: add.ops[0].c, points: add.ops[0].p.length } : null,
      };
    })()`);
    assert.ok(sent.types.includes('wb2-add'), JSON.stringify(sent, null, 2));
    assert.ok(sent.types.includes('wb2-live'), JSON.stringify(sent, null, 2));
    assert.ok(sent.types.includes('wb2-live-end'), JSON.stringify(sent, null, 2));
    assert.strictEqual(sent.addOp.t, 'pen', JSON.stringify(sent, null, 2));
    assert.strictEqual(sent.addOp.c, 'ink', JSON.stringify(sent, null, 2));
    assert.ok(sent.addOp.points >= 4, JSON.stringify(sent, null, 2));

    // --- geri al / yinele ---------------------------------------------------
    const history = await evalJS(peer.client, `(() => {
      window.__wbSent.length = 0;
      document.getElementById('wb-undo').click();
      const afterUndo = window.whiteboard.opCount;
      const undoMsg = window.__wbSent.map(m => m.type);
      document.getElementById('wb-redo').click();
      return { afterUndo, afterRedo: window.whiteboard.opCount, undoMsg,
               redoMsg: window.__wbSent.map(m => m.type) };
    })()`);
    assert.strictEqual(history.afterUndo, 0, JSON.stringify(history, null, 2));
    assert.strictEqual(history.afterRedo, 1, JSON.stringify(history, null, 2));
    assert.ok(history.undoMsg.includes('wb2-remove'), JSON.stringify(history, null, 2));
    assert.ok(history.redoMsg.includes('wb2-add'), JSON.stringify(history, null, 2));

    // --- şekil aracı ve klavye kısayolu ------------------------------------
    await evalJS(peer.client, `document.getElementById('wb-card').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyR' })); 1`);
    const rectTool = await evalJS(peer.client, `document.querySelector('#wb-rail [data-tool].active').dataset.tool`);
    assert.strictEqual(rectTool, 'rect', 'R kısayolu dikdörtgen aracına geçmeli');
    const afterRect = await evalJS(peer.client, strokeScript([[0.2, 0.2], [0.35, 0.35]]));
    assert.strictEqual(afterRect, 2, 'dikdörtgen ikinci nesneyi eklemeli');
    const rectOp = await evalJS(peer.client, `(() => {
      const op = window.whiteboard.board.ops[1];
      return { t: op.t, hasPoints: Array.isArray(op.p), sized: Math.abs(op.x1 - op.x0) > 1 };
    })()`);
    assert.deepStrictEqual(rectOp, { t: 'rect', hasPoints: false, sized: true }, JSON.stringify(rectOp, null, 2));

    // --- silgi: dokunduğu nesneyi kaldırır ---------------------------------
    await evalJS(peer.client, `window.whiteboard.setTool('eraser'); window.__wbSent.length = 0; 1`);
    const afterErase = await evalJS(peer.client, strokeScript([[0.2, 0.2], [0.28, 0.28], [0.35, 0.35]]));
    assert.strictEqual(afterErase, 1, 'silgi dikdörtgeni silmeli');
    const eraseMsg = await evalJS(peer.client, `window.__wbSent.filter(m => m.type === 'wb2-remove').length`);
    assert.ok(eraseMsg >= 1, 'silme yayınlanmalı');

    // --- başarım: kalabalık tahtada çizim sahneyi yeniden çizdirmemeli ------
    // Regresyon: v2'nin ilk hâli her karede TÜM nesneleri ve ızgara noktalarını
    // yeniden çiziyordu; birkaç yüz nesneden sonra çizim gözle görülür şekilde
    // takılıyordu. Artık kesinleşmiş nesneler önbellekli bir katmanda.
    const perf = await evalJS(peer.client, `(async () => {
      const wb = window.whiteboard;
      wb.setTool('pen');
      const bulk = [];
      // Gerçekçi bir tahta: kısa çizgiler değil, çok noktalı serbest darbeler
      // (kamera hareketinde önizleme eşiğini aşacak kadar geometri).
      for (let i = 0; i < 300; i++) {
        const p = [];
        for (let k = 0; k < 20; k++) p.push((i * 7 + k * 11) % 1800, (i * 5 + k * 17) % 900);
        bulk.push({ id: 'perf-' + i, t: 'pen', c: 'ink', w: 3, p });
      }
      window.whiteboardHandleMessage('peer-a', { type: 'wb2-add', ops: bulk });
      const frame = () => new Promise(done => requestAnimationFrame(() => done()));
      await frame(); await frame();

      const canvas = document.getElementById('wb-canvas');
      const box = canvas.getBoundingClientRect();
      const fire = (type, fx, fy, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true,
        clientX: box.left + box.width * fx, clientY: box.top + box.height * fy,
        pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons
      }));
      const paintsBefore = wb.stats.staticPaints;
      const framesBefore = wb.stats.frames;
      const started = performance.now();
      fire('pointerdown', 0.2, 0.3, 1);
      for (let i = 1; i <= 24; i++) {
        fire('pointermove', 0.2 + i * 0.02, 0.3 + Math.sin(i / 3) * 0.05, 1);
        await frame();
      }
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, clientX: box.left + box.width * 0.68, clientY: box.top + box.height * 0.3,
        pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0
      }));
      await frame();
      return {
        paints: wb.stats.staticPaints - paintsBefore,
        frames: wb.stats.frames - framesBefore,
        msPerFrame: (performance.now() - started) / Math.max(1, wb.stats.frames - framesBefore),
        opCount: wb.opCount
      };
    })()`, true);
    // Kamera hareketi: kalabalık tahtada her kare tam yeniden çizim yerine
    // ötelenmiş önbellek basılır, hareket bitince net kare gelir.
    const pan = await evalJS(peer.client, `(async () => {
      const wb = window.whiteboard;
      const frame = () => new Promise(done => requestAnimationFrame(() => done()));
      const canvas = document.getElementById('wb-canvas');
      const p0 = wb.stats.staticPaints, v0 = wb.stats.previews;
      for (let i = 0; i < 20; i++) {
        canvas.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, deltaY: -6, clientX: 700, clientY: 400
        }));
        await frame();
      }
      const during = { paints: wb.stats.staticPaints - p0, previews: wb.stats.previews - v0 };
      await new Promise(done => setTimeout(done, 320));
      return { ...during, paintsAfterSettle: wb.stats.staticPaints - p0 };
    })()`, true);
    if (require.main === module) console.log('perf:', JSON.stringify(perf), 'pan:', JSON.stringify(pan));
    assert.ok(pan.previews >= 10, JSON.stringify(pan, null, 2));
    assert.strictEqual(pan.paints, 0, JSON.stringify(pan, null, 2));
    // Hareket durunca tam çözünürlüklü kare mutlaka gelir.
    assert.ok(pan.paintsAfterSettle >= 1, JSON.stringify(pan, null, 2));

    assert.ok(perf.frames >= 12, JSON.stringify(perf, null, 2));
    // Çizim boyunca sahne en fazla bir kez (darbe kesinleşince) yeniden çizilir.
    assert.ok(perf.paints <= 2, JSON.stringify(perf, null, 2));
    // 1 (silgiden kalan) + 300 (toplu) + 1 (yeni darbe)
    assert.strictEqual(perf.opCount, 302, JSON.stringify(perf, null, 2));
    await evalJS(peer.client, `window.whiteboard.clearAll(); window.whiteboard.board.undo.length = 0; 1`);

    // --- seçme aracı: tıkla-seç, sürükle-taşı, Delete ile sil ---------------
    const select = await evalJS(peer.client, `(() => {
      const wb = window.whiteboard;
      wb.clearAll();
      const canvas = document.getElementById('wb-canvas');
      const box = canvas.getBoundingClientRect();
      const a = wb.screenToWorld(box.width * 0.45, box.height * 0.45);
      const b = wb.screenToWorld(box.width * 0.55, box.height * 0.55);
      window.whiteboardHandleMessage('peer-a', { type: 'wb2-add', ops: [
        { id: 'movable', t: 'line', c: '#3b82f6', w: 5, x0: a.x, y0: a.y, x1: b.x, y1: b.y }
      ] });
      wb.setTool('select');
      window.__wbSent.length = 0;
      const at = (fx, fy) => ({ x: box.left + box.width * fx, y: box.top + box.height * fy });
      const fire = (type, p, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: p.x, clientY: p.y,
        pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0, buttons
      }));
      const before = { ...wb.board.index.get('movable') };
      fire('pointerdown', at(0.5, 0.5), 1);
      const selected = wb.board.selection.size;
      fire('pointermove', at(0.6, 0.5), 1);
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, clientX: at(0.6, 0.5).x, clientY: at(0.6, 0.5).y,
        pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0
      }));
      const after = wb.board.index.get('movable');
      const moveMsg = window.__wbSent.find(m => m.type === 'wb2-move');
      document.getElementById('wb-card').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Delete' }));
      return {
        selected,
        dx: Math.round(after.x0 - before.x0),
        dy: Math.round(after.y0 - before.y0),
        moveIds: moveMsg ? moveMsg.ids : null,
        moveDx: moveMsg ? Math.round(moveMsg.dx) : null,
        afterDelete: wb.opCount,
        removeMsg: window.__wbSent.some(m => m.type === 'wb2-remove'),
      };
    })()`);
    assert.strictEqual(select.selected, 1, JSON.stringify(select, null, 2));
    assert.ok(select.dx > 20, JSON.stringify(select, null, 2));
    assert.strictEqual(select.dy, 0, JSON.stringify(select, null, 2));
    assert.deepStrictEqual(select.moveIds, ['movable'], JSON.stringify(select, null, 2));
    assert.strictEqual(select.moveDx, select.dx, JSON.stringify(select, null, 2));
    assert.strictEqual(select.afterDelete, 0, JSON.stringify(select, null, 2));
    assert.strictEqual(select.removeMsg, true, JSON.stringify(select, null, 2));

    // --- seçimi döndürme: tutamaçla sürükleme + [ ] kısayolları -------------
    const rotate = await evalJS(peer.client, `(() => {
      const wb = window.whiteboard;
      wb.clearAll();
      const canvas = document.getElementById('wb-canvas');
      const box = canvas.getBoundingClientRect();
      const a = wb.screenToWorld(box.width * 0.4, box.height * 0.4);
      const b = wb.screenToWorld(box.width * 0.6, box.height * 0.6);
      window.whiteboardHandleMessage('peer-a', { type: 'wb2-add', ops: [
        { id: 'rot-rect', t: 'rect', c: '#3b82f6', w: 4, x0: a.x, y0: a.y, x1: b.x, y1: b.y },
        { id: 'rot-pen', t: 'pen', c: 'ink', w: 4, p: [a.x, a.y, b.x, a.y] }
      ] });
      wb.setTool('select');
      wb.board.selection.add('rot-rect');
      wb.board.selection.add('rot-pen');
      window.__wbSent.length = 0;

      const handle = wb.rotateHandleAt();
      const bounds = wb.selectionBounds();
      const cx = (bounds.x0 + bounds.x1) / 2, cy = (bounds.y0 + bounds.y1) / 2;
      const penBefore = wb.board.index.get('rot-pen').p.slice(0, 2);
      const rectAngleBefore = wb.board.index.get('rot-rect').a || 0;

      // Tutamağı kavra ve kutunun sağ ortasına taşı: ~90° dönüş.
      const at = (sx, sy) => ({ clientX: box.left + sx, clientY: box.top + sy });
      const centerScreen = wb.worldToScreen(cx, cy);
      const fire = (type, sx, sy, buttons) => canvas.dispatchEvent(new PointerEvent(type, Object.assign({
        bubbles: true, cancelable: true, pointerId: 5, pointerType: 'mouse', isPrimary: true, button: 0, buttons
      }, at(sx, sy))));
      const grabbed = fire('pointerdown', handle.x, handle.y, 1);
      const dragMode = wb.board.selection.size;
      fire('pointermove', centerScreen.x + 120, centerScreen.y, 1);
      window.dispatchEvent(new PointerEvent('pointerup', Object.assign({
        bubbles: true, pointerId: 5, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0
      }, at(centerScreen.x + 120, centerScreen.y))));

      const rotMsg = window.__wbSent.find(m => m.type === 'wb2-rotate');
      const penAfter = wb.board.index.get('rot-pen').p.slice(0, 2);
      // Değeri KOPYALA: aşağıdaki geri almalar canlı nesneyi eski hâline
      // döndürüyor, referans tutulursa ölçüm sıfırlanmış görünüyor.
      const rectAngleAfter = wb.board.index.get('rot-rect').a || 0;
      const rectHasAngle = typeof wb.board.index.get('rot-rect').a === 'number';

      // Kısayolla 15° daha
      window.__wbSent.length = 0;
      document.getElementById('wb-card').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ']' }));
      const keyMsg = window.__wbSent.find(m => m.type === 'wb2-rotate');

      // Geri al: dönüş tersine uygulanmalı
      window.whiteboard.undo();
      window.whiteboard.undo();
      const restored = wb.board.index.get('rot-pen').p.slice(0, 2);

      return {
        grabbed, dragMode,
        broadcastAngle: rotMsg ? Math.round(rotMsg.angle * 180 / Math.PI) : null,
        rectAngle: Math.round((rectAngleAfter - rectAngleBefore) * 180 / Math.PI),
        penMoved: Math.round(Math.hypot(penAfter[0] - penBefore[0], penAfter[1] - penBefore[1])),
        keyAngle: keyMsg ? Math.round(keyMsg.angle * 180 / Math.PI) : null,
        restoredDelta: Math.round(Math.hypot(restored[0] - penBefore[0], restored[1] - penBefore[1])),
        serialized: rectHasAngle
      };
    })()`);
    assert.strictEqual(rotate.dragMode, 2, JSON.stringify(rotate, null, 2));
    // Tutamak üstten kavranıp sağa taşındı: ~90°
    assert.ok(Math.abs(rotate.broadcastAngle - 90) <= 6, JSON.stringify(rotate, null, 2));
    assert.ok(Math.abs(rotate.rectAngle - 90) <= 6, JSON.stringify(rotate, null, 2));
    assert.ok(rotate.penMoved > 5, JSON.stringify(rotate, null, 2));
    assert.strictEqual(rotate.keyAngle, 15, JSON.stringify(rotate, null, 2));
    assert.strictEqual(rotate.restoredDelta, 0, 'geri al dönüşü tam olarak geri almalı: ' + JSON.stringify(rotate, null, 2));
    assert.strictEqual(rotate.serialized, true, JSON.stringify(rotate, null, 2));

    await evalJS(peer.client, `window.whiteboard.clearAll(); window.whiteboard.setTool('pen'); window.whiteboard.board.undo.length = 0; 1`);

    // --- fotoğraf ekleme + köşeden boyutlandırma + döndürme ----------------
    const photo = await evalJS(peer.client, `(async () => {
      const wb = window.whiteboard;
      wb.clearAll();
      window.__wbSent.length = 0;
      const cv = document.createElement('canvas');
      cv.width = 400; cv.height = 260;
      const c = cv.getContext('2d');
      c.fillStyle = '#f97316'; c.fillRect(0, 0, 400, 260);
      c.fillStyle = '#6366f1'; c.fillRect(0, 0, 200, 130);
      const blob = await new Promise(done => cv.toBlob(done, 'image/png'));
      await wb.insertImageFile(new File([blob], 'test.png', { type: 'image/png' }));
      const op = wb.board.ops[wb.opCount - 1];
      const types = window.__wbSent.map(m => m.type);
      return {
        opType: op.t, hasImg: !!op.img, stored: wb.images.size,
        selected: wb.board.selection.size, tool: wb.board.tool,
        aspect: Math.round(((op.x1 - op.x0) / (op.y1 - op.y0)) * 100) / 100,
        sentBegin: types.filter(t => t === 'wb2-img-begin').length,
        sentParts: types.filter(t => t === 'wb2-img-part').length,
        sentEnd: types.filter(t => t === 'wb2-img-end').length,
        addAfterImage: types.indexOf('wb2-add') > types.indexOf('wb2-img-end'),
        // Fotoğraf verisi op'un içinde TAŞINMAMALI (sahne JSON'u şişmesin)
        opPayload: JSON.stringify(window.__wbSent.find(m => m.type === 'wb2-add').ops[0]).length
      };
    })()`, true);
    assert.strictEqual(photo.opType, 'image', JSON.stringify(photo, null, 2));
    assert.strictEqual(photo.hasImg, true, JSON.stringify(photo, null, 2));
    assert.strictEqual(photo.stored, 1, JSON.stringify(photo, null, 2));
    assert.strictEqual(photo.selected, 1, 'eklenen fotoğraf seçili gelmeli');
    assert.strictEqual(photo.tool, 'select', 'fotoğraf eklenince seçme aracına geçmeli');
    assert.ok(Math.abs(photo.aspect - 400 / 260) < 0.02, JSON.stringify(photo, null, 2));
    assert.strictEqual(photo.sentBegin, 1, JSON.stringify(photo, null, 2));
    assert.ok(photo.sentParts >= 1, JSON.stringify(photo, null, 2));
    assert.strictEqual(photo.sentEnd, 1, JSON.stringify(photo, null, 2));
    assert.strictEqual(photo.addAfterImage, true, 'veri op\'tan ÖNCE gitmeli');
    assert.ok(photo.opPayload < 400, 'fotoğraf verisi op içine gömülmemeli: ' + photo.opPayload);

    // Sağ-alt köşe tutamağını eksene doğru yarı yola çek → ~%50 küçülme
    const grip = JSON.parse(await evalJS(peer.client, `(() => {
      const wb = window.whiteboard;
      const b = wb.selectionBounds();
      const h = wb.cornerHandles()[2];
      const r = document.getElementById('wb-canvas').getBoundingClientRect();
      const anchor = wb.worldToScreen(h.ax, h.ay);
      return JSON.stringify({
        w: b.x1 - b.x0, h: b.y1 - b.y0,
        corner: { x: Math.round(r.left + h.x), y: Math.round(r.top + h.y) },
        anchor: { x: Math.round(r.left + anchor.x), y: Math.round(r.top + anchor.y) }
      });
    })()`));
    const midX = Math.round((grip.corner.x + grip.anchor.x) / 2);
    const midY = Math.round((grip.corner.y + grip.anchor.y) / 2);
    await evalJS(peer.client, `window.__wbSent.length = 0; 1`);
    await peer.client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.corner.x, y: grip.corner.y, button: 'left', clickCount: 1, buttons: 1 });
    await peer.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: midX, y: midY, button: 'left', buttons: 1 });
    await peer.client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: midX, y: midY, button: 'left', buttons: 0 });
    await new Promise(r => setTimeout(r, 250));
    const scaled = await evalJS(peer.client, `(() => {
      const wb = window.whiteboard;
      const b = wb.selectionBounds();
      const msg = window.__wbSent.find(m => m.type === 'wb2-scale');
      return { w: b.x1 - b.x0, h: b.y1 - b.y0,
               factor: msg ? Math.round(msg.factor * 100) / 100 : null,
               aspect: Math.round(((b.x1 - b.x0) / (b.y1 - b.y0)) * 100) / 100 };
    })()`);
    assert.ok(Math.abs(scaled.w / grip.w - 0.5) < 0.08, JSON.stringify({ grip, scaled }, null, 2));
    // En-boy oranı korunmalı: döndürülmüş nesnede eksen bazlı ölçek kesme üretir
    assert.ok(Math.abs(scaled.aspect - photo.aspect) < 0.05, JSON.stringify(scaled, null, 2));
    assert.ok(scaled.factor > 0.4 && scaled.factor < 0.6, JSON.stringify(scaled, null, 2));

    // Fotoğrafı döndür + geri al
    const photoRotate = await evalJS(peer.client, `(() => {
      const wb = window.whiteboard;
      wb.rotateSelection(Math.PI / 6);
      const angle = Math.round((wb.board.ops[0].a || 0) * 180 / Math.PI);
      wb.undo();
      return { angle, afterUndo: Math.round((wb.board.ops[0].a || 0) * 180 / Math.PI) };
    })()`);
    assert.strictEqual(photoRotate.angle, 30, JSON.stringify(photoRotate, null, 2));
    assert.strictEqual(photoRotate.afterUndo, 0, JSON.stringify(photoRotate, null, 2));

    // Ağdan gelen fotoğraf: parçalar birleşip yerine oturmalı
    const inboundPhoto = await evalJS(peer.client, `(async () => {
      const wb = window.whiteboard;
      const rec = wb.images.values().next().value;
      const src = rec.src;
      const chunk = 16 * 1024;
      const total = Math.ceil(src.length / chunk);
      const handle = window.whiteboardHandleMessage;
      handle('peer-a', { type: 'wb2-img-begin', id: 'remote-img', total });
      for (let i = 0; i < total; i++) {
        handle('peer-a', { type: 'wb2-img-part', id: 'remote-img', seq: i, data: src.slice(i * chunk, (i + 1) * chunk) });
      }
      handle('peer-a', { type: 'wb2-img-end', id: 'remote-img' });
      handle('peer-a', { type: 'wb2-add', ops: [
        { id: 'remote-photo', t: 'image', img: 'remote-img', c: 'ink', w: 0, x0: 40, y0: 40, x1: 240, y1: 170 }
      ] });
      await new Promise(done => setTimeout(done, 250));
      const stored = wb.images.get('remote-img');
      return { hasImage: !!stored, ready: !!(stored && stored.ready), ops: wb.opCount,
               sameData: !!stored && stored.src.length === src.length };
    })()`, true);
    assert.strictEqual(inboundPhoto.hasImage, true, JSON.stringify(inboundPhoto, null, 2));
    assert.strictEqual(inboundPhoto.ready, true, 'gelen fotoğraf çözülüp çizilebilir olmalı');
    assert.strictEqual(inboundPhoto.sameData, true, JSON.stringify(inboundPhoto, null, 2));
    assert.strictEqual(inboundPhoto.ops, 2, JSON.stringify(inboundPhoto, null, 2));

    await evalJS(peer.client, `window.whiteboard.clearAll(); window.whiteboard.setTool('pen'); window.whiteboard.board.undo.length = 0; 1`);

    // --- gelen paketler: ekleme, imleç, taşıma, temizleme -------------------
    const inbound = await evalJS(peer.client, `(() => {
      const handle = window.whiteboardHandleMessage;
      handle('peer-a', { type: 'wb2-add', ops: [
        { id: 'remote-1', t: 'pen', c: '#ef4444', w: 6, p: [100, 100, 200, 180, 320, 260] },
        { id: 'remote-2', t: 'text', c: 'ink', w: 5, x0: 400, y0: 300, x1: 400, y1: 300, s: 'Merhaba' }
      ] });
      const afterAdd = window.whiteboard.opCount;
      handle('peer-a', { type: 'wb2-cursor', x: 500, y: 400 });
      const cursors = document.querySelectorAll('#wb-layer .wb-cursor').length;
      handle('peer-a', { type: 'wb2-live', id: 'live-1', t: 'pen', c: '#3b82f6', w: 4, i: 0, p: [10, 10, 60, 60] });
      const live = window.whiteboard.board.live.size;
      handle('peer-a', { type: 'wb2-live-end', id: 'live-1' });
      const before = window.whiteboard.board.index.get('remote-1').p.slice(0, 2);
      handle('peer-a', { type: 'wb2-move', ids: ['remote-1'], dx: 40, dy: -25 });
      const after = window.whiteboard.board.index.get('remote-1').p.slice(0, 2);
      handle('peer-a', { type: 'wb2-remove', ids: ['remote-2'] });
      const afterRemove = window.whiteboard.opCount;
      // Bozuk paket tahtayı düşürmemeli, sessizce yok sayılmalı.
      handle('peer-a', { type: 'wb2-add', ops: [{ id: 'bad', t: 'zzz' }, null, { id: 'bad2', t: 'pen' }] });
      const afterGarbage = window.whiteboard.opCount;
      handle('peer-a', { type: 'draw', tool: 'pen', x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2, color: '#22c55e', size: 3 });
      const afterLegacy = window.whiteboard.opCount;
      handle('peer-a', { type: 'wb2-clear' });
      return {
        afterAdd, cursors, live, moved: [after[0] - before[0], after[1] - before[1]],
        afterRemove, afterGarbage, afterLegacy, afterClear: window.whiteboard.opCount,
        liveAfterEnd: window.whiteboard.board.live.size,
      };
    })()`);
    // Seçme adımı tahtayı boşaltmış olarak bırakır; sayımlar sıfırdan başlar.
    assert.strictEqual(inbound.afterAdd, 2, JSON.stringify(inbound, null, 2));
    assert.strictEqual(inbound.cursors, 1, JSON.stringify(inbound, null, 2));
    assert.strictEqual(inbound.live, 1, JSON.stringify(inbound, null, 2));
    assert.strictEqual(inbound.liveAfterEnd, 0, JSON.stringify(inbound, null, 2));
    assert.deepStrictEqual(inbound.moved, [40, -25], JSON.stringify(inbound, null, 2));
    assert.strictEqual(inbound.afterRemove, 1, JSON.stringify(inbound, null, 2));
    assert.strictEqual(inbound.afterGarbage, 1, JSON.stringify(inbound, null, 2));
    assert.strictEqual(inbound.afterLegacy, 2, JSON.stringify(inbound, null, 2));
    assert.strictEqual(inbound.afterClear, 0, JSON.stringify(inbound, null, 2));

    // --- geç katılana gönderilen tam durum parçalı olmalı -------------------
    const syncPackets = await evalJS(peer.client, `(() => {
      const sent = [];
      const originalTo = window.broadcastTo;
      window.broadcastTo = (peerId, msg) => { sent.push({ peerId, type: msg.type, seq: msg.seq, total: msg.total, count: msg.ops.length, paper: msg.paper }); };
      const ops = [];
      for (let i = 0; i < 130; i++) ops.push({ id: 'bulk-' + i, t: 'pen', c: 'ink', w: 3, p: [i, i, i + 10, i + 10] });
      window.whiteboardHandleMessage('peer-a', { type: 'wb2-add', ops });
      window.whiteboardSyncTo('peer-b');
      window.broadcastTo = originalTo;
      return { total: sent.length, first: sent[0], last: sent[sent.length - 1], sum: sent.reduce((n, s) => n + s.count, 0) };
    })()`);
    assert.strictEqual(syncPackets.sum, 130, JSON.stringify(syncPackets, null, 2));
    assert.strictEqual(syncPackets.total, 3, JSON.stringify(syncPackets, null, 2));
    assert.strictEqual(syncPackets.first.type, 'wb2-sync', JSON.stringify(syncPackets, null, 2));
    assert.strictEqual(syncPackets.first.paper, 'light', JSON.stringify(syncPackets, null, 2));

    // --- zemin ortak ayardır, ızgara ve yakınlaştırma yereldir --------------
    const view = await evalJS(peer.client, `(() => {
      window.__wbSent.length = 0;
      document.getElementById('wb-paper').click();
      const paper = document.getElementById('wb-card').dataset.paper;
      const paperMsg = window.__wbSent.filter(m => m.type === 'wb2-paper').length;
      document.getElementById('wb-zoom-in').click();
      const zoomed = document.getElementById('wb-zoom-level').textContent;
      document.getElementById('wb-zoom-level').click();
      const reset = document.getElementById('wb-zoom-level').textContent;
      document.getElementById('wb-grid').click();
      return { paper, paperMsg, zoomed, reset, grid: window.whiteboard.board.grid,
               zoomMsgs: window.__wbSent.filter(m => String(m.type).startsWith('wb2-zoom')).length };
    })()`);
    assert.strictEqual(view.paper, 'dark', JSON.stringify(view, null, 2));
    assert.strictEqual(view.paperMsg, 1, JSON.stringify(view, null, 2));
    assert.notStrictEqual(view.zoomed, '100%', JSON.stringify(view, null, 2));
    assert.strictEqual(view.reset, '100%', JSON.stringify(view, null, 2));
    assert.strictEqual(view.grid, false, JSON.stringify(view, null, 2));
    assert.strictEqual(view.zoomMsgs, 0, 'kamera yerel kalmalı');
    await evalJS(peer.client, `document.getElementById('wb-paper').click(); document.getElementById('wb-grid').click(); 1`);

    // --- metin aracı: GERÇEK fare + klavye ---------------------------------
    // Regresyon: sentetik PointerEvent ile bu akış geçiyordu ama gerçek
    // tıklamada tarayıcı odağı <body>'ye taşıyor, taze açılan metin kutusu
    // blur alıp kapanıyordu — yazı aracı kullanıcıda hiç çalışmıyordu.
    // Bu yüzden burada CDP Input.* ile gerçek girdi üretiliyor.
    await evalJS(peer.client, `window.whiteboard.setTool('text'); 1`);
    const textPoint = JSON.parse(await evalJS(peer.client, `(() => {
      const r = document.getElementById('wb-canvas').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5) });
    })()`));
    await peer.client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: textPoint.x, y: textPoint.y, button: 'left', clickCount: 1, buttons: 1 });
    await peer.client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: textPoint.x, y: textPoint.y, button: 'left', buttons: 0 });
    await new Promise(r => setTimeout(r, 200));
    const editorState = JSON.parse(await evalJS(peer.client, `(() => {
      const ta = document.querySelector('#wb-layer .wb-text-input');
      return JSON.stringify({ exists: !!ta, focused: ta ? document.activeElement === ta : false });
    })()`));
    assert.strictEqual(editorState.exists, true, 'gerçek tıklamada metin kutusu açılmalı');
    assert.strictEqual(editorState.focused, true, 'metin kutusu odakta kalmalı');
    await peer.client.send('Input.insertText', { text: 'Takım notu' });
    await peer.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await peer.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise(r => setTimeout(r, 250));
    const text = await evalJS(peer.client, `(() => {
      const op = window.whiteboard.board.ops[window.whiteboard.opCount - 1];
      return { created: window.whiteboard.opCount > 0,
               stillOpen: !!document.querySelector('#wb-layer .wb-text-input'),
               type: op ? op.t : null, value: op ? op.s : null,
               paper: document.getElementById('wb-card').dataset.paper };
    })()`);
    assert.strictEqual(text.created, true, JSON.stringify(text, null, 2));
    assert.strictEqual(text.stillOpen, false, JSON.stringify(text, null, 2));
    assert.strictEqual(text.type, 'text', JSON.stringify(text, null, 2));
    assert.strictEqual(text.value, 'Takım notu', JSON.stringify(text, null, 2));
    assert.strictEqual(text.paper, 'light', 'zemin açık duruma geri dönmeliydi');

    // --- PNG indirme: main süreç dosyayı gerçekten diske yazmalı -----------
    // Regresyon: uygulamada hiç 'will-download' dinleyicisi yoktu; Electron
    // görünmeyen bir kaydetme penceresi açmaya çalışıyor ve indirme sessizce
    // hiçbir yere gitmiyordu.
    await evalJS(peer.client, `document.getElementById('wb-save').click(); 1`);
    const downloadToast = JSON.parse(await waitFor(peer.client, `(() => {
      const el = document.querySelector('.toast-download');
      if (!el) return null;
      return JSON.stringify({ name: el.querySelector('.toast-file').textContent, path: el.title,
                              clickable: getComputedStyle(el).pointerEvents });
    })()`, 10000, 'download toast'));
    assert.match(downloadToast.name, /^beyaz-tahta-.*\.png$/, JSON.stringify(downloadToast, null, 2));
    assert.strictEqual(downloadToast.clickable, 'auto', JSON.stringify(downloadToast, null, 2));
    assert.ok(fs.existsSync(downloadToast.path), 'PNG diske yazılmalıydı: ' + downloadToast.path);
    assert.ok(fs.statSync(downloadToast.path).size > 1000, 'PNG boş olmamalı');
    fs.unlinkSync(downloadToast.path);   // testin İndirilenler klasörünü kirletmemesi için
    assert.strictEqual(
      await evalJS(peer.client, `typeof window.electronAPI.showInFolder`), 'function');

    const boardShot = await screenshot(peer, 'teamsync-whiteboard.png');

    // --- İngilizce arayüz: yeni araç başlıkları çevrilmeli ------------------
    const translated = await evalJS(peer.client, `(() => {
      applyUserLanguage('en');
      const title = sel => document.querySelector(sel).getAttribute('title');
      return {
        pen: title('#wb-rail [data-tool="pen"]'),
        highlighter: title('#wb-rail [data-tool="highlighter"]'),
        eraser: title('#wb-rail [data-tool="eraser"]'),
        undo: title('#wb-undo'),
        save: title('#wb-save'),
        fit: title('#wb-fit'),
        color: document.querySelector('#wb-style .wb-pop-label').textContent.trim(),
      };
    })()`);
    assert.strictEqual(translated.pen, 'Brush (P)', JSON.stringify(translated, null, 2));
    assert.strictEqual(translated.highlighter, 'Highlighter (H)', JSON.stringify(translated, null, 2));
    assert.strictEqual(translated.eraser, 'Eraser (E)', JSON.stringify(translated, null, 2));
    assert.strictEqual(translated.undo, 'Undo', JSON.stringify(translated, null, 2));
    assert.strictEqual(translated.save, 'Download PNG', JSON.stringify(translated, null, 2));
    assert.strictEqual(translated.fit, 'Fit', JSON.stringify(translated, null, 2));
    assert.strictEqual(translated.color, 'Color', JSON.stringify(translated, null, 2));
    await evalJS(peer.client, `applyUserLanguage('tr'); 1`);

    // --- küçük pencerede kart ve denetimler ekranda kalmalı -----------------
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 900, height: 620, deviceScaleFactor: 1, mobile: false,
    });
    await new Promise(r => setTimeout(r, 400));
    const small = await evalJS(peer.client, `(() => {
      const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      return {
        card: box(document.getElementById('wb-card')),
        rail: box(document.getElementById('wb-rail')),
        canvas: box(document.getElementById('wb-canvas')),
        backing: document.getElementById('wb-canvas').width,
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      };
    })()`);
    assert.ok(small.card.right <= small.viewport.width + 1, JSON.stringify(small, null, 2));
    assert.ok(small.card.bottom <= small.viewport.height + 1, JSON.stringify(small, null, 2));
    assert.ok(inside(small.rail, small.card), JSON.stringify(small, null, 2));
    // Tuval kartı doldurur; fark yalnızca kartın 1px kenarlığı kadardır.
    assert.ok(Math.abs(small.canvas.width - small.card.width) <= 4, JSON.stringify(small, null, 2));
    assert.ok(small.backing >= small.canvas.width, 'tuval yeni boyuta göre yeniden ölçeklenmeli');

    // --- kapatma: kart gizlenir, odak bırakılır -----------------------------
    await evalJS(peer.client, `document.getElementById('wb-close').click(); 1`);
    const closed = await evalJS(peer.client, `(() => ({
      hidden: document.getElementById('wb-card').classList.contains('hidden'),
      focusMode: document.querySelector('.main').classList.contains('focus-mode'),
      joined: !!window.state.wbJoined,
      toolbarActive: document.getElementById('wb-btn').classList.contains('wb-open'),
    }))()`);
    assert.strictEqual(closed.hidden, true, JSON.stringify(closed, null, 2));
    assert.strictEqual(closed.focusMode, false, JSON.stringify(closed, null, 2));
    assert.strictEqual(closed.joined, false, JSON.stringify(closed, null, 2));
    assert.strictEqual(closed.toolbarActive, false, JSON.stringify(closed, null, 2));

    if (require.main === module) console.log(boardShot);
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports()
    .then(() => console.log('PASS whiteboard'))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
