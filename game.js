(() => {
  'use strict';

  const W = 480;
  const H = 760;
  const TAU = Math.PI * 2;
  const SLING = { x: 240, y: 620, pull: 82 };
  const COLORS = {
    red: { fill: '#ff4d58', dark: '#c92b3b', light: '#ff9aa1', points: 10 },
    blue: { fill: '#398cff', dark: '#1761c7', light: '#94c4ff', points: 20 },
    gold: { fill: '#ffc83d', dark: '#d99005', light: '#fff09a', points: 50 }
  };
  const LEVELS = [
    { target: 5, shots: 11, speed: 24, active: 3, gold: 0.05, blue: 0.20 },
    { target: 7, shots: 13, speed: 29, active: 3, gold: 0.07, blue: 0.25 },
    { target: 9, shots: 15, speed: 34, active: 4, gold: 0.08, blue: 0.30 },
    { target: 11, shots: 17, speed: 39, active: 4, gold: 0.10, blue: 0.34 },
    { target: 13, shots: 19, speed: 44, active: 5, gold: 0.11, blue: 0.38 },
    { target: 15, shots: 21, speed: 49, active: 5, gold: 0.12, blue: 0.42 },
    { target: 17, shots: 23, speed: 55, active: 6, gold: 0.14, blue: 0.45 },
    { target: 19, shots: 25, speed: 61, active: 6, gold: 0.15, blue: 0.48 },
    { target: 21, shots: 28, speed: 68, active: 7, gold: 0.17, blue: 0.51 },
    { target: 24, shots: 31, speed: 76, active: 7, gold: 0.20, blue: 0.54 }
  ];

  let canvas = null;
  let ctx = null;
  let resizeObserver = null;
  let raf = 0;
  let lastTime = 0;
  let idleTime = 0;
  let pendingStart = false;
  let audioCtx = null;
  let masterGain = null;

  const game = {
    screen: 'idle', level: 0, score: 0, highScore: safeNumber('gulelHighScore'),
    shots: 0, popped: 0, target: 0, combo: 0, comboClock: 0,
    sound: safeBool('gulelSound', true), balloons: [], projectiles: [], particles: [],
    dragging: false, pullX: SLING.x, pullY: SLING.y + 10, shake: 0,
    spawnClock: 0, levelClock: 0, transitionClock: 0, visibilityPaused: false
  };

  function safeNumber(key) {
    try { return Math.max(0, Number(localStorage.getItem(key)) || 0); } catch (_) { return 0; }
  }
  function safeBool(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v === 'true'; } catch (_) { return fallback; }
  }
  function safeSet(key, value) { try { localStorage.setItem(key, String(value)); } catch (_) {} }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function emitState() {
    window.dispatchEvent(new CustomEvent('gulel:state', { detail: {
      score: game.score, highScore: game.highScore, level: game.level + 1,
      shots: game.shots, popped: game.popped, target: game.target,
      combo: game.combo, sound: game.sound
    }}));
  }
  function emitScreen(screen = game.screen) {
    window.dispatchEvent(new CustomEvent('gulel:screen', { detail: {
      screen, score: game.score, level: game.level + 1, highScore: game.highScore
    }}));
  }

  function setupCanvas() {
    if (canvas && canvas.isConnected) return true;
    canvas = document.getElementById('gameCanvas');
    if (!canvas) return false;
    ctx = canvas.getContext('2d', { alpha: false });
    canvas.style.touchAction = 'none';
    if (!canvas.style.aspectRatio) canvas.style.aspectRatio = `${W} / ${H}`;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const cssW = r.width || W;
      const cssH = r.height || H;
      const bw = Math.max(1, Math.round(cssW * dpr));
      const bh = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    };
    resize();
    resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (resizeObserver) resizeObserver.observe(canvas);
    else window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('keydown', keyDown);
    document.addEventListener('visibilitychange', visibilityChanged);
    if (!raf) raf = requestAnimationFrame(frame);
    return true;
  }

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  function canAim() { return game.screen === 'playing' && game.shots > 0 && game.projectiles.length === 0 && !game.transitionClock; }
  function pointerDown(e) {
    if (!canAim()) return;
    const p = canvasPoint(e);
    if (Math.hypot(p.x - game.pullX, p.y - game.pullY) > 48 && Math.hypot(p.x - SLING.x, p.y - SLING.y) > 48) return;
    initAudio();
    game.dragging = true;
    canvas.setPointerCapture?.(e.pointerId);
    setPull(p);
    e.preventDefault();
  }
  function pointerMove(e) { if (game.dragging) { setPull(canvasPoint(e)); e.preventDefault(); } }
  function pointerUp(e) {
    if (!game.dragging) return;
    game.dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
    const power = Math.hypot(game.pullX - SLING.x, game.pullY - SLING.y);
    if (power > 14) shoot(game.pullX, game.pullY);
    else resetPull();
    e.preventDefault();
  }
  function pointerCancel() { game.dragging = false; resetPull(); }
  function setPull(p) {
    let dx = p.x - SLING.x;
    let dy = Math.max(10, p.y - SLING.y); // stone always below the fork, so release always rises
    const d = Math.hypot(dx, dy);
    if (d > SLING.pull) { dx *= SLING.pull / d; dy *= SLING.pull / d; }
    game.pullX = SLING.x + dx;
    game.pullY = SLING.y + dy;
  }
  function resetPull() { game.pullX = SLING.x; game.pullY = SLING.y + 10; }
  function keyDown(e) {
    if (e.code !== 'Space' || e.repeat || !canAim()) return;
    e.preventDefault();
    initAudio();
    shoot(SLING.x + rand(-10, 10), SLING.y + 72);
  }
  function visibilityChanged() {
    if (document.hidden && game.screen === 'playing') {
      game.visibilityPaused = true;
      pause();
    } else if (!document.hidden && game.visibilityPaused && game.screen === 'paused') {
      game.visibilityPaused = false;
      resume();
    }
  }

  function initAudio() {
    if (!game.sound || audioCtx) { if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {}); return; }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.16;
      masterGain.connect(audioCtx.destination);
    } catch (_) { audioCtx = null; }
  }
  function tone(freq, duration, type = 'sine', slide = 1, volume = 1, delay = 0) {
    if (!game.sound) return;
    initAudio();
    if (!audioCtx || !masterGain) return;
    const now = audioCtx.currentTime + delay;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, now); o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), now + duration);
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(volume, now + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    o.connect(g); g.connect(masterGain); o.start(now); o.stop(now + duration + 0.02);
  }
  function soundShoot() { tone(210, .16, 'triangle', 2.1, .7); tone(100, .12, 'sine', .7, .35); }
  function soundPop(color) { const f = color === 'gold' ? 720 : color === 'blue' ? 500 : 390; tone(f, .1, 'sine', 1.8, .8); tone(f * 1.7, .08, 'triangle', .75, .4, .035); }
  function soundWin() { [0, .11, .22, .36].forEach((d, i) => tone([440, 554, 659, 880][i], .24, 'sine', 1.02, .55, d)); }
  function soundLose() { tone(240, .32, 'sawtooth', .45, .35); }

  function start() {
    if (!setupCanvas()) { pendingStart = true; return; }
    pendingStart = false;
    game.score = 0;
    game.level = 0;
    beginLevel();
  }
  function restart() { start(); }
  function beginLevel() {
    const cfg = LEVELS[game.level];
    game.screen = 'playing';
    game.shots = cfg.shots; game.popped = 0; game.target = cfg.target;
    game.combo = 0; game.comboClock = 0; game.balloons.length = 0;
    game.projectiles.length = 0; game.particles.length = 0;
    game.spawnClock = 0; game.levelClock = 0; game.transitionClock = 0;
    game.dragging = false; game.shake = 0; resetPull();
    // Seed the first wave on-screen; later waves enter from below the meadow.
    for (let i = 0; i < Math.min(3, cfg.active); i++) spawnBalloon(-210 - i * 82);
    emitState(); emitScreen();
  }
  function nextLevel() {
    if (game.screen !== 'levelComplete') return;
    game.level++;
    if (game.level >= LEVELS.length) { game.level = LEVELS.length - 1; game.screen = 'victory'; emitScreen(); return; }
    beginLevel();
  }
  function pause() {
    if (game.screen !== 'playing') return;
    game.screen = 'paused'; game.dragging = false; resetPull();
    emitScreen();
  }
  function resume() {
    if (game.screen !== 'paused') return;
    game.screen = 'playing'; lastTime = performance.now(); emitScreen();
  }
  function toggleSound() {
    game.sound = !game.sound; safeSet('gulelSound', game.sound);
    if (game.sound) { initAudio(); tone(520, .09, 'sine', 1.3, .5); }
    emitState(); return game.sound;
  }

  function shoot(x, y) {
    if (!canAim()) return;
    const dx = SLING.x - x;
    const dy = SLING.y - y;
    game.projectiles.push({ x, y, px: x, py: y, vx: dx * 7.15, vy: dy * 7.15, r: 9, age: 0, trail: [] });
    game.shots--; game.dragging = false; resetPull(); soundShoot(); emitState();
  }

  function chooseColor() {
    const cfg = LEVELS[game.level];
    const r = Math.random();
    return r < cfg.gold ? 'gold' : r < cfg.gold + cfg.blue ? 'blue' : 'red';
  }
  function spawnBalloon(delay = 0) {
    const cfg = LEVELS[game.level] || LEVELS[0];
    const r = rand(18, 23);
    game.balloons.push({
      x: rand(42, W - 42), y: H + 70 + delay, px: 0, py: 0, r,
      vy: -(cfg.speed * rand(.82, 1.18)), phase: rand(0, TAU), sway: rand(22, 45),
      color: chooseColor(), age: rand(0, 4), bob: rand(.75, 1.35), hit: false
    });
  }

  function update(dt) {
    idleTime += dt;
    if (game.screen !== 'playing') {
      updateParticles(dt);
      if (game.transitionClock > 0) finishTransition(dt);
      return;
    }
    game.levelClock += dt;
    if (game.combo > 0) {
      game.comboClock -= dt;
      if (game.comboClock <= 0) { game.combo = 0; game.comboClock = 0; emitState(); }
    }
    const cfg = LEVELS[game.level];
    game.spawnClock -= dt;
    const living = game.balloons.filter(b => !b.hit).length;
    if (living < cfg.active && game.spawnClock <= 0 && game.popped < game.target) {
      spawnBalloon(rand(0, 40)); game.spawnClock = Math.max(.28, 1.05 - game.level * .055);
    }
    updateBalloons(dt);
    updateProjectiles(dt);
    updateParticles(dt);
    game.shake = Math.max(0, game.shake - dt * 22);
    // A final required pop always wins before the exhausted-shot check.
    if (game.popped >= game.target && game.screen === 'playing') completeLevel();
    else if (game.shots <= 0 && game.projectiles.length === 0 && game.screen === 'playing') gameOver();
  }

  function updateBalloons(dt) {
    for (let i = game.balloons.length - 1; i >= 0; i--) {
      const b = game.balloons[i];
      b.px = b.x; b.py = b.y; b.age += dt;
      b.y += b.vy * dt;
      b.x += Math.sin(b.age * b.bob + b.phase) * b.sway * dt;
      b.x = clamp(b.x, 25, W - 25);
      if (b.y < -100 || b.hit) game.balloons.splice(i, 1);
    }
  }

  function updateProjectiles(dt) {
    for (let i = game.projectiles.length - 1; i >= 0; i--) {
      const p = game.projectiles[i];
      p.px = p.x; p.py = p.y; p.age += dt;
      p.vy += 275 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(.996, dt * 60);
      p.trail.push({ x: p.x, y: p.y, life: .38 });
      if (p.trail.length > 12) p.trail.shift();
      let struck = false;
      for (let j = game.balloons.length - 1; j >= 0; j--) {
        const b = game.balloons[j];
        if (!b.hit && sweptHit(p, b)) { popBalloon(b, p); struck = true; break; }
      }
      if (struck || p.y > H + 50 || p.y < -80 || p.x < -70 || p.x > W + 70 || p.age > 5.5) {
        game.projectiles.splice(i, 1);
      }
    }
  }

  function sweptHit(p, b) {
    // Segment test in relative motion space prevents tunnelling through moving targets.
    const ax = p.px - (b.px || b.x), ay = p.py - (b.py || b.y);
    const bx = p.x - b.x, by = p.y - b.y;
    const dx = bx - ax, dy = by - ay;
    const t = clamp(-(ax * dx + ay * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(ax + dx * t, ay + dy * t) <= p.r + b.r * .88;
  }

  function popBalloon(b, p) {
    b.hit = true;
    const base = COLORS[b.color].points;
    game.combo = game.comboClock > 0 ? game.combo + 1 : 1;
    game.comboClock = 1.85;
    game.score += base * Math.min(5, game.combo);
    game.popped++;
    if (game.score > game.highScore) { game.highScore = game.score; safeSet('gulelHighScore', game.highScore); }
    game.shake = Math.min(9, 3 + game.combo);
    burst(b.x, b.y, b.color, base);
    soundPop(b.color);
    p.vx *= .2; p.vy *= .2;
    emitState();
  }

  function burst(x, y, color, points) {
    const c = COLORS[color];
    for (let i = 0; i < 18; i++) {
      const a = rand(0, TAU), s = rand(50, 210);
      game.particles.push({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 35, life: rand(.45, .9), max: .9, color: i % 3 ? c.fill : c.light, size: rand(2, 6) });
    }
    game.particles.push({ type: 'text', x, y: y - 8, vx: 0, vy: -42, life: .8, max: .8, text: `+${points * Math.min(5, game.combo)}`, color: c.fill });
  }
  function updateParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i]; p.life -= dt;
      if (p.life <= 0) { game.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'spark') { p.vy += 210 * dt; p.vx *= .985; }
    }
  }

  function completeLevel() {
    game.projectiles.length = 0;
    game.transitionClock = .65;
    game.screen = game.level === LEVELS.length - 1 ? 'victoryPending' : 'completePending';
    soundWin();
  }
  function gameOver() { game.screen = 'gameOver'; soundLose(); emitScreen(); }
  function finishTransition(dt) {
    game.transitionClock -= dt;
    if (game.transitionClock > 0) return;
    game.transitionClock = 0;
    game.screen = game.screen === 'victoryPending' ? 'victory' : 'levelComplete';
    emitScreen();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.034, lastTime ? (now - lastTime) / 1000 : .016);
    lastTime = now;
    update(dt);
    draw();
  }

  function draw() {
    if (!ctx || !canvas) return;
    const sx = canvas.width / W, sy = canvas.height / H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (game.shake) ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
    drawSky();
    drawDecor();
    if (game.screen === 'idle') drawIdle();
    else {
      game.balloons.forEach(drawBalloon);
      game.projectiles.forEach(drawProjectile);
      drawSlingshot();
      game.particles.forEach(drawParticle);
    }
    ctx.restore();
  }
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#67c8f4'); g.addColorStop(.57, '#c4f0ff'); g.addColorStop(1, '#fff2c4');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = .18;
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 5; i++) { const x = ((i * 131 + idleTime * (i % 2 ? 3 : -2)) % 580) - 50; const y = 95 + i * 58; cloud(x, y, .7 + (i % 3) * .13); }
    ctx.globalAlpha = 1;
  }
  function cloud(x, y, s) {
    ctx.beginPath(); ctx.ellipse(x, y + 8 * s, 45 * s, 14 * s, 0, 0, TAU); ctx.ellipse(x - 25 * s, y + 8 * s, 23 * s, 12 * s, 0, 0, TAU); ctx.ellipse(x + 22 * s, y + 5 * s, 28 * s, 15 * s, 0, 0, TAU); ctx.fill();
  }
  function drawDecor() {
    // distant hills
    ctx.fillStyle = '#9ad685'; ctx.beginPath(); ctx.moveTo(0, 573); ctx.quadraticCurveTo(65, 490, 145, 555); ctx.quadraticCurveTo(235, 465, 330, 550); ctx.quadraticCurveTo(420, 480, 520, 550); ctx.lineTo(520, 760); ctx.lineTo(0, 760); ctx.fill();
    ctx.fillStyle = '#68bd70'; ctx.beginPath(); ctx.moveTo(0, 625); ctx.quadraticCurveTo(95, 555, 195, 635); ctx.quadraticCurveTo(310, 540, 500, 620); ctx.lineTo(500, 760); ctx.lineTo(0, 760); ctx.fill();
    // tufts and flowers
    for (let i = 0; i < 15; i++) { const x = (i * 53 + 17) % 490; const y = 635 + (i % 4) * 18; ctx.strokeStyle = i % 2 ? '#348d54' : '#277f53'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + 20); ctx.quadraticCurveTo(x - 4, y + 5, x - 10, y); ctx.moveTo(x, y + 20); ctx.quadraticCurveTo(x + 4, y + 5, x + 10, y - 1); ctx.stroke(); }
    ctx.fillStyle = '#fff09a'; ctx.globalAlpha = .45; ctx.beginPath(); ctx.arc(70, 112, 38, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }
  function drawIdle() {
    const t = idleTime;
    for (let i = 0; i < 5; i++) drawBalloon({ x: 75 + i * 82, y: 260 + Math.sin(t * 1.2 + i) * 22, r: 21, color: ['red', 'blue', 'gold', 'blue', 'red'][i], phase: i, age: t, bob: 1, sway: 0 });
    drawSlingshot();
  }
  function drawBalloon(b) {
    const c = COLORS[b.color]; const r = b.r;
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.strokeStyle = 'rgba(73,83,91,.58)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, r * .8); ctx.quadraticCurveTo(Math.sin((b.age || 0) * 1.7) * 5, r + 27, Math.cos((b.phase || 0)) * 4, r + 50); ctx.stroke();
    ctx.fillStyle = c.dark; ctx.beginPath(); ctx.moveTo(-5, r * .65); ctx.lineTo(0, r * 1.02); ctx.lineTo(5, r * .65); ctx.closePath(); ctx.fill();
    const g = ctx.createRadialGradient(-r * .35, -r * .45, 2, 0, 0, r * 1.25); g.addColorStop(0, c.light); g.addColorStop(.22, c.fill); g.addColorStop(1, c.dark);
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r * .82, r, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.beginPath(); ctx.ellipse(-r * .3, -r * .42, r * .17, r * .28, -.45, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawProjectile(p) {
    p.trail.forEach((q, i) => { ctx.globalAlpha = (i + 1) / p.trail.length * .22; ctx.fillStyle = '#71422b'; ctx.beginPath(); ctx.arc(q.x, q.y, 3 + i * .22, 0, TAU); ctx.fill(); });
    ctx.globalAlpha = 1; const g = ctx.createRadialGradient(p.x - 3, p.y - 4, 1, p.x, p.y, 10); g.addColorStop(0, '#f3d29f'); g.addColorStop(1, '#70402c'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, TAU); ctx.fill();
  }
  function drawSlingshot() {
    const x = SLING.x, y = SLING.y;
    // shadow and wooden fork
    ctx.fillStyle = 'rgba(45,91,47,.25)'; ctx.beginPath(); ctx.ellipse(x, y + 72, 63, 12, 0, 0, TAU); ctx.fill();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#623622'; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(x, y + 76); ctx.lineTo(x - 7, y + 10); ctx.lineTo(x - 38, y - 29); ctx.moveTo(x - 7, y + 10); ctx.lineTo(x + 37, y - 31); ctx.stroke();
    ctx.strokeStyle = '#a96838'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(x, y + 76); ctx.lineTo(x - 7, y + 10); ctx.lineTo(x - 38, y - 29); ctx.moveTo(x - 7, y + 10); ctx.lineTo(x + 37, y - 31); ctx.stroke();
    const px = game.dragging ? game.pullX : x, py = game.dragging ? game.pullY : y + 10;
    ctx.strokeStyle = '#3e2523'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x - 38, y - 29); ctx.lineTo(px, py); ctx.moveTo(x + 37, y - 31); ctx.lineTo(px, py); ctx.stroke();
    const g = ctx.createRadialGradient(px - 3, py - 4, 1, px, py, 12); g.addColorStop(0, '#f6d59a'); g.addColorStop(1, '#70432c'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 10, 0, TAU); ctx.fill();
  }
  function drawParticle(p) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    if (p.type === 'text') { ctx.fillStyle = p.color; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.text, p.x, p.y); }
    else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.life / p.max), 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  function boot() {
    setupCanvas();
    emitState();
    if (pendingStart) start();
  }
  const api = { start, restart, nextLevel, pause, resume, toggleSound };
  window.GulelGame = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
