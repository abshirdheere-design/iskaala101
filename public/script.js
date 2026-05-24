let socket;
let myName = '';
let myHand = [];
let isMyTurn = false;
let hasDrawn = false;
let pickedFromDiscard = false;
let isOpened = false;
let iHaveOpened = false;
let myOpenedSets = [];
let temporaryScore = 0;
let currentMinToOpen = 101;
let discardTop = null;
let stockCount = 0;
let players = [];
let currentTurnId = null;
let opponents = { left: null, top: null, right: null };
let tablePlayers = [];
let myScore = 0;
let turnTimeLeft = 30;
let turnTimerInterval = null;
let dragStartIndex = null;
let waitingAutoTimer = null;
let waitingCountdown = 10;

const POINT_VALUES = { '6':6,'7':7,'8':8,'9':9,'10':10,'j':10,'q':10,'k':10,'a':11 };

function $(id) { return document.getElementById(id); }

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`${name}-screen`);
  if (el) el.classList.add('active');
}

let notifTimer = null;
function showNotification(msg, duration = 3000) {
  const el = $('notification');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(notifTimer);
  if (duration > 0) {
    notifTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }
}

function distributeAllCardsAnimated(myCards, opponentCounts, onDone) {
  const container = $('table-area');
  const handContainer = $('hand-cards');
  if (!container || !handContainer) return;
  handContainer.innerHTML = '';
  const positions = {
    top:   { x: 0,    y: -220 },
    left:  { x: -360, y: 0    },
    right: { x: 360,  y: 0    },
  };
  const total = myCards.length;
  const opNames = ['right', 'top', 'left'];
  let delay = 0;
  const step = 100;
  opNames.forEach(pos => {
    const count = opponentCounts[pos] || 14;
    const tx = positions[pos].x;
    const ty = positions[pos].y;
    for (let i = 0; i < count; i++) {
      const d = delay;
      setTimeout(() => {
        const flying = document.createElement('div');
        flying.className = 'card-deal';
        flying.style.setProperty('--targetX', `${tx}px`);
        flying.style.setProperty('--targetY', `${ty}px`);
        container.appendChild(flying);
        setTimeout(() => flying.remove(), 650);
      }, d);
      delay += step;
    }
  });
  myCards.forEach((card, index) => {
    const d = delay;
    setTimeout(() => {
      const flying = document.createElement('div');
      flying.className = 'card-deal';
      const targetX = -((total - 1) * 36) + (index * 72);
      flying.style.setProperty('--targetX', `${targetX}px`);
      flying.style.setProperty('--targetY', `260px`);
      container.appendChild(flying);
      setTimeout(() => {
        flying.remove();
        if (index === total - 1) {
          renderHand();
          socket.emit('animation_finished');
          if (onDone) onDone();
        }
      }, 650);
    }, d);
    delay += step;
  });
}

function startTurnTimer() {
  clearInterval(turnTimerInterval);
  turnTimeLeft = 30;
  renderHeader();
  turnTimerInterval = setInterval(() => {
    turnTimeLeft = Math.max(0, turnTimeLeft - 1);
    renderHeader();
    if (turnTimeLeft === 0) clearInterval(turnTimerInterval);
  }, 1000);
}

function getCardValue(card) {
  const map = { a:14, k:13, q:12, j:11 };
  const v = String(card.value).toLowerCase();
  return map[v] || parseInt(v);
}

function cardPoints(card) {
  return POINT_VALUES[String(card.value).toLowerCase()] || 0;
}

function autoSplitIntoGroups(cards) {
  const groups = [];
  const usedIdx = new Set();
  const temp = cards.map((c, i) => ({ ...c, _i: i }));
  ['♠','♥','♣','♦'].forEach(suit => {
    let sc = temp.filter(c => c.suit === suit && !usedIdx.has(c._i));
    sc.sort((a, b) => getCardValue(a) - getCardValue(b));
    let run = [];
    for (let i = 0; i < sc.length; i++) {
      if (!run.length || getCardValue(sc[i]) === getCardValue(run[run.length-1]) + 1) {
        run.push(sc[i]);
      } else {
        if (run.length >= 3) { groups.push(run.map(({_i,...r})=>r)); run.forEach(c=>usedIdx.add(c._i)); }
        run = [sc[i]];
      }
    }
    if (run.length >= 3) { groups.push(run.map(({_i,...r})=>r)); run.forEach(c=>usedIdx.add(c._i)); }
  });
  const remaining = temp.filter(c => !usedIdx.has(c._i));
  const vals = [...new Set(remaining.map(c => c.value))];
  vals.forEach(val => {
    const vc = remaining.filter(c => c.value === val && !usedIdx.has(c._i));
    if (vc.length >= 3) { groups.push(vc.map(({_i,...r})=>r)); vc.forEach(c=>usedIdx.add(c._i)); }
  });
  return groups;
}

function findValidGroups(cards) {
  const groups = autoSplitIntoGroups(cards);
  const usedIds = new Set(groups.flat().map(c => c.id));
  const remaining = cards.filter(c => !usedIds.has(c.id));
  return { validGroups: groups, remaining };
}

function applyFooroLogic(winnerId, providerId, allPlayers) {
  if (!allPlayers || !allPlayers.length) return null;
  const provIdx = allPlayers.findIndex(p => p.id === providerId);
  const startIdx = provIdx === -1 ? 0 : provIdx;
  for (let i = 0; i < allPlayers.length; i++) {
    const cur = allPlayers[(startIdx + i) % allPlayers.length];
    if (cur.id === winnerId) continue;
    if (!cur.isOpened) return cur;
  }
  let maxPts = -1, target = null;
  allPlayers.forEach(p => {
    if (p.id === winnerId) return;
    const pts = (p.hand || []).reduce((s, c) => s + (c.points || 0), 0);
    if (pts > maxPts) { maxPts = pts; target = p; }
  });
  return target;
}

function makeCard(card, size, opts = {}) {
  const el = document.createElement('div');
  const isRed = ['♥', '♦'].includes(card.suit);
  el.className = `card ${size}${opts.selected ? ' selected' : ''}${opts.overlap ? ' overlap' : ''}${isRed ? ' red-suit' : ' black-suit'}`;
  const cv = document.createElement('div');
  cv.className = 'cv';
  cv.textContent = card.value;
  const cs = document.createElement('div');
  cs.className = 'cs';
  cs.textContent = card.suit;
  const cvBot = document.createElement('div');
  cvBot.className = 'cv-bot';
  cvBot.textContent = card.value;
  el.appendChild(cv);
  el.appendChild(cs);
  el.appendChild(cvBot);
  return el;
}

function makeCardBack(size) {
  const el = document.createElement('div');
  el.className = `card-back-${size}`;
  return el;
}

function renderHeader() {
  const hdrName = $('hdr-name');
  const hdrScore = $('hdr-score');
  const turnEl = $('hdr-turn');
  if (!hdrName || !hdrScore || !turnEl) return;
  hdrName.textContent = myName;
  hdrScore.textContent = `Dhibco: ${myScore}`;
  if (isMyTurn) {
    turnEl.textContent = `DOORKAAGA (${turnTimeLeft}s)`;
    turnEl.className = 'hdr-turn-active';
  } else {
    turnEl.textContent = 'Sugaya...';
    turnEl.className = 'hdr-turn-idle';
  }
  const badge = $('hdr-opened-badge');
  if (badge) {
    if (isOpened) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
  }
  const btnPause = $('btn-pause');
  if (btnPause) {
    btnPause.style.display = isMyTurn ? 'inline-block' : 'none';
    if (pickedFromDiscard && !isOpened) {
      btnPause.textContent = 'Soo Celi';
      btnPause.style.background = '#f39c12';
    } else if (btnPause.dataset.paused === 'true') {
      btnPause.textContent = 'Fasax';
      btnPause.style.background = '#f39c12';
    } else {
      btnPause.textContent = 'Isuga';
      btnPause.style.background = '';
    }
  }
}

function renderHand() {
  const container = $('hand-cards');
  if (!container) return;
  container.innerHTML = '';
  myHand.forEach((card, idx) => {
    const el = makeCard(card, 'md', { selected: card.selected });
    el.addEventListener('click', () => toggleCard(idx));
    el.draggable = true;
    el.addEventListener('dragstart', () => { dragStartIndex = idx; });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', () => handleDrop(idx));
    container.appendChild(el);
  });
  const selScore = myHand.filter(c => c.selected).reduce((s, c) => s + cardPoints(c), 0);
  const selScoreEl = $('sel-score');
  if (selScoreEl) selScoreEl.textContent = selScore;
  const minOpenEl = $('min-open-label');
  if (minOpenEl) minOpenEl.textContent = `U baahan: ${currentMinToOpen}`;
  const btnDhigo = $('btn-dhigo');
  const btnTuur = $('btn-tuur');
  if (btnDhigo) btnDhigo.disabled = !isMyTurn;
  if (btnTuur) btnTuur.disabled = !isMyTurn;
}

function renderDiscardPile() {
  const el = $('discard-display');
  if (!el) return;
  el.innerHTML = '';
  if (discardTop) {
    const card = makeCard(discardTop, 'lg');
    el.className = '';
    el.appendChild(card);
  } else {
    el.className = 'discard-empty';
    el.textContent = 'Madhan';
  }
}

function renderStockPile() {
  const el = $('stock-count-label');
  if (el) el.textContent = stockCount;
}

function renderOpponentSlot(position, opponentName, count, active, opened, sets, isBot) {
  const badge = $(`badge-${position}`);
  const cardsEl = $(`cards-${position}`);
  if (!badge || !cardsEl) return;
  if (!opponentName) {
    badge.textContent = 'Sugaya...';
    badge.className = 'player-badge';
    cardsEl.innerHTML = '';
    return;
  }
  const botIcon = isBot ? ' 🤖' : '';
  badge.textContent = `${opponentName}${botIcon}${opened ? ' ✓' : ''} (${count})`;
  badge.className = active ? 'player-badge active' : 'player-badge';
  cardsEl.innerHTML = '';
  if (sets && sets.length > 0) {
    sets.forEach(set => {
      const setDiv = document.createElement('div');
      setDiv.className = 'opened-set';
      set.forEach((card, ci) => setDiv.appendChild(makeCard(card, 'sm', { overlap: ci > 0 })));
      cardsEl.appendChild(setDiv);
    });
  } else {
    for (let i = 0; i < count; i++) cardsEl.appendChild(makeCardBack('sm'));
  }
}

function getPlayerAtOffset(offset) {
  const myIdx = players.findIndex(p => p.id === socket.id);
  if (myIdx === -1) return null;
  return players[(myIdx + offset) % players.length] || null;
}

function getTableSetsAtOffset(offset) {
  const myIdx = tablePlayers.findIndex(p => p.id === socket.id);
  if (myIdx === -1) return [];
  return tablePlayers[(myIdx + offset) % tablePlayers.length]?.openedSets || [];
}

function renderOpponents() {
  const offsets = { left: 3, top: 2, right: 1 };
  ['left', 'top', 'right'].forEach(pos => {
    const p = getPlayerAtOffset(offsets[pos]);
    const sets = getTableSetsAtOffset(offsets[pos]);
    renderOpponentSlot(
      pos,
      p ? p.name : (opponents[pos] ? opponents[pos].name : null),
      p ? p.cardCount : 0,
      p ? p.id === currentTurnId : false,
      p ? p.isOpened : false,
      sets,
      p ? p.isBot : false
    );
  });
}

function renderMyBadge() {
  const badge = $('my-name-badge');
  if (!badge) return;
  badge.textContent = myName + (isOpened ? ' ✓' : '') + ' (Adiga)';
  const amActive = currentTurnId === socket.id;
  badge.className = `my-name-badge bold ${amActive ? 'active' : 'gold'}`;
}

function renderMyTableSets() {
  const container = $('my-table-sets');
  if (!container) return;
  container.innerHTML = '';
  myOpenedSets.forEach(set => {
    const setDiv = document.createElement('div');
    setDiv.className = 'opened-set';
    set.forEach((card, ci) => setDiv.appendChild(makeCard(card, 'sm', { overlap: ci > 0 })));
    container.appendChild(setDiv);
  });
}

function renderAll() {
  renderHeader();
  renderHand();
  renderDiscardPile();
  renderStockPile();
  renderOpponents();
  renderMyBadge();
  renderMyTableSets();
}

function toggleCard(idx) {
  myHand[idx] = { ...myHand[idx], selected: !myHand[idx].selected };
  renderHand();
}

function handleDrop(targetIdx) {
  if (dragStartIndex === null || dragStartIndex === targetIdx) return;
  const moved = myHand.splice(dragStartIndex, 1)[0];
  myHand.splice(targetIdx, 0, moved);
  dragStartIndex = null;
  renderHand();
}

function handleSort() {
  const vOrder = { '6':6,'7':7,'8':8,'9':9,'10':10,'j':11,'q':12,'k':13,'a':14 };
  const sOrder = { '♠':4,'♥':3,'♦':2,'♣':1 };
  myHand.sort((a, b) => {
    const sA = sOrder[a.suit]||0, sB = sOrder[b.suit]||0;
    if (a.suit !== b.suit) return sB - sA;
    return (vOrder[a.value.toLowerCase()]||0) - (vOrder[b.value.toLowerCase()]||0);
  });
  myHand = myHand.map(c => ({ ...c, selected: false }));
  renderHand();
}

function handleDraw() {
  if (!isMyTurn) { showNotification('Sug doorkaaga!'); return; }
  if (hasDrawn) { showNotification('Horey ayaad u qaadatay kaar.'); return; }
  const drawEl = $('btn-draw');
  if (drawEl) {
    drawEl.classList.remove('card-pickup-anim');
    void drawEl.offsetWidth;
    drawEl.classList.add('card-pickup-anim');
    drawEl.addEventListener('animationend', () => drawEl.classList.remove('card-pickup-anim'), { once: true });
  }
  socket.emit('drawCard');
}

function handlePickDiscard() {
  if (!isMyTurn) { showNotification('Sug doorkaaga!'); return; }
  if (hasDrawn) { showNotification('Horey ayaad u qaadatay kaar.'); return; }
  if (!discardTop) { showNotification('Tuurista kuma jiraan kaar.'); return; }
  const discardEl = $('discard-display');
  if (discardEl) {
    discardEl.classList.remove('card-pickup-anim');
    void discardEl.offsetWidth;
    discardEl.classList.add('card-pickup-anim');
    discardEl.addEventListener('animationend', () => discardEl.classList.remove('card-pickup-anim'), { once: true });
  }
  socket.emit('pickDiscard');
}

function handleDhigo() {
  if (!isMyTurn) { showNotification('Sug doorkaaga!'); return; }
  const selected = myHand.filter(c => c.selected);
  if (selected.length < 3) { showNotification('Dooro ugu yaraan 3 kaar!'); return; }
  const { validGroups, remaining } = findValidGroups(selected);
  if (remaining.length > 0) { showNotification(`Kaarka ${remaining[0].value} ma geli karo koox!`); return; }
  const moveScore = selected.reduce((s, c) => s + cardPoints(c), 0);
  if (!isOpened) {
    const currentTotal = temporaryScore + moveScore;
    const allSetsSoFar = [...myOpenedSets, ...validGroups];
    const hasFourPlus = allSetsSoFar.some(g => g.length >= 4);
    if (currentTotal >= currentMinToOpen && hasFourPlus) {
      isOpened = true; iHaveOpened = true;
      myOpenedSets = allSetsSoFar;
      const selectedIds = new Set(selected.map(c => c.id));
      myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
      socket.emit('meldSets', { sets: allSetsSoFar, totalScore: currentTotal });
      socket.emit('syncHandAfterMeld', myHand);
      temporaryScore = 0;
      showNotification(`Waad degtay! ${currentTotal} dhibco. Qofka xiga: ${currentTotal + 1}`);
    } else {
      if (!hasFourPlus) {
        showNotification('Waxaad u baahan tahay ugu yaraan hal koox oo 4+ kaar ah!'); return;
      }
      if (currentTotal < currentMinToOpen) {
        showNotification(`Ma degi kartid! U baahan: ${currentMinToOpen} dhibco.`); return;
      }
      temporaryScore += moveScore;
      myOpenedSets = [...myOpenedSets, ...validGroups];
      const selectedIds = new Set(selected.map(c => c.id));
      myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
      socket.emit('syncHandAfterMeld', myHand);
      showNotification(`Wadarta: ${temporaryScore}. U baahan: ${currentMinToOpen}`);
    }
  } else {
    const selectedIds = new Set(selected.map(c => c.id));
    myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
    socket.emit('meldSets', { sets: validGroups, isAdditional: true });
    socket.emit('syncHandAfterMeld', myHand);
    myOpenedSets = [...myOpenedSets, ...validGroups];
  }
  renderAll();
}

function handleReset() {
  if (iHaveOpened || isOpened) { showNotification('Hore ayaad u degtay, kama noqon kartid!'); return; }
  if (!myOpenedSets.length) { showNotification('Ma jiraan kaarar aad dhigtay.'); return; }
  const back = myOpenedSets.flat().map(c => ({ ...c, selected: false }));
  myHand = [...myHand, ...back];
  myOpenedSets = []; temporaryScore = 0;
  socket.emit('resetMyOpenedCards');
  showNotification('Kaararkii waa lagu soo celiyay gacantaada.');
  renderAll();
}

function handleTuur() {
  if (!isMyTurn) { showNotification('Sug doorkaaga!'); return; }
  if (myHand.length === 14 && !hasDrawn) { showNotification('Fadlan marka hore kaar qaado!'); return; }
  if (pickedFromDiscard && !isOpened) {
    const score = myHand.filter(c => c.selected).reduce((s, c) => s + cardPoints(c), 0);
    if (score < 101) { showNotification('Maadaama aad tuurista qaadatay, waa inaad degtaa (101)!'); return; }
    else { showNotification("Fadlan marka hore riix 'Dhigo' si aad u degto!"); return; }
  }
  const selIdx = myHand.findIndex(c => c.selected);
  if (selIdx === -1) { showNotification('Dooro kaarka aad tuurayso!'); return; }
  const remaining = myHand.length - 1;
  if (remaining === 1 || remaining === 2) { showNotification('Xeerka Batuutada: Ma kuu hari karaan 1 ama 2 xabo!'); return; }
  const cardToPlay = myHand[selIdx];
  const discardEl = $('discard-display');
  if (discardEl) {
    discardEl.classList.remove('card-throw-anim');
    void discardEl.offsetWidth;
    discardEl.classList.add('card-throw-anim');
    discardEl.addEventListener('animationend', () => discardEl.classList.remove('card-throw-anim'), { once: true });
  }
  socket.emit('playCard', cardToPlay);
  myHand.splice(selIdx, 1);
  isMyTurn = false; hasDrawn = false; pickedFromDiscard = false;
  clearInterval(turnTimerInterval);
  renderAll();
}

// ===================== WAITING ROOM =====================

function startWaitingCountdown() {
  waitingCountdown = 10;
  const noteEl = $('waiting-auto-note');
  if (noteEl) noteEl.textContent = `(Robotyadu si toos ah ayay ku biiraan ${waitingCountdown}s)`;
  if (waitingAutoTimer) clearInterval(waitingAutoTimer);
  waitingAutoTimer = setInterval(() => {
    waitingCountdown--;
    if (noteEl) noteEl.textContent = `(Robotyadu si toos ah ayay ku biiraan ${waitingCountdown}s)`;
    if (waitingCountdown <= 0) {
      clearInterval(waitingAutoTimer);
      waitingAutoTimer = null;
      if (noteEl) noteEl.textContent = 'Robotyada la keenayaa...';
    }
  }, 1000);
}

function stopWaitingCountdown() {
  if (waitingAutoTimer) { clearInterval(waitingAutoTimer); waitingAutoTimer = null; }
  const noteEl = $('waiting-auto-note');
  if (noteEl) noteEl.textContent = '';
}

function renderWaitingRoom(plist) {
  const countEl = $('waiting-count');
  if (countEl) countEl.textContent = `Raadinaya... (${plist.length}/4)`;
  const list = $('waiting-list');
  if (!list) return;
  list.innerHTML = '';
  plist.forEach(p => {
    const row = document.createElement('div');
    row.className = p.isBot ? 'waiting-player waiting-bot' : 'waiting-player';
    row.innerHTML = p.isBot
      ? `<span class="dot">🤖</span><span class="pname">${p.name}</span><span class="ready bot-label">Robot</span>`
      : `<span class="dot">●</span><span class="pname">${p.name}</span><span class="ready">Diyaar</span>`;
    list.appendChild(row);
  });
  for (let i = plist.length; i < 4; i++) {
    const row = document.createElement('div');
    row.className = 'waiting-empty';
    row.innerHTML = `<span style="animation:pulse 1s infinite;color:#555">●</span><span>Sugaya...</span>`;
    list.appendChild(row);
  }
  if (plist.length >= 4) stopWaitingCountdown();
}

function joinGame() {
  const nameInput = $('name-input');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { showNotification('Fadlan geli magacaaga!'); return; }
  myName = name;
  showScreen('waiting');
  renderWaitingRoom([]);
  socket.emit('joinRandom', name);
  startWaitingCountdown();
  setTimeout(() => {
    typeWriter('waiting-typewriter', `${name}, soo dhowoow! Dulqaado fadlan inta ay ciyaartooyda kale ku soo biirayaan...`, 48);
  }, 300);
}

function typeWriter(elementId, text, speed = 45) {
  const el = $(elementId);
  if (!el) return;
  el.textContent = '';
  let i = 0;
  function type() {
    if (i < text.length) { el.textContent += text.charAt(i); i++; setTimeout(type, speed); }
  }
  type();
}

function showReconnectOverlay(msg) {
  const overlay = $('reconnect-overlay');
  const msgEl = $('reconnect-msg');
  if (overlay) overlay.classList.remove('hidden');
  if (msgEl) msgEl.textContent = msg || 'Dib u xidh...';
}

function hideReconnectOverlay() {
  const overlay = $('reconnect-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function initSocket() {
  socket = io({ path: '/game-io', transports: ['polling', 'websocket'] });
  socket.on('disconnect', () => showReconnectOverlay('Xiriirka waa go\'ay — Dib u xidh...'));
  socket.on('connect', () => { hideReconnectOverlay(); if (myName) socket.emit('request_sync'); });
  socket.on('connect_error', () => showReconnectOverlay('Serverka lama gaari karo — Sugaya...'));

  socket.on('waitingRoomUpdate', data => {
    renderWaitingRoom(data.players);
  });

  socket.on('startHand', hand => {
    stopWaitingCountdown();
    myHand = hand.map(c => ({ ...c, selected: false }));
    showScreen('game');
    renderHeader(); renderDiscardPile(); renderStockPile(); renderMyBadge(); renderMyTableSets();
    ['left', 'top', 'right'].forEach(pos => {
      const cardsEl = $(`cards-${pos}`);
      if (cardsEl) cardsEl.innerHTML = '';
    });
    const opponentCounts = { left: 14, top: 14, right: 14 };
    setTimeout(() => distributeAllCardsAnimated(myHand, opponentCounts, () => renderOpponents()), 150);
  });

  socket.on('matchFound', data => {
    stopWaitingCountdown();
    discardTop = data.topDiscard; currentTurnId = data.currentTurn;
    showScreen('game'); renderAll();
  });

  socket.on('playersUpdate', data => {
    players = data.players;
    stockCount = data.stockCount;
    currentTurnId = data.currentTurnId;
    const wasMyTurn = isMyTurn;
    isMyTurn = data.currentTurnId === socket.id;
    if (isMyTurn && !wasMyTurn) {
      startTurnTimer();
      showNotification('DOORKAAGA! Kaar qaado ama tuurista ka qaado.', 2500);
    }
    const me = players.find(p => p.id === socket.id);
    if (me) myScore = me.points || 0;
    renderAll();
  });

  socket.on('yourTurn', () => {
    isMyTurn = true; startTurnTimer();
    showNotification('DOORKAAGA!', 2000); renderAll();
  });

  socket.on('updateDiscardPile', card => { discardTop = card; renderDiscardPile(); });
  socket.on('updateStockCount', count => { stockCount = count; renderStockPile(); });

  socket.on('receiveCard', card => {
    myHand.push({ ...card, selected: false }); hasDrawn = true; renderHand();
  });

  socket.on('updateHand', data => {
    myHand = data.hand.map(c => ({ ...c, selected: false })); renderHand();
  });

  socket.on('discardPickedSuccess', data => {
    pickedFromDiscard = true; hasDrawn = true;
    showNotification(`${data.card.value}${data.card.suit} tuuristii ayaad ka qaadatay`, 2000);
    renderHeader();
  });

  socket.on('discardReturnedSuccess', () => {
    pickedFromDiscard = false;
    hasDrawn = false;
    showNotification('Kaarkii tuurista ayaad ku soo celisay. Hadda kaar qaado ama tuurista ka qaado.', 3000);
    renderAll();
  });

  socket.on('autoDiscarded', card => {
    showNotification(`Waqtigii dhamaday — ${card.value}${card.suit} ayaa si toos ah loo tuuray`, 3000);
  });

  socket.on('updateTableUI', data => {
    tablePlayers = data.players; currentMinToOpen = data.nextRequiredPoints;
    renderOpponents(); renderMyTableSets(); renderHand();
  });

  socket.on('updateOpponents', data => { opponents = data; renderOpponents(); });

  socket.on('scoreUpdated', data => {
    if (data.playerId === socket.id) { myScore = data.newTotal; renderHeader(); }
  });

  socket.on('gameOver', data => {
    clearInterval(turnTimerInterval);
    if (data.winnerId === socket.id) {
      const fooroTarget = applyFooroLogic(data.winnerId, data.providerId, data.allPlayers);
      if (fooroTarget && !fooroTarget.isBot) {
        socket.emit('updatePenaltyScore', { playerId: fooroTarget.id, points: 101 });
        showNotification(`FOORO! ${fooroTarget.name} ayaa 101 dhibco helay!`, 6000);
      }
    }
    const modal = $('gameover-modal');
    if (modal) modal.classList.remove('hidden');
    if (data.winnerId === socket.id) {
      const icon = $('modal-icon'); if (icon) icon.textContent = '🏆';
      const title = $('modal-title'); if (title) title.textContent = 'WAAD GUULEYSATAY!';
      const body = $('modal-body'); if (body) body.textContent = `Hambalyo, ${myName}!`;
    } else {
      const winnerIsBot = data.allPlayers && data.allPlayers.find(p => p.id === data.winnerId && p.isBot);
      const icon = $('modal-icon'); if (icon) icon.textContent = winnerIsBot ? '🤖' : '🃏';
      const title = $('modal-title'); if (title) title.textContent = 'CIYAARTU WAA DHAMMAATAY';
      const body = $('modal-body'); if (body) body.innerHTML = `<span style="color:#2ecc71;font-weight:700">${data.winnerName}</span> ayaa guuleystay!`;
    }
  });

  socket.on('hoosgaleTriggered', () => {
    showNotification('HOOSGALE! Kaarahaagii waa laga qaaday.', 5000);
    myHand = []; isOpened = false; iHaveOpened = false; myOpenedSets = [];
    renderAll();
  });

  socket.on('notification', msg => showNotification(msg));

  socket.on('timerPaused', data => {
    clearInterval(turnTimerInterval);
    showNotification(data.message, 6000);
    const btn = $('btn-pause');
    if (btn && data.activePlayerId === socket.id) {
      btn.textContent = 'Fasax';
      btn.dataset.paused = 'true';
      btn.style.background = '#f39c12';
    }
  });

  socket.on('timerResumed', () => {
    showNotification('Waqtiga dib ayuu bilaabmay!', 2000);
    const btn = $('btn-pause');
    if (btn) {
      btn.textContent = 'Isuga';
      btn.dataset.paused = 'false';
      btn.style.background = '';
    }
    if (isMyTurn) startTurnTimer();
  });

  setInterval(() => socket.emit('ping_keep_alive'), 25000);
}



document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && socket) socket.emit('request_sync');
});

document.addEventListener('DOMContentLoaded', () => {
  const joinBtn = $('join-btn');
  if (joinBtn) joinBtn.addEventListener('click', joinGame);

  const nameInput = $('name-input');
  if (nameInput) nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });

  const btnDraw = $('btn-draw');
  if (btnDraw) btnDraw.addEventListener('click', handleDraw);

  const btnPickDiscard = $('btn-pick-discard');
  if (btnPickDiscard) btnPickDiscard.addEventListener('click', handlePickDiscard);

  const btnDhigo = $('btn-dhigo');
  if (btnDhigo) btnDhigo.addEventListener('click', handleDhigo);

  const btnReset = $('btn-reset');
  if (btnReset) btnReset.addEventListener('click', handleReset);

  const btnSort = $('btn-sort');
  if (btnSort) btnSort.addEventListener('click', handleSort);

  const btnTuur = $('btn-tuur');
  if (btnTuur) btnTuur.addEventListener('click', handleTuur);

  const btnAddBots = $('btn-add-bots');
  if (btnAddBots) {
    btnAddBots.addEventListener('click', () => {
      if (!socket) return;
      btnAddBots.disabled = true;
      btnAddBots.textContent = '🤖 Robotyada la keenayaa...';
      stopWaitingCountdown();
      socket.emit('addBots');
    });
  }

  const btnPause = $('btn-pause');
  if (btnPause) {
    btnPause.addEventListener('click', () => {
      if (!isMyTurn) return;
      if (pickedFromDiscard && !isOpened) {
        socket.emit('returnDiscardCard');
        return;
      }
      const isPaused = btnPause.dataset.paused === 'true';
      if (!isPaused) {
        socket.emit('pauseTimer');
        btnPause.textContent = 'Fasax';
        btnPause.dataset.paused = 'true';
        btnPause.style.background = '#f39c12';
        clearInterval(turnTimerInterval);
      } else {
        socket.emit('resumeTimer');
        btnPause.textContent = 'Isuga';
        btnPause.dataset.paused = 'false';
        btnPause.style.background = '';
      }
    });
  }

  try { initSocket(); } catch (err) { console.error('Socket init error:', err); }
});

const btnForceReset = $('btn-force-reset');
if (btnForceReset) {
  btnForceReset.addEventListener('click', () => {
    // Baadh qofka khalkhalka ka sameeyey miiska
    const qofkaQaldamay = players.find(p => p.name.includes("Jaamac"));
    
    if (qofkaQaldamay) {
      socket.emit('updatePenaltyScore', { playerId: qofkaQaldamay.id, points: 101 });
      socket.emit('forceResetGame');
    } else {
      // Haddii aan la helin magac Jaamac ah, ciyaarta uun iska reset garee
      socket.emit('forceResetGame');
    }
  });
}
