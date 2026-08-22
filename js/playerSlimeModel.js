import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

// Source: "Rimuru Slime" by tommdraws (Sketchfab, CC-BY-4.0) - a static (unrigged,
// no animations) 6-mesh/5-material model. See main.js for how it's dropped into the
// existing slimeVisual wrapper without touching movement/combat/mutation code at all.
const MODEL_URL = 'models/rimuru_slime.glb';

const loader = new GLTFLoader();
let cachedLoad = null;

// The source model's body texture and one flat-colored detail material are blue -
// shifted here to this project's established green identity (0x7cffb2, the accent
// color used throughout the HUD/notifications) instead, per request. -55deg lands
// the texture's ~197deg blue at ~142deg, right in that same green family. Pink
// blush/white highlights sit well outside this rotation's target range and are
// left untouched (see hueOf() below), so the "same style, different hue" ask stays
// exactly that - only the blue actually moves.
const BODY_HUE_ROTATION_DEG = -75;
const BLUE_HUE_MIN = 180;
const BLUE_HUE_MAX = 260;

/** The same RGB->hue conversion CSS's hue-rotate() is built on, applied to a single
 *  0-1 RGB triplet - used to decide whether a flat (untextured) material's color
 *  actually falls in the "blue" range worth rotating (magenta blush/white highlights
 *  don't, and are left alone). Returns degrees, or null for a colorless (gray/white/
 *  black) input where hue is meaningless. */
function hueOf(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 1e-4) return null;
  let h;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  return h < 0 ? h + 360 : h;
}

/** The standard hue-rotate() matrix (identical to what CSS/SVG filters use) -
 *  perceptually cleaner than a naive per-pixel HSL round-trip and cheap enough to
 *  run over a whole texture synchronously at load time. */
function hueRotationMatrix(degrees) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
}

function applyMatrix(m, r, g, b) {
  return [
    Math.min(255, Math.max(0, r * m[0] + g * m[1] + b * m[2])),
    Math.min(255, Math.max(0, r * m[3] + g * m[4] + b * m[5])),
    Math.min(255, Math.max(0, r * m[6] + g * m[7] + b * m[8])),
  ];
}

/** Redraws a loaded texture's image with every pixel's hue shifted, onto a fresh
 *  canvas - preserves all of the artist's original shading/gradient/highlight detail
 *  (this is a hue shift, not a flat recolor), just moves it from blue to green. */
function hueRotateTexture(sourceTexture, degrees) {
  const image = sourceTexture.image;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const matrix = hueRotationMatrix(degrees);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = applyMatrix(matrix, data[i], data[i + 1], data[i + 2]);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    // alpha (data[i+3]) untouched - preserves the body's baked translucency exactly.
  }
  ctx.putImageData(imageData, 0, 0);

  const newTexture = new THREE.CanvasTexture(canvas);
  newTexture.flipY = sourceTexture.flipY;
  newTexture.wrapS = sourceTexture.wrapS;
  newTexture.wrapT = sourceTexture.wrapT;
  newTexture.colorSpace = sourceTexture.colorSpace;
  newTexture.needsUpdate = true;
  return newTexture;
}

/**
 * Loads the Rimuru Slime GLB and normalizes it to drop straight into the existing
 * player-form architecture: `mesh` is a Group pre-scaled/recentered so its resting
 * silhouette matches PLAYER_RADIUS and its pivot sits at local (0,0,0) - exactly how
 * the procedural sphere it replaces behaved, so every squash/stretch/lean/yaw effect
 * PlayerController already applies to the player ROOT keeps working unmodified.
 * `bodyMaterial` is the model's one translucent (alphaMode BLEND) material - handed to
 * PlayerController.setActiveMaterial() so hit-flash/health-tint/absorb-pulse continue
 * to work exactly as they did on the sphere. Cached: a second call (there won't be one
 * in this game, but future-safe) reuses the same in-flight/completed load rather than
 * re-fetching and re-parsing the 2.3MB file.
 */
export function loadRimuruSlimeVisual(targetRadius) {
  if (!cachedLoad) {
    cachedLoad = loader.loadAsync(MODEL_URL).then((gltf) => {
      const group = gltf.scene;

      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const nativeRadius = Math.max(size.x, size.y, size.z) / 2;
      const scale = nativeRadius > 1e-6 ? targetRadius / nativeRadius : 1;
      group.scale.setScalar(scale);

      // The source file's face (eyes/blush/highlight) sits on the model's own local
      // -X side, not -Z - a fixed correction so it lines up with this project's
      // forward convention ("Model faces -Z at rotation.y = 0", used by every other
      // model here). Without this the yaw-to-face-travel-direction system already in
      // PlayerController._applyMovementFeel() would still turn the ROOT correctly,
      // but the face itself would point 90 degrees off from the direction of travel.
      group.rotation.y = -Math.PI / 2;

      // Recenter so the model's own bounding-box center sits at local (0,0,0) - the
      // imported model's native pivot rarely matches that, but the sphere it replaces
      // was always centered there, and every effect above pivots around this origin.
      const scaledBox = new THREE.Box3().setFromObject(group);
      const center = scaledBox.getCenter(new THREE.Vector3());
      group.position.sub(center);

      // The source file uses KHR_materials_unlit (every material - confirmed via the
      // glTF JSON), so GLTFLoader hands back plain MeshBasicMaterials with none of
      // PlayerController's required .emissive/.emissiveIntensity. Converted here to
      // MeshStandardMaterial, but NOT simply "make it react to scene lighting" (that
      // was tried first and washed the model's actual sky-blue color out toward this
      // scene's greenish ambient/directional lights). Instead: color killed to black
      // (zero diffuse response to any light) and the source's own baseColorFactor/
      // baseColorTexture pushed through the EMISSIVE channel instead, at full
      // intensity - emissive is self-lit and completely unaffected by scene lighting,
      // so this reproduces the artist's actual unlit colors exactly while still
      // giving hit-flash/health-tint/absorb-pulse a real emissive slot to blend into.
      // `.map` is kept purely for its alpha channel (an emissiveMap's alpha is NOT
      // read for transparency in three.js, only .map's is), so the texture's own
      // baked translucency at the body's edges/highlights still comes through.
      // Shared materials (two of this model's meshes reference the same translucent
      // body material) are converted exactly once via this cache, so both meshes
      // keep pointing at the identical instance afterward - required for the shared
      // body to flash/tint as one piece rather than half of it.
      const converted = new Map();
      let bodyMaterial = null;

      group.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        child.castShadow = false;
        child.receiveShadow = false;

        const old = child.material;
        let next = converted.get(old);
        if (!next) {
          const hasMap = !!old.map;
          // Textured (the body): hue-rotate the actual texture pixels, blue -> green.
          // Flat-colored: only rotate if its own hue genuinely falls in the blue
          // range - leaves the magenta blush and white/gray highlight materials
          // completely untouched.
          let emissiveMap = null;
          let emissiveColor;
          if (hasMap) {
            emissiveMap = hueRotateTexture(old.map, BODY_HUE_ROTATION_DEG);
            emissiveColor = new THREE.Color(0xffffff);
          } else {
            const hue = hueOf(old.color.r, old.color.g, old.color.b);
            emissiveColor = old.color.clone();
            if (hue !== null && hue >= BLUE_HUE_MIN && hue <= BLUE_HUE_MAX) {
              const [r, g, b] = applyMatrix(hueRotationMatrix(BODY_HUE_ROTATION_DEG), old.color.r * 255, old.color.g * 255, old.color.b * 255);
              emissiveColor = new THREE.Color(r / 255, g / 255, b / 255);
            }
          }

          next = new THREE.MeshStandardMaterial({
            color: 0x000000,
            transparent: old.transparent,
            // alphaMode BLEND (-> transparent === true here) marks the slime's main
            // jelly body - forced more visibly glassy (matching the original
            // procedural sphere's 0.78 opacity) rather than trusting whatever the
            // source texture's own baked alpha happens to average out to.
            opacity: old.transparent ? 0.8 : old.opacity,
            side: old.side,
            alphaTest: old.alphaTest,
            roughness: 1,
            metalness: 0,
            emissive: emissiveColor,
            emissiveMap,
            emissiveIntensity: 1,
          });
          if (hasMap) {
            // .map is kept purely for its alpha channel (an emissiveMap's alpha is
            // NOT read for transparency in three.js, only .map's is) - the ORIGINAL
            // (still-blue) texture is fine here since only its alpha matters now.
            next.map = old.map;
          }
          converted.set(old, next);
        }
        child.material = next;
        if (!bodyMaterial && old.transparent) bodyMaterial = next;
      });

      for (const old of converted.keys()) old.dispose();

      // Fallback so setActiveMaterial() always gets something valid even if the
      // source file's material setup ever changes and nothing comes back transparent.
      if (!bodyMaterial) bodyMaterial = converted.values().next().value ?? null;

      return { group, bodyMaterial };
    });
  }
  return cachedLoad;
}
