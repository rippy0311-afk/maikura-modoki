'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3001);
const rooms = new Map();

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function broadcast(roomId, payload, exceptSocket = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const socket of room.values()) {
    if (socket !== exceptSocket) send(socket, payload);
  }
}

function leave(socket) {
  const { roomId, peerId } = socket;
  if (!roomId || !peerId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(peerId);
  if (socket.kind !== 'chat') broadcast(roomId, { type: 'peer-left', peerId });
  if (room.size === 0) rooms.delete(roomId);
}

const server = http.createServer((request, response) => {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(JSON.stringify({ ok: true, service: 'voice-server', rooms: rooms.size }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === 'join') {
      leave(socket);
      const roomId = String(message.roomId || '').slice(0, 80);
      if (!roomId) return;
      const peerId = Math.random().toString(36).slice(2, 10);
      socket.roomId = roomId;
      socket.peerId = peerId;
      socket.name = String(message.name || 'Player').slice(0, 32);
      socket.kind = message.kind === 'chat' ? 'chat' : 'voice';

      if (!rooms.has(roomId)) rooms.set(roomId, new Map());
      const room = rooms.get(roomId);
      const peers = [...room.entries()]
        .filter(([, peerSocket]) => peerSocket.kind !== 'chat')
        .map(([id, peerSocket]) => ({
          peerId: id,
          name: peerSocket.name || 'Player',
        }));
      room.set(peerId, socket);

      send(socket, { type: 'welcome', peerId, peers });
      if (socket.kind !== 'chat') {
        broadcast(roomId, { type: 'peer-joined', peerId, name: socket.name }, socket);
      }
      return;
    }

    if (!socket.roomId || !socket.peerId) return;
    if (message.type === 'chat') {
      const text = String(message.text || '').trim().slice(0, 400);
      if (!text) return;
      broadcast(socket.roomId, {
        type: 'chat',
        name: socket.name || 'Player',
        text,
        time: Date.now(),
      }, socket);
      return;
    }
    if (!['offer', 'answer', 'ice'].includes(message.type)) return;
    const target = rooms.get(socket.roomId)?.get(message.to);
    if (!target) return;
    send(target, {
      type: message.type,
      from: socket.peerId,
      description: message.description,
      candidate: message.candidate,
    });
  });

  socket.on('close', () => leave(socket));
  socket.on('error', () => leave(socket));
});

server.listen(PORT, () => {
  console.log(`Voice signaling server listening on ${PORT}`);
});
