import * as THREE from 'three';
import { RESOURCE_TYPES } from './resourceTypes.js?v=5.3';
import { EXPEL_PHYSICS } from './resourceManager.js?v=5.3';
import { getTerrainHeight } from './terrain.js?v=5.4';

export const WHEEL_CONFIG = {
  // How long the press has to be held before the wheel opens.
  holdDurationMs: 420,
  // Press must land within this many pixels of the creature's centre on screen. The
  // body is roughly 80px across in play, so this is deliberately forgiving.
  bodyTouchRadiusPx: 90,
  // Moving further than this during the hold cancels it - the player was starting a
  // movement swipe, not a long press.
  moveCancelPx: 16,
  radiusPx: 108,        // wheel radius from the centre button
  segmentSizePx: 62,
};

// Reused scratch objects - the expel path runs on a tap, not per frame, but this
// project keeps allocation out of interaction code as a matter of course.
const tempProjectVec = new THREE.Vector3();
const tempWorldRight = new THREE.Vector3();
const tempWorldForward = new THREE.Vector3();
const tempWorldDir = new THREE.Vector3();
const tempSpawnPos = new THREE.Vector3();

/**
 * Radial inventory: press and hold on Hollowdrop to open a wheel of everything it has
 * absorbed, then tap a segment to expel that item back into the world.
 *
 * This is where expelling lives now. It used to be a swipe - drag an item outward
 * through the membrane - which was removed at the user's request. That mattered more
 * than it looks: Stage 2 of the Player Journey Map ("The Burden & Physics") is built
 * entirely on being able to shed cargo under pressure, so with the swipe gone and
 * nothing replacing it a player who over-collected could only recover speed by dying.
 * The wheel restores that decision, and it fits the document's own "menu-less, diegetic"
 * framing better than the grid panel does.
 *
 * Gesture detection deliberately does NOT claim the pointer up front. InputController's
 * gesture guard is synchronous - claiming there would block movement on every touch that
 * happens to start near the body, before we know whether it is a hold or a swipe.
 * Instead the press is watched passively and movement is cancelled only once the hold
 * actually completes.
 */
export class InventoryWheelController {
  constructor({ canvas, camera, player, inventoryManager, resourceManager, uiManager, playerController, mutationSystem, inputController, playerRadius }) {
    this.canvas = canvas;
    this.camera = camera;
    this.player = player;
    this.inventoryManager = inventoryManager;
    this.resourceManager = resourceManager;
    this.uiManager = uiManager;
    this.playerController = playerController;
    this.mutationSystem = mutationSystem;
    this.inputController = inputController;
    this.playerRadius = playerRadius;

    this.isOpen = false;
    this.enabled = true;
    this._holdTimer = null;
    this._holdPointerId = null;
    this._holdStartX = 0;
    this._holdStartY = 0;

    this.root = document.createElement('div');
    this.root.id = 'inventory-wheel';
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);

    // Backdrop: closes the wheel and, critically, swallows the tap so it can never
    // reach the canvas and start a movement drag underneath the open wheel.
    this.backdrop = document.createElement('div');
    this.backdrop.id = 'inventory-wheel-backdrop';
    this.backdrop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
    document.body.appendChild(this.backdrop);

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerEnd = this._onPointerEnd.bind(this);
    canvas.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    canvas.addEventListener('pointermove', this._onPointerMove, { passive: true });
    canvas.addEventListener('pointerup', this._onPointerEnd, { passive: true });
    canvas.addEventListener('pointercancel', this._onPointerEnd, { passive: true });
  }

  _worldPositionToScreen(worldVec3) {
    tempProjectVec.copy(worldVec3).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (tempProjectVec.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (1 - (tempProjectVec.y * 0.5 + 0.5)) * rect.height + rect.top,
    };
  }

  _onPointerDown(event) {
    if (!this.enabled || this.isOpen || this._holdTimer !== null) return;
    if (this.inventoryManager.items.length === 0) return;

    const centre = this._worldPositionToScreen(this.player.position);
    const dx = event.clientX - centre.x;
    const dy = event.clientY - centre.y;
    if (dx * dx + dy * dy > WHEEL_CONFIG.bodyTouchRadiusPx ** 2) return;

    this._holdPointerId = event.pointerId;
    this._holdStartX = event.clientX;
    this._holdStartY = event.clientY;
    this._holdTimer = setTimeout(() => {
      this._holdTimer = null;
      this.open();
    }, WHEEL_CONFIG.holdDurationMs);
  }

  _onPointerMove(event) {
    if (this._holdTimer === null || event.pointerId !== this._holdPointerId) return;
    const dx = event.clientX - this._holdStartX;
    const dy = event.clientY - this._holdStartY;
    // Drifted too far - the player is swiping to move, not holding. Let movement have it.
    if (dx * dx + dy * dy > WHEEL_CONFIG.moveCancelPx ** 2) this._cancelHold();
  }

  _onPointerEnd(event) {
    if (event.pointerId !== this._holdPointerId) return;
    this._cancelHold();
  }

  _cancelHold() {
    if (this._holdTimer !== null) clearTimeout(this._holdTimer);
    this._holdTimer = null;
    this._holdPointerId = null;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    // The hold began as a normal touch, so movement has already started following it.
    // Cancel it or Hollowdrop keeps coasting while the wheel is up.
    this.inputController?.cancel();
    this.playerController?.haltMovement?.();
    this._build();
    this.backdrop.classList.add('inventory-wheel-backdrop--visible');
    this.root.classList.add('inventory-wheel--visible');
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('inventory-wheel--visible');
    this.backdrop.classList.remove('inventory-wheel-backdrop--visible');
  }

  /** Rebuilds the segments from the current inventory. Called on open and after every
   *  expel, so the wheel always reflects what is actually inside. */
  _build() {
    this.root.innerHTML = '';

    const centre = this._worldPositionToScreen(this.player.position);
    this.root.style.left = `${centre.x}px`;
    this.root.style.top = `${centre.y}px`;

    // Group identical types so eight Glow Spores are one segment showing x8, rather
    // than eight segments crowding the ring.
    const grouped = new Map();
    for (const item of this.inventoryManager.items) {
      if (!grouped.has(item.type)) grouped.set(item.type, []);
      grouped.get(item.type).push(item);
    }

    const entries = [...grouped.entries()];
    if (entries.length === 0) {
      this.close();
      return;
    }

    entries.forEach(([type, items], i) => {
      const config = RESOURCE_TYPES[type];
      // Start at the top and go clockwise - the ring reads like a clock face.
      const angle = (i / entries.length) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * WHEEL_CONFIG.radiusPx;
      const y = Math.sin(angle) * WHEEL_CONFIG.radiusPx;

      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'wheel-segment';
      seg.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      seg.style.setProperty('--seg-color', `#${config.color.toString(16).padStart(6, '0')}`);
      seg.innerHTML = `
        <span class="wheel-seg-dot"></span>
        <span class="wheel-seg-name">${config.name}</span>
        <span class="wheel-seg-meta">${items.length > 1 ? `x${items.length} · ` : ''}${config.weight} kg</span>
      `;
      seg.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Expel the last of that type - matches how MutationSystem.consumeIngredients
        // walks the inventory backwards, so "most recently absorbed goes first".
        this._expel(items[items.length - 1], angle);
      });
      this.root.appendChild(seg);
    });

    const hub = document.createElement('div');
    hub.className = 'wheel-hub';
    hub.textContent = `${this.inventoryManager.getInventoryWeight().toFixed(1)} / ${this.inventoryManager.maxWeight}`;
    this.root.appendChild(hub);
  }

  /**
   * Ejects one item back into the world in a given world-space direction. Lifted from
   * the removed swipe gesture so the physics, particle burst and mass bookkeeping stay
   * identical - only the input that triggers it has changed. Shared by both the wheel's
   * own per-segment expel (_expel, below) and the Bag/Inventory panel's Expel button
   * (expelItemById, below) - spec section 42 explicitly asks that the panel never
   * duplicate this logic.
   */
  _expelInDirection(item, worldDir) {
    const spawnX = this.player.position.x + worldDir.x * this.playerRadius;
    const spawnZ = this.player.position.z + worldDir.z * this.playerRadius;
    const spawnY = getTerrainHeight(spawnX, spawnZ) + 0.25;
    tempSpawnPos.set(spawnX, spawnY, spawnZ);

    this.resourceManager.spawnDroppedResource(item.type, tempSpawnPos, worldDir);
    this.resourceManager.particles.spawnOutwardBurst(tempSpawnPos, worldDir, RESOURCE_TYPES[item.type].color);

    this.inventoryManager.removeItem(item.id);
    this.uiManager.updateMassUI(this.inventoryManager.getInventoryWeight(), this.inventoryManager.maxWeight);
    this.playerController.triggerAbsorbPulse();
    this.mutationSystem?.onInventoryChanged();
  }

  /**
   * Ejects one item back into the world.
   *
   * @param screenAngle the segment's angle on the wheel, so the item flies out in the
   *        direction the player actually tapped rather than somewhere arbitrary.
   */
  _expel(item, screenAngle) {
    const dirX = Math.cos(screenAngle);
    const dirY = Math.sin(screenAngle);

    // Screen direction -> world ground direction via the camera's own basis:
    // camera-right maps to screen-right, flattened camera-forward maps to screen-up.
    this.camera.getWorldDirection(tempWorldForward);
    tempWorldForward.y = 0;
    tempWorldForward.normalize();
    tempWorldRight.crossVectors(tempWorldForward, this.camera.up).normalize();

    tempWorldDir
      .set(0, 0, 0)
      .addScaledVector(tempWorldRight, dirX)
      .addScaledVector(tempWorldForward, -dirY)
      .normalize();

    this._expelInDirection(item, tempWorldDir);

    // Rebuild rather than close: shedding weight is usually several taps in a row, and
    // reopening the wheel between each would make that miserable under pressure.
    this._build();
  }

  /**
   * Public: expels one item by id, launched directly behind the player (spec section
   * 41) - used by the Bag/Inventory panel, which has no on-screen wheel angle to derive
   * a throw direction from. Reuses _expelInDirection so the physics/particles/mass/
   * mutation bookkeeping are byte-for-byte identical to the wheel's own expel.
   * Returns false (no-op) if the item is no longer actually carried.
   */
  expelItemById(itemId) {
    const item = this.inventoryManager.items.find((i) => i.id === itemId);
    if (!item) return false;

    this.playerController.getForwardDirection(tempWorldDir).negate();
    this._expelInDirection(item, tempWorldDir);

    // Keep the wheel's own view in sync in case it happens to be open behind the panel
    // (it never is at the same time in practice - main.js's onOpen closes it - but this
    // costs nothing and removes any doubt).
    if (this.isOpen) this._build();
    return true;
  }

  /** Safety hook for death, mutation and the Play Again reset - same role as
   *  InventoryInteractionController.cancelActiveGesture(). */
  cancel() {
    this._cancelHold();
    this.close();
  }
}
