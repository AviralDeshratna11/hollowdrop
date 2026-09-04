import { RESOURCE_TYPES } from './resourceTypes.js?v=5.3';
import { PLAYER_FORMS } from './playerFormController.js?v=5.3';
import { RADAR_TARGET_TYPES } from './radarController.js?v=5.3';

export const DEBUG_TUTORIAL = false;

// Bumping this key retires every player's saved progress and shows the tutorial again -
// do that if the steps below change enough that a returning player would be lost.
const STORAGE_KEY = 'hollowdrop.tutorial.v1';

export const TUTORIAL_CONFIG = {
  // How far the player must actually travel before "drag to move" counts as learned.
  moveDistanceToLearn: 3,
  // Absorbs before the bag is worth explaining - one is a fluke, three is a habit.
  absorbsBeforeBag: 3,
  // Only the first beat offers Skip (decision D2): by the time a player has seen one
  // banner they know what these are, and a Skip on every one of them reads as nagging.
  skipOnStepId: 'move',
};

/**
 * The in-game tutorial: a queue of small, context-triggered lessons shown on a
 * non-blocking banner while the player plays.
 *
 * WHY THIS IS DATA-DRIVEN. TUTORIAL_STEPS below is a plain array; this class contains no
 * knowledge of any individual lesson. Re-ordering, re-wording or deleting a beat should
 * never mean touching logic - the same reason RESOURCE_TYPES/MUTATION_RECIPES/GAME_STATES
 * are their own single-source-of-truth tables rather than literals scattered through the
 * systems that read them.
 *
 * WHY IT IS TICKED INSIDE main.js's `isPlayingState` GATE. Everything here freezes for
 * free while the Bag is open, during a mutation reveal, on the Title screen and through
 * the ending, because those are all NOT the PLAYING state. That is the same trick
 * GAME_STATES.INVENTORY already uses to pause AI and timers without a second pause flag.
 * Do not move this call outside that block: coach text would keep advancing behind an
 * overlay the player cannot act through.
 *
 * WHY IT DOES NOT USE uiManager.showToast(). The toast queue is capped
 * (NOTIFICATION_QUEUE_MAX = 4) and DISCARDS THE OLDEST on overflow - see uiManager's own
 * comment admitting one-time hints are already being lost that way. A tutorial
 * instruction that silently evaporates in a busy moment is worse than no tutorial, so
 * the coach owns its own element and stays up until its step is actually completed.
 *
 * ONE STEP AT A TIME. Several Tier 2 conditions can go true on the same frame (heavy +
 * hungry + a predator arriving). Exactly one step is ever active; the rest wait.
 */

/**
 * Every lesson, in the order they are offered. Fields:
 *
 *   id        stable string, used as the saved-progress key - NEVER reuse or rename one
 *   requires  step ids that must be complete first (Tier 1's fixed sequence)
 *   text      what the player reads
 *   tone      'info' (mint) | 'warn' (amber) - warn is for pressure, not for danger
 *   highlight CSS selector of a HUD button to pulse while this step is up
 *   event     completes/arms on tutorialController.notify(<name>) from main.js
 *   ready     (ctx) => bool - extra gate before the step may start
 *   done      (ctx) => bool - polled; completes the step
 *   timeout   seconds after which the step completes on its own
 *   abandon   (ctx) => bool - step stops being relevant; retire it unlearned
 */
export const TUTORIAL_STEPS = [
  // --- Tier 1: the core loop. Strictly sequential. ---------------------------------
  {
    id: 'move',
    text: 'Drag anywhere to move.',
    done: (ctx) => ctx.distanceTravelled >= TUTORIAL_CONFIG.moveDistanceToLearn,
  },
  {
    id: 'absorb',
    requires: ['move'],
    text: 'Approach a glowing thing and tap it. Inspect it, then Acquire to absorb it.',
    doneEvent: 'absorbed',
  },
  {
    id: 'bag',
    requires: ['absorb'],
    text: 'What you absorb floats inside you. Tap the bag to look through it.',
    highlight: '#inventory-toggle',
    ready: (ctx) => ctx.absorbCount >= TUTORIAL_CONFIG.absorbsBeforeBag,
    doneEvent: 'bagOpened',
  },

  // --- Tier 2: contextual. Fire only when the game makes them relevant. -------------
  {
    id: 'eat',
    requires: ['absorb'],
    text: 'Getting hungry. Tap a glowing item inside your body, then Consume.',
    tone: 'warn',
    ready: (ctx) => ctx.energyRatio < 0.6 && ctx.hasEdible,
    doneEvent: 'consumed',
  },
  {
    id: 'weight',
    requires: ['absorb'],
    text: 'The more you carry, the slower you get.',
    ready: (ctx) => ctx.load >= 0.5,
    timeout: 4.5,
  },
  {
    id: 'drop',
    requires: ['weight'],
    // Mirrors uiManager.showHeavyHint's own branching, which is good and worth keeping:
    // pointing a player at the wheel to drop a rock they could simply throw teaches the
    // worse of the two answers at the exact moment they are listening.
    text: (ctx) => (ctx.ammoCount > 0
      ? 'Too heavy. Throw a rock at something to lighten the load.'
      : 'Too heavy. Press and hold on your own body to open the wheel, then tap to drop.'),
    tone: 'warn',
    highlight: (ctx) => (ctx.ammoCount > 0 ? '#throw-button' : null),
    ready: (ctx) => ctx.load >= 0.8,
    done: (ctx) => ctx.load < 0.7,
    doneEvent: 'expelled',
  },
  {
    id: 'throw',
    requires: ['absorb'],
    text: 'As a Slime you can throw rocks. Tap the throw button.',
    highlight: '#throw-button',
    ready: (ctx) => ctx.isSlime && ctx.ammoCount > 0 && ctx.hostileWithin(12),
    // The hostile wanders off and the moment has passed - come back to it another time.
    abandon: (ctx) => !ctx.hostileWithin(18) || !ctx.isSlime,
    doneEvent: 'threw',
  },
  {
    id: 'radar',
    requires: ['move'],
    text: 'Top right is your radar. Green is DNA worth taking, red is something hunting you.',
    ready: (ctx) => ctx.hasHostileBlip,
    timeout: 5.5,
  },
  {
    id: 'mutate',
    requires: ['absorb'],
    text: 'You have the ingredients for a mutation. Tap the mutate button.',
    highlight: '#mutate-button',
    armEvent: 'mutationAvailable',
    doneEvent: 'transformed',
  },
  {
    id: 'ratAbilities',
    requires: ['mutate'],
    // The single most opaque thing in the game: abilities are swapped by FORM, not
    // unlocked. Throw disappears and Bite appears, and nothing else ever says so.
    text: 'Bites land on their own when you are close and facing. Poison Expel works once per transformation.',
    highlight: '#poison-burst-button',
    ready: (ctx) => ctx.isVenomRat,
    timeout: 7,
    abandon: (ctx) => !ctx.isVenomRat,
  },
  {
    id: 'mutationTimer',
    requires: ['mutate'],
    text: 'You are about to revert. DNA you have absorbed stays unlocked, so you can mutate again.',
    tone: 'warn',
    ready: (ctx) => ctx.isVenomRat && ctx.mutationTimeRemaining > 0 && ctx.mutationTimeRemaining < 15,
    done: (ctx) => !ctx.isVenomRat,
    timeout: 8,
  },
];

function readSaved() {
  // localStorage THROWS on access in private mode and with site data blocked - it does
  // not merely return null. This game is aimed at phones, where both are common, so a
  // storage failure must degrade to "the tutorial runs again", never to a broken game.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { completed: [], skipped: false };
    const parsed = JSON.parse(raw);
    return {
      completed: Array.isArray(parsed?.completed) ? parsed.completed : [],
      skipped: parsed?.skipped === true,
    };
  } catch (_) {
    return { completed: [], skipped: false };
  }
}

function writeSaved(completed, skipped) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      completed: [...completed],
      skipped,
    }));
  } catch (_) { /* see readSaved - never fatal */ }
}

export class TutorialController {
  constructor({
    uiManager,
    playerController,
    inventoryManager,
    metabolismSystem,
    burdenSystem,
    playerFormController,
    projectileSystem,
    radarController,
  }) {
    this.uiManager = uiManager;
    this.playerController = playerController;
    this.inventoryManager = inventoryManager;
    this.metabolismSystem = metabolismSystem;
    this.burdenSystem = burdenSystem;
    this.playerFormController = playerFormController;
    this.projectileSystem = projectileSystem;
    this.radarController = radarController;

    const saved = readSaved();
    this.completed = new Set(saved.completed);
    this.skipped = saved.skipped;

    this._active = null;        // the step currently on screen
    this._activeTimer = 0;
    this._activeHighlight = null;
    this._renderedText = null;  // last text actually pushed to the UI - see _refreshActive
    this._armed = new Set();    // steps whose armEvent has fired
    this._pendingEvents = new Set();

    // Progress the steps read through `ctx`.
    this._absorbCount = 0;
    this._distanceTravelled = 0;
    this._lastPos = this.playerController.mesh.position.clone();
  }

  /** True once there is nothing left to teach - main.js can stop caring. */
  get isFinished() {
    return this.skipped || TUTORIAL_STEPS.every((s) => this.completed.has(s.id));
  }

  /**
   * Event hook. main.js CHAINS these onto the existing callbacks rather than replacing
   * them (the idiom main.js already uses for mutationSystem.onRecipeChecked), so nothing
   * that was already listening stops working.
   */
  notify(eventName) {
    if (this.isFinished) return;
    if (DEBUG_TUTORIAL) console.log(`[tutorial] event: ${eventName}`);

    if (eventName === 'absorbed') this._absorbCount++;

    // An armEvent can fire long before its step is reachable (a recipe becomes
    // available while an earlier beat is still on screen), so remember it rather than
    // requiring the step to be active at that exact moment.
    for (const step of TUTORIAL_STEPS) {
      if (step.armEvent === eventName) this._armed.add(step.id);
    }

    if (this._active && this._active.doneEvent === eventName) {
      this._complete(this._active);
      return;
    }
    this._pendingEvents.add(eventName);
  }

  /** Player tapped Skip on the first banner (decision D2). Ends the tutorial for good. */
  skip() {
    this.skipped = true;
    this._clearActive();
    writeSaved(this.completed, true);
    if (DEBUG_TUTORIAL) console.log('[tutorial] skipped by player');
  }

  /** Dev/testing hook, exposed on window.__hollowdrop alongside resetGame(). */
  reset() {
    this.completed.clear();
    this.skipped = false;
    this._armed.clear();
    this._pendingEvents.clear();
    this._absorbCount = 0;
    this._distanceTravelled = 0;
    this._clearActive();
    writeSaved(this.completed, false);
    if (DEBUG_TUTORIAL) console.log('[tutorial] progress cleared - reload to see it from the start');
  }

  update(deltaTime) {
    // Travel is accumulated even once the tutorial is done - it costs nothing and keeps
    // the reading correct if reset() is called mid-run from the console.
    const pos = this.playerController.mesh.position;
    this._distanceTravelled += this._lastPos.distanceTo(pos);
    this._lastPos.copy(pos);

    if (this.isFinished) {
      if (this._active) this._clearActive();
      return;
    }

    const ctx = this._buildContext();

    if (this._active) {
      this._activeTimer += deltaTime;

      if (this._active.abandon?.(ctx)) {
        this._retire(this._active);
        return;
      }
      if (this._active.done?.(ctx)) {
        this._complete(this._active);
        return;
      }
      if (this._active.timeout !== undefined && this._activeTimer >= this._active.timeout) {
        this._complete(this._active);
        return;
      }
      // A step's text/highlight can depend on live state (drop's throw-vs-wheel branch),
      // so refresh both while it is up rather than only at open.
      this._refreshActive(ctx);
      return;
    }

    this._pendingEvents.clear(); // only matter for the step that is on screen
    const next = this._pickNextStep(ctx);
    if (next) this._start(next, ctx);
  }

  _buildContext() {
    const form = this.playerFormController;
    const items = this.inventoryManager.items;
    let hasEdible = false;
    for (const item of items) {
      if (RESOURCE_TYPES[item.type]?.edible) { hasEdible = true; break; }
    }

    const blips = this.radarController.getBlips();
    const hostileTypes = [RADAR_TARGET_TYPES.ENEMY, RADAR_TARGET_TYPES.BOSS, RADAR_TARGET_TYPES.RIVAL];
    let hasHostileBlip = false;
    for (const blip of blips) {
      if (hostileTypes.includes(blip.type)) { hasHostileBlip = true; break; }
    }

    return {
      distanceTravelled: this._distanceTravelled,
      absorbCount: this._absorbCount,
      energyRatio: this.metabolismSystem.getEnergyRatio(),
      hasEdible,
      load: this.burdenSystem.load,
      ammoCount: this.projectileSystem.getAmmoCount(),
      isSlime: form.currentForm === PLAYER_FORMS.SLIME,
      isVenomRat: form.currentForm === PLAYER_FORMS.VENOM_RAT,
      mutationTimeRemaining: form.getMutationTimeRemaining(),
      hasHostileBlip,
      // radar blips carry distanceSq already - no sqrt unless a step asks for a radius
      hostileWithin: (radius) => {
        const rSq = radius * radius;
        for (const blip of blips) {
          if (hostileTypes.includes(blip.type) && blip.distanceSq < rSq) return true;
        }
        return false;
      },
    };
  }

  _pickNextStep(ctx) {
    for (const step of TUTORIAL_STEPS) {
      if (this.completed.has(step.id)) continue;
      if (step.requires && !step.requires.every((id) => this.completed.has(id))) continue;
      if (step.armEvent && !this._armed.has(step.armEvent) && !this._armed.has(step.id)) continue;
      if (step.ready && !step.ready(ctx)) continue;
      return step;
    }
    return null;
  }

  _start(step, ctx) {
    this._active = step;
    this._activeTimer = 0;
    this._refreshActive(ctx);
    if (DEBUG_TUTORIAL) console.log(`[tutorial] step: ${step.id}`);
  }

  _refreshActive(ctx) {
    const step = this._active;
    const text = typeof step.text === 'function' ? step.text(ctx) : step.text;
    const highlight = typeof step.highlight === 'function' ? step.highlight(ctx) : step.highlight;

    // This runs EVERY frame the step is up (a step's copy can depend on live state -
    // see 'drop'), so only push when the text actually changed. showCoach re-binds the
    // Skip listener and schedules an entry animation; doing that 60x a second would
    // churn listeners and never let the transition finish.
    if (text !== this._renderedText) {
      this._renderedText = text;
      this.uiManager.showCoach(text, {
        tone: step.tone ?? 'info',
        // Skip is offered on the very first beat only - see TUTORIAL_CONFIG.skipOnStepId.
        onSkip: step.id === TUTORIAL_CONFIG.skipOnStepId ? () => this.skip() : null,
      });
    }

    if (highlight !== this._activeHighlight) {
      if (this._activeHighlight) this.uiManager.setTutorialPulse(this._activeHighlight, false);
      if (highlight) this.uiManager.setTutorialPulse(highlight, true);
      this._activeHighlight = highlight ?? null;
    }
  }

  /** Learned. Never offered again, on this run or any future session. */
  _complete(step) {
    this.completed.add(step.id);
    writeSaved(this.completed, this.skipped);
    this._clearActive();
    if (DEBUG_TUTORIAL) console.log(`[tutorial] learned: ${step.id}`);
  }

  /** The moment passed before the player acted. Dropped WITHOUT being marked learned,
   *  so it can come back the next time its trigger is genuinely true. */
  _retire(step) {
    this._clearActive();
    if (DEBUG_TUTORIAL) console.log(`[tutorial] abandoned (will retry): ${step.id}`);
  }

  _clearActive() {
    if (this._activeHighlight) {
      this.uiManager.setTutorialPulse(this._activeHighlight, false);
      this._activeHighlight = null;
    }
    this._active = null;
    this._activeTimer = 0;
    this._renderedText = null;
    this.uiManager.hideCoach();
  }
}
