import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js?v=5.4';

/**
 * boundaryEnvironment.js — Complete Subterranean Cavern Enclosure System
 *
 * Provides:
 * 1. Solid Collision System: All cliffs, monoliths, spires, and boulders
 *    register solid colliders in CollisionSystem so the player smoothly slides off them.
 * 2. Extended 160m Cavern Ground Bed: Completely eliminates any void horizon.
 * 3. Reactive Impact VFX: Dynamic particles and ripples on boundary collision.
 */

function makeRng(seed = 0x8b04d1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates planar triplanar UV coordinates for faceted rock geometries
 * without spherical pinching at poles or seam distortion.
 */
function applyTriplanarRockUVs(geometry, scale = 1.0) {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = nonIndexed.attributes.position;
  const uvs = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i);
    const ay = pos.getY(i);
    const az = pos.getZ(i);

    const bx = pos.getX(i + 1);
    const by = pos.getY(i + 1);
    const bz = pos.getZ(i + 1);

    const cx = pos.getX(i + 2);
    const cy = pos.getY(i + 2);
    const cz = pos.getZ(i + 2);

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;

    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    const nx = Math.abs(e1y * e2z - e1z * e2y);
    const ny = Math.abs(e1z * e2x - e1x * e2z);
    const nz = Math.abs(e1x * e2y - e1y * e2x);

    const verts = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];

    for (let k = 0; k < 3; k++) {
      const [vx, vy, vz] = verts[k];
      let u, v;
      if (ny >= nx && ny >= nz) {
        u = vx * scale;
        v = vz * scale;
      } else if (nx >= ny && nx >= nz) {
        u = vz * scale;
        v = vy * scale;
      } else {
        u = vx * scale;
        v = vy * scale;
      }
      uvs[(i + k) * 2 + 0] = u;
      uvs[(i + k) * 2 + 1] = v;
    }
  }

  nonIndexed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

/**
 * Procedurally generates a detailed dark gray craggy cavern stone texture (512x512)
 * with stratified rock veins, mineral speckling, and micro-fractures.
 */
function createCavernRockTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Base stone gray (tuned 5% darker)
  ctx.fillStyle = '#68717c';
  ctx.fillRect(0, 0, 512, 512);

  const rng = makeRng(0x73a941);

  // Broad tonal marbling (slate & granite rock patches)
  for (let p = 0; p < 36; p++) {
    const cx = rng() * 512;
    const cy = rng() * 512;
    const rad = 40 + rng() * 90;
    const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, rad);
    const lum = 77 + (rng() * 49) | 0;
    grad.addColorStop(0.0, `rgba(${lum}, ${lum + 5}, ${lum + 10}, 0.75)`);
    grad.addColorStop(0.7, `rgba(${lum - 14}, ${lum - 10}, ${lum - 5}, 0.45)`);
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Multi-frequency mineral stone grain
  for (let i = 0; i < 9000; i++) {
    const x = rng() * 512;
    const y = rng() * 512;
    const size = 0.8 + rng() * 2.6;
    const lum = 64 + (rng() * 86) | 0;
    ctx.fillStyle = `rgb(${lum}, ${lum + 4}, ${lum + 9})`;
    ctx.fillRect(x, y, size, size);
  }

  // Stratified sedimentary rock veins & lighter ridge bands
  for (let v = 0; v < 16; v++) {
    const startY = rng() * 512;
    const isLight = v % 2 === 0;
    ctx.strokeStyle = isLight ? 'rgba(195, 209, 223, 0.66)' : 'rgba(32, 38, 46, 0.80)';
    ctx.lineWidth = isLight ? 1.8 : 2.2;
    ctx.beginPath();
    ctx.moveTo(0, startY);
    let curY = startY;
    for (let x = 0; x <= 512; x += 32) {
      curY += (rng() - 0.5) * 22;
      ctx.lineTo(x, curY);
    }
    ctx.stroke();
  }

  // Angular rock fractures & cracks
  ctx.strokeStyle = 'rgba(24, 29, 35, 0.90)';
  ctx.lineWidth = 2.4;
  for (let c = 0; c < 12; c++) {
    ctx.beginPath();
    let cx = rng() * 512;
    let cy = rng() * 512;
    ctx.moveTo(cx, cy);
    for (let seg = 0; seg < 5; seg++) {
      cx += (rng() - 0.5) * 80;
      cy += (rng() - 0.5) * 80;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Micro-crystal glints
  for (let g = 0; g < 220; g++) {
    const gx = rng() * 512;
    const gy = rng() * 512;
    ctx.fillStyle = 'rgba(235, 245, 255, 0.95)';
    ctx.fillRect(gx, gy, 1.8, 1.8);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural bump map for rock depth & sharp facet relief.
 */
function createCavernRockBumpMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);

  const rng = makeRng(0x73a941);

  for (let i = 0; i < 4000; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    const val = 100 + (rng() * 70) | 0;
    ctx.fillStyle = `rgb(${val}, ${val}, ${val})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }

  // Recessed cracks
  ctx.strokeStyle = '#181818';
  ctx.lineWidth = 2.4;
  for (let c = 0; c < 12; c++) {
    ctx.beginPath();
    let cx = rng() * 256;
    let cy = rng() * 256;
    ctx.moveTo(cx, cy);
    for (let seg = 0; seg < 5; seg++) {
      cx += (rng() - 0.5) * 40;
      cy += (rng() - 0.5) * 40;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Chiseled highlights
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = 1.6;
  for (let c = 0; c < 12; c++) {
    ctx.beginPath();
    let cx = rng() * 256;
    let cy = rng() * 256;
    ctx.moveTo(cx, cy);
    for (let seg = 0; seg < 4; seg++) {
      cx += (rng() - 0.5) * 35;
      cy += (rng() - 0.5) * 35;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Procedural seamless tiling ground rock texture for the extended mountainous bed.
 */
function createOuterGroundRockTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#69737d';
  ctx.fillRect(0, 0, 512, 512);

  const rng = makeRng(0x91823f);

  // Large stone patches
  for (let p = 0; p < 32; p++) {
    const cx = rng() * 512;
    const cy = rng() * 512;
    const rad = 35 + rng() * 80;
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
    const lum = 72 + (rng() * 49) | 0;
    grad.addColorStop(0.0, `rgba(${lum}, ${lum + 4}, ${lum + 9}, 0.8)`);
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Grain
  for (let i = 0; i < 8000; i++) {
    const x = rng() * 512;
    const y = rng() * 512;
    const size = 1.0 + rng() * 2.2;
    const lum = 65 + (rng() * 72) | 0;
    ctx.fillStyle = `rgb(${lum}, ${lum + 4}, ${lum + 8})`;
    ctx.fillRect(x, y, size, size);
  }

  // Crag and sediment fissures
  ctx.strokeStyle = 'rgba(24, 30, 36, 0.85)';
  ctx.lineWidth = 2.0;
  for (let c = 0; c < 15; c++) {
    ctx.beginPath();
    let cx = rng() * 512;
    let cy = rng() * 512;
    ctx.moveTo(cx, cy);
    for (let seg = 0; seg < 4; seg++) {
      cx += (rng() - 0.5) * 70;
      cy += (rng() - 0.5) * 70;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Highlight strata
  ctx.strokeStyle = 'rgba(195, 209, 223, 0.62)';
  ctx.lineWidth = 1.4;
  for (let c = 0; c < 10; c++) {
    ctx.beginPath();
    let cx = rng() * 512;
    let cy = rng() * 512;
    ctx.moveTo(cx, cy);
    for (let seg = 0; seg < 3; seg++) {
      cx += (rng() - 0.5) * 60;
      cy += (rng() - 0.5) * 60;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedurally sculpts a heavy, rugged, faceted rock pillar geometry
 * with wide chiseled footings, stratified rock ledges, and a broken flat plateau summit.
 * Replaces thin pointed needle spires with thick, rugged cavern rock bluffs.
 */
function createRuggedPillarGeometry() {
  const height = 6.8;
  const radiusTop = 1.45;
  const radiusBottom = 2.40;
  const radialSegments = 8;
  const heightSegments = 5;
  const geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments, false);
  geom.translate(0, height / 2, 0);

  const pos = geom.attributes.position;
  const rng = makeRng(0x73a81);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const hFrac = y / height;
    const angle = Math.atan2(z, x);
    const r = Math.sqrt(x * x + z * z);

    // Multi-tier rugged crags and chiseled rock shelves
    const crag1 = Math.sin(angle * 3.0 + y * 0.9) * 0.32;
    const crag2 = Math.cos(angle * 5.0 - y * 1.6) * 0.20;
    const shelfLedge = Math.sin(y * 2.2) > 0.3 ? 0.35 : -0.15;
    const jitter = (rng() - 0.5) * 0.28;

    let rMod = Math.max(0.6, r + crag1 + crag2 + shelfLedge + jitter);
    let newY = y;

    if (hFrac > 0.88) {
      // Rugged chiseled summit plateau (NOT a needle point)
      rMod *= 0.95 + (rng() - 0.5) * 0.20;
      newY += (rng() - 0.5) * 0.45;
    } else if (hFrac < 0.12) {
      // Flared heavy root footing embedded deep into ground
      rMod *= 1.15;
      newY -= 0.35;
    }

    pos.setXYZ(i, Math.cos(angle) * rMod, newY, Math.sin(angle) * rMod);
  }

  geom.computeVertexNormals();
  return applyTriplanarRockUVs(geom, 0.70);
}

/**
 * Procedurally sculpts a massive rugged cliff buttress geometry
 * with wide terraced rock shelves and a fractured chiseled peak.
 * Replaces tall thin pointed cone buttresses with heavy, full mountain bluffs.
 */
function createRuggedCliffButtressGeometry() {
  const height = 22.0;
  const radiusTop = 2.4;
  const radiusBottom = 4.8;
  const radialSegments = 8;
  const heightSegments = 6;
  const geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments, false);
  geom.translate(0, height / 2, 0);

  const pos = geom.attributes.position;
  const rng = makeRng(0x84f1b);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const hFrac = y / height;
    const angle = Math.atan2(z, x);
    const r = Math.sqrt(x * x + z * z);

    // Massive stratified cavern cliff terracing
    const shelf1 = Math.sin(angle * 2.0 + y * 0.35) * 0.65;
    const shelf2 = Math.cos(angle * 4.0 - y * 0.75) * 0.40;
    const terrace = Math.sin(y * 0.8) > 0.3 ? 0.60 : -0.25;
    const jitter = (rng() - 0.5) * 0.45;

    let rMod = Math.max(1.0, r + shelf1 + shelf2 + terrace + jitter);
    let newY = y;

    if (hFrac > 0.90) {
      rMod *= 0.95 + (rng() - 0.5) * 0.25;
      newY += (rng() - 0.5) * 1.2;
    } else if (hFrac < 0.10) {
      rMod *= 1.20;
      newY -= 0.6;
    }

    pos.setXYZ(i, Math.cos(angle) * rMod, newY, Math.sin(angle) * rMod);
  }

  geom.computeVertexNormals();
  return applyTriplanarRockUVs(geom, 0.40);
}

/**
 * Procedurally sculpts a colossal rugged cliff monolith geometry
 * with heavy columnar fracturing and chiseled rock faces.
 */
function createRuggedCliffMonolithGeometry() {
  const height = 18.0;
  const radiusTop = 2.4;
  const radiusBottom = 4.0;
  const radialSegments = 8;
  const heightSegments = 6;
  const geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments, false);
  geom.translate(0, height / 2, 0);

  const pos = geom.attributes.position;
  const rng = makeRng(0x32c9e);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const hFrac = y / height;
    const angle = Math.atan2(z, x);
    const r = Math.sqrt(x * x + z * z);

    const crag = Math.sin(angle * 3.0 + y * 0.5) * 0.45;
    const cleft = Math.cos(angle * 4.0 - y * 1.0) * 0.35;
    const jitter = (rng() - 0.5) * 0.35;

    let rMod = Math.max(0.8, r + crag + cleft + jitter);
    let newY = y;

    if (hFrac > 0.90) {
      newY += (rng() - 0.5) * 1.0;
    } else if (hFrac < 0.10) {
      rMod *= 1.18;
      newY -= 0.5;
    }

    pos.setXYZ(i, Math.cos(angle) * rMod, newY, Math.sin(angle) * rMod);
  }

  geom.computeVertexNormals();
  return applyTriplanarRockUVs(geom, 0.45);
}

/**
 * Procedurally sculpts a craggy, faceted cavern boulder geometry.
 */
function createRuggedBoulderGeometry() {
  const geom = new THREE.DodecahedronGeometry(1.6, 0);
  geom.translate(0, 1.1, 0);

  const pos = geom.attributes.position;
  const rng = makeRng(0x6102a);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Subtle organic irregularity across facets
    const scale = 0.88 + rng() * 0.28;
    pos.setXYZ(i, x * scale, y * scale, z * scale);
  }

  geom.computeVertexNormals();
  return applyTriplanarRockUVs(geom, 1.1);
}

export class BoundaryEnvironment {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.groundSize = options.groundSize || 90;
    this.halfSize = this.groundSize / 2; // 45
    this.rng = makeRng(options.seed || 0xca7e4b);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.stalagmiteData = [];
    this.mushroomData = [];
    this.impactParticles = [];

    this._initMaterials();
    this._buildExtendedCavernGround();
    this._buildToweringCavernWallCliffs();
    this._buildDenseStalagmitePalisades();
    this._initImpactParticleSystem();
  }

  _initMaterials() {
    const cavernRockTex = createCavernRockTexture();
    const cavernRockBump = createCavernRockBumpMap();

    // 1. Detailed dark craggy cavern stone with bump map and rim light response (tuned 5% darker)
    this.rockMaterial = new THREE.MeshStandardMaterial({
      map: cavernRockTex,
      bumpMap: cavernRockBump,
      bumpScale: 0.10,
      color: 0xb6bec6,
      roughness: 0.76,
      metalness: 0.08,
      flatShading: true,
    });

    // 2. Spires and rock formations match the rest of the rocky terrain (no green tint)
    this.crystalRockMaterial = this.rockMaterial;
  }

  /**
   * Returns an array of solid colliders { x, z, radius } for all boundary objects.
   * Radii accurately match the visual base geometries to eliminate any penetrable gaps.
   */
  getColliders() {
    const colliders = [];

    // 1. Monoliths (Giant radius matching flared chiseled base)
    for (const m of this.cliffMonolithsData ?? []) {
      colliders.push({ x: m.x, z: m.z, radius: 4.6 * m.scaleXZ });
    }

    // 2. Buttresses (Colossal radius matching wide terraced rock shelves)
    for (const b of this.cliffButtressesData ?? []) {
      colliders.push({ x: b.x, z: b.z, radius: 5.5 * b.scaleXZ });
    }

    // 3. Rugged Rock Pillars (Full wide base matching sculpted footing)
    for (const s of this.spiresData ?? []) {
      colliders.push({ x: s.x, z: s.z, radius: 2.65 * s.scaleXZ });
    }

    // 4. Boulders (Full radius matching faceted dodecahedron)
    for (const b of this.bouldersData ?? []) {
      colliders.push({ x: b.x, z: b.z, radius: 1.75 * b.scaleXZ });
    }

    return colliders;
  }

  /**
   * Extended Outer Cavern Ground Bed (Radius 41.5m to 160m):
   * Sculpted mountainous craggy ridges and rock terracing in dark gray slate tones.
   * Begins 3.5m inside the main terrain boundary to ensure an airtight overlap with zero void tears.
   */
  _buildExtendedCavernGround() {
    const innerHalf = this.halfSize - 3.5; // ~41.5m (extends well underneath the 45m main terrain)
    const outerHalf = 160;
    const segments = 64;

    const groundGeometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const uvs = [];
    const indices = [];

    const getPerimeterCoord = (t, halfW) => {
      let x = 0;
      let z = 0;
      const side = Math.floor(t);
      const frac = t - side;
      if (side === 0) {
        x = -halfW + frac * (2 * halfW);
        z = -halfW;
      } else if (side === 1) {
        x = halfW;
        z = -halfW + frac * (2 * halfW);
      } else if (side === 2) {
        x = halfW - frac * (2 * halfW);
        z = halfW;
      } else {
        x = -halfW;
        z = halfW - frac * (2 * halfW);
      }
      return { x, z };
    };

    this._getPerimeterCoord = getPerimeterCoord;

    const totalSteps = segments * 4;
    this.outerGroundTotalSteps = totalSteps;
    this.outerGroundInnerHalf = innerHalf;

    const rows = [
      { halfW: innerHalf, depthY: 0, lum: 0.75 },
      { halfW: innerHalf + 10, depthY: 1.0, lum: 0.636 },
      { halfW: innerHalf + 26, depthY: 2.2, lum: 0.522 },
      { halfW: innerHalf + 48, depthY: 3.8, lum: 0.418 },
      { halfW: innerHalf + 78, depthY: 5.5, lum: 0.323 },
      { halfW: outerHalf, depthY: 7.2, lum: 0.237 },
    ];
    this.outerGroundRows = rows;

    const colorRng = makeRng(0x8192a3);

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const isInner = r === 0;

      for (let i = 0; i < totalSteps; i++) {
        const t = (i / totalSteps) * 4.0;
        const p = getPerimeterCoord(t, row.halfW);
        
        let groundY;
        if (isInner) {
          groundY = getTerrainHeight(p.x, p.z) - 0.15;
        } else {
          // Sculpted mountainous ridges, crags & distance peaks
          const mountainWave1 = Math.sin(p.x * 0.05 + 0.8) * Math.cos(p.z * 0.05 - 0.4) * (1.6 + r * 0.6);
          const mountainWave2 = Math.cos(p.x * 0.09 - 1.1) * Math.sin(p.z * 0.08 + 0.6) * (1.1 + r * 0.4);
          const cragRidge = Math.abs(Math.sin(p.x * 0.07 + p.z * 0.07)) * (1.4 + r * 0.5);
          groundY = getTerrainHeight(p.x * 0.3, p.z * 0.3) * 0.4 + mountainWave1 + mountainWave2 + cragRidge + row.depthY;
        }

        positions.push(p.x, groundY, p.z);

        // Dark slate gray vertex colors with subtle organic stone tint jitter
        const jitter = (colorRng() - 0.5) * 0.035;
        const rCol = THREE.MathUtils.clamp(row.lum * 0.96 + jitter, 0.05, 1.0);
        const gCol = THREE.MathUtils.clamp(row.lum * 1.00 + jitter, 0.05, 1.0);
        const bCol = THREE.MathUtils.clamp(row.lum * 1.06 + jitter, 0.05, 1.0);
        colors.push(rCol, gCol, bCol);

        // UV mapping for repeating rock texture across the ground bed
        uvs.push(p.x * 0.08, p.z * 0.08);
      }
    }

    for (let r = 0; r < rows.length - 1; r++) {
      const rowOffsetA = r * totalSteps;
      const rowOffsetB = (r + 1) * totalSteps;

      for (let i = 0; i < totalSteps; i++) {
        const nextI = (i + 1) % totalSteps;
        const a = rowOffsetA + i;
        const b = rowOffsetA + nextI;
        const c = rowOffsetB + i;
        const d = rowOffsetB + nextI;

        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    groundGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    groundGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    groundGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    groundGeometry.setIndex(indices);
    groundGeometry.computeVertexNormals();

    const outerRockTex = createOuterGroundRockTexture();
    outerRockTex.wrapS = THREE.RepeatWrapping;
    outerRockTex.wrapT = THREE.RepeatWrapping;

    const groundMaterial = new THREE.MeshStandardMaterial({
      map: outerRockTex,
      color: 0xb6c0c9,
      vertexColors: true,
      roughness: 0.80,
      metalness: 0.08,
      flatShading: true,
      side: THREE.DoubleSide, // Prevent backface culling tears
    });

    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.frustumCulled = false; // Never cull boundary ground mesh
    this.group.add(groundMesh);
    this.outerGroundMesh = groundMesh;
  }

  /**
   * Generates colossal cavern wall cliffs & monoliths (12m–28m high).
   */
  _buildToweringCavernWallCliffs() {
    const cliffMonolithGeom = createRuggedCliffMonolithGeometry();
    const giantButtressGeom = createRuggedCliffButtressGeometry();

    const monolithPositions = [];
    const countPerSide = 28;
    const boundaryHalf = this.halfSize + 4.5; // ~49.5m

    const addCliff = (baseX, baseZ, normalX, normalZ) => {
      const isBottom = (baseZ > 0 && normalZ > 0);
      const jitterDist = (this.rng() - 0.5) * 4.5;
      const depthOffset = 1.0 + this.rng() * 6.0; // Strictly positive so cliffs frame the background
      const x = baseX + depthOffset * normalX + jitterDist * -normalZ;
      const z = baseZ + depthOffset * normalZ + jitterDist * normalX;

      const isButtress = isBottom ? false : (this.rng() > 0.60);
      const scaleXZ = isBottom ? (1.5 + this.rng() * 1.5) : (1.4 + this.rng() * 1.8);
      const scaleY = isBottom ? (0.75 + this.rng() * 0.45) : (1.3 + this.rng() * 1.6);
      const rotY = this.rng() * Math.PI * 2;
      const tiltX = (this.rng() - 0.5) * 0.15;
      const tiltZ = (this.rng() - 0.5) * 0.15;

      monolithPositions.push({
        x,
        z,
        scaleXZ,
        scaleY,
        rotY,
        tiltX,
        tiltZ,
        isButtress,
      });
    };

    for (let i = 0; i < countPerSide; i++) {
      const frac = (i / (countPerSide - 1)) * 2 - 1;
      const coord = frac * (boundaryHalf + 2.0);

      addCliff(coord, -boundaryHalf, 0, -1);
      addCliff(coord, boundaryHalf, 0, 1); // Full coverage on all 4 boundaries
      addCliff(-boundaryHalf, coord, -1, 0);
      addCliff(boundaryHalf, coord, 1, 0);
    }

    const corners = [
      { x: -boundaryHalf, z: -boundaryHalf },
      { x: boundaryHalf, z: -boundaryHalf },
      { x: boundaryHalf, z: boundaryHalf },
      { x: -boundaryHalf, z: boundaryHalf },
    ];
    for (const c of corners) {
      const isBottom = c.z > 0;
      const cornerCount = 8;
      for (let k = 0; k < cornerCount; k++) {
        const angle = (k / cornerCount) * Math.PI * 2;
        const dist = 1.5 + this.rng() * 5.0;
        monolithPositions.push({
          x: c.x + Math.cos(angle) * dist,
          z: c.z + Math.sin(angle) * dist,
          scaleXZ: 1.6 + this.rng() * 2.0,
          scaleY: isBottom ? (0.8 + this.rng() * 0.5) : (1.4 + this.rng() * 1.8),
          rotY: this.rng() * Math.PI * 2,
          tiltX: (this.rng() - 0.5) * 0.20,
          tiltZ: (this.rng() - 0.5) * 0.20,
          isButtress: isBottom ? false : (this.rng() > 0.5),
        });
      }
    }

    const buttresses = monolithPositions.filter(p => p.isButtress);
    const monoliths = monolithPositions.filter(p => !p.isButtress);

    const tempMatrix = new THREE.Matrix4();
    const tempPos = new THREE.Vector3();
    const tempQuat = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();
    const tempScale = new THREE.Vector3();

    // 1. Monoliths
    if (monoliths.length > 0) {
      const monolithMesh = new THREE.InstancedMesh(cliffMonolithGeom, this.rockMaterial, monoliths.length);
      monolithMesh.frustumCulled = false; // Never cull boundary meshes
      monoliths.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y - 0.5, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        monolithMesh.setMatrixAt(i, tempMatrix);
      });
      monolithMesh.instanceMatrix.needsUpdate = true;
      this.group.add(monolithMesh);
      this.cliffMonolithMesh = monolithMesh;
      this.cliffMonolithsData = monoliths;
    }

    // 2. Buttresses
    if (buttresses.length > 0) {
      const buttressMesh = new THREE.InstancedMesh(giantButtressGeom, this.rockMaterial, buttresses.length);
      buttressMesh.frustumCulled = false; // Never cull boundary meshes
      buttresses.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y - 0.5, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        buttressMesh.setMatrixAt(i, tempMatrix);
      });
      buttressMesh.instanceMatrix.needsUpdate = true;
      this.group.add(buttressMesh);
      this.cliffButtressMesh = buttressMesh;
      this.cliffButtressesData = buttresses;
    }
  }

  /**
   * Generates dense multi-row rugged rock bluffs, pillars, and craggy boulders along the boundary.
   * Completely seamless, gap-free, and impenetrable interlocking rock palisade.
   */
  _buildDenseStalagmitePalisades() {
    const ruggedPillarGeom = createRuggedPillarGeometry();
    const boulderGeom = createRuggedBoulderGeometry();

    const perimeterPositions = [];
    const countPerSide = 48;
    const boundaryHalf = this.halfSize - 2.8; // ~42.2m (frontline palisade wall)
    const backHalf = this.halfSize - 0.8; // ~44.2m (outer reinforcement row)

    const addRock = (baseX, baseZ, normalX, normalZ, isBackRow = false) => {
      const isBottom = (baseZ > 0 && normalZ > 0);
      const lateralJitter = (this.rng() - 0.5) * 0.35;
      const depthJitter = (this.rng() - 0.5) * 0.30;
      const x = baseX + depthJitter * normalX + lateralJitter * -normalZ;
      const z = baseZ + depthJitter * normalZ + lateralJitter * normalX;

      const isPillar = isBottom ? (this.rng() > 0.40) : (this.rng() > 0.30);
      
      const scaleXZ = isBackRow
        ? (1.3 + this.rng() * 0.5)
        : (1.2 + this.rng() * 0.35);

      const scaleY = isBottom
        ? (0.65 + this.rng() * 0.25)
        : (isPillar ? (1.0 + this.rng() * 0.75) : (0.8 + this.rng() * 0.45));

      const rotY = this.rng() * Math.PI * 2;
      const tiltX = (this.rng() - 0.5) * 0.18;
      const tiltZ = (this.rng() - 0.5) * 0.18;

      perimeterPositions.push({
        x,
        z,
        scaleXZ,
        scaleY,
        rotY,
        tiltX,
        tiltZ,
        isTallSpire: isPillar,
      });
    };

    // 1. Frontline palisade wall (boundaryHalf = 42.2m) - completely continuous, NO skips
    for (let i = 0; i < countPerSide; i++) {
      const frac = (i / (countPerSide - 1)) * 2 - 1;
      const coord = frac * (boundaryHalf + 0.5);

      addRock(coord, -boundaryHalf, 0, -1, false); // North
      addRock(coord, boundaryHalf, 0, 1, false);   // South (dense, no skips)
      addRock(-boundaryHalf, coord, -1, 0, false); // West
      addRock(boundaryHalf, coord, 1, 0, false);  // East
    }

    // 2. Outer reinforcement row (backHalf = 44.2m) - staggered by half a step to fill all gaps
    const countBackRow = 44;
    for (let i = 0; i < countBackRow; i++) {
      const frac = ((i + 0.5) / countBackRow) * 2 - 1;
      const coord = frac * (backHalf + 0.5);

      addRock(coord, -backHalf, 0, -1, true); // North
      addRock(coord, backHalf, 0, 1, true);   // South
      addRock(-backHalf, coord, -1, 0, true); // West
      addRock(backHalf, coord, 1, 0, true);  // East
    }

    // 3. Dense corner formations - smooth concentric arcs sealing all 4 diagonal corners
    const cornerSigns = [
      { sx: -1, sz: -1 },
      { sx: 1, sz: -1 },
      { sx: 1, sz: 1 },
      { sx: -1, sz: 1 },
    ];
    for (const c of cornerSigns) {
      const isBottom = c.sz > 0;
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const angle = (k / (steps - 1)) * (Math.PI / 2);
        // Inner corner arc
        const ix = c.sx * (boundaryHalf - 0.5 + Math.cos(angle) * 1.5);
        const iz = c.sz * (boundaryHalf - 0.5 + Math.sin(angle) * 1.5);
        // Outer corner arc
        const ox = c.sx * (backHalf + Math.cos(angle) * 1.8);
        const oz = c.sz * (backHalf + Math.sin(angle) * 1.8);

        perimeterPositions.push({
          x: ix,
          z: iz,
          scaleXZ: 1.25 + this.rng() * 0.35,
          scaleY: isBottom ? (0.65 + this.rng() * 0.25) : (1.0 + this.rng() * 0.7),
          rotY: this.rng() * Math.PI * 2,
          tiltX: (this.rng() - 0.5) * 0.15,
          tiltZ: (this.rng() - 0.5) * 0.15,
          isTallSpire: this.rng() > 0.35,
        });

        perimeterPositions.push({
          x: ox,
          z: oz,
          scaleXZ: 1.4 + this.rng() * 0.45,
          scaleY: isBottom ? (0.7 + this.rng() * 0.3) : (1.2 + this.rng() * 0.8),
          rotY: this.rng() * Math.PI * 2,
          tiltX: (this.rng() - 0.5) * 0.15,
          tiltZ: (this.rng() - 0.5) * 0.15,
          isTallSpire: this.rng() > 0.35,
        });
      }
    }

    const spires = perimeterPositions.filter(p => p.isTallSpire);
    const boulders = perimeterPositions.filter(p => !p.isTallSpire);

    const tempMatrix = new THREE.Matrix4();
    const tempPos = new THREE.Vector3();
    const tempQuat = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();
    const tempScale = new THREE.Vector3();

    // 1. Boundary Rugged Rock Pillars
    if (spires.length > 0) {
      const spireMesh = new THREE.InstancedMesh(ruggedPillarGeom, this.rockMaterial, spires.length);
      spireMesh.frustumCulled = false; // Never cull boundary meshes
      spires.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y - 0.3, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        spireMesh.setMatrixAt(i, tempMatrix);
      });
      spireMesh.instanceMatrix.needsUpdate = true;
      this.group.add(spireMesh);
      this.spireMesh = spireMesh;
      this.standardSpiresData = spires;
    }

    this.spiresData = spires;

    // 2. Boulders
    if (boulders.length > 0) {
      const boulderMesh = new THREE.InstancedMesh(boulderGeom, this.rockMaterial, boulders.length);
      boulderMesh.frustumCulled = false; // Never cull boundary meshes
      boulders.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        boulderMesh.setMatrixAt(i, tempMatrix);
      });
      boulderMesh.instanceMatrix.needsUpdate = true;
      this.group.add(boulderMesh);
      this.boulderMesh = boulderMesh;
      this.bouldersData = boulders;
    }

    this.stalagmiteData = perimeterPositions;
  }

  _initImpactParticleSystem() {
    this.impactPool = [];
    const maxBursts = 14;
    const impactGeom = new THREE.SphereGeometry(0.09, 6, 6);

    for (let b = 0; b < maxBursts; b++) {
      const burstGroup = new THREE.Group();
      burstGroup.visible = false;
      const meshes = [];
      const velocities = [];

      const mat = new THREE.MeshBasicMaterial({
        color: 0x55f5e2,
        transparent: true,
        opacity: 0.95,
      });

      for (let p = 0; p < 10; p++) {
        const mesh = new THREE.Mesh(impactGeom, mat);
        burstGroup.add(mesh);
        meshes.push(mesh);
        velocities.push(new THREE.Vector3());
      }

      this.scene.add(burstGroup);
      this.impactPool.push({
        group: burstGroup,
        material: mat,
        meshes,
        velocities,
        active: false,
        elapsed: 0,
        duration: 0.45,
      });
    }
  }

  onBoundaryHit(x, z, normal = { x: 0, z: 0 }) {
    const burst = this.impactPool.find(b => !b.active);
    if (!burst) return;

    const groundY = getTerrainHeight(x, z);
    burst.group.position.set(x, groundY + 0.45, z);
    burst.group.visible = true;
    burst.active = true;
    burst.elapsed = 0;

    const colors = [0x55f0ff, 0xd660ff, 0x55ff99, 0xffe080];
    const hitColor = colors[Math.floor(Math.random() * colors.length)];
    burst.material.color.setHex(hitColor);
    burst.material.opacity = 1.0;

    const inwardAngle = Math.atan2(-normal.z, -normal.x);

    for (let i = 0; i < burst.meshes.length; i++) {
      const mesh = burst.meshes[i];
      mesh.position.set(0, 0, 0);
      mesh.scale.setScalar(0.75 + Math.random() * 0.9);

      const spread = (Math.random() - 0.5) * 1.5;
      const speed = 2.8 + Math.random() * 3.5;
      const vx = Math.cos(inwardAngle + spread) * speed;
      const vz = Math.sin(inwardAngle + spread) * speed;
      const vy = 0.9 + Math.random() * 2.0;

      burst.velocities[i].set(vx, vy, vz);
    }
  }

  update(deltaTime) {
    this.elapsedTime += deltaTime;

    for (const burst of this.impactPool) {
      if (!burst.active) continue;

      burst.elapsed += deltaTime;
      const progress = burst.elapsed / burst.duration;

      if (progress >= 1.0) {
        burst.active = false;
        burst.group.visible = false;
        continue;
      }

      burst.material.opacity = Math.max(0, 1.0 - progress);

      for (let i = 0; i < burst.meshes.length; i++) {
        const mesh = burst.meshes[i];
        const vel = burst.velocities[i];
        vel.y -= 4.2 * deltaTime;
        mesh.position.addScaledVector(vel, deltaTime);
        mesh.scale.multiplyScalar(0.97);
      }
    }
  }

  realignToTerrain() {
    const tempMatrix = new THREE.Matrix4();
    const tempPos = new THREE.Vector3();
    const tempQuat = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();
    const tempScale = new THREE.Vector3();

    if (this.cliffMonolithMesh && this.cliffMonolithsData) {
      this.cliffMonolithsData.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y - 0.5, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.cliffMonolithMesh.setMatrixAt(i, tempMatrix);
      });
      this.cliffMonolithMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.cliffButtressMesh && this.cliffButtressesData) {
      this.cliffButtressesData.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y - 0.5, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.cliffButtressMesh.setMatrixAt(i, tempMatrix);
      });
      this.cliffButtressMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.spireMesh && this.standardSpiresData) {
      this.standardSpiresData.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y - 0.3, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.spireMesh.setMatrixAt(i, tempMatrix);
      });
      this.spireMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.boulderMesh && this.bouldersData) {
      this.bouldersData.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.boulderMesh.setMatrixAt(i, tempMatrix);
      });
      this.boulderMesh.instanceMatrix.needsUpdate = true;
    }

    // Realign extended outer cavern ground vertices to match elevated terrain seamlessly
    if (this.outerGroundMesh && this.outerGroundRows && this.outerGroundTotalSteps) {
      const pos = this.outerGroundMesh.geometry.attributes.position;
      const totalSteps = this.outerGroundTotalSteps;
      const rows = this.outerGroundRows;

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const isInner = r === 0;
        const rowOffset = r * totalSteps;

        for (let i = 0; i < totalSteps; i++) {
          const t = (i / totalSteps) * 4.0;
          const p = this._getPerimeterCoord(t, row.halfW);
          const vertIndex = rowOffset + i;

          let groundY;
          if (isInner) {
            // Tuck slightly underneath the elevated terrain edge (-0.15m) to ensure a seamless seal with no gap
            groundY = getTerrainHeight(p.x, p.z) - 0.15;
          } else {
            const mountainWave1 = Math.sin(p.x * 0.05 + 0.8) * Math.cos(p.z * 0.05 - 0.4) * (1.6 + r * 0.6);
            const mountainWave2 = Math.cos(p.x * 0.09 - 1.1) * Math.sin(p.z * 0.08 + 0.6) * (1.1 + r * 0.4);
            const cragRidge = Math.abs(Math.sin(p.x * 0.07 + p.z * 0.07)) * (1.4 + r * 0.5);
            groundY = getTerrainHeight(p.x * 0.3, p.z * 0.3) * 0.4 + mountainWave1 + mountainWave2 + cragRidge + row.depthY;
          }

          pos.setY(vertIndex, groundY);
        }
      }

      pos.needsUpdate = true;
      this.outerGroundMesh.geometry.computeVertexNormals();
    }
  }
}

