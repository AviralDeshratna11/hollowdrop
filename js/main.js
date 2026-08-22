import * as THREE from 'three';
import { InputController } from './inputController.js';
import { PlayerController } from './playerController.js';
import { InventoryManager, MAX_WEIGHT } from './inventoryManager.js';
import { ResourceManager } from './resourceManager.js';
import { UIManager } from './uiManager.js';
import { InventoryUI } from './inventoryUI.js';
import { InventoryInteractionController } from './inventoryInteraction.js';
import { BurdenSystem } from './burdenSystem.js';
import { PlayerHealthState, DEBUG_HEALTH } from './playerHealth.js';
import { PredatorController, DEBUG_PREDATOR_COMBAT } from './predatorController.js';
import { DeathRespawnManager } from './deathRespawnManager.js';
import { MetabolismSystem, DEBUG_METABOLISM } from './metabolismSystem.js';
import { MutationSystem, DEBUG_MUTATION } from './mutationSystem.js';
import { PlayerFormController, MUTATION_CONFIG, PLAYER_FORMS, DEBUG_MUTATION_TIMER } from './playerFormController.js';
import { createRatMesh } from './ratModel.js';
import { loadRimuruSlimeVisual } from './playerSlimeModel.js';
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

// --- Lighting --------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x88ccaa, 0.6));
const dirLight = new THREE.DirectionalLight(0xbfffe0, 0.9);
dirLight.position.set(6, 14, 4);
scene.add(dirLight);

// --- Ground (reference plane so movement is visible) -----------------------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x14251c, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(200, 80, 0x2f6b52, 0x1c3d2e);
scene.add(grid);

// --- Player root + swappable visuals -----------------------------------------
// `player` is the ROOT: position/camera/predator/knockback all target it, and it
// never gets replaced. Exactly one of its two visual children is shown at a time -
// see PlayerFormController. Both visuals sit at local (0,0,0) (root already carries
// the height offset), so switching forms never touches player.position.
const PLAYER_RADIUS = 0.6;
const player = new THREE.Group();
player.position.set(0, PLAYER_RADIUS, 0);
scene.add(player);

// Slime form visual - a wrapper Group (not a bare Mesh) so the Rimuru Slime GLB can be
// dropped in once it finishes loading (see the loadRimuruSlimeVisual() call below)
// without touching anything else that references slimeVisual - PlayerFormController
// only ever touches .visible/.scale, both plain Object3D properties present on a
// Group exactly like a Mesh. Starts holding a plain sphere placeholder (identical to
// the model it replaces) so the player is never invisible even on a slow load; it's
// swapped out in-place the moment the GLB is ready.
const slimeVisual = new THREE.Group();
player.add(slimeVisual);

const slimeMaterial = new THREE.MeshStandardMaterial({
  color: 0x7cffb2,
  transparent: true,
  opacity: 0.78,
  roughness: 0.3,
  metalness: 0.05,
  emissive: 0x1c6b45,
  emissiveIntensity: 0.4,
});
const slimePlaceholderMesh = new THREE.Mesh(new THREE.SphereGeometry(PLAYER_RADIUS, 32, 32), slimeMaterial);
slimeVisual.add(slimePlaceholderMesh);

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

// Touching an item visible inside Hollowdrop: swipe outward to expel it, or tap it
// to bring up Consume (edible items only) - claims the pointer via inputController's
// gesture guard before movement can start on the same touch.
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
inputController.setGestureGuard((e) => inventoryInteraction.tryBeginExpel(e));

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

// Swap the placeholder sphere for the real Rimuru Slime model once it's loaded
// (usually well under a second locally - the Title screen's own "Tap To Begin" wait
// naturally masks this in practice). Reaches directly into the already-constructed
// playerFormController/playerController instances rather than re-plumbing their
// constructors, since main.js's own `slimeMaterial` const was only ever a snapshot
// passed in at construction time - reassigning it here wouldn't update either.
loadRimuruSlimeVisual(PLAYER_RADIUS)
  .then(({ group, bodyMaterial }) => {
    slimeVisual.remove(slimePlaceholderMesh);
    slimePlaceholderMesh.geometry.dispose();
    slimeMaterial.dispose();
    slimeVisual.add(group);

    playerFormController.slimeMaterial = bodyMaterial;
    // Only re-point the live glow/hit-flash target if Slime is actually showing right
    // now - if the player somehow already mutated before the load finished, the new
    // material takes effect correctly the next time they revert (forceResetToSlime()/
    // _updateReverting() both read playerFormController.slimeMaterial fresh).
    if (playerFormController.currentForm === PLAYER_FORMS.SLIME) {
      playerController.setActiveMaterial(bodyMaterial);
    }
  })
  .catch((err) => {
    console.error('Failed to load Rimuru Slime model - keeping the placeholder sphere.', err);
  });

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

// Opening the panel mid-swipe cancels the drag so Hollowdrop eases to a stop
// instead of continuing to coast while the player is browsing their items.
const inventoryUI = new InventoryUI(inventoryManager, {
  onOpen: () => {
    inputController.cancel();
    inventoryInteraction.cancelActiveGesture();
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
}

// Death/respawn: drops inventory back into the world (reusing the swipe-to-expel
// resource system), plays the collapse animation, fades, and returns Hollowdrop
// to a safe spawn point away from the predator's territory, always back as Slime.
// The one canonical spawn point (spec section 60) - both a death respawn AND a
// brand-new run (Play Again) return the player here, never wherever they happen
// to be standing.
const PLAYER_SPAWN_POSITION = new THREE.Vector3(0, PLAYER_RADIUS, 0);
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
});

// The ONE authoritative trigger for the ending (spec section 3-4): only fires once
// the Fragment actually reaches SECURED at extraction, never on mere touch/carry/steal.
genomeFragmentController.onSecured = () => {
  gameFlowController.onGenomeFragmentSecured();
  if (DEBUG_APEX || DEBUG_RIVAL) console.log(`Human Genome Fragment secured (total: ${genomeFragmentController.collectedCount})`);
};

// Dev-only inspection hook (devtools console): window.__hollowdrop
window.__hollowdrop = {
  player,
  camera,
  resourceManager,
  inventoryManager,
  burdenSystem,
  playerController,
  inventoryInteraction,
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
  const deltaTime = Math.min(clock.getDelta(), 0.05); // clamp to avoid spiral-of-death on tab-switch

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
  // Jelly wobble only for Slime (the Rimuru model) - Venom Rat keeps its own leg-swing/
  // bob idle animation untouched (PlayerFormController._updateRatIdle).
  playerController.squashStretchMultiplier = playerFormController.currentForm === PLAYER_FORMS.SLIME ? 1.8 : 1.0;

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

  // Combat is available exactly when the player can act at all AND is currently the
  // Venom Rat - one authority for "can I fight right now" that covers reversion,
  // mutating, death/respawn, and non-PLAYING game-flow states all at once
  // (setAvailable cancels any in-progress bite the instant this flips false).
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

  updateCamera(deltaTime);

  renderer.render(scene, camera);
}

animate();
