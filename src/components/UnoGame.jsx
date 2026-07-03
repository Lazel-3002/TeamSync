import React, { useState, useEffect, useRef } from 'react';

const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', '+2'];
const WILD_VALUES = ['Wild', '+4'];

function generateDeck(chaosMode = false, numDecks = 1) {
  let deck = [];
  for (let d = 0; d < numDecks; d++) {
    for (const color of COLORS) {
      deck.push({ color, value: '0', id: Math.random().toString(36).substr(2, 9) });
      for (let i = 1; i <= 9; i++) {
        deck.push({ color, value: i.toString(), id: Math.random().toString(36).substr(2, 9) });
        deck.push({ color, value: i.toString(), id: Math.random().toString(36).substr(2, 9) });
      }
      for (const val of ['Skip', 'Reverse', '+2']) {
        deck.push({ color, value: val, id: Math.random().toString(36).substr(2, 9) });
        deck.push({ color, value: val, id: Math.random().toString(36).substr(2, 9) });
      }
    }
    for (let i = 0; i < 4; i++) {
      deck.push({ color: 'black', value: 'Wild', id: Math.random().toString(36).substr(2, 9) });
      deck.push({ color: 'black', value: '+4', id: Math.random().toString(36).substr(2, 9) });
    }
    if (chaosMode) {
      for (let i = 0; i < 2; i++) {
        deck.push({ color: 'black', value: 'BOMBA', id: Math.random().toString(36).substr(2, 9) });
      }
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

export default function UnoGame({ myId, targetId, isHost, connectedPeers, currentAccount }) {
  const [phase, setPhase] = useState('lobby'); 
  const [readyStatus, setReadyStatus] = useState({ [myId]: false });
  const [gameState, setGameState] = useState(null);

  // Settings
  const [settings, setSettings] = useState({
    startCards: 7,
    maxPlayers: 4,
    fillBots: true, // Auto-fill by default
    chaosMode: false
  });

  const basePlayers = [
    { id: myId, name: currentAccount?.name || 'Sen', isSelf: true },
    ...(connectedPeers || []).map(p => ({ id: p.id, name: p.name, isSelf: false }))
  ];

  const allReady = basePlayers.every(p => readyStatus[p.id]);

  useEffect(() => {
    const handleGameEvent = (e) => {
      const { action, payload, from } = e.detail;
      if (action === 'ready') {
        setReadyStatus(prev => ({ ...prev, [from]: payload.isReady }));
      }
      if (action === 'update-settings') {
        setSettings(payload.settings);
      }
      if (action === 'start') {
        setGameState(payload.state);
        setPhase('playing');
      }
      if (action === 'update-state') {
        setGameState(payload.state);
      }
    };
    window.addEventListener('webrtc-game', handleGameEvent);
    return () => window.removeEventListener('webrtc-game', handleGameEvent);
  }, []);

  const sendGameEvent = (action, payload) => {
    window.dispatchEvent(new CustomEvent('send-webrtc-game', {
      detail: { action, payload, from: myId }
    }));
  };

  const toggleReady = () => {
    const newReady = !readyStatus[myId];
    setReadyStatus(prev => ({ ...prev, [myId]: newReady }));
    sendGameEvent('ready', { isReady: newReady });
  };

  const updateSetting = (key, val) => {
    if (!isHost) return;
    const newSettings = { ...settings, [key]: val };
    setSettings(newSettings);
    sendGameEvent('update-settings', { settings: newSettings });
  };

  const startGame = () => {
    if (!isHost) return;
    let actualPlayers = [...basePlayers];
    if (settings.fillBots && actualPlayers.length < settings.maxPlayers) {
      const needed = settings.maxPlayers - actualPlayers.length;
      for (let i = 0; i < needed; i++) {
        actualPlayers.push({ id: `bot-${i}`, name: `Bot ${i+1}`, isSelf: false, isBot: true });
      }
    }

    // Generate enough decks to support all players and cards
    const totalCardsNeeded = actualPlayers.length * settings.startCards + 50; 
    const numDecks = Math.ceil(totalCardsNeeded / 108) || 1;
    let deck = generateDeck(settings.chaosMode, numDecks);
    
    const hands = {};
    actualPlayers.forEach(p => {
      hands[p.id] = deck.splice(0, settings.startCards);
    });
    
    let firstCard = deck.find(c => c.color !== 'black');
    if (!firstCard) firstCard = deck[0]; 
    deck = deck.filter(c => c.id !== firstCard.id);

    const initialState = {
      deck,
      discardPile: [firstCard],
      hands,
      turnIndex: 0,
      direction: 1,
      currentColor: firstCard.color !== 'black' ? firstCard.color : 'red',
      players: actualPlayers.map(p => p.id),
      playerData: actualPlayers,
      pendingDraw: 0,
      chaosMode: settings.chaosMode
    };

    setGameState(initialState);
    setPhase('playing');
    sendGameEvent('start', { state: initialState });
  };

  // BOT AI LOGIC (Only runs on Host)
  useEffect(() => {
    if (phase === 'playing' && isHost && gameState) {
      const currentPlayerId = gameState.players[gameState.turnIndex];
      const isBot = currentPlayerId.startsWith('bot-');
      
      if (isBot) {
        const timer = setTimeout(() => {
          playBotTurn(currentPlayerId);
        }, 1500); // 1.5s delay for bot thinking
        return () => clearTimeout(timer);
      }
    }
  }, [gameState, phase]);

  const playBotTurn = (botId) => {
    try {
      const hand = gameState.hands[botId];
      if (!hand) return drawCardLogic(botId);
      
      const topCard = gameState.discardPile[gameState.discardPile.length - 1];
      
      // Find valid cards
      let validCards = hand.filter(c => 
        c.color === 'black' || 
        c.color === gameState.currentColor || 
        c.value === topCard.value
      );

      // Apply pending draw restrictions for the bot
      if (gameState.pendingDraw > 0 && gameState.chaosMode) {
        validCards = validCards.filter(c => c.value === '+2' || c.value === '+4' || c.value === 'BOMBA');
      } else if (gameState.pendingDraw > 0) {
        validCards = []; // Must draw
      }

      if (validCards.length > 0) {
        // Pick a random valid card
        const cardToPlay = validCards[Math.floor(Math.random() * validCards.length)];
        if (cardToPlay.color === 'black') {
          // Random color for wild
          const newColor = COLORS[Math.floor(Math.random() * COLORS.length)];
          applyCardLogic(cardToPlay, botId, newColor);
        } else {
          applyCardLogic(cardToPlay, botId, cardToPlay.color);
        }
      } else {
        // Must draw
        drawCardLogic(botId);
      }
    } catch (err) {
      console.error("Bot Turn Error:", err);
      // Fallback: draw card to avoid freezing
      drawCardLogic(botId);
    }
  };

  const applyCardLogic = (card, playerId, chosenColor) => {
    const newState = JSON.parse(JSON.stringify(gameState));
    const isChaos = newState.chaosMode;
    
    newState.hands[playerId] = newState.hands[playerId].filter(c => c.id !== card.id);
    newState.discardPile.push(card);
    newState.currentColor = chosenColor;

    // Advanced Mechanics Processing
    if (isChaos) {
      if (card.value === 'BOMBA') {
        newState.pendingDraw += 5;
      }
      if (card.color === 'black') {
        // Chaos Color: Random color instead of chosen
        newState.currentColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      }
      if (card.value === '0') {
        // Pass hands (Shift all hands in direction of play)
        const newHands = {};
        for (let i = 0; i < newState.players.length; i++) {
          const giver = newState.players[i];
          let receiverIdx = (i + newState.direction) % newState.players.length;
          if (receiverIdx < 0) receiverIdx += newState.players.length;
          newHands[newState.players[receiverIdx]] = gameState.hands[giver];
        }
        newState.hands = newHands;
      }
      if (card.value === '7') {
        // Swap with next person
        let nextIdx = (newState.turnIndex + newState.direction) % newState.players.length;
        if (nextIdx < 0) nextIdx += newState.players.length;
        const nextId = newState.players[nextIdx];
        const temp = newState.hands[playerId];
        newState.hands[playerId] = newState.hands[nextId];
        newState.hands[nextId] = temp;
      }
    }

    // Normal Rules
    if (card.value === 'Reverse') newState.direction *= -1;
    if (card.value === 'Skip') newState.turnIndex += newState.direction;
    if (card.value === '+2') newState.pendingDraw += 2;
    if (card.value === '+4') newState.pendingDraw += 4;

    // Check Win
    if (newState.hands[playerId].length === 0) {
      alert(`${newState.playerData.find(p=>p.id === playerId)?.name} KAZANDI!`);
      setPhase('gameover');
      setGameState(newState);
      sendGameEvent('update-state', { state: newState });
      return;
    }

    // Next turn
    let nextTurn = (newState.turnIndex + newState.direction) % newState.players.length;
    if (nextTurn < 0) nextTurn += newState.players.length;
    newState.turnIndex = nextTurn;

    setGameState(newState);
    sendGameEvent('update-state', { state: newState });
  };

  const drawCardLogic = (playerId) => {
    const newState = JSON.parse(JSON.stringify(gameState));
    
    let drawCount = newState.pendingDraw > 0 ? newState.pendingDraw : 1;
    newState.pendingDraw = 0;

    for (let i = 0; i < drawCount; i++) {
      if (newState.deck.length === 0) break; // In real game we reshuffle discard, ignoring for simplicity
      const drawnCard = newState.deck.pop();
      newState.hands[playerId].push(drawnCard);
    }

    let nextTurn = (newState.turnIndex + newState.direction) % newState.players.length;
    if (nextTurn < 0) nextTurn += newState.players.length;
    newState.turnIndex = nextTurn;

    setGameState(newState);
    sendGameEvent('update-state', { state: newState });
  };

  // User Actions
  const playUserCard = (card) => {
    if (gameState.players[gameState.turnIndex] !== myId) return; 
    
    // Stacking check logic: If pendingDraw > 0, you can ONLY play a +2 or +4 or Bomb
    if (gameState.pendingDraw > 0 && gameState.chaosMode) {
       if (card.value !== '+2' && card.value !== '+4' && card.value !== 'BOMBA') {
           alert("Ceza birikti! Sadece +2, +4 veya BOMBA atabilirsin ya da kart çekmelisin.");
           return;
       }
    } else if (gameState.pendingDraw > 0 && !gameState.chaosMode) {
       // Normal rules: must draw
       alert("Ceza çekmelisin!");
       return;
    }

    let chosenColor = card.color;
    if (card.color === 'black') {
      const c = prompt("Renk seçin (red, blue, green, yellow):", "red");
      if (COLORS.includes(c)) chosenColor = c;
      else chosenColor = 'red';
    }

    applyCardLogic(card, myId, chosenColor);
  };

  const getCardColor = (color) => {
    if (gameState?.chaosMode && color !== 'black') return '#64748b'; // Kör Oyun: Renkler gri görünür
    switch(color) {
      case 'red': return '#ef4444';
      case 'blue': return '#3b82f6';
      case 'green': return '#10b981';
      case 'yellow': return '#f59e0b';
      case 'black': return '#1e293b';
      default: return '#1e293b';
    }
  };

  if (phase === 'lobby') {
    return (
      <div style={{ width: '100%', height: '100%', background: '#1e293b', borderRadius: '12px', padding: '30px', display: 'flex', gap: '30px', color: 'white' }}>
        
        {/* LOBBY PLAYERS */}
        <div style={{ flex: 1, background: '#0f172a', padding: '20px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
          <h1 style={{ color: '#ef4444', margin: '0 0 20px 0', textShadow: '2px 2px 0px #000' }}>UNO LOBİSİ</h1>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', flex: 1 }}>
            {basePlayers.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px 15px', borderRadius: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>{p.name} {p.isSelf && '(Sen)'} {isHost && p.id === myId && '👑'}</span>
                <span style={{ background: readyStatus[p.id] ? '#10b981' : '#64748b', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                  {readyStatus[p.id] ? 'HAZIR' : 'BEKLİYOR'}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '15px', marginTop: '20px' }}>
            <button onClick={toggleReady} style={{ flex: 1, padding: '15px', background: readyStatus[myId] ? '#ef4444' : '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}>
              {readyStatus[myId] ? 'Hazır İptal' : 'Hazır Ol!'}
            </button>
            
            {isHost && (
              <button 
                onClick={startGame} 
                disabled={!allReady}
                style={{ flex: 1, padding: '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: !allReady ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: 'bold', opacity: !allReady ? 0.5 : 1 }}
              >
                Oyunu Başlat
              </button>
            )}
          </div>
        </div>

        {/* HOST SETTINGS */}
        <div style={{ width: '300px', background: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: '12px', opacity: isHost ? 1 : 0.6, pointerEvents: isHost ? 'auto' : 'none' }}>
          <h3 style={{ margin: '0 0 20px 0', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>⚙️ Oyun Ayarları</h3>
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', color: '#94a3b8' }}>Maksimum Oyuncu (1-8)</label>
            <input type="number" min="1" max="8" value={settings.maxPlayers} onChange={e => updateSetting('maxPlayers', Number(e.target.value))} style={{ width: '100%', padding: '8px', background: '#1e293b', border: '1px solid #475569', color: 'white', borderRadius: '4px' }} />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', color: '#94a3b8' }}>Başlangıç Kart Sayısı (5-20)</label>
            <input type="number" min="5" max="20" value={settings.startCards} onChange={e => updateSetting('startCards', Number(e.target.value))} style={{ width: '100%', padding: '8px', background: '#1e293b', border: '1px solid #475569', color: 'white', borderRadius: '4px' }} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px', cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.fillBots} onChange={e => updateSetting('fillBots', e.target.checked)} style={{ width: '18px', height: '18px' }} />
            <span>🤖 Boşlukları Botlarla Doldur</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '30px', cursor: 'pointer', background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <input type="checkbox" checked={settings.chaosMode} onChange={e => updateSetting('chaosMode', e.target.checked)} style={{ width: '20px', height: '20px' }} />
            <span style={{ color: '#ef4444', fontWeight: 'bold' }}>🔥 KAOS MODU (Etkenler)</span>
          </label>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '10px', lineHeight: '1.5' }}>
            Sıfırın Gücü, Kör Oyun, 7 Takası, Artı Biriktirme, Rastgele Renk ve Bomba kurallarını aktifleştirir!
          </div>

          {!isHost && <div style={{ color: '#f59e0b', fontSize: '12px', marginTop: '20px', textAlign: 'center' }}>Sadece kurucu ayarları değiştirebilir.</div>}
        </div>

      </div>
    );
  }

  // --- PLAYING PHASE ---
  if (!gameState) return null;

  const myHand = gameState.hands[myId] || [];
  const topCard = gameState.discardPile[gameState.discardPile.length - 1];
  const isMyTurn = gameState.players[gameState.turnIndex] === myId;
  const realColor = topCard.color !== 'black' ? topCard.color : gameState.currentColor;

  return (
    <div style={{ width: '100%', height: '100%', background: '#0f172a', borderRadius: '12px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      
      {/* KAOS BANNER */}
      {gameState.chaosMode && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: '#ef4444', color: 'white', textAlign: 'center', padding: '4px', fontSize: '12px', fontWeight: 'bold', zIndex: 10 }}>
          🔥 KAOS MODU AKTİF 🔥 (Kör Oyun, Takas, Bomba)
        </div>
      )}

      {/* OTHERS */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 20px 20px', gap: '20px', background: 'rgba(0,0,0,0.2)', flexWrap: 'wrap' }}>
        {gameState.playerData.filter(p => p.id !== myId).map(p => (
          <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: gameState.players[gameState.turnIndex] === p.id ? 1 : 0.5, transform: gameState.players[gameState.turnIndex] === p.id ? 'scale(1.1)' : 'scale(1)', transition: 'all 0.3s' }}>
            <div style={{ width: '40px', height: '60px', background: '#fff', borderRadius: '4px', border: '2px solid #ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
              UNO
            </div>
            <span style={{ color: gameState.players[gameState.turnIndex] === p.id ? '#10b981' : 'white', marginTop: '5px', fontSize: '12px', fontWeight: 'bold', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: '4px' }}>
              {p.name} ({gameState.hands[p.id]?.length || 0})
            </span>
          </div>
        ))}
      </div>

      {/* CENTER */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px' }}>
        
        {/* Desteden Çek */}
        <div style={{ position: 'relative' }}>
          {gameState.pendingDraw > 0 && (
            <div style={{ position: 'absolute', top: '-20px', left: '50%', transform: 'translateX(-50%)', background: '#ef4444', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold' }}>
              +{gameState.pendingDraw} Kart!
            </div>
          )}
          <div 
            onClick={isMyTurn ? () => drawCardLogic(myId) : undefined}
            style={{ width: '100px', height: '150px', background: '#1e293b', border: '4px solid white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isMyTurn ? 'pointer' : 'default', opacity: isMyTurn ? 1 : 0.5, boxShadow: isMyTurn ? '0 0 20px rgba(255,255,255,0.2)' : 'none', transition: 'all 0.2s' }}
            onMouseOver={e => isMyTurn && (e.currentTarget.style.transform = 'translateY(-5px)')}
            onMouseOut={e => isMyTurn && (e.currentTarget.style.transform = 'none')}
          >
            <span style={{ color: 'white', fontWeight: 'bold', fontSize: '24px', transform: 'rotate(-45deg)' }}>UNO</span>
          </div>
        </div>

        {/* Yön İkonu */}
        <div style={{ color: '#64748b', fontSize: '32px', transform: `scaleX(${gameState.direction})` }}>
          ↻
        </div>

        {/* Ortadaki Kart */}
        <div style={{ width: '100px', height: '150px', background: '#fff', border: `8px solid ${getCardColor(realColor)}`, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 10px 35px ${getCardColor(realColor)}40` }}>
          <span style={{ color: getCardColor(realColor), fontSize: topCard.value === 'BOMBA' ? '18px' : '48px', fontWeight: '900', textShadow: '1px 1px 0px rgba(0,0,0,0.2)' }}>
            {topCard.value}
          </span>
        </div>
      </div>

      {/* MY HAND */}
      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', background: isMyTurn ? 'rgba(16, 185, 129, 0.1)' : 'rgba(0,0,0,0.4)', borderTop: isMyTurn ? '3px solid #10b981' : '3px solid transparent', transition: 'all 0.3s' }}>
        <h3 style={{ margin: '0 0 10px 0', color: isMyTurn ? '#10b981' : 'white', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isMyTurn ? 'Sıra Sende!' : 'Sıranı Bekle...'}
        </h3>
        <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', maxWidth: '100%', paddingBottom: '10px', padding: '10px' }}>
          {myHand.map(card => {
            let canPlay = isMyTurn;
            if (gameState.pendingDraw > 0 && gameState.chaosMode) {
              canPlay = canPlay && (card.value === '+2' || card.value === '+4' || card.value === 'BOMBA');
            } else if (gameState.pendingDraw > 0) {
              canPlay = false; // Must draw
            } else {
              canPlay = canPlay && (card.color === 'black' || card.color === realColor || card.value === topCard.value);
            }

            return (
              <div 
                key={card.id}
                onClick={() => canPlay && playUserCard(card)}
                style={{ 
                  flexShrink: 0, width: '70px', height: '105px', background: '#fff', 
                  border: `6px solid ${getCardColor(card.color)}`, borderRadius: '8px', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', 
                  cursor: canPlay ? 'pointer' : 'not-allowed',
                  opacity: canPlay ? 1 : 0.6,
                  transform: canPlay ? 'translateY(-10px)' : 'none',
                  transition: 'all 0.2s',
                  boxShadow: canPlay ? '0 10px 15px rgba(0,0,0,0.3)' : 'none'
                }}
                onMouseOver={e => canPlay && (e.currentTarget.style.transform = 'translateY(-15px) scale(1.05)')}
                onMouseOut={e => canPlay && (e.currentTarget.style.transform = 'translateY(-10px)')}
              >
                <span style={{ color: getCardColor(card.color), fontSize: card.value === 'BOMBA' ? '14px' : '28px', fontWeight: '900', textShadow: '1px 1px 0 rgba(0,0,0,0.1)' }}>
                  {card.value}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
