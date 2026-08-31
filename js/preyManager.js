import * as THREE from 'three';
import { createGlowBeetleMesh } from './preyModel.js?v=5.3';
import { PLAYER_FORMS } from './playerFormController.js?v=5.3';
import { updateEntityHealthBar } from './entityHealthBar.js?v=5.3';
import { getTerrainHeight } from './terrain.js?v=5.3';

export const DEBUG_PREY = false;

// Tuned relative to PlayerController's PLAYER_MAX_SPEED (6.0): Venom Rat's own max is
// 6.0*1.25=7.5 (see FORM_CONFIG.venomRat), so fleeSpeed sits between Slime's base and
// the Rat's - Rat can run it down, Slime (even before burden) cannot on a straight chase.
export const GLOW_BEETLE_CONFIG = {
  maxHealth: 30,
  wanderSpeed: 0.7,
  fleeSpeed: 6.3,
  wanderRadius: 3,
  wanderPauseTime: 1.5,
  // Only meaningfully threatened by Venom Rat (section 33 of the spec) - Slime has to
  // be almost on top of it before it reacts at all.
  fleeRadiusVenomRat: 4,
  fleeRadiusSlime: 1.2,
  // Hysteresis: "far enough to relax" is a bit past the trigger radius, so it doesn't
  // flicker WANDER/FLEE right at the boundary.
  loseRadiusVenomRat: 5.5,
  loseRadiusSlime: 2,
  territoryRadius: 9, // hard clamp instead of pathfinding/navmesh (spec explicitly rules those out)
  turnRate: 8.0,
  knockbackSpeedScale: 4.0, // converts VENOM_BITE_CONFIG.knockbackForce into an initial velocity
  knockbackDecayRate: 8.0,
  hitFlashDuration: 0.12,
  healthBarVisibleDuration: 1.8,
  healthBarFadeStart: 0.3,
  deathDuration: 0.45,
  lootScatter: 0.35,
};

const PREY_STATES = { WANDER: 'WANDER', FLEE: 'FLEE', DEAD: 'DEAD' };

const FLEE_RADIUS_RAT_SQ = GLOW_BEETLE_CONFIG.fleeRadiusVenomRat ** 2;
const FLEE_RADIUS_SLIME_SQ = GLOW_BEETLE_CONFIG.fleeRadiusSlime ** 2;
const LOSE_RADIUS_RAT_SQ = GLOW_BEETLE_CONFIG.loseRadiusVenomRat ** 2;
const LOSE_RADIUS_SLIME_SQ = GLOW_BEETLE_CONFIG.loseRadiusSlime ** 2;
const TERRITORY_RADIUS_SQ = GLOW_BEETLE_CONFIG.territoryRadius ** 2;
const WANDER_ARRIVE_SQ = 0.25 * 0.25;

// Reused scratch vectors - no per-frame allocation in the AI/hit-detection hot path.
const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempNextPos = new THREE.Vector3();

function horizontalDistanceSq(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

// Optional, currently silent - hooks so audio can be added later without touching this logic.
function playPreyDeathSound() {}
function playDNADropSound() {}

let nextPreyId = 1;

/**
 * Owns every Glow Beetle: wander/flee AI, health/damage, hit-flash + fading world-space
 * health bar, death, and loot drop. Reads player position/form only (never touches
 * movement/input); damage comes in exclusively through damageEntity(), the same
 * reusable (amount, info) shape PlayerHealthState.takeDamage() already uses, so a
 * future enemy type could implement the identical interface with no changes here.
 */
export class PreyManager {
  constructor(scene, playerController, playerFormController, resourceManager, uiManager, { onDefeated } = {}) {
    this.scene = scene;
    this.playerController = playerController;
    this.playerFormController = playerFormController;
    this.resourceManager = resourceManager;
    this.uiManager = uiManager;
    this.onDefeated = onDefeated; // optional - fires once per _die(), e.g. for run-stats tracking
    this.prey = [];
  }

  spawnGlowBeetle(position) {
    const mesh = createGlowBeetleMesh();
    mesh.position.copy(position);
    this.scene.add(mesh);

    const entity = {
      id: nextPreyId++,
      type: 'glow_beetle',
      mesh,
      maxHealth: GLOW_BEETLE_CONFIG.maxHealth,
      currentHealth: GLOW_BEETLE_CONFIG.maxHealth,
      state: PREY_STATES.WANDER,
      homePosition: position.clone(),
      wanderTarget: new THREE.Vector3(),
      wanderPauseTimer: 0,
      fleeDirection: new THREE.Vector3(),
      facingAngle: 0,
      knockbackVelocity: new THREE.Vector3(),
      hitFlashTime: null,
      healthBarTimer: null,
      deathTime: null,
      _phase: Math.random() * Math.PI * 2, // offsets idle animation so beetles don't move in lockstep
    };
    // Uniform interface for PlayerCombatController (section 47 of the combat spec):
    // it can call entity.takeDamage(amount, info) without knowing it's manager-owned -
    // same shape PredatorController implements as a real method on itself.
    entity.takeDamage = (amount, info) => this.damageEntity(entity, amount, info);

    this._pickNewWanderTarget(entity);
    this.prey.push(entity);

    if (DEBUG_PREY) console.log('Glow Beetle spawned at', position);
    return entity;
  }

  /** Living, damageable prey only - PlayerCombatController's hit check should never
   *  see (or re-hit) something already in its death animation. */
  getDamageableEntities() {
    return this.prey.filter((p) => p.state !== PREY_STATES.DEAD);
  }

  update(deltaTime) {
    for (let i = this.prey.length - 1; i >= 0; i--) {
      const entity = this.prey[i];

      if (entity.state === PREY_STATES.DEAD) {
        this._updateDeath(entity, deltaTime, i);
        continue;
      }

      this._applyKnockback(entity, deltaTime);

      if (entity.state === PREY_STATES.WANDER) this._updateWander(entity, deltaTime);
      else if (entity.state === PREY_STATES.FLEE) this._updateFlee(entity, deltaTime);

      if (entity.state !== PREY_STATES.DEAD) {
        const targetY = getTerrainHeight(entity.mesh.position.x, entity.mesh.position.z);
        const ySmooth = 1 - Math.exp(-12.0 * deltaTime);
        entity.mesh.position.y += (targetY - entity.mesh.position.y) * ySmooth;
      }

      this._updateHitFlash(entity, deltaTime);
      this._updateHealthBar(entity, deltaTime);
      this._applyIdleAnimation(entity, deltaTime);
    }
  }

  // --- Damage interface --------------------------------------------------------

  /** Reusable damageable-entity interface: (entity, amount, info) where info carries
   *  sourceEntity/sourceType/attackType (and optionally knockbackForce) - the same
   *  shape future enemies (Predator, Apex Predator, Rival Slime) could implement
   *  without PlayerCombatController ever branching on entity.type. Returns true if
   *  the hit actually landed (false if already dead). */
  damageEntity(entity, amount, info = {}) {
    if (entity.state === PREY_STATES.DEAD) return false;

    entity.currentHealth = Math.max(0, entity.currentHealth - amount);
    entity.hitFlashTime = 0;
    entity.healthBarTimer = GLOW_BEETLE_CONFIG.healthBarVisibleDuration;

    const sourcePos = info.sourceEntity?.mesh?.position ?? info.sourceEntity?.position;
    if (sourcePos) {
      tempA.copy(entity.mesh.position).sub(sourcePos);
      tempA.y = 0;
      if (tempA.lengthSq() < 1e-6) tempA.set(0, 0, 1);
      else tempA.normalize();
      const knockbackForce = info.knockbackForce ?? 0.5;
      entity.knockbackVelocity.copy(tempA).multiplyScalar(knockbackForce * GLOW_BEETLE_CONFIG.knockbackSpeedScale);
    }

    this.resourceManager.particles.spawnBurst(entity.mesh.position, 0xff5c5c, 5);

    if (DEBUG_PREY) {
      console.log(`Bite hit ${entity.type}\nDamage: ${amount}`);
      console.log(`${entity.type} HP:\n${entity.currentHealth} / ${entity.maxHealth}`);
    }

    if (entity.currentHealth <= 0) this._die(entity);
    return true;
  }

  // --- States --------------------------------------------------------------

  _updateWander(entity, deltaTime) {
    const distToTargetSq = horizontalDistanceSq(entity.mesh.position, entity.wanderTarget);
    if (distToTargetSq < WANDER_ARRIVE_SQ) {
      entity.wanderPauseTimer += deltaTime;
      if (entity.wanderPauseTimer > GLOW_BEETLE_CONFIG.wanderPauseTime) {
        this._pickNewWanderTarget(entity);
        entity.wanderPauseTimer = 0;
      }
    } else {
      this._moveToward(entity, entity.wanderTarget, GLOW_BEETLE_CONFIG.wanderSpeed, deltaTime);
    }

    this._checkThreat(entity);
  }

  _checkThreat(entity) {
    const isRat = this.playerFormController.currentForm === PLAYER_FORMS.VENOM_RAT;
    const fleeRadiusSq = isRat ? FLEE_RADIUS_RAT_SQ : FLEE_RADIUS_SLIME_SQ;
    const distSq = horizontalDistanceSq(entity.mesh.position, this.playerController.mesh.position);
    if (distSq < fleeRadiusSq) {
      entity.state = PREY_STATES.FLEE;
      if (DEBUG_PREY) console.log('Glow Beetle: WANDER -> FLEE');
    }
  }

  _updateFlee(entity, deltaTime) {
    const playerPos = this.playerController.mesh.position;
    const distSq = horizontalDistanceSq(entity.mesh.position, playerPos);
    const isRat = this.playerFormController.currentForm === PLAYER_FORMS.VENOM_RAT;
    const loseRadiusSq = isRat ? LOSE_RADIUS_RAT_SQ : LOSE_RADIUS_SLIME_SQ;

    if (distSq > loseRadiusSq) {
      entity.state = PREY_STATES.WANDER;
      this._pickNewWanderTarget(entity); // resumes wandering from wherever it ended up, not a snap-home
      if (DEBUG_PREY) console.log('Glow Beetle: FLEE -> WANDER');
      return;
    }

    // Direction away from the player, plus a slight smoothed sideways wobble so it
    // doesn't read as perfectly robotic (spec section 34) - the wobble angle itself
    // changes continuously via sin(), but fleeDirection is lerped toward it rather
    // than snapping, so the beetle's actual heading never jitters frame to frame.
    tempA.copy(entity.mesh.position).sub(playerPos);
    tempA.y = 0;
    if (tempA.lengthSq() > 1e-6) tempA.normalize();
    else tempA.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();

    const wobble = Math.sin(performance.now() * 0.0015 + entity._phase) * 0.4;
    tempB.set(-tempA.z, 0, tempA.x).multiplyScalar(wobble);
    tempA.add(tempB);
    if (tempA.lengthSq() > 1e-6) tempA.normalize();

    const fleeSmooth = 1 - Math.exp(-4 * deltaTime);
    entity.fleeDirection.lerp(tempA, fleeSmooth);
    if (entity.fleeDirection.lengthSq() > 1e-6) entity.fleeDirection.normalize();

    // Territory clamp instead of pathfinding (spec explicitly rules out navmesh/A*):
    // simply refuses a step that would leave the home radius, so it stalls at the
    // edge rather than fleeing forever.
    tempNextPos.copy(entity.mesh.position).addScaledVector(entity.fleeDirection, GLOW_BEETLE_CONFIG.fleeSpeed * deltaTime);
    if (horizontalDistanceSq(tempNextPos, entity.homePosition) <= TERRITORY_RADIUS_SQ) {
      entity.mesh.position.copy(tempNextPos);
    }

    this._faceDirection(entity, entity.fleeDirection, deltaTime, GLOW_BEETLE_CONFIG.turnRate);
  }

  _die(entity) {
    if (entity.state === PREY_STATES.DEAD) return; // never process death twice
    entity.state = PREY_STATES.DEAD;
    entity.deathTime = 0;
    entity.healthBarTimer = null;
    updateEntityHealthBar(entity.mesh.userData.healthBar, 0, null, GLOW_BEETLE_CONFIG.healthBarFadeStart);

    this.resourceManager.particles.spawnBurst(entity.mesh.position, 0x5dffd6, 10);
    playPreyDeathSound();
    this.onDefeated?.();
    if (DEBUG_PREY) console.log('Glow Beetle died');
  }

  _updateDeath(entity, deltaTime, index) {
    entity.deathTime += deltaTime;
    const t = Math.min(entity.deathTime / GLOW_BEETLE_CONFIG.deathDuration, 1);
    entity.mesh.scale.setScalar(Math.max(1 - t, 0.001));
    entity.mesh.position.y = entity.homePosition.y - t * 0.15; // sinks slightly as it collapses

    if (t < 1) return;

    this._dropLoot(entity);

    this.scene.remove(entity.mesh);
    entity.mesh.traverse((child) => {
      if (!child.material) return;
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    });
    this.prey.splice(index, 1); // no corpse system - fully removed once loot is out
  }

  _dropLoot(entity) {
    const center = entity.mesh.position;
    const scatter = GLOW_BEETLE_CONFIG.lootScatter;
    const dnaPos = new THREE.Vector3(center.x - scatter, getTerrainHeight(center.x - scatter, center.z), center.z);
    const biomassPos = new THREE.Vector3(center.x + scatter, getTerrainHeight(center.x + scatter, center.z), center.z);

    this.resourceManager.spawnResource('beetle_dna', dnaPos);
    // "Organic Biomass" reuses the existing edible Moon Mushroom resource rather than
    // inventing a second organic type - same nutritional role, already fully wired
    // (visuals, idle animation, Consume) end to end.
    this.resourceManager.spawnResource('mushroom', biomassPos);

    playDNADropSound();
    if (DEBUG_PREY) console.log('Dropped Beetle DNA\nDropped Organic Biomass');
  }

  /** Full reset for a brand-new run (Play Again) - removes every Glow Beetle
   *  regardless of its current state (wandering, fleeing, mid-death-animation).
   *  Respawning the configured starting population is the caller's job (main.js),
   *  same as it is on first load. */
  clearAll() {
    for (const entity of this.prey) {
      this.scene.remove(entity.mesh);
      entity.mesh.traverse((child) => {
        if (!child.material) return;
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      });
    }
    this.prey = [];
  }

  // --- Shared helpers --------------------------------------------------------

  _pickNewWanderTarget(entity) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * GLOW_BEETLE_CONFIG.wanderRadius;
    entity.wanderTarget.set(
      entity.homePosition.x + Math.cos(angle) * radius,
      entity.mesh.position.y,
      entity.homePosition.z + Math.sin(angle) * radius
    );
  }

  _moveToward(entity, target, speed, deltaTime) {
    tempA.copy(target).sub(entity.mesh.position);
    tempA.y = 0;
    if (tempA.lengthSq() > 1e-6) {
      tempA.normalize();
      entity.mesh.position.addScaledVector(tempA, speed * deltaTime);
    }
    this._faceDirection(entity, tempA, deltaTime, GLOW_BEETLE_CONFIG.turnRate * 0.6);
  }

  /** Smoothly yaws the model to face `direction`. Model faces -Z at rotation.y = 0
   *  (same convention as every other model in this project). */
  _faceDirection(entity, direction, deltaTime, turnRate) {
    if (direction.lengthSq() < 1e-6) return;
    const targetAngle = Math.atan2(-direction.x, -direction.z);
    let angleDiff = targetAngle - entity.facingAngle;
    angleDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
    const t = 1 - Math.exp(-turnRate * deltaTime);
    entity.facingAngle += angleDiff * t;
    entity.mesh.rotation.y = entity.facingAngle;
  }

  _applyKnockback(entity, deltaTime) {
    if (entity.knockbackVelocity.lengthSq() < 1e-6) return;
    entity.mesh.position.addScaledVector(entity.knockbackVelocity, deltaTime);
    const decay = 1 - Math.exp(-GLOW_BEETLE_CONFIG.knockbackDecayRate * deltaTime);
    entity.knockbackVelocity.multiplyScalar(1 - decay);
    if (entity.knockbackVelocity.lengthSq() < 1e-4) entity.knockbackVelocity.set(0, 0, 0);
  }

  _updateHitFlash(entity, deltaTime) {
    const { shellMaterial } = entity.mesh.userData;
    if (entity.hitFlashTime === null) return;

    entity.hitFlashTime += deltaTime;
    const t = Math.min(entity.hitFlashTime / GLOW_BEETLE_CONFIG.hitFlashDuration, 1);
    if (t >= 1) {
      entity.hitFlashTime = null;
      shellMaterial.emissiveIntensity = 0.2; // restored exactly to resting value
      return;
    }
    shellMaterial.emissiveIntensity = 0.2 + (1 - t) * 2.6;
  }

  _updateHealthBar(entity, deltaTime) {
    if (entity.healthBarTimer !== null) entity.healthBarTimer -= deltaTime;
    const ratio = entity.currentHealth / entity.maxHealth;
    updateEntityHealthBar(entity.mesh.userData.healthBar, ratio, entity.healthBarTimer, GLOW_BEETLE_CONFIG.healthBarFadeStart);
    if (entity.healthBarTimer !== null && entity.healthBarTimer <= 0) entity.healthBarTimer = null;
  }

  _applyIdleAnimation(entity, deltaTime) {
    const { legs } = entity.mesh.userData;
    const speed = entity.state === PREY_STATES.FLEE ? GLOW_BEETLE_CONFIG.fleeSpeed : GLOW_BEETLE_CONFIG.wanderSpeed * 0.6;
    const t = performance.now() * 0.001 * (2 + speed);
    const legSwing = Math.sin(t + entity._phase) * (entity.state === PREY_STATES.FLEE ? 0.35 : 0.15);
    for (let i = 0; i < legs.length; i++) {
      legs[i].rotation.x = 0.1 + legSwing * (i % 2 === 0 ? 1 : -1);
    }
  }
}
