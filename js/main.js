import * as THREE from 'three';
import { InputController } from './inputController.js';
import { PlayerController, PLAYER_MAX_SPEED } from './playerController.js';
import { InventoryManager, MAX_WEIGHT } from './inventoryManager.js';
import { ResourceManager } from './resourceManager.js';
import { UIManager } from './uiManager.js';
import { InventoryUI } from './inventoryUI.js';
import { InventoryInteractionController } from './inventoryInteraction.js';
import { InventoryWheelController } from './inventoryWheel.js';
import { BurdenSystem } from './burdenSystem.js';
import { PlayerHealthState, DEBUG_HEALTH } from './playerHealth.js';
import { PredatorController, DEBUG_PREDATOR_COMBAT } from './predatorController.js';
import { DeathRespawnManager } from './deathRespawnManager.js';
import { MetabolismSystem, DEBUG_METABOLISM } from './metabolismSystem.js';
import { MutationSystem, DEBUG_MUTATION, MUTATION_RECIPES } from './mutationSystem.js';
import { PlayerFormController, MUTATION_CONFIG, PLAYER_FORMS, DEBUG_MUTATION_TIMER } from './playerFormController.js';
import { createRatMesh } from './ratModel.js';
import { createPlayerSlimeVisual } from './playerSlimeModel.js';
import { PreyManager, DEBUG_PREY } from './preyManager.js';
import { PlayerCombatController, DEBUG_COMBAT } from './playerCombatController.js';
import { ApexController, DEBUG_APEX, APEX_CONFIG } from './apexController.js';
import { ApexEncounterManager } from './apexEncounterManager.js';
import { GenomeFragmentController, FRAGMENT_STATES } from './genomeFragmentController.js';
import { RivalController, DEBUG_RIVAL } from './rivalController.js';
import { FragmentContestManager, DEBUG_FRAGMENT_CONTEST } from './fragmentContestManager.js';
import { ObjectiveIndicatorController } from './objectiveIndicator.js';
import { createRunStats } from './runStats.js';
import { MemorySequenceController } from './memorySequenceController.js';
import { RunCompleteController } from './runCompleteController.js';
import { GameFlowController, GAME_STATES } from './gameFlowController.js';
import { scatterWorldDressing, rockColliderRadius } from './worldDressing.js';
import { CollisionSystem } from './collision.js';
import { updateSlimeCreatures } from './slimeCreature.js';
import { ScreenShake } from './screenShake.js';
import { DamageNumberController } from './damageNumbers.js';

const canvas = document.getElementById('game-canvas');

// --- Scene / Camera / Renderer -------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1410);
scene.fog = new THREE.Fog(0x0a1410, 18, 55);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
const CAMERA_OFFSET = new THREE.Vector3(0, 11, 7); // top-down / slightly angled
const CAMERA_FOLLOW_SMOOTHING = 3.5; // lower = laggier camera, doesn't affect player physics
camera.position.copy(CAMERA_OFFSET);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

// Tone mapping: this game is built almost entirely on emissive glow (35 of its ~57
// materials set `emissive`), and a lot of that glow is ANIMATED past 1.0 at runtime -
// the Fragment's secure flash ramps emissiveIntensity to 4, the Apex's core gland to
// 2.6, prey hit-flashes to 2.8. With the default NoToneMapping every one of those
// values simply clamps to flat white, so the animation is computed and then thrown
// away. ACES Filmic rolls the >1 range off on a curve instead, which is what makes
// those ramps actually readable (and keeps their hue instead of blowing out to white).
// Nothing here depends on post-processing - this is the plain forward renderer.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// ACES darkens midtones relative to no tone mapping at all, so exposure and the two
// light intensities below are lifted together to compensate. These three numbers are
// the tuning knobs for overall scene brightness - adjust them as a group, not singly.
renderer.toneMappingExposure = 1.45;

// --- Lighting --------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x88ccaa, 0.85));
const dirLight = new THREE.DirectionalLight(0xbfffe0, 1.35);
dirLight.position.set(6, 14, 4);
scene.add(dirLight);

// Rim/back light. Every creature in this game is deliberately near-black (the Cave
// Stalker's body is 0x1e1626, the Fire Lizard's 0x1c0e0a) against a near-black
// background, so lit from the key light alone they read as silhouette-less blobs -
// you lose track of the predator that's chasing you. This sits low and roughly
// opposite the key, in a cool violet that the warm-green key never produces, so it
// catches the top/back edge of a body and separates it from the floor behind it.
// Low intensity on purpose: it should define an edge, not look like a second sun.
const rimLight = new THREE.DirectionalLight(0x7d8cff, 0.75);
rimLight.position.set(-8, 5, -9);
scene.add(rimLight);

// --- Ground ----------------------------------------------------------------
// This surface has to do the job the old debug GridHelper was doing: give movement a
// visible reference. A flat single-colour plane reads as "standing still" no matter
// how fast you actually travel, which is the only reason a wireframe grid was
// acceptable here in the first place. Instead the plane carries per-vertex colour
// mottling - broad patches for large-scale travel, finer break-up so nearby motion
// still registers - which reads as cave floor rather than as debug scaffolding.
const GROUND_SIZE = 200;
// 240 segments = 0.83 world units between vertices. The high-frequency octave below
// has a ~2.4-unit wavelength, so this has to stay dense enough to actually represent
// it - at the more obvious 120 the fine detail aliases away and the floor goes back to
// looking flat while you move over it.
const GROUND_SEGMENTS = 240;

/** Deterministic (no Math.random) smooth value field in roughly -1..1, summed from
 *  five octaves. Deliberately not noise-library-grade - it only has to break up a flat
 *  colour convincingly. The octave spread is the point: the broad ones give long-range
 *  travel something to read against, and the last two sit at roughly 2-5 world units
 *  so there's still visible texture passing under you at close range (this is the job
 *  the old GridHelper was doing). Staying deterministic means the cave looks identical
 *  on every load rather than reshuffling itself on each refresh. */
function groundMottle(x, z) {
  return (
    Math.sin(x * 0.08) * Math.cos(z * 0.11) * 0.45 +
    Math.sin(x * 0.23 + 1.7) * Math.cos(z * 0.19 - 0.9) * 0.25 +
    Math.sin(x * 0.55 - 2.3) * Math.cos(z * 0.47 + 2.1) * 0.15 +
    Math.sin(x * 1.3 + 0.6) * Math.cos(z * 1.17 + 3.1) * 0.1 +
    Math.sin(x * 2.6 - 1.1) * Math.cos(z * 2.43 - 2.6) * 0.05
  );
}

const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEGMENTS, GROUND_SEGMENTS);
const groundPositions = groundGeometry.attributes.position;
const groundColorLow = new THREE.Color(0x0c1912);
const groundColorHigh = new THREE.Color(0x24402e);
const groundColorScratch = new THREE.Color();
const groundColorArray = new Float32Array(groundPositions.count * 3);
for (let i = 0; i < groundPositions.count; i++) {
  // The plane is authored in XY and rotated flat below, so its local Y is world Z.
  const t = THREE.MathUtils.clamp(groundMottle(groundPositions.getX(i), groundPositions.getY(i)) * 0.5 + 0.5, 0, 1);
  groundColorScratch.copy(groundColorLow).lerp(groundColorHigh, t);
  groundColorArray[i * 3] = groundColorScratch.r;
  groundColorArray[i * 3 + 1] = groundColorScratch.g;
  groundColorArray[i * 3 + 2] = groundColorScratch.b;
}
groundGeometry.setAttribute('color', new THREE.BufferAttribute(groundColorArray, 3));

const ground = new THREE.Mesh(
  groundGeometry,
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- Player root + swappable visuals -----------------------------------------
// `player` is the ROOT: position/camera/predator/knockback all target it, and it
// never gets replaced. Exactly one of its two visual children is shown at a time -
// see PlayerFormController. Both visuals sit at local (0,0,0) (root already carries
// the height offset), so switching forms never touches player.position.
const PLAYER_RADIUS = 0.6;
// The one canonical spawn point (spec section 60) - both a death respawn AND a
// brand-new run (Play Again) return the player here, never wherever they happen to
// be standing. Declared here with the player root (rather than down with
// DeathRespawnManager, which is its main consumer) because the world dressing built
// further down needs it to know which area to leave undecorated.
const PLAYER_SPAWN_POSITION = new THREE.Vector3(0, PLAYER_RADIUS, 0);
const player = new THREE.Group();
player.position.copy(PLAYER_SPAWN_POSITION);
scene.add(player);

// Slime form visual - a wrapper Group (not a bare Mesh) so what's inside it can change
// without anything that references slimeVisual having to care; PlayerFormController
// only ever touches .visible/.scale, both plain Object3D properties.
//
// The amoeba is built synchronously - it's generated geometry plus a shader, with no
// asset to fetch. That removes the placeholder-sphere-then-hot-swap sequence this file
// used to run for the imported model, along with having to re-point
// playerFormController.slimeMaterial and playerController.setActiveMaterial() partway
// through a live session.
const slimeVisual = new THREE.Group();
player.add(slimeVisual);

const amoeba = createPlayerSlimeVisual(PLAYER_RADIUS);
const slimeMaterial = amoeba.bodyMaterial;
slimeVisual.add(amoeba.group);

const ratVisual = createRatMesh();
const ratMaterial = ratVisual.userData.bodyMaterial;
ratVisual.visible = false;
player.add(ratVisual);

// Living Inventory: collected resources are parented here, so they inherit
// Hollowdrop's position/rotation automatically - no manual per-frame sync.
// Hidden (not destroyed) while transformed - see PlayerFormController.
const inventoryContainer = new THREE.Group();
player.add(inventoryContainer);

// Where a carried Human Genome Fragment attaches while the Player holds it -
// same "parent to a small anchor Group" technique as inventoryContainer, kept
// separate since a carried Fragment must stay visible/attached even mid-mutation
// (unlike inventoryContainer, which PlayerFormController hides while transformed).
const fragmentCarryAnchor = new THREE.Group();
fragmentCarryAnchor.position.set(0, 0.55, 0.4);
player.add(fragmentCarryAnchor);

// --- Input / Movement --------------------------------------------------------
const inputController = new InputController(canvas, { deadZone: 12, maxDistance: 90 });
const playerController = new PlayerController(player, slimeMaterial);

// iOS Safari pinch-zoom guard (touch-action:none handles most, this covers gesture events).
document.addEventListener('gesturestart', (e) => e.preventDefault());

// --- Pointer tracking for eye gaze ---------------------------------------------
// Separate from InputController on purpose: that one only records pointer position
// WHILE dragging (its _onPointerMove early-returns unless isDragging), because it only
// cares about movement swipes. Gaze needs the position whenever the pointer exists at
// all, including plain desktop hover with no button held.
const pointerScreen = { x: 0, y: 0, seen: false };
canvas.addEventListener('pointermove', (e) => {
  pointerScreen.x = e.clientX;
  pointerScreen.y = e.clientY;
  pointerScreen.seen = true;
}, { passive: true });
// A finger leaving the glass is not "looking somewhere else" - it is no information at
// all, so the gaze falls back to the direction of travel rather than freezing.
canvas.addEventListener('pointerleave', () => { pointerScreen.seen = false; }, { passive: true });

// --- Resources / Inventory / UI -----------------------------------------------
const uiManager = new UIManager();
const inventoryManager = new InventoryManager(inventoryContainer, { maxWeight: MAX_WEIGHT });

// Run statistics (spec section 22-23) - a plain data object other systems report
// into via optional hooks (onDefeated/onSpawned/onAbsorbed/onPlayerDeath, wired
// below as each relevant controller is constructed) rather than counted separately.
const runStats = createRunStats();

// Mutation recipe/data logic - created early since ResourceManager needs it to notify
// on every absorb. Its UI callbacks are wired below, once PlayerFormController exists.
const mutationSystem = new MutationSystem(inventoryManager);

const resourceManager = new ResourceManager(scene, inventoryManager, uiManager, playerController, mutationSystem);
resourceManager.onAbsorbed = () => runStats.resourcesAbsorbed++;

/** The world's starting resource scatter (spec section 38: "clear old -> spawn new",
 *  never stacked on top of what's already there) - factored out so both the initial
 *  load and the Play Again reset pipeline (see resetGame() below) populate the exact
 *  same layout from one place. */
function populateWorldResources() {
  // Kill-exclusive resources are excluded from ambient scatter - they should only ever
  // come from the corresponding kill (see PreyManager._dropLoot / PredatorController's
  // _dropLoot), never lying around unearned.
  resourceManager.spawnTestZone(player.position, 4, {
    minRadius: 3,
    maxRadius: 15,
    excludeTypes: ['rat_dna', 'beetle_dna', 'predator_dna', 'toxic_gland', 'apex_dna', 'rival_dna'],
  });

  // A few Iron Ore placed along the path toward the predator's territory (section 39 of
  // the predator spec): encourages "collect the valuable heavy stuff, wander into danger".
  for (const [x, z] of [[4, 3], [6, 5], [8, 6.5]]) {
    resourceManager.spawnResource('iron', new THREE.Vector3(x, 0.2, z));
  }

  // Exactly one Rat DNA pickup, placed beyond the immediate safe spawn area (not
  // stacked with the predator's territory - a distinct direction to explore toward).
  resourceManager.spawnResource('rat_dna', new THREE.Vector3(-10, 0.2, 6));
}
populateWorldResources();

uiManager.updateMassUI(inventoryManager.getInventoryWeight(), inventoryManager.maxWeight);

// --- Health / Metabolism --------------------------------------------------------
const playerHealth = new PlayerHealthState(playerController, uiManager);

// Continuous energy drain + consuming edible Living Inventory items to restore it.
// Starvation (energy = 0) damages health through takeEnvironmentalDamage(), the
// non-combat path, so it never interacts with predator-hit invulnerability.
const metabolismSystem = new MetabolismSystem(playerController, playerHealth, uiManager, {
  onLowEnergyReached: () => uiManager.showLowEnergyHint(),
});

// Tapping an item visible inside Hollowdrop brings up Consume (edible items only) -
// claims the pointer via inputController's gesture guard before movement can start on
// the same touch. Swipe-to-expel used to live here too and was removed, which leaves
// the outward drag on the body free for other gestures.
const inventoryInteraction = new InventoryInteractionController({
  canvas,
  camera,
  player,
  inventoryManager,
  resourceManager,
  uiManager,
  playerController,
  metabolismSystem,
  mutationSystem,
  playerRadius: PLAYER_RADIUS,
});
inputController.setGestureGuard((e) => inventoryInteraction.tryBeginItemTouch(e));

// Press and hold on Hollowdrop to open the radial inventory, tap a segment to expel.
// This is where dropping cargo lives now that the outward swipe is gone - see the
// module header for why that matters to Stage 2 of the design doc.
const inventoryWheel = new InventoryWheelController({
  canvas,
  camera,
  player,
  inventoryManager,
  resourceManager,
  uiManager,
  playerController,
  mutationSystem,
  inputController,
  playerRadius: PLAYER_RADIUS,
});

// Inventory weight -> movement speed/acceleration + the visual "burden" body shape.
const burdenSystem = new BurdenSystem(inventoryManager, playerController, {
  onHeavyReached: () => uiManager.showHeavyHint(),
});

// --- Predator (Cave Stalker) ---------------------------------------------------
// Home territory placed well outside detection/lose/max-chase radii from the
// player's start, so there's a safe opening to explore and collect first.
const predatorHomePosition = new THREE.Vector3(10, 0, 8);
const predatorController = new PredatorController(scene, predatorHomePosition, playerController, playerHealth, uiManager, resourceManager, {
  onDefeated: () => runStats.predatorsDefeated++,
});

// --- Mutation form (Venom Rat) --------------------------------------------------
const playerFormController = new PlayerFormController({
  playerController,
  inventoryManager,
  mutationSystem,
  resourceManager,
  uiManager,
  metabolismSystem,
  inputController,
  inventoryInteraction,
  slimeVisual,
  slimeMaterial,
  ratVisual,
  ratMaterial,
});

// Both visuals above (Meshy AI FBX imports, see playerSlimeModel.js/ratModel.js) load
// their real model asynchronously and start out showing a small placeholder sphere -
// slimeMaterial/ratMaterial above were captured from that placeholder at construction
// time, and playerFormController just copied those same stale references into its own
// fields. Once each one's real material actually arrives, re-point that field (read
// fresh every time PlayerFormController calls setActiveMaterial()) and, if that form
// happens to be the one currently showing, switch PlayerController to it immediately
// rather than waiting for the next mutate/revert to pick it up on its own.
amoeba.onReady = (material) => {
  playerFormController.slimeMaterial = material;
  if (playerFormController.currentForm === PLAYER_FORMS.SLIME) playerController.setActiveMaterial(material);
};
ratVisual.userData.onReady = (material) => {
  playerFormController.ratMaterial = material;
  if (playerFormController.currentForm === PLAYER_FORMS.VENOM_RAT) playerController.setActiveMaterial(material);
};

// Wired here (not at MutationSystem construction) so the callback can close over
// playerFormController, which doesn't exist yet at that point.
mutationSystem.onMutationAvailable = (recipe, firstDiscovery) => {
  // Guards the shared action-button slot: while transformed, that slot belongs to
  // REVERT (see PlayerFormController), never MUTATE - even if ingredients happen to
  // be available again (e.g. re-absorbed while Rat, before the inventory reopens).
  if (recipe && playerFormController.currentForm === PLAYER_FORMS.SLIME) {
    if (firstDiscovery) {
      uiManager.showMutationDiscovered(recipe.name);
      runStats.venomRatDiscovered = true; // only one recipe exists in this prototype (mutationSystem.js)
    }
    uiManager.showMutationReady(recipe, () => playerFormController.beginMutation(recipe));
  } else {
    uiManager.hideMutationReady();
  }
};
if (DEBUG_MUTATION) {
  mutationSystem.onRecipeChecked = (recipe, missing) => uiManager.updateDebugRecipe(recipe, missing);
}

// --- Prey (Glow Beetle) + Venom Bite combat ------------------------------------
// Spread around the environment (not on top of the player's spawn at the origin),
// in different directions from both the predator's territory and the Rat DNA
// pickup, so there's something new to find once the player can actually hunt.
const preyManager = new PreyManager(scene, playerController, playerFormController, resourceManager, uiManager, {
  onDefeated: () => runStats.preyDefeated++,
});

/** Factored out for the same reason populateWorldResources() is - both the initial
 *  load and the Play Again reset pipeline spawn the exact same starting population. */
function populateWorldPrey() {
  for (const [x, z] of [[-6, -4], [-3, 8], [6, -6], [3, -3]]) {
    preyManager.spawnGlowBeetle(new THREE.Vector3(x, 0, z));
  }
}
populateWorldPrey();

// --- Apex Predator (Murkmaw) + Human Genome Fragment ---------------------------
// A short walk from spawn (~13.5 units) in the one quadrant nothing else spawns in
// (negative X, negative Z) - far enough that the trigger radius no longer reaches
// spawn itself, close enough to still be a quick test loop.
const apexArenaCenter = new THREE.Vector3(-10, 0, -9);

// Reveal/hover/collect for the Fragment - deliberately its own small controller, not
// routed through ResourceManager (see that file's own header comment for why).
// rivalController/playerCarryAnchor are assigned post-construction below (same
// "wire after construction" pattern as mutationSystem.onMutationAvailable), since
// RivalController needs genomeFragmentController to exist first.
const genomeFragmentController = new GenomeFragmentController(scene, playerController, playerHealth, uiManager);
genomeFragmentController.playerCarryAnchor = fragmentCarryAnchor;

const apexController = new ApexController({
  scene,
  arenaCenter: apexArenaCenter,
  playerController,
  playerHealth,
  uiManager,
  resourceManager,
  genomeFragmentController,
  onDefeated: () => runStats.apexDefeated++,
});

// Trigger radius sits a little outside the dressed arena itself, so crossing into
// the territory reads as the moment of discovery, not "suddenly standing on the boss".
const apexEncounterManager = new ApexEncounterManager(scene, playerController, apexController, {
  arenaCenter: apexArenaCenter,
  arenaRadius: APEX_CONFIG.arenaRadius,
  triggerRadius: APEX_CONFIG.arenaRadius + 3,
});

// --- Rival Slime + Fire Lizard --------------------------------------------------
// Shares the Apex's arena - it only ever enters once the Human Genome Fragment is
// exposed (see the onExposed wiring below), competing with the player for the SAME
// reward rather than being a standalone encounter. escapeTarget sits well beyond the
// arena toward the world boundary - somewhere the Rival visibly commits to fleeing
// toward once it's carrying the Fragment, distinct from the Player's own extraction
// zone (set up below with FragmentContestManager).
const rivalEscapeTarget = new THREE.Vector3(-22, 0, -20);
const rivalController = new RivalController({
  scene,
  arenaCenter: apexArenaCenter,
  arenaRadius: APEX_CONFIG.arenaRadius,
  escapeTarget: rivalEscapeTarget,
  playerController,
  playerHealth,
  resourceManager,
  genomeFragmentController,
  uiManager,
  onSpawned: () => {
    runStats.rivalEncountered = true;
  },
});
genomeFragmentController.rivalController = rivalController;

genomeFragmentController.onExposed = () => {
  rivalController.notifyFragmentExposed();
  if (DEBUG_APEX || DEBUG_RIVAL) console.log('Human Genome Fragment exposed');
};
genomeFragmentController.onPickup = (carrier) => {
  if (DEBUG_APEX || DEBUG_RIVAL) console.log(`Human Genome Fragment picked up by ${carrier}`);
};
genomeFragmentController.onDrop = (fromCarrier) => {
  if (DEBUG_APEX || DEBUG_RIVAL) console.log(`Human Genome Fragment dropped by ${fromCarrier}`);
};
// onSecured is assigned further down, once gameFlowController exists - it's the ONE
// authoritative trigger for the Memory/Run Complete ending (spec sections 3-4).

// --- Fragment Contest: extraction zone + escape/reset orchestration -------------
// extractionPosition sits back near the Player's own spawn - a real "carry it home"
// distance from the arena (~13.5 units), and nowhere near the Fragment's own spawn
// point so reaching it always requires deliberate travel. resetSpawnPosition is the
// arena itself, matching where ApexController originally spawns the Fragment.
const fragmentExtractionPosition = new THREE.Vector3(3, 0, 3);
const fragmentContestManager = new FragmentContestManager({
  scene,
  playerController,
  genomeFragmentController,
  rivalController,
  uiManager,
  extractionPosition: fragmentExtractionPosition,
  resetSpawnPosition: apexArenaCenter,
});

// Decorative props across the rest of the map. Built here rather than earlier because
// the exclusion list needs the objective positions that are only decided above. Purely
// visual and non-colliding, so it never has to be part of the Play Again reset - like
// the arena's own dressing, it's permanent scenery.
// --- Collision -----------------------------------------------------------------
// Circles in the XZ plane. Every solid thing here is round from above and the camera is
// fixed top-down, so this is the actual shape rather than an approximation.
const collisionSystem = new CollisionSystem();

const worldDressingResult = scatterWorldDressing(scene, {
  exclusions: [
    // Player spawn: the opening ring of collectible resources sits here and must stay
    // readable rather than buried in scenery.
    { x: PLAYER_SPAWN_POSITION.x, z: PLAYER_SPAWN_POSITION.z, radius: 7 },
    { x: fragmentExtractionPosition.x, z: fragmentExtractionPosition.z, radius: 5 },
    // The arena already dresses itself, more densely and in its own violet palette.
    { x: apexArenaCenter.x, z: apexArenaCenter.z, radius: APEX_CONFIG.arenaRadius + 3 },
  ],
});

// Stones become solid. Both scatters are registered: the wider map's and the Apex
// arena's own ring, which ApexEncounterManager builds through the same module.
for (const rock of worldDressingResult.rocks) {
  collisionSystem.addStatic(rock.x, rock.z, rockColliderRadius(rock.scale));
}
for (const rock of apexEncounterManager.dressingRocks ?? []) {
  collisionSystem.addStatic(rock.x, rock.z, rockColliderRadius(rock.scale));
}

// Murkmaw's body is solid; its HEAD deliberately is not. A collider on the head would
// hold the player at head-radius + player-radius apart - further than Venom Bite's 1.25
// reach - and the boss would become literally unkillable. Leaving the head passable is
// what makes "body is a wall, head is the weak point" actually playable.
collisionSystem.addDynamicProvider(() => {
  const mesh = apexController.mesh;
  if (!mesh || !mesh.visible || apexController.state === 'DORMANT' || apexController.state === 'DEAD') return null;
  const segments = mesh.userData.segments;
  if (!segments) return null;
  const out = [];
  for (const seg of segments) {
    seg.pivot.getWorldPosition(tempColliderPos);
    // Segment world radius: base body radius x its own taper x the group's live scale
    // (which ApexController ramps 0.55 -> 1 during the intro rise).
    out.push({
      x: tempColliderPos.x,
      z: tempColliderPos.z,
      radius: 0.68 * 0.94 * seg.scale * mesh.scale.x,
    });
  }
  return out;
});

const objectiveIndicator = new ObjectiveIndicatorController(camera, canvas, uiManager, fragmentContestManager, genomeFragmentController);


// Every enemy source exposes the same getDamageableEntities()/takeDamage() interface
// (see PlayerCombatController's own doc comment) - registering a new one means adding
// it to this array, nothing inside PlayerCombatController itself.
const playerCombatController = new PlayerCombatController({
  playerController,
  damageableSources: [preyManager, predatorController, apexController, rivalController],
  uiManager,
});
// Read-only: PlayerFormController blends this into ratVisual's own animation - see
// its constructor comment and _updateRatIdle. Wired here (not at construction) since
// playerCombatController doesn't exist yet when playerFormController is built.
playerFormController.playerCombatController = playerCombatController;

// --- Game feel: shake / hitstop / damage numbers --------------------------------
// Impact feedback, kept deliberately separate from the systems that cause it: every
// hook below is assigned post-construction (the same wiring pattern as
// mutationSystem.onMutationAvailable above), so no combat or AI class has to know
// that screen shake or damage numbers exist.
const screenShake = new ScreenShake();
const damageNumbers = new DamageNumberController(camera, canvas);

// Hitstop: a couple of frames of near-frozen simulation on a landed hit - what makes
// a strike feel like it connected with something solid rather than passing through
// it. Applied at the ONE place deltaTime is produced in animate(), so every system
// slows together and none of them need to know it happened.
const HITSTOP_TIME_SCALE = 0.08;
let hitstopRemaining = 0;
function triggerHitstop(duration) {
  // max(), not +=, so several hits in one frame can't compound into a long freeze.
  hitstopRemaining = Math.max(hitstopRemaining, duration);
}

playerCombatController.onAttackConnected = () => {
  triggerHitstop(0.055);
  screenShake.add(0.22);
};
playerCombatController.onHit = (entity, damage) => {
  damageNumbers.spawn(entity.mesh.position, damage, 'player');
};

// Damage taken. Trauma scales with the fraction of max health lost, so a Glow Beetle
// graze and an Apex slam don't rattle the camera by the same amount.
playerHealth.onDamaged = (amount) => {
  screenShake.add(THREE.MathUtils.clamp(0.25 + (amount / playerHealth.maxHealth) * 0.9, 0, 1));
  damageNumbers.spawn(player.position, amount, 'incoming');
  amoeba.triggerSquint();
};

// Eyes widen on absorb. Wrapping triggerAbsorbPulse rather than hunting down every
// call site: ResourceManager, MetabolismSystem and PlayerFormController all fire it,
// and every one of them is a moment the creature should react to. The design doc names
// the "toy-like joy of absorbing items" as the Stage 1 hook - this is that.
const originalAbsorbPulse = playerController.triggerAbsorbPulse.bind(playerController);
playerController.triggerAbsorbPulse = () => {
  originalAbsorbPulse();
  amoeba.triggerWiden();
};

// Death feedback. NOTE: every one of these controllers already spawns its own particle
// burst inside its _die() (preyManager.js, predatorController.js, apexController.js) -
// only the camera shake is missing, so only shake is added here. The existing
// onDefeated hooks are wrapped rather than replaced, so run-stats counting is untouched.
const addDefeatShake = (controller, trauma) => {
  const previousOnDefeated = controller.onDefeated;
  controller.onDefeated = (...args) => {
    previousOnDefeated?.(...args);
    screenShake.add(trauma);
  };
};
addDefeatShake(preyManager, 0.12);
addDefeatShake(predatorController, 0.3);
addDefeatShake(apexController, 0.7); // the boss earns the biggest one in the game

// Opening the panel mid-swipe cancels the drag so Hollowdrop eases to a stop
// instead of continuing to coast while the player is browsing their items.
const inventoryUI = new InventoryUI(inventoryManager, {
  mutationSystem, // so the codex can show live missing-ingredient counts
  onOpen: () => {
    inputController.cancel();
    inventoryInteraction.cancelActiveGesture();
    inventoryWheel.cancel(); // the two inventory UIs must never be open at once
  },
});

// --- Camera follow -----------------------------------------------------------
const desiredCameraPos = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();

function updateCamera(deltaTime) {
  // Subtle zoom-toward-Hollowdrop during the Memory Reveal (spec section 10) - a
  // single scale on the existing offset, not a separate camera path, so it stays
  // exactly as "subtle" as the offset itself and never fights the normal follow-cam.
  const zoom = memorySequenceController.getCameraZoom();
  const offsetScale = 1 - zoom;
  desiredCameraPos.set(
    player.position.x + CAMERA_OFFSET.x * offsetScale,
    CAMERA_OFFSET.y * offsetScale,
    player.position.z + CAMERA_OFFSET.z * offsetScale
  );
  const smooth = 1 - Math.exp(-CAMERA_FOLLOW_SMOOTHING * deltaTime);
  camera.position.lerp(desiredCameraPos, smooth);
  cameraLookTarget.lerp(player.position, smooth);
  camera.lookAt(cameraLookTarget.x, 0, cameraLookTarget.z);

  // Shake is added AFTER the follow-lerp and after lookAt, so the offset never feeds
  // back into the smoothing (which would drag the camera off the player and let the
  // shake slowly wander) and never rotates the view - it displaces the eye only.
  camera.position.add(screenShake.offset);
}

// Death/respawn: drops inventory back into the world (reusing the swipe-to-expel
// resource system), plays the collapse animation, fades, and returns Hollowdrop
// to a safe spawn point away from the predator's territory, always back as Slime.
// PLAYER_SPAWN_POSITION itself is declared up with the player root, since the world
// dressing needs it before this point to know where to leave clear.
const deathRespawnManager = new DeathRespawnManager({
  player,
  playerController,
  playerHealth,
  metabolismSystem,
  mutationSystem,
  playerFormController,
  inventoryManager,
  resourceManager,
  inputController,
  inventoryInteraction,
  predatorController,
  genomeFragmentController,
  uiManager,
  respawnPosition: PLAYER_SPAWN_POSITION,
  // Snaps the camera instantly on respawn instead of letting it slide across the
  // map to catch up - the fade covers the position jump, not a camera glide.
  onRespawnCamera: () => {
    camera.position.set(player.position.x + CAMERA_OFFSET.x, CAMERA_OFFSET.y, player.position.z + CAMERA_OFFSET.z);
    cameraLookTarget.copy(player.position);
  },
  onPlayerDeath: () => runStats.deaths++,
});

// Resources shouldn't attract/absorb into a dying or not-yet-respawned player.
const OFFSCREEN_POSITION = new THREE.Vector3(9999, 9999, 9999);
const tempColliderPos = new THREE.Vector3();

if (DEBUG_HEALTH) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') playerHealth.takeDamage(20, null);
    if (e.key === 'k' || e.key === 'K') playerHealth.takeDamage(playerHealth.currentHealth, null);
    if (e.key === 'r' || e.key === 'R') deathRespawnManager.forceRespawn();
  });
}

if (DEBUG_METABOLISM) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'e' || e.key === 'E') metabolismSystem.drainEnergy(20);
    if (e.key === 'f' || e.key === 'F') metabolismSystem.addEnergy(20);
  });
}

if (DEBUG_MUTATION) {
  window.addEventListener('keydown', (e) => {
    if (e.key === MUTATION_CONFIG.debugRevertKey) playerFormController.revertToSlime();
  });
}

if (DEBUG_MUTATION_TIMER) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 't' || e.key === 'T') playerFormController.debugSetMutationTime(10);
    if (e.key === 'y' || e.key === 'Y') playerFormController.debugSetMutationTime(3);
  });
}

if (DEBUG_COMBAT || DEBUG_PREY) {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault(); // stop the page from scrolling on spacebar
      playerCombatController.tryBite();
    }
    if (e.key === 'p' || e.key === 'P') {
      preyManager.spawnGlowBeetle(player.position.clone().add(new THREE.Vector3(2, 0, 2)));
    }
  });
}

if (DEBUG_PREDATOR_COMBAT) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'k' || e.key === 'K') {
      predatorController.takeDamage(15, { sourceEntity: playerController, sourceType: 'debug', attackType: 'debug' });
    }
    if (e.key === 'h' || e.key === 'H') predatorController.debugHeal();
    if (e.key === 'j' || e.key === 'J') predatorController.debugTeleportNearPlayer();
  });
}

if (DEBUG_APEX) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'b' || e.key === 'B') apexController.startEncounter();
    if (e.key === '1') apexController.debugForceAttack('charge');
    if (e.key === '2') apexController.debugForceAttack('slam');
    if (e.key === '3') apexController.debugForceAttack('toxic');
    if (e.key === 'p' || e.key === 'P') apexController.debugForcePhase2();
    if (e.key === 'k' || e.key === 'K') {
      apexController.takeDamage(30, { sourceEntity: playerController, sourceType: 'debug', attackType: 'debug' });
    }
    if (e.key === 'g' || e.key === 'G') apexController.debugSetHealth(15);
  });
}

if (DEBUG_RIVAL) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'v' || e.key === 'V') rivalController.debugForceSpawn();
    if (e.key === 'm' || e.key === 'M') rivalController.debugForceMutation();
    if (e.key === 'f' || e.key === 'F') rivalController.debugForceFireBreath();
    if (e.key === 'k' || e.key === 'K') {
      rivalController.takeDamage(20, { sourceEntity: playerController, sourceType: 'debug', attackType: 'debug' });
    }
    if (e.key === 'o' || e.key === 'O') rivalController.debugForceSeekFragment();
  });
}

if (DEBUG_FRAGMENT_CONTEST) {
  window.addEventListener('keydown', (e) => {
    if (e.key === '1') genomeFragmentController.pickupByPlayer();
    if (e.key === '2') genomeFragmentController.pickupByRival();
    if (e.key === '3') {
      const f = genomeFragmentController.fragment;
      if (f?.carrier === 'player') genomeFragmentController.dropFromPlayer();
      else if (f?.carrier === 'rival') genomeFragmentController.dropFromRival();
    }
    if (e.key === '4') {
      player.position.set(fragmentExtractionPosition.x, PLAYER_RADIUS, fragmentExtractionPosition.z);
    }
    if (e.key === '5') {
      const f = genomeFragmentController.fragment;
      if (f?.state === FRAGMENT_STATES.CARRIED_BY_RIVAL) f.rivalStability = 1;
    }
    if (e.key === '6') {
      if (genomeFragmentController.fragment) genomeFragmentController.releaseForReset();
      genomeFragmentController.spawn(apexArenaCenter.clone());
      rivalController.notifyFragmentExposed();
    }
  });
}

// --- Memory Reveal / Run Complete / Play Again -----------------------------------
const memorySequenceController = new MemorySequenceController(uiManager, {
  onFinished: () => gameFlowController.handleMemoryFinished(),
});
const runCompleteController = new RunCompleteController(uiManager, {
  onPlayAgain: () => gameFlowController.restartRun(),
});

/** The ONE central reset pipeline (spec section 29) - every step reuses an existing
 *  system's own reset()/clearAll() method rather than duplicating any of their
 *  internal logic here. Order matters in a few places (inventory must be empty
 *  before mutation state is recomputed; the player must already be back at spawn
 *  before the world resource scatter re-centers on it) - see the inline notes below. */
function resetGame() {
  // Player: position/velocity/form/health/energy/camera, all back to a fresh Slime
  // at PLAYER_SPAWN_POSITION - reuses the exact same restore a natural respawn uses.
  deathRespawnManager.resetForNewRun();

  // Input: clears any pointer still "held" from the previous run's very last frame,
  // so the new run can never start with Hollowdrop already sliding on a stale drag.
  inputController.cancel();
  inventoryInteraction.cancelActiveGesture();
  inventoryWheel.cancel();
  inventoryUI.close();

  // Inventory / burden - burden itself has no state to reset (BurdenSystem.update()
  // recomputes it fresh from inventory weight every frame, so it self-corrects the
  // instant the inventory above is empty).
  inventoryManager.reset();
  uiManager.updateMassUI(0, inventoryManager.maxWeight);

  // Mutation - must run AFTER the inventory is actually empty, so onInventoryChanged()
  // recomputes availability against a truly empty Living Inventory (and, via the
  // existing onMutationAvailable wiring above, hides the MUTATE button through the
  // normal path rather than a special-cased reset call).
  mutationSystem.reset();
  mutationSystem.onInventoryChanged();

  // World resources - clear everything (ambient scatter, expelled items, loot),
  // then repopulate the exact same starting layout used on first load. Player is
  // already back at spawn (see deathRespawnManager.resetForNewRun() above), so
  // populateWorldResources()'s player-centered scatter recenters correctly.
  resourceManager.clearAll();
  resourceManager.particles.clear();
  populateWorldResources();

  // Prey
  preyManager.clearAll();
  populateWorldPrey();

  // Predator
  predatorController.reset();

  // Apex + its one-time encounter trigger
  apexController.reset();
  apexEncounterManager.reset();

  // Rival - inactive until the next Apex Fragment event, exactly like a fresh run.
  rivalController.reset();

  // Genome Fragment + Extraction
  genomeFragmentController.reset();
  fragmentContestManager.reset();

  // Game feel: a shake still decaying, a hitstop still counting down, or damage
  // numbers still floating from the previous run must not bleed into the new one.
  screenShake.reset();
  hitstopRemaining = 0;
  damageNumbers.clear();

  // HUD: instantly dismiss anything left over from the previous run (a mid-timeout
  // toast, a still-visible boss/rival bar) rather than waiting for it to time out.
  uiManager.dismissTransientUI();
  objectiveIndicator.update(); // one extra call so it hides itself immediately, not next frame

  if (DEBUG_APEX || DEBUG_RIVAL || DEBUG_FRAGMENT_CONTEST) console.log('Game reset - new run started');
}

const gameFlowController = new GameFlowController({
  uiManager,
  memorySequenceController,
  runCompleteController,
  runStats,
  resetGame,
  // Gates leaving the Title screen on the player's real model actually being loaded
  // (see gameFlowController.js's _handleBeginTap) - the placeholder sphere should
  // never be the first thing seen in gameplay, only (briefly, if at all) behind the
  // Title card itself.
  slimeReady: amoeba.ready,
});

// --- Guided moments -------------------------------------------------------------
// Two cards, both through GameFlowController so each one genuinely PAUSES the game via
// the same state gate the Memory Reveal uses. Neither is a control tutorial: energy,
// weight and speed stay discoverable. These only state things a player cannot deduce -
// what the run is for, and what a form actually does.
gameFlowController.onFirstRunBegun = () => {
  gameFlowController.showOpeningObjective({
    kicker: 'THE COLONY',
    title: 'Absorb. Adapt. Survive.',
    body: 'Roll over what you find and it becomes part of you. Combine the right DNA to '
      + 'take another creature\u2019s shape. Somewhere out here is a Human Genome Fragment '
      + '\u2014 take it, and carry it home.',
  });
};

// Fires the instant a transformation completes, never at the MUTATE press.
playerFormController.onTransformed = (recipe) => {
  if (!recipe) return;
  gameFlowController.showReveal({
    kicker: 'MUTATION COMPLETE',
    title: recipe.name,
    body: recipe.tagline ?? '',
    list: recipe.grants ?? [],
    cost: recipe.cost ?? '',
  });
};

// The ONE authoritative trigger for the ending (spec section 3-4): only fires once
// the Fragment actually reaches SECURED at extraction, never on mere touch/carry/steal.
genomeFragmentController.onSecured = () => {
  gameFlowController.onGenomeFragmentSecured();
  if (DEBUG_APEX || DEBUG_RIVAL) console.log(`Human Genome Fragment secured (total: ${genomeFragmentController.collectedCount})`);
};

// Dev-only inspection hook (devtools console): window.__hollowdrop
window.__hollowdrop = {
  player,
  amoeba, // debug: __hollowdrop.amoeba.bodyMaterial reflects the loaded Jellybean Slime once ready
  camera,
  resourceManager,
  inventoryManager,
  burdenSystem,
  playerController,
  inventoryInteraction,
  inventoryWheel,
  collisionSystem,
  playerHealth,
  metabolismSystem,
  mutationSystem,
  playerFormController,
  predatorController,
  deathRespawnManager,
  preyManager,
  playerCombatController,
  apexController,
  apexEncounterManager,
  genomeFragmentController,
  rivalController,
  fragmentContestManager,
  objectiveIndicator,
  runStats,
  gameFlowController,
  memorySequenceController,
  runCompleteController,
  resetGame,
  projectItemToScreen: (item) => inventoryInteraction._worldPositionToScreen(item.visualMesh.getWorldPosition(new THREE.Vector3())),
};

/**
 * Where Hollowdrop is looking, as a normalised screen-space direction (-1..1 per axis).
 *
 * Returns the direction from the creature's own position on screen toward the pointer,
 * so it tracks the cursor wherever it is rather than just leaning at the screen edges.
 * Distance is normalised against a fixed radius so the eyes reach full deflection once
 * the pointer is a comfortable way off and then stop, instead of scaling with window
 * size.
 *
 * Touch devices have no hover, so with no pointer on the glass this falls back to the
 * direction of travel - the creature looks where it is going. On desktop that fallback
 * only applies before the mouse has ever moved.
 */
const gazeScratch = new THREE.Vector3();
const GAZE_REACH_PX = 260;
function computeGaze() {
  if (!pointerScreen.seen) {
    // Look along the direction of travel. Screen +Y is down and the camera looks down
    // -Z, so world -Z maps to screen up: negate to get screen-space Y.
    const v = playerController.currentVelocity;
    const speed = v.length();
    if (speed < 0.2) return { x: 0, y: 0 };
    return { x: v.x / speed, y: -v.z / speed };
  }

  gazeScratch.copy(player.position).project(camera);
  const rect = canvas.getBoundingClientRect();
  const px = (gazeScratch.x * 0.5 + 0.5) * rect.width + rect.left;
  const py = (1 - (gazeScratch.y * 0.5 + 0.5)) * rect.height + rect.top;
  return {
    x: (pointerScreen.x - px) / GAZE_REACH_PX,
    y: -(pointerScreen.y - py) / GAZE_REACH_PX,
  };
}

// --- Resize handling -----------------------------------------------------------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 100));

// --- Main loop -----------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const realDeltaTime = Math.min(clock.getDelta(), 0.05); // clamp to avoid spiral-of-death on tab-switch

  // Hitstop. `deltaTime` is what the whole simulation below runs on; `realDeltaTime`
  // stays available for things that must keep moving during the freeze. The hitstop
  // timer itself burns down in REAL time - draining it with the scaled delta would
  // make the freeze ~12x longer than requested.
  let deltaTime = realDeltaTime;
  if (hitstopRemaining > 0) {
    hitstopRemaining = Math.max(0, hitstopRemaining - realDeltaTime);
    deltaTime = realDeltaTime * HITSTOP_TIME_SCALE;
  }

  // Drives TITLE/PLAYING/MEMORY/RUN_COMPLETE/RESETTING transitions - called first so a
  // same-frame transition (e.g. RESETTING -> PLAYING) is reflected in isPlayingState
  // below without a one-frame lag.
  gameFlowController.update(deltaTime);
  memorySequenceController.update(deltaTime);

  // The single top-level gate for "is the simulation actually running right now"
  // (spec sections 8-9, 57): everything AI/physics/timer-driven below only advances
  // while PLAYING. TITLE/MEMORY/RUN_COMPLETE/RESETTING all freeze it in place rather
  // than deleting or rebuilding anything - renderer/camera/UI keep running regardless.
  const isPlayingState = gameFlowController.state === GAME_STATES.PLAYING;
  metabolismSystem.enabled = isPlayingState; // MetabolismSystem's own flag already exists for exactly this

  burdenSystem.update();
  // Speed/acceleration are recomputed fresh every frame from base x form x burden -
  // never multiplied onto a running total, so repeated mutate/revert cycles can't stack.
  playerController.movementSpeedMultiplier = playerFormController.getSpeedMultiplier() * burdenSystem.speedMultiplier;
  playerController.accelerationMultiplier = playerFormController.getAccelerationMultiplier() * burdenSystem.accelerationMultiplier;
  // Jelly wobble only for Slime - Venom Rat keeps its own leg-swing/bob idle animation
  // untouched (PlayerFormController._updateRatIdle). Reduced from 1.8 now that the
  // amoeba shader deforms the body's own vertices: this root-level squash and the
  // shader's pseudopods are two separate wobbles, and at the old value they compounded
  // into an over-animated mess. Root squash still earns its place - it's what reacts
  // instantly to a hard stop, which the slower lobe oscillation can't.
  playerController.squashStretchMultiplier = playerFormController.currentForm === PLAYER_FORMS.SLIME ? 1.2 : 1.0;

  playerHealth.update(deltaTime);
  // Same "recompute fresh every frame" rule as the movement multipliers above - the
  // Rat's faster energy drain is a pure lookup by currentForm, never accumulated.
  metabolismSystem.metabolismMultiplier = playerFormController.getMetabolismMultiplier();
  metabolismSystem.update(deltaTime);
  playerController.setHealthVisual(playerHealth.getHealthRatio());

  // Input only drives movement while actually playing and not mid-transformation -
  // during death/respawn, MUTATING/REVERTING, or a non-PLAYING game-flow state,
  // PlayerController still runs (it needs to, to play the collapse/idle animation, or
  // just to hold a settled pose) but simply receives no new target velocity.
  const canAct = isPlayingState && deathRespawnManager.isPlaying && !playerFormController.isLocked;
  if (canAct) {
    const input = inputController.getMovementInput();
    playerController.setTargetFromInput(input.x, input.y, input.magnitude);
  } else {
    playerController.setTargetFromInput(0, 0, 0);
  }
  playerController.update(deltaTime);
  // Immediately after integration, before anything reads the new position - the camera
  // follow, resource attraction and combat all sample it later in this same frame, so
  // resolving here means none of them ever see the player inside a rock.
  collisionSystem.resolve(player.position, PLAYER_RADIUS, playerController.currentVelocity);

  // Combat is available exactly when the player can act at all AND is currently the
  // Venom Rat - one authority for "can I fight right now" that covers reversion,
  // mutating, death/respawn, and non-PLAYING game-flow states all at once
  // (setAvailable cancels any in-progress bite the instant this flips false).
  // Same gate as combat: no opening the wheel mid-death, mid-mutation, or on the title
  // screen. Closes it too, so a wheel left open when the player dies does not linger.
  inventoryWheel.enabled = canAct;
  if (!canAct && inventoryWheel.isOpen) inventoryWheel.cancel();

  playerCombatController.setAvailable(canAct && playerFormController.currentForm === PLAYER_FORMS.VENOM_RAT);
  playerCombatController.update(deltaTime);

  if (isPlayingState) {
    // Mutation timer, AI (Prey/Predator/Apex/Rival), the Fragment contest, resource
    // attraction/absorption, and death/respawn all stop advancing outside PLAYING
    // (spec sections 8-9) - none of them are touched/rebuilt, just not ticked.
    playerFormController.update(deltaTime);
    preyManager.update(deltaTime);
    apexEncounterManager.update();
    apexController.update(deltaTime);
    genomeFragmentController.update(deltaTime);
    rivalController.update(deltaTime);
    fragmentContestManager.update(deltaTime);
    predatorController.update(deltaTime);

    const activePlayerPosition = deathRespawnManager.isPlaying ? player.position : OFFSCREEN_POSITION;
    resourceManager.update(deltaTime, activePlayerPosition);
    deathRespawnManager.update(deltaTime);
  }
  objectiveIndicator.update(); // self-hides once the Fragment is no longer active - safe to always call

  inventoryInteraction.update(deltaTime);
  inventoryManager.update(deltaTime, inventoryInteraction.getExcludedItemId());
  inventoryUI.updateMass();

  // Both run on REAL delta: the point of hitstop is that the world freezes while the
  // camera rattles and the number you just dealt keeps rising. Slowing these two with
  // everything else would cancel the effect out.
  screenShake.update(realDeltaTime);
  damageNumbers.update(realDeltaTime);

  // Amoeba deformation. Real delta for the same reason as the two above: the membrane
  // should keep breathing through a hitstop freeze rather than locking mid-lobe.
  // Both inputs are already computed elsewhere and simply read here - speedRatio is
  // the same ratio PlayerController's own movement feel uses, and burdenSystem.load is
  // recomputed from inventory weight every frame.
  // Every NPC slime ticks itself here - one sweep instead of four controllers each
  // having to know the shader exists. Real delta, same reasoning as the player's: bodies
  // keep breathing through a hitstop freeze. Creatures removed from the scene are
  // dropped from the registry automatically.
  updateSlimeCreatures(realDeltaTime, camera);

  amoeba.update(realDeltaTime, {
    speedRatio: playerController.currentVelocity.length() / PLAYER_MAX_SPEED,
    load: burdenSystem.load,
    gaze: computeGaze(),
    // The eyes billboard against this, so they stay readable no matter which way the
    // root has yawed to face travel.
    camera,
  });

  updateCamera(deltaTime);

  renderer.render(scene, camera);
}

animate();
