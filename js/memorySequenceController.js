export const MEMORY_CONFIG = {
  cameraZoomRampDuration: 1.0, // seconds to ease into the subtle camera zoom
  cameraZoomAmount: 0.3, // fraction the camera offset shrinks by, at full zoom - kept
  // subtle per spec section 10 ("do NOT create a long cinematic camera sequence")
  continuePromptDelay: 2.0, // seconds before "TAP TO CONTINUE" can appear (spec section 18)
};

// PLACEHOLDER NARRATIVE (spec section 2/15) - the game design establishes that Genome
// Fragments recover pieces of the protagonist's human memories, but the exact content
// of the FIRST memory has not been defined yet. Do not invent permanent canon here -
// only `title`/`text` need to change once the real narrative content exists; nothing
// else in this file depends on their content.
export const MEMORY_01 = {
  id: 'memory_01',
  title: 'Fragmented Memory',
  text: 'A shape.\nA voice.\nA place that feels familiar.\n\nSomething beyond the colony\nis waiting to be remembered.',
  fragmentIndex: 1,
};

// Optional, currently silent - hooks so audio can be added later without touching this logic.
function playMemoryRevealSound() {}

/**
 * The short (~5-8s) beat between "Fragment Secured" and the Run Complete screen (spec
 * sections 6-19). Deliberately thin: the actual reveal choreography (fade darker, warm
 * pulse, silhouette, staggered text) is pure CSS animation triggered by a single class
 * toggle (see uiManager.showMemory() / style.css) - this class only owns the parts CSS
 * can't: when the sequence starts/ends, the skip-button timer, and the subtle camera
 * zoom ramp (read by main.js's updateCamera()).
 */
export class MemorySequenceController {
  constructor(uiManager, { onFinished } = {}) {
    this.uiManager = uiManager;
    this.onFinished = onFinished;
    this.active = false;
    this._timer = 0;
    this._zoomT = 0; // 0 (just started) .. 1 (ramp complete) - see getCameraZoom()
  }

  start(memory = MEMORY_01) {
    if (this.active) return;
    this.active = true;
    this._timer = 0;
    this._zoomT = 0;
    this.uiManager.showMemory(memory, () => this.continue());
    playMemoryRevealSound();
  }

  /** Read every frame by main.js's updateCamera() - 0 outside an active sequence, so
   *  the normal follow-camera is completely unaffected the rest of the time. */
  getCameraZoom() {
    return this.active ? this._zoomT * MEMORY_CONFIG.cameraZoomAmount : 0;
  }

  update(deltaTime) {
    if (!this.active) return;
    this._timer += deltaTime;
    this._zoomT = Math.min(this._timer / MEMORY_CONFIG.cameraZoomRampDuration, 1);
    if (this._timer >= MEMORY_CONFIG.continuePromptDelay) this.uiManager.showMemoryContinuePrompt();
  }

  /** Player tapped Continue (spec section 18/70) - transitions exactly once even if
   *  tapped again before the overlay finishes hiding. */
  continue() {
    if (!this.active) return;
    this.active = false;
    this.uiManager.hideMemory();
    this.onFinished?.();
  }

  /** Full reset for a brand-new run (Play Again) - defensive only; a completed
   *  sequence already leaves `active` false via continue() above. */
  reset() {
    this.active = false;
    this._timer = 0;
    this._zoomT = 0;
    this.uiManager.hideMemory();
  }
}
