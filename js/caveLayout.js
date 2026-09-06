import * as THREE from 'three';
import { GROUND_SIZE } from './terrain.js?v=5.4';

// An authored surface layout, independent of the shared physical height field.
// Paths thread between moss islands and connect the existing encounter spaces.
const routes = [
  [[-34, 37], [-28, 23], [-20, 12], [-12, 6], [0, 0], [8, -8], [17, -17], [25, -27], [34, -37]],
  [[-38, -28], [-28, -23], [-18, -15], [-10, -9], [-5, -4], [0, 0], [3, 3], [10, 8], [23, 12], [31, 23], [33, 37]],
  [[-34, 4], [-25, 0], [-20, -8], [-18, -15], [-11, -25], [2, -30], [17, -17], [31, -13], [38, -4]],
  [[-20, 12], [-21, 23], [-16, 34], [-3, 38], [16, 36], [26, 28], [31, 23]],
  [[10, 8], [16, 1], [17, -8], [17, -17]],
];
const segments = routes.flatMap((points) => {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const samples = curve.getPoints(points.length * 5);
  return samples.slice(1).map((b, i) => {
    const a = samples[i], dx = b.x - a.x, dz = b.z - a.z;
    return { x: a.x, z: a.z, dx, dz, invLength: 1 / (dx * dx + dz * dz) };
  });
});

export const CAVE_CLEARINGS = [
  { x: 26, z: -25, rx: 7.8, rz: 9.5, color: 'purple' },
  { x: -25, z: -12, rx: 5.5, rz: 7.2, color: 'cyan' },
  { x: 2, z: -21, rx: 6.5, rz: 5.2, color: 'cyan' },
  { x: 26, z: 1, rx: 5.8, rz: 6.8, color: 'cyan' },
  { x: -27, z: 28, rx: 5.2, rz: 7.0, color: 'cyan' },
  { x: 7, z: 38, rx: 7.5, rz: 4.0, color: 'cyan' },
];
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export function sampleCaveLayout(x, z) {
  // Warped banks avoid ruler-straight edges and regularly spaced circles.
  const wx = x + Math.sin(z * 0.63 + x * 0.17) * 0.28;
  const wz = z + Math.cos(x * 0.51 - z * 0.23) * 0.3;
  let distance2 = Infinity;
  for (const s of segments) {
    const t = clamp(((wx - s.x) * s.dx + (wz - s.z) * s.dz) * s.invLength);
    distance2 = Math.min(distance2, (wx - s.x - t * s.dx) ** 2 + (wz - s.z - t * s.dz) ** 2);
  }
  const distance = Math.sqrt(distance2);
  const noise = Math.sin(x * 0.71 + Math.sin(z * 0.38)) * Math.cos(z * 0.57 - x * 0.19);
  const width = 1.45 + 0.28 * Math.sin(x * 0.18 + z * 0.21);
  let path = 1 - smooth(width - 0.4, width + 0.7, distance + noise * 0.22);
  let cyan = 0, purple = 0;
  for (const c of CAVE_CLEARINGS) {
    const r = Math.hypot((wx - c.x) / c.rx, (wz - c.z) / c.rz);
    const weight = 1 - smooth(0.48, 1.08, r + noise * 0.04);
    if (c.color === 'purple') purple = Math.max(purple, weight);
    else cyan = Math.max(cyan, weight);
  }
  path *= 1 - Math.max(cyan, purple) * 0.8;
  const moss = (1 - path) * smooth(1.8, 3.4, distance + noise * 0.7)
    * (0.58 + 0.42 * smooth(-0.55, 0.65, Math.sin(x * 0.24 + 1) * Math.cos(z * 0.29)))
    * (1 - Math.max(cyan, purple) * 0.88);
  return { path, moss, cyan, purple, distance };
}

let layoutTexture;
export function getCaveLayoutTexture() {
  if (layoutTexture) return layoutTexture;
  const size = 512, data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const x = ((col + 0.5) / size - 0.5) * GROUND_SIZE;
    const z = (0.5 - (row + 0.5) / size) * GROUND_SIZE;
    const s = sampleCaveLayout(x, z), i = (row * size + col) * 4;
    data[i] = Math.round(s.path * 255);
    data[i + 1] = Math.round(s.moss * 255);
    data[i + 2] = Math.round(s.cyan * 255);
    data[i + 3] = Math.round(s.purple * 255);
  }
  layoutTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  layoutTexture.minFilter = layoutTexture.magFilter = THREE.LinearFilter;
  layoutTexture.needsUpdate = true;
  return layoutTexture;
}
