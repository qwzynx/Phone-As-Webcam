'use strict';

// Thin WebSocket wrapper shared by phone.js and obs.js: JSON in/out plus
// auto-reconnect with exponential backoff. No build step, loaded via <script>.
function createSignalingClient(url, { onMessage, onOpen, onClose } = {}) {
  let socket = null;
  let closedByUser = false;
  let backoffMs = 500;
  const MAX_BACKOFF_MS = 8000;

  function connect() {
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      backoffMs = 500;
      if (onOpen) onOpen();
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (onMessage) onMessage(message);
    });

    socket.addEventListener('close', () => {
      if (onClose) onClose();
      if (closedByUser) return;
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    });

    socket.addEventListener('error', () => socket.close());
  }

  connect();

  return {
    send(message) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    close() {
      closedByUser = true;
      if (socket) socket.close();
    }
  };
}
