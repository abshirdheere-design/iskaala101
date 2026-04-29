const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});

app.use(express.static(path.join(__dirname, "public")));

// GLOBAL STATE
let rooms = {}; 
let onlineUsers = 0;
const TURN_TIME_LIMIT = 30000; 
const POSITIONS = ['bottom', 'left', 'top', 'right'];

/* 1. DECK LOGIC */
function createDeck() {
    const suits = ['♦', '♥', '♠', '♣'];
    const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let newDeck = [];
    for (let i = 0; i < 4; i++) {
        for (let s of suits) {
            for (let v of values) {
                newDeck.push({ 
                    suit: s, 
                    value: v, 
                    id: `${s}-${v}-${i}-${Math.random().toString(36).substr(2, 5)}`,
                    points: getCardPoints(v)
                });
            }
        }
    }
    return shuffle(newDeck);
}

function getCardPoints(value) {
    if (['J', 'Q', 'K'].includes(value)) return 10;
    if (value === 'A') return 11;
    const points = parseInt(value);
    return (!isNaN(points)) ? points : 0;
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function prepareGame(playerCount) {
    let deck = createDeck(); 
    let hands = [];
    for (let i = 0; i < playerCount; i++) {
        hands.push(deck.splice(0, 14));
    }
    return { allHands: hands, remainingDeck: deck };
}

/* 2. GAME FUNCTIONS */
function updateRoomPlayers(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const activePlayer = room.players[room.activePlayerIndex];
    const currentTurnId = activePlayer ? activePlayer.id : null;

    const playersData = room.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        isOpened: p.isOpened || false
    }));

    // DIR PLAYERSUPDATE (Halkan ayaan ku daray turnStartTime)
    io.to(roomId).emit("playersUpdate", {
        players: playersData,
        stockCount: room.stockPile.length,
        currentTurnId: currentTurnId,
        turnStartTime: room.turnStartTime // 🔥 MUHIIM: Kani waa kan Timer-ka hagaajinaya
    });

    // DIR UPDATEOPPONENTS (Sidii aad u qortay waa sax)
    room.players.forEach((player, index) => {
        const left  = room.players[(index + 1) % room.players.length];
        const top   = room.players[(index + 2) % room.players.length];
        const right = room.players[(index + 3) % room.players.length];

        io.to(player.id).emit("updateOpponents", {
            left:  left  ? { name: left.name } : null,
            top:   top   ? { name: top.name } : null,
            right: right ? { name: right.name } : null
        });
    });
}





function nextTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.turnTimeout) clearTimeout(room.turnTimeout);

    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    room.turnStartTime = Date.now(); 

    room.players.forEach(p => {
        p.hasActioned = false;
        p.pickedFromDiscard = false;
    });

    const currentPlayer = room.players[room.activePlayerIndex];
    io.to(roomId).emit('yourTurn', currentPlayer.id);
    updateRoomPlayers(roomId);

    // ROBOT LOGIC (Haddii qofku seexdo)
    room.turnTimeout = setTimeout(() => {
        if (!room || !room.gameStarted) return;
        
        console.log(`ROBOT: Ciyaaryahan ${currentPlayer.name} waa laga daahay.`);

        // 1. AUTO-DRAW: Haddii uusan weli qaadan kaar
        if (!currentPlayer.hasActioned && room.stockPile.length > 0) {
            const card = room.stockPile.pop();
            currentPlayer.hand.push(card);
            currentPlayer.hasActioned = true;
            io.to(currentPlayer.id).emit("receiveCard", card);
        }

        // 2. AUTO-DISCARD: Ka saar hal kaar (Haddii uu 15 haysto ama 14)
        if (currentPlayer.hand.length > 0) {
            const cardToDiscard = currentPlayer.hand.pop(); // Halkan ayaan ka saarnay
            room.discardPile.push(cardToDiscard);
            
            // 🔥 MUHIIM: U sheeg qofka in gacantiisa la beddelay (si uusan nuqul ugu harin)
            io.to(currentPlayer.id).emit("startHand", currentPlayer.hand); 
            io.to(roomId).emit("updateDiscardPile", cardToDiscard);
        }

        nextTurn(roomId);
    }, 35000); 
}



io.on("connection", (socket) => {
    onlineUsers++;
    io.emit("updateOnlineCount", onlineUsers);

    /* 1. JOIN/RECONNECT LOGIC */
    socket.on("joinRandom", (name) => {
        // --- RECONNECT LOGIC ---
        for (let id in rooms) {
            let room = rooms[id];
            let existingPlayer = room.players.find(p => p.name === name && p.online === false);
            
            if (existingPlayer) {
                console.log(`RECONNECT: ${name} dib u soo laabasho.`);
                existingPlayer.id = socket.id; 
                existingPlayer.online = true;  
                socket.roomId = id;
                socket.join(id);
                
                socket.emit("startHand", existingPlayer.hand); 

                if (room.discardPile.length > 0) {
                    socket.emit("updateDiscardPile", room.discardPile.at(-1));
                }

                room.players.forEach(p => {
                    if (p.isOpened && p.openedSets.length > 0) {
                        socket.emit("updateTableUI", {
                            playerId: p.id,
                            allSets: p.openedSets,
                            nextRequiredPoints: room.lastOpenPoints
                        });
                    }
                });

                const currentPlayer = room.players[room.activePlayerIndex];
                socket.emit("matchFound", { 
                    roomId: id, 
                    topDiscard: room.discardPile.at(-1), 
                    currentTurn: currentPlayer.id 
                });

                updateRoomPlayers(id);
                socket.emit("notification", "Waad ku soo laabtay!");
                return; 
            }
        }

        // --- NEW PLAYER JOINING ---
        let roomId = Object.keys(rooms).find(id => 
            rooms[id].players.length < 4 && !rooms[id].gameStarted
        );

        if (!roomId) {
            roomId = "Room_" + Math.random().toString(36).substr(2, 9);
            rooms[roomId] = {
                id: roomId, players: [], gameStarted: false,
                stockPile: [], discardPile: [], activePlayerIndex: 0,
                lastOpenPoints: 101, turnTimeout: null, turnStartTime: null
            };
        }

        const newPlayer = { 
            id: socket.id, name: name || `User_${socket.id.substr(0,4)}`,
            hand: [], isOpened: false, hasActioned: false,
            pickedFromDiscard: false, openedSets: [], online: true 
        };

        rooms[roomId].players.push(newPlayer);
        socket.join(roomId);
        socket.roomId = roomId;

        const room = rooms[roomId];
        io.to(roomId).emit("waitingRoomUpdate", { players: room.players.map(p => ({ name: p.name })) });

        if (room.players.length === 4) {
            room.gameStarted = true;
            room.turnStartTime = Date.now(); 
            const gameData = prepareGame(4);
            room.stockPile = gameData.remainingDeck;

            room.players.forEach((player, index) => {
                player.hand = gameData.allHands[index];
                if (index === 0) player.hand.push(room.stockPile.pop());
                io.to(player.id).emit("startHand", player.hand);
            });

            room.discardPile = [room.stockPile.pop()];
            io.to(roomId).emit("matchFound", { 
                roomId, 
                topDiscard: room.discardPile.at(-1), 
                currentTurn: room.players[0].id 
            });
            
            startTurnTimer(roomId);
            updateRoomPlayers(roomId);
        }
    });

    /* 2. SYNC & HEARTBEAT */
    socket.on("request_sync", () => {
        if (socket.roomId && rooms[socket.roomId]) {
            updateRoomPlayers(socket.roomId);
            const room = rooms[socket.roomId];
            if (room.discardPile.length > 0) {
                socket.emit("updateDiscardPile", room.discardPile.at(-1));
            }
        }
    });
    
    socket.on("pauseTimerRequest", () => {
        const room = rooms[socket.roomId];
        if (room && room.timer) {
            clearInterval(room.timer);
            io.to(socket.roomId).emit("timerPaused", { message: "Saacadda waa la hakiyay..." });
        }
    });
    
    /* 3. ACTIONS (DRAW/PICK/PLAY) */
    socket.on("drawCard", () => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;
        const p = room.players[room.activePlayerIndex];

        if (p.id !== socket.id) return;

        if (p.hand.length >= 15 || p.hasActioned) {
            socket.emit("message", "Horey ayaad u qaadatay kaar.");
            return; 
        }

        const card = room.stockPile.pop();
        p.hand.push(card);
        p.hasActioned = true; 
        
        socket.emit("receiveCard", card);
        updateRoomPlayers(socket.roomId);
    });

    /* 🔥 4. MELD SETS (XALKA BRUNO) */
    socket.on("meldSets", (sets) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;

        const p = room.players.find(player => player.id === socket.id);
        if (!p) return;

        // Hel ID-yada kaararka la dhigay
        let cardsToRemoveIds = [];
        sets.forEach(set => {
            set.forEach(card => cardsToRemoveIds.push(card.id));
        });

        // KA SAAR GACANTA: Kani waa muhiim si uusan kaarku ugu soo laaban
        p.hand = p.hand.filter(card => !cardsToRemoveIds.includes(card.id));

        p.isOpened = true;
        p.openedSets.push(...sets);

        // U dir qofka gacantiisa cusub oo nadiif ah
        socket.emit("startHand", p.hand); 

        // U sheeg dadka kale in miiska wax lagu daray
        io.to(socket.roomId).emit("updateTableUI", {
            playerId: p.id,
            allSets: p.openedSets
        });
        
        updateRoomPlayers(socket.roomId);
    });

    socket.on("playCard", (card) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;
        
        const p = room.players[room.activePlayerIndex];
        if (p.id !== socket.id) return;

        const cardIndex = p.hand.findIndex(c => c.id === card.id);
        if (cardIndex === -1) return;

        p.hand.splice(cardIndex, 1);
        room.discardPile.push(card);
        io.to(socket.roomId).emit("updateDiscardPile", card);
        
        p.hasActioned = false;
        p.pickedFromDiscard = false;

        if (p.hand.length === 0) {
            const results = room.players.map(pl => ({ name: pl.name, points: calculateHandPoints(pl.hand) }));
            io.to(socket.roomId).emit("gameOver", { winnerName: p.name, allResults: results });
            room.gameStarted = false;
            if(room.turnTimeout) clearTimeout(room.turnTimeout);
        } else {
            socket.emit("startHand", p.hand); 
            // Hubi in nextTurn function-ku kuu jiro, haddii kale wac moveToNextPlayer(socket.roomId)
            if (typeof nextTurn === "function") {
                nextTurn(socket.roomId);
            } else {
                moveToNextPlayer(socket.roomId);
            }
        }
    });
	
	socket.on("syncHandAfterMeld", (updatedHand) => {
    const room = rooms[socket.roomId];
    if (!room) return;
    
    const p = room.players.find(player => player.id === socket.id);
    if (p) {
        p.hand = updatedHand; // Halkan ayaa ah meesha server-ka loogu sheegayo tirada cusub
        console.log(`Sync: ${p.name} gacantiisa waa la cusboonaysiiyay. Tirada hadda: ${updatedHand.length}`);
    }
  });

    /* 5. DISCONNECT */
    socket.on("disconnect", () => {
        onlineUsers--;
        const room = rooms[socket.roomId];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                if (!room.gameStarted) {
                    room.players = room.players.filter(p => p.id !== socket.id);
                } else {
                    player.online = false;
                }
            }
            
            if (room.players.filter(p => p.online).length === 0) {
                if(room.turnTimeout) clearTimeout(room.turnTimeout);
                delete rooms[socket.roomId];
            } else {
                updateRoomPlayers(socket.roomId);
            }
        }
    });
});

// --- HELPER FUNCTIONS ---
function startTurnTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.turnTimeout) clearTimeout(room.turnTimeout);
    
    room.turnStartTime = Date.now();
    updateRoomPlayers(roomId);

    room.turnTimeout = setTimeout(() => {
        if (!room.gameStarted) return;

        const currentPlayer = room.players[room.activePlayerIndex];
        console.log(`ROBOT: ${currentPlayer.name} waa laga daahay.`);

        // Robot Action: Haddii uusan waxba soo qaadan, u soo qaad xabbad
        if (!currentPlayer.hasActioned) {
            if (room.stockPile.length > 0) {
                const card = room.stockPile.pop();
                currentPlayer.hand.push(card);
                currentPlayer.hasActioned = true;
                io.to(currentPlayer.id).emit("receiveCard", card);
            }
        }

        // Robot Action: Haddii uu 15 xabbadood haysto, mid ka tuur
        if (currentPlayer.hand.length > 14) {
            const cardToDiscard = currentPlayer.hand.pop(); 
            room.discardPile.push(cardToDiscard);
            io.to(roomId).emit("updateDiscardPile", cardToDiscard);
        }

        nextTurn(roomId);
    }, 35000); 
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));