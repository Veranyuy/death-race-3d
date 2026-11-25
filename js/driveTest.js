import * as THREE from './vendor/three.module.js';
import { PAD_TYPES } from './tracks.js';
import { loadModel, instantiate, mountWeapon, PLAYER_TRIS } from './modelLoader.js';

const UP = new THREE.Vector3(0, 1, 0);
const OVERVIEW_UP = new THREE.Vector3(0, 0, -1);

// physics + camera run 60 times a second, so their vectors are reused instead
// of allocated per frame
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwdSlope = new THREE.Vector3();
const _xAxis = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _camPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _qSteer = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _camUp = new THREE.Vector3();

/** Driving cameras, in cycle order. `overview` stays last so C never lands on
    the bird's-eye by accident while racing. */
export const CAM_MODES = ['chase', 'hood', 'cockpit', 'overview'];
export const CAM_LABELS = {
  chase: 'CHASE CAM',
  hood: 'HOOD CAM',
  cockpit: 'COCKPIT',
  overview: 'TRACK VIEW',
};

/** Near/far per mode: the cockpit needs a tiny near plane to sit inside the
    bodywork, the overview needs a huge far plane for the whole circuit. */
const CAM_CLIP = {
  chase: [0.5, 12000],
  hood: [0.5, 9000],
  cockpit: [0.12, 6000],
  overview: [20, 20000],
};
const MAX_SPEED = 72.2;        // m/s ~ 260 km/h (Monoposto top speed)
const BOOST_SPEED = 81.9;      // m/s ~ 295 km/h on nitro
const ACCEL = 33;
const BOOST_ACCEL = 48;
const BRAKE = 80;
const REVERSE_MAX = 15;
/* Coasting: with GAS released and no brake the car is only slowed by the
   tyres' rolling resistance and by aero drag. Aero drag is also what the
   engine fights at the top end, so being off the throttle at 250 km/h feels
   like the same car at full throttle — momentum carries into the corner. */
const COAST_ROLL = 1.8;        // m/s^2 of rolling resistance, GAS released
const AERO_DRAG = 0.0016;      // quadratic drag (1/m); sets the top speed
/* Cornering model: `grip` is how fast lateral velocity is bled off into the
   car's heading. It falls off with speed, so momentum carries the car wide in
   a fast entry, and it rises under braking as weight moves onto the front
   axle. `LAT_ACCEL` is the tyre force budget in m/s^2; the yaw rate is capped
   by it, so no speed can rotate the car faster than its tyres could. */
const GRIP_LOW = 12.6;         // m/s of slip killed per second at low speed
const GRIP_HIGH = 5.0;         // ...at 260 km/h the car pushes wide
const GRIP_BRAKE = 3.2;        // weight transfer onto the front axle
const GRIP_DRIFT = 4.4;        // rear tyres broken loose in a power drift
const LAT_ACCEL = 34;          // m/s^2 of lateral grip (arcade slicks)
/* Steering is tyre-driven, not yaw-driven. The input swings the front wheels
to a real angle; the lock falls away with speed like a real rack; a bicycle
model turns that wheel angle at road speed into the yaw the car wants; and the
body's yaw rate chases that request through a slip-angle lag. Nothing pivots
the car directly, so holding a lock at 250 km/h pushes the nose wide instead of
snapping the whole block sideways. */
const WHEELBASE = 2.95;        // m between the axles (matches the model)
const STEER_LOCK_LOW = 0.55;   // rad of front-wheel angle at a crawl (~31 deg)
const STEER_LOCK_HIGH = 0.09;  // ...the floor the lock falls to at top speed
const STEER_LOCK_FALL = 9;     // lock = HIGH + (LOW-HIGH)/(1 + sn*this)
const STEER_RATE = 4.2;        // rad/s the wheels may swing into a turn
const STEER_RETURN = 5.6;      // rad/s they self-centre on their own
const YAW_RESPONSE = 8.8;      // 1/s the body catches up with the wheels
const YAW_RESPONSE_DRIFT = 12.5; // rear tyres lit: the nose comes round faster
const ROLL_GAIN = 0.0019;      // rad of body lean per m/s^2 of lateral load
const ROLL_MAX = 0.06;         // ~3.4 deg: reads as weight, never a motorcycle
const PITCH_GAIN = 0.0008;     // rad of dive/squat per m/s^2
const PITCH_MAX = 0.026;

/* Garage turntable: a slow orbit round the car on its grid slot. It reuses the
   one car mesh the race drives, so the showcase costs no extra draw calls. */
const GARAGE_SPIN = 0.34;      // rad/s
const GARAGE_RADIUS = 6.9;     // m from the car
const GARAGE_HEIGHT = 2.4;     // m above the road
const GARAGE_FOV = 40;

/* AI driving assist look-ahead, in metres: short at low speed so it only
   sees the next corner, long at top speed so there is room to slow for it. */
const ASSIST_NEAR = 35;        // m of look-ahead at low speed
const ASSIST_FAR = 75;         // ...at top speed
/* `lat` is the apex lateral load a gentle sweeper may use, `tightLat` the one
   a real hairpin gets — the tightest corners keep the conservative half-tyre
   margin, while bends the car obviously holds are not dribbled through at a
   crawl. `need` is the deceleration that must already be required before the
   pedal moves, and `maxBrake` caps how hard it may lean on it. */
const ASSIST = {
  // high: the phone mode — late, gentle, and only for corners that need it
  high: { lat: 26, tightLat: 17, need: 20, maxBrake: 0.5 },
  // low: keyboard crutch, only touches a real emergency
  low: { lat: 30, tightLat: 23, need: 30, maxBrake: 0.4 },
};
const SMOKE_COUNT = 24;

const _puffObj = new THREE.Object3D();

/** Soft radial puff used by the tyre smoke: a hard sphere reads as a soap
    bubble, a billboard with a gradient reads as smoke. */
function makePuffTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** mm:ss.t lap time formatter. */
export function formatLapTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.-';
  const m = Math.floor(seconds / 60);
  const sec = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
}

/* --------------------------------------------------------------- car model */

function buildCarMesh() {
  const car = new THREE.Group();
  car.name = 'test-car';

  // the bodywork rides in its own group so it can roll and pitch on the
  // suspension while the wheels stay planted on the road
  const shell = new THREE.Group();
  car.add(shell);

  // there is no environment map, so metalness only eats diffuse light: kept low
  // enough that the bodywork still shows its colour in shade
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5d7689, metalness: 0.18, roughness: 0.38 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xe04a22, metalness: 0.14, roughness: 0.4 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b2126, metalness: 0.12, roughness: 0.7 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2c36, metalness: 0.2, roughness: 0.14 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0xbfe9ff, emissiveIntensity: 2.4 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x1a0604, emissive: 0xff2a0a, emissiveIntensity: 0.5 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x202427, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc2ccd2, metalness: 0.24, roughness: 0.3 });

  // main body
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.36, 4.15), darkMat);
  lower.position.y = 0.42;
  shell.add(lower);

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.46, 4.5), bodyMat);
  chassis.position.y = 0.7;
  shell.add(chassis);

  // nose wedge
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.28, 1.5), bodyMat);
  nose.position.set(0, 0.96, 1.55);
  nose.rotation.x = -0.1;
  shell.add(nose);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.1, 0.7), darkMat);
  splitter.position.set(0, 0.46, 2.2);
  shell.add(splitter);

  // cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.5, 1.95), bodyMat);
  cabin.position.set(0, 1.08, -0.15);
  shell.add(cabin);

  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 1.6), glassMat);
  windscreen.position.set(0, 1.16, 0.18);
  shell.add(windscreen);

  // accent stripes
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 3.6), accentMat);
    stripe.position.set(side * 1.04, 0.94, 0.1);
    shell.add(stripe);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 2.7), accentMat);
    skirt.position.set(side * 0.98, 0.42, -0.2);
    shell.add(skirt);
  }

  // rear wing
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.1, 0.56), accentMat);
  wing.position.set(0, 1.44, -2.0);
  shell.add(wing);
  for (const side of [-1, 1]) {
    const support = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.32), darkMat);
    support.position.set(side * 0.8, 1.2, -2.0);
    shell.add(support);
  }

  // lights
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.1), headMat);
    head.position.set(side * 0.62, 0.9, 2.28);
    shell.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.08), brakeMat);
    tail.position.set(side * 0.66, 0.9, -2.28);
    shell.add(tail);
  }

  // wheels
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.38, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.4, 8);
  rimGeo.rotateZ(Math.PI / 2);
  for (const [x, z, front] of [[-1.0, 1.45, true], [1.0, 1.45, true], [-1.02, -1.5, false], [1.02, -1.5, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.46, z);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    wheel.add(rim);
    wheel.castShadow = true;
    pivot.add(wheel);
    car.add(pivot);
    wheels.push({ wheel, pivot, front });
  }

  // nitro flames
  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x63f4ff, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flameGeo = new THREE.ConeGeometry(0.17, 1.15, 8);
  for (const side of [-1, 1]) {
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(side * 0.48, 0.62, -2.65);
    flame.visible = false;
    shell.add(flame);
    flames.push(flame);
  }

  // muzzle flashes for the primary gun (rounds live in js/combat.js)
  const muzzleMat = new THREE.MeshBasicMaterial({
    color: 0xfff1c4, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const muzzleGeo = new THREE.PlaneGeometry(0.5, 0.5);
  const muzzles = [];
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(muzzleGeo, muzzleMat);
    m.position.set(side * 0.62, 0.98, 2.42);
    m.visible = false;
    shell.add(m);
    muzzles.push(m);
  }

  /* Bodywork is every shell mesh that is not an effect. Listed once here, so a
     mounted .glb hides the boxes with a single loop and the flames and muzzle
     flashes — which are not bodywork — keep drawing over it. */
  const body = [];
  car.traverse((o) => {
    if (!o.isMesh || o.material === flameMat || o.material === muzzleMat) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (o.parent === shell) body.push(o);
  });

  car.userData = {
    wheels, flames, brakeMat, muzzles, shell, body,
    // kept so the garage can repaint the body without rebuilding the mesh
    mats: { bodyMat, accentMat, darkMat, glassMat, headMat, wheelMat, rimMat, brakeMat },
  };
  return car;
}

/* ---------------------------------------------------------- cockpit shell */

/** Camera-attached dashboard / pillars / header. Because it lives on the
    camera instead of the car, every vehicle model gets the same clean
    first-person frame without any per-model cockpit art. */
function buildCockpitRig() {
  const rig = new THREE.Group();
  rig.name = 'cockpit-rig';
  rig.visible = false;

  const frame = new THREE.MeshBasicMaterial({
    color: 0x0b1115, transparent: true, opacity: 0.96,
    depthTest: false, depthWrite: false,
  });
  const trim = new THREE.MeshBasicMaterial({
    color: 0x2f7f8e, transparent: true, opacity: 0.55,
    depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  // slim cowl + instrument strip along the bottom of the frame
  const dash = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.34), frame);
  dash.position.set(0, -0.63, -0.66);
  dash.rotation.x = 0.26;
  rig.add(dash);

  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.018, 0.03), trim);
  strip.position.set(0, -0.49, -0.8);
  rig.add(strip);

  // thin A-pillars well out at the screen edges, so the forward view stays open
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.05, 0.1), frame);
    pillar.position.set(side * 1.03, 0.3, -0.74);
    pillar.rotation.z = side * 0.34;
    pillar.rotation.y = side * -0.14;
    rig.add(pillar);
  }

  const header = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 0.12), frame);
  header.position.set(0, 0.53, -0.8);
  header.rotation.x = -0.3;
  rig.add(header);

  for (const mesh of rig.children) {
    mesh.renderOrder = 20;
    mesh.frustumCulled = false;
  }
  rig.renderOrder = 20;
  return rig;
}

/* ------------------------------------------------------------------ driver */

export class DriveTest {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.track = null;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.nitro = 100;
    // latched nitro: one tap arms it, and it burns hands-free until empty or
    // until it is tapped off again
    this.nitroActive = false;
    this.lap = 1;
    this.lastU = 0;
    this.lapLock = 0;
    this.hintIndex = -1;
    this.wheelSpin = 0;
    this.steerVisual = 0;
    this.steerAngle = 0;      // rad of front-wheel angle actually on the car
    this.yawVel = 0;          // rad/s the body is actually rotating at
    this.bodyRoll = 0;        // suspension lean, rad
    this.bodyPitch = 0;       // dive / squat, rad
    // per-car physics. Starts at the reference constants, so a DriveTest that
    // is never handed a manifest entry still drives the tuned baseline car.
    this.tune = {
      maxSpeed: MAX_SPEED,
      boostSpeed: BOOST_SPEED,
      accel: ACCEL,
      boostAccel: BOOST_ACCEL,
      latAccel: LAT_ACCEL,
      gripLow: GRIP_LOW,
      gripHigh: GRIP_HIGH,
      armorMax: 100,
      weaponMul: 1,
    };
    this.carDef = null;
    // the mounted .glb (null while the procedural body stands in) and its
    // wheel nodes. Bumped per mount so a slow download cannot land on a car
    // the player has already moved on from.
    this.model = null;
    this.modelWheels = [];
    // the roster's hardpoint gun, once it has been measured onto the body
    this.weapon = null;
    this._modelToken = 0;
    // garage showcase: the camera orbits the parked car instead of chasing it
    this.garage = false;
    this.garageAngle = 0.9;
    this.camSnap = true;
    this.mode = 'chase';
    this.modeIndex = 0;
    this._camMode = null;
    this.accelLong = 0;
    this.latAccel = 0;
    this.yawRate = 0;
    this.shieldActive = false;
    this.combat = null;
    this.sampleUp = new THREE.Vector3(0, 1, 0);
    this.sampleRight = new THREE.Vector3(1, 0, 0);
    this.messages = [];
    this.timing = false;
    this.lapTime = 0;
    this.lastLap = 0;
    this.bestLap = 0;
    this.raceTime = 0;
    this.finished = false;
    this.finalTime = 0;
    this.finalPosition = 1;
    this.state = {
      speedKmh: 0, lap: 1, nitro: 100, boosting: false, nitroActive: false,
      lapTime: 0, bestLap: 0, lastLap: 0,
      armor: 100,
      position: 1, fieldSize: 7, lapTotal: 3,
      assistActive: false,
    };
    this._center = new THREE.Vector3();
    this._size = new THREE.Vector3(300, 0, 300);
    this._vLong = 0;
    this._prevY = 0;
    this._vy = 0;

    // AI driving assist is on by default for touch players, off for keyboard
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.assist = { mode: coarse ? 'high' : 'off' };
    // set while the start lights are still counting down: the pedals are dead
    // until the shell opens the grid, so the car can rev without creeping
    this.gridLock = false;
    // only what the next frame or the HUD actually reads is kept here
    this._assist = { brake: 0, cut: 0, need: 0, safeSpeed: 0 };
    this._wallSteer = 0;

    // analog input written by js/controls.js (touch, tilt, auto-accelerate)
    this.input = { steer: 0, throttle: 0, brake: 0, gun: false, oil: false };
    this.armor = this.tune.armorMax;
    this.flash = 0;
    this.racePos = 1;
    this.fieldSize = 7;
    this.lapTotal = 3;

    this.car = buildCarMesh();
    scene.add(this.car);

    /* tyre smoke for power drifts: one instanced draw call, and the mesh is
       hidden outright while the pool is empty */
    this.puffMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({
        map: makePuffTexture(), color: 0xd4dadd, side: THREE.DoubleSide,
        transparent: true, opacity: 0.62, depthWrite: false,
      }),
      SMOKE_COUNT
    );
    this.puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffMesh.frustumCulled = false;
    this.puffMesh.count = 0;
    this.puffMesh.visible = false;
    scene.add(this.puffMesh);
    this.puffs = new Array(SMOKE_COUNT).fill(null).map(() => ({
      live: false, life: 0, max: 1, size: 1,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    }));
    this.smokeTimer = 0;
    this.puffSide = 1;
    // scaled by the quality governor: 1 = full, 0.15 = a puff every few frames
    this.smokeDensity = 1;

    // the cockpit shell is parented to the camera, so the camera has to be in
    // the scene graph for its children to be rendered
    this.cockpitRig = buildCockpitRig();
    camera.add(this.cockpitRig);
    scene.add(camera);

    this.keys = { forward: false, back: false, left: false, right: false, gun: false, oil: false };
    this._bind();
  }

  _bind() {
    const map = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'back', ArrowDown: 'back',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        // nitro is a latch, so only the press toggles it; the keyup does not
        // touch it
        if (!e.repeat) this.toggleNitro();
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyR' && !e.repeat) {
        this.resetToTrack();
        return;
      }
      if (e.code === 'KeyC' && !e.repeat) {
        this.toggleCamera();
        return;
      }
      if (e.code === 'Space') {
        this.keys.gun = true;
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyE' && !e.repeat) {
        this.combat?.fireMissile();
        return;
      }
      if (e.code === 'KeyQ' && !e.repeat) {
        this.combat?.dropOil(0.4);
        return;
      }
      if (e.code === 'KeyF' && !e.repeat) {
        this.combat?.toggleShield();
        return;
      }
      const action = map[e.code];
      if (action) {
        this.keys[action] = true;
        e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.keys.gun = false;
        return;
      }
      const action = map[e.code];
      if (action) this.keys[action] = false;
    });
    addEventListener('blur', () => {
      this.keys.forward = this.keys.back = this.keys.left = this.keys.right = false;
      this.keys.gun = this.keys.oil = false;
    });
  }

  /** Adopts one manifest entry (js/cars.js): repaints the body and swaps the
      handling / armour / weapon numbers in one place, so the car shown in the
      garage is exactly the car that launches. */
  applyCar(def) {
    this.carDef = def;
    const t = def.tune;
    this.tune.maxSpeed = MAX_SPEED * t.speed;
    this.tune.boostSpeed = BOOST_SPEED * t.speed;
    this.tune.accel = ACCEL * t.accel;
    this.tune.boostAccel = BOOST_ACCEL * t.accel;
    this.tune.latAccel = LAT_ACCEL * t.grip;
    this.tune.gripLow = GRIP_LOW * t.grip;
    this.tune.gripHigh = GRIP_HIGH * t.grip;
    this.tune.armorMax = Math.round(100 * t.armor);
    this.tune.weaponMul = t.weapons;
    this.armor = this.tune.armorMax;

    const p = def.paint;
    const m = this.car.userData.mats;
    m.bodyMat.color.setHex(p.body);
    m.accentMat.color.setHex(p.accent);
    m.darkMat.color.setHex(p.dark);
    m.glassMat.color.setHex(p.glass);
    m.headMat.emissive.setHex(p.head);
    m.brakeMat.emissive.setHex(p.brake);
    m.wheelMat.color.setHex(p.wheel);
    m.rimMat.color.setHex(p.rim);
    this.car.name = `player-${def.id}`;
    this.mountModel(def);
  }

  /** Swaps the bodywork for the roster entry's .glb, or puts the procedural
      chassis back when the entry has no model. The box chassis is hidden but
      never disposed, so a failed download simply leaves it on screen. */
  mountModel(def) {
    const token = ++this._modelToken;
    const { shell, body, wheels } = this.car.userData;
    const procedural = (on) => {
      for (const o of body) o.visible = on;
      for (const w of wheels) w.pivot.visible = on;
    };
    if (this.model) shell.remove(this.model);
    if (this.weapon) shell.remove(this.weapon);
    this.model = null;
    this.weapon = null;
    this.modelWheels = [];
    this.car.userData.modelState = def.model ? 'loading' : 'box';
    this.car.userData.modelTris = 0;

    if (!def.model) { procedural(true); this._mountWeapon(def, token); return; }
    console.info(`[model] ${def.name}: loading ${def.model}`);
    loadModel(def.model, !!def.modelFlip, PLAYER_TRIS).then((entry) => {
      if (token !== this._modelToken) return;
      const mount = instantiate(entry);
      shell.add(mount.group);
      this.model = mount.group;
      this.modelWheels = mount.wheels;
      this.car.userData.modelState = 'ready';
      this.car.userData.modelTris = entry.tris;
      procedural(false);
      console.info(`[model] ${def.name}: ${entry.tris.toLocaleString()} tris, ${mount.wheels.length} wheel corners — box chassis hidden`);
      this._mountWeapon(def, token);
    }).catch((err) => {
      if (token !== this._modelToken) return;
      /* The old body was already taken off the shell above, so the box
         chassis has to be put back here: without this a car whose model
         fails after a working one draws as nothing at all. */
      procedural(true);
      this.car.userData.modelState = 'failed';
      console.error(`[model] ${def.name}: FAILED ${def.model} — box chassis in use.`, err);
      this.messages.push({ text: `${def.name} MODEL FAILED · BOX BODY`, color: '#ff4a32' });
      this._mountWeapon(def, token);
    });
  }

  /** Bolts the roster's hardpoint gun onto whatever body is actually on the
      car. It is seated on the bodywork above its hardpoint, so a model and the
      procedural chassis both get a mount that touches the shell; the token
      keeps a slow weapon download from landing on a car the player has already
      switched away from. */
  _mountWeapon(def, token) {
    const shell = this.car.userData.shell;
    mountWeapon(shell, def).then((group) => {
      if (!group) return;
      if (token !== this._modelToken) {
        group.parent?.remove(group);
        return;
      }
      this.weapon = group;
    });
  }

  setTrack(track) {
    this.track = track;
    const size = track.bounds.getSize(new THREE.Vector3());
    this._size.copy(size);
    track.bounds.getCenter(this._center);
    this.nitro = 100;
    this.nitroActive = false;
    this.lap = 1;
    this.lapLock = 0;
    this.messages.length = 0;
    this.timing = false;
    this.lapTime = 0;
    this.lastLap = 0;
    this.bestLap = 0;
    this.raceTime = 0;
    this.finished = false;
    this.finalTime = 0;
    this.finalPosition = 1;
    this.armor = this.tune.armorMax;
    this.flash = 0;
    this.racePos = 1;
    // stand on the line: ~30 m past the gantry so the chase cam clears the banner
    const startIndex = Math.max(1, Math.round((30 / track.length) * track.samples.length));
    const startSample = track.samples[startIndex];
    this.placeAt(startSample, startSample.tan);
    this.lastU = startIndex / track.samples.length;
    this.hintIndex = startIndex;
    this.camSnap = true;
  }

  /** Flip the bottle latch and return its new state, so the caller can tell a
      cut from a refused tap. Only legal while the car is actually racing and
      the meter has something in it, which is also what keeps a tap on the
      results sheet or on the grid from doing anything. */
  toggleNitro() {
    const want = !this.nitroActive;
    this.nitroActive = want && !this.gridLock && !this.finished && this.nitro > 0.5;
    return this.nitroActive;
  }

  placeAt(sample, tan) {
    this.position.copy(sample.pos);
    this.position.y = sample.pos.y;
    this.velocity.set(0, 0, 0);
    this._vLong = 0;
    // a held yaw rate or steering angle from before the reset would carry the
    // car straight off the line again
    this.yawVel = 0;
    this.steerAngle = 0;
    this.steerVisual = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.yaw = Math.atan2(tan.x, tan.z);
    this.car.position.copy(this.position);
    this.car.quaternion.setFromAxisAngle(UP, this.yaw);
  }

  resetToTrack() {
    if (!this.track) return;
    const near = this.track.nearest(this.position, -1);
    this.placeAt(near.sample, near.sample.tan);
    this.hintIndex = near.index;
    this.lastU = near.u;
    this.camSnap = true;
    this.pushMessage('RESET TO CENTERLINE', '#8fe8ff');
  }

  toggleCamera() {
    return this.setCameraMode(CAM_MODES[(this.modeIndex + 1) % CAM_MODES.length]);
  }

  setCameraMode(mode) {
    const index = CAM_MODES.indexOf(mode);
    this.modeIndex = index >= 0 ? index : 0;
    this.mode = CAM_MODES[this.modeIndex];
    this.camSnap = true;
    return this.mode;
  }

  pushMessage(text, color) {
    this.messages.push({ text, color });
  }

  /* ---------------------------------------------------------------- physics */

  update(dt) {
    if (!this.track) return;
    const car = this.car;
    const keys = this.keys;
    const input = this.input;
    // on the grid every pedal is ignored: the countdown owns the launch. The
    // rest of update still runs, so the camera settles, the wheels and revs
    // respond and the wait reads as a start rather than a freeze
    const locked = this.gridLock;
    const throttleInput = !locked && (keys.forward || input.throttle > 0.05);
    const brakeInput = !locked && (keys.back || input.brake > 0.05);
    const boostInput = !locked && this.nitroActive;

    const prevVLong = this._vLong;
    const prevYaw = this.yaw;
    let vLong = this.velocity.dot(_fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
    if (locked) {
      this.velocity.set(0, 0, 0);
      vLong = 0;
    }
    const wantBoost = boostInput && this.nitro > 0.5 && vLong > -0.5;
    if (wantBoost) {
      // 16/s: a full bottle is a ~6.2 s burn. A lap here runs about 100 s, so
      // that is roughly a long straight plus the corner after it — long enough
      // to feel like a decision on a phone instead of a twitch
      this.nitro = Math.max(0, this.nitro - 16 * dt);
      // bottle dry: the latch lets go on the same frame the burn ends, so the
      // trickle of regen can never make the boost stutter on and off
      if (this.nitro <= 0.5) this.nitroActive = false;
    } else this.nitro = Math.min(100, this.nitro + 2.6 * dt);
    const boosting = wantBoost && this.nitro > 0;
    this.state.boosting = boosting;

    // corner assist runs off the car's last known track position, so it has
    // to resolve before the steering and throttle below are applied
    this.updateAssist(dt, boosting);
    const assistOn = this.assist.mode !== 'off';
    // updateAssist zeroes the pedal itself when it is not allowed to act, so
    // the physics can read it unconditionally
    const assistBrake = this._assist.brake;
    const assistCut = this._assist.cut;

    /* ---- steering: the stick swings the wheels, the tyres turn the car ---- */
    let steer = THREE.MathUtils.clamp(
      (keys.left ? 1 : 0) - (keys.right ? 1 : 0) + input.steer, -1, 1
    );
    if (assistOn) steer = THREE.MathUtils.clamp(steer + this._wallSteer, -1, 1);
    const speedAbs = Math.abs(vLong);
    const sn = Math.min(speedAbs / this.tune.maxSpeed, 1);
    // lock falls away with speed in the same shape as a real rack: most of a
    // turn at a crawl, only a few degrees left at 260 km/h
    const lock = STEER_LOCK_HIGH + (STEER_LOCK_LOW - STEER_LOCK_HIGH) / (1 + sn * STEER_LOCK_FALL);
    const wantAngle = steer * lock;
    // nothing snaps: the wheels swing at a finite rate and self-centre faster
    // than they turn in, which is what makes a flick of the thumb read as a
    // steer instead of a teleport
    const aligning = Math.abs(wantAngle) < Math.abs(this.steerAngle)
      && (wantAngle === 0 || Math.sign(wantAngle) === Math.sign(this.steerAngle));
    const swing = aligning ? STEER_RETURN : STEER_RATE;
    this.steerAngle += THREE.MathUtils.clamp(wantAngle - this.steerAngle, -swing * dt, swing * dt);

    // a power drift is brake + steering at speed: the rear steps out and the
    // nose rotates past where the tyres would otherwise let it
    const drift = brakeInput && speedAbs > 18 && Math.abs(this.steerAngle) > 0.045;
    const yawCap = (this.tune.latAccel * (drift ? 1.12 : 1)) / Math.max(speedAbs, 8);
    // bicycle model: the wheelbase turns a front-wheel angle at road speed into
    // the yaw the car is asking for, and the tyre budget caps it
    const yawAsk = (vLong * Math.tan(this.steerAngle)) / WHEELBASE;
    const yawTarget = THREE.MathUtils.clamp(yawAsk, -yawCap, yawCap);
    // the body trails the wheels by a slip angle, so the rotation builds over
    // about 0.15 s; a lit-up rear axle shortens that lag
    const yawK = (drift ? YAW_RESPONSE_DRIFT : YAW_RESPONSE) * (0.85 + 0.15 * (1 - sn));
    this.yawVel += (yawTarget - this.yawVel) * (1 - Math.exp(-yawK * dt));
    this.yaw += this.yawVel * dt;
    this.steerVisual += (steer * 0.38 - this.steerVisual) * Math.min(1, dt * 12);

    const fwd = _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = _right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    vLong = this.velocity.dot(fwd);
    let vLat = this.velocity.dot(right);

    const maxSpeed = boosting ? this.tune.boostSpeed : this.tune.maxSpeed;

    // the assist feathers the throttle and adds brake rather than replacing
    // the player's own input
    const drive = throttleInput ? 1 - assistCut : 0;
    const brakeAmt = Math.min(1, (brakeInput ? 1 : 0) + assistBrake);

    if (boosting) {
      /* Nitro is its own thrust source, so tapping it with GAS released still
         pulls the car — the whole point of the surge. With GAS held the engine
         is already working, so the bottle leans in a little less and the two
         simply add up instead of the throttle being required to move. */
      const taper = Math.max(0.12, 1 - Math.max(vLong, 0) / this.tune.boostSpeed);
      const thrust = drive > 0.02 ? this.tune.boostAccel * 0.7 : this.tune.boostAccel;
      vLong += thrust * taper * dt;
    }
    if (drive > 0.02 && vLong < maxSpeed) {
      const taper = Math.max(0.18, 1 - Math.max(vLong, 0) / maxSpeed);
      vLong += this.tune.accel * taper * drive * dt;
    }
    if (brakeAmt > 0.02) {
      if (vLong > 0.3) vLong -= BRAKE * brakeAmt * dt;
      else if (brakeInput && vLong > -REVERSE_MAX) vLong -= 20 * dt;
    }
    /* Lift-off: rolling resistance only, never a hidden brake. The car keeps
       its momentum and bleeds speed over seconds, and nitro keeps its own
       thrust clean rather than being eaten by the coast term. */
    if (!boosting && drive <= 0.02 && brakeAmt <= 0.02 && Math.abs(vLong) > 0.02) {
      const roll = Math.min(COAST_ROLL * dt, Math.abs(vLong));
      vLong -= Math.sign(vLong) * roll;
    }
    // aero drag acts whether or not the throttle is down
    vLong -= Math.sign(vLong) * AERO_DRAG * vLong * vLong * dt;
    // Just off the bottle the car is allowed to carry its overspeed instead of
    // being snapped down to the normal limit; aero drag bleeds it back over the
    // next second, so the burn ends in a coast rather than a wall.
    const ceiling = boosting
      ? maxSpeed * 1.02
      : Math.max(maxSpeed * 1.02, Math.min(vLong, this.tune.boostSpeed));
    vLong = THREE.MathUtils.clamp(vLong, -REVERSE_MAX, ceiling);

    // lateral grip: less of it the faster you go, more of it under braking,
    // almost none while the rear tyres are lit up in a drift
    const speedNow = Math.abs(vLong);
    let grip = this.tune.gripLow + (this.tune.gripHigh - this.tune.gripLow) * sn;
    if (drift) grip = GRIP_DRIFT;
    else {
      if (brakeInput) grip += GRIP_BRAKE;
      if (boosting) grip -= 1.2;
    }
    vLat *= Math.exp(-grip * dt);
    const slip = Math.atan2(vLat, Math.max(speedNow, 4));

    this.velocity.copy(fwd).multiplyScalar(vLong).addScaledVector(right, vLat);
    this.position.addScaledVector(this.velocity, dt);

    /* ---- wall bounds ---- */
    const near = this.track.nearest(this.position, this.hintIndex);
    this.hintIndex = near.index;
    const s = near.sample;
    this.sampleUp.copy(s.up);
    this.sampleRight.copy(s.right);
    const lateral = (this.position.x - s.pos.x) * s.right.x + (this.position.z - s.pos.z) * s.right.z;
    const limit = this.track.halfWidth + 0.1;
    if (Math.abs(lateral) > limit) {
      const sign = Math.sign(lateral);
      const over = Math.abs(lateral) - limit;
      this.position.addScaledVector(s.right, -sign * over);
      const vOut = (this.velocity.x * s.right.x + this.velocity.z * s.right.z) * sign;
      // stability assist: a softer rebound stops the car ping-ponging off
      // the barrier when a touch steer is held into it
      const rebound = assistOn ? 0.92 : 1.2;
      if (vOut > 0) {
        this.velocity.addScaledVector(s.right, -sign * vOut * rebound);
        this.velocity.multiplyScalar(assistOn ? 0.95 : 0.965);
        // barrier scraping costs armor; an active ray shield eats the hit
        if (vOut > 6 && !this.shieldActive) {
          this.armor = Math.max(0, this.armor - (vOut - 6) * 0.42);
        }
      }
    }

    /* ---- follow ground elevation ---- */
    this.position.y = s.pos.y;
    this._vLong = vLong;
    // counter-steer is resolved from this frame's barrier contact and applied
    // to the steering at the top of the next one
    const wallOut = (this.velocity.x * s.right.x + this.velocity.z * s.right.z) * Math.sign(lateral);
    this._wallSteer = assistOn ? this.wallSteer(lateral, wallOut) : 0;
    this.updateSmoke(dt, drift, speedNow, slip);
    // longitudinal / lateral acceleration feed the cockpit pitch and roll
    this.accelLong = dt > 0 ? THREE.MathUtils.clamp((vLong - prevVLong) / dt, -45, 45) : 0;
    this.yawRate = dt > 0 ? (this.yaw - prevYaw) / dt : 0;
    this.latAccel = vLong * this.yawRate;

    // orientation follows road slope
    const up = s.up;
    const fwdSlope = _fwdSlope.copy(fwd).addScaledVector(up, -fwd.dot(up));
    if (fwdSlope.lengthSq() < 1e-4) fwdSlope.copy(fwd);
    fwdSlope.normalize();
    _xAxis.crossVectors(up, fwdSlope).normalize();
    const targetQuat = _quat.setFromRotationMatrix(_basis.makeBasis(_xAxis, up, fwdSlope));

    /* ---- chassis load: the shell leans out of the corner and dives under
       braking while the wheels stay flat on the road ---- */
    const rollTarget = THREE.MathUtils.clamp(this.latAccel * ROLL_GAIN, -ROLL_MAX, ROLL_MAX);
    const pitchTarget = THREE.MathUtils.clamp(-this.accelLong * PITCH_GAIN, -PITCH_MAX, PITCH_MAX);
    const loadK = 1 - Math.exp(-9 * dt);
    this.bodyRoll += (rollTarget - this.bodyRoll) * loadK;
    this.bodyPitch += (pitchTarget - this.bodyPitch) * loadK;
    const shell = car.userData.shell;
    shell.rotation.z = this.bodyRoll;
    shell.rotation.x = this.bodyPitch;

    car.position.copy(this.position);
    if (this.camSnap) car.quaternion.copy(targetQuat);
    else car.quaternion.slerp(targetQuat, 1 - Math.exp(-14 * dt));

    /* ---- visuals ---- */
    this.wheelSpin -= vLong * dt / 0.46;
    for (const w of car.userData.wheels) {
      w.wheel.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steerAngle;
    }
    /* A real model's own wheels: all four roll about the car's lateral axis,
       the front pair also steers about its up axis, and each corner spins about
       its own axle pivot (js/modelLoader.js), so a model authored Z-up or with
       its tyres saved at an angle still rolls the way the car is pointing. A
       corner can be several pivots — an export that names the tyre and the rim
       separately — so every part gets the same pair of angles. The angle is the
       road distance over that tyre's own radius: a model tyre is rarely the box
       chassis' 0.46 m, and the box chassis' accumulator is signed for its own
       x axis. */
    for (const w of this.modelWheels) {
      const roll = (-0.46 * this.wheelSpin) / (w.radius || 0.46);
      for (const part of w.parts) {
        _qSpin.setFromAxisAngle(part.spin, roll);
        if (w.front) {
          _qSteer.setFromAxisAngle(part.up, this.steerAngle);
          part.node.quaternion.copy(_qSteer).multiply(_qSpin).multiply(part.base);
        } else {
          part.node.quaternion.copy(_qSpin).multiply(part.base);
        }
      }
    }
    const flameOn = boosting && vLong > 2;
    for (const f of car.userData.flames) {
      f.visible = flameOn;
      if (flameOn) {
        const flick = 0.8 + Math.sin(performance.now() * 0.045) * 0.2;
        f.scale.set(flick, flick * (0.9 + Math.random() * 0.35), flick);
      }
    }
    car.userData.brakeMat.emissiveIntensity = brakeInput ? 3.4 : 0.5;

    /* ---- muzzle flash (rounds, ammo and tracers live in js/combat.js) ---- */
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    const gunHeld = keys.gun === true || input.gun === true;
    for (const m of car.userData.muzzles) {
      const burst = this.flash > 0;
      m.visible = gunHeld || burst;
      if (m.visible) {
        const scale = (gunHeld ? 0.55 + Math.random() * 0.5 : 0.2) + (burst ? 1.5 : 0);
        m.scale.set(scale, scale, 1);
        m.rotation.z = (Math.random() - 0.5) * 1.2;
      }
    }

    /* ---- pads ---- */
    for (const pad of this.track.pads) {
      if (pad.cooldown > 0) continue;
      const dx = this.position.x - pad.position.x;
      const dz = this.position.z - pad.position.z;
      const along = dx * pad.tan.x + dz * pad.tan.z;
      const across = dx * pad.right.x + dz * pad.right.z;
      if (Math.abs(along) < pad.halfLength + 0.9 && Math.abs(across) < pad.halfWidth + 0.9) {
        this.triggerPad(pad);
      }
    }

    /* ---- lap counter ---- */
    const u = near.u;
    if (this.lapLock > 0) this.lapLock -= dt;
    if (this.lapLock <= 0) {
      if (this.lastU > 0.78 && u < 0.22) {
        if (this.timing && this.lapTime > 8) {
          this.lastLap = this.lapTime;
          const isBest = !this.bestLap || this.lapTime < this.bestLap;
          if (isBest) this.bestLap = this.lapTime;
          this.pushMessage(
            `LAP ${this.lap}  ${formatLapTime(this.lapTime)}  //  ${isBest ? 'BEST' : 'SPLIT'}`,
            isBest ? '#9dffc0' : '#ffd27a'
          );
        } else {
          this.pushMessage(`LAP ${this.lap}`, '#ffd27a');
        }
        this.lapTime = 0;
        this.lap += 1;
        this.lapLock = 3;
        if (this.lap > this.lapTotal) this.finishRace();
      } else if (this.lastU < 0.22 && u > 0.78) {
        this.lap = Math.max(1, this.lap - 1);
        this.lapLock = 3;
      }
    }
    this.lastU = u;

    if (!this.finished && !this.timing && (throttleInput || boostInput) && Math.abs(vLong) > 0.5) {
      this.timing = true;
      this.lapTime = 0;
    }
    if (this.timing) {
      this.lapTime += dt;
      this.raceTime += dt;
    }
    this.state.lapTime = this.lapTime;
    this.state.bestLap = this.bestLap;
    this.state.lastLap = this.lastLap;
    this.state.speedKmh = Math.round(Math.abs(vLong) * 3.6);
    this.state.lap = this.lap;
    this.state.nitro = this.nitro;
    this.state.nitroActive = this.nitroActive;
    this.state.armor = this.armor;
    this.state.position = this.racePos;
    this.state.fieldSize = this.fieldSize;
    this.state.lapTotal = this.lapTotal;

    this.updateCamera(dt);
  }

  /** Last lap done: freeze the clock, remember where the car finished and let
      the shell put the results sheet up. The car keeps its position; the
      caller stops stepping the sim. */
  finishRace() {
    this.finished = true;
    this.timing = false;
    this.finalTime = this.raceTime;
    this.finalPosition = this.racePos;
    this.nitroActive = false;
    this.pushMessage('RACE COMPLETE', '#9dffc0');
  }

  triggerPad(pad) {
    pad.cooldown = 2.4;
    const info = PAD_TYPES[pad.type];
    if (pad.type === 'nitro') {
      this.nitro = Math.min(100, this.nitro + 45);
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.velocity.addScaledVector(fwd, 9);
      this.pushMessage(`${info.label}  +45 NITRO`, info.css);
    } else if (pad.type === 'armor') {
      this.armor = Math.min(this.tune.armorMax, this.armor + 35);
      this.pushMessage(`${info.label}  +35 ARMOR`, info.css);
    } else {
      this.combat?.reloadAll();
      this.pushMessage(`${info.label}  //  AMMO RESTOCKED`, info.css);
    }
  }

  /* ---------------------------------------------------------- ai assist */

  /** Corner braking assist. Reads the track spline 35-75 m ahead and, for
      every sample in that window, converts the corner into the deceleration
      needed to reach it at a speed the tyres can hold. Only the most urgent
      sample sets the pedal, so a distant sweeper leaves the car alone and the
      brake comes on late, at the strength the road actually asks for. The
      apex speed itself is unchanged, so tight corners keep their margin.
      Everything is rate-limited so the pedal eases on and off. */
  updateAssist(dt, boosting) {
    const a = this._assist;
    const mode = this.assist.mode;
    // nitro is the player's call: never lift or brake while it is lit. Snap the
    // pedal off rather than fading it, so 'off' and a boost hit really do let
    // the car run.
    if (mode === 'off' || !this.track || boosting) {
      a.brake = 0;
      a.cut = 0;
      a.need = 0;
      a.safeSpeed = 0;
      this.state.assistActive = false;
      return;
    }

    const tr = this.track;
    const N = tr.samples.length;
    const ds = tr.length / N;
    const speed = Math.max(0, this._vLong);
    const far = ASSIST_NEAR + (ASSIST_FAR - ASSIST_NEAR) * Math.min(speed / this.tune.maxSpeed, 1);
    const curb = ASSIST[mode];

    // heading change over an 8-sample (≈26 m) chord = curvature in rad/m.
    // Walk the whole window and keep the sample that asks for the most
    // braking, not just the sharpest one: a hairpin 20 m ahead matters far
    // more than the same hairpin when it is still 70 m away.
    let need = 0;
    let safe = 0;
    for (let d = 10; d <= far + 6; d += 6) {
      const i0 = (this.hintIndex + Math.round(d / ds)) % N;
      const t0 = tr.samples[i0].tan;
      const t1 = tr.samples[(i0 + 8) % N].tan;
      const ang = Math.abs(Math.atan2(t0.x * t1.z - t0.z * t1.x, t0.x * t1.x + t0.z * t1.z));
      const c = ang / (8 * ds);
      // 17 m/s^2 from a 50 m radius corner downwards, easing to `lat` by the
      // time the bend is a 170 m sweeper
      const tight = THREE.MathUtils.clamp((c - 0.006) / 0.014, 0, 1);
      const cornerLoad = curb.lat + (curb.tightLat - curb.lat) * tight;
      const vSafe = Math.sqrt(cornerLoad / Math.max(c, 1e-5));
      const ask = speed > vSafe * 1.02
        ? (speed * speed - vSafe * vSafe) / (2 * Math.max(d, 8))
        : 0;
      if (ask > need) { need = ask; safe = vSafe; }
    }

    // the pedal delivers roughly the deceleration the corner needs, scaled by
    // the car's own braking power. `need` has to clear the mode's trigger
    // first, which is what keeps the assist off the straights and the fast
    // sweepers and makes it bite only where braking is unavoidable.
    const braking = need > curb.need;
    const targetBrake = braking
      ? THREE.MathUtils.clamp((need / BRAKE) * 1.15, 0, curb.maxBrake)
      : 0;
    const targetCut = braking ? Math.min(0.5, targetBrake * 1.8) : 0;

    const kUp = Math.min(1, dt * 7);
    const kDown = Math.min(1, dt * 4.5);
    a.brake += (targetBrake - a.brake) * (targetBrake > a.brake ? kUp : kDown);
    a.cut += (targetCut - a.cut) * (targetCut > a.cut ? kUp : kDown);
    a.need = need;
    a.safeSpeed = safe;
    this.state.assistActive = a.brake > 0.04 || a.cut > 0.05;
  }

  /** Gentle counter-steer when the car is being dragged along a barrier, plus
      a damped rebound (set in the wall block) so it does not oscillate. */
  wallSteer(lateral, out) {
    const hw = this.track.halfWidth;
    const edge = Math.abs(lateral) - (hw - 2.6);
    if (edge <= 0 || out <= 0.4) return 0;
    const gain = this.assist.mode === 'high' ? 0.6 : 0.38;
    const push = Math.min(1, edge / 2.6) * Math.min(1, out / 6) * gain;
    // positive lateral sits in the `right` direction, so steering left (+)
    // brings the car back towards the centreline
    return Math.sign(lateral) * push;
  }

  /* ------------------------------------------------------- drift smoke */

  updateSmoke(dt, drift, speed, slip) {
    const puffs = this.puffs;
    const density = this.smokeDensity;
    const emitting = density > 0.05 && speed > 11 && (drift || Math.abs(slip) > 0.2);

    this.smokeTimer -= dt;
    if (emitting && this.smokeTimer <= 0) {
      this.smokeTimer = 0.035 / density;
      const perFrame = density > 0.5 ? 3 : 2;
      for (let n = 0; n < perFrame; n++) {
        const p = puffs.find((q) => !q.live);
        if (!p) break;
        this.puffSide = -this.puffSide;
        const fwd = _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const right = _right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
        p.live = true;
        p.life = 0;
        p.max = 0.75 + Math.random() * 0.35;
        p.size = 0.28 + Math.random() * 0.12;
        // behind the rear wheels and out past the body sides. The chase lens
        // sits only ~2.4 m above that spot, so the puff has to lift off the
        // road quickly to climb into frame instead of under it
        p.pos.copy(this.position)
          .addScaledVector(right, this.puffSide * 1.25)
          .addScaledVector(fwd, -2.3);
        p.pos.y += 0.45;
        // inherit most of the car's speed, like a real slipstream: a puff
        // anchored in world space is left behind the chase cam in two frames
        p.vel.copy(this.velocity).multiplyScalar(0.97)
          .addScaledVector(right, this.puffSide * (2.6 + Math.random() * 1.4))
          .addScaledVector(fwd, -1.2 - Math.random());
        p.vel.y = 2.9 + Math.random() * 1.3;
      }
    }

    let live = 0;
    for (const p of puffs) {
      if (!p.live) continue;
      p.life += dt;
      if (p.life >= p.max) { p.live = false; continue; }
      const t = p.life / p.max;
      p.pos.addScaledVector(p.vel, dt);
      // barely any drag: the puff rides the car's wake instead of being left
      // behind it, where the bodywork would hide it from the chase lens
      p.vel.multiplyScalar(Math.exp(-0.35 * dt));
      p.vel.y += 0.8 * dt;
      const size = p.size * (1 + t * 3.8);
      // billboard: copy the lens orientation so every puff faces the player
      _puffObj.position.copy(p.pos);
      _puffObj.quaternion.copy(this.camera.quaternion);
      _puffObj.scale.setScalar(size * (1 - t * 0.35));
      _puffObj.updateMatrix();
      this.puffMesh.setMatrixAt(live, _puffObj.matrix);
      live += 1;
    }
    this.puffMesh.count = live;
    this.puffMesh.visible = live > 0;
    if (live > 0) this.puffMesh.instanceMatrix.needsUpdate = true;
  }

  /* ----------------------------------------------------------------- camera */

  /** Garage showcase shot: a slow orbit round the parked car. It deliberately
      swings out over the barrier, so it skips the road/wall clamps the driving
      rigs use, and it drives the same mesh the race does — no second car, no
      extra draw call. */
  updateGarageCamera(dt) {
    const cam = this.camera;
    if (this._camMode !== 'garage') {
      this._camMode = 'garage';
      cam.near = 0.5;
      cam.far = 12000;
      // the sheet always opens on a snap, so the lens can go straight to the
      // showcase fov instead of easing into it over the first second
      cam.fov = GARAGE_FOV;
      this.cockpitRig.visible = false;
      cam.updateProjectionMatrix();
    }
    this.garageAngle += dt * GARAGE_SPIN;
    const a = this.garageAngle;
    const p = this.position;
    _camPos.set(
      p.x + Math.sin(a) * GARAGE_RADIUS,
      p.y + GARAGE_HEIGHT,
      p.z + Math.cos(a) * GARAGE_RADIUS
    );
    // aim just under the roof line: the car sits high in the frame, clear of
    // the garage card along the bottom edge
    _camLook.set(p.x, p.y + 0.55, p.z);
    const k = this.camSnap ? 1 : 1 - Math.exp(-7 * dt);
    cam.position.lerp(_camPos, k);
    _quat.setFromRotationMatrix(_basis.lookAt(cam.position, _camLook, UP));
    cam.quaternion.slerp(_quat, k);
    this.camSnap = false;
  }

  updateCamera(dt) {
    if (this.garage) { this.updateGarageCamera(dt); return; }
    const cam = this.camera;
    const mode = this.mode;
    const clip = CAM_CLIP[mode] || CAM_CLIP.chase;

    if (this._camMode !== mode) {
      this._camMode = mode;
      cam.near = clip[0];
      cam.far = clip[1];
      this.cockpitRig.visible = mode === 'cockpit';
      cam.updateProjectionMatrix();
    }

    const desiredPos = _camPos;
    const look = _camLook;
    const up = this.sampleUp.lengthSq() > 0.5 ? this.sampleUp : UP;
    const fwd = _camFwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const speed = Math.abs(this._vLong);
    const sn = Math.min(speed / this.tune.maxSpeed, 1);

    // smoothed climb rate of the car, used by the chase feed-forward
    const sampleDt = Math.max(dt, 1e-4);
    this._vy += ((this.position.y - this._prevY) / sampleDt - this._vy) * Math.min(1, sampleDt * 10);
    this._prevY = this.position.y;

    // every branch below assigns fov / clearance / wallMargin; chase is the
    // default racing rig, so its damping is the starting value
    let fov;
    let clearance;
    let wallMargin;
    let posRate = 5.6;
    let rotRate = 7.4;
    let lookUp = UP;
    let roll = 0;

    if (mode === 'overview') {
      fov = 54;
      clearance = 0;
      wallMargin = 0;
      posRate = 6;
      const vFov = THREE.MathUtils.degToRad(fov);
      const fitH = this._size.z / (2 * Math.tan(vFov / 2));
      const fitW = this._size.x / (2 * Math.tan(vFov / 2) * Math.max(cam.aspect, 0.5));
      const height = Math.max(fitH, fitW) * 1.34 + 40;
      const visibleW = 2 * height * Math.tan(vFov / 2) * Math.max(cam.aspect, 0.5);
      const shift = cam.aspect > 1.15 ? visibleW * 0.085 : 0;
      desiredPos.set(this._center.x - shift, this._center.y + height, this._center.z + 0.01);
      look.copy(this._center);
      look.x -= shift;
      lookUp = OVERVIEW_UP;
    } else if (mode === 'hood') {
      // past the grille tip: nothing of the car sits between eye and target
      desiredPos.copy(this.position).addScaledVector(fwd, 2.42).addScaledVector(up, 1.06);
      look.copy(this.position).addScaledVector(fwd, 60).addScaledVector(up, -1.4);
      fov = 68 + sn * 8 + (this.state.boosting ? 3 : 0);
      posRate = 14;
      rotRate = 26;
      clearance = 0.5;
      // a low camera may never poke past the barrier line, or it ends up
      // inside the jersey wall looking at unlit backfaces
      wallMargin = -0.25;
    } else if (mode === 'cockpit') {
      // driver eye height, tight follow, pitch under throttle/brake and a
      // little roll through the corners
      // eye just under the roof line (1.33): above it the cabin roof fills the
      // frame, below it the windscreen and hood read like a real cockpit
      desiredPos.copy(this.position).addScaledVector(fwd, 0.1).addScaledVector(up, 1.3);
      const pitch = THREE.MathUtils.clamp(this.accelLong * 0.03, -3, 3);
      look.copy(this.position).addScaledVector(fwd, 46).addScaledVector(up, pitch - 1.2);
      roll = THREE.MathUtils.clamp(this.steerVisual * 0.5 + this.latAccel * 0.004, -0.13, 0.13);
      fov = 72 + sn * 6 + (this.state.boosting ? 3 : 0);
      posRate = 16;
      rotRate = 26;
      clearance = 0.6;
      wallMargin = -0.25;
    } else {
      // full-car chase: high enough that the sight line clears the rear wing
      // (1.49 m) and still low enough that the body fills the lower third.
      // Distance, height and fov are fixed — any speed term here makes the car
      // shrink exactly when the action matters most.
      desiredPos.copy(this.position)
        .addScaledVector(fwd, -4.85)
        .addScaledVector(up, 2.1)
        .addScaledVector(this.sampleRight, -this.steerVisual * 0.9);
      // the lens sits ~0.4 m above the wing at its plane, so the road into the
      // next corner reads over the roof instead of through the spoiler
      look.copy(this.position).addScaledVector(fwd, 9.0).addScaledVector(up, 1.0);
      fov = 64 + (this.state.boosting ? 2 : 0);
      clearance = 1.2;
      wallMargin = 1.5;
    }

    /* ---- ground + wall clamp: never dip under the road or into a barrier ---- */
    if (mode !== 'overview' && this.track) {
      const cn = this.track.nearest(desiredPos, this.hintIndex);
      const base = cn.sample.pos.y;
      if (desiredPos.y < base + clearance) desiredPos.y = base + clearance;
      if (wallMargin > 0) {
        const lat = (desiredPos.x - cn.sample.pos.x) * cn.sample.right.x
                  + (desiredPos.z - cn.sample.pos.z) * cn.sample.right.z;
        const maxLat = this.track.halfWidth + wallMargin;
        if (Math.abs(lat) > maxLat) {
          desiredPos.addScaledVector(cn.sample.right, -Math.sign(lat) * (Math.abs(lat) - maxLat));
        }
      }
    }

    if (roll !== 0) lookUp = _camUp.copy(up).applyAxisAngle(fwd, roll);
    const desiredQuat = _quat.setFromRotationMatrix(_basis.lookAt(desiredPos, look, lookUp));

    const snap = this.camSnap;
    // hood / cockpit cams are bolted to the car: at 250 km/h even a fast lerp
    // trails the nose by a metre or two and puts the bodywork in the lens
    const rigid = mode === 'hood' || mode === 'cockpit';
    const posAlpha = snap || rigid ? 1 : 1 - Math.exp(-posRate * dt);

    // a follower that moves at v trails its target by v*dt*(1-a)/a, so at
    // racing speed the car would shrink a dozen metres into the distance.
    // Feeding that lag forward leaves the damping only steering to absorb, and
    // cancels exactly at any frame rate. Chase only, applied after the clamp
    // (which must measure the camera's own footprint) and after the
    // orientation (the offset is ahead of the look point at top speed, so
    // aiming from it would point the rig back down the road). velocity carries
    // no slope component by design, hence the separate climb rate.
    if (mode === 'chase' && posAlpha < 1) {
      const lag = dt * (1 - posAlpha) / posAlpha;
      desiredPos.addScaledVector(this.velocity, lag);
      desiredPos.y += THREE.MathUtils.clamp(this._vy, -25, 25) * lag;
    }

    cam.position.lerp(desiredPos, posAlpha);
    if (mode !== 'overview' && this.track) {
      // a crest can drop the road faster than the smoothed rig follows
      const floor = this.track.nearest(cam.position, this.hintIndex).sample.pos.y + clearance * 0.8;
      if (cam.position.y < floor) cam.position.y = floor;
    }
    cam.quaternion.slerp(desiredQuat, snap ? 1 : Math.min(1, 1 - Math.exp(-rotRate * dt)));
    cam.fov += (fov - cam.fov) * (snap ? 1 : 1 - Math.exp(-4 * dt));
    cam.updateProjectionMatrix();
    this.camSnap = false;
  }
}
