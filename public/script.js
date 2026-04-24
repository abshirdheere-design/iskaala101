/* SOCKET SETUP */
const socket = io();

/* STATE & GLOBAL VARIABLES */
let myHand = [];
let isMyTurn = false;
let hasDrawn = false;
let pickedFromDiscard = false;   // Inuu tuurista ka soo qaatay (Xeerka 101)
let isOpened = false;            // Inuu hore u degay (Opened 101)
let iHaveOpened = false; 
let myOpenedSets = []; // Meesha lagu kaydiyo kaararka aad degtay
let temporaryScore = 0; // Dhibcaha urursanaya ka hor 101
let setsOfTopPlayer = [];
let setsOfLeftPlayer = [];
let setsOfRightPlayer = [];
let dragStartIndex = null;

const pointValues = { 
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 
    'j': 10, 'q': 10, 'k': 10, 'a': 11 
};

// Hubinta xeerka 101 iyo in ugu yaraan hal koox ay tahay 4+ kaar
function karaaInuuDego(sets) {
    const hasFourOrMore = sets.some(set => set.length >= 4);
    return hasFourOrMore;
}

/* RENDER HAND (Cusboonaysiin) */
function renderMyHand() {
    const area = document.getElementById("my-hand");
    if (!area) return;
    area.innerHTML = ""; 

    myHand.forEach((card, index) => {
        const cardDiv = document.createElement("div");
        cardDiv.className = `card ${card.selected ? 'selected' : ''}`;
        cardDiv.dataset.index = index;
        cardDiv.draggable = true;

        const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
        const suitLetter = suitMap[card.suit] || 's';

        const val = String(card.value).toLowerCase();
        const fileName = `${val}${suitLetter}.svg`;

        cardDiv.innerHTML = `
            <img src="/cards/${fileName}" 
                 style="width: 100%; height: 100%; pointer-events: none; border-radius: 5px;">
        `;

        cardDiv.onclick = () => {
            card.selected = !card.selected;
            renderMyHand();
            if (typeof calculateTemporaryScore === "function") calculateTemporaryScore();
        };

        cardDiv.addEventListener("dragstart", (e) => { dragStartIndex = index; e.target.style.opacity = "0.5"; });
        cardDiv.addEventListener("dragover", (e) => e.preventDefault());
        cardDiv.addEventListener("drop", handleDrop);

        area.appendChild(cardDiv);
    });
}

/* XISAABINTA DHIBCAHA (MELDS) */
function calculateTemporaryScore() {
    const selectedCards = myHand.filter(c => c.selected);
    if (selectedCards.length === 0) {
        const scoreDisplay = document.getElementById("temp-score-display");
        if (scoreDisplay) scoreDisplay.textContent = "0";
        return 0;
    }

    let score = 0;
    for (const c of selectedCards) {
        score += pointValues[c.value] || 0;
    }

    const scoreDisplay = document.getElementById("temp-score-display");
    if (scoreDisplay) scoreDisplay.textContent = score;

    return score;
}

function renderMyTableSets() {
    const tableArea = document.getElementById("my-table-sets");
    if (!tableArea) return;

    tableArea.innerHTML = "";

    myOpenedSets.forEach(set => {
        const setDiv = document.createElement("div");
        setDiv.className = "card-set";

        set.forEach(card => {
            const cDiv = document.createElement("div");
            cDiv.className = `card small ${card.suit === '♦' || card.suit === '♥' ? 'red' : ''}`;

            cDiv.innerHTML = `
                <span class="v">${card.value}</span>
                <span class="s">${card.suit}</span>
            `;

            setDiv.appendChild(cDiv);
        });

        tableArea.appendChild(setDiv);
    });
}

function handleResetDhigista() {
    if (iHaveOpened) {
        alert("Hore ayaad u degtay, kama noqon kartid kaararka miiska!");
        return;
    }

    for (const set of myOpenedSets) {
        for (const card of set) {
            myHand.push({
                value: card.value,
                suit: card.suit,
                selected: false
            });
        }
    }

    myOpenedSets = [];
    temporaryScore = 0;

    renderMyHand();
    renderMyTableSets();

    const scoreDisplay = document.getElementById("temp-score-display");
    if (scoreDisplay) scoreDisplay.textContent = "0";

    alert("Kaararkii waa lagu soo celiyay gacantaada.");
}

function processGroups(selectedCards) {
    // 1. Kala saar kaararka (Sort)
    // 2. Isku day inaad ka dhex dhaliso kooxaha (Groups)
    let groups = [];
    let currentGroup = [selectedCards[0]];

    for (let i = 1; i < selectedCards.length; i++) {
        // Haddii kaarka hadda iyo kii ka horreeyay ay isku xigaan (Serial)
        // ama ay isku nambar yihiin (Set), isku dhex hay.
        if (isCompatible(selectedCards[i], selectedCards[i-1])) {
            currentGroup.push(selectedCards[i]);
        } else {
            groups.push(currentGroup);
            currentGroup = [selectedCards[i]];
        }
    }
    groups.push(currentGroup);
    return groups;
}

function calculateTemporaryScore() {
    const selectedCards = myHand.filter(c => c.selected);
    const scoreDisplay = document.getElementById("temp-score-display");

    if (selectedCards.length === 0) {
        if (scoreDisplay) scoreDisplay.textContent = "0";
        return 0;
    }

    let score = 0;
    for (const c of selectedCards) {
        // 🔥 Waa muhiim si loo garto 'j', 'q', 'k', 'a'
        const val = String(c.value).toLowerCase();
        score += pointValues[val] || 0;
    }

    if (scoreDisplay) scoreDisplay.textContent = score;
    return score;
}

document.addEventListener("DOMContentLoaded", () => {
    // 1. Badhanka Dhigo
    const dhigoBtn = document.getElementById("dhigoBtn");
    if (dhigoBtn) dhigoBtn.onclick = handleDhigista;

    // 2. Badhanka Ka noqo (Reset)
    const resetBtn = document.getElementById("resetBtn");
    if (resetBtn) resetBtn.onclick = handleResetDhigista;

    // 3. Badhanka Sort
    const sortBtn = document.getElementById("sortBtn");
    if (sortBtn) sortBtn.onclick = handleSort;

    // 4. Badhanka Tuur
    const tuurBtn = document.getElementById("tuurBtn");
    if (tuurBtn) tuurBtn.onclick = handleTuurista;
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
        console.log("Sync cusub ayaa la codsaday...");
        socket.emit("request_sync"); // Server-ka ha u soo diro xogta cusub
    }
});

/* ACTIONS */
function handleDhigista() {
    if (!isMyTurn) return alert("Sug doorkaaga!");

    let selectedCards = myHand.filter(c => c.selected);
    if (selectedCards.length < 3) {
        return alert("Koox kasta waa inay ugu yaraan 3 kaar noqotaa!");
    }

    if (!isSerial(selectedCards) && !isSet(selectedCards)) {
        return alert("Kaararka aad dooratay ma ahan koox sax ah (Set ama Serial).");
    }

    let currentSetScore = selectedCards.reduce((sum, c) => {
        const val = String(c.value).toLowerCase();
        return sum + (pointValues[val] || 0);
    }, 0);

    if (!isOpened) {
        temporaryScore += currentSetScore;
        myOpenedSets.push([...selectedCards]);

        myHand = myHand.filter(c => !c.selected);
        renderMyHand();
        renderMyTableSets();

        if (temporaryScore >= 101) {
            const hasFourCardGroup = myOpenedSets.some(set => set.length >= 4);

            if (!hasFourCardGroup) {
                alert("101 waad gaartay, laakiin waa inaad haysataa ugu yaraan hal koox oo 4+ kaar ah!");
            } else {
                isOpened = true;
                iHaveOpened = true;

                socket.emit("playerOpens", {
                    cards: selectedCards, 
                    allSets: myOpenedSets,
                    totalScore: temporaryScore
                });

                alert("Hambalyo! Waad degtay. Dhibcahaaga: " + temporaryScore);
            }
        } else {
            alert(`Wadarta hadda: ${temporaryScore}. Sii wad ilaa 101!`);
        }

    } else {
        socket.emit("addToTable", { cards: selectedCards });

        myOpenedSets.push([...selectedCards]);
        myHand = myHand.filter(c => !c.selected);

        renderMyHand();
        renderMyTableSets();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const dhigoBtn = document.getElementById("dhigoBtn");
    if (dhigoBtn) {
        dhigoBtn.onclick = handleDhigista;
    }

    const resetBtn = document.getElementById("resetBtn");
    if (resetBtn) {
        resetBtn.onclick = handleResetDhigista;
    }
});

/* FUNCTION-KA KALA QAYBIYA KAARARKA (ALGORITHM) */
function autoSplitIntoGroups(cards) {
    let groups = [];
    let remaining = [...cards];
    let suits = ['♠', '♥', '♣', '♦'];
    
    suits.forEach(suit => {
        let suitCards = remaining.filter(c => c.suit === suit);
        if (suitCards.length >= 3) {
            if (isSerial(suitCards)) {
                groups.push(suitCards);
                remaining = remaining.filter(c => c.suit !== suit);
            }
        }
    });

    let values = [...new Set(remaining.map(c => c.value))];
    values.forEach(val => {
        let valCards = remaining.filter(c => c.value === val);
        if (valCards.length >= 3) {
            groups.push(valCards);
            remaining = remaining.filter(c => c.value !== val);
        }
    });

    return groups;
}

function handleSort() {
    const sortOrder = { 
        '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 
        'j': 11, 'q': 12, 'k': 13, 'a': 14 
    };

    const suitOrder = { '♠': 4, '♥': 3, '♦': 2, '♣': 1 };

    myHand.sort((a, b) => {
        const valA = String(a.value).toLowerCase();
        const valB = String(b.value).toLowerCase();
        
        const rankA = sortOrder[valA] || 0;
        const rankB = sortOrder[valB] || 0;

        if (a.suit !== b.suit) {
            return suitOrder[b.suit] - suitOrder[a.suit];
        }
        
        return rankB - rankA; 
    });

    myHand.forEach(c => c.selected = false);
    renderMyHand();
}

function handleDragOver(e) {
    e.preventDefault(); 
}

function handleDrop(e) {
    const dropCard = e.target.closest(".card");
    if (!dropCard || dragStartIndex === null) return;

    const dragEndIndex = +dropCard.dataset.index;

    if (dragStartIndex !== dragEndIndex) {
        const [movedCard] = myHand.splice(dragStartIndex, 1);
        myHand.splice(dragEndIndex, 0, movedCard);
    }

    dragStartIndex = null;
    renderMyHand();
}

function renderSets(elementId, sets) {
    const area = document.getElementById(elementId);
    area.innerHTML = "";

    sets.forEach(set => {
        const setDiv = document.createElement("div");
        setDiv.className = "card-set";

        set.forEach(card => {
            const cDiv = document.createElement("div");
            cDiv.className = "card small";
            cDiv.innerHTML = `${card.value}${card.suit}`;
            setDiv.appendChild(cDiv);
        });

        area.appendChild(setDiv);
    });
}

socket.on("updateTableUI", (data) => {
    const { playerId, allSets, nextRequiredPoints } = data;

    const tableArea = document.getElementById("table-area");
    if (!tableArea) return;

    const safeId = playerId.replace(/[^a-zA-Z0-9_-]/g, "");

    let playerTable = document.getElementById(`table-${safeId}`);
    if (!playerTable) {
        playerTable = document.createElement("div");
        playerTable.id = `table-${safeId}`;
        playerTable.classList.add("player-table");
        tableArea.appendChild(playerTable);
    }

    playerTable.innerHTML = "";

    allSets.forEach(set => {
        const setDiv = document.createElement("div");
        setDiv.classList.add("set");

        set.forEach(card => {
            const cardDiv = document.createElement("div");
            cardDiv.classList.add("card", "mini-card");

            const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
            const suitLetter = suitMap[card.suit] || 's';
            const val = String(card.value).toLowerCase();
            const fileName = `${val}${suitLetter}.svg`;

            cardDiv.innerHTML = `<img src="/cards/${fileName}" style="width: 100%; height: 100%; border-radius: 2px;">`;
            setDiv.appendChild(cardDiv);
        });

        playerTable.appendChild(setDiv);
    });

    const req = document.getElementById("requiredPoints");
    if (req) req.innerText = nextRequiredPoints;
});

/* HELPER FUNCTIONS */
function isSet(cards) {
    if (cards.length < 3) return false;

    const value = cards[0].value;
    const suits = new Set();

    for (let c of cards) {
        if (c.value !== value) return false;
        if (suits.has(c.suit)) return false;
        suits.add(c.suit);
    }

    return true;
}

function isSerial(cards) {
    if (cards.length < 3) return false;

    const suit = cards[0].suit;
    if (!cards.every(c => c.suit === suit)) return false;

    const valueOrder = {
        "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
        "J": 11, "Q": 12, "K": 13, "A": 14
    };

    const mapped = cards.map(c => valueOrder[c.value]);
    if (mapped.includes(undefined)) return false;

    mapped.sort((a, b) => a - b);

    for (let i = 0; i < mapped.length - 1; i++) {
        if (mapped[i + 1] !== mapped[i] + 1) return false;
    }

    return true;
}

function startTheGame() {
    const name = document.getElementById("nameInput").value;
    
    if (name) {
        document.getElementById("setup-screen").style.display = "none";
        document.getElementById("main-header").style.display = "flex";
        document.getElementById("game-table").style.display = "block";
        document.querySelector(".player-hand-section").style.display = "flex";
        socket.emit('joinRandom', name);
    }
}

function handleTuurista() {
    if (!isMyTurn) return;

    if (myHand.length === 14) {
        alert("Fadlan marka hore kaar qaado!");
        return;
    }

    if (pickedFromDiscard && !isOpened) {
        const canOpenNow = calculateTemporaryScore() >= 101;
        if (!canOpenNow) {
            alert("Maadaama aad tuurista qaadatay, waa inaad degtaa (101)! Maadaama dhibcahaagu yaryihiin, dib u soo celi kaarka.");
            return;
        } else {
            alert("Fadlan marka hore riix 'Dhigo' si aad u degto!");
            return;
        }
    }

    const selectedIndex = myHand.findIndex(c => c.selected);
    if (selectedIndex === -1) {
        alert("Dooro kaarka aad tuurayso!");
        return;
    }

    const remaining = myHand.length - 1;
    if (remaining === 1 || remaining === 2) {
        alert("Xeerka Batuutada: Ma kuu hari karaan 1 ama 2 xabo oo kaliya!");
        return;
    }

    const cardToPlay = myHand[selectedIndex];
    socket.emit("playCard", cardToPlay);

    myHand.splice(selectedIndex, 1);
    isMyTurn = false;
    hasDrawn = false;
    pickedFromDiscard = false;
    renderMyHand();
    if (timerInterval) clearInterval(timerInterval);
}

/* KEEP ALIVE (MOBILKA) */
setInterval(() => {
    if (socket && socket.connected) {
        socket.emit("ping_keep_alive"); 
    }
}, 10000); 

function switchUItoGame() {
    const setupScreen = document.getElementById("setup-screen");
    const waitingRoom = document.getElementById("waiting-room");
    const mainHeader = document.getElementById("main-header");
    const gameTable = document.getElementById("game-table");
    const myHandSection = document.getElementById("my-hand-section");

    if (setupScreen) setupScreen.style.display = "none";
    if (waitingRoom) waitingRoom.style.display = "none";
    if (mainHeader) mainHeader.style.display = "flex";
    if (gameTable) gameTable.style.display = "flex";
    if (myHandSection) myHandSection.style.display = "flex";
}

socket.on("matchFound", (data) => {
    setTimeout(switchUItoGame, 1500); 
});

socket.on("startHand", (hand) => {
    myHand = hand.map(c => ({...c, selected:false}));
    if (document.getElementById("waiting-room").style.display !== "none") {
        switchUItoGame();
    }
    renderMyHand();
});

document.getElementById("startGameBtn").onclick = () => {
    const nameInput = document.getElementById("nameInput");
    const name = nameInput.value.trim();
    if (!name) return alert("Fadlan magacaaga qor!");

    localStorage.setItem("turub_user_name", name);
    document.getElementById("setup-screen").style.display = "none";
    document.getElementById("waiting-room").style.display = "block";
    socket.emit("joinRandom", name);
};

/* AUTO-LOAD NAME (RECONNECT FIX) */
window.addEventListener("load", () => {
    const savedName = localStorage.getItem("turub_user_name");
    const nameInput = document.getElementById("nameInput");
    if (savedName && nameInput) {
        nameInput.value = savedName;
    }
});

/* EVENT LISTENERS */
socket.on("waitingRoomUpdate", (data) => {
    const statusText = document.getElementById("waiting-status");
    const listArea = document.getElementById("players-list");

    if (!data || !data.players) return;

    const count = data.players.length;
    const dhiman = 4 - count;

    if (listArea) {
        listArea.innerHTML = "";
        data.players.forEach(p => {
            const pDiv = document.createElement("div");
            pDiv.style.cssText = `padding:8px; margin:5px; background:rgba(255,255,255,0.1); border-radius:5px; width:100%; text-align:center;`;
            pDiv.innerHTML = `✅ <b>${p.name}</b> waa diyaar`;
            listArea.appendChild(pDiv);
        });
    }

    if (statusText) {
        statusText.style.display = "block";
        if (dhiman > 0) {
            const magacyo = { 1: "hal ciyaartooy", 2: "laba ciyaartooy", 3: "saddex ciyaartooy" };
            const text = magacyo[dhiman] || `${dhiman} ciyaartooy`;
            statusText.innerText = `Waxaa dhiman ${text}: ${count}/4`;
        } else {
            statusText.innerText = "Dhammaan waa la helay! Ciyaartu waa bilaabanaysaa...";
        }
    }
});

socket.on("playersUpdate", (data) => {
    const { players, stockCount, currentTurnId, turnStartTime } = data;

    isMyTurn = (currentTurnId === socket.id);

    const statusEl = document.getElementById("turnText");
    
    // Nadiifi timer-kii hore haddii uu jiro
    if (timerInterval) clearInterval(timerInterval);

    if (isMyTurn) {
        // --- XISAABI WAQTIGA HARAY ---
        // turnStartTime waa waqtigii doorku bilaawday (ka yimid server-ka)
        const now = Date.now();
        const elapsed = Math.floor((now - turnStartTime) / 1000);
        let timeLeft = 30 - elapsed;

        if (timeLeft > 0) {
            timerInterval = setInterval(() => {
                timeLeft--;
                let msg = myHand.length >= 15 ? "TUUR XABBAD!" : "DOORKAAGA!";
                
                if (statusEl) {
                    statusEl.innerHTML = `<b style="color:#2ecc71">${msg} (${timeLeft}s)</b>`;
                }

                if (timeLeft <= 0) {
                    clearInterval(timerInterval);
                    socket.emit("forceEndTurn");
                }
            }, 1000);
        } else {
            if (statusEl) statusEl.textContent = "WAQTIGII WAA KA DHAMAADAY!";
        }
    } else {
        if (statusEl) {
            statusEl.textContent = "Sugaya...";
            statusEl.style.color = "#f1c40f";
        }
    }

    // Fur/Xir badhamada
    const btns = ["dhigoBtn", "tuurBtn", "resetBtn"];
    btns.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !isMyTurn;
    });

    const stockEl = document.getElementById("stock-count");
    if (stockEl) stockEl.textContent = stockCount;
});

/* GAME START LISTENER */
socket.on("matchFound", (data) => {
    setTimeout(() => {
        switchUItoGame();
        const nameInput = document.getElementById("nameInput");
        const displayName = document.getElementById("display-name");
        if (displayName && nameInput) displayName.textContent = nameInput.value;
        renderMyHand();
    }, 1500);
});

socket.on("receiveCard", (card) => {
    myHand.push({ ...card, selected: false });
    hasDrawn = true;
    renderMyHand();
});

let timerInterval = null;
socket.on("discardPickedSuccess", (card) => {
    myHand.push({ ...card, selected: false });
    hasDrawn = true;
    pickedFromDiscard = true;
    renderMyHand();
});

socket.on("yourTurn", (playerId) => {
    isMyTurn = (playerId === socket.id);
    if (isMyTurn) hasDrawn = false; 

    const statusEl = document.getElementById("turnText");
    const qaadashadaEl = document.getElementById("stock-pile");

    clearInterval(timerInterval); 

    if (isMyTurn) {
        if (qaadashadaEl) {
            qaadashadaEl.style.pointerEvents = "auto";
            qaadashadaEl.style.opacity = "1";
            qaadashadaEl.style.border = "3px solid #f1c40f";
        }

        let timeLeft = 30;
        timerInterval = setInterval(() => {
            timeLeft--;
            let msg = myHand.length >= 15 ? "TUUR XABBAD!" : "DOORKAAGA!";
            if (statusEl) statusEl.innerHTML = `<b>${msg} (${timeLeft}s)</b>`;
            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                socket.emit("forceEndTurn"); 
            }
        }, 1500);
    } else {
        if (qaadashadaEl) {
            qaadashadaEl.style.pointerEvents = "none";
            qaadashadaEl.style.opacity = "0.6";
        }
        if (statusEl) statusEl.textContent = "Sugaya...";
    }
    renderMyHand();
});

socket.on("updateDiscardPile", (card) => {
    const pile = document.getElementById("discard-pile");
    if (!pile) return;
    pile.innerHTML = "";

    if (card) {
        const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
        const val = String(card.value).toLowerCase();
        const fileName = `${val}${suitMap[card.suit] || 's'}.svg`;
        const cardDiv = document.createElement("div");
        cardDiv.className = "card";
        cardDiv.innerHTML = `<img src="/cards/${fileName}" style="width: 100%; height: 100%; border-radius: 5px;">`;
        pile.appendChild(cardDiv);
    }
});

socket.on("updateOpponents", (data) => {
    const topEl = document.getElementById("top-name");
    const leftEl = document.getElementById("left-name");
    const rightEl = document.getElementById("right-name");

    if (topEl)  topEl.innerText  = data.top  ? data.top.name  : "";
    if (leftEl) leftEl.innerText = data.left ? data.left.name : "";
    if (rightEl) rightEl.innerText = data.right ? data.right.name : "";
});

const stockPile = document.getElementById("stock-pile");
if (stockPile) {
    stockPile.onclick = () => {
        if (!isMyTurn || hasDrawn) return;
        socket.emit("drawCard");
        hasDrawn = true;
        pickedFromDiscard = false;
    };
}

const discardPile = document.getElementById("discard-pile");
if (discardPile) {
    discardPile.onclick = () => {
        if (!isMyTurn || hasDrawn) return;
        socket.emit("pickDiscard");
        hasDrawn = true;
        pickedFromDiscard = true;
    };
}

const tuurBtn = document.getElementById("tuurBtn");
if (tuurBtn) {
    tuurBtn.onclick = handleTuurista;
}

socket.on("gameOver", ({ winnerName }) => {
    alert("Ciyaarta waxaa ku guuleystay: " + winnerName);
    location.reload();
});