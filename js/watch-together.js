function initWatchTogether() {
  document.getElementById('act-wt').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
    const wtCard = document.getElementById('wt-card');
    
    if (!wtCard.classList.contains('hidden') && !state.wt.joinedActivity) {
      const btn = wtCard.querySelector('.inactive-overlay button');
      if (btn) btn.click();
      else if (!focusedCard) toggleFocus(wtCard);
      return;
    }
    
    closeAllCards(false, 'wt-card'); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
    state.wt.joinedActivity = true;
    wtCard.classList.remove('hidden');
    makeCardFocusable(wtCard);
    if (!focusedCard) toggleFocus(wtCard);
  });
  
  document.getElementById('wt-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllCards(true); // CLEAN AND RESETS
    broadcast({ type: 'wt-close' });
  });
  
  document.getElementById('wt-load').addEventListener('click', (e) => {
    e.stopPropagation();
    const url = document.getElementById('wt-url').value;
    const match = url.match(/(?:v=|youtu\.be\/)([^&]+)/);
    if (match) {
      const vid = match[1];
      broadcast({ type: 'wt-load', vid });
      loadWTVideo(vid);
    } else {
      showToast('Geçerli bir YouTube linki girin', 'warn');
    }
  });
}

window.onYouTubeIframeAPIReady = function() {
  state.wt.isReady = true;
};

function loadWTVideo(vid) {
  if (!state.wt.player) {
    state.wt.player = new YT.Player('wt-player', {
      height: '100%',
      width: '100%',
      videoId: vid,
      playerVars: { 'autoplay': 1, 'controls': 1, 'origin': 'https://www.youtube.com' },
      events: {
        'onStateChange': onWTStateChange
      }
    });
  } else {
    state.wt.player.loadVideoById(vid);
  }
}

function onWTStateChange(event) {
  if (state.wt.ignoreNextEvent) {
    state.wt.ignoreNextEvent = false;
    return;
  }
  const now = Date.now();
  if (now - state.wt.lastAction < 500) return;
  
  if (event.data == YT.PlayerState.PLAYING) {
    const time = state.wt.player.getCurrentTime();
    broadcast({ type: 'wt-play', time });
    state.wt.lastAction = now;
  } else if (event.data == YT.PlayerState.PAUSED) {
    const time = state.wt.player.getCurrentTime();
    broadcast({ type: 'wt-pause', time });
    state.wt.lastAction = now;
  }
}

function handleWTMessage(peerId, msg) {
  if (msg.type === 'wt-load') {
    document.getElementById('activities-modal').classList.add('hidden');
    closeAllCards(false, 'wt-card'); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
    const wtCard = document.getElementById('wt-card');
    wtCard.classList.remove('hidden');
    makeCardFocusable(wtCard);
    
    if (!state.wt.joinedActivity) {
      showInactiveOverlay('wt-card', 'YouTube', () => {
         state.wt.joinedActivity = true;
         removeInactiveOverlay('wt-card');
         if (!focusedCard) toggleFocus(wtCard);
         loadWTVideo(msg.vid);
      });
    } else {
      loadWTVideo(msg.vid);
    }
  } else if (msg.type === 'wt-play') {
    if (state.wt.player && state.wt.player.playVideo) {
      state.wt.ignoreNextEvent = true;
      if (Math.abs(state.wt.player.getCurrentTime() - msg.time) > 2) {
        state.wt.player.seekTo(msg.time);
      }
      state.wt.player.playVideo();
    }
  } else if (msg.type === 'wt-pause') {
    if (state.wt.player && state.wt.player.pauseVideo) {
      state.wt.ignoreNextEvent = true;
      state.wt.player.seekTo(msg.time);
      state.wt.player.pauseVideo();
    }
  } else if (msg.type === 'wt-close') {
    closeAllCards(true); // CLEAN AND RESETS
  }
}
