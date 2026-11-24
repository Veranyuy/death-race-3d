import * as THREE from './vendor/three.module.js';

/* =========================================================================
   DEATH RACE 3D — trackside scenery kit
   A dense, enclosed industrial / prison arena corridor: continuous jersey
   barrier + chain-link security line with light poles, long brick-concrete
   factory facades pressed close to the apron, steel truss colonnades,
   overhead pipe/truss bridges, stacked container walls, scrap yards and a
   distant cooling-tower skyline.

   Everything repeated goes through THREE.InstancedMesh (one draw call per
   material family) and every structure is grounded on the local apron /
   embankment elevation so slopes (Volcanic Ridge) stay clean.
   ========================================================================= */

/* --------------------------------------------------------------- textures */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function grime(ctx, w, h, rand, color, count) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.18;
    ctx.fillRect(rand() * w, rand() * h, 2 + rand() * (w * 0.06), 1 + rand() * (h * 0.05));
  }
  ctx.globalAlpha = 1;
}

function makeSceneryTextures(seed = 0x5ce7e) {
  const rand = mulberry32(seed);
  const tex = {};

  /* open steel lattice panel: cut-out alpha, tileable, ~1 bay per tile */
  tex.truss = canvasTex(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const steel = '#a5afb5';
    const dark = '#79848b';

    ctx.fillStyle = steel;
    ctx.fillRect(0, 0, w, 40);
    ctx.fillRect(0, h - 40, w, 40);
    ctx.fillRect(0, 0, 26, h);
    ctx.fillRect(w - 26, 0, 26, h);
    ctx.fillRect(w / 2 - 11, 0, 22, h);

    ctx.strokeStyle = steel;
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(24, h - 34);
    ctx.lineTo(w / 2, 34);
    ctx.lineTo(w - 24, h - 34);
    ctx.stroke();

    ctx.strokeStyle = dark;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(w - 26, h - 30);
    ctx.lineTo(w / 2 + 12, h / 2);
    ctx.stroke();

    ctx.fillStyle = '#b9c3c9';
    for (const [x, y] of [[24, 44], [w / 2, 44], [w - 24, 44], [24, h - 48], [w / 2, h - 48], [w - 24, h - 48]]) {
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(126,74,42,0.35)';
    for (let i = 0; i < 40; i++) {
      ctx.fillRect(rand() * w, rand() * h, 3 + rand() * 22, 2 + rand() * 12);
    }
    ctx.fillStyle = 'rgba(18,20,22,0.3)';
    for (let i = 0; i < 22; i++) {
      ctx.fillRect(rand() * w, rand() * h, 4 + rand() * 30, 2 + rand() * 6);
    }
  });

  /* corrugated container skin (near-white so instance colours tint it) */
  tex.corrugated = canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d5d3cc';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 22) {
      const g = ctx.createLinearGradient(x, 0, x + 22, 0);
      g.addColorStop(0, 'rgba(58,58,56,0.42)');
      g.addColorStop(0.28, 'rgba(255,255,255,0.5)');
      g.addColorStop(0.62, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(40,40,40,0.4)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 22, h);
    }
    ctx.fillStyle = 'rgba(30,32,34,0.45)';
    ctx.fillRect(0, 0, w, 12);
    ctx.fillRect(0, h - 16, w, 16);
    grime(ctx, w, h, rand, '#7a4a28', 60);
    ctx.fillStyle = 'rgba(80,46,26,0.3)';
    for (let i = 0; i < 26; i++) {
      ctx.fillRect(rand() * w, rand() * h * 0.7, 4 + rand() * 18, 10 + rand() * 40);
    }
  });

  /* diagonal hazard plating for gantry bands and container ends */
  tex.hazard = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d9a72b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1a17';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 4);
    for (let x = -w * 1.5; x < w * 1.5; x += 96) ctx.fillRect(x, -h, 46, h * 2);
    ctx.restore();
    grime(ctx, w, h, rand, '#2a2018', 60);
    ctx.strokeStyle = 'rgba(20,18,16,0.5)';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  });

  /* prison / industrial hall facade: brick-concrete with barred windows,
     set up so one tile reads as 4 window bays across the long face */
  tex.wall = canvasTex(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8f8578';
    ctx.fillRect(0, 0, w, h);
    const courseH = 26;
    for (let y = 0, row = 0; y < h; y += courseH, row++) {
      for (let x = (row % 2 ? -44 : 0); x < w; x += 88) {
        const v = 0.78 + rand() * 0.34;
        ctx.fillStyle = `rgba(${Math.round(126 * v)},${Math.round(108 * v)},${Math.round(92 * v)},0.55)`;
        ctx.fillRect(x + 2, y + 2, 84, courseH - 4);
      }
      ctx.fillStyle = 'rgba(52,46,40,0.35)';
      ctx.fillRect(0, y, w, 2);
    }
    // concrete piers
    for (let x = 0; x <= w; x += w / 4) {
      ctx.fillStyle = 'rgba(196,190,178,0.5)';
      ctx.fillRect(x - 12, 0, 24, h);
      ctx.fillStyle = 'rgba(30,28,26,0.18)';
      ctx.fillRect(x + 10, 0, 5, h);
    }
    // barred window bays (3 rows x 8 columns)
    const cols = 8, rows = 3;
    const bw = w / cols, bh = h / rows;
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        const x = cx * bw + bw * 0.2;
        const y = cy * bh + bh * 0.22;
        const ww = bw * 0.6, wh = bh * 0.5;
        ctx.fillStyle = '#14181a';
        ctx.fillRect(x, y, ww, wh);
        ctx.strokeStyle = 'rgba(70,74,72,0.9)';
        ctx.lineWidth = 7;
        ctx.strokeRect(x, y, ww, wh);
        ctx.fillStyle = 'rgba(120,128,124,0.75)';
        for (let bx = x + 12; bx < x + ww - 8; bx += 20) ctx.fillRect(bx, y + 5, 4, wh - 10);
        for (let by = y + 16; by < y + wh - 10; by += 30) ctx.fillRect(x + 6, by, ww - 12, 3);
        ctx.fillStyle = 'rgba(210,204,190,0.4)';
        ctx.fillRect(x - 10, y + wh, ww + 20, 9);
        ctx.fillStyle = 'rgba(96,52,28,0.28)';
        ctx.fillRect(x + ww * 0.3, y + wh + 9, 10, 24 + rand() * 40);
      }
    }
    grime(ctx, w, h, rand, '#3a322c', 90);
  });

  /* chain-link perimeter fence (alpha cut-out) */
  tex.fence = canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(176,186,188,0.95)';
    ctx.lineWidth = 5;
    const step = 42;
    for (let x = -h; x < w + h; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + h, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, h); ctx.lineTo(x + h, 0);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(140,150,152,0.85)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, w, h);
  });

  /* weathered concrete for the continuous jersey barrier line */
  tex.barrier = canvasTex(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b5aea0';
    ctx.fillRect(0, 0, w, h);
    grime(ctx, w, h, rand, '#4a443a', 90);
    // top / bottom shadow rails
    ctx.fillStyle = 'rgba(40,38,34,0.35)';
    ctx.fillRect(0, 0, w, 8);
    ctx.fillRect(0, h - 10, w, 10);
    // vertical runoff stains
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(70,66,58,${0.06 + rand() * 0.16})`;
      ctx.fillRect(rand() * w, 8 + rand() * 20, 2 + rand() * 7, 30 + rand() * 80);
    }
    // chipped edges
    ctx.fillStyle = 'rgba(24,22,20,0.4)';
    for (let i = 0; i < 18; i++) {
      const x = rand() * w;
      ctx.beginPath();
      ctx.arc(x, rand() < 0.5 ? 4 : h - 4, 2 + rand() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  return tex;
}

/* ------------------------------------------------------------ placements */

/** Ground height under a lateral offset: flat apron out to hw + apron, then
    the embankment slope down to the terrain plane. Keeps Volcanic Ridge
    structures on the mountain instead of floating at y=0. */
/** Lateral offset of the point where the apron meets the terrain. Shared by
    groundHeight() and the embankment ribbon in tracks.js. */
export function slopeOuterOffset(apron, roadY) {
  return apron + 1.2 + Math.max(0, roadY) * 0.9;
}

export function groundHeight(sample, hw, lateral, apron) {
  const a = Math.abs(lateral);
  const roadY = sample.pos.y;
  const inner = hw + apron;
  const outer = hw + slopeOuterOffset(apron, roadY);
  if (a <= inner) return roadY - 0.02;
  if (a >= outer) return 0;
  const t = (a - inner) / Math.max(0.001, outer - inner);
  return (roadY - 0.02) * (1 - t);
}

function clearanceAt(samples, x, z) {
  let best = Infinity;
  for (let i = 0; i < samples.length; i += 3) {
    const s = samples[i];
    const dx = x - s.pos.x, dz = z - s.pos.z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Whole footprint (corners + edge midpoints) must clear the racing surface,
    so a long hall can never poke into a neighbouring section of the circuit. */
function footprintClear(samples, x, z, hw, yaw, halfW, halfD, gap) {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const limit = hw + gap;
  const pts = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [u, v] of pts) {
    const px = x + c * (u * halfW) + sn * (v * halfD);
    const pz = z - sn * (u * halfW) + c * (v * halfD);
    if (clearanceAt(samples, px, pz) < limit) return false;
  }
  return true;
}

function lateralOf(sample, x, z) {
  return (x - sample.pos.x) * sample.right.x + (z - sample.pos.z) * sample.right.z;
}

/* ------------------------------------------------------------ mesh kit */

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const CONTAINER = { w: 6.4, h: 2.6, d: 2.55 };
const TIRE_GEO = new THREE.TorusGeometry(0.56, 0.24, 5, 10);
const LAMP_GEO = new THREE.BoxGeometry(0.6, 0.2, 0.14);
const BARREL_GEO = new THREE.CylinderGeometry(0.42, 0.44, 1.2, 9);
const SMOKE_GEO = new THREE.SphereGeometry(1, 6, 4);
const SKY_TOWER_GEO = new THREE.CylinderGeometry(0.72, 1, 1, 12, 1, true);

const PIPE_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
  g.rotateZ(Math.PI / 2);   // axis -> local X, length 1, radius 0.5
  return g;
})();

/** jersey barrier profile extruded along local Z; bottom sits at y = 0 */
const BARRIER_GEO = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.42, 0);
  s.lineTo(0.42, 0);
  s.lineTo(0.42, 0.15);
  s.lineTo(0.19, 0.52);
  s.lineTo(0.19, 0.94);
  s.lineTo(-0.19, 0.94);
  s.lineTo(-0.19, 0.52);
  s.lineTo(-0.42, 0.15);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, steps: 1, curveSegments: 1 });
  g.translate(0, 0, -0.5);
  return g;
})();

const _dummy = new THREE.Object3D();
const _col = new THREE.Color();

function buildInstanced(list, geo, mat, { cast = true, receive = true, tinted = false, order = 0 } = {}) {
  if (!list.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.renderOrder = order;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    _dummy.position.set(it.x, it.y, it.z);
    _dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
    _dummy.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
    if (tinted) mesh.setColorAt(i, _col.set(it.c ?? 0xffffff));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // instances span the whole circuit; a shared bounding sphere would cull them
  mesh.frustumCulled = false;
  return mesh;
}

function createSceneryKit(parent, tex) {
  const bins = {
    lattice: [], beam: [], hazard: [], wall: [], container: [], tire: [],
    fence: [], lamp: [], barrier: [], pipe: [], barrel: [], smoke: [],
    skyTower: [], skyBlock: [],
  };

  const kit = {
    /** vertical lattice panel (open steel truss), width x height */
    lattice(x, y, z, ry, w, h) {
      bins.lattice.push({ x, y, z, ry, sx: w, sy: h, sz: 1 });
    },
    /** solid steel member; w = across (local X), h = up, d = along local +Z */
    beam(x, y, z, ry, w, h, d, color = 0x767d84) {
      bins.beam.push({ x, y, z, ry, sx: w, sy: h, sz: d, c: color });
    },
    /** member between two world points */
    beamBetween(ax, ay, az, bx, by, bz, w, h, color = 0x767d84) {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 0.01;
      bins.beam.push({
        x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2,
        ry: Math.atan2(dx, dz), sx: w, sy: h, sz: len, c: color,
      });
    },
    /** horizontal pipe between two world points (ignores slope) */
    pipeBetween(ax, ay, az, bx, by, bz, radius, color) {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 0.01;
      bins.pipe.push({
        x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2,
        ry: Math.atan2(-dz, dx), sx: len, sy: radius * 2, sz: radius * 2, c: color,
      });
    },
    hazard(x, y, z, ry, w, h, d) {
      bins.hazard.push({ x, y, z, ry, sx: w, sy: h, sz: d });
    },
    wall(x, y, z, ry, w, h, d, color = 0xffffff) {
      bins.wall.push({ x, y, z, ry, sx: w, sy: h, sz: d, c: color });
    },
    container(x, y, z, ry, color) {
      bins.container.push({ x, y, z, ry, sx: CONTAINER.w, sy: CONTAINER.h, sz: CONTAINER.d, c: color });
    },
    tire(x, y, z, ry = 0) {
      bins.tire.push({ x, y, z, rx: Math.PI / 2, rz: ry, sx: 1, sy: 1, sz: 1 });
    },
    fence(x, y, z, ry, w, h) {
      bins.fence.push({ x, y, z, ry, sx: w, sy: h, sz: 1 });
    },
    lamp(x, y, z, ry) {
      bins.lamp.push({ x, y, z, ry, sx: 1, sy: 1, sz: 1 });
    },
    /** jersey barrier segment; y = ground level of the base */
    barrier(x, y, z, ry, len, color) {
      bins.barrier.push({ x, y, z, ry, sx: 1, sy: 1, sz: len, c: color });
    },
    barrel(x, y, z, ry, color) {
      bins.barrel.push({ x, y, z, ry, sx: 1, sy: 1, sz: 1, c: color });
    },
    smoke(x, y, z, s, ry) {
      bins.smoke.push({ x, y, z, ry, sx: s, sy: s * 0.86, sz: s });
    },
    skyTower(x, y, z, radius, height, color) {
      bins.skyTower.push({ x, y, z, sx: radius, sy: height, sz: radius, c: color });
    },
    skyBlock(x, y, z, ry, w, h, d, color) {
      bins.skyBlock.push({ x, y, z, ry, sx: w, sy: h, sz: d, c: color });
    },
    finish() {
      const mats = {
        lattice: new THREE.MeshStandardMaterial({
          map: tex.truss, alphaTest: 0.42, side: THREE.DoubleSide,
          roughness: 0.62, metalness: 0.35, color: 0xb8c1c6,
        }),
        beam: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.58, metalness: 0.34 }),
        hazard: new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.82, metalness: 0.1 }),
        wall: new THREE.MeshStandardMaterial({
          map: tex.wall, roughness: 0.93, metalness: 0.04,
          // a little self-lit bounce keeps a shaded facade from going flat
          emissive: 0x332c24, emissiveIntensity: 0.7,
        }),
        container: new THREE.MeshStandardMaterial({ map: tex.corrugated, roughness: 0.8, metalness: 0.22 }),
        tire: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.96 }),
        fence: new THREE.MeshStandardMaterial({
          map: tex.fence, alphaTest: 0.35, side: THREE.DoubleSide,
          roughness: 0.8, metalness: 0.22, color: 0xa7b1b3,
        }),
        lamp: new THREE.MeshStandardMaterial({
          color: 0x2a0d00, emissive: 0xff8a24, emissiveIntensity: 2.6, roughness: 0.6,
        }),
        barrier: new THREE.MeshStandardMaterial({
          map: tex.barrier, color: 0xffffff, roughness: 0.95, metalness: 0.02,
        }),
        pipe: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.56, metalness: 0.44 }),
        barrel: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74, metalness: 0.28 }),
        smoke: new THREE.MeshStandardMaterial({
          color: 0x33373a, roughness: 1, metalness: 0, transparent: true,
          opacity: 0.26, depthWrite: false, flatShading: true,
        }),
        skyTower: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }),
        skyBlock: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }),
      };

      const built = {
        lattice: buildInstanced(bins.lattice, UNIT_PLANE, mats.lattice, { cast: false, order: 1 }),
        beam: buildInstanced(bins.beam, UNIT_BOX, mats.beam, { tinted: true }),
        hazard: buildInstanced(bins.hazard, UNIT_BOX, mats.hazard),
        wall: buildInstanced(bins.wall, UNIT_BOX, mats.wall, { tinted: true }),
        container: buildInstanced(bins.container, UNIT_BOX, mats.container, { tinted: true }),
        tire: buildInstanced(bins.tire, TIRE_GEO, mats.tire),
        fence: buildInstanced(bins.fence, UNIT_PLANE, mats.fence, { cast: false, order: 1 }),
        lamp: buildInstanced(bins.lamp, LAMP_GEO, mats.lamp, { cast: false, receive: false }),
        barrier: buildInstanced(bins.barrier, BARRIER_GEO, mats.barrier, { tinted: true }),
        pipe: buildInstanced(bins.pipe, PIPE_GEO, mats.pipe, { tinted: true }),
        barrel: buildInstanced(bins.barrel, BARREL_GEO, mats.barrel, { tinted: true }),
        smoke: buildInstanced(bins.smoke, SMOKE_GEO, mats.smoke, { cast: false, receive: false }),
        skyTower: buildInstanced(bins.skyTower, SKY_TOWER_GEO, mats.skyTower, { cast: false, receive: false, tinted: true }),
        skyBlock: buildInstanced(bins.skyBlock, UNIT_BOX, mats.skyBlock, { cast: false, receive: false, tinted: true }),
      };

      let meshes = 0;
      let instances = 0;
      for (const key of Object.keys(built)) {
        const mesh = built[key];
        if (!mesh) continue;
        mesh.name = `scenery-${key}`;
        parent.add(mesh);
        meshes += 1;
        instances += bins[key].length;
      }
      return { meshes, instances, counts: Object.fromEntries(Object.entries(bins).map(([k, v]) => [k, v.length])) };
    },
  };

  return kit;
}

/* -------------------------------------------------------------- profiles */

const BASE = {
  apron: 16,
  // Single source of truth for everything that lines the corridor: metres
  // outward from the road edge (hw). Kept ordered barrier < poles < fence <
  // containers < halls so the bands never cross.
  offsets: {
    barrier: 3.0,
    poles: 3.5,
    fence: 4.6,
    containers: 5.2,
    halls: 7.9,
    gantry: 5.9,
    bridge: 6.4,
  },
  barrierPitch: 4.2,
  fence: { height: 3.1, panel: 6 },
  poles: { pitch: 42, height: 9.4 },
  gantryPitch: 130, gantrySkip: 0.1, clearance: 12.8, trussH: 2.3,
  bridgePitch: 340,
  towerPitch: 150, towerHeight: [20, 32], towerLat: [9, 22],
  conveyors: [],
  hall: { w: [10, 16], h: [12, 18], d: [30, 58], spacing: 62, back: 24, tint: [0xffffff, 0xd8cfc0, 0xb9b6ae] },
  container: { clusters: 34, stack: 3, tints: [0xa94a33, 0x8a5a2c, 0x3f5c63, 0x6b6a5f, 0x7a3d2a, 0x4a5a52] },
  tires: 120,
  barrels: 34,
  skyline: { towers: 7, blocks: 40, pylons: 12, towerR: [180, 820], blockR: [150, 900], pylonR: [560, 1250] },
  industrial: { beam: 0x6f767d, accent: 0xc0491d, hazard: true, rust: 0x8a4526 },
};

function mergeProfile(base, over) {
  return {
    ...base,
    ...over,
    offsets: { ...base.offsets, ...(over.offsets || {}) },
    hall: { ...base.hall, ...(over.hall || {}) },
    container: { ...base.container, ...(over.container || {}) },
    fence: { ...base.fence, ...(over.fence || {}) },
    poles: { ...base.poles, ...(over.poles || {}) },
    industrial: { ...base.industrial, ...(over.industrial || {}) },
    skyline: { ...base.skyline, ...(over.skyline || {}) },
  };
}

const SCENERY_PROFILES = {
  // strongest prison / industrial arena look
  wasteland: mergeProfile(BASE, {
    gantryPitch: 104,
    gantrySkip: 0.04,
    clearance: 13.2,
    trussH: 2.5,
    bridgePitch: 300,
    towerPitch: 116,
    towerHeight: [22, 38],
    towerLat: [9, 20],
    conveyors: [
      { u0: 0.105, u1: 0.225, lateral: 6.6, height: 7.4, side: 1 },
      { u0: 0.44, u1: 0.53, lateral: 7.2, height: 8.2, side: -1 },
      { u0: 0.60, u1: 0.70, lateral: 6.8, height: 7.8, side: 1 },
      { u0: 0.855, u1: 0.945, lateral: 7.0, height: 7.2, side: -1 },
    ],
    hall: { w: [10, 16], h: [12, 18], d: [32, 60], spacing: 56, back: 22, tint: [0xffffff, 0xe0d6c6, 0xc8c2b6, 0xb7b0a4] },
    container: { clusters: 40, stack: 3 },
    tires: 150,
    barrels: 44,
    skyline: { towers: 8, blocks: 46, pylons: 14 },
    industrial: { accent: 0xc2451b, rust: 0x8a4526 },
  }),
  dockyard: mergeProfile(BASE, {
    apron: 17,
    offsets: { halls: 8.4, containers: 5.4 },
    gantryPitch: 124,
    gantrySkip: 0.08,
    clearance: 13.0,
    bridgePitch: 380,
    towerPitch: 150,
    towerHeight: [18, 30],
    towerLat: [10, 24],
    conveyors: [
      { u0: 0.345, u1: 0.455, lateral: 6.8, height: 8.2, side: -1 },
      { u0: 0.72, u1: 0.80, lateral: 7.0, height: 7.4, side: 1 },
    ],
    hall: { w: [11, 18], h: [10, 16], d: [34, 62], spacing: 58, back: 24, tint: [0xdbe2e5, 0xb9c6cb, 0xa9b6bb] },
    container: { clusters: 42, stack: 3, tints: [0x2f6f7a, 0xb2532c, 0x6c7460, 0x8c8f83, 0x394e63] },
    tires: 70,
    barrels: 22,
    skyline: { towers: 5, blocks: 52, pylons: 10 },
    industrial: { accent: 0xd2561f, rust: 0x94502f },
  }),
  volcanic: mergeProfile(BASE, {
    apron: 12,
    offsets: { halls: 7.4, containers: 5.0 },
    gantryPitch: 170,
    gantrySkip: 0.14,
    clearance: 13.6,
    trussH: 2.4,
    bridgePitch: 420,
    towerPitch: 158,
    towerHeight: [24, 40],
    towerLat: [9, 20],
    conveyors: [{ u0: 0.6, u1: 0.665, lateral: 6.2, height: 7.6, side: 1 }],
    hall: { w: [9, 14], h: [9, 15], d: [26, 46], spacing: 68, back: 22, tint: [0xcfc0b2, 0xb0a396, 0x9a8f84] },
    container: { clusters: 22, stack: 2, tints: [0x8a4a33, 0x6d6152, 0x4f5a58, 0x7a3d2a] },
    tires: 70,
    barrels: 20,
    skyline: { towers: 4, blocks: 22, pylons: 8, towerR: [220, 900] },
    industrial: { accent: 0xb03a18, rust: 0x7c3a1f },
  }),
};

/* --------------------------------------------------------------- layouts */

function addGantry(kit, sample, hw, P, rand) {
  const yaw = Math.atan2(sample.tan.x, sample.tan.z);
  const halfSpan = hw + P.offsets.gantry;
  const roadY = sample.pos.y;
  const trussH = P.trussH;
  const topY = roadY + P.clearance + trussH;
  const legW = 1.75;

  for (const side of [-1, 1]) {
    const lat = side * halfSpan;
    const gx = sample.pos.x + sample.right.x * lat;
    const gz = sample.pos.z + sample.right.z * lat;
    const baseY = Math.min(groundHeight(sample, hw, lat, P.apron), roadY);
    const h = topY - baseY;
    const bays = Math.max(3, Math.round(h / 3.3));
    const bayH = h / bays;
    for (let b = 0; b < bays; b++) {
      const cy = baseY + bayH * (b + 0.5);
      kit.lattice(gx, cy, gz, yaw, legW, bayH);
      kit.lattice(gx, cy, gz, yaw + Math.PI / 2, legW, bayH);
    }
    const half = legW / 2;
    for (const ox of [-half, half]) {
      for (const oz of [-half, half]) {
        kit.beam(
          gx + sample.right.x * ox + sample.tan.x * oz,
          baseY + h / 2,
          gz + sample.right.z * ox + sample.tan.z * oz,
          yaw, 0.34, h, 0.34, P.industrial.beam
        );
      }
    }
    kit.beam(gx, baseY + 0.35, gz, yaw, legW + 1.1, 0.7, legW + 1.1, 0x9a968c);
    if (P.industrial.hazard) {
      kit.hazard(
        gx + sample.tan.x * (half + 0.22), baseY + 2.1,
        gz + sample.tan.z * (half + 0.22), yaw, legW, 1.6, 0.16
      );
    }
    kit.lamp(
      gx - sample.right.x * side * (legW * 0.5 + 0.2),
      topY - trussH - 0.55,
      gz - sample.right.z * side * (legW * 0.5 + 0.2),
      yaw
    );
  }

  const bayCount = Math.max(6, Math.round((halfSpan * 2) / 4));
  const bayW = (halfSpan * 2) / bayCount;
  const midY = topY - trussH / 2;
  for (let i = 0; i < bayCount; i++) {
    const lat = -halfSpan + bayW * (i + 0.5);
    const px = sample.pos.x + sample.right.x * lat;
    const pz = sample.pos.z + sample.right.z * lat;
    kit.lattice(px, midY, pz, yaw, bayW, trussH);
    kit.lattice(px, midY, pz, yaw + Math.PI / 2, trussH, trussH);
  }
  for (const y of [topY, topY - trussH]) {
    kit.beam(
      sample.pos.x, y, sample.pos.z, yaw + Math.PI / 2,
      0.36, 0.36, halfSpan * 2, P.industrial.beam
    );
  }
  kit.beam(sample.pos.x, topY - 0.42, sample.pos.z, yaw + Math.PI / 2, 0.14, 0.14, halfSpan * 2, P.industrial.accent);
  if (P.industrial.hazard) {
    kit.hazard(
      sample.pos.x, topY - trussH - 0.3, sample.pos.z,
      yaw + Math.PI / 2, 0.3, 0.52, halfSpan * 1.94
    );
  }

  // service pipes slung under some spans: the plant never stops running
  if (rand() < 0.42) {
    const px = sample.pos.x, pz = sample.pos.z;
    const r = sample.right;
    for (let k = 0; k < 3; k++) {
      const yy = roadY + P.clearance - 1.1 - k * 0.85;
      kit.pipeBetween(
        px - r.x * (halfSpan - 0.6), yy, pz - r.z * (halfSpan - 0.6),
        px + r.x * (halfSpan - 0.6), yy, pz + r.z * (halfSpan - 0.6),
        0.34 - k * 0.06, P.industrial.rust
      );
    }
    kit.beam(px, roadY + P.clearance - 1.5, pz, yaw + Math.PI / 2, 0.2, 0.5, halfSpan * 1.8, P.industrial.beam);
  }
}

/** heavy rusted truss / pipe bridge straddling the road */
function addPipeBridge(kit, sample, hw, P) {
  const yaw = Math.atan2(sample.tan.x, sample.tan.z);
  const halfSpan = hw + P.offsets.bridge;
  const roadY = sample.pos.y;
  const deckH = 3.2;
  const deckY = roadY + P.clearance + 0.2;
  const r = sample.right;

  for (const side of [-1, 1]) {
    const lat = side * halfSpan;
    const gx = sample.pos.x + r.x * lat;
    const gz = sample.pos.z + r.z * lat;
    const baseY = groundHeight(sample, hw, lat, P.apron);
    const h = deckY + deckH - baseY;
    kit.beam(gx, baseY + h / 2, gz, yaw, 1.5, h, 1.5, P.industrial.rust);
    kit.beam(gx, baseY + 0.5, gz, yaw, 2.4, 1.0, 2.4, 0x9a968c);
    kit.hazard(gx + sample.tan.x * 0.82, baseY + 2.2, gz + sample.tan.z * 0.82, yaw, 1.5, 1.7, 0.16);
    // cross bracing up the legs
    for (let k = 1; k < 4; k++) {
      const yy = baseY + (h * k) / 4;
      kit.beam(gx, yy, gz, yaw + Math.PI / 2, 0.18, 0.18, 2.2, P.industrial.beam);
    }
  }

  // deck + lattice trusses either side + catwalk rails
  kit.beam(sample.pos.x, deckY + deckH * 0.35, sample.pos.z, yaw + Math.PI / 2, 3.6, 0.4, halfSpan * 2, P.industrial.rust);
  const bayCount = Math.max(5, Math.round((halfSpan * 2) / 4.6));
  const bayW = (halfSpan * 2) / bayCount;
  for (let i = 0; i < bayCount; i++) {
    const lat = -halfSpan + bayW * (i + 0.5);
    const px = sample.pos.x + r.x * lat;
    const pz = sample.pos.z + r.z * lat;
    for (const off of [-1.8, 1.8]) {
      kit.lattice(
        px + sample.tan.x * off, deckY + deckH * 0.5, pz + sample.tan.z * off,
        yaw, bayW, deckH
      );
    }
  }
  for (const off of [-1.8, 1.8]) {
    for (const yy of [deckY + deckH, deckY]) {
      kit.beam(
        sample.pos.x + sample.tan.x * off, yy, sample.pos.z + sample.tan.z * off,
        yaw + Math.PI / 2, 0.3, 0.3, halfSpan * 2, P.industrial.beam
      );
    }
    kit.beam(
      sample.pos.x + sample.tan.x * (off - 0.9), deckY - 1.1, sample.pos.z + sample.tan.z * (off - 0.9),
      yaw + Math.PI / 2, 0.1, 0.1, halfSpan * 2, P.industrial.accent
    );
  }
  // fat pipes under the deck
  for (let k = 0; k < 3; k++) {
    const yy = deckY - 1.5 - k * 0.9;
    kit.pipeBetween(
      sample.pos.x - r.x * (halfSpan - 0.5), yy, sample.pos.z - r.z * (halfSpan - 0.5),
      sample.pos.x + r.x * (halfSpan - 0.5), yy, sample.pos.z + r.z * (halfSpan - 0.5),
      0.44 - k * 0.07, P.industrial.rust
    );
  }
  kit.hazard(
    sample.pos.x, deckY - 0.1, sample.pos.z,
    yaw + Math.PI / 2, 0.4, 0.62, halfSpan * 1.9
  );
}

function addTower(kit, sample, hw, P, rand, lateral) {
  const yaw = Math.atan2(sample.tan.x, sample.tan.z);
  const x = sample.pos.x + sample.right.x * lateral;
  const z = sample.pos.z + sample.right.z * lateral;
  const baseY = groundHeight(sample, hw, lateral, P.apron);
  const height = P.towerHeight[0] + rand() * (P.towerHeight[1] - P.towerHeight[0]);
  const levels = 3;
  const levelH = height / levels;

  for (let i = 0; i < levels; i++) {
    const w = 3.4 * (1 - i * 0.2);
    const cy = baseY + levelH * (i + 0.5);
    const segs = Math.max(2, Math.round(levelH / 3.4));
    const segH = levelH / segs;
    for (let k = 0; k < segs; k++) {
      const sy = baseY + levelH * i + segH * (k + 0.5);
      kit.lattice(x, sy, z, yaw, w, segH);
      kit.lattice(x, sy, z, yaw + Math.PI / 2, w, segH);
    }
    const half = w / 2;
    for (const ox of [-half, half]) {
      for (const oz of [-half, half]) {
        kit.beam(x + ox, cy, z + oz, yaw, 0.28, levelH, 0.28, P.industrial.beam);
      }
    }
    kit.beam(x, baseY + levelH * (i + 1), z, yaw, 0.22, 0.22, w + 0.3, P.industrial.accent);
    kit.beam(x, baseY + levelH * (i + 1), z, yaw + Math.PI / 2, 0.22, 0.22, w + 0.3, P.industrial.accent);
  }
  kit.beam(x, baseY + height, z, yaw, 3.6, 0.4, 3.6, P.industrial.beam);
  kit.hazard(x, baseY + 1.4, z, yaw, 3.6, 1.1, 0.2);
  kit.hazard(x, baseY + 1.4, z, yaw + Math.PI / 2, 3.6, 1.1, 0.2);
}

function addConveyor(kit, samples, hw, P, cfg) {
  const N = samples.length;
  const i0 = Math.floor(((cfg.u0 % 1) + 1) % 1 * N);
  const i1 = Math.floor(((cfg.u1 % 1) + 1) % 1 * N);
  const total = ((i1 - i0) + N) % N;
  const step = Math.max(3, Math.round(11 / (samples[1].dist - samples[0].dist)));
  const railH = 1.7;
  let station = 0;
  for (let k = 0; k < total; k += step, station++) {
    const a = samples[(i0 + k) % N];
    const b = samples[(i0 + k + step) % N];
    const lat = cfg.side * (hw + cfg.lateral);
    const ay = groundHeight(a, hw, lat, P.apron) + cfg.height;
    const by = groundHeight(b, hw, lat, P.apron) + cfg.height;
    const ax = a.pos.x + a.right.x * lat, az = a.pos.z + a.right.z * lat;
    const bx = b.pos.x + b.right.x * lat, bz = b.pos.z + b.right.z * lat;
    const len = Math.hypot(bx - ax, bz - az);
    const midX = (ax + bx) / 2, midZ = (az + bz) / 2;
    const yaw = Math.atan2(bx - ax, bz - az);

    kit.beamBetween(ax, ay, az, bx, by, bz, 0.24, 0.24, P.industrial.beam);
    kit.beamBetween(ax, ay - railH, az, bx, by - railH, bz, 0.24, 0.24, P.industrial.beam);
    const sideX = Math.sin(yaw) * 1.05;
    const sideZ = Math.cos(yaw) * 1.05;
    kit.lattice(midX + sideX, (ay + by) / 2 - railH / 2, midZ + sideZ, yaw + Math.PI / 2, len, railH);
    kit.lattice(midX - sideX, (ay + by) / 2 - railH / 2, midZ - sideZ, yaw + Math.PI / 2, len, railH);
    if (station % 5 === 0) {
      kit.hazard(midX, (ay + by) / 2 - railH / 2, midZ, yaw + Math.PI / 2, len * 0.82, 0.5, 0.16);
    }

    if (station % 3 === 0) {
      const baseY = groundHeight(a, hw, lat, P.apron);
      const h = ay - railH - baseY;
      if (h > 2) {
        const w = 1.9;
        kit.lattice(ax, baseY + h / 2, az, 0, w, h);
        kit.lattice(ax, baseY + h / 2, az, Math.PI / 2, w, h);
        for (const ox of [-w / 2, w / 2]) {
          kit.beam(ax + ox, baseY + h / 2, az, 0, 0.24, h, 0.24, P.industrial.beam);
        }
        kit.beam(ax, baseY + h, az, 0, 2.4, 0.3, 2.4, P.industrial.beam);
        kit.hazard(ax, baseY + 1.2, az, 0, 2.0, 1.0, 0.14);
      }
    }
  }
}

/** long brick-concrete prison/factory halls, long axis parallel to the road.
    Walks the lap so the frontage is a continuous corridor instead of a
    scattering of isolated boxes, with a second row behind it. */
function addHalls(kit, samples, hw, rand, P) {
  const cfg = P.hall;
  const N = samples.length;
  const ds = samples[1].dist - samples[0].dist;
  const spacing = Math.max(4, Math.round(cfg.spacing / ds));
  const totalLen = samples[N - 1].dist;
  let placed = 0;

  const put = (s, side, w, hgt, dep, back) => {
    const yaw = Math.atan2(s.tan.x, s.tan.z) + (rand() - 0.5) * 0.08;
    const gap = P.offsets.halls;
    const lat = side * (hw + gap + w / 2 + back + rand() * 1.8);
    const x = s.pos.x + s.right.x * lat;
    const z = s.pos.z + s.right.z * lat;
    if (!footprintClear(samples, x, z, hw, yaw, w / 2 + 0.6, dep / 2 + 0.6, gap - 1.4)) return;
    const baseY = groundHeight(s, hw, lat, P.apron);
    const tint = cfg.tint[Math.floor(rand() * cfg.tint.length)];
    const dir = -side;

    kit.wall(x, baseY + hgt / 2, z, yaw, w, hgt, dep, tint);
    kit.beam(x, baseY + hgt + 0.3, z, yaw, w + 0.9, 0.7, dep + 0.9, 0x8a8478);

    // steel buttresses on the face that looks at the racing surface
    const bays = Math.max(2, Math.round(dep / 9));
    const bayD = dep / bays;
    for (let b = 0; b <= bays; b++) {
      const along = -dep / 2 + bayD * b;
      const bx = x + s.right.x * dir * (w / 2 + 0.45) + s.tan.x * along;
      const bz = z + s.right.z * dir * (w / 2 + 0.45) + s.tan.z * along;
      kit.beam(bx, baseY + hgt / 2, bz, yaw, 0.5, hgt, 0.5, 0x6e6a60);
      kit.beam(bx, baseY + hgt - 0.9, bz, yaw, 0.85, 0.32, 0.85, 0x7d786d);
    }
    if (!back) {
      kit.hazard(
        x + s.right.x * dir * (w / 2 + 0.12), baseY + 2.1,
        z + s.right.z * dir * (w / 2 + 0.12), yaw, 2.8, 4.2, 0.18
      );
    }
    // rooftop vents and pipe runs
    const vents = back ? 1 : 2 + Math.floor(rand() * 3);
    for (let v = 0; v < vents; v++) {
      const along = -dep * 0.35 + rand() * dep * 0.7;
      const across = (rand() - 0.5) * w * 0.6;
      const vx = x + s.tan.x * along + s.right.x * across;
      const vz = z + s.tan.z * along + s.right.z * across;
      const vh = 1.2 + rand() * 2.4;
      kit.beam(vx, baseY + hgt + 0.7 + vh / 2, vz, yaw, 1.1 + rand() * 1.2, vh, 1.1 + rand() * 1.2, 0x5f5b55);
    }
    if (!back && rand() < 0.55) {
      kit.pipeBetween(
        x - s.tan.x * dep * 0.45 + s.right.x * dir * (w / 2 - 1.0), baseY + hgt + 0.9,
        z - s.tan.z * dep * 0.45 + s.right.z * dir * (w / 2 - 1.0),
        x + s.tan.x * dep * 0.45 + s.right.x * dir * (w / 2 - 1.0), baseY + hgt + 0.9,
        z + s.tan.z * dep * 0.45 + s.right.z * dir * (w / 2 - 1.0),
        0.26, P.industrial.rust
      );
    }
    placed++;
  };

  let station = 0;
  for (let i = Math.round(spacing * 0.25); i < N - 1; i += spacing, station++) {
    const s = samples[i];
    if (s.dist < 70 || s.dist > totalLen - 80) continue;
    for (const side of [-1, 1]) {
      if (rand() < 0.1) continue;
      const w = cfg.w[0] + rand() * (cfg.w[1] - cfg.w[0]);
      const hgt = cfg.h[0] + rand() * (cfg.h[1] - cfg.h[0]);
      const dep = cfg.d[0] + rand() * (cfg.d[1] - cfg.d[0]);
      put(s, side, w, hgt, dep, 0);
    }
    // second industrial row / outlying sheds fill the middle distance
    if (station % 2 === 0) {
      const s2 = samples[(i + Math.round(spacing * 0.5)) % N];
      for (const side of [-1, 1]) {
        if (rand() < 0.42) continue;
        put(s2, side, 12 + rand() * 12, 7 + rand() * 7, 26 + rand() * 28, cfg.back);
      }
    }
  }
  return placed;
}

/** tight arena walls of double/triple stacked containers */
function addContainers(kit, samples, hw, rand, P, findSpot) {
  const cfg = P.container;
  const gap = P.offsets.containers;
  let placed = 0;
  for (let k = 0; k < cfg.clusters * 6 && placed < cfg.clusters; k++) {
    const minLat = hw + gap + CONTAINER.d / 2;
    const maxLat = minLat + 4.5;
    const spot = findSpot(rand, samples, hw, minLat, maxLat, minLat);
    if (!spot) continue;
    const s = spot.sample;
    const lat = lateralOf(s, spot.x, spot.z);
    const baseY = groundHeight(s, hw, lat, P.apron);
    const yaw = Math.atan2(s.tan.x, s.tan.z) + Math.PI / 2 + (rand() - 0.5) * 0.12;
    // a run of up to 3 containers end to end along the road edge
    const run = 1 + Math.floor(rand() * 3);
    const layers = 1 + Math.floor(rand() * cfg.stack);
    const tint = cfg.tints[Math.floor(rand() * cfg.tints.length)];
    const dirAlong = s.tan;
    if (!footprintClear(samples, spot.x, spot.z, hw, yaw, CONTAINER.d / 2 + 0.7, (run * (CONTAINER.w + 0.4)) / 2, gap - 1.0)) continue;
    for (let r = 0; r < run; r++) {
      const off = (r - (run - 1) / 2) * (CONTAINER.w + 0.15);
      const cx = spot.x + dirAlong.x * off;
      const cz = spot.z + dirAlong.z * off;
      for (let l = 0; l < layers; l++) {
        kit.container(cx, baseY + CONTAINER.h / 2 + l * (CONTAINER.h + 0.02), cz, yaw + (l ? 0.02 : 0), tint);
      }
      if (r === Math.floor(run / 2) && rand() < 0.55) {
        const dir = -(Math.sign(lat) || 1);
        kit.hazard(
          cx + s.right.x * dir * (CONTAINER.d / 2 + 0.07), baseY + 1.3,
          cz + s.right.z * dir * (CONTAINER.d / 2 + 0.07),
          yaw, CONTAINER.w - 0.2, 2.2, 0.16
        );
      }
    }
    placed++;
  }
}

/** continuous jersey barrier line, chain-link security fence and light poles */
function addSecurityLine(kit, samples, hw, P, rand) {
  const N = samples.length;
  const ds = samples[1].dist - samples[0].dist;
  const O = P.offsets;

  /* --- jersey barriers, both sides, along the whole lap --- */
  const barrierStep = Math.max(2, Math.round(P.barrierPitch / ds));
  for (let i = 0; i < N; i += barrierStep) {
    const a = samples[i];
    const b = samples[(i + barrierStep) % N];
    for (const side of [-1, 1]) {
      const lat = side * (hw + O.barrier);
      const ax = a.pos.x + a.right.x * lat, az = a.pos.z + a.right.z * lat;
      const bx = b.pos.x + b.right.x * lat, bz = b.pos.z + b.right.z * lat;
      const len = Math.hypot(bx - ax, bz - az) - 0.16;
      const yaw = Math.atan2(bx - ax, bz - az);
      const y = groundHeight(a, hw, lat, P.apron);
      const tint = rand() < 0.22 ? 0xb0a898 : 0xffffff;
      kit.barrier((ax + bx) / 2, y, (az + bz) / 2, yaw, len, tint);
    }
  }

  /* --- chain-link security fence with steel posts and top rail --- */
  const fenceStep = Math.max(2, Math.round(P.fence.panel / ds));
  for (let i = 0; i < N; i += fenceStep) {
    const a = samples[i];
    const b = samples[(i + fenceStep) % N];
    for (const side of [-1, 1]) {
      // service gates: short breaks so the run never feels like a solid wall
      if (((i / fenceStep) | 0) % 37 === 9) continue;
      const lat = side * (hw + O.fence);
      const ax = a.pos.x + a.right.x * lat, az = a.pos.z + a.right.z * lat;
      const bx = b.pos.x + b.right.x * lat, bz = b.pos.z + b.right.z * lat;
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(bx - ax, bz - az);
      const ay = groundHeight(a, hw, lat, P.apron);
      const by = groundHeight(b, hw, lat, P.apron);
      const h = P.fence.height;
      kit.fence((ax + bx) / 2, (ay + by) / 2 + h / 2, (az + bz) / 2, yaw + Math.PI / 2, len, h);
      kit.beam(ax, ay + h / 2, az, 0, 0.15, h, 0.15, 0x767f86);
      kit.beamBetween(ax, ay + h - 0.06, az, bx, by + h - 0.06, bz, 0.1, 0.1, 0x8b939a);
    }
  }

  /* --- light poles, every ~40 m, staggered so both edges strobe past --- */
  const poleStep = Math.max(2, Math.round(P.poles.pitch / ds));
  let flip = 1;
  for (let i = 0; i < N; i += poleStep) {
    const s = samples[i];
    flip = -flip;
    for (const side of flip > 0 ? [-1, 1] : [1]) {
      const lat = side * (hw + O.poles);
      const px = s.pos.x + s.right.x * lat;
      const pz = s.pos.z + s.right.z * lat;
      const baseY = groundHeight(s, hw, lat, P.apron);
      const h = P.poles.height;
      const yaw = Math.atan2(s.tan.x, s.tan.z);
      kit.beam(px, baseY + h / 2, pz, yaw, 0.26, h, 0.26, 0x6d747a);
      kit.beam(px, baseY + 0.4, pz, yaw, 0.7, 0.8, 0.7, 0x9a968c);
      // arm reaching over the shoulder
      const tipX = px - s.right.x * side * 2.7;
      const tipZ = pz - s.right.z * side * 2.7;
      kit.beamBetween(px, baseY + h - 0.15, pz, tipX, baseY + h + 0.35, tipZ, 0.16, 0.16, 0x6d747a);
      kit.lamp(tipX, baseY + h + 0.25, tipZ, yaw);
    }
  }
}

function addClutter(kit, samples, hw, rand, P, findSpot) {
  // everything below lives in the service yard between the security line and
  // the hall facades, so these bands follow the shared offsets
  const yardIn = hw + P.offsets.fence + 0.5;
  const yardOut = hw + Math.max(P.offsets.fence + 1.4, P.offsets.halls - 0.6);
  // tire stacks against the barrier line
  for (let i = 0; i < P.tires; i++) {
    const spot = findSpot(rand, samples, hw, yardIn, yardOut, yardIn);
    if (!spot) continue;
    const lat = lateralOf(spot.sample, spot.x, spot.z);
    const baseY = groundHeight(spot.sample, hw, lat, P.apron);
    const stack = 1 + Math.floor(rand() * 4);
    for (let l = 0; l < stack; l++) {
      kit.tire(spot.x, baseY + 0.26 + l * 0.44, spot.z, rand() * Math.PI);
    }
  }
  // scrap plating / pallets
  for (let i = 0; i < Math.round(P.tires * 0.4); i++) {
    const spot = findSpot(rand, samples, hw, yardIn, yardOut, yardIn);
    if (!spot) continue;
    const lat = lateralOf(spot.sample, spot.x, spot.z);
    const baseY = groundHeight(spot.sample, hw, lat, P.apron);
    kit.beam(
      spot.x, baseY + 0.25 + rand() * 0.6, spot.z,
      rand() * Math.PI, 1.4 + rand() * 2.6, 0.22 + rand() * 0.5, 1.2 + rand() * 2.2,
      0x6b5f52
    );
  }
  // smoking barrels tucked into the yards
  const barrelTints = [0x8a4529, 0xa8552c, 0x6d5a45, 0x87412b];
  for (let i = 0; i < P.barrels; i++) {
    const spot = findSpot(rand, samples, hw, yardIn, yardOut, yardIn);
    if (!spot) continue;
    const lat = lateralOf(spot.sample, spot.x, spot.z);
    const baseY = groundHeight(spot.sample, hw, lat, P.apron);
    const tint = barrelTints[Math.floor(rand() * barrelTints.length)];
    const n = 2 + Math.floor(rand() * 3);
    for (let b = 0; b < n; b++) {
      const ox = (rand() - 0.5) * 1.6;
      const oz = (rand() - 0.5) * 1.6;
      kit.barrel(spot.x + ox, baseY + 0.6, spot.z + oz, rand() * Math.PI, tint);
    }
    if (rand() < 0.5) {
      for (let p = 0; p < 4; p++) {
        kit.smoke(
          spot.x + (rand() - 0.5) * 1.2 + p * 0.5,
          baseY + 2.2 + p * 1.9,
          spot.z + (rand() - 0.5) * 1.2,
          1.1 + p * 0.55,
          rand() * Math.PI
        );
      }
    }
  }
}

/** cooling towers, factory roofs, cranes and pylons on the horizon */
function addSkyline(kit, samples, hw, P, rand) {
  const cfg = P.skyline;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of samples) {
    if (s.pos.x < minX) minX = s.pos.x;
    if (s.pos.x > maxX) maxX = s.pos.x;
    if (s.pos.z < minZ) minZ = s.pos.z;
    if (s.pos.z > maxZ) maxZ = s.pos.z;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ) * 0.5;

  const pick = (r, avoid) => {
    for (let k = 0; k < 30; k++) {
      const a = rand() * Math.PI * 2;
      const dist = span * 0.55 + r[0] + rand() * (r[1] - r[0]);
      const x = cx + Math.cos(a) * dist;
      const z = cz + Math.sin(a) * dist;
      if (clearanceAt(samples, x, z) > avoid) return [x, z];
    }
    return null;
  };

  const towerTints = [0x6f757a, 0x7c8085, 0x676d72];
  for (let i = 0; i < cfg.towers; i++) {
    const p = pick(cfg.towerR, 180);
    if (!p) continue;
    const r = 17 + rand() * 13;
    const h = 56 + rand() * 40;
    kit.skyTower(p[0], h / 2, p[1], r, h, towerTints[Math.floor(rand() * towerTints.length)]);
    // steam plume of pale blocks above the tower mouth
    for (let s = 0; s < 3; s++) {
      kit.skyBlock(p[0], h + 8 + s * 12, p[1], 0, r * (1.1 + s * 0.35), 12, r * (1.1 + s * 0.35), 0x8f979c);
    }
  }

  const blockTints = [0x5f656a, 0x6b6f72, 0x575d62, 0x74706a, 0x4f565b];
  for (let i = 0; i < cfg.blocks; i++) {
    const p = pick(cfg.blockR, 140);
    if (!p) continue;
    const w = 26 + rand() * 64;
    const h = 7 + rand() * 16;
    const d = 22 + rand() * 44;
    kit.skyBlock(p[0], h / 2, p[1], rand() * Math.PI, w, h, d, blockTints[Math.floor(rand() * blockTints.length)]);
    if (rand() < 0.35) {
      // sawtooth roof vent
      kit.skyBlock(p[0], h + 3, p[1], rand() * Math.PI, w * 0.25, 6, d * 0.4, 0x4b5156);
    }
  }

  // high-voltage pylons
  const pylonColor = 0x4c5258;
  for (let i = 0; i < cfg.pylons; i++) {
    const p = pick(cfg.pylonR, 220);
    if (!p) continue;
    const [x, z] = p;
    const h = 26 + rand() * 12;
    const spread = 3.2;
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      kit.beamBetween(
        x + ox * spread, 0, z + oz * spread,
        x + ox * 0.9, h, z + oz * 0.9,
        0.34, 0.34, pylonColor
      );
    }
    for (const yy of [h * 0.72, h * 0.86, h]) {
      const arm = yy === h * 0.86 ? 8 : 5.4;
      kit.beam(x, yy, z, 0, arm * 2, 0.3, 0.3, pylonColor);
      kit.beam(x, yy, z, Math.PI / 2, arm * 2, 0.3, 0.3, pylonColor);
    }
  }
}

/* ----------------------------------------------------------------- public */

export function buildScenery({ samples, hw, rand, findSpot, parent, pattern, apron }) {
  const profileKey = pattern && SCENERY_PROFILES[pattern] ? pattern : 'wasteland';
  const base = SCENERY_PROFILES[profileKey];
  const P = apron ? { ...base, apron } : base;
  const tex = makeSceneryTextures(0x9e3779b1 + profileKey.length * 7919);
  const kit = createSceneryKit(parent, tex);
  const N = samples.length;
  const ds = samples.length > 1 ? samples[1].dist - samples[0].dist : 3.2;

  // ---- overhead truss gantries (start / finish stays clear)
  const totalLen = samples[N - 1].dist + ds;
  const gantryStep = Math.max(2, Math.round(P.gantryPitch / ds));
  for (let i = gantryStep; i < N; i += gantryStep) {
    const s = samples[i];
    if (s.dist < 85 || s.dist > totalLen - 95) continue;
    if (rand() < P.gantrySkip) continue;
    addGantry(kit, s, hw, P, rand);
  }

  // ---- heavy pipe / truss bridges over the road
  const bridgeStep = Math.max(3, Math.round(P.bridgePitch / ds));
  for (let i = Math.floor(bridgeStep * 0.55); i < N; i += bridgeStep) {
    const s = samples[i];
    if (s.dist < 150 || s.dist > totalLen - 160) continue;
    addPipeBridge(kit, s, hw, P);
  }

  // ---- side lattice towers
  const towerStep = Math.max(2, Math.round(P.towerPitch / ds));
  let side = 1;
  for (let i = Math.floor(towerStep * 0.6); i < N; i += towerStep) {
    const s = samples[i];
    side = -side;
    if (rand() < 0.15) continue;
    const lat = side * (hw + P.towerLat[0] + rand() * (P.towerLat[1] - P.towerLat[0]));
    addTower(kit, s, hw, P, rand, lat);
  }

  // ---- elevated conveyor / catwalk runs
  for (const run of P.conveyors) addConveyor(kit, samples, hw, P, run);

  // ---- prison / factory halls, container walls, arena security line
  addHalls(kit, samples, hw, rand, P);
  addContainers(kit, samples, hw, rand, P, findSpot);
  addSecurityLine(kit, samples, hw, P, rand);
  addClutter(kit, samples, hw, rand, P, findSpot);

  // ---- distant industrial skyline
  addSkyline(kit, samples, hw, P, rand);

  const stats = kit.finish();
  return { ...stats, profile: profileKey };
}
