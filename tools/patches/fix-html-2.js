const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');

// 1. Move poke-card
const pokeStartIdx = content.indexOf('<div id="poke-card"');
const pokeEndIdx = content.indexOf('<script src="js/poke.js"></script>');

if (pokeStartIdx !== -1 && pokeEndIdx !== -1 && pokeStartIdx > 800) {
  const pokeContent = content.substring(pokeStartIdx, pokeEndIdx);
  content = content.substring(0, pokeStartIdx) + content.substring(pokeEndIdx);
  const barIdx = content.indexOf('<div class="bar">');
  if (barIdx !== -1) {
    content = content.substring(0, barIdx) + pokeContent + '\n    ' + content.substring(barIdx);
  }
}

// 2. Add projectile
const targetEffectArea = '<div id="poke-vs-badge" style="font-size: 50px; font-style: italic; font-weight: 900; color: #cbd5e1; text-shadow: 0 4px 10px rgba(0,0,0,0.8);">VS</div>';
const newEffectArea = targetEffectArea + '\n              <div id="poke-projectile" style="position: absolute; display: none; font-size: 60px; z-index: 30; pointer-events: none; filter: drop-shadow(0 0 15px rgba(255,255,255,0.8));"></div>';
content = content.replace(targetEffectArea, newEffectArea);

// 3. Update next round button
const targetBtn = '<button id="poke-next-round-btn" class="btn-pri" style="font-size: 18px; padding: 10px 30px; border-radius: 30px; display: none;">Sonraki Tur</button>';
const newBtn = '<button id="poke-next-round-btn" class="btn-pri" style="font-size: 20px; padding: 12px 40px; border-radius: 30px; display: none; background: linear-gradient(45deg, #10b981, #059669); border: 2px solid #34d399; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); text-transform: uppercase; font-weight: bold;">?? Tekrar Oyna</button>';
content = content.replace(targetBtn, newBtn);

fs.writeFileSync('index.html', content, 'utf8');
console.log('Successfully updated index.html!');
