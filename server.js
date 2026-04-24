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

app.use(express.static(path.join(__dirname, 'public')));

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

    // 1. Masax timer-kii hore
    if (room.turnTimeout) clearTimeout(room.turnTimeout);

    // 2. Wareeji doorka
    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    
    // 🔥 MUHIIM: Qoro waqtiga doorku bilaawday (Kani waa kan Timer-ka hagaajinaya)
    room.turnStartTime = Date.now(); 

    // Nadiifi xogta doorkii hore
    room.players.forEach(p => {
        p.hasActioned = false;
        p.pickedFromDiscard = false;
    });

    const currentPlayer = room.players[room.activePlayerIndex];

    // 3. U sheeg qofka in doorkiisa yahay
    io.to(roomId).emit('yourTurn', currentPlayer.id);
    updateRoomPlayers(roomId);

    // 4. ROBOT-KA (Auto-Play Logic)
    room.turnTimeout = setTimeout(() => {
        console.log(`ROBOT: ${currentPlayer.name} waa laga maqan yahay. Robot-ka ayaa u ciyaaraya.`);

        if (!currentPlayer.hasActioned) {
            if (room.stockPile.length > 0) {
                const card = room.stockPile.pop();
                currentPlayer.hand.push(card);
                currentPlayer.hasActioned = true;
                io.to(currentPlayer.id).emit("receiveCard", card);
            }
        }

        if (currentPlayer.hand.length > 0) {
            const cardToDiscard = currentPlayer.hand.pop(); 
            room.discardPile.push(cardToDiscard);
            io.to(roomId).emit("updateDiscardPile", cardToDiscard);
            io.to(roomId).emit("notification", `${currentPlayer.name} waa laga daahay, Robot-ka ayaa kaar u tuuray.`);
        }

        // U gudbi qofka xiga
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
                
                // A. Gacanta kaararka
                socket.emit("startHand", existingPlayer.hand); 

                // B. Kaarka qashinka (Discard Pile)
                if (room.discardPile.length > 0) {
                    socket.emit("updateDiscardPile", room.discardPile.at(-1));
                }

                // C. Sync Table (Dhammaan dadka miiska wax u saaran yihiin)
                room.players.forEach(p => {
                    if (p.isOpened && p.openedSets.length > 0) {
                        socket.emit("updateTableUI", {
                            playerId: p.id,
                            allSets: p.openedSets,
                            nextRequiredPoints: room.lastOpenPoints
                        });
                    }
                });

                // D. U sheeg xaaladda ciyaarta (Yaa leh doorka)
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
            
            // Bilaaw Timer-ka Server-ka
            startTurnTimer(roomId);
            updateRoomPlayers(roomId);
        }
    });

    /* 2. SYNC & HEARTBEAT */
    socket.on("request_sync", () => {
        if (socket.roomId && rooms[socket.roomId]) {
            updateRoomPlayers(socket.roomId);
            // Sidoo kale u soo celi discard pile-ka ugu dambeeyay
            const room = rooms[socket.roomId];
            if (room.discardPile.length > 0) {
                socket.emit("updateDiscardPile", room.discardPile.at(-1));
            }
        }
    });

    /* 3. ACTIONS (DRAW/PICK/PLAY) */
 socket.on("drawCard", () => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;
        const p = room.players[room.activePlayerIndex];

        // 1. Hubi inuu qofka turn-kiisa yahay
        if (p.id !== socket.id) return;

        // 2. Haddii uu qofku 15 kaar haysto, u sheeg inuu wax dhigo ama tuuro
        if (p.hand.length >= 15) {
            socket.emit("message", "Gacantaada waa buuxdaa (15). Fadlan dhig ama tuur kaar.");
            return; 
        }

        // 3. Haddii uu horey wax u soo qaaday (hasActioned)
        if (p.hasActioned) return;

        if (room.stockPile.length === 0) {
            const top = room.discardPile.pop();
            room.stockPile = shuffle(room.discardPile);
            room.discardPile = [top];
            io.to(socket.roomId).emit("updateDiscardPile", top);
        }

        const card = room.stockPile.pop();
        p.hand.push(card);
        p.hasActioned = true; // Hadda wuxuu u gudbi karaa inuu "Tuuro" kaar
        socket.emit("receiveCard", card);
        updateRoomPlayers(socket.roomId);
    });
	
    socket.on("playCard", (card) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;
        const p = room.players[room.activePlayerIndex];
        if (p.id !== socket.id) return;

        p.hand = p.hand.filter(c => c.id !== card.id);
        room.discardPile.push(card);
        io.to(socket.roomId).emit("updateDiscardPile", card);
        
        p.hasActioned = false;
        p.pickedFromDiscard = false;

        if (p.hand.length === 0) {
            // Game Over Logic
            const results = room.players.map(pl => ({ name: pl.name, points: calculateHandPoints(pl.hand) }));
            io.to(socket.roomId).emit("gameOver", { winnerName: p.name, allResults: results });
            room.gameStarted = false;
            if(room.turnTimeout) clearTimeout(room.turnTimeout);
        } else {
            nextTurn(socket.roomId);
        }
    });

    /* 4. DISCONNECT (SOFT) */
    socket.on("disconnect", () => {
        onlineUsers--;
        const room = rooms[socket.roomId];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                if (!room.gameStarted) {
                    room.players = room.players.filter(p => p.id !== socket.id);
                } else {
                    player.online = false; // Mobile Sleep/Refresh
                }
            }
            
            // Haddii qolku cidlo noqdo, tirtir
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