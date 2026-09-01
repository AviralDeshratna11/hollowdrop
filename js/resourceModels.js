import * as THREE from 'three';
import { attachOcclusionOutline } from './occlusionOutline.js?v=5.3';

// --- Shared Geometries (Optimized for Mobile/WebGL) --------------------------
// Geometries are created once and shared across instances to minimize memory and draw overhead.

// Stones & Rocks
const stoneLargeGeom = new THREE.DodecahedronGeometry(0.18, 0);
const stoneMediumGeom = new THREE.DodecahedronGeometry(0.13, 0);
const stonePebbleGeom = new THREE.DodecahedronGeometry(0.07, 0);
const stoneSlabGeom = new THREE.CylinderGeometry(0.14, 0.17, 0.06, 6);

// Mushrooms
const mushroomCapGeom = new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
const mushroomGillsGeom = new THREE.CylinderGeometry(0.16, 0.05, 0.025, 12);
const mushroomStemGeom = new THREE.CylinderGeometry(0.038, 0.058, 0.22, 10);
const mushroomSporeSpotGeom = new THREE.SphereGeometry(0.022, 6, 6);
const smallCapGeom = new THREE.SphereGeometry(0.095, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
const smallStemGeom = new THREE.CylinderGeometry(0.022, 0.036, 0.13, 8);
const myceliumBaseGeom = new THREE.CylinderGeometry(0.26, 0.3, 0.02, 10);

// Blue Glowcaps
const glowcapTallStemGeom = new THREE.CylinderGeometry(0.032, 0.052, 0.28, 10);
const glowcapDomeGeom = new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45);
const glowcapGillsGeom = new THREE.CylinderGeometry(0.15, 0.04, 0.02, 12);

// Organic Nutrient Spore Pods
const podMainGeom = new THREE.DodecahedronGeometry(0.11, 1);
const podSubGeom = new THREE.DodecahedronGeometry(0.07, 1);
const podNucleusGeom = new THREE.SphereGeometry(0.045, 8, 8);
const podTendrilGeom = new THREE.CylinderGeometry(0.015, 0.035, 0.12, 6);

// Toxic Spore Pods
const toxicPodMainGeom = new THREE.IcosahedronGeometry(0.12, 0);
const toxicSpikeGeom = new THREE.ConeGeometry(0.035, 0.11, 5);
const toxicPustuleGeom = new THREE.DodecahedronGeometry(0.048, 0);

// Iron Ore
const ironBoulderGeom = new THREE.DodecahedronGeometry(0.2, 0);
const ironSubRockGeom = new THREE.DodecahedronGeometry(0.12, 0);
const oreCrystalGeom = new THREE.OctahedronGeometry(0.075, 0);

// DNA Bio-Vials
const vialCapGeom = new THREE.CylinderGeometry(0.088, 0.088, 0.038, 14);
const vialGlassGeom = new THREE.CylinderGeometry(0.078, 0.078, 0.25, 14, 1, true);
const vialSealRingGeom = new THREE.TorusGeometry(0.082, 0.012, 6, 14);
const helixNodeGeom = new THREE.SphereGeometry(0.018, 6, 6);
const helixBarGeom = new THREE.CylinderGeometry(0.006, 0.006, 0.08, 4);
const bioStrutGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.28, 5);
const orbitRingGeom = new THREE.TorusGeometry(0.15, 0.012, 6, 18);

// Toxic Gland
const glandBladderGeom = new THREE.SphereGeometry(0.14, 12, 10);
const glandNeckGeom = new THREE.CylinderGeometry(0.04, 0.065, 0.12, 8);
const glandDuctGeom = new THREE.TorusGeometry(0.07, 0.018, 6, 10, Math.PI * 0.85);

// --- Shared Base Materials ----------------------------------------------------
const groundBaseMaterial = new THREE.MeshStandardMaterial({
  color: 0x142018,
  roughness: 0.95,
  flatShading: true,
});

const darkMetalMaterial = new THREE.MeshStandardMaterial({
  color: 0x22262a,
  metalness: 0.85,
  roughness: 0.25,
});

const glassMaterial = new THREE.MeshStandardMaterial({
  color: 0xd6f7ff,
  transparent: true,
  opacity: 0.38,
  roughness: 0.1,
  metalness: 0.15,
  side: THREE.DoubleSide,
});

// --- Model Factory Functions --------------------------------------------------

/**
 * Stone: A natural cluster of multi-sized faceted rocks (large central boulder,
 * medium angular stone, flat slab, and small pebbles) resting on the ground.
 */
function makeStone() {
  const group = new THREE.Group();

  const stoneMat1 = new THREE.MeshStandardMaterial({
    color: 0x767c82,
    roughness: 0.92,
    flatShading: true,
  });
  const stoneMat2 = new THREE.MeshStandardMaterial({
    color: 0x5a6066,
    roughness: 0.95,
    flatShading: true,
  });

  // Main primary boulder
  const mainRock = new THREE.Mesh(stoneLargeGeom, stoneMat1);
  mainRock.position.set(0, 0.14, 0);
  mainRock.rotation.set(0.4, 0.6, 0.2);
  mainRock.scale.set(1.15, 0.85, 1.05);

  // Secondary medium stone
  const medRock = new THREE.Mesh(stoneMediumGeom, stoneMat2);
  medRock.position.set(0.15, 0.09, -0.06);
  medRock.rotation.set(0.9, -0.4, 0.7);
  medRock.scale.set(1.0, 0.8, 1.1);

  // Flat base slab
  const slab = new THREE.Mesh(stoneSlabGeom, stoneMat2);
  slab.position.set(-0.06, 0.03, 0.12);
  slab.rotation.set(0.1, 0.5, -0.08);

  // Small pebbles
  const pebble1 = new THREE.Mesh(stonePebbleGeom, stoneMat1);
  pebble1.position.set(-0.16, 0.05, -0.08);
  pebble1.rotation.set(0.2, 0.8, 1.1);

  const pebble2 = new THREE.Mesh(stonePebbleGeom, stoneMat2);
  pebble2.position.set(0.12, 0.04, 0.16);
  pebble2.rotation.set(1.2, 0.1, 0.5);

  group.add(mainRock, medRock, slab, pebble1, pebble2);

  // Foliage-Gated Occlusion Outline Highlights
  attachOcclusionOutline(mainRock, {
    color: 0x8a949e,
    rimColor: 0xeef4f8,
    opacity: 0.88,
    emissiveIntensity: 2.2,
    rimStrength: 3.0,
    rimPower: 1.8,
    innerAlpha: 0.18,
  });
  attachOcclusionOutline(medRock, {
    color: 0x8a949e,
    rimColor: 0xeef4f8,
    opacity: 0.88,
    emissiveIntensity: 2.2,
    rimStrength: 3.0,
    rimPower: 1.8,
    innerAlpha: 0.18,
  });
  attachOcclusionOutline(slab, {
    color: 0x8a949e,
    rimColor: 0xeef4f8,
    opacity: 0.85,
    emissiveIntensity: 2.0,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.15,
  });

  return group;
}

/**
 * Moon Mushroom: A ground-rooted fungal colony featuring a mature primary mushroom
 * with glowing cap, underside gills, bioluminescent spore spots, plus 2 smaller
 * sprouting young mushrooms emerging from an organic base patch.
 */
function makeMushroom(color) {
  const group = new THREE.Group();

  const capMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.65,
    roughness: 0.35,
    flatShading: false,
  });

  const stemMaterial = new THREE.MeshStandardMaterial({
    color: 0xded5c2,
    emissive: 0x3d3024,
    emissiveIntensity: 0.2,
    roughness: 0.75,
  });

  const gillsMaterial = new THREE.MeshStandardMaterial({
    color: 0xffeedd,
    emissive: color,
    emissiveIntensity: 0.45,
    roughness: 0.5,
  });

  const spotMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });

  // Base mycelium substrate
  const basePatch = new THREE.Mesh(myceliumBaseGeom, groundBaseMaterial);
  basePatch.position.y = 0.01;
  group.add(basePatch);

  // --- Main Mushroom ---
  const mainMushroom = new THREE.Group();

  const stem = new THREE.Mesh(mushroomStemGeom, stemMaterial);
  stem.position.y = 0.11;
  stem.rotation.z = -0.06;

  const cap = new THREE.Mesh(mushroomCapGeom, capMaterial);
  cap.position.y = 0.21;
  cap.scale.set(1.1, 0.75, 1.1);

  const gills = new THREE.Mesh(mushroomGillsGeom, gillsMaterial);
  gills.position.y = 0.205;

  // Bioluminescent spore spots on cap
  const spotOffsets = [
    [0.08, 0.25, 0.05],
    [-0.07, 0.26, -0.04],
    [0.02, 0.28, 0.08],
    [-0.05, 0.24, 0.09],
  ];
  spotOffsets.forEach(([sx, sy, sz]) => {
    const spot = new THREE.Mesh(mushroomSporeSpotGeom, spotMaterial);
    spot.position.set(sx, sy, sz);
    mainMushroom.add(spot);
  });

  mainMushroom.add(stem, gills, cap);
  group.add(mainMushroom);

  // --- Secondary Young Mushroom ---
  const sideMushroom = new THREE.Group();
  sideMushroom.position.set(0.14, 0, 0.06);
  sideMushroom.rotation.set(0.1, 0.4, -0.2);

  const sideStem = new THREE.Mesh(smallStemGeom, stemMaterial);
  sideStem.position.y = 0.065;
  const sideCap = new THREE.Mesh(smallCapGeom, capMaterial);
  sideCap.position.y = 0.125;
  sideCap.scale.set(1.0, 0.8, 1.0);
  sideMushroom.add(sideStem, sideCap);
  group.add(sideMushroom);

  // --- Sprout Button Mushroom ---
  const sprout = new THREE.Group();
  sprout.position.set(-0.11, 0, -0.08);
  sprout.rotation.set(-0.15, -0.3, 0.25);
  sprout.scale.setScalar(0.65);

  const sproutStem = new THREE.Mesh(smallStemGeom, stemMaterial);
  sproutStem.position.y = 0.065;
  const sproutCap = new THREE.Mesh(smallCapGeom, capMaterial);
  sproutCap.position.y = 0.125;
  sprout.add(sproutStem, sproutCap);
  group.add(sprout);

  // Foliage-Gated Occlusion Highlights
  attachOcclusionOutline(cap, {
    color,
    rimColor: 0xf5e8ff,
    opacity: 0.94,
    emissiveIntensity: 2.8,
    rimStrength: 3.4,
    rimPower: 1.8,
    innerAlpha: 0.25,
  });
  attachOcclusionOutline(stem, {
    color,
    rimColor: 0xf5e8ff,
    opacity: 0.88,
    emissiveIntensity: 2.0,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.18,
  });
  attachOcclusionOutline(sideCap, {
    color,
    rimColor: 0xf5e8ff,
    opacity: 0.92,
    emissiveIntensity: 2.6,
    rimStrength: 3.2,
    rimPower: 1.8,
    innerAlpha: 0.22,
  });
  attachOcclusionOutline(sideStem, {
    color,
    rimColor: 0xf5e8ff,
    opacity: 0.85,
    emissiveIntensity: 1.8,
    rimStrength: 2.6,
    rimPower: 1.8,
    innerAlpha: 0.15,
  });
  attachOcclusionOutline(sproutCap, {
    color,
    rimColor: 0xf5e8ff,
    opacity: 0.90,
    emissiveIntensity: 2.4,
    rimStrength: 3.0,
    rimPower: 1.8,
    innerAlpha: 0.2,
  });

  group.userData.pulseMaterials = [capMaterial, gillsMaterial, spotMaterial];
  return group;
}

/**
 * Azure Glowcap (Blue Mushroom): A glowing tiered bioluminescent blue fungus cluster
 * rooted firmly on the ground with tall radiant umbrella glowcaps and glowing gills.
 */
function makeBlueMushroom(color) {
  const group = new THREE.Group();

  const capMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.95,
    roughness: 0.25,
    transparent: true,
    opacity: 0.94,
  });

  const stemMaterial = new THREE.MeshStandardMaterial({
    color: 0x88e2ff,
    emissive: 0x006699,
    emissiveIntensity: 0.4,
    roughness: 0.5,
  });

  const gillsMaterial = new THREE.MeshStandardMaterial({
    color: 0xbdf5ff,
    emissive: 0x00b4d8,
    emissiveIntensity: 0.8,
    roughness: 0.3,
  });

  // Base patch
  const basePatch = new THREE.Mesh(myceliumBaseGeom, groundBaseMaterial);
  basePatch.position.y = 0.01;
  group.add(basePatch);

  // Primary tall glowcap
  const mainGlowcap = new THREE.Group();

  const stem = new THREE.Mesh(glowcapTallStemGeom, stemMaterial);
  stem.position.y = 0.14;
  stem.rotation.z = -0.08;

  const dome = new THREE.Mesh(glowcapDomeGeom, capMaterial);
  dome.position.y = 0.28;
  dome.scale.set(1.2, 0.85, 1.2);

  const gills = new THREE.Mesh(glowcapGillsGeom, gillsMaterial);
  gills.position.y = 0.27;

  mainGlowcap.add(stem, gills, dome);
  group.add(mainGlowcap);

  // Medium side glowcap
  const sideCap = new THREE.Group();
  sideCap.position.set(0.13, 0, 0.07);
  sideCap.rotation.set(0.12, 0.3, -0.22);
  sideCap.scale.setScalar(0.72);

  const sideStem = new THREE.Mesh(glowcapTallStemGeom, stemMaterial);
  sideStem.position.y = 0.14;
  const sideDome = new THREE.Mesh(glowcapDomeGeom, capMaterial);
  sideDome.position.y = 0.28;
  sideCap.add(sideStem, sideDome);
  group.add(sideCap);

  // Sprouting glowcap
  const sprout = new THREE.Group();
  sprout.position.set(-0.12, 0, 0.06);
  sprout.rotation.set(-0.2, -0.4, 0.3);
  sprout.scale.setScalar(0.48);

  const sproutStem = new THREE.Mesh(glowcapTallStemGeom, stemMaterial);
  sproutStem.position.y = 0.14;
  const sproutDome = new THREE.Mesh(glowcapDomeGeom, capMaterial);
  sproutDome.position.y = 0.28;
  sprout.add(sproutStem, sproutDome);
  group.add(sprout);

  // Foliage-Gated Occlusion Highlights
  attachOcclusionOutline(dome, {
    color,
    rimColor: 0xc8f6ff,
    opacity: 0.95,
    emissiveIntensity: 3.0,
    rimStrength: 3.5,
    rimPower: 1.8,
    innerAlpha: 0.28,
  });
  attachOcclusionOutline(stem, {
    color,
    rimColor: 0xc8f6ff,
    opacity: 0.88,
    emissiveIntensity: 2.2,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.18,
  });
  attachOcclusionOutline(sideDome, {
    color,
    rimColor: 0xc8f6ff,
    opacity: 0.92,
    emissiveIntensity: 2.6,
    rimStrength: 3.2,
    rimPower: 1.8,
    innerAlpha: 0.24,
  });
  attachOcclusionOutline(sideStem, {
    color,
    rimColor: 0xc8f6ff,
    opacity: 0.85,
    emissiveIntensity: 2.0,
    rimStrength: 2.6,
    rimPower: 1.8,
    innerAlpha: 0.15,
  });
  attachOcclusionOutline(sproutDome, {
    color,
    rimColor: 0xc8f6ff,
    opacity: 0.90,
    emissiveIntensity: 2.4,
    rimStrength: 3.0,
    rimPower: 1.8,
    innerAlpha: 0.2,
  });

  group.userData.pulseMaterials = [capMaterial, gillsMaterial, stemMaterial];
  return group;
}

/**
 * Glow Spore: An organic bioluminescent alien nutrient pod cluster (matching UI art)
 * consisting of multiple translucent nutrient sacs with glowing internal nuclei and tendrils.
 */
function makeSpore(color) {
  const group = new THREE.Group();

  const membraneMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.65,
    transparent: true,
    opacity: 0.82,
    roughness: 0.25,
  });

  const nucleusMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: color,
    emissiveIntensity: 1.3,
    roughness: 0.15,
  });

  const tendrilMat = new THREE.MeshStandardMaterial({
    color: 0x1f4a3e,
    roughness: 0.8,
  });

  // Base root tendrils
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.3;
    const tendril = new THREE.Mesh(podTendrilGeom, tendrilMat);
    tendril.position.set(Math.cos(angle) * 0.08, 0.05, Math.sin(angle) * 0.08);
    tendril.rotation.set(Math.sin(angle) * 0.4, 0, -Math.cos(angle) * 0.4);
    group.add(tendril);
  }

  // Central main pod
  const mainPod = new THREE.Mesh(podMainGeom, membraneMat);
  mainPod.position.set(0, 0.13, 0);
  mainPod.scale.set(1.1, 1.25, 1.05);

  const mainNucleus = new THREE.Mesh(podNucleusGeom, nucleusMat);
  mainNucleus.position.set(0, 0.13, 0);
  group.add(mainPod, mainNucleus);

  // Foliage-Gated Occlusion Highlights for main pod & nucleus
  attachOcclusionOutline(mainPod, {
    color,
    rimColor: 0xddfbff,
    opacity: 0.94,
    emissiveIntensity: 2.8,
    rimStrength: 3.4,
    rimPower: 1.8,
    innerAlpha: 0.28,
  });
  attachOcclusionOutline(mainNucleus, {
    color: 0xffffff,
    rimColor: color,
    opacity: 0.95,
    emissiveIntensity: 3.2,
    rimStrength: 3.6,
    rimPower: 1.6,
    innerAlpha: 0.35,
  });

  // Secondary side pods
  const podPositions = [
    [0.1, 0.09, 0.05, 0.75],
    [-0.09, 0.08, -0.06, 0.65],
    [0.02, 0.18, -0.07, 0.6],
  ];

  podPositions.forEach(([px, py, pz, pScale]) => {
    const subPod = new THREE.Mesh(podSubGeom, membraneMat);
    subPod.position.set(px, py, pz);
    subPod.scale.setScalar(pScale);

    const subNucleus = new THREE.Mesh(podNucleusGeom, nucleusMat);
    subNucleus.position.set(px, py, pz);
    subNucleus.scale.setScalar(pScale * 0.7);

    group.add(subPod, subNucleus);

    attachOcclusionOutline(subPod, {
      color,
      rimColor: 0xddfbff,
      opacity: 0.90,
      emissiveIntensity: 2.5,
      rimStrength: 3.0,
      rimPower: 1.8,
      innerAlpha: 0.22,
    });
  });

  group.userData.pulseMaterials = [membraneMat, nucleusMat];
  return group;
}

/**
 * Toxic Spore: A caustic alien bio-pod covered in thorned warty acid pustules,
 * dripping tendrils, and noxious lime-green glowing vesicles.
 */
function makeToxicSpore(color) {
  const group = new THREE.Group();

  const causticMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.85,
    roughness: 0.35,
    flatShading: true,
  });

  const pustuleMat = new THREE.MeshStandardMaterial({
    color: 0xbbff55,
    emissive: 0x99ff22,
    emissiveIntensity: 1.1,
    roughness: 0.2,
  });

  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1a2e12,
    roughness: 0.9,
  });

  // Base anchoring root
  const root = new THREE.Mesh(podTendrilGeom, baseMat);
  root.position.y = 0.05;
  root.scale.set(1.5, 1.0, 1.5);
  group.add(root);

  // Central jagged caustic pod
  const mainPod = new THREE.Mesh(toxicPodMainGeom, causticMat);
  mainPod.position.set(0, 0.14, 0);
  mainPod.scale.set(1.1, 1.2, 1.0);
  group.add(mainPod);

  // Foliage-Gated Occlusion Highlight for main pod
  attachOcclusionOutline(mainPod, {
    color,
    rimColor: 0xe6ff99,
    opacity: 0.94,
    emissiveIntensity: 2.8,
    rimStrength: 3.4,
    rimPower: 1.8,
    innerAlpha: 0.26,
  });

  // Spikes protruding outward
  const spikeDirections = [
    [0, 0.24, 0, 0, 0, 0],
    [0.12, 0.17, 0.05, 0.3, 0, -0.6],
    [-0.11, 0.16, -0.06, -0.3, 0, 0.6],
    [0.05, 0.13, 0.12, 0.7, 0, 0.2],
    [-0.06, 0.12, -0.11, -0.7, 0, -0.2],
  ];

  spikeDirections.forEach(([sx, sy, sz, rx, ry, rz]) => {
    const spike = new THREE.Mesh(toxicSpikeGeom, causticMat);
    spike.position.set(sx, sy, sz);
    spike.rotation.set(rx, ry, rz);
    group.add(spike);

    attachOcclusionOutline(spike, {
      color,
      rimColor: 0xe6ff99,
      opacity: 0.90,
      emissiveIntensity: 2.4,
      rimStrength: 3.0,
      rimPower: 1.8,
      innerAlpha: 0.2,
    });
  });

  // Glowing toxic pustules
  const pustuleOffsets = [
    [0.07, 0.18, -0.05],
    [-0.06, 0.15, 0.07],
    [0.02, 0.09, 0.09],
  ];

  pustuleOffsets.forEach(([px, py, pz]) => {
    const pustule = new THREE.Mesh(toxicPustuleGeom, pustuleMat);
    pustule.position.set(px, py, pz);
    group.add(pustule);

    attachOcclusionOutline(pustule, {
      color: 0xbbff55,
      rimColor: 0xffffff,
      opacity: 0.95,
      emissiveIntensity: 3.0,
      rimStrength: 3.2,
      rimPower: 1.8,
      innerAlpha: 0.3,
    });
  });

  group.userData.pulseMaterials = [causticMat, pustuleMat];
  return group;
}

/**
 * Iron Ore: A heavy dark metallic rock boulder with embedded sharp crystalline
 * ore prisms and veins breaking out of the rock matrix.
 */
function makeIron() {
  const group = new THREE.Group();

  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x282a2e,
    roughness: 0.88,
    metalness: 0.35,
    flatShading: true,
  });

  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: 0x6fe3ff,
    emissive: 0x2fb8e0,
    emissiveIntensity: 0.85,
    metalness: 0.75,
    roughness: 0.2,
    flatShading: true,
  });

  // Main heavy boulder
  const rock = new THREE.Mesh(ironBoulderGeom, rockMaterial);
  rock.position.set(0, 0.14, 0);
  rock.rotation.set(0.3, 0.7, 0.2);
  rock.scale.set(1.15, 0.85, 1.1);

  // Sub rock facet
  const subRock = new THREE.Mesh(ironSubRockGeom, rockMaterial);
  subRock.position.set(-0.12, 0.08, 0.08);
  subRock.rotation.set(0.6, 0.2, 0.9);

  group.add(rock, subRock);

  // Foliage-Gated Occlusion Highlights for rock base
  attachOcclusionOutline(rock, {
    color: 0x3a3d42,
    rimColor: 0x8a9099,
    opacity: 0.85,
    emissiveIntensity: 1.8,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.15,
  });
  attachOcclusionOutline(subRock, {
    color: 0x3a3d42,
    rimColor: 0x8a9099,
    opacity: 0.85,
    emissiveIntensity: 1.8,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.15,
  });

  // Embedded crystalline ore facets bursting out of the boulder
  const crystalPlacements = [
    { pos: [0.11, 0.21, 0.06], rot: [0.4, 0.3, 0.8], scale: 1.2 },
    { pos: [-0.08, 0.22, -0.07], rot: [-0.6, 0.8, -0.3], scale: 1.0 },
    { pos: [0.15, 0.12, -0.09], rot: [0.8, -0.4, 1.1], scale: 0.85 },
    { pos: [-0.14, 0.14, 0.12], rot: [-0.5, 0.6, 0.4], scale: 0.9 },
    { pos: [0.03, 0.25, 0.04], rot: [0.1, 0.9, 0.2], scale: 0.7 },
  ];

  crystalPlacements.forEach(({ pos, rot, scale }) => {
    const crystal = new THREE.Mesh(oreCrystalGeom, crystalMaterial);
    crystal.position.set(...pos);
    crystal.rotation.set(...rot);
    crystal.scale.set(scale, scale * 1.3, scale);
    group.add(crystal);

    attachOcclusionOutline(crystal, {
      color: 0x6fe3ff,
      rimColor: 0xffffff,
      opacity: 0.96,
      emissiveIntensity: 3.2,
      rimStrength: 3.5,
      rimPower: 1.8,
      innerAlpha: 0.3,
    });
  });

  group.userData.pulseMaterials = [crystalMaterial];
  return group;
}

/**
 * DNA Bio-Vial: A sci-fi bio-containment vial featuring metallic top/bottom caps,
 * transparent glass containment chamber, and an internal glowing double-helix DNA
 * spiral with connected base-pair rungs that rotates continuously.
 */
function makeDna(color, type = 'rat_dna') {
  const group = new THREE.Group();

  const helixMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.3,
    roughness: 0.2,
  });

  const barMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: color,
    emissiveIntensity: 0.8,
    roughness: 0.3,
  });

  // Base and Top metallic caps
  const bottomCap = new THREE.Mesh(vialCapGeom, darkMetalMaterial);
  bottomCap.position.y = 0.03;

  const topCap = new THREE.Mesh(vialCapGeom, darkMetalMaterial);
  topCap.position.y = 0.31;

  const sealRingBottom = new THREE.Mesh(vialSealRingGeom, helixMaterial);
  sealRingBottom.position.y = 0.055;
  sealRingBottom.rotation.x = Math.PI / 2;

  const sealRingTop = new THREE.Mesh(vialSealRingGeom, helixMaterial);
  sealRingTop.position.y = 0.285;
  sealRingTop.rotation.x = Math.PI / 2;

  // Transparent glass cylinder
  const glass = new THREE.Mesh(vialGlassGeom, glassMaterial);
  glass.position.y = 0.17;

  group.add(bottomCap, topCap, sealRingBottom, sealRingTop, glass);

  // Type-specific vivid occlusion glow palette
  const outlineColors = {
    rat_dna: { color: 0xff2d9e, rim: 0xffd1ea },
    beetle_dna: { color: 0x5dffd6, rim: 0xe0fff8 },
    predator_dna: { color: 0xff2a6d, rim: 0xffd6e2 },
    apex_dna: { color: 0x9b35ff, rim: 0xecd8ff },
    rival_dna: { color: 0xff5522, rim: 0xffd9cc },
  };
  const dnaConfig = outlineColors[type] || { color, rim: 0xffffff };

  // Foliage-Gated Occlusion Highlights for vial casing
  attachOcclusionOutline(glass, {
    color: dnaConfig.color,
    rimColor: dnaConfig.rim,
    opacity: 0.92,
    emissiveIntensity: 2.6,
    rimStrength: 3.2,
    rimPower: 1.8,
    innerAlpha: 0.22,
  });

  attachOcclusionOutline(bottomCap, {
    color: 0x3a3e45,
    rimColor: dnaConfig.rim,
    opacity: 0.88,
    emissiveIntensity: 2.0,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.15,
  });
  attachOcclusionOutline(topCap, {
    color: 0x3a3e45,
    rimColor: dnaConfig.rim,
    opacity: 0.88,
    emissiveIntensity: 2.0,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.15,
  });

  attachOcclusionOutline(sealRingBottom, {
    color: dnaConfig.color,
    rimColor: 0xffffff,
    opacity: 0.94,
    emissiveIntensity: 2.8,
    rimStrength: 3.2,
    rimPower: 1.8,
    innerAlpha: 0.25,
  });
  attachOcclusionOutline(sealRingTop, {
    color: dnaConfig.color,
    rimColor: 0xffffff,
    opacity: 0.94,
    emissiveIntensity: 2.8,
    rimStrength: 3.2,
    rimPower: 1.8,
    innerAlpha: 0.25,
  });

  // --- Internal Double-Helix DNA Spiral ---
  const helixGroup = new THREE.Group();
  helixGroup.position.y = 0.17;

  const nodeCount = 9;
  const helixRadius = 0.042;
  const helixHeight = 0.20;

  for (let i = 0; i < nodeCount; i++) {
    const t = (i / (nodeCount - 1)) - 0.5;
    const y = t * helixHeight;
    const angle = t * Math.PI * 3.2;

    const x1 = Math.cos(angle) * helixRadius;
    const z1 = Math.sin(angle) * helixRadius;
    const x2 = -x1;
    const z2 = -z1;

    // Strand A Node
    const nodeA = new THREE.Mesh(helixNodeGeom, helixMaterial);
    nodeA.position.set(x1, y, z1);
    helixGroup.add(nodeA);

    // Strand B Node
    const nodeB = new THREE.Mesh(helixNodeGeom, helixMaterial);
    nodeB.position.set(x2, y, z2);
    helixGroup.add(nodeB);

    // Base-pair connecting crossbar
    const bar = new THREE.Mesh(helixBarGeom, barMaterial);
    bar.position.set(0, y, 0);
    bar.rotation.y = angle;
    bar.rotation.z = Math.PI / 2;
    helixGroup.add(bar);
  }

  group.add(helixGroup);

  // Type-specific casing decorations
  if (type === 'beetle_dna') {
    // Chitinous protective struts
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const strut = new THREE.Mesh(bioStrutGeom, darkMetalMaterial);
      strut.position.set(Math.cos(angle) * 0.085, 0.17, Math.sin(angle) * 0.085);
      group.add(strut);

      attachOcclusionOutline(strut, {
        color: dnaConfig.color,
        rimColor: dnaConfig.rim,
        opacity: 0.85,
        emissiveIntensity: 2.0,
        rimStrength: 2.6,
        rimPower: 1.8,
        innerAlpha: 0.15,
      });
    }
  } else if (type === 'predator_dna') {
    // Spiked predator biohazard casing
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const spike = new THREE.Mesh(toxicSpikeGeom, darkMetalMaterial);
      spike.position.set(Math.cos(angle) * 0.09, 0.31, Math.sin(angle) * 0.09);
      spike.rotation.set(0, 0, Math.PI);
      spike.scale.set(0.6, 0.7, 0.6);
      group.add(spike);

      attachOcclusionOutline(spike, {
        color: dnaConfig.color,
        rimColor: dnaConfig.rim,
        opacity: 0.88,
        emissiveIntensity: 2.2,
        rimStrength: 2.8,
        rimPower: 1.8,
        innerAlpha: 0.18,
      });
    }
  } else if (type === 'apex_dna') {
    // Ornate apex orbit ring and gold/obsidian accents
    const apexRing = new THREE.Mesh(orbitRingGeom, helixMaterial);
    apexRing.position.y = 0.17;
    apexRing.rotation.x = Math.PI / 3;
    group.add(apexRing);
    group.userData.apexRing = apexRing;

    attachOcclusionOutline(apexRing, {
      color: dnaConfig.color,
      rimColor: 0xffffff,
      opacity: 0.95,
      emissiveIntensity: 3.0,
      rimStrength: 3.4,
      rimPower: 1.8,
      innerAlpha: 0.28,
    });
  }

  group.userData.pulseMaterials = [helixMaterial, barMaterial];
  group.userData.dnaHelix = helixGroup;
  return group;
}

/**
 * Toxic Gland: An anatomical pulsating venom sac organ with lobed bladder,
 * biological duct neck, and vascular surface veins.
 */
function makeToxicGland(color) {
  const group = new THREE.Group();

  const membraneMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.85,
    transparent: true,
    opacity: 0.88,
    roughness: 0.3,
  });

  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xe070ff,
    emissive: 0xc820ff,
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });

  const ductMat = new THREE.MeshStandardMaterial({
    color: 0x3d144d,
    roughness: 0.75,
  });

  // Main pear-shaped venom bladder
  const bladder = new THREE.Mesh(glandBladderGeom, membraneMat);
  bladder.position.y = 0.14;
  bladder.scale.set(1.0, 1.35, 0.95);

  // Glowing venom core inside
  const venomCore = new THREE.Mesh(glandBladderGeom, coreMat);
  venomCore.position.y = 0.13;
  venomCore.scale.set(0.65, 0.85, 0.6);

  // Biological duct neck
  const neck = new THREE.Mesh(glandNeckGeom, ductMat);
  neck.position.y = 0.27;

  // Branching vascular venom ducts
  const duct1 = new THREE.Mesh(glandDuctGeom, ductMat);
  duct1.position.set(0.04, 0.25, 0.03);
  duct1.rotation.set(0.3, 0.5, 0.4);

  const duct2 = new THREE.Mesh(glandDuctGeom, ductMat);
  duct2.position.set(-0.04, 0.24, -0.02);
  duct2.rotation.set(-0.4, -0.6, -0.3);

  group.add(bladder, venomCore, neck, duct1, duct2);

  // Foliage-Gated Occlusion Highlights for venom gland & ducts
  attachOcclusionOutline(bladder, {
    color,
    rimColor: 0xf5d0ff,
    opacity: 0.94,
    emissiveIntensity: 2.8,
    rimStrength: 3.4,
    rimPower: 1.8,
    innerAlpha: 0.28,
  });

  attachOcclusionOutline(venomCore, {
    color: 0xe070ff,
    rimColor: 0xffffff,
    opacity: 0.95,
    emissiveIntensity: 3.2,
    rimStrength: 3.6,
    rimPower: 1.8,
    innerAlpha: 0.35,
  });

  attachOcclusionOutline(neck, {
    color: 0x5a1e73,
    rimColor: 0xf5d0ff,
    opacity: 0.88,
    emissiveIntensity: 2.2,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.18,
  });

  attachOcclusionOutline(duct1, {
    color: 0x5a1e73,
    rimColor: 0xf5d0ff,
    opacity: 0.88,
    emissiveIntensity: 2.2,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.18,
  });

  attachOcclusionOutline(duct2, {
    color: 0x5a1e73,
    rimColor: 0xf5d0ff,
    opacity: 0.88,
    emissiveIntensity: 2.2,
    rimStrength: 2.8,
    rimPower: 1.8,
    innerAlpha: 0.18,
  });

  group.userData.pulseMaterials = [membraneMat, coreMat];
  group.userData.bladder = bladder;
  return group;
}

/** Builds a resource's visual (a Group so multi-part models scale/rotate as one unit). */
export function createResourceMesh(type, color) {
  switch (type) {
    case 'spore':
      return makeSpore(color);
    case 'toxic_spore':
      return makeToxicSpore(color);
    case 'mushroom':
      return makeMushroom(color);
    case 'blue_mushroom':
      return makeBlueMushroom(color);
    case 'stone':
      return makeStone();
    case 'iron':
      return makeIron();
    case 'rat_dna':
      return makeDna(color, 'rat_dna');
    case 'beetle_dna':
      return makeDna(color, 'beetle_dna');
    case 'predator_dna':
      return makeDna(color, 'predator_dna');
    case 'apex_dna':
      return makeDna(color, 'apex_dna');
    case 'rival_dna':
      return makeDna(color, 'rival_dna');
    case 'toxic_gland':
      return makeToxicGland(color);
    default:
      throw new Error(`Unknown resource type: ${type}`);
  }
}
