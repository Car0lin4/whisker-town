'use strict';
// Whisker Town server: serves the game and keeps one shared world for everybody.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const S = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'world.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_CATS_PER_PLAYER = 300;
const MAX_CATS_TOTAL = 5000;
const { FLOOR } = S;

// ---------- helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clampX = (x) => clamp(Number(x) || 0, FLOOR.minX, FLOOR.maxX);
const clampY = (y) => clamp(Number(y) || 0, FLOOR.minY, FLOOR.maxY);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const friendKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

const tagCache = new Map();
function tagOf(owner) {
  // Public id for an owner. The real owner token stays secret on the server.
  let t = tagCache.get(owner);
  if (!t) {
    t = crypto.createHash('sha256').update('wt:' + owner).digest('hex').slice(0, 12);
    tagCache.set(owner, t);
  }
  return t;
}

function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function cleanLook(l) {
  l = l || {};
  const col = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d);
  return {
    fur: col(l.fur, '#f4a259'),
    pattern: S.PATTERNS.includes(l.pattern) ? l.pattern : 'solid',
    patternColor: col(l.patternColor, '#8a4b1f'),
    eyes: col(l.eyes, '#5cb85c'),
    accessory: S.ACCESSORIES.includes(l.accessory) ? l.accessory : 'none',
    accColor: col(l.accColor, '#e63946'),
  };
}

// ---------- world state ----------
const cats = new Map();
let friends = {};
const balls = {};
for (const room of S.ROOM_ORDER) balls[room] = { x: rand(380, 580), y: rand(440, 520), vx: 0, vy: 0, kickAt: 0 };
let dirty = false;

function posAt(c, now) {
  if (!c.dur) return { x: c.tx, y: c.ty };
  const p = Math.min(1, (now - c.t0) / c.dur);
  return { x: c.fx + (c.tx - c.fx) * p, y: c.fy + (c.ty - c.fy) * p };
}
const isMoving = (c, now) => c.dur > 0 && now < c.t0 + c.dur;

function makeCat(data) {
  const x = clampX(data.x), y = clampY(data.y);
  return {
    id: data.id, owner: data.owner, ownerName: data.ownerName || 'Someone',
    name: data.name, look: cleanLook(data.look),
    room: S.ROOMS[data.room] ? data.room : 'plaza',
    fx: x, fy: y, tx: x, ty: y, t0: 0, dur: 0,
    state: null, stateUntil: 0, lastCmd: data.lastCmd || 0,
    pendingDoor: null, pendingAct: null, born: data.born || Date.now(),
  };
}

function publicCat(c, now = Date.now()) {
  const p = posAt(c, now);
  return {
    id: c.id, name: c.name, look: c.look, room: c.room,
    ownerTag: tagOf(c.owner), ownerName: c.ownerName,
    x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(c.tx), ty: Math.round(c.ty),
    state: c.state, stateLeft: Math.max(0, c.stateUntil - now),
  };
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const c of j.cats || []) if (c && c.id && c.owner) cats.set(c.id, makeCat(c));
    friends = j.friends || {};
    console.log(`Loaded ${cats.size} cats from ${DATA_FILE}`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Could not load world file:', e.message);
  }
}
function save() {
  if (!dirty) return;
  dirty = false;
  const now = Date.now();
  const out = {
    cats: [...cats.values()].map((c) => {
      const p = posAt(c, now);
      return { id: c.id, owner: c.owner, ownerName: c.ownerName, name: c.name, look: c.look, room: c.room, x: Math.round(p.x), y: Math.round(p.y), born: c.born };
    }),
    friends,
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(out));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  } catch (e) {
    console.error('Could not save world:', e.message);
  }
}

// ---------- networking ----------
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

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws.readyState === 1 && ws.owner) ws.send(s);
}
function sendTo(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcastOnline() {
  let players = 0;
  for (const ws of wss.clients) if (ws.owner) players++;
  broadcast({ t: 'online', players, cats: cats.size });
}

// ---------- cat actions ----------
function moveCat(c, x, y) {
  const now = Date.now();
  const p = posAt(c, now);
  c.fx = p.x; c.fy = p.y;
  c.tx = clampX(x); c.ty = clampY(y);
  c.t0 = now;
  c.dur = (Math.hypot(c.tx - c.fx, c.ty - c.fy) / S.SPEED) * 1000;
  c.state = null; c.stateUntil = 0;
  c.pendingDoor = null; c.pendingAct = null;
  dirty = true;
  broadcast({ t: 'move', id: c.id, x: Math.round(c.fx), y: Math.round(c.fy), tx: Math.round(c.tx), ty: Math.round(c.ty) });
  return c.dur;
}

function changeRoom(c, room, pos) {
  if (!S.ROOMS[room]) return;
  const from = c.room;
  const p = pos || S.spawnFor(room, from);
  c.room = room;
  c.fx = c.tx = clampX(p.x); c.fy = c.ty = clampY(p.y); c.dur = 0;
  c.state = null; c.pendingDoor = null; c.pendingAct = null;
  dirty = true;
  broadcast({ t: 'cat', cat: publicCat(c) });
}

function doSolo(c, action) {
  if (!S.SOLO_ACTIONS.includes(action)) return;
  if (action === 'sleep' || action === 'dance') {
    const p = posAt(c, Date.now());
    moveCat(c, p.x, p.y); // stop where it is
    c.state = action;
    c.stateUntil = Date.now() + (action === 'sleep' ? 25000 : 5000);
  }
  broadcast({ t: 'act', id: c.id, action });
}

function startInteraction(a, b, action) {
  if (!b || a.id === b.id || a.room !== b.room || !S.INTERACTIONS.includes(action)) return;
  const now = Date.now();
  const pa = posAt(a, now), pb = posAt(b, now);
  const side = pa.x < pb.x ? -1 : 1;
  let destX = pb.x + side * 52;
  if (destX < FLOOR.minX || destX > FLOOR.maxX) destX = pb.x - side * 52;
  const dur = moveCat(a, destX, pb.y);
  a.pendingAct = { target: b.id, action, at: now + dur };
}

function finishInteraction(a) {
  const { target, action } = a.pendingAct;
  a.pendingAct = null;
  const b = cats.get(target);
  if (!b || b.room !== a.room) return;
  const k = friendKey(a.id, b.id);
  friends[k] = (friends[k] || 0) + 1;
  dirty = true;
  broadcast({ t: 'act', id: a.id, action, target: b.id, friendship: friends[k] });
}

// ---------- game loop ----------
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.2, (now - lastTick) / 1000);
  lastTick = now;

  const movingByRoom = {};
  for (const c of cats.values()) {
    if (c.pendingDoor && now >= c.pendingDoor.at) changeRoom(c, c.pendingDoor.to);
    else if (c.pendingAct && now >= c.pendingAct.at) finishInteraction(c);
    if (c.state && now > c.stateUntil) c.state = null;
    if (isMoving(c, now)) (movingByRoom[c.room] ||= []).push(c);
  }

  // Yarn balls get kicked by walking cats.
  for (const room of S.ROOM_ORDER) {
    const b = balls[room];
    const wasMoving = b.vx !== 0 || b.vy !== 0;
    if (now - b.kickAt > 250) {
      for (const c of movingByRoom[room] || []) {
        const p = posAt(c, now);
        const dx = b.x - p.x, dy = (b.y - p.y) * 1.5;
        const d = Math.hypot(dx, dy);
        if (d < 28) {
          const n = d || 1;
          b.vx = (dx / n) * 380 + rand(-30, 30);
          b.vy = (dy / n) * 250 + rand(-20, 20);
          b.kickAt = now;
          break;
        }
      }
    }
    if (b.vx || b.vy) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < FLOOR.minX) { b.x = FLOOR.minX; b.vx = Math.abs(b.vx); }
      if (b.x > FLOOR.maxX) { b.x = FLOOR.maxX; b.vx = -Math.abs(b.vx); }
      if (b.y < FLOOR.minY) { b.y = FLOOR.minY; b.vy = Math.abs(b.vy); }
      if (b.y > FLOOR.maxY) { b.y = FLOOR.maxY; b.vy = -Math.abs(b.vy); }
      const f = Math.pow(0.22, dt);
      b.vx *= f; b.vy *= f;
      if (Math.hypot(b.vx, b.vy) < 10) { b.vx = 0; b.vy = 0; }
    }
    if (b.vx || b.vy || wasMoving) {
      broadcast({ t: 'ball', room, x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy) });
    }
  }
}, 50);

// Idle cats live their own little lives: wander, nap, and play with each other.
setInterval(() => {
  const now = Date.now();
  const byRoom = {};
  for (const c of cats.values()) (byRoom[c.room] ||= []).push(c);
  for (const c of cats.values()) {
    if (now - c.lastCmd < 30000 || isMoving(c, now) || c.pendingAct || c.pendingDoor || c.state === 'sleep') continue;
    const r = Math.random();
    const p = posAt(c, now);
    if (r < 0.07) moveCat(c, p.x + rand(-160, 160), p.y + rand(-70, 70));
    else if (r < 0.075) doSolo(c, 'sleep');
    else if (r < 0.085) doSolo(c, pick(['meow', 'purr', 'jump', 'dance']));
    else if (r < 0.092) {
      const others = byRoom[c.room].filter((o) => o !== c);
      if (others.length) startInteraction(c, pick(others), pick(S.INTERACTIONS));
    }
  }
}, 1500);

setInterval(save, 5000);

// ---------- messages from players ----------
const NAMES = ['Mochi', 'Luna', 'Biscuit', 'Pepper', 'Noodle', 'Tofu', 'Ziggy', 'Pumpkin', 'Miso', 'Olive', 'Waffles', 'Pickle', 'Bean', 'Clover'];

function handle(ws, m) {
  if (!m || typeof m.t !== 'string') return;
  const now = Date.now();

  if (m.t === 'hello') {
    ws.owner = typeof m.owner === 'string' && /^[0-9a-f-]{36}$/.test(m.owner) ? m.owner : crypto.randomUUID();
    ws.name = cleanText(m.name, 16) || 'Guest';
    for (const c of cats.values()) {
      if (c.owner === ws.owner && c.ownerName !== ws.name) { c.ownerName = ws.name; dirty = true; }
    }
    sendTo(ws, {
      t: 'welcome', owner: ws.owner, tag: tagOf(ws.owner),
      cats: [...cats.values()].map((c) => publicCat(c, now)),
      friends, balls,
    });
    broadcastOnline();
    return;
  }
  if (!ws.owner) return;

  const own = (id) => {
    const c = cats.get(id);
    if (c && c.owner === ws.owner) { c.lastCmd = now; return c; }
    return null;
  };

  switch (m.t) {
    case 'create': {
      let mine = 0;
      for (const c of cats.values()) if (c.owner === ws.owner) mine++;
      if (mine >= MAX_CATS_PER_PLAYER || cats.size >= MAX_CATS_TOTAL) {
        return sendTo(ws, { t: 'error', text: 'Whoa, that is a LOT of cats! The town is full for now.' });
      }
      const room = S.ROOMS[m.room] ? m.room : 'plaza';
      const c = makeCat({
        id: crypto.randomBytes(6).toString('hex'), owner: ws.owner, ownerName: ws.name,
        name: cleanText(m.name, 16) || pick(NAMES), look: m.look, room,
        x: rand(180, 780), y: rand(400, 560), lastCmd: now,
      });
      cats.set(c.id, c);
      dirty = true;
      broadcast({ t: 'cat', cat: publicCat(c) });
      sendTo(ws, { t: 'created', id: c.id });
      broadcastOnline();
      break;
    }
    case 'update': {
      const c = own(m.id); if (!c) return;
      c.name = cleanText(m.name, 16) || c.name;
      c.look = cleanLook(m.look);
      dirty = true;
      broadcast({ t: 'cat', cat: publicCat(c) });
      break;
    }
    case 'delete': {
      const c = own(m.id); if (!c) return;
      cats.delete(c.id);
      for (const k of Object.keys(friends)) if (k.split('|').includes(c.id)) delete friends[k];
      dirty = true;
      broadcast({ t: 'remove', id: c.id });
      broadcastOnline();
      break;
    }
    case 'move': {
      const c = own(m.id); if (c) moveCat(c, m.x, m.y);
      break;
    }
    case 'herd': {
      // Move all of this player's cats in a room to a spot.
      if (!S.ROOMS[m.room]) return;
      const group = [...cats.values()].filter((c) => c.owner === ws.owner && c.room === m.room);
      group.forEach((c, i) => {
        c.lastCmd = now;
        const a = i * 2.4, r = i === 0 ? 0 : 22 + Math.sqrt(i) * 22;
        moveCat(c, Number(m.x) + Math.cos(a) * r, Number(m.y) + Math.sin(a) * r * 0.5);
      });
      break;
    }
    case 'door': {
      const c = own(m.id); if (!c) return;
      const door = S.ROOMS[c.room].doors.find((d) => d.to === m.to);
      if (!door) return;
      const dur = moveCat(c, door.x, door.y);
      c.pendingDoor = { to: door.to, at: now + dur };
      break;
    }
    case 'room': {
      const c = own(m.id); if (c && S.ROOMS[m.room] && c.room !== m.room) changeRoom(c, m.room, { x: rand(300, 660), y: rand(420, 540) });
      break;
    }
    case 'summon': {
      if (!S.ROOMS[m.room]) return;
      for (const c of cats.values()) {
        if (c.owner !== ws.owner) continue;
        c.lastCmd = now;
        if (c.room !== m.room) changeRoom(c, m.room, { x: rand(150, 810), y: rand(400, 560) });
      }
      break;
    }
    case 'say': {
      const c = own(m.id); if (!c) return;
      if (now - (ws.lastSay || 0) < 700) return;
      ws.lastSay = now;
      const text = cleanText(m.text, 100);
      if (text) broadcast({ t: 'say', id: c.id, text });
      break;
    }
    case 'act': {
      const c = own(m.id); if (!c) return;
      if (m.target) startInteraction(c, cats.get(m.target), m.action);
      else doSolo(c, m.action);
      break;
    }
  }
}

wss.on('connection', (ws) => {
  ws.tokens = 30;
  ws.lastRefill = Date.now();
  ws.on('message', (raw) => {
    const now = Date.now();
    ws.tokens = Math.min(30, ws.tokens + ((now - ws.lastRefill) / 1000) * 12);
    ws.lastRefill = now;
    if (ws.tokens < 1) return; // too many messages: ignore
    ws.tokens -= 1;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try { handle(ws, m); } catch (e) { console.error('Error handling message:', e); }
  });
  ws.on('close', broadcastOnline);
});

load();
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
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { dirty = true; save(); process.exit(0); });
