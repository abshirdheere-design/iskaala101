const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

    // DIR PLAYERSUPDATE
    io.to(roomId).emit("playersUpdate", {
        players: playersData,
        stockCount: room.stockPile.length,
        currentTurnId: currentTurnId
    });

    // DIR UPDATEOPPONENTS – TANI AYAAD KA MAQNAYD
   room.players.forEach((player, index) => {
    // index-1 (Midig), index-2 (Kore), index-3 (Bidix)
    const right = room.players[(index - 1 + room.players.length) % room.players.length];
    const top   = room.players[(index - 2 + room.players.length) % room.players.length];
    const left  = room.players[(index - 3 + room.players.length) % room.players.length];

    io.to(player.id).emit("updateOpponents", {
        right: right && right.id !== player.id ? { name: right.name } : null,
        top:   top && top.id !== player.id     ? { name: top.name } : null,
        left:  left && left.id !== player.id   ? { name: left.name } : null
    });
});
}


function nextTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // 🔥 Masax timer-kii hore
    if (room.turnTimeout) clearTimeout(room.turnTimeout);

    // 🔄 Wareegga lidka saacadda (Counter-clockwise)
    // Waxaan isticmaalnaa (index - 1 + length) % length
    room.activePlayerIndex = (room.activePlayerIndex - 1 + room.players.length) % room.players.length;

    // Dib u deji xaaladda qof kasta (Action reset)
    room.players.forEach(p => p.hasActioned = false);

    const currentPlayer = room.players[room.activePlayerIndex];
    
    // U sheeg dhammaan ciyaartoyda qofka doorka leh
    io.to(roomId).emit('yourTurn', currentPlayer.id);
    
    // Cusboonaysii UI-ga (Iftiinka magacyada iyo xogta kale)
    updateRoomPlayers(roomId);

    // 🔥 Server-side safety timer (35 seconds)
    room.turnTimeout = setTimeout(() => {
        console.log(`Auto-skipping player in room ${roomId} (Counter-clockwise move)`);
        nextTurn(roomId);
    }, 35000);
}



io.on("connection", (socket) => {

    onlineUsers++;
    io.emit("updateOnlineCount", onlineUsers);
    console.log(`User connected. Online: ${onlineUsers}`);

    /* 1. JOIN RANDOM ROOM */
    socket.on("joinRandom", (name) => {
        let roomId = Object.keys(rooms).find(id => 
            rooms[id].players.length < 4 && !rooms[id].gameStarted
        );

        if (!roomId) {
            roomId = "Room_" + Math.random().toString(36).substr(2, 9);
            rooms[roomId] = {
                id: roomId,
                players: [],
                gameStarted: false,
                stockPile: [],
                discardPile: [],
                activePlayerIndex: 0,
                lastOpenPoints: 101
            };
        }

        const newPlayer = { 
            id: socket.id, 
            name: name || `Player ${socket.id.substr(0,4)}`,
            hand: [], 
            isOpened: false,
            hasActioned: false,
            pickedFromDiscard: false,
            openedSets: []
        };

        rooms[roomId].players.push(newPlayer);
        socket.join(roomId);
        socket.roomId = roomId;

        const room = rooms[roomId];
        const playersDataForLobby = room.players.map(p => ({ name: p.name }));
        
        io.to(roomId).emit("waitingRoomUpdate", {
            players: playersDataForLobby
        });

        if (room.players.length === 4) {
            room.gameStarted = true;
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
        }

        updateRoomPlayers(roomId);
    });

    /* 2. PICK FROM DISCARD (KII AAD CODSATAY) */
    socket.on("pickDiscard", () => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;

        const p = room.players[room.activePlayerIndex];
        // Hubi inuu doorkiisa yahay iyo inuusan horay wax u qaadan
        if (p.id !== socket.id || p.hasActioned) {
            return socket.emit("notification", "Maahan doorkaaga ama horay ayaad u qaadatay!");
        }

        if (room.discardPile.length > 0) {
            const card = room.discardPile.pop();
            p.hand.push(card);
            p.hasActioned = true;
            p.pickedFromDiscard = true; // Xeerka 101 ayay tan kicinaysaa
            
            socket.emit("discardPickedSuccess", card);
            
            // Cusboonaysii muuqaalka tuurista ee dadka kale
            const nextDiscard = room.discardPile.length > 0 ? room.discardPile.at(-1) : null;
            io.to(socket.roomId).emit("updateDiscardPile", nextDiscard);
            updateRoomPlayers(socket.roomId);
        }
    });

    /* 3. DRAW FROM STOCK */
    /* 2. DRAW FROM STOCK */
socket.on("drawCard", () => {
    const room = rooms[socket.roomId];
    if (!room || !room.gameStarted) return;

    const p = room.players[room.activePlayerIndex];

    // --- CUSBOONAYSIIN: HUBI TIRADA GACANTA ---
    // Haddii uu haysto 15 xabo, looma oggola inuu 16-aad qaato
    if (p.hand.length >= 15) {
        return socket.emit("notification", "Gacantaadu waa buuxdaa (15)! Mid tuur marka hore.");
    }

    if (p.id !== socket.id || p.hasActioned) {
        return socket.emit("notification", "Maahan doorkaaga ama mar hore ayaad qaadatay!");
    }

    if (room.stockPile.length === 0) {
        if (room.discardPile.length <= 1) return socket.emit("notification", "Turub ma jiro!");
        const top = room.discardPile.pop();
        room.stockPile = shuffle(room.discardPile);
        room.discardPile = [top];
    }

    const card = room.stockPile.pop();
    p.hand.push(card);
    p.hasActioned = true;
    p.pickedFromDiscard = false; 
    socket.emit("receiveCard", card);
    updateRoomPlayers(socket.roomId);
});

    /* 4. PLAYER OPENS (101 Logic) */
socket.on("playerOpens", (data) => {
    const room = rooms[socket.roomId];
    if (!room || !room.gameStarted) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.players[room.activePlayerIndex].id !== socket.id) return;

    // 1. FLAT CARDS: Isku gee dhammaan kaararka qofku soo diray
    const allCardsToOpen = data.allSets.flat();
    
    // 2. SERVER-SIDE CALCULATION: Xisaabi dhibcaha halkan si aan laguugu qishin
    const totalPoints = allCardsToOpen.reduce((sum, c) => {
        return sum + getCardPoints(c.value);
    }, 0);

    // 3. LOGIC CHECK: Ma gaaray 101 ama iskaalihii hore?
    const required = player.isOpened ? 1 : (player.pickedFromDiscard ? room.lastOpenPoints : 101);

    if (totalPoints < required) {
        return socket.emit("notification", `Dhibcahaagu ma gaarin ${required}! Waxaad haysaa: ${totalPoints}`);
    }

    // 4. SYNC HAND: Ka saar kaararka gacantiisa (isticmaal ID-yada)
    const cardIdsToRemove = allCardsToOpen.map(c => c.id);
    player.hand = player.hand.filter(c => !cardIdsToRemove.includes(c.id));
    
    player.isOpened = true;
    player.openedSets.push(...data.allSets);

    // Iskaala Rule: Cusboonaysii dhibcaha xiga ee loo baahan yahay
    if (totalPoints >= room.lastOpenPoints) {
        room.lastOpenPoints = totalPoints + 1;
    }

    // U sheeg qof kasta in miisku isbeddelay
    io.to(socket.roomId).emit("updateTableUI", {
        playerId: socket.id,
        allSets: player.openedSets,
        nextRequiredPoints: room.lastOpenPoints
    });

    socket.emit("startHand", player.hand);
    updateRoomPlayers(socket.roomId);
});

    /* 5. PLAY CARD (Tuurista) */
    socket.on("playCard", (card) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;

        const p = room.players[room.activePlayerIndex];
        if (p.id !== socket.id) return;

        if (p.pickedFromDiscard && !p.isOpened) {
            return socket.emit("notification", "Waa inaad degtaa maadaama aad tuurista qaadatay!");
        }

        p.hand = p.hand.filter(c => c.id !== card.id);
        room.discardPile.push(card);
        io.to(socket.roomId).emit("updateDiscardPile", card);

        p.hasActioned = false;
        p.pickedFromDiscard = false;

        if (p.hand.length === 0) {
            const results = room.players.map(pl => ({ name: pl.name, points: pl.hand.reduce((s, c) => s + (c.points || 0), 0) }));
            io.to(socket.roomId).emit("gameOver", { winnerName: p.name, allResults: results });
            room.gameStarted = false;
        } else {
            nextTurn(socket.roomId);
        }
    }); // <--- Halkan waxaa ku xiran playCard

    /* 6. DISCONNECT & OTHERS */
    socket.on("disconnect", () => {
        onlineUsers--;
        io.emit("updateOnlineCount", onlineUsers);
        const room = rooms[socket.roomId];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[socket.roomId];
            } else {
                if (!room.gameStarted) {
                    io.to(socket.roomId).emit("waitingRoomUpdate", { players: room.players.map(p => ({name: p.name})) });
                }
                io.to(socket.roomId).emit("notification", "Ciyaartoy ayaa baxay.");
                updateRoomPlayers(socket.roomId);
            }
        }
    });

    socket.on("forceEndTurn", () => {
        const room = rooms[socket.roomId];
        if (room && room.players[room.activePlayerIndex].id === socket.id) nextTurn(socket.roomId);
    });

}); // <--- KANI WAA XIRITAANKA MUHIIMKA AH EE io.on("connection")

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));