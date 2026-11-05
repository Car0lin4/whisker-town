// Draws a cute cat from its "look". Origin (o.x, o.y) is the spot between its feet.
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, amt) {
    let [r, g, b] = hexToRgb(hex);
    if (amt < 0) { const k = 1 + amt; r *= k; g *= k; b *= k; }
    else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  function ell(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); }
  function paint(ctx, fill, stroke) {
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function drawCat(ctx, look, o) {
    const t = o.t || 0, s = o.scale || 1, face = o.face || 1, pose = o.pose || 'idle';
    const fur = look.fur, pc = look.patternColor, pat = look.pattern;
    const line = shade(fur, -0.5);
    const white = '#fbfaf5';
    const sleeping = pose === 'sleep';
    const happy = o.happy || pose === 'cuddle';
    const lift = o.lift || 0;

    ctx.save();
    ctx.translate(o.x, o.y);

    // shadow on the ground
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ell(ctx, 0, 0, Math.max(12, 26 - lift * 0.2) * s * (sleeping ? 1.3 : 1), 7 * s);
    ctx.fill();

    ctx.translate(0, -lift);
    ctx.scale(s * face, s);

    let bob = Math.sin(t * 2) * 0.8, tilt = 0;
    if (o.walking) bob = -Math.abs(Math.sin(t * 11)) * 3;
    else if (pose === 'dance') { bob = -Math.abs(Math.sin(t * 7)) * 7; tilt = Math.sin(t * 7) * 0.22; }
    ctx.translate(0, bob);
    if (tilt) { ctx.translate(0, -30); ctx.rotate(tilt); ctx.translate(0, 30); }
    if (sleeping) ctx.scale(1.12, 0.8);

    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = 2.2; ctx.strokeStyle = line;

    const tipColor = pat === 'siamese' ? pc : pat === 'tuxedo' ? white : null;
    const drawTail = () => {
      const sway = Math.sin(t * (o.walking ? 7 : 2.4) + (o.seed || 0)) * 7;
      let tipX, tipY;
      ctx.beginPath();
      if (sleeping) {
        ctx.moveTo(16, -10); ctx.quadraticCurveTo(30, 4, 0, 4); ctx.quadraticCurveTo(-16, 4, -24, -3);
        tipX = -24; tipY = -3;
      } else {
        ctx.moveTo(12, -18); ctx.bezierCurveTo(34, -14, 38 + sway * 0.4, -38, 30 + sway, -60);
        tipX = 30 + sway; tipY = -60;
      }
      ctx.strokeStyle = line; ctx.lineWidth = 11; ctx.stroke();
      ctx.strokeStyle = fur; ctx.lineWidth = 6.6; ctx.stroke();
      if (tipColor) { ell(ctx, tipX, tipY, 3.4, 3.4); ctx.fillStyle = tipColor; ctx.fill(); }
      ctx.lineWidth = 2.2; ctx.strokeStyle = line;
    };

    if (!sleeping) drawTail();

    // body
    ell(ctx, 0, -26, 21, 21); paint(ctx, fur, line);

    // paws
    if (!sleeping) {
      const pawColor = pat === 'tuxedo' ? white : pat === 'siamese' ? pc : fur;
      const step = o.walking ? Math.sin(t * 11) : 0;
      ell(ctx, -9, -4 - Math.max(0, step) * 4, 7, 5); paint(ctx, pawColor, line);
      ell(ctx, 9, -4 - Math.max(0, -step) * 4, 7, 5); paint(ctx, pawColor, line);
    } else {
      drawTail();
    }

    // ears
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * 25, -66); ctx.lineTo(sx * 21, -94); ctx.lineTo(sx * 5, -80); ctx.closePath();
      paint(ctx, pat === 'siamese' ? pc : fur, line);
      ctx.beginPath();
      ctx.moveTo(sx * 20, -72); ctx.lineTo(sx * 19, -88); ctx.lineTo(sx * 10, -79); ctx.closePath();
      ctx.fillStyle = '#f6a5b5'; ctx.fill();
    }

    // head
    ell(ctx, 0, -60, 27, 23); paint(ctx, fur, line);

    // fur pattern (clipped to head + body)
    if (pat !== 'solid') {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(21, -26); ctx.ellipse(0, -26, 21, 21, 0, 0, TAU);
      ctx.moveTo(27, -60); ctx.ellipse(0, -60, 27, 23, 0, 0, TAU);
      ctx.clip();
      ctx.fillStyle = pc; ctx.strokeStyle = pc;
      if (pat === 'tabby') {
        ctx.lineWidth = 3.4;
        const lines = [[0, -83, 0, -73], [-7, -82, -5, -74], [7, -82, 5, -74],
          [-28, -63, -19, -61], [-28, -56, -20, -56], [28, -63, 19, -61], [28, -56, 20, -56],
          [-22, -32, -12, -29], [-23, -22, -12, -21], [-22, -12, -12, -13],
          [22, -32, 12, -29], [23, -22, 12, -21], [22, -12, 12, -13]];
        ctx.beginPath();
        for (const [a, b, c, d] of lines) { ctx.moveTo(a, b); ctx.lineTo(c, d); }
        ctx.stroke();
      } else if (pat === 'spots') {
        for (const [x, y, r] of [[-13, -73, 5], [15, -75, 4], [-21, -54, 3.5], [-13, -30, 6], [12, -18, 5], [4, -34, 3.5], [-6, -12, 4], [17, -34, 3.5]]) {
          ell(ctx, x, y, r, r); ctx.fill();
        }
      } else if (pat === 'tuxedo') {
        ctx.fillStyle = white;
        ell(ctx, 0, -20, 12, 17); ctx.fill();
        ell(ctx, 0, -48, 12, 8.5); ctx.fill();
      } else if (pat === 'calico') {
        const dark = '#3a2a22';
        ctx.fillStyle = pc; ell(ctx, -16, -71, 14, 11); ctx.fill();
        ctx.fillStyle = dark; ell(ctx, 18, -75, 11, 9); ctx.fill();
        ctx.fillStyle = pc; ell(ctx, 14, -25, 12, 11); ctx.fill();
        ctx.fillStyle = dark; ell(ctx, -13, -15, 10, 9); ctx.fill();
      } else if (pat === 'siamese') {
        ctx.globalAlpha = 0.9;
        ell(ctx, 0, -53, 15, 12); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.lineWidth = 2.2; ctx.strokeStyle = line;
      ell(ctx, 0, -60, 27, 23); ctx.stroke();
    }

    // cheeks
    ctx.fillStyle = 'rgba(255,120,150,0.33)';
    ell(ctx, -17, -50, 4.5, 3.5); ctx.fill();
    ell(ctx, 17, -50, 4.5, 3.5); ctx.fill();

    // eyes
    const blink = (t + (o.seed || 0) * 3) % 4.2 < 0.13;
    const eyeLine = shade(fur, -0.65);
    for (const sx of [-1, 1]) {
      const ex = sx * 10;
      ctx.lineWidth = 2.2; ctx.strokeStyle = eyeLine === line ? line : '#2a1f1a';
      if (sleeping) { ctx.beginPath(); ctx.arc(ex, -62, 4.5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
      else if (happy) { ctx.beginPath(); ctx.arc(ex, -58, 4.5, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke(); }
      else if (blink) { ctx.beginPath(); ctx.moveTo(ex - 4.5, -60); ctx.lineTo(ex + 4.5, -60); ctx.stroke(); }
      else {
        ctx.lineWidth = 1.2;
        ell(ctx, ex, -60, 5, 6.5); paint(ctx, look.eyes, '#2a1f1a');
        ell(ctx, ex + 0.5, -59.5, 2.2, 4.6); ctx.fillStyle = '#16110e'; ctx.fill();
        ell(ctx, ex + 1.8, -62.6, 1.6, 1.6); ctx.fillStyle = '#fff'; ctx.fill();
      }
    }

    // nose + mouth
    ctx.beginPath(); ctx.moveTo(-3, -51.5); ctx.lineTo(3, -51.5); ctx.lineTo(0, -48.5); ctx.closePath();
    ctx.fillStyle = '#f28ca0'; ctx.fill();
    ctx.strokeStyle = '#3a2a22'; ctx.lineWidth = 1.4;
    if (o.mouthOpen) {
      ell(ctx, 0, -44.5, 3.2, 3.4); paint(ctx, '#7a2c3a', '#3a2a22');
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -48.5); ctx.quadraticCurveTo(-1, -44.5, -5, -45.5);
      ctx.moveTo(0, -48.5); ctx.quadraticCurveTo(1, -44.5, 5, -45.5);
      ctx.stroke();
    }

    // whiskers
    ctx.strokeStyle = 'rgba(60,40,30,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const sx of [-1, 1]) {
      ctx.moveTo(sx * 13, -50); ctx.lineTo(sx * 34, -54);
      ctx.moveTo(sx * 13, -48); ctx.lineTo(sx * 34, -47);
      ctx.moveTo(sx * 13, -46); ctx.lineTo(sx * 32, -41);
    }
    ctx.stroke();

    drawAccessory(ctx, look.accessory, look.accColor);
    ctx.restore();
  }

  function drawAccessory(ctx, acc, ac) {
    if (!acc || acc === 'none') return;
    const dark = shade(ac, -0.4);
    ctx.lineWidth = 1.6; ctx.strokeStyle = dark;
    switch (acc) {
      case 'bow': {
        ctx.beginPath(); ctx.moveTo(15, -83); ctx.lineTo(5, -91); ctx.lineTo(5, -75); ctx.closePath(); paint(ctx, ac, dark);
        ctx.beginPath(); ctx.moveTo(15, -83); ctx.lineTo(25, -91); ctx.lineTo(25, -75); ctx.closePath(); paint(ctx, ac, dark);
        ell(ctx, 15, -83, 3.2, 3.2); paint(ctx, shade(ac, 0.25), dark);
        break;
      }
      case 'tophat': {
        const hat = '#2b2b2b';
        ctx.beginPath(); ctx.rect(-13, -110, 26, 26); paint(ctx, hat, '#111');
        ctx.fillStyle = ac; ctx.fillRect(-13, -92, 26, 5);
        ell(ctx, 0, -84, 22, 4.5); paint(ctx, hat, '#111');
        break;
      }
      case 'crown': {
        ctx.beginPath();
        ctx.moveTo(-14, -81); ctx.lineTo(-15, -97); ctx.lineTo(-7, -88); ctx.lineTo(0, -101);
        ctx.lineTo(7, -88); ctx.lineTo(15, -97); ctx.lineTo(14, -81); ctx.closePath();
        paint(ctx, '#ffd23f', '#b8860b');
        ell(ctx, 0, -87, 2.8, 2.8); paint(ctx, ac, dark);
        break;
      }
      case 'scarf': {
        ctx.save(); ctx.translate(9, -36); ctx.rotate(0.25);
        ctx.beginPath(); ctx.roundRect(-4, 0, 9, 22, 3); paint(ctx, ac, dark);
        ctx.restore();
        ctx.beginPath(); ctx.roundRect(-20, -42, 40, 10, 5); paint(ctx, ac, dark);
        ctx.strokeStyle = shade(ac, 0.4); ctx.lineWidth = 2;
        ctx.beginPath(); for (const x of [-12, -4, 4, 12]) { ctx.moveTo(x, -41); ctx.lineTo(x, -33); } ctx.stroke();
        break;
      }
      case 'flower': {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU;
          ell(ctx, -16 + Math.cos(a) * 5, -82 + Math.sin(a) * 5, 4, 4); paint(ctx, ac, dark);
        }
        ell(ctx, -16, -82, 3, 3); paint(ctx, '#ffd23f', '#d4a017');
        break;
      }
      case 'glasses': {
        ctx.lineWidth = 2.2; ctx.strokeStyle = ac === '#ffffff' ? '#ccc' : ac;
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        for (const sx of [-1, 1]) { ell(ctx, sx * 10, -60, 8.5, 8); ctx.fill(); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(-1.5, -61); ctx.lineTo(1.5, -61); ctx.stroke();
        break;
      }
      case 'beanie': {
        ctx.beginPath(); ctx.arc(0, -73, 24, Math.PI, 0); ctx.closePath(); paint(ctx, ac, dark);
        ctx.beginPath(); ctx.roundRect(-26, -76, 52, 8, 4); paint(ctx, shade(ac, -0.15), dark);
        ell(ctx, 0, -98, 5.5, 5.5); paint(ctx, '#fdfdfd', '#bbb');
        break;
      }
      case 'bandana': {
        ctx.beginPath(); ctx.moveTo(-17, -40); ctx.lineTo(17, -40); ctx.lineTo(0, -24); ctx.closePath(); paint(ctx, ac, dark);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        for (const [x, y] of [[-8, -37], [6, -36], [0, -31]]) { ell(ctx, x, y, 1.5, 1.5); ctx.fill(); }
        break;
      }
      case 'collar': {
        ctx.beginPath(); ctx.roundRect(-17, -41, 34, 5, 2.5); paint(ctx, ac, dark);
        ell(ctx, 0, -33, 4.5, 4.5); paint(ctx, '#ffd23f', '#b8860b');
        ctx.beginPath(); ctx.moveTo(-2, -32); ctx.lineTo(2, -32); ctx.stroke();
        break;
      }
    }
  }

  root.CatDraw = { drawCat, shade };
})(this);
