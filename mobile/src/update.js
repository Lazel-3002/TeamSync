// Uygulama içi güncelleme denetimi (yalnızca Android uygulamasında).
// GitHub'daki mobil release'lere bakar (etiket mobil-vX.Y.Z); masaüstü
// release'leri (vX.Y.Z) karışmaz. Play Store yok, bu yüzden güncellemeyi
// uygulama kendisi bulur: APK indirilir, Android kurulum ekranı açılır.
const REPO = 'Lazel-3002/TeamSync';
const TAG_RE = /^mobil-v(\d+)\.(\d+)\.(\d+)$/;

function parse(v) {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}

function newer(a, b) {
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

// Dönüş: { version, url, notes } ya da null (güncel / bağlantı yok).
export async function checkForUpdate(currentVersion) {
  const cur = parse(currentVersion);
  if (!cur) return null;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const list = await res.json();
  let best = null;
  for (const r of Array.isArray(list) ? list : []) {
    const m = TAG_RE.exec(r && r.tag_name);
    if (!m || r.draft || r.prerelease) continue;
    const ver = m.slice(1).map(Number);
    const apk = (r.assets || []).find(a => /\.apk$/i.test(a.name));
    if (!apk) continue;
    if (!best || newer(ver, best.ver)) best = { ver, version: ver.join('.'), url: apk.browser_download_url, notes: r.body || '' };
  }
  return best && newer(best.ver, cur) ? best : null;
}
