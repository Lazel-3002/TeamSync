const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');

// 1. Add hidden button
if (!content.includes('<button id="act-poke"')) {
  content = content.replace(
    '<button id="act-wheel" style="display:none;"></button>',
    '<button id="act-wheel" style="display:none;"></button>\n          <button id="act-poke" style="display:none;"></button>'
  );
}

// 2. Add activity card
const cardHtml = 
            <!-- PokeSavas -->
            <div class="src act-src card-act-btn" id="card-act-poke" style="display: flex; align-items: center; justify-content: space-between; text-align: left; padding: 16px; cursor: pointer;">
              <div style="display: flex; align-items: center; flex: 1;">
                <div style="font-size: 40px; margin-right: 20px;">??</div>
                <div>
                  <div style="font-size: 18px; font-weight: bold; color: var(--acc-light);">PokeSavaþ</div>
                  <p class="muted" style="margin:4px 0 0 0;">Elementini seç ve arkadaþlarýnla kapýþ!</p>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span class="act-count-badge hidden" id="act-poke-count">0</span>
                <div class="act-arrow-btn" id="arrow-act-poke" style="width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.08); transition: all 0.2s; font-size: 14px; color: var(--txt-main); cursor: pointer;" onmouseover="this.style.background='rgba(99, 102, 241, 0.2)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.08)'; this.style.color='var(--txt-main)';">?</div>
              </div>
            </div>;

if (!content.includes('id="card-act-poke"')) {
  const wheelCardIndex = content.indexOf('id="card-act-wheel"');
  if (wheelCardIndex !== -1) {
    // find the end of wheel card which is the closing div of the card
    // but safer to just replace '          </div>\n        </div>\n      </div>' inside the sources div
    const sourcesEnd = content.indexOf('          </div>\n        </div>\n      </div>', wheelCardIndex);
    if (sourcesEnd !== -1) {
      content = content.substring(0, sourcesEnd) + cardHtml + '\n' + content.substring(sourcesEnd);
    }
  }
}

// 3. Add poke-card game view
const pokeCardHtml =       <div id="poke-card" class="vcard hidden" style="background: radial-gradient(circle at center, #1e293b, #0f172a); display: flex; flex-direction: column; overflow: hidden; position: relative; border-radius: 12px; box-shadow: 0 0 30px rgba(0,0,0,0.8) inset;">
        <div class="card-actions" style="position: absolute; top: 0; left: 0; right: 0; justify-content: space-between; padding: 10px 20px; z-index: 50; background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent);">
          <h3 style="margin: 0; font-family: 'Arial Black', sans-serif; letter-spacing: 2px; text-transform: uppercase; color: #f8fafc; text-shadow: 0 2px 10px rgba(255,255,255,0.3);">?? PokeSavaþ ??</h3>
          <button id="poke-close" class="btn-sec btn-sm" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);">Odadan Çýk</button>
        </div>

        <div id="poke-lobby-view" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; z-index: 10;">
          <h2 style="font-size: 28px; color: #e2e8f0; margin-bottom: 30px; text-shadow: 0 0 10px rgba(255,255,255,0.2);">Arena Bekleme Salonu</h2>
          
          <div style="display: flex; gap: 40px; margin-bottom: 40px;">
            <div class="poke-player-slot" id="poke-slot-1" style="display: flex; flex-direction: column; align-items: center; gap: 10px; width: 150px;">
              <div style="width: 100px; height: 100px; border-radius: 50%; border: 3px dashed rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 30px; background: rgba(0,0,0,0.3); transition: all 0.3s; position: relative; overflow: hidden;">
                <img id="poke-avatar-1" src="" style="width: 100%; height: 100%; object-fit: cover; display: none;" />
                <span id="poke-wait-1">?</span>
              </div>
              <div id="poke-name-1" style="font-weight: bold; color: #94a3b8; font-size: 16px;">Oyuncu 1 Bekleniyor...</div>
              <button id="poke-join-1" class="btn-pri btn-sm" style="background: #3b82f6;">Buraya Katýl</button>
            </div>

            <div style="display: flex; align-items: center; font-size: 32px; font-weight: 900; color: #ef4444; font-style: italic; text-shadow: 0 0 15px rgba(239,68,68,0.8);">VS</div>

            <div class="poke-player-slot" id="poke-slot-2" style="display: flex; flex-direction: column; align-items: center; gap: 10px; width: 150px;">
              <div style="width: 100px; height: 100px; border-radius: 50%; border: 3px dashed rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 30px; background: rgba(0,0,0,0.3); transition: all 0.3s; position: relative; overflow: hidden;">
                <img id="poke-avatar-2" src="" style="width: 100%; height: 100%; object-fit: cover; display: none;" />
                <span id="poke-wait-2">?</span>
              </div>
              <div id="poke-name-2" style="font-weight: bold; color: #94a3b8; font-size: 16px;">Oyuncu 2 Bekleniyor...</div>
              <div style="display: flex; gap: 5px;">
                <button id="poke-join-2" class="btn-pri btn-sm" style="background: #3b82f6;">Buraya Katýl</button>
                <button id="poke-bot-2" class="btn-sec btn-sm" style="background: #10b981; color: white;">?? Bot Ekle</button>
              </div>
            </div>
          </div>

          <button id="poke-start-btn" class="btn-pri hidden" style="font-size: 20px; padding: 12px 40px; font-weight: bold; border-radius: 50px; background: linear-gradient(45deg, #ef4444, #f97316); border: none; box-shadow: 0 4px 15px rgba(239,68,68,0.5); text-transform: uppercase;">Savaþý Baþlat</button>
        </div>

        <div id="poke-battle-view" class="hidden" style="flex: 1; display: flex; flex-direction: column; padding-top: 60px; position: relative;">
          <div id="poke-battle-arena" style="flex: 1; display: flex; align-items: center; justify-content: space-around; position: relative;">
            
            <div style="display: flex; flex-direction: column; align-items: center; z-index: 10; width: 35%;">
              <div id="poke-p1-header" style="background: rgba(0,0,0,0.6); padding: 5px 15px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px; font-weight: bold;">...</div>
              <div id="poke-p1-pokemon-container" style="width: 200px; height: 200px; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%); display: flex; align-items: flex-end; justify-content: center; position: relative;">
                <img id="poke-p1-pokemon" src="" style="max-height: 100%; max-width: 100%; object-fit: contain; display: none; filter: drop-shadow(0 0 10px rgba(255,255,255,0.3)); transform: scaleX(-1);" />
                <div id="poke-p1-status" style="position: absolute; font-size: 40px; font-weight: bold; color: white; text-shadow: 0 0 10px black; display: none;">SEÇÝYOR...</div>
              </div>
            </div>

            <div id="poke-effect-area" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 20; display: flex; flex-direction: column; align-items: center;">
              <div id="poke-vs-badge" style="font-size: 50px; font-style: italic; font-weight: 900; color: #cbd5e1; text-shadow: 0 4px 10px rgba(0,0,0,0.8);">VS</div>
              <div id="poke-projectile" style="position: absolute; display: none; font-size: 60px; z-index: 30; pointer-events: none; filter: drop-shadow(0 0 15px rgba(255,255,255,0.8));"></div>
            </div>

            <div style="display: flex; flex-direction: column; align-items: center; z-index: 10; width: 35%;">
              <div id="poke-p2-header" style="background: rgba(0,0,0,0.6); padding: 5px 15px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px; font-weight: bold;">...</div>
              <div id="poke-p2-pokemon-container" style="width: 200px; height: 200px; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%); display: flex; align-items: flex-end; justify-content: center; position: relative;">
                <img id="poke-p2-pokemon" src="" style="max-height: 100%; max-width: 100%; object-fit: contain; display: none; filter: drop-shadow(0 0 10px rgba(255,255,255,0.3));" />
                <div id="poke-p2-status" style="position: absolute; font-size: 40px; font-weight: bold; color: white; text-shadow: 0 0 10px black; display: none;">SEÇÝYOR...</div>
              </div>
            </div>

          </div>

          <div id="poke-selection-panel" style="background: rgba(0,0,0,0.7); border-top: 1px solid rgba(255,255,255,0.1); padding: 20px; display: flex; flex-direction: column; align-items: center; backdrop-filter: blur(10px);">
            <h3 id="poke-selection-title" style="margin-top: 0; margin-bottom: 15px; font-weight: normal; color: #cbd5e1;">Elementinizi Seçin!</h3>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; justify-content: center; max-width: 600px;">
              <button class="poke-type-btn" data-type="fire" style="background: linear-gradient(135deg, #ef4444, #991b1b); border: 2px solid #fca5a5; border-radius: 12px; padding: 15px 20px; font-size: 18px; font-weight: bold; color: white; cursor: pointer; box-shadow: 0 0 15px rgba(239,68,68,0.5); transition: transform 0.2s, box-shadow 0.2s;">?? ATEÞ</button>
              <button class="poke-type-btn" data-type="water" style="background: linear-gradient(135deg, #3b82f6, #1e3a8a); border: 2px solid #93c5fd; border-radius: 12px; padding: 15px 20px; font-size: 18px; font-weight: bold; color: white; cursor: pointer; box-shadow: 0 0 15px rgba(59,130,246,0.5); transition: transform 0.2s, box-shadow 0.2s;">?? SU</button>
              <button class="poke-type-btn" data-type="grass" style="background: linear-gradient(135deg, #22c55e, #14532d); border: 2px solid #86efac; border-radius: 12px; padding: 15px 20px; font-size: 18px; font-weight: bold; color: white; cursor: pointer; box-shadow: 0 0 15px rgba(34,197,94,0.5); transition: transform 0.2s, box-shadow 0.2s;">?? ÇÝMEN</button>
              <button class="poke-type-btn" data-type="electric" style="background: linear-gradient(135deg, #eab308, #854d0e); border: 2px solid #fef08a; border-radius: 12px; padding: 15px 20px; font-size: 18px; font-weight: bold; color: white; cursor: pointer; box-shadow: 0 0 15px rgba(234,179,8,0.5); transition: transform 0.2s, box-shadow 0.2s;">? ELEKTRÝK</button>
              <button class="poke-type-btn" data-type="dark" style="background: linear-gradient(135deg, #475569, #0f172a); border: 2px solid #94a3b8; border-radius: 12px; padding: 15px 20px; font-size: 18px; font-weight: bold; color: white; cursor: pointer; box-shadow: 0 0 15px rgba(71,85,105,0.5); transition: transform 0.2s, box-shadow 0.2s;">?? KARANLIK</button>
              <button class="poke-type-btn" data-type="fairy" style="background: linear-gradient(135deg, #ec4899, #831843); border: 2px solid #fbcfe8; border-radius: 12px; padding: 15px 20px; font-size: 18px; font-weight: bold; color: white; cursor: pointer; box-shadow: 0 0 15px rgba(236,72,153,0.5); transition: transform 0.2s, box-shadow 0.2s;">? PERÝ</button>
            </div>
          </div>

          <div id="poke-next-round-panel" class="hidden" style="background: rgba(0,0,0,0.7); border-top: 1px solid rgba(255,255,255,0.1); padding: 20px; display: flex; align-items: center; justify-content: center;">
             <button id="poke-next-round-btn" class="btn-pri" style="font-size: 20px; padding: 12px 40px; border-radius: 30px; display: none; background: linear-gradient(45deg, #10b981, #059669); border: 2px solid #34d399; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); text-transform: uppercase; font-weight: bold;">?? Tekrar Oyna</button>
             <span id="poke-spectator-msg" style="color: #94a3b8; font-style: italic; display: none;">Sýradaki tur bekleniyor...</span>
          </div>
        </div>
      </div>;

if (!content.includes('id="poke-card"')) {
  const barIndex = content.indexOf('<div class="bar">');
  if (barIndex !== -1) {
    content = content.substring(0, barIndex) + pokeCardHtml + '\n    ' + content.substring(barIndex);
  }
}

// 4. Add script tag
if (!content.includes('js/poke.js')) {
  content = content.replace('</body>', '  <script src="js/poke.js"></script>\n</body>');
}

fs.writeFileSync('index.html', content, 'utf8');
console.log('Successfully restored PokeSavaþ to index.html!');
