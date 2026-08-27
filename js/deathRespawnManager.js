import * as THREE from 'three';
import { DEBUG_HEALTH } from './playerHealth.js';

export const GAME_STATE = {
  PLAYING: 'playing',
  DYING: 'dying',
  RESPAWNING: 'respawning',
};

// Single-scene prototype - one identifier for now, but stamped on every death record so a
// future multi-biome radar can distinguish where a death actually happened.
export const WORLD_ID = 'living-colony';

export const DEATH_CONFIG = {
  deathDuration: 1.2, // matches PlayerController's death collapse animation length
  fadeDuration: 0.3,
  // Minecraft-style FULL drop: every held item is dropped at the death spot (no ratio -
  // nothing is kept). Offsets are kept tight because launch-physics travel (see
  // ResourceManager.spawnDroppedResource) adds its own natural scatter on top.
  scatterMinRadius: 0.3,
  scatterMaxRadius: 1.2,
  dropSpawnHeight: 0.45, // slightly above ground; launch physics settles it to groundRestHeight
  dropPlacementAttempts: 6, // tries per item to find a spot clear of static geometry, then falls back to the death spot
  dropClearance: 0.25, // collider clearance a drop point needs (small - items are tiny pickups)
  respawnInvulnerability: 1.5,
};

const tempScatterDir = new THREE.Vector3();
const tempScatterPos = new THREE.Vector3();

/**
 * Orchestrates the narrative sequence around death: dropping inventory back into
 * the world (reusing ResourceManager's existing expelled-resource system - not a
 * separate drop mechanism), the collapse animation, a short screen fade, and
 * respawn. PlayerHealth only tracks health/invulnerability and fires onDeath once;
 * everything about "what happens next" lives here so the two stay decoupled.
 */
export class DeathRespawnManager {
  constructor({
    player,
    playerController,
    playerHealth,
    metabolismSystem,
    mutationSystem,
    playerFormController,
    inventoryManager,
    resourceManager,
    inputController,
    inventoryInteraction,
    predatorController,
    genomeFragmentController,
    uiManager,
    respawnPosition,
    pickRespawnPosition,
    isPositionClear,
    onRespawnCamera,
    onPlayerDeath,
  }) {
    this.player = player;
    this.playerController = playerController;
    this.playerHealth = playerHealth;
    this.metabolismSystem = metabolismSystem;
    this.mutationSystem = mutationSystem;
    this.playerFormController = playerFormController;
    this.inventoryManager = inventoryManager;
    this.resourceManager = resourceManager;
    this.inputController = inputController;
    this.inventoryInteraction = inventoryInteraction;
    this.predatorController = predatorController;
    this.genomeFragmentController = genomeFragmentController;
    this.uiManager = uiManager;
    this.respawnPosition = respawnPosition.clone();
    // Death respawns pick a random valid spot via this (injected from main.js, which owns
    // world/collision knowledge); a new-run reset still uses the canonical respawnPosition.
    this.pickRespawnPosition = pickRespawnPosition ?? null;
    // Optional (x, z, radius) -> bool query into the collision system, used to keep dropped
    // items out of solid geometry. Null-safe: without it, drops just skip the clear check.
    this.isPositionClear = isPositionClear ?? null;
    this.onRespawnCamera = onRespawnCamera;
    this.onPlayerDeath = onPlayerDeath; // optional - fires once per _beginDeath(), e.g. for run-stats tracking
    // Optional post-construction hook (main.js) - fires once the inventory has been emptied
    // by a death drop, so an open inventory panel can refresh from a clean state.
    this.onInventoryDropped = null;

    // Most recent death location, saved for a future radar/navigation system (see
    // getLastDeathLocation()). Null until the first death.
    this.lastDeathLocation = null;
    this._deathEventCounter = 0;

    this.gameState = GAME_STATE.PLAYING;
    this.lastDeathPosition = new THREE.Vector3();

    this._phase = null; // 'deathAnim' | 'fadeOut' | 'fadeIn'
    this._timer = 0;

    this.playerHealth.onDeath = () => this._beginDeath();
  }

  get isPlaying() {
    return this.gameState === GAME_STATE.PLAYING;
  }

  _beginDeath() {
    if (this.gameState !== GAME_STATE.PLAYING) return; // never re-enter mid-sequence
    this.gameState = GAME_STATE.DYING;

    this.inputController.cancel();
    this.inventoryInteraction.cancelActiveGesture();
    this.playerFormController.cancelMutation(); // safe even mid-fusion - ingredients aren't removed until fusion completes

    this.lastDeathPosition.copy(this.player.position);
    this._recordDeathLocation(); // saved before the drop so a future radar can point at the exact death spot
    this._abortInFlightAbsorptions();
    this._dropInventoryOnDeath();
    // A carried Human Genome Fragment falls at the death spot rather than following
    // the Player home - no-op unless the Player was actually carrying it.
    this.genomeFragmentController.dropFromPlayer();
    this.mutationSystem.onInventoryChanged(); // ingredients likely gone now - recheck, don't leave a stale "ready" state

    this.playerController.beginDeath(DEATH_CONFIG.deathDuration);
    this.uiManager.showDissolved();

    this._phase = 'deathAnim';
    this._timer = 0;

    this.onPlayerDeath?.();
    if (DEBUG_HEALTH) console.log('Dying');
  }

  /** A resource mid-absorption when death starts would otherwise keep animating
   *  toward the (soon-to-move) player and complete into an inventory that's about
   *  to be wiped anyway - reset it back to a normal idle world resource instead. */
  _abortInFlightAbsorptions() {
    for (const resource of this.resourceManager.resources) {
      if (resource.state === 'absorbing') {
        resource.state = 'idle';
        resource.mesh.scale.setScalar(resource.baseScale);
      }
    }
  }

  /**
   * Minecraft-style full drop: EVERY held item becomes a world resource at the death
   * spot, then the inventory is emptied. Each item is snapshotted, spawned, and removed
   * exactly once; _beginDeath() cannot re-enter (it guards on gameState) and
   * PlayerHealth._die() only fires once, so repeated/rapid deaths can never drop or
   * remove the same item twice. An empty inventory is handled safely (the loop simply
   * does nothing). Reuses the exact expelled-resource path the wheel/expel already use -
   * same models, physics, recollection cooldown, and absorption-on-pickup.
   */
  _dropInventoryOnDeath() {
    const items = [...this.inventoryManager.items]; // snapshot: removeItem() mutates the live array

    for (const item of items) {
      const spawnPos = this._resolveDropPosition();
      const dir = this._randomGroundDirection();
      this.resourceManager.spawnDroppedResource(item.type, spawnPos, dir);
      this.inventoryManager.removeItem(item.id); // removed once, right after its own drop is spawned
    }

    this.uiManager.updateMassUI(this.inventoryManager.getInventoryWeight(), this.inventoryManager.maxWeight);
    this.onInventoryDropped?.(); // let an open inventory panel refresh from the now-empty state
    if (DEBUG_HEALTH) console.log(`Dropped ${items.length} item(s) at death location`);
  }

  /** A drop point near the death spot, nudged off-centre and validated clear of static
   *  geometry so items never bury themselves in a rock. Falls back to the death spot
   *  itself, which is always clear (the player is collision-resolved out of geometry
   *  every frame). Returns a reused scratch vector - spawnDroppedResource reads it
   *  immediately, so reuse across items is safe. */
  _resolveDropPosition() {
    const center = this.lastDeathPosition;
    for (let attempt = 0; attempt < DEATH_CONFIG.dropPlacementAttempts; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = DEATH_CONFIG.scatterMinRadius + Math.random() * (DEATH_CONFIG.scatterMaxRadius - DEATH_CONFIG.scatterMinRadius);
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;
      if (!this.isPositionClear || this.isPositionClear(x, z, DEATH_CONFIG.dropClearance)) {
        return tempScatterPos.set(x, DEATH_CONFIG.dropSpawnHeight, z);
      }
    }
    return tempScatterPos.set(center.x, DEATH_CONFIG.dropSpawnHeight, center.z);
  }

  /** A random unit direction in the ground plane, for the drop's launch scatter. Reused
   *  scratch vector - spawnDroppedResource reads it immediately. */
  _randomGroundDirection() {
    const angle = Math.random() * Math.PI * 2;
    return tempScatterDir.set(Math.cos(angle), 0, Math.sin(angle));
  }

  /**
   * Saves the player's exact death location for a future radar/navigation system.
   * Structured so radar markers, compass headings, distance calcs, and waypoints can
   * read it directly (see getLastDeathLocation()); worldId is a single-scene constant
   * for now but leaves room for multiple biomes later.
   */
  _recordDeathLocation() {
    const p = this.lastDeathPosition;
    this.lastDeathLocation = {
      x: p.x,
      y: p.y,
      z: p.z,
      worldId: WORLD_ID,
      timestamp: Date.now(),
      id: `death-${++this._deathEventCounter}`,
    };
    if (DEBUG_HEALTH) console.log(`Death location saved: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
  }

  /** The most recent death location ({ x, y, z, worldId, timestamp, id }), or null if the
   *  player has not died yet. The clean read point for a future radar/compass/waypoint
   *  system - nothing else needs to know how or when it was recorded. */
  getLastDeathLocation() {
    return this.lastDeathLocation;
  }

  update(deltaTime) {
    if (this.gameState === GAME_STATE.PLAYING) return;

    this._timer += deltaTime;

    if (this._phase === 'deathAnim') {
      if (this.playerController.isDeathAnimationComplete()) {
        this._phase = 'fadeOut';
        this._timer = 0;
        this.uiManager.setScreenFade(0);
      }
      return;
    }

    if (this._phase === 'fadeOut') {
      const t = Math.min(this._timer / DEATH_CONFIG.fadeDuration, 1);
      this.uiManager.setScreenFade(t);
      if (t >= 1) {
        this.gameState = GAME_STATE.RESPAWNING;
        this._respawn(true); // death respawn goes to a random valid location
        this._phase = 'fadeIn';
        this._timer = 0;
      }
      return;
    }

    if (this._phase === 'fadeIn') {
      const t = Math.min(this._timer / DEATH_CONFIG.fadeDuration, 1);
      this.uiManager.setScreenFade(1 - t);
      if (t >= 1) {
        this.uiManager.setScreenFade(0);
        this._phase = null;
        this.gameState = GAME_STATE.PLAYING;
        if (DEBUG_HEALTH) console.log('Respawn complete');
      }
    }
  }

  _respawn(useRandomLocation = false) {
    this.player.position.copy(useRandomLocation ? this._resolveRespawnPosition() : this.respawnPosition);
    this.playerController.resetToBaseSlime();
    this.playerFormController.forceResetToSlime(); // GDD: death always returns the player as slime, never Rat
    this.playerHealth.reset();
    this.playerHealth.grantInvulnerability(DEATH_CONFIG.respawnInvulnerability);
    this.metabolismSystem.reset(); // never respawn hungry

    // Predator shouldn't already be camping the fresh spawn point.
    this.predatorController.disengage();

    this.onRespawnCamera?.();

    if (DEBUG_HEALTH) console.log('Respawning');
  }

  /** Resolves a random valid death-respawn spot via the injected picker (main.js owns the
   *  world/collision knowledge). Always returns something usable - the picker itself is
   *  bounded and falls back to a known-good spot, and this guards the un-injected case
   *  too, so a respawn can never hang or land nowhere. */
  _resolveRespawnPosition() {
    if (this.pickRespawnPosition) {
      const pos = this.pickRespawnPosition(this.lastDeathLocation);
      if (pos) return pos;
    }
    return this.respawnPosition;
  }

  /** Skips straight to a fresh respawn, bypassing the death animation/fade - used both
   *  by the DEBUG_HEALTH 'r' key and, via resetForNewRun() below, by GameFlowController's
   *  Play Again pipeline (safe to call regardless of current gameState). */
  forceRespawn() {
    this.gameState = GAME_STATE.PLAYING;
    this._phase = null;
    this.uiManager.setScreenFade(0);
    this._respawn();
  }

  /** Player-reset step of the Play Again pipeline (spec section 30) - same restore as
   *  forceRespawn(), exposed under its own name so callers aren't misled into thinking
   *  this is a debug-only affordance. */
  resetForNewRun() {
    this.forceRespawn();
  }
}
