(() => {
  'use strict';

  const DB_NAME = 'teamsync-media-library';
  const DB_VERSION = 1;
  const STORE_NAME = 'items';
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const MAX_TAGS = 8;
  const MAX_TAG_LENGTH = 24;
  const MAX_NAME_LENGTH = 180;

  let dbPromise = null;
  let settingsFilter = 'all';
  let pickerFilter = 'all';
  let pickerQuery = '';
  let pickerTag = '';
  let activeAttachmentInputId = 'dm-file-input';
  let activeAttachmentMode = 'dm'; // 'dm' | 'room' — kimin bağlamında açıldığını belirler
  let attachmentMenuRequestId = 0;
  const settingsObjectUrls = new Set();
  const pickerObjectUrls = new Set();
  const detailObjectUrls = new Set();

  // İsim/etiket penceresi: yeni eklenen dosyalar sırayla ("review"), kütüphaneden
  // sağ tıklanan tek dosya ise doğrudan ("edit") gösterilir.
  let detailQueue = [];
  let detailIndex = 0;
  let detailMode = 'edit';
  let detailTags = [];
  let detailResolve = null;

  let contextTarget = null;
  let pickerSearchTimer = null;

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

  function getUserLocale() {
    return document.documentElement.lang === 'en' ? 'en-US' : 'tr-TR';
  }

  // Etiketler kullanıcının yazdığı biçimde saklanır; karşılaştırma her zaman
  // bu yardımcıdan geçer, böylece arayüz dili değişince kayıtlı etiketler bozulmaz.
  function fold(value) {
    return String(value || '').toLocaleLowerCase(getUserLocale());
  }

  function cleanTag(raw) {
    return String(raw || '')
      .replace(/^#+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TAG_LENGTH);
  }

  function parseTagInput(value) {
    return String(value || '')
      .split(/[\s,;]+/)
      .map(cleanTag)
      .filter(Boolean);
  }

  function normalizeTags(list) {
    const source = Array.isArray(list) ? list : parseTagInput(list);
    const seen = new Set();
    const tags = [];
    for (const raw of source) {
      const tag = cleanTag(raw);
      if (!tag) continue;
      const key = fold(tag);
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
      if (tags.length >= MAX_TAGS) break;
    }
    return tags;
  }

  function itemTags(item) {
    return Array.isArray(item && item.tags) ? item.tags : [];
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

  async function updateItem(id, changes = {}) {
    const item = await getItem(id);
    if (!item) return null;
    const next = { ...item };
    if (typeof changes.name === 'string') {
      const name = changes.name.trim().slice(0, MAX_NAME_LENGTH);
      if (name) next.name = name;
    }
    if (changes.tags !== undefined) next.tags = normalizeTags(changes.tags);
    await requestFromStore('readwrite', store => store.put(next));
    await refreshLibrarySurfaces();
    return next;
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

  async function addFiles(fileList, options = {}) {
    const files = Array.from(fileList || []);
    if (!files.length) return { added: 0, rejected: 0, duplicates: 0 };

    let added = 0;
    let rejected = 0;
    let duplicates = 0;
    let unsupported = 0;
    let tooLarge = 0;
    let empty = 0;
    let storageErrors = 0;
    const addedIds = [];

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
        name: String(file.name || `media-${Date.now()}`).slice(0, MAX_NAME_LENGTH),
        type: fallbackMime(file, kind),
        kind,
        size: file.size,
        lastModified: file.lastModified || Date.now(),
        createdAt: Date.now(),
        fingerprint,
        tags: normalizeTags(options.tags),
        blob: file.slice(0, file.size, fallbackMime(file, kind))
      };
      try {
        await requestFromStore('readwrite', store => store.add(record));
        added++;
        addedIds.push(record.id);
      } catch (error) {
        if (error && error.name === 'ConstraintError') duplicates++;
        else {
          storageErrors++;
          rejected++;
          console.error('Medya yerel kütüphaneye kaydedilemedi:', error);
        }
      }
    }

    // İsim/etiket penceresi açılacaksa "eklendi" bildirimi son adımda verilir.
    if (added && !options.review) notify('mediaLibrary.added', 'Medya bu bilgisayardaki kütüphanene eklendi.', 'ok');
    if (duplicates) notify('mediaLibrary.duplicate', 'Bu medya zaten kütüphanende.', 'info');
    if (tooLarge) notify('mediaLibrary.tooLarge', 'Dosya 20 MB sınırını aşıyor.', 'warn');
    if (unsupported) notify('mediaLibrary.unsupported', 'Bu dosya fotoğraf, GIF veya desteklenen bir video değil.', 'warn');
    if (empty) notify('mediaLibrary.emptyFile', 'Dosya boş veya okunamıyor.', 'warn');
    if (storageErrors) notify('mediaLibrary.storageError', 'Dosya bu bilgisayara kaydedilemedi. Boş disk alanını kontrol et.', 'warn');
    await refreshLibrarySurfaces();

    // Dosya zaten kaydedildi; pencere yalnızca ad/etiket sormak için açılır,
    // kapatılsa bile medya kütüphanede kalır.
    if (added && options.review) {
      const items = [];
      for (const id of addedIds) {
        const item = await getItem(id);
        if (item) items.push(item);
      }
      if (items.length) await openMediaDetail(items, 'review');
    }
    return { added, rejected, duplicates };
  }

  function releaseUrls(bucket) {
    bucket.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (error) {}
    });
    bucket.clear();
  }

  // Bir ızgaradaki her GIF/video aynı anda oynarsa (özellikle kaydırılabilir
  // bir listede) CPU/GPU yükü katlanır ve menü "laglı" hissettirir. hoverTarget
  // verildiğinde kart varsayılan olarak durgun bir kare gösterir, yalnızca fare
  // üzerine gelince oynatılır. hoverTarget verilmediğinde (tekil detay
  // önizlemesi gibi zaten tek öğe gösterilen yerlerde) eskisi gibi doğrudan oynar.
  function createMediaPreview(item, bucket, className, hoverTarget) {
    const url = URL.createObjectURL(item.blob);
    bucket.add(url);

    if (item.kind === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', item.name);
      video.className = className;
      if (hoverTarget) {
        hoverTarget.addEventListener('mouseenter', () => { video.play().catch(() => {}); });
        hoverTarget.addEventListener('mouseleave', () => { video.pause(); });
      } else {
        video.autoplay = true;
      }
      return video;
    }

    if (item.kind === 'gif' && hoverTarget) {
      return createHoverGifPreview(item, url, className, hoverTarget);
    }

    const img = document.createElement('img');
    img.src = url;
    img.alt = item.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = className;
    return img;
  }

  // Varsayılan olarak GIF'in ilk karesini bir canvas'a çizip durağan gösterir;
  // <img> animasyonu JS'ten duraklatılamadığı için gerçek oynatan <img>
  // yalnızca hover sırasında DOM'a eklenir, ayrılınca kaldırılır.
  function createHoverGifPreview(item, url, className, hoverTarget) {
    const wrap = document.createElement('span');
    wrap.className = `${className} media-gif-hover`;
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', item.name);

    const canvas = document.createElement('canvas');
    canvas.className = className;
    canvas.setAttribute('aria-hidden', 'true');
    wrap.appendChild(canvas);

    const freeze = new Image();
    freeze.onload = () => {
      canvas.width = freeze.naturalWidth || 1;
      canvas.height = freeze.naturalHeight || 1;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(freeze, 0, 0);
    };
    freeze.src = url;

    let liveImg = null;
    hoverTarget.addEventListener('mouseenter', () => {
      if (liveImg) return;
      liveImg = document.createElement('img');
      liveImg.src = url;
      liveImg.alt = item.name;
      liveImg.className = `${className} media-gif-live`;
      wrap.appendChild(liveImg);
    });
    hoverTarget.addEventListener('mouseleave', () => {
      if (liveImg) { liveImg.remove(); liveImg = null; }
    });

    return wrap;
  }

  function matchesFilter(item, filter) {
    if (filter === 'all') return true;
    return item.kind === filter;
  }

  function matchesQuery(item, query) {
    const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const name = fold(item.name);
    const tags = itemTags(item).map(fold);
    return tokens.every(token => {
      const needle = fold(token.replace(/^#+/, ''));
      if (!needle) return true;
      // "#" ile başlayan arama parçası yalnızca etiketlerde aranır.
      if (token.startsWith('#')) return tags.some(tag => tag.includes(needle));
      return name.includes(needle) || tags.some(tag => tag.includes(needle));
    });
  }

  function matchesTag(item, tag) {
    if (!tag) return true;
    return itemTags(item).some(entry => fold(entry) === fold(tag));
  }

  function mediaBadge(item) {
    if (item.kind === 'gif') return 'GIF';
    if (item.kind === 'video') return 'VIDEO';
    return 'IMG';
  }

  function createTagChipRow(item, limit = 3) {
    const tags = itemTags(item);
    if (!tags.length) return null;
    const row = document.createElement('span');
    row.className = 'media-tag-chips readonly';
    tags.slice(0, limit).forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'media-tag-chip';
      chip.textContent = `#${tag}`;
      row.appendChild(chip);
    });
    if (tags.length > limit) {
      const more = document.createElement('span');
      more.className = 'media-tag-chip muted';
      more.textContent = `+${tags.length - limit}`;
      row.appendChild(more);
    }
    return row;
  }

  function itemTooltip(item) {
    const tags = itemTags(item);
    const parts = [item.name, formatBytes(item.size)];
    if (tags.length) parts.push(tags.map(tag => `#${tag}`).join(' '));
    return parts.join(' · ');
  }

  function createSettingsCard(item) {
    const card = document.createElement('article');
    card.className = 'media-library-card';
    card.dataset.mediaId = item.id;

    const preview = document.createElement('div');
    preview.className = 'media-library-preview';
    preview.appendChild(createMediaPreview(item, settingsObjectUrls, 'media-library-media', preview));

    const badge = document.createElement('span');
    badge.className = `media-kind-badge ${item.kind}`;
    badge.textContent = mediaBadge(item);
    preview.appendChild(badge);

    const actions = document.createElement('div');
    actions.className = 'media-library-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'media-library-action media-library-edit';
    edit.title = text('mediaLibrary.edit', 'İsim ve etiketleri düzenle');
    edit.setAttribute('aria-label', `${text('mediaLibrary.edit', 'İsim ve etiketleri düzenle')}: ${item.name}`);
    edit.textContent = '✎';
    edit.addEventListener('click', () => openMediaDetail([item], 'edit'));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'media-library-action media-library-delete';
    remove.title = text('mediaLibrary.delete', 'Sil');
    remove.setAttribute('aria-label', `${text('mediaLibrary.delete', 'Sil')}: ${item.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => deleteItem(item.id, true));

    actions.append(edit, remove);
    preview.appendChild(actions);

    const info = document.createElement('div');
    info.className = 'media-library-info';
    const name = document.createElement('strong');
    name.textContent = item.name;
    name.title = item.name;
    const meta = document.createElement('span');
    meta.textContent = `${mediaBadge(item)} · ${formatBytes(item.size)}`;
    info.append(name, meta);
    const tagRow = createTagChipRow(item);
    if (tagRow) info.appendChild(tagRow);

    card.append(preview, info);
    card.addEventListener('contextmenu', event => openContextMenu(event, item, 'settings'));
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

  async function sendMediaItem(item, button) {
    const file = new File([item.blob], item.name, {
      type: item.type,
      lastModified: item.lastModified || Date.now()
    });
    let sent = false;
    if (activeAttachmentMode === 'room') {
      // Oda sohbeti: DM'den farklı olarak başarı/başarısızlık dönmez
      // (sendFile kendi ilerleme balonunu kendi oluşturur), o yüzden
      // atılabildiyse (fonksiyon var ve hata fırlatmadıysa) başarılı sayılır.
      if (typeof window.sendFile === 'function') {
        try { await window.sendFile(file); sent = true; } catch (error) { console.error('Oda medya gönderimi hatası:', error); }
      }
    } else {
      sent = typeof window.sendDMFile === 'function' ? await window.sendDMFile(file) : false;
    }
    if (sent) {
      closePicker();
      notify('mediaPicker.sent', 'Kayıtlı medya gönderildi.', 'ok');
    } else if (button) {
      button.disabled = false;
      button.classList.remove('sending');
    }
    return sent;
  }

  function createPickerCard(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-picker-card';
    button.dataset.mediaId = item.id;
    button.title = itemTooltip(item);

    const preview = document.createElement('span');
    preview.className = 'media-picker-preview';
    preview.appendChild(createMediaPreview(item, pickerObjectUrls, 'media-picker-media', preview));
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
    const tagRow = createTagChipRow(item, 2);
    if (tagRow) button.appendChild(tagRow);

    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.classList.add('sending');
      await sendMediaItem(item, button);
    });
    button.addEventListener('contextmenu', event => openContextMenu(event, item, 'picker'));
    return button;
  }

  function collectTagCounts(items) {
    const counts = new Map();
    items.forEach(item => {
      itemTags(item).forEach(tag => {
        const key = fold(tag);
        const entry = counts.get(key) || { tag, count: 0 };
        entry.count++;
        counts.set(key, entry);
      });
    });
    return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  function renderPickerTags(items) {
    const row = document.getElementById('media-picker-tags');
    if (!row) return;
    const tags = collectTagCounts(items).slice(0, 12);
    row.innerHTML = '';
    row.classList.toggle('hidden', tags.length === 0);
    if (!tags.length) {
      pickerTag = '';
      return;
    }
    if (pickerTag && !tags.some(entry => fold(entry.tag) === fold(pickerTag))) pickerTag = '';
    tags.forEach(entry => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'media-tag-chip filter';
      chip.classList.toggle('active', !!pickerTag && fold(entry.tag) === fold(pickerTag));
      chip.textContent = `#${entry.tag}`;
      chip.addEventListener('click', async () => {
        pickerTag = fold(entry.tag) === fold(pickerTag) ? '' : entry.tag;
        await renderPicker();
      });
      row.appendChild(chip);
    });
  }

  async function renderPicker() {
    const grid = document.getElementById('media-picker-grid');
    const empty = document.getElementById('media-picker-empty');
    if (!grid || !empty) return;
    const items = await getItems();
    releaseUrls(pickerObjectUrls);
    grid.innerHTML = '';
    renderPickerTags(items);
    const visible = items.filter(item => {
      if (!matchesFilter(item, pickerFilter)) return false;
      if (!matchesTag(item, pickerTag)) return false;
      return matchesQuery(item, pickerQuery);
    });
    visible.forEach(item => grid.appendChild(createPickerCard(item)));
    grid.classList.toggle('hidden', visible.length === 0);
    empty.classList.toggle('hidden', visible.length !== 0);
    const count = document.getElementById('media-picker-count');
    if (count) count.textContent = `${visible.length} / ${items.length}`;
    updateLibraryCount(items.length);
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

  /* ---------- İsim ve etiket penceresi ---------- */

  function renderDetailTags() {
    const container = document.getElementById('media-detail-tags');
    if (!container) return;
    container.innerHTML = '';
    detailTags.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'media-tag-chip removable';
      const label = document.createElement('span');
      label.textContent = `#${tag}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = text('mediaDetail.removeTag', 'Etiketi kaldır');
      remove.setAttribute('aria-label', `${text('mediaDetail.removeTag', 'Etiketi kaldır')}: ${tag}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        detailTags = detailTags.filter(entry => fold(entry) !== fold(tag));
        renderDetailTags();
        renderDetailSuggestions();
      });
      chip.append(label, remove);
      container.appendChild(chip);
    });
  }

  function addDetailTags(value) {
    const incoming = parseTagInput(value);
    if (!incoming.length) return false;
    let hitLimit = false;
    incoming.forEach(tag => {
      if (detailTags.some(entry => fold(entry) === fold(tag))) return;
      if (detailTags.length >= MAX_TAGS) {
        hitLimit = true;
        return;
      }
      detailTags.push(tag);
    });
    if (hitLimit) notify('mediaDetail.tagLimit', 'En fazla 8 etiket ekleyebilirsin.', 'warn');
    renderDetailTags();
    renderDetailSuggestions();
    return true;
  }

  async function renderDetailSuggestions() {
    const wrap = document.getElementById('media-detail-suggested-wrap');
    const container = document.getElementById('media-detail-suggested');
    if (!wrap || !container) return;
    const items = await getItems();
    const suggestions = collectTagCounts(items)
      .filter(entry => !detailTags.some(tag => fold(tag) === fold(entry.tag)))
      .slice(0, 8);
    container.innerHTML = '';
    wrap.classList.toggle('hidden', suggestions.length === 0);
    suggestions.forEach(entry => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'media-tag-chip filter';
      chip.textContent = `#${entry.tag}`;
      chip.addEventListener('click', () => addDetailTags(entry.tag));
      container.appendChild(chip);
    });
  }

  function renderDetailStep() {
    const item = detailQueue[detailIndex];
    if (!item) return;
    const preview = document.getElementById('media-detail-preview');
    const step = document.getElementById('media-detail-step');
    const title = document.getElementById('media-detail-title');
    const nameInput = document.getElementById('media-detail-name');
    const tagInput = document.getElementById('media-detail-tag-input');
    const skip = document.getElementById('media-detail-skip');
    const save = document.getElementById('media-detail-save');
    const remove = document.getElementById('media-detail-delete');

    releaseUrls(detailObjectUrls);
    if (preview) {
      preview.innerHTML = '';
      preview.appendChild(createMediaPreview(item, detailObjectUrls, 'media-detail-media'));
      const badge = document.createElement('span');
      badge.className = `media-kind-badge ${item.kind}`;
      badge.textContent = mediaBadge(item);
      preview.appendChild(badge);
      const size = document.createElement('span');
      size.className = 'media-detail-size';
      size.textContent = formatBytes(item.size);
      preview.appendChild(size);
    }
    if (step) {
      step.textContent = `${detailIndex + 1} / ${detailQueue.length}`;
      step.classList.toggle('hidden', detailQueue.length < 2);
    }
    if (title) {
      title.textContent = detailMode === 'review'
        ? text('mediaDetail.titleNew', 'Medyanı adlandır')
        : text('mediaDetail.titleEdit', 'İsim ve etiketleri düzenle');
    }
    if (skip) {
      skip.textContent = detailMode === 'review'
        ? text('mediaDetail.skip', 'Atla')
        : text('common.cancel', 'İptal');
    }
    if (save) {
      const isLast = detailIndex >= detailQueue.length - 1;
      save.textContent = detailMode === 'review' && !isLast
        ? text('mediaDetail.saveNext', 'Kaydet ve devam')
        : text('common.save', 'Kaydet');
    }
    if (remove) remove.classList.toggle('hidden', detailMode !== 'edit');

    detailTags = normalizeTags(itemTags(item));
    renderDetailTags();
    renderDetailSuggestions();
    if (tagInput) tagInput.value = '';
    if (nameInput) {
      nameInput.value = item.name;
      setTimeout(() => {
        nameInput.focus();
        // Uzantı seçimin dışında kalsın: yazmaya başlayınca "kedi.gif" dosyasının
        // yalnızca ad kısmı değişir.
        const dot = item.name.lastIndexOf('.');
        try { nameInput.setSelectionRange(0, dot > 0 ? dot : item.name.length); } catch (error) {}
      }, 60);
    }
  }

  function openMediaDetail(items, mode = 'edit') {
    const modal = document.getElementById('media-detail-modal');
    const queue = (Array.isArray(items) ? items : [items]).filter(Boolean);
    if (!modal || !queue.length) return Promise.resolve();
    closeContextMenu();
    detailQueue = queue;
    detailIndex = 0;
    detailMode = mode === 'review' ? 'review' : 'edit';
    modal.classList.remove('hidden');
    renderDetailStep();
    return new Promise(resolve => { detailResolve = resolve; });
  }

  function closeDetail() {
    const modal = document.getElementById('media-detail-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    releaseUrls(detailObjectUrls);
    detailQueue = [];
    detailIndex = 0;
    detailTags = [];
    const resolve = detailResolve;
    detailResolve = null;
    if (resolve) resolve();
  }

  function advanceDetail() {
    if (detailMode === 'review' && detailIndex < detailQueue.length - 1) {
      detailIndex++;
      renderDetailStep();
      return;
    }
    closeDetail();
  }

  async function saveDetail() {
    const item = detailQueue[detailIndex];
    if (!item) {
      closeDetail();
      return;
    }
    const nameInput = document.getElementById('media-detail-name');
    const tagInput = document.getElementById('media-detail-tag-input');
    if (tagInput && tagInput.value.trim()) {
      addDetailTags(tagInput.value);
      tagInput.value = '';
    }
    const name = nameInput ? nameInput.value.trim() : '';
    const updated = await updateItem(item.id, { name: name || item.name, tags: detailTags });
    if (updated) detailQueue[detailIndex] = updated;
    if (detailMode === 'edit') notify('mediaDetail.saved', 'Medya bilgileri güncellendi.', 'ok');
    else if (detailIndex >= detailQueue.length - 1) notify('mediaLibrary.added', 'Medya bu bilgisayardaki kütüphanene eklendi.', 'ok');
    advanceDetail();
  }

  async function deleteFromDetail() {
    const item = detailQueue[detailIndex];
    if (!item) return;
    const deleted = await deleteItem(item.id, true);
    if (!deleted) return;
    detailQueue.splice(detailIndex, 1);
    if (detailIndex >= detailQueue.length) closeDetail();
    else renderDetailStep();
  }

  function bindDetailModal() {
    const modal = document.getElementById('media-detail-modal');
    if (!modal) return;
    document.getElementById('media-detail-save')?.addEventListener('click', saveDetail);
    document.getElementById('media-detail-skip')?.addEventListener('click', advanceDetail);
    document.getElementById('media-detail-close')?.addEventListener('click', closeDetail);
    document.getElementById('media-detail-delete')?.addEventListener('click', deleteFromDetail);
    modal.addEventListener('click', event => {
      if (event.target === modal) closeDetail();
    });
    document.getElementById('media-detail-tag-box')?.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      document.getElementById('media-detail-tag-input')?.focus();
    });
    const tagInput = document.getElementById('media-detail-tag-input');
    tagInput?.addEventListener('keydown', event => {
      const isSeparator = event.key === 'Enter' || event.key === ',' || event.key === ' ' || event.key === 'Tab';
      if (isSeparator) {
        if (!tagInput.value.trim()) {
          // Boş etiket kutusunda Enter, formu kaydeder.
          if (event.key === 'Enter') {
            event.preventDefault();
            saveDetail();
          }
          return;
        }
        event.preventDefault();
        addDetailTags(tagInput.value);
        tagInput.value = '';
        return;
      }
      if (event.key === 'Backspace' && !tagInput.value && detailTags.length) {
        detailTags.pop();
        renderDetailTags();
        renderDetailSuggestions();
      }
    });
    tagInput?.addEventListener('blur', () => {
      if (!tagInput.value.trim()) return;
      addDetailTags(tagInput.value);
      tagInput.value = '';
    });
    document.getElementById('media-detail-name')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      saveDetail();
    });
  }

  /* ---------- Sağ tık menüsü ---------- */

  function closeContextMenu() {
    contextTarget = null;
    document.getElementById('media-context-menu')?.classList.add('hidden');
  }

  function openContextMenu(event, item, surface) {
    const menu = document.getElementById('media-context-menu');
    if (!menu) return;
    event.preventDefault();
    event.stopPropagation();
    contextTarget = { item, surface };
    const send = menu.querySelector('[data-media-action="send"]');
    if (send) send.classList.toggle('hidden', surface !== 'picker');
    menu.classList.remove('hidden');
    menu.style.visibility = 'hidden';
    const rect = menu.getBoundingClientRect();
    const left = Math.min(window.innerWidth - rect.width - 10, Math.max(10, event.clientX));
    const top = Math.min(window.innerHeight - rect.height - 10, Math.max(10, event.clientY));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = 'visible';
  }

  function bindContextMenu() {
    const menu = document.getElementById('media-context-menu');
    if (!menu) return;
    menu.addEventListener('click', async event => {
      const button = event.target.closest('[data-media-action]');
      if (!button || !contextTarget) return;
      const { item, surface } = contextTarget;
      const action = button.dataset.mediaAction;
      closeContextMenu();
      if (action === 'edit') {
        const fresh = await getItem(item.id);
        if (fresh) openMediaDetail([fresh], 'edit');
      } else if (action === 'delete') {
        await deleteItem(item.id, true);
      } else if (action === 'send' && surface === 'picker') {
        const card = document.querySelector(`#media-picker-grid [data-media-id="${item.id}"]`);
        if (card) {
          card.disabled = true;
          card.classList.add('sending');
        }
        await sendMediaItem(item, card);
      }
    });
    document.addEventListener('pointerdown', event => {
      if (menu.classList.contains('hidden')) return;
      if (event.target.closest('#media-context-menu')) return;
      closeContextMenu();
    });
    window.addEventListener('resize', closeContextMenu);
    document.getElementById('media-picker-grid')?.addEventListener('scroll', closeContextMenu);
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
    pickerTag = '';
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
    closeContextMenu();
    releaseUrls(pickerObjectUrls);
  }

  function closeAttachmentMenu() {
    attachmentMenuRequestId++;
    document.getElementById('dm-attach-menu')?.classList.add('hidden');
  }

  async function openAttachmentMenu(button, inputId, mode) {
    activeAttachmentMode = mode === 'room' ? 'room' : 'dm';
    if (activeAttachmentMode === 'dm' && !state.activeDM) {
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
    dropzone.addEventListener('drop', event => addFiles(event.dataTransfer.files, { review: true }));
  }

  async function init() {
    const picker = document.getElementById('media-picker-modal');
    const menu = document.getElementById('dm-attach-menu');
    const detail = document.getElementById('media-detail-modal');
    const contextMenu = document.getElementById('media-context-menu');
    if (picker && picker.parentElement !== document.body) document.body.appendChild(picker);
    if (menu && menu.parentElement !== document.body) document.body.appendChild(menu);
    if (detail && detail.parentElement !== document.body) document.body.appendChild(detail);
    if (contextMenu && contextMenu.parentElement !== document.body) document.body.appendChild(contextMenu);

    const settingsInput = document.getElementById('settings-media-input');
    document.getElementById('settings-media-add')?.addEventListener('click', () => settingsInput?.click());
    settingsInput?.addEventListener('change', async event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      await addFiles(files, { review: true });
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

    document.getElementById('media-picker-search')?.addEventListener('input', event => {
      pickerQuery = event.target.value;
      clearTimeout(pickerSearchTimer);
      pickerSearchTimer = setTimeout(() => { renderPicker(); }, 150);
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

    bindDetailModal();
    bindContextMenu();

    document.addEventListener('pointerdown', event => {
      const attachMenu = document.getElementById('dm-attach-menu');
      if (!attachMenu || attachMenu.classList.contains('hidden')) return;
      if (event.target.closest('#dm-attach-menu, #dm-btn-file, #server-dm-btn-file, #fbtn')) return;
      closeAttachmentMenu();
    });
    // Yakalama aşaması: açık isim/etiket penceresi Esc'i önce tüketir, ayarlar
    // penceresi arkada kapanmasın.
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!document.getElementById('media-context-menu')?.classList.contains('hidden')) {
        event.stopPropagation();
        closeContextMenu();
        return;
      }
      if (!document.getElementById('media-detail-modal')?.classList.contains('hidden')) {
        event.stopPropagation();
        closeDetail();
        return;
      }
      closeAttachmentMenu();
      closePicker();
    }, true);
    window.addEventListener('resize', closeAttachmentMenu);
    await refreshLibrarySurfaces();
  }

  window.TeamSyncMediaLibrary = {
    addFiles,
    getItems,
    getItem,
    updateItem,
    deleteItem,
    renderSettings,
    renderPicker,
    openPicker,
    closePicker,
    openMediaDetail,
    closeMediaDetail: closeDetail,
    normalizeTags,
    refresh: refreshLibrarySurfaces,
    maxFileSize: MAX_FILE_SIZE,
    maxTags: MAX_TAGS
  };
  window.openDMAttachmentMenu = openAttachmentMenu;
  window.closeDMAttachmentMenu = closeAttachmentMenu;
  window.releaseMediaLibrarySettingsUrls = () => releaseUrls(settingsObjectUrls);

  document.addEventListener('DOMContentLoaded', init);
})();
