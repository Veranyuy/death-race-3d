/* =========================================================================
   DEATH RACE 3D — mobile input layer
   Multi-touch steering / boost / brake / weapons, optional tilt steering and
   auto-accelerate. Desktop pointer + keyboard testing is intentionally kept.
   ========================================================================= */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createControls(driver, options = {}) {
  const { onMessage, onChange } = options;
  const combat = options.combat || null;
  const $ = (id) => document.getElementById(id);
  const el = {
    left: $('steerLeft'),
    right: $('steerRight'),
    gas: $('gasBtn'),
    brake: $('brakeBtn'),
    nitro: $('nitroBtn'),
    gun: $('gunBtn'),
    missile: $('missileBtn'),
    oil: $('oilBtn'),
    shield: $('shieldBtn'),
    gunAmmo: $('gunAmmo'),
    missileAmmo: $('missileAmmo'),
    oilAmmo: $('oilAmmo'),
    shieldCharge: $('shieldCharge'),
    auto: $('toggleAuto'),
    tilt: $('toggleTilt'),
    assistBtns: [...document.querySelectorAll('[data-assist]')],
    settingsBtn: $('settingsBtn'),
    settingsPanel: $('settingsPanel'),
  };

  /* ---------------------------------------------------------- preferences */

  // Player choices survive a reload. Anything missing, unreadable or out of
  // range falls through to the defaults: auto-accelerate on, assist on for
  // touch players (the driver sets that one), tilt off.
  const STORE_KEY = 'deathrace3d.settings';
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  })();

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        autoAccel: state.autoAccel,
        tilt: state.tilt,
        assist: driver.assist.mode,
      }));
    } catch { /* private mode or storage disabled: choice lasts the session */ }
  }

  const held = { left: false, right: false, gas: false, brake: false, nitro: false, gun: false };
  const state = {
    // `!== false` keeps the default when the key was never written
    autoAccel: stored.autoAccel !== false,
    tilt: false,
    tiltInvert: false,
    launched: false,
    tiltSteer: 0,
  };

  /* ------------------------------------------------------------- pointers */

  /** Holds a control for as long as its own pointer stays down, so several
      fingers (steer + nitro + gun) work at once. */
  function bindHold(node, name, onPressChange) {
    if (!node) return;
    let pointerId = null;
    const press = (e) => {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      state.launched = true;
      held[name] = true;
      node.classList.add('held');
      try { node.setPointerCapture(pointerId); } catch { /* synthetic pointers */ }
      onPressChange?.(true);
      e.preventDefault();
    };
    const release = (e) => {
      if (pointerId === null) return;
      if (e && e.pointerId !== undefined && e.pointerId !== pointerId) return;
      pointerId = null;
      held[name] = false;
      node.classList.remove('held');
      onPressChange?.(false);
    };
    node.addEventListener('pointerdown', press);
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    node.addEventListener('lostpointercapture', release);
    node.addEventListener('contextmenu', (e) => e.preventDefault());
    node.addEventListener('dragstart', (e) => e.preventDefault());
  }

  bindHold(el.left, 'left');
  bindHold(el.right, 'right');
  bindHold(el.gas, 'gas');
  bindHold(el.brake, 'brake');
  bindHold(el.nitro, 'nitro');
  bindHold(el.gun, 'gun');
  bindHold(el.oil, 'oil');
  bindHold(el.missile, 'missile', (down) => {
    if (down) combat?.fireMissile();
  });
  bindHold(el.shield, 'shield', (down) => {
    if (down) combat?.toggleShield();
  });

  /* --------------------------------------------------------------- toggles */

  function syncToggles() {
    el.auto?.classList.toggle('on', state.autoAccel);
    el.auto?.setAttribute('aria-pressed', String(state.autoAccel));
    el.tilt?.classList.toggle('on', state.tilt);
    el.tilt?.setAttribute('aria-pressed', String(state.tilt));
    if (el.gas) el.gas.hidden = state.autoAccel;
    onChange?.(state);
  }

  function setAuto(on) {
    state.autoAccel = !!on;
    syncToggles();
    saveSettings();
  }

  async function setTilt(on) {
    if (!on) {
      state.tilt = false;
      state.tiltSteer = 0;
      removeEventListener('deviceorientation', readTilt, true);
      syncToggles();
      saveSettings();
      return false;
    }
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) {
      onMessage?.('TILT NOT AVAILABLE ON THIS DEVICE', '#ff8a24');
      syncToggles();
      return false;
    }
    if (typeof DOE.requestPermission === 'function') {
      try {
        const granted = await DOE.requestPermission();
        if (granted !== 'granted') {
          onMessage?.('TILT PERMISSION DENIED', '#ff8a24');
          syncToggles();
          return false;
        }
      } catch {
        onMessage?.('TILT PERMISSION DENIED', '#ff8a24');
        syncToggles();
        return false;
      }
    }
    addEventListener('deviceorientation', readTilt, true);
    state.tilt = true;
    syncToggles();
    saveSettings();
    onMessage?.('TILT STEERING ON', '#35f2ff');
    return true;
  }

  /* AI driving assist: off / low / high, stored on the driver because the
     physics reads it every frame */
  function setAssist(mode) {
    if (mode !== 'off' && mode !== 'low' && mode !== 'high') return false;
    driver.assist.mode = mode;
    syncAssist();
    saveSettings();
    onMessage?.(`AI DRIVING ASSIST  ${mode.toUpperCase()}`, '#8fe8ff');
    return true;
  }

  function syncAssist() {
    for (const btn of el.assistBtns) {
      const on = btn.dataset.assist === driver.assist.mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  for (const btn of el.assistBtns) {
    btn.addEventListener('click', () => setAssist(btn.dataset.assist));
  }

  el.auto?.addEventListener('click', () => setAuto(!state.autoAccel));
  el.tilt?.addEventListener('click', () => { setTilt(!state.tilt); });

  el.settingsBtn?.addEventListener('click', () => {
    if (!el.settingsPanel) return;
    el.settingsPanel.hidden = !el.settingsPanel.hidden;
    el.settingsBtn.setAttribute('aria-expanded', String(!el.settingsPanel.hidden));
  });

  /* ------------------------------------------------------------------ tilt */

  function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    if (typeof window.orientation === 'number') return window.orientation;
    return 0;
  }

  /** Landscape phones roll around the device Y axis, so beta (not gamma) is the
      steering axis; the sign follows the screen rotation. */
  function readTilt(e) {
    if (!state.tilt) return;
    const angle = ((screenAngle() % 360) + 360) % 360;
    const landscape = angle === 90 || angle === 270;
    const raw = landscape ? e.beta : e.gamma;
    if (raw === null || raw === undefined) return;
    let value = raw * (angle === 270 ? -1 : 1);
    if (state.tiltInvert) value = -value;
    const dead = 3;
    const span = 24;
    const mag = clamp((Math.abs(value) - dead) / span, 0, 1);
    // positive steer input = left; rolling the right edge down steers right
    state.tiltSteer = Number.isFinite(mag) ? -mag * Math.sign(value) : 0;
  }

  /* ------------------------------------------------------------- lifecycle */

  function reset() {
    for (const key of Object.keys(held)) held[key] = false;
    for (const node of [el.left, el.right, el.gas, el.brake, el.nitro, el.gun, el.oil, el.missile, el.shield]) {
      node?.classList.remove('held');
    }
  }

  addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });

  // the first tap anywhere counts as "launch", so auto-accelerate does not
  // drive off the line before the player has touched the screen
  addEventListener('pointerdown', () => { state.launched = true; }, { passive: true });

  /* ---------------------------------------------------------------- update */

  const seen = {
    gun: -1, missile: -1, oil: -1, shield: -1,
    missileCool: null, gunEmpty: null, shieldOn: null,
  };

  /** Weapon readouts are polled; every write is guarded by a change check so
      the touch layer costs nothing on a steady frame. */
  function syncWeapons() {
    if (!combat) return;
    const h = combat.hud;
    if (h.gunAmmo !== seen.gun) {
      seen.gun = h.gunAmmo;
      if (el.gunAmmo) el.gunAmmo.textContent = String(h.gunAmmo);
    }
    const gunEmpty = h.gunAmmo <= 0 || h.gunReload > 0;
    if (gunEmpty !== seen.gunEmpty) {
      seen.gunEmpty = gunEmpty;
      el.gun?.classList.toggle('cooling', gunEmpty);
    }
    if (h.missiles !== seen.missile) {
      seen.missile = h.missiles;
      if (el.missileAmmo) el.missileAmmo.textContent = String(h.missiles);
      el.missile?.classList.toggle('empty', h.missiles <= 0);
    }
    const cooling = h.missileCool > 0;
    if (cooling !== seen.missileCool) {
      seen.missileCool = cooling;
      el.missile?.classList.toggle('cooling', cooling);
    }
    if (h.oil !== seen.oil) {
      seen.oil = h.oil;
      if (el.oilAmmo) el.oilAmmo.textContent = String(h.oil);
      el.oil?.classList.toggle('empty', h.oil <= 0);
    }
    const charge = Math.round(h.shield);
    if (charge !== seen.shield) {
      seen.shield = charge;
      if (el.shieldCharge) el.shieldCharge.textContent = String(charge);
    }
    if (h.shieldActive !== seen.shieldOn) {
      seen.shieldOn = h.shieldActive;
      el.shield?.classList.toggle('active', h.shieldActive);
    }
  }

  function update() {
    const steerTouch = (held.left ? 1 : 0) - (held.right ? 1 : 0);
    const steerTilt = state.tilt ? state.tiltSteer : 0;
    driver.input.steer = clamp(steerTouch + steerTilt, -1, 1);
    driver.input.throttle = state.autoAccel
      ? (state.launched ? 1 : 0)
      : (held.gas ? 1 : 0);
    driver.input.brake = held.brake ? 1 : 0;
    driver.input.boost = held.nitro ? 1 : 0;
    driver.input.gun = held.gun;
    driver.input.oil = held.oil;
    syncWeapons();
  }

  // the saved assist mode replaces the driver's platform default (touch gets
  // HIGH) once the player has ever chosen one
  if (stored.assist === 'off' || stored.assist === 'low' || stored.assist === 'high') {
    driver.assist.mode = stored.assist;
  }
  syncToggles();
  syncAssist();

  // A remembered tilt setting cannot be re-armed at boot because iOS only
  // grants motion access from a user gesture, so it restarts on the first tap.
  if (stored.tilt === true) {
    addEventListener('pointerdown', () => { setTilt(true); }, { once: true });
  }

  return {
    state,
    held,
    update,
    reset,
    setAuto,
    setAssist,
    setTilt,
    setTiltInvert(v) { state.tiltInvert = !!v; },
  };
}
