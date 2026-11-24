const socket = io();

let clientId = localStorage.getItem('cardClientId');

if (!clientId) {
  clientId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

  localStorage.setItem('cardClientId', clientId);
}

let myName = localStorage.getItem('cardName') || '';
let roomCode =
  new URLSearchParams(location.search).get('room') || '';

let gameState = null;
let selected = new Set();
let soundOn = true;
let musicOn = false;
let audioCtx = null;
let musicTimer = null;

const $ = id => document.getElementById(id);

$('nameInput').value = myName;
$('roomCodeInput').value = roomCode.toUpperCase();

function updateUrl(code) {
  const url = new URL(location.href);
  url.searchParams.set('room', code);
  history.replaceState(null, '', url.toString());

  roomCode = code;
  $('roomCodeInput').value = code;
  $('lobbyCode').textContent = code;
  $('gameCode').textContent = code;
}

function showError(id, msg) {
  $(id).textContent = msg || '';
}

function setScreen(name) {
  ['enterScreen', 'lobbyScreen', 'gameScreen'].forEach(s => {
    $(s).classList.toggle('hidden', s !== name);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m];
  });
}

function isRed(suit) {
  return suit === 'H' || suit === 'D';
}

function suitSymbol(suit) {
  return {
    S: '♠',
    H: '♥',
    C: '♣',
    D: '♦'
  }[suit] || suit;
}

function describeAnalysis(a) {
  if (!a) return '';

  switch (a.type) {
    case 'SINGLE':
      return '单张';
    case 'PAIR':
      return '对子';
    case 'BOMB':
      return '炸弹';
    case 'FIVE_TEN_K':
      return a.pure ? '纯色五十K' : '五十K';
    case 'TRIPLE_ONE':
      return '三带一';
    case 'TRIPLE_TWO':
      return '三带二';
    case 'STRAIGHT':
      return '顺子';
    case 'CONSEC_PAIRS':
      return '连对';
    default:
      return a.type || '';
  }
}

function cardElement(card, clickable) {
  const el = document.createElement(clickable ? 'button' : 'div');

  el.className =
    'card ' + (isRed(card.suit) ? 'red' : 'black');

  if (clickable && selected.has(card.id)) {
    el.classList.add('selected');
  }

  el.innerHTML = `
    <span class="rank">${card.rank}</span>
    <span class="suit">${suitSymbol(card.suit)}</span>
  `;

  if (clickable) {
    el.type = 'button';
    el.onclick = () => toggleCard(card.id);
  }

  return el;
}

function toggleCard(id) {
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }

  renderGame();
}

function render() {
  if (!gameState) {
    setScreen('enterScreen');
    return;
  }

  if (!gameState.started) {
    setScreen('lobbyScreen');
    renderLobby();
  } else {
    setScreen('gameScreen');
    renderGame();
  }
}

function renderLobby() {
  $('lobbyCode').textContent = gameState.code;
  $('lobbyCount').textContent =
    `${gameState.players.length}/${gameState.maxPlayers}`;

  const ul = $('lobbyPlayers');
  ul.innerHTML = '';

  gameState.players.forEach(p => {
    const li = document.createElement('li');

    li.textContent =
      p.name +
      (p.connected ? '' : '（掉线）') +
      (p.index === gameState.yourIndex ? '（你）' : '');

    ul.appendChild(li);
  });

  const isHost = gameState.isHost;
  const full =
    gameState.players.length === gameState.maxPlayers;

  $('startBtn').classList.toggle('hidden', !isHost);
  $('startBtn').disabled = !full;

  $('lobbyHint').textContent = full
    ? isHost
      ? '人齐了，可以开始'
      : '等待房主开始'
    : `还差 ${gameState.maxPlayers - gameState.players.length} 人`;
}

function renderPlayers() {
  const bar = $('playersBar');
  bar.innerHTML = '';

  gameState.players.forEach(p => {
    const div = document.createElement('div');

    div.className = 'player';

    if (p.index === gameState.currentTurn && !gameState.gameOver) {
      div.classList.add('active');
    }

    if (p.finished) {
      div.classList.add('finished');
    }

    const name =
      escapeHtml(p.name) +
      (p.index === gameState.yourIndex ? '（你）' : '');

    div.innerHTML = `
      <div class="pname">${name}</div>
      <div class="pmeta">
        ${p.finished ? '第 ' + p.rankOrder + ' 名' : '剩 ' + p.cardCount + ' 张'}
      </div>
    `;

    bar.appendChild(div);
  });
}

function renderLastPlay() {
  const area = $('lastPlayArea');
  area.innerHTML = '';

  if (!gameState.lastPlay) {
    area.innerHTML = '<div class="muted">等待出牌</div>';
    return;
  }

  const lp = gameState.lastPlay;
  const pname =
    gameState.players[lp.playerIndex]?.name || '';

  const title = document.createElement('div');
  title.className = 'muted';
  title.textContent = `${pname} 出了：`;
  area.appendChild(title);

  const row = document.createElement('div');
  row.className = 'cards-row';

  lp.cards.forEach(c => {
    row.appendChild(cardElement(c, false));
  });

  area.appendChild(row);

  const desc = document.createElement('div');
  desc.className = 'muted';
  desc.textContent = describeAnalysis(lp.analysis);
  area.appendChild(desc);
}

function renderRankings() {
  const area = $('rankingsArea');

  if (!gameState.gameOver) {
    area.innerHTML = '';
    return;
  }

  const lines = gameState.rankings.map((idx, pos) => {
    const p = gameState.players[idx];

    return `第${pos + 1}名：${escapeHtml(p.name)}${
      pos === gameState.rankings.length - 1 ? '（输家）' : ''
    }`;
  });

  area.innerHTML = `
    <h3>本局结束</h3>
    <div>${lines.join('<br>')}</div>
  `;
}

function renderHand() {
  const container = $('hand');
  container.innerHTML = '';

  const hand = gameState.yourHand || [];
  const validIds = new Set(hand.map(c => c.id));

  selected.forEach(id => {
    if (!validIds.has(id)) {
      selected.delete(id);
    }
  });

  hand.forEach(c => {
    container.appendChild(cardElement(c, true));
  });
}

function renderGame() {
  $('gameCode').textContent = gameState.code;

  renderPlayers();
  renderLastPlay();
  renderRankings();
  renderHand();

  const myTurn =
    gameState.currentTurn === gameState.yourIndex &&
    !gameState.gameOver;

  const current = gameState.players[gameState.currentTurn];

  $('turnInfo').textContent = gameState.gameOver
    ? '本局结束'
    : myTurn
      ? '轮到你出牌'
      : `轮到 ${current ? current.name : ''}`;

  $('playBtn').disabled = !myTurn || selected.size === 0;
  $('passBtn').disabled = !myTurn || !gameState.lastPlay;

  $('restartBtn').classList.toggle(
    'hidden',
    !(gameState.gameOver && gameState.isHost)
  );
}

function speak(text) {
  if (!soundOn || !('speechSynthesis' in window)) return;

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 1.2;

  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function playSpeech(action) {
  const names = {
    '4': '四',
    '5': '五',
    '6': '六',
    '7': '七',
    '8': '八',
    '9': '九',
    '10': '十',
    'J': 'J',
    'Q': 'Q',
    'K': 'K',
    'A': 'A',
    '2': '二',
    '3': '三'
  };

  const a = action.analysis;
  const cards = action.cards || [];

  if (!a) return '出牌';

  if (a.type === 'SINGLE') {
    return names[cards[0].rank];
  }

  if (a.type === 'PAIR') {
    return '对' + names[cards[0].rank];
  }

  if (a.type === 'BOMB') {
    return '炸弹，四个' + names[cards[0].rank];
  }

  if (a.type === 'FIVE_TEN_K') {
    return (a.pure ? '纯色' : '') + '五十K';
  }

  if (a.type === 'TRIPLE_ONE') return '三带一';
  if (a.type === 'TRIPLE_TWO') return '三带二';
  if (a.type === 'STRAIGHT') return '顺子';
  if (a.type === 'CONSEC_PAIRS') return '连对';

  return '出牌';
}

function handleAction(action) {
  if (!action) return;

  if (action.type === 'play') {
    speak(playSpeech(action));
  } else if (action.type === 'pass') {
    speak('不要');
  } else if (action.type === 'deal') {
    speak('开始发牌');
  } else if (action.type === 'gameover') {
    speak('本局结束');
  }
}

function startMusic() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  musicOn = true;

  const notes = [
    261.63,
    329.63,
    392.0,
    523.25,
    392.0,
    329.63
  ];

  let idx = 0;

  function tick() {
    if (!musicOn) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.value = notes[idx % notes.length];

    gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audioCtx.currentTime + 0.7
    );

    osc.connect(gain).connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.8);

    idx++;
    musicTimer = setTimeout(tick, 850);
  }

  tick();
}

function stopMusic() {
  musicOn = false;

  if (musicTimer) {
    clearTimeout(musicTimer);
  }
}

function toggleMusic() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (musicOn) {
    stopMusic();
  } else {
    startMusic();
  }

  $('musicBtn').textContent = musicOn
    ? '🎵 音乐开'
    : '🎵 音乐关';
}

// 创建房间
$('createBtn').onclick = () => {
  const name = $('nameInput').value.trim();

  if (!name) {
    return showError('enterError', '请输入昵称');
  }

  const maxPlayers = Number($('maxPlayersSelect').value);

  myName = name;
  localStorage.setItem('cardName', myName);

  socket.emit(
    'createRoom',
    { name, maxPlayers, clientId },
    res => {
      if (res?.error) {
        return showError('enterError', res.error);
      }

      updateUrl(res.code);
      showError('enterError', '');
    }
  );
};

// 加入房间
$('joinBtn').onclick = () => {
  const name = $('nameInput').value.trim();
  const code = $('roomCodeInput').value.trim().toUpperCase();

  if (!name) {
    return showError('enterError', '请输入昵称');
  }

  if (!code) {
    return showError('enterError', '请输入房间码');
  }

  myName = name;
  localStorage.setItem('cardName', myName);

  socket.emit(
    'joinRoom',
    { code, name, clientId },
    res => {
      if (res?.error) {
        return showError('enterError', res.error);
      }

      updateUrl(res.code);
      showError('enterError', '');
    }
  );
};

// 开始游戏 / 再来一局
$('startBtn').onclick = () => {
  socket.emit('startGame', {}, res => {
    if (res?.error) {
      showError('lobbyError', res.error);
    } else {
      showError('lobbyError', '');
    }
  });
};

$('restartBtn').onclick = () => {
  socket.emit('startGame', {}, res => {
    if (res?.error) {
      showError('gameError', res.error);
    } else {
      selected.clear();
      showError('gameError', '');
    }
  });
};

// 出牌
$('playBtn').onclick = () => {
  if (!gameState) return;

  const cardIds = Array.from(selected);

  if (!cardIds.length) {
    return showError('gameError', '请选择要出的牌');
  }

  socket.emit('playCards', { cardIds }, res => {
    if (res?.error) {
      return showError('gameError', res.error);
    }

    selected.clear();
    showError('gameError', '');
    renderGame();
  });
};

// 不要
$('passBtn').onclick = () => {
  socket.emit('passTurn', {}, res => {
    if (res?.error) {
      return showError('gameError', res.error);
    }

    selected.clear();
    showError('gameError', '');
  });
};

// 音效开关
$('soundBtn').onclick = () => {
  soundOn = !soundOn;
  $('soundBtn').textContent = soundOn
    ? '🔊 音效开'
    : '🔇 音效关';
};

// 音乐开关
$('musicBtn').onclick = () => {
  toggleMusic();
};

socket.on('state', state => {
  gameState = state;

  if (state.code && state.code !== roomCode) {
    updateUrl(state.code);
  }

  render();
});

socket.on('action', action => {
  handleAction(action);
});

socket.on('connect', () => {
  if (roomCode && myName) {
    socket.emit(
      'joinRoom',
      { code: roomCode, name: myName, clientId },
      res => {
        if (res?.error) {
          // 忽略自动重连失败，用户可手动重新加入
        }
      }
    );
  }
});

render();