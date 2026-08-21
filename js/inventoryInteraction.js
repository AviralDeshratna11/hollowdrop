import * as THREE from 'three';
import { RESOURCE_TYPES } from './resourceTypes.js';
import { EXPEL_PHYSICS } from './resourceManager.js';
import { DEBUG_BURDEN } from './burdenSystem.js';

export const EXPEL_CONFIG = {
  itemTouchRadiusPx: 34, // generous screen-space touch target - items render only a few px across
  minDistance: 40, // px
  minSpeed: 0.25, // px/ms
  maxGestureTime: 700, // ms
  outwardDot: 0.3,
  previewMaxOffset: 0.22, // local units the item shifts toward the membrane while dragging
  selectionScaleBoost: 1.1,
};

export const CONSUME_CONFIG = {
  tapMaxDistancePx: 12,
  tapMaxDurationMs: 300,
  actionTimeoutSeconds: 3.0, // how long the Consume button stays up before auto-dismissing
  digestionDuration: 0.45, // seconds, item-toward-core shrink/fade
};

// Reused scratch objects - hit-testing and the world-direction conversion only run
// on pointerdown/pointerup (not per-frame), but kept allocation-free regardless.
const tempProjectVec = new THREE.Vector3();
const tempWorldRight = new THREE.Vector3();
const tempWorldForward = new THREE.Vector3();
const tempWorldDir = new THREE.Vector3();
const tempSpawnPos = new THREE.Vector3();
const tempLocalDir = new THREE.Vector3();
const ZERO_VECTOR = new THREE.Vector3(0, 0, 0); // digestion target: the slime's own local core

/**
 * Owns the second swipe gesture: touching a resource visible inside Hollowdrop
 * and dragging it back out through the membrane. Registers its own
 * pointermove/up/cancel listeners on the canvas, but only acts on the pointer it
 * claimed via tryBeginExpel() - which InputController calls as a gesture guard
 * before starting a movement drag, giving item-selection priority over movement.
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
    this.outwardScreenDir = { x: 0, y: -1 };
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
  tryBeginExpel(event) {
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

    const playerScreen = this._worldPositionToScreen(this.player.position);
    let dx = this.startX - playerScreen.x;
    let dy = this.startY - playerScreen.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-3) {
      dx = 0;
      dy = -1;
    } else {
      dx /= len;
      dy /= len;
    }
    this.outwardScreenDir.x = dx;
    this.outwardScreenDir.y = dy;

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
    const thresholdSq = EXPEL_CONFIG.itemTouchRadiusPx * EXPEL_CONFIG.itemTouchRadiusPx;

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

  _onPointerMove(event) {
    if (this.selectedItem === null || event.pointerId !== this.pointerId) return;
    event.preventDefault();
    this.currentX = event.clientX;
    this.currentY = event.clientY;
    this._updatePreview();
  }

  /** Anticipation while dragging: item shifts toward the membrane along its own resting
   *  direction from the slime's center, clamped - it doesn't follow the finger exactly
   *  and can't escape until the gesture is confirmed. */
  _updatePreview() {
    const item = this.selectedItem;
    const dx = this.currentX - this.startX;
    const dy = this.currentY - this.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const t = Math.min(dist / EXPEL_CONFIG.minDistance, 1);

    tempLocalDir.copy(item.basePosition);
    if (tempLocalDir.lengthSq() < 1e-6) tempLocalDir.set(0, 1, 0);
    tempLocalDir.normalize();

    item.visualMesh.position.set(
      item.basePosition.x + tempLocalDir.x * EXPEL_CONFIG.previewMaxOffset * t,
      item.basePosition.y + tempLocalDir.y * EXPEL_CONFIG.previewMaxOffset * t,
      item.basePosition.z + tempLocalDir.z * EXPEL_CONFIG.previewMaxOffset * t
    );
  }

  _onPointerEnd(event) {
    if (this.selectedItem === null || event.pointerId !== this.pointerId) return;
    event.preventDefault();

    const item = this.selectedItem;
    const dx = this.currentX - this.startX;
    const dy = this.currentY - this.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const elapsed = performance.now() - this.startTime;
    const speed = elapsed > 0 ? dist / elapsed : 0;

    let outwardDot = -1;
    if (dist > 1e-3) {
      outwardDot = (dx / dist) * this.outwardScreenDir.x + (dy / dist) * this.outwardScreenDir.y;
    }

    const validSwipe =
      dist >= EXPEL_CONFIG.minDistance &&
      speed >= EXPEL_CONFIG.minSpeed &&
      elapsed <= EXPEL_CONFIG.maxGestureTime &&
      outwardDot > EXPEL_CONFIG.outwardDot;

    // A tap (small travel, short duration) and a valid swipe (>= minDistance) are
    // mutually exclusive by threshold, so there's no ambiguity between the two branches.
    const isTap = dist <= CONSUME_CONFIG.tapMaxDistancePx && elapsed <= CONSUME_CONFIG.tapMaxDurationMs;

    if (validSwipe) {
      if (DEBUG_BURDEN) console.log('Expel gesture valid');
      this._confirmExpel(item, dx, dy, dist);
    } else if (isTap) {
      this._cancelExpel(item); // snap back to resting position - tap doesn't expel
      const config = RESOURCE_TYPES[item.type];
      if (config.edible) {
        this._showConsumeAction(item);
      } else {
        this.uiManager.showNotEdible(item.name);
      }
    } else {
      this._cancelExpel(item); // ambiguous gesture (too slow/far to be a tap, not far enough to expel)
    }

    this._resetGestureState();
  }

  /** Safety hook for external callers (e.g. the inventory panel opening mid-gesture,
   *  or DeathRespawnManager when the player dies). */
  cancelActiveGesture() {
    if (this.selectedItem) this._cancelExpel(this.selectedItem);
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
    // Re-verify it's still actually in the inventory (e.g. hasn't been expelled/consumed
    // by some other path since the button appeared).
    if (!this.inventoryManager.items.includes(item)) {
      this._hideConsumeAction();
      return;
    }

    if (this.metabolismSystem.isFull()) {
      this.uiManager.showEnergyFull();
      this._hideConsumeAction();
      return;
    }

    this._hideConsumeAction();

    this._digestingItem = item;
    this._digestTime = 0;
    this._digestStartPosition.copy(item.visualMesh.position);
    this._digestStartScale = item.visualMesh.scale.x;
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

  _cancelExpel(item) {
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

  _confirmExpel(item, screenDx, screenDy, screenDist) {
    const dirX = screenDx / screenDist;
    const dirY = screenDy / screenDist;

    // Screen swipe -> world ground direction via the camera's own basis (section 24):
    // camera-right maps to screen-right, camera-forward (flattened) maps to screen-up.
    this.camera.getWorldDirection(tempWorldForward);
    tempWorldForward.y = 0;
    tempWorldForward.normalize();
    tempWorldRight.crossVectors(tempWorldForward, this.camera.up).normalize();

    tempWorldDir
      .set(0, 0, 0)
      .addScaledVector(tempWorldRight, dirX)
      .addScaledVector(tempWorldForward, -dirY)
      .normalize();

    tempSpawnPos.set(
      this.player.position.x + tempWorldDir.x * this.playerRadius,
      EXPEL_PHYSICS.groundRestHeight + 0.25,
      this.player.position.z + tempWorldDir.z * this.playerRadius
    );

    this.resourceManager.spawnDroppedResource(item.type, tempSpawnPos, tempWorldDir);
    this.resourceManager.particles.spawnOutwardBurst(tempSpawnPos, tempWorldDir, RESOURCE_TYPES[item.type].color);

    this.inventoryManager.removeItem(item.id);
    this.uiManager.updateMassUI(this.inventoryManager.getInventoryWeight(), this.inventoryManager.maxWeight);
    this.playerController.triggerAbsorbPulse();
    this.mutationSystem?.onInventoryChanged();
    this.hasExpelledOnce = true;
    this._scaleAnimItem = null; // that mesh is disposed now, stop animating its scale

    if (DEBUG_BURDEN) console.log(`Expelled ${item.name}`);
  }

  /** Smoothly scales the selected item up (and back down again after release) - the
   *  only visual selection feedback, kept diegetic per spec (no menus/outlines). Also
   *  drives the Consume button's timeout/position and the digestion animation. */
  update(deltaTime) {
    const smooth = 1 - Math.exp(-10 * deltaTime);

    if (this.selectedItem) {
      this._scaleAnimItem = this.selectedItem;
      this._lerpItemScale(this.selectedItem, EXPEL_CONFIG.selectionScaleBoost, smooth);
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
