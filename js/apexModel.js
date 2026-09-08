import * as THREE from 'three';
import { registerSlimeUpdater } from './slimeCreature.js?v=5.3';
import { attachOcclusionOutline } from './occlusionOutline.js?v=5.3';
import { createApexFace, shadeFacets } from './apexFace.js?v=5.3';

/**
 * Murkmaw, the Apex Predator — faceted crystal-armored centipede.
 *
 * 11-Segment undulating armored centipede with:
 * - Split armored jaws that flare and twitch around a recessed mouth.
 * - Opaque purple armor and three glossy eyes inset into angular sockets.
 * - Broad low-poly facets and chunky purple crystal spikes along the spine.
 * - Articulated scuttling chitin legs on EVERY segment with phase-lagged stepping waves.
 * - Dynamic enraged phase color shifts (Violet -> Neon Crimson -> Magma Orange).
 */

export const CENTIPEDE_CONFIG = {
  segmentCount: 11,
  headRadius: 0.72,

  segmentScale: [0.95, 0.86, 0.98],
  headScale: [1.03, 0.91, 0.94],

  segmentFalloff: 0.94,
  minSegmentScale: 0.38,

  spacingWorld: 0.58,
  sampleDistance: 0.07,
  maxHistory: 260,

  waveAmplitude: 0.38,
  waveSpeed: 3.6,
  wavePerSegment: 0.78,
};

// Broad facets and chunky crystals replace the boss's animated slime membrane.
const legGeometry = new THREE.CylinderGeometry(0.025, 0.055, 0.48, 6);
legGeometry.rotateZ(0.15);
const armorGeometry = shadeFacets(new THREE.IcosahedronGeometry(CENTIPEDE_CONFIG.headRadius, 1));
const crystalGeometry = shadeFacets(new THREE.ConeGeometry(0.19, 0.42, 5).toNonIndexed());

const crystalHighlight = new THREE.Color(0xe5b5ff);
const tempWorld = new THREE.Vector3();
const tempLocal = new THREE.Vector3();
const tempAhead = new THREE.Vector3();

function createArmor(material, axes) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(armorGeometry, material);
  mesh.scale.set(...axes);
  group.add(mesh);
  const outline = attachOcclusionOutline(mesh, { color: 0xa855f7, rimColor: 0xe9caff });
  return { group, bodyMaterial: material, outline };
}

function addCrystal(parent, material, position, direction, scale = 1) {
  const crystal = new THREE.Mesh(crystalGeometry, material);
  crystal.position.set(...position);
  crystal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...direction).normalize());
  crystal.scale.setScalar(scale);
  parent.add(crystal);
  return crystal;
}

/** Faces -Z at rotation.y = 0, the shared creature convention. */
export function createApexMesh() {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xa855f7, emissive: 0x4c1d95, emissiveIntensity: 0.3,
    roughness: 0.72, metalness: 0, flatShading: true, vertexColors: true,
    opacity: 1, transparent: false, depthWrite: true,
  });
  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: 0xbd69ff, emissive: 0x6b20b5, emissiveIntensity: 0.25,
    roughness: 0.48, metalness: 0.04, flatShading: true, vertexColors: true,
  });
  const chitinMat = new THREE.MeshStandardMaterial({
    color: 0x30104c, roughness: 0.75, flatShading: true,
  });
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.62;
  group.add(bodyPivot);
  const head = new THREE.Group();
  bodyPivot.add(head);

  // The rear skull joins the first segment. The separate faceplate supplies real
  // eye openings and an open jaw instead of stretching eyes over a solid sphere.
  const headArmor = createArmor(bodyMaterial, CENTIPEDE_CONFIG.headScale);
  headArmor.group.position.set(0, 0.15, 0.14);
  head.add(headArmor.group);
  const face = createApexFace(bodyMaterial, crystalMaterial);
  head.add(face.group);
  const faceOutline = attachOcclusionOutline(face.group, { color: 0xa855f7, rimColor: 0xe9caff });
  const [mandiblePivotL, mandiblePivotR] = face.mandibles;
  const headCrystal = addCrystal(head, crystalMaterial, [0, 0.85, 0.05], [0, 1, -0.1], 1.2);
  addCrystal(head, crystalMaterial, [-0.72, 0.38, -0.14], [-1, 0.45, -0.1], 0.8);
  addCrystal(head, crystalMaterial, [0.72, 0.38, -0.14], [1, 0.45, -0.1], 0.8);
  addCrystal(head, crystalMaterial, [-0.42, 0.67, 0.12], [-0.5, 1, 0.1], 0.7);
  addCrystal(head, crystalMaterial, [0.42, 0.67, 0.12], [0.5, 1, 0.1], 0.7);

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

  const segments = [];
  const allSegmentLegs = [];
  const allCrystals = [headCrystal];
  let scale = 1;
  for (let i = 0; i < CENTIPEDE_CONFIG.segmentCount; i++) {
    scale = Math.max(scale * CENTIPEDE_CONFIG.segmentFalloff, CENTIPEDE_CONFIG.minSegmentScale);
    const armor = createArmor(bodyMaterial, CENTIPEDE_CONFIG.segmentScale);
    const pivot = new THREE.Group();
    pivot.add(armor.group);
    armor.group.scale.setScalar(scale);
    pivot.position.y = 0.62;
    group.add(pivot);

    // Accessories inherit taper exactly once from the armor group. Their bases
    // intersect the shell so even the smallest tail spikes remain attached.
    allCrystals.push(addCrystal(armor.group, crystalMaterial, [0, 0.64, 0], [0, 1, 0.15]));
    addCrystal(armor.group, crystalMaterial, [-0.61, 0.21, -0.08], [-1, 0.4, 0], 0.8);
    addCrystal(armor.group, crystalMaterial, [0.61, 0.21, -0.08], [1, 0.4, 0], 0.8);
    addCrystal(armor.group, crystalMaterial, [-0.43, 0.48, 0.23], [-0.65, 0.9, 0.2], 0.62);
    addCrystal(armor.group, crystalMaterial, [0.43, 0.48, 0.23], [0.65, 0.9, 0.2], 0.62);

    // Articulated legs on this segment (Left & Right)
    const legL = new THREE.Group();
    legL.position.set(-0.48, -0.05, 0);
    const legMeshL = new THREE.Mesh(legGeometry, chitinMat);
    legMeshL.position.y = -0.22;
    legMeshL.rotation.z = 0.5;
    legMeshL.scale.setScalar(1.05);
    legL.add(legMeshL);
    armor.group.add(legL);

    const legR = new THREE.Group();
    legR.position.set(0.48, -0.05, 0);
    const legMeshR = new THREE.Mesh(legGeometry, chitinMat);
    legMeshR.position.y = -0.22;
    legMeshR.rotation.z = -0.5;
    legMeshR.scale.setScalar(1.05);
    legR.add(legMeshR);
    armor.group.add(legR);

    allSegmentLegs.push({ legL, legR, index: i, scale });
    segments.push({ pivot, armor, material: bodyMaterial, scale });
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
    const idleTwitch = Math.sin(elapsed * 5.0) * 0.018;
    const flareAngle = THREE.MathUtils.lerp(idleTwitch, 0.24, mandibleState);
    mandiblePivotL.rotation.z = -flareAngle;
    mandiblePivotR.rotation.z = flareAngle;

    // Share the shell material so hit flashes, death, and reset also reach the tail.
    // Crystal tint follows that material, including a reset after an enraged phase.
    crystalMaterial.color.copy(bodyMaterial.color).lerp(crystalHighlight, 0.18);
    crystalMaterial.emissive.copy(bodyMaterial.emissive);
    // The eye intensity is the controller's death fade; include it so this idle
    // pulse cannot relight the crystals after the controller has dimmed them.
    crystalMaterial.emissiveIntensity = (0.25 + Math.sin(elapsed * 4.2) * 0.035)
      * THREE.MathUtils.clamp(face.eyeMaterial.emissiveIntensity / 0.8, 0, 1);
    headArmor.outline.update(deltaTime);
    faceOutline.update(deltaTime);

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

      seg.armor.outline.update(deltaTime);
    }
  }

  registerSlimeUpdater({ group, update: updateChain });

  function setEnragedPhase(phaseNumber) {
    if (phaseNumber === 2) {
      bodyMaterial.color.setHex(0xd92638);
      bodyMaterial.emissive.setHex(0x8a0515);
    } else if (phaseNumber === 3) {
      bodyMaterial.color.setHex(0xff5500);
      bodyMaterial.emissive.setHex(0xcc2200);
    }
  }

  // Contract for ApexController
  group.userData.body = bodyPivot;
  group.userData.head = head;
  group.userData.bodyMaterial = bodyMaterial;
  group.userData.eyeMaterial = face.eyeMaterial;
  group.userData.eyes = face.eyes;
  group.userData.glandMaterial = glandMaterial;
  group.userData.coreGland = coreGland;
  group.userData.coreGlandMaterial = coreGlandMaterial;
  group.userData.legs = headLegs.map((hl) => hl.pivot);
  group.userData.glands = glands;
  group.userData.segments = segments;
  group.userData.pustules = allCrystals;
  group.userData.pustuleMaterial = crystalMaterial;
  group.userData.setMandibleState = (state) => { mandibleState = state; };
  group.userData.setEnragedPhase = setEnragedPhase;
  group.userData.resetChain = seedHistory;

  return group;
}
