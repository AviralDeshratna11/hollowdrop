import * as THREE from 'three';
import { getTerrainHeight, isPointInLake, LAKE_CONFIG } from './terrain.js?v=5.4';

const MAX_SPLATS      = 140;
const SPLAT_MIN_DIST  = 0.12;
const SPLAT_MIN_SPEED = 0.05;
const LT_MIN = 0.7;
const LT_MAX = 1.4;
const SPLAT_SIZE = 0.30;

class SplatField {
  constructor(scene) {
    this.scene  = scene;
    this.splats = [];
    this._lastX = null;
    this._lastZ = null;
    this._logT  = 0;

    const maxV = MAX_SPLATS * 4;
    const maxI = MAX_SPLATS * 6;

    this.positions = new Float32Array(maxV * 3);
    this.uvs       = new Float32Array(maxV * 2);
    this.colors    = new Float32Array(maxV * 4); // RGBA per vertex
    this.indices   = new Uint16Array(maxI);

    for (let i = 0; i < MAX_SPLATS; i++) {
      const b = i * 6, v = i * 4;
      this.indices[b]   = v;   this.indices[b+1] = v+1; this.indices[b+2] = v+2;
      this.indices[b+3] = v;   this.indices[b+4] = v+2; this.indices[b+5] = v+3;
    }

    const geo = new THREE.BufferGeometry();
    this.posAttr   = new THREE.BufferAttribute(this.positions, 3);
    this.uvAttr    = new THREE.BufferAttribute(this.uvs,       2);
    this.colorAttr = new THREE.BufferAttribute(this.colors,    4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);

    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('uv',       this.uvAttr);
    geo.setAttribute('color',    this.colorAttr);
    geo.setIndex(new THREE.BufferAttribute(this.indices, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;

    // Varied 10%-20% opacity and shifted organic green tones with hardware Stencil Gating:
    // When multiple squares overlap, the stencil buffer ensures each screen pixel
    // is blended only ONCE, preventing opacity buildup / stacking hotspots!
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -3.0,

      // Stencil bit 1 (0x02) - isolates from tree foliage which uses bit 0 (0x01)
      stencilWrite: true,
      stencilWriteMask: 0x02,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilRef: 0x02,
      stencilFuncMask: 0x02,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder   = 1;
    scene.add(this.mesh);
  }

  update(dt, pos, vel, isActive) {
    if (dt <= 0) return;
    this._logT += dt;

    for (let i = this.splats.length - 1; i >= 0; i--) {
      this.splats[i].age += dt;
      if (this.splats[i].age >= this.splats[i].lifetime) this.splats.splice(i, 1);
    }

    if (isActive && pos) {
      const px = pos.x, pz = pos.z;
      const gy = getTerrainHeight(px, pz);
      const inWater = isPointInLake(px, pz) && (LAKE_CONFIG.waterLevel - gy) > 0.05;

      if (inWater) {
        // Slime is in water — turn trail off
        this._lastX = null;
        this._lastZ = null;
      } else {
        if (this._lastX === null) { this._lastX = px; this._lastZ = pz; }
        const dx = px - this._lastX, dz = pz - this._lastZ;
        const dist = Math.sqrt(dx*dx + dz*dz);
        const spd  = vel ? vel.length() : dist / Math.max(dt, 0.001);

        if (dist > 5.0) {
          this._lastX = px; this._lastZ = pz;
        } else if (dist >= SPLAT_MIN_DIST && spd >= SPLAT_MIN_SPEED) {
          if (this.splats.length < MAX_SPLATS) {
            // Varied square sizes: tiny droplets up to larger slime residue patches
            const sizeMult = Math.random() < 0.35 
              ? (0.35 + Math.random() * 0.30)  // small drops (~0.10 - 0.19)
              : Math.random() < 0.75 
                ? (0.75 + Math.random() * 0.40) // medium patches (~0.22 - 0.35)
                : (1.20 + Math.random() * 0.50); // large puddles (~0.36 - 0.51)
            const hw = SPLAT_SIZE * sizeMult;

            // Shift colors slightly around the base green (#00b230 -> 0, 0.70, 0.19)
            const colorVariant = Math.random();
            let r, g, b;
            if (colorVariant < 0.35) {
              // Slightly warmer lime-tinted green
              r = 0.04 + Math.random() * 0.06;
              g = 0.68 + Math.random() * 0.08;
              b = 0.12 + Math.random() * 0.05;
            } else if (colorVariant < 0.70) {
              // Deeper moss/forest green
              r = 0.00 + Math.random() * 0.02;
              g = 0.56 + Math.random() * 0.08;
              b = 0.14 + Math.random() * 0.05;
            } else {
              // Cooler emerald/mint tint
              r = 0.00 + Math.random() * 0.02;
              g = 0.65 + Math.random() * 0.08;
              b = 0.20 + Math.random() * 0.08;
            }

            // Opacity varied between 20% and 30% (0.20 to 0.30)
            const baseAlpha = 0.20 + Math.random() * 0.10;

            this.splats.push({
              x: px, z: pz, y: gy + 0.04,
              age: 0,
              lifetime: LT_MIN + Math.random() * (LT_MAX - LT_MIN),
              hw: hw,
              rot: Math.random() * Math.PI * 2,
              r: r, g: g, b: b,
              baseAlpha: baseAlpha,
            });
          }
          this._lastX = px; this._lastZ = pz;
        }
      }
    } else {
      this._lastX = null; this._lastZ = null;
    }

    const count = this.splats.length;
    if (count === 0) { this.geo.setDrawRange(0, 0); return; }

    let pi = 0, ui = 0, ci = 0;
    for (let i = 0; i < count; i++) {
      const s = this.splats[i];
      const prg = Math.min(s.age / s.lifetime, 1.0);
      const hw = s.hw;
      const cs = Math.cos(s.rot), sn = Math.sin(s.rot);
      const ax = cs * hw, az = sn * hw, bx = -sn * hw, bz = cs * hw;

      this.positions[pi]    = s.x - ax - bx; this.positions[pi+1]  = s.y; this.positions[pi+2]  = s.z - az - bz;
      this.positions[pi+3]  = s.x + ax - bx; this.positions[pi+4]  = s.y; this.positions[pi+5]  = s.z + az - bz;
      this.positions[pi+6]  = s.x + ax + bx; this.positions[pi+7]  = s.y; this.positions[pi+8]  = s.z + az + bz;
      this.positions[pi+9]  = s.x - ax + bx; this.positions[pi+10] = s.y; this.positions[pi+11] = s.z - az + bz;
      pi += 12;

      this.uvs[ui]   = 0; this.uvs[ui+1] = 0;
      this.uvs[ui+2] = 1; this.uvs[ui+3] = 0;
      this.uvs[ui+4] = 1; this.uvs[ui+5] = 1;
      this.uvs[ui+6] = 0; this.uvs[ui+7] = 1;
      ui += 8;

      // Dissolve-down fade towards end of life
      const a = s.baseAlpha * Math.max(0.0, 1.0 - prg * 0.85);
      for (let v = 0; v < 4; v++) {
        this.colors[ci]     = s.r;
        this.colors[ci + 1] = s.g;
        this.colors[ci + 2] = s.b;
        this.colors[ci + 3] = a;
        ci += 4;
      }
    }

    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.geo.setDrawRange(0, count * 6);
  }

  clear() { this.splats=[]; this._lastX=null; this._lastZ=null; this.geo.setDrawRange(0,0); }
}

export class SlimeTrailSystem {
  constructor(scene) { this.scene=scene; this.fields=new Map(); }
  _getField(id) {
    if(!this.fields.has(id)) this.fields.set(id, new SplatField(this.scene));
    return this.fields.get(id);
  }
  update(dt,pos,vel,isSlimeActive=true,id='player') {
    this._getField(id).update(dt,pos,vel,isSlimeActive);
  }
  clear() { for(const f of this.fields.values()) f.clear(); }
}
