'use strict';
// Runs Whisker Town on your own computer (npm start) or on hosts like Render.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const world = require('./lib/world.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

world.attach(server); // accepts /ws and /api/ws
server.listen(PORT, () => {
  console.log(`\n🐾 Whisker Town is running!`);
  console.log(`   On this computer:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`   Same Wi-Fi:        http://${i.address}:${PORT}`);
    }
  }
  console.log('');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await world.flush(); process.exit(0); });
