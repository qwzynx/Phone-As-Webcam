'use strict';

const { EventEmitter } = require('events');

const ROLES = ['phone', 'obs'];
const OTHER_ROLE = { phone: 'obs', obs: 'phone' };

function safeSend(socket, message) {
  if (socket && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Single-room, single-slot-per-role signaling relay. Never touches media,
 * only relays SDP offer/answer and ICE candidates between one "phone" socket
 * and one "obs" socket. Last registration for a role wins (handles reloads).
 */
class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sockets = { phone: null, obs: null };
  }

  register(socket, role) {
    if (!ROLES.includes(role)) {
      safeSend(socket, { type: 'error', message: `Unknown role "${role}"` });
      socket.close();
      return;
    }

    const existing = this.sockets[role];
    if (existing && existing !== socket) {
      existing._evicted = true;
      safeSend(existing, { type: 'evicted' });
      existing.close();
    }

    socket._role = role;
    this.sockets[role] = socket;
    safeSend(socket, { type: 'registered', role });

    const otherRole = OTHER_ROLE[role];
    const otherSocket = this.sockets[otherRole];
    if (otherSocket) {
      safeSend(otherSocket, { type: 'peer-connected', role });
      safeSend(socket, { type: 'peer-connected', role: otherRole });
    }

    this.emit('state-change', this.describeState());

    socket.on('close', () => this._handleDisconnect(socket, role));
  }

  relay(fromRole, message) {
    const otherRole = OTHER_ROLE[fromRole];
    const otherSocket = this.sockets[otherRole];
    if (!otherSocket) return;
    safeSend(otherSocket, message);
  }

  _handleDisconnect(socket, role) {
    if (this.sockets[role] !== socket) return; // was already replaced/evicted
    if (socket._evicted) return; // eviction already notified the peer via 'evicted', not 'peer-disconnected'

    this.sockets[role] = null;
    const otherRole = OTHER_ROLE[role];
    const otherSocket = this.sockets[otherRole];
    safeSend(otherSocket, { type: 'peer-disconnected', role });

    this.emit('state-change', this.describeState());
  }

  describeState() {
    if (this.sockets.phone && this.sockets.obs) return 'both-connected';
    if (this.sockets.obs && !this.sockets.phone) return 'waiting-for-phone';
    if (this.sockets.phone && !this.sockets.obs) return 'waiting-for-obs';
    return 'idle';
  }
}

module.exports = { SessionManager };
