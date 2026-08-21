import * as THREE from 'three';

// Deliberately reuses the player Slime's "translucent membrane + sphere" concept
// (same family, so the player instantly reads "another Slime") but in a warm
// crimson/amber palette instead of cool cyan, with a visible internal core and small
// eyes for personality - strong enough contrast to also read "not me" at a glance.
const bodyGeometry = new THREE.SphereGeometry(0.55, 24, 24);
const coreGeometry = new THREE.SphereGeometry(0.28, 14, 10);
const eyeGeometry = new THREE.SphereGeometry(0.05, 8, 6);

/** Rival's base form. No precise directional facing is needed for this form (see
 *  RivalController - lean/squash communicates movement instead), so there's no
 *  forward-convention requirement on this geometry the way every other creature has. */
export function createRivalSlimeMesh() {
  const group = new THREE.Group();

  const membraneMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a2a1a,
    transparent: true,
    opacity: 0.82,
    roughness: 0.25,
    metalness: 0.05,
    emissive: 0x4a1208,
    emissiveIntensity: 0.35,
  });
  const body = new THREE.Mesh(bodyGeometry, membraneMaterial);
  group.add(body);

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xff8a3d,
    emissive: 0xff8a3d,
    emissiveIntensity: 1.1,
    roughness: 0.2,
    transparent: true,
    opacity: 0.9,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  group.add(core);

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe08a,
    emissive: 0xffcf6b,
    emissiveIntensity: 1.3,
    roughness: 0.2,
  });
  const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeLeft.position.set(-0.17, 0.16, -0.42);
  const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeRight.position.set(0.17, 0.16, -0.42);
  group.add(eyeLeft, eyeRight);

  group.userData.body = body;
  group.userData.membraneMaterial = membraneMaterial;
  group.userData.core = core;
  group.userData.coreMaterial = coreMaterial;
  group.userData.eyeMaterial = eyeMaterial;

  return group;
}
