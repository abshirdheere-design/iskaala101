const http = require('http');
const path = require('path');
const express = require('express');
const { Server: SocketServer } = require('socket.io');

// ===================== HELPERS =====================

function getCardPoints(value) {
  if (['J','Q','K'].includes(value)) return 10;
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
  const suits = ['♦','♥','♠','♣'];
  const values = ['6','7','8','9','10','J','Q','K','A'];
  const deck = [];
  for (let i = 0; i < 4; i++) {
    for (const s of suits) {
      for (const v of values) {
        deck.push({ suit: s, value: v, id: `${s}-${v}-${i}-${Math.random().toString(36).substr(2,5)}`, points: getCardPoints(v) });
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

function refillStockIfEmpty(roomId, rooms, io) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.stockPile.length === 0 && room.discardPile.length > 1) {
    const top = room.discardPile.pop();
    room.stockPile = shuffle([...room.discardPile]);
    room.discardPile = [top];
    io.to(roomId).emit('updateStockCount', room.stockPile.length);
  }
}

// ===================== BOT AI =====================

function serverGetCardValue(card) {
  const map = { A:14, K:13, Q:12, J:11 };
  return map[card.value.toUpperCase()] ?? parseInt(card.value);
}

function serverAutoSplitIntoGroups(cards) {
  const groups = [];
  const usedIdx = new Set();
  const temp = cards.map((c, i) => ({ ...c, _i: i }));

  ['♠','♥','♣','♦'].forEach(suit => {
    const sc = temp.filter(c => c.suit === suit && !usedIdx.has(c._i));
    sc.sort((a, b) => serverGetCardValue(a) - serverGetCardValue(b));
    let run = [];
    for (let i = 0; i < sc.length; i++) {
      if (!run.length || serverGetCardValue(sc[i]) === serverGetCardValue(run[run.length-1]) + 1) {
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
    if (vc.length >= 3) { groups.push(vc.map(({ _i, ...r }) => r)); vc.forEach(c => usedIdx.add(c._i)); }
  });
  return groups;
}

function chooseBotDiscard(hand) {
  if (!hand.length) return null;
  const groups = serverAutoSplitIntoGroups([...hand]);
  const groupedIds = new Set(groups.flat().map(c => c.id));
  const unmatched = hand.filter(c => !groupedIds.has(c.id));
  if (unmatched.length > 0) return unmatched.sort((a, b) => getCardPoints(b.value) - getCardPoints(a.value))[0];
  if (groups.length > 0) {
    groups.sort((a, b) => a.length - b.length);
    return [...groups[0]].sort((a, b) => getCardPoints(b.value) - getCardPoints(a.value))[0];
  }
  return hand[hand.length - 1];
}

// ===================== ROOMS =====================

const rooms = {};
const TURN_TIME_LIMIT = 30000;

function updateRoomPlayers(roomId, io) {
  const room = rooms[roomId];
  if (!room) return;
  const active = room.players[room.activePlayerIndex];
  io.to(roomId).emit('playersUpdate', {
    players: room.players.map(p => ({ id:p.id, name:p.name, cardCount:p.hand.length, isOpened:p.isOpened, online:p.online, points:p.points, isBot:p.isBot })),
    stockCount: room.stockPile.length,
    currentTurnId: active ? active.id : null,
    turnStartTime: room.turnStartTime,
  });
  room.players.forEach((player, index) => {
    if (player.isBot) return;
    const n = room.players.length;
    io.to(player.id).emit('updateOpponents', {
      left:  (() => { const p = room.players[(index+1)%n]; return p && p.id !== player.id ? { name:p.name } : null; })(),
      top:   (() => { const p = room.players[(index+2)%n]; return p && p.id !== player.id ? { name:p.name } : null; })(),
      right: (() => { const p = room.players[(index+3)%n]; return p && p.id !== player.id ? { name:p.name } : null; })(),
    });
  });
}

function broadcastTableUI(roomId, io) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('updateTableUI', {
    players: room.players.map(p => ({ id:p.id, name:p.name, isOpened:p.isOpened, openedSets:p.openedSets })),
    nextRequiredPoints: room.lastOpenPoints,
  });
}

function endGame(roomId, winner, io) {
  const room = rooms[roomId];
  if (!room) return;
  room.gameStarted = false;
  if (room.turnTimeout) clearTimeout(room.turnTimeout);
  room.players.forEach(pl => { if (pl.hoosgale) pl.points += 1; });
  io.to(roomId).emit('gameOver', {
    winnerId: winner.id,
    winnerName: winner.name,
    providerId: room.lastProviderId,
    allPlayers: room.players.map(pl => ({ id:pl.id, name:pl.name, isOpened:pl.isOpened, hand:pl.hand, points:pl.points, isBot:pl.isBot })),
  });
}

function moveToNextPlayer(roomId, io) {
  const room = rooms[roomId];
  if (!room) return;
  room.isPaused = false;
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
  startTurnTimer(roomId, io);
  io.to(roomId).emit('playersUpdate', {
    players: room.players.map(p => ({ id:p.id, name:p.name, cardCount:p.hand.length, isOpened:p.isOpened, online:p.online, points:p.points, hoosgale:p.hoosgale, isBot:p.isBot })),
    stockCount: room.stockPile.length,
    currentTurnId: next ? next.id : null,
    turnStartTime: room.turnStartTime,
  });
  if (next && !next.isBot) io.to(next.id).emit('yourTurn');
}

// ===================== BOT TURN =====================

function scheduleBotTurn(roomId, botId, io) {
  const room = rooms[roomId];
  if (!room || !room.gameStarted) return;
  const thinkTime = 1500 + Math.floor(Math.random() * 1000);
  room.turnTimeout = setTimeout(() => doBotTurn(roomId, botId, io), thinkTime);
}

function doBotTurn(roomId, botId, io) {
  const room = rooms[roomId];
  if (!room || !room.gameStarted) return;
  const botIdx = room.players.findIndex(p => p.id === botId);
  if (botIdx === -1 || botIdx !== room.activePlayerIndex) return;
  const bot = room.players[botIdx];
  if (!bot || !bot.isBot) return;

  refillStockIfEmpty(roomId, rooms, io);

  let drewFromDiscard = false;
  if (room.discardPile.length > 0 && !bot.isOpened) {
    const topDiscard = room.discardPile[room.discardPile.length - 1];
    const testHand = [...bot.hand, topDiscard];
    const testGroups = serverAutoSplitIntoGroups(testHand);
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

  updateRoomPlayers(roomId, io);

  setTimeout(() => {
    if (!room.gameStarted) return;
    const groups = serverAutoSplitIntoGroups([...bot.hand]);
    const totalScore = groups.flat().reduce((s, c) => s + getCardPoints(c.value), 0);
    const hasFourPlus = groups.some(g => g.length >= 4);

    if (!bot.isOpened) {
      if (totalScore >= room.lastOpenPoints && hasFourPlus) {
        const removeIds = new Set(groups.flat().map(c => c.id));
        bot.hand = bot.hand.filter(c => !removeIds.has(c.id));
        bot.isOpened = true;
        bot.openedSets.push(...groups);
        room.lastOpenPoints = totalScore + 1;
        broadcastTableUI(roomId, io);
        updateRoomPlayers(roomId, io);
        io.to(roomId).emit('notification', `🤖 ${bot.name} ayaa furay! (${totalScore} dhibco)`);
      }
    } else {
      if (groups.length > 0) {
        const removeIds = new Set(groups.flat().map(c => c.id));
        bot.hand = bot.hand.filter(c => !removeIds.has(c.id));
        bot.openedSets.push(...groups);
        broadcastTableUI(roomId, io);
        updateRoomPlayers(roomId, io);
      }
    }

    setTimeout(() => {
      if (!room.gameStarted) return;
      if (bot.hand.length === 0) { endGame(roomId, bot, io); return; }
      const cardToDiscard = chooseBotDiscard(bot.hand);
      if (!cardToDiscard) { moveToNextPlayer(roomId, io); return; }
      const discardIdx = bot.hand.findIndex(c => c.id === cardToDiscard.id);
      if (discardIdx !== -1) bot.hand.splice(discardIdx, 1);
      room.discardPile.push(cardToDiscard);
      room.lastProviderId = bot.id;
      io.to(roomId).emit('updateDiscardPile', cardToDiscard);
      if (bot.hand.length === 0) { endGame(roomId, bot, io); return; }
      if (bot.pickedFromDiscard && !bot.hoosgale && !bot.isOpened) {
        bot.hoosgale = true;
        room.stockPile = shuffle([...room.stockPile, ...bot.hand]);
        bot.hand = [];
        io.to(roomId).emit('notification', `⚠️ ${bot.name} HOOSGALE! Kaarahooda waa laga qaaday.`);
        updateRoomPlayers(roomId, io);
      }
      moveToNextPlayer(roomId, io);
    }, 800);
  }, 600);
}

// ===================== TURN TIMER =====================

function startTurnTimer(roomId, io) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.turnTimeout) clearTimeout(room.turnTimeout);
  room.turnStartTime = Date.now();
  room.isPaused = false;
  updateRoomPlayers(roomId, io);

  const player = room.players[room.activePlayerIndex];
  if (!player) return;
  player.hasActioned = player.hand.length >= 15;

  if (player.isBot) { scheduleBotTurn(roomId, player.id, io); return; }

  room.turnTimeout = setTimeout(() => {
    if (!room.gameStarted || room.isPaused) return;
    const cur = room.players[room.activePlayerIndex];
    if (!cur) return;
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
    moveToNextPlayer(roomId, io);
  }, TURN_TIME_LIMIT);
}

// ===================== GAME START =====================

function startGame(roomId, io) {
  const room = rooms[roomId];
  if (!room || room.gameStarted) return;
  room.gameStarted = true;
  room.turnStartTime = Date.now();

  const gd = prepareGame(4);
  room.stockPile = gd.remainingDeck;
  room.players.forEach((p, i) => {
    p.hand = gd.allHands[i];
    if (i === 0) p.hasActioned = true;
    if (!p.isBot) io.to(p.id).emit('startHand', p.hand);
  });

  if (room.stockPile.length > 0) room.discardPile = [room.stockPile.pop()];
  const topDiscard = room.discardPile[room.discardPile.length - 1];
  const firstPlayer = room.players[0];
  room.players.forEach(p => {
    if (!p.isBot) {
      io.to(p.id).emit('matchFound', { roomId, topDiscard, currentTurn: firstPlayer.id });
    }
  });
  io.to(roomId).emit('updateStockCount', room.stockPile.length);
  startTurnTimer(roomId, io);
  updateRoomPlayers(roomId, io);
}

// ===================== ADD BOTS =====================

function addBotsAndStartGame(roomId, io) {
  const room = rooms[roomId];
  if (!room || room.gameStarted || room._botsAdding) return;
  room._botsAdding = true;
  const botNames = ['Jaamac-1','Jimcaale-2','Faarax-3'];
  const needed = 4 - room.players.length;
  for (let i = 0; i < needed; i++) {
    const botId = `bot_${Math.random().toString(36).slice(2,9)}`;
    room.players.push({
      id: botId, name: botNames[i], hand: [], isOpened: false,
      hasActioned: false, pickedFromDiscard: false, openedSets: [],
      online: true, points: 0, tempScore: 0, isBot: true, hoosgale: false,
    });
    io.to(roomId).emit('waitingRoomUpdate', { players: room.players.map(p => ({ name:p.name, isBot:p.isBot })) });
  }
  setTimeout(() => { room._botsAdding = false; startGame(roomId, io); }, 1500);
}

// ===================== EXPRESS + SOCKET.IO =====================

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const httpServer = http.createServer(app);
const io = new SocketServer(httpServer, {
  path: '/game-io',
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['polling','websocket'],
});

io.on('connection', socket => {
  let myRoomId = '';

  socket.on('animation_finished', () => {
    const room = rooms[myRoomId];
    if (room && !room.timerStarted) { startTurnTimer(myRoomId, io); room.timerStarted = true; }
  });

  socket.on('joinRandom', name => {
    for (const id in rooms) {
      const room = rooms[id];
      const existing = room.players.find(p => p.name === name && !p.online && !p.isBot);
      if (existing) {
        existing.id = socket.id; existing.online = true; myRoomId = id;
        socket.join(id);
        socket.emit('startHand', existing.hand);
        if (room.discardPile.length > 0) socket.emit('updateDiscardPile', room.discardPile[room.discardPile.length-1]);
        broadcastTableUI(id, io);
        const cur = room.players[room.activePlayerIndex];
        socket.emit('matchFound', { roomId:id, topDiscard:room.discardPile[room.discardPile.length-1], currentTurn: cur?cur.id:null });
        updateRoomPlayers(id, io);
        socket.emit('notification','Waad ku soo laabtay!');
        return;
      }
    }

    let rid = Object.keys(rooms).find(id => rooms[id].players.length < 4 && !rooms[id].gameStarted);
    if (!rid) {
      rid = 'Room_' + Math.random().toString(36).slice(2,11);
      rooms[rid] = { id:rid, players:[], gameStarted:false, stockPile:[], discardPile:[], activePlayerIndex:0,
        lastOpenPoints:101, turnTimeout:null, turnStartTime:null, lastProviderId:null,
        botFillTimer:null, isPaused:false, pauseTimeLeft:0, timerStarted:false };
    }

    const player = { id:socket.id, name:name||`User_${socket.id.slice(0,4)}`, hand:[], isOpened:false,
      hasActioned:false, pickedFromDiscard:false, openedSets:[], online:true, points:0, tempScore:0, isBot:false, hoosgale:false };

    rooms[rid].players.push(player);
    socket.join(rid); myRoomId = rid;
    const room = rooms[rid];
    io.to(rid).emit('waitingRoomUpdate', { players: room.players.map(p => ({ name:p.name, isBot:p.isBot })) });

    if (room.players.length === 4) {
      if (room.botFillTimer) { clearTimeout(room.botFillTimer); room.botFillTimer = null; }
      startGame(rid, io); return;
    }
    if (room.players.length === 1) {
      room.botFillTimer = setTimeout(() => {
        if (rooms[rid] && !rooms[rid].gameStarted && rooms[rid].players.length < 4) {
          io.to(rid).emit('notification','Ciyaartoy la heli waayo — Robotyada ayaa la keenay!');
          addBotsAndStartGame(rid, io);
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
    if (!rid) { socket.emit('notification','Qolka la heli waayo — dib u bilow ciyaarta.'); return; }
    const room = rooms[rid];
    if (!room || room.gameStarted) {
      const me = room?.players.find(p => p.id === socket.id);
      if (me && room && room.discardPile.length > 0) {
        const cur = room.players[room.activePlayerIndex];
        socket.emit('startHand', me.hand);
        socket.emit('matchFound', { roomId:rid, topDiscard:room.discardPile[room.discardPile.length-1], currentTurn:cur?cur.id:null });
      }
      return;
    }
    if (room.botFillTimer) { clearTimeout(room.botFillTimer); room.botFillTimer = null; }
    addBotsAndStartGame(rid, io);
  });

  socket.on('updatePenaltyScore', data => {
    const room = rooms[myRoomId];
    if (!room) return;
    const p = room.players.find(pl => pl.id === data.playerId);
    if (p) { p.points += data.points; io.to(myRoomId).emit('scoreUpdated', { playerId:p.id, newTotal:p.points }); }
  });

  socket.on('drawCard', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (p.id !== socket.id) return;
    if (p.hand.length >= 15) { socket.emit('notification','Ma qaadan kartid kaar kale. Mid tuur marka hore!'); return; }
    if (p.hasActioned) { socket.emit('notification','Horey ayaad u qaadatay kaar.'); return; }
    refillStockIfEmpty(myRoomId, rooms, io);
    if (room.stockPile.length > 0) {
      const card = room.stockPile.pop();
      p.hand.push(card); p.hasActioned = true;
      socket.emit('receiveCard', card);
      io.to(myRoomId).emit('updateStockCount', room.stockPile.length);
      updateRoomPlayers(myRoomId, io);
    }
  });

  socket.on('pickDiscard', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (p.id !== socket.id || p.hasActioned) return;
    if (room.discardPile.length > 0) {
      const card = room.discardPile.pop();
      p.hand.push(card); p.hasActioned = true; p.pickedFromDiscard = true;
      socket.emit('discardPickedSuccess', { card });
      socket.emit('updateHand', { hand: p.hand });
      broadcastTableUI(myRoomId, io);
      io.to(myRoomId).emit('updateDiscardPile', room.discardPile[room.discardPile.length-1] ?? null);
    }
  });

  socket.on('returnDiscardCard', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id || !p.pickedFromDiscard) return;
    const topDiscard = p.hand[p.hand.length - 1];
    if (!topDiscard) return;
    p.hand.pop(); room.discardPile.push(topDiscard);
    p.hasActioned = false; p.pickedFromDiscard = false;
    socket.emit('updateHand', { hand: p.hand });
    io.to(myRoomId).emit('updateDiscardPile', topDiscard);
    socket.emit('discardReturnedSuccess');
  });

  socket.on('playCard', card => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (p.id !== socket.id) return;
    const idx = p.hand.findIndex(c => c.id === card.id);
    if (idx === -1) return;
    room.lastProviderId = p.id;
    p.hand.splice(idx, 1); room.discardPile.push(card);
    io.to(myRoomId).emit('updateDiscardPile', card);
    socket.emit('updateHand', { hand: p.hand });
    if (p.hand.length === 0) { endGame(myRoomId, p, io); return; }
    if (p.pickedFromDiscard && !p.hoosgale && !p.isOpened) {
      p.hoosgale = true;
      room.stockPile = shuffle([...room.stockPile, ...p.hand]);
      p.hand = [];
      socket.emit('hoosgaleTriggered');
      io.to(myRoomId).emit('notification',`⚠️ ${p.name} HOOSGALE!`);
      updateRoomPlayers(myRoomId, io);
    }
    moveToNextPlayer(myRoomId, io);
  });

  socket.on('meldSets', data => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (!p) return;
    const removeIds = new Set(data.sets.flat().map(c => c.id));
    p.hand = p.hand.filter(c => !removeIds.has(c.id));
    p.isOpened = true; p.openedSets.push(...data.sets);
    if (data.totalScore !== undefined) room.lastOpenPoints = data.totalScore + 1;
    socket.emit('updateHand', { hand: p.hand });
    broadcastTableUI(myRoomId, io);
    updateRoomPlayers(myRoomId, io);
  });

  socket.on('resetMyOpenedCards', () => {
    const room = rooms[myRoomId];
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (!p || p.isOpened) return;
    p.openedSets = []; p.tempScore = 0;
    socket.emit('startHand', p.hand);
    broadcastTableUI(myRoomId, io);
  });

  socket.on('syncHandAfterMeld', hand => {
    const room = rooms[myRoomId];
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p) p.hand = hand;
  });

  socket.on('request_sync', () => {
    if (myRoomId && rooms[myRoomId]) {
      updateRoomPlayers(myRoomId, io);
      const room = rooms[myRoomId];
      if (room.discardPile.length > 0) socket.emit('updateDiscardPile', room.discardPile[room.discardPile.length-1]);
    }
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
    io.to(myRoomId).emit('timerPaused', { activePlayerId:socket.id, message:`⏸️ ${cur.name} baa dalbaday in la sugo — Waqtiga waa la hakiyay!` });
  });

  socket.on('resumeTimer', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted || !room.isPaused) return;
    const cur = room.players[room.activePlayerIndex];
    if (!cur || cur.id !== socket.id) return;
    room.isPaused = false;
    room.turnStartTime = Date.now() - (TURN_TIME_LIMIT - room.pauseTimeLeft);
    if (room.turnTimeout) clearTimeout(room.turnTimeout);
    room.turnTimeout = setTimeout(() => {
      if (!room.isPaused && room.gameStarted) moveToNextPlayer(myRoomId, io);
    }, room.pauseTimeLeft);
    io.to(myRoomId).emit('timerResumed');
  });

  socket.on('ping_keep_alive', () => socket.emit('pong_alive'));

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
      player.online = false;
      if (room.activePlayerIndex === pidx) { if (room.turnTimeout) clearTimeout(room.turnTimeout); moveToNextPlayer(myRoomId, io); }
    }
    const online = room.players.filter(p => p.online || p.isBot).length;
    if (online === 0) { if (room.turnTimeout) clearTimeout(room.turnTimeout); delete rooms[myRoomId]; }
    else updateRoomPlayers(myRoomId, io);
  });
});
