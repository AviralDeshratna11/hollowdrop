import * as THREE from 'three';

// Shared across every burst/particle — only materials are per-burst (for independent fade).
const PARTICLE_GEOMETRY = new THREE.SphereGeometry(0.035, 6, 6);
const BURST_DURATION = 0.3;
const BURST_PULL_RATE = 10.0;

/** Lightweight, pooled-free particle bursts for the absorption moment. Small counts only. */
export class AbsorbParticles {
  constructor(scene) {
    this.scene = scene;
    this.bursts = [];
  }

  spawnBurst(originPosition, color, count = 6) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const meshes = [];

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(PARTICLE_GEOMETRY, material);
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.1 + Math.random() * 0.15;
      mesh.position.set(
        originPosition.x + Math.cos(angle) * radius,
        originPosition.y + Math.random() * 0.2,
        originPosition.z + Math.sin(angle) * radius
      );
      this.scene.add(mesh);
      meshes.push(mesh);
    }

    this.bursts.push({ meshes, material, elapsed: 0, mode: 'pull' });
  }

  /** Expulsion droplets: scatter outward roughly along `direction`, arc down under light gravity. */
  spawnOutwardBurst(originPosition, direction, color, count = 6) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const meshes = [];
    const velocities = [];
    const spread = 0.6;

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(PARTICLE_GEOMETRY, material);
      mesh.position.copy(originPosition);
      this.scene.add(mesh);
      meshes.push(mesh);

      const vx = direction.x + (Math.random() - 0.5) * spread;
      const vz = direction.z + (Math.random() - 0.5) * spread;
      const vy = 1.0 + Math.random() * 0.8;
      velocities.push(new THREE.Vector3(vx, vy, vz).multiplyScalar(1.2 + Math.random() * 0.6));
    }

    this.bursts.push({ meshes, material, elapsed: 0, mode: 'push', velocities });
  }

  /** Immediately removes/disposes every in-flight burst - used by the Play Again
   *  reset pipeline so nothing from the previous run is left mid-animation. */
  clear() {
    for (const burst of this.bursts) {
      for (const mesh of burst.meshes) this.scene.remove(mesh);
      burst.material.dispose();
    }
    this.bursts = [];
  }

  update(deltaTime, targetPosition) {
    if (this.bursts.length === 0) return;
    const pull = 1 - Math.exp(-BURST_PULL_RATE * deltaTime);

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.elapsed += deltaTime;
      const t = Math.min(burst.elapsed / BURST_DURATION, 1);

      if (burst.mode === 'push') {
        for (let j = 0; j < burst.meshes.length; j++) {
          const velocity = burst.velocities[j];
          velocity.y -= 4 * deltaTime; // light gravity on the droplets
          burst.meshes[j].position.addScaledVector(velocity, deltaTime);
          burst.meshes[j].scale.setScalar(1 - t);
        }
      } else {
        for (const mesh of burst.meshes) {
          mesh.position.lerp(targetPosition, pull);
          mesh.scale.setScalar(1 - t);
        }
      }
      burst.material.opacity = 0.9 * (1 - t);

      if (t >= 1) {
        for (const mesh of burst.meshes) this.scene.remove(mesh);
        burst.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
