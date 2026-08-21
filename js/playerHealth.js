import * as THREE from 'three';

export const DEBUG_HEALTH = false;

export const HEALTH_CONFIG = {
  maxHealth: 100,
  invulnerabilityDuration: 0.6,
  knockbackSpeed: 3.5,
  criticalThreshold: 0.4, // at/below this ratio: stronger diegetic feedback
  severeThreshold: 0.2, // at/below this ratio: strongest diegetic feedback
};

const tempKnockback = new THREE.Vector3();

/**
 * Player health: damage validation, invulnerability, knockback, and death
 * triggering - the single place currentHealth is ever written. Predators and
 * future hazards call takeDamage(amount, source); nothing else touches health
 * directly. Does NOT own the death animation / resource-drop / respawn
 * sequence itself - that's DeathRespawnManager's job, driven by the onDeath
 * hook, keeping this class focused on "what health IS" rather than "what
 * happens narratively when it hits zero".
 */
export class PlayerHealthState {
  constructor(
    playerController,
    uiManager,
    {
      maxHealth = HEALTH_CONFIG.maxHealth,
      invulnerabilityDuration = HEALTH_CONFIG.invulnerabilityDuration,
      onDamaged,
      onDeath,
      onRespawn,
      onCriticalHealth,
    } = {}
  ) {
    this.playerController = playerController;
    this.uiManager = uiManager;
    this.maxHealth = maxHealth;
    this.currentHealth = maxHealth;
    this.invulnerabilityDuration = invulnerabilityDuration;

    this.isDead = false;
    this._invulnTimer = 0;
    this._wasCritical = false;

    // Settable any time, not just at construction - DeathRespawnManager wires
    // onDeath/onRespawn after this object already exists.
    this.onDamaged = onDamaged;
    this.onDeath = onDeath;
    this.onRespawn = onRespawn;
    this.onCriticalHealth = onCriticalHealth;

    this.uiManager.updateHealthUI(this.currentHealth, this.maxHealth);
  }

  get isInvulnerable() {
    return this._invulnTimer > 0;
  }

  getHealthRatio() {
    return this.currentHealth / this.maxHealth;
  }

  /** Returns true if the hit actually landed (false if invulnerable/already dead). */
  takeDamage(amount, source) {
    if (this.isDead || this.isInvulnerable) return false;

    this.currentHealth = Math.max(0, this.currentHealth - amount);
    this._invulnTimer = this.invulnerabilityDuration;
    this._triggerDamageFeedback(source);
    this.uiManager.updateHealthUI(this.currentHealth, this.maxHealth);
    this.onDamaged?.(amount, source);

    if (DEBUG_HEALTH) {
      console.log(`Player hit: -${amount}`);
      console.log(`Health: ${this.currentHealth} / ${this.maxHealth}`);
    }

    const ratio = this.getHealthRatio();
    if (ratio <= HEALTH_CONFIG.criticalThreshold && !this._wasCritical) {
      this._wasCritical = true;
      this.onCriticalHealth?.();
    } else if (ratio > HEALTH_CONFIG.criticalThreshold) {
      this._wasCritical = false;
    }

    if (this.currentHealth <= 0) this._die();
    return true;
  }

  /**
   * Non-combat damage (starvation, future hazards): decreases health and can still
   * trigger death, but deliberately skips everything takeDamage() does around combat
   * - no invulnerability check/grant, no hit-flash/pulse/knockback. Keeping this
   * separate means starvation ticks and predator-hit invulnerability can never
   * interfere with each other in either direction.
   */
  takeEnvironmentalDamage(amount, source) {
    if (this.isDead) return false;

    this.currentHealth = Math.max(0, this.currentHealth - amount);
    this.uiManager.updateHealthUI(this.currentHealth, this.maxHealth);
    this.onDamaged?.(amount, source);

    if (this.currentHealth <= 0) this._die();
    return true;
  }

  heal(amount) {
    if (this.isDead) return;
    this.currentHealth = Math.min(this.currentHealth + amount, this.maxHealth);
    this.uiManager.updateHealthUI(this.currentHealth, this.maxHealth);
  }

  /** Temporary invulnerability not caused by taking damage (e.g. respawn protection). */
  grantInvulnerability(duration) {
    this._invulnTimer = Math.max(this._invulnTimer, duration);
  }

  _die() {
    if (this.isDead) return; // never trigger the death sequence twice
    this.isDead = true;
    if (DEBUG_HEALTH) console.log('Player died');
    this.onDeath?.();
  }

  /** Called by DeathRespawnManager once the respawn sequence is ready to restore the player. */
  reset() {
    this.currentHealth = this.maxHealth;
    this.isDead = false;
    this._invulnTimer = 0;
    this._wasCritical = false;
    this.uiManager.updateHealthUI(this.currentHealth, this.maxHealth);
    if (DEBUG_HEALTH) console.log('Health restored');
    this.onRespawn?.();
  }

  _triggerDamageFeedback(source) {
    this.playerController.triggerHitFlash();
    this.playerController.triggerAbsorbPulse(); // reuse the generic membrane-bump for the damage squash

    const knockback = this._computeKnockback(source);
    if (knockback) this.playerController.applyImpulse(knockback);
  }

  /** Accepts a predator/hazard (anything with .mesh.position), a plain .position, or a
   *  raw Vector3-like as `source`. Returns null (no knockback) if no position is available. */
  _computeKnockback(source) {
    const sourcePos = source?.mesh?.position ?? source?.position ?? (source && typeof source.x === 'number' ? source : null);
    if (!sourcePos) return null;

    tempKnockback.copy(this.playerController.mesh.position).sub(sourcePos);
    tempKnockback.y = 0;
    if (tempKnockback.lengthSq() < 1e-6) tempKnockback.set(0, 0, 1);
    tempKnockback.normalize().multiplyScalar(HEALTH_CONFIG.knockbackSpeed);
    return tempKnockback;
  }

  update(deltaTime) {
    if (this._invulnTimer > 0) this._invulnTimer = Math.max(0, this._invulnTimer - deltaTime);
  }
}
