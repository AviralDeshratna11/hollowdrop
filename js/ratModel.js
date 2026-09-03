import * as THREE from 'three';
import { loadFbxCharacter } from './fbxCharacterLoader.js?v=5.3';
import { loadGltfCharacter } from './gltfCharacterLoader.js?v=5.3';
import { registerSlimeUpdater } from './slimeCreature.js?v=5.3';
import { attachOcclusionOutline } from './occlusionOutline.js?v=5.3';

/**
 * Venom Rat: the player's mutated form, now Meshy AI's "Plague Sludge Rat" - a static
 * (unrigged, no animation/skin data - confirmed by scanning the FBX binary directly)
 * single mesh with its own 4-texture PBR set, loaded async the same way
 * playerSlimeModel.js loads the Jellybean Slime (see loadFbxCharacter/its own header
 * comment for why the FBX's own materials aren't used directly).
 *
 * Because it is one static mesh, there is nothing to articulate: no separate legs, ears
 * or tail to swing. Rather than rewrite PlayerFormController._updateRatIdle /
 * _updateReverting (which destructure legs/tailPivot/earLeft/earRight/venomMaterial off
 * this group's userData every frame and are otherwise untouched by this whole feature),
 * this file hands back inert placeholder Groups for the parts that no longer exist -
 * writing a rotation to an empty Group with no visible children is a harmless no-op -
 * and gives it ONE real, shared venomMaterial (== the whole body's own material) so the
 * existing countdown-glow pulse still visibly lights the creature up, just as a
 * whole-body glow instead of ear/tail highlights.
 *
 * TWO GAITS live here, because the two variants are two different assets:
 *
 *   'cute' (the PLAYER's form) is now models/rat_walk.glb - a genuinely rigged mesh with
 *      a 181-deform-bone armature and a baked four-beat "Walk" clip. Its legs are driven
 *      by an AnimationMixer whose timeScale is the measured travel speed, so it actually
 *      walks instead of vibrating. This replaces the Crystal Violet Mouse mesh outright:
 *      it is a different model with its own textures, so the player's rat LOOKS
 *      different now, not just animates differently.
 *
 *   'venom' (the BOSS, predatorModel.js) stays on the un-rigged Plague Sludge Rat FBX
 *      and therefore keeps the procedural bob/pitch/roll fake below. That fake is the
 *      only locomotion a rig-less mesh can have, and re-skinning the boss is out of
 *      scope here - so both paths are kept rather than deleting one and silently
 *      freezing the boss.
 *
 * Both register through the same registerSlimeUpdater block, which self-measures speed
 * from the group's own world-position delta (the exact idiom slimeCreature.js's own
 * update() uses when no explicit speedRatio is threaded in) so it needs no controller
 * reference; only what it does with that speed differs.
 */

const RAT_MODEL_URLS = {
  fbxUrl: 'models/plague_sludge_rat/rat.fbx',
  baseColorUrl: 'models/plague_sludge_rat/rat_basecolor.png',
  normalUrl: 'models/plague_sludge_rat/rat_normal.png',
  roughnessUrl: 'models/plague_sludge_rat/rat_roughness.png',
  metalnessUrl: 'models/plague_sludge_rat/rat_metallic.png',
};

// The player's own Venom Rat: a rigged GLB with its textures embedded, so unlike the FBX
// pairs above it is a single fetch with no sibling texture URLs to keep in sync. Replaces
// the previous un-rigged Meshy "Crystal Violet Mouse" (models/cute_rat/, still on disk
// and still referenced by nothing else - safe to delete once this is signed off).
const CUTE_RAT_GLB_URL = 'models/rat_walk.glb';
const CUTE_RAT_WALK_CLIP = 'Walk';

// Fixed correction so the model's own front lines up with this project's forward
// convention (Model faces -Z at rotation.y = 0) - verified with an isolated probe
// render: at rotation.y = 0 the snout points backward (+Z) with the tail trailing
// forward, so a half-turn puts the snout at -Z as required.
const FACING_ROTATION_Y = Math.PI;

const RAT_CONFIG = {
  // Half the model's largest bounding-box dimension after normalization (see
  // loadFbxCharacter). 0.42 matched the OLD primitives rat's raw sphere radius, but that
  // rat also got stretched by a further bodyScale multiplier on top - reused as a flat
  // target here, the FBX (whose long axis is nose-to-tail) came out reading as too small
  // next to the HUD/other creatures. Bumped to give it the "real presence" the original
  // design called for.
  bodyRadius: 0.75,
  venomColor: 0xff2d9e, // matches the mutation particle burst in playerFormController
  // A muted version of the same hue, used as the material's actual emissive base -
  // PlayerFormController._updateRatIdle drives emissiveIntensity up to ~1.8 every frame
  // while transformed, and applying that intensity straight onto the full-strength
  // venomColor (fine on the OLD model's small ear/tail-tip detail meshes) washes the
  // whole-body FBX texture out to a flat pink blob. Same hue, roughly a third the
  // magnitude, keeps the countdown-glow pulse legible while letting the actual
  // Plague Sludge texture read through it.
  venomGlowColor: 0x551a35,


  // --- Skeletal walk cycle ('cute' / player only) ------------------------------------
  // Playback rate for the GLB's baked Walk clip, lerped by speedRatio. NOT a foot-locked
  // rate, and it can't be: the clip's paws travel 0.267 model units per cycle (measured
  // off the animation channels), which at this model's ~0.79 normalization scale and the
  // clip's 0.667s period implies a ground speed of ~0.32 u/s. The player sprints at 7.5.
  // Matching exactly would need timeScale ~23 - a blur, not a walk. So these are tuned
  // for readability instead: a slow shuffle at rest, ~4 gait cycles/second at full
  // sprint, which is what a scurrying rodent reads as. Tune these two numbers, not the
  // clip, if the gait looks wrong.
  walkIdleTimeScale: 0.22,
  walkMaxTimeScale: 2.6,

  // --- Procedural walk cycle ('venom' / boss only) ------------------------------------
  // The un-rigged Plague Sludge Rat FBX has no skeleton to drive, so its locomotion is
  // this bob/pitch/roll fake - tuned for a "scurrying rodent", faster/choppier than the
  // player's own slow jelly breathing. Also used by BOTH variants before their model
  // finishes loading, while the placeholder sphere is what's on screen.
  walkBobAmount: 0.045,
  walkPitchAmount: 0.09,
  walkRollAmount: 0.06,
  walkBaseFrequency: 9,
  walkFrequencyPerSpeed: 9,
  maxSpeed: 7.5, // PLAYER_MAX_SPEED * venomRat's 1.25 speed multiplier
};

/** Faces -Z at rotation.y = 0, the convention every model here follows. */
export function createRatMesh({ variant = 'venom' } = {}) {
  // 'venom' (default) = the boss's pink Plague Sludge look, unchanged. 'cute' = the
  // player's own purple, big-eyed evolution of it (see the Rat DNA progression) - the
  // exact same mesh/gait/combat, only the material, added eyes and a gentler rounder
  // proportion differ, so the player never reads as identical to the boss.
  const isCute = variant === 'cute';
  const outlineColor = isCute ? 0x9b5cf0 : 0xff2d9e;
  const outlineRimColor = isCute ? 0xe6d5ff : 0xffccee;
  const glowColor = isCute ? 0x3a1a55 : RAT_CONFIG.venomGlowColor; // countdown-glow base hue

  const group = new THREE.Group();

  const placeholderMaterial = new THREE.MeshStandardMaterial({
    color: 0x8dffc4,
    emissive: RAT_CONFIG.venomGlowColor,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const placeholderMesh = new THREE.Mesh(new THREE.SphereGeometry(RAT_CONFIG.bodyRadius, 20, 14), placeholderMaterial);
  group.add(placeholderMesh);

  let placeholderOcclusion = attachOcclusionOutline(placeholderMesh, {
    color: outlineColor,
    rimColor: outlineRimColor,
    opacity: 0.92,
    emissiveIntensity: 2.8,
    rimStrength: 3.4,
    rimPower: 1.8,
    innerAlpha: 0.22,
  });

  // Wraps the actual visible mesh (placeholder now, the loaded FBX once ready) so the
  // walk cycle below can bob/pitch/roll it independently of `group` itself, which
  // PlayerFormController writes .scale/.position.z on directly for the instability
  // wobble and the Venom Bite crouch/lunge - two effects composing multiplicatively
  // rather than fighting over the same transform.
  const gaitWrapper = new THREE.Group();
  gaitWrapper.add(placeholderMesh);
  group.add(gaitWrapper);

  // --- Contract for PlayerFormController --------------------------------------------
  // legs: empty on purpose - _updateRatIdle's `for (i < legs.length)` loop simply never
  // runs. tailPivot/earLeft/earRight are inert placeholder Groups so its direct
  // `.rotation.x/y/z =` writes stay valid no-ops (nothing renders from them).
  group.userData.legs = [];
  group.userData.tailPivot = new THREE.Group();
  group.userData.earLeft = new THREE.Group();
  group.userData.earRight = new THREE.Group();
  group.userData.venomMaterial = placeholderMaterial;
  group.userData.bodyMaterial = placeholderMaterial; // PlayerController's hit-flash target
  // Optional - set post-construction (main.js). Called once, with the real body
  // material, when the FBX finishes loading and replaces the placeholder - lets main.js
  // re-point PlayerFormController.ratMaterial (captured by value at construction, so it
  // would otherwise keep pointing at the placeholder forever).
  group.userData.onReady = null;

  const materialOptions = {
    transparent: true,
    // Less glassy than the player's own slime - "sludge", not clean jelly - but still
    // enough translucency to read as part of the same cast rather than a flat opaque
    // import.
    opacity: 0.88,
    depthWrite: false,
    // The countdown-glow color IS the load-bearing signal here (see the file header
    // and PlayerFormController._updateRatIdle) - emissiveIntensity gets driven every
    // frame by that method, from 0.6 at rest up through a flicker near expiry.
    emissive: glowColor,
    emissiveIntensity: 0.6,
  };

  // Set once the rigged GLB lands ('cute' only). While null, the updater below falls
  // back to the procedural gait - which is also what the placeholder sphere gets.
  let walkMixer = null;

  const loadPromise = isCute
    ? loadGltfCharacter({
        url: CUTE_RAT_GLB_URL,
        targetRadius: RAT_CONFIG.bodyRadius,
        facingRotationY: FACING_ROTATION_Y,
        clipName: CUTE_RAT_WALK_CLIP,
        materialOptions,
      })
    : loadFbxCharacter({
        ...RAT_MODEL_URLS,
        targetRadius: RAT_CONFIG.bodyRadius,
        facingRotationY: FACING_ROTATION_Y,
        materialOptions,
      });

  loadPromise
    .then(({ group: modelGroup, material, mixer = null }) => {
      if (placeholderOcclusion) {
        placeholderOcclusion.dispose();
        placeholderOcclusion = null;
      }
      gaitWrapper.remove(placeholderMesh);
      placeholderMesh.geometry.dispose();
      placeholderMaterial.dispose();

      attachOcclusionOutline(modelGroup, {
        color: outlineColor,
        rimColor: outlineRimColor,
        opacity: 0.92,
        emissiveIntensity: 2.8,
        rimStrength: 3.4,
        rimPower: 1.8,
        innerAlpha: 0.22,
      });

      gaitWrapper.add(modelGroup);

      // Handing over to the skeleton: zero out whatever pose the procedural gait left on
      // the wrapper, or the clip's own body motion composes on top of a stale tilt.
      if (mixer) {
        walkMixer = mixer;
        gaitWrapper.position.y = 0;
        gaitWrapper.rotation.x = 0;
        gaitWrapper.rotation.z = 0;
      }

      group.userData.venomMaterial = material;
      group.userData.bodyMaterial = material;
      group.userData.onReady?.(material);
    })
    .catch((err) => {
      console.error('Failed to load the Venom Rat model - keeping the placeholder sphere.', err);
    });

  // --- Gait tick ----------------------------------------------------------------------
  // Stays inside the updateSlimeCreatures sweep, which means this `deltaTime` is main.js's
  // realDeltaTime, NOT the hitstop-scaled one. That is deliberate even though a walk cycle
  // is simulation: speedRatio below is derived from how far the group actually MOVED, and
  // during a hitstop the player barely moves, so travelled collapses, speedRatio collapses,
  // and the mixer's timeScale drops to its idle floor on its own. The gait therefore
  // already stalls during a freeze without being wired to the scaled delta - and keeping it
  // here preserves the sweep's automatic deregistration (a group detached from the scene
  // drops out of the registry, which resetGame relies on).
  let walkTime = 0;
  const lastWorldPos = new THREE.Vector3();
  const worldPos = new THREE.Vector3(); // reused scratch - no per-frame allocation
  let hasLastPos = false;
  registerSlimeUpdater({
    group,
    update(deltaTime) {
      // The rat visual exists on the player root at all times and is merely hidden
      // while the player is a slime, so this would otherwise keep animating a form
      // nobody can see. Cheap either way, but there is no reason to spend it.
      if (!group.visible) return;

      group.getWorldPosition(worldPos);
      let speedRatio = 0;
      if (hasLastPos && deltaTime > 0) {
        const travelled = worldPos.distanceTo(lastWorldPos);
        speedRatio = THREE.MathUtils.clamp(travelled / deltaTime / RAT_CONFIG.maxSpeed, 0, 1);
      }
      hasLastPos = true;
      lastWorldPos.copy(worldPos);

      // Rigged path: the skeleton IS the gait, so all this has to decide is how fast to
      // run it - stands almost still at rest, scurries when sprinting.
      if (walkMixer) {
        const timeScale = THREE.MathUtils.lerp(
          RAT_CONFIG.walkIdleTimeScale,
          RAT_CONFIG.walkMaxTimeScale,
          speedRatio,
        );
        walkMixer.update(deltaTime * timeScale);
        return;
      }

      // Un-rigged path (the boss FBX, and either variant's placeholder sphere before its
      // model lands): fake it with a bob/pitch/roll cycle that speeds up the same way.
      walkTime += deltaTime * (1 + speedRatio * 2.2);
      const freq = RAT_CONFIG.walkBaseFrequency + speedRatio * RAT_CONFIG.walkFrequencyPerSpeed;

      gaitWrapper.position.y = Math.abs(Math.sin(walkTime * freq * 0.5)) * RAT_CONFIG.walkBobAmount * speedRatio;
      gaitWrapper.rotation.x = Math.sin(walkTime * freq) * RAT_CONFIG.walkPitchAmount * speedRatio;
      gaitWrapper.rotation.z = Math.sin(walkTime * freq * 0.5) * RAT_CONFIG.walkRollAmount * speedRatio;
    },
  });

  return group;
}
