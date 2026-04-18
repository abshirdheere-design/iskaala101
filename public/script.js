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
let dragStartIndex = null;

const pointValues = { 
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 
    'J': 10, 'Q': 10, 'K': 10, 'A': 11 
};

// Hubinta xeerka 101 iyo in ugu yaraan hal koox ay tahay 4+ kaar
function karaaInuuDego(sets) {
    const hasFourOrMore = sets.some(set => set.length >= 4);
    return hasFourOrMore;
}

/* ================= RENDER HAND (Cusboonaysiin) ================= */
function renderMyHand() {
    const area = document.getElementById("my-hand");
    if (!area) return;
    area.innerHTML = ""; 

    myHand.forEach((card, index) => {
        const cardDiv = document.createElement("div");
        cardDiv.className = `card ${card.selected ? 'selected' : ''}`;
        cardDiv.dataset.index = index;
        cardDiv.draggable = true;

        // U beddel Suits-ka xarfaha faylka (s, h, d, c)
        const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
        const suitLetter = suitMap[card.suit] || 's';
        const fileName = `${card.value}${suitLetter}.svg`;

        // Halkaan ayuu isbeddelka weyn ku jiraa (Isticmaalka Img)
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
    if (selectedCards.length < 3) {
        return alert("Koox kasta waa inay ugu yaraan 3 kaar noqotaa!");
    }

    // 1. Hubi haddii kooxda ay sax tahay
    if (!isSerial(selectedCards) && !isSet(selectedCards)) {
        return alert("Kaararka aad dooratay ma ahan koox sax ah (Set ama Serial).");
    }

    // 2. Xisaabi dhibcaha
    let currentSetScore = selectedCards.reduce(
        (sum, c) => sum + (pointValues[c.value] || 0),
        0
    );

    if (!isOpened) {
        // --- URURIN ---
        temporaryScore += currentSetScore;
        myOpenedSets.push([...selectedCards]);

        // Ka saar gacanta
        myHand = myHand.filter(c => !c.selected);

        renderMyHand();
        renderMyTableSets();

        // 3. Xeerka 101
        if (temporaryScore >= 101) {
            const hasFourCardGroup = myOpenedSets.some(set => set.length >= 4);

            if (!hasFourCardGroup) {
                return alert(
                    "101 waad gaartay, laakiin waa inaad haysataa ugu yaraan hal koox oo 4+ kaar ah!"
                );
            }

            isOpened = true;

            socket.emit("playerOpens", {
                allSets: myOpenedSets,
                totalScore: temporaryScore
            });

            alert("Hambalyo! Waad degtay. Dhibcahaaga: " + temporaryScore);
        } else {
            alert(`Wadarta hadda: ${temporaryScore}. Sii wad ilaa 101!`);
        }

    } else {
        // Haddii hore u degay
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

function handleDragOver(e) {
    e.preventDefault(); // Waa muhiim si drop u shaqeeyo
}

function handleDrop(e) {
    const dropCard = e.target.closest(".card");
    if (!dropCard || dragStartIndex === null) return;

    const dragEndIndex = +dropCard.dataset.index;

    if (dragStartIndex !== dragEndIndex) {
        // Ka saar kaarka meeshuu joogay
        const [movedCard] = myHand.splice(dragStartIndex, 1);
        // Ku dhex rid booska cusub ee la keenay
        myHand.splice(dragEndIndex, 0, movedCard);
    }

    dragStartIndex = null;
    renderMyHand(); // Dib u sawir gacanta oo habaysan
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

    // 1. Nadiifi miiska ka hor intaanan dib u sawirin
    playerTable.innerHTML = "";

    // 2. halkan dhig koodhka cusub ee sawirada (SVG) isticmaalaya
    allSets.forEach(set => {
        const setDiv = document.createElement("div");
        setDiv.classList.add("set");

        set.forEach(card => {
            const cardDiv = document.createElement("div");
            cardDiv.classList.add("card", "mini-card");

            // Mapping-ka Suit-ka
            const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
            const suitLetter = suitMap[card.suit] || 's';
            const fileName = `${card.value}${suitLetter}.svg`;

            // Sawirka SVG-ga
            cardDiv.innerHTML = `<img src="/cards/${fileName}" style="width: 100%; height: 100%; border-radius: 2px;">`;
            setDiv.appendChild(cardDiv);
        });

        playerTable.appendChild(setDiv);
    });

    // 3. Update dhibcaha loo baahan yahay
    const req = document.getElementById("requiredPoints");
    if (req) req.innerText = nextRequiredPoints;
});


/* ================= HELPER FUNCTIONS ================= */

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
    
    // Hubi in xogtu jirto, haddii kale jooji
    if (!data || !data.players) return;

    if (listArea) {
        listArea.innerHTML = ""; 
        data.players.forEach(p => {
            const pDiv = document.createElement("div");
            pDiv.style.cssText = "padding:10px; margin:5px; background:rgba(255,255,255,0.1); border-radius:5px;";
            pDiv.innerHTML = `✅ <b>${p.name}</b> waa diyaar`;
            listArea.appendChild(pDiv);
        });
    }

    if (statusText) {
        const count = data.players.length;
        const dhiman = 4 - count; 

        // Isticmaalka Switch si uu koodhku u nadiifnaado
        switch(dhiman) {
            case 3:
                statusText.innerText = "3 qof ayaa dhiman weli...";
                statusText.style.color = "#f1c40f"; // Jaalle
                break;
            case 2:
                statusText.innerText = "2 qof ayaa dhiman weli...";
                statusText.style.color = "#e67e22"; // Oranji
                break;
            case 1:
                statusText.innerText = "1 qof ayaa dhiman! Diyaar garow...";
                statusText.style.color = "#e74c3c"; // Cas
                break;
            case 0:
                statusText.innerText = "Dhammaan waa la helay! Ciyaartu waa bilaabanaysaa...";
                statusText.style.color = "#2ecc71"; // Cagaar
                break;
            default:
                statusText.innerText = `Ciyaartoyda la helay: ${count}/4`;
        }
    }
});


socket.on("playersUpdate", (data) => {
    const { players, stockCount, currentTurnId } = data;

    isMyTurn = (currentTurnId === socket.id);

    const statusEl = document.getElementById("turnText");
    if (statusEl) {
        statusEl.textContent = isMyTurn ? "Doorkaaga" : "Sugaya...";
        statusEl.style.color = isMyTurn ? "#2ecc71" : "#f1c40f";
    }

    const stockEl = document.getElementById("stock-count");
    if (stockEl && stockCount !== undefined) {
        stockEl.textContent = stockCount;
    }

    document.getElementById("dhigoBtn").disabled = !isMyTurn;
    document.getElementById("tuurBtn").disabled = !isMyTurn;
    document.getElementById("sortBtn").disabled = false;
    document.getElementById("resetBtn").disabled = !isMyTurn;
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


socket.on("updateDiscardPile", (card) => {
    const pile = document.getElementById("discard-pile");
    if (!pile) return;
    pile.innerHTML = "";

    if (card) {
        const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
        const suitLetter = suitMap[card.suit] || 's';
        const fileName = `${card.value}${suitLetter}.svg`;

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