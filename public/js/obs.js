'use strict';

(function () {
  const video = document.getElementById('remote-video');

  const iceServers = (window.APP_CONFIG && window.APP_CONFIG.stun)
    ? [{ urls: 'stun:stun.l.google.com:19302' }]
    : [];

  let pc = null;
  let signaling = null;

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
