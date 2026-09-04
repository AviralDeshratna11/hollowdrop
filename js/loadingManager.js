import * as THREE from 'three';

/**
 * Single shared LoadingManager for every network-fetched game asset: the ground
 * texture (main.js) and the player/rat GLB character models (gltfCharacterLoader.js -
 * one item each now that every character is a single GLB with its textures embedded,
 * where the old FBX bundles were five). loadingScreenController.js is
 * the only thing that reads its onProgress/onLoad/onError - this module just owns the
 * instance so every Loader in the codebase can share it.
 *
 * A dedicated module rather than constructing this in main.js and passing it down,
 * because gltfCharacterLoader.js's own GLTFLoader is a module-level
 * singletons built at IMPORT time - which, for an ES module, runs before any of
 * main.js's own top-level code does. Importing this shared instance sidesteps that
 * ordering entirely: whichever module runs first still gets the same manager.
 */
export const assetLoadingManager = new THREE.LoadingManager();
