const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
  waitFor,
} = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9374, name: 'Poke Denge Testi' });
  try {
    await createRoom(peer);
    await waitFor(
      peer.client,
      `typeof window.calculatePokeDamage === 'function'
        && typeof window.getPokeTypeMultiplier === 'function'
        && typeof window.updatePokeMoveEffectivenessBadge === 'function'`,
      10000,
      'PokeSavaş denge yardımcıları'
    );

    const result = await evalJS(
      peer.client,
      `(() => {
        const attacker = {
          types: ['fire'],
          stats: { attack: 100, defense: 100, 'special-attack': 100, 'special-defense': 100 },
          maxHp: 250,
          atkStage: 0
        };
        const defender = (types, stats = {}) => ({
          types,
          stats: {
            attack: 100,
            defense: 100,
            'special-attack': 100,
            'special-defense': 100,
            ...stats
          },
          maxHp: 250,
          defStage: 0
        });
        const fireMove = {
          name: 'FLAMETHROWER',
          type: 'fire',
          power: 90,
          accuracy: 100,
          damage_class: 'special'
        };
        const electricMove = {
          name: 'THUNDERBOLT',
          type: 'electric',
          power: 90,
          accuracy: 100,
          damage_class: 'special'
        };

        const multipliers = {
          fireGrass: window.getPokeTypeMultiplier('fire', defender(['grass'])),
          fireBug: window.getPokeTypeMultiplier('fire', defender(['bug'])),
          fireGrassBug: window.getPokeTypeMultiplier('fire', defender(['grass', 'bug'])),
          fireWaterDragon: window.getPokeTypeMultiplier('fire', defender(['water', 'dragon'])),
          electricGround: window.getPokeTypeMultiplier('electric', defender(['ground'])),
          waterFireRock: window.getPokeTypeMultiplier('water', defender(['fire', 'rock']))
        };

        const damages = {
          neutral: window.calculatePokeDamage(attacker, defender(['normal']), fireMove, 1).damage,
          grass: window.calculatePokeDamage(attacker, defender(['grass']), fireMove, 1).damage,
          grassBug: window.calculatePokeDamage(attacker, defender(['grass', 'bug']), fireMove, 1).damage,
          resistedTwice: window.calculatePokeDamage(attacker, defender(['water', 'dragon']), fireMove, 1).damage,
          immune: window.calculatePokeDamage(attacker, defender(['ground']), electricMove, 1).damage
        };

        const physicalAttacker = {
          types: ['normal'],
          stats: { attack: 160, 'special-attack': 40 },
          maxHp: 250,
          atkStage: 0
        };
        const balancedDefender = defender(['normal'], { defense: 80, 'special-defense': 80 });
        const physicalDamage = window.calculatePokeDamage(
          physicalAttacker,
          balancedDefender,
          { type: 'normal', power: 80, damage_class: 'physical' },
          1
        ).damage;
        const specialDamage = window.calculatePokeDamage(
          physicalAttacker,
          balancedDefender,
          { type: 'normal', power: 80, damage_class: 'special' },
          1
        ).damage;

        const extremeAttacker = {
          types: ['fire'],
          stats: { attack: 180, 'special-attack': 180 },
          maxHp: 250,
          atkStage: 0
        };
        const extremeDefender = defender(['normal'], { defense: 40, 'special-defense': 40 });
        const extremeDamage = window.calculatePokeDamage(
          extremeAttacker,
          extremeDefender,
          { type: 'fire', power: 150, damage_class: 'special' },
          1
        ).damage;

        const badgeButton = document.querySelector('.poke-move-btn');
        window.updatePokeMoveEffectivenessBadge(
          badgeButton,
          fireMove,
          defender(['grass', 'bug'])
        );
        const badge = badgeButton.querySelector('.move-effectiveness');
        const badgeResult = {
          text: badge.textContent,
          hidden: badge.classList.contains('hidden'),
          multiplier: badgeButton.dataset.effectiveness
        };

        return {
          multipliers,
          damages,
          physicalDamage,
          specialDamage,
          extremeDamage,
          maxAllowedDamage: Math.floor(
            extremeDefender.maxHp * window.POKE_BATTLE_BALANCE.maxDamageRatio
          ),
          effectiveness: {
            immune: window.getPokeEffectivenessInfo(0).label,
            double: window.getPokeEffectivenessInfo(2).label,
            quadruple: window.getPokeEffectivenessInfo(4).label
          },
          badgeResult
        };
      })()`
    );

    assert.deepStrictEqual(result.multipliers, {
      fireGrass: 2,
      fireBug: 2,
      fireGrassBug: 4,
      fireWaterDragon: 0.25,
      electricGround: 0,
      waterFireRock: 4,
    });
    assert.ok(result.damages.resistedTwice < result.damages.neutral);
    assert.ok(result.damages.neutral < result.damages.grass);
    assert.ok(result.damages.grass < result.damages.grassBug);
    assert.strictEqual(result.damages.immune, 0);
    assert.ok(result.physicalDamage > result.specialDamage);
    assert.ok(result.extremeDamage <= result.maxAllowedDamage);
    assert.deepStrictEqual(result.effectiveness, {
      immune: 'ETKİSİZ',
      double: 'SÜPER ETKİLİ',
      quadruple: 'AŞIRI ETKİLİ',
    });
    assert.deepStrictEqual(result.badgeResult, {
      text: 'AŞIRI ETKİLİ • 4×',
      hidden: false,
      multiplier: '4',
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
