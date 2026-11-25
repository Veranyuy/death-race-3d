import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { DRACOLoader } from './vendor/draco/DRACOLoader.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

/* =========================================================================
   APEX ARMED — vehicle model loader

   One downloaded .glb per roster entry. Everything that makes an arbitrary
   Sketchfab export drivable lives here: the file is fetched once, measured,
   turned nose-forward, scaled to the car footprint, dropped so its tyres touch
   y = 0 and, if it is heavier than the phone can afford, collapsed.

   SIZE GATE: every vehicle file is capped at MAX_MODEL_BYTES (3 MB) and the
   cap is enforced on the download, before a byte is decoded. An oversized
   export is rejected with its real size in the error, so the car falls back to
   its procedural body instead of quietly shipping 20 MB of geometry. A
   hardpoint gun is a second, much smaller download with a gate of its own
   (MAX_WEAPON_BYTES, 1 MB), mounted by `mountWeapon` onto the body it is
   measured against.

   COMPRESSION: a Draco-compressed .glb is decoded with the vendored decoder
   (js/vendor/draco), which is what lets a 540 KB export carry a whole car. The
   decoder is only fetched when a file actually uses KHR_draco_mesh_compression,
   so the uncompressed cars cost nothing extra.

   `template` is the measured original and is never added to a scene. Two mounts
   read it: `instantiate` clones it for the player, and `rivalBatches` merges it
   per material for the six AI seats. Both come from the same cache, so changing
   car or reshuffling the grid costs no network and no second decode.
   ========================================================================= */

/* Footprint the procedural chassis uses, so a real model lines up with the
   cameras, the wall limits and the rivals' lanes without retuning any of it. */
const LENGTH = 4.6;      // m, ~ the box chassis' 4.5 plus the splitter
const WIDTH = 2.1;       // m
/* `scene.environment` is a real probe (built in js/main.js), so metal has
   something to reflect and can run near its authored value: chrome rims, gun
   steel and glass read as surfaces instead of black patches. */
const MAX_METALNESS = 0.9;
/* Anisotropy ceiling for every texture this loader touches. js/main.js pushes
   the renderer's own limit in here at boot; 4 is the floor before that lands. */
let maxAniso = 4;
/* HARD LIMIT on one vehicle download. This is the one rule the roster cannot
   grow past: a phone on mobile data cannot pay 20 MB for a car, and a heavy
   file makes the garage wait on art it will decimate anyway. Checked against
   Content-Length before the body is read, and against the received bytes for
   responses that do not declare a length. */
const MAX_MODEL_BYTES = 3 * 1024 * 1024;
/* Per-model triangle budget for a RIVAL body. Six bodies are on screen at once
   and one download arrives at 290k triangles, which no phone GPU pushes at 60
   FPS. Anything over this is collapsed onto a coarser grid at load time, so the
   cost of a car is a property of the loader rather than a per-file surprise. */
const MAX_TRIS = 40000;
/* The player's car is one body, not six, and it is the only one whose livery is
   read from a metre away in the garage. Clustering SABRE's 290k triangles down
   to 40k is a 9x cut, and that is what dragged its stripes into smears: at this
   budget the merge cell is nearly twice as fine and the markings keep an edge. */
export const PLAYER_TRIS = 90000;
/* HARD LIMIT on one weapon download: 1 MB. A gun is a receiver, a barrel and a
   mount; anything past this is textures nobody can read at the size it is
   drawn. Enforced before decode, like the vehicle gate, so an oversized gun
   leaves its hardpoint empty instead of hitching a whole car. */
const MAX_WEAPON_BYTES = 1024 * 1024;
/* A gun is drawn at a tenth of the size of the car it rides, so it gets a tenth
   of the triangles. */
const MAX_WEAPON_TRIS = 8000;
/* Meshes under this keep their own triangles. A lamp lens or a grille is where
   the identity of a car lives and it is a rounding error in the total, so
   decimating it only makes the model look broken. */
const KEEP_TRIS = 300;
/* Longest side of a rival's albedo, in texels. A rival is a couple of hundred
   pixels wide on a phone, so a 1k map is memory spent on nothing: this keeps
   the paint, the rust and the markings and drops the rest. */
const RIVAL_TEX = 512;

/* Every wheel in this lineup is named for it — wheel_BL, 3DWheel Front L,
   rims_wheelFR — but the name is only a hint on these exports: a wheel can be
   one node per corner, four sibling meshes per corner (tyre, rim, brake disc)
   or one node carrying both axles, and the steering wheel in the cabin is
   named "wheel" too. So the name picks the candidates and the geometry decides
   (see wheelCandidate and rigWheels). */
const WHEEL_NAME = /wheel/i;
/* Parts that sit at a hub but are bolted to the upright, plus the steering
   wheel at the other end of the car: none of them turn with the tyre. */
const NOT_WHEEL = /steer|calip|disc|axle/i;
/* Meshes that are part of a wheel when the export kept no wheel nodes at all:
   the tyre, the rim and the brake disc. A caliper is bolted to the upright, so
   it is left out and stays still under a turning wheel. */
const BAKED_WHEEL = /tyre|tire|rim|wheel|brake|disc/i;
const NOT_SPIN = /calip|steer|chassis|body|badge|glass|light|plate|seat|window/i;

/* Draco meshes are decoded off the main thread by the vendored decoder, which
   DRACOLoader fetches on first use only. The path is resolved from this module
   rather than the page, so it works from any route the game is served at. */
const draco = new DRACOLoader();
draco.setDecoderPath(new URL('./vendor/draco/', import.meta.url).href);

const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
const cache = new Map();      // url -> Promise<entry>
const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _rel = new THREE.Matrix4();

const _vec = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/* Wheel re-hanging reuses these instead of allocating per wheel. */
const _axleDir = new THREE.Vector3();
const _invWorld = new THREE.Matrix4();
const _rot3 = new THREE.Matrix3();

/** One of the template's own axes, expressed in `parent`'s space: x is the
    car's lateral, y its up, z its forward. Directions only — the loader scales
    uniformly, so the basis is all that has to be carried across. */
function axisIn(parent, x, y, z) {
  _rot3.setFromMatrix4(_invWorld.copy(parent.matrixWorld).invert());
  return new THREE.Vector3(x, y, z).applyMatrix3(_rot3).normalize();
}

/** Where a wheel part actually sits, and whether it is one at all.

    A tyre is a disc lying on the car's lateral axis: round in the up/forward
    plane, thin across, and down by the road at a corner of the body. The name
    narrows the search and this decides — which is what keeps the cabin's
    steering wheel, a brake disc or a bonnet vent out of the list, and what
    finds the four wheels on an export that names every tyre, rim and caliper
    separately. A node carrying both axles fails the width test, so its own
    children (the real wheels) become the candidates instead. */
function wheelCandidate(node, body, bodySize) {
  if (!node.name || !WHEEL_NAME.test(node.name) || NOT_WHEEL.test(node.name)) return null;
  const box = new THREE.Box3().setFromObject(node);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const diameter = Math.max(size.y, size.z);
  // an axle set spans both sides: its own children are the wheels
  if (size.x > bodySize.x * 0.5) return null;
  if (diameter < 0.12 || diameter > 1.4) return null;
  // not round in the vertical/forward plane, or as wide as it is round
  if (size.y < diameter * 0.55 || size.z < diameter * 0.55) return null;
  if (size.x > diameter * 0.9) return null;
  // not down by the road, or not out at a corner
  if (centre.y > body.min.y + bodySize.y * 0.62) return null;
  if (Math.abs(centre.x) < bodySize.x * 0.08) return null;
  return { node, box, centre, radius: diameter / 2 };
}

/** Puts one wheel part on a pivot at its tyre's centre, turning about the car's
    own axes, and returns the pivot.

    Two things a Sketchfab export gets wrong on its own. A wheel's node origin
    is wherever the artist left it — a whole axle is often one node parked at
    the car's centre — so rotating that node swings the tyres around the car
    instead of around their hub. And the export is usually Z-up: the wheel's
    spin axis ends up as the node's own x, which after the file's own
    orientation is the car's LENGTH, so the tyres tumble like propellers. The
    pivot solves both: it sits on the tyre, spins about the lateral axis and
    steers about the up axis, and whatever angle the export already had its
    wheels turned to is taken back out so a straight car has straight wheels. */
function rehangWheel(node, index, centre, radius) {
  const parent = node.parent;
  if (!parent) return null;
  const spin = axisIn(parent, 1, 0, 0);
  const up = axisIn(parent, 0, 1, 0);
  const fwd = axisIn(parent, 0, 0, 1);

  /* One of the node's own axes is the axle: the one pointing most nearly
     sideways. If it is not exactly sideways the export was saved with the
     wheels already turned, and that angle is what has to come back out. */
  let yaw = 0;
  let best = 0.3;
  for (let a = 0; a < 3; a++) {
    _axleDir.set(a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0).applyQuaternion(node.quaternion);
    const along = Math.abs(_axleDir.dot(spin));
    if (along < best) continue;
    best = along;
    // the same axle either way round; measure it as if it pointed sideways
    if (_axleDir.dot(spin) < 0) _axleDir.negate();
    yaw = Math.atan2(_axleDir.dot(fwd), _axleDir.dot(spin));
  }

  const local = parent.worldToLocal(centre.clone());
  const pivot = new THREE.Group();
  pivot.name = `${node.name || 'wheel'}:axle`;
  pivot.position.copy(local);
  /* re-parent without moving anything: the pivot takes the node's place in the
     hierarchy and the node keeps its own pose. Only the part's offset from the
     hub turns with the pivot, so cancelling a baked-in steering angle can
     never swing the tyre off its own centre. */
  const offset = node.position.clone().sub(local);
  if (yaw) offset.applyAxisAngle(up, yaw);
  node.position.copy(offset);
  parent.add(pivot);
  pivot.add(node);
  if (yaw) pivot.quaternion.setFromAxisAngle(up, yaw);

  pivot.userData.wheel = index;
  // plain arrays: a clone copies userData through JSON, so a Vector3 would
  // come back as a bare {x,y,z} and the mount could not read it
  pivot.userData.spin = [spin.x, spin.y, spin.z];
  pivot.userData.up = [up.x, up.y, up.z];
  pivot.userData.radius = radius;
  return pivot;
}

/** Last resort for an export with no wheel nodes at all — the police car keeps
    all four tyres, all four rims and all four discs in one mesh each. The
    triangles of those meshes are split by corner of the body, and each corner
    gets the same pivot a named wheel would: the geometry is untouched (the
    split meshes share their source attributes and only carry a new index), so
    this costs one draw call per corner part instead of a rebuild. */
function splitBakedWheels(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && BAKED_WHEEL.test(o.name) && !NOT_SPIN.test(o.name)) meshes.push(o);
  });
  if (!meshes.length) return [];

  const buckets = new Map();
  const boxes = new Map();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _mid = new THREE.Vector3();
  const _world = new THREE.Matrix4();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    if (!pos) continue;
    mesh.updateMatrixWorld(true);
    _world.copy(mesh.matrixWorld);
    const index = g.index ? g.index.array : null;
    const total = index ? index.length : pos.count;
    for (let i = 0; i + 2 < total; i += 3) {
      const ia = index ? index[i] : i;
      const ib = index ? index[i + 1] : i + 1;
      const ic = index ? index[i + 2] : i + 2;
      _a.fromBufferAttribute(pos, ia).applyMatrix4(_world);
      _b.fromBufferAttribute(pos, ib).applyMatrix4(_world);
      _c.fromBufferAttribute(pos, ic).applyMatrix4(_world);
      _mid.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3);
      // the body is centred on the origin by now, so the signs are the corners
      const key = `${_mid.x > 0 ? 'R' : 'L'}${_mid.z > 0 ? 'F' : 'B'}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        buckets.set(key, bucket = new Map());
        boxes.set(key, new THREE.Box3());
      }
      let idx = bucket.get(mesh);
      if (!idx) bucket.set(mesh, idx = []);
      idx.push(ia, ib, ic);
      boxes.get(key).expandByPoint(_a).expandByPoint(_b).expandByPoint(_c);
    }
  }
  if (buckets.size < 2) return [];

  const wheels = [];
  const sources = new Set();
  for (const key of [...buckets.keys()].sort()) {
    const bucket = buckets.get(key);
    const box = boxes.get(key);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.y, size.z) / 2;
    if (!(radius > 0.05)) continue;
    const pivots = [];
    for (const [mesh, idx] of bucket) {
      const geo = new THREE.BufferGeometry();
      // attributes are shared with the source mesh; only the index is new
      for (const name of Object.keys(mesh.geometry.attributes)) {
        geo.setAttribute(name, mesh.geometry.attributes[name]);
      }
      geo.setIndex(idx);
      const part = new THREE.Mesh(geo, mesh.material);
      part.name = `${mesh.name}:${key}`;
      part.castShadow = false;
      part.receiveShadow = true;
      part.frustumCulled = false;
      part.position.copy(mesh.position);
      part.quaternion.copy(mesh.quaternion);
      part.scale.copy(mesh.scale);
      const parent = mesh.parent;
      const local = parent.worldToLocal(centre.clone());
      const pivot = new THREE.Group();
      pivot.name = `${mesh.name}:${key}:axle`;
      pivot.position.copy(local);
      part.position.sub(local);
      parent.add(pivot);
      pivot.add(part);
      pivot.userData.wheel = wheels.length;
      // the source mesh can live under the export's own Z-up rotation, so the
      // two axes are resolved in its parent rather than assumed
      pivot.userData.spin = axisIn(parent, 1, 0, 0).toArray();
      pivot.userData.up = axisIn(parent, 0, 1, 0).toArray();
      pivot.userData.radius = radius;
      pivots.push(pivot);
      sources.add(mesh);
    }
    if (!pivots.length) continue;
    wheels.push({ z: centre.z, radius, pivots });
  }
  // one source mesh feeds all four corners, so it is dropped only once every
  // split copy has been made from it
  for (const mesh of sources) mesh.parent?.remove(mesh);
  root.updateMatrixWorld(true);
  return wheels;
}

/** Groups the model's wheel parts by corner and hangs each corner on its own
    pivot. Returns one entry per corner: where the tyre sits along the car's
    length and how big it is. */
function rigWheels(root) {
  root.updateMatrixWorld(true);
  const body = new THREE.Box3().setFromObject(root);
  const bodySize = body.getSize(new THREE.Vector3());
  const candidates = [];
  root.traverse((node) => {
    const c = wheelCandidate(node, body, bodySize);
    if (c) candidates.push(c);
  });
  if (!candidates.length) return splitBakedWheels(root);

  /* One corner can be four sibling meshes (tyre, rim, disc, caliper) or one
     node with the whole wheel under it, so parts are collected per corner of
     the body rather than per name. */
  const corners = new Map();
  for (const c of candidates) {
    const key = `${c.centre.x > 0 ? 'R' : 'L'}${c.centre.z > 0 ? 'F' : 'B'}`;
    let corner = corners.get(key);
    if (!corner) corners.set(key, corner = { parts: [], box: new THREE.Box3() });
    corner.parts.push(c);
    corner.box.union(c.box);
  }

  const wheels = [];
  for (const key of [...corners.keys()].sort()) {
    const corner = corners.get(key);
    const centre = corner.box.getCenter(new THREE.Vector3());
    const size = corner.box.getSize(new THREE.Vector3());
    // the corner's own diameter, so the spin rate follows this tyre's size
    const radius = Math.max(size.y, size.z) / 2;
    const pivots = [];
    for (const c of corner.parts) {
      // a part already carried by another pivot in this corner would be
      // rotated twice, so only the outermost node of each chain is re-hung
      let nested = false;
      for (let p = c.node.parent; p && p !== root; p = p.parent) {
        if (corner.parts.some((o) => o.node === p)) { nested = true; break; }
      }
      if (nested) continue;
      const pivot = rehangWheel(c.node, wheels.length, centre, radius);
      if (pivot) pivots.push(pivot);
    }
    if (!pivots.length) continue;
    wheels.push({ z: centre.z, radius: Math.max(radius, 0.05), pivots });
  }
  return wheels;
}

/** Where the body actually points and how big it really is. A bounding box
    is not enough: a cannon, aerial or spoiler stretches one axis, and some
    exports are not even square to their own axes. So: sample the whole model,
    take the principal horizontal axis as the car's length, and measure both
    axes between the 1st and 99th percentile — the few outliers that are a
    barrel or a wing then stop defining the car. */
const SAMPLES = 6000;
function measure(model) {
  const meshes = [];
  let verts = 0;
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const p = o.geometry.getAttribute('position');
    if (!p) return;
    meshes.push({ o, p });
    verts += p.count;
  });
  const fallback = { yaw: 0, length: 0, width: 0, cx: 0, cz: 0 };
  if (!meshes.length || verts < 3) return fallback;

  const stride = Math.max(1, Math.floor(verts / SAMPLES));
  const xs = [];
  const zs = [];
  let sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0;
  for (const { o, p } of meshes) {
    for (let i = 0; i < p.count; i += stride) {
      _vec.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      xs.push(_vec.x);
      zs.push(_vec.z);
      sx += _vec.x; sz += _vec.z;
      sxx += _vec.x * _vec.x; szz += _vec.z * _vec.z; sxz += _vec.x * _vec.z;
    }
  }
  const n = xs.length;
  if (n < 3) return fallback;
  const mx = sx / n;
  const mz = sz / n;
  const cxx = sxx / n - mx * mx;
  const czz = szz / n - mz * mz;
  const cxz = sxz / n - mx * mz;
  // principal axis, measured from +x. A rotation of phi about y moves a
  // direction from theta to theta - phi, so putting the axis on +z is phi =
  // theta - 90 degrees.
  const theta = 0.5 * Math.atan2(2 * cxz, cxx - czz);
  let yaw = theta - Math.PI / 2;
  /* The axis has no sign: theta and theta + 180 describe the same car. Take
     whichever is the smaller turn, so a model that already points down +z is
     left exactly as the artist exported it, and only a diagonal or sideways
     export gets rotated. A wrong-way nose is the one thing geometry cannot
     tell us, so that stays a per-car `modelFlip` in the manifest. */
  yaw = ((yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  if (yaw > Math.PI / 2) yaw -= Math.PI;
  else if (yaw < -Math.PI / 2) yaw += Math.PI;

  // project on the length (u) and width (v) axes and trim the tails
  const ux = Math.cos(theta), uz = Math.sin(theta);
  const vx = -uz, vz = ux;
  const along = new Float32Array(n);
  const across = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    along[i] = xs[i] * ux + zs[i] * uz;
    across[i] = xs[i] * vx + zs[i] * vz;
  }
  const span = (arr) => {
    const s = Array.from(arr).sort((a, b) => a - b);
    const lo = s[Math.floor(s.length * 0.01)];
    const hi = s[Math.floor(s.length * 0.99)];
    return { lo, hi, mid: (lo + hi) / 2, size: hi - lo };
  };
  const L = span(along);
  const W = span(across);
  return {
    yaw,
    length: L.size,
    width: W.size,
    // body centre in the model's own space, so the cannon's weight does not
    // drag the car off its grid slot
    cx: ux * L.mid + vx * W.mid,
    cz: uz * L.mid + vz * W.mid,
  };
}

/* -------------------------------------------------------------------------
   Triangle budget

   A download is as heavy as its author felt like exporting — the SABRE's file
   arrives at 290k triangles for one car, more than the entire rest of the
   scene. So rather
   than hand-pick lighter files, anything over MAX_TRIS is collapsed with vertex
   clustering: snap every vertex onto a grid, merge the ones that land in the
   same cell, drop the triangles that degenerate. That is O(vertices), needs no
   topology the exporter may not have kept, and survives the non-manifold game
   art an edge-collapse simplifier tends to tear holes in.
   ---------------------------------------------------------------------- */

const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _av = new THREE.Vector3();

/** Triangles in one geometry. */
function triCount(g) {
  return Math.round((g.index ? g.index.count : g.getAttribute('position').count) / 3);
}

/** Total surface area, which is what picks the first grid size. */
function surfaceArea(pos, index) {
  const n = index ? index.length : pos.count;
  let area = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = index ? index[i] : i;
    _av.fromBufferAttribute(pos, a);
    _ab.fromBufferAttribute(pos, index ? index[i + 1] : i + 1).sub(_av);
    _ac.fromBufferAttribute(pos, index ? index[i + 2] : i + 2).sub(_av);
    area += _ab.cross(_ac).length();
  }
  return area * 0.5;
}

/** One clustering pass at cell size `h`. Positions and UVs average within a
    cell, so a decal or a panel line survives as a blended patch instead of
    snapping to one vertex's sample. */
function collapse(geometry, h) {
  const pos = geometry.getAttribute('position');
  const index = geometry.index;
  const src = index ? index.array : null;
  const total = index ? index.count : pos.count;
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');

  /* Spatial hash -> the clusters in that cell. Each cluster also keeps its own
     integer cell key, so two distant cells that happen to hash alike are never
     merged. */
  const buckets = new Map();
  const kx = [];
  const ky = [];
  const kz = [];
  const nx = [];
  const ny = [];
  const nz = [];
  const px = [];
  const py = [];
  const pz = [];
  const hits = [];
  const clusterOf = new Int32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const qx = Math.floor(x / h);
    const qy = Math.floor(y / h);
    const qz = Math.floor(z / h);
    /* A crease is not a place to merge. Two vertices can share a cell on
       opposite sides of a hard edge — a bonnet shut line, a spoiler lip — and
       averaging them rounds the edge into a smear. Bucketing the normal as
       well keeps those pairs apart, so panel edges survive the collapse. */
    const qnx = normal ? Math.round(normal.getX(i)) : 0;
    const qny = normal ? Math.round(normal.getY(i)) : 0;
    const qnz = normal ? Math.round(normal.getZ(i)) : 0;
    const hash = ((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791)
      ^ (qnx * 374761393) ^ (qny * 668265263) ^ (qnz * 1274126177)) | 0;
    let bucket = buckets.get(hash);
    let id = -1;
    if (bucket) {
      for (let j = 0; j < bucket.length; j++) {
        const cand = bucket[j];
        if (kx[cand] === qx && ky[cand] === qy && kz[cand] === qz
          && nx[cand] === qnx && ny[cand] === qny && nz[cand] === qnz) { id = cand; break; }
      }
    } else {
      bucket = [];
      buckets.set(hash, bucket);
    }
    if (id < 0) {
      id = px.length;
      kx.push(qx); ky.push(qy); kz.push(qz);
      nx.push(qnx); ny.push(qny); nz.push(qnz);
      px.push(0); py.push(0); pz.push(0);
      hits.push(0);
      bucket.push(id);
    }
    clusterOf[i] = id;
    px[id] += x; py[id] += y; pz[id] += z;
    hits[id] += 1;
  }

  // every face that still spans three cells survives; the rest are slivers
  const tris = [];
  for (let i = 0; i + 2 < total; i += 3) {
    const a = clusterOf[src ? src[i] : i];
    const b = clusterOf[src ? src[i + 1] : i + 1];
    const c = clusterOf[src ? src[i + 2] : i + 2];
    if (a === b || b === c || a === c) continue;
    tris.push(a, b, c);
  }

  if (tris.length < 3) return null;
  const count = px.length;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const m = hits[i] || 1;
    positions[i * 3] = px[i] / m;
    positions[i * 3 + 1] = py[i] / m;
    positions[i * 3 + 2] = pz[i] / m;
  }

  /* UVs are deliberately NOT averaged. A cell that straddles a UV seam — the
     edge of a decal, or a panel that carries its own unwrap — would blend two
     unrelated texels into one and drag the marking across the bodywork. Each
     cluster takes the UV of the vertex nearest its own centroid instead, which
     is a real sample of the surface it stands in for. */
  let uvs = null;
  if (uv) {
    uvs = new Float32Array(count * 2);
    const best = new Float32Array(count).fill(Infinity);
    for (let i = 0; i < pos.count; i++) {
      const id = clusterOf[i];
      const dx = pos.getX(i) - positions[id * 3];
      const dy = pos.getY(i) - positions[id * 3 + 1];
      const dz = pos.getZ(i) - positions[id * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d >= best[id]) continue;
      best[id] = d;
      uvs[id * 2] = uv.getX(i);
      uvs[id * 2 + 1] = uv.getY(i);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  // setIndex picks the narrowest index type this vertex count allows
  out.setIndex(tris);
  // clustering merges across every crease on the car, so the authored split
  // normals no longer describe the surface: rebuild them for this topology
  out.computeVertexNormals();
  return out;
}

/** Collapses one geometry down to `budget` triangles. The first cell size comes
    straight from the surface area — a cell of side h carries about 2A/h² faces
    — then one correction pass while the result is still over. */
function simplify(geometry, budget) {
  const before = triCount(geometry);
  if (before <= budget) return geometry;
  const area = surfaceArea(
    geometry.getAttribute('position'),
    geometry.index ? geometry.index.array : null
  );
  if (!(area > 0)) return geometry;
  let h = Math.sqrt((2 * area) / budget);
  let out = null;
  // the normal buckets keep creases apart, so a pass cannot merge as much as a
  // plain spatial cluster: the correction loop gets a few more tries to land
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = collapse(geometry, h);
    if (!next) return geometry;
    if (out) out.dispose();
    out = next;
    const got = triCount(out);
    if (got <= budget * 1.1) break;
    h *= Math.sqrt(got / budget);
  }
  // a cell too coarse can leave fewer faces than a cell too fine is worth: if
  // the collapse did not actually help, the original stays
  if (triCount(out) >= before) {
    out.dispose();
    return geometry;
  }
  return out;
}

/* The map slots a car material can carry. */
const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];

/** Pushes every map on a material to the renderer's anisotropy limit. glTF
    textures arrive at 1, which is exactly the setting that turns a livery
    stripe into a blurred smear as soon as the panel turns away from the lens —
    the garage turntable and the chase cam are both that angle. */
function sharpenTextures(m) {
  for (const key of TEXTURE_SLOTS) {
    const t = m[key];
    if (!t || t.anisotropy === maxAniso) continue;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
  }
}

/** Called once from js/main.js with renderer.capabilities.getMaxAnisotropy(). */
export function setMaxAnisotropy(n) {
  maxAniso = Math.max(1, Math.min(8, n | 0));
}

function prepare(gltf, url, flip, budget = MAX_TRIS) {
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  /* 1. orientation and size — the body's long axis has to run along +z,
        because that is forward everywhere else in the game. `flip` is the
        manifest's answer to the one question the measurement cannot: which
        end of that axis is the nose. It is folded into the yaw here, in the
        template both mounts draw, so a left-right reversed body can never
        reach the track facing the wrong way. */
  const body = measure(model);
  const yaw = body.yaw + (flip ? Math.PI : 0);

  const template = new THREE.Group();
  template.name = `model-${url.split('/').pop()}`;
  const pivot = new THREE.Group();
  pivot.rotation.y = yaw;
  pivot.add(model);
  template.add(pivot);

  /* 2. scale — fit the body inside the footprint, whichever limit bites
        first. Protrusions (cannon, aerial, wing) no longer shrink the car. */
  const scale = Math.min(
    LENGTH / Math.max(body.length, 1e-3),
    WIDTH / Math.max(body.width, 1e-3)
  );
  pivot.scale.setScalar(scale);

  /* 3. ground contact — centre the body on the car's origin and sit the
        lowest tyre on y = 0, so chassis roll/pitch pivots about the right spot
        and the shell never sinks into the road. */
  template.updateMatrixWorld(true);
  _box.setFromObject(template);
  // the body centre as the turn leaves it: a half turn puts it on the other
  // side of the origin, so the offset cannot be applied before the rotation
  _vec.set(body.cx, 0, body.cz).applyAxisAngle(_up, yaw);
  // lowest tyre, protrusions included
  pivot.position.set(-_vec.x * scale, -_box.min.y, -_vec.z * scale);

  /* 4. one pass over the body: collect the meshes, count what the file costs,
        and make each of them cheap to draw — no shadow casting (six rivals
        would otherwise redraw the shadow map), no culling (a car is one object
        from tip to tip) and no metal, which has nothing to reflect here. */
  const meshes = [];
  let rawTris = 0;
  const seen = new Set();
  template.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    rawTris += triCount(o.geometry);
    o.castShadow = false;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const m = o.material;
    if (seen.has(m)) return;
    seen.add(m);
    if (m.metalness > MAX_METALNESS) m.metalness = MAX_METALNESS;
    // the probe is the whole point of raising the metal cap: a car with
    // envMapIntensity 0 is flat paint with a black rim. A quarter over unity is
    // what makes the horizon band read down a shoulder line.
    if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.25;
    sharpenTextures(m);
  });

  /* 5. triangle budget — collapse every mesh that is over its share. Both
        mounts read this template, so the player's car and the rivals' bodies
        are reduced together and nothing can put the raw count back later. */
  if (rawTris > budget) {
    const k = budget / rawTris;
    const done = new Map();     // geometry -> its reduced copy, shared not redone
    const replaced = [];
    for (const o of meshes) {
      let next = done.get(o.geometry);
      if (next === undefined) {
        const t = triCount(o.geometry);
        // proportional share, but a small mesh is never ground below the
        // detail floor: a lamp lens costs nothing and reads as everything
        next = simplify(o.geometry, Math.min(t, Math.max(KEEP_TRIS, Math.round(t * k))));
        done.set(o.geometry, next);
        if (next !== o.geometry) replaced.push(o.geometry);
      }
      o.geometry = next;
    }
    // the raw buffers were measured but never rendered, so drop them once no
    // surviving mesh still points at them
    for (const g of replaced) {
      if (!meshes.some((o) => o.geometry === g)) g.dispose();
    }
  }
  let tris = 0;
  for (const o of meshes) tris += triCount(o.geometry);

  /* 6. wheels — every corner that can be identified as a tyre is re-hung on
        its own axle pivot (see rigWheels), and the front pair is whichever
        sits ahead of the model's own centre. A model whose tyres are baked
        into one mesh simply has none and leans on the chassis roll instead. */
  const rigs = rigWheels(template);
  // the pivots were added to the tree after the last update, and both mounts
  // clone the transforms as they stand
  template.updateMatrixWorld(true);
  const axle = rigs.length
    ? rigs.reduce((a, b) => a + b.z, 0) / rigs.length
    : 0;

  return {
    template,
    wheels: rigs.map((rig) => ({ radius: rig.radius, front: rig.z > axle })),
    // what the file arrived with, and what it actually draws after the budget
    rawTris: Math.round(rawTris),
    tris: Math.round(tris),
  };
}

/** Downloads one .glb, refusing anything over MAX_MODEL_BYTES before it is
    decoded. Resolves with the parsed gltf and the size that was accepted. */
async function fetchModel(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const over = (bytes) => new Error(
    `${url} is ${(bytes / 1048576).toFixed(2)} MB — the vehicle limit is ` +
    `${MAX_MODEL_BYTES / 1048576} MB. Reduce the export before adding it.`
  );
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_MODEL_BYTES) {
    // do not even keep the body: nothing this heavy is ever decoded
    if (res.body) res.body.cancel().catch(() => {});
    throw over(declared);
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_MODEL_BYTES) throw over(buffer.byteLength);
  // the file's own folder, so an external .bin or texture beside it resolves
  const path = url.slice(0, url.lastIndexOf('/') + 1);
  return { gltf: await loader.parseAsync(buffer, path), bytes: buffer.byteLength };
}

/** Fetches (once) and measures one vehicle. Resolves with the cached entry.
    `flip` is part of the cache key: it changes the measured template, and the
    same file turned two ways is two templates. */
export function loadModel(url, flip = false, budget = MAX_TRIS) {
  // the budget is part of the key: the same file reduced for a rival and
  // reduced for the player are two templates
  const key = `${url}|${flip ? 1 : 0}|${budget}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchModel(url).then(({ gltf, bytes }) => ({ ...prepare(gltf, url, flip, budget), bytes }));
    // a failed download must not poison the cache: the next attempt retries
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

/** A mountable clone of one vehicle, with its own wheel handles. Geometries
    and materials are shared with the template, so a clone is cheap.

    A wheel is a corner, not a node: on an export that names the tyre, the rim
    and the caliper separately, one corner is several pivots that all have to
    turn together. So each entry carries its parts, each with its own base pose
    and its own two axes (a part's parent can be a different node). */
export function instantiate(entry) {
  const group = entry.template.clone(true);
  // prepare numbers the wheel corners, so these land in the same slots as
  // `entry.wheels` with no gaps
  const wheels = entry.wheels.map((w) => ({ radius: w.radius, front: w.front, parts: [] }));
  group.traverse((o) => {
    const data = o.userData;
    const index = data.wheel;
    // the clone copies userData as JSON: the index survives, the node has to be
    // re-resolved here
    if (index === undefined || !wheels[index]) return;
    wheels[index].parts.push({
      node: o,                                   // the part's axle pivot
      base: o.quaternion.clone(),                // the export's own pose
      spin: new THREE.Vector3().fromArray(data.spin),
      up: new THREE.Vector3().fromArray(data.up),
    });
  });
  return { group, wheels };
}

/* -------------------------------------------------------------------------
   Hardpoint guns

   A weapon is its own .glb with a gate of its own, and every export points a
   different way: some down -z, some down +x, some barrel-first, some
   stock-first. `prepareWeapon` normalises all of it to one convention — one
   unit long, centred on its hardpoint, sitting on y = 0, pointing down +z — so
   any gun the roster names can be dropped onto any car and read as mounted
   instead of skewered.
   ---------------------------------------------------------------------- */

const weaponCache = new Map();

/** Whether the muzzle is already at +z. A barrel is the narrow end of a gun —
    that is the only thing geometry can tell us about which end is which — so
    the thinner end of the two has to be the one pointing forward. */
function muzzleForward(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const back = box.min.z + size.z * 0.22;
  const front = box.max.z - size.z * 0.22;
  let backR = 0;
  let frontR = 0;
  const p = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    const stride = Math.max(1, Math.floor(pos.count / 1200));
    for (let i = 0; i < pos.count; i += stride) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const r = Math.hypot(p.x - mid.x, p.y - mid.y);
      if (p.z <= back) backR = Math.max(backR, r);
      else if (p.z >= front) frontR = Math.max(frontR, r);
    }
  });
  return frontR <= backR;
}

/** Turns any weapon export into a unit-length gun pointing down +z, centred on
    its mount and standing on y = 0. */
function prepareWeapon(gltf) {
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());

  const unit = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.add(model);
  unit.add(pivot);
  // the long horizontal axis goes down +z: a rotation of -90 degrees about y
  // takes +x there
  if (size.x > size.z) pivot.rotation.y = -Math.PI / 2;
  unit.updateMatrixWorld(true);
  if (!muzzleForward(unit)) {
    pivot.rotation.y += Math.PI;
    unit.updateMatrixWorld(true);
  }

  const fitted = new THREE.Box3().setFromObject(unit);
  const fittedSize = fitted.getSize(new THREE.Vector3());
  const mid = fitted.getCenter(new THREE.Vector3());
  // one unit long, centred on the hardpoint, base on y = 0
  unit.scale.setScalar(1 / Math.max(fittedSize.z, 1e-3));
  pivot.position.set(-mid.x, -fitted.min.y, -mid.z);

  let tris = 0;
  const seen = new Set();
  unit.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const m = o.material;
    if (m && !seen.has(m)) {
      seen.add(m);
      // the probe is what turns a gun from a black silhouette into steel
      if (m.metalness > MAX_METALNESS) m.metalness = MAX_METALNESS;
      if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.15;
      sharpenTextures(m);
    }
    if (triCount(o.geometry) > MAX_WEAPON_TRIS) {
      o.geometry = simplify(o.geometry, MAX_WEAPON_TRIS);
    }
    tris += triCount(o.geometry);
  });

  return { template: unit, tris: Math.round(tris) };
}

/** Downloads one weapon .glb, refusing anything over MAX_WEAPON_BYTES before
    it is decoded. */
async function fetchWeapon(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  /* A size rejection is permanent: the same bytes will be refused again, so it
     is marked and never retried. Without that, every rival seat mounting the
     same car would re-download the rejected file. */
  const over = (bytes) => {
    const err = new Error(
      `${url} is ${(bytes / 1048576).toFixed(2)} MB — the weapon limit is ` +
      `${MAX_WEAPON_BYTES / 1048576} MB. Reduce the export before adding it.`
    );
    err.permanent = true;
    return err;
  };
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_WEAPON_BYTES) {
    if (res.body) res.body.cancel().catch(() => {});
    throw over(declared);
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_WEAPON_BYTES) throw over(buffer.byteLength);
  const path = url.slice(0, url.lastIndexOf('/') + 1);
  return { gltf: await loader.parseAsync(buffer, path), bytes: buffer.byteLength };
}

/** Fetches (once) and normalises one weapon. */
export function loadWeapon(url) {
  let pending = weaponCache.get(url);
  if (!pending) {
    pending = fetchWeapon(url).then(({ gltf, bytes }) => ({ ...prepareWeapon(gltf), bytes }));
    // a failed download must not poison the cache — but an oversized file is
    // refused by the gate every time, so it is remembered instead of retried
    pending.catch((err) => { if (!err || !err.permanent) weaponCache.delete(url); });
    weaponCache.set(url, pending);
  }
  return pending;
}

/** Height of the bodywork above a hardpoint, measured from the vertices that
    are actually on screen. A roof is not a plane — it curves away from the
    centreline, and a light bar, roll hoop or wing can be the highest thing
    there — so a cannon has to be seated on the surface under it rather than on
    the model's overall bounding box, which would leave it floating over a
    sports car and buried in a coupe. */
export function surfaceY(parent, x, z, reach = 0.5) {
  parent.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const p = new THREE.Vector3();
  const hits = [];
  parent.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    const stride = Math.max(1, Math.floor(pos.count / 1200));
    for (let i = 0; i < pos.count; i += stride) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      if (Math.abs(p.x - x) > reach || Math.abs(p.z - z) > reach) continue;
      hits.push(p.y);
    }
  });
  if (!hits.length) return null;
  hits.sort((a, b) => a - b);
  // the 96th percentile: a panel gap or a stray aerial tip is not the roof
  return hits[Math.min(hits.length - 1, Math.floor(hits.length * 0.96))];
}

/** Bolts a roster entry's gun onto `parent` (the car's body group), seated on
    the bodywork above its hardpoint. Resolves null when the entry has no gun
    or the file is over the size gate, so a refused gun is a missing gun rather
    than a broken car. */
/* Dark anodised steel for every hardpoint base, so a gun is bolted to the same
   hardware whatever body it rides. */
const bracketMat = new THREE.MeshStandardMaterial({
  color: 0x15191d,
  metalness: 0.88,
  roughness: 0.33,
  envMapIntensity: 1.1,
});

/** A bolted base for a hardpoint gun: a plate bedded into the bodywork, a short
    open collar and a top ring the receiver sits inside. Two cylinders and a
    ring merged into one geometry, so the whole mount is one draw call.

    Without it a gun touches the roof on a single triangle and reads as pasted
    on; on a body whose highest point at the hardpoint is a lightbar or a glass
    panel it reads as perched on the glass. */
function buildMount(radius, height, drop) {
  const parts = [];
  /* Skirt: from the bodywork under the hardpoint up to the seat. A roof curves
     away from the centreline, and a hardpoint can sit right beside a roll hoop,
     so the seat is measured over a wider patch than the mount itself covers —
     the skirt closes that gap, which is what stops a gun hovering over its own
     roof or resting on the tip of a lightbar. */
  const skirtH = drop + 0.03;
  const skirt = new THREE.CylinderGeometry(radius * 1.05, radius * 1.58, skirtH, 14, 1, true);
  skirt.translate(0, -drop - 0.014 + skirtH / 2, 0);
  parts.push(skirt);
  const plate = new THREE.CylinderGeometry(radius * 1.58, radius * 1.72, 0.024, 14);
  plate.translate(0, -drop - 0.014, 0);
  parts.push(plate);
  const collar = new THREE.CylinderGeometry(radius, radius * 1.1, height, 14, 1, true);
  collar.translate(0, height / 2, 0);
  parts.push(collar);
  const ring = new THREE.CylinderGeometry(radius * 1.16, radius * 1.16, 0.018, 14);
  ring.translate(0, height, 0);
  parts.push(ring);
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  const mesh = new THREE.Mesh(geometry, bracketMat);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function mountWeapon(parent, def) {
  const spec = def.weapon;
  if (!spec || !spec.model) return Promise.resolve(null);
  return loadWeapon(spec.model).then((entry) => {
    const group = entry.template.clone(true);
    // the template is one unit long, so the roster's metres are the whole
    // scale: a roof turret and a hood cannon differ only by this number
    const length = spec.length || 1;
    group.scale.multiplyScalar(length);
    const x = spec.x || 0;
    const z = spec.z || 0;
    const roof = surfaceY(parent, x, z, spec.reach || 0.5);
    const seat = roof === null ? 1.2 : roof;
    // the surface directly under the mount, so the skirt can reach down to it
    const local = surfaceY(parent, x, z, 0.13);
    const drop = local === null ? 0 : THREE.MathUtils.clamp(seat - local, 0, 0.28);
    // sized off the gun it carries, so a roof turret and a hood cannon both sit
    // on a base that looks like it belongs to them
    const radius = THREE.MathUtils.clamp(length * 0.072, 0.05, 0.125);
    const height = THREE.MathUtils.clamp(length * 0.07, 0.05, 0.1);
    // the receiver stands on the collar instead of sinking into the paint
    group.position.set(x, seat + height * 0.82, z);
    group.name = `weapon-${def.id}`;
    /* The gun group is scaled to the roster's metres, so the mount cancels that
       scale to keep a real-world size and hangs below the receiver, on the
       bodywork the hardpoint was measured against. */
    const mount = buildMount(radius, height, drop);
    mount.scale.setScalar(1 / length);
    mount.position.set(0, -(height * 0.82) / length, 0);
    mount.name = `weapon-mount-${def.id}`;
    group.add(mount);
    parent.add(group);
    return group;
  }).catch((err) => {
    console.warn(`[weapon] ${def.name}: ${spec.model} — no gun mounted.`, err);
    return null;
  });
}

/* -------------------------------------------------------------------------
   Rival bodies

   A rival has to read as the actual machine — its paint, its rust, its
   markings — because six identical black blobs is what the field looked like
   before. What it does not need is the full material set: at the size the pack
   is seen, a normal map is invisible, and the six map slots a Sketchfab export
   ships cost five times the memory of the one that carries the paint. So a
   rival draws with the model's own albedo, capped at RIVAL_TEX, and nothing
   else.
   ---------------------------------------------------------------------- */

/** A copy of `tex` no larger than `max` on its longest side. Textures already
    under the cap are shared untouched; the rest are redrawn into a canvas, so
    the 1k original is never uploaded to the GPU. */
function shrinkTexture(tex, max) {
  const img = tex.image;
  if (!img || !img.width || !img.height) return tex;
  const longest = Math.max(img.width, img.height);
  if (longest <= max) return tex;
  const k = max / longest;
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const out = new THREE.CanvasTexture(canvas);
  // glTF UVs assume an unflipped image, and the paint is sRGB-encoded: both
  // have to survive the copy or the car comes out upside down and washed out
  out.flipY = tex.flipY;
  out.colorSpace = tex.colorSpace;
  out.wrapS = tex.wrapS;
  out.wrapT = tex.wrapT;
  out.anisotropy = tex.anisotropy;
  out.needsUpdate = true;
  return out;
}

/** The material a rival draws with: the file's own albedo and tint, a capped
    metalness, and none of the maps that only pay off in a showroom. */
function rivalMaterial(src) {
  const mat = new THREE.MeshStandardMaterial({
    color: src.color.clone(),
    map: src.map ? shrinkTexture(src.map, RIVAL_TEX) : null,
    metalness: Math.min(src.metalness ?? 0.2, MAX_METALNESS),
    roughness: src.roughness ?? 0.7,
    transparent: !!src.transparent,
    opacity: src.opacity ?? 1,
    side: src.side,
    depthWrite: src.depthWrite !== false,
  });
  mat.name = src.name || '';
  // a rival still catches the probe, just less of it: at pack distance a full
  // reflection term only makes the paint look wet
  mat.envMapIntensity = 0.7;
  /* A double-sided transparent material is otherwise submitted twice every
     frame (back faces, then front), which on FRANKEN is nine window materials
     paying double. A rival is only ever seen from outside, so one pass is
     both cheaper and enough. */
  if (mat.transparent) mat.forceSinglePass = true;
  return mat;
}

/** One vehicle's static meshes merged into one geometry per material, in the
    template's own space. A rival then costs one draw call per material instead
    of one per mesh — FRANKEN is 46 meshes but only 9 materials. */
const batchCache = new Map();

export function rivalBatches(url, flip = false) {
  const key = `${url}|${flip ? 1 : 0}`;
  let pending = batchCache.get(key);
  if (pending) return pending;
  pending = loadModel(url, flip).then((entry) => {
    const root = entry.template;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const byMaterial = new Map();      // source material -> its parts
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(_rel.multiplyMatrices(inv, o.matrixWorld));
      /* Every part is normalised to position + normal + uv, because
         mergeGeometries refuses a set whose attributes disagree. Those three
         are exactly what an albedo-mapped surface reads. */
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      }
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) {
        const n = g.getAttribute('position').count;
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      }
      // mergeGeometries needs all parts indexed or none, and the merged index
      // is rebuilt by setIndex, so the source index type never matters
      const count = g.getAttribute('position').count;
      if (!g.index) {
        const idx = new Uint32Array(count);
        for (let i = 0; i < count; i++) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      let parts = byMaterial.get(o.material);
      if (!parts) {
        parts = [];
        byMaterial.set(o.material, parts);
      }
      parts.push(g);
    });
    const out = [];
    for (const [src, parts] of byMaterial) {
      const geometry = mergeGeometries(parts, false);
      if (geometry) out.push({ geometry, material: rivalMaterial(src) });
    }
    return out.length ? out : null;
  });
  // a failed download must not poison the cache: the next attempt retries
  pending.catch(() => batchCache.delete(key));
  batchCache.set(key, pending);
  return pending;
}

