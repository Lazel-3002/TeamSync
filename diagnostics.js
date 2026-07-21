// ---------------------------------------------------------------------------
// Teşhis günlüğü (diagnostics)
//
// Amaç: "indirme butonu neden mor/kare görünüyor?" gibi görsel/CSS sorunlarını
// tahmin etmeden kanıtla çözmek. Disktesteki style.css ile renderer'ın GERÇEKTEN
// yüklediği CSS'i, .dl-btn'in HESAPLANMIŞ (computed) stilini, çakışan kuralları,
// donanım hızlandırma durumunu, tüm ayarları ve uygulama yollarını tek bir
// dosyaya döker.
//
// Açma: `DIAG=1` ortam değişkeni (ör. `npm run diag`) VEYA settings.json içinde
// { "diagnosticLog": true }. Kapalıyken hiçbir maliyeti yoktur.
//
// Çıktı: <proje|userData>/diagnostics/diag-<zaman>.log  (konsola da yol yazılır)
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let _app = null;
let _logPath = null;
let _enabled = false;

function _ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function _append(text) {
  if (!_enabled || !_logPath) return;
  try { fs.appendFileSync(_logPath, text + '\n', 'utf8'); } catch (e) { /* yut */ }
}

function _section(title) {
  _append('\n' + '='.repeat(78));
  _append(`  ${title}`);
  _append('='.repeat(78));
}

// .dl-btn { ... } bloğunu ham metinden çıkarır (ilk eşleşme).
function _extractRule(css, selector) {
  const results = [];
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(?:,[^{]*)?\\{[^}]*\\}', 'g');
  let m;
  while ((m = re.exec(css)) !== null) results.push(m[0].replace(/\s+/g, ' ').trim());
  return results;
}

function _analyzeCssText(label, css) {
  _append(`  [${label}] uzunluk=${css.length} karakter`);
  _append(`  [${label}] sha256=${crypto.createHash('sha256').update(css).digest('hex')}`);
  const markers = {
    "backdrop-filter içeriyor mu?": /backdrop-filter/.test(css),
    "'.dl-btn' geçiyor mu?": /\.dl-btn/.test(css),
    "'border-radius: 17px' (yeni yuvarlak)": /border-radius:\s*17px/.test(css),
    "'rgba(20, 26, 40' (yeni yarı saydam zemin)": /rgba\(20,\s*26,\s*40/.test(css),
    "'saturate(' (eski cam)": /saturate\(/.test(css),
    "'#0d1220' (img-wrap nötr dolgu)": /#0d1220/.test(css),
  };
  for (const [k, v] of Object.entries(markers)) _append(`  [${label}] ${k}  ->  ${v ? 'EVET' : 'hayır'}`);
  const rules = _extractRule(css, '.dl-btn');
  _append(`  [${label}] bulunan .dl-btn kural sayısı: ${rules.length}`);
  rules.forEach((r, i) => _append(`  [${label}] .dl-btn #${i + 1}: ${r.slice(0, 400)}`));
}

// Uygulama başında (ready sonrası) ana süreç tarafını dök.
function init(app, { settingsPath, effectiveHardwareAccel, loadedTarget } = {}) {
  _app = app;
  _enabled = process.env.DIAG === '1';
  // settings.json'daki bayrağı da kontrol et
  try {
    if (!_enabled && settingsPath && fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (s && s.diagnosticLog === true) _enabled = true;
    }
  } catch (e) { /* yut */ }

  if (!_enabled) return { enabled: false };

  const base = app.isPackaged ? app.getPath('userData') : app.getAppPath();
  const dir = path.join(base, 'diagnostics');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* yut */ }
  const stamp = _ts().replace(/[: ]/g, '-').replace(/\./g, '_');
  _logPath = path.join(dir, `diag-${stamp}.log`);

  _append(`TeamSync/KankaVoice TEŞHİS GÜNLÜĞÜ`);
  _append(`oluşturma: ${_ts()}`);
  _append(`bu dosya: ${_logPath}`);

  _section('UYGULAMA & YOLLAR');
  _append(`  app sürümü:        ${(() => { try { return require('./package.json').version; } catch { return '?'; } })()}`);
  _append(`  electron:          ${process.versions.electron}`);
  _append(`  chrome:            ${process.versions.chrome}`);
  _append(`  node:              ${process.versions.node}`);
  _append(`  platform/arch:     ${process.platform}/${process.arch}`);
  _append(`  isPackaged:        ${app.isPackaged}`);
  _append(`  app.getAppPath():  ${app.getAppPath()}`);
  _append(`  __dirname:         ${__dirname}`);
  _append(`  process.cwd():     ${process.cwd()}`);
  _append(`  execPath:          ${process.execPath}`);
  _append(`  resourcesPath:     ${process.resourcesPath}`);
  _append(`  userData (etkin):  ${app.getPath('userData')}`);
  _append(`  YÜKLENEN HEDEF:    ${loadedTarget || '(bilinmiyor)'}`);

  _section('DONANIM HIZLANDIRMA & GPU');
  _append(`  settings.hardwareAcceleration etkin -> ${effectiveHardwareAccel}`);
  try {
    const gpu = app.getGPUFeatureStatus ? app.getGPUFeatureStatus() : null;
    _append(`  app.getGPUFeatureStatus():`);
    if (gpu) for (const [k, v] of Object.entries(gpu)) _append(`      ${k}: ${v}`);
  } catch (e) { _append(`  GPU durumu alınamadı: ${e.message}`); }

  _section('AYARLAR (settings.json)');
  try {
    _append(`  yol: ${settingsPath}`);
    if (settingsPath && fs.existsSync(settingsPath)) {
      _append(fs.readFileSync(settingsPath, 'utf8').split('\n').map(l => '  ' + l).join('\n'));
    } else {
      _append('  settings.json YOK — tüm varsayılanlar geçerli.');
    }
  } catch (e) { _append(`  okunamadı: ${e.message}`); }

  // Diskteki index.html + style.css — uygulamanın baktığı yerde ne var?
  _section('DİSKTEKİ DOSYALAR (app.getAppPath tabanlı)');
  const appDir = app.getAppPath();
  try {
    const idxPath = path.join(appDir, 'index.html');
    _append(`  index.html: ${idxPath}  (var mı: ${fs.existsSync(idxPath)})`);
    if (fs.existsSync(idxPath)) {
      const idx = fs.readFileSync(idxPath, 'utf8');
      const links = idx.match(/href="style\.css[^"]*"/g) || [];
      _append(`  index.html içindeki style.css referansları: ${JSON.stringify(links)}`);
    }
  } catch (e) { _append(`  index.html okunamadı: ${e.message}`); }
  try {
    const cssPath = path.join(appDir, 'style.css');
    _append(`  style.css: ${cssPath}  (var mı: ${fs.existsSync(cssPath)})`);
    if (fs.existsSync(cssPath)) {
      const st = fs.statSync(cssPath);
      _append(`  style.css mtime: ${st.mtime.toISOString()}  boyut: ${st.size}`);
      _analyzeCssText('DİSK style.css', fs.readFileSync(cssPath, 'utf8'));
    }
  } catch (e) { _append(`  style.css okunamadı: ${e.message}`); }

  console.log(`\n[DIAG] Teşhis günlüğü açık. Yazılıyor: ${_logPath}\n`);
  return { enabled: true, logPath: _logPath };
}

// Renderer'dan gelen (gerçekten yüklenen CSS + hesaplanmış stiller) veriyi ekler.
function appendRenderer(data) {
  if (!_enabled) return;
  _section('RENDERER (tarayıcı) — GERÇEKTE YÜKLENEN & HESAPLANAN');
  try {
    _append(`  location.href:     ${data.href}`);
    _append(`  userAgent:         ${data.userAgent}`);
    _append(`  devicePixelRatio:  ${data.dpr}`);
    _append(`  body.className:    "${data.bodyClass}"  (no-hw-accel var mı: ${/no-hw-accel/.test(data.bodyClass || '')})`);

    _append(`\n  -- Yüklü stylesheet'ler (document.styleSheets) --`);
    (data.sheets || []).forEach((h, i) => _append(`     [${i}] ${h}`));

    _append(`\n  -- Aktif <link> style.css href'i --`);
    _append(`     ${data.styleLinkHref}`);

    if (data.fetchedCss) {
      _append(`\n  -- Renderer'ın FETCH ile aldığı style.css metni (gerçekte yüklenen) --`);
      _analyzeCssText('RENDERER style.css', data.fetchedCss);
    } else {
      _append(`\n  (Renderer style.css metnini fetch edemedi: ${data.fetchError || 'bilinmiyor'})`);
    }

    _append(`\n  -- TÜM stylesheet'lerdeki .dl-btn kuralları (çakışma avı) --`);
    if ((data.matchedRules || []).length === 0) _append('     (hiç .dl-btn kuralı bulunamadı!)');
    (data.matchedRules || []).forEach((r) => _append(`     [${r.source}]  ${r.text}`));

    _append(`\n  -- Gerçek .dl-btn probe'unun HESAPLANMIŞ (computed) stili --`);
    if (data.computed) {
      for (const [k, v] of Object.entries(data.computed)) _append(`     ${k}: ${v}`);
    } else {
      _append('     (.dl-btn probe oluşturulamadı)');
    }

    _append(`\n  >>> YORUM İPUCU:`);
    _append(`      - computed.backgroundColor mor/indigo ise ve backdropFilter "none" değilse -> GPU backdrop bug.`);
    _append(`      - computed.borderRadius 17px değilse -> yeni CSS yüklenmemiş (yanlış dosya/önbellek).`);
    _append(`      - matchedRules içinde ikinci bir .dl-btn (mor) kural varsa -> onu ez.`);
  } catch (e) { _append(`  renderer verisi işlenemedi: ${e.message}`); }
  _append(`\n[DIAG] Günlük tamam: ${_logPath}`);
}

// Canlı DOM'da beliren GERÇEK indirme butonunu (sentetik probe değil) günlükler.
// Böylece kullanıcının gördüğü mor butonun HANGİ eleman olduğu kesinleşir.
function appendCapture(info) {
  if (!_enabled) return;
  _append(`\n[CANLI BUTON YAKALANDI @ ${_ts()}]`);
  _append(`  eleman:       <${(info.tag || '?').toLowerCase()} class="${info.className}">`);
  _append(`  download attr:${info.download}`);
  _append(`  ebeveyn class:${info.parentClass}`);
  _append(`  computed backgroundColor: ${info.backgroundColor}`);
  _append(`  computed backgroundImage: ${info.backgroundImage}`);
  _append(`  computed borderRadius:    ${info.borderRadius}`);
  _append(`  computed boyut:           ${info.width} x ${info.height}`);
  _append(`  outerHTML: ${info.outerHTML}`);
  const bg = (info.backgroundColor || '') + ' ' + (info.backgroundImage || '');
  if (/99,\s*102,\s*241|#6366f1|rgb\(99/i.test(bg)) {
    _append(`  >>> Bu MOR accent (#6366f1) = .text-dl/.msg-file yolu. Görsel 'dosya' olarak sınıflanmış.`);
  } else if (/\.dl-btn/.test(info.className || '')) {
    _append(`  >>> Bu .dl-btn (yuvarlak cam). backgroundColor mor değilse sorun çözülmüş demektir.`);
  }
}

module.exports = { init, appendRenderer, appendCapture, isEnabled: () => _enabled, logPath: () => _logPath };
