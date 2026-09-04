import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { assetLoadingManager } from './loadingManager.js?v=5.3';

/**
 * The loader for EVERY character in the game: the player's slime
 * (models/jellybean_slime/slime.glb, static), the player's Venom Rat
 * (models/rat_walk.glb) and the boss (models/plague_sludge_rat/rat_walk.glb), both
 * rigged with a 181-deform-bone armature and a baked "Walk" clip.
 *
 * It began as a second loader alongside an FBX one, because the two normalizations are
 * incompatible: that loader recentred by writing `.position` on the loaded root, and on
 * a rigged model that root IS the armature every animation channel is authored relative
 * to, so the clip and the normalization fought over the same three properties. Here
 * gltf.scene is never touched: scale / facing / centering all go on a wrapper Group
 * above it, leaving the armature's own transform entirely to the AnimationMixer. That
 * turned out to be the better shape for the static models too, and the FBX path is now
 * gone entirely - along with the FBXLoader/fflate/NURBS import chain it dragged in.
 *
 * Sizing is measured ONCE, at load, from the bind-pose bounding box. Box3.setFromObject
 * uses each geometry's own boundingBox (it does not evaluate skinning), so the measure
 * is pose-independent by construction - but it is still taken before the mixer's first
 * update, so there is no frame where a half-applied pose could influence the scale.
 *
 * Materials: the game needs ONE MeshStandardMaterial per character with a writable
 * .emissive/.emissiveIntensity (PlayerFormController drives the mutation-countdown glow
 * through it every frame, and playerSlimeModel patches the jelly rim/displacement into
 * it), so the glTF's own material is unpacked for its texture maps and then discarded.
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
    // A packed map is read through its own channel, so the scalar becomes a
    // full-strength multiplier rather than a value.
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

  // Recentred AFTER scale so the measured box already reflects it - every character
  // lands with its bounding-box centre at the local origin, so nothing downstream has
  // to special-case one model's height against another's.
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
