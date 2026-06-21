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
let inGame = false;
let lastPickedDiscardId = null;

const SESSION_KEY = 't101_token';

const POINT_VALUES = { 
  '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 
  'j': 10, 'q': 10, 'k': 10, 'a': 11,
  'J': 10, 'Q': 10, 'K': 10, 'A': 11 
};

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
  const positions = { top: { x: 0, y: -220 }, left: { x: -360, y: 0 }, right: { x: 360, y: 0 } };
  const total = myCards.length;
  const opNames = ['right', 'top', 'left'];
  let delay = 0;
  const step = 100;
  
  opNames.forEach(pos => {
    const count = opponentCounts[pos] || 14;
    const tx = positions[pos].x, ty = positions[pos].y;
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
      flying.style.setProperty('--targetY', '260px');
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
  const map = { a: 14, k: 13, q: 12, j: 11, A: 14, K: 13, Q: 12, J: 11 };
  const v = String(card.value);
  return map[v] || parseInt(v);
}

function cardPoints(card) {
  return POINT_VALUES[String(card.value)] || 0;
}

function autoSplitIntoGroups(cards) {
  const groups = [];
  const usedIdx = new Set();
  const temp = cards.map((c, i) => ({ ...c, _i: i }));
  
  ['♠', '♥', '♣', '♦'].forEach(suit => {
    let sc = temp.filter(c => c.suit === suit && !usedIdx.has(c._i));
    sc.sort((a, b) => getCardValue(a) - getCardValue(b));
    let run = [];
    for (let i = 0; i < sc.length; i++) {
      if (!run.length || getCardValue(sc[i]) === getCardValue(run[run.length - 1]) + 1) {
        run.push(sc[i]);
      } else {
        if (run.length >= 3) { 
          groups.push(run.map(({ _i, ...r }) => r)); 
          run.forEach(c => usedIdx.add(c._i)); 
        }
        run = [sc[i]];
      }
    }
    if (run.length >= 3) { 
      groups.push(run.map(({ _i, ...r }) => r)); 
      run.forEach(c => usedIdx.add(c._i)); 
    }
  });
  
  const remaining = temp.filter(c => !usedIdx.has(c._i));
  const vals = [...new Set(remaining.map(c => c.value))];
  vals.forEach(val => {
    const vc = remaining.filter(c => c.value === val && !usedIdx.has(c._i));
    const uniqueSuitGroup = [];
    const seenSuits = new Set();
    vc.forEach(card => {
      if (!seenSuits.has(card.suit) && uniqueSuitGroup.length < 4) {
        seenSuits.add(card.suit);
        uniqueSuitGroup.push(card);
      }
    });
    if (uniqueSuitGroup.length >= 3) {
      groups.push(uniqueSuitGroup.map(({ _i, ...r }) => r));
      uniqueSuitGroup.forEach(c => usedIdx.add(c._i));
    }
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
  const baddaClass = card.fromDiscard ? ' badda-card' : '';
  el.className = `card ${size}${opts.selected ? ' selected' : ''}${opts.overlap ? ' overlap' : ''}${isRed ? ' red-suit' : ' black-suit'}${baddaClass}`;
  
  const cv = document.createElement('div'); cv.className = 'cv'; cv.textContent = card.value;
  const cs = document.createElement('div'); cs.className = 'cs'; cs.textContent = card.suit;
  const cvBot = document.createElement('div'); cvBot.className = 'cv-bot'; cvBot.textContent = card.value;
  el.appendChild(cv); el.appendChild(cs); el.appendChild(cvBot);
  
  if (card.fromDiscard) {
    const badge = document.createElement('span');
    badge.innerText = '★';
    badge.style.cssText = 'position:absolute;top:-5px;right:2px;color:#ffcc00;font-size:14px;font-weight:bold;pointer-events:none;';
    el.appendChild(badge);
  }
  return el;
}

function makeCardBack(size) {
  const el = document.createElement('div');
  el.className = `card-back-${size}`;
  return el;
}

function renderHeader() {
  const hdrName = $('hdr-name'), hdrScore = $('hdr-score'), turnEl = $('hdr-turn');
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
  if (badge) { if (isOpened) badge.classList.remove('hidden'); else badge.classList.add('hidden'); }
  const btnPause = $('btn-pause');
  if (btnPause) {
    btnPause.style.display = isMyTurn ? 'inline-block' : 'none';
    if (pickedFromDiscard && !isOpened) {
      btnPause.textContent = 'Soo Celi'; btnPause.style.background = '#f39c12';
    } else if (btnPause.dataset.paused === 'true') {
      btnPause.textContent = 'Fasax'; btnPause.style.background = '#f39c12';
    } else {
      btnPause.textContent = 'Isuga'; btnPause.style.background = '';
    }
  }
}

function renderHand() {
  const container = $('hand-cards');
  if (!container) return;
  container.innerHTML = '';
  
  myHand.forEach((card, idx) => {
    const el = makeCard(card, 'md', { selected: card.selected });
    
    if (card.fromDiscard) {
      el.style.border = '3px solid #ffcc00';
      el.style.boxShadow = '0 0 12px #ffcc00';
      el.style.borderRadius = '8px';
    }
    
    el.addEventListener('click', () => toggleCard(idx));
    el.draggable = true;

    el.addEventListener('dragstart', (e) => {
      dragStartIndex = idx;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => el.style.opacity = '0.4', 0);
    });
    el.addEventListener('dragend', () => {
      el.style.opacity = '';
      dragStartIndex = null;
      // Nadiifi dhammaan drop highlights
      document.querySelectorAll('.opened-set').forEach(s => {
        s.classList.remove('drop-target', 'drop-invalid');
      });
    });

    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', () => handleDrop(idx));
    container.appendChild(el);
  });
  
  const selScore = myHand.filter(c => c.selected).reduce((s, c) => s + cardPoints(c), 0);
  const selScoreEl = $('sel-score');
  if (selScoreEl) selScoreEl.textContent = selScore;
  
  const minOpenEl = $('min-open-label');
  if (minOpenEl) {
    const shownMin = (!isOpened && pickedFromDiscard) ? currentMinToOpen : 101;
    minOpenEl.textContent = `U baahan: ${shownMin}`;
  }
  
  const btnDhigo = $('btn-dhigo'), btnTuur = $('btn-tuur');
  if (btnDhigo) btnDhigo.disabled = !isMyTurn;
  if (btnTuur) btnTuur.disabled = !isMyTurn;
}

// ── SAXITAANKA MUHIIMKA AH: canMeelGali ─────────────────────────────────────
// Hubinta inay kaartu koox geli karto (run ama group)
function canMeelGali(card, set) {
  if (!set || set.length < 3) return false;

  // RUN: isla suit, xariiq socota — card waxay kordhisaa horta ama dabada
  const allSameSuit = set.every(c => c.suit === card.suit);
  if (allSameSuit) {
    const vals = set.map(c => getCardValue(c)).sort((a, b) => a - b);
    const cv = getCardValue(card);
    if (cv === vals[0] - 1 || cv === vals[vals.length - 1] + 1) return true;
  }

  // GROUP: isla qiimo, suit kala duwan — card waxay noqon doontaa 4aad
  const allSameVal = set.every(c => c.value === card.value);
  const suitAlreadyIn = set.some(c => c.suit === card.suit);
  if (allSameVal && !suitAlreadyIn && set.length < 4) return true;

  return false;
}

// ── SAXITAANKA: makeDraggableSet ─────────────────────────────────────────────
// Function cusub oo door: abuurta set div, waxay ku dartaa listeners drag-and-drop
// si fiican oo bug la'aan ah.
function makeDraggableSet(set, setIdx, targetPlayerId) {
  const setDiv = document.createElement('div');
  setDiv.className = 'opened-set';

  set.forEach((card, ci) => setDiv.appendChild(makeCard(card, 'sm', { overlap: ci > 0 })));

  setDiv.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dragStartIndex === null) return;
    if (!isMyTurn || !isOpened) return;
    const draggedCard = myHand[dragStartIndex];
    if (!draggedCard) return;
    const valid = canMeelGali(draggedCard, set);
    setDiv.classList.toggle('drop-target', valid);
    setDiv.classList.toggle('drop-invalid', !valid);
    e.dataTransfer.dropEffect = valid ? 'move' : 'none';
  });

  setDiv.addEventListener('dragleave', () => {
    setDiv.classList.remove('drop-target', 'drop-invalid');
  });

  setDiv.addEventListener('drop', (e) => {
    e.preventDefault();
    setDiv.classList.remove('drop-target', 'drop-invalid');
    if (dragStartIndex === null) return;
    if (!isMyTurn || !isOpened) return;
    const draggedCard = myHand[dragStartIndex];
    if (!draggedCard) return;

    if (!canMeelGali(draggedCard, set)) {
      showNotification('❌ Kaartan meesha kuma fiicna!');
      setDiv.style.transition = 'transform 0.1s';
      let i = 0;
      const shake = setInterval(() => {
        setDiv.style.transform = i % 2 === 0 ? 'translateX(-5px)' : 'translateX(5px)';
        if (++i > 5) { clearInterval(shake); setDiv.style.transform = ''; }
      }, 60);
      dragStartIndex = null;
      return;
    }

    // Degdeg kaartu gacanta ka saar (optimistic) — server-ka kahor
    const cardIdx = dragStartIndex;
    dragStartIndex = null;
    myHand.splice(cardIdx, 1);
    myHand.forEach(c => { c.selected = false; });
    renderHand();

    // Server-ka u dir — isla event-ka handleDhigo isticmaala
    socket.emit('addToExistingSets', { cards: [draggedCard] });
    socket.emit('syncHandAfterMeld', myHand);
    showNotification('✅ Kaartu miiska ayay u gashay!', 1500);
  });

  return setDiv;
}

// ── renderMyTableSets ─────────────────────────────────────────────────────────
function renderMyTableSets() {
  const myContainer = $('my-table-sets');
  if (!myContainer) return;
  myContainer.innerHTML = '';
  myOpenedSets.forEach((set, setIdx) => {
    const setDiv = makeDraggableSet(set, setIdx, socket ? socket.id : '');
    myContainer.appendChild(setDiv);
  });
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

// ── renderOpponentSlot ────────────────────────────────────────────────────────
// SAXITAANKA: drag-and-drop drop listeners waxaa la isticmaalaa makeDraggableSet
// si khilaaf iyo dib-u-dhis walba la gaaro.
function renderOpponentSlot(position, opponentName, count, active, opened, sets, isBot, oppPlayerId) {
  const badge = $(`badge-${position}`), cardsEl = $(`cards-${position}`);
  if (!badge || !cardsEl) return;
  if (!opponentName) { badge.textContent = 'Sugaya...'; badge.className = 'player-badge'; cardsEl.innerHTML = ''; return; }
  const botIcon = isBot ? ' 🤖' : '';
  badge.textContent = `${opponentName}${botIcon}${opened ? ' ✓' : ''} (${count})`;
  badge.className = active ? 'player-badge active' : 'player-badge';
  cardsEl.innerHTML = '';
  if (sets && sets.length > 0) {
    sets.forEach((set, setIdx) => {
      const setDiv = makeDraggableSet(set, setIdx, oppPlayerId || '');
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

function getTablePlayerAtOffset(offset) {
  const myIdx = tablePlayers.findIndex(p => p.id === socket.id);
  if (myIdx === -1) return null;
  return tablePlayers[(myIdx + offset) % tablePlayers.length] || null;
}

function getTableSetsAtOffset(offset) {
  const tp = getTablePlayerAtOffset(offset);
  return tp ? (tp.openedSets || []) : [];
}

function renderOpponents() {
  const offsets = { left: 3, top: 2, right: 1 };
  ['left', 'top', 'right'].forEach(pos => {
    const p = getPlayerAtOffset(offsets[pos]);
    const tp = getTablePlayerAtOffset(offsets[pos]);
    const sets = tp ? (tp.openedSets || []) : [];
    renderOpponentSlot(
      pos,
      p ? p.name : (opponents[pos] ? opponents[pos].name : null),
      p ? p.cardCount : 0,
      p ? p.id === currentTurnId : false,
      p ? p.isOpened : false,
      sets,
      p ? p.isBot : false,
      tp ? tp.id : (p ? p.id : '')   // ← ID saxda ah oo drop-ka loo diro
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

function renderAll() {
  renderHeader(); renderHand(); renderDiscardPile();
  renderStockPile(); renderOpponents(); renderMyBadge(); renderMyTableSets();
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
  const vOrder = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'j': 11, 'q': 12, 'k': 13, 'a': 14, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  const sOrder = { '♠': 4, '♥': 3, '♦': 2, '♣': 1 };
  
  myHand.sort((a, b) => {
    const sA = sOrder[a.suit] || 0, sB = sOrder[b.suit] || 0;
    if (a.suit !== b.suit) return sB - sA;
    return (vOrder[a.value] || 0) - (vOrder[b.value] || 0);
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
  if (selected.length === 0) { showNotification('Fadlan dooro kaarka aad dhigayso!'); return; }

  if (isOpened && selected.length < 3) {
    const serverSets = tablePlayers.flatMap(p => p.openedSets || []);
    let currentTableSets = serverSets.length > 0 ? serverSets : [...myOpenedSets];
    let validAdditions = [], invalidCards = [];
    
    selected.forEach(card => {
      let fitsInAnySet = false;
      currentTableSets.forEach(set => {
        if (!set || set.length < 3) return;
        if (canMeelGali(card, set)) fitsInAnySet = true;
      });
      
      if (fitsInAnySet) validAdditions.push(card);
      else invalidCards.push(card);
    });

    if (validAdditions.length > 0) {
      const selectedIds = new Set(validAdditions.map(c => c.id));
      myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
      socket.emit('addToExistingSets', { cards: validAdditions });
      socket.emit('syncHandAfterMeld', myHand);
      if (invalidCards.length > 0) {
        showNotification(`Waxaad ku darsatay ${validAdditions.length} kaar, laakiin kaarka ${invalidCards[0].value}${invalidCards[0].suit} ma geli karo miiska!`);
      } else {
        showNotification(`Waad ku darsatay miiska ${validAdditions.length} kaar!`);
      }
      renderAll();
      return;
    } else if (invalidCards.length > 0) {
      showNotification(`Kaarka xulan (${invalidCards[0].value}${invalidCards[0].suit}) kuma darsami karo kooxaha miiska saaran!`);
      return;
    }
  }

  if (selected.length < 3) { 
    showNotification('Dooro ugu yaraan 3 kaar oo koox ah si aad u dhigato!'); 
    return; 
  }
  
  const { validGroups, remaining } = findValidGroups(selected);
  if (remaining.length > 0) { 
    showNotification(`Kaarka ${remaining[0].value}${remaining[0].suit} ma geli karo koox!`); 
    return; 
  }
  
  const moveScore = selected.reduce((s, c) => s + cardPoints(c), 0);

  if (!isOpened) {
    const currentTotal = temporaryScore + moveScore;
    const allSetsSoFar = [...myOpenedSets, ...validGroups];
    const hasFourPlus = allSetsSoFar.some(g => g.length >= 4);
    const effectiveMin = pickedFromDiscard ? currentMinToOpen : 101;
    
    if (currentTotal >= effectiveMin && hasFourPlus) {
      isOpened = true; 
      iHaveOpened = true; 
      myOpenedSets = allSetsSoFar;
      const selectedIds = new Set(selected.map(c => c.id));
      myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
      socket.emit('meldSets', { sets: allSetsSoFar, totalScore: currentTotal, isAdditional: false });
      socket.emit('syncHandAfterMeld', myHand);
      temporaryScore = 0;
      showNotification(`Waad degtay! ${currentTotal} dhibco.`);
    } else {
      if (!hasFourPlus) { 
        showNotification('Waxaad u baahan tahay ugu yaraan hal koox oo 4+ kaar ah!'); 
        return; 
      }
      if (currentTotal < effectiveMin) { 
        showNotification(`Ma degi kartid! U baahan: ${effectiveMin} dhibco.`); 
        return; 
      }
      temporaryScore += moveScore; 
      myOpenedSets = [...myOpenedSets, ...validGroups];
      const selectedIds = new Set(selected.map(c => c.id));
      myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
      socket.emit('syncHandAfterMeld', myHand);
      showNotification(`Wadarta: ${temporaryScore}. U baahan: ${effectiveMin}`);
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
  if (!hasDrawn) {
    showNotification('Fadlan marka hore kaar qaado ama tuurista ka qaado!'); 
    return;
  }
  if (pickedFromDiscard && !isOpened) {
    showNotification("Tuurista ayaad qaadatay — Marka hore 'Dhigo' riix si aad u degto (101+)!");
    return;
  }
  const selIdx = myHand.findIndex(c => c.selected);
  if (selIdx === -1) { showNotification('Dooro kaarka aad tuurayso!'); return; }
  const cardToPlay = myHand[selIdx];
  const remaining = myHand.length - 1;
  let isBatuutoMove = false;
  if (isOpened && remaining === 2) {
    isBatuutoMove = true;
    showNotification('🚨 Waxaad gashay Batuuto! Kaararkaaga waxaa laku celinayaa Madafaca.', 5000);
  }
  const discardEl = $('discard-display');
  if (discardEl) {
    discardEl.classList.remove('card-throw-anim');
    void discardEl.offsetWidth;
    discardEl.classList.add('card-throw-anim');
    discardEl.addEventListener('animationend', () => discardEl.classList.remove('card-throw-anim'), { once: true });
  }
  socket.emit('playCard', { card: cardToPlay, isBatuuto: isBatuutoMove });
  myHand.splice(selIdx, 1);
  if (isBatuutoMove) { myHand = []; isOpened = false; myOpenedSets = []; }
  isMyTurn = false;
  hasDrawn = false;
  pickedFromDiscard = false;
  lastPickedDiscardId = null;
  clearInterval(turnTimerInterval);
  myHand.forEach(c => { c.selected = false; c.fromDiscard = false; });
  renderAll();
}

function startWaitingCountdown() {
  waitingCountdown = 120;
  const noteEl = $('waiting-auto-note');
  if (noteEl) noteEl.textContent = `(Haddaan la helin qof: robots ${waitingCountdown}s)`;
  if (waitingAutoTimer) clearInterval(waitingAutoTimer);
  waitingAutoTimer = setInterval(() => {
    waitingCountdown--;
    if (noteEl) noteEl.textContent = `(Haddaan la helin qof: robots ${waitingCountdown}s)`;
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
  const humanCount = plist.filter(p => !p.isBot).length;
  if (humanCount >= 2 || plist.length >= 4) {
    stopWaitingCountdown();
    const noteEl = $('waiting-auto-note');
    if (noteEl) noteEl.textContent = '';
  }
}

function joinGame() {
  const nameInput = $('name-input');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { showNotification('Fadlan geli magacaaga!'); return; }
  myName = name;
  inGame = false;
  sessionStorage.removeItem(SESSION_KEY);
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
  function type() { if (i < text.length) { el.textContent += text.charAt(i); i++; setTimeout(type, speed); } }
  type();
}

function showReconnectOverlay(msg) {
  const overlay = $('reconnect-overlay'), msgEl = $('reconnect-msg');
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
  
  socket.on('connect', () => {
    hideReconnectOverlay();
    if (inGame && myName) {
      const storedToken = sessionStorage.getItem(SESSION_KEY);
      if (storedToken) {
        socket.emit('joinRandom', myName);
      }
    }
  });
  
  socket.on('connect_error', () => showReconnectOverlay('Serverka lama gaari karo — Sugaya...'));

  socket.on('sessionToken', token => {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
  });

  socket.on('waitingRoomUpdate', data => renderWaitingRoom(data.players));

  socket.on('startHand', hand => {
    stopWaitingCountdown();
    inGame = true;
    myHand = hand.map(c => ({ ...c, selected: false, fromDiscard: false }));
    lastPickedDiscardId = null;
    hasDrawn = false;
    pickedFromDiscard = false;
    isOpened = false;
    iHaveOpened = false;
    myOpenedSets = [];
    showScreen('game');
    renderHeader(); renderDiscardPile(); renderStockPile(); renderMyBadge(); renderMyTableSets();
    ['left', 'top', 'right'].forEach(pos => { const c = $(`cards-${pos}`); if (c) c.innerHTML = ''; });
    const opponentCounts = { left: 14, top: 14, right: 14 };
    setTimeout(() => distributeAllCardsAnimated(myHand, opponentCounts, () => renderOpponents()), 150);
  });

  socket.on('matchFound', data => {
    stopWaitingCountdown();
    discardTop = data.topDiscard; currentTurnId = data.currentTurn;
    showScreen('game'); renderAll();
  });
  
  socket.on('firstMeldPause', (data) => {
    showNotification(`${data.playerName} ayaa hoos u degay! Waxaad haysataa ${data.duration} ilbiriqsi oo aad ku eegto Turubkiisa rasmiga ah.`, 5000);
  });

  socket.on('playersUpdate', data => {
    const baddaCardIds = new Set(myHand.filter(c => c.fromDiscard).map(c => c.id));

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
    if (me) {
      myScore = me.points || 0;
      if (me.hand) {
        myHand = me.hand.map(c => ({
          ...c,
          selected: false,
          fromDiscard: baddaCardIds.has(c.id) || c.id === lastPickedDiscardId
        }));
      }
    }
    renderAll();
  });

  socket.on('yourTurn', () => {
    isMyTurn = true; startTurnTimer();
    showNotification('DOORKAAGA!', 2000); renderAll();
  });

  socket.on('updateDiscardPile', card => { discardTop = card; renderDiscardPile(); });
  socket.on('updateStockCount', count => { stockCount = count; renderStockPile(); });

  socket.on('receiveCard', card => {
    myHand.push({ ...card, selected: false, fromDiscard: false });
    hasDrawn = true;
    renderHand();
  });

  socket.on('discardPickedSuccess', (data) => {
    hasDrawn = true;
    pickedFromDiscard = true;
    lastPickedDiscardId = data.card.id;
    showNotification('Kaarka tuurista ayaad qaadatay — Hadda waa inaad degtaa ama soo celisaa!', 3000);
    renderHeader();
  });

  socket.on('updateHand', data => {
    if (data && data.hand) {
      const baddaCardIds = new Set(myHand.filter(c => c.fromDiscard).map(c => c.id));
      const freshHand = data.hand.map(newCard => {
        const oldCard = myHand.find(c => c.id === newCard.id);
        const isSelected = oldCard ? oldCard.selected : false;
        const isFromDiscard = baddaCardIds.has(newCard.id) || newCard.id === lastPickedDiscardId;
        return { ...newCard, selected: isSelected, fromDiscard: isFromDiscard };
      });
      myHand.length = 0;
      myHand.push(...freshHand);
    }
    renderHand();
  });

  socket.on('discardReturnedSuccess', () => {
    myHand.forEach(c => { c.fromDiscard = false; });
    pickedFromDiscard = false;
    hasDrawn = false;
    lastPickedDiscardId = null;
    showNotification('Kaarkii tuurista ayaad ku soo celisay. Hadda kaar qaado ama tuurista ka qaado.', 3000);
    renderAll();
  });

  socket.on('autoDiscarded', (data) => {
    const isMe = data.playerId === socket.id;
    if (isMe) {
      isMyTurn = false;
      hasDrawn = false;
      pickedFromDiscard = false;
      lastPickedDiscardId = null;
      if (turnTimerInterval) clearInterval(turnTimerInterval);
      if (data.drawnCard) {
        if (!myHand.some(c => c.id === data.drawnCard.id)) {
          myHand.push({ ...data.drawnCard, selected: false, fromDiscard: false });
        }
      }
      const discardedCard = data.card; 
      if (discardedCard && discardedCard.id) {
        const idx = myHand.findIndex((c) => c.id === discardedCard.id);
        if (idx !== -1) myHand.splice(idx, 1);
      }
      myHand.forEach((c) => { c.selected = false; c.fromDiscard = false; });
      const cardLabel = discardedCard ? `${discardedCard.value}${discardedCard.suit}` : "Kaar";
      showNotification(`Waqtigii wuu kaa dhammaaday — ${cardLabel} ayaa si toos ah loo tuuray!`, 4000);
    } else {
      const opponent = players.find(p => p.id === data.playerId);
      const opponentName = opponent ? opponent.name : "Ciyaaryahan";
      const cardLabel = data.card ? `${data.card.value}${data.card.suit}` : "kaar";
      showNotification(`Waqtiga wuu ka dhammaaday ${opponentName} — waa laga tuuray ${cardLabel}`, 3000);
    }
    renderAll();
  });

  // SAXITAANKA: renderTableSets la tirtiray — renderOpponents() ayaa si buuxda u
  // qaabileynaysa drop listeners-ka, kuma baahna dib-u-qaabayn kale.
  socket.on('updateTableUI', data => {
    tablePlayers = data.players;
    currentMinToOpen = data.nextRequiredPoints;
    renderOpponents();
    renderMyTableSets();
    renderHand();
  });

  socket.on('updateOpponents', data => { opponents = data; renderOpponents(); });

  socket.on('scoreUpdated', data => {
    if (data.playerId === socket.id) { myScore = data.newTotal; renderHeader(); }
  });

  socket.on('gameOver', data => {
    clearInterval(turnTimerInterval);
    sessionStorage.removeItem(SESSION_KEY);
    if (data.allPlayers) { players = data.allPlayers; }
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
      const localWinner = players.find(p => p.id === data.winnerId);
      const isBot = (localWinner && localWinner.isBot) ||
                    (data.winnerName && (data.winnerName.includes('JIMCAALE') || data.winnerName.includes('FAARAX')));
      const icon = $('modal-icon'); if (icon) icon.textContent = isBot ? '🤖' : '🃏';
      const title = $('modal-title'); if (title) title.textContent = 'CIYAARTU WAA DHAMMAATAY';
      const body = $('modal-body'); if (body) body.innerHTML = `<span style="color:#2ecc71;font-weight:700">${data.winnerName}</span> baa guuleystay!`;
    }
    renderAll();
  });

  socket.on('allRoundOver', () => {
    myHand.forEach(c => { c.fromDiscard = false; });
    lastPickedDiscardId = null;
  });

  socket.on('hoosgaleTriggered', () => {
    showNotification('HOOSGALE! Kaarahaagii waa laga qaaday.', 5000);
    myHand = []; isOpened = false; iHaveOpened = false; myOpenedSets = [];
    hasDrawn = false; pickedFromDiscard = false; lastPickedDiscardId = null;
    renderAll();
  });

  socket.on('notification', msg => showNotification(msg));

  socket.on('botPickedDiscard', (data) => {
    const label = `${data.card.value}${data.card.suit}`;
    showNotification(`🤖 ${data.botName} wuxuu tuurista ka qaatay: ${label}`, 3500);
    const el = $('discard-display');
    if (el) {
      el.classList.add('discard-bot-took');
      setTimeout(() => el.classList.remove('discard-bot-took'), 800);
    }
  });

  socket.on('opponentPickedDiscard', (data) => {
    const label = `${data.card.value}${data.card.suit}`;
    showNotification(`👤 ${data.playerName} wuxuu tuurista ka qaatay: ${label}`, 3000);
  });

  socket.on('timerPaused', data => {
    clearInterval(turnTimerInterval);
    showNotification(data.message, 6000);
    const btn = $('btn-pause');
    if (btn && data.activePlayerId === socket.id) {
      btn.textContent = 'Fasax'; btn.dataset.paused = 'true'; btn.style.background = '#f39c12';
    }
  });

  socket.on('timerResumed', () => {
    showNotification('Waqtiga dib ayuu bilaabmay!', 2000);
    const btn = $('btn-pause');
    if (btn) { btn.textContent = 'Isuga'; btn.dataset.paused = 'false'; btn.style.background = ''; }
    if (isMyTurn) startTurnTimer();
  });

  setInterval(() => { if (socket && socket.connected) socket.emit('ping_keep_alive'); }, 25000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && socket && inGame) {
    socket.emit('request_sync');
  }
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
      if (pickedFromDiscard && !isOpened) { socket.emit('returnDiscardCard'); return; }
      const isPaused = btnPause.dataset.paused === 'true';
      if (!isPaused) {
        socket.emit('pauseTimer'); btnPause.textContent = 'Fasax';
        btnPause.dataset.paused = 'true'; btnPause.style.background = '#f39c12';
        clearInterval(turnTimerInterval);
      } else {
        socket.emit('resumeTimer'); btnPause.textContent = 'Isuga';
        btnPause.dataset.paused = 'false'; btnPause.style.background = '';
      }
    });
  }

  const btnForceReset = $('btn-force-reset');
  if (btnForceReset) {
    btnForceReset.addEventListener('click', () => {
      if (!socket) return;
      socket.emit('forceResetGame');
    });
  }

  try { initSocket(); } catch (err) { console.error('Socket init error:', err); }
});