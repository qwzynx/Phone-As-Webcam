'use strict';

const os = require('os');

const IGNORE_INTERFACE = /vethernet|virtualbox|vmware|tailscale|loopback|wsl|hyper-v|docker/i;
const PREFERRED_INTERFACE = /wi-?fi|wlan|ethernet/i;

function listCandidates() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (IGNORE_INTERFACE.test(name)) continue;
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push({
          name,
          address: addr.address,
          score: PREFERRED_INTERFACE.test(name) ? 2 : 1
        });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function getLanIp({ override } = {}) {
  if (override) return override;

  const candidates = listCandidates();
  if (!candidates.length) {
    throw new Error(
      'No LAN IP address found. Pass one explicitly, e.g. "node server.js --ip 192.168.1.23".'
    );
  }
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    console.warn('[network] Multiple network interfaces found, picking the first one:');
    for (const c of candidates) console.warn(`  - ${c.name}: ${c.address}`);
    console.warn('  If this is wrong, rerun with: node server.js --ip <address>\n');
  }
  return candidates[0].address;
}

module.exports = { getLanIp, listCandidates };
