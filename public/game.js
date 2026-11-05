(() => {
  'use strict';
  const S = window.SHARED;
  const { W, H, FLOOR } = S;
  const { drawCat } = window.CatDraw;
  const $ = (q) => document.querySelector(q);
  const canvas = $('#game');
  const ctx = canvas.getContext('2d');

  // ---------- small helpers ----------
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const friendKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const depthScale = (y) => 0.78 + ((y - FLOOR.minY) / (FLOOR.maxY - FLOOR.minY)) * 0.42;
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- state ----------
  const me = { owner: localStorage.getItem('wt_owner'), name: localStorage.getItem('wt_name'), tag: null };
  const cats = new Map();
  let friends = {};
  const balls = {};
  const particles = [];
  let selectedId = localStorage.getItem('wt_selected');
  let viewRoom = 'plaza';
  let popupId = null;
  let clickMarker = null;
  let muted = localStorage.getItem('wt_muted') === '1';
  let onlineInfo = { players: 0, cats: 0 };

  const myCats = () => [...cats.values()].filter((c) => c.ownerTag === me.tag).sort((a, b) => a.name.localeCompare(b.name));
  const selectedCat = () => {
    const c = cats.get(selectedId);
    return c && c.ownerTag === me.tag ? c : null;
  };

  // ---------- sound ----------
  let actx = null;
  function meowSound(pitch = 1) {
    if (muted) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain(), f = actx.createBiquadFilter();
      o.type = 'sawtooth'; f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.6;
      o.frequency.setValueAtTime(480 * pitch, t);
      o.frequency.linearRampToValueAtTime(820 * pitch, t + 0.13);
      o.frequency.linearRampToValueAtTime(430 * pitch, t + 0.45);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(f).connect(g).connect(actx.destination);
      o.start(t); o.stop(t + 0.55);
    } catch { /* audio not available */ }
  }
  function updateMuteBtn() { $('#mute').textContent = muted ? '🔇' : '🔊'; }
  $('#mute').onclick = () => { muted = !muted; localStorage.setItem('wt_muted', muted ? '1' : '0'); updateMuteBtn(); };
  updateMuteBtn();

  // ---------- networking ----------
  let ws;
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { send({ t: 'hello', owner: me.owner, name: me.name }); $('#dot').classList.add('on'); };
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => {
      $('#dot').classList.remove('on');
      $('#online').textContent = 'reconnecting…';
      setTimeout(connect, 1500);
    };
  }
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function upsert(d) {
    const now = performance.now();
    const old = cats.get(d.id);
    const prevRoom = old && old.room;
    const c = Object.assign(old || { face: 1, seed: hash01(d.id) * 10, pitch: 0.8 + hash01(d.id + 'p') * 0.5 }, d);
    const dist = Math.hypot(d.tx - d.x, d.ty - d.y);
    c.anim = { fx: d.x, fy: d.y, tx: d.tx, ty: d.ty, start: now, dur: (dist / S.SPEED) * 1000 };
    c.pose = d.state ? { kind: d.state, until: now + d.stateLeft } : null;
    cats.set(c.id, c);
    return { c, roomChanged: !!old && prevRoom !== c.room };
  }

  function onMsg(m) {
    const now = performance.now();
    switch (m.t) {
      case 'welcome': {
        me.owner = m.owner; me.tag = m.tag;
        localStorage.setItem('wt_owner', m.owner);
        cats.clear();
        m.cats.forEach(upsert);
        friends = m.friends || {};
        for (const [room, b] of Object.entries(m.balls || {})) setBall(room, b, true);
        const mine = myCats();
        if (!selectedCat() && mine.length) selectedId = mine[0].id;
        if (selectedCat()) viewRoom = selectedCat().room;
        renderAll();
        if (!mine.length) openCreator();
        break;
      }
      case 'cat': {
        const { c, roomChanged } = upsert(m.cat);
        if (c.id === selectedId && roomChanged) { viewRoom = c.room; hidePopup(); }
        renderAll();
        break;
      }
      case 'created': select(m.id); break;
      case 'remove': {
        cats.delete(m.id);
        if (m.id === selectedId) { const mine = myCats(); selectedId = mine.length ? mine[0].id : null; }
        if (m.id === popupId) hidePopup();
        renderAll();
        break;
      }
      case 'move': {
        const c = cats.get(m.id); if (!c) return;
        const p = posOf(c, now);
        const useLocal = Math.hypot(p.x - m.x, p.y - m.y) < 80;
        const fx = useLocal ? p.x : m.x, fy = useLocal ? p.y : m.y;
        c.anim = { fx, fy, tx: m.tx, ty: m.ty, start: now, dur: (Math.hypot(m.tx - fx, m.ty - fy) / S.SPEED) * 1000 };
        if (Math.abs(m.tx - fx) > 2) c.face = m.tx > fx ? 1 : -1;
        c.pose = null;
        break;
      }
      case 'say': {
        const c = cats.get(m.id);
        if (c) { say(c, m.text); c.mouthUntil = now + 400; }
        break;
      }
      case 'act': onAct(m); break;
      case 'ball': setBall(m.room, m); break;
      case 'online': onlineInfo = m; renderOnline(); break;
      case 'error': toast(m.text); break;
    }
  }

  function setBall(room, b, snap) {
    const cur = balls[room] || { dx: b.x, dy: b.y, rot: 0 };
    Object.assign(cur, { x: b.x, y: b.y, vx: b.vx, vy: b.vy, at: performance.now() });
    if (snap) { cur.dx = b.x; cur.dy = b.y; }
    balls[room] = cur;
  }

  // ---------- movement ----------
  function posOf(c, now) {
    const a = c.anim;
    if (!a || !a.dur) return { x: a ? a.tx : 480, y: a ? a.ty : 460, moving: false };
    const p = Math.min(1, (now - a.start) / a.dur);
    return { x: a.fx + (a.tx - a.fx) * p, y: a.fy + (a.ty - a.fy) * p, moving: p < 1 };
  }

  // ---------- effects ----------
  function say(c, text) { c.bubble = { text, until: performance.now() + 2600 + text.length * 70 }; }
  function headPos(c) {
    const p = posOf(c, performance.now());
    return { x: p.x, y: p.y - 85 * depthScale(p.y) };
  }
  function burst(c, emoji, n, spread = 30, delayStep = 0) {
    if (!c || c.room !== viewRoom) return;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const h = headPos(c);
        particles.push({
          x: h.x + (Math.random() - 0.5) * spread, y: h.y + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 40, vy: -40 - Math.random() * 40,
          life: 0, max: 1.3 + Math.random() * 0.6, emoji, size: 16 + Math.random() * 8,
        });
      }, i * delayStep);
    }
  }
  function faceEachOther(a, b) {
    const now = performance.now();
    const pa = posOf(a, now), pb = posOf(b, now);
    a.face = pb.x >= pa.x ? 1 : -1;
    b.face = -a.face;
  }
  function jump(c, delay = 0, dur = 650) {
    setTimeout(() => { c.jump = { start: performance.now(), dur }; }, delay);
  }

  function onAct(m) {
    const now = performance.now();
    const c = cats.get(m.id); if (!c) return;
    const tgt = m.target ? cats.get(m.target) : null;
    const inView = c.room === viewRoom;
    if (tgt && m.friendship != null) friends[friendKey(c.id, tgt.id)] = m.friendship;
    if (tgt) faceEachOther(c, tgt);

    switch (m.action) {
      case 'meow':
        say(c, pick(['Meow!', 'Mrrrow~', 'Mew!', 'Nyaa~', 'Mrrp?', 'Meeeow!']));
        c.mouthUntil = now + 550;
        if (inView) meowSound(c.pitch);
        burst(c, '🎵', 1);
        break;
      case 'purr':
        say(c, 'purrrrr~');
        c.happyUntil = now + 2500;
        burst(c, '💗', 3, 30, 200);
        break;
      case 'dance':
        c.pose = { kind: 'dance', until: now + 5000 };
        burst(c, pick(['🎵', '🎶']), 6, 40, 600);
        break;
      case 'sleep':
        c.pose = { kind: 'sleep', until: now + 25000 };
        break;
      case 'jump':
        jump(c);
        break;
      case 'boop':
        say(c, 'boop!');
        burst(tgt, '⭐', 2);
        tgt.happyUntil = now + 1500;
        jump(tgt, 150, 400);
        break;
      case 'play':
        say(c, pick(["Let's play!", 'Tag, you\'re it!', 'Catch me!']));
        jump(c); jump(tgt, 250); jump(c, 800); jump(tgt, 1050);
        burst(c, '🧶', 2, 30, 300); burst(tgt, '✨', 3, 30, 300);
        if (inView) meowSound(c.pitch * 1.1);
        break;
      case 'groom':
        say(c, '*lick lick*');
        tgt.happyUntil = now + 3000;
        burst(tgt, '✨', 5, 30, 250);
        break;
      case 'cuddle':
        c.pose = { kind: 'cuddle', until: now + 3500 };
        tgt.pose = { kind: 'cuddle', until: now + 3500 };
        burst(c, '💕', 4, 30, 300); burst(tgt, '💗', 4, 30, 350);
        break;
      case 'pounce':
        jump(c, 0, 500);
        say(tgt, pick(['!!', 'Eek!', 'Hey!']));
        jump(tgt, 300, 450);
        burst(tgt, '💥', 1);
        break;
    }
  }

  // ---------- room art (painted once per room, then cached) ----------
  let DPR = 1;
  let bgCache = {};
  function fitCanvas() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * DPR; canvas.height = H * DPR;
    bgCache = {};
  }
  window.addEventListener('resize', () => { if (Math.min(2, window.devicePixelRatio || 1) !== DPR) fitCanvas(); });

  function background(room) {
    if (bgCache[room]) return bgCache[room];
    const c = document.createElement('canvas');
    c.width = W * DPR; c.height = H * DPR;
    const g = c.getContext('2d');
    g.scale(DPR, DPR);
    ({ plaza: paintPlaza, cafe: paintCafe, garden: paintGarden, rooftop: paintRooftop })[room](g);
    bgCache[room] = c;
    return c;
  }
  function skyGrad(g, top, bottom, h) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, W, h);
  }
  function rr(g, x, y, w, h, r, fill, stroke) {
    g.beginPath(); g.roundRect(x, y, w, h, r);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.stroke(); }
  }

  function paintPlaza(g) {
    const r = rng(7);
    skyGrad(g, '#8fd3ff', '#e6f7ff', 345);
    const colors = ['#f7b267', '#f4d35e', '#9ad1d4', '#f79d84', '#b8e0a8', '#d7b4f3', '#f6c1c9'];
    let x = -10, i = 0;
    while (x < W) {
      const w = 120 + r() * 50, h = 150 + r() * 70, col = colors[i % colors.length];
      const top = 340 - h;
      rr(g, x, top, w, h, 4, col);
      // cat-ear roof
      g.fillStyle = CatDraw.shade(col, -0.35);
      g.beginPath(); g.moveTo(x - 6, top + 2); g.lineTo(x + 14, top - 34); g.lineTo(x + w * 0.35, top + 2); g.fill();
      g.beginPath(); g.moveTo(x + w * 0.65, top + 2); g.lineTo(x + w - 14, top - 34); g.lineTo(x + w + 6, top + 2); g.fill();
      g.fillRect(x - 6, top - 4, w + 12, 8);
      // windows
      for (let wy = top + 22; wy < 290; wy += 46) {
        for (let wx = x + 16; wx < x + w - 36; wx += 40) {
          rr(g, wx, wy, 26, 28, 13, '#fff8dc', CatDraw.shade(col, -0.4));
          g.fillStyle = CatDraw.shade(col, -0.4); g.fillRect(wx + 12, wy, 2, 28);
        }
      }
      rr(g, x + w / 2 - 14, 296, 28, 44, [14, 14, 0, 0], CatDraw.shade(col, -0.45));
      x += w + 6; i++;
    }
    // fish shop awning
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#fff' : '#3a86ff'; g.fillRect(300 + k * 22, 270, 22, 18); }
    g.fillStyle = '#fff'; g.font = 'bold 15px ui-rounded, sans-serif'; g.textAlign = 'center';
    rr(g, 330, 240, 116, 26, 8, '#3a86ff'); g.fillStyle = '#fff'; g.fillText('🐟 FISH SHOP', 388, 258);
    // sidewalk + floor
    g.fillStyle = '#d9c39a'; g.fillRect(0, 335, W, 12);
    g.fillStyle = '#ecdcb8'; g.fillRect(0, 347, W, H - 347);
    for (let y = 352; y < H; y += 20) {
      const off = ((y / 20) % 2) * 22;
      for (let cx = -20 + off; cx < W + 20; cx += 44) {
        g.fillStyle = r() < 0.5 ? 'rgba(160,120,70,0.10)' : 'rgba(255,255,255,0.35)';
        g.beginPath(); g.ellipse(cx, y, 19, 7 + (y - 350) / 60, 0, 0, Math.PI * 2); g.fill();
      }
    }
    // fountain base
    g.fillStyle = '#b9c4cf'; g.beginPath(); g.ellipse(480, 372, 92, 24, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7fc8f8'; g.beginPath(); g.ellipse(480, 368, 80, 18, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c9d3dc'; g.fillRect(472, 318, 16, 50);
    g.beginPath(); g.ellipse(480, 318, 26, 7, 0, 0, Math.PI * 2); g.fill();
    // ladder to the rooftop
    g.strokeStyle = '#8b5a2b'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(782, 120); g.lineTo(782, 355); g.moveTo(818, 120); g.lineTo(818, 355); g.stroke();
    g.lineWidth = 4; g.beginPath();
    for (let y = 135; y < 355; y += 22) { g.moveTo(782, y); g.lineTo(818, y); }
    g.stroke();
    // lamp posts
    for (const lx of [210, 680]) {
      g.fillStyle = '#4a4a5a'; g.fillRect(lx - 3, 250, 6, 100);
      g.beginPath(); g.ellipse(lx, 352, 12, 4, 0, 0, Math.PI * 2); g.fill();
      rr(g, lx - 11, 232, 22, 22, 6, '#ffe9a8', '#4a4a5a');
    }
  }

  function paintCafe(g) {
    const r = rng(3);
    g.fillStyle = '#f6dcb8'; g.fillRect(0, 0, W, 345);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let x = 0; x < W; x += 40) g.fillRect(x, 0, 16, 260);
    g.fillStyle = '#b5835a'; g.fillRect(0, 260, W, 85);
    g.fillStyle = '#9c6c45'; g.fillRect(0, 258, W, 6);
    for (let x = 20; x < W; x += 60) rr(g, x, 275, 40, 55, 4, null, '#9c6c45');
    // window
    rr(g, 60, 60, 210, 160, 12, '#8fd3ff', '#7a5232');
    g.fillStyle = '#e6f7ff'; g.beginPath(); g.ellipse(120, 150, 40, 14, 0, 0, Math.PI * 2); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#7a5232'; g.strokeRect(60, 60, 210, 160);
    g.beginPath(); g.moveTo(165, 60); g.lineTo(165, 220); g.moveTo(60, 140); g.lineTo(270, 140); g.stroke();
    // menu board
    rr(g, 340, 50, 200, 140, 10, '#2f3b35', '#7a5232');
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.font = 'bold 20px ui-rounded, sans-serif'; g.fillText('MENU', 440, 80);
    g.font = '15px ui-rounded, sans-serif';
    ['🐟 Tuna Latte', '🥛 Milk Foam', '🍤 Shrimp Puff', '🧁 Sardine Cake'].forEach((t, i) => g.fillText(t, 440, 108 + i * 21));
    // counter
    rr(g, 590, 215, 340, 125, 10, '#8b5a3c');
    rr(g, 580, 205, 360, 18, 8, '#c58b5e');
    rr(g, 620, 150, 120, 58, 8, 'rgba(255,255,255,0.55)', '#c58b5e');
    for (let k = 0; k < 4; k++) {
      g.fillStyle = ['#ffb4a2', '#f9dc5c', '#c5e1a5', '#ffcad4'][k];
      const fx = 640 + k * 26, fy = 185;
      g.beginPath(); g.ellipse(fx, fy, 10, 6, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(fx + 8, fy); g.lineTo(fx + 15, fy - 6); g.lineTo(fx + 15, fy + 6); g.fill();
    }
    rr(g, 800, 140, 70, 66, 8, '#c0c6cc', '#7d858c');
    rr(g, 818, 180, 34, 18, 4, '#5a3b25');
    // lamps
    for (const lx of [180, 480, 760]) {
      g.strokeStyle = '#5a3b25'; g.lineWidth = 2; g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx, 26); g.stroke();
      g.fillStyle = '#ffcf6e'; g.beginPath(); g.arc(lx, 38, 16, Math.PI, 0); g.fill();
    }
    // checker floor
    for (let y = 345; y < H; y += 32) {
      for (let x = 0; x < W; x += 40) {
        g.fillStyle = ((x / 40 + (y - 345) / 32) | 0) % 2 ? '#fff4e2' : '#e8c9a0';
        g.fillRect(x, y, 40, 32);
      }
    }
    // rug
    g.fillStyle = '#c44536'; g.beginPath(); g.ellipse(470, 475, 230, 70, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f2cc8f'; g.lineWidth = 5; g.beginPath(); g.ellipse(470, 475, 205, 56, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f2cc8f'; g.font = '28px serif'; g.fillText('🐾', 470, 486);
    // plant
    rr(g, 300, 300, 34, 44, 6, '#d17a47');
    g.fillStyle = '#4caf50';
    for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(317 + (r() - 0.5) * 30, 280 - r() * 30, 9, 18, (r() - 0.5) * 1.2, 0, Math.PI * 2); g.fill(); }
  }

  function paintGarden(g) {
    const r = rng(11);
    skyGrad(g, '#7ec8f0', '#dff3ff', 345);
    g.fillStyle = '#fff6b0'; g.beginPath(); g.arc(120, 80, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#a8d98a'; g.beginPath(); g.ellipse(250, 330, 330, 110, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#95cf75'; g.beginPath(); g.ellipse(760, 335, 360, 125, 0, 0, Math.PI * 2); g.fill();
    // trees
    for (const [tx, ty, s] of [[90, 300, 1.1], [330, 290, 0.9], [640, 295, 1], [880, 300, 1.2]]) {
      g.fillStyle = '#8b5a2b'; g.fillRect(tx - 9 * s, ty - 70 * s, 18 * s, 75 * s);
      g.fillStyle = '#4caf50';
      for (const [dx, dy, rr2] of [[0, -110, 45], [-35, -85, 34], [35, -85, 34], [0, -75, 38]]) {
        g.beginPath(); g.arc(tx + dx * s, ty + dy * s, rr2 * s, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#e63946';
      for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(tx + (r() - 0.5) * 60 * s, ty - (70 + r() * 60) * s, 4, 0, Math.PI * 2); g.fill(); }
    }
    // fence
    g.fillStyle = '#fffaf0'; g.strokeStyle = '#d9c7a8'; g.lineWidth = 2;
    g.fillRect(0, 300, W, 8); g.fillRect(0, 322, W, 8);
    for (let x = 6; x < W; x += 28) {
      g.beginPath(); g.moveTo(x, 345); g.lineTo(x, 292); g.lineTo(x + 9, 282); g.lineTo(x + 18, 292); g.lineTo(x + 18, 345); g.closePath();
      g.fill(); g.stroke();
    }
    // grass
    const gr = g.createLinearGradient(0, 345, 0, H);
    gr.addColorStop(0, '#8fd16a'); gr.addColorStop(1, '#6cb84a');
    g.fillStyle = gr; g.fillRect(0, 345, W, H - 345);
    g.strokeStyle = 'rgba(40,110,30,0.35)'; g.lineWidth = 2;
    for (let k = 0; k < 260; k++) {
      const x = r() * W, y = 350 + r() * (H - 350);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y - 7); g.moveTo(x, y); g.lineTo(x + 3, y - 7); g.stroke();
    }
    // pond
    g.fillStyle = '#5fb3e0'; g.beginPath(); g.ellipse(230, 378, 120, 26, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.ellipse(200, 372, 60, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3d9a4a'; g.beginPath(); g.ellipse(280, 382, 16, 6, 0, 0, Math.PI * 2); g.fill();
    // flowers
    for (let k = 0; k < 70; k++) {
      const x = r() * W, y = 355 + r() * (H - 360);
      const col = pick(['#ff8fab', '#ffd23f', '#ffffff', '#c77dff', '#ff6b6b']);
      g.fillStyle = col;
      for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * 3.5, y + Math.sin(a) * 2.5, 2.6, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#ffb703'; g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill();
    }
    // catnip sign
    g.fillStyle = '#8b5a2b'; g.fillRect(596, 300, 6, 50);
    rr(g, 560, 278, 80, 28, 6, '#c58b5e', '#8b5a2b');
    g.fillStyle = '#fff'; g.font = 'bold 13px ui-rounded, sans-serif'; g.textAlign = 'center'; g.fillText('🌿 Catnip', 600, 297);
  }

  let rooftopStars = [];
  function paintRooftop(g) {
    const r = rng(21);
    skyGrad(g, '#141838', '#3d4280', 345);
    rooftopStars = [];
    for (let k = 0; k < 90; k++) rooftopStars.push({ x: r() * W, y: r() * 230, s: 0.6 + r() * 1.6, p: r() * 6 });
    g.fillStyle = '#fff6d5'; g.beginPath(); g.arc(820, 90, 44, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(200,190,150,0.4)';
    for (const [cx, cy, cr] of [[805, 78, 9], [835, 102, 7], [826, 70, 4]]) { g.beginPath(); g.arc(cx, cy, cr, 0, Math.PI * 2); g.fill(); }
    // skyline
    let x = -10;
    while (x < W) {
      const w = 50 + r() * 70, h = 90 + r() * 130;
      g.fillStyle = '#23275a'; g.fillRect(x, 330 - h, w, h);
      for (let wy = 340 - h; wy < 320; wy += 16) for (let wx = x + 8; wx < x + w - 8; wx += 14) {
        if (r() < 0.3) { g.fillStyle = '#ffd97a'; g.fillRect(wx, wy, 6, 8); }
      }
      x += w + 4;
    }
    // roof
    g.fillStyle = '#6e3f33'; g.fillRect(0, 330, W, H - 330);
    g.fillStyle = '#8b5246';
    for (let y = 335; y < H; y += 24) {
      const off = ((y / 24) % 2) * 20;
      for (let tx = -20 + off; tx < W + 20; tx += 40) { g.beginPath(); g.arc(tx, y, 20, 0, Math.PI); g.fill(); }
    }
    g.fillStyle = '#5a3229'; g.fillRect(0, 328, W, 8);
    // chimney
    rr(g, 150, 240, 56, 96, 2, '#a5503a');
    g.fillStyle = '#7d3a2a';
    for (let y = 248; y < 336; y += 12) g.fillRect(150, y, 56, 2);
    rr(g, 144, 232, 68, 12, 3, '#7d3a2a');
    // ladder down
    g.strokeStyle = '#8b5a2b'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(72, 470); g.lineTo(72, 600); g.moveTo(108, 470); g.lineTo(108, 600); g.stroke();
    g.beginPath(); for (let y = 482; y < 600; y += 20) { g.moveTo(72, y); g.lineTo(108, y); } g.stroke();
  }

  function drawRoomFx(room, t) {
    if (room === 'plaza') {
      for (let k = 0; k < 3; k++) cloud((t * 12 + k * 380) % (W + 240) - 120, 50 + k * 40, 1 - k * 0.2);
      ctx.fillStyle = 'rgba(160,215,255,0.9)';
      for (let k = 0; k < 14; k++) {
        const ph = (t * 0.9 + k / 14) % 1, side = k % 2 ? 1 : -1, sp = 20 + (k % 7) * 8;
        const x = 480 + side * ph * sp, y = 316 - Math.sin(ph * Math.PI) * 38 + ph * 48;
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    } else if (room === 'garden') {
      for (let k = 0; k < 2; k++) cloud((t * 9 + k * 520) % (W + 240) - 120, 60 + k * 50, 0.9);
      ctx.font = '18px serif'; ctx.textAlign = 'center';
      for (let k = 0; k < 3; k++) {
        const bx = 200 + k * 260 + Math.sin(t * 0.6 + k * 2) * 90, by = 250 + Math.sin(t * 1.7 + k) * 40;
        ctx.save(); ctx.translate(bx, by); ctx.scale(1, 0.7 + Math.abs(Math.sin(t * 9 + k)) * 0.3); ctx.fillText('🦋', 0, 0); ctx.restore();
      }
    } else if (room === 'rooftop') {
      for (const s of rooftopStars) {
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + s.p));
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(206, 250); ctx.quadraticCurveTo(560, 330, 960, 230); ctx.stroke();
      const cols = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c77dff'];
      for (let k = 0; k < 22; k++) {
        const u = k / 21, x = (1 - u) * (1 - u) * 206 + 2 * (1 - u) * u * 560 + u * u * 960;
        const y = (1 - u) * (1 - u) * 250 + 2 * (1 - u) * u * 330 + u * u * 230 + 6;
        ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(t * 2 + k));
        ctx.fillStyle = cols[k % cols.length]; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (room === 'cafe') {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.5 + k / 3) % 1;
        ctx.globalAlpha = 1 - ph;
        ctx.beginPath(); ctx.arc(835 + Math.sin(ph * 8 + k) * 5, 175 - ph * 50, 5 + ph * 6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  function cloud(x, y, s) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [dx, dy, r] of [[0, 0, 22], [24, -8, 26], [50, 0, 20], [25, 8, 20]]) {
      ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawDoors(room, t) {
    for (const d of S.ROOMS[room].doors) {
      const target = S.ROOMS[d.to];
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      ctx.fillStyle = `rgba(255,230,120,${0.25 + pulse * 0.25})`;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, 38, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8b5a2b'; ctx.fillRect(d.x - 3, d.y - 62, 6, 62);
      const label = `${target.emoji} ${target.name}`;
      ctx.font = 'bold 13px ui-rounded, sans-serif';
      const w = ctx.measureText(label).width + 20;
      rr(ctx, d.x - w / 2, d.y - 88, w, 26, 7, '#fff8e8', '#8b5a2b');
      ctx.fillStyle = '#5a3b25'; ctx.textAlign = 'center'; ctx.fillText(label, d.x, d.y - 70);
    }
  }

  // ---------- drawing cats & UI on canvas ----------
  function drawYarn(b, now) {
    const s = depthScale(b.dy);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(b.dx, b.dy, 13 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(b.dx, b.dy - 11 * s); ctx.rotate(b.rot); ctx.scale(s, s);
    ctx.fillStyle = '#e76f8a'; ctx.strokeStyle = '#b84a66'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (const a of [-0.6, 0, 0.6]) { ctx.moveTo(-10 * Math.cos(a), -10 * Math.sin(a) - 3); ctx.quadraticCurveTo(0, 6 + a * 4, 10 * Math.cos(a), 10 * Math.sin(a) - 3); }
    ctx.stroke();
    ctx.restore();
  }

  function wrapText(text, maxW) {
    const words = text.split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }
  function drawBubble(x, y, text) {
    ctx.font = '600 14px ui-rounded, sans-serif';
    const lines = wrapText(text, 170);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
    const h = lines.length * 18 + 12;
    const bx = clamp(x - w / 2, 4, W - w - 4), by = Math.max(4, y - h - 10);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d9c2ad'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, 10); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 6, by + h - 1); ctx.lineTo(x, by + h + 8); ctx.lineTo(x + 6, by + h - 1); ctx.fill();
    ctx.fillStyle = '#4a3426'; ctx.textAlign = 'center';
    lines.forEach((l, i) => ctx.fillText(l, bx + w / 2, by + 20 + i * 18));
  }

  let lastFrame = performance.now();
  function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const t = now / 1000;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(background(viewRoom), 0, 0, W, H);
    drawRoomFx(viewRoom, t);
    drawDoors(viewRoom, t);

    if (clickMarker && now - clickMarker.t < 600) {
      const k = (now - clickMarker.t) / 600;
      ctx.strokeStyle = `rgba(255,138,91,${1 - k})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(clickMarker.x, clickMarker.y, 10 + k * 18, 4 + k * 6, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // depth-sort everything that stands on the floor
    const items = [];
    for (const c of cats.values()) if (c.room === viewRoom) items.push({ c, p: posOf(c, now) });
    const ball = balls[viewRoom];
    if (ball) {
      const el = Math.min(0.08, (now - ball.at) / 1000);
      const tx = ball.x + ball.vx * el, ty = ball.y + ball.vy * el;
      const ox = ball.dx, oy = ball.dy;
      ball.dx += (tx - ball.dx) * 0.35; ball.dy += (ty - ball.dy) * 0.35;
      ball.rot += (ball.dx - ox) * 0.09 + (ball.dy - oy) * 0.03;
      items.push({ ball, p: { y: ball.dy } });
    }
    items.sort((a, b) => a.p.y - b.p.y);

    const sel = selectedCat();
    for (const it of items) {
      if (it.ball) { drawYarn(it.ball, now); continue; }
      const { c, p } = it;
      const s = depthScale(p.y);
      if (p.moving && Math.abs(c.anim.tx - c.anim.fx) > 2) c.face = c.anim.tx > c.anim.fx ? 1 : -1;
      const pose = !p.moving && c.pose && now < c.pose.until ? c.pose.kind : 'idle';
      let lift = 0;
      if (c.jump) {
        const k = (now - c.jump.start) / c.jump.dur;
        if (k >= 0 && k < 1) lift = Math.sin(k * Math.PI) * 42 * s; else if (k >= 1) c.jump = null;
      }
      if (sel && c.id === sel.id) {
        ctx.save(); ctx.strokeStyle = '#ffb703'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -t * 20;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 34 * s, 10 * s, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      drawCat(ctx, c.look, {
        x: p.x, y: p.y, scale: s, t: t + c.seed, seed: c.seed, face: c.face, walking: p.moving, pose, lift,
        mouthOpen: c.mouthUntil > now, happy: c.happyUntil > now,
      });
      c.hit = { x: p.x, y: p.y, s, lift };
      if (pose === 'sleep' && Math.random() < dt * 0.8) burst(c, '💤', 1, 10);

      // name tag
      const mine = c.ownerTag === me.tag;
      ctx.font = `bold ${Math.round(12 * s + 1)}px ui-rounded, sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(60,40,30,0.75)'; ctx.lineJoin = 'round';
      const label = mine ? '★ ' + c.name : c.name;
      ctx.strokeText(label, p.x, p.y + 17 * s);
      ctx.fillStyle = mine ? '#ffe08a' : '#fff'; ctx.fillText(label, p.x, p.y + 17 * s);
    }

    // particles
    ctx.textAlign = 'center';
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life += dt;
      if (q.life > q.max) { particles.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.97;
      ctx.globalAlpha = 1 - q.life / q.max;
      ctx.font = `${q.size}px serif`;
      ctx.fillText(q.emoji, q.x, q.y);
    }
    ctx.globalAlpha = 1;

    // speech bubbles on top
    for (const { c } of items) {
      if (!c || !c.bubble || !c.hit) continue;
      if (now > c.bubble.until) { c.bubble = null; continue; }
      drawBubble(c.hit.x, c.hit.y - 100 * c.hit.s - c.hit.lift, c.bubble.text);
    }

    requestAnimationFrame(frame);
  }

  // ---------- input on the canvas ----------
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  function hitCat(x, y) {
    let best = null;
    for (const c of cats.values()) {
      if (c.room !== viewRoom || !c.hit) continue;
      const { s, lift } = c.hit;
      const cx = c.hit.x, cy = c.hit.y - lift;
      if (x > cx - 30 * s && x < cx + 30 * s && y > cy - 98 * s && y < cy + 6 * s) {
        if (!best || c.hit.y > best.hit.y) best = c;
      }
    }
    return best;
  }
  function hitDoor(x, y) {
    return S.ROOMS[viewRoom].doors.find((d) => Math.abs(x - d.x) < 50 && y > d.y - 95 && y < d.y + 20);
  }

  canvas.addEventListener('pointermove', (e) => {
    const { x, y } = toWorld(e);
    canvas.style.cursor = hitCat(x, y) || hitDoor(x, y) ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = toWorld(e);
    const cat = hitCat(x, y);
    if (cat) { showPopup(cat); return; }
    hidePopup();
    const sel = selectedCat();
    if (!sel) {
      toast(myCats().length ? 'Pick one of your cats on the left first 🐾' : 'Adopt a cat first! 🐱');
      return;
    }
    if (sel.room !== viewRoom) {
      toast(`${sel.name} is in ${S.ROOMS[sel.room].name}. Use the buttons at the top to travel.`);
      return;
    }
    const door = hitDoor(x, y);
    if (door) { send({ t: 'door', id: sel.id, to: door.to }); clickMarker = { x: door.x, y: door.y, t: performance.now() }; return; }
    if (y < FLOOR.minY - 40) return;
    const tx = clamp(x, FLOOR.minX, FLOOR.maxX), ty = clamp(y, FLOOR.minY, FLOOR.maxY);
    clickMarker = { x: tx, y: ty, t: performance.now() };
    if (e.shiftKey) send({ t: 'herd', room: viewRoom, x: tx, y: ty });
    else send({ t: 'move', id: sel.id, x: tx, y: ty });
  });

  // ---------- popup when clicking a cat ----------
  const ACT_LABELS = {
    boop: '👃 Boop', play: '🧶 Play', groom: '✨ Groom', cuddle: '💞 Cuddle', pounce: '🐾 Pounce',
  };
  function showPopup(c) {
    popupId = c.id;
    const el = $('#popup');
    const sel = selectedCat();
    const mine = c.ownerTag === me.tag;
    let html = `<div class="pop-head"><div><b>${esc(c.name)}</b><small>${mine ? '★ your cat' : 'cat of ' + esc(c.ownerName)}</small></div><button class="x" data-close>×</button></div>`;
    if (mine && (!sel || sel.id !== c.id)) html += `<button class="primary wide" data-control>🎮 Control ${esc(c.name)}</button>`;
    if (sel && sel.id !== c.id) {
      const f = friends[friendKey(sel.id, c.id)] || 0;
      const hearts = f ? '💗'.repeat(Math.min(5, Math.ceil(f / 3))) : '🤍';
      html += `<div class="friend">${hearts} ${esc(sel.name)} & ${esc(c.name)}: ${f} friendship</div>`;
      html += `<div class="pop-actions">${S.INTERACTIONS.map((a) => `<button data-act="${a}">${ACT_LABELS[a]}</button>`).join('')}</div>`;
    } else if (sel && sel.id === c.id) {
      html += `<div class="hint">This is the cat you're playing. Click the ground to walk, or click another cat to play together!</div>`;
      html += `<button class="soft wide" style="margin-top:6px" data-edit>✏️ Change look</button>`;
    } else {
      html += `<div class="hint">Adopt a cat to play with ${esc(c.name)}!</div>`;
    }
    el.innerHTML = html;
    el.classList.remove('hidden');
    const { x, y, s, lift } = c.hit;
    el.style.left = clamp((x / W) * 100, 14, 86) + '%';
    el.style.top = Math.max(32, ((y - 100 * s - lift) / H) * 100) + '%';

    el.querySelector('[data-close]').onclick = hidePopup;
    const ctl = el.querySelector('[data-control]');
    if (ctl) ctl.onclick = () => { select(c.id); hidePopup(); };
    const ed = el.querySelector('[data-edit]');
    if (ed) ed.onclick = () => { hidePopup(); openCreator(c); };
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => { send({ t: 'act', id: sel.id, action: b.dataset.act, target: c.id }); hidePopup(); };
    });
  }
  function hidePopup() { popupId = null; $('#popup').classList.add('hidden'); }

  // ---------- sidebar & header ----------
  function select(id) {
    selectedId = id;
    localStorage.setItem('wt_selected', id);
    const c = cats.get(id);
    if (c) viewRoom = c.room;
    renderAll();
  }

  function drawMini(cv, look) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 52 * dpr; cv.height = 52 * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    drawCat(g, look, { x: 26, y: 50, scale: 0.47, t: 1 });
  }

  function renderMyCats() {
    const list = $('#myCats');
    const mine = myCats();
    $('#catCount').textContent = mine.length;
    list.innerHTML = '';
    if (!mine.length) { list.innerHTML = '<div class="empty">No cats yet.<br>Adopt your first one! 🐱</div>'; return; }
    for (const c of mine) {
      const item = document.createElement('div');
      item.className = 'catItem' + (c.id === selectedId ? ' selected' : '');
      const cv = document.createElement('canvas');
      drawMini(cv, c.look);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<b>${esc(c.name)}</b><small>${S.ROOMS[c.room].emoji} ${S.ROOMS[c.room].name}</small>`;
      const tools = document.createElement('div');
      tools.className = 'tools';
      tools.innerHTML = '<button title="Change look">✏️</button><button title="Say goodbye">🗑️</button>';
      const [editBtn, delBtn] = tools.children;
      editBtn.onclick = (e) => { e.stopPropagation(); openCreator(c); };
      delBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Say goodbye to ${c.name}? This can't be undone.`)) send({ t: 'delete', id: c.id });
      };
      item.append(cv, meta, tools);
      item.onclick = () => select(c.id);
      list.append(item);
    }
  }

  function renderRooms() {
    const nav = $('#rooms');
    nav.innerHTML = '';
    for (const id of S.ROOM_ORDER) {
      const r = S.ROOMS[id];
      const b = document.createElement('button');
      b.textContent = `${r.emoji} ${r.name}`;
      if (id === viewRoom) b.classList.add('active');
      b.onclick = () => {
        hidePopup();
        const sel = selectedCat();
        if (sel && sel.room !== id) send({ t: 'room', id: sel.id, room: id });
        else if (!sel) { viewRoom = id; renderAll(); }
      };
      nav.append(b);
    }
  }

  function renderOnline() {
    let here = 0;
    for (const c of cats.values()) if (c.room === viewRoom) here++;
    $('#online').textContent = `${onlineInfo.players} online · ${cats.size} cats in town`;
    $('#roomLabel').textContent = `${S.ROOMS[viewRoom].emoji} ${S.ROOMS[viewRoom].name} · ${here} 🐱`;
  }

  function renderSelected() {
    const sel = selectedCat();
    $('#selectedInfo').textContent = sel ? `Playing as ${sel.name}` : 'No cat selected';
    const off = !sel;
    document.querySelectorAll('#emotes button, #chatForm button, #chatInput').forEach((b) => (b.disabled = off));
  }

  function renderAll() { renderMyCats(); renderRooms(); renderOnline(); renderSelected(); }

  $('#newCat').onclick = () => openCreator();
  $('#summon').onclick = () => {
    if (!myCats().length) return toast('Adopt a cat first! 🐱');
    send({ t: 'summon', room: viewRoom });
    toast(`Calling all your cats to ${S.ROOMS[viewRoom].name}! 📣`);
  };
  document.querySelectorAll('#emotes button').forEach((b) => {
    b.onclick = () => { const sel = selectedCat(); if (sel) send({ t: 'act', id: sel.id, action: b.dataset.act }); };
  });
  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const sel = selectedCat();
    const input = $('#chatInput');
    if (sel && input.value.trim()) send({ t: 'say', id: sel.id, text: input.value.trim() });
    input.value = '';
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement === document.body) { $('#chatInput').focus(); e.preventDefault(); }
    if (e.key === 'Escape') { hidePopup(); closeCreator(); }
  });

  // ---------- cat creator ----------
  const NAMES = ['Mochi', 'Luna', 'Biscuit', 'Pepper', 'Noodle', 'Tofu', 'Ziggy', 'Pumpkin', 'Miso', 'Olive', 'Waffles',
    'Pickle', 'Bean', 'Clover', 'Mango', 'Sprinkles', 'Churro', 'Pistachio', 'Nube', 'Canela', 'Galleta', 'Michi'];
  const LABELS = {
    solid: 'Solid', tabby: 'Tabby', spots: 'Spots', tuxedo: 'Tuxedo', calico: 'Calico', siamese: 'Siamese',
    none: 'None', bow: '🎀 Bow', tophat: '🎩 Top hat', crown: '👑 Crown', scarf: '🧣 Scarf', flower: '🌸 Flower',
    glasses: '👓 Glasses', beanie: '🧢 Beanie', bandana: 'Bandana', collar: '🔔 Bell',
  };
  const PALETTES = { fur: S.FUR_COLORS, patternColor: S.PATTERN_COLORS, eyes: S.EYE_COLORS, accColor: S.ACC_COLORS };
  let draft = null, editingId = null, previewRaf = null;

  function randomLook() {
    return {
      fur: pick(S.FUR_COLORS), pattern: pick(S.PATTERNS), patternColor: pick(S.PATTERN_COLORS),
      eyes: pick(S.EYE_COLORS), accessory: pick(S.ACCESSORIES), accColor: pick(S.ACC_COLORS),
    };
  }

  function buildCreatorControls() {
    document.querySelectorAll('#creator .swatches').forEach((box) => {
      const key = box.dataset.key;
      box.innerHTML = '';
      for (const col of PALETTES[key]) {
        const b = document.createElement('button');
        b.style.background = col;
        b.title = col;
        if (draft[key] === col) b.classList.add('on');
        b.onclick = () => { draft[key] = col; buildCreatorControls(); };
        box.append(b);
      }
      const custom = document.createElement('input');
      custom.type = 'color'; custom.value = draft[key]; custom.title = 'Pick any color';
      custom.oninput = () => { draft[key] = custom.value; box.querySelectorAll('button').forEach((x) => x.classList.remove('on')); };
      box.append(custom);
    });
    document.querySelectorAll('#creator .chips').forEach((box) => {
      const key = box.dataset.key;
      const opts = key === 'pattern' ? S.PATTERNS : S.ACCESSORIES;
      box.innerHTML = '';
      for (const v of opts) {
        const b = document.createElement('button');
        b.textContent = LABELS[v] || v;
        if (draft[key] === v) b.classList.add('on');
        b.onclick = () => { draft[key] = v; buildCreatorControls(); };
        box.append(b);
      }
    });
  }

  function openCreator(cat) {
    hidePopup();
    editingId = cat ? cat.id : null;
    draft = cat ? { ...cat.look } : randomLook();
    if (!cat) draft.accessory = Math.random() < 0.4 ? 'none' : draft.accessory;
    $('#cName').value = cat ? cat.name : pick(NAMES);
    $('#creatorTitle').textContent = cat ? `Change ${cat.name}'s look` : 'Adopt a new cat';
    $('#cSave').textContent = cat ? 'Save' : 'Adopt! 🐾';
    buildCreatorControls();
    $('#creator').classList.remove('hidden');
    cancelAnimationFrame(previewRaf);
    const pv = $('#preview'), dpr = Math.min(2, window.devicePixelRatio || 1);
    pv.width = 240 * dpr; pv.height = 240 * dpr;
    const g = pv.getContext('2d');
    const loop = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, 240, 240);
      drawCat(g, draft, { x: 120, y: 215, scale: 1.85, t: performance.now() / 1000, seed: 1 });
      previewRaf = requestAnimationFrame(loop);
    };
    loop();
  }
  function closeCreator() {
    $('#creator').classList.add('hidden');
    cancelAnimationFrame(previewRaf);
  }
  $('#cRandom').onclick = () => { draft = randomLook(); $('#cName').value = pick(NAMES); buildCreatorControls(); };
  $('#cCancel').onclick = closeCreator;
  $('#cSave').onclick = () => {
    const name = $('#cName').value.trim() || pick(NAMES);
    if (editingId) send({ t: 'update', id: editingId, name, look: draft });
    else send({ t: 'create', name, look: draft, room: viewRoom });
    closeCreator();
    toast(editingId ? 'Looking good! ✨' : `Welcome to town, ${name}! 🎉`);
  };

  // ---------- welcome screen ----------
  function welcomeArt() {
    const cv = $('#welcomeCats'), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 420 * dpr; cv.height = 140 * dpr;
    const g = cv.getContext('2d');
    const looks = [0, 1, 2, 3, 4].map(() => randomLook());
    const loop = () => {
      if ($('#nameModal').classList.contains('hidden')) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, 420, 140);
      looks.forEach((l, i) => drawCat(g, l, { x: 50 + i * 80, y: 132, scale: 1.05, t: performance.now() / 1000 + i, seed: i, face: i % 2 ? -1 : 1, pose: i === 2 ? 'dance' : 'idle' }));
      requestAnimationFrame(loop);
    };
    loop();
  }

  function start() {
    $('#nameModal').classList.add('hidden');
    connect();
  }
  $('#nameForm').onsubmit = (e) => {
    e.preventDefault();
    const n = $('#playerName').value.trim().slice(0, 16);
    if (!n) return;
    me.name = n;
    localStorage.setItem('wt_name', n);
    start();
  };

  // ---------- boot ----------
  fitCanvas();
  renderAll();
  requestAnimationFrame(frame);
  if (me.name) start();
  else { welcomeArt(); setTimeout(() => $('#playerName').focus(), 50); }
})();
