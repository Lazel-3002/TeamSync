const fs = require('fs');

// 1. Update index.html
let html = fs.readFileSync('index.html', 'utf8');

// Insert guide button in poke-selection-panel
html = html.replace(
  /<div id="poke-selection-panel" style="(.*?)">/,
  '<div id="poke-selection-panel" style="$1; position: relative;">\n              <button id="poke-guide-btn" class="btn-sec btn-sm" style="position: absolute; top: 15px; right: 20px; background: rgba(59, 130, 246, 0.1); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 20px; padding: 6px 15px; font-weight: bold; cursor: pointer; transition: all 0.2s; box-shadow: 0 0 10px rgba(59,130,246,0.2);">❓ Tür Kılavuzu</button>'
);

// Add the modal at the end of poke-card
html = html.replace(
  /<\/div>\s*<\/div>\s*<div class="bar">/,
  `          <!-- Pokemon Type Guide Modal -->
          <div id="poke-guide-modal" class="hidden" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.95); z-index: 100; display: flex; flex-direction: column; padding: 30px; overflow-y: auto; backdrop-filter: blur(10px);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
              <h2 style="color: #fbbf24; margin: 0; font-size: 24px; text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);">📖 Pokémon Tür Kılavuzu</h2>
              <button id="poke-guide-close" class="btn-sec" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; border-color: rgba(239, 68, 68, 0.3);">Kapat</button>
            </div>
            <div id="poke-guide-content" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px;">
              <!-- Filled by JS -->
            </div>
          </div>
        </div>
      </div>
    <div class="bar">`
);

fs.writeFileSync('index.html', html, 'utf8');

// 2. Update js/poke.js
let pokeJs = fs.readFileSync('js/poke.js', 'utf8');

// Add the generateGuide function and listeners right after TYPE_EMOJIS definition
const guideScript = `
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
      
      const renderBadges = (types) => types.map(t => \`<span style="background: \${TYPE_COLORS[t]}22; color: \${TYPE_COLORS[t]}; border: 1px solid \${TYPE_COLORS[t]}66; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; margin-right: 4px; margin-bottom: 4px; display: inline-block;">\${TYPE_EMOJIS[t] || ''} \${translateName(t)}\</span>\`).join('');
      
      guideContent.innerHTML += \`
        <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; border-left: 4px solid \${color}; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
          <h3 style="color: \${color}; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px; text-shadow: 0 0 10px \${color}66;">
            <span style="font-size: 20px;">\${TYPE_EMOJIS[type] || ''}</span> \${translateName(type)}
          </h3>
          <div style="margin-bottom: 10px;">
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">⚔️ <b>Hasar Verir (2x)</b></div>
            <div>\${strengths.length > 0 ? renderBadges(strengths) : '<span style="color: #64748b; font-size: 12px; font-style: italic;">Kimseye</span>'}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">🛡️ <b>Zayıf Vurur (0.5x)</b></div>
            <div>\${weaknesses.length > 0 ? renderBadges(weaknesses) : '<span style="color: #64748b; font-size: 12px; font-style: italic;">Kimseye</span>'}</div>
          </div>
        </div>
      \`;
    }
  };

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
`;

pokeJs = pokeJs.replace(
  /(const TYPE_EMOJIS = \{[\s\S]*?\};)/,
  `$1\n\n${guideScript}`
);

fs.writeFileSync('js/poke.js', pokeJs, 'utf8');
console.log('Guide UI added successfully');
