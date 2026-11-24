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
  // range falls through to the defaults: manual GAS (auto-accelerate off, so
  // the throttle button is always the primary control), assist on for touch
  // players (the driver sets that one), tilt off.
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

  const held = {
    left: false, right: false, gas: false, brake: false, nitro: false,
    gun: false, oil: false, missile: false, shield: false,
  };
  const state = {
    // only an explicit stored `true` turns auto-throttle on; a first-time or
    // unreadable preference keeps the manual GAS button
    autoAccel: stored.autoAccel === true,
    tilt: false,
    tiltInvert: false,
    launched: false,
    tiltSteer: 0,
  };

  /* ------------------------------------------------------------- pointers */

  // pointerId -> { node, name, onPressChange }; one entry per finger down.
  // A node can only appear once, so the map alone knows both what is held
  // and which finger owns it.
  const holds = new Map();

  const stopEvent = (e) => e.preventDefault();
  const ownerOf = (node) => {
    for (const hold of holds.values()) if (hold.node === node) return hold;
    return null;
  };

  /** Holds a control for as long as its own pointer stays down, so several
      fingers (steer + gas + gun) work at once. Every way a touch can end is
      routed through releasePointer/releaseAll below, because iOS Safari can
      end a press without delivering a pointerup to the node itself — that is
      what used to leave a steering arrow stuck on. */
  function bindHold(node, name, onPressChange) {
    if (!node) return;
    node.addEventListener('pointerdown', (e) => {
      if (ownerOf(node)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      holds.set(e.pointerId, { node, name, onPressChange });
      held[name] = true;
      node.classList.add('held');
      // capture keeps the lift on this node even if the thumb slides off it;
      // unsupported pointer types still release through the window listeners
      try { node.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
      onPressChange?.(true);
      e.preventDefault();
    });
  }

  function releasePointer(pointerId) {
    const entry = holds.get(pointerId);
    if (!entry) return;
    holds.delete(pointerId);
    held[entry.name] = false;
    entry.node.classList.remove('held');
    entry.onPressChange?.(false);
  }

  /** One shared panic button: anything that means "no fingers on the glass
      right now" clears every latched control. */
  function releaseAll() {
    for (const pointerId of [...holds.keys()]) releasePointer(pointerId);
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
    // the GAS button is hidden while auto is on, so drop any press it holds
    // (and release the hidden node's pointer capture) before the relayout
    if (state.autoAccel) releaseAll();
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

  // A lift, an interrupted gesture, a browser-stolen touch, a lost capture, a
  // phone call or a tab switch all end in the same place. Window-level and in
  // the capture phase so the release is seen even when the event is retargeted
  // away from the button that owns the press.
  addEventListener('pointerup', (e) => releasePointer(e.pointerId), true);
  addEventListener('pointercancel', (e) => releasePointer(e.pointerId), true);
  addEventListener('lostpointercapture', (e) => releasePointer(e.pointerId), true);
  addEventListener('touchend', (e) => {
    const fingers = e.touches ? e.touches.length : 0;
    if (fingers === 0) { releaseAll(); return; }
    // a lift whose pointer event never arrived: reconcile the latched presses
    // down to the fingers still on the glass, oldest first
    while (holds.size > fingers) releasePointer(holds.keys().next().value);
  }, true);
  addEventListener('touchcancel', releaseAll, true);
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  // no long-press callout or drag ghost anywhere on the control layer; the
  // per-button handlers were redundant because the buttons live inside #touch
  $('touch')?.addEventListener('contextmenu', stopEvent);
  $('touch')?.addEventListener('dragstart', stopEvent);

  /* ---------------------------------------------------- page-zoom lockdown */

  // The viewport meta and the fixed root already forbid scaling, but iOS Safari
  // still treats two thumbs landing on the left and right controls as a pinch
  // and zooms the whole page until reload. These runtime cancellations are the
  // guarantee. The settings sheet is exempt while it is open so its rows stay
  // normally scrollable.
  const sheetOpen = () => !!el.settingsPanel && !el.settingsPanel.hidden;
  const inSheet = (target) =>
    sheetOpen() && target instanceof Node && el.settingsPanel.contains(target);

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => {
      if (!inSheet(e.target)) e.preventDefault();
    }, { passive: false });
  }

  // Multi-finger scroll/zoom is never wanted on the game surface. The start
  // event skips the control buttons on purpose: those hold their press through
  // pointer events and must not be cancelled mid-pinch. Moves are always
  // cancelled once a second thumb is down, which stops the page pan itself.
  const onControl = (target) => target instanceof Element && !!target.closest('#touch button');
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1 && !inSheet(e.target) && !onControl(e.target)) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 && !inSheet(e.target)) e.preventDefault();
  }, { passive: false });

  // double-tap zoom: swallow the second tap, not the first, so a normal tap
  // still activates a chip or a switch. Buttons are left alone because they
  // already carry a non-zoom touch-action and quick repeated taps (camera,
  // ammo) must still reach their click handler.
  let lastTapAt = 0;
  const DOUBLE_TAP_MS = 320;
  document.addEventListener('touchend', (e) => {
    if (e.touches.length || e.changedTouches.length !== 1 || inSheet(e.target)) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    if (e.timeStamp - lastTapAt < DOUBLE_TAP_MS) {
      e.preventDefault();
      lastTapAt = 0;
      return;
    }
    lastTapAt = e.timeStamp;
  }, { passive: false });
  document.addEventListener('dblclick', stopEvent, { passive: false });

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
    // with auto on, the throttle is held down on the player's behalf once they
    // have started the race; with it off, GAS is the only thing that drives and
    // lifting the thumb cuts the drive input on the very next frame
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
    reset: releaseAll,
    setAuto,
    setAssist,
    setTilt,
    setTiltInvert(v) { state.tiltInvert = !!v; },
  };
}
