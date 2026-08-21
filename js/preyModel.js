import * as THREE from 'three';
import { createEntityHealthBar } from './entityHealthBar.js';

// Shared across every beetle instance (geometry is cheap to share). Materials are
// created per-instance in createGlowBeetleMesh() since each beetle's hit-flash needs
// to animate independently of every other beetle's.
const bodyGeometry = new THREE.SphereGeometry(0.22, 14, 10);
const headGeometry = new THREE.SphereGeometry(0.1, 10, 8);
const abdomenGeometry = new THREE.SphereGeometry(0.09, 10, 8);
const eyeGeometry = new THREE.SphereGeometry(0.025, 6, 6);
const legGeometry = new THREE.CylinderGeometry(0.015, 0.02, 0.16, 5);

/**
 * Glow Beetle: small, non-hostile prey. Dark shell, glowing cyan abdomen and eyes.
 * Built to face -Z by default (matches the world's forward convention, same as
 * ratModel.js/predatorModel.js), so PreyManager can drive it purely via mesh.rotation.y.
 */
export function createGlowBeetleMesh() {
  const group = new THREE.Group();

  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x18241c,
    roughness: 0.5,
    metalness: 0.2,
    emissive: 0x0a1a12,
    emissiveIntensity: 0.2,
  });
  const body = new THREE.Mesh(bodyGeometry, shellMaterial);
  body.scale.set(1, 0.62, 1.3);
  body.position.y = 0.18;
  group.add(body);

  const head = new THREE.Mesh(headGeometry, shellMaterial);
  head.position.set(0, 0.2, -0.24);
  group.add(head);

  const abdomenMaterial = new THREE.MeshStandardMaterial({
    color: 0x5dffd6,
    emissive: 0x5dffd6,
    emissiveIntensity: 1.2,
    roughness: 0.25,
  });
  const abdomen = new THREE.Mesh(abdomenGeometry, abdomenMaterial);
  abdomen.position.set(0, 0.16, 0.22);
  abdomen.scale.set(1, 0.8, 1);
  group.add(abdomen);

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0x5dffd6,
    emissive: 0x5dffd6,
    emissiveIntensity: 1.0,
    roughness: 0.2,
  });
  const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeLeft.position.set(-0.045, 0.22, -0.3);
  const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeRight.position.set(0.045, 0.22, -0.3);
  group.add(eyeLeft, eyeRight);

  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x101810, roughness: 0.9 });
  const legOffsets = [
    [-0.16, 0.08],
    [0.16, 0.08],
    [-0.17, -0.02],
    [0.17, -0.02],
    [-0.14, -0.14],
    [0.14, -0.14],
  ];
  const legs = legOffsets.map(([x, z]) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(x, 0.1, z);
    leg.rotation.z = x > 0 ? -0.5 : 0.5;
    leg.rotation.x = 0.1;
    group.add(leg);
    return leg;
  });

  const healthBar = createEntityHealthBar();
  group.add(healthBar);

  group.userData.body = body;
  group.userData.head = head;
  group.userData.abdomen = abdomen;
  group.userData.shellMaterial = shellMaterial;
  group.userData.abdomenMaterial = abdomenMaterial;
  group.userData.legs = legs;
  group.userData.healthBar = healthBar;

  return group;
}
