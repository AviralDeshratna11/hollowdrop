import * as THREE from 'three';

export const DEBUG_BURDEN = false;

export const BURDEN_CONFIG = {
  minSpeedMultiplier: 0.45,
  loadCurveExponent: 1.5,
  minAccelerationMultiplier: 0.65,
  maxWidthIncrease: 0.12,
  maxHeightReduction: 0.08,
  heavyThreshold: 0.8,
  decelerationLoadFactor: 0.15, // heavier -> up to 15% slower deceleration rate (subtly longer to settle)
};

/**
 * Translates inventory weight into movement feel: top speed, acceleration,
 * deceleration, and the player's visual "burden" scale. Reads InventoryManager.
 * Exposes its own speedMultiplier/accelerationMultiplier rather than writing
 * playerController.movementSpeedMultiplier directly - main.js multiplies these
 * together with PlayerFormController's form multiplier fresh every frame
 * (base x form x burden), so mutating never stacks with being heavy.
 */
export class BurdenSystem {
  constructor(inventoryManager, playerController, { onHeavyReached } = {}) {
    this.inventoryManager = inventoryManager;
    this.playerController = playerController;
    this.onHeavyReached = onHeavyReached;
    this.load = 0;
    this.speedMultiplier = 1.0;
    this.accelerationMultiplier = 1.0;
    this.decelerationLoadFactor = 0;
    this._hasNotifiedHeavy = false;
    this._lastLoggedBucket = -1;
  }

  getLoadRatio() {
    return THREE.MathUtils.clamp(this.inventoryManager.getInventoryWeightRatio(), 0, 1);
  }

  isHeavy() {
    return this.load >= BURDEN_CONFIG.heavyThreshold;
  }

  update() {
    this.load = this.getLoadRatio();
    const burden = Math.pow(this.load, BURDEN_CONFIG.loadCurveExponent);

    this.speedMultiplier = THREE.MathUtils.lerp(1.0, BURDEN_CONFIG.minSpeedMultiplier, burden);
    this.accelerationMultiplier = THREE.MathUtils.lerp(1.0, BURDEN_CONFIG.minAccelerationMultiplier, burden);
    this.decelerationLoadFactor = burden * BURDEN_CONFIG.decelerationLoadFactor;

    // Deceleration has no form-multiplier counterpart (yet), so it's still safe to
    // set directly - only speed/acceleration need combining with form in main.js.
    this.playerController.decelerationLoadFactor = this.decelerationLoadFactor;

    const scaleX = 1 + this.load * BURDEN_CONFIG.maxWidthIncrease;
    const scaleY = 1 - this.load * BURDEN_CONFIG.maxHeightReduction;
    this.playerController.setBurdenVisual(this.load, scaleX, scaleY, scaleX);

    if (this.isHeavy() && !this._hasNotifiedHeavy) {
      this._hasNotifiedHeavy = true;
      this.onHeavyReached?.();
    }

    if (DEBUG_BURDEN) {
      const bucket = Math.round(this.load * 10);
      if (bucket !== this._lastLoggedBucket) {
        this._lastLoggedBucket = bucket;
        console.log(`Load: ${this.inventoryManager.getInventoryWeight()} / ${this.inventoryManager.maxWeight}`);
        console.log(`Speed multiplier: ${this.speedMultiplier.toFixed(2)}`);
      }
    }
  }
}
