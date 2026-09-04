import * as THREE from 'three';
import { LAKE_CONFIG, isPointInLake, getWaterDepth, getTerrainHeight } from './terrain.js?v=5.4';
import {
  playWaterSplashSound,
  playWaterWadeSound,
  playBubblePopSound,
} from './soundEffects.js?v=5.3';

/**
 * lakeBiome.js — Bioluminescent Abyssal Lake with Interactive Floating Flora
 *
 * Features:
 * 1. High-Fidelity Animated Water Surface: Dynamic multi-harmonic vertex swells,
 *    glowing shoreline rim highlights, and dual-layer analytical caustics.
 * 2. Water Splashes & Ripple Systems: Parabolic water droplet bursts upon entering & exiting,
 *    and expanding surface wake ripples while swimming.
 * 3. Hyper-Textured Interactive Lilypads:
 *    - High-resolution procedural canvas texture with organic leaf venation, chlorophyll cells,
 *      dewdrops, glowing outer border, and bump map depth.
 *    - Soft Floating Physics: Slime can physically bump, push, drift, and tilt the lilypads
 *      with natural fluid damping without getting stuck or blocked.
 * 4. Speed & Energy Dynamics:
 *    - Light Slime (load < 35%): +35% movement speed boost and +25% acceleration.
 *    - Heavy Slime (load >= 35%): 35% speed sludge drag & 14 energy/sec rapid exertion drain.
 * 5. Aquatic Flora & Oxygen Spores: Bio-anemones that spawn vitality bubbles (+8 energy).
 */

// --- High-Fidelity Multi-Harmonic Water Surface GLSL Shader ------------------
const WATER_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying float vWaveHeight;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Organic multi-harmonic subterranean wave swells along horizontal plane (pos.x, pos.z)
    float wave1 = sin(pos.x * 0.35 + uTime * 1.5) * cos(pos.z * 0.35 + uTime * 1.2) * 0.055;
    float wave2 = sin(pos.x * 0.75 - uTime * 2.0) * sin(pos.z * 0.65 + uTime * 1.7) * 0.028;
    float wave3 = cos((pos.x + pos.z) * 1.4 + uTime * 2.5) * 0.012;

    // Displace vertically along model Y axis
    pos.y += wave1 + wave2 + wave3;
    vWaveHeight = wave1 + wave2 + wave3;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec2 uLakeCenter;
  uniform vec2 uLakeRadii;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying float vWaveHeight;

  void main() {
    vec2 rel = (vWorldPosition.xz - uLakeCenter) / uLakeRadii;
    float distSq = dot(rel, rel);
    if (distSq > 0.98) discard;

    float radialDist = sqrt(distSq);
    float shoreAlpha = smoothstep(0.98, 0.76, radialDist);

    // Color gradient: deep abyssal navy center to luminous cyan-emerald shallows
    vec3 deepNavy = vec3(0.012, 0.065, 0.135);
    vec3 shallowCyan = vec3(0.07, 0.86, 0.80);
    vec3 shoreEmerald = vec3(0.20, 0.96, 0.70);
    vec3 waterColor = mix(deepNavy, shallowCyan, smoothstep(0.12, 0.88, radialDist));

    // Dynamic dual-harmonic caustic ribbons
    vec2 uvC = vWorldPosition.xz * 0.65;
    float caustic1 = sin(uvC.x * 3.0 + uTime * 1.7 + sin(uvC.y * 2.3 + uTime * 1.1));
    float caustic2 = cos(uvC.y * 3.4 - uTime * 1.5 + cos(uvC.x * 2.6 + uTime * 1.3));
    float caustic = pow(max(0.0, (caustic1 + caustic2) * 0.5 + 0.4), 3.0) * 0.55;

    // Glowing shoreline rim & wave crest highlights
    float shoreGlow = smoothstep(0.75, 0.96, radialDist) * 0.42;
    float crestGlow = smoothstep(0.02, 0.08, vWaveHeight) * 0.35;

    vec3 finalColor = waterColor + vec3(0.3, 0.96, 0.92) * (caustic + crestGlow);
    finalColor = mix(finalColor, shoreEmerald, shoreGlow);

    float alpha = shoreAlpha * (0.82 + caustic * 0.18);
    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 0.92));
  }
`;

// --- Dynamic Bioluminescent Waterline Meniscus Shaders -----------------------
const MENISCUS_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const MENISCUS_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    // Ring UV: v is radial distance [0 = inner hole touching body, 1 = outer edge]
    float radialT = vUv.y;

    // Soft feathered bell curve falloff along the ring cross-section
    float innerFade = smoothstep(0.0, 0.25, radialT);
    float outerFade = smoothstep(1.0, 0.35, radialT);
    float ringShape = innerFade * outerFade;

    // Fluid pulse and subtle caustics shimmer along the waterline perimeter
    float angle = atan(vWorldPosition.z, vWorldPosition.x);
    float shimmer = sin(uTime * 3.5 + angle * 7.0) * 0.15 + cos(uTime * 2.2 - angle * 4.0) * 0.10;

    // Bioluminescent glow gradient: vibrant luminous cyan to bright sparkling meniscus highlight
    vec3 baseCyan = vec3(0.12, 0.94, 0.88);
    vec3 brightFoam = vec3(0.72, 1.0, 0.96);
    vec3 col = mix(baseCyan, brightFoam, clamp(ringShape * (1.15 + shimmer), 0.0, 1.0));

    float finalAlpha = ringShape * (0.88 + shimmer * 0.25) * uAlpha;
    if (finalAlpha < 0.01) discard;

    gl_FragColor = vec4(col, clamp(finalAlpha, 0.0, 0.95));
  }
`;

// --- Procedural Foliage Texture Generation Matching Tree Leaves ------------
let cachedLilypadFoliageBundle = null;

function createLakeBiomeRng(seed = 0x4c656166) {
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
 * Creates high-detail procedural textures for lily pads:
 * - Slightly lifted, lighter subterranean tree leaf green shade for crisp visual clarity.
 * - Deep dark bioluminescent green (0x18a855) spore & capillary glow.
 * - Multi-tonal organic leaf frond scales, radiating branching venation, and glowing micro-capillaries.
 * - Tactile bump map relief and emissive capillary maps.
 */
function getDetailedLilypadTextureBundle(foliageColorHex = 0x1b4c3b, sporeColorHex = 0x18a855) {
  if (cachedLilypadFoliageBundle) return cachedLilypadFoliageBundle;

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

  const cx = size * 0.5;
  const cy = size * 0.5;

  // 1. Base slightly lifted subterranean leaf background
  const baseR = Math.floor(baseCol.r * 255 * 0.78);
  const baseG = Math.floor(baseCol.g * 255 * 0.78);
  const baseB = Math.floor(baseCol.b * 255 * 0.78);
  ctx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
  ctx.fillRect(0, 0, size, size);

  bumpCtx.fillStyle = '#7a7a7a';
  bumpCtx.fillRect(0, 0, size, size);

  emCtx.fillStyle = '#000000';
  emCtx.fillRect(0, 0, size, size);

  const rng = createLakeBiomeRng(0x4c656166);

  // 2. Multi-Tonal Organic Leaf Frond Scales (slightly lighter, rich emerald-slate tones)
  const leafCount = 380;
  for (let i = 0; i < leafCount; i++) {
    const angle = rng() * Math.PI * 2;
    const distFrac = Math.sqrt(rng());
    const dist = distFrac * (size * 0.47);
    const lx = cx + Math.cos(angle) * dist;
    const ly = cy + Math.sin(angle) * dist;
    const leafRadius = 14 + rng() * 24;

    const tone = 0.82 + rng() * 0.55;
    const r = Math.min(255, Math.floor(baseCol.r * 255 * tone + rng() * 18));
    const g = Math.min(255, Math.floor(baseCol.g * 255 * tone + (1.0 - distFrac) * 38 + rng() * 32));
    const b = Math.min(255, Math.floor(baseCol.b * 255 * tone + rng() * 22));

    const grad = ctx.createRadialGradient(lx, ly, leafRadius * 0.1, lx, ly, leafRadius);
    grad.addColorStop(0, `rgba(${Math.min(255, r + 30)}, ${Math.min(255, g + 42)}, ${Math.min(255, b + 30)}, 0.88)`);
    grad.addColorStop(0.65, `rgba(${r}, ${g}, ${b}, 0.72)`);
    grad.addColorStop(1, `rgba(${Math.floor(r * 0.45)}, ${Math.floor(g * 0.45)}, ${Math.floor(b * 0.45)}, 0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lx, ly, leafRadius, 0, Math.PI * 2);
    ctx.fill();

    // Bump map for leaf clump relief
    const bumpGrad = bumpCtx.createRadialGradient(lx, ly, 0, lx, ly, leafRadius);
    bumpGrad.addColorStop(0, 'rgba(235, 235, 235, 0.45)');
    bumpGrad.addColorStop(0.6, 'rgba(160, 160, 160, 0.22)');
    bumpGrad.addColorStop(1, 'rgba(100, 100, 100, 0)');
    bumpCtx.fillStyle = bumpGrad;
    bumpCtx.beginPath();
    bumpCtx.arc(lx, ly, leafRadius, 0, Math.PI * 2);
    bumpCtx.fill();
  }

  // 3. Intricate Branching Leaf Venation with dark green glow accents
  const mainVeins = 16;
  const notchCut = 0.26;
  const startAng = notchCut;
  const endAng = Math.PI * 2 - notchCut;

  ctx.strokeStyle = `rgba(${Math.min(255, Math.floor(baseCol.r * 255 * 1.7 + 48))}, ${Math.min(255, Math.floor(baseCol.g * 255 * 2.0 + 72))}, ${Math.min(255, Math.floor(baseCol.b * 255 * 1.7 + 52))}, 0.86)`;
  bumpCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  emCtx.strokeStyle = `rgba(${Math.floor(sporeCol.r * 255)}, ${Math.floor(sporeCol.g * 255)}, ${Math.floor(sporeCol.b * 255)}, 0.78)`;

  for (let v = 0; v < mainVeins; v++) {
    const fracAng = v / (mainVeins - 1);
    const baseAngle = startAng + fracAng * (endAng - startAng) + (rng() - 0.5) * 0.08;
    const len = size * 0.46;

    ctx.lineWidth = 3.4;
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
      const angle = baseAngle + Math.sin(frac * Math.PI * 2) * 0.14;
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
        const subLen = (16 + rng() * 24) * (1.0 - (p / steps) * 0.4);
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

        if (rng() > 0.30) {
          emCtx.beginPath();
          emCtx.moveTo(pt.x, pt.y);
          emCtx.lineTo(ex, ey);
          emCtx.stroke();
        }
      }
    }
  }

  // 4. Bioluminescent Dark Green Spore Flecks along vein junctions
  const sporeFleckCount = 75;
  for (let i = 0; i < sporeFleckCount; i++) {
    const angle = startAng + rng() * (endAng - startAng);
    const dist = Math.pow(rng(), 0.7) * (size * 0.44);
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy + Math.sin(angle) * dist;
    const sr = 1.8 + rng() * 3.2;

    // Glowing dark green on emissive map
    emCtx.fillStyle = `rgba(${Math.floor(sporeCol.r * 255)}, ${Math.floor(sporeCol.g * 255)}, ${Math.floor(sporeCol.b * 255)}, 0.90)`;
    emCtx.beginPath();
    emCtx.arc(sx, sy, sr, 0, Math.PI * 2);
    emCtx.fill();

    // Vibrant green highlight on color map
    ctx.fillStyle = `rgba(${Math.min(255, Math.floor(sporeCol.r * 255 + 50))}, ${Math.min(255, Math.floor(sporeCol.g * 255 + 60))}, ${Math.min(255, Math.floor(sporeCol.b * 255 + 50))}, 0.95)`;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Outer glowing rim
  ctx.strokeStyle = `rgba(${Math.floor(sporeCol.r * 255)}, ${Math.floor(sporeCol.g * 255)}, ${Math.floor(sporeCol.b * 255)}, 0.85)`;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.46, startAng, endAng);
  ctx.stroke();

  emCtx.strokeStyle = `rgba(${Math.floor(sporeCol.r * 255)}, ${Math.floor(sporeCol.g * 255)}, ${Math.floor(sporeCol.b * 255)}, 0.75)`;
  emCtx.lineWidth = 2.5;
  emCtx.beginPath();
  emCtx.arc(cx, cy, size * 0.46, startAng, endAng);
  emCtx.stroke();

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.ClampToEdgeWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;

  const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.ClampToEdgeWrapping;
  emissiveMap.wrapT = THREE.ClampToEdgeWrapping;

  cachedLilypadFoliageBundle = { map, bumpMap, emissiveMap };
  return cachedLilypadFoliageBundle;
}

// --- Interactive Floating Lilypads Configuration (Halved Size) ---------------
// Radii are halved from original (~2.25-2.45m down to ~1.125-1.225m)
const LILYPAD_CONFIGS = [
  { x: -3.8, z: 18.0, radius: 1.125, rotation: 0.6 },
  { x: 8.8, z: 21.5, radius: 1.225, rotation: 2.2 },
  { x: 2.2, z: 27.8, radius: 1.15, rotation: 3.9 },
  { x: -1.5, z: 23.0, radius: 1.10, rotation: 1.4 },
  { x: 5.5, z: 16.5, radius: 1.18, rotation: 4.8 },
];

/**
 * Builds a smooth notched organic lily pad disc geometry with exact planar UV mapping.
 * Center vertex at (0, 0, 0) maps precisely to (0.5, 0.5) on the canvas texture.
 */
function createLilypadDiscGeometry(radius, { notchAngle = 0.28, rings = 6, slices = 36 } = {}) {
  const sliceCount = slices;
  const vertCount = 1 + rings * (sliceCount + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];

  // Center Apex vertex at (0, 0, 0)
  positions[0] = 0;
  positions[1] = 0;
  positions[2] = 0;
  normals[0] = 0;
  normals[1] = 1;
  normals[2] = 0;
  uvs[0] = 0.5;
  uvs[1] = 0.5;

  let vIdx = 1;
  const startAngle = notchAngle;
  const endAngle = Math.PI * 2 - notchAngle;
  const angleSpan = endAngle - startAngle;

  for (let r = 1; r <= rings; r++) {
    const ringFrac = r / rings;
    const currentRadius = radius * ringFrac;

    for (let s = 0; s <= sliceCount; s++) {
      const sFrac = s / sliceCount;
      const theta = startAngle + sFrac * angleSpan;

      // Gentle organic scalloping along perimeter
      const scallop = 1.0 + Math.sin(theta * 6.0) * 0.025 * ringFrac;
      const rx = currentRadius * scallop;
      const rz = currentRadius * scallop;

      const px = Math.cos(theta) * rx;
      const pz = Math.sin(theta) * rz;
      // Slight saucer cup profile: center is level, edges rise slightly then curl down
      const py = Math.pow(ringFrac, 1.8) * 0.018 - (ringFrac > 0.85 ? (ringFrac - 0.85) * 0.015 : 0);

      const pIdx = vIdx * 3;
      positions[pIdx] = px;
      positions[pIdx + 1] = py;
      positions[pIdx + 2] = pz;

      normals[pIdx] = -Math.cos(theta) * 0.15 * ringFrac;
      normals[pIdx + 1] = 0.98;
      normals[pIdx + 2] = -Math.sin(theta) * 0.15 * ringFrac;

      // Exact planar radial UV mapping matching canvas (0.5, 0.5) center with zero distortion
      const uvIdx = vIdx * 2;
      uvs[uvIdx] = 0.5 + (px / (radius * 2.0)) * 0.92;
      uvs[uvIdx + 1] = 0.5 + (pz / (radius * 2.0)) * 0.92;

      vIdx++;
    }
  }

  // Connect center to first ring
  const ringVerts = sliceCount + 1;
  for (let s = 0; s < sliceCount; s++) {
    const v0 = 0;
    const v1 = 1 + s;
    const v2 = 1 + s + 1;
    indices.push(v0, v1, v2);
  }

  // Connect consecutive rings
  for (let r = 0; r < rings - 1; r++) {
    const ringA = 1 + r * ringVerts;
    const ringB = 1 + (r + 1) * ringVerts;

    for (let s = 0; s < sliceCount; s++) {
      const a0 = ringA + s;
      const a1 = ringA + s + 1;
      const b0 = ringB + s;
      const b1 = ringB + s + 1;

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

function createInteractiveLilypadMesh(radius, rotationY) {
  const group = new THREE.Group();

  // 1. Disc Geometry with exact planar UV mapping
  const leafGeom = createLilypadDiscGeometry(radius, { notchAngle: 0.28, rings: 6, slices: 36 });
  const foliageTex = getDetailedLilypadTextureBundle(0x1b4c3b, 0x18a855);

  // Exact leaf material matching slightly lighter tree leaves with dark green bioluminescence
  const leafMat = new THREE.MeshStandardMaterial({
    map: foliageTex.map,
    bumpMap: foliageTex.bumpMap,
    bumpScale: 0.10,
    roughness: 0.65,
    metalness: 0.05,
    emissiveMap: foliageTex.emissiveMap,
    emissive: new THREE.Color(0x18a855),
    emissiveIntensity: 0.32,
    side: THREE.DoubleSide,
    flatShading: false,
  });

  const leafMesh = new THREE.Mesh(leafGeom, leafMat);
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;
  group.add(leafMesh);

  // 2. Central lotus blossom (dark emerald petals with glowing green-crystal stamen)
  const flowerGroup = new THREE.Group();
  const petalMat = new THREE.MeshStandardMaterial({
    color: 0x184838,
    emissive: 0x0f3627,
    emissiveIntensity: 0.6,
    roughness: 0.45,
  });

  const petalCount = 7;
  for (let i = 0; i < petalCount; i++) {
    const pAngle = (i / petalCount) * Math.PI * 2;
    const petalGeom = new THREE.ConeGeometry(0.06, 0.16, 4);
    petalGeom.rotateX(0.42);
    const petal = new THREE.Mesh(petalGeom, petalMat);
    petal.position.set(Math.cos(pAngle) * 0.08, 0.04, Math.sin(pAngle) * 0.08);
    petal.rotation.y = -pAngle;
    flowerGroup.add(petal);
  }

  const coreGeom = new THREE.SphereGeometry(0.075, 8, 8);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x24e078,
    emissiveIntensity: 2.8,
  });
  const core = new THREE.Mesh(coreGeom, coreMat);
  core.position.y = 0.05;
  flowerGroup.add(core);

  // Bioluminescent spore bulbs nestled on leaf surface in dark green
  const sporeMat = new THREE.MeshStandardMaterial({
    color: 0x169950,
    emissive: 0x169950,
    emissiveIntensity: 1.8,
    roughness: 0.25,
    metalness: 0.1,
  });

  const sporeAngles = [0.45, 1.8, 3.1, 4.5, 5.8];
  for (const sAngle of sporeAngles) {
    const sDist = radius * 0.55;
    const sGeom = new THREE.DodecahedronGeometry(0.045, 0);
    const sMesh = new THREE.Mesh(sGeom, sporeMat);
    sMesh.position.set(Math.cos(sAngle) * sDist, 0.025, Math.sin(sAngle) * sDist);
    flowerGroup.add(sMesh);
  }

  // Atmospheric dark/rich green bioluminescent point light
  const greenLight = new THREE.PointLight(0x18a855, 0.75, 3.6, 2.0);
  greenLight.position.set(0, 0.12, 0);
  flowerGroup.add(greenLight);

  group.add(flowerGroup);

  // Aquatic submerged root stem scaled to half size
  const rootGeom = new THREE.CylinderGeometry(0.06, 0.03, 0.22, 6);
  const rootMat = new THREE.MeshStandardMaterial({ color: 0x063529, roughness: 0.9 });
  const rootMesh = new THREE.Mesh(rootGeom, rootMat);
  rootMesh.position.y = -0.11;
  group.add(rootMesh);

  group.rotation.y = rotationY;

  return {
    group,
    anchorPos: new THREE.Vector3(0, LAKE_CONFIG.waterLevel + 0.05, 0),
    currentPos: new THREE.Vector3(0, LAKE_CONFIG.waterLevel + 0.05, 0),
    velocity: new THREE.Vector3(),
    currentTilt: { x: 0, z: 0 },
    tiltVelocity: { x: 0, z: 0 },
    radius,
    baseRotationY: rotationY,
  };
}

// --- Aquatic Flora (Underwater Bio-Anemones) ----------------------------------
const FLORA_POSITIONS = [
  { x: -3.0, z: 23.5, scale: 1.0 },
  { x: 3.5, z: 17.5, scale: 1.15 },
  { x: 9.0, z: 24.5, scale: 0.95 },
  { x: -0.5, z: 28.0, scale: 1.1 },
];

function createHydroAnemoneMesh(scale = 1.0) {
  const group = new THREE.Group();

  const stalkGeom = new THREE.CylinderGeometry(0.20 * scale, 0.35 * scale, 0.65 * scale, 6);
  const stalkMat = new THREE.MeshStandardMaterial({
    color: 0x0e5c54,
    emissive: 0x052e2a,
    emissiveIntensity: 0.45,
    roughness: 0.85,
  });
  const stalk = new THREE.Mesh(stalkGeom, stalkMat);
  stalk.position.y = 0.32 * scale;
  group.add(stalk);

  const tentacleMat = new THREE.MeshStandardMaterial({
    color: 0x00ffd0,
    emissive: 0x00c4a0,
    emissiveIntensity: 1.5,
    roughness: 0.4,
  });

  const tentacles = [];
  const tentacleCount = 7;
  for (let i = 0; i < tentacleCount; i++) {
    const angle = (i / tentacleCount) * Math.PI * 2;
    const tGeom = new THREE.ConeGeometry(0.055 * scale, 0.52 * scale, 4);
    tGeom.translate(0, 0.22 * scale, 0);
    const tMesh = new THREE.Mesh(tGeom, tentacleMat);
    tMesh.position.set(Math.cos(angle) * 0.16 * scale, 0.60 * scale, Math.sin(angle) * 0.16 * scale);
    tMesh.rotation.z = Math.cos(angle) * 0.35;
    tMesh.rotation.x = Math.sin(angle) * 0.35;
    group.add(tMesh);
    tentacles.push({ mesh: tMesh, baseAngle: angle, phase: i * 0.8 });
  }

  const coreGeom = new THREE.SphereGeometry(0.16 * scale, 6, 6);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x36ffe2,
    emissiveIntensity: 2.4,
  });
  const core = new THREE.Mesh(coreGeom, coreMat);
  core.position.y = 0.62 * scale;
  group.add(core);

  group.userData = { tentacles, core, scale, bubbleTimer: Math.random() * 3.0 };
  return group;
}

// --- Main LakeBiome System Class --------------------------------------------
export class LakeBiome {
  constructor(scene, { playerController, burdenSystem, metabolismSystem, uiManager, collisionSystem }) {
    this.scene = scene;
    this.playerController = playerController;
    this.burdenSystem = burdenSystem;
    this.metabolismSystem = metabolismSystem;
    this.uiManager = uiManager;
    this.collisionSystem = collisionSystem;

    this._time = 0;
    this._wasInWater = false;
    this._rippleTimer = 0;

    // 1. Water Surface Mesh
    const discGeom = new THREE.RingGeometry(0.001, 1.0, 56, 14);
    discGeom.rotateX(-Math.PI / 2);
    discGeom.scale(LAKE_CONFIG.rx, 1.0, LAKE_CONFIG.rz);

    this.waterUniforms = {
      uTime: { value: 0 },
      uLakeCenter: { value: new THREE.Vector2(LAKE_CONFIG.center.x, LAKE_CONFIG.center.z) },
      uLakeRadii: { value: new THREE.Vector2(LAKE_CONFIG.rx, LAKE_CONFIG.rz) },
    };

    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: this.waterUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
    });

    this.waterMesh = new THREE.Mesh(discGeom, this.waterMaterial);
    this.waterMesh.position.set(LAKE_CONFIG.center.x, LAKE_CONFIG.waterLevel, LAKE_CONFIG.center.z);
    this.waterMesh.renderOrder = 20;
    this.scene.add(this.waterMesh);

    // 2. Dynamic Bioluminescent Waterline Meniscus Ring (Soft fluid contact boundary)
    this.meniscusUniforms = {
      uTime: { value: 0 },
      uAlpha: { value: 0 },
    };
    const meniscusGeom = new THREE.RingGeometry(0.85, 1.35, 48, 4);
    meniscusGeom.rotateX(-Math.PI / 2);
    this.meniscusMaterial = new THREE.ShaderMaterial({
      vertexShader: MENISCUS_VERTEX_SHADER,
      fragmentShader: MENISCUS_FRAGMENT_SHADER,
      uniforms: this.meniscusUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.meniscusMesh = new THREE.Mesh(meniscusGeom, this.meniscusMaterial);
    this.meniscusMesh.position.set(0, LAKE_CONFIG.waterLevel + 0.006, 0);
    this.meniscusMesh.renderOrder = 25;
    this.meniscusMesh.visible = false;
    this.scene.add(this.meniscusMesh);

    // 3. Interactive Soft-Floating Lilypads (Slime can bump and move them)
    this.lilypads = [];
    for (const cfg of LILYPAD_CONFIGS) {
      const padObj = createInteractiveLilypadMesh(cfg.radius, cfg.rotation);
      padObj.anchorPos.set(cfg.x, LAKE_CONFIG.waterLevel + 0.05, cfg.z);
      padObj.currentPos.copy(padObj.anchorPos);
      padObj.group.position.copy(padObj.currentPos);
      this.scene.add(padObj.group);
      this.lilypads.push(padObj);
    }

    // 4. Aquatic Flora
    this.flora = [];
    for (const f of FLORA_POSITIONS) {
      const floraMesh = createHydroAnemoneMesh(f.scale);
      const groundY = getTerrainHeight(f.x, f.z);
      floraMesh.position.set(f.x, groundY, f.z);
      this.scene.add(floraMesh);
      this.flora.push(floraMesh);
    }

    // 5. Live Vitality Bubbles
    this.vitalityBubbles = [];
    this._bubbleGeom = new THREE.SphereGeometry(0.24, 8, 8);
    this._bubbleMat = new THREE.MeshStandardMaterial({
      color: 0x94ffff,
      emissive: 0x1affdc,
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.85,
      roughness: 0.1,
    });

    // 6. High-Impact Splash, Ripple & Waterline Particle Pools
    this._initParticles();
  }

  _initParticles() {
    // A. Expanding Surface Ripples
    this.ripples = [];
    const rippleGeom = new THREE.RingGeometry(0.1, 0.25, 20);
    rippleGeom.rotateX(-Math.PI / 2);
    this._rippleMat = new THREE.MeshBasicMaterial({
      color: 0x6effe2,
      transparent: true,
      opacity: 0.85,
      side: THREE.FrontSide,
      depthWrite: false,
    });

    for (let i = 0; i < 20; i++) {
      const mesh = new THREE.Mesh(rippleGeom, this._rippleMat.clone());
      mesh.visible = false;
      mesh.position.y = LAKE_CONFIG.waterLevel + 0.02;
      this.scene.add(mesh);
      this.ripples.push({ mesh, active: false, life: 0, maxLife: 1.1, scale: 1, maxScale: 3.8 });
    }

    // B. Parabolic Splash Droplets (Water entry/exit bursts)
    this.splashes = [];
    const dropGeom = new THREE.DodecahedronGeometry(0.075, 0);
    const dropMat = new THREE.MeshStandardMaterial({
      color: 0xb8ffff,
      emissive: 0x36ffd6,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.9,
    });

    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(dropGeom, dropMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.splashes.push({
        mesh,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.55,
      });
    }

    // C. Submerged Silt Bubbles
    this.trailBubbles = [];
    const tBubbleGeom = new THREE.SphereGeometry(0.065, 5, 5);
    const tBubbleMat = new THREE.MeshStandardMaterial({
      color: 0xe0ffff,
      emissive: 0x7cffea,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.75,
    });

    for (let i = 0; i < 15; i++) {
      const mesh = new THREE.Mesh(tBubbleGeom, tBubbleMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.trailBubbles.push({
        mesh,
        active: false,
        pos: new THREE.Vector3(),
        velY: 1.0,
        life: 0,
        maxLife: 0.8,
      });
    }

    // D. Waterline Boundary Depth Particles (Luminous contact sparkles & micro-foam bubbles)
    this.waterlineParticles = [];
    this._waterlineParticleTimer = 0;
    const wlParticleGeom = new THREE.SphereGeometry(0.045, 6, 6);
    const wlParticleMat = new THREE.MeshStandardMaterial({
      color: 0x90ffea,
      emissive: 0x22ffd0,
      emissiveIntensity: 2.4,
      transparent: true,
      opacity: 0.9,
      roughness: 0.1,
    });

    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(wlParticleGeom, wlParticleMat.clone());
      mesh.visible = false;
      this.scene.add(mesh);
      this.waterlineParticles.push({
        mesh,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.7,
        initialScale: 1.0,
        seed: Math.random() * 100,
      });
    }
  }

  spawnRipple(x, z, scaleMultiplier = 1.0) {
    if (!isPointInLake(x, z)) return;
    const r = this.ripples.find((item) => !item.active);
    if (!r) return;
    r.active = true;
    r.life = 0;
    r.scale = 0.45 * scaleMultiplier;
    r.maxScale = (2.4 + Math.random() * 1.4) * scaleMultiplier;
    r.mesh.position.set(x, LAKE_CONFIG.waterLevel + 0.02, z);
    r.mesh.scale.set(r.scale, r.scale, r.scale);
    r.mesh.material.opacity = 0.85;
    r.mesh.visible = true;
  }

  spawnSplash(x, z, count = 12, intensity = 1.0) {
    if (!isPointInLake(x, z)) return;
    let spawned = 0;
    for (const s of this.splashes) {
      if (s.active) continue;
      s.active = true;
      s.life = 0;
      s.maxLife = 0.45 + Math.random() * 0.2;
      s.pos.set(x + (Math.random() - 0.5) * 0.35, LAKE_CONFIG.waterLevel + 0.05, z + (Math.random() - 0.5) * 0.35);
      s.mesh.position.copy(s.pos);
      s.mesh.visible = true;

      const angle = Math.random() * Math.PI * 2;
      const speed = (2.2 + Math.random() * 3.0) * intensity;
      s.vel.set(Math.cos(angle) * speed * 0.55, (3.2 + Math.random() * 2.5) * intensity, Math.sin(angle) * speed * 0.55);

      spawned++;
      if (spawned >= count) break;
    }
  }

  spawnTrailBubble(x, y, z) {
    if (!isPointInLake(x, z)) return;
    const b = this.trailBubbles.find((item) => !item.active);
    if (!b) return;
    b.active = true;
    b.life = 0;
    b.maxLife = 0.7;
    b.pos.set(x + (Math.random() - 0.5) * 0.25, y, z + (Math.random() - 0.5) * 0.25);
    b.mesh.position.copy(b.pos);
    b.velY = 0.9;
    b.mesh.visible = true;
  }

  spawnWaterlineParticle(x, z, angle, radius, intensity = 1.0) {
    const p = this.waterlineParticles.find((item) => !item.active);
    if (!p) return;
    p.active = true;
    p.life = 0;
    p.maxLife = 0.5 + Math.random() * 0.4;
    p.initialScale = (0.7 + Math.random() * 0.6) * intensity;
    p.seed = Math.random() * 100;

    const px = x + Math.cos(angle) * radius;
    const pz = z + Math.sin(angle) * radius;
    const py = LAKE_CONFIG.waterLevel + 0.005 + (Math.random() - 0.5) * 0.015;
    p.pos.set(px, py, pz);
    p.mesh.position.copy(p.pos);

    const speed = 0.18 + Math.random() * 0.28;
    p.vel.set(
      Math.cos(angle) * speed + (Math.random() - 0.5) * 0.1,
      0,
      Math.sin(angle) * speed + (Math.random() - 0.5) * 0.1
    );
    p.mesh.scale.setScalar(0.001);
    p.mesh.visible = true;
  }

  _spawnVitalityBubble(x, z, groundY) {
    const mesh = new THREE.Mesh(this._bubbleGeom, this._bubbleMat.clone());
    mesh.position.set(x, groundY + 0.35, z);
    this.scene.add(mesh);
    this.vitalityBubbles.push({
      mesh,
      baseX: x,
      baseZ: z,
      y: groundY + 0.35,
      targetY: LAKE_CONFIG.waterLevel + 0.12,
      wobbleSeed: Math.random() * 10,
      collected: false,
    });
  }

  /**
   * Per-frame simulation: water shader animation, interactive lilypad drift/tilt,
   * splash droplet physics, speed & energy drain, meniscus ring, and waterline particles.
   */
  update(deltaTime, playerPosition, playerController) {
    this._time += deltaTime;
    this.waterUniforms.uTime.value = this._time;

    // --- 1. Water State & Audio Feedback ---
    const inLake = isPointInLake(playerPosition.x, playerPosition.z);
    const playerRadius = 0.6;
    const groundY = getTerrainHeight(playerPosition.x, playerPosition.z);
    const waterDepth = inLake ? Math.max(0, LAKE_CONFIG.waterLevel - groundY) : 0;
    const isSubmerged = inLake && waterDepth > 0.12;

    if (isSubmerged) {
      if (!this._wasInWater) {
        this._wasInWater = true;
        playWaterSplashSound(1.2);
        this.spawnSplash(playerPosition.x, playerPosition.z, 14, 1.2);
        this.spawnRipple(playerPosition.x, playerPosition.z, 1.6);
      }

      const load = this.burdenSystem ? this.burdenSystem.load : 0;
      const speed = playerController.currentVelocity.length();

      if (load >= 0.35) {
        // Heavy Sinking Slime: Rapid Energy Drain (14 units/sec)
        if (this.metabolismSystem) {
          this.metabolismSystem.drainEnergy(14.0 * deltaTime);
        }
        if (speed > 0.15 && Math.random() < 0.30) {
          this.spawnTrailBubble(playerPosition.x, playerPosition.y - 0.2, playerPosition.z);
        }
      } else {
        // Light Slime: Emit surface wake ripples while swimming
        this._rippleTimer += deltaTime;
        const interval = speed > 0.3 ? 0.24 : 0.65;
        if (this._rippleTimer >= interval) {
          this._rippleTimer = 0;
          this.spawnRipple(playerPosition.x, playerPosition.z, speed > 0.3 ? 1.05 : 0.65);
        }
      }

      if (speed > 0.3) {
        playWaterWadeSound();
      }
    } else {
      if (this._wasInWater) {
        this._wasInWater = false;
        playWaterSplashSound(0.7);
        this.spawnSplash(playerPosition.x, playerPosition.z, 8, 0.8);
        this.spawnRipple(playerPosition.x, playerPosition.z, 1.2);
      }
    }

    // --- 2. Dynamic Waterline Meniscus Ring & Boundary Depth Particles ---
    this.meniscusUniforms.uTime.value = this._time;
    const slimeY = playerPosition.y;
    const slimeScale = playerController && playerController.mesh ? playerController.mesh.scale.x : 1.0;
    const slimeR = 0.6 * slimeScale;
    const dY = LAKE_CONFIG.waterLevel - slimeY;
    const isWaterlineContact = inLake && Math.abs(dY) < slimeR * 0.96;

    if (isWaterlineContact) {
      const crossR = Math.sqrt(Math.max(0.05, slimeR * slimeR - dY * dY));
      this.meniscusMesh.position.set(playerPosition.x, LAKE_CONFIG.waterLevel + 0.006, playerPosition.z);
      this.meniscusMesh.scale.set(crossR, 1.0, crossR);
      this.meniscusUniforms.uAlpha.value = THREE.MathUtils.lerp(this.meniscusUniforms.uAlpha.value, 1.0, 14.0 * deltaTime);
      this.meniscusMesh.visible = true;

      // Continuous emission of bioluminescent waterline boundary particles
      this._waterlineParticleTimer += deltaTime;
      const speed = playerController && playerController.currentVelocity ? playerController.currentVelocity.length() : 0;
      const emitInterval = speed > 0.2 ? 0.04 : 0.09;
      if (this._waterlineParticleTimer >= emitInterval) {
        this._waterlineParticleTimer = 0;
        const count = speed > 0.2 ? 3 : 1;
        for (let k = 0; k < count; k++) {
          const ang = Math.random() * Math.PI * 2;
          const r = crossR * (0.94 + Math.random() * 0.18);
          this.spawnWaterlineParticle(playerPosition.x, playerPosition.z, ang, r, speed > 0.2 ? 1.2 : 0.9);
        }
      }
    } else {
      this.meniscusUniforms.uAlpha.value = THREE.MathUtils.lerp(this.meniscusUniforms.uAlpha.value, 0.0, 12.0 * deltaTime);
      if (this.meniscusUniforms.uAlpha.value < 0.01) {
        this.meniscusMesh.visible = false;
      }
    }

    // --- 3. Interactive Soft-Floating Lilypads (Nudge Physics & Tilt Damping) ---
    for (let i = 0; i < this.lilypads.length; i++) {
      const pad = this.lilypads[i];
      const dx = playerPosition.x - pad.currentPos.x;
      const dz = playerPosition.z - pad.currentPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const contactDist = pad.radius + playerRadius;

      // Soft elastic collision push from slime
      if (dist < contactDist && dist > 0.001) {
        const overlap = contactDist - dist;
        const pushX = (-dx / dist);
        const pushZ = (-dz / dist);

        // Push pad away smoothly
        pad.velocity.x += pushX * overlap * 12.0 * deltaTime;
        pad.velocity.z += pushZ * overlap * 12.0 * deltaTime;

        // Player velocity momentum transfer
        pad.velocity.x += playerController.currentVelocity.x * 0.25 * deltaTime;
        pad.velocity.z += playerController.currentVelocity.z * 0.25 * deltaTime;

        // Reactive tilt on water contact
        pad.tiltVelocity.x += (-pushZ * 1.5) * overlap * 8.0 * deltaTime;
        pad.tiltVelocity.z += (pushX * 1.5) * overlap * 8.0 * deltaTime;

        if (Math.random() < 0.15 && (pad.velocity.lengthSq() > 0.2)) {
          this.spawnRipple(pad.currentPos.x + pushX * pad.radius * 0.7, pad.currentPos.z + pushZ * pad.radius * 0.7, 0.8);
        }
      }

      // Spring-damped return force to anchor position
      const springK = 5.5;
      const waterDrag = 3.5;
      const forceX = -springK * (pad.currentPos.x - pad.anchorPos.x) - waterDrag * pad.velocity.x;
      const forceZ = -springK * (pad.currentPos.z - pad.anchorPos.z) - waterDrag * pad.velocity.z;

      pad.velocity.x += forceX * deltaTime;
      pad.velocity.z += forceZ * deltaTime;
      pad.currentPos.x += pad.velocity.x * deltaTime;
      pad.currentPos.z += pad.velocity.z * deltaTime;

      // Tilt oscillation & damping
      const tiltK = 14.0;
      const tiltDamp = 5.0;
      const tiltForceX = -tiltK * pad.currentTilt.x - tiltDamp * pad.tiltVelocity.x;
      const tiltForceZ = -tiltK * pad.currentTilt.z - tiltDamp * pad.tiltVelocity.z;

      pad.tiltVelocity.x += tiltForceX * deltaTime;
      pad.tiltVelocity.z += tiltForceZ * deltaTime;
      pad.currentTilt.x += pad.tiltVelocity.x * deltaTime;
      pad.currentTilt.z += pad.tiltVelocity.z * deltaTime;

      // Gentle water swell bobbing
      const swellBob = Math.sin(this._time * 2.2 + i * 1.6) * 0.025;
      pad.group.position.set(pad.currentPos.x, pad.currentPos.y + swellBob, pad.currentPos.z);
      pad.group.rotation.x = pad.currentTilt.x + Math.sin(this._time * 1.8 + i) * 0.02;
      pad.group.rotation.z = pad.currentTilt.z + Math.cos(this._time * 1.6 + i) * 0.02;
    }

    // --- 4. Aquatic Flora Sway & Bubble Spawning ---
    for (const f of this.flora) {
      const u = f.userData;
      for (const t of u.tentacles) {
        const sway = Math.sin(this._time * 2.0 + t.phase) * 0.18;
        t.mesh.rotation.z = Math.cos(t.baseAngle) * (0.32 + sway);
        t.mesh.rotation.x = Math.sin(t.baseAngle) * (0.32 + sway);
      }

      u.bubbleTimer += deltaTime;
      if (u.bubbleTimer > 6.0 + Math.random() * 2.0) {
        u.bubbleTimer = 0;
        this._spawnVitalityBubble(f.position.x, f.position.z, f.position.y);
      }
    }

    // --- 5. Vitality Bubbles Update & Player Pickup ---
    for (let i = this.vitalityBubbles.length - 1; i >= 0; i--) {
      const b = this.vitalityBubbles[i];
      if (b.y < b.targetY) {
        b.y += 0.8 * deltaTime;
      } else {
        b.y = b.targetY + Math.sin(this._time * 3.0 + b.wobbleSeed) * 0.06;
      }
      b.mesh.position.y = b.y;
      b.mesh.position.x = b.baseX + Math.sin(this._time * 1.8 + b.wobbleSeed) * 0.10;
      b.mesh.position.z = b.baseZ + Math.cos(this._time * 1.8 + b.wobbleSeed) * 0.10;

      const bdx = playerPosition.x - b.mesh.position.x;
      const bdz = playerPosition.z - b.mesh.position.z;
      const bDist = Math.sqrt(bdx * bdx + bdz * bdz);

      if (bDist < playerRadius + 0.35 && !b.collected) {
        b.collected = true;
        playBubblePopSound();
        this.spawnRipple(b.mesh.position.x, b.mesh.position.z, 0.9);
        this.spawnSplash(b.mesh.position.x, b.mesh.position.z, 6, 0.8);

        if (this.metabolismSystem) {
          this.metabolismSystem.addEnergy(8);
        }
        if (this.uiManager) {
          if (typeof this.uiManager.showToast === 'function') {
            this.uiManager.showToast('+8 Vitality (Oxygen Spore)');
          } else if (typeof this.uiManager.showPickupNotification === 'function') {
            this.uiManager.showPickupNotification('Oxygen Spore (+8 Energy)');
          }
        }

        this.scene.remove(b.mesh);
        this.vitalityBubbles.splice(i, 1);
      }
    }

    // --- 6. Splash Droplets Physics Update ---
    for (const s of this.splashes) {
      if (!s.active) continue;
      s.life += deltaTime;
      const progress = s.life / s.maxLife;
      if (progress >= 1.0) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        s.vel.y -= 14.0 * deltaTime;
        s.pos.x += s.vel.x * deltaTime;
        s.pos.y += s.vel.y * deltaTime;
        s.pos.z += s.vel.z * deltaTime;
        s.mesh.position.copy(s.pos);
        s.mesh.scale.setScalar(1.0 - progress * 0.7);
      }
    }

    // --- 7. Expanding Surface Ripples Update ---
    for (const r of this.ripples) {
      if (!r.active) continue;
      r.life += deltaTime;
      const progress = r.life / r.maxLife;
      if (progress >= 1.0) {
        r.active = false;
        r.mesh.visible = false;
      } else {
        const curScale = THREE.MathUtils.lerp(r.scale, r.maxScale, progress);
        r.mesh.scale.set(curScale, curScale, curScale);
        r.mesh.material.opacity = (1.0 - progress) * 0.85;
      }
    }

    // --- 8. Submerged Trail Bubbles Update ---
    for (const tb of this.trailBubbles) {
      if (!tb.active) continue;
      tb.life += deltaTime;
      const progress = tb.life / tb.maxLife;
      if (progress >= 1.0 || tb.pos.y >= LAKE_CONFIG.waterLevel) {
        tb.active = false;
        tb.mesh.visible = false;
      } else {
        tb.pos.y += tb.velY * deltaTime;
        tb.mesh.position.copy(tb.pos);
      }
    }

    // --- 9. Waterline Boundary Particles Update ---
    for (const wp of this.waterlineParticles) {
      if (!wp.active) continue;
      wp.life += deltaTime;
      const progress = wp.life / wp.maxLife;
      if (progress >= 1.0) {
        wp.active = false;
        wp.mesh.visible = false;
      } else {
        wp.pos.x += wp.vel.x * deltaTime;
        wp.pos.z += wp.vel.z * deltaTime;
        wp.pos.y = LAKE_CONFIG.waterLevel + 0.005 + Math.sin(this._time * 3.5 + wp.seed) * 0.012;
        wp.mesh.position.copy(wp.pos);

        const scaleCurve = Math.sin(progress * Math.PI);
        wp.mesh.scale.setScalar(wp.initialScale * scaleCurve);
        wp.mesh.material.opacity = (1.0 - progress) * 0.9;
      }
    }
  }

  realignToTerrain() {
    this.waterMesh.position.y = LAKE_CONFIG.waterLevel;
    if (this.meniscusMesh) {
      this.meniscusMesh.position.y = LAKE_CONFIG.waterLevel + 0.006;
    }
    for (let i = 0; i < this.lilypads.length; i++) {
      const pad = this.lilypads[i];
      pad.anchorPos.y = LAKE_CONFIG.waterLevel + 0.05;
      pad.currentPos.y = LAKE_CONFIG.waterLevel + 0.05;
      pad.group.position.y = LAKE_CONFIG.waterLevel + 0.05;
    }
    for (const f of this.flora) {
      f.position.y = getTerrainHeight(f.position.x, f.position.z);
    }
  }

  reset() {
    this._wasInWater = false;
    for (const pad of this.lilypads) {
      pad.currentPos.copy(pad.anchorPos);
      pad.velocity.set(0, 0, 0);
      pad.currentTilt.x = 0;
      pad.currentTilt.z = 0;
      pad.tiltVelocity.x = 0;
      pad.tiltVelocity.z = 0;
      pad.group.position.copy(pad.anchorPos);
    }

    for (const b of this.vitalityBubbles) {
      this.scene.remove(b.mesh);
    }
    this.vitalityBubbles.length = 0;

    for (const r of this.ripples) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const s of this.splashes) {
      s.active = false;
      s.mesh.visible = false;
    }
    for (const tb of this.trailBubbles) {
      tb.active = false;
      tb.mesh.visible = false;
    }
    if (this.waterlineParticles) {
      for (const wp of this.waterlineParticles) {
        wp.active = false;
        wp.mesh.visible = false;
      }
    }
    if (this.meniscusMesh) {
      this.meniscusMesh.visible = false;
      this.meniscusUniforms.uAlpha.value = 0;
    }
  }

  /**
   * Speed multiplier contributed by water buoyancy / viscous drag.
   * Recomputed fresh every frame in main.js.
   */
  getSpeedMultiplier(position) {
    if (!position || !isPointInLake(position.x, position.z)) return 1.0;
    const depth = getWaterDepth(position.x, position.z);
    if (depth <= 0.12) return 1.0;
    const load = this.burdenSystem ? this.burdenSystem.load : 0;
    if (load < 0.35) return 1.35; // Light slime: +35% glide speed boost
    return 0.35; // Heavy slime: 35% slow sludge drag
  }

  getAccelerationMultiplier(position) {
    if (!position || !isPointInLake(position.x, position.z)) return 1.0;
    const depth = getWaterDepth(position.x, position.z);
    if (depth <= 0.12) return 1.0;
    const load = this.burdenSystem ? this.burdenSystem.load : 0;
    if (load < 0.35) return 1.25;
    return 0.35;
  }
}
