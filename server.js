const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
});

const PORT = process.env.PORT || 3000;
const TURN_TIME_LIMIT = 30000;
// ── FIX: reconnection allowed within 5 minutes only
const RECONNECT_WINDOW_MS = 5 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const rooms = {};

// ── FIX: generate a unique session token
function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getCardPoints(value) {
  if (['J', 'Q', 'K'].includes(value)) return 10;
  if (value === 'A') return 11;
  const p = parseInt(value);
  return isNaN(p) ? 0 : p;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createDeck() {
  const suits = ['♦', '♥', '♠', '♣'];
  const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let i = 0; i < 4; i++) {
    for (const s of suits) {
      for (const v of values) {
        deck.push({
          suit: s, value: v,
          id: `${s}-${v}-${i}-${Math.random().toString(36).substr(2, 5)}`,
          points: getCardPoints(v),
        });
      }
    }
  }
  return shuffle(deck);
}

function prepareGame(playerCount) {
  const deck = createDeck();
  const allHands = [];
  for (let i = 0; i < playerCount; i++) allHands.push(deck.splice(0, i === 0 ? 15 : 14));
  return { allHands, remainingDeck: deck };
}

function getCardValue(card) {
  const map = { A: 14, K: 13, Q: 12, J: 11 };
  return map[card.value.toUpperCase()] ?? parseInt(card.value);
}

function autoSplitIntoGroups(cards) {
  const groups = [];
  const usedIdx = new Set();
  const temp = cards.map((c, i) => ({ ...c, _i: i }));
  ['♠', '♥', '♣', '♦'].forEach(suit => {
    const sc = temp.filter(c => c.suit === suit && !usedIdx.has(c._i));
    sc.sort((a, b) => getCardValue(a) - getCardValue(b));
    let run = [];
    for (let i = 0; i < sc.length; i++) {
      if (!run.length || getCardValue(sc[i]) === getCardValue(run[run.length - 1]) + 1) {
        run.push(sc[i]);
      } else {
        if (run.length >= 3) { groups.push(run.map(({ _i, ...r }) => r)); run.forEach(c => usedIdx.add(c._i)); }
        run = [sc[i]];
      }
    }
    if (run.length >= 3) { groups.push(run.map(({ _i, ...r }) => r)); run.forEach(c => usedIdx.add(c._i)); }
  });
  const remaining = temp.filter(c => !usedIdx.has(c._i));
  const vals = [...new Set(remaining.map(c => c.value))];
  vals.forEach(val => {
    const vc = remaining.filter(c => c.value === val && !usedIdx.has(c._i));
    const uniqueSuitGroup = [];
    const seenSuits = new Set();
    vc.forEach(card => {
      if (!seenSuits.has(card.suit) && uniqueSuitGroup.length < 4) {
        seenSuits.add(card.suit); uniqueSuitGroup.push(card);
      }
    });
    if (uniqueSuitGroup.length >= 3) {
      groups.push(uniqueSuitGroup.map(({ _i, ...r }) => r));
      uniqueSuitGroup.forEach(c => usedIdx.add(c._i));
    }
  });
  return groups;
}

function chooseBotDiscard(hand) {
  if (!hand.length) return null;
  const groups = autoSplitIntoGroups([...hand]);
  const groupedIds = new Set(groups.flat().map(c => c.id));
  const unmatched = hand.filter(c => !groupedIds.has(c.id));
  if (unmatched.length > 0) return unmatched.sort((a, b) => getCardPoints(b.value) - getCardPoints(a.value))[0];
  if (groups.length > 0) {
    groups.sort((a, b) => a.length - b.length);
    return [...groups[0]].sort((a, b) => getCardPoints(b.value) - getCardPoints(a.value))[0];
  }
  return hand[hand.length - 1];
}

function isCardMeelGale(card, openedSets) {
  if (!openedSets || !openedSets.length) return false;
  for (const set of openedSets) {
    if (!set || !set.length) continue;
    const isSameSuit = set.every(c => c.suit === card.suit);
    if (isSameSuit) {
      const values = set.map(c => getCardValue(c)).sort((a, b) => a - b);
      const cardVal = getCardValue(card);
      if (cardVal === values[0] - 1 || cardVal === values[values.length - 1] + 1) return true;
    }
    const isSameValue = set.every(c => c.value === card.value);
    if (isSameValue) {
      const hasSuit = set.some(c => c.suit === card.suit);
      if (!hasSuit && set.length < 4) return true;
    }
  }
  return false;
}

function resetPlayerState(p) {
  p.hand = []; p.isOpened = false; p.hasActioned = false;
  p.pickedFromDiscard = false; p.openedSets = []; p.hoosgale = false; p.tempScore = 0;
}

function updateRoomPlayers(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const active = room.players[room.activePlayerIndex];
  io.to(roomId).emit('playersUpdate', {
    players: room.players.map(p => ({
      id: p.id, name: p.name, cardCount: p.hand.length,
      isOpened: p.isOpened, online: p.online, points: p.points, isBot: p.isBot, hoosgale: p.hoosgale,
    })),
    stockCount: room.stockPile.length,
    currentTurnId: active ? active.id : null,
    turnStartTime: room.turnStartTime,
  });
  room.players.forEach((player, index) => {
    if (player.isBot) return;
    const n = room.players.length;
    io.to(player.id).emit('updateOpponents', {
      left:  (() => { const p = room.players[(index + 1) % n]; return p && p.id !== player.id ? { name: p.name } : null; })(),
      top:   (() => { const p = room.players[(index + 2) % n]; return p && p.id !== player.id ? { name: p.name } : null; })(),
      right: (() => { const p = room.players[(index + 3) % n]; return p && p.id !== player.id ? { name: p.name } : null; })(),
    });
  });
}

function broadcastTableUI(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('updateTableUI', {
    players: room.players.map(p => ({ id: p.id, name: p.name, isOpened: p.isOpened, openedSets: p.openedSets })),
    nextRequiredPoints: room.lastOpenPoints,
  });
}

function endGame(roomId, winner) {
  const room = rooms[roomId];
  if (!room) return;
  room.gameStarted = false;
  if (room.turnTimeout) clearTimeout(room.turnTimeout);
  room.players.forEach(pl => { if (pl.hoosgale) pl.points += 1; });
  io.to(roomId).emit('gameOver', {
    winnerId: winner.id, winnerName: winner.name, providerId: room.lastProviderId,
    allPlayers: room.players.map(pl => ({ id: pl.id, name: pl.name, isOpened: pl.isOpened, hand: pl.hand, points: pl.points, isBot: pl.isBot })),
  });
  setTimeout(() => { if (rooms[roomId]) { io.in(roomId).socketsLeave(roomId); delete rooms[roomId]; } }, 8000);
}

function moveToNextPlayer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.isPaused = false;
  room.turnToken = (room.turnToken || 0) + 1;
  if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
  room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
  let safety = 0;
  while (safety < room.players.length) {
    const cur = room.players[room.activePlayerIndex];
    if (cur && (cur.online || cur.isBot) && !cur.hoosgale) break;
    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    safety++;
  }
  const next = room.players[room.activePlayerIndex];
  room.players.forEach(p => { p.hasActioned = false; p.pickedFromDiscard = false; });
  startTurnTimer(roomId);
  io.to(roomId).emit('playersUpdate', {
    players: room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.hand.length, isOpened: p.isOpened, online: p.online, points: p.points, hoosgale: p.hoosgale, isBot: p.isBot })),
    stockCount: room.stockPile.length,
    currentTurnId: next ? next.id : null,
    turnStartTime: room.turnStartTime,
  });
  if (next && !next.isBot) io.to(next.id).emit('yourTurn');
}

function scheduleBotTurn(roomId, botId) {
  const room = rooms[roomId];
  if (!room || !room.gameStarted) return;
  const thinkTime = 1200 + Math.floor(Math.random() * 800);
  const myToken = room.turnToken;
  room.turnTimeout = setTimeout(() => {
    if (!rooms[roomId] || rooms[roomId].turnToken !== myToken) return;
    doBotTurn(roomId, botId);
  }, thinkTime);
}

function refillStockIfEmpty(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.stockPile.length === 0 && room.discardPile.length > 1) {
    const top = room.discardPile.pop();
    room.stockPile = shuffle([...room.discardPile]);
    room.discardPile = [top];
    io.to(roomId).emit('updateStockCount', room.stockPile.length);
  }
}

function doBotTurn(roomId, botId) {
  const room = rooms[roomId];
  if (!room || !room.gameStarted) return;
  const botIdx = room.players.findIndex(p => p.id === botId);
  if (botIdx === -1 || botIdx !== room.activePlayerIndex) return;
  const bot = room.players[botIdx];
  if (!bot || !bot.isBot) return;

  refillStockIfEmpty(roomId);

  let drewFromDiscard = false;
  if (room.discardPile.length > 0 && !bot.isOpened) {
    const topDiscard = room.discardPile[room.discardPile.length - 1];
    const testHand = [...bot.hand, topDiscard];
    const testGroups = autoSplitIntoGroups(testHand);
    const testScore = testGroups.flat().reduce((s, c) => s + getCardPoints(c.value), 0);
    if (testScore >= room.lastOpenPoints && testGroups.some(g => g.length >= 4)) {
      room.discardPile.pop();
      bot.hand.push(topDiscard);
      bot.hasActioned = true;
      bot.pickedFromDiscard = true;
      io.to(roomId).emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1] ?? null);
      drewFromDiscard = true;
    }
  }

  if (!drewFromDiscard && room.stockPile.length > 0) {
    const card = room.stockPile.pop();
    bot.hand.push(card);
    bot.hasActioned = true;
    io.to(roomId).emit('updateStockCount', room.stockPile.length);
  }

  updateRoomPlayers(roomId);

  setTimeout(() => {
    if (!room.gameStarted) return;
    const groups = autoSplitIntoGroups([...bot.hand]);
    const totalScore = groups.flat().reduce((s, c) => s + getCardPoints(c.value), 0);
    const hasFourPlus = groups.some(g => g.length >= 4);

    if (!bot.isOpened) {
      if (totalScore >= room.lastOpenPoints && hasFourPlus) {
        const removeIds = new Set(groups.flat().map(c => c.id));
        bot.hand = bot.hand.filter(c => !removeIds.has(c.id));
        bot.isOpened = true;
        bot.openedSets.push(...groups);
        room.lastOpenPoints = totalScore + 1;
        broadcastTableUI(roomId);
        updateRoomPlayers(roomId);
        io.to(roomId).emit('notification', `🤖 ${bot.name} ayaa furay! (${totalScore} dhibco)`);
      }
    } else {
      if (groups.length > 0) {
        const removeIds = new Set(groups.flat().map(c => c.id));
        bot.hand = bot.hand.filter(c => !removeIds.has(c.id));
        bot.openedSets.push(...groups);
        broadcastTableUI(roomId);
        updateRoomPlayers(roomId);
      }
    }

    setTimeout(() => {
      if (!room.gameStarted) return;
      if (bot.hand.length === 0) { endGame(roomId, bot); return; }
      const cardToDiscard = chooseBotDiscard(bot.hand);
      if (!cardToDiscard) { moveToNextPlayer(roomId); return; }
      const discardIdx = bot.hand.findIndex(c => c.id === cardToDiscard.id);
      if (discardIdx !== -1) bot.hand.splice(discardIdx, 1);
      room.discardPile.push(cardToDiscard);
      room.lastProviderId = bot.id;
      io.to(roomId).emit('updateDiscardPile', cardToDiscard);

      let botIsBatuuto = false;
      if (bot.isOpened && bot.hand.length === 2) {
        botIsBatuuto = true;
      }
      if (botIsBatuuto) {
        bot.hand = []; bot.isOpened = false; bot.openedSets = [];
        io.to(roomId).emit('notification', `🚨 Batuuto! Bot-ka ${bot.name} wuxuu galay Batuuto.`);
        updateRoomPlayers(roomId); broadcastTableUI(roomId);
      }

      if (bot.hand.length === 0) { endGame(roomId, bot); return; }
      if (bot.pickedFromDiscard && !bot.hoosgale && !bot.isOpened && !botIsBatuuto) {
        bot.hoosgale = true;
        room.stockPile = shuffle([...room.stockPile, ...bot.hand]);
        bot.hand = [];
        io.to(roomId).emit('notification', `⚠️ ${bot.name} HOOSGALE!`);
        updateRoomPlayers(roomId);
      }
      moveToNextPlayer(roomId);
    }, 700);
  }, 500);
}

function startTurnTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
  room.turnStartTime = Date.now();
  room.isPaused = false;
  const player = room.players[room.activePlayerIndex];
  if (player && !player.isBot) {
    room.turnToken = (room.turnToken || 0) + 1;
  }
  const myToken = room.turnToken;
  updateRoomPlayers(roomId);
  if (!player) return;
  player.hasActioned = player.hand.length >= 15;
  if (player.isBot) { scheduleBotTurn(roomId, player.id); return; }
  room.turnTimeout = setTimeout(() => {
    if (!rooms[roomId] || rooms[roomId].turnToken !== myToken) return;
    if (!room.gameStarted || room.isPaused) return;
    const cur = room.players[room.activePlayerIndex];
    if (!cur || cur.id !== player.id) return;
    if (cur.hasActioned && cur.hand.length <= 14) { moveToNextPlayer(roomId); return; }
    if (!cur.hasActioned && room.stockPile.length > 0) {
      const card = room.stockPile.pop();
      cur.hand.push(card);
      cur.hasActioned = true;
      io.to(cur.id).emit('receiveCard', card);
    }
    if (cur.hand.length > 14) {
      const discarded = cur.hand.pop();
      room.discardPile.push(discarded);
      io.to(roomId).emit('updateDiscardPile', discarded);
      io.to(cur.id).emit('autoDiscarded', discarded);
      io.to(cur.id).emit('updateHand', { hand: cur.hand });
    }
    moveToNextPlayer(roomId);
  }, TURN_TIME_LIMIT);
}

function startGame(roomId) {
  const room = rooms[roomId];
  if (!room || room.gameStarted) return;
  room.gameStarted = true;
  room.turnStartTime = Date.now();
  room.timerStarted = false;
  room.lastOpenPoints = 101;
  const gd = prepareGame(4);
  room.stockPile = gd.remainingDeck;
  room.players.forEach((p, i) => {
    resetPlayerState(p);
    p.hand = gd.allHands[i];
    if (i === 0) p.hasActioned = true;
    if (!p.isBot) io.to(p.id).emit('startHand', p.hand);
  });
  if (room.stockPile.length > 0) room.discardPile = [room.stockPile.pop()];
  const topDiscard = room.discardPile[room.discardPile.length - 1];
  const firstPlayer = room.players[0];
  room.players.forEach(p => {
    if (!p.isBot) io.to(p.id).emit('matchFound', { roomId, topDiscard, currentTurn: firstPlayer.id });
  });
  io.to(roomId).emit('updateStockCount', room.stockPile.length);
  broadcastTableUI(roomId);
  startTurnTimer(roomId);
  updateRoomPlayers(roomId);
}

function addBotsAndStartGame(roomId) {
  const room = rooms[roomId];
  if (!room || room.gameStarted || room._botsAdding) return;
  room._botsAdding = true;
  const botNames = ['JAAMAC', 'JIMCAALE', 'FAARAX'];
  const needed = 4 - room.players.length;
  for (let i = 0; i < needed; i++) {
    const botId = `bot_${Math.random().toString(36).slice(2, 9)}`;
    room.players.push({
      id: botId, name: botNames[i], hand: [], isOpened: false, hasActioned: false,
      pickedFromDiscard: false, openedSets: [], online: true, points: 0, tempScore: 0,
      isBot: true, hoosgale: false,
      sessionToken: null, disconnectedAt: null, // bots have no session
    });
    io.to(roomId).emit('waitingRoomUpdate', {
      players: room.players.map(p => ({ name: p.name, isBot: p.isBot })),
    });
  }
  setTimeout(() => { room._botsAdding = false; startGame(roomId); }, 1500);
}

// ─────────────────────────────────────────────────────────
//  SOCKET EVENTS
// ─────────────────────────────────────────────────────────
io.on('connection', socket => {
  let myRoomId = '';

  socket.on('animation_finished', () => {
    const room = rooms[myRoomId];
    if (room && !room.timerStarted) { startTurnTimer(myRoomId); room.timerStarted = true; }
  });

  socket.on('joinRandom', data => {
    const name          = typeof data === 'string' ? data : data.name;
    const incomingToken = typeof data === 'string' ? null : data.token;

    // ── FIX: reconnect only if token matches AND within 5-minute window
    for (const id in rooms) {
      const room = rooms[id];
      const existing = room.players.find(p => p.name === name && !p.online && !p.isBot);
      if (existing) {
        const tokenMatches = incomingToken && existing.sessionToken && incomingToken === existing.sessionToken;
        const isRecent     = existing.disconnectedAt !== null && (Date.now() - existing.disconnectedAt) < RECONNECT_WINDOW_MS;

        if (tokenMatches && isRecent) {
          // ── legitimate reconnect
          existing.id            = socket.id;
          existing.online        = true;
          existing.disconnectedAt = null;
          myRoomId = id;
          socket.join(id);
          socket.emit('sessionToken', existing.sessionToken); // re-confirm the token
          socket.emit('startHand', existing.hand);
          if (room.discardPile.length > 0)
            socket.emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1]);
          broadcastTableUI(id);
          const cur = room.players[room.activePlayerIndex];
          socket.emit('matchFound', {
            roomId: id,
            topDiscard: room.discardPile[room.discardPile.length - 1],
            currentTurn: cur ? cur.id : null,
          });
          updateRoomPlayers(id);
          socket.emit('notification', 'Waad ku soo laabtay!');
          if (room.gameStarted && cur && cur.isBot && !room.turnTimeout && !room.isPaused)
            scheduleBotTurn(id, cur.id);
          return;
        }
        // wrong token or expired → fall through to new player join below
      }
    }

    // ── new player join
    let rid = Object.keys(rooms).find(id => rooms[id].players.length < 4 && !rooms[id].gameStarted);
    if (!rid) {
      rid = 'Room_' + Math.random().toString(36).slice(2, 11);
      rooms[rid] = {
        id: rid, players: [], gameStarted: false, stockPile: [], discardPile: [],
        activePlayerIndex: 0, lastOpenPoints: 101, turnTimeout: null, turnStartTime: null,
        lastProviderId: null, botFillTimer: null, isPaused: false, pauseTimeLeft: 0,
        timerStarted: false, turnToken: 0,
      };
    }

    // ── FIX: generate session token for new player
    const sessionToken = genToken();
    const player = {
      id: socket.id,
      name: name || `User_${socket.id.slice(0, 4)}`,
      hand: [], isOpened: false, hasActioned: false, pickedFromDiscard: false,
      openedSets: [], online: true, points: 0, tempScore: 0, isBot: false, hoosgale: false,
      sessionToken,        // ← stored on the player
      disconnectedAt: null,
    };

    rooms[rid].players.push(player);
    socket.join(rid);
    myRoomId = rid;
    socket.emit('sessionToken', sessionToken); // ← sent to client

    const room = rooms[rid];
    io.to(rid).emit('waitingRoomUpdate', {
      players: room.players.map(p => ({ name: p.name, isBot: p.isBot })),
    });

    if (room.players.length === 4) {
      if (room.botFillTimer) { clearTimeout(room.botFillTimer); room.botFillTimer = null; }
      startGame(rid);
      return;
    }
    if (room.players.length === 1) {
      room.botFillTimer = setTimeout(() => {
        if (rooms[rid] && !rooms[rid].gameStarted && rooms[rid].players.length < 4) {
          io.to(rid).emit('notification', 'Ciyaartoy la heli waayo — Robotyada ayaa la keenay!');
          addBotsAndStartGame(rid);
        }
      }, 10000);
    }
  });

  socket.on('addBots', () => {
    let rid = myRoomId;
    if (!rid) {
      for (const id in rooms) {
        if (rooms[id].players.some(p => p.id === socket.id)) { rid = id; myRoomId = rid; break; }
      }
    }
    if (!rid) { socket.emit('notification', 'Qolka la heli waayo.'); return; }
    const room = rooms[rid];
    if (!room || room.gameStarted) return;
    if (room.botFillTimer) { clearTimeout(room.botFillTimer); room.botFillTimer = null; }
    addBotsAndStartGame(rid);
  });

  socket.on('updatePenaltyScore', data => {
    const room = rooms[myRoomId];
    if (!room) return;
    const p = room.players.find(pl => pl.id === data.playerId);
    if (p) { p.points += data.points; io.to(myRoomId).emit('scoreUpdated', { playerId: p.id, newTotal: p.points }); }
  });

  socket.on('drawCard', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id) { socket.emit('notification', 'Sug doorkaaga!'); return; }
    if (p.hand.length >= 15) { socket.emit('notification', 'Ma qaadan kartid kaar kale. Mid tuur marka hore!'); return; }
    if (p.hasActioned) { socket.emit('notification', 'Horey ayaad u qaadatay kaar.'); return; }
    refillStockIfEmpty(myRoomId);
    if (room.stockPile.length > 0) {
      const card = room.stockPile.pop();
      p.hand.push(card); p.hasActioned = true;
      socket.emit('receiveCard', card);
      io.to(myRoomId).emit('updateStockCount', room.stockPile.length);
      updateRoomPlayers(myRoomId);
    }
  });

  socket.on('pickDiscard', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id || p.hasActioned) return;
    if (room.discardPile.length > 0) {
      const card = room.discardPile.pop();
      p.hand.push(card); p.hasActioned = true; p.pickedFromDiscard = true;
      socket.emit('discardPickedSuccess', { card });
      socket.emit('updateHand', { hand: p.hand });
      broadcastTableUI(myRoomId);
      io.to(myRoomId).emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1] ?? null);
    }
  });

  socket.on('returnDiscardCard', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id || !p.pickedFromDiscard) return;
    const topDiscard = p.hand[p.hand.length - 1];
    if (!topDiscard) return;
    p.hand.pop();
    room.discardPile.push(topDiscard);
    p.hasActioned = false; p.pickedFromDiscard = false;
    socket.emit('updateHand', { hand: p.hand });
    io.to(myRoomId).emit('updateDiscardPile', topDiscard);
    socket.emit('discardReturnedSuccess');
  });

  socket.on('playCard', data => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const card = data.card || data;
    if (!card || !card.id) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id) { socket.emit('notification', 'Sug doorkaaga!'); return; }
    if (!p.hasActioned) { socket.emit('notification', 'Marka hore kaar qaado!'); return; }
    const idx = p.hand.findIndex(c => c.id === card.id);
    if (idx === -1) {
      if (p.hasActioned && p.hand.length <= 14) {
        if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
        room.turnToken = (room.turnToken || 0) + 1;
        moveToNextPlayer(myRoomId);
      }
      return;
    }
    const nextPlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    const nextPlayer = room.players[nextPlayerIndex];
    if (nextPlayer && nextPlayer.isOpened) {
      const allTableSets = [];
      room.players.forEach(pl => { if (pl.openedSets && pl.openedSets.length) allTableSets.push(...pl.openedSets); });
      if (isCardMeelGale(card, allTableSets)) {
        if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
        room.turnStartTime = Date.now();
        const myToken = room.turnToken;
        room.turnTimeout = setTimeout(() => {
          if (!rooms[myRoomId] || rooms[myRoomId].turnToken !== myToken) return;
          if (p.hand.length > 14) {
            const discarded = p.hand.pop();
            room.discardPile.push(discarded);
            io.to(myRoomId).emit('updateDiscardPile', discarded);
            socket.emit('autoDiscarded', discarded);
            socket.emit('updateHand', { hand: p.hand });
          }
          moveToNextPlayer(myRoomId);
        }, 10000);
        socket.emit('notification', '❌ Waa meel-gale! Waxaa laguu daray 10 ilbiriqsi oo dheeri ah.');
        return;
      }
    }
    if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
    room.turnToken = (room.turnToken || 0) + 1;
    room.lastProviderId = p.id;
    const discardedCard = p.hand.splice(idx, 1)[0];
    room.discardPile.push(discardedCard);
    io.to(myRoomId).emit('updateDiscardPile', discardedCard);
    socket.emit('updateHand', { hand: p.hand });
    if (p.hand.length === 0) { endGame(myRoomId, p); return; }
    if (p.pickedFromDiscard && !p.hoosgale && !p.isOpened) {
      p.hoosgale = true;
      room.stockPile = shuffle([...room.stockPile, ...p.hand]);
      p.hand = [];
      socket.emit('hoosgaleTriggered');
      io.to(myRoomId).emit('notification', `⚠️ ${p.name} HOOSGALE!`);
      updateRoomPlayers(myRoomId);
    }
    moveToNextPlayer(myRoomId);
  });

  socket.on('meldSets', data => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (!p) return;
    const removeIds = new Set(data.sets.flat().map(c => c.id));
    p.hand = p.hand.filter(c => !removeIds.has(c.id));
    p.isOpened = true;
    p.openedSets.push(...data.sets);
    if (data.totalScore !== undefined) room.lastOpenPoints = data.totalScore + 1;
    socket.emit('updateHand', { hand: p.hand });
    broadcastTableUI(myRoomId);
    updateRoomPlayers(myRoomId);
  });

  socket.on('addToExistingSets', data => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (!p || !p.isOpened) return;
    const removeIds = new Set(data.cards.map(c => c.id));
    p.hand = p.hand.filter(c => !removeIds.has(c.id));
    broadcastTableUI(myRoomId);
    updateRoomPlayers(myRoomId);
  });

  socket.on('resetMyOpenedCards', () => {
    const room = rooms[myRoomId];
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (!p || p.isOpened) return;
    p.openedSets = []; p.tempScore = 0;
    socket.emit('startHand', p.hand);
    broadcastTableUI(myRoomId);
  });

  socket.on('syncHandAfterMeld', hand => {
    const room = rooms[myRoomId];
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p) p.hand = hand;
  });

  socket.on('request_sync', () => {
    if (myRoomId && rooms[myRoomId]) {
      updateRoomPlayers(myRoomId);
      const room = rooms[myRoomId];
      if (room.discardPile.length > 0)
        socket.emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1]);
    }
  });

  socket.on('forceResetGame', () => {
    const room = rooms[myRoomId];
    if (!room) return;
    room.gameStarted = false; room.stockPile = []; room.discardPile = [];
    room.timerStarted = false; room.turnToken = 0;
    if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
    room.players.forEach(resetPlayerState);
    io.to(myRoomId).emit('notification', '⚠️ Ciyaartu dib ayay u bilaabanaysaa...');
    setTimeout(() => startGame(myRoomId), 2000);
  });

  socket.on('pauseTimer', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const cur = room.players[room.activePlayerIndex];
    if (!cur || cur.id !== socket.id) return;
    if (!room.isPaused) {
      const elapsed = Date.now() - (room.turnStartTime ?? Date.now());
      room.pauseTimeLeft = Math.max(5000, TURN_TIME_LIMIT - elapsed);
    }
    room.isPaused = true;
    if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
    io.to(myRoomId).emit('timerPaused', {
      activePlayerId: socket.id,
      message: `⏸️ ${cur.name} baa dalbaday in la sugo — Waqtiga waa la hakiyay!`,
    });
  });

  socket.on('resumeTimer', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted || !room.isPaused) return;
    const cur = room.players[room.activePlayerIndex];
    if (!cur || cur.id !== socket.id) return;
    room.isPaused = false;
    room.turnStartTime = Date.now() - (TURN_TIME_LIMIT - room.pauseTimeLeft);
    if (room.turnTimeout) clearTimeout(room.turnTimeout);
    const token = room.turnToken;
    room.turnTimeout = setTimeout(() => {
      if (!room.isPaused && room.gameStarted && rooms[myRoomId]?.turnToken === token) moveToNextPlayer(myRoomId);
    }, room.pauseTimeLeft);
    io.to(myRoomId).emit('timerResumed');
  });

  socket.on('ping_keep_alive', () => socket.emit('pong_alive'));

  // Player deliberately clicked "Ka bax" — remove permanently so no ghost slot remains
  socket.on('leaveGame', () => {
    const room = rooms[myRoomId];
    if (!room) return;
    if (!room.gameStarted) {
      room.players = room.players.filter(p => p.id !== socket.id);
    } else {
      const pidx = room.players.findIndex(p => p.id === socket.id);
      if (pidx !== -1) {
        const botNames = ['JAAMAC', 'JIMCAALE', 'FAARAX', 'HASSAN'];
        const usedNames = room.players.map(p => p.name);
        const botName = botNames.find(n => !usedNames.includes(n)) ?? `BOT_${Math.random().toString(36).slice(2, 6)}`;
        const leaving = room.players[pidx];
        leaving.isBot = true;
        leaving.name = botName;
        leaving.online = true;
        leaving.sessionToken = null;
        leaving.disconnectedAt = null;
        updateRoomPlayers(myRoomId);
        if (room.activePlayerIndex === pidx) {
          if (room.turnTimeout) clearTimeout(room.turnTimeout);
          scheduleBotTurn(myRoomId, leaving.id);
        }
      }
    }
    socket.leave(myRoomId);
    myRoomId = '';
  });

  socket.on('disconnect', () => {
    const room = rooms[myRoomId];
    if (!room) return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx === -1) return;
    const player = room.players[pidx];
    if (!room.gameStarted) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.botFillTimer && room.players.length === 0) { clearTimeout(room.botFillTimer); room.botFillTimer = null; }
    } else {
      player.online        = false;
      player.disconnectedAt = Date.now(); // ── FIX: timestamp for 5-min window check
      if (room.activePlayerIndex === pidx) {
        if (room.turnTimeout) clearTimeout(room.turnTimeout);
        moveToNextPlayer(myRoomId);
      }
    }
    const online = room.players.filter(p => p.online || p.isBot).length;
    if (online === 0) {
      if (room.turnTimeout) clearTimeout(room.turnTimeout);
      delete rooms[myRoomId];
    } else {
      updateRoomPlayers(myRoomId);
    }
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
