/* =========================================================================
   DEATH RACE 3D — vehicle manifest

   One entry per machine, and the only place a car is described. The Garage
   reads `name` / `badge` / `blurb` / `stats`, the player car reads `paint` and
   `tune`, and the rival seats read `role`, `name` and `paint` — so a car can
   never show one set of numbers and drive another.

   `tune` values are multipliers on the hand-tuned constants in
   js/driveTest.js (MAX_SPEED, ACCEL, LAT_ACCEL, GRIP_*). The VECTOR is all
   1.00 on purpose: it is the reference car the physics baseline was recorded
   with, so its handling is exactly what the harness measures.

   `tune` is the PLAYER's car only. A rival never reads it: its pace comes
   from its `role` table in js/opponents.js scaled by the difficulty, so no
   car is ever scaled by both a garage stat and a difficulty multiplier.

   `model` is the plug-in point for custom art: a .glb path (relative to the
   page) and js/modelLoader.js mounts it, measuring and normalising it to the
   same footprint the procedural chassis uses. Leave it null and the box
   chassis is used instead, so a missing or broken file still races.

   `modelFlip` turns the body a half turn about its up axis. The loader can
   measure where the long axis is, but not which end of it is the nose, so a
   model exported tail-first is marked here instead of being re-exported. The
   turn is baked into the shared template, so the player's car, every rival
   body and the hardpoint gun (which is placed in car space) all agree on
   which way forward is.

   `weapon` is the gun bolted to that body: a .glb in assets/models/weapons,
   its length in metres (the file is normalised to one unit, so this is the
   whole scale) and the hardpoint it sits on in car space — `z` is metres
   forward of the body centre, `x` metres sideways. The loader measures the
   roof under that point and seats the gun on it, so a low prototype and a
   coupe both get a mount that touches the body instead of floating over it.

   HARD RULES: a vehicle .glb is 3 MB or smaller, a weapon .glb 1 MB or
   smaller. js/modelLoader.js checks each download before decoding anything
   and rejects a larger file, which leaves that seat on its procedural body (or
   that hardpoint empty) — so a heavy export cannot be added here by accident.
   Reduce the art (lighter export, Draco/meshopt, fewer textures) until it is
   under the limit, then point `model` / `weapon.model` at it.
   ========================================================================= */

/** What each archetype is called on the badge. */
const ROLE_LABEL = {
  sprinter: 'SPRINTER',
  predator: 'FAST COMBAT',
  heavy: 'ARMORED BRUISER',
  grinder: 'BALANCED',
};

/** Full-bar ranges, so a bar and the physics agree by construction. */
const BAR_RANGE = {
  speed: [0.9, 1.08],
  handling: [0.9, 1.1],
  armor: [0.72, 1.3],
  weapons: [0.85, 1.35],
};

function bars(tune) {
  const bar = (v, [lo, hi]) => Math.max(1, Math.min(10, Math.round(1 + ((v - lo) / (hi - lo)) * 9)));
  return {
    speed: bar(tune.speed, BAR_RANGE.speed),
    handling: bar(tune.grip, BAR_RANGE.handling),
    armor: bar(tune.armor, BAR_RANGE.armor),
    weapons: bar(tune.weapons, BAR_RANGE.weapons),
  };
}

const RAW = [
  {
    id: 'vector',
    name: 'VECTOR',
    role: 'grinder',
    blurb: 'Track prototype. No weakness, no gift.',
    model: 'assets/models/cars/vector.glb',
    modelFlip: true,
    weapon: { model: 'assets/models/weapons/machine_gun.glb', length: 1.05, z: -0.5, reach: 0.55 },
    tune: { speed: 1, accel: 1, grip: 1, armor: 1, weapons: 1 },
    paint: {
      body: 0x5d7689, accent: 0xe04a22, dark: 0x1b2126, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xc2ccd2, head: 0xbfe9ff, brake: 0xff2a0a,
    },
  },
  {
    id: 'redline',
    name: 'REDLINE',
    role: 'sprinter',
    blurb: 'Stripped street sprinter. Fastest on the straight, thinnest plate.',
    model: 'assets/models/cars/redline.glb',
    weapon: { model: 'assets/models/weapons/utcm_blaster.glb', length: 1.25, z: -0.25, reach: 0.5 },
    tune: { speed: 1.07, accel: 1.1, grip: 0.98, armor: 0.8, weapons: 0.95 },
    paint: {
      body: 0xd2401f, accent: 0xffb347, dark: 0x241412, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xe0c9a8, head: 0xfff0d0, brake: 0xff2a0a,
    },
  },
  {
    id: 'sabre',
    name: 'SABRE',
    role: 'predator',
    blurb: 'Runs at the front and shoots on the move. Breaks locks.',
    model: 'assets/models/cars/sabre.glb',
    weapon: { model: 'assets/models/weapons/automatic_machine_gun.glb', length: 0.95, z: 0.1, reach: 0.5 },
    tune: { speed: 1.04, accel: 1.06, grip: 1.05, armor: 0.9, weapons: 1.2 },
    paint: {
      body: 0x2f6fb4, accent: 0x63f4ff, dark: 0x121a24, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xc2ccd2, head: 0xbfe9ff, brake: 0xff2a0a,
    },
  },
  {
    id: 'hammer',
    name: 'HAMMER',
    role: 'heavy',
    blurb: 'Muscle chassis, big cannon. Prices pace for plate.',
    model: 'assets/models/cars/hammer.glb',
    weapon: { model: 'assets/models/weapons/car_combat_machine_gun.glb', length: 1.1, z: 0.05, reach: 0.5 },
    tune: { speed: 0.95, accel: 0.97, grip: 1, armor: 1.18, weapons: 1.1 },
    paint: {
      body: 0x8b5cc0, accent: 0xff8a24, dark: 0x1d1726, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xb9aecd, head: 0xe6d8ff, brake: 0xff2a0a,
    },
  },
  {
    id: 'enforcer',
    name: 'ENFORCER',
    role: 'heavy',
    blurb: 'Interceptor with a roof turret. Slow to arrive, hard to stop.',
    model: 'assets/models/cars/enforcer.glb',
    // the hardpoint sits behind the lightbar, not on it: the bar is the highest
    // thing on this roof and a turret perched on it reads as broken
    weapon: { model: 'assets/models/weapons/gatling_gun.glb', length: 1, z: -0.95, reach: 0.3 },
    tune: { speed: 0.98, accel: 1, grip: 1.03, armor: 1.24, weapons: 1.12 },
    paint: {
      body: 0x2f9d55, accent: 0xe8f0b0, dark: 0x18211b, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xb7c4b6, head: 0xd8ffe4, brake: 0xff2a0a,
    },
  },
];

export const CARS = RAW.map((car) => ({
  ...car,
  badge: ROLE_LABEL[car.role],
  stats: bars(car.tune),
}));

/** The car the garage opens on: the reference build, so a first race feels
    exactly like the physics the baseline was recorded against. */
export const DEFAULT_CAR = 0;
