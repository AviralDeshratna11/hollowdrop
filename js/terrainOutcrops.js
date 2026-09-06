import * as THREE from 'three';
import { GROUND_SIZE, getTerrainHeight, isPointInLake } from './terrain.js?v=5.4';
import { makeRng } from './worldDressing.js?v=5.3';
import { sampleCaveLayout } from './caveLayout.js';

/** Irregular beveled shelves with world-projected paint, merged into one draw. */
export function createTerrainOutcrops(scene, floorMaterial) {
  const rng = makeRng(0x51a7e);
  const positions = [], uvs = [];
  const triangle = (a, b, c) => {
    for (const p of [a, b, c]) {
      positions.push(...p);
      uvs.push(p[0] / GROUND_SIZE + 0.5, 0.5 - p[2] / GROUND_SIZE);
    }
  };
  for (let i = 0; i < 1400; i++) {
    const x = (rng() - 0.5) * 83;
    const z = (rng() - 0.5) * 83;
    if (isPointInLake(x, z) || Math.hypot(x, z) < 1.7) continue;
    const layout = sampleCaveLayout(x, z);
    // Banks get grouped slate shelves; the worn path centers stay legible.
    if (rng() > (1 - layout.path) * (0.85 - layout.moss * 0.5)) continue;
    const radius = 0.32 + rng() * 0.7;
    const angle = rng() * Math.PI * 2;
    const rise = 0.055 + rng() * 0.065;
    const outer = [], inner = [];
    for (let j = 0; j < 7; j++) {
      const theta = angle - j / 7 * Math.PI * 2;
      const r = radius * (0.72 + rng() * 0.4);
      const dx = Math.cos(theta) * r;
      const dz = Math.sin(theta) * r * 0.72;
      outer.push([x + dx, getTerrainHeight(x + dx, z + dz) + 0.005, z + dz]);
      inner.push([x + dx * 0.8, getTerrainHeight(x + dx * 0.8, z + dz * 0.8) + rise, z + dz * 0.8]);
    }
    const center = [x, getTerrainHeight(x, z) + rise, z];
    for (let j = 0; j < 7; j++) {
      const next = (j + 1) % 7;
      triangle(center, inner[j], inner[next]);
      triangle(inner[j], outer[j], outer[next]);
      triangle(inner[j], outer[next], inner[next]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const stones = new THREE.Mesh(geometry, floorMaterial);
  stones.castShadow = true;
  stones.receiveShadow = true;
  stones.name = 'Painted raised slate shelves';
  scene.add(stones);
  addMossCover(scene, rng);
  return stones;
}

function addMossCover(scene, rng) {
  const patches = [];
  for (let i = 0; i < 360; i++) {
    const x = (rng() - 0.5) * 78, z = (rng() - 0.5) * 78;
    if (!isPointInLake(x, z) && sampleCaveLayout(x, z).moss > 0.48) patches.push([x, z]);
  }
  const leavesPerPatch = 48;
  // Separate spatial batches let frustum culling skip distant foliage without
  // reducing the number of leaves or the detail visible near the player.
  const cells = new Map();
  for (const patch of patches) {
    const key = `${Math.floor(patch[0] / 12)},${Math.floor(patch[1] / 12)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(patch);
  }
  const leafGeometry = new THREE.SphereGeometry(1, 6, 4);
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  for (const cellPatches of cells.values()) {
    const foliage = new THREE.InstancedMesh(
      leafGeometry, leafMaterial, cellPatches.length * leavesPerPatch
    );
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    let index = 0;
    for (const [cx, cz] of cellPatches) for (let i = 0; i < leavesPerPatch; i++) {
      const theta = rng() * Math.PI * 2, radius = Math.sqrt(rng()) * 0.62;
      const x = cx + Math.cos(theta) * radius, z = cz + Math.sin(theta) * radius * 0.6;
      dummy.position.set(x, getTerrainHeight(x, z) + 0.025, z);
      dummy.rotation.set(rng() * 0.5, theta, 0);
      const size = 0.035 + rng() * 0.045;
      dummy.scale.set(size, size * 0.22, size * 0.7);
      dummy.updateMatrix();
      foliage.setMatrixAt(index, dummy.matrix);
      color.setHSL(0.24 + rng() * 0.04, 0.60 + rng() * 0.16, 0.035 + rng() * 0.045);
      foliage.setColorAt(index++, color);
    }
    foliage.receiveShadow = true;
    foliage.name = 'Low moss and clover';
    foliage.computeBoundingSphere();
    scene.add(foliage);
  }
}
