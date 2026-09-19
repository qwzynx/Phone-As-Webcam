'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

const ROUTES = {
  '/': '/phone.html',
  '/phone': '/phone.html',
  '/obs': '/obs.html'
};

function resolveRequestPath(urlPath) {
  const routed = ROUTES[urlPath] || urlPath;
  const normalized = path.normalize(routed).replace(/^(\.\.[/\\])+/, '');
  const resolved = path.join(PUBLIC_DIR, normalized);
  if (!resolved.startsWith(PUBLIC_DIR)) return null; // path traversal guard
  return resolved;
}

function createRequestHandler({ config = {} } = {}) {
  return (req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (urlPath === '/config.js') {
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'] });
      res.end(`window.APP_CONFIG = ${JSON.stringify(config)};`);
      return;
    }

    const filePath = resolveRequestPath(urlPath);

    if (!filePath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
        // OBS's embedded browser caches aggressively; without this it keeps
        // serving stale CSS/JS after an update until its cache is cleared.
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  };
}

module.exports = { createRequestHandler };
