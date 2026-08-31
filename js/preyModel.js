import * as THREE from 'three';
import { createEntityHealthBar } from './entityHealthBar.js?v=5.3';
import { createSlimeCreature } from './slimeCreature.js?v=5.3';

/**
 * Glow Beetle: a small, squat, domed teal slime with one round eye and six little legs.
 *
 * Its legs were never the reason it looked static - PreyManager._applyIdleAnimation has
 * always swung them, faster while fleeing. The problem was scale and contrast: 0.02-unit
 * leg cylinders on a 0.22 body, in 0x18241c against a 0x0a1410 floor, so the motion was
 * sub-pixel and the whole creature was a dark speck. Now the BODY itself deforms and the
 * colour sits well clear of the ground, so the same animation actually reads.
 *
 * Round eye, not the Stalker's narrowed slit - this is prey, and it should look faintly
 * anxious rather than hostile. Still one eye: the player's pair is what marks them out.
 */

const legGeometry = new THREE.CylinderGeometry(0.014, 0.026, 0.24, 5);

/** Faces -Z at rotation.y = 0, the shared creature convention. */
export function createGlowBeetleMesh() {
  const group = new THREE.Group();

  const slime = createSlimeCreature({
    radius: 0.26,
    // Squat and domed - wider than it is tall, the classic beetle read.
    bodyScale: [1.15, 0.72, 1.2],
    maxSpeed: 6.3, // GLOW_BEETLE_CONFIG.fleeSpeed

    color: 0x5dffd6,
    emissive: 0x18a894,
    // MUST be 0.2: PreyManager._updateHitFlash ramps this to 2.8 and then restores it to
    // a hardcoded 0.2 as "resting". Changing it here without changing that would make
    // every beetle permanently brighter after its first hit.
    emissiveIntensity: 0.2,
    coreTint: 0x0a5f52,
    coreStrength: 0.5,
    opacity: 0.72,
    rimStrength: 1.0,

    // Taut and slow - a small tense thing, not the Stalker's agitated churn.
    lobeFrequency: 1.3,
    lobeSpeed: 0.4,
    lobeAmplitude: 0.13,
    inwardFactor: 0.2,

    eye: {
      count: 1,
      aspect: 1,        // round - prey, not predator
      radius: 0.32,
      height: 0.12,
      depth: 0.4,
      irisColor: 0x04231e,
      irisEmissive: 0x073028,
      highlightRadius: 0.36,
      blinkIntervalMin: 1.6,   // blinks often - reads as nervous
      blinkIntervalMax: 4.0,
    },
  });
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.22;
  bodyPivot.add(slime.group);
  group.add(bodyPivot);

  const legMaterial = new THREE.MeshStandardMaterial({ flatShading: true, color: 0x0c2a24, roughness: 0.85 });
  const legOffsets = [
    [-0.19, 0.16], [0.19, 0.16],
    [-0.22, 0.0], [0.22, 0.0],
    [-0.19, -0.16], [0.19, -0.16],
  ];
  const legs = legOffsets.map(([x, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.2, z);
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.y = -0.09;
    leg.rotation.z = x > 0 ? -0.55 : 0.55;
    pivot.add(leg);
    group.add(pivot);
    return pivot;
  });

  const healthBar = createEntityHealthBar({ yOffset: 0.55 });
  group.add(healthBar);

  // Contract for PreyManager: it destructures { shellMaterial } for the hit flash and
  // { legs } for its own gait, and reads healthBar. Legs are NOT handed to the shared
  // gait - PreyManager already drives them, and two writers on one rotation fight.
  group.userData.shellMaterial = slime.bodyMaterial;
  group.userData.abdomenMaterial = slime.bodyMaterial;
  group.userData.legs = legs;
  group.userData.healthBar = healthBar;
  group.userData.body = bodyPivot;
  group.userData.slime = slime;

  return group;
}
