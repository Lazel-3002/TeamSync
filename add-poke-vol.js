const fs = require('fs');

// 1. Update HTML
let html = fs.readFileSync('index.html', 'utf8');

const volHtml = `
              <div id="poke-vol-control" style="position: absolute; top: 15px; left: 20px; display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.5); padding: 5px 15px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);">
                <button id="poke-vol-mute" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #fff; padding: 0; outline: none;" title="Sesi Kapat/Aç">🔊</button>
                <input type="range" id="poke-vol-slider" min="0" max="100" value="60" style="width: 80px; accent-color: #3b82f6; cursor: pointer;" title="Ses Seviyesi" />
              </div>`;

html = html.replace(
  /<button id="poke-guide-btn"/,
  volHtml + '\n              <button id="poke-guide-btn"'
);

fs.writeFileSync('index.html', html, 'utf8');

// 2. Update JS
let pokeJs = fs.readFileSync('js/poke.js', 'utf8');

// Declare volume state variables at the top (after let pokeState)
pokeJs = pokeJs.replace(
  /let pokeState = \{[\s\S]*?\};/,
  `$&
  let pokeVol = 0.6;
  let pokeMuted = false;`
);

// Update playCry logic
pokeJs = pokeJs.replace(
  /const audio = new Audio\('https:\/\/play\.pokemonshowdown\.com\/audio\/cries\/' \+ name \+ '\.mp3'\);\s*audio\.volume = 0\.6;/,
  `const audio = new Audio('https://play.pokemonshowdown.com/audio/cries/' + name + '.mp3');
      audio.volume = pokeMuted ? 0 : pokeVol;`
);

// Add event listeners for the volume controls
const volListeners = `
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
`;

// Insert the listeners inside a suitable place, e.g. next to the guideBtn listeners
pokeJs = pokeJs.replace(
  /const guideBtn = document\.getElementById\('poke-guide-btn'\);/,
  `${volListeners}\n\n  const guideBtn = document.getElementById('poke-guide-btn');`
);

fs.writeFileSync('js/poke.js', pokeJs, 'utf8');
console.log('Pokemon battle volume controls added!');
