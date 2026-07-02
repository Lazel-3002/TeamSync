function initPoke() {
  window.pokeBotMemory = window.pokeBotMemory || [];
  
  const broadcastPokeMsg = (msg) => {
    broadcast(msg);
    if (window.pokeActivityHandler) window.pokeActivityHandler(msg);
  };

  // State
  window.pokeState = {
    p1: null, // { id, name, type, pokemon, ready }
    p2: null,
    spectators: [],
    round: 0,
    status: 'waiting', // waiting, selecting, revealed, round_end
    actionP1: null,
    actionP2: null,
  };

  // Pokemon dictionaries by type (gifs or high quality images)
  const POKEMONS = {
  normal: ["https://play.pokemonshowdown.com/sprites/ani/pidgey.gif","https://play.pokemonshowdown.com/sprites/ani/pidgeotto.gif","https://play.pokemonshowdown.com/sprites/ani/pidgeot.gif","https://play.pokemonshowdown.com/sprites/ani/rattata.gif","https://play.pokemonshowdown.com/sprites/ani/raticate.gif","https://play.pokemonshowdown.com/sprites/ani/spearow.gif","https://play.pokemonshowdown.com/sprites/ani/fearow.gif","https://play.pokemonshowdown.com/sprites/ani/jigglypuff.gif","https://play.pokemonshowdown.com/sprites/ani/wigglytuff.gif","https://play.pokemonshowdown.com/sprites/ani/meowth.gif","https://play.pokemonshowdown.com/sprites/ani/persian.gif","https://play.pokemonshowdown.com/sprites/ani/farfetchd.gif","https://play.pokemonshowdown.com/sprites/ani/doduo.gif","https://play.pokemonshowdown.com/sprites/ani/dodrio.gif","https://play.pokemonshowdown.com/sprites/ani/lickitung.gif","https://play.pokemonshowdown.com/sprites/ani/chansey.gif","https://play.pokemonshowdown.com/sprites/ani/kangaskhan.gif","https://play.pokemonshowdown.com/sprites/ani/tauros.gif","https://play.pokemonshowdown.com/sprites/ani/ditto.gif","https://play.pokemonshowdown.com/sprites/ani/eevee.gif","https://play.pokemonshowdown.com/sprites/ani/porygon.gif","https://play.pokemonshowdown.com/sprites/ani/snorlax.gif","https://play.pokemonshowdown.com/sprites/ani/sentret.gif","https://play.pokemonshowdown.com/sprites/ani/furret.gif","https://play.pokemonshowdown.com/sprites/ani/hoothoot.gif","https://play.pokemonshowdown.com/sprites/ani/noctowl.gif","https://play.pokemonshowdown.com/sprites/ani/igglybuff.gif","https://play.pokemonshowdown.com/sprites/ani/aipom.gif","https://play.pokemonshowdown.com/sprites/ani/girafarig.gif","https://play.pokemonshowdown.com/sprites/ani/dunsparce.gif","https://play.pokemonshowdown.com/sprites/ani/teddiursa.gif","https://play.pokemonshowdown.com/sprites/ani/ursaring.gif","https://play.pokemonshowdown.com/sprites/ani/porygon2.gif","https://play.pokemonshowdown.com/sprites/ani/stantler.gif","https://play.pokemonshowdown.com/sprites/ani/smeargle.gif","https://play.pokemonshowdown.com/sprites/ani/miltank.gif","https://play.pokemonshowdown.com/sprites/ani/blissey.gif","https://play.pokemonshowdown.com/sprites/ani/zigzagoon.gif","https://play.pokemonshowdown.com/sprites/ani/linoone.gif","https://play.pokemonshowdown.com/sprites/ani/taillow.gif","https://play.pokemonshowdown.com/sprites/ani/swellow.gif","https://play.pokemonshowdown.com/sprites/ani/slakoth.gif","https://play.pokemonshowdown.com/sprites/ani/vigoroth.gif","https://play.pokemonshowdown.com/sprites/ani/slaking.gif","https://play.pokemonshowdown.com/sprites/ani/whismur.gif","https://play.pokemonshowdown.com/sprites/ani/loudred.gif","https://play.pokemonshowdown.com/sprites/ani/exploud.gif","https://play.pokemonshowdown.com/sprites/ani/azurill.gif","https://play.pokemonshowdown.com/sprites/ani/skitty.gif","https://play.pokemonshowdown.com/sprites/ani/delcatty.gif","https://play.pokemonshowdown.com/sprites/ani/spinda.gif","https://play.pokemonshowdown.com/sprites/ani/swablu.gif","https://play.pokemonshowdown.com/sprites/ani/zangoose.gif","https://play.pokemonshowdown.com/sprites/ani/castform.gif","https://play.pokemonshowdown.com/sprites/ani/kecleon.gif","https://play.pokemonshowdown.com/sprites/ani/starly.gif","https://play.pokemonshowdown.com/sprites/ani/staravia.gif","https://play.pokemonshowdown.com/sprites/ani/staraptor.gif","https://play.pokemonshowdown.com/sprites/ani/bidoof.gif","https://play.pokemonshowdown.com/sprites/ani/bibarel.gif","https://play.pokemonshowdown.com/sprites/ani/ambipom.gif","https://play.pokemonshowdown.com/sprites/ani/buneary.gif","https://play.pokemonshowdown.com/sprites/ani/lopunny.gif","https://play.pokemonshowdown.com/sprites/ani/glameow.gif","https://play.pokemonshowdown.com/sprites/ani/purugly.gif","https://play.pokemonshowdown.com/sprites/ani/happiny.gif","https://play.pokemonshowdown.com/sprites/ani/chatot.gif","https://play.pokemonshowdown.com/sprites/ani/munchlax.gif","https://play.pokemonshowdown.com/sprites/ani/lickilicky.gif","https://play.pokemonshowdown.com/sprites/ani/regigigas.gif"],
  fire: ["https://play.pokemonshowdown.com/sprites/ani/charmander.gif","https://play.pokemonshowdown.com/sprites/ani/charmeleon.gif","https://play.pokemonshowdown.com/sprites/ani/charizard.gif","https://play.pokemonshowdown.com/sprites/ani/vulpix.gif","https://play.pokemonshowdown.com/sprites/ani/ninetales.gif","https://play.pokemonshowdown.com/sprites/ani/growlithe.gif","https://play.pokemonshowdown.com/sprites/ani/arcanine.gif","https://play.pokemonshowdown.com/sprites/ani/ponyta.gif","https://play.pokemonshowdown.com/sprites/ani/rapidash.gif","https://play.pokemonshowdown.com/sprites/ani/magmar.gif","https://play.pokemonshowdown.com/sprites/ani/flareon.gif","https://play.pokemonshowdown.com/sprites/ani/moltres.gif","https://play.pokemonshowdown.com/sprites/ani/cyndaquil.gif","https://play.pokemonshowdown.com/sprites/ani/quilava.gif","https://play.pokemonshowdown.com/sprites/ani/typhlosion.gif","https://play.pokemonshowdown.com/sprites/ani/slugma.gif","https://play.pokemonshowdown.com/sprites/ani/magcargo.gif","https://play.pokemonshowdown.com/sprites/ani/houndour.gif","https://play.pokemonshowdown.com/sprites/ani/houndoom.gif","https://play.pokemonshowdown.com/sprites/ani/magby.gif","https://play.pokemonshowdown.com/sprites/ani/entei.gif","https://play.pokemonshowdown.com/sprites/ani/torchic.gif","https://play.pokemonshowdown.com/sprites/ani/combusken.gif","https://play.pokemonshowdown.com/sprites/ani/blaziken.gif","https://play.pokemonshowdown.com/sprites/ani/numel.gif","https://play.pokemonshowdown.com/sprites/ani/camerupt.gif","https://play.pokemonshowdown.com/sprites/ani/torkoal.gif","https://play.pokemonshowdown.com/sprites/ani/chimchar.gif","https://play.pokemonshowdown.com/sprites/ani/monferno.gif","https://play.pokemonshowdown.com/sprites/ani/infernape.gif","https://play.pokemonshowdown.com/sprites/ani/magmortar.gif","https://play.pokemonshowdown.com/sprites/ani/heatran.gif","https://play.pokemonshowdown.com/sprites/ani/victini.gif","https://play.pokemonshowdown.com/sprites/ani/tepig.gif","https://play.pokemonshowdown.com/sprites/ani/pignite.gif","https://play.pokemonshowdown.com/sprites/ani/emboar.gif","https://play.pokemonshowdown.com/sprites/ani/pansear.gif","https://play.pokemonshowdown.com/sprites/ani/simisear.gif","https://play.pokemonshowdown.com/sprites/ani/darumaka.gif","https://play.pokemonshowdown.com/sprites/ani/litwick.gif","https://play.pokemonshowdown.com/sprites/ani/lampent.gif","https://play.pokemonshowdown.com/sprites/ani/chandelure.gif","https://play.pokemonshowdown.com/sprites/ani/heatmor.gif","https://play.pokemonshowdown.com/sprites/ani/larvesta.gif","https://play.pokemonshowdown.com/sprites/ani/volcarona.gif","https://play.pokemonshowdown.com/sprites/ani/reshiram.gif","https://play.pokemonshowdown.com/sprites/ani/fennekin.gif","https://play.pokemonshowdown.com/sprites/ani/braixen.gif","https://play.pokemonshowdown.com/sprites/ani/delphox.gif","https://play.pokemonshowdown.com/sprites/ani/fletchinder.gif","https://play.pokemonshowdown.com/sprites/ani/talonflame.gif","https://play.pokemonshowdown.com/sprites/ani/litleo.gif","https://play.pokemonshowdown.com/sprites/ani/volcanion.gif","https://play.pokemonshowdown.com/sprites/ani/litten.gif","https://play.pokemonshowdown.com/sprites/ani/torracat.gif","https://play.pokemonshowdown.com/sprites/ani/incineroar.gif","https://play.pokemonshowdown.com/sprites/ani/salandit.gif","https://play.pokemonshowdown.com/sprites/ani/salazzle.gif","https://play.pokemonshowdown.com/sprites/ani/turtonator.gif","https://play.pokemonshowdown.com/sprites/ani/blacephalon.gif","https://play.pokemonshowdown.com/sprites/ani/scorbunny.gif","https://play.pokemonshowdown.com/sprites/ani/raboot.gif","https://play.pokemonshowdown.com/sprites/ani/cinderace.gif","https://play.pokemonshowdown.com/sprites/ani/carkol.gif","https://play.pokemonshowdown.com/sprites/ani/coalossal.gif","https://play.pokemonshowdown.com/sprites/ani/sizzlipede.gif","https://play.pokemonshowdown.com/sprites/ani/centiskorch.gif","https://play.pokemonshowdown.com/sprites/ani/fuecoco.gif","https://play.pokemonshowdown.com/sprites/ani/crocalor.gif","https://play.pokemonshowdown.com/sprites/ani/skeledirge.gif"],
  water: ["https://play.pokemonshowdown.com/sprites/ani/squirtle.gif","https://play.pokemonshowdown.com/sprites/ani/wartortle.gif","https://play.pokemonshowdown.com/sprites/ani/blastoise.gif","https://play.pokemonshowdown.com/sprites/ani/psyduck.gif","https://play.pokemonshowdown.com/sprites/ani/golduck.gif","https://play.pokemonshowdown.com/sprites/ani/poliwag.gif","https://play.pokemonshowdown.com/sprites/ani/poliwhirl.gif","https://play.pokemonshowdown.com/sprites/ani/poliwrath.gif","https://play.pokemonshowdown.com/sprites/ani/tentacool.gif","https://play.pokemonshowdown.com/sprites/ani/tentacruel.gif","https://play.pokemonshowdown.com/sprites/ani/slowpoke.gif","https://play.pokemonshowdown.com/sprites/ani/slowbro.gif","https://play.pokemonshowdown.com/sprites/ani/seel.gif","https://play.pokemonshowdown.com/sprites/ani/dewgong.gif","https://play.pokemonshowdown.com/sprites/ani/shellder.gif","https://play.pokemonshowdown.com/sprites/ani/cloyster.gif","https://play.pokemonshowdown.com/sprites/ani/krabby.gif","https://play.pokemonshowdown.com/sprites/ani/kingler.gif","https://play.pokemonshowdown.com/sprites/ani/horsea.gif","https://play.pokemonshowdown.com/sprites/ani/seadra.gif","https://play.pokemonshowdown.com/sprites/ani/goldeen.gif","https://play.pokemonshowdown.com/sprites/ani/seaking.gif","https://play.pokemonshowdown.com/sprites/ani/staryu.gif","https://play.pokemonshowdown.com/sprites/ani/starmie.gif","https://play.pokemonshowdown.com/sprites/ani/magikarp.gif","https://play.pokemonshowdown.com/sprites/ani/gyarados.gif","https://play.pokemonshowdown.com/sprites/ani/lapras.gif","https://play.pokemonshowdown.com/sprites/ani/vaporeon.gif","https://play.pokemonshowdown.com/sprites/ani/omanyte.gif","https://play.pokemonshowdown.com/sprites/ani/omastar.gif","https://play.pokemonshowdown.com/sprites/ani/kabuto.gif","https://play.pokemonshowdown.com/sprites/ani/kabutops.gif","https://play.pokemonshowdown.com/sprites/ani/totodile.gif","https://play.pokemonshowdown.com/sprites/ani/croconaw.gif","https://play.pokemonshowdown.com/sprites/ani/feraligatr.gif","https://play.pokemonshowdown.com/sprites/ani/chinchou.gif","https://play.pokemonshowdown.com/sprites/ani/lanturn.gif","https://play.pokemonshowdown.com/sprites/ani/marill.gif","https://play.pokemonshowdown.com/sprites/ani/azumarill.gif","https://play.pokemonshowdown.com/sprites/ani/politoed.gif","https://play.pokemonshowdown.com/sprites/ani/wooper.gif","https://play.pokemonshowdown.com/sprites/ani/quagsire.gif","https://play.pokemonshowdown.com/sprites/ani/slowking.gif","https://play.pokemonshowdown.com/sprites/ani/qwilfish.gif","https://play.pokemonshowdown.com/sprites/ani/corsola.gif","https://play.pokemonshowdown.com/sprites/ani/remoraid.gif","https://play.pokemonshowdown.com/sprites/ani/octillery.gif","https://play.pokemonshowdown.com/sprites/ani/mantine.gif","https://play.pokemonshowdown.com/sprites/ani/kingdra.gif","https://play.pokemonshowdown.com/sprites/ani/suicune.gif","https://play.pokemonshowdown.com/sprites/ani/mudkip.gif","https://play.pokemonshowdown.com/sprites/ani/marshtomp.gif","https://play.pokemonshowdown.com/sprites/ani/swampert.gif","https://play.pokemonshowdown.com/sprites/ani/lotad.gif","https://play.pokemonshowdown.com/sprites/ani/lombre.gif","https://play.pokemonshowdown.com/sprites/ani/ludicolo.gif","https://play.pokemonshowdown.com/sprites/ani/wingull.gif","https://play.pokemonshowdown.com/sprites/ani/pelipper.gif","https://play.pokemonshowdown.com/sprites/ani/surskit.gif","https://play.pokemonshowdown.com/sprites/ani/carvanha.gif","https://play.pokemonshowdown.com/sprites/ani/sharpedo.gif","https://play.pokemonshowdown.com/sprites/ani/wailmer.gif","https://play.pokemonshowdown.com/sprites/ani/wailord.gif","https://play.pokemonshowdown.com/sprites/ani/barboach.gif","https://play.pokemonshowdown.com/sprites/ani/whiscash.gif","https://play.pokemonshowdown.com/sprites/ani/corphish.gif","https://play.pokemonshowdown.com/sprites/ani/crawdaunt.gif","https://play.pokemonshowdown.com/sprites/ani/feebas.gif","https://play.pokemonshowdown.com/sprites/ani/milotic.gif","https://play.pokemonshowdown.com/sprites/ani/spheal.gif"],
  grass: ["https://play.pokemonshowdown.com/sprites/ani/bulbasaur.gif","https://play.pokemonshowdown.com/sprites/ani/ivysaur.gif","https://play.pokemonshowdown.com/sprites/ani/venusaur.gif","https://play.pokemonshowdown.com/sprites/ani/oddish.gif","https://play.pokemonshowdown.com/sprites/ani/gloom.gif","https://play.pokemonshowdown.com/sprites/ani/vileplume.gif","https://play.pokemonshowdown.com/sprites/ani/paras.gif","https://play.pokemonshowdown.com/sprites/ani/parasect.gif","https://play.pokemonshowdown.com/sprites/ani/bellsprout.gif","https://play.pokemonshowdown.com/sprites/ani/weepinbell.gif","https://play.pokemonshowdown.com/sprites/ani/victreebel.gif","https://play.pokemonshowdown.com/sprites/ani/exeggcute.gif","https://play.pokemonshowdown.com/sprites/ani/exeggutor.gif","https://play.pokemonshowdown.com/sprites/ani/tangela.gif","https://play.pokemonshowdown.com/sprites/ani/chikorita.gif","https://play.pokemonshowdown.com/sprites/ani/bayleef.gif","https://play.pokemonshowdown.com/sprites/ani/meganium.gif","https://play.pokemonshowdown.com/sprites/ani/bellossom.gif","https://play.pokemonshowdown.com/sprites/ani/hoppip.gif","https://play.pokemonshowdown.com/sprites/ani/skiploom.gif","https://play.pokemonshowdown.com/sprites/ani/jumpluff.gif","https://play.pokemonshowdown.com/sprites/ani/sunkern.gif","https://play.pokemonshowdown.com/sprites/ani/sunflora.gif","https://play.pokemonshowdown.com/sprites/ani/celebi.gif","https://play.pokemonshowdown.com/sprites/ani/treecko.gif","https://play.pokemonshowdown.com/sprites/ani/grovyle.gif","https://play.pokemonshowdown.com/sprites/ani/sceptile.gif","https://play.pokemonshowdown.com/sprites/ani/lotad.gif","https://play.pokemonshowdown.com/sprites/ani/lombre.gif","https://play.pokemonshowdown.com/sprites/ani/ludicolo.gif","https://play.pokemonshowdown.com/sprites/ani/seedot.gif","https://play.pokemonshowdown.com/sprites/ani/nuzleaf.gif","https://play.pokemonshowdown.com/sprites/ani/shiftry.gif","https://play.pokemonshowdown.com/sprites/ani/shroomish.gif","https://play.pokemonshowdown.com/sprites/ani/breloom.gif","https://play.pokemonshowdown.com/sprites/ani/roselia.gif","https://play.pokemonshowdown.com/sprites/ani/cacnea.gif","https://play.pokemonshowdown.com/sprites/ani/cacturne.gif","https://play.pokemonshowdown.com/sprites/ani/lileep.gif","https://play.pokemonshowdown.com/sprites/ani/cradily.gif","https://play.pokemonshowdown.com/sprites/ani/tropius.gif","https://play.pokemonshowdown.com/sprites/ani/turtwig.gif","https://play.pokemonshowdown.com/sprites/ani/grotle.gif","https://play.pokemonshowdown.com/sprites/ani/torterra.gif","https://play.pokemonshowdown.com/sprites/ani/budew.gif","https://play.pokemonshowdown.com/sprites/ani/roserade.gif","https://play.pokemonshowdown.com/sprites/ani/cherubi.gif","https://play.pokemonshowdown.com/sprites/ani/cherrim.gif","https://play.pokemonshowdown.com/sprites/ani/carnivine.gif","https://play.pokemonshowdown.com/sprites/ani/snover.gif","https://play.pokemonshowdown.com/sprites/ani/abomasnow.gif","https://play.pokemonshowdown.com/sprites/ani/tangrowth.gif","https://play.pokemonshowdown.com/sprites/ani/leafeon.gif","https://play.pokemonshowdown.com/sprites/ani/snivy.gif","https://play.pokemonshowdown.com/sprites/ani/servine.gif","https://play.pokemonshowdown.com/sprites/ani/serperior.gif","https://play.pokemonshowdown.com/sprites/ani/pansage.gif","https://play.pokemonshowdown.com/sprites/ani/simisage.gif","https://play.pokemonshowdown.com/sprites/ani/sewaddle.gif","https://play.pokemonshowdown.com/sprites/ani/swadloon.gif","https://play.pokemonshowdown.com/sprites/ani/leavanny.gif","https://play.pokemonshowdown.com/sprites/ani/cottonee.gif","https://play.pokemonshowdown.com/sprites/ani/whimsicott.gif","https://play.pokemonshowdown.com/sprites/ani/petilil.gif","https://play.pokemonshowdown.com/sprites/ani/lilligant.gif","https://play.pokemonshowdown.com/sprites/ani/maractus.gif","https://play.pokemonshowdown.com/sprites/ani/deerling.gif","https://play.pokemonshowdown.com/sprites/ani/sawsbuck.gif","https://play.pokemonshowdown.com/sprites/ani/foongus.gif","https://play.pokemonshowdown.com/sprites/ani/amoonguss.gif"],
  electric: ["https://play.pokemonshowdown.com/sprites/ani/pikachu.gif","https://play.pokemonshowdown.com/sprites/ani/raichu.gif","https://play.pokemonshowdown.com/sprites/ani/magnemite.gif","https://play.pokemonshowdown.com/sprites/ani/magneton.gif","https://play.pokemonshowdown.com/sprites/ani/voltorb.gif","https://play.pokemonshowdown.com/sprites/ani/electrode.gif","https://play.pokemonshowdown.com/sprites/ani/electabuzz.gif","https://play.pokemonshowdown.com/sprites/ani/jolteon.gif","https://play.pokemonshowdown.com/sprites/ani/zapdos.gif","https://play.pokemonshowdown.com/sprites/ani/chinchou.gif","https://play.pokemonshowdown.com/sprites/ani/lanturn.gif","https://play.pokemonshowdown.com/sprites/ani/pichu.gif","https://play.pokemonshowdown.com/sprites/ani/mareep.gif","https://play.pokemonshowdown.com/sprites/ani/flaaffy.gif","https://play.pokemonshowdown.com/sprites/ani/ampharos.gif","https://play.pokemonshowdown.com/sprites/ani/elekid.gif","https://play.pokemonshowdown.com/sprites/ani/raikou.gif","https://play.pokemonshowdown.com/sprites/ani/electrike.gif","https://play.pokemonshowdown.com/sprites/ani/manectric.gif","https://play.pokemonshowdown.com/sprites/ani/plusle.gif","https://play.pokemonshowdown.com/sprites/ani/minun.gif","https://play.pokemonshowdown.com/sprites/ani/shinx.gif","https://play.pokemonshowdown.com/sprites/ani/luxio.gif","https://play.pokemonshowdown.com/sprites/ani/luxray.gif","https://play.pokemonshowdown.com/sprites/ani/pachirisu.gif","https://play.pokemonshowdown.com/sprites/ani/magnezone.gif","https://play.pokemonshowdown.com/sprites/ani/electivire.gif","https://play.pokemonshowdown.com/sprites/ani/rotom.gif","https://play.pokemonshowdown.com/sprites/ani/blitzle.gif","https://play.pokemonshowdown.com/sprites/ani/zebstrika.gif","https://play.pokemonshowdown.com/sprites/ani/emolga.gif","https://play.pokemonshowdown.com/sprites/ani/joltik.gif","https://play.pokemonshowdown.com/sprites/ani/galvantula.gif","https://play.pokemonshowdown.com/sprites/ani/tynamo.gif","https://play.pokemonshowdown.com/sprites/ani/eelektrik.gif","https://play.pokemonshowdown.com/sprites/ani/eelektross.gif","https://play.pokemonshowdown.com/sprites/ani/stunfisk.gif","https://play.pokemonshowdown.com/sprites/ani/zekrom.gif","https://play.pokemonshowdown.com/sprites/ani/helioptile.gif","https://play.pokemonshowdown.com/sprites/ani/heliolisk.gif","https://play.pokemonshowdown.com/sprites/ani/dedenne.gif","https://play.pokemonshowdown.com/sprites/ani/charjabug.gif","https://play.pokemonshowdown.com/sprites/ani/vikavolt.gif","https://play.pokemonshowdown.com/sprites/ani/togedemaru.gif","https://play.pokemonshowdown.com/sprites/ani/xurkitree.gif","https://play.pokemonshowdown.com/sprites/ani/zeraora.gif","https://play.pokemonshowdown.com/sprites/ani/yamper.gif","https://play.pokemonshowdown.com/sprites/ani/boltund.gif","https://play.pokemonshowdown.com/sprites/ani/toxel.gif","https://play.pokemonshowdown.com/sprites/ani/pincurchin.gif","https://play.pokemonshowdown.com/sprites/ani/dracozolt.gif","https://play.pokemonshowdown.com/sprites/ani/arctozolt.gif","https://play.pokemonshowdown.com/sprites/ani/regieleki.gif","https://play.pokemonshowdown.com/sprites/ani/pawmi.gif","https://play.pokemonshowdown.com/sprites/ani/pawmo.gif","https://play.pokemonshowdown.com/sprites/ani/pawmot.gif","https://play.pokemonshowdown.com/sprites/ani/tadbulb.gif","https://play.pokemonshowdown.com/sprites/ani/bellibolt.gif","https://play.pokemonshowdown.com/sprites/ani/wattrel.gif","https://play.pokemonshowdown.com/sprites/ani/kilowattrel.gif","https://play.pokemonshowdown.com/sprites/ani/miraidon.gif"],
  ice: ["https://play.pokemonshowdown.com/sprites/ani/dewgong.gif","https://play.pokemonshowdown.com/sprites/ani/cloyster.gif","https://play.pokemonshowdown.com/sprites/ani/jynx.gif","https://play.pokemonshowdown.com/sprites/ani/lapras.gif","https://play.pokemonshowdown.com/sprites/ani/articuno.gif","https://play.pokemonshowdown.com/sprites/ani/sneasel.gif","https://play.pokemonshowdown.com/sprites/ani/swinub.gif","https://play.pokemonshowdown.com/sprites/ani/piloswine.gif","https://play.pokemonshowdown.com/sprites/ani/delibird.gif","https://play.pokemonshowdown.com/sprites/ani/smoochum.gif","https://play.pokemonshowdown.com/sprites/ani/snorunt.gif","https://play.pokemonshowdown.com/sprites/ani/glalie.gif","https://play.pokemonshowdown.com/sprites/ani/spheal.gif","https://play.pokemonshowdown.com/sprites/ani/sealeo.gif","https://play.pokemonshowdown.com/sprites/ani/walrein.gif","https://play.pokemonshowdown.com/sprites/ani/regice.gif","https://play.pokemonshowdown.com/sprites/ani/snover.gif","https://play.pokemonshowdown.com/sprites/ani/abomasnow.gif","https://play.pokemonshowdown.com/sprites/ani/weavile.gif","https://play.pokemonshowdown.com/sprites/ani/glaceon.gif","https://play.pokemonshowdown.com/sprites/ani/mamoswine.gif","https://play.pokemonshowdown.com/sprites/ani/froslass.gif","https://play.pokemonshowdown.com/sprites/ani/vanillite.gif","https://play.pokemonshowdown.com/sprites/ani/vanillish.gif","https://play.pokemonshowdown.com/sprites/ani/vanilluxe.gif","https://play.pokemonshowdown.com/sprites/ani/cubchoo.gif","https://play.pokemonshowdown.com/sprites/ani/beartic.gif","https://play.pokemonshowdown.com/sprites/ani/cryogonal.gif","https://play.pokemonshowdown.com/sprites/ani/kyurem.gif","https://play.pokemonshowdown.com/sprites/ani/amaura.gif","https://play.pokemonshowdown.com/sprites/ani/aurorus.gif","https://play.pokemonshowdown.com/sprites/ani/bergmite.gif","https://play.pokemonshowdown.com/sprites/ani/avalugg.gif","https://play.pokemonshowdown.com/sprites/ani/crabominable.gif","https://play.pokemonshowdown.com/sprites/ani/snom.gif","https://play.pokemonshowdown.com/sprites/ani/frosmoth.gif","https://play.pokemonshowdown.com/sprites/ani/arctozolt.gif","https://play.pokemonshowdown.com/sprites/ani/arctovish.gif","https://play.pokemonshowdown.com/sprites/ani/glastrier.gif","https://play.pokemonshowdown.com/sprites/ani/cetoddle.gif","https://play.pokemonshowdown.com/sprites/ani/cetitan.gif","https://play.pokemonshowdown.com/sprites/ani/frigibax.gif","https://play.pokemonshowdown.com/sprites/ani/arctibax.gif","https://play.pokemonshowdown.com/sprites/ani/baxcalibur.gif"],
  fighting: ["https://play.pokemonshowdown.com/sprites/ani/mankey.gif","https://play.pokemonshowdown.com/sprites/ani/primeape.gif","https://play.pokemonshowdown.com/sprites/ani/poliwrath.gif","https://play.pokemonshowdown.com/sprites/ani/machop.gif","https://play.pokemonshowdown.com/sprites/ani/machoke.gif","https://play.pokemonshowdown.com/sprites/ani/machamp.gif","https://play.pokemonshowdown.com/sprites/ani/hitmonlee.gif","https://play.pokemonshowdown.com/sprites/ani/hitmonchan.gif","https://play.pokemonshowdown.com/sprites/ani/heracross.gif","https://play.pokemonshowdown.com/sprites/ani/tyrogue.gif","https://play.pokemonshowdown.com/sprites/ani/hitmontop.gif","https://play.pokemonshowdown.com/sprites/ani/combusken.gif","https://play.pokemonshowdown.com/sprites/ani/blaziken.gif","https://play.pokemonshowdown.com/sprites/ani/breloom.gif","https://play.pokemonshowdown.com/sprites/ani/makuhita.gif","https://play.pokemonshowdown.com/sprites/ani/hariyama.gif","https://play.pokemonshowdown.com/sprites/ani/meditite.gif","https://play.pokemonshowdown.com/sprites/ani/medicham.gif","https://play.pokemonshowdown.com/sprites/ani/monferno.gif","https://play.pokemonshowdown.com/sprites/ani/infernape.gif","https://play.pokemonshowdown.com/sprites/ani/riolu.gif","https://play.pokemonshowdown.com/sprites/ani/lucario.gif","https://play.pokemonshowdown.com/sprites/ani/croagunk.gif","https://play.pokemonshowdown.com/sprites/ani/toxicroak.gif","https://play.pokemonshowdown.com/sprites/ani/gallade.gif","https://play.pokemonshowdown.com/sprites/ani/pignite.gif","https://play.pokemonshowdown.com/sprites/ani/emboar.gif","https://play.pokemonshowdown.com/sprites/ani/timburr.gif","https://play.pokemonshowdown.com/sprites/ani/gurdurr.gif","https://play.pokemonshowdown.com/sprites/ani/conkeldurr.gif","https://play.pokemonshowdown.com/sprites/ani/throh.gif","https://play.pokemonshowdown.com/sprites/ani/sawk.gif","https://play.pokemonshowdown.com/sprites/ani/scraggy.gif","https://play.pokemonshowdown.com/sprites/ani/scrafty.gif","https://play.pokemonshowdown.com/sprites/ani/mienfoo.gif","https://play.pokemonshowdown.com/sprites/ani/mienshao.gif","https://play.pokemonshowdown.com/sprites/ani/cobalion.gif","https://play.pokemonshowdown.com/sprites/ani/terrakion.gif","https://play.pokemonshowdown.com/sprites/ani/virizion.gif","https://play.pokemonshowdown.com/sprites/ani/chesnaught.gif","https://play.pokemonshowdown.com/sprites/ani/pancham.gif","https://play.pokemonshowdown.com/sprites/ani/pangoro.gif","https://play.pokemonshowdown.com/sprites/ani/hawlucha.gif","https://play.pokemonshowdown.com/sprites/ani/crabrawler.gif","https://play.pokemonshowdown.com/sprites/ani/crabominable.gif","https://play.pokemonshowdown.com/sprites/ani/stufful.gif","https://play.pokemonshowdown.com/sprites/ani/bewear.gif","https://play.pokemonshowdown.com/sprites/ani/passimian.gif","https://play.pokemonshowdown.com/sprites/ani/buzzwole.gif","https://play.pokemonshowdown.com/sprites/ani/pheromosa.gif","https://play.pokemonshowdown.com/sprites/ani/marshadow.gif","https://play.pokemonshowdown.com/sprites/ani/clobbopus.gif","https://play.pokemonshowdown.com/sprites/ani/grapploct.gif","https://play.pokemonshowdown.com/sprites/ani/sirfetchd.gif","https://play.pokemonshowdown.com/sprites/ani/falinks.gif","https://play.pokemonshowdown.com/sprites/ani/zamazenta.gif","https://play.pokemonshowdown.com/sprites/ani/kubfu.gif","https://play.pokemonshowdown.com/sprites/ani/sneasler.gif","https://play.pokemonshowdown.com/sprites/ani/quaquaval.gif","https://play.pokemonshowdown.com/sprites/ani/pawmo.gif","https://play.pokemonshowdown.com/sprites/ani/pawmot.gif","https://play.pokemonshowdown.com/sprites/ani/flamigo.gif","https://play.pokemonshowdown.com/sprites/ani/annihilape.gif","https://play.pokemonshowdown.com/sprites/ani/koraidon.gif","https://play.pokemonshowdown.com/sprites/ani/okidogi.gif"],
  poison: ["https://play.pokemonshowdown.com/sprites/ani/bulbasaur.gif","https://play.pokemonshowdown.com/sprites/ani/ivysaur.gif","https://play.pokemonshowdown.com/sprites/ani/venusaur.gif","https://play.pokemonshowdown.com/sprites/ani/weedle.gif","https://play.pokemonshowdown.com/sprites/ani/kakuna.gif","https://play.pokemonshowdown.com/sprites/ani/beedrill.gif","https://play.pokemonshowdown.com/sprites/ani/ekans.gif","https://play.pokemonshowdown.com/sprites/ani/arbok.gif","https://play.pokemonshowdown.com/sprites/ani/nidorina.gif","https://play.pokemonshowdown.com/sprites/ani/nidoqueen.gif","https://play.pokemonshowdown.com/sprites/ani/nidorino.gif","https://play.pokemonshowdown.com/sprites/ani/nidoking.gif","https://play.pokemonshowdown.com/sprites/ani/zubat.gif","https://play.pokemonshowdown.com/sprites/ani/golbat.gif","https://play.pokemonshowdown.com/sprites/ani/oddish.gif","https://play.pokemonshowdown.com/sprites/ani/gloom.gif","https://play.pokemonshowdown.com/sprites/ani/vileplume.gif","https://play.pokemonshowdown.com/sprites/ani/venonat.gif","https://play.pokemonshowdown.com/sprites/ani/venomoth.gif","https://play.pokemonshowdown.com/sprites/ani/bellsprout.gif","https://play.pokemonshowdown.com/sprites/ani/weepinbell.gif","https://play.pokemonshowdown.com/sprites/ani/victreebel.gif","https://play.pokemonshowdown.com/sprites/ani/tentacool.gif","https://play.pokemonshowdown.com/sprites/ani/tentacruel.gif","https://play.pokemonshowdown.com/sprites/ani/grimer.gif","https://play.pokemonshowdown.com/sprites/ani/muk.gif","https://play.pokemonshowdown.com/sprites/ani/gastly.gif","https://play.pokemonshowdown.com/sprites/ani/haunter.gif","https://play.pokemonshowdown.com/sprites/ani/gengar.gif","https://play.pokemonshowdown.com/sprites/ani/koffing.gif","https://play.pokemonshowdown.com/sprites/ani/weezing.gif","https://play.pokemonshowdown.com/sprites/ani/spinarak.gif","https://play.pokemonshowdown.com/sprites/ani/ariados.gif","https://play.pokemonshowdown.com/sprites/ani/crobat.gif","https://play.pokemonshowdown.com/sprites/ani/qwilfish.gif","https://play.pokemonshowdown.com/sprites/ani/dustox.gif","https://play.pokemonshowdown.com/sprites/ani/roselia.gif","https://play.pokemonshowdown.com/sprites/ani/gulpin.gif","https://play.pokemonshowdown.com/sprites/ani/swalot.gif","https://play.pokemonshowdown.com/sprites/ani/seviper.gif","https://play.pokemonshowdown.com/sprites/ani/budew.gif","https://play.pokemonshowdown.com/sprites/ani/roserade.gif","https://play.pokemonshowdown.com/sprites/ani/stunky.gif","https://play.pokemonshowdown.com/sprites/ani/skuntank.gif","https://play.pokemonshowdown.com/sprites/ani/skorupi.gif","https://play.pokemonshowdown.com/sprites/ani/drapion.gif","https://play.pokemonshowdown.com/sprites/ani/croagunk.gif","https://play.pokemonshowdown.com/sprites/ani/toxicroak.gif","https://play.pokemonshowdown.com/sprites/ani/venipede.gif","https://play.pokemonshowdown.com/sprites/ani/whirlipede.gif","https://play.pokemonshowdown.com/sprites/ani/scolipede.gif","https://play.pokemonshowdown.com/sprites/ani/trubbish.gif","https://play.pokemonshowdown.com/sprites/ani/garbodor.gif","https://play.pokemonshowdown.com/sprites/ani/foongus.gif","https://play.pokemonshowdown.com/sprites/ani/amoonguss.gif","https://play.pokemonshowdown.com/sprites/ani/skrelp.gif","https://play.pokemonshowdown.com/sprites/ani/dragalge.gif","https://play.pokemonshowdown.com/sprites/ani/mareanie.gif","https://play.pokemonshowdown.com/sprites/ani/toxapex.gif","https://play.pokemonshowdown.com/sprites/ani/salandit.gif","https://play.pokemonshowdown.com/sprites/ani/salazzle.gif","https://play.pokemonshowdown.com/sprites/ani/nihilego.gif","https://play.pokemonshowdown.com/sprites/ani/poipole.gif","https://play.pokemonshowdown.com/sprites/ani/naganadel.gif","https://play.pokemonshowdown.com/sprites/ani/toxel.gif","https://play.pokemonshowdown.com/sprites/ani/eternatus.gif","https://play.pokemonshowdown.com/sprites/ani/sneasler.gif","https://play.pokemonshowdown.com/sprites/ani/overqwil.gif","https://play.pokemonshowdown.com/sprites/ani/shroodle.gif","https://play.pokemonshowdown.com/sprites/ani/grafaiai.gif"],
  ground: ["https://play.pokemonshowdown.com/sprites/ani/sandshrew.gif","https://play.pokemonshowdown.com/sprites/ani/sandslash.gif","https://play.pokemonshowdown.com/sprites/ani/nidoqueen.gif","https://play.pokemonshowdown.com/sprites/ani/nidoking.gif","https://play.pokemonshowdown.com/sprites/ani/diglett.gif","https://play.pokemonshowdown.com/sprites/ani/dugtrio.gif","https://play.pokemonshowdown.com/sprites/ani/geodude.gif","https://play.pokemonshowdown.com/sprites/ani/graveler.gif","https://play.pokemonshowdown.com/sprites/ani/golem.gif","https://play.pokemonshowdown.com/sprites/ani/onix.gif","https://play.pokemonshowdown.com/sprites/ani/cubone.gif","https://play.pokemonshowdown.com/sprites/ani/marowak.gif","https://play.pokemonshowdown.com/sprites/ani/rhyhorn.gif","https://play.pokemonshowdown.com/sprites/ani/rhydon.gif","https://play.pokemonshowdown.com/sprites/ani/wooper.gif","https://play.pokemonshowdown.com/sprites/ani/quagsire.gif","https://play.pokemonshowdown.com/sprites/ani/gligar.gif","https://play.pokemonshowdown.com/sprites/ani/steelix.gif","https://play.pokemonshowdown.com/sprites/ani/swinub.gif","https://play.pokemonshowdown.com/sprites/ani/piloswine.gif","https://play.pokemonshowdown.com/sprites/ani/phanpy.gif","https://play.pokemonshowdown.com/sprites/ani/donphan.gif","https://play.pokemonshowdown.com/sprites/ani/larvitar.gif","https://play.pokemonshowdown.com/sprites/ani/pupitar.gif","https://play.pokemonshowdown.com/sprites/ani/marshtomp.gif","https://play.pokemonshowdown.com/sprites/ani/swampert.gif","https://play.pokemonshowdown.com/sprites/ani/nincada.gif","https://play.pokemonshowdown.com/sprites/ani/numel.gif","https://play.pokemonshowdown.com/sprites/ani/camerupt.gif","https://play.pokemonshowdown.com/sprites/ani/trapinch.gif","https://play.pokemonshowdown.com/sprites/ani/vibrava.gif","https://play.pokemonshowdown.com/sprites/ani/flygon.gif","https://play.pokemonshowdown.com/sprites/ani/barboach.gif","https://play.pokemonshowdown.com/sprites/ani/whiscash.gif","https://play.pokemonshowdown.com/sprites/ani/baltoy.gif","https://play.pokemonshowdown.com/sprites/ani/claydol.gif","https://play.pokemonshowdown.com/sprites/ani/groudon.gif","https://play.pokemonshowdown.com/sprites/ani/torterra.gif","https://play.pokemonshowdown.com/sprites/ani/gastrodon.gif","https://play.pokemonshowdown.com/sprites/ani/gible.gif","https://play.pokemonshowdown.com/sprites/ani/gabite.gif","https://play.pokemonshowdown.com/sprites/ani/garchomp.gif","https://play.pokemonshowdown.com/sprites/ani/hippopotas.gif","https://play.pokemonshowdown.com/sprites/ani/hippowdon.gif","https://play.pokemonshowdown.com/sprites/ani/rhyperior.gif","https://play.pokemonshowdown.com/sprites/ani/gliscor.gif","https://play.pokemonshowdown.com/sprites/ani/mamoswine.gif","https://play.pokemonshowdown.com/sprites/ani/drilbur.gif","https://play.pokemonshowdown.com/sprites/ani/excadrill.gif","https://play.pokemonshowdown.com/sprites/ani/palpitoad.gif","https://play.pokemonshowdown.com/sprites/ani/seismitoad.gif","https://play.pokemonshowdown.com/sprites/ani/sandile.gif","https://play.pokemonshowdown.com/sprites/ani/krokorok.gif","https://play.pokemonshowdown.com/sprites/ani/krookodile.gif","https://play.pokemonshowdown.com/sprites/ani/stunfisk.gif","https://play.pokemonshowdown.com/sprites/ani/golett.gif","https://play.pokemonshowdown.com/sprites/ani/golurk.gif","https://play.pokemonshowdown.com/sprites/ani/diggersby.gif","https://play.pokemonshowdown.com/sprites/ani/mudbray.gif","https://play.pokemonshowdown.com/sprites/ani/mudsdale.gif","https://play.pokemonshowdown.com/sprites/ani/sandygast.gif","https://play.pokemonshowdown.com/sprites/ani/palossand.gif","https://play.pokemonshowdown.com/sprites/ani/silicobra.gif","https://play.pokemonshowdown.com/sprites/ani/sandaconda.gif","https://play.pokemonshowdown.com/sprites/ani/runerigus.gif","https://play.pokemonshowdown.com/sprites/ani/ursaluna.gif","https://play.pokemonshowdown.com/sprites/ani/toedscool.gif","https://play.pokemonshowdown.com/sprites/ani/toedscruel.gif","https://play.pokemonshowdown.com/sprites/ani/clodsire.gif"],
  flying: ["https://play.pokemonshowdown.com/sprites/ani/charizard.gif","https://play.pokemonshowdown.com/sprites/ani/butterfree.gif","https://play.pokemonshowdown.com/sprites/ani/pidgey.gif","https://play.pokemonshowdown.com/sprites/ani/pidgeotto.gif","https://play.pokemonshowdown.com/sprites/ani/pidgeot.gif","https://play.pokemonshowdown.com/sprites/ani/spearow.gif","https://play.pokemonshowdown.com/sprites/ani/fearow.gif","https://play.pokemonshowdown.com/sprites/ani/zubat.gif","https://play.pokemonshowdown.com/sprites/ani/golbat.gif","https://play.pokemonshowdown.com/sprites/ani/farfetchd.gif","https://play.pokemonshowdown.com/sprites/ani/doduo.gif","https://play.pokemonshowdown.com/sprites/ani/dodrio.gif","https://play.pokemonshowdown.com/sprites/ani/scyther.gif","https://play.pokemonshowdown.com/sprites/ani/gyarados.gif","https://play.pokemonshowdown.com/sprites/ani/aerodactyl.gif","https://play.pokemonshowdown.com/sprites/ani/articuno.gif","https://play.pokemonshowdown.com/sprites/ani/zapdos.gif","https://play.pokemonshowdown.com/sprites/ani/moltres.gif","https://play.pokemonshowdown.com/sprites/ani/dragonite.gif","https://play.pokemonshowdown.com/sprites/ani/hoothoot.gif","https://play.pokemonshowdown.com/sprites/ani/noctowl.gif","https://play.pokemonshowdown.com/sprites/ani/ledyba.gif","https://play.pokemonshowdown.com/sprites/ani/ledian.gif","https://play.pokemonshowdown.com/sprites/ani/crobat.gif","https://play.pokemonshowdown.com/sprites/ani/togetic.gif","https://play.pokemonshowdown.com/sprites/ani/natu.gif","https://play.pokemonshowdown.com/sprites/ani/xatu.gif","https://play.pokemonshowdown.com/sprites/ani/hoppip.gif","https://play.pokemonshowdown.com/sprites/ani/skiploom.gif","https://play.pokemonshowdown.com/sprites/ani/jumpluff.gif","https://play.pokemonshowdown.com/sprites/ani/yanma.gif","https://play.pokemonshowdown.com/sprites/ani/murkrow.gif","https://play.pokemonshowdown.com/sprites/ani/gligar.gif","https://play.pokemonshowdown.com/sprites/ani/delibird.gif","https://play.pokemonshowdown.com/sprites/ani/mantine.gif","https://play.pokemonshowdown.com/sprites/ani/skarmory.gif","https://play.pokemonshowdown.com/sprites/ani/lugia.gif","https://play.pokemonshowdown.com/sprites/ani/beautifly.gif","https://play.pokemonshowdown.com/sprites/ani/taillow.gif","https://play.pokemonshowdown.com/sprites/ani/swellow.gif","https://play.pokemonshowdown.com/sprites/ani/wingull.gif","https://play.pokemonshowdown.com/sprites/ani/pelipper.gif","https://play.pokemonshowdown.com/sprites/ani/masquerain.gif","https://play.pokemonshowdown.com/sprites/ani/ninjask.gif","https://play.pokemonshowdown.com/sprites/ani/swablu.gif","https://play.pokemonshowdown.com/sprites/ani/altaria.gif","https://play.pokemonshowdown.com/sprites/ani/tropius.gif","https://play.pokemonshowdown.com/sprites/ani/salamence.gif","https://play.pokemonshowdown.com/sprites/ani/rayquaza.gif","https://play.pokemonshowdown.com/sprites/ani/starly.gif","https://play.pokemonshowdown.com/sprites/ani/staravia.gif","https://play.pokemonshowdown.com/sprites/ani/staraptor.gif","https://play.pokemonshowdown.com/sprites/ani/mothim.gif","https://play.pokemonshowdown.com/sprites/ani/combee.gif","https://play.pokemonshowdown.com/sprites/ani/vespiquen.gif","https://play.pokemonshowdown.com/sprites/ani/drifloon.gif","https://play.pokemonshowdown.com/sprites/ani/drifblim.gif","https://play.pokemonshowdown.com/sprites/ani/honchkrow.gif","https://play.pokemonshowdown.com/sprites/ani/chatot.gif","https://play.pokemonshowdown.com/sprites/ani/mantyke.gif","https://play.pokemonshowdown.com/sprites/ani/togekiss.gif","https://play.pokemonshowdown.com/sprites/ani/yanmega.gif","https://play.pokemonshowdown.com/sprites/ani/gliscor.gif","https://play.pokemonshowdown.com/sprites/ani/pidove.gif","https://play.pokemonshowdown.com/sprites/ani/tranquill.gif","https://play.pokemonshowdown.com/sprites/ani/unfezant.gif","https://play.pokemonshowdown.com/sprites/ani/woobat.gif","https://play.pokemonshowdown.com/sprites/ani/swoobat.gif","https://play.pokemonshowdown.com/sprites/ani/sigilyph.gif","https://play.pokemonshowdown.com/sprites/ani/archen.gif"],
  psychic: ["https://play.pokemonshowdown.com/sprites/ani/abra.gif","https://play.pokemonshowdown.com/sprites/ani/kadabra.gif","https://play.pokemonshowdown.com/sprites/ani/alakazam.gif","https://play.pokemonshowdown.com/sprites/ani/slowpoke.gif","https://play.pokemonshowdown.com/sprites/ani/slowbro.gif","https://play.pokemonshowdown.com/sprites/ani/drowzee.gif","https://play.pokemonshowdown.com/sprites/ani/hypno.gif","https://play.pokemonshowdown.com/sprites/ani/exeggcute.gif","https://play.pokemonshowdown.com/sprites/ani/exeggutor.gif","https://play.pokemonshowdown.com/sprites/ani/starmie.gif","https://play.pokemonshowdown.com/sprites/ani/jynx.gif","https://play.pokemonshowdown.com/sprites/ani/mewtwo.gif","https://play.pokemonshowdown.com/sprites/ani/mew.gif","https://play.pokemonshowdown.com/sprites/ani/natu.gif","https://play.pokemonshowdown.com/sprites/ani/xatu.gif","https://play.pokemonshowdown.com/sprites/ani/espeon.gif","https://play.pokemonshowdown.com/sprites/ani/slowking.gif","https://play.pokemonshowdown.com/sprites/ani/unown.gif","https://play.pokemonshowdown.com/sprites/ani/wobbuffet.gif","https://play.pokemonshowdown.com/sprites/ani/girafarig.gif","https://play.pokemonshowdown.com/sprites/ani/smoochum.gif","https://play.pokemonshowdown.com/sprites/ani/lugia.gif","https://play.pokemonshowdown.com/sprites/ani/celebi.gif","https://play.pokemonshowdown.com/sprites/ani/ralts.gif","https://play.pokemonshowdown.com/sprites/ani/kirlia.gif","https://play.pokemonshowdown.com/sprites/ani/gardevoir.gif","https://play.pokemonshowdown.com/sprites/ani/meditite.gif","https://play.pokemonshowdown.com/sprites/ani/medicham.gif","https://play.pokemonshowdown.com/sprites/ani/spoink.gif","https://play.pokemonshowdown.com/sprites/ani/grumpig.gif","https://play.pokemonshowdown.com/sprites/ani/lunatone.gif","https://play.pokemonshowdown.com/sprites/ani/solrock.gif","https://play.pokemonshowdown.com/sprites/ani/baltoy.gif","https://play.pokemonshowdown.com/sprites/ani/claydol.gif","https://play.pokemonshowdown.com/sprites/ani/chimecho.gif","https://play.pokemonshowdown.com/sprites/ani/wynaut.gif","https://play.pokemonshowdown.com/sprites/ani/beldum.gif","https://play.pokemonshowdown.com/sprites/ani/metang.gif","https://play.pokemonshowdown.com/sprites/ani/metagross.gif","https://play.pokemonshowdown.com/sprites/ani/latias.gif","https://play.pokemonshowdown.com/sprites/ani/latios.gif","https://play.pokemonshowdown.com/sprites/ani/jirachi.gif","https://play.pokemonshowdown.com/sprites/ani/chingling.gif","https://play.pokemonshowdown.com/sprites/ani/bronzor.gif","https://play.pokemonshowdown.com/sprites/ani/bronzong.gif","https://play.pokemonshowdown.com/sprites/ani/gallade.gif","https://play.pokemonshowdown.com/sprites/ani/uxie.gif","https://play.pokemonshowdown.com/sprites/ani/mesprit.gif","https://play.pokemonshowdown.com/sprites/ani/azelf.gif","https://play.pokemonshowdown.com/sprites/ani/cresselia.gif","https://play.pokemonshowdown.com/sprites/ani/victini.gif","https://play.pokemonshowdown.com/sprites/ani/munna.gif","https://play.pokemonshowdown.com/sprites/ani/musharna.gif","https://play.pokemonshowdown.com/sprites/ani/woobat.gif","https://play.pokemonshowdown.com/sprites/ani/swoobat.gif","https://play.pokemonshowdown.com/sprites/ani/sigilyph.gif","https://play.pokemonshowdown.com/sprites/ani/gothita.gif","https://play.pokemonshowdown.com/sprites/ani/gothorita.gif","https://play.pokemonshowdown.com/sprites/ani/gothitelle.gif","https://play.pokemonshowdown.com/sprites/ani/solosis.gif","https://play.pokemonshowdown.com/sprites/ani/duosion.gif","https://play.pokemonshowdown.com/sprites/ani/reuniclus.gif","https://play.pokemonshowdown.com/sprites/ani/elgyem.gif","https://play.pokemonshowdown.com/sprites/ani/beheeyem.gif","https://play.pokemonshowdown.com/sprites/ani/delphox.gif","https://play.pokemonshowdown.com/sprites/ani/espurr.gif","https://play.pokemonshowdown.com/sprites/ani/inkay.gif","https://play.pokemonshowdown.com/sprites/ani/malamar.gif","https://play.pokemonshowdown.com/sprites/ani/hoopa.gif","https://play.pokemonshowdown.com/sprites/ani/oranguru.gif"],
  bug: ["https://play.pokemonshowdown.com/sprites/ani/caterpie.gif","https://play.pokemonshowdown.com/sprites/ani/metapod.gif","https://play.pokemonshowdown.com/sprites/ani/butterfree.gif","https://play.pokemonshowdown.com/sprites/ani/weedle.gif","https://play.pokemonshowdown.com/sprites/ani/kakuna.gif","https://play.pokemonshowdown.com/sprites/ani/beedrill.gif","https://play.pokemonshowdown.com/sprites/ani/paras.gif","https://play.pokemonshowdown.com/sprites/ani/parasect.gif","https://play.pokemonshowdown.com/sprites/ani/venonat.gif","https://play.pokemonshowdown.com/sprites/ani/venomoth.gif","https://play.pokemonshowdown.com/sprites/ani/scyther.gif","https://play.pokemonshowdown.com/sprites/ani/pinsir.gif","https://play.pokemonshowdown.com/sprites/ani/ledyba.gif","https://play.pokemonshowdown.com/sprites/ani/ledian.gif","https://play.pokemonshowdown.com/sprites/ani/spinarak.gif","https://play.pokemonshowdown.com/sprites/ani/ariados.gif","https://play.pokemonshowdown.com/sprites/ani/yanma.gif","https://play.pokemonshowdown.com/sprites/ani/pineco.gif","https://play.pokemonshowdown.com/sprites/ani/forretress.gif","https://play.pokemonshowdown.com/sprites/ani/scizor.gif","https://play.pokemonshowdown.com/sprites/ani/shuckle.gif","https://play.pokemonshowdown.com/sprites/ani/heracross.gif","https://play.pokemonshowdown.com/sprites/ani/wurmple.gif","https://play.pokemonshowdown.com/sprites/ani/silcoon.gif","https://play.pokemonshowdown.com/sprites/ani/beautifly.gif","https://play.pokemonshowdown.com/sprites/ani/cascoon.gif","https://play.pokemonshowdown.com/sprites/ani/dustox.gif","https://play.pokemonshowdown.com/sprites/ani/surskit.gif","https://play.pokemonshowdown.com/sprites/ani/masquerain.gif","https://play.pokemonshowdown.com/sprites/ani/nincada.gif","https://play.pokemonshowdown.com/sprites/ani/ninjask.gif","https://play.pokemonshowdown.com/sprites/ani/shedinja.gif","https://play.pokemonshowdown.com/sprites/ani/volbeat.gif","https://play.pokemonshowdown.com/sprites/ani/illumise.gif","https://play.pokemonshowdown.com/sprites/ani/anorith.gif","https://play.pokemonshowdown.com/sprites/ani/armaldo.gif","https://play.pokemonshowdown.com/sprites/ani/kricketot.gif","https://play.pokemonshowdown.com/sprites/ani/kricketune.gif","https://play.pokemonshowdown.com/sprites/ani/burmy.gif","https://play.pokemonshowdown.com/sprites/ani/mothim.gif","https://play.pokemonshowdown.com/sprites/ani/combee.gif","https://play.pokemonshowdown.com/sprites/ani/vespiquen.gif","https://play.pokemonshowdown.com/sprites/ani/skorupi.gif","https://play.pokemonshowdown.com/sprites/ani/yanmega.gif","https://play.pokemonshowdown.com/sprites/ani/sewaddle.gif","https://play.pokemonshowdown.com/sprites/ani/swadloon.gif","https://play.pokemonshowdown.com/sprites/ani/leavanny.gif","https://play.pokemonshowdown.com/sprites/ani/venipede.gif","https://play.pokemonshowdown.com/sprites/ani/whirlipede.gif","https://play.pokemonshowdown.com/sprites/ani/scolipede.gif","https://play.pokemonshowdown.com/sprites/ani/dwebble.gif","https://play.pokemonshowdown.com/sprites/ani/crustle.gif","https://play.pokemonshowdown.com/sprites/ani/karrablast.gif","https://play.pokemonshowdown.com/sprites/ani/escavalier.gif","https://play.pokemonshowdown.com/sprites/ani/joltik.gif","https://play.pokemonshowdown.com/sprites/ani/galvantula.gif","https://play.pokemonshowdown.com/sprites/ani/shelmet.gif","https://play.pokemonshowdown.com/sprites/ani/accelgor.gif","https://play.pokemonshowdown.com/sprites/ani/durant.gif","https://play.pokemonshowdown.com/sprites/ani/larvesta.gif","https://play.pokemonshowdown.com/sprites/ani/volcarona.gif","https://play.pokemonshowdown.com/sprites/ani/genesect.gif","https://play.pokemonshowdown.com/sprites/ani/scatterbug.gif","https://play.pokemonshowdown.com/sprites/ani/spewpa.gif","https://play.pokemonshowdown.com/sprites/ani/vivillon.gif","https://play.pokemonshowdown.com/sprites/ani/grubbin.gif","https://play.pokemonshowdown.com/sprites/ani/charjabug.gif","https://play.pokemonshowdown.com/sprites/ani/vikavolt.gif","https://play.pokemonshowdown.com/sprites/ani/cutiefly.gif","https://play.pokemonshowdown.com/sprites/ani/ribombee.gif"],
  rock: ["https://play.pokemonshowdown.com/sprites/ani/geodude.gif","https://play.pokemonshowdown.com/sprites/ani/graveler.gif","https://play.pokemonshowdown.com/sprites/ani/golem.gif","https://play.pokemonshowdown.com/sprites/ani/onix.gif","https://play.pokemonshowdown.com/sprites/ani/rhyhorn.gif","https://play.pokemonshowdown.com/sprites/ani/rhydon.gif","https://play.pokemonshowdown.com/sprites/ani/omanyte.gif","https://play.pokemonshowdown.com/sprites/ani/omastar.gif","https://play.pokemonshowdown.com/sprites/ani/kabuto.gif","https://play.pokemonshowdown.com/sprites/ani/kabutops.gif","https://play.pokemonshowdown.com/sprites/ani/aerodactyl.gif","https://play.pokemonshowdown.com/sprites/ani/sudowoodo.gif","https://play.pokemonshowdown.com/sprites/ani/shuckle.gif","https://play.pokemonshowdown.com/sprites/ani/magcargo.gif","https://play.pokemonshowdown.com/sprites/ani/corsola.gif","https://play.pokemonshowdown.com/sprites/ani/larvitar.gif","https://play.pokemonshowdown.com/sprites/ani/pupitar.gif","https://play.pokemonshowdown.com/sprites/ani/tyranitar.gif","https://play.pokemonshowdown.com/sprites/ani/nosepass.gif","https://play.pokemonshowdown.com/sprites/ani/aron.gif","https://play.pokemonshowdown.com/sprites/ani/lairon.gif","https://play.pokemonshowdown.com/sprites/ani/aggron.gif","https://play.pokemonshowdown.com/sprites/ani/lunatone.gif","https://play.pokemonshowdown.com/sprites/ani/solrock.gif","https://play.pokemonshowdown.com/sprites/ani/lileep.gif","https://play.pokemonshowdown.com/sprites/ani/cradily.gif","https://play.pokemonshowdown.com/sprites/ani/anorith.gif","https://play.pokemonshowdown.com/sprites/ani/armaldo.gif","https://play.pokemonshowdown.com/sprites/ani/relicanth.gif","https://play.pokemonshowdown.com/sprites/ani/regirock.gif","https://play.pokemonshowdown.com/sprites/ani/cranidos.gif","https://play.pokemonshowdown.com/sprites/ani/rampardos.gif","https://play.pokemonshowdown.com/sprites/ani/shieldon.gif","https://play.pokemonshowdown.com/sprites/ani/bastiodon.gif","https://play.pokemonshowdown.com/sprites/ani/bonsly.gif","https://play.pokemonshowdown.com/sprites/ani/rhyperior.gif","https://play.pokemonshowdown.com/sprites/ani/probopass.gif","https://play.pokemonshowdown.com/sprites/ani/roggenrola.gif","https://play.pokemonshowdown.com/sprites/ani/boldore.gif","https://play.pokemonshowdown.com/sprites/ani/gigalith.gif","https://play.pokemonshowdown.com/sprites/ani/dwebble.gif","https://play.pokemonshowdown.com/sprites/ani/crustle.gif","https://play.pokemonshowdown.com/sprites/ani/tirtouga.gif","https://play.pokemonshowdown.com/sprites/ani/carracosta.gif","https://play.pokemonshowdown.com/sprites/ani/archen.gif","https://play.pokemonshowdown.com/sprites/ani/archeops.gif","https://play.pokemonshowdown.com/sprites/ani/terrakion.gif","https://play.pokemonshowdown.com/sprites/ani/binacle.gif","https://play.pokemonshowdown.com/sprites/ani/barbaracle.gif","https://play.pokemonshowdown.com/sprites/ani/tyrunt.gif","https://play.pokemonshowdown.com/sprites/ani/tyrantrum.gif","https://play.pokemonshowdown.com/sprites/ani/amaura.gif","https://play.pokemonshowdown.com/sprites/ani/aurorus.gif","https://play.pokemonshowdown.com/sprites/ani/carbink.gif","https://play.pokemonshowdown.com/sprites/ani/diancie.gif","https://play.pokemonshowdown.com/sprites/ani/rockruff.gif","https://play.pokemonshowdown.com/sprites/ani/nihilego.gif","https://play.pokemonshowdown.com/sprites/ani/stakataka.gif","https://play.pokemonshowdown.com/sprites/ani/drednaw.gif","https://play.pokemonshowdown.com/sprites/ani/rolycoly.gif","https://play.pokemonshowdown.com/sprites/ani/carkol.gif","https://play.pokemonshowdown.com/sprites/ani/coalossal.gif","https://play.pokemonshowdown.com/sprites/ani/stonjourner.gif","https://play.pokemonshowdown.com/sprites/ani/kleavor.gif","https://play.pokemonshowdown.com/sprites/ani/nacli.gif","https://play.pokemonshowdown.com/sprites/ani/naclstack.gif","https://play.pokemonshowdown.com/sprites/ani/garganacl.gif","https://play.pokemonshowdown.com/sprites/ani/klawf.gif","https://play.pokemonshowdown.com/sprites/ani/glimmet.gif","https://play.pokemonshowdown.com/sprites/ani/glimmora.gif"],
  ghost: ["https://play.pokemonshowdown.com/sprites/ani/gastly.gif","https://play.pokemonshowdown.com/sprites/ani/haunter.gif","https://play.pokemonshowdown.com/sprites/ani/gengar.gif","https://play.pokemonshowdown.com/sprites/ani/misdreavus.gif","https://play.pokemonshowdown.com/sprites/ani/shedinja.gif","https://play.pokemonshowdown.com/sprites/ani/sableye.gif","https://play.pokemonshowdown.com/sprites/ani/shuppet.gif","https://play.pokemonshowdown.com/sprites/ani/banette.gif","https://play.pokemonshowdown.com/sprites/ani/duskull.gif","https://play.pokemonshowdown.com/sprites/ani/dusclops.gif","https://play.pokemonshowdown.com/sprites/ani/drifloon.gif","https://play.pokemonshowdown.com/sprites/ani/drifblim.gif","https://play.pokemonshowdown.com/sprites/ani/mismagius.gif","https://play.pokemonshowdown.com/sprites/ani/spiritomb.gif","https://play.pokemonshowdown.com/sprites/ani/dusknoir.gif","https://play.pokemonshowdown.com/sprites/ani/froslass.gif","https://play.pokemonshowdown.com/sprites/ani/rotom.gif","https://play.pokemonshowdown.com/sprites/ani/yamask.gif","https://play.pokemonshowdown.com/sprites/ani/cofagrigus.gif","https://play.pokemonshowdown.com/sprites/ani/litwick.gif","https://play.pokemonshowdown.com/sprites/ani/lampent.gif","https://play.pokemonshowdown.com/sprites/ani/chandelure.gif","https://play.pokemonshowdown.com/sprites/ani/golett.gif","https://play.pokemonshowdown.com/sprites/ani/golurk.gif","https://play.pokemonshowdown.com/sprites/ani/honedge.gif","https://play.pokemonshowdown.com/sprites/ani/doublade.gif","https://play.pokemonshowdown.com/sprites/ani/phantump.gif","https://play.pokemonshowdown.com/sprites/ani/trevenant.gif","https://play.pokemonshowdown.com/sprites/ani/hoopa.gif","https://play.pokemonshowdown.com/sprites/ani/decidueye.gif","https://play.pokemonshowdown.com/sprites/ani/sandygast.gif","https://play.pokemonshowdown.com/sprites/ani/palossand.gif","https://play.pokemonshowdown.com/sprites/ani/dhelmise.gif","https://play.pokemonshowdown.com/sprites/ani/lunala.gif","https://play.pokemonshowdown.com/sprites/ani/marshadow.gif","https://play.pokemonshowdown.com/sprites/ani/blacephalon.gif","https://play.pokemonshowdown.com/sprites/ani/sinistea.gif","https://play.pokemonshowdown.com/sprites/ani/polteageist.gif","https://play.pokemonshowdown.com/sprites/ani/cursola.gif","https://play.pokemonshowdown.com/sprites/ani/runerigus.gif","https://play.pokemonshowdown.com/sprites/ani/dreepy.gif","https://play.pokemonshowdown.com/sprites/ani/drakloak.gif","https://play.pokemonshowdown.com/sprites/ani/dragapult.gif","https://play.pokemonshowdown.com/sprites/ani/spectrier.gif","https://play.pokemonshowdown.com/sprites/ani/skeledirge.gif","https://play.pokemonshowdown.com/sprites/ani/ceruledge.gif","https://play.pokemonshowdown.com/sprites/ani/bramblin.gif","https://play.pokemonshowdown.com/sprites/ani/brambleghast.gif","https://play.pokemonshowdown.com/sprites/ani/greavard.gif","https://play.pokemonshowdown.com/sprites/ani/houndstone.gif","https://play.pokemonshowdown.com/sprites/ani/annihilape.gif","https://play.pokemonshowdown.com/sprites/ani/gimmighoul.gif","https://play.pokemonshowdown.com/sprites/ani/gholdengo.gif","https://play.pokemonshowdown.com/sprites/ani/poltchageist.gif","https://play.pokemonshowdown.com/sprites/ani/sinistcha.gif","https://play.pokemonshowdown.com/sprites/ani/pecharunt.gif"],
  dragon: ["https://play.pokemonshowdown.com/sprites/ani/dratini.gif","https://play.pokemonshowdown.com/sprites/ani/dragonair.gif","https://play.pokemonshowdown.com/sprites/ani/dragonite.gif","https://play.pokemonshowdown.com/sprites/ani/kingdra.gif","https://play.pokemonshowdown.com/sprites/ani/vibrava.gif","https://play.pokemonshowdown.com/sprites/ani/flygon.gif","https://play.pokemonshowdown.com/sprites/ani/altaria.gif","https://play.pokemonshowdown.com/sprites/ani/bagon.gif","https://play.pokemonshowdown.com/sprites/ani/shelgon.gif","https://play.pokemonshowdown.com/sprites/ani/salamence.gif","https://play.pokemonshowdown.com/sprites/ani/latias.gif","https://play.pokemonshowdown.com/sprites/ani/latios.gif","https://play.pokemonshowdown.com/sprites/ani/rayquaza.gif","https://play.pokemonshowdown.com/sprites/ani/gible.gif","https://play.pokemonshowdown.com/sprites/ani/gabite.gif","https://play.pokemonshowdown.com/sprites/ani/garchomp.gif","https://play.pokemonshowdown.com/sprites/ani/dialga.gif","https://play.pokemonshowdown.com/sprites/ani/palkia.gif","https://play.pokemonshowdown.com/sprites/ani/axew.gif","https://play.pokemonshowdown.com/sprites/ani/fraxure.gif","https://play.pokemonshowdown.com/sprites/ani/haxorus.gif","https://play.pokemonshowdown.com/sprites/ani/druddigon.gif","https://play.pokemonshowdown.com/sprites/ani/deino.gif","https://play.pokemonshowdown.com/sprites/ani/zweilous.gif","https://play.pokemonshowdown.com/sprites/ani/hydreigon.gif","https://play.pokemonshowdown.com/sprites/ani/reshiram.gif","https://play.pokemonshowdown.com/sprites/ani/zekrom.gif","https://play.pokemonshowdown.com/sprites/ani/kyurem.gif","https://play.pokemonshowdown.com/sprites/ani/dragalge.gif","https://play.pokemonshowdown.com/sprites/ani/tyrunt.gif","https://play.pokemonshowdown.com/sprites/ani/tyrantrum.gif","https://play.pokemonshowdown.com/sprites/ani/goomy.gif","https://play.pokemonshowdown.com/sprites/ani/sliggoo.gif","https://play.pokemonshowdown.com/sprites/ani/goodra.gif","https://play.pokemonshowdown.com/sprites/ani/noibat.gif","https://play.pokemonshowdown.com/sprites/ani/noivern.gif","https://play.pokemonshowdown.com/sprites/ani/turtonator.gif","https://play.pokemonshowdown.com/sprites/ani/drampa.gif","https://play.pokemonshowdown.com/sprites/ani/guzzlord.gif","https://play.pokemonshowdown.com/sprites/ani/naganadel.gif","https://play.pokemonshowdown.com/sprites/ani/applin.gif","https://play.pokemonshowdown.com/sprites/ani/flapple.gif","https://play.pokemonshowdown.com/sprites/ani/appletun.gif","https://play.pokemonshowdown.com/sprites/ani/dracozolt.gif","https://play.pokemonshowdown.com/sprites/ani/dracovish.gif","https://play.pokemonshowdown.com/sprites/ani/duraludon.gif","https://play.pokemonshowdown.com/sprites/ani/dreepy.gif","https://play.pokemonshowdown.com/sprites/ani/drakloak.gif","https://play.pokemonshowdown.com/sprites/ani/dragapult.gif","https://play.pokemonshowdown.com/sprites/ani/eternatus.gif","https://play.pokemonshowdown.com/sprites/ani/regidrago.gif","https://play.pokemonshowdown.com/sprites/ani/cyclizar.gif","https://play.pokemonshowdown.com/sprites/ani/frigibax.gif","https://play.pokemonshowdown.com/sprites/ani/arctibax.gif","https://play.pokemonshowdown.com/sprites/ani/baxcalibur.gif","https://play.pokemonshowdown.com/sprites/ani/koraidon.gif","https://play.pokemonshowdown.com/sprites/ani/miraidon.gif","https://play.pokemonshowdown.com/sprites/ani/dipplin.gif","https://play.pokemonshowdown.com/sprites/ani/archaludon.gif","https://play.pokemonshowdown.com/sprites/ani/hydrapple.gif"],
  dark: ["https://play.pokemonshowdown.com/sprites/ani/umbreon.gif","https://play.pokemonshowdown.com/sprites/ani/murkrow.gif","https://play.pokemonshowdown.com/sprites/ani/sneasel.gif","https://play.pokemonshowdown.com/sprites/ani/houndour.gif","https://play.pokemonshowdown.com/sprites/ani/houndoom.gif","https://play.pokemonshowdown.com/sprites/ani/tyranitar.gif","https://play.pokemonshowdown.com/sprites/ani/poochyena.gif","https://play.pokemonshowdown.com/sprites/ani/mightyena.gif","https://play.pokemonshowdown.com/sprites/ani/nuzleaf.gif","https://play.pokemonshowdown.com/sprites/ani/shiftry.gif","https://play.pokemonshowdown.com/sprites/ani/sableye.gif","https://play.pokemonshowdown.com/sprites/ani/carvanha.gif","https://play.pokemonshowdown.com/sprites/ani/sharpedo.gif","https://play.pokemonshowdown.com/sprites/ani/cacturne.gif","https://play.pokemonshowdown.com/sprites/ani/crawdaunt.gif","https://play.pokemonshowdown.com/sprites/ani/absol.gif","https://play.pokemonshowdown.com/sprites/ani/honchkrow.gif","https://play.pokemonshowdown.com/sprites/ani/stunky.gif","https://play.pokemonshowdown.com/sprites/ani/skuntank.gif","https://play.pokemonshowdown.com/sprites/ani/spiritomb.gif","https://play.pokemonshowdown.com/sprites/ani/drapion.gif","https://play.pokemonshowdown.com/sprites/ani/weavile.gif","https://play.pokemonshowdown.com/sprites/ani/darkrai.gif","https://play.pokemonshowdown.com/sprites/ani/purrloin.gif","https://play.pokemonshowdown.com/sprites/ani/liepard.gif","https://play.pokemonshowdown.com/sprites/ani/sandile.gif","https://play.pokemonshowdown.com/sprites/ani/krokorok.gif","https://play.pokemonshowdown.com/sprites/ani/krookodile.gif","https://play.pokemonshowdown.com/sprites/ani/scraggy.gif","https://play.pokemonshowdown.com/sprites/ani/scrafty.gif","https://play.pokemonshowdown.com/sprites/ani/zorua.gif","https://play.pokemonshowdown.com/sprites/ani/zoroark.gif","https://play.pokemonshowdown.com/sprites/ani/pawniard.gif","https://play.pokemonshowdown.com/sprites/ani/bisharp.gif","https://play.pokemonshowdown.com/sprites/ani/vullaby.gif","https://play.pokemonshowdown.com/sprites/ani/mandibuzz.gif","https://play.pokemonshowdown.com/sprites/ani/deino.gif","https://play.pokemonshowdown.com/sprites/ani/zweilous.gif","https://play.pokemonshowdown.com/sprites/ani/hydreigon.gif","https://play.pokemonshowdown.com/sprites/ani/greninja.gif","https://play.pokemonshowdown.com/sprites/ani/pangoro.gif","https://play.pokemonshowdown.com/sprites/ani/inkay.gif","https://play.pokemonshowdown.com/sprites/ani/malamar.gif","https://play.pokemonshowdown.com/sprites/ani/yveltal.gif","https://play.pokemonshowdown.com/sprites/ani/incineroar.gif","https://play.pokemonshowdown.com/sprites/ani/guzzlord.gif","https://play.pokemonshowdown.com/sprites/ani/nickit.gif","https://play.pokemonshowdown.com/sprites/ani/thievul.gif","https://play.pokemonshowdown.com/sprites/ani/impidimp.gif","https://play.pokemonshowdown.com/sprites/ani/morgrem.gif","https://play.pokemonshowdown.com/sprites/ani/grimmsnarl.gif","https://play.pokemonshowdown.com/sprites/ani/obstagoon.gif","https://play.pokemonshowdown.com/sprites/ani/zarude.gif","https://play.pokemonshowdown.com/sprites/ani/overqwil.gif","https://play.pokemonshowdown.com/sprites/ani/meowscarada.gif","https://play.pokemonshowdown.com/sprites/ani/lokix.gif","https://play.pokemonshowdown.com/sprites/ani/maschiff.gif","https://play.pokemonshowdown.com/sprites/ani/mabosstiff.gif","https://play.pokemonshowdown.com/sprites/ani/bombirdier.gif","https://play.pokemonshowdown.com/sprites/ani/kingambit.gif"],
  steel: ["https://play.pokemonshowdown.com/sprites/ani/magnemite.gif","https://play.pokemonshowdown.com/sprites/ani/magneton.gif","https://play.pokemonshowdown.com/sprites/ani/forretress.gif","https://play.pokemonshowdown.com/sprites/ani/steelix.gif","https://play.pokemonshowdown.com/sprites/ani/scizor.gif","https://play.pokemonshowdown.com/sprites/ani/skarmory.gif","https://play.pokemonshowdown.com/sprites/ani/mawile.gif","https://play.pokemonshowdown.com/sprites/ani/aron.gif","https://play.pokemonshowdown.com/sprites/ani/lairon.gif","https://play.pokemonshowdown.com/sprites/ani/aggron.gif","https://play.pokemonshowdown.com/sprites/ani/beldum.gif","https://play.pokemonshowdown.com/sprites/ani/metang.gif","https://play.pokemonshowdown.com/sprites/ani/metagross.gif","https://play.pokemonshowdown.com/sprites/ani/registeel.gif","https://play.pokemonshowdown.com/sprites/ani/jirachi.gif","https://play.pokemonshowdown.com/sprites/ani/empoleon.gif","https://play.pokemonshowdown.com/sprites/ani/shieldon.gif","https://play.pokemonshowdown.com/sprites/ani/bastiodon.gif","https://play.pokemonshowdown.com/sprites/ani/bronzor.gif","https://play.pokemonshowdown.com/sprites/ani/bronzong.gif","https://play.pokemonshowdown.com/sprites/ani/lucario.gif","https://play.pokemonshowdown.com/sprites/ani/magnezone.gif","https://play.pokemonshowdown.com/sprites/ani/probopass.gif","https://play.pokemonshowdown.com/sprites/ani/dialga.gif","https://play.pokemonshowdown.com/sprites/ani/heatran.gif","https://play.pokemonshowdown.com/sprites/ani/excadrill.gif","https://play.pokemonshowdown.com/sprites/ani/escavalier.gif","https://play.pokemonshowdown.com/sprites/ani/ferroseed.gif","https://play.pokemonshowdown.com/sprites/ani/ferrothorn.gif","https://play.pokemonshowdown.com/sprites/ani/klink.gif","https://play.pokemonshowdown.com/sprites/ani/klang.gif","https://play.pokemonshowdown.com/sprites/ani/klinklang.gif","https://play.pokemonshowdown.com/sprites/ani/pawniard.gif","https://play.pokemonshowdown.com/sprites/ani/bisharp.gif","https://play.pokemonshowdown.com/sprites/ani/durant.gif","https://play.pokemonshowdown.com/sprites/ani/cobalion.gif","https://play.pokemonshowdown.com/sprites/ani/genesect.gif","https://play.pokemonshowdown.com/sprites/ani/honedge.gif","https://play.pokemonshowdown.com/sprites/ani/doublade.gif","https://play.pokemonshowdown.com/sprites/ani/klefki.gif","https://play.pokemonshowdown.com/sprites/ani/togedemaru.gif","https://play.pokemonshowdown.com/sprites/ani/solgaleo.gif","https://play.pokemonshowdown.com/sprites/ani/celesteela.gif","https://play.pokemonshowdown.com/sprites/ani/kartana.gif","https://play.pokemonshowdown.com/sprites/ani/magearna.gif","https://play.pokemonshowdown.com/sprites/ani/stakataka.gif","https://play.pokemonshowdown.com/sprites/ani/meltan.gif","https://play.pokemonshowdown.com/sprites/ani/melmetal.gif","https://play.pokemonshowdown.com/sprites/ani/corviknight.gif","https://play.pokemonshowdown.com/sprites/ani/perrserker.gif","https://play.pokemonshowdown.com/sprites/ani/cufant.gif","https://play.pokemonshowdown.com/sprites/ani/copperajah.gif","https://play.pokemonshowdown.com/sprites/ani/duraludon.gif","https://play.pokemonshowdown.com/sprites/ani/tinkatink.gif","https://play.pokemonshowdown.com/sprites/ani/tinkatuff.gif","https://play.pokemonshowdown.com/sprites/ani/tinkaton.gif","https://play.pokemonshowdown.com/sprites/ani/varoom.gif","https://play.pokemonshowdown.com/sprites/ani/revavroom.gif","https://play.pokemonshowdown.com/sprites/ani/orthworm.gif","https://play.pokemonshowdown.com/sprites/ani/kingambit.gif","https://play.pokemonshowdown.com/sprites/ani/gholdengo.gif","https://play.pokemonshowdown.com/sprites/ani/archaludon.gif"],
  fairy: ["https://play.pokemonshowdown.com/sprites/ani/clefairy.gif","https://play.pokemonshowdown.com/sprites/ani/clefable.gif","https://play.pokemonshowdown.com/sprites/ani/jigglypuff.gif","https://play.pokemonshowdown.com/sprites/ani/wigglytuff.gif","https://play.pokemonshowdown.com/sprites/ani/cleffa.gif","https://play.pokemonshowdown.com/sprites/ani/igglybuff.gif","https://play.pokemonshowdown.com/sprites/ani/togepi.gif","https://play.pokemonshowdown.com/sprites/ani/togetic.gif","https://play.pokemonshowdown.com/sprites/ani/marill.gif","https://play.pokemonshowdown.com/sprites/ani/azumarill.gif","https://play.pokemonshowdown.com/sprites/ani/snubbull.gif","https://play.pokemonshowdown.com/sprites/ani/granbull.gif","https://play.pokemonshowdown.com/sprites/ani/ralts.gif","https://play.pokemonshowdown.com/sprites/ani/kirlia.gif","https://play.pokemonshowdown.com/sprites/ani/gardevoir.gif","https://play.pokemonshowdown.com/sprites/ani/azurill.gif","https://play.pokemonshowdown.com/sprites/ani/mawile.gif","https://play.pokemonshowdown.com/sprites/ani/togekiss.gif","https://play.pokemonshowdown.com/sprites/ani/cottonee.gif","https://play.pokemonshowdown.com/sprites/ani/whimsicott.gif","https://play.pokemonshowdown.com/sprites/ani/flabebe.gif","https://play.pokemonshowdown.com/sprites/ani/floette.gif","https://play.pokemonshowdown.com/sprites/ani/florges.gif","https://play.pokemonshowdown.com/sprites/ani/spritzee.gif","https://play.pokemonshowdown.com/sprites/ani/aromatisse.gif","https://play.pokemonshowdown.com/sprites/ani/swirlix.gif","https://play.pokemonshowdown.com/sprites/ani/slurpuff.gif","https://play.pokemonshowdown.com/sprites/ani/sylveon.gif","https://play.pokemonshowdown.com/sprites/ani/dedenne.gif","https://play.pokemonshowdown.com/sprites/ani/carbink.gif","https://play.pokemonshowdown.com/sprites/ani/klefki.gif","https://play.pokemonshowdown.com/sprites/ani/xerneas.gif","https://play.pokemonshowdown.com/sprites/ani/diancie.gif","https://play.pokemonshowdown.com/sprites/ani/primarina.gif","https://play.pokemonshowdown.com/sprites/ani/cutiefly.gif","https://play.pokemonshowdown.com/sprites/ani/ribombee.gif","https://play.pokemonshowdown.com/sprites/ani/morelull.gif","https://play.pokemonshowdown.com/sprites/ani/shiinotic.gif","https://play.pokemonshowdown.com/sprites/ani/comfey.gif","https://play.pokemonshowdown.com/sprites/ani/magearna.gif","https://play.pokemonshowdown.com/sprites/ani/hatterene.gif","https://play.pokemonshowdown.com/sprites/ani/impidimp.gif","https://play.pokemonshowdown.com/sprites/ani/morgrem.gif","https://play.pokemonshowdown.com/sprites/ani/grimmsnarl.gif","https://play.pokemonshowdown.com/sprites/ani/milcery.gif","https://play.pokemonshowdown.com/sprites/ani/alcremie.gif","https://play.pokemonshowdown.com/sprites/ani/zacian.gif","https://play.pokemonshowdown.com/sprites/ani/fidough.gif","https://play.pokemonshowdown.com/sprites/ani/dachsbun.gif","https://play.pokemonshowdown.com/sprites/ani/tinkatink.gif","https://play.pokemonshowdown.com/sprites/ani/tinkatuff.gif","https://play.pokemonshowdown.com/sprites/ani/tinkaton.gif","https://play.pokemonshowdown.com/sprites/ani/fezandipiti.gif"]
};

  const TYPE_NAMES = { normal: 'NORMAL', fire: 'ATEŞ', water: 'SU', electric: 'ELEKTRİK', grass: 'ÇİMEN', ice: 'BUZ', fighting: 'DÖVÜŞ', poison: 'ZEHİR', ground: 'TOPRAK', flying: 'UÇAN', psychic: 'PSİŞİK', bug: 'BÖCEK', rock: 'KAYA', ghost: 'HAYALET', dragon: 'EJDERHA', dark: 'KARANLIK', steel: 'ÇELİK', fairy: 'PERİ' };
  const TYPE_COLORS = { normal: '#9ca3af', fire: '#ef4444', water: '#3b82f6', electric: '#eab308', grass: '#22c55e', ice: '#38bdf8', fighting: '#f97316', poison: '#a855f7', ground: '#d97706', flying: '#818cf8', psychic: '#f43f5e', bug: '#84cc16', rock: '#78716c', ghost: '#6366f1', dragon: '#3b82f6', dark: '#1e293b', steel: '#94a3b8', fairy: '#ec4899' };
  const UNKNOWN_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23333'/%3E%3Ctext x='50' y='65' font-size='40' text-anchor='middle' fill='%23fff'%3E?%3C/text%3E%3C/svg%3E";

  const typeChart = {
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
};

  const setActivity = (act) => {
    closeAllCards(false, 'poke-card');
    document.getElementById('activities-modal').classList.add('hidden');
    broadcast({ type: 'activity_change', activity: act });
    if (act === 'poke') document.getElementById('poke-card').classList.remove('hidden');
  };

  document.getElementById('act-poke')?.addEventListener('click', () => {
    if (state.activeLobbyId && !state.isLobbyHost) {
      closeAllCards(false, 'poke-card');
      document.getElementById('activities-modal').classList.add('hidden');
      document.getElementById('poke-card').classList.remove('hidden');
      return;
    }
    setActivity('poke');
  });

  document.getElementById('poke-close')?.addEventListener('click', () => {
    closeAllCards(true);
    broadcast({ type: 'activity_change', activity: 'none' });
    window.pokeState = { p1: null, p2: null, spectators: [], round: 0, status: 'waiting' };
    renderPokeLobby();
  });

  const renderPokeLobby = () => {
    if (pokeState.status === 'waiting') {
      document.getElementById('poke-lobby-view').classList.remove('hidden');
      document.getElementById('poke-battle-view').classList.add('hidden');
      
      // P1
      if (pokeState.p1) {
        document.getElementById('poke-wait-1').style.display = 'none';
        document.getElementById('poke-avatar-1').style.display = 'block';
        document.getElementById('poke-avatar-1').src = pokeState.p1.avatar || UNKNOWN_AVATAR;
        document.getElementById('poke-name-1').textContent = pokeState.p1.name;
        document.getElementById('poke-join-1').classList.add('hidden');
      } else {
        document.getElementById('poke-wait-1').style.display = 'block';
        document.getElementById('poke-avatar-1').style.display = 'none';
        document.getElementById('poke-name-1').textContent = "Oyuncu 1 Bekleniyor...";
        document.getElementById('poke-join-1').classList.remove('hidden');
      }

      // P2
      if (pokeState.p2) {
        document.getElementById('poke-wait-2').style.display = 'none';
        document.getElementById('poke-avatar-2').style.display = 'block';
        document.getElementById('poke-avatar-2').src = pokeState.p2.avatar || UNKNOWN_AVATAR;
        document.getElementById('poke-name-2').textContent = pokeState.p2.name;
        document.getElementById('poke-join-2').classList.add('hidden');
      } else {
        document.getElementById('poke-wait-2').style.display = 'block';
        document.getElementById('poke-avatar-2').style.display = 'none';
        document.getElementById('poke-name-2').textContent = "Oyuncu 2 Bekleniyor...";
        document.getElementById('poke-join-2').classList.remove('hidden');
      }

      const isHost = (state.activeLobbyId && state.isLobbyHost) || true; // Fallback
      if (pokeState.p1 && pokeState.p2 && isHost) {
        document.getElementById('poke-start-btn').classList.remove('hidden');
      } else {
        document.getElementById('poke-start-btn').classList.add('hidden');
      }
    } else {
      document.getElementById('poke-lobby-view').classList.add('hidden');
      document.getElementById('poke-battle-view').classList.remove('hidden');
      customRenderBattleArena();
    }
  };

  
  const getMoveSpeed = (name) => {
    if (!name) return 5;
    let h = 0;
    for(let i=0; i<name.length; i++) h += name.charCodeAt(i);
    return (h % 10) + 1;
  };

  const TYPE_EMOJIS = {
  normal: '💫', fire: '☄️', water: '🌊', electric: '🌩️', grass: '🍃',
  ice: '🧊', fighting: '👊', poison: '🦠', ground: '🪨', flying: '🌪️',
  psychic: '🔮', bug: '🕸️', rock: '🗿', ghost: '🌫️', dragon: '🐲',
  dark: '🌌', steel: '🛸', fairy: '💖'
};


  const generateGuide = () => {
    const guideContent = document.getElementById('poke-guide-content');
    if (!guideContent) return;
    guideContent.innerHTML = '';
    
    for (const type in typeChart) {
      const strengths = [];
      const weaknesses = [];
      
      for (const target in typeChart[type]) {
        const dmg = typeChart[type][target];
        if (dmg === 2) strengths.push(target);
        if (dmg === 0.5 || dmg === 0) weaknesses.push(target);
      }
      
      const translateName = (t) => TYPE_NAMES[t] || t.toUpperCase();
      const color = TYPE_COLORS[type];
      
      const renderBadges = (types) => types.map(t => `<span style="background: ${TYPE_COLORS[t]}22; color: ${TYPE_COLORS[t]}; border: 1px solid ${TYPE_COLORS[t]}66; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; margin-right: 4px; margin-bottom: 4px; display: inline-block;">${TYPE_EMOJIS[t] || ''} ${translateName(t)}</span>`).join('');
      
      guideContent.innerHTML += `
        <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; border-left: 4px solid ${color}; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
          <h3 style="color: ${color}; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px; text-shadow: 0 0 10px ${color}66;">
            <span style="font-size: 20px;">${TYPE_EMOJIS[type] || ''}</span> ${translateName(type)}
          </h3>
          <div style="margin-bottom: 10px;">
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">⚔️ <b>Hasar Verir (2x)</b></div>
            <div>${strengths.length > 0 ? renderBadges(strengths) : '<span style="color: #64748b; font-size: 12px; font-style: italic;">Kimseye</span>'}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">🛡️ <b>Zayıf Vurur (0.5x)</b></div>
            <div>${weaknesses.length > 0 ? renderBadges(weaknesses) : '<span style="color: #64748b; font-size: 12px; font-style: italic;">Kimseye</span>'}</div>
          </div>
        </div>
      `;
    }
  };

  
  const pVolMute = document.getElementById('poke-vol-mute');
  const pVolSlider = document.getElementById('poke-vol-slider');

  if(pVolMute && pVolSlider) {
    pVolMute.addEventListener('click', () => {
      pokeMuted = !pokeMuted;
      if(pokeMuted) {
        pVolMute.textContent = '🔇';
        pVolSlider.value = 0;
      } else {
        pVolMute.textContent = '🔊';
        pVolSlider.value = pokeVol * 100;
      }
    });

    pVolSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      pokeVol = val / 100;
      if(val === 0) {
        pokeMuted = true;
        pVolMute.textContent = '🔇';
      } else {
        pokeMuted = false;
        pVolMute.textContent = '🔊';
      }
    });
  }


  const guideBtn = document.getElementById('poke-guide-btn');
  const guideModal = document.getElementById('poke-guide-modal');
  const guideClose = document.getElementById('poke-guide-close');

  if(guideBtn) {
    guideBtn.addEventListener('click', () => {
      generateGuide();
      guideModal.classList.remove('hidden');
    });
  }
  if(guideClose) {
    guideClose.addEventListener('click', () => {
      guideModal.classList.add('hidden');
    });
  }


  
  const playPokemonCry = (pokemonUrl) => {
    try {
      if (!pokemonUrl) return;
      const parts = pokemonUrl.split('/');
      let name = parts[parts.length - 1].replace('.gif', '').toLowerCase();
      name = name.split('-')[0]; // Strip form suffixes just in case
      const audio = new Audio('https://play.pokemonshowdown.com/audio/cries/' + name + '.mp3');
      audio.volume = pokeMuted ? 0 : pokeVol;
      audio.play().catch(e => console.log('Audio play blocked:', e));
    } catch(e) {}
  };

  // Join slots
  document.getElementById('poke-join-1')?.addEventListener('click', () => {
    broadcastPokeMsg({ type: 'poke_join', slot: 1, id: state.myId, name: state.myName, avatar: state.myAvatar });
  });
  document.getElementById('poke-join-2')?.addEventListener('click', () => {
    broadcastPokeMsg({ type: 'poke_join', slot: 2, id: state.myId, name: state.myName, avatar: state.myAvatar });
  });

  document.getElementById('poke-bot-2')?.addEventListener('click', () => {
    broadcastPokeMsg({ type: 'poke_join', slot: 2, id: 'BOT', name: '🤖 Taktik Ustası Bot', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=PokeBot' });
  });

  // Start Battle
  document.getElementById('poke-start-btn')?.addEventListener('click', () => {
    const randT = document.getElementById('poke-random-moves-toggle'); broadcastPokeMsg({ type: 'poke_start', randomMoves: randT ? randT.checked : true });
  });

  // Selection
  document.querySelectorAll('.poke-type-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.getAttribute('data-type');
      broadcastPokeMsg({ type: 'poke_select', id: state.myId, pokeType: type });
    });
  });

  // Withdraw and Mercy
  document.getElementById('poke-withdraw-selection-btn')?.addEventListener('click', () => {
     broadcastPokeMsg({ type: 'poke_withdraw' });
  });
  
  document.getElementById('poke-surrender-btn')?.addEventListener('click', () => {
     broadcastPokeMsg({ type: 'poke_mercy_request', id: state.myId });
  });
  
  document.getElementById('poke-mercy-accept-btn')?.addEventListener('click', () => {
     broadcastPokeMsg({ type: 'poke_mercy_accept', id: state.myId });
  });
  
  document.getElementById('poke-mercy-reject-btn')?.addEventListener('click', () => {
     broadcastPokeMsg({ type: 'poke_mercy_reject', id: state.myId });
  });

  // Next Round
  document.getElementById('poke-next-round-btn')?.addEventListener('click', () => {
    const randT = document.getElementById('poke-random-moves-toggle'); broadcastPokeMsg({ type: 'poke_start', randomMoves: randT ? randT.checked : true });
  });


  const generateRealisticAttack = (attackerSlot, defenderSlot, moveType) => {
      const area = document.getElementById('poke-effect-area');
      if (!area) return;
      const isP1 = attackerSlot === 'p1';
      const atkImg = document.getElementById('poke-' + attackerSlot + '-pokemon');
      const defImg = document.getElementById('poke-' + defenderSlot + '-pokemon');
      
      let startX = isP1 ? -150 : 150;
      let targetX = isP1 ? 150 : -150;
      let baseStartY = 0;
      let baseTargetY = 0;
      
      if (atkImg && defImg && area) {
         const areaRect = area.getBoundingClientRect();
         const atkRect = atkImg.getBoundingClientRect();
         const defRect = defImg.getBoundingClientRect();
         
         startX = (atkRect.left + atkRect.width / 2) - (areaRect.left + areaRect.width / 2);
         baseStartY = (atkRect.top + atkRect.height / 2) - (areaRect.top + areaRect.height / 2);
         
         targetX = (defRect.left + defRect.width / 2) - (areaRect.left + areaRect.width / 2);
         baseTargetY = (defRect.top + defRect.height / 2) - (areaRect.top + areaRect.height / 2);
      }
      
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.zIndex = '50';
      container.style.pointerEvents = 'none';
      container.style.width = '100%';
      container.style.height = '100%';
      area.appendChild(container);

      const createParticle = (config) => {
          const p = document.createElement('div');
          p.style.position = 'absolute';
          p.style.left = '50%';
          p.style.top = '50%';
          p.style.width = config.w + 'px';
          p.style.height = config.h + 'px';
          p.style.background = config.color;
          p.style.borderRadius = config.radius || '50%';
          p.style.boxShadow = config.shadow || `0 0 10px ${config.color}`;
          if (config.clipPath) p.style.clipPath = config.clipPath;
          p.style.opacity = config.opacity !== undefined ? config.opacity : 1;
          
          container.appendChild(p);
          
          const isAtTarget = config.startX === targetX;
          const finalStartX = config.startX !== undefined ? config.startX : startX;
          const finalStartY = (config.startY !== undefined ? config.startY : 0) + (isAtTarget ? baseTargetY : baseStartY);
          
          const finalTargetX = config.targetX !== undefined ? config.targetX : targetX;
          const finalTargetY = (config.targetY !== undefined ? config.targetY : 0) + baseTargetY;

          p.animate([
              { transform: `translate(calc(-50% + ${finalStartX}px), calc(-50% + ${finalStartY}px)) rotate(${config.rotation || 0}deg) scale(${config.scale || 1})`, opacity: p.style.opacity },
              { transform: `translate(calc(-50% + ${finalTargetX}px), calc(-50% + ${finalTargetY}px)) rotate(${(config.rotation || 0) + (config.spin || 0)}deg) scale(${config.endScale || 1})`, opacity: config.endOpacity !== undefined ? config.endOpacity : 0 }
          ], {
              duration: config.duration || 500,
              easing: config.easing || 'linear',
              fill: 'forwards',
              delay: config.delay || 0
          });
      };

      // Type specific logic
      if (moveType === 'fire') {
          for(let i=0; i<40; i++) {
              createParticle({
                  startX: startX + (Math.random() * 20 - 10), startY: (Math.random() * 20 - 10),
                  targetX: targetX + (Math.random() * 40 - 20), targetY: (Math.random() * 60 - 30),
                  w: 15 + Math.random() * 15, h: 15 + Math.random() * 15,
                  color: Math.random() > 0.5 ? '#ff4500' : (Math.random() > 0.5 ? '#ff8c00' : '#ffd700'),
                  shadow: '0 0 15px #ff0000',
                  duration: 300 + Math.random() * 200, delay: Math.random() * 200,
                  endScale: 2 + Math.random() * 2, spin: Math.random() * 360
              });
          }
      } else if (moveType === 'water') {
          for(let i=0; i<30; i++) {
              createParticle({
                  startX: startX + (Math.random() * 10 - 5), startY: (Math.random() * 10 - 5),
                  targetX: targetX + (Math.random() * 30 - 15), targetY: (Math.random() * 30 - 15),
                  w: 8 + Math.random() * 8, h: 8 + Math.random() * 8,
                  color: Math.random() > 0.5 ? '#00bfff' : '#1e90ff',
                  radius: '50% 50% 50% 5%', rotation: isP1 ? 45 : -135,
                  shadow: '0 0 10px #0000ff',
                  duration: 250 + Math.random() * 150, delay: i * 10, endScale: 1.5
              });
          }
      } else if (moveType === 'electric') {
          for(let i=0; i<15; i++) {
              createParticle({
                  startX: startX + (Math.random() * 40 - 20), startY: (Math.random() * 40 - 20),
                  targetX: targetX + (Math.random() * 40 - 20), targetY: (Math.random() * 40 - 20),
                  w: 40 + Math.random() * 40, h: 4,
                  color: '#ffff00', shadow: '0 0 20px #ffea00',
                  duration: 100 + Math.random() * 100, delay: i * 30,
                  rotation: isP1 ? (Math.random() * 40 - 20) : 180 + (Math.random() * 40 - 20), endScale: 1
              });
          }
      } else if (moveType === 'grass') {
          for(let i=0; i<25; i++) {
              createParticle({
                  startX: startX + (Math.random() * 30 - 15), startY: (Math.random() * 40 - 20),
                  targetX: targetX + (Math.random() * 40 - 20), targetY: (Math.random() * 60 - 30),
                  w: 20 + Math.random() * 10, h: 10 + Math.random() * 5,
                  color: Math.random() > 0.5 ? '#32cd32' : '#228b22',
                  radius: '0 50% 0 50%', shadow: '0 0 5px #006400',
                  duration: 400 + Math.random() * 200, delay: Math.random() * 200,
                  spin: 360 + Math.random() * 720, endScale: 1.2
              });
          }
      } else if (moveType === 'dark' || moveType === 'ghost') {
          createParticle({
              startX: startX, startY: 0, targetX: targetX, targetY: 0,
              w: 50, h: 50, color: moveType === 'dark' ? '#2f4f4f' : '#4b0082',
              shadow: moveType === 'dark' ? '0 0 30px #000' : '0 0 30px #8a2be2',
              duration: 400, endScale: 1.5, endOpacity: 1
          });
          for(let i=0; i<20; i++) {
              createParticle({
                  startX: startX + (Math.random() * 40 - 20), startY: (Math.random() * 40 - 20),
                  targetX: targetX + (Math.random() * 60 - 30), targetY: (Math.random() * 60 - 30),
                  w: 10 + Math.random() * 15, h: 10 + Math.random() * 15,
                  color: Math.random() > 0.5 ? '#000000' : '#800080',
                  shadow: '0 0 10px #4b0082',
                  duration: 400, delay: Math.random() * 100, endScale: 0.5
              });
          }
      } else if (moveType === 'ice') {
          for(let i=0; i<30; i++) {
              createParticle({
                  startX: startX + (Math.random() * 20 - 10), startY: (Math.random() * 20 - 10),
                  targetX: targetX + (Math.random() * 40 - 20), targetY: (Math.random() * 40 - 20),
                  w: 10 + Math.random() * 10, h: 10 + Math.random() * 10,
                  color: '#e0ffff', radius: '2px', shadow: '0 0 15px #00ffff',
                  duration: 300 + Math.random() * 200, delay: i * 15, spin: Math.random() * 360, endScale: 1.5
              });
          }
      } else if (moveType === 'psychic' || moveType === 'fairy') {
          for(let i=0; i<30; i++) {
              createParticle({
                  startX: startX + (Math.random() * 40 - 20), startY: Math.sin(i) * 30,
                  targetX: targetX + (Math.random() * 20 - 10), targetY: Math.sin(i + Math.PI) * 50,
                  w: 10 + Math.random() * 5, h: 10 + Math.random() * 5,
                  color: moveType === 'psychic' ? '#ff1493' : '#ffb6c1',
                  radius: '50%', shadow: '0 0 20px ' + (moveType === 'psychic' ? '#ff00ff' : '#ff69b4'),
                  duration: 400 + Math.random() * 200, delay: i * 10, endScale: 2
              });
          }
      } else if (moveType === 'fighting' || moveType === 'normal' || moveType === 'rock' || moveType === 'ground' || moveType === 'steel') {
          const baseColor = moveType === 'rock' ? '#8b4513' : (moveType === 'ground' ? '#d2b48c' : (moveType === 'steel' ? '#c0c0c0' : '#ffffff'));
          for(let i=0; i<15; i++) {
              createParticle({
                  startX: startX, startY: 0,
                  targetX: targetX + (Math.random() * 80 - 40), targetY: (Math.random() * 80 - 40),
                  w: 10 + Math.random() * 10, h: 10 + Math.random() * 10,
                  color: baseColor, radius: moveType === 'rock' ? '2px' : '50%',
                  shadow: '0 0 5px ' + baseColor,
                  duration: 200 + Math.random() * 200, delay: 100, spin: Math.random() * 360, endScale: 1.5
              });
          }
      } else {
          const clr = moveType === 'poison' ? '#800080' : (moveType === 'bug' ? '#9acd32' : (moveType === 'flying' ? '#add8e6' : '#8a2be2'));
          for(let i=0; i<20; i++) {
              createParticle({
                  startX: startX, startY: 0, targetX: targetX, targetY: (Math.random() * 20 - 10),
                  w: 30 + Math.random() * 20, h: 5 + Math.random() * 5,
                  color: clr, radius: '10px', shadow: '0 0 15px ' + clr,
                  duration: 300, delay: i * 20, endScale: 1.5
              });
          }
      }
      
      setTimeout(() => {
          for(let i=0; i<10; i++) {
              createParticle({
                  startX: targetX, startY: 0, targetX: targetX + (Math.random() * 100 - 50), targetY: (Math.random() * 100 - 50),
                  w: 5 + Math.random() * 10, h: 5 + Math.random() * 10,
                  color: '#ffffff', radius: '50%', shadow: '0 0 20px #fff',
                  duration: 200 + Math.random() * 200, endScale: 0.1
              });
          }
      }, 400);

      setTimeout(() => {
          if (container.parentNode) container.parentNode.removeChild(container);
      }, 1000);
  };

  const playBattleAnimation = (attackerSlot, defenderSlot, moveName, moveType, damage, isSuper, isResisted) => {
    const atkImg = document.getElementById('poke-' + attackerSlot + '-pokemon');
    const defImg = document.getElementById('poke-' + defenderSlot + '-pokemon');
    const proj = document.getElementById('poke-projectile');
    const logBox = document.getElementById('poke-battle-log');
    
    // UI Setup
    document.getElementById('poke-selection-panel').classList.add('hidden'); // Hide moves during animation
    
    logBox.textContent = pokeState[attackerSlot].name + ", " + moveName + " kullandı!";
    
    atkImg.className = '';
    defImg.className = '';
    
    setTimeout(() => {
      atkImg.classList.add('anim-lunge-' + attackerSlot);
      playPokemonCry(pokeState[attackerSlot].pokemon);
      
      proj.style.display = 'none';
      generateRealisticAttack(attackerSlot, defenderSlot, moveType);
      
      setTimeout(() => {
        proj.style.display = 'none';
        defImg.classList.add('anim-shake');
        
        // Apply damage visually
        pokeState[defenderSlot].hp -= damage;
        if (pokeState[defenderSlot].hp < 0) pokeState[defenderSlot].hp = 0;
        
        updateHpUI(defenderSlot);
        
        let effectMsg = "";
        if (isSuper) effectMsg = " Süper Etkili!";
        else if (isResisted) effectMsg = " Etkisi Az!";
        
        logBox.textContent = moveName + " " + damage + " hasar verdi." + effectMsg;
        
        setTimeout(() => {
           if (pokeState[defenderSlot].hp <= 0) {
              logBox.textContent = pokeState[defenderSlot].name + " bayıldı! " + pokeState[attackerSlot].name + " kazandı!";
              defImg.classList.add('anim-death');
              atkImg.classList.add('anim-winner');
              endBattle(attackerSlot);
           } else {
              // Switch turn
              pokeState.turn = pokeState.turn === 1 ? 2 : 1;
              customRenderBattleArena(); // Renders turn UI
              window.pokeAnimPlaying = false;
              
              // If it's bot's turn, trigger bot
              if (pokeState.turn === 2 && pokeState.p2.id === 'BOT' && state.isLobbyHost) {
                 setTimeout(botPlay, 1500);
              }
           }
        }, 2000);
        
      }, 500);
    }, 500);
  };

  
    const executeRound = (action1, action2) => {
       window.pokeAnimPlaying = true;
       const m1 = pokeState.p1.moves[action1.moveIdx];
       const m2 = pokeState.p2.moves[action2.moveIdx];
       const s1 = getMoveSpeed(m1.name);
       const s2 = getMoveSpeed(m2.name);
       
       let first = 'p1', second = 'p2';
       let firstMove = m1, secondMove = m2;
       
       if (s2 > s1 || (s2 === s1 && Math.random() > 0.5)) {
          first = 'p2'; second = 'p1';
          firstMove = m2; secondMove = m1;
       }
       
       const execSingle = (attacker, defender, move, cb) => {
          if (pokeState[attacker].hp <= 0) return cb(); // attacker is dead
          
          const defType = pokeState[defender].type;
          let multiplier = 1;
          if (typeChart[move.type] && typeChart[move.type][defType] !== undefined) multiplier = typeChart[move.type][defType];
          
          let isSuper = multiplier > 1.5;
          let isResisted = multiplier < 0.9;
          let dmg = Math.floor(move.power * multiplier * (Math.random() * 0.2 + 0.9)); // +/- 10%
          
          playBattleAnimation(attacker, defender, move.name, move.type, dmg, isSuper, isResisted);
          
          setTimeout(() => {
             cb();
          }, 2000);
       };
       
       execSingle(first, second, firstMove, () => {
          if (pokeState[second].hp <= 0) {
             window.pokeAnimPlaying = false;
             endBattle(first);
             return;
          }
          execSingle(second, first, secondMove, () => {
             window.pokeAnimPlaying = false;
             if (pokeState[first].hp <= 0) {
                endBattle(second);
             } else {
                // Both survived, next turn!
                pokeState.actionP1 = null;
                pokeState.actionP2 = null;
                customRenderBattleArena();
                const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId) || true;
                if (isHostFallback && pokeState.p2 && pokeState.p2.id === 'BOT') {
                   setTimeout(botPlay, 500);
                }
             }
          });
       });
    };

    const updateHpUI = (slot) => {
    const hpText = document.getElementById('poke-' + slot + '-hp-text');
    const hpBar = document.getElementById('poke-' + slot + '-hp-bar');
    if(hpText && hpBar && pokeState[slot]) {
      const p = pokeState[slot];
      hpText.textContent = Math.floor(p.hp) + " / " + p.maxHp;
      const pct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
      hpBar.style.width = pct + "%";
      
      // Color change based on HP
      if(pct > 50) hpBar.style.background = 'linear-gradient(90deg, #22c55e, #4ade80)'; // Green
      else if(pct > 20) hpBar.style.background = 'linear-gradient(90deg, #eab308, #fde047)'; // Yellow
      else hpBar.style.background = 'linear-gradient(90deg, #ef4444, #f87171)'; // Red
    }
  };

  const endBattle = (winnerSlot) => {
    document.getElementById('poke-next-round-panel').classList.remove('hidden');
    
    const isP1 = pokeState.p1 && pokeState.p1.id === state.myId;
    const isP2 = pokeState.p2 && pokeState.p2.id === state.myId;
    if (state.isLobbyHost || isP1 || isP2) {
      document.getElementById('poke-next-round-btn').style.display = 'block';
      document.getElementById('poke-spectator-msg').style.display = 'none';
    } else {
      document.getElementById('poke-next-round-btn').style.display = 'none';
      document.getElementById('poke-spectator-msg').style.display = 'block';
    }
    window.pokeAnimPlaying = false;
    pokeState.status = 'game_over';
  };

  const botPlay = () => {
       if (pokeState.status !== 'revealed' || pokeState.actionP2 !== null) return;
       
       const myMoves = pokeState.p2.moves;
       const targetType = pokeState.p1.type;
       
       // Find best move
       let bestMoveIdx = 0;
       let bestDamage = -1;
       
       for(let i=0; i<myMoves.length; i++) {
          const move = myMoves[i];
          let multiplier = 1;
          if (typeChart[move.type] && typeChart[move.type][targetType] !== undefined) {
            multiplier = typeChart[move.type][targetType];
          }
          const estDmg = move.power * multiplier;
          if (estDmg > bestDamage) {
             bestDamage = estDmg;
             bestMoveIdx = i;
          }
       }
       
       broadcastPokeMsg({ type: 'poke_action_select', id: 'BOT', moveIdx: bestMoveIdx });
    };

    document.querySelectorAll('.poke-move-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (window.pokeAnimPlaying) return;
      
      let target = e.target;
      while(target && !target.classList.contains('poke-move-btn')) {
        target = target.parentElement;
      }
      
      const moveIdx = parseInt(target.getAttribute('data-move'));
    if (pokeState.p1 && pokeState.p1.id === state.myId) pokeState.actionP1 = { id: state.myId, moveIdx: moveIdx };
    else if (pokeState.p2 && pokeState.p2.id === state.myId) pokeState.actionP2 = { id: state.myId, moveIdx: moveIdx };
    customRenderBattleArena();
    broadcastPokeMsg({ type: 'poke_action_select', id: state.myId, moveIdx: moveIdx });
  });
});

  // Next Round
  document.getElementById('poke-next-round-btn')?.addEventListener('click', () => {
    broadcastPokeMsg({ type: 'poke_lobby' });
  });

  const getPokemonNameFromUrl = (url) => {
    if (!url) return "Pokemon";
    const parts = url.split('/');
    return parts[parts.length - 1].replace('.gif', '').replace('.png', '').split('-')[0];
  };

  const fetchRandomMoves = async (pokeName, targetType, fullList = false) => {
    try {
      const res = await fetch('https://pokeapi.co/api/v2/pokemon/' + pokeName);
      const data = await res.json();
      const allUrls = data.moves.map(m => m.move.url).sort(() => 0.5 - Math.random());
      
      const poolUrls = allUrls.slice(0, fullList ? 12 : 8);
      const allMoves = [];
      
      await Promise.all(poolUrls.map(async url => {
         try {
           const mRes = await fetch(url);
           const mData = await mRes.json();
           if (mData.power && mData.power > 0) {
             // ensure no duplicates by name
             if (!allMoves.find(x => x.name === mData.name.replace('-', ' ').toUpperCase())) {
                allMoves.push({
                  name: mData.name.replace('-', ' ').toUpperCase(),
                  type: mData.type.name,
                  power: mData.power
                });
             }
           }
         } catch(e) {}
      }));
      
            if (fullList) {
           while (allMoves.length < 4) {
             allMoves.push({
               name: ["STRUGGLE", "TACKLE", "FLAIL", "THRASH"][allMoves.length],
               type: "normal",
               power: 50
             });
           }
           return allMoves; // return all fetched moves for manual selection
        }
      
      // Auto selection logic
      const stabMoves = allMoves.filter(m => m.type === targetType);
      const normalMoves = allMoves.filter(m => m.type === 'normal');
      const otherMoves = allMoves.filter(m => m.type !== targetType && m.type !== 'normal');
      
      const selectedMoves = [];
      if (stabMoves.length > 0) selectedMoves.push(stabMoves.pop());
      if (normalMoves.length > 0) selectedMoves.push(normalMoves.pop());
      
      const combined = [...stabMoves, ...normalMoves, ...otherMoves].sort(() => 0.5 - Math.random());
      while (selectedMoves.length < 4 && combined.length > 0) {
         selectedMoves.push(combined.pop());
      }
      
      while (selectedMoves.length < 4) {
         selectedMoves.push({ name: "TACKLE", type: "normal", power: 40 });
      }
      return selectedMoves;
      
    } catch(err) {
      console.log('Move fetch err', err);
      return [
        {name: "TACKLE", type: "normal", power: 40},
        {name: "QUICK ATTACK", type: "normal", power: 40},
        {name: "SLAM", type: "normal", power: 80},
        {name: "BODY SLAM", type: "normal", power: 85}
      ];
    }
  };

  // OVERWRITE renderBattleArena from earlier

  // Move selection UI logic
  let selectedManualMoves = [];
  window.renderMoveSelection = (moves) => {
     const list = document.getElementById('poke-move-selection-list');
     const count = document.getElementById('poke-move-count');
     const btn = document.getElementById('poke-confirm-moves-btn');
     list.innerHTML = '';
     selectedManualMoves = [];
     count.textContent = '0';
     btn.disabled = true;
     btn.style.opacity = '0.5';
     btn.style.cursor = 'not-allowed';
     
     moves.forEach((move, i) => {
        const d = document.createElement('div');
        d.className = 'manual-move-card';
        d.style.background = 'rgba(255,255,255,0.1)';
        d.style.border = '2px solid rgba(255,255,255,0.2)';
        d.style.padding = '10px 15px';
        d.style.borderRadius = '10px';
        d.style.cursor = 'pointer';
        d.style.display = 'flex';
        d.style.flexDirection = 'column';
        d.style.minWidth = '140px';
        
        d.innerHTML = `<span style="color:white; font-weight:bold;">${move.name}</span>
                       <span style="font-size:12px; color:${TYPE_COLORS[move.type] || '#ccc'};">${move.type.toUpperCase()} | Güç: ${move.power}</span>`;
        
        d.addEventListener('click', () => {
           const idx = selectedManualMoves.indexOf(move);
           if (idx > -1) {
              selectedManualMoves.splice(idx, 1);
              d.style.border = '2px solid rgba(255,255,255,0.2)';
              d.style.background = 'rgba(255,255,255,0.1)';
           } else {
              if (selectedManualMoves.length < 4) {
                 selectedManualMoves.push(move);
                 d.style.border = '2px solid #10b981';
                 d.style.background = 'rgba(16,185,129,0.2)';
              }
           }
           count.textContent = selectedManualMoves.length;
           if (selectedManualMoves.length === 4) {
              btn.disabled = false;
              btn.style.opacity = '1';
              btn.style.cursor = 'pointer';
           } else {
              btn.disabled = true;
              btn.style.opacity = '0.5';
              btn.style.cursor = 'not-allowed';
           }
        });
        list.appendChild(d);
     });
  };
  
  document.getElementById('poke-confirm-moves-btn')?.addEventListener('click', () => {
     if (selectedManualMoves.length !== 4) return;
     document.getElementById('poke-confirm-moves-btn').style.display = 'none';
     document.getElementById('poke-waiting-moves-msg').style.display = 'block';
     broadcastPokeMsg({ type: 'poke_moves_ready', id: state.myId, moves: selectedManualMoves });
  });

  const customRenderBattleArena = () => {
    const badge = document.getElementById('poke-vs-badge');
    if (badge) badge.innerHTML = '<span style="font-size: 50px; font-style: italic; font-weight: 900; color: #cbd5e1; text-shadow: 0 4px 10px rgba(0,0,0,0.8);">VS</span>';

    // Top headers
    document.getElementById('poke-p1-header').textContent = pokeState.p1 ? pokeState.p1.name : "Oyuncu 1";
    document.getElementById('poke-p2-header').textContent = pokeState.p2 ? pokeState.p2.name : "Oyuncu 2";

    const isP1 = pokeState.p1 && pokeState.p1.id === state.myId;
    const isP2 = pokeState.p2 && pokeState.p2.id === state.myId;

    const p1Img = document.getElementById('poke-p1-pokemon');
    const p1Status = document.getElementById('poke-p1-status');
    const p2Img = document.getElementById('poke-p2-pokemon');
    const p2Status = document.getElementById('poke-p2-status');
    const logBox = document.getElementById('poke-battle-log');
    
    if (pokeState.status === 'selecting') {
      p1Img.style.display = 'none'; p2Img.style.display = 'none';
      p1Status.style.display = 'block'; p1Status.textContent = "HAZIRLANIYOR...";
      p2Status.style.display = 'block'; p2Status.textContent = "HAZIRLANIYOR...";
      
      document.getElementById('poke-p1-hp-container').style.display = 'none';
      document.getElementById('poke-p2-hp-container').style.display = 'none';
      document.getElementById('poke-selection-panel').classList.add('hidden');
      logBox.style.display = 'flex';
      logBox.textContent = "Savaş alanı kuruluyor...";
      document.getElementById('poke-next-round-panel').classList.add('hidden');
    } 
    else if (pokeState.status === 'revealed') {
      p1Status.style.display = 'none'; p2Status.style.display = 'none';
      p1Img.style.display = 'block'; p2Img.style.display = 'block';
      
      document.getElementById('poke-p1-pokename').style.display = 'block';
      document.getElementById('poke-p1-pokename').textContent = getPokemonNameFromUrl(pokeState.p1.pokemon);
      document.getElementById('poke-p2-pokename').style.display = 'block';
      document.getElementById('poke-p2-pokename').textContent = getPokemonNameFromUrl(pokeState.p2.pokemon);

      p1Img.src = pokeState.p1.pokemon || UNKNOWN_AVATAR;
      p2Img.src = pokeState.p2.pokemon || UNKNOWN_AVATAR;
      
      document.getElementById('poke-p1-hp-container').style.display = 'flex';
      document.getElementById('poke-p2-hp-container').style.display = 'flex';
      updateHpUI('p1');
      updateHpUI('p2');
      
      logBox.style.display = 'flex';
      
      // Determine if it's my turn
      const myTurn = (pokeState.status === 'revealed');
      let mySlot = null;
      if (pokeState.p1 && pokeState.p1.id === state.myId) mySlot = 'p1';
      else if (pokeState.p2 && pokeState.p2.id === state.myId) mySlot = 'p2';
      
      if (myTurn && mySlot && !window.pokeAnimPlaying && pokeState[mySlot].hp > 0 && !pokeState['action'+(mySlot.toUpperCase())]) {
        logBox.textContent = "Senin sıran! Bir saldırı seç!";
        document.getElementById('poke-selection-panel').classList.remove('hidden');
        
        // Populate moves
        const moves = pokeState[mySlot].moves;
        
        for (let i=0; i<4; i++) {
           const btn = document.querySelector('.poke-move-btn[data-move="'+i+'"]');
           if (btn && moves[i]) {
              btn.querySelector('.move-name').textContent = moves[i].name;
              btn.querySelector('.move-type').textContent = (TYPE_NAMES[moves[i].type] || moves[i].type).toUpperCase();
                const speedObj = btn.querySelector('.move-speed');
                if(speedObj) speedObj.textContent = "Hız: " + getMoveSpeed(moves[i].name);
              btn.querySelector('.move-type').className = 'move-type type-' + moves[i].type;
              btn.querySelector('.move-type').style.color = TYPE_COLORS[moves[i].type] || '#fff';
              btn.querySelector('.move-power').textContent = "Güç: " + moves[i].power;
           }
        }
      } else {
        document.getElementById('poke-selection-panel').classList.add('hidden');
        if (!window.pokeAnimPlaying) {
            let waitingFor = [];
            if (!pokeState.actionP1 && pokeState.p1) waitingFor.push(pokeState.p1.name);
            if (!pokeState.actionP2 && pokeState.p2) waitingFor.push(pokeState.p2.name);
            if (waitingFor.length > 0) {
               logBox.textContent = "Bekleniyor: " + waitingFor.join(' ve ') + " hamle düşünüyor...";
            } else {
               logBox.textContent = "Saldırılar gerçekleşiyor...";
            }
        }
      }
    }
  };

  // Handler
  window.pokeActivityHandler = (data) => {
    if (data.type === 'activity_change' && data.activity === 'poke') {
      renderPokeLobby();
    }
    if (data.type === 'poke_sync') {
      Object.assign(pokeState, data.state);
      if (pokeState.status === 'waiting') {
        renderPokeLobby();
      } else {
        document.getElementById('poke-battle-view').classList.remove('hidden');
        document.getElementById('poke-lobby-view').classList.add('hidden');
        customRenderBattleArena();
      }
    }
    if (data.type === 'poke_join') {
      const pData = { id: data.id, name: data.name, avatar: data.avatar, ready: false, type: null, pokemon: null, hp: 0, maxHp: 0, moves: [] };
      if (data.slot === 1) pokeState.p1 = pData;
      else if (data.slot === 2) pokeState.p2 = pData;
      renderPokeLobby();
    }
    if (data.type === 'poke_lobby') {
       pokeState.status = 'waiting';
       if(pokeState.p1) { pokeState.p1.pokemon = null; /*pokeState.p1.hp = 100;*/ }
       if(pokeState.p2) { pokeState.p2.pokemon = null; /*pokeState.p2.hp = 100;*/ }
       document.getElementById('poke-p1-pokemon').className = '';
       document.getElementById('poke-p2-pokemon').className = '';
       renderPokeLobby();
    }
    if (data.type === 'poke_start') {
      pokeState.status = 'selecting';
      document.getElementById('poke-battle-view').classList.remove('hidden');
      document.getElementById('poke-lobby-view').classList.add('hidden');
      customRenderBattleArena();

      const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId) || true;
      if (isHostFallback) {
         const isRandom = data.randomMoves;
         const generateGame = async () => {
            if (isRandom) {
                const types = Object.keys(POKEMONS);
                const t1 = types[Math.floor(Math.random() * types.length)];
                const t2 = types[Math.floor(Math.random() * types.length)];
                const p1Poke = POKEMONS[t1][Math.floor(Math.random() * POKEMONS[t1].length)];
                const p2Poke = POKEMONS[t2][Math.floor(Math.random() * POKEMONS[t2].length)];
                const n1 = getPokemonNameFromUrl(p1Poke);
                const n2 = getPokemonNameFromUrl(p2Poke);
                
                const p1Moves = await fetchRandomMoves(n1, t1, false);
                const p2Moves = await fetchRandomMoves(n2, t2, false);
                broadcastPokeMsg({
                   type: 'poke_reveal',
                   p1: { type: t1, pokemon: p1Poke, moves: p1Moves },
                   p2: { type: t2, pokemon: p2Poke, moves: p2Moves }
                });
            } else {
                broadcastPokeMsg({ type: 'poke_base_selection_state' });
            }
         };
         generateGame();
      }
    }
    

    if (data.type === 'poke_base_selection_state') {
       pokeState.status = 'base_selection';
       
       if (pokeState.p1) { pokeState.p1.baseReady = false; pokeState.p1.evoReady = false; }
       if (pokeState.p2) { pokeState.p2.baseReady = false; pokeState.p2.evoReady = false; }

       const isP1 = pokeState.p1 && pokeState.p1.id === state.myId;
       const isP2 = pokeState.p2 && pokeState.p2.id === state.myId;
       
       if (isP1 || isP2) {
          document.getElementById('poke-base-selection-modal').classList.remove('hidden');
          document.getElementById('poke-evolution-selection-modal').classList.add('hidden');
          document.getElementById('poke-move-selection-modal').classList.add('hidden');
          document.getElementById('poke-waiting-base-msg').style.display = 'none';
          
          const grid = document.getElementById('poke-base-selection-grid');
          grid.innerHTML = '';
          window.POKEMON_FAMILIES.forEach(fam => {
             const card = document.createElement('div');
             card.className = 'poke-base-card';
             card.innerHTML = `
                <img src="${fam.evolutions[0].url}" />
                <div class="poke-base-name">${fam.displayName}</div>
                <div class="poke-type-badge" style="background: ${TYPE_COLORS[fam.type] || '#777'};">${TYPE_NAMES[fam.type] || fam.type}</div>
             `;
             card.onclick = () => {
                document.getElementById('poke-base-selection-grid').innerHTML = '';
                document.getElementById('poke-waiting-base-msg').style.display = 'block';
                broadcastPokeMsg({ type: 'poke_action_base_select', id: state.myId, baseName: fam.baseName, typeStr: fam.type });
             };
             grid.appendChild(card);
          });
       } else {
          document.getElementById('poke-base-selection-modal').classList.add('hidden');
       }

       // Bot logic for base selection
       const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId) || true;
       if (isHostFallback && pokeState.p2 && pokeState.p2.id === 'BOT') {
          setTimeout(() => {
             const rFam = window.POKEMON_FAMILIES[Math.floor(Math.random() * window.POKEMON_FAMILIES.length)];
             broadcastPokeMsg({ type: 'poke_action_base_select', id: 'BOT', baseName: rFam.baseName, typeStr: rFam.type });
          }, 300);
       }
    }

    
    if (data.type === 'poke_action_base_unselect') {
       if (pokeState.p1 && pokeState.p1.id === data.id) {
          pokeState.p1.baseReady = false;
          pokeState.p1.baseName = null;
       }
       if (pokeState.p2 && pokeState.p2.id === data.id) {
          pokeState.p2.baseReady = false;
          pokeState.p2.baseName = null;
       }
       // If I am the one who unselected, re-render my base grid
       if (data.id === state.myId) {
           const grid = document.getElementById('poke-base-selection-grid');
           if (grid) {
               grid.innerHTML = '';
               window.POKEMON_FAMILIES.forEach(fam => {
                  const card = document.createElement('div');
                  card.className = 'poke-base-card';
                  card.innerHTML = `
                     <img src="${fam.evolutions[0].url}" />
                     <div class="poke-base-name">${fam.displayName}</div>
                     <div class="poke-type-badge" style="background: ${TYPE_COLORS[fam.type] || '#777'};">${TYPE_NAMES[fam.type] || fam.type}</div>
                  `;
                  card.onclick = () => {
                     document.getElementById('poke-base-selection-grid').innerHTML = '';
                     document.getElementById('poke-waiting-base-msg').style.display = 'block';
                     broadcastPokeMsg({ type: 'poke_action_base_select', id: state.myId, baseName: fam.baseName, typeStr: fam.type });
                  };
                  grid.appendChild(card);
               });
           }
       }
    }

    if (data.type === 'poke_action_base_select') {
       if (pokeState.p1 && pokeState.p1.id === data.id) {
    pokeState.p1.baseName = data.baseName;
    pokeState.p1.type = data.typeStr;
    pokeState.p1.baseReady = true;
    const fam1 = window.POKEMON_FAMILIES.find(f => f.baseName === data.baseName);
    if(fam1) { pokeState.p1.hp = fam1.hp; pokeState.p1.maxHp = fam1.hp; }
}
       if (pokeState.p2 && pokeState.p2.id === data.id) {
    pokeState.p2.baseName = data.baseName;
    pokeState.p2.type = data.typeStr;
    pokeState.p2.baseReady = true;
    const fam2 = window.POKEMON_FAMILIES.find(f => f.baseName === data.baseName);
    if(fam2) { pokeState.p2.hp = fam2.hp; pokeState.p2.maxHp = fam2.hp; }
}
       
       if (data.id === state.myId) {
          document.getElementById('poke-base-selection-modal').classList.add('hidden');
          document.getElementById('poke-evolution-selection-modal').classList.remove('hidden');
          document.getElementById('poke-waiting-evo-msg').style.display = 'none';
          
          const fam = window.POKEMON_FAMILIES.find(f => f.baseName === data.baseName);
          const flex = document.getElementById('poke-evolution-selection-flex');
          flex.innerHTML = '';
          fam.evolutions.forEach(evo => {
             const card = document.createElement('div');
             card.className = 'poke-evo-card';
             card.innerHTML = `
                <img src="${evo.url}" />
                <div class="poke-evo-name">${evo.name}</div>
             `;
             card.onclick = () => {
                document.getElementById('poke-evolution-selection-flex').innerHTML = '';
                document.getElementById('poke-waiting-evo-msg').style.display = 'block';
                broadcastPokeMsg({ type: 'poke_action_evo_select', id: state.myId, evoName: evo.name, evoUrl: evo.url });
             };
             flex.appendChild(card);
          });
       }

       // Bot logic for evo selection
       if (data.id === 'BOT') {
          const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId) || true;
          if (isHostFallback) {
             setTimeout(() => {
                const fam = window.POKEMON_FAMILIES.find(f => f.baseName === data.baseName);
                const rEvo = fam.evolutions[Math.floor(Math.random() * fam.evolutions.length)];
                broadcastPokeMsg({ type: 'poke_action_evo_select', id: 'BOT', evoName: rEvo.name, evoUrl: rEvo.url });
             }, 300);
          }
       }
    }

    if (data.type === 'poke_action_evo_select') {
       if (pokeState.p1 && pokeState.p1.id === data.id) {
          pokeState.p1.pokemon = data.evoUrl;
          pokeState.p1.evoName = data.evoName;
          pokeState.p1.evoReady = true;
       }
       if (pokeState.p2 && pokeState.p2.id === data.id) {
          pokeState.p2.pokemon = data.evoUrl;
          pokeState.p2.evoName = data.evoName;
          pokeState.p2.evoReady = true;
       }

       // Proceed to move selection locally
       if (data.id === state.myId) {
          document.getElementById('poke-evolution-selection-modal').classList.add('hidden');
          const isP1 = pokeState.p1 && pokeState.p1.id === state.myId;
          const myState = isP1 ? pokeState.p1 : pokeState.p2;
          
          fetchRandomMoves(myState.baseName, myState.type, true).then(movePool => {
             document.getElementById('poke-move-selection-modal').classList.remove('hidden');
             document.getElementById('poke-confirm-moves-btn').style.display = 'block';
             document.getElementById('poke-waiting-moves-msg').style.display = 'none';
             document.getElementById('poke-move-selection-pokename').textContent = myState.evoName;
             renderMoveSelection(movePool);
          });
       }

       // Bot logic for move selection
       if (data.id === 'BOT') {
          const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId) || true;
          if (isHostFallback) {
             setTimeout(() => {
                fetchRandomMoves(pokeState.p2.baseName, pokeState.p2.type, true).then(movePool => {
                   const bMoves = movePool.sort(() => 0.5 - Math.random()).slice(0, 4);
                   broadcastPokeMsg({ type: 'poke_moves_ready', id: 'BOT', moves: bMoves });
                });
             }, 300);
          }
       }
    }

    if (data.type === 'poke_select_moves_state') {
       pokeState.status = 'move_selection';
       pokeState.p1.type = data.p1.type;
       pokeState.p1.pokemon = data.p1.pokemon;
       pokeState.p1.moves = [];
       pokeState.p1.ready = false;
       
       pokeState.p2.type = data.p2.type;
       pokeState.p2.pokemon = data.p2.pokemon;
       pokeState.p2.moves = [];
       pokeState.p2.ready = false;

       const isP1 = pokeState.p1 && pokeState.p1.id === state.myId;
       if (isP1) document.getElementById('poke-move-selection-pokename').textContent = getPokemonNameFromUrl(pokeState.p1.pokemon);
       else document.getElementById('poke-move-selection-pokename').textContent = getPokemonNameFromUrl(pokeState.p2.pokemon);

       document.getElementById('poke-move-selection-modal').classList.remove('hidden');
       document.getElementById('poke-confirm-moves-btn').style.display = 'block';
       document.getElementById('poke-waiting-moves-msg').style.display = 'none';

       const isP2 = pokeState.p2 && pokeState.p2.id === state.myId;
       
       if (isP1) renderMoveSelection(data.p1.movePool);
       else if (isP2) renderMoveSelection(data.p2.movePool);
       else {
          // spectator
          document.getElementById('poke-move-selection-modal').classList.add('hidden');
       }
       
       // Handle bot
       const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId) || true;
       if (isHostFallback && pokeState.p2 && pokeState.p2.id === 'BOT') {
          // auto pick 4 moves for bot
          const bMoves = data.p2.movePool.sort(() => 0.5 - Math.random()).slice(0, 4);
          setTimeout(() => {
             broadcastPokeMsg({ type: 'poke_moves_ready', id: 'BOT', moves: bMoves });
          }, 300);
       }
    }
    
    if (data.type === 'poke_moves_ready') {
       if (pokeState.p1 && pokeState.p1.id === data.id) {
          pokeState.p1.moves = data.moves;
          pokeState.p1.ready = true;
       }
       if (pokeState.p2 && pokeState.p2.id === data.id) {
          pokeState.p2.moves = data.moves;
          pokeState.p2.ready = true;
       }
       
       if (pokeState.p1.ready && pokeState.p2.ready) {
          // Both ready! Switch to reveal
          const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId) || true;
          if (isHostFallback) {
             broadcastPokeMsg({
                 type: 'poke_reveal',
                 p1: { type: pokeState.p1.type, pokemon: pokeState.p1.pokemon, moves: pokeState.p1.moves },
                 p2: { type: pokeState.p2.type, pokemon: pokeState.p2.pokemon, moves: pokeState.p2.moves }
             });
          }
       }
    }
    
    
    if (data.type === 'poke_withdraw') {
        pokeState.status = 'waiting';
        pokeState.p1 = null;
        pokeState.p2 = null;
        document.getElementById('poke-battle-view').classList.add('hidden');
        document.getElementById('poke-base-selection-modal').classList.add('hidden');
        document.getElementById('poke-evolution-selection-modal').classList.add('hidden');
        document.getElementById('poke-move-selection-modal').classList.add('hidden');
        renderPokeLobby();
    }
    
    if (data.type === 'poke_mercy_request') {
        if (data.id !== state.myId && data.id !== 'BOT') {
            // Rakip pes etti, bize affet/reddet çıktı
            document.getElementById('poke-surrender-btn').classList.add('hidden');
            document.getElementById('poke-mercy-actions').classList.remove('hidden');
            const logBox = document.getElementById('poke-battle-log');
            logBox.textContent = "Rakip pes etmek istiyor! Kararını ver.";
            logBox.style.display = 'flex';
        } else {
            // Biz pes ettik
            const btn = document.getElementById('poke-surrender-btn');
            btn.textContent = "Rakibin kararı bekleniyor...";
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.5';
            
            // Eğer rakip BOT ise, otomatik olarak kabul etsin
            if (pokeState.p2 && pokeState.p2.id === 'BOT' && pokeState.p1 && pokeState.p1.id === state.myId) {
                 setTimeout(() => {
                      broadcastPokeMsg({ type: 'poke_mercy_accept', id: 'BOT' });
                 }, 1500);
            }
        }
    }
    
    if (data.type === 'poke_mercy_accept') {
        const logBox = document.getElementById('poke-battle-log');
        logBox.style.display = 'flex';
        if (data.id === state.myId) {
             logBox.textContent = "Rakibi affettin! Savaş sona erdi.";
        } else {
             logBox.textContent = "Rakip seni affetti! Savaş sona erdi.";
        }
        
        // Savaş bitsin
        document.getElementById('poke-next-round-panel').classList.remove('hidden');
        const isP1 = pokeState.p1 && pokeState.p1.id === state.myId;
        const isP2 = pokeState.p2 && pokeState.p2.id === state.myId;
        if (state.isLobbyHost || isP1 || isP2) {
          document.getElementById('poke-next-round-btn').style.display = 'block';
          document.getElementById('poke-spectator-msg').style.display = 'none';
        } else {
          document.getElementById('poke-next-round-btn').style.display = 'none';
          document.getElementById('poke-spectator-msg').style.display = 'block';
        }
        pokeState.status = 'game_over';
        
        // Butonları gizle
        document.getElementById('poke-surrender-btn').classList.add('hidden');
        document.getElementById('poke-mercy-actions').classList.add('hidden');
    }
    
    if (data.type === 'poke_mercy_reject') {
        const logBox = document.getElementById('poke-battle-log');
        logBox.style.display = 'flex';
        if (data.id === state.myId) {
             logBox.textContent = "Rakibi affetmedin! Savaş devam ediyor.";
        } else {
             logBox.textContent = "Rakip seni affetmedi! Savaş devam ediyor.";
        }
        
        // Reset buttons
        const surBtn = document.getElementById('poke-surrender-btn');
        surBtn.textContent = "Savaşı Bitirmek İstiyorum (Pes Et)";
        surBtn.style.pointerEvents = 'auto';
        surBtn.style.opacity = '1';
        surBtn.classList.remove('hidden');
        document.getElementById('poke-mercy-actions').classList.add('hidden');
        
        setTimeout(() => {
           if(pokeState.status === 'revealed') logBox.style.display = 'none';
        }, 3000);
    }

    if (data.type === 'poke_reveal') {
      pokeState.status = 'revealed';
      document.getElementById('poke-move-selection-modal')?.classList.add('hidden');
      pokeState.actionP1 = null;
        pokeState.actionP2 = null;
      
      pokeState.p1.type = data.p1.type;
      pokeState.p1.pokemon = data.p1.pokemon;
      pokeState.p1.moves = data.p1.moves;
      //pokeState.p1.hp = 100;
      //pokeState.p1.maxHp = 100;
      
      pokeState.p2.type = data.p2.type;
      pokeState.p2.pokemon = data.p2.pokemon;
      pokeState.p2.moves = data.p2.moves;
      
      if (!pokeState.p1.hp) {
          const fam1 = window.POKEMON_FAMILIES.find(f => data.p1.baseName ? f.baseName === data.p1.baseName : f.type === data.p1.type);
          pokeState.p1.hp = fam1 ? fam1.hp : 140;
          pokeState.p1.maxHp = fam1 ? fam1.hp : 140;
      }
      if (!pokeState.p2.hp) {
          const fam2 = window.POKEMON_FAMILIES.find(f => data.p2.baseName ? f.baseName === data.p2.baseName : f.type === data.p2.type);
          pokeState.p2.hp = fam2 ? fam2.hp : 140;
          pokeState.p2.maxHp = fam2 ? fam2.hp : 140;
      }

      customRenderBattleArena();
      
      const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId) || true;
      if (isHostFallback && pokeState.p2 && pokeState.p2.id === 'BOT') {
         setTimeout(botPlay, 1000);
      }
    }

    if (data.type === 'poke_action_select') {
         if (pokeState.status !== 'revealed') return;
         if (pokeState.p1 && pokeState.p1.id === data.id) pokeState.actionP1 = data;
         if (pokeState.p2 && pokeState.p2.id === data.id) pokeState.actionP2 = data;
         customRenderBattleArena();
         
         const isHostFallback = state.isLobbyHost || (pokeState.p1 && pokeState.p1.id === state.myId) || true;
         if (pokeState.actionP1 && pokeState.actionP2 && isHostFallback) {
            broadcastPokeMsg({
                type: 'poke_round_execute',
                actionP1: pokeState.actionP1,
                actionP2: pokeState.actionP2
            });
         }
      }
      
      if (data.type === 'poke_round_execute') {
         if (pokeState.status !== 'revealed') return;
         pokeState.actionP1 = data.actionP1;
         pokeState.actionP2 = data.actionP2;
         executeRound(data.actionP1, data.actionP2);
      }


      if (data.type === 'poke_attack') {
      if (pokeState.status !== 'revealed') return;
      if (window.pokeAnimPlaying) return;
      
      const isP1 = pokeState.turn === 1;
      const attackerSlot = isP1 ? 'p1' : 'p2';
      const defenderSlot = isP1 ? 'p2' : 'p1';
      
      // Verify user has right to attack
      if (pokeState[attackerSlot].id !== data.id && data.id !== 'BOT') return;
      
      window.pokeAnimPlaying = true;
      
      const move = pokeState[attackerSlot].moves[data.moveIdx];
      const defType = pokeState[defenderSlot].type; // Note: We use the type assigned originally, which matches the list it came from.
      
      let multiplier = 1;
      if (typeChart[move.type] && typeChart[move.type][defType] !== undefined) {
         multiplier = typeChart[move.type][defType];
      }
      
      const damage = Math.floor(move.power * multiplier * 0.4); // Scale down damage so 100 HP lasts a few turns
      const isSuper = multiplier > 1;
      const isResisted = multiplier < 1;
      
      playBattleAnimation(attackerSlot, defenderSlot, move.name, move.type, damage, isSuper, isResisted);
    }
  };

  // Add into global activity handler override
  
  // Back button for evolution modal
  setTimeout(() => {
    const backBtn = document.getElementById('poke-evo-back-btn');
    if (backBtn) {
       backBtn.onclick = () => {
          document.getElementById('poke-evolution-selection-modal').classList.add('hidden');
          document.getElementById('poke-base-selection-modal').classList.remove('hidden');
          if (typeof broadcastPokeMsg !== 'undefined') {
             broadcastPokeMsg({ type: 'poke_action_base_unselect', id: state.myId });
          }
       };
    }
  }, 1000);

  const originalActHandler = window.activityHandler;
  window.activityHandler = (data) => {
    if(originalActHandler) originalActHandler(data);
    if(typeof pokeActivityHandler !== 'undefined') pokeActivityHandler(data);
  };
}
