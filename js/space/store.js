// Grup ve sunucu verisinin yerel deposu: hesap başına bir IndexedDB.
//   spaces : gid → grup/sunucu kaydı (ad, üyeler + açık anahtarları, dönem, anahtar)
//   events : id  → imzalı olay (mesaj, tepki, üye ekleme/çıkarma, arama...)
//                  sunucu mesajlarında üst düzey `ch` alanı → kanal dizini
//   ctl    : id  → sunucu kontrol olayları (roller, kanallar, üyeler, davetler).
//                  Ayrı tutulur: mesaj budaması bunlara asla dokunmaz.
// Gruplarda her üye tüm geçmişi tutar; sunucularda barındırıcılar tümünü,
// üyeler gördüklerini.
(function () {
  const VERSION = 2;
  const MAX_EVENTS_PER_SPACE = 20000;
  let dbPromise = null;
  let dbFor = null;

  function open() {
    const fid = window.state && window.state.friendId;
    if (!fid) return Promise.reject(new Error('no-identity'));
    if (dbPromise && dbFor === fid) return dbPromise;
    dbFor = fid;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(`ts-spaces-${fid}`, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('spaces')) db.createObjectStore('spaces', { keyPath: 'gid' });
        let ev;
        if (!db.objectStoreNames.contains('events')) {
          ev = db.createObjectStore('events', { keyPath: 'id' });
          ev.createIndex('by_space_ts', ['gid', 'ts']);
        } else {
          ev = req.transaction.objectStore('events');
        }
        // Grup olaylarında `ch` yoktur; IndexedDB onları bu dizine hiç koymaz.
        if (!ev.indexNames.contains('by_space_ch_ts')) ev.createIndex('by_space_ch_ts', ['gid', 'ch', 'ts']);
        if (!db.objectStoreNames.contains('ctl')) {
          const ctl = db.createObjectStore('ctl', { keyPath: 'id' });
          ctl.createIndex('by_space_ts', ['gid', 'ts']);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let result;
      Promise.resolve(fn(t.objectStore(store), v => { result = v; })).catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const reqP = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

  function putSpace(space) {
    return tx('spaces', 'readwrite', s => { s.put(space); });
  }
  function deleteSpace(gid) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(['spaces', 'events', 'ctl'], 'readwrite');
      t.objectStore('spaces').delete(gid);
      const range = IDBKeyRange.bound([gid, -Infinity], [gid, Infinity]);
      ['events', 'ctl'].forEach(name => {
        t.objectStore(name).index('by_space_ts').openCursor(range).onsuccess = e => {
          const c = e.target.result;
          if (c) { c.delete(); c.continue(); }
        };
      });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    }));
  }
  function allSpaces() {
    return tx('spaces', 'readonly', (s, done) => reqP(s.getAll()).then(done));
  }

  // Yeni olayları ekler; zaten varsa atlar. Eklenenleri döner.
  function addEvents(records) {
    if (!records.length) return Promise.resolve([]);
    return tx('events', 'readwrite', (s, done) => {
      const added = [];
      return Promise.all(records.map(r => reqP(s.get(r.id)).then(existing => {
        if (!existing) { s.put(r); added.push(r); }
      }))).then(() => done(added));
    });
  }
  function hasEvent(id) {
    return tx('events', 'readonly', (s, done) => reqP(s.get(id)).then(v => done(!!v)));
  }

  // Bir alanın olayları, zamana göre (en eski → en yeni). since: ts (hariç değil)
  function eventsOf(gid, { since = -Infinity, limit = 5000, newest = false } = {}) {
    return tx('events', 'readonly', (s, done) => new Promise(resolve => {
      const out = [];
      const range = IDBKeyRange.bound([gid, since], [gid, Infinity]);
      const req = s.index('by_space_ts').openCursor(range, newest ? 'prev' : 'next');
      req.onsuccess = e => {
        const c = e.target.result;
        if (!c || out.length >= limit) { done(newest ? out.reverse() : out); resolve(); return; }
        out.push(c.value);
        c.continue();
      };
      req.onerror = () => { done(out); resolve(); };
    }));
  }

  function countOf(gid) {
    return tx('events', 'readonly', (s, done) =>
      reqP(s.index('by_space_ts').count(IDBKeyRange.bound([gid, -Infinity], [gid, Infinity]))).then(done));
  }

  // En eski olayları budar (depo sınırı).
  function prune(gid) {
    return countOf(gid).then(n => {
      if (n <= MAX_EVENTS_PER_SPACE) return 0;
      const drop = n - MAX_EVENTS_PER_SPACE;
      return tx('events', 'readwrite', (s, done) => new Promise(resolve => {
        let k = 0;
        s.index('by_space_ts').openCursor(IDBKeyRange.bound([gid, -Infinity], [gid, Infinity])).onsuccess = e => {
          const c = e.target.result;
          if (!c || k >= drop) { done(k); resolve(); return; }
          c.delete(); k++; c.continue();
        };
      }));
    });
  }

  // ---------- sunucu: kontrol olayları ----------
  function addControl(records) {
    if (!records.length) return Promise.resolve([]);
    return tx('ctl', 'readwrite', (s, done) => {
      const added = [];
      return Promise.all(records.map(r => reqP(s.get(r.id)).then(existing => {
        if (!existing) { s.put(r); added.push(r); }
      }))).then(() => done(added));
    });
  }
  function hasControl(id) {
    return tx('ctl', 'readonly', (s, done) => reqP(s.get(id)).then(v => done(!!v)));
  }
  function controlOf(gid, since = -Infinity) {
    return tx('ctl', 'readonly', (s, done) =>
      reqP(s.index('by_space_ts').getAll(IDBKeyRange.bound([gid, since], [gid, Infinity]))).then(done));
  }
  function getEvent(id) {
    return tx('events', 'readonly', (s, done) => reqP(s.get(id)).then(v => done(v || null)));
  }

  // Bir kanalın olayları (en eski → en yeni). before/after: ts sınırları (hariç).
  function channelEvents(gid, ch, { before = Infinity, after = -Infinity, limit = 100, newest = true } = {}) {
    return tx('events', 'readonly', (s, done) => new Promise(resolve => {
      const out = [];
      const range = IDBKeyRange.bound([gid, ch, after], [gid, ch, before], true, true);
      const req = s.index('by_space_ch_ts').openCursor(range, newest ? 'prev' : 'next');
      req.onsuccess = e => {
        const c = e.target.result;
        if (!c || out.length >= limit) { done(newest ? out.reverse() : out); resolve(); return; }
        out.push(c.value);
        c.continue();
      };
      req.onerror = () => { done(out); resolve(); };
    }));
  }

  function reset() { dbPromise = null; dbFor = null; }

  window.TSSpaceStore = {
    putSpace, deleteSpace, allSpaces, addEvents, hasEvent, eventsOf, countOf, prune, reset,
    addControl, hasControl, controlOf, getEvent, channelEvents
  };
})();
