import * as THREE from 'three';
import { attachOcclusionOutline } from './occlusionOutline.js?v=5.3';

// Shared Geometries for Precursor Human Genome Fragment
const crystalCoreGeom = new THREE.OctahedronGeometry(0.18, 0);
const innerHelixGeom = new THREE.TorusGeometry(0.11, 0.016, 6, 20);
const outerRunicRingGeom = new THREE.TorusGeometry(0.22, 0.012, 6, 24);
const particleGeometry = new THREE.OctahedronGeometry(0.028, 0);

/**
 * Human Genome Fragment: An ancient precursor relic featuring a warm luminous golden-white
 * crystal prism core, internal glowing cyan-white double helix energy strands, rotating
 * concentric runic halo rings, and orbiting golden energy shards.
 */
export function createGenomeFragmentMesh() {
  const group = new THREE.Group();

  // --- Luminous Crystal Core ---
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8e8,
    emissive: 0xffd574,
    emissiveIntensity: 1.6,
    roughness: 0.12,
    metalness: 0.15,
    flatShading: true,
  });
  const core = new THREE.Mesh(crystalCoreGeom, coreMaterial);
  core.scale.set(0.9, 1.4, 0.9);
  group.add(core);

  attachOcclusionOutline(core, {
    color: 0xffd574,
    rimColor: 0xffffff,
    opacity: 0.95,
    emissiveIntensity: 3.0,
    rimStrength: 3.4,
    rimPower: 1.8,
    innerAlpha: 0.3,
  });

  // --- Internal DNA Helix Strands ---
  const strandMaterial = new THREE.MeshStandardMaterial({
    color: 0xebfaff,
    emissive: 0x7fe3ff,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });

  const strandA = new THREE.Mesh(innerHelixGeom, strandMaterial);
  strandA.rotation.x = Math.PI / 2.3;
  const strandB = new THREE.Mesh(innerHelixGeom, strandMaterial);
  strandB.rotation.x = Math.PI / 2.3;
  strandB.rotation.z = Math.PI / 2;
  group.add(strandA, strandB);

  attachOcclusionOutline(strandA, {
    color: 0x7fe3ff,
    rimColor: 0xffffff,
    opacity: 0.9,
    emissiveIntensity: 2.6,
    rimStrength: 3.0,
    rimPower: 1.8,
    innerAlpha: 0.2,
  });
  attachOcclusionOutline(strandB, {
    color: 0x7fe3ff,
    rimColor: 0xffffff,
    opacity: 0.9,
    emissiveIntensity: 2.6,
    rimStrength: 3.0,
    rimPower: 1.8,
    innerAlpha: 0.2,
  });

  // --- Concentric Outer Runic Ring ---
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff0cc,
    emissive: 0xffc44d,
    emissiveIntensity: 1.2,
    roughness: 0.25,
  });
  const outerRing = new THREE.Mesh(outerRunicRingGeom, ringMaterial);
  outerRing.rotation.x = Math.PI / 3;
  group.add(outerRing);

  attachOcclusionOutline(outerRing, {
    color: 0xffd574,
    rimColor: 0xffffff,
    opacity: 0.95,
    emissiveIntensity: 2.8,
    rimStrength: 3.2,
    rimPower: 1.8,
    innerAlpha: 0.25,
  });

  // --- Orbiting Golden Energy Shards ---
  const particleMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff2cc,
    emissive: 0xffda85,
    emissiveIntensity: 1.5,
    roughness: 0.15,
  });

  const orbiters = [];
  for (let i = 0; i < 3; i++) {
    const orbiter = new THREE.Mesh(particleGeometry, particleMaterial);
    group.add(orbiter);
    orbiters.push(orbiter);
    attachOcclusionOutline(orbiter, {
      color: 0xffd574,
      rimColor: 0xffffff,
      opacity: 0.9,
      emissiveIntensity: 2.6,
      rimStrength: 2.8,
      rimPower: 1.8,
      innerAlpha: 0.2,
    });
  }

  group.userData.core = core;
  group.userData.coreMaterial = coreMaterial;
  group.userData.strandMaterial = strandMaterial;
  group.userData.ringMaterial = ringMaterial;
  group.userData.orbiters = orbiters;
  group.userData.particleMaterial = particleMaterial;

  return group;
}

