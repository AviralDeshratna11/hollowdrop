import * as THREE from 'three';
import { createEntityHealthBar } from './entityHealthBar.js';
import { createSlimeCreature } from './slimeCreature.js';

/**
 * Cave Stalker: a long, low, restless slime with a single narrow eye and six thin legs.
 *
 * Rebuilt from a matte dark ellipsoid, which was the worst offender in the old cast.
 * Its body was 0x1e1626 against a 0x0a1410 background - close enough in value that the
 * whole creature read as a featureless dark pill, and its two 0.045-unit eyes were a
 * few pixels wide at gameplay distance. The thing hunting you was the least legible
 * object on screen.
 *
 * Now it shares the player's membrane shader, so it gets the same translucency, fresnel
 * rim and live deformation. What separates it from the player:
 *
 *  - ONE eye, narrowed (aspect 0.55) into a hostile slit rather than the player's pair
 *    of round ones. This is the cast-wide rule: player has two, everything else has one.
 *  - hot magenta instead of green, well above the floor's value so it never disappears
 *    into it.
 *  - a long, low bodyScale and fast, high-amplitude lobes - it reads as agitated and
 *    predatory next to the player's slow, calm pulsing.
 *
 * The legs are attached to the group, NOT to the deforming membrane: the body's surface
 * is displaced per-vertex, so anything parented to it gets dragged out of shape. Same
 * reasoning that keeps the eyes inside the body rather than on it.
 */

const legGeometry = new THREE.CylinderGeometry(0.02, 0.035, 0.42, 6);
const antennaGeometry = new THREE.CylinderGeometry(0.008, 0.016, 0.28, 5);

function createWarningSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 52px sans-serif';
  ctx.fillStyle = '#ff2d55';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 32, 36);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, opacity: 0 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.4, 0.4, 1);
  sprite.position.y = 0.95;
  return sprite;
}

/** Built to face -Z at rotation.y = 0 - the convention every creature here follows, and
 *  what lets the shared shader's motion tail trail correctly behind it. */
export function createPredatorMesh() {
  const group = new THREE.Group();

  const slime = createSlimeCreature({
    radius: 0.34,
    // Long and low. The Z stretch is what gives it a stalking silhouette instead of the
    // egg every creature used to share.
    bodyScale: [0.92, 0.72, 1.55],
    maxSpeed: 4.2, // PREDATOR_CONFIG.chaseSpeed - so streamlining peaks at a real chase

    color: 0xff4d7a,
    emissive: 0x8e1030,
    emissiveIntensity: 0.7,
    coreTint: 0x5a0a22,
    coreStrength: 0.6,
    opacity: 0.7,
    rimStrength: 1.1,

    // Restless and quick - agitated where the player is calm.
    lobeFrequency: 1.15,
    lobeSpeed: 0.75,
    lobeAmplitude: 0.2,
    inwardFactor: 0.3,

    eye: {
      count: 1,
      aspect: 0.55,       // narrowed into a slit - the whole "hostile" read
      radius: 0.34,
      height: 0.1,
      depth: 0.42,
      irisColor: 0x1a0008,
      irisEmissive: 0x2a0010,
      highlightRadius: 0.26,
      blinkIntervalMin: 3.5,
      blinkIntervalMax: 9.0,
    },
  });
  // PredatorController bobs `userData.body` vertically, so the slime hangs from a pivot
  // rather than sitting directly in the group. The pivot also lifts the body clear of
  // the floor, which the old model did with body.position.y = 0.28.
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.3;
  bodyPivot.add(slime.group);
  group.add(bodyPivot);

  // Six thin legs, splayed low and wide. Deliberately spindly: against a soft round
  // body they are what actually says "bug" rather than "blob".
  const legMaterial = new THREE.MeshStandardMaterial({ flatShading: true, color: 0x2a0a18, roughness: 0.85 });
  const legOffsets = [
    [-0.26, 0.26], [0.26, 0.26],
    [-0.3, 0.0], [0.3, 0.0],
    [-0.26, -0.24], [0.26, -0.24],
  ];
  const legs = legOffsets.map(([x, z]) => {
    // Each leg hangs from a pivot at body height so the gait can swing it from the hip
    // rather than sliding the whole limb.
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.3, z);
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.y = -0.16;
    leg.rotation.z = x > 0 ? -0.5 : 0.5;
    pivot.add(leg);
    group.add(pivot);
    return pivot;
  });

  const antennaMaterial = new THREE.MeshStandardMaterial({
    flatShading: true, color: 0x2a0a18, roughness: 0.7,
    emissive: 0xff4d7a, emissiveIntensity: 0.35,
  });
  const antennae = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.1, 0.42, -0.28);
    const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
    antenna.position.y = 0.14;
    antenna.rotation.z = side * 0.5;
    antenna.rotation.x = -0.4;
    pivot.add(antenna);
    group.add(pivot);
    return pivot;
  });

  // Antennae only. The LEGS are deliberately left off the shared gait because
  // PredatorController._applyAnimation already drives legs[i].rotation.x itself, keyed
  // to its CHASE/ATTACK states - handing them to the shared gait too would mean two
  // writers fighting over the same property every frame, with the winner decided by
  // call order.
  slime.attachLimbs({ antennae });

  const warningSprite = createWarningSprite();
  group.add(warningSprite);

  const healthBar = createEntityHealthBar({ width: 0.7, fillWidth: 0.64, yOffset: 0.85 });
  group.add(healthBar);

  // Contract preserved for PredatorController: it writes bodyMaterial (hit flash),
  // healthBar and warningSprite. bodyMaterial is now the slime membrane, so hit flashes
  // light up the whole translucent body instead of a matte shell.
  group.userData.body = bodyPivot;
  group.userData.bodyMaterial = slime.bodyMaterial;
  group.userData.eyeMaterial = slime.eyeMaterial;
  group.userData.warningSprite = warningSprite;
  group.userData.healthBar = healthBar;
  group.userData.legs = legs;
  group.userData.antennae = antennae;
  group.userData.slime = slime;

  return group;
}
