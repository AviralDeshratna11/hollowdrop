import * as THREE from 'three';
import { RESOURCE_TYPES } from './resourceTypes.js?v=5.3';
import { DEBUG_BURDEN } from './burdenSystem.js?v=5.3';

export const ITEM_TOUCH_CONFIG = {
  itemTouchRadiusPx: 34, // generous screen-space touch target - items render only a few px across
  selectionScaleBoost: 1.1,
};

export const CONSUME_CONFIG = {
  tapMaxDistancePx: 12,
  tapMaxDurationMs: 300,
  actionTimeoutSeconds: 3.0, // how long the Consume button stays up before auto-dismissing
  digestionDuration: 0.45, // seconds, item-toward-core shrink/fade
};

// Reused scratch objects - hit-testing runs on pointerdown/up rather than per frame,
// but is kept allocation-free regardless.
const tempProjectVec = new THREE.Vector3();
const ZERO_VECTOR = new THREE.Vector3(0, 0, 0); // digestion target: the slime's own local core

/**
 * Touching a resource visible inside Hollowdrop, to eat it.
 *
 * Registers its own pointermove/up/cancel listeners on the canvas but only acts on the
 * pointer it claimed via tryBeginItemTouch() - which InputController calls as a gesture
 * guard before starting a movement drag, giving item selection priority over movement.
 *
 * SWIPE-TO-EXPEL WAS REMOVED. This class used to own a second gesture: drag an item
 * outward through the membrane to eject it. It is gone at the user's request, which
 * frees the outward-drag on the body for other gestures.
 *
 * Consequence worth knowing: dropping cargo is now only possible by dying
 * (DeathRespawnManager scatters a fraction of the inventory via
 * resourceManager.spawnDroppedResource, a separate path that is unaffected). A player
 * who over-collects has no deliberate way to shed weight and recover speed, which is
 * the mechanic Stage 2 of the Player Journey Map is built on. If expelling comes back,
 * it should hang off the inventory UI rather than a body gesture.
 */
export class InventoryInteractionController {
  constructor({ canvas, camera, player, inventoryManager, resourceManager, uiManager, playerController, metabolismSystem, mutationSystem, playerRadius }) {
    this.canvas = canvas;
    this.camera = camera;
    this.player = player;
    this.inventoryManager = inventoryManager;
    this.resourceManager = resourceManager;
    this.uiManager = uiManager;
    this.playerController = playerController;
    this.metabolismSystem = metabolismSystem;
    this.mutationSystem = mutationSystem;
    this.playerRadius = playerRadius;

    this.selectedItem = null;
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.startTime = 0;
    this.hasExpelledOnce = false;
    this.hasConsumedOnce = false;

    this._scaleAnimItem = null;

    // Consume: an item awaiting confirmation via the on-screen button.
    this.consumeCandidate = null;
    this._consumeActionTimer = 0;

    // Digestion: the item currently animating toward the core after Consume is pressed.
    this._digestingItem = null;
    this._digestTime = 0;
    this._digestStartPosition = new THREE.Vector3();
    this._digestStartScale = 0;

    this.consumeActionEl = document.getElementById('consume-action');
    this.consumeActionNameEl = document.getElementById('consume-action-name');
    this.consumeActionButtonEl = document.getElementById('consume-action-button');
    this.consumeActionButtonEl?.addEventListener('click', (e) => {
      e.preventDefault();
      this._confirmConsume();
    });

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerEnd = this._onPointerEnd.bind(this);
    canvas.addEventListener('pointermove', this._onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', this._onPointerEnd, { passive: false });
    canvas.addEventListener('pointercancel', this._onPointerEnd, { passive: false });
  }

  /** The item whose position InventoryManager's normal floaty update should skip this
   *  frame - either being drag-previewed for expel, or mid-digestion toward the core. */
  getExcludedItemId() {
    return this.selectedItem?.id ?? this._digestingItem?.id ?? null;
  }

  /** Gesture guard called by InputController on pointerdown. Returns true if claimed. */
  tryBeginItemTouch(event) {
    // Any new touch elsewhere dismisses a pending Consume action (tap-elsewhere,
    // movement-start, and another item gesture are all just "a new pointerdown").
    this._hideConsumeAction();

    if (this.selectedItem !== null) return false;
    if (this.inventoryManager.items.length === 0) return false;

    const item = this._hitTestItem(event.clientX, event.clientY);
    if (!item) return false;

    this.selectedItem = item;
    this.pointerId = event.pointerId;
    this.startX = this.currentX = event.clientX;
    this.startY = this.currentY = event.clientY;
    this.startTime = performance.now();

    if (this.canvas.setPointerCapture) {
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch (_) {
        /* no-op */
      }
    }

    if (DEBUG_BURDEN) console.log(`Selected ${item.name}`);
    return true;
  }

  /** Screen-space projected hit test (not 3D raycasting): internal items render only a
   *  handful of pixels across at this camera distance, so a fixed pixel-radius touch
   *  target gives far more reliable mobile selection than sizing an invisible 3D collider. */
  _hitTestItem(clientX, clientY) {
    let nearest = null;
    let nearestDistSq = Infinity;
    const thresholdSq = ITEM_TOUCH_CONFIG.itemTouchRadiusPx * ITEM_TOUCH_CONFIG.itemTouchRadiusPx;

    for (const item of this.inventoryManager.items) {
      item.visualMesh.getWorldPosition(tempProjectVec);
      const screen = this._worldPositionToScreen(tempProjectVec);
      const dx = screen.x - clientX;
      const dy = screen.y - clientY;
      const distSq = dx * dx + dy * dy;
      if (distSq < thresholdSq && distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = item;
      }
    }
    return nearest;
  }

  _worldPositionToScreen(worldVec3) {
    tempProjectVec.copy(worldVec3).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (tempProjectVec.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (1 - (tempProjectVec.y * 0.5 + 0.5)) * rect.height + rect.top,
    };
  }

  // Tracked only so _onPointerEnd can tell a tap from a drag; nothing is previewed
  // any more now that dragging an item outward does nothing.
  _onPointerMove(event) {
    if (this.selectedItem === null || event.pointerId !== this.pointerId) return;
    event.preventDefault();
    this.currentX = event.clientX;
    this.currentY = event.clientY;
  }


  _onPointerEnd(event) {
    if (this.selectedItem === null || event.pointerId !== this.pointerId) return;
    event.preventDefault();

    const item = this.selectedItem;
    const dx = this.currentX - this.startX;
    const dy = this.currentY - this.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const elapsed = performance.now() - this.startTime;

    // Only one outcome left: a tap brings up Consume. Anything draggier is simply
    // released, since there is no longer an outward gesture for it to become.
    const isTap = dist <= CONSUME_CONFIG.tapMaxDistancePx && elapsed <= CONSUME_CONFIG.tapMaxDurationMs;

    this._returnItemToRest(item);
    if (isTap) {
      const config = RESOURCE_TYPES[item.type];
      if (config.edible) {
        this._showConsumeAction(item);
      } else {
        this.uiManager.showNotEdible(item.name);
      }
    }

    this._resetGestureState();
  }

  /** Safety hook for external callers (e.g. the inventory panel opening mid-gesture,
   *  or DeathRespawnManager when the player dies). */
  cancelActiveGesture() {
    if (this.selectedItem) this._returnItemToRest(this.selectedItem);
    this._resetGestureState();
    this._hideConsumeAction();
    this._digestingItem = null; // death already wipes the whole inventory separately
  }

  // --- Consume ---------------------------------------------------------------

  _showConsumeAction(item) {
    this.consumeCandidate = item;
    this._consumeActionTimer = CONSUME_CONFIG.actionTimeoutSeconds;

    if (this.consumeActionNameEl) this.consumeActionNameEl.textContent = item.name;
    this._positionConsumeAction(item);
    this.consumeActionEl?.classList.add('consume-action--visible');
  }

  _hideConsumeAction() {
    if (!this.consumeCandidate) return;
    this.consumeCandidate = null;
    this.consumeActionEl?.classList.remove('consume-action--visible');
  }

  _positionConsumeAction(item) {
    if (!this.consumeActionEl) return;
    item.visualMesh.getWorldPosition(tempProjectVec);
    const screen = this._worldPositionToScreen(tempProjectVec);
    this.consumeActionEl.style.left = `${screen.x}px`;
    this.consumeActionEl.style.top = `${screen.y}px`;
  }

  _confirmConsume() {
    const item = this.consumeCandidate;
    if (!item) return;
    this._hideConsumeAction();
    this.consumeItem(item);
  }

  /**
   * Consumes one real item immediately - the shared core of the world-tap Consume flow
   * above (_confirmConsume, via the on-screen button that appears after tapping an item
   * inside Hollowdrop) and the Bag/Inventory panel's own Consume button
   * (inventoryUI.js), so both paths always produce identical bookkeeping and the same
   * toward-the-core digestion animation. Returns false (no-op beyond the Energy Full
   * toast) if the item is no longer actually carried or the player is already full.
   */
  consumeItem(item) {
    // Re-verify it's still actually in the inventory (e.g. hasn't been expelled/consumed
    // by some other path since the caller last saw it).
    if (!this.inventoryManager.items.includes(item)) return false;
    // Only one digestion animation runs at a time - a rapid double-tap on the panel's
    // Consume button (or overlapping world-tap + panel calls) would otherwise stomp the
    // in-flight item's start position/scale.
    if (this._digestingItem !== null) return false;

    if (this.metabolismSystem.isFull()) {
      this.uiManager.showEnergyFull();
      return false;
    }

    this._digestingItem = item;
    this._digestTime = 0;
    this._digestStartPosition.copy(item.visualMesh.position);
    this._digestStartScale = item.visualMesh.scale.x;
    return true;
  }

  /** Item shrinks and moves toward the slime's own core (local origin) while
   *  digesting - distinct from expel's "burst outward through the membrane". */
  _updateDigestion(deltaTime) {
    if (!this._digestingItem) return;
    const item = this._digestingItem;

    this._digestTime += deltaTime;
    const t = Math.min(this._digestTime / CONSUME_CONFIG.digestionDuration, 1);
    const eased = t * t;

    item.visualMesh.position.lerpVectors(this._digestStartPosition, ZERO_VECTOR, eased);
    const scale = this._digestStartScale * (1 - eased);
    item.visualMesh.scale.setScalar(Math.max(scale, 0.001));

    if (t < 1) return;

    this._digestingItem = null;
    const config = RESOURCE_TYPES[item.type];
    this.inventoryManager.removeItem(item.id);
    this.uiManager.updateMassUI(this.inventoryManager.getInventoryWeight(), this.inventoryManager.maxWeight);
    this.metabolismSystem.addEnergy(config.energyValue);
    this.metabolismSystem.notifyConsumed();
    this.playerController.triggerAbsorbPulse();
    this.playerController.triggerEnergyPulse();
    this.mutationSystem?.onInventoryChanged();
    this.hasConsumedOnce = true;

    if (DEBUG_BURDEN) console.log(`Consumed ${item.name} (+${config.energyValue} energy)`);
  }

  _returnItemToRest(item) {
    item.visualMesh.position.copy(item.basePosition);
  }

  _resetGestureState() {
    if (this.canvas.releasePointerCapture && this.pointerId !== null) {
      try {
        this.canvas.releasePointerCapture(this.pointerId);
      } catch (_) {
        /* no-op */
      }
    }
    this.selectedItem = null;
    this.pointerId = null;
  }


  /** Smoothly scales the selected item up (and back down again after release) - the
   *  only visual selection feedback, kept diegetic per spec (no menus/outlines). Also
   *  drives the Consume button's timeout/position and the digestion animation. */
  update(deltaTime) {
    const smooth = 1 - Math.exp(-10 * deltaTime);

    if (this.selectedItem) {
      this._scaleAnimItem = this.selectedItem;
      this._lerpItemScale(this.selectedItem, ITEM_TOUCH_CONFIG.selectionScaleBoost, smooth);
    } else if (this._scaleAnimItem) {
      const done = this._lerpItemScale(this._scaleAnimItem, 1, smooth);
      if (done) this._scaleAnimItem = null;
    }

    if (this.consumeCandidate) {
      // Item disappeared out from under the button (e.g. expelled some other way) - bail.
      if (!this.inventoryManager.items.includes(this.consumeCandidate)) {
        this._hideConsumeAction();
      } else {
        this._positionConsumeAction(this.consumeCandidate);
        this._consumeActionTimer -= deltaTime;
        if (this._consumeActionTimer <= 0) this._hideConsumeAction();
      }
    }

    this._updateDigestion(deltaTime);
  }

  _lerpItemScale(item, targetMultiplier, smooth) {
    const target = item.baseVisualScale * targetMultiplier;
    const scale = item.visualMesh.scale;
    scale.x += (target - scale.x) * smooth;
    scale.y += (target - scale.y) * smooth;
    scale.z += (target - scale.z) * smooth;
    return Math.abs(scale.x - target) < 0.001;
  }
}
