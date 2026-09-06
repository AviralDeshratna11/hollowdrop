import * as THREE from 'three';
import { attachOcclusionOutline } from './occlusionOutline.js?v=5.3';

// Actual low-poly models: beveled mineral clusters, umbrella caps and curved
// stalks. Shared geometry keeps the many world/inventory copies inexpensive.
const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
const spotGeometry = new THREE.SphereGeometry(1, 8, 6);
const stemGeometries = new Map();
const shellGeometry = new THREE.SphereGeometry(1, 10, 7, 0, Math.PI * 1.55, 0, Math.PI * 0.8);
const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x101d20, side: THREE.BackSide });
const capGeometry = new THREE.LatheGeometry([
  new THREE.Vector2(0, -0.035), new THREE.Vector2(0.15, -0.025),
  new THREE.Vector2(0.29, 0), new THREE.Vector2(0.30, 0.04),
  new THREE.Vector2(0.26, 0.14), new THREE.Vector2(0.18, 0.23),
  new THREE.Vector2(0.07, 0.275), new THREE.Vector2(0, 0.28),
], 20);

function surface(color, emissive = 0x000000, glow = 0) {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: glow, roughness: 0.64 });
}

export function addPaintedOutline(mesh, scale = 1.045) {
  const outline = new THREE.Mesh(mesh.geometry, outlineMaterial.clone());
  outline.scale.setScalar(scale);
  outline.userData.isPaintedOutline = true;
  mesh.add(outline);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}

function rock(group, material, position, scale, index) {
  const mesh = new THREE.Mesh(rockGeometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(index * 0.37, index * 1.7, index * 0.21);
  addPaintedOutline(mesh, 1.055);
  group.add(mesh);
  return mesh;
}

export function makeReferenceStone(ore = false) {
  const group = new THREE.Group();
  const base = surface(ore ? 0x375b67 : 0x7e9091);
  const light = surface(ore ? 0x7bcddd : 0xb4c0b7, ore ? 0x167f9a : 0, ore ? 0.18 : 0);
  base.flatShading = light.flatShading = true;
  const placements = [
    [[-0.04, 0.23, -0.04], [0.24, 0.29, 0.22]],
    [[0.22, 0.12, 0.03], [0.19, 0.17, 0.17]],
    [[-0.22, 0.10, 0.10], [0.14, 0.12, 0.17]],
    [[0.02, 0.08, 0.23], [0.18, 0.09, 0.12]],
    [[-0.32, 0.045, -0.10], [0.07, 0.06, 0.08]],
    [[0.31, 0.045, 0.22], [0.07, 0.06, 0.07]],
    [[-0.18, 0.035, 0.31], [0.06, 0.045, 0.065]],
  ];
  placements.forEach(([p, s], i) => rock(group, i % 3 === 0 ? light : base, p, s, i));
  if (ore) {
    // Broad turquoise fractured faces, instead of shiny metal spikes.
    rock(group, light, [0.12, 0.30, -0.09], [0.16, 0.21, 0.14], 9);
    rock(group, light, [-0.24, 0.15, -0.12], [0.09, 0.13, 0.09], 11);
    group.userData.pulseMaterials = [light];
  }
  attachOcclusionOutline(group.children[0], { color: ore ? 0x60dfff : 0x9ba9ac, opacity: 0.85 });
  return group;
}

export function makeReferenceMushroom(blue = false) {
  const group = new THREE.Group();
  const capMat = surface(blue ? 0x21bfe8 : 0xb55bdd, blue ? 0x078bc1 : 0x7625b3, 0.45);
  const stemMat = surface(blue ? 0x72dcdf : 0x9c83c5, blue ? 0x178b9e : 0x58267e, 0.15);
  const spotMat = surface(blue ? 0x8deffc : 0xe6a1f6, blue ? 0x41cce9 : 0xb24cdb, 0.35);
  const colonies = blue
    ? [[0.04, -0.07, 1, -0.08], [-0.32, 0.04, 0.64, 0.14], [0.28, 0.21, 0.50, -0.12], [-0.05, 0.30, 0.38, 0.08]]
    : [[0, -0.06, 0.83, -0.14], [-0.24, 0.06, 0.58, 0.12], [0.22, 0.15, 0.48, -0.12]];
  for (const [x, z, scale, lean] of colonies) {
    const mushroom = new THREE.Group();
    mushroom.position.set(x, 0, z);
    mushroom.scale.setScalar(scale);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(lean * 0.3, 0.20, 0), new THREE.Vector3(lean, 0.43, 0),
    ]);
    if (!stemGeometries.has(lean)) stemGeometries.set(lean, new THREE.TubeGeometry(curve, 6, 0.034, 7, false));
    const stem = new THREE.Mesh(stemGeometries.get(lean), stemMat);
    addPaintedOutline(stem, 1.065);
    mushroom.add(stem);
    const cap = new THREE.Mesh(capGeometry, capMat);
    cap.position.set(lean, 0.43, 0);
    cap.scale.set(1, blue ? 0.85 : 1.1, 1);
    addPaintedOutline(cap, 1.035);
    mushroom.add(cap);
    // Spots follow the dome surface; they do not hover above it.
    for (const [angle, radius, size] of [[0.4, 0.12, 0.038], [2.7, 0.17, 0.033], [4.2, 0.08, 0.045], [5.3, 0.23, 0.022]]) {
      const spot = new THREE.Mesh(spotGeometry, spotMat);
      spot.position.set(Math.cos(angle) * radius, 0.28 * Math.sqrt(1 - (radius / 0.30) ** 2), Math.sin(angle) * radius);
      spot.scale.set(size, 0.013, size);
      cap.add(spot);
    }
    group.add(mushroom);
    attachOcclusionOutline(cap, { color: blue ? 0x28cafa : 0xc16eee, opacity: 0.9 });
  }
  group.userData.pulseMaterials = [capMat];
  return group;
}

export function makeReferenceSpore() {
  const group = new THREE.Group();
  const husk = surface(0xa28352);
  const inside = surface(0xd1bd86);
  // Split, folded organic husks like the warm brown scraps in the reference.
  for (let i = 0; i < 3; i++) {
    const shell = new THREE.Mesh(shellGeometry, i === 1 ? inside : husk);
    shell.position.set((i - 1) * 0.16, 0.075, i % 2 * 0.12);
    shell.scale.set(0.19, 0.08, 0.12);
    shell.rotation.set(0.25, i * 2.2, 0.25);
    shell.material.side = THREE.DoubleSide;
    group.add(shell);
  }
  const seed = new THREE.Mesh(spotGeometry, surface(0xc6d8a0, 0x557d52, 0.15));
  seed.position.set(0, 0.10, 0.04);
  seed.scale.set(0.065, 0.08, 0.05);
  group.add(seed);
  return group;
}
