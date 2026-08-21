import * as THREE from 'three';

export const DEBUG_COMBAT = false;

export const VENOM_BITE_CONFIG = {
  damage: 15,
  range: 1.25,
  cooldown: 0.6,
  windup: 0.1,
  activeTime: 0.12,
  recovery: 0.2,
  lungeDistance: 0.35,
  knockbackForce: 0.8,
  // How far off-center a target can be and still get hit (1 = dead ahead, 0 =
  // perpendicular) - forgiving on purpose, this is a mobile game, not an aim-trainer.
  facingDotThreshold: 0.25,
};

const RANGE_SQ = VENOM_BITE_CONFIG.range * VENOM_BITE_CONFIG.range;

const ATTACK_STATES = { READY: 'READY', WINDUP: 'WINDUP', ACTIVE: 'ACTIVE', RECOVERY: 'RECOVERY' };

// Reused scratch vectors - no per-frame allocation in the hit-check hot path.
const tempForward = new THREE.Vector3();
const tempToTarget = new THREE.Vector3();
const tempAttackCenter = new THREE.Vector3();

// Optional, currently silent - hooks so audio/haptics can be added later without
// touching combat logic.
function playBiteSound() {}
function playBiteHitSound() {}
function triggerCombatHaptic() {}

/**
 * Owns Venom Bite: a small READY -> WINDUP -> ACTIVE -> RECOVERY state machine,
 * the forward-cone hit check, and the cooldown. Deliberately knows nothing about
 * UI beyond calling UIManager's bite-button methods, nothing about the Rat's visual
 * (PlayerFormController._updateRatIdle reads getBitePose() and blends it in, so
 * there's exactly one writer of ratVisual's transform), and nothing about any
 * specific enemy type - it only ever calls entity.takeDamage(amount, info), the same
 * interface PreyManager's entities and PredatorController both implement, gathered
 * each hit-check from `damageableSources` (each exposing getDamageableEntities()).
 * Extending combat to a new enemy means registering another source here, never
 * branching on entity.type inside this class.
 */
export class PlayerCombatController {
  constructor({ playerController, damageableSources, uiManager }) {
    this.playerController = playerController;
    this.damageableSources = damageableSources;
    this.uiManager = uiManager;

    this.attackState = ATTACK_STATES.READY;
    this._stateTime = 0;
    this._cooldownTimer = 0;
    this._hitTargetsThisAttack = new Set();
    this._available = false; // driven every frame by setAvailable() - see main.js
  }

  canAttack() {
    return this._available && this.attackState === ATTACK_STATES.READY && this._cooldownTimer <= 0;
  }

  /** Called every frame by main.js with whether combat should currently be possible
   *  (alive, Venom Rat, not mid-transformation/reversion). Cancels any in-progress
   *  bite the instant this flips false - a single authority for "can I fight right
   *  now", rather than threading cancellation calls through every system that could
   *  end the Rat form (reversion, death, respawn all naturally funnel through here). */
  setAvailable(available) {
    if (available === this._available) return;
    this._available = available;
    if (available) {
      this.uiManager.showBiteButton(() => this.tryBite());
    } else {
      this.cancelAttack();
      this.uiManager.hideBiteButton();
    }
  }

  /** Player-facing entry point (button tap or debug key). Ignored outright while on
   *  cooldown/mid-attack/unavailable - never queues, never stacks presses. */
  tryBite() {
    if (!this.canAttack()) return false;
    this.beginBite();
    return true;
  }

  beginBite() {
    this.attackState = ATTACK_STATES.WINDUP;
    this._stateTime = 0;
    this._cooldownTimer = VENOM_BITE_CONFIG.cooldown;
    this._hitTargetsThisAttack.clear();
    playBiteSound();
    if (DEBUG_COMBAT) console.log('Bite started');
  }

  /** Aborts a bite in progress (reversion/death mid-attack) - clears state without
   *  performing a hit check. Cooldown is deliberately left running: an interrupted
   *  attack shouldn't be refunded. */
  cancelAttack() {
    this.attackState = ATTACK_STATES.READY;
    this._stateTime = 0;
    this._hitTargetsThisAttack.clear();
  }

  finishAttack() {
    this.attackState = ATTACK_STATES.READY;
    this._stateTime = 0;
  }

  update(deltaTime) {
    if (this._cooldownTimer > 0) this._cooldownTimer = Math.max(0, this._cooldownTimer - deltaTime);
    if (this._available) this.uiManager.updateBiteCooldown(this._cooldownTimer, VENOM_BITE_CONFIG.cooldown, this.canAttack());

    if (this.attackState === ATTACK_STATES.READY) return;
    this._stateTime += deltaTime;

    if (this.attackState === ATTACK_STATES.WINDUP) {
      if (this._stateTime >= VENOM_BITE_CONFIG.windup) {
        this.attackState = ATTACK_STATES.ACTIVE;
        this._stateTime = 0;
        this.performHitCheck(); // hit window opens the instant ACTIVE begins
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

  /** Short forward cone from a point slightly ahead of the player, along whichever
   *  way PlayerController currently has the Rat facing (never auto-aimed at a
   *  target) - a hit needs to be both close enough AND roughly in front. Each
   *  target can only be hit once per attack via _hitTargetsThisAttack (keyed by
   *  the entity object itself, so it works uniformly whether the entity came from
   *  a manager-owned array or a singleton like PredatorController). */
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
        hitAny = true;
      }
    }

    if (hitAny) {
      playBiteHitSound();
      triggerCombatHaptic();
    }
    // Miss: cooldown/animation still ran, nothing refunded (spec section 24) - simply nothing more to do here.
  }

  /** Pure, read-only pose for PlayerFormController's _updateRatIdle to blend on top
   *  of its own idle animation - null while READY (no bite in progress). Keeps
   *  ratVisual.position/scale writes to exactly one owner. */
  getBitePose() {
    if (this.attackState === ATTACK_STATES.WINDUP) {
      const t = this._stateTime / VENOM_BITE_CONFIG.windup;
      return { lungeOffset: 0, crouchScale: THREE.MathUtils.lerp(1, 0.9, t) };
    }
    if (this.attackState === ATTACK_STATES.ACTIVE) {
      const t = this._stateTime / VENOM_BITE_CONFIG.activeTime;
      return { lungeOffset: VENOM_BITE_CONFIG.lungeDistance * Math.sin(t * Math.PI), crouchScale: THREE.MathUtils.lerp(0.9, 1.05, t) };
    }
    if (this.attackState === ATTACK_STATES.RECOVERY) {
      const t = this._stateTime / VENOM_BITE_CONFIG.recovery;
      return { lungeOffset: VENOM_BITE_CONFIG.lungeDistance * (1 - t) * 0.3, crouchScale: THREE.MathUtils.lerp(1.05, 1, t) };
    }
    return null;
  }
}
