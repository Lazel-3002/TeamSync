/* =========================================================================
 * UNO — kanka-voice için sıfırdan, host-yetkili (host-authoritative) sürüm.
 *
 * Tasarım (sade ve deterministik):
 *  - Tek bir "host" oyuncu tüm deste/eller/sıra durumunu tutar (tek doğru
 *    kaynak). Diğer oyuncular yalnızca kendi ellerini ve herkese açık durumu
 *    (sıra, yön, renk, üstteki kart, kart sayıları) bilir.
 *  - Bir hamle yapmak isteyen oyuncu host'a istek yollar; host doğrular,
 *    durumu günceller ve (a) herkese açık durumu yayınlar, (b) eli değişen
 *    her oyuncuya kendi elini özelden gönderir.
 *  - Klasik UNO: 0-9, Ters, Engel, +2, Joker, +4 Joker. Yığma (stacking) ve
 *    +4 meydan okuması bilinçli olarak yok — kurallar sade tutuldu.
 *  - Kart çekmek sırayı bitirir (tam 1 kart çekilir), böylece durum hiç
 *    kilitlenmez.
 *
 * renderer.js'in çağırdığı global'ler: initUno, handleUnoMessage,
 * unoHandlePeerLeft, unoSyncNewPeer.
 * ========================================================================= */

const UNO_COLORS = ['red', 'yellow', 'green', 'blue'];
const UNO_GLYPH = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' };

function unoIsWild(card) { return card.value === 'wild' || card.value === 'wild4'; }

function unoLabel(card) {
  if (card.value in UNO_GLYPH) return UNO_GLYPH[card.value];
  return card.value; // 0-9
}

// Bir kartın yüz HTML'i: renkli kartlarda çapraz beyaz oval + değer + köşeler.
function unoCardFaceHTML(card) {
  if (unoIsWild(card)) return `<span class="u-val">${unoLabel(card)}</span>`;
  const v = unoLabel(card);
  return `<span class="u-oval"></span><span class="u-val">${v}</span>` +
    `<span class="u-corner tl">${v}</span><span class="u-corner br">${v}</span>`;
}

function unoInitial(name) {
  const t = String(name || '?').trim();
  return t ? t.charAt(0).toUpperCase() : '?';
}

// Bir oyuncunun ekrandaki "çıpası": ben → elim, rakip → rakip şeridi kutusu.
function unoActorEl(id) {
  if (id === state.myId) return document.getElementById('uno-hand');
  const safe = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '');
  try { return document.querySelector('.u-opp[data-pid="' + safe + '"]'); } catch (e) { return null; }
}

// İki eleman arasında geçici "uçan kart" animasyonu (viewport koordinatları).
function unoFlyBetween(fromEl, toEl, faceHTML, faceClass, endRot, endDx, endDy) {
  if (!fromEl || !toEl || typeof fromEl.getBoundingClientRect !== 'function') return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  if ((!a.width && !a.height) || (!b.width && !b.height)) return;
  const sx = a.left + a.width / 2, sy = a.top + a.height / 2;
  const ex = b.left + b.width / 2 + (endDx || 0), ey = b.top + b.height / 2 + (endDy || 0);
  const rot = (typeof endRot === 'number') ? endRot : 6;
  const fly = document.createElement('div');
  fly.className = 'u-card u-fly ' + (faceClass || '');
  fly.innerHTML = faceHTML;
  fly.style.left = sx + 'px';
  fly.style.top = sy + 'px';
  // Başlangıçta hedef açının tersine hafif eğik dur; uçarken hedefe döner
  // (elden fırlatılıp masaya konuyormuş gibi doğal bir dönüş).
  fly.style.transform = 'translate(-50%,-50%) rotate(' + (-rot * 0.4) + 'deg)';
  // Tam ekran odak modunda tarayıcı yalnızca fullscreen elemanını çizer;
  // body'ye eklenen uçan kart görünmez. Kartı aktif fullscreen köküne ekle.
  (document.fullscreenElement || document.body).appendChild(fly);
  requestAnimationFrame(() => {
    fly.style.transform = 'translate(-50%,-50%) translate(' + (ex - sx) + 'px,' + (ey - sy) + 'px) rotate(' + rot + 'deg)';
  });
  setTimeout(() => { try { fly.remove(); } catch (e) {} }, 520);
}

function unoMakeDeck() {
  const deck = [];
  for (const color of UNO_COLORS) {
    deck.push({ color, value: '0' });
    for (let v = 1; v <= 9; v++) { deck.push({ color, value: String(v) }); deck.push({ color, value: String(v) }); }
    for (const a of ['skip', 'reverse', 'draw2']) { deck.push({ color, value: a }); deck.push({ color, value: a }); }
  }
  for (let i = 0; i < 4; i++) { deck.push({ color: null, value: 'wild' }); deck.push({ color: null, value: 'wild4' }); }
  return deck;
}

function unoShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Iskartaya atılan bir karta sabit (rastgele) eğim/kayma damgası vur; yığında
// her kart aynı açıda durur (her render'da zıplamaz).
function unoStampCard(card) {
  // Belirgin, dağınık bir yığın görünümü: geniş açı + kayma.
  const sign = Math.random() < 0.5 ? -1 : 1;
  card._r = sign * (10 + Math.round(Math.random() * 12));  // ±10°..±22°
  card._dx = Math.round(Math.random() * 22 - 11);          // ±11px
  card._dy = Math.round(Math.random() * 16 - 8);           // ±8px
  return card;
}

// Bir kart, üstteki karta + aktif renge göre oynanabilir mi?
function unoCanPlay(card, top, color) {
  if (!top) return true;
  if (unoIsWild(card)) return true;
  return card.color === color || card.value === top.value;
}

// Bekleyen +2/+4 cezası varken oynanabilecek yanıt kartları (ev kurallarına göre):
//  - Kombo: +2 üstüne +2 veya +4; +4 üstüne yalnız +4 (ceza katlanır).
//  - Bloklama: Engel (⊘) cezayı iptal eder, sıra normal ilerler.
function unoCanRespondPending(card) {
  if (!state.uno.pendingCount) return false;
  const r = state.uno.rules || {};
  if (r.stack && card.value === 'wild4') return true;
  if (r.stack && card.value === 'draw2' && state.uno.pendingKind === 'draw2') return true;
  if (r.block && card.value === 'skip') return true;
  return false;
}

// Ev kurallarından herhangi biri ceza bekletmeyi gerektiriyor mu?
function unoPenaltyIsPending() {
  const r = state.uno.rules || {};
  return !!(r.stack || r.block);
}

function unoNameOf(id) {
  const p = state.uno.players.find(x => x.id === id);
  return p ? p.name : '?';
}

function unoIsHost() { return state.uno.host === state.myId; }

/* ------------------------------- Görünümler ------------------------------ */

function unoShowView(view) {
  ['uno-lobby', 'uno-game', 'uno-over'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== view);
  });
}

function unoRenderLobby() {
  unoShowView('uno-lobby');
  const list = document.getElementById('uno-players');
  if (list) {
    list.innerHTML = '';
    state.uno.players.forEach((p, idx) => {
      const el = document.createElement('div');
      const isBot = String(p.id).startsWith('bot-');
      el.className = 'u-lobby-player' + (p.id === state.uno.host ? ' host' : '') + (isBot ? ' bot' : '');
      el.style.animationDelay = (idx * 0.05) + 's';
      el.innerHTML = `<span class="u-av">${escapeHtml(unoInitial(p.name))}</span>${escapeHtml(p.name)}` +
        `${p.id === state.uno.host ? ' 👑' : ''}${isBot ? ' 🤖' : ''}` +
        `${p.id === state.myId ? ' <span class="u-you">(sen)</span>' : ''}`;
      // Kurucu, kendisi dışındaki oyuncu ve botları atabilir.
      if (unoIsHost() && p.id !== state.myId) {
        const kick = document.createElement('button');
        kick.className = 'u-kick';
        kick.title = (isBot ? 'Botu' : 'Oyuncuyu') + ' at';
        kick.textContent = '✕';
        kick.addEventListener('click', (e) => { e.stopPropagation(); unoHostKick(p.id); });
        el.appendChild(kick);
      }
      list.appendChild(el);
    });
  }
  // Yeni oyun için animasyon bayraklarını sıfırla.
  state.uno._prevHandLen = 0;
  state.uno._lastSeq = undefined;
  state.uno._lastActionSeq = state.uno.actionSeq || 0;
  state.uno._celebrated = null;
  const hostSettings = document.getElementById('uno-host-settings');
  if (hostSettings) hostSettings.classList.toggle('hidden', !unoIsHost() || state.uno.started);
  unoRenderSettings(); // panel açıksa kural/rol değişikliklerini anında yansıt
  const maxSel = document.getElementById('uno-max');
  if (maxSel) maxSel.value = String(state.uno.maxPlayers);
  const addBot = document.getElementById('uno-add-bot');
  if (addBot) addBot.disabled = state.uno.players.length >= state.uno.maxPlayers;
  const seat = document.getElementById('uno-seat-info');
  if (seat) seat.textContent = `${state.uno.players.length} / ${state.uno.maxPlayers} koltuk dolu`;

  const startBtn = document.getElementById('uno-start');
  if (startBtn) startBtn.classList.toggle('hidden', !unoIsHost() || state.uno.players.length < 2);
  const hint = document.getElementById('uno-lobby-hint');
  if (hint) {
    if (unoIsHost()) hint.textContent = state.uno.players.length < 2 ? 'En az 2 oyuncu gerekli. Arkadaşların katılmasını bekle…' : 'Herkes hazır olduğunda "Başlat"a bas.';
    else hint.textContent = 'Kurucunun oyunu başlatması bekleniyor…';
  }
}

// Iskarta yığınını çiz (son ~5 kart üst üste, hafif kaykılmış). En üstteki
// kartın DIŞ elemanını döndürür (uçuşta gizleyip inişte slam vurmak için).
function unoRenderPile(hideTop) {
  const disc = document.getElementById('uno-discard');
  if (!disc) return null;
  disc.className = 'u-pile';
  disc.innerHTML = '';
  const pile = (state.uno.pile && state.uno.pile.length)
    ? state.uno.pile
    : (state.uno.top ? [state.uno.top] : []);
  if (!pile.length) {
    const e = document.createElement('div');
    e.className = 'u-card empty';
    disc.appendChild(e);
    return null;
  }
  let topOuter = null;
  pile.forEach((card, i) => {
    const outer = document.createElement('div');
    outer.className = 'u-pile-card';
    // Damga yoksa (eski durum) indeks tabanlı belirgin bir yelpaze kullan.
    const r = (typeof card._r === 'number') ? card._r : ((i % 2 ? 1 : -1) * (10 + (i * 7) % 12));
    const dx = (typeof card._dx === 'number') ? card._dx : ((i - 2) * 5);
    const dy = (typeof card._dy === 'number') ? card._dy : ((i % 2) * 4 - 2);
    outer.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${r}deg)`;
    outer.style.zIndex = String(i);
    const inner = document.createElement('div');
    inner.className = 'u-card ' + (card.color || 'wild');
    // Renk seçilmiş joker/+4: kart seçilen renge boyanır (eski kartlar statik).
    if (card._tint) inner.classList.add('u-tint', 'u-tint-' + card._tint);
    inner.innerHTML = unoCardFaceHTML(card);
    outer.appendChild(inner);
    if (i === pile.length - 1) { topOuter = outer; if (hideTop) outer.classList.add('u-pile-hidden'); }
    disc.appendChild(outer);
  });
  return topOuter;
}

function unoRenderGame() {
  unoShowView('uno-game');

  const myTurn = state.uno.turnId === state.myId;
  const meIdx = state.uno.players.findIndex(p => p.id === state.myId);
  const n = state.uno.players.length;

  // Yeni eylem grubu algıla → uçan kart animasyonları (atış + zorunlu çekişler).
  const seq = state.uno.actionSeq || 0;
  const isNewBatch = seq > 0 && seq !== state.uno._lastActionSeq;
  const events = (isNewBatch && Array.isArray(state.uno.events)) ? state.uno.events : [];
  state.uno._lastActionSeq = seq;
  const playEvent = events.find(e => e.kind === 'play');
  const myDraw = events.find(e => e.kind === 'draw' && e.actorId === state.myId);

  // Rakipler (data-pid ile — uçuş hedefi/kaynağı olarak kullanılır)
  const opp = document.getElementById('uno-opponents');
  if (opp) {
    opp.innerHTML = '';
    for (let k = 1; k < n; k++) {
      const p = state.uno.players[(meIdx + k) % n];
      if (!p) continue;
      const isBot = String(p.id).startsWith('bot-');
      const el = document.createElement('div');
      el.className = 'u-opp' + (p.id === state.uno.turnId ? ' turn' : '') + (isBot ? ' bot' : '');
      el.dataset.pid = p.id;
      const minis = '<span class="u-mini-back"></span>'.repeat(Math.max(1, Math.min(p.count, 10)));
      el.innerHTML =
        `<div class="u-opp-fan">${minis}</div>` +
        `<div class="u-opp-badge"><span class="u-opp-av">${escapeHtml(unoInitial(p.name))}</span>` +
        `<span class="u-opp-name">${escapeHtml(p.name)}</span>` +
        `<span class="u-opp-count">${p.count}</span></div>`;
      opp.appendChild(el);
    }
  }

  // Renk rozeti
  const colorBadge = document.getElementById('uno-color');
  if (colorBadge) {
    colorBadge.className = 'u-color-badge ' + (state.uno.color || '');
    colorBadge.textContent = ({ red: 'Kırmızı', yellow: 'Sarı', green: 'Yeşil', blue: 'Mavi' })[state.uno.color] || '';
  }

  const pendingN = state.uno.pendingCount || 0;
  const awaitingMe = state.uno.awaitId === state.myId;
  const turnEl = document.getElementById('uno-turn');
  if (turnEl) {
    if (awaitingMe) {
      turnEl.textContent = 'Çektiğin kart oynanabilir — at ya da beklet!';
    } else if (state.uno.awaitId) {
      turnEl.textContent = `${unoNameOf(state.uno.awaitId)} çektiği kartı düşünüyor…`;
    } else if (pendingN > 0) {
      turnEl.textContent = myTurn
        ? `Sıra sende! +${pendingN} ceza — yanıtla ya da desteden çek`
        : `Sıra: ${unoNameOf(state.uno.turnId)} (+${pendingN} ceza bekliyor)`;
    } else {
      turnEl.textContent = myTurn ? 'Sıra sende!' : `Sıra: ${unoNameOf(state.uno.turnId)}`;
    }
    turnEl.classList.toggle('me', myTurn);
  }

  // "At / Beklet" karar çubuğu yalnızca kararı beklenen oyuncuda görünür.
  const choiceEl = document.getElementById('uno-draw-choice');
  if (choiceEl) choiceEl.classList.toggle('hidden', !awaitingMe);

  // Yön göstergesi — yön değişince döndür
  const dirEl = document.getElementById('uno-dir');
  if (dirEl) {
    dirEl.textContent = state.uno.dir === 1 ? '↻' : '↺';
    if (state.uno.dir !== state.uno._lastDir) {
      state.uno._lastDir = state.uno.dir;
      dirEl.classList.remove('u-spin'); void dirEl.offsetWidth; dirEl.classList.add('u-spin');
    }
  }

  const deckEl = document.getElementById('uno-deck');
  if (deckEl) {
    deckEl.classList.toggle('u-actionable', myTurn);
    deckEl.title = (pendingN > 0 && myTurn) ? `Cezayı çek (+${pendingN})` : 'Kart çek';
  }

  // Iskarta YIĞINI — kart atıldıysa atan kişiden yığının üstüne, KONACAĞI
  // açı ve konuma dönerek uçar; inişte "slam". Eski kartlar yerinde kalır.
  const discard = document.getElementById('uno-discard');
  const playFly = !!playEvent && !!state.uno.top;
  if (discard) {
    const topOuter = unoRenderPile(playFly);
    const topInner = topOuter ? topOuter.firstChild : null;
    if (playFly && topOuter) {
      const t = state.uno.top;
      unoFlyBetween(
        unoActorEl(playEvent.actorId), discard, unoCardFaceHTML(t), t.color || 'wild',
        (typeof t._r === 'number' ? t._r : 0),
        (typeof t._dx === 'number' ? t._dx : 0),
        (typeof t._dy === 'number' ? t._dy : 0)
      );
      // Yeni inen jokerde renk statik değil animasyonla dolsun (iniş sonrası süpürme).
      if (topInner && t._tint) { topInner.classList.remove('u-tint'); topInner.classList.add('u-tint-anim'); }
      setTimeout(() => {
        topOuter.classList.remove('u-pile-hidden');
        if (topInner) { topInner.classList.remove('u-slam'); void topInner.offsetWidth; topInner.classList.add('u-slam'); }
      }, 440);
    } else if (topInner && state.uno.playSeq !== state.uno._lastSeq) {
      if (state.uno.top && state.uno.top._tint) { topInner.classList.remove('u-tint'); topInner.classList.add('u-tint-anim'); }
      topInner.classList.remove('u-slam'); void topInner.offsetWidth; topInner.classList.add('u-slam');
    }
    state.uno._lastSeq = state.uno.playSeq;
  }

  // Elim — kart çektiysem (manuel veya +2/+4 zorunlu) desteden elime kartlar
  // ard arda ("tak tak tak") uçar; her biri inince yerine oturur.
  const handEl = document.getElementById('uno-hand');
  if (handEl) {
    const cards = state.uno.hand || [];
    const prevLen = state.uno._prevHandLen || 0;
    const animMine = !!myDraw && cards.length > prevLen;
    handEl.classList.toggle('my-turn', myTurn);
    handEl.innerHTML = '';
    const pendingEls = [];
    cards.forEach((card, i) => {
      const el = document.createElement('div');
      let playable;
      if (awaitingMe) {
        // Yalnızca çekilen (son) kart oynanabilir; digerleri kilitli.
        playable = i === cards.length - 1;
      } else {
        playable = myTurn && (pendingN > 0
          ? unoCanRespondPending(card)
          : unoCanPlay(card, state.uno.top, state.uno.color));
      }
      el.className = 'u-card ' + (card.color || 'wild') + (playable ? ' playable' : '') + (myTurn && !playable ? ' dimmed' : '');
      if (awaitingMe && i === cards.length - 1) el.classList.add('u-drawn');
      if (i >= prevLen) {
        if (animMine) { el.classList.add('u-pending'); pendingEls.push(el); }
        else { el.classList.add('u-deal-in'); el.style.setProperty('--d', ((i - prevLen) * 0.05) + 's'); }
      }
      el.style.zIndex = String(i);
      el.innerHTML = unoCardFaceHTML(card);
      el.addEventListener('click', () => unoPlayFromHand(i));
      handEl.appendChild(el);
    });
    if (animMine && deckEl) {
      pendingEls.forEach((el, j) => {
        setTimeout(() => unoFlyBetween(deckEl, handEl, '<span class="u-val">UNO</span>', 'back', Math.round(Math.random() * 16 - 8)), j * 150);
        setTimeout(() => {
          el.classList.remove('u-pending');
          el.classList.add('u-deal-in');
          el.style.setProperty('--d', '0s');
        }, j * 150 + 300);
      });
    }
    state.uno._prevHandLen = cards.length;
  }

  // Rakip(ler) kart çektiyse (manuel veya zorunlu) desteden onlara doğru
  // kapalı kartlar ard arda uçar.
  if (deckEl) {
    events.forEach(e => {
      if (e.kind === 'draw' && e.actorId !== state.myId) {
        const tgt = unoActorEl(e.actorId);
        const cnt = Math.max(1, e.count || 1);
        for (let j = 0; j < cnt; j++) {
          setTimeout(() => unoFlyBetween(deckEl, tgt, '<span class="u-val">UNO</span>', 'back', Math.round(Math.random() * 20 - 10)), j * 130);
        }
      }
    });
  }
}

function unoConfetti() {
  const host = document.getElementById('uno-over');
  if (!host) return;
  host.querySelectorAll('.u-confetti').forEach(c => c.remove());
  const colors = ['#d9282f', '#f4b41a', '#2f9e44', '#1a71c9', '#a855f7', '#fff'];
  for (let i = 0; i < 44; i++) {
    const c = document.createElement('div');
    c.className = 'u-confetti';
    c.style.left = (Math.random() * 100) + '%';
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.animationDuration = (1.4 + Math.random() * 1.5) + 's';
    c.style.animationDelay = (Math.random() * 0.6) + 's';
    c.style.width = (7 + Math.random() * 6) + 'px';
    c.style.height = (10 + Math.random() * 8) + 'px';
    host.appendChild(c);
  }
  setTimeout(() => host.querySelectorAll('.u-confetti').forEach(c => c.remove()), 3800);
}

function unoRenderOver() {
  unoShowView('uno-over');
  const w = document.getElementById('uno-over-winner');
  if (w) {
    const wid = state.uno.winnerId;
    w.textContent = wid === state.myId ? 'Kazandın!' : `${unoNameOf(wid)} kazandı!`;
  }
  const replay = document.getElementById('uno-replay');
  if (replay) replay.classList.toggle('hidden', !unoIsHost());
  const wait = document.getElementById('uno-over-wait');
  if (wait) wait.classList.toggle('hidden', unoIsHost());
  // Konfetiyi her oyun sonu için yalnızca bir kez patlat.
  if (state.uno._celebrated !== state.uno.winnerId) {
    state.uno._celebrated = state.uno.winnerId;
    unoConfetti();
  }
}

/* ---------------------------- Oyuncu eylemleri --------------------------- */

function unoPlayFromHand(index) {
  const card = (state.uno.hand || [])[index];
  if (!card) return;
  if (state.uno.turnId !== state.myId) { showToast('Sıra sende değil.', 'warn'); return; }
  // "At / Beklet" beklerken yalnızca çekilen (son) kart oynanabilir.
  if (state.uno.awaitId === state.myId && index !== state.uno.hand.length - 1) {
    showToast('Yalnızca çektiğin kartı oynayabilir ya da bekletebilirsin.', 'warn');
    return;
  }
  if (state.uno.pendingCount > 0) {
    if (!unoCanRespondPending(card)) {
      showToast(`+${state.uno.pendingCount} ceza bekliyor: yanıt kartı oyna ya da desteden çek.`, 'warn');
      return;
    }
  } else if (!unoCanPlay(card, state.uno.top, state.uno.color)) { showToast('Bu kart oynanamaz.', 'warn'); return; }

  if (unoIsWild(card)) {
    unoOpenColorPicker(chosen => unoRequestPlay(card, chosen));
  } else {
    unoRequestPlay(card, null);
  }
}

function unoRequestPlay(card, chosenColor) {
  if (unoIsHost()) unoHostApplyPlay(state.myId, card, chosenColor);
  else broadcastTo(state.uno.host, { type: 'uno-play', card: { color: card.color, value: card.value }, color: chosenColor });
}

function unoRequestDraw() {
  if (state.uno.turnId !== state.myId) { showToast('Sıra sende değil.', 'warn'); return; }
  // Karar beklerken desteye tıklamak = beklet.
  if (state.uno.awaitId === state.myId) { unoRequestKeep(); return; }
  if (unoIsHost()) unoHostApplyDraw(state.myId);
  else broadcastTo(state.uno.host, { type: 'uno-draw' });
}

function unoRequestKeep() {
  if (state.uno.awaitId !== state.myId) return;
  if (unoIsHost()) unoHostApplyKeep(state.myId);
  else broadcastTo(state.uno.host, { type: 'uno-keep' });
}

function unoOpenColorPicker(cb) {
  const picker = document.getElementById('uno-color-picker');
  if (!picker) { cb(UNO_COLORS[Math.floor(Math.random() * 4)]); return; }
  picker.classList.remove('hidden');
  picker.querySelectorAll('.u-swatch').forEach(sw => {
    sw.onclick = () => { picker.classList.add('hidden'); cb(sw.dataset.color); };
  });
}

/* ------------------------------- Host mantığı ---------------------------- */

/* ---- Botlar (host tarafında otomatik oynar) ---- */

function unoBotName(i) { return 'Bot ' + i; }

function unoAddBot() {
  if (!unoIsHost() || state.uno.started) return;
  if (state.uno.players.length >= state.uno.maxPlayers) { showToast('Koltuklar dolu.', 'warn'); return; }
  let i = 1;
  while (state.uno.players.some(p => p.id === 'bot-' + i)) i++;
  state.uno.players.push({ id: 'bot-' + i, name: unoBotName(i), count: 0, isBot: true });
  unoHostBroadcastLobby();
  unoRenderLobby();
}

function unoFillBots() {
  let i = 1;
  while (state.uno.players.length < state.uno.maxPlayers) {
    while (state.uno.players.some(p => p.id === 'bot-' + i)) i++;
    state.uno.players.push({ id: 'bot-' + i, name: unoBotName(i), count: 0, isBot: true });
  }
}

function unoBotPickColor(hand) {
  const cnt = { red: 0, yellow: 0, green: 0, blue: 0 };
  hand.forEach(c => { if (c.color && cnt[c.color] !== undefined) cnt[c.color]++; });
  let best = UNO_COLORS[Math.floor(Math.random() * 4)], bv = -1;
  for (const c of UNO_COLORS) if (cnt[c] > bv) { bv = cnt[c]; best = c; }
  return best;
}

function unoBotPlay(botId) {
  if (!unoIsHost() || !state.uno.started) return;
  if (state.uno.turnId !== botId) return;
  const hand = state.uno.hands[botId] || [];
  // Bekleyen ceza varsa: önce +2/blok gibi ucuz yanıt, sonra +4, yoksa cezayı çek.
  if (state.uno.pendingCount > 0) {
    let idx = hand.findIndex(c => !unoIsWild(c) && unoCanRespondPending(c));
    if (idx === -1) idx = hand.findIndex(c => unoCanRespondPending(c));
    if (idx === -1) { unoHostApplyDraw(botId); return; }
    const card = hand[idx];
    unoHostApplyPlay(botId, card, unoIsWild(card) ? unoBotPickColor(hand) : null);
    return;
  }
  // Önce oynanabilir renkli/sayı kartı, sonra joker, yoksa çek.
  let idx = hand.findIndex(c => !unoIsWild(c) && unoCanPlay(c, state.uno.top, state.uno.color));
  if (idx === -1) idx = hand.findIndex(c => unoIsWild(c));
  if (idx === -1) { unoHostApplyDraw(botId); return; }
  const card = hand[idx];
  unoHostApplyPlay(botId, card, unoIsWild(card) ? unoBotPickColor(hand) : null);
}

// Sıra bir bota geldiyse kısa gecikmeyle otomatik oynat.
function unoMaybeBotTurn() {
  if (!unoIsHost() || !state.uno.started) return;
  const cur = state.uno.players[state.uno.turnIndex];
  if (cur && cur.isBot) {
    clearTimeout(state.uno.botTimer);
    state.uno.botTimer = setTimeout(() => unoBotPlay(cur.id), 850);
  }
}

function unoHostStart() {
  if (!unoIsHost()) return;
  if (document.getElementById('uno-fill-bots')?.checked) unoFillBots();
  if (state.uno.players.length < 2) { showToast('En az 2 oyuncu gerekli.', 'warn'); return; }

  const deck = unoShuffle(unoMakeDeck());
  const hands = {};
  state.uno.players.forEach(p => { hands[p.id] = []; p.count = 0; });
  // Başlangıç el sayısı ev kuralı (5-10, varsayılan 7).
  const startCards = Math.max(5, Math.min(10, parseInt(state.uno.rules?.startCards, 10) || 7));
  for (let r = 0; r < startCards; r++) for (const p of state.uno.players) hands[p.id].push(deck.pop());

  // İlk ıskarta sayı kartı olsun (joker/aksiyonla başlama karmaşasını önle)
  let first = deck.pop();
  while (first && (unoIsWild(first) || !/^[0-9]$/.test(first.value))) { deck.unshift(first); first = deck.pop(); }
  if (first) unoStampCard(first);

  state.uno.deck = deck;
  state.uno.discard = [first];
  state.uno.hands = hands;
  state.uno.top = first;
  state.uno.color = first.color;
  state.uno.dir = 1;
  state.uno.turnIndex = 0;
  state.uno.turnId = state.uno.players[0].id;
  state.uno.started = true;
  state.uno.winnerId = null;
  state.uno.playSeq = 0;
  state.uno.actionSeq = 0;
  state.uno.events = [];
  state.uno.pendingCount = 0;
  state.uno.pendingKind = null;
  state.uno.awaitId = null;
  state.uno.awaitCard = null;

  unoHostSync();
}

function unoHostReshuffleIfNeeded() {
  if (state.uno.deck.length > 0) return;
  if (state.uno.discard.length <= 1) return;
  const top = state.uno.discard.pop();
  // Desteye dönen kartlardan yığın damgalarını (_r/_dx/_dy) temizle.
  const rest = state.uno.discard.map(c => ({ color: unoIsWild(c) ? null : c.color, value: c.value }));
  state.uno.deck = unoShuffle(rest);
  state.uno.discard = [top];
}

function unoHostDraw(pid, count) {
  const hand = state.uno.hands[pid];
  if (!hand) return;
  for (let i = 0; i < count; i++) {
    unoHostReshuffleIfNeeded();
    if (state.uno.deck.length === 0) break;
    hand.push(state.uno.deck.pop());
  }
}

function unoHostAdvance(steps) {
  const n = state.uno.players.length;
  state.uno.turnIndex = ((state.uno.turnIndex + state.uno.dir * steps) % n + n) % n;
}

function unoPlayerIndexAt(offset) {
  const n = state.uno.players.length;
  return ((state.uno.turnIndex + state.uno.dir * offset) % n + n) % n;
}

function unoHostApplyPlay(pid, card, chosenColor) {
  if (!unoIsHost() || !state.uno.started) return;
  if (state.uno.turnId !== pid) return;
  const hand = state.uno.hands[pid];
  if (!hand) return;

  const idx = hand.findIndex(c => c.color === card.color && c.value === card.value);
  if (idx === -1) return;
  const played = hand[idx];
  // "At / Beklet" kararı beklenirken yalnızca çekilen kart oynanabilir.
  if (state.uno.awaitId) {
    if (state.uno.awaitId !== pid) return;
    const ac = state.uno.awaitCard;
    if (!ac || played.color !== ac.color || played.value !== ac.value) return;
    state.uno.awaitId = null;
    state.uno.awaitCard = null;
  }
  // Bekleyen ceza varken yalnızca kombo/blok yanıtları geçerli; yoksa normal kural.
  if (state.uno.pendingCount > 0) {
    if (!unoCanRespondPending(played)) return;
  } else if (!unoCanPlay(played, state.uno.top, state.uno.color)) return;

  hand.splice(idx, 1);
  unoStampCard(played);
  state.uno.discard.push(played);
  state.uno.top = played;
  state.uno.playSeq = (state.uno.playSeq || 0) + 1;
  state.uno.actionSeq = (state.uno.actionSeq || 0) + 1;
  state.uno.events = [{ kind: 'play', actorId: pid }];
  state.uno.color = unoIsWild(played)
    ? (UNO_COLORS.includes(chosenColor) ? chosenColor : UNO_COLORS[Math.floor(Math.random() * 4)])
    : played.color;
  // Joker/+4: seçilen renk karta damgalanır; ıskartada kart animasyonla o renge boyanır.
  if (unoIsWild(played)) played._tint = state.uno.color;

  // Kazanma
  if (hand.length === 0) {
    state.uno.started = false;
    state.uno.winnerId = pid;
    unoHostUpdateCounts();
    broadcast({ type: 'uno-over', winnerId: pid, winnerName: unoNameOf(pid) });
    unoHostSync();
    return;
  }

  if (hand.length === 1) broadcast({ type: 'uno-uno', id: pid, name: unoNameOf(pid) });

  const n = state.uno.players.length;

  // Bekleyen cezaya yanıt (kombo/blok kuralları): kartın normal etkisi işlemez.
  if (state.uno.pendingCount > 0) {
    if (played.value === 'skip') {
      // Blok: ceza iptal, Engel "cezayı savmak" için harcandı → sıra normal ilerler.
      state.uno.pendingCount = 0;
      state.uno.pendingKind = null;
    } else if (played.value === 'draw2') {
      state.uno.pendingCount += 2;
    } else if (played.value === 'wild4') {
      state.uno.pendingCount += 4;
      state.uno.pendingKind = 'wild4'; // artık üstüne yalnız +4 yığılabilir
    }
    unoHostAdvance(1);
    unoHostSync();
    return;
  }

  switch (played.value) {
    case 'reverse':
      if (n === 2) { unoHostAdvance(2); }           // 2 kişide ters = engel
      else { state.uno.dir *= -1; unoHostAdvance(1); }
      break;
    case 'skip':
      unoHostAdvance(2);
      break;
    case 'draw2': {
      if (unoPenaltyIsPending()) {
        // Kombo/blok açık: kurban hemen çekmez; yanıt hakkıyla sırayı devralır.
        state.uno.pendingCount = 2;
        state.uno.pendingKind = 'draw2';
        unoHostAdvance(1);
        break;
      }
      const victim = state.uno.players[unoPlayerIndexAt(1)];
      unoHostDraw(victim.id, 2);
      state.uno.events.push({ kind: 'draw', actorId: victim.id, count: 2 });
      unoHostAdvance(2);
      break;
    }
    case 'wild4': {
      if (unoPenaltyIsPending()) {
        state.uno.pendingCount = 4;
        state.uno.pendingKind = 'wild4';
        unoHostAdvance(1);
        break;
      }
      const victim = state.uno.players[unoPlayerIndexAt(1)];
      unoHostDraw(victim.id, 4);
      state.uno.events.push({ kind: 'draw', actorId: victim.id, count: 4 });
      unoHostAdvance(2);
      break;
    }
    default:
      unoHostAdvance(1);
  }

  unoHostSync();
}

function unoHostApplyDraw(pid) {
  if (!unoIsHost() || !state.uno.started) return;
  if (state.uno.turnId !== pid) return;
  // "At / Beklet" kararı beklerken desteye tıklamak = beklet (kart zaten çekildi).
  if (state.uno.awaitId === pid) { unoHostApplyKeep(pid); return; }
  // Bekleyen ceza varsa desteye tıklamak cezanın tamamını çekmektir.
  const count = state.uno.pendingCount > 0 ? state.uno.pendingCount : 1;
  const wasPenalty = state.uno.pendingCount > 0;
  state.uno.pendingCount = 0;
  state.uno.pendingKind = null;
  const hand = state.uno.hands[pid] || [];
  const beforeLen = hand.length;
  unoHostDraw(pid, count);
  const drawn = hand.length > beforeLen ? hand[hand.length - 1] : null;
  state.uno.actionSeq = (state.uno.actionSeq || 0) + 1;
  state.uno.events = [{ kind: 'draw', actorId: pid, count }];

  // Normal (ceza olmayan) çekişte kart oynanabilirse sıra hemen bitmez:
  // insan oyuncuya "At / Beklet" seçimi sunulur; bot anında oynar.
  if (!wasPenalty && drawn && unoCanPlay(drawn, state.uno.top, state.uno.color)) {
    const p = state.uno.players.find(x => x.id === pid);
    if (p && p.isBot) {
      unoHostSync(); // çekiş animasyonu herkese gitsin
      clearTimeout(state.uno.botTimer);
      state.uno.botTimer = setTimeout(() => {
        if (!state.uno.started || state.uno.turnId !== pid) return;
        unoHostApplyPlay(pid, drawn, unoIsWild(drawn) ? unoBotPickColor(hand) : null);
      }, 700);
      return;
    }
    state.uno.awaitId = pid;
    state.uno.awaitCard = { color: drawn.color, value: drawn.value };
    unoHostSync();
    return;
  }

  unoHostAdvance(1); // çekmek sırayı bitirir
  unoHostSync();
}

// "Beklet" kararı: çekilen kart elde kalır, sıra bir sonrakine geçer.
function unoHostApplyKeep(pid) {
  if (!unoIsHost() || !state.uno.started) return;
  if (state.uno.awaitId !== pid) return;
  state.uno.awaitId = null;
  state.uno.awaitCard = null;
  state.uno.events = [];
  unoHostAdvance(1);
  unoHostSync();
}

function unoHostUpdateCounts() {
  state.uno.players.forEach(p => { p.count = (state.uno.hands[p.id] || []).length; });
}

// Herkese açık durumu yayınla + herkese kendi elini gönder + host kendini çiz.
function unoHostSync() {
  unoHostUpdateCounts();
  if (state.uno.started) state.uno.turnId = state.uno.players[state.uno.turnIndex].id;

  broadcast({
    type: 'uno-state',
    started: state.uno.started,
    players: state.uno.players.map(p => ({ id: p.id, name: p.name, count: p.count })),
    turnId: state.uno.turnId,
    dir: state.uno.dir,
    color: state.uno.color,
    top: state.uno.top,
    pile: state.uno.discard.slice(-5),
    playSeq: state.uno.playSeq || 0,
    actionSeq: state.uno.actionSeq || 0,
    events: state.uno.events || [],
    winnerId: state.uno.winnerId,
    rules: state.uno.rules,
    pendingCount: state.uno.pendingCount || 0,
    pendingKind: state.uno.pendingKind || null,
    awaitId: state.uno.awaitId || null
  });

  state.uno.players.forEach(p => {
    if (p.id === state.myId || p.isBot) return; // botlara/kendime özel el gönderme
    broadcastTo(p.id, { type: 'uno-hand', hand: state.uno.hands[p.id] || [] });
  });

  state.uno.pile = state.uno.discard.slice(-5);
  state.uno.hand = state.uno.hands[state.myId] || [];
  if (!state.uno.started && state.uno.winnerId) unoRenderOver();
  else if (state.uno.started) unoRenderGame();
  else unoRenderLobby();

  unoMaybeBotTurn();
}

function unoHostBroadcastLobby() {
  broadcast({
    type: 'uno-lobby',
    host: state.uno.host,
    started: state.uno.started,
    maxPlayers: state.uno.maxPlayers,
    players: state.uno.players.map(p => ({ id: p.id, name: p.name, count: 0 })),
    rules: state.uno.rules
  });
}

/* ------------------------------ Kurallar paneli -------------------------- */

// Herkes paneli açıp kuralları görebilir; anahtarları yalnızca kurucu ve yalnız
// oyun başlamadan değiştirebilir.
function unoRenderSettings() {
  const rules = state.uno.rules || { stack: false, block: false, startCards: 7 };
  const canEdit = unoIsHost() && !state.uno.started;
  const scSel = document.getElementById('uno-rule-startcards');
  const scVal = Math.max(5, Math.min(10, parseInt(rules.startCards, 10) || 7));
  if (scSel) { scSel.value = String(scVal); scSel.disabled = !canEdit; }
  const scSum = document.getElementById('uno-startcards-sum');
  if (scSum) scSum.textContent = scVal + ' kart';
  [['stack', 'uno-rule-stack'], ['block', 'uno-rule-block']].forEach(([key, id]) => {
    const cb = document.getElementById(id);
    if (cb) { cb.checked = !!rules[key]; cb.disabled = !canEdit; }
    const label = document.querySelector(`.u-rule-state[data-for="${key}"]`);
    if (label) {
      label.textContent = rules[key] ? 'Açık' : 'Kapalı';
      label.classList.toggle('on', !!rules[key]);
    }
    const cardEl = document.querySelector(`.u-rule-card[data-rule="${key}"]`);
    if (cardEl) cardEl.classList.toggle('on', !!rules[key]);
  });
  const hint = document.getElementById('uno-settings-hint');
  if (hint) {
    if (canEdit) hint.textContent = 'Kurucu olarak kuralları buradan değiştirebilirsin.';
    else if (unoIsHost()) hint.textContent = 'Kurallar oyun sırasında değiştirilemez.';
    else hint.textContent = 'Kuralları yalnızca kurucu değiştirebilir.';
  }
}

function unoHostSetRule(key, value) {
  if (!unoIsHost() || state.uno.started) { unoRenderSettings(); return; }
  state.uno.rules = Object.assign({ stack: false, block: false, startCards: 7 }, state.uno.rules);
  state.uno.rules[key] = (key === 'startCards')
    ? Math.max(5, Math.min(10, parseInt(value, 10) || 7))
    : !!value;
  unoRenderSettings();
  broadcast({ type: 'uno-rules', rules: state.uno.rules });
}

/* ------------------------- Kart açılışı / katılım ------------------------ */

function unoOpenCard() {
  closeAllCards(false, 'uno-card');
  const card = document.getElementById('uno-card');
  card.classList.remove('hidden');
  makeCardFocusable(card);
  if (!focusedCard) toggleFocus(card);
}

function unoBecomeHost() {
  state.uno.host = state.myId;
  state.uno.started = false;
  state.uno.winnerId = null;
  state.uno.joinedActivity = true;
  state.uno.players = [{ id: state.myId, name: state.myName, count: 0 }];
  unoOpenCard();
  unoRenderLobby();
  unoHostBroadcastLobby();
}

function unoJoinAsGuest() {
  state.uno.joinedActivity = true;
  removeInactiveOverlay('uno-card');
  if (!state.uno.players.some(p => p.id === state.myId)) {
    state.uno.players.push({ id: state.myId, name: state.myName, count: 0 });
  }
  if (!focusedCard) toggleFocus(document.getElementById('uno-card'));
  broadcastTo(state.uno.host, { type: 'uno-join', name: state.myName });
  unoRenderLobby();
}

/* ------------------------------ Mesaj yönlendirme ------------------------ */

function handleUnoMessage(peerId, msg) {
  switch (msg.type) {
    case 'uno-lobby': {
      // Kurucu bir lobi açtı/güncelledi.
      if (state.uno.host === state.myId) return; // ben zaten hostum
      state.uno.host = msg.host;
      state.uno.started = msg.started;
      if (msg.maxPlayers) state.uno.maxPlayers = msg.maxPlayers;
      if (msg.rules) state.uno.rules = Object.assign({ stack: false, block: false }, msg.rules);
      state.uno.players = msg.players || [];
      if (!msg.started) {
        unoOpenCard();
        if (state.uno.joinedActivity) {
          if (!state.uno.players.some(p => p.id === state.myId)) {
            state.uno.players.push({ id: state.myId, name: state.myName, count: 0 });
            broadcastTo(state.uno.host, { type: 'uno-join', name: state.myName });
          }
          unoRenderLobby();
        } else {
          unoRenderLobby();
          showInactiveOverlay('uno-card', 'UNO', unoJoinAsGuest);
        }
      }
      break;
    }
    case 'uno-join': {
      // Host'a yeni katılım isteği geldi.
      if (state.uno.host !== state.myId) return;
      if (state.uno.started) { unoSyncNewPeer(peerId); return; }
      const already = state.uno.players.some(p => p.id === peerId);
      if (!already && state.uno.players.length >= state.uno.maxPlayers) return; // koltuk dolu
      if (!already) {
        state.uno.players.push({ id: peerId, name: msg.name || unoNameOf(peerId), count: 0 });
      }
      unoHostBroadcastLobby();
      unoRenderLobby();
      break;
    }
    case 'uno-play':
      if (state.uno.host === state.myId) unoHostApplyPlay(peerId, msg.card, msg.color);
      break;
    case 'uno-draw':
      if (state.uno.host === state.myId) unoHostApplyDraw(peerId);
      break;
    case 'uno-keep':
      if (state.uno.host === state.myId) unoHostApplyKeep(peerId);
      break;
    case 'uno-state': {
      if (state.uno.host === state.myId) return; // kendi yayınım
      state.uno.started = msg.started;
      state.uno.players = msg.players || [];
      state.uno.turnId = msg.turnId;
      state.uno.dir = msg.dir;
      state.uno.color = msg.color;
      state.uno.top = msg.top;
      state.uno.pile = msg.pile || (msg.top ? [msg.top] : []);
      state.uno.playSeq = msg.playSeq || 0;
      state.uno.actionSeq = msg.actionSeq || 0;
      state.uno.events = msg.events || [];
      state.uno.winnerId = msg.winnerId || null;
      if (msg.rules) state.uno.rules = Object.assign({ stack: false, block: false, startCards: 7 }, msg.rules);
      state.uno.pendingCount = msg.pendingCount || 0;
      state.uno.pendingKind = msg.pendingKind || null;
      state.uno.awaitId = msg.awaitId || null;
      unoRenderSettings();
      unoOpenCard();
      if (!msg.started && msg.winnerId) unoRenderOver();
      else if (msg.started) unoRenderGame();
      else unoRenderLobby();
      break;
    }
    case 'uno-hand':
      if (state.uno.host === state.myId) return;
      state.uno.hand = msg.hand || [];
      if (state.uno.started) unoRenderGame();
      break;
    case 'uno-uno':
      showToast(`${escapeHtml(msg.name || unoNameOf(msg.id))}: UNO!`, 'ok');
      break;
    case 'uno-over':
      state.uno.started = false;
      state.uno.winnerId = msg.winnerId;
      unoOpenCard();
      unoRenderOver();
      break;
    case 'uno-leave':
      if (peerId === state.uno.host) {
        showToast('Kurucu ayrıldı, UNO kapatıldı.', 'warn');
        unoCloseLocal();
      }
      break;
    case 'uno-kick':
      if (peerId !== state.uno.host) return; // yalnızca kurucu atabilir
      showToast('Kurucu seni UNO oyunundan attı.', 'warn');
      if (typeof leaveActiveLobby === 'function' && state.activeLobbyId) leaveActiveLobby();
      unoCloseLocal();
      break;
    case 'uno-rules':
      if (peerId !== state.uno.host) return; // kuralları yalnızca kurucu değiştirir
      state.uno.rules = Object.assign({ stack: false, block: false }, msg.rules);
      unoRenderSettings();
      showToast('Kurucu oyun kurallarını güncelledi.', 'info');
      break;
  }
}

// Host tarafında bir oyuncuyu (bot/insan) oyundan çıkarır; ayrılma ve kick
// aynı yoldan geçer. Lobide ve oyun ortasında doğru çalışır.
function unoHostRemovePlayer(pid) {
  if (!unoIsHost()) return;
  const removedIdx = state.uno.players.findIndex(p => p.id === pid);
  if (removedIdx === -1) return;
  state.uno.players.splice(removedIdx, 1);
  if (state.uno.hands) delete state.uno.hands[pid];
  clearTimeout(state.uno.botTimer);
  if (state.uno.awaitId === pid) { state.uno.awaitId = null; state.uno.awaitCard = null; }

  if (state.uno.started) {
    if (state.uno.players.length < 2) {
      state.uno.started = false;
      state.uno.winnerId = state.uno.players[0] ? state.uno.players[0].id : null;
      if (state.uno.winnerId) broadcast({ type: 'uno-over', winnerId: state.uno.winnerId, winnerName: unoNameOf(state.uno.winnerId) });
      unoHostSync();
      return;
    }
    // Çıkan oyuncu sıradakinden ÖNCE oturuyorsa dizideki herkes bir sola kayar;
    // turnIndex'i de kaydırmazsak sıra yanlışlıkla bir kişi atlar.
    if (removedIdx < state.uno.turnIndex) state.uno.turnIndex--;
    if (state.uno.turnIndex >= state.uno.players.length) state.uno.turnIndex = 0;
    unoHostSync();
  } else {
    unoHostBroadcastLobby();
    unoRenderLobby();
  }
}

// Kurucu bir oyuncuyu/botu atar. Gerçek oyuncuya haber verilir ki kartı kapansın.
function unoHostKick(pid) {
  if (!unoIsHost() || pid === state.myId) return;
  const p = state.uno.players.find(x => x.id === pid);
  if (!p) return;
  if (!String(pid).startsWith('bot-')) {
    broadcastTo(pid, { type: 'uno-kick' });
  }
  showToast(`${p.name} oyundan atıldı.`, 'info');
  unoHostRemovePlayer(pid);
}

// renderer.js peer kopunca çağırır.
function unoHandlePeerLeft(peerId) {
  if (!state.uno || !state.uno.host) return;
  if (peerId === state.uno.host) {
    // Host gitti: oyunu yerel olarak kapat (basit ve güvenli).
    if (state.uno.host !== state.myId) {
      showToast('Kurucu bağlantısı koptu, UNO kapatıldı.', 'warn');
      unoCloseLocal();
    }
    return;
  }
  if (state.uno.host !== state.myId) return;
  unoHostRemovePlayer(peerId);
}

// renderer.js geç katılan peer'e senkron için çağırır (yalnızca host).
function unoSyncNewPeer(peerId) {
  if (state.uno.host !== state.myId) return;
  if (state.uno.started) {
    broadcastTo(peerId, {
      type: 'uno-state',
      started: true,
      players: state.uno.players.map(p => ({ id: p.id, name: p.name, count: p.count })),
      turnId: state.uno.turnId, dir: state.uno.dir, color: state.uno.color, top: state.uno.top, pile: state.uno.discard.slice(-5), playSeq: state.uno.playSeq || 0,
      actionSeq: state.uno.actionSeq || 0, events: [], winnerId: null,
      rules: state.uno.rules, pendingCount: state.uno.pendingCount || 0, pendingKind: state.uno.pendingKind || null,
      awaitId: state.uno.awaitId || null
    });
  } else {
    broadcastTo(peerId, {
      type: 'uno-lobby', host: state.uno.host, started: false,
      players: state.uno.players.map(p => ({ id: p.id, name: p.name, count: 0 })),
      rules: state.uno.rules
    });
  }
}

function unoCloseLocal() {
  clearTimeout(state.uno.botTimer);
  state.uno.host = null;
  state.uno.started = false;
  state.uno.joinedActivity = false;
  state.uno.players = [];
  state.uno.hand = [];
  state.uno.hands = {};
  state.uno.deck = [];
  state.uno.winnerId = null;
  state.uno.pendingCount = 0;
  state.uno.pendingKind = null;
  state.uno.awaitId = null;
  state.uno.awaitCard = null;
  document.getElementById('uno-settings')?.classList.add('hidden');
  const card = document.getElementById('uno-card');
  if (card && !card.classList.contains('hidden')) {
    if (focusedCard && focusedCard.id === 'uno-card') toggleFocus(card);
    card.classList.add('hidden');
  }
  unoShowView('uno-lobby');
}

/* --------------------------------- init --------------------------------- */

function initUno() {
  // Etkinlik menüsündeki gizli tetik düğmesi (lobi sistemi buna tıklar).
  document.getElementById('act-uno')?.addEventListener('click', () => {
    if (state.uno.host && state.uno.host !== state.myId) {
      // Bir lobiye katıldım: host'tan gelen duruma göre açılacak; şimdilik kartı aç.
      unoOpenCard();
      state.uno.joinedActivity = true;
      if (!state.uno.players.some(p => p.id === state.myId)) {
        state.uno.players.push({ id: state.myId, name: state.myName, count: 0 });
      }
      broadcastTo(state.uno.host, { type: 'uno-join', name: state.myName });
      unoRenderLobby();
    } else {
      unoBecomeHost();
    }
  });

  document.getElementById('uno-close')?.addEventListener('click', () => {
    if (state.uno.host === state.myId) broadcast({ type: 'uno-leave' });
    else broadcastTo(state.uno.host, { type: 'uno-leave' });
    if (typeof leaveActiveLobby === 'function' && state.activeLobbyId) leaveActiveLobby();
    unoCloseLocal();
  });

  document.getElementById('uno-start')?.addEventListener('click', unoHostStart);
  document.getElementById('uno-add-bot')?.addEventListener('click', unoAddBot);

  // Kurallar paneli: herkes açar, kurucu değiştirir.
  document.getElementById('uno-settings-btn')?.addEventListener('click', () => {
    unoRenderSettings();
    document.getElementById('uno-settings')?.classList.remove('hidden');
  });
  document.getElementById('uno-settings-close')?.addEventListener('click', () => {
    document.getElementById('uno-settings')?.classList.add('hidden');
  });
  document.getElementById('uno-rule-stack')?.addEventListener('change', (e) => unoHostSetRule('stack', e.target.checked));
  document.getElementById('uno-rule-block')?.addEventListener('change', (e) => unoHostSetRule('block', e.target.checked));
  document.getElementById('uno-rule-startcards')?.addEventListener('change', (e) => unoHostSetRule('startCards', e.target.value));

  // "At / Beklet" karar çubuğu
  document.getElementById('uno-draw-play')?.addEventListener('click', () => {
    if (state.uno.awaitId !== state.myId) return;
    unoPlayFromHand((state.uno.hand || []).length - 1);
  });
  document.getElementById('uno-draw-keep')?.addEventListener('click', unoRequestKeep);
  document.getElementById('uno-max')?.addEventListener('change', (e) => {
    if (!unoIsHost()) return;
    let v = Math.max(2, Math.min(8, parseInt(e.target.value, 10) || 4));
    v = Math.max(v, state.uno.players.length); // mevcut oyuncu sayısının altına inilemez
    state.uno.maxPlayers = v;
    e.target.value = String(v);
    unoHostBroadcastLobby();
    unoRenderLobby();
  });
  document.getElementById('uno-deck')?.addEventListener('click', unoRequestDraw);
  document.getElementById('uno-replay')?.addEventListener('click', () => {
    if (state.uno.host !== state.myId) return;
    state.uno.started = false;
    state.uno.winnerId = null;
    state.uno.hand = [];
    unoRenderLobby();
    unoHostBroadcastLobby();
  });
}
