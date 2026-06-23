const fs = require('fs');

let pokeJs = fs.readFileSync('js/poke.js', 'utf8');

// 1. Expand TYPE_NAMES and TYPE_COLORS
pokeJs = pokeJs.replace(/const TYPE_NAMES = \{.*?\};/, `const TYPE_NAMES = { normal: 'NORMAL', fire: 'ATEŞ', water: 'SU', electric: 'ELEKTRİK', grass: 'ÇİMEN', ice: 'BUZ', fighting: 'DÖVÜŞ', poison: 'ZEHİR', ground: 'TOPRAK', flying: 'UÇAN', psychic: 'PSİŞİK', bug: 'BÖCEK', rock: 'KAYA', ghost: 'HAYALET', dragon: 'EJDERHA', dark: 'KARANLIK', steel: 'ÇELİK', fairy: 'PERİ' };`);
pokeJs = pokeJs.replace(/const TYPE_COLORS = \{.*?\};/, `const TYPE_COLORS = { normal: '#9ca3af', fire: '#ef4444', water: '#3b82f6', electric: '#eab308', grass: '#22c55e', ice: '#38bdf8', fighting: '#f97316', poison: '#a855f7', ground: '#d97706', flying: '#818cf8', psychic: '#f43f5e', bug: '#84cc16', rock: '#78716c', ghost: '#6366f1', dragon: '#3b82f6', dark: '#1e293b', steel: '#94a3b8', fairy: '#ec4899' };`);

// 2. Remove evaluateWinner from poke_reveal block
pokeJs = pokeJs.replace(/renderBattleArena\(\);\s*evaluateWinner\(\);/, 'renderBattleArena();');

// 3. Reset VS badge in renderBattleArena
pokeJs = pokeJs.replace(/const renderBattleArena = \(\) => \{([\s\S]*?)const isP1 =/, `const renderBattleArena = () => {
    const badge = document.getElementById('poke-vs-badge');
    if (badge) badge.innerHTML = '<span style="font-size: 50px; font-style: italic; font-weight: 900; color: #cbd5e1; text-shadow: 0 4px 10px rgba(0,0,0,0.8);">VS</span>';
$1const isP1 =`);

// 4. Update evaluateWinner to use .anim-death and fix undefined TYPE_COLORS
// It already has p1Img.className = 'winner-anim' and 'loser-anim'. Let's change 'loser-anim' to 'anim-death' and 'winner-anim' to 'anim-winner'.
pokeJs = pokeJs.replace(/p1Img\.className = 'winner-anim';\s*p2Img\.className = 'loser-anim';/, `p1Img.classList.add('anim-winner');
        p2Img.classList.add('anim-death');`);
pokeJs = pokeJs.replace(/p2Img\.className = 'winner-anim';\s*p1Img\.className = 'loser-anim';/, `p2Img.classList.add('anim-winner');
        p1Img.classList.add('anim-death');`);

fs.writeFileSync('js/poke.js', pokeJs, 'utf8');
console.log('Fixed js/poke.js');

let css = fs.readFileSync('style.css', 'utf8');
const deathCss = `
/* Death Animation */
.anim-death {
  animation: poke-death 1.5s ease-in forwards !important;
  filter: grayscale(100%) brightness(0.5);
}
@keyframes poke-death {
  0% { transform: scale(1) rotate(0deg); opacity: 1; }
  20% { transform: scale(0.9) rotate(-10deg) translateX(-10px); }
  40% { transform: scale(0.9) rotate(10deg) translateX(10px); }
  60% { transform: scale(0.8) rotate(-20deg) translateY(20px); opacity: 0.8; }
  100% { transform: scale(0.5) rotate(-90deg) translateY(100px); opacity: 0; display: none; }
}

.anim-winner {
  animation: poke-winner 2s ease-out infinite alternate !important;
}
@keyframes poke-winner {
  0% { transform: scale(1); filter: drop-shadow(0 0 10px #fbbf24); }
  100% { transform: scale(1.1); filter: drop-shadow(0 0 30px #f59e0b) brightness(1.2); }
}
`;
if (!css.includes('anim-death')) {
  fs.writeFileSync('style.css', css + '\\n' + deathCss, 'utf8');
  console.log('Added CSS animations');
}
