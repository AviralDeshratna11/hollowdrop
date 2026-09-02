import * as THREE from 'three';

/**
 * Single shared LoadingManager for every network-fetched game asset: the ground
 * texture (main.js) and the player/rat FBX character bundles (fbxCharacterLoader.js -
 * five items each, the FBX plus its four PBR textures). loadingScreenController.js is
 * the only thing that reads its onProgress/onLoad/onError - this module just owns the
 * instance so every Loader in the codebase can share it.
 *
 * A dedicated module rather than constructing this in main.js and passing it down,
 * because fbxCharacterLoader.js's own FBXLoader/TextureLoader are module-level
 * singletons built at IMPORT time - which, for an ES module, runs before any of
 * main.js's own top-level code does. Importing this shared instance sidesteps that
 * ordering entirely: whichever module runs first still gets the same manager.
 */
export const assetLoadingManager = new THREE.LoadingManager();
