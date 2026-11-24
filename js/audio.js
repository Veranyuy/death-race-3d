/* =========================================================================
   DEATH RACE 3D — procedural audio
   Everything here is synthesised: no files, no fetches, nothing to cache or
   decode, so the whole soundtrack costs a handful of oscillators.

   iOS Safari only starts Web Audio from a real gesture, so the context is
   created lazily on the first touch/click/keypress (see main.js) and every
   call is a no-op until then. A tab that has never been touched costs zero.
   ========================================================================= */

const MASTER = 0.5;

/** Engine character per grid slot: the player first, then the six rivals.
    `base` is the idle firing frequency, `span` how far it climbs towards the
    limiter, `harmonic` the overrun whistle and `wave` the timbre. Six rivals
    that all sounded alike would read as one car, so pitch and filter differ
    per slot as well. */
const ENGINES = [
  { base: 58, span: 186, harmonic: 3.2, cut: 620, q: 3.4, wave: 'sawtooth', level: 1.0 },
  { base: 46, span: 138, harmonic: 2.1, cut: 460, q: 2.2, wave: 'square', level: 0.80 },
  { base: 64, span: 152, harmonic: 2.6, cut: 540, q: 2.8, wave: 'sawtooth', level: 0.78 },
  { base: 40, span: 118, harmonic: 1.8, cut: 380, q: 4.0, wave: 'square', level: 0.80 },
  { base: 72, span: 164, harmonic: 2.9, cut: 700, q: 2.0, wave: 'sawtooth', level: 0.72 },
  { base: 52, span: 128, harmonic: 2.3, cut: 430, q: 3.0, wave: 'sawtooth', level: 0.76 },
  { base: 60, span: 146, harmonic: 2.4, cut: 500, q: 2.6, wave: 'square', level: 0.74 },
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** One car's engine: a firing fundamental, a half-speed rumble and a harmonic
    whistle over a throttle-driven low-pass. All parameter writes are smoothed
    with setTargetAtTime so a 30 Hz update never zippers. */
function createVoice(ctx, out, profile) {
  const osc = ctx.createOscillator();
  const sub = ctx.createOscillator();
  const whine = ctx.createOscillator();
  const tone = ctx.createGain();
  const whistle = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = profile.wave;
  sub.type = 'sawtooth';
  whine.type = 'triangle';
  osc.frequency.value = profile.base;
  sub.frequency.value = profile.base * 0.5;
  whine.frequency.value = profile.base * profile.harmonic;

  tone.gain.value = 0.7;
  whistle.gain.value = 0.12;
  filter.type = 'lowpass';
  filter.frequency.value = profile.cut;
  filter.Q.value = profile.q;
  gain.gain.value = 0;

  osc.connect(tone);
  sub.connect(tone);
  whine.connect(whistle);
  tone.connect(filter);
  filter.connect(gain);
  whistle.connect(gain);
  gain.connect(out);
  osc.start();
  sub.start();
  whine.start();

  return {
    profile,
    set(now, rpm, load, nitro, level) {
      const p = profile;
      const f = p.base + p.span * rpm + 12 * load;
      osc.frequency.setTargetAtTime(f, now, 0.035);
      sub.frequency.setTargetAtTime(f * 0.5, now, 0.035);
      whine.frequency.setTargetAtTime(f * p.harmonic, now, 0.055);
      filter.frequency.setTargetAtTime(
        p.cut + 1500 * rpm + 900 * load + 1400 * nitro, now, 0.06
      );
      whistle.gain.setTargetAtTime(0.05 + 0.16 * rpm + 0.3 * nitro, now, 0.08);
      gain.gain.setTargetAtTime(level, now, 0.07);
    },
  };
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let voices = [];
  let enabled = true;
  let volume = 0.8;
  let acc = 0;
  let rivalAcc = 0;

  function applyGain() {
    if (!master) return;
    master.gain.setTargetAtTime(enabled ? volume * MASTER : 0, ctx.currentTime, 0.05);
  }

  /** Creates/resumes the context. Must be called from a real user gesture:
      iOS Safari refuses to start audio anywhere else. Cheap to call often. */
  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) {
      try {
        ctx = new AC({ latencyHint: 'interactive' });
        master = ctx.createGain();
        master.gain.value = enabled ? volume * MASTER : 0;
        master.connect(ctx.destination);
        voices = ENGINES.map((p) => createVoice(ctx, master, p));
      } catch {
        ctx = null;
        master = null;
        return false;
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }

  function beep(now, freq, dur, type, level) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }

  const audible = () => !!ctx && enabled && ctx.state === 'running';

  /** One tone per lamp coming on: same pitch class, rising a little. */
  function countdown(index = 1) {
    if (!audible()) return;
    beep(ctx.currentTime, 430 + Math.max(0, index - 1) * 34, 0.16, 'square', 0.16);
  }

  /** Lights out: a bright three-part launch tone, so the start is audible
      even with the phone in a pocket. */
  function go() {
    if (!audible()) return;
    const now = ctx.currentTime;
    beep(now, 523.25, 0.5, 'sawtooth', 0.2);
    beep(now + 0.02, 784, 0.55, 'square', 0.12);
    beep(now + 0.045, 1046.5, 0.5, 'triangle', 0.1);
  }

  /** Called every frame; writes are throttled internally so a mid-range phone
      never re-schedules seven voices at 60 Hz. `running` false (results sheet)
      fades the field out instead of droning on at the last race speed. */
  function update(dt, driver, opponents, running = true) {
    if (!ctx || !voices.length || ctx.state !== 'running') return;
    acc += dt;
    if (acc < 0.04) return;
    const step = acc;
    acc = 0;
    const now = ctx.currentTime;

    const raw = Math.max(driver.input.throttle, driver.keys.forward ? 1 : 0);
    const throttle = running ? raw : 0;
    const rpm = running ? Math.min(driver.state.speedKmh / 250, 1.05) : 0;
    // idle is audible but quiet; the rev at the line is mostly throttle
    // a stopped field (results sheet) goes silent rather than idling at the
    // speed it finished on
    const level = running ? 0.16 + rpm * 0.2 + throttle * 0.09 : 0;
    voices[0].set(now, rpm, throttle, driver.state.boosting ? 1 : 0, level);

    rivalAcc += step;
    if (rivalAcc < 0.1 || !opponents) return;
    rivalAcc = 0;
    const px = driver.car.position.x;
    const pz = driver.car.position.z;
    for (let i = 1; i < voices.length; i++) {
      const car = opponents.cars[i - 1];
      if (!car) continue;
      // rivals are texture, not a second hero: audible within ~140 m, then gone
      const near = Math.max(0, 1 - Math.hypot(car.x - px, car.z - pz) / 140);
      const r = Math.min(car.v / 64, 1.05);
      voices[i].set(now, r, 0.55, 0, near * near * 0.16 * voices[i].profile.level);
    }
  }

  function setEnabled(on) {
    enabled = !!on;
    applyGain();
  }

  function setVolume(v) {
    volume = clamp(Number(v) || 0, 0, 1);
    applyGain();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else if (enabled) ctx.resume().catch(() => {});
    });
  }

  return {
    unlock,
    update,
    countdown,
    go,
    setEnabled,
    setVolume,
    get ready() { return !!ctx && ctx.state === 'running'; },
    get enabled() { return enabled; },
    get volume() { return volume; },
    get contextState() { return ctx ? ctx.state : 'none'; },
    get voiceCount() { return voices.length; },
  };
}
