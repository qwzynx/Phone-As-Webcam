'use strict';

const qrcode = require('qrcode');

function printBanner({ lanIp, httpPort, httpsPort }) {
  console.log('');
  console.log('=================================================================');
  console.log('  PhoneCamera - iPhone as a Windows webcam (no app required)');
  console.log('=================================================================');
  console.log(`  Phone URL (scan the QR code below): https://${lanIp}:${httpsPort}/phone`);
  console.log(`  OBS Browser Source URL:              http://localhost:${httpPort}/obs`);
  console.log('=================================================================');
  console.log('');
}

async function printQr(url) {
  const qrText = await qrcode.toString(url, { type: 'terminal', small: true });
  console.log(qrText);
  console.log(`  ${url}`);
  console.log('');
}

module.exports = { printBanner, printQr };
