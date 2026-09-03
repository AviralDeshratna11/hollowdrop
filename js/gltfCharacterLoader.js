import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { assetLoadingManager } from './loadingManager.js?v=5.3';

/**
 * Loader for RIGGED .glb characters - currently only the player's Venom Rat
 * (models/rat_walk.glb: one skinned mesh, a 181-deform-bone armature and a single
 * baked "Walk" clip). Deliberately a separate file from fbxCharacterLoader.js rather
 * than another branch inside it, because the two normalizations are incompatible:
 *
 *   fbxCharacterLoader does `fbx.position.sub(center)` on the loaded root to recentre
 *   it. That root IS the armature on a rigged model, and every animation channel is
 *   authored relative to it, so writing a transform there means the clip and the
 *   normalization fight over the same three properties. Here the gltf.scene is never
 *   touched: scale / facing / centering all go on a wrapper Group above it, leaving
 *   the armature's own transform entirely to the AnimationMixer.
 *
 * Sizing is measured ONCE, at load, from the bind-pose bounding box. Box3.setFromObject
 * uses each geometry's own boundingBox (it does not evaluate skinning), so the measure
 * is pose-independent by construction - but it is still taken before the mixer's first
 * update, so there is no frame where a half-applied pose could influence the scale.
 *
 * Materials: same reasoning as fbxCharacterLoader's header - the game needs ONE
 * MeshStandardMaterial per character with a writable .emissive/.emissiveIntensity
 * (PlayerFormController drives the mutation-countdown glow through it every frame), so
 * the glTF's own material is unpacked for its texture maps and then discarded.
 */

const gltfLoader = new GLTFLoader(assetLoadingManager);

/**
 * @param {string} url - .glb path
 * @param {number} targetRadius - half the desired largest bind-pose bounding-box dimension
 * @param {number} [facingRotationY] - fixed correction so the model's own front lines up
 *   with this project's forward convention (Model faces -Z at rotation.y = 0)
 * @param {string} [clipName] - animation clip to create a paused-at-0, looping action for
 * @param {object} [materialOptions] - extra MeshStandardMaterial fields merged in after the maps
 * @returns {Promise<{ group: THREE.Group, material: THREE.MeshStandardMaterial,
 *   mixer: THREE.AnimationMixer|null, action: THREE.AnimationAction|null,
 *   clipDuration: number, bones: Map<string, THREE.Bone> }>}
 */
export async function loadGltfCharacter({
  url,
  targetRadius,
  facingRotationY = 0,
  clipName,
  materialOptions = {},
}) {
  const gltf = await gltfLoader.loadAsync(url);
  const root = gltf.scene;

  // Take the texture maps off whatever material the glTF shipped, then build the one
  // material the rest of the game will hold a reference to.
  let source = null;
  root.traverse((child) => {
    if (child.isMesh && !source) source = child.material;
  });
  const src = source ?? {};

  const material = new THREE.MeshStandardMaterial({
    map: src.map ?? null,
    normalMap: src.normalMap ?? null,
    roughnessMap: src.roughnessMap ?? null,
    metalnessMap: src.metalnessMap ?? null,
    // Same convention as fbxCharacterLoader: a packed map is read through its own
    // channel, so the scalar becomes a full-strength multiplier rather than a value.
    roughness: src.roughnessMap ? 1 : 0.6,
    metalness: src.metalnessMap ? 1 : 0,
    ...materialOptions,
  });

  const bones = new Map();
  root.traverse((child) => {
    if (child.isBone) bones.set(child.name, child);
    if (!child.isMesh) return;
    if (child.material && child.material !== material) child.material.dispose();
    child.material = material;
    child.castShadow = false;
    child.receiveShadow = false;
    // A skinned mesh's bounding volume is the BIND pose's, so three would cull it the
    // moment an animated limb carried it past that box's edge. Cheap to just not cull:
    // it is one mesh attached to the player, on screen essentially all the time anyway.
    if (child.isSkinnedMesh) child.frustumCulled = false;
  });

  // Wrapper owns scale/facing/centering; gltf.scene owns nothing but the animation.
  const group = new THREE.Group();
  group.add(root);
  group.rotation.y = facingRotationY;
  group.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const nativeRadius = Math.max(size.x, size.y, size.z) / 2;
  const scale = nativeRadius > 1e-6 ? targetRadius / nativeRadius : 1;
  group.scale.setScalar(scale);

  // Recentred AFTER scale so the measured box already reflects it - matching how
  // fbxCharacterLoader leaves its models, so a rigged character drops into the same
  // local origin the static ones already sit at and nothing downstream shifts height.
  group.updateMatrixWorld(true);
  const settled = new THREE.Box3().setFromObject(group);
  group.position.sub(settled.getCenter(new THREE.Vector3()));

  let mixer = null;
  let action = null;
  let clipDuration = 0;
  if (clipName) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
    if (clip) {
      mixer = new THREE.AnimationMixer(root);
      action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      clipDuration = clip.duration;
    } else {
      console.warn(`[gltfCharacterLoader] No clip named "${clipName}" in ${url}. Found:`,
        gltf.animations.map((a) => a.name));
    }
  }

  return { group, material, mixer, action, clipDuration, bones };
}
