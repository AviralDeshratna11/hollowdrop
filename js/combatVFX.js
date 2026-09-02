import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js?v=5.3';

// Shared geometries for efficiency
const FANG_UPPER_GEOM = new THREE.ConeGeometry(0.1, 0.28, 5);
const FANG_LOWER_GEOM = new THREE.ConeGeometry(0.08, 0.24, 5);
FANG_UPPER_GEOM.rotateX(Math.PI); // points downward
const DROPLET_GEOM = new THREE.SphereGeometry(0.045, 6, 6);
const MIST_PUFF_GEOM = new THREE.DodecahedronGeometry(0.22, 0);
const MIST_PUFF_LARGE_GEOM = new THREE.DodecahedronGeometry(0.65, 0);
const SMOKE_PLANE_GEOM = new THREE.PlaneGeometry(1, 1);
const ROCK_DEBRIS_GEOM = new THREE.DodecahedronGeometry(0.13, 0);
const SPARK_GEOM = new THREE.SphereGeometry(0.08, 6, 6);
const SPORE_GEOM = new THREE.SphereGeometry(0.05, 6, 6);
const FLASH_DOME_GEOM = new THREE.SphereGeometry(0.6, 10, 8);

let cachedMiasmaSmokeTexture = null;
function getMiasmaSmokeTexture() {
  if (cachedMiasmaSmokeTexture) return cachedMiasmaSmokeTexture;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Multi-lobed soft smoky radial gradient
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.2, 'rgba(235, 210, 255, 0.92)');
  grad.addColorStop(0.45, 'rgba(195, 140, 255, 0.65)');
  grad.addColorStop(0.72, 'rgba(140, 70, 220, 0.28)');
  grad.addColorStop(1.0, 'rgba(60, 10, 120, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  // Wispy organic cloud lobes around the perimeter
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.3;
    const dist = 22;
    const cx = 64 + Math.cos(angle) * dist;
    const cy = 64 + Math.sin(angle) * dist;
    const lobeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 36);
    lobeGrad.addColorStop(0.0, 'rgba(225, 185, 255, 0.45)');
    lobeGrad.addColorStop(0.5, 'rgba(150, 80, 230, 0.18)');
    lobeGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = lobeGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 36, 0, Math.PI * 2);
    ctx.fill();
  }

  cachedMiasmaSmokeTexture = new THREE.CanvasTexture(canvas);
  cachedMiasmaSmokeTexture.colorSpace = THREE.SRGBColorSpace;
  return cachedMiasmaSmokeTexture;
}

/**
 * Creates a circular ground shockwave mesh.
 */
function createGroundShockwaveRing(radius = 4.2, color = 0x2dff88) {
  const geom = new THREE.RingGeometry(radius * 0.88, radius, 36);
  geom.rotateX(-Math.PI / 2); // Lay flat on ground (XZ plane)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geom, mat);
}

export class CombatVFXSystem {
  constructor(scene) {
    this.scene = scene;
    this.activeEffects = [];
    this.droplets = [];
  }

  /**
   * Spawns sharp glowing fangs on the target that rapidly clamp shut and burst into venom splatter.
   * @param {THREE.Vector3} position - World position where bite landed
   * @param {THREE.Vector3} direction - Forward direction of the bite
   */
  spawnBiteEffect(position, direction = new THREE.Vector3(0, 0, -1)) {
    const group = new THREE.Group();
    const terrainY = getTerrainHeight(position.x, position.z);
    const targetY = Math.max(position.y, terrainY + 0.35);
    group.position.set(position.x, targetY, position.z);

    // Orient fangs toward the bite angle
    const angle = Math.atan2(direction.x, direction.z);
    group.rotation.y = angle;

    const fangMat = new THREE.MeshBasicMaterial({
      color: 0x9b5cf0,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x42ff88,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    // Top fangs (left & right)
    const upperFangL = new THREE.Mesh(FANG_UPPER_GEOM, fangMat);
    upperFangL.position.set(-0.14, 0.28, -0.05);
    upperFangL.rotation.z = 0.2;
    group.add(upperFangL);

    const upperFangR = new THREE.Mesh(FANG_UPPER_GEOM, fangMat);
    upperFangR.position.set(0.14, 0.28, -0.05);
    upperFangR.rotation.z = -0.2;
    group.add(upperFangR);

    // Bottom fangs (left & right)
    const lowerFangL = new THREE.Mesh(FANG_LOWER_GEOM, glowMat);
    lowerFangL.position.set(-0.1, -0.25, 0.02);
    lowerFangL.rotation.z = -0.2;
    group.add(lowerFangL);

    const lowerFangR = new THREE.Mesh(FANG_LOWER_GEOM, glowMat);
    lowerFangR.position.set(0.1, -0.25, 0.02);
    lowerFangR.rotation.z = 0.2;
    group.add(lowerFangR);

    // Center impact flash spark
    const sparkGeom = new THREE.SphereGeometry(0.12, 8, 8);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sparkMesh = new THREE.Mesh(sparkGeom, sparkMat);
    group.add(sparkMesh);

    this.scene.add(group);

    const duration = 0.22;
    let hasSpawnedSplatter = false;

    this.activeEffects.push({
      type: 'bite',
      group,
      materials: [fangMat, glowMat, sparkMat],
      elapsed: 0,
      duration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);

        // Phase 1: Rapid clamp shut (0 -> 0.45 of duration)
        if (progress < 0.45) {
          const tSnap = progress / 0.45;
          const easeSnap = tSnap * tSnap * tSnap; // fast snap
          upperFangL.position.y = THREE.MathUtils.lerp(0.28, 0.04, easeSnap);
          upperFangR.position.y = THREE.MathUtils.lerp(0.28, 0.04, easeSnap);
          lowerFangL.position.y = THREE.MathUtils.lerp(-0.25, -0.02, easeSnap);
          lowerFangR.position.y = THREE.MathUtils.lerp(-0.25, -0.02, easeSnap);
          sparkMat.opacity = 0;
        } else {
          // Phase 2: Teeth clamped, flash & dissolve
          if (!hasSpawnedSplatter) {
            hasSpawnedSplatter = true;
            this._spawnVenomSplatter(group.position, direction, 10);
            sparkMat.opacity = 1.0;
          }
          const tFade = (progress - 0.45) / 0.55;
          sparkMat.opacity = Math.max(0, 1.0 - tFade * 2.5);
          const fadeAlpha = 1.0 - tFade;
          fangMat.opacity = 0.95 * fadeAlpha;
          glowMat.opacity = 0.9 * fadeAlpha;
          group.scale.setScalar(1 + tFade * 0.3);
        }

        if (progress >= 1) {
          this.scene.remove(group);
          sparkGeom.dispose();
          fangMat.dispose();
          glowMat.dispose();
          sparkMat.dispose();
          return true; // remove
        }
        return false;
      },
    });
  }

  /**
   * Spawns a slow, creeping necrotic purple Miasma Cloud Rupture (Toxic Burst) effect:
   * - 100% Necrotic Purple/Violet/Lavender palette (zero green).
   * - Organic soft smoky gas texture with whispery cloud lobes.
   * - Full solid circular volume (multi-zone: inner core stays dense while outer wave expands).
   * - Non-linear physical expansion curve (early pneumatic surge -> rolling slow crawl).
   * - 100% lag-free: zero dynamic lights, shared geometries, zero shader recompiles.
   * @param {THREE.Vector3} centerPosition - Origin of the burst
   * @param {number} radius - Target maximum combat radius (default 4.8)
   */
  spawnPoisonExpelEffect(centerPosition, radius = 4.8) {
    const terrainY = getTerrainHeight(centerPosition.x, centerPosition.z);
    const originY = Math.max(centerPosition.y || terrainY, terrainY + 0.1);

    const group = new THREE.Group();
    group.position.set(centerPosition.x, terrainY, centerPosition.z);
    this.scene.add(group);

    const trackedMaterials = [];
    const trackedGeometries = [];
    const smokeTexture = getMiasmaSmokeTexture();

    // --- 1. Central Magenta/Violet Vapor Flash Core (Additive glow dome) ---
    const flashMatInner = new THREE.MeshBasicMaterial({
      color: 0xf472b6,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flashMatOuter = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.70,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    trackedMaterials.push(flashMatInner, flashMatOuter);

    const flashInner = new THREE.Mesh(FLASH_DOME_GEOM, flashMatInner);
    const flashOuter = new THREE.Mesh(FLASH_DOME_GEOM, flashMatOuter);
    flashInner.position.set(0, 0.35, 0);
    flashOuter.position.set(0, 0.35, 0);
    flashOuter.scale.setScalar(1.4);
    group.add(flashInner);
    group.add(flashOuter);

    // --- 2. Ground Shockwave Rings & Caustic Floor Disc (Purple/Violet/Magenta) ---
    const shockwaveOuter = createGroundShockwaveRing(radius, 0xa855f7);
    const shockwaveInner = createGroundShockwaveRing(radius * 0.72, 0xd946ef);
    shockwaveOuter.position.set(0, 0.04, 0);
    shockwaveInner.position.set(0, 0.06, 0);
    shockwaveOuter.scale.set(0.05, 0.05, 0.05);
    shockwaveInner.scale.set(0.05, 0.05, 0.05);
    group.add(shockwaveOuter);
    group.add(shockwaveInner);
    trackedGeometries.push(shockwaveOuter.geometry, shockwaveInner.geometry);
    trackedMaterials.push(shockwaveOuter.material, shockwaveInner.material);

    // Ground necrotic disc
    const discGeom = new THREE.CircleGeometry(radius * 0.95, 32);
    discGeom.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x2e1065,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const discMesh = new THREE.Mesh(discGeom, discMat);
    discMesh.position.set(0, 0.02, 0);
    discMesh.scale.set(0.05, 1, 0.05);
    group.add(discMesh);
    trackedGeometries.push(discGeom);
    trackedMaterials.push(discMat);

    // --- 3. Full-Circle Multi-Zone Soft Smoky Gas Puffs ---
    // Palette: Deep necrotic purple, vibrant toxic violet, radiant amethyst, smoky lavender
    const smokeColors = [0x7e22ce, 0x9333ea, 0xa855f7, 0xc084fc, 0x581c87, 0x3b0764];
    const smokeMats = smokeColors.map(
      (c) =>
        new THREE.MeshBasicMaterial({
          color: c,
          map: smokeTexture,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
    );
    trackedMaterials.push(...smokeMats);

    const fogPuffs = [];

    // Zone 0: Inner Core (8 puffs) - stays clustered in the center (r <= 1.2m)
    // Ensures the rat and inner area NEVER become empty or hollow!
    for (let i = 0; i < 8; i++) {
      const mat = smokeMats[i % smokeMats.length];
      const mesh = new THREE.Mesh(SMOKE_PLANE_GEOM, mat);
      const angle = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const initialDist = 0.15 + Math.random() * 0.35;
      mesh.position.set(Math.cos(angle) * initialDist, 0.25 + Math.random() * 0.2, Math.sin(angle) * initialDist);

      const initialScale = 0.8 + Math.random() * 0.4;
      const maxScale = 2.4 + Math.random() * 0.8;
      mesh.scale.setScalar(initialScale);
      mesh.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.4; // gently tilted quad
      mesh.rotation.z = Math.random() * Math.PI * 2;
      group.add(mesh);

      fogPuffs.push({
        mesh,
        baseAngle: angle,
        initialDist,
        targetDistance: 0.6 + Math.random() * 0.6, // stays close to center
        initialScale,
        maxScale,
        vortexSpeed: (i % 2 === 0 ? 1 : -1) * (0.35 + Math.random() * 0.25),
        rotSpeedZ: (Math.random() - 0.5) * 0.8,
        liftOffset: 0.18 + Math.random() * 0.25,
        driftRate: 0.12 + Math.random() * 0.15,
        phase: Math.random() * Math.PI * 2,
        zone: 0,
      });
    }

    // Zone 1: Mid-Body (10 puffs) - expands to middle radius (r <= 2.8m)
    for (let i = 0; i < 10; i++) {
      const mat = smokeMats[(i + 2) % smokeMats.length];
      const mesh = new THREE.Mesh(SMOKE_PLANE_GEOM, mat);
      const angle = (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const initialDist = 0.25 + Math.random() * 0.4;
      mesh.position.set(Math.cos(angle) * initialDist, 0.28 + Math.random() * 0.25, Math.sin(angle) * initialDist);

      const initialScale = 0.9 + Math.random() * 0.4;
      const maxScale = 3.0 + Math.random() * 0.9;
      mesh.scale.setScalar(initialScale);
      mesh.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.45;
      mesh.rotation.z = Math.random() * Math.PI * 2;
      group.add(mesh);

      fogPuffs.push({
        mesh,
        baseAngle: angle,
        initialDist,
        targetDistance: radius * (0.45 + Math.random() * 0.22), // expands to mid
        initialScale,
        maxScale,
        vortexSpeed: (i % 2 === 0 ? 1 : -1) * (0.28 + Math.random() * 0.2),
        rotSpeedZ: (Math.random() - 0.5) * 0.7,
        liftOffset: 0.22 + Math.random() * 0.3,
        driftRate: 0.15 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
        zone: 1,
      });
    }

    // Zone 2: Outer Leading Front (12 puffs) - rolls outward to the full radius (r <= 4.8m)
    for (let i = 0; i < 12; i++) {
      const mat = smokeMats[(i + 4) % smokeMats.length];
      const mesh = new THREE.Mesh(SMOKE_PLANE_GEOM, mat);
      const angle = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const initialDist = 0.35 + Math.random() * 0.5;
      mesh.position.set(Math.cos(angle) * initialDist, 0.3 + Math.random() * 0.3, Math.sin(angle) * initialDist);

      const initialScale = 1.0 + Math.random() * 0.5;
      const maxScale = 3.6 + Math.random() * 1.1;
      mesh.scale.setScalar(initialScale);
      mesh.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
      mesh.rotation.z = Math.random() * Math.PI * 2;
      group.add(mesh);

      fogPuffs.push({
        mesh,
        baseAngle: angle,
        initialDist,
        targetDistance: radius * (0.82 + Math.random() * 0.22), // reaches outer edge
        initialScale,
        maxScale,
        vortexSpeed: (i % 2 === 0 ? 1 : -1) * (0.22 + Math.random() * 0.18),
        rotSpeedZ: (Math.random() - 0.5) * 0.6,
        liftOffset: 0.25 + Math.random() * 0.35,
        driftRate: 0.18 + Math.random() * 0.22,
        phase: Math.random() * Math.PI * 2,
        zone: 2,
      });
    }

    // --- 4. Intermittent Magenta/Violet Bio-Electric Lightning Arcs ---
    const lightningArcs = [];
    const lightningMatMagenta = new THREE.LineBasicMaterial({
      color: 0xf0abfc,
      transparent: true,
      opacity: 0,
      linewidth: 2,
    });
    const lightningMatViolet = new THREE.LineBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0,
      linewidth: 2,
    });
    trackedMaterials.push(lightningMatMagenta, lightningMatViolet);

    for (let i = 0; i < 4; i++) {
      const segCount = 6;
      const points = [];
      for (let s = 0; s <= segCount; s++) {
        const t = s / segCount;
        points.push(
          new THREE.Vector3(
            t * 1.0,
            s === 0 || s === segCount ? 0 : (Math.random() - 0.5) * 0.35,
            s === 0 || s === segCount ? 0 : (Math.random() - 0.5) * 0.35
          )
        );
      }
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      trackedGeometries.push(geom);

      const line = new THREE.Line(geom, i % 2 === 0 ? lightningMatMagenta : lightningMatViolet);
      line.position.set(0, 0.38, 0);
      group.add(line);

      lightningArcs.push({
        line,
        angle: (i / 4) * Math.PI * 2 + Math.random() * 0.5,
        flashInterval: 0.6 + i * 0.55,
      });
    }

    // --- 5. Floating Pale Lilac & Lavender Spores ---
    const sporeCount = 16;
    const sporeMat = new THREE.MeshBasicMaterial({
      color: 0xf5d0fe,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sporePurpleMat = new THREE.MeshBasicMaterial({
      color: 0xe9d5ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    trackedMaterials.push(sporeMat, sporePurpleMat);

    const spores = [];
    for (let i = 0; i < sporeCount; i++) {
      const mesh = new THREE.Mesh(SPORE_GEOM, i % 2 === 0 ? sporeMat : sporePurpleMat);
      const angle = (i / sporeCount) * Math.PI * 2 + Math.random() * 0.5;
      const initialDist = 0.2 + Math.random() * 0.4;
      mesh.position.set(Math.cos(angle) * initialDist, 0.3 + Math.random() * 0.4, Math.sin(angle) * initialDist);
      group.add(mesh);

      spores.push({
        mesh,
        angle,
        targetDistance: radius * (0.4 + Math.random() * 0.55),
        riseSpeed: 0.35 + Math.random() * 0.45,
        wobbleFreq: 1.5 + Math.random() * 2.0,
        wobbleAmp: 0.15 + Math.random() * 0.2,
      });
    }

    const duration = 3.2; // total creeping duration
    const expandDuration = 2.4; // time to reach full perimeter

    this.activeEffects.push({
      type: 'miasma_cloud_rupture_purple',
      group,
      materials: trackedMaterials,
      geometries: trackedGeometries,
      elapsed: 0,
      duration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);
        const normT = Math.min(fx.elapsed / expandDuration, 1);

        // Non-linear organic expansion curve:
        // Initial exhalation acceleration out of rat -> gentle rolling deceleration to perimeter
        const creepT = 1 - Math.pow(1 - normT, 2.4);

        // --- 1. Initial Magenta Flash Decay (0.0s - 0.45s) ---
        if (fx.elapsed < 0.45) {
          const tFlash = fx.elapsed / 0.45;
          const flashScale = 1.0 + tFlash * 2.2;
          flashInner.scale.setScalar(flashScale);
          flashOuter.scale.setScalar(flashScale * 1.4);
          flashMatInner.opacity = 0.85 * (1.0 - tFlash);
          flashMatOuter.opacity = 0.70 * (1.0 - tFlash);
        } else {
          flashInner.visible = false;
          flashOuter.visible = false;
        }

        // --- 2. Ground Shockwave Rings & Floor Caustic Disc (Synchronized with creep) ---
        const ringScale = Math.max(0.05, creepT);
        shockwaveOuter.scale.set(ringScale, ringScale, ringScale);
        shockwaveInner.scale.set(ringScale * 0.82, ringScale * 0.82, ringScale * 0.82);

        // Smooth alpha envelope: fast bloom, stays visible as area perimeter, then softly evaporates
        let ringAlpha = 0;
        if (progress < 0.15) ringAlpha = progress / 0.15;
        else if (progress < 0.75) ringAlpha = 1.0;
        else ringAlpha = Math.max(0, (1.0 - progress) / 0.25);

        shockwaveOuter.material.opacity = ringAlpha * 0.85;
        shockwaveInner.material.opacity = ringAlpha * 0.70;

        discMesh.scale.set(ringScale, 1, ringScale);
        discMat.opacity = ringAlpha * 0.42;

        // --- 3. Full-Circle Solid Billowing Miasma Puffs ---
        // Opacity envelope: rapid ramp-up in first 0.35s, stays thick and dense, then smoothly evaporates in last 0.8s
        let fogAlpha = 0;
        if (progress < 0.12) fogAlpha = progress / 0.12;
        else if (progress < 0.75) fogAlpha = 1.0;
        else fogAlpha = Math.max(0, (1.0 - progress) / 0.25);

        // Update all smoke materials with gentle opacity
        for (let i = 0; i < smokeMats.length; i++) {
          smokeMats[i].opacity = (0.45 + (i % 3) * 0.05) * fogAlpha;
        }

        for (const p of fogPuffs) {
          // Organic curved expansion with subtle harmonic turbulence
          const puffCreep = Math.min(1, creepT + 0.04 * Math.sin(normT * Math.PI * 2.5 + p.phase));
          const curDist = THREE.MathUtils.lerp(p.initialDist, p.targetDistance, puffCreep);

          // Swirling angle with slight deceleration
          const curAngle = p.baseAngle + p.vortexSpeed * fx.elapsed * (1 - 0.25 * creepT);

          const relX = Math.cos(curAngle) * curDist;
          const relZ = Math.sin(curAngle) * curDist;
          const worldX = centerPosition.x + relX;
          const worldZ = centerPosition.z + relZ;

          // Terrain height tracking so the entire fog carpet hugs contours
          const localTerrainY = getTerrainHeight(worldX, worldZ);
          const relY = (localTerrainY - terrainY) + p.liftOffset + fx.elapsed * p.driftRate;

          p.mesh.position.set(relX, relY, relZ);

          // Puffs swell in volume as they billow along the non-linear curve
          const curScale = THREE.MathUtils.lerp(p.initialScale, p.maxScale, Math.sqrt(puffCreep));
          p.mesh.scale.setScalar(curScale);

          // Gentle rotation around quad normal for organic rolling billow
          p.mesh.rotation.z += p.rotSpeedZ * dt;
        }

        // --- 4. Intermittent Bio-Electric Purple Lightning ---
        for (const arc of lightningArcs) {
          const cycleTime = (fx.elapsed + arc.flashInterval) % 0.85;
          if (cycleTime < 0.12 && progress < 0.82) {
            arc.line.visible = true;
            const flicker = Math.random() > 0.2 ? 0.95 : 0.25;
            arc.line.material.opacity = flicker * fogAlpha;
            // Scale and rotate line towards current creeping edge
            const currentReach = THREE.MathUtils.lerp(0.8, radius, creepT);
            arc.line.rotation.y = arc.angle + Math.sin(fx.elapsed * 4.0) * 0.3;
            arc.line.scale.set(currentReach, 1.0, 1.0);
          } else {
            arc.line.visible = false;
          }
        }

        // --- 5. Floating Bioluminescent Lilac Spores ---
        sporeMat.opacity = 0.9 * fogAlpha;
        sporePurpleMat.opacity = 0.9 * fogAlpha;

        for (const sp of spores) {
          const curDist = THREE.MathUtils.lerp(0.25, sp.targetDistance, creepT);
          const curAngle = sp.angle + fx.elapsed * 0.25;
          const wobble = Math.sin(fx.elapsed * sp.wobbleFreq) * sp.wobbleAmp;

          sp.mesh.position.x = Math.cos(curAngle) * curDist + wobble;
          sp.mesh.position.z = Math.sin(curAngle) * curDist + wobble;
          sp.mesh.position.y += sp.riseSpeed * dt;
          sp.mesh.scale.setScalar(Math.max(0.01, (1 - progress * 0.5) * 1.2));
        }

        // --- Completion & Disposal ---
        if (progress >= 1) {
          this.scene.remove(group);
          for (const geom of trackedGeometries) geom.dispose();
          for (const mat of trackedMaterials) mat.dispose();
          return true;
        }
        return false;
      },
    });
  }

  /**
   * Internal helper for directional bite venom splatter droplets.
   */
  _spawnVenomSplatter(origin, direction, count = 8) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x48ff78,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const droplets = [];

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(DROPLET_GEOM, mat);
      mesh.position.copy(origin);
      this.scene.add(mesh);

      const spread = 1.4;
      const vx = direction.x * 2.5 + (Math.random() - 0.5) * spread;
      const vz = direction.z * 2.5 + (Math.random() - 0.5) * spread;
      const vy = 1.5 + Math.random() * 1.2;

      droplets.push({
        mesh,
        velocity: new THREE.Vector3(vx, vy, vz),
      });
    }

    const duration = 0.35;
    this.activeEffects.push({
      type: 'splatter',
      elapsed: 0,
      duration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);

        for (const d of droplets) {
          d.velocity.y -= 8 * dt;
          d.mesh.position.addScaledVector(d.velocity, dt);
          d.mesh.scale.setScalar(1.0 - progress);
        }
        mat.opacity = 0.95 * (1.0 - progress);

        if (progress >= 1) {
          for (const d of droplets) this.scene.remove(d.mesh);
          mat.dispose();
          return true;
        }
        return false;
      },
    });
  }

  /**
   * Spawns seismic ground slam crater with dual expanding shockwaves, 3D flying rock shrapnel & dust.
   */
  spawnApexSlamCrater(position, radius = 2.4) {
    const group = new THREE.Group();
    const terrainY = getTerrainHeight(position.x, position.z);
    group.position.set(position.x, terrainY + 0.04, position.z);

    // 1. Inner fire shockwave ring
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xff5511,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const innerRingGeom = new THREE.RingGeometry(0.2, 0.45, 32);
    innerRingGeom.rotateX(-Math.PI / 2);
    const innerRing = new THREE.Mesh(innerRingGeom, innerRingMat);
    group.add(innerRing);

    // 2. Outer toxic amethyst shockwave ring
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outerRingGeom = new THREE.RingGeometry(0.4, 0.65, 32);
    outerRingGeom.rotateX(-Math.PI / 2);
    const outerRing = new THREE.Mesh(outerRingGeom, outerRingMat);
    group.add(outerRing);

    // 3. 3D Flying rock shrapnel chunks
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x3d2d24,
      roughness: 0.9,
      flatShading: true,
    });
    const rocks = [];
    const rockCount = 10;

    for (let i = 0; i < rockCount; i++) {
      const rock = new THREE.Mesh(ROCK_DEBRIS_GEOM, rockMat);
      const angle = (i / rockCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 2.5 + Math.random() * 3.5;
      rock.position.set(0, 0.1, 0);
      rock.scale.setScalar(0.7 + Math.random() * 0.7);
      group.add(rock);

      rocks.push({
        mesh: rock,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 3.5 + Math.random() * 3.0, Math.sin(angle) * speed),
        rotAxis: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
        rotSpeed: 5 + Math.random() * 10,
      });
    }

    // 4. Expanding dust / smoke puffs
    const dustMat = new THREE.MeshBasicMaterial({
      color: 0xff7722,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const puffs = [];
    const puffCount = 6;
    for (let i = 0; i < puffCount; i++) {
      const puff = new THREE.Mesh(MIST_PUFF_GEOM, dustMat);
      const angle = (i / puffCount) * Math.PI * 2;
      const dist = 0.4 + Math.random() * 0.5;
      puff.position.set(Math.cos(angle) * dist, 0.15, Math.sin(angle) * dist);
      group.add(puff);
      puffs.push({
        mesh: puff,
        velocity: new THREE.Vector3(Math.cos(angle) * 1.8, 1.2 + Math.random() * 1.0, Math.sin(angle) * 1.8),
      });
    }

    this.scene.add(group);

    const duration = 0.65;
    this.activeEffects.push({
      type: 'apex_slam',
      group,
      materials: [innerRingMat, outerRingMat, rockMat, dustMat],
      elapsed: 0,
      duration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);

        // Expanding rings
        const scaleInner = THREE.MathUtils.lerp(0.5, radius * 1.1, Math.sqrt(progress));
        innerRing.scale.set(scaleInner, scaleInner, 1);
        innerRingMat.opacity = Math.max(0, 0.95 * (1 - progress * progress));

        const scaleOuter = THREE.MathUtils.lerp(0.8, radius * 1.45, Math.sqrt(progress));
        outerRing.scale.set(scaleOuter, scaleOuter, 1);
        outerRingMat.opacity = Math.max(0, 0.85 * (1 - progress));

        // Rocks with gravity and rotation
        for (const r of rocks) {
          r.velocity.y -= 14 * dt;
          r.mesh.position.addScaledVector(r.velocity, dt);
          r.mesh.rotateOnAxis(r.rotAxis, r.rotSpeed * dt);
          if (progress > 0.5) {
            r.mesh.scale.setScalar(Math.max(0.01, (1 - progress) * 2));
          }
        }

        // Dust billows
        for (const p of puffs) {
          p.mesh.position.addScaledVector(p.velocity, dt);
          p.mesh.scale.setScalar(1 + progress * 2.5);
        }
        dustMat.opacity = Math.max(0, 0.8 * (1 - progress));

        if (progress >= 1) {
          this.scene.remove(group);
          innerRingGeom.dispose();
          outerRingGeom.dispose();
          innerRingMat.dispose();
          outerRingMat.dispose();
          rockMat.dispose();
          dustMat.dispose();
          return true;
        }
        return false;
      },
    });
  }

  /**
   * Spawns a glowing kinetic furrow with sparks and heat ripples along Murkmaw's charge trajectory.
   */
  spawnApexChargeFurrow(startPos, endPos, direction) {
    const group = new THREE.Group();
    const midX = (startPos.x + endPos.x) * 0.5;
    const midZ = (startPos.z + endPos.z) * 0.5;
    const terrainY = getTerrainHeight(midX, midZ);
    group.position.set(midX, terrainY + 0.03, midZ);

    const length = startPos.distanceTo(endPos);
    const angle = Math.atan2(direction.x, direction.z);
    group.rotation.y = angle;

    // Glowing ground laser furrow plane
    const furrowMat = new THREE.MeshBasicMaterial({
      color: 0xff3311,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const furrowGeom = new THREE.PlaneGeometry(0.8, length);
    furrowGeom.rotateX(-Math.PI / 2);
    const furrowMesh = new THREE.Mesh(furrowGeom, furrowMat);
    group.add(furrowMesh);

    // Sparks along the track
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffbb33,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const sparks = [];
    const sparkCount = 8;
    for (let i = 0; i < sparkCount; i++) {
      const spark = new THREE.Mesh(SPARK_GEOM, sparkMat);
      const zOffset = (Math.random() - 0.5) * length * 0.8;
      spark.position.set((Math.random() - 0.5) * 0.6, 0.1, zOffset);
      group.add(spark);
      sparks.push({
        mesh: spark,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2.0, 1.8 + Math.random() * 2.0, (Math.random() - 0.5) * 2.0),
      });
    }

    this.scene.add(group);

    const duration = 0.55;
    this.activeEffects.push({
      type: 'apex_charge_furrow',
      group,
      materials: [furrowMat, sparkMat],
      elapsed: 0,
      duration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);

        furrowMat.opacity = Math.max(0, 0.9 * (1 - progress * progress));
        furrowMesh.scale.set(1 + progress * 0.8, 1, 1);

        for (const s of sparks) {
          s.velocity.y -= 10 * dt;
          s.mesh.position.addScaledVector(s.velocity, dt);
          s.mesh.scale.setScalar(Math.max(0.01, 1 - progress));
        }

        if (progress >= 1) {
          this.scene.remove(group);
          furrowGeom.dispose();
          furrowMat.dispose();
          sparkMat.dispose();
          return true;
        }
        return false;
      },
    });
  }

  /**
   * Spawns a 360-degree Caustic Miasma Nova with flying poison globs and expanding toxic clouds.
   */
  spawnApexToxicNova(position, radius = 3.6) {
    const group = new THREE.Group();
    const terrainY = getTerrainHeight(position.x, position.z);
    group.position.set(position.x, terrainY + 0.05, position.z);

    // Shockwave ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x9b30ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringGeom = new THREE.RingGeometry(0.3, 0.7, 36);
    ringGeom.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeom, ringMat);
    group.add(ring);

    // Outward flying acid droplets
    const dropMat = new THREE.MeshBasicMaterial({
      color: 0x5dff4d,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const droplets = [];
    const dropletCount = 18;
    for (let i = 0; i < dropletCount; i++) {
      const drop = new THREE.Mesh(DROPLET_GEOM, dropMat);
      const angle = (i / dropletCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const speed = 4.0 + Math.random() * 3.5;
      drop.position.set(0, 0.2, 0);
      group.add(drop);
      droplets.push({
        mesh: drop,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 1.8 + Math.random() * 2.2, Math.sin(angle) * speed),
      });
    }

    // Swirling toxic gas clouds
    const gasMat = new THREE.MeshBasicMaterial({
      color: 0x7b1fa2,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    const gasClouds = [];
    const cloudCount = 8;
    for (let i = 0; i < cloudCount; i++) {
      const cloud = new THREE.Mesh(MIST_PUFF_GEOM, gasMat);
      const angle = (i / cloudCount) * Math.PI * 2;
      cloud.position.set(Math.cos(angle) * 0.5, 0.25, Math.sin(angle) * 0.5);
      cloud.scale.setScalar(1.2);
      group.add(cloud);
      gasClouds.push({
        mesh: cloud,
        velocity: new THREE.Vector3(Math.cos(angle) * 2.2, 0.8 + Math.random() * 0.6, Math.sin(angle) * 2.2),
      });
    }

    this.scene.add(group);

    const duration = 0.75;
    this.activeEffects.push({
      type: 'apex_toxic_nova',
      group,
      materials: [ringMat, dropMat, gasMat],
      elapsed: 0,
      duration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);

        const ringScale = THREE.MathUtils.lerp(0.5, radius * 1.35, Math.sqrt(progress));
        ring.scale.set(ringScale, ringScale, 1);
        ringMat.opacity = Math.max(0, 0.9 * (1 - progress));

        for (const d of droplets) {
          d.velocity.y -= 12 * dt;
          d.mesh.position.addScaledVector(d.velocity, dt);
          d.mesh.scale.setScalar(Math.max(0.01, 1 - progress));
        }

        for (const g of gasClouds) {
          g.mesh.position.addScaledVector(g.velocity, dt);
          g.mesh.scale.setScalar(1.2 + progress * 3.2);
        }
        gasMat.opacity = Math.max(0, 0.75 * (1 - progress));

        if (progress >= 1) {
          this.scene.remove(group);
          ringGeom.dispose();
          ringMat.dispose();
          dropMat.dispose();
          gasMat.dispose();
          return true;
        }
        return false;
      },
    });
  }

  /**
   * Spawns a violent upward subterranean earth eruption with rock pillars, dust geyser, and shockwaves.
   */
  spawnApexSubterraneanEruption(position) {
    const group = new THREE.Group();
    const terrainY = getTerrainHeight(position.x, position.z);
    group.position.set(position.x, terrainY + 0.04, position.z);

    // Expanding magma shockwave
    const eruptRingMat = new THREE.MeshBasicMaterial({
      color: 0xff2200,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const eruptRingGeom = new THREE.RingGeometry(0.3, 0.8, 36);
    eruptRingGeom.rotateX(-Math.PI / 2);
    const eruptRing = new THREE.Mesh(eruptRingGeom, eruptRingMat);
    group.add(eruptRing);

    // Erupting stone boulders
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x22112a,
      roughness: 0.8,
      flatShading: true,
    });
    const rocks = [];
    const rockCount = 14;
    for (let i = 0; i < rockCount; i++) {
      const rock = new THREE.Mesh(ROCK_DEBRIS_GEOM, rockMat);
      const angle = (i / rockCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 3.0 + Math.random() * 4.0;
      rock.position.set(0, 0.1, 0);
      rock.scale.setScalar(1.0 + Math.random() * 0.8);
      group.add(rock);
      rocks.push({
        mesh: rock,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 5.0 + Math.random() * 4.5, Math.sin(angle) * speed),
        rotAxis: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
        rotSpeed: 8 + Math.random() * 12,
      });
    }

    // Geyser smoke billows
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0xff4411,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const smokePuffs = [];
    const smokeCount = 8;
    for (let i = 0; i < smokeCount; i++) {
      const smoke = new THREE.Mesh(MIST_PUFF_GEOM, smokeMat);
      const angle = (i / smokeCount) * Math.PI * 2;
      smoke.position.set(Math.cos(angle) * 0.4, 0.2, Math.sin(angle) * 0.4);
      group.add(smoke);
      smokePuffs.push({
        mesh: smoke,
        velocity: new THREE.Vector3(Math.cos(angle) * 1.5, 3.5 + Math.random() * 2.5, Math.sin(angle) * 1.5),
      });
    }

    this.scene.add(group);

    const duration = 0.85;
    this.activeEffects.push({
      type: 'apex_subterranean_eruption',
      group,
      materials: [eruptRingMat, rockMat, smokeMat],
      elapsed: 0,
      duration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);

        const ringScale = THREE.MathUtils.lerp(0.5, 4.2, Math.sqrt(progress));
        eruptRing.scale.set(ringScale, ringScale, 1);
        eruptRingMat.opacity = Math.max(0, 0.95 * (1 - progress));

        for (const r of rocks) {
          r.velocity.y -= 15 * dt;
          r.mesh.position.addScaledVector(r.velocity, dt);
          r.mesh.rotateOnAxis(r.rotAxis, r.rotSpeed * dt);
          if (progress > 0.6) {
            r.mesh.scale.setScalar(Math.max(0.01, (1 - progress) * 2.5));
          }
        }

        for (const s of smokePuffs) {
          s.mesh.position.addScaledVector(s.velocity, dt);
          s.mesh.scale.setScalar(1 + progress * 3.5);
        }
        smokeMat.opacity = Math.max(0, 0.85 * (1 - progress));

        if (progress >= 1) {
          this.scene.remove(group);
          eruptRingGeom.dispose();
          eruptRingMat.dispose();
          rockMat.dispose();
          smokeMat.dispose();
          return true;
        }
        return false;
      },
    });
  }

  /**
   * Spawns a subterranean tracking dust tremor at the current underground position.
   */
  spawnApexTremor(position) {
    const group = new THREE.Group();
    const terrainY = getTerrainHeight(position.x, position.z);
    group.position.set(position.x, terrainY + 0.05, position.z);

    const dustMat = new THREE.MeshBasicMaterial({
      color: 0x8b4513,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const puffs = [];
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(MIST_PUFF_GEOM, dustMat);
      puff.position.set((Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4);
      puff.scale.setScalar(0.6 + Math.random() * 0.4);
      group.add(puff);
      puffs.push({
        mesh: puff,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8),
      });
    }

    this.scene.add(group);

    const duration = 0.35;
    this.activeEffects.push({
      type: 'apex_tremor',
      group,
      materials: [dustMat],
      elapsed: 0,
      duration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);
        for (const p of puffs) {
          p.mesh.position.addScaledVector(p.velocity, dt);
          p.mesh.scale.setScalar(1 + progress * 1.5);
        }
        dustMat.opacity = Math.max(0, 0.65 * (1 - progress));

        if (progress >= 1) {
          this.scene.remove(group);
          dustMat.dispose();
          return true;
        }
        return false;
      },
    });
  }

  /**
   * Disposes of all active effects (used on respawn or reset).
   */
  clear() {
    for (const fx of this.activeEffects) {
      if (fx.group) this.scene.remove(fx.group);
      if (fx.light) this.scene.remove(fx.light);
      if (fx.materials) {
        for (const m of fx.materials) m.dispose();
      }
      if (fx.geometries) {
        for (const g of fx.geometries) g.dispose();
      }
    }
    this.activeEffects = [];
  }

  /**
   * Updates all active combat VFX. Called every frame in the main animation loop.
   */
  update(deltaTime) {
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const fx = this.activeEffects[i];
      const done = fx.update(deltaTime, fx);
      if (done) {
        this.activeEffects.splice(i, 1);
      }
    }
  }
}
