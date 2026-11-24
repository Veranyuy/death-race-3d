import * as THREE from './vendor/three.module.js';

/* =========================================================================
   DEATH RACE 3D — AI rivals
   Six cars that hold the racing line: they read a precomputed curvature map
   to brake for corners and power out of them, wander between lanes, avoid
   whatever sits directly ahead (rivals *and* the player) and keep their own
   lap distance, which is what makes POS 1/7 a real number.

   The whole field is four InstancedMeshes (body / cabin / wing / wheels),
   so six opponents cost four draw calls.
   ========================================================================= */

export const RIVAL_COLORS = [0xd2401f, 0x2f6fb4, 0x2f9d55, 0xd8b12a, 0x8b5cc0, 0xd9dde0];

// start grid: metres along the lap from the player's line, metres off centre
const GRID = [
  { along: -26, lane: -3.2 },
  { along: -16, lane: 3.2 },
  { along: -7, lane: -3.4 },
  { along: 8, lane: 3.4 },
  { along: 17, lane: -3.2 },
  { along: 27, lane: 3.2 },
];

const WHEELS = [[-0.94, 1.42], [0.94, 1.42], [-0.96, -1.46], [0.96, -1.46]];

const TOP_SPEED = 64;     // m/s on a clear straight (~230 km/h)
const ACCEL = 15;
const BRAKE = 26;

const BODY_GEO = new THREE.BoxGeometry(2.02, 0.6, 4.4);
BODY_GEO.translate(0, 0.72, 0);
const CABIN_GEO = new THREE.BoxGeometry(1.56, 0.5, 1.9);
CABIN_GEO.translate(0, 1.16, -0.15);
const WING_GEO = new THREE.BoxGeometry(2.1, 0.1, 0.55);
WING_GEO.translate(0, 1.46, -2.0);
const WHEEL_GEO = new THREE.CylinderGeometry(0.45, 0.45, 0.34, 10);
WHEEL_GEO.rotateZ(Math.PI / 2);

const _dummy = new THREE.Object3D();
const _col = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

export class Opponents {
  constructor(scene, driver) {
    this.driver = driver;
    this.track = null;
    this.time = 0;
    this.cornerAhead = null;

    this.body = new THREE.InstancedMesh(
      BODY_GEO,
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.38 }),
      GRID.length
    );
    this.cabin = new THREE.InstancedMesh(
      CABIN_GEO,
      new THREE.MeshStandardMaterial({ color: 0x25313a, metalness: 0.2, roughness: 0.16 }),
      GRID.length
    );
    this.wing = new THREE.InstancedMesh(
      WING_GEO,
      new THREE.MeshStandardMaterial({ color: 0x262c31, roughness: 0.55 }),
      GRID.length
    );
    this.wheels = new THREE.InstancedMesh(
      WHEEL_GEO,
      new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.92 }),
      GRID.length * WHEELS.length
    );

    const col = new THREE.Color();
    for (const m of [this.body, this.cabin, this.wing, this.wheels]) {
      m.castShadow = true;
      m.receiveShadow = true;
      // six instances across the whole lap: a shared bounding sphere would
      // cull them all as soon as the first car left the frustum
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.cabin.castShadow = false;
    this.wing.castShadow = false;
    this.wheels.castShadow = false;
    for (let i = 0; i < GRID.length; i++) {
      this.body.setColorAt(i, col.setHex(RIVAL_COLORS[i % RIVAL_COLORS.length]));
      this.wing.setColorAt(i, col.setHex(RIVAL_COLORS[i % RIVAL_COLORS.length]));
    }
    this.body.instanceColor.needsUpdate = true;
    this.wing.instanceColor.needsUpdate = true;

    this.cars = GRID.map((g, i) => ({
      along: g.along,
      lane: g.lane,
      baseLane: g.lane,
      s: 0,
      v: 0,
      yaw: 0,
      x: 0,
      y: 0,
      z: 0,
      phase: i * 1.7,
      skill: 0.965 + (i % 6) * 0.014,   // 0.965 .. 1.035
      flash: 0,      // hit flash timer, seconds
      oiled: 0,      // seconds of lost grip from a slick
    }));
  }

  /** How hard the track bends over the next ~40 m, per sample. */
  buildCornerMap() {
    const t = this.track;
    const N = t.samples.length;
    const ds = t.samples[1].dist - t.samples[0].dist;
    const look = Math.max(4, Math.round(26 / ds));
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = t.samples[i].tan;
      const b = t.samples[(i + look) % N].tan;
      raw[i] = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
    }
    const ahead = Math.max(2, Math.round(40 / ds));
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let k = 0; k <= ahead; k += 4) m = Math.max(m, raw[(i + k) % N]);
      out[i] = m;
    }
    this.cornerAhead = out;
  }

  /** Weapons call this: `slow` is the fraction of speed lost to the hit. */
  hitCar(index, slow = 0.1) {
    const car = this.cars[index];
    if (!car) return;
    car.v *= 1 - slow;
    car.flash = 0.24;
  }

  setTrack(track) {
    this.track = track;
    this.time = 0;
    this.buildCornerMap();
    const N = track.samples.length;
    const startIndex = Math.max(1, Math.round((30 / track.length) * N));
    const startS = (startIndex / N) * track.length;
    for (const car of this.cars) {
      car.s = startS + car.along;
      car.lane = car.baseLane;
      car.v = 0;
    }
    this.update(0);
  }

  update(dt) {
    if (!this.track || !this.cornerAhead) return;
    const t = this.track;
    const N = t.samples.length;
    const length = t.length;
    const maxLane = Math.max(1.6, t.halfWidth - 2.4);

    // player's own race distance + lane, used for avoidance and the ranking
    const pn = t.nearest(this.driver.position, this.driver.hintIndex);
    const playerProg = this.driver.lap - 1 + pn.u;
    const playerLane = pn.lateral;

    this.time += dt;

    const pack = this.cars.map((c) => ({ prog: c.s / length, lane: c.lane }));
    pack.push({ prog: playerProg, lane: playerLane });

    let wi = 0;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const u = ((car.s / length) % 1 + 1) % 1;

      /* ---- braking for the corner ahead, then power back out ---- */
      const idx = Math.min(N - 1, Math.floor(u * N));
      const target = THREE.MathUtils.clamp((TOP_SPEED - this.cornerAhead[idx] * 34) * car.skill, 22, 70);
      if (car.v < target) car.v = Math.min(target, car.v + ACCEL * dt);
      else car.v = Math.max(target, car.v - BRAKE * dt);

      /* ---- lane keeping: drift a little, step around the car ahead ---- */
      let laneTarget = car.baseLane + Math.sin(this.time * 0.35 + car.phase) * 0.5;
      let blockGap = 17;
      for (let j = 0; j < pack.length; j++) {
        if (j === i) continue;
        const other = pack[j];
        let gap = (other.prog - u) * length;
        if (gap < 0) gap += length;
        if (gap < 0.6 || gap > blockGap) continue;
        if (Math.abs(other.lane - car.lane) > 2.6) continue;
        blockGap = gap;
        const away = car.lane >= other.lane ? 1 : -1;
        laneTarget = THREE.MathUtils.clamp(other.lane + away * 3.0, -maxLane, maxLane);
        if (gap < 9) car.v = Math.max(target * 0.86, car.v - 6 * dt);
      }
      if (car.oiled > 0) {
        car.oiled = Math.max(0, car.oiled - dt);
        laneTarget += Math.sin(this.time * 11 + car.phase) * 2.7;
        car.v = Math.min(car.v, 26);
      }
      car.lane += (THREE.MathUtils.clamp(laneTarget, -maxLane, maxLane) - car.lane) * Math.min(1, dt * 1.8);
      car.s += car.v * dt;

      /* ---- place on the racing line ---- */
      const si = (((car.s / length) % 1 + 1) % 1) * N;
      const i0 = Math.floor(si) % N;
      const i1 = (i0 + 1) % N;
      const f = si - Math.floor(si);
      const a = t.samples[i0];
      const b = t.samples[i1];
      const rx = a.right.x + (b.right.x - a.right.x) * f;
      const rz = a.right.z + (b.right.z - a.right.z) * f;
      const tx = a.tan.x + (b.tan.x - a.tan.x) * f;
      const tz = a.tan.z + (b.tan.z - a.tan.z) * f;
      car.x = a.pos.x + (b.pos.x - a.pos.x) * f + rx * car.lane;
      car.y = a.pos.y + (b.pos.y - a.pos.y) * f;
      car.z = a.pos.z + (b.pos.z - a.pos.z) * f + rz * car.lane;
      car.yaw = Math.atan2(tx, tz);

      _dummy.position.set(car.x, car.y, car.z);
      _dummy.rotation.set(0, car.yaw, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.body.setMatrixAt(i, _dummy.matrix);
      this.cabin.setMatrixAt(i, _dummy.matrix);
      this.wing.setMatrixAt(i, _dummy.matrix);

      const cy = Math.cos(car.yaw);
      const sy = Math.sin(car.yaw);
      for (const [ox, oz] of WHEELS) {
        _dummy.position.set(
          car.x + cy * ox + sy * oz,
          car.y + 0.46,
          car.z - sy * ox + cy * oz
        );
        _dummy.updateMatrix();
        this.wheels.setMatrixAt(wi++, _dummy.matrix);
      }
    }

    this.body.instanceMatrix.needsUpdate = true;
    this.cabin.instanceMatrix.needsUpdate = true;
    this.wing.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;

    /* ---- hit flashes: body colour snaps toward white, then fades back ---- */
    let flashDirty = false;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.flash <= 0) continue;
      car.flash = Math.max(0, car.flash - dt);
      const t = Math.min(1, car.flash * 4.2);
      _col.setHex(RIVAL_COLORS[i % RIVAL_COLORS.length]).lerp(WHITE, t);
      this.body.setColorAt(i, _col);
      flashDirty = true;
    }
    if (flashDirty && this.body.instanceColor) this.body.instanceColor.needsUpdate = true;

    /* ---- ranking: everyone who is further round the lap is ahead ---- */
    let ahead = 0;
    for (const car of this.cars) if (car.s / length > playerProg) ahead += 1;
    this.driver.racePos = ahead + 1;
    this.driver.fieldSize = this.cars.length + 1;
    this.driver.state.position = ahead + 1;
    this.driver.state.fieldSize = this.driver.fieldSize;
  }
}
