const fs = require('fs');

// Fix poke.js innerHTML
let pokeJs = fs.readFileSync('js/poke.js', 'utf8');

pokeJs = pokeJs.replace(/proj\.textContent = TYPE_EMOJIS\[pokeState\.p1\.type\] \|\| '.*';\s*proj\.className = 'anim-proj-p1(?: type-')?(?:\+ pokeState\.p1\.type)?(?:')?;/, `proj.innerHTML = '<span class="proj-inner type-' + pokeState.p1.type + '">' + (TYPE_EMOJIS[pokeState.p1.type] || '💥') + '</span>';
        proj.className = 'anim-proj-p1';`);

pokeJs = pokeJs.replace(/proj\.textContent = TYPE_EMOJIS\[pokeState\.p2\.type\] \|\| '.*';\s*proj\.className = 'anim-proj-p2(?: type-')?(?:\+ pokeState\.p2\.type)?(?:')?;/, `proj.innerHTML = '<span class="proj-inner type-' + pokeState.p2.type + '">' + (TYPE_EMOJIS[pokeState.p2.type] || '💥') + '</span>';
        proj.className = 'anim-proj-p2';`);

fs.writeFileSync('js/poke.js', pokeJs, 'utf8');
console.log('Fixed js/poke.js for innerHTML');

// Inject CSS
let css = fs.readFileSync('style.css', 'utf8');

const newCss = `
/* ===== POKESAVAS PREMIUM EFFECTS ===== */
.proj-inner {
  display: inline-block;
  font-size: 60px;
  line-height: 1;
}

/* Fire */
.proj-inner.type-fire {
  filter: drop-shadow(0 0 20px #ff4500) drop-shadow(0 0 40px #ff0000);
  animation: fire-pulse 0.2s infinite alternate;
}
@keyframes fire-pulse {
  from { transform: scale(1); filter: drop-shadow(0 0 20px #ff4500); }
  to { transform: scale(1.3); filter: drop-shadow(0 0 40px #ff0000) brightness(1.5); }
}

/* Water */
.proj-inner.type-water {
  filter: drop-shadow(0 0 20px #00bfff) drop-shadow(0 0 30px #1e90ff);
  animation: water-swirl 0.4s infinite linear;
}
@keyframes water-swirl {
  from { transform: rotate(0deg) scale(1.1); }
  to { transform: rotate(360deg) scale(1.1); }
}

/* Grass */
.proj-inner.type-grass {
  filter: drop-shadow(0 0 15px #32cd32);
  animation: grass-spin 0.3s infinite linear;
}
@keyframes grass-spin {
  from { transform: rotate(0deg) scale(1.2); }
  to { transform: rotate(360deg) scale(1.2); }
}

/* Electric */
.proj-inner.type-electric {
  filter: drop-shadow(0 0 20px #ffff00) drop-shadow(0 0 40px #ffd700);
  animation: electric-flash 0.1s infinite alternate;
}
@keyframes electric-flash {
  from { transform: scale(0.9) skewX(-15deg); filter: drop-shadow(0 0 10px #ff0); }
  to { transform: scale(1.5) skewX(15deg); filter: drop-shadow(0 0 40px #fff) brightness(2); }
}

/* Dark */
.proj-inner.type-dark {
  filter: drop-shadow(0 0 25px #4b0082) brightness(0.6);
  animation: dark-pulse 0.3s infinite alternate;
}
@keyframes dark-pulse {
  from { transform: scale(0.8) rotate(-10deg); }
  to { transform: scale(1.4) rotate(10deg); filter: drop-shadow(0 0 40px #8a2be2) brightness(1.2); }
}

/* Fairy */
.proj-inner.type-fairy {
  filter: drop-shadow(0 0 20px #ff69b4) drop-shadow(0 0 30px #ff1493);
  animation: fairy-sparkle 0.2s infinite alternate;
}
@keyframes fairy-sparkle {
  from { transform: scale(1) rotate(-15deg); filter: drop-shadow(0 0 15px #ff69b4); opacity: 0.8; }
  to { transform: scale(1.4) rotate(15deg); filter: drop-shadow(0 0 35px #ff1493) brightness(1.5); opacity: 1; }
}

/* Premium Button Hover Glow */
.poke-type-btn {
  position: relative;
  overflow: hidden;
}
.poke-type-btn::after {
  content: '';
  position: absolute;
  top: -50%; left: -50%;
  width: 200%; height: 200%;
  background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 60%);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.poke-type-btn:hover::after {
  opacity: 1;
  animation: btn-glow 2s infinite linear;
}
@keyframes btn-glow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

if (!css.includes('POKESAVAS PREMIUM EFFECTS')) {
  fs.writeFileSync('style.css', css + '\\n' + newCss, 'utf8');
  console.log('Added premium CSS');
}
