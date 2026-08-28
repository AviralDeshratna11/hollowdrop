import * as THREE from 'three';
import { loadFbxCharacter } from './fbxCharacterLoader.js';
import { applyJellyRimTreatment, applyJellyDisplacement } from './slimeCreature.js';

// Meshy AI "Jellybean Smile" - a static (unrigged, no animation) single mesh with its
// own 4-texture PBR set. Loaded async (see loadFbxCharacter), so this module hands back
// a Group immediately with a small placeholder sphere inside it, then swaps the real
// model in once it arrives - the same "placeholder now, hot-swap later" shape the
// project's very first imported-model attempt (rimuru_slime.glb, see git history) used,
// since main.js needs a synchronous `group`/`bodyMaterial` to build PlayerController and
// PlayerFormController before any network fetch could possibly finish.
//
// The fetch itself is the actual bottleneck (the FBX + its 2048px texture set run to
// ~20MB combined - see the project's own notes on this), so the swap still won't be
// instant on a phone's WiFi. What CROSSFADE_DURATION buys is not a faster load, just a
// less jarring one: the placeholder eases out as the real model eases in, rather than
// popping between them the instant the fetch resolves.
const MODEL_URLS = {
  fbxUrl: 'models/jellybean_slime/slime.fbx',
  baseColorUrl: 'models/jellybean_slime/slime_basecolor.png',
  normalUrl: 'models/jellybean_slime/slime_normal.png',
  roughnessUrl: 'models/jellybean_slime/slime_roughness.png',
  metalnessUrl: 'models/jellybean_slime/slime_metallic.png',
};

// Fixed correction so the model's own front lines up with this project's forward
// convention (Model faces -Z at rotation.y = 0) - verified with an isolated probe
// render: at rotation.y = 0 the face (eyes/smile, on the model's upper +Z side) points
// backward, so a half-turn brings it to face -Z as required.
const FACING_ROTATION_Y = Math.PI;

const CROSSFADE_DURATION = 0.4;
const TARGET_OPACITY = 0.78; // matches the translucent-jelly look every other creature in this game has
const PLACEHOLDER_OPACITY = 0.62; // must match the placeholder material's own resting opacity below

const REACTION_CONFIG = {
  breatheSpeed: 2.2,
  breatheAmount: 0.02,
  loadSwell: 0.12,
  widenDuration: 0.35,
  widenAmount: 0.14, // brief grow on absorb (mirrors the amoeba's own eye-widen "joy" beat)
  squintDuration: 0.45,
  squintAmount: 0.08, // brief shrink/flinch on damage
};

// Pushed well past SLIME_DEFAULTS on purpose - a first pass here matched the amoeba's
// own gentle amplitude, but on this mesh's fixed, geometric "jellybean" silhouette that
// read as a rigid shape merely jiggling rather than something liquid. The brief was
// explicitly a Venom-symbiote feel: no settled silhouette, tendrils separating from the
// mass and retracting, a constant restless flow rather than an occasional breathing
// pulse. Sharper/higher-gain lobes read as pulled-out tendrils rather than the amoeba's
// own blunt pseudopods; a much longer speed-driven tail lets it visibly stream/trail
// while moving instead of just leaning.
//
// The per-frame GPU cost here is dominated by the fixed number of simplex evaluations
// per vertex (three, for the position plus the finite-difference normal) - that runs
// every frame regardless of these amplitude/speed values, so cranking them up costs
// nothing extra beyond what the gentler pass was already paying on this ~320k-triangle
// mesh. The real risk at this amplitude is visual, not performance: large enough
// displacement on a fixed, unevenly-shaped import can pull the surface enough to
// self-intersect at concave areas (under the chin/between the bumps) - if that shows up
// as visible clipping, dial lobeAmplitude back before touching anything else.
// Dialed back twice now from the first "Venom" pass, each time keeping the same
// character (constant idle morph, separating lobes, a real trailing tail) and only
// turning down how FAR it pushes. This pass also softens lobeSharpness/lobeGain a
// notch - the ask shifted from "spiky tendrils" toward "just fluid", and those two
// specifically control how pointed vs. rounded the lobes read, independent of how far
// they push out. Keep lobeSpeed/lobeFrequency/streamlining as they are if tuning
// further - those set the CHARACTER of the motion, not its intensity;
// lobeAmplitude/inwardFactor/tailLength are the ones that actually scale it.
const DISPLACEMENT_CONFIG = {
  lobeAmplitude: 0.12,
  lobeFrequency: 1.7,
  lobeSpeed: 0.55, // constant idle morph, not just a static bumpy cast - this IS the "no defined shape" ask
  lobeGain: 1.3,
  lobeSharpness: 1.25,
  inwardFactor: 0.2, // deep valleys between lobes - reads as separating tendrils, not a solid dented blob
  detailAmplitude: 0.008,
  detailFrequency: 3.2,
  detailSpeed: 1.0,
  tailLength: 0.34, // a real streaming/trailing tail while moving, not a lean
  tailPinch: 0.6,
  streamlining: 0.45, // lower than the amoeba's own 0.6 - tendrils should survive at speed, not fully smooth away
  loadSwell: 0.1,
};

/**
 * @param radius - target half-bounding-box size, matches the old amoeba's own radius
 *   (PLAYER_RADIUS) so every existing radius-based gameplay check stays untouched.
 * @returns {{ group, bodyMaterial, update, triggerWiden, triggerSquint, onReady }}
 *   `bodyMaterial` satisfies PlayerController's contract (.emissive/.emissiveIntensity/
 *   .opacity, transparent) from the moment this returns - it just points at the
 *   placeholder until the real model's material replaces it in place. `onReady` is
 *   optional, set post-construction (main.js) to be notified (and re-point
 *   PlayerFormController.slimeMaterial / call PlayerController.setActiveMaterial())
 *   once the swap happens, since anything that already captured the placeholder by
 *   value (main.js's own `const slimeMaterial = amoeba.bodyMaterial`) won't otherwise
 *   see the replacement.
 */
export function createPlayerSlimeVisual(radius = 0.6) {
  const group = new THREE.Group();

  const placeholderMaterial = new THREE.MeshStandardMaterial({
    color: 0x8dffc4,
    emissive: 0x2aa86c,
    emissiveIntensity: 0.5,
    roughness: 0.2,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const placeholderMesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), placeholderMaterial);
  group.add(placeholderMesh);

  const api = {
    group,
    bodyMaterial: placeholderMaterial,
    update,
    triggerWiden,
    triggerSquint,
    // Optional - set post-construction (main.js). Called once, with the real body
    // material, when the FBX finishes loading and replaces the placeholder.
    onReady: null,
    // Set below once the load settles either way - main.js gates leaving the Title
    // screen on this, so the placeholder sphere is never actually seen in gameplay
    // (only, briefly, on the Title screen behind the "TAP TO BEGIN" card). Always
    // resolves, never rejects, even if the load fails - the placeholder is a
    // perfectly playable fallback, and a broken promise here would strand the
    // player on the Title screen forever with no way to start a run.
    ready: null,
  };

  let widenTime = null;
  let squintTime = null;
  let breatheTime = 0;
  let displacement = null; // set once the real model + its shader treatment are ready

  // Crossfade state - null outside the brief window right after the FBX arrives.
  let fadeTimer = null;
  let fbxMaterial = null;

  api.ready = loadFbxCharacter({
    ...MODEL_URLS,
    targetRadius: radius,
    facingRotationY: FACING_ROTATION_Y,
    materialOptions: {
      transparent: true,
      opacity: 0, // faded in over CROSSFADE_DURATION below, not shown at full strength immediately
      depthWrite: false,
      emissive: 0x2aa86c,
      // Lower than the placeholder's 0.5: standard emissive is added UNIFORMLY
      // regardless of what's underneath (unlike the fresnel rim below, which is
      // naturally weighted toward silhouette edges only), so this washes out the
      // model's own dark texture detail - most visibly the eyes - the higher it goes.
      // Dropped twice now chasing darker eyes; if this still isn't dark enough the
      // uniform wash itself is the wrong tool and the eyes need their own separate
      // material/mesh instead of one shared with the rest of the body.
      emissiveIntensity: 0.08,
    },
  })
    .then(({ group: fbxGroup, material }) => {
      applyJellyRimTreatment(material, {
        rimStrength: 0.9,
        rimPower: 2.2,
        coreTint: 0x0f8f5e,
        // Lower than the amoeba's own 0.55: that mixes toward coreTint by this fraction
        // regardless of how dark the pixel already is, so at high strength it lightened
        // the model's naturally near-black eyes toward the (comparatively brighter)
        // green tint instead of darkening the body as intended. This keeps the
        // deeper-toward-center jelly read on the lighter body areas without washing out
        // the darkest texture detail. Dropped again alongside emissiveIntensity above.
        coreStrength: 0.12,
      });
      displacement = applyJellyDisplacement(material, DISPLACEMENT_CONFIG);

      fbxMaterial = material;
      group.add(fbxGroup);
      fadeTimer = 0;

      // The value the crossfade below is heading for. onReady fires on THIS frame, while
      // opacity is still 0, and its listeners (see main.js) re-point PlayerController at
      // this material - which baselines its death-fade/restore opacity from whatever the
      // material reports. Without this it would capture the 0 and never see the real
      // value, leaving the slime invisible after its first death.
      material.userData.restOpacity = TARGET_OPACITY;

      api.bodyMaterial = material;
      api.onReady?.(material);
    })
    .catch((err) => {
      console.error('Failed to load Jellybean Smile model - keeping the placeholder sphere.', err);
    });

  /** Reactive substitute for the amoeba's discrete eye-widen/squint (this model has no
   *  rig to blink/gaze) - a brief whole-body scale beat, plus a slow idle breathing
   *  pulse and Living-Inventory load swell (same concept the amoeba's own uLoadSwell
   *  uniform drove) so the body still reads as alive and reactive at rest. Also drives
   *  the crossfade once the real model arrives, and the vertex-displacement wobble
   *  (applyJellyDisplacement) once it's ready - both real per-frame work, unlike the
   *  procedural amoeba this replaces, since neither this model nor its shader treatment
   *  exist until the network fetch resolves. */
  function update(deltaTime, { speedRatio = 0, load = 0 } = {}) {
    breatheTime += deltaTime;

    if (fadeTimer !== null) {
      fadeTimer += deltaTime;
      const t = Math.min(fadeTimer / CROSSFADE_DURATION, 1);
      placeholderMaterial.opacity = PLACEHOLDER_OPACITY * (1 - t);
      fbxMaterial.opacity = TARGET_OPACITY * t;
      if (t >= 1) {
        group.remove(placeholderMesh);
        placeholderMesh.geometry.dispose();
        placeholderMaterial.dispose();
        fadeTimer = null;
      }
    }

    if (displacement) displacement.update(deltaTime, speedRatio, load);

    let widenScale = 0;
    if (widenTime !== null) {
      widenTime += deltaTime;
      if (widenTime >= REACTION_CONFIG.widenDuration) widenTime = null;
      else widenScale = Math.sin((1 - widenTime / REACTION_CONFIG.widenDuration) * Math.PI) * REACTION_CONFIG.widenAmount;
    }

    let squintScale = 0;
    if (squintTime !== null) {
      squintTime += deltaTime;
      if (squintTime >= REACTION_CONFIG.squintDuration) squintTime = null;
      else squintScale = -(1 - squintTime / REACTION_CONFIG.squintDuration) * REACTION_CONFIG.squintAmount;
    }

    const breathe = Math.sin(breatheTime * REACTION_CONFIG.breatheSpeed) * REACTION_CONFIG.breatheAmount;
    const swell = THREE.MathUtils.clamp(load, 0, 1) * REACTION_CONFIG.loadSwell;
    group.scale.setScalar(Math.max(1 + breathe + swell + widenScale + squintScale, 0.05));
  }

  function triggerWiden() {
    widenTime = 0;
  }

  function triggerSquint() {
    squintTime = 0;
  }

  return api;
}
