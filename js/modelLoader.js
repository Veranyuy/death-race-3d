import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

/* =========================================================================
   DEATH RACE 3D — vehicle model loader

   One downloaded .glb per roster entry. Everything that makes an arbitrary
   Sketchfab export drivable lives here: the file is fetched once, measured,
   turned nose-forward, scaled to the car footprint, dropped so its tyres touch
   y = 0 and, if it is heavier than the phone can afford, collapsed.

   `template` is the measured original and is never added to a scene. Two mounts
   read it: `instantiate` clones it for the player, and `rivalBatches` merges it
   per material for the six AI seats. Both come from the same cache, so changing
   car or reshuffling the grid costs no network and no second decode.
   ========================================================================= */

/* Footprint the procedural chassis uses, so a real model lines up with the
   cameras, the wall limits and the rivals' lanes without retuning any of it. */
const LENGTH = 4.6;      // m, ~ the box chassis' 4.5 plus the splitter
const WIDTH = 2.1;       // m
/* No environment map anywhere in the scene, so a metallic surface has nothing
   to reflect and only reads as black. Capping it keeps the paint visible. */
const MAX_METALNESS = 0.35;
/* Per-model triangle budget. Seven bodies are on screen at once and two of the
   downloads arrive at 205k and 582k triangles, which no phone GPU pushes at 60
   FPS. Anything over this is collapsed onto a coarser grid at load time, so the
   cost of a car is a property of the loader rather than a per-file surprise. */
const MAX_TRIS = 40000;
/* Meshes under this keep their own triangles. A lamp lens or a grille is where
   the identity of a car lives and it is a rounding error in the total, so
   decimating it only makes the model look broken. */
const KEEP_TRIS = 300;
/* Longest side of a rival's albedo, in texels. A rival is a couple of hundred
   pixels wide on a phone, so a 1k map is memory spent on nothing: this keeps
   the paint, the rust and the markings and drops the rest. */
const RIVAL_TEX = 512;

/* Every wheel node in this roster says "wheel" — WheelsFront_Color_0,
   wheel_1_m_wheel_0, Car01_WheelRearLeft_Car01_0 — so nothing else is matched. */
const WHEEL_NAME = /wheel/i;

const loader = new GLTFLoader();
const cache = new Map();      // url -> Promise<entry>
const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _rel = new THREE.Matrix4();

/** Wheel nodes worth animating: a named node whose ancestors are not also
    wheels, so a wheel and its own mesh child do not both get spun. */
function findWheels(root) {
  const nodes = [];
  root.traverse((o) => {
    if (!WHEEL_NAME.test(o.name)) return;
    for (let p = o.parent; p && p !== root; p = p.parent) {
      if (WHEEL_NAME.test(p.name)) return;
    }
    nodes.push(o);
  });
  return nodes;
}

const _vec = new THREE.Vector3();

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

   A download is as heavy as its author felt like exporting — sandstinger is
   582k triangles for one car, more than the entire rest of the scene. So rather
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

  /* Spatial hash -> the clusters in that cell. Each cluster also keeps its own
     integer cell key, so two distant cells that happen to hash alike are never
     merged. */
  const buckets = new Map();
  const kx = [];
  const ky = [];
  const kz = [];
  const px = [];
  const py = [];
  const pz = [];
  const ux = [];
  const uy = [];
  const hits = [];
  const clusterOf = new Int32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const qx = Math.floor(x / h);
    const qy = Math.floor(y / h);
    const qz = Math.floor(z / h);
    const hash = ((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791)) | 0;
    let bucket = buckets.get(hash);
    let id = -1;
    if (bucket) {
      for (let j = 0; j < bucket.length; j++) {
        const cand = bucket[j];
        if (kx[cand] === qx && ky[cand] === qy && kz[cand] === qz) { id = cand; break; }
      }
    } else {
      bucket = [];
      buckets.set(hash, bucket);
    }
    if (id < 0) {
      id = px.length;
      kx.push(qx); ky.push(qy); kz.push(qz);
      px.push(0); py.push(0); pz.push(0);
      ux.push(0); uy.push(0);
      hits.push(0);
      bucket.push(id);
    }
    clusterOf[i] = id;
    px[id] += x; py[id] += y; pz[id] += z;
    if (uv) { ux[id] += uv.getX(i); uy[id] += uv.getY(i); }
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
  const uvs = uv ? new Float32Array(count * 2) : null;
  for (let i = 0; i < count; i++) {
    const m = hits[i] || 1;
    positions[i * 3] = px[i] / m;
    positions[i * 3 + 1] = py[i] / m;
    positions[i * 3 + 2] = pz[i] / m;
    if (uvs) {
      uvs[i * 2] = ux[i] / m;
      uvs[i * 2 + 1] = uy[i] / m;
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
  for (let attempt = 0; attempt < 3; attempt++) {
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

function prepare(gltf, url) {
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  /* 1. orientation and size — the body's long axis has to run along +z,
        because that is forward everywhere else in the game. */
  const body = measure(model);

  const template = new THREE.Group();
  template.name = `model-${url.split('/').pop()}`;
  const pivot = new THREE.Group();
  pivot.rotation.y = body.yaw;
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
  // lowest tyre, protrusions included
  pivot.position.set(-body.cx * scale, -_box.min.y, -body.cz * scale);

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
    if (m.envMapIntensity !== undefined) m.envMapIntensity = 0;
  });

  /* 5. triangle budget — collapse every mesh that is over its share. Both
        mounts read this template, so the player's car and the rivals' bodies
        are reduced together and nothing can put the raw count back later. */
  if (rawTris > MAX_TRIS) {
    const k = MAX_TRIS / rawTris;
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

  /* 6. wheels — a named node is spun and steered, and the front pair is
        whichever sits ahead of the model's own centre. A model with baked-in
        wheels simply has none and leans on the chassis roll instead. */
  const wheelZ = [];
  for (const node of findWheels(template)) {
    _box.setFromObject(node);
    _box.getCenter(_center);
    wheelZ.push(_center.z);
    node.userData.wheel = wheelZ.length - 1;
  }
  const axle = wheelZ.length
    ? wheelZ.reduce((a, b) => a + b, 0) / wheelZ.length
    : 0;

  return {
    template,
    front: wheelZ.map((z) => z > axle),
    // what the file arrived with, and what it actually draws after the budget
    rawTris: Math.round(rawTris),
    tris: Math.round(tris),
  };
}

/** Fetches (once) and measures one vehicle. Resolves with the cached entry. */
export function loadModel(url) {
  let pending = cache.get(url);
  if (!pending) {
    pending = loader.loadAsync(url).then((gltf) => prepare(gltf, url));
    // a failed download must not poison the cache: the next attempt retries
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}

/** A mountable clone of one vehicle, with its own wheel handles. Geometries
    and materials are shared with the template, so a clone is cheap. */
export function instantiate(entry) {
  const group = entry.template.clone(true);
  // prepare numbers the wheel nodes in traversal order, so these land in the
  // same slots as `entry.front` with no gaps
  const wheels = [];
  group.traverse((o) => {
    const index = o.userData.wheel;
    // the clone copies userData as JSON: the index survives, the node has to be
    // re-resolved here
    if (index === undefined) return;
    wheels[index] = { node: o, base: o.rotation.clone(), front: entry.front[index] };
  });
  return { group, wheels };
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
  // nothing in this scene reflects, so an environment term would only darken
  mat.envMapIntensity = 0;
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

export function rivalBatches(url) {
  let pending = batchCache.get(url);
  if (pending) return pending;
  pending = loadModel(url).then((entry) => {
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
  pending.catch(() => batchCache.delete(url));
  batchCache.set(url, pending);
  return pending;
}

