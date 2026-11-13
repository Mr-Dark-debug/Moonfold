/**
 * Moonfold Website — Seasonal canvas engine
 * One fixed overlay canvas above the page (below the header): snow in winter,
 * leaves in autumn. Particles collide with the top edges of page elements and
 * settle there; moving the pointer over a pile brushes it away. The animation
 * pauses while the tab is hidden, and prefers-reduced-motion gets a static
 * already-settled scene that still answers the brush.
 */
(function () {
  "use strict";

  const bus = window.MoonfoldSeasonal;
  if (!bus) return;

  const SETTLE_SELECTORS = [
    ".fcard",
    ".demo-tile",
    ".faq-list summary",
    ".gf-root",
    ".hx-btn",
    ".button",
    ".footer-landscape",
  ];
  const HERO_IMG = ".hero-art img";
  const BRUSH_RADIUS = 30;
  const BRUSH_RADIUS_LEAF = 46;
  const MAX_CRUMBS = 240;

  function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
  }

  function rand(low, high) {
    return low + Math.random() * (high - low);
  }

  function capHeightFor(el) {
    if (el.matches(".demo-tile")) return 18;
    if (el.matches(".fcard")) return 15;
    if (el.matches(".footer-landscape")) return 12;
    if (el.matches(".gf-root")) return 11;
    if (el.matches(".faq-list summary")) return 8;
    return 6;
  }

  function columnCount(width) {
    return clamp(Math.round(width / 3), 12, 620);
  }

  // The hero art's foreground hill is painted in the page colour and fills
  // solid from its ridge down, so scanning a column up from the bottom until
  // the paper colour ends finds the ridge; stars and the moon sit above it.
  function heroProfile(img, cols) {
    if (!img.complete || !img.naturalWidth) return null;
    const rect = img.getBoundingClientRect();
    const rows = Math.max(10, Math.round((cols * rect.height) / rect.width));
    let data = null;
    try {
      const off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      const oc = off.getContext("2d", { willReadFrequently: true });
      if (!oc) return null;
      oc.drawImage(img, 0, 0, cols, rows);
      data = oc.getImageData(0, 0, cols, rows).data;
    } catch {
      return null;
    }
    const base = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      let ridge = rows;
      for (let r = rows - 1; r >= 0; r--) {
        const i = (r * cols + c) * 4;
        if (data[i + 3] > 140 && data[i] > 232 && data[i + 2] > 200) ridge = r;
        else break;
      }
      base[c] = (ridge / rows) * rect.height;
    }
    const smooth = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      const a = base[Math.max(0, c - 1)];
      const b = base[c];
      const d = base[Math.min(cols - 1, c + 1)];
      smooth[c] = (a + 2 * b + d) / 4;
    }
    return smooth;
  }

  function lengthPx(token, basis) {
    if (!token) return 0;
    token = token.trim();
    if (token.endsWith("%")) return (parseFloat(token) / 100) * basis;
    const value = parseFloat(token);
    return Number.isFinite(value) ? value : 0;
  }

  function parseRadius(value, width, height) {
    if (!value || value === "0px") return null;
    const parts = value.split(" ");
    const rx = lengthPx(parts[0], width);
    const ry = lengthPx(parts[1] || parts[0], height);
    if (rx <= 0.5 || ry <= 0.5) return null;
    return { x: Math.min(rx, width / 2), y: Math.min(ry, height / 2) };
  }

  function cornerRadii(el, rect) {
    const style = getComputedStyle(el);
    const topLeft = parseRadius(style.borderTopLeftRadius, rect.width, rect.height);
    const topRight = parseRadius(style.borderTopRightRadius, rect.width, rect.height);
    if (!topLeft && !topRight) return null;
    return {
      leftX: topLeft ? topLeft.x : 0,
      leftY: topLeft ? topLeft.y : 0,
      rightX: topRight ? topRight.x : 0,
      rightY: topRight ? topRight.y : 0,
    };
  }

  function buildFlakeSprites() {
    const dots = [];
    for (const radius of [1.6, 2.4, 3.4, 4.6]) {
      const size = radius * 2 + 4;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size * 2;
      const g = canvas.getContext("2d");
      const r = radius * 1.6;
      const grad = g.createRadialGradient(size - r * 0.3, size - r * 0.35, r * 0.15, size, size, r);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.6, "rgba(243,249,255,0.95)");
      grad.addColorStop(1, "rgba(233,241,250,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(size, size, r, 0, Math.PI * 2);
      g.fill();
      dots.push({ canvas, size });
    }
    const dendrite = (r) => {
      const size = r * 2 + 6;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size * 2;
      const g = canvas.getContext("2d");
      g.translate(size, size);
      g.scale(2, 2);
      g.strokeStyle = "rgba(255,255,255,0.95)";
      g.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        g.save();
        g.rotate((Math.PI / 3) * i);
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(r, 0);
        g.stroke();
        g.lineWidth = 1.1;
        for (const at of [0.45, 0.75]) {
          const bx = r * at;
          const bl = r * 0.24;
          g.beginPath();
          g.moveTo(bx, 0);
          g.lineTo(bx - bl * 0.7, -bl);
          g.moveTo(bx, 0);
          g.lineTo(bx - bl * 0.7, bl);
          g.stroke();
        }
        g.restore();
      }
      g.fillStyle = "rgba(255,255,255,0.95)";
      g.beginPath();
      g.arc(0, 0, 1.9, 0, Math.PI * 2);
      g.fill();
      return { canvas, size };
    };
    return { dots, dendrites: [dendrite(9), dendrite(14)] };
  }

  function buildLeafSprites() {
    const colours = ["#f4b740", "#f6c59c", "#ff5a1f", "#e2762d", "#c9642a", "#e0b184"];
    return colours.map((colour) => {
      const canvas = document.createElement("canvas");
      canvas.width = 52;
      canvas.height = 44;
      const g = canvas.getContext("2d");
      g.fillStyle = colour;
      g.beginPath();
      g.moveTo(26, 41);
      g.quadraticCurveTo(2, 34, 5, 17);
      g.quadraticCurveTo(9, 3, 26, 3);
      g.quadraticCurveTo(43, 3, 47, 17);
      g.quadraticCurveTo(50, 34, 26, 41);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.16)";
      g.beginPath();
      g.moveTo(26, 3);
      g.quadraticCurveTo(43, 3, 47, 17);
      g.quadraticCurveTo(30, 22, 26, 20);
      g.quadraticCurveTo(22, 10, 26, 3);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(43,19,5,0.28)";
      g.lineCap = "round";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(26, 41);
      g.quadraticCurveTo(25, 20, 26, 5);
      g.stroke();
      g.lineWidth = 0.9;
      for (const [base, spread] of [
        [12, 8],
        [20, 10],
        [28, 9],
      ]) {
        g.beginPath();
        g.moveTo(26, base + 8);
        g.quadraticCurveTo(26 - spread, base + 2, 26 - spread - 3, base - 2);
        g.moveTo(26, base + 8);
        g.quadraticCurveTo(26 + spread, base + 2, 26 + spread + 3, base - 2);
        g.stroke();
      }
      return canvas;
    });
  }

  function createEngine(kind) {
    const snowMode = kind === "snow";

    let canvas = null;
    let ctx = null;
    let running = false;
    let reduced = false;
    let raf = 0;
    let w = 1;
    let h = 1;
    let dpr = 1;
    let intensity = 0.6;
    let windMs = 3;
    let clock = 0;
    let lastFrame = 0;
    let gust = 0;
    let gustTarget = 0;
    let nextGustAt = 0;
    let sprites = null;
    let targetFlying = 0;

    const surfaces = [];
    const surfaceState = new WeakMap();
    const flying = [];
    const crumbs = [];
    let ground = null;
    let hero = null;

    let pointerX = -1e5;
    let pointerY = -1e5;
    let brushX = -1e5;
    let brushY = -1e5;
    let brushSeen = false;

    let observer = null;
    let scanTimer = 0;
    let reducedMedia = null;

    function makeSurface(el, type) {
      return {
        el: el || null,
        ground: type === "ground",
        hero: type === "hero",
        rect: null,
        cols: 0,
        base: null,
        snow: null,
        radius: null,
        max: 12,
        resting: [],
        restingMax: 0,
        dirty: false,
        sizeKey: "",
        imageKey: "",
      };
    }

    function arcY(dx, rx, ry) {
      const t = clamp(1 - dx / rx, 0, 1);
      return ry * (1 - Math.sqrt(1 - t * t));
    }

    function cornerBase(s, cols) {
      const base = new Float32Array(cols);
      const rect = s.rect;
      const r = s.radius;
      if (!rect || !r) return base;
      const step = rect.width / cols;
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * step;
        let y = 0;
        if (r.leftX > 0 && x < r.leftX) y = Math.max(y, arcY(x, r.leftX, r.leftY));
        if (r.rightX > 0 && x > rect.width - r.rightX) {
          y = Math.max(y, arcY(rect.width - x, r.rightX, r.rightY));
        }
        base[c] = y;
      }
      return base;
    }

    function regrid(s, cols, baseOverride) {
      const old = s.snow;
      const oldCols = s.cols;
      s.cols = cols;
      s.base = baseOverride || cornerBase(s, cols);
      s.snow = new Float32Array(cols);
      if (old && oldCols) {
        for (let c = 0; c < cols; c++) {
          const f = (c / (cols - 1)) * (oldCols - 1);
          const i = Math.floor(f);
          const t = f - i;
          const a = old[i];
          const b = old[Math.min(oldCols - 1, i + 1)];
          s.snow[c] = a + (b - a) * t;
        }
      }
    }

    function measureSurface(s) {
      if (s.ground) {
        s.rect = { left: 0, top: h, right: w, width: w, bottom: h, height: 0 };
        const cols = columnCount(w);
        if (s.cols !== cols) regrid(s, cols);
        s.max = clamp(9 + intensity * 13, 9, 24);
        s.restingMax = Math.max(6, Math.round(w / 42));
        return;
      }
      const rect = s.el.getBoundingClientRect();
      if (
        rect.width < 24 ||
        rect.height < 6 ||
        rect.bottom < -30 ||
        rect.top > h + 30 ||
        rect.right < -30 ||
        rect.left > w + 30
      ) {
        s.rect = null;
        return;
      }
      s.rect = rect;
      const key = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      const cols = columnCount(rect.width);
      if (s.hero) {
        if (key !== s.imageKey || s.cols !== cols) {
          const profile = heroProfile(s.el, cols);
          if (!profile) {
            s.rect = null; // art not decoded yet; try again next frame
            return;
          }
          s.imageKey = key;
          regrid(s, cols, profile);
        }
        s.max = 10;
        s.restingMax = Math.max(6, Math.round(rect.width / 60));
        return;
      }
      if (key !== s.sizeKey || s.cols !== cols) {
        s.sizeKey = key;
        s.radius = cornerRadii(s.el, rect);
        regrid(s, cols);
        s.max = capHeightFor(s.el) * (0.65 + 0.55 * intensity);
        s.restingMax = Math.max(2, Math.round(rect.width / 95));
      }
    }

    function measureAll() {
      for (const s of surfaces) measureSurface(s);
    }

    function scan() {
      const found = new Set(document.querySelectorAll(SETTLE_SELECTORS.join(", ")));
      for (const el of found) {
        let s = surfaceState.get(el);
        if (!s) {
          s = makeSurface(el);
          surfaceState.set(el, s);
          surfaces.push(s);
        }
      }
      for (let i = surfaces.length - 1; i >= 0; i--) {
        const s = surfaces[i];
        if (s === ground || s === hero) continue;
        if (!found.has(s.el)) surfaces.splice(i, 1);
      }
    }

    function scheduleScan() {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        scan();
        if (reduced) render();
      }, 350);
    }

    function surfaceTopAt(s, x) {
      const c = clamp(Math.round(((x - s.rect.left) / s.rect.width) * (s.cols - 1)), 0, s.cols - 1);
      return s.rect.top + s.base[c] - s.snow[c];
    }

    // The first surface (elements, then the hero ridge, then the ground) whose
    // resting line the falling particle has reached.
    function firstSurfaceBelow(x, y) {
      for (const s of surfaces) {
        const rect = s.rect;
        if (!rect) continue;
        if (x < rect.left || x > rect.right) continue;
        const c = clamp(Math.round(((x - rect.left) / rect.width) * (s.cols - 1)), 0, s.cols - 1);
        const top = rect.top + s.base[c] - s.snow[c];
        if (y >= top) return { surface: s, col: c, top };
      }
      return null;
    }

    function relax(s) {
      const { snow, cols } = s;
      let moved = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let c = 0; c < cols; c++) {
          const height = snow[c];
          if (height < 0.01) continue;
          const left = c > 0 ? snow[c - 1] : height;
          const right = c < cols - 1 ? snow[c + 1] : height;
          const lim = Math.min(left, right) + 2.4;
          if (height <= lim) continue;
          const drop = Math.min(height - lim, 1.2);
          if (c > 0 && c < cols - 1) {
            snow[c] -= drop;
            if (left <= right) snow[c - 1] += drop;
            else snow[c + 1] += drop;
            moved += drop;
          } else if (c === 0 && cols > 1 && snow[1] + drop < height) {
            snow[0] -= drop;
            snow[1] += drop;
            moved += drop;
          } else if (c === cols - 1 && cols > 1 && snow[cols - 2] + drop < height) {
            snow[cols - 1] -= drop;
            snow[cols - 2] += drop;
            moved += drop;
          }
        }
      }
      return moved;
    }

    function spillEdges(s) {
      const rect = s.rect;
      let moved = 0;
      for (const edge of [0, s.cols - 1]) {
        if (s.snow[edge] > 2.6) {
          const take = Math.min(s.snow[edge] - 2.6, 0.9);
          s.snow[edge] -= take;
          moved += take;
          if (!reduced && crumbs.length < MAX_CRUMBS) {
            crumbs.push({
              x: edge === 0 ? rect.left - 2 : rect.right + 2,
              y: rect.top + s.base[edge],
              vx: edge === 0 ? rand(-40, -10) : rand(10, 40),
              vy: rand(-6, 10),
              size: rand(0.8, 1.8),
              life: rand(0.4, 0.8),
              age: 0,
            });
          }
        }
      }
      return moved;
    }

    function applyFlakeSize(f) {
      f.dendrite = f.z > 0.8 && Math.random() < 0.45;
      if (f.dendrite) {
        f.size = f.z > 0.92 ? 15 : 10;
        f.dot = -1;
      } else if (f.z < 0.4) {
        f.size = rand(1.4, 2.2);
        f.dot = 0;
      } else if (f.z < 0.75) {
        f.size = rand(2.6, 4);
        f.dot = 1 + ((Math.random() * 2) | 0);
      } else {
        f.size = rand(4, 5.6);
        f.dot = 3;
      }
      f.fall = 22 + f.size * 13 + f.z * 26;
    }

    function spawnFlying(initial) {
      if (snowMode) {
        const f = {
          x: rand(-40, w + 40),
          y: initial ? rand(-40, h * 0.9) : -rand(6, 70),
          z: Math.random(),
          size: 0,
          dot: 0,
          dendrite: false,
          fall: 0,
          phase: rand(0, 6.28),
          swayV: rand(0.5, 1.6),
          swayAmp: rand(4, 15),
          vx: 0,
          angle: rand(0, 6.28),
          spin: rand(-0.9, 0.9),
        };
        applyFlakeSize(f);
        flying.push(f);
      } else {
        flying.push({
          x: rand(-60, w + 60),
          y: initial ? rand(-60, h * 0.9) : -rand(20, 90),
          vx: 0,
          vy: rand(12, 30),
          size: rand(28, 50),
          sprite: (Math.random() * sprites.length) | 0,
          angle: rand(0, 6.28),
          spin: rand(-1.4, 1.4),
          tumble: rand(0, 6.28),
          tumbleV: rand(1.2, 2.8) * (Math.random() < 0.5 ? -1 : 1),
        });
      }
    }

    function restLeaf(s, f, top) {
      s.resting.push({
        x: f.x,
        y: s.ground ? h - rand(3, 10) : top - rand(2, 5),
        size: f.size,
        sprite: f.sprite,
        angle: rand(-0.6, 0.6),
        alpha: 1,
        fade: false,
      });
      if (s.resting.length > s.restingMax) {
        for (const candidate of s.resting) {
          if (!candidate.fade) {
            candidate.fade = true;
            break;
          }
        }
      }
    }

    function updateFlying(dt, windPx) {
      while (flying.length < targetFlying) spawnFlying(true);
      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i];
        if (snowMode) {
          f.phase += f.swayV * dt;
          f.angle += f.spin * dt;
          f.y += f.fall * (0.9 + 0.25 * intensity) * dt;
          f.x += (windPx * f.z + Math.sin(f.phase) * f.swayAmp + f.vx) * dt;
          f.vx *= Math.pow(0.25, dt);
          if (f.x < -60) f.x = w + 50;
          else if (f.x > w + 60) f.x = -50;
          const hit = firstSurfaceBelow(f.x, f.y);
          if (hit) {
            hit.surface.snow[hit.col] = Math.min(
              hit.surface.max,
              hit.surface.snow[hit.col] + f.size * 0.3,
            );
            hit.surface.dirty = true;
            f.z = Math.random();
            applyFlakeSize(f);
            f.x = rand(-40, w + 40);
            f.y = -rand(6, 70);
            f.vx = 0;
          }
        } else {
          f.tumble += f.tumbleV * dt;
          f.angle += f.spin * dt;
          const terminal = (26 + f.size * 0.5) * (0.85 + 0.4 * intensity);
          if (f.vy < terminal) f.vy = Math.min(terminal, f.vy + 90 * dt);
          f.x += (windPx * 1.5 + Math.sin(f.tumble * 0.7) * 42 + f.vx) * dt;
          f.vx *= Math.pow(0.3, dt);
          f.y += f.vy * dt;
          if (f.y > h + 40 || f.x < -100 || f.x > w + 100) {
            flying.splice(i, 1);
            continue;
          }
          const hit = firstSurfaceBelow(f.x, f.y);
          if (hit) {
            restLeaf(hit.surface, f, hit.top);
            flying.splice(i, 1);
          }
        }
      }
    }

    function updateResting(dt) {
      for (const s of surfaces) {
        for (let i = s.resting.length - 1; i >= 0; i--) {
          const leaf = s.resting[i];
          if (!leaf.fade) continue;
          leaf.alpha -= dt / 1.4;
          if (leaf.alpha <= 0) s.resting.splice(i, 1);
        }
      }
    }

    function updateCrumbs(dt) {
      for (let i = crumbs.length - 1; i >= 0; i--) {
        const p = crumbs[i];
        p.age += dt;
        if (p.age >= p.life || p.y > h + 24) {
          crumbs.splice(i, 1);
          continue;
        }
        p.vy += 340 * dt;
        p.vx *= Math.pow(0.5, dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }

    function settleSurfaces() {
      for (const s of surfaces) {
        if (!s.rect || !s.dirty) continue;
        if (relax(s) + spillEdges(s) < 0.05) s.dirty = false;
      }
    }

    function brushFrame() {
      if (!brushSeen) return;
      const dx = pointerX - brushX;
      const dy = pointerY - brushY;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      if (snowMode) brushSnow(dx, dy);
      else brushLeaves(dx, dy);
      brushX = pointerX;
      brushY = pointerY;
    }

    function brushSnow(dx, dy) {
      const speed = Math.hypot(dx, dy);
      if (speed < 1.5) return;
      const depth = clamp(speed * 0.5, 2, 9);
      for (const s of surfaces) {
        const rect = s.rect;
        if (!rect) continue;
        if (
          pointerX < rect.left - BRUSH_RADIUS ||
          pointerX > rect.right + BRUSH_RADIUS ||
          pointerY < rect.top - BRUSH_RADIUS ||
          pointerY > rect.bottom + BRUSH_RADIUS
        ) {
          continue;
        }
        const c0 = clamp(
          Math.floor(((pointerX - BRUSH_RADIUS - rect.left) / rect.width) * s.cols),
          0,
          s.cols - 1,
        );
        const c1 = clamp(
          Math.ceil(((pointerX + BRUSH_RADIUS - rect.left) / rect.width) * s.cols),
          0,
          s.cols - 1,
        );
        for (let c = c0; c <= c1; c++) {
          if (s.snow[c] <= 0.2) continue;
          const x = rect.left + ((c + 0.5) * rect.width) / s.cols;
          const d = Math.abs(x - pointerX);
          if (d > BRUSH_RADIUS) continue;
          const top = rect.top + s.base[c] - s.snow[c];
          const dy2 = pointerY - top;
          if (dy2 < -BRUSH_RADIUS || dy2 > BRUSH_RADIUS * 0.9) continue;
          const falloff = 1 - (d / BRUSH_RADIUS) * (d / BRUSH_RADIUS);
          const take = Math.min(s.snow[c], falloff * depth);
          if (take <= 0.05) continue;
          s.snow[c] -= take;
          s.dirty = true;
          if (!reduced && crumbs.length < MAX_CRUMBS && Math.random() < take * 0.45) {
            crumbs.push({
              x,
              y: top + rand(0, 5),
              vx: dx * rand(5, 11) + rand(-28, 28),
              vy: dy * rand(2, 6) - rand(30, 90),
              size: rand(0.8, 2.1),
              life: rand(0.35, 0.8),
              age: 0,
            });
          }
        }
      }
    }

    function brushLeaves(dx, dy) {
      const speed = Math.hypot(dx, dy);
      if (speed < 2) return;
      for (const s of surfaces) {
        const rect = s.rect;
        if (!rect) continue;
        if (
          pointerX < rect.left - BRUSH_RADIUS_LEAF ||
          pointerX > rect.right + BRUSH_RADIUS_LEAF ||
          pointerY < rect.top - BRUSH_RADIUS_LEAF ||
          pointerY > rect.bottom + BRUSH_RADIUS_LEAF
        ) {
          continue;
        }
        for (let i = s.resting.length - 1; i >= 0; i--) {
          const leaf = s.resting[i];
          if (Math.hypot(leaf.x - pointerX, leaf.y - pointerY) > BRUSH_RADIUS_LEAF) continue;
          s.resting.splice(i, 1);
          if (!reduced) {
            flying.push({
              x: leaf.x,
              y: leaf.y,
              vx: dx * rand(6, 13),
              vy: dy * rand(4, 9) - rand(50, 130),
              size: leaf.size,
              sprite: leaf.sprite,
              angle: leaf.angle,
              spin: rand(-6, 6),
              tumble: rand(0, 6.28),
              tumbleV: rand(2, 4) * (Math.random() < 0.5 ? -1 : 1),
            });
          }
        }
      }
      if (reduced) return;
      for (const f of flying) {
        if (Math.hypot(f.x - pointerX, f.y - pointerY) < BRUSH_RADIUS_LEAF * 1.4) {
          f.vx += dx * 4;
          f.vy += dy * 2 - 30;
        }
      }
    }

    function drawCap(s) {
      const rect = s.rect;
      if (!rect) return;
      let piled = false;
      for (let c = 0; c < s.cols; c++) {
        if (s.snow[c] > 0.4) {
          piled = true;
          break;
        }
      }
      if (!piled) return;
      const step = rect.width / s.cols;
      ctx.beginPath();
      ctx.moveTo(rect.left, rect.top + s.base[0] - s.snow[0]);
      for (let c = 1; c < s.cols; c++) {
        ctx.lineTo(rect.left + (c + 0.5) * step, rect.top + s.base[c] - s.snow[c]);
      }
      ctx.lineTo(rect.right, rect.top + s.base[s.cols - 1] - s.snow[s.cols - 1]);
      for (let c = s.cols - 1; c >= 0; c--) {
        ctx.lineTo(rect.left + (c + 0.5) * step, rect.top + s.base[c] + 1);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.97)";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(rect.left, rect.top + s.base[0]);
      for (let c = 1; c < s.cols; c++) {
        ctx.lineTo(rect.left + (c + 0.5) * step, rect.top + s.base[c]);
      }
      ctx.strokeStyle = "rgba(21,43,66,0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    function drawResting(s) {
      const rect = s.rect;
      if (!rect || !s.resting.length) return;
      for (const leaf of s.resting) {
        ctx.globalAlpha = leaf.alpha;
        ctx.save();
        ctx.translate(leaf.x, leaf.y);
        ctx.rotate(leaf.angle);
        ctx.drawImage(
          sprites[leaf.sprite],
          -leaf.size / 2,
          -leaf.size * 0.42,
          leaf.size,
          leaf.size * 0.84,
        );
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    function drawFlying() {
      for (const f of flying) {
        if (snowMode) {
          ctx.globalAlpha = 0.4 + 0.6 * f.z;
          if (f.dendrite) {
            const sprite = f.z > 0.92 ? sprites.dendrites[1] : sprites.dendrites[0];
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate(f.angle);
            ctx.drawImage(
              sprite.canvas,
              -sprite.size / 2,
              -sprite.size / 2,
              sprite.size,
              sprite.size,
            );
            ctx.restore();
          } else {
            const sprite = sprites.dots[f.dot];
            ctx.drawImage(
              sprite.canvas,
              f.x - sprite.size / 2,
              f.y - sprite.size / 2,
              sprite.size,
              sprite.size,
            );
          }
        } else {
          ctx.globalAlpha = 0.94;
          ctx.save();
          ctx.translate(f.x, f.y);
          ctx.rotate(f.angle);
          ctx.scale(0.3 + 0.7 * Math.abs(Math.cos(f.tumble)), 1);
          ctx.drawImage(sprites[f.sprite], -f.size / 2, -f.size * 0.42, f.size, f.size * 0.84);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawCrumbs() {
      if (!crumbs.length) return;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      for (const p of crumbs) {
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function render() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (snowMode) {
        for (const s of surfaces) drawCap(s);
      } else {
        for (const s of surfaces) drawResting(s);
      }
      drawFlying();
      drawCrumbs();
    }

    function step(dt) {
      clock += dt;
      if (clock >= nextGustAt) {
        const strength = snowMode ? 10 + windMs * 4 : 16 + windMs * 7;
        gustTarget = rand(-1, 1) * strength;
        nextGustAt = clock + rand(2.5, 7);
      }
      gust += (gustTarget - gust) * Math.min(1, dt * 0.7);
      const windPx = windMs * 5 + gust;

      measureAll();
      updateFlying(dt, windPx);
      if (!snowMode) updateResting(dt);
      settleSurfaces();
      updateCrumbs(dt);
      brushFrame();
    }

    function loop(now) {
      raf = 0;
      if (!running || document.hidden) return;
      const dt = lastFrame ? clamp((now - lastFrame) / 1000, 0.001, 0.05) : 0.016;
      lastFrame = now;
      step(dt);
      render();
      raf = requestAnimationFrame(loop);
    }

    function preroll() {
      for (const s of surfaces) {
        if (!s.rect) continue;
        if (snowMode) {
          for (let c = 0; c < s.cols; c++) {
            s.snow[c] = s.max * (0.3 + 0.4 * Math.pow(Math.random(), 1.7));
          }
          for (let pass = 0; pass < 5; pass++) relax(s);
          s.dirty = false;
        } else {
          const count = Math.round(s.restingMax * rand(0.45, 0.75));
          for (let n = 0; n < count; n++) {
            const x = rand(s.rect.left + 4, s.rect.right - 4);
            const top = surfaceTopAt(s, x);
            s.resting.push({
              x,
              y: s.ground ? h - rand(3, 10) : top - rand(2, 5),
              size: rand(28, 48),
              sprite: (Math.random() * sprites.length) | 0,
              angle: rand(-0.6, 0.6),
              alpha: 1,
              fade: false,
            });
          }
        }
      }
      if (!reduced) {
        while (flying.length < targetFlying) spawnFlying(true);
      }
    }

    function resizeCanvas() {
      w = Math.max(1, window.innerWidth);
      h = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      targetFlying = snowMode
        ? Math.round(clamp((w * h) / 6500, 36, 300) * (0.35 + 0.75 * intensity))
        : Math.round(clamp((w * h) / 19000, 8, 70) * (0.45 + 0.65 * intensity));
    }

    function onResize() {
      if (!canvas) return;
      resizeCanvas();
      measureAll();
      if (reduced) render();
    }

    function onPointerMove(event) {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!brushSeen) {
        brushX = pointerX;
        brushY = pointerY;
        brushSeen = true;
        return;
      }
      if (reduced) {
        brushFrame();
        render();
      }
    }

    function onPointerLeave() {
      brushSeen = false;
      pointerX = -1e5;
      pointerY = -1e5;
    }

    function onVisibility() {
      if (reduced || !running) return;
      if (document.hidden) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      } else if (!raf) {
        lastFrame = performance.now();
        raf = requestAnimationFrame(loop);
      }
    }

    function onReducedChange() {
      if (!running) return;
      const nowReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (nowReduced === reduced) return;
      reduced = nowReduced;
      if (reduced) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        preroll(); // pre-grow piles so the still scene does not look empty
        render();
      } else {
        lastFrame = performance.now();
        raf = requestAnimationFrame(loop);
      }
    }

    function start(params) {
      if (running) stop();
      intensity = clamp(params.intensity ?? 0.6, 0, 1);
      windMs = clamp(params.wind ?? 3, 0, 14);
      reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

      canvas = document.createElement("canvas");
      canvas.className = "seasonal-canvas";
      canvas.setAttribute("aria-hidden", "true");
      document.body.appendChild(canvas);
      ctx = canvas.getContext("2d");
      if (!ctx) {
        canvas.remove();
        canvas = null;
        return;
      }

      sprites = snowMode ? buildFlakeSprites() : buildLeafSprites();
      resizeCanvas();
      scan();
      const heroImg = document.querySelector(HERO_IMG);
      hero = heroImg ? makeSurface(heroImg, "hero") : null;
      ground = makeSurface(null, "ground");
      if (hero) surfaces.push(hero);
      surfaces.push(ground);
      measureAll();
      preroll();

      window.addEventListener("resize", onResize);
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerdown", onPointerMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onPointerLeave);
      document.addEventListener("visibilitychange", onVisibility);
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, { childList: true, subtree: true });
      reducedMedia = matchMedia("(prefers-reduced-motion: reduce)");
      reducedMedia.addEventListener?.("change", onReducedChange);

      running = true;
      if (reduced) {
        render();
      } else {
        lastFrame = performance.now();
        raf = requestAnimationFrame(loop);
      }
    }

    function stop() {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      clearTimeout(scanTimer);
      if (reducedMedia) {
        reducedMedia.removeEventListener?.("change", onReducedChange);
        reducedMedia = null;
      }
      if (canvas) {
        canvas.remove();
        canvas = null;
      }
      ctx = null;
      surfaces.length = 0;
      flying.length = 0;
      crumbs.length = 0;
      ground = null;
      hero = null;
    }

    return { start, stop };
  }

  bus.register("snow", createEngine("snow"));
  bus.register("leaves", createEngine("leaves"));
})();
