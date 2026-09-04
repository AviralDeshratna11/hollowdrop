// terrain.js — Texture-Driven 3D Terrain Elevation Engine

/**
 * 3D Terrain Elevation Engine - Texture-Driven
 *
 * Directly correlates subterranean 3D elevation with the visual features of the ground
 * texture's five biome regions (see main.js's own "--- Ground ---" block for the actual
 * image - a single full-map illustration, not a small tileable pattern):
 * - Uplifts icy crystal peaks and violet crystal-cave formations (bright/saturated,
 *   high-luminance regions) into jagged elevated terrain (+0.8m to +2.2m).
 * - Downlifts the teal/cyan pool into a sunken basin (-0.6m to -1.8m).
 * - Downlifts dark subterranean crevices and shadows (-0.5m to -1.0m).
 * - Gently uplifts mossy green and molten-red regions into low rolling mounds
 *   (+0.3m to +1.0m).
 * - Leaves the neutral gray stone paths at baseline with organic micro-variation.
 * - Samples texture coordinates using the same 1:1 UV mapping the visible mesh uses
 *   (GROUND_SIZE/TEXTURE_REPEAT below, kept in sync with main.js's own ground texture
 *   setup - a single untiled copy, so no wrap-mode repetition to account for).
 * - Uses bilinear filtering and spatial smoothing for seamless, climbable, tactile 3D
 *   terrain across the large solid-color biome regions.
 */

// Must match the ground plane's own size and the texture's repeat exactly (see
// main.js's own "--- Ground ---" block) - this module's whole heightmap is a sample of
// the SAME texture at the SAME UV mapping the visible mesh uses, so any mismatch here
// puts the 3D bumps in the wrong place relative to what the texture actually shows.
export const GROUND_SIZE = 90;
export const TEXTURE_REPEAT = 1; // single untiled copy - see main.js's own comment

const HEIGHTMAP_RES = 256;
let heightmapData = null;
let isHeightmapReady = false;
const onReadyCallbacks = [];
const registeredGeometries = new Set();

/**
 * Normalized repeat fractional calculation. At TEXTURE_REPEAT=1 (a single untiled copy
 * - see main.js's own "--- Ground ---" block) every world coordinate maps to u/v inside
 * [0,1] and this is just the identity; kept as a period-2 triangle wave (rather than
 * plain modulo) so this heightmap sampling stays correct if tiling with
 * MirroredRepeatWrapping is ever reintroduced, where every other tile is flipped.
 */
function repeatFrac(val) {
  let t = val % 2.0;
  if (t < 0) t += 2.0;
  return t <= 1.0 ? t : 2.0 - t;
}

/**
 * Analytical fallback terrain field matching texture frequency and features
 * used before or in absence of image decoding.
 */
function sampleAnalyticalHeight(worldX, worldZ) {
  const u = repeatFrac(((worldX / GROUND_SIZE) + 0.5) * TEXTURE_REPEAT);
  const v = repeatFrac(((-worldZ / GROUND_SIZE) + 0.5) * TEXTURE_REPEAT);

  // Approximate texture features analytically
  const wave1 = Math.sin(u * Math.PI * 2) * Math.cos(v * Math.PI * 2);
  const wave2 = Math.sin(u * Math.PI * 4 + 1.2) * Math.cos(v * Math.PI * 4 - 0.7) * 0.6;
  const wave3 = Math.cos(u * Math.PI * 8 - 0.5) * Math.sin(v * Math.PI * 8 + 0.3) * 0.3;

  const combined = wave1 + wave2 + wave3;
  return combined * 1.4;
}

/**
 * Registers a callback to be called when the terrain elevation heightmap is loaded and ready.
 * If already ready, invokes callback immediately.
 */
export function onTerrainElevationReady(cb) {
  if (!cb) return;
  if (isHeightmapReady) {
    cb();
  } else {
    onReadyCallbacks.push(cb);
  }
}

/**
 * Decodes image data from cave_ground.jpg onto an offscreen canvas and constructs
 * a high-fidelity, smoothed elevation grid based on the texture features.
 */
export function initTextureElevation(image, onReady = null) {
  if (onReady) {
    onTerrainElevationReady(onReady);
  }

  if (!image) return;

  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement && !image.complete) {
    image.addEventListener('load', () => {
      initTextureElevation(image, onReady);
    }, { once: true });
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    const w = HEIGHTMAP_RES;
    const h = HEIGHTMAP_RES;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h).data;

    const rawGrid = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = imgData[idx] / 255;
        const g = imgData[idx + 1] / 255;
        const b = imgData[idx + 2] / 255;

        // Perceptual luminance calculation
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Distinct feature detection, tuned to this image's five biome regions:
        // 1. Icy crystal peaks (top-right) - bright AND blue-leaning, distinguished from
        //    the teal pool below by luminance so the two don't overlap.
        const iceMetric = lum > 0.5 ? Math.max(0, (g + b) * 0.5 - r) : 0;

        // 2. Teal/cyan pool (bottom-center) - cyan-leaning but darker than the ice peaks.
        const poolMetric = lum <= 0.5 ? Math.max(0, (g + b) * 0.5 - r * 1.15) : 0;

        // 3. Violet crystal cave (top-left) - high red & blue relative to green.
        const purpleMetric = Math.max(0, (r + b) * 0.5 - g * 1.15);

        // 4. Molten red region (bottom-right) - warm red-orange, low green & blue.
        const lavaMetric = Math.max(0, r - (g + b) * 0.6);

        // 5. Craggy rock / stone path highlights (general micro-variation everywhere)
        const rockFactor = Math.max(0, (lum - 0.11) / 0.38);

        // 6. Dark subterranean crevices and chasms
        const creviceFactor = Math.max(0, (0.09 - lum) / 0.09);

        // Calculate physical elevation:
        let elevation = 0;

        // Elevate rock ridges and stone mounds UP (baseline micro-variation everywhere)
        elevation += Math.pow(rockFactor, 1.2) * 1.2;

        // De-elevate dark crevices and fissures DOWN
        elevation -= Math.pow(creviceFactor, 1.1) * 1.0;

        // Uplift icy crystal peaks into jagged elevated terrain
        elevation += iceMetric * 2.2;

        // De-elevate the teal pool into a sunken basin
        elevation -= poolMetric * 1.8;

        // Elevate the violet crystal-cave formations
        elevation += purpleMetric * 1.6;

        // Gently mound the molten-red region (raised scorched rock crust)
        elevation += lavaMetric * 0.8;

        rawGrid[y * w + x] = elevation;
      }
    }

    // 2-pass spatial box smoothing for smooth, climbable, organic slopes
    const smoothedGrid = new Float32Array(w * h);
    const radius = 2;

    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? rawGrid : smoothedGrid;
      const dst = pass === 0 ? smoothedGrid : rawGrid;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          let count = 0;

          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const nx = (x + dx + w) % w;
              const ny = (y + dy + h) % h;
              sum += src[ny * w + nx];
              count++;
            }
          }

          dst[y * w + x] = sum / count;
        }
      }
    }

    heightmapData = rawGrid;
    isHeightmapReady = true;

    for (const geom of registeredGeometries) {
      try {
        applyTerrainElevation(geom);
      } catch (e) {
        console.error(e);
      }
    }

    while (onReadyCallbacks.length > 0) {
      const cb = onReadyCallbacks.shift();
      try { cb(); } catch (e) { console.error(e); }
    }
  } catch (err) {
    console.warn('Could not decode texture heightmap directly, using analytical field.', err);
  }
}

// Auto-load texture eagerly if running in browser
if (typeof Image !== 'undefined') {
  const autoImg = new Image();
  autoImg.crossOrigin = 'anonymous';
  autoImg.src = 'assets/textures/cave_ground_new.jpg';
  autoImg.onload = () => {
    initTextureElevation(autoImg);
  };
}

/**
 * Samples the texture heightmap using bilinear filtering and RepeatWrapping.
 */
function sampleTextureHeight(worldX, worldZ) {
  if (!heightmapData || !isHeightmapReady) {
    return sampleAnalyticalHeight(worldX, worldZ);
  }

  // Normalized UV coordinates [0..TEXTURE_REPEAT]
  // PlaneGeometry localY is -worldZ; WebGL texture flipY places UV (0,1) at image top (y=0)
  const uFrac = repeatFrac(((worldX / GROUND_SIZE) + 0.5) * TEXTURE_REPEAT);
  const vFrac = repeatFrac(((-worldZ / GROUND_SIZE) + 0.5) * TEXTURE_REPEAT);

  const fx = uFrac * (HEIGHTMAP_RES - 1);
  const fy = (1.0 - vFrac) * (HEIGHTMAP_RES - 1);

  const x0 = Math.floor(fx);
  const x1 = Math.min(x0 + 1, HEIGHTMAP_RES - 1);
  const y0 = Math.floor(fy);
  const y1 = Math.min(y0 + 1, HEIGHTMAP_RES - 1);

  const dx = fx - x0;
  const dy = fy - y0;

  const h00 = heightmapData[y0 * HEIGHTMAP_RES + x0];
  const h10 = heightmapData[y0 * HEIGHTMAP_RES + x1];
  const h01 = heightmapData[y1 * HEIGHTMAP_RES + x0];
  const h11 = heightmapData[y1 * HEIGHTMAP_RES + x1];

  const top = h00 * (1 - dx) + h10 * dx;
  const bot = h01 * (1 - dx) + h11 * dx;

  return top * (1 - dy) + bot * dy;
}

/**
 * Authoritative terrain height query for any (x, z) coordinate in world space.
 */
// Rise-start distance for the boundary slope below, as a fraction of the ground's own
// half-width - was a flat 80 tuned for the old GROUND_SIZE=200 (half-width 100, so 0.8
// of it); kept as the same fraction rather than a fixed number so it still reads as
// "the far edge is rising" rather than either never triggering or swallowing most of a
// much smaller map.
const BOUNDARY_SLOPE_START = (GROUND_SIZE / 2) * 0.8;

export const LAKE_CONFIG = {
  center: { x: 3.5, z: 20.5 },
  rx: 17.5,
  rz: 14.5,
  waterLevel: -0.35,
  maxDepth: 2.2,
};

/**
 * Normalized 0..1 factor of how deep inside the lake basin a coordinate is (1 = center, 0 = shore/outside).
 */
export function getLakeBasinFactor(x, z) {
  const dx = (x - LAKE_CONFIG.center.x) / LAKE_CONFIG.rx;
  const dz = (z - LAKE_CONFIG.center.z) / LAKE_CONFIG.rz;
  const distSq = dx * dx + dz * dz;
  if (distSq >= 1.0) return 0;
  const radialDist = Math.sqrt(distSq);
  const t = 1.0 - radialDist;
  return t * t * (3 - 2 * t);
}

export function isPointInLake(x, z) {
  const dx = (x - LAKE_CONFIG.center.x) / LAKE_CONFIG.rx;
  const dz = (z - LAKE_CONFIG.center.z) / LAKE_CONFIG.rz;
  return (dx * dx + dz * dz) < 1.0;
}

export function getWaterDepth(x, z) {
  if (!isPointInLake(x, z)) return 0;
  const groundY = getTerrainHeight(x, z);
  return Math.max(0, LAKE_CONFIG.waterLevel - groundY);
}

export function getTerrainHeight(x, z) {
  const distFromOrigin = Math.sqrt(x * x + z * z);
  const boundarySlope = distFromOrigin > BOUNDARY_SLOPE_START ? Math.min((distFromOrigin - BOUNDARY_SLOPE_START) * 0.06, 2.0) : 0;

  // 1. Texture-driven 3D relief: uplift rocks, downlift pools and crevices
  const rawTextureElevation = sampleTextureHeight(x, z);

  // 2. Continuous subterranean macro undulation across the 200m cavern
  const macroRoll1 = Math.sin(x * 0.045 + 0.5) * Math.cos(z * 0.04 - 0.3) * 0.8;
  const macroRoll2 = Math.cos(x * 0.08 - 0.9) * Math.sin(z * 0.075 + 1.1) * 0.45;

  // 3. Smooth sunken Abyssal Lake basin with bank drop & sediment smoothing
  const dx = (x - LAKE_CONFIG.center.x) / LAKE_CONFIG.rx;
  const dz = (z - LAKE_CONFIG.center.z) / LAKE_CONFIG.rz;
  const distSq = dx * dx + dz * dz;

  let textureElevation = rawTextureElevation;
  let lakeDip = 0;

  if (distSq < 1.0) {
    const radialDist = Math.sqrt(distSq);
    const t = 1.0 - radialDist; // 0 at shore, 1 at center

    // Smooth bank drop over the outer 20% to step cleanly below waterLevel
    const bankT = Math.min(1.0, t * 5.0);
    const smoothBank = bankT * bankT * (3.0 - 2.0 * bankT);
    const bankDrop = smoothBank * 0.65;

    // Smooth bowl deepening toward the center
    const centerDip = Math.pow(t, 1.3) * (LAKE_CONFIG.maxDepth - 0.65);
    lakeDip = bankDrop + centerDip;

    // Smooth dry-cavern rock mounds inside the lake into sedimented lakebed
    const rockSmoothing = Math.max(0.12, 1.0 - smoothBank * 0.88);
    textureElevation = rawTextureElevation * rockSmoothing;
  }

  return textureElevation + macroRoll1 + macroRoll2 + boundarySlope - lakeDip;
}

/**
 * Deforms PlaneGeometry in local space to match the texture-driven 3D elevation field.
 */
export function applyTerrainElevation(geometry) {
  if (geometry) registeredGeometries.add(geometry);

  const positions = geometry.attributes.position;
  const count = positions.count;

  for (let i = 0; i < count; i++) {
    const localX = positions.getX(i);
    const localY = positions.getY(i);

    const worldX = localX;
    const worldZ = -localY;

    const elevation = getTerrainHeight(worldX, worldZ);
    positions.setZ(i, elevation);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}

export default {
  GROUND_SIZE,
  TEXTURE_REPEAT,
  initTextureElevation,
  onTerrainElevationReady,
  getTerrainHeight,
  applyTerrainElevation,
};
