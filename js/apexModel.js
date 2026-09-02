import * as THREE from 'three';
import { createSlimeCreature, registerSlimeUpdater, weldVertices } from './slimeCreature.js?v=5.3';

/**
 * Murkmaw, the Apex Predator — Overhauled Eldritch Leviathan.
 *
 * 11-Segment undulating armored centipede with:
 * - Animated razor chitin mandibles that clamp, snap, and twitch.
 * - Jagged cranial horn crests and 5 glowing, pulsing slit eyes.
 * - Dorsal chitin spines and bioluminescent venom pustules along the spine.
 * - Articulated scuttling chitin legs on EVERY segment with phase-lagged stepping waves.
 * - Dynamic enraged phase color shifts (Violet -> Neon Crimson -> Magma Orange).
 */

export const CENTIPEDE_CONFIG = {
  segmentCount: 11,
  headRadius: 0.72,

  segmentScale: [0.95, 0.86, 1.18],
  headScale: [1.02, 0.90, 1.25],

  segmentFalloff: 0.94,
  minSegmentScale: 0.38,

  spacingWorld: 0.58,
  sampleDistance: 0.07,
  maxHistory: 260,

  waveAmplitude: 0.38,
  waveSpeed: 3.6,
  wavePerSegment: 0.78,
};

const weldSegmentGeometry = weldVertices;

// Shared accessory geometries
const legGeometry = new THREE.CylinderGeometry(0.025, 0.055, 0.48, 6);
legGeometry.rotateZ(0.15);
const spineGeometry = new THREE.ConeGeometry(0.065, 0.38, 5);
spineGeometry.rotateX(Math.PI / 2); // points forward/upward
const hornGeometry = new THREE.ConeGeometry(0.08, 0.44, 5);
hornGeometry.rotateX(-0.4); // curves backward
const pustuleGeometry = new THREE.SphereGeometry(0.11, 10, 8);
const mandibleGeometry = new THREE.ConeGeometry(0.09, 0.52, 5);
mandibleGeometry.rotateZ(Math.PI / 2); // points sideways/forward

const tempWorld = new THREE.Vector3();
const tempLocal = new THREE.Vector3();
const tempAhead = new THREE.Vector3();

/** Faces -Z at rotation.y = 0, the shared creature convention. */
export function createApexMesh() {
  const group = new THREE.Group();

  // --- Head slime core ---
  const headSlime = createSlimeCreature({
    radius: CENTIPEDE_CONFIG.headRadius,
    bodyScale: CENTIPEDE_CONFIG.headScale,
    maxSpeed: 2.2,
    autoUpdate: false,

    color: 0xa855f7,
    emissive: 0x4c1d95,
    emissiveIntensity: 0.75,
    coreTint: 0x2e0a52,
    coreStrength: 0.7,
    opacity: 0.74,
    rimStrength: 1.35,

    lobeFrequency: 2.6,
    lobeSpeed: 0.05,
    lobeAmplitude: 0.16,
    lobeGain: 1.9,
    lobeSharpness: 2.8,
    inwardFactor: 0.12,
    detailFrequency: 4.2,
    detailSpeed: 0.04,
    detailAmplitude: 0.04,

    eye: {
      count: 3,
      aspect: 0.22, // aggressive slit
      radius: 0.26,
      separation: 0.42,
      height: 0.14,
      depth: 0.52,
      irisColor: 0x2b0008,
      irisEmissive: 0xff1e11,
      irisEmissiveIntensity: 4.0,
      highlightRadius: 0.12,
      gazeRange: 0.22,
      blinkIntervalMin: 5.0,
      blinkIntervalMax: 12.0,
    },
  });

  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.62;
  group.add(bodyPivot);

  const head = new THREE.Group();
  bodyPivot.add(head);
  head.add(headSlime.group);

  // --- Materials ---
  const chitinMat = new THREE.MeshStandardMaterial({
    color: 0x140420,
    roughness: 0.45,
    metalness: 0.35,
    flatShading: true,
  });

  const pustuleMat = new THREE.MeshStandardMaterial({
    color: 0xb23fff,
    emissive: 0x8a2be2,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: 0.88,
    roughness: 0.2,
  });

  const hornMat = new THREE.MeshStandardMaterial({
    color: 0x220536,
    roughness: 0.35,
    metalness: 0.4,
    flatShading: true,
  });

  // --- Head Dressing: Mandibles, Cranial Crest & Extra Eyes ---
  const mandiblePivotL = new THREE.Group();
  mandiblePivotL.position.set(-0.38, -0.05, -0.5);
  const mandibleMeshL = new THREE.Mesh(mandibleGeometry, chitinMat);
  mandibleMeshL.rotation.y = 0.4;
  mandibleMeshL.rotation.z = -0.3;
  mandiblePivotL.add(mandibleMeshL);
  head.add(mandiblePivotL);

  const mandiblePivotR = new THREE.Group();
  mandiblePivotR.position.set(0.38, -0.05, -0.5);
  const mandibleMeshR = new THREE.Mesh(mandibleGeometry, chitinMat);
  mandibleMeshR.rotation.y = -0.4;
  mandibleMeshR.rotation.z = 0.3;
  mandibleMeshR.scale.x = -1; // mirrored
  mandiblePivotR.add(mandibleMeshR);
  head.add(mandiblePivotR);

  // Cranial Horn Crests
  const hornL = new THREE.Mesh(hornGeometry, hornMat);
  hornL.position.set(-0.28, 0.42, 0.1);
  hornL.rotation.z = -0.35;
  head.add(hornL);

  const hornR = new THREE.Mesh(hornGeometry, hornMat);
  hornR.position.set(0.28, 0.42, 0.1);
  hornR.rotation.z = 0.35;
  head.add(hornR);

  const hornCenter = new THREE.Mesh(hornGeometry, hornMat);
  hornCenter.position.set(0, 0.48, -0.05);
  hornCenter.scale.setScalar(0.85);
  head.add(hornCenter);

  // Head dorsal pustules
  const headPustule = new THREE.Mesh(pustuleGeometry, pustuleMat);
  headPustule.position.set(0, 0.36, 0.25);
  headPustule.scale.setScalar(1.25);
  head.add(headPustule);

  // Head scuttling legs
  const headLegs = [];
  const headLegPositions = [[-0.55, 0.25], [0.55, 0.25], [-0.58, -0.22], [0.58, -0.22]];
  for (const [lx, lz] of headLegPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(lx, -0.05, lz);
    const leg = new THREE.Mesh(legGeometry, chitinMat);
    leg.position.y = -0.22;
    leg.rotation.z = lx > 0 ? -0.45 : 0.45;
    pivot.add(leg);
    head.add(pivot);
    headLegs.push({ pivot, leg, isRight: lx > 0 });
  }

  // --- Segments Construction ---
  const segmentGeometryRaw = new THREE.IcosahedronGeometry(CENTIPEDE_CONFIG.headRadius, 12);
  const segmentGeometry = weldSegmentGeometry(segmentGeometryRaw);
  segmentGeometryRaw.dispose();

  const segments = [];
  const allSegmentLegs = [];
  const allPustules = [headPustule];
  let scale = 1;

  for (let i = 0; i < CENTIPEDE_CONFIG.segmentCount; i++) {
    scale = Math.max(scale * CENTIPEDE_CONFIG.segmentFalloff, CENTIPEDE_CONFIG.minSegmentScale);

    const segSlime = createSlimeCreature({
      radius: CENTIPEDE_CONFIG.headRadius,
      geometry: segmentGeometry,
      bodyScale: CENTIPEDE_CONFIG.segmentScale,
      autoUpdate: false,
      eye: { count: 0 },

      color: 0xa855f7,
      emissive: 0x4c1d95,
      emissiveIntensity: 0.75,
      coreTint: 0x2e0a52,
      coreStrength: 0.7,
      opacity: 0.76,
      rimStrength: 1.35,

      lobeFrequency: 2.6,
      lobeSpeed: 0.05,
      lobeAmplitude: 0.16,
      lobeGain: 1.9,
      lobeSharpness: 2.8,
      inwardFactor: 0.12,
      detailFrequency: 4.2,
      detailSpeed: 0.04,
      detailAmplitude: 0.04,
      tailLength: 0,
      streamlining: 0,
    });

    const pivot = new THREE.Group();
    pivot.add(segSlime.group);
    segSlime.group.scale.setScalar(scale);
    pivot.position.y = 0.62;
    group.add(pivot);

    // Attach dorsal spines to segment
    const spineTop = new THREE.Mesh(spineGeometry, chitinMat);
    spineTop.position.set(0, 0.42 * scale, 0);
    spineTop.rotation.x = -Math.PI / 2 - 0.2;
    spineTop.scale.setScalar(scale * 1.1);
    segSlime.group.add(spineTop);

    const spineL = new THREE.Mesh(spineGeometry, chitinMat);
    spineL.position.set(-0.4 * scale, 0.18 * scale, 0);
    spineL.rotation.y = -0.5;
    spineL.rotation.z = 0.7;
    spineL.scale.setScalar(scale * 0.9);
    segSlime.group.add(spineL);

    const spineR = new THREE.Mesh(spineGeometry, chitinMat);
    spineR.position.set(0.4 * scale, 0.18 * scale, 0);
    spineR.rotation.y = 0.5;
    spineR.rotation.z = -0.7;
    spineR.scale.setScalar(scale * 0.9);
    segSlime.group.add(spineR);

    // Glowing venom pustule along spine
    const pustule = new THREE.Mesh(pustuleGeometry, pustuleMat);
    pustule.position.set(0, 0.32 * scale, 0.1 * scale);
    pustule.scale.setScalar(scale * 1.15);
    segSlime.group.add(pustule);
    allPustules.push(pustule);

    // Articulated legs on this segment (Left & Right)
    const legL = new THREE.Group();
    legL.position.set(-0.48 * scale, -0.05 * scale, 0);
    const legMeshL = new THREE.Mesh(legGeometry, chitinMat);
    legMeshL.position.y = -0.22 * scale;
    legMeshL.rotation.z = 0.5;
    legMeshL.scale.setScalar(scale * 1.05);
    legL.add(legMeshL);
    segSlime.group.add(legL);

    const legR = new THREE.Group();
    legR.position.set(0.48 * scale, -0.05 * scale, 0);
    const legMeshR = new THREE.Mesh(legGeometry, chitinMat);
    legMeshR.position.y = -0.22 * scale;
    legMeshR.rotation.z = -0.5;
    legMeshR.scale.setScalar(scale * 1.05);
    legR.add(legMeshR);
    segSlime.group.add(legR);

    allSegmentLegs.push({ legL, legR, index: i, scale });
    segments.push({ pivot, slime: segSlime, material: segSlime.bodyMaterial, scale });
  }

  // Stand-in handles for backwards compatibility
  const coreGland = new THREE.Group();
  head.add(coreGland);
  const coreGlandMaterial = new THREE.MeshStandardMaterial({ color: 0xff4411, emissive: 0xff4411 });
  const glandMaterial = new THREE.MeshStandardMaterial({ color: 0xb23fff, emissive: 0xb23fff });
  const glands = [];

  // --- Chain Follow History ---
  const history = [];
  let elapsed = 0;
  let mandibleState = 0; // 0 = closed, 1 = flared open

  function seedHistory() {
    history.length = 0;
    group.getWorldPosition(tempWorld);
    const total = CENTIPEDE_CONFIG.spacingWorld * (CENTIPEDE_CONFIG.segmentCount + 2);
    const steps = Math.ceil(total / CENTIPEDE_CONFIG.sampleDistance);
    for (let i = 0; i < steps; i++) {
      history.push(new THREE.Vector3(tempWorld.x, tempWorld.y, tempWorld.z + i * CENTIPEDE_CONFIG.sampleDistance));
    }
  }
  seedHistory();

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

    if (tempWorld.distanceTo(headPos) > CENTIPEDE_CONFIG.spacingWorld * 6) {
      seedHistory();
      return;
    }

    if (tempWorld.distanceTo(headPos) >= CENTIPEDE_CONFIG.sampleDistance) {
      history.unshift(tempWorld.clone());
      if (history.length > CENTIPEDE_CONFIG.maxHistory) history.length = CENTIPEDE_CONFIG.maxHistory;
    }

    // Dynamic mandible idle twitch & clamp
    const idleTwitch = Math.sin(elapsed * 5.0) * 0.08;
    const flareAngle = THREE.MathUtils.lerp(0.35 + idleTwitch, 0.95, mandibleState);
    mandiblePivotL.rotation.y = flareAngle;
    mandiblePivotR.rotation.y = -flareAngle;

    // Pustule pulse
    const pustulePulse = 1.4 + Math.sin(elapsed * 4.2) * 0.55;
    pustuleMat.emissiveIntensity = pustulePulse;

    // Head leg scuttle
    for (let i = 0; i < headLegs.length; i++) {
      const hl = headLegs[i];
      const swing = Math.sin(elapsed * 8.0 + i * 1.5) * 0.25;
      hl.pivot.rotation.x = swing;
    }

    // Body segments undulation & leg scuttling
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const back = (i + 1) * CENTIPEDE_CONFIG.spacingWorld;

      samplePath(back, tempLocal);
      group.worldToLocal(tempLocal);
      const baseX = tempLocal.x;
      const baseZ = tempLocal.z;

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

      const taper = 1 - (i / segments.length) * 0.4;
      const wave = Math.sin(elapsed * CENTIPEDE_CONFIG.waveSpeed - i * CENTIPEDE_CONFIG.wavePerSegment)
        * CENTIPEDE_CONFIG.waveAmplitude * taper;

      seg.pivot.position.set(baseX + -dirZ * wave, 0.62, baseZ + dirX * wave);
      seg.pivot.rotation.y = Math.atan2(dirX, dirZ) + Math.PI;

      // Leg scuttling wave down the body
      const legObj = allSegmentLegs[i];
      if (legObj) {
        const legPhase = elapsed * 8.5 - i * 0.85;
        const swingL = Math.sin(legPhase) * 0.32;
        const swingR = Math.sin(legPhase + Math.PI) * 0.32;
        legObj.legL.rotation.x = swingL;
        legObj.legR.rotation.x = swingR;
        legObj.legL.rotation.z = Math.cos(legPhase) * 0.12;
        legObj.legR.rotation.z = -Math.cos(legPhase + Math.PI) * 0.12;
      }

      seg.material.emissive.copy(headSlime.bodyMaterial.emissive);
      seg.material.emissiveIntensity = headSlime.bodyMaterial.emissiveIntensity;
      seg.material.opacity = headSlime.bodyMaterial.opacity;

      seg.slime.update(deltaTime, { speedRatio: 0 });
    }

    headSlime.update(deltaTime);
  }

  registerSlimeUpdater({ group, update: updateChain });

  // Function to smoothly switch enraged colors
  function setEnragedPhase(phaseNumber) {
    if (phaseNumber === 2) {
      headSlime.bodyMaterial.color.setHex(0xd92638);
      headSlime.bodyMaterial.emissive.setHex(0x8a0515);
      pustuleMat.color.setHex(0xff3300);
      pustuleMat.emissive.setHex(0xff1100);
      pustuleMat.emissiveIntensity = 2.4;
      for (const seg of segments) {
        seg.material.color.setHex(0xd92638);
        seg.material.emissive.setHex(0x8a0515);
      }
    } else if (phaseNumber === 3) {
      headSlime.bodyMaterial.color.setHex(0xff5500);
      headSlime.bodyMaterial.emissive.setHex(0xcc2200);
      pustuleMat.color.setHex(0xffaa00);
      pustuleMat.emissive.setHex(0xff6600);
      pustuleMat.emissiveIntensity = 3.2;
      for (const seg of segments) {
        seg.material.color.setHex(0xff5500);
        seg.material.emissive.setHex(0xcc2200);
      }
    }
  }

  // Contract for ApexController
  group.userData.body = bodyPivot;
  group.userData.head = head;
  group.userData.bodyMaterial = headSlime.bodyMaterial;
  group.userData.eyeMaterial = headSlime.eyeMaterial;
  group.userData.glandMaterial = glandMaterial;
  group.userData.coreGland = coreGland;
  group.userData.coreGlandMaterial = coreGlandMaterial;
  group.userData.legs = headLegs.map((hl) => hl.pivot);
  group.userData.glands = glands;
  group.userData.slime = headSlime;
  group.userData.segments = segments;
  group.userData.pustules = allPustules;
  group.userData.pustuleMaterial = pustuleMat;
  group.userData.setMandibleState = (state) => { mandibleState = state; };
  group.userData.setEnragedPhase = setEnragedPhase;
  group.userData.resetChain = seedHistory;

  return group;
}
