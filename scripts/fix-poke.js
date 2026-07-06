const fs = require('fs');
let content = fs.readFileSync('js/poke.js', 'utf8');

// The replacement for revealed block
const targetRevealed = "    else if (pokeState.status === 'revealed') {\r\n      p1Status.style.display = 'none';\r\n      p2Status.style.display = 'none';\r\n      p1Img.style.display = 'block';\r\n      p2Img.style.display = 'block';\r\n\r\n      p1Img.src = pokeState.p1.pokemon || UNKNOWN_AVATAR;\r\n      p2Img.src = pokeState.p2.pokemon || UNKNOWN_AVATAR;\r\n\r\n      document.getElementById('poke-selection-panel').style.display = 'none';\r\n      document.getElementById('poke-next-round-panel').classList.remove('hidden');\r\n\r\n      if (state.isLobbyHost) {\r\n        document.getElementById('poke-next-round-btn').style.display = 'block';\r\n        document.getElementById('poke-spectator-msg').style.display = 'none';\r\n      } else {\r\n        document.getElementById('poke-next-round-btn').style.display = 'none';\r\n        document.getElementById('poke-spectator-msg').style.display = 'block';\r\n      }\r\n    }";

const newRevealed = "    else if (pokeState.status === 'revealed') {\r\n      p1Status.style.display = 'none';\r\n      p2Status.style.display = 'none';\r\n      p1Img.style.display = 'block';\r\n      p2Img.style.display = 'block';\r\n\r\n      p1Img.src = pokeState.p1.pokemon || UNKNOWN_AVATAR;\r\n      p2Img.src = pokeState.p2.pokemon || UNKNOWN_AVATAR;\r\n\r\n      document.getElementById('poke-selection-panel').style.display = 'none';\r\n      \r\n      if (!window.pokeAnimPlaying) {\r\n        window.pokeAnimPlaying = true;\r\n        document.getElementById('poke-next-round-panel').classList.add('hidden');\r\n        playBattleAnimation();\r\n      }\r\n    }";

// Inject playBattleAnimation function before renderBattleArena
const animFunc = "  const TYPE_EMOJIS = {\r\n    fire: '??', water: '??', grass: '??',\r\n    electric: '?', dark: '??', fairy: '?'\r\n  };\r\n\r\n  const playBattleAnimation = () => {\r\n    const p1Img = document.getElementById('poke-p1-pokemon');\r\n    const p2Img = document.getElementById('poke-p2-pokemon');\r\n    const proj = document.getElementById('poke-projectile');\r\n\r\n    p1Img.className = '';\r\n    p2Img.className = '';\r\n    \r\n    setTimeout(() => {\r\n      p1Img.classList.add('anim-lunge-p1');\r\n      proj.textContent = TYPE_EMOJIS[pokeState.p1.type] || '??';\r\n      proj.className = 'anim-proj-p1';\r\n      proj.style.display = 'block';\r\n      \r\n      setTimeout(() => {\r\n        proj.style.display = 'none';\r\n        p2Img.classList.add('anim-shake'); \r\n      }, 500);\r\n    }, 1000);\r\n\r\n    setTimeout(() => {\r\n      p2Img.classList.add('anim-lunge-p2');\r\n      proj.textContent = TYPE_EMOJIS[pokeState.p2.type] || '??';\r\n      proj.className = 'anim-proj-p2';\r\n      proj.style.display = 'block';\r\n\r\n      setTimeout(() => {\r\n        proj.style.display = 'none';\r\n        p1Img.classList.add('anim-shake-p1');\r\n      }, 500);\r\n    }, 2500);\r\n\r\n    setTimeout(() => {\r\n      evaluateWinner();\r\n      document.getElementById('poke-next-round-panel').classList.remove('hidden');\r\n      \r\n      const isP1 = pokeState.p1 && pokeState.p1.id === state.myId;\r\n      const isP2 = pokeState.p2 && pokeState.p2.id === state.myId;\r\n      if (state.isLobbyHost || isP1 || isP2) {\r\n        document.getElementById('poke-next-round-btn').style.display = 'block';\r\n        document.getElementById('poke-spectator-msg').style.display = 'none';\r\n      } else {\r\n        document.getElementById('poke-next-round-btn').style.display = 'none';\r\n        document.getElementById('poke-spectator-msg').style.display = 'block';\r\n      }\r\n      window.pokeAnimPlaying = false;\r\n    }, 4000);\r\n  };\r\n\r\n  const renderBattleArena = () => {";

content = content.replace(targetRevealed, newRevealed);
// If it fails with \r\n, try without \r
content = content.replace(targetRevealed.replace(/\r/g, ''), newRevealed);

content = content.replace('  const renderBattleArena = () => {', animFunc);

// Also reset animations in "selecting" logic
const selectingTarget = "      if (isPlaying) {\r\n        const myPlayer = isP1 ? pokeState.p1 : pokeState.p2;";
const selectingNew = "      p1Img.className = '';\r\n      p2Img.className = '';\r\n      window.pokeAnimPlaying = false;\r\n      if (isPlaying) {\r\n        const myPlayer = isP1 ? pokeState.p1 : pokeState.p2;";
content = content.replace(selectingTarget, selectingNew);
content = content.replace(selectingTarget.replace(/\r/g, ''), selectingNew);

fs.writeFileSync('js/poke.js', content, 'utf8');
console.log('Successfully updated js/poke.js!');
