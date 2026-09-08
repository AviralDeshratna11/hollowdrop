import * as THREE from 'three';
import { loadGltfCharacter } from './gltfCharacterLoader.js?v=5.3';
import { createEntityHealthBar } from './entityHealthBar.js?v=5.3';
import { attachOcclusionOutline } from './occlusionOutline.js?v=5.3';

const AMBER_LIZARD_GLB_URL = 'models/AmberLizard.glb';
const WALK_CLIP = 'Walk.001';
const TARGET_RADIUS = 0.75;
const FACING_ROTATION_Y = Math.PI;

/**
 * Creates the Rival's Fire Lizard visual. The placeholder keeps the Rival's
 * synchronous construction contract intact while the rigged Amber Lizard GLB
 * loads. The imported model owns its skeleton and Walk.001 animation; the
 * RivalController continues to own movement, combat, and state transitions.
 */
export function createFireLizardMesh() {
  const group = new THREE.Group();

  const placeholderMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c0e0a,
    roughness: 0.55,
    metalness: 0.1,
    emissive: 0xb2340f,
    emissiveIntensity: 0.45,
  });
  const placeholder = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 12),
    placeholderMaterial,
  );
  placeholder.scale.set(1, 0.82, 1.55);
  placeholder.position.y = 0.36;
  group.add(placeholder);

  let placeholderOutline = attachOcclusionOutline(group, {
    color: 0xff5511,
    rimColor: 0xffaa44,
    opacity: 0.92,
    emissiveIntensity: 2.8,
    rimStrength: 3.4,
    rimPower: 1.8,
    innerAlpha: 0.22,
  });

  const healthBar = createEntityHealthBar({
    width: 0.55,
    fillWidth: 0.5,
    yOffset: 0.95,
    fillColor: 0xff6a3d,
  });
  group.add(healthBar);

  group.userData.body = placeholder;
  group.userData.bodyMaterial = placeholderMaterial;
  group.userData.glandMaterial = placeholderMaterial;
  group.userData.healthBar = healthBar;
  group.userData.legs = [];
  group.userData.tailPivot = new THREE.Group();
  group.userData.mixer = null;
  group.userData.action = null;

  loadGltfCharacter({
    url: AMBER_LIZARD_GLB_URL,
    targetRadius: TARGET_RADIUS,
    facingRotationY: FACING_ROTATION_Y,
    clipName: WALK_CLIP,
    materialOptions: {
      color: 0xffffff,
      emissive: 0xb2340f,
      emissiveIntensity: 0.45,
      roughness: 0.62,
      metalness: 0.05,
    },
  }).then(({ group: modelGroup, material, mixer, action }) => {
    if (placeholderOutline) {
      placeholderOutline.dispose();
      placeholderOutline = null;
    }

    group.remove(placeholder);
    placeholder.geometry.dispose();
    placeholderMaterial.dispose();
    group.add(modelGroup);
    attachOcclusionOutline(modelGroup, {
      color: 0xff5511,
      rimColor: 0xffaa44,
      opacity: 0.92,
      emissiveIntensity: 2.8,
      rimStrength: 3.4,
      rimPower: 1.8,
      innerAlpha: 0.22,
    });

    group.userData.body = modelGroup;
    group.userData.bodyMaterial = material;
    group.userData.glandMaterial = material;
    group.userData.mixer = mixer;
    group.userData.action = action;
    action?.setEffectiveWeight(0);
  }).catch((error) => {
    console.error('Failed to load the Amber Lizard model - keeping the placeholder.', error);
  });

  return group;
}
