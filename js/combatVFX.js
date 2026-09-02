import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js?v=5.3';

// Shared geometries for efficiency
const FANG_UPPER_GEOM = new THREE.ConeGeometry(0.1, 0.28, 5);
const FANG_LOWER_GEOM = new THREE.ConeGeometry(0.08, 0.24, 5);
FANG_UPPER_GEOM.rotateX(Math.PI); // points downward
const DROPLET_GEOM = new THREE.SphereGeometry(0.045, 6, 6);
const MIST_PUFF_GEOM = new THREE.DodecahedronGeometry(0.22, 0);

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
   * Spawns an explosive 360-degree Poison Expel effect around the rat:
   * - Expanding ground shockwave ring
   * - 360-degree spraying venom droplets
   * - Rising toxic mist puffs
   */
  spawnPoisonExpelEffect(centerPosition, radius = 4.2) {
    const ringMesh = createGroundShockwaveRing(radius, 0x3dff7b);
    const innerRingMesh = createGroundShockwaveRing(radius * 0.7, 0xbb3dff);

    const terrainY = getTerrainHeight(centerPosition.x, centerPosition.z);
    const groundY = terrainY + 0.05;
    ringMesh.position.set(centerPosition.x, groundY, centerPosition.z);
    innerRingMesh.position.set(centerPosition.x, groundY + 0.01, centerPosition.z);

    this.scene.add(ringMesh);
    this.scene.add(innerRingMesh);

    // Ground Shockwave effect
    const shockwaveDuration = 0.55;
    this.activeEffects.push({
      type: 'shockwave',
      elapsed: 0,
      duration: shockwaveDuration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);

        const currentScale = Math.max(0.05, easeOut);
        ringMesh.scale.set(currentScale, currentScale, currentScale);
        innerRingMesh.scale.set(currentScale * 0.9, currentScale * 0.9, currentScale * 0.9);

        const alpha = Math.sin(progress * Math.PI) * (1 - progress * 0.5);
        ringMesh.material.opacity = alpha * 0.85;
        innerRingMesh.material.opacity = alpha * 0.7;

        if (progress >= 1) {
          this.scene.remove(ringMesh);
          this.scene.remove(innerRingMesh);
          ringMesh.geometry.dispose();
          ringMesh.material.dispose();
          innerRingMesh.geometry.dispose();
          innerRingMesh.material.dispose();
          return true;
        }
        return false;
      },
    });

    // 360-degree radial spray droplets (36 count)
    const sprayCount = 36;
    const venomMat = new THREE.MeshBasicMaterial({
      color: 0x48ff78,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const purpleMat = new THREE.MeshBasicMaterial({
      color: 0xb53eff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    const dropletsGroup = [];
    for (let i = 0; i < sprayCount; i++) {
      const angle = (i / sprayCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const speed = THREE.MathUtils.lerp(radius * 1.6, radius * 2.4, Math.random());
      const upSpeed = 1.8 + Math.random() * 2.2;
      const isPurple = Math.random() > 0.6;

      const mesh = new THREE.Mesh(DROPLET_GEOM, isPurple ? purpleMat : venomMat);
      mesh.position.set(
        centerPosition.x + (Math.random() - 0.5) * 0.3,
        terrainY + 0.35 + Math.random() * 0.2,
        centerPosition.z + (Math.random() - 0.5) * 0.3
      );
      const scale = 0.8 + Math.random() * 0.7;
      mesh.scale.setScalar(scale);

      this.scene.add(mesh);

      dropletsGroup.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          upSpeed,
          Math.sin(angle) * speed
        ),
        drag: 0.94,
        scale,
      });
    }

    const sprayDuration = 0.65;
    this.activeEffects.push({
      type: 'spray',
      elapsed: 0,
      duration: sprayDuration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);

        for (const drop of dropletsGroup) {
          drop.velocity.y -= 7.5 * dt; // gravity
          drop.velocity.x *= drop.drag;
          drop.velocity.z *= drop.drag;

          drop.mesh.position.addScaledVector(drop.velocity, dt);

          const ground = getTerrainHeight(drop.mesh.position.x, drop.mesh.position.z) + 0.05;
          if (drop.mesh.position.y < ground) {
            drop.mesh.position.y = ground;
            drop.velocity.set(0, 0, 0);
          }

          const shrink = Math.max(0, 1.0 - progress);
          drop.mesh.scale.setScalar(drop.scale * shrink);
        }

        venomMat.opacity = 0.95 * (1.0 - progress);
        purpleMat.opacity = 0.95 * (1.0 - progress);

        if (progress >= 1) {
          for (const drop of dropletsGroup) {
            this.scene.remove(drop.mesh);
          }
          venomMat.dispose();
          purpleMat.dispose();
          return true;
        }
        return false;
      },
    });

    // Rising toxic mist clouds
    const mistCount = 8;
    const mistMat = new THREE.MeshBasicMaterial({
      color: 0x2eff6e,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const mistPuffs = [];

    for (let i = 0; i < mistCount; i++) {
      const angle = (i / mistCount) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 0.5 + Math.random() * 1.2;
      const mesh = new THREE.Mesh(MIST_PUFF_GEOM, mistMat);
      mesh.position.set(
        centerPosition.x + Math.cos(angle) * dist,
        terrainY + 0.3 + Math.random() * 0.2,
        centerPosition.z + Math.sin(angle) * dist
      );
      mesh.scale.setScalar(0.5);
      this.scene.add(mesh);
      mistPuffs.push({
        mesh,
        rotSpeed: (Math.random() - 0.5) * 2,
        riseSpeed: 0.8 + Math.random() * 0.6,
      });
    }

    const mistDuration = 0.75;
    this.activeEffects.push({
      type: 'mist',
      elapsed: 0,
      duration: mistDuration,
      update: (dt, fx) => {
        fx.elapsed += dt;
        const progress = Math.min(fx.elapsed / fx.duration, 1);

        for (const puff of mistPuffs) {
          puff.mesh.position.y += puff.riseSpeed * dt;
          puff.mesh.rotation.y += puff.rotSpeed * dt;
          const currentScale = 0.5 + progress * 1.5;
          puff.mesh.scale.setScalar(currentScale);
        }

        mistMat.opacity = 0.45 * Math.sin((1 - progress) * Math.PI * 0.5);

        if (progress >= 1) {
          for (const puff of mistPuffs) {
            this.scene.remove(puff.mesh);
          }
          mistMat.dispose();
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
   * Disposes of all active effects (used on respawn or reset).
   */
  clear() {
    for (const fx of this.activeEffects) {
      if (fx.group) this.scene.remove(fx.group);
      if (fx.materials) {
        for (const m of fx.materials) m.dispose();
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
