// terrain.js — Texture-Driven 3D Terrain Elevation Engine

/**
 * 3D Terrain Elevation Engine - Texture-Driven
 *
 * Directly correlates subterranean 3D elevation with the visual features of cave_ground.jpg:
 * - Uplifts craggy rock mounds, stone ridges, and boulder formations (+1.5m to +3.2m).
 * - Downlifts cyan bioluminescent pools, crystal waters, and crater basins (-1.5m to -2.8m).
 * - Downlifts dark subterranean crevices, fissures, and shadows (-1.2m to -2.2m).
 * - Elevates purple fungal crater rims (+1.8m to +2.4m).
 * - Leaves cobblestone trails and pathways at neutral baseline with organic stone micro-variation.
 * - Samples texture coordinates using exact MirroredRepeatWrapping (repeat = 8, 8 over 200x200m).
 * - Uses bilinear filtering and spatial smoothing for seamless, climbable, tactile 3D terrain.
 */

// Must match the ground plane's own size and the texture's repeat exactly (see
// main.js's own "--- Ground ---" block) - this module's whole heightmap is a sample of
// the SAME texture at the SAME UV mapping the visible mesh uses, so any mismatch here
// puts the 3D bumps in the wrong place relative to what the texture actually shows.
// Currently 90 / 1: the ground was shrunk to match the texture's own single (untiled)
// span across the active play area, rather than repeating it across a much larger
// plane - GROUND_SIZE here moved from 200 to stay in lockstep with that.
export const GROUND_SIZE = 90;
export const TEXTURE_REPEAT = 1;

const HEIGHTMAP_RES = 256;
let heightmapData = null;
let isHeightmapReady = false;
const onReadyCallbacks = [];
const registeredGeometries = new Set();

/**
 * Normalized repeat fractional calculation matching WebGL RepeatWrapping.
 */
function repeatFrac(val) {
  const frac = val % 1.0;
  return frac < 0 ? frac + 1.0 : frac;
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

        // Distinct feature detection:
        // 1. Cyan crystal pools / glowing water (high green & blue relative to red)
        const cyanMetric = Math.max(0, (g + b) * 0.5 - r * 1.15);

        // 2. Purple fungal territory (high red & blue relative to green)
        const purpleMetric = Math.max(0, (r + b) * 0.5 - g * 1.15);

        // 3. Craggy rock / stone highlights (lighter rock textures and mounds)
        const rockFactor = Math.max(0, (lum - 0.11) / 0.38);

        // 4. Dark subterranean crevices and chasms
        const creviceFactor = Math.max(0, (0.09 - lum) / 0.09);

        // Calculate physical elevation:
        let elevation = 0;

        // Elevate rock ridges and stone mounds UP (+0.6m to +1.8m)
        elevation += Math.pow(rockFactor, 1.2) * 1.8;

        // De-elevate dark crevices and fissures DOWN (-0.5m to -1.0m)
        elevation -= Math.pow(creviceFactor, 1.1) * 1.0;

        // De-elevate cyan pools into sunken crystal basins (-0.6m to -1.5m)
        elevation -= cyanMetric * 1.8;

        // Elevate purple fungal crater rim (+0.6m to +1.2m)
        elevation += purpleMetric * 1.2;

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
  autoImg.src = 'assets/textures/cave_ground_new.png';
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

export function getTerrainHeight(x, z) {
  const distFromOrigin = Math.sqrt(x * x + z * z);
  const boundarySlope = distFromOrigin > BOUNDARY_SLOPE_START ? Math.min((distFromOrigin - BOUNDARY_SLOPE_START) * 0.06, 2.0) : 0;

  // 1. Texture-driven 3D relief: uplift rocks, downlift pools and crevices
  const textureElevation = sampleTextureHeight(x, z);

  // 2. Continuous subterranean macro undulation across the 200m cavern
  const macroRoll1 = Math.sin(x * 0.045 + 0.5) * Math.cos(z * 0.04 - 0.3) * 0.8;
  const macroRoll2 = Math.cos(x * 0.08 - 0.9) * Math.sin(z * 0.075 + 1.1) * 0.45;

  return textureElevation + macroRoll1 + macroRoll2 + boundarySlope;
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
