import * as THREE from 'three';

/**
 * Camera shake on a "trauma" model: callers add trauma (0..1), it decays on its own,
 * and the actual shake is trauma SQUARED. That squaring is the whole reason to model
 * it this way rather than as a straight per-hit offset animation - a big hit reads as
 * violent while the tail end falls off fast instead of lingering as a low buzz, and
 * two hits landing together compound into one bigger shake rather than fighting each
 * other for control of the camera.
 *
 * Produces an OFFSET only. It never touches the player, and main.js's updateCamera()
 * adds the offset after its own follow-lerp has run, so shaking can't feed back into
 * the smoothing and drag the camera off-target.
 *
 * Shake is advanced with REAL delta, not the hitstop-scaled one - the standard impact
 * combo is "freeze the simulation and rattle the camera", which only works if the
 * rattle keeps running while everything else is held still.
 */
export class ScreenShake {
  constructor({ maxOffset = 0.55, decayRate = 1.9, frequency = 24 } = {}) {
    this.maxOffset = maxOffset;
    this.decayRate = decayRate;
    this.frequency = frequency;

    this.trauma = 0;
    this.offset = new THREE.Vector3();
    this._time = 0;
  }

  /** Adds trauma, clamped to 1. Simultaneous sources stack instead of overriding. */
  add(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  reset() {
    this.trauma = 0;
    this._time = 0;
    this.offset.set(0, 0, 0);
  }

  /** Two incommensurate sines per axis - smooth (so it reads as a shake rather than
   *  per-frame jitter) and deterministic, unlike Math.random() which flickers
   *  differently depending on framerate. */
  _noise(seed) {
    return (
      Math.sin(this._time * this.frequency + seed) * 0.6 +
      Math.sin(this._time * this.frequency * 1.7 + seed * 2.3) * 0.4
    );
  }

  update(realDeltaTime) {
    if (this.trauma <= 0) {
      this.offset.set(0, 0, 0);
      return;
    }
    this._time += realDeltaTime;
    this.trauma = Math.max(0, this.trauma - this.decayRate * realDeltaTime);

    const magnitude = this.trauma * this.trauma * this.maxOffset;
    this.offset.set(
      this._noise(0) * magnitude,
      this._noise(11.3) * magnitude * 0.5, // less vertical - the camera is already top-down
      this._noise(23.7) * magnitude
    );
  }
}
