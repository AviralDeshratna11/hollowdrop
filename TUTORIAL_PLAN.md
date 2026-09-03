# Tutorial plan — teaching Hollowdrop as you play

**Status: PLAN ONLY. No code has been written for this yet.**

This document is written to be handed to a fresh Claude Code session. Everything in it
was checked against the actual code on `main` (plus the rat-animation branch), not
assumed. Line references are to the files as they stand today.

**How to use this:** read Part 1 and 2 for the *why*, Part 3 for *what the player sees*,
Part 4 for *how to build it*, and Part 5 for *what order to build it in*. Part 9 lists
the handful of decisions a human should make before building.

---

## Part 1 — Why the game is hard to understand right now

This is not a guess. Here is what a new player is actually not told.

### 1.1 There is one card, and then silence

`main.js` has a section literally called `--- Guided moments ---` (line 1013). It contains
exactly three things:

| Hook | What it does |
|---|---|
| `gameFlowController.onFirstRunBegun` | Shows one card: *"Absorb. Adapt. Survive."* |
| `playerFormController.onTransformed` | Shows the mutation reveal card |
| `genomeFragmentController.onSecured` | Ends the run |

That opening card tells you the goal in three sentences and is never followed up. Every
other mechanic is left to be discovered.

### 1.2 Four controls are effectively invisible

| Control | How you'd ever find out |
|---|---|
| **Drag anywhere to move** | Guessable. Fine. |
| **Tap an item inside your body → Consume** | Only taught by a one-time toast that fires when energy is already low (`uiManager.showLowEnergyHint`, line 583) |
| **Long-press your own body (420ms) → radial wheel → drop an item** | Only taught by a one-time toast when you are already overloaded (`showHeavyHint`, line 627). The code itself calls this *"the only genuinely undiscoverable control in the game."* |
| **Tap your own body's items vs drag to move** | Never explained that these are different gestures on the same surface |

Both of those teaching toasts fire **once, at a moment of stress**, and go through the
shared notification queue — see trap 7.2, they can be silently dropped.

### 1.3 Your abilities silently swap when you change form

From the main loop (`main.js` ~1206):

```js
playerCombatController.setAvailable(canAct && form === PLAYER_FORMS.VENOM_RAT);
projectileSystem.setAvailable(canAct && form === PLAYER_FORMS.SLIME);
```

So: **throwing rocks is Slime-only. Biting is Rat-only.** The throw button vanishes when
you mutate and the bite appears. Nothing says this. A player who liked throwing rocks
mutates and loses the ability with no explanation.

Worse: the bite is **automatic** (`PlayerCombatController` "automatically triggers
rhythmic proximity bite attacks... when facing an enemy within range"), while Poison
Expel is a manual button usable **once per transformation**. A player will press the
bite-looking button expecting to attack.

### 1.4 The critical path is never stated

The actual win condition is a five-step chain, and only step 5 is ever mentioned:

```
walk within 12.5 units of (-10, -9)   ->  Apex encounter starts automatically
defeat the Apex (Murkmaw)             ->  it drops the Human Genome Fragment
                                          (apexController.js:722)
Rival spawns 1.2s later               ->  it wants the Fragment too
pick the Fragment up                  ->  the extraction zone at (3, 3) activates
carry it into the zone (radius 1.5)   ->  run complete
```

You spawn at `(0, 0)`. The Apex arena is ~13.5 units away. **You can wander into the
game's boss fight within seconds of starting, by accident, with no warning.**

### 1.5 Systems that punish you without explaining themselves

| System | What happens | What you're told |
|---|---|---|
| **Burden** | Carrying more makes you up to **55% slower** (`BURDEN_CONFIG.minSpeedMultiplier: 0.45`) | A bar turns orange |
| **Metabolism** | Energy drains constantly; at zero you take **4 dmg/sec** | A red vignette appears |
| **Mutation timer** | Venom Rat lasts **45 seconds** and burns energy **50% faster** | It's on the reveal card, once |
| **Death** | You drop **60%** of your inventory and respawn somewhere random | Nothing |
| **Lake** | Slows you **35%** (`lakeBiome.js:1260`) | Nothing |
| **DNA is permanent** | Absorbing a DNA once unlocks that recipe ingredient forever (`mutationSystem.unlockedGenes`) | Nothing — this is a *generous* mechanic the player never learns to rely on |

### 1.6 A small existing inconsistency to fix while you're here

`gameFlowController.showOpeningObjective` is documented as *"Shown once per session, not
once per run — a player hitting Play Again does not need to be told the goal again."*

But `_updateReset()` sets `this._hasShownOpening = false;` (line 151, and note its odd
indentation — it looks like a later hand-edit). **So it does re-show on Play Again**, in
direct contradiction of its own comment. Decide which behaviour you want (Part 9, D3).

---

## Part 2 — Design rules for the tutorial

These are the rules the implementing session should not break.

1. **Teach by doing, never by reading.** Every beat asks the player to perform the action
   and completes when they actually perform it. No walls of text.
2. **One thing at a time.** Never two tutorial prompts on screen at once.
3. **Never block play.** Default presentation is a small non-blocking banner. Only
   *three* beats are allowed to pause the game (see 3.3).
4. **Trigger on context, not on a timer.** Teach the wheel when the player is heavy.
   Teach eating when they're hungry. Teach throwing when something is chasing them.
5. **Never repeat.** Once a beat is completed it never fires again — and that must
   survive closing the browser (there is currently *no persistence at all* in this
   codebase; see 4.5).
6. **Always skippable.** A returning player must be able to turn it off in one tap.
7. **Absorb the existing hints, don't compete with them.** `showLowEnergyHint` and
   `showHeavyHint` already teach two of these beats. If the tutorial also teaches them,
   the player gets told twice. The tutorial must take ownership of them (see 6.3).

---

## Part 3 — The tutorial script

This is the actual player-facing content, in order.

### 3.1 The three tiers

- **Tier 1 — The Core Loop.** Fires in the first ~60 seconds, in sequence. Cannot be
  skipped by wandering off. 3 beats.
- **Tier 2 — Contextual.** Fires only when the game makes it relevant. Order is not
  fixed. 7 beats.
- **Tier 3 — Story Beats.** Fires on the critical path. Partly exists already. 6 beats.

### 3.2 Beat table

`Trigger` = what starts it. `Done when` = what completes it and moves on.
Every hook named below is a real hook that exists today.

#### Tier 1 — Core Loop (sequential)

| # | Beat | Message (draft) | Trigger | Done when |
|---|---|---|---|---|
| 1 | **Move** | "Drag anywhere to move." | Run begins — `gameFlowController.onFirstRunBegun` | Player has travelled 3+ world units total |
| 2 | **Absorb** | "Roll over glowing things to absorb them." | Beat 1 done | `resourceManager.onAbsorbed` fires (already wired, `main.js:257`) |
| 3 | **Your body is your bag** | "What you absorb floats inside you. Tap the bag to inspect it." + pulse the `#inventory-toggle` button | 3 absorbs total | Player opens the bag (`inventoryUI` `onOpen`, `main.js:696`) |

#### Tier 2 — Contextual (fires when relevant)

| # | Beat | Message (draft) | Trigger | Done when |
|---|---|---|---|---|
| 4 | **Eat** | "Hungry? Tap a glowing item inside your body, then Consume." | `metabolismSystem` energy ratio < 0.6 **and** player holds ≥1 edible | An item is consumed (`metabolismSystem.notifyConsumed`) |
| 5 | **Weight slows you** | "The more you carry, the slower you get." | `burdenSystem.load >= 0.5` | Auto-dismiss after 4s |
| 6 | **Drop things** | "Too heavy. Press and hold on your body to open the wheel, then tap to drop." + pulse | `burdenSystem.onHeavyReached` (load ≥ 0.8, `main.js:318`) | An item is expelled, **or** load drops below 0.7 |
| 7 | **Throw** | "As a Slime you can throw rocks. Tap the throw button." | Player has ammo ≥1, is a Slime, and a hostile is within ~10 units | `projectileSystem.onFired` (`main.js:641`) |
| 8 | **Radar** | "Top-right: your radar. Pink is DNA, red is danger." | First time any ENEMY or BOSS blip appears | Auto-dismiss after 5s |
| 9 | **Mutate** | "You have the ingredients. Tap MUTATE." + pulse `#mutate-button` | `mutationSystem.onMutationAvailable(recipe, firstDiscovery=true)` (`main.js:359`) | `playerFormController.onTransformed` |
| 10 | **Rat abilities** | "Bites happen automatically when you're close and facing. Poison Expel works once per transformation." | Immediately after the existing mutation reveal card is dismissed | Auto-dismiss after 6s, or on first bite landing |
| 11 | **Mutation is temporary** | "You revert in 15 seconds — and DNA you've absorbed stays unlocked, so you can mutate again." | Mutation timer drops below 15s, first time | Form reverts |

#### Tier 3 — Story Beats (critical path)

| # | Beat | Message (draft) | Trigger | Done when |
|---|---|---|---|---|
| 12 | **The goal** | *Existing opening card* — extend it to name the chain: find the Apex, take what it drops, carry it to the beam. | `onFirstRunBegun` | Card dismissed |
| 13 | **Danger ahead** ⚠️ | "Something big lives here." — **fires BEFORE the encounter**, as a warning at the arena edge | Player within `arenaRadius + 8` of `apexArenaCenter` (a new, wider ring than the existing `+3` trigger) | Player leaves, or the encounter starts |
| 14 | **Apex fight** | "Murkmaw. Bites hurt. Keep moving." | `apexController.startEncounter()` | Auto-dismiss after 5s |
| 15 | **The Fragment** | "It dropped a Human Genome Fragment. Take it." | `genomeFragmentController.onExposed` (`main.js:427`) | `onPickup('player')` |
| 16 | **The Rival** | "You're not the only one who wants it." | `rivalController.onSpawned` (`main.js:421`) | Auto-dismiss after 4s |
| 17 | **Extract** | "Carry it to the beam of light to finish the run." + objective arrow already exists | `onPickup('player')` (`main.js:431`) | `onSecured` |
| 18 | **Death** | "You dropped some cargo where you died. Your radar is showing you where." | First `deathRespawnManager.onPlayerDeath` (`main.js:819`) | Auto-dismiss 5s after respawn |

### 3.3 The only three beats allowed to pause the game

Everything else is a non-blocking banner.

- Beat 12 (the goal) — already pauses, uses the existing `showInfoCard` + `REVEAL` state
- Beat 9 → 10 (the mutation reveal) — already pauses, existing card
- Beat 13 (danger ahead) — **recommended to pause**, because it is the one warning that
  prevents an accidental boss fight

---

## Part 4 — How it works (architecture)

### 4.1 One new module, data-driven

Create `js/tutorialController.js`, following the project's existing naming convention
(`*Controller.js` = owns behaviour / a state machine).

Two exports:

```
TUTORIAL_STEPS   — an array of plain data objects, one per beat. The script from Part 3.
TutorialController — the driver that walks the list.
```

**Why data-driven:** this matches how the codebase already keeps domain data in
single-source-of-truth modules (`RESOURCE_TYPES`, `MUTATION_RECIPES`, `GAME_STATES`).
Re-ordering or rewording a beat should never mean touching logic.

Each step is shaped roughly like:

```
{
  id: 'absorb',                  // stable, used as the persistence key
  tier: 1,
  requires: ['move'],            // step ids that must be done first (Tier 1 sequencing)
  trigger: (ctx) => boolean,     // polled each frame; or fired by an event (see 4.3)
  text: 'Roll over glowing things to absorb them.',
  highlight: '#inventory-toggle',// optional CSS selector to pulse
  pause: false,                  // true = use showInfoCard + REVEAL state instead
  done: (ctx) => boolean,        // polled each frame
  timeout: 4,                    // optional seconds -> auto-complete
}
```

`ctx` is a bag of live system references passed in at construction — the same
constructor-injection style every other controller here uses.

### 4.2 Where it ticks

In `main.js`'s `animate()`, **inside the `if (isPlayingState)` block**, after the
gameplay systems have updated so the step conditions read fresh state:

```
if (isPlayingState) {
    ...existing systems...
    deathRespawnManager.update(deltaTime);
    tutorialController.update(deltaTime);   // <- here, last
}
```

Use the scaled `deltaTime`, not `realDeltaTime` — tutorial timeouts are simulation, and
should freeze during a hitstop like everything else.

Putting it inside the gate means the tutorial automatically stops while the bag is open,
during the mutation reveal, on the title screen, and during the ending — for free. That
is the same trick `GAME_STATES.INVENTORY` already uses.

### 4.3 Two kinds of trigger

Some beats are naturally **events** (`onAbsorbed`, `onTransformed`, `onSpawned`), some are
naturally **conditions** (`load >= 0.5`, `energy < 0.6`).

Support both:

- **Conditions:** the `trigger(ctx)` / `done(ctx)` predicates, polled each `update()`.
- **Events:** a single `tutorialController.notify('event-name')` method that main.js calls
  from the existing hooks. Steps can declare `triggerEvent: 'absorbed'`.

**Do not** rewrite the existing hooks to belong to the tutorial. Chain onto them, the way
`main.js:707` already chains `mutationSystem.onRecipeChecked`:

```
const prev = resourceManager.onAbsorbed;
resourceManager.onAbsorbed = (...a) => { prev?.(...a); tutorialController.notify('absorbed'); };
```

### 4.4 Presentation — one new UI element

**Do not send tutorial prompts through `uiManager.showToast`.** See trap 7.2.

Add one new element to `index.html`, e.g. `#tutorial-coach`: a small, persistent,
non-blocking banner. It stays until the step completes, unlike toasts which expire.

Also add a reusable `.tutorial-pulse` CSS class that can be toggled onto any HUD button
to draw the eye (used by beats 3, 6, 9).

Give `UIManager` three thin methods, matching its existing style:

```
showCoach(text, { highlightSelector })   // show/replace the banner
hideCoach()
setTutorialPulse(selector, on)
```

For the three pausing beats, reuse the existing `gameFlowController.showReveal(card)` /
`showInfoCard` path rather than inventing a second modal.

> ⚠️ `CLAUDE.md` says **"Always use the design skill when changing the UI."** The banner,
> the pulse, and any style.css work must go through it. This is a hard project rule.

### 4.5 Persistence — there is none today

Confirmed: `grep -rn "localStorage\|sessionStorage\|indexedDB" js/ index.html` returns
**nothing**. This codebase has never persisted anything.

So the tutorial introduces the first persistence in the project. Keep it tiny:

```
key:   "hollowdrop.tutorial.v1"
value: JSON { completed: ["move","absorb",...], skipped: false }
```

**Wrap every read and write in try/catch.** Private browsing and blocked-cookie settings
make `localStorage` throw on access, not just return null — and this game is explicitly
targeted at phones. A storage failure must degrade to "tutorial runs again", never to a
crash.

Expose `window.__hollowdrop.resetTutorial()` for testing, alongside the existing
`resetGame()`.

### 4.6 Interaction with Play Again

`resetGame()` in `main.js` resets per-object state; `GameFlowController._updateReset()`
resets flow flags. The tutorial should **not** reset — a player who has seen it does not
need it again. Add nothing to `resetGame()`.

(This is also the moment to fix the `_hasShownOpening` inconsistency from 1.6.)

---

## Part 5 — Build order

Four phases. Each is independently shippable and testable — do not try to build all 18
beats at once.

### Phase 1 — Infrastructure (no beats yet)
- `js/tutorialController.js` with an empty `TUTORIAL_STEPS`
- `#tutorial-coach` element + `.tutorial-pulse` class (**via the design skill**)
- `uiManager.showCoach` / `hideCoach` / `setTutorialPulse`
- Tick it in `animate()`
- localStorage load/save with try/catch
- `window.__hollowdrop.resetTutorial()`
- **Test:** hardcode one fake step, confirm it appears, completes, and never returns after reload.

### Phase 2 — Tier 1 (beats 1–3)
The core loop. This alone fixes most of the "I don't know what to do" problem.
- **Test:** fresh profile → the three beats fire in order, then stop.

### Phase 3 — Tier 2 (beats 4–11)
The contextual beats. This is where beats 7 and 10 fix the invisible
form-swaps-your-abilities problem from 1.3.
- Take ownership of `showLowEnergyHint` and `showHeavyHint` here (see 6.3).
- **Test:** each beat individually, by forcing its condition from the console.

### Phase 4 — Tier 3 (beats 12–18)
Story beats. Mostly extending things that already exist.
- Beat 13 (the danger warning) needs a **new** wider trigger ring in
  `apexEncounterManager.js` — it currently only has the one at `arenaRadius + 3` that
  starts the fight. Add a second, larger radius that only warns.
- **Test:** play a full run start to finish.

---

## Part 6 — Files to touch

| File | Change | Size |
|---|---|---|
| `js/tutorialController.js` | **New.** Steps data + driver. | ~300 lines |
| `js/main.js` | Instantiate in the composition root; tick in `animate()`; chain the existing hooks in the `--- Guided moments ---` section (line 1013) | ~40 lines |
| `js/uiManager.js` | `showCoach` / `hideCoach` / `setTutorialPulse` | ~30 lines |
| `index.html` | `#tutorial-coach` element | ~5 lines |
| `style.css` | Coach banner + `.tutorial-pulse` (**design skill**) | ~60 lines |
| `js/apexEncounterManager.js` | Second, wider warning radius for beat 13 | ~15 lines |
| `js/gameFlowController.js` | Fix the `_hasShownOpening` reset (1.6) | 1 line |

### 6.3 Hints the tutorial must take over

These two already exist and will double up if ignored:

| Existing | Where | What to do |
|---|---|---|
| `uiManager.showLowEnergyHint()` | `main.js:287` via `onLowEnergyReached` | Becomes beat 4. Route through the tutorial; keep the old toast only as a fallback for players who skipped. |
| `uiManager.showHeavyHint(ammo)` | `main.js:318` via `onHeavyReached` | Becomes beat 6. Same treatment. Note it already has smart branching (throw vs wheel) — **keep that logic**, it is good. |

---

## Part 7 — Traps that will bite you

**7.1 — Don't put tutorial updates outside the `isPlayingState` gate.** If you tick it
unconditionally, coach text will keep advancing while the bag is open or during the
ending cutscene.

**7.2 — The notification queue silently drops messages.** `uiManager` caps the queue at
`NOTIFICATION_QUEUE_MAX = 4` and, when it overflows, **discards the oldest**:

```js
this._notificationQueue.splice(0, this._notificationQueue.length - NOTIFICATION_QUEUE_MAX);
```

In a busy moment (absorbing + going heavy + energy low + Rival arriving) a tutorial
message routed through this **will be thrown away**. The file's own comment admits
one-time hints are already being lost this way. This is exactly why the coach banner must
be its own element.

**7.3 — Two prompts at once.** Tier 2 beats are condition-triggered and several
conditions can go true on the same frame (heavy + hungry + rival). The driver must allow
**only one active step**, with the rest queued.

**7.4 — Don't teach a gesture that doesn't exist.** Swipe-to-expel was **removed**
(`inventoryInteraction.js` header). The heavy hint used to say "swipe an item out" and was
simply false. Dropping is now: long-press wheel, or the bag's Expel button. Verify any
control text against the code before shipping it.

**7.5 — Beat 7 (throw) can be unreachable.** Throwing needs ammo, which means carrying
stones — heavy, low-value items a player may never pick up. Make the trigger tolerant, or
accept that some players never see this beat.

**7.6 — Desktop vs phone wording.** The game is built for touch ("drag", "tap",
"press and hold") but is played on desktop too. Either use neutral wording, or branch on
`navigator.maxTouchPoints`. Pick one and be consistent.

**7.7 — Beat 13 must fire before beat 14.** The existing encounter trigger is
`arenaRadius + 3 = 12.5`. The warning ring must be meaningfully larger (suggest
`arenaRadius + 8 = 17.5`) or the player gets the warning and the fight in the same second.

**7.8 — There is a pre-existing camera bug that blocks automated testing.**
`main.js:116` — if the page loads at a 0×0 viewport, `aspect = 0/0 = NaN` →
`viewZoom = NaN` → `camera.position` is NaN forever (a later resize repairs `viewZoom`
but `updateCamera` only *lerps* position, and NaN is absorbing). The view renders black.
Not caused by the tutorial, but **fix it first** or in-browser verification is painful.
A `Number.isFinite` guard in `updateViewZoom` is enough.

---

## Part 8 — Test checklist

Run `python dev-server.py`, open `http://localhost:8080`.

1. **Fresh player:** `window.__hollowdrop.resetTutorial()`, reload. Beats 1→2→3 fire in
   order. Each completes only on the real action.
2. **Returning player:** reload again. **Nothing fires.**
3. **Skip:** tap Skip on beat 1. Nothing else ever fires. Reload — still nothing.
4. **Never two at once:** force heavy + low energy + rival simultaneously. Exactly one
   banner on screen; the others queue.
5. **Pause states:** open the bag mid-beat. The banner freezes, does not advance, and
   resumes on close.
6. **Play Again:** finish a run, hit Play Again. Tutorial does **not** restart.
7. **Storage blocked:** open in a private window with site data blocked. Game still
   loads and plays; tutorial simply runs every time. **No crash.**
8. **Full run:** start → absorb → mutate → Apex → Fragment → Rival → extract. Every Tier 3
   beat fires at the right moment and none blocks the ending.
9. **Phone over LAN:** the banner does not cover the joystick, the HUD, or the action
   buttons.
10. **Console clean** throughout (the `#error-overlay` in `index.html` will surface any
    thrown error directly on the page).

---

## Part 9 — Decisions for the human before building

| # | Decision | Recommendation |
|---|---|---|
| **D1** | 18 beats — too many? | Build Tier 1 + Tier 2 first (11 beats) and play it. Tier 3 mostly exists already. |
| **D2** | Should the tutorial be skippable from the title screen, or only from the first banner? | First banner is enough for v1. |
| **D3** | Should the opening goal card re-show on Play Again? | **No.** Fix `_hasShownOpening` (1.6) so it matches its own comment. |
| **D4** | Should beat 13 (danger warning) pause the game? | **Yes.** It is the one warning that prevents an accidental boss fight. |
| **D5** | Do you want a replayable tutorial (a "how to play" option), or one-and-done? | One-and-done for v1; `resetTutorial()` covers testing. |
| **D6** | Wording style — "Drag to move" vs a diegetic voice ("Your body remembers how to move") | The game's existing copy is atmospheric ("Absorb. Adapt. Survive."). Recommend keeping instructions plain and saving voice for the pausing cards. |

---

## Appendix — Complete mechanic inventory

Everything a player must eventually understand, with the source of truth for each.
Useful for checking nothing was missed.

| Mechanic | Numbers | Source |
|---|---|---|
| Move | drag, 90px to full speed, 12px dead zone | `inputController.js` |
| Absorb | roll over resources | `resourceManager.js` |
| Weight | up to 55% slower, 35% less acceleration | `burdenSystem.js` `BURDEN_CONFIG` |
| Heavy threshold | 80% load | `BURDEN_CONFIG.heavyThreshold` |
| Energy | 100 max, 0.35/sec drain (~4.75 min) | `metabolismSystem.js` |
| Starvation | 4 dmg/sec at zero energy | `METABOLISM_CONFIG` |
| Eat | tap item inside body → Consume | `inventoryInteraction.js` |
| Drop | long-press body 420ms → wheel | `inventoryWheel.js` `WHEEL_CONFIG` |
| Bag | `#inventory-toggle`; **pauses the game** | `inventoryUI.js`, `GAME_STATES.INVENTORY` |
| Throw | **Slime only**; rocks as ammo | `projectileSystem.js`, gated in `animate()` |
| Bite | **Rat only**, automatic, 15 dmg, 0.6s cd | `VENOM_BITE_CONFIG` |
| Poison Expel | **once per transformation**, 35 dmg, 4.8 radius | `POISON_EXPEL_CONFIG` |
| Mutation recipe | 1 Rat DNA + 1 Toxic Spore + 1 Moon Mushroom | `MUTATION_RECIPES.venomRat` |
| Mutation duration | 45s | `FORM_CONFIG.venomRat.mutationDuration` |
| Rat form stats | ×1.25 speed, ×1.15 acceleration, ×1.5 damage, ×1.5 energy burn | `FORM_CONFIG.venomRat` |
| DNA permanence | absorbed DNA satisfies recipes for the whole run | `mutationSystem.unlockedGenes` |
| Radar | 20u normal, 35u boss/genome, 30u rival | `RADAR_CONFIG` |
| Apex trigger | within 12.5u of (-10, -9) | `apexEncounterManager`, `APEX_CONFIG.arenaRadius: 9.5` |
| Fragment source | dropped by the Apex on defeat | `apexController.js:722` |
| Rival | spawns 1.2s after the Fragment is exposed | `RIVAL_CONFIG.spawnDelay` |
| Extraction | (3, 3), radius 1.5, active only while you carry | `fragmentContestManager.js` |
| Death | drops 60% of inventory, random respawn, radar beacon | `DEATH_CONFIG` |
| Lake | 35% slow | `lakeBiome.js:1260` |
| Locked forms | Ember Lizard, Unknown Strain (not implemented) | `LOCKED_MUTATIONS` |
