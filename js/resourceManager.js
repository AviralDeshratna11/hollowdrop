import * as THREE from 'three';
import { RESOURCE_TYPES } from './resourceTypes.js';
import { createResourceMesh } from './resourceModels.js';
import { AbsorbParticles } from './absorbParticles.js';

export const ATTRACTION_RADIUS = 1.5;
export const ABSORB_RADIUS = 0.7;
const ATTRACTION_RADIUS_SQ = ATTRACTION_RADIUS * ATTRACTION_RADIUS;
const ABSORB_RADIUS_SQ = ABSORB_RADIUS * ABSORB_RADIUS;

const ATTRACTION_PULL_RATE = 9.0; // exponential closing speed while being pulled in
const ABSORB_DURATION = 0.25; // seconds for the final shrink-into-center animation
const REJECT_COOLDOWN = 0.6; // seconds a "too heavy" resource ignores attraction after being pushed away
const REJECT_PUSH_SPEED = 2.5;

// Lightweight custom physics for expelled items - no physics engine, just
// gravity + ground contact + friction, and it stops running once a resource rests.
export const EXPEL_PHYSICS = {
  launchForce: 5.0,
  launchUpwardForce: 3.2,
  recollectDelay: 800, // ms before an expelled item can even be considered for recollection
  groundRestHeight: 0.2, // matches the normal spawn height used by spawnTestZone
};
const GRAVITY = 14.0;
const GROUND_FRICTION_RATE = 8.0;
const BOUNCE_DAMPING = 0.35;
const BOUNCE_MIN_VELOCITY = 0.4;
const PHYSICS_REST_EPSILON = 0.02; // velocity^2 threshold below which drop physics stops running

export const DEBUG_RESOURCES = false;
export const DEBUG_RESOURCE_LABELS = false;

let nextResourceId = 1;

function createLabelSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '28px sans-serif';
  ctx.fillStyle = '#eafff2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.8, 0.2, 1);
  sprite.position.y = 0.5;
  return sprite;
}

/**
 * Owns every world resource: spawning, idle animation, proximity attraction,
 * and the absorb/reject state machine. Pure proximity checks - no raycasting.
 */
export class ResourceManager {
  constructor(scene, inventoryManager, uiManager, playerController, mutationSystem = null) {
    this.scene = scene;
    this.inventoryManager = inventoryManager;
    this.uiManager = uiManager;
    this.playerController = playerController;
    this.mutationSystem = mutationSystem; // optional - set post-construction if not available yet
    this.onAbsorbed = null; // optional - set post-construction (main.js), e.g. for run-stats tracking
    this.resources = [];
    this.particles = new AbsorbParticles(scene);
    this._elapsed = 0;
  }

  spawnResource(type, position) {
    const config = RESOURCE_TYPES[type];
    if (!config) throw new Error(`Unknown resource type: ${type}`);

    const mesh = createResourceMesh(type, config.color);
    mesh.scale.setScalar(config.modelScale);
    mesh.position.copy(position);
    if (DEBUG_RESOURCE_LABELS) mesh.add(createLabelSprite(config.name));
    this.scene.add(mesh);

    const resource = {
      id: nextResourceId++,
      type,
      name: config.name,
      weight: config.weight,
      value: config.value,
      color: config.color,
      mesh,
      state: 'idle', // idle | attracting | absorbing | rejected
      phase: Math.random() * Math.PI * 2,
      baseY: position.y,
      baseScale: config.modelScale,
      stateTime: 0,
      rejectVelocity: new THREE.Vector3(),
      // Expelled-item physics/recollection-cooldown state (unused by normally-spawned resources).
      velocity: new THREE.Vector3(),
      isPhysicsActive: false,
      collectible: true,
      collectibleAt: 0,
      hasLeftAttractionRadius: true,
    };
    this.resources.push(resource);

    if (DEBUG_RESOURCES) console.log(`Spawned ${resource.name}`);
    return resource;
  }

  /** Reuses the normal resource system for an expelled item: same mesh/attraction/absorption,
   *  just launched with velocity and temporarily non-collectible so it can't snap right back in. */
  spawnDroppedResource(type, spawnPosition, worldDirection) {
    const resource = this.spawnResource(type, spawnPosition);
    const config = RESOURCE_TYPES[type];

    const weightFactor = THREE.MathUtils.clamp(1 - config.weight * 0.08, 0.6, 1);
    const speed = EXPEL_PHYSICS.launchForce * weightFactor;

    resource.velocity.set(
      worldDirection.x * speed,
      EXPEL_PHYSICS.launchUpwardForce,
      worldDirection.z * speed
    );
    resource.isPhysicsActive = true;
    resource.baseY = EXPEL_PHYSICS.groundRestHeight;
    resource.collectible = false;
    resource.collectibleAt = performance.now() + EXPEL_PHYSICS.recollectDelay;
    resource.hasLeftAttractionRadius = false;

    if (DEBUG_RESOURCES) console.log(`Expelled ${resource.name}`);
    return resource;
  }

  /** Scatters countPerType of each resource type (except excludeTypes) in a ring around centerPosition. */
  spawnTestZone(centerPosition, countPerType = 4, { minRadius = 3, maxRadius = 15, excludeTypes = [] } = {}) {
    const spawnPos = new THREE.Vector3();
    for (const type of Object.keys(RESOURCE_TYPES)) {
      if (excludeTypes.includes(type)) continue;
      for (let i = 0; i < countPerType; i++) {
        let x, z;
        do {
          x = (Math.random() * 2 - 1) * maxRadius;
          z = (Math.random() * 2 - 1) * maxRadius;
        } while (x * x + z * z < minRadius * minRadius);
        spawnPos.set(centerPosition.x + x, 0.2, centerPosition.z + z);
        this.spawnResource(type, spawnPos);
      }
    }
  }

  getNearbyResources(position, radius) {
    const radiusSq = radius * radius;
    return this.resources.filter((r) => position.distanceToSquared(r.mesh.position) < radiusSq);
  }

  removeResource(resource) {
    this.scene.remove(resource.mesh);
    resource.mesh.traverse((child) => {
      if (!child.material) return;
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    });
    const index = this.resources.indexOf(resource);
    if (index !== -1) this.resources.splice(index, 1);
  }

  /** Full reset for a brand-new run (Play Again) - removes every resource regardless
   *  of its current state (idle, attracting, absorbing, expelled-and-falling).
   *  Respawning the configured starting population is the caller's job (main.js). */
  clearAll() {
    for (const resource of [...this.resources]) this.removeResource(resource);
  }

  update(deltaTime, playerPosition) {
    this._elapsed += deltaTime;

    for (let i = this.resources.length - 1; i >= 0; i--) {
      const resource = this.resources[i];
      resource.stateTime += deltaTime;

      if (resource.isPhysicsActive) {
        this._updateDropPhysics(resource, deltaTime);
        continue;
      }

      if (!resource.collectible) {
        this._updateCollectibleGate(resource, playerPosition);
        this._applyIdleAnimation(resource);
        continue;
      }

      if (resource.state === 'absorbing') {
        this._updateAbsorbing(resource, deltaTime, playerPosition);
        continue;
      }
      if (resource.state === 'rejected') {
        this._updateRejected(resource, deltaTime);
        continue;
      }

      const distSq = playerPosition.distanceToSquared(resource.mesh.position);

      if (distSq < ABSORB_RADIUS_SQ) {
        this._tryAbsorb(resource, playerPosition);
      } else if (distSq < ATTRACTION_RADIUS_SQ) {
        this._updateAttracting(resource, deltaTime, playerPosition, distSq);
      } else {
        resource.state = 'idle';
        this._applyIdleAnimation(resource);
      }
    }

    this.particles.update(deltaTime, playerPosition);
  }

  /** Simple gravity + ground contact + friction for an expelled item. Stops running once it rests. */
  _updateDropPhysics(resource, deltaTime) {
    const v = resource.velocity;
    v.y -= GRAVITY * deltaTime;
    resource.mesh.position.addScaledVector(v, deltaTime);

    const restHeight = resource.baseY;
    if (resource.mesh.position.y <= restHeight) {
      resource.mesh.position.y = restHeight;
      if (v.y < 0) {
        v.y = -v.y * BOUNCE_DAMPING;
        if (Math.abs(v.y) < BOUNCE_MIN_VELOCITY) v.y = 0;
      }
      const frictionT = 1 - Math.exp(-GROUND_FRICTION_RATE * deltaTime);
      v.x -= v.x * frictionT;
      v.z -= v.z * frictionT;
    }

    if (v.lengthSq() < PHYSICS_REST_EPSILON) {
      resource.isPhysicsActive = false;
      v.set(0, 0, 0);
    }
  }

  /** Gates recollection: needs the cooldown elapsed AND to have been outside the
   *  attraction radius at least once, so a freshly-dropped item can't snap right back in. */
  _updateCollectibleGate(resource, playerPosition) {
    if (performance.now() < resource.collectibleAt) return;
    const distSq = playerPosition.distanceToSquared(resource.mesh.position);
    if (distSq > ATTRACTION_RADIUS_SQ) resource.hasLeftAttractionRadius = true;
    if (resource.hasLeftAttractionRadius) {
      resource.collectible = true;
      resource.state = 'idle';
      if (DEBUG_RESOURCES) console.log(`${resource.name} collectible again`);
    }
  }

  _updateAttracting(resource, deltaTime, playerPosition, distSq) {
    resource.state = 'attracting';
    const t = 1 - Math.exp(-ATTRACTION_PULL_RATE * deltaTime);
    resource.mesh.position.lerp(playerPosition, t);
    resource.mesh.position.y = resource.baseY + 0.15; // slight lift while being pulled in

    const proximity = 1 - Math.sqrt(distSq) / ATTRACTION_RADIUS; // 0 (just entered) .. 1 (at center)
    resource.mesh.scale.setScalar(resource.baseScale * (1 - proximity * 0.35));

    if (resource.mesh.userData.pulseMaterials) {
      for (const mat of resource.mesh.userData.pulseMaterials) {
        mat.emissiveIntensity = 0.6 + proximity * 1.0;
      }
    }
  }

  _tryAbsorb(resource, playerPosition) {
    if (this.inventoryManager.canAddItem(resource.type)) {
      resource.state = 'absorbing';
      resource.stateTime = 0;
      this.particles.spawnBurst(resource.mesh.position, resource.color);
      this.playerController.triggerAbsorbPulse?.();
    } else {
      resource.state = 'rejected';
      resource.stateTime = 0;
      const away = resource.mesh.position.clone().sub(playerPosition);
      away.y = 0;
      if (away.lengthSq() < 1e-4) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      resource.rejectVelocity.copy(away.normalize().multiplyScalar(REJECT_PUSH_SPEED));

      this.uiManager.showInventoryFull();
      if (DEBUG_RESOURCES) console.log(`Inventory full - rejected ${resource.name}`);
    }
  }

  _updateAbsorbing(resource, deltaTime, playerPosition) {
    const t = Math.min(resource.stateTime / ABSORB_DURATION, 1);
    const pull = 1 - Math.exp(-16 * deltaTime);
    resource.mesh.position.lerp(playerPosition, pull);
    resource.mesh.scale.setScalar(Math.max(resource.baseScale * (1 - t), 0.001));

    if (t < 1) return;

    this.inventoryManager.addItem(resource);
    this.uiManager.updateMassUI(this.inventoryManager.getInventoryWeight(), this.inventoryManager.maxWeight);
    this.uiManager.showPickupNotification(resource.name);
    this.mutationSystem?.notifyResourceAbsorbed?.(resource.type); // records DNA as a permanent gene unlock
    this.mutationSystem?.onInventoryChanged();
    this.onAbsorbed?.(resource);

    if (DEBUG_RESOURCES) {
      console.log(`Absorbed ${resource.name}`);
      console.log(`Weight: ${this.inventoryManager.getInventoryWeight()} / ${this.inventoryManager.maxWeight}`);
    }
    this.removeResource(resource);
  }

  _updateRejected(resource, deltaTime) {
    resource.mesh.position.addScaledVector(resource.rejectVelocity, deltaTime);
    resource.rejectVelocity.multiplyScalar(Math.max(0, 1 - 4 * deltaTime));

    if (resource.stateTime > REJECT_COOLDOWN) {
      resource.state = 'idle';
      resource.mesh.scale.setScalar(resource.baseScale);
    }
  }

  _applyIdleAnimation(resource) {
    const { mesh, type, phase, baseY, baseScale } = resource;
    mesh.scale.setScalar(baseScale);

    switch (type) {
      case 'spore':
      case 'toxic_spore':
        mesh.position.y = baseY + Math.sin(this._elapsed * 1.6 + phase) * 0.06;
        if (mesh.userData.pulseMaterials) {
          const pulse = 0.6 + Math.sin(this._elapsed * 3 + phase) * 0.4;
          for (const mat of mesh.userData.pulseMaterials) mat.emissiveIntensity = 0.5 + pulse * 0.5;
        }
        break;
      case 'mushroom': {
        const breathe = 1 + Math.sin(this._elapsed * 2 + phase) * 0.05;
        mesh.scale.setScalar(baseScale * breathe);
        break;
      }
      case 'iron':
        if (mesh.userData.pulseMaterials) {
          const pulse = 0.4 + Math.sin(this._elapsed * 2.2 + phase) * 0.3;
          for (const mat of mesh.userData.pulseMaterials) mat.emissiveIntensity = 0.3 + pulse * 0.5;
        }
        break;
      case 'toxic_gland':
        mesh.position.y = baseY + Math.sin(this._elapsed * 1.4 + phase) * 0.05;
        if (mesh.userData.pulseMaterials) {
          const pulse = 0.5 + Math.sin(this._elapsed * 2.8 + phase) * 0.4;
          for (const mat of mesh.userData.pulseMaterials) mat.emissiveIntensity = 0.5 + pulse * 0.5;
        }
        break;
      case 'rat_dna':
      case 'beetle_dna':
      case 'predator_dna':
      case 'apex_dna':
      case 'rival_dna': {
        mesh.position.y = baseY + Math.sin(this._elapsed * 1.2 + phase) * 0.05;
        mesh.rotation.y = this._elapsed * 0.8 + phase;
        const pulse = 0.6 + Math.sin(this._elapsed * 2.4 + phase) * 0.4;
        if (mesh.userData.pulseMaterials) {
          for (const mat of mesh.userData.pulseMaterials) mat.emissiveIntensity = 0.7 + pulse * 0.7;
        }
        const orbiters = mesh.userData.dnaOrbiters;
        if (orbiters) {
          for (let i = 0; i < orbiters.length; i++) {
            const orbitAngle = this._elapsed * 2.5 + phase + (i / orbiters.length) * Math.PI * 2;
            orbiters[i].position.set(Math.cos(orbitAngle) * 0.18, Math.sin(orbitAngle * 1.7) * 0.09, Math.sin(orbitAngle) * 0.18);
          }
        }
        break;
      }
      case 'stone':
      default:
        break; // mostly stationary
    }
  }
}
