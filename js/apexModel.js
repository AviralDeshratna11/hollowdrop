import * as THREE from 'three';

// Shared across the one Apex instance that will ever exist, but kept as module-level
// geometry anyway for consistency with every other model file in this project.
const bodyGeometry = new THREE.SphereGeometry(0.65, 18, 14);
const headGeometry = new THREE.SphereGeometry(0.38, 16, 12);
const jawGeometry = new THREE.BoxGeometry(0.3, 0.12, 0.34);
const legGeometry = new THREE.CylinderGeometry(0.07, 0.1, 0.62, 7);
const spikeGeometry = new THREE.ConeGeometry(0.09, 0.3, 6);
const glandGeometry = new THREE.SphereGeometry(0.13, 10, 8);
const coreGlandGeometry = new THREE.SphereGeometry(0.16, 12, 9);
const eyeGeometry = new THREE.SphereGeometry(0.075, 8, 6);

/**
 * Murkmaw: a large amphibious apex predator - roughly 2x the Cave Stalker's scale.
 * Dark armored body, toxic bioluminescent glands (a bigger "core" gland on the chest
 * flares brighter in Phase 2 - see ApexController), spines along the back, heavy
 * forelimbs, glowing eyes. Built to face -Z by default (matches the world's forward
 * convention), so ApexController can drive it purely via mesh.rotation.y.
 */
export function createApexMesh() {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x140a1e,
    roughness: 0.6,
    metalness: 0.15,
    emissive: 0x2a0f38,
    emissiveIntensity: 0.3,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.scale.set(1.15, 0.9, 1.7);
  body.position.y = 0.62;
  group.add(body);

  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.set(0, 0.68, -0.85);
  group.add(head);

  const jawMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c0e28,
    roughness: 0.5,
    emissive: 0x4a1030,
    emissiveIntensity: 0.4,
  });
  const jaw = new THREE.Mesh(jawGeometry, jawMaterial);
  jaw.position.set(0, 0.5, -1.08);
  group.add(jaw);

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xff8a2d,
    emissive: 0xff8a2d,
    emissiveIntensity: 0.8,
    roughness: 0.25,
  });
  const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeLeft.position.set(-0.16, 0.76, -1.02);
  const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeRight.position.set(0.16, 0.76, -1.02);
  group.add(eyeLeft, eyeRight);

  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x0f0816, roughness: 0.85 });
  const legOffsets = [
    [-0.42, 0.35],
    [0.42, 0.35],
    [-0.4, -0.4],
    [0.4, -0.4],
  ];
  const legs = legOffsets.map(([x, z]) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(x, 0.3, z);
    leg.rotation.z = x > 0 ? -0.3 : 0.3;
    leg.rotation.x = 0.1;
    group.add(leg);
    return leg;
  });

  const glandMaterial = new THREE.MeshStandardMaterial({
    color: 0x4dffb2,
    emissive: 0x4dffb2,
    emissiveIntensity: 1.0,
    roughness: 0.25,
  });
  const glandOffsets = [
    [-0.55, 0.7, 0.1],
    [0.55, 0.7, 0.1],
    [-0.45, 0.55, 0.7],
    [0.45, 0.55, 0.7],
  ];
  const glands = glandOffsets.map(([x, y, z]) => {
    const gland = new THREE.Mesh(glandGeometry, glandMaterial);
    gland.position.set(x, y, z);
    group.add(gland);
    return gland;
  });

  // The "core" gland - the one that flares dramatically brighter/larger in Phase 2
  // (spec: "larger glowing core during Phase 2"), rather than adding new geometry.
  const coreGlandMaterial = new THREE.MeshStandardMaterial({
    color: 0x4dffb2,
    emissive: 0x4dffb2,
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });
  const coreGland = new THREE.Mesh(coreGlandGeometry, coreGlandMaterial);
  coreGland.position.set(0, 0.68, 0.45);
  group.add(coreGland);

  const spikeMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c0e28,
    roughness: 0.6,
    emissive: 0x3a0f38,
    emissiveIntensity: 0.2,
  });
  const spikeCount = 5;
  const spikes = [];
  for (let i = 0; i < spikeCount; i++) {
    const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
    const zPos = 0.6 - (i / (spikeCount - 1)) * 1.3;
    spike.position.set(0, 0.95 - Math.abs(zPos) * 0.08, zPos);
    spike.rotation.x = -0.25;
    group.add(spike);
    spikes.push(spike);
  }

  group.userData.body = body;
  group.userData.head = head;
  group.userData.jaw = jaw;
  group.userData.bodyMaterial = bodyMaterial;
  group.userData.eyeMaterial = eyeMaterial;
  group.userData.glandMaterial = glandMaterial;
  group.userData.coreGland = coreGland;
  group.userData.coreGlandMaterial = coreGlandMaterial;
  group.userData.legs = legs;
  group.userData.glands = glands;
  group.userData.spikes = spikes;

  return group;
}
