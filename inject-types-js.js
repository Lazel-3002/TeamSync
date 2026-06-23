const fs = require('fs');

let pokeJs = fs.readFileSync('js/poke.js', 'utf8');

const newTypeChart = `const typeChart = {
  normal: { normal: 1, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 1, rock: 0.5, ghost: 0, dragon: 1, dark: 1, steel: 0.5, fairy: 1 },
  fire: { normal: 1, fire: 0.5, water: 0.5, electric: 1, grass: 2, ice: 2, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 2, rock: 0.5, ghost: 1, dragon: 0.5, dark: 1, steel: 2, fairy: 1 },
  water: { normal: 1, fire: 2, water: 0.5, electric: 1, grass: 0.5, ice: 1, fighting: 1, poison: 1, ground: 2, flying: 1, psychic: 1, bug: 1, rock: 2, ghost: 1, dragon: 0.5, dark: 1, steel: 1, fairy: 1 },
  electric: { normal: 1, fire: 1, water: 2, electric: 0.5, grass: 0.5, ice: 1, fighting: 1, poison: 1, ground: 0, flying: 2, psychic: 1, bug: 1, rock: 1, ghost: 1, dragon: 0.5, dark: 1, steel: 1, fairy: 1 },
  grass: { normal: 1, fire: 0.5, water: 2, electric: 1, grass: 0.5, ice: 1, fighting: 1, poison: 0.5, ground: 2, flying: 0.5, psychic: 1, bug: 0.5, rock: 2, ghost: 1, dragon: 0.5, dark: 1, steel: 0.5, fairy: 1 },
  ice: { normal: 1, fire: 0.5, water: 0.5, electric: 1, grass: 2, ice: 0.5, fighting: 1, poison: 1, ground: 2, flying: 2, psychic: 1, bug: 1, rock: 1, ghost: 1, dragon: 2, dark: 1, steel: 0.5, fairy: 1 },
  fighting: { normal: 2, fire: 1, water: 1, electric: 1, grass: 1, ice: 2, fighting: 1, poison: 0.5, ground: 1, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dragon: 1, dark: 2, steel: 2, fairy: 0.5 },
  poison: { normal: 1, fire: 1, water: 1, electric: 1, grass: 2, ice: 1, fighting: 1, poison: 0.5, ground: 0.5, flying: 1, psychic: 1, bug: 1, rock: 0.5, ghost: 0.5, dragon: 1, dark: 1, steel: 0, fairy: 2 },
  ground: { normal: 1, fire: 2, water: 1, electric: 2, grass: 0.5, ice: 1, fighting: 1, poison: 2, ground: 1, flying: 0, psychic: 1, bug: 0.5, rock: 2, ghost: 1, dragon: 1, dark: 1, steel: 2, fairy: 1 },
  flying: { normal: 1, fire: 1, water: 1, electric: 0.5, grass: 2, ice: 1, fighting: 2, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 2, rock: 0.5, ghost: 1, dragon: 1, dark: 1, steel: 0.5, fairy: 1 },
  psychic: { normal: 1, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 2, poison: 2, ground: 1, flying: 1, psychic: 0.5, bug: 1, rock: 1, ghost: 1, dragon: 1, dark: 0, steel: 0.5, fairy: 1 },
  bug: { normal: 1, fire: 0.5, water: 1, electric: 1, grass: 2, ice: 1, fighting: 0.5, poison: 0.5, ground: 1, flying: 0.5, psychic: 2, bug: 1, rock: 1, ghost: 0.5, dragon: 1, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { normal: 1, fire: 2, water: 1, electric: 1, grass: 1, ice: 2, fighting: 0.5, poison: 1, ground: 0.5, flying: 2, psychic: 1, bug: 2, rock: 1, ghost: 1, dragon: 1, dark: 1, steel: 0.5, fairy: 1 },
  ghost: { normal: 0, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 2, bug: 1, rock: 1, ghost: 2, dragon: 1, dark: 0.5, steel: 1, fairy: 1 },
  dragon: { normal: 1, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 1, rock: 1, ghost: 1, dragon: 2, dark: 1, steel: 0.5, fairy: 0 },
  dark: { normal: 1, fire: 1, water: 1, electric: 1, grass: 1, ice: 1, fighting: 0.5, poison: 1, ground: 1, flying: 1, psychic: 2, bug: 1, rock: 1, ghost: 2, dragon: 1, dark: 0.5, steel: 1, fairy: 0.5 },
  steel: { normal: 1, fire: 0.5, water: 0.5, electric: 0.5, grass: 1, ice: 2, fighting: 1, poison: 1, ground: 1, flying: 1, psychic: 1, bug: 1, rock: 2, ghost: 1, dragon: 1, dark: 1, steel: 0.5, fairy: 2 },
  fairy: { normal: 1, fire: 0.5, water: 1, electric: 1, grass: 1, ice: 1, fighting: 2, poison: 0.5, ground: 1, flying: 1, psychic: 1, bug: 1, rock: 1, ghost: 1, dragon: 2, dark: 2, steel: 0.5, fairy: 1 }
};`;

const newTypeEmojis = `const TYPE_EMOJIS = {
  normal: '⚪', fire: '🔥', water: '💧', electric: '⚡', grass: '🌿',
  ice: '❄️', fighting: '🥊', poison: '☠️', ground: '🏜️', flying: '🦅',
  psychic: '🧠', bug: '🐛', rock: '🪨', ghost: '👻', dragon: '🐉',
  dark: '🌑', steel: '⚙️', fairy: '✨'
};`;

const newPokemons = `const POKEMONS = {
  normal: ['https://play.pokemonshowdown.com/sprites/ani/snorlax.gif', 'https://play.pokemonshowdown.com/sprites/ani/eevee.gif', 'https://play.pokemonshowdown.com/sprites/ani/porygon-z.gif'],
  fire: ['https://play.pokemonshowdown.com/sprites/ani/charizard.gif', 'https://play.pokemonshowdown.com/sprites/ani/blaziken.gif', 'https://play.pokemonshowdown.com/sprites/ani/infernape.gif'],
  water: ['https://play.pokemonshowdown.com/sprites/ani/blastoise.gif', 'https://play.pokemonshowdown.com/sprites/ani/greninja.gif', 'https://play.pokemonshowdown.com/sprites/ani/gyarados.gif'],
  grass: ['https://play.pokemonshowdown.com/sprites/ani/venusaur.gif', 'https://play.pokemonshowdown.com/sprites/ani/sceptile.gif', 'https://play.pokemonshowdown.com/sprites/ani/decidueye.gif'],
  electric: ['https://play.pokemonshowdown.com/sprites/ani/pikachu.gif', 'https://play.pokemonshowdown.com/sprites/ani/raichu.gif', 'https://play.pokemonshowdown.com/sprites/ani/electivire.gif'],
  ice: ['https://play.pokemonshowdown.com/sprites/ani/articuno.gif', 'https://play.pokemonshowdown.com/sprites/ani/lapras.gif', 'https://play.pokemonshowdown.com/sprites/ani/weavile.gif'],
  fighting: ['https://play.pokemonshowdown.com/sprites/ani/machamp.gif', 'https://play.pokemonshowdown.com/sprites/ani/lucario.gif', 'https://play.pokemonshowdown.com/sprites/ani/hawlucha.gif'],
  poison: ['https://play.pokemonshowdown.com/sprites/ani/gengar.gif', 'https://play.pokemonshowdown.com/sprites/ani/crobat.gif', 'https://play.pokemonshowdown.com/sprites/ani/toxtricity.gif'],
  ground: ['https://play.pokemonshowdown.com/sprites/ani/garchomp.gif', 'https://play.pokemonshowdown.com/sprites/ani/excadrill.gif', 'https://play.pokemonshowdown.com/sprites/ani/krookodile.gif'],
  flying: ['https://play.pokemonshowdown.com/sprites/ani/pidgeot.gif', 'https://play.pokemonshowdown.com/sprites/ani/corviknight.gif', 'https://play.pokemonshowdown.com/sprites/ani/talonflame.gif'],
  psychic: ['https://play.pokemonshowdown.com/sprites/ani/mewtwo.gif', 'https://play.pokemonshowdown.com/sprites/ani/alakazam.gif', 'https://play.pokemonshowdown.com/sprites/ani/gardevoir.gif'],
  bug: ['https://play.pokemonshowdown.com/sprites/ani/scizor.gif', 'https://play.pokemonshowdown.com/sprites/ani/volcarona.gif', 'https://play.pokemonshowdown.com/sprites/ani/heracross.gif'],
  rock: ['https://play.pokemonshowdown.com/sprites/ani/tyranitar.gif', 'https://play.pokemonshowdown.com/sprites/ani/aerodactyl.gif', 'https://play.pokemonshowdown.com/sprites/ani/golem.gif'],
  ghost: ['https://play.pokemonshowdown.com/sprites/ani/gengar.gif', 'https://play.pokemonshowdown.com/sprites/ani/chandelure.gif', 'https://play.pokemonshowdown.com/sprites/ani/mimikyu.gif'],
  dragon: ['https://play.pokemonshowdown.com/sprites/ani/dragonite.gif', 'https://play.pokemonshowdown.com/sprites/ani/salamence.gif', 'https://play.pokemonshowdown.com/sprites/ani/rayquaza.gif'],
  dark: ['https://play.pokemonshowdown.com/sprites/ani/umbreon.gif', 'https://play.pokemonshowdown.com/sprites/ani/darkrai.gif', 'https://play.pokemonshowdown.com/sprites/ani/hydreigon.gif'],
  steel: ['https://play.pokemonshowdown.com/sprites/ani/metagross.gif', 'https://play.pokemonshowdown.com/sprites/ani/lucario.gif', 'https://play.pokemonshowdown.com/sprites/ani/aegislash.gif'],
  fairy: ['https://play.pokemonshowdown.com/sprites/ani/sylveon.gif', 'https://play.pokemonshowdown.com/sprites/ani/togekiss.gif', 'https://play.pokemonshowdown.com/sprites/ani/mimikyu.gif']
};`;

pokeJs = pokeJs.replace(/const typeChart = \{[\s\S]*?\};\s*(?=const POKEMONS)/, newTypeChart + "\\n\\n");
pokeJs = pokeJs.replace(/const POKEMONS = \{[\s\S]*?\};/, newPokemons);
pokeJs = pokeJs.replace(/const TYPE_EMOJIS = \{[\s\S]*?\};/, newTypeEmojis);

fs.writeFileSync('js/poke.js', pokeJs, 'utf8');
console.log('Injected 18 types into js/poke.js');
