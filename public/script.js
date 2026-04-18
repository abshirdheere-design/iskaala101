/* ================= SOCKET SETUP ================= */
const socket = io();

/* ================= STATE & GLOBAL VARIABLES ================= */
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

const pointValues = { 
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 
    'J': 10, 'Q': 10, 'K': 10, 'A': 11 
};

// Hubinta xeerka 101 iyo in ugu yaraan hal koox ay tahay 4+ kaar
function karaaInuuDego(sets) {
    const hasFourOrMore = sets.some(set => set.length >= 4);
    return hasFourOrMore;
}

/* ================= RENDER HAND ================= */
function renderMyHand() {
    const area = document.getElementById("my-hand");
    const countBadge = document.getElementById("card-count-badge");
    const tuurBtn = document.getElementById("tuurBtn");

    if (!area) return;
    area.innerHTML = ""; // Nadiifi gacanta ka hor intaanan dib u sawirin

    // 1. Cusboonaysii tirada kaararka
    if (countBadge) countBadge.textContent = myHand.length;

    // 2. Badhanka TUUR logic-ga
    if (tuurBtn) {
        tuurBtn.style.display = (isMyTurn && (myHand.length === 15 || hasDrawn)) ? "block" : "none";
    }

    // 3. Sawir kaar kasta oo gacanta ku jira
    myHand.forEach((card, index) => {
        const cardDiv = document.createElement("div");
        cardDiv.draggable = true;
        cardDiv.dataset.index = index;
        // Ku dar class-yada CSS-ka
        cardDiv.className = `card ${card.selected ? 'selected' : ''}`;
        
        // Midabka gaduudka (Hearts/Diamonds)
        const isRed = (card.suit === '♥' || card.suit === '♦');
        if (isRed) cardDiv.classList.add("red-card");

        // Dhismaha gudaha ee kaarka
        cardDiv.innerHTML = `
            <div class="card-top">
                <span>${card.value}</span>
                <span>${card.suit}</span>
            </div>
            <div class="card-center">${card.suit}</div>
            <div class="card-bottom">
                <span>${card.suit}</span>
                <span>${card.value}</span>
            </div>
        `;

        // Marka kaarka la riixo (Selection)
        cardDiv.onclick = () => {
            card.selected = !card.selected;
            renderMyHand(); // Dib u sawir si 'selected' u muuqato
            if (typeof calculateTemporaryScore === "function") {
                calculateTemporaryScore();
            }
        };

        // DRAG EVENTS
        cardDiv.addEventListener("dragstart", handleDragStart);
        cardDiv.addEventListener("dragover", handleDragOver);
        cardDiv.addEventListener("drop", handleDrop);

        area.appendChild(cardDiv);
    });
}

function isSerial(cards) {
    if (cards.length < 3) return false;

    // Sort by value
    let sorted = [...cards].sort((a, b) => a.rank - b.rank);

    // Check same suit
    let sameSuit = sorted.every(c => c.suit === sorted[0].suit);
    if (!sameSuit) return false;

    // Check consecutive
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].rank !== sorted[i - 1].rank + 1) {
            return false;
        }
    }
    return true;
}

function isSet(cards) {
    if (cards.length < 3) return false;
    return cards.every(c => c.value === cards[0].value);
}

/* ================= XISAABINTA DHIBCAHA (MELDS) ================= */
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

    // 1. Soo celi kaararka miiska ku-meel-gaarka ah
    for (const set of myOpenedSets) {
        for (const card of set) {
            myHand.push({
                value: card.value,
                suit: card.suit,
                selected: false
            });
        }
    }

    // 2. Nadiifi xogta ku-meel-gaarka ah
    myOpenedSets = [];
    temporaryScore = 0;

    // 3. Dib u sawir gacanta iyo miiska
    renderMyHand();
    renderMyTableSets();

    const scoreDisplay = document.getElementById("temp-score-display");
    if (scoreDisplay) scoreDisplay.textContent = "0";

    alert("Kaararkii waa lagu soo celiyay gacantaada.");
}


/* ================= ACTIONS ================= */

function handleDhigista() {
    if (!isMyTurn) return alert("Sug doorkaaga!");

    let selectedCards = myHand.filter(c => c.selected);
    if (selectedCards.length < 3) return alert("Koox kasta waa inay ugu yaraan 3 kaar noqotaa!");

    // 1. Hubi haddii kooxda hadda la doortay ay sax tahay
    if (!isSerial(selectedCards) && !isSet(selectedCards)) {
        return alert("Kaararka aad dooratay ma ahan koox sax ah (Set ama Serial).");
    }

    // 2. Xisaabi dhibcaha kooxdan cusub
    let currentSetScore = selectedCards.reduce((sum, c) => sum + (pointValues[c.value] || 0), 0);

    if (!isOpened) { // Halkan waxaan u isticmaalnay 'isOpened' oo ah state-ka rasmiga ah
        // --- URURINTA KUMEEL-GAARKA AH ---
        temporaryScore += currentSetScore;
        myOpenedSets.push([...selectedCards]); 

        // Ka saar gacanta si ku-meel-gaar ah
        myHand = myHand.filter(c => !c.selected);
        renderMyHand();
        renderMyTableSets();

        // 3. Xeerka 101: Haddii wadarta kumeel-gaarka ah ay gaarto 101
        if (temporaryScore >= 101) {
            const hasFourCardGroup = myOpenedSets.some(set => set.length >= 4);

            if (!hasFourCardGroup) {
                // Haddii dhibcuhu 101 gaareen laakiin aan la haysan 4-xabo
                alert("101 waad gaartay, laakiin xeerka Iskaala wuxuu rabaa ugu yaraan hal koox oo 4+ kaar ah. Sii wad dhigista!");
                return; 
            }

            // 🔥 Hadda u dir Server-ka dhammaan wixii miiska kumeel-gaarka ah saarnaa
            isOpened = true; // State-ka guud u beddel true
            socket.emit("playerOpens", {
                allSets: myOpenedSets, 
                totalScore: temporaryScore
            });

            alert("Hambalyo! Waad degtay. Dhibcahaaga: " + temporaryScore);
        } else {
            alert(`Kooxda waa la qabtay. Wadarta hadda: ${temporaryScore}. Sii wad ilaa 101!`);
        }

    } else {
        // Haddii uu qofku hore u degay (Turn-yadii hore)
        socket.emit("addToTable", { cards: selectedCards });
        myOpenedSets.push([...selectedCards]);
        myHand = myHand.filter(c => !c.selected);
        renderMyHand();
        renderMyTableSets();
    }
}

// 🔥 FUNCTION-KA KALA QAYBIYA KAARARKA (ALGORITHM)
function autoSplitIntoGroups(cards) {
    let groups = [];
    let remaining = [...cards];

    // Marka hore u kala saar midabada (Suits)
    let suits = ['♠', '♥', '♣', '♦'];
    
    // 1. Raadi Serials (isku midab ah oo is xiga)
    suits.forEach(suit => {
        let suitCards = remaining.filter(c => c.suit === suit);
        if (suitCards.length >= 3) {
            // Halkan waxaa u baahan tahay isSerial-kaaga oo yar oo la habeeyay
            if (isSerial(suitCards)) {
                groups.push(suitCards);
                remaining = remaining.filter(c => c.suit !== suit);
            }
        }
    });

    // 2. Raadi Sets (isku qiimo ah oo midab duwan)
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
        'J': 11, 'Q': 12, 'K': 13, 'A': 14 
    };

    myHand.sort((a, b) => {
        if (a.suit !== b.suit) {
            return a.suit.localeCompare(b.suit);
        }
        return (sortOrder[a.value] || 0) - (sortOrder[b.value] || 0);
    });

    myHand.forEach(c => c.selected = false);

    renderMyHand();
}


let dragStartIndex = null;

function handleDragStart(e) {
    const card = e.target.closest(".card");
    if (!card) return;
    dragStartIndex = +card.dataset.index;
}

function handleDragOver(e) {
    e.preventDefault(); // Waa muhiim si drop u shaqeeyo
}

function handleDrop(e) {
    const dropCard = e.target.closest(".card");
    if (!dropCard) return;

    const dragEndIndex = +dropCard.dataset.index;

    // Badal boosaska labada kaar
    const temp = myHand[dragStartIndex];
    myHand[dragStartIndex] = myHand[dragEndIndex];
    myHand[dragEndIndex] = temp;

    // Ka saar selection-ka
    myHand.forEach(c => c.selected = false);

    // Dib u sawir gacanta
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

renderSets("my-table-sets", myOpenedSets);          // Adiga
renderSets("top-table", setsOfTopPlayer);           // Kore
renderSets("left-table", setsOfLeftPlayer);         // Bidix
renderSets("right-table", setsOfRightPlayer);       // Midig



socket.on("updateTableUI", (data) => {
    const { playerId, allSets, nextRequiredPoints } = data;

    const tableArea = document.getElementById("table-area");
    if (!tableArea) return;

    // 1. Hubi in ID-ga uu yahay mid sax ah oo HTML-ku aqbali karo
    const safeId = playerId.replace(/[^a-zA-Z0-9_-]/g, "");

    let playerTable = document.getElementById(`table-${safeId}`);
    if (!playerTable) {
        playerTable = document.createElement("div");
        playerTable.id = `table-${safeId}`;
        playerTable.classList.add("player-table");
        tableArea.appendChild(playerTable);
    }

    // 2. Nadiifi miiska
    playerTable.innerHTML = "";

    // 3. Ku dar set-yada
    allSets.forEach(set => {
        const setDiv = document.createElement("div");
        setDiv.classList.add("set");

        set.forEach(card => {
            const cardDiv = document.createElement("div");
            cardDiv.classList.add("card", "mini-card");
            cardDiv.innerHTML = `${card.value}${card.suit}`;
            setDiv.appendChild(cardDiv);
        });

        playerTable.appendChild(setDiv);
    });

    // 4. Update next required points
    const req = document.getElementById("requiredPoints");
    if (req) req.innerText = nextRequiredPoints;
});


/* ================= HELPER FUNCTIONS ================= */
function isSerial(cards) {
    if (cards.length < 3) return false;

    // 1. Dhammaan waa inay isku suit noqdaan
    const suit = cards[0].suit;
    if (!cards.every(c => c.suit === suit)) return false;

    // 2. Qiimaha kaararka
    const valueOrder = {
        "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
        "J": 11, "Q": 12, "K": 13, "A": 14
    };

    // 3. Haddii value aan la aqoon → serial ma noqon karo
    const mapped = cards.map(c => valueOrder[c.value]);
    if (mapped.includes(undefined)) return false;

    // 4. Kala saar
    mapped.sort((a, b) => a - b);

    // 5. Hubi in ay isku xiga yihiin
    for (let i = 0; i < mapped.length - 1; i++) {
        if (mapped[i + 1] !== mapped[i] + 1) {
            return false;
        }
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


// Raadi function-ka bilaaba ciyaarta
function startTheGame() {
    const name = document.getElementById("nameInput").value;
    
    if (name) {
        // 1. Qari setup-ka
        document.getElementById("setup-screen").style.display = "none";
        
        // 2. Soo saar miiska iyo header-ka
        document.getElementById("main-header").style.display = "flex";
        document.getElementById("game-table").style.display = "block";
        
        // 3. 🔥 SOO SAAR GACANTA IYO BADHAMADA (Hadda ayay soo muuqanayaan)
        // Maadaama CSS-ka uu yahay Class (.), isticmaal querySelector
        document.querySelector(".player-hand-section").style.display = "flex";
        
        // 4. U sheeg server-ka
        socket.emit('joinRandom', name);
    }
}

function handleTuurista() {
    if (!isMyTurn) return alert("Ma aha doorkaaga!");

    // 1. Hubi inuu qofku kaar qaatay (server logic: p.hasActioned)
    // Haddii gacantu tahay 14 → waa inuu qaataa turub
    if (myHand.length === 14) {
        return alert("Fadlan marka hore kaar qaado (Stock ama Discard)!");
    }

    // 2. Hel kaarka la doortay
    const selectedIndex = myHand.findIndex(card => card.selected === true);
    if (selectedIndex === -1) {
        return alert("Fadlan dooro hal kaar oo aad tuurayso!");
    }

    const cardToDiscard = myHand[selectedIndex];

    // 3. U dir server-ka
    socket.emit("playCard", cardToDiscard);

    // 4. Ka saar gacanta
    myHand.splice(selectedIndex, 1);

    // 5. Deji state-ka
    isMyTurn = false;
    hasDrawn = false;

    // 6. Dib u sawir gacanta
    renderMyHand();

    // 7. Update UI
    const text = document.getElementById("turnText");
    if (text) {
        text.textContent = "Sugaya...";
        text.style.color = "#f1c40f";
    }
}


/* ================= EVENT LISTENERS ================= */

document.getElementById("startGameBtn").onclick = () => {
    const nameInput = document.getElementById("nameInput");
    const name = nameInput.value.trim();
    
    if (!name) return alert("Fadlan magacaaga qor!");

    // 1. Qari halkii magaca laga qorayay
    document.getElementById("setup-screen").style.display = "none";
    
    // 2. Muuji qolka sugitaanka ee cusub
    document.getElementById("waiting-room").style.display = "block";

    // 3. U dir server-ka magaca
    socket.emit("joinRandom", name);
};

// --- KU DAR KANI (Waa muhiim si magacyada loo arko) ---
socket.on("waitingRoomUpdate", (data) => {
    const listArea = document.getElementById("players-list");
    const statusText = document.getElementById("waiting-status");
    
    if (listArea) {
        listArea.innerHTML = ""; // Nadiifi liiskii hore
        data.players.forEach(p => {
            const pDiv = document.createElement("div");
            pDiv.style.padding = "10px";
            pDiv.style.marginBottom = "8px";
            pDiv.style.background = "rgba(46, 204, 113, 0.1)";
            pDiv.style.borderRadius = "8px";
            pDiv.style.color = "#fff";
            pDiv.style.textAlign = "left";
            pDiv.innerHTML = `✅ <b>${p.name}</b> waa diyaar`;
            listArea.appendChild(pDiv);
        });
    }

    if (statusText) {
        statusText.innerText = `Ciyaartoyda la helay: ${data.players.length}/4`;
    }
});

// Badhamada kale ee ciyaarta dhexdeeda
document.getElementById("dhigoBtn").onclick = handleDhigista;
document.getElementById("tuurBtn").onclick = handleTuurista;
document.getElementById("sortBtn").onclick = handleSort;
document.getElementById("resetBtn").onclick = handleResetDhigista;

// Qaadashada kaarka (Stock Pile)
document.getElementById("stock-pile").onclick = () => {
    if (!isMyTurn) return alert("Sug doorkaaga!");
    if (hasDrawn) return alert("Hore ayaad u qaadatay kaar turn-kan!");
    
    socket.emit("drawCard");
    console.log("Kaar ayaa laga codsaday server-ka...");
};


socket.on("playersUpdate", (data) => {
    const { players, stockCount, currentTurnId } = data;

    isMyTurn = (currentTurnId === socket.id);

    // Update turn text
    const statusEl = document.getElementById("turnText");
    if (statusEl) {
        statusEl.textContent = isMyTurn ? "Doorkaaga" : "Sugaya...";
        statusEl.style.color = isMyTurn ? "#2ecc71" : "#f1c40f";
    }

    // Update stock count
    const stockEl = document.getElementById("stock-count");
    if (stockEl) stockEl.textContent = stockCount;

    // Control buttons
    document.getElementById("dhigoBtn").disabled = !isMyTurn;
    document.getElementById("tuurBtn").disabled = !isMyTurn;
    document.getElementById("sortBtn").disabled = false; // sort always allowed
    document.getElementById("resetBtn").disabled = !isMyTurn;

    // Control piles
    document.getElementById("stock-pile").style.pointerEvents = isMyTurn ? "auto" : "none";
    document.getElementById("discard-pile").style.pointerEvents = isMyTurn ? "auto" : "none";
});



/* ================= GAME START LISTENER ================= */
socket.on("matchFound", (data) => {
    // 1. Qari shaashadaha hore
    const setupScreen = document.getElementById("setup-screen");
    const waitingRoom = document.getElementById("waiting-room");
    
    if (setupScreen) setupScreen.style.display = "none";
    if (waitingRoom) waitingRoom.style.display = "none"; // Tan ayaa muhiim ah!

    // 2. Muuji HEADER-KA
    const mainHeader = document.getElementById("main-header");
    if (mainHeader) mainHeader.style.display = "flex";

    // 3. Muuji Miiska Ciyaarta
    const gameTable = document.getElementById("game-table");
    if (gameTable) {
        gameTable.style.display = "flex";
        gameTable.style.visibility = "visible";
    }

    // 4. Muuji qaybta gacanta (Hand section)
    const myHandSection = document.getElementById("my-hand-section");
    if (myHandSection) myHandSection.style.display = "flex";

    // 5. Sax magaca ciyaaryahanka
    const nameInput = document.getElementById("nameInput");
    const displayName = document.getElementById("display-name");
    if (displayName && nameInput) displayName.textContent = nameInput.value;

    console.log("Ciyaartu waa bilaabatay, qolkii sugitaanka waa la xiray.");
    renderMyHand();
});


socket.on("startHand", (hand) => {
    myHand = hand.map(c => ({...c, selected:false}));
    renderMyHand();
});

socket.on("receiveCard", (card) => {
    myHand.push({ ...card, selected: false });
    hasDrawn = true; // Tan ayaa ka joojinaysa inuu mar kale gujiyo stock-pile
    renderMyHand();
});

let timerInterval = null;   // 🔥 Waa in uu halkan yaal
socket.on("discardPickedSuccess", (card) => {
    myHand.push({ ...card, selected: false });
    hasDrawn = true;
    pickedFromDiscard = true; // Qabo xogta inuu tuurista ka qaatay
    renderMyHand();
});

socket.on("yourTurn", (playerId) => {
    isMyTurn = (playerId === socket.id);
    if (isMyTurn) hasDrawn = false; 

    const statusEl = document.getElementById("turnText");
    const myHandArea = document.getElementById("my-hand");
    const qaadashadaEl = document.getElementById("stock-pile");

    clearInterval(timerInterval); 

    if (isMyTurn) {
        // --- DOORKAAGA ---
        if (qaadashadaEl) {
            qaadashadaEl.style.pointerEvents = "auto";
            qaadashadaEl.style.opacity = "1";
            qaadashadaEl.style.border = "3px solid #f1c40f";
        }
        
        if (myHandArea) myHandArea.classList.remove("not-my-turn");

        let timeLeft = 30;
        timerInterval = setInterval(() => {
            timeLeft--;
            let msg = myHand.length >= 15 ? "TUUR XABBAD!" : "DOORKAAGA!";
            let color = myHand.length >= 15 ? "#e74c3c" : "#2ecc71";
            
            if (statusEl) {
                statusEl.innerHTML = `<b style="color:${color}">${msg} (${timeLeft}s)</b>`;
            }

            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                if (statusEl) statusEl.innerHTML = "<b style='color:red'>WAQTIGII WAA KA DHAMAADAY!</b>";

                // --- KANI WAA XARIIQDA KELIYA EE LAGU DARAY ---
                // Waxay server-ka ku amraysaa inuu doorka qasab ku wareejiyo
                socket.emit("forceEndTurn"); 
            }
        }, 1500);

    } else {
        // --- SUGITAANKA ---
        if (qaadashadaEl) {
            qaadashadaEl.style.pointerEvents = "none";
            qaadashadaEl.style.opacity = "0.6";
            qaadashadaEl.style.border = "none";
        }

        if (myHandArea) myHandArea.classList.add("not-my-turn");
        
        if (statusEl) {
            statusEl.textContent = "Sugaya...";
            statusEl.style.color = "#f1c40f";
        }
    }

    renderMyHand();
});



socket.on("playersUpdate", (data) => {
    const stockCount = document.getElementById("stock-count");
    if (stockCount && data.stockCount !== undefined) {
        stockCount.innerText = data.stockCount;
    }
});


socket.on("updateDiscardPile", (card) => {
    const pile = document.getElementById("discard-pile");
    if (!pile) return;

    pile.innerHTML = "";

    if (card) {
        const cardDiv = document.createElement("div");
        cardDiv.className = "card";

        const isRed = (card.suit === '♥' || card.suit === '♦');
        cardDiv.style.color = isRed ? "red" : "black";

        cardDiv.innerHTML = `
            <div class="card-top"><span>${card.value}</span><span>${card.suit}</span></div>
            <div class="card-center">${card.suit}</div>
            <div class="card-bottom"><span>${card.suit}</span><span>${card.value}</span></div>
        `;

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


socket.on("updateOnlineCount", (count) => {
    const onlineCountElement = document.getElementById("online-count-number");
    if (onlineCountElement) {
        onlineCountElement.innerText = count;
    }
});

// QAADASHADA BADDA (Stock Pile)
const stockPile = document.getElementById("stock-pile");
if (stockPile) {
    stockPile.onclick = () => {
        if (!isMyTurn) return alert("Sug doorkaaga!");
        if (hasDrawn) return alert("Hore ayaad xabad u qaadatay!");
        
        socket.emit("drawCard");
        hasDrawn = true;
        pickedFromDiscard = false; // Maadaama uu badda ka qaatay, qasab maaha inuu dego
    };
}

// QAADASHADA TUURISTA (Discard Pile)
const discardPile = document.getElementById("discard-pile");
if (discardPile) {
    discardPile.onclick = () => {
        if (!isMyTurn) return alert("Sug doorkaaga!");
        if (hasDrawn) return alert("Hore ayaad xabad u soo qaadatay!");

        socket.emit("pickDiscard");
        hasDrawn = true;
        pickedFromDiscard = true; // Xusuuso inuu tuurista qaatay (Waa inuu degaa!)
    };
}

const tuurBtn = document.getElementById("tuurBtn");
if (tuurBtn) {
    tuurBtn.onclick = () => {
        if (!isMyTurn) return alert("Maahan doorkaaga!");
        if (!hasDrawn) return alert("Fadlan marka hore xabad soo qaado!");

        // XEERKA 101: Haddii uu tuurista qaatay, waa inuu horay u degay ama hadda degaa
        if (pickedFromDiscard && !isOpened) {
            return alert("Maadaama aad tuurista qaadatay, waa inaad degtaa (101) ka hor intaadan kaar tuurin!");
        }

        const selectedIndex = myHand.findIndex(c => c.selected);
        if (selectedIndex === -1) return alert("Dooro xabadda aad tuurayso!");

        // XEERKA BATUUTADA (Haraagu waa inuu noqdaa 0 ama 3+)
        // myHand.length - 1 waa inta u haraysa marka uu midkaas tuuro
        const remaining = myHand.length - 1;
        if (remaining === 1 || remaining === 2) {
            return alert("Xeerka Batuutada: Ma kuu hari karaan 1 ama 2 xabo oo kaliya! (Waa in ay 0 noqoto ama 3 iyo ka badan)");
        }

        const cardToPlay = myHand[selectedIndex];
        socket.emit("playCard", cardToPlay);

        // Nadiifi UI-ga iyo State-ka
        myHand.splice(selectedIndex, 1);
        isMyTurn = false;
        hasDrawn = false;
        pickedFromDiscard = false;
        renderMyHand();
        
        if (typeof timerInterval !== 'undefined') clearInterval(timerInterval);
    };
}

socket.on("gameOver", ({ winnerName }) => {
    alert("Ciyaarta waxaa ku guuleystay: " + winnerName);
    location.reload(); // Kani wuxuu dib u bilaabayaa bogga
});