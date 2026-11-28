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
$('roomCodeInput').value = roomCode;

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
    case 'TRIPLE':
      return '三张';
    case 'BOMB':
      return '炸弹';
    case 'BOMB_WITH_TWO':
      return '炸弹带两张';
    case 'FIVE_TEN_K':
      return a.pure ? '纯色五十K' : '五十K';
    case 'TRIPLE_ONE':
      return '三带一';
    case 'TRIPLE_TWO':
      return '三带二';
    case 'PLANE':
      return '飞机';
    case 'PLANE_WITH_SINGLE':
      return '飞机带单';
    case 'PLANE_WITH_PAIRS':
      return '飞机带对';
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
    `${gameState.players.length}/4`;

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
  const canStart = gameState.players.length >= 3;

  $('startBtn').classList.toggle('hidden', !isHost);
  $('startBtn').disabled = !canStart;

  if (gameState.players.length < 3) {
    $('lobbyHint').textContent =
      `还差 ${3 - gameState.players.length} 人（至少3人才能开始）`;
  } else if (gameState.players.length === 3) {
    $('lobbyHint').textContent = isHost
      ? '已有3人，可以开始，第4人不能再加入'
      : '已有3人，等待房主开始；开始后第4人不能加入';
  } else {
    $('lobbyHint').textContent = isHost
      ? '人齐了，可以开始'
      : '等待房主开始';
  }
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

/* ===== 语音朗读开始 ===== */

const RANK_CN = {
  A: 'A',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '七',
  8: '八',
  9: '九',
  10: '十',
  J: 'J',
  Q: 'Q',
  K: 'K'
};

const SUIT_CN = {
  S: '黑桃',
  H: '红桃',
  C: '梅花',
  D: '方块'
};

const RANK_ORDER = [
  '4', '5', '6', '7', '8', '9', '10',
  'J', 'Q', 'K', 'A', '2', '3'
];

const RANK_ORDER_CN = ['第一名', '第二名', '第三名', '第四名'];

let speechUnlocked = false;

function unlockSpeech() {
  if (speechUnlocked) return;
  if (!('speechSynthesis' in window)) return;

  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    speechSynthesis.speak(u);
    speechUnlocked = true;
    console.log('语音已解锁');
  } catch (e) {
    console.warn('语音解锁失败', e);
  }
}

document.addEventListener('touchstart', unlockSpeech, { once: true });
document.addEventListener('click', unlockSpeech, { once: true });

function cnRank(r) {
  return RANK_CN[r] || r;
}

function sortRanks(ranks) {
  return [...new Set(ranks)].sort(
    (a, b) => RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b)
  );
}

function buildSpeechText(action) {
  const a = action.analysis;
  const cards = action.cards || [];

  if (!a || !cards.length) return '出牌';

  const ranks = cards.map(c => c.rank);
  const counts = {};

  ranks.forEach(r => {
    counts[r] = (counts[r] || 0) + 1;
  });

  const distinct = Object.keys(counts);

  switch (a.type) {
    case 'SINGLE':
      return cnRank(cards[0].rank);

    case 'PAIR':
      return '对' + cnRank(cards[0].rank);

    case 'TRIPLE':
      return '三个' + cnRank(cards[0].rank);

    case 'BOMB':
      return '炸弹，四个' + cnRank(cards[0].rank);

    case 'BOMB_WITH_TWO': {
      const quad = distinct.find(r => counts[r] === 4);
      const extras = distinct.filter(r => r !== quad);
      const extraText =
        extras.length === 1
          ? '一对' + cnRank(extras[0])
          : extras.map(cnRank).join('和');
      return '炸弹带两张，四个' + cnRank(quad) + '带' + extraText;
    }

    case 'FIVE_TEN_K': {
      const suit = a.pure ? (SUIT_CN[cards[0].suit] || '') : '';
      return suit + '五十K';
    }

    case 'TRIPLE_ONE': {
      const triple = distinct.find(r => counts[r] === 3);
      const single = distinct.find(r => counts[r] === 1);
      return '三带一，三个' + cnRank(triple) + '带' + cnRank(single);
    }

    case 'TRIPLE_TWO': {
      const triple = distinct.find(r => counts[r] === 3);
      const pair = distinct.find(r => counts[r] === 2);
      return '三带二，三个' + cnRank(triple) + '带对' + cnRank(pair);
    }

    case 'PLANE':
    case 'PLANE_WITH_SINGLE':
    case 'PLANE_WITH_PAIRS': {
      const triples = distinct
        .filter(r => counts[r] === 3)
        .sort(
          (x, y) => RANK_ORDER.indexOf(x) - RANK_ORDER.indexOf(y)
        );

      const head =
        triples.length === 1
          ? '三个' + cnRank(triples[0])
          : '三个' + cnRank(triples[0]) +
            '到三个' + cnRank(triples[triples.length - 1]);

      if (a.type === 'PLANE') {
        return '飞机，' + head;
      }

      const extras = distinct.filter(r => counts[r] !== 3);

      if (a.type === 'PLANE_WITH_SINGLE') {
        return (
          '飞机带单，' + head + '带' + extras.map(cnRank).join('和')
        );
      }

      return (
        '飞机带对，' +
        head +
        '带' +
        extras.map(r => '对' + cnRank(r)).join('和')
      );
    }

    case 'STRAIGHT': {
      const s = sortRanks(ranks);
      if (s.length <= 3) {
        return '顺子，' + s.map(cnRank).join('');
      }
      return '顺子，' + cnRank(s[0]) + '到' + cnRank(s[s.length - 1]);
    }

    case 'CONSEC_PAIRS': {
      const s = sortRanks(ranks);
      if (s.length <= 3) {
        return '连对，' + s.map(cnRank).join('');
      }
      return '连对，' + cnRank(s[0]) + '到' + cnRank(s[s.length - 1]);
    }

    default:
      return '出牌';
  }
}

function buildRankingsText(action) {
  const list = action.rankings || [];
  if (!list.length) return '';

  const parts = list.map((name, i) => {
    const order = RANK_ORDER_CN[i] || `第${i + 1}名`;
    return `${order} ${name}`;
  });

  return '本局结束，' + parts.join('，');
}

function speak(text, onEnd) {
  if (!soundOn || !text) {
    if (onEnd) onEnd();
    return;
  }

  if (!('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }

  try {
    speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.1;
    u.pitch = 1;
    u.volume = 1;

    if (onEnd) {
      u.onend = () => onEnd();
    }

    speechSynthesis.speak(u);
  } catch (e) {
    console.warn('语音播放失败', e);
    if (onEnd) onEnd();
  }
}

function handleAction(action) {
  if (!action) return;

  if (action.type === 'play') {
    speak(buildSpeechText(action));
    return;
  }

  if (action.type === 'gameover') {
    const rankText = buildRankingsText(action);
    const finish = () => {
      speak(rankText || '本局结束');
    };

    if (action.cards && action.cards.length && action.analysis) {
      speak(buildSpeechText(action), finish);
    } else {
      finish();
    }
    return;
  }

  if (action.type === 'pass') {
    speak('不要');
    return;
  }

  if (action.type === 'deal') {
    speak('开始发牌');
  }
}

/* ===== 语音朗读结束 ===== */

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

  myName = name;
  localStorage.setItem('cardName', myName);

  socket.emit(
    'createRoom',
    { name, clientId },
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
  const code = $('roomCodeInput').value.trim();

  if (!name) {
    return showError('enterError', '请输入昵称');
  }

  if (!/^\d{5}$/.test(code)) {
    return showError('enterError', '请输入 5 位数字房间码');
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

  if (soundOn) {
    unlockSpeech();
    speak('音效已开启');
  }
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
