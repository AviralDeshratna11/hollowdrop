import * as THREE from 'three';
import { playBiteSound, playBiteHitSound, playPoisonExpelSound } from './soundEffects.js?v=5.3';

export const DEBUG_COMBAT = false;

export const VENOM_BITE_CONFIG = {
  damage: 15,
  range: 1.35,
  cooldown: 0.6,
  windup: 0.09,
  activeTime: 0.12,
  recovery: 0.18,
  lungeDistance: 0.35,
  knockbackForce: 0.8,
  facingDotThreshold: 0.25,
};

export const POISON_EXPEL_CONFIG = {
  damage: 35,
  radius: 4.2,
  knockbackForce: 2.2,
};

const RANGE_SQ = VENOM_BITE_CONFIG.range * VENOM_BITE_CONFIG.range;
const POISON_RADIUS_SQ = POISON_EXPEL_CONFIG.radius * POISON_EXPEL_CONFIG.radius;

const ATTACK_STATES = { READY: 'READY', WINDUP: 'WINDUP', ACTIVE: 'ACTIVE', RECOVERY: 'RECOVERY' };

// Reused scratch vectors - no per-frame allocation in hot hit-check paths.
const tempForward = new THREE.Vector3();
const tempToTarget = new THREE.Vector3();
const tempAttackCenter = new THREE.Vector3();
const tempPlayerPos = new THREE.Vector3();
const tempHitPos = new THREE.Vector3();

function triggerCombatHaptic() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(25);
    } catch (_) {}
  }
}

/**
 * PlayerCombatController:
 * - Automatically triggers rhythmic proximity bite attacks on repeat when facing an enemy within range.
 * - Manages the manual once-per-transformation Poison Expel (Toxic Burst) ability.
 * - Handles animation blending, cooldowns, damage distribution, hitstop, and UI integration.
 */
export class PlayerCombatController {
  constructor({ playerController, damageableSources, uiManager }) {
    this.playerController = playerController;
    this.damageableSources = damageableSources;
    this.uiManager = uiManager;

    // Feedback hooks
    this.onHit = null;             // (entity, damage) - once per target per attack
    this.onAttackConnected = null; // () - once per attack that hit anything
    this.onBiteHit = null;         // (entity, hitPos, forwardDir) - for 3D fangs & splatter VFX
    this.onPoisonExpel = null;     // (centerPos, radius, hitCount) - for 360-deg toxic shockwave & spray VFX

    this.attackState = ATTACK_STATES.READY;
    this._stateTime = 0;
    this._cooldownTimer = 0;
    this._hitTargetsThisAttack = new Set();
    this._available = false;

    // Once-per-transformation Poison Expel charge
    this.poisonExpelAvailable = false;
  }

  canAttack() {
    return this._available && this.attackState === ATTACK_STATES.READY && this._cooldownTimer <= 0;
  }

  canUsePoisonExpel() {
    return this._available && this.poisonExpelAvailable;
  }

  /**
   * Resets the Poison Expel charge (called when mutating into Venom Rat).
   */
  resetPoisonExpelCharge() {
    this.poisonExpelAvailable = true;
    if (this._available && this.uiManager) {
      this.uiManager.updatePoisonBurstState(true);
    }
  }

  /**
   * Called every frame with whether combat is possible (alive, Venom Rat, not mutating/reverting).
   */
  setAvailable(available) {
    if (available === this._available) return;
    this._available = available;

    if (available) {
      this.uiManager.showPoisonBurstButton(() => this.tryPoisonExpel());
      this.uiManager.updatePoisonBurstState(this.poisonExpelAvailable);
    } else {
      this.cancelAttack();
      this.uiManager.hidePoisonBurstButton();
    }
  }

  /**
   * Manual trigger for Poison Expel (tapped via UI button or Space key).
   * Can only be used once per transformation.
   */
  tryPoisonExpel() {
    if (!this.canUsePoisonExpel()) return false;

    this.poisonExpelAvailable = false;
    this.uiManager.updatePoisonBurstState(false);

    tempPlayerPos.copy(this.playerController.mesh.position);
    playPoisonExpelSound();
    triggerCombatHaptic();

    let hitCount = 0;

    for (const source of this.damageableSources) {
      for (const entity of source.getDamageableEntities()) {
        tempToTarget.copy(entity.mesh.position).sub(tempPlayerPos);
        tempToTarget.y = 0;
        const distSq = tempToTarget.lengthSq();
        if (distSq > POISON_RADIUS_SQ) continue;

        // Calculate radial outward knockback
        if (distSq > 1e-6) tempToTarget.normalize();
        else tempToTarget.set(0, 0, 1);

        entity.takeDamage(POISON_EXPEL_CONFIG.damage, {
          sourceEntity: this.playerController,
          sourceType: 'player',
          attackType: 'poison_expel',
          knockbackForce: POISON_EXPEL_CONFIG.knockbackForce,
        });

        this.onHit?.(entity, POISON_EXPEL_CONFIG.damage);
        hitCount++;
      }
    }

    this.onPoisonExpel?.(tempPlayerPos, POISON_EXPEL_CONFIG.radius, hitCount);

    if (DEBUG_COMBAT) {
      console.log(`Poison Expel triggered! Hit ${hitCount} enemies.`);
    }

    return true;
  }

  /**
   * Initiates the bite attack sequence.
   */
  beginBite() {
    if (this.attackState !== ATTACK_STATES.READY) return;
    this.attackState = ATTACK_STATES.WINDUP;
    this._stateTime = 0;
    this._cooldownTimer = VENOM_BITE_CONFIG.cooldown;
    this._hitTargetsThisAttack.clear();
    playBiteSound();
    if (DEBUG_COMBAT) console.log('Auto-Bite started');
  }

  /**
   * Aborts in-progress bite.
   */
  cancelAttack() {
    this.attackState = ATTACK_STATES.READY;
    this._stateTime = 0;
    this._hitTargetsThisAttack.clear();
  }

  finishAttack() {
    this.attackState = ATTACK_STATES.READY;
    this._stateTime = 0;
  }

  /**
   * Main combat update loop:
   * - Ticks cooldown timer.
   * - Checks proximity & facing angle to automatically trigger rhythmic bite on repeat.
   * - Advances attack state machine (WINDUP -> ACTIVE -> RECOVERY -> READY).
   */
  update(deltaTime) {
    if (this._cooldownTimer > 0) {
      this._cooldownTimer = Math.max(0, this._cooldownTimer - deltaTime);
    }

    // Auto-Bite check when ready: if the rat is facing an enemy within bite range, trigger bite
    if (this.canAttack()) {
      if (this._checkAutoBiteTarget()) {
        this.beginBite();
      }
    }

    if (this.attackState === ATTACK_STATES.READY) return;
    this._stateTime += deltaTime;

    if (this.attackState === ATTACK_STATES.WINDUP) {
      if (this._stateTime >= VENOM_BITE_CONFIG.windup) {
        this.attackState = ATTACK_STATES.ACTIVE;
        this._stateTime = 0;
        this.performHitCheck();
      }
      return;
    }

    if (this.attackState === ATTACK_STATES.ACTIVE) {
      if (this._stateTime >= VENOM_BITE_CONFIG.activeTime) {
        this.attackState = ATTACK_STATES.RECOVERY;
        this._stateTime = 0;
      }
      return;
    }

    if (this.attackState === ATTACK_STATES.RECOVERY && this._stateTime >= VENOM_BITE_CONFIG.recovery) {
      this.finishAttack();
    }
  }

  /**
   * Scans damageable entities within the forward cone of the rat's mouth to detect if an auto-bite should trigger.
   */
  _checkAutoBiteTarget() {
    this.playerController.getForwardDirection(tempForward);
    tempAttackCenter.copy(this.playerController.mesh.position).addScaledVector(tempForward, VENOM_BITE_CONFIG.lungeDistance);

    for (const source of this.damageableSources) {
      for (const entity of source.getDamageableEntities()) {
        tempToTarget.copy(entity.mesh.position).sub(tempAttackCenter);
        tempToTarget.y = 0;
        const distSq = tempToTarget.lengthSq();
        if (distSq > RANGE_SQ) continue;

        if (distSq > 1e-6) {
          tempToTarget.normalize();
          if (tempForward.dot(tempToTarget) < VENOM_BITE_CONFIG.facingDotThreshold) continue;
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Performs the forward cone hit check during the ACTIVE attack window.
   */
  performHitCheck() {
    this.playerController.getForwardDirection(tempForward);
    tempAttackCenter.copy(this.playerController.mesh.position).addScaledVector(tempForward, VENOM_BITE_CONFIG.lungeDistance);

    let hitAny = false;
    for (const source of this.damageableSources) {
      for (const entity of source.getDamageableEntities()) {
        if (this._hitTargetsThisAttack.has(entity)) continue;

        tempToTarget.copy(entity.mesh.position).sub(tempAttackCenter);
        tempToTarget.y = 0;
        const distSq = tempToTarget.lengthSq();
        if (distSq > RANGE_SQ) continue;

        if (distSq > 1e-6) {
          tempToTarget.normalize();
          if (tempForward.dot(tempToTarget) < VENOM_BITE_CONFIG.facingDotThreshold) continue;
        }

        this._hitTargetsThisAttack.add(entity);
        entity.takeDamage(VENOM_BITE_CONFIG.damage, {
          sourceEntity: this.playerController,
          sourceType: 'player',
          attackType: 'venom_bite',
          knockbackForce: VENOM_BITE_CONFIG.knockbackForce,
        });

        tempHitPos.copy(entity.mesh.position);
        this.onHit?.(entity, VENOM_BITE_CONFIG.damage);
        this.onBiteHit?.(entity, tempHitPos, tempForward);
        hitAny = true;
      }
    }

    if (hitAny) {
      playBiteHitSound();
      triggerCombatHaptic();
      this.onAttackConnected?.();
    }
  }

  /**
   * Pure, read-only pose for PlayerFormController._updateRatIdle to blend on top of idle animations.
   */
  getBitePose() {
    if (this.attackState === ATTACK_STATES.WINDUP) {
      const t = this._stateTime / VENOM_BITE_CONFIG.windup;
      return { lungeOffset: 0, crouchScale: THREE.MathUtils.lerp(1, 0.88, t) };
    }
    if (this.attackState === ATTACK_STATES.ACTIVE) {
      const t = this._stateTime / VENOM_BITE_CONFIG.activeTime;
      return {
        lungeOffset: VENOM_BITE_CONFIG.lungeDistance * Math.sin(t * Math.PI),
        crouchScale: THREE.MathUtils.lerp(0.88, 1.08, t),
      };
    }
    if (this.attackState === ATTACK_STATES.RECOVERY) {
      const t = this._stateTime / VENOM_BITE_CONFIG.recovery;
      return {
        lungeOffset: VENOM_BITE_CONFIG.lungeDistance * (1 - t) * 0.3,
        crouchScale: THREE.MathUtils.lerp(1.08, 1, t),
      };
    }
    return null;
  }
}
