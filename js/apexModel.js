import * as THREE from 'three';
import { createSlimeCreature, registerSlimeUpdater, weldVertices } from './slimeCreature.js?v=5.3';

/**
 * Murkmaw, the Apex: a segmented centipede of slime.
 *
 * Every other creature in this game is a deforming ellipsoid - player, Stalker, Beetle,
 * Rival. Cohesive, but it meant the boss was just a bigger one of those. A centipede is
 * a different TOPOLOGY rather than a different size, so it reads as "boss" instantly at
 * any distance, and a long chain occupies far more of a top-down screen than a single
 * large sphere ever could. It stays on-theme because it is still slime - the same
 * material, merely arranged differently, which is what mutation looks like.
 *
 * HOW THE CHAIN WORKS
 * ApexController continues to drive exactly one thing: this group's position and yaw,
 * i.e. the HEAD. It has no idea a body exists. The segments trail by sampling a history
 * of where the head has been - recorded by DISTANCE travelled, not by time, so spacing
 * stays even whether it is creeping or mid-charge at 9 units/sec.
 *
 * Segments are children of this group (not the scene), so the controller's
 * mesh.scale.setScalar() intro rise, its death collapse and its removal all still apply
 * to the whole creature for free. That means their world-space trail positions have to
 * be converted back into group-local space each frame - see _updateChain.
 *
 * THE HEAD IS THE WEAK POINT. Only the head is the damageable entity; the body is a
 * wall to get around. This falls out of the existing code rather than needing new
 * hit-testing: ApexController's attack ranges, charge travel and ring origins all key
 * off this.mesh.position, which is the head, and PlayerCombatController's forward cone
 * tests entity.mesh.position, also the head.
 */

export const CENTIPEDE_CONFIG = {
  segmentCount: 9,
  headRadius: 0.68,

  // Closer to spherical than the capsules tried first, but deliberately not round:
  // the irregular spiny displacement below is what stops them reading as beads.
  segmentScale: [0.94, 0.84, 1.16],
  headScale: [1.0, 0.88, 1.22],

  segmentFalloff: 0.93,
  minSegmentScale: 0.42,

  // Raised from 0.42 now that the bodies are rounder and shorter along Z. At the old
  // spacing near-spherical segments buried most of each other; this keeps them merged
  // into a continuous body while leaving the individual segments readable.
  spacingWorld: 0.6,

  sampleDistance: 0.08,
  maxHistory: 220,

  // Serpentine undulation - the body swings side to side as it travels, the wave
  // running from head to tail. This is what makes it move like a snake rather than a
  // train of carriages following a track.
  waveAmplitude: 0.34,
  waveSpeed: 3.4,
  wavePerSegment: 0.85,   // phase lag down the body; larger = tighter S-curves
};

const legGeometry = new THREE.CylinderGeometry(0.035, 0.06, 0.5, 6);
const glandGeometry = new THREE.SphereGeometry(0.09, 10, 8);
const coreGlandGeometry = new THREE.SphereGeometry(0.2, 16, 12);

const weldSegmentGeometry = weldVertices;

const tempWorld = new THREE.Vector3();
const tempLocal = new THREE.Vector3();
const tempAhead = new THREE.Vector3();

/** Faces -Z at rotation.y = 0, the shared creature convention. */
export function createApexMesh() {
  const group = new THREE.Group();

  const headSlime = createSlimeCreature({
    radius: CENTIPEDE_CONFIG.headRadius,
    bodyScale: CENTIPEDE_CONFIG.headScale,
    maxSpeed: 1.8, // APEX_CONFIG.moveSpeed
    autoUpdate: false, // driven by the chain updater below, together with the segments

    color: 0xa855f7,
    emissive: 0x4c1d95,
    emissiveIntensity: 0.6,
    coreTint: 0x2e0a52,
    coreStrength: 0.65,
    opacity: 0.68,
    rimStrength: 1.15,

    // SPINY, and almost static. lobeSharpness is the knob that decides blunt lobe vs
    // spike: high values narrow each peak into a point, which is exactly the sea-urchin
    // look that was wrong for the cute player and is right for this. lobeSpeed is near
    // zero so the spines are surface TEXTURE rather than the amoeba's churning motion.
    lobeFrequency: 2.3,
    lobeSpeed: 0.04,
    lobeAmplitude: 0.14,
    lobeGain: 1.8,
    lobeSharpness: 2.6,
    inwardFactor: 0.12,
    detailFrequency: 4.0,
    detailSpeed: 0.03,
    detailAmplitude: 0.035,

    eye: {
      count: 3,
      // 0.28 is a hard slit. The player's are round at 1.0 - that roundness is most of
      // what makes them cute, so narrowing this far is the single biggest lever for
      // making a face read as hostile instead.
      aspect: 0.28,
      radius: 0.24,
      separation: 0.4,
      height: 0.12,
      depth: 0.5,
      // Hot, self-lit iris rather than a dark pupil, so all three read as glowing slits
      // in the dark.
      irisColor: 0x2b0008,
      irisEmissive: 0xff2d1f,
      irisEmissiveIntensity: 3.2,   // properly hot - three glowing slits, not dark ovals
      // Tiny highlight. A big glossy catchlight is a cuteness cue - shrinking it is what
      // stops these looking like the player's friendly eyes.
      highlightRadius: 0.14,
      gazeRange: 0.2,
      blinkIntervalMin: 6.0,
      blinkIntervalMax: 14.0,
    },
  });

  // Two nested pivots: ApexController writes `body.position.y = 0.62 + bob` and,
  // separately, `head.rotation.x` for its hit-jerk. One object serving both names would
  // make the bob compound with the pivot's own offset.
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.62;
  group.add(bodyPivot);

  const head = new THREE.Group();
  bodyPivot.add(head);
  head.add(headSlime.group);

  // --- Body segments --------------------------------------------------------
  // Each segment is its own slime body with its OWN uniforms, so they can be calmer
  // than the head and can run out of phase with each other. The first version cloned
  // the head's material, which silently shared the head's uniform objects - every
  // segment then rippled in perfect lockstep with the head, which is exactly the
  // "same slime wave motion reused" that made it look wrong.
  //
  // Geometry is built once at low detail and shared by all of them: the segments barely
  // deform, so they do not need the head's tessellation, and nine copies at detail 20
  // would have cost 79k triangles on its own.
  // Detail 13 = 3,920 triangles per segment. Raised from 10: the spiny displacement has
  // features around 2-4 units of noise space, and at detail 10 those aliased into jagged
  // facets instead of resolving as spines. Nine segments is ~35k triangles - real, but
  // this is the boss and it is the only creature paying it.
  const segmentGeometryRaw = new THREE.IcosahedronGeometry(CENTIPEDE_CONFIG.headRadius, 13);
  const segmentGeometry = weldSegmentGeometry(segmentGeometryRaw);
  segmentGeometryRaw.dispose();

  const segments = [];
  let scale = 1;

  for (let i = 0; i < CENTIPEDE_CONFIG.segmentCount; i++) {
    scale = Math.max(scale * CENTIPEDE_CONFIG.segmentFalloff, CENTIPEDE_CONFIG.minSegmentScale);

    const seg = createSlimeCreature({
      radius: CENTIPEDE_CONFIG.headRadius,
      geometry: segmentGeometry,
      bodyScale: CENTIPEDE_CONFIG.segmentScale,
      autoUpdate: false,
      eye: { count: 0 },   // body segments are just meat

      color: 0xa855f7,
      emissive: 0x4c1d95,
      emissiveIntensity: 0.6,
      coreTint: 0x2e0a52,
      coreStrength: 0.65,
      opacity: 0.72,
      rimStrength: 1.15,

      // Same spiny, near-static surface as the head - see its note. Slightly stronger
      // here because the body is where the texture has room to read.
      lobeFrequency: 2.5,
      lobeSpeed: 0.04,
      lobeAmplitude: 0.15,
      lobeGain: 1.8,
      lobeSharpness: 2.6,
      inwardFactor: 0.12,
      detailFrequency: 4.0,
      detailSpeed: 0.03,
      detailAmplitude: 0.04,
      // No motion tail on the body - only the head should taper when it accelerates.
      tailLength: 0,
      streamlining: 0,
    });

    const pivot = new THREE.Group();
    pivot.add(seg.group);
    seg.group.scale.setScalar(scale);
    pivot.position.y = 0.62;
    group.add(pivot);

    segments.push({ pivot, slime: seg, material: seg.bodyMaterial, scale });
  }

  // --- Head dressing --------------------------------------------------------
  // The core gland and its satellites (the glowing yellow spheres) are GONE at the
  // user's request - they read as a nucleus, and this creature is meant to be a spiny
  // worm rather than a cell with visible organs.
  //
  // Their handles survive as invisible stand-ins because ApexController still drives
  // them and would throw otherwise: it scales coreGland 1x -> 1.6x on the phase-2
  // transition and writes emissiveIntensity to both gland materials during the intro,
  // phase change and death. An empty Group and two orphaned materials absorb those
  // writes harmlessly, which keeps that controller free of any knowledge of this model.
  const coreGland = new THREE.Group();
  head.add(coreGland);
  const coreGlandMaterial = new THREE.MeshStandardMaterial({ color: 0xff8a2d, emissive: 0xff8a2d });
  const glandMaterial = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xffb347 });
  const glands = [];

  const headLegMaterial = new THREE.MeshStandardMaterial({ flatShading: true, color: 0x1a0630, roughness: 0.85 });
  const legs = [[-0.6, 0.3], [0.6, 0.3], [-0.6, -0.25], [0.6, -0.25]].map(([x, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.62, z);
    const leg = new THREE.Mesh(legGeometry, headLegMaterial);
    leg.position.y = -0.24;
    leg.rotation.z = x > 0 ? -0.5 : 0.5;
    pivot.add(leg);
    group.add(pivot);
    return pivot;
  });

  // --- Chain follow ---------------------------------------------------------
  // Distance-sampled history of the head's world position. Distance rather than time so
  // segment spacing is identical whether Murkmaw is creeping at 1.8 u/s or mid-charge
  // at 9 - a time-sampled trail would concertina open and shut with speed.
  const history = [];
  let elapsed = 0;

  function seedHistory() {
    history.length = 0;
    group.getWorldPosition(tempWorld);
    // Lay the initial trail straight back along +Z (local "behind"), so it spawns
    // already extended instead of every segment stacked inside the head.
    const total = CENTIPEDE_CONFIG.spacingWorld * (CENTIPEDE_CONFIG.segmentCount + 2);
    const steps = Math.ceil(total / CENTIPEDE_CONFIG.sampleDistance);
    for (let i = 0; i < steps; i++) {
      history.push(new THREE.Vector3(tempWorld.x, tempWorld.y, tempWorld.z + i * CENTIPEDE_CONFIG.sampleDistance));
    }
  }
  seedHistory();

  /** Walks the recorded path backwards by a true distance and writes that point into
   *  `out`, interpolating between the two history samples that straddle it. */
  function samplePath(distanceBack, out) {
    let travelled = 0;
    for (let k = 1; k < history.length; k++) {
      const prev = history[k - 1];
      const cur = history[k];
      const d = prev.distanceTo(cur);
      if (d <= 1e-6) continue;
      if (travelled + d >= distanceBack) {
        out.lerpVectors(prev, cur, (distanceBack - travelled) / d);
        return out;
      }
      travelled += d;
    }
    return out.copy(history[history.length - 1]);
  }

  function updateChain(deltaTime) {
    elapsed += deltaTime;

    group.getWorldPosition(tempWorld);
    const headPos = history[0];

    // A jump far larger than one sample is a teleport, not travel - the arena respawn,
    // Play Again, or a debug reposition. Without this the body stays strung out along
    // the old path while the head flies off connected to nothing.
    if (tempWorld.distanceTo(headPos) > CENTIPEDE_CONFIG.spacingWorld * 6) {
      seedHistory();
      return;
    }

    if (tempWorld.distanceTo(headPos) >= CENTIPEDE_CONFIG.sampleDistance) {
      history.unshift(tempWorld.clone());
      if (history.length > CENTIPEDE_CONFIG.maxHistory) history.length = CENTIPEDE_CONFIG.maxHistory;
    }

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const back = (i + 1) * CENTIPEDE_CONFIG.spacingWorld;

      // Sampled by ARC LENGTH along the recorded path, not by history index. Index
      // stepping was tried first and leaves visible gaps: sampleDistance is only a
      // minimum before a point is recorded, so at charge speed (9 u/s, ~0.15 units per
      // frame) the entries sit further apart than intended and a fixed stride stretches
      // with velocity. Walking the true distance keeps spacing exact at any speed.
      samplePath(back, tempLocal);
      group.worldToLocal(tempLocal);
      const baseX = tempLocal.x;
      const baseZ = tempLocal.z;

      // Direction along the chain, sampled slightly further forward on the same path.
      samplePath(Math.max(0, back - CENTIPEDE_CONFIG.spacingWorld), tempAhead);
      group.worldToLocal(tempAhead);
      let dirX = tempAhead.x - baseX;
      let dirZ = tempAhead.z - baseZ;
      const len = Math.hypot(dirX, dirZ);
      if (len > 1e-4) {
        dirX /= len;
        dirZ /= len;
      } else {
        dirX = 0;
        dirZ = 1;
      }

      // Serpentine undulation: swing perpendicular to the direction of travel, with the
      // phase lagging further down the body so the wave visibly runs head-to-tail. This
      // is applied on TOP of the follow path rather than replacing it, so the body still
      // tracks where the head actually went - it just slithers along it. Amplitude
      // tapers toward the tail so the creature does not flail at the thin end.
      const taper = 1 - (i / segments.length) * 0.45;
      const wave = Math.sin(elapsed * CENTIPEDE_CONFIG.waveSpeed - i * CENTIPEDE_CONFIG.wavePerSegment)
        * CENTIPEDE_CONFIG.waveAmplitude * taper;
      // Perpendicular to (dirX, dirZ) in the ground plane.
      seg.pivot.position.set(baseX + -dirZ * wave, 0.62, baseZ + dirX * wave);
      seg.pivot.rotation.y = Math.atan2(dirX, dirZ) + Math.PI;

      // ApexController writes hit flash and phase tint onto bodyMaterial, which is the
      // HEAD's material. Mirroring it here is what makes the whole creature flash rather
      // than just its front end.
      seg.material.emissive.copy(headSlime.bodyMaterial.emissive);
      seg.material.emissiveIntensity = headSlime.bodyMaterial.emissiveIntensity;
      seg.material.opacity = headSlime.bodyMaterial.opacity;

      // Each segment advances its own uniforms, staggered, so the (slight) surface
      // motion is not synchronised across the body.
      seg.slime.update(deltaTime, { speedRatio: 0 });
    }

    headSlime.update(deltaTime);
  }

  registerSlimeUpdater({ group, update: updateChain });

  // Contract for ApexController - unchanged from the single-body version, which is why
  // that file needs no edits.
  group.userData.body = bodyPivot;
  group.userData.head = head;
  group.userData.bodyMaterial = headSlime.bodyMaterial;
  group.userData.eyeMaterial = headSlime.eyeMaterial;
  group.userData.glandMaterial = glandMaterial;
  group.userData.coreGland = coreGland;
  group.userData.coreGlandMaterial = coreGlandMaterial;
  group.userData.legs = legs;
  group.userData.glands = glands;
  group.userData.slime = headSlime;
  group.userData.segments = segments;
  group.userData.resetChain = seedHistory; // called on Play Again so the tail does not whip across the map

  return group;
}
