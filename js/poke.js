function initPoke() {
  window.pokeBotMemory = window.pokeBotMemory || [];
  
  const broadcastPokeMsg = (msg) => {
    broadcast(msg);
    if (window.pokeActivityHandler) window.pokeActivityHandler(msg);
  };

  // State
  window.pokeState = {
    p1: null, // { id, name, type, pokemon, ready }
    p2: null,
    spectators: [],
    round: 0,
    status: 'waiting', // waiting, selecting, revealed, round_end
  };

  // Pokemon dictionaries by type (gifs or high quality images)
  const POKEMONS = {
  normal: ['https://play.pokemonshowdown.com/sprites/ani/snorlax.gif', 'https://play.pokemonshowdown.com/sprites/ani/eevee.gif', 'https://play.pokemonshowdown.com/sprites/ani/porygon-z.gif'],
  fire: ['https://play.pokemonshowdown.com/sprites/ani/charizard.gif', 'https://play.pokemonshowdown.com/sprites/ani/blaziken.gif', 'https://play.pokemonshowdown.com/sprites/ani/infernape.gif'],
  water: ['https://play.pokemonshowdown.com/sprites/ani/blastoise.gif', 'https://play.pokemonshowdown.com/sprites/ani/greninja.gif', 'https://play.pokemonshowdown.com/sprites/ani/gyarados.gif'],
  grass: ['https://play.pokemonshowdown.com/sprites/ani/venusaur.gif', 'https://play.pokemonshowdown.com/sprites/ani/sceptile.gif', 'https://play.pokemonshowdown.com/sprites/ani/decidueye.gif'],
  electric: ['https://play.pokemonshowdown.com/sprites/ani/pikachu.gif', 'https://play.pokemonshowdown.com/sprites/ani/raichu.gif', 'https://play.pokemonshowdown.com/sprites/ani/electivire.gif'],
  ice: ['https://play.pokemonshowdown.com/sprites/ani/articuno.gif', 'https://play.pokemonshowdown.com/sprites/ani/lapras.gif', 'https://play.pokemonshowdown.com/sprites/ani/weavile.gif'],
  fighting: ['https://play.pokemonshowdown.com/sprites/ani/machamp.gif', 'https://play.pokemonshowdown.com/sprites/ani/lucario.gif', 'https://play.pokemonshowdown.com/sprites/ani/hawlucha.gif'],
  poison: ['https://play.pokemonshowdown.com/sprites/ani/gengar.gif', 'https://play.pokemonshowdown.com/sprites/ani/crobat.gif', 'https://play.pokemonshowdown.com/sprites/ani/toxtricity.gif'],
  ground: ['https://play.pokemonshowdown.com/sprites/ani/garchomp.gif', 'https://play.pokemonshowdown.com/sprites/ani/excadrill.gif', 'https://play.pokemonshowdown.com/sprites/ani/krookodile.gif'],
  flying: ['https://play.pokemonshowdown.com/sprites/ani/pidgeot.gif', 'https://play.pokemonshowdown.com/sprites/ani/corviknight.gif', 'https://play.pokemonshowdown.com/sprites/ani/talonflame.gif'],
  psychic: ['https://play.pokemonshowdown.com/sprites/ani/mewtwo.gif', 'https://play.pokemonshowdown.com/sprites/ani/alakazam.gif', 'https://play.pokemonshowdown.com/sprites/ani/gardevoir.gif'],
  bug: ['https://play.pokemonshowdown.com/sprites/ani/scizor.gif', 'https://play.pokemonshowdown.com/sprites/ani/volcarona.gif', 'https://play.pokemonshowdown.com/sprites/ani/heracross.gif'],
  rock: ['https://play.pokemonshowdown.com/sprites/ani/tyranitar.gif', 'https://play.pokemonshowdown.com/sprites/ani/aerodactyl.gif', 'https://play.pokemonshowdown.com/sprites/ani/golem.gif'],
  ghost: ['https://play.pokemonshowdown.com/sprites/ani/gengar.gif', 'https://play.pokemonshowdown.com/sprites/ani/chandelure.gif', 'https://play.pokemonshowdown.com/sprites/ani/mimikyu.gif'],
  dragon: ['https://play.pokemonshowdown.com/sprites/ani/dragonite.gif', 'https://play.pokemonshowdown.com/sprites/ani/salamence.gif', 'https://play.pokemonshowdown.com/sprites/ani/rayquaza.gif'],
  dark: ['https://play.pokemonshowdown.com/sprites/ani/umbreon.gif', 'https://play.pokemonshowdown.com/sprites/ani/darkrai.gif', 'https://play.pokemonshowdown.com/sprites/ani/hydreigon.gif'],
  steel: ['https://play.pokemonshowdown.com/sprites/ani/metagross.gif', 'https://play.pokemonshowdown.com/sprites/ani/lucario.gif', 'https://play.pokemonshowdown.com/sprites/ani/aegislash.gif'],
  fairy: ['https://play.pokemonshowdown.com/sprites/ani/sylveon.gif', 'https://play.pokemonshowdown.com/sprites/ani/togekiss.gif', 'https://play.pokemonshowdown.com/sprites/ani/mimikyu.gif']
};

  const TYPE_NAMES = { normal: 'NORMAL', fire: 'ATEŞ', water: 'SU', electric: 'ELEKTRİK', grass: 'ÇİMEN', ice: 'BUZ', fighting: 'DÖVÜŞ', poison: 'ZEHİR', ground: 'TOPRAK', flying: 'UÇAN', psychic: 'PSİŞİK', bug: 'BÖCEK', rock: 'KAYA', ghost: 'HAYALET', dragon: 'EJDERHA', dark: 'KARANLIK', steel: 'ÇELİK', fairy: 'PERİ' };
  const TYPE_COLORS = { normal: '#9ca3af', fire: '#ef4444', water: '#3b82f6', electric: '#eab308', grass: '#22c55e', ice: '#38bdf8', fighting: '#f97316', poison: '#a855f7', ground: '#d97706', flying: '#818cf8', psychic: '#f43f5e', bug: '#84cc16', rock: '#78716c', ghost: '#6366f1', dragon: '#3b82f6', dark: '#1e293b', steel: '#94a3b8', fairy: '#ec4899' };
  const UNKNOWN_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23333'/%3E%3Ctext x='50' y='65' font-size='40' text-anchor='middle' fill='%23fff'%3E?%3C/text%3E%3C/svg%3E";

  const typeChart = {
  normal: { normal: 1, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 1, rock: 0.5, ghost: 0, dragon: 1, dark: 1, steel: 0.5, fairy: 1 },
  fire: { normal: 1, fire: 0.5, water: 0.5, electric: 1, grass: 2, ice: 2, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 2, rock: 0.5, ghost: 1, dragon: 0.5, dark: 1, steel: 2, fairy: 1 },
  water: { normal: 1, fire: 2, water: 0.5, electric: 1, grass: 0.5, ice: 1, fighting: 1, poison: 1, ground: 2, flying: 1, psychic: 1, bug: 1, rock: 2, ghost: 1, dragon: 0.5, dark: 1, steel: 1, fairy: 1 },
  electric: { normal: 1, fire: 1, water: 2, electric: 0.5, grass: 0.5, ice: 1, fighting: 1, poison: 1, ground: 0, flying: 2, psychic: 1, bug: 1, rock: 1, ghost: 1, dragon: 0.5, dark: 1, steel: 1, fairy: 1 },
  grass: { normal: 1, fire: 0.5, water: 2, electric: 1, grass: 0.5, ice: 1, fighting: 1, poison: 0.5, ground: 2, flying: 0.5, psychic: 1, bug: 0.5, rock: 2, ghost: 1, dragon: 0.5, dark: 1, steel: 0.5, fairy: 1 },
  ice: { normal: 1, fire: 0.5, water: 0.5, electric: 1, grass: 2, ice: 0.5, fighting: 1, poison: 1, ground: 2, flying: 2, psychic: 1, bug: 1, rock: 1, ghost: 1, dragon: 2, dark: 1, steel: 0.5, fairy: 1 },
  fighting: { normal: 2, fire: 1, water: 1, electric: 1, grass: 1, ice: 2, fighting: 1, poison: 0.5, ground: 1, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dragon: 1, dark: 2, steel: 2, fairy: 0.5 },
  poison: { normal: 1, fire: 1, water: 1, electric: 1, grass: 2, ice: 1, fighting: 1, poison: 0.5, ground: 0.5, flying: 1, psychic: 1, bug: 1, rock: 0.5, ghost: 0.5, dragon: 1, dark: 1, steel: 0, fairy: 2 },
  ground: { normal: 1, fire: 2, water: 1, electric: 2, grass: 0.5, ice: 1, fighting: 1, poison: 2, ground: 1, flying: 0, psychic: 1, bug: 0.5, rock: 2, ghost: 1, dragon: 1, dark: 1, steel: 2, fairy: 1 },
  flying: { normal: 1, fire: 1, water: 1, electric: 0.5, grass: 2, ice: 1, fighting: 2, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 2, rock: 0.5, ghost: 1, dragon: 1, dark: 1, steel: 0.5, fairy: 1 },
  psychic: { normal: 1, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 2, poison: 2, ground: 1, flying: 1, psychic: 0.5, bug: 1, rock: 1, ghost: 1, dragon: 1, dark: 0, steel: 0.5, fairy: 1 },
  bug: { normal: 1, fire: 0.5, water: 1, electric: 1, grass: 2, ice: 1, fighting: 0.5, poison: 0.5, ground: 1, flying: 0.5, psychic: 2, bug: 1, rock: 1, ghost: 0.5, dragon: 1, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { normal: 1, fire: 2, water: 1, electric: 1, grass: 1, ice: 2, fighting: 0.5, poison: 1, ground: 0.5, flying: 2, psychic: 1, bug: 2, rock: 1, ghost: 1, dragon: 1, dark: 1, steel: 0.5, fairy: 1 },
  ghost: { normal: 0, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 2, bug: 1, rock: 1, ghost: 2, dragon: 1, dark: 0.5, steel: 1, fairy: 1 },
  dragon: { normal: 1, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 1, rock: 1, ghost: 1, dragon: 2, dark: 1, steel: 0.5, fairy: 0 },
  dark: { normal: 1, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 0.5, poison: 1, ground: 1, flying: 1, psychic: 2, bug: 1, rock: 1, ghost: 2, dragon: 1, dark: 0.5, steel: 1, fairy: 0.5 },
  steel: { normal: 1, fire: 0.5, water: 0.5, electric: 0.5, grass: 1, ice: 2, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 1, rock: 2, ghost: 1, dragon: 1, dark: 1, steel: 0.5, fairy: 2 },
  fairy: { normal: 1, fire: 0.5, water: 1, electric: 1, grass: 1, ice: 1, fighting: 2, poison: 0.5, ground: 1, flying: 1, psychic: 1, bug: 1, rock: 1, ghost: 1, dragon: 2, dark: 2, steel: 0.5, fairy: 1 }
};

  const setActivity = (act) => {
    closeAllCards();
    document.getElementById('activities-modal').classList.add('hidden');
    broadcast({ type: 'activity_change', activity: act });
    if (act === 'poke') document.getElementById('poke-card').classList.remove('hidden');
  };

  document.getElementById('act-poke')?.addEventListener('click', () => setActivity('poke'));

  document.getElementById('poke-close')?.addEventListener('click', () => {
    closeAllCards(true);
    broadcast({ type: 'activity_change', activity: 'none' });
    window.pokeState = { p1: null, p2: null, spectators: [], round: 0, status: 'waiting' };
    renderPokeLobby();
  });

  const renderPokeLobby = () => {
    if (pokeState.status === 'waiting') {
      document.getElementById('poke-lobby-view').classList.remove('hidden');
      document.getElementById('poke-battle-view').classList.add('hidden');
      
      // P1
      if (pokeState.p1) {
        document.getElementById('poke-wait-1').style.display = 'none';
        document.getElementById('poke-avatar-1').style.display = 'block';
        document.getElementById('poke-avatar-1').src = pokeState.p1.avatar || UNKNOWN_AVATAR;
        document.getElementById('poke-name-1').textContent = pokeState.p1.name;
        document.getElementById('poke-join-1').classList.add('hidden');
      } else {
        document.getElementById('poke-wait-1').style.display = 'block';
        document.getElementById('poke-avatar-1').style.display = 'none';
        document.getElementById('poke-name-1').textContent = "Oyuncu 1 Bekleniyor...";
        document.getElementById('poke-join-1').classList.remove('hidden');
      }

      // P2
      if (pokeState.p2) {
        document.getElementById('poke-wait-2').style.display = 'none';
        document.getElementById('poke-avatar-2').style.display = 'block';
        document.getElementById('poke-avatar-2').src = pokeState.p2.avatar || UNKNOWN_AVATAR;
        document.getElementById('poke-name-2').textContent = pokeState.p2.name;
        document.getElementById('poke-join-2').classList.add('hidden');
      } else {
        document.getElementById('poke-wait-2').style.display = 'block';
        document.getElementById('poke-avatar-2').style.display = 'none';
        document.getElementById('poke-name-2').textContent = "Oyuncu 2 Bekleniyor...";
        document.getElementById('poke-join-2').classList.remove('hidden');
      }

      const isHost = (state.activeLobbyId && state.isLobbyHost) || true; // Fallback
      if (pokeState.p1 && pokeState.p2 && isHost) {
        document.getElementById('poke-start-btn').classList.remove('hidden');
      } else {
        document.getElementById('poke-start-btn').classList.add('hidden');
      }
    } else {
      document.getElementById('poke-lobby-view').classList.add('hidden');
      document.getElementById('poke-battle-view').classList.remove('hidden');
      renderBattleArena();
    }
  };

  const TYPE_EMOJIS = {
  normal: '💫', fire: '☄️', water: '🌊', electric: '🌩️', grass: '🍃',
  ice: '🧊', fighting: '👊', poison: '🦠', ground: '🪨', flying: '🌪️',
  psychic: '🔮', bug: '🕸️', rock: '🗿', ghost: '🌫️', dragon: '🐲',
  dark: '🌌', steel: '🛸', fairy: '💖'
};


  const generateGuide = () => {
    const guideContent = document.getElementById('poke-guide-content');
    if (!guideContent) return;
    guideContent.innerHTML = '';
    
    for (const type in typeChart) {
      const strengths = [];
      const weaknesses = [];
      
      for (const target in typeChart[type]) {
        const dmg = typeChart[type][target];
        if (dmg === 2) strengths.push(target);
        if (dmg === 0.5 || dmg === 0) weaknesses.push(target);
      }
      
      const translateName = (t) => TYPE_NAMES[t] || t.toUpperCase();
      const color = TYPE_COLORS[type];
      
      const renderBadges = (types) => types.map(t => `<span style="background: ${TYPE_COLORS[t]}22; color: ${TYPE_COLORS[t]}; border: 1px solid ${TYPE_COLORS[t]}66; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; margin-right: 4px; margin-bottom: 4px; display: inline-block;">${TYPE_EMOJIS[t] || ''} ${translateName(t)}</span>`).join('');
      
      guideContent.innerHTML += `
        <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; border-left: 4px solid ${color}; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
          <h3 style="color: ${color}; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px; text-shadow: 0 0 10px ${color}66;">
            <span style="font-size: 20px;">${TYPE_EMOJIS[type] || ''}</span> ${translateName(type)}
          </h3>
          <div style="margin-bottom: 10px;">
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">⚔️ <b>Hasar Verir (2x)</b></div>
            <div>${strengths.length > 0 ? renderBadges(strengths) : '<span style="color: #64748b; font-size: 12px; font-style: italic;">Kimseye</span>'}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">🛡️ <b>Zayıf Vurur (0.5x)</b></div>
            <div>${weaknesses.length > 0 ? renderBadges(weaknesses) : '<span style="color: #64748b; font-size: 12px; font-style: italic;">Kimseye</span>'}</div>
          </div>
        </div>
      `;
    }
  };

  
  const pVolMute = document.getElementById('poke-vol-mute');
  const pVolSlider = document.getElementById('poke-vol-slider');

  if(pVolMute && pVolSlider) {
    pVolMute.addEventListener('click', () => {
      pokeMuted = !pokeMuted;
      if(pokeMuted) {
        pVolMute.textContent = '🔇';
        pVolSlider.value = 0;
      } else {
        pVolMute.textContent = '🔊';
        pVolSlider.value = pokeVol * 100;
      }
    });

    pVolSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      pokeVol = val / 100;
      if(val === 0) {
        pokeMuted = true;
        pVolMute.textContent = '🔇';
      } else {
        pokeMuted = false;
        pVolMute.textContent = '🔊';
      }
    });
  }


  const guideBtn = document.getElementById('poke-guide-btn');
  const guideModal = document.getElementById('poke-guide-modal');
  const guideClose = document.getElementById('poke-guide-close');

  if(guideBtn) {
    guideBtn.addEventListener('click', () => {
      generateGuide();
      guideModal.classList.remove('hidden');
    });
  }
  if(guideClose) {
    guideClose.addEventListener('click', () => {
      guideModal.classList.add('hidden');
    });
  }


  
  const playPokemonCry = (pokemonUrl) => {
    try {
      if (!pokemonUrl) return;
      const parts = pokemonUrl.split('/');
      let name = parts[parts.length - 1].replace('.gif', '').toLowerCase();
      name = name.split('-')[0]; // Strip form suffixes just in case
      const audio = new Audio('https://play.pokemonshowdown.com/audio/cries/' + name + '.mp3');
      audio.volume = pokeMuted ? 0 : pokeVol;
      audio.play().catch(e => console.log('Audio play blocked:', e));
    } catch(e) {}
  };

  const playBattleAnimation = () => {
    const p1Img = document.getElementById('poke-p1-pokemon');
    const p2Img = document.getElementById('poke-p2-pokemon');
    const proj = document.getElementById('poke-projectile');

    p1Img.className = '';
    p2Img.className = '';
    
    setTimeout(() => {
      p1Img.classList.add('anim-lunge-p1');
        playPokemonCry(pokeState.p1.pokemon);
        proj.innerHTML = '<span class="proj-inner type-' + pokeState.p1.type + '">' + (TYPE_EMOJIS[pokeState.p1.type] || '💥') + '</span>';
        proj.className = 'anim-proj-p1';
      proj.style.display = 'block';
      
      setTimeout(() => {
        proj.style.display = 'none';
        p2Img.classList.add('anim-shake'); 
      }, 500);
    }, 1000);

    setTimeout(() => {
      p2Img.classList.add('anim-lunge-p2');
        playPokemonCry(pokeState.p2.pokemon);
        proj.innerHTML = '<span class="proj-inner type-' + pokeState.p2.type + '">' + (TYPE_EMOJIS[pokeState.p2.type] || '💥') + '</span>';
        proj.className = 'anim-proj-p2';
      proj.style.display = 'block';

      setTimeout(() => {
        proj.style.display = 'none';
        p1Img.classList.add('anim-shake-p1');
      }, 500);
    }, 2500);

    setTimeout(() => {
      evaluateWinner();
      document.getElementById('poke-next-round-panel').classList.remove('hidden');
      
      const isP1 = pokeState.p1 && pokeState.p1.id === state.myId;
      const isP2 = pokeState.p2 && pokeState.p2.id === state.myId;
      if (state.isLobbyHost || isP1 || isP2) {
        document.getElementById('poke-next-round-btn').style.display = 'block';
        document.getElementById('poke-spectator-msg').style.display = 'none';
      } else {
        document.getElementById('poke-next-round-btn').style.display = 'none';
        document.getElementById('poke-spectator-msg').style.display = 'block';
      }
      window.pokeAnimPlaying = false;
    }, 4000);
  };

  const renderBattleArena = () => {
    const badge = document.getElementById('poke-vs-badge');
    if (badge) badge.innerHTML = '<span style="font-size: 50px; font-style: italic; font-weight: 900; color: #cbd5e1; text-shadow: 0 4px 10px rgba(0,0,0,0.8);">VS</span>';

    // Top headers
    document.getElementById('poke-p1-header').textContent = pokeState.p1 ? pokeState.p1.name : "Oyuncu 1";
    document.getElementById('poke-p2-header').textContent = pokeState.p2 ? pokeState.p2.name : "Oyuncu 2";

    const isP1 = pokeState.p1 && pokeState.p1.id === state.myId;
    const isP2 = pokeState.p2 && pokeState.p2.id === state.myId;
    const isPlaying = isP1 || isP2;

    const p1Img = document.getElementById('poke-p1-pokemon');
    const p1Status = document.getElementById('poke-p1-status');
    const p2Img = document.getElementById('poke-p2-pokemon');
    const p2Status = document.getElementById('poke-p2-status');
    
    // Status text logic
    if (pokeState.status === 'selecting') {
      p1Img.style.display = 'none';
      p2Img.style.display = 'none';
      
      p1Status.style.display = 'block';
      p1Status.textContent = pokeState.p1.ready ? "HAZIR" : "SEÇİYOR...";
      p1Status.style.color = pokeState.p1.ready ? "#22c55e" : "white";

      p2Status.style.display = 'block';
      p2Status.textContent = pokeState.p2.ready ? "HAZIR" : "SEÇİYOR...";
      p2Status.style.color = pokeState.p2.ready ? "#22c55e" : "white";
      
      const p1n = document.getElementById('poke-p1-pokename');
      const p2n = document.getElementById('poke-p2-pokename');
      if(p1n) p1n.style.display = 'none';
      if(p2n) p2n.style.display = 'none';

      document.getElementById('poke-vs-badge').textContent = "VS";
      document.getElementById('poke-vs-badge').style.color = "#cbd5e1";

      p1Img.className = '';
      p2Img.className = '';
      window.pokeAnimPlaying = false;
      if (isPlaying) {
        const myPlayer = isP1 ? pokeState.p1 : pokeState.p2;
        if (!myPlayer.ready) {
          document.getElementById('poke-selection-panel').style.display = 'flex';
        } else {
          document.getElementById('poke-selection-panel').style.display = 'none';
        }
      } else {
        document.getElementById('poke-selection-panel').style.display = 'none';
      }

      document.getElementById('poke-next-round-panel').classList.add('hidden');
    } 
    else if (pokeState.status === 'revealed') {
      p1Status.style.display = 'none';
      p2Status.style.display = 'none';
      p1Img.style.display = 'block';
      p2Img.style.display = 'block';
      
      const extractName = (url) => {
        if (!url) return "?";
        const parts = url.split('/');
        let n = parts[parts.length - 1].replace('.gif', '').replace('.png', '').split('-')[0];
        return n;
      };
      
      const p1n = document.getElementById('poke-p1-pokename');
      const p2n = document.getElementById('poke-p2-pokename');
      if (p1n) {
        p1n.style.display = 'block';
        p1n.textContent = extractName(pokeState.p1.pokemon);
      }
      if (p2n) {
        p2n.style.display = 'block';
        p2n.textContent = extractName(pokeState.p2.pokemon);
      }

      p1Img.src = pokeState.p1.pokemon || UNKNOWN_AVATAR;
      p2Img.src = pokeState.p2.pokemon || UNKNOWN_AVATAR;

      document.getElementById('poke-selection-panel').style.display = 'none';
      
      if (!window.pokeAnimPlaying) {
        window.pokeAnimPlaying = true;
        document.getElementById('poke-next-round-panel').classList.add('hidden');
        playBattleAnimation();
      }
    }
  };

  // Join slots
  document.getElementById('poke-join-1')?.addEventListener('click', () => {
    broadcastPokeMsg({ type: 'poke_join', slot: 1, id: state.myId, name: state.myName, avatar: state.myAvatar });
  });
  document.getElementById('poke-join-2')?.addEventListener('click', () => {
    broadcastPokeMsg({ type: 'poke_join', slot: 2, id: state.myId, name: state.myName, avatar: state.myAvatar });
  });

  document.getElementById('poke-bot-2')?.addEventListener('click', () => {
    broadcastPokeMsg({ type: 'poke_join', slot: 2, id: 'BOT', name: '🤖 Taktik Ustası Bot', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=PokeBot' });
  });

  // Start Battle
  document.getElementById('poke-start-btn')?.addEventListener('click', () => {
    broadcastPokeMsg({ type: 'poke_start' });
  });

  // Selection
  document.querySelectorAll('.poke-type-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.getAttribute('data-type');
      broadcastPokeMsg({ type: 'poke_select', id: state.myId, pokeType: type });
    });
  });

  // Next Round
  document.getElementById('poke-next-round-btn')?.addEventListener('click', () => {
    broadcastPokeMsg({ type: 'poke_start' });
  });

  const evaluateWinner = () => {
    const t1 = pokeState.p1.type;
    const t2 = pokeState.p2.type;

    const m1 = typeChart[t1][t2]; // P1 attacks P2
    const m2 = typeChart[t2][t1]; // P2 attacks P1

    let winner = 0; // 0 = draw, 1 = p1, 2 = p2
    let message = "Etkisiz kaldı!";
    
    if (m1 > m2) {
      winner = 1;
      message = m1 >= 2 ? "Süper Etkili!" : "Avantajlı!";
    } else if (m2 > m1) {
      winner = 2;
      message = m2 >= 2 ? "Süper Etkili!" : "Avantajlı!";
    }

    const badge = document.getElementById('poke-vs-badge');
    const p1Img = document.getElementById('poke-p1-pokemon');
    const p2Img = document.getElementById('poke-p2-pokemon');
    
    if (winner === 0) {
      badge.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 15px 30px; border-radius: 15px; border: 2px solid #fbbf24; box-shadow: 0 0 20px #fbbf24; white-space: nowrap;">
          <span style="font-size: 36px; font-weight: 900; color: #fbbf24; text-shadow: 0 0 20px #fbbf24;">BERABERE!</span>
          <span style="font-size: 16px; color: #fef08a; font-style: italic; margin-top: 5px;">Nötr Çarpışma</span>
        </div>`;
    } else if (winner === 1) {
      badge.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 15px 30px; border-radius: 15px; border: 2px solid ${TYPE_COLORS[t1]}; box-shadow: 0 0 20px ${TYPE_COLORS[t1]}; white-space: nowrap;">
          <span style="font-size: 16px; color: #e2e8f0; text-transform: uppercase; letter-spacing: 2px; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${pokeState.p1.name}</span>
          <span style="font-size: 32px; font-weight: 900; color: ${TYPE_COLORS[t1]}; text-shadow: 0 0 20px ${TYPE_COLORS[t1]}; margin: 5px 0;">KAZANDI!</span>
          <span style="font-size: 14px; color: #fbbf24; font-style: italic;">${message}</span>
        </div>`;
      p1Img.classList.add('anim-winner');
      p2Img.classList.add('anim-death');
    } else {
      badge.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 15px 30px; border-radius: 15px; border: 2px solid ${TYPE_COLORS[t2]}; box-shadow: 0 0 20px ${TYPE_COLORS[t2]}; white-space: nowrap;">
          <span style="font-size: 16px; color: #e2e8f0; text-transform: uppercase; letter-spacing: 2px; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${pokeState.p2.name}</span>
          <span style="font-size: 32px; font-weight: 900; color: ${TYPE_COLORS[t2]}; text-shadow: 0 0 20px ${TYPE_COLORS[t2]}; margin: 5px 0;">KAZANDI!</span>
          <span style="font-size: 14px; color: #fbbf24; font-style: italic;">${message}</span>
        </div>`;
      p2Img.classList.add('anim-winner');
      p1Img.classList.add('anim-death');
    }
  };

  // Handler
  window.pokeActivityHandler = (data) => {
    if (data.type === 'activity_change' && data.activity === 'poke') {
      renderPokeLobby();
    }
    if (data.type === 'poke_sync') {
      Object.assign(pokeState, data.state);
      if (pokeState.status === 'selecting') {
        document.getElementById('poke-battle-view').classList.remove('hidden');
        document.getElementById('poke-lobby-view').classList.add('hidden');
        document.getElementById('poke-next-round-panel').classList.add('hidden');
        resetPokeBattle();
        renderPokeBattle();
      } else if (pokeState.status === 'battle_end') {
        document.getElementById('poke-battle-view').classList.remove('hidden');
        document.getElementById('poke-lobby-view').classList.add('hidden');
        renderPokeBattle();
      } else {
        renderPokeLobby();
      }
    }
    if (data.type === 'poke_join') {
      const pData = { id: data.id, name: data.name, avatar: data.avatar, ready: false, type: null, pokemon: null };
      if (data.slot === 1) pokeState.p1 = pData;
      else if (data.slot === 2) pokeState.p2 = pData;
      renderPokeLobby();
    }
    if (data.type === 'poke_start') {
      pokeState.status = 'selecting';
      if(pokeState.p1) { pokeState.p1.ready = false; pokeState.p1.type = null; pokeState.p1.pokemon = null; }
      if(pokeState.p2) { pokeState.p2.ready = false; pokeState.p2.type = null; pokeState.p2.pokemon = null; }
      
      // Reset styles
      document.getElementById('poke-p1-pokemon').className = '';
      document.getElementById('poke-p2-pokemon').className = '';
      
      renderPokeLobby();

      // Bot AI logic
      const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId);
      if (pokeState.p2 && pokeState.p2.id === 'BOT' && isHostFallback) {
        setTimeout(() => {
          if (pokeState.status === 'selecting') {
             let chosenType = 'fire';
             const types = Object.keys(typeChart);
             if (window.pokeBotMemory && window.pokeBotMemory.length > 0) {
               // Find most freq picked by player
               const freqs = {};
               window.pokeBotMemory.forEach(t => freqs[t] = (freqs[t] || 0) + 1);
               const mostFreq = Object.keys(freqs).reduce((a, b) => freqs[a] > freqs[b] ? a : b);
               // Find counter
               const counters = types.filter(t => typeChart[t][mostFreq] === 2);
               chosenType = counters.length > 0 ? counters[Math.floor(Math.random() * counters.length)] : types[Math.floor(Math.random() * types.length)];
             } else {
               chosenType = types[Math.floor(Math.random() * types.length)];
             }
             broadcastPokeMsg({ type: 'poke_select', id: 'BOT', pokeType: chosenType });
          }
        }, 400 + Math.random() * 400);
      }
    }
    if (data.type === 'poke_select') {
      if (pokeState.p1 && pokeState.p1.id === data.id) {
        pokeState.p1.ready = true;
        pokeState.p1.type = data.pokeType; // Note: In a real secure game, this would be hidden until both ready, but for P2P friends it's fine
      }
      if (pokeState.p2 && pokeState.p2.id === data.id) {
        pokeState.p2.ready = true;
        pokeState.p2.type = data.pokeType;
      }
      renderBattleArena();

      // If both ready and I am host, trigger reveal
      const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId);
      if (pokeState.p1?.ready && pokeState.p2?.ready && isHostFallback) {
        const p1Poke = POKEMONS[pokeState.p1.type][Math.floor(Math.random() * POKEMONS[pokeState.p1.type].length)];
        const p2Poke = POKEMONS[pokeState.p2.type][Math.floor(Math.random() * POKEMONS[pokeState.p2.type].length)];
        
        // Small delay for dramatic effect
        setTimeout(() => {
          broadcastPokeMsg({ 
            type: 'poke_reveal', 
            p1Type: pokeState.p1.type, p1Poke: p1Poke,
            p2Type: pokeState.p2.type, p2Poke: p2Poke
          });
        }, 500);
      }
    }
    if (data.type === 'poke_reveal') {
      pokeState.status = 'revealed';
      pokeState.p1.type = data.p1Type;
      pokeState.p1.pokemon = data.p1Poke;
      pokeState.p2.type = data.p2Type;
      pokeState.p2.pokemon = data.p2Poke;

      // Save memory for bot
      if (pokeState.p2 && pokeState.p2.id === 'BOT' && pokeState.p1 && pokeState.p1.id !== 'BOT') {
        window.pokeBotMemory.push(pokeState.p1.type);
        if (window.pokeBotMemory.length > 10) window.pokeBotMemory.shift();
      }

      renderBattleArena();
    }
  };

  // Add into global activity handler override
  const originalActHandler = window.activityHandler;
  window.activityHandler = (data) => {
    if(originalActHandler) originalActHandler(data);
    pokeActivityHandler(data);
  };
}
