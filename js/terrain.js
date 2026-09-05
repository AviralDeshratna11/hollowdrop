// terrain.js — Texture-Driven 3D Terrain Elevation Engine

/**
 * The color atlas and authored semantic height map cover the same 90m square.
 * Image top is world -Z. One UV span covers all nine unique regions.
 * Geometry, creatures, collision heights and props all sample this height field.
 * Physical relief is independent of snow, glow and other albedo colors.
 */
export const GROUND_SIZE = 90;
export const GROUND_ATLAS_URL = 'assets/textures/biomes/terrain-atlas.png?v=1';
export const GROUND_HEIGHTMAP_URL = 'assets/textures/biomes/terrain-height.png?v=1';
export const TEXTURE_REPEAT = 1;

const HEIGHTMAP_RES = 512;
let heightmapData = null;
let isHeightmapReady = false;
const onReadyCallbacks = [];
const registeredGeometries = new Set();

/**
 * Normalized atlas fractional calculation matching the single non-repeating ground
 * mesh. The generated image already contains nine distinct regions, so the sampler
 * should move once across the whole atlas instead of repeating or mirroring.
 */
function atlasFrac(val) {
  return Math.min(1.0, Math.max(0, val));
}

/**
 * Low relief fallback used before or in absence of height-map decoding.
 */
function sampleAnalyticalHeight(worldX, worldZ) {
  const u = atlasFrac((worldX / GROUND_SIZE) + 0.5);
  const v = atlasFrac((-worldZ / GROUND_SIZE) + 0.5);

  // Approximate texture features analytically
  const wave1 = Math.sin(u * Math.PI * 6) * Math.cos(v * Math.PI * 6);
  const wave2 = Math.sin(u * Math.PI * 12 + 1.2) * Math.cos(v * Math.PI * 12 - 0.7) * 0.6;
  const wave3 = Math.cos(u * Math.PI * 24 - 0.5) * Math.sin(v * Math.PI * 24 + 0.3) * 0.3;

  const combined = wave1 + wave2 + wave3;
  return combined * 0.15;
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
 * Decodes the separate grayscale relief map and smooths it into climbable slopes.
 * Clamp sampling at the world edges; opposite edges are not adjacent.
 */
export function initTerrainHeightmap(image, onReady = null) {
  if (onReady) {
    onTerrainElevationReady(onReady);
  }

  if (!image) return;

  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement && !image.complete) {
    image.addEventListener('load', () => {
      initTerrainHeightmap(image);
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
        // Authored semantic height, independent of albedo: 128 = level path,
        // 0 = -1.2m depression, 255 = +1.2m ridge. Snow and bright minerals
        // are therefore not automatically interpreted as mountains.
        const elevation = (imgData[idx] - 128) / 128 * 1.2;

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
              const nx = Math.min(w - 1, Math.max(0, x + dx));
              const ny = Math.min(h - 1, Math.max(0, y + dy));
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
    console.warn('Could not decode terrain height map, using analytical fallback.', err);
  }
}

/**
 * Samples the texture heightmap using bilinear filtering over the generated atlas.
 */
function sampleTextureHeight(worldX, worldZ) {
  if (!heightmapData || !isHeightmapReady) {
    return sampleAnalyticalHeight(worldX, worldZ);
  }

  // Normalized UV coordinates [0..1] over the full 3x3 atlas.
  // PlaneGeometry localY is -worldZ; WebGL texture flipY places UV (0,1) at image top (y=0)
  const uFrac = atlasFrac((worldX / GROUND_SIZE) + 0.5);
  const vFrac = atlasFrac((-worldZ / GROUND_SIZE) + 0.5);

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

  // 1. Authored relief: uplift rocks, downlift pools and crevices.
  const rawTextureElevation = sampleTextureHeight(x, z);

  // 2. Subtle macro undulation across the 90m cavern
  const macroRoll1 = Math.sin(x * 0.045 + 0.5) * Math.cos(z * 0.04 - 0.3) * 0.15;
  const macroRoll2 = Math.cos(x * 0.08 - 0.9) * Math.sin(z * 0.075 + 1.1) * 0.08;

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
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export default {
  GROUND_SIZE,
  TEXTURE_REPEAT,
  initTerrainHeightmap,
  onTerrainElevationReady,
  getTerrainHeight,
  applyTerrainElevation,
};
