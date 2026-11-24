const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;

// 单张/对子/三张/炸弹大小：4 5 6 7 8 9 10 J Q K A 2 3
const RANK_ORDER = ['4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '3'];
const RANK_POWER = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i]));

// 纯色 5-10-K 花色大小：黑桃 > 红桃 > 梅花 > 方块
const SUIT_POWER = { S: 4, H: 3, C: 2, D: 1 };

// 顺子、连对只能用 4 到 A
const SEQ_RANKS = ['4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SEQ_POWER = Object.fromEntries(SEQ_RANKS.map((r, i) => [r, i]));

const rooms = new Map();

function createDeck() {
  const suits = ['S', 'H', 'C', 'D'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        rank
      });
    }
  }

  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sortHand(hand) {
  hand.sort((a, b) => {
    const r = RANK_POWER[a.rank] - RANK_POWER[b.rank];
    if (r !== 0) return r;
    return SUIT_POWER[b.suit] - SUIT_POWER[a.suit];
  });
  return hand;
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;

  do {
    code = Array.from({ length: 5 }, () => {
      return chars[Math.floor(Math.random() * chars.length)];
    }).join('');
  } while (rooms.has(code));

  return code;
}

function containsHeart4(cards) {
  return cards.some(c => c.suit === 'H' && c.rank === '4');
}

function analyzePlay(cards, playerCount) {
  const n = cards.length;

  if (!n) {
    return { ok: false, msg: '请选择要出的牌' };
  }

  const ranks = cards.map(c => c.rank);
  const suits = cards.map(c => c.suit);

  const counts = {};
  for (const r of ranks) {
    counts[r] = (counts[r] || 0) + 1;
  }

  const distinct = Object.keys(counts);

  const groups = Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return RANK_POWER[b[0]] - RANK_POWER[a[0]];
  });

  // 炸弹：四张一样
  if (n === 4 && distinct.length === 1) {
    return {
      ok: true,
      type: 'BOMB',
      power: RANK_POWER[distinct[0]],
      rank: distinct[0],
      cards
    };
  }

  // 5-10-K 组合
  if (
    n === 3 &&
    distinct.length === 3 &&
    counts['5'] &&
    counts['10'] &&
    counts['K']
  ) {
    const pure = suits.every(s => s === suits[0]);

    return {
      ok: true,
      type: 'FIVE_TEN_K',
      pure,
      suit: pure ? suits[0] : null,
      suitPower: pure ? SUIT_POWER[suits[0]] : 0,
      cards
    };
  }

  // 单张
  if (n === 1) {
    return {
      ok: true,
      type: 'SINGLE',
      power: RANK_POWER[ranks[0]],
      rank: ranks[0],
      cards
    };
  }

  // 对子
  if (n === 2 && distinct.length === 1) {
    return {
      ok: true,
      type: 'PAIR',
      power: RANK_POWER[ranks[0]],
      rank: ranks[0],
      cards
    };
  }

  // 三带一 / 三带二
  if (n === 4 || n === 5) {
    const tripleEntry = groups.find(([r, c]) => c === 3);

    if (tripleEntry) {
      const tripleRank = tripleEntry[0];

      if (n === 4) {
        const other = groups.find(([r]) => r !== tripleRank);

        if (other && other[1] === 1) {
          return {
            ok: true,
            type: 'TRIPLE_ONE',
            power: RANK_POWER[tripleRank],
            rank: tripleRank,
            cards
          };
        }
      }

      if (n === 5) {
        if (playerCount !== 3) {
          return { ok: false, msg: '四人局不能出三带二' };
        }

        const pairEntry = groups.find(([r]) => r !== tripleRank);

        if (pairEntry && pairEntry[1] === 2) {
          return {
            ok: true,
            type: 'TRIPLE_TWO',
            power: RANK_POWER[tripleRank],
            rank: tripleRank,
            cards
          };
        }
      }
    }

    return { ok: false, msg: '牌型不合法' };
  }

  // 顺子
  if (n >= 3 && distinct.length === n) {
    if (!ranks.every(r => SEQ_POWER[r] !== undefined)) {
      return { ok: false, msg: '顺子不能包含 2 或 3' };
    }

    const seq = ranks.map(r => SEQ_POWER[r]).sort((a, b) => a - b);

    let consecutive = true;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] !== seq[i - 1] + 1) {
        consecutive = false;
        break;
      }
    }

    if (consecutive) {
      return {
        ok: true,
        type: 'STRAIGHT',
        power: seq[seq.length - 1],
        length: n,
        cards
      };
    }
  }

  // 连对
  if (n >= 6 && n % 2 === 0) {
    const pairRanks = Object.keys(counts);

    if (pairRanks.length >= 3 && pairRanks.every(r => counts[r] === 2)) {
      if (!pairRanks.every(r => SEQ_POWER[r] !== undefined)) {
        return { ok: false, msg: '连对不能包含 2 或 3' };
      }

      const seq = pairRanks.map(r => SEQ_POWER[r]).sort((a, b) => a - b);

      let consecutive = true;
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] !== seq[i - 1] + 1) {
          consecutive = false;
          break;
        }
      }

      if (consecutive) {
        return {
          ok: true,
          type: 'CONSEC_PAIRS',
          power: seq[seq.length - 1],
          length: pairRanks.length,
          cards
        };
      }
    }
  }

  return { ok: false, msg: '牌型不合法' };
}

function canBeat(candidate, previous) {
  if (!previous) return true;

  // 炸弹最大
  if (candidate.type === 'BOMB') {
    if (previous.type === 'BOMB') {
      return candidate.power > previous.power;
    }
    return true;
  }

  // 5-10-K 大于普通牌，小于炸弹
  if (candidate.type === 'FIVE_TEN_K') {
    if (previous.type === 'BOMB') return false;

    if (previous.type === 'FIVE_TEN_K') {
      if (candidate.pure) {
        if (previous.pure) {
          return candidate.suitPower > previous.suitPower;
        }
        return true;
      }

      // 非纯色之间同权，不能互压
      return false;
    }

    return true;
  }

  // 普通牌不能压炸弹、5-10-K
  if (previous.type === 'BOMB' || previous.type === 'FIVE_TEN_K') {
    return false;
  }

  if (candidate.type !== previous.type) return false;

  if (candidate.type === 'STRAIGHT') {
    return (
      candidate.length === previous.length &&
      candidate.power > previous.power
    );
  }

  if (candidate.type === 'CONSEC_PAIRS') {
    return (
      candidate.length === previous.length &&
      candidate.power > previous.power
    );
  }

  return candidate.power > previous.power;
}

function nextActiveIndex(room, fromIndex) {
  const n = room.players.length;

  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    if (!room.players[idx].finished) {
      return idx;
    }
  }

  return null;
}

function startRound(room, dealerIndex) {
  const n = room.players.length;
  const deck = shuffle(createDeck());

  room.players.forEach(p => {
    p.hand = [];
    p.finished = false;
    p.rankOrder = null;
  });

  room.dealerIndex = dealerIndex;

  // 52 张全部发完，三人局先起牌者 18 张，另外两人 17 张
  for (let i = 0; i < deck.length; i++) {
    const idx = (dealerIndex + i) % n;
    room.players[idx].hand.push(deck[i]);
  }

  room.players.forEach(p => sortHand(p.hand));

  // 谁拿到红桃4谁先出牌
  const firstIndex = room.players.findIndex(p =>
    p.hand.some(c => c.suit === 'H' && c.rank === '4')
  );

  room.currentTurn = firstIndex;
  room.lastPlay = null;
  room.passCount = 0;
  room.rankings = [];
  room.firstPlay = true;
  room.started = true;
  room.gameOver = false;
  room.round = (room.round || 0) + 1;
  room.nextDealerIndex = null;
}

function publicStateFor(room, viewerSocketId) {
  const viewerIndex = room.players.findIndex(p => p.socketId === viewerSocketId);
  const viewer = viewerIndex >= 0 ? room.players[viewerIndex] : null;

  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    started: room.started,
    gameOver: room.gameOver,
    currentTurn: room.currentTurn,
    dealerIndex: room.dealerIndex,
    firstPlay: room.firstPlay,
    round: room.round,
    rankings: room.rankings,
    lastPlay: room.lastPlay
      ? {
          playerIndex: room.lastPlay.playerIndex,
          cards: room.lastPlay.cards,
          analysis: {
            type: room.lastPlay.analysis.type,
            rank: room.lastPlay.analysis.rank,
            pure: room.lastPlay.analysis.pure,
            suit: room.lastPlay.analysis.suit,
            length: room.lastPlay.analysis.length
          }
        }
      : null,
    players: room.players.map((p, i) => ({
      index: i,
      name: p.name,
      connected: p.connected,
      cardCount: p.hand.length,
      finished: p.finished,
      rankOrder: p.rankOrder
    })),
    yourIndex: viewerIndex,
    yourHand: viewer ? viewer.hand : [],
    isHost: viewer ? viewer.clientId === room.hostClientId : false
  };
}

function emitState(room) {
  for (const p of room.players) {
    if (p.socketId) {
      io.to(p.socketId).emit('state', publicStateFor(room, p.socketId));
    }
  }
}

function getContext(socket) {
  const roomCode = socket.data && socket.data.roomCode;
  const clientId = socket.data && socket.data.clientId;
  const room = roomCode ? rooms.get(roomCode) : null;

  if (!room) return {};

  const playerIndex = room.players.findIndex(p => p.clientId === clientId);

  return {
    room,
    playerIndex,
    player: room.players[playerIndex]
  };
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name, clientId }, cb) => {
    name = String(name || '').trim().slice(0, 12);

    if (!name) {
      return cb?.({ error: '请输入昵称' });
    }

    const maxPlayers = 4;
    const code = genCode();

    const room = {
      code,
      hostClientId: clientId,
      maxPlayers,
      players: [
        {
          clientId,
          name,
          socketId: socket.id,
          connected: true,
          hand: [],
          finished: false,
          rankOrder: null
        }
      ],
      started: false,
      gameOver: false,
      currentTurn: 0,
      dealerIndex: null,
      lastPlay: null,
      passCount: 0,
      rankings: [],
      firstPlay: false,
      round: 0,
      nextDealerIndex: null
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data = { roomCode: code, clientId };

    cb?.({ ok: true, code });
    emitState(room);
  });

  socket.on('joinRoom', ({ code, name, clientId }, cb) => {
    code = String(code || '').toUpperCase().trim();
    name = String(name || '').trim().slice(0, 12);

    const room = rooms.get(code);

    if (!room) {
      return cb?.({ error: '房间不存在或已解散' });
    }

    let player = room.players.find(p => p.clientId === clientId);

    // 断线重连
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
      if (name) player.name = name;

      socket.join(code);
      socket.data = { roomCode: code, clientId };

      cb?.({ ok: true, code });
      emitState(room);
      return;
    }

    if (room.started) {
      return cb?.({ error: '游戏已开始，不能加入' });
    }

    if (room.players.length >= room.maxPlayers) {
      return cb?.({ error: '房间已满' });
    }

    if (!name) {
      return cb?.({ error: '请输入昵称' });
    }

    room.players.push({
      clientId,
      name,
      socketId: socket.id,
      connected: true,
      hand: [],
      finished: false,
      rankOrder: null
    });

    socket.join(code);
    socket.data = { roomCode: code, clientId };

    cb?.({ ok: true, code });
    emitState(room);
  });

  socket.on('startGame', (data, cb) => {
    const { room, player } = getContext(socket);

    if (!room || !player) {
      return cb?.({ error: '你不在房间里' });
    }

    if (player.clientId !== room.hostClientId) {
      return cb?.({ error: '只有房主可以开始游戏' });
    }

    if (room.players.length < 3) {
      return cb?.({ error: '至少需要3人才能开始' });
    }

    if (room.players.length > 4) {
      return cb?.({ error: '人数不能超过4人' });
    }

    if (room.started && !room.gameOver) {
      return cb?.({ error: '游戏已经开始' });
    }

    const dealer =
      room.nextDealerIndex != null
        ? room.nextDealerIndex
        : Math.floor(Math.random() * room.players.length);

    startRound(room, dealer);

    io.to(room.code).emit('action', {
      type: 'deal',
      message: '开始发牌'
    });

    emitState(room);
    cb?.({ ok: true });
  });

  socket.on('playCards', ({ cardIds }, cb) => {
    const { room, playerIndex, player } = getContext(socket);

    if (!room || !player) {
      return cb?.({ error: '你不在房间里' });
    }

    if (!room.started || room.gameOver) {
      return cb?.({ error: '当前不能出牌' });
    }

    if (room.currentTurn !== playerIndex) {
      return cb?.({ error: '还没轮到你' });
    }

    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      return cb?.({ error: '请选择要出的牌' });
    }

    const cards = [];

    for (const id of cardIds) {
      const card = player.hand.find(c => c.id === id);

      if (!card) {
        return cb?.({ error: '选牌无效' });
      }

      if (!cards.some(c => c.id === id)) {
        cards.push(card);
      }
    }

    if (cards.length !== cardIds.length) {
      return cb?.({ error: '选牌重复或无效' });
    }

    const analysis = analyzePlay(cards, room.players.length);

    if (!analysis.ok) {
      return cb?.({ error: analysis.msg });
    }

    if (room.firstPlay && !containsHeart4(cards)) {
      return cb?.({ error: '第一手必须包含红桃4' });
    }

    if (!canBeat(analysis, room.lastPlay ? room.lastPlay.analysis : null)) {
      return cb?.({ error: '这手牌压不过上家' });
    }

    const ids = new Set(cardIds);
    player.hand = player.hand.filter(c => !ids.has(c.id));

    room.lastPlay = {
      playerIndex,
      cards,
      analysis
    };

    room.passCount = 0;
    room.firstPlay = false;

    let action = {
      type: 'play',
      playerIndex,
      playerName: player.name,
      cards,
      analysis: {
        type: analysis.type,
        rank: analysis.rank,
        pure: analysis.pure,
        suit: analysis.suit
      }
    };

    if (player.hand.length === 0) {
      player.finished = true;
      player.rankOrder = room.rankings.length + 1;
      room.rankings.push(playerIndex);

      if (room.rankings.length === room.players.length - 1) {
        const lastIndex = room.players.findIndex(
          (p, i) => !room.rankings.includes(i)
        );

        if (lastIndex !== -1) {
          room.players[lastIndex].rankOrder = room.players.length;
          room.rankings.push(lastIndex);
          room.gameOver = true;
          room.nextDealerIndex = lastIndex;

          action.type = 'gameover';
          action.rankings = room.rankings.map(i => room.players[i].name);
        }
      }
    }

    if (!room.gameOver) {
      room.currentTurn = nextActiveIndex(room, playerIndex);
    }

    io.to(room.code).emit('action', action);
    emitState(room);
    cb?.({ ok: true });
  });

  socket.on('passTurn', (data, cb) => {
    const { room, playerIndex, player } = getContext(socket);

    if (!room || !player) {
      return cb?.({ error: '你不在房间里' });
    }

    if (!room.started || room.gameOver) {
      return cb?.({ error: '当前不能操作' });
    }

    if (room.currentTurn !== playerIndex) {
      return cb?.({ error: '还没轮到你' });
    }

    if (!room.lastPlay) {
      return cb?.({ error: '新一轮必须出牌，不能不要' });
    }

    room.passCount += 1;

    const activeCount = room.players.filter(p => !p.finished).length;
    const lastPlayerIndex = room.lastPlay.playerIndex;
    const lastPlayerActive = !room.players[lastPlayerIndex].finished;

    const requiredPasses = lastPlayerActive
      ? activeCount - 1
      : activeCount;

    if (room.passCount >= requiredPasses) {
      room.lastPlay = null;
      room.passCount = 0;

      if (lastPlayerActive) {
        room.currentTurn = lastPlayerIndex;
      } else {
        room.currentTurn = nextActiveIndex(room, lastPlayerIndex);
      }
    } else {
      room.currentTurn = nextActiveIndex(room, playerIndex);
    }

    io.to(room.code).emit('action', {
      type: 'pass',
      playerIndex,
      playerName: player.name
    });

    emitState(room);
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const { room, playerIndex, player } = getContext(socket);

    if (!room || !player) return;

    player.connected = false;
    player.socketId = null;

    if (!room.started) {
      room.players.splice(playerIndex, 1);

      if (player.clientId === room.hostClientId) {
        if (room.players.length > 0) {
          room.hostClientId = room.players[0].clientId;
        } else {
          rooms.delete(room.code);
          return;
        }
      }
    }

    emitState(room);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
