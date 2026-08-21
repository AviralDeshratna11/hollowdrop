import * as THREE from 'three';
import { createEntityHealthBar } from './entityHealthBar.js';

// Shared geometry across every predator instance (only one for now, but cheap either way).
const bodyGeometry = new THREE.SphereGeometry(0.32, 16, 12);
const headGeometry = new THREE.SphereGeometry(0.18, 14, 10);
const eyeGeometry = new THREE.SphereGeometry(0.045, 8, 6);
const legGeometry = new THREE.CylinderGeometry(0.025, 0.04, 0.32, 6);

function createWarningSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 52px sans-serif';
  ctx.fillStyle = '#ff2d55';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 32, 36);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, opacity: 0 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.4, 0.4, 1);
  sprite.position.y = 0.95;
  return sprite;
}

/**
 * Cave Stalker: elongated body, small head, glowing red eyes, four thin legs.
 * Built to face -Z by default (matches the world's "forward" convention), so
 * PredatorController can drive it purely by setting mesh.rotation.y.
 */
export function createPredatorMesh() {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e1626,
    roughness: 0.7,
    metalness: 0.1,
    emissive: 0x3a0f24,
    emissiveIntensity: 0.25,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.scale.set(1, 0.85, 1.5);
  body.position.y = 0.28;
  group.add(body);

  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.set(0, 0.32, -0.42);
  group.add(head);

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xff2d55,
    emissive: 0xff2d55,
    emissiveIntensity: 0.6,
    roughness: 0.3,
  });
  const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeLeft.position.set(-0.08, 0.36, -0.52);
  const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeRight.position.set(0.08, 0.36, -0.52);
  group.add(eyeLeft, eyeRight);

  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x150f1a, roughness: 0.9 });
  const legOffsets = [
    [-0.22, 0.18],
    [0.22, 0.18],
    [-0.2, -0.15],
    [0.2, -0.15],
  ];
  const legs = legOffsets.map(([x, z]) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(x, 0.14, z);
    leg.rotation.z = x > 0 ? -0.35 : 0.35;
    leg.rotation.x = 0.15;
    group.add(leg);
    return leg;
  });

  const warningSprite = createWarningSprite();
  group.add(warningSprite);

  // Bigger/higher than the Glow Beetle's bar (createEntityHealthBar's defaults) -
  // a slightly more "boss-like" read for a creature roughly twice its size.
  const healthBar = createEntityHealthBar({ width: 0.7, fillWidth: 0.64, yOffset: 0.85 });
  group.add(healthBar);

  group.userData.body = body;
  group.userData.head = head;
  group.userData.bodyMaterial = bodyMaterial;
  group.userData.eyeMaterial = eyeMaterial;
  group.userData.legs = legs;
  group.userData.warningSprite = warningSprite;
  group.userData.healthBar = healthBar;

  return group;
}
