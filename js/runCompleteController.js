import { formatRunTime } from './runStats.js?v=5.3';

/**
 * The final results screen (spec sections 21-26). Thin by design - all it does is
 * format the run-time field and hand a ready-to-render stats object + a Play Again
 * callback to UIManager, which owns the actual DOM. Double-tap protection lives in
 * UIManager's own button wiring (disables the button the instant it's pressed), so
 * this class never needs to track a "have we already fired" flag itself.
 */
export class RunCompleteController {
  constructor(uiManager, { onPlayAgain } = {}) {
    this.uiManager = uiManager;
    this.onPlayAgain = onPlayAgain;
  }

  show(runStats) {
    const runTimeSeconds = runStats.runStartTime > 0 ? (performance.now() - runStats.runStartTime) / 1000 : 0;
    this.uiManager.showRunComplete(
      { ...runStats, runTimeFormatted: formatRunTime(runTimeSeconds) },
      () => this.onPlayAgain?.()
    );
  }

  hide() {
    this.uiManager.hideRunComplete();
  }
}
