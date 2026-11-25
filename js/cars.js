/* =========================================================================
   DEATH RACE 3D — vehicle manifest

   One entry per machine, and the only place a car is described. The Garage
   reads `name` / `badge` / `blurb` / `stats`, the player car reads `paint` and
   `tune`, and the rival seats read `role`, `name` and `paint` — so a car can
   never show one set of numbers and drive another.

   `tune` values are multipliers on the hand-tuned constants in
   js/driveTest.js (MAX_SPEED, ACCEL, LAT_ACCEL, GRIP_*). The GRINDER is all
   1.00 on purpose: it is the reference car the physics baseline was recorded
   with, so its handling is exactly what the harness measures.

   `tune` is the PLAYER's car only. A rival never reads it: its pace comes
   from its `role` table in js/opponents.js scaled by the difficulty, so no
   car is ever scaled by both a garage stat and a difficulty multiplier.

   `model` is the plug-in point for custom art: a .glb path (relative to the
   page) and js/modelLoader.js mounts it, measuring and normalising it to the
   same footprint the procedural chassis uses. Leave it null and the box
   chassis is used instead, so a missing or broken file still races.
   `modelFlip` turns a model that was exported nose-away by 180 degrees.
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
    id: 'grinder',
    name: 'GRINDER',
    role: 'grinder',
    blurb: 'Factory all-rounder. No weakness, no gift.',
    model: 'assets/models/cars/typhoon-53949_mrap.glb',
    tune: { speed: 1, accel: 1, grip: 1, armor: 1, weapons: 1 },
    paint: {
      body: 0x5d7689, accent: 0xe04a22, dark: 0x1b2126, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xc2ccd2, head: 0xbfe9ff, brake: 0xff2a0a,
    },
  },
  {
    id: 'razorback',
    name: 'RAZORBACK',
    role: 'grinder',
    blurb: 'Lighter chassis, quicker nose. Plate traded for turn-in.',
    model: 'assets/models/cars/lenco_bearcat_valkyriewakamos_swat_van.glb',
    tune: { speed: 0.99, accel: 1.04, grip: 1.07, armor: 0.92, weapons: 0.95 },
    paint: {
      body: 0x2f9d55, accent: 0xe8f0b0, dark: 0x18211b, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xb7c4b6, head: 0xd8ffe4, brake: 0xff2a0a,
    },
  },
  {
    id: 'k9',
    name: 'K9',
    role: 'sprinter',
    blurb: 'Stripped sprinter. Fastest on the straight, thinnest plate.',
    model: 'assets/models/cars/widowmaker_-_death_race_2000.glb',
    tune: { speed: 1.07, accel: 1.1, grip: 0.97, armor: 0.78, weapons: 0.9 },
    paint: {
      body: 0xd2401f, accent: 0xffb347, dark: 0x241412, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xe0c9a8, head: 0xfff0d0, brake: 0xff2a0a,
    },
  },
  {
    id: 'franken',
    name: 'FRANKEN',
    role: 'predator',
    blurb: 'Runs at the front and shoots on the move. Breaks locks.',
    model: 'assets/models/cars/ford_mustang_gt_05_frankenstein_death_race.glb',
    tune: { speed: 1.03, accel: 1.05, grip: 1.02, armor: 0.95, weapons: 1.25 },
    paint: {
      body: 0x2f6fb4, accent: 0x63f4ff, dark: 0x121a24, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xc2ccd2, head: 0xbfe9ff, brake: 0xff2a0a,
    },
  },
  {
    id: 'spectre',
    name: 'SPECTRE',
    role: 'predator',
    blurb: 'Fast attack build. Hits hard behind a thin shell.',
    model: 'assets/models/cars/sandstinger_-_death_race_2000.glb',
    modelFlip: true,   // this export points its tail down +z
    tune: { speed: 1.02, accel: 1.02, grip: 1, armor: 0.86, weapons: 1.18 },
    paint: {
      body: 0xd9dde0, accent: 0xff8a24, dark: 0x1a1e22, glass: 0x1b2c36,
      wheel: 0x1a1d20, rim: 0x9aa6ae, head: 0xdfefff, brake: 0xff2a0a,
    },
  },
  {
    id: 'juggernaut',
    name: 'JUGGERNAUT',
    role: 'heavy',
    blurb: 'Rolling bunker. Slow to arrive, very hard to stop.',
    model: 'assets/models/cars/armored_car_death_race.glb',
    modelFlip: true,   // this export points its tail down +z
    tune: { speed: 0.93, accel: 0.95, grip: 1.05, armor: 1.3, weapons: 1.05 },
    paint: {
      body: 0xd8b12a, accent: 0xf5f0dc, dark: 0x241f14, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xc8b27a, head: 0xfff4c8, brake: 0xff2a0a,
    },
  },
  {
    id: 'warlord',
    name: 'WARLORD',
    role: 'heavy',
    blurb: 'Armoured hunter. Prices pace for cannon and plate.',
    model: 'assets/models/cars/typhoon-vdv_30mm__russian_vdv_warno_mod.glb',
    tune: { speed: 0.95, accel: 0.96, grip: 1.09, armor: 1.22, weapons: 1.15 },
    paint: {
      body: 0x8b5cc0, accent: 0xff8a24, dark: 0x1d1726, glass: 0x1b2c36,
      wheel: 0x202427, rim: 0xb9aecd, head: 0xe6d8ff, brake: 0xff2a0a,
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
