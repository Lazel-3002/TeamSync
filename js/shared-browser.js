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
        if (state.sfwMode) url += '&kp=1'; // AI Aile Dostu Strict SafeSearch
      }
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
