(() => {
  'use strict';

  const DB_NAME = 'teamsync-media-library';
  const DB_VERSION = 1;
  const STORE_NAME = 'items';
  const MAX_FILE_SIZE = 20 * 1024 * 1024;

  let dbPromise = null;
  let settingsFilter = 'all';
  let pickerFilter = 'all';
  let pickerQuery = '';
  let activeAttachmentInputId = 'dm-file-input';
  let attachmentMenuRequestId = 0;
  const settingsObjectUrls = new Set();
  const pickerObjectUrls = new Set();

  function text(key, fallback) {
    return typeof window.t === 'function' ? window.t(key) : fallback;
  }

  function notify(key, fallback, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(text(key, fallback), type);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function detectKind(file) {
    const name = (file && file.name ? file.name : '').toLowerCase();
    const mime = (file && file.type ? file.type : '').toLowerCase();
    if (mime === 'image/gif' || /\.gif$/i.test(name)) return 'gif';
    if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(name)) return 'video';
    if (mime.startsWith('image/') || /\.(png|jpe?g|jfif|webp|bmp|avif|svg|ico|heic|heif|tiff?)$/i.test(name)) return 'image';
    return null;
  }

  function fallbackMime(file, kind) {
    if (file.type) return file.type;
    if (kind === 'gif') return 'image/gif';
    if (kind === 'video') return 'video/mp4';
    return 'image/png';
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('fingerprint', 'fingerprint', { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB açılamadı'));
    });
    return dbPromise;
  }

  async function requestFromStore(mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let request;
      try {
        request = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getItems() {
    const items = await requestFromStore('readonly', store => store.getAll());
    return (items || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function getItem(id) {
    return requestFromStore('readonly', store => store.get(id));
  }

  async function deleteItem(id, ask = true) {
    const item = await getItem(id);
    if (!item) return false;
    if (ask && typeof window.showConfirm === 'function') {
      const accepted = await window.showConfirm(
        text('mediaLibrary.deleteTitle', 'Medyayı sil'),
        text('mediaLibrary.deleteConfirm', 'Bu medya kütüphanenden kalıcı olarak silinsin mi?')
      );
      if (!accepted) return false;
    }
    await requestFromStore('readwrite', store => store.delete(id));
    notify('mediaLibrary.deleted', 'Medya kütüphaneden silindi.', 'ok');
    await refreshLibrarySurfaces();
    return true;
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return { added: 0, rejected: 0, duplicates: 0 };

    let added = 0;
    let rejected = 0;
    let duplicates = 0;
    let unsupported = 0;
    let tooLarge = 0;
    let empty = 0;
    let storageErrors = 0;

    for (const file of files) {
      const kind = detectKind(file);
      if (!kind) {
        unsupported++;
        rejected++;
        continue;
      }
      if (!file.size) {
        empty++;
        rejected++;
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        tooLarge++;
        rejected++;
        continue;
      }
      const fingerprint = `${file.name}:${file.size}:${file.lastModified || 0}`;
      const record = {
        id: crypto.randomUUID(),
        name: String(file.name || `media-${Date.now()}`).slice(0, 180),
        type: fallbackMime(file, kind),
        kind,
        size: file.size,
        lastModified: file.lastModified || Date.now(),
        createdAt: Date.now(),
        fingerprint,
        blob: file.slice(0, file.size, fallbackMime(file, kind))
      };
      try {
        await requestFromStore('readwrite', store => store.add(record));
        added++;
      } catch (error) {
        if (error && error.name === 'ConstraintError') duplicates++;
        else {
          storageErrors++;
          rejected++;
          console.error('Medya yerel kütüphaneye kaydedilemedi:', error);
        }
      }
    }

    if (added) notify('mediaLibrary.added', 'Medya bu bilgisayardaki kütüphanene eklendi.', 'ok');
    if (duplicates) notify('mediaLibrary.duplicate', 'Bu medya zaten kütüphanende.', 'info');
    if (tooLarge) notify('mediaLibrary.tooLarge', 'Dosya 20 MB sınırını aşıyor.', 'warn');
    if (unsupported) notify('mediaLibrary.unsupported', 'Bu dosya fotoğraf, GIF veya desteklenen bir video değil.', 'warn');
    if (empty) notify('mediaLibrary.emptyFile', 'Dosya boş veya okunamıyor.', 'warn');
    if (storageErrors) notify('mediaLibrary.storageError', 'Dosya bu bilgisayara kaydedilemedi. Boş disk alanını kontrol et.', 'warn');
    await refreshLibrarySurfaces();
    return { added, rejected, duplicates };
  }

  function releaseUrls(bucket) {
    bucket.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (error) {}
    });
    bucket.clear();
  }

  function createMediaPreview(item, bucket, className) {
    const url = URL.createObjectURL(item.blob);
    bucket.add(url);
    let element;
    if (item.kind === 'video') {
      element = document.createElement('video');
      element.src = url;
      element.muted = true;
      element.loop = true;
      element.autoplay = true;
      element.playsInline = true;
      element.preload = 'metadata';
      element.setAttribute('aria-label', item.name);
    } else {
      element = document.createElement('img');
      element.src = url;
      element.alt = item.name;
      element.loading = 'lazy';
      element.decoding = 'async';
    }
    element.className = className;
    return element;
  }

  function matchesFilter(item, filter) {
    if (filter === 'all') return true;
    return item.kind === filter;
  }

  function mediaBadge(item) {
    if (item.kind === 'gif') return 'GIF';
    if (item.kind === 'video') return 'VIDEO';
    return 'IMG';
  }

  function createSettingsCard(item) {
    const card = document.createElement('article');
    card.className = 'media-library-card';
    card.dataset.mediaId = item.id;

    const preview = document.createElement('div');
    preview.className = 'media-library-preview';
    preview.appendChild(createMediaPreview(item, settingsObjectUrls, 'media-library-media'));

    const badge = document.createElement('span');
    badge.className = `media-kind-badge ${item.kind}`;
    badge.textContent = mediaBadge(item);
    preview.appendChild(badge);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'media-library-delete';
    remove.title = text('mediaLibrary.delete', 'Sil');
    remove.setAttribute('aria-label', `${text('mediaLibrary.delete', 'Sil')}: ${item.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => deleteItem(item.id, true));
    preview.appendChild(remove);

    const info = document.createElement('div');
    info.className = 'media-library-info';
    const name = document.createElement('strong');
    name.textContent = item.name;
    name.title = item.name;
    const meta = document.createElement('span');
    meta.textContent = `${mediaBadge(item)} · ${formatBytes(item.size)}`;
    info.append(name, meta);

    card.append(preview, info);
    return card;
  }

  async function renderSettings() {
    const grid = document.getElementById('settings-media-grid');
    const empty = document.getElementById('settings-media-empty');
    if (!grid || !empty) return;
    const items = await getItems();
    releaseUrls(settingsObjectUrls);
    grid.innerHTML = '';
    const visible = items.filter(item => matchesFilter(item, settingsFilter));
    visible.forEach(item => grid.appendChild(createSettingsCard(item)));
    grid.classList.toggle('hidden', visible.length === 0);
    empty.classList.toggle('hidden', visible.length !== 0);
    const count = document.getElementById('settings-media-count');
    const size = document.getElementById('settings-media-size');
    if (count) count.textContent = String(items.length);
    if (size) size.textContent = formatBytes(items.reduce((sum, item) => sum + (item.size || 0), 0));
    updateLibraryCount(items.length);
  }

  function createPickerCard(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-picker-card';
    button.dataset.mediaId = item.id;
    button.title = `${item.name} · ${formatBytes(item.size)}`;

    const preview = document.createElement('span');
    preview.className = 'media-picker-preview';
    preview.appendChild(createMediaPreview(item, pickerObjectUrls, 'media-picker-media'));
    const badge = document.createElement('span');
    badge.className = `media-kind-badge ${item.kind}`;
    badge.textContent = mediaBadge(item);
    preview.appendChild(badge);

    const caption = document.createElement('span');
    caption.className = 'media-picker-caption';
    const name = document.createElement('strong');
    name.textContent = item.name;
    const size = document.createElement('small');
    size.textContent = formatBytes(item.size);
    caption.append(name, size);
    button.append(preview, caption);

    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.classList.add('sending');
      const file = new File([item.blob], item.name, {
        type: item.type,
        lastModified: item.lastModified || Date.now()
      });
      const sent = typeof window.sendDMFile === 'function' ? await window.sendDMFile(file) : false;
      if (sent) {
        closePicker();
        notify('mediaPicker.sent', 'Kayıtlı medya gönderildi.', 'ok');
      } else {
        button.disabled = false;
        button.classList.remove('sending');
      }
    });
    return button;
  }

  async function renderPicker() {
    const grid = document.getElementById('media-picker-grid');
    const empty = document.getElementById('media-picker-empty');
    if (!grid || !empty) return;
    const items = await getItems();
    releaseUrls(pickerObjectUrls);
    grid.innerHTML = '';
    const query = pickerQuery.trim().toLocaleLowerCase(getUserLocale());
    const visible = items.filter(item => {
      if (!matchesFilter(item, pickerFilter)) return false;
      return !query || item.name.toLocaleLowerCase(getUserLocale()).includes(query);
    });
    visible.forEach(item => grid.appendChild(createPickerCard(item)));
    grid.classList.toggle('hidden', visible.length === 0);
    empty.classList.toggle('hidden', visible.length !== 0);
    const count = document.getElementById('media-picker-count');
    if (count) count.textContent = `${visible.length} / ${items.length}`;
    updateLibraryCount(items.length);
  }

  function getUserLocale() {
    return document.documentElement.lang === 'en' ? 'en-US' : 'tr-TR';
  }

  function updateLibraryCount(count) {
    const badge = document.getElementById('dm-attach-library-count');
    if (!badge) return;
    badge.textContent = String(count);
    badge.classList.toggle('empty', count === 0);
  }

  async function refreshLibrarySurfaces() {
    const items = await getItems();
    updateLibraryCount(items.length);
    if (document.querySelector('[data-settings-content="media"].active')) await renderSettings();
    if (!document.getElementById('media-picker-modal')?.classList.contains('hidden')) await renderPicker();
  }

  function setChipGroup(container, filter) {
    if (!container) return;
    container.querySelectorAll('[data-media-filter]').forEach(button => {
      button.classList.toggle('active', button.dataset.mediaFilter === filter);
    });
  }

  async function openPicker() {
    closeAttachmentMenu();
    const modal = document.getElementById('media-picker-modal');
    if (!modal) return;
    pickerFilter = 'all';
    pickerQuery = '';
    const search = document.getElementById('media-picker-search');
    if (search) search.value = '';
    setChipGroup(document.getElementById('media-picker-filters'), pickerFilter);
    modal.classList.remove('hidden');
    await renderPicker();
    setTimeout(() => search?.focus(), 80);
  }

  function closePicker() {
    const modal = document.getElementById('media-picker-modal');
    if (modal) modal.classList.add('hidden');
    releaseUrls(pickerObjectUrls);
  }

  function closeAttachmentMenu() {
    attachmentMenuRequestId++;
    document.getElementById('dm-attach-menu')?.classList.add('hidden');
  }

  async function openAttachmentMenu(button, inputId) {
    if (!state.activeDM) {
      notify('attach.selectFriend', 'Önce mesaj göndereceğin bir arkadaş seç.', 'warn');
      return;
    }
    activeAttachmentInputId = inputId || 'dm-file-input';
    const menu = document.getElementById('dm-attach-menu');
    if (!menu || !button) return;
    const requestId = ++attachmentMenuRequestId;
    const items = await getItems();
    if (requestId !== attachmentMenuRequestId) return;
    updateLibraryCount(items.length);
    menu.classList.remove('hidden');
    menu.style.visibility = 'hidden';
    const rect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(window.innerWidth - menuRect.width - 12, Math.max(12, rect.left));
    let top = rect.top - menuRect.height - 10;
    if (top < 12) top = Math.min(window.innerHeight - menuRect.height - 12, rect.bottom + 10);
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(12, top)}px`;
    menu.style.visibility = 'visible';
  }

  function bindFilterGroup(id, callback) {
    const container = document.getElementById(id);
    container?.addEventListener('click', event => {
      const button = event.target.closest('[data-media-filter]');
      if (!button) return;
      callback(button.dataset.mediaFilter);
      setChipGroup(container, button.dataset.mediaFilter);
    });
  }

  function bindDropzone(dropzone, input) {
    if (!dropzone || !input) return;
    dropzone.addEventListener('click', () => input.click());
    ['dragenter', 'dragover'].forEach(type => {
      dropzone.addEventListener(type, event => {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach(type => {
      dropzone.addEventListener(type, event => {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.remove('dragging');
      });
    });
    dropzone.addEventListener('drop', event => addFiles(event.dataTransfer.files));
  }

  async function init() {
    const picker = document.getElementById('media-picker-modal');
    const menu = document.getElementById('dm-attach-menu');
    if (picker && picker.parentElement !== document.body) document.body.appendChild(picker);
    if (menu && menu.parentElement !== document.body) document.body.appendChild(menu);

    const settingsInput = document.getElementById('settings-media-input');
    document.getElementById('settings-media-add')?.addEventListener('click', () => settingsInput?.click());
    settingsInput?.addEventListener('change', async event => {
      await addFiles(event.target.files);
      event.target.value = '';
    });
    bindDropzone(document.getElementById('settings-media-dropzone'), settingsInput);

    bindFilterGroup('settings-media-filters', async filter => {
      settingsFilter = filter;
      await renderSettings();
    });
    bindFilterGroup('media-picker-filters', async filter => {
      pickerFilter = filter;
      await renderPicker();
    });

    document.getElementById('media-picker-search')?.addEventListener('input', async event => {
      pickerQuery = event.target.value;
      await renderPicker();
    });
    document.getElementById('media-picker-close')?.addEventListener('click', closePicker);
    document.getElementById('media-picker-modal')?.addEventListener('click', event => {
      if (event.target.id === 'media-picker-modal') closePicker();
    });
    document.getElementById('media-picker-open-settings')?.addEventListener('click', () => {
      closePicker();
      if (typeof window.openUserSettings === 'function') window.openUserSettings('media');
    });

    document.getElementById('dm-attach-external')?.addEventListener('click', () => {
      closeAttachmentMenu();
      document.getElementById(activeAttachmentInputId)?.click();
    });
    document.getElementById('dm-attach-library')?.addEventListener('click', openPicker);

    document.addEventListener('pointerdown', event => {
      const attachMenu = document.getElementById('dm-attach-menu');
      if (!attachMenu || attachMenu.classList.contains('hidden')) return;
      if (event.target.closest('#dm-attach-menu, #dm-btn-file, #server-dm-btn-file')) return;
      closeAttachmentMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      closeAttachmentMenu();
      closePicker();
    });
    window.addEventListener('resize', closeAttachmentMenu);
    await refreshLibrarySurfaces();
  }

  window.TeamSyncMediaLibrary = {
    addFiles,
    getItems,
    getItem,
    deleteItem,
    renderSettings,
    renderPicker,
    openPicker,
    closePicker,
    refresh: refreshLibrarySurfaces,
    maxFileSize: MAX_FILE_SIZE
  };
  window.openDMAttachmentMenu = openAttachmentMenu;
  window.closeDMAttachmentMenu = closeAttachmentMenu;
  window.releaseMediaLibrarySettingsUrls = () => releaseUrls(settingsObjectUrls);

  document.addEventListener('DOMContentLoaded', init);
})();
