import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js?v=5.4';

/**
 * Decorative world props - dark rocks and glowing toxic flora. Originally lived
 * inside apexEncounterManager.js and only ever dressed the Apex arena; extracted here
 * so the same props can also break up the wider map, which was otherwise a flat
 * unbroken plane everywhere except that one circle.
 *
 * Everything is drawn with InstancedMesh: one draw call for all rocks, one for all
 * plant stalks, one for all plant glows, regardless of how many are scattered. This
 * game is mobile-first and a per-prop Mesh would have meant ~80 extra draw calls for
 * pure decoration. Nothing here is interactive, nothing collides, and nothing updates
 * per frame - it is built once at load and then costs only its draw calls.
 */

const ROCK_BASE_RADIUS = 0.5;
const rockGeometry = new THREE.DodecahedronGeometry(ROCK_BASE_RADIUS, 0);

/** Solid radius for a rock at a given scale. Deliberately tighter than the visual
 *  0.5 * scale: a collider matching the silhouette exactly makes you catch on corners
 *  that look like clear space, and these are faceted dodecahedra whose corners stick
 *  out well past their average radius. */
export function rockColliderRadius(scale) {
  return ROCK_BASE_RADIUS * scale * 0.78;
}
const plantBodyGeometry = new THREE.CylinderGeometry(0.04, 0.08, 0.35, 8);
const plantGlowGeometry = new THREE.SphereGeometry(0.14, 10, 8);

// Scratch objects - instance matrices are composed here rather than allocating a
// Matrix4/Quaternion per prop.
const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const tempScale = new THREE.Vector3();

/** Deterministic PRNG (mulberry32). The world's prop layout is generated at load, and
 *  a seeded generator means it looks identical on every refresh instead of reshuffling
 *  itself - the same reasoning as the ground mottling in main.js. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRockMaterial(color) {
  return new THREE.MeshStandardMaterial({ flatShading: true, color, roughness: 0.9 });
}

const registeredDressingGroups = [];
const registeredGroundPlanes = [];

/** Re-aligns all decorative instanced rocks, arena flora, and arena ground disks to current terrain height. */
export function realignDressingToTerrain() {
  for (const entry of registeredDressingGroups) {
    const { rockMesh, rocks, bodyMesh, glowMesh, plants } = entry;
    if (rockMesh && rocks) {
      rocks.forEach((r, i) => {
        const groundY = getTerrainHeight(r.x, r.z);
        tempPosition.set(r.x, groundY + 0.3 * r.scale, r.z);
        tempEuler.set(r.rotation.x, r.rotation.y, r.rotation.z);
        tempQuaternion.setFromEuler(tempEuler);
        tempScale.setScalar(r.scale);
        rockMesh.setMatrixAt(i, tempMatrix.compose(tempPosition, tempQuaternion, tempScale));
      });
      rockMesh.instanceMatrix.needsUpdate = true;
    }

    if (bodyMesh && glowMesh && plants) {
      plants.forEach((p, i) => {
        tempQuaternion.identity();
        tempScale.setScalar(p.scale);
        const groundY = getTerrainHeight(p.x, p.z);
        tempPosition.set(p.x, groundY + 0.3 * p.scale, p.z);
        bodyMesh.setMatrixAt(i, tempMatrix.compose(tempPosition, tempQuaternion, tempScale));
        tempPosition.set(p.x, groundY + 0.62 * p.scale, p.z);
        glowMesh.setMatrixAt(i, tempMatrix.compose(tempPosition, tempQuaternion, tempScale));
      });
      bodyMesh.instanceMatrix.needsUpdate = true;
      glowMesh.instanceMatrix.needsUpdate = true;
    }
  }

  for (const plane of registeredGroundPlanes) {
    plane.mesh.position.y = getTerrainHeight(plane.center.x, plane.center.z) + 0.01;
  }
}

/** Builds the InstancedMeshes for a set of already-decided prop placements.
 *  `rocks` and `plants` are arrays of { x, z, scale, rotation }. */
function buildInstances(scene, rocks, plants = [], { rockColor, plantBodyColor, plantGlowColor, glowIntensity } = {}) {
  let rockMesh = null;
  if (rocks.length > 0) {
    rockMesh = new THREE.InstancedMesh(rockGeometry, createRockMaterial(rockColor), rocks.length);
    rocks.forEach((r, i) => {
      const groundY = getTerrainHeight(r.x, r.z);
      tempPosition.set(r.x, groundY + 0.3 * r.scale, r.z);
      tempEuler.set(r.rotation.x, r.rotation.y, r.rotation.z);
      tempQuaternion.setFromEuler(tempEuler);
      tempScale.setScalar(r.scale);
      rockMesh.setMatrixAt(i, tempMatrix.compose(tempPosition, tempQuaternion, tempScale));
    });
    rockMesh.instanceMatrix.needsUpdate = true;
    scene.add(rockMesh);
  }

  let bodyMesh = null;
  let glowMesh = null;
  if (plants.length > 0) {
    const bodyMaterial = new THREE.MeshStandardMaterial({ flatShading: true, color: plantBodyColor, roughness: 0.7 });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: plantGlowColor,
      emissive: plantGlowColor,
      emissiveIntensity: glowIntensity,
      roughness: 0.3,
    });

    bodyMesh = new THREE.InstancedMesh(plantBodyGeometry, bodyMaterial, plants.length);
    glowMesh = new THREE.InstancedMesh(plantGlowGeometry, glowMaterial, plants.length);
    plants.forEach((p, i) => {
      tempQuaternion.identity();
      tempScale.setScalar(p.scale);

      const groundY = getTerrainHeight(p.x, p.z);

      tempPosition.set(p.x, groundY + 0.3 * p.scale, p.z);
      bodyMesh.setMatrixAt(i, tempMatrix.compose(tempPosition, tempQuaternion, tempScale));

      tempPosition.set(p.x, groundY + 0.62 * p.scale, p.z);
      glowMesh.setMatrixAt(i, tempMatrix.compose(tempPosition, tempQuaternion, tempScale));
    });
    bodyMesh.instanceMatrix.needsUpdate = true;
    glowMesh.instanceMatrix.needsUpdate = true;
    scene.add(bodyMesh, glowMesh);
  }

  registeredDressingGroups.push({ rockMesh, rocks, bodyMesh, glowMesh, plants });
}

/**
 * The Apex arena's own dressing - a tinted ground patch plus a ring of rocks and
 * violet flora, so the territory reads as dangerous before anything happens. Same
 * placement logic and same look as the original in apexEncounterManager.js, now
 * seeded rather than Math.random()-driven so the arena is laid out identically on
 * every load.
 */
export function buildArenaDressing(scene, center, radius, rng = makeRng(0x4a11)) {
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x140a1c, roughness: 1, transparent: true, opacity: 0.55 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.15, 32), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, getTerrainHeight(center.x, center.z) + 0.01, center.z);
  scene.add(ground);
  registeredGroundPlanes.push({ mesh: ground, center });

  const rocks = [];
  const rockCount = 6;
  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2 + rng() * 0.4;
    const dist = radius * (0.75 + rng() * 0.3);
    rocks.push({
      x: center.x + Math.cos(angle) * dist,
      z: center.z + Math.sin(angle) * dist,
      scale: 0.6 + rng() * 0.6,
      rotation: { x: rng() * Math.PI, y: rng() * Math.PI, z: rng() * Math.PI },
    });
  }

  const plants = [];
  const plantCount = 8;
  for (let i = 0; i < plantCount; i++) {
    const angle = (i / plantCount) * Math.PI * 2 + rng() * 0.5;
    const dist = radius * (0.4 + rng() * 0.55);
    plants.push({
      x: center.x + Math.cos(angle) * dist,
      z: center.z + Math.sin(angle) * dist,
      scale: 0.7 + rng() * 0.5,
    });
  }

  buildInstances(scene, rocks, plants, {
    rockColor: 0x1c1420,
    plantBodyColor: 0x140a1e,
    plantGlowColor: 0xb23fff,
    glowIntensity: 1.1,
  });

  // Returned so the caller can make these solid. Only the rocks - the flora is soft and
  // walking through a glowing frond is fine; walking through a boulder is not.
  return { rocks };
}

/**
 * Scatters props across the general playable area, so the map reads as a cave floor
 * rather than an empty plane once you leave the arena.
 *
 * `exclusions` is a list of { x, z, radius } kept clear - used for the player's spawn,
 * the extraction pedestal, and the Apex arena (which has its own, denser dressing and
 * would otherwise get double-decorated). Placement is rejection-sampled against them.
 *
 * The scatter is deliberately kept OUTSIDE an inner radius as well: the opening moments
 * of a run are a readable ring of collectible resources around spawn, and burying that
 * in decoration would make the first thing the player does harder, not prettier.
 */
export function scatterWorldDressing(scene, {
  innerRadius = 7,
  // Kept a little inside the fog's far plane (55): props spawned beyond that fade to
  // nothing anyway, so pushing the radius further just thins out the density in the
  // band the player actually walks through, for props they'd never see.
  outerRadius = 34,
  rockCount = 70,
  exclusions = [],
  seed = 0x484f4c,
} = {}) {
  const rng = makeRng(seed);

  const isClear = (x, z) => exclusions.every(({ x: ex, z: ez, radius }) => {
    const dx = x - ex;
    const dz = z - ez;
    return dx * dx + dz * dz > radius * radius;
  });

  /** Rejection-samples a point in the annulus that clears every exclusion. Gives up
   *  after a bounded number of tries and returns null rather than looping forever if
   *  the exclusions ever grow to cover the whole band. */
  const samplePoint = () => {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = rng() * Math.PI * 2;
      // sqrt keeps the distribution even across the annulus instead of clumping inward
      const dist = Math.sqrt(innerRadius ** 2 + rng() * (outerRadius ** 2 - innerRadius ** 2));
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      if (isClear(x, z)) return { x, z };
    }
    return null;
  };

  const rocks = [];
  for (let i = 0; i < rockCount; i++) {
    const p = samplePoint();
    if (!p) continue;
    rocks.push({
      x: p.x,
      z: p.z,
      scale: 0.5 + rng() * 0.9,
      rotation: { x: rng() * Math.PI, y: rng() * Math.PI, z: rng() * Math.PI },
    });
  }

  // The rock colour is deliberately DARKER than the darkest part of the ground
  // mottling rather than a mid-tone: a rock tinted close to the floor's own range just
  // disappears into it. Sitting below the floor's value makes each one read as a
  // silhouette, and the scene's rim light then catches its top edge - the same thing
  // that makes the creatures legible against this background.
  //
  // Unpickable greenish flora has been removed so all glowing mushrooms/spores on the
  // ground are exclusively collectible resources.
  buildInstances(scene, rocks, [], {
    rockColor: 0x0d1310,
  });

  return { rocks };
}
