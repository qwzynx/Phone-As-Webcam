'use strict';

const { WebSocketServer } = require('ws');

const RELAY_TYPES = new Set(['offer', 'answer', 'ice-candidate']);

/**
 * Wires a WebSocketServer (bound to the given HTTP/HTTPS server) into the
 * shared SessionManager. Multiple calls with the same `session` instance
 * (one per transport) relay messages across each other purely in memory.
 */
function attachSignaling(server, session, path = '/ws') {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return; // ignore malformed frames
      }

      if (message.type === 'register') {
        session.register(socket, message.role);
        return;
      }

      if (RELAY_TYPES.has(message.type)) {
        if (!socket._role) return; // must register before relaying
        session.relay(socket._role, message);
      }
    });
  });

  return wss;
}

module.exports = { attachSignaling };
