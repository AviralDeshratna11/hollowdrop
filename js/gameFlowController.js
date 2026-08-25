import { resetRunStats } from './runStats.js';

export const GAME_STATES = {
  TITLE: 'title',
  PLAYING: 'playing',
  MEMORY: 'memory',
  // A transformation reveal. Separate from MEMORY rather than reusing it so the two can
  // never fight over the same state: MEMORY belongs to the run's ending and hands off to
  // RUN_COMPLETE, whereas a REVEAL always returns to PLAYING.
  REVEAL: 'reveal',
  RUN_COMPLETE: 'run_complete',
  RESETTING: 'resetting',
};

export const GAME_FLOW_CONFIG = {
  // Beat between the ending actually starting (gameplay freezes THIS frame) and the
  // Memory overlay appearing - the existing Fragment-secure animation (~1s shrink/
  // rise/brighten + toast + screen flash, see genomeFragmentController.js/uiManager.js)
  // already plays out during this window, so it doubles as the "give the accomplishment
  // a beat before cutting to the ending" pause spec sections 6-7 ask for.
  memoryTransitionDelay: 0.6,
  resetFadeDuration: 0.35, // each half of the Play Again fade-to-black-and-back (spec section 59)
};

/**
 * Owns the game's top-level flow (spec section 64) - which of TITLE/PLAYING/MEMORY/
 * RUN_COMPLETE/RESETTING the game is in, and the transitions between them. Contains
 * no gameplay logic of its own: every actual reset step lives in main.js's resetGame()
 * (injected here as `resetGame`), since that function needs direct access to every
 * system this file has no business knowing about. This class only decides WHEN those
 * things happen, mirroring how ApexEncounterManager only decides when to call
 * ApexController.startEncounter() rather than owning the encounter itself.
 */
export class GameFlowController {
  constructor({ uiManager, memorySequenceController, runCompleteController, runStats, resetGame }) {
    this.uiManager = uiManager;
    this.memorySequenceController = memorySequenceController;
    this.runCompleteController = runCompleteController;
    this.runStats = runStats;
    this._resetGame = resetGame;

    this.state = GAME_STATES.TITLE;
    this._runEndingStarted = false;
    this._hasShownOpening = false;
    this._memoryDelayTimer = null;
    this._resetPhase = null; // 'fadeOut' | 'fadeIn' | null
    this._resetTimer = 0;

    this.uiManager.showTitleScreen(() => this._beginFirstRun());
  }

  _beginFirstRun() {
    if (this.state !== GAME_STATES.TITLE) return;
    this.uiManager.hideTitleScreen();
    this.state = GAME_STATES.PLAYING;
    resetRunStats(this.runStats);
    this.runStats.runStartTime = performance.now();
    this.onFirstRunBegun?.();
  }

  /** The ONE authoritative entry point for the ending - wire this to
   *  genomeFragmentController.onSecured. No-ops after the first call (spec section 4:
   *  "the secure event must trigger the ending exactly once"). */
  onGenomeFragmentSecured() {
    if (this._runEndingStarted) return;
    this._runEndingStarted = true;
    this.runStats.genomeFragmentsSecured += 1;
    this.state = GAME_STATES.MEMORY; // freezes gameplay THIS frame - see main.js's isPlayingState gate
    this._memoryDelayTimer = GAME_FLOW_CONFIG.memoryTransitionDelay;
  }

  _showResults() {
    this.state = GAME_STATES.RUN_COMPLETE;
    this.runCompleteController.show(this.runStats);
  }

  /** Wired to the Run Complete screen's Play Again button. */
  restartRun() {
    if (this.state === GAME_STATES.RESETTING) return; // one restart in flight at a time
    this.state = GAME_STATES.RESETTING;
    this._resetPhase = 'fadeOut';
    this._resetTimer = 0;
    this.runCompleteController.hide();
  }

  update(deltaTime) {
    if (this.state === GAME_STATES.MEMORY && this._memoryDelayTimer !== null) {
      this._memoryDelayTimer -= deltaTime;
      if (this._memoryDelayTimer <= 0) {
        this._memoryDelayTimer = null;
        this.memorySequenceController.start();
      }
      return;
    }

    if (this.state === GAME_STATES.RESETTING) this._updateReset(deltaTime);
  }

  /** Play Again's fade-to-black -> reset -> fade-in sequence (spec section 59), driven
   *  per-frame the same way DeathRespawnManager's own death/respawn fade already is -
   *  not a CSS transition, so its timing stays exactly in sync with the reset itself. */
  _updateReset(deltaTime) {
    this._resetTimer += deltaTime;
    const duration = GAME_FLOW_CONFIG.resetFadeDuration;

    if (this._resetPhase === 'fadeOut') {
      this.uiManager.setScreenFade(Math.min(this._resetTimer / duration, 1));
      if (this._resetTimer >= duration) {
        this._resetGame();
        this._runEndingStarted = false;
    this._hasShownOpening = false;
        resetRunStats(this.runStats);
        this.runStats.runStartTime = performance.now();
        this._resetPhase = 'fadeIn';
        this._resetTimer = 0;
      }
      return;
    }

    if (this._resetPhase === 'fadeIn') {
      this.uiManager.setScreenFade(Math.max(1 - this._resetTimer / duration, 0));
      if (this._resetTimer >= duration) {
        this.uiManager.setScreenFade(0);
        this._resetPhase = null;
        this.state = GAME_STATES.PLAYING;
      }
    }
  }

  /** Wired from MemorySequenceController's onFinished. */
  handleMemoryFinished() {
    this._showResults();
  }

  /**
   * Pauses play and shows a card describing a form the player just became.
   *
   * Refuses while the run is ending. Securing the Fragment can land in the same breath as
   * a mutation completing, and the ending must win - a reveal that interrupted it would
   * strand the player in REVEAL with no path back to the results screen.
   */
  showReveal(card) {
    if (this._runEndingStarted) return false;
    if (this.state !== GAME_STATES.PLAYING) return false;

    this.state = GAME_STATES.REVEAL; // freezes gameplay THIS frame, same gate as MEMORY
    this.uiManager.showInfoCard(card, () => {
      this.uiManager.hideInfoCard();
      // Only resume if nothing else claimed the state while the card was up.
      if (this.state === GAME_STATES.REVEAL) this.state = GAME_STATES.PLAYING;
    });
    return true;
  }

  /** The opening objective card. Shown once per session, not once per run - a player
   *  hitting Play Again does not need to be told the goal again. */
  showOpeningObjective(card) {
    if (this._hasShownOpening) return;
    this._hasShownOpening = true;
    this.state = GAME_STATES.REVEAL;
    this.uiManager.showInfoCard(card, () => {
      this.uiManager.hideInfoCard();
      if (this.state === GAME_STATES.REVEAL) this.state = GAME_STATES.PLAYING;
    });
  }
}
