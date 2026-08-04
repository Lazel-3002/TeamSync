(() => {
  'use strict';

  // Sohbette ya da odada paylaşılan bir GIF/görsel/videonun üstüne gelince
  // "Koleksiyona ekle" düğmesi belirir ve medya, kullanıcının kendi
  // kütüphanesine (media-library.js) kaydedilir.
  //
  // DİKKAT: CSP'de connect-src blob:/data: içermediği için buradaki kaynakları
  // fetch()/XHR ile okuyamayız. Bu yüzden iki yol kullanılır:
  //   1) blob: URL'ler — oluşturuldukları anda registerChatMedia() ile kaydedilen
  //      Blob nesnesinden okunur (oda sohbeti dosya alışverişi).
  //   2) data: URL'ler — atob ile elle çözülür (DM baloncukları).
  // Canvas'a çizip yeniden kodlamak GIF animasyonunu düşürdüğü için tercih
  // edilmez.

  const MEDIA_SELECTOR = '.img-wrap img.chat-img, .dm-msg img, .dm-msg video';
  const MAX_NAME_LENGTH = 120;

  // blob: URL -> { blob, name }. Sohbet blob URL'leri odadan çıkarken revoke
  // edildiği için kayıtlar da forgetChatMedia() ile düşürülür.
  const blobRegistry = new Map();

  const EXTENSION_BY_MIME = {
    'image/gif': 'gif',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov'
  };

  let button = null;
  let activeNode = null;
  let hideTimer = 0;

  function text(key, fallback) {
    return typeof window.t === 'function' ? window.t(key) : fallback;
  }

  function notify(key, fallback, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(text(key, fallback), type);
  }

  window.registerChatMedia = (url, blob, name) => {
    if (url && blob) blobRegistry.set(url, { blob, name: name || '' });
    return url;
  };

  window.forgetChatMedia = url => {
    blobRegistry.delete(url);
  };

  function blobFromDataUrl(url) {
    const match = /^data:([^,;]*)(;base64)?,([\s\S]*)$/.exec(url);
    if (!match) return null;
    const mime = match[1] || 'application/octet-stream';
    try {
      const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
      const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
      return new Blob([bytes], { type: mime });
    } catch (error) {
      console.warn('Koleksiyon: data URL çözülemedi', error);
      return null;
    }
  }

  function cleanName(rawName, mime) {
    const base = String(rawName || '').split(/[\\/]/).pop().trim().slice(0, MAX_NAME_LENGTH);
    const extension = EXTENSION_BY_MIME[String(mime || '').toLowerCase()] || 'bin';
    if (!base) return `medya.${extension}`;
    return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${extension}`;
  }

  // Düğmenin gösterilip gösterilmeyeceğini belirler: kaynağı okuyamayacaksak
  // ölü bir düğme göstermeyiz.
  function sourceOf(node) {
    if (!node) return '';
    return node.currentSrc || node.getAttribute('src') || '';
  }

  function isCollectable(node) {
    const source = sourceOf(node);
    if (!source) return false;
    if (source.startsWith('data:')) return /^data:(image|video)\//i.test(source);
    if (source.startsWith('blob:')) return blobRegistry.has(source);
    return false;
  }

  function resolveFile(node) {
    const source = sourceOf(node);
    let blob = null;
    let name = node.dataset.mediaName || node.getAttribute('alt') || '';
    if (source.startsWith('blob:')) {
      const entry = blobRegistry.get(source);
      if (!entry) return null;
      blob = entry.blob;
      if (!name) name = entry.name;
    } else if (source.startsWith('data:')) {
      blob = blobFromDataUrl(source);
    }
    if (!blob || !blob.size) return null;
    // lastModified sabit tutulur: aynı GIF ikinci kez eklenmek istenirse
    // kütüphanenin parmak izi (ad:boyut:tarih) eşleşir ve "zaten kütüphanende"
    // uyarısı verilir, kopya birikmez.
    return new File([blob], cleanName(name, blob.type), {
      type: blob.type || 'application/octet-stream',
      lastModified: 0
    });
  }

  function ensureButton() {
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'media-collect-btn';
    button.className = 'media-collect-btn hidden';
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path><line x1="12" y1="7" x2="12" y2="13"></line><line x1="9" y1="10" x2="15" y2="10"></line></svg><span class="media-collect-label"></span>`;
    button.addEventListener('click', collectActive);
    button.addEventListener('pointerenter', () => window.clearTimeout(hideTimer));
    button.addEventListener('pointerleave', scheduleHide);
    document.body.appendChild(button);
    return button;
  }

  function position(node) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    // İndirme düğmesi sağ üstte duruyor; koleksiyon düğmesi sol üstte durur.
    button.style.left = `${Math.round(rect.left + 8)}px`;
    button.style.top = `${Math.round(rect.top + 8)}px`;
    button.style.maxWidth = `${Math.max(40, Math.round(rect.width - 52))}px`;
    return true;
  }

  function show(node) {
    if (!isCollectable(node)) return;
    window.clearTimeout(hideTimer);
    ensureButton();
    activeNode = node;
    const label = text('mediaCollect.add', 'Koleksiyona ekle');
    button.querySelector('.media-collect-label').textContent = label;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.disabled = false;
    button.classList.remove('hidden');
    if (!position(node)) hide();
  }

  function hide() {
    window.clearTimeout(hideTimer);
    activeNode = null;
    if (button) button.classList.add('hidden');
  }

  function scheduleHide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, 140);
  }

  async function collectActive() {
    const node = activeNode;
    if (!node || !window.TeamSyncMediaLibrary) return;
    button.disabled = true;
    let file = null;
    try {
      file = resolveFile(node);
    } catch (error) {
      console.error('Koleksiyona ekleme hatası:', error);
    }
    if (!file) {
      button.disabled = false;
      notify('mediaCollect.failed', 'Bu medya koleksiyona eklenemedi.', 'warn');
      return;
    }
    hide();
    // review: kaydedilen medyaya hemen isim ve #etiket verilebilsin.
    await window.TeamSyncMediaLibrary.addFiles([file], { review: true });
  }

  function bind() {
    document.addEventListener('pointerover', event => {
      const node = event.target instanceof Element ? event.target.closest(MEDIA_SELECTOR) : null;
      if (!node) return;
      if (node !== activeNode) show(node);
      else window.clearTimeout(hideTimer);
    });
    document.addEventListener('pointerout', event => {
      if (!activeNode) return;
      const node = event.target instanceof Element ? event.target.closest(MEDIA_SELECTOR) : null;
      if (node !== activeNode) return;
      const next = event.relatedTarget;
      if (next instanceof Node && (activeNode.contains(next) || (button && button.contains(next)))) return;
      scheduleHide();
    });
    // Kaydırma/yeniden boyutlanma sırasında düğme görselden kopmasın.
    document.addEventListener('scroll', () => {
      if (activeNode) hide();
    }, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') hide();
    });
  }

  window.TeamSyncMediaCollect = {
    registerChatMedia: window.registerChatMedia,
    forgetChatMedia: window.forgetChatMedia,
    resolveFile,
    isCollectable,
    collectFrom: node => {
      activeNode = node;
      ensureButton();
      return collectActive();
    },
    button: () => button
  };

  document.addEventListener('DOMContentLoaded', bind);
})();
