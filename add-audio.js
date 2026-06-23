const fs = require('fs');

let pokeJs = fs.readFileSync('js/poke.js', 'utf8');

// 1. Add playPokemonCry helper
const audioHelper = `
  const playPokemonCry = (pokemonUrl) => {
    try {
      if (!pokemonUrl) return;
      const parts = pokemonUrl.split('/');
      let name = parts[parts.length - 1].replace('.gif', '').toLowerCase();
      name = name.split('-')[0]; // Strip form suffixes just in case
      const audio = new Audio('https://play.pokemonshowdown.com/audio/cries/' + name + '.mp3');
      audio.volume = 0.6;
      audio.play().catch(e => console.log('Audio play blocked:', e));
    } catch(e) {}
  };
`;

if (!pokeJs.includes('playPokemonCry')) {
  pokeJs = pokeJs.replace(/const playBattleAnimation = \(\) => \{/, audioHelper + '\\n  const playBattleAnimation = () => {');
}

// 2. Fix P1 Lunge & Audio
pokeJs = pokeJs.replace(/p1Img\.classList\.add\('anim-lunge-p1'\);\s*proj\.textContent = [^;]+;\s*proj\.className = [^;]+;/, `p1Img.classList.add('anim-lunge-p1');
        playPokemonCry(pokeState.p1.pokemon);
        proj.innerHTML = '<span class="proj-inner type-' + pokeState.p1.type + '">' + (TYPE_EMOJIS[pokeState.p1.type] || '💥') + '</span>';
        proj.className = 'anim-proj-p1';`);

// 3. Fix P2 Lunge & Audio
pokeJs = pokeJs.replace(/p2Img\.classList\.add\('anim-lunge-p2'\);\s*proj\.textContent = [^;]+;\s*proj\.className = [^;]+;/, `p2Img.classList.add('anim-lunge-p2');
        playPokemonCry(pokeState.p2.pokemon);
        proj.innerHTML = '<span class="proj-inner type-' + pokeState.p2.type + '">' + (TYPE_EMOJIS[pokeState.p2.type] || '💥') + '</span>';
        proj.className = 'anim-proj-p2';`);

// 4. Clean up any weird Type_EMOJIS if they got corrupted again. We just let them be, we injected emojis recently.

fs.writeFileSync('js/poke.js', pokeJs, 'utf8');
console.log('Added Audio and fixed innerHTML in js/poke.js');
