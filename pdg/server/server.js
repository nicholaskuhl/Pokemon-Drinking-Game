// Multiplayer server for Pokemon Drinking Game.
//
// Responsibilities:
//   * Serve the static client files (pdg/index.html, game.js, styles.css, gameBoard.webp, ...)
//     so a single URL hosts both the web page and the realtime socket endpoint.
//   * Hold authoritative game state per room, keyed by short room codes.
//   * Accept player actions over Socket.IO, validate that it is that player's turn,
//     apply the action, and broadcast the new state to everyone in the room.
//
// This file is intentionally minimal right now: rooms are tracked in memory and
// the `action` handler is a placeholder. Game logic will move in from
// pdg/game.js in a later phase via pdg/shared/game-logic.js.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const CLIENT_DIR = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;

const app = express();
// Disable caching during development so client edits (game.js, net.js, index.html,
// styles.css) are picked up on plain reload instead of requiring Ctrl+Shift+R.
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(CLIENT_DIR));

// Tiny health endpoint so we (and hosts like Render) can confirm the server is up.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' } // local dev convenience; tighten before deploy if needed.
});

/**
 * rooms: Map<string, Room>
 * Room shape:
 *   {
 *     code: string,
 *     hostSocketId: string,
 *     players: Array<{ id: string, socketId: string|null, name: string, starter: string }>,
 *     state: object|null,   // canonical game state once the host starts the game
 *     createdAt: number
 *   }
 */
const rooms = new Map();

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not generate a unique room code');
}

function publicRoomSnapshot(room) {
  return {
    code: room.code,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      starter: p.starter,
      online: Boolean(p.socketId)
    })),
    state: room.state
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room-update', publicRoomSnapshot(room));
}

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on('create-room', ({ name, starter } = {}, ack) => {
    const code = generateRoomCode();
    const playerId = socket.id; // simple for now; later we can persist across reconnects
    const room = {
      code,
      hostSocketId: socket.id,
      players: [
        {
          id: playerId,
          socketId: socket.id,
          name: (name || 'Player 1').toString().slice(0, 20),
          starter: starter || 'Charmander'
        }
      ],
      state: null,
      createdAt: Date.now()
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    console.log(`[room] created ${code} by ${socket.id}`);
    if (typeof ack === 'function') ack({ ok: true, code, playerId });
    broadcastRoom(room);
  });

  socket.on('join-room', ({ code, name, starter } = {}, ack) => {
    const normalized = (code || '').toString().toUpperCase().trim();
    const room = rooms.get(normalized);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room not found' });
      return;
    }
    if (room.players.length >= 6) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room is full (max 6 players)' });
      return;
    }
    const playerId = socket.id;
    room.players.push({
      id: playerId,
      socketId: socket.id,
      name: (name || `Player ${room.players.length + 1}`).toString().slice(0, 20),
      starter: starter || 'Charmander'
    });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    console.log(`[room] ${socket.id} joined ${room.code}`);
    if (typeof ack === 'function') ack({ ok: true, code: room.code, playerId });
    broadcastRoom(room);
  });

  // Placeholder: in a later phase this will validate turn, run game logic on
  // the authoritative state (including server-side dice rolls), and broadcast.
  socket.on('action', (payload, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not in a room' });
      return;
    }
    console.log(`[action] ${socket.id} in ${room.code}:`, payload);
    if (typeof ack === 'function') ack({ ok: true, note: 'action handler not yet implemented' });
  });

  // Host announces the game has started. Optionally supplies the initial
  // serialized state (built from the lobby's players + starters).
  socket.on('start-game', ({ state } = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not in a room' });
      return;
    }
    if (socket.id !== room.hostSocketId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Only the host can start the game' });
      return;
    }
    room.state = state || null;
    console.log(`[room] ${room.code} game started by host`);
    if (typeof ack === 'function') ack({ ok: true });
    broadcastRoom(room);
  });

  // Server-authoritative dice. The current player asks for N rolls at the
  // start of their action; the server replies with the numbers and logs them
  // so we can audit later if needed.
  socket.on('roll-dice', ({ count } = {}, ack) => {
    const n = Math.max(1, Math.min(32, Number(count) || 1));
    const rolls = [];
    for (let i = 0; i < n; i += 1) rolls.push(1 + Math.floor(Math.random() * 6));
    console.log(`[dice] ${socket.id} rolled ${n}: ${rolls.join(',')}`);
    if (typeof ack === 'function') ack({ ok: true, rolls });
  });

  // Current player pushes a fresh state snapshot after each local action.
  // Server validates the sender owns the current turn, stores it, and
  // broadcasts so everyone else syncs.
  socket.on('sync-state', ({ state } = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not in a room' });
      return;
    }
    if (!state || !Array.isArray(state.players)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Invalid state' });
      return;
    }
    // Validate it really is this socket's turn (best-effort: match by
    // playerId stored at join time against state.players[currentPlayerIndex]).
    const currentSeatId = room.players[state.currentPlayerIndex]?.id;
    if (currentSeatId && currentSeatId !== socket.data.playerId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not your turn' });
      return;
    }
    room.state = state;
    if (typeof ack === 'function') ack({ ok: true });
    // Broadcast to everyone *except* the sender; they already have it locally.
    socket.to(room.code).emit('state-snapshot', state);
  });

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.id}`);
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (player) {
      player.socketId = null; // keep their slot so they can rejoin
    }
    // If everyone is offline, drop the room after a short grace period.
    const anyoneOnline = room.players.some((p) => p.socketId);
    if (!anyoneOnline) {
      setTimeout(() => {
        const current = rooms.get(code);
        if (current && !current.players.some((p) => p.socketId)) {
          rooms.delete(code);
          console.log(`[room] ${code} closed (empty)`);
        }
      }, 60_000);
    }
    broadcastRoom(room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Pokemon Drinking Game server listening on http://localhost:${PORT}`);
});
