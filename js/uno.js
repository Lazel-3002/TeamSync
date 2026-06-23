function initUno() {
  document.getElementById('act-uno').addEventListener('click', () => {
    document.getElementById('activities-modal').classList.add('hidden');
    const unoCard = document.getElementById('uno-card');
    
    if (state.uno.host && state.uno.host !== state.myId) {
      const btn = unoCard.querySelector('.inactive-overlay button');
      if (btn) btn.click();
      else if (!focusedCard) toggleFocus(unoCard);
      return;
    }

    closeAllCards(); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
    unoCard.classList.remove('hidden');
    makeCardFocusable(unoCard);
    if (!focusedCard) toggleFocus(unoCard);
    
    state.uno.host = state.myId;
    state.uno.joinedActivity = true;
    state.uno.players.set(state.myId, { name: state.myName, ready: true, cardCount: 0 });
    document.getElementById('uno-host-settings').style.display = 'block';
    document.getElementById('uno-ready-btn').classList.add('hidden');
    document.getElementById('uno-start-btn').classList.remove('hidden');
    document.getElementById('uno-max-players').disabled = false;
    document.getElementById('uno-fill-bots').disabled = false;
    document.getElementById('uno-start-cards').disabled = false;
    document.querySelectorAll('.uno-rule-cb').forEach(cb => cb.disabled = false);
    
    broadcast({ type: 'uno-lobby', host: state.myId });
    renderUnoLobby();
  });

  document.getElementById('uno-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllCards(true); // CLEAN AND RESETS AND LEAVES LOBBY
  });

  document.getElementById('uno-ready-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const p = state.uno.players.get(state.myId);
    if (p) {
      p.ready = !p.ready;
      document.getElementById('uno-ready-btn').textContent = p.ready ? 'Hazırım' : 'Hazır Değilim';
      document.getElementById('uno-ready-btn').style.background = p.ready ? 'var(--ok)' : 'var(--warn)';
      broadcast({ type: 'uno-ready', ready: p.ready });
      renderUnoLobby();
    }
  });

  document.getElementById('uno-start-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const fillBots = document.getElementById('uno-fill-bots').checked;
    const totalPlayers = fillBots ? state.uno.maxPlayers : state.uno.players.size;
    if (totalPlayers < 2) {
      alert("En az 2 kişi olmalı!");
      return;
    }
    let allReady = true;
    for (const [id, p] of state.uno.players) {
      if (!p.ready) allReady = false;
    }
    if (!allReady) {
      alert("Herkes hazır değil!");
      return;
    }
    startUnoGame();
  });

  document.getElementById('uno-max-players').addEventListener('change', (e) => {
    state.uno.maxPlayers = parseInt(e.target.value);
    broadcast({ type: 'uno-max', max: state.uno.maxPlayers });
  });

  document.getElementById('uno-fill-bots').addEventListener('change', (e) => {
    broadcast({ type: 'uno-fill', fill: e.target.checked });
  });

  document.getElementById('uno-start-cards').addEventListener('change', (e) => {
    let val = parseInt(e.target.value);
    if (val < 5) val = 5;
    if (val > 20) val = 20;
    e.target.value = val;
    state.uno.rules.startCards = val;
    broadcast({ type: 'uno-rules', rules: state.uno.rules });
  });

  const ruleIds = ['kombo', 'stacking', 'jumpin', 'drawuntilplay', 'nobluff', 'nopass', 'noblacklast', 'mirror', 'zeropass', 'sevenswap'];
  const ruleKeys = ['kombo', 'stacking', 'jumpIn', 'drawUntilPlay', 'noBluff', 'noPass', 'noBlackLast', 'mirror', 'zeroPass', 'sevenSwap'];
  
  ruleIds.forEach((id, idx) => {
    const el = document.getElementById('rule-' + id);
    if(el) {
      el.addEventListener('change', (e) => {
        state.uno.rules[ruleKeys[idx]] = e.target.checked;
        broadcast({ type: 'uno-rules', rules: state.uno.rules });
      });
    }
  });

  document.getElementById('uno-end-turn-btn').addEventListener('click', () => {
     if (state.uno.host !== state.myId) {
        broadcast({ type: 'uno-end-turn' });
     } else {
        processUnoEndTurn(state.myId);
     }
  });

  document.getElementById('uno-uno-btn').addEventListener('click', () => {
    state.uno.saidUno = true;
    document.getElementById('uno-uno-btn').classList.add('hidden');
    broadcast({ type: 'uno-said' });
    showFloatingEmoji(state.myId, "UNO!");
  });

  document.getElementById('uno-catch-btn').addEventListener('click', () => {
    if (state.uno.catchTarget) {
      const targetId = state.uno.catchTarget;
      broadcast({ type: 'uno-catch', targetId: targetId });
      document.getElementById('uno-catch-btn').classList.add('hidden');
      
      if (state.uno.host === state.myId) {
        state.uno.catchTarget = null;
        broadcast({ type: 'uno-catch-success', targetId: targetId, catcherId: state.myId });
        showToast(state.uno.players.get(targetId)?.name + " YAKALANDI!", "warn");
        setTimeout(() => forceDrawCards(targetId, 2), 500);
      }
    }
  });

  document.getElementById('uno-sort-color').addEventListener('click', () => {
    state.uno.myHand.sort((a, b) => {
      if (a.color === 'black' && b.color !== 'black') return 1;
      if (b.color === 'black' && a.color !== 'black') return -1;
      if (a.color === b.color) return a.val.localeCompare(b.val);
      return a.color.localeCompare(b.color);
    });
    renderUnoGame();
  });

  document.getElementById('uno-sort-num').addEventListener('click', () => {
    state.uno.myHand.sort((a, b) => {
      const aIsNum = !isNaN(parseInt(a.val));
      const bIsNum = !isNaN(parseInt(b.val));
      
      if (!aIsNum && bIsNum) return 1;
      if (!bIsNum && aIsNum) return -1;
      
      if (aIsNum && bIsNum) {
        if (a.val === b.val) return a.color.localeCompare(b.color);
        return parseInt(a.val) - parseInt(b.val);
      }
      
      const order = { 'Skip': 1, 'Rev': 2, '+2': 3, 'Color': 4, '+4': 5 };
      const aO = order[a.val] || 0;
      const bO = order[b.val] || 0;
      if (aO !== bO) return aO - bO;
      
      return a.color.localeCompare(b.color);
    });
    renderUnoGame();
  });

  document.getElementById('uno-emojis').addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    const emoji = e.target.textContent;
    showFloatingEmoji(state.myId, emoji);
    broadcast({ type: 'uno-emoji', emoji });
  });

  document.getElementById('uno-replay-btn').addEventListener('click', () => {
    broadcast({ type: 'uno-lobby', host: state.myId });
    document.getElementById('uno-game-over').classList.add('hidden');
    document.getElementById('uno-lobby').classList.remove('hidden');
    state.uno.started = false;
  });
}

function handleUnoMessage(peerId, msg) {
  if (msg.type === 'uno-lobby') {
    if (!state.uno.host || state.uno.host === peerId) {
      state.uno.host = peerId;
      closeAllCards(); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
      document.getElementById('uno-card').classList.remove('hidden');
      document.getElementById('uno-lobby').classList.remove('hidden');
      document.getElementById('uno-game').classList.add('hidden');
      document.getElementById('uno-game-over').classList.add('hidden');
      makeCardFocusable(document.getElementById('uno-card'));
      
      if (!state.uno.joinedActivity) {
         showInactiveOverlay('uno-card', 'UNO', () => {
             state.uno.joinedActivity = true;
             removeInactiveOverlay('uno-card');
             if (!focusedCard) toggleFocus(document.getElementById('uno-card'));
             
             if (!state.uno.players.has(state.myId)) {
               state.uno.players.set(state.myId, { name: state.myName, ready: false, cardCount: 0 });
               document.getElementById('uno-host-settings').style.display = 'block';
               document.getElementById('uno-max-players').disabled = true;
               document.getElementById('uno-fill-bots').disabled = true;
               document.getElementById('uno-start-cards').disabled = true;
               document.querySelectorAll('.uno-rule-cb').forEach(cb => cb.disabled = true);
               document.getElementById('uno-ready-btn').classList.remove('hidden');
               document.getElementById('uno-start-btn').classList.add('hidden');
               document.getElementById('uno-ready-btn').textContent = 'Hazır Değilim';
               document.getElementById('uno-ready-btn').style.background = 'var(--warn)';
             }
             broadcast({ type: 'uno-join', name: state.myName, ready: state.uno.players.get(state.myId)?.ready || false });
         });
      } else {
        if (!state.uno.players.has(state.myId)) {
          state.uno.players.set(state.myId, { name: state.myName, ready: false, cardCount: 0 });
          document.getElementById('uno-host-settings').style.display = 'block';
          document.getElementById('uno-max-players').disabled = true;
          document.getElementById('uno-fill-bots').disabled = true;
          document.getElementById('uno-start-cards').disabled = true;
          document.querySelectorAll('.uno-rule-cb').forEach(cb => cb.disabled = true);
          document.getElementById('uno-ready-btn').classList.remove('hidden');
          document.getElementById('uno-start-btn').classList.add('hidden');
          document.getElementById('uno-ready-btn').textContent = 'Hazır Değilim';
          document.getElementById('uno-ready-btn').style.background = 'var(--warn)';
        }
        broadcast({ type: 'uno-join', name: state.myName, ready: state.uno.players.get(state.myId)?.ready || false });
      }
    }
  } else if (msg.type === 'uno-join') {
    state.uno.players.set(peerId, { name: msg.name, ready: msg.ready, cardCount: 0 });
    if (state.uno.host === state.myId) {
      broadcast({ type: 'uno-lobby-sync', players: Array.from(state.uno.players.entries()) });
    }
    renderUnoLobby();
  } else if (msg.type === 'uno-ready') {
    const p = state.uno.players.get(peerId);
    if (p) {
      p.ready = msg.ready;
      if (state.uno.host === state.myId) {
        broadcast({ type: 'uno-lobby-sync', players: Array.from(state.uno.players.entries()) });
      }
      renderUnoLobby();
    }
  } else if (msg.type === 'uno-lobby-sync') {
    state.uno.players = new Map(msg.players);
    renderUnoLobby();
  } else if (msg.type === 'uno-sync') {
    state.uno.host = msg.host;
    state.uno.started = true;
    state.uno.players = new Map(msg.players);
    state.uno.turnOrder = msg.turnOrder;
    state.uno.turnIndex = msg.turnIndex;
    state.uno.direction = msg.direction;
    if (msg.myHand) state.uno.myHand = msg.myHand;
    state.uno.discard = msg.discard;
    state.uno.currentColor = msg.currentColor;
    msg.handsCount.forEach(h => {
      if (state.uno.players.has(h.id)) state.uno.players.get(h.id).cardCount = h.count;
    });
    
    closeAllCards(); // ALWAYS CLOSE ALL CARDS FIRST TO AVOID OVERLAP
    document.getElementById('uno-card').classList.remove('hidden');
    document.getElementById('uno-lobby').classList.add('hidden');
    document.getElementById('uno-game').classList.remove('hidden');
    document.getElementById('uno-game-over').classList.add('hidden');
    makeCardFocusable(document.getElementById('uno-card'));
    if (!focusedCard) toggleFocus(document.getElementById('uno-card'));
    
    renderUnoGame();
  } else if (msg.type === 'uno-req-draw') {
    if (state.uno.host === state.myId) {
      if (state.uno.waitingForKeepOrPlay) return;
      const currentTurnId = state.uno.turnOrder[state.uno.turnIndex];
      if (currentTurnId !== peerId) return;
      
      if (state.uno.deck.length === 0) {
        const top = state.uno.discard.pop();
        state.uno.deck = state.uno.discard.sort(() => Math.random() - 0.5);
        state.uno.discard = [top];
      }
      const c = state.uno.deck.pop();
      broadcastTo(peerId, { type: 'uno-draw-result', card: c, forced: false });
      if (state.uno.players.has(peerId)) state.uno.players.get(peerId).cardCount++;
      
      const topCard = state.uno.discard[state.uno.discard.length - 1];
      if (!canPlay(c, topCard)) {
        state.uno.turnIndex = getNextTurn();
      } else {
        state.uno.waitingForKeepOrPlay = peerId;
      }
      
      animateCardDraw(peerId);
      broadcast({ type: 'uno-draw-anim', pid: peerId });
      
      const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
      broadcast({
        type: 'uno-sync',
        host: state.uno.host,
        players: Array.from(state.uno.players.entries()),
        turnOrder: state.uno.turnOrder,
        turnIndex: state.uno.turnIndex,
        direction: state.uno.direction,
        discard: state.uno.discard,
        currentColor: state.uno.currentColor,
        handsCount
      });
      renderUnoGame();
    }
  } else if (msg.type === 'uno-draw-result') {
    msg.card._new = true;
    state.uno.myHand.push(msg.card);
    renderUnoGame();
    if (!msg.forced) {
      const topCard = state.uno.discard[state.uno.discard.length - 1];
      if (canPlay(msg.card, topCard)) {
        showDrawModal(msg.card, state.uno.myHand.length - 1);
      } else if (state.uno.rules && state.uno.rules.drawUntilPlay) {
         setTimeout(() => {
             document.getElementById('uno-deck').click();
         }, 400);
      }
    }
  } else if (msg.type === 'uno-keep') {
    if (state.uno.host === state.myId) {
      state.uno.waitingForKeepOrPlay = null;
      state.uno.turnIndex = getNextTurn();
      if (state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
      const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
      broadcast({ type: 'uno-sync', host: state.uno.host, players: Array.from(state.uno.players.entries()), turnOrder: state.uno.turnOrder, turnIndex: state.uno.turnIndex, direction: state.uno.direction, discard: state.uno.discard, currentColor: state.uno.currentColor, handsCount });
      renderUnoGame();
    }
  } else if (msg.type === 'uno-draw-anim') {
    animateCardDraw(msg.pid);
  } else if (msg.type === 'uno-leave') {
    if (state.uno.host === peerId) {
      alert("Kurucu odadan çıktı. UNO iptal edildi.");
      document.getElementById('uno-close').click();
    } else {
      state.uno.players.delete(peerId);
      renderUnoLobby();
    }
  } else if (msg.type === 'uno-kicked') {
    if (msg.targetId === state.myId) {
       alert("Kurucu tarafından UNO'dan atıldınız!");
       document.getElementById('uno-close').click();
       state.uno.joinedActivity = false;
    } else {
       state.uno.players.delete(msg.targetId);
       renderUnoLobby();
    }
  } else if (msg.type === 'uno-max') {
    state.uno.maxPlayers = msg.max;
    if (state.uno.host !== state.myId) document.getElementById('uno-max-players').value = msg.max;
  } else if (msg.type === 'uno-fill') {
    if (state.uno.host !== state.myId) document.getElementById('uno-fill-bots').checked = msg.fill;
  } else if (msg.type === 'uno-rules') {
    state.uno.rules = msg.rules;
    if (state.uno.host !== state.myId) {
      document.getElementById('uno-start-cards').value = msg.rules.startCards;
      document.getElementById('rule-kombo').checked = msg.rules.kombo;
      document.getElementById('rule-stacking').checked = msg.rules.stacking;
      document.getElementById('rule-jumpin').checked = msg.rules.jumpIn;
      document.getElementById('rule-drawuntilplay').checked = msg.rules.drawUntilPlay;
      document.getElementById('rule-nobluff').checked = msg.rules.noBluff;
      document.getElementById('rule-nopass').checked = msg.rules.noPass;
      document.getElementById('rule-noblacklast').checked = msg.rules.noBlackLast;
      document.getElementById('rule-mirror').checked = msg.rules.mirror;
      document.getElementById('rule-zeropass').checked = msg.rules.zeroPass;
      document.getElementById('rule-sevenswap').checked = msg.rules.sevenSwap;
    }
  } else if (msg.type === 'uno-start') {
    state.uno.started = true;
    state.uno.turnOrder = msg.turnOrder;
    state.uno.turnIndex = msg.turnIndex;
    state.uno.direction = msg.direction;
    state.uno.myHand = msg.hands[state.myId] || [];
    for (const id of state.uno.turnOrder) {
      if (state.uno.players.has(id)) {
        state.uno.players.get(id).cardCount = msg.hands[id]?.length || 0;
      }
    }
    state.uno.discard = [msg.firstCard];
    state.uno.currentColor = msg.firstCard.color;
    
    document.getElementById('uno-lobby').classList.add('hidden');
    document.getElementById('uno-game').classList.remove('hidden');
    document.getElementById('uno-game-over').classList.add('hidden');
    renderUnoGame();
  } else if (msg.type === 'uno-play') {
    playPopSound();
    hideUnoCatch();
    const pId = msg.botId || peerId;
    if (pId !== state.myId) animateRemotePlay(pId, msg.card);
    
    const p = state.uno.players.get(pId);
    if (p) p.cardCount--;
    state.uno.discard.push(msg.card);
    state.uno.currentColor = msg.color || msg.card.color;
    state.uno.turnIndex = msg.nextTurnIndex;
    state.uno.direction = msg.direction;
    if (state.uno.host === state.myId) {
      state.uno.waitingForKeepOrPlay = null;
      if (state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
    }
    state.uno.triggerDiscardAnim = true;

    if (p && p.cardCount === 1 && !msg.saidUno) {
      if (pId === state.myId) {
        document.getElementById('uno-uno-btn').classList.remove('hidden');
      } else {
        if (state.uno.catchTimeout) clearTimeout(state.uno.catchTimeout);
        state.uno.catchTimeout = setTimeout(() => {
          state.uno.catchTarget = pId;
          document.getElementById('uno-catch-btn').classList.remove('hidden');
        }, 500);
      }
    }

    setTimeout(() => renderUnoGame(), 300);

    if (state.uno.host === state.myId) {
      if (p && p.cardCount === 0) {
        setTimeout(() => endUnoGame(), 800);
        return;
      }
      
      let specialRuleTriggered = false;
      if (msg.card.val === '0' && state.uno.rules && state.uno.rules.zeroPass) {
          state.uno.zeroPassPending = true;
          state.uno.collectedHands = {};
          broadcast({ type: 'uno-req-hands' });
          state.uno.collectedHands[state.myId] = [...state.uno.myHand];
          for (let id in state.uno.botHands) state.uno.collectedHands[id] = [...state.uno.botHands[id]];
          specialRuleTriggered = true;
      }
      if (msg.card.val === '7' && state.uno.rules && state.uno.rules.sevenSwap) {
          state.uno.sevenSwapPending = true;
          state.uno.sevenSwapInitiator = msg.botId || peerId;
          state.uno.collectedHands = {};
          broadcast({ type: 'uno-req-hands' });
          state.uno.collectedHands[state.myId] = [...state.uno.myHand];
          for (let id in state.uno.botHands) state.uno.collectedHands[id] = [...state.uno.botHands[id]];
          specialRuleTriggered = true;
      }
      
      if (!specialRuleTriggered && Object.keys(state.uno.collectedHands || {}).length === state.uno.players.size) {
         checkAndProcessHandSwaps();
      }
      
      if (msg.drawCount > 0 && !msg.isKombo) {
        if (state.uno.rules && (state.uno.rules.stacking || state.uno.rules.mirror)) {
            state.uno.pendingDrawCount = (state.uno.pendingDrawCount || 0) + msg.drawCount;
            broadcast({ type: 'uno-pending-draw', count: state.uno.pendingDrawCount });
        } else {
            setTimeout(() => {
              const victimIndex = getNextTurn(1, msg.oldTurnIndex, msg.direction);
              const victimId = state.uno.turnOrder[victimIndex];
              forceDrawCards(victimId, msg.drawCount);
            }, 500);
        }
      }
    }

  } else if (msg.type === 'uno-pending-draw') {
      state.uno.pendingDrawCount = msg.count;
  } else if (msg.type === 'uno-take-pending') {
      hideUnoCatch();
      if (state.uno.host === state.myId) {
          const count = state.uno.pendingDrawCount;
          state.uno.pendingDrawCount = 0;
          broadcast({ type: 'uno-pending-draw', count: 0 });
          forceDrawCards(peerId, count);
          
          setTimeout(() => {
              state.uno.turnIndex = getNextTurn(1);
              broadcast({ type: 'uno-end-turn-sync', nextTurnIndex: state.uno.turnIndex });
              renderUnoGame();
          }, 800);
      }
  } else if (msg.type === 'uno-end-turn') {
    if (state.uno.host === state.myId) {
      processUnoEndTurn(peerId);
    }
  } else if (msg.type === 'uno-req-hands') {
      broadcast({ type: 'uno-res-hands', hand: state.uno.myHand });
  } else if (msg.type === 'uno-res-hands') {
      if (state.uno.host === state.myId) {
          state.uno.collectedHands = state.uno.collectedHands || {};
          state.uno.collectedHands[peerId] = msg.hand;
          checkAndProcessHandSwaps();
      }
  } else if (msg.type === 'uno-dist-hands') {
      distributeHands(msg.hands);
  } else if (msg.type === 'uno-end-turn-sync') {
    state.uno.turnIndex = msg.nextTurnIndex;
    if (state.uno.host === state.myId && state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
    document.getElementById('uno-end-turn-btn').classList.add('hidden');
    renderUnoGame();
  } else if (msg.type === 'uno-draw') {
    hideUnoCatch();
    const pId = msg.botId || peerId;
    const p = state.uno.players.get(pId);
    if (p) p.cardCount += msg.count;
    state.uno.turnIndex = msg.nextTurnIndex;
    if (state.uno.host === state.myId && state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
    renderUnoGame();
  } else if (msg.type === 'uno-emoji') {
    showFloatingEmoji(peerId, msg.emoji);
  } else if (msg.type === 'uno-said') {
    if (state.uno.catchTarget === peerId) {
      clearTimeout(state.uno.catchTimeout);
      document.getElementById('uno-catch-btn').classList.add('hidden');
      state.uno.catchTarget = null;
    }
    showFloatingEmoji(peerId, "UNO!");
    showToast(state.uno.players.get(peerId)?.name + " UNO dedi!", "ok");
  } else if (msg.type === 'uno-catch') {
    if (state.uno.host === state.myId && state.uno.catchTarget === msg.targetId) {
      state.uno.catchTarget = null;
      broadcast({ type: 'uno-catch-success', targetId: msg.targetId, catcherId: peerId });
      showToast(state.uno.players.get(msg.targetId)?.name + " YAKALANDI!", "warn");
      setTimeout(() => forceDrawCards(msg.targetId, 2), 500);
    }
  } else if (msg.type === 'uno-catch-success') {
    state.uno.catchTarget = null;
    clearTimeout(state.uno.catchTimeout);
    document.getElementById('uno-catch-btn').classList.add('hidden');
    showToast(state.uno.players.get(msg.targetId)?.name + " UNO demeyi unuttuğu için YAKALANDI!", "warn");
  } else if (msg.type === 'uno-game-over') {
    showUnoGameOver(msg.rankings);
  }
}

function checkAndProcessHandSwaps() {
    if (!state.uno.collectedHands || Object.keys(state.uno.collectedHands).length < state.uno.players.size) return;
    
    if (state.uno.zeroPassPending) {
        state.uno.zeroPassPending = false;
        let newHands = {};
        for (let i=0; i<state.uno.turnOrder.length; i++) {
            let nextIdx = getNextTurn(1, i, state.uno.direction);
            newHands[state.uno.turnOrder[nextIdx]] = state.uno.collectedHands[state.uno.turnOrder[i]];
        }
        broadcast({ type: 'uno-dist-hands', hands: newHands });
        distributeHands(newHands);
    } else if (state.uno.sevenSwapPending) {
        state.uno.sevenSwapPending = false;
        let targets = state.uno.turnOrder.filter(id => id !== state.uno.sevenSwapInitiator);
        if (targets.length > 0) {
            let randomTarget = targets[Math.floor(Math.random() * targets.length)];
            let newHands = { ...state.uno.collectedHands };
            newHands[state.uno.sevenSwapInitiator] = state.uno.collectedHands[randomTarget];
            newHands[randomTarget] = state.uno.collectedHands[state.uno.sevenSwapInitiator];
            broadcast({ type: 'uno-dist-hands', hands: newHands });
            distributeHands(newHands);
        }
    }
}

function distributeHands(hands) {
    if (hands[state.myId]) state.uno.myHand = hands[state.myId];
    for (const [id, h] of Object.entries(hands)) {
        if (state.uno.players.has(id)) {
            state.uno.players.get(id).cardCount = h.length;
        }
        if (id.startsWith('bot-') && state.myId === state.uno.host) {
            state.uno.botHands[id] = h;
        }
    }
    showToast("Eller değişti!", "warn");
    renderUnoGame();
}

function forceDrawCards(victimId, count) {
  if (state.uno.host !== state.myId) return;
  for (let i = 0; i < count; i++) {
    if (state.uno.deck.length === 0) {
      const top = state.uno.discard.pop();
      state.uno.deck = state.uno.discard.sort(() => Math.random() - 0.5);
      state.uno.discard = [top];
    }
    const c = state.uno.deck.pop();
    const p = state.uno.players.get(victimId);
    if (!p) continue;
    p.cardCount++;
    
    if (victimId === state.myId) {
      state.uno.myHand.push({ ...c, _new: true });
    } else if (victimId.startsWith('bot-')) {
      state.uno.botHands[victimId].push(c);
    } else {
      broadcastTo(victimId, { type: 'uno-draw-result', card: c, forced: true });
    }
    
    animateCardDraw(victimId);
    broadcast({ type: 'uno-draw-anim', pid: victimId });
  }

  const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
  broadcast({
    type: 'uno-sync',
    host: state.uno.host,
    players: Array.from(state.uno.players.entries()),
    turnOrder: state.uno.turnOrder,
    turnIndex: state.uno.turnIndex,
    direction: state.uno.direction,
    discard: state.uno.discard,
    currentColor: state.uno.currentColor,
    handsCount
  });
  renderUnoGame();
}

function renderUnoLobby() {
  const wrap = document.getElementById('uno-players');
  wrap.innerHTML = '';
  for (const [id, p] of state.uno.players) {
    const div = document.createElement('div');
    div.className = 'uno-p-item' + (p.ready ? ' ready' : '');
    
    let kickBtn = '';
    if (state.uno.host === state.myId && id !== state.myId && !id.startsWith('bot-')) {
      kickBtn = `<button class="btn-sec btn-sm" style="margin-left: 10px; padding: 2px 6px; font-size: 10px; background: rgba(255,0,0,0.5); color: white; border: none;" onclick="kickUnoPlayer('${id}', event)">X</button>`;
    }
    
    div.innerHTML = `<div class="st ${p.ready ? '' : 'muted'}"></div> <span>${escapeHtml(p.name)}</span> ${id === state.uno.host ? '👑' : ''} ${kickBtn}`;
    wrap.appendChild(div);
  }
}

window.kickUnoPlayer = async (id, e) => {
  e.stopPropagation();
  if (await window.showConfirm('⚠️ Oyuncuyu At', "Bu oyuncuyu atmak istediğinize emin misiniz?")) {
    broadcast({ type: 'uno-kicked', targetId: id });
    state.uno.players.delete(id);
    renderUnoLobby();
  }
};

function getUnoDeck() {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const deck = [];
  for (let c of colors) {
    deck.push({ color: c, val: '0' });
    for (let i = 1; i <= 9; i++) {
      deck.push({ color: c, val: i.toString() });
      deck.push({ color: c, val: i.toString() });
    }
    deck.push({ color: c, val: 'Skip' }); deck.push({ color: c, val: 'Skip' });
    deck.push({ color: c, val: 'Rev' }); deck.push({ color: c, val: 'Rev' });
    deck.push({ color: c, val: '+2' }); deck.push({ color: c, val: '+2' });
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'black', val: 'Color' });
    deck.push({ color: 'black', val: '+4' });
  }
  return deck.sort(() => Math.random() - 0.5);
}

function startUnoGame() {
  const fillBots = document.getElementById('uno-fill-bots').checked;
  if (fillBots) {
    let botIndex = 1;
    while (state.uno.players.size < state.uno.maxPlayers) {
      const bId = 'bot-' + botIndex;
      state.uno.players.set(bId, { name: '🤖 Bot ' + botIndex, ready: true, cardCount: 0 });
      botIndex++;
    }
    broadcast({ type: 'uno-lobby-sync', players: Array.from(state.uno.players.entries()) });
  }

  const deck = getUnoDeck();
  const hands = {};
  const turnOrder = Array.from(state.uno.players.keys());
  state.uno.botHands = {};
  
  const initialCardCount = state.uno.rules ? state.uno.rules.startCards : 7;
  
  for (const id of turnOrder) {
    hands[id] = [];
    for (let i = 0; i < initialCardCount; i++) hands[id].push(deck.pop());
    if (id.startsWith('bot-')) state.uno.botHands[id] = hands[id];
  }
  let firstCard = deck.pop();
  while (firstCard.color === 'black' || firstCard.val === 'Skip' || firstCard.val === 'Rev' || firstCard.val === '+2') {
    deck.unshift(firstCard);
    firstCard = deck.pop();
  }
  
  const startMsg = {
    type: 'uno-start',
    turnOrder, turnIndex: 0, direction: 1,
    hands, firstCard
  };
  
  console.log("startUnoGame: myId=", state.myId, "turnOrder=", turnOrder, "hands length for me=", hands[state.myId]?.length);

  state.uno.started = true;
  state.uno.deck = deck;
  state.uno.turnOrder = turnOrder;
  state.uno.turnIndex = 0;
  state.uno.direction = 1;
  state.uno.myHand = hands[state.myId];
  for (const id of turnOrder) {
    if (state.uno.players.has(id)) state.uno.players.get(id).cardCount = hands[id].length;
  }
  state.uno.discard = [firstCard];
  state.uno.currentColor = firstCard.color;

  broadcast(startMsg);
  
  document.getElementById('uno-lobby').classList.add('hidden');
  document.getElementById('uno-game').classList.remove('hidden');
  renderUnoGame();
}

function renderUnoGame() {
  try {
    doRenderUnoGame();
  } catch (err) {
    console.error("UNO Render Error:", err);
  }
}

function doRenderUnoGame() {
  if (!state.uno.started) return;
  
  updateUnoRulesUI();
  
  const currentTurnId = state.uno.turnOrder[state.uno.turnIndex];
  const pName = state.uno.players.get(currentTurnId)?.name || 'Bilinmiyor';
  document.getElementById('uno-turn-name').textContent = pName;
  document.getElementById('uno-turn-indicator').style.background = (currentTurnId === state.myId) ? 'var(--ok)' : 'rgba(0,0,0,0.6)';
  
  if (currentTurnId.startsWith('bot-') && state.myId === state.uno.host) {
    if (state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
    state.uno.botTimeout = setTimeout(() => {
      botPlay(currentTurnId);
    }, 1500);
  }
  
  document.getElementById('uno-dir-indicator').textContent = state.uno.direction === 1 ? '🔃' : '🔄';
  
  const topCard = state.uno.discard[state.uno.discard.length - 1];
  
  let discardDiv = document.getElementById('uno-discard');
  if (!discardDiv) {
    console.error("FATAL: uno-discard is MISSING from the DOM! Recreating it...");
    discardDiv = document.createElement('div');
    discardDiv.id = 'uno-discard';
    discardDiv.className = 'uno-card-ui empty';
    const center = document.getElementById('uno-center');
    if (center) center.appendChild(discardDiv);
    else return;
  }
  
  discardDiv.className = `uno-card-ui ${state.uno.currentColor}`;
  if (state.uno.triggerDiscardAnim) {
    discardDiv.style.transform = 'scale(1.2)';
    setTimeout(() => { discardDiv.style.transform = 'scale(1)'; }, 150);
    state.uno.triggerDiscardAnim = false;
  }
  
  if (state.uno.currentColor !== topCard.color && topCard.color === 'black') {
     discardDiv.innerHTML = `<span class="mini tl">${topCard.val}</span> ${topCard.val} <span class="mini br">${topCard.val}</span>`;
     discardDiv.style.borderColor = state.uno.currentColor;
  } else {
     discardDiv.innerHTML = `<span class="mini tl">${topCard.val}</span> ${topCard.val} <span class="mini br">${topCard.val}</span>`;
     discardDiv.style.borderColor = 'white';
  }

  const table = document.getElementById('uno-table');
  table.querySelectorAll('.uno-remote-player').forEach(el => el.remove());
  
  const otherPlayers = [];
  let idx = state.uno.turnOrder.indexOf(state.myId);
  for (let i = 1; i < state.uno.turnOrder.length; i++) {
    const nextIdx = (idx + i) % state.uno.turnOrder.length;
    otherPlayers.push(state.uno.turnOrder[nextIdx]);
  }

  const angles = [];
  if (otherPlayers.length === 1) {
    angles.push(270);
  } else if (otherPlayers.length === 2) {
    angles.push(210, 330);
  } else if (otherPlayers.length === 3) {
    angles.push(180, 270, 0);
  } else if (otherPlayers.length > 3) {
    const step = 180 / (otherPlayers.length - 1);
    for (let i = 0; i < otherPlayers.length; i++) {
      angles.push(180 + (i * step));
    }
  }

  otherPlayers.forEach((id, i) => {
    const rp = document.createElement('div');
    rp.className = 'uno-remote-player';
    const angle = angles[i] || 0;
    const rad = angle * Math.PI / 180;
    const radiusX = 35; 
    const radiusY = 30; 
    
    rp.dataset.pid = id;
    rp.style.left = `calc(50% + ${Math.cos(rad) * radiusX}%)`;
    rp.style.top = `calc(50% + ${Math.sin(rad) * radiusY}%)`;
    rp.style.transform = `translate(-50%, -50%)`;
    
    const pInfo = state.uno.players.get(id);
    if (!pInfo) return;
    
    rp.innerHTML = `
      <div class="card-count" style="border-color: ${id === currentTurnId ? 'var(--ok)' : 'transparent'}">${pInfo.cardCount}</div>
      <div class="uname">${escapeHtml(pInfo.name)}</div>
    `;
    table.appendChild(rp);
  });

  const handDiv = document.getElementById('uno-my-hand');
  handDiv.innerHTML = '';
  state.uno.myHand.forEach((c, cIdx) => {
    const cDiv = document.createElement('div');
    cDiv.className = `uno-card-ui ${c.color}`;
    if (c._new) {
      cDiv.classList.add('draw-anim');
      delete c._new;
    }
    cDiv.innerHTML = `<span class="mini tl">${c.val}</span> ${c.val} <span class="mini br">${c.val}</span>`;
    
    cDiv.addEventListener('click', () => {
      if (currentTurnId !== state.myId) {
        if (state.uno.rules && state.uno.rules.jumpIn && canPlay(c, topCard, true)) {
           if (c.color === 'black') {
              document.getElementById('uno-color-picker').classList.remove('hidden');
              document.querySelectorAll('.ucc').forEach(btn => {
                btn.onclick = () => {
                  const selectedColor = btn.dataset.color;
                  document.getElementById('uno-color-picker').classList.add('hidden');
                  playCard(cIdx, selectedColor, true);
                };
              });
           } else {
              playCard(cIdx, null, true);
           }
        }
        return;
      }
      
      if (state.uno.myHand.length === 1 && state.uno.rules && state.uno.rules.noBlackLast) {
         if (c.color === 'black' || ['Skip', 'Rev', '+2'].includes(c.val)) {
             showToast("Zorlu Son Kart: Son kart eylem veya siyah olamaz!", "warn");
             return;
         }
      }
      
      if (canPlay(c, topCard)) {
        if (c.color === 'black') {
          document.getElementById('uno-color-picker').classList.remove('hidden');
          document.querySelectorAll('.ucc').forEach(btn => {
            btn.onclick = () => {
              const selectedColor = btn.dataset.color;
              document.getElementById('uno-color-picker').classList.add('hidden');
              playCard(cIdx, selectedColor);
            };
          });
        } else {
          playCard(cIdx);
        }
      } else {
        showToast("Bu kartı oynayamazsın!", "warn");
      }
    });
    handDiv.appendChild(cDiv);
  });

  document.getElementById('uno-deck').onclick = () => {
    if (!state.uno.started) return;
    if (state.uno.turnOrder[state.uno.turnIndex] === state.myId) {
      hideUnoCatch();
      if (state.uno.pendingDrawCount > 0) {
          broadcast({ type: 'uno-take-pending' });
          return;
      }
      
      const deckDiv = document.getElementById('uno-deck');
      deckDiv.style.transform = 'scale(0.9)';
      setTimeout(() => { deckDiv.style.transform = 'scale(1)'; }, 150);

      if (state.uno.host === state.myId) {
        if (state.uno.deck.length === 0) {
          const top = state.uno.discard.pop();
          state.uno.deck = state.uno.discard.sort(() => Math.random() - 0.5);
          state.uno.discard = [top];
        }
        const newCard = state.uno.deck.pop();
        const p = state.uno.players.get(state.myId);
        if(p) p.cardCount++;
        
        const topCard = state.uno.discard[state.uno.discard.length - 1];
        let canPlayDrawn = canPlay(newCard, topCard);
        
        state.uno.myHand.push({ ...newCard, _new: true });
        
        if (!canPlayDrawn) {
          state.uno.turnIndex = getNextTurn();
        } else {
          state.uno.waitingForKeepOrPlay = state.myId;
        }
        
        animateCardDraw(state.myId);
        broadcast({ type: 'uno-draw-anim', pid: state.myId });
        
        const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
        broadcast({
          type: 'uno-sync',
          host: state.uno.host,
          players: Array.from(state.uno.players.entries()),
          turnOrder: state.uno.turnOrder,
          turnIndex: state.uno.turnIndex,
          direction: state.uno.direction,
          discard: state.uno.discard,
          currentColor: state.uno.currentColor,
          handsCount
        });
        renderUnoGame();
        
        if (canPlayDrawn) {
          showDrawModal(newCard, state.uno.myHand.length - 1);
        } else if (state.uno.rules && state.uno.rules.drawUntilPlay) {
           setTimeout(() => {
               document.getElementById('uno-deck').click();
           }, 400);
        }
      } else {
        broadcast({ type: 'uno-req-draw' });
      }
    }
  };

  if (state.uno.started && state.uno.myHand.length === 1 && !state.uno.saidUno) {
    document.getElementById('uno-uno-btn').classList.remove('hidden');
  } else {
    document.getElementById('uno-uno-btn').classList.add('hidden');
    if (state.uno.myHand.length !== 1) state.uno.saidUno = false;
  }

  if (state.uno.catchTarget) {
    const targetPlayer = state.uno.players.get(state.uno.catchTarget);
    if (!targetPlayer || targetPlayer.cardCount !== 1) {
      hideUnoCatch();
    }
  }
}

function hideUnoCatch() {
  if (state.uno.catchTimeout) {
    clearTimeout(state.uno.catchTimeout);
    state.uno.catchTimeout = null;
  }
  document.getElementById('uno-catch-btn').classList.add('hidden');
  state.uno.catchTarget = null;
}

function canPlay(card, topCard, isJumpIn = false) {
  if (state.uno.pendingDrawCount > 0) {
    if (state.uno.rules && state.uno.rules.stacking && (card.val === '+2' || card.val === '+4') && card.val === topCard.val) {
       return true;
    }
    if (state.uno.rules && state.uno.rules.mirror && card.val === 'Rev' && topCard.val === '+2') {
       return true;
    }
    return false;
  }

  if (isJumpIn) {
    return card.color !== 'black' && card.color === topCard.color && card.val === topCard.val;
  }

  // Blöf Kuralı (Serbest Atış kapalıysa)
  if (card.val === '+4' && state.uno.rules && !state.uno.rules.noBluff) {
    let hasMatchingColor = false;
    for (let c of state.uno.myHand) {
      if (c !== card && c.color === state.uno.currentColor) {
        hasMatchingColor = true;
        break;
      }
    }
    if (hasMatchingColor) return false;
  }

  if (card.color === 'black') return true;
  if (card.color === state.uno.currentColor) return true;
  if (card.val === topCard.val) return true;
  return false;
}

function getNextTurn(skip = 1, currentIdx = state.uno.turnIndex, currentDir = state.uno.direction) {
  let len = state.uno.turnOrder.length;
  let next = (currentIdx + currentDir * skip) % len;
  if (next < 0) next += len;
  return next;
}

function animateCardDraw(pid) {
  const table = document.getElementById('uno-table');
  const deck = document.getElementById('uno-deck');
  if (!table || !deck) return;
  
  const deckRect = deck.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  
  const startX = deckRect.left - tableRect.left + (deckRect.width / 2);
  const startY = deckRect.top - tableRect.top + (deckRect.height / 2);
  
  let endX = startX;
  let endY = startY + 150; 
  
  if (pid === state.myId) {
    const hand = document.getElementById('uno-my-hand');
    if (hand) {
      const handRect = hand.getBoundingClientRect();
      endX = handRect.left - tableRect.left + (handRect.width / 2);
      endY = handRect.top - tableRect.top + (handRect.height / 2);
    }
  } else {
    const rp = Array.from(document.querySelectorAll('.uno-remote-player')).find(el => el.dataset.pid === pid);
    if (rp) {
      const rpRect = rp.getBoundingClientRect();
      endX = rpRect.left - tableRect.left + (rpRect.width / 2);
      endY = rpRect.top - tableRect.top + (rpRect.height / 2);
    }
  }
  
  const animCard = document.createElement('div');
  animCard.className = 'uno-card-ui back';
  animCard.textContent = 'UNO';
  animCard.style.position = 'absolute';
  animCard.style.left = `${startX}px`;
  animCard.style.top = `${startY}px`;
  animCard.style.transform = `translate(-50%, -50%) scale(0.8)`;
  animCard.style.transition = 'all 0.3s ease-out';
  animCard.style.zIndex = 150;
  
  table.appendChild(animCard);
  playSound('draw');
  
  animCard.getBoundingClientRect();
  
  animCard.style.left = `${endX}px`;
  animCard.style.top = `${endY}px`;
  animCard.style.transform = `translate(-50%, -50%) scale(0.3) rotate(180deg)`;
  animCard.style.opacity = '0';
  
  setTimeout(() => animCard.remove(), 350);
}

function playCard(index, chosenColor = null, isJumpIn = false) {
  playPopSound();
  hideUnoCatch();
  const handDiv = document.getElementById('uno-my-hand');
  const cardEl = handDiv.children[index];
  if (cardEl) {
    cardEl.classList.add('play-anim');
  }
  
  setTimeout(() => {
    const card = state.uno.myHand.splice(index, 1)[0];
    const p = state.uno.players.get(state.myId);
    if (p) p.cardCount--;
    
    state.uno.discard.push(card);
    state.uno.currentColor = chosenColor || card.color;
    
    if (isJumpIn) {
      state.uno.turnIndex = state.uno.turnOrder.indexOf(state.myId);
    }
    
    let skip = 1;
    if (card.val === 'Rev') {
      state.uno.direction *= -1;
      if (state.uno.turnOrder.length === 2) skip = 2;
    }
    let drawCount = 0;
    if (card.val === 'Skip') skip = 2;
    if (card.val === '+2') { skip = 2; drawCount = 2; }
    if (card.val === '+4') { skip = 2; drawCount = 4; }
    
    let isKombo = false;
    if (state.uno.rules && state.uno.rules.kombo && !isNaN(parseInt(card.val))) {
      const hasAnother = state.uno.myHand.some(c => c.val === card.val);
      if (hasAnother) {
        skip = 0;
        isKombo = true;
      }
    }
    
    const oldTurnIndex = state.uno.turnIndex;
    state.uno.turnIndex = getNextTurn(skip);
    
    state.uno.triggerDiscardAnim = true;
    
    let saidUno = false;
    if (state.uno.saidUno) {
      saidUno = true;
      state.uno.saidUno = false;
      document.getElementById('uno-uno-btn').classList.add('hidden');
    }
    
    if (state.uno.myHand.length === 1 && !saidUno) {
      document.getElementById('uno-uno-btn').classList.remove('hidden');
    } else {
      document.getElementById('uno-uno-btn').classList.add('hidden');
    }
    
    if (isKombo) {
      document.getElementById('uno-end-turn-btn').classList.remove('hidden');
    } else {
      document.getElementById('uno-end-turn-btn').classList.add('hidden');
    }
    
    broadcast({ type: 'uno-play', card, color: chosenColor, direction: state.uno.direction, nextTurnIndex: state.uno.turnIndex, oldTurnIndex, drawCount, saidUno, isJumpIn, isKombo });
    renderUnoGame();
    
    if (state.uno.host === state.myId && drawCount > 0 && !isKombo) {
      if (state.uno.rules && (state.uno.rules.stacking || state.uno.rules.mirror)) {
        state.uno.pendingDrawCount = (state.uno.pendingDrawCount || 0) + drawCount;
        broadcast({ type: 'uno-pending-draw', count: state.uno.pendingDrawCount });
      } else {
        setTimeout(() => {
          const victimIndex = getNextTurn(1, oldTurnIndex, state.uno.direction);
          const victimId = state.uno.turnOrder[victimIndex];
          forceDrawCards(victimId, drawCount);
        }, 500);
      }
    }
    
    if (state.uno.myHand.length === 0) {
      if (state.uno.host === state.myId) {
        setTimeout(() => endUnoGame(), 800);
      }
      return;
    }
  }, 250);
}

function processUnoEndTurn(pid) {
  state.uno.turnIndex = getNextTurn(1, state.uno.turnIndex, state.uno.direction);
  document.getElementById('uno-end-turn-btn').classList.add('hidden');
  broadcast({ type: 'uno-end-turn-sync', nextTurnIndex: state.uno.turnIndex });
  renderUnoGame();
}

function botPlay(botId) {
  if (!state.uno.started || state.myId !== state.uno.host) return;
  
  const botHand = state.uno.botHands[botId];
  if (!botHand) return;
  
  const topCard = state.uno.discard[state.uno.discard.length - 1];
  
  let validIndex = -1;
  for (let i = 0; i < botHand.length; i++) {
    if (canPlay(botHand[i], topCard)) {
      validIndex = i;
      break;
    }
  }
  
  if (validIndex !== -1) {
    const card = botHand.splice(validIndex, 1)[0];
    const p = state.uno.players.get(botId);
    if (p) p.cardCount--;
    
    state.uno.discard.push(card);
    let chosenColor = card.color;
    if (chosenColor === 'black') {
      const colors = ['red', 'blue', 'green', 'yellow'];
      chosenColor = colors[Math.floor(Math.random() * colors.length)];
    }
    state.uno.currentColor = chosenColor;
    
    let skip = 1;
    if (card.val === 'Rev') {
      state.uno.direction *= -1;
      if (state.uno.turnOrder.length === 2) skip = 2;
    }
    let drawCount = 0;
    if (card.val === 'Skip') skip = 2;
    if (card.val === '+2') { skip = 2; drawCount = 2; }
    if (card.val === '+4') { skip = 2; drawCount = 4; }
    
    const oldTurnIndex = state.uno.turnIndex;
    state.uno.turnIndex = getNextTurn(skip);
    
    let saidUno = false;
    if (botHand.length === 1) saidUno = Math.random() > 0.3; // Bot %70 ihtimalle UNO der
    if (saidUno) {
      broadcast({ type: 'uno-said' });
      showFloatingEmoji(botId, "UNO!");
    }
    
    broadcast({ type: 'uno-play', card, color: chosenColor, direction: state.uno.direction, nextTurnIndex: state.uno.turnIndex, botId, oldTurnIndex, drawCount, saidUno });
    playPopSound();
    animateRemotePlay(botId, card);
    state.uno.triggerDiscardAnim = true;
    setTimeout(() => renderUnoGame(), 300);
    
    if (drawCount > 0) {
      setTimeout(() => {
        const victimIndex = getNextTurn(1, oldTurnIndex, state.uno.direction);
        const victimId = state.uno.turnOrder[victimIndex];
        forceDrawCards(victimId, drawCount);
      }, 500);
    }
    
    if (botHand.length === 0) {
      setTimeout(() => endUnoGame(), 800);
      return;
    }
  } else {
    if (state.uno.deck.length > 0) {
      const newCard = state.uno.deck.pop();
      botHand.push(newCard);
      const p = state.uno.players.get(botId);
      if(p) p.cardCount++;
      
      const topCard = state.uno.discard[state.uno.discard.length - 1];
      const botCanPlay = canPlay(newCard, topCard);
      if (!botCanPlay) {
        state.uno.turnIndex = getNextTurn();
      }
      
      animateCardDraw(botId);
      broadcast({ type: 'uno-draw-anim', pid: botId });
      
      const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
      broadcast({
        type: 'uno-sync',
        host: state.uno.host,
        players: Array.from(state.uno.players.entries()),
        turnOrder: state.uno.turnOrder,
        turnIndex: state.uno.turnIndex,
        direction: state.uno.direction,
        discard: state.uno.discard,
        currentColor: state.uno.currentColor,
        handsCount
      });
      renderUnoGame();
      
      if (botCanPlay) {
        setTimeout(() => botPlay(botId), 1000);
      }
    } else {
      state.uno.turnIndex = getNextTurn();
      broadcast({ type: 'uno-draw', count: 0, nextTurnIndex: state.uno.turnIndex, botId }); 
      renderUnoGame();
    }
  }
}

function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    if (type === 'uno') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'draw') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    }
    
    osc.connect(gain);
    gain.connect(ctx.destination);
  } catch (e) {}
}

function playPopSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 800;
    noise.connect(noiseFilter);
    
    const noiseGain = ctx.createGain();
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    noiseGain.gain.setValueAtTime(0.5, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    osc.start(ctx.currentTime);
    noise.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
    noise.stop(ctx.currentTime + 0.1);
  } catch (e) {}
}

function showFloatingEmoji(pid, emoji) {
  let target = document.getElementById('uno-table');
  let x = '50%';
  let y = '80%';
  
  if (pid !== state.myId) {
    const rp = Array.from(document.querySelectorAll('.uno-remote-player')).find(el => el.dataset.pid === pid);
    if (rp) {
      x = rp.style.left;
      y = rp.style.top;
    }
  }

  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = x;
  el.style.top = y;
  target.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function animateRemotePlay(pId, card) {
  const table = document.getElementById('uno-table');
  const rp = Array.from(document.querySelectorAll('.uno-remote-player')).find(el => el.dataset.pid === pId);
  if (!rp) return;
  
  const dummy = document.createElement('div');
  dummy.className = `uno-card-ui ${card.color}`;
  dummy.style.position = 'absolute';
  dummy.style.left = rp.style.left;
  dummy.style.top = rp.style.top;
  dummy.style.transform = 'translate(-50%, -50%) scale(0.5)';
  dummy.style.zIndex = 100;
  dummy.style.transition = 'all 0.3s ease-out';
  dummy.innerHTML = `<span class="mini tl">${card.val}</span> ${card.val} <span class="mini br">${card.val}</span>`;
  table.appendChild(dummy);
  
  setTimeout(() => {
    dummy.style.left = '50%';
    dummy.style.top = '50%';
    dummy.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 10);
  
  setTimeout(() => dummy.remove(), 300);
}

function showDrawModal(card, index) {
  const modal = document.getElementById('uno-draw-modal');
  const container = document.getElementById('uno-drawn-card-container');
  container.innerHTML = '';
  
  const cDiv = document.createElement('div');
  cDiv.className = `uno-card-ui ${card.color}`;
  cDiv.innerHTML = `<span class="mini tl">${card.val}</span> ${card.val} <span class="mini br">${card.val}</span>`;
  cDiv.style.transform = 'scale(1.5)';
  cDiv.style.margin = '20px';
  container.appendChild(cDiv);
  
  if (state.uno.rules && state.uno.rules.noPass) {
    document.getElementById('uno-keep-btn').style.display = 'none';
  } else {
    document.getElementById('uno-keep-btn').style.display = 'block';
  }
  
  modal.classList.remove('hidden');
  
  document.getElementById('uno-keep-btn').onclick = () => {
    modal.classList.add('hidden');
    if (state.uno.host === state.myId) {
      state.uno.turnIndex = getNextTurn();
      if (state.uno.botTimeout) clearTimeout(state.uno.botTimeout);
      const handsCount = Array.from(state.uno.players.entries()).map(([k, v]) => ({ id: k, count: v.cardCount }));
      broadcast({ type: 'uno-sync', host: state.uno.host, players: Array.from(state.uno.players.entries()), turnOrder: state.uno.turnOrder, turnIndex: state.uno.turnIndex, direction: state.uno.direction, discard: state.uno.discard, currentColor: state.uno.currentColor, handsCount });
      renderUnoGame();
    } else {
      broadcast({ type: 'uno-keep' });
    }
  };
  
  document.getElementById('uno-play-drawn-btn').onclick = () => {
    modal.classList.add('hidden');
    if (card.color === 'black') {
      document.getElementById('uno-color-picker').classList.remove('hidden');
      document.querySelectorAll('.ucc').forEach(btn => {
        btn.onclick = () => {
          const selectedColor = btn.dataset.color;
          document.getElementById('uno-color-picker').classList.add('hidden');
          playCard(index, selectedColor);
        };
      });
    } else {
      playCard(index);
    }
  };
}

function endUnoGame() {
  if (state.uno.host !== state.myId) return;
  state.uno.started = false;

  const rankings = [];
  Array.from(state.uno.players.entries()).forEach(([id, p]) => {
    let count = p.cardCount;
    if (id === state.myId) count = state.uno.myHand.length;
    else if (id.startsWith('bot-')) count = state.uno.botHands[id]?.length || 0;
    rankings.push({ id, name: p.name, count });
  });

  rankings.sort((a, b) => a.count - b.count);
  broadcast({ type: 'uno-game-over', rankings });
  showUnoGameOver(rankings);
}

function showUnoGameOver(rankings) {
  state.uno.started = false;
  document.getElementById('uno-game').classList.add('hidden');
  document.getElementById('uno-game-over').classList.remove('hidden');
  
  const container = document.getElementById('uno-rankings');
  container.innerHTML = '';
  rankings.forEach((r, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '👏';
    container.innerHTML += `
      <div style="background: rgba(0,0,0,0.6); padding: 10px 20px; border-radius: 8px; display: flex; justify-content: space-between; font-size: 18px; border: 1px solid rgba(255,255,255,0.2);">
        <span>${medal} ${escapeHtml(r.name)}</span>
        <span>${r.count} Kart</span>
      </div>
    `;
  });

  if (state.uno.host === state.myId) {
    document.getElementById('uno-replay-btn').classList.remove('hidden');
    document.getElementById('uno-replay-wait').classList.add('hidden');
  } else {
    document.getElementById('uno-replay-btn').classList.add('hidden');
    document.getElementById('uno-replay-wait').classList.remove('hidden');
  }
}

function updateUnoRulesUI() {
  const container = document.getElementById('uno-active-rules');
  if (!container) return;
  container.innerHTML = '';
  const r = state.uno.rules;
  if (!r) return;
  
  let hasRule = false;
  
  if (r.kombo) { container.innerHTML += '<div>🔥 Kombo</div>'; hasRule = true; }
  if (r.stacking) { container.innerHTML += '<div>➕ Yığılma</div>'; hasRule = true; }
  if (r.jumpIn) { container.innerHTML += '<div>⚡ Araya Girme</div>'; hasRule = true; }
  if (r.drawUntilPlay) { container.innerHTML += '<div>📥 Zorunlu Çekme</div>'; hasRule = true; }
  if (r.noBluff) { container.innerHTML += '<div>🎯 Serbest Atış</div>'; hasRule = true; }
  if (r.noPass) { container.innerHTML += '<div>🚫 Pas Yok</div>'; hasRule = true; }
  if (r.noBlackLast) { container.innerHTML += '<div>⬛ Zorlu Son Kart</div>'; hasRule = true; }
  if (r.mirror) { container.innerHTML += '<div>🪞 Ayna Kuralı</div>'; hasRule = true; }
  if (r.zeroPass) { container.innerHTML += '<div>🌀 0 Karmaşası</div>'; hasRule = true; }
  if (r.sevenSwap) { container.innerHTML += '<div>🔀 7 Takası</div>'; hasRule = true; }
  
  if (!hasRule) {
    container.innerHTML = '<div style="font-style: italic; color: #aaa;">Kural Yok</div>';
  }
}

