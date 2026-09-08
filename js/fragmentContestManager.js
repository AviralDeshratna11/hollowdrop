import * as THREE from 'three';
import { FRAGMENT_STATES } from './genomeFragmentController.js?v=5.3';

export const DEBUG_FRAGMENT_CONTEST = false;

export const FRAGMENT_CONTEST_CONFIG = {
  contestResetDelay: 1.5, // forgiving reset, never a permanent failure
};

/**
 * Orchestrates the Human Genome Fragment ownership contest between Player and Rival,
 * and handles the contest reset delay if the Rival manages to escape before being defeated.
 * The old extraction zone / pedestal portal has been retired in favor of the Biome Portal.
 */
export class FragmentContestManager {
  constructor({ scene, playerController, genomeFragmentController, rivalController, uiManager, resetSpawnPosition, portalController = null }) {
    this.scene = scene;
    this.playerController = playerController;
    this.genomeFragmentController = genomeFragmentController;
    this.rivalController = rivalController;
    this.uiManager = uiManager;
    this.resetSpawnPosition = resetSpawnPosition.clone();
    this.portalController = portalController;

    this._resetTimer = null;

    // Connect to RivalController for escape resolution
    rivalController.fragmentContestManager = this;
  }

  realignToTerrain() {
    // No-op: old extraction pedestal visual removed
  }

  update(deltaTime) {
    this._updateResetTimer(deltaTime);
  }

  /**
   * Called by RivalController once its escape channel finishes -
   * short delay before the Fragment is re-exposed and the contest resumes.
   */
  onRivalEscapeSuccess() {
    this.uiManager.showFragmentLost();
    this._resetTimer = FRAGMENT_CONTEST_CONFIG.contestResetDelay;
  }

  _updateResetTimer(deltaTime) {
    if (this._resetTimer === null) return;
    this._resetTimer -= deltaTime;
    if (this._resetTimer <= 0) {
      this._resetTimer = null;
      this.genomeFragmentController.spawn(this.resetSpawnPosition.clone());
      this.rivalController.notifyFragmentExposed();
    }
  }

  /** Full reset for a brand-new run (Play Again). */
  reset() {
    this._resetTimer = null;
  }

  /**
   * What the objective indicator should currently point at:
   * - If Fragment is dropped or exposed -> Fragment location
   * - If Rival carries Fragment -> Rival
   * - If Player carries Fragment:
   *     - If Rival is alive -> Rival (contest enemy)
   *     - If Rival is defeated -> Biome Portal!
   */
  getObjectiveTarget() {
    const fragment = this.genomeFragmentController.fragment;
    if (!fragment) return null;

    if (fragment.state === FRAGMENT_STATES.CARRIED_BY_RIVAL) {
      return this.rivalController.mesh.position;
    }

    if (fragment.state === FRAGMENT_STATES.CARRIED_BY_PLAYER) {
      if (this.rivalController?.isAlive?.()) {
        return this.rivalController.mesh.position;
      }
      return this.portalController?.mesh.position ?? null;
    }

    return fragment.mesh.position; // EXPOSED or DROPPED
  }
}
