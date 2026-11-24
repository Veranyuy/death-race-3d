/* =========================================================================
   DEATH RACE 3D — frame budget governor
   Measures the wall-clock cost of each frame and steps the renderer between
   quality levels when the device cannot hold 60 FPS. Pure logic: it never
   touches Three or the DOM, so it can be tested outside the browser.
   ========================================================================= */

/** Quality steps, best first. Each one is a complete, self-consistent set:
    backing-store scale, shadow refresh period, drift smoke density and whether
    the distant skyline band is drawn.

    Roadside structures (halls, containers, gantries, lattice towers, barriers)
    are never a quality setting: they are instanced and cheap per draw call, and
    a phone that steps down must still race through a built corridor. Only the
    far skyline — the most wasteful geometry, never close to the car — drops. */
export const QUALITY = [
  { id: 'HIGH', pixelRatio: 2, shadowEvery: 1, smoke: 1, skyline: true },
  { id: 'MED', pixelRatio: 1.5, shadowEvery: 2, smoke: 0.6, skyline: true },
  { id: 'LOW', pixelRatio: 1, shadowEvery: 3, smoke: 0.35, skyline: false },
  { id: 'MIN', pixelRatio: 1, shadowEvery: 4, smoke: 0.15, skyline: false },
];

// Every window is a second of wall time, not a fixed frame count: on the slow
// devices this exists for, sixty frames can be ten seconds away.
const WINDOW_MS = 1000;
const MIN_FRAMES = 20;    // ...but a high-refresh display still gets a full sample
const MAX_FRAMES = 240;
const WARMUP_MS = 1200;   // ignored while shaders and textures settle
const DOWN_AFTER = 2;     // slow windows in a row before stepping down
const UP_AFTER = 3;       // good windows in a row before stepping back up
const SLOW_MS = 18.5;     // mean frame time that means "cannot hold 60"
const SLOW_P90 = 24;
const FAST_MS = 15.0;     // mean with headroom to step back up
const FAST_P90 = 17.0;
const SETTLE_MS = 600;    // ignored after a step, so the change lands first

export class QualityGovernor {
  constructor({ onTier } = {}) {
    this.onTier = onTier;
    this.tier = 0;
    this.pinned = false;
    this.elapsed = 0;
    this.settleMs = 0;
    this.acc = 0;
    this.count = 0;
    this.times = new Float32Array(MAX_FRAMES);
    this.slow = 0;
    this.fast = 0;
    this.avgMs = 16.7;
    this.p90Ms = 16.7;
    this.fps = 60;
    this.changes = 0;
  }

  setTier(index, reason = 'manual') {
    const next = Math.max(0, Math.min(QUALITY.length - 1, index | 0));
    if (next === this.tier) return this.tier;
    this.tier = next;
    this.changes += 1;
    this.slow = 0;
    this.fast = 0;
    this.settleMs = SETTLE_MS;
    this.acc = 0;
    this.count = 0;
    this.onTier?.(next, QUALITY[next], reason);
    return this.tier;
  }

  /** One frame's measured interval in ms, taken before any clamping. */
  sample(ms) {
    if (this.pinned) return this.tier;
    // a parked tab, a debugger pause or a one-off upload says nothing about
    // steady-state cost, so absurd gaps are dropped — but a genuinely slow
    // device must still be measured, which is why this cap is seconds, not
    // the 120 ms a "bad frame" already is
    if (!(ms > 0) || ms > 700) return this.tier;
    this.elapsed += ms;
    if (this.elapsed < WARMUP_MS) return this.tier;
    if (this.settleMs > 0) {
      this.settleMs -= ms;
      return this.tier;
    }

    this.times[this.count] = ms;
    this.count += 1;
    this.acc += ms;
    if (this.acc < WINDOW_MS && this.count < MAX_FRAMES) return this.tier;
    if (this.count < MIN_FRAMES) return this.tier;

    const n = this.count;
    const avg = this.acc / n;
    const sorted = this.times.slice(0, n).sort();
    const p90 = sorted[Math.floor(n * 0.9)];
    this.acc = 0;
    this.count = 0;
    this.avgMs = avg;
    this.p90Ms = p90;
    this.fps = 1000 / avg;

    // a hard miss or a long tail both count: a device that averages 58 FPS but
    // spikes to 40 every other second still feels broken
    if (avg > SLOW_MS || p90 > SLOW_P90) {
      this.slow += 1;
      this.fast = 0;
    } else if (avg < FAST_MS && p90 < FAST_P90) {
      this.fast += 1;
      this.slow = 0;
    } else {
      // dead zone, so a device sitting on the target does not flap between tiers
      this.slow = 0;
      this.fast = 0;
    }

    if (this.slow >= DOWN_AFTER && this.tier < QUALITY.length - 1) {
      return this.setTier(this.tier + 1, 'slow');
    }
    if (this.fast >= UP_AFTER && this.tier > 0) {
      return this.setTier(this.tier - 1, 'fast');
    }
    return this.tier;
  }

  /** Pin a tier (URL override / verification): measurement stops. */
  pin(index) {
    this.pinned = true;
    return this.setTier(index, 'pinned');
  }

  get config() {
    return QUALITY[this.tier];
  }
}
