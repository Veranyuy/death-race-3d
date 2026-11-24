import * as THREE from './vendor/three.module.js';

/* =========================================================================
   DEATH RACE 3D — offensive / defensive weapon state machine

   Four weapon systems share one tiny state machine per frame:

     gun      ammo-backed hitscan bursts, twin muzzle alternation
     missile  homing warheads with a two-stage seek cone
     oil      rear slick + smoke trail, both area-denial pools
     shield   timed energy bubble that eats wall impacts while charged

   Everything is pooled and instanced: the whole arsenal costs six draw
   calls no matter how much lead is in the air, which is what keeps the
   mobile target at 60 FPS.
   ========================================================================= */

const GUN_MAX = 120;
const GUN_RATE = 0.068;        // s between rounds (~880 rpm)
const GUN_RELOAD = 1.9;
const GUN_RANGE = 200;
const TRACER_COUNT = 48;
const TRACER_SPEED = 330;
const TRACER_LIFE = 0.32;

const MISSILE_MAX = 4;
const MISSILE_COUNT = 4;
const MISSILE_SPEED = 150;
const MISSILE_LIFE = 3.4;
const MISSILE_TURN = 1.5;      // rad/s seek authority

const OIL_MAX = 3;
const OIL_COUNT = 9;
const OIL_SLICK_LIFE = 8;
const OIL_DROP_INTERVAL = 0.5;
const SMOKE_COUNT = 28;
const SMOKE_LIFE = 1.7;

const SPARK_COUNT = 20;
const SPARK_LIFE = 0.42;

const SHIELD_MAX = 100;
const SHIELD_DRAIN = 19;       // per second while deployed
const SHIELD_RECHARGE = 7.5;
const SHIELD_LOCKOUT = 3.2;    // forced downtime once the charge runs dry

const TRACER_GEO = new THREE.BoxGeometry(0.1, 0.1, 2.6);
const MISSILE_GEO = new THREE.CylinderGeometry(0.15, 0.15, 1.35, 8);
MISSILE_GEO.rotateX(Math.PI / 2);
const OIL_GEO = new THREE.CircleGeometry(1.05, 14);
OIL_GEO.rotateX(-Math.PI / 2);
const PUFF_GEO = new THREE.CircleGeometry(0.72, 8);

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

const _dummy = new THREE.Object3D();
const _col = new THREE.Color();
const _v = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();

const shieldVertex = /* glsl */`
  varying vec3 vNormalView;
  varying vec3 vPosView;
  void main() {
    vNormalView = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPosView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const shieldFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uStrength;
  varying vec3 vNormalView;
  varying vec3 vPosView;
  void main() {
    vec3 n = normalize(vNormalView);
    vec3 v = normalize(-vPosView);
    float rim = pow(1.0 - abs(dot(n, v)), 2.1);
    // hex-ish scan bands travelling up the bubble
    float bands = 0.5 + 0.5 * sin(vPosView.y * 26.0 - uTime * 5.0);
    float grid = 0.5 + 0.5 * sin(vPosView.x * 18.0 + uTime * 2.0);
    vec3 col = uColor * (rim * 1.55 + 0.06 + bands * grid * 0.18);
    gl_FragColor = vec4(col * uStrength, (rim * 0.8 + 0.07 + bands * 0.05) * uStrength);
  }
`;

export class Combat {
  constructor(scene, driver, opponents) {
    this.driver = driver;
    this.opponents = opponents;
    this.track = null;
    this.time = 0;
    // which pools had instances on screen last frame; an idle pool can skip
    // rewriting its (already hidden) instance matrices every frame
    this._drawn = { tracer: false, missile: false, slick: false, smoke: false, spark: false };

    /* ---- gun ---- */
    this.gunAmmo = GUN_MAX;
    this.gunTimer = 0;
    this.gunReload = 0;
    this.gunSide = 1;
    this.tracers = new Array(TRACER_COUNT).fill(null).map(() => ({
      live: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), life: 0,
    }));
    this.tracerMesh = new THREE.InstancedMesh(
      TRACER_GEO,
      new THREE.MeshBasicMaterial({
        color: 0xffe6a6, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      TRACER_COUNT
    );
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    /* ---- missiles ---- */
    this.missilesLeft = MISSILE_MAX;
    this.missileCooldown = 0;
    this.missiles = new Array(MISSILE_COUNT).fill(null).map(() => ({
      live: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1),
      target: -1, life: 0, defended: false,
    }));
    this.missileMesh = new THREE.InstancedMesh(
      MISSILE_GEO,
      new THREE.MeshBasicMaterial({ color: 0xffb36b }),
      MISSILE_COUNT
    );
    this.missileMesh.frustumCulled = false;
    this.missileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    /* ---- oil + smoke ---- */
    this.oilLeft = OIL_MAX;
    this.oilTimer = 0;
    this.slicks = new Array(OIL_COUNT).fill(null).map(() => ({
      live: false, x: 0, y: 0, z: 0, life: 0, size: 1,
    }));
    this.slickMesh = new THREE.InstancedMesh(
      OIL_GEO,
      new THREE.MeshBasicMaterial({
        color: 0x08090b, transparent: true, opacity: 0.62,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      }),
      OIL_COUNT
    );
    this.slickMesh.frustumCulled = false;
    this.slickMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.smokeTimer = 0;
    this.puffs = new Array(SMOKE_COUNT).fill(null).map(() => ({
      live: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      life: 0, max: SMOKE_LIFE, size: 1, color: new THREE.Color(0.4, 0.42, 0.44),
    }));
    this.smokeMesh = new THREE.InstancedMesh(
      PUFF_GEO,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending, transparent: true,
        depthWrite: false, vertexColors: true,
      }),
      SMOKE_COUNT
    );
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    /* ---- sparks / impact flashes ---- */
    this.sparks = new Array(SPARK_COUNT).fill(null).map(() => ({
      live: false, pos: new THREE.Vector3(), life: 0, size: 1,
      color: new THREE.Color(1, 0.55, 0.2),
    }));
    this.sparkMesh = new THREE.InstancedMesh(
      PUFF_GEO,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending, transparent: true,
        depthWrite: false, vertexColors: true,
      }),
      SPARK_COUNT
    );
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    /* ---- ray shield ---- */
    this.shieldCharge = SHIELD_MAX;
    this.shieldActive = false;
    this.shieldLock = 0;
    this.shieldFlash = 0;
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0x63e8ff) },
          uTime: { value: 0 },
          uStrength: { value: 1 },
        },
        vertexShader: shieldVertex,
        fragmentShader: shieldFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    this.shieldMesh.scale.set(2.35, 1.65, 3.5);
    this.shieldMesh.visible = false;
    this.shieldMesh.frustumCulled = false;
    this.shieldUniforms = this.shieldMesh.material.uniforms;

    for (const mesh of [
      this.tracerMesh, this.missileMesh, this.slickMesh,
      this.smokeMesh, this.sparkMesh, this.shieldMesh,
    ]) {
      scene.add(mesh);
    }
    // instance colours only exist after a setColorAt; allocate once
    for (let i = 0; i < SMOKE_COUNT; i++) this.smokeMesh.setColorAt(i, _col.setRGB(0, 0, 0));
    for (let i = 0; i < SPARK_COUNT; i++) this.sparkMesh.setColorAt(i, _col.setRGB(0, 0, 0));

    this.hud = {
      gunAmmo: GUN_MAX, gunMax: GUN_MAX, gunReload: 0,
      missiles: MISSILE_MAX, missileMax: MISSILE_MAX, missileCool: 0,
      oil: OIL_MAX, oilMax: OIL_MAX,
      shield: SHIELD_MAX, shieldActive: false, shieldLock: 0,
    };

    this._hideAll();
  }

  _hideAll() {
    _dummy.position.set(0, -9999, 0);
    _dummy.quaternion.identity();
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();
    for (const mesh of [this.tracerMesh, this.missileMesh, this.slickMesh, this.smokeMesh, this.sparkMesh]) {
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, _dummy.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const key of Object.keys(this._drawn)) this._drawn[key] = false;
  }

  /* ------------------------------------------------------------- lifecycle */

  setTrack(track) {
    this.track = track;
    this.gunAmmo = GUN_MAX;
    this.gunReload = 0;
    this.gunTimer = 0;
    this.missilesLeft = MISSILE_MAX;
    this.missileCooldown = 0;
    this.oilLeft = OIL_MAX;
    this.oilTimer = 0;
    this.shieldCharge = SHIELD_MAX;
    this.shieldActive = false;
    this.shieldLock = 0;
    this.shieldFlash = 0;
    this.driver.shieldActive = false;
    for (const t of this.tracers) t.live = false;
    for (const m of this.missiles) m.live = false;
    for (const s of this.slicks) s.live = false;
    for (const p of this.puffs) p.live = false;
    this._hideAll();
    this._syncHud();
  }

  /* ---------------------------------------------------------------- output */

  _syncHud() {
    const h = this.hud;
    h.gunAmmo = this.gunAmmo;
    h.gunReload = this.gunReload;
    h.missiles = this.missilesLeft;
    h.missileCool = this.missileCooldown;
    h.oil = this.oilLeft;
    h.shield = this.shieldCharge;
    h.shieldActive = this.shieldActive;
    h.shieldLock = this.shieldLock;
  }

  /** Weapon pads top the whole loadout back up. */
  reloadAll() {
    const gained = this.gunAmmo < GUN_MAX || this.missilesLeft < MISSILE_MAX || this.oilLeft < OIL_MAX;
    this.gunAmmo = GUN_MAX;
    this.gunReload = 0;
    this.missilesLeft = MISSILE_MAX;
    this.missileCooldown = 0;
    this.oilLeft = OIL_MAX;
    this.shieldCharge = Math.min(SHIELD_MAX, this.shieldCharge + 40);
    this.shieldLock = 0;
    if (gained) this.driver.pushMessage('WEAPONS RESTOCKED', '#ff8a24');
  }

  /* ------------------------------------------------------------ gun state */

  fireGun(dt) {
    if (this.gunReload > 0) return;
    if (this.gunAmmo <= 0) {
      this.gunReload = GUN_RELOAD;
      this.driver.pushMessage('GUN RELOADING', '#ffd27a');
      return;
    }
    this.gunTimer -= dt;
    if (this.gunTimer > 0) return;
    this.gunTimer = GUN_RATE;
    this.gunAmmo -= 1;

    const car = this.driver.car;
    this.gunSide *= -1;
    _muzzle.set(this.gunSide * 0.62, 0.98, 2.45);
    car.localToWorld(_muzzle);
    _dir.set(0, 0, 1).transformDirection(car.matrixWorld).normalize();

    const slot = this.tracers.find((t) => !t.live);
    if (slot) {
      slot.live = true;
      slot.life = TRACER_LIFE;
      slot.pos.copy(_muzzle).addScaledVector(_dir, 1.4);
      slot.dir.copy(_dir);
    }

    // hitscan: nearest rival inside a narrow forward cone
    const hit = this._nearestRival(_muzzle, _dir, GUN_RANGE, 0.988);
    if (hit >= 0) {
      const c = this.opponents.cars[hit];
      // the car's WEAPONS stat scales what a round actually takes off
      this.opponents.hitCar(hit, 0.055 * this.driver.tune.weaponMul);
      this._spawnSparks(c.x, c.y + 0.8, c.z, 1.5, 0xfff0c0);
    }
  }

  /* -------------------------------------------------------- missile state */

  fireMissile() {
    if (this.missileCooldown > 0) return false;
    if (this.missilesLeft <= 0) {
      this.driver.pushMessage('MISSILES EMPTY', '#ff8a24');
      return false;
    }
    const slot = this.missiles.find((m) => !m.live);
    if (!slot) return false;

    this.missilesLeft -= 1;
    this.missileCooldown = 0.95;

    const car = this.driver.car;
    _muzzle.set(0, 1.0, 2.1);
    car.localToWorld(_muzzle);
    _dir.set(0, 0, 1).transformDirection(car.matrixWorld).normalize();

    slot.live = true;
    slot.life = MISSILE_LIFE;
    slot.pos.copy(_muzzle);
    slot.dir.copy(_dir);
    slot.target = this._nearestRival(_muzzle, _dir, 170, 0.9);
    slot.defended = false;

    this.driver.flash = 0.22;
    this.driver.pushMessage(
      slot.target >= 0 ? 'MISSILE LOCKED' : 'MISSILE AWAY',
      '#ff8a24'
    );
    return true;
  }

  /* ------------------------------------------------------------ oil state */

  dropOil(dt) {
    if (this.oilTimer > 0) this.oilTimer -= dt;
    if (this.oilLeft <= 0 || this.oilTimer > 0) return;

    const slot = this.slicks.find((s) => !s.live);
    if (!slot) return;

    this.oilTimer = OIL_DROP_INTERVAL;
    this.oilLeft -= 1;

    const car = this.driver.car;
    _v.set(0, 0.06, -2.6);
    car.localToWorld(_v);

    slot.live = true;
    slot.life = OIL_SLICK_LIFE;
    slot.x = _v.x;
    slot.y = _v.y;
    slot.z = _v.z;
    slot.size = 1.35 + Math.random() * 0.35;
    this.driver.pushMessage('OIL SLICK DEPLOYED', '#8fe8ff');
  }

  /* ----------------------------------------------------------- shield state */

  toggleShield() {
    if (this.shieldActive) {
      this.shieldActive = false;
      this.driver.shieldActive = false;
      this.driver.pushMessage('SHIELD DOWN', '#8fe8ff');
      return false;
    }
    if (this.shieldLock > 0 || this.shieldCharge < 12) {
      this.driver.pushMessage('SHIELD RECHARGING', '#ffd27a');
      return false;
    }
    this.shieldActive = true;
    this.shieldFlash = 0.4;
    this.driver.shieldActive = true;
    this.driver.pushMessage('RAY SHIELD UP', '#63e8ff');
    return true;
  }

  /* ------------------------------------------------------------------ pools */

  _spawnSparks(x, y, z, size = 1, color = 0xffb060) {
    for (let i = 0; i < 4; i++) {
      const s = this.sparks.find((p) => !p.live);
      if (!s) return;
      s.live = true;
      s.life = SPARK_LIFE * (0.7 + Math.random() * 0.6);
      s.pos.set(x, y, z);
      s.size = size * (0.5 + Math.random() * 0.7);
      s.color.setHex(color);
    }
  }

  /** Public spark burst for hits that do not come from the player's guns —
      rival cannon rounds landing on the player or on another rival. */
  impact(x, y, z, size = 1.4, color = 0xffa040) {
    this._spawnSparks(x, y, z, size, color);
  }

  _spawnPuff(pos, size, color, rise = 0.6) {
    const p = this.puffs.find((q) => !q.live);
    if (!p) return;
    p.live = true;
    p.life = SMOKE_LIFE;
    p.max = SMOKE_LIFE;
    p.pos.copy(pos);
    p.vel.set(
      (Math.random() - 0.5) * 0.9,
      rise * (0.5 + Math.random()),
      (Math.random() - 0.5) * 0.9
    );
    p.size = size * (0.75 + Math.random() * 0.5);
    p.color.setHex(color);
  }

  /** Nearest rival inside a forward cone; -1 when the lane ahead is clear. */
  _nearestRival(origin, dir, range, minDot) {
    let best = -1;
    let bestAlong = range;
    for (let i = 0; i < this.opponents.cars.length; i++) {
      const c = this.opponents.cars[i];
      const dx = c.x - origin.x;
      const dy = c.y + 0.85 - origin.y;
      const dz = c.z - origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 1 || dist > bestAlong) continue;
      if ((dx * dir.x + dy * dir.y + dz * dir.z) / dist < minDot) continue;
      best = i;
      bestAlong = dist;
    }
    return best;
  }

  /* ----------------------------------------------------------------- update */

  update(dt) {
    if (!this.track) return;
    this.time += dt;
    this.driver.car.updateWorldMatrix(true, false);

    this._updateGun(dt);
    this._updateMissiles(dt);
    this._updateOil(dt);
    this._updatePools(dt);
    this._updateShield(dt);
    this._syncHud();
  }

  _updateGun(dt) {
    if (this.gunReload > 0) {
      this.gunReload = Math.max(0, this.gunReload - dt);
      if (this.gunReload === 0) this.gunAmmo = GUN_MAX;
    }
    if (this.missileCooldown > 0) this.missileCooldown = Math.max(0, this.missileCooldown - dt);

    const wants = this.driver.keys.gun === true || this.driver.input.gun === true;
    if (wants) this.fireGun(dt);
    else this.gunTimer = Math.min(this.gunTimer, 0);

    let shown = 0;
    for (const t of this.tracers) {
      if (!t.live) continue;
      t.life -= dt;
      if (t.life <= 0) { t.live = false; continue; }
      t.pos.addScaledVector(t.dir, TRACER_SPEED * dt);
      _dummy.position.copy(t.pos);
      _dummy.quaternion.identity();
      _dummy.lookAt(t.pos.x + t.dir.x, t.pos.y + t.dir.y, t.pos.z + t.dir.z);
      const w = Math.min(1, t.life / TRACER_LIFE * 2.4);
      _dummy.scale.set(w, w, 1 + w * 0.6);
      _dummy.updateMatrix();
      this.tracerMesh.setMatrixAt(shown++, _dummy.matrix);
    }
    if (shown > 0 || this._drawn.tracer) {
      for (let i = shown; i < TRACER_COUNT; i++) this.tracerMesh.setMatrixAt(i, ZERO_MATRIX);
      this.tracerMesh.instanceMatrix.needsUpdate = true;
      this._drawn.tracer = shown > 0;
    }
  }

  _updateMissiles(dt) {
    let shown = 0;
    for (const m of this.missiles) {
      if (!m.live) continue;
      m.life -= dt;
      if (m.life <= 0) { m.live = false; continue; }

      // one attempt per warhead: a defensive rival may break the lock before
      // the seeker settles, and it gets that roll once, not every frame
      if (m.target >= 0 && !m.defended) {
        m.defended = true;
        if (this.opponents.defendMissile(m.target)) {
          this._spawnSparks(m.pos.x, m.pos.y, m.pos.z, 1.8, 0x8fe8ff);
          m.live = false;
          continue;
        }
      }

      // terminal homing: keep tracking while the target stays ahead
      if (m.target >= 0) {
        const c = this.opponents.cars[m.target];
        _v.set(c.x - m.pos.x, c.y + 0.9 - m.pos.y, c.z - m.pos.z);
        const want = Math.atan2(_v.x, _v.z);
        const have = Math.atan2(m.dir.x, m.dir.z);
        let diff = ((want - have + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const step = THREE.MathUtils.clamp(diff, -MISSILE_TURN * dt, MISSILE_TURN * dt);
        const yaw = have + step;
        const pitch = THREE.MathUtils.clamp(-Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.35, 0.35);
        m.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        if (_v.lengthSq() < 5 * 5) {
          this._spawnSparks(c.x, c.y + 0.9, c.z, 2.6, 0xffa040);
          this.opponents.hitCar(m.target, 0.26 * this.driver.tune.weaponMul);
          m.live = false;
          continue;
        }
      }

      m.pos.addScaledVector(m.dir, MISSILE_SPEED * dt);
      if (Math.random() < 0.85) {
        this._spawnPuff(m.pos, 0.55, 0xff9040, 0.2);
      }

      _dummy.position.copy(m.pos);
      _dummy.quaternion.identity();
      _dummy.lookAt(m.pos.x + m.dir.x, m.pos.y + m.dir.y, m.pos.z + m.dir.z);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.missileMesh.setMatrixAt(shown++, _dummy.matrix);
    }
    if (shown > 0 || this._drawn.missile) {
      for (let i = shown; i < MISSILE_COUNT; i++) this.missileMesh.setMatrixAt(i, ZERO_MATRIX);
      this.missileMesh.instanceMatrix.needsUpdate = true;
      this._drawn.missile = shown > 0;
    }
  }

  _updateOil(dt) {
    const wants = this.driver.keys.oil === true || this.driver.input.oil === true;
    if (wants) {
      this.dropOil(dt);
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.045;
        _v.set((Math.random() - 0.5) * 1.6, 0.55, -2.4 - Math.random() * 0.6);
        this.driver.car.localToWorld(_v);
        this._spawnPuff(_v, 1.05, 0x6a6f74, 0.9);
      }
    } else {
      this.smokeTimer = 0;
    }

    let shown = 0;
    for (const s of this.slicks) {
      if (!s.live) continue;
      s.life -= dt;
      if (s.life <= 0) { s.live = false; continue; }
      // rivals that drive through lose grip and slow down
      for (let i = 0; i < this.opponents.cars.length; i++) {
        const c = this.opponents.cars[i];
        const dx = c.x - s.x;
        const dz = c.z - s.z;
        if (dx * dx + dz * dz < 3.4 * 3.4) c.oiled = Math.max(c.oiled, 1.3);
      }
      _dummy.position.set(s.x, s.y + 0.02, s.z);
      _dummy.quaternion.identity();
      const fade = Math.min(1, s.life / 1.2);
      _dummy.scale.set(s.size * fade, 1, s.size * 1.35 * fade);
      _dummy.updateMatrix();
      this.slickMesh.setMatrixAt(shown++, _dummy.matrix);
    }
    if (shown > 0 || this._drawn.slick) {
      for (let i = shown; i < OIL_COUNT; i++) this.slickMesh.setMatrixAt(i, ZERO_MATRIX);
      this.slickMesh.instanceMatrix.needsUpdate = true;
      this._drawn.slick = shown > 0;
    }
  }

  _updatePools(dt) {
    const camQuat = this.driver.camera.quaternion;
    let smoke = 0;
    for (const p of this.puffs) {
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) { p.live = false; continue; }
      p.pos.addScaledVector(p.vel, dt);
      const t = 1 - p.life / p.max;
      _dummy.position.copy(p.pos);
      _dummy.quaternion.copy(camQuat);
      const grow = p.size * (1.1 + t * 2.2);
      _dummy.scale.set(grow, grow, 1);
      _dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(smoke, _dummy.matrix);
      const a = (1 - t) * (1 - t);
      this.smokeMesh.setColorAt(smoke, _col.copy(p.color).multiplyScalar(a));
      smoke++;
    }
    if (smoke > 0 || this._drawn.smoke) {
      for (let i = smoke; i < SMOKE_COUNT; i++) this.smokeMesh.setMatrixAt(i, ZERO_MATRIX);
      this.smokeMesh.instanceMatrix.needsUpdate = true;
      if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
      this._drawn.smoke = smoke > 0;
    }

    let sparks = 0;
    for (const s of this.sparks) {
      if (!s.live) continue;
      s.life -= dt;
      if (s.life <= 0) { s.live = false; continue; }
      const t = 1 - s.life / SPARK_LIFE;
      _dummy.position.copy(s.pos);
      _dummy.quaternion.copy(camQuat);
      const grow = s.size * (1.4 + t * 2.4);
      _dummy.scale.set(grow, grow, 1);
      _dummy.updateMatrix();
      this.sparkMesh.setMatrixAt(sparks, _dummy.matrix);
      this.sparkMesh.setColorAt(sparks, _col.copy(s.color).multiplyScalar(1 - t));
      sparks++;
    }
    if (sparks > 0 || this._drawn.spark) {
      for (let i = sparks; i < SPARK_COUNT; i++) this.sparkMesh.setMatrixAt(i, ZERO_MATRIX);
      this.sparkMesh.instanceMatrix.needsUpdate = true;
      if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
      this._drawn.spark = sparks > 0;
    }
  }

  _updateShield(dt) {
    if (this.shieldActive) {
      this.shieldCharge -= SHIELD_DRAIN * dt;
      if (this.shieldCharge <= 0) {
        this.shieldCharge = 0;
        this.shieldActive = false;
        this.shieldLock = SHIELD_LOCKOUT;
        this.driver.shieldActive = false;
        this.driver.pushMessage('SHIELD COLLAPSED', '#ff5a3c');
      }
    } else {
      if (this.shieldLock > 0) this.shieldLock = Math.max(0, this.shieldLock - dt);
      else this.shieldCharge = Math.min(SHIELD_MAX, this.shieldCharge + SHIELD_RECHARGE * dt);
    }

    if (this.shieldFlash > 0) this.shieldFlash = Math.max(0, this.shieldFlash - dt);

    const visible = this.shieldActive || this.shieldFlash > 0;
    this.shieldMesh.visible = visible;
    if (!visible) return;

    const car = this.driver.car;
    this.shieldMesh.position.copy(car.position);
    this.shieldMesh.position.y += 0.9;
    this.shieldMesh.quaternion.copy(car.quaternion);
    this.shieldUniforms.uTime.value = this.time;
    const pulse = 0.82 + Math.sin(this.time * 7.5) * 0.12 + (this.shieldFlash > 0 ? 0.5 : 0);
    const health = this.shieldActive ? THREE.MathUtils.clamp(this.shieldCharge / 30, 0.45, 1) : 1;
    this.shieldUniforms.uStrength.value = pulse * health;
  }
}
