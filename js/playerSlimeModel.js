import { createSlimeCreature } from './slimeCreature.js';

/**
 * Hollowdrop's own body - the player preset over the shared slime factory.
 *
 * All the actual machinery (GPU vertex displacement, the fresnel membrane, the
 * thickness tint, the eyes) lives in slimeCreature.js and is shared with every NPC.
 * What makes this the PLAYER is the handful of values below:
 *
 *  - two eyes rather than one. That is the cast's identity rule: the player has a pair,
 *    every other creature is a cyclops, so you are instantly distinguishable from the
 *    things hunting you even at a glance.
 *  - round eyes (aspect 1) rather than the narrowed, hostile shape the predators use.
 *  - autoUpdate: false, because main.js drives this one explicitly - it is the only
 *    creature with a camera to billboard against and an inventory load to swell from.
 *
 * --------------------------------------------------------------------------------
 * models/rimuru_slime.glb IS DELIBERATELY RETAINED, NOT DEAD WEIGHT.
 *
 * That file (2.26 MB) is the character model this module used to load, and nothing in
 * the project references it any more. It is kept on purpose so this change can be
 * reverted, so please don't remove it as an unused asset. To go back:
 *
 *   git show HEAD:js/playerSlimeModel.js > js/playerSlimeModel.js
 *
 * and then in main.js restore the async load - createAmoebaVisual(PLAYER_RADIUS)
 * becomes loadRimuruSlimeVisual(...).then(...) with its placeholder sphere - drop the
 * per-frame amoeba.update(...) call, and put "three/addons/" back in index.html's
 * importmap (the old loader imported GLTFLoader from a hardcoded CDN URL).
 *
 * Note that reverting also gives back the flat, unlit look: the old material set
 * color to black and routed everything through emissive, so the model ignored scene
 * lighting entirely. That was the original reason for replacing it.
 * --------------------------------------------------------------------------------
 *
 * @returns {{ group, bodyMaterial, eyeGroup, update, triggerWiden, triggerSquint }}
 *          `bodyMaterial` satisfies PlayerController's contract (.emissive /
 *          .emissiveIntensity / .opacity, transparent).
 */
export function createAmoebaVisual(radius = 0.6) {
  return createSlimeCreature({
    radius,
    autoUpdate: false,
    eye: { count: 2, aspect: 1 },
  });
}
