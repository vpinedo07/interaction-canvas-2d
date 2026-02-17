/* =========================================================
   Canvas 2D - Retro Arcade
   - Hover: cambia color
   - Click: fade-out + explosión vistosa
   - Movimiento: lanzados desde abajo + deriva lateral
   - Colisiones círculo-círculo
   - Salen por arriba del canvas
   - Stats: eliminados numérico y %
   - 150 en niveles de 10, aumenta dificultad
   - NUEVO: Si haces click y NO le atinas a ningún círculo,
            los círculos cercanos "se encarreran" y aceleran para escapar.
========================================================= */

(() => {
  // ---- Config negocio
  const TOTAL_ELEMENTS = 150;
  const GROUP_SIZE = 10;
  const TOTAL_LEVELS = Math.ceil(TOTAL_ELEMENTS / GROUP_SIZE);

  // Velocidad base y factor por nivel (tendencia final)
  const BASE_SPEED = 0.55;
  const SPEED_PER_LEVEL = 0.10;

  // Fade-out al eliminar
  const FADE_SPEED = 0.1;

  // Tamaños
  const R_MIN = 10;
  const R_MAX = 26;

  // Deriva lateral
  const DRIFT_MAX = 0.70;

  // Lanzamiento desde abajo (impulso)
  const LAUNCH_BOOST_MIN = 1.4;
  const LAUNCH_BOOST_MAX = 3.2;
  const UP_DRAG = 0.992;
  const SIDE_DRAG = 0.996;
  const CRUISE_BLEND = 0.02;
  const CRUISE_JITTER = 0.18;

  // ---- NUEVO: “Escape” por miss-click (zona de pánico)
  const PANIC_RADIUS = 140;          // px: radio de influencia del clic fallido
  const PANIC_UP_BOOST = 1.15;       // empuje hacia arriba (más negativo vy)
  const PANIC_SIDE_PUSH = 0.95;      // empuje lateral alejándose del clic
  const PANIC_TURBO_FRAMES = 22;     // duración del turbo (frames)
  const PANIC_TURBO_EXTRA = 0.06;    // aceleración extra por frame durante turbo

  // Rebote/colisiones
  const COLLISION_RESTITUTION = 0.92;
  const SEPARATION_BIAS = 0.55;
  const MAX_SPEED = 4.2;

  // Explosiones
  const EXPLOSION_PARTICLES_MIN = 18;
  const EXPLOSION_PARTICLES_MAX = 34;
  const EXPLOSION_POWER_MIN = 1.2;
  const EXPLOSION_POWER_MAX = 3.6;
  const EXPLOSION_DRAG = 0.985;
  const SPARK_GRAVITY = 0.01;
  const RING_LIFE = 26;
  const SPARK_LIFE_MIN = 28;
  const SPARK_LIFE_MAX = 52;

  // Paleta
  const PALETTE = [
    "rgba(70, 130, 180, 0.88)",
    "rgba(46, 204, 113, 0.88)",
    "rgba(155, 89, 182, 0.88)",
    "rgba(231, 76, 60, 0.88)",
    "rgba(241, 196, 15, 0.88)",
    "rgba(26, 188, 156, 0.88)",
    "rgba(230, 126, 34, 0.88)"
  ];
  const HOVER_FILL = "rgba(255, 140, 0, 0.92)";

  // ---- DOM
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const btnStart = document.getElementById("btnStart");
  const btnPause = document.getElementById("btnPause");
  const btnReset = document.getElementById("btnReset");

  const badgeLevel = document.getElementById("badgeLevel");
  const badgeSpawn = document.getElementById("badgeSpawn");
  const badgeTotal = document.getElementById("badgeTotal");

  const statDeleted = document.getElementById("statDeleted");
  const statPercent = document.getElementById("statPercent");
  const progressBar = document.getElementById("progressBar");

  document.getElementById("year").textContent = new Date().getFullYear();

  // ---- Estado
  let circles = [];
  let particles = [];
  let isRunning = false;
  let rafId = null;

  let currentLevel = 0;
  let spawnedTotal = 0;
  let deletedTotal = 0;

  let mouse = { x: -9999, y: -9999, inside: false };

  // ---- Utils
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function vecLen(x, y) { return Math.sqrt(x * x + y * y); }

  function resizeCanvasToDisplaySize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const newW = Math.floor(rect.width * dpr);
    const newH = Math.floor(rect.height * dpr);

    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width = newW;
      canvas.height = newH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // ---- Partículas
  class Spark {
    constructor({ x, y, vx, vy, size, life, color }) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.size = size;
      this.life = life;
      this.lifeMax = life;
      this.color = color;
      this.alpha = 1;
    }
    update() {
      this.vx *= EXPLOSION_DRAG;
      this.vy = this.vy * EXPLOSION_DRAG + SPARK_GRAVITY;
      this.x += this.vx;
      this.y += this.vy;
      this.life--;
      this.alpha = clamp(this.life / this.lifeMax, 0, 1);
      return this.life > 0;
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.fill();

      ctx.globalAlpha = this.alpha * 0.35;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * 2.6, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.fill();

      ctx.restore();
    }
  }

  class ShockRing {
    constructor({ x, y, r0, r1, life, color }) {
      this.x = x; this.y = y;
      this.r0 = r0; this.r1 = r1;
      this.life = life; this.lifeMax = life;
      this.color = color;
    }
    update() { this.life--; return this.life > 0; }
    draw() {
      const t = 1 - (this.life / this.lifeMax);
      const r = this.r0 + (this.r1 - this.r0) * t;
      const alpha = clamp(1 - t, 0, 1);

      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.25;
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  function createExplosion(x, y, baseColor, r) {
    const neon = baseColor.replace(/0\.88|0\.92/g, "0.95");

    particles.push(new ShockRing({
      x, y,
      r0: Math.max(6, r * 0.3),
      r1: r * rand(2.2, 3.2),
      life: RING_LIFE,
      color: neon
    }));

    const count = randInt(EXPLOSION_PARTICLES_MIN, EXPLOSION_PARTICLES_MAX);
    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      const pwr = rand(EXPLOSION_POWER_MIN, EXPLOSION_POWER_MAX) * (r / 18);
      particles.push(new Spark({
        x, y,
        vx: Math.cos(ang) * pwr,
        vy: Math.sin(ang) * pwr,
        size: rand(1.2, 2.6) * (r / 18),
        life: randInt(SPARK_LIFE_MIN, SPARK_LIFE_MAX),
        color: neon
      }));
    }

    particles.push(new Spark({
      x, y, vx: 0, vy: 0,
      size: Math.max(3, r * 0.20),
      life: 14,
      color: "rgba(255,255,255,0.95)"
    }));
  }

  function updateAndDrawParticles() {
    particles = particles.filter(p => p.update());
    for (const p of particles) p.draw();
  }

  // ---- Círculos
  class Circle {
    constructor({ x, y, r, vy, vx, fill, cruiseVy }) {
      this.x = x; this.y = y; this.r = r;
      this.vx = vx; this.vy = vy;
      this.cruiseVy = cruiseVy;

      // turbo de escape (miss-click)
      this.turbo = 0;

      this.isHover = false;
      this.isDying = false;
      this.alpha = 1;

      this.baseFill = fill;
      this.hoverFill = HOVER_FILL;
      this.stroke = "rgba(25, 25, 25, 0.35)";
      this.mass = Math.max(0.1, Math.PI * this.r * this.r);
    }

    containsPoint(px, py) {
      const dx = px - this.x;
      const dy = py - this.y;
      return (dx * dx + dy * dy) <= (this.r * this.r);
    }

    kill() { if (!this.isDying) this.isDying = true; }

    // Activa “turbo escape”
    panicBoost(clickX, clickY) {
      if (this.isDying) return;

      const dx = this.x - clickX;
      const dy = this.y - clickY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > PANIC_RADIUS) return;

      // factor 0..1 (más fuerte si está más cerca del clic)
      const t = 1 - (dist / PANIC_RADIUS);
      const nx = dist > 0 ? (dx / dist) : rand(-1, 1);
      const ny = dist > 0 ? (dy / dist) : rand(-1, 1);

      // “Escapar” = subir más rápido (vy más negativo) + empuje lateral lejos del clic
      this.vy -= PANIC_UP_BOOST * (0.55 + 0.75 * t);
      this.vx += nx * PANIC_SIDE_PUSH * (0.35 + 0.95 * t);

      // turbo por unos frames (se nota que se encarreran)
      this.turbo = Math.max(this.turbo, PANIC_TURBO_FRAMES);
    }

    update(boundsW) {
      if (this.isDying) {
        this.alpha = clamp(this.alpha - FADE_SPEED, 0, 1);
      }

      // Drag base (pierde impulso del “lanzamiento”)
      this.vy *= UP_DRAG;
      this.vx *= SIDE_DRAG;

      // Turbo extra cuando están “escapando”
      if (this.turbo > 0) {
        // empuje continuo hacia arriba (más negativo)
        this.vy -= PANIC_TURBO_EXTRA;
        this.turbo--;
      }

      // Vuelve suave al cruise (para conservar el ritmo del nivel)
      this.vy = this.vy * (1 - CRUISE_BLEND) + this.cruiseVy * CRUISE_BLEND;

      // mover
      this.x += this.vx;
      this.y += this.vy;

      // paredes laterales
      if (this.x - this.r <= 0) {
        this.x = this.r + 0.5;
        this.vx *= -1;
      } else if (this.x + this.r >= boundsW) {
        this.x = boundsW - this.r - 0.5;
        this.vx *= -1;
      }

      // clamp
      this.vx = clamp(this.vx, -MAX_SPEED, MAX_SPEED);
      this.vy = clamp(this.vy, -MAX_SPEED, MAX_SPEED);

      // salida/fin
      const outTop = (this.y + this.r) < -5;
      const fullyGone = this.alpha <= 0.001;
      return !(outTop || fullyGone);
    }

    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = this.isHover ? this.hoverFill : this.baseFill;
      ctx.fill();

      ctx.lineWidth = 1.25;
      ctx.strokeStyle = this.stroke;
      ctx.stroke();

      ctx.restore();
    }
  }

  // ---- Colisiones círculo-círculo
  function resolveCollisions(list) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.isDying) continue;

      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.isDying) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = vecLen(dx, dy);
        const minDist = a.r + b.r;

        if (dist > 0 && dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;

          // separar
          const overlap = (minDist - dist) * SEPARATION_BIAS;
          const totalMass = a.mass + b.mass;

          const aMove = overlap * (b.mass / totalMass);
          const bMove = overlap * (a.mass / totalMass);

          a.x -= nx * aMove; a.y -= ny * aMove;
          b.x += nx * bMove; b.y += ny * bMove;

          // impulso
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const velAlongNormal = rvx * nx + rvy * ny;
          if (velAlongNormal > 0) continue;

          const e = COLLISION_RESTITUTION;
          const jImpulse = -(1 + e) * velAlongNormal / (1 / a.mass + 1 / b.mass);

          const impX = jImpulse * nx;
          const impY = jImpulse * ny;

          a.vx -= impX / a.mass;
          a.vy -= impY / a.mass;
          b.vx += impX / b.mass;
          b.vy += impY / b.mass;

          a.vx = clamp(a.vx, -MAX_SPEED, MAX_SPEED);
          a.vy = clamp(a.vy, -MAX_SPEED, MAX_SPEED);
          b.vx = clamp(b.vx, -MAX_SPEED, MAX_SPEED);
          b.vy = clamp(b.vy, -MAX_SPEED, MAX_SPEED);
        } else if (dist === 0) {
          b.x += rand(-1, 1);
          b.y += rand(-1, 1);
        }
      }
    }
  }

  // ---- Niveles / Spawn
  function getLevelSpeed(levelIndex1Based) {
    return BASE_SPEED + (levelIndex1Based - 1) * SPEED_PER_LEVEL;
  }

  function pickColor() {
    return PALETTE[randInt(0, PALETTE.length - 1)];
  }

  function spawnLevel() {
    if (spawnedTotal >= TOTAL_ELEMENTS) return;
    currentLevel++;

    const levelSpeed = getLevelSpeed(currentLevel);
    const toSpawn = Math.min(GROUP_SIZE, TOTAL_ELEMENTS - spawnedTotal);

    const rect = canvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;

    for (let i = 0; i < toSpawn; i++) {
      const r = rand(R_MIN, R_MAX);

      let x = rand(r + 6, W - r - 6);
      let y = H + rand(r + 30, r + 170);

      // evita encimados en spawn
      let tries = 0;
      while (tries < 18) {
        let ok = true;
        for (const c of circles) {
          const dx = c.x - x;
          const dy = c.y - y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < (c.r + r + 10)) { ok = false; break; }
        }
        if (ok) break;
        x = rand(r + 6, W - r - 6);
        y = H + rand(r + 30, r + 170);
        tries++;
      }

      const vx = rand(-DRIFT_MAX, DRIFT_MAX) * rand(0.7, 1.2);

      // cruise (hacia arriba)
      const cruiseVy = -(levelSpeed + rand(0.05, CRUISE_JITTER));

      // impulso inicial fuerte (lanzados)
      const boost = rand(LAUNCH_BOOST_MIN, LAUNCH_BOOST_MAX) * (r / 18);
      const vy = cruiseVy - boost;

      circles.push(new Circle({ x, y, r, vx, vy, fill: pickColor(), cruiseVy }));
      spawnedTotal++;
    }

    updateUI();
  }

  // ---- UI
  function updateUI() {
    badgeLevel.textContent = `Nivel: ${currentLevel}/${TOTAL_LEVELS}`;
    badgeSpawn.textContent = `En pantalla: ${circles.length}`;
    badgeTotal.textContent = `Total: ${TOTAL_ELEMENTS}`;

    statDeleted.textContent = `${deletedTotal}`;
    const pct = (deletedTotal / TOTAL_ELEMENTS) * 100;
    statPercent.textContent = `${pct.toFixed(1)}%`;

    progressBar.style.width = `${clamp(pct, 0, 100)}%`;
    progressBar.setAttribute("aria-valuenow", `${clamp(pct, 0, 100)}`);
  }

  // ---- Loop
  function clear() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }

  function tick() {
    resizeCanvasToDisplaySize();
    clear();

    const rect = canvas.getBoundingClientRect();
    const W = rect.width;

    // Hover
    for (const c of circles) c.isHover = false;
    if (mouse.inside) {
      for (let i = circles.length - 1; i >= 0; i--) {
        const c = circles[i];
        if (!c.isDying && c.containsPoint(mouse.x, mouse.y)) {
          c.isHover = true;
          break;
        }
      }
    }

    // Update + colisiones
    circles = circles.filter(c => c.update(W));
    resolveCollisions(circles);

    // Draw
    for (const c of circles) c.draw();
    updateAndDrawParticles();

    // Niveles
    if (circles.length === 0 && spawnedTotal < TOTAL_ELEMENTS) spawnLevel();

    updateUI();

    if (spawnedTotal >= TOTAL_ELEMENTS && circles.length === 0) {
      pause();
      btnStart.disabled = false;
      btnStart.textContent = "Reiniciar partida";
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    btnStart.disabled = true;
    btnPause.disabled = false;

    if (currentLevel === 0 && spawnedTotal === 0) spawnLevel();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    isRunning = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function reset() {
    pause();
    circles = [];
    particles = [];
    currentLevel = 0;
    spawnedTotal = 0;
    deletedTotal = 0;

    btnStart.textContent = "Iniciar";
    btnStart.disabled = false;
    btnPause.disabled = true;

    updateUI();
    resizeCanvasToDisplaySize();
    clear();
  }

  // ---- Mouse
  function getMousePos(evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  canvas.addEventListener("mousemove", (evt) => {
    const p = getMousePos(evt);
    mouse.x = p.x;
    mouse.y = p.y;
    mouse.inside = true;
  });

  canvas.addEventListener("mouseleave", () => {
    mouse.inside = false;
    mouse.x = -9999;
    mouse.y = -9999;
  });

  canvas.addEventListener("click", (evt) => {
    if (!isRunning) return;

    const p = getMousePos(evt);

    // 1) Intentar “pegarle” a un círculo
    let hit = false;
    for (let i = circles.length - 1; i >= 0; i--) {
      const c = circles[i];
      if (!c.isDying && c.containsPoint(p.x, p.y)) {
        hit = true;
        createExplosion(c.x, c.y, c.baseFill, c.r);
        c.kill();
        deletedTotal++;
        updateUI();
        break;
      }
    }

    // 2) Si NO le atinaste, activas “escape” para círculos cercanos
    if (!hit) {
      for (const c of circles) {
        c.panicBoost(p.x, p.y);
      }
    }
  });

  // ---- Botones
  btnStart.addEventListener("click", () => {
    if (spawnedTotal >= TOTAL_ELEMENTS && circles.length === 0) reset();
    start();
  });
  btnPause.addEventListener("click", () => pause());
  btnReset.addEventListener("click", () => reset());

  // ---- Resize
  window.addEventListener("resize", () => resizeCanvasToDisplaySize());

  // ---- Init
  updateUI();
  resizeCanvasToDisplaySize();
  clear();
})();
