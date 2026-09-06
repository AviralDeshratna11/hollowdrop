import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js?v=5.4';
import { addPaintedOutline } from './referenceResourceModels.js';
import { assetLoadingManager } from './loadingManager.js?v=5.3';

function barkTexture(bleached = false) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = bleached ? '#c8c5b2' : '#84735b'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 36; i++) {
    ctx.beginPath();
    for (let y = 0; y <= 256; y += 4) {
      const x = i * 7.4 + Math.sin(y * .035 + i * 2.1) * 3 + Math.sin(y * .08 + i) * 1.3;
      if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = bleached ? (i % 3 ? '#b7b4a2' : '#dfdccb') : (i % 3 ? '#6f624f' : '#a8997e');
    ctx.lineWidth = i % 3 ? 2 : 1; ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.center.set(.5, .5); texture.rotation = Math.PI / 2;
  return texture;
}

export const LANDMARK_SITES = [
  { name: 'The Moss Gate', x: -6.5, z: -3.8, radius: 3.2, kind: 'gate' },
  { name: 'Rootbound Hollow', x: 7, z: -5, radius: 3.3, kind: 'roots' },
  { name: 'The Sleeping Colossus', x: -7, z: 6.5, radius: 3.0, kind: 'bones' },
  { name: 'Azure Wellspring', x: 2, z: -21, radius: 3.0, kind: 'spring' },
  { name: 'Violet Reliquary', x: 26, z: -25, radius: 2.8, kind: 'relic' },
];

/** Hand-built silhouettes anchored to the same ground used by movement. */
export function createCaveLandmarks(scene, collisionSystem) {
  const groups = [];
  const slate = new THREE.TextureLoader(assetLoadingManager).load('assets/textures/cave-floor-painted.png');
  slate.colorSpace = THREE.SRGBColorSpace; slate.wrapS = slate.wrapT = THREE.RepeatWrapping;
  slate.anisotropy = 8;
  const stone = new THREE.MeshStandardMaterial({ map: slate, color: 0xa8b8ac, roughness: .88, flatShading: true });
  stone.color.setRGB(2.0, 2.1, 1.9);
  const dark = new THREE.MeshStandardMaterial({ color: 0x293d38, roughness: .96 });
  const moss = new THREE.MeshStandardMaterial({ map: slate, color: 0x62843c, roughness: 1 });
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), color: 0xb6a181, roughness: .94 });
  const bone = new THREE.MeshStandardMaterial({ map: barkTexture(true), color: 0xeee6cc, roughness: .86 });
  const crystal = new THREE.MeshStandardMaterial({ color: 0x6ccbc9, emissive: 0x126c72, emissiveIntensity: .45, roughness: .28, flatShading: true });
  const violet = new THREE.MeshStandardMaterial({ color: 0x867399, emissive: 0x5e238e, emissiveIntensity: .22, roughness: .5, flatShading: true });
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const add = (g, geometry, material, x, y, z, scale = [1, 1, 1], outline = false) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.scale.set(...scale);
    mesh.castShadow = mesh.receiveShadow = true;
    if (outline) addPaintedOutline(mesh, 1.025);
    g.add(mesh); return mesh;
  };
  const tube = (g, points, radius, material) => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const geometry = new THREE.TubeGeometry(curve, 20, radius, 7, false);
    const vertices = geometry.attributes.position, center = new THREE.Vector3();
    for (let ring = 0; ring <= 20; ring++) {
      curve.getPointAt(ring / 20, center);
      const taper = .18 + .82 * Math.pow(Math.sin(ring / 20 * Math.PI), .38);
      for (let j = 0; j <= 7; j++) {
        const i = ring * 8 + j;
        vertices.setXYZ(i, center.x + (vertices.getX(i) - center.x) * taper,
          center.y + (vertices.getY(i) - center.y) * taper, center.z + (vertices.getZ(i) - center.z) * taper);
      }
    }
    geometry.computeVertexNormals();
    return add(g, geometry, material, 0, 0, 0);
  };
  for (const site of LANDMARK_SITES) {
    const group = new THREE.Group(); group.name = site.name;
    group.position.set(site.x, getTerrainHeight(site.x, site.z), site.z);
    scene.add(group); groups.push(group);
    const floor = (x, z) => getTerrainHeight(site.x + x, site.z + z) - group.position.y;
    const solid = (x, z, radius) => collisionSystem.addStatic(site.x + x, site.z + z, radius);
    if (site.kind === 'gate') {
      // Two ancient stacked piers; the 2.6m central passage stays open.
      for (const side of [-1, 1]) {
        const x = side * 1.9, y = floor(x, 0);
        solid(x, 0, .62);
        for (let j = 0; j < 4; j++) {
          const block = add(group, rockGeometry, stone, x + side * j * .025, y + .35 + j * .58, 0, [.68 - j * .045, .43, .66], true);
          block.rotation.y = j * .57;
        }
        add(group, rockGeometry, moss, x, y + 2.36, 0, [.64, .09, .64]);
      }
      for (let i = 0; i < 9; i++) {
        const theta = i / 8 * Math.PI;
        const block = add(group, rockGeometry, stone, Math.cos(theta) * 1.85, 2.25 + Math.sin(theta) * .90, 0, [.46, .40, .56], true);
        block.rotation.z = theta;
      }
      for (let i = 0; i < 7; i++) {
        const x = -1.45 + i * .46;
        tube(group, [[x, 3.05, -.14], [x + .14, 2.6, -.2], [x - .09, 2.25 - (i % 3) * .15, -.12]], .028, moss);
      }
    } else if (site.kind === 'roots') {
      // Split trunk and exposed roots create a sheltered hollow with open approaches.
      for (const side of [-1, 1]) {
        solid(side * 1.5, -.5, .55);
        tube(group, [[side * 2.8, floor(side * 2.8, .9), .9], [side * 1.7, .5, .3], [side * 1.4, 1.8, -.5], [side * .9, 2.65, -.8]], .29, bark);
        tube(group, [[side * 1.4, 1.2, -.5], [side * 2, .25, -1.5], [side * 2.8, floor(side * 2.8, -2), -2]], .16, bark);
        tube(group, [[side * 1.5, .55, 0], [side * .9, .10, 1.0], [side * .35, floor(side * .35, 1.9) + .025, 1.9]], .10, moss);
        tube(group, [[side * 1.45, 1.4, -.5], [side * 2.0, 1.95, -.6], [side * 2.5, 2.15, -.8]], .11, bark);
        for (let j = 0; j < 5; j++) {
          const x = side * (1.2 + j * .26), z = .5 + j * .23;
          add(group, rockGeometry, moss, x, floor(x, z) + .08, z, [.25, .13, .22]);
        }
      }
      add(group, rockGeometry, dark, 0, floor(0, -1) + .09, -1, [1.1, .13, .8]);
    } else if (site.kind === 'bones') {
      for (let i = 0; i < 5; i++) {
        const z = (i - 2) * .65, y = floor(0, z);
        add(group, rockGeometry, bone, 0, y + .13, z, [.22, .19, .26]);
        for (const side of [-1, 1]) {
          tube(group, [[side * .15, y + .12, z], [side * .8, y + .7, z -.12], [side * 1.45, y + .42, z -.16], [side * 1.65, floor(side * 1.65, z), z]], .085, bone);
        }
      }
      const skull = add(group, rockGeometry, bone, 0, floor(0, -2) + .34, -2, [.61, .43, .68], true);
      skull.rotation.x = -.24; solid(0, -2, .48);
      for (const side of [-1, 1]) add(group, rockGeometry, dark, side * .32, floor(0, -2) + .52, -2.42, [.17, .15, .06]);
    } else {
      const isSpring = site.kind === 'spring', mat = isSpring ? crystal : violet;
      for (let i = 0; i < 11; i++) {
        const theta = i / 11 * Math.PI * 2, radius = 1.9;
        const x = Math.cos(theta) * radius, z = Math.sin(theta) * radius;
        // Leave the front open: this is an accessible alcove, not a sealed wall.
        if (z > .85) continue;
        const height = .5 + (i % 4) * .27;
        add(group, new THREE.CylinderGeometry(.25, .38, height, 6), stone, x, floor(x, z) + height / 2, z);
        solid(x, z, .3);
      }
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * .42, z = -.8 - (i % 2) * .3, height = .65 + (i % 3) * .4;
        const shard = add(group, new THREE.CylinderGeometry(0, .22, height, 5), mat, x, floor(x, z) + height / 2, z, [1, 1, 1], true);
        shard.rotation.z = (i - 2) * -.12;
      }
      if (isSpring) {
        const pool = add(group, new THREE.CircleGeometry(1.35, 40), new THREE.MeshStandardMaterial({ color: 0x164e50, emissive: 0x08777a, emissiveIntensity: .25, roughness: .16, metalness: .3 }), 0, .03, 0);
        pool.rotation.x = -Math.PI / 2;
        const pos = pool.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setZ(i, floor(pos.getX(i), -pos.getY(i)));
        pool.geometry.computeVertexNormals();
      } else {
        add(group, new THREE.CylinderGeometry(.75, .95, .22, 8), dark, 0, floor(0, 0) + .11, 0);
        const ring = add(group, new THREE.TorusGeometry(.55, .018, 5, 32), mat, 0, floor(0, 0) + .24, 0);
        ring.rotation.x = -Math.PI / 2;
      }
    }
  }
  return groups;
}
