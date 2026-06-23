const fs = require('fs');

let pokeJs = fs.readFileSync('js/poke.js', 'utf8');

pokeJs = pokeJs.replace(
  /const TYPE_EMOJIS = \{[\s\S]*?\};/,
  `const TYPE_EMOJIS = {
  normal: '💫', fire: '☄️', water: '🌊', electric: '🌩️', grass: '🍃',
  ice: '🧊', fighting: '👊', poison: '🦠', ground: '🪨', flying: '🌪️',
  psychic: '🔮', bug: '🕸️', rock: '🗿', ghost: '🌫️', dragon: '🐲',
  dark: '🌌', steel: '🛸', fairy: '💖'
};`
);

fs.writeFileSync('js/poke.js', pokeJs, 'utf8');

let styleCss = fs.readFileSync('style.css', 'utf8');
styleCss = styleCss.replace(
  /\.proj-inner \{\s*display: inline-block;\s*font-size: 60px;\s*line-height: 1;\s*\}/,
  `.proj-inner {
  display: inline-block;
  font-size: 110px;
  line-height: 1;
  transform-origin: center center;
}`
);

// We can also enhance the animations for fire, water, etc.
styleCss = styleCss.replace(/filter: drop-shadow\(0 0 20px #ff4500\) drop-shadow\(0 0 40px #ff0000\);/g, 'filter: drop-shadow(0 0 30px #ff4500) drop-shadow(0 0 60px #ff0000) drop-shadow(0 0 90px #ff0000);');
styleCss = styleCss.replace(/filter: drop-shadow\(0 0 20px #00bfff\) drop-shadow\(0 0 30px #1e90ff\);/g, 'filter: drop-shadow(0 0 30px #00bfff) drop-shadow(0 0 60px #1e90ff) drop-shadow(0 0 90px #1e90ff);');
styleCss = styleCss.replace(/filter: drop-shadow\(0 0 20px #ffff00\) drop-shadow\(0 0 40px #ffd700\);/g, 'filter: drop-shadow(0 0 30px #ffff00) drop-shadow(0 0 60px #ffd700) drop-shadow(0 0 90px #ffd700);');
styleCss = styleCss.replace(/filter: drop-shadow\(0 0 20px #ff69b4\) drop-shadow\(0 0 30px #ff1493\);/g, 'filter: drop-shadow(0 0 30px #ff69b4) drop-shadow(0 0 60px #ff1493) drop-shadow(0 0 90px #ff1493);');
styleCss = styleCss.replace(/filter: drop-shadow\(0 0 20px #38bdf8\) drop-shadow\(0 0 30px #7dd3fc\);/g, 'filter: drop-shadow(0 0 30px #38bdf8) drop-shadow(0 0 60px #7dd3fc) drop-shadow(0 0 90px #7dd3fc);');
styleCss = styleCss.replace(/filter: drop-shadow\(0 0 20px #f43f5e\) drop-shadow\(0 0 30px #fb7185\);/g, 'filter: drop-shadow(0 0 30px #f43f5e) drop-shadow(0 0 60px #fb7185) drop-shadow(0 0 90px #fb7185);');
styleCss = styleCss.replace(/filter: drop-shadow\(0 0 20px #6366f1\) opacity\(0\.7\);/g, 'filter: drop-shadow(0 0 40px #6366f1) drop-shadow(0 0 80px #4f46e5) opacity(0.85);');

fs.writeFileSync('style.css', styleCss, 'utf8');
console.log('Improved emojis and CSS sizes/glows');
