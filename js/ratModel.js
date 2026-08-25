import * as THREE from 'three';
import { createSlimeCreature, registerSlimeUpdater } from './slimeCreature.js';

/**
 * Venom Rat: the player's mutated form, built as a jelly mouse.
 *
 * Rebuilt from opaque flat-shaded primitives. It was the last player-facing thing in the
 * game still made that way - the Beetle, Stalker and Murkmaw all moved to the shared
 * slime factory - so it had become the odd one out in a world of translucent bodies. It
 * is also the wrong read narratively: this form is the PLAYER wearing a rat's shape, so
 * it should obviously be made of what the player is made of.
 *
 * Two eyes, round, like the amoeba's. That is the cast's identity rule - the player has
 * a pair, every NPC is a cyclops - and this is a player form, so the pair carries over.
 *
 * THE VENOM MAGENTA IS LOAD-BEARING, NOT DECORATION.
 * PlayerFormController._updateRatIdle drives venomMaterial.emissiveIntensity every
 * frame: the pulse accelerates as the mutation countdown drains, an irregular flicker
 * kicks in past 70% elapsed, and it fades to zero through the reversion. That glow is
 * how the player reads how much time they have left WITHOUT looking at the HUD. A purely
 * green mouse would delete that signal, so the magenta is relocated rather than dropped -
 * onto the ear interiors and the tail-tip bulb, which are large enough to read at
 * gameplay distance and let the existing pulse code work untouched.
 *
 * Everything that is not the body hangs off the ROOT rather than the membrane. The
 * membrane is displaced per-vertex by noise, so anything parented to it gets dragged and
 * smeared as the surface moves - the same reasoning that puts the player's eyes inside
 * the body rather than on it.
 */

const RAT_CONFIG = {
  // 0.42, up from the 0.3 first tried. The original primitives rat was 0.28 and matching
  // it made the new body read as a small green frog at gameplay distance - the concept's
  // mouse has real presence on screen, closer to the player's own 0.6.
  bodyRadius: 0.42,
  // Large and set wide. Ears are the single strongest "mouse" cue in silhouette, and at
  // the first pass they were small and close enough together to disappear.
  earRadius: 0.2,
  venomColor: 0xff2d9e, // matches the mutation particle burst in playerFormController

  // Serpentine tail wave - the same idea as Murkmaw's body undulation
  // (CENTIPEDE_CONFIG.wave* in apexModel.js), scaled down for a tail rather than a whole
  // creature. The phase lag per segment is what makes the wave visibly travel from base
  // to tip instead of the tail swinging as one rigid piece.
  tailWaveAmplitude: 0.34,
  tailWaveSpeed: 4.2,
  tailWavePerSegment: 0.9,
};

const earGeometry = new THREE.SphereGeometry(RAT_CONFIG.earRadius, 16, 12);
const earInnerGeometry = new THREE.SphereGeometry(RAT_CONFIG.earRadius * 0.62, 14, 10);
const legGeometry = new THREE.CylinderGeometry(0.032, 0.045, 0.16, 6);
const tailSegmentGeometry = new THREE.CylinderGeometry(0.022, 0.034, 0.14, 6);
const tailBulbGeometry = new THREE.SphereGeometry(0.055, 12, 10);

/** Faces -Z at rotation.y = 0, the convention every model here follows. */
export function createRatMesh() {
  const group = new THREE.Group();

  const slime = createSlimeCreature({
    radius: RAT_CONFIG.bodyRadius,
    // Rounder and slightly longer than tall - a mouse's body, not the amoeba's blob.
    bodyScale: [1.0, 0.92, 1.22],
    // Not registered with the shared update sweep: PlayerFormController._updateRatIdle
    // already ticks this visual every frame, and two writers on the same uniforms would
    // fight.
    autoUpdate: false,
    maxSpeed: 7.5, // PLAYER_MAX_SPEED * venomRat's 1.25 speed multiplier

    color: 0x8dffc4,
    emissive: 0x2aa86c,
    emissiveIntensity: 0.5,
    coreTint: 0x0f8f5e,
    coreStrength: 0.5,
    opacity: 0.66,
    roughness: 0.12,
    rimStrength: 0.95,

    // Calmer than the amoeba: this body has a defined animal shape, and heavy lobe
    // churn would fight the silhouette that makes it read as a mouse.
    lobeFrequency: 1.1,
    lobeSpeed: 0.22,
    lobeAmplitude: 0.09,
    inwardFactor: 0.18,
    detailAmplitude: 0.01,
    tailLength: 0.35,

    eye: {
      count: 2,
      aspect: 1,          // round - this is the player, not a predator
      radius: 0.3,
      separation: 0.34,
      height: 0.14,
      depth: 0.3,
      highlightRadius: 0.34,
    },
  });
  group.add(slime.group);

  // --- Venom material -------------------------------------------------------
  // ONE material shared by both ear interiors and the tail bulb, so the single
  // emissiveIntensity write in _updateRatIdle lights all three at once.
  const venomMaterial = new THREE.MeshStandardMaterial({
    color: RAT_CONFIG.venomColor,
    emissive: RAT_CONFIG.venomColor,
    emissiveIntensity: 0.6, // the resting value _updateReverting restores to
    roughness: 0.3,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  venomMaterial.userData.isVenom = true;

  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x8dffc4,
    emissive: 0x2aa86c,
    emissiveIntensity: 0.35,
    roughness: 0.15,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });

  // --- Ears -----------------------------------------------------------------
  // Pivots, because _updateRatIdle twitches earLeft/earRight.rotation.z.
  const makeEar = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.27, 0.3, -0.02);

    const shell = new THREE.Mesh(earGeometry, shellMaterial);
    shell.scale.set(1, 1.05, 0.4); // flattened into a disc - the mouse-ear read
    shell.renderOrder = 8;
    pivot.add(shell);

    const inner = new THREE.Mesh(earInnerGeometry, venomMaterial);
    inner.scale.set(1, 1.05, 0.4);
    inner.position.z = -0.03;
    inner.renderOrder = 9;
    pivot.add(inner);

    group.add(pivot);
    return pivot;
  };
  const earLeft = makeEar(-1);
  const earRight = makeEar(1);

  // --- Face placement --------------------------------------------------------
  // No snout or nose: the head reads better as a clean jelly dome with just eyes and
  // ears. The muzzle and whiskers were both tried and removed.
  //
  // What remains matters though. The eye group billboards its ROTATION toward the
  // camera, but its POSITION stays wherever it is put. Left at the body's centre, the
  // eyes get pushed toward the camera within the group and end up on the +Z side -
  // which is the TAIL end, exactly opposite the bite direction (PlayerCombatController
  // fires along -Z, the model's forward). Offsetting the group along -Z puts the face
  // at the front where it belongs, while the billboard still keeps it turned toward the
  // viewer from any heading.
  const bodyR = RAT_CONFIG.bodyRadius;
  slime.eyeGroup.position.z = -bodyR * 0.62;

  // --- Legs -----------------------------------------------------------------
  // Pivots: _updateRatIdle writes legs[i].rotation.x, alternating by index parity, so
  // the order here decides which legs swing together.
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x63d9a0, roughness: 0.2, transparent: true, opacity: 0.75, depthWrite: false,
  });
  const legs = [[-0.23, -0.18], [0.23, -0.18], [-0.22, 0.2], [0.22, 0.2]].map(([x, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.24, z);
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.y = -0.06;
    leg.renderOrder = 8;
    pivot.add(leg);
    group.add(pivot);
    return pivot;
  });

  // --- Tail -----------------------------------------------------------------
  // PLANAR, and continuous. Both matter.
  //
  // An earlier version arced the segments upward in an attempt to lift the tail clear of
  // the body so the top-down camera could see it. That was wrong twice over: the tail
  // left the ground plane the whole game is played on, so it read as a broken, floating
  // object rather than part of the animal, and rotating each nested segment on X made
  // the joints visibly separate.
  //
  // So: every joint sits at the SAME height, and segments only ever rotate around Y -
  // the ground-plane axis. That is also exactly the axis the serpentine wave uses, so
  // the motion stays in-plane by construction rather than by careful tuning.
  //
  // Structure is pivot-per-joint with the mesh as a child:
  //
  //   tailPivot -> joint0 -> joint1 -> ... (each carries position + wave rotation)
  //                  |         |
  //                 mesh      mesh         (each carries only the taper scale)
  //
  // Keeping the taper on the MESH and never on the pivot is what stops the scale
  // compounding down the chain and pulling the joints apart - which is what opened the
  // gaps before.
  const TAIL_SEGMENTS = 6;
  const TAIL_JOINT_SPACING = 0.115;
  const TAIL_SEGMENT_LENGTH = 0.16; // longer than the spacing, so consecutive segments overlap

  const tailPivot = new THREE.Group();
  // Same height as the body's centre - in-plane, not lifted.
  tailPivot.position.set(0, -0.02, RAT_CONFIG.bodyRadius * 0.72);
  group.add(tailPivot);

  const tailSegments = [];
  let parent = tailPivot;
  for (let i = 0; i < TAIL_SEGMENTS; i++) {
    const joint = new THREE.Group();
    joint.position.z = i === 0 ? 0.04 : TAIL_JOINT_SPACING;
    parent.add(joint);

    const mesh = new THREE.Mesh(tailSegmentGeometry, legMaterial);
    // CylinderGeometry runs along Y; this lays it along Z so it points down the tail.
    mesh.rotation.x = Math.PI / 2;
    // Centred on the span between this joint and the next, so the run is unbroken.
    mesh.position.z = TAIL_JOINT_SPACING * 0.5;
    const taper = 1 - (i / TAIL_SEGMENTS) * 0.55;
    // Radial taper only - length stays fixed so the overlap never opens into a gap.
    mesh.scale.set(taper, TAIL_SEGMENT_LENGTH / 0.14, taper);
    mesh.renderOrder = 8;
    joint.add(mesh);

    tailSegments.push(joint);
    parent = joint;
  }

  // The bulb at the tip carries venom magenta - the concept's own detail, and the
  // furthest-from-body place to read the countdown glow from.
  const tailBulb = new THREE.Mesh(tailBulbGeometry, venomMaterial);
  tailBulb.position.z = TAIL_JOINT_SPACING;
  tailBulb.scale.setScalar(0.8);
  tailBulb.renderOrder = 9;
  parent.add(tailBulb);

  // --- Serpentine tail ------------------------------------------------------
  // PlayerFormController._updateRatIdle already sways tailPivot.rotation.y, which moves
  // the tail as a unit. This adds the travelling wave ON TOP of that, per segment, so
  // the tail whips like Murkmaw's body rather than pivoting rigidly.
  //
  // Because the segments are NESTED, each rotation compounds into its children - so a
  // small per-segment angle produces a large, natural curve at the tip without any of
  // them having to swing far.
  let tailTime = 0;
  registerSlimeUpdater({
    group,
    update(deltaTime) {
      // The rat visual exists on the player root at all times and is merely hidden while
      // the player is a slime, so this would otherwise keep animating a form nobody can
      // see. Cheap either way, but there is no reason to spend it.
      if (!group.visible) return;
      tailTime += deltaTime;
      for (let i = 0; i < tailSegments.length; i++) {
        const wave = Math.sin(tailTime * RAT_CONFIG.tailWaveSpeed - i * RAT_CONFIG.tailWavePerSegment);
        // Taper toward the tip so the base stays anchored to the body and the end is
        // what actually whips.
        const taper = 0.35 + (i / tailSegments.length) * 0.65;
        // Y only. Rotating on any other axis would lift the tail out of the ground
        // plane, which is the exact thing that made it look broken before.
        tailSegments[i].rotation.y = wave * RAT_CONFIG.tailWaveAmplitude * taper;
      }
    },
  });

  // --- Contract for PlayerFormController -------------------------------------
  // All six handles _updateRatIdle and _updateReverting destructure. Preserving these is
  // what lets that file stay completely untouched by this rebuild.
  group.userData.legs = legs;
  group.userData.tailPivot = tailPivot;
  group.userData.tailSegments = tailSegments;
  group.userData.earLeft = earLeft;
  group.userData.earRight = earRight;
  group.userData.venomMaterial = venomMaterial;
  group.userData.bodyMaterial = slime.bodyMaterial; // PlayerController's hit-flash target
  group.userData.slime = slime;

  return group;
}
