#!/usr/bin/env node
/* =========================================================================
   DEATH RACE 3D — physics / assist regression harness

   Guards the hand-tuned constants in js/driveTest.js (GRIP_*, LAT_ACCEL,
   ASSIST.*, the wall-steer gains, the smoke pool) and the four camera rigs.
   Everything runs at a fixed 1/60 step with the render loop frozen, so the
   numbers are deterministic; the only moving part is the browser.

   Usage:
     node tools/verify/run.mjs              compare against baseline.json
     node tools/verify/run.mjs --update     re-record the baseline
     node tools/verify/run.mjs --verbose    print every measurement

   Requires a Chrome/Chromium install; set CHROME=/path/to/chrome to override.
   No server needs to be running: this starts its own on an ephemeral port.
   ========================================================================= */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(HERE, '..', '..'));
const BASELINE = join(HERE, 'baseline.json');
const VIEWPORT = { width: 956, height: 440 };
const TRACK = 0;

const args = new Set(process.argv.slice(2));
const UPDATE = args.has('--update');
const VERBOSE = args.has('--verbose');

/** How much each measurement may drift before it counts as a regression. */
const TOLERANCE = {
  brakeS: 0.35, peakBrake: 0.06, contactS: 0.2, hits: 0,
  minKmh: 2, maxKmh: 2, hairpinKmh: 2, slipDeg: 3,
  preSpeed: 3, driftSpeed: 4, peakSlipDeg: 3, maxPuffs: 0, afterPuffs: 0,
  horiz: 0.05, height: 0.05, near: 0, far: 0, fov: 0.6,
};

/* ------------------------------------------------------------ static server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = normalize(join(ROOT, rel));
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      origin: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

/* ------------------------------------------------------------------ browser */

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findChrome() {
  for (const path of CHROME_CANDIDATES) if (existsSync(path)) return path;
  throw new Error('no Chrome found — set CHROME=/path/to/chrome');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(profileDir) {
  const chrome = spawn(findChrome(), [
    '--headless=new',
    '--remote-allow-origins=*',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--hide-scrollbars',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
  ], { stdio: 'ignore' });

  // Chrome writes the chosen port here when told to pick one
  const portFile = join(profileDir, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 200 && !port; i++) {
    if (existsSync(portFile)) {
      const line = readFileSync(portFile, 'utf8').split('\n')[0].trim();
      port = Number(line) || 0;
    }
    if (!port) await sleep(100);
  }
  if (!port) { chrome.kill(); throw new Error('Chrome never opened a debug port'); }
  return { chrome, port };
}

async function connect(port, origin) {
  let wsUrl = null;
  for (let i = 0; i < 120 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* still starting */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error('Chrome exposed no page');

  if (typeof WebSocket !== 'function') {
    throw new Error('this Node has no global WebSocket; Node 22 or newer is required');
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.text || 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width, height: VIEWPORT.height,
    deviceScaleFactor: 1, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: `${origin}/index.html?track=${TRACK}&cam=chase` });

  for (let i = 0; i < 200; i++) {
    if (await evaluate('!!window.__DEATHRACE').catch(() => false)) break;
    await sleep(250);
  }
  if (!(await evaluate('!!window.__DEATHRACE'))) {
    throw new Error(`game never booted${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  }

  return { ws, errors, evaluate };
}

/* --------------------------------------------------------------- scenarios */

const SCENARIOS = `(() => {
  const DR = window.__DEATHRACE;
  const d = DR.driver;
  const tr = DR.trackRef;
  const ds = tr.length / tr.samples.length;
  const hw = tr.halfWidth;
  const dt = 1 / 60;
  window.requestAnimationFrame = () => 0;   // the loop is stepped by hand

  const lateralOf = () => {
    const n = tr.nearest(d.position, d.hintIndex);
    return (d.position.x - n.sample.pos.x) * n.sample.right.x
         + (d.position.z - n.sample.pos.z) * n.sample.right.z;
  };
  const slipNow = () => {
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    const rx = -Math.cos(d.yaw), rz = Math.sin(d.yaw);
    const vLong = d.velocity.x * fx + d.velocity.z * fz;
    const vLat = d.velocity.x * rx + d.velocity.z * rz;
    return Math.atan2(vLat, Math.max(Math.abs(vLong), 4));
  };

  const reset = () => {
    const startIndex = Math.max(1, Math.round((30 / tr.length) * tr.samples.length));
    const s = tr.samples[startIndex];
    d.placeAt(s, s.tan);
    d.hintIndex = startIndex;
    d.lastU = startIndex / tr.samples.length;
    d.nitro = 100; d.armor = 100; d.camSnap = true;
    d._assist.brake = 0; d._assist.cut = 0;
    d._wallSteer = 0;
    d.keys.forward = false; d.keys.back = false;
    d.input.throttle = 0; d.input.steer = 0; d.input.brake = 0;
  };

  /* ---- full-throttle autopilot, 45 s per assist mode ---- */
  const runAssist = (mode) => {
    reset();
    d.assist.mode = mode;
    let brakeT = 0, contactT = 0, hits = 0, wasContact = false;
    let minS = 1e9, maxS = 0, maxSlip = 0, peakBrake = 0, minTight = 1e9;
    for (let i = 0; i < 45 * 60; i++) {
      const speed = Math.abs(d._vLong);
      const i2 = (d.hintIndex + Math.round((14 + speed * 0.3) / ds)) % tr.samples.length;
      const p = tr.samples[i2].pos;
      let err = Math.atan2(p.x - d.car.position.x, p.z - d.car.position.z) - d.yaw;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      d.input.steer = Math.max(-1, Math.min(1, err * 2.4));
      d.input.throttle = 1;
      d.keys.forward = true;
      tr.update(dt);
      d.update(dt);
      const sp = Math.abs(d._vLong) * 3.6;
      if (i > 120) { minS = Math.min(minS, sp); maxS = Math.max(maxS, sp); }
      // the 45 m hairpin near u=0.318: the corner the apex margin is pinned on
      if (d.lastU > 0.29 && d.lastU < 0.37) minTight = Math.min(minTight, sp);
      const b = mode === 'off' ? 0 : d._assist.brake;
      if (b > 0.04) brakeT += dt;
      peakBrake = Math.max(peakBrake, b);
      const contact = Math.abs(lateralOf()) >= hw - 0.05;
      if (contact) contactT += dt;
      if (contact && !wasContact) hits += 1;
      wasContact = contact;
      maxSlip = Math.max(maxSlip, Math.abs(slipNow()) * 57.2958);
    }
    return {
      brakeS: +brakeT.toFixed(2),
      peakBrake: +peakBrake.toFixed(2),
      contactS: +contactT.toFixed(2),
      hits,
      minKmh: Math.round(minS),
      hairpinKmh: Math.round(minTight),
      maxKmh: Math.round(maxS),
      slipDeg: Math.round(maxSlip),
    };
  };

  const assist = {};
  for (const mode of ['off', 'low', 'high']) assist[mode] = runAssist(mode);

  /* ---- drift smoke: the pool must fill while sliding and drain after ---- */
  reset();
  d.assist.mode = 'off';
  d.keys.forward = true; d.input.throttle = 1;
  for (let i = 0; i < 240; i++) { tr.update(dt); d.update(dt); }
  const preSpeed = Math.round(Math.abs(d._vLong) * 3.6);
  d.keys.back = true; d.input.brake = 1; d.input.steer = 0.55;
  let peakSlip = 0, maxPuffs = 0;
  for (let i = 0; i < 45; i++) {
    tr.update(dt); d.update(dt);
    peakSlip = Math.max(peakSlip, Math.abs(slipNow()) * 57.2958);
    maxPuffs = Math.max(maxPuffs, d.puffMesh.count);
  }
  const driftSpeed = Math.round(Math.abs(d._vLong) * 3.6);
  d.keys.back = false; d.input.brake = 0; d.input.steer = 0;
  d.velocity.set(0, 0, 0);
  for (let i = 0; i < 120; i++) { tr.update(dt); d.update(dt); }
  const afterPuffs = d.puffMesh.count;
  const afterVisible = d.puffMesh.visible;

  /* ---- the four camera rigs, measured at rest ---- */
  const cameras = {};
  for (const mode of ['chase', 'hood', 'cockpit', 'overview']) {
    reset();
    d.setCameraMode(mode);
    for (let i = 0; i < 60; i++) { tr.update(dt); d.update(dt); }
    const c = DR.camera;
    cameras[mode] = {
      horiz: +Math.hypot(c.pos[0] - d.position.x, c.pos[2] - d.position.z).toFixed(2),
      height: +(c.pos[1] - d.position.y).toFixed(2),
      near: c.near,
      far: c.far,
      fov: +c.fov.toFixed(1),
    };
  }
  d.setCameraMode('chase');
  d.keys.forward = false; d.keys.back = false;
  d.input.throttle = 0; d.input.steer = 0; d.input.brake = 0;

  return {
    assist,
    drift: { preSpeed, driftSpeed, peakSlipDeg: Math.round(peakSlip), maxPuffs, afterPuffs, afterVisible },
    cameras,
  };
})()`;

/* ------------------------------------------------------------- comparison */

function flatten(value, path = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  } else {
    out[path] = value;
  }
  return out;
}

function compare(expected, actual) {
  const want = flatten(expected);
  const got = flatten(actual);
  const rows = [];
  for (const [key, target] of Object.entries(want)) {
    if (key.startsWith('meta.')) continue;
    const field = key.split('.').pop();
    const tol = TOLERANCE[field] ?? 0;
    const value = got[key];
    const ok = typeof target === 'number' && typeof value === 'number'
      ? Math.abs(value - target) <= tol
      : value === target;
    rows.push({ key, target, value, tol, ok });
  }
  const missing = Object.keys(got).filter((k) => !(k in want));
  return { rows, missing, ok: rows.every((r) => r.ok) };
}

/* -------------------------------------------------------------------- main */

async function main() {
  // a fresh profile per run: a leftover one from a killed browser would make
  // Chrome refuse to start, and Windows keeps the lock file busy for a moment
  const profile = await mkdtemp(join(tmpdir(), 'deathrace-verify-'));

  const { server, origin } = await startServer();
  let chrome = null;
  let ws = null;
  try {
    const launched = await launch(profile);
    chrome = launched.chrome;
    const conn = await connect(launched.port, origin);
    ws = conn.ws;

    const actual = await conn.evaluate(SCENARIOS);
    if (conn.errors.length) {
      console.log(`\nconsole errors:\n  ${conn.errors.join('\n  ')}`);
    }

    if (UPDATE || !existsSync(BASELINE)) {
      const record = {
        meta: {
          note: 'Recorded by tools/verify/run.mjs. Re-record with --update after intentional tuning.',
          viewport: VIEWPORT,
          track: TRACK,
          recorded: new Date().toISOString().slice(0, 10),
        },
        ...actual,
      };
      await writeFile(BASELINE, `${JSON.stringify(record, null, 2)}\n`);
      console.log(`\nbaseline written to ${BASELINE}`);
      console.log(JSON.stringify(actual, null, 2));
      return 0;
    }

    const expected = JSON.parse(await readFile(BASELINE, 'utf8'));
    const { rows, missing, ok } = compare(expected, actual);

    console.log('\nDEATH RACE 3D — physics baseline\n');
    for (const r of rows) {
      if (!VERBOSE && r.ok) continue;
      const mark = r.ok ? 'ok  ' : 'FAIL';
      console.log(`  ${mark} ${r.key.padEnd(28)} ${String(r.value).padStart(9)}`
        + `   baseline ${String(r.target).padStart(9)}`
        + (r.tol ? ` ±${r.tol}` : ''));
    }
    if (missing.length) {
      console.log(`\n  new measurements not in the baseline: ${missing.join(', ')}`);
    }
    const failed = rows.filter((r) => !r.ok);

    if (ok && !missing.length) {
      console.log(`\n  ${rows.length} measurements match. All good.\n`);
      return 0;
    }
    console.log(`\n  ${failed.length} of ${rows.length} measurements are outside tolerance.`);
    console.log('  If the change was intentional, re-record with --update.\n');
    return 1;
  } finally {
    try { ws?.close(); } catch { /* already closed */ }
    try { chrome?.kill(); } catch { /* already gone */ }
    server.close();
    // the browser lets go of its profile a beat after the process dies, and a
    // failed cleanup must never be mistaken for a failed comparison
    for (let i = 0; i < 6; i++) {
      await sleep(250);
      try { await rm(profile, { recursive: true, force: true }); break; } catch { /* still held */ }
    }
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`\nverify failed: ${err.message}\n`);
  process.exit(1);
});
