'use strict';

const STATE_LABELS = {
  idle: 'Waiting for the phone and OBS to connect...',
  'waiting-for-phone': 'OBS is connected. Waiting for the phone to scan the QR code...',
  'waiting-for-obs': 'Phone is connected. Waiting for OBS Browser Source to load...',
  'both-connected': 'Phone and OBS are both connected. Negotiating the video stream...'
};

function status(state) {
  const label = STATE_LABELS[state] || state;
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${label}`);
}

module.exports = { status };
