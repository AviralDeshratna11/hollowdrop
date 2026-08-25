import * as THREE from 'three';
import { createSlimeCreature } from './slimeCreature.js';

/**
 * The Rival Slime: an exact replica of the player, distinguished only by its eyes.
 *
 * Same radius, same membrane, same colour, same lobe motion, same two eyes - every value
 * left at the shared defaults, which is precisely what playerSlimeModel.js does. That is
 * the point: the Rival is another of your kind, not a differently-coloured enemy, and a
 * mirror of yourself competing for the same prize is a stronger encounter than a monster
 * would be.
 *
 * THE ONLY DIFFERENCE IS THE EYES. A lid covers the upper half of each, angled so the
 * inner edges drop into a scowl - an angled semicircle rather than the player's open
 * round eye. It reads as hostile without changing the silhouette, and because the lid
 * sits over the eye rather than replacing it, the gaze tracking, blinking and highlights
 * all still work underneath.
 *
 * ON TELLING THEM APART: the camera is locked to the player and keeps them at screen
 * centre at all times, so "which one am I" is never ambiguous in play even with identical
 * bodies. If it ever does become a problem, hue is the lever - but it costs the mirror.
 */

// Dormant at rest, and deliberately so. RivalController ramps coreMaterial's
// emissiveIntensity 1.1 -> 3.2 while the Rival mutates into the Fire Lizard, so this
// core is the charge-up tell for that transformation. Keeping it dim until then is what
// lets the Rival pass as an ordinary slime right up until it stops being one.
const CORE_RADIUS = 0.2;
const CORE_REST_INTENSITY = 1.1; // the value RivalController lerps FROM

export function createRivalSlimeMesh() {
  const group = new THREE.Group();

  const slime = createSlimeCreature({
    radius: 0.6, // identical to PLAYER_RADIUS
    // Ticked by the shared updateSlimeCreatures() sweep, same as every other NPC.
    // RivalController never calls an update on this visual, so opting out would leave
    // the membrane frozen and the eyes unblinking - a statue of the player rather than a
    // rival. The sweep drops it automatically once the mesh leaves the scene.
    autoUpdate: true,
    eye: {
      count: 2,
      aspect: 1,
      // The whole distinction. ~0.55 rad of inward tilt is a clear scowl while still
      // leaving enough of the eye visible to read as an eye.
      lidAngle: 0.55,
      // Darker than the membrane on purpose. The lid uses an UNLIT material, so a colour
      // sampled from the membrane's own base renders far brighter than the lit,
      // translucent body around it and pops as a glowing stripe. This sits at roughly the
      // value the membrane actually resolves to on screen, so it reads as the creature's
      // own flesh closing over the eye.
      lidColor: 0x2f7d5c,
    },
  });
  group.add(slime.group);

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xff8a3d,
    emissive: 0xff8a3d,
    emissiveIntensity: CORE_REST_INTENSITY,
    roughness: 0.3,
    transparent: true,
    // Faint at rest. At 0.55 it showed through the membrane as a distinct tan blob under
    // the eyes and read as a snout, which broke the "identical to the player" illusion
    // the whole design depends on. RivalController ramps the emissive during the
    // mutation, so it still flares into a clear tell when it matters.
    opacity: 0.22,
    depthWrite: false,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(CORE_RADIUS, 16, 12), coreMaterial);
  core.renderOrder = 9; // under the eyes (10-12), over the membrane (0)
  slime.group.add(core);

  // Contract for RivalController: it reads membraneMaterial (hit flash, and the base
  // emissive it snapshots on spawn) and coreMaterial (the mutation charge-up), and
  // scales slimeVisual directly. Providing these means that controller needs no changes.
  group.userData.membraneMaterial = slime.bodyMaterial;
  group.userData.bodyMaterial = slime.bodyMaterial;
  group.userData.coreMaterial = coreMaterial;
  group.userData.core = core;
  group.userData.body = slime.group;
  group.userData.eyeMaterial = slime.eyeMaterial;
  group.userData.slime = slime;

  return group;
}
