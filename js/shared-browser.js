// Uzaktan gelen gezinmeleri güvenle uygular ve yankı (echo) döngüsünü kırar:
// zaten o adresteysek src'yi yeniden set etmeyiz (yoksa her sb-nav tam sayfa
// reload'a, her reload da yeni sb-nav'a dönüşüp sonsuz yenileme yaratıyordu).
function sbNormUrl(u) {
  return (u || '').replace(/\/+$/, '');
}

function sbCurrentUrl() {
  const wv = document.getElementById('sb-webview');
  if (!wv) return '';
  try { return (typeof wv.getURL === 'function' && wv.getURL()) || wv.src || ''; }
  catch (e) { return wv.src || ''; }
}

function sbApplyRemoteNav(url) {
  if (!/^https?:\/\//i.test(url || '')) return; // javascript:/file: gibi şemaları asla yükleme
  const sbUrl = document.getElementById('sb-url');
  if (sbUrl && document.activeElement !== sbUrl) sbUrl.value = url;
  if (sbNormUrl(sbCurrentUrl()) === sbNormUrl(url)) return; // zaten oradayız
  state.sb.appliedRemoteUrl = url;
  state.sb.remoteNavTs = Date.now();
  document.getElementById('sb-webview').src = url;
}

// ---- Yetkilendirme (kurucu + yetkili kullanıcılar) ----
// Kurucu (host) her zaman tam yetkilidir ve "Yetkilendir" butonuyla diğer
// katılımcılara etkileşim yetkisi verebilir. Yetkisi olmayanlar sayfayı
// sadece izler: tıklayamaz, yazamaz, gezinemez — ama kartı büyütüp
// küçültebilir ve kendi tarafında kapatabilir.
function sbIsHost() {
  return !!state.sb.host && state.sb.host === state.myId;
}

function sbCanInteract() {
  // Oturum yokken (host bilinmiyor) kısıtlama uygulanmaz; kurucu hep serbest
  if (!state.sb.host || sbIsHost()) return true;
  return (state.sb.authorized || []).includes(state.myId);
}

function sbPeerCanInteract(peerId) {
  if (!state.sb.host) return true; // host henüz öğrenilmediyse eski davranış
  if (peerId === state.sb.host) return true;
  return (state.sb.authorized || []).includes(peerId);
}

// Yetki durumuna göre üst çubuğu ve webview kilidini günceller.
// Büyüt (sb-focus) ve Kapat (sb-close) bilerek HİÇ kilitlenmez:
// herkes videoyu büyütüp küçültebilmeli ve kendi kartını kapatabilmeli.
function sbUpdateControlsUI() {
  const isHost = sbIsHost();
  const can = sbCanInteract();

  const wrap = document.getElementById('sb-auth-wrap');
  if (wrap) wrap.style.display = isHost ? 'block' : 'none';
  if (!isHost) {
    const panel = document.getElementById('sb-auth-panel');
    if (panel) panel.classList.add('hidden');
  }

  ['sb-back', 'sb-forward', 'sb-refresh', 'sb-go'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = !can;
      btn.style.opacity = can ? '' : '0.35';
    }
  });
  const sbUrl = document.getElementById('sb-url');
  if (sbUrl) sbUrl.disabled = !can;

  const guard = document.getElementById('sb-guard');
  if (guard) guard.classList.toggle('hidden', can);
}

function sbBroadcastAuth() {
  state.sb.authTs = Date.now();
  broadcast({ type: 'sb-auth', list: (state.sb.authorized || []).slice(), ts: state.sb.authTs });
}

function sbRenderAuthPanel() {
  const panel = document.getElementById('sb-auth-panel');
  if (!panel) return;
  panel.innerHTML = '';

  const title = document.createElement('div');
  title.textContent = 'Yetkilendirme';
  title.style.cssText = 'font-size:12px; font-weight:bold; color:#a1a1aa; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;';
  panel.appendChild(title);

  if (state.peers.size === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'Odada başka kimse yok';
    empty.style.cssText = 'font-size:13px; color:#71717a; padding:6px 0;';
    panel.appendChild(empty);
    return;
  }

  state.peers.forEach((peer, id) => {
    const isAuth = (state.sb.authorized || []).includes(id);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05);';

    const name = document.createElement('span');
    name.textContent = peer.name || 'Bilinmeyen';
    name.style.cssText = 'font-size:13px; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

    const btn = document.createElement('button');
    btn.textContent = isAuth ? '✓ Yetkili' : 'Yetki Ver';
    btn.style.cssText = 'flex-shrink:0; font-size:12px; padding:4px 10px; border-radius:12px; border:none; cursor:pointer; color:#fff; background:' + (isAuth ? '#22c55e' : 'rgba(255,255,255,0.12)') + ';';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!sbIsHost()) return;
      if (!Array.isArray(state.sb.authorized)) state.sb.authorized = [];
      if (isAuth) {
        state.sb.authorized = state.sb.authorized.filter(x => x !== id);
        showToast('🔒 ' + (peer.name || '') + ' yetkisi alındı', 'warn');
      } else {
        state.sb.authorized.push(id);
        showToast('🔓 ' + (peer.name || '') + ' yetkilendirildi', 'info');
      }
      sbBroadcastAuth();
      sbRenderAuthPanel();
    });

    row.appendChild(name);
    row.appendChild(btn);
    panel.appendChild(row);
  });
}

// Kurucu ayrıldığında oturum HERKES için kapanmaz: yetkililer arasından
// deterministik-rastgele biri yeni kurucu seçilir (tohum = ayrılanın id'si,
// böylece tüm istemciler AYNI kişiyi seçer). Hiç yetkili kalmadıysa odadaki
// herkes aday olur ki kimse atılmasın. Yeni kurucu hemen sb-state yayınlar;
// olası bir görüş ayrılığı da mevcut çift-host çözümüyle kendini onarır.
function sbHandleHostLeft(departedId) {
  if (state.sb.host !== departedId) return;
  state.sb.authorized = (state.sb.authorized || []).filter(id => id !== departedId);

  const connected = (id) => id === state.myId || state.peers.has(id);
  let candidates = state.sb.authorized.filter(connected);
  if (!candidates.length) {
    candidates = [state.myId, ...state.peers.keys()].filter(connected);
  }
  if (!candidates.length) {
    state.sb.host = null;
    sbUpdateControlsUI();
    return;
  }

  candidates.sort();
  let h = 0;
  const seed = String(departedId);
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const successor = candidates[h % candidates.length];

  state.sb.host = successor;
  if (!state.sb.startedAt) state.sb.startedAt = Date.now();

  if (successor === state.myId) {
    const card = document.getElementById('sb-card');
    if (card && !card.classList.contains('hidden') && state.sb.joinedActivity) {
      showToast('👑 Kurucu ayrıldı — Ortak Tarayıcı\'nın yeni kurucusu sensin', 'info');
      broadcast({ type: 'sb-state', host: state.myId, startedAt: state.sb.startedAt, url: sbCurrentUrl(), auth: (state.sb.authorized || []).slice() });
    }
  } else if (state.sb.joinedActivity) {
    const p = state.peers.get(successor);
    showToast('👑 Kurucu ayrıldı — yeni kurucu: ' + (p && p.name ? p.name : 'seçildi'), 'info');
  }
  sbUpdateControlsUI();
}

function initSharedBrowser() {
  document.getElementById('act-sb').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
    const sbCard = document.getElementById('sb-card');

    if (state.sb.host && state.sb.host !== state.myId) {
      // Misafir: ev sahibinin tarayıcısına katıl. Kartı burada da görünür yap;
      // eskiden sb-start mesajı beklenirdi ve kaybolursa misafir hiçbir şey görmezdi.
      const btn = sbCard.querySelector('.inactive-overlay button');
      if (btn) { btn.click(); return; }
      closeAllCards(false, 'sb-card');
      state.sb.joinedActivity = true;
      sbCard.classList.remove('hidden');
      makeCardFocusable(sbCard);
      if (!focusedCard) toggleFocus(sbCard);
      if (state.sb.lastUrl) sbApplyRemoteNav(state.sb.lastUrl);
      sbUpdateControlsUI();
      return;
    }

    closeAllCards(false, 'sb-card'); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
    state.sb.joinedActivity = true;
    sbCard.classList.remove('hidden');
    makeCardFocusable(sbCard);
    if (!focusedCard) toggleFocus(sbCard);

    // İzleyici (spectate) modu kaldırıldı: katılan herkes tıklayıp gezinebilir.
    state.sb.host = state.myId;
    state.sb.startedAt = Date.now();
    // Yeni oturum: yetki listesi sıfırdan başlar, sadece kurucu tam yetkili
    state.sb.authorized = [];
    state.sb.authTs = Date.now();
    sbUpdateControlsUI();
    // webview'in HTML'de statik bir src'si YOK (bkz. sbWebview.src atamasının
    // hemen altındaki not): kartı ilk kez açan host için varsayılan sayfayı
    // burada, kontrollü bir şekilde biz yüklüyoruz. Statik src eskiden
    // sayfa daha DOM'a girer girmez gerçek bir internet isteği başlatıyordu;
    // biri (host ya da misafir) bu iç yükleme daha bitmeden webview'e farklı
    // bir adrese gitmesini söylerse, gecikmiş "duckduckgo tamamlandı" olayı
    // az sonra bizim gezinmemizin ÜSTÜNE binip onu sessizce geçersiz
    // kılabiliyordu (herkes farklı sayfalarda kalıyordu, hatasız/loglanmadan).
    // Şimdi ilk yükleme SADECE kullanıcı Ortak Tarayıcı'yı gerçekten açtığında,
    // bilerek ve tek seferde başlatılıyor; artık aynı anda yarışan iki
    // gezinme yok.
    if (!sbCurrentUrl() || sbCurrentUrl() === 'about:blank') {
      document.getElementById('sb-webview').src = 'https://duckduckgo.com/';
    }
    broadcast({ type: 'sb-start', host: state.myId, interactive: true, startedAt: state.sb.startedAt, url: sbCurrentUrl(), auth: [] });
  });

  // Yetkilendir paneli: sadece kurucuda görünür (sbUpdateControlsUI gizler/gösterir)
  const sbAuthBtn = document.getElementById('sb-auth-btn');
  if (sbAuthBtn) {
    sbAuthBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!sbIsHost()) return;
      const panel = document.getElementById('sb-auth-panel');
      if (!panel) return;
      if (panel.classList.contains('hidden')) {
        sbRenderAuthPanel();
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    });
    // Panel dışına tıklanınca paneli kapat
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('sb-auth-panel');
      if (panel && !panel.classList.contains('hidden') && !e.target.closest('#sb-auth-wrap')) {
        panel.classList.add('hidden');
      }
    });
  }

  // Yetkisiz kullanıcı için webview üstündeki tıklama kilidi: sayfaya
  // tıklamayı/yazmayı engeller ama kart büyütme/kapatma butonlarına dokunmaz
  const sbGuard = document.getElementById('sb-guard');
  if (sbGuard) {
    sbGuard.addEventListener('click', (e) => {
      e.stopPropagation();
      showToast('🔒 Etkileşim için kurucudan yetki almalısın', 'warn');
    });
  }

  // Pencere tray'e gizlenince Ortak Tarayıcı sesini sustur, geri gelince aç.
  // (Sesli sohbet bilerek susturulmaz; sadece webview'deki video sesi.)
  if (window.electronAPI && window.electronAPI.onWindowVisibility) {
    window.electronAPI.onWindowVisibility((visible) => {
      const wv = document.getElementById('sb-webview');
      if (wv && typeof wv.setAudioMuted === 'function') {
        try { wv.setAudioMuted(!visible); } catch (e) {}
      }
    });
  }

  const sbWebview = document.getElementById('sb-webview');
  const sbUrl = document.getElementById('sb-url');
  
  document.getElementById('sb-close').addEventListener('click', (e) => {
    e.stopPropagation();
    // Sadece host oturumu herkes için bitirir; misafirin Kapat'ı yalnızca
    // kendisini çıkarır (eskiden herhangi biri kapatınca herkesinki kapanıyordu)
    if (state.sb.host === state.myId) broadcast({ type: 'sb-close' });
    closeAllCards(true); // CLEAN AND RESETS
  });

  document.getElementById('sb-focus').addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof toggleFocus === 'function') {
      const card = document.getElementById('sb-card');
      if (card) toggleFocus(card);
    }
  });

  // Kullanıcının bilinçli gezinmeleri her zaman yayınlanmalı; uzak gezinme
  // sonrası kurulan yankı-bastırma penceresini temizle
  const clearNavSuppression = () => {
    state.sb.appliedRemoteUrl = '';
    state.sb.remoteNavTs = 0;
  };

  document.getElementById('sb-go').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!sbCanInteract()) { showToast('🔒 Gezinmek için kurucudan yetki almalısın', 'warn'); return; }
    let url = sbUrl.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        url = 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
        if (state.sfwMode) url += '&kp=1'; // AI Aile Dostu Strict SafeSearch
      }
    }

    clearNavSuppression();
    sbWebview.src = url;
  });
  sbUrl.addEventListener('click', () => {
    document.getElementById('sb-webview').blur();
    sbUrl.focus();
  });

  sbUrl.addEventListener('focus', () => {
    document.getElementById('sb-webview').blur();
  });

  sbUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('sb-go').click();
  });

  document.getElementById('sb-back').addEventListener('click', (e) => {
    e.stopPropagation();
    if (sbWebview.canGoBack()) { clearNavSuppression(); sbWebview.goBack(); }
  });
  document.getElementById('sb-forward').addEventListener('click', (e) => {
    e.stopPropagation();
    if (sbWebview.canGoForward()) { clearNavSuppression(); sbWebview.goForward(); }
  });
  document.getElementById('sb-refresh').addEventListener('click', (e) => {
    e.stopPropagation();
    sbWebview.reload();
  });

  // Webview'e tıklandığında focus'u ver
  sbWebview.addEventListener('focus', () => {
    sbWebview.focus();
  });
  
  // Webview DOM hazır olduğunda keyboard input'u aktif et ve eklentileri yükle
  sbWebview.addEventListener('dom-ready', () => {
    // Adres çubuğunda yazan kullanıcının focus'unu çalma (uzaktan gelen bir
    // gezinme sayfayı yüklerken yazmayı imkânsız hâle getiriyordu)
    if (document.activeElement !== sbUrl) sbWebview.focus();

    // Aile Dostu (SFW) Yapay Zeka Koruması
    sbWebview.executeJavaScript(`
      (() => {
        if (window.__sfw_injected) return;
        window.__sfw_injected = true;
        
        if (window.location.hostname.includes('youtube.com')) {
          document.cookie = "PREF=f2=8000000; domain=.youtube.com; path=/; max-age=31536000";
        }

        const rawBadWords = ['cinsel', 'çıplak', 'porno', 'ifşa', '+18', 'seks', 'şiddet', 'intihar', 'kanlı', 'vahşet', 'kavgası', 'kırmızı balık', 'pepee', 'niloya', 'bebek şarkıları', 'linç', 'utanç verici', 'beni tanıyın', 'kombin', 'benimle hazırlan', 'grwm', 'makyaj', 'dedikodu', 'magazin', 'sevgilim', 'aldatma', 'kışkırtma', 'galaya kaçtım', 'vlog', 'alışveriş', 'sohbet', 'soru cevap', 'rutin', 'cey', 'ceylazuli', 'limonify', 'limonifyclips', 'mido', 'midoburak', 'alfacocukgoko', 'tugbayiilmaaz', 'aydingoksintv', 'manifest', 'tiktok', 'akım', 'gıybet', 'drama', 'bikini', 'mayo', 'plaj', 'frikik', 'roleplay', 'rp', 'hamile', 'ergen', 'esra çelik', 'esrita', 'zeynep atılgan', 'ahlaksız'];
        const badWords = rawBadWords.map(w => w.toLocaleLowerCase('tr-TR'));
        
        const style = document.createElement('style');
        style.innerHTML = \`
          .ai-sfw-blur { filter: blur(30px) !important; pointer-events: none !important; opacity: 0.1 !important; }
          .ai-sfw-hidden { display: none !important; width: 0 !important; height: 0 !important; opacity: 0 !important; pointer-events: none !important; position: absolute !important; }
          #ai-scan-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.98); color: #fff; z-index: 9999999;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: sans-serif; font-size: 24px; transition: opacity 0.5s;
          }
          /* Hide top chip bar and specific sidebar items (Music, Podcasts) */
          body.ai-sfw-active ytd-feed-filter-chip-bar-renderer, body.ai-sfw-active yt-chip-cloud-renderer, body.ai-sfw-active yt-related-chip-cloud-renderer { display: none !important; opacity: 0 !important; pointer-events: none !important; height: 0 !important; }
          body.ai-sfw-active ytd-guide-entry-renderer:has(a[title*="Müzik"]), body.ai-sfw-active ytd-guide-entry-renderer:has(a[title*="Music"]),
          body.ai-sfw-active ytd-guide-entry-renderer:has(a[title*="Podcast"]), body.ai-sfw-active ytd-mini-guide-entry-renderer:has(a[title*="Müzik"]),
          body.ai-sfw-active ytd-mini-guide-entry-renderer:has(a[title*="Podcast"]), body.ai-sfw-active a[title*="Müzik"], body.ai-sfw-active a[title*="Podcast"] {
            display: none !important; opacity: 0 !important; pointer-events: none !important; height: 0 !important; margin: 0 !important; padding: 0 !important;
          }
          /* Fix YouTube grid gaps when videos are hidden */
          body.ai-sfw-active ytd-rich-grid-row, body.ai-sfw-active ytd-rich-grid-row > #contents { display: contents !important; }
          body.ai-sfw-active ytd-rich-grid-renderer > #contents { display: flex !important; flex-wrap: wrap !important; justify-content: flex-start !important; }
          body.ai-sfw-active .ai-sfw-hidden { margin: 0 !important; padding: 0 !important; border: none !important; }
        \`;
        document.head.appendChild(style);

        function checkNode(node) {
          if (!document.body.classList.contains('ai-sfw-active')) return;
          try {
            if (!node) return;
            let text = (node.innerText || node.textContent || "").toLocaleLowerCase('tr-TR');
            let html = (node.innerHTML || "").toLocaleLowerCase('tr-TR');
            
            let isBad = badWords.some(w => text.includes(w) || html.includes('/@' + w) || html.includes('"' + w + '"'));
            if (isBad) {
              if (node.tagName && node.tagName.includes('RENDERER')) {
                node.innerHTML = '<div style="padding:10px;text-align:center;color:#ef4444;font-size:12px;font-weight:bold;">🛡️ AI Tarafından Silindi</div>';
                node.classList.add('ai-sfw-hidden');
              } else {
                node.classList.add('ai-sfw-blur');
              }
            }
          } catch(e) {}
        }

        if (window.location.pathname === '/watch' || window.location.pathname.startsWith('/shorts/')) {
          if (document.body.classList.contains('ai-sfw-active')) {
            const overlay = document.createElement('div');
            overlay.id = 'ai-scan-overlay';
            overlay.innerHTML = '<div style="margin-bottom:20px; text-align:center;">🛡️ Aile Dostu Yapay Zeka<br>Analiz Ediyor...</div><div style="font-size:16px;color:#aaa;">(İçerik Taranıyor)</div>';
            document.body.appendChild(overlay);
            
            setTimeout(() => {
              try {
                const titleNode = document.querySelector('h1, h2.title');
                if (titleNode && titleNode.innerText) {
                   let text = titleNode.innerText.toLocaleLowerCase('tr-TR');
                   if (badWords.some(w => text.includes(w))) {
                     overlay.innerHTML = '<div style="color:#ef4444; text-align:center;">🚫 Bu Video Yapay Zeka Tarafından Engellendi.</div><div style="font-size:16px;">(Sakıncalı İçerik)</div>';
                     const v = document.querySelector('video');
                     if (v) v.remove();
                     return;
                   }
                }
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 500);
              } catch(e) { overlay.remove(); }
            }, 1500);
          }
        }

        setInterval(() => {
           try {
             document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-reel-video-renderer').forEach(checkNode);
           } catch(e) {}
        }, ${state.gameMode ? '4500' : '1500'});
      })();
    `).catch(e => console.warn("SFW Error", e));

    // YouTube Dislike Eklentisi (Return YouTube Dislike API)
    sbWebview.executeJavaScript(`
      (() => {
        if (!window.location.hostname.includes('youtube.com')) return;
        if (window.__ryd_injected) return;
        window.__ryd_injected = true;

        async function updateDislikes() {
          const urlParams = new URLSearchParams(window.location.search);
          const videoId = urlParams.get('v');
          if (!videoId) return;

          try {
            const res = await fetch('https://returnyoutubedislikeapi.com/votes?videoId=' + videoId);
            const data = await res.json();
            if (!data || !data.dislikes) return;

            // YouTube arayüzündeki dislike butonunu bul
            const formatNumber = (num) => {
              if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
              if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
              if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
              return num.toString();
            };

            const dislikeText = formatNumber(data.dislikes);

            // Klasik veya yeni YouTube arayüzündeki dislike butonu text alanını arayalım
            // Yeni arayüzde dislike butonu genellikle "segmented-like-dislike-button-view-model" içindedir
            const observer = new MutationObserver((mutations, obs) => {
              const buttons = document.querySelectorAll('dislike-button-view-model button');
              if (buttons.length > 0) {
                const dislikeBtn = buttons[0];
                let textEl = dislikeBtn.querySelector('.cbox');
                if (!textEl) {
                  // Yeni tasarım text elemanı ekleyelim
                  const span = document.createElement('span');
                  span.className = 'cbox';
                  span.style.marginLeft = '6px';
                  span.style.fontSize = '1.4rem';
                  span.style.fontWeight = '500';
                  span.style.lineHeight = '2rem';
                  dislikeBtn.appendChild(span);
                  textEl = span;
                }
                textEl.innerText = dislikeText;
                obs.disconnect(); // Bulduk ve yazdık
              }
            });

            observer.observe(document.body, { childList: true, subtree: true });
            
            // Eğer sayfa çoktan yüklendiyse hemen tetikleyelim (observer yakalayamazsa diye)
            setTimeout(() => {
              const buttons = document.querySelectorAll('dislike-button-view-model button');
              if (buttons.length > 0) {
                const dislikeBtn = buttons[0];
                let textEl = dislikeBtn.querySelector('.cbox');
                if (!textEl) {
                  const span = document.createElement('span');
                  span.className = 'cbox';
                  span.style.marginLeft = '6px';
                  span.style.fontSize = '1.4rem';
                  span.style.fontWeight = '500';
                  span.style.lineHeight = '2rem';
                  dislikeBtn.appendChild(span);
                  textEl = span;
                }
                textEl.innerText = dislikeText;
              }
            }, 1000);

          } catch(e) { console.error('RYD Error:', e); }
        }

        // Sayfa değiştiğinde (SPA navigation) tekrar çalıştır
        window.addEventListener('yt-navigate-finish', updateDislikes);
        // İlk yüklemede de çalıştır
        updateDislikes();
      })();
    `).catch(err => console.error("Script injection failed", err));
  });

  sbWebview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) {
      console.log('Webview load aborted (-3), typically normal when navigating away quickly.');
      return;
    }
  });

  // will-navigate SADECE gerçek kullanıcı/sayfa kaynaklı gezinmede ateşlenir
  // (bir linke tıklama, sayfa içi window.location değişimi); bizim kendi
  // .src= atamalarımızda (hem adres çubuğundan gezinme hem uzaktan gelen
  // senkronu uygulama) HİÇ ateşlenmez (Electron dokümantasyonu). Bu yüzden
  // güvenilir bir "bu gerçek bir kullanıcı tıklaması" imzası olarak kullanılabilir.
  let sbUserGestureNav = false;
  sbWebview.addEventListener('will-navigate', () => { sbUserGestureNav = true; });

  // Tek bir gezinme birden çok did-navigate / did-navigate-in-page olayı
  // üretebilir (yönlendirme zinciri, SPA gezinmesi). Eski tek seferlik
  // ignoreNextNav bayrağı yalnızca ilk olayı susturuyordu; kalanlar karşıya
  // geri yayınlanıp iki taraf arasında sonsuz reload ping-pongu başlatıyordu.
  const onLocalNav = (e) => {
    const isUserGesture = sbUserGestureNav;
    sbUserGestureNav = false;
    state.sb.lastVideoState = null;
    if (document.activeElement !== sbUrl) {
      sbUrl.value = e.url;
    }
    // Uzaktan uygulanan gezinmenin kendisini ve hemen ardındaki yönlendirme
    // zincirini geri yayınlama — AMA bu bastırma yalnızca gerçekten bir
    // uzak-senkron echo'suysa uygulanmalı. Önceden 2.5sn'lik pencere kör bir
    // şekilde HERKESİ (gerçek bir link tıklamasını bile) susturuyordu: biri
    // senkronlanan sayfada bir linke tıklarsa ve bu 2.5sn içine denk gelirse,
    // tıklaması hiç yayınlanmıyor, o kişi sessizce herkesten kopup kendi
    // başına farklı bir sayfada kalıyordu ("biri youtube'da biri google'da").
    // will-navigate ile işaretlenmiş gerçek kullanıcı gezinmeleri bu
    // bastırmayı hep atlar.
    if (!isUserGesture) {
      if (sbNormUrl(e.url) === sbNormUrl(state.sb.appliedRemoteUrl)) return;
      if (Date.now() - (state.sb.remoteNavTs || 0) < 2500) return;
    }
    if (!state.sb.joinedActivity || !state.sb.host) return;
    // Yetkisiz kullanıcının (guard'ı aşan bir yönlendirme vb.) gezinmesi
    // asla yayınlanmaz — oturumu sadece kurucu ve yetkililer yönlendirebilir
    if (!sbCanInteract()) return;
    state.sb.lastUrl = e.url;
    // ts damgası: iki kişi neredeyse aynı anda farklı adreslere gezinirse
    // (host A'ya, misafir B'ye), damgasız sistemde herkes "en son işlediği"
    // mesaja göre karar verir ve iki taraf birbirinin adresine geçip kalıcı
    // olarak TERS senkron (A<->B yer değiştirmiş) kalabilir. En yeni damgayı
    // izleyerek herkesin gerçekten en son yapılan geziye yakınsamasını sağlarız.
    state.sb.lastNavTs = Date.now();
    broadcast({ type: 'sb-nav', url: e.url, ts: state.sb.lastNavTs });
  };
  sbWebview.addEventListener('did-navigate', onLocalNav);
  sbWebview.addEventListener('did-navigate-in-page', onLocalNav);

  sbWebview.addEventListener('new-window', (e) => {
    // Popup veya yeni sekme açmak isteyen linkleri aynı webview içinde aç
    e.preventDefault();
    if (e.url) {
      sbWebview.src = e.url;
    }
  });

  // Shared Browser Video Synchronization & Auto Ad-Skipper
  setInterval(async () => {
    const sbCard = document.getElementById('sb-card');
    if (!sbCard || sbCard.classList.contains('hidden')) return;
    const sbWebview = document.getElementById('sb-webview');
    if (!sbWebview) return;

    // Sync SFW Mode to webview body class dynamically
    try {
      await sbWebview.executeJavaScript(`(() => {
        if (${state.sfwMode}) {
          document.body.classList.add('ai-sfw-active');
        } else {
          document.body.classList.remove('ai-sfw-active');
          document.querySelectorAll('.ai-sfw-blur, .ai-sfw-hidden').forEach(n => {
            n.classList.remove('ai-sfw-blur', 'ai-sfw-hidden');
          });
        }
      })();`);
    } catch(e) {}

    // 1. Automatic Ad-Skipping (Applies to both host and guest)
    try {
      await sbWebview.executeJavaScript(`(() => {
        // Dismiss standard YouTube ad skip button
        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-overlay-close-button');
        if (skipBtn) skipBtn.click();
        
        // Speed up and skip video ads immediately
        const ad = document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay');
        const v = document.querySelector('video');
        if (ad && v) {
          v.playbackRate = 16.0;
          v.muted = true;
          if (!isNaN(v.duration) && v.duration > 0) {
            v.currentTime = v.duration - 0.1;
          }
        }

        // Cosmetic removal of Shorts ads and sponsored items
        document.querySelectorAll('ytd-reel-video-renderer, ytd-rich-item-renderer, ytd-video-renderer, ytd-promoted-sparkles-web-renderer, ytd-ad-slot-renderer').forEach(el => {
          // Remove obvious ad containers
          if (el.tagName.toLowerCase().includes('ad-slot') || el.tagName.toLowerCase().includes('promoted')) {
            el.remove();
            return;
          }
          // Check for "Sponsorlu" or "Ad" badges
          const badges = el.querySelectorAll('.badge-shape-wiz__text, #ad-badge, .ytd-badge-supported-renderer, [id^="ad-text"]');
          for (let b of badges) {
            const text = b.innerText ? b.innerText.trim().toLowerCase() : '';
            if (text === 'sponsorlu' || text === 'ad' || text === 'reklam') {
              el.remove();
              break;
            }
          }
        });
      })()`);
    } catch (e) {}

    // 2. Video Playback Synchronization — HERKES yayınlar, sadece host değil.
    // Önceden sadece host'un video durumu yayınlanıyordu; bir MİSAFİR videoyu
    // durdurduğunda/oynattığında bu hiçbir yere gitmiyordu ("videoyu durdurdum
    // ama başkasında durmadı" şikayetinin kök nedeni — Ortak Tarayıcı zaten
    // "herkes etkileşimli" (spectate yok) tasarımı, video kontrolü de öyle
    // olmalı). ts damgalı son-yazan-kazanır ile kimin gönderdiği önemsiz,
    // yalnızca EN YENİ eylem uygulanır (sb-nav'daki yarış-önleme ile aynı desen).
    //
    // Reklam gösterilirken ASLA okuma/yayın yapılmaz: reklamın kendi zaman
    // çizelgesi (genelde birkaç saniye, saniyede 1x hız) asıl içeriğin
    // zamanıyla alakasız — reklam süresini "gerçek video pozisyonu" sanıp
    // yayınlarsak, reklamı görmeyen/farklı reklam gören taraf o anlamsız
    // zamana atlatılır ve reklam bitince İÇERİK gerçek pozisyonundan devam
    // ederken bu taraf yanlış yerde kalır ("reklam gören geride kalıyor").
    try {
      const adShowing = await sbWebview.executeJavaScript(
        `!!document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay')`
      );
      if (!adShowing) {
        const vState = await sbWebview.executeJavaScript(`(() => {
          const v = document.querySelector('video');
          if (!v) return null;
          return {
            paused: v.paused,
            currentTime: v.currentTime,
            url: window.location.href
          };
        })()`);

        if (vState) {
          // Az önce UZAKTAN uygulanan bir senkronun kendi tetiklediği
          // paused/currentTime değişimini "yeni yerel eylem" sanıp hemen geri
          // yayınlamayı önle (echo/gereksiz trafik) — nav tarafındaki
          // remoteNavTs bastırma penceresiyle aynı fikir.
          const echoingRemote = (Date.now() - (state.sb.remoteVideoSyncTs || 0)) < 1500;

          // Yetkisiz kullanıcının video durumu yayınlanmaz (izleyici kalır);
          // lastVideoState yine güncellenir ki sonradan yetki alırsa eski
          // durumu "yeni eylem" sanıp ani bir senkron patlaması yapmasın.
          if (!sbCanInteract()) {
            state.sb.lastVideoState = vState;
          } else if (!echoingRemote && (!state.sb.lastVideoState ||
              state.sb.lastVideoState.paused !== vState.paused ||
              Math.abs(state.sb.lastVideoState.currentTime - vState.currentTime) > 2)) {

            state.sb.lastVideoState = vState;
            state.sb.lastVideoSyncTs = Date.now();
            broadcast({
              type: 'sb-video-sync',
              paused: vState.paused,
              currentTime: vState.currentTime,
              ts: state.sb.lastVideoSyncTs
            });
          }
        }
      }
    } catch (e) {}
  }, 1000);

  // 7/24 katılım beacon'ı: host, oturum açık olduğu sürece kim olduğunu ve
  // güncel adresi 5 sn'de bir yayınlar. sb-start'ı kaçıranlar (QoS 0 MQTT),
  // odaya geç gelenler ve kartı kapatıp geri dönmek isteyenler host'u buradan
  // öğrenir; Aktiviteler > Ortak Tarayıcı her an katılınabilir kalır.
  setInterval(() => {
    const card = document.getElementById('sb-card');
    if (!card || card.classList.contains('hidden')) return;
    if (state.sb.host !== state.myId) return;
    // auth listesi beacon'la taşınır: sb-auth mesajını kaçıranlar ve geç
    // katılanlar yetki durumunu en geç 5 sn'de buradan öğrenir
    broadcast({ type: 'sb-state', host: state.myId, startedAt: state.sb.startedAt, url: sbCurrentUrl(), auth: (state.sb.authorized || []).slice() });
  }, 5000);

  // Advanced Visual AI (Thumbnail Scanner)
  let lastScan = 0;
  setInterval(async () => {
    if (!state.sfwMode || !state.aiModel) return;
    const now = Date.now();
    const delay = state.gameMode ? 6000 : 3000;
    if (now - lastScan < delay) return;
    lastScan = now;

    const sbCard = document.getElementById('sb-card');
    if (!sbCard || sbCard.classList.contains('hidden')) return;
    const sbWebview = document.getElementById('sb-webview');
    if (!sbWebview) return;
    
    try {
      const thumbs = await sbWebview.executeJavaScript(`
        Array.from(document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-reel-video-renderer, ytd-shorts')).map(node => {
          if (node.hasAttribute('data-ai-thumb-checked')) return null;
          node.setAttribute('data-ai-thumb-checked', 'true');
          const id = Math.random().toString();
          node.setAttribute('data-ai-id', id);
          const img = node.querySelector('img.yt-core-image');
          if (!img || !img.src || !img.src.startsWith('http')) return null;
          return { id, src: img.src };
        }).filter(Boolean)
      `);

      if (thumbs && thumbs.length > 0) {
        for (const thumb of thumbs) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = thumb.src;
          img.onload = async () => {
            try {
              const preds = await state.aiModel.classify(img);
              const bad = preds.some(p => (p.className === 'Porn' || p.className === 'Hentai' || p.className === 'Sexy') && p.probability > 0.35);
              if (bad) {
                sbWebview.executeJavaScript(`
                  const badNode = document.querySelector('[data-ai-id="${thumb.id}"]');
                  if (badNode) badNode.classList.add('ai-sfw-hidden');
                `).catch(()=>{});
              }
            } catch(e) {}
          };
        }
      }
    } catch(e) {}
  }, 1000);
}

function handleSBMessage(peerId, msg) {
  const couldInteractBefore = sbCanInteract();
  if (msg.type === 'sb-start' || msg.type === 'sb-state') {
    if (msg.host === state.myId) return;

    // Çift-host çakışması (ikisi de aynı anda açtıysa / sb-start kaybolduysa):
    // daha erken başlayan kazanır, kaybeden misafire döner. Host'un 5 sn'lik
    // sb-state beacon'ı sayesinde bu kendini en geç 5 sn'de onarır.
    if (state.sb.host === state.myId && state.sb.joinedActivity) {
      const theirStart = Number(msg.startedAt) || 0;
      if (!theirStart || (state.sb.startedAt || 0) <= theirStart) return; // ben kazandım
      state.sb.host = msg.host;
      state.sb.startedAt = 0;
      if (Array.isArray(msg.auth)) state.sb.authorized = msg.auth.filter(x => typeof x === 'string');
      if (msg.url) { state.sb.lastUrl = msg.url; sbApplyRemoteNav(msg.url); }
      sbUpdateControlsUI();
      return;
    }

    state.sb.host = msg.host;
    // startedAt saklanır: kurucu ayrılırsa halef, oturumun orijinal başlangıç
    // damgasını devralır (çift-host çözümünde "en erken başlayan kazanır")
    if (msg.startedAt) state.sb.startedAt = Number(msg.startedAt) || 0;
    if (Array.isArray(msg.auth)) state.sb.authorized = msg.auth.filter(x => typeof x === 'string');
    if (msg.url && !state.sb.joinedActivity) state.sb.lastUrl = msg.url;

    // Yetki durumum değiştiyse haber ver (sb-auth kaybolsa bile beacon getirir)
    const canNow = sbCanInteract();
    if (state.sb.joinedActivity && canNow !== couldInteractBefore) {
      showToast(canNow ? '🔓 Ortak Tarayıcı\'da yetkilendirildin' : '🔒 Ortak Tarayıcı yetkin alındı', canNow ? 'info' : 'warn');
    }
    sbUpdateControlsUI();

    // Beacon kartı zorla açmaz: kullanıcı kartı kapattıysa rahatsız etmeyiz,
    // ama host/adres bilgisi güncel kalır — Aktiviteler'den her an katılabilir.
    if (msg.type === 'sb-state') return;

    closeAllCards(false, 'sb-card'); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
    const sbCard = document.getElementById('sb-card');
    sbCard.classList.remove('hidden');
    makeCardFocusable(sbCard);

    if (!state.sb.joinedActivity) {
      showInactiveOverlay('sb-card', 'Ortak Tarayıcı', () => {
         state.sb.joinedActivity = true;
         removeInactiveOverlay('sb-card');
         if (!focusedCard) toggleFocus(sbCard);
         if (state.sb.lastUrl) sbApplyRemoteNav(state.sb.lastUrl);
         sbUpdateControlsUI();
      });
    }
  } else if (msg.type === 'sb-auth') {
    // Yetki listesini SADECE mevcut kurucu değiştirebilir
    if (peerId !== state.sb.host) return;
    const ts = Number(msg.ts) || 0;
    if (ts && state.sb.authTs && ts < state.sb.authTs) return; // eski liste, yok say
    state.sb.authTs = ts || Date.now();
    if (Array.isArray(msg.list)) state.sb.authorized = msg.list.filter(x => typeof x === 'string');
    const canNow = sbCanInteract();
    if (state.sb.joinedActivity && canNow !== couldInteractBefore) {
      showToast(canNow ? '🔓 Ortak Tarayıcı\'da yetkilendirildin — artık tıklayıp yazabilirsin' : '🔒 Ortak Tarayıcı yetkin alındı', canNow ? 'info' : 'warn');
    }
    sbUpdateControlsUI();
  } else if (msg.type === 'sb-nav') {
    // Sadece kurucu ve yetkililerin gezinmesi uygulanır
    if (!sbPeerCanInteract(peerId)) return;
    // Eş-zamanlı gezinme yarışı: iki kişi aynı anda farklı adreslere giderse
    // (host A'ya, misafir B'ye) damgasız eski kod her ikisinin de karşısının
    // adresine geçmesine izin verip kalıcı ters-senkrona yol açabiliyordu.
    // En yeni damgalı gezinme her zaman kazanır, böylece tüm istemciler aynı
    // (gerçekten en son yapılan) adrese yakınsar.
    const navTs = Number(msg.ts) || 0;
    if (navTs && state.sb.lastNavTs && navTs < state.sb.lastNavTs) return; // eski/geride kalmış gezinme, yok say
    state.sb.lastNavTs = navTs || Date.now();
    state.sb.lastUrl = msg.url;
    if (!state.sb.joinedActivity) return;
    sbApplyRemoteNav(msg.url);
  } else if (msg.type === 'sb-video-sync') {
    // Önceden sadece host'tan (peerId===state.sb.host) gelen video-sync kabul
    // ediliyordu; artık HERKES yayınlayabildiği için (yukarıdaki interval'a
    // bakın — misafirin durdur/oynat/atlaması artık başkalarına da gidiyor)
    // bu kısıtlama kaldırıldı. ts damgalı son-yazan-kazanır hangi eylemin
    // gerçekten en son olduğuna karar verir (sb-nav'daki desenle aynı),
    // böylece iki kişi neredeyse aynı anda oynat/duraklat yaparsa kalıcı
    // bir çelişki değil, tek bir tutarlı sonuç oluşur.
    if (!sbPeerCanInteract(peerId)) return; // yetkisizin video eylemi uygulanmaz
    if (state.sb.joinedActivity) {
      const currentTime = Number(msg.currentTime);
      const ts = Number(msg.ts) || 0;
      const paused = !!msg.paused;
      if (!Number.isFinite(currentTime)) return;
      if (ts && state.sb.lastVideoSyncTs && ts < state.sb.lastVideoSyncTs) return; // eski/geride kalmış eylem, yok say
      state.sb.lastVideoSyncTs = ts || Date.now();
      const sbWebview = document.getElementById('sb-webview');
      if (sbWebview) {
        const effectiveTs = ts || Date.now();
        // currentTime/ts/paused are sanitized above (finite numbers / boolean)
        // and re-serialized with JSON.stringify so they can only ever appear
        // as safe literals here, never as injected script.
        const syncScript = `(() => {
          // Reklam gösterilirken kendi videomuzu göndericinin GERÇEK içerik
          // zamanına zorlamaya çalışmayalım: reklam genelde seek edilemez
          // (no-op/hata) ve reklam süresi zaten gönderenin İÇERİK zamanıyla
          // alakasız bir referans olurdu.
          if (document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay')) return;
          const v = document.querySelector('video');
          if (!v) return;
          const targetTime = ${JSON.stringify(currentTime)} + (Date.now() - ${JSON.stringify(effectiveTs)}) / 1000;
          if (Math.abs(v.currentTime - targetTime) > 2) {
            v.currentTime = targetTime;
          }
          if (${JSON.stringify(paused)} && !v.paused) v.pause();
          if (!${JSON.stringify(paused)} && v.paused) v.play().catch(e => {});
        })()`;
        sbWebview.executeJavaScript(syncScript).catch(e => {});
        // Yerel senkron-yayın döngüsünün bu uygulamayı "yeni bir yerel eylem"
        // sanıp hemen geri yayınlamasını önle (nav tarafındaki remoteNavTs
        // bastırma penceresiyle aynı fikir).
        state.sb.remoteVideoSyncTs = Date.now();
      }
    }
  } else if (msg.type === 'sb-close') {
    // Kurucunun çıkışı artık oturumu HERKES için bitirmez: kalanlar arasından
    // yeni bir kurucu seçilir ve tarayıcı açık kalır. Misafirin kapatması
    // (artık yayınlanmıyor ama eski istemciler için) yok sayılır.
    if (peerId === state.sb.host) sbHandleHostLeft(peerId);
  }
}
