/* =========================================================================
   APEX ARMED — procedural audio
   Everything here is synthesised: no files, no fetches, nothing to cache or
   decode, so the whole soundtrack costs a couple of dozen oscillators. A
   sampled engine loop can be dropped in per slot (see `loadSamples`) and the
   synth underneath keeps working for whatever has no sample.

   iOS Safari only starts Web Audio from a real gesture, so the context is
   created lazily on the first touch/click/keypress (see main.js) and every
   call is a no-op until then. A tab that has never been touched costs zero.
   ========================================================================= */

const MASTER = 0.5;

/** Six-speed gearbox shared by the grid: the speed band each gear covers.
    `rpm` inside a voice walks this band from ~0.3 to 1.0, so the engine note
    climbs through a gear and drops back on the shift instead of sweeping like
    one long electric whine. */
const GEAR_END = [36, 70, 106, 146, 190, 246];   // km/h at the top of 1..6
const RPM_IDLE = 0.30;      // fraction of the band at a gear's floor
const RPM_TOP = 1.0;
const SHIFT_CUT = 0.1;      // seconds of fuel cut / torque dip per upshift

/** Engine character per grid slot: the player first, then the six rivals.
    `base` is the firing frequency at idle, `span` how far it climbs to the
    limiter, `harmonic` the overrun whistle, `cut` the exhaust body filter,
    `shift` scales the gear bands so a sport note revs later, and `level`
    balances the mix. Seven identical cars would read as one, so each slot
    gets a different cylinder count, timbre and gear spacing. */
const ENGINES = [
  { base: 54, span: 172, harmonic: 3.1, cut: 560, q: 1.3, wave: 'sawtooth', shift: 1.00, rev: 1.00, level: 1.00 },
  { base: 42, span: 126, harmonic: 2.4, cut: 420, q: 1.7, wave: 'square', shift: 0.86, rev: 0.92, level: 0.80 },
  { base: 62, span: 158, harmonic: 2.9, cut: 500, q: 1.2, wave: 'sawtooth', shift: 1.06, rev: 1.04, level: 0.78 },
  { base: 38, span: 112, harmonic: 2.2, cut: 360, q: 2.0, wave: 'square', shift: 0.80, rev: 0.88, level: 0.80 },
  { base: 70, span: 168, harmonic: 3.4, cut: 640, q: 1.1, wave: 'sawtooth', shift: 1.12, rev: 1.08, level: 0.72 },
  { base: 48, span: 132, harmonic: 2.6, cut: 400, q: 1.6, wave: 'sawtooth', shift: 0.90, rev: 0.95, level: 0.76 },
  { base: 58, span: 148, harmonic: 2.7, cut: 470, q: 1.4, wave: 'square', shift: 0.96, rev: 0.99, level: 0.74 },
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Stored transfer curve for the saturator: tanh soft-knee, normalised so the
    output never exceeds the input's peak. `k` stays low — this is manifold
    warmth on top of the harmonic bank, not distortion. */
function makeCurve(k = 2.0, n = 1024) {
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / norm;
  }
  return curve;
}

/** One second of white noise, looped under every voice. Generated once and
    shared: the buffer is read-only, so 7 buffer sources cost 7 handles and no
    extra memory. */
function makeNoise(ctx) {
  const len = Math.max(1, Math.floor(ctx.sampleRate));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // deterministic LCG: the same noise floor on every launch, and no per-sample
  // Math.random() call while building it
  let seed = 0x2f6e2b1;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = seed / 0x3fffffff - 1;
  }
  return buffer;
}

/** Gear + revs for a given road speed. Pure maths, so rivals each run their
    own gearbox from their own speed without any shared state. */
function gearOf(speedKmh, profile, out) {
  const v = Math.max(0, speedKmh) / profile.shift;
  let g = 0;
  while (g < GEAR_END.length - 1 && v > GEAR_END[g]) g++;
  const lo = g === 0 ? 0 : GEAR_END[g - 1];
  const hi = GEAR_END[g] * (g === GEAR_END.length - 1 ? 1.18 : 1);
  const frac = clamp((v - lo) / Math.max(1, hi - lo), 0, 1);
  out.gear = g + 1;
  out.rpm = RPM_IDLE + (RPM_TOP - RPM_IDLE) * frac;
  return out;
}

/** One car's engine:
      four oscillators (firing fundamental, half-speed crank rumble, 2nd and
      3rd harmonics) -> soft saturation -> exhaust body filter, plus a band of
      filtered noise for intake/exhaust air that opens with load and nitro.
    Every parameter write is smoothed with setTargetAtTime, so a 25 Hz update
    never zippers, and the whole voice is 11 nodes. */
function createVoice(ctx, out, profile, curve, noiseBuffer) {
  const osc = ctx.createOscillator();
  const sub = ctx.createOscillator();
  const h2 = ctx.createOscillator();
  const h3 = ctx.createOscillator();
  const mix = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const body = ctx.createBiquadFilter();
  const noise = ctx.createBufferSource();
  const air = ctx.createBiquadFilter();
  const airGain = ctx.createGain();
  const gain = ctx.createGain();

  osc.type = profile.wave;
  sub.type = 'sine';
  h2.type = 'triangle';
  h3.type = 'sawtooth';
  osc.frequency.value = profile.base;
  sub.frequency.value = profile.base * 0.5;
  h2.frequency.value = profile.base * 2;
  h3.frequency.value = profile.base * 3;

  // pre-gain keeps the saturator in its soft region; h3 rides low so the top
  // octave colours the note without turning it into a buzz
  osc.connect(mix);
  sub.connect(mix);
  h2.connect(mix);
  h3.connect(mix);
  mix.gain.value = 0.42;
  h3.detune.value = 6;
  shaper.curve = curve;
  shaper.oversample = '2x';
  mix.connect(shaper);

  body.type = 'lowpass';
  body.frequency.value = profile.cut;
  body.Q.value = profile.q;
  shaper.connect(body);
  body.connect(gain);

  noise.buffer = noiseBuffer;
  noise.loop = true;
  air.type = 'bandpass';
  air.frequency.value = 900;
  air.Q.value = 0.7;
  noise.connect(air);
  air.connect(airGain);
  airGain.gain.value = 0;
  airGain.connect(gain);

  gain.gain.value = 0;
  gain.connect(out);

  osc.start();
  sub.start();
  h2.start();
  h3.start();
  // a hair in the future so the loop starts on a running context, not a
  // suspended one that would silently swallow the first buffer
  noise.start(ctx.currentTime + 0.02);

  let sample = null;
  const voice = {
    profile,
    gear: 1,
    rpm: RPM_IDLE,
    set(now, speedKmh, load, nitro, level) {
      const p = profile;
      const g = gearOf(speedKmh, p, voice);
      // an upshift is a torque cut: duck the tone for a moment so the gear
      // change is heard as a shift rather than a glissando
      if (g.gear > voice.lastGear) voice.cut = now + SHIFT_CUT;
      voice.lastGear = g.gear;
      const cutting = now < voice.cut;

      const f = (p.base + p.span * g.rpm) * p.rev;
      const tau = 0.022;   // fast enough to read as a shift, slow enough to
                           // never click
      osc.frequency.setTargetAtTime(f, now, tau);
      sub.frequency.setTargetAtTime(f * 0.5, now, tau);
      h2.frequency.setTargetAtTime(f * 2, now, tau);
      h3.frequency.setTargetAtTime(f * 3, now, tau);

      // load opens the exhaust: wide-open throttle and nitro brighten the body
      const cut = clamp(p.cut + 1500 * g.rpm + 1400 * load + 1600 * nitro, 180, 7200);
      body.frequency.setTargetAtTime(cut, now, 0.05);
      body.Q.setTargetAtTime(p.q * (0.8 + 0.6 * load), now, 0.08);

      // intake/exhaust air: barely there at idle, a rush under throttle, more
      // under nitro. Coastering pulls it right back with `load`.
      air.frequency.setTargetAtTime(
        clamp(520 + 2200 * g.rpm + 2600 * load + 2200 * nitro, 300, 9000), now, 0.07
      );
      airGain.gain.setTargetAtTime(
        level * (0.03 + 0.22 * load + 0.16 * nitro) * (cutting ? 0.35 : 1),
        now, 0.05
      );

      // the harmonic bank sits behind the saturator, so the cut dips it, and
      // a sampled loop (if this slot has one) is muted while it plays
      mix.gain.setTargetAtTime(sample ? 0.12 : 0.42, now, 0.05);
      gain.gain.setTargetAtTime(level * (cutting ? 0.62 : 1), now, 0.04);

      if (sample) {
        // a real recording is pitched from its single loop point, so the gear
        // change is heard as pitch too, but the synth still carries the top
        sample.src.playbackRate.setTargetAtTime(0.55 + g.rpm * 1.15, now, tau);
        sample.g.gain.setTargetAtTime(level * 1.5, now, 0.05);
      }
      return g;
    },
  };

  /** Swaps this slot onto a decoded loop when one is available. The synth is
      trimmed to a bed rather than stopped, so a loop that turns out to be a
      poor fit still has the gear note under it. */
  voice.attachSample = (buffer) => {
    if (!buffer || sample) return false;
    const src = ctx.createBufferSource();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = buffer;
    src.loop = true;
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    g.gain.value = 0;
    src.connect(lp);
    lp.connect(g);
    g.connect(gain);
    src.start(ctx.currentTime + 0.03);
    sample = { src, g };
    voice.hasSample = true;
    return true;
  };

  voice.cut = 0;
  voice.lastGear = 1;
  voice.hasSample = false;
  return voice;
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let voices = [];
  let enabled = true;
  let volume = 0.8;
  let acc = 0;
  let rivalAcc = 0;
  let curve = null;
  let noiseBuffer = null;
  let sampleCount = 0;
  let loading = null;

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
        curve = makeCurve();
        noiseBuffer = makeNoise(ctx);
        voices = ENGINES.map((p) => createVoice(ctx, master, p, curve, noiseBuffer));
      } catch {
        ctx = null;
        master = null;
        return false;
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // a page that ships sample URLs opts in by declaring them before or after
    // the first gesture; without the global nothing is ever requested
    const declared = typeof window !== 'undefined' ? window.DEATHRACE_SAMPLES : null;
    if (declared && !loading) loadSamples(declared);
    return true;
  }

  /**
   * Optional sampled engines. Pass an array of URLs indexed by grid slot, or
   * `{ player: url, rivals: [url, ...] }`. Anything that fails to fetch or
   * decode simply leaves that slot on the synth, and slots you omit are never
   * requested — so the game makes zero requests when no assets exist, and a
   * missing file can never surface as an error in the console.
   */
  function loadSamples(urls) {
    if (!ctx || !voices.length || !urls) return Promise.resolve(0);
    if (loading) return loading;
    const list = Array.isArray(urls)
      ? urls
      : [urls.player, ...(urls.rivals || [])];
    loading = (async () => {
      for (let i = 0; i < list.length && i < voices.length; i++) {
        const url = list[i];
        if (!url) continue;
        try {
          const res = await fetch(url, { cache: 'force-cache' });
          if (!res.ok) continue;
          const data = await res.arrayBuffer();
          const buffer = await ctx.decodeAudioData(data);
          if (voices[i].attachSample(buffer)) sampleCount++;
        } catch {
          // no sample for this slot: the synth voice already in place stands
        }
      }
      return sampleCount;
    })();
    return loading;
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

    const rawThrottle = Math.max(driver.input.throttle, driver.keys.forward ? 1 : 0);
    const throttle = running ? rawThrottle : 0;
    const nitro = running && driver.state.boosting ? 1 : 0;
    const braking = running && (driver.input.brake > 0.05 || driver.keys.back);
    // load is what the engine is working against, not just what the pedal is
    // doing: braking unloads it, coasting leaves it empty, nitro loads it hard
    const load = running
      ? clamp(throttle * (braking ? 0.35 : 1) + nitro * 0.55, 0, 1)
      : 0;
    const speed = running ? driver.state.speedKmh : 0;
    const level = running
      ? (0.11 + load * 0.13 + Math.min(speed / 250, 1) * 0.06) * voices[0].profile.level
      : 0;
    voices[0].set(now, speed, load, nitro, level);

    rivalAcc += step;
    if (rivalAcc < 0.1 || !opponents) return;
    rivalAcc = 0;
    const px = driver.car.position.x;
    const pz = driver.car.position.z;
    // the results sheet has to silence the whole field, not just the hero: a
    // grid still pulling past the player under a stopped race was the loudest
    // thing on that screen. `running` false sends every rival to zero, and the
    // voice's own smoothed gain turns that into the same fade as the player.
    const field = running ? 1 : 0;
    for (let i = 1; i < voices.length; i++) {
      const car = opponents.cars[i - 1];
      if (!car) continue;
      // rivals are texture, not a second hero: audible within ~140 m, then gone
      const near = Math.max(0, 1 - Math.hypot(car.x - px, car.z - pz) / 140);
      const kmh = car.v * 3.6;
      voices[i].set(
        now, kmh, 0.55, 0, field * near * near * 0.16 * voices[i].profile.level
      );
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
    loadSamples,
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
    /** Live gearbox readout for the diagnostics overlay and the harness. */
    get engine() {
      const v = voices[0];
      if (!v) return null;
      return {
        gear: v.gear,
        rpm: +v.rpm.toFixed(3),
        samples: sampleCount,
        gearbox: GEAR_END.length,
      };
    },
  };
}
