const fs = require('fs');
const path = './js/pokeData.js';

let data = fs.readFileSync(path, 'utf-8');
const jsonStr = data.substring(data.indexOf('['), data.lastIndexOf(']') + 1);
const families = JSON.parse(jsonStr);

const formsToAdd = {
    'venusaur': [{ name: 'Mega Venusaur', url: 'venusaur-mega' }],
    'charmander': [{ name: 'Mega Charizard X', url: 'charizard-megax' }, { name: 'Mega Charizard Y', url: 'charizard-megay' }],
    'squirtle': [{ name: 'Mega Blastoise', url: 'blastoise-mega' }],
    'weedle': [{ name: 'Mega Beedrill', url: 'beedrill-mega' }],
    'pidgey': [{ name: 'Mega Pidgeot', url: 'pidgeot-mega' }],
    'abra': [{ name: 'Mega Alakazam', url: 'alakazam-mega' }],
    'slowpoke': [{ name: 'Mega Slowbro', url: 'slowbro-mega' }],
    'gastly': [{ name: 'Mega Gengar', url: 'gengar-mega' }],
    'kangaskhan': [{ name: 'Mega Kangaskhan', url: 'kangaskhan-mega' }],
    'pinsir': [{ name: 'Mega Pinsir', url: 'pinsir-mega' }],
    'magikarp': [{ name: 'Mega Gyarados', url: 'gyarados-mega' }],
    'aerodactyl': [{ name: 'Mega Aerodactyl', url: 'aerodactyl-mega' }],
    'mewtwo': [{ name: 'Mega Mewtwo X', url: 'mewtwo-megax' }, { name: 'Mega Mewtwo Y', url: 'mewtwo-megay' }],
    'mareep': [{ name: 'Mega Ampharos', url: 'ampharos-mega' }],
    'onix': [{ name: 'Mega Steelix', url: 'steelix-mega' }],
    'scyther': [{ name: 'Mega Scizor', url: 'scizor-mega' }],
    'heracross': [{ name: 'Mega Heracross', url: 'heracross-mega' }],
    'houndour': [{ name: 'Mega Houndoom', url: 'houndoom-mega' }],
    'larvitar': [{ name: 'Mega Tyranitar', url: 'tyranitar-mega' }],
    'treecko': [{ name: 'Mega Sceptile', url: 'sceptile-mega' }],
    'torchic': [{ name: 'Mega Blaziken', url: 'blaziken-mega' }],
    'mudkip': [{ name: 'Mega Swampert', url: 'swampert-mega' }],
    'ralts': [{ name: 'Mega Gardevoir', url: 'gardevoir-mega' }, { name: 'Mega Gallade', url: 'gallade-mega' }],
    'sableye': [{ name: 'Mega Sableye', url: 'sableye-mega' }],
    'mawile': [{ name: 'Mega Mawile', url: 'mawile-mega' }],
    'aron': [{ name: 'Mega Aggron', url: 'aggron-mega' }],
    'meditite': [{ name: 'Mega Medicham', url: 'medicham-mega' }],
    'electrike': [{ name: 'Mega Manectric', url: 'manectric-mega' }],
    'carvanha': [{ name: 'Mega Sharpedo', url: 'sharpedo-mega' }],
    'numel': [{ name: 'Mega Camerupt', url: 'camerupt-mega' }],
    'swablu': [{ name: 'Mega Altaria', url: 'altaria-mega' }],
    'shuppet': [{ name: 'Mega Banette', url: 'banette-mega' }],
    'absol': [{ name: 'Mega Absol', url: 'absol-mega' }],
    'snorunt': [{ name: 'Mega Glalie', url: 'glalie-mega' }],
    'bagon': [{ name: 'Mega Salamence', url: 'salamence-mega' }],
    'beldum': [{ name: 'Mega Metagross', url: 'metagross-mega' }],
    'latias': [{ name: 'Mega Latias', url: 'latias-mega' }],
    'latios': [{ name: 'Mega Latios', url: 'latios-mega' }],
    'rayquaza': [{ name: 'Mega Rayquaza', url: 'rayquaza-mega' }],
    'buneary': [{ name: 'Mega Lopunny', url: 'lopunny-mega' }],
    'gible': [{ name: 'Mega Garchomp', url: 'garchomp-mega' }],
    'riolu': [{ name: 'Mega Lucario', url: 'lucario-mega' }],
    'snover': [{ name: 'Mega Abomasnow', url: 'abomasnow-mega' }],
    'audino': [{ name: 'Mega Audino', url: 'audino-mega' }],
    'diancie': [{ name: 'Mega Diancie', url: 'diancie-mega' }],
    'groudon': [{ name: 'Primal Groudon', url: 'groudon-primal' }],
    'kyogre': [{ name: 'Primal Kyogre', url: 'kyogre-primal' }]
};

for (const fam of families) {
    if (formsToAdd[fam.baseName]) {
        // filter out any previously bad hardcoded megas to avoid duplicates
        fam.evolutions = fam.evolutions.filter(e => !e.name.includes('Mega Charizard') && !e.name.includes('Mega Mewtwo'));
        for (const f of formsToAdd[fam.baseName]) {
            fam.evolutions.push({ name: f.name, url: `https://play.pokemonshowdown.com/sprites/ani/${f.url}.gif` });
        }
    }
}

const output = `// pokeData.js
// Auto-generated ALL Pokemon evolution families (Gen 1 to Gen 9+)
window.POKEMON_FAMILIES = ${JSON.stringify(families, null, 2)};
`;
fs.writeFileSync(path, output);
console.log("Megas injected into pokeData.js successfully!");
