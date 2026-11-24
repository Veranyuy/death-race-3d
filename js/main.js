import * as THREE from './vendor/three.module.js';
import { TRACK_DEFS, createTrack } from './tracks.js';
import { DriveTest, formatLapTime, CAM_LABELS } from './driveTest.js';
import { createControls } from './controls.js';
import { Opponents, RIVAL_COLORS } from './opponents.js';
import { Combat } from './combat.js';
import { QualityGovernor, QUALITY } from './quality.js';
import { createAudio } from './audio.js';

/* --------------------------------------------------------------- renderer */

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
// mobile GPU guardrail: never render above 2x backing-store scale
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// the shadow pass is the most expensive thing in the frame and the sun barely
// moves, so it is refreshed on a schedule the governor chooses instead of every
// frame. Anything that moves a light or changes what casts must ask for it.
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// a touch above neutral: lifts tarmac, bodywork and facades out of the murk
// while ACES still rolls the sky highlights off instead of clipping them
renderer.toneMappingExposure = 1.16;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// cool industrial haze; per-circuit values re-applied in applyTrack
scene.fog = new THREE.Fog(0x97a3ab, 280, 2000);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 1.2, 12000);
camera.position.set(0, 40, 120);

/* ------------------------------------------------------------------- sky */

function srgb(hex) {
  return new THREE.Color(hex).convertLinearToSRGB();
}

const skyUniforms = {
  uTop: { value: srgb(0x3b4754) },
  uHorizon: { value: srgb(0xc2ccd1) },
  uSunColor: { value: srgb(0xe8edf0) },
  uSunDir: { value: new THREE.Vector3(-0.35, 0.78, 0.5).normalize() },
  uCloud: { value: 0.55 },
};

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(6500, 32, 18),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform float uCloud;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y * 1.45, 0.0, 1.0), 0.55);
        vec3 col = mix(uHorizon, uTop, t);

        // overcast cloud deck: broad soft banding, fading out at the horizon
        vec2 cp = d.xz / (abs(d.y) + 0.22);
        float cl = sin(cp.x * 0.85 + cp.y * 0.55) * 0.5
                 + sin(cp.x * 1.9 - cp.y * 1.35) * 0.32
                 + sin(cp.y * 3.3 + cp.x * 0.45) * 0.18;
        cl = smoothstep(0.12, 0.86, cl * 0.5 + 0.5) * smoothstep(0.02, 0.42, d.y) * uCloud;
        vec3 cloudCol = mix(uTop, uHorizon, 0.62) * 1.05;
        col = mix(col, cloudCol, cl * 0.55);

        // bright haze shelf just above the horizon: keeps far silhouettes
        // readable instead of dissolving into a flat grey wall
        float shelf = smoothstep(-0.05, 0.05, d.y) * (1.0 - smoothstep(0.08, 0.38, d.y));
        col = mix(col, uHorizon * 1.14 + vec3(0.01), shelf * 0.85);

        float sun = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * pow(sun, 380.0) * 2.6;
        col += uSunColor * pow(sun, 9.0) * 0.1;
        col = mix(col, uHorizon * 0.72, smoothstep(0.0, -0.4, d.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

/* ---------------------------------------------------------------- lights */

// the hemisphere carries most of the fill: it is what keeps a shaded facade,
// a fence line and the dark side of a car readable instead of crushed to black
const hemi = new THREE.HemisphereLight(0xc4d6e2, 0x8a8378, 1.75);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xe8edf0, 1.75);
sun.castShadow = true;
// 1024 keeps mid-range Android/iOS GPUs at 60 FPS (shadow pass is per-frame)
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.05;
scene.add(sun);
scene.add(sun.target);

const sunDir = new THREE.Vector3(-0.35, 0.78, 0.5).normalize();

/* --------------------------------------------------------------- driver */

const driver = new DriveTest(scene, camera);
const opponents = new Opponents(scene, driver);
const combat = new Combat(scene, driver, opponents);
driver.combat = combat;

/* ----------------------------------------------------------------- audio */

// Procedural engine + start tones. The context is only created inside a real
// gesture, which is the one thing iOS Safari insists on; every listener stays
// attached so a context that a phone call or a background tab suspended is
// resumed by the next touch.
const audio = createAudio();

/** The first real gesture does both jobs: it starts the audio context, which
    iOS refuses to create anywhere else, and — while the grid is armed — it
    starts the countdown. `gridArmed` is read at event time, long after the
    module has finished evaluating. */
function onLaunchGesture() {
  audio.unlock();
  if (gridArmed) startCountdown();
}
addEventListener('pointerdown', onLaunchGesture, { passive: true });
addEventListener('keydown', onLaunchGesture);
addEventListener('click', onLaunchGesture);

/* ------------------------------------------------------------ track state */

let trackIndex = 0;
let track = null;
// set once the results sheet is up: the sim stops stepping until a restart
let raceOver = false;
let trackCenter = new THREE.Vector3();
let trackRadius = 400;

const trackButtons = [...document.querySelectorAll('.track')];
const cameraBtn = document.getElementById('cameraBtn');
const camLabel = document.getElementById('camLabel');
const hud = document.getElementById('hud');
const speedEl = document.getElementById('speed');
const lapEl = document.getElementById('lap');
const nitroFillEl = document.getElementById('nitroFill');
const nitroPctEl = document.getElementById('nitroPct');
const nitroBtnEl = document.getElementById('nitroBtn');
const toastEl = document.getElementById('toast');
const fpsEl = document.getElementById('fps');
const fpsValueEl = document.getElementById('fpsValue');
const perfStateEl = document.getElementById('perfState');
const diagEl = document.getElementById('diag');
const settingsEl = document.getElementById('settingsPanel');
const settingsBtn = document.getElementById('settingsBtn');
const diagEls = {
  tier: document.getElementById('diagTier'),
  changes: document.getElementById('diagChanges'),
  group: document.getElementById('diagGroup'),
  props: document.getElementById('diagProps'),
  meshes: document.getElementById('diagMeshes'),
  skyline: document.getElementById('diagSkyline'),
  calls: document.getElementById('diagCalls'),
  tris: document.getElementById('diagTris'),
  render: document.getElementById('diagRender'),
  gpu: document.getElementById('diagGpu'),
  losses: document.getElementById('diagLosses'),
};
const lapTimeEl = document.getElementById('lapTime');
const bestLapEl = document.getElementById('bestLap');
const positionEl = document.getElementById('position');
const fieldSizeEl = document.getElementById('fieldSize');
const lapTotalEl = document.getElementById('lapTotal');
const armorFillEl = document.getElementById('armorFill');
const armorPctEl = document.getElementById('armorPct');
const shieldFillEl = document.getElementById('shieldFill');
const shieldPctEl = document.getElementById('shieldPct');
const assistPill = document.getElementById('assistPill');
const resultsEl = document.getElementById('results');
const resultsTitle = document.getElementById('resultsTitle');
const resultsSub = document.getElementById('resultsSub');
const resultTime = document.getElementById('resultTime');
const resultBest = document.getElementById('resultBest');
const resultField = document.getElementById('resultField');
const resultList = document.getElementById('resultList');
const restartBtn = document.getElementById('restartBtn');

/* ------------------------------------------------------------- quality */

let qualityTier = 0;
let shadowEvery = 1;
let ratioCap = 2;

/** Applies one quality step to everything it governs. Called on a change only,
    so the framebuffer is never resized mid-frame for no reason. */
function applyQuality(index, step, reason) {
  qualityTier = index;
  ratioCap = step.pixelRatio;
  shadowEvery = step.shadowEvery;
  driver.smokeDensity = step.smoke;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (track) {
    // roadside architecture is never hidden for performance; only the distant
    // skyline band is allowed to drop on the low steps
    track.skyline.visible = step.skyline !== false;
    renderer.shadowMap.needsUpdate = true;
  }
  refreshPerfChip();
  refreshDiag();
  if (reason !== 'boot') showToast(`GRAPHICS  ${step.id}`, '#8fe8ff');
}

const governor = new QualityGovernor({ onTier: applyQuality });

const controls = createControls(driver, {
  combat,
  audio,
  onMessage: (text, color) => showToast(text, color),
});

function applyTrack(index) {
  if (track) {
    scene.remove(track.group);
    track.dispose();
    track = null;
  }
  trackIndex = index;
  const def = TRACK_DEFS[index];
  track = createTrack(index);
  scene.add(track.group);
  track.skyline.visible = QUALITY[qualityTier].skyline !== false;
  gradeMode = null;

  track.bounds.getCenter(trackCenter);
  const size = track.bounds.getSize(new THREE.Vector3());
  trackRadius = Math.max(size.x, size.z) * 0.5;

  // atmosphere
  scene.fog.color.set(def.theme.fog);
  scene.fog.near = def.theme.fogNear;
  scene.fog.far = def.theme.fogFar;

  skyUniforms.uTop.value.copy(srgb(def.theme.skyTop));
  skyUniforms.uHorizon.value.copy(srgb(def.theme.skyHorizon));
  skyUniforms.uSunColor.value.copy(srgb(def.theme.sun));
  skyUniforms.uCloud.value = def.theme.skyCloud ?? 0.5;

  sunDir.set(...def.theme.sunDir).normalize();
  skyUniforms.uSunDir.value.copy(sunDir);

  hemi.color.set(def.theme.hemiSky);
  hemi.groundColor.set(def.theme.hemiGround);
  hemi.intensity = def.theme.hemiIntensity;
  sun.color.set(def.theme.sun);
  sun.intensity = def.theme.sunIntensity;

  driver.setTrack(track);
  opponents.setTrack(track);
  combat.setTrack(track);

  for (const btn of trackButtons) {
    btn.classList.toggle('active', Number(btn.dataset.index) === index);
  }
  lapEl.textContent = '1';
  lapTotalEl.textContent = `/${driver.lapTotal}`;
  fieldSizeEl.textContent = `/${driver.fieldSize}`;
  showToast(`${def.name.toUpperCase()}  //  CIRCUIT LOADED`, '#9fe9f2');
  armGrid();
  refreshPerfChip();
  refreshDiag();
}

/* ------------------------------------------------------- rendering readout */

/** Compact instance counts: 17767 -> "17.8K". */
const fmtK = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/** Roadside structures actually submitted. Zero `instances` means generation
    failed; non-zero `instances` with zero `drawn` means something is hiding
    them (a quality step), which is exactly the difference the on-device
    readout has to expose. */
function sceneryStats() {
  if (!track) return null;
  const stats = track.group.userData.scenery || {};
  // sceneryGroup's direct children are the near/mid meshes; the skyline meshes
  // were re-parented out of it, so one level of iteration is enough
  let drawn = 0;
  for (const mesh of track.scenery.children) {
    if (mesh.isInstancedMesh && mesh.visible) drawn += mesh.count;
  }
  let skyline = 0;
  for (const mesh of track.skyline.children) skyline += mesh.count;
  return { meshes: stats.meshes || 0, instances: stats.instances || 0, drawn, skyline };
}

let gpuLabel = '';
function gpuName() {
  if (gpuLabel) return gpuLabel;
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpuLabel = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) || 'unknown';
  } catch {
    gpuLabel = 'unavailable';
  }
  return gpuLabel;
}

let contextLosses = 0;

/** The always-visible answer to "are the buildings being drawn, and at which
    quality step" — readable in the top-right corner, no console needed. */
function refreshPerfChip() {
  if (!perfStateEl) return;
  const step = QUALITY[qualityTier].id;
  const s = sceneryStats();
  let text = `${step} · NO TRACK`;
  let tone = 'warn';
  if (s) {
    if (s.instances === 0) { text = `${step} · PROPS 0`; tone = 'bad'; }
    else if (s.drawn === 0) { text = `${step} · PROPS OFF`; tone = 'bad'; }
    else { text = `${step} · PROPS ${fmtK(s.drawn)}`; tone = 'ok'; }
  }
  perfStateEl.textContent = text;
  perfStateEl.dataset.tone = tone;
}

/** Full sheet behind the FPS chip: everything needed to tell a quality-step
    cull apart from a generation or WebGL failure on the phone itself. */
function refreshDiag() {
  if (!diagEl || diagEl.hidden) return;
  const e = diagEls;
  const s = sceneryStats();
  const px = renderer.getPixelRatio();
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  e.tier.textContent = QUALITY[qualityTier].id;
  e.changes.textContent = String(governor.changes);
  if (s) {
    const propsOn = track.props.visible;
    e.group.textContent = propsOn ? 'VISIBLE' : 'HIDDEN';
    e.group.dataset.tone = propsOn ? 'ok' : 'bad';
    e.props.textContent = `${s.drawn} / ${s.instances}`;
    e.props.dataset.tone = s.drawn > 0 ? 'ok' : 'bad';
    e.meshes.textContent = String(s.meshes);
    e.skyline.textContent = track.skyline.visible ? `ON (${s.skyline})` : `OFF (${s.skyline})`;
  } else {
    for (const key of ['group', 'props', 'meshes', 'skyline']) {
      e[key].textContent = '--';
      delete e[key].dataset.tone;
    }
  }
  e.calls.textContent = String(renderer.info.render.calls);
  e.tris.textContent = fmtK(renderer.info.render.triangles);
  e.render.textContent = `${px.toFixed(1)}x ${buf.x}×${buf.y}`;
  e.gpu.textContent = gpuName();
  e.gpu.title = gpuName();
  e.losses.textContent = String(contextLosses);
  e.losses.dataset.tone = contextLosses > 0 ? 'bad' : 'ok';
}

function toggleDiag(force) {
  if (!diagEl) return;
  const open = force === undefined ? diagEl.hidden : !!force;
  diagEl.hidden = !open;
  fpsEl?.setAttribute('aria-expanded', String(open));
  if (open) {
    // the settings sheet occupies the same corner
    if (settingsEl) settingsEl.hidden = true;
    settingsBtn?.setAttribute('aria-expanded', 'false');
    refreshDiag();
  }
}

fpsEl?.addEventListener('click', () => toggleDiag());

canvas.addEventListener('webglcontextlost', (e) => {
  // keeping the default cancelled is what lets Safari rebuild the context
  e.preventDefault();
  contextLosses += 1;
  showToast('WEBGL CONTEXT LOST', '#ff4a32');
  refreshPerfChip();
  refreshDiag();
});
canvas.addEventListener('webglcontextrestored', () => {
  renderer.shadowMap.needsUpdate = true;
  showToast('WEBGL CONTEXT RESTORED', '#4dff86');
  refreshDiag();
});

/* ---------------------------------------------------------------- camera UI */

function syncCameraUI() {
  const overview = driver.mode === 'overview';
  camLabel.textContent = CAM_LABELS[driver.mode] || 'CHASE CAM';
  cameraBtn.classList.toggle('overhead', overview);
  cameraBtn.classList.toggle('combat', driver.mode === 'hood' || driver.mode === 'cockpit');
}

cameraBtn.addEventListener('click', () => {
  driver.toggleCamera();
  syncCameraUI();
});

for (const btn of trackButtons) {
  btn.addEventListener('click', () => {
    const i = Number(btn.dataset.index);
    if (i !== trackIndex) {
      applyTrack(i);
      syncCameraUI();
    }
    canvas.focus();
  });
}

addEventListener('keydown', (e) => {
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    const i = Number(e.code.slice(-1)) - 1;
    if (i !== trackIndex) {
      applyTrack(i);
      syncCameraUI();
    }
  }
  if (e.code === 'KeyC') syncCameraUI();
});

/* ------------------------------------------------------------------ toast */

let toastTimer = 0;
function showToast(text, color = '#eaf6f8') {
  toastEl.textContent = text;
  toastEl.style.color = color;
  toastEl.style.borderColor = color + '55';
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

/* ------------------------------------------------------------ start lights */

const lightsEl = document.getElementById('lights');
const lightsText = document.getElementById('lightsText');
const lightsHint = document.getElementById('lightsHint');
const lampCols = lightsEl ? [...lightsEl.querySelectorAll('.lamp')] : [];
const LIGHT_STEP_MS = 620;      // one column per beat, like a real gantry
const LIGHTS_OUT_MIN = 350;     // the hold after the last lamp is random, so
const LIGHTS_OUT_MAX = 900;     // the launch can never be anticipated

let phase = 'grid';             // grid | racing | done
let gridTimer = 0;
let lightIndex = 0;
// true between a circuit load and the player's first tap: the gantry is up and
// the car is held, but no countdown is running yet. Nothing ticks on its own,
// so a phone that loads the page while pocketed cannot burn the launch.
let gridArmed = false;

function paintLights(n) {
  for (let i = 0; i < lampCols.length; i++) lampCols[i].classList.toggle('on', i < n);
}

function clearGridTimer() {
  if (!gridTimer) return;
  clearTimeout(gridTimer);
  gridTimer = 0;
}

/** Lights out: the pedals go live and the clock starts on the first throttle.
    Drivers rev on the line until this moment. */
function launch() {
  clearGridTimer();
  gridArmed = false;
  phase = 'racing';
  driver.gridLock = false;
  paintLights(0);
  lightsEl?.classList.add('go');
  if (lightsText) lightsText.textContent = 'GO';
  if (lightsHint) lightsHint.hidden = true;
  audio.go();
  gridTimer = setTimeout(() => {
    gridTimer = 0;
    if (!lightsEl) return;
    lightsEl.classList.remove('go');
    lightsEl.hidden = true;
  }, 1000);
}

function nextLight() {
  lightIndex += 1;
  paintLights(lightIndex);
  audio.countdown(lightIndex);
  if (lightIndex < lampCols.length) {
    gridTimer = setTimeout(nextLight, LIGHT_STEP_MS);
  } else {
    gridTimer = setTimeout(launch, LIGHTS_OUT_MIN + Math.random() * (LIGHTS_OUT_MAX - LIGHTS_OUT_MIN));
  }
}

/** Five lamps, one per beat, then lights out. Nothing moves until `launch`,
    because the driver holds the whole field on the grid. */
function startCountdown() {
  clearGridTimer();
  gridArmed = false;
  phase = 'grid';
  lightIndex = 0;
  driver.gridLock = true;
  if (!lightsEl) { launch(); return; }
  lightsEl.hidden = false;
  lightsEl.classList.remove('go');
  if (lightsText) lightsText.textContent = 'HOLD GAS TO REV';
  if (lightsHint) lightsHint.hidden = true;
  paintLights(0);
  gridTimer = setTimeout(nextLight, LIGHT_STEP_MS);
}

/** Race-ready but not yet running: gantry up, prompt showing, pedals dead.
    The first tap or keypress starts the countdown (see onLaunchGesture), so
    the lights only ever count while somebody is watching them — and that same
    gesture is what unlocks Web Audio on iOS. */
function armGrid() {
  clearGridTimer();
  gridArmed = true;
  phase = 'grid';
  lightIndex = 0;
  driver.gridLock = true;
  if (!lightsEl) return;
  lightsEl.hidden = false;
  lightsEl.classList.remove('go');
  if (lightsText) lightsText.textContent = 'HOLD GAS TO REV';
  if (lightsHint) lightsHint.hidden = false;
  paintLights(0);
}

/** Debug / harness path: skip the gantry and put the pedals live at once. */
function startRace() {
  clearGridTimer();
  gridArmed = false;
  phase = 'racing';
  driver.gridLock = false;
  paintLights(0);
  if (lightsEl) {
    lightsEl.classList.remove('go');
    lightsEl.hidden = true;
  }
  if (lightsHint) lightsHint.hidden = true;
}

/* -------------------------------------------------------------- HUD sync */

let hudSpeed = -1;
let hudLap = -1;
let hudNitro = -1;
let hudNitroArmed = null;
let hudNitroEmpty = null;
let hudArmor = -1;
let hudPos = -1;
let hudBoost = null;
let hudTime = '';
let hudBest = '';
let hudShield = -1;
let hudShieldOn = null;
let hudAssist = null;

function syncHud() {
  const st = driver.state;
  if (st.speedKmh !== hudSpeed) {
    hudSpeed = st.speedKmh;
    speedEl.textContent = String(st.speedKmh);
  }
  if (st.lap !== hudLap) {
    hudLap = st.lap;
    lapEl.textContent = String(Math.min(st.lap, st.lapTotal));
  }
  if (st.position !== hudPos) {
    hudPos = st.position;
    positionEl.textContent = String(st.position);
    fieldSizeEl.textContent = `/${st.fieldSize}`;
  }
  const armor = Math.round(st.armor);
  if (armor !== hudArmor) {
    hudArmor = armor;
    armorFillEl.style.width = `${armor}%`;
    armorPctEl.textContent = `${armor}%`;
  }
  const n = Math.round(st.nitro);
  if (n !== hudNitro) {
    hudNitro = n;
    nitroFillEl.style.width = `${n}%`;
    nitroPctEl.textContent = `${n}%`;
  }
  // the button has to read at a glance on a phone: lit while the latch is on,
  // grey while the bottle is dry
  const armed = !!st.nitroActive;
  if (armed !== hudNitroArmed) {
    hudNitroArmed = armed;
    nitroBtnEl?.classList.toggle('active', armed);
    nitroBtnEl?.setAttribute('aria-pressed', String(armed));
  }
  const empty = n <= 0;
  if (empty !== hudNitroEmpty) {
    hudNitroEmpty = empty;
    nitroBtnEl?.classList.toggle('empty', empty);
  }
  const lapTime = formatLapTime(st.lapTime);
  if (lapTime !== hudTime) {
    hudTime = lapTime;
    lapTimeEl.textContent = lapTime;
  }
  const best = st.bestLap ? formatLapTime(st.bestLap) : '--:--.-';
  if (best !== hudBest) {
    hudBest = best;
    bestLapEl.textContent = best;
  }
  if (st.boosting !== hudBoost) {
    hudBoost = st.boosting;
    hud.classList.toggle('boosting', st.boosting);
  }
  const shield = Math.round(combat.hud.shield);
  if (shield !== hudShield) {
    hudShield = shield;
    shieldFillEl.style.width = `${shield}%`;
    shieldPctEl.textContent = `${shield}%`;
  }
  if (combat.hud.shieldActive !== hudShieldOn) {
    hudShieldOn = combat.hud.shieldActive;
    hud.classList.toggle('shielding', hudShieldOn);
  }
  const assistOn = driver.state.assistActive && !raceOver;
  if (assistOn !== hudAssist) {
    hudAssist = assistOn;
    assistPill.classList.toggle('show', assistOn);
  }
  if (driver.messages.length) {
    const msgs = driver.messages.splice(0, driver.messages.length);
    const last = msgs[msgs.length - 1];
    showToast(last.text, last.color);
  }
}

/* --------------------------------------------------------------- results */

/** Final classification from what the race already tracks: the player's lap
    counter against each rival's distance along the lap. Gap times are that
    distance converted at the player's own average lap pace, so the column
    agrees with the total time above it. */
function showResults() {
  if (raceOver || !track) return;
  raceOver = true;
  gridArmed = false;
  phase = 'done';
  clearGridTimer();
  if (lightsEl) {
    lightsEl.classList.remove('go');
    lightsEl.hidden = true;
  }
  if (lightsHint) lightsHint.hidden = true;

  const laps = driver.lapTotal;
  const total = driver.finalTime;
  const pace = total / laps;
  const pn = track.nearest(driver.position, driver.hintIndex);
  const playerProg = (driver.lap - 1) + pn.u;

  const rows = opponents.cars.map((car, i) => ({
    prog: car.s / track.length,
    label: `RIVAL ${i + 1}`,
    color: RIVAL_COLORS[i % RIVAL_COLORS.length],
    me: false,
  }));
  rows.push({ prog: playerProg, label: 'YOU', color: 0xff8a24, me: true });
  rows.sort((a, b) => b.prog - a.prog);
  const pos = rows.findIndex((r) => r.me) + 1;

  const verdict = pos === 1 ? 'VICTORY' : pos <= 3 ? 'PODIUM' : 'RACE COMPLETE';
  resultsTitle.textContent = `P${pos}`;
  resultsTitle.dataset.tone = pos === 1 ? 'win' : pos <= 3 ? 'podium' : 'loss';
  resultsSub.textContent =
    `${TRACK_DEFS[trackIndex].name.toUpperCase()}  //  ${laps} LAPS  //  ${verdict}`;
  resultTime.textContent = formatLapTime(total);
  resultBest.textContent = driver.bestLap ? formatLapTime(driver.bestLap) : '--:--.-';
  resultField.textContent = `${pos}/${rows.length}`;

  resultList.textContent = '';
  rows.forEach((r, i) => {
    const li = document.createElement('li');
    if (r.me) li.className = 'me';
    // positive = still behind the player, negative = already up the road
    const delta = playerProg - r.prog;
    const value = r.me
      ? formatLapTime(total)
      : Math.abs(delta) > 0.995
        ? `${delta > 0 ? '+' : '-'}${Math.round(Math.abs(delta))} LAP${Math.round(Math.abs(delta)) === 1 ? '' : 'S'}`
        : Math.abs(delta * pace) < 0.05
          ? '--'
          : `${delta > 0 ? '+' : '-'}${Math.abs(delta * pace).toFixed(1)}s`;
    li.innerHTML = `<b>${i + 1}</b>`
      + `<i style="background:#${r.color.toString(16).padStart(6, '0')}"></i>`
      + `<span>${r.label}</span><em>${value}</em>`;
    resultList.appendChild(li);
  });

  resultsEl.hidden = false;
}

/** Fresh race on the circuit already loaded: same geometry, reset cars and
    clocks. Rebuilding the track here would hitch for no reason. */
function restartRace() {
  if (!track) return;
  resultsEl.hidden = true;
  raceOver = false;
  driver.setTrack(track);
  opponents.setTrack(track);
  combat.setTrack(track);
  assistPill.classList.remove('show');
  lapEl.textContent = '1';
  lapTotalEl.textContent = `/${driver.lapTotal}`;
  fieldSizeEl.textContent = `/${driver.fieldSize}`;
  syncCameraUI();
  showToast(`${TRACK_DEFS[trackIndex].name.toUpperCase()}  //  RACE RESTARTED`, '#9fe9f2');
  startCountdown();
}

restartBtn.addEventListener('click', restartRace);

/* ------------------------------------------------------------------- loop */

const sunOffset = new THREE.Vector3();
let fpsFrames = 0;
let fpsTime = 0;
let fpsValue = 60;
let frameCount = 0;
let last = performance.now();

function updateSunShadow() {
  const overview = driver.mode === 'overview';
  const target = overview ? trackCenter : driver.car.position;
  const half = overview ? trackRadius * 1.2 + 40 : 120;
  sunOffset.copy(sunDir).multiplyScalar(overview ? 1500 : 380);
  sun.position.copy(target).add(sunOffset);
  sun.target.position.copy(target);
  sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 20;
  cam.far = overview ? 4200 : 860;
  cam.updateProjectionMatrix();
}

/** Chase fog keeps the theme haze; the overview pulls it back so the whole
    multi-sector circuit reads at once. */
function applyFog() {
  if (!track) return;
  if (driver.mode === 'overview') {
    scene.fog.near = trackRadius * 1.25;
    scene.fog.far = trackRadius * 6.5;
  } else {
    scene.fog.near = track.def.theme.fogNear;
    scene.fog.far = track.def.theme.fogFar;
  }
}

/** Overview grade: from altitude the tarmac/dirt tint reads near-black and the
    circuit floats on a void, so the ground is lifted there only. The chase-cam
    palette is untouched. */
let gradeMode = null;
function applyViewGrade() {
  if (!track || !track.groundMaterials) return;
  const overview = driver.mode === 'overview';
  if (overview === gradeMode) return;
  gradeMode = overview;
  const lift = track.def.theme.overviewLift ?? 0x27251f;
  for (const m of track.groundMaterials) {
    const base = m.userData.baseColor || new THREE.Color(track.def.theme.groundColor);
    m.color.copy(base);
    if (overview) m.color.lerp(new THREE.Color(0xffffff), 0.8);
    // flat lift so dark tarmac/dirt textures (Dockyard) still read from altitude
    m.emissive.setHex(overview ? lift : 0x000000);
  }
}

function animate(now) {
  requestAnimationFrame(animate);
  // measured before the sim clamps it: the governor wants the frame the player
  // actually waited for, not the slice the physics was given
  const rawMs = now - last;
  last = now;
  let dt = rawMs / 1000;
  if (!(dt > 0)) dt = 0.016;
  dt = Math.min(dt, 1 / 30);

  track.update(dt);
  if (!raceOver) {
    controls.update(dt);
    driver.update(dt);
    // rivals hold the grid until the lights go out, so the field launches together
    if (phase !== 'grid') opponents.update(dt);
    combat.update(dt);
    // checked after the rival update so the field is classified as it stands
    if (driver.finished) showResults();
  }
  audio.update(dt, driver, opponents, !raceOver);
  // the light only moves on the frames whose shadow map is re-rendered, so the
  // map and the light transform never disagree
  if (frameCount % shadowEvery === 0) {
    updateSunShadow();
    renderer.shadowMap.needsUpdate = true;
  }
  applyFog();
  applyViewGrade();
  sky.position.copy(camera.position);
  syncHud();

  renderer.render(scene, camera);
  governor.sample(rawMs);

  frameCount += 1;
  fpsFrames += 1;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsValue = fpsFrames / fpsTime;
    if (fpsValueEl) fpsValueEl.textContent = `${Math.round(fpsValue)} FPS`;
    fpsFrames = 0;
    fpsTime = 0;
    refreshPerfChip();
    refreshDiag();
  }
}

/* ------------------------------------------------------------------ boot */

const params = new URLSearchParams(location.search);
const bootTrack = THREE.MathUtils.clamp(parseInt(params.get('track') || '0', 10) || 0, 0, TRACK_DEFS.length - 1);
applyTrack(bootTrack);
if (params.get('cam')) driver.setCameraMode(params.get('cam'));
// ?quality=0..3 pins a step for hardware A/B runs; otherwise the governor owns it
const pinQuality = params.get('quality');
if (pinQuality !== null) governor.pin(THREE.MathUtils.clamp(parseInt(pinQuality, 10) || 0, 0, QUALITY.length - 1));
applyQuality(governor.tier, QUALITY[governor.tier], 'boot');
driver.camSnap = true;
syncCameraUI();
updateSunShadow();
animate(performance.now());

function onViewportChange() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

addEventListener('resize', onViewportChange);
addEventListener('orientationchange', () => {
  // iOS reports stale dimensions on the orientation event itself
  setTimeout(onViewportChange, 120);
  setTimeout(onViewportChange, 400);
  // after each re-layout, in case Safari nudged the zoom while rotating
  setTimeout(resetPageScale, 150);
  setTimeout(resetPageScale, 450);
});

/* ------------------------------------------------------ page scale guard */

// iPhone Safari can still end up scaled even though the markup forbids zoom
// (a stray pinch across both control clusters, or a double tap the input guards
// missed). visualViewport.scale is read-only, so the only way back is to hand
// Safari a changed viewport declaration and re-anchor the document. Both
// declarations below are the same lock with the scale keys in a different
// order: a real value change for the meta to react to (which is what drops the
// zoom) but identical in effect, so nothing on screen moves. Runs only on an
// actual drift and never more than twice a second, so a resize loop cannot
// start.
const viewportMeta = document.querySelector('meta[name="viewport"]');
const VIEWPORT_LOCK = 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
const VIEWPORT_LOCK_ALT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover';
let scaleResetAt = 0;

function resetPageScale() {
  const vv = window.visualViewport;
  if (!vv || Math.abs(vv.scale - 1) < 0.01) return;
  const now = performance.now();
  if (now - scaleResetAt < 500) return;
  scaleResetAt = now;
  if (viewportMeta) {
    const current = viewportMeta.getAttribute('content') || '';
    viewportMeta.setAttribute('content', current.trim() === VIEWPORT_LOCK ? VIEWPORT_LOCK_ALT : VIEWPORT_LOCK);
  }
  window.scrollTo(0, 0);
  onViewportChange();
}

window.visualViewport?.addEventListener('resize', resetPageScale);
addEventListener('resize', resetPageScale);

document.addEventListener('visibilitychange', () => {
  last = performance.now();
});

/* ------------------------------------------------- debug / verification API */

window.__DEATHRACE = {
  driver,
  get trackRef() { return track; },
  get frames() { return frameCount; },
  get keys() { return { ...driver.keys }; },
  get fps() { return fpsValue; },
  get trackIndex() { return trackIndex; },
  get trackName() { return TRACK_DEFS[trackIndex].name; },
  get mode() { return driver.mode; },
  get cameraMode() { return driver.mode; },
  get camLabel() { return CAM_LABELS[driver.mode]; },
  get camera() { return { pos: camera.position.toArray(), near: camera.near, far: camera.far, fov: camera.fov }; },
  get weapons() { return { ...combat.hud }; },
  get speed() { return driver.state.speedKmh; },
  get lap() { return driver.state.lap; },
  get lapTime() { return driver.lapTime; },
  get bestLap() { return driver.bestLap; },
  get timing() { return driver.timing; },
  get armor() { return driver.armor; },
  get rockets() { return combat.hud.missiles; },
  get input() { return { ...driver.input }; },
  get assist() { return { mode: driver.assist.mode, ...driver._assist }; },
  setAssist(mode) { return controls.setAssist(mode); },
  get finished() { return driver.finished; },
  get finalTime() { return driver.finalTime; },
  get resultsShown() { return !resultsEl.hidden; },
  get resultsRows() {
    return [...resultList.children].map((li) => li.textContent.trim());
  },
  restartRace() { restartRace(); },
  startRace() { startRace(); },
  get phase() { return phase; },
  get armed() { return gridArmed; },
  get gridLock() { return driver.gridLock; },
  get audio() {
    return {
      state: audio.contextState,
      ready: audio.ready,
      enabled: audio.enabled,
      volume: audio.volume,
      voices: audio.voiceCount,
      engine: audio.engine,
    };
  },
  controls,
  opponents,
  combat,
  get racePos() { return driver.racePos; },
  get position() { return driver.car.position.toArray(); },
  get perf() {
    return {
      fps: Math.round(fpsValue),
      avgMs: +governor.avgMs.toFixed(2),
      p90Ms: +governor.p90Ms.toFixed(2),
      tier: qualityTier,
      id: QUALITY[qualityTier].id,
      changes: governor.changes,
      shadowEvery,
      pixelRatio: +renderer.getPixelRatio().toFixed(2),
      smoke: driver.smokeDensity,
      props: !!(track && track.props.visible),
      skyline: !!(track && track.skyline.visible),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      contextLosses,
      gpu: gpuName(),
    };
  },
  /** Roadside structure audit: what the kit built, what is actually drawn, and
      whether either shared group is visible. */
  get scenery() {
    if (!track) return null;
    return {
      ...(track.group.userData.scenery || {}),
      ...sceneryStats(),
      propsVisible: track.props.visible,
      skylineVisible: track.skyline.visible,
    };
  },
  governor,
  setQuality(i) { return governor.pin(i); },
  autoQuality() { governor.pinned = false; return governor.tier; },
  get drawCalls() { return renderer.info.render.calls; },
  get triangles() { return renderer.info.render.triangles; },
  get padCount() { return track.pads.length; },
  get sampleCount() { return track.samples.length; },
  setTrack(i) {
    if (i !== trackIndex) applyTrack(i);
    syncCameraUI();
  },
  setCameraMode(mode) {
    const applied = driver.setCameraMode(mode);
    syncCameraUI();
    return applied;
  },
  fireMissile() { return combat.fireMissile(); },
  dropOil(seconds = 0.5) { combat.dropOil(seconds); },
  toggleShield() { return combat.toggleShield(); },
  reloadWeapons() { combat.reloadAll(); },
  reset() { driver.resetToTrack(); },
  toggleCamera() { driver.toggleCamera(); syncCameraUI(); },
  setKeys(obj) { Object.assign(driver.keys, obj); },
  render() {
    updateSunShadow();
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    return renderer.info.render.calls;
  },
  step(seconds = 1, render = true) {
    const dt = 1 / 60;
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) {
      track.update(dt);
      driver.update(dt);
      opponents.update(dt);
      combat.update(dt);
    }
    updateSunShadow();
    renderer.shadowMap.needsUpdate = true;
    sky.position.copy(camera.position);
    syncHud();
    if (render) renderer.render(scene, camera);
    return {
      speed: driver.state.speedKmh,
      lap: driver.lap,
      nitro: Math.round(driver.nitro),
      pos: driver.car.position.toArray(),
      boosting: driver.state.boosting,
    };
  },
};
