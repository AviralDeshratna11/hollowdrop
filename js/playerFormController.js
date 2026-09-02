import * as THREE from 'three';
import { PLAYER_MAX_SPEED } from './playerController.js?v=5.3';
import { DEBUG_MUTATION } from './mutationSystem.js?v=5.3';

export const DEBUG_MUTATION_TIMER = false;

export const PLAYER_FORMS = {
  SLIME: 'SLIME',
  VENOM_RAT: 'VENOM_RAT',
};

// Internal transformation state - distinct from PLAYER_FORMS: a player is always
// exactly one of these four, never tracked via separate isRat/isTransforming booleans.
const TRANSFORM_STATES = {
  SLIME: 'SLIME',
  MUTATING: 'MUTATING',
  VENOM_RAT: 'VENOM_RAT',
  REVERTING: 'REVERTING',
};

// Countdown warning states - ratio-based (see getMutationRatio()), drive the timer
// HUD's styling and the Rat's biological-instability visuals. Never affect movement.
const MUTATION_TIMING_STATES = {
  NORMAL: 'NORMAL',
  LOW: 'LOW',
  CRITICAL: 'CRITICAL',
};

// Forms contribute modifiers, never overwrite base values - see getSpeedMultiplier().
// Recomputed fresh from these constants every frame in main.js (combined with
// BurdenSystem's own multiplier), so repeated mutate/revert cycles can never stack.
// mutationDuration is the form's base countdown length in seconds (0 = doesn't expire
// on its own, i.e. Slime) - see getMutationDuration() for the one place it's read.
export const FORM_CONFIG = {
  slime: { moveSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, damageMultiplier: 1.0, metabolismMultiplier: 1.0, mutationDuration: 0 },
  // metabolismMultiplier 1.5: the Rat's power costs faster energy decay than Slime,
  // but this is deliberately independent from mutationDuration below - see section 19
  // of the spec / MUTATION_CONFIG comment: energy and the countdown never combine.
  venomRat: { moveSpeedMultiplier: 1.25, accelerationMultiplier: 1.15, damageMultiplier: 1.5, metabolismMultiplier: 1.5, mutationDuration: 45 },
};

export const MUTATION_CONFIG = {
  transformationDuration: 1.0,
  ingredientFusionDuration: 0.3,
  revertDuration: 0.6,
  debugRevertKey: 'r',
  // Countdown warning thresholds, as a ratio of time remaining (1 = fresh, 0 = expired).
  lowTimeRatio: 0.3,
  criticalTimeRatio: 0.1,
  // Final-seconds number emphasis on the HUD (see uiManager.updateMutationTimerUI).
  finalSecondsThreshold: 3,
};

const ZERO_VECTOR = new THREE.Vector3(0, 0, 0);
const UP_VECTOR = new THREE.Vector3(0, 1, 0);

import {
  playMutationStartSound,
  playMutationCompleteSound,
  playMutationLowSound,
  playMutationCriticalSound,
  playMutationExpireSound,
} from './soundEffects.js?v=5.3';

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/**
 * Owns which visual is shown (slime vs Venom Rat), the transformation/revert animation
 * sequences, the form-specific speed/acceleration modifiers, AND the mutation countdown
 * timer (kept here rather than in MutationSystem, which only knows recipes/ingredients -
 * this class already owns currentForm/state and runs an update(deltaTime) every frame,
 * so the timer belongs with the state machine it drives). Does NOT own recipe logic
 * (MutationSystem) or movement physics (PlayerController) - just orchestrates them.
 * playerRoot/inventoryContainer are never replaced; only which child visual is .visible
 * changes, and PlayerController.activeMaterial is redirected accordingly.
 */
export class PlayerFormController {
  constructor({
    playerController,
    inventoryManager,
    mutationSystem,
    resourceManager,
    uiManager,
    metabolismSystem,
    inputController,
    inventoryInteraction,
    slimeVisual,
    slimeMaterial,
    ratVisual,
    ratMaterial,
  }) {
    this.playerController = playerController;
    this.inventoryManager = inventoryManager;
    this.mutationSystem = mutationSystem;
    this.resourceManager = resourceManager;
    this.uiManager = uiManager;
    this.metabolismSystem = metabolismSystem;
    this.inputController = inputController;
    this.inventoryInteraction = inventoryInteraction;
    this.slimeVisual = slimeVisual;
    this.slimeMaterial = slimeMaterial;
    this.ratVisual = ratVisual;
    this.ratMaterial = ratMaterial;
    // Optional - set post-construction in main.js once PlayerCombatController exists
    // (mirrors how mutationSystem.onMutationAvailable is wired). Only ever *read*
    // (getBitePose()) from _updateRatIdle, never written to - keeps this class the
    // sole writer of ratVisual's transform even while a bite animation is playing.
    this.playerCombatController = null;
    // Optional, wired in main.js - fires when a transformation completes.
    this.onTransformed = null;
    this._completedRecipe = null;

    this.currentForm = PLAYER_FORMS.SLIME;
    this.state = TRANSFORM_STATES.SLIME;
    this._stateTime = 0;
    this._phase = null; // 'fusion' | 'settle' (within MUTATING) | 'revert' (within REVERTING)
    this._pendingRecipe = null;
    this._fusingItems = [];
    this._fusingStartPositions = new Map();
    this._ratTime = 0;

    // Mutation countdown - only meaningful while state is VENOM_RAT (mutationTimerActive
    // is the source of truth; see _startMutationTimer()/_cancelMutationTimer()).
    this.mutationDuration = 0;
    this.mutationTimeRemaining = 0;
    this.mutationTimerActive = false;
    this._timingState = MUTATION_TIMING_STATES.NORMAL;
  }

  get isLocked() {
    return this.state === TRANSFORM_STATES.MUTATING || this.state === TRANSFORM_STATES.REVERTING;
  }

  getSpeedMultiplier() {
    return this.currentForm === PLAYER_FORMS.VENOM_RAT ? FORM_CONFIG.venomRat.moveSpeedMultiplier : FORM_CONFIG.slime.moveSpeedMultiplier;
  }

  getAccelerationMultiplier() {
    return this.currentForm === PLAYER_FORMS.VENOM_RAT ? FORM_CONFIG.venomRat.accelerationMultiplier : FORM_CONFIG.slime.accelerationMultiplier;
  }

  getDamageMultiplier() {
    return this.currentForm === PLAYER_FORMS.VENOM_RAT ? FORM_CONFIG.venomRat.damageMultiplier : FORM_CONFIG.slime.damageMultiplier;
  }

  getMetabolismMultiplier() {
    return this.currentForm === PLAYER_FORMS.VENOM_RAT ? FORM_CONFIG.venomRat.metabolismMultiplier : FORM_CONFIG.slime.metabolismMultiplier;
  }

  /** Single lookup point for a form's base countdown length. Future per-mutation
   *  modifiers (a gene extending duration, a hazard shortening it) would adjust the
   *  value here - nowhere else reads FORM_CONFIG's mutationDuration directly. */
  getMutationDuration() {
    return this.currentForm === PLAYER_FORMS.VENOM_RAT ? FORM_CONFIG.venomRat.mutationDuration : FORM_CONFIG.slime.mutationDuration;
  }

  getMutationTimeRemaining() {
    return this.mutationTimeRemaining;
  }

  /** 1 (just started) .. 0 (expired) - drives the HUD bar, pulse speed, and the Rat's
   *  biological-instability visuals. Always safe to call, even when inactive. */
  getMutationRatio() {
    if (this.mutationDuration <= 0) return 0;
    return Math.min(Math.max(this.mutationTimeRemaining / this.mutationDuration, 0), 1);
  }

  /** Triggers the Venom Rat's special Poison Expel ability if available. */
  usePrimaryAbility() {
    if (this.currentForm === PLAYER_FORMS.VENOM_RAT) {
      return this.playerCombatController?.tryPoisonExpel() ?? false;
    }
    if (DEBUG_MUTATION) console.log('usePrimaryAbility() (placeholder, no-op)');
    return false;
  }

  /** Re-validates the recipe (never trust the button was visible a moment ago - the
   *  player could have expelled/consumed an ingredient since) before starting. */
  beginMutation(recipe) {
    if (this.state !== TRANSFORM_STATES.SLIME) return false; // already mutating/reverting/Rat
    if (!recipe || !this.mutationSystem.hasIngredients(recipe)) return false;

    this._pendingRecipe = recipe;
    this.state = TRANSFORM_STATES.MUTATING;
    this._phase = 'fusion';
    this._stateTime = 0;
    this.playerController.haltMovement();
    this.uiManager.hideMutationReady();

    this._fusingItems = this._collectIngredientItems(recipe);
    for (const item of this._fusingItems) {
      item.isFusing = true;
      this._fusingStartPositions.set(item.id, item.visualMesh.position.clone());
    }

    if (DEBUG_MUTATION) console.log('Mutation started');
    playMutationStartSound();
    return true;
  }

  _collectIngredientItems(recipe) {
    const collected = [];
    for (const [type, qty] of Object.entries(recipe.ingredients)) {
      let found = 0;
      for (const item of this.inventoryManager.items) {
        if (item.type === type && found < qty) {
          collected.push(item);
          found++;
        }
      }
    }
    return collected;
  }

  // --- Mutation countdown timer -------------------------------------------------

  /** Called once transformation actually completes (settle phase ends) - never at
   *  the MUTATE press. The transformation cinematic never costs mutation time. */
  _startMutationTimer() {
    this.mutationDuration = this.getMutationDuration();
    this.mutationTimeRemaining = this.mutationDuration;
    this.mutationTimerActive = true;
    this._timingState = MUTATION_TIMING_STATES.NORMAL;
    this.uiManager.showMutationTimerUI();
    this.uiManager.updateMutationTimerUI(this.mutationTimeRemaining, 1, this._timingState);
    if (DEBUG_MUTATION_TIMER) console.log(`Mutation timer started: ${this.mutationDuration}s`);
  }

  /** Stops and clears the countdown + hides its HUD - shared by early manual revert,
   *  expiration, death, and respawn, so there's exactly one place this can happen. */
  _cancelMutationTimer() {
    this.mutationTimerActive = false;
    this.mutationTimeRemaining = 0;
    this.mutationDuration = 0;
    this._timingState = MUTATION_TIMING_STATES.NORMAL;
    this.uiManager.hideMutationTimerUI();
  }

  /** Debug-only (DEBUG_MUTATION_TIMER): jumps the countdown to a specific value so
   *  warning-state thresholds can be tested without waiting out the full duration. */
  debugSetMutationTime(seconds) {
    if (!this.mutationTimerActive) return;
    this.mutationTimeRemaining = Math.max(0, Math.min(seconds, this.mutationDuration));
  }

  _updateMutationTimer(deltaTime) {
    if (!this.mutationTimerActive) return;

    this.mutationTimeRemaining = Math.max(0, this.mutationTimeRemaining - deltaTime);
    const ratio = this.getMutationRatio();
    this._updateTimingState(ratio);
    this.uiManager.updateMutationTimerUI(this.mutationTimeRemaining, ratio, this._timingState);

    if (this.mutationTimeRemaining <= 0) this._expireMutation();
  }

  _updateTimingState(ratio) {
    let next = MUTATION_TIMING_STATES.NORMAL;
    if (ratio <= MUTATION_CONFIG.criticalTimeRatio) next = MUTATION_TIMING_STATES.CRITICAL;
    else if (ratio <= MUTATION_CONFIG.lowTimeRatio) next = MUTATION_TIMING_STATES.LOW;

    if (next === this._timingState) return;
    this._timingState = next;
    if (DEBUG_MUTATION_TIMER) console.log(`Mutation ${next}`);
    if (next === MUTATION_TIMING_STATES.LOW) playMutationLowSound();
    else if (next === MUTATION_TIMING_STATES.CRITICAL) playMutationCriticalSound();
  }

  /** The timer's only trigger into the EXISTING revert path - no reversion logic is
   *  duplicated here. mutationTimerActive is false the instant this runs (via
   *  _beginRevert -> _cancelMutationTimer), so a stray extra frame can never call
   *  this twice before the state machine has already moved on to REVERTING. */
  _expireMutation() {
    if (!this.mutationTimerActive) return;
    if (DEBUG_MUTATION_TIMER) console.log('Mutation expired\nReverting to Slime');
    playMutationExpireSound();
    this.uiManager.showMutationExpired();
    this._beginRevert();
  }

  _beginRevert() {
    this.state = TRANSFORM_STATES.REVERTING;
    this._phase = 'revert';
    this._stateTime = 0;
    this.playerController.haltMovement();
    this.uiManager.hideRevertReady();
    this._cancelMutationTimer();
    // Reversion can interrupt an in-progress swipe/drag (most realistically when the
    // timer expires mid-gesture, since that has no player button press to naturally
    // end one) - reuses the same safety hooks DeathRespawnManager already calls for
    // exactly this reason, not a new system.
    this.inputController.cancel();
    this.inventoryInteraction.cancelActiveGesture();
  }

  /** Player-facing manual revert - bound to the REVERT button (shown while Venom Rat,
   *  see _startMutationTimer() call site) and, on desktop, the debug key when
   *  DEBUG_MUTATION is on. Also the timer's own expiry path, via _expireMutation(). */
  revertToSlime() {
    if (this.state !== TRANSFORM_STATES.VENOM_RAT) return false;
    this._beginRevert();
    return true;
  }

  /** Death-safety: aborts an in-progress transformation, or - if already Venom Rat -
   *  cancels the countdown without playing the reversion animation (the death sequence
   *  takes over immediately; forceResetToSlime() on respawn does the actual form
   *  reset). Ingredients are never actually removed until fusion completes, so
   *  cancelling mid-fusion just needs to clear the isFusing flags - the items are
   *  still normal inventory (about to be dropped/lost by death like anything else). */
  cancelMutation() {
    if (this.state === TRANSFORM_STATES.MUTATING) {
      for (const item of this._fusingItems) item.isFusing = false;
    }
    this._fusingItems = [];
    this._fusingStartPositions.clear();
    this._pendingRecipe = null;
    this.state = this.currentForm === PLAYER_FORMS.VENOM_RAT ? TRANSFORM_STATES.VENOM_RAT : TRANSFORM_STATES.SLIME;
    this._phase = null;
    this.uiManager.hideRevertReady();
    this._cancelMutationTimer();
  }

  /** Hard, instant reset to base Slime - used on respawn. No animation; death already
   *  handled dropping/clearing inventory separately. */
  forceResetToSlime() {
    this._fusingItems = [];
    this._fusingStartPositions.clear();
    this._pendingRecipe = null;
    this.currentForm = PLAYER_FORMS.SLIME;
    this.state = TRANSFORM_STATES.SLIME;
    this._phase = null;

    this.ratVisual.visible = false;
    this.ratVisual.scale.setScalar(1);
    this.ratVisual.position.z = 0; // clears any leftover bite-lunge offset (see getBitePose())
    this.slimeVisual.visible = true;
    this.slimeVisual.scale.setScalar(1);
    this._setInventoryContainerVisible(true);
    this.playerController.setActiveMaterial(this.slimeMaterial);
    this.uiManager.hideRevertReady();
    this._cancelMutationTimer();

    if (DEBUG_MUTATION) console.log('Form changed:\n-> SLIME (respawn)');
  }

  _setInventoryContainerVisible(visible) {
    this.inventoryManager.inventoryContainer.visible = visible;
  }

  update(deltaTime) {
    if (this.state === TRANSFORM_STATES.MUTATING) this._updateMutating(deltaTime);
    else if (this.state === TRANSFORM_STATES.REVERTING) this._updateReverting(deltaTime);
    else if (this.currentForm === PLAYER_FORMS.VENOM_RAT) this._updateRatIdle(deltaTime);
  }

  _updateMutating(deltaTime) {
    this._stateTime += deltaTime;

    if (this._phase === 'fusion') {
      const t = Math.min(this._stateTime / MUTATION_CONFIG.ingredientFusionDuration, 1);
      const eased = t * t;

      for (const item of this._fusingItems) {
        const start = this._fusingStartPositions.get(item.id);
        item.visualMesh.position.lerpVectors(start, ZERO_VECTOR, eased);
        item.visualMesh.scale.setScalar(Math.max(item.baseVisualScale * (1 - eased * 0.7), 0.05));
        item.visualMesh.rotation.y += deltaTime * (6 + eased * 10);
        const pulseMaterials = item.visualMesh.userData.pulseMaterials;
        if (pulseMaterials) {
          for (const mat of pulseMaterials) mat.emissiveIntensity = 1 + eased * 1.5;
        }
      }

      if (t >= 1) this._completeFusionPhase();
      return;
    }

    if (this._phase === 'settle') {
      const settleDuration = Math.max(MUTATION_CONFIG.transformationDuration - MUTATION_CONFIG.ingredientFusionDuration, 0.1);
      const t = Math.min(this._stateTime / settleDuration, 1);
      this.ratVisual.scale.setScalar(THREE.MathUtils.lerp(0.4, 1, easeOutBack(t)));

      if (t >= 1) {
        this.ratVisual.scale.setScalar(1);
        this.state = TRANSFORM_STATES.VENOM_RAT;
        this._phase = null;
        this.uiManager.showRevertReady(() => this.revertToSlime());
        this._startMutationTimer(); // movement is already unlocked by this point (state left MUTATING)
        this.playerCombatController?.resetPoisonExpelCharge();
        playMutationCompleteSound();
        // The single moment a transformation is actually complete - not the MUTATE press,
        // which can still be interrupted. Fires once per form per run; the recipe is
        // consumed by now so _pendingRecipe is read before it is cleared.
        this.onTransformed?.(this._completedRecipe ?? null);
        if (DEBUG_MUTATION) console.log('Form changed:\nSLIME -> VENOM_RAT');
      }
    }
  }

  /** Ingredients are consumed here - fusion has finished, this is the single point
   *  where they're actually removed (exactly once) and the visual swap happens. */
  _completeFusionPhase() {
    for (const item of this._fusingItems) item.isFusing = false;
    this._completedRecipe = this._pendingRecipe; // kept for the post-transform reveal
    this.mutationSystem.consumeIngredients(this._pendingRecipe);
    this._fusingItems = [];
    this._fusingStartPositions.clear();
    this.mutationSystem.onInventoryChanged(); // ingredients gone - recheck availability now, not stale

    this.uiManager.updateMassUI(this.inventoryManager.getInventoryWeight(), this.inventoryManager.maxWeight);

    this.slimeVisual.visible = false;
    this.ratVisual.visible = true;
    this.ratVisual.scale.setScalar(0.4);
    this.playerController.setActiveMaterial(this.ratMaterial);
    // Prototype fallback (spec explicitly allows this): hide Living Inventory visuals
    // while transformed, data is fully preserved and restored on revert.
    this._setInventoryContainerVisible(false);
    this.currentForm = PLAYER_FORMS.VENOM_RAT;

    this.resourceManager.particles.spawnOutwardBurst(this.playerController.mesh.position, UP_VECTOR, 0xff2d9e, 10);
    this.playerController.triggerAbsorbPulse();

    this._phase = 'settle';
    this._stateTime = 0;
  }

  _updateReverting(deltaTime) {
    this._stateTime += deltaTime;
    const t = Math.min(this._stateTime / MUTATION_CONFIG.revertDuration, 1);
    this.ratVisual.scale.setScalar(THREE.MathUtils.lerp(1, 0.3, t));

    // Venom glow fades as the body contracts, then flickers rapidly in the final
    // stretch - a quick "destabilizing" read using only the existing rat material,
    // no new visuals/systems.
    const venomMaterial = this.ratVisual.userData.venomMaterial;
    venomMaterial.emissiveIntensity = THREE.MathUtils.lerp(1.2, 0, t);
    if (t > 0.7) this.ratVisual.visible = Math.sin(this._stateTime * 40) > -0.3;

    if (t < 1) return;

    this.ratVisual.visible = false;
    this.ratVisual.scale.setScalar(1);
    this.ratVisual.position.z = 0; // clears any leftover bite-lunge offset (see getBitePose())
    venomMaterial.emissiveIntensity = 0.6; // restored to its idle resting value for next time
    this.slimeVisual.visible = true;
    this.slimeVisual.scale.setScalar(1);
    this.playerController.setActiveMaterial(this.slimeMaterial);
    this._setInventoryContainerVisible(true);
    this.currentForm = PLAYER_FORMS.SLIME;
    this.state = TRANSFORM_STATES.SLIME;
    this._phase = null;
    this.mutationSystem.onInventoryChanged();

    // Brief flash + Hollowdrop wobble landing back as Slime, reusing the same
    // particle-burst/absorb-pulse hooks the transform-in already uses.
    this.resourceManager.particles.spawnOutwardBurst(this.playerController.mesh.position, UP_VECTOR, 0x7cffb2, 8);
    this.playerController.triggerAbsorbPulse();

    if (DEBUG_MUTATION) console.log('Form changed:\nVENOM_RAT -> SLIME');
  }

  /** Lightweight procedural idle/movement animation: tail sway, ear twitch, leg bob
   *  (speed-driven), venom glow pulse - plus biological instability that ramps up as
   *  the mutation countdown approaches zero, and the countdown update itself. */
  _updateRatIdle(deltaTime) {
    this._ratTime += deltaTime;
    const speedRatio = Math.min(this.playerController.currentVelocity.length() / PLAYER_MAX_SPEED, 1);
    const { legs, tailPivot, earLeft, earRight, venomMaterial } = this.ratVisual.userData;

    const bobSpeed = 4 + speedRatio * 8;
    const legSwingAmount = 0.15 + speedRatio * 0.25;
    const legSwing = Math.sin(this._ratTime * bobSpeed) * legSwingAmount;
    for (let i = 0; i < legs.length; i++) {
      legs[i].rotation.x = 0.1 + legSwing * (i % 2 === 0 ? 1 : -1);
    }

    tailPivot.rotation.y = Math.sin(this._ratTime * 2.2) * 0.25;

    const earTwitch = Math.sin(this._ratTime * 5) * 0.05;
    earLeft.rotation.z = earTwitch;
    earRight.rotation.z = -earTwitch;

    // instability: 0 (just transformed) .. 1 (about to expire) - the same ratio the
    // HUD reads, so the Rat's own body and the UI always agree on how much time is left.
    const instability = 1 - this.getMutationRatio();
    const pulseSpeed = 3 + instability * 5;
    const venomPulse = 0.6 + Math.sin(this._ratTime * pulseSpeed) * 0.4;
    // Irregular flicker only kicks in deep in the critical window, and stays subtle -
    // this is a glow variation, not a strobe.
    const flicker = instability > 0.7 ? (Math.random() - 0.5) * (instability - 0.7) * 1.3 : 0;
    venomMaterial.emissiveIntensity = Math.max(0, 0.6 + venomPulse * 0.6 + flicker);

    // Small irregular body pulse in the same critical window - purely cosmetic (scale
    // on the Rat visual itself, never the movement-owning player root), so it never
    // touches player control even in the mutation's final second.
    const wobbleAmount = instability > 0.7 ? (instability - 0.7) / 0.3 : 0;
    const instabilityScale = 1 + Math.sin(this._ratTime * 16) * 0.02 * wobbleAmount;

    // Venom Bite's crouch/lunge/recoil, read (never driven) from PlayerCombatController
    // - see the constructor comment. Combines multiplicatively with the instability
    // wobble above rather than overwriting it, so the two never fight over the property.
    const bite = this.playerCombatController?.getBitePose();
    this.ratVisual.scale.setScalar(instabilityScale * (bite?.crouchScale ?? 1));
    this.ratVisual.position.z = bite ? -bite.lungeOffset : 0; // forward = -Z

    this._updateMutationTimer(deltaTime);
  }
}
