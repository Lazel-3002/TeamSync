const fs = require('fs');
const https = require('https');

// PokeAPI models Meltan and Melmetal as two separate one-node chains because
// Meltan evolves through Pokemon GO Candy instead of a main-series trigger.
// Keep exceptional links explicit and auditable instead of hiding them in UI code.
const SPECIAL_EVOLUTION_LINKS = new Map([
  ['meltan', ['melmetal']]
]);

// Species varieties contain both meaningful battle forms and pure cosmetics.
// These variants do not represent a distinct playable form and would only flood
// the selection UI with duplicate cards.
const HIDDEN_VARIETY_PATTERNS = [
  /-totem(?:-|$)/,
  /^pikachu-(?:rock-star|belle|pop-star|phd|libre|cosplay|starter|(?:original|hoenn|sinnoh|unova|kalos|alola|partner|world)-cap)$/,
  /^eevee-starter$/,
  /^koraidon-(?:limited-build|sprinting-build|swimming-build|gliding-build)$/,
  /^miraidon-(?:low-power-mode|drive-mode|aquatic-mode|glide-mode)$/,
  /^magearna-original(?:-|$)/,
  /^zarude-dada$/,
  /^minior-(?:orange|yellow|green|blue|indigo|violet)(?:-meteor)?$/
];

const fetchJson = (url, attempts = 3) => new Promise((resolve, reject) => {
  const request = () => {
    https.get(url, { headers: { 'User-Agent': 'TeamSync-PokeData/2.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        if (attempts > 1) {
          setTimeout(() => fetchJson(url, attempts - 1).then(resolve, reject), 250);
        } else {
          reject(new Error(`Request failed (${res.statusCode}): ${url}`));
        }
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
    }).on('error', error => {
      if (attempts > 1) {
        setTimeout(() => fetchJson(url, attempts - 1).then(resolve, reject), 250);
      } else {
        reject(error);
      }
    });
  };
  request();
});

const resourceId = (url) => {
  const parts = String(url || '').split('/').filter(Boolean);
  return Number(parts[parts.length - 1]) || null;
};

const titleCase = (value) => String(value || '')
  .split('-')
  .filter(Boolean)
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const formatVarietyName = (apiName, speciesName) => {
  const speciesLabel = titleCase(speciesName);
  const suffix = apiName.startsWith(`${speciesName}-`)
    ? apiName.slice(speciesName.length + 1)
    : apiName;

  if (suffix === apiName && apiName === speciesName) return speciesLabel;
  if (suffix === 'mega') return `Mega ${speciesLabel}`;
  if (/^mega-[xyz]$/.test(suffix)) return `Mega ${speciesLabel} ${suffix.slice(-1).toUpperCase()}`;
  if (suffix === 'primal') return `Primal ${speciesLabel}`;
  if (suffix === 'gmax') return `Gigantamax ${speciesLabel}`;
  return `${speciesLabel} ${titleCase(suffix)}`;
};

const showdownSpriteName = (apiName, speciesName) => {
  const cleanSpecies = speciesName.replace(/-/g, '');
  let suffix = apiName.startsWith(speciesName) ? apiName.slice(speciesName.length) : '';
  suffix = suffix.replace(/-mega-([xyz])$/, '-mega$1');
  return suffix ? `${cleanSpecies}${suffix}` : cleanSpecies;
};

const shouldIncludeVariety = (apiName) => !HIDDEN_VARIETY_PATTERNS.some(pattern => pattern.test(apiName));

const stripBattleFormSuffix = (apiName) => String(apiName || '')
  .replace(/-gmax$/, '')
  .replace(/-mega(?:-[xyz])?$/, '')
  .replace(/-primal$/, '');

const selectMoveSource = (variety, speciesVarieties) => {
  if (variety.data.moves?.length) return variety;

  const closestFormName = stripBattleFormSuffix(variety.data.name);
  return speciesVarieties.find(candidate =>
    candidate.data.name === closestFormName && candidate.data.moves?.length
  ) || speciesVarieties.find(candidate =>
    candidate.isDefault && candidate.data.moves?.length
  ) || speciesVarieties.find(candidate => candidate.data.moves?.length);
};

const extractEvolutionNames = (chainNode) => {
  const names = [chainNode.species.name];
  for (const child of chainNode.evolves_to || []) {
    names.push(...extractEvolutionNames(child));
  }
  return names;
};

const extractEvolutionStages = (chainNode, depth = 0, stageMap = new Map()) => {
  const current = stageMap.get(chainNode.species.name);
  if (current === undefined || depth < current) stageMap.set(chainNode.species.name, depth);
  for (const child of chainNode.evolves_to || []) {
    extractEvolutionStages(child, depth + 1, stageMap);
  }
  return stageMap;
};

async function fetchInBatches(items, batchSize, worker, progressLabel) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map(worker));
    results.push(...batchResults);
    process.stdout.write(`.${Math.min(index + batchSize, items.length)}`);
  }
  if (progressLabel) console.log(` ${progressLabel}`);
  return results;
}

async function run() {
  console.log('Fetching evolution chains...');
  const chainList = await fetchJson('https://pokeapi.co/api/v2/evolution-chain?limit=700');
  const chains = await fetchInBatches(
    chainList.results,
    20,
    async entry => ({ id: resourceId(entry.url), chain: (await fetchJson(entry.url)).chain }),
    'chains'
  );

  console.log('Fetching Pokemon species...');
  const speciesList = (await fetchJson('https://pokeapi.co/api/v2/pokemon-species?limit=1500')).results;
  const speciesSummaryMap = new Map(speciesList.map(species => [
    species.name,
    { name: species.name, id: resourceId(species.url), url: species.url }
  ]));

  const speciesDetails = await fetchInBatches(
    speciesList,
    30,
    entry => fetchJson(entry.url),
    'species'
  );
  const speciesDetailMap = new Map(speciesDetails.map(species => [species.name, species]));

  console.log('Fetching playable Pokemon varieties...');
  const varietyResources = [];
  for (const species of speciesDetails) {
    for (const variety of species.varieties || []) {
      if (!shouldIncludeVariety(variety.pokemon.name)) continue;
      varietyResources.push({
        speciesName: species.name,
        isDefault: variety.is_default,
        name: variety.pokemon.name,
        url: variety.pokemon.url
      });
    }
  }

  const pokemonVarieties = await fetchInBatches(
    varietyResources,
    30,
    async variety => ({ ...variety, data: await fetchJson(variety.url) }),
    'varieties'
  );

  const varietiesBySpecies = new Map();
  for (const variety of pokemonVarieties) {
    if (!varietiesBySpecies.has(variety.speciesName)) varietiesBySpecies.set(variety.speciesName, []);
    varietiesBySpecies.get(variety.speciesName).push(variety);
  }
  for (const varieties of varietiesBySpecies.values()) {
    varieties.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.data.id - b.data.id);
  }

  const chainBySpecies = new Map();
  for (const chain of chains) {
    for (const speciesName of extractEvolutionNames(chain.chain)) {
      chainBySpecies.set(speciesName, chain);
    }
  }

  const absorbedSpecialRoots = new Set(
    [...SPECIAL_EVOLUTION_LINKS.values()].flat()
  );
  const families = [];

  for (const chainEntry of chains) {
    const baseName = chainEntry.chain.species.name;
    if (absorbedSpecialRoots.has(baseName)) continue;

    const speciesStages = extractEvolutionStages(chainEntry.chain);
    for (const linkedName of SPECIAL_EVOLUTION_LINKS.get(baseName) || []) {
      const linkedChain = chainBySpecies.get(linkedName);
      const linkedStages = linkedChain
        ? extractEvolutionStages(linkedChain.chain)
        : new Map([[linkedName, 0]]);
      for (const [name, linkedStage] of linkedStages) {
        const mergedStage = linkedStage + 1;
        const currentStage = speciesStages.get(name);
        if (currentStage === undefined || mergedStage < currentStage) {
          speciesStages.set(name, mergedStage);
        }
      }
    }
    const speciesEntries = [...speciesStages.entries()]
      .sort((a, b) => a[1] - b[1] || (speciesSummaryMap.get(a[0])?.id || 9999) - (speciesSummaryMap.get(b[0])?.id || 9999));

    const baseSummary = speciesSummaryMap.get(baseName);
    if (!baseSummary || baseSummary.id > 1500) continue;

    const evolutions = [];
    for (const [speciesName, stage] of speciesEntries) {
      const species = speciesDetailMap.get(speciesName);
      const varieties = varietiesBySpecies.get(speciesName) || [];

      for (const variety of varieties) {
        const pokemon = variety.data;
        const moveSource = selectMoveSource(variety, varieties);
        if (!moveSource) {
          throw new Error(`No canonical move source found for ${pokemon.name}`);
        }
        const types = (pokemon.types || [])
          .sort((a, b) => a.slot - b.slot)
          .map(entry => entry.type.name);
        const apiName = pokemon.name;
        evolutions.push({
          id: pokemon.id,
          speciesId: species?.id || speciesSummaryMap.get(speciesName)?.id || null,
          speciesName,
          stage,
          name: formatVarietyName(apiName, speciesName),
          apiName,
          type: types[0] || 'normal',
          types: types.length ? types : ['normal'],
          isDefault: variety.isDefault,
          isForm: !variety.isDefault || apiName !== speciesName,
          ...(moveSource.data.name !== apiName
            ? { moveSourceApiName: moveSource.data.name }
            : {}),
          url: `https://play.pokemonshowdown.com/sprites/ani/${showdownSpriteName(apiName, speciesName)}.gif`
        });
      }
    }

    const baseVariety = (varietiesBySpecies.get(baseName) || []).find(variety => variety.isDefault)
      || (varietiesBySpecies.get(baseName) || [])[0];
    const baseTypes = (baseVariety?.data?.types || [])
      .sort((a, b) => a.slot - b.slot)
      .map(entry => entry.type.name);

    families.push({
      id: baseSummary.id,
      chainId: chainEntry.id,
      baseName,
      displayName: titleCase(baseName),
      type: baseTypes[0] || 'normal',
      types: baseTypes.length ? baseTypes : ['normal'],
      hp: 200,
      evolutions
    });
  }

  families.sort((a, b) => a.id - b.id);

  const invalidFamilies = families.filter(family => !family.evolutions.length);
  if (invalidFamilies.length) {
    throw new Error(`Families without playable forms: ${invalidFamilies.map(family => family.baseName).join(', ')}`);
  }

  const output = `// pokeData.js
// Auto-generated Pokemon evolution families and battle-relevant forms.
// Source: PokeAPI evolution chains + species varieties.
window.POKEMON_FAMILIES = ${JSON.stringify(families, null, 2)};
`;
  fs.writeFileSync('js/pokeData.js', output);

  const formCount = families.reduce((total, family) => total + family.evolutions.length, 0);
  console.log(`Written ${families.length} families and ${formCount} playable forms to js/pokeData.js`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
