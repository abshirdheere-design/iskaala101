import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as IOServer } from 'socket.io';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = process.env.PORT || 8080;

// ─── Disk persistence: profiles + xiili sessions ─────────────────────────────
const DATA_DIR = process.env.DATA_DIR ? join(process.cwd(), process.env.DATA_DIR) : join(__dirname, 'data');
const profilesPath = join(DATA_DIR, 'profiles.json');
const profilesBackupPath = join(DATA_DIR, 'profiles.backup.json');
const sessionsPath = join(DATA_DIR, 'sessions.json');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function readJsonFile(filePath, fallback = {}) {
  try {
    if (!existsSync(filePath)) return fallback;
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (err) {
    console.error(`❌ Lama akhrin karo ${filePath}:`, err.message || err);
    return fallback;
  }
}

function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data || {}, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

const globalProfiles = readJsonFile(profilesPath, readJsonFile(profilesBackupPath, {}));
const globalSessions = readJsonFile(sessionsPath, {});

function saveProfilesData() {
  atomicWriteJson(profilesPath, globalProfiles);
}

function backupProfilesData() {
  try {
    if (existsSync(profilesPath)) copyFileSync(profilesPath, profilesBackupPath);
    else atomicWriteJson(profilesBackupPath, globalProfiles);
  } catch (err) {
    console.error('❌ Backup profiles waa fashilmay:', err.message || err);
  }
}

function resetAllProfileStats() {
  // Xisaabaadka iyo PIN-yada waa la hayaa; tirakoobka xilli-ciyaareedka
  // (score, guulo, foorooyin iyo ciyaaro) ayaa keliya dib loogu celinayaa eber.
  for (const profile of playerProfiles.values()) {
    profile.score = 0;
    profile.wins = 0;
    profile.fooros = 0;
    profile.games = 0;
  }

  for (const [key, profile] of Object.entries(globalProfiles)) {
    if (!profile || typeof profile !== 'object') continue;
    profile.score = 0;
    profile.wins = 0;
    profile.fooros = 0;
    profile.games = 0;
    globalProfiles[key] = profile;
  }

  // Labada fayl si isku mar ah u cusboonaysii; backup-ga ha sii hayn tiradii
  // hore, taas oo ahayd sababta ay mar kale ugu soo laabanaysay.
  saveProfilesData();
  backupProfilesData();
}

function saveSessionsData() {
  const data = {};
  for (const [key, season] of xiiliSessions.entries()) {
    data[key] = { target: season.target, scores: season.scores || {}, ended: !!season.ended };
  }
  atomicWriteJson(sessionsPath, data);
}

function savePersistentState() {
  saveProfilesData();
  saveSessionsData();
}

setInterval(backupProfilesData, 60 * 60 * 1000).unref?.();

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function resetAllProfilesAndSessions() {
  const filesToReset = [
    { path: profilesPath, defaultData: {} },
    { path: profilesBackupPath, defaultData: {} },
    { path: sessionsPath, defaultData: {} }
  ];

  filesToReset.forEach(fileObj => {
    try {
      writeFileSync(fileObj.path, JSON.stringify(fileObj.defaultData, null, 2), 'utf8');
      console.log(`✅ Faylka waxaa la nadiifiyay: ${fileObj.path}`);
    } catch (err) {
      console.error(`❌ Khalad ayaa ka dhacay tirtiridda faylka:`, err.message || err);
    }
  });

  if (typeof xiiliSessions !== 'undefined' && xiiliSessions.clear) {
    xiiliSessions.clear();
  }
  if (typeof globalSessions !== 'undefined' && globalSessions && typeof globalSessions === 'object') {
    Object.keys(globalSessions).forEach(key => delete globalSessions[key]);
  }
}

// ─── Static file server ───────────────────────────────────────────────────────
const httpServer = createServer((req, res) => {
  if (req.url === '/api/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const apiHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, apiHeaders); res.end(); return;
  }

  if (req.method === 'POST' && req.url === '/api/auth/register') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { name, pin } = JSON.parse(body);
        if (!name || !pin || !/^\d{4}$/.test(String(pin))) {
          res.writeHead(400, apiHeaders);
          res.end(JSON.stringify({ ok: false, error: 'Magaca iyo 4-digit PIN ayaa loo baahan yahay' }));
          return;
        }
        if (getProfile(name)) {
          res.writeHead(409, apiHeaders);
          res.end(JSON.stringify({ ok: false, error: 'Magacaan horey loo diiwaangaliyay' }));
          return;
        }
        const profile = createProfile(name.trim(), String(pin));
        res.writeHead(200, apiHeaders);
        res.end(JSON.stringify({ ok: true, profile: { name: profile.name, score: 0, wins: 0, fooros: 0, games: 0 } }));
      } catch { res.writeHead(400, apiHeaders); res.end(JSON.stringify({ ok: false, error: 'Khalad' })); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/auth/login') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { name, pin } = JSON.parse(body);
        const profile = validateProfile(name, pin);
        if (!profile) {
          res.writeHead(401, apiHeaders);
          res.end(JSON.stringify({ ok: false, error: 'Magaca ama PIN-ku waa khalad' }));
          return;
        }
        res.writeHead(200, apiHeaders);
        res.end(JSON.stringify({ ok: true, profile: { name: profile.name, score: profile.score, wins: profile.wins, fooros: profile.fooros, games: profile.games } }));
      } catch { res.writeHead(400, apiHeaders); res.end(JSON.stringify({ ok: false, error: 'Khalad' })); }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/leaderboard') {
    res.writeHead(200, apiHeaders);
    res.end(JSON.stringify({ ok: true, leaderboard: getLeaderboardData() }));
    return;
  }

  let filePath = join(PUBLIC, req.url === '/' ? 'index.html' : req.url);
  filePath = filePath.split('?')[0];

  if (!existsSync(filePath) || !extname(filePath)) {
    filePath = join(PUBLIC, 'index.html');
  }

  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ─── Player Profiles (In-Memory + Disk) ─────────────────────────────────────
function profileKey(name) {
  return String(name || '').toLowerCase().trim();
}

function publicProfile(profile) {
  return {
    name: profile.name,
    score: Number(profile.score) || 0,
    wins: Number(profile.wins) || 0,
    fooros: Number(profile.fooros) || 0,
    games: Number(profile.games) || 0,
  };
}

const playerProfiles = new Map(
  Object.entries(globalProfiles && typeof globalProfiles === 'object' ? globalProfiles : {}).map(([key, profile]) => {
    const cleanProfile = {
      name: profile?.name || key,
      pin: String(profile?.pin || ''),
      score: Number(profile?.score) || 0,
      wins: Math.max(0, Number(profile?.wins) || 0),
      fooros: Math.max(0, Number(profile?.fooros) || 0),
      games: Math.max(0, Number(profile?.games) || 0),
    };
    globalProfiles[key] = cleanProfile;
    return [key, cleanProfile];
  }),
);

function getProfile(name) {
  return playerProfiles.get(profileKey(name));
}

function createProfile(name, pin) {
  const key = profileKey(name);
  if (playerProfiles.has(key)) return null;
  const profile = { name: name.trim(), pin: String(pin), score: 0, wins: 0, fooros: 0, games: 0 };
  playerProfiles.set(key, profile);
  globalProfiles[key] = profile;
  saveProfilesData();
  return profile;
}

function validateProfile(name, pin) {
  const profile = getProfile(name);
  if (!profile || profile.pin !== String(pin)) return null;
  return profile;
}

function getLeaderboardData() {
  return [...playerProfiles.values()]
    .filter(p => p.games > 0)
    .sort((a, b) => b.score - a.score || b.wins - a.wins || a.fooros - b.fooros)
    .map(publicProfile);
}

// ─── Server-side fooro target ─────────────────────────────────────────────────
function findFooroTarget(winnerId, providerId, players) {
  // 1. Hubi haddii uu jiro qof hoosgale ah (oo aan ahayn guuleystaha)
  const hoosgale = players.find(p => p.id !== winnerId && p.hoosgale);
  if (hoosgale) return hoosgale.id;

  let provIdx = players.findIndex(p => p.id === providerId);
  if (provIdx === -1) {
    const winIdx = players.findIndex(p => p.id === winnerId);
    if (winIdx === -1) return null;
    provIdx = (winIdx - 1 + players.length) % players.length;
  }

  // 2. Raadi qofka xiga ee aan degin (balse ka reeb qofka iska wareejiyay ama xaaladdiisu beddelantahay)
  for (let i = 0; i < players.length; i++) {
    const idx = ((provIdx - i) % players.length + players.length) % players.length;
    const p = players[idx];
    
    if (p.id === winnerId) continue;
    
    // Halkan waxaa lagu darayaa hubinta ah inuusan ahayn qof iska wareejiyay 
    // (tusaale: haddii aad ku leedahay p.isCleared ama p.passed ama p.isOpened)
    if (p.isCleared || p.hasPassed) continue; 

    if (!p.isOpened) return p.id;
  }

  // 3. Xaaladda kale ee dhibcaha ugu badan
  const others = players.filter(p => p.id !== winnerId && !p.isCleared && !p.hasPassed);
  if (!others.length) {
    // Haddii dhammaan la waayo, ku noqo qofkii ugu dhowaa ee aan guuleystaha ahayn
    const winIdx = players.findIndex(p => p.id === winnerId);
    for (let i = 1; i <= players.length; i++) {
      const p = players[(winIdx + i) % players.length];
      if (p.id !== winnerId) return p.id;
    }
    return null;
  }

  const withPts = others.map(p => ({ p, pts: (p.hand || []).reduce((s, c) => s + (c.points || 0), 0) }));
  const maxPts = Math.max(...withPts.map(x => x.pts));
  const top = withPts.filter(x => x.pts === maxPts);
  if (top.length === 1) return top[0].p.id;

  const winIdx = players.findIndex(p => p.id === winnerId);
  for (let i = 1; i <= players.length; i++) {
    const p = players[(winIdx + i) % players.length];
    if (p.id !== winnerId && !p.isCleared && !p.hasPassed) return p.id;
  }
  
  return null;
}

function updatePersistentScores(room, scoreResult) {
  const deltas = scoreResult?.deltas || {};
  const roundDeltas = {};
  room.players.forEach(pl => {
    if (pl.isBot || !pl.profileName) return;
    const profile = getProfile(pl.profileName);
    if (!profile) return;
    const key = normalizeSessionName(pl.name);
    const delta = deltas[key] || { wins: 0, fooros: 0, net: 0 };
    profile.games += 1;
    profile.wins = Math.max(0, (Number(profile.wins) || 0) + (delta.wins || 0));
    profile.fooros = Math.max(0, (Number(profile.fooros) || 0) + (delta.fooros || 0));
    profile.score = (Number(profile.score) || 0) + (delta.net || 0);
    globalProfiles[profileKey(pl.profileName)] = profile;
    roundDeltas[pl.id] = { name: pl.name, delta: delta.net || 0, total: profile.score };
  });
  saveProfilesData();
  return { roundDeltas };
}

// ─── Session Score Tracking ────────────────────────────────────────────────────
const xiiliSessions = new Map();

function normalizeXiiliTarget(target) {
  const parsed = parseInt(target, 10);
  return parsed === 10 ? 10 : 5;
}

function getXiiliSession(target = 5) {
  const normalizedTarget = normalizeXiiliTarget(target);
  const key = String(normalizedTarget);
  if (!xiiliSessions.has(key)) {
    const saved = globalSessions && typeof globalSessions === 'object' ? globalSessions[key] : null;
    xiiliSessions.set(key, {
      target: normalizedTarget,
      scores: saved && typeof saved.scores === 'object' ? saved.scores : {},
      ended: Boolean(saved && saved.ended),
    });
  }
  return xiiliSessions.get(key);
}

function normalizeSessionName(name) {
  return String(name || '').trim().toUpperCase();
}

function ensureSessionScore(scores, name) {
  const cleanName = String(name || '').trim();
  const key = normalizeSessionName(cleanName);
  if (!key) return null;
  if (!scores[key]) scores[key] = { wins: 0, fooros: 0, displayName: cleanName };
  Object.keys(scores).forEach(oldKey => {
    if (oldKey === key || normalizeSessionName(oldKey) !== key) return;
    scores[key].wins = Math.max(Number(scores[key].wins) || 0, Number(scores[oldKey]?.wins) || 0);
    scores[key].fooros = Math.max(Number(scores[key].fooros) || 0, Number(scores[oldKey]?.fooros) || 0);
    if (scores[oldKey]?.displayName) scores[key].displayName = scores[oldKey].displayName;
    delete scores[oldKey];
  });
  scores[key].wins = Math.max(0, parseInt(scores[key].wins, 10) || 0);
  scores[key].fooros = Math.max(0, parseInt(scores[key].fooros, 10) || 0);
  scores[key].displayName = scores[key].displayName || cleanName;
  return scores[key];
}

function attachRoomToXiiliSession(room, target = 5) {
  room.xiiliTarget = normalizeXiiliTarget(target);
  const season = getXiiliSession(room.xiiliTarget);
  room.sessionScores = season.scores;
  return season;
}

function initializeRoomScores(room, target = 5) {
  const season = attachRoomToXiiliSession(room, target);
  if (season.ended) {
    season.scores = {};
    season.ended = false;
    room.sessionScores = season.scores;
  }
  
  // Dhammaan ciyaartoyda (dad + robots) waa in panel-ka lagu muujiyo.
  if (room.players && Array.isArray(room.players)) {
    room.players.forEach(p => {
      const playerName = p.name || p.id;
      ensureSessionScore(room.sessionScores, playerName);
    });
  }
}

function addScoreDelta(deltas, name, delta) {
  const key = normalizeSessionName(name);
  if (!key) return;
  if (!deltas[key]) deltas[key] = { wins: 0, fooros: 0, net: 0 };
  deltas[key].wins += delta.wins || 0;
  deltas[key].fooros += delta.fooros || 0;
  deltas[key].net += delta.net || 0;
}

function findChainedDabaaqTarget(room, winnerName, victimFooroName, dabaaqOwnerName) {
  const players = Array.isArray(room?.players) ? room.players : [];
  const victimKey = normalizeSessionName(victimFooroName);
  const winnerKey = normalizeSessionName(winnerName);
  const ownerKey = normalizeSessionName(dabaaqOwnerName);
  const victimIndex = players.findIndex(p => normalizeSessionName(p.name) === victimKey);
  if (victimIndex === -1) return null;

  // Foorada dhacday qofka la doortay kadib, dabaaqyadii guuleystahana
  // waxay u gudbaan qofka xiga ee aan weli degin. Provider-ka, guuleystaha,
  // iyo dhibbanaha hadda la doortay laguma darin silsiladdan.
  for (let offset = 1; offset <= players.length; offset++) {
    const candidate = players[(victimIndex + offset) % players.length];
    const candidateKey = normalizeSessionName(candidate?.name);
    if (!candidateKey || candidateKey === winnerKey || candidateKey === ownerKey || candidateKey === victimKey) continue;
    if (candidate.isOpened || candidate.isCleared || candidate.hasPassed || candidate.hoosgale) continue;
    return candidate.name;
  }
  return null;
}

function simulateAndApplyDabaaq(io, room, winnerName, dabaaqOwnerName, victimFooroName = dabaaqOwnerName) {
  const target = room.xiiliTarget || 5;
  const season = getXiiliSession(target);

  if (season && season.ended) {
    console.warn("⚠️ Xilli-ciyaareedkan waa uu dhammaaday, lama badeli karo dhibcaha!");
    return { scores: room.sessionScores, deltas: {} };
  }

  attachRoomToXiiliSession(room, target);
  
  // 1. CLONE SCORES
  const simulatedScores = JSON.parse(JSON.stringify(room.sessionScores));
  const deltas = {};

  // 2. HELI CLAUSES & KEYS
  const winnerScore = ensureSessionScore(simulatedScores, winnerName);
  const victimScore = victimFooroName ? ensureSessionScore(simulatedScores, victimFooroName) : null;
  if (!winnerScore) return { scores: room.sessionScores, deltas };

  const winnerKey      = normalizeSessionName(winnerName);
  const victimKey      = normalizeSessionName(victimFooroName);
  const dabaaqOwnerKey = normalizeSessionName(dabaaqOwnerName);

  const dabaaqOwnerScore = (dabaaqOwnerKey && dabaaqOwnerKey !== winnerKey)
    ? ensureSessionScore(simulatedScores, dabaaqOwnerName)
    : winnerScore;

  const ownerFooros  = dabaaqOwnerScore ? (dabaaqOwnerScore.fooros || 0) : 0;
  const ownerWins    = dabaaqOwnerScore ? (dabaaqOwnerScore.wins   || 0) : 0;
  const victimFooros = victimScore ? (victimScore.fooros || 0) : 0;
  const victimWins   = victimScore ? (victimScore.wins   || 0) : 0;

  const isDabaaqVictimDiff = victimKey && victimKey !== dabaaqOwnerKey;
  const chainedDabaaqTargetName = isDabaaqVictimDiff && winnerScore.fooros > 0 && victimWins > 0
    ? findChainedDabaaqTarget(room, winnerName, victimFooroName, dabaaqOwnerName)
    : null;
  const chainedDabaaqTarget = chainedDabaaqTargetName
    ? ensureSessionScore(simulatedScores, chainedDabaaqTargetName)
    : null;

  const isMixedDabaaq = Boolean(chainedDabaaqTarget);
  const isNegativeDabaaq = isDabaaqVictimDiff && ownerFooros > 0 && victimFooros > 0;
  const isPositiveDabaaq = isDabaaqVictimDiff && ownerWins > 0 && victimWins > 0
                         && ownerFooros === 0 && victimFooros === 0;

  const dabaaqType = !isMixedDabaaq && isNegativeDabaaq
    ? 'negative'
    : !isMixedDabaaq && isPositiveDabaaq
      ? 'positive'
      : null;

  // 3. APPLY SIMULATED RULES
  if (isMixedDabaaq) {
    const winnerFoorosToCarry = winnerScore.fooros;

    chainedDabaaqTarget.fooros = (chainedDabaaqTarget.fooros || 0) + winnerFoorosToCarry;
    addScoreDelta(deltas, chainedDabaaqTargetName, {
      fooros: winnerFoorosToCarry,
      net: -winnerFoorosToCarry,
    });

    winnerScore.fooros = Math.max(0, winnerFoorosToCarry - 1);
    addScoreDelta(deltas, winnerName, { fooros: -1, net: 1 });

    victimScore.wins = Math.max(0, victimWins - 1);
    addScoreDelta(deltas, victimFooroName, { wins: -1, net: -1 });

  } else if (isNegativeDabaaq) {
    // ----------------------------------------------------
    // XISAABTA SAXDA AH EE NEGATIVE DABAAQ:
    // Milkiilaha fooradiisii waa la tirtirayaa (oo guul baa loo beddelayaa),
    // Dhibbanaha waxaa lagu darayaa: foorooyinkiisii + milkiilaha fooradiisii + 1 (xarigga).
    // ----------------------------------------------------
    const addedFoorosToVictim = ownerFooros + 1;
    
    victimScore.fooros = victimFooros + addedFoorosToVictim;
    addScoreDelta(deltas, victimFooroName, { fooros: addedFoorosToVictim, net: -addedFoorosToVictim });

    dabaaqOwnerScore.fooros = 0;
    dabaaqOwnerScore.wins   = (dabaaqOwnerScore.wins || 0) + 1;
    addScoreDelta(deltas, dabaaqOwnerName, { fooros: -ownerFooros, wins: 1, net: ownerFooros + 1 });

    if (winnerKey !== dabaaqOwnerKey) {
      if (winnerScore.fooros > 0) {
        winnerScore.fooros--;
        addScoreDelta(deltas, winnerName, { fooros: -1, net: 1 });
      } else {
        winnerScore.wins = (winnerScore.wins || 0) + 1;
        addScoreDelta(deltas, winnerName, { wins: 1, net: 1 });
      }
    }

  } else if (isPositiveDabaaq) {
    dabaaqOwnerScore.wins = ownerWins + victimWins + 1;
    addScoreDelta(deltas, dabaaqOwnerName, { wins: victimWins + 1, net: victimWins + 1 });

    victimScore.wins   = 0;
    victimScore.fooros = (victimScore.fooros || 0) + 1;
    addScoreDelta(deltas, victimFooroName, { wins: -victimWins, fooros: 1, net: -(victimWins + 1) });

    if (winnerKey !== dabaaqOwnerKey) {
      if (winnerScore.fooros > 0) {
        winnerScore.fooros--;
        addScoreDelta(deltas, winnerName, { fooros: -1, net: 1 });
      } else {
        winnerScore.wins = (winnerScore.wins || 0) + 1;
        addScoreDelta(deltas, winnerName, { wins: 1, net: 1 });
      }
    }

  } else {
    // FOORO CAADI AH
    if (victimScore && victimKey && victimKey !== winnerKey) {
      victimScore.fooros = (victimScore.fooros || 0) + 1;
      addScoreDelta(deltas, victimFooroName, { fooros: 1, net: -1 });
    }

    if (winnerScore.fooros > 0) {
      winnerScore.fooros--;
      addScoreDelta(deltas, winnerName, { fooros: -1, net: 1 });
    } else {
      winnerScore.wins = (winnerScore.wins || 0) + 1;
      addScoreDelta(deltas, winnerName, { wins: 1, net: 1 });
    }

    if (dabaaqOwnerKey && dabaaqOwnerKey !== winnerKey) {
      if (dabaaqOwnerScore && dabaaqOwnerScore.wins > 0) {
        dabaaqOwnerScore.wins--;
        winnerScore.wins = (winnerScore.wins || 0) + 1;
        addScoreDelta(deltas, dabaaqOwnerName, { wins: -1, net: -1 });
        addScoreDelta(deltas, winnerName,      { wins: 1,  net: 1  });
      }
    }
  }

  // 4. COMMIT TO ROOM AND SEASON SCORES
  season.scores = simulatedScores;
  room.sessionScores = season.scores;
  saveSessionsData();

  if (io && room.id) {
    io.to(room.id).emit('updateScores', {
      sessionScores: room.sessionScores,
      xiiliTarget: target
    });
  }

  // 5. CHECK GAME / SEASON OVER
  const loserEntry = Object.entries(room.sessionScores || {}).find(
    ([, score]) => (score.fooros || 0) >= target
  );
  
  if (loserEntry && !season.ended) {
    const loser = room.sessionScores[loserEntry[0]].displayName || loserEntry[0];
    season.ended = true;
    saveSessionsData();
    if (io && room.id) {
      io.to(room.id).emit('seasonEnded', { loser, scores: room.sessionScores, target });
    }
  }

  return { scores: room.sessionScores, deltas, dabaaqType };
}

function applyDabaaq(io, room, winnerName, dabaaqOwnerName, victimFooroName = dabaaqOwnerName) {
  return simulateAndApplyDabaaq(io, room, winnerName, dabaaqOwnerName, victimFooroName);
}

function applyWinnerScore(winnerScore) {
  // Haddii qofku uu leeyahay foorooyin la duldhacay, guushu waxay ka gooynaysaa hal fooro (net-ka ayay saxaysaa)
  if (winnerScore.fooros > 0) {
    winnerScore.fooros--; // Ka jar hal fooro
  } else {
    winnerScore.wins = (winnerScore.wins || 0) + 1; // Haddii uusan fooro lahayn, u kordhi guul caadi ah
  }
}

function broadcastSessionScores(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  attachRoomToXiiliSession(room, room.xiiliTarget || 5);

  // Hubin in ciyaartoyda cusub ama la jooga ay diiwaanka ku jiraan
  room.players.forEach(p => {
    ensureSessionScore(room.sessionScores, p.name);
  });

  io.to(roomId).emit('sessionFooroUpdate', {
    scores: room.sessionScores,
    xiiliTarget: room.xiiliTarget || 5
  });
}

// ─── Hubinta xiilliga dhammaadka: haddii qof uu gaaro target ─────────────────
function checkAndEmitSeasonEnd(roomId) {
  const room = rooms[roomId];
  if (!room) return false;
  const target = room.xiiliTarget || 5;
  const loserEntry = Object.entries(room.sessionScores || {}).find(([, d]) => d.fooros >= target);
  if (loserEntry) {
    io.to(roomId).emit('seasonEnded', {
      scores: room.sessionScores,
      loser: loserEntry[1].displayName || loserEntry[0],
      target,
    });
    return true;
  }
  return false;
}

function resetXiiliSession(target = 5) {
  const normalizedTarget = normalizeXiiliTarget(target);
  const key = String(normalizedTarget);
  xiiliSessions.set(key, { target: normalizedTarget, scores: {}, ended: false });
  saveSessionsData();
}

// ─── Game Logic ───────────────────────────────────────────────────────────────
const TURN_TIME_LIMIT = 30000;
const RECONNECT_WINDOW_MS = 5 * 60 * 1000;
const rooms = {};

function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getCardPoints(value) {
  if (['J', 'Q', 'K'].includes(value)) return 10;
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
  const suits = ['♦', '♥', '♠', '♣'];
  const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let i = 0; i < 4; i++)
    for (const s of suits)
      for (const v of values)
        deck.push({ suit: s, value: v, id: `${s}-${v}-${i}-${Math.random().toString(36).substr(2, 5)}`, points: getCardPoints(v) });
  return shuffle(deck);
}

function prepareGame() {
  const deck = createDeck();
  const allHands = [];
  for (let i = 0; i < 4; i++) allHands.push(deck.splice(0, i === 0 ? 15 : 14));
  return { allHands, remainingDeck: deck };
}

function getCardValue(card) {
  const map = { A: 14, K: 13, Q: 12, J: 11 };
  return map[card.value] ?? parseInt(card.value);
}

function autoSplitIntoGroups(cards) {
  const groups = [];
  const usedIdx = new Set();
  const temp = cards.map((c, i) => ({ ...c, _i: i }));

  for (const suit of ['♠', '♥', '♣', '♦']) {
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
  }

  const remaining = temp.filter(c => !usedIdx.has(c._i));
  for (const val of [...new Set(remaining.map(c => c.value))]) {
    const vc = remaining.filter(c => c.value === val && !usedIdx.has(c._i));
    const grp = [];
    const seen = new Set();
    for (const card of vc) {
      if (!seen.has(card.suit) && grp.length < 4) { seen.add(card.suit); grp.push(card); }
    }
    if (grp.length >= 3) { groups.push(grp.map(({ _i, ...r }) => r)); grp.forEach(c => usedIdx.add(c._i)); }
  }
  return groups;
}

function findPairs(cards) {
  const pairs = [];
  const used = new Set();

  const byValue = {};
  for (const c of cards) (byValue[c.value] ??= []).push(c);
  for (const val in byValue) {
    const seenSuits = new Set();
    const grp = [];
    for (const c of byValue[val]) {
      if (!seenSuits.has(c.suit)) { seenSuits.add(c.suit); grp.push(c); }
    }
    if (grp.length === 2) { pairs.push(grp); grp.forEach(c => used.add(c.id)); }
  }

  for (const suit of ['♠', '♥', '♣', '♦']) {
    const sc = cards.filter(c => c.suit === suit && !used.has(c.id))
      .sort((a, b) => getCardValue(a) - getCardValue(b));
    for (let i = 0; i < sc.length - 1; i++) {
      if (used.has(sc[i].id) || used.has(sc[i + 1].id)) continue;
      if (getCardValue(sc[i + 1]) === getCardValue(sc[i]) + 1) {
        pairs.push([sc[i], sc[i + 1]]);
        used.add(sc[i].id); used.add(sc[i + 1].id);
      }
    }
  }
  return pairs;
}

function pickBestDiscard(hand, isSafe) {
  const groups = autoSplitIntoGroups([...hand]);
  const groupedIds = new Set(groups.flat().map(c => c.id));
  const rest = hand.filter(c => !groupedIds.has(c.id));
  const pairs = findPairs(rest);
  const pairedIds = new Set(pairs.flat().map(c => c.id));

  const singles = rest.filter(c => !pairedIds.has(c.id) && isSafe(c));
  if (singles.length > 0) return singles.sort((a, b) => getCardPoints(b.value) - getCardPoints(a.value))[0];

  const safePairs = pairs.filter(p => p.some(isSafe));
  if (safePairs.length > 0) {
    safePairs.sort((a, b) =>
      a.reduce((s, c) => s + getCardPoints(c.value), 0) - b.reduce((s, c) => s + getCardPoints(c.value), 0));
    return safePairs[0].filter(isSafe).sort((a, b) => getCardPoints(b.value) - getCardPoints(a.value))[0];
  }

  const safeGroups = groups.filter(g => g.some(isSafe));
  if (safeGroups.length > 0) {
    safeGroups.sort((a, b) => a.length - b.length);
    return safeGroups[0].filter(isSafe).sort((a, b) => getCardPoints(b.value) - getCardPoints(a.value))[0];
  }

  return hand.find(isSafe) || null;
}

function chooseBotDiscard(hand, room, bot) {
  if (!hand.length) return null;
  const nextPlayer = room && bot ? room.players[(room.activePlayerIndex + 1) % room.players.length] : null;
  const meelGaleActive = !!(room && bot && !bot.isOpened && hand.length > 1 && nextPlayer && nextPlayer.isOpened);
  const allTableSets = meelGaleActive ? room.players.flatMap(pl => pl.openedSets || []) : [];
  const isSafe = c => !meelGaleActive || !isCardMeelGale(c, allTableSets);
  return pickBestDiscard(hand, isSafe) || hand[hand.length - 1];
}

function checkBatuuta(room, p) {
  if (!p || !p.isOpened || p.hoosgale) return false;
  if (!p.hand || p.hand.length !== 2) return false;
  const openedCount = (p.openedSets || []).reduce((s, set) => s + set.length, 0);
  if (openedCount !== 12) return false;

  room.stockPile = shuffle([...room.stockPile, ...p.hand]);
  p.hand = [];
  p.isOpened = false;
  p.openedSets = [];
  p.hoosgale = true;
  return true;
}

function isCardMeelGale(card, openedSets) {
  if (!openedSets || !openedSets.length) return false;
  for (const set of openedSets) {
    if (!set || !set.length) continue;
    if (set.every(c => c.suit === card.suit)) {
      const vals = set.map(c => getCardValue(c)).sort((a, b) => a - b);
      const v = getCardValue(card);
      if (v === vals[0] - 1 || v === vals[vals.length - 1] + 1) return true;
    }
    if (set.every(c => c.value === card.value) && !set.some(c => c.suit === card.suit) && set.length < 4) return true;
  }
  return false;
}

function pickAutoDiscard(room, cur) {
  const hand = cur.hand;
  if (!hand || !hand.length) return null;

  const nextIdx = (room.activePlayerIndex + 1) % room.players.length;
  const nextPlayer = room.players[nextIdx];
  const meelGaleActive = !cur.isOpened && hand.length > 1 && nextPlayer && nextPlayer.isOpened;
  const allTableSets = meelGaleActive ? room.players.flatMap(pl => pl.openedSets || []) : [];
  const isSafe = c => !meelGaleActive || !isCardMeelGale(c, allTableSets);

  const takeById = id => {
    const idx = hand.findIndex(c => c.id === id);
    return idx !== -1 ? hand.splice(idx, 1)[0] : null;
  };

  if (cur.pickedFromDiscard && cur.lastPickedCardId) {
    const idx = hand.findIndex(c => c.id === cur.lastPickedCardId);
    if (idx !== -1 && isSafe(hand[idx])) return takeById(cur.lastPickedCardId);
  }

  const best = pickBestDiscard(hand, isSafe);
  if (best) return takeById(best.id);

  return hand.pop();
}

function getPlayerOpenedPoints(player) {
  return (player.openedSets || []).flat().reduce((s, c) => s + getCardPoints(c.value), 0);
}

function recalculateRoomBarrier(room) {
  if (!room.barrierHistory) room.barrierHistory = [101];
  if (!room.hasFirstOpened) { room.lastOpenPoints = 101; return; }
  if (room.barrierFrozen) return;
  const oldBarrier = room.lastOpenPoints;
  const otherOpened = room.players.some(p => p.isOpened && p.id !== room.firstOpenerId);
  if (otherOpened) {
    room.lastOpenPoints = (room.firstOpenerOriginalPoints ?? 101) + 1;
    room.barrierFrozen = true;
  } else {
    const firstOpener = room.players.find(p => p.id === room.firstOpenerId);
    if (firstOpener) room.lastOpenPoints = getPlayerOpenedPoints(firstOpener) + 1;
  }
  if (room.barrierHistory.length === 1 && room.lastOpenPoints !== oldBarrier) {
    const openerScore = room.firstOpenerOriginalPoints ?? (room.lastOpenPoints - 1);
    room.barrierHistory.push(openerScore, room.lastOpenPoints);
  } else if (room.barrierHistory.length > 1) {
    room.barrierHistory[room.barrierHistory.length - 1] = room.lastOpenPoints;
  }
}

function resetPlayerState(p) {
  p.hand = []; p.isOpened = false; p.hasActioned = false;
  p.pickedFromDiscard = false; p.lastPickedCardId = null;
  p.openedSets = []; p.hoosgale = false; p.tempScore = 0;
  p.openedWithCardId = null; p.openProviderId = null;
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new IOServer(httpServer, {
  path: '/game-io',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
});

function updateRoomPlayers(roomId) {
  const room = rooms[roomId]; if (!room) return;
  const active = room.players[room.activePlayerIndex];
  io.to(roomId).emit('playersUpdate', {
    players: room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.hand.length, isOpened: p.isOpened, online: p.online, points: p.points, isBot: p.isBot, hoosgale: p.hoosgale })),
    stockCount: room.stockPile.length,
    currentTurnId: active ? active.id : null,
    turnStartTime: room.turnStartTime,
    nextRequiredPoints: room.lastOpenPoints || 101,
    barrierHistory: room.barrierHistory || [101],
  });
}

function broadcastTableUI(roomId) {
  const room = rooms[roomId]; if (!room) return;
  io.to(roomId).emit('updateTableUI', {
    discardPile: room.discardPile,
    players: room.players.map(p => ({ id: p.id, name: p.name, openedSets: p.openedSets })),
    nextRequiredPoints: room.lastOpenPoints || 101
  });
}

function endGame(roomId, potentialWinner, extraData = {}) {
  const room = rooms[roomId];
  if (!room) return;

  if (!potentialWinner.isOpened) return;

  room.gameStarted = false;
  if (room.turnTimeout) clearTimeout(room.turnTimeout);

  room.players.forEach(pl => {
    if (pl.id === potentialWinner.id) return;
    if (!pl.isOpened) { pl.points += 101; }
    if (pl.isOpened && pl.hoosgale) { pl.points += 1; }
  });

  // SESSION SCORES: dhammaan ciyaartoyda (dad + robots) ha ku jiraan xilliga.
  initializeRoomScores(room, room.xiiliTarget || 5);

  const fooroTargetId = findFooroTarget(potentialWinner.id, room.lastProviderId, room.players);
  const winnerPlayer = room.players.find(p => p.id === potentialWinner.id);
  const victimPlayer = fooroTargetId ? room.players.find(p => p.id === fooroTargetId) : null;
  const providerPlayer = room.lastProviderId && room.lastProviderId !== potentialWinner.id
    ? room.players.find(p => p.id === room.lastProviderId)
    : null;

  const scoreResult = winnerPlayer
    ? applyDabaaq(io, room, winnerPlayer.name, providerPlayer?.name || null, victimPlayer?.name || null)
    : { scores: room.sessionScores, deltas: {}, dabaaqType: null };

  // Persistent profile scores use the same deltas as session scores so the
  // login/leaderboard totals do not restart from 0 after a new setup/login.
  const { roundDeltas } = updatePersistentScores(room, scoreResult);

  // Reset-ka waa inuu yimaadaa kadib kaydinta ciyaarta ugu dambaysa.
  // Haddii uu ka horreeyo updatePersistentScores(), ciyaarta ugu dambaysa
  // waxay dib ugu qori lahayd tirada profiles-ka.
  if (getXiiliSession(room.xiiliTarget || 5).ended) {
    resetAllProfileStats();
    io.emit('profilesReset');
  }

  io.to(roomId).emit('gameOver', {
    winnerId: potentialWinner.id,
    winnerName: potentialWinner.name,
    fooroTargetId,
    dabaaqType: scoreResult.dabaaqType || null,
    sessionScores: room.sessionScores,
    xiiliTarget: room.xiiliTarget || 5,
    providerId: room.lastProviderId,
    actionType: extraData.actionType || 'discard',
    lastCard: extraData.lastCard || null,
    stats: room.playerStats || {},
    history: room.moveHistory || [],
    allPlayers: room.players.map(pl => ({
      id: pl.id,
      name: pl.name,
      isOpened: pl.isOpened,
      hand: pl.hand,
      points: pl.points,
      isBot: pl.isBot,
      openedSets: pl.openedSets,
      hoosgale: !!pl.hoosgale,
      openProviderId: pl.openProviderId || null
    })),
  });

  const leaderboard = getLeaderboardData();
  if (leaderboard.length > 0) {
    io.to(roomId).emit('leaderboardUpdate', { leaderboard, roundDeltas, fooroTargetId });
  }

  // U dir dhibcaha cusboonaasiiyay ciyaartoyda oo dhan
  broadcastSessionScores(roomId);

  // Hubi haddii xilliyagu dhammaadey
  checkAndEmitSeasonEnd(roomId);

  setTimeout(() => {
    if (rooms[roomId]) {
      io.in(roomId).socketsLeave(roomId);
      delete rooms[roomId];
    }
  }, 8000);
}

function moveToNextPlayer(roomId) {
  const room = rooms[roomId]; if (!room) return;
  room.isPaused = false;
  room.turnToken = (room.turnToken || 0) + 1;
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
  room.players.forEach(p => { p.hasActioned = false; p.pickedFromDiscard = false; p.lastPickedCardId = null; });
  startTurnTimer(roomId);
  io.to(roomId).emit('playersUpdate', {
    players: room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.hand.length, isOpened: p.isOpened, online: p.online, points: p.points, hoosgale: p.hoosgale, isBot: p.isBot })),
    stockCount: room.stockPile.length,
    currentTurnId: next ? next.id : null,
    turnStartTime: room.turnStartTime,
    nextRequiredPoints: room.lastOpenPoints || 101,
  });
  if (next && !next.isBot) io.to(next.id).emit('yourTurn');
}

function scheduleBotTurn(roomId, botId) {
  const room = rooms[roomId]; if (!room || !room.gameStarted) return;
  const thinkTime = 1200 + Math.floor(Math.random() * 800);
  const myToken = room.turnToken;
  room.turnTimeout = setTimeout(() => {
    if (!rooms[roomId] || rooms[roomId].turnToken !== myToken) return;
    doBotTurn(roomId, botId);
  }, thinkTime);
}

function refillStockIfEmpty(roomId) {
  const room = rooms[roomId]; if (!room) return;
  if (room.stockPile.length === 0 && room.discardPile.length > 1) {
    const top = room.discardPile.pop();
    room.stockPile = shuffle([...room.discardPile]);
    room.discardPile = [top];
    io.to(roomId).emit('updateStockCount', room.stockPile.length);
  }
}

function doBotTurn(roomId, botId) {
  const room = rooms[roomId]; if (!room || !room.gameStarted) return;
  const botIdx = room.players.findIndex(p => p.id === botId);
  if (botIdx === -1 || botIdx !== room.activePlayerIndex) return;
  const bot = room.players[botIdx];
  if (!bot || !bot.isBot) return;

  refillStockIfEmpty(roomId);
  let drewFromDiscard = false;

  if (room.discardPile.length > 0 && !bot.isOpened) {
    const topDiscard = room.discardPile[room.discardPile.length - 1];
    const testGroups = autoSplitIntoGroups([...bot.hand, topDiscard]);
    const testScore = testGroups.flat().reduce((s, c) => s + getCardPoints(c.value), 0);
    if (testScore >= room.lastOpenPoints && testGroups.some(g => g.length >= 4)) {
      room.discardPile.pop();
      const newCard = { ...topDiscard, fromDiscard: true };
      bot.hand.push(newCard);
      bot.hasActioned = true; bot.pickedFromDiscard = true; bot.lastPickedCardId = newCard.id;
      io.to(roomId).emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1] ?? null);
      io.to(roomId).emit('botPickedDiscard', { botName: bot.name });
      drewFromDiscard = true;
    }
  }

  if (!drewFromDiscard && room.stockPile.length > 0) {
    const card = room.stockPile.pop();
    bot.hand.push(card); bot.hasActioned = true; bot.pickedFromDiscard = false; bot.lastPickedCardId = null; room.lastProviderId = null;
    io.to(roomId).emit('updateStockCount', room.stockPile.length);
  }
  updateRoomPlayers(roomId);

  setTimeout(() => {
    if (!room.gameStarted) return;
    const groups = autoSplitIntoGroups([...bot.hand]);
    const totalScore = groups.flat().reduce((s, c) => s + getCardPoints(c.value), 0);
    const hasFourPlus = groups.some(g => g.length >= 4);

    if (!bot.isOpened) {
      if (totalScore >= room.lastOpenPoints && hasFourPlus) {
        const ids = new Set(groups.flat().map(c => c.id));
        bot.hand = bot.hand.filter(c => !ids.has(c.id));
        if (bot.pickedFromDiscard) bot.openProviderId = room.lastProviderId || null;
        bot.isOpened = true; bot.openedSets.push(...groups);
        if (!room.hasFirstOpened) {
          room.hasFirstOpened = true; room.firstOpenerId = bot.id;
          room.firstOpenerOriginalPoints = getPlayerOpenedPoints(bot);
          if (!room.openedPlayerIds) room.openedPlayerIds = new Set();
          room.openedPlayerIds.add(bot.id);
        }
        const oldBarrier = room.lastOpenPoints;
        recalculateRoomBarrier(room);
        broadcastTableUI(roomId); updateRoomPlayers(roomId);
        io.to(roomId).emit('notification', room.lastOpenPoints !== oldBarrier
          ? `🤖 ${bot.name} ayaa furay! Minimum-ka dadka kale waa: ${room.lastOpenPoints}`
          : `🤖 ${bot.name} ayaa furay!`);

        let mgDone = false;
        bot.hand = bot.hand.filter(card => {
          for (const pl of room.players) {
            for (const set of (pl.openedSets || [])) {
              if (isCardMeelGale(card, [set])) { set.push(card); mgDone = true; return false; }
            }
          }
          return true;
        });
        if (mgDone) { recalculateRoomBarrier(room); broadcastTableUI(roomId); updateRoomPlayers(roomId); }
      }
    } else {
      if (groups.length > 0) {
        const ids = new Set(groups.flat().map(c => c.id));
        bot.hand = bot.hand.filter(c => !ids.has(c.id));
        bot.openedSets.push(...groups);
        const oldBarrier = room.lastOpenPoints;
        recalculateRoomBarrier(room);
        broadcastTableUI(roomId); updateRoomPlayers(roomId);
        if (room.lastOpenPoints !== oldBarrier)
          io.to(roomId).emit('notification', `🤖 ${bot.name} ayaa kordhiyay dhibcihiisii! Minimum-ka cusub waa: ${room.lastOpenPoints}`);
      }
      let mgDone = false;
      bot.hand = bot.hand.filter(card => {
        for (const pl of room.players) {
          for (const set of (pl.openedSets || [])) {
            if (isCardMeelGale(card, [set])) { set.push(card); mgDone = true; return false; }
          }
        }
        return true;
      });
      if (mgDone) { recalculateRoomBarrier(room); broadcastTableUI(roomId); updateRoomPlayers(roomId); }
    }

    setTimeout(() => {
      if (!room.gameStarted) return;
      if (bot.hand.length === 0) { endGame(roomId, bot); return; }

      const cardToDiscard = chooseBotDiscard(bot.hand, room, bot);
      if (!cardToDiscard) { moveToNextPlayer(roomId); return; }

      const di = bot.hand.findIndex(c => c.id === cardToDiscard.id);
      if (di !== -1) bot.hand.splice(di, 1);

      room.discardPile.push(cardToDiscard);
      io.to(roomId).emit('updateDiscardPile', cardToDiscard);

      if (bot.hand.length === 0) { updateRoomPlayers(roomId); endGame(roomId, bot); return; }

      room.lastProviderId = bot.id;

      if (checkBatuuta(room, bot)) {
        io.to(roomId).emit('notification', `🚨 Batuuto! Bot-ka ${bot.name} wuxuu degay 12 kaar, 2-na wuu hayay — dib ayaa loo celiyay.`);
        updateRoomPlayers(roomId); broadcastTableUI(roomId);
        moveToNextPlayer(roomId);
        return;
      }
      moveToNextPlayer(roomId);
    }, 700);
  }, 500);
}

function startTurnTimer(roomId) {
  const room = rooms[roomId]; if (!room) return;
  if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
  room.turnStartTime = Date.now(); room.isPaused = false;
  const player = room.players[room.activePlayerIndex];
  if (player && !player.isBot) room.turnToken = (room.turnToken || 0) + 1;
  const myToken = room.turnToken;
  updateRoomPlayers(roomId);
  if (!player) return;
  player.hasActioned = player.hand.length >= 15;
  if (player.isBot) { scheduleBotTurn(roomId, player.id); return; }

  room.turnTimeout = setTimeout(() => {
    if (!rooms[roomId] || rooms[roomId].turnToken !== myToken) return;
    if (!room.gameStarted || room.isPaused) return;
    const cur = room.players[room.activePlayerIndex];
    if (!cur || cur.id !== player.id) return;

    if (cur.isOpened) {
      if (cur.hand.length > 0) {
        if (!cur.hasActioned) {
          refillStockIfEmpty(roomId);
          if (room.stockPile.length > 0) {
            const drawn = room.stockPile.pop();
            cur.hand.push(drawn);
            io.to(roomId).emit('updateStockCount', room.stockPile.length);
          } else { io.to(cur.id).emit('notification', 'Waqtigii wuu dhammaatay — Kaar la heli waayay, wareegga la gudbay.'); moveToNextPlayer(roomId); return; }
        }
        let cardToDiscard;
        if (cur.pickedFromDiscard && cur.lastPickedCardId) {
          const idx = cur.hand.findIndex(c => c.id === cur.lastPickedCardId);
          cardToDiscard = idx !== -1 ? cur.hand.splice(idx, 1)[0] : cur.hand.pop();
        } else { cardToDiscard = cur.hand.pop(); }
        if (cardToDiscard) {
          room.discardPile.push(cardToDiscard); room.lastProviderId = cur.id;
          io.to(roomId).emit('updateDiscardPile', cardToDiscard);
          io.to(cur.id).emit('autoDiscarded', { playerId: cur.id, card: cardToDiscard });
          io.to(cur.id).emit('updateHand', { hand: cur.hand });
        }
      }
      if (cur.hand.length === 0) { endGame(roomId, cur); return; }
      moveToNextPlayer(roomId); return;
    }

    if (cur.hasActioned) {
      const cardToDiscard = pickAutoDiscard(room, cur);
      if (cardToDiscard) {
        room.discardPile.push(cardToDiscard);
        io.to(roomId).emit('updateDiscardPile', cardToDiscard);
        io.to(cur.id).emit('autoDiscarded', { playerId: cur.id, card: cardToDiscard });
        io.to(cur.id).emit('updateHand', { hand: cur.hand });
      }
      moveToNextPlayer(roomId); return;
    }

    refillStockIfEmpty(roomId);
    if (room.stockPile.length > 0) {
      const drawnCard = room.stockPile.pop();
      cur.hand.push(drawnCard);
      io.to(cur.id).emit('receiveCard', drawnCard);
      io.to(roomId).emit('updateStockCount', room.stockPile.length);
      cur.hand.pop();
      room.discardPile.push(drawnCard);
      io.to(roomId).emit('updateDiscardPile', drawnCard);
      io.to(cur.id).emit('autoDiscarded', { playerId: cur.id, card: drawnCard });
      io.to(cur.id).emit('updateHand', { hand: cur.hand });
    }
    moveToNextPlayer(roomId);
  }, TURN_TIME_LIMIT);
}

function startGame(roomId) {
  const room = rooms[roomId];
  if (!room || room.gameStarted) return;

  room.gameStarted = true;
  room.turnStartTime = Date.now();
  room.lastOpenPoints = 101;
  room.hasFirstOpened = false;
  room.firstOpenerId = null;
  room.firstOpenerOriginalPoints = null;
  room.barrierFrozen = false;
  room.openedPlayerIds = new Set();
  room.barrierHistory = [101];
  room.playerStats = {};
  room.moveHistory = [];

  // Xifidaada dhibcaha xilliyada — muhiim: dib loo bilaabo kuma aha, waxa la xifidaa waa joogto
  initializeRoomScores(room, room.xiiliTarget || 5);

  const gd = prepareGame();
  room.stockPile = gd.remainingDeck;
  room.players.forEach((p, i) => {
    resetPlayerState(p);
    p.hand = gd.allHands[i];
    if (i === 0) p.hasActioned = true;
    if (!p.isBot) io.to(p.id).emit('startHand', p.hand);
  });

  if (room.stockPile.length > 0) room.discardPile = [room.stockPile.pop()];
  const topDiscard = room.discardPile[room.discardPile.length - 1];
  const firstPlayer = room.players[0];

  room.players.forEach(p => {
    if (!p.isBot) io.to(p.id).emit('matchFound', { roomId, topDiscard, currentTurn: firstPlayer.id });
  });

  io.to(roomId).emit('updateStockCount', room.stockPile.length);
  broadcastTableUI(roomId);
  startTurnTimer(roomId);
  updateRoomPlayers(roomId);

  // U dir xogta foorooyinka bilowga ciyaarta
  broadcastSessionScores(roomId);
}

function addBotsAndStartGame(roomId) {
  const room = rooms[roomId];
  if (!room || room.gameStarted || room._botsAdding) return;
  room._botsAdding = true;
  const botNames = ['JAAMAC', 'JIMCAALE', 'FAARAX'];
  const needed = 4 - room.players.length;
  for (let i = 0; i < needed; i++) {
    const botId = `bot_${Math.random().toString(36).slice(2, 9)}`;
    room.players.push({ id: botId, name: botNames[i], hand: [], isOpened: false, hasActioned: false, pickedFromDiscard: false, lastPickedCardId: null, openedSets: [], online: true, points: 0, tempScore: 0, isBot: true, hoosgale: false, openProviderId: null, sessionToken: null, disconnectedAt: null, profileName: null });
    io.to(roomId).emit('waitingRoomUpdate', { players: room.players.map(p => ({ name: p.name, isBot: p.isBot })) });
  }
  setTimeout(() => { room._botsAdding = false; startGame(roomId); }, 1500);
}

// ─── Socket events ────────────────────────────────────────────────────────────
io.on('connection', socket => {
  let myRoomId = '';

  socket.on('joinRandom', (data) => {
    const name = typeof data === 'string' ? data : data.name;
    const incomingToken = typeof data === 'string' ? null : data.token;
    const profileName = typeof data === 'string' ? null : (data.profileName || null);
    const xiiliTarget = typeof data === 'string' ? 5 : (parseInt(data.xiiliTarget) || 5);

    for (const id in rooms) {
      const room = rooms[id];
      const existing = room.players.find(p => p.name === name && !p.online && !p.isBot);
      if (existing) {
        const tokenMatches = incomingToken && existing.sessionToken && incomingToken === existing.sessionToken;
        const isRecent = existing.disconnectedAt !== null && Date.now() - existing.disconnectedAt < RECONNECT_WINDOW_MS;
        if (tokenMatches && isRecent) {
          const oldId = existing.id;
          existing.id = socket.id; existing.online = true; existing.disconnectedAt = null;
          if (room.firstOpenerId === oldId) room.firstOpenerId = socket.id;
          myRoomId = id; socket.join(id);
          socket.emit('sessionToken', existing.sessionToken);
          socket.emit('startHand', existing.hand);
          if (room.discardPile.length > 0) socket.emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1]);
          broadcastTableUI(id);
          const cur = room.players[room.activePlayerIndex];
          socket.emit('matchFound', { roomId: id, topDiscard: room.discardPile[room.discardPile.length - 1], currentTurn: cur ? cur.id : null });
          updateRoomPlayers(id);
          socket.emit('notification', 'Waad ku soo laabtay!');
          broadcastSessionScores(id);
          if (room.gameStarted && cur && cur.isBot && !room.turnTimeout && !room.isPaused) scheduleBotTurn(id, cur.id);
          return;
        }
      }
    }

    let rid = Object.keys(rooms).find(id => rooms[id].players.length < 4 && !rooms[id].gameStarted);
    if (!rid) {
      rid = 'Room_' + Math.random().toString(36).slice(2, 11);
      rooms[rid] = {
        id: rid, players: [], gameStarted: false, stockPile: [], discardPile: [],
        activePlayerIndex: 0, lastOpenPoints: 101, turnTimeout: null, turnStartTime: null,
        lastProviderId: null, botFillTimer: null, isPaused: false, pauseTimeLeft: 0,
        turnToken: 0, hasFirstOpened: false, firstOpenerId: null, firstOpenerOriginalPoints: null,
        barrierFrozen: false, openedPlayerIds: new Set(), barrierHistory: [101],
        playerStats: {}, moveHistory: [],
        sessionScores: {},
        xiiliTarget: xiiliTarget,
      };
    }

    const sessionToken = genToken();
    const room = rooms[rid];
    // Hubi xiiliTarget-ka qolka hadduu u dhignaado kan cusub (qofka koowaad ayaa go'aaminaya)
    if (!room.gameStarted && room.players.length === 0) {
      room.xiiliTarget = xiiliTarget;
    }
    room.players.push({ id: socket.id, name: name || `User_${socket.id.slice(0, 4)}`, hand: [], isOpened: false, hasActioned: false, pickedFromDiscard: false, lastPickedCardId: null, openedSets: [], online: true, points: 0, tempScore: 0, isBot: false, hoosgale: false, openProviderId: null, sessionToken, disconnectedAt: null, profileName: profileName || null });
    socket.join(rid); myRoomId = rid;
    socket.emit('sessionToken', sessionToken);
    io.to(rid).emit('waitingRoomUpdate', { players: room.players.map(p => ({ name: p.name, isBot: p.isBot })) });
    broadcastSessionScores(rid);

    if (room.players.length === 4) {
      if (room.botFillTimer) { clearTimeout(room.botFillTimer); room.botFillTimer = null; }
      startGame(rid); return;
    }
    if (room.players.length === 1) {
      room.botFillTimer = setTimeout(() => {
        if (rooms[rid] && !rooms[rid].gameStarted && rooms[rid].players.length < 4) {
          io.to(rid).emit('notification', 'Waa la waayey ciyaartoy caadi ah — Sidaa darteed waxaa kula ciyaari doona Robot!');
          addBotsAndStartGame(rid);
        }
      }, 10000);
    }
  });

  socket.on('addBots', () => {
    if (!myRoomId) { for (const id in rooms) if (rooms[id].players.some(p => p.id === socket.id)) { myRoomId = id; break; } }
    if (!myRoomId) { socket.emit('notification', 'Qolka la heli waayo.'); return; }
    const room = rooms[myRoomId]; if (!room || room.gameStarted) return;
    if (room.botFillTimer) { clearTimeout(room.botFillTimer); room.botFillTimer = null; }
    addBotsAndStartGame(myRoomId);
  });

  socket.on('updatePenaltyScore', (data) => {
    const room = rooms[myRoomId]; if (!room) return;
    const p = room.players.find(pl => pl.id === data.playerId);
    if (p) { p.points += data.points; io.to(myRoomId).emit('scoreUpdated', { playerId: p.id, newTotal: p.points }); }
  });

  socket.on('drawCard', () => {
    const room = rooms[myRoomId]; if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id) { socket.emit('notification', 'Sug doorkaaga!'); return; }
    if (p.hand.length >= 15) { socket.emit('notification', 'Ma qaadan kartid kaar kale. Mid tuur marka hore!'); return; }
    if (p.hasActioned) { socket.emit('notification', 'Horey ayaad u qaadatay kaar.'); return; }
    refillStockIfEmpty(myRoomId);
    if (room.stockPile.length > 0) {
      const card = room.stockPile.pop();
      p.hand.push(card); p.hasActioned = true; p.pickedFromDiscard = false; p.lastPickedCardId = null; room.lastProviderId = null;
      socket.emit('receiveCard', card);
      io.to(myRoomId).emit('updateStockCount', room.stockPile.length);
      updateRoomPlayers(myRoomId);
    }
  });

  socket.on('pickDiscard', () => {
    const room = rooms[myRoomId];
    if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id || p.hasActioned) return;
    if (room.discardPile.length > 0) {
      const card = room.discardPile.pop();
      const providerId = room.lastProviderId;
      if (providerId) {
        if (!room.playerStats) room.playerStats = {};
        if (!room.playerStats[p.id]) room.playerStats[p.id] = { pickedFrom: {} };
        room.playerStats[p.id].pickedFrom[providerId] = (room.playerStats[p.id].pickedFrom[providerId] || 0) + 1;
        if (!room.moveHistory) room.moveHistory = [];
        room.moveHistory.push({ playerId: p.id, playerName: p.name, card: `${card.suit}${card.value}`, fromId: providerId, time: Date.now() });
      }
      p.hand.push(card); p.hasActioned = true; p.pickedFromDiscard = true; p.lastPickedCardId = card.id;
      socket.emit('discardPickedSuccess', { card });
      socket.emit('updateHand', { hand: p.hand });
      io.to(myRoomId).emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1] ?? null);
      updateRoomPlayers(myRoomId);
    }
  });

  socket.on('returnDiscardCard', () => {
    const room = rooms[myRoomId]; if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id || !p.pickedFromDiscard) return;
    const cardIdx = p.hand.findIndex(c => c.id === p.lastPickedCardId);
    const top = cardIdx !== -1 ? p.hand[cardIdx] : p.hand[p.hand.length - 1];
    if (!top) return;
    if (cardIdx !== -1) p.hand.splice(cardIdx, 1); else p.hand.pop();
    room.discardPile.push(top);
    p.hasActioned = false; p.pickedFromDiscard = false; p.lastPickedCardId = null;
    socket.emit('updateHand', { hand: p.hand });
    io.to(myRoomId).emit('updateDiscardPile', top);
    socket.emit('discardReturnedSuccess');
  });

  socket.on('playCard', (data) => {
    const room = rooms[myRoomId]; if (!room || !room.gameStarted) return;
    const card = data.card || data; if (!card || !card.id) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id) { socket.emit('notification', 'Sug doorkaaga!'); return; }

    const isLastCardOpened = p.isOpened && p.hand.length === 1;
    if (!p.hasActioned && !isLastCardOpened) { socket.emit('notification', 'Marka hore kaar qaado!'); return; }

    const idx = p.hand.findIndex(c => c.id === card.id);
    if (idx === -1) { if (p.hasActioned && p.hand.length <= 14) { room.turnToken = (room.turnToken || 0) + 1; moveToNextPlayer(myRoomId); } return; }

    const nextIdx = (room.activePlayerIndex + 1) % room.players.length;
    const nextPlayer = room.players[nextIdx];
    if (!p.isOpened && p.hand.length > 1 && nextPlayer && nextPlayer.isOpened) {
      const allTableSets = room.players.flatMap(pl => pl.openedSets || []);
      if (!data.isDegaya && isCardMeelGale(card, allTableSets)) {
        socket.emit('notification', '❌ Waa meel-gale! Ciyaaryahanka ku xiga wuu degay, marka ma tuuri kartid meel-gale.');
        return;
      }
    }

    if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
    room.turnToken = (room.turnToken || 0) + 1;
    const discarded = p.hand.splice(idx, 1)[0];
    room.discardPile.push(discarded);
    io.to(myRoomId).emit('updateDiscardPile', discarded);
    socket.emit('updateHand', { hand: p.hand });

    if (p.hand.length === 0) { endGame(myRoomId, p); return; }
    room.lastProviderId = p.id;

    if (checkBatuuta(room, p)) {
      socket.emit('hoosgaleTriggered');
      io.to(myRoomId).emit('notification', `🚨 ${p.name} wuxuu degay 12 kaar, 2-na wuu hayay — waa BATUUTO! Kaararkii dib ayaa loo celiyay.`);
      updateRoomPlayers(myRoomId); broadcastTableUI(myRoomId);
      moveToNextPlayer(myRoomId); return;
    }

    if (p.pickedFromDiscard && !p.hoosgale && !p.isOpened) {
      p.hoosgale = true;
      room.stockPile = shuffle([...room.stockPile, ...p.hand]);
      p.hand = [];
      socket.emit('hoosgaleTriggered');
      io.to(myRoomId).emit('notification', `⚠️ ${p.name} HOOSGALE!`);
      updateRoomPlayers(myRoomId);
    }
    moveToNextPlayer(myRoomId);
  });

  socket.on('meldSets', (data) => {
    const room = rooms[myRoomId]; if (!room || !room.gameStarted) return;
    const p = room.players[room.activePlayerIndex];
    if (!p || p.id !== socket.id) { socket.emit('notification', 'Sug doorkaaga ka hor inta aadan degin!'); return; }
    if (p.isOpened && !data.isAdditional) { socket.emit('notification', 'Horey ayaad u furatay ciyaarta!'); return; }

    const lagaMaMaarmaan = room.hasFirstOpened ? room.lastOpenPoints : 101;
    if (data.totalScore !== undefined && data.totalScore < lagaMaMaarmaan) {
      socket.emit('notification', `❌ Khalad: Waxaad u baahan tahay ${lagaMaMaarmaan} dhibco si aad u degto.`);
      socket.emit('meldRejected', { hand: p.hand }); return;
    }
    if (!p.isOpened && !data.sets.some(set => set.length >= 4)) {
      socket.emit('notification', '❌ Waa inaad haysataa ugu yaraan hal set oo 4 kaar ah ama ka badan si aad u degto!');
      socket.emit('meldRejected', { hand: p.hand }); return;
    }

    const finalSets = [];
    data.sets.forEach(set => {
      if (set.length === 6) { finalSets.push(set.slice(0, 3), set.slice(3, 6)); }
      else if (set.length === 7) { finalSets.push(set.slice(0, 4), set.slice(4, 7)); }
      else finalSets.push(set);
    });

    const ids = new Set(data.sets.flat().map(c => c.id));
    p.hand = p.hand.filter(c => !ids.has(c.id));
    const wasOpenedBefore = p.isOpened;
    if (!wasOpenedBefore && p.pickedFromDiscard) p.openProviderId = room.lastProviderId || null;
    p.isOpened = true; p.openedSets.push(...finalSets);
    if (!room.openedPlayerIds) room.openedPlayerIds = new Set();
    room.openedPlayerIds.add(p.id);

    if (!wasOpenedBefore) {
      if (!room.hasFirstOpened) {
        room.hasFirstOpened = true; room.firstOpenerId = p.id;
        room.firstOpenerOriginalPoints = getPlayerOpenedPoints(p);
        room.lastOpenPoints = room.firstOpenerOriginalPoints + 1;
        io.to(myRoomId).emit('notification', `📢 ${p.name} ayaa degay! Ugu yaraan waxa laga rabaa ciyaartoyda kale waa: ${room.lastOpenPoints}`);
      } else {
        recalculateRoomBarrier(room);
        io.to(myRoomId).emit('notification', `🎉 ${p.name} ayaa degey!`);
      }
    } else {
      const oldBarrier = room.lastOpenPoints;
      recalculateRoomBarrier(room);
      if (room.lastOpenPoints !== oldBarrier) io.to(myRoomId).emit('notification', `📢 ${p.name} ayaa kordhiyay dhibcihiisii! Ugu yaraan inta la degi karaa waa: ${room.lastOpenPoints}`);
    }

    socket.emit('updateHand', { hand: p.hand });
    broadcastTableUI(myRoomId); updateRoomPlayers(myRoomId);
    if (p.hand.length === 0) { endGame(myRoomId, p); return; }
  });

  socket.on('addToExistingSets', (data) => {
    const room = rooms[myRoomId]; if (!room || !room.gameStarted) return;
    const p = room.players.find(pl => pl.id === socket.id); if (!p || !p.isOpened) return;

    data.cards.forEach(card => {
      room.players.forEach(player => {
        (player.openedSets || []).forEach(set => {
          if (!set || set.length < 3) return;
          const isSeq = set[0].suit === set[1].suit;
          if (isSeq && card.suit === set[0].suit) {
            const sv = set.map(c => getCardValue(c)).sort((a, b) => a - b);
            const mv = getCardValue(card);
            if ((mv === sv[0] - 1 || mv === sv[sv.length - 1] + 1) && !set.some(c => c.id === card.id)) set.push(card);
          } else if (!isSeq && card.value === set[0].value) {
            if (!set.some(c => c.suit === card.suit) && set.length < 4 && !set.some(c => c.id === card.id)) set.push(card);
          }
        });
      });
    });
    const ids = new Set(data.cards.map(c => c.id));
    p.hand = p.hand.filter(c => !ids.has(c.id));
    socket.emit('updateHand', { hand: p.hand });

    const oldBarrier = room.lastOpenPoints;
    recalculateRoomBarrier(room);
    if (room.lastOpenPoints !== oldBarrier) io.to(myRoomId).emit('notification', `📢 Ugu yaraan waa in aad gaartaa: ${room.lastOpenPoints}`);

    if (p.hand.length === 0) { broadcastTableUI(myRoomId); updateRoomPlayers(myRoomId); endGame(myRoomId, p); return; }

    if (checkBatuuta(room, p)) {
      socket.emit('hoosgaleTriggered');
      io.to(myRoomId).emit('notification', `🚨 ${p.name} wuxuu degay 12 kaar, 2-na wuu hayay — waa BATUUTO! Kaararkii dib ayaa loo celiyay.`);
      updateRoomPlayers(myRoomId); broadcastTableUI(myRoomId);
      moveToNextPlayer(myRoomId); return;
    }
    broadcastTableUI(myRoomId); updateRoomPlayers(myRoomId);
  });
  
  socket.on('syncHandAfterMeld', (hand) => {
    const room = rooms[myRoomId]; if (!room || !room.gameStarted) return;
    const p = room.players.find(pl => pl.id === socket.id); if (!p) return;
    p.hand = hand; updateRoomPlayers(myRoomId);
  });

  socket.on('resetMyOpenedCards', () => {
    const room = rooms[myRoomId]; if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id); if (!p || p.isOpened) return;
    p.openedSets = []; p.tempScore = 0;
    socket.emit('startHand', p.hand); broadcastTableUI(myRoomId);
  });

  socket.on('request_sync', () => {
    if (myRoomId && rooms[myRoomId]) {
      updateRoomPlayers(myRoomId);
      const room = rooms[myRoomId];
      if (room.discardPile.length > 0) socket.emit('updateDiscardPile', room.discardPile[room.discardPile.length - 1]);
      broadcastSessionScores(myRoomId);
    }
  });

  socket.on('forceResetGame', () => {
    const room = rooms[myRoomId]; if (!room) return;
    room.gameStarted = false; room.stockPile = []; room.discardPile = [];
    room.turnToken = 0; room.hasFirstOpened = false; room.firstOpenerId = null;
    room.firstOpenerOriginalPoints = null; room.barrierFrozen = false;
    room.openedPlayerIds = new Set(); room.playerStats = {}; room.moveHistory = [];
    if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
    room.players.forEach(resetPlayerState);
    io.to(myRoomId).emit('notification', '⚠️ Ciyaartu dib ayay u bilaabanaysaa...');
    setTimeout(() => startGame(myRoomId), 2000);
  });

  socket.on('startNewSeason', () => {
    const room = rooms[myRoomId];
    const target = room ? room.xiiliTarget : 5;
    resetXiiliSession(target);
    if (room) {
      attachRoomToXiiliSession(room, target);
      broadcastSessionScores(myRoomId);
    }
  });

  socket.on('pauseTimer', () => {
    const room = rooms[myRoomId]; if (!room || !room.gameStarted) return;
    const cur = room.players[room.activePlayerIndex]; if (!cur || cur.id !== socket.id) return;
    if (!room.isPaused) {
      const elapsed = Date.now() - (room.turnStartTime ?? Date.now());
      room.pauseTimeLeft = Math.max(5000, TURN_TIME_LIMIT - elapsed);
    }
    room.isPaused = true; if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
    io.to(myRoomId).emit('timerPaused', { activePlayerId: socket.id, message: `⏸️ ${cur.name} baa dalbaday in la sugo!` });
  });

  socket.on('resumeTimer', () => {
    const room = rooms[myRoomId]; if (!room || !room.gameStarted || !room.isPaused) return;
    const cur = room.players[room.activePlayerIndex]; if (!cur || cur.id !== socket.id) return;
    room.isPaused = false; room.turnStartTime = Date.now() - (TURN_TIME_LIMIT - room.pauseTimeLeft);
    if (room.turnTimeout) clearTimeout(room.turnTimeout);
    const token = room.turnToken;
    room.turnTimeout = setTimeout(() => {
      if (!room.isPaused && room.gameStarted && rooms[myRoomId]?.turnToken === token) moveToNextPlayer(myRoomId);
    }, room.pauseTimeLeft);
    io.to(myRoomId).emit('timerResumed');
  });

  socket.on('getLeaderboard', () => {
    socket.emit('leaderboardUpdate', { leaderboard: getLeaderboardData() });
  });

  socket.on('ping_keep_alive', () => socket.emit('pong_alive'));
  socket.on('animation_finished', () => {});

  socket.on('leaveGame', () => {
    const room = rooms[myRoomId]; if (!room) return;
    if (!room.gameStarted) {
      room.players = room.players.filter(p => p.id !== socket.id);
    } else {
      const pidx = room.players.findIndex(p => p.id === socket.id);
      if (pidx !== -1) {
        const botNames = ['JAAMAC', 'JIMCAALE', 'FAARAX', 'HASSAN'];
        const usedNames = room.players.map(p => p.name);
        const botName = botNames.find(n => !usedNames.includes(n)) ?? `BOT_${Math.random().toString(36).slice(2, 6)}`;
        const leaving = room.players[pidx];
        leaving.isBot = true; leaving.name = botName; leaving.online = true;
        leaving.sessionToken = null; leaving.disconnectedAt = null;
        updateRoomPlayers(myRoomId);
        if (room.activePlayerIndex === pidx) {
          if (room.turnTimeout) clearTimeout(room.turnTimeout);
          scheduleBotTurn(myRoomId, leaving.id);
        }
      }
    }
    socket.leave(myRoomId); myRoomId = '';
  });

  socket.on('disconnect', () => {
    const room = rooms[myRoomId]; if (!room) return;
    const pidx = room.players.findIndex(p => p.id === socket.id); if (pidx === -1) return;
    const player = room.players[pidx];
    if (!room.gameStarted) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.botFillTimer && room.players.length === 0) { clearTimeout(room.botFillTimer); room.botFillTimer = null; }
    } else {
      player.online = false; player.disconnectedAt = Date.now();
      if (room.activePlayerIndex === pidx) {
        if (room.turnTimeout) clearTimeout(room.turnTimeout);
        moveToNextPlayer(myRoomId);
      }
    }
    const online = room.players.filter(p => p.online || p.isBot).length;
    if (online === 0) { if (room.turnTimeout) clearTimeout(room.turnTimeout); delete rooms[myRoomId]; }
    else updateRoomPlayers(myRoomId);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`Turubka 101 ✅ wuxuu ku shaqeynayaa port ${PORT}`);
});
