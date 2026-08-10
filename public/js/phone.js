'use strict';

(function () {
  const startBtn = document.getElementById('start-btn');
  const statusEl = document.getElementById('status');
  const preview = document.getElementById('preview');

  const iceServers = (window.APP_CONFIG && window.APP_CONFIG.stun)
    ? [{ urls: 'stun:stun.l.google.com:19302' }]
    : [];

  let localStream = null;
  let pc = null;
  let signaling = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function closePeerConnection() {
    if (pc) {
      pc.close();
      pc = null;
    }
  }

  async function createOfferToObs() {
    closePeerConnection();
    pc = new RTCPeerConnection({ iceServers });

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.send({ type: 'ice-candidate', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus('Streaming to OBS ✓');
      else if (pc.connectionState === 'connecting') setStatus('Connecting to OBS...');
      else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStatus('Connection lost. Waiting for OBS...');
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signaling.send({ type: 'offer', sdp: offer });
  }

  function connectSignaling() {
    const wsUrl = `wss://${location.host}/ws`;
    signaling = createSignalingClient(wsUrl, {
      onOpen: () => signaling.send({ type: 'register', role: 'phone' }),
      onMessage: handleSignalingMessage,
      onClose: () => setStatus('Disconnected from server, reconnecting...')
    });
  }

  async function handleSignalingMessage(message) {
    switch (message.type) {
      case 'peer-connected':
        if (message.role === 'obs') {
          setStatus('OBS found. Connecting...');
          await createOfferToObs();
        }
        break;
      case 'peer-disconnected':
        if (message.role === 'obs') {
          closePeerConnection();
          setStatus('Camera ready. Waiting for OBS...');
        }
        break;
      case 'answer':
        if (pc) await pc.setRemoteDescription(message.sdp);
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
      case 'evicted':
        setStatus('Another tab took over this session.');
        if (signaling) signaling.close();
        break;
      default:
        break;
    }
  }

  async function start() {
    startBtn.disabled = true;
    setStatus('Requesting camera access...');
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
    } catch (err) {
      setStatus(`Camera access failed: ${err.message}`);
      startBtn.disabled = false;
      return;
    }

    preview.srcObject = localStream;
    setStatus('Camera ready. Waiting for OBS...');
    connectSignaling();
  }

  startBtn.addEventListener('click', start);
  setStatus('Tap Start to share your camera');
})();
