import * as THREE from 'three';
import { createEntityHealthBar } from './entityHealthBar.js?v=5.3';
import { attachOcclusionOutline } from './occlusionOutline.js?v=5.3';

// Sized between the Venom Rat and the Apex (spec: Hollowdrop < Venom Rat ~ Fire
// Lizard < Apex) - a real reptilian predator silhouette, not just a recolor.
const bodyGeometry = new THREE.SphereGeometry(0.4, 16, 12);
const headGeometry = new THREE.SphereGeometry(0.24, 14, 10);
const jawGeometry = new THREE.ConeGeometry(0.09, 0.24, 8);
const legGeometry = new THREE.CylinderGeometry(0.045, 0.06, 0.4, 6);
const tailSegmentGeometry = new THREE.CylinderGeometry(0.05, 0.08, 0.3, 6);
const spikeGeometry = new THREE.ConeGeometry(0.05, 0.16, 6);
const glandGeometry = new THREE.SphereGeometry(0.06, 8, 6);
const eyeGeometry = new THREE.SphereGeometry(0.04, 8, 6);

/**
 * Fire Lizard: the Rival's mutated form. Dark-red/charcoal body with glowing cracks,
 * fire glands at the throat/cheeks (these are what RivalController brightens for the
 * Fire Breath telegraph), hot orange eyes. Built to face -Z at rotation.y = 0, same
 * convention as every other creature in this project.
 */
export function createFireLizardMesh() {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    flatShading: true,
    color: 0x1c0e0a,
    roughness: 0.55,
    metalness: 0.1,
    emissive: 0xb2340f,
    emissiveIntensity: 0.45,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.scale.set(1, 0.82, 1.55);
  body.position.y = 0.36;
  group.add(body);

  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.set(0, 0.4, -0.5);
  group.add(head);

  const jaw = new THREE.Mesh(jawGeometry, bodyMaterial);
  jaw.position.set(0, 0.32, -0.68);
  jaw.rotation.x = Math.PI / 2;
  group.add(jaw);

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xffb347,
    emissiveIntensity: 1.1,
    roughness: 0.25,
  });
  const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeLeft.position.set(-0.11, 0.46, -0.58);
  const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeRight.position.set(0.11, 0.46, -0.58);
  group.add(eyeLeft, eyeRight);

  // Fire glands - throat + cheeks. Shared material so RivalController can brighten
  // all of them at once for the Fire Breath telegraph ("mouth glow increases").
  const glandMaterial = new THREE.MeshStandardMaterial({
    color: 0xff8a2d,
    emissive: 0xff8a2d,
    emissiveIntensity: 0.9,
    roughness: 0.25,
  });
  const throatGland = new THREE.Mesh(glandGeometry, glandMaterial);
  throatGland.position.set(0, 0.26, -0.62);
  const cheekLeft = new THREE.Mesh(glandGeometry, glandMaterial);
  cheekLeft.position.set(-0.16, 0.38, -0.48);
  cheekLeft.scale.setScalar(0.7);
  const cheekRight = new THREE.Mesh(glandGeometry, glandMaterial);
  cheekRight.position.set(0.16, 0.38, -0.48);
  cheekRight.scale.setScalar(0.7);
  group.add(throatGland, cheekLeft, cheekRight);

  const legMaterial = new THREE.MeshStandardMaterial({ flatShading: true, color: 0x140a08, roughness: 0.85 });
  const legOffsets = [
    [-0.26, 0.22],
    [0.26, 0.22],
    [-0.24, -0.28],
    [0.24, -0.28],
  ];
  const legs = legOffsets.map(([x, z]) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(x, 0.18, z);
    leg.rotation.z = x > 0 ? -0.25 : 0.25;
    leg.rotation.x = 0.1;
    group.add(leg);
    return leg;
  });

  const spikeMaterial = new THREE.MeshStandardMaterial({
    flatShading: true,
    color: 0x1c0e0a,
    roughness: 0.6,
    emissive: 0xb2340f,
    emissiveIntensity: 0.3,
  });
  const spikeCount = 4;
  const spikes = [];
  for (let i = 0; i < spikeCount; i++) {
    const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
    const zPos = 0.42 - (i / (spikeCount - 1)) * 0.9;
    spike.position.set(0, 0.62, zPos);
    spike.rotation.x = -0.2;
    group.add(spike);
    spikes.push(spike);
  }

  const tailMaterial = new THREE.MeshStandardMaterial({ flatShading: true, color: 0x1c0e0a, roughness: 0.6, emissive: 0x8a2a0f, emissiveIntensity: 0.3 });
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.3, 0.55);
  group.add(tailPivot);

  const tailSegments = [];
  let previousParent = tailPivot;
  for (let i = 0; i < 4; i++) {
    const segment = new THREE.Mesh(tailSegmentGeometry, tailMaterial);
    segment.position.z = i === 0 ? 0.13 : 0.27;
    segment.scale.setScalar(1 - i * 0.12);
    segment.rotation.x = Math.PI / 2;
    previousParent.add(segment);
    tailSegments.push(segment);
    previousParent = segment;
  }

  const healthBar = createEntityHealthBar({ width: 0.55, fillWidth: 0.5, yOffset: 0.95, fillColor: 0xff6a3d });
  group.add(healthBar);

  attachOcclusionOutline(group, {
    color: 0xff5511,
    rimColor: 0xffaa44,
    opacity: 0.92,
    emissiveIntensity: 2.8,
    rimStrength: 3.4,
    rimPower: 1.8,
    innerAlpha: 0.22,
  });

  group.userData.body = body;
  group.userData.head = head;
  group.userData.bodyMaterial = bodyMaterial;
  group.userData.eyeMaterial = eyeMaterial;
  group.userData.glandMaterial = glandMaterial;
  group.userData.legs = legs;
  group.userData.spikes = spikes;
  group.userData.tailPivot = tailPivot;
  group.userData.tailSegments = tailSegments;
  group.userData.healthBar = healthBar;

  return group;
}
