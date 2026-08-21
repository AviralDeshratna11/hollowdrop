import * as THREE from 'three';

// A crystal core (not a blob/sphere like every creature-DNA pickup) with two small
// orbiting helix rings - deliberately reads as "not ordinary loot" against every
// other resource's silhouette in this game.
const coreGeometry = new THREE.OctahedronGeometry(0.16, 0);
const strandGeometry = new THREE.TorusGeometry(0.13, 0.018, 6, 16);

/** Human Genome Fragment: warm white/gold crystal core, slow-orbiting cyan-white
 *  helix strands. Built to face -Z like everything else, though it never rotates
 *  under player control - GenomeFragmentController just spins it slowly in place. */
export function createGenomeFragmentMesh() {
  const group = new THREE.Group();

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff3d6,
    emissive: 0xffcf6b,
    emissiveIntensity: 1.6,
    roughness: 0.15,
    metalness: 0.1,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  group.add(core);

  const strandMaterial = new THREE.MeshStandardMaterial({
    color: 0xdff6ff,
    emissive: 0x8fe0ff,
    emissiveIntensity: 1.3,
    roughness: 0.2,
  });
  const strandA = new THREE.Mesh(strandGeometry, strandMaterial);
  strandA.rotation.x = Math.PI / 2.3;
  const strandB = new THREE.Mesh(strandGeometry, strandMaterial);
  strandB.rotation.x = Math.PI / 2.3;
  strandB.rotation.z = Math.PI / 2;
  group.add(strandA, strandB);

  // Small orbiting particles (distinct from DNA's orbiters - larger, slower, warmer).
  const particleGeometry = new THREE.SphereGeometry(0.03, 8, 6);
  const particleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe9b8,
    emissive: 0xffd27a,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  const orbiters = [];
  for (let i = 0; i < 3; i++) {
    const orbiter = new THREE.Mesh(particleGeometry, particleMaterial);
    group.add(orbiter);
    orbiters.push(orbiter);
  }

  group.userData.core = core;
  group.userData.coreMaterial = coreMaterial;
  group.userData.strandMaterial = strandMaterial;
  group.userData.orbiters = orbiters;
  group.userData.particleMaterial = particleMaterial;

  return group;
}
