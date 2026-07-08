function initSharedBrowser() {
  document.getElementById('act-sb').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
    const sbCard = document.getElementById('sb-card');
    
    if (state.sb.host && state.sb.host !== state.myId) {
      const btn = sbCard.querySelector('.inactive-overlay button');
      if (btn) btn.click();
      else if (!focusedCard) toggleFocus(sbCard);
      return;
    }

    closeAllCards(false, 'sb-card'); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
    state.sb.joinedActivity = true;
    sbCard.classList.remove('hidden');
    makeCardFocusable(sbCard);
    if (!focusedCard) toggleFocus(sbCard);
    
    const confirmModal = document.getElementById('custom-confirm');
    confirmModal.classList.remove('hidden');
    confirmModal.style.display = 'flex';
    
    const finishSbSetup = (interactive) => {
      confirmModal.classList.add('hidden');
      confirmModal.style.display = 'none';
      state.sb.interactive = interactive;
      state.sb.host = state.myId;
      document.getElementById('sb-overlay').style.display = 'none';
      document.getElementById('sb-url').disabled = false;
      broadcast({ type: 'sb-start', host: state.myId, interactive: state.sb.interactive });
    };

    document.getElementById('btn-confirm-yes').onclick = () => finishSbSetup(true);
    document.getElementById('btn-confirm-no').onclick = () => finishSbSetup(false);
  });

  const sbWebview = document.getElementById('sb-webview');
  const sbUrl = document.getElementById('sb-url');
  
  document.getElementById('sb-close').addEventListener('click', (e) => {
    e.stopPropagation();
    broadcast({ type: 'sb-close' });
    closeAllCards(true); // CLEAN AND RESETS
  });

  document.getElementById('sb-focus').addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof toggleFocus === 'function') {
      const card = document.getElementById('sb-card');
      if (card) toggleFocus(card);
    }
  });

  document.getElementById('sb-go').addEventListener('click', (e) => {
    e.stopPropagation();
    let url = sbUrl.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        url = 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
      }
    }
    if (/youtube\.com|youtu\.be/i.test(url)) {
      showToast("💡 İpucu: YouTube videolarını senkronize izlemek için 'WatchTogether' etkinliğini kullanabilirsiniz!", "info");
    }
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
    if (sbWebview.canGoBack()) sbWebview.goBack();
  });
  document.getElementById('sb-forward').addEventListener('click', (e) => {
    e.stopPropagation();
    if (sbWebview.canGoForward()) sbWebview.goForward();
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
    sbWebview.focus();

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

  sbWebview.addEventListener('did-navigate', (e) => {
    state.sb.lastVideoState = null;
    if (document.activeElement !== sbUrl) {
      sbUrl.value = e.url;
    }
    if (state.sb.ignoreNextNav) {
      state.sb.ignoreNextNav = false;
      return;
    }
    if (state.sb.host === state.myId || state.sb.interactive) {
      broadcast({ type: 'sb-nav', url: e.url });
    }
  });

  sbWebview.addEventListener('did-navigate-in-page', (e) => {
    state.sb.lastVideoState = null;
    if (document.activeElement !== sbUrl) {
      sbUrl.value = e.url;
    }
    if (state.sb.ignoreNextNav) {
      state.sb.ignoreNextNav = false;
      return;
    }
    if (state.sb.host === state.myId || state.sb.interactive) {
      broadcast({ type: 'sb-nav', url: e.url });
    }
  });

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

    // 1. Automatic Ad-Skipping (Applies to both host and guest)
    try {
      await sbWebview.executeJavaScript(`(() => {
        // Dismiss standard YouTube ad skip button
        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button');
        if (skipBtn) {
          skipBtn.click();
        }
        
        // Dismiss YouTube overlay ads (non-video ads)
        const overlayAd = document.querySelector('.ytp-ad-overlay-close-button');
        if (overlayAd) {
          overlayAd.click();
        }

        // Speed up and skip video ads immediately
        const ad = document.querySelector('.ad-showing, .ad-interrupting');
        const v = document.querySelector('video');
        if (ad && v) {
          v.playbackRate = 16.0;
          v.currentTime = v.duration - 0.1;
        }
      })()`);
    } catch (e) {}

    // 2. Video Playback Synchronization (Host broadcasts state)
    if (state.sb.host === state.myId) {
      try {
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
          if (!state.sb.lastVideoState ||
              state.sb.lastVideoState.paused !== vState.paused ||
              Math.abs(state.sb.lastVideoState.currentTime - vState.currentTime) > 2) {
            
            state.sb.lastVideoState = vState;
            broadcast({
              type: 'sb-video-sync',
              paused: vState.paused,
              currentTime: vState.currentTime,
              ts: Date.now()
            });
          }
        }
      } catch (e) {}
    }
  }, 1000);
}

function handleSBMessage(peerId, msg) {
  if (msg.type === 'sb-start') {
    state.sb.host = msg.host;
    state.sb.interactive = msg.interactive;
    closeAllCards(false, 'sb-card'); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
    const sbCard = document.getElementById('sb-card');
    sbCard.classList.remove('hidden');
    makeCardFocusable(sbCard);
    
    if (!state.sb.joinedActivity) {
      showInactiveOverlay('sb-card', 'Ortak Tarayıcı', () => {
         state.sb.joinedActivity = true;
         removeInactiveOverlay('sb-card');
         if (!focusedCard) toggleFocus(sbCard);
         if (state.sb.lastUrl) {
            state.sb.ignoreNextNav = true;
            document.getElementById('sb-webview').src = state.sb.lastUrl;
            document.getElementById('sb-url').value = state.sb.lastUrl;
         }
      });
    }
    
    const sUrl = document.getElementById('sb-url');
    const sOverlay = document.getElementById('sb-overlay');
    if (!state.sb.interactive && state.sb.host !== state.myId) {
      sUrl.disabled = true;
      sOverlay.style.display = 'block';
    } else {
      sUrl.disabled = false;
      sOverlay.style.display = 'none';
    }
  } else if (msg.type === 'sb-nav') {
    state.sb.lastUrl = msg.url;
    if (!state.sb.joinedActivity) return;
    state.sb.ignoreNextNav = true;
    document.getElementById('sb-webview').src = msg.url;
    document.getElementById('sb-url').value = msg.url;
  } else if (msg.type === 'sb-video-sync') {
    if (state.sb.host !== state.myId && state.sb.joinedActivity) {
      const sbWebview = document.getElementById('sb-webview');
      if (sbWebview) {
        const syncScript = `(() => {
          const v = document.querySelector('video');
          if (!v) return;
          const targetTime = ${msg.currentTime} + (Date.now() - ${msg.ts}) / 1000;
          if (Math.abs(v.currentTime - targetTime) > 2) {
            v.currentTime = targetTime;
          }
          if (${msg.paused} && !v.paused) v.pause();
          if (!${msg.paused} && v.paused) v.play().catch(e => {});
        })()`;
        sbWebview.executeJavaScript(syncScript).catch(e => {});
      }
    }
  } else if (msg.type === 'sb-close') {
    closeAllCards(true); // CLEAN AND RESETS
  }
}
