# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hollowdrop: The Living Colony is a browser game built as **vanilla ES modules + Three.js**, with **no build step, no bundler, no npm, and no tests**. Source files are served as-is to the browser. Three.js and its loaders come from a CDN via the importmap in `index.html`; there are no local `node_modules`.

## Running

```bash
python dev-server.py        # serves the repo root on http://0.0.0.0:8080
```

Use this server (not `python -m http.server`) for two reasons baked into `dev-server.py`:
- It sends aggressive `no-store` cache headers so a plain refresh — including on a phone over LAN — always picks up edited JS/CSS. No hard-refresh needed.
- It is threaded, so the FBX character models (each = one multi-MB mesh + 4 textures fetched together via `Promise.all`) transfer in parallel instead of serializing.

There is no lint/test/build command. "Testing" a change means loading the page and playing; on-page errors surface via the `#error-overlay` catcher wired in `index.html` (thrown errors and unhandled rejections print directly onto the page, since mobile devtools aren't always available).

## Architecture

### Everything is wired in `js/main.js`
`main.js` (~1100 lines) is the composition root. It creates the Three.js scene/camera/renderer/lights, instantiates every controller and system (~30 of them), wires their dependencies by constructor injection, and runs the **single `animate()` requestAnimationFrame loop**. There is no framework and no event bus for the core loop — update order in `animate()` is explicit and load-bearing. When adding a system, instantiate it in `main.js` and call its `.update(deltaTime)` at the correct point in that loop.

### The one gate that matters: game-flow state
`gameFlowController.state === GAME_STATES.PLAYING` is the single top-level switch for "is the simulation running." TITLE / MEMORY / REVEAL / RUN_COMPLETE / RESETTING states **freeze** gameplay in place (AI, physics, timers simply aren't ticked) — nothing is deleted or rebuilt — while the renderer, camera, and UI keep running. `resetGame()` in `main.js` (not in the flow controller) performs the actual per-object reset for "Play Again". Respect this gate: gameplay updates belong inside the `if (isPlayingState)` block in `animate()`.

### Module naming convention
- `*Controller.js` — owns behavior / AI / a subsystem's state machine (e.g. `predatorController`, `rivalController`, `apexController`, `playerFormController`).
- `*System.js` / `*Manager.js` — per-frame rules or a collection of entities (`metabolismSystem`, `burdenSystem`, `resourceManager`, `preyManager`, `inventoryManager`).
- `*Model.js` / `create*Mesh` / `create*Visual` — pure Three.js mesh/material construction, no game logic (`ratModel`, `predatorModel`, `playerSlimeModel`, `resourceModels`).

### Domain data lives in dedicated single-source-of-truth modules
Change these, not scattered literals: `resourceTypes.js` (`RESOURCE_TYPES` — weight/value/color/edible/energy), `mutationSystem.js` (`MUTATION_RECIPES`), `playerFormController.js` (`PLAYER_FORMS`: SLIME / VENOM_RAT, plus `MUTATION_CONFIG`), `gameFlowController.js` (`GAME_STATES`).

### Frame-loop conventions (follow these — they prevent real bugs)
- **Recompute derived values fresh every frame** from `base × form × burden`; never multiply onto a running total. Movement speed, acceleration, and metabolism multipliers all do this so repeated mutate/revert cycles can't stack. See `animate()` around the `movementSpeedMultiplier` assignments.
- **Two deltas.** `deltaTime` is the scaled simulation delta (affected by hitstop freeze); `realDeltaTime` is wall-clock. Things that must keep animating *through* a hitstop — screen shake, damage numbers, the amoeba membrane shader, the hitstop timer itself — run on `realDeltaTime`. Everything simulation runs on `deltaTime`. `deltaTime` is clamped to 0.05 to avoid a spiral-of-death after a tab switch.
- **Collision is resolved immediately after integration**, before anything reads the new position (`collisionSystem.resolve(...)` right after `playerController.update`), so camera follow / attraction / combat never see the player inside a rock.

### Player visual: the amoeba/slime shader system
The player and NPC slimes share a deforming-membrane shader in `slimeCreature.js`. NPC slimes register themselves and are all ticked by one `updateSlimeCreatures(realDeltaTime)` sweep; creatures removed from the scene drop from the registry automatically. The player's own body (`amoeba`) is updated separately with speed/load/gaze inputs.

### Model loading and `index.html` `<head>` ordering
**Authoring a NEW animated asset?** Read `ASSET_PIPELINE.md` first — the Blender side (rig conventions, Blender 5.x API traps, export flags, texture optimisation, and how to verify a clip actually plays) is documented there rather than here. This section covers only how a finished asset is consumed at runtime.

Two loaders, split by whether the asset is rigged — they are not interchangeable:
- `fbxCharacterLoader.js` — the **un-rigged** single-mesh FBX characters (`models/plague_sludge_rat/` = the boss, `models/jellybean_slime/`). Measures the bounding box, rescales to `targetRadius`, and recentres by writing `.position` on the loaded root.
- `gltfCharacterLoader.js` — the **rigged** GLB (`models/rat_walk.glb` = the player's Venom Rat: 181 deform bones + a baked `Walk` clip). Never writes a transform on `gltf.scene`, because on a rigged model that root IS the armature the clip animates; scale/facing/centering all go on a wrapper `Group` above it. Returns an `AnimationMixer` alongside the group and material.

Both build **one** `MeshStandardMaterial` per character from the texture maps, because several controllers drive `.emissive`/`.emissiveIntensity` on it every frame.

The `<head>` in `index.html` is order-sensitive and commented as such: the **importmap must precede the `modulepreload` hints**, because both loaders resolve the bare `three` specifier and their own import chains (FBXLoader → fflate, NURBSCurve → NURBSUtils; GLTFLoader → BufferGeometryUtils) are preloaded to fetch every CDN hop in parallel rather than discovering them one at a time. If you touch that `<head>`, preserve the ordering and the preload chain.

### The occlusion outline and skinned meshes
`attachOcclusionOutline` (`occlusionOutline.js`) builds a **second mesh sharing the target's geometry**. On a rigged character that copy must be a `SkinnedMesh` bound to the same `Skeleton` — as a plain `Mesh` it hangs in bind pose while the real body animates away from it. The file handles this automatically (`options.skinned` selects a skinning vertex shader), but it is the thing to check first if a new rigged model's highlight looks wrong.

## Debugging

- Every gameplay module exports a `DEBUG_*` boolean const (e.g. `DEBUG_APEX`, `DEBUG_PREY`, `DEBUG_MUTATION`, `DEBUG_RIVAL`), all `false` by default. Flip one to `true` at its source to enable that subsystem's verbose logging / debug visuals.
- `window.__hollowdrop` (set in `main.js`) exposes the live player, camera, and every controller/manager for devtools console inspection, plus `resetGame()`.

## Conventions worth matching
The codebase carries unusually detailed *why* comments explaining non-obvious decisions (tone mapping choice, cache headers, threading, delta scaling, `<head>` ordering). When you change one of these load-bearing details, update or preserve the explaining comment rather than dropping it.
- Always use the design skill when changing the UI

After completing a task that involves tool use , provide a quick summary of the work you've done.

<do_not_act_before_instructions>
Do not jump into implementation or change files unless clearly instructed to make changed. When the user's intent is ambiguous, default to providing information, doing research, and providing recommendations rather than taking action. Only proceed with edits, modifications, or implementations when the user explicitly requests them.
</do_not_act_before_instructions>

<use_parallel_tool_calls>
If you intend to call multiple tools and there are no dependencies
between the tool calls, make all of the independent tool calls in
parallel. Prioritize calling tools simultaneously whenever the
actions can be done in parallel rather than sequentially. For
example, when reading 3 files, run 3 tool calls in parallel to read
all 3 files into context at the same time. Maximize use of parallel
tool calls where possible to increase speed and efficiency.
However, if some tool calls depend on previous calls to inform
dependent values like the parameters, do not call these tools in
parallel and instead call them sequentially. Never use placeholders
or guess missing parameters in tool calls.
</use_parallel_tool_calls>

<investigate_before_answering>
Never speculate about code you have not opened. If the user
references a specific file, you MUST read the file before
answering. Make sure to investigate and read relevant files BEFORE
answering questions about the codebase. Never make any claims about
code before investigating unless you are certain of the correct
answer - give grounded and hallucination-free answers.
</investigate_before_answering>