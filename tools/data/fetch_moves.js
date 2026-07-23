const fs = require('fs');
const https = require('https');

const fetchJson = (url) => new Promise((resolve, reject) => {
  https.get(url, { headers: { 'User-Agent': 'TeamSync-PokeData/1.0' } }, (res) => {
    if (res.statusCode !== 200) {
      reject(new Error(`Request failed (${res.statusCode}): ${url}`));
      return;
    }
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  }).on('error', reject);
});

const cleanEffectText = (text, effectChance) => String(text || '')
  .replace(/\$effect_chance/g, effectChance ?? '?')
  .replace(/\s+/g, ' ')
  .trim();

async function run() {
  console.log('Fetching canonical Pokemon move list...');
  const list = await fetchJson('https://pokeapi.co/api/v2/move?limit=2000');
  const moves = {};

  for (let index = 0; index < list.results.length; index += 25) {
    const batch = list.results.slice(index, index + 25);
    await Promise.all(batch.map(async entry => {
      const move = await fetchJson(entry.url);
      const meta = move.meta || {};
      const effectEntry = (move.effect_entries || []).find(item => item.language?.name === 'en');
      moves[move.name] = {
        type: move.type?.name || 'normal',
        power: move.power || 0,
        accuracy: move.accuracy,
        pp: move.pp,
        priority: move.priority || 0,
        damage_class: move.damage_class?.name || 'status',
        target: move.target?.name || 'selected-pokemon',
        healing: meta.healing || 0,
        drain: meta.drain || 0,
        crit_rate: meta.crit_rate || 0,
        flinch_chance: meta.flinch_chance || 0,
        stat_chance: meta.stat_chance || 0,
        ailment: meta.ailment?.name || 'none',
        ailment_chance: meta.ailment_chance || 0,
        min_hits: meta.min_hits,
        max_hits: meta.max_hits,
        category: meta.category?.name || 'damage',
        stat_changes: (move.stat_changes || []).map(change => ({
          change: change.change,
          stat: change.stat?.name
        })),
        description: cleanEffectText(effectEntry?.short_effect, move.effect_chance)
      };
    }));
    process.stdout.write(`.${Math.min(index + 25, list.results.length)}`);
  }

  const ordered = Object.fromEntries(Object.entries(moves).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(
    'js/movesData.js',
    `// Auto-generated from PokeAPI move data. Run: node tools/data/fetch_moves.js\nwindow.POKEMON_MOVES = ${JSON.stringify(ordered, null, 2)};\n`
  );
  console.log(`\nWritten ${Object.keys(ordered).length} moves to js/movesData.js`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
