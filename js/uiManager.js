const NOTIFICATION_VISIBLE_MS = 700;
const NOTIFICATION_GAP_MS = 140;  // breathing room between queued toasts
const NOTIFICATION_QUEUE_MAX = 4; // past this, older messages describe a state that has moved on
const HINT_VISIBLE_MS = 1600;
const HEAVY_HINT_VISIBLE_MS = 2600; // longer: it is the one hint that teaches a hidden gesture
const DISSOLVED_VISIBLE_MS = 1800;
const NOT_EDIBLE_VISIBLE_MS = 900;
const ENERGY_FULL_VISIBLE_MS = 900;
const MUTATION_DISCOVERED_VISIBLE_MS = 2000;
const GENOME_SECURED_VISIBLE_MS = 2600; // the biggest moment so far - given more time to read than a normal pickup
const GENOME_FLASH_MS = 900;
const RIVAL_ALERT_VISIBLE_MS = 1000;
const FRAGMENT_EVENT_VISIBLE_MS = 1400;
const FRAGMENT_LOST_VISIBLE_MS = 1800;

// Optional, currently silent - hooks so audio/music can be added later without
// touching this file's actual UI logic (spec sections 71-72).
function playMemoryRevealSound() {}
function playRunCompleteSound() {}
function playPlayAgainSound() {}
function setMusicState(_state) {}

/** Thin wrapper around the minimal HUD elements: mass/health/energy bars, the
 *  toast/hint notification, and the full-screen death/respawn fade. */
export class UIManager {
  constructor() {
    this.massUi = document.getElementById('mass-ui');
    this.massFill = document.getElementById('mass-fill');
    this.massText = document.getElementById('mass-text');
    this.healthUi = document.getElementById('health-ui');
    this.healthFill = document.getElementById('health-fill');
    this.healthText = document.getElementById('health-text');
    this.energyUi = document.getElementById('energy-ui');
    this.energyFill = document.getElementById('energy-fill');
    this.energyText = document.getElementById('energy-text');
    this.notification = document.getElementById('pickup-notification');
    this.screenFade = document.getElementById('screen-fade');
    this.starvationOverlay = document.getElementById('starvation-overlay');
    this._notificationTimeout = null;
    this.infoCard = document.getElementById('info-card');
    this.infoCardKicker = document.getElementById('info-card-kicker');
    this.infoCardTitle = document.getElementById('info-card-title');
    this.infoCardBody = document.getElementById('info-card-body');
    this.infoCardList = document.getElementById('info-card-list');
    this.infoCardCost = document.getElementById('info-card-cost');
    this.infoCardContinue = document.getElementById('info-card-continue');
    this._notificationQueue = [];
    this._notificationActive = false;
    // Only for dismissTransientUI()'s defensive hide - InventoryInteractionController
    // remains the sole owner of this element's content/positioning/candidate state.
    this.consumeActionEl = document.getElementById('consume-action');

    this.mutateButton = document.getElementById('mutate-button');
    this.debugRecipePanel = document.getElementById('debug-recipe-panel');

    this.mutationTimerUi = document.getElementById('mutation-timer-ui');
    this.mutationTimerFill = document.getElementById('mutation-timer-fill');
    this.mutationTimerText = document.getElementById('mutation-timer-text');

    this.poisonBurstButton = document.getElementById('poison-burst-button') || document.getElementById('bite-button');
    this.poisonBurstBadge = this.poisonBurstButton?.querySelector('.poison-burst-badge');
    this.biteButton = this.poisonBurstButton;
    this.throwButton = document.getElementById('throw-button');
    this.throwAmmoEl = this.throwButton?.querySelector('.throw-ammo');

    this.bossHealthUi = document.getElementById('boss-health-ui');
    this.bossHealthFill = document.getElementById('boss-health-fill');
    this.bossHealthName = document.getElementById('boss-health-name');

    this.genomeFlash = document.getElementById('genome-flash');
    this._genomeFlashTimeout = null;

    this.rivalEscapeUi = document.getElementById('rival-escape-ui');
    this.rivalEscapeFill = document.getElementById('rival-escape-fill');

    this.objectiveIndicator = document.getElementById('objective-indicator');

    this.titleScreen = document.getElementById('title-screen');
    this.titleBeginButton = document.getElementById('title-begin-button');

    this.memoryOverlay = document.getElementById('memory-overlay');
    this.memoryTitleEl = document.getElementById('memory-title');
    this.memoryTextEl = document.getElementById('memory-text');
    this.memoryContinueButton = document.getElementById('memory-continue-button');

    this.runCompleteOverlay = document.getElementById('run-complete-overlay');
    this.runCompleteStatsEl = document.getElementById('run-complete-stats');
    this.runCompletePlayAgainButton = document.getElementById('run-complete-play-again');
  }

  /** Shows the POISON BURST (Toxic Nova) button for the Venom Rat form. */
  showPoisonBurstButton(onTrigger) {
    if (!this.poisonBurstButton) return;
    this.poisonBurstButton.classList.add('poison-burst-button--visible', 'bite-button--visible');
    this.poisonBurstButton.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onTrigger();
    };
  }

  hidePoisonBurstButton() {
    if (!this.poisonBurstButton) return;
    this.poisonBurstButton.classList.remove('poison-burst-button--visible', 'bite-button--visible', 'poison-burst-button--spent');
    this.poisonBurstButton.onclick = null;
  }

  /** Updates the visual ready / spent state and badge of the Poison Burst button. */
  updatePoisonBurstState(available) {
    if (!this.poisonBurstButton) return;
    this.poisonBurstButton.classList.toggle('poison-burst-button--spent', !available);
    if (this.poisonBurstBadge) {
      this.poisonBurstBadge.textContent = available ? '1' : '0';
    }
  }

  /** Backward compatibility aliases for bite button */
  showBiteButton(onBite) {
    this.showPoisonBurstButton(onBite);
  }

  hideBiteButton() {
    this.hidePoisonBurstButton();
  }

  updateBiteCooldown(_cooldownRemaining, _cooldownTotal, _ready) {}

  /** Shows the THROW button. Same (re)bind-on-call contract as showBiteButton, so
   *  ProjectileSystem can call it from setAvailable() without tracking listeners. */
  showThrowButton(onThrow) {
    if (!this.throwButton) return;
    this.throwButton.classList.add('throw-button--visible');
    this.throwButton.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation(); // a tap here must never fall through to movement/inventory gestures
      onThrow();
    };
  }

  hideThrowButton() {
    if (!this.throwButton) return;
    this.throwButton.classList.remove('throw-button--visible', 'throw-button--cooldown', 'throw-button--empty');
    this.throwButton.onclick = null;
  }

  /** Called every frame while throwing is available. Carries the ammo count as well as
   *  the cooldown because the count IS the reason the button can be dead: an empty
   *  inventory and a running cooldown both mean "a tap does nothing", and without the
   *  number the player cannot tell which. `throw-button--empty` is a distinct class
   *  from the cooldown dim so CSS can style "out of rocks" differently from "wait". */
  updateThrowState(ammoCount, cooldownRemaining, cooldownTotal, ready) {
    if (!this.throwButton) return;
    const ratio = cooldownTotal > 0 ? Math.max(cooldownRemaining, 0) / cooldownTotal : 0;
    this.throwButton.style.setProperty('--cd', ratio);
    this.throwButton.classList.toggle('throw-button--cooldown', !ready);
    this.throwButton.classList.toggle('throw-button--empty', ammoCount === 0);
    if (this.throwAmmoEl) this.throwAmmoEl.textContent = String(ammoCount);
  }

  /** Shows the MUTATE button. `onMutate` is (re)bound each call so callers don't
   *  need to manage their own listener lifecycle. The button's markup carries both the
   *  mutate and revert icons already (index.html) - which one is visible is pure CSS,
   *  keyed off the same mutate-button--revert class this toggles, so recipe.name isn't
   *  needed here any more (the icon doesn't vary per-recipe; this prototype only has one). */
  showMutationReady(recipe, onMutate) {
    if (!this.mutateButton) return;
    this.mutateButton.classList.remove('mutate-button--revert');
    this.mutateButton.classList.add('mutate-button--visible');
    this._bindActionButton(onMutate);
  }

  hideMutationReady() {
    this._hideActionButton();
  }

  /** Same physical button, repurposed while the player is the Venom Rat - one primary
   *  action slot in the bottom-right corner rather than two buttons competing for it. */
  showRevertReady(onRevert) {
    if (!this.mutateButton) return;
    this.mutateButton.classList.add('mutate-button--revert', 'mutate-button--visible');
    this._bindActionButton(onRevert);
  }

  hideRevertReady() {
    this._hideActionButton();
  }

  _bindActionButton(onTap) {
    this.mutateButton.onclick = (e) => {
      e.preventDefault();
      onTap();
    };
  }

  _hideActionButton() {
    if (!this.mutateButton) return;
    this.mutateButton.classList.remove('mutate-button--visible', 'mutate-button--revert');
    this.mutateButton.onclick = null;
  }

  /** Brief one-time toast the first time a recipe's ingredients are all collected. */
  showMutationDiscovered(name) {
    this._showNotification(`Mutation Discovered: ${name}`, 'notification--hint', MUTATION_DISCOVERED_VISIBLE_MS);
  }

  /** One-shot toast when the mutation countdown reaches zero - the HUD/Rat visuals
   *  already carry the continuous warning, this just marks the moment itself. */
  showMutationExpired() {
    this._showNotification('Mutation Expired — Reverted to Slime', 'notification--warning', HINT_VISIBLE_MS);
  }

  /** Reveals the countdown HUD (see updateMutationTimerUI) - called once transformation
   *  completes, alongside starting the timer itself. */
  showMutationTimerUI() {
    this.mutationTimerUi?.classList.add('mutation-timer-ui--visible');
  }

  /** Hides the countdown HUD - called anywhere the timer stops (manual revert,
   *  expiration, death, respawn), so no stale "0s" is ever left on screen. */
  hideMutationTimerUI() {
    this.mutationTimerUi?.classList.remove('mutation-timer-ui--visible', 'mutation-timer-ui--low', 'mutation-timer-ui--critical');
  }

  /** Called every frame the countdown is active. `ratio` (1..0) drives the bar via a
   *  transform (not width) for smooth, cheap shrinking; `secondsRemaining` is only
   *  ever rounded here (Math.ceil), never in the timer's own internal float state. */
  updateMutationTimerUI(secondsRemaining, ratio, timingState) {
    if (!this.mutationTimerFill || !this.mutationTimerText) return;
    this.mutationTimerFill.style.transform = `scaleX(${Math.max(ratio, 0)})`;
    this.mutationTimerText.textContent = `${Math.ceil(secondsRemaining)}s`;
    this.mutationTimerUi.classList.toggle('mutation-timer-ui--low', timingState === 'LOW');
    this.mutationTimerUi.classList.toggle('mutation-timer-ui--critical', timingState === 'CRITICAL');
    // Final few seconds: the number itself pulses in place - never a full-screen countdown.
    this.mutationTimerText.classList.toggle('mutation-timer-text--final', secondsRemaining > 0 && secondsRemaining <= 3);
  }

  /** Reveals the boss HUD (see updateBossHealth) - called once on ApexController's
   *  startEncounter(), same "reveal, then update every frame" pattern as the
   *  mutation timer. Sets the name once; it never changes for the life of the fight. */
  showBossHealth(name) {
    if (!this.bossHealthUi) return;
    this.bossHealthName.textContent = name;
    this.bossHealthUi.classList.add('boss-health-ui--visible');
  }

  /** Hides the boss HUD - called once the death sequence fully resolves, so no
   *  stale empty bar is left on screen after the fight ends. */
  hideBossHealth() {
    this.bossHealthUi?.classList.remove('boss-health-ui--visible');
  }

  /** Called every frame the encounter is active. Same scaleX-transform trick as the
   *  mutation timer bar - cheap, smooth, and never touches the bar's DOM structure. */
  updateBossHealth(ratio) {
    if (!this.bossHealthFill) return;
    this.bossHealthFill.style.transform = `scaleX(${Math.max(ratio, 0)})`;
  }

  /** One-shot toast when the Human Genome Fragment is collected - the biggest
   *  moment in the game so far, given more time on screen than a normal pickup. */
  showGenomeFragmentSecured() {
    this._showNotification('Human Genome Fragment Secured', 'notification--hint', GENOME_SECURED_VISIBLE_MS);
  }

  /** Brief warm full-screen pulse on Genome Fragment collection (spec: "brief screen
   *  glow") - a one-shot CSS animation, not driven per-frame like the death fade. */
  triggerGenomeFlash() {
    if (!this.genomeFlash) return;
    clearTimeout(this._genomeFlashTimeout);
    this.genomeFlash.classList.remove('genome-flash--active');
    void this.genomeFlash.offsetWidth; // force reflow so a rapid re-trigger still animates
    this.genomeFlash.classList.add('genome-flash--active');
    this._genomeFlashTimeout = setTimeout(() => {
      this.genomeFlash.classList.remove('genome-flash--active');
    }, GENOME_FLASH_MS);
  }

  /** Brief one-shot alert when the Rival enters the arena (spec: "RIVAL DETECTED",
   *  ~1s, not a tutorial overlay). Its own small health bar is a world-space sprite
   *  on the Rival itself (see entityHealthBar.js), same as Glow Beetle/Predator -
   *  no dedicated HTML HUD like the Apex boss bar. */
  showRivalAlert() {
    this._showNotification('Rival Detected', 'notification--warning', RIVAL_ALERT_VISIBLE_MS);
  }

  /** One-shot toast the first time the Species-Seeker Radar picks up the Apex's signal
   *  (spec section 31) - RadarHUD guards this to once per encounter, this method is
   *  just the generic toast render. */
  showRadarSignal(text) {
    this._showNotification(text, 'notification--warning', RIVAL_ALERT_VISIBLE_MS);
  }

  // --- Fragment contest --------------------------------------------------------

  showFragmentAcquired() {
    this._showNotification('Genome Fragment Acquired', 'notification--hint', FRAGMENT_EVENT_VISIBLE_MS);
  }

  showRivalStoleFragment() {
    this._showNotification('Rival Stole The Fragment', 'notification--warning', FRAGMENT_EVENT_VISIBLE_MS);
  }

  showFragmentDropped() {
    this._showNotification('Fragment Dropped', 'notification--warning', FRAGMENT_EVENT_VISIBLE_MS);
  }

  /** Fired once, the moment the Player first picks up the Fragment (spec section 45) -
   *  distinct from showFragmentAcquired() so the two can be read in sequence without
   *  the shared notification element cutting one off. */
  showExtractionActivated() {
    this._showNotification('Escape With The Fragment', 'notification--hint', FRAGMENT_EVENT_VISIBLE_MS);
  }

  /** Fired when the Rival completes its escape channel - forgiving prototype
   *  behavior follows shortly after (FragmentContestManager resets the contest),
   *  never a hard run failure. */
  showFragmentLost() {
    this._showNotification('Fragment Lost', 'notification--warning', FRAGMENT_LOST_VISIBLE_MS);
  }

  /** Reveals the small "RIVAL ESCAPING" channel bar - the player's last chance to
   *  interrupt before the Fragment is lost for this attempt. */
  showRivalEscapeChannel() {
    this.rivalEscapeUi?.classList.add('rival-escape-ui--visible');
  }

  hideRivalEscapeChannel() {
    this.rivalEscapeUi?.classList.remove('rival-escape-ui--visible');
  }

  /** `ratio` 0..1, channel progress - same scaleX-transform trick as every other bar. */
  updateRivalEscapeChannel(ratio) {
    if (!this.rivalEscapeFill) return;
    this.rivalEscapeFill.style.transform = `scaleX(${Math.min(Math.max(ratio, 0), 1)})`;
  }

  /** Screen-edge arrow pointing at whichever objective currently matters (see
   *  ObjectiveIndicatorController) - `x`/`y` are absolute page coordinates,
   *  `angleRad` rotates the (up-pointing) arrow to face the target. */
  showObjectiveIndicator(x, y, angleRad) {
    if (!this.objectiveIndicator) return;
    this.objectiveIndicator.style.left = `${x}px`;
    this.objectiveIndicator.style.top = `${y}px`;
    this.objectiveIndicator.style.transform = `translate(-50%, -50%) rotate(${angleRad}rad)`;
    this.objectiveIndicator.classList.add('objective-indicator--visible');
  }

  hideObjectiveIndicator() {
    this.objectiveIndicator?.classList.remove('objective-indicator--visible');
  }

  // --- Title / Memory / Run Complete -------------------------------------------

  /** `onBegin` is (re)bound each call, same pattern as showMutationReady(). */
  showTitleScreen(onBegin) {
    if (!this.titleScreen) return;
    this.titleScreen.classList.add('title-screen--visible');
    if (this.titleBeginButton) {
      this.titleBeginButton.onclick = (e) => {
        e.preventDefault();
        onBegin();
      };
    }
  }

  hideTitleScreen() {
    this.titleScreen?.classList.remove('title-screen--visible');
  }

  /** Toggled while GameFlowController is waiting on the player model to finish loading
   *  after a tap (see main.js's `slimeReady` wiring) - keeps the Title screen up with a
   *  clear "still working" state instead of the button looking unresponsive to a second
   *  tap. Text is restored on the way out so a later run (there is only ever one Title
   *  screen per session, but this keeps the button honest regardless) doesn't inherit it. */
  setTitleLoading(isLoading) {
    if (!this.titleBeginButton) return;
    this.titleBeginButton.disabled = isLoading;
    this.titleBeginButton.textContent = isLoading ? 'LOADING…' : 'TAP TO BEGIN';
  }

  /**
   * Shows the shared info card - used for the opening objective and for the
   * post-transformation reveal. One element serves both because they are the same
   * shape and GameFlowController's states guarantee only one can be up at a time.
   *
   * @param kicker  small label above the heading
   * @param title   heading
   * @param body    one or two sentences
   * @param list    optional bullet points (what a form grants)
   * @param cost    optional emphasised line (what it costs you)
   */
  showInfoCard({ kicker = '', title = '', body = '', list = [], cost = '' }, onContinue) {
    if (!this.infoCard) return;
    this.infoCardKicker.textContent = kicker;
    this.infoCardTitle.textContent = title;
    this.infoCardBody.textContent = body;
    this.infoCardCost.textContent = cost;
    this.infoCardCost.style.display = cost ? '' : 'none';

    this.infoCardList.innerHTML = '';
    for (const entry of list) {
      const li = document.createElement('li');
      li.textContent = entry;
      this.infoCardList.appendChild(li);
    }
    this.infoCardList.style.display = list.length ? '' : 'none';

    this.infoCard.classList.add('info-card--visible');
    this.infoCardContinue.onclick = (e) => {
      e.preventDefault();
      onContinue?.();
    };
  }

  hideInfoCard() {
    this.infoCard?.classList.remove('info-card--visible');
    if (this.infoCardContinue) this.infoCardContinue.onclick = null;
  }

  /** Reveals the Memory overlay and fills in its (placeholder) content - the actual
   *  reveal choreography (fade/pulse/silhouette/staggered text) is pure CSS, driven
   *  entirely by the --active class toggle here (see style.css). `onContinue` is
   *  (re)bound each call; the button itself only becomes tappable once
   *  showMemoryContinuePrompt() adds --continuable (spec section 18's minimum-time gate). */
  showMemory(memory, onContinue) {
    if (!this.memoryOverlay) return;
    if (this.memoryTitleEl) this.memoryTitleEl.textContent = memory.title;
    if (this.memoryTextEl) this.memoryTextEl.textContent = memory.text;
    this.memoryOverlay.classList.remove('memory-overlay--continuable');
    this.memoryOverlay.classList.add('memory-overlay--visible', 'memory-overlay--active');
    if (this.memoryContinueButton) {
      this.memoryContinueButton.onclick = (e) => {
        e.preventDefault();
        onContinue();
      };
    }
    setMusicState('memory');
  }

  showMemoryContinuePrompt() {
    this.memoryOverlay?.classList.add('memory-overlay--continuable');
  }

  hideMemory() {
    this.memoryOverlay?.classList.remove('memory-overlay--visible', 'memory-overlay--active', 'memory-overlay--continuable');
  }

  /** `stats` already carries a pre-formatted `runTimeFormatted` field (see
   *  RunCompleteController) - this method is pure rendering, no formatting logic.
   *  `onPlayAgain` is (re)bound each call; the button disables itself the instant it's
   *  pressed (spec section 69: prevent a double-tap from firing two resets) and is
   *  re-enabled the next time this is called. */
  showRunComplete(stats, onPlayAgain) {
    if (!this.runCompleteOverlay) return;
    if (this.runCompleteStatsEl) this.runCompleteStatsEl.innerHTML = this._buildRunCompleteStatsHtml(stats);
    this.runCompleteOverlay.classList.add('run-complete-overlay--visible');
    if (this.runCompletePlayAgainButton) {
      this.runCompletePlayAgainButton.disabled = false;
      this.runCompletePlayAgainButton.onclick = (e) => {
        e.preventDefault();
        this.runCompletePlayAgainButton.disabled = true;
        playPlayAgainSound();
        onPlayAgain();
      };
    }
    playRunCompleteSound();
    setMusicState('run_complete');
  }

  hideRunComplete() {
    this.runCompleteOverlay?.classList.remove('run-complete-overlay--visible');
  }

  _buildRunCompleteStatsHtml(stats) {
    const rows = [
      ['Human Genome Fragment', stats.genomeFragmentsSecured > 0 ? 'SECURED' : 'Not Secured'],
    ];
    if (stats.venomRatDiscovered) rows.push(['Mutation Discovered', 'VENOM RAT']);
    rows.push(['Prey Hunted', String(stats.preyDefeated)]);
    rows.push(['Predators Defeated', String(stats.predatorsDefeated)]);
    if (stats.apexDefeated > 0) rows.push(['Apex Defeated', 'MURKMAW']);
    rows.push(['Run Time', stats.runTimeFormatted]);

    return rows
      .map(
        ([label, value]) => `
      <div class="run-complete-stat-row">
        <span class="run-complete-stat-label">${label}</span>
        <span class="run-complete-stat-value">${value}</span>
      </div>`
      )
      .join('');
  }

  /** Instantly dismisses every transient HUD/toast element (spec sections 49-50) -
   *  called once by the Play Again reset pipeline so nothing from the previous run
   *  (a mid-timeout toast, a still-visible boss bar) survives into the new one. Does
   *  NOT touch "already seen this tutorial hint" flags elsewhere - those are a
   *  separate, deliberately session-persistent concern (see MetabolismSystem). */
  dismissTransientUI() {
    clearTimeout(this._notificationTimeout);
    // The queue has to be emptied too, not just the visible toast - otherwise messages
    // pending from the previous run drain into the new one seconds after Play Again.
    this._notificationQueue.length = 0;
    this._notificationActive = false;
    this.notification?.classList.remove('notification--visible');
    this.consumeActionEl?.classList.remove('consume-action--visible');
    this.debugRecipePanel?.classList.remove('debug-recipe-panel--visible');
    this.hideMutationReady();
    this.hideRevertReady();
    this.hideBiteButton();
    this.hideThrowButton();
    this.hideMutationTimerUI();
    this.hideBossHealth();
    this.hideRivalEscapeChannel();
    this.hideObjectiveIndicator();
    this.setStarvationState(false);
    setMusicState('gameplay');
  }

  /** Controls ambient pulsing red hue vignette on energy exhaustion */
  setStarvationState(isStarving) {
    if (!this.starvationOverlay) {
      this.starvationOverlay = document.getElementById('starvation-overlay');
    }
    if (!this.starvationOverlay) return;
    if (isStarving) {
      this.starvationOverlay.classList.add('is-active');
    } else {
      this.starvationOverlay.classList.remove('is-active');
    }
  }

  /** Dev-only recipe checklist (DEBUG_MUTATION). Pass null to hide it. */
  updateDebugRecipe(recipe, missingByType) {
    if (!this.debugRecipePanel) return;
    if (!recipe) {
      this.debugRecipePanel.classList.remove('debug-recipe-panel--visible');
      return;
    }
    const missingMap = new Map(missingByType.map((m) => [m.type, m.missing]));
    const lines = Object.entries(recipe.ingredients).map(([type, need]) => {
      const missing = missingMap.get(type) ?? 0;
      const have = need - missing;
      return `${type} ${have}/${need}`;
    });
    this.debugRecipePanel.textContent = `${recipe.name}\n${lines.join('\n')}`;
    this.debugRecipePanel.classList.add('debug-recipe-panel--visible');
  }

  updateHealthUI(current, max) {
    if (!this.healthFill || !this.healthText) return;
    const ratio = Math.min(Math.max(current / max, 0), 1);
    this.healthFill.style.width = `${ratio * 100}%`;
    this.healthText.textContent = `${Math.round(current)} / ${max}`;

    // Mirrors the mass-ui heavy/overburdened pattern: 40-70% normal-ish, <40% critical, <20% severe.
    this.healthUi?.classList.toggle('health-ui--critical', ratio <= 0.4 && ratio > 0.2);
    this.healthUi?.classList.toggle('health-ui--severe', ratio <= 0.2);
  }

  updateEnergyUI(current, max) {
    if (!this.energyFill || !this.energyText) return;
    const ratio = Math.min(Math.max(current / max, 0), 1);
    this.energyFill.style.width = `${ratio * 100}%`;
    this.energyText.textContent = `${Math.round(current)}`;

    // Matches MetabolismSystem's own LOW/CRITICAL/STARVING thresholds (30%/12%/0).
    this.energyUi?.classList.toggle('energy-ui--low', ratio <= 0.3 && ratio > 0.12);
    this.energyUi?.classList.toggle('energy-ui--critical', ratio <= 0.12 && ratio > 0);
    this.energyUi?.classList.toggle('energy-ui--starving', ratio <= 0);
  }

  showNotEdible(name) {
    this._showNotification(`${name} — Not edible`, 'notification--warning', NOT_EDIBLE_VISIBLE_MS);
  }

  showEnergyFull() {
    this._showNotification('Energy Full', 'notification--hint', ENERGY_FULL_VISIBLE_MS);
  }

  /** One-time tutorial hint the first time MetabolismSystem reports energy running low. */
  showLowEnergyHint() {
    this._showNotification('Tap an organic item inside Hollowdrop to consume it', 'notification--hint', HINT_VISIBLE_MS);
  }

  showDissolved() {
    this._showNotification('Dissolved', 'notification--warning', DISSOLVED_VISIBLE_MS);
  }

  /** opacity: 0 (clear) .. 1 (fully covered). Driven per-frame by DeathRespawnManager,
   *  not a CSS transition, so its timing stays exactly in sync with the death sequence. */
  setScreenFade(opacity) {
    if (this.screenFade) this.screenFade.style.opacity = opacity;
  }

  updateMassUI(current, max) {
    if (!this.massFill || !this.massText) return;
    const ratio = Math.min(current / max, 1);
    this.massFill.style.width = `${ratio * 100}%`;
    this.massText.textContent = `${Math.round(current * 10) / 10} / ${max}`;
    this.massFill.classList.toggle('mass-fill--full', ratio >= 1);

    // Heavy-state urgency, per the burden thresholds: 0-50% normal, 50-80% heavy, 80%+ overburdened.
    this.massUi?.classList.toggle('mass-ui--heavy', ratio >= 0.5 && ratio < 0.8);
    this.massUi?.classList.toggle('mass-ui--overburdened', ratio >= 0.8);
  }

  showPickupNotification(name) {
    this._showNotification(`+ ${name}`, 'notification--pickup', NOTIFICATION_VISIBLE_MS);
  }

  showToast(text, variant = 'notification--hint', duration = 1200) {
    this._showNotification(text, variant, duration);
  }

  showInventoryFull() {
    this._showNotification('Too Heavy', 'notification--warning', NOTIFICATION_VISIBLE_MS);
  }

  /** One-time tutorial hint the first time BurdenSystem reports the heavy threshold reached. */
  /** `ammoCount` is how many throwable rocks are aboard - the hint names the throw
   *  button when rocks are the problem (they are the heaviest thing in the game and
   *  the most likely cause of being overloaded) and falls back to the wheel otherwise.
   *  Pointing a player at the wheel to drop a rock they could simply throw at something
   *  teaches the worse of the two answers at the exact moment they are listening. */
  showHeavyHint(ammoCount = 0) {
    // Teaches the long-press wheel at the exact moment it becomes useful, which is the
    // only genuinely undiscoverable control in the game. This previously read "Swipe an
    // item out to move faster" and was simply false once swipe-to-expel was removed - it
    // sent the player hunting for a gesture that no longer exists.
    const message = ammoCount > 0
      ? 'Too heavy \u2014 throw a rock to hit something and lighten the load'
      : 'Too heavy \u2014 hold on your body to open the wheel and drop something';
    this._showNotification(message, 'notification--hint', HEAVY_HINT_VISIBLE_MS);
  }

  // Reuses a single element so rapid messages update/restart the toast instead of stacking.
  /**
   * Queues a toast rather than replacing whatever is on screen.
   *
   * This used to clearTimeout the previous message and overwrite it immediately, which
   * meant that in a busy moment - absorbing an item while going heavy while energy runs
   * low while the Rival arrives - the player saw only whichever fired last and every
   * other hint was silently destroyed. Several of those are one-time tutorial hints that
   * never come back, so they were being lost permanently.
   *
   * The queue is capped: past a few pending messages the information is stale by the
   * time it would appear, and a long backlog would keep talking about things that
   * stopped being true. Newest wins in that case, since it describes the current state.
   */
  _showNotification(text, variant, duration) {
    if (!this.notification) return;

    this._notificationQueue.push({ text, variant, duration });
    if (this._notificationQueue.length > NOTIFICATION_QUEUE_MAX) {
      this._notificationQueue.splice(0, this._notificationQueue.length - NOTIFICATION_QUEUE_MAX);
    }
    if (!this._notificationActive) this._drainNotificationQueue();
  }

  _drainNotificationQueue() {
    const next = this._notificationQueue.shift();
    if (!next) {
      this._notificationActive = false;
      return;
    }
    this._notificationActive = true;

    this.notification.textContent = next.text;
    this.notification.classList.remove(
      'notification--pickup',
      'notification--warning',
      'notification--hint',
      'notification--visible'
    );
    void this.notification.offsetWidth; // force reflow so re-triggering the same variant still animates
    this.notification.classList.add(next.variant, 'notification--visible');

    clearTimeout(this._notificationTimeout);
    this._notificationTimeout = setTimeout(() => {
      this.notification.classList.remove('notification--visible');
      // Short beat between messages so two in a row read as two, not as one flicker.
      this._notificationTimeout = setTimeout(() => this._drainNotificationQueue(), NOTIFICATION_GAP_MS);
    }, next.duration);
  }
}
