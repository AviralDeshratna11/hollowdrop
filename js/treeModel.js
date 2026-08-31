import * as THREE from 'three';

/**
 * treeModel.js — Vast-Canopy Asymmetrical Subterranean Tree Generator
 *
 * Implements majestic subterranean canopy trees tailored for HollowDrop:
 * - Sleek, organically curved trunk with buttress root flares anchoring into the ground.
 * - Outward-reaching asymmetrical structural boughs that sweep horizontally across 6–10 meters.
 * - Off-center trunk geometry: the trunk base is placed along the periphery, letting the
 *   canopy stretch broadly over the cavern floor (spanning 16–22 meters across).
 * - High overhead clearance (y = 3.0m–6.5m): player slime (y ~ 0.6m) and all cavern creatures
 *   can walk completely unobstructed beneath the foliage.
 * - Top-down camera obscuration: dense multi-tiered canopy layers obscure top-down vision of
 *   entities moving underneath.
 * - Bioluminescent spore pods & luminous vein accents matching HollowDrop's ACES Filmic lighting.
 * - Performance optimized: All wood geometries and all leaf geometries are merged into
 *   single unified BufferGeometries, minimizing draw calls to 2–3 per tree with smooth vertex normals.
 */

/**
 * Deterministic PRNG for tree generation.
 */
function createRng(seed = 0x54726565) {
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
 * Merges multiple THREE.BufferGeometry instances into a single BufferGeometry
 * with combined position, normal, and uv buffers. Zero external dependencies.
 */
function mergeBufferGeometries(geometries) {
  if (!geometries || geometries.length === 0) {
    return new THREE.BufferGeometry();
  }
  if (geometries.length === 1) {
    return geometries[0];
  }

  let totalVerts = 0;
  let totalIndices = 0;

  for (const geom of geometries) {
    totalVerts += geom.attributes.position.count;
    if (geom.index) {
      totalIndices += geom.index.count;
    } else {
      totalIndices += geom.attributes.position.count;
    }
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  let vertOffset = 0;
  let indexOffset = 0;

  for (const geom of geometries) {
    const pos = geom.attributes.position;
    const norm = geom.attributes.normal;
    const uv = geom.attributes.uv;
    const vCount = pos.count;

    positions.set(pos.array, vertOffset * 3);

    if (norm) {
      normals.set(norm.array, vertOffset * 3);
    }
    if (uv) {
      uvs.set(uv.array, vertOffset * 2);
    }

    if (geom.index) {
      const idx = geom.index.array;
      for (let i = 0; i < idx.length; i++) {
        indices[indexOffset + i] = idx[i] + vertOffset;
      }
      indexOffset += idx.length;
    } else {
      for (let i = 0; i < vCount; i++) {
        indices[indexOffset + i] = vertOffset + i;
      }
      indexOffset += vCount;
    }

    vertOffset += vCount;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeVertexNormals();

  return merged;
}

// --- Procedural Canvas Texture Generation -------------------------------------
const foliageTextureCache = new Map();
const barkTextureCache = new Map();

/**
 * Creates high-detail procedural textures for leaf canopy:
 * - Color map: rich multi-tonal organic leaf scales, radial leaf venation, and spore speckles.
 * - Bump map: tactile relief for veins, lobe ridges, and cellular depth.
 * - Emissive map: subtle glowing micro-capillaries matching bioluminescent theme.
 */
function getOrCreateFoliageTextures(foliageColorHex, sporeColorHex) {
  const key = `${foliageColorHex}_${sporeColorHex}`;
  if (foliageTextureCache.has(key)) {
    return foliageTextureCache.get(key);
  }

  const baseCol = new THREE.Color(foliageColorHex);
  const sporeCol = new THREE.Color(sporeColorHex);

  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext('2d');

  const emissiveCanvas = document.createElement('canvas');
  emissiveCanvas.width = size;
  emissiveCanvas.height = size;
  const emCtx = emissiveCanvas.getContext('2d');

  // Base background
  const baseR = Math.floor(baseCol.r * 255 * 0.7);
  const baseG = Math.floor(baseCol.g * 255 * 0.7);
  const baseB = Math.floor(baseCol.b * 255 * 0.7);
  ctx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
  ctx.fillRect(0, 0, size, size);

  bumpCtx.fillStyle = '#7a7a7a';
  bumpCtx.fillRect(0, 0, size, size);

  emCtx.fillStyle = '#000000';
  emCtx.fillRect(0, 0, size, size);

  const cx = size * 0.5;
  const cy = size * 0.5;
  const rng = createRng(0x4c656166);

  // 1. Organic overlapping leaf scales / fronds
  const leafCount = 380;
  for (let i = 0; i < leafCount; i++) {
    const angle = rng() * Math.PI * 2;
    const distFrac = Math.sqrt(rng());
    const dist = distFrac * (size * 0.48);
    const lx = cx + Math.cos(angle) * dist;
    const ly = cy + Math.sin(angle) * dist;
    const leafRadius = 14 + rng() * 24;

    const tone = 0.75 + rng() * 0.55;
    const r = Math.min(255, Math.floor(baseCol.r * 255 * tone + rng() * 18));
    const g = Math.min(255, Math.floor(baseCol.g * 255 * tone + (1.0 - distFrac) * 35 + rng() * 30));
    const b = Math.min(255, Math.floor(baseCol.b * 255 * tone + rng() * 22));

    const grad = ctx.createRadialGradient(lx, ly, leafRadius * 0.1, lx, ly, leafRadius);
    grad.addColorStop(0, `rgba(${Math.min(255, r + 28)}, ${Math.min(255, g + 38)}, ${Math.min(255, b + 28)}, 0.88)`);
    grad.addColorStop(0.65, `rgba(${r}, ${g}, ${b}, 0.72)`);
    grad.addColorStop(1, `rgba(${Math.floor(r * 0.45)}, ${Math.floor(g * 0.45)}, ${Math.floor(b * 0.45)}, 0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lx, ly, leafRadius, 0, Math.PI * 2);
    ctx.fill();

    // Bump map for leaf clumps
    const bumpGrad = bumpCtx.createRadialGradient(lx, ly, 0, lx, ly, leafRadius);
    bumpGrad.addColorStop(0, 'rgba(235, 235, 235, 0.45)');
    bumpGrad.addColorStop(0.6, 'rgba(160, 160, 160, 0.22)');
    bumpGrad.addColorStop(1, 'rgba(100, 100, 100, 0)');
    bumpCtx.fillStyle = bumpGrad;
    bumpCtx.beginPath();
    bumpCtx.arc(lx, ly, leafRadius, 0, Math.PI * 2);
    bumpCtx.fill();
  }

  // 2. Intricate branching venation network radiating from center
  const mainVeins = 12;
  ctx.strokeStyle = `rgba(${Math.min(255, Math.floor(baseCol.r * 255 * 1.6 + 45))}, ${Math.min(255, Math.floor(baseCol.g * 255 * 1.9 + 65))}, ${Math.min(255, Math.floor(baseCol.b * 255 * 1.6 + 50))}, 0.8)`;
  bumpCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  emCtx.strokeStyle = `rgba(${Math.floor(sporeCol.r * 255)}, ${Math.floor(sporeCol.g * 255)}, ${Math.floor(sporeCol.b * 255)}, 0.7)`;

  for (let v = 0; v < mainVeins; v++) {
    const baseAngle = (v / mainVeins) * Math.PI * 2 + (rng() - 0.5) * 0.15;
    const len = size * 0.47;

    ctx.lineWidth = 3.2;
    bumpCtx.lineWidth = 3.6;
    emCtx.lineWidth = 2.0;

    ctx.beginPath();
    bumpCtx.beginPath();
    emCtx.beginPath();

    let curX = cx;
    let curY = cy;
    ctx.moveTo(curX, curY);
    bumpCtx.moveTo(curX, curY);
    emCtx.moveTo(curX, curY);

    const steps = 8;
    const veinPts = [];
    for (let s = 1; s <= steps; s++) {
      const frac = s / steps;
      const angle = baseAngle + Math.sin(frac * Math.PI * 2) * 0.18;
      curX = cx + Math.cos(angle) * len * frac;
      curY = cy + Math.sin(angle) * len * frac;
      ctx.lineTo(curX, curY);
      bumpCtx.lineTo(curX, curY);
      emCtx.lineTo(curX, curY);
      veinPts.push({ x: curX, y: curY, angle });
    }
    ctx.stroke();
    bumpCtx.stroke();
    emCtx.stroke();

    // Secondary capillary veins branching outward
    ctx.lineWidth = 1.6;
    bumpCtx.lineWidth = 1.8;
    emCtx.lineWidth = 1.0;

    for (let p = 1; p < veinPts.length - 1; p++) {
      const pt = veinPts[p];
      for (const side of [-1, 1]) {
        const subAngle = pt.angle + side * (0.6 + rng() * 0.3);
        const subLen = (18 + rng() * 26) * (1.0 - (p / steps) * 0.4);
        const ex = pt.x + Math.cos(subAngle) * subLen;
        const ey = pt.y + Math.sin(subAngle) * subLen;

        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        bumpCtx.beginPath();
        bumpCtx.moveTo(pt.x, pt.y);
        bumpCtx.lineTo(ex, ey);
        bumpCtx.stroke();

        if (rng() > 0.35) {
          emCtx.beginPath();
          emCtx.moveTo(pt.x, pt.y);
          emCtx.lineTo(ex, ey);
          emCtx.stroke();
        }
      }
    }
  }

  // 3. Bioluminescent Spore flecks along vein junctions
  const sporeFleckCount = 65;
  for (let i = 0; i < sporeFleckCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.pow(rng(), 0.7) * (size * 0.42);
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy + Math.sin(angle) * dist;
    const sr = 2.0 + rng() * 3.5;

    emCtx.fillStyle = `rgba(${Math.floor(sporeCol.r * 255)}, ${Math.floor(sporeCol.g * 255)}, ${Math.floor(sporeCol.b * 255)}, 0.85)`;
    emCtx.beginPath();
    emCtx.arc(sx, sy, sr, 0, Math.PI * 2);
    emCtx.fill();

    ctx.fillStyle = `rgba(${Math.min(255, Math.floor(sporeCol.r * 255 + 90))}, ${Math.min(255, Math.floor(sporeCol.g * 255 + 90))}, ${Math.min(255, Math.floor(sporeCol.b * 255 + 90))}, 0.92)`;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;

  const bundle = { map, bumpMap, emissiveMap };
  foliageTextureCache.set(key, bundle);
  return bundle;
}

/**
 * Creates high-detail procedural textures for tree bark:
 * - Color map: subterranean petrified ironwood grain, mossy crevice patches, and sap channels.
 * - Bump map: deep vertical striations and furrow relief.
 */
function getOrCreateBarkTextures(barkColorHex, sporeColorHex) {
  const key = `${barkColorHex}_${sporeColorHex}`;
  if (barkTextureCache.has(key)) {
    return barkTextureCache.get(key);
  }

  const baseCol = new THREE.Color(barkColorHex);
  const sporeCol = new THREE.Color(sporeColorHex);

  const w = 512;
  const h = 512;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = w;
  colorCanvas.height = h;
  const ctx = colorCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = w;
  bumpCanvas.height = h;
  const bumpCtx = bumpCanvas.getContext('2d');

  const r0 = Math.floor(baseCol.r * 255);
  const g0 = Math.floor(baseCol.g * 255);
  const b0 = Math.floor(baseCol.b * 255);
  ctx.fillStyle = `rgb(${r0}, ${g0}, ${b0})`;
  ctx.fillRect(0, 0, w, h);

  bumpCtx.fillStyle = '#808080';
  bumpCtx.fillRect(0, 0, w, h);

  const rng = createRng(0x4261726b);

  // 1. Vertical Bark Striations & Grooves
  const striations = 180;
  for (let i = 0; i < striations; i++) {
    const x = (i / striations) * w + (rng() - 0.5) * 4;
    const width = 1.2 + rng() * 3.5;
    const shade = 0.55 + rng() * 0.9;
    const isCrevice = rng() < 0.28;

    const r = isCrevice ? Math.floor(r0 * 0.4) : Math.min(255, Math.floor(r0 * shade + (rng() > 0.6 ? 15 : 0)));
    const g = isCrevice ? Math.floor(g0 * 0.4) : Math.min(255, Math.floor(g0 * shade + (rng() > 0.6 ? 22 : 0)));
    const b = isCrevice ? Math.floor(b0 * 0.4) : Math.min(255, Math.floor(b0 * shade + (rng() > 0.6 ? 16 : 0)));

    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, 0);

    const waviness = 3 + rng() * 6;
    const freq = 0.015 + rng() * 0.02;
    const phase = rng() * Math.PI * 2;

    for (let y = 0; y <= h; y += 16) {
      const offsetX = Math.sin(y * freq + phase) * waviness;
      ctx.lineTo(x + offsetX, y);
    }
    ctx.stroke();

    const bumpVal = isCrevice ? 30 : Math.floor(130 + (shade - 0.7) * 120);
    bumpCtx.strokeStyle = `rgb(${bumpVal}, ${bumpVal}, ${bumpVal})`;
    bumpCtx.lineWidth = width * (isCrevice ? 1.4 : 1.0);
    bumpCtx.beginPath();
    bumpCtx.moveTo(x, 0);
    for (let y = 0; y <= h; y += 16) {
      const offsetX = Math.sin(y * freq + phase) * waviness;
      bumpCtx.lineTo(x + offsetX, y);
    }
    bumpCtx.stroke();
  }

  // 2. Mossy lichen patches clinging to bark crevices
  const mossPatches = 45;
  for (let i = 0; i < mossPatches; i++) {
    const mx = rng() * w;
    const my = rng() * h;
    const mr = 8 + rng() * 18;

    const mGrad = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr);
    mGrad.addColorStop(0, 'rgba(28, 68, 48, 0.7)');
    mGrad.addColorStop(0.7, 'rgba(18, 44, 32, 0.45)');
    mGrad.addColorStop(1, 'rgba(10, 25, 18, 0)');

    ctx.fillStyle = mGrad;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Bioluminescent sap capillaries running down bark channels
  const veinCount = 10;
  for (let i = 0; i < veinCount; i++) {
    const vx = (rng() * 0.9 + 0.05) * w;
    ctx.strokeStyle = `rgba(${Math.floor(sporeCol.r * 255)}, ${Math.floor(sporeCol.g * 255)}, ${Math.floor(sporeCol.b * 255)}, 0.45)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(vx, 0);

    const vWave = 4 + rng() * 5;
    const vFreq = 0.02 + rng() * 0.015;
    const vPhase = rng() * Math.PI * 2;
    for (let y = 0; y <= h; y += 12) {
      const offX = Math.sin(y * vFreq + vPhase) * vWave;
      ctx.lineTo(vx + offX, y);
    }
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  const bundle = { map, bumpMap };
  barkTextureCache.set(key, bundle);
  return bundle;
}

/**
 * Builds a smooth tapered tubular branch/trunk along a sequence of 3D points.
 * @param {Array<{x:number, y:number, z:number, r:number}>} nodes - Path points with radius
 * @param {object} options
 * @param {number} [options.radialSegments=10] - Number of radial vertices per ring
 * @param {number} [options.flareRoots=0] - If > 0, fluted buttress roots at base ring (y=0)
 * @param {number} [options.flareStrength=0.6] - Intensity of buttress flare
 * @returns {THREE.BufferGeometry}
 */
function createBranchTubeGeometry(nodes, { radialSegments = 10, flareRoots = 0, flareStrength = 0.55 } = {}) {
  if (!nodes || nodes.length < 2) return new THREE.BufferGeometry();

  const ringCount = nodes.length;
  const vertCount = ringCount * radialSegments + 2; // +2 for end caps
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];

  // Compute parallel-transport frames along the spline to prevent twisting
  const tangents = [];
  for (let i = 0; i < ringCount; i++) {
    const pPrev = nodes[Math.max(0, i - 1)];
    const pNext = nodes[Math.min(ringCount - 1, i + 1)];
    const t = new THREE.Vector3(pNext.x - pPrev.x, pNext.y - pPrev.y, pNext.z - pPrev.z).normalize();
    if (t.lengthSq() < 1e-6) t.set(0, 1, 0);
    tangents.push(t);
  }

  // Initial normal reference
  let normal = new THREE.Vector3(0, 0, 1);
  if (Math.abs(tangents[0].dot(normal)) > 0.9) {
    normal.set(1, 0, 0);
  }
  let binormal = new THREE.Vector3().crossVectors(tangents[0], normal).normalize();
  normal.crossVectors(binormal, tangents[0]).normalize();

  // Generate vertex rings
  for (let i = 0; i < ringCount; i++) {
    const node = nodes[i];
    const tangent = tangents[i];

    if (i > 0) {
      // Parallel transport frame from i-1 to i
      const prevT = tangents[i - 1];
      const axis = new THREE.Vector3().crossVectors(prevT, tangent);
      const angle = Math.asin(Math.min(1, Math.max(-1, axis.length())));
      if (axis.lengthSq() > 1e-6) {
        axis.normalize();
        normal.applyAxisAngle(axis, angle);
        binormal.crossVectors(tangent, normal).normalize();
        normal.crossVectors(binormal, tangent).normalize();
      }
    }

    const vFactor = i / (ringCount - 1);

    for (let j = 0; j < radialSegments; j++) {
      const uFactor = j / radialSegments;
      const theta = uFactor * Math.PI * 2;

      let radius = node.r;
      // Buttress root flare at ground base
      if (flareRoots > 0 && i < 3) {
        const groundBlend = 1.0 - (i / 2.5);
        const rootFlute = Math.pow(Math.max(0, Math.cos(theta * flareRoots)), 2);
        radius *= 1.0 + rootFlute * flareStrength * groundBlend;
      }

      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const radialVec = new THREE.Vector3()
        .addScaledVector(normal, cosT)
        .addScaledVector(binormal, sinT);

      const vx = node.x + radialVec.x * radius;
      const vy = node.y + radialVec.y * radius;
      const vz = node.z + radialVec.z * radius;

      const idx = (i * radialSegments + j) * 3;
      positions[idx] = vx;
      positions[idx + 1] = vy;
      positions[idx + 2] = vz;

      normals[idx] = radialVec.x;
      normals[idx + 1] = radialVec.y;
      normals[idx + 2] = radialVec.z;

      const uvIdx = (i * radialSegments + j) * 2;
      uvs[uvIdx] = uFactor;
      uvs[uvIdx + 1] = vFactor * 3.5;
    }
  }

  // Connect rings with quad faces (2 triangles)
  for (let i = 0; i < ringCount - 1; i++) {
    const ringA = i * radialSegments;
    const ringB = (i + 1) * radialSegments;

    for (let j = 0; j < radialSegments; j++) {
      const nextJ = (j + 1) % radialSegments;

      const a0 = ringA + j;
      const a1 = ringA + nextJ;
      const b0 = ringB + j;
      const b1 = ringB + nextJ;

      indices.push(a0, b0, a1);
      indices.push(a1, b0, b1);
    }
  }

  // Add tip cap
  const lastNode = nodes[nodes.length - 1];
  const tipIdx = ringCount * radialSegments;
  const tipPosIdx = tipIdx * 3;
  const tipTan = tangents[tangents.length - 1];
  positions[tipPosIdx] = lastNode.x + tipTan.x * lastNode.r * 0.5;
  positions[tipPosIdx + 1] = lastNode.y + tipTan.y * lastNode.r * 0.5;
  positions[tipPosIdx + 2] = lastNode.z + tipTan.z * lastNode.r * 0.5;
  normals[tipPosIdx] = tipTan.x;
  normals[tipPosIdx + 1] = tipTan.y;
  normals[tipPosIdx + 2] = tipTan.z;
  uvs[tipIdx * 2] = 0.5;
  uvs[tipIdx * 2 + 1] = 1.0;

  const topRing = (ringCount - 1) * radialSegments;
  for (let j = 0; j < radialSegments; j++) {
    const nextJ = (j + 1) % radialSegments;
    indices.push(topRing + j, tipIdx, topRing + nextJ);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Creates an organic, multi-layered stylized canopy foliage lobe (flattened disc/dome).
 */
function createCanopyLobeGeometry(cx, cy, cz, rx, rz, ry, { lobes = 7, lobeDepth = 0.22, rings = 4, slices = 14 } = {}) {
  const vertCount = rings * slices + 2;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];

  // Top Apex vertex
  positions[0] = cx;
  positions[1] = cy + ry * 0.7;
  positions[2] = cz;
  normals[0] = 0;
  normals[1] = 1;
  normals[2] = 0;
  uvs[0] = 0.5;
  uvs[1] = 0.5;

  let vIdx = 1;

  for (let r = 1; r <= rings; r++) {
    const ringFrac = r / rings;
    const ringRadiusX = rx * Math.sin(ringFrac * Math.PI * 0.5);
    const ringRadiusZ = rz * Math.sin(ringFrac * Math.PI * 0.5);
    const ringY = cy + ry * 0.7 * Math.cos(ringFrac * Math.PI * 0.5) - (ringFrac * ry * 0.5);

    for (let s = 0; s < slices; s++) {
      const theta = (s / slices) * Math.PI * 2;
      const lobeMod = 1.0 + Math.sin(theta * lobes) * lobeDepth * ringFrac;

      const px = cx + Math.cos(theta) * ringRadiusX * lobeMod;
      const pz = cz + Math.sin(theta) * ringRadiusZ * lobeMod;
      // Slight downward droop at the perimeter for lush umbrella silhouette
      const py = ringY - (ringFrac > 0.7 ? (ringFrac - 0.7) * ry * 0.4 : 0);

      const pIdx = vIdx * 3;
      positions[pIdx] = px;
      positions[pIdx + 1] = py;
      positions[pIdx + 2] = pz;

      normals[pIdx] = Math.cos(theta) * 0.5;
      normals[pIdx + 1] = 0.85;
      normals[pIdx + 2] = Math.sin(theta) * 0.5;

      const uvIdx = vIdx * 2;
      uvs[uvIdx] = 0.5 + Math.cos(theta) * 0.5 * ringFrac;
      uvs[uvIdx + 1] = 0.5 + Math.sin(theta) * 0.5 * ringFrac;

      vIdx++;
    }
  }

  // Connect apex to first ring
  for (let s = 0; s < slices; s++) {
    const nextS = (s + 1) % slices;
    indices.push(0, 1 + s, 1 + nextS);
  }

  // Connect consecutive rings
  for (let r = 0; r < rings - 1; r++) {
    const ringA = 1 + r * slices;
    const ringB = 1 + (r + 1) * slices;
    for (let s = 0; s < slices; s++) {
      const nextS = (s + 1) % slices;
      const a0 = ringA + s;
      const a1 = ringA + nextS;
      const b0 = ringB + s;
      const b1 = ringB + nextS;
      indices.push(a0, b0, a1);
      indices.push(a1, b0, b1);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Creates a bioluminescent spore bulb geometry.
 */
function createSporeBulbGeometry(x, y, z, radius) {
  const geom = new THREE.DodecahedronGeometry(radius, 1);
  geom.translate(x, y, z);
  return geom;
}

/**
 * Factory to create a complete vast-canopy asymmetrical tree model.
 *
 * @param {object} options
 * @param {number} [options.seed=0x547265] - Deterministic PRNG seed
 * @param {number} [options.scale=1.0] - Overall uniform scale factor
 * @param {number} [options.rotationY=0] - Initial Y rotation in radians
 * @param {number} [options.barkColor=0x181e1c] - Trunk & bough bark color
 * @param {number} [options.foliageColor=0x112d22] - Main leaf canopy color
 * @param {number} [options.sporeColor=0x3fb98a] - Bioluminescent spore glow color
 * @param {number} [options.sporeIntensity=1.8] - Emissive glow brightness
 * @returns {THREE.Group} Root tree group with metadata
 */
export function createVastCanopyTree({
  seed = 0x547265,
  scale = 1.0,
  rotationY = 0,
  barkColor = 0x181e1c,
  foliageColor = 0x112d22,
  sporeColor = 0x3fb98a,
  sporeIntensity = 1.8,
} = {}) {
  const rng = createRng(seed);
  const rootGroup = new THREE.Group();

  const woodGeometries = [];
  const leafGeometries = [];
  const sporeGeometries = [];

  // ---------------------------------------------------------------------------
  // 1. Sleek Asymmetrical Trunk & Root Base
  // ---------------------------------------------------------------------------
  // Rooted at (0, 0, 0), sweeps upward and leans outward toward (+X, +Z).
  // Tapers gracefully from flared base (r ~ 0.75m) to crown bough junction (r ~ 0.28m at y ~ 3.4m).
  const trunkPath = [
    { x: 0.0, y: -0.2, z: 0.0, r: 0.78 },
    { x: 0.08, y: 0.35, z: 0.04, r: 0.62 },
    { x: 0.28, y: 0.95, z: 0.14, r: 0.52 },
    { x: 0.62, y: 1.65, z: 0.28, r: 0.44 },
    { x: 1.10, y: 2.30, z: 0.48, r: 0.37 },
    { x: 1.70, y: 2.90, z: 0.68, r: 0.31 },
    { x: 2.25, y: 3.45, z: 0.85, r: 0.27 },
  ];

  // Ground root buttress spurs
  const trunkBaseGeom = createBranchTubeGeometry(trunkPath, {
    radialSegments: 12,
    flareRoots: 5,
    flareStrength: 0.55,
  });
  woodGeometries.push(trunkBaseGeom);

  // ---------------------------------------------------------------------------
  // 2. Outward-Extending Asymmetric Major Branches
  // ---------------------------------------------------------------------------
  // The crown junction splits into 5 expansive boughs that stretch across space.
  // Clearance under branches: all bough paths stay above y >= 2.6m!

  // BOUGH 1: Dominant Eastern Reach (stretches far out, dx ~ +5.5m to +7.2m)
  const bough1Path = [
    { x: 2.25, y: 3.45, z: 0.85, r: 0.25 },
    { x: 3.30, y: 3.70, z: 1.05, r: 0.22 },
    { x: 4.60, y: 3.90, z: 1.30, r: 0.18 },
    { x: 5.90, y: 4.05, z: 1.65, r: 0.14 },
    { x: 7.10, y: 4.20, z: 2.05, r: 0.09 },
  ];
  woodGeometries.push(createBranchTubeGeometry(bough1Path, { radialSegments: 9 }));

  // Sub-fork 1A (sprawls towards +X, +Z)
  const subFork1APath = [
    { x: 4.60, y: 3.90, z: 1.30, r: 0.16 },
    { x: 5.75, y: 4.10, z: 2.70, r: 0.12 },
    { x: 6.85, y: 4.25, z: 3.90, r: 0.07 },
  ];
  woodGeometries.push(createBranchTubeGeometry(subFork1APath, { radialSegments: 8 }));

  // Sub-fork 1B (sprawls towards +X, -Z)
  const subFork1BPath = [
    { x: 5.90, y: 4.05, z: 1.65, r: 0.13 },
    { x: 7.20, y: 4.18, z: 0.45, r: 0.09 },
    { x: 8.40, y: 4.25, z: -0.6, r: 0.06 },
  ];
  woodGeometries.push(createBranchTubeGeometry(subFork1BPath, { radialSegments: 8 }));

  // BOUGH 2: Wide Lateral Reach (stretches towards +X, -Z, dx ~ +4.8m, dz ~ -4.6m)
  const bough2Path = [
    { x: 2.25, y: 3.45, z: 0.85, r: 0.24 },
    { x: 3.00, y: 3.60, z: -0.60, r: 0.20 },
    { x: 4.05, y: 3.82, z: -2.15, r: 0.16 },
    { x: 5.15, y: 3.98, z: -3.70, r: 0.11 },
    { x: 6.15, y: 4.12, z: -5.10, r: 0.07 },
  ];
  woodGeometries.push(createBranchTubeGeometry(bough2Path, { radialSegments: 9 }));

  // Sub-fork 2A
  const subFork2APath = [
    { x: 4.05, y: 3.82, z: -2.15, r: 0.14 },
    { x: 4.95, y: 4.05, z: -0.90, r: 0.10 },
    { x: 5.85, y: 4.20, z: 0.15, r: 0.06 },
  ];
  woodGeometries.push(createBranchTubeGeometry(subFork2APath, { radialSegments: 8 }));

  // BOUGH 3: Northern Flank Reach (stretches towards +X, +Z, dz ~ +5.0m)
  const bough3Path = [
    { x: 2.25, y: 3.45, z: 0.85, r: 0.22 },
    { x: 2.30, y: 3.68, z: 2.20, r: 0.18 },
    { x: 2.60, y: 3.92, z: 3.75, r: 0.13 },
    { x: 3.20, y: 4.15, z: 5.25, r: 0.08 },
  ];
  woodGeometries.push(createBranchTubeGeometry(bough3Path, { radialSegments: 8 }));

  // BOUGH 4: Rear / Over-Trunk Crown Bough (stretches back over trunk towards -X, dx ~ -1.9m)
  const bough4Path = [
    { x: 2.25, y: 3.45, z: 0.85, r: 0.21 },
    { x: 1.20, y: 3.75, z: 0.50, r: 0.17 },
    { x: -0.15, y: 4.00, z: 0.15, r: 0.13 },
    { x: -1.40, y: 4.22, z: -0.3, r: 0.08 },
  ];
  woodGeometries.push(createBranchTubeGeometry(bough4Path, { radialSegments: 8 }));

  // BOUGH 5: Central High Spire Bough (supports the top apex canopy)
  const bough5Path = [
    { x: 2.25, y: 3.45, z: 0.85, r: 0.22 },
    { x: 2.85, y: 3.98, z: 0.65, r: 0.18 },
    { x: 3.55, y: 4.50, z: 0.50, r: 0.12 },
    { x: 4.25, y: 4.95, z: 0.35, r: 0.07 },
  ];
  woodGeometries.push(createBranchTubeGeometry(bough5Path, { radialSegments: 8 }));

  // ---------------------------------------------------------------------------
  // 3. Vast Multi-Tiered Foliage Canopy
  // ---------------------------------------------------------------------------
  // Creates a sprawling, lush umbrella canopy of overlapping organic lobes.
  // Balanced footprint (~11m x 11.5m) with high overhead clearance (y >= 2.6m).

  const canopyLobeConfigs = [
    // Main High Crown Apex
    { cx: 4.0, cy: 4.7, cz: 0.4, rx: 3.6, rz: 3.4, ry: 1.2, lobes: 7 },
    { cx: 2.9, cy: 4.4, cz: 0.6, rx: 3.2, rz: 3.0, ry: 1.1, lobes: 6 },

    // Primary Eastern Reach Lobes (Outer Canopy)
    { cx: 6.9, cy: 4.0, cz: 1.8, rx: 3.0, rz: 2.8, ry: 1.0, lobes: 7 },
    { cx: 8.1, cy: 3.9, cz: -0.4, rx: 2.7, rz: 2.6, ry: 0.9, lobes: 6 },
    { cx: 6.6, cy: 4.1, cz: 3.6, rx: 2.8, rz: 2.7, ry: 1.0, lobes: 7 },

    // Lateral Southern Flank Lobes
    { cx: 5.7, cy: 3.8, cz: -4.6, rx: 3.1, rz: 2.9, ry: 1.0, lobes: 7 },
    { cx: 4.1, cy: 3.7, cz: -3.4, rx: 2.8, rz: 2.7, ry: 0.9, lobes: 6 },
    { cx: 5.4, cy: 3.9, cz: -1.5, rx: 2.7, rz: 2.5, ry: 0.9, lobes: 6 },

    // Northern Flank Lobes
    { cx: 3.0, cy: 3.9, cz: 4.8, rx: 2.9, rz: 2.7, ry: 1.0, lobes: 6 },
    { cx: 4.4, cy: 4.0, cz: 3.4, rx: 2.8, rz: 2.6, ry: 0.9, lobes: 7 },
    { cx: 1.7, cy: 3.7, cz: 3.1, rx: 2.5, rz: 2.4, ry: 0.8, lobes: 6 },

    // Rear / Trunk-Overhang Canopy
    { cx: -0.9, cy: 3.9, cz: -0.2, rx: 2.8, rz: 2.7, ry: 0.9, lobes: 6 },
    { cx: 0.5, cy: 3.7, cz: -1.5, rx: 2.5, rz: 2.4, ry: 0.8, lobes: 5 },
    { cx: 0.8, cy: 3.8, cz: 1.6, rx: 2.6, rz: 2.5, ry: 0.9, lobes: 6 },

    // Intermediate Dense Fillers
    { cx: 5.2, cy: 4.2, cz: 0.9, rx: 3.3, rz: 3.0, ry: 1.0, lobes: 7 },
    { cx: 3.6, cy: 4.1, cz: -1.1, rx: 3.0, rz: 2.8, ry: 0.9, lobes: 6 },
  ];

  for (const cfg of canopyLobeConfigs) {
    const jitterX = (rng() - 0.5) * 0.4;
    const jitterZ = (rng() - 0.5) * 0.4;
    const jitterY = (rng() - 0.5) * 0.2;
    const lobeGeom = createCanopyLobeGeometry(
      cfg.cx + jitterX,
      cfg.cy + jitterY,
      cfg.cz + jitterZ,
      cfg.rx * (0.95 + rng() * 0.1),
      cfg.rz * (0.95 + rng() * 0.1),
      cfg.ry,
      { lobes: cfg.lobes, lobeDepth: 0.18 + rng() * 0.08 }
    );
    leafGeometries.push(lobeGeom);
  }

  // ---------------------------------------------------------------------------
  // 4. Bioluminescent Spore Nodules & Under-Canopy Glow
  // ---------------------------------------------------------------------------
  // Small glowing pods nestled in bough bifurcations and hanging beneath leaves
  const sporePositions = [
    // Under branch forks
    { x: 2.25, y: 3.25, z: 0.85, r: 0.18 },
    { x: 3.30, y: 3.45, z: 1.05, r: 0.15 },
    { x: 4.60, y: 3.65, z: 1.30, r: 0.16 },
    { x: 5.90, y: 3.80, z: 1.65, r: 0.13 },
    { x: 4.05, y: 3.55, z: -2.15, r: 0.15 },
    { x: 5.15, y: 3.70, z: -3.70, r: 0.12 },
    { x: 2.60, y: 3.65, z: 3.75, r: 0.14 },
    { x: -0.15, y: 3.75, z: 0.15, r: 0.13 },
    // Hanging underneath canopy lobes
    { x: 6.8, y: 3.5, z: 1.8, r: 0.16 },
    { x: 7.6, y: 3.4, z: 3.4, r: 0.13 },
    { x: 5.6, y: 3.3, z: -4.2, r: 0.14 },
    { x: 7.8, y: 3.4, z: -0.3, r: 0.14 },
    { x: 3.2, y: 3.4, z: 4.6, r: 0.12 },
    { x: 1.2, y: 3.3, z: 1.4, r: 0.13 },
    { x: -0.6, y: 3.4, z: -1.0, r: 0.12 },
  ];

  for (const sp of sporePositions) {
    const bulbGeom = createSporeBulbGeometry(
      sp.x + (rng() - 0.5) * 0.25,
      sp.y + (rng() - 0.5) * 0.15,
      sp.z + (rng() - 0.5) * 0.25,
      sp.r * (0.85 + rng() * 0.3)
    );
    sporeGeometries.push(bulbGeom);
  }

  // ---------------------------------------------------------------------------
  // 5. Build Merged Meshes & Materials
  // ---------------------------------------------------------------------------
  const mergedWood = mergeBufferGeometries(woodGeometries);
  const mergedLeaves = mergeBufferGeometries(leafGeometries);
  const mergedSpores = mergeBufferGeometries(sporeGeometries);

  // Textures & Materials
  const foliageTex = getOrCreateFoliageTextures(foliageColor, sporeColor);
  const barkTex = getOrCreateBarkTextures(barkColor, sporeColor);

  const woodMaterial = new THREE.MeshStandardMaterial({
    map: barkTex.map,
    bumpMap: barkTex.bumpMap,
    bumpScale: 0.14,
    roughness: 0.86,
    metalness: 0.06,
    flatShading: false,
  });

  const leafMaterial = new THREE.MeshStandardMaterial({
    map: foliageTex.map,
    bumpMap: foliageTex.bumpMap,
    bumpScale: 0.10,
    roughness: 0.65,
    metalness: 0.05,
    emissiveMap: foliageTex.emissiveMap,
    emissive: new THREE.Color(sporeColor),
    emissiveIntensity: 0.32,
    side: THREE.DoubleSide,
    flatShading: false,
    // Foliage Stencil Gating: writes ref 1 into hardware stencil buffer
    stencilWrite: true,
    stencilWriteMask: 0xFF,
    stencilRef: 1,
    stencilFuncMask: 0xFF,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
  });

  const sporeMaterial = new THREE.MeshStandardMaterial({
    color: sporeColor,
    emissive: sporeColor,
    emissiveIntensity: sporeIntensity,
    roughness: 0.25,
    metalness: 0.1,
  });

  const woodMesh = new THREE.Mesh(mergedWood, woodMaterial);
  const leafMesh = new THREE.Mesh(mergedLeaves, leafMaterial);
  const sporeMesh = new THREE.Mesh(mergedSpores, sporeMaterial);

  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;

  rootGroup.add(woodMesh, leafMesh, sporeMesh);

  // Apply initial scale & rotation
  if (scale !== 1.0) {
    rootGroup.scale.setScalar(scale);
  }
  if (rotationY !== 0) {
    rootGroup.rotation.y = rotationY;
  }

  // Metadata for collision & positioning
  rootGroup.userData = {
    type: 'vast_canopy_tree',
    baseColliderRadius: 0.75 * scale,
    canopySpanX: 12.0 * scale,
    canopySpanZ: 11.5 * scale,
    canopyClearanceY: 2.6 * scale,
  };

  return rootGroup;
}
