function initLuckyWheel() {
  const broadcastActivityMsg = (msg) => {
    broadcast(msg);
  };

  // openCardFocused: kartı açar + odaklanabilir yapar + odağa alır (renderer.js).
  // Eskiden burada yalnızca hidden kaldırılıyordu; bu yüzden anket/film/çark
  // kartlarında odak, kilit ve tam ekran hiç çalışmıyordu.
  const openWheelActivityCard = (act) => {
    if (act === 'poll') openCardFocused('poll-card');
    if (act === 'lvs') openCardFocused('lvs-card');
    if (act === 'wheel') openCardFocused('wheel-card');
  };

  const setActivity = (act) => {
    closeAllCards();
    document.getElementById('activities-modal').classList.add('hidden');
    broadcast({ type: 'activity_change', activity: act });
    openWheelActivityCard(act);
  };

  const handleActClick = (act) => {
    if (state.activeLobbyId && !state.isLobbyHost) {
      closeAllCards();
      document.getElementById('activities-modal').classList.add('hidden');
      openWheelActivityCard(act);
      return;
    }
    setActivity(act);
  };

  document.getElementById('act-poll')?.addEventListener('click', () => handleActClick('poll'));
  document.getElementById('act-lvs')?.addEventListener('click', () => handleActClick('lvs'));
  document.getElementById('act-wheel')?.addEventListener('click', () => handleActClick('wheel'));

  const closeActivity = () => {
    closeAllCards(true);
    broadcast({ type: 'activity_change', activity: 'none' });
  };

  document.getElementById('poll-close')?.addEventListener('click', closeActivity);
  document.getElementById('lvs-close')?.addEventListener('click', closeActivity);
  document.getElementById('wheel-close')?.addEventListener('click', closeActivity);

  window.pollState = null;
  document.getElementById('poll-create')?.addEventListener('click', () => {
    const q = document.getElementById('poll-q').value.trim();
    const opts = [
      document.getElementById('poll-opt1').value.trim(),
      document.getElementById('poll-opt2').value.trim(),
      document.getElementById('poll-opt3').value.trim(),
      document.getElementById('poll-opt4').value.trim()
    ].filter(o => o.length > 0);
    if (!q || opts.length < 2) return alert('Soru ve en az 2 seçenek girin!');
    
    const msg = { type: 'poll_start', q, opts, id: Date.now() };
    broadcastActivityMsg(msg);
    handlePollStart(msg, true);
  });

  const handlePollStart = (data, isHost) => {
    pollState = { id: data.id, q: data.q, opts: data.opts, votes: {}, myVote: null };
    data.opts.forEach(o => pollState.votes[o] = 0);
    
    document.getElementById('poll-setup').classList.add('hidden');
    document.getElementById('poll-view').classList.remove('hidden');
    document.getElementById('poll-view-q').textContent = data.q;
    
    const endBtn = document.getElementById('poll-end');
    if (isHost) endBtn.classList.remove('hidden');
    else endBtn.classList.add('hidden');
    
    renderPoll();
  };

  const renderPoll = () => {
    if(!pollState) return;
    const cont = document.getElementById('poll-opts-container');
    cont.innerHTML = '';
    let total = Object.values(pollState.votes).reduce((a,b)=>a+b,0);
    document.getElementById('poll-total-votes').textContent = `${total} Oy`;
    
    pollState.opts.forEach(opt => {
      const v = pollState.votes[opt] || 0;
      const pct = total === 0 ? 0 : Math.round((v/total)*100);
      
      const el = document.createElement('div');
      el.className = 'poll-opt' + (pollState.myVote === opt ? ' voted' : '');
      el.innerHTML = `
        <div class="poll-bar" style="width: ${pct}%"></div>
        <div class="poll-opt-text">
          <span>${opt}</span>
          <span>${v} (${pct}%)</span>
        </div>
      `;
      el.onclick = () => {
        if(pollState.myVote === opt) return;
        const old = pollState.myVote;
        pollState.myVote = opt;
        broadcastActivityMsg({ type: 'poll_vote', pollId: pollState.id, opt, old });
        
        pollState.votes[opt]++;
        if(old && pollState.votes[old] > 0) pollState.votes[old]--;
        renderPoll();
      };
      cont.appendChild(el);
    });
  };

  document.getElementById('poll-end')?.addEventListener('click', () => {
    broadcastActivityMsg({ type: 'poll_end' });
    endPoll();
  });
  const endPoll = () => {
    pollState = null;
    document.getElementById('poll-setup').classList.remove('hidden');
    document.getElementById('poll-view').classList.add('hidden');
  };

  const lvsPlayer = document.getElementById('lvs-player');
  let lvsSyncing = false;
  
  document.getElementById('lvs-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(file) {
      const url = URL.createObjectURL(file);
      lvsPlayer.src = url;
      document.getElementById('lvs-empty').style.display = 'none';
      lvsPlayer.style.display = 'block';
    }
  });
  
  const sendLvsSync = (evType) => {
    if(lvsSyncing) return;
    broadcastActivityMsg({
      type: 'lvs_sync',
      ev: evType,
      time: lvsPlayer.currentTime,
      paused: lvsPlayer.paused
    });
  };
  
  lvsPlayer.addEventListener('play', () => sendLvsSync('play'));
  lvsPlayer.addEventListener('pause', () => sendLvsSync('pause'));
  lvsPlayer.addEventListener('seeked', () => sendLvsSync('seeked'));

  const handleLvsSync = (data) => {
    lvsSyncing = true;
    if(Math.abs(lvsPlayer.currentTime - data.time) > 1) {
      lvsPlayer.currentTime = data.time;
    }
    if(data.ev === 'play' && lvsPlayer.paused) lvsPlayer.play().catch(()=>{});
    if(data.ev === 'pause' && !lvsPlayer.paused) lvsPlayer.pause();
    setTimeout(() => lvsSyncing = false, 300);
  };

  window.wheelItems = [];
  const canvas = document.getElementById('wheel-canvas');
  const ctx = canvas?.getContext('2d');
  let currentRotation = 0;
  
  const drawWheel = () => {
    if(!ctx) return;
    ctx.clearRect(0,0,350,350);
    const cx = 175, cy = 175, r = 170;
    if(wheelItems.length === 0) {
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); 
      ctx.fillStyle = '#333'; ctx.fill(); return;
    }
    
    const slice = (Math.PI*2) / wheelItems.length;
    const colors = ['#f87171','#60a5fa','#34d399','#fbbf24','#a78bfa','#f472b6','#38bdf8','#a3e635','#facc15','#fb923c'];
    
    for(let i=0; i<wheelItems.length; i++) {
      const ang = i*slice;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, ang, ang+slice);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.stroke();
      
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang + slice/2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#000';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(wheelItems[i], r - 20, 6);
      ctx.restore();
    }
  };

  const renderWheelItems = () => {
    const list = document.getElementById('wheel-items-list');
    list.innerHTML = '';
    wheelItems.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'wheel-item-row';
      row.innerHTML = `<span>${it}</span><button class="btn-sec btn-sm" style="padding:2px 6px;">✕</button>`;
      row.querySelector('button').onclick = () => {
        wheelItems.splice(idx, 1);
        renderWheelItems();
        drawWheel();
        broadcastActivityMsg({type: 'wheel_items', items: wheelItems});
      };
      list.appendChild(row);
    });
  };

  document.getElementById('wheel-add-item')?.addEventListener('click', () => {
    const inp = document.getElementById('wheel-new-item');
    const val = inp.value.trim().substring(0,15);
    if(val && wheelItems.length < 15) {
      wheelItems.push(val);
      inp.value = '';
      renderWheelItems();
      drawWheel();
      broadcastActivityMsg({type: 'wheel_items', items: wheelItems});
    }
  });

  document.getElementById('wheel-new-item')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('wheel-add-item')?.click();
    }
  });

  const handleWheelReady = () => {
    document.getElementById('wheel-setup').classList.add('hidden');
    document.getElementById('wheel-play').classList.remove('hidden');
  };

  document.getElementById('wheel-ready')?.addEventListener('click', () => {
    if(wheelItems.length < 2) return alert('En az 2 öğe ekleyin!');
    handleWheelReady();
    broadcastActivityMsg({ type: 'wheel_ready' });
  });

  const handleWheelReset = () => {
    document.getElementById('wheel-play').classList.add('hidden');
    document.getElementById('wheel-setup').classList.remove('hidden');
    document.getElementById('wheel-winner-overlay').classList.add('hidden');
  };

  document.getElementById('wheel-reset-btn')?.addEventListener('click', () => {
    handleWheelReset();
    broadcastActivityMsg({ type: 'wheel_reset' });
  });

  document.getElementById('wheel-spin-btn')?.addEventListener('click', () => {
    if(wheelItems.length < 2) return;
    const spins = 5 + Math.random() * 5; 
    const deg = spins * 360;
    const targetDeg = currentRotation + deg;
    broadcastActivityMsg({type: 'wheel_spin', targetDeg});
    handleWheelSpin(targetDeg);
  });

  const handleWheelSpin = (targetDeg) => {
    currentRotation = targetDeg;
    canvas.style.transform = `rotate(${currentRotation}deg)`;
    
    setTimeout(() => {
      const actualDeg = currentRotation % 360;
      const sliceDeg = 360 / wheelItems.length;
      const topAngle = (270 - actualDeg + 360) % 360;
      let winnerIdx = Math.floor(topAngle / sliceDeg);
      if(winnerIdx < 0) winnerIdx = 0;
      if(winnerIdx >= wheelItems.length) winnerIdx = wheelItems.length - 1;
      
      const winner = wheelItems[winnerIdx];
      document.getElementById('wheel-winner-text').textContent = winner;
      document.getElementById('wheel-winner-overlay').classList.remove('hidden');
    }, 4100);
  };
  
  document.getElementById('wheel-winner-close')?.addEventListener('click', () => {
    document.getElementById('wheel-winner-overlay').classList.add('hidden');
  });

  drawWheel();

  window.activityHandler = (data) => {
    try {
      if (data.type === 'activity_change') {
        closeAllCards(data.activity === 'none');
        if (data.activity === 'poll') openCardFocused('poll-card');
        if (data.activity === 'lvs') openCardFocused('lvs-card');
        if (data.activity === 'wheel') openCardFocused('wheel-card');
      }
      if (data.type === 'poll_start') handlePollStart(data, false);
      if (data.type === 'poll_vote' && pollState && pollState.id === data.pollId) {
        pollState.votes[data.opt]++;
        if (data.old && pollState.votes[data.old] > 0) pollState.votes[data.old]--;
        renderPoll();
      }
      if (data.type === 'poll_end') endPoll();
      if (data.type === 'lvs_sync') handleLvsSync(data);
      if (data.type === 'wheel_items') {
        wheelItems = data.items;
        renderWheelItems();
        drawWheel();
      }
      if (data.type === 'wheel_ready') {
        handleWheelReady();
      }
      if (data.type === 'wheel_reset') {
        handleWheelReset();
      }
      if (data.type === 'wheel_spin') handleWheelSpin(data.targetDeg);
    } catch(e) {}
  };
}
