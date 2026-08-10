'use strict';

// Standalone smoke test for the signaling relay logic (no real browser/WebRTC
// involved). Spins up a plain HTTP server with signaling attached, connects
// two fake `ws` clients playing "phone" and "obs", and asserts that
// offer/ice-candidate messages sent by one are relayed to the other, and
// that peer-connected/peer-disconnected events fire correctly.
//
// Run with: npm test

const http = require('http');
const WebSocket = require('ws');

const { SessionManager } = require('../src/session');
const { attachSignaling } = require('../src/wsHandler');

const PORT = 8999;
let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`PASS: ${message}`);
  }
}

function waitForMessage(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (predicate(message)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(message);
      }
    }
    ws.on('message', onMessage);
  });
}

function waitForOpen(ws) {
  return new Promise((resolve) => ws.once('open', resolve));
}

async function main() {
  const server = http.createServer();
  const session = new SessionManager();
  attachSignaling(server, session, '/ws');
  await new Promise((resolve) => server.listen(PORT, resolve));

  const phoneWs = new WebSocket(`ws://localhost:${PORT}/ws`);
  await waitForOpen(phoneWs);
  phoneWs.send(JSON.stringify({ type: 'register', role: 'phone' }));
  await waitForMessage(phoneWs, (m) => m.type === 'registered');
  console.log('PASS: phone registered');

  const obsWs = new WebSocket(`ws://localhost:${PORT}/ws`);
  await waitForOpen(obsWs);

  const phonePeerConnected = waitForMessage(phoneWs, (m) => m.type === 'peer-connected' && m.role === 'obs');
  obsWs.send(JSON.stringify({ type: 'register', role: 'obs' }));
  await waitForMessage(obsWs, (m) => m.type === 'registered');
  await phonePeerConnected;
  assert(true, 'phone received peer-connected(obs) after obs registered');

  const fakeOffer = { type: 'offer', sdp: { type: 'offer', sdp: 'fake-sdp' } };
  const obsReceivedOffer = waitForMessage(obsWs, (m) => m.type === 'offer');
  phoneWs.send(JSON.stringify(fakeOffer));
  const receivedOffer = await obsReceivedOffer;
  assert(receivedOffer.sdp.sdp === 'fake-sdp', 'offer relayed from phone to obs unchanged');

  const fakeCandidate = { type: 'ice-candidate', candidate: { candidate: 'fake-candidate' } };
  const phoneReceivedCandidate = waitForMessage(phoneWs, (m) => m.type === 'ice-candidate');
  obsWs.send(JSON.stringify(fakeCandidate));
  const receivedCandidate = await phoneReceivedCandidate;
  assert(receivedCandidate.candidate.candidate === 'fake-candidate', 'ice-candidate relayed from obs to phone unchanged');

  const obsReceivedDisconnect = waitForMessage(obsWs, (m) => m.type === 'peer-disconnected' && m.role === 'phone');
  phoneWs.close();
  await obsReceivedDisconnect;
  assert(true, 'obs received peer-disconnected(phone) after phone socket closed');

  obsWs.close();
  server.close();

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll signaling relay checks passed.');
}

main().catch((err) => {
  console.error('Signaling check crashed:', err);
  process.exit(1);
});
