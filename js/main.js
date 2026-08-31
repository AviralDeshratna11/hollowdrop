import * as THREE from 'three';
import { InputController } from './inputController.js?v=5.3';
import { PlayerController, PLAYER_MAX_SPEED } from './playerController.js?v=5.3';
import { InventoryManager, MAX_WEIGHT } from './inventoryManager.js?v=5.3';
import { ResourceManager } from './resourceManager.js?v=5.3';
import { UIManager } from './uiManager.js?v=5.3';
import { InventoryUI } from './inventoryUI.js?v=5.3';
import { InventoryInteractionController } from './inventoryInteraction.js?v=5.3';
import { InventoryWheelController } from './inventoryWheel.js?v=5.3';
import { BurdenSystem } from './burdenSystem.js?v=5.3';
import { PlayerHealthState, DEBUG_HEALTH } from './playerHealth.js?v=5.3';
import { PredatorController, DEBUG_PREDATOR_COMBAT } from './predatorController.js?v=5.3';
import { DeathRespawnManager } from './deathRespawnManager.js?v=5.3';
import { MetabolismSystem, DEBUG_METABOLISM } from './metabolismSystem.js?v=5.3';
import { MutationSystem, DEBUG_MUTATION, MUTATION_RECIPES } from './mutationSystem.js?v=5.3';
import { PlayerFormController, MUTATION_CONFIG, PLAYER_FORMS, DEBUG_MUTATION_TIMER } from './playerFormController.js?v=5.3';
import { createRatMesh } from './ratModel.js?v=5.3';
import { createPlayerSlimeVisual } from './playerSlimeModel.js?v=5.3';
import { PreyManager, DEBUG_PREY } from './preyManager.js?v=5.3';
import { PlayerCombatController, DEBUG_COMBAT } from './playerCombatController.js?v=5.3';
import { ProjectileSystem } from './projectileSystem.js?v=5.3';
import { ApexController, DEBUG_APEX, APEX_CONFIG } from './apexController.js?v=5.3';
import { ApexEncounterManager } from './apexEncounterManager.js?v=5.3';
import { GenomeFragmentController, FRAGMENT_STATES } from './genomeFragmentController.js?v=5.3';
import { RivalController, DEBUG_RIVAL } from './rivalController.js?v=5.3';
import { FragmentContestManager, DEBUG_FRAGMENT_CONTEST } from './fragmentContestManager.js?v=5.3';
import { ObjectiveIndicatorController } from './objectiveIndicator.js?v=5.3';
import { createRunStats } from './runStats.js?v=5.3';
import { MemorySequenceController } from './memorySequenceController.js?v=5.3';
import { RunCompleteController } from './runCompleteController.js?v=5.3';
import { GameFlowController, GAME_STATES } from './gameFlowController.js?v=5.3';
import { scatterWorldDressing, rockColliderRadius, realignDressingToTerrain } from './worldDressing.js?v=5.3';
import { CollisionSystem } from './collision.js?v=5.3';
import { updateSlimeCreatures } from './slimeCreature.js?v=5.3';
import { ScreenShake } from './screenShake.js?v=5.3';
import { DamageNumberController } from './damageNumbers.js?v=5.3';
import { RadarController } from './radarController.js?v=5.3';
import { RadarHUD } from './radarHUD.js?v=5.3';
import { getTerrainHeight, applyTerrainElevation, initTextureElevation, onTerrainElevationReady } from './terrain.js?v=5.3';
import { StoneClusterManager } from './stoneClusters.js?v=5.3';
import { createVastCanopyTree } from './treeModel.js?v=5.3';

const canvas = document.getElementById('game-canvas');

// --- Scene / Camera / Renderer -------------------------------------------
const DEBUG_CAMERA = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1410);
// near/far are the values for a REFERENCE_ASPECT screen; updateViewZoom() scales them
// with viewZoom below so a dollied-back camera keeps the same atmospheric depth.
const FOG_NEAR_BASE = 18;
const FOG_FAR_BASE = 55;
scene.fog = new THREE.Fog(0x0a1410, FOG_NEAR_BASE, FOG_FAR_BASE);

const CAMERA_FAR_BASE = 200;
const camera = new THREE.PerspectiveCamera(
  50, // VERTICAL fov (three.js convention) - horizontal coverage is this * aspect,
      // which is the entire reason the equal-view logic below has to exist.
  window.innerWidth / window.innerHeight,
  0.1,
  CAMERA_FAR_BASE
);
const CAMERA_OFFSET = new THREE.Vector3(0, 11, 7); // top-down / slightly angled
const CAMERA_FOLLOW_SMOOTHING = 3.5; // lower = laggier camera, doesn't affect player physics

// --- Equal map view across devices ------------------------------------------
// Because fov is vertical, every device already sees the SAME vertical slice of the
// world. Horizontal coverage is fov * aspect, so without correction a wide monitor
// sees roughly twice the map width a portrait phone does.
//
// REFERENCE_ASPECT is the framing contract: a screen exactly this shape is rendered
// exactly as CAMERA_OFFSET / fov intend (viewZoom = 1). Any NARROWER screen dollies
// the camera straight back along CAMERA_OFFSET by REFERENCE_ASPECT / aspect - the
// horizontal world extent at the player's own position is exactly proportional to
// aspect (d * tan(vfov/2) * aspect, camera has no roll), so this ratio matches the
// reference's horizontal coverage exactly rather than approximately. Such screens then
// also see extra world above/below (bonus, never less). WIDER screens stay at
// viewZoom = 1 and see extra world left/right. Net: nobody ever sees less of the map
// than a REFERENCE_ASPECT screen would.
const REFERENCE_ASPECT = 16 / 9;
// Ceiling on the dolly-back so an extreme portrait aspect can't shrink the player to a
// speck. Past this, very tall/thin screens give up some horizontal parity but still
// keep the full vertical slice. A typical phone's own portrait aspect (~0.45-0.5) hits
// this ceiling directly (REFERENCE_ASPECT/aspect works out to ~3.5-4 there), so this
// number IS the effective zoom level on most real devices, not just a rare-case cap -
// lowered from 3 to 2.2 (a real screenshot read as too zoomed out at 3).
const CAMERA_MAX_ZOOM_OUT = 1.5;
let viewZoom = 1; // multiplies CAMERA_OFFSET everywhere it's used; set by updateViewZoom()

/** Recompute viewZoom from the current window aspect, and push fog + far plane out with
 *  it. Called once at startup and from onResize() (covers orientation changes too). */
function updateViewZoom() {
  const aspect = window.innerWidth / window.innerHeight;
  viewZoom = THREE.MathUtils.clamp(REFERENCE_ASPECT / aspect, 1, CAMERA_MAX_ZOOM_OUT);
  scene.fog.near = FOG_NEAR_BASE * viewZoom;
  scene.fog.far = FOG_FAR_BASE * viewZoom;
  camera.far = Math.max(CAMERA_FAR_BASE, FOG_FAR_BASE * viewZoom + 20);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  if (DEBUG_CAMERA) console.log(`[camera] aspect ${aspect.toFixed(3)} -> viewZoom ${viewZoom.toFixed(3)}`);
}

updateViewZoom();
camera.position.copy(CAMERA_OFFSET).multiplyScalar(viewZoom);
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
// Sized to the actual play area, not a large arbitrary world - every hand-placed thing
// (predator home, the Apex arena + its trigger radius, the Rival's escape target) and
// the decorative prop scatter's own outer radius (34, see worldDressing.js) all sit
// within roughly 30-34 units of the origin, so a 90-unit plane (45-unit half-width)
// covers all of it with margin to spare. This is also what lets the ground texture
// below map across the WHOLE plane at its default repeat of 1 - one image, stretched
// once, with nothing left over to tile or seam (a real screenshot kept showing the
// tile-boundary line at every larger size/repeat combination tried before this).
// terrain.js's own GROUND_SIZE/TEXTURE_REPEAT constants are updated to match this pair
// exactly (its heightmap sampling needs the same values used here to stay aligned with
// what's actually visible) - keep the two in sync if this ever changes again.
const GROUND_SIZE = 90;
const GROUND_SEGMENTS = 320;
const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEGMENTS, GROUND_SEGMENTS);

const groundTexture = new THREE.TextureLoader().load('assets/textures/cave_ground_new.png', (tex) => {
  initTextureElevation(tex.image);
});
groundTexture.colorSpace = THREE.SRGBColorSpace;
groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

applyTerrainElevation(groundGeometry);

const ground = new THREE.Mesh(
  groundGeometry,
  new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- Player root + swappable visuals -----------------------------------------
const PLAYER_RADIUS = 0.6;
const PLAYER_SPAWN_POSITION = new THREE.Vector3(0, PLAYER_RADIUS, 0);
const player = new THREE.Group();
player.position.copy(PLAYER_SPAWN_POSITION);
scene.add(player);

const slimeVisual = new THREE.Group();
player.add(slimeVisual);

const amoeba = createPlayerSlimeVisual(PLAYER_RADIUS);
const slimeMaterial = amoeba.bodyMaterial;
slimeVisual.add(amoeba.group);

const ratVisual = createRatMesh();
const ratMaterial = ratVisual.userData.bodyMaterial;
ratVisual.visible = false;
player.add(ratVisual);

const inventoryContainer = new THREE.Group();
player.add(inventoryContainer);

const fragmentCarryAnchor = new THREE.Group();
fragmentCarryAnchor.position.set(0, 0.55, 0.4);
player.add(fragmentCarryAnchor);

// --- Input / Movement --------------------------------------------------------
const inputController = new InputController(canvas, {
  deadZone: 12,
  maxDistance: 90,
  joystickElement: document.getElementById('move-joystick'),
});
const playerController = new PlayerController(player, slimeMaterial);

// iOS Safari pinch-zoom guard (touch-action:none handles most, this covers gesture events).
document.addEventListener('gesturestart', (e) => e.preventDefault());

// --- Pointer tracking for eye gaze ---------------------------------------------
const pointerScreen = { x: 0, y: 0, seen: false };
canvas.addEventListener('pointermove', (e) => {
  pointerScreen.x = e.clientX;
  pointerScreen.y = e.clientY;
  pointerScreen.seen = true;
}, { passive: true });
canvas.addEventListener('pointerleave', () => { pointerScreen.seen = false; }, { passive: true });

// --- Resources / Inventory / UI -----------------------------------------------
const uiManager = new UIManager();
const inventoryManager = new InventoryManager(inventoryContainer, { maxWeight: MAX_WEIGHT });

const runStats = createRunStats();

const mutationSystem = new MutationSystem(inventoryManager);

const resourceManager = new ResourceManager(scene, inventoryManager, uiManager, playerController, mutationSystem);
resourceManager.onAbsorbed = () => runStats.resourcesAbsorbed++;

function populateWorldResources() {
  resourceManager.spawnTestZone(player.position, 4, {
    minRadius: 3,
    maxRadius: 15,
    excludeTypes: ['rat_dna', 'beetle_dna', 'predator_dna', 'toxic_gland', 'apex_dna', 'rival_dna'],
  });

  for (const [x, z] of [[4, 3], [6, 5], [8, 6.5]]) {
    resourceManager.spawnResource('iron', new THREE.Vector3(x, getTerrainHeight(x, z), z));
  }

  resourceManager.spawnResource('rat_dna', new THREE.Vector3(-10, getTerrainHeight(-10, 6), 6));
}
populateWorldResources();

uiManager.updateMassUI(inventoryManager.getInventoryWeight(), inventoryManager.maxWeight);

// --- Health / Metabolism --------------------------------------------------------
const playerHealth = new PlayerHealthState(playerController, uiManager);

const metabolismSystem = new MetabolismSystem(playerController, playerHealth, uiManager, {
  onLowEnergyReached: () => uiManager.showLowEnergyHint(),
});

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

const burdenSystem = new BurdenSystem(inventoryManager, playerController, {
  onHeavyReached: () => uiManager.showHeavyHint(projectileSystem.getAmmoCount()),
});

// --- Predator (Cave Stalker) ---------------------------------------------------
const predatorHomePosition = new THREE.Vector3(10, getTerrainHeight(10, 8), 8);
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

amoeba.onReady = (material) => {
  playerFormController.slimeMaterial = material;
  if (playerFormController.currentForm === PLAYER_FORMS.SLIME) playerController.setActiveMaterial(material);
};
ratVisual.userData.onReady = (material) => {
  playerFormController.ratMaterial = material;
  if (playerFormController.currentForm === PLAYER_FORMS.VENOM_RAT) playerController.setActiveMaterial(material);
};

mutationSystem.onMutationAvailable = (recipe, firstDiscovery) => {
  if (recipe && playerFormController.currentForm === PLAYER_FORMS.SLIME) {
    if (firstDiscovery) {
      uiManager.showMutationDiscovered(recipe.name);
      runStats.venomRatDiscovered = true;
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
const preyManager = new PreyManager(scene, playerController, playerFormController, resourceManager, uiManager, {
  onDefeated: () => runStats.preyDefeated++,
});

function populateWorldPrey() {
  for (const [x, z] of [[-6, -4], [-3, 8], [6, -6], [3, -3]]) {
    preyManager.spawnGlowBeetle(new THREE.Vector3(x, getTerrainHeight(x, z), z));
  }
}
populateWorldPrey();

// --- Apex Predator (Murkmaw) + Human Genome Fragment ---------------------------
const apexArenaCenter = new THREE.Vector3(-10, getTerrainHeight(-10, -9), -9);

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

const apexEncounterManager = new ApexEncounterManager(scene, playerController, apexController, {
  arenaCenter: apexArenaCenter,
  arenaRadius: APEX_CONFIG.arenaRadius,
  triggerRadius: APEX_CONFIG.arenaRadius + 3,
});

// --- Rival Slime + Fire Lizard --------------------------------------------------
const rivalEscapeTarget = new THREE.Vector3(-22, getTerrainHeight(-22, -20), -20);
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

// --- Fragment Contest: extraction zone + escape/reset orchestration -------------
const fragmentExtractionPosition = new THREE.Vector3(3, getTerrainHeight(3, 3), 3);
const fragmentContestManager = new FragmentContestManager({
  scene,
  playerController,
  genomeFragmentController,
  rivalController,
  uiManager,
  extractionPosition: fragmentExtractionPosition,
  resetSpawnPosition: apexArenaCenter,
});

// --- Collision System & World Scenery ------------------------------------------
const collisionSystem = new CollisionSystem();

// Subterranean Vast-Canopy Trees
const tree1Trunk = { x: 21.0, z: -7.0 };
const tree1 = createVastCanopyTree({
  seed: 0x73ee1,
  scale: 0.85,
  rotationY: Math.PI * 0.95,
  foliageColor: 0x112e22,
  sporeColor: 0x3fb98a,
});
tree1.position.set(tree1Trunk.x, getTerrainHeight(tree1Trunk.x, tree1Trunk.z), tree1Trunk.z);
scene.add(tree1);

const tree2Trunk = { x: -17.0, z: 16.0 };
const tree2 = createVastCanopyTree({
  seed: 0x73ee2,
  scale: 0.88,
  rotationY: -Math.PI * 0.25,
  foliageColor: 0x14342e,
  sporeColor: 0x6e88ff,
});
tree2.position.set(tree2Trunk.x, getTerrainHeight(tree2Trunk.x, tree2Trunk.z), tree2Trunk.z);
scene.add(tree2);

const mapExclusions = [
  { x: PLAYER_SPAWN_POSITION.x, z: PLAYER_SPAWN_POSITION.z, radius: 7 },
  { x: fragmentExtractionPosition.x, z: fragmentExtractionPosition.z, radius: 5 },
  { x: apexArenaCenter.x, z: apexArenaCenter.z, radius: APEX_CONFIG.arenaRadius + 3 },
  { x: tree1Trunk.x, z: tree1Trunk.z, radius: 1.8 },
  { x: tree2Trunk.x, z: tree2Trunk.z, radius: 1.8 },
];

const worldDressingResult = scatterWorldDressing(scene, {
  exclusions: mapExclusions,
});

const stoneClusterManager = new StoneClusterManager(
  scene,
  inventoryManager,
  resourceManager,
  uiManager,
  playerController,
  mutationSystem,
  collisionSystem
);
stoneClusterManager.populateWorldClusters({ exclusions: mapExclusions });

collisionSystem.addStatic(tree1Trunk.x, tree1Trunk.z, tree1.userData.baseColliderRadius);
collisionSystem.addStatic(tree2Trunk.x, tree2Trunk.z, tree2.userData.baseColliderRadius);

for (const rock of worldDressingResult.rocks ?? []) {
  collisionSystem.addStatic(rock.x, rock.z, rockColliderRadius(rock.scale));
}
for (const rock of apexEncounterManager.dressingRocks ?? []) {
  collisionSystem.addStatic(rock.x, rock.z, rockColliderRadius(rock.scale));
}

onTerrainElevationReady(() => {
  applyTerrainElevation(groundGeometry);

  tree1.position.y = getTerrainHeight(tree1Trunk.x, tree1Trunk.z);
  tree2.position.y = getTerrainHeight(tree2Trunk.x, tree2Trunk.z);

  fragmentExtractionPosition.y = getTerrainHeight(fragmentExtractionPosition.x, fragmentExtractionPosition.z);
  if (fragmentContestManager && fragmentContestManager.extractionZoneVisual) {
    fragmentContestManager.extractionZoneVisual.position.y = fragmentExtractionPosition.y;
  }

  resourceManager.realignToTerrain();
  stoneClusterManager.realignToTerrain();
  realignDressingToTerrain();
});

const tempColliderPos = new THREE.Vector3();
collisionSystem.addDynamicProvider(() => {
  const mesh = apexController.mesh;
  if (!mesh || !mesh.visible || apexController.state === 'DORMANT' || apexController.state === 'DEAD') return null;
  const segments = mesh.userData.segments;
  if (!segments) return null;
  const out = [];
  for (const seg of segments) {
    seg.pivot.getWorldPosition(tempColliderPos);
    out.push({
      x: tempColliderPos.x,
      z: tempColliderPos.z,
      radius: 0.68 * 0.94 * seg.scale * mesh.scale.x,
    });
  }
  return out;
});

// --- Objective Indicator -------------------------------------------------------
const objectiveIndicator = new ObjectiveIndicatorController(camera, canvas, uiManager, fragmentContestManager, genomeFragmentController);

// --- Species-Seeker Radar --------------------------------------------------------
const radarController = new RadarController({
  player,
  predatorController,
  apexController,
  rivalController,
  genomeFragmentController,
  resourceManager,
});
const radarHUD = new RadarHUD(radarController, {
  onApexSignal: () => uiManager.showRadarSignal('APEX SIGNAL'),
});

// --- Combat Controller ---------------------------------------------------------
const playerCombatController = new PlayerCombatController({
  playerController,
  damageableSources: [preyManager, predatorController, apexController, rivalController],
  uiManager,
});
playerFormController.playerCombatController = playerCombatController;

// --- Game feel: shake / hitstop / damage numbers --------------------------------
const screenShake = new ScreenShake();
const damageNumbers = new DamageNumberController(camera, canvas);

const HITSTOP_TIME_SCALE = 0.08;
let hitstopRemaining = 0;
function triggerHitstop(duration) {
  hitstopRemaining = Math.max(hitstopRemaining, duration);
}

playerCombatController.onAttackConnected = () => {
  triggerHitstop(0.055);
  screenShake.add(0.22);
};
playerCombatController.onHit = (entity, damage) => {
  damageNumbers.spawn(entity.mesh.position, damage, 'player');
};

// --- Thrown rocks ---------------------------------------------------------------
const projectileSystem = new ProjectileSystem({
  scene,
  camera,
  playerController,
  inventoryManager,
  damageableSources: [preyManager, predatorController, apexController, rivalController],
  uiManager,
});

predatorController.aimPriority = 1;
rivalController.aimPriority = 1;
apexController.aimPriority = 2;

projectileSystem.onHit = (entity, damage) => {
  damageNumbers.spawn(entity.mesh.position, damage, 'player');
};
projectileSystem.onImpact = (position, hitSomething) => {
  if (!hitSomething) return;
  triggerHitstop(0.03);
  screenShake.add(0.14);
};
projectileSystem.onFired = () => {
  mutationSystem.onInventoryChanged();
};

// Damage taken
playerHealth.onDamaged = (amount) => {
  screenShake.add(THREE.MathUtils.clamp(0.25 + (amount / playerHealth.maxHealth) * 0.9, 0, 1));
  damageNumbers.spawn(player.position, amount, 'incoming');
  amoeba.triggerSquint();
};

// Eyes widen on absorb
const originalAbsorbPulse = playerController.triggerAbsorbPulse.bind(playerController);
playerController.triggerAbsorbPulse = () => {
  originalAbsorbPulse();
  amoeba.triggerWiden();
};

// Death feedback shake
const addDefeatShake = (controller, trauma) => {
  const previousOnDefeated = controller.onDefeated;
  controller.onDefeated = (...args) => {
    previousOnDefeated?.(...args);
    screenShake.add(trauma);
  };
};
addDefeatShake(preyManager, 0.12);
addDefeatShake(predatorController, 0.3);
addDefeatShake(apexController, 0.7);

// --- Inventory UI -------------------------------------------------------------
const inventoryUI = new InventoryUI(inventoryManager, {
  mutationSystem,
  inventoryInteraction,
  inventoryWheel,
  genomeFragmentController,
  burdenSystem,
  canOpen: () => gameFlowController.state === GAME_STATES.PLAYING
    && deathRespawnManager.isPlaying
    && !playerFormController.isLocked,
  onOpen: () => {
    inputController.cancel();
    inventoryInteraction.cancelActiveGesture();
    inventoryWheel.cancel();
    gameFlowController.openInventory();
  },
  onClose: () => gameFlowController.closeInventory(),
});

{
  const previousOnRecipeChecked = mutationSystem.onRecipeChecked;
  mutationSystem.onRecipeChecked = (recipe, missing) => {
    previousOnRecipeChecked?.(recipe, missing);
    inventoryUI.refresh();
  };
}

// --- Camera follow -----------------------------------------------------------
const desiredCameraPos = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();

function updateCamera(deltaTime) {
  const zoom = memorySequenceController.getCameraZoom();
  const offsetScale = (1 - zoom) * viewZoom;
  desiredCameraPos.set(
    player.position.x + CAMERA_OFFSET.x * offsetScale,
    CAMERA_OFFSET.y * offsetScale,
    player.position.z + CAMERA_OFFSET.z * offsetScale
  );
  const smooth = 1 - Math.exp(-CAMERA_FOLLOW_SMOOTHING * deltaTime);
  camera.position.lerp(desiredCameraPos, smooth);
  cameraLookTarget.lerp(player.position, smooth);
  cameraLookTarget.y = 0;
  camera.lookAt(cameraLookTarget.x, 0, cameraLookTarget.z);

  camera.position.add(screenShake.offset);
}

// --- Random death-respawn selection --------------------------------------------
// Death drops the whole inventory at the death spot and sends Hollowdrop somewhere else
// entirely (Minecraft-style), so a death respawn picks a RANDOM valid location rather
// than the fixed canonical spawn (which a new-run reset still uses). "Valid" = inside the
// populated play area, clear of static geometry, out of the active boss arena and the
// predator's territory, and not right on top of the freshly-dropped loot.
const RESPAWN_CONFIG = {
  minRadius: 5,  // from world origin - stays in the populated play area, not the empty far ground
  maxRadius: 18,
  attempts: 30,  // hard cap: the search can never run forever
  clearance: PLAYER_RADIUS + 0.3,
  minDistFromDeathSq: 6 * 6, // don't respawn sitting on the dropped inventory
};
// Danger zones a vulnerable fresh Slime must not respawn inside. Same { x, z, radius }
// shape the collision / world-dressing exclusions already use.
const RESPAWN_EXCLUSIONS = [
  { x: apexArenaCenter.x, z: apexArenaCenter.z, radius: APEX_CONFIG.arenaRadius + 3 },
  { x: predatorHomePosition.x, z: predatorHomePosition.z, radius: 6 },
];

function isRespawnCandidateAllowed(x, z, deathLocation) {
  if (!collisionSystem.isClear(x, z, RESPAWN_CONFIG.clearance)) return false;
  for (const zone of RESPAWN_EXCLUSIONS) {
    const dx = x - zone.x;
    const dz = z - zone.z;
    if (dx * dx + dz * dz < zone.radius * zone.radius) return false;
  }
  if (deathLocation) {
    const dx = x - deathLocation.x;
    const dz = z - deathLocation.z;
    if (dx * dx + dz * dz < RESPAWN_CONFIG.minDistFromDeathSq) return false;
  }
  return true;
}

/** Random valid respawn point for a death (see RESPAWN_CONFIG). Tries a bounded number of
 *  candidates in an annulus around the origin, then falls back to the canonical spawn so
 *  the search always terminates with a usable position - never an infinite loop. */
function pickRandomRespawnPosition(deathLocation) {
  for (let attempt = 0; attempt < RESPAWN_CONFIG.attempts; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = RESPAWN_CONFIG.minRadius + Math.random() * (RESPAWN_CONFIG.maxRadius - RESPAWN_CONFIG.minRadius);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (isRespawnCandidateAllowed(x, z, deathLocation)) {
      return new THREE.Vector3(x, PLAYER_RADIUS, z);
    }
  }
  return PLAYER_SPAWN_POSITION.clone(); // bounded fallback - a valid, known-good spot
}

// Death/respawn: drops the FULL inventory into the world at the death spot (reusing the
// wheel/expel resource system), plays the collapse animation, fades, saves the death
// coordinates, and returns Hollowdrop to a RANDOM valid spawn point, always back as Slime.
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
  // Death respawns land at a random valid spot; a new-run reset still uses
  // PLAYER_SPAWN_POSITION above so resetGame()'s player-centred resource scatter
  // re-centres correctly.
  pickRespawnPosition: pickRandomRespawnPosition,
  // Keeps death-dropped items out of solid geometry (see DeathRespawnManager._resolveDropPosition).
  isPositionClear: (x, z, radius) => collisionSystem.isClear(x, z, radius),
  // Snaps the camera instantly on respawn instead of letting it slide across the
  // map to catch up - the fade covers the position jump, not a camera glide.
  onRespawnCamera: () => {
    camera.position.set(
      player.position.x + CAMERA_OFFSET.x * viewZoom,
      CAMERA_OFFSET.y * viewZoom,
      player.position.z + CAMERA_OFFSET.z * viewZoom
    );
    cameraLookTarget.copy(player.position);
  },
  onPlayerDeath: () => runStats.deaths++,
});

// Radar reads the tracked death drop from here to show a recovery marker (RadarController
// is built before DeathRespawnManager, so it's wired after construction like the rest of
// main.js's cross-references).
radarController.deathRespawnManager = deathRespawnManager;

// Keep an open inventory panel honest after a death empties it (the grid is only rebuilt
// on open, so without this a panel left open through a death would show stale item cells).
deathRespawnManager.onInventoryDropped = () => {
  if (inventoryUI.isOpen) inventoryUI.refresh();
};

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

window.addEventListener('keydown', (e) => {
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.key === 'i' || e.key === 'I') inventoryUI.toggle();
  if (e.key === 'Escape' && inventoryUI.isOpen) inventoryUI.close();
});

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
      e.preventDefault();
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

function resetGame() {
  deathRespawnManager.resetForNewRun();

  inputController.cancel();
  inventoryInteraction.cancelActiveGesture();
  inventoryWheel.cancel();
  inventoryUI.close();

  inventoryManager.reset();
  uiManager.updateMassUI(0, inventoryManager.maxWeight);

  mutationSystem.reset();
  mutationSystem.onInventoryChanged();

  resourceManager.clearAll();
  resourceManager.particles.clear();
  populateWorldResources();

  stoneClusterManager.clearAll();
  stoneClusterManager.populateWorldClusters({ exclusions: mapExclusions });

  preyManager.clearAll();
  populateWorldPrey();

  predatorController.reset();

  apexController.reset();
  apexEncounterManager.reset();

  rivalController.reset();

  genomeFragmentController.reset();
  fragmentContestManager.reset();

  screenShake.reset();
  hitstopRemaining = 0;
  damageNumbers.clear();
  projectileSystem.reset();

  uiManager.dismissTransientUI();
  objectiveIndicator.update();

  radarController.reset();
  radarHUD.reset();

  if (DEBUG_APEX || DEBUG_RIVAL || DEBUG_FRAGMENT_CONTEST) console.log('Game reset - new run started');
}

const gameFlowController = new GameFlowController({
  uiManager,
  memorySequenceController,
  runCompleteController,
  runStats,
  resetGame,
  slimeReady: amoeba.ready,
});

// --- Guided moments -------------------------------------------------------------
gameFlowController.onFirstRunBegun = () => {
  gameFlowController.showOpeningObjective({
    kicker: 'THE COLONY',
    title: 'Absorb. Adapt. Survive.',
    body: 'Roll over what you find and it becomes part of you. Combine the right DNA to '
      + 'take another creature\u2019s shape. Somewhere out here is a Human Genome Fragment '
      + '\u2014 take it, and carry it home.',
  });
};

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

genomeFragmentController.onSecured = () => {
  gameFlowController.onGenomeFragmentSecured();
  if (DEBUG_APEX || DEBUG_RIVAL) console.log(`Human Genome Fragment secured (total: ${genomeFragmentController.collectedCount})`);
};

// Dev-only inspection hook
window.__hollowdrop = {
  player,
  amoeba,
  camera,
  resourceManager,
  stoneClusterManager,
  inventoryManager,
  burdenSystem,
  playerController,
  inventoryInteraction,
  inventoryWheel,
  inventoryUI,
  collisionSystem,
  playerHealth,
  metabolismSystem,
  mutationSystem,
  playerFormController,
  predatorController,
  deathRespawnManager,
  preyManager,
  playerCombatController,
  projectileSystem,
  apexController,
  apexEncounterManager,
  genomeFragmentController,
  rivalController,
  fragmentContestManager,
  objectiveIndicator,
  radarController,
  radarHUD,
  runStats,
  gameFlowController,
  memorySequenceController,
  runCompleteController,
  resetGame,
  // Convenience read for a future radar/navigation system - the authoritative source is
  // DeathRespawnManager.getLastDeathLocation().
  getLastDeathLocation: () => deathRespawnManager.getLastDeathLocation(),
  projectItemToScreen: (item) => inventoryInteraction._worldPositionToScreen(item.visualMesh.getWorldPosition(new THREE.Vector3())),
};

const gazeScratch = new THREE.Vector3();
const GAZE_REACH_PX = 260;
function computeGaze() {
  if (!pointerScreen.seen) {
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

// --- World boundary --------------------------------------------------------------
// Keeps the player inside the actual ground plane (GROUND_SIZE, see the "--- Ground ---"
// block) by deflecting them back toward the map instead of a hard, movement-killing
// stop - a slime bouncing off the cave wall rather than just halting dead against an
// invisible barrier. Margin keeps the visible body from clipping past the ground's own
// edge before the bounce kicks in. Runs as a square boundary (matching the plane's own
// shape), independently per axis, right after collisionSystem.resolve() each frame -
// the last thing to touch player.position before anything else reads it this frame.
const WORLD_BOUNDARY_MARGIN = PLAYER_RADIUS + 2;
const WORLD_BOUNDARY_HALF = GROUND_SIZE / 2 - WORLD_BOUNDARY_MARGIN;
const BOUNDARY_BOUNCE_IMPULSE = 6; // extra inward kick, on top of simply canceling the outward velocity
const boundaryImpulseScratch = new THREE.Vector3();

function applyWorldBoundary() {
  const v = playerController.currentVelocity;

  if (player.position.x > WORLD_BOUNDARY_HALF) {
    player.position.x = WORLD_BOUNDARY_HALF;
    if (v.x > 0) {
      v.x = 0;
      playerController.applyImpulse(boundaryImpulseScratch.set(-BOUNDARY_BOUNCE_IMPULSE, 0, 0));
    }
  } else if (player.position.x < -WORLD_BOUNDARY_HALF) {
    player.position.x = -WORLD_BOUNDARY_HALF;
    if (v.x < 0) {
      v.x = 0;
      playerController.applyImpulse(boundaryImpulseScratch.set(BOUNDARY_BOUNCE_IMPULSE, 0, 0));
    }
  }

  if (player.position.z > WORLD_BOUNDARY_HALF) {
    player.position.z = WORLD_BOUNDARY_HALF;
    if (v.z > 0) {
      v.z = 0;
      playerController.applyImpulse(boundaryImpulseScratch.set(0, 0, -BOUNDARY_BOUNCE_IMPULSE));
    }
  } else if (player.position.z < -WORLD_BOUNDARY_HALF) {
    player.position.z = -WORLD_BOUNDARY_HALF;
    if (v.z < 0) {
      v.z = 0;
      playerController.applyImpulse(boundaryImpulseScratch.set(0, 0, BOUNDARY_BOUNCE_IMPULSE));
    }
  }
}

// --- Resize handling -----------------------------------------------------------
function onResize() {
  updateViewZoom();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 100));

// --- Main loop -----------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const realDeltaTime = Math.min(clock.getDelta(), 0.05);

  let deltaTime = realDeltaTime;
  if (hitstopRemaining > 0) {
    hitstopRemaining = Math.max(0, hitstopRemaining - realDeltaTime);
    deltaTime = realDeltaTime * HITSTOP_TIME_SCALE;
  }

  gameFlowController.update(deltaTime);
  memorySequenceController.update(deltaTime);

  const isPlayingState = gameFlowController.state === GAME_STATES.PLAYING;
  metabolismSystem.enabled = isPlayingState;
  radarController.setEnabled(isPlayingState);
  radarHUD.setVisible(isPlayingState);

  burdenSystem.update();
  playerController.movementSpeedMultiplier = playerFormController.getSpeedMultiplier() * burdenSystem.speedMultiplier;
  playerController.accelerationMultiplier = playerFormController.getAccelerationMultiplier() * burdenSystem.accelerationMultiplier;
  playerController.squashStretchMultiplier = playerFormController.currentForm === PLAYER_FORMS.SLIME ? 1.2 : 1.0;

  playerHealth.update(deltaTime);
  metabolismSystem.metabolismMultiplier = playerFormController.getMetabolismMultiplier();
  metabolismSystem.update(deltaTime);
  playerController.setHealthVisual(playerHealth.getHealthRatio());

  const canAct = isPlayingState && deathRespawnManager.isPlaying && !playerFormController.isLocked;
  if (canAct) {
    const input = inputController.getMovementInput();
    playerController.setTargetFromInput(input.x, input.y, input.magnitude);
  } else {
    playerController.setTargetFromInput(0, 0, 0);
  }
  playerController.update(deltaTime);
  collisionSystem.resolve(player.position, PLAYER_RADIUS, playerController.currentVelocity);
  applyWorldBoundary();

  inventoryWheel.enabled = canAct;
  if (!canAct && inventoryWheel.isOpen) inventoryWheel.cancel();

  playerCombatController.setAvailable(canAct && playerFormController.currentForm === PLAYER_FORMS.VENOM_RAT);
  playerCombatController.update(deltaTime);

  projectileSystem.setAvailable(canAct && playerFormController.currentForm === PLAYER_FORMS.SLIME);
  projectileSystem.update(deltaTime);

  if (isPlayingState) {
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
    stoneClusterManager.update(deltaTime, activePlayerPosition);
    deathRespawnManager.update(deltaTime);
  }
  objectiveIndicator.update();

  inventoryInteraction.update(deltaTime);
  inventoryManager.update(deltaTime, inventoryInteraction.getExcludedItemId());

  screenShake.update(realDeltaTime);
  damageNumbers.update(realDeltaTime);

  radarController.update(realDeltaTime);
  radarHUD.update(realDeltaTime);

  updateSlimeCreatures(realDeltaTime, camera);

  amoeba.update(realDeltaTime, {
    speedRatio: playerController.currentVelocity.length() / PLAYER_MAX_SPEED,
    load: burdenSystem.load,
    gaze: computeGaze(),
    camera,
  });

  updateCamera(deltaTime);

  renderer.render(scene, camera);
}

animate();
