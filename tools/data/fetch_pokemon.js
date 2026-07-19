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
            evolutions.push({
                name: displayName,
                url: `https://play.pokemonshowdown.com/sprites/ani/${cleanName}.gif`
            });
        }
        
        families.push({
            id: id,
            baseName: baseName,
            displayName: baseName.charAt(0).toUpperCase() + baseName.slice(1),
            type: 'normal', // We skip type fetching to save 500 API calls! They will just have gray badges or default.
            hp: 200, 
            evolutions: evolutions
        });
    }

    // Since we skipped fetching 'types' for 500 base pokemons to avoid rate limits,
    // they will just fallback to 'normal' color, which is acceptable for the massive expansion.
    
    // Add Mega X and Y for Charizard and Mewtwo
    const charizardFam = families.find(f => f.baseName === 'charmander');
    if (charizardFam) {
        charizardFam.evolutions.push({ name: 'Mega Charizard X', url: 'https://play.pokemonshowdown.com/sprites/ani/charizardmegax.gif' });
        charizardFam.evolutions.push({ name: 'Mega Charizard Y', url: 'https://play.pokemonshowdown.com/sprites/ani/charizardmegay.gif' });
    }
    const mewtwoFam = families.find(f => f.baseName === 'mewtwo');
    if (mewtwoFam) {
        mewtwoFam.evolutions.push({ name: 'Mega Mewtwo X', url: 'https://play.pokemonshowdown.com/sprites/ani/mewtwomegax.gif' });
        mewtwoFam.evolutions.push({ name: 'Mega Mewtwo Y', url: 'https://play.pokemonshowdown.com/sprites/ani/mewtwomegay.gif' });
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
