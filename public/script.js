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
let myOpeningScore = 0;
let barrierHistory = [101];
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

function showNotification(msg, duration = 4000) {
  // 1. Helitaanka container-ka
  let container = document.getElementById('notification-container');
  
  // 2. Haddii uusan jirin, samee mid cusub
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    document.body.appendChild(container);
  }

  // 3. Abuurista fariinta
  const el = document.createElement('div');
  el.className = 'notif-card';
  el.innerHTML = `<strong>📢 ${msg}</strong>`;
  container.appendChild(el);

  // 4. Ka saarista fariinta wakhtiga kadib
  setTimeout(() => {
    el.remove();
  }, duration);
}

function createNotifContainer() {
  const div = document.createElement('div');
  div.id = 'notification-container';
  document.body.appendChild(div);
  return div;
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
          if (socket) socket.emit('animation_finished');
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

function autoSplitIntoGroupsAlternative(cards) {
  const groups = [];
  const usedIdx = new Set();
  const temp = cards.map((c, i) => ({ ...c, _i: i }));

  const values = [...new Set(temp.map(c => c.value))];
  values.forEach(val => {
    const vc = temp.filter(c => c.value === val && !usedIdx.has(c._i));
    const grp = [];
    const seen = new Set();
    vc.forEach(c => {
      if (!seen.has(c.suit) && grp.length < 4) { seen.add(c.suit); grp.push(c); }
    });
    if (grp.length >= 3) { groups.push(grp.map(({ _i, ...r }) => r)); grp.forEach(c => usedIdx.add(c._i)); }
  });

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
  return groups;
}

function findValidGroups(cards) {
  const groupsA = autoSplitIntoGroups(cards);
  const usedIdsA = new Set(groupsA.flat().map(c => c.id));
  const remainingA = cards.filter(c => !usedIdsA.has(c.id));

  const groupsB = autoSplitIntoGroupsAlternative(cards);
  const usedIdsB = new Set(groupsB.flat().map(c => c.id));
  const remainingB = cards.filter(c => !usedIdsB.has(c.id));

  if (remainingB.length <= remainingA.length) return { validGroups: groupsB, remaining: remainingB };
  return { validGroups: groupsA, remaining: remainingA };
}

function applyFooroLogic(winnerId, providerId, allPlayers) {
  if (!allPlayers || allPlayers.length === 0) return null;

  // Isticmaal provider-ka haddii la haysto (kii guuleystuhu kaarka ka qaatay).
  // Haddii providerId maqan yahay ama aan la helin — tusaale: guuleystuhu si
  // toos ah ayuu ku xiray (wuxuu kaarka stock-ka ka qaatay, qof kalena wax
  // kama uu qaadan) — HADDANA qofka kusoo xiga wuxuu ahaa qofkii kii ka
  // horreeyay guuleystaha si joogto ah (seat-kiisa), ee waa isaga oo kaliya
  // "provider-ka la moodo" ee foorada ku dhici karta. Kani waa saxitaanka:
  // hore, `provIdx === -1` wuxuu sababi jiray in FOORO-du gebi ahaanba
  // baaqato — taasi waa sababta macluumaadka "cidda foorada leh" iyo
  // "cidda ay ku dhacday" uu uga lumay modal-ka marka xirashadu tahay mid
  // toos ah (providerId === null).
  let provIdx = allPlayers.findIndex(p => p.id === providerId);
  const providerKnown = provIdx !== -1;
  if (!providerKnown) {
    const winnerIdx = allPlayers.findIndex(p => p.id === winnerId);
    if (winnerIdx === -1) return null;
    // Qofka fadhiga kaga horreeyay guuleystaha (seat-kiisa) ayaa noqonaya
    // meesha laga bilaabo raadinta — isagaa kaliya foorada ku dhici karta,
    // wuxuuna ka badbaadi karaa kaliya haddii uu horay u degay.
    provIdx = (winnerIdx - 1 + allPlayers.length) % allPlayers.length;
  }

  console.log("========== FOORO ==========");
  console.log("Winner ID:", winnerId);
  console.log("Provider ID:", providerId, providerKnown ? "" : "(lama helin — laga bilaabay guuleystaha)");
  console.log(
    "Players:",
    allPlayers.map((p, i) => ({
      index: i,
      name: p.name,
      opened: p.isOpened
    }))
  );

  // Ka bilow provider-ka laftiisa, kadibna DIB U SOCO (turn order-ka ka
  // horreeya) — ma aha hore u soco. Sababta: qofka fadhiga ka horreeya
  // provider-ka ayaa ah kii xigga ee foorada u qalma haddii provider-ku
  // horay u degay, ee ma aha qofka ka horreeya guuleystaha.
  for (let i = 0; i < allPlayers.length; i++) {

    const idx = ((provIdx - i) % allPlayers.length + allPlayers.length) % allPlayers.length;
    const p = allPlayers[idx];

    console.log(
      `i=${i} -> index=${idx} -> ${p.name} | opened=${p.isOpened} | winner=${p.id === winnerId}`
    );

    // Guuleystaha waa la dhaafayaa
    if (p.id === winnerId) continue;

    // Qofkii ugu horreeya ee aan degin
    if (!p.isOpened) {

      console.log("✅ FOORO waxay ku dhacday:", p.name);

      // Soo celi player-kii + xog dheeraad ah
      return {
        ...p,

        provider: providerKnown ? allPlayers[provIdx] : null,
        providerIndex: providerKnown ? provIdx : -1,

        winner: allPlayers.find(x => x.id === winnerId),

        targetIndex: idx,

        handCount: (p.hand || []).length,
        handPoints: (p.hand || []).reduce(
          (s, c) => s + (c.points || 0),
          0
        )
      };
    }
  }

  // Dhammaan kuwa kale (marka laga reebo guuleystaha) way degeen — ma jiro
  // qof "aan degin" oo toos ah loo dhiibi karo FOORO-da. Xaaladdan waxaa la
  // eegayaa dhibcaha gacanta ay hayaan: qofka haya dhibcaha ugu badan
  // (tusaale AA = 22 halka 777 ama 6-7-8 ay yihiin 21) ayaa FOORO-da ku
  // dhici doonta. Haddii ay dhammaantood isku mid yihiin (isla wada egyihiin),
  // waxaa loo istcimaalayaa qofka ugu horreeya ee fadhiga kusoo xiga
  // guuleystaha.
  const winnerIdxForTie = allPlayers.findIndex(p => p.id === winnerId);
  const others = allPlayers.filter(p => p.id !== winnerId);

  if (winnerIdxForTie !== -1 && others.length > 0) {
    const withPoints = others.map(p => ({
      player: p,
      points: (p.hand || []).reduce((s, c) => s + (c.points || 0), 0)
    }));
    const maxPoints = Math.max(...withPoints.map(x => x.points));
    const topCandidates = withPoints.filter(x => x.points === maxPoints);

    let target;
    if (topCandidates.length === 1) {
      // Hal qof oo kaliya ayaa haya dhibcaha ugu badan — isagaa FOORO-da ku dhacaysa
      target = topCandidates[0].player;
    } else {
      // Isla wada egyihiin (ama isku mar way ugu sarreeyaan) — qofka ugu
      // horreeya ee fadhiga kusoo xiga guuleystaha ayaa la doortaa
      for (let i = 1; i <= allPlayers.length; i++) {
        const idx = (winnerIdxForTie + i) % allPlayers.length;
        if (allPlayers[idx].id !== winnerId) {
          target = allPlayers[idx];
          break;
        }
      }
    }

    if (target) {
      const targetIdx = allPlayers.findIndex(p => p.id === target.id);
      console.log("✅ FOORO (dhibcaha ugu badan / isla-eg) waxay ku dhacday:", target.name);

      return {
        ...target,

        provider: providerKnown ? allPlayers[provIdx] : null,
        providerIndex: providerKnown ? provIdx : -1,

        winner: allPlayers.find(x => x.id === winnerId),

        targetIndex: targetIdx,

        handCount: (target.hand || []).length,
        handPoints: (target.hand || []).reduce(
          (s, c) => s + (c.points || 0),
          0
        )
      };
    }
  }

  console.log("❌ Qof aan degin lama helin.");
  return null;
}


function makeCard(card, size, opts = {}) {
  const el = document.createElement('div');
  const isRed = ['♥', '♦'].includes(card.suit);
  const isFromDiscard = !!card.fromDiscard;

  el.className =
    `card ${size} ` +
    (opts.selected ? ' selected' : '') +
    (opts.overlap ? ' overlap' : '') +
    (isRed ? ' red-suit' : ' black-suit') +
    (isFromDiscard ? ' badda-card' : '');

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

  if (isFromDiscard) {
    const badge = document.createElement('span');
    badge.className = 'discard-badge';
    badge.textContent = '★';
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
      document.querySelectorAll('.opened-set').forEach(s => { s.classList.remove('drop-target', 'drop-invalid'); });
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
    if (isOpened) {
      const histParts = barrierHistory.map((v, i) => {
        if (i === barrierHistory.length - 1 && barrierHistory.length > 1) return `<span style="color:#e74c3c;font-weight:bold;">${v}</span>`;
        if (i === 1 && barrierHistory.length === 3) return `<span style="color:#2ecc71;font-weight:bold;">${v}</span>`;
        return `<span style="color:#bdc3c7;">${v}</span>`;
      });
      const histDisplay = histParts.join(' <span style="color:#666;">/</span> ');
      minOpenEl.innerHTML = `<span style="font-size:11px;color:#bdc3c7;">Xeerka:</span> ${histDisplay} <span style="font-size:11px;color:#bdc3c7;margin-left:4px;">— kale laga rabo: <b style="color:#e74c3c;">${currentMinToOpen}+</b></span>`;
    } else {
      minOpenEl.innerHTML = `U baahan: <span style="color: #f1c40f; font-weight: bold;">${currentMinToOpen}</span> <span style="font-size: 11px; color: #bdc3c7;">dhibco si aad u degto</span>`;
    }
  }

  const btnDhigo = $('btn-dhigo'), btnTuur = $('btn-tuur');
  if (btnDhigo) btnDhigo.disabled = !isMyTurn;
  if (btnTuur) btnTuur.disabled = !isMyTurn;
}

function canMeelGali(card, set) {
  if (!set || set.length < 3) return false;
  const allSameSuit = set.every(c => c && c.suit === card.suit);
  if (allSameSuit) {
    const vals = set.map(c => getCardValue(c)).sort((a, b) => a - b);
    const cv = getCardValue(card);
    if (cv === vals[0] - 1 || cv === vals[vals.length - 1] + 1) return true;
  }
  const allSameVal = set.every(c => c && c.value === card.value);
  const suitAlreadyIn = set.some(c => c && c.suit === card.suit);
  if (allSameVal && !suitAlreadyIn && set.length < 4) return true;
  return false;
}

function makeDraggableSet(set, setIdx, targetPlayerId) {
  const setDiv = document.createElement('div');
  setDiv.className = 'opened-set';
  if (set && Array.isArray(set)) {
    set.forEach((card, ci) => {
      if (card) setDiv.appendChild(makeCard(card, 'sm', { overlap: ci > 0 }));
    });
  }
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
  setDiv.addEventListener('dragleave', () => { setDiv.classList.remove('drop-target', 'drop-invalid'); });
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
    const cardIdx = dragStartIndex;
    dragStartIndex = null;
    myHand.splice(cardIdx, 1);
    myHand.forEach(c => { c.selected = false; });
    renderHand();
    if (socket) {
      socket.emit('addToExistingSets', { cards: [draggedCard] });
      socket.emit('syncHandAfterMeld', myHand);
    }
    showNotification('✅ Kaartu miiska ayay u gashay!', 1500);
  });
  return setDiv;
}

function renderMyTableSets() {
  const myContainer = $('my-table-sets');
  if (myContainer) myContainer.innerHTML = '';
  tablePlayers.forEach(player => {
    if (player.id === socket.id) {
      if (!myContainer) return;
      player.openedSets.forEach((set, setIdx) => {
        const setDiv = makeDraggableSet(set, setIdx, player.id);
        myContainer.appendChild(setDiv);
      });
    } else {
      let slotId = '';
      if (player.id === opponents.top?.id) slotId = 'sets-bot-top';
      else if (player.id === opponents.left?.id) slotId = 'sets-bot-left';
      else if (player.id === opponents.right?.id) slotId = 'sets-bot-right';
      const oppContainer = $(slotId);
      if (oppContainer) {
        oppContainer.innerHTML = '';
        player.openedSets.forEach(set => {
          const setDiv = document.createElement('div');
          setDiv.className = 'opened-set';
          set.forEach(card => {
            const el = makeCard(card, 'sm');
            el.classList.add('card-pickup-anim');
            setDiv.appendChild(el);
          });
          oppContainer.appendChild(setDiv);
        });
      }
    }
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
  if (!socket || !socket.id || !players || !Array.isArray(players) || players.length === 0) return null;
  const myIdx = players.findIndex(p => p && p.id === socket.id);
  if (myIdx === -1) return null;
  return players[(myIdx + offset) % players.length] || null;
}

function getTablePlayerAtOffset(offset) {
  if (!socket || !socket.id || !tablePlayers || !Array.isArray(tablePlayers) || tablePlayers.length === 0) return null;
  const myIdx = tablePlayers.findIndex(p => p && p.id === socket.id);
  if (myIdx === -1) return null;
  return tablePlayers[(myIdx + offset) % tablePlayers.length] || null;
}

function renderOpponents() {
  const offsets = { left: 3, top: 2, right: 1 };
  ['left', 'top', 'right'].forEach(pos => {
    const p = getPlayerAtOffset(offsets[pos]);
    const tp = getTablePlayerAtOffset(offsets[pos]);
    const sets = tp ? (tp.openedSets || []) : [];
    renderOpponentSlot(pos,
      p ? p.name : (opponents[pos] ? opponents[pos].name : null),
      p ? p.cardCount : 0,
      p ? p.id === currentTurnId : false,
      p ? p.isOpened : false,
      sets,
      p ? p.isBot : false,
      tp ? tp.id : (p ? p.id : '')
    );
  });
}

function renderMyBadge() {
  const badge = $('my-name-badge');
  if (!badge) return;
  badge.textContent = myName + (isOpened ? ' ✓' : '') + ' (Adiga)';
  const amActive = socket && currentTurnId === socket.id;
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
  if (socket) socket.emit('drawCard');
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
  if (socket) socket.emit('pickDiscard');
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
      if (socket) {
        socket.emit('addToExistingSets', { cards: validAdditions });
        socket.emit('syncHandAfterMeld', myHand);
      }
      if (invalidCards.length > 0) showNotification(`Waxaad ku darsatay ${validAdditions.length} kaar, laakiin kaarka ${invalidCards[0].value}${invalidCards[0].suit} ma geli karo miiska!`);
      else showNotification(`Waad ku darsatay miiska ${validAdditions.length} kaar!`);
      renderAll();
      return;
    } else if (invalidCards.length > 0) {
      showNotification(`Kaarka xulan (${invalidCards[0].value}${invalidCards[0].suit}) kuma darsami karo kooxaha miiska saaran!`);
      return;
    }
  }

  if (selected.length < 3) { showNotification('Dooro ugu yaraan 3 kaar oo koox ah si aad u dhigato!'); return; }

  const { validGroups, remaining } = findValidGroups(selected);
  if (remaining.length > 0) { showNotification(`Kaarka ${remaining[0].value}${remaining[0].suit} ma geli karo koox!`); return; }

  const processedGroups = [];
  validGroups.forEach(group => {
    if (group.length === 6) { processedGroups.push(group.slice(0, 3), group.slice(3, 6)); }
    else if (group.length === 7) { processedGroups.push(group.slice(0, 4), group.slice(4, 7)); }
    else { processedGroups.push(group); }
  });

  const moveScore = selected.reduce((s, c) => s + cardPoints(c), 0);

  if (!isOpened) {
    const currentTotal = temporaryScore + moveScore;
    const allSetsSoFar = [...myOpenedSets, ...processedGroups];
    const hasFourPlus = allSetsSoFar.some(g => g.length >= 4);
    const effectiveMin = currentMinToOpen;
    if (currentTotal >= effectiveMin && hasFourPlus) {
      isOpened = true;
      iHaveOpened = true;
      myOpeningScore = currentTotal;
      myOpenedSets = allSetsSoFar;
      const selectedIds = new Set(selected.map(c => c.id));
      myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
      if (socket) {
        socket.emit('meldSets', { sets: allSetsSoFar, totalScore: currentTotal, isAdditional: false });
        socket.emit('syncHandAfterMeld', myHand);
      }
      temporaryScore = 0;
      showNotification(`Waad degtay! ${currentTotal} dhibco.`);
    } else {
      if (!hasFourPlus) { showNotification('Waxaad u baahan tahay ugu yaraan hal koox oo 4+ kaar ah!'); return; }
      if (currentTotal < effectiveMin) { showNotification(`Ma degi kartid! U baahan: ${effectiveMin} dhibco.`); return; }
      temporaryScore += moveScore;
      myOpenedSets = [...myOpenedSets, ...processedGroups];
      const selectedIds = new Set(selected.map(c => c.id));
      myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
      if (socket) socket.emit('syncHandAfterMeld', myHand);
      showNotification(`Wadarta: ${temporaryScore}. U baahan: ${effectiveMin}`);
    }
  } else {
    const selectedIds = new Set(selected.map(c => c.id));
    myHand = myHand.filter(c => !selectedIds.has(c.id)).map(c => ({ ...c, selected: false }));
    if (socket) {
      socket.emit('meldSets', { sets: processedGroups, isAdditional: true });
      socket.emit('syncHandAfterMeld', myHand);
    }
    myOpenedSets = [...myOpenedSets, ...processedGroups];
  }
  renderAll();
}

function handleReset() {
  if (iHaveOpened || isOpened) { showNotification('Hore ayaad u degtay, kama noqon kartid!'); return; }
  if (!myOpenedSets.length) { showNotification('Ma jiraan kaarar aad dhigtay.'); return; }
  const back = myOpenedSets.flat().map(c => ({ ...c, selected: false }));
  myHand = [...myHand, ...back];
  myOpenedSets = []; temporaryScore = 0;
  if (socket) socket.emit('resetMyOpenedCards');
  showNotification('Kaararkii waa lagu soo celiyay gacantaada.');
  renderAll();
}

function handleTuur() {
  if (!isMyTurn) { showNotification('Sug doorkaaga!'); return; }
  const canSkipDraw = myHand.length >= 15 || (isOpened && myHand.length === 1);
  if (!hasDrawn && !canSkipDraw) { showNotification('Fadlan marka hore kaar qaado ama tuurista ka qaado!'); return; }
  if (pickedFromDiscard && !isOpened) { showNotification("Tuurista ayaad qaadatay — Marka hore 'Dhigo' riix si aad u degto (101+)!"); return; }
  const selIdx = myHand.findIndex(c => c.selected);
  if (selIdx === -1) { showNotification('Dooro kaarka aad tuurayso!'); return; }
  const cardToPlay = myHand[selIdx];
  const discardEl = $('discard-display');
  if (discardEl) {
    discardEl.classList.remove('card-throw-anim');
    void discardEl.offsetWidth;
    discardEl.classList.add('card-throw-anim');
    discardEl.addEventListener('animationend', () => discardEl.classList.remove('card-throw-anim'), { once: true });
  }
  if (socket) socket.emit('playCard', { card: cardToPlay });
  myHand.splice(selIdx, 1);
  isMyTurn = false;
  hasDrawn = false;
  pickedFromDiscard = false;
  lastPickedDiscardId = null;
  clearInterval(turnTimerInterval);
  myHand.forEach(c => { c.selected = false; c.fromDiscard = false; });
  renderAll();
}

function startWaitingCountdown() {
  waitingCountdown = 240;
  const noteEl = $('waiting-auto-note');
  if (noteEl) noteEl.textContent = `Haddaan la helin qof: robots ${waitingCountdown}s`;
  if (waitingAutoTimer) clearInterval(waitingAutoTimer);
  waitingAutoTimer = setInterval(() => {
    waitingCountdown--;
    if (noteEl) noteEl.textContent = `Haddaan la helin qof: robots ${waitingCountdown}s`;
    if (waitingCountdown <= 0) { clearInterval(waitingAutoTimer); waitingAutoTimer = null; if (noteEl) noteEl.textContent = 'Robotyada la keenayaa...'; }
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
  if (humanCount >= 2 || plist.length >= 4) { stopWaitingCountdown(); const noteEl = $('waiting-auto-note'); if (noteEl) noteEl.textContent = ''; }
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
  if (socket) socket.emit('joinRandom', name);
  startWaitingCountdown();
  setTimeout(() => { typeWriter('waiting-typewriter', `${name}, soo dhowoow! Dulqaado fadlan inta ay ciyaartooyda kale ku soo biirayaan...`, 48); }, 300);
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

function somaliGameText(isMe) {
  return {
    winner: isMe ? "Waad guuleysatay" : "Wuu guuleystay",
    loser: isMe ? "Waad guuldarraysatay" : "Wuu guuldarraystay",
    opened: isMe ? "Marka hore waad degtay" : "Marka hore wuu degay",
    notOpened: isMe ? "Ma aadan degin" : "Ma uusan degin",
    closed: isMe ? "Sidaa darteet waad xirtay ciyaarta" : "Sidaa darteed wuu xiray ciyaarta",
    tookDiscard: isMe ? "Marka hore waxaad qaadatay xabad turubka" : "Marka hore wuxuu qaatay xabad turubka",
    congratulations: isMe ? "Hambalyo" : "",
    name(isMeFlag, name) { return isMeFlag ? `Adiga (${name})` : name; }
  };
}

function initSocket() {
  socket = io({ path: '/game-io', transports: ['polling', 'websocket'] });

  socket.on('disconnect', () => showReconnectOverlay("Xiriirka waa go'ay — Dib u xidh..."));
  socket.on('connect', () => {
    hideReconnectOverlay();
    if (inGame && myName) {
      const storedToken = sessionStorage.getItem(SESSION_KEY);
      if (storedToken && socket) socket.emit('joinRandom', myName);
    }
  });
  socket.on('connect_error', () => showReconnectOverlay('Serverka lama gaari karo — Sugaya...'));
  socket.on('sessionToken', token => { if (token) sessionStorage.setItem(SESSION_KEY, token); });
  socket.on('waitingRoomUpdate', data => renderWaitingRoom(data.players));

  socket.on('startHand', hand => {
    stopWaitingCountdown();
    inGame = true;
    myHand = hand.map(c => ({ ...c, selected: false, fromDiscard: false }));
    lastPickedDiscardId = null;
    hasDrawn = false; pickedFromDiscard = false;
    isOpened = false; iHaveOpened = false; myOpenedSets = [];
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

  socket.on('playersUpdate', data => {
    if (!data) return;
    const baddaCardIds = new Set(myHand.filter(c => c.fromDiscard).map(c => c.id));
    players = data.players || [];
    stockCount = data.stockCount;
    currentTurnId = data.currentTurnId;
    const wasMyTurn = isMyTurn;
    isMyTurn = socket && data.currentTurnId === socket.id;
    if (isMyTurn && !wasMyTurn) { startTurnTimer(); showNotification('Kor ka qaado ama tuurista', 2500); }
    if (data.nextRequiredPoints !== undefined) currentMinToOpen = data.nextRequiredPoints;
    if (data.barrierHistory && data.barrierHistory.length > 0) barrierHistory = data.barrierHistory;
    if (socket) {
      const me = players.find(p => p && p.id === socket.id);
      if (me) {
        myScore = me.points || 0;
        isOpened = me.isOpened;
        if (me.hand) {
          myHand = me.hand.map(c => ({
            ...c,
            selected: false,
            fromDiscard: baddaCardIds.has(c.id) || c.id === lastPickedDiscardId
          }));
        }
      }
    }
    renderAll();
  });

  socket.on('updateTableUI', data => {
    if (!data) return;
    tablePlayers = data.players || [];
    if (data.nextRequiredPoints !== undefined) currentMinToOpen = data.nextRequiredPoints;
    renderMyTableSets(); renderOpponents();
  });

  socket.on('yourTurn', () => { isMyTurn = true; startTurnTimer(); showNotification('DOORKAAGA!', 2000); renderAll(); });
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
    pickedFromDiscard = false; hasDrawn = false; lastPickedDiscardId = null;
    showNotification('Kaarkii tuurista ayaad ku soo celisay. Hadda kaar qaado ama tuurista ka qaado.', 3000);
    renderAll();
  });

  socket.on('autoDiscarded', (data) => {
    const isMe = socket && data.playerId === socket.id;
    if (isMe) {
      isMyTurn = false; hasDrawn = false; pickedFromDiscard = false; lastPickedDiscardId = null;
      if (turnTimerInterval) clearInterval(turnTimerInterval);
      if (data.drawnCard && !myHand.some(c => c.id === data.drawnCard.id)) myHand.push({ ...data.drawnCard, selected: false, fromDiscard: false });
      const discardedCard = data.card;
      if (discardedCard && discardedCard.id) { const idx = myHand.findIndex(c => c.id === discardedCard.id); if (idx !== -1) myHand.splice(idx, 1); }
      myHand.forEach(c => { c.selected = false; c.fromDiscard = false; });
      const cardLabel = discardedCard ? `${discardedCard.value}${discardedCard.suit}` : "Kaar";
      showNotification(`Waqtigii wuu kaa dhammaaday — ${cardLabel} ayaa si toos ah loo tuuray!`, 4000);
    } else {
      const opponent = players.find(p => p && p.id === data.playerId);
      const opponentName = opponent ? opponent.name : "Ciyaaryahan";
      const cardLabel = data.card ? `${data.card.value}${data.card.suit}` : "kaar";
      showNotification(`Waqtiga wuu ka dhammaaday ${opponentName} — waa laga tuuray ${cardLabel}`, 3000);
    }
    renderAll();
  });

  socket.on('gameOver', data => {
    clearInterval(turnTimerInterval);
    sessionStorage.removeItem(SESSION_KEY);
    if (data.allPlayers) { players = data.allPlayers || []; }
    renderAll();

    const isMeWinner = socket && data.winnerId === socket.id;
    const fooroTarget = applyFooroLogic(data.winnerId, data.providerId, data.allPlayers);

    if (isMeWinner && fooroTarget && !fooroTarget.isBot) {
      socket.emit('updatePenaltyScore', { playerId: fooroTarget.id, points: 101 });
      showNotification(`FOORO! ${fooroTarget.name} ayaa 101 dhibco helay!`, 4000);
    }

    setTimeout(() => {
      const modal = $('gameover-modal');
      if (modal) modal.classList.remove('hidden');

      const allP = data.allPlayers || [];
      const winnerPlayer = allP.find(p => p.id === data.winnerId);
      const winnerIsBot = winnerPlayer ? winnerPlayer.isBot : false;
      const winnerDegay = isMeWinner ? isOpened : (winnerPlayer ? winnerPlayer.isOpened : false);
      const providerPlayer = data.providerId ? allP.find(p => p.id === data.providerId) : null;
      const xiradTurub = Boolean(providerPlayer && providerPlayer.id !== data.winnerId);

      const icon = $('modal-icon');
      const title = $('modal-title');
      const body = $('modal-body');
      const t = somaliGameText(isMeWinner);

      if (isMeWinner) {
        if (icon) icon.textContent = '🏆';
        if (title) title.textContent = t.winner.toUpperCase() + "!";
        let subMsg = `Xirid toos ah — ${t.winner}! 🏆`;
        if (winnerDegay && xiradTurub) subMsg = `Waad degtay — qaadashada ayaad ka xiratay! ♠️`;
        else if (winnerDegay) subMsg = `Waad degtay — dabadeedna kor ayaad ka xiratay! 🎉`;
        else if (xiradTurub) subMsg = `Qaadashada ayaad ka xiratay — Si toos! ♠️`;
        if (body) body.innerHTML = `${t.congratulations}, <span style="color:#f1c40f;font-weight:900">${myName}</span>!<br><span style="color:#2ecc71;font-size:0.92em;font-weight:600">${subMsg}</span>`;
      } else {
        const tOther = somaliGameText(false);
        if (icon) icon.textContent = winnerIsBot ? '🤖' : '🃏';
        if (title) title.textContent = 'CIYAARTU WAA DHAMMAATAY';
        const wLabel = `<span style="color:#2ecc71;font-weight:700">${data.winnerName}${winnerIsBot ? ' 🤖' : ''}</span>`;
        let subMsg = 'Xirid toos ah — Kor ka xirid';
        if (winnerDegay && xiradTurub) subMsg = 'Wuu degay marka hore — dabadeedna qaadashada ayuu ka xiray';
        else if (winnerDegay) subMsg = 'Marka hore wuu degay — dabadeedna kor ayuu ka xiray';
        else if (xiradTurub) subMsg = 'Qaadashada ayuu ka xiray — marna ma degin';
        if (body) body.innerHTML = `${wLabel} baa guuleystay!<br><span style="color:#aaa;font-size:0.9em">${subMsg}</span>`;
      }

      const openInfo = $('modal-open-info');
      if (openInfo) {
        let xiradLine = '';
        if (xiradTurub) {
          const provName = providerPlayer ? providerPlayer.name : "Ciyaartoy";
          const victim = fooroTarget ? fooroTarget.name : "Ciyaartoy kale";
          const myStats = data.stats && data.stats[data.winnerId] ? data.stats[data.winnerId].pickedFrom : null;
          const count = myStats && myStats[data.providerId] ? myStats[data.providerId] : 1;
          const myHistory = data.history ? data.history.filter(m => m.playerId === data.winnerId && m.fromId === data.providerId) : [];
          // FIX: Bot-ka kaartiisa la qaaday "Lama oga" - waxaan muujin kaartii uu bot-ku siiyay
          const firstPickCard = myHistory.length > 0 ? (myHistory[0].card || "Lama oga") : "Lama oga";
          xiradLine = `
            <div style="margin-bottom:10px;padding:8px 10px;background:rgba(231,76,60,0.12);border-left:3px solid #e74c3c;border-radius:6px;font-size:0.85em;color:#e0e0e0;line-height:1.4;">
              ♠️ <span style="color:#f1c40f;font-weight:700">${data.winnerName}</span>
              ayaa ka qaatay <span style="color:#fff">${provName}</span>
              <span style="color:#aaa">(${count} jeer, kii hore wuxuu ahaa <b>${firstPickCard}</b>)</span>
              <br>— wuxuu ku xiray <span style="color:#e74c3c;font-weight:700">${victim}</span>.
            </div>`;
        }

        const rows = allP.map(p => {
          const isMeP = socket && p.id === socket.id;
          const pt = somaliGameText(isMeP);
          const isWinner = p.id === data.winnerId;
          const isFooro = fooroTarget && p.id === fooroTarget.id;
          const handCount = (p.hand || []).length;
          const handPts = (p.hand || []).reduce((s, c) => s + (c.points || 0), 0);
          const nameHtml = isMeP
            ? `<span style="color:#f1c40f;font-weight:700">${pt.name(true, p.name)}</span>`
            : isWinner ? `<span style="color:#2ecc71;font-weight:700">${p.name}${p.isBot ? ' 🤖' : ''}</span>`
            : isFooro ? `<span style="color:#e74c3c;font-weight:700">${p.name}</span><span style="font-size:0.75em;background:#e74c3c;color:#fff;padding:1px 5px;border-radius:4px;margin-left:4px">FOORO</span>`
            : `<span style="color:#ccc">${p.name}</span>`;
          let statusHtml;
          if (isWinner) statusHtml = `<span style="color:#2ecc71;font-weight:700">✅ ${pt.winner}</span>`;
          else if (p.isOpened) statusHtml = `<span style="color:#f1c40f">📋 ${pt.opened}</span> · <span style="color:${handCount === 0 ? '#2ecc71' : '#e74c3c'}">${handCount === 0 ? '0 kaar ✓' : `${handCount} kaar (${handPts} dh)`}</span>`;
          else statusHtml = `<span style="color:#e74c3c">❌ ${pt.notOpened}</span> · <span style="color:#e74c3c;font-size:0.85em">${handCount} kaar (${handPts} dh)${isFooro ? ' · +101 Fooro!' : ''}</span>`;
          const rowBg = isFooro ? 'background:rgba(231,76,60,0.08);' : (isWinner ? 'background:rgba(46,204,113,0.06);' : '');
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 4px;border-bottom:1px solid rgba(255,255,255,0.07);${rowBg}"><span>${nameHtml}</span><span>${statusHtml}</span></div>`;
        }).join('');

        let fooroLine = '';
        if (fooroTarget) {
          const fooroHandPts = (fooroTarget.hand || []).reduce((s, c) => s + (c.points || 0), 0);
          const sababta = `${fooroTarget.isOpened ? '' : 'ma uusan degin — '}wuxuu hayay <span style="color:#e74c3c;font-weight:700">${fooroHandPts} dhibcood</span>`;
          fooroLine = `<div style="margin-top:8px;padding:6px 10px;background:rgba(231,76,60,0.12);border-left:3px solid #e74c3c;border-radius:6px;font-size:0.82em;color:#e0e0e0;line-height:1.5;">🔴 Foorada waxay ku dhacday <span style="color:#e74c3c;font-weight:700">${fooroTarget.name}</span> — ${sababta}</div>`;
        }
        openInfo.innerHTML = `${xiradLine}<div style="font-size:0.85em;width:100%">${rows}</div>${fooroLine}`;
      }
    }, 1500);
  });

  socket.on('hoosgaleTriggered', () => {
    showNotification('HOOSGALE! Kaarahaagii waa laga qaaday.', 5000);
    myHand = []; isOpened = false; iHaveOpened = false; myOpenedSets = [];
    hasDrawn = false; pickedFromDiscard = false; lastPickedDiscardId = null;
    renderAll();
  });

  socket.on('notification', msg => showNotification(msg));

  // FIX: Bot-ka marka uu tuurista ka qaato, kaartiisa lama muujiyo - "Lama oga"
  socket.on('botPickedDiscard', (data) => {
    showNotification(`🤖 ${data.botName} wuxuu tuurista ka qaatay: Lama oga`, 3500);
    const el = $('discard-display');
    if (el) {
      el.classList.add('discard-bot-took');
      setTimeout(() => el.classList.remove('discard-bot-took'), 800);
    }
  });

  socket.on('timerPaused', data => {
    clearInterval(turnTimerInterval);
    showNotification(data.message, 6000);
    const btn = $('btn-pause');
    const isMe = socket && data.activePlayerId === socket.id;
    if (btn && isMe) { btn.textContent = 'Fasax'; btn.dataset.paused = 'true'; btn.style.background = '#f39c12'; }
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
  if (document.visibilityState === 'visible' && socket && inGame) socket.emit('request_sync');
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
      if (pickedFromDiscard && !isOpened) { if (socket) socket.emit('returnDiscardCard'); return; }
      const isPaused = btnPause.dataset.paused === 'true';
      if (!isPaused) {
        if (socket) socket.emit('pauseTimer');
        btnPause.textContent = 'Fasax'; btnPause.dataset.paused = 'true'; btnPause.style.background = '#f39c12';
        clearInterval(turnTimerInterval);
      } else {
        if (socket) socket.emit('resumeTimer');
        btnPause.textContent = 'Isuga'; btnPause.dataset.paused = 'false'; btnPause.style.background = '';
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
