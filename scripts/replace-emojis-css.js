const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf8');

// The CSS to inject for all 18 types
const premiumEmojiCss = `
  /* Fire */
  .proj-inner.type-fire { filter: drop-shadow(0 0 30px #ff4500) drop-shadow(0 0 60px #ff0000) drop-shadow(0 0 90px #ff0000); animation: fire-pulse 0.2s infinite alternate; }
  @keyframes fire-pulse { from { transform: scale(1) rotate(-10deg); filter: drop-shadow(0 0 20px #ff4500); } to { transform: scale(1.4) rotate(10deg); filter: drop-shadow(0 0 50px #ff0000) brightness(1.5); } }

  /* Water */
  .proj-inner.type-water { filter: drop-shadow(0 0 30px #00bfff) drop-shadow(0 0 60px #1e90ff) drop-shadow(0 0 90px #1e90ff); animation: water-swirl 0.4s infinite linear; }
  @keyframes water-swirl { from { transform: rotate(0deg) scale(1.2); } to { transform: rotate(360deg) scale(1.2); filter: drop-shadow(0 0 50px #00bfff) brightness(1.4); } }

  /* Grass */
  .proj-inner.type-grass { filter: drop-shadow(0 0 30px #32cd32) drop-shadow(0 0 60px #22c55e) drop-shadow(0 0 90px #16a34a); animation: grass-spin 0.3s infinite linear; }
  @keyframes grass-spin { from { transform: rotate(0deg) scale(1.3); } to { transform: rotate(360deg) scale(1.3); filter: drop-shadow(0 0 40px #4ade80) brightness(1.3); } }

  /* Electric */
  .proj-inner.type-electric { filter: drop-shadow(0 0 30px #ffff00) drop-shadow(0 0 60px #ffd700) drop-shadow(0 0 90px #eab308); animation: electric-flash 0.1s infinite alternate; }
  @keyframes electric-flash { from { transform: scale(0.9) skewX(-15deg); filter: drop-shadow(0 0 10px #ff0); } to { transform: scale(1.6) skewX(15deg); filter: drop-shadow(0 0 50px #fff) brightness(2); } }

  /* Ice */
  .proj-inner.type-ice { filter: drop-shadow(0 0 30px #38bdf8) drop-shadow(0 0 60px #0ea5e9) drop-shadow(0 0 90px #0284c7); animation: ice-spin 0.4s infinite linear; }
  @keyframes ice-spin { from { transform: rotate(0deg) scale(1.2); } to { transform: rotate(360deg) scale(1.2); filter: drop-shadow(0 0 50px #7dd3fc) brightness(1.5); } }

  /* Fighting */
  .proj-inner.type-fighting { filter: drop-shadow(0 0 30px #ea580c) drop-shadow(0 0 60px #c2410c) drop-shadow(0 0 90px #9a3412); animation: fighting-punch 0.2s infinite alternate; }
  @keyframes fighting-punch { from { transform: scale(1) translateX(-10px) rotate(-10deg); } to { transform: scale(1.5) translateX(20px) rotate(10deg); filter: drop-shadow(0 0 50px #f97316) brightness(1.3); } }

  /* Poison */
  .proj-inner.type-poison { filter: drop-shadow(0 0 30px #9333ea) drop-shadow(0 0 60px #7e22ce) drop-shadow(0 0 90px #6b21a8); animation: poison-bubble 0.4s infinite alternate; }
  @keyframes poison-bubble { from { transform: scale(0.9) rotate(-15deg); } to { transform: scale(1.4) rotate(15deg); filter: drop-shadow(0 0 50px #a855f7) brightness(1.4); } }

  /* Ground */
  .proj-inner.type-ground { filter: drop-shadow(0 0 30px #b45309) drop-shadow(0 0 60px #92400e) drop-shadow(0 0 90px #78350f); animation: ground-shake 0.1s infinite alternate; }
  @keyframes ground-shake { from { transform: translateY(-5px) rotate(-10deg) scale(1.1); } to { transform: translateY(5px) rotate(10deg) scale(1.3); filter: drop-shadow(0 0 40px #d97706) brightness(1.2); } }

  /* Flying */
  .proj-inner.type-flying { filter: drop-shadow(0 0 30px #818cf8) drop-shadow(0 0 60px #6366f1) drop-shadow(0 0 90px #4f46e5); animation: flying-swoop 0.4s infinite alternate; }
  @keyframes flying-swoop { from { transform: translateY(-20px) rotate(-20deg) scale(1); } to { transform: translateY(20px) rotate(20deg) scale(1.4); filter: drop-shadow(0 0 50px #a5b4fc) brightness(1.5); } }

  /* Psychic */
  .proj-inner.type-psychic { filter: drop-shadow(0 0 30px #f43f5e) drop-shadow(0 0 60px #e11d48) drop-shadow(0 0 90px #be123c); animation: psychic-float 0.3s infinite alternate; }
  @keyframes psychic-float { from { transform: scale(0.9) rotate(0deg); opacity: 0.8; } to { transform: scale(1.5) rotate(180deg); filter: drop-shadow(0 0 50px #fda4af) brightness(1.6); opacity: 1; } }

  /* Bug */
  .proj-inner.type-bug { filter: drop-shadow(0 0 30px #84cc16) drop-shadow(0 0 60px #65a30d) drop-shadow(0 0 90px #4d7c0f); animation: bug-flutter 0.1s infinite alternate; }
  @keyframes bug-flutter { from { transform: translateY(-10px) scaleY(0.8) scaleX(1.2); } to { transform: translateY(10px) scaleY(1.3) scaleX(0.9); filter: drop-shadow(0 0 40px #a3e635) brightness(1.4); } }

  /* Rock */
  .proj-inner.type-rock { filter: drop-shadow(0 0 30px #78716c) drop-shadow(0 0 60px #57534e) drop-shadow(0 0 90px #44403c); animation: rock-tumble 0.5s infinite linear; }
  @keyframes rock-tumble { from { transform: rotate(0deg) scale(1.1); } to { transform: rotate(360deg) scale(1.1); filter: drop-shadow(0 0 40px #a8a29e) brightness(1.2); } }

  /* Ghost */
  .proj-inner.type-ghost { filter: drop-shadow(0 0 40px #6366f1) drop-shadow(0 0 80px #4f46e5) drop-shadow(0 0 120px #3730a3) opacity(0.8); animation: ghost-fade 0.5s infinite alternate; }
  @keyframes ghost-fade { from { transform: scale(1) translateY(10px); opacity: 0.5; } to { transform: scale(1.6) translateY(-20px); filter: drop-shadow(0 0 60px #818cf8) brightness(1.7); opacity: 1; } }

  /* Dragon */
  .proj-inner.type-dragon { filter: drop-shadow(0 0 30px #3b82f6) drop-shadow(0 0 60px #f59e0b) drop-shadow(0 0 90px #d97706); animation: dragon-roar 0.3s infinite alternate; }
  @keyframes dragon-roar { from { transform: scale(1) rotate(-15deg); filter: drop-shadow(0 0 20px #3b82f6); } to { transform: scale(1.5) rotate(15deg); filter: drop-shadow(0 0 60px #f59e0b) brightness(1.8); } }

  /* Dark */
  .proj-inner.type-dark { filter: drop-shadow(0 0 30px #4b0082) drop-shadow(0 0 60px #312e81) drop-shadow(0 0 90px #1e1b4b) brightness(0.6); animation: dark-pulse 0.3s infinite alternate; }
  @keyframes dark-pulse { from { transform: scale(0.9) rotate(-15deg); } to { transform: scale(1.5) rotate(15deg); filter: drop-shadow(0 0 60px #8a2be2) brightness(1.4); } }

  /* Steel */
  .proj-inner.type-steel { filter: drop-shadow(0 0 30px #94a3b8) drop-shadow(0 0 60px #64748b) drop-shadow(0 0 90px #475569); animation: steel-shine 0.2s infinite alternate; }
  @keyframes steel-shine { from { transform: scale(1) skewX(-15deg); filter: brightness(0.8); } to { transform: scale(1.4) skewX(15deg); filter: drop-shadow(0 0 50px #cbd5e1) brightness(2.2); } }

  /* Fairy */
  .proj-inner.type-fairy { filter: drop-shadow(0 0 30px #ff69b4) drop-shadow(0 0 60px #ff1493) drop-shadow(0 0 90px #be185d); animation: fairy-sparkle 0.2s infinite alternate; }
  @keyframes fairy-sparkle { from { transform: scale(1) rotate(-20deg); filter: drop-shadow(0 0 15px #ff69b4); opacity: 0.8; } to { transform: scale(1.5) rotate(20deg); filter: drop-shadow(0 0 50px #ff1493) brightness(1.8); opacity: 1; } }

  /* Normal */
  .proj-inner.type-normal { filter: drop-shadow(0 0 30px #d1d5db) drop-shadow(0 0 60px #9ca3af) drop-shadow(0 0 90px #6b7280); animation: normal-bounce 0.3s infinite alternate; }
  @keyframes normal-bounce { from { transform: translateY(-10px) scale(1); } to { transform: translateY(10px) scale(1.3); filter: drop-shadow(0 0 40px #fff) brightness(1.5); } }
`;

// Find where /* Fire */ starts and where the last keyframes ends
const startIndex = css.indexOf('/* Fire */');
let endIndex = css.indexOf('/* Death Animation */');

if (startIndex !== -1 && endIndex !== -1) {
  css = css.substring(0, startIndex) + premiumEmojiCss + '\n' + css.substring(endIndex);
  fs.writeFileSync('style.css', css, 'utf8');
  console.log('Successfully injected massive premium emoji glows for all 18 types.');
} else {
  console.log('Failed to find start or end index.', startIndex, endIndex);
}
