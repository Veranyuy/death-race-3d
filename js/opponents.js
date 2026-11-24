import * as THREE from './vendor/three.module.js';

/* =========================================================================
   DEATH RACE 3D — AI rivals
   Six cars that hold the racing line: they read a precomputed curvature map
   to brake for corners and power out of them, wander between lanes, avoid
   whatever sits directly ahead (rivals *and* the player) and keep their own
   lap distance, which is what makes POS 1/7 a real number.

   Each seat also carries a role. Pace, how much of that pace a corner is
   allowed to eat, how hard the car launches, whether it shoots, and how it
   reacts to being shot at all come from that table, so the field behaves like
   a pack of different machines instead of six copies of one.

   The whole field is four InstancedMeshes (body / cabin / wing / wheels) plus
   one for cannon rounds, so six opponents cost five draw calls.
   ========================================================================= */

export const RIVAL_COLORS = [0xd2401f, 0x2f6fb4, 0x2f9d55, 0xd8b12a, 0x8b5cc0, 0xd9dde0];

/* The jobs, in one place. `pace` scales the corner-map target speed, `corner`
   is how many m/s the car gives up per rad of curvature ahead (a big number is
   a cautious car), `accel`/`brake` are its own engine and anchors, `range` is
   how far its cannon reaches and `defend` the chance it breaks a missile lock.
   `hunt` makes a car settle onto the player's pace to stay in the fight
   instead of simply driving away from it. */
const ROLES = {
  // clean pace, no weapons: the one that disappears up the road if it is ever
  // handed a clear line
  sprinter: {
    pace: 1.08, accel: 20, brake: 24, corner: 27,
    wander: 0.3, blockGap: 22, laneRate: 2.4,
    hunt: 0, fire: 0, aim: 0, range: 0, dmg: 0,
    defend: 0, tough: 0, dodge: 0.3,
  },
  // front-runner that fights: pace close to the sprinter's, but it carries a
  // cannon, breaks locks aimed at it, and breaks line when it is being shot at
  predator: {
    pace: 1.04, accel: 18, brake: 28, corner: 31,
    wander: 0.45, blockGap: 19, laneRate: 2.2,
    hunt: 0.3, fire: 0.9, aim: 0.5, range: 95, dmg: 0.8,
    defend: 0.55, tough: 0.2, dodge: 1,
  },
  // armoured hunter: slow to arrive, hard to slow down, and it stalks the
  // nearest thing in front with a cannon rather than racing away
  heavy: {
    pace: 0.93, accel: 12, brake: 20, corner: 42,
    wander: 0.8, blockGap: 13, laneRate: 1.25,
    hunt: 1, fire: 1.2, aim: 0.75, range: 130, dmg: 1.4,
    defend: 0.3, tough: 0.6, dodge: 0.3,
  },
  // mid-pack: balanced pace, the odd shot, holds station in the train
  grinder: {
    pace: 0.99, accel: 16, brake: 26, corner: 35,
    wander: 0.55, blockGap: 17, laneRate: 1.8,
    hunt: 0.2, fire: 2.4, aim: 0.45, range: 110, dmg: 1,
    defend: 0.18, tough: 0.15, dodge: 0.5,
  },
};

/* Difficulty scales the rivals only, on top of their role table, so the
   archetypes keep their character at every setting: a JUGGERNAUT is still the
   slow armoured one on DEATH RACE, it just hits sooner and hurts more. PRO is
   all 1.0, which is the field the roles were tuned against.

   It never touches the player and never reads a car's `tune`: the player's
   handling comes from js/cars.js, and a rival's pace comes from its role
   (times this). One knob per actor, so nothing is scaled twice. */
export const DIFFICULTIES = [
  { id: 'rookie', name: 'ROOKIE', pace: 0.93, accel: 0.9, aggression: 0.7, aim: -0.1, damage: 0.7, defend: 0.7 },
  { id: 'pro', name: 'PRO', pace: 1, accel: 1, aggression: 1, aim: 0, damage: 1, defend: 1 },
  { id: 'deathrace', name: 'DEATH RACE', pace: 1.05, accel: 1.08, aggression: 1.4, aim: 0.12, damage: 1.25, defend: 1.2 },
];
export const DEFAULT_DIFFICULTY = 1;

/* The grid, back to front. `along` is metres behind the player's nose — every
   seat is behind it, so nobody gets a free head start down to turn one — and
   `lane` is metres off the centreline. The fast cars sit deepest: they have to
   come through the field, which is what makes the first lap a race. */
const SEATS = [
  { role: 'sprinter', label: 'K9', along: -6, lane: 3.0 },
  { role: 'predator', label: 'FRANKEN', along: -6, lane: -3.0 },
  { role: 'grinder', label: 'GRINDER', along: -14, lane: 3.1 },
  { role: 'heavy', label: 'JUGGERNAUT', along: -14, lane: -3.1 },
  { role: 'grinder', label: 'RAZORBACK', along: -22, lane: -3.0 },
  { role: 'heavy', label: 'WARLORD', along: -22, lane: 3.0 },
];

const WHEELS = [[-0.94, 1.42], [0.94, 1.42], [-0.96, -1.46], [0.96, -1.46]];

const TOP_SPEED = 64;     // m/s on a clear straight (~230 km/h)
const BOLT_SPEED = 300;   // m/s, the visual speed of a rival cannon round
const BOLT_COUNT = 24;

const BODY_GEO = new THREE.BoxGeometry(2.02, 0.6, 4.4);
BODY_GEO.translate(0, 0.72, 0);
const CABIN_GEO = new THREE.BoxGeometry(1.56, 0.5, 1.9);
CABIN_GEO.translate(0, 1.16, -0.15);
const WING_GEO = new THREE.BoxGeometry(2.1, 0.1, 0.55);
WING_GEO.translate(0, 1.46, -2.0);
const WHEEL_GEO = new THREE.CylinderGeometry(0.45, 0.45, 0.34, 10);
WHEEL_GEO.rotateZ(Math.PI / 2);
const BOLT_GEO = new THREE.BoxGeometry(0.12, 0.12, 2.2);

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const _dummy = new THREE.Object3D();
const _col = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

export class Opponents {
  constructor(scene, driver) {
    this.driver = driver;
    this.track = null;
    this.time = 0;
    this.cornerAhead = null;
    // set by the garage: how hard the field is allowed to race
    this.diff = DIFFICULTIES[DEFAULT_DIFFICULTY];

    this.body = new THREE.InstancedMesh(
      BODY_GEO,
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.38 }),
      SEATS.length
    );
    this.cabin = new THREE.InstancedMesh(
      CABIN_GEO,
      new THREE.MeshStandardMaterial({ color: 0x25313a, metalness: 0.2, roughness: 0.16 }),
      SEATS.length
    );
    this.wing = new THREE.InstancedMesh(
      WING_GEO,
      new THREE.MeshStandardMaterial({ color: 0x262c31, roughness: 0.55 }),
      SEATS.length
    );
    this.wheels = new THREE.InstancedMesh(
      WHEEL_GEO,
      new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.92 }),
      SEATS.length * WHEELS.length
    );
    this.tracerMesh = new THREE.InstancedMesh(
      BOLT_GEO,
      new THREE.MeshBasicMaterial({
        color: 0xffc07a, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      BOLT_COUNT
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
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.tracerMesh);
    this._tracerDrawn = false;
    this._hideTracers();

    this.cabin.castShadow = false;
    this.wing.castShadow = false;
    this.wheels.castShadow = false;
    for (let i = 0; i < SEATS.length; i++) {
      this.body.setColorAt(i, col.setHex(RIVAL_COLORS[i % RIVAL_COLORS.length]));
      this.wing.setColorAt(i, col.setHex(RIVAL_COLORS[i % RIVAL_COLORS.length]));
    }
    this.body.instanceColor.needsUpdate = true;
    this.wing.instanceColor.needsUpdate = true;

    this.tracers = new Array(BOLT_COUNT).fill(null).map(() => ({
      live: false, life: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1,
    }));

    this.cars = SEATS.map((seat, i) => {
      const role = ROLES[seat.role];
      return {
        label: seat.label,
        def: null,
        role,
        along: seat.along,
        lane: seat.lane,
        baseLane: seat.lane,
        s: 0,
        v: 0,
        yaw: 0,
        x: 0,
        y: 0,
        z: 0,
        phase: i * 1.7,
        fireTimer: 0,
        jam: 0,        // lock-break cooldown, seconds
        dodgeT: 0,     // seconds left of an evasive line break
        flash: 0,      // hit flash timer, seconds
        oiled: 0,      // seconds of lost grip from a slick
      };
    });
    this._primeFire();
  }

  /** Staggered first shot for every armed seat at the current difficulty.
      The only place the trigger cadence is computed, so the roster, the
      difficulty and the grid can never prime the same car differently. */
  _primeFire() {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      car.fireTimer = car.role.fire
        ? (car.role.fire / this.diff.aggression) * (0.5 + i * 0.12)
        : 0;
    }
  }

  _hideTracers() {
    for (let i = 0; i < BOLT_COUNT; i++) this.tracerMesh.setMatrixAt(i, ZERO);
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    this._tracerDrawn = false;
  }

  /** Fills the six rival seats from the garage roster: whatever the player did
      not take. Colour, badge and AI role all come from the manifest entry, so
      the pack in the mirror is the pack on the board. */
  setRoster(list) {
    if (!list || !list.length) return;
    for (let i = 0; i < this.cars.length; i++) {
      const def = list[i % list.length];
      const car = this.cars[i];
      car.def = def;
      car.label = def.name;
      car.role = ROLES[def.role] || ROLES.grinder;
      this.body.setColorAt(i, _col.setHex(def.paint.body));
      this.wing.setColorAt(i, _col.setHex(def.paint.accent));
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.wing.instanceColor) this.wing.instanceColor.needsUpdate = true;
    this._primeFire();
  }

  /** ROOKIE / PRO / DEATH RACE, applied live: the next corner already uses it. */
  setDifficulty(diff) {
    this.diff = diff || DIFFICULTIES[DEFAULT_DIFFICULTY];
    this._primeFire();
    return this.diff;
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

  /** Weapons call this: `slow` is the fraction of speed lost to the hit.
      Armour plating soaks part of it, so the heavies are not slowed out of the
      fight by the same burst that wrecks a sprinter. */
  hitCar(index, slow = 0.1) {
    const car = this.cars[index];
    if (!car) return;
    car.v *= 1 - slow * (1 - car.role.tough);
    car.flash = 0.24;
  }

  /** Called once per warhead by combat.js when it acquires its target: a car
      with a defensive role may break the lock before the seeker settles. */
  defendMissile(index) {
    const car = this.cars[index];
    if (!car || !car.role.defend || car.jam > 0) return false;
    if (Math.random() > car.role.defend * this.diff.defend) return false;
    car.jam = 2.8;
    return true;
  }

  setTrack(track) {
    this.track = track;
    this.time = 0;
    this.buildCornerMap();
    const N = track.samples.length;
    const startIndex = Math.max(1, Math.round((30 / track.length) * N));
    const startS = (startIndex / N) * track.length;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      car.s = startS + car.along;
      car.lane = car.baseLane;
      car.v = 0;
      car.flash = 0;
      car.oiled = 0;
      car.jam = 0;
      car.dodgeT = 0;
    }
    this._primeFire();
    for (const b of this.tracers) b.live = false;
    this._hideTracers();
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
    const playerSpeed = Math.abs(this.driver._vLong);
    const gunHeld = this.driver.keys.gun === true || this.driver.input.gun === true;

    this.time += dt;

    const pack = this.cars.map((c) => ({ prog: c.s / length, lane: c.lane }));
    pack.push({ prog: playerProg, lane: playerLane });

    const df = this.diff;
    let wi = 0;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const role = car.role;
      const u = ((car.s / length) % 1 + 1) % 1;

      // how far up the road the player is from this car, wrapped to the lap
      let playerGap = (playerProg - u) * length;
      if (playerGap > length / 2) playerGap -= length;
      else if (playerGap < -length / 2) playerGap += length;

      /* ---- pace: the corner map sets the ceiling, the role scales it ---- */
      const idx = Math.min(N - 1, Math.floor(u * N));
      let target = THREE.MathUtils.clamp(
        (TOP_SPEED - this.cornerAhead[idx] * role.corner) * role.pace * df.pace, 22, 74
      );
      // a hunter with its quarry in range settles onto its pace instead of
      // driving away from it: it would rather stay in the fight
      if (role.hunt > 0 && Math.abs(playerGap) < 45 && playerSpeed > 8) {
        target = Math.max(22, Math.min(target, playerSpeed * (1 + 0.05 * role.hunt)));
      }
      if (car.v < target) car.v = Math.min(target, car.v + role.accel * df.accel * dt);
      else car.v = Math.max(target, car.v - role.brake * dt);

      /* ---- lane keeping: hold a line, step around the car ahead ---- */
      let laneTarget = car.baseLane + Math.sin(this.time * 0.35 + car.phase) * role.wander;
      let blockGap = role.blockGap;
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

      /* ---- hunting: line up on the player's wake to bring the cannon to
         bear instead of drifting back onto open road ---- */
      if (role.hunt > 0 && Math.abs(playerGap) < 55) {
        laneTarget += (playerLane - laneTarget) * 0.55 * role.hunt;
      }

      /* ---- gun reaction: a defensive car breaks its line when the player is
         behind it and firing, so the burst walks off its flank ---- */
      if (gunHeld && role.dodge > 0 && playerGap > 4 && playerGap < 90
        && Math.abs(playerLane - car.lane) < 4) {
        car.dodgeT = 0.5;
      }
      if (car.dodgeT > 0) {
        car.dodgeT = Math.max(0, car.dodgeT - dt);
        laneTarget += (car.lane >= playerLane ? 1 : -1) * 2.8 * role.dodge;
      }

      if (car.oiled > 0) {
        car.oiled = Math.max(0, car.oiled - dt);
        laneTarget += Math.sin(this.time * 11 + car.phase) * 2.7;
        car.v = Math.min(car.v, 26);
      }
      car.lane += (THREE.MathUtils.clamp(laneTarget, -maxLane, maxLane) - car.lane)
        * Math.min(1, dt * role.laneRate);
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

    this._stepWeapons(dt, playerProg, playerLane, length);

    /* ---- hit flashes: body colour snaps toward white, then fades back ---- */
    let flashDirty = false;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.flash <= 0) continue;
      car.flash = Math.max(0, car.flash - dt);
      const t = Math.min(1, car.flash * 4.2);
      _col.setHex(car.def ? car.def.paint.body : RIVAL_COLORS[i % RIVAL_COLORS.length]).lerp(WHITE, t);
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

  /** Rival cannon: every armed seat shoots the nearest thing directly in front
      of it, rival or player. Damage lands when the shot is taken and the bolt
      is a tracer, which keeps six shooters at one instanced draw call. */
  _stepWeapons(dt, playerProg, playerLane, length) {
    const combat = this.driver.combat;
    const df = this.diff;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const role = car.role;
      if (car.jam > 0) car.jam = Math.max(0, car.jam - dt);
      if (!role.fire) continue;
      car.fireTimer -= dt;
      if (car.fireTimer > 0) continue;

      let best = role.range;
      let tx = 0;
      let ty = 0;
      let tz = 0;
      let victim = -1;

      for (let j = 0; j < this.cars.length; j++) {
        if (j === i) continue;
        const other = this.cars[j];
        const gap = other.s - car.s;
        if (gap < 3 || gap > best) continue;
        if (Math.abs(other.lane - car.lane) > 3.2) continue;
        best = gap;
        victim = j;
        tx = other.x;
        ty = other.y + 0.9;
        tz = other.z;
      }

      // the player, measured in the same lap-distance space
      const pgap = playerProg * length - car.s;
      if (pgap > 3 && pgap < best && Math.abs(playerLane - car.lane) < 3.4) {
        victim = -2;
        tx = this.driver.position.x;
        ty = this.driver.position.y + 0.9;
        tz = this.driver.position.z;
      }
      if (victim === -1) continue;

      car.fireTimer = (role.fire / df.aggression) * (0.8 + Math.random() * 0.45);
      const hit = Math.random() < Math.min(0.95, role.aim + df.aim);
      // a miss still throws a round past the target, so incoming fire is
      // always visible before it starts connecting
      const ax = hit ? tx : tx + (Math.random() - 0.5) * 6;
      const ay = hit ? ty : ty + (Math.random() - 0.5) * 1.8;
      const az = hit ? tz : tz + (Math.random() - 0.5) * 6;

      const sx = car.x;
      const sy = car.y + 0.95;
      const sz = car.z;
      const dx = ax - sx;
      const dy = ay - sy;
      const dz = az - sz;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const bolt = this.tracers.find((b) => !b.live);
      if (bolt) {
        bolt.live = true;
        bolt.life = Math.min(0.3, dist / BOLT_SPEED + 0.04);
        bolt.x = sx;
        bolt.y = sy;
        bolt.z = sz;
        bolt.dx = dx / dist;
        bolt.dy = dy / dist;
        bolt.dz = dz / dist;
      }
      if (!hit) continue;

      if (victim === -2) {
        this.driver.armor = Math.max(0, this.driver.armor - role.dmg * df.damage);
        combat?.impact(tx, ty, tz, 1.1, 0xffd0a0);
      } else {
        this.hitCar(victim, 0.05);
        combat?.impact(tx, ty, tz, 1.3, 0xffa040);
      }
    }

    /* ---- bolt tracers ---- */
    let shown = 0;
    for (const b of this.tracers) {
      if (!b.live) continue;
      b.life -= dt;
      if (b.life <= 0) { b.live = false; continue; }
      b.x += b.dx * BOLT_SPEED * dt;
      b.y += b.dy * BOLT_SPEED * dt;
      b.z += b.dz * BOLT_SPEED * dt;
      _dummy.position.set(b.x, b.y, b.z);
      _dummy.quaternion.identity();
      _dummy.lookAt(b.x + b.dx, b.y + b.dy, b.z + b.dz);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.tracerMesh.setMatrixAt(shown++, _dummy.matrix);
    }
    if (shown > 0 || this._tracerDrawn) {
      for (let i = shown; i < BOLT_COUNT; i++) this.tracerMesh.setMatrixAt(i, ZERO);
      this.tracerMesh.instanceMatrix.needsUpdate = true;
      this._tracerDrawn = shown > 0;
    }
  }
}
