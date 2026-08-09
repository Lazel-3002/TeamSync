/* ===========================================================================
 * BEYAZ TAHTA (v2) — vektör tabanlı, sonsuz tuval, çok kullanıcılı
 * ---------------------------------------------------------------------------
 * Eski tahta 1920x1080 sabit bir raster tuvaldi: her fare hareketi ayrı bir
 * "draw" paketi olarak gidiyor, geç katılan JPEG ekran görüntüsü alıyor,
 * geri alma / silme / taşıma hiç yoktu ve tuval kart küçüldüğünde CSS ile
 * scale(0.3) yapılıp bozuluyordu.
 *
 * v2 tamamen NESNE tabanlıdır: tahta bir "op" (çizim nesnesi) listesidir.
 *   - Geri al / yinele, nesne silgisi, seçip taşıma ve PNG dışa aktarma
 *     doğrudan bu listeden çıkar.
 *   - Geç katılan kişiye JPEG değil, listenin kendisi parça parça gönderilir
 *     (wb2-sync); nesneler id'li olduğu için birleştirme fikir birliği
 *     gerektirmez, aynı op iki kez gelse de bir kez uygulanır.
 *   - Kamera (pan/zoom) tamamen yereldir; herkes aynı dünyaya farklı
 *     yerlerden bakabilir.
 *
 * Ağ sözleşmesi (hepsi renderer.js -> whiteboardHandleMessage üzerinden):
 *   wb2-hello                       tahtayı açtım, durumu olan biri bana yollasın
 *   wb2-sync   {seq,total,ops,paper} tam durum (parçalı)
 *   wb2-add    {ops}                yeni nesne(ler)
 *   wb2-remove {ids}                nesne sil
 *   wb2-move   {ids,dx,dy}          nesne taşı
 *   wb2-clear  {}                   tahtayı temizle
 *   wb2-live   {id,t,c,w,i,p|x0..}  çizim SÜRERKEN canlı önizleme
 *   wb2-live-end {id}               önizlemeyi düşür
 *   wb2-paper  {mode}               zemin (açık/koyu) — ortak ayar
 *   wb2-cursor {x,y}                imleç konumu (dünya koordinatı)
 * Eski sürümden gelen draw / wb-clear / wb-sync paketleri de okunur; karışık
 * sürümlü odada eski istemcinin çizimi kaybolmaz.
 * ========================================================================= */
(function () {
  'use strict';

  // Açılış çerçevesi: eski tahtanın alanı. Tuval sonsuzdur, bu yalnızca ilk
  // kameranın neyi kadrajladığıdır.
  const WORLD = { w: 1920, h: 1080 };

  // Zemin rengi CSS'te de tanımlıdır (--wb-paper); buradaki kopya PNG dışa
  // aktarımı ve 'ink' renginin çözümlenmesi için gerekli.
  const PAPER = {
    light: { bg: '#ffffff', ink: '#0f172a' },
    dark: { bg: '#141922', ink: '#f1f5f9' }
  };

  // 'ink' özel bir renk jetonudur: zemine göre siyah/beyaza çözülür, böylece
  // varsayılan kalem her iki zeminde de okunur kalır.
  const SWATCHES = ['ink', '#ef4444', '#f97316', '#f59e0b', '#22c55e',
    '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];

  const MIN_SCALE = 0.08;
  const MAX_SCALE = 8;
  const SYNC_CHUNK = 60;        // tek pakette gönderilen nesne sayısı
  const LIVE_INTERVAL = 45;     // canlı önizleme paket aralığı (ms)
  const CURSOR_INTERVAL = 70;
  const CURSOR_TTL = 5000;
  const MAX_OPS = 6000;         // kötü niyetli/kaçak senkrona karşı üst sınır
  const MAX_POINTS = 20000;
  const STROKE_SPLIT = 1500;    // bu nokta sayısından sonra darbe bölünür
  const MAX_TEXT = 2000;
  // Kamera hareket ederken bu kadar parçadan sonrası önizleme (ötelenmiş
  // önbellek) ile çizilir; altında her kare tam çözünürlükte kalır.
  const PREVIEW_COST = 4000;
  const ROTATE_HANDLE_GAP = 26;   // seçim kutusunun üstünden ekran pikseli
  const ROTATE_HANDLE_R = 9;
  const ROTATE_SNAP = Math.PI / 12; // Shift ile 15° adımlar
  const CORNER_R = 5;               // köşe tutamağının yarı boyu (ekran px)
  const MAX_IMAGE_DIM = 1200;       // eklenen fotoğrafın uzun kenar sınırı
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const IMG_CHUNK = 16 * 1024;      // veri kanalı paketi sınırının çok altında

  const SHAPE_TOOLS = new Set(['line', 'arrow', 'rect', 'ellipse']);
  const TOOL_KEYS = {
    KeyV: 'select', KeyP: 'pen', KeyH: 'highlighter', KeyE: 'eraser',
    KeyL: 'line', KeyA: 'arrow', KeyR: 'rect', KeyO: 'ellipse', KeyT: 'text'
  };

  const board = {
    ops: [],
    index: new Map(),          // id -> op
    live: new Map(),           // id -> devam eden uzak çizim
    cursors: new Map(),        // peerId -> {x, y, ts, el, name}
    selection: new Set(),
    erasing: new Set(),        // silgi sürüklenirken işaretlenenler
    undo: [],
    redo: [],
    cam: { x: 0, y: 0, scale: 1 },
    tool: 'pen',
    color: 'ink',
    size: 4,
    paper: 'light',
    grid: true,
    version: 0
  };

  const els = {};
  const bboxCache = new WeakMap();
  const localBoxCache = new WeakMap();
  // Fotoğraflar op'un İÇİNDE taşınmaz (sahne JSON'u şişerdi): op yalnızca
  // kimliği tutar, veri ayrı ve parçalı gider. id -> { src, el, ready }
  const images = new Map();
  const imageParts = new Map();   // gelen parçalar toplanırken
  let ctx = null;
  let dpr = 1;
  let viewW = 0;
  let viewH = 0;
  let renderQueued = false;
  let inited = false;
  let draft = null;            // yerel, henüz işlenmemiş çizim
  let drag = null;
  let editor = null;           // açık metin kutusu
  let spaceDown = false;
  let shiftDown = false;
  let lastLiveSent = 0;
  let liveSentCount = 0;
  let lastCursorSent = 0;
  let boundsCache = null;
  let boundsVersion = -1;
  let autoFit = true;          // küçük önizlemede içeriği kadraja sığdır
  let staticCanvas = null;     // kesinleşmiş nesnelerin önbelleği
  let staticCtx = null;
  let staticKey = '';
  let staticVersion = 0;       // önbelleği geçersiz kılan her şey bunu artırır
  let staticCam = null;        // önbellek hangi kamerayla çizildi
  let staticPaintVersion = -1;
  let staticPaintMs = 0;       // tam yeniden çizimin ortalama JS maliyeti (tanılama)
  let staticCost = 0;          // son çizimde işlenen görünür parça sayısı
  let rotationHinted = false;  // döndürme ipucu bu oturumda gösterildi mi
  let camBusy = false;         // kamera şu an hareket ediyor mu
  let camBusyTimer = null;
  let gridStyleKey = '';
  let canvasRect = null;       // pointer olaylarında yeniden ölçüm yapmamak için
  // Kare ve önbellek sayaçları: E2E testi "çizim sırasında sahne yeniden
  // çizilmiyor" güvencesini bunlardan doğruluyor.
  const stats = { frames: 0, staticPaints: 0, previews: 0, get paintMs() { return staticPaintMs; }, get busy() { return camBusy; } };

  /* ------------------------------ yardımcılar ---------------------------- */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  // renderer.js'teki `let focusedCard` sözcüksel global; script sırası
  // değişirse diye erişimi korumaya alıyoruz.
  function focusedCardEl() {
    try { return typeof focusedCard === 'undefined' ? null : focusedCard; } catch (e) { return null; }
  }
  function call(name, ...args) {
    try {
      const fn = window[name] || (typeof globalThis[name] === 'function' ? globalThis[name] : null);
      if (typeof fn === 'function') return fn(...args);
    } catch (e) {}
    return undefined;
  }
  function net(msg) {
    try { if (typeof broadcast === 'function') broadcast(msg); } catch (e) {}
  }
  function netTo(peerId, msg) {
    try { if (typeof broadcastTo === 'function') broadcastTo(peerId, msg); } catch (e) {}
  }
  function paperTheme() { return PAPER[board.paper] || PAPER.light; }
  function resolveColor(c) { return c === 'ink' ? paperTheme().ink : c; }
  function fontOf(op) { return Math.max(12, op.w * 6); }

  /* ------------------------------ koordinat ------------------------------ */

  function screenToWorld(px, py) {
    return { x: board.cam.x + px / board.cam.scale, y: board.cam.y + py / board.cam.scale };
  }
  function worldToScreen(wx, wy) {
    return { x: (wx - board.cam.x) * board.cam.scale, y: (wy - board.cam.y) * board.cam.scale };
  }
  // Kutu ölçümü sürükleme boyunca önbelleklenir: her pointermove'da
  // getBoundingClientRect çağırmak yerleşimi yeniden hesaplatabiliyor.
  function canvasBox() {
    if (!canvasRect) canvasRect = els.canvas.getBoundingClientRect();
    return canvasRect;
  }
  function pointerWorld(e) {
    const rect = canvasBox();
    return screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  /* ------------------------------- sınırlar ------------------------------ */

  // Nesnenin KENDİ ekseninde (döndürülmemiş) kutusu. Vuruş testi ve döndürülmüş
  // AABB hesabı bunu paylaşır.
  function localBox(op) {
    let bb = localBoxCache.get(op);
    if (!bb) {
      bb = computeLocalBox(op);
      localBoxCache.set(op, bb);
    }
    return bb;
  }

  function bboxOf(op) {
    let bb = bboxCache.get(op);
    if (bb) return bb;
    bb = rotateBox(op, localBox(op));
    bboxCache.set(op, bb);
    return bb;
  }

  function computeLocalBox(op) {
    let bb;
    if (op.t === 'pen' || op.t === 'highlighter') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < op.p.length; i += 2) {
        if (op.p[i] < x0) x0 = op.p[i];
        if (op.p[i] > x1) x1 = op.p[i];
        if (op.p[i + 1] < y0) y0 = op.p[i + 1];
        if (op.p[i + 1] > y1) y1 = op.p[i + 1];
      }
      const pad = strokeWidth(op) / 2 + 2;
      bb = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    } else if (op.t === 'text') {
      const f = fontOf(op);
      const lines = String(op.s || '').split('\n');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = `${f}px Inter, system-ui, sans-serif`;
      let w = 0;
      lines.forEach(line => { w = Math.max(w, ctx.measureText(line).width); });
      ctx.restore();
      bb = { x0: op.x0 - 2, y0: op.y0 - 2, x1: op.x0 + w + 4, y1: op.y0 + lines.length * f * 1.28 + 4 };
    } else {
      const pad = op.t === 'image' ? 0 : strokeWidth(op) / 2 + (op.t === 'arrow' ? strokeWidth(op) * 2 : 0) + 2;
      bb = {
        x0: Math.min(op.x0, op.x1) - pad, y0: Math.min(op.y0, op.y1) - pad,
        x1: Math.max(op.x0, op.x1) + pad, y1: Math.max(op.y0, op.y1) + pad
      };
    }
    return bb;
  }
  const strokeWidth = op => (op.t === 'image' ? 0 : op.w * (op.t === 'highlighter' ? 4 : 1));
  const invalidate = op => { bboxCache.delete(op); localBoxCache.delete(op); };

  // Döndürme: kalem/çizgi/ok noktaları DOĞRUDAN döndürülür (geometri zaten
  // noktalardan ibaret). Dikdörtgen, elips ve yazı ise eksenle hizalı
  // saklandığı için kendi açısını (op.a) taşır: çizim, sınır kutusu ve vuruş
  // testi bu açıyı kendi ekseni etrafında uygular.
  function rotatePoint(x, y, cx, cy, sin, cos) {
    const dx = x - cx, dy = y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }
  // Nesnenin kendi dönme ekseni: yazıda tutturma noktası, diğerlerinde merkez.
  function opPivot(op) {
    if (op.t === 'text') return { x: op.x0, y: op.y0 };
    return { x: (op.x0 + op.x1) / 2, y: (op.y0 + op.y1) / 2 };
  }
  // Eksenle hizalı kutuyu nesnenin açısıyla döndürüp yeni AABB'sini verir.
  function rotateBox(op, bb) {
    if (!op.a) return bb;
    const p = opPivot(op);
    const sin = Math.sin(op.a), cos = Math.cos(op.a);
    return rotatedAABB([
      rotatePoint(bb.x0, bb.y0, p.x, p.y, sin, cos),
      rotatePoint(bb.x1, bb.y0, p.x, p.y, sin, cos),
      rotatePoint(bb.x1, bb.y1, p.x, p.y, sin, cos),
      rotatePoint(bb.x0, bb.y1, p.x, p.y, sin, cos)
    ]);
  }

  function rotatedAABB(corners) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of corners) {
      if (c.x < x0) x0 = c.x;
      if (c.x > x1) x1 = c.x;
      if (c.y < y0) y0 = c.y;
      if (c.y > y1) y1 = c.y;
    }
    return { x0, y0, x1, y1 };
  }

  function contentBounds() {
    if (boundsVersion === board.version && boundsCache) return boundsCache;
    let b = null;
    for (const op of board.ops) {
      const bb = bboxOf(op);
      if (!b) b = { x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1 };
      else {
        b.x0 = Math.min(b.x0, bb.x0); b.y0 = Math.min(b.y0, bb.y0);
        b.x1 = Math.max(b.x1, bb.x1); b.y1 = Math.max(b.y1, bb.y1);
      }
    }
    if (!b) b = { x0: 0, y0: 0, x1: WORLD.w, y1: WORLD.h };
    boundsCache = b;
    boundsVersion = board.version;
    return b;
  }

  /* -------------------------------- çizim -------------------------------- */

  function strokePath(c, p, width) {
    if (p.length < 4) {
      c.beginPath();
      c.arc(p[0], p[1], Math.max(width / 2, 0.4), 0, Math.PI * 2);
      c.fill();
      return;
    }
    c.beginPath();
    c.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) {
      c.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    }
    c.lineTo(p[p.length - 2], p[p.length - 1]);
    c.stroke();
  }

  function drawArrow(c, op) {
    const head = Math.max(op.w * 3.4, 9);
    const ang = Math.atan2(op.y1 - op.y0, op.x1 - op.x0);
    const len = Math.hypot(op.x1 - op.x0, op.y1 - op.y0);
    const bodyLen = Math.max(len - head * 0.8, 0);
    const bx = op.x0 + Math.cos(ang) * bodyLen;
    const by = op.y0 + Math.sin(ang) * bodyLen;
    c.beginPath();
    c.moveTo(op.x0, op.y0);
    c.lineTo(bx, by);
    c.stroke();
    c.beginPath();
    c.moveTo(op.x1, op.y1);
    c.lineTo(op.x1 - Math.cos(ang - 0.42) * head, op.y1 - Math.sin(ang - 0.42) * head);
    c.lineTo(op.x1 - Math.cos(ang + 0.42) * head, op.y1 - Math.sin(ang + 0.42) * head);
    c.closePath();
    c.fill();
  }

  function drawOp(c, op, alpha) {
    const color = resolveColor(op.c);
    c.save();
    c.globalAlpha = alpha * (op.t === 'highlighter' ? 0.34 : 1);
    if (op.t === 'highlighter') {
      c.globalCompositeOperation = board.paper === 'dark' ? 'screen' : 'multiply';
    }
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = strokeWidth(op);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // Açılı nesnelerde geometriyi değil TUVALİ döndürüyoruz; koordinatlar
    // eksenle hizalı kalır, çizim/vuruş/sınır kodu tek bir modeli paylaşır.
    if (op.a) {
      const p = opPivot(op);
      c.translate(p.x, p.y);
      c.rotate(op.a);
      c.translate(-p.x, -p.y);
    }
    if (op.t === 'pen' || op.t === 'highlighter') {
      if (op.p.length >= 2) strokePath(c, op.p, c.lineWidth);
    } else if (op.t === 'line') {
      c.beginPath(); c.moveTo(op.x0, op.y0); c.lineTo(op.x1, op.y1); c.stroke();
    } else if (op.t === 'arrow') {
      drawArrow(c, op);
    } else if (op.t === 'rect') {
      const x = Math.min(op.x0, op.x1), y = Math.min(op.y0, op.y1);
      const w = Math.abs(op.x1 - op.x0), h = Math.abs(op.y1 - op.y0);
      const r = Math.min(10, w / 4, h / 4);
      c.beginPath();
      if (typeof c.roundRect === 'function' && r > 0.5) c.roundRect(x, y, w, h, r);
      else c.rect(x, y, w, h);
      c.stroke();
    } else if (op.t === 'ellipse') {
      c.beginPath();
      c.ellipse((op.x0 + op.x1) / 2, (op.y0 + op.y1) / 2,
        Math.abs(op.x1 - op.x0) / 2, Math.abs(op.y1 - op.y0) / 2, 0, 0, Math.PI * 2);
      c.stroke();
    } else if (op.t === 'text') {
      const f = fontOf(op);
      c.font = `${f}px Inter, system-ui, sans-serif`;
      c.textBaseline = 'top';
      String(op.s || '').split('\n').forEach((line, i) => c.fillText(line, op.x0, op.y0 + i * f * 1.28));
    } else if (op.t === 'image') {
      const box = localBox(op);
      const w = box.x1 - box.x0, h = box.y1 - box.y0;
      const rec = images.get(op.img);
      if (rec && rec.ready) {
        c.drawImage(rec.el, box.x0, box.y0, w, h);
      } else {
        // Veri henüz gelmediyse yer tutucu: kutu kaybolmasın, geldiğinde
        // kendiliğinden yerine otursun.
        c.globalAlpha = alpha * 0.5;
        c.strokeStyle = resolveColor('ink');
        c.lineWidth = Math.max(w, h) / 120;
        c.setLineDash([Math.max(w, h) / 30, Math.max(w, h) / 40]);
        c.strokeRect(box.x0, box.y0, w, h);
        c.setLineDash([]);
      }
    }
    c.restore();
  }

  // Izgara TUVALE ÇİZİLMEZ. Nokta nokta fillRect etmek büyük ekranda kare
  // başına binlerce çizim çağrısı demekti ve çizim sırasında hissedilir bir
  // gecikme yaratıyordu. Artık sahnenin CSS arka planı: tek bir tekrarlayan
  // radial-gradient, kamerayla birlikte yalnızca background-size/position
  // güncelleniyor (bileşik katman, boyama maliyeti yok).
  function syncStageGrid() {
    if (!els.stage) return;
    const scale = board.cam.scale;
    let step = 40;
    while (step * scale < 16) step *= 2;
    while (step * scale > 96) step /= 2;
    const gap = step * scale;
    // Nokta karo merkezinde olduğu için yarım karo kaydırılır; böylece noktalar
    // dünya koordinatının tam katlarına oturur.
    const ox = -(((board.cam.x % step) + step) % step) * scale - gap / 2;
    const oy = -(((board.cam.y % step) + step) % step) * scale - gap / 2;
    const key = `${board.grid}|${gap.toFixed(2)}|${ox.toFixed(1)}|${oy.toFixed(1)}`;
    if (key === gridStyleKey) return;
    gridStyleKey = key;
    els.card.dataset.grid = board.grid ? 'on' : 'off';
    els.stage.style.backgroundSize = `${gap}px ${gap}px`;
    els.stage.style.backgroundPosition = `${ox}px ${oy}px`;
  }

  // Kesinleşmiş nesneler ayrı bir tuvale önbelleklenir ve her karede tek bir
  // drawImage ile basılır. Serbest çizim sırasında sahne DEĞİŞMEDİĞİ için
  // (yalnızca elde tutulan darbe büyür) 500 nesneli bir tahtada bile kare
  // maliyeti sabit kalır — eski sürüm her karede her nesneyi yeniden çiziyordu.
  function paintStaticLayer() {
    const cam = board.cam;
    const key = [staticVersion, cam.x.toFixed(2), cam.y.toFixed(2), cam.scale.toFixed(4),
      els.canvas.width, els.canvas.height, board.paper].join('|');
    if (key === staticKey && staticCanvas) return;
    stats.staticPaints++;
    const started = performance.now();
    if (!staticCanvas) {
      staticCanvas = document.createElement('canvas');
      staticCtx = staticCanvas.getContext('2d');
    }
    if (staticCanvas.width !== els.canvas.width || staticCanvas.height !== els.canvas.height) {
      staticCanvas.width = els.canvas.width;
      staticCanvas.height = els.canvas.height;
    }
    const c = staticCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
    c.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale,
      -cam.x * cam.scale * dpr, -cam.y * cam.scale * dpr);
    const view = viewRect();
    let cost = 0;
    for (const op of board.ops) {
      if (!overlaps(bboxOf(op), view)) continue;
      drawOp(c, op, board.erasing.has(op.id) ? 0.2 : 1);
      cost += op.p ? op.p.length >> 1 : 4;
    }
    staticCost = cost;
    staticKey = key;
    staticCam = { x: cam.x, y: cam.y, scale: cam.scale };
    staticPaintVersion = staticVersion;
    // Üstel ortalama: kameranın hareketi sırasında tam yeniden çizimin
    // karşılanabilir olup olmadığına buna bakarak karar veriyoruz.
    const took = performance.now() - started;
    staticPaintMs = staticPaintMs ? staticPaintMs * 0.7 + took * 0.3 : took;
  }

  // Kamera hareket ederken tahtanın yeniden çizilmesi PAHALIYSA, önbellek
  // katmanı doğru yere ötelenip ölçeklenerek basılır; hareket durunca (130 ms)
  // net kare gelir. Ucuz tahtalarda bu yola hiç girilmez, her kare nettir.
  function drawStaticLayer() {
    const cam = board.cam;
    const canPreview = camBusy && staticCanvas && staticCam
      && staticPaintVersion === staticVersion
      && staticCanvas.width === els.canvas.width && staticCanvas.height === els.canvas.height
      // Ölçüt JS süresi DEĞİL, görünür geometri miktarıdır: 2D tuval çizim
      // çağrıları GPU'ya kuyruklanır, performance.now() gerçek maliyeti
      // göstermez (1500 nesnede JS 4.7 ms derken kare 22 ms sürüyordu).
      && staticCost > PREVIEW_COST;
    if (canPreview) {
      const k = cam.scale / staticCam.scale;
      ctx.setTransform(k, 0, 0, k,
        (staticCam.x - cam.x) * cam.scale * dpr,
        (staticCam.y - cam.y) * cam.scale * dpr);
      ctx.drawImage(staticCanvas, 0, 0);
      stats.previews++;
      return;
    }
    paintStaticLayer();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(staticCanvas, 0, 0);
  }

  function markCameraBusy() {
    camBusy = true;
    clearTimeout(camBusyTimer);
    camBusyTimer = setTimeout(() => { camBusy = false; requestRender(); }, 130);
  }

  function viewRect() {
    const cam = board.cam;
    return { x0: cam.x, y0: cam.y, x1: cam.x + viewW / cam.scale, y1: cam.y + viewH / cam.scale };
  }

  function overlaps(bb, view) {
    return !(bb.x1 < view.x0 || bb.x0 > view.x1 || bb.y1 < view.y0 || bb.y0 > view.y1);
  }

  function render() {
    renderQueued = false;
    if (!ctx || viewW === 0 || viewH === 0) return;
    stats.frames++;
    if (autoFit && !isFocusedCard()) fitCamera();

    const cam = board.cam;
    syncStageGrid();

    // Zemin ve ızgara CSS'te; tuval saydam kalır ve yalnızca mürekkep taşır.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    drawStaticLayer();

    ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale,
      -cam.x * cam.scale * dpr, -cam.y * cam.scale * dpr);
    for (const op of board.live.values()) drawOp(ctx, op, 0.95);
    if (draft) drawOp(ctx, draft, 1);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSelection();
    if (drag && drag.mode === 'marquee') {
      const a = worldToScreen(drag.x0, drag.y0);
      const b = worldToScreen(drag.x1, drag.y1);
      ctx.save();
      ctx.fillStyle = accentColor(0.12);
      ctx.strokeStyle = accentColor();
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    }

    syncCursorElements();
    syncEditorPosition();
  }

  // Seçimin sınırları (dünya koordinatı). Seçim kutusu, taşıma ve döndürme
  // tutamağı bunun üzerinden çalışır.
  function selectionBounds() {
    let b = null;
    board.selection.forEach(id => {
      const op = board.index.get(id);
      if (!op) return;
      const bb = bboxOf(op);
      b = b ? {
        x0: Math.min(b.x0, bb.x0), y0: Math.min(b.y0, bb.y0),
        x1: Math.max(b.x1, bb.x1), y1: Math.max(b.y1, bb.y1)
      } : { ...bb };
    });
    return b;
  }

  // Döndürme tutamağının EKRAN konumu: kutunun üst ortasından sabit bir
  // uzaklıkta durur (yakınlaştırmadan bağımsız kavranabilirlik).
  function rotateHandleAt() {
    const b = selectionBounds();
    if (!b) return null;
    const top = worldToScreen((b.x0 + b.x1) / 2, b.y0);
    const center = worldToScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    return { x: top.x, y: top.y - ROTATE_HANDLE_GAP, anchorY: top.y, cx: center.x, cy: center.y };
  }

  // Seçim kutusunun köşe tutamakları (EKRAN koordinatı). Sıra: sol-üst,
  // sağ-üst, sağ-alt, sol-alt — karşı köşe ölçekleme ekseni olur.
  function cornerHandles() {
    const b = selectionBounds();
    if (!b) return null;
    const a = worldToScreen(b.x0, b.y0);
    const c = worldToScreen(b.x1, b.y1);
    const pad = 6;
    const l = a.x - pad, t = a.y - pad, r = c.x + pad, bt = c.y + pad;
    return [
      { x: l, y: t, ax: b.x1, ay: b.y1, cursor: 'nwse' },
      { x: r, y: t, ax: b.x0, ay: b.y1, cursor: 'nesw' },
      { x: r, y: bt, ax: b.x0, ay: b.y0, cursor: 'nwse' },
      { x: l, y: bt, ax: b.x1, ay: b.y0, cursor: 'nesw' }
    ];
  }

  function drawSelection() {
    if (!board.selection.size) return;
    const b = selectionBounds();
    if (!b) return;
    const accent = accentColor();
    const a = worldToScreen(b.x0, b.y0);
    const c = worldToScreen(b.x1, b.y1);
    const pad = 6;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(a.x - pad, a.y - pad, c.x - a.x + pad * 2, c.y - a.y + pad * 2);

    ctx.setLineDash([]);
    for (const h of cornerHandles() || []) {
      ctx.beginPath();
      ctx.rect(h.x - CORNER_R, h.y - CORNER_R, CORNER_R * 2, CORNER_R * 2);
      ctx.fillStyle = paperTheme().bg;
      ctx.fill();
      ctx.stroke();
    }

    const h = rotateHandleAt();
    if (h) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(h.x, h.anchorY - pad);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h.x, h.y, ROTATE_HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = paperTheme().bg;
      ctx.fill();
      ctx.stroke();
      // Tutamağın içindeki dönme oku
      ctx.beginPath();
      ctx.arc(h.x, h.y, ROTATE_HANDLE_R - 3.5, -Math.PI * 0.75, Math.PI * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Vurgu rengi doğrudan --acc'den OKUNAMAZ: kişisel palette bu değişken
  // var()/color-mix() zinciriyle türetiliyor ve canvas böyle bir değeri
  // ayrıştıramıyor. Görünmez bir sonda öğesinin hesaplanmış `color`'ı her
  // temada çözülmüş rgb() verir.
  function accentColor(alpha = 1) {
    let rgb = [99, 102, 241];
    if (els.probe) {
      const m = getComputedStyle(els.probe).color.match(/[\d.]+/g);
      if (m && m.length >= 3) rgb = [Number(m[0]), Number(m[1]), Number(m[2])];
    }
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  function touch() {
    board.version++;
    staticVersion++;
    requestRender();
  }

  /* ------------------------------- kamera -------------------------------- */

  function fitCamera(padding = 60) {
    const b = contentBounds();
    const w = Math.max(b.x1 - b.x0 + padding * 2, 1);
    const h = Math.max(b.y1 - b.y0 + padding * 2, 1);
    const scale = clamp(Math.min(viewW / w, viewH / h), MIN_SCALE, MAX_SCALE);
    board.cam.scale = scale;
    board.cam.x = (b.x0 + b.x1) / 2 - viewW / (2 * scale);
    board.cam.y = (b.y0 + b.y1) / 2 - viewH / (2 * scale);
    updateZoomLabel();
  }

  function zoomAt(px, py, factor) {
    const before = screenToWorld(px, py);
    board.cam.scale = clamp(board.cam.scale * factor, MIN_SCALE, MAX_SCALE);
    const after = screenToWorld(px, py);
    board.cam.x += before.x - after.x;
    board.cam.y += before.y - after.y;
    autoFit = false;
    markCameraBusy();
    updateZoomLabel();
    requestRender();
  }

  function updateZoomLabel() {
    if (!els.zoomLevel) return;
    // Küçük önizlemede fitCamera her karede çalışıyor; değişmeyen metni
    // yeniden yazmak boşuna stil hesabı tetikler.
    const text = Math.round(board.cam.scale * 100) + '%';
    if (els.zoomLevel.textContent !== text) els.zoomLevel.textContent = text;
  }

  /* ------------------------------ vuruş testi ---------------------------- */

  function distToSegment(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  }

  function hitOp(op, x, y, tol) {
    const bb = bboxOf(op);
    if (x < bb.x0 - tol || x > bb.x1 + tol || y < bb.y0 - tol || y > bb.y1 + tol) return false;
    if (op.a) {
      // Noktayı nesnenin kendi eksenine taşı: geri kalan testler hizalı çalışır.
      const p = opPivot(op);
      const local = rotatePoint(x, y, p.x, p.y, Math.sin(-op.a), Math.cos(-op.a));
      x = local.x; y = local.y;
    }
    const t = tol + strokeWidth(op) / 2;
    if (op.t === 'pen' || op.t === 'highlighter') {
      const p = op.p;
      if (p.length < 4) return Math.hypot(x - p[0], y - p[1]) <= t;
      for (let i = 0; i < p.length - 2; i += 2) {
        if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= t) return true;
      }
      return false;
    }
    if (op.t === 'line' || op.t === 'arrow') return distToSegment(x, y, op.x0, op.y0, op.x1, op.y1) <= t;
    if (op.t === 'rect') {
      const l = Math.min(op.x0, op.x1), r = Math.max(op.x0, op.x1);
      const tp = Math.min(op.y0, op.y1), bt = Math.max(op.y0, op.y1);
      return distToSegment(x, y, l, tp, r, tp) <= t || distToSegment(x, y, r, tp, r, bt) <= t
        || distToSegment(x, y, r, bt, l, bt) <= t || distToSegment(x, y, l, bt, l, tp) <= t;
    }
    if (op.t === 'ellipse') {
      const cx = (op.x0 + op.x1) / 2, cy = (op.y0 + op.y1) / 2;
      const rx = Math.abs(op.x1 - op.x0) / 2 || 0.001, ry = Math.abs(op.y1 - op.y0) / 2 || 0.001;
      const n = Math.hypot((x - cx) / rx, (y - cy) / ry);
      return Math.abs(n - 1) * Math.min(rx, ry) <= t + 2;
    }
    // Yazı ve fotoğraf dolu kutulardır; nokta KENDİ eksenlerindeki kutuya
    // düşüyorsa isabet sayılır (döndürülmüş AABB köşelerinde yanlış pozitif
    // vermemesi için yerel kutu kullanılır).
    const lb = localBox(op);
    return x >= lb.x0 - tol && x <= lb.x1 + tol && y >= lb.y0 - tol && y <= lb.y1 + tol;
  }

  function topmostAt(x, y) {
    const tol = 6 / board.cam.scale;
    for (let i = board.ops.length - 1; i >= 0; i--) {
      if (hitOp(board.ops[i], x, y, tol)) return board.ops[i];
    }
    return null;
  }

  function opsInRect(r) {
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1);
    const y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    return board.ops.filter(op => {
      const bb = bboxOf(op);
      return bb.x0 >= x0 && bb.x1 <= x1 && bb.y0 >= y0 && bb.y1 <= y1;
    });
  }

  /* --------------------------- durum değişimleri ------------------------- */

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const t = raw.t;
    if (!['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'text', 'image'].includes(t)) return null;
    const op = {
      id: String(raw.id || uid()).slice(0, 24),
      t,
      c: typeof raw.c === 'string' && /^(ink|#[0-9a-fA-F]{3,8})$/.test(raw.c) ? raw.c : 'ink',
      w: clamp(Number(raw.w) || 4, 1, 64)
    };
    if (t === 'pen' || t === 'highlighter') {
      if (!Array.isArray(raw.p) || raw.p.length < 2) return null;
      op.p = raw.p.slice(0, MAX_POINTS).map(Number).filter(n => Number.isFinite(n));
      if (op.p.length < 2) return null;
      if (op.p.length % 2) op.p.pop();
    } else {
      op.x0 = Number(raw.x0); op.y0 = Number(raw.y0);
      op.x1 = Number(raw.x1); op.y1 = Number(raw.y1);
      if (![op.x0, op.y0, op.x1, op.y1].every(Number.isFinite)) return null;
      const angle = Number(raw.a);
      if (Number.isFinite(angle) && angle) op.a = angle % (Math.PI * 2);
      if (t === 'text') {
        op.s = String(raw.s || '').slice(0, MAX_TEXT);
        if (!op.s.trim()) return null;
      }
      if (t === 'image') {
        op.img = String(raw.img || '').slice(0, 24);
        if (!op.img) return null;
        op.w = 0;
      }
    }
    return op;
  }

  function addOps(ops) {
    let added = 0;
    for (const raw of ops) {
      const op = sanitize(raw);
      if (!op || board.index.has(op.id)) continue;
      if (board.ops.length >= MAX_OPS) break;
      board.ops.push(op);
      board.index.set(op.id, op);
      added++;
    }
    if (added) touch();
    return added;
  }

  function removeIds(ids) {
    let removed = 0;
    const set = new Set(ids);
    for (const id of set) {
      if (board.index.delete(id)) removed++;
      board.selection.delete(id);
    }
    if (removed) {
      board.ops = board.ops.filter(op => board.index.has(op.id));
      touch();
    }
    return removed;
  }

  function moveIds(ids, dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    for (const id of ids) {
      const op = board.index.get(id);
      if (!op) continue;
      if (op.p) {
        for (let i = 0; i < op.p.length; i += 2) { op.p[i] += dx; op.p[i + 1] += dy; }
      } else {
        op.x0 += dx; op.y0 += dy; op.x1 += dx; op.y1 += dy;
      }
      invalidate(op);
    }
    touch();
  }

  // Seçimi ortak bir eksen (cx, cy) etrafında döndürür. Kalem/çizgi/ok
  // noktaları yer değiştirir; kutu tabanlı nesnelerde hem ekseni taşınır hem
  // kendi açısı artar — sonuç her iki durumda da katı (rigid) dönüştür.
  function rotateIds(ids, angle, cx, cy) {
    if (!Number.isFinite(angle) || !Number.isFinite(cx) || !Number.isFinite(cy) || !angle) return;
    const sin = Math.sin(angle), cos = Math.cos(angle);
    for (const id of ids) {
      const op = board.index.get(id);
      if (!op) continue;
      if (op.p) {
        for (let i = 0; i < op.p.length; i += 2) {
          const r = rotatePoint(op.p[i], op.p[i + 1], cx, cy, sin, cos);
          op.p[i] = r.x; op.p[i + 1] = r.y;
        }
      } else if (op.t === 'line' || op.t === 'arrow') {
        const a = rotatePoint(op.x0, op.y0, cx, cy, sin, cos);
        const b = rotatePoint(op.x1, op.y1, cx, cy, sin, cos);
        op.x0 = a.x; op.y0 = a.y; op.x1 = b.x; op.y1 = b.y;
      } else {
        const p = opPivot(op);
        const r = rotatePoint(p.x, p.y, cx, cy, sin, cos);
        const dx = r.x - p.x, dy = r.y - p.y;
        op.x0 += dx; op.y0 += dy; op.x1 += dx; op.y1 += dy;
        op.a = (op.a || 0) + angle;
      }
      invalidate(op);
    }
    touch();
  }

  // Seçimi (cx, cy) noktası etrafında DÜZGÜN (eşit oranlı) ölçekler. Eşit oran
  // şart: döndürülmüş bir nesneyi eksen bazında farklı oranlarda ölçeklemek
  // kesme (shear) üretir ve modelde açı + eksenle hizalı kutu ile temsil
  // edilemez. Köşe tutamakları bu yüzden en-boy oranını korur.
  function scaleIds(ids, factor, cx, cy) {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    for (const id of ids) {
      const op = board.index.get(id);
      if (!op) continue;
      if (op.p) {
        for (let i = 0; i < op.p.length; i += 2) {
          op.p[i] = cx + (op.p[i] - cx) * factor;
          op.p[i + 1] = cy + (op.p[i + 1] - cy) * factor;
        }
      } else {
        op.x0 = cx + (op.x0 - cx) * factor;
        op.y0 = cy + (op.y0 - cy) * factor;
        op.x1 = cx + (op.x1 - cx) * factor;
        op.y1 = cy + (op.y1 - cy) * factor;
      }
      // Çizgi kalınlığı ve yazı boyu da ölçeğe uyar (yakınlaştırma değil,
      // nesnenin kendisi büyüyor).
      if (op.t !== 'image') op.w = clamp(op.w * factor, 0.5, 400);
      invalidate(op);
    }
    touch();
  }

  function clearLocal() {
    board.ops = [];
    board.index.clear();
    board.selection.clear();
    board.erasing.clear();
    board.live.clear();
    touch();
  }

  function pushUndo(entry) {
    board.undo.push(entry);
    if (board.undo.length > 100) board.undo.shift();
    board.redo.length = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (els.undo) els.undo.disabled = board.undo.length === 0;
    if (els.redo) els.redo.disabled = board.redo.length === 0;
  }

  function commitOps(ops) {
    if (!ops.length) return;
    addOps(ops);
    net({ type: 'wb2-add', ops });
    pushUndo({ k: 'add', ops: ops.map(o => ({ ...o })) });
  }

  function eraseIds(ids) {
    const ops = ids.map(id => board.index.get(id)).filter(Boolean).map(o => ({ ...o }));
    if (!ops.length) return;
    removeIds(ids);
    net({ type: 'wb2-remove', ids });
    pushUndo({ k: 'del', ops });
  }

  function undo() {
    const e = board.undo.pop();
    if (!e) return;
    if (e.k === 'add') {
      const ids = e.ops.map(o => o.id);
      removeIds(ids);
      net({ type: 'wb2-remove', ids });
    } else if (e.k === 'del' || e.k === 'clear') {
      addOps(e.ops);
      net({ type: 'wb2-add', ops: e.ops });
    } else if (e.k === 'move') {
      moveIds(e.ids, -e.dx, -e.dy);
      net({ type: 'wb2-move', ids: e.ids, dx: -e.dx, dy: -e.dy });
    } else if (e.k === 'rot') {
      rotateIds(e.ids, -e.angle, e.cx, e.cy);
      net({ type: 'wb2-rotate', ids: e.ids, angle: -e.angle, cx: e.cx, cy: e.cy });
    } else if (e.k === 'scale') {
      scaleIds(e.ids, 1 / e.factor, e.cx, e.cy);
      net({ type: 'wb2-scale', ids: e.ids, factor: 1 / e.factor, cx: e.cx, cy: e.cy });
    }
    board.redo.push(e);
    updateHistoryButtons();
  }

  function redo() {
    const e = board.redo.pop();
    if (!e) return;
    if (e.k === 'add') {
      addOps(e.ops);
      net({ type: 'wb2-add', ops: e.ops });
    } else if (e.k === 'del') {
      const ids = e.ops.map(o => o.id);
      removeIds(ids);
      net({ type: 'wb2-remove', ids });
    } else if (e.k === 'clear') {
      clearLocal();
      net({ type: 'wb2-clear' });
    } else if (e.k === 'move') {
      moveIds(e.ids, e.dx, e.dy);
      net({ type: 'wb2-move', ids: e.ids, dx: e.dx, dy: e.dy });
    } else if (e.k === 'rot') {
      rotateIds(e.ids, e.angle, e.cx, e.cy);
      net({ type: 'wb2-rotate', ids: e.ids, angle: e.angle, cx: e.cx, cy: e.cy });
    } else if (e.k === 'scale') {
      scaleIds(e.ids, e.factor, e.cx, e.cy);
      net({ type: 'wb2-scale', ids: e.ids, factor: e.factor, cx: e.cx, cy: e.cy });
    }
    board.undo.push(e);
    updateHistoryButtons();
  }

  function clearAll() {
    if (!board.ops.length) {
      net({ type: 'wb2-clear' });
      return;
    }
    const ops = board.ops.map(o => ({ ...o }));
    clearLocal();
    net({ type: 'wb2-clear' });
    pushUndo({ k: 'clear', ops });
    call('showToast', 'Tahta temizlendi — Ctrl+Z ile geri alabilirsin', 'info');
  }

  function setPaper(mode, share) {
    board.paper = mode === 'dark' ? 'dark' : 'light';
    if (els.card) els.card.dataset.paper = board.paper;
    if (share) net({ type: 'wb2-paper', mode: board.paper });
    requestRender();
  }

  /* ------------------------------ araç seçimi ---------------------------- */

  function setTool(tool) {
    board.tool = tool;
    if (tool !== 'select') board.selection.clear();
    els.rail?.querySelectorAll('[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
      btn.setAttribute('aria-pressed', btn.dataset.tool === tool ? 'true' : 'false');
    });
    if (els.canvas) {
      els.canvas.dataset.cursor = tool === 'hand' ? 'grab'
        : tool === 'select' ? 'default'
          : tool === 'text' ? 'text'
            : tool === 'eraser' ? 'eraser' : 'draw';
    }
    // Şekil/kalem araçlarında stil kutusu anlamlı; seç/kaydır'da gizle.
    if (tool === 'select' || tool === 'hand') closeStylePopover();
    requestRender();
  }

  function setColor(color) {
    board.color = color;
    if (els.colorDot) els.colorDot.style.background = resolveColor(color);
    if (els.color && color !== 'ink' && els.color.value !== color) els.color.value = color;
    els.swatches?.querySelectorAll('.wb-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === color);
    });
    if (editor) { editor.color = color; syncEditorPosition(); }
  }

  function setSize(size) {
    board.size = clamp(Number(size) || 4, 1, 32);
    if (els.size && Number(els.size.value) !== board.size) els.size.value = String(board.size);
    if (els.sizeDot) {
      const d = clamp(board.size, 2, 26);
      els.sizeDot.style.width = d + 'px';
      els.sizeDot.style.height = d + 'px';
    }
    if (els.sizeValue) els.sizeValue.textContent = String(board.size);
  }

  function openStylePopover() { els.style?.classList.remove('hidden'); els.styleBtn?.classList.add('active'); }
  function closeStylePopover() { els.style?.classList.add('hidden'); els.styleBtn?.classList.remove('active'); }

  /* -------------------------------- fotoğraf ------------------------------ */

  // Veriyi yerel kayda al ve yüklenince yeniden çiz. Hem kendi eklediğimiz
  // hem ağdan gelen fotoğraflar bu kapıdan geçer.
  function storeImage(id, src) {
    if (!id || typeof src !== 'string' || !src.startsWith('data:image/')) return null;
    const existing = images.get(id);
    if (existing) return existing;
    const rec = { src, el: new Image(), ready: false };
    rec.el.onload = () => {
      rec.ready = true;
      board.ops.forEach(op => { if (op.t === 'image' && op.img === id) invalidate(op); });
      staticVersion++;
      requestRender();
    };
    rec.el.src = src;
    images.set(id, rec);
    if (images.size > 80) {                       // en eski kayıt düşer
      const oldest = images.keys().next().value;
      if (oldest !== id) images.delete(oldest);
    }
    return rec;
  }

  // Fotoğrafı uzun kenarı MAX_IMAGE_DIM olacak şekilde küçültüp webp'e çevirir:
  // veri kanalından geçecek boyuta indirmenin yanı sıra tuval başarımını da
  // korur (10 MP'lik bir fotoğrafı her karede ölçeklemek pahalıdır).
  function normalizeImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('image bekleniyor'));
      if (file.size > MAX_IMAGE_BYTES) return reject(new Error('too-big'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, MAX_IMAGE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        let src = cv.toDataURL('image/webp', 0.85);
        if (src.length > 1400000) src = cv.toDataURL('image/webp', 0.6);
        resolve({ src, w, h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function sendImageData(id, target) {
    const rec = images.get(id);
    if (!rec) return;
    const send = target ? (m => netTo(target, m)) : net;
    const total = Math.ceil(rec.src.length / IMG_CHUNK);
    send({ type: 'wb2-img-begin', id, total });
    for (let i = 0; i < total; i++) {
      send({ type: 'wb2-img-part', id, seq: i, data: rec.src.slice(i * IMG_CHUNK, (i + 1) * IMG_CHUNK) });
    }
    send({ type: 'wb2-img-end', id });
  }

  function receiveImagePart(msg) {
    const id = String(msg.id || '').slice(0, 24);
    if (!id) return;
    if (msg.type === 'wb2-img-begin') {
      const total = Number(msg.total);
      if (!Number.isFinite(total) || total <= 0 || total > 400) return;
      imageParts.set(id, { total, parts: new Array(total).fill(null) });
      return;
    }
    const pending = imageParts.get(id);
    if (!pending) return;
    if (msg.type === 'wb2-img-part') {
      const seq = Number(msg.seq);
      if (!Number.isInteger(seq) || seq < 0 || seq >= pending.total) return;
      if (typeof msg.data !== 'string' || msg.data.length > IMG_CHUNK * 2) return;
      pending.parts[seq] = msg.data;
      return;
    }
    // wb2-img-end
    imageParts.delete(id);
    if (pending.parts.some(p => p === null)) return;   // eksik parça: yok say
    storeImage(id, pending.parts.join(''));
  }

  // Dosyayı tahtaya yerleştirir: görüş alanının ortasına, en fazla %45'i
  // kaplayacak boyutta. Eklendikten sonra seçili gelir ki hemen taşınıp
  // döndürülebilsin.
  async function insertImageFile(file) {
    let normalized;
    try {
      normalized = await normalizeImage(file);
    } catch (err) {
      call('showToast', err.message === 'too-big' ? 'Fotoğraf çok büyük' : 'Fotoğraf yüklenemedi', 'danger');
      return;
    }
    const id = uid();
    storeImage(id, normalized.src);
    const viewWorldW = viewW / board.cam.scale;
    const viewWorldH = viewH / board.cam.scale;
    const k = Math.min(viewWorldW * 0.45 / normalized.w, viewWorldH * 0.45 / normalized.h, 1);
    const w = normalized.w * k, h = normalized.h * k;
    const center = screenToWorld(viewW / 2, viewH / 2);
    const op = {
      id: uid(), t: 'image', img: id, c: 'ink', w: 0,
      x0: center.x - w / 2, y0: center.y - h / 2,
      x1: center.x + w / 2, y1: center.y + h / 2
    };
    sendImageData(id);
    commitOps([op]);
    setTool('select');
    board.selection.clear();
    board.selection.add(op.id);
    hintRotation();
    requestRender();
  }

  function pickImage() {
    if (!els.file) return;
    els.file.value = '';
    els.file.click();
  }

  /* ------------------------------ metin kutusu --------------------------- */

  function openTextEditor(pt) {
    commitText();
    const ta = document.createElement('textarea');
    ta.className = 'wb-text-input';
    ta.rows = 1;
    ta.spellcheck = false;
    editor = { el: ta, x: pt.x, y: pt.y, color: board.color, size: board.size, armed: false };
    els.layer.appendChild(ta);
    syncEditorPosition();
    ta.focus();
    // Kutu açıldığı karede gelen blur'lar (odak sırası, pencere etkinleşmesi)
    // yazmaya fırsat kalmadan kutuyu kapatmasın: kısa bir süre boyunca odak
    // geri alınır, sonrasında blur normal şekilde metni kesinleştirir.
    setTimeout(() => { if (editor && editor.el === ta) editor.armed = true; }, 120);
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
    ta.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) {
        ev.preventDefault();
        commitText();
      }
    });
    ta.addEventListener('blur', () => {
      if (editor && editor.el === ta && !editor.armed) { ta.focus(); return; }
      commitText();
    });
  }

  function syncEditorPosition() {
    if (!editor) return;
    const p = worldToScreen(editor.x, editor.y);
    const f = Math.max(12, editor.size * 6) * board.cam.scale;
    Object.assign(editor.el.style, {
      left: p.x + 'px',
      top: p.y + 'px',
      fontSize: f + 'px',
      lineHeight: '1.28',
      color: resolveColor(editor.color)
    });
  }

  function commitText() {
    if (!editor) return;
    const current = editor;
    editor = null;
    const value = current.el.value;
    current.el.remove();
    if (!value.trim()) return;
    commitOps([{
      id: uid(), t: 'text', c: current.color, w: current.size,
      x0: current.x, y0: current.y, x1: current.x, y1: current.y, s: value
    }]);
  }

  /* ------------------------------ canlı yayın ---------------------------- */

  function sendLive(force) {
    if (!draft) return;
    const now = Date.now();
    if (!force && now - lastLiveSent < LIVE_INTERVAL) return;
    lastLiveSent = now;
    if (draft.p) {
      if (draft.p.length <= liveSentCount) return;
      net({
        type: 'wb2-live', id: draft.id, t: draft.t, c: draft.c, w: draft.w,
        i: liveSentCount, p: draft.p.slice(liveSentCount)
      });
      liveSentCount = draft.p.length;
    } else {
      net({
        type: 'wb2-live', id: draft.id, t: draft.t, c: draft.c, w: draft.w,
        x0: draft.x0, y0: draft.y0, x1: draft.x1, y1: draft.y1
      });
    }
  }

  // Canlı önizleme nesneleri tahtaya YAZILMAZ; yalnızca çizim sürerken
  // gösterilir ve wb2-add ile kalıcı hale gelir. Bu yüzden sanitize()'dan
  // geçmezler, alanları burada tek tek doğrulanır.
  function applyLive(msg) {
    const id = String(msg.id || '').slice(0, 24);
    const tool = ['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse'].includes(msg.t) ? msg.t : null;
    if (!id || !tool) return;
    const isPath = tool === 'pen' || tool === 'highlighter';
    let op = board.live.get(id);
    if (!op || (isPath && msg.i === 0)) {
      op = {
        id, t: tool,
        c: typeof msg.c === 'string' && /^(ink|#[0-9a-fA-F]{3,8})$/.test(msg.c) ? msg.c : 'ink',
        w: clamp(Number(msg.w) || 4, 1, 64)
      };
      if (isPath) op.p = [];
      else { op.x0 = 0; op.y0 = 0; op.x1 = 0; op.y1 = 0; }
      board.live.set(id, op);
    }
    op.ts = Date.now();
    if (isPath && Array.isArray(msg.p)) {
      const i = Number(msg.i) || 0;
      if (i > op.p.length) return;                 // eksik parça: sonraki pakette toparlanır
      op.p.length = i;
      for (const n of msg.p) if (Number.isFinite(n)) op.p.push(n);
      if (op.p.length > MAX_POINTS) op.p.length = MAX_POINTS;
      if (op.p.length < 2) return;
    } else if (!isPath && [msg.x0, msg.y0, msg.x1, msg.y1].every(Number.isFinite)) {
      op.x0 = msg.x0; op.y0 = msg.y0; op.x1 = msg.x1; op.y1 = msg.y1;
    }
    invalidate(op);
    requestRender();
  }

  function sweepLive() {
    const now = Date.now();
    let changed = false;
    board.live.forEach((op, id) => {
      if (now - (op.ts || 0) > 15000) { board.live.delete(id); changed = true; }
    });
    board.cursors.forEach((cur, id) => {
      if (now - cur.ts > CURSOR_TTL) {
        cur.el?.remove();
        board.cursors.delete(id);
        changed = true;
      }
    });
    if (changed) requestRender();
  }

  /* ------------------------------- imleçler ------------------------------ */

  function peerLabel(peerId) {
    try {
      const peer = state.peers.get(peerId);
      const raw = peer ? peer.name : '';
      const named = typeof displayName === 'function' ? displayName(peerId, raw) : raw;
      return String(named || 'Katılımcı').slice(0, 24);
    } catch (e) { return 'Katılımcı'; }
  }

  function peerHue(peerId) {
    let h = 0;
    for (let i = 0; i < peerId.length; i++) h = (h * 31 + peerId.charCodeAt(i)) % 360;
    return h;
  }

  function setCursor(peerId, msg) {
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
    let cur = board.cursors.get(peerId);
    if (!cur) {
      const el = document.createElement('div');
      el.className = 'wb-cursor';
      el.style.setProperty('--wb-cursor-hue', String(peerHue(peerId)));
      const dot = document.createElement('span');
      dot.className = 'wb-cursor-dot';
      const tag = document.createElement('span');
      tag.className = 'wb-cursor-name';
      tag.textContent = peerLabel(peerId);
      el.append(dot, tag);
      els.layer.appendChild(el);
      cur = { el, tag, x: msg.x, y: msg.y, ts: 0 };
      board.cursors.set(peerId, cur);
    }
    cur.x = msg.x;
    cur.y = msg.y;
    cur.ts = Date.now();
    cur.tag.textContent = peerLabel(peerId);
    requestRender();
  }

  function syncCursorElements() {
    board.cursors.forEach(cur => {
      const p = worldToScreen(cur.x, cur.y);
      const off = p.x < -40 || p.y < -40 || p.x > viewW + 40 || p.y > viewH + 40;
      cur.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      cur.el.style.opacity = off ? '0' : '1';
    });
  }

  function sendCursor(pt) {
    const now = Date.now();
    if (now - lastCursorSent < CURSOR_INTERVAL) return;
    lastCursorSent = now;
    net({ type: 'wb2-cursor', x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 });
  }

  /* ------------------------------ etkileşim ------------------------------ */

  function isFocusedCard() { return focusedCardEl() === els.card; }

  // Sentetik (test) işaretçi olaylarında pointerId etkin olmadığı için
  // setPointerCapture NotFoundError atar; yakalama olmadan da çizim çalışır.
  function capturePointer(e) {
    try { els.canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }

  // Çizim YALNIZCA kart odaktayken açıktır. Şeritteki/ızgaradaki küçük kartta
  // tıklama kartı odağa almalı; serbest bırakılırsa kullanıcı odaklanmak için
  // tıkladığında tahtaya istemsiz bir nokta düşüyor.
  function interactive() {
    const card = els.card;
    if (!card || card.classList.contains('hidden')) return false;
    // Katılım örtüsü yalnızca state.wbJoined false iken gösterilir; bayrağa
    // bakmak her pointermove'da DOM sorgulamaktan çok daha ucuz.
    if (!state.wbJoined) return false;
    return isFocusedCard();
  }

  function constrain(pt, anchor, tool) {
    if (!shiftDown) return pt;
    const dx = pt.x - anchor.x, dy = pt.y - anchor.y;
    if (tool === 'line' || tool === 'arrow') {
      const step = Math.PI / 4;
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      const len = Math.hypot(dx, dy);
      return { x: anchor.x + Math.cos(ang) * len, y: anchor.y + Math.sin(ang) * len };
    }
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: anchor.x + Math.sign(dx || 1) * side, y: anchor.y + Math.sign(dy || 1) * side };
  }

  function onPointerDown(e) {
    if (!interactive()) return;
    if (els.card.querySelector('.inactive-overlay')) return;
    canvasRect = null;   // hareket başlamadan bir kez tazele
    if (editor && e.target !== editor.el) commitText();
    closeStylePopover();
    const pt = pointerWorld(e);
    const wantPan = e.button === 1 || e.button === 2 || spaceDown || board.tool === 'hand';

    if (wantPan) {
      e.preventDefault();
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: board.cam.x, cy: board.cam.y };
      capturePointer(e);
      els.canvas.dataset.panning = '1';
      autoFit = false;
      return;
    }
    if (e.button !== 0) return;
    capturePointer(e);
    autoFit = false;

    if (board.tool === 'select') {
      // Döndürme tutamağı seçimin ÜSTÜNDEDİR; nesne vuruş testinden önce
      // bakılır, yoksa tutamağa basınca altındaki nesne seçilirdi.
      if (overRotateHandle(e)) {
        const b = selectionBounds();
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        drag = {
          mode: 'rotate', ids: [...board.selection], cx, cy,
          start: Math.atan2(pt.y - cy, pt.x - cx), applied: 0
        };
        return;
      }
      // Köşe tutamağı: karşı köşeyi sabit tutarak eşit oranlı büyüt/küçült.
      const corner = cornerUnder(e);
      if (corner) {
        const startDist = Math.hypot(pt.x - corner.ax, pt.y - corner.ay) || 0.0001;
        drag = {
          mode: 'scale', ids: [...board.selection],
          cx: corner.ax, cy: corner.ay, startDist, applied: 1
        };
        return;
      }
      const hit = topmostAt(pt.x, pt.y);
      if (hit) {
        if (!board.selection.has(hit.id)) {
          if (!e.shiftKey) board.selection.clear();
          board.selection.add(hit.id);
        } else if (e.shiftKey) {
          board.selection.delete(hit.id);
        }
        drag = { mode: 'move', last: pt, dx: 0, dy: 0, ids: [...board.selection] };
      } else {
        if (!e.shiftKey) board.selection.clear();
        drag = { mode: 'marquee', x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      }
      hintRotation();
      requestRender();
      return;
    }

    if (board.tool === 'eraser') {
      drag = { mode: 'erase', last: pt };
      eraseAlong(pt, pt);
      return;
    }

    if (board.tool === 'text') {
      // preventDefault ŞART: iptal edilmezse tarayıcı uyumluluk mousedown'ını
      // üretip odağı <body>'ye taşıyor, yeni açılan metin kutusu daha ilk
      // karede blur alıp kapanıyordu (yazı aracı hiç çalışmıyor görünüyordu).
      e.preventDefault();
      openTextEditor(pt);
      return;
    }

    const tool = board.tool === 'highlighter' ? 'highlighter' : board.tool;
    liveSentCount = 0;
    if (tool === 'pen' || tool === 'highlighter') {
      draft = { id: uid(), t: tool, c: board.color, w: board.size, p: [pt.x, pt.y] };
    } else if (SHAPE_TOOLS.has(tool)) {
      draft = { id: uid(), t: tool, c: board.color, w: board.size, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
    } else {
      return;
    }
    drag = { mode: 'draw', anchor: pt };
    state.drawing = true;
    sendLive(true);
    requestRender();
  }

  // İşaretçi döndürme tutamağının üstünde mi (ekran uzaklığı — yakınlaştırma
  // ne olursa olsun aynı kavrama alanı).
  function overRotateHandle(e) {
    if (board.tool !== 'select' || !board.selection.size) return false;
    const h = rotateHandleAt();
    if (!h) return false;
    const rect = canvasBox();
    const dx = (e.clientX - rect.left) - h.x;
    const dy = (e.clientY - rect.top) - h.y;
    return Math.hypot(dx, dy) <= ROTATE_HANDLE_R + 5;
  }

  function cornerUnder(e) {
    if (board.tool !== 'select' || !board.selection.size) return null;
    const handles = cornerHandles();
    if (!handles) return null;
    const rect = canvasBox();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    for (const h of handles) {
      if (Math.abs(px - h.x) <= CORNER_R + 4 && Math.abs(py - h.y) <= CORNER_R + 4) return h;
    }
    return null;
  }

  // Döndürme tutamağı yalnızca seçim varken görünür; ilk seçimde bir kez
  // hatırlatılır (oturum başına), sonra sessiz kalır.
  function hintRotation() {
    if (rotationHinted || !board.selection.size) return;
    rotationHinted = true;
    call('showToast', 'Seçimi döndürmek için sürükle', 'info');
  }

  function onPointerMove(e) {
    if (!interactive()) return;
    const pt = pointerWorld(e);
    if (!drag) {
      if (board.tool === 'select') {
        const corner = cornerUnder(e);
        els.canvas.dataset.cursor = overRotateHandle(e) ? 'rotate'
          : corner ? corner.cursor : 'default';
      }
      if (isFocusedCard()) sendCursor(pt);
      return;
    }

    if (drag.mode === 'pan') {
      board.cam.x = drag.cx - (e.clientX - drag.sx) / board.cam.scale;
      board.cam.y = drag.cy - (e.clientY - drag.sy) / board.cam.scale;
      markCameraBusy();
      requestRender();
      return;
    }
    if (drag.mode === 'marquee') {
      drag.x1 = pt.x; drag.y1 = pt.y;
      requestRender();
      return;
    }
    if (drag.mode === 'scale') {
      const dist = Math.hypot(pt.x - drag.cx, pt.y - drag.cy);
      // Toplam oran, tutamağın eksene uzaklığının başlangıca göre değişimi.
      let want = clamp(dist / drag.startDist, 0.05, 40);
      const b = selectionBounds();
      if (b) {
        const size = Math.max(b.x1 - b.x0, b.y1 - b.y0) * (want / drag.applied);
        if (size < 4) want = drag.applied;              // çökmeyi engelle
        if (size * board.cam.scale > 20000) want = drag.applied;
      }
      const step = want / drag.applied;
      if (Math.abs(step - 1) > 0.0005) {
        scaleIds(drag.ids, step, drag.cx, drag.cy);
        drag.applied = want;
      }
      return;
    }
    if (drag.mode === 'rotate') {
      const current = Math.atan2(pt.y - drag.cy, pt.x - drag.cx);
      let want = current - drag.start;
      if (shiftDown) want = Math.round(want / ROTATE_SNAP) * ROTATE_SNAP;
      const delta = want - drag.applied;
      if (delta) {
        rotateIds(drag.ids, delta, drag.cx, drag.cy);
        drag.applied = want;
      }
      return;
    }
    if (drag.mode === 'move') {
      const dx = pt.x - drag.last.x, dy = pt.y - drag.last.y;
      drag.last = pt;
      drag.dx += dx; drag.dy += dy;
      moveIds(drag.ids, dx, dy);
      return;
    }
    if (drag.mode === 'erase') {
      eraseAlong(drag.last, pt);
      drag.last = pt;
      return;
    }
    if (drag.mode === 'draw' && draft) {
      sendCursor(pt);
      if (draft.p) {
        const n = draft.p.length;
        const minDist = 1.4 / board.cam.scale;
        if (Math.hypot(pt.x - draft.p[n - 2], pt.y - draft.p[n - 1]) >= minDist) {
          draft.p.push(pt.x, pt.y);
          splitLongStroke();
        }
      } else {
        const end = constrain(pt, drag.anchor, draft.t);
        draft.x1 = end.x; draft.y1 = end.y;
      }
      invalidate(draft);
      sendLive(false);
      requestRender();
    }
  }

  function onPointerUp(e) {
    try { els.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    delete els.canvas.dataset.panning;
    if (!drag) return;
    const mode = drag.mode;
    const info = drag;
    drag = null;
    state.drawing = false;

    if (mode === 'marquee') {
      opsInRect(info).forEach(op => board.selection.add(op.id));
      hintRotation();
      requestRender();
      return;
    }
    if (mode === 'scale') {
      if (Math.abs(info.applied - 1) > 0.0005) {
        net({ type: 'wb2-scale', ids: info.ids, factor: info.applied, cx: info.cx, cy: info.cy });
        pushUndo({ k: 'scale', ids: info.ids, factor: info.applied, cx: info.cx, cy: info.cy });
      }
      return;
    }
    if (mode === 'rotate') {
      if (Math.abs(info.applied) > 0.0001) {
        net({ type: 'wb2-rotate', ids: info.ids, angle: info.applied, cx: info.cx, cy: info.cy });
        pushUndo({ k: 'rot', ids: info.ids, angle: info.applied, cx: info.cx, cy: info.cy });
      }
      return;
    }
    if (mode === 'move') {
      if (Math.abs(info.dx) > 0.01 || Math.abs(info.dy) > 0.01) {
        net({ type: 'wb2-move', ids: info.ids, dx: info.dx, dy: info.dy });
        pushUndo({ k: 'move', ids: info.ids, dx: info.dx, dy: info.dy });
      }
      return;
    }
    if (mode === 'erase') {
      const ids = [...board.erasing];
      board.erasing.clear();
      staticVersion++;
      eraseIds(ids);
      requestRender();
      return;
    }
    if (mode === 'draw' && draft) {
      const finished = draft;
      draft = null;
      sendLiveEnd(finished.id);
      if (finished.p) {
        commitOps([finished]);
      } else {
        const w = Math.abs(finished.x1 - finished.x0), h = Math.abs(finished.y1 - finished.y0);
        // Kazara tıklama şekil bırakmasın.
        if (Math.max(w, h) * board.cam.scale >= 4) commitOps([finished]);
        else requestRender();
      }
    }
  }

  function sendLiveEnd(id) {
    net({ type: 'wb2-live-end', id });
    liveSentCount = 0;
  }

  // Çok uzun kesintisiz çizgiler tek pakete sığmayabilir (RTCDataChannel
  // pratikte ~256 KB'ta kopar). Darbe belirli bir noktadan sonra kapatılıp
  // son noktadan yenisi başlatılır — görsel olarak kesintisiz kalır.
  function splitLongStroke() {
    if (!draft || !draft.p || draft.p.length < STROKE_SPLIT * 2) return;
    const tail = draft.p.slice(-2);
    const finished = draft;
    sendLive(true);
    sendLiveEnd(finished.id);
    draft = { id: uid(), t: finished.t, c: finished.c, w: finished.w, p: tail.slice() };
    commitOps([finished]);
    sendLive(true);
  }

  function eraseAlong(from, to) {
    const tol = Math.max(board.size, 6) / board.cam.scale;
    let changed = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(tol, 1)));
    for (const op of board.ops) {
      if (board.erasing.has(op.id)) continue;
      for (let s = 0; s <= steps; s++) {
        const x = from.x + (to.x - from.x) * (s / steps);
        const y = from.y + (to.y - from.y) * (s / steps);
        if (hitOp(op, x, y, tol)) { board.erasing.add(op.id); changed = true; break; }
      }
    }
    // Silinecek nesneler soluklaştırılarak gösterilir; bu görünüm önbellekli
    // katmanda olduğu için katmanın yeniden çizilmesi gerekir.
    if (changed) { staticVersion++; requestRender(); }
  }

  function onWheel(e) {
    if (!interactive()) return;
    e.preventDefault();
    const rect = els.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      zoomAt(px, py, Math.exp(-e.deltaY * 0.0016));
    } else {
      board.cam.x += e.deltaX / board.cam.scale;
      autoFit = false;
      markCameraBusy();
      requestRender();
    }
  }

  function onKeyDown(e) {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftDown = true;
    // Kısayollar YALNIZCA kart odaktayken çalışır. Uygulama kısayolları
    // (M/D/S/R/F) tam da bu durumda susturulur (bkz. renderer.js
    // ACTIVITY_CARD_IDS), dolayısıyla R = dikdörtgen ile R = kayıt çakışmaz.
    if (!interactive()) return;
    const target = e.target;
    if (target && (target.closest?.('input, textarea, select, [contenteditable="true"]'))) return;

    if (e.code === 'Space' && !spaceDown) {
      spaceDown = true;
      els.canvas.dataset.cursor = 'grab';
      e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && (e.code === 'KeyY')) { e.preventDefault(); redo(); return; }
    if (mod && e.code === 'KeyA') {
      e.preventDefault();
      setTool('select');
      board.ops.forEach(op => board.selection.add(op.id));
      requestRender();
      return;
    }
    if (mod) return;
    if (e.code === 'Delete' || e.code === 'Backspace') {
      if (board.selection.size) { e.preventDefault(); eraseIds([...board.selection]); }
      return;
    }
    if (e.code === 'Escape') {
      // Seçim varken Esc yalnızca seçimi bırakır; odak modundan çıkarmaz
      // (renderer.js'teki Esc dinleyicisine ulaşmasın diye durduruluyor).
      if (board.selection.size) {
        board.selection.clear();
        requestRender();
        e.stopPropagation();
      }
      return;
    }
    // Köşeli parantezler seçimi 15°'lik adımlarla döndürür (tutamağa gerek yok).
    if ((e.key === '[' || e.key === ']') && board.selection.size) {
      e.preventDefault();
      window.whiteboard.rotateSelection(e.key === '[' ? -ROTATE_SNAP : ROTATE_SNAP);
      return;
    }
    if (TOOL_KEYS[e.code]) { e.preventDefault(); setTool(TOOL_KEYS[e.code]); return; }
    if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); resetZoom(); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(viewW / 2, viewH / 2, 1.2); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(viewW / 2, viewH / 2, 1 / 1.2); }
  }

  function onKeyUp(e) {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftDown = false;
    if (e.code === 'Space') {
      spaceDown = false;
      if (els.canvas) setTool(board.tool);
    }
  }

  function resetZoom() {
    const center = screenToWorld(viewW / 2, viewH / 2);
    board.cam.scale = 1;
    board.cam.x = center.x - viewW / 2;
    board.cam.y = center.y - viewH / 2;
    updateZoomLabel();
    requestRender();
  }

  /* ------------------------------ dışa aktarma --------------------------- */

  function exportPng() {
    const b = contentBounds();
    const pad = 48;
    const w = b.x1 - b.x0 + pad * 2;
    const h = b.y1 - b.y0 + pad * 2;
    const scale = clamp(2400 / Math.max(w, h), 0.4, 2);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    const c = out.getContext('2d');
    c.fillStyle = paperTheme().bg;
    c.fillRect(0, 0, out.width, out.height);
    c.setTransform(scale, 0, 0, scale, (-b.x0 + pad) * scale, (-b.y0 + pad) * scale);
    board.ops.forEach(op => drawOp(c, op, 1));
    out.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `beyaz-tahta-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Sonucu main süreçteki indirme bildirimi duyurur (dosya adı + klasörde
      // göster); burada ayrıca bildirim göstermek çift uyarı olurdu.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, 'image/png');
  }

  /* --------------------------------- ağ ---------------------------------- */

  function serializeOps() {
    return board.ops.map(op => {
      const out = { id: op.id, t: op.t, c: op.c, w: op.w };
      if (op.p) out.p = op.p.map(n => Math.round(n * 10) / 10);
      else {
        out.x0 = Math.round(op.x0 * 10) / 10; out.y0 = Math.round(op.y0 * 10) / 10;
        out.x1 = Math.round(op.x1 * 10) / 10; out.y1 = Math.round(op.y1 * 10) / 10;
        if (op.a) out.a = Math.round(op.a * 10000) / 10000;
        if (op.t === 'text') out.s = op.s;
        if (op.t === 'image') out.img = op.img;
      }
      return out;
    });
  }

  function syncTo(peerId) {
    if (!inited) return;
    const ops = serializeOps();
    const total = Math.max(1, Math.ceil(ops.length / SYNC_CHUNK));
    for (let i = 0; i < total; i++) {
      netTo(peerId, {
        type: 'wb2-sync', seq: i, total, paper: board.paper,
        ops: ops.slice(i * SYNC_CHUNK, (i + 1) * SYNC_CHUNK)
      });
    }
    // Fotoğraf verisi op'un içinde taşınmadığı için ayrıca gönderilir; yalnızca
    // tahtada gerçekten kullanılanlar.
    const used = new Set();
    board.ops.forEach(op => { if (op.t === 'image' && op.img) used.add(op.img); });
    used.forEach(id => sendImageData(id, peerId));
  }

  // Odadaki EN KÜÇÜK kimlikli katılımcı yanıt verir: aksi halde 8 kişilik odada
  // yeni gelen 8 kopya tam senkron alır. Birleştirme id bazlı olduğu için fazlası
  // zararsızdır, yalnızca gereksiz trafiktir.
  function shouldAnswerSync(askerId) {
    try {
      const ids = [...state.peers.keys()].filter(id => id !== askerId);
      return ids.every(id => String(state.myId) <= String(id));
    } catch (e) { return true; }
  }

  function announceRemoteActivity() {
    const card = els.card;
    if (!card) return;
    if (!card.classList.contains('hidden') && state.wbJoined) return;
    const wasHidden = card.classList.contains('hidden');
    card.classList.remove('hidden');
    call('makeCardFocusable', card);
    call('updateEmptyGrid');
    if (!state.wbJoined) {
      call('showInactiveOverlay', 'wb-card', 'Beyaz Tahta', () => {
        state.wbJoined = true;
        call('removeInactiveOverlay', 'wb-card');
        if (!focusedCardEl()) call('toggleFocus', card);
        resize();
      });
    }
    if (wasHidden) resize();
  }

  function legacyDraw(msg) {
    // Eski istemci normalize (0..1) koordinatlarla ve parça parça çizgi
    // gönderir; her parçayı kısa bir kalem nesnesine çeviriyoruz.
    const x0 = Number(msg.x0) * WORLD.w, y0 = Number(msg.y0) * WORLD.h;
    const x1 = Number(msg.x1) * WORLD.w, y1 = Number(msg.y1) * WORLD.h;
    const c = typeof msg.color === 'string' ? msg.color : 'ink';
    const w = clamp(Number(msg.size) * 2 || 4, 1, 64);
    if (msg.tool === 'text') {
      addOps([{ id: uid(), t: 'text', c, w: w / 2, x0, y0, x1: x0, y1: y0, s: String(msg.text || '') }]);
    } else if (msg.tool === 'rect') {
      addOps([{ id: uid(), t: 'rect', c, w, x0, y0, x1, y1 }]);
    } else if (msg.tool === 'circle') {
      // Eskide çember MERKEZ + yarıçap idi; v2 elipsi sınırlayıcı kutu alır.
      const rx = Math.abs(x1 - x0), ry = Math.abs(y1 - y0);
      addOps([{ id: uid(), t: 'ellipse', c, w, x0: x0 - rx, y0: y0 - ry, x1: x0 + rx, y1: y0 + ry }]);
    } else {
      addOps([{ id: uid(), t: 'pen', c, w, p: [x0, y0, x1, y1] }]);
    }
  }

  function handleMessage(peerId, msg) {
    if (!msg || typeof msg.type !== 'string') return false;
    const legacy = msg.type === 'draw' || msg.type === 'wb-clear' || msg.type === 'wb-sync';
    if (!legacy && msg.type.slice(0, 4) !== 'wb2-') return false;
    if (!inited) initWhiteboard();
    if (!ctx) return true;

    switch (msg.type) {
      case 'wb2-hello':
        if (shouldAnswerSync(peerId)) syncTo(peerId);
        break;
      case 'wb2-sync':
        if (Array.isArray(msg.ops)) addOps(msg.ops);
        if (msg.paper && msg.seq === 0) setPaper(msg.paper, false);
        if (board.ops.length) announceRemoteActivity();
        break;
      case 'wb2-add':
        if (Array.isArray(msg.ops) && addOps(msg.ops)) announceRemoteActivity();
        break;
      case 'wb2-remove':
        if (Array.isArray(msg.ids)) removeIds(msg.ids);
        break;
      case 'wb2-move':
        if (Array.isArray(msg.ids)) moveIds(msg.ids, Number(msg.dx), Number(msg.dy));
        break;
      case 'wb2-rotate':
        if (Array.isArray(msg.ids)) rotateIds(msg.ids, Number(msg.angle), Number(msg.cx), Number(msg.cy));
        break;
      case 'wb2-scale':
        if (Array.isArray(msg.ids)) scaleIds(msg.ids, Number(msg.factor), Number(msg.cx), Number(msg.cy));
        break;
      case 'wb2-img-begin':
      case 'wb2-img-part':
      case 'wb2-img-end':
        receiveImagePart(msg);
        break;
      case 'wb2-clear':
        clearLocal();
        break;
      case 'wb2-paper':
        setPaper(msg.mode, false);
        break;
      case 'wb2-live':
        applyLive(msg);
        announceRemoteActivity();
        break;
      case 'wb2-live-end':
        board.live.delete(String(msg.id || ''));
        requestRender();
        break;
      case 'wb2-cursor':
        setCursor(peerId, msg);
        break;
      case 'draw':
        legacyDraw(msg);
        announceRemoteActivity();
        break;
      case 'wb-clear':
        clearLocal();
        break;
      case 'wb-sync':
        // Eski sürümün JPEG anlık görüntüsü nesne modeline çevrilemez; yeni
        // istemciler zaten wb2-sync alır. Sessizce yok sayılır.
        break;
      default:
        return true;
    }
    return true;
  }

  /* ------------------------------- kart akışı ---------------------------- */

  function openBoard() {
    state.wbJoined = true;
    call('closeAllCards', false, 'wb-card');
    els.card.classList.remove('hidden');
    call('removeInactiveOverlay', 'wb-card');
    call('makeCardFocusable', els.card);
    call('updateEmptyGrid');
    if (!focusedCardEl()) call('toggleFocus', els.card);
    resize();
    net({ type: 'wb2-hello' });
  }

  function closeBoard() {
    if (draft) { sendLiveEnd(draft.id); draft = null; }
    commitText();
    if (focusedCardEl() === els.card) call('toggleFocus', els.card);
    els.card.classList.add('hidden');
    state.wbJoined = false;
    state.drawing = false;
  }

  /* ------------------------------- yerleşim ------------------------------ */

  function resize() {
    if (!els.canvas || !els.stage) return;
    const rect = els.stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    canvasRect = null;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width), h = Math.round(rect.height);
    const first = viewW === 0;
    viewW = w; viewH = h;
    els.canvas.width = Math.round(w * dpr);
    els.canvas.height = Math.round(h * dpr);
    els.canvas.style.width = w + 'px';
    els.canvas.style.height = h + 'px';
    if (first) fitCamera(40);
    requestRender();
  }

  /* --------------------------------- kurulum ------------------------------ */

  function buildSwatches() {
    if (!els.swatches) return;
    els.swatches.innerHTML = '';
    SWATCHES.forEach(color => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wb-swatch' + (color === 'ink' ? ' wb-swatch-ink' : '');
      btn.dataset.color = color;
      if (color !== 'ink') btn.style.background = color;
      btn.setAttribute('aria-label', color === 'ink' ? 'Zemin karşıtı' : color);
      btn.addEventListener('click', () => setColor(color));
      els.swatches.appendChild(btn);
    });
  }

  function bindUI() {
    els.rail?.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        setTool(btn.dataset.tool);
      });
    });

    els.imageBtn?.addEventListener('click', e => { e.stopPropagation(); pickImage(); });
    els.file?.addEventListener('change', () => {
      const file = els.file.files && els.file.files[0];
      if (file) insertImageFile(file);
    });
    // Panodan yapıştırma: ekran görüntüsü alıp doğrudan tahtaya bırakmak
    // dosya seçiciden geçmekten çok daha hızlı.
    document.addEventListener('paste', e => {
      if (!interactive()) return;
      if (document.activeElement && document.activeElement.closest?.('input, textarea')) return;
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault();
      insertImageFile(file);
    });

    els.styleBtn?.addEventListener('click', e => {
      e.stopPropagation();
      if (els.style.classList.contains('hidden')) openStylePopover(); else closeStylePopover();
    });
    els.style?.addEventListener('click', e => e.stopPropagation());
    els.color?.addEventListener('input', () => setColor(els.color.value));
    els.size?.addEventListener('input', () => setSize(els.size.value));

    els.undo?.addEventListener('click', e => { e.stopPropagation(); undo(); });
    els.redo?.addEventListener('click', e => { e.stopPropagation(); redo(); });
    els.save?.addEventListener('click', e => { e.stopPropagation(); exportPng(); });
    els.gridBtn?.addEventListener('click', e => {
      e.stopPropagation();
      board.grid = !board.grid;
      els.gridBtn.classList.toggle('active', board.grid);
      requestRender();
    });
    els.paperBtn?.addEventListener('click', e => {
      e.stopPropagation();
      setPaper(board.paper === 'light' ? 'dark' : 'light', true);
    });
    els.clear?.addEventListener('click', e => {
      e.stopPropagation();
      clearAll();
    });
    els.close?.addEventListener('click', e => {
      e.stopPropagation();
      closeBoard();
    });

    els.zoomIn?.addEventListener('click', e => { e.stopPropagation(); zoomAt(viewW / 2, viewH / 2, 1.25); });
    els.zoomOut?.addEventListener('click', e => { e.stopPropagation(); zoomAt(viewW / 2, viewH / 2, 1 / 1.25); });
    els.zoomLevel?.addEventListener('click', e => { e.stopPropagation(); resetZoom(); });
    els.fit?.addEventListener('click', e => {
      e.stopPropagation();
      fitCamera();
      requestRender();
    });

    els.canvas.addEventListener('pointerdown', onPointerDown);
    els.canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    els.canvas.addEventListener('wheel', onWheel, { passive: false });
    els.canvas.addEventListener('contextmenu', e => e.preventDefault());

    // YAKALAMA aşaması şart: renderer.js'teki kısayol kapısı (document, bubble)
    // M/D/C/S/R/F tuşlarında stopImmediatePropagation çağırıyor. Bubble'da
    // dinlersek "R = dikdörtgen" gibi tahta kısayolları hiç ulaşmaz. Kapı zaten
    // etkinlik kartı önplandayken uygulama kısayollarını çalıştırmıyor.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);

    document.getElementById('wb-btn')?.addEventListener('click', () => {
      if (els.card.classList.contains('hidden')) openBoard(); else closeBoard();
    });

    // Kart görünür/odaklı hale geldiğinde tuval ölçüsü değişir; ResizeObserver
    // hem odak geçişini hem pencere boyutunu tek yerden yakalar.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => resize()).observe(els.stage);
    } else {
      window.addEventListener('resize', resize);
    }
    // Odağa girip çıkma sırasında (kart .focused sınıfı alır) küçük önizleme
    // kadrajını yeniden hesapla.
    new MutationObserver(() => {
      autoFit = !isFocusedCard();
      canvasRect = null;   // odak geçişinde kart yer değiştirir
      // Alt çubuktaki "Tahta" düğmesi açık/kapalı durumu buradan türer: kart
      // closeAllCards() gibi dışarıdan da gizlenebiliyor, tek doğru kaynak
      // kartın kendisidir.
      document.getElementById('wb-btn')?.classList
        .toggle('wb-open', !els.card.classList.contains('hidden'));
      requestRender();
    }).observe(els.card, { attributes: true, attributeFilter: ['class'] });

    setInterval(sweepLive, 2000);
  }

  function initWhiteboard() {
    if (inited) return;
    const card = document.getElementById('wb-card');
    const canvas = document.getElementById('wb-canvas');
    if (!card || !canvas) return;
    inited = true;

    Object.assign(els, {
      card,
      canvas,
      stage: card.querySelector('.wb-stage'),
      layer: document.getElementById('wb-layer'),
      rail: document.getElementById('wb-rail'),
      style: document.getElementById('wb-style'),
      styleBtn: document.getElementById('wb-style-btn'),
      imageBtn: document.getElementById('wb-image-btn'),
      file: document.getElementById('wb-file'),
      colorDot: document.getElementById('wb-color-dot'),
      swatches: document.getElementById('wb-swatches'),
      color: document.getElementById('wb-color'),
      size: document.getElementById('wb-size'),
      sizeDot: document.getElementById('wb-size-dot'),
      sizeValue: document.getElementById('wb-size-value'),
      undo: document.getElementById('wb-undo'),
      redo: document.getElementById('wb-redo'),
      save: document.getElementById('wb-save'),
      gridBtn: document.getElementById('wb-grid'),
      paperBtn: document.getElementById('wb-paper'),
      clear: document.getElementById('wb-clear'),
      close: document.getElementById('wb-close'),
      zoomIn: document.getElementById('wb-zoom-in'),
      zoomOut: document.getElementById('wb-zoom-out'),
      zoomLevel: document.getElementById('wb-zoom-level'),
      fit: document.getElementById('wb-fit'),
      probe: card.querySelector('.wb-accent-probe')
    });

    ctx = canvas.getContext('2d');
    state.wbContext = ctx;   // eski kod yolları "tahta hazır mı" diye buna bakıyor

    buildSwatches();
    bindUI();
    setPaper(board.paper, false);
    setTool('pen');
    setColor('ink');
    setSize(board.size);
    els.gridBtn?.classList.toggle('active', board.grid);
    updateHistoryButtons();
    call('makeCardFocusable', card);
    resize();
  }

  // Odadan çıkışta çağrılır: tahta bir odaya aittir, sonraki odaya taşınmaz.
  function resetBoard() {
    if (!inited) return;
    if (draft) { draft = null; }
    if (editor) { editor.el.remove(); editor = null; }
    drag = null;
    board.undo.length = 0;
    board.redo.length = 0;
    staticKey = '';
    staticCam = null;
    staticPaintVersion = -1;
    staticPaintMs = 0;
    camBusy = false;
    clearTimeout(camBusyTimer);
    gridStyleKey = '';
    canvasRect = null;
    board.cursors.forEach(cur => cur.el.remove());
    board.cursors.clear();
    images.clear();
    imageParts.clear();
    clearLocal();
    updateHistoryButtons();
    state.wbJoined = false;
    state.drawing = false;
    autoFit = true;
    viewW = 0; viewH = 0;   // yeniden açılışta kadraj sıfırlansın
  }

  window.initWhiteboard = initWhiteboard;
  window.whiteboardHandleMessage = handleMessage;
  window.whiteboardSyncTo = syncTo;
  window.whiteboardOpen = openBoard;
  window.whiteboardReset = resetBoard;
  // Test ve hata ayıklama için okunur bir yüzey (E2E testleri buradan bakar).
  window.whiteboard = {
    board,
    stats,
    get opCount() { return board.ops.length; },
    setTool,
    setColor,
    setSize,
    clearAll,
    undo,
    redo,
    rotateSelection: (angle) => {
      const b = selectionBounds();
      if (!b || !board.selection.size) return false;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const ids = [...board.selection];
      rotateIds(ids, angle, cx, cy);
      net({ type: 'wb2-rotate', ids, angle, cx, cy });
      pushUndo({ k: 'rot', ids, angle, cx, cy });
      return true;
    },
    selectionBounds,
    rotateHandleAt,
    cornerHandles,
    images,
    insertImageFile,
    scaleSelection: (factor) => {
      const b = selectionBounds();
      if (!b || !board.selection.size) return false;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const ids = [...board.selection];
      scaleIds(ids, factor, cx, cy);
      net({ type: 'wb2-scale', ids, factor, cx, cy });
      pushUndo({ k: 'scale', ids, factor, cx, cy });
      return true;
    },
    fit: () => { fitCamera(); requestRender(); },
    addLocalOps: ops => commitOps(ops.map(sanitize).filter(Boolean)),
    worldToScreen,
    screenToWorld
  };
})();
