import * as THREE from 'three';
import { RESOURCE_TYPES } from './resourceTypes.js';
import { createResourceMesh } from './resourceModels.js';

export const DEBUG_PROJECTILE = false;

export const PROJECTILE_CONFIG = {
  damage: 10,
  speed: 15,
  // Deliberately shorter than it looks: the camera sees roughly 14 units ahead, so a
  // rock that expires at 11 dies just inside the visible area rather than sailing off
  // into fog. Missing should be legible as a miss, not as the rock vanishing.
  maxRange: 11,
  cooldown: 0.45,
  // Collision radius of the rock itself. The enemy's own girth is added on top
  // (targetRadius) because entities expose position but not a hitbox - see _hitCheck.
  radius: 0.22,
  targetRadius: 0.55,
  // How far in front of the player the rock appears. Just outside PLAYER_RADIUS (0.6)
  // so it never spawns visually inside the body it was launched from.
  spawnOffset: 0.72,
  spawnHeight: 0.55,
  spinSpeed: 9,
  knockbackForce: 0.5,
  // Visual scale relative to the resource's own modelScale. Bigger than the inventory
  // copy (which is shrunk to fit inside the body) so it reads at throwing distance.
  visualScale: 0.85,
};

/**
 * Resource types that can be thrown. Deliberately NOT "everything in the inventory":
 *
 *   - spore / mushroom are food, and MetabolismSystem's consume action is the only
 *     way to recover energy - firing those away would let the player delete their own
 *     survival resource by pressing the attack button.
 *   - every *_dna, toxic_spore and toxic_gland is a mutation ingredient; throwing one
 *     would silently destroy progression toward a recipe the player is collecting for.
 *
 * What is left is exactly stone and iron: heavy, inedible, worth little, and useful for
 * nothing except weighing Hollowdrop down. Before this system they were pure penalty -
 * something you picked up by accident and then had to find the wheel to drop. Making
 * them the ammunition turns the burden into a resource, which is the whole point.
 */
export const AMMO_TYPES = ['stone', 'iron'];

const tempForward = new THREE.Vector3();
const tempToTarget = new THREE.Vector3();

function playThrowSound() {}
function playImpactSound() {}

/**
 * Owns thrown-rock projectiles: firing (which spends an inventory item), flight,
 * the hit check, and impact.
 *
 * Knows nothing about any specific enemy. Like PlayerCombatController it damages
 * through the shared damageable-entity interface - each source in `damageableSources`
 * exposes getDamageableEntities(), and each entity exposes takeDamage(amount, info)
 * and a `.mesh`. Registering a new enemy means adding it to that array in main.js and
 * nothing here changes.
 *
 * Projectiles live in world space, parented to the scene rather than the player, so
 * they keep flying independently once released.
 */
export class ProjectileSystem {
  constructor({ scene, playerController, inventoryManager, damageableSources, uiManager }) {
    this.scene = scene;
    this.playerController = playerController;
    this.inventoryManager = inventoryManager;
    this.damageableSources = damageableSources;
    this.uiManager = uiManager;

    this.projectiles = [];
    this._cooldownTimer = 0;
    this._available = false;

    // Optional feedback hooks, assigned post-construction in main.js - the same wiring
    // pattern PlayerCombatController uses, so this class never imports screen shake,
    // hitstop or damage numbers.
    this.onHit = null;     // (entity, damage, worldPosition)
    this.onFired = null;   // (item)
    this.onImpact = null;  // (worldPosition, hitSomething)
  }

  /** Inventory items that are throwable, heaviest first - firing spends the heaviest
   *  rock available, which relieves the most burden per press. Iron (3) before
   *  Stone (2) is also the intuitive read: you throw the big one first. */
  getAmmo() {
    return this.inventoryManager.items
      .filter((item) => AMMO_TYPES.includes(item.type))
      .sort((a, b) => b.weight - a.weight);
  }

  getAmmoCount() {
    return this.getAmmo().length;
  }

  canFire() {
    return this._available && this._cooldownTimer <= 0 && this.getAmmoCount() > 0;
  }

  /** Shows/hides the throw button and hard-cancels availability. Driven every frame
   *  from main.js by the same `canAct` authority that gates Bite and the wheel. */
  setAvailable(available) {
    if (available === this._available) return;
    this._available = available;
    if (available) this.uiManager?.showThrowButton(() => this.fire());
    else this.uiManager?.hideThrowButton();
  }

  fire() {
    if (!this.canFire()) return false;

    const item = this.getAmmo()[0];
    const type = item.type;
    const config = RESOURCE_TYPES[type];

    // Spend it FIRST. removeItem() subtracts the weight, so the burden lifts on the
    // press rather than on impact - the player feels lighter the instant they throw,
    // which is what makes this read as "dumping ballast" and not just "an attack".
    this.inventoryManager.removeItem(item.id);
    this._cooldownTimer = PROJECTILE_CONFIG.cooldown;

    this.playerController.getForwardDirection(tempForward);

    const mesh = createResourceMesh(type, config.color);
    mesh.scale.setScalar(config.modelScale * PROJECTILE_CONFIG.visualScale);
    mesh.position
      .copy(this.playerController.mesh.position)
      .addScaledVector(tempForward, PROJECTILE_CONFIG.spawnOffset);
    mesh.position.y = PROJECTILE_CONFIG.spawnHeight;
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      velocity: tempForward.clone().multiplyScalar(PROJECTILE_CONFIG.speed),
      travelled: 0,
      // Random tumble axis so two rocks thrown back to back don't spin identically.
      spinAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
    });

    playThrowSound();
    this.onFired?.(item);
    if (DEBUG_PROJECTILE) console.log('Threw', type, '- ammo left', this.getAmmoCount());
    return true;
  }

  update(deltaTime) {
    if (this._cooldownTimer > 0) this._cooldownTimer -= deltaTime;

    if (this._available) {
      this.uiManager?.updateThrowState(
        this.getAmmoCount(),
        Math.max(0, this._cooldownTimer),
        PROJECTILE_CONFIG.cooldown,
        this.canFire()
      );
    }

    // Reverse iteration: _destroy() splices, and walking backwards keeps the
    // remaining indices valid without a second pass.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = PROJECTILE_CONFIG.speed * deltaTime;

      p.mesh.position.addScaledVector(p.velocity, deltaTime);
      p.mesh.rotateOnAxis(p.spinAxis, PROJECTILE_CONFIG.spinSpeed * deltaTime);
      p.travelled += step;

      const hit = this._hitCheck(p);
      if (hit) {
        hit.takeDamage(PROJECTILE_CONFIG.damage, {
          sourceEntity: this.playerController,
          sourceType: 'player',
          attackType: 'thrown_rock',
          knockbackForce: PROJECTILE_CONFIG.knockbackForce,
        });
        playImpactSound();
        this.onHit?.(hit, PROJECTILE_CONFIG.damage, p.mesh.position);
        this.onImpact?.(p.mesh.position, true);
        this._destroy(i);
        continue;
      }

      if (p.travelled >= PROJECTILE_CONFIG.maxRange) {
        this.onImpact?.(p.mesh.position, false);
        this._destroy(i);
      }
    }
  }

  /** First damageable entity overlapping this projectile, or null. Distance is measured
   *  on XZ only: everything in this game walks on one ground plane, and the rock's
   *  fixed flight height would otherwise make it miss taller or shorter enemies for
   *  reasons the player cannot see. */
  _hitCheck(projectile) {
    const reach = PROJECTILE_CONFIG.radius + PROJECTILE_CONFIG.targetRadius;
    const reachSq = reach * reach;

    for (const source of this.damageableSources) {
      for (const entity of source.getDamageableEntities()) {
        tempToTarget.copy(entity.mesh.position).sub(projectile.mesh.position);
        tempToTarget.y = 0;
        if (tempToTarget.lengthSq() <= reachSq) return entity;
      }
    }
    return null;
  }

  _destroy(index) {
    const [p] = this.projectiles.splice(index, 1);
    this.scene.remove(p.mesh);
    p.mesh.traverse((child) => {
      if (!child.material) return;
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    });
  }

  /** Full reset for a brand-new run (Play Again) - clears rocks still in the air, which
   *  would otherwise survive into the next run and damage freshly spawned enemies. */
  reset() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) this._destroy(i);
    this._cooldownTimer = 0;
  }
}
