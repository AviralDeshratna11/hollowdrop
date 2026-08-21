import * as THREE from 'three';

export const OBJECTIVE_INDICATOR_CONFIG = {
  edgeMargin: 44, // px inset from the true screen edge the indicator clamps to
};

const tempScreenVec = new THREE.Vector3();

/**
 * A single reusable screen-edge arrow (spec sections 45-48, 78-79) pointing at
 * whichever objective currently matters most: the Fragment's carrier's escape
 * target while the Player carries it, the Rival itself while IT carries it, or the
 * Fragment's own position while it's just sitting exposed/dropped. Hidden entirely
 * once there's nothing to point at, or once the target is already close/on-screen.
 * Reuses the standard world->NDC->screen projection technique already used by
 * InventoryInteractionController, just generalized for an always-on-screen indicator
 * rather than a one-shot UI placement.
 */
export class ObjectiveIndicatorController {
  constructor(camera, canvas, uiManager, fragmentContestManager, genomeFragmentController) {
    this.camera = camera;
    this.canvas = canvas;
    this.uiManager = uiManager;
    this.fragmentContestManager = fragmentContestManager;
    this.genomeFragmentController = genomeFragmentController;
  }

  update() {
    if (!this.genomeFragmentController.isActive()) {
      this.uiManager.hideObjectiveIndicator();
      return;
    }

    const target = this.fragmentContestManager.getObjectiveTarget();
    if (!target) {
      this.uiManager.hideObjectiveIndicator();
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    tempScreenVec.copy(target).project(this.camera);
    const behind = tempScreenVec.z > 1; // extremely unlikely with this game's near-top-down camera, handled defensively
    let dx = tempScreenVec.x * (rect.width / 2);
    let dy = -tempScreenVec.y * (rect.height / 2);
    if (behind) {
      dx = -dx;
      dy = -dy;
    }

    const angle = Math.atan2(dx, -dy); // 0 = up, clockwise - matches an up-pointing arrow rotated via CSS

    const margin = OBJECTIVE_INDICATOR_CONFIG.edgeMargin;
    const halfW = rect.width / 2 - margin;
    const halfH = rect.height / 2 - margin;
    const alreadyVisible = !behind && Math.abs(dx) < halfW && Math.abs(dy) < halfH;

    if (alreadyVisible) {
      this.uiManager.hideObjectiveIndicator();
      return;
    }

    const scale = Math.min(halfW / Math.max(Math.abs(dx), 1e-6), halfH / Math.max(Math.abs(dy), 1e-6), 1);
    this.uiManager.showObjectiveIndicator(cx + dx * scale, cy + dy * scale, angle);
  }
}
