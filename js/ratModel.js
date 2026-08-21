import * as THREE from 'three';

// Built assuming its parent (the player root) sits at PLAYER_RADIUS (0.6) above ground,
// same convention the slime sphere already uses - so local (0,0,0) here is roughly
// "body center height" and legs extend down toward local y ~ -0.55 to reach the ground.
const bodyGeometry = new THREE.SphereGeometry(0.28, 14, 10);
const headGeometry = new THREE.SphereGeometry(0.17, 14, 10);
const snoutGeometry = new THREE.ConeGeometry(0.075, 0.2, 8);
const earGeometry = new THREE.SphereGeometry(0.09, 10, 8);
const eyeGeometry = new THREE.SphereGeometry(0.035, 8, 6);
const legGeometry = new THREE.CylinderGeometry(0.045, 0.055, 0.34, 6);
const tailSegmentGeometry = new THREE.CylinderGeometry(0.03, 0.045, 0.24, 6);
const spikeGeometry = new THREE.ConeGeometry(0.04, 0.14, 6);

/**
 * Venom Rat: the first mutation form. Built once and reused across every mutate/revert
 * cycle (toggled via .visible, never recreated) - see PlayerFormController.
 */
export function createRatMesh() {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x241a1e,
    roughness: 0.65,
    metalness: 0.1,
    emissive: 0x3a0a2e,
    emissiveIntensity: 0.5,
  });

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.scale.set(1, 0.78, 1.6);
  body.position.set(0, -0.05, 0.05);
  group.add(body);

  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.set(0, 0.05, -0.45);
  group.add(head);

  const snout = new THREE.Mesh(snoutGeometry, bodyMaterial);
  snout.position.set(0, 0.0, -0.62);
  snout.rotation.x = -Math.PI / 2;
  group.add(snout);

  const earMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1216, roughness: 0.8 });
  const earLeft = new THREE.Mesh(earGeometry, earMaterial);
  earLeft.position.set(-0.1, 0.19, -0.36);
  earLeft.scale.set(1, 1, 0.4);
  const earRight = new THREE.Mesh(earGeometry, earMaterial);
  earRight.position.set(0.1, 0.19, -0.36);
  earRight.scale.set(1, 1, 0.4);
  group.add(earLeft, earRight);

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xff2d9e,
    emissive: 0xff2d9e,
    emissiveIntensity: 1.2,
    roughness: 0.3,
  });
  const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeLeft.position.set(-0.08, 0.08, -0.58);
  const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeRight.position.set(0.08, 0.08, -0.58);
  group.add(eyeLeft, eyeRight);

  const venomMaterial = new THREE.MeshStandardMaterial({
    color: 0x8cff5c,
    emissive: 0x6be03a,
    emissiveIntensity: 1.0,
    roughness: 0.25,
  });
  const spikePositions = [
    [0, 0.24, 0.35],
    [0, 0.26, 0.1],
    [0, 0.24, -0.15],
  ];
  const spikes = spikePositions.map(([x, y, z]) => {
    const spike = new THREE.Mesh(spikeGeometry, venomMaterial);
    spike.position.set(x, y, z);
    group.add(spike);
    return spike;
  });

  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1216, roughness: 0.85 });
  const legOffsets = [
    [-0.18, 0.28],
    [0.18, 0.28],
    [-0.16, -0.22],
    [0.16, -0.22],
  ];
  const legs = legOffsets.map(([x, z]) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(x, -0.36, z);
    leg.rotation.x = 0.1;
    group.add(leg);
    return leg;
  });

  const tailMaterial = new THREE.MeshStandardMaterial({ color: 0x2a1c22, roughness: 0.7 });
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, -0.02, 0.55);
  group.add(tailPivot);

  const tailSegments = [];
  let previousParent = tailPivot;
  for (let i = 0; i < 3; i++) {
    const segment = new THREE.Mesh(tailSegmentGeometry, tailMaterial);
    segment.position.z = i === 0 ? 0.1 : 0.22;
    segment.rotation.x = Math.PI / 2;
    previousParent.add(segment);
    tailSegments.push(segment);
    previousParent = segment;
  }

  group.userData.body = body;
  group.userData.head = head;
  group.userData.legs = legs;
  group.userData.earLeft = earLeft;
  group.userData.earRight = earRight;
  group.userData.tailPivot = tailPivot;
  group.userData.tailSegments = tailSegments;
  group.userData.venomMaterial = venomMaterial;
  group.userData.bodyMaterial = bodyMaterial; // PlayerController targets this for hit-flash/health/opacity
  group.userData.spikes = spikes;

  return group;
}
