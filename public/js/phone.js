'use strict';

(function () {
  const startBtn = document.getElementById('start-btn');
  const statusEl = document.getElementById('status');
  const preview = document.getElementById('preview');
  const cameraSelect = document.getElementById('camera-select');

  const iceServers = (window.APP_CONFIG && window.APP_CONFIG.stun)
    ? [{ urls: 'stun:stun.l.google.com:19302' }]
    : [];

  let localStream = null;
  let pc = null;
  let signaling = null;
  let currentFacingMode = cameraSelect.value;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function getVideoConstraints(facingMode, exact) {
    return {
      facingMode: exact ? { exact: facingMode } : facingMode,
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getUserMediaForFacing(facingMode) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(facingMode, true),
        audio: false
      });
    } catch (err) {
      // Some devices/browsers don't have a second camera matching the exact
      // facingMode, or don't support "exact" well - fall back to a hint.
      if (err.name !== 'OverconstrainedError') throw err;
      return navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(facingMode, false),
        audio: false
      });
    }
  }

  // After stopping the previous camera's track, the OS/browser can take a
  // moment to actually release the hardware (this is common on both Android
  // Chrome and iOS Safari). Requesting the new camera too soon throws
  // NotReadableError ("could not start video source") even though nothing
  // is really wrong - so retry a few times with a short backoff.
  async function acquireCamera(facingMode) {
    const delays = [0, 300, 600, 1000];
    let lastErr;
    for (const delay of delays) {
      if (delay) await sleep(delay);
      try {
        return await getUserMediaForFacing(facingMode);
      } catch (err) {
        lastErr = err;
        if (err.name !== 'NotReadableError' && err.name !== 'TrackStartError') {
          throw err;
        }
      }
    }
    throw lastErr;
  }

  function stopStream(stream) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
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
      localStream = await acquireCamera(cameraSelect.value);
      currentFacingMode = cameraSelect.value;
    } catch (err) {
      setStatus(`Camera access failed: ${err.name || 'Error'}${err.message ? ' - ' + err.message : ''}`);
      startBtn.disabled = false;
      return;
    }

    preview.srcObject = localStream;
    setStatus('Camera ready. Waiting for OBS...');
    connectSignaling();
  }

  async function switchCamera() {
    if (!localStream) return;

    const targetFacingMode = cameraSelect.value;
    cameraSelect.disabled = true;
    // Release the current camera before requesting the other one - on most
    // mobile browsers the hardware is exclusive, so if the old track is
    // still open, getUserMedia silently hands back the same physical camera
    // instead of switching.
    stopStream(localStream);

    let newStream;
    try {
      newStream = await acquireCamera(targetFacingMode);
    } catch (err) {
      setStatus(`Camera switch failed: ${err.name || 'Error'}${err.message ? ' - ' + err.message : ''}`);
      cameraSelect.value = currentFacingMode;
      // Best-effort recovery: restore the camera we just released.
      try {
        localStream = await acquireCamera(currentFacingMode);
        preview.srcObject = localStream;
      } catch (_) {
        localStream = null;
      }
      cameraSelect.disabled = false;
      return;
    }

    const newTrack = newStream.getVideoTracks()[0];

    if (pc) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
    }

    localStream = newStream;
    currentFacingMode = targetFacingMode;
    preview.srcObject = localStream;
    cameraSelect.disabled = false;
  }

  cameraSelect.addEventListener('change', () => {
    if (localStream) switchCamera();
  });

  startBtn.addEventListener('click', start);
  setStatus('Tap Start to share your camera');
})();
