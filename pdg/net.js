// Thin networking layer for the Pokemon Drinking Game.
//
// Owns the Socket.IO connection and exposes a small API the rest of the
// client uses. Stays passive when offline so the existing single-player flow
// works unchanged.
//
// Public surface (window.net):
//   net.online            -> boolean, true once joined to a room
//   net.roomCode          -> string | null
//   net.playerId          -> string | null (our seat id in the room)
//   net.players           -> [{ id, name, starter, online }]
//   net.myIndex()         -> our seat index, or -1
//   net.createRoom({name, starter}) -> Promise<{code}>
//   net.joinRoom({code, name, starter}) -> Promise<{code}>
//   net.startGame(state)  -> Promise<void>   (host only)
//   net.fetchDice(n)      -> Promise<number[]>  (server-rolled)
//   net.pushState(state)  -> Promise<void>
//   net.onRoom(cb)        -> subscribe to lobby/room updates
//   net.onSnapshot(cb)    -> subscribe to state snapshots from the current player

(function () {
  const listenersRoom = [];
  const listenersSnap = [];

  const api = {
    online: false,
    roomCode: null,
    playerId: null,
    players: [],
    socket: null,

    myIndex() {
      if (!api.playerId) return -1;
      return api.players.findIndex((p) => p.id === api.playerId);
    },

    onRoom(cb) { listenersRoom.push(cb); },
    onSnapshot(cb) { listenersSnap.push(cb); },

    connect() {
      if (api.socket) return api.socket;
      // io is provided by /socket.io/socket.io.js, served by the server
      // eslint-disable-next-line no-undef
      api.socket = io();
      api.socket.on('room-update', (room) => {
        api.roomCode = room.code;
        api.players = room.players || [];
        api.online = true;
        listenersRoom.forEach((cb) => {
          try { cb(room); } catch (e) { console.error(e); }
        });
      });
      api.socket.on('state-snapshot', (state) => {
        listenersSnap.forEach((cb) => {
          try { cb(state); } catch (e) { console.error(e); }
        });
      });
      return api.socket;
    },

    createRoom({ name, starter }) {
      api.connect();
      return new Promise((resolve, reject) => {
        api.socket.emit('create-room', { name, starter }, (res) => {
          if (!res || !res.ok) return reject(new Error(res?.error || 'create failed'));
          api.playerId = res.playerId;
          api.roomCode = res.code;
          resolve(res);
        });
      });
    },

    joinRoom({ code, name, starter }) {
      api.connect();
      return new Promise((resolve, reject) => {
        api.socket.emit('join-room', { code, name, starter }, (res) => {
          if (!res || !res.ok) return reject(new Error(res?.error || 'join failed'));
          api.playerId = res.playerId;
          api.roomCode = res.code;
          resolve(res);
        });
      });
    },

    startGame(state) {
      return new Promise((resolve, reject) => {
        if (!api.socket) return reject(new Error('not connected'));
        api.socket.emit('start-game', { state }, (res) => {
          if (!res || !res.ok) return reject(new Error(res?.error || 'start failed'));
          resolve();
        });
      });
    },

    fetchDice(count = 1) {
      return new Promise((resolve, reject) => {
        if (!api.socket) return reject(new Error('not connected'));
        api.socket.emit('roll-dice', { count }, (res) => {
          if (!res || !res.ok) return reject(new Error(res?.error || 'roll failed'));
          resolve(res.rolls);
        });
      });
    },

    pushState(state) {
      return new Promise((resolve, reject) => {
        if (!api.socket) return reject(new Error('not connected'));
        api.socket.emit('sync-state', { state }, (res) => {
          if (!res || !res.ok) return reject(new Error(res?.error || 'sync failed'));
          resolve();
        });
      });
    }
  };

  window.net = api;
})();
