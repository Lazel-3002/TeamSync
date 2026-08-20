(() => {
  'use strict';

  // Mesaj pencerelerinin yüksekliği fareyle üst kenardan sürüklenerek büyütülür
  // ("yukarı doğru genişlet"). Üç yüzey aynı mantığı paylaşır:
  //   roomChat → oda kenar çubuğundaki SOHBET paneli (.chat)
  //   server   → sunucu içindeki Mesajlar modali (.server-dm-card)
  //   menu     → ana menüdeki DM paneli (#step-action.menu-layout)
  //
  // Yükseklik doğrudan elemana inline yazılmaz; :root üzerinde CSS değişkeni
  // olarak tutulur. Böylece stylesheet'teki min(..., calc(100vh - X)) kelepçesi
  // korunur ve DM kapalıyken ana menü düzeni kendi doğal yüksekliğine döner
  // (inline stil bunları sessizce ezerdi).

  const PANELS = {
    roomChat: {
      variable: '--room-chat-height',
      storageKey: 'teamsync_room_chat_height',
      selector: '.chat',
      min: 160,
      // Kenar çubuğunun üstündeki blok (kullanıcı listesi + ses testi + eşik)
      // ezilmesin diye ayrılan pay; sohbet bunun ötesine büyüyemez. Sabit bir
      // sayı kullanıcı sayısına/eklenen yeni satırlara göre yanlış çıkabildiği
      // için (üst blok büyüyünce mesaj gönderme kutusu görünür alanın dışına
      // itiliyordu) gerçek yükseklik aşağıda DOM'dan ölçülür; bu sadece o
      // ölçüm mümkün olmadığında kullanılan bir yedek değerdir.
      reserve: 320,
      dynamicReserve: true,
      fallback: 280
    },
    server: {
      variable: '--dm-server-height',
      storageKey: 'teamsync_server_dm_height',
      selector: '.mcard.server-dm-card',
      min: 320,
      reserve: 90,
      fallback: 500
    },
    menu: {
      variable: '--dm-menu-height',
      storageKey: 'teamsync_menu_dm_height',
      selector: '#step-action',
      min: 260,
      reserve: 190,
      fallback: 440
    }
  };

  // .chat'in üstündeki kardeş elemanların (kullanıcı listesi, ses testi,
  // eşik/yankı satırları, "SOHBET" etiketi...) o an kapladığı gerçek
  // yüksekliği ölçer. Sabit bir "reserve" sayısı yerine bunu kullanmak,
  // kullanıcı listesi büyüdüğünde/yeni bir satır eklendiğinde kelepçenin
  // yanlış hesaplanıp mesaj gönderme kutusunu görünür alanın dışına
  // itmesini önler.
  function measuredReserve(panel) {
    const target = document.querySelector(panel.selector);
    if (!target || !target.parentElement) return panel.reserve;
    const siblings = Array.from(target.parentElement.children).filter(el => el !== target);
    if (!siblings.length) return panel.reserve;
    const used = siblings.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
    return used > 0 ? used + 12 : panel.reserve;
  }

  function limitFor(panel) {
    const reserve = panel.dynamicReserve ? measuredReserve(panel) : panel.reserve;
    return Math.max(panel.min, window.innerHeight - reserve);
  }

  function clamp(panel, height) {
    return Math.round(Math.min(limitFor(panel), Math.max(panel.min, height)));
  }

  function stored(panel) {
    const saved = Number.parseInt(localStorage.getItem(panel.storageKey) || '', 10);
    return Number.isFinite(saved) && saved > 0 ? saved : panel.fallback;
  }

  function apply(panel, height) {
    document.documentElement.style.setProperty(panel.variable, `${clamp(panel, height)}px`);
  }

  function applyStored() {
    Object.values(PANELS).forEach(panel => apply(panel, stored(panel)));
  }

  function bindHandle(handle) {
    const panel = PANELS[handle.dataset.dmResize];
    if (!panel) return;

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const target = document.querySelector(panel.selector);
      if (!target) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = target.getBoundingClientRect().height;
      let height = startHeight;

      const move = moveEvent => {
        // Yukarı sürükleme (clientY azalır) yüksekliği artırır.
        height = clamp(panel, startHeight + (startY - moveEvent.clientY));
        apply(panel, height);
      };
      const stop = () => {
        handle.classList.remove('dragging');
        document.body.classList.remove('dm-resizing');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
        try { handle.releasePointerCapture(event.pointerId); } catch (error) {}
        localStorage.setItem(panel.storageKey, String(height));
      };

      try { handle.setPointerCapture(event.pointerId); } catch (error) {}
      handle.classList.add('dragging');
      document.body.classList.add('dm-resizing');
      // Tutamaç yalnızca 10px yüksekliğinde. Dinleyiciler window'a bağlanır:
      // yakalanmış (captured) olaylar da window'a kabarcıklanır, yakalama
      // kurulamazsa bile imleç şeridin dışına çıktığında hareket kaybolmaz.
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    });

    // Çift tıklama varsayılan yüksekliğe döndürür.
    handle.addEventListener('dblclick', () => {
      apply(panel, panel.fallback);
      localStorage.setItem(panel.storageKey, String(panel.fallback));
    });
  }

  function init() {
    applyStored();
    document.querySelectorAll('[data-dm-resize]').forEach(bindHandle);
    // Pencere küçülürse kayıtlı yükseklik ekranı taşırmasın; kelepçe yeniden
    // uygulanır ama kullanıcının kaydettiği değer bozulmaz.
    window.addEventListener('resize', applyStored);
  }

  window.TeamSyncDMResize = {
    apply: (kind, height) => {
      const panel = PANELS[kind];
      if (!panel) return null;
      apply(panel, height);
      localStorage.setItem(panel.storageKey, String(clamp(panel, height)));
      return clamp(panel, height);
    },
    current: kind => {
      const panel = PANELS[kind];
      if (!panel) return null;
      return clamp(panel, stored(panel));
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
