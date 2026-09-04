import * as THREE from 'three';
import { DEBUG_HEALTH } from './playerHealth.js?v=5.3';
import { getTerrainHeight } from './terrain.js?v=5.4';

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
  dropRatio: 0.6, // fraction of inventory entries that become world resources again
  scatterMinRadius: 1.2,
  scatterMaxRadius: 3.5, // combined with launch-physics travel, keeps recovery within ~2-5 units
  respawnInvulnerability: 1.5,
  // How close the player must get to the death-drop spot for the radar cargo beacon to
  // retire (it has served its "navigate back here" purpose). Only arms once the player has
  // first moved OUTSIDE it - which the random respawn's distance-from-death guarantees - so
  // the death spot the player is standing on at the moment of death never counts as reached.
  deathDropReachRadius: 2.5,
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
    // world/collision knowledge); a new-run reset / debug forceRespawn still uses the fixed
    // respawnPosition above. Null-safe: without it, every respawn falls back to that spot.
    this.pickRespawnPosition = pickRespawnPosition ?? null;
    this.onRespawnCamera = onRespawnCamera;
    this.onPlayerDeath = onPlayerDeath; // optional - fires once per _beginDeath(), e.g. for run-stats tracking
    // Optional post-construction hook (main.js) - fires once the inventory has been emptied
    // by a death drop, so an open inventory panel can refresh from a clean state.
    this.onInventoryDropped = null;

    // Most recent death location ({ x, y, z, worldId, timestamp, id }), saved for the radar
    // navigation marker and the random-respawn picker. Null until the first death.
    this.lastDeathLocation = null;
    this._deathEventCounter = 0;
    // The single tracked death drop the radar points at ({ position, resources, isActive,
    // hasLeft, id }). One slot, overwritten each death so a later death replaces the marker
    // rather than stacking stale ones. Null until the first non-empty drop.
    this.deathDrop = null;

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
    this._recordDeathLocation(); // saved before the drop so the radar/respawn can read the exact death spot
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

  _dropInventoryOnDeath() {
    const items = [...this.inventoryManager.items];
    const dropCount = Math.round(items.length * DEATH_CONFIG.dropRatio);
    const shuffledIndices = items.map((_, i) => i).sort(() => Math.random() - 0.5);
    const dropIndices = new Set(shuffledIndices.slice(0, dropCount));

    const droppedResources = [];
    items.forEach((item, index) => {
      if (dropIndices.has(index)) {
        const angle = Math.random() * Math.PI * 2;
        const radius = DEATH_CONFIG.scatterMinRadius + Math.random() * (DEATH_CONFIG.scatterMaxRadius - DEATH_CONFIG.scatterMinRadius);
        tempScatterDir.set(Math.cos(angle), 0, Math.sin(angle));
        const dropX = this.lastDeathPosition.x + tempScatterDir.x * 0.4;
        const dropZ = this.lastDeathPosition.z + tempScatterDir.z * 0.4;
        const dropY = getTerrainHeight(dropX, dropZ) + 0.25;
        tempScatterPos.set(dropX, dropY, dropZ);
        // Reuses the exact same system swipe-to-expel uses: same resource types,
        // same world models, same recollection cooldown, same absorption on pickup.
        // Keep the spawned world-resource reference so the radar can tell when this drop
        // has been fully recovered - no re-scanning the world for it later.
        droppedResources.push(this.resourceManager.spawnDroppedResource(item.type, tempScatterPos, tempScatterDir));
      }
      this.inventoryManager.removeItem(item.id);
    });
    this._recordDeathDrop(droppedResources);

    this.uiManager.updateMassUI(this.inventoryManager.getInventoryWeight(), this.inventoryManager.maxWeight);
    this.onInventoryDropped?.(); // let an open inventory panel refresh from the now-empty state
    if (DEBUG_HEALTH) console.log(`Dropped ${droppedResources.length} resources`);
  }

  /** Saves the player's exact death location for the radar/navigation system and the
   *  random-respawn picker (which reads it to stay clear of the drop). worldId is a
   *  single-scene constant for now but leaves room for multiple biomes later. */
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
   *  player has not died yet. Clean read point for the radar/compass/waypoint system. */
  getLastDeathLocation() {
    return this.lastDeathLocation;
  }

  /**
   * Records the just-spawned death drop as the single tracked marker source. Position is
   * the stored death spot (items scatter only tightly around it, so the death spot is the
   * accurate representative centre - no per-item averaging needed). An empty drop (empty
   * inventory, or dropRatio rounding to zero) clears the slot rather than tracking a
   * phantom marker. Overwrites any previous drop, so a repeat death replaces the marker.
   */
  _recordDeathDrop(resources) {
    if (!resources || resources.length === 0) {
      this.deathDrop = null;
      return;
    }
    const p = this.lastDeathPosition;
    this.deathDrop = {
      position: { x: p.x, y: p.y, z: p.z },
      resources: [...resources],
      isActive: true,
      // Arms the "player reached the drop" retirement below - false until the player has
      // been seen outside deathDropReachRadius (guaranteed once they respawn away).
      hasLeft: false,
      id: this.lastDeathLocation?.id ?? `death-${this._deathEventCounter}`,
    };
  }

  /**
   * The active death drop ({ position, isActive, ... }) for the radar to point at, or null
   * if there is none / it has been fully recovered / the player has walked back onto it.
   * Cheap: prunes only its own handful of dropped-resource refs (a resource whose mesh has
   * left the scene has been absorbed or cleared), never scanning the whole world; goes
   * inactive once none remain, so a recovered drop stops doing even that work.
   */
  getActiveDeathDrop() {
    const drop = this.deathDrop;
    if (!drop || !drop.isActive) return null;

    // mesh.parent goes null the moment ResourceManager.removeResource() detaches it
    // (collected/absorbed or cleared on Play Again) - an O(1) "still in the world" test.
    const remaining = drop.resources.filter((r) => r.mesh.parent !== null);
    if (remaining.length !== drop.resources.length) drop.resources = remaining;
    if (remaining.length === 0) {
      drop.isActive = false;
      return null;
    }

    // Retire the beacon once the player, having respawned away, walks back onto the drop.
    // Self-arming: `hasLeft` only flips true after the player is first outside the radius,
    // so the death spot the player dies on never counts as already-reached.
    const reachSq = DEATH_CONFIG.deathDropReachRadius * DEATH_CONFIG.deathDropReachRadius;
    const dx = this.player.position.x - drop.position.x;
    const dz = this.player.position.z - drop.position.z;
    const distSq = dx * dx + dz * dz;
    if (!drop.hasLeft) {
      if (distSq > reachSq) drop.hasLeft = true;
    } else if (distSq <= reachSq) {
      drop.isActive = false;
      return null;
    }

    return drop;
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
        this._respawn(true); // death respawn goes to a random valid location away from the drop
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
   *  world/collision knowledge). Always returns something usable - the picker is bounded and
   *  falls back to a known-good spot, and this guards the un-injected case too, so a respawn
   *  can never hang or land nowhere. */
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