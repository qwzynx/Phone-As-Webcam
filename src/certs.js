'use strict';

const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const META_PATH = path.join(CERT_DIR, 'meta.json');

const TEN_YEARS_DAYS = 3650;

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function filesExist() {
  return fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH);
}

function generate(lanIp) {
  const attrs = [{ name: 'commonName', value: lanIp }];
  const pems = selfsigned.generate(attrs, {
    days: TEN_YEARS_DAYS,
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: false },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 7, ip: lanIp }, // IP
          { type: 7, ip: '127.0.0.1' },
          { type: 2, value: 'localhost' } // DNS
        ]
      }
    ]
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(CERT_PATH, pems.cert);
  fs.writeFileSync(META_PATH, JSON.stringify({ ip: lanIp, generatedAt: Date.now() }, null, 2));

  return { key: pems.private, cert: pems.cert };
}

async function ensureCertificate(lanIp) {
  const meta = readMeta();
  if (meta && meta.ip === lanIp && filesExist()) {
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
  }
  console.log(`[certs] Generating self-signed certificate for ${lanIp} ...`);
  return generate(lanIp);
}

module.exports = { ensureCertificate };
