import React, { useEffect, useMemo, useRef, useState } from 'react';

const LANGUAGES = {
  tr: {
    label: 'Türkçe', locale: 'tr-TR', letters: 'ABCÇDEFGHIİJKLMNOÖPRSŞTUÜVYZ'.split(''),
    categories: [['name', 'İsim'], ['place', 'Şehir / Ülke'], ['animal', 'Hayvan'], ['plant', 'Bitki'], ['object', 'Eşya'], ['job', 'Meslek'], ['food', 'Yemek'], ['movie', 'Film / Dizi']],
  },
  en: {
    label: 'English', locale: 'en-US', letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    categories: [['name', 'Name'], ['place', 'Place'], ['animal', 'Animal'], ['plant', 'Plant'], ['object', 'Object'], ['job', 'Profession'], ['food', 'Food'], ['movie', 'Film / TV show']],
  },
  de: {
    label: 'Deutsch', locale: 'de-DE', letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'.split(''),
    categories: [['name', 'Name'], ['place', 'Ort / Land'], ['animal', 'Tier'], ['plant', 'Pflanze'], ['object', 'Gegenstand'], ['job', 'Beruf'], ['food', 'Essen'], ['movie', 'Film / Serie']],
  },
  es: {
    label: 'Español', locale: 'es-ES', letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÑ'.split(''),
    categories: [['name', 'Nombre'], ['place', 'Lugar / País'], ['animal', 'Animal'], ['plant', 'Planta'], ['object', 'Objeto'], ['job', 'Profesión'], ['food', 'Comida'], ['movie', 'Película / Serie']],
  },
  fr: {
    label: 'Français', locale: 'fr-FR', letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    categories: [['name', 'Prénom'], ['place', 'Lieu / Pays'], ['animal', 'Animal'], ['plant', 'Plante'], ['object', 'Objet'], ['job', 'Métier'], ['food', 'Nourriture'], ['movie', 'Film / Série']],
  },
  it: {
    label: 'Italiano', locale: 'it-IT', letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    categories: [['name', 'Nome'], ['place', 'Luogo / Paese'], ['animal', 'Animale'], ['plant', 'Pianta'], ['object', 'Oggetto'], ['job', 'Professione'], ['food', 'Cibo'], ['movie', 'Film / Serie']],
  },
};

const DEFAULT_CATEGORIES = ['name', 'place', 'animal', 'plant', 'object', 'job'];
const ACTIVITY_LIST = [
  { id: 'browser', name: 'Ortak Tarayıcı', icon: '🌐', color: '#3b82f6' },
  { id: 'wheel', name: 'Şans Çarkı', icon: '🎡', color: '#f59e0b' },
  { id: 'coin', name: 'Yazı Tura', icon: '🪙', color: '#10b981' },
  { id: 'namecity', name: 'İsim-Şehir', icon: '📝', color: '#22d3ee', featured: true },
];

const WHEEL_SEGMENTS = ['Kazan!', 'Pas', 'Tekrar At', 'Kaybettin', 'İpucu', 'Bonus'];

const nameStyle = (id, names, myId) => id === myId ? 'Sen' : names[id] || `Oyuncu ${String(id).slice(-4)}`;
const languageFor = (id) => LANGUAGES[id] || LANGUAGES.tr;
const categoryLabels = (languageId, categoryIds) => {
  const labels = new Map(languageFor(languageId).categories);
  return categoryIds.map((id) => ({ id, label: labels.get(id) || id }));
};

function normalizeAnswer(value, locale) {
  return String(value || '').trim().toLocaleLowerCase(locale).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function startsWithLetter(value, letter, locale) {
  const first = Array.from(String(value || '').trim())[0];
  return Boolean(first) && first.toLocaleUpperCase(locale) === letter;
}

function pickLetter(languageId) {
  const letters = languageFor(languageId).letters;
  return letters[Math.floor(Math.random() * letters.length)];
}

function challengeKey(playerId, categoryId) { return `${playerId}::${categoryId}`; }

function scoreRound(game) {
  if (!game) return {};
  const language = languageFor(game.languageId);
  const scores = Object.fromEntries(game.players.map((playerId) => [playerId, 0]));
  game.categoryIds.forEach((categoryId) => {
    const answers = game.players.map((playerId) => ({
      playerId,
      answer: game.submissions?.[playerId]?.answers?.[categoryId]?.trim() || '',
    })).filter((entry) => entry.answer);
    const eligible = answers.filter((entry) => {
      const challenge = game.challenges?.[challengeKey(entry.playerId, categoryId)];
      return (!challenge || challenge.accepted === true) && startsWithLetter(entry.answer, game.letter, language.locale);
    });
    const counts = eligible.reduce((result, entry) => {
      const key = normalizeAnswer(entry.answer, language.locale);
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
    eligible.forEach((entry) => {
      if (counts[normalizeAnswer(entry.answer, language.locale)] === 1) scores[entry.playerId] += 1;
    });
  });
  return scores;
}

function totalScores(game, includeCurrent) {
  const totals = Object.fromEntries((game?.players || []).map((playerId) => [playerId, 0]));
  (game?.roundResults || []).forEach((result) => Object.entries(result.scores || {}).forEach(([id, score]) => { totals[id] = (totals[id] || 0) + score; }));
  if (includeCurrent) Object.entries(scoreRound(game)).forEach(([id, score]) => { totals[id] = (totals[id] || 0) + score; });
  return totals;
}

function voteResult(challenge) {
  const entries = Object.entries(challenge.votes || {});
  let accepts = entries.filter(([, vote]) => vote).length;
  let rejects = entries.filter(([, vote]) => !vote).length;
  if (accepts === rejects && Object.prototype.hasOwnProperty.call(challenge.votes || {}, challenge.playerId)) {
    if (challenge.votes[challenge.playerId]) accepts -= 1;
    else rejects -= 1;
  }
  return { accepted: accepts > rejects, accepts, rejects };
}

function reduceGame(game, event) {
  if (!game || game.gameId !== event.gameId) return game;
  if (event.type === 'submit') {
    return { ...game, submissions: { ...game.submissions, [event.playerId]: event.submission }, names: { ...game.names, [event.playerId]: event.playerName } };
  }
  if (event.type === 'reveal') {
    if (game.phase !== 'writing') return game;
    const language = languageFor(game.languageId);
    const challenges = {};
    game.categoryIds.forEach((categoryId) => {
      const answers = game.players.map((playerId) => ({ playerId, answer: game.submissions?.[playerId]?.answers?.[categoryId]?.trim() || '' })).filter((entry) => entry.answer);
      const counts = answers.reduce((result, entry) => {
        const key = normalizeAnswer(entry.answer, language.locale);
        result[key] = (result[key] || 0) + 1;
        return result;
      }, {});
      answers.forEach(({ playerId, answer }) => {
        if (counts[normalizeAnswer(answer, language.locale)] > 1) return;
        const key = challengeKey(playerId, categoryId);
        challenges[key] = { key, playerId, categoryId, status: 'open', votes: {}, votingDeadlineAt: event.votingDeadlineAt };
      });
    });
    return { ...game, phase: 'review', challenges };
  }
  if (event.type === 'vote') {
    const challenge = game.challenges?.[event.key];
    if (!challenge || challenge.status !== 'open' || challenge.votes[event.playerId] !== undefined) return game;
    return { ...game, challenges: { ...game.challenges, [event.key]: { ...challenge, votes: { ...challenge.votes, [event.playerId]: event.accept } } } };
  }
  if (event.type === 'resolve') {
    const challenge = game.challenges?.[event.key];
    if (!challenge || challenge.status === 'resolved') return game;
    return { ...game, challenges: { ...game.challenges, [event.key]: { ...challenge, status: 'resolved', ...event } } };
  }
  if (event.type === 'next') return event.game;
  if (event.type === 'finish') return { ...game, phase: 'finished', roundResults: [...(game.roundResults || []), event.roundResult] };
  return game;
}

function NameCity({ myId, currentAccount, connectedPeers, onClose }) {
  const [setup, setSetup] = useState({ languageId: 'tr', rounds: 3, seconds: 90, categoryIds: DEFAULT_CATEGORIES });
  const [game, setGame] = useState(null);
  const [draft, setDraft] = useState({});
  const [names, setNames] = useState({ [myId]: currentAccount?.name || 'Oyuncu' });
  const [now, setNow] = useState(Date.now());
  const revealSent = useRef(null);
  const resolved = useRef(new Set());
  const players = useMemo(() => Array.from(new Set([myId, ...(connectedPeers || []).map((peer) => peer.id)])).sort(), [myId, connectedPeers]);
  const myName = currentAccount?.name || 'Oyuncu';

  const sendEvent = (event) => {
    setGame((previous) => reduceGame(previous, event));
    window.dispatchEvent(new CustomEvent('send-webrtc-game', { detail: { kind: 'namecity', ...event } }));
  };

  useEffect(() => {
    const receive = (event) => {
      const payload = event.detail;
      if (!payload || payload.kind !== 'namecity') return;
      if (payload.type === 'hello') {
        setNames((previous) => ({ ...previous, [payload.playerId]: payload.playerName }));
      } else if (payload.type === 'start') {
        setNames((previous) => ({ ...previous, ...(payload.game.names || {}) }));
        setGame(payload.game);
      } else {
        setGame((previous) => reduceGame(previous, payload));
      }
    };
    window.addEventListener('webrtc-game', receive);
    return () => window.removeEventListener('webrtc-game', receive);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('send-webrtc-game', { detail: { kind: 'namecity', type: 'hello', playerId: myId, playerName: myName } }));
  }, [myId, myName, connectedPeers?.length]);

  useEffect(() => {
    if (!game || !['writing', 'review'].includes(game.phase)) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [game?.gameId, game?.round, game?.phase]);

  useEffect(() => {
    if (!game || game.phase !== 'writing') return undefined;
    const allFinished = game.players.every((playerId) => game.submissions?.[playerId]);
    const expired = Date.now() >= game.deadlineAt;
    const roundKey = `${game.gameId}:${game.round}`;
    if ((allFinished || expired) && revealSent.current !== roundKey) {
      revealSent.current = roundKey;
      if (!game.submissions?.[myId]) lockAnswers();
      sendEvent({ type: 'reveal', gameId: game.gameId, votingDeadlineAt: Date.now() + 30000 });
    }
    return undefined;
  }, [game, now]);

  useEffect(() => {
    if (!game || game.phase !== 'review') return undefined;
    Object.values(game.challenges || {}).forEach((challenge) => {
      if (challenge.status !== 'open') return;
      if (Object.keys(challenge.votes || {}).length < game.players.length && Date.now() < challenge.votingDeadlineAt) return;
      if (resolved.current.has(challenge.key)) return;
      resolved.current.add(challenge.key);
      sendEvent({ type: 'resolve', gameId: game.gameId, key: challenge.key, ...voteResult(challenge) });
    });
    return undefined;
  }, [game, now]);

  const lockAnswers = () => {
    if (!game || game.phase !== 'writing' || game.submissions?.[myId]) return;
    const answers = Object.fromEntries(game.categoryIds.map((id) => [id, draft[id] || '']));
    sendEvent({ type: 'submit', gameId: game.gameId, playerId: myId, playerName: myName, submission: { answers, submittedAt: Date.now() } });
  };

  const startGame = () => {
    if (players.length < 2) return;
    const startedAt = Date.now();
    const newGame = {
      gameId: `${myId}-${startedAt}`, startedBy: myId, languageId: setup.languageId, categoryIds: setup.categoryIds,
      totalRounds: setup.rounds, secondsPerRound: setup.seconds, round: 1, letter: pickLetter(setup.languageId),
      phase: 'writing', deadlineAt: startedAt + setup.seconds * 1000, players, names: { ...names, [myId]: myName }, submissions: {}, challenges: {}, roundResults: [],
    };
    setGame(newGame);
    window.dispatchEvent(new CustomEvent('send-webrtc-game', { detail: { kind: 'namecity', type: 'start', game: newGame } }));
  };

  const castVote = (key, accept) => {
    const challenge = game?.challenges?.[key];
    if (!challenge || challenge.status !== 'open' || challenge.votes[myId] !== undefined) return;
    sendEvent({ type: 'vote', gameId: game.gameId, key, playerId: myId, accept });
  };

  const nextRound = () => {
    if (!game || game.startedBy !== myId || game.phase !== 'review') return;
    if (Object.values(game.challenges || {}).some((challenge) => challenge.status !== 'resolved')) return;
    const result = { round: game.round, scores: scoreRound(game) };
    if (game.round >= game.totalRounds) {
      sendEvent({ type: 'finish', gameId: game.gameId, roundResult: result });
      return;
    }
    const next = { ...game, round: game.round + 1, letter: pickLetter(game.languageId), phase: 'writing', deadlineAt: Date.now() + game.secondsPerRound * 1000, submissions: {}, challenges: {}, roundResults: [...game.roundResults, result] };
    revealSent.current = null;
    resolved.current = new Set();
    setDraft({});
    sendEvent({ type: 'next', gameId: game.gameId, game: next });
  };

  const page = { position: 'absolute', inset: 0, zIndex: 100, background: 'rgba(15,23,42,0.98)', padding: 24, color: '#f8fafc', display: 'flex', flexDirection: 'column', overflow: 'auto' };
  const button = (color = '#3b82f6') => ({ border: 0, borderRadius: 9, padding: '10px 16px', background: color, color: 'white', fontWeight: 700, cursor: 'pointer' });
  const input = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', background: '#0f172a', color: 'white', border: '1px solid #475569', borderRadius: 8, outline: 'none' };
  const panel = { background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 20 };

  if (!game) {
    const language = languageFor(setup.languageId);
    return (
      <div style={page}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <button style={button('#334155')} onClick={onClose}>← Odadan Çık</button>
          <div><h2 style={{ margin: 0 }}>📝 İsim-Şehir <span style={{ color: '#22d3ee', fontSize: 12 }}>YENİ</span></h2><p style={{ margin: '5px 0 0', color: '#94a3b8' }}>Her benzersiz cevap oda oylamasıyla değerlendirilir.</p></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(260px,.6fr)', gap: 18, maxWidth: 1000, width: '100%', margin: '0 auto' }}>
          <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label>Dil<select style={{ ...input, marginTop: 6 }} value={setup.languageId} onChange={(e) => setSetup((old) => ({ ...old, languageId: e.target.value, categoryIds: DEFAULT_CATEGORIES }))}>{Object.entries(LANGUAGES).map(([id, config]) => <option key={id} value={id}>{config.label}</option>)}</select></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label>Tur sayısı<select style={{ ...input, marginTop: 6 }} value={setup.rounds} onChange={(e) => setSetup((old) => ({ ...old, rounds: Number(e.target.value) }))}>{[1, 3, 5].map((n) => <option key={n} value={n}>{n} tur</option>)}</select></label>
              <label>Süre<select style={{ ...input, marginTop: 6 }} value={setup.seconds} onChange={(e) => setSetup((old) => ({ ...old, seconds: Number(e.target.value) }))}>{[60, 90, 120, 180].map((n) => <option key={n} value={n}>{n} saniye</option>)}</select></label>
            </div>
            <div><strong>Kategoriler <small style={{ color: '#94a3b8' }}>(en az 3)</small></strong><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginTop: 8 }}>{language.categories.map(([id, label]) => { const active = setup.categoryIds.includes(id); return <label key={id} style={{ padding: 9, borderRadius: 8, border: `1px solid ${active ? '#22d3ee' : '#475569'}`, background: active ? 'rgba(34,211,238,.12)' : 'transparent', color: active ? 'white' : '#94a3b8' }}><input type="checkbox" checked={active} onChange={() => setSetup((old) => ({ ...old, categoryIds: active ? old.categoryIds.filter((item) => item !== id) : [...old.categoryIds, id] }))} /> {label}</label>; })}</div></div>
          <p style={{ color: '#94a3b8', fontSize: 12, margin: 0 }}>Minimum 2 oyuncu · Önerilen 3+ oyuncu · Odada {players.length} oyuncu hazır.</p><button style={{ ...button('#0891b2'), opacity: setup.categoryIds.length < 3 || players.length < 2 ? .5 : 1 }} disabled={setup.categoryIds.length < 3 || players.length < 2} onClick={startGame}>{players.length < 2 ? 'En az 2 oyuncu gerekli' : 'Oyunu Başlat'}</button>
          </div>
          <div style={panel}><h3 style={{ marginTop: 0 }}>Oyun kuralları</h3><ol style={{ color: '#cbd5e1', lineHeight: 1.7, paddingLeft: 20 }}><li>Aynı harfle kategorileri doldur.</li><li>Süre bitince cevaplar açılır.</li><li>Her benzersiz cevap için Kabul / Ret oyu verilir.</li><li>Aynı cevaplar puan alamaz.</li><li>Eşitlikte cevap sahibinin oyu sayılmaz.</li></ol><p style={{ color: '#22d3ee', fontSize: 12 }}>Minimum 2, önerilen 3+ oyuncu.</p></div>
        </div>
      </div>
    );
  }

  const language = languageFor(game.languageId);
  const categories = categoryLabels(game.languageId, game.categoryIds);
  const secondsLeft = game.phase === 'writing' ? Math.max(0, Math.ceil((game.deadlineAt - now) / 1000)) : 0;
  const totals = totalScores(game, game.phase === 'review');
  const scores = scoreRound(game);
  const allResolved = Object.values(game.challenges || {}).every((challenge) => challenge.status === 'resolved');
  const ranking = [...game.players].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));

  if (game.phase === 'finished') return <div style={{ ...page, alignItems: 'center' }}><div style={{ ...panel, width: 'min(100%, 500px)' }}><button style={button('#334155')} onClick={onClose}>← Odadan Çık</button><h2>Oyun Bitti 🏆</h2>{ranking.map((id, index) => <div key={id} style={{ display: 'flex', gap: 12, padding: 12, marginTop: 7, borderRadius: 8, background: index === 0 ? 'rgba(34,211,238,.12)' : 'rgba(255,255,255,.05)' }}><span>{index + 1}.</span><span style={{ flex: 1 }}>{nameStyle(id, { ...names, ...game.names }, myId)}</span><strong>{totals[id] || 0}</strong></div>)}<button style={{ ...button('#0891b2'), marginTop: 18 }} onClick={() => { setGame(null); setDraft({}); }}>Yeni Oyun</button></div></div>;

  return (
    <div style={page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}><button style={button('#334155')} onClick={onClose}>← Odadan Çık</button><div style={{ flex: 1 }}><h2 style={{ margin: 0 }}>📝 İsim-Şehir</h2><small style={{ color: '#94a3b8' }}>{language.label} · Tur {game.round}/{game.totalRounds}</small></div><span style={{ padding: '8px 12px', borderRadius: 18, background: secondsLeft <= 10 && game.phase === 'writing' ? '#7f1d1d' : '#164e63' }}>{game.phase === 'writing' ? `⏱ ${secondsLeft}s` : 'Cevap oylaması'}</span></div>
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 16, maxWidth: 1000, width: '100%', margin: '0 auto 16px', boxSizing: 'border-box' }}><span style={{ color: '#94a3b8' }}>Tur harfi</span><strong style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', background: 'rgba(34,211,238,.13)', color: '#22d3ee', borderRadius: 10, fontSize: 26 }}>{game.letter}</strong><span style={{ color: '#94a3b8', fontSize: 12 }}>{game.phase === 'writing' ? 'Cevaplarını süre bitmeden kilitle.' : 'Her benzersiz cevap için oy ver.'}</span></div>

      {game.phase === 'writing' && <div style={{ ...panel, maxWidth: 1000, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>{categories.map(({ id, label }) => { const value = draft[id] || ''; const wrong = value && !startsWithLetter(value, game.letter, language.locale); return <label key={id} style={{ color: '#cbd5e1', fontSize: 12 }}>{label}<input style={{ ...input, marginTop: 6 }} disabled={Boolean(game.submissions?.[myId])} value={value} onChange={(e) => setDraft((old) => ({ ...old, [id]: e.target.value }))} placeholder={`${game.letter}...`} />{wrong && <small style={{ color: '#fbbf24' }}> Harf kuralına uymuyor.</small>}</label>; })}</div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 18, paddingTop: 14, borderTop: '1px solid #334155' }}><div style={{ color: '#94a3b8', fontSize: 12 }}>{game.players.map((id) => <span key={id} style={{ marginRight: 10, color: game.submissions?.[id] ? '#34d399' : '#94a3b8' }}>{game.submissions?.[id] ? '✓' : '○'} {nameStyle(id, { ...names, ...game.names }, myId)}</span>)}</div><button style={button('#0891b2')} disabled={Boolean(game.submissions?.[myId])} onClick={lockAnswers}>{game.submissions?.[myId] ? 'Cevaplar kilitlendi' : 'Cevapları Kilitle'}</button></div></div>}

      {game.phase === 'review' && <div style={{ ...panel, maxWidth: 1100, width: '100%', margin: '0 auto', boxSizing: 'border-box', overflow: 'auto' }}><p style={{ color: '#cbd5e1', marginTop: 0 }}>Her benzersiz cevap için Kabul veya Ret seçin. Aynı cevaplar otomatik 0 puandır.</p><table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{['Oyuncu', ...categories.map((category) => category.label), 'Tur'].map((label) => <th key={label} style={{ textAlign: 'left', padding: 9, color: '#94a3b8', borderBottom: '1px solid #334155' }}>{label}</th>)}</tr></thead><tbody>{game.players.map((playerId) => <tr key={playerId}><th style={{ textAlign: 'left', padding: 9, borderBottom: '1px solid #1e293b' }}>{nameStyle(playerId, { ...names, ...game.names }, myId)}</th>{categories.map(({ id }) => { const answer = game.submissions?.[playerId]?.answers?.[id]?.trim() || ''; const key = challengeKey(playerId, id); const challenge = game.challenges?.[key]; const duplicate = answer && game.players.filter((other) => normalizeAnswer(game.submissions?.[other]?.answers?.[id] || '', language.locale) === normalizeAnswer(answer, language.locale)).length > 1; return <td key={id} style={{ padding: 9, verticalAlign: 'top', borderBottom: '1px solid #1e293b' }}><div>{answer || '—'}</div>{duplicate && answer && <small style={{ color: '#94a3b8' }}>Tekrarlı · 0</small>}{answer && !duplicate && challenge?.status === 'open' && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}><button style={{ ...button('#047857'), padding: '5px 7px', fontSize: 10 }} disabled={challenge.votes[myId] !== undefined} onClick={() => castVote(key, true)}>✓ Kabul</button><button style={{ ...button('#991b1b'), padding: '5px 7px', fontSize: 10 }} disabled={challenge.votes[myId] !== undefined} onClick={() => castVote(key, false)}>✕ Ret</button><small style={{ width: '100%', color: '#94a3b8' }}>{Object.values(challenge.votes).filter(Boolean).length} / {game.players.length} kabul</small></div>}{answer && challenge?.status === 'resolved' && <small style={{ color: challenge.accepted ? '#34d399' : '#f87171' }}>{challenge.accepted ? 'Oylamayla kabul' : 'Oylamayla reddedildi'}</small>}</td>; })}<td style={{ padding: 9, borderBottom: '1px solid #1e293b' }}><strong>{scores[playerId] || 0}</strong></td></tr>)}</tbody></table><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 18, color: '#94a3b8', fontSize: 12 }}><span>Toplam: {ranking.map((id) => `${nameStyle(id, { ...names, ...game.names }, myId)} ${totals[id] || 0}`).join(' · ')}</span>{game.startedBy === myId ? <button style={button('#0891b2')} disabled={!allResolved} onClick={nextRound}>{game.round >= game.totalRounds ? 'Oyunu Bitir' : 'Sonraki Tur'}</button> : <span>Oyunu başlatan kişinin sonraki turu açması bekleniyor.</span>}</div></div>}
    </div>
  );
}

export default function Activities({ onClose, myId, targetId, isHost, connectedPeers, currentAccount }) {
  const [activeActivity, setActiveActivity] = useState(null);
  const [coinFlipping, setCoinFlipping] = useState(false);
  const [coinResult, setCoinResult] = useState(null);
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [wheelWinner, setWheelWinner] = useState(null);

  const renderActivityContent = () => {
    if (activeActivity === 'namecity') return <NameCity myId={myId} currentAccount={currentAccount} connectedPeers={connectedPeers} onClose={() => setActiveActivity(null)} />;
    if (activeActivity === 'browser') return <iframe src="https://duckduckgo.com" style={{ width: '100%', height: '100%', border: 0, borderRadius: 8 }} title="Ortak Tarayıcı" />;
    if (activeActivity === 'coin') return <div style={centerStyle}><div style={{ ...coinStyle, transform: coinFlipping ? 'rotateY(720deg)' : 'none' }}>{coinFlipping ? '?' : (coinResult || '🪙')}</div><button style={bigButton('#10b981')} disabled={coinFlipping} onClick={() => { setCoinFlipping(true); setCoinResult(null); setTimeout(() => { setCoinResult(Math.random() < .5 ? 'YAZI' : 'TURA'); setCoinFlipping(false); }, 900); }}>{coinFlipping ? 'Atılıyor...' : 'Parayı At'}</button></div>;
    if (activeActivity === 'wheel') return <div style={centerStyle}><div style={{ ...wheelStyle, transform: wheelSpinning ? 'rotate(720deg)' : 'none' }}>{wheelWinner || '🎡'}</div><button style={bigButton('#8b5cf6')} disabled={wheelSpinning} onClick={() => { setWheelSpinning(true); setWheelWinner(null); setTimeout(() => { setWheelWinner(WHEEL_SEGMENTS[Math.floor(Math.random() * WHEEL_SEGMENTS.length)]); setWheelSpinning(false); }, 1100); }}>{wheelSpinning ? 'Dönüyor...' : 'Çevir'}</button></div>;
    return null;
  };

  return <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.97)', zIndex: 100, display: 'flex', flexDirection: 'column', padding: 20, color: 'white' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}><h2 style={{ margin: 0 }}>{activeActivity ? <><button style={headerButton} onClick={() => setActiveActivity(null)}>←</button> {ACTIVITY_LIST.find((a) => a.id === activeActivity)?.name}</> : '🎯 Etkinlikler'}</h2><button style={closeButton} onClick={onClose}>×</button></div>
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: activeActivity ? 'stretch' : 'center' }}>{activeActivity ? renderActivityContent() : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 18, width: '100%', maxWidth: 900 }}>{ACTIVITY_LIST.map((activity) => <button key={activity.id} onClick={() => setActiveActivity(activity.id)} style={{ ...activityCard, borderColor: activity.featured ? activity.color : 'rgba(255,255,255,.12)', background: activity.featured ? 'linear-gradient(145deg,rgba(34,211,238,.14),rgba(99,102,241,.14))' : 'rgba(255,255,255,.05)' }}><span style={{ ...activityIcon, background: `${activity.color}22`, color: activity.color }}>{activity.icon}</span><span style={{ fontWeight: 700, fontSize: 17 }}>{activity.name} {activity.featured && <small style={{ color: activity.color, fontSize: 10 }}>YENİ</small>}</span>{activity.featured && <span style={{ color: '#94a3b8', fontSize: 12 }}>Cevapları oylayarak puan topla</span>}</button>)}</div>}</div>
  </div>;
}

const activityCard = { border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: '28px 20px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'white', transition: 'transform .2s, background .2s' };
const activityIcon = { fontSize: 44, width: 78, height: 78, borderRadius: '50%', display: 'grid', placeItems: 'center' };
const headerButton = { background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', fontSize: 22 };
const closeButton = { background: 'rgba(239,68,68,.2)', border: 0, color: '#ef4444', width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', fontSize: 20 };
const centerStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, width: '100%' };
const coinStyle = { width: 150, height: 150, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#fcd34d,#d97706)', color: '#78350f', fontSize: 34, fontWeight: 800, transition: 'transform .9s' };
const wheelStyle = { width: 190, height: 190, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#8b5cf6,#ec4899)', fontSize: 24, fontWeight: 800, transition: 'transform 1.1s' };
const bigButton = (background) => ({ padding: '12px 32px', fontSize: 17, fontWeight: 700, background, color: 'white', border: 0, borderRadius: 8, cursor: 'pointer' });
