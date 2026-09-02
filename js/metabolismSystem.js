export const DEBUG_METABOLISM = false;

export const METABOLISM_CONFIG = {
  maxEnergy: 100,
  baseDrainPerSecond: 0.35, // full -> empty in ~285s (~4.75min) of normal play before food matters
  lowEnergyThreshold: 0.3,
  criticalEnergyThreshold: 0.12,
  starvationDamagePerSecond: 4,
  respawnEnergyRatio: 1.0, // never respawn hungry
};

const STATES = { NORMAL: 'NORMAL', LOW: 'LOW', CRITICAL: 'CRITICAL', STARVING: 'STARVING' };

// Optional hooks, currently silent - lets audio be added later without touching this logic.
function playLowEnergySound() {}
function playConsumeSound() {}
function playStarvationSound() {}

/**
 * Player metabolism: continuous energy drain, food consumption, and starvation
 * pressure once energy hits zero. Starvation damage goes through PlayerHealth's
 * takeEnvironmentalDamage() - the non-combat path - specifically so it never sets
 * or gets blocked by combat invulnerability from predator hits.
 */
export class MetabolismSystem {
  constructor(playerController, playerHealth, uiManager, { onLowEnergyReached } = {}) {
    this.playerController = playerController;
    this.playerHealth = playerHealth;
    this.uiManager = uiManager;
    this.onLowEnergyReached = onLowEnergyReached;

    this.maxEnergy = METABOLISM_CONFIG.maxEnergy;
    this.currentEnergy = this.maxEnergy;
    this.state = STATES.NORMAL;
    this.enabled = true;

    // Driven by PlayerFormController each frame (see main.js) - 1.0 as Slime, higher
    // while transformed, so the Venom Rat's power costs faster energy decay. Recomputed
    // fresh every frame from currentForm, never multiplied onto itself.
    this.metabolismMultiplier = 1.0;

    this._hasShownLowHint = false;
    this._wasStarving = false;

    this.uiManager.updateEnergyUI(this.currentEnergy, this.maxEnergy);
  }

  getEnergy() {
    return this.currentEnergy;
  }

  getEnergyRatio() {
    return this.currentEnergy / this.maxEnergy;
  }

  isFull() {
    return this.currentEnergy >= this.maxEnergy;
  }

  /** Returns the actual amount gained after clamping, so callers can tell if it did anything. */
  addEnergy(amount) {
    const before = this.currentEnergy;
    this.currentEnergy = Math.min(this.currentEnergy + amount, this.maxEnergy);
    this._afterEnergyChange();
    return this.currentEnergy - before;
  }

  drainEnergy(amount) {
    this.currentEnergy = Math.max(0, this.currentEnergy - amount);
    this._afterEnergyChange();
  }

  // Deliberately does not touch _hasShownLowHint - the tutorial hint stays "seen"
  // across a respawn within the same session.
  reset(ratio = METABOLISM_CONFIG.respawnEnergyRatio) {
    this.currentEnergy = this.maxEnergy * ratio;
    this._wasStarving = false;
    this.uiManager.setStarvationState?.(false);
    this._afterEnergyChange();
    if (DEBUG_METABOLISM) console.log('Energy restored');
  }

  update(deltaTime) {
    // Dead (mid-death-animation through respawn) or explicitly disabled: no drain,
    // no starvation ticking. playerHealth.isDead already spans the whole death/fade/
    // respawn window (until reset() runs), so this alone covers "gameplay inactive".
    if (!this.enabled || this.playerHealth.isDead) {
      if (this._wasStarving) {
        this._wasStarving = false;
        this.uiManager.setStarvationState?.(false);
      }
      return;
    }

    this.drainEnergy(METABOLISM_CONFIG.baseDrainPerSecond * this.metabolismMultiplier * deltaTime);
    this.playerController.setEnergyVisual(this.getEnergyRatio());

    const isStarving = this.state === STATES.STARVING;
    if (isStarving !== this._wasStarving) {
      this._wasStarving = isStarving;
      this.uiManager.setStarvationState?.(isStarving);
    }

    if (isStarving) {
      this.playerHealth.takeEnvironmentalDamage(METABOLISM_CONFIG.starvationDamagePerSecond * deltaTime, {
        type: 'starvation',
        deltaTime,
      });
    }
  }

  _afterEnergyChange() {
    this.uiManager.updateEnergyUI(this.currentEnergy, this.maxEnergy);
    this._updateState();
  }

  _updateState() {
    const ratio = this.getEnergyRatio();
    const previous = this.state;

    if (this.currentEnergy <= 0) this.state = STATES.STARVING;
    else if (ratio <= METABOLISM_CONFIG.criticalEnergyThreshold) this.state = STATES.CRITICAL;
    else if (ratio <= METABOLISM_CONFIG.lowEnergyThreshold) this.state = STATES.LOW;
    else this.state = STATES.NORMAL;

    if (this.state === previous) return;

    if (DEBUG_METABOLISM) {
      console.log(this.state === STATES.STARVING ? 'STARVING' : `Energy: ${Math.round(this.currentEnergy)} / ${this.maxEnergy}`);
    }

    if (this.state === STATES.STARVING) {
      this._wasStarving = true;
      this.uiManager.setStarvationState?.(true);
      playStarvationSound();
    } else if (previous === STATES.STARVING) {
      this._wasStarving = false;
      this.uiManager.setStarvationState?.(false);
      if (DEBUG_METABOLISM) console.log('Starvation ended');
    }

    if (this.state === STATES.LOW && !this._hasShownLowHint) {
      this._hasShownLowHint = true;
      playLowEnergySound();
      this.onLowEnergyReached?.();
    }
  }

  notifyConsumed() {
    playConsumeSound();
  }
}
