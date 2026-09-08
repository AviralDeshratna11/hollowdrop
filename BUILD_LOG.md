# Hollowdrop: The Living Colony — Build Log

This document records the development of **Hollowdrop: The Living Colony** from the
initial prototype through the current repository state. It is based on the Git history
and the implementation present at commit `9db7aa6` (September 5, 2026).

## Project snapshot

- **Type:** Browser-based 3D survival/action game
- **Stack:** Vanilla JavaScript ES modules, Three.js, HTML, and CSS
- **Build tooling:** None; source files are served directly to the browser
- **Runtime dependency:** Three.js `0.160.0`, loaded from jsDelivr through the import map
- **Local server:** `python dev-server.py`
- **Development period covered:** August 22–September 5, 2026
- **Repository history covered:** 84 commits
- **Current composition:** 61 JavaScript modules plus game models, textures, fonts, and UI art
- **Automated tests:** None; changes are verified by loading and playing the game

## Running the current build

From the repository root:

```bash
python dev-server.py
```

Then open `http://localhost:8080`. The custom server uses threaded requests and disables
browser caching so large game assets load concurrently and edited files appear after a
normal refresh. Runtime errors and unhandled promise rejections are also displayed in the
in-game error overlay, which is especially useful when testing on mobile devices.

## Development timeline

### August 22 — Initial playable prototype

The project began with the core Hollowdrop game loop and the first complete browser
prototype. The initial build established the Three.js scene, player movement, collection
systems, hostile creatures, mutation mechanics, and the broader "absorb, adapt, survive"
concept.

The original player visual was soon replaced with a Rimuru-inspired slime model, with
additional deformation and movement work to give the character a soft, jelly-like feel.

### August 25 — Visual and interaction overhaul

The first major visual pass introduced a unified slime-creature system shared by the
player and non-player slimes. Collision behavior and guided UI elements were integrated,
and the Murkmaw boss health was restored from a temporary value of 30 to its intended 180.

The Cave Stalker also received a clearer visual identity through cartoon eyes, improved
scale, and corrected face billboarding.

### August 26–27 — Character assets and inventory dropping

Meshy-generated player and rat FBX models were added and adapted to the game's jelly
shader treatment. The inventory system gained item dropping, laying the foundation for
mass management and later inventory interactions.

### August 28 — Radar and inventory UI

This phase added the Species-Seeker radar and significantly expanded the player-facing UI:

- Radar tracking for threats and important targets
- An organic vine frame, boss badge, and lock-on beam
- A functional Bag/Inventory panel with quantities and item details
- Consume and Expel actions
- Generated inventory artwork wired into the live interface
- Layout fixes for panel overlap and mass-bar presentation
- A pure-CSS inventory panel rebuild
- A fix for icon HTML injection
- Fixes for title-screen loading and player visibility after respawn

### August 29 — Ranged combat and mobile controls

Carried rocks became useful ammunition through a Slime-only ranged attack. Resource
locations were added to the radar, and the radar itself received scaling and outlier
cleanup. A visible floating joystick was added without changing the underlying
drag-to-move control scheme.

Several fixes addressed a recurring issue where the slime could disappear after death.
The first generated cave-floor art was also introduced and iterated toward a darker,
cooler palette.

### August 30 — Projectile targeting

Thrown rocks gained sticky auto-aim and intercept leading, allowing shots to account for
a moving target rather than aiming only at its current position.

### August 31 — Terrain and environment expansion

The world moved beyond a flat arena with a substantial environment pass:

- 3D terrain elevation
- Harvestable stone clusters
- Canopy trees and procedural world dressing
- Occlusion outlines for objects hidden behind scenery
- Terrain-aware projectile and radar behavior
- Boundary collision and bounce behavior
- Camera framing adjustments for portrait phones

Ground-texture scale and tiling were repeatedly tuned so the visible play area matched the
artwork and avoided obvious seams. The project's major controllers, visuals, and camera
systems were also consolidated into the main runtime composition.

### September 1 — Death loop, HUD, and mutation form

A Minecraft-style death system was implemented: death can drop part of the player's
inventory, followed by respawning and recovery. The Health, Energy, and Mass display was
redesigned as a unified HUD panel with a player portrait and stacked bars.

The compact radar legend was removed to simplify the display, and the Venom Rat player
form was updated to use the cute purple rat presentation. Terrain UV and scale-ratio fixes
continued during this pass.

### September 2 — Combat feedback and loading experience

The rat attack behavior was changed and inventory items gained occlusion handling. An
asset-progress loading screen was then integrated into the title screen so large model and
texture downloads have visible progress instead of appearing as a hang.

The rat, boss, and boundary visuals were updated together as part of the same gameplay
presentation pass.

### September 3 — Biomes and skeletal animation

A lake biome was added with its own terrain and slowdown behavior. The player's Venom Rat
received a real skeletal walk cycle, including logic that stops the leg animation while
the player is idle.

The Blender-to-GLB workflow was documented in `ASSET_PIPELINE.md`, and two reusable tools
were added:

- `tools/glb_inspect.py` for animation, root-motion, bone-name, stride, and file-size checks
- `tools/glb_optimize.py` for texture and skin-weight optimization with validation

### September 4 — Tutorial, GLB migration, and asset optimization

The in-game tutorial was first designed in `TUTORIAL_PLAN.md`, then Tier 1 and Tier 2
teaching beats were implemented through `TutorialController`. The tutorial teaches core
movement and absorption as well as contextual systems such as eating, burden, dropping,
throwing, radar use, mutation, and form-specific abilities.

Character animation and loading received a major upgrade:

- The boss gained a skeletal walk cycle
- The player slime moved from FBX to GLB
- The unused FBX loader chain was retired from page startup
- Module preloads were added for the GLTFLoader dependency chain
- Animated skinned-mesh occlusion outlines were supported
- Tail deformation was retuned for the replacement mesh
- A combined animation, tutorial, and asset pass reduced the project by 22.6 MB

Ground rendering went through several experiments—single-map art, finer textures,
hand-assembled mosaics, mirrored tiles, and reverts—before landing on a stitched,
high-detail atlas approach. A temporary deletion of model assets was reverted after it
broke loading, preserving the working game content.

### September 5 — Interaction refinement and biome art

Automatic resource pickup was replaced with a deliberate **Inspect → Acquire** flow,
giving players control over what enters their limited inventory. Health regeneration was
implemented.

The cave floor was finalized as nine hand-painted biome regions packed into a continuous
terrain atlas, paired with a semantic height map. The radar received a final cleanup that
removed extra surrounding decoration.

## Current gameplay build

The current version supports the following end-to-end loop:

1. Move through the cave using drag/swipe controls and the visual joystick.
2. Inspect and acquire resources from the world.
3. Manage health, energy, and carrying mass.
4. Consume edible inventory items, expel unwanted cargo, or throw rocks as projectiles.
5. Permanently unlock DNA ingredients and temporarily mutate into the Venom Rat form.
6. Fight prey, predators, the Murkmaw Apex, and a rival slime.
7. Obtain the Human Genome Fragment and carry it to extraction to complete the run.
8. Recover from death and replay through the title, memory, reveal, completion, and reset
   states.

The game also includes terrain elevation, multiple visual biomes, a lake, harvestable
stone, procedural cave dressing, radar tracking, objective indicators, damage numbers,
combat effects, screen shake, loading progress, and an in-game tutorial.

## Architecture reached by this build

`js/main.js` is the composition root. It creates the Three.js renderer and world,
constructs the game's controllers and systems, connects their callbacks, and updates them
in a single ordered `requestAnimationFrame` loop.

The runtime uses `GameFlowController` as the top-level simulation gate. Gameplay updates
run only in the `PLAYING` state; title, memory, reveal, completion, and reset states keep
rendering active while freezing the simulation.

Modules generally follow these roles:

- `*Controller.js` owns behavior or a subsystem state machine.
- `*System.js` and `*Manager.js` implement per-frame rules or entity collections.
- `*Model.js` and mesh/visual factories build Three.js presentation objects.
- Dedicated data modules hold shared definitions such as resource types, mutation recipes,
  player forms, and game-flow states.

The player, Venom Rat, and boss now use GLB assets through the rig-aware character loader.
Animated materials, deformation, model mixers, terrain following, and occlusion effects are
updated within the same frame loop.

## Build and verification notes

There is no compilation, bundling, linting, or automated test suite. A release check is a
manual browser playthrough. At minimum, verify:

- The loading screen reaches the title screen without an error overlay.
- Movement and camera follow work on desktop and portrait/mobile layouts.
- Inspect/Acquire, Consume, Expel, and inventory mass updates work.
- Slime projectiles acquire targets and follow terrain.
- Mutation swaps the player model and abilities, plays the walk cycle, and reverts cleanly.
- Death, dropped cargo, respawn, and player visibility work across repeated deaths.
- Radar markers, boss encounter, fragment contest, extraction, and replay complete.
- The tutorial does not block normal input and does not repeat completed lessons.
- Terrain elevation aligns with the biome atlas, lake, props, entities, and projectiles.

For new animated assets, run:

```bash
python tools/glb_inspect.py models/new-model.glb
python tools/glb_optimize.py models/raw.glb models/optimized.glb
```

Then visually validate the optimized model and its clips before integrating it into the
game.

## Known constraints and follow-up work

- The tutorial design document contains additional Tier 3 story beats and design decisions;
  its planning text should be reconciled with the already implemented Tier 1 and Tier 2
  controller before further tutorial work.
- The game depends on CDN availability for Three.js, GLTFLoader, and the title font.
- The main loop's update order is load-bearing and should be changed cautiously.
- Mobile performance remains important because the world uses detailed terrain and animated
  character assets.
- Automated smoke tests or a repeatable manual release checklist would reduce regressions in
  death/respawn, mutation, loading, and end-of-run state transitions.

## Related documentation

- `CLAUDE.md` — runtime architecture, conventions, and development guidance
- `ASSET_PIPELINE.md` — Blender-to-GLB authoring, optimization, and verification workflow
- `TUTORIAL_PLAN.md` — tutorial rationale, scripted teaching beats, and implementation plan
