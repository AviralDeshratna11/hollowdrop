import * as THREE from 'three';

// Geometry is shared across every instance of a type (cheap on mobile).
// Materials are created per-instance since each resource pulses/fades independently.
const sporeGeometry = new THREE.SphereGeometry(0.15, 12, 12);
const mushroomCapGeometry = new THREE.SphereGeometry(0.14, 12, 8);
const mushroomStemGeometry = new THREE.CylinderGeometry(0.045, 0.06, 0.18, 8);
const stoneGeometry = new THREE.DodecahedronGeometry(0.16, 0);
const ironGeometry = new THREE.DodecahedronGeometry(0.18, 0);
const ironFragmentGeometry = new THREE.OctahedronGeometry(0.045, 0);
const dnaCoreGeometry = new THREE.SphereGeometry(0.1, 12, 10);
const dnaOrbiterGeometry = new THREE.SphereGeometry(0.035, 8, 6);

function makeSpore(color) {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.85,
    roughness: 0.2,
  });
  const mesh = new THREE.Mesh(sporeGeometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  group.userData.pulseMaterials = [material];
  return group;
}

function makeMushroom(color) {
  const capMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.5,
    roughness: 0.4,
  });
  const stemMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8ddc7,
    roughness: 0.8,
  });

  const stem = new THREE.Mesh(mushroomStemGeometry, stemMaterial);
  stem.position.y = 0.09;

  const cap = new THREE.Mesh(mushroomCapGeometry, capMaterial);
  cap.position.y = 0.17;
  cap.scale.set(1, 0.6, 1);

  const group = new THREE.Group();
  group.add(stem, cap);
  group.userData.pulseMaterials = [capMaterial];
  return group;
}

function makeStone() {
  const material = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95 });
  const mesh = new THREE.Mesh(stoneGeometry, material);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  mesh.scale.set(1 + Math.random() * 0.2, 0.8 + Math.random() * 0.2, 1 + Math.random() * 0.2);

  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function makeIron() {
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.85, metalness: 0.2 });
  const rock = new THREE.Mesh(ironGeometry, rockMaterial);

  const fragmentMaterial = new THREE.MeshStandardMaterial({
    color: 0x6fe3ff,
    emissive: 0x2fb8e0,
    emissiveIntensity: 0.7,
    metalness: 0.6,
    roughness: 0.3,
  });

  const group = new THREE.Group();
  group.add(rock);

  const fragmentCount = 3;
  for (let i = 0; i < fragmentCount; i++) {
    const fragment = new THREE.Mesh(ironFragmentGeometry, fragmentMaterial);
    const angle = (i / fragmentCount) * Math.PI * 2;
    fragment.position.set(Math.cos(angle) * 0.12, Math.sin(angle * 1.3) * 0.08, Math.sin(angle) * 0.12);
    group.add(fragment);
  }

  group.userData.pulseMaterials = [fragmentMaterial];
  return group;
}

/** Rare biological material: a glowing nucleus with small orbiting particles - reads
 *  as "special DNA" against the other resources' single-blob silhouettes. Predator
 *  DNA passes orbiterCount=3 (vs. the default 2) for a slightly busier/"stronger"
 *  pulse - modelScale in resourceTypes.js does the rest of the size difference, so
 *  no separate geometry is needed to make it read as more significant. */
function makeDna(color, orbiterCount = 2) {
  const coreMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.1,
    transparent: true,
    opacity: 0.9,
    roughness: 0.2,
  });
  const core = new THREE.Mesh(dnaCoreGeometry, coreMaterial);

  const orbiterMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe6f5,
    emissive: color,
    emissiveIntensity: 1.4,
    roughness: 0.15,
  });
  const orbiters = [];
  for (let i = 0; i < orbiterCount; i++) {
    const orbiter = new THREE.Mesh(dnaOrbiterGeometry, orbiterMaterial);
    orbiters.push(orbiter);
  }

  const group = new THREE.Group();
  group.add(core, ...orbiters);
  group.userData.pulseMaterials = [coreMaterial, orbiterMaterial];
  group.userData.dnaOrbiters = orbiters;
  return group;
}

/** Toxic Gland: an elongated glowing sac - reuses the existing spore geometry
 *  (stretched via scale) rather than adding new geometry, keeping it lightweight. */
function makeToxicGland(color) {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.88,
    roughness: 0.25,
  });
  const mesh = new THREE.Mesh(sporeGeometry, material);
  mesh.scale.set(0.85, 1.4, 0.85);

  const group = new THREE.Group();
  group.add(mesh);
  group.userData.pulseMaterials = [material];
  return group;
}

/** Builds a resource's visual (a Group so multi-part models scale/rotate as one unit). */
export function createResourceMesh(type, color) {
  switch (type) {
    case 'spore':
    case 'toxic_spore': // same geometry, distinguished purely by material color/metadata
      return makeSpore(color);
    case 'mushroom':
      return makeMushroom(color);
    case 'stone':
      return makeStone(color);
    case 'iron':
      return makeIron(color);
    case 'rat_dna':
    case 'beetle_dna': // same nucleus+orbiter geometry, distinguished by material color
      return makeDna(color);
    case 'predator_dna':
      return makeDna(color, 3); // one extra orbiter - a slightly busier pulse
    case 'apex_dna':
      return makeDna(color, 4); // the busiest pulse yet - the most significant DNA catch
    case 'rival_dna':
      return makeDna(color, 3);
    case 'toxic_gland':
      return makeToxicGland(color);
    default:
      throw new Error(`Unknown resource type: ${type}`);
  }
}
