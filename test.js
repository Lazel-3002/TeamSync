>     window.handlePokeImgError = function(img) {
          let state = img.dataset.errState || '0';
          
          if (state === 'done') return;
          
          if (state === '0') {
              img.dataset.errState = '1';
              img.dataset.oldSrc = img.src;
              img.src = 'https://play.pokemonshowdown.com/sprites/itemicons/poke-ball.png';
              
              const realName = img.dataset.realname;
              if (realName) {
                  let pokeApiName = realName.toLowerCase().replace(/ /g, '-').replace(/\./g, '').replace(/'/g, '');
                  
                  const paradoxFixes = {
                      "ironcrown": "iron-crown", "ironboulder": "iron-boulder", "ironleaves": "iron-leaves",
                      "ironvaliant": "iron-valiant", "ironthorns": "iron-thorns", "ironmoth": "iron-moth",
                      "ironjugulis": "iron-jugulis", "ironhands": "iron-hands", "ironbundle": "iron-bundle",
                      "irontreads": "iron-treads", "roaringmoon": "roaring-moon", "sandyshocks": "sandy-shocks",
                      "slitherwing": "slither-wing", "fluttermane": "flutter-mane", "brutebonnet": "brute-bonnet",
                      "screamtail": "scream-tail", "greattusk": "great-tusk", "walkingwake": "walking-wake",
                      "ragingbolt": "raging-bolt", "gougingfire": "gouging-fire", "tinglu": "ting-lu",
                      "chienpao": "chien-pao", "wochien": "wo-chien", "chiyu": "chi-yu", "ogerpon": "ogerpon"
                  };
                  if (paradoxFixes[pokeApiName]) pokeApiName = paradoxFixes[pokeApiName];
                  
                  fetch(`https://pokeapi.co/api/v2/pokemon/${pokeApiName}`)
                      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
                      .then(data => {
                          img.dataset.errState = '2'; // next error means official artwork failed
                          img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${data.id}.png`;
                      })
                      .catch(() => {
                          img.dataset.errState = '3'; // try gen5
                          const cleanName = img.dataset.oldSrc.match(/\/([^\/]+)\.gif$/);
                          if (cleanName && cleanName[1]) {
                              img.src = `https://play.pokemonshowdown.com/sprites/gen5/${cleanName[1]}.png`;
                          } else {
                              img.dataset.errState = 'done';
                              img.src = 'https://play.pokemonshowdown.com/sprites/itemicons/poke-ball.png';
                          }
                      });
              } else {
                  img.dataset.errState = '3';
                  const cleanName = img.dataset.oldSrc.match(/\/([^\/]+)\.gif$/);
                  if (cleanName && cleanName[1]) {
                      img.src = `https://play.pokemonshowdown.com/sprites/gen5/${cleanName[1]}.png`;
                  } else {
                      img.dataset.errState = 'done';
                      img.src = 'https://play.pokemonshowdown.com/sprites/itemicons/poke-ball.png';
                  }
              }
          } else if (state === '1') {
              // PokeAPI placeholder pokeball failed, ignore and wait for fetch to finish.
              // Or if it failed, errState remains '1', so we do nothing.
          } else if (state === '2') {
              // Official artwork failed (probably adblocker or 404). Try Showdown gen5.
              img.dataset.errState = '3';
              const cleanName = img.dataset.oldSrc.match(/\/([^\/]+)\.gif$/);
              if (cleanName && cleanName[1]) {
                  img.src = `https://play.pokemonshowdown.com/sprites/gen5/${cleanName[1]}.png`;
>                 <img id="poke-p1-pokemon" src="" style="max-height: 100%; max-width: 100%; object-fit: contain; display: none; filter: drop-shadow(0 0 10px rgba(255,255,255,0.3)); transform: scaleX(-1);" onerror="window.handlePokeImgError(this)" />
                  <div id="poke-p1-status" style="position: absolute; font-size: 40px; font-weight: bold; color: white; text-shadow: 0 0 10px black; display: none;">SEÇIYOR...</div>
                </div>
              </div>
  
              <div id="poke-effect-area" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 20; display: flex; flex-direction: column; align-items: center;">
                <div id="poke-vs-badge" style="font-size: 50px; font-style: italic; font-weight: 900; color: #cbd5e1; text-shadow: 0 4px 10px rgba(0,0,0,0.8);">VS</div>
                <div id="poke-projectile" style="position: absolute; display: none; font-size: 60px; z-index: 30; pointer-events: none; filter: drop-shadow(0 0 15px rgba(255,255,255,0.8));"></div>
              </div>
  
              <div style="display: flex; flex-direction: column; align-items: center; z-index: 10; width: 35%;">
                <div id="poke-p2-header" style="background: rgba(0,0,0,0.6); padding: 5px 15px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px; font-weight: bold;">...</div>
                <div id="poke-p2-pokename" style="font-size: 18px; color: #fbbf24; font-weight: 900; text-transform: uppercase; margin-bottom: 5px; text-shadow: 0 0 10px #fbbf24; display: none;"></div>
                
                <div id="poke-p2-hp-container" style="display: none; width: 100%; max-width: 150px; flex-direction: column; align-items: center; margin-bottom: 10px;">
                  <div style="width: 100%; height: 12px; background: rgba(0,0,0,0.8); border: 2px solid rgba(255,255,255,0.2); border-radius: 8px; overflow: hidden; position: relative; box-shadow: inset 0 0 5px rgba(0,0,0,0.5);">
                    <div id="poke-p2-hp-bar" style="width: 100%; height: 100%; background: linear-gradient(90deg, #22c55e, #4ade80); transition: width 0.3s ease, background 0.3s ease;"></div>
                  </div>
                  <div id="poke-p2-hp-text" style="font-size: 12px; font-weight: bold; color: #e2e8f0; margin-top: 4px; text-shadow: 0 1px 3px black;">100 / 100</div>
                </div>
                <div id="poke-p2-pokemon-container" style="width: 200px; height: 200px; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%); display: flex; align-items: flex-end; justify-content: center; position: relative;">
>                 <img id="poke-p2-pokemon" src="" style="max-height: 100%; max-width: 100%; object-fit: contain; display: none; filter: drop-shadow(0 0 10px rgba(255,255,255,0.3));" onerror="window.handlePokeImgError(this)" />
                  <div id="poke-p2-status" style="position: absolute; font-size: 40px; font-weight: bold; color: white; text-shadow: 0 0 10px black; display: none;">SEÇIYOR...</div>
                </div>
              </div>
  
            </div>
  
            <div id="poke-battle-log" style="display: none; margin: 10px 20px; padding: 15px; background: rgba(0,0,0,0.6); border: 2px solid #3b82f6; border-radius: 12px; box-shadow: 0 0 15px rgba(59,130,246,0.4); text-align: center; color: white; font-size: 16px; font-weight: bold; min-height: 52px; align-items: center; justify-content: center; text-shadow: 0 2px 4px black; z-index: 50;">
              Savaş başlıyor...
            </div>
  
            <div id="poke-selection-panel" style="background: rgba(0,0,0,0.7); border-top: 1px solid rgba(255,255,255,0.1); padding: 20px; display: flex; flex-direction: column; align-items: center; backdrop-filter: blur(10px); position: relative;">
                
                <div id="poke-vol-control" style="position: absolute; top: 15px; left: 20px; display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.5); padding: 5px 15px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);">
                  <button id="poke-vol-mute" class="btn" style="padding: 2px; background: transparent; border: none; color: white; cursor: pointer; font-size: 16px;">🔊</button>
                  <input type="range" id="poke-vol-slider" min="0" max="100" value="50" style="width: 60px; accent-color: #3b82f6;" />
                </div>
                
                <button id="poke-guide-btn" class="btn-sec" style="position: absolute; top: 15px; right: 20px; background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid rgba(59,130,246,0.4); padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold;">📖 TÜR REHBERİ</button>
  
              <h3 id="poke-action-title" style="color: #cbd5e1; margin-bottom: 15px; font-size: 18px; text-shadow: 0 0 10px rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 1px;">Saldırı Seç</h3>
              
              <div id="poke-moves-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; width: 100%; max-width: 500px;">
                <button class="poke-move-btn" data-move="0" style="background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(0,0,0,0.4)); border: 2px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 15px; text-align: left; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; gap: 5px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
                  <span class="move-name" style="color: white; font-size: 16px; font-weight: 900; text-shadow: 0 2px 4px black;">Saldırı 1</span>
                  <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.9);">
                    <span class="move-type" style="color: #fca5a5;">NORMAL</span>
                    <span class="move-power" style="color: #f8fafc;">Güç: 40</span>
                      <span class="move-speed" style="color: #fbbf24;">Hız: 5</span>
                  </div>
                </button>
                <button class="poke-move-btn" data-move="1" style="background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(0,0,0,0.4)); border: 2px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 15px; text-align: left; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; gap: 5px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
                  <span class="move-name" style="color: white; font-size: 16px; font-weight: 900; text-shadow: 0 2px 4px black;">Saldırı 2</span>
                  <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.9);">
                    <span class="move-type" style="color: #fca5a5;">NORMAL</span>
                    <span class="move-power" style="color: #f8fafc;">Güç: 40</span>
                      <span class="move-speed" style="color: #fbbf24;">Hız: 5</span>
                  </div>
                </button>
                <button class="poke-move-btn" data-move="2" style="background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(0,0,0,0.4)); border: 2px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 15px; text-align: left; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; gap: 5px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
                  <span class="move-name" style="color: white; font-size: 16px; font-weight: 900; text-shadow: 0 2px 4px black;">Saldırı 3</span>
                  <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.9);">
                    <span class="move-type" style="color: #fca5a5;">NORMAL</span>
                    <span class="move-power" style="color: #f8fafc;">Güç: 40</span>
                      <span class="move-speed" style="color: #fbbf24;">Hız: 5</span>
                  </div>
                </button>
                <button class="poke-move-btn" data-move="3" style="background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(0,0,0,0.4)); border: 2px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 15px; text-align: left; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; gap: 5px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
                  <span class="move-name" style="color: white; font-size: 16px; font-weight: 900; text-shadow: 0 2px 4px black;">Saldırı 4</span>
                  <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.9);">
                    <span class="move-type" style="color: #fca5a5;">NORMAL</span>
                    <span class="move-power" style="color: #f8fafc;">Güç: 40</span>
                      <span class="move-speed" style="color: #fbbf24;">Hız: 5</span>
                  </div>
                </button>
              </div>
              
              <div id="poke-mercy-container" style="display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 20px;">
                  <button id="poke-surrender-btn" class="btn-sec" style="background: rgba(220,38,38,0.2); color: #fca5a5; border: 1px solid rgba(220,38,38,0.4); padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: bold; cursor: pointer; transition: all 0.2s;">Savaşı Bitirmek İstiyorum (Pes Et)</button>
                  <div id="poke-mercy-actions" class="hidden" style="display: flex; gap: 10px; align-items: center;">
                      <span style="color: white; font-size: 14px; text-shadow: 0 1px 3px black;">Rakip pes etmek istiyor:</span>
