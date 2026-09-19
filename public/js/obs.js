'use strict';

(function () {
  const video = document.getElementById('remote-video');

  const iceServers = (window.APP_CONFIG && window.APP_CONFIG.stun)
    ? [{ urls: 'stun:stun.l.google.com:19302' }]
    : [];

  let pc = null;
  let signaling = null;

  // Open /obs?stats in a normal browser to see what is actually arriving -
  // resolution, framerate, bitrate and codec - instead of guessing from OBS.
  const statsEl = new URLSearchParams(location.search).has('stats')
    ? document.body.appendChild(document.createElement('pre'))
    : null;
  if (statsEl) statsEl.id = 'stats';
  let lastBytes = 0;
  let lastTime = 0;

  async function updateStats() {
    if (!statsEl) return;
    if (!pc) {
      statsEl.textContent = 'Waiting for phone...';
      return;
    }
    const report = await pc.getStats();
    let inbound = null;
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s;
    });
    if (!inbound) return;
    const codec = inbound.codecId && report.get(inbound.codecId);
    const now = inbound.timestamp;
    const kbps = lastTime ? ((inbound.bytesReceived - lastBytes) * 8) / (now - lastTime) : 0;
    lastBytes = inbound.bytesReceived;
    lastTime = now;
    statsEl.textContent =
      `${inbound.frameWidth || '?'}×${inbound.frameHeight || '?'} ` +
      `@ ${Math.round(inbound.framesPerSecond || 0)}fps\n` +
      `${(kbps / 1000).toFixed(1)} Mbps  ${codec ? codec.mimeType : ''}\n` +
      `page ${window.innerWidth}×${window.innerHeight}`;
  }
  if (statsEl) setInterval(updateStats, 1000);

  function closePeerConnection() {
    if (pc) {
      pc.close();
      pc = null;
    }
    video.srcObject = null;
  }

  async function handleOffer(offer) {
    closePeerConnection(); // recreate fresh per offer, so phone reconnects are handled cleanly
    pc = new RTCPeerConnection({ iceServers });

    pc.ontrack = (event) => {
      video.srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.send({ type: 'ice-candidate', candidate: event.candidate });
      }
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send({ type: 'answer', sdp: answer });
  }

  async function handleSignalingMessage(message) {
    switch (message.type) {
      case 'offer':
        await handleOffer(message.sdp);
        break;
      case 'ice-candidate':
        if (pc) {
          try {
            await pc.addIceCandidate(message.candidate);
          } catch (err) {
            console.warn('Failed to add ICE candidate', err);
          }
        }
        break;
      case 'peer-disconnected':
        if (message.role === 'phone') closePeerConnection();
        break;
      case 'evicted':
        if (signaling) signaling.close();
        break;
      default:
        break;
    }
  }

  function connectSignaling() {
    const wsUrl = `ws://${location.host}/ws`;
    signaling = createSignalingClient(wsUrl, {
      onOpen: () => signaling.send({ type: 'register', role: 'obs' }),
      onMessage: handleSignalingMessage
    });
  }

  connectSignaling();
})();
