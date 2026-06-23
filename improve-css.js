const fs = require('fs');

// 1. Update index.html
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(
  /<div id="poke-p1-header"([^>]+)>([^<]+)<\/div>\s*<div id="poke-p1-pokemon-container"/,
  '<div id="poke-p1-header"$1>$2</div>\n              <div id="poke-p1-pokename" style="font-size: 18px; color: #fbbf24; font-weight: 900; text-transform: uppercase; margin-bottom: 5px; text-shadow: 0 0 10px #fbbf24; display: none;"></div>\n              <div id="poke-p1-pokemon-container"'
);

html = html.replace(
  /<div id="poke-p2-header"([^>]+)>([^<]+)<\/div>\s*<div id="poke-p2-pokemon-container"/,
  '<div id="poke-p2-header"$1>$2</div>\n              <div id="poke-p2-pokename" style="font-size: 18px; color: #fbbf24; font-weight: 900; text-transform: uppercase; margin-bottom: 5px; text-shadow: 0 0 10px #fbbf24; display: none;"></div>\n              <div id="poke-p2-pokemon-container"'
);
fs.writeFileSync('index.html', html, 'utf8');

// 2. Update js/poke.js
let pokeJs = fs.readFileSync('js/poke.js', 'utf8');

// a. Update evaluateWinner
pokeJs = pokeJs.replace(
  /if \(winner === 0\) \{[\s\S]*?p1Img\.classList\.add\('anim-death'\);\s*\}/,
  `if (winner === 0) {
      badge.innerHTML = \`
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 15px 30px; border-radius: 15px; border: 2px solid #fbbf24; box-shadow: 0 0 20px #fbbf24; white-space: nowrap;">
          <span style="font-size: 36px; font-weight: 900; color: #fbbf24; text-shadow: 0 0 20px #fbbf24;">BERABERE!</span>
          <span style="font-size: 16px; color: #fef08a; font-style: italic; margin-top: 5px;">Nötr Çarpışma</span>
        </div>\`;
    } else if (winner === 1) {
      badge.innerHTML = \`
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 15px 30px; border-radius: 15px; border: 2px solid \${TYPE_COLORS[t1]}; box-shadow: 0 0 20px \${TYPE_COLORS[t1]}; white-space: nowrap;">
          <span style="font-size: 16px; color: #e2e8f0; text-transform: uppercase; letter-spacing: 2px; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">\${pokeState.p1.name}</span>
          <span style="font-size: 32px; font-weight: 900; color: \${TYPE_COLORS[t1]}; text-shadow: 0 0 20px \${TYPE_COLORS[t1]}; margin: 5px 0;">KAZANDI!</span>
          <span style="font-size: 14px; color: #fbbf24; font-style: italic;">\${message}</span>
        </div>\`;
      p1Img.classList.add('anim-winner');
      p2Img.classList.add('anim-death');
    } else {
      badge.innerHTML = \`
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 15px 30px; border-radius: 15px; border: 2px solid \${TYPE_COLORS[t2]}; box-shadow: 0 0 20px \${TYPE_COLORS[t2]}; white-space: nowrap;">
          <span style="font-size: 16px; color: #e2e8f0; text-transform: uppercase; letter-spacing: 2px; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">\${pokeState.p2.name}</span>
          <span style="font-size: 32px; font-weight: 900; color: \${TYPE_COLORS[t2]}; text-shadow: 0 0 20px \${TYPE_COLORS[t2]}; margin: 5px 0;">KAZANDI!</span>
          <span style="font-size: 14px; color: #fbbf24; font-style: italic;">\${message}</span>
        </div>\`;
      p2Img.classList.add('anim-winner');
      p1Img.classList.add('anim-death');
    }`
);

// b. Update renderBattleArena for pokename visibility
pokeJs = pokeJs.replace(
  /p2Status\.style\.color = pokeState\.p2\.ready \? "#22c55e" : "white";/,
  `p2Status.style.color = pokeState.p2.ready ? "#22c55e" : "white";
      
      const p1n = document.getElementById('poke-p1-pokename');
      const p2n = document.getElementById('poke-p2-pokename');
      if(p1n) p1n.style.display = 'none';
      if(p2n) p2n.style.display = 'none';`
);

pokeJs = pokeJs.replace(
  /p1Img\.style\.display = 'block';\s*p2Img\.style\.display = 'block';/,
  `p1Img.style.display = 'block';
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
      }`
);

fs.writeFileSync('js/poke.js', pokeJs, 'utf8');
console.log("Updated styles and pokemon names");
