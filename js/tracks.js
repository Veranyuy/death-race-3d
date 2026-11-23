import * as THREE from './vendor/three.module.js';
import { buildScenery, groundHeight, slopeOuterOffset } from './scenery.js';

/* =========================================================================
   DEATH RACE 3D — Track engine
   Closed CatmullRom circuits -> road mesh, curbs, rails, pads, backdrops.
   ========================================================================= */

export const PAD_TYPES = {
  nitro: { label: 'NITRO BOOST', color: 0x35f2ff, css: '#35f2ff' },
  reload: { label: 'WEAPON RELOAD', color: 0xff8a24, css: '#ff8a24' },
  armor: { label: 'ARMOR REPAIR', color: 0x4dff86, css: '#4dff86' },
};

export const TRACK_DEFS = [
  {
    id: 'terminal',
    name: 'Terminal Wasteland',
    meta: '5.40 km · 19 corners · Monza / Baku',
    length: 5399.9,
    corners: 19,
    width: 20,
    points: [
      [397.4, 1.5, 0],
      [794.8, 3, 0],
      [825.5, 3, 9.9],
      [878.5, 3.1, 48.1],
      [928.8, 3.2, 54.2],
      [958.3, 3.2, 42.4],
      [1052.2, 3.2, 58.6],
      [1151.3, 3, 145.8],
      [1149, 2.9, 212.2],
      [1062.5, 2.6, 278.4],
      [1048.2, 2.5, 327.4],
      [1086.2, 2.2, 430.5],
      [1062.5, 2, 485],
      [966.3, 1.8, 525.5],
      [942.4, 1.6, 579.3],
      [978.6, 1.4, 682.7],
      [953.9, 1.3, 736.9],
      [851.2, 1.1, 778],
      [827, 1.1, 833.4],
      [847.1, 1.1, 885.6],
      [841.8, 1.1, 933.6],
      [793.2, 1.2, 1006.5],
      [769.4, 1.3, 1019.2],
      [700.1, 1.4, 1019.2],
      [671.4, 1.6, 991.1],
      [668.8, 2, 858.3],
      [604.5, 2.4, 808],
      [309.7, 3.5, 875],
      [231.8, 3.8, 873.6],
      [165.9, 3.9, 856],
      [103.9, 4.1, 851.8],
      [-196.9, 4.1, 889.4],
      [-252.3, 4.1, 882.6],
      [-315.9, 4, 858.2],
      [-371.3, 3.9, 851.4],
      [-540.4, 3.5, 872.6],
      [-637, 3.2, 792.5],
      [-658.4, 2.3, 441.9],
      [-679.9, 2, 91.3],
      [-594, 1.8, 0],
      [-297, 1.1, 0],
    ],
    pads: [
      { u: 0.0587, offset: -3, type: 'nitro' },
      { u: 0.0844, offset: 3, type: 'reload' },
      { u: 0.135, offset: -3, type: 'armor' },
      { u: 0.1706, offset: 3, type: 'nitro' },
      { u: 0.2006, offset: -3, type: 'reload' },
      { u: 0.2319, offset: 3, type: 'armor' },
      { u: 0.2631, offset: -3, type: 'nitro' },
      { u: 0.345, offset: 3, type: 'reload' },
      { u: 0.3906, offset: -3, type: 'armor' },
      { u: 0.4313, offset: 3, type: 'nitro' },
      { u: 0.4969, offset: -3, type: 'reload' },
      { u: 0.5575, offset: 3, type: 'armor' },
      { u: 0.6156, offset: -3, type: 'nitro' },
      { u: 0.6713, offset: 3, type: 'reload' },
      { u: 0.7769, offset: -3, type: 'armor' },
      { u: 0.8263, offset: 3, type: 'nitro' },
      { u: 0.9119, offset: -3, type: 'reload' },
      { u: 0.9369, offset: 3, type: 'armor' },
    ],
    theme: {
      skyTop: 0x2b333b, skyHorizon: 0xa9b3b8, sun: 0xd9dee0, skyCloud: 0.55,
      fog: 0x7f8a91, fogNear: 230, fogFar: 1700,
      hemiSky: 0xa9bcc6, hemiGround: 0x5c5750, hemiIntensity: 1.4,
      sunIntensity: 1.5,
      roadTint: 0xbcb8b1, roadTex: 'asphalt',
      groundColor: 0xc9c3b6, groundTex: 'dirt', overviewLift: 0x27251f,
      gravelColor: 0x8d8a82,
      apron: 18,
      rail: 'concrete', curbA: 0xc23c22, curbB: 0xe4dfd2,
      sunDir: [-0.35, 0.78, 0.5],
      props: 'wasteland',
    },
  },
  {
    id: 'volcanic',
    name: 'Volcanic Ridge',
    meta: '5.58 km · 19 corners · Suzuka / Spa',
    length: 5579.7,
    corners: 19,
    width: 18,
    points: [
      [319.2, 24.4, 0],
      [638.4, 48.9, 0],
      [721.7, 52, 23.4],
      [862.7, 57.1, 109.6],
      [984.8, 66.1, 128.3],
      [1052.7, 70.8, 111.3],
      [1155.3, 75.8, 167.7],
      [1170.9, 75.9, 214.3],
      [1216.6, 74.8, 265.1],
      [1260.2, 73.4, 284.9],
      [1289.4, 69, 378.5],
      [1315.3, 65, 477.2],
      [1325.9, 64.8, 482],
      [1355.1, 64.3, 575.6],
      [1374.3, 68.9, 686.1],
      [1382.4, 69.4, 691.7],
      [1433.8, 78.9, 812],
      [1428.2, 81.4, 848.4],
      [1366.4, 87.6, 933.1],
      [1276.8, 90, 977.9],
      [1227.6, 89, 1044.6],
      [1213.4, 85.5, 1129.7],
      [1181.9, 83, 1156.4],
      [1079.5, 76.3, 1156.4],
      [1047.8, 73.3, 1128.4],
      [1029.5, 66.7, 982.5],
      [992.2, 66, 929.7],
      [939.5, 64.6, 903.4],
      [898.1, 62.2, 897],
      [594.8, 36.6, 945.6],
      [291.6, 43.3, 994.1],
      [234, 45.8, 994.1],
      [-258.2, 61.4, 915.8],
      [-348.7, 67.9, 859.4],
      [-542.2, 70.1, 584.4],
      [-565.1, 65, 512.2],
      [-565.1, 34.8, 108.4],
      [-456.6, 29.8, 0],
    ],
    pads: [
      { u: 0.0431, offset: -3, type: 'nitro' },
      { u: 0.0831, offset: 3, type: 'reload' },
      { u: 0.1138, offset: -3, type: 'armor' },
      { u: 0.13, offset: 3, type: 'nitro' },
      { u: 0.3231, offset: -3, type: 'reload' },
      { u: 0.3556, offset: 3, type: 'armor' },
      { u: 0.4088, offset: -3, type: 'nitro' },
      { u: 0.465, offset: 3, type: 'reload' },
      { u: 0.5513, offset: -3, type: 'armor' },
      { u: 0.5856, offset: 3, type: 'nitro' },
      { u: 0.6512, offset: -3, type: 'reload' },
      { u: 0.6944, offset: 3, type: 'armor' },
      { u: 0.7306, offset: -3, type: 'nitro' },
      { u: 0.7688, offset: 3, type: 'reload' },
      { u: 0.8175, offset: -3, type: 'armor' },
      { u: 0.87, offset: 3, type: 'nitro' },
      { u: 0.9287, offset: -3, type: 'reload' },
      { u: 0.9525, offset: 3, type: 'armor' },
    ],
    theme: {
      skyTop: 0x24262b, skyHorizon: 0xab9484, sun: 0xe8d6c8, skyCloud: 0.32,
      fog: 0x5a5048, fogNear: 250, fogFar: 1650,
      hemiSky: 0x9aa4ac, hemiGround: 0x4a3b32, hemiIntensity: 1.15,
      sunIntensity: 1.7,
      roadTint: 0x84817d, roadTex: 'ash',
      groundColor: 0xa89e96, groundTex: 'basalt', overviewLift: 0x35302b,
      gravelColor: 0x4b4038,
      apron: 12,
      rail: 'steel', curbA: 0xd8451f, curbB: 0xded6c6,
      sunDir: [-0.35, 1.0, 0.3],
      props: 'volcanic',
    },
  },
  {
    id: 'dockyard',
    name: 'Dockyard Run',
    meta: '4.72 km · 17 corners · Monaco / Barcelona',
    length: 4720,
    corners: 17,
    width: 22,
    points: [
      [401, 1.4, 0],
      [802, 1.9, 0],
      [851.9, 2, 32.7],
      [955.2, 2.3, 270.3],
      [960.3, 2.3, 279.7],
      [994.7, 2.3, 331.2],
      [976.4, 2.4, 415.9],
      [890.3, 2.4, 469.7],
      [867.8, 2.4, 556.8],
      [934, 2.4, 675.9],
      [945.1, 2.3, 764.5],
      [903.9, 2.2, 921],
      [872.3, 2.2, 945.4],
      [744, 2, 945.4],
      [712.2, 2, 920.1],
      [699.3, 1.9, 864.5],
      [607.9, 1.8, 809.1],
      [441, 1.7, 852.7],
      [374.9, 1.6, 846.7],
      [262.7, 1.5, 794.3],
      [190.3, 1.5, 790.2],
      [-69.2, 1.4, 876.7],
      [-123.5, 1.4, 882.8],
      [-292.3, 1.6, 865.9],
      [-344.7, 1.7, 819.8],
      [-365.7, 1.8, 728.8],
      [-390.2, 1.9, 692.8],
      [-531, 2.2, 596.6],
      [-535.1, 2.4, 498.8],
      [-510.6, 2.5, 478.7],
      [-500.3, 2.6, 397],
      [-581.3, 2.8, 286.6],
      [-590.7, 2.8, 235.4],
      [-546.2, 2.7, 72.2],
      [-451.7, 2.4, 0],
    ],
    pads: [
      { u: 0.0681, offset: -4, type: 'nitro' },
      { u: 0.11, offset: 4, type: 'reload' },
      { u: 0.1363, offset: -4, type: 'armor' },
      { u: 0.1606, offset: 4, type: 'nitro' },
      { u: 0.1963, offset: -4, type: 'reload' },
      { u: 0.2406, offset: 4, type: 'armor' },
      { u: 0.2881, offset: -4, type: 'nitro' },
      { u: 0.3306, offset: 4, type: 'reload' },
      { u: 0.4031, offset: -4, type: 'armor' },
      { u: 0.4531, offset: 4, type: 'nitro' },
      { u: 0.4963, offset: -4, type: 'reload' },
      { u: 0.5656, offset: 4, type: 'armor' },
      { u: 0.6131, offset: -4, type: 'nitro' },
      { u: 0.7281, offset: 4, type: 'reload' },
      { u: 0.7688, offset: -4, type: 'armor' },
      { u: 0.8306, offset: 4, type: 'nitro' },
      { u: 0.8981, offset: -4, type: 'reload' },
      { u: 0.9269, offset: 4, type: 'armor' },
    ],
    theme: {
      skyTop: 0x25313a, skyHorizon: 0x9dabb2, sun: 0xe6ebee, skyCloud: 0.5,
      fog: 0x74828b, fogNear: 235, fogFar: 1600,
      hemiSky: 0xa9c8da, hemiGround: 0x46555c, hemiIntensity: 1.3,
      sunIntensity: 1.45,
      roadTint: 0xbac1c6, roadTex: 'tarmac',
      groundColor: 0xc6cacb, groundTex: 'tarmac', overviewLift: 0x3a3f43,
      gravelColor: 0x6b7073,
      apron: 17,
      rail: 'steel', curbA: 0xd23a26, curbB: 0xe9e6dd,
      sunDir: [0.42, 0.66, 0.38],
      props: 'dockyard',
    },
  },
];

/* ------------------------------------------------------------------ utils */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function noiseFill(ctx, w, h, rand, base, spread, count) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(rand() * spread);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.06 + rand() * 0.22})`;
    const s = 0.6 + rand() * 2.8;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
}

function makeTextures(theme, seed) {
  const rand = mulberry32(seed);
  const out = {};

  out.road = canvasTexture(256, 512, (ctx, w, h) => {
    noiseFill(ctx, w, h, rand, '#a8a8a8', 120, 14000);
    ctx.strokeStyle = 'rgba(38,38,38,0.32)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 22; i++) {
      ctx.beginPath();
      let x = rand() * w, y = rand() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rand() - 0.5) * 30; y += rand() * 34;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (theme.roadTex === 'ash') {
      ctx.fillStyle = 'rgba(30,26,24,0.14)';
      for (let i = 0; i < 260; i++) {
        ctx.beginPath();
        ctx.arc(rand() * w, rand() * h, 1 + rand() * 9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (theme.roadTex === 'tarmac') {
      ctx.strokeStyle = 'rgba(190,200,205,0.07)';
      for (let i = 0; i < 90; i++) {
        ctx.beginPath();
        ctx.moveTo(rand() * w, 0);
        ctx.lineTo(rand() * w, h);
        ctx.stroke();
      }
    }
  });

  out.ground = canvasTexture(256, 256, (ctx, w, h) => {
    if (theme.groundTex === 'basalt') {
      noiseFill(ctx, w, h, rand, '#5c5552', 120, 8000);
      ctx.strokeStyle = 'rgba(12,10,10,0.5)';
      for (let i = 0; i < 26; i++) {
        ctx.beginPath();
        let x = rand() * w, y = rand() * h;
        ctx.moveTo(x, y);
        for (let k = 0; k < 3; k++) { x += (rand() - 0.5) * 60; y += (rand() - 0.5) * 60; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    } else if (theme.groundTex === 'tarmac') {
      noiseFill(ctx, w, h, rand, '#54595c', 90, 9000);
      ctx.strokeStyle = 'rgba(24,26,28,0.4)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 16; i++) {
        ctx.beginPath();
        ctx.moveTo(0, rand() * h);
        ctx.lineTo(w, rand() * h);
        ctx.stroke();
      }
    } else {
      noiseFill(ctx, w, h, rand, '#8a7859', 130, 11000);
      for (let i = 0; i < 220; i++) {
        ctx.fillStyle = `rgba(60,48,32,${0.1 + rand() * 0.2})`;
        ctx.beginPath();
        ctx.arc(rand() * w, rand() * h, 1 + rand() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  out.gravel = canvasTexture(128, 128, (ctx, w, h) => {
    noiseFill(ctx, w, h, rand, '#8d8170', 140, 4200);
  });

  // weathered concrete / gravel shoulder apron between the rail and the yards
  out.apron = canvasTexture(512, 512, (ctx, w, h) => {
    noiseFill(ctx, w, h, rand, '#b0aca2', 120, 9000);
    // poured slabs with expansion joints
    const slab = 128;
    for (let y = 0; y < h; y += slab) {
      for (let x = 0; x < w; x += slab) {
        const v = 0.9 + rand() * 0.2;
        ctx.fillStyle = `rgba(${Math.round(150 * v)},${Math.round(147 * v)},${Math.round(139 * v)},0.5)`;
        ctx.fillRect(x + 3, y + 3, slab - 6, slab - 6);
      }
    }
    ctx.strokeStyle = 'rgba(46,44,40,0.5)';
    ctx.lineWidth = 3;
    for (let y = 0; y <= h; y += slab) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(y, 0); ctx.lineTo(y, h); ctx.stroke();
    }
    // spilled gravel and dirt blowing over the slabs
    for (let i = 0; i < 900; i++) {
      const v = 0.55 + rand() * 0.4;
      ctx.fillStyle = `rgba(${Math.round(140 * v)},${Math.round(132 * v)},${Math.round(116 * v)},${0.14 + rand() * 0.3})`;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, 0.8 + rand() * 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // cracks, oil and tyre marks
    ctx.strokeStyle = 'rgba(38,36,33,0.4)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      let x = rand() * w, y = rand() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rand() - 0.5) * 70; y += (rand() - 0.5) * 70; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = `rgba(24,23,21,${0.05 + rand() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(rand() * w, rand() * h, 4 + rand() * 26, 3 + rand() * 14, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  out.concrete = canvasTexture(256, 128, (ctx, w, h) => {
    noiseFill(ctx, w, h, rand, '#a5a29a', 100, 5000);
    ctx.strokeStyle = 'rgba(50,50,48,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(w, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h - 8); ctx.lineTo(w, h - 8); ctx.stroke();
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(60,58,52,${0.05 + rand() * 0.12})`;
      ctx.fillRect(rand() * w, rand() * h, 8 + rand() * 30, 4 + rand() * 26);
    }
  });

  out.steel = canvasTexture(256, 128, (ctx, w, h) => {
    noiseFill(ctx, w, h, rand, '#8b9094', 90, 3000);
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, 0, 3, h);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 6, 0, 4, h);
    }
    ctx.fillStyle = 'rgba(120,60,30,0.12)';
    for (let i = 0; i < 24; i++) ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 14, 2 + rand() * 8);
  });

  out.curb = canvasTexture(64, 256, (ctx, w, h) => {
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#' + theme.curbA.toString(16).padStart(6, '0') : '#' + theme.curbB.toString(16).padStart(6, '0');
      ctx.fillRect(0, (i * h) / bands, w, h / bands);
    }
    ctx.fillStyle = 'rgba(24,22,20,0.16)';
    for (let i = 0; i < 300; i++) ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 4);
  });

  out.checker = canvasTexture(256, 256, (ctx, w, h) => {
    const n = 8, cw = w / n, ch = h / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#e9e7df' : '#111214';
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
    ctx.fillStyle = 'rgba(40,40,40,0.15)';
    for (let i = 0; i < 180; i++) ctx.fillRect(rand() * w, rand() * h, 3, 3);
  });

  out.banner = canvasTexture(1600, 300, (ctx, w, h) => {
    ctx.fillStyle = '#0d1013';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#14181c';
    ctx.fillRect(0, 0, w, 46);
    ctx.fillStyle = '#ff8a24';
    ctx.fillRect(0, 46, w, 6);
    // hazard strip
    ctx.save();
    ctx.beginPath(); ctx.rect(0, h - 34, w, 34); ctx.clip();
    for (let x = -50; x < w + 50; x += 64) {
      ctx.fillStyle = '#ff8a24';
      ctx.beginPath();
      ctx.moveTo(x, h - 34); ctx.lineTo(x + 32, h - 34);
      ctx.lineTo(x + 32 + 34, h); ctx.lineTo(x + 34, h);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#eef4f6';
    ctx.font = '700 122px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DEATH RACE', w / 2, 172);
    ctx.fillStyle = '#ffb066';
    ctx.font = '600 42px ui-monospace, monospace';
    ctx.fillText('S T A R T   / /   F I N I S H', w / 2, 232);
  });

  out.water = canvasTexture(256, 256, (ctx, w, h) => {
    noiseFill(ctx, w, h, rand, '#2c6274', 70, 2000);
    ctx.strokeStyle = 'rgba(160,210,225,0.12)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 90; i++) {
      const y = rand() * h;
      ctx.beginPath();
      ctx.moveTo(rand() * w, y);
      ctx.quadraticCurveTo(rand() * w, y + (rand() - 0.5) * 5, rand() * w, y);
      ctx.stroke();
    }
  });

  return out;
}

/* ----------------------------------------------------------- mesh builder */

function newBuilder() {
  return { positions: [], uvs: [], colors: [], indices: [] };
}

function resolve(v, i) {
  return typeof v === 'function' ? v(i) : v;
}

/**
 * Add a closed ribbon (two offset edges extruded along the sample ring).
 * offA/offB and yA/yB may be numbers or functions of sample index.
 */
function addRibbon(b, samples, offA, offB, yA, yB, colorFn, vScale, uA = 0, uB = 1) {
  const N = samples.length;
  const start = b.positions.length / 3;
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    const oa = resolve(offA, i), ob = resolve(offB, i);
    const pa = s.pos.clone().addScaledVector(s.right, oa); pa.y += resolve(yA, i);
    const pb = s.pos.clone().addScaledVector(s.right, ob); pb.y += resolve(yB, i);
    b.positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
    const v = s.dist / (vScale || 8);
    b.uvs.push(uA, v, uB, v);
    const c = colorFn(i, s);
    const cr = typeof c === 'number' ? null : c;
    const col = cr || null;
    if (col) {
      b.colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }
  }
  for (let i = 0; i < N; i++) {
    const ni = (i + 1) % N;
    const a = start + i * 2, bb = a + 1, c = start + ni * 2, d = c + 1;
    b.indices.push(a, bb, c, bb, d, c);
  }
}

function addWall(b, samples, offset, yBase, height, uScale) {
  const N = samples.length;
  const start = b.positions.length / 3;
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    const p = s.pos.clone().addScaledVector(s.right, offset);
    b.positions.push(p.x, p.y + yBase, p.z, p.x, p.y + yBase + height, p.z);
    const u = s.dist / (uScale || 7);
    b.uvs.push(u, 0, u, 1);
  }
  for (let i = 0; i < N; i++) {
    const ni = (i + 1) % N;
    const a = start + i * 2, bb = a + 1, c = start + ni * 2, d = c + 1;
    b.indices.push(a, bb, c, bb, d, c);
  }
}

function addQuad(b, p0, p1, p2, p3, uv0 = [0, 0], uv1 = [1, 0], uv2 = [1, 1], uv3 = [0, 1]) {
  const start = b.positions.length / 3;
  b.positions.push(
    p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z
  );
  b.uvs.push(...uv0, ...uv1, ...uv2, ...uv3);
  b.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function finish(b, material, shadows = { cast: false, receive: true }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
  if (b.colors.length) g.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
  g.setIndex(b.indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.castShadow = !!shadows.cast;
  mesh.receiveShadow = !!shadows.receive;
  return mesh;
}

/* ------------------------------------------------------------ pad material */

function makePadMaterial(color, timeUniform) {
  const c = new THREE.Color(color).convertLinearToSRGB();
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uColor: { value: c },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        vec2 c = abs(uv - 0.5) * 2.0;
        float box = max(c.x, c.y);
        float inside = smoothstep(1.0, 0.9, box);
        float rim = smoothstep(0.72, 0.96, box) * inside;
        float edge = smoothstep(0.86, 0.8, box) * inside;
        float x = (uv.x - 0.5) * 2.0;
        float t = fract(uv.y * 2.0 - uTime * 0.22);
        float tri = smoothstep(0.06, 0.0, abs(x) - 0.58 * (1.0 - t)) * step(t, 0.78);
        float pulse = 0.72 + 0.28 * sin(uTime * 3.2 - uv.y * 7.0);
        float a = (rim * 0.85 + tri * 0.5 + edge * 0.22) * pulse;
        gl_FragColor = vec4(uColor * (1.0 + tri * 0.7), clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/* ------------------------------------------------------------- prop helpers */

function trackClearance(samples, x, z) {
  let best = Infinity;
  for (let i = 0; i < samples.length; i += 3) {
    const s = samples[i];
    const dx = x - s.pos.x, dz = z - s.pos.z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function findSpot(rand, samples, hw, minLat, maxLat, minClear, tries = 40) {
  for (let k = 0; k < tries; k++) {
    const i = Math.floor(rand() * samples.length);
    const s = samples[i];
    const side = rand() < 0.5 ? -1 : 1;
    const lat = (minLat + rand() * (maxLat - minLat)) * side;
    const x = s.pos.x + s.right.x * lat;
    const z = s.pos.z + s.right.z * lat;
    if (trackClearance(samples, x, z) >= minClear) return { x, z, sample: s };
  }
  return null;
}

function makeInstanced(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.castShadow = true;
  m.receiveShadow = true;
  m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return m;
}

/* ------------------------------------------------------------------ builder */

export function createTrack(index) {
  const def = TRACK_DEFS[index % TRACK_DEFS.length];
  const theme = def.theme;
  const hw = def.width / 2;
  const rand = mulberry32(0x1a2b3c4d + index * 977);
  const tex = makeTextures(theme, 0x51f00d + index * 31);
  const group = new THREE.Group();
  group.name = `track-${def.id}`;
  // terrain-family materials, snapshotted so overview mode can grade them
  // without touching the chase-cam palette
  const groundMaterials = [];
  const addGroundMat = (mat) => {
    mat.userData.baseColor = mat.color.clone();
    groundMaterials.push(mat);
  };

  /* ---- curve + samples ---- */
  const points = def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  // Three's 'centripetal' curve type uses an alpha of 0.25 (the requested
  // 0.22-0.28 low-tension window) and never kinks at hairpin control points.
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.25);
  curve.arcLengthDivisions = 4000;
  const length = curve.getLength();
  const N = THREE.MathUtils.clamp(Math.round(length / 3.2), 1400, 1800);
  const hintWindow = Math.max(40, Math.round(N / 28));

  const samples = [];
  const bounds = new THREE.Box3();
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const pos = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).normalize();
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const up = right.clone().cross(tan).normalize();
    samples.push({ u, pos, tan, right, up, dist: u * length });
    bounds.expandByPoint(pos);
  }

  const sampleAtU = (u) => samples[Math.round(((u % 1) + 1) % 1 * N) % N];
  const startSample = samples[0];

  /* ---- ground ---- */
  const groundTexture = tex.ground.clone();
  groundTexture.needsUpdate = true;
  groundTexture.repeat.set(theme.groundTex === 'tarmac' ? 30 : 90, theme.groundTex === 'tarmac' ? 30 : 90);
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;

  if (def.id === 'dockyard') {
    const size = bounds.getSize(new THREE.Vector3());
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(size.x + 260, 3, size.z + 260),
      new THREE.MeshStandardMaterial({ map: groundTexture, color: theme.groundColor, roughness: 0.95, metalness: 0.05 })
    );
    slab.position.set(
      (bounds.min.x + bounds.max.x) / 2, -1.5,
      (bounds.min.z + bounds.max.z) / 2
    );
    slab.receiveShadow = true;
    addGroundMat(slab.material);
    group.add(slab);

    const waterTex = tex.water.clone();
    waterTex.needsUpdate = true;
    waterTex.repeat.set(120, 120);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(7000, 7000),
      new THREE.MeshStandardMaterial({
        map: waterTex, color: 0x4f97ab, metalness: 0.06, roughness: 0.32,
        emissive: 0x0a1c22, emissiveIntensity: 1,
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(slab.position.x, -1.9, slab.position.z);
    group.add(water);
    group.userData.waterTexture = waterTex;
  } else {
    const groundTexture2 = groundTexture;
    const gSize = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 2.6 + 1200;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(gSize, gSize),
      new THREE.MeshStandardMaterial({ map: groundTexture2, color: theme.groundColor, roughness: 0.98, metalness: 0.02 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(
      (bounds.min.x + bounds.max.x) / 2, 0,
      (bounds.min.z + bounds.max.z) / 2
    );
    ground.receiveShadow = true;
    addGroundMat(ground.material);
    group.add(ground);
  }

  /* ---- road surface ---- */
  const COLS = 9;
  const rb = newBuilder();
  const baseTint = new THREE.Color(theme.roadTint);
  const roadRand = mulberry32(0xabcdef01);
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    for (let j = 0; j < COLS; j++) {
      const f = (j / (COLS - 1)) * 2 - 1;
      const off = f * hw;
      rb.positions.push(
        s.pos.x + s.right.x * off,
        s.pos.y + 0.0,
        s.pos.z + s.right.z * off
      );
      rb.uvs.push(j / (COLS - 1), s.dist / 15);
      const af = Math.abs(f);
      let shade = 0.84 + roadRand() * 0.22;
      if (af > 0.85) shade *= 0.72;
      if (Math.abs(af - 0.36) < 0.1) shade *= 0.9;
      rb.colors.push(baseTint.r * shade, baseTint.g * shade, baseTint.b * shade);
    }
  }
  for (let i = 0; i < N; i++) {
    const ni = (i + 1) % N;
    for (let j = 0; j < COLS - 1; j++) {
      const a = i * COLS + j, b = a + 1, c = ni * COLS + j, d = c + 1;
      rb.indices.push(a, b, c, b, d, c);
    }
  }
  const road = finish(rb, new THREE.MeshStandardMaterial({
    map: tex.road, vertexColors: true, roughness: 0.94, metalness: 0.03,
  }), { cast: false, receive: true });
  group.add(road);

  /* ---- racing line markings: edge lines + center dashes ---- */
  const lines = newBuilder();
  const lineCol = new THREE.Color(0xd9d4c2);
  const lineColFn = () => lineCol;
  for (const side of [-1, 1]) {
    const inner = side * (hw - 0.78);
    const outer = side * (hw - 0.42);
    addRibbon(lines, samples, Math.min(inner, outer), Math.max(inner, outer), 0.022, 0.022, lineColFn, 30);
  }
  const dashB = newBuilder();
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    if ((s.dist % 13) > 6) continue;
    const ns = samples[(i + 1) % N];
    const w = 0.16;
    const p0 = s.pos.clone().addScaledVector(s.right, -w).setY(s.pos.y + 0.024);
    const p1 = s.pos.clone().addScaledVector(s.right, w).setY(s.pos.y + 0.024);
    const p2 = ns.pos.clone().addScaledVector(ns.right, w).setY(ns.pos.y + 0.024);
    const p3 = ns.pos.clone().addScaledVector(ns.right, -w).setY(ns.pos.y + 0.024);
    addQuad(dashB, p0, p1, p2, p3);
  }
  group.add(finish(lines, new THREE.MeshStandardMaterial({
    color: 0xd6d0bd, roughness: 0.7, metalness: 0.05,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), { cast: false, receive: true }));
  group.add(finish(dashB, new THREE.MeshStandardMaterial({
    color: 0xcfc9b6, roughness: 0.75,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), { cast: false, receive: false }));

  /* ---- curbs ---- */
  const curbB = newBuilder();
  const white = new THREE.Color(0xffffff);
  for (const side of [-1, 1]) {
    const inner = side * (hw + 0.02);
    const outer = side * (hw + 0.98);
    addRibbon(
      curbB, samples,
      Math.min(inner, outer), Math.max(inner, outer),
      0.04, 0.04,
      () => white,
      8
    );
  }
  group.add(finish(curbB, new THREE.MeshStandardMaterial({
    map: tex.curb, roughness: 0.62, metalness: 0.04,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }), { cast: false, receive: true }));

  /* ---- concrete & gravel apron + embankment ---- */
  const apronW = theme.apron;
  const apronB = newBuilder();
  for (const side of [-1, 1]) {
    const inner = side * (hw + 1.0);
    const outer = side * (hw + apronW);
    addRibbon(apronB, samples, Math.min(inner, outer), Math.max(inner, outer), -0.02, -0.02,
      () => {
        const v = 0.86 + rand() * 0.16;
        return new THREE.Color(v, v * 0.99, v * 0.95);
      }, 5, 0, apronW / 4.6);
  }
  const apronTex = tex.apron.clone();
  apronTex.needsUpdate = true;
  group.add(finish(apronB, new THREE.MeshStandardMaterial({
    map: apronTex, vertexColors: true, roughness: 0.99, metalness: 0.02,
  }), { cast: false, receive: true }));

  const slopeB = newBuilder();
  for (const side of [-1, 1]) {
    // both edges come from the kit's own ground surface, so the embankment
    // ribbon and every grounded structure share one profile
    const innerOff = side * (hw + apronW);
    const outerOff = (i) => side * (hw + slopeOuterOffset(apronW, samples[i].pos.y));
    const yAt = (i, off) => groundHeight(samples[i], hw, off, apronW) - samples[i].pos.y;
    const innerY = (i) => yAt(i, innerOff);
    const outerY = (i) => yAt(i, outerOff(i));
    const positive = side > 0;
    addRibbon(
      slopeB, samples,
      positive ? innerOff : outerOff,
      positive ? outerOff : innerOff,
      positive ? innerY : outerY,
      positive ? outerY : innerY,
      () => {
        const v = 0.82 + rand() * 0.18;
        return new THREE.Color(v, v * 0.98, v * 0.94);
      },
      14
    );
  }
  const slopeTex = tex.ground.clone();
  slopeTex.needsUpdate = true;
  slopeTex.repeat.set(6, 6);
  const slopeMesh = finish(slopeB, new THREE.MeshStandardMaterial({
    map: slopeTex, color: 0xc4b5a8, vertexColors: true, roughness: 1.0,
  }), { cast: false, receive: false });
  addGroundMat(slopeMesh.material);
  group.add(slopeMesh);

  /* ---- guardrails ---- */
  const railB = newBuilder();
  for (const side of [-1, 1]) {
    addWall(railB, samples, side * (hw + 1.28), 0.3, 0.82, 7);
  }
  const railTex = theme.rail === 'concrete' ? tex.concrete.clone() : tex.steel.clone();
  railTex.needsUpdate = true;
  group.add(finish(railB, new THREE.MeshStandardMaterial({
    map: railTex,
    color: theme.rail === 'concrete' ? 0xcfcac0 : 0xccd3d8,
    roughness: theme.rail === 'concrete' ? 0.9 : 0.45,
    metalness: theme.rail === 'concrete' ? 0.03 : 0.22,
    side: THREE.DoubleSide,
  }), { cast: true, receive: true }));

  // rail posts
  const postEvery = 5;
  const postCount = Math.ceil(N / postEvery) * 2;
  const postGeo = new THREE.BoxGeometry(0.18, 1.25, 0.18);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8b9299, roughness: 0.65, metalness: 0.2 });
  const posts = makeInstanced(postGeo, postMat, postCount);
  const dummy = new THREE.Object3D();
  let pi = 0;
  for (let i = 0; i < N; i += postEvery) {
    const s = samples[i];
    for (const side of [-1, 1]) {
      dummy.position.copy(s.pos).addScaledVector(s.right, side * (hw + 1.42));
      dummy.position.y += 0.62;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      posts.setMatrixAt(pi++, dummy.matrix);
    }
  }
  posts.count = pi;
  group.add(posts);

  /* ---- start / finish gantry ---- */
  const gantry = new THREE.Group();
  const yaw = Math.atan2(startSample.tan.x, startSample.tan.z);
  gantry.position.copy(startSample.pos);
  gantry.rotation.y = yaw;

  const steelMat = new THREE.MeshStandardMaterial({ color: 0x3a444c, roughness: 0.55, metalness: 0.25 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xd75a1f, roughness: 0.55, metalness: 0.35 });
  const postSpan = hw + 2.4;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.4, 0.9), steelMat);
    pillar.position.set(side * postSpan, 4.2, 0);
    pillar.castShadow = true;
    gantry.add(pillar);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 1.7), accentMat);
    foot.position.set(side * postSpan, 0.35, 0);
    foot.castShadow = true;
    gantry.add(foot);
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.2, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff8a24, emissiveIntensity: 2.2 })
    );
    lamp.position.set(side * (postSpan - 1.2), 7.0, 0.62);
    gantry.add(lamp);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(postSpan * 2 + 1.4, 0.75, 1.1), steelMat);
  beam.position.set(0, 8.15, 0);
  beam.castShadow = true;
  gantry.add(beam);

  const bannerW = postSpan * 2 - 1.4;
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(bannerW, bannerW / 5.33),
    new THREE.MeshStandardMaterial({ map: tex.banner, roughness: 0.7, side: THREE.DoubleSide })
  );
  banner.position.set(0, 5.75, 0.58);
  gantry.add(banner);

  const checkerTex = tex.checker.clone();
  checkerTex.needsUpdate = true;
  checkerTex.repeat.set(2, 0.25);
  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2, 2.5),
    new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.55, metalness: 0.05 })
  );
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(0, 0.055, 0);
  startLine.receiveShadow = true;
  gantry.add(startLine);
  group.add(gantry);

  /* ---- boost / reload / repair pads ---- */
  const padTime = { value: 0 };
  const padMaterials = {};
  for (const key of Object.keys(PAD_TYPES)) {
    padMaterials[key] = makePadMaterial(PAD_TYPES[key].color, padTime);
  }
  const pads = [];
  for (const padDef of def.pads) {
    const s = sampleAtU(padDef.u);
    const lateral = padDef.offset || 0;
    const center = s.pos.clone().addScaledVector(s.right, lateral);
    center.y += 0.048;
    const halfW = 2.7, halfL = 3.9;
    const tan = new THREE.Vector3(s.tan.x, 0, s.tan.z).normalize();
    const right = new THREE.Vector3(s.right.x, 0, s.right.z).normalize();
    const corners = [
      center.clone().addScaledVector(tan, -halfL).addScaledVector(right, -halfW),
      center.clone().addScaledVector(tan, -halfL).addScaledVector(right, halfW),
      center.clone().addScaledVector(tan, halfL).addScaledVector(right, halfW),
      center.clone().addScaledVector(tan, halfL).addScaledVector(right, -halfW),
    ];
    const pb = newBuilder();
    addQuad(pb, corners[0], corners[1], corners[2], corners[3], [0, 0], [1, 0], [1, 1], [0, 1]);
    const mesh = finish(pb, padMaterials[padDef.type], { cast: false, receive: false });
    mesh.renderOrder = 2;
    group.add(mesh);
    pads.push({
      type: padDef.type,
      position: center,
      tan,
      right,
      halfWidth: halfW,
      halfLength: halfL,
      cooldown: 0,
      mesh,
    });
  }

  /* ---- props ---- */
  const propsGroup = new THREE.Group();
  propsGroup.name = 'props';
  group.add(propsGroup);
  group.userData.animated = [];

  // circuit-specific props the shared scenery kit does not cover; halls,
  // containers, barrels and hazard plating all come from buildScenery below
  if (theme.props === 'volcanic') buildVolcanic(samples, hw, rand, propsGroup, group, bounds);
  else if (theme.props === 'dockyard') buildDockyard(samples, hw, rand, propsGroup);

  // industrial / prison trackside architecture — instanced, grounded scenery
  const sceneryGroup = new THREE.Group();
  sceneryGroup.name = 'scenery';
  propsGroup.add(sceneryGroup);
  group.userData.scenery = buildScenery({
    samples,
    hw,
    rand,
    findSpot,
    parent: sceneryGroup,
    pattern: theme.props,
    apron: apronW,
  });

  /* ---- nearest-point query ---- */
  function nearest(point, hint = -1) {
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let k = -hintWindow; k <= hintWindow; k++) {
        const i = (hint + k + N) % N;
        const s = samples[i];
        const dx = point.x - s.pos.x;
        const dz = point.z - s.pos.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        const s = samples[best];
        const lateral = (point.x - s.pos.x) * s.right.x + (point.z - s.pos.z) * s.right.z;
        return { index: best, sample: s, lateral, u: best / N };
      }
    }
    for (let i = 0; i < N; i++) {
      const s = samples[i];
      const dx = point.x - s.pos.x;
      const dz = point.z - s.pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    const s = samples[best];
    const lateral = (point.x - s.pos.x) * s.right.x + (point.z - s.pos.z) * s.right.z;
    return { index: best, sample: s, lateral, u: best / N };
  }

  /* ---- animation ---- */
  const track = {
    def,
    index,
    group,
    curve,
    samples,
    length,
    width: def.width,
    halfWidth: hw,
    bounds,
    pads,
    // decorative architecture, so the quality governor can drop it whole
    props: propsGroup,
    scenery: sceneryGroup,
    groundMaterials,
    startSample,
    sampleAtU,
    nearest,
    time: 0,
    update(dt) {
      this.time += dt;
      padTime.value = this.time;
      for (const pad of pads) if (pad.cooldown > 0) pad.cooldown -= dt;
      const waterTex = group.userData.waterTexture;
      if (waterTex) {
        waterTex.offset.x = this.time * 0.006;
        waterTex.offset.y = this.time * 0.004;
      }
      for (const fn of group.userData.animated) fn(this.time, dt);
    },
    dispose() {
      disposeGroup(group);
    },
  };

  return track;
}


function dummyFor() {
  const d = new THREE.Object3D();
  d.updateMatrix();
  return d;
}


/* ---------------------------------------------------------------- volcanic */

function buildVolcanic(samples, hw, rand, propsGroup, group, bounds) {
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.08, flatShading: true });
  const rocks = makeInstanced(rockGeo, rockMat, 170);
  const rockColors = [0x5a4f4a, 0x6b5c54, 0x4a403c, 0x75665d];
  let ri = 0;
  for (let k = 0; k < 320 && ri < 170; k++) {
    const spot = findSpot(rand, samples, hw, 14, 70, hw + 12);
    if (!spot) continue;
    const s = 1.6 + rand() * 5.4;
    const d = dummyFor();
    d.position.set(spot.x, s * 0.28, spot.z);
    d.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    d.scale.set(s * (0.8 + rand() * 0.6), s * (0.6 + rand() * 0.8), s * (0.8 + rand() * 0.5));
    d.updateMatrix();
    rocks.setMatrixAt(ri, d.matrix);
    rocks.setColorAt(ri, new THREE.Color(rockColors[Math.floor(rand() * rockColors.length)]));
    ri++;
  }
  rocks.count = ri;
  propsGroup.add(rocks);

  // lava pools
  const lavaMat = new THREE.MeshStandardMaterial({
    color: 0x2a0a04, emissive: 0xff4a12, emissiveIntensity: 2.4, roughness: 0.6,
  });
  const lavaGroup = new THREE.Group();
  for (let k = 0; k < 20; k++) {
    const spot = findSpot(rand, samples, hw, 24, 110, hw + 22);
    if (!spot) continue;
    const r = 4 + rand() * 7;
    const rim = new THREE.Mesh(
      new THREE.CircleGeometry(r * 1.4, 20),
      new THREE.MeshStandardMaterial({ color: 0x332a27, roughness: 1 })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(spot.x, 0.12, spot.z);
    lavaGroup.add(rim);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 22), lavaMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(spot.x, 0.16, spot.z);
    lavaGroup.add(pool);
    if (rand() < 0.5) {
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(r * 1.25, 22),
        new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.12, depthWrite: false })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(spot.x, 0.2, spot.z);
      lavaGroup.add(glow);
    }
  }
  propsGroup.add(lavaGroup);
  group.userData.animated.push((time) => {
    lavaMat.emissiveIntensity = 2.1 + Math.sin(time * 1.4) * 0.35;
  });

  // distant volcanic cones
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x4a3a35, roughness: 1, flatShading: true });
  const coneGlowMat = new THREE.MeshBasicMaterial({ color: 0xff6a24 });
  // keep the cones outside the circuit so the overview stays readable
  const midX = (bounds.min.x + bounds.max.x) / 2;
  const midZ = (bounds.min.z + bounds.max.z) / 2;
  const spanX = (bounds.max.x - bounds.min.x) / 2;
  const spanZ = (bounds.max.z - bounds.min.z) / 2;
  const cones = [
    [midX - spanX - 620, 0, midZ - spanZ - 420, 170, 210],
    [midX + spanX + 560, 0, midZ - spanZ - 380, 140, 165],
    [midX + spanX + 700, 0, midZ + spanZ + 420, 190, 130],
  ];
  for (const [x, y, z, r, h] of cones) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), coneMat);
    cone.position.set(x, h / 2 - 6, z);
    propsGroup.add(cone);
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.14, r * 0.1, 1.5, 10), coneGlowMat);
    crater.position.set(x, h - 6.2, z);
    propsGroup.add(crater);
  }
}

/* ---------------------------------------------------------------- dockyard */

function buildDockyard(samples, hw, rand, propsGroup) {
  // port cranes — the one dockyard prop the shared kit does not build
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xa1462c, roughness: 0.6, metalness: 0.2 });
  const craneDark = new THREE.MeshStandardMaterial({ color: 0x3c464c, roughness: 0.7, metalness: 0.18 });
  for (let k = 0; k < 10; k++) {
    const spot = findSpot(rand, samples, hw, 46, 110, hw + 40);
    if (!spot) continue;
    const crane = new THREE.Group();
    const legH = 26;
    for (const lx of [-8, 8]) {
      for (const lz of [-4, 4]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.5, legH, 1.5), craneMat);
        leg.position.set(lx, legH / 2, lz);
        crane.add(leg);
      }
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(44, 2.2, 3), craneMat);
    beam.position.set(0, legH + 1, 0);
    crane.add(beam);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(30, 1.2, 1.6), craneDark);
    arm.position.set(11, legH + 3.4, 0);
    arm.rotation.z = 0.08;
    crane.add(arm);
    const trolley = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 2.6), craneDark);
    trolley.position.set(14, legH - 1.5, 0);
    crane.add(trolley);
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.2, 9, 0.2), craneDark);
    cable.position.set(14, legH - 7, 0);
    crane.add(cable);
    crane.position.set(spot.x, 0, spot.z);
    crane.rotation.y = rand() * Math.PI * 2;
    propsGroup.add(crane);
  }
}

/* ------------------------------------------------------------------ disposal */

export function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      for (const key of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap']) {
        if (m[key]) m[key].dispose();
      }
      m.dispose();
    }
    o.geometry = null;
    o.material = null;
  });
}
