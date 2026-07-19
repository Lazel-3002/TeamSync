const fs = require('fs');

let css = fs.readFileSync('style.css', 'utf8');

const newCss = `
/* ===== MORE PREMIUM POKESAVAS EFFECTS ===== */

/* Normal */
.proj-inner.type-normal {
  filter: drop-shadow(0 0 15px #d1d5db);
  animation: normal-bounce 0.3s infinite alternate;
}
@keyframes normal-bounce {
  from { transform: translateY(-5px); }
  to { transform: translateY(5px); filter: drop-shadow(0 0 25px #fff); }
}

/* Ice */
.proj-inner.type-ice {
  filter: drop-shadow(0 0 20px #38bdf8) drop-shadow(0 0 30px #7dd3fc);
  animation: ice-spin 0.4s infinite linear;
}
@keyframes ice-spin {
  from { transform: rotate(0deg) scale(1.1); }
  to { transform: rotate(360deg) scale(1.1); filter: drop-shadow(0 0 40px #e0f2fe) brightness(1.5); }
}

/* Fighting */
.proj-inner.type-fighting {
  filter: drop-shadow(0 0 15px #f97316);
  animation: fighting-punch 0.2s infinite alternate;
}
@keyframes fighting-punch {
  from { transform: scale(1) translateX(-5px); }
  to { transform: scale(1.3) translateX(15px); filter: drop-shadow(0 0 30px #ea580c); }
}

/* Poison */
.proj-inner.type-poison {
  filter: drop-shadow(0 0 20px #a855f7) brightness(0.8);
  animation: poison-bubble 0.4s infinite alternate;
}
@keyframes poison-bubble {
  from { transform: scale(0.9); }
  to { transform: scale(1.2); filter: drop-shadow(0 0 35px #9333ea) brightness(1.3); }
}

/* Ground */
.proj-inner.type-ground {
  filter: drop-shadow(0 0 15px #d97706);
  animation: ground-shake 0.1s infinite alternate;
}
@keyframes ground-shake {
  from { transform: translateY(0) rotate(-5deg); }
  to { transform: translateY(-10px) rotate(5deg); filter: drop-shadow(0 0 25px #b45309); }
}

/* Flying */
.proj-inner.type-flying {
  filter: drop-shadow(0 0 15px #818cf8);
  animation: flying-swoop 0.4s infinite alternate;
}
@keyframes flying-swoop {
  from { transform: translateY(-15px) rotate(-15deg); }
  to { transform: translateY(15px) rotate(15deg); filter: drop-shadow(0 0 30px #a5b4fc); }
}

/* Psychic */
.proj-inner.type-psychic {
  filter: drop-shadow(0 0 20px #f43f5e) drop-shadow(0 0 30px #fb7185);
  animation: psychic-float 0.3s infinite alternate;
}
@keyframes psychic-float {
  from { transform: scale(0.9) rotate(0deg); opacity: 0.8; }
  to { transform: scale(1.3) rotate(180deg); filter: drop-shadow(0 0 40px #fda4af) brightness(1.5); opacity: 1; }
}

/* Bug */
.proj-inner.type-bug {
  filter: drop-shadow(0 0 15px #84cc16);
  animation: bug-flutter 0.1s infinite alternate;
}
@keyframes bug-flutter {
  from { transform: translateY(-5px) scaleY(0.8); }
  to { transform: translateY(5px) scaleY(1.2); filter: drop-shadow(0 0 25px #a3e635); }
}

/* Rock */
.proj-inner.type-rock {
  filter: drop-shadow(0 0 15px #78716c);
  animation: rock-tumble 0.5s infinite linear;
}
@keyframes rock-tumble {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); filter: drop-shadow(0 0 25px #a8a29e); }
}

/* Ghost */
.proj-inner.type-ghost {
  filter: drop-shadow(0 0 20px #6366f1) opacity(0.7);
  animation: ghost-fade 0.5s infinite alternate;
}
@keyframes ghost-fade {
  from { transform: scale(1) translateY(0); opacity: 0.5; }
  to { transform: scale(1.5) translateY(-10px); filter: drop-shadow(0 0 40px #818cf8) brightness(1.5); opacity: 1; }
}

/* Dragon */
.proj-inner.type-dragon {
  filter: drop-shadow(0 0 20px #3b82f6) drop-shadow(0 0 30px #f59e0b);
  animation: dragon-roar 0.3s infinite alternate;
}
@keyframes dragon-roar {
  from { transform: scale(1); filter: drop-shadow(0 0 20px #3b82f6); }
  to { transform: scale(1.4); filter: drop-shadow(0 0 40px #f59e0b) brightness(1.5); }
}

/* Steel */
.proj-inner.type-steel {
  filter: drop-shadow(0 0 15px #94a3b8);
  animation: steel-shine 0.2s infinite alternate;
}
@keyframes steel-shine {
  from { transform: scale(1) skewX(-10deg); filter: brightness(0.8); }
  to { transform: scale(1.2) skewX(10deg); filter: drop-shadow(0 0 30px #cbd5e1) brightness(2); }
}
`;

if (!css.includes('MORE PREMIUM POKESAVAS EFFECTS')) {
  fs.writeFileSync('style.css', css + '\\n' + newCss, 'utf8');
  console.log('Added 12 new premium CSS animations');
}
