'use strict';

const http = require('http');
const https = require('https');

const { getLanIp } = require('./src/network');
const { ensureCertificate } = require('./src/certs');
const { SessionManager } = require('./src/session');
const { attachSignaling } = require('./src/wsHandler');
const { createRequestHandler } = require('./src/staticServer');
const { printBanner, printQr } = require('./src/qrDisplay');
const logger = require('./src/logger');

const HTTP_PORT = 8080; // OBS-facing, loopback only
const HTTPS_PORT = 8443; // phone-facing, LAN reachable

function parseArgs(argv) {
  const args = { ip: null, stun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ip' && argv[i + 1]) {
      args.ip = argv[++i];
    } else if (argv[i] === '--stun') {
      args.stun = true;
    }
  }
  return args;
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  const lanIp = getLanIp({ override: cliArgs.ip });
  const { key, cert } = await ensureCertificate(lanIp);

  const requestHandler = createRequestHandler({ config: { stun: cliArgs.stun } });
  const session = new SessionManager();
  session.on('state-change', logger.status);

  const httpServer = http.createServer(requestHandler);
  const httpsServer = https.createServer({ key, cert }, requestHandler);

  attachSignaling(httpServer, session, '/ws');
  attachSignaling(httpsServer, session, '/ws');

  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`[server] OBS-facing HTTP listening on http://localhost:${HTTP_PORT} (loopback only)`);
  });

  httpsServer.listen(HTTPS_PORT, '0.0.0.0', async () => {
    console.log(`[server] Phone-facing HTTPS listening on https://${lanIp}:${HTTPS_PORT}`);
    printBanner({ lanIp, httpPort: HTTP_PORT, httpsPort: HTTPS_PORT });
    await printQr(`https://${lanIp}:${HTTPS_PORT}/phone`);
    if (cliArgs.stun) {
      console.log('[server] --stun enabled: phone.js will fall back to a public STUN server if needed.\n');
    }
    logger.status('idle');
  });
}

main().catch((err) => {
  console.error('[server] Failed to start:', err.message);
  process.exit(1);
});
