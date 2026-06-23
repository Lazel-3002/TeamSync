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

    closeAllCards(); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
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

  document.getElementById('sb-go').addEventListener('click', (e) => {
    e.stopPropagation();
    let url = sbUrl.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
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
  
  // Webview DOM hazır olduğunda keyboard input'u aktif et
  sbWebview.addEventListener('dom-ready', () => {
    sbWebview.focus();
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
    closeAllCards(); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
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
