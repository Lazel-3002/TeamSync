const fs = require('fs');
const https = require('https');

const fetchJson = (url) => new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode !== 200) {
            reject(new Error(`Request Failed. Status Code: ${res.statusCode} for ${url}`));
            return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
    }).on('error', reject);
});

async function run() {
    console.log("Fetching all evolution chains directly...");
    // There are about 550 evolution chains total
    const chainsRes = await fetchJson('https://pokeapi.co/api/v2/evolution-chain?limit=600');
    
    console.log(`Found ${chainsRes.results.length} evolution chains. Fetching details...`);
    const chains = [];
    // Fetch in small batches to respect rate limits
    for (let i = 0; i < chainsRes.results.length; i += 10) {
        const batch = chainsRes.results.slice(i, i + 10);
        await Promise.all(batch.map(async (c) => {
            try {
                const data = await fetchJson(c.url);
                chains.push(data.chain);
            } catch (e) {
                console.log("Error fetching chain: " + c.url, e.message);
            }
        }));
        process.stdout.write(`.` + (i + 10) + `.`);
    }

    console.log("\nProcessing families...");
    const families = [];
    
    function extractEvolutions(chainNode) {
        let evos = [chainNode.species.name];
        if (chainNode.evolves_to && chainNode.evolves_to.length > 0) {
            for (let next of chainNode.evolves_to) {
                evos = evos.concat(extractEvolutions(next));
            }
        }
        return evos;
    }

    // Now we need types and ids for the base pokemons.
    // We can fetch all pokemon species at once to get IDs easily.
    console.log("Fetching all species to get IDs...");
    const speciesRes = await fetchJson('https://pokeapi.co/api/v2/pokemon-species?limit=1500');
    const speciesList = speciesRes.results;
    const speciesMap = new Map();
    speciesList.forEach(s => {
        // extract ID from url: https://pokeapi.co/api/v2/pokemon-species/1/
        const parts = s.url.split('/');
        const id = parseInt(parts[parts.length - 2]);
        speciesMap.set(s.name, id);
    });

    console.log("Fetching real Pokemon types...");
    const typeMap = new Map();
    const pokemonApiNameMap = new Map();
    const allSpeciesNames = [...new Set(chains.flatMap(chain => extractEvolutions(chain)))];
    const allSpecies = allSpeciesNames
        .map(name => ({ name, id: speciesMap.get(name) }))
        .filter(species => Number.isFinite(species.id) && species.id <= 1500);

    for (let i = 0; i < allSpecies.length; i += 20) {
        const batch = allSpecies.slice(i, i + 20);
        await Promise.all(batch.map(async species => {
            try {
                // National Pokedex species IDs match the default Pokemon entries.
                // Fetching by ID also works for species whose API form name differs
                // (for example giratina-altered or tornadus-incarnate).
                const pokemon = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${species.id}`);
                const types = (pokemon.types || [])
                    .sort((a, b) => a.slot - b.slot)
                    .map(entry => entry.type.name);
                typeMap.set(species.name, types.length ? types : ['normal']);
                pokemonApiNameMap.set(species.name, pokemon.name || species.name);
            } catch (e) {
                console.log(`Type fetch failed for ${species.name}:`, e.message);
                typeMap.set(species.name, ['normal']);
                pokemonApiNameMap.set(species.name, species.name);
            }
        }));
        process.stdout.write(`.` + Math.min(i + 20, allSpecies.length) + `.`);
    }

    for (let chain of chains) {
        const baseName = chain.species.name;
        
        let allEvos = [...new Set(extractEvolutions(chain))];
        let id = speciesMap.get(baseName) || 9999;
        
        // Skip extremely weird forms or missing IDs if any, but we keep mostly everything
        if (id > 1500) continue; 
        
        const evolutions = [];
        for (let evoName of allEvos) {
            const displayName = evoName.charAt(0).toUpperCase() + evoName.slice(1);
            const cleanName = evoName.replace(/-/g, '');
            const evoTypes = typeMap.get(evoName) || ['normal'];
            evolutions.push({
                id: speciesMap.get(evoName) || null,
                name: displayName,
                apiName: pokemonApiNameMap.get(evoName) || evoName,
                type: evoTypes[0],
                types: evoTypes,
                url: `https://play.pokemonshowdown.com/sprites/ani/${cleanName}.gif`
            });
        }
        
        const types = typeMap.get(baseName) || ['normal'];
        families.push({
            id: id,
            baseName: baseName,
            displayName: baseName.charAt(0).toUpperCase() + baseName.slice(1),
            type: types[0],
            types,
            hp: 200, 
            evolutions: evolutions
        });
    }
    
    // Add Mega X and Y for Charizard and Mewtwo
    const charizardFam = families.find(f => f.baseName === 'charmander');
    if (charizardFam) {
        charizardFam.evolutions.push({ name: 'Mega Charizard X', apiName: 'charizard-mega-x', type: 'fire', types: ['fire', 'dragon'], url: 'https://play.pokemonshowdown.com/sprites/ani/charizardmegax.gif' });
        charizardFam.evolutions.push({ name: 'Mega Charizard Y', apiName: 'charizard-mega-y', type: 'fire', types: ['fire', 'flying'], url: 'https://play.pokemonshowdown.com/sprites/ani/charizardmegay.gif' });
    }
    const mewtwoFam = families.find(f => f.baseName === 'mewtwo');
    if (mewtwoFam) {
        mewtwoFam.evolutions.push({ name: 'Mega Mewtwo X', apiName: 'mewtwo-mega-x', type: 'psychic', types: ['psychic', 'fighting'], url: 'https://play.pokemonshowdown.com/sprites/ani/mewtwomegax.gif' });
        mewtwoFam.evolutions.push({ name: 'Mega Mewtwo Y', apiName: 'mewtwo-mega-y', type: 'psychic', types: ['psychic'], url: 'https://play.pokemonshowdown.com/sprites/ani/mewtwomegay.gif' });
    }

    families.sort((a,b) => a.id - b.id);
    
    console.log(`Generated ${families.length} families.`);
    const output = `// pokeData.js
// Auto-generated ALL Pokemon evolution families (Gen 1 to Gen 9+)
window.POKEMON_FAMILIES = ${JSON.stringify(families, null, 2)};
`;
    fs.writeFileSync('js/pokeData.js', output);
    console.log("Written to js/pokeData.js");
}

run().catch(console.error);
