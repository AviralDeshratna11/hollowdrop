import * as THREE from 'three';
import { RESOURCE_TYPES } from './resourceTypes.js?v=5.3';
import { getInventoryItemUIData, wireIconFallbacks } from './inventoryUI.js?v=5.3';
import { BURDEN_CONFIG } from './burdenSystem.js?v=5.3';
import { GAME_STATES } from './gameFlowController.js?v=5.3';

export const RESOURCE_INTERACTION_STATE = {
  IDLE: 'idle',
  NEARBY: 'nearby',
  INSPECTING: 'inspecting',
  ACQUIRING: 'acquiring',
  COLLECTED: 'collected',
};

// Kept small and explicit on purpose (spec section 58) - CLOSE isn't a "contextual
// action" on the resource itself, just the panel's own dismissal, so it isn't listed
// here. Future contextual actions (Preserve/Transform) would add a value here and a
// button in the panel; nothing else in this file assumes there are only ever two.
export const RESOURCE_ACTIONS = {
  INSPECT: 'inspect',
  ACQUIRE: 'acquire',
};

export const RESOURCE_INTERACTION_CONFIG = {
  awarenessRadius: 2.4,
  inspectRadius: 1.6,
  acquireRadius: 1.6,
  scanInterval: 0.08,
  tapMaxDistancePx: 12,   // matches InventoryInteractionController's own CONFIG.tapMaxDistancePx
  tapMaxDurationMs: 300,  // matches InventoryInteractionController's own CONFIG.tapMaxDurationMs
  touchRadiusPx: 32,      // generous tap target - world resources render only a few px across
};

// Reused scratch objects - hit-testing and screen projection run on pointer events or
// the throttled scan tick, never allocated fresh per frame.
const tempProjectVec = new THREE.Vector3();

/** Category + edible-ness line for the panel header (spec sections 24-30). Derived from
 *  RESOURCE_TYPES metadata rather than hardcoded per resource id, so a new resource
 *  automatically gets a sensible line instead of silently falling through to nothing. */
function categoryLine(data) {
  if (data.category === 'organic') {
    return data.edible ? 'Organic • Edible' : 'Organic • Mutation Material';
  }
  if (data.category === 'mineral') {
    // Only Iron currently outweighs Stone - reads as "heavier than the other mineral"
    // without hardcoding a specific resource id (spec section 29).
    return data.weightEach >= 3 ? 'Heavy Mineral' : 'Mineral';
  }
  if (data.category === 'material') {
    return 'Mutation Material';
  }
  return data.categoryLabel;
}

/**
 * The one generic controller for "see a world resource, approach, get highlighted,
 * inspect, decide, acquire" (spec: Inspect -> Acquire Resource Interaction System).
 * Owns two pieces of DOM it builds itself (mirroring InventoryWheelController's own
 * self-contained approach): a small radial ring prompt anchored to the current target's
 * screen position, and a bottom-sheet Inspect panel. Neither lives in index.html.
 *
 * Does NOT own resource spawning, absorption, weight, energy, or mutation data - it
 * only reads ResourceManager/InventoryManager/BurdenSystem/inventoryUI's own metadata
 * helpers and calls ResourceManager.beginAcquire() to actually collect something.
 */
export class ResourceInteractionController {
  constructor({ canvas, camera, scene, player, resourceManager, inventoryManager, burdenSystem, mutationSystem, gameFlowController }) {
    this.canvas = canvas;
    this.camera = camera;
    this.player = player;
    this.resourceManager = resourceManager;
    this.inventoryManager = inventoryManager;
    this.burdenSystem = burdenSystem;
    this.mutationSystem = mutationSystem;
    this.gameFlowController = gameFlowController;

    this.state = RESOURCE_INTERACTION_STATE.IDLE;
    this.currentTarget = null;   // the resourceManager resource object, or null
    this._explicitTarget = null; // a directly-tapped resource wins over "nearest" (spec section 7)
    this._scanTimer = 0;
    this._elapsed = 0;
    this._inspectedTypes = new Set(); // session-only "first discovery" tracking (spec section 41)

    // Tap-vs-drag gesture state, mirroring InventoryInteractionController exactly.
    this._touchResource = null;
    this._touchPointerId = null;
    this._touchStartX = 0;
    this._touchStartY = 0;
    this._touchCurrentX = 0;
    this._touchCurrentY = 0;
    this._touchStartTime = 0;

    this._buildWorldRing(scene);
    this._buildPromptDom();
    this._buildPanelDom();

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerEnd = this._onPointerEnd.bind(this);
    canvas.addEventListener('pointermove', this._onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', this._onPointerEnd, { passive: false });
    canvas.addEventListener('pointercancel', this._onPointerEnd, { passive: false });
  }

  // --- Screen projection --------------------------------------------------------

  _worldPositionToScreen(worldVec3) {
    tempProjectVec.copy(worldVec3).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (tempProjectVec.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (1 - (tempProjectVec.y * 0.5 + 0.5)) * rect.height + rect.top,
    };
  }

  // --- Per-frame update -----------------------------------------------------------
  // Only ever called by main.js while gameFlowController.state === PLAYING (the same
  // gate every other gameplay system uses) - so this naturally stops scanning and
  // freezes the ring the instant the Inspect panel itself opens (RESOURCE_INSPECT !=
  // PLAYING), with no pause flag of its own to maintain (spec section 20).

  update(deltaTime) {
    this._elapsed += deltaTime;

    this._scanTimer -= deltaTime;
    if (this._scanTimer <= 0) {
      this._scanTimer = RESOURCE_INTERACTION_CONFIG.scanInterval;
      this.scanNearbyResources();
    }

    this._updateWorldRing();
    this._updatePromptPosition();
    this._updateHighlightPulse();
  }

  /** A resource currently mid-animation (attracting/absorbing/rejected), physics-active
   *  (freshly dropped), or in its post-drop recollection cooldown is never a valid
   *  interaction candidate - it isn't sitting there waiting to be found. */
  _isCandidate(resource) {
    return resource.state === 'idle' && resource.collectible && !resource.isPhysicsActive;
  }

  scanNearbyResources() {
    const playerPos = this.player.position;
    const awarenessSq = RESOURCE_INTERACTION_CONFIG.awarenessRadius * RESOURCE_INTERACTION_CONFIG.awarenessRadius;

    let nearest = null;
    let nearestDistSq = Infinity;
    for (const resource of this.resourceManager.resources) {
      if (!this._isCandidate(resource)) continue;
      const distSq = playerPos.distanceToSquared(resource.mesh.position);
      if (distSq < awarenessSq && distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = resource;
      }
    }

    if (this._explicitTarget) {
      const stillValid = this._isCandidate(this._explicitTarget)
        && this.resourceManager.resources.includes(this._explicitTarget)
        && playerPos.distanceToSquared(this._explicitTarget.mesh.position) < awarenessSq;
      if (!stillValid) this._explicitTarget = null;
    }

    this.setTarget(this._explicitTarget ?? nearest);
  }

  setTarget(resource) {
    if (resource === this.currentTarget) return;
    this.currentTarget = resource;
    this.state = resource ? RESOURCE_INTERACTION_STATE.NEARBY : RESOURCE_INTERACTION_STATE.IDLE;
  }

  clearTarget() {
    this._explicitTarget = null;
    this.setTarget(null);
  }

  // --- Highlighting (spec sections 9, 10, 48) --------------------------------------
  // Two lightweight pieces, both only ever applied to the single current target:
  // a floor ring (world-space, colored by the resource's own identity) and a gentle
  // additive emissive boost on top of whatever the resource's own idle animation
  // already set that frame (resourceManager.update() runs before this every frame).

  _buildWorldRing(scene) {
    const geometry = new THREE.RingGeometry(0.32, 0.4, 28);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this._worldRing = new THREE.Mesh(geometry, material);
    this._worldRing.rotation.x = -Math.PI / 2;
    this._worldRing.renderOrder = 5;
    this._worldRing.visible = false;
    scene.add(this._worldRing);
  }

  _updateWorldRing() {
    if (!this.currentTarget) {
      this._worldRing.visible = false;
      return;
    }
    const config = RESOURCE_TYPES[this.currentTarget.type];
    const meshPos = this.currentTarget.mesh.position;
    this._worldRing.position.set(meshPos.x, meshPos.y + 0.015, meshPos.z);
    this._worldRing.material.color.setHex(config.color);
    this._worldRing.material.opacity = 0.45 + Math.sin(this._elapsed * 3.2) * 0.15;
    this._worldRing.visible = true;
  }

  _updateHighlightPulse() {
    if (!this.currentTarget) return;
    const pulseMaterials = this.currentTarget.mesh.userData.pulseMaterials;
    if (!pulseMaterials) return;
    // Subtle by design (spec section 9) - "this can be interacted with", not a beacon.
    const boost = 0.3 + Math.sin(this._elapsed * 4.0) * 0.12;
    for (const material of pulseMaterials) material.emissiveIntensity += boost;
  }

  // --- Screen-space "INSPECT" prompt (the ring UI wrapping the object) ------------

  _buildPromptDom() {
    this.promptRoot = document.createElement('div');
    this.promptRoot.id = 'resource-ring';
    this.promptRoot.innerHTML = `
      <div class="resource-ring-halo"></div>
      <button type="button" class="resource-ring-btn">
        <span class="resource-ring-icon">◉</span>
        <span class="resource-ring-label">INSPECT</span>
      </button>
    `;
    this.promptRoot.querySelector('.resource-ring-btn').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.currentTarget) this.inspect(this.currentTarget);
    });
    document.body.appendChild(this.promptRoot);
  }

  _updatePromptPosition() {
    if (!this.currentTarget || this.state === RESOURCE_INTERACTION_STATE.INSPECTING) {
      this.promptRoot.classList.remove('resource-ring--visible');
      return;
    }
    const distSq = this.player.position.distanceToSquared(this.currentTarget.mesh.position);
    if (distSq >= RESOURCE_INTERACTION_CONFIG.inspectRadius * RESOURCE_INTERACTION_CONFIG.inspectRadius) {
      this.promptRoot.classList.remove('resource-ring--visible');
      return;
    }
    const config = RESOURCE_TYPES[this.currentTarget.type];
    tempProjectVec.copy(this.currentTarget.mesh.position);
    tempProjectVec.y += 0.3;
    const screen = this._worldPositionToScreen(tempProjectVec);
    this.promptRoot.style.left = `${screen.x}px`;
    this.promptRoot.style.top = `${screen.y}px`;
    this.promptRoot.style.setProperty('--ring-color', `#${config.color.toString(16).padStart(6, '0')}`);
    this.promptRoot.classList.add('resource-ring--visible');
  }

  // --- Tap-to-inspect (spec section 12) --------------------------------------------
  // Screen-space projected hit-testing rather than a THREE.Raycaster + invisible 3D
  // hitbox geometry - the world resources render only a handful of pixels across at
  // this camera distance (see resourceModels.js), so a fixed pixel-radius touch target
  // gives far more reliable mobile selection than sizing a 3D collider per mesh. This
  // mirrors InventoryInteractionController._hitTestItem exactly, which solves the
  // identical "tap a small rendered thing reliably on a phone" problem for items inside
  // the Living Inventory. It still satisfies the actual performance requirement (no
  // raycasting or hit-testing every frame): this only ever runs from a pointerdown
  // event, never from update().

  /** Gesture guard entry point, chained after InventoryInteractionController's own in
   *  main.js (see inputController.setGestureGuard). Returns true if claimed. */
  tryBeginResourceTouch(event) {
    if (this._touchResource !== null) return false;
    if (this.gameFlowController.state !== GAME_STATES.PLAYING) return false;

    const resource = this._hitTestResource(event.clientX, event.clientY);
    if (!resource) return false;

    this._touchResource = resource;
    this._touchPointerId = event.pointerId;
    this._touchStartX = this._touchCurrentX = event.clientX;
    this._touchStartY = this._touchCurrentY = event.clientY;
    this._touchStartTime = performance.now();

    if (this.canvas.setPointerCapture) {
      try { this.canvas.setPointerCapture(event.pointerId); } catch (_) { /* no-op */ }
    }
    return true;
  }

  _hitTestResource(clientX, clientY) {
    const playerPos = this.player.position;
    const awarenessSq = RESOURCE_INTERACTION_CONFIG.awarenessRadius * RESOURCE_INTERACTION_CONFIG.awarenessRadius;
    const thresholdSq = RESOURCE_INTERACTION_CONFIG.touchRadiusPx * RESOURCE_INTERACTION_CONFIG.touchRadiusPx;

    let nearest = null;
    let nearestDistSq = Infinity;
    for (const resource of this.resourceManager.resources) {
      if (!this._isCandidate(resource)) continue;
      // Only tappable if actually within range in world-space too, so a resource that
      // merely happens to render near the tap point far across the map can't be hit.
      if (playerPos.distanceToSquared(resource.mesh.position) >= awarenessSq) continue;

      const screen = this._worldPositionToScreen(resource.mesh.position);
      const dx = screen.x - clientX;
      const dy = screen.y - clientY;
      const distSq = dx * dx + dy * dy;
      if (distSq < thresholdSq && distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = resource;
      }
    }
    return nearest;
  }

  _onPointerMove(event) {
    if (this._touchResource === null || event.pointerId !== this._touchPointerId) return;
    this._touchCurrentX = event.clientX;
    this._touchCurrentY = event.clientY;
  }

  _onPointerEnd(event) {
    if (this._touchResource === null || event.pointerId !== this._touchPointerId) return;

    const resource = this._touchResource;
    const dx = this._touchCurrentX - this._touchStartX;
    const dy = this._touchCurrentY - this._touchStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const elapsed = performance.now() - this._touchStartTime;
    const isTap = dist <= RESOURCE_INTERACTION_CONFIG.tapMaxDistancePx
      && elapsed <= RESOURCE_INTERACTION_CONFIG.tapMaxDurationMs;

    this._touchResource = null;
    this._touchPointerId = null;

    if (!isTap) return;
    if (!this._isCandidate(resource) || !this.resourceManager.resources.includes(resource)) return;

    this._explicitTarget = resource;
    this.setTarget(resource);

    const distSq = this.player.position.distanceToSquared(resource.mesh.position);
    if (distSq >= RESOURCE_INTERACTION_CONFIG.inspectRadius * RESOURCE_INTERACTION_CONFIG.inspectRadius) return; // out of range - just selects it, per spec section 75
    this.inspect(resource);
  }

  // --- Inspect panel (spec sections 16-30) -----------------------------------------

  _buildPanelDom() {
    this.backdrop = document.createElement('div');
    this.backdrop.id = 'resource-inspect-backdrop';
    this.backdrop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cancelInspection();
    });
    document.body.appendChild(this.backdrop);

    this.panel = document.createElement('div');
    this.panel.id = 'resource-inspect-panel';
    // Swallow every pointer event at the panel level so nothing underneath (movement,
    // combat, Bag, radar) ever sees a touch that landed on this UI (spec section 19).
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.panel);
  }

  /**
   * Opens the Inspect panel for a resource, pausing gameplay via the same state-machine
   * gate the Bag panel uses (see gameFlowController.openResourceInspect). Refuses
   * outside PLAYING for free - covers TITLE/MEMORY/REVEAL/RUN_COMPLETE/RESETTING/
   * INVENTORY all at once (spec section 55), with no per-state check needed here.
   */
  inspect(resource) {
    if (!resource) return false;
    if (!this.gameFlowController.openResourceInspect()) return false;

    this.state = RESOURCE_INTERACTION_STATE.INSPECTING;
    this.currentTarget = resource;
    this._explicitTarget = resource;
    this.promptRoot.classList.remove('resource-ring--visible');

    this._renderPanel(resource);
    this.backdrop.classList.add('resource-inspect-backdrop--visible');
    this.panel.classList.add('resource-inspect-panel--visible');
    return true;
  }

  _renderPanel(resource) {
    const data = getInventoryItemUIData({ type: resource.type, items: [], count: 1 });
    const isFirstDiscovery = !this._inspectedTypes.has(resource.type);
    this._inspectedTypes.add(resource.type);

    const currentWeight = this.inventoryManager.getInventoryWeight();
    const maxWeight = this.inventoryManager.maxWeight;
    const afterWeight = currentWeight + data.weightEach;
    const currentLoadRatio = currentWeight / maxWeight;
    const afterLoadRatio = afterWeight / maxWeight;
    const overCapacity = afterWeight > maxWeight;
    // Only worth flagging if acquiring this crosses the threshold, not if the player
    // was already heavy beforehand (spec section 36 - "if the NEW resource causes
    // meaningful slowdown").
    const willBecomeHeavy = !overCapacity
      && afterLoadRatio >= BURDEN_CONFIG.heavyThreshold
      && currentLoadRatio < BURDEN_CONFIG.heavyThreshold;

    const statsHtml = [
      data.edible ? `<div class="ri-stat"><span>Energy</span><span class="ri-stat-value">+${data.energyValue}</span></div>` : '',
      `<div class="ri-stat"><span>Weight</span><span class="ri-stat-value">${data.weightEach}</span></div>`,
      data.mutationIngredient ? '<div class="ri-stat"><span>Mutation Ingredient</span><span class="ri-stat-value">Yes</span></div>' : '',
      data.usedIn.length ? `<div class="ri-usedin">Used in: ${data.usedIn.join(', ')}</div>` : '',
    ].filter(Boolean).join('');

    this.panel.innerHTML = `
      ${isFirstDiscovery ? '<div class="ri-discovery">NEW RESOURCE DISCOVERED</div>' : ''}
      <div class="ri-header">
        <div class="ri-icon" style="--icon-color:#${data.color.toString(16).padStart(6, '0')}">${data.icon}</div>
        <div class="ri-heading">
          <div class="ri-title">${data.name.toUpperCase()}</div>
          <div class="ri-subtitle">${categoryLine(data)}</div>
        </div>
      </div>
      ${data.description ? `<p class="ri-description">${data.description}</p>` : ''}
      <div class="ri-stats">${statsHtml}</div>
      <div class="ri-mass-preview">
        <div class="ri-mass-col"><span class="ri-mass-label">Current Mass</span><span class="ri-mass-value">${currentWeight.toFixed(1)} / ${maxWeight}</span></div>
        <span class="ri-mass-arrow">→</span>
        <div class="ri-mass-col"><span class="ri-mass-label">After Acquire</span><span class="ri-mass-value">${afterWeight.toFixed(1)} / ${maxWeight}</span></div>
      </div>
      ${willBecomeHeavy ? '<div class="ri-warning">HEAVY LOAD — Movement will decrease.</div>' : ''}
      ${overCapacity ? '<div class="ri-warning ri-warning--danger">TOO HEAVY</div>' : ''}
      <div class="ri-actions">
        <button type="button" class="ri-acquire-btn" ${overCapacity ? 'disabled' : ''}>${overCapacity ? 'TOO HEAVY' : 'ACQUIRE'}</button>
        <button type="button" class="ri-close-btn">CLOSE</button>
      </div>
    `;
    wireIconFallbacks(this.panel);
    this.panel.querySelector('.ri-close-btn').addEventListener('click', (e) => {
      e.preventDefault();
      this.cancelInspection();
    });
    const acquireBtn = this.panel.querySelector('.ri-acquire-btn');
    if (!overCapacity) {
      acquireBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.acquire(resource);
      });
    }
  }

  /**
   * Confirms acquisition. Re-validates distance and capacity rather than trusting the
   * panel's own snapshot (spec section 44) - gameplay is paused while this panel is
   * open so in practice neither can have changed, but this also covers the resource
   * having vanished out from under the panel entirely (spec section 45).
   */
  acquire(resource) {
    if (!resource || resource !== this.currentTarget) return false;
    if (!this.resourceManager.resources.includes(resource)) {
      this._closePanel();
      this.clearTarget();
      return false;
    }
    const distSq = this.player.position.distanceToSquared(resource.mesh.position);
    if (distSq >= RESOURCE_INTERACTION_CONFIG.acquireRadius * RESOURCE_INTERACTION_CONFIG.acquireRadius) return false;
    if (!this.inventoryManager.canAddItem(resource.type)) return false;

    // The one and only call into the existing collection system (spec section 32) -
    // everything from here (pull-toward-player animation, the real inventoryManager.
    // addItem(), Bag/mass/mutation sync, the radar blip disappearing once the resource
    // leaves resourceManager.resources) is the pre-existing, untouched absorb pipeline.
    const started = this.resourceManager.beginAcquire(resource);
    if (!started) return false;

    this.state = RESOURCE_INTERACTION_STATE.ACQUIRING;
    this._closePanel();
    this.clearTarget();
    return true;
  }

  /** Close button / backdrop tap: dismiss the panel, keep the resource in the world,
   *  inventory untouched, gameplay resumes (spec section 43). */
  cancelInspection() {
    this._closePanel();
    if (this.currentTarget) this.state = RESOURCE_INTERACTION_STATE.NEARBY;
  }

  _closePanel() {
    this.panel.classList.remove('resource-inspect-panel--visible');
    this.backdrop.classList.remove('resource-inspect-backdrop--visible');
    this.gameFlowController.closeResourceInspect();
  }

  // --- External safety hooks (death, reset, Bag opening) ---------------------------

  /** Bag opening (spec section 54), and death (spec section 52) - both need Inspect to
   *  disappear immediately without collecting anything, keeping the target as-is
   *  otherwise so a plain Bag-open-then-close doesn't lose the player's current focus. */
  forceClose() {
    this._closePanel();
    this._touchResource = null;
    this._touchPointerId = null;
    this.clearTarget();
  }

  /** Play Again (spec section 53): the same as forceClose(), plus the session-only
   *  "first discovery" tracking starts over for the new run. */
  reset() {
    this.forceClose();
    this._inspectedTypes.clear();
  }
}
