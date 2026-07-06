const fs = require('fs');

// Fix poke.js
let pokeJs = fs.readFileSync('js/poke.js', 'utf8');
pokeJs = pokeJs.replace(/const TYPE_EMOJIS = \{[\s\S]*?\};/, `const TYPE_EMOJIS = {
  fire: '🔥', water: '🌊', grass: '🍃',
  electric: '⚡', dark: '🌑', fairy: '✨'
};`);

pokeJs = pokeJs.replace(/proj\.className = 'anim-proj-p1';/g, "proj.className = 'anim-proj-p1 type-' + pokeState.p1.type;");
pokeJs = pokeJs.replace(/proj\.className = 'anim-proj-p2';/g, "proj.className = 'anim-proj-p2 type-' + pokeState.p2.type;");

fs.writeFileSync('js/poke.js', pokeJs, 'utf8');
console.log('Fixed js/poke.js');

// Fix index.html
let html = fs.readFileSync('index.html', 'utf8');

html = html.replace(/(<button class="poke-type-btn" data-type="fire"[^>]*>).*?(<\/button>)/, "$1🔥 ATEŞ$2");
html = html.replace(/(<button class="poke-type-btn" data-type="water"[^>]*>).*?(<\/button>)/, "$1💧 SU$2");
html = html.replace(/(<button class="poke-type-btn" data-type="grass"[^>]*>).*?(<\/button>)/, "$1🌿 ÇİMEN$2");
html = html.replace(/(<button class="poke-type-btn" data-type="electric"[^>]*>).*?(<\/button>)/, "$1⚡ ELEKTRİK$2");
html = html.replace(/(<button class="poke-type-btn" data-type="dark"[^>]*>).*?(<\/button>)/, "$1🌑 KARANLIK$2");
html = html.replace(/(<button class="poke-type-btn" data-type="fairy"[^>]*>).*?(<\/button>)/, "$1✨ PERİ$2");

html = html.replace(/(<button id="poke-next-round-btn"[^>]*>).*?(<\/button>)/, "$1🔄 Tekrar Oyna$2");

html = html.replace(/<div style="font-size: 40px; margin-right: 20px;">.*?<\/div>/, `<div style="font-size: 40px; margin-right: 20px;">⚔️</div>`);
html = html.replace(/<h3 style="margin: 0;[^>]*>.*?<\/h3>/, `<h3 style="margin: 0; font-family: 'Arial Black', sans-serif; letter-spacing: 2px; text-transform: uppercase; color: #f8fafc; text-shadow: 0 2px 10px rgba(255,255,255,0.3);">⚔️ PokeSavaş ⚔️</h3>`);

fs.writeFileSync('index.html', html, 'utf8');
console.log('Fixed index.html');
