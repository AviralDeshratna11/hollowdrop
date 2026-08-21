import * as THREE from 'three';
import { DEBUG_HEALTH } from './playerHealth.js';

export const GAME_STATE = {
  PLAYING: 'playing',
  DYING: 'dying',
  RESPAWNING: 'respawning',
};

export const DEATH_CONFIG = {
  deathDuration: 1.2, // matches PlayerController's death collapse animation length
  fadeDuration: 0.3,
  dropRatio: 0.6, // fraction of inventory entries that become world resources again
  scatterMinRadius: 1.2,
  scatterMaxRadius: 3.5, // combined with launch-physics travel, keeps recovery within ~2-5 units
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
    this.onRespawnCamera = onRespawnCamera;
    this.onPlayerDeath = onPlayerDeath; // optional - fires once per _beginDeath(), e.g. for run-stats tracking

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

    let dropped = 0;
    items.forEach((item, index) => {
      if (dropIndices.has(index)) {
        const angle = Math.random() * Math.PI * 2;
        const radius = DEATH_CONFIG.scatterMinRadius + Math.random() * (DEATH_CONFIG.scatterMaxRadius - DEATH_CONFIG.scatterMinRadius);
        tempScatterDir.set(Math.cos(angle), 0, Math.sin(angle));
        tempScatterPos.set(
          this.lastDeathPosition.x + tempScatterDir.x * 0.4,
          0.45,
          this.lastDeathPosition.z + tempScatterDir.z * 0.4
        );
        // Reuses the exact same system swipe-to-expel uses: same resource types,
        // same world models, same recollection cooldown, same absorption on pickup.
        this.resourceManager.spawnDroppedResource(item.type, tempScatterPos, tempScatterDir);
        dropped++;
      }
      this.inventoryManager.removeItem(item.id);
    });

    this.uiManager.updateMassUI(this.inventoryManager.getInventoryWeight(), this.inventoryManager.maxWeight);
    if (DEBUG_HEALTH) console.log(`Dropped ${dropped} resources`);
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
        this._respawn();
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

  _respawn() {
    this.player.position.copy(this.respawnPosition);
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
