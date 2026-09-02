import * as THREE from 'three';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/FBXLoader.js';
import { assetLoadingManager } from './loadingManager.js?v=5.3';

/**
 * Shared loader for the two Meshy AI character exports (Plague Sludge Rat, Jellybean
 * Smile Slime) - both static (unrigged, no animation/skin data - confirmed by scanning
 * the FBX binaries directly) single-mesh models shipped with a separate 4-texture PBR
 * set (base color / normal / roughness / metallic) rather than embedded materials. The
 * FBX's own material block references the artist's local filesystem paths, which never
 * resolve over HTTP, so every mesh gets ONE material built here from the sibling PNGs
 * instead of whatever FBXLoader tried to resolve on its own.
 *
 * Normalizes scale/pivot/facing the same way the project's earlier GLB import did:
 * measure the loaded bounding box, scale so its largest dimension hits `targetRadius`
 * (so nothing that already checks distances against PLAYER_RADIUS-style constants needs
 * retuning), then recenter so the bounding-box center sits at local (0,0,0) - matching
 * how a procedural body centered at its own origin already behaves.
 */

// Shared manager so the loading screen (loadingScreenController.js) sees real
// progress across these fetches too, not just the ground texture.
const fbxLoader = new FBXLoader(assetLoadingManager);
const textureLoader = new THREE.TextureLoader(assetLoadingManager);
const textureCache = new Map();

function loadTexture(url) {
  if (!url) return Promise.resolve(null);
  let cached = textureCache.get(url);
  if (!cached) {
    cached = textureLoader.loadAsync(url);
    textureCache.set(url, cached);
  }
  return cached;
}

/**
 * @param {string} fbxUrl
 * @param {string} [baseColorUrl] @param {string} [normalUrl]
 * @param {string} [roughnessUrl] @param {string} [metalnessUrl]
 * @param {number} targetRadius - half the desired largest bounding-box dimension
 * @param {number} [facingRotationY] - fixed correction so the model's own front lines
 *   up with this project's forward convention (Model faces -Z at rotation.y = 0),
 *   since an imported asset's authored front rarely matches it by default
 * @param {object} [materialOptions] - extra MeshStandardMaterial fields (opacity,
 *   transparent, emissive, etc.) merged in after the texture maps
 * @returns {Promise<{ group: THREE.Group, material: THREE.MeshStandardMaterial }>}
 */
export async function loadFbxCharacter({
  fbxUrl,
  baseColorUrl,
  normalUrl,
  roughnessUrl,
  metalnessUrl,
  targetRadius,
  facingRotationY = 0,
  materialOptions = {},
}) {
  const [fbx, map, normalMap, roughnessMap, metalnessMap] = await Promise.all([
    fbxLoader.loadAsync(fbxUrl),
    loadTexture(baseColorUrl),
    loadTexture(normalUrl),
    loadTexture(roughnessUrl),
    loadTexture(metalnessUrl),
  ]);

  if (map) map.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    metalnessMap,
    // Meshy's separate grayscale maps are read via the green (roughness) / blue
    // (metalness) channels per three's convention - safe even without a map since
    // these just become flat scalar fallbacks then.
    roughness: roughnessMap ? 1 : 0.6,
    metalness: metalnessMap ? 1 : 0,
    ...materialOptions,
  });

  fbx.traverse((child) => {
    if (!child.isMesh) return;
    child.material = material;
    child.castShadow = false;
    child.receiveShadow = false;
  });

  const box = new THREE.Box3().setFromObject(fbx);
  const size = box.getSize(new THREE.Vector3());
  const nativeRadius = Math.max(size.x, size.y, size.z) / 2;
  const scale = nativeRadius > 1e-6 ? targetRadius / nativeRadius : 1;
  fbx.scale.setScalar(scale);
  fbx.rotation.y = facingRotationY;

  // Recentered AFTER scale/rotation so the measured box already reflects both.
  const settledBox = new THREE.Box3().setFromObject(fbx);
  const center = settledBox.getCenter(new THREE.Vector3());
  fbx.position.sub(center);

  const group = new THREE.Group();
  group.add(fbx);

  return { group, material };
}
