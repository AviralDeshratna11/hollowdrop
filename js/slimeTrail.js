import * as THREE from 'three';
import { getTerrainHeight, isPointInLake, LAKE_CONFIG } from './terrain.js?v=5.4';

const CAPACITY = 96, GRID = 4, VERTICES = GRID * GRID, SPACING = 0.14;

/** A bounded field of wet, overlapping footprints, conformed at every vertex. */
class SplatField {
  constructor(scene) {
    this.splats = [];
    this.last = null;
    const geometry = this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(CAPACITY * VERTICES * 3);
    this.ages = new Float32Array(CAPACITY * VERTICES);
    const uvs = new Float32Array(CAPACITY * VERTICES * 2), indices = [];
    for (let s = 0; s < CAPACITY; s++) {
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        const v = s * VERTICES + y * GRID + x;
        uvs[v * 2] = x / (GRID - 1); uvs[v * 2 + 1] = y / (GRID - 1);
        if (x < GRID - 1 && y < GRID - 1) indices.push(v, v + GRID, v + 1, v + 1, v + GRID, v + GRID + 1);
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('age', new THREE.BufferAttribute(this.ages, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      vertexShader: `attribute float age; varying vec2 vUv; varying float vAge;
        void main(){ vUv=uv; vAge=age; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; varying float vAge;
        void main(){
          vec2 p=(vUv-.5)*2.;
          float angle=atan(p.y,p.x);
          float r=length(p)+sin(angle*5.+.7)*.065+sin(angle*3.)*.055;
          float edge=1.-smoothstep(.69,.94,r);
          float fade=1.-smoothstep(.12,1.,vAge);
          float rim=exp(-pow((r-.70)*17.,2.));
          float shine=exp(-length((p-vec2(-.24,.26))*vec2(7.,15.)));
          vec3 color=mix(vec3(.012,.075,.016),vec3(.09,.25,.03),edge*.62);
          color+=vec3(.43,.66,.26)*(rim*.10+shine*.35)*fade;
          float alpha=edge*fade*.17;
          if(alpha<.003)discard;
          gl_FragColor=vec4(color,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.mesh.name = 'Dissolving slime residue';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  deposit(x, z, angle) {
    if (isPointInLake(x, z) && LAKE_CONFIG.waterLevel > getTerrainHeight(x, z) + 0.05) return;
    const width = .32 + Math.random() * .07, length = .40 + Math.random() * .06;
    const points = [];
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const dx = (i / (GRID - 1) * 2 - 1) * width;
      const dz = (j / (GRID - 1) * 2 - 1) * length;
      const px = x + dx * Math.cos(angle) - dz * Math.sin(angle);
      const pz = z + dx * Math.sin(angle) + dz * Math.cos(angle);
      points.push(px, getTerrainHeight(px, pz) + .018, pz);
    }
    if (this.splats.length === CAPACITY) this.splats.shift();
    this.splats.push({ points, age: 0, lifetime: .5 + Math.random() * .3 });
  }

  update(dt, pos, vel, active) {
    for (const s of this.splats) s.age += dt;
    this.splats = this.splats.filter(s => s.age < s.lifetime);
    if (active && pos) {
      if (!this.last) this.last = { x: pos.x, z: pos.z };
      const dx = pos.x - this.last.x, dz = pos.z - this.last.z, distance = Math.hypot(dx, dz);
      if (distance > 3) this.last = { x: pos.x, z: pos.z }; // respawn/teleport never draws a line
      else if (distance >= SPACING && (!vel || vel.lengthSq() > .01)) {
        const steps = Math.floor(distance / SPACING), angle = Math.atan2(-dx, dz);
        for (let i = 1; i <= steps; i++) {
          const t = i * SPACING / distance;
          this.deposit(this.last.x + dx * t, this.last.z + dz * t, angle);
        }
        this.last.x += dx * steps * SPACING / distance;
        this.last.z += dz * steps * SPACING / distance;
      }
    } else this.last = null;
    this.splats.forEach((s, i) => {
      this.positions.set(s.points, i * VERTICES * 3);
      this.ages.fill(s.age / s.lifetime, i * VERTICES, (i + 1) * VERTICES);
    });
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.age.needsUpdate = true;
    this.geometry.setDrawRange(0, this.splats.length * (GRID - 1) ** 2 * 6);
  }

  clear() { this.splats.length = 0; this.last = null; this.geometry.setDrawRange(0, 0); }
}

export class SlimeTrailSystem {
  constructor(scene) { this.scene = scene; this.fields = new Map(); }
  update(dt, pos, vel, active = true, id = 'player') {
    if (!this.fields.has(id)) {
      if (!active) return;
      this.fields.set(id, new SplatField(this.scene));
    }
    this.fields.get(id).update(dt, pos, vel, active);
  }
  clear() { for (const field of this.fields.values()) field.clear(); }
}
