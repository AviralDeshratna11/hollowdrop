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
const CAMERA_FOLLOW_SMOOTHING = 5.0; // exp smoothing speed
camera.position.copy(CAMERA_OFFSET);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

// Responsive camera zoom: maintain consistent horizontal view width on narrower aspect ratios
const REFERENCE_ASPECT = 16 / 9;
let viewZoom = 1;
function updateViewZoom() {
  const aspect = window.innerWidth / window.innerHeight;
  viewZoom = aspect < REFERENCE_ASPECT ? REFERENCE_ASPECT / Math.max(aspect, 0.5) : 1;
  camera.aspect = aspect;
  camera.far = CAMERA_FAR_BASE * viewZoom;
  camera.updateProjectionMatrix();
  if (scene.fog) {
    scene.fog.near = FOG_NEAR_BASE * viewZoom;
    scene.fog.far = FOG_FAR_BASE * viewZoom;
  }
}
updateViewZoom();

// --- Screen Shake -------------------------------------------------------------
const screenShake = new ScreenShake(camera);

// --- Damage Numbers -----------------------------------------------------------
const damageNumberController = new DamageNumberController(scene, camera);

// --- Lighting -----------------------------------------------------------------
const hemiLight = new THREE.HemisphereLight(0x73c991, 0x1a2e22, 0.9);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xa8f5c8, 1.2);
keyLight.position.set(5, 12, 8);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.8);
rimLight.position.set(-8, 6, -6);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0xd946ef, 0.35);
fillLight.position.set(0, -4, 5);
scene.add(fillLight);

// --- Ground Plane -------------------------------------------------------------
const GROUND_SEGMENTS = 320;
const groundGeometry = new THREE.PlaneGeometry(200, 200, GROUND_SEGMENTS, GROUND_SEGMENTS);

const groundTexture = new THREE.TextureLoader().load('assets/textures/cave_ground.jpg', (tex) => {
  initTextureElevation(tex.image);
});
groundTexture.wrapS = THREE.RepeatWrapping;
groundTexture.wrapT = THREE.RepeatWrapping;
const GROUND_TEXTURE_REPEAT = 3;
groundTexture.repeat.set(GROUND_TEXTURE_REPEAT, GROUND_TEXTURE_REPEAT);
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

const playerSlimeVisual = createPlayerSlimeVisual({ radius: PLAYER_RADIUS });
player.add(playerSlimeVisual.group);

const ratMesh = createRatMesh();
ratMesh.visible = false;
player.add(ratMesh);

// --- Controllers --------------------------------------------------------------
const inputController = new InputController(canvas);
const playerHealth = new PlayerHealthState();
const uiManager = new UIManager(playerHealth);
const inventoryManager = new InventoryManager(player, scene);
const resourceManager = new ResourceManager(scene, inventoryManager, uiManager);
const runStats = createRunStats();

const playerController = new PlayerController(player, inputController, inventoryManager, uiManager, resourceManager, {
  radius: PLAYER_RADIUS,
  initialMaterial: playerSlimeVisual.bodyMaterial,
  onSquintPulse: () => playerSlimeVisual.triggerSquint(),
});
playerSlimeVisual.onReady = (mat) => playerController.setActiveMaterial(mat);

const inventoryInteraction = new InventoryInteractionController(
  camera,
  inventoryManager,
  resourceManager,
  uiManager,
  playerController
);
const inventoryWheel = new InventoryWheelController(player, playerController, inventoryManager, resourceManager, uiManager, {
  playerRadius: PLAYER_RADIUS,
});
const burdenSystem = new BurdenSystem(inventoryManager, playerController, uiManager, {
  onMassDrop: (amount) => playerController.triggerMassDropSquash(amount),
});

const metabolismSystem = new MetabolismSystem(inventoryManager, playerHealth, uiManager, playerController, {
  onStarve: () => playerHealth.takeDamage(100),
  onDigestivePulse: (intensity) => playerController.triggerDigestivePulse(intensity),
  onSwallowPulse: (amount) => playerController.triggerSwallowPulse(amount),
  onFoodConsumed: () => runStats.foodConsumed++,
});

const mutationSystem = new MutationSystem(inventoryManager, uiManager, {
  onMutationUnlocked: () => runStats.mutationsUnlocked++,
});

const playerFormController = new PlayerFormController(
  playerController,
  playerSlimeVisual,
  ratMesh,
  mutationSystem,
  uiManager,
  {
    onTransformed: (form) => {
      playerCombatController.setAvailable(form === PLAYER_FORMS.VENOM_RAT);
      if (form === PLAYER_FORMS.VENOM_RAT) runStats.transformationsUsed++;
    },
    onReverted: () => {
      playerCombatController.setAvailable(false);
    },
  }
);

const playerCombatController = new PlayerCombatController(
  player,
  playerController,
  ratMesh,
  uiManager,
  damageNumberController,
  screenShake
);

// --- Pre-populate World Resources ---------------------------------------------
function populateWorldResources() {
  resourceManager.spawnTestZone(new THREE.Vector3(0, 0, 0));

  resourceManager.spawnResource('mushroom', new THREE.Vector3(12, getTerrainHeight(12, 10), 10));
  resourceManager.spawnResource('mushroom', new THREE.Vector3(14, getTerrainHeight(14, 8), 8));
  resourceManager.spawnResource('mushroom', new THREE.Vector3(11, getTerrainHeight(11, 13), 13));

  resourceManager.spawnResource('spore', new THREE.Vector3(-12, getTerrainHeight(-12, 8), 8));
  resourceManager.spawnResource('spore', new THREE.Vector3(-15, getTerrainHeight(-15, 11), 11));
  resourceManager.spawnResource('spore', new THREE.Vector3(-10, getTerrainHeight(-10, 14), 14));

  resourceManager.spawnResource('iron', new THREE.Vector3(8, getTerrainHeight(8, -12), -12));
  resourceManager.spawnResource('iron', new THREE.Vector3(11, getTerrainHeight(11, -15), -15));

  resourceManager.spawnResource('toxic_gland', new THREE.Vector3(-8, getTerrainHeight(-8, -14), -14));
  resourceManager.spawnResource('toxic_gland', new THREE.Vector3(-11, getTerrainHeight(-11, -11), -11));

  resourceManager.spawnResource('rat_dna', new THREE.Vector3(-10, getTerrainHeight(-10, 6), 6));

  for (const [x, z] of [[-5, 4], [7, -5], [-8, 8], [9, 2], [-14, -4], [11, 9]]) {
    resourceManager.spawnResource('blue_mushroom', new THREE.Vector3(x, getTerrainHeight(x, z), z));
  }
}
populateWorldResources();

// --- Predator (Cave Stalker) ---------------------------------------------------
const predatorHomePosition = new THREE.Vector3(10, getTerrainHeight(10, 8), 8);
const predatorController = new PredatorController(scene, predatorHomePosition, playerController, playerHealth, uiManager, resourceManager, {
  onDefeated: () => runStats.predatorsDefeated++,
});
predatorController.aimPriority = 1;
playerCombatController.registerTarget(predatorController);

// --- Prey (Glow Beetles) -------------------------------------------------------
const preyManager = new PreyManager(scene, playerController, playerCombatController, resourceManager, {
  onHarvested: () => runStats.preyHarvested++,
});
preyManager.aimPriority = 0;

function populateWorldPrey() {
  for (const [x, z] of [[-6, -4], [-3, 8], [6, -6], [3, -3]]) {
    preyManager.spawnGlowBeetle(new THREE.Vector3(x, getTerrainHeight(x, z), z));
  }
}
populateWorldPrey();

// --- Apex Predator (Murkmaw) ---------------------------------------------------
const apexArenaCenter = new THREE.Vector3(-10, getTerrainHeight(-10, -9), -9);

const genomeFragmentController = new GenomeFragmentController(scene, uiManager);

const apexController = new ApexController({
  scene,
  arenaCenter: apexArenaCenter,
  playerController,
  playerHealth,
  uiManager,
  resourceManager,
  genomeFragmentController,
  screenShake,
  damageNumbers: damageNumberController,
  onDefeated: () => {
    runStats.apexDefeated = true;
    apexEncounterManager.onApexDefeated();
  },
});
apexController.aimPriority = 2;
playerCombatController.registerTarget(apexController);

const apexEncounterManager = new ApexEncounterManager(scene, playerController, apexController, {
  arenaCenter: apexArenaCenter,
  onArenaSealed: () => {},
});

// --- Rival Slime ---------------------------------------------------------------
const rivalEscapeTarget = new THREE.Vector3(-22, getTerrainHeight(-22, -20), -20);
const rivalController = new RivalController({
  scene,
  arenaCenter: apexArenaCenter,
  escapeTarget: rivalEscapeTarget,
  playerController,
  playerCombatController,
  genomeFragmentController,
  resourceManager,
  uiManager,
  damageNumbers: damageNumberController,
  screenShake,
  onDefeated: () => runStats.rivalDefeated = true,
  onEscaped: () => gameFlowController.onRivalEscaped(),
});
rivalController.aimPriority = 1;
playerCombatController.registerTarget(rivalController);

// --- Fragment Contest & Extraction --------------------------------------------
const fragmentExtractionPosition = new THREE.Vector3(3, getTerrainHeight(3, 3), 3);
const fragmentContestManager = new FragmentContestManager({
  scene,
  playerController,
  rivalController,
  genomeFragmentController,
  uiManager,
  extractionPosition: fragmentExtractionPosition,
  resetSpawnPosition: apexArenaCenter,
  onExtractionComplete: () => gameFlowController.onExtractionSuccess(),
});

// --- Objective Indicator -------------------------------------------------------
const objectiveIndicator = new ObjectiveIndicatorController(
  camera,
  playerController,
  genomeFragmentController,
  fragmentContestManager,
  rivalController
);

// --- Collision System ---------------------------------------------------------
const collisionSystem = new CollisionSystem();

// --- Subterranean Vast-Canopy Trees --------------------------------------------
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

collisionSystem.addDynamic(
  () => (apexController.state !== 'dormant' && apexController.state !== 'dead' ? apexController.mesh.position : null),
  APEX_CONFIG.bodyRadius
);

playerController.setCollisionSystem(collisionSystem);
predatorController.setCollisionSystem(collisionSystem);
preyManager.setCollisionSystem(collisionSystem);

// --- Projectile System (Rock Thrown Ranged Attack) -----------------------------
const projectileSystem = new ProjectileSystem({
  scene,
  camera,
  playerController,
  inventoryManager,
  uiManager,
  damageNumberController,
  collisionSystem,
  damageableSources: [
    predatorController,
    apexController,
    rivalController,
    preyManager,
  ],
});

// --- Radar System -------------------------------------------------------------
const radarController = new RadarController(player, {
  detectionRadius: 28,
  sources: {
    predator: predatorController,
    prey: preyManager,
    apex: apexController,
    rival: rivalController,
    fragment: genomeFragmentController,
    resource: resourceManager,
  },
});
const radarHUD = new RadarHUD(radarController);
radarController.setEnabled(true);
radarHUD.setEnabled(true);

// --- Inventory UI -------------------------------------------------------------
const inventoryUI = new InventoryUI(
  inventoryManager,
  metabolismSystem,
  mutationSystem,
  resourceManager,
  player,
  playerController
);

// --- Death / Respawn ----------------------------------------------------------
const deathRespawnManager = new DeathRespawnManager({
  player,
  playerHealth,
  playerController,
  inventoryManager,
  resourceManager,
  uiManager,
  spawnPosition: PLAYER_SPAWN_POSITION,
  camera,
  cameraOffset: CAMERA_OFFSET,
  predatorController,
  onDeath: () => {
    runStats.deaths++;
    playerFormController.resetToBaseSlime();
  },
});

// --- Memory Sequence & Run Complete ------------------------------------------
const memorySequenceController = new MemorySequenceController();
const runCompleteController = new RunCompleteController();

// --- Game Flow Controller -----------------------------------------------------
const gameFlowController = new GameFlowController({
  uiManager,
  playerHealth,
  playerController,
  inventoryManager,
  resourceManager,
  metabolismSystem,
  mutationSystem,
  playerFormController,
  apexController,
  apexEncounterManager,
  rivalController,
  fragmentContestManager,
  genomeFragmentController,
  memorySequenceController,
  runCompleteController,
  runStats,
  onResetRun: () => resetRunToStart(),
});

function resetRunToStart() {
  runStats.runStartTime = performance.now();
  runStats.deaths = 0;
  runStats.foodConsumed = 0;
  runStats.mutationsUnlocked = 0;
  runStats.transformationsUsed = 0;
  runStats.predatorsDefeated = 0;
  runStats.preyHarvested = 0;
  runStats.apexDefeated = false;
  runStats.rivalDefeated = false;

  player.position.copy(PLAYER_SPAWN_POSITION);
  playerController.currentVelocity.set(0, 0, 0);
  camera.position.copy(PLAYER_SPAWN_POSITION).add(CAMERA_OFFSET);

  playerHealth.reset();
  playerFormController.resetToBaseSlime();

  inventoryManager.clearAll();
  inventoryUI.close();

  resourceManager.clearAll();
  resourceManager.particles.clear();
  populateWorldResources();

  stoneClusterManager.clearAll();
  stoneClusterManager.populateWorldClusters({ exclusions: mapExclusions });

  preyManager.clearAll();
  populateWorldPrey();

  projectileSystem.clear();

  predatorController.reset(predatorHomePosition);

  apexController.reset();
  apexEncounterManager.reset();

  rivalController.reset();
  genomeFragmentController.reset();
  fragmentContestManager.reset();

  metabolismSystem.reset();
  mutationSystem.reset();
}

// --- Animation Loop -----------------------------------------------------------
let lastTime = performance.now();
const MAX_DELTA = 0.1;
const tempTarget = new THREE.Vector3();
const OFFSCREEN_POSITION = new THREE.Vector3(99999, 99999, 99999);

function animate(currentTime) {
  requestAnimationFrame(animate);

  const rawDelta = (currentTime - lastTime) / 1000;
  lastTime = currentTime;
  const deltaTime = Math.min(rawDelta, MAX_DELTA);

  updateSlimeCreatures(deltaTime);

  if (gameFlowController.currentState === GAME_STATES.PLAYING) {
    const isFragmentActive = genomeFragmentController.state !== FRAGMENT_STATES.DORMANT;
    const canAct = deathRespawnManager.isPlaying && !isFragmentActive;

    playerController.setCanMove(canAct);
    inventoryInteraction.setCanInteract(canAct);
    inventoryWheel.setAvailable(canAct);
    metabolismSystem.setAvailable(canAct);
    playerCombatController.setAvailable(canAct && playerFormController.currentForm === PLAYER_FORMS.VENOM_RAT);
    projectileSystem.setAvailable(canAct && playerFormController.currentForm === PLAYER_FORMS.BASE_SLIME);

    playerController.update(deltaTime);
    playerSlimeVisual.update(deltaTime, {
      speedRatio: playerController.getSpeedRatio(),
      load: burdenSystem.getLoadRatio(),
    });
    playerFormController.update(deltaTime);
    playerCombatController.update(deltaTime);
    projectileSystem.update(deltaTime);

    predatorController.update(deltaTime);
    preyManager.update(deltaTime);
    apexController.update(deltaTime);
    apexEncounterManager.update(deltaTime);
    genomeFragmentController.update(deltaTime);
    rivalController.update(deltaTime);
    fragmentContestManager.update(deltaTime);

    metabolismSystem.update(deltaTime);
    inventoryManager.updateVisualPositions(deltaTime);
    inventoryInteraction.update();
    inventoryWheel.update(deltaTime);
    burdenSystem.update(deltaTime);
    damageNumberController.update(deltaTime);
    radarController.update(deltaTime);
    radarHUD.update();

    if (deathRespawnManager.isPlaying) {
      tempTarget.copy(player.position);
      const smooth = 1 - Math.exp(-CAMERA_FOLLOW_SMOOTHING * deltaTime);
      camera.position.lerp(tempTarget.addScaledVector(CAMERA_OFFSET, viewZoom), smooth);
    }

    const activePlayerPosition = deathRespawnManager.isPlaying ? player.position : OFFSCREEN_POSITION;
    resourceManager.update(deltaTime, activePlayerPosition);
    stoneClusterManager.update(deltaTime, activePlayerPosition);
    deathRespawnManager.update(deltaTime);
  }
  objectiveIndicator.update();

  screenShake.update(deltaTime);
  renderer.render(scene, camera);
}

// --- Window Resize ------------------------------------------------------------
window.addEventListener('resize', () => {
  updateViewZoom();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Start --------------------------------------------------------------------
gameFlowController.start();
requestAnimationFrame(animate);
