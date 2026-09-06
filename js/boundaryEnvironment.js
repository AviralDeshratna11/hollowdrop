import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js?v=5.4';

/**
 * boundaryEnvironment.js — Complete Subterranean Cavern Enclosure & Bio-Forest System
 *
 * Provides:
 * 1. High-Poly Watertight Sculpted Mushrooms: Closed LatheGeometry profiles with zero holes,
 *    flared root stems, veil collars, and procedural organic fungal textures (bioluminescent
 *    spore spots, radiating vein striations, and glowing underside gills).
 * 2. Solid Collision System: All cliffs, monoliths, spires, boulders, and giant stalks
 *    register solid colliders in CollisionSystem so the player smoothly slides off them.
 * 3. Extended 160m Cavern Ground Bed: Completely eliminates any void horizon.
 * 4. Front-Line Spore Particle Field (32m–42m): Hundreds of glowing spores and embers
 *    drifting right around the player as they approach the boundary.
 * 5. Reactive Impact VFX: Dynamic glowing spore puffs and ripples on boundary collision.
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
 * Generates a high-resolution soft circular spore particle sprite texture.
 */
function createSporeParticleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.2, 'rgba(200, 248, 255, 0.95)');
  gradient.addColorStop(0.5, 'rgba(80, 210, 245, 0.50)');
  gradient.addColorStop(0.8, 'rgba(40, 130, 210, 0.18)');
  gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Procedurally paints a smooth, velvety, bioluminescent fungal texture on a 512x512 canvas.
 * Clean organic aesthetic with glowing spore freckles and ZERO black spots or harsh rings.
 */
function createMushroomCapTexture(palette) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const cx = 256;
  const cy = 256;

  // 1. Soft Velvety Base Radial Gradient
  const baseGrad = ctx.createRadialGradient(cx, cy, 6, cx, cy, 252);
  baseGrad.addColorStop(0.0, palette.apexColor);
  baseGrad.addColorStop(0.35, palette.midColor);
  baseGrad.addColorStop(0.70, palette.bodyColor);
  baseGrad.addColorStop(0.92, palette.rimGlowColor);
  baseGrad.addColorStop(1.0, palette.outerLipColor);
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, 512, 512);

  // 2. Soft Organic Fungal Marbling (Fine textural grain)
  const noiseRng = makeRng(palette.seed || 0x48a1);
  ctx.fillStyle = palette.grainColor;
  for (let g = 0; g < 400; g++) {
    const a = noiseRng() * Math.PI * 2;
    const dist = 10 + noiseRng() * 235;
    const x = cx + Math.cos(a) * dist;
    const y = cy + Math.sin(a) * dist;
    const rad = 1.2 + noiseRng() * 3.2;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Delicate Luminous Capillary Veins (Soft branching filaments)
  const veinCount = 48;
  for (let i = 0; i < veinCount; i++) {
    const angle = (i / veinCount) * Math.PI * 2;
    const isMajor = i % 2 === 0;
    ctx.strokeStyle = isMajor ? palette.veinColor : palette.veinSubtleColor;
    ctx.lineWidth = isMajor ? 1.6 : 0.9;
    ctx.beginPath();
    ctx.moveTo(cx, cy);

    let curX = cx;
    let curY = cy;
    let curAngle = angle;

    for (let dist = 18; dist < 240; dist += 18) {
      const wiggle = Math.sin(dist * 0.16 + i * 1.5) * 0.10;
      curAngle += wiggle;
      curX = cx + Math.cos(curAngle) * dist;
      curY = cy + Math.sin(curAngle) * dist;
      ctx.lineTo(curX, curY);

      if (dist > 85 && dist % 36 === 0) {
        const branchAngle = curAngle + (i % 2 === 0 ? 0.32 : -0.32);
        const bx = curX + Math.cos(branchAngle) * 16;
        const by = curY + Math.sin(branchAngle) * 16;
        ctx.moveTo(curX, curY);
        ctx.lineTo(bx, by);
        ctx.moveTo(curX, curY);
      }
    }
    ctx.stroke();
  }

  // 4. Pure Luminous Bioluminescent Spore Freckles (NO black spots, NO dark borders!)
  const rng = makeRng((palette.seed || 0x48a1) + 0x77);

  // A. Medium Luminous Spore Pods (Soft glowing colored halos with bright glowing centers)
  const medSpots = 55;
  for (let s = 0; s < medSpots; s++) {
    const angle = rng() * Math.PI * 2;
    const dist = 25 + Math.sqrt(rng()) * 200;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    const radius = 3.5 + rng() * 4.5;

    const haloGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.6);
    haloGrad.addColorStop(0.0, palette.spotCoreColor);
    haloGrad.addColorStop(0.4, palette.spotHaloColor);
    haloGrad.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // B. Delicate Micro Spore Freckles
  const microSpots = 160;
  for (let s = 0; s < microSpots; s++) {
    const angle = rng() * Math.PI * 2;
    const dist = 15 + Math.sqrt(rng()) * 225;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    const radius = 1.0 + rng() * 1.8;

    ctx.fillStyle = palette.spotFreckleColor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Procedurally generates an underside gill texture with high-contrast glowing radial lamellae fins.
 */
function createMushroomGillTexture(glowColorHex, accentGlowHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#060a08';
  ctx.fillRect(0, 0, 512, 512);

  const fins = 96;
  for (let i = 0; i < fins; i++) {
    const angle = (i / fins) * Math.PI * 2;
    const isMajor = i % 2 === 0;

    const startR = isMajor ? 35 : 70;
    const endR = 245;

    const x1 = 256 + Math.cos(angle) * startR;
    const y1 = 256 + Math.sin(angle) * startR;
    const x2 = 256 + Math.cos(angle) * endR;
    const y2 = 256 + Math.sin(angle) * endR;

    ctx.strokeStyle = isMajor ? glowColorHex : accentGlowHex;
    ctx.lineWidth = isMajor ? 2.6 : 1.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedurally generates a striated fibrous mushroom stalk texture.
 */
function createMushroomStalkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Dark organic bark base
  ctx.fillStyle = '#181222';
  ctx.fillRect(0, 0, 256, 512);

  // Vertical fibrous grain
  for (let x = 0; x < 256; x += 2.5) {
    const alpha = 0.09 + Math.sin(x * 0.35) * 0.07;
    ctx.strokeStyle = `rgba(180, 160, 230, ${alpha})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.sin(x * 0.8) * 5), 512);
    ctx.stroke();
  }

  // Peeling organic bark streaks
  const barkRng = makeRng(0x8921);
  for (let b = 0; b < 24; b++) {
    const bx = barkRng() * 240;
    const by = barkRng() * 450;
    const bw = 3 + barkRng() * 6;
    const bh = 20 + barkRng() * 45;
    ctx.fillStyle = 'rgba(10, 6, 16, 0.45)';
    ctx.fillRect(bx, by, bw, bh);
  }

  // Glowing bio-vein strands running up the stem
  const veinRng = makeRng(0x7331);
  for (let v = 0; v < 7; v++) {
    const startX = 15 + veinRng() * 226;
    ctx.strokeStyle = (v % 2 === 0) ? 'rgba(0, 230, 255, 0.50)' : 'rgba(210, 60, 255, 0.45)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(startX, 512);
    let curX = startX;
    for (let y = 512; y >= 0; y -= 16) {
      curX += (veinRng() - 0.5) * 5.5;
      ctx.lineTo(curX, y);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Applies exact planar radial UV mapping to mushroom cap LatheGeometry.
 * Center apex vertex maps strictly to (0.5, 0.5), and UVs radiate outward
 * conformally along the dome's arc length to the outer rim.
 */
function applyRadialUVsToMushroomCap(geom, points, rimIndex) {
  const arcLens = [0];
  for (let i = 1; i <= rimIndex; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    arcLens.push(arcLens[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalArc = arcLens[rimIndex];

  const tFactors = [];
  for (let i = 0; i < points.length; i++) {
    if (i <= rimIndex) {
      tFactors.push(arcLens[i] / totalArc);
    } else {
      const underFrac = (i - rimIndex) / (points.length - 1 - rimIndex);
      tFactors.push(1.0 - underFrac * 0.16);
    }
  }

  const pos = geom.attributes.position;
  const uvs = geom.attributes.uv;
  const count = pos.count;
  const pCount = points.length;

  for (let v = 0; v < count; v++) {
    const pIdx = v % pCount;
    const t = tFactors[pIdx];
    const x = pos.getX(v);
    const z = pos.getZ(v);
    const angle = Math.atan2(z, x);

    const u = 0.5 + Math.cos(angle) * (t * 0.47);
    const vCoord = 0.5 + Math.sin(angle) * (t * 0.47);

    uvs.setXY(v, u, vCoord);
  }
  uvs.needsUpdate = true;
}

/**
 * Applies exact radial UV mapping to mushroom gills LatheGeometry.
 * Aligns radial lamellae fins from inner stalk junction to outer rim.
 */
function applyRadialUVsToMushroomGills(geom, points) {
  const maxR = points[points.length - 1].x;
  const tFactors = points.map(p => p.x / maxR);

  const pos = geom.attributes.position;
  const uvs = geom.attributes.uv;
  const count = pos.count;
  const pCount = points.length;

  for (let v = 0; v < count; v++) {
    const pIdx = v % pCount;
    const t = tFactors[pIdx];
    const x = pos.getX(v);
    const z = pos.getZ(v);
    const angle = Math.atan2(z, x);

    const u = 0.5 + Math.cos(angle) * (t * 0.47);
    const vCoord = 0.5 + Math.sin(angle) * (t * 0.47);

    uvs.setXY(v, u, vCoord);
  }
  uvs.needsUpdate = true;
}

/**
 * Creates 100% watertight, high-poly sculpted mushroom cap geometries with ZERO center hole
 * and exact radial UV texture mapping.
 */
function createWatertightCapGeometry(variant = 0) {
  const points = [];
  let rimIndex = 7;

  if (variant === 0) {
    // Broad Umbrella / Saucer Cap (Smooth dome, curved lip, closed underside)
    points.push(new THREE.Vector2(0.0, 1.30));      // Apex strictly at center (0, y)
    points.push(new THREE.Vector2(0.20, 1.28));
    points.push(new THREE.Vector2(0.55, 1.22));
    points.push(new THREE.Vector2(0.95, 1.08));
    points.push(new THREE.Vector2(1.40, 0.80));
    points.push(new THREE.Vector2(1.80, 0.40));
    points.push(new THREE.Vector2(2.05, 0.05));
    points.push(new THREE.Vector2(2.10, -0.10));     // Outer rounded rim (rimIndex = 7)
    points.push(new THREE.Vector2(1.95, -0.22));     // Underlip
    points.push(new THREE.Vector2(1.65, -0.10));     // Underside outer
    points.push(new THREE.Vector2(1.15, 0.15));      // Underside mid
    points.push(new THREE.Vector2(0.55, 0.35));      // Underside inner
    points.push(new THREE.Vector2(0.18, 0.45));      // Stalk junction
    points.push(new THREE.Vector2(0.0, 0.48));       // Closed center underside (no hole!)
    rimIndex = 7;
  } else if (variant === 1) {
    // Tall Alien Bell Dome / Witch's Conical Peak
    points.push(new THREE.Vector2(0.0, 1.90));
    points.push(new THREE.Vector2(0.20, 1.86));
    points.push(new THREE.Vector2(0.50, 1.70));
    points.push(new THREE.Vector2(0.85, 1.40));
    points.push(new THREE.Vector2(1.18, 0.95));
    points.push(new THREE.Vector2(1.42, 0.40));
    points.push(new THREE.Vector2(1.50, -0.05));     // Outer rim (rimIndex = 6)
    points.push(new THREE.Vector2(1.40, -0.22));
    points.push(new THREE.Vector2(1.15, -0.05));
    points.push(new THREE.Vector2(0.75, 0.25));
    points.push(new THREE.Vector2(0.25, 0.48));
    points.push(new THREE.Vector2(0.0, 0.52));
    rimIndex = 6;
  } else if (variant === 2) {
    // Flared Pagoda / Shelf Cap
    points.push(new THREE.Vector2(0.0, 1.50));
    points.push(new THREE.Vector2(0.22, 1.46));
    points.push(new THREE.Vector2(0.55, 1.30));
    points.push(new THREE.Vector2(0.95, 1.08));
    points.push(new THREE.Vector2(1.42, 0.88));
    points.push(new THREE.Vector2(1.85, 0.60));
    points.push(new THREE.Vector2(2.18, 0.12));
    points.push(new THREE.Vector2(2.22, -0.08));     // Outer rim (rimIndex = 7)
    points.push(new THREE.Vector2(2.00, -0.22));
    points.push(new THREE.Vector2(1.55, 0.05));
    points.push(new THREE.Vector2(0.95, 0.32));
    points.push(new THREE.Vector2(0.28, 0.50));
    points.push(new THREE.Vector2(0.0, 0.54));
    rimIndex = 7;
  } else {
    // Wavy Crater / Chanterelle Funnel Bolete Cap (Depressed apex, rising flared trumpet bowl)
    points.push(new THREE.Vector2(0.0, 0.90));
    points.push(new THREE.Vector2(0.25, 0.95));
    points.push(new THREE.Vector2(0.60, 1.12));
    points.push(new THREE.Vector2(1.05, 1.35));
    points.push(new THREE.Vector2(1.55, 1.48));
    points.push(new THREE.Vector2(1.95, 1.35));
    points.push(new THREE.Vector2(2.15, 1.05));
    points.push(new THREE.Vector2(2.18, 0.85));     // Outer flared rim (rimIndex = 7)
    points.push(new THREE.Vector2(1.95, 0.70));
    points.push(new THREE.Vector2(1.45, 0.65));
    points.push(new THREE.Vector2(0.85, 0.55));
    points.push(new THREE.Vector2(0.28, 0.50));
    points.push(new THREE.Vector2(0.0, 0.52));
    rimIndex = 7;
  }

  const geom = new THREE.LatheGeometry(points, 28);
  applyRadialUVsToMushroomCap(geom, points, rimIndex);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Creates glowing underside gill disk matching cap profiles with radial UV mapping.
 */
function createWatertightGillGeometry(variant = 0) {
  const points = [];
  if (variant === 0) {
    points.push(new THREE.Vector2(0.20, 0.44));
    points.push(new THREE.Vector2(0.58, 0.34));
    points.push(new THREE.Vector2(1.16, 0.14));
    points.push(new THREE.Vector2(1.66, -0.11));
    points.push(new THREE.Vector2(1.96, -0.23));
  } else if (variant === 1) {
    points.push(new THREE.Vector2(0.26, 0.47));
    points.push(new THREE.Vector2(0.76, 0.24));
    points.push(new THREE.Vector2(1.16, -0.06));
    points.push(new THREE.Vector2(1.41, -0.23));
  } else if (variant === 2) {
    points.push(new THREE.Vector2(0.29, 0.49));
    points.push(new THREE.Vector2(0.96, 0.31));
    points.push(new THREE.Vector2(1.56, 0.04));
    points.push(new THREE.Vector2(2.01, -0.23));
  } else {
    points.push(new THREE.Vector2(0.28, 0.50));
    points.push(new THREE.Vector2(0.86, 0.54));
    points.push(new THREE.Vector2(1.46, 0.64));
    points.push(new THREE.Vector2(1.96, 0.69));
  }

  const geom = new THREE.LatheGeometry(points, 28);
  applyRadialUVsToMushroomGills(geom, points);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Creates high-poly sculpted stalk geometry variants (Slender fluted vs Squat bolete).
 */
function createHighPolyStalkGeometry(variant = 0) {
  const points = [];
  if (variant === 0) {
    // Slender elegant stalk with veil collar ring and root flare
    points.push(new THREE.Vector2(0.22, 3.20));
    points.push(new THREE.Vector2(0.24, 2.70));
    points.push(new THREE.Vector2(0.38, 2.40)); // veil collar ring
    points.push(new THREE.Vector2(0.26, 2.20));
    points.push(new THREE.Vector2(0.28, 1.50));
    points.push(new THREE.Vector2(0.34, 0.80));
    points.push(new THREE.Vector2(0.46, 0.30));
    points.push(new THREE.Vector2(0.68, 0.00)); // flared base
    points.push(new THREE.Vector2(0.75, -0.15));
  } else {
    // Heavy muscular bulbous bolete stalk
    points.push(new THREE.Vector2(0.32, 3.20));
    points.push(new THREE.Vector2(0.38, 2.60));
    points.push(new THREE.Vector2(0.48, 1.90));
    points.push(new THREE.Vector2(0.58, 1.20));
    points.push(new THREE.Vector2(0.72, 0.50));
    points.push(new THREE.Vector2(0.92, 0.00));
    points.push(new THREE.Vector2(0.98, -0.15));
  }

  const geom = new THREE.LatheGeometry(points, 20);
  geom.computeVertexNormals();
  return geom;
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
    this._buildDenseHighPolyMushroomForest();
    this._initSporeMistParticleSystem();
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

    // 3. High-Poly Textured Mushroom Stalk (Velvety matte finish)
    const stalkTex = createMushroomStalkTexture();
    this.mushroomStalkMaterial = new THREE.MeshStandardMaterial({
      map: stalkTex,
      color: 0x261e33,
      roughness: 0.92,
      metalness: 0.0,
      flatShading: false,
    });

    // 4. Mushroom Cap Textured Variants (Velvety matte finish with zero black spots and zero shiny glare)
    const cyanPalette = {
      apexColor: '#06333d',
      midColor: '#084d5c',
      bodyColor: '#0c687a',
      rimGlowColor: '#18b8cc',
      outerLipColor: '#093d48',
      grainColor: 'rgba(20, 140, 165, 0.22)',
      veinColor: 'rgba(70, 225, 245, 0.65)',
      veinSubtleColor: 'rgba(25, 175, 200, 0.35)',
      spotCoreColor: '#ffffff',
      spotHaloColor: 'rgba(40, 230, 255, 0.85)',
      spotFreckleColor: 'rgba(80, 240, 255, 0.65)',
      seed: 0x48a1,
    };

    const violetPalette = {
      apexColor: '#26053b',
      midColor: '#420c62',
      bodyColor: '#5d1488',
      rimGlowColor: '#a826db',
      outerLipColor: '#28073c',
      grainColor: 'rgba(130, 35, 185, 0.22)',
      veinColor: 'rgba(225, 80, 255, 0.65)',
      veinSubtleColor: 'rgba(175, 45, 220, 0.35)',
      spotCoreColor: '#ffffff',
      spotHaloColor: 'rgba(230, 60, 255, 0.85)',
      spotFreckleColor: 'rgba(240, 100, 255, 0.65)',
      seed: 0x48b2,
    };

    const emeraldPalette = {
      apexColor: '#062e13',
      midColor: '#0c4c22',
      bodyColor: '#146830',
      rimGlowColor: '#22b852',
      outerLipColor: '#083516',
      grainColor: 'rgba(25, 150, 65, 0.22)',
      veinColor: 'rgba(70, 245, 125, 0.65)',
      veinSubtleColor: 'rgba(35, 190, 85, 0.35)',
      spotCoreColor: '#ffffff',
      spotHaloColor: 'rgba(45, 245, 105, 0.85)',
      spotFreckleColor: 'rgba(90, 255, 145, 0.65)',
      seed: 0x48c3,
    };

    const amberPalette = {
      apexColor: '#381e05',
      midColor: '#5c3108',
      bodyColor: '#8a4b0d',
      rimGlowColor: '#f79d1e',
      outerLipColor: '#3b1f06',
      grainColor: 'rgba(200, 110, 20, 0.22)',
      veinColor: 'rgba(255, 185, 45, 0.65)',
      veinSubtleColor: 'rgba(215, 140, 25, 0.35)',
      spotCoreColor: '#ffffff',
      spotHaloColor: 'rgba(255, 205, 75, 0.85)',
      spotFreckleColor: 'rgba(255, 225, 115, 0.65)',
      seed: 0x48d4,
    };

    const capTex0 = createMushroomCapTexture(cyanPalette);
    const capTex1 = createMushroomCapTexture(violetPalette);
    const capTex2 = createMushroomCapTexture(emeraldPalette);
    const capTex3 = createMushroomCapTexture(amberPalette);

    this.capMaterials = [
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissiveMap: capTex0,
        emissive: 0xffffff,
        emissiveIntensity: 1.05,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: false,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissiveMap: capTex1,
        emissive: 0xffffff,
        emissiveIntensity: 1.15,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: false,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissiveMap: capTex2,
        emissive: 0xffffff,
        emissiveIntensity: 1.00,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: false,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissiveMap: capTex3,
        emissive: 0xffffff,
        emissiveIntensity: 1.10,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: false,
      }),
    ];

    // 5. Underside Gills with Radiating Glowing Lamellae Texture
    const gillTex0 = createMushroomGillTexture('#00e5ff', 'rgba(0, 180, 220, 0.5)');
    const gillTex1 = createMushroomGillTexture('#d828ff', 'rgba(180, 30, 220, 0.5)');
    const gillTex2 = createMushroomGillTexture('#18e860', 'rgba(20, 190, 70, 0.5)');
    const gillTex3 = createMushroomGillTexture('#ffb703', 'rgba(230, 150, 20, 0.5)');

    this.gillMaterials = [
      new THREE.MeshBasicMaterial({ map: gillTex0, color: 0xffffff, transparent: true, opacity: 0.96 }),
      new THREE.MeshBasicMaterial({ map: gillTex1, color: 0xffffff, transparent: true, opacity: 0.96 }),
      new THREE.MeshBasicMaterial({ map: gillTex2, color: 0xffffff, transparent: true, opacity: 0.96 }),
      new THREE.MeshBasicMaterial({ map: gillTex3, color: 0xffffff, transparent: true, opacity: 0.96 }),
    ];
  }

  /**
   * Returns an array of solid colliders { x, z, radius } for all boundary objects.
   */
  getColliders() {
    const colliders = [];

    // 1. Monoliths (Giant radius)
    for (const m of this.cliffMonolithsData ?? []) {
      colliders.push({ x: m.x, z: m.z, radius: 3.0 * m.scaleXZ * 0.85 });
    }

    // 2. Buttresses (Colossal radius)
    for (const b of this.cliffButtressesData ?? []) {
      colliders.push({ x: b.x, z: b.z, radius: 3.2 * b.scaleXZ * 0.85 });
    }

    // 3. Spires
    for (const s of this.spiresData ?? []) {
      colliders.push({ x: s.x, z: s.z, radius: 0.85 * s.scaleXZ * 0.85 });
    }

    // 4. Boulders
    for (const b of this.bouldersData ?? []) {
      colliders.push({ x: b.x, z: b.z, radius: 1.35 * b.scaleXZ * 0.85 });
    }

    // 5. Giant Mushroom Stalks (solid base)
    for (const m of this.mushroomData ?? []) {
      if (m.scale >= 0.70) {
        colliders.push({ x: m.x, z: m.z, radius: 0.65 * m.scale * 0.85 });
      }
    }

    return colliders;
  }

  /**
   * Extended Outer Cavern Ground Bed (Radius 44.5m to 160m):
   * Sculpted mountainous craggy ridges and rock terracing in dark gray slate tones.
   */
  _buildExtendedCavernGround() {
    const innerHalf = this.halfSize - 0.5; // ~44.5m
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

    const totalSteps = segments * 4;
    const rows = [
      { halfW: innerHalf, depthY: 0, lum: 0.75 },
      { halfW: innerHalf + 12, depthY: 1.0, lum: 0.636 },
      { halfW: innerHalf + 28, depthY: 2.2, lum: 0.522 },
      { halfW: innerHalf + 50, depthY: 3.8, lum: 0.418 },
      { halfW: innerHalf + 80, depthY: 5.5, lum: 0.323 },
      { halfW: outerHalf, depthY: 7.2, lum: 0.237 },
    ];

    const colorRng = makeRng(0x8192a3);

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const isInner = r === 0;

      for (let i = 0; i < totalSteps; i++) {
        const t = (i / totalSteps) * 4.0;
        const p = getPerimeterCoord(t, row.halfW);
        
        let groundY;
        if (isInner) {
          groundY = getTerrainHeight(p.x, p.z);
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
    });

    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    this.group.add(groundMesh);
    this.outerGroundMesh = groundMesh;
  }

  /**
   * Generates colossal cavern wall cliffs & monoliths (12m–28m high).
   */
  _buildToweringCavernWallCliffs() {
    const rawCliffMonolithGeom = new THREE.CylinderGeometry(2.2, 3.8, 18.0, 7);
    rawCliffMonolithGeom.translate(0, 9.0, 0);
    const cliffMonolithGeom = applyTriplanarRockUVs(rawCliffMonolithGeom, 0.45);

    const rawGiantButtressGeom = new THREE.ConeGeometry(3.5, 24.0, 7);
    rawGiantButtressGeom.translate(0, 12.0, 0);
    const giantButtressGeom = applyTriplanarRockUVs(rawGiantButtressGeom, 0.40);

    const monolithPositions = [];
    const countPerSide = 24;
    const boundaryHalf = this.halfSize + 6.0;

    const addCliff = (baseX, baseZ, normalX, normalZ) => {
      const isBottom = (baseZ > 0 && normalZ > 0);
      const jitterDist = (this.rng() - 0.5) * 6.0;
      const depthOffset = (this.rng() - 0.1) * 8.0;
      const x = baseX + depthOffset * normalX + jitterDist * -normalZ;
      const z = baseZ + depthOffset * normalZ + jitterDist * normalX;

      const isButtress = isBottom ? false : (this.rng() > 0.65);
      const scaleXZ = isBottom ? (1.4 + this.rng() * 1.6) : (1.2 + this.rng() * 1.8);
      const scaleY = isBottom ? (0.7 + this.rng() * 0.6) : (1.2 + this.rng() * 1.5);
      const rotY = this.rng() * Math.PI * 2;
      const tiltX = (this.rng() - 0.5) * 0.20;
      const tiltZ = (this.rng() - 0.5) * 0.20;

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
      const coord = frac * (boundaryHalf + 4.0);

      addCliff(coord, -boundaryHalf, 0, -1);
      if (i % 2 === 0) addCliff(coord, boundaryHalf, 0, 1);
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
      for (let k = 0; k < 6; k++) {
        const angle = this.rng() * Math.PI * 2;
        const dist = 2.0 + this.rng() * 9.0;
        monolithPositions.push({
          x: c.x + Math.cos(angle) * dist,
          z: c.z + Math.sin(angle) * dist,
          scaleXZ: 1.5 + this.rng() * 2.2,
          scaleY: isBottom ? (0.8 + this.rng() * 0.6) : (1.4 + this.rng() * 1.8),
          rotY: this.rng() * Math.PI * 2,
          tiltX: (this.rng() - 0.5) * 0.25,
          tiltZ: (this.rng() - 0.5) * 0.25,
          isButtress: isBottom ? false : true,
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
   * Generates dense multi-row stalagmite palisades and spires along the boundary.
   */
  _buildDenseStalagmitePalisades() {
    const rawStalagmiteGeom = new THREE.ConeGeometry(0.85, 5.5, 8);
    rawStalagmiteGeom.translate(0, 2.75, 0);
    const stalagmiteGeom = applyTriplanarRockUVs(rawStalagmiteGeom, 0.85);

    const rawBoulderGeom = new THREE.DodecahedronGeometry(1.4, 0);
    rawBoulderGeom.translate(0, 1.0, 0);
    const boulderGeom = applyTriplanarRockUVs(rawBoulderGeom, 1.1);

    const perimeterPositions = [];
    const countPerSide = 48;
    const boundaryHalf = this.halfSize - 2.5; // ~42.5m

    const addPillar = (baseX, baseZ, normalX, normalZ) => {
      const isBottom = (baseZ > 0 && normalZ > 0);
      const jitterDist = (this.rng() - 0.5) * (isBottom ? 4.5 : 3.5);
      const depthOffset = isBottom ? (1.2 + this.rng() * 3.8) : (this.rng() * 4.5);
      const x = baseX + depthOffset * normalX + jitterDist * -normalZ;
      const z = baseZ + depthOffset * normalZ + jitterDist * normalX;

      // Bottom boundary rocks are non-pointy, rounded dodecahedron boulders
      const isTallSpire = isBottom ? false : (this.rng() > 0.35);
      const scaleXZ = isBottom ? (1.2 + this.rng() * 1.3) : (0.9 + this.rng() * 1.5);
      const scaleY = isBottom ? (0.65 + this.rng() * 0.50) : (isTallSpire ? (1.4 + this.rng() * 2.2) : (0.8 + this.rng() * 0.9));
      const rotY = this.rng() * Math.PI * 2;
      const tiltX = (this.rng() - 0.5) * 0.35;
      const tiltZ = (this.rng() - 0.5) * 0.35;

      perimeterPositions.push({
        x,
        z,
        scaleXZ,
        scaleY,
        rotY,
        tiltX,
        tiltZ,
        isTallSpire,
      });
    };

    for (let i = 0; i < countPerSide; i++) {
      const frac = (i / (countPerSide - 1)) * 2 - 1;
      const coord = frac * (boundaryHalf + 1.5);

      addPillar(coord, -boundaryHalf, 0, -1);
      if (i % 3 !== 2) addPillar(coord, boundaryHalf, 0, 1);
      addPillar(-boundaryHalf, coord, -1, 0);
      addPillar(boundaryHalf, coord, 1, 0);
    }

    const corners = [
      { x: -boundaryHalf, z: -boundaryHalf },
      { x: boundaryHalf, z: -boundaryHalf },
      { x: boundaryHalf, z: boundaryHalf },
      { x: -boundaryHalf, z: boundaryHalf },
    ];
    for (const c of corners) {
      const isBottom = c.z > 0;
      const cornerCount = isBottom ? 8 : 12;
      for (let k = 0; k < cornerCount; k++) {
        const angle = this.rng() * Math.PI * 2;
        const dist = 0.5 + this.rng() * 5.0;
        perimeterPositions.push({
          x: c.x + Math.cos(angle) * dist,
          z: c.z + Math.sin(angle) * dist,
          scaleXZ: 1.1 + this.rng() * 1.4,
          scaleY: isBottom ? (0.7 + this.rng() * 0.5) : (1.6 + this.rng() * 2.4),
          rotY: this.rng() * Math.PI * 2,
          tiltX: (this.rng() - 0.5) * 0.35,
          tiltZ: (this.rng() - 0.5) * 0.35,
          isTallSpire: isBottom ? false : true,
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

    // 1. Boundary Spires (matching the rock terrain material, no green tint)
    if (spires.length > 0) {
      const spireMesh = new THREE.InstancedMesh(stalagmiteGeom, this.rockMaterial, spires.length);
      spires.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y - 0.2, p.z);
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

  /**
   * Generates a rich, natural forest of High-Poly Sculpted Bioluminescent Fungi
   * featuring organic multi-tier sizing, natural clustered groves, and varied silhouettes.
   */
  _buildDenseHighPolyMushroomForest() {
    const stalkGeoms = [
      createHighPolyStalkGeometry(0), // Slender fluted stalk
      createHighPolyStalkGeometry(1), // Muscular bolete trunk
    ];
    const capGeoms = [
      createWatertightCapGeometry(0), // Broad Umbrella Saucer
      createWatertightCapGeometry(1), // Tall Bell / Witch's Peak
      createWatertightCapGeometry(2), // Flared Pagoda Shelf
      createWatertightCapGeometry(3), // Wavy Chanterelle Funnel
    ];
    const gillGeoms = [
      createWatertightGillGeometry(0),
      createWatertightGillGeometry(1),
      createWatertightGillGeometry(2),
      createWatertightGillGeometry(3),
    ];

    // Gather all rock colliders with full physical 3D mesh footprints to guarantee zero rock intersection
    const rockObstacles = [];
    for (const m of this.cliffMonolithsData ?? []) {
      rockObstacles.push({ x: m.x, z: m.z, radius: 3.8 * m.scaleXZ + 0.3 });
    }
    for (const b of this.cliffButtressesData ?? []) {
      rockObstacles.push({ x: b.x, z: b.z, radius: 3.5 * b.scaleXZ + 0.3 });
    }
    for (const s of this.spiresData ?? []) {
      rockObstacles.push({ x: s.x, z: s.z, radius: 0.85 * s.scaleXZ + 0.5 });
    }
    for (const b of this.bouldersData ?? []) {
      rockObstacles.push({ x: b.x, z: b.z, radius: 1.40 * b.scaleXZ + 0.3 });
    }

    const getMushroomRockClearance = (scale) => {
      // Stalk base clearance against rock meshes
      return 0.75 * scale + 0.65;
    };

    const getMushroomMushroomClearance = (scale) => {
      // Stalk clearance between mushrooms
      return 0.75 * scale + 0.30;
    };

    const mushroomPlacements = [];

    const isPositionClear = (x, z, scale) => {
      const rockClearance = getMushroomRockClearance(scale);
      for (let i = 0; i < rockObstacles.length; i++) {
        const obs = rockObstacles[i];
        const dx = x - obs.x;
        const dz = z - obs.z;
        const minDist = obs.radius + rockClearance;
        if (dx * dx + dz * dz < minDist * minDist) {
          return false;
        }
      }

      const mushClearance = getMushroomMushroomClearance(scale);
      for (let i = 0; i < mushroomPlacements.length; i++) {
        const m = mushroomPlacements[i];
        const dx = x - m.x;
        const dz = z - m.z;
        const minDist = getMushroomMushroomClearance(m.scale) + mushClearance;
        if (dx * dx + dz * dz < minDist * minDist) {
          return false;
        }
      }

      return true;
    };

    // Organic clustered grove sampling with non-uniform density and natural clearings
    const groveAnchors = [];
    // Top boundary: 32 candidate seeds with non-uniform clumped distribution
    for (let i = 0; i < 32; i++) {
      const baseFrac = (i / 31.0) * 2 - 1;
      const clumpJitter = (this.rng() - 0.5) * 0.14 + Math.sin(baseFrac * Math.PI * 3) * 0.08;
      const frac = THREE.MathUtils.clamp(baseFrac + clumpJitter, -0.96, 0.96);
      groveAnchors.push({ side: 0, frac });
    }

    // Left & Right boundaries: 20 candidate seeds each
    for (let i = 0; i < 20; i++) {
      const baseFrac = (i / 19.0) * 2 - 1;
      const clumpJitter = (this.rng() - 0.5) * 0.14;
      const frac = THREE.MathUtils.clamp(baseFrac + clumpJitter, -0.96, 0.96);
      groveAnchors.push({ side: 3, frac });
      groveAnchors.push({ side: 1, frac });
    }

    // Bottom boundary: 24 candidate seeds
    for (let i = 0; i < 24; i++) {
      const baseFrac = (i / 23.0) * 2 - 1;
      const clumpJitter = (this.rng() - 0.5) * 0.14;
      const frac = THREE.MathUtils.clamp(baseFrac + clumpJitter, -0.96, 0.96);
      groveAnchors.push({ side: 2, frac });
    }

    for (const anchor of groveAnchors) {
      const { side, frac } = anchor;
      const offset = frac * 42.0;
      const isBottom = side === 2;

      // Multi-tier size distribution:
      // ~16% Hero/Giant, ~48% Mature standard, ~36% Petite/Young
      const sizeRoll = this.rng();
      let candScale = 0;
      let stalkHeight = 0;

      if (sizeRoll < 0.16 && !isBottom) {
        // Hero/Giant Mushroom (sprinkled naturally on top and sides!)
        candScale = 1.35 + this.rng() * 0.35; // 1.35 – 1.70
        stalkHeight = 3.6 + this.rng() * 1.0; // 3.6m – 4.6m
      } else if (sizeRoll < 0.64) {
        // Mature Standard Mushroom
        candScale = isBottom ? (0.75 + this.rng() * 0.35) : (0.80 + this.rng() * 0.40); // 0.75 – 1.20
        stalkHeight = isBottom ? (2.0 + this.rng() * 1.2) : (2.4 + this.rng() * 1.2); // 2.0m – 3.6m
      } else {
        // Petite / Young Mushroom
        candScale = isBottom ? (0.50 + this.rng() * 0.25) : (0.55 + this.rng() * 0.25); // 0.50 – 0.80
        stalkHeight = isBottom ? (1.5 + this.rng() * 0.8) : (1.7 + this.rng() * 0.9); // 1.5m – 2.6m
      }

      let rootX = 0;
      let rootZ = 0;
      let validRoot = false;

      // Multi-band organic depth sampling
      for (let attempt = 0; attempt < 40; attempt++) {
        let rx = 0;
        let rz = 0;
        const depthJitter = this.rng();

        if (side === 0) {
          // Forward northern border: Z from -37.8m to -43.0m
          rx = offset + (this.rng() - 0.5) * 6.0;
          rz = -37.8 - depthJitter * 5.2;
        } else if (side === 1) {
          rx = 38.2 + depthJitter * 5.5;
          rz = offset + (this.rng() - 0.5) * 6.0;
        } else if (side === 2) {
          rx = offset + (this.rng() - 0.5) * 6.0;
          rz = 40.2 + depthJitter * 4.5;
        } else {
          rx = -38.2 - depthJitter * 5.5;
          rz = offset + (this.rng() - 0.5) * 6.0;
        }

        if (isPositionClear(rx, rz, candScale)) {
          rootX = rx;
          rootZ = rz;
          validRoot = true;
          break;
        }
      }

      if (!validRoot) continue;

      // Inward canopy lean + subtle organic crook
      const leanBias = 0.08 + this.rng() * 0.16;
      const sideCrook = (this.rng() - 0.5) * 0.14;
      let mainTiltX = 0;
      let mainTiltZ = 0;

      if (side === 0) {
        mainTiltX = leanBias;
        mainTiltZ = sideCrook;
      } else if (side === 2) {
        mainTiltX = -leanBias;
        mainTiltZ = sideCrook;
      } else if (side === 1) {
        mainTiltZ = -leanBias;
        mainTiltX = sideCrook;
      } else {
        mainTiltZ = leanBias;
        mainTiltX = sideCrook;
      }

      const variant = Math.floor(this.rng() * 4);
      const stalkVariant = this.rng() > 0.65 ? 1 : 0;
      const fatness = 0.85 + this.rng() * 0.35;
      const capSquash = 0.82 + this.rng() * 0.36;
      const capAspectX = 0.94 + this.rng() * 0.12;
      const capAspectZ = 0.94 + this.rng() * 0.12;
      const rotY = this.rng() * Math.PI * 2;

      // 1. Mother Mushroom
      mushroomPlacements.push({
        x: rootX,
        z: rootZ,
        variant,
        stalkVariant,
        scale: candScale,
        stalkHeight,
        fatness,
        capSquash,
        capAspectX,
        capAspectZ,
        tiltX: mainTiltX,
        tiltZ: mainTiltZ,
        rotY,
        side,
      });

      // 2. Organic Variable Companions:
      // 20% solitary (0 comp), 40% 1 comp, 30% 2 comp, 10% 3 comp
      const clusterRoll = this.rng();
      const maxComps = clusterRoll < 0.20 ? 0 : (clusterRoll < 0.60 ? 1 : (clusterRoll < 0.90 ? 2 : 3));

      let lastAngle = isBottom ? (0.15 * Math.PI + this.rng() * 0.7 * Math.PI) : (this.rng() * Math.PI * 2);

      for (let c = 0; c < maxComps; c++) {
        const compRatio = c === 0 ? (0.42 + this.rng() * 0.22) : (c === 1 ? (0.28 + this.rng() * 0.16) : (0.18 + this.rng() * 0.12));
        const compScale = candScale * compRatio;
        const compHeight = stalkHeight * (0.35 + this.rng() * 0.25);
        const compMinDist = getMushroomMushroomClearance(candScale) + getMushroomMushroomClearance(compScale);

        const angleStep = (0.35 + this.rng() * 0.50) * (isBottom ? Math.PI : Math.PI * 2);
        const candAngle = lastAngle + angleStep;

        for (let a = 0; a < 8; a++) {
          const testAngle = candAngle + (a / 8) * (isBottom ? Math.PI : Math.PI * 2);
          const testDist = compMinDist + this.rng() * 0.35;
          const cx = rootX + Math.cos(testAngle) * testDist;
          const cz = rootZ + Math.sin(testAngle) * testDist;

          if (isPositionClear(cx, cz, compScale)) {
            const compTiltX = mainTiltX * (0.8 + this.rng() * 0.6) + (this.rng() - 0.5) * 0.15;
            const compTiltZ = mainTiltZ * (0.8 + this.rng() * 0.6) + (this.rng() - 0.5) * 0.15;
            const compVariant = (variant + (c + 1)) % 4;
            const compStalkVar = this.rng() > 0.75 ? 1 : 0;
            const compFatness = 0.85 + this.rng() * 0.35;
            const compCapSquash = 0.85 + this.rng() * 0.30;
            const compAspectX = 0.94 + this.rng() * 0.12;
            const compAspectZ = 0.94 + this.rng() * 0.12;

            mushroomPlacements.push({
              x: cx,
              z: cz,
              variant: compVariant,
              stalkVariant: compStalkVar,
              scale: compScale,
              stalkHeight: compHeight,
              fatness: compFatness,
              capSquash: compCapSquash,
              capAspectX: compAspectX,
              capAspectZ: compAspectZ,
              tiltX: compTiltX,
              tiltZ: compTiltZ,
              rotY: this.rng() * Math.PI * 2,
              side,
            });
            lastAngle = testAngle;
            break;
          }
        }
      }
    }

    const tempMatrix = new THREE.Matrix4();
    const tempPos = new THREE.Vector3();
    const tempQuat = new THREE.Quaternion();
    const tempEuler = new THREE.Euler();
    const tempScale = new THREE.Vector3();
    const apexOffset = new THREE.Vector3();
    const capPos = new THREE.Vector3();
    const gillPos = new THREE.Vector3();

    // 1. Stalks (Instanced across 2 stalk variants)
    this.mushroomStalkMeshes = [];
    for (let s = 0; s < 2; s++) {
      const variantStalks = mushroomPlacements.filter(m => (m.stalkVariant ?? 0) === s);
      if (variantStalks.length === 0) continue;

      const stalkMesh = new THREE.InstancedMesh(stalkGeoms[s], this.mushroomStalkMaterial, variantStalks.length);
      variantStalks.forEach((m, i) => {
        const groundY = getTerrainHeight(m.x, m.z);
        tempPos.set(m.x, groundY - 0.15, m.z);
        tempEuler.set(m.tiltX, m.rotY, m.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(m.scale * m.fatness, m.stalkHeight / 3.2, m.scale * m.fatness);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        stalkMesh.setMatrixAt(i, tempMatrix);
      });

      stalkMesh.receiveShadow = false;
      stalkMesh.castShadow = false;
      stalkMesh.instanceMatrix.needsUpdate = true;
      this.group.add(stalkMesh);
      this.mushroomStalkMeshes.push(stalkMesh);
    }

    // 2. Caps & Gills (Instanced across 4 cap variants)
    this.mushroomCapMeshes = [];
    this.mushroomGillMeshes = [];

    for (let v = 0; v < 4; v++) {
      const variantMushrooms = mushroomPlacements.filter(m => m.variant === v);
      if (variantMushrooms.length === 0) continue;

      const capMesh = new THREE.InstancedMesh(capGeoms[v], this.capMaterials[v], variantMushrooms.length);
      const gillMesh = new THREE.InstancedMesh(gillGeoms[v], this.gillMaterials[v], variantMushrooms.length);

      capMesh.receiveShadow = false;
      capMesh.castShadow = false;
      gillMesh.receiveShadow = false;
      gillMesh.castShadow = false;

      variantMushrooms.forEach((m, i) => {
        const groundY = getTerrainHeight(m.x, m.z);
        tempPos.set(m.x, groundY - 0.15, m.z);
        tempEuler.set(m.tiltX, m.rotY, m.tiltZ);
        tempQuat.setFromEuler(tempEuler);

        // Exact 3D apex attachment
        apexOffset.set(0, m.stalkHeight * 0.98, 0).applyQuaternion(tempQuat);
        capPos.copy(tempPos).add(apexOffset);

        tempScale.set(
          m.scale * m.fatness * m.capAspectX,
          m.scale * m.capSquash,
          m.scale * m.fatness * m.capAspectZ
        );
        tempMatrix.compose(capPos, tempQuat, tempScale);
        capMesh.setMatrixAt(i, tempMatrix);

        apexOffset.set(0, m.stalkHeight * 0.98 - 0.04 * m.scale * m.capSquash, 0).applyQuaternion(tempQuat);
        gillPos.copy(tempPos).add(apexOffset);
        tempMatrix.compose(gillPos, tempQuat, tempScale);
        gillMesh.setMatrixAt(i, tempMatrix);
      });

      capMesh.instanceMatrix.needsUpdate = true;
      gillMesh.instanceMatrix.needsUpdate = true;

      this.group.add(capMesh);
      this.group.add(gillMesh);
      this.mushroomCapMeshes.push(capMesh);
      this.mushroomGillMeshes.push(gillMesh);
    }

    this.mushroomData = mushroomPlacements;
  }

  /**
   * Drifting Spore Mist Particle System:
   * Placed right along the perimeter band (38.5m–43.5m) surrounding the mushroom grove
   * so the spores float right around the boundary trees and rocks without invading the inner map.
   */
  _initSporeMistParticleSystem() {
    this.sporeCount = 280;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.sporeCount * 3);
    const colors = new Float32Array(this.sporeCount * 3);
    const sizes = new Float32Array(this.sporeCount);

    this.sporeVelocities = new Float32Array(this.sporeCount * 3);
    this.sporeBasePhase = new Float32Array(this.sporeCount);
    this.sporeLifetimes = new Float32Array(this.sporeCount);

    const minRadius = 38.5; // Placed right at the boundary zone
    const maxRadius = 43.5;

    const colorPalette = [
      new THREE.Color(0x55f0ff), // Radiant Cyan
      new THREE.Color(0xd660ff), // Amethyst Violet
      new THREE.Color(0x55ff99), // Emerald
      new THREE.Color(0x90e0ff), // Shimmering Ice
      new THREE.Color(0xffe080), // Golden Spore Embers
    ];

    for (let i = 0; i < this.sporeCount; i++) {
      const angle = this.rng() * Math.PI * 2;
      const radius = minRadius + Math.sqrt(this.rng()) * (maxRadius - minRadius);

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const groundY = getTerrainHeight(x, z);
      const y = groundY + this.rng() * 6.5 - 0.5;

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      this.sporeVelocities[i * 3 + 0] = (this.rng() - 0.5) * 0.40;
      this.sporeVelocities[i * 3 + 1] = 0.50 + this.rng() * 0.95; // Upward buoyant rise
      this.sporeVelocities[i * 3 + 2] = (this.rng() - 0.5) * 0.40;

      this.sporeBasePhase[i] = this.rng() * Math.PI * 2;
      this.sporeLifetimes[i] = this.rng() * 10.0;

      const col = colorPalette[Math.floor(this.rng() * colorPalette.length)];
      colors[i * 3 + 0] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;

      sizes[i] = 0.28 + this.rng() * 0.55;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const sporeTexture = createSporeParticleTexture();
    const material = new THREE.PointsMaterial({
      size: 0.85,
      map: sporeTexture,
      transparent: true,
      opacity: 0.85,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.sporePoints = new THREE.Points(geometry, material);
    this.group.add(this.sporePoints);
    this.elapsedTime = 0;
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
    const time = this.elapsedTime;

    if (this.sporePoints) {
      const posAttr = this.sporePoints.geometry.attributes.position;
      const positions = posAttr.array;
      const minRadius = 38.5;
      const maxRadius = 43.5;

      for (let i = 0; i < this.sporeCount; i++) {
        const i3 = i * 3;
        const phase = this.sporeBasePhase[i] + time * 1.6;

        positions[i3 + 0] += (this.sporeVelocities[i3 + 0] + Math.sin(phase) * 0.14) * deltaTime;
        positions[i3 + 1] += this.sporeVelocities[i3 + 1] * deltaTime;
        positions[i3 + 2] += (this.sporeVelocities[i3 + 2] + Math.cos(phase * 0.85) * 0.14) * deltaTime;

        const curX = positions[i3 + 0];
        const curZ = positions[i3 + 2];
        const groundY = getTerrainHeight(curX, curZ);

        if (positions[i3 + 1] > groundY + 7.5) {
          positions[i3 + 1] = groundY - 0.4 - Math.random() * 1.5;

          const angle = Math.random() * Math.PI * 2;
          const radius = minRadius + Math.sqrt(Math.random()) * (maxRadius - minRadius);
          positions[i3 + 0] = Math.cos(angle) * radius;
          positions[i3 + 2] = Math.sin(angle) * radius;
        }
      }

      posAttr.needsUpdate = true;
    }

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

    // Dynamic subtle breathing glow on the high-poly mushroom caps (balanced vibrancy without glare)
    const pulse1 = 1.10 + Math.sin(time * 2.0) * 0.15;
    const pulse2 = 1.20 + Math.cos(time * 1.7) * 0.18;
    const pulse3 = 1.05 + Math.sin(time * 2.3 + 1.0) * 0.14;
    const pulse4 = 1.12 + Math.cos(time * 1.9 + 2.0) * 0.16;

    if (this.capMaterials[0]) this.capMaterials[0].emissiveIntensity = pulse1;
    if (this.capMaterials[1]) this.capMaterials[1].emissiveIntensity = pulse2;
    if (this.capMaterials[2]) this.capMaterials[2].emissiveIntensity = pulse3;
    if (this.capMaterials[3]) this.capMaterials[3].emissiveIntensity = pulse4;
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
        tempPos.set(p.x, y - 0.2, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.spireMesh.setMatrixAt(i, tempMatrix);
      });
      this.spireMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.crystalSpireMesh && this.crystalSpiresData) {
      this.crystalSpiresData.forEach((p, i) => {
        const y = getTerrainHeight(p.x, p.z);
        tempPos.set(p.x, y - 0.2, p.z);
        tempEuler.set(p.tiltX, p.rotY, p.tiltZ);
        tempQuat.setFromEuler(tempEuler);
        tempScale.set(p.scaleXZ, p.scaleY, p.scaleXZ);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.crystalSpireMesh.setMatrixAt(i, tempMatrix);
      });
      this.crystalSpireMesh.instanceMatrix.needsUpdate = true;
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

    if (this.mushroomStalkMeshes && this.mushroomData) {
      const apexOffset = new THREE.Vector3();
      const capPos = new THREE.Vector3();
      const gillPos = new THREE.Vector3();

      for (let s = 0; s < 2; s++) {
        const stalkMesh = this.mushroomStalkMeshes[s];
        if (!stalkMesh) continue;
        const variantStalks = (this.mushroomData || []).filter(m => (m.stalkVariant ?? 0) === s);
        variantStalks.forEach((m, i) => {
          const groundY = getTerrainHeight(m.x, m.z);
          tempPos.set(m.x, groundY - 0.15, m.z);
          tempEuler.set(m.tiltX, m.rotY, m.tiltZ);
          tempQuat.setFromEuler(tempEuler);
          tempScale.set(m.scale * m.fatness, m.stalkHeight / 3.2, m.scale * m.fatness);
          tempMatrix.compose(tempPos, tempQuat, tempScale);
          stalkMesh.setMatrixAt(i, tempMatrix);
        });
        stalkMesh.instanceMatrix.needsUpdate = true;
      }

      for (let v = 0; v < 4; v++) {
        const capMesh = this.mushroomCapMeshes?.[v];
        const gillMesh = this.mushroomGillMeshes?.[v];
        if (!capMesh || !gillMesh) continue;
        const variantMushrooms = (this.mushroomData || []).filter(m => m.variant === v);
        variantMushrooms.forEach((m, i) => {
          const groundY = getTerrainHeight(m.x, m.z);
          tempPos.set(m.x, groundY - 0.15, m.z);
          tempEuler.set(m.tiltX, m.rotY, m.tiltZ);
          tempQuat.setFromEuler(tempEuler);

          apexOffset.set(0, m.stalkHeight * 0.98, 0).applyQuaternion(tempQuat);
          capPos.copy(tempPos).add(apexOffset);

          tempScale.set(
            m.scale * m.fatness * m.capAspectX,
            m.scale * m.capSquash,
            m.scale * m.fatness * m.capAspectZ
          );
          tempMatrix.compose(capPos, tempQuat, tempScale);
          capMesh.setMatrixAt(i, tempMatrix);

          apexOffset.set(0, m.stalkHeight * 0.98 - 0.04 * m.scale * m.capSquash, 0).applyQuaternion(tempQuat);
          gillPos.copy(tempPos).add(apexOffset);
          tempMatrix.compose(gillPos, tempQuat, tempScale);
          gillMesh.setMatrixAt(i, tempMatrix);
        });
        capMesh.instanceMatrix.needsUpdate = true;
        gillMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
