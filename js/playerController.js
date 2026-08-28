import * as THREE from 'three';

// --- Tunable movement architecture ---------------------------------------
export const PLAYER_MAX_SPEED = 6.0;      // world units / second at full swipe
export const ACCELERATION_RATE = 10.0;    // higher = snappier response to new input
export const DECELERATION_RATE = 4.5;     // lower = longer glide after releasing
const LEAN_MAX_ANGLE = 0.16;              // radians, subtle lean into movement
const SQUASH_STRETCH_AMOUNT = 0.12;       // subtle squash/stretch by speed
const FEEL_SMOOTHING = 8.0;               // lean/squash smoothing rate

// Jelly wobble (Slime form only - squashStretchMultiplier stays 1 for every other
// form, set fresh each frame in main.js): a slow idle breathing pulse so the body
// reads as alive even at rest, plus a bigger damped-sine jiggle (reusing the exact
// same pulse mechanism triggerAbsorbPulse() already drives) whenever it comes to a
// sudden stop - the classic jello overshoot-and-settle.
const IDLE_WOBBLE_SPEED = 2.4;
const IDLE_WOBBLE_AMOUNT = 0.03;
const STOP_JIGGLE_DECEL_THRESHOLD = 10.0; // units/sec^2 - only a real stop triggers it, not normal easing

// Yaw: rotates the root to face the direction of travel. Invisible on the symmetric
// slime sphere, but required once an asymmetric visual (Venom Rat) is active - without
// it the model would always face its default -Z regardless of which way it's moving.
const YAW_TURN_RATE = 10.0;
const YAW_MIN_SPEED = 0.1;

// Absorb "gulp" bounce: a quick damped-sine bump layered on top of movement squash.
const PULSE_AMPLITUDE = 0.06;
const PULSE_DECAY = 14.0;
const PULSE_FREQUENCY = 18.0;
const PULSE_MAX_TIME = 0.4;

// Hit-flash: brief emissive flash toward red, faded back to the (health-modulated) base glow.
const HIT_FLASH_DURATION = 0.25;
const HIT_FLASH_COLOR = new THREE.Color(0xff3b3b);
const HIT_FLASH_INTENSITY = 2.0;

// Diegetic low-vitality feedback - dim/tint/pulse the same emissive channel the hit-flash
// uses, and add to the same wobble term movement/burden already drive. One write point.
// "Vitality" = min(health ratio, energy ratio): whichever stat is worse drives the
// visuals, so low health and low energy don't stack into two competing pulses.
const INJURED_RATIO = 0.7;
const CRITICAL_RATIO = 0.4;
const SEVERE_RATIO = 0.2;
const HEALTH_TINT_COLOR = new THREE.Color(0x8a2be2);

// Energy pulse: brief intensity-only brighten when food is digested (no color shift).
const ENERGY_PULSE_DURATION = 0.5;
const ENERGY_PULSE_BOOST = 1.1;

// Death collapse: shake -> sink/spread -> fade. Duration is passed in by whoever calls
// beginDeath() (DeathRespawnManager owns HEALTH_CONFIG.deathDuration) so the timing
// constant lives in exactly one place.
const DEATH_SHAKE_FRACTION = 0.2;
const DEATH_COLLAPSE_START_FRACTION = 0.15;
const DEATH_COLLAPSE_END_FRACTION = 0.7;
const DEATH_FADE_START_FRACTION = 0.5;

const tempHealthColor = new THREE.Color();

/**
 * Owns movement physics and body-deformation/glow feedback for whichever visual is
 * currently active. `mesh` is the PLAYER ROOT (the object every other system - camera,
 * predator, knockback - reads .position from; kept as `.mesh` for backward compatibility
 * with code written before forms existed). Scale/rotation animate the root directly (so
 * they apply uniformly to whichever child visual is visible); material-based effects
 * (glow/flash/opacity) target `activeMaterial`, swapped via setActiveMaterial() when
 * PlayerFormController changes form - see resetToBaseSlime()/setActiveMaterial().
 */
export class PlayerController {
  constructor(mesh, activeMaterial) {
    this.mesh = mesh;
    this.currentVelocity = new THREE.Vector3();
    this.targetVelocity = new THREE.Vector3();

    // Driven by BurdenSystem + PlayerFormController combined (see main.js): each frame
    // recomputed fresh from base values, never multiplied onto itself - prevents stacking.
    this.movementSpeedMultiplier = 1.0;
    this.accelerationMultiplier = 1.0;
    this.decelerationLoadFactor = 0; // 0..~0.15, subtracted from DECELERATION_RATE when heavy

    this._baseScale = mesh.scale.clone();
    this._pulseTime = null;
    this._load = 0;
    this._facingAngle = 0; // rotation.y - which way the model is facing

    // Set fresh every frame by main.js from the current form (1 for everything except
    // Slime) - see the jelly-wobble constants above.
    this.squashStretchMultiplier = 1.0;
    this._wobbleTime = 0;
    this._lastSpeed = 0;

    this._hitFlashTime = null;
    this._healthRatio = 1;
    this._energyRatio = 1;
    this._energyPulseTime = null;
    this._time = 0;

    this.activeMaterial = null;
    this._baseEmissive = new THREE.Color();
    this._baseEmissiveIntensity = 1;
    this._baseOpacity = 1;
    this.setActiveMaterial(activeMaterial);

    // Burden body-shape target (wider/flatter when heavy), smoothed in _applyMovementFeel
    // alongside movement squash and the absorb/expel pulse - the single place mesh.scale is written.
    this._targetBurdenScale = new THREE.Vector3(1, 1, 1);
    this._currentBurdenScale = new THREE.Vector3(1, 1, 1);

    this._deathTime = null;
    this._deathDuration = 0;
  }

  /** Redirects glow/flash/opacity effects to a new material (called on form switch) and
   *  re-baselines from its own resting values, so a reused visual never inherits leftover
   *  animated state from a previous activation. */
  setActiveMaterial(material) {
    this.activeMaterial = material;
    this._baseEmissive.copy(material.emissive);
    this._baseEmissiveIntensity = material.emissiveIntensity;
    // Prefer a declared resting opacity over the live one. A material handed over while
    // it is still animating reports an instantaneous value, not its baseline - the
    // player's imported slime is built at opacity 0 and crossfaded up to its real value,
    // and fires onReady (which re-points this material) on the frame it arrives, i.e.
    // while it still reads 0. Snapshotting that made _baseOpacity 0 permanently, so the
    // death fade had nothing to fade and resetToBaseSlime() restored the body to fully
    // transparent - the slime vanished for good after the first death. Anything that
    // hands over a mid-animation material declares userData.restOpacity instead.
    this._baseOpacity = material.userData?.restOpacity ?? material.opacity;
  }

  /** Called by BurdenSystem each frame with the current load ratio + target body scale. */
  setBurdenVisual(load, scaleX, scaleY, scaleZ) {
    this._load = load;
    this._targetBurdenScale.set(scaleX, scaleY, scaleZ);
  }

  /** Triggers the quick squash-bounce used when a resource is absorbed. */
  triggerAbsorbPulse() {
    this._pulseTime = 0;
  }

  /** Called every frame by main.js with playerHealth.getHealthRatio() - drives the
   *  diegetic low-health look (dimming/tint/pulse/wobble), independent of the death
   *  animation below. */
  setHealthVisual(ratio) {
    this._healthRatio = ratio;
  }

  /** Called every frame by MetabolismSystem with the current energy ratio - feeds
   *  the same combined vitality visual as health (see _computeHealthEmissive). */
  setEnergyVisual(ratio) {
    this._energyRatio = ratio;
  }

  /** Brief intensity-only brighten when a food item finishes digesting. */
  triggerEnergyPulse() {
    this._energyPulseTime = 0;
  }

  /** Current facing direction as a unit XZ vector - forward = -Z at yaw 0, matching
   *  every model in this project. The single source of truth for "which way is the
   *  Rat facing" (combat's hit-detection direction check reads this, never model
   *  geometry). Writes into `target` if given, to avoid allocating in hot paths. */
  getForwardDirection(target = new THREE.Vector3()) {
    return target.set(-Math.sin(this._facingAngle), 0, -Math.cos(this._facingAngle));
  }

  /** Immediately zeroes velocity - used at the start of death and at the start of a
   *  mutation transformation ("Hollowdrop stops"), without the other side effects
   *  beginDeath() carries. */
  haltMovement() {
    this.currentVelocity.set(0, 0, 0);
    this.targetVelocity.set(0, 0, 0);
  }

  /** Starts the death collapse. Movement/velocity/input are frozen immediately;
   *  everything else about "being dead" (disabling input upstream, dropping
   *  inventory, respawn timing) is DeathRespawnManager's job. */
  beginDeath(duration) {
    this._deathTime = 0;
    this._deathDuration = duration;
    this.haltMovement();
  }

  isDeathAnimationComplete() {
    return this._deathTime !== null && this._deathTime >= this._deathDuration;
  }

  /** Full restore to a clean base slime - called by DeathRespawnManager once the
   *  respawn position is set. Clears every transient visual system so nothing from
   *  the previous life (flash, pulse, burden, death collapse) leaks into the next. */
  resetToBaseSlime() {
    this._deathTime = null;
    this._facingAngle = 0;
    this.mesh.scale.copy(this._baseScale);
    this.mesh.rotation.set(0, 0, 0);
    this.activeMaterial.opacity = this._baseOpacity;
    this.activeMaterial.emissive.copy(this._baseEmissive);
    this.activeMaterial.emissiveIntensity = this._baseEmissiveIntensity;

    this.haltMovement();
    this._pulseTime = null;
    this._hitFlashTime = null;
    this._energyPulseTime = null;
    this._healthRatio = 1;
    this._energyRatio = 1;
    this._currentBurdenScale.set(1, 1, 1);
    this._targetBurdenScale.set(1, 1, 1);
    this._load = 0;
    this._lastSpeed = 0;
  }

  _applyDeathAnimation(deltaTime) {
    this._deathTime += deltaTime;
    const t = Math.min(this._deathTime / this._deathDuration, 1);

    // Shake briefly right at the fatal hit.
    const shakeT = Math.min(t / DEATH_SHAKE_FRACTION, 1);
    this.mesh.rotation.z = (1 - shakeT) * Math.sin(this._deathTime * 40) * 0.05;

    // Membrane loses tension and collapses downward, spreading slightly outward.
    const collapseSpan = DEATH_COLLAPSE_END_FRACTION - DEATH_COLLAPSE_START_FRACTION;
    const collapseT = THREE.MathUtils.clamp((t - DEATH_COLLAPSE_START_FRACTION) / collapseSpan, 0, 1);
    const easedCollapse = collapseT * collapseT;
    const scaleY = THREE.MathUtils.lerp(this._baseScale.y, this._baseScale.y * 0.12, easedCollapse);
    const scaleXZ = THREE.MathUtils.lerp(this._baseScale.x, this._baseScale.x * 1.2, easedCollapse);
    this.mesh.scale.set(scaleXZ, scaleY, scaleXZ);

    // Dissolves away in the back half of the animation.
    const fadeT = THREE.MathUtils.clamp((t - DEATH_FADE_START_FRACTION) / (1 - DEATH_FADE_START_FRACTION), 0, 1);
    this.activeMaterial.opacity = THREE.MathUtils.lerp(this._baseOpacity, 0, fadeT);
  }

  /** A small temporary shove - blends into the existing velocity smoothing, so
   *  swipe control stays fully responsive within a frame or two (no override). */
  applyImpulse(vector3) {
    this.currentVelocity.add(vector3);
  }

  /** Brief red emissive flash when the predator lands a hit. */
  triggerHitFlash() {
    this._hitFlashTime = 0;
  }

  /** Single write point for activeMaterial.emissive/.emissiveIntensity: computes the
   *  vitality-modulated baseline glow (dim when injured, tinted+pulsing when critical/
   *  severe), blends toward the hit-flash color on top while a flash is active, then
   *  layers the energy-pulse brighten on top of that. Named for its original purpose;
   *  now owns all three. */
  _applyHitFlash(deltaTime) {
    const baseline = this._computeHealthEmissive();
    let color = baseline.color;
    let intensity = baseline.intensity;

    if (this._hitFlashTime !== null) {
      this._hitFlashTime += deltaTime;
      const t = Math.min(this._hitFlashTime / HIT_FLASH_DURATION, 1);
      if (t >= 1) {
        this._hitFlashTime = null;
      } else {
        const flashAmount = 1 - t;
        color = tempHealthColor.copy(baseline.color).lerp(HIT_FLASH_COLOR, flashAmount);
        intensity = THREE.MathUtils.lerp(baseline.intensity, HIT_FLASH_INTENSITY, flashAmount);
      }
    }

    if (this._energyPulseTime !== null) {
      this._energyPulseTime += deltaTime;
      const t = Math.min(this._energyPulseTime / ENERGY_PULSE_DURATION, 1);
      if (t >= 1) {
        this._energyPulseTime = null;
      } else {
        intensity += (1 - t) * ENERGY_PULSE_BOOST;
      }
    }

    this.activeMaterial.emissive.copy(color);
    this.activeMaterial.emissiveIntensity = intensity;
  }

  /** Healthy (70-100% vitality): untouched. Injured (40-70%): glow dims slightly.
   *  Critical (20-40%) and severe (<20%): glow pulses and tints toward red/purple -
   *  faster and stronger the lower vitality gets. Vitality is min(health, energy)
   *  ratio, so whichever stat is worse drives the feedback. */
  _computeHealthEmissive() {
    const ratio = Math.min(this._healthRatio, this._energyRatio);
    let intensity = this._baseEmissiveIntensity;
    let tintAmount = 0;

    if (ratio < INJURED_RATIO) {
      const injuredT = (INJURED_RATIO - ratio) / INJURED_RATIO;
      intensity *= 1 - injuredT * 0.35;
    }
    if (ratio < CRITICAL_RATIO) {
      const criticalT = (CRITICAL_RATIO - ratio) / CRITICAL_RATIO;
      const isSevere = ratio < SEVERE_RATIO;
      const pulse = 0.5 + Math.sin(this._time * (isSevere ? 6 : 3.5)) * 0.5;
      intensity *= 1 + pulse * (isSevere ? 0.5 : 0.25) * criticalT;
      tintAmount = criticalT * (isSevere ? 0.35 : 0.15);
    }

    tempHealthColor.copy(this._baseEmissive).lerp(HEALTH_TINT_COLOR, tintAmount);
    return { color: tempHealthColor, intensity };
  }

  _getPulseFactor(deltaTime) {
    if (this._pulseTime === null) return 0;
    this._pulseTime += deltaTime;
    if (this._pulseTime > PULSE_MAX_TIME) {
      this._pulseTime = null;
      return 0;
    }
    return PULSE_AMPLITUDE * Math.exp(-PULSE_DECAY * this._pulseTime) * Math.cos(PULSE_FREQUENCY * this._pulseTime);
  }

  /** Feed in the raw swipe direction/magnitude from InputController. */
  setTargetFromInput(dirX, dirY, magnitude) {
    const speed = PLAYER_MAX_SPEED * this.movementSpeedMultiplier * magnitude;
    // Screen dx -> world x, screen dy -> world z (top-down mapping).
    this.targetVelocity.set(dirX * speed, 0, dirY * speed);
  }

  update(deltaTime) {
    this._time += deltaTime;

    if (this._deathTime !== null) {
      this._applyDeathAnimation(deltaTime);
      return; // dying owns scale/opacity/rotation entirely - skip normal movement/feel
    }

    const isInputActive = this.targetVelocity.lengthSq() > 1e-6;
    // Heavier Hollowdrop accelerates a bit slower and settles a bit slower - mass, not input lag.
    const rate = isInputActive
      ? ACCELERATION_RATE * this.accelerationMultiplier
      : DECELERATION_RATE * (1 - this.decelerationLoadFactor);

    // Frame-rate independent exponential smoothing.
    const t = 1 - Math.exp(-rate * deltaTime);
    this.currentVelocity.lerp(this.targetVelocity, t);

    if (this.currentVelocity.lengthSq() < 1e-5) {
      this.currentVelocity.set(0, 0, 0);
    }

    this.mesh.position.x += this.currentVelocity.x * deltaTime;
    this.mesh.position.z += this.currentVelocity.z * deltaTime;

    this._applyMovementFeel(deltaTime);
    this._applyHitFlash(deltaTime);
  }

  _applyMovementFeel(deltaTime) {
    const speed = this.currentVelocity.length();
    const speedRatio = Math.min(speed / PLAYER_MAX_SPEED, 1);
    // Heavier Hollowdrop wobbles a little more and recovers a little slower - still subtle.
    // Low vitality (health or energy, whichever is worse) adds its own "tired/unstable"
    // wobble on top, via the same term.
    const vitalityRatio = Math.min(this._healthRatio, this._energyRatio);
    const vitalityWobble = vitalityRatio < SEVERE_RATIO ? 1.4 : vitalityRatio < CRITICAL_RATIO ? 1.2 : 1.0;
    const wobbleBoost = (1 + this._load * 0.4) * vitalityWobble;
    const smooth = 1 - Math.exp(-(FEEL_SMOOTHING * (1 - this._load * 0.3)) * deltaTime);

    // Subtle lean into the direction of travel.
    const targetTiltZ = speed > 0.05 ? -(this.currentVelocity.x / PLAYER_MAX_SPEED) * LEAN_MAX_ANGLE : 0;
    const targetTiltX = speed > 0.05 ? (this.currentVelocity.z / PLAYER_MAX_SPEED) * LEAN_MAX_ANGLE : 0;
    this.mesh.rotation.x += (targetTiltX - this.mesh.rotation.x) * smooth;
    this.mesh.rotation.z += (targetTiltZ - this.mesh.rotation.z) * smooth;

    // Turn to face the direction of travel. A no-op look on the symmetric slime
    // sphere, but this is what makes the Venom Rat actually face where it's going.
    // Model convention (matches predatorModel.js/ratModel.js): forward = -Z at yaw 0.
    if (speed > YAW_MIN_SPEED) {
      const dirX = this.currentVelocity.x / speed;
      const dirZ = this.currentVelocity.z / speed;
      const targetYaw = Math.atan2(-dirX, -dirZ);
      let angleDiff = targetYaw - this._facingAngle;
      angleDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI; // shortest signed path
      const yawSmooth = 1 - Math.exp(-YAW_TURN_RATE * deltaTime);
      this._facingAngle += angleDiff * yawSmooth;
      this.mesh.rotation.y = this._facingAngle;
    }

    // Jelly wobble - idle breathing pulse (only meaningfully visible at rest, since
    // the speed-driven squash below dominates while moving) plus an automatic jiggle
    // on a sudden stop. Both gated behind squashStretchMultiplier > 1 so every other
    // form (multiplier left at the default 1) is completely unaffected.
    this._wobbleTime += deltaTime;
    const idleWobble =
      this.squashStretchMultiplier > 1
        ? Math.sin(this._wobbleTime * IDLE_WOBBLE_SPEED) * IDLE_WOBBLE_AMOUNT * (this.squashStretchMultiplier - 1)
        : 0;
    const decelRate = deltaTime > 0 ? (this._lastSpeed - speed) / deltaTime : 0;
    if (this.squashStretchMultiplier > 1 && decelRate > STOP_JIGGLE_DECEL_THRESHOLD && this._pulseTime === null) {
      this.triggerAbsorbPulse();
    }
    this._lastSpeed = speed;

    // Single combined scale point: movement squash/stretch * absorb-or-expel pulse * burden body shape.
    this._currentBurdenScale.lerp(this._targetBurdenScale, smooth);
    const pulse = this._getPulseFactor(deltaTime);
    const squashY = 1 - speedRatio * SQUASH_STRETCH_AMOUNT * wobbleBoost * this.squashStretchMultiplier * 0.6 + idleWobble;
    const stretchXZ = 1 + speedRatio * SQUASH_STRETCH_AMOUNT * wobbleBoost * this.squashStretchMultiplier - idleWobble * 0.5;

    const targetScaleY = this._baseScale.y * squashY * (1 + pulse) * this._currentBurdenScale.y;
    const targetScaleXZ = this._baseScale.x * stretchXZ * (1 - pulse * 0.5) * this._currentBurdenScale.x;
    this.mesh.scale.y += (targetScaleY - this.mesh.scale.y) * smooth;
    this.mesh.scale.x += (targetScaleXZ - this.mesh.scale.x) * smooth;
    this.mesh.scale.z += (targetScaleXZ - this.mesh.scale.z) * smooth;
  }
}
