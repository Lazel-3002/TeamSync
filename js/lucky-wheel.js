function initLuckyWheel() {
  const broadcastActivityMsg = (msg) => {
    broadcast(msg);
  };

  // openCardFocused: kartı açar + odaklanabilir yapar + odağa alır (renderer.js).
  // Eskiden burada yalnızca hidden kaldırılıyordu; bu yüzden anket/film/çark
  // kartlarında odak, kilit ve tam ekran hiç çalışmıyordu.
  const openWheelActivityCard = (act) => {
    if (act === 'poll') openCardFocused('poll-card');
    if (act === 'lvs') openCardFocused('lvs-card');
    if (act === 'wheel') openCardFocused('wheel-card');
  };

  const setActivity = (act) => {
    closeAllCards();
    document.getElementById('activities-modal').classList.add('hidden');
    broadcast({ type: 'activity_change', activity: act });
    openWheelActivityCard(act);
  };

  const handleActClick = (act) => {
    if (state.activeLobbyId && !state.isLobbyHost) {
      closeAllCards();
      document.getElementById('activities-modal').classList.add('hidden');
      openWheelActivityCard(act);
      return;
    }
    setActivity(act);
  };

  document.getElementById('act-poll')?.addEventListener('click', () => handleActClick('poll'));
  document.getElementById('act-lvs')?.addEventListener('click', () => handleActClick('lvs'));
  document.getElementById('act-wheel')?.addEventListener('click', () => handleActClick('wheel'));

  const closeActivity = () => {
    closeAllCards(true);
    broadcast({ type: 'activity_change', activity: 'none' });
  };

  document.getElementById('poll-close')?.addEventListener('click', closeActivity);
  document.getElementById('lvs-close')?.addEventListener('click', closeActivity);
  document.getElementById('wheel-close')?.addEventListener('click', closeActivity);

  const POLL_MAX_OPTIONS = 6;
  const POLL_COLORS = ['#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#f97316'];
  const pollEls = {
    setup: document.getElementById('poll-setup'),
    view: document.getElementById('poll-view'),
    question: document.getElementById('poll-q'),
    questionCount: document.getElementById('poll-question-count'),
    editor: document.getElementById('poll-options-editor'),
    optionCount: document.getElementById('poll-option-count'),
    addOption: document.getElementById('poll-add-option'),
    create: document.getElementById('poll-create'),
    allowChange: document.getElementById('poll-allow-change'),
    setupError: document.getElementById('poll-setup-error'),
    previewState: document.getElementById('poll-preview-state'),
    previewQuestion: document.getElementById('poll-preview-question'),
    previewOptions: document.getElementById('poll-preview-options'),
    viewQuestion: document.getElementById('poll-view-q'),
    options: document.getElementById('poll-opts-container'),
    totalVotes: document.getElementById('poll-total-votes'),
    participation: document.getElementById('poll-participation'),
    donut: document.getElementById('poll-donut'),
    donutTotal: document.getElementById('poll-donut-total'),
    leaderIcon: document.getElementById('poll-leader-icon'),
    leaderText: document.getElementById('poll-leader-text'),
    liveBadge: document.getElementById('poll-live-badge'),
    voteHint: document.getElementById('poll-vote-hint'),
    changeNote: document.getElementById('poll-change-note'),
    finishedBanner: document.getElementById('poll-finished-banner'),
    end: document.getElementById('poll-end'),
    newPoll: document.getElementById('poll-new')
  };

  let pollState = null;
  const localPollVoterId = () => state?.myId || 'local-poll-voter';
  const sanitizePollText = (value, maxLength) => String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

  const setPollState = nextState => {
    pollState = nextState;
    window.pollState = pollState;
  };
  setPollState(null);

  const pollEditorRows = () => Array.from(pollEls.editor.querySelectorAll('.poll-option-editor'));
  const pollEditorOptions = () => pollEditorRows()
    .map(row => sanitizePollText(row.querySelector('input').value, 56))
    .filter(Boolean);

  const makePollOptionEditor = (value = '') => {
    const row = document.createElement('label');
    row.className = 'poll-option-editor';

    const letter = document.createElement('i');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 56;
    input.autocomplete = 'off';
    input.value = sanitizePollText(value, 56);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'poll-remove-option';
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 7 10 10M17 7 7 17"></path></svg>';
    remove.addEventListener('click', event => {
      event.preventDefault();
      if (pollEditorRows().length <= 2) return;
      row.remove();
      refreshPollEditor();
    });
    input.addEventListener('input', refreshPollEditor);
    row.append(letter, input, remove);
    return row;
  };

  const reindexPollEditors = () => {
    const rows = pollEditorRows();
    rows.forEach((row, index) => {
      const input = row.querySelector('input');
      const letter = row.querySelector('i');
      const remove = row.querySelector('button');
      const label = String.fromCharCode(65 + index);
      input.id = `poll-opt${index + 1}`;
      input.placeholder = index < 2
        ? `${index + 1}. zorunlu seçenek`
        : `${index + 1}. seçenek (isteğe bağlı)`;
      row.htmlFor = input.id;
      letter.textContent = label;
      letter.style.setProperty('--poll-color', POLL_COLORS[index]);
      remove.disabled = rows.length <= 2;
      remove.setAttribute('aria-label', `${label} seçeneğini kaldır`);
    });
    pollEls.optionCount.textContent = `${rows.length} / ${POLL_MAX_OPTIONS}`;
    pollEls.addOption.disabled = rows.length >= POLL_MAX_OPTIONS;
  };

  const renderPollPreview = () => {
    const question = sanitizePollText(pollEls.question.value, 120);
    const options = pollEditorOptions();
    pollEls.previewQuestion.textContent = question || 'Sence en iyi seçenek hangisi?';
    pollEls.previewState.textContent = question
      ? `${Math.max(options.length, 2)} seçenekli anket`
      : 'Sorunu yazmaya başla';
    pollEls.previewOptions.replaceChildren();
    const shownOptions = options.length ? options : ['İlk seçenek', 'İkinci seçenek'];
    shownOptions.slice(0, 4).forEach((option, index) => {
      const row = document.createElement('div');
      const letter = document.createElement('i');
      letter.style.setProperty('--poll-color', POLL_COLORS[index]);
      letter.textContent = String.fromCharCode(65 + index);
      const label = document.createElement('span');
      label.textContent = option;
      row.append(letter, label);
      pollEls.previewOptions.appendChild(row);
    });
  };

  const validatePollBuilder = (showError = false) => {
    const question = sanitizePollText(pollEls.question.value, 120);
    const options = pollEditorOptions();
    const uniqueOptions = new Set(options.map(option => option.toLocaleLowerCase('tr-TR')));
    let message = '';
    if (!question) message = 'Anket sorusunu yazmalısın.';
    else if (options.length < 2) message = 'En az iki dolu seçenek gerekli.';
    else if (uniqueOptions.size !== options.length) message = 'Seçeneklerin birbirinden farklı olmalı.';
    pollEls.create.disabled = Boolean(message);
    pollEls.setupError.textContent = showError ? message : '';
    return message ? null : { question, options };
  };

  const refreshPollEditor = () => {
    reindexPollEditors();
    pollEls.questionCount.textContent = `${pollEls.question.value.length} / 120`;
    renderPollPreview();
    validatePollBuilder(false);
  };

  const replacePollEditorOptions = options => {
    pollEls.editor.replaceChildren();
    const normalized = (Array.isArray(options) ? options : [])
      .map(option => sanitizePollText(option, 56))
      .filter(Boolean)
      .slice(0, POLL_MAX_OPTIONS);
    while (normalized.length < 2) normalized.push('');
    normalized.forEach(option => pollEls.editor.appendChild(makePollOptionEditor(option)));
    refreshPollEditor();
  };

  pollEditorRows().forEach(row => {
    const input = row.querySelector('input');
    input.addEventListener('input', refreshPollEditor);
    row.querySelector('.poll-remove-option').addEventListener('click', event => {
      event.preventDefault();
      if (pollEditorRows().length <= 2) return;
      row.remove();
      refreshPollEditor();
    });
  });
  pollEls.question?.addEventListener('input', refreshPollEditor);
  pollEls.question?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      pollEditorRows()[0]?.querySelector('input').focus();
    }
  });
  pollEls.addOption?.addEventListener('click', () => {
    if (pollEditorRows().length >= POLL_MAX_OPTIONS) return;
    const row = makePollOptionEditor();
    pollEls.editor.appendChild(row);
    refreshPollEditor();
    row.querySelector('input').focus();
  });
  document.querySelectorAll('.poll-template').forEach(button => {
    button.addEventListener('click', () => {
      pollEls.question.value = sanitizePollText(button.dataset.question, 120);
      replacePollEditorOptions(button.dataset.options.split('|'));
      pollEls.question.focus();
      pollEls.question.setSelectionRange(pollEls.question.value.length, pollEls.question.value.length);
    });
  });

  const getPollCounts = () => {
    if (!pollState) return [];
    const counts = pollState.legacyVotes.slice();
    Object.values(pollState.voters).forEach(choiceIndex => {
      if (Number.isInteger(choiceIndex) && choiceIndex >= 0 && choiceIndex < counts.length) {
        counts[choiceIndex] += 1;
      }
    });
    return counts;
  };

  const syncPollHostControls = () => {
    const canManage = Boolean(pollState?.isHost) && !state?.spectating;
    pollEls.end.classList.toggle('hidden', !canManage || pollState?.ended);
    pollEls.newPoll.classList.toggle('hidden', !canManage || !pollState?.ended);
  };
  window.syncPollHostControls = syncPollHostControls;

  const renderPoll = () => {
    if (!pollState) return;
    const counts = getPollCounts();
    const total = counts.reduce((sum, count) => sum + count, 0);
    const localChoice = pollState.voters[localPollVoterId()];
    pollState.myVote = Number.isInteger(localChoice) ? localChoice : null;

    pollEls.viewQuestion.textContent = pollState.question;
    pollEls.totalVotes.textContent = `${total} oy`;
    pollEls.donutTotal.textContent = String(total);
    pollEls.participation.textContent = total
      ? `${total} katılımcı`
      : 'Henüz oy yok';
    pollEls.liveBadge.classList.toggle('is-ended', pollState.ended);
    pollEls.liveBadge.lastChild.textContent = pollState.ended ? ' OYLAMA BİTTİ' : ' OYLAMA AÇIK';
    pollEls.finishedBanner.classList.toggle('hidden', !pollState.ended);
    pollEls.voteHint.textContent = pollState.ended
      ? 'Kesin sonuçlar'
      : pollState.myVote === null
        ? 'Bir seçeneğe dokunarak oy ver'
        : pollState.allowChange
          ? 'Oyunu değiştirebilirsin'
          : 'Oyun kaydedildi';
    pollEls.changeNote.textContent = pollState.ended
      ? 'Bu anketin kesin sonuçları gösteriliyor.'
      : pollState.allowChange
        ? 'Oyunu sonuçlanana kadar değiştirebilirsin.'
        : 'Her katılımcının tek oy hakkı var.';

    pollEls.options.replaceChildren();
    pollState.options.forEach((option, index) => {
      const count = counts[index] || 0;
      const percent = total ? Math.round(count / total * 100) : 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `poll-opt${pollState.myVote === index ? ' voted' : ''}`;
      button.style.setProperty('--poll-option-color', POLL_COLORS[index]);
      button.style.setProperty('--poll-percent', `${percent}%`);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(pollState.myVote === index));
      button.disabled = pollState.ended || (!pollState.allowChange && pollState.myVote !== null);

      const bar = document.createElement('span');
      bar.className = 'poll-bar';
      const letter = document.createElement('span');
      letter.className = 'poll-opt-letter';
      letter.textContent = String.fromCharCode(65 + index);
      const copy = document.createElement('span');
      copy.className = 'poll-opt-copy';
      const label = document.createElement('strong');
      label.textContent = option;
      const detail = document.createElement('small');
      detail.textContent = pollState.myVote === index ? '✓ Senin oyun' : `${count} oy`;
      copy.append(label, detail);
      const metric = document.createElement('span');
      metric.className = 'poll-opt-metric';
      const metricValue = document.createElement('strong');
      metricValue.textContent = String(percent);
      const metricUnit = document.createElement('span');
      metricUnit.textContent = '%';
      const check = document.createElement('span');
      check.className = 'poll-check';
      check.textContent = '✓';
      metric.append(metricValue, metricUnit, check);
      button.append(bar, letter, copy, metric);
      button.addEventListener('click', () => castPollVote(index));
      pollEls.options.appendChild(button);
    });

    if (!total) {
      pollEls.donut.style.background = 'conic-gradient(#302b3b 0 100%)';
      pollEls.leaderIcon.textContent = '–';
      pollEls.leaderIcon.style.background = '#302a3c';
      pollEls.leaderText.textContent = 'Sonuç bekleniyor';
    } else {
      let cursor = 0;
      const segments = counts.map((count, index) => {
        const start = cursor;
        cursor += count / total * 100;
        return `${POLL_COLORS[index]} ${start}% ${cursor}%`;
      }).join(', ');
      pollEls.donut.style.background = `conic-gradient(${segments})`;
      const highest = Math.max(...counts);
      const leaders = counts
        .map((count, index) => count === highest ? index : -1)
        .filter(index => index >= 0);
      const firstLeader = leaders[0];
      pollEls.leaderIcon.textContent = leaders.length > 1 ? '=' : String.fromCharCode(65 + firstLeader);
      pollEls.leaderIcon.style.background = leaders.length > 1 ? '#51485e' : POLL_COLORS[firstLeader];
      pollEls.leaderText.textContent = leaders.length > 1
        ? `${leaders.length} seçenek berabere`
        : pollState.options[firstLeader];
    }
    syncPollHostControls();
  };

  const handlePollStart = (data, isHost = false) => {
    const question = sanitizePollText(data.question ?? data.q, 120);
    const options = (Array.isArray(data.options) ? data.options : data.opts)
      ?.map(option => sanitizePollText(option, 56))
      .filter(Boolean)
      .slice(0, POLL_MAX_OPTIONS) || [];
    if (!question || options.length < 2) return;
    const voters = {};
    if (data.voters && typeof data.voters === 'object') {
      Object.entries(data.voters).forEach(([voterId, choiceIndex]) => {
        const choice = Number(choiceIndex);
        if (Number.isInteger(choice) && choice >= 0 && choice < options.length) voters[voterId] = choice;
      });
    }
    setPollState({
      id: data.id || `poll-${Date.now()}`,
      question,
      options,
      allowChange: data.allowChange !== false,
      voters,
      legacyVotes: Array(options.length).fill(0),
      myVote: null,
      ended: Boolean(data.ended),
      isHost
    });
    pollEls.setup.classList.add('hidden');
    pollEls.view.classList.remove('hidden');
    renderPoll();
  };

  const applyPollVote = data => {
    if (!pollState || pollState.ended || data.pollId !== pollState.id) return;
    const choiceIndex = Number.isInteger(data.choiceIndex)
      ? data.choiceIndex
      : pollState.options.indexOf(data.opt);
    if (choiceIndex < 0 || choiceIndex >= pollState.options.length) return;
    if (data.voterId) {
      const previous = pollState.voters[data.voterId];
      if (!pollState.allowChange && Number.isInteger(previous)) return;
      pollState.voters[data.voterId] = choiceIndex;
    } else {
      const oldIndex = pollState.options.indexOf(data.old);
      pollState.legacyVotes[choiceIndex] += 1;
      if (oldIndex >= 0 && pollState.legacyVotes[oldIndex] > 0) {
        pollState.legacyVotes[oldIndex] -= 1;
      }
    }
    renderPoll();
  };

  const castPollVote = choiceIndex => {
    if (!pollState || pollState.ended) return;
    const voterId = localPollVoterId();
    if (!pollState.allowChange && Number.isInteger(pollState.voters[voterId])) return;
    if (pollState.voters[voterId] === choiceIndex) return;
    const payload = {
      type: 'poll_vote',
      pollId: pollState.id,
      voterId,
      choiceIndex,
      opt: pollState.options[choiceIndex],
      old: Number.isInteger(pollState.voters[voterId])
        ? pollState.options[pollState.voters[voterId]]
        : null
    };
    applyPollVote(payload);
    broadcastActivityMsg(payload);
  };

  pollEls.create?.addEventListener('click', () => {
    const values = validatePollBuilder(true);
    if (!values) return;
    const payload = {
      type: 'poll_start',
      id: `poll-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      question: values.question,
      q: values.question,
      options: values.options,
      opts: values.options,
      allowChange: pollEls.allowChange.checked,
      hostId: state?.myId || null
    };
    broadcastActivityMsg(payload);
    handlePollStart(payload, true);
  });

  const handlePollEnd = data => {
    if (!pollState || (data.pollId && data.pollId !== pollState.id)) return;
    if (data.voters && typeof data.voters === 'object') {
      Object.entries(data.voters).forEach(([voterId, choiceIndex]) => {
        const choice = Number(choiceIndex);
        if (Number.isInteger(choice) && choice >= 0 && choice < pollState.options.length) {
          pollState.voters[voterId] = choice;
        }
      });
    }
    pollState.ended = true;
    renderPoll();
  };

  pollEls.end?.addEventListener('click', () => {
    if (!pollState || pollState.ended || !pollState.isHost) return;
    const payload = {
      type: 'poll_end',
      pollId: pollState.id,
      voters: { ...pollState.voters }
    };
    broadcastActivityMsg(payload);
    handlePollEnd(payload);
  });

  const resetPoll = (clearBuilder = true) => {
    setPollState(null);
    pollEls.view.classList.add('hidden');
    pollEls.setup.classList.remove('hidden');
    if (clearBuilder) {
      pollEls.question.value = '';
      replacePollEditorOptions(['', '', '', '']);
      pollEls.allowChange.checked = true;
    }
    pollEls.setupError.textContent = '';
    refreshPollEditor();
  };

  pollEls.newPoll?.addEventListener('click', () => {
    if (!pollState?.isHost) return;
    broadcastActivityMsg({ type: 'poll_reset', pollId: pollState.id });
    resetPoll(true);
  });

  refreshPollEditor();

  const lvsPlayer = document.getElementById('lvs-player');
  let lvsSyncing = false;
  
  document.getElementById('lvs-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(file) {
      const url = URL.createObjectURL(file);
      lvsPlayer.src = url;
      document.getElementById('lvs-empty').style.display = 'none';
      lvsPlayer.style.display = 'block';
    }
  });
  
  const sendLvsSync = (evType) => {
    if(lvsSyncing) return;
    broadcastActivityMsg({
      type: 'lvs_sync',
      ev: evType,
      time: lvsPlayer.currentTime,
      paused: lvsPlayer.paused
    });
  };
  
  lvsPlayer.addEventListener('play', () => sendLvsSync('play'));
  lvsPlayer.addEventListener('pause', () => sendLvsSync('pause'));
  lvsPlayer.addEventListener('seeked', () => sendLvsSync('seeked'));

  const handleLvsSync = (data) => {
    lvsSyncing = true;
    if(Math.abs(lvsPlayer.currentTime - data.time) > 1) {
      lvsPlayer.currentTime = data.time;
    }
    if(data.ev === 'play' && lvsPlayer.paused) lvsPlayer.play().catch(()=>{});
    if(data.ev === 'pause' && !lvsPlayer.paused) lvsPlayer.pause();
    setTimeout(() => lvsSyncing = false, 300);
  };

  const WHEEL_MAX_ITEMS = 15;
  const WHEEL_COLORS = [
    ['#7c3aed', '#a78bfa'],
    ['#e25771', '#fb7185'],
    ['#087f8c', '#2dd4bf'],
    ['#d58422', '#fbbf24'],
    ['#3156b8', '#60a5fa'],
    ['#b44291', '#f472b6'],
    ['#16805a', '#34d399'],
    ['#c0522b', '#fb923c']
  ];
  const wheelEls = {
    canvas: document.getElementById('wheel-canvas'),
    previewCanvas: document.getElementById('wheel-preview-canvas'),
    setup: document.getElementById('wheel-setup'),
    play: document.getElementById('wheel-play'),
    list: document.getElementById('wheel-items-list'),
    empty: document.getElementById('wheel-empty-state'),
    input: document.getElementById('wheel-new-item'),
    add: document.getElementById('wheel-add-item'),
    ready: document.getElementById('wheel-ready'),
    count: document.getElementById('wheel-item-count'),
    setupHint: document.getElementById('wheel-setup-hint'),
    previewStatus: document.getElementById('wheel-preview-status'),
    playItems: document.getElementById('wheel-play-items'),
    playCount: document.getElementById('wheel-play-count'),
    spin: document.getElementById('wheel-spin-btn'),
    spinAgain: document.getElementById('wheel-spin-again'),
    reset: document.getElementById('wheel-reset-btn'),
    pointer: document.getElementById('wheel-pointer'),
    liveStatus: document.getElementById('wheel-live-status'),
    winnerOverlay: document.getElementById('wheel-winner-overlay'),
    winnerText: document.getElementById('wheel-winner-text'),
    winnerClose: document.getElementById('wheel-winner-close'),
    historyList: document.getElementById('wheel-history-list'),
    historyCount: document.getElementById('wheel-history-count')
  };

  let wheelItems = [];
  let wheelHistory = [];
  let currentRotation = 0;
  let wheelSpinTimer = null;
  let activeSpinId = null;
  let isWheelSpinning = false;
  window.wheelItems = wheelItems;

  const normalizeWheelItems = (items) => (Array.isArray(items) ? items : [])
    .map(item => String(item ?? '').replace(/\s+/g, ' ').trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, WHEEL_MAX_ITEMS);

  const colorAt = (index) => WHEEL_COLORS[index % WHEEL_COLORS.length];

  const roundedRect = (ctx, x, y, width, height, radius) => {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, safeRadius);
  };

  const fitWheelLabel = (ctx, label, maxWidth) => {
    if (ctx.measureText(label).width <= maxWidth) return label;
    let trimmed = label;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}…`;
  };

  const drawWheelCanvas = (targetCanvas) => {
    const ctx = targetCanvas?.getContext('2d');
    if (!ctx) return;

    const size = targetCanvas.width;
    const center = size / 2;
    const radius = size * 0.475;
    ctx.clearRect(0, 0, size, size);
    ctx.save();

    ctx.beginPath();
    ctx.arc(center, center, radius + size * 0.012, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0911';
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = size * 0.045;
    ctx.fill();
    ctx.shadowBlur = 0;

    const displayItems = wheelItems.length ? wheelItems : Array.from({ length: 8 }, () => '');
    const slice = Math.PI * 2 / displayItems.length;
    const startOffset = -Math.PI / 2 - slice / 2;

    displayItems.forEach((item, index) => {
      const start = startOffset + index * slice;
      const end = start + slice;
      const [from, to] = wheelItems.length ? colorAt(index) : (index % 2
        ? ['#211d2c', '#2b2539']
        : ['#17141f', '#211c2c']);
      const gradient = ctx.createLinearGradient(
        center + Math.cos(start) * radius,
        center + Math.sin(start) * radius,
        center + Math.cos(end) * radius,
        center + Math.sin(end) * radius
      );
      gradient.addColorStop(0, from);
      gradient.addColorStop(1, to);

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = Math.max(1, size * 0.0025);
      ctx.stroke();

      if (!item) return;
      const middle = start + slice / 2;
      const fontSize = Math.max(size * 0.022, Math.min(size * 0.036, size * (0.22 / displayItems.length)));
      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(middle);
      ctx.font = `800 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#fffaf2';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.38)';
      ctx.shadowBlur = fontSize * 0.35;
      const labelWidth = radius * (displayItems.length > 10 ? 0.47 : 0.55);
      const isLeftHalf = Math.cos(middle) < 0;
      if (isLeftHalf) {
        ctx.rotate(Math.PI);
        ctx.textAlign = 'left';
      }
      ctx.fillText(
        fitWheelLabel(ctx, item, labelWidth),
        isLeftHalf ? -radius * 0.86 : radius * 0.86,
        0
      );
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(center, center, radius * 0.19, 0, Math.PI * 2);
    ctx.fillStyle = '#100d18';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = size * 0.008;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#e8b650';
    ctx.lineWidth = size * 0.012;
    ctx.stroke();

    if (!wheelItems.length) {
      roundedRect(ctx, center - size * 0.17, center - size * 0.028, size * 0.34, size * 0.056, size * 0.028);
      ctx.fillStyle = 'rgba(9,8,14,.76)';
      ctx.fill();
      ctx.fillStyle = '#8d829e';
      ctx.font = `800 ${size * 0.021}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SEÇENEK EKLE', center, center);
    }
    ctx.restore();
  };

  const drawWheel = () => {
    drawWheelCanvas(wheelEls.canvas);
    drawWheelCanvas(wheelEls.previewCanvas);
  };

  const renderWheelHistory = () => {
    wheelEls.historyList.replaceChildren();
    wheelEls.historyCount.textContent = String(wheelHistory.length);
    if (!wheelHistory.length) {
      const empty = document.createElement('p');
      empty.id = 'wheel-history-empty';
      empty.textContent = 'İlk sonuç burada görünecek.';
      wheelEls.historyList.appendChild(empty);
      return;
    }
    wheelHistory.forEach((winner, index) => {
      const row = document.createElement('div');
      row.className = 'wheel-history-item';
      const order = document.createElement('strong');
      order.textContent = String(wheelHistory.length - index);
      const label = document.createElement('span');
      label.textContent = winner;
      row.append(order, label);
      wheelEls.historyList.appendChild(row);
    });
  };

  const renderWheelPlayItems = () => {
    wheelEls.playItems.replaceChildren();
    wheelEls.playCount.textContent = String(wheelItems.length);
    wheelItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'wheel-play-item';
      const swatch = document.createElement('i');
      swatch.style.background = colorAt(index)[1];
      const label = document.createElement('span');
      label.textContent = item;
      row.append(swatch, label);
      wheelEls.playItems.appendChild(row);
    });
  };

  const updateWheelControls = () => {
    const hasEnough = wheelItems.length >= 2;
    const inputValue = wheelEls.input.value.trim();
    wheelEls.count.textContent = `${wheelItems.length} / ${WHEEL_MAX_ITEMS}`;
    wheelEls.ready.disabled = !hasEnough;
    wheelEls.add.disabled = !inputValue || wheelItems.length >= WHEEL_MAX_ITEMS;
    wheelEls.empty.classList.toggle('hidden', wheelItems.length > 0);
    wheelEls.previewStatus.textContent = wheelItems.length
      ? `${wheelItems.length} seçenek hazır`
      : 'Seçenek bekleniyor';
    wheelEls.setupHint.textContent = hasEnough
      ? 'Her şey hazır. Sonradan tekrar düzenleyebilirsin.'
      : `Başlamak için ${2 - wheelItems.length} seçenek daha ekle.`;
  };

  const renderWheelItems = () => {
    wheelEls.list.replaceChildren();
    wheelItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'wheel-item-row';

      const swatch = document.createElement('span');
      swatch.className = 'wheel-item-swatch';
      swatch.style.background = `linear-gradient(135deg, ${colorAt(index).join(', ')})`;
      swatch.textContent = String(index + 1);

      const label = document.createElement('span');
      label.className = 'wheel-item-name';
      label.textContent = item;

      const remove = document.createElement('button');
      remove.className = 'wheel-remove-item';
      remove.type = 'button';
      remove.setAttribute('aria-label', `${item} seçeneğini kaldır`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 7 10 10M17 7 7 17"></path></svg>';
      remove.addEventListener('click', () => {
        const nextItems = wheelItems.filter((_, itemIndex) => itemIndex !== index);
        setWheelItems(nextItems, true);
      });

      row.append(swatch, label, remove);
      wheelEls.list.appendChild(row);
    });
    renderWheelPlayItems();
    updateWheelControls();
  };

  const resetWheelRotation = () => {
    currentRotation = 0;
    if (!wheelEls.canvas) return;
    wheelEls.canvas.style.transition = 'none';
    wheelEls.canvas.style.transform = 'rotate(0deg)';
  };

  const setWheelItems = (items, shouldBroadcast = false) => {
    wheelItems = normalizeWheelItems(items);
    window.wheelItems = wheelItems;
    wheelHistory = [];
    renderWheelHistory();
    renderWheelItems();
    resetWheelRotation();
    drawWheel();
    if (shouldBroadcast) {
      broadcastActivityMsg({ type: 'wheel_items', items: [...wheelItems] });
    }
  };

  const addWheelItem = () => {
    const value = wheelEls.input.value.replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!value || wheelItems.length >= WHEEL_MAX_ITEMS) return;
    wheelEls.input.value = '';
    setWheelItems([...wheelItems, value], true);
    wheelEls.input.focus();
  };

  wheelEls.add?.addEventListener('click', addWheelItem);
  wheelEls.input?.addEventListener('input', updateWheelControls);
  wheelEls.input?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addWheelItem();
    }
  });
  document.querySelectorAll('.wheel-preset').forEach(button => {
    button.addEventListener('click', () => {
      setWheelItems(button.dataset.wheelItems.split('|'), true);
      wheelEls.input.focus();
    });
  });

  const setWheelLiveStatus = (text, spinning = false) => {
    wheelEls.liveStatus.lastChild.textContent = ` ${text}`;
    wheelEls.liveStatus.classList.toggle('is-spinning', spinning);
  };

  const handleWheelReady = () => {
    if (wheelItems.length < 2) return;
    wheelEls.setup.classList.add('hidden');
    wheelEls.play.classList.remove('hidden');
    renderWheelPlayItems();
    drawWheel();
    setWheelLiveStatus('Çark hazır');
  };

  wheelEls.ready?.addEventListener('click', () => {
    if (wheelItems.length < 2) return;
    handleWheelReady();
    broadcastActivityMsg({ type: 'wheel_ready', items: [...wheelItems] });
  });

  const cancelWheelSpin = () => {
    if (wheelSpinTimer) clearTimeout(wheelSpinTimer);
    wheelSpinTimer = null;
    activeSpinId = null;
    isWheelSpinning = false;
    wheelEls.spin.disabled = false;
    wheelEls.spinAgain.disabled = false;
    wheelEls.reset.disabled = false;
    wheelEls.pointer.classList.remove('is-ticking');
  };

  const hideWheelWinner = (shouldBroadcast = false) => {
    wheelEls.winnerOverlay.classList.add('hidden');
    if (shouldBroadcast) broadcastActivityMsg({ type: 'wheel_result_close' });
    wheelEls.spin.focus();
  };

  const handleWheelReset = () => {
    cancelWheelSpin();
    wheelEls.play.classList.add('hidden');
    wheelEls.setup.classList.remove('hidden');
    wheelEls.winnerOverlay.classList.add('hidden');
    wheelHistory = [];
    renderWheelHistory();
    resetWheelRotation();
    setWheelLiveStatus('Çark hazır');
  };

  wheelEls.reset?.addEventListener('click', () => {
    handleWheelReset();
    broadcastActivityMsg({ type: 'wheel_reset' });
  });

  const resolveWinnerFromRotation = rotation => {
    if (!wheelItems.length) return -1;
    const sliceDeg = 360 / wheelItems.length;
    const normalized = ((rotation % 360) + 360) % 360;
    return Math.round(((360 - normalized) % 360) / sliceDeg) % wheelItems.length;
  };

  const showWheelWinner = winnerIndex => {
    const normalizedIndex = Number.isInteger(winnerIndex)
      ? Math.max(0, Math.min(winnerIndex, wheelItems.length - 1))
      : resolveWinnerFromRotation(currentRotation);
    const winner = wheelItems[normalizedIndex];
    if (!winner) return;
    wheelHistory = [...wheelHistory, winner].slice(-6);
    renderWheelHistory();
    wheelEls.winnerText.textContent = winner;
    wheelEls.winnerOverlay.classList.remove('hidden');
    setWheelLiveStatus(`Sonuç: ${winner}`);
    wheelEls.winnerClose.focus();
  };

  const handleWheelSpin = spinData => {
    if (wheelItems.length < 2 || !wheelEls.canvas) return;
    const payload = typeof spinData === 'number' ? { targetDeg: spinData } : spinData;
    if (!Number.isFinite(Number(payload.targetDeg))) return;
    if (Array.isArray(payload.items) && normalizeWheelItems(payload.items).length >= 2) {
      const incomingItems = normalizeWheelItems(payload.items);
      if (incomingItems.join('\u0000') !== wheelItems.join('\u0000')) {
        wheelItems = incomingItems;
        window.wheelItems = wheelItems;
        renderWheelItems();
        drawWheel();
      }
    }

    cancelWheelSpin();
    wheelEls.winnerOverlay.classList.add('hidden');
    isWheelSpinning = true;
    const duration = Math.max(80, Number(payload.duration) || 5200);
    const spinId = payload.spinId || `legacy-${Date.now()}`;
    activeSpinId = spinId;
    wheelEls.spin.disabled = true;
    wheelEls.spinAgain.disabled = true;
    wheelEls.reset.disabled = true;
    wheelEls.pointer.classList.add('is-ticking');
    setWheelLiveStatus('Çark dönüyor', true);

    currentRotation = Number(payload.targetDeg);
    wheelEls.canvas.style.transition = `transform ${duration}ms cubic-bezier(.12,.72,.08,1)`;
    requestAnimationFrame(() => {
      wheelEls.canvas.style.transform = `rotate(${currentRotation}deg)`;
    });

    wheelSpinTimer = setTimeout(() => {
      if (activeSpinId !== spinId) return;
      const winnerIndex = Number.isInteger(payload.winnerIndex)
        ? payload.winnerIndex
        : resolveWinnerFromRotation(currentRotation);
      cancelWheelSpin();
      showWheelWinner(winnerIndex);
    }, duration + 100);
  };

  const requestWheelSpin = () => {
    if (isWheelSpinning || wheelItems.length < 2) return;
    const winnerIndex = Math.floor(Math.random() * wheelItems.length);
    const sliceDeg = 360 / wheelItems.length;
    const normalizedCurrent = ((currentRotation % 360) + 360) % 360;
    const targetNormalized = ((-winnerIndex * sliceDeg) % 360 + 360) % 360;
    const alignment = (targetNormalized - normalizedCurrent + 360) % 360;
    const turns = 6 + Math.floor(Math.random() * 3);
    const duration = Number(window.__wheelSpinDurationMs) || 5200;
    const payload = {
      type: 'wheel_spin',
      spinId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      targetDeg: currentRotation + turns * 360 + alignment,
      winnerIndex,
      duration,
      items: [...wheelItems]
    };
    broadcastActivityMsg(payload);
    handleWheelSpin(payload);
  };

  wheelEls.spin?.addEventListener('click', requestWheelSpin);
  wheelEls.spinAgain?.addEventListener('click', () => {
    hideWheelWinner(false);
    requestWheelSpin();
  });
  wheelEls.winnerClose?.addEventListener('click', () => hideWheelWinner(true));
  wheelEls.winnerOverlay?.addEventListener('click', event => {
    if (event.target === wheelEls.winnerOverlay) hideWheelWinner(true);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !wheelEls.winnerOverlay.classList.contains('hidden')) {
      hideWheelWinner(true);
    }
  });

  setWheelItems([], false);

  window.activityHandler = (data) => {
    try {
      if (data.type === 'activity_change') {
        closeAllCards(data.activity === 'none');
        if (data.activity === 'poll') openCardFocused('poll-card');
        if (data.activity === 'lvs') openCardFocused('lvs-card');
        if (data.activity === 'wheel') openCardFocused('wheel-card');
      }
      if (data.type === 'poll_start') handlePollStart(data, false);
      if (data.type === 'poll_vote') applyPollVote(data);
      if (data.type === 'poll_end') handlePollEnd(data);
      if (data.type === 'poll_reset') resetPoll(true);
      if (data.type === 'lvs_sync') handleLvsSync(data);
      if (data.type === 'wheel_items') {
        setWheelItems(data.items, false);
      }
      if (data.type === 'wheel_ready') {
        if (Array.isArray(data.items)) setWheelItems(data.items, false);
        handleWheelReady();
      }
      if (data.type === 'wheel_reset') {
        handleWheelReset();
      }
      if (data.type === 'wheel_spin') handleWheelSpin(data);
      if (data.type === 'wheel_result_close') hideWheelWinner(false);
    } catch(e) {}
  };
}
