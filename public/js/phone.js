'use strict';

(function () {
  const startBtn = document.getElementById('start-btn');
  const statusEl = document.getElementById('status');
  const preview = document.getElementById('preview');
  const cameraSelect = document.getElementById('camera-select');
  const videoInfoEl = document.getElementById('video-info');

  const iceServers = (window.APP_CONFIG && window.APP_CONFIG.stun)
    ? [{ urls: 'stun:stun.l.google.com:19302' }]
    : [];

  // Capture/encode targets. The phone sits on the same LAN as the PC, so we can
  // afford a far higher bitrate than WebRTC's conservative default, which is
  // what made the OBS source look soft and blocky.
  const TARGET_WIDTH = 1920;
  const TARGET_HEIGHT = 1080;
  const TARGET_ASPECT = TARGET_WIDTH / TARGET_HEIGHT;
  const TARGET_FPS = 30;
  const MAX_BITRATE = 12000000; // 12 Mbps

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
      width: { ideal: TARGET_WIDTH },
      height: { ideal: TARGET_HEIGHT },
      // Ask for 16:9 explicitly - a phone held upright otherwise hands back a
      // portrait (or 4:3) frame, which OBS then has to crop or pillarbox.
      aspectRatio: { ideal: TARGET_ASPECT },
      frameRate: { ideal: TARGET_FPS }
      // No resizeMode: 'none' - it stops Chrome cropping to 16:9, so a camera
      // whose native modes are 4:3 would stay 4:3.
    };
  }

  // What the camera actually delivered, which can differ a lot from what we
  // asked for: iOS Safari ignores aspectRatio and hands back a portrait frame
  // whenever the phone is held upright.
  function updateVideoInfo() {
    const w = preview.videoWidth;
    const h = preview.videoHeight;
    if (!w || !h) {
      videoInfoEl.textContent = '';
      return;
    }
    const settings = localStream && localStream.getVideoTracks()[0]
      ? localStream.getVideoTracks()[0].getSettings()
      : {};
    const fps = settings.frameRate ? ` @ ${Math.round(settings.frameRate)}fps` : '';
    const portrait = h > w;
    videoInfoEl.textContent = `Sending ${w}×${h}${fps}` +
      (portrait ? ' - rotate the phone to landscape for a full 16:9 picture' : '');
    videoInfoEl.classList.toggle('warn', portrait);
  }

  // libwebrtc (used by both Safari and Chrome) starts every call at ~300 kbps
  // and ramps up slowly; maxBitrate alone only raises the ceiling. These fmtp
  // hints on the answer make the phone's encoder start, and stay, high.
  function boostAnswerBitrate(sdp) {
    const kbps = Math.round(MAX_BITRATE / 1000);
    const lines = sdp.split('\r\n');
    const out = [];
    let inVideo = false;
    const videoPayloads = new Set();

    lines.forEach((line) => {
      if (line.startsWith('m=')) {
        inVideo = line.startsWith('m=video');
        if (inVideo) line.split(' ').slice(3).forEach((pt) => videoPayloads.add(pt));
      }
      if (inVideo && line.startsWith('b=')) return; // replaced below
      out.push(line);
      if (inVideo && line.startsWith('c=')) out.push(`b=AS:${kbps}`);
    });

    const hints = `x-google-start-bitrate=${Math.round(kbps * 0.6)};` +
      `x-google-min-bitrate=${Math.round(kbps * 0.25)};` +
      `x-google-max-bitrate=${kbps}`;

    const withFmtp = new Set();
    out.forEach((line) => {
      const m = line.match(/^a=fmtp:(\d+) /);
      if (m) withFmtp.add(m[1]);
    });

    const result = [];
    out.forEach((line) => {
      const fmtp = line.match(/^a=fmtp:(\d+) (.*)$/);
      if (fmtp && videoPayloads.has(fmtp[1]) && !fmtp[2].includes('apt=')) {
        result.push(`a=fmtp:${fmtp[1]} ${fmtp[2]};${hints}`);
        return;
      }
      result.push(line);
      // Codecs like VP8 have no fmtp line at all - give them one.
      const rtpmap = line.match(/^a=rtpmap:(\d+) ([^/]+)\//);
      if (rtpmap && videoPayloads.has(rtpmap[1]) && !withFmtp.has(rtpmap[1]) &&
          !/^(rtx|red|ulpfec|flexfec-03)$/i.test(rtpmap[2])) {
        result.push(`a=fmtp:${rtpmap[1]} ${hints}`);
      }
    });
    return result.join('\r\n');
  }

  // 'detail' tells the encoder to protect resolution over framerate when it has
  // to make a trade-off, which is the right call for a webcam feed.
  function tuneTrack(track) {
    if (track && track.kind === 'video') track.contentHint = 'detail';
  }

  // getUserMedia constraints only govern capture; the encoder has its own, much
  // lower defaults, so raise them on the sender too.
  async function tuneVideoSender(sender) {
    if (!sender || !sender.track || sender.track.kind !== 'video') return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings.forEach((encoding) => {
        encoding.active = true;
        encoding.maxBitrate = MAX_BITRATE;
        encoding.maxFramerate = TARGET_FPS;
        encoding.scaleResolutionDownBy = 1;
      });
      await sender.setParameters(params);
    } catch (err) {
      console.warn('Could not apply encoder bitrate', err);
    }
    // Kept separate: some browsers reject this field, and it mustn't take the
    // bitrate setting down with it.
    try {
      const params = sender.getParameters();
      params.degradationPreference = 'maintain-resolution';
      await sender.setParameters(params);
    } catch (err) {
      console.warn('degradationPreference not supported', err);
    }
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

    localStream.getTracks().forEach((track) => {
      tuneTrack(track);
      pc.addTrack(track, localStream);
    });

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

    // Only safe once the sender has been through setLocalDescription - before
    // that, some browsers reject setParameters outright.
    await Promise.all(pc.getSenders().map((sender) => tuneVideoSender(sender)));

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
        if (pc) {
          await pc.setRemoteDescription({
            type: message.sdp.type,
            sdp: boostAnswerBitrate(message.sdp.sdp)
          });
        }
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
    tuneTrack(newTrack);

    if (pc) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
        // replaceTrack can reset the encoding parameters, so re-apply them.
        await tuneVideoSender(sender);
      }
    }

    localStream = newStream;
    currentFacingMode = targetFacingMode;
    preview.srcObject = localStream;
    cameraSelect.disabled = false;
  }

  cameraSelect.addEventListener('change', () => {
    if (localStream) switchCamera();
  });

  // Fires on first frame and whenever the frame size changes (e.g. rotation).
  preview.addEventListener('resize', updateVideoInfo);
  preview.addEventListener('loadedmetadata', updateVideoInfo);

  startBtn.addEventListener('click', start);
  setStatus('Tap Start to share your camera');
})();
