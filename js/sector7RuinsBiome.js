import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js?v=5.3';
import {
  playFluorescentFlickerSound,
  playCircuitPowerSound,
  playBlastDoorSound,
  playLaserChargeSound,
  playLaserHumSound,
  playLaserBurnSound,
  playTerminalInteractSound,
} from './soundEffects.js?v=5.3';
import { calculateAttackDamage } from './combatUtils.js?v=5.3';


/**
 * sector7RuinsBiome.js — Ancient Pre-Collapse Research Ruins (Sector 7)
 *
 * High-Fidelity Subterranean Laboratory Ruins:
 * 1. PBR Procedural Textures & Materials:
 *    - Heavy rusted industrial steel bulkheads with rivets, corrosion, and micro-roughness.
 *    - Weathered yellow & black hazard warning safety stripes.
 *    - Cracked double-walled containment glass with floating bio-specimens & bubble VFX.
 *    - Defunct biometric hand scanner terminals with glowing palm grids & fungal lichen.
 *    - Power conduit cables with animated pulsing electric current shaders.
 * 2. Atmospheric Lighting & VFX:
 *    - 3D fluorescent tube light fixtures with dynamic ballast flicker & local PointLights.
 *    - Holographic terminal projections with scanlines, rotating wireframe models, and lore archives.
 *    - High-voltage electrical arc particles and laser discharge sparks.
 * 3. Interactive Puzzle & Defense Mechanics:
 *    - Electrical Pressure Plates & Conduit Nodes: Conductive iron ore completes circuits,
 *      energizing power lines and opening massive hydraulic security blast doors.
 *    - Cycling Defense Laser Barriers: Rhythmic timer cycle (Warning -> Active -> Safe),
 *      rewarding rhythm and dash timing.
 *    - Vault Rewards & Master Hologram Archive.
 */

// --- Procedural Canvas PBR Texture Generators ---------------------------------

/**
 * Heavy oxidized rusted steel bulkhead texture with rivets and surface grime.
 */
function createRustedSteelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Base metallic dark gunmetal gray
  ctx.fillStyle = '#26282c';
  ctx.fillRect(0, 0, 512, 512);

  // Brushed metal & oxide noise
  for (let i = 0; i < 8000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = Math.random() * 3 + 1;
    const brightness = Math.random() * 35 + 20;
    ctx.fillStyle = `rgb(${brightness}, ${brightness + 2}, ${brightness + 4})`;
    ctx.fillRect(x, y, size, 1.5);
  }

  // Rust corrosion patches (burnt sienna / deep orange-brown)
  for (let p = 0; p < 18; p++) {
    const cx = Math.random() * 512;
    const cy = Math.random() * 512;
    const rad = Math.random() * 60 + 20;
    const rustGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
    rustGrad.addColorStop(0.0, 'rgba(145, 55, 20, 0.85)');
    rustGrad.addColorStop(0.4, 'rgba(110, 42, 16, 0.70)');
    rustGrad.addColorStop(0.75, 'rgba(75, 30, 15, 0.40)');
    rustGrad.addColorStop(1.0, 'rgba(40, 40, 45, 0.0)');

    ctx.fillStyle = rustGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Seam panel grooves
  ctx.strokeStyle = '#101214';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 256); ctx.lineTo(512, 256);
  ctx.moveTo(256, 0); ctx.lineTo(256, 512);
  ctx.stroke();

  // Rivets / bolts along seams
  ctx.fillStyle = '#3a3d44';
  ctx.strokeStyle = '#0e1012';
  ctx.lineWidth = 1;
  const rivetSteps = [32, 96, 160, 224, 288, 352, 416, 480];
  for (const rx of rivetSteps) {
    for (const ry of [16, 240, 272, 496]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Roughness map: bare steel is smooth/shiny (darker), rusted patches are rough/matte (lighter).
 */
function createRustedSteelRoughnessMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Base steel roughness ~0.4
  ctx.fillStyle = '#666666';
  ctx.fillRect(0, 0, 256, 256);

  // High roughness for rust
  for (let p = 0; p < 15; p++) {
    const cx = Math.random() * 256;
    const cy = Math.random() * 256;
    const rad = Math.random() * 45 + 15;
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
    grad.addColorStop(0.0, 'rgba(230, 230, 230, 0.9)');
    grad.addColorStop(0.7, 'rgba(170, 170, 170, 0.5)');
    grad.addColorStop(1.0, 'rgba(100, 100, 100, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Yellow & black diagonal hazard warning safety stripes.
 */
function createHazardStripeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = '#e2a112';
  const stripeWidth = 32;
  for (let i = -256; i < 512; i += stripeWidth * 2) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + stripeWidth, 0);
    ctx.lineTo(i + stripeWidth + 256, 256);
    ctx.lineTo(i + 256, 256);
    ctx.closePath();
    ctx.fill();
  }

  // Weathering scuffs & grime overlay
  ctx.fillStyle = 'rgba(20, 25, 20, 0.35)';
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.fillRect(x, y, Math.random() * 25 + 5, Math.random() * 8 + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Defunct Biometric Hand Scanner texture with glowing palm print and terminal status.
 */
function createBiometricScannerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Dark terminal housing
  ctx.fillStyle = '#121418';
  ctx.fillRect(0, 0, 256, 256);

  // Outer bezel & scan area
  ctx.strokeStyle = '#353a42';
  ctx.lineWidth = 6;
  ctx.strokeRect(16, 16, 224, 224);

  // Red/Amber scanning grid lines
  ctx.strokeStyle = 'rgba(255, 55, 55, 0.4)';
  ctx.lineWidth = 1.5;
  for (let y = 32; y < 224; y += 16) {
    ctx.beginPath();
    ctx.moveTo(24, y); ctx.lineTo(232, y);
    ctx.stroke();
  }

  // Glowing palm silhouette contour
  ctx.fillStyle = 'rgba(255, 60, 60, 0.75)';
  ctx.strokeStyle = 'rgba(255, 120, 120, 0.9)';
  ctx.lineWidth = 2;

  // Palm base
  ctx.beginPath();
  ctx.arc(128, 155, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 5 Fingers
  const fingers = [
    { x: 86, y: 135, len: 32, w: 8, angle: -0.35 }, // Thumb
    { x: 104, y: 95, len: 44, w: 7, angle: -0.12 }, // Index
    { x: 128, y: 85, len: 50, w: 7, angle: 0.0 },   // Middle
    { x: 152, y: 95, len: 45, w: 7, angle: 0.12 },  // Ring
    { x: 170, y: 110, len: 36, w: 6, angle: 0.28 }, // Pinky
  ];

  for (const f of fingers) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.beginPath();
    ctx.roundRect(-f.w / 2, -f.len / 2, f.w, f.len, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Warning text
  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ACCESS DENIED', 128, 210);
  ctx.font = '10px monospace';
  ctx.fillStyle = '#888888';
  ctx.fillText('SECTOR 07 // DEFUNCT', 128, 42);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Metal floor grating texture with drainage slots.
 */
function createMetalGrateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1c1e22';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = '#08090a';
  for (let x = 12; x < 256; x += 32) {
    for (let y = 12; y < 256; y += 32) {
      ctx.fillRect(x, y, 20, 20);
    }
  }

  ctx.strokeStyle = '#3a3e46';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
  }
  for (let y = 0; y <= 256; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Holographic monitor scanline and retro data display texture.
 */
function createHologramTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Dark translucent cyan background
  ctx.fillStyle = 'rgba(2, 24, 32, 0.88)';
  ctx.fillRect(0, 0, 512, 256);

  // CRT scanlines
  ctx.fillStyle = 'rgba(0, 225, 255, 0.08)';
  for (let y = 0; y < 256; y += 4) {
    ctx.fillRect(0, y, 512, 2);
  }

  // Cyan frame
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 496, 240);

  // Header
  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('► PRE-COLLAPSE ARCHIVE // SECTOR 07', 24, 40);

  // Telemetry logs
  ctx.font = '13px monospace';
  ctx.fillStyle = '#6df4ff';
  ctx.fillText('STATUS: CONTAINMENT BREACH CRITICAL', 24, 75);
  ctx.fillText('SUBJECT: HOLLOWDROP (GENOME ADAPTIVE)', 24, 100);
  ctx.fillText('POWER MATRIX: CONDUCTIVE ORE INTERLOCK', 24, 125);
  ctx.fillText('RESEARCH LOG 409 // BIO-MUTATION ARCHIVED', 24, 150);

  // Telemetry waveform
  ctx.strokeStyle = '#00ffc4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 24; x < 488; x += 4) {
    const y = 200 + Math.sin(x * 0.08) * 16 + Math.cos(x * 0.18) * 8;
    if (x === 24) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// --- Main Sector 7 Ruins Biome Class ------------------------------------------

export class Sector7RuinsBiome {
  constructor(scene, {
    playerController,
    inventoryManager,
    resourceManager,
    playerHealth,
    uiManager,
    collisionSystem,
    screenShake,
  }) {
    this.scene = scene;
    this.playerController = playerController;
    this.inventoryManager = inventoryManager;
    this.resourceManager = resourceManager;
    this.playerHealth = playerHealth;
    this.uiManager = uiManager;
    this.collisionSystem = collisionSystem;
    this.screenShake = screenShake;

    this.root = new THREE.Group();
    this.root.name = 'sector-7-ruins';
    this.scene.add(this.root);

    // Geographic center of Sector 7 Ruins in South-East quadrant
    this.origin = new THREE.Vector3(23.0, 0, -25.0);

    // Shared procedural materials
    this._initMaterials();

    // Structural elements
    this.colliders = [];
    this.blastDoorColliders = [];
    this.fluorescentLights = [];
    this.containmentPods = [];
    this.hologramMeshes = [];
    this.pressurePlates = [];
    this.laserBarriers = [];
    this.conduitWires = [];

    // State
    this.isVaultUnlocked = false;
    this.blastDoorProgress = 0; // 0 = closed, 1 = fully open
    this.blastDoorLeft = null;
    this.blastDoorRight = null;
    this.masterTerminalPos = new THREE.Vector3(this.origin.x, 0, this.origin.y - 8.5);
    this.hasDiscoveredSector7 = false;
    this.hasReadMasterLog = false;
    this.time = 0;

    // Build the ruins environment
    this._buildArchitecture();
    this._buildContainmentChamber();
    this._buildBiometricScanners();
    this._buildFluorescentLights();
    this._buildHolographicTerminals();
    this._buildPowerCircuitPuzzle();
    this._buildLaserDefenseBarriers();
    this._buildVaultRewards();

    // Register initial colliders
    this._registerColliders();
  }

  _initMaterials() {
    this.rustedSteelTex = createRustedSteelTexture();
    this.rustedRoughnessMap = createRustedSteelRoughnessMap();
    this.hazardTex = createHazardStripeTexture();
    this.scannerTex = createBiometricScannerTexture();
    this.grateTex = createMetalGrateTexture();
    this.hologramTex = createHologramTexture();

    // Rusted metallic bulkhead PBR material
    this.bulkheadMaterial = new THREE.MeshStandardMaterial({
      map: this.rustedSteelTex,
      roughnessMap: this.rustedRoughnessMap,
      roughness: 0.65,
      metalness: 0.82,
      color: 0x90959e,
    });

    // Hazard stripe material
    this.hazardMaterial = new THREE.MeshStandardMaterial({
      map: this.hazardTex,
      roughness: 0.55,
      metalness: 0.45,
    });

    // Grated metal floor material
    this.grateMaterial = new THREE.MeshStandardMaterial({
      map: this.grateTex,
      roughness: 0.7,
      metalness: 0.85,
      color: 0x828892,
    });

    // Cracked containment glass
    this.glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x9ce8ff,
      transmission: 0.72,
      opacity: 0.65,
      transparent: true,
      roughness: 0.15,
      metalness: 0.1,
      ior: 1.45,
    });

    // Bio-preservative glowing fluid inside pods
    this.specimenFluidMaterial = new THREE.MeshStandardMaterial({
      color: 0x00e5b2,
      emissive: 0x009977,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.55,
      roughness: 0.2,
    });

    // Power conduit wire material (animates emissive glow)
    this.conduitMaterial = new THREE.MeshStandardMaterial({
      color: 0x222428,
      emissive: 0x004455,
      emissiveIntensity: 0.6,
      roughness: 0.5,
      metalness: 0.7,
    });

    // Active high-energy conduit material
    this.activeConduitMaterial = new THREE.MeshStandardMaterial({
      color: 0x112233,
      emissive: 0x00e5ff,
      emissiveIntensity: 2.2,
      roughness: 0.3,
      metalness: 0.9,
    });

    // Fluorescent tube light glass
    this.fluorescentTubeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xd6f7ff,
      emissiveIntensity: 2.4,
      roughness: 0.2,
    });

    // Hologram additive projection material
    this.hologramMaterial = new THREE.MeshBasicMaterial({
      map: this.hologramTex,
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Hologram projection cone beam
    this.holoBeamMaterial = new THREE.MeshBasicMaterial({
      color: 0x00c4ff,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Laser barrier beam material
    this.laserBeamMaterial = new THREE.MeshBasicMaterial({
      color: 0xff2244,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Laser warning floor grid
    this.laserWarningMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  // --- Building Sector 7 Architecture -----------------------------------------

  _buildArchitecture() {
    const ox = this.origin.x;
    const oz = this.origin.z;

    // 1. Grated Metal Floor Bedding for Sector 7 Corridor & Chambers
    const floorGeo = new THREE.PlaneGeometry(16, 22);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMesh = new THREE.Mesh(floorGeo, this.grateMaterial);
    floorMesh.position.set(ox, getTerrainHeight(ox, oz) + 0.04, oz);
    this.root.add(floorMesh);

    // 2. Heavy Industrial Bulkhead Entrance Arch (at Z = -16.0)
    this._buildBulkheadArch(ox, -16.0, 5.2, 4.2);

    // 3. Reinforced Perimeter Corridor Walls
    // Left Corridor Wall (X = ox - 5.5)
    this._buildWallSegment(ox - 5.5, oz + 4.0, 1.2, 10.0, 3.8);
    this._buildWallSegment(ox - 5.5, oz - 6.0, 1.2, 10.0, 3.8);

    // Right Corridor Wall (X = ox + 5.5)
    this._buildWallSegment(ox + 5.5, oz + 4.0, 1.2, 10.0, 3.8);
    this._buildWallSegment(ox + 5.5, oz - 6.0, 1.2, 10.0, 3.8);

    // North Vault Back Wall (Z = oz - 11.5)
    this._buildWallSegment(ox, oz - 11.5, 12.0, 1.2, 4.2);

    // 4. Heavy Reinforced Security Blast Doors (at Z = oz - 4.5)
    this._buildBlastDoors(ox, oz - 4.5);

    // 5. Creeping Fungal Overgrowth Tendrils on Rusted Walls
    this._buildFungalOvergrowth(ox, oz);
  }

  _buildBulkheadArch(x, z, width, height) {
    const archGroup = new THREE.Group();
    archGroup.position.set(x, getTerrainHeight(x, z), z);

    // Left pillar
    const pillarGeo = new THREE.BoxGeometry(0.9, height, 1.2);
    const leftPillar = new THREE.Mesh(pillarGeo, this.bulkheadMaterial);
    leftPillar.position.set(-width / 2, height / 2, 0);
    archGroup.add(leftPillar);

    // Right pillar
    const rightPillar = new THREE.Mesh(pillarGeo, this.bulkheadMaterial);
    rightPillar.position.set(width / 2, height / 2, 0);
    archGroup.add(rightPillar);

    // Top lintel beam
    const lintelGeo = new THREE.BoxGeometry(width + 1.2, 0.9, 1.4);
    const lintel = new THREE.Mesh(lintelGeo, this.bulkheadMaterial);
    lintel.position.set(0, height - 0.2, 0);
    archGroup.add(lintel);

    // Hazard stripe trim across the lintel
    const hazardTrimGeo = new THREE.BoxGeometry(width + 0.8, 0.28, 1.45);
    const hazardTrim = new THREE.Mesh(hazardTrimGeo, this.hazardMaterial);
    hazardTrim.position.set(0, height - 0.7, 0);
    archGroup.add(hazardTrim);

    this.root.add(archGroup);

    // Add solid colliders for the pillars
    this.colliders.push(
      { x: x - width / 2, z, radius: 0.85 },
      { x: x + width / 2, z, radius: 0.85 }
    );
  }

  _buildWallSegment(x, z, sizeX, sizeZ, height) {
    const wallGeo = new THREE.BoxGeometry(sizeX, height, sizeZ);
    const wallMesh = new THREE.Mesh(wallGeo, this.bulkheadMaterial);
    const y = getTerrainHeight(x, z);
    wallMesh.position.set(x, y + height / 2, z);
    this.root.add(wallMesh);

    // Hazard footers
    const footerGeo = new THREE.BoxGeometry(sizeX + 0.08, 0.35, sizeZ + 0.08);
    const footerMesh = new THREE.Mesh(footerGeo, this.hazardMaterial);
    footerMesh.position.set(x, y + 0.18, z);
    this.root.add(footerMesh);

    // Add solid colliders along the wall segment
    const count = Math.max(1, Math.round(Math.max(sizeX, sizeZ) / 1.8));
    const stepX = sizeX > sizeZ ? sizeX / count : 0;
    const stepZ = sizeZ >= sizeX ? sizeZ / count : 0;
    const startX = x - (sizeX / 2) + (stepX / 2 || 0);
    const startZ = z - (sizeZ / 2) + (stepZ / 2 || 0);

    for (let i = 0; i < count; i++) {
      this.colliders.push({
        x: startX + stepX * i,
        z: startZ + stepZ * i,
        radius: Math.min(sizeX, sizeZ) * 0.65 + 0.25,
      });
    }
  }

  _buildBlastDoors(x, z) {
    const doorGroup = new THREE.Group();
    doorGroup.position.set(x, getTerrainHeight(x, z), z);

    const doorHeight = 3.6;
    const doorWidth = 2.4;
    const doorThickness = 0.55;

    // Left Sliding Blast Door Leaf
    const doorLeafGeo = new THREE.BoxGeometry(doorWidth, doorHeight, doorThickness);
    this.blastDoorLeft = new THREE.Mesh(doorLeafGeo, this.bulkheadMaterial);
    this.blastDoorLeft.position.set(-doorWidth / 2, doorHeight / 2, 0);

    // Hazard trim on door edge
    const hazardGeo = new THREE.BoxGeometry(0.3, doorHeight - 0.2, doorThickness + 0.05);
    const hazardLeft = new THREE.Mesh(hazardGeo, this.hazardMaterial);
    hazardLeft.position.set(doorWidth / 2 - 0.16, 0, 0);
    this.blastDoorLeft.add(hazardLeft);
    doorGroup.add(this.blastDoorLeft);

    // Right Sliding Blast Door Leaf
    this.blastDoorRight = new THREE.Mesh(doorLeafGeo, this.bulkheadMaterial);
    this.blastDoorRight.position.set(doorWidth / 2, doorHeight / 2, 0);

    const hazardRight = new THREE.Mesh(hazardGeo, this.hazardMaterial);
    hazardRight.position.set(-doorWidth / 2 + 0.16, 0, 0);
    this.blastDoorRight.add(hazardRight);
    doorGroup.add(this.blastDoorRight);

    // Overhead Hydraulic Piston Housing
    const housingGeo = new THREE.BoxGeometry(doorWidth * 2 + 1.2, 0.75, 0.9);
    const housing = new THREE.Mesh(housingGeo, this.bulkheadMaterial);
    housing.position.set(0, doorHeight + 0.35, 0);
    doorGroup.add(housing);

    // Central Status Lock Light
    const lockLightGeo = new THREE.SphereGeometry(0.22, 12, 12);
    this.lockLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xff1122,
      emissive: 0xff0022,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    this.lockLightMesh = new THREE.Mesh(lockLightGeo, this.lockLightMaterial);
    this.lockLightMesh.position.set(0, doorHeight + 0.35, 0.5);
    doorGroup.add(this.lockLightMesh);

    this.root.add(doorGroup);

    // Colliders for the closed door (will be deactivated upon opening)
    this.doorColliderLeft = { x: x - 1.1, z, radius: 0.95 };
    this.doorColliderRight = { x: x + 1.1, z, radius: 0.95 };
    this.blastDoorColliders.push(this.doorColliderLeft, this.doorColliderRight);
    this.colliders.push(this.doorColliderLeft, this.doorColliderRight);
  }

  _buildFungalOvergrowth(ox, oz) {
    // Bioluminescent creeping fungal tendrils & shelf mushrooms
    const fungalMat = new THREE.MeshStandardMaterial({
      color: 0x184232,
      emissive: 0x00e599,
      emissiveIntensity: 0.65,
      roughness: 0.35,
    });

    const tendrilSpots = [
      { x: ox - 4.8, z: oz - 2.0, scale: 1.1 },
      { x: ox + 4.8, z: oz + 1.5, scale: 0.95 },
      { x: ox - 4.6, z: oz + 6.0, scale: 1.2 },
      { x: ox + 4.7, z: oz - 7.0, scale: 1.3 },
    ];

    for (const spot of tendrilSpots) {
      const tendrilGroup = new THREE.Group();
      const y = getTerrainHeight(spot.x, spot.z);
      tendrilGroup.position.set(spot.x, y, spot.z);

      // Shelf mushroom tiers
      for (let t = 0; t < 3; t++) {
        const shelfGeo = new THREE.CylinderGeometry(0.35 * spot.scale * (1 - t * 0.2), 0.1, 0.08, 12);
        const shelf = new THREE.Mesh(shelfGeo, fungalMat);
        shelf.position.set(0, 0.5 + t * 0.45, 0);
        shelf.rotation.z = 0.25;
        tendrilGroup.add(shelf);
      }
      this.root.add(tendrilGroup);
    }
  }

  // --- Cracked Containment Glass Cylinders (Cryo Pods) ------------------------

  _buildContainmentChamber() {
    const ox = this.origin.x;
    const oz = this.origin.z;

    const podPositions = [
      { x: ox - 3.8, z: oz - 8.0, specimenColor: 0x00ffcc },
      { x: ox + 3.8, z: oz - 8.0, specimenColor: 0xff00d4 },
      { x: ox - 3.8, z: oz + 2.0, specimenColor: 0x7cff4d },
      { x: ox + 3.8, z: oz + 2.0, specimenColor: 0x00d2ff },
    ];

    for (const p of podPositions) {
      const podGroup = new THREE.Group();
      const y = getTerrainHeight(p.x, p.z);
      podGroup.position.set(p.x, y, p.z);

      const radius = 0.85;
      const height = 2.8;

      // 1. Base Pedestal
      const baseGeo = new THREE.CylinderGeometry(radius * 1.15, radius * 1.25, 0.5, 18);
      const baseMesh = new THREE.Mesh(baseGeo, this.bulkheadMaterial);
      baseMesh.position.y = 0.25;
      podGroup.add(baseMesh);

      // 2. Top Manifold with Pressure Pipes
      const topGeo = new THREE.CylinderGeometry(radius * 1.2, radius * 1.15, 0.45, 18);
      const topMesh = new THREE.Mesh(topGeo, this.bulkheadMaterial);
      topMesh.position.y = height + 0.45;
      podGroup.add(topMesh);

      // 3. Outer Glass Cylinder (Double-walled)
      const glassGeo = new THREE.CylinderGeometry(radius, radius, height, 20, 1, true);
      const glassMesh = new THREE.Mesh(glassGeo, this.glassMaterial);
      glassMesh.position.y = height / 2 + 0.4;
      podGroup.add(glassMesh);

      // 4. Internal Glowing Bio-Fluid
      const fluidGeo = new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, height * 0.88, 16);
      const fluidMat = this.specimenFluidMaterial.clone();
      fluidMat.emissive.setHex(p.specimenColor);
      const fluidMesh = new THREE.Mesh(fluidGeo, fluidMat);
      fluidMesh.position.y = height / 2 + 0.4;
      podGroup.add(fluidMesh);

      // 5. Internal Floating Bio-Specimen
      const specimenGeo = new THREE.DodecahedronGeometry(0.32, 1);
      const specimenMat = new THREE.MeshStandardMaterial({
        color: p.specimenColor,
        emissive: p.specimenColor,
        emissiveIntensity: 1.8,
        roughness: 0.2,
      });
      const specimenMesh = new THREE.Mesh(specimenGeo, specimenMat);
      specimenMesh.position.set(0, height / 2 + 0.4, 0);
      podGroup.add(specimenMesh);

      // 6. Jagged Fracture Splinters & Erupting Roots
      const crackGeo = new THREE.TorusGeometry(radius * 0.95, 0.035, 6, 12, Math.PI * 0.75);
      const crackMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
      const crackMesh = new THREE.Mesh(crackGeo, crackMat);
      crackMesh.position.set(0, height / 2 + 0.3, 0);
      crackMesh.rotation.x = Math.PI / 3;
      podGroup.add(crackMesh);

      this.containmentPods.push({
        group: podGroup,
        specimen: specimenMesh,
        fluid: fluidMesh,
        baseY: y,
      });

      this.root.add(podGroup);
      this.colliders.push({ x: p.x, z: p.z, radius: radius * 1.1 });
    }
  }

  // --- Defunct Biometric Scanners ---------------------------------------------

  _buildBiometricScanners() {
    const ox = this.origin.x;
    const oz = this.origin.z;

    const scannerPositions = [
      { x: ox - 4.85, z: oz - 3.8, rotY: Math.PI / 2 },
      { x: ox + 4.85, z: oz - 3.8, rotY: -Math.PI / 2 },
      { x: ox - 4.85, z: oz + 5.5, rotY: Math.PI / 2 },
    ];

    const scannerMat = new THREE.MeshStandardMaterial({
      map: this.scannerTex,
      roughness: 0.45,
      metalness: 0.6,
      emissive: 0x441111,
      emissiveIntensity: 0.8,
    });

    for (const sp of scannerPositions) {
      const scannerGroup = new THREE.Group();
      const y = getTerrainHeight(sp.x, sp.z);
      scannerGroup.position.set(sp.x, y + 1.2, sp.z);
      scannerGroup.rotation.y = sp.rotY;

      // Terminal console stand
      const standGeo = new THREE.BoxGeometry(0.7, 0.9, 0.4);
      const standMesh = new THREE.Mesh(standGeo, this.bulkheadMaterial);
      standMesh.position.set(0, -0.4, 0);
      scannerGroup.add(standMesh);

      // Angled screen with biometric palm print
      const screenGeo = new THREE.BoxGeometry(0.65, 0.65, 0.15);
      const screenMesh = new THREE.Mesh(screenGeo, scannerMat);
      screenMesh.rotation.x = -0.3;
      scannerGroup.add(screenMesh);

      this.root.add(scannerGroup);
      this.colliders.push({ x: sp.x, z: sp.z, radius: 0.55 });
    }
  }

  // --- Flickering Fluorescent Tube Light Fixtures -----------------------------

  _buildFluorescentLights() {
    const ox = this.origin.x;
    const oz = this.origin.z;

    const lightCoords = [
      { x: ox, z: oz + 6.0, yOff: 3.5 },
      { x: ox, z: oz + 0.5, yOff: 3.5 },
      { x: ox, z: oz - 7.5, yOff: 3.8 },
    ];

    for (const lc of lightCoords) {
      const fixtureGroup = new THREE.Group();
      const groundY = getTerrainHeight(lc.x, lc.z);
      fixtureGroup.position.set(lc.x, groundY + lc.yOff, lc.z);

      // Metal housing bracket
      const housingGeo = new THREE.BoxGeometry(2.2, 0.15, 0.4);
      const housingMesh = new THREE.Mesh(housingGeo, this.bulkheadMaterial);
      fixtureGroup.add(housingMesh);

      // Dual Fluorescent Glass Tubes
      const tubeGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.9, 10);
      tubeGeo.rotateZ(Math.PI / 2);

      const tube1 = new THREE.Mesh(tubeGeo, this.fluorescentTubeMaterial.clone());
      tube1.position.set(0, -0.1, -0.1);
      fixtureGroup.add(tube1);

      const tube2 = new THREE.Mesh(tubeGeo, this.fluorescentTubeMaterial.clone());
      tube2.position.set(0, -0.1, 0.1);
      fixtureGroup.add(tube2);

      // PointLight source
      const pointLight = new THREE.PointLight(0xbbf0ff, 1.4, 14, 1.8);
      pointLight.position.set(0, -0.4, 0);
      fixtureGroup.add(pointLight);

      this.fluorescentLights.push({
        group: fixtureGroup,
        tube1,
        tube2,
        light: pointLight,
        flickerTimer: Math.random() * 2.5,
        baseIntensity: 1.4,
        isFlickering: false,
        flickerDuration: 0,
      });

      this.root.add(fixtureGroup);
    }
  }

  // --- Holographic Terminal Projections ---------------------------------------

  _buildHolographicTerminals() {
    const ox = this.origin.x;
    const oz = this.origin.z;

    // Master Holographic Terminal in the Vault (at Z = oz - 8.5)
    const termGroup = new THREE.Group();
    const y = getTerrainHeight(ox, oz - 8.5);
    termGroup.position.set(ox, y, oz - 8.5);

    // Pedestal Base
    const baseGeo = new THREE.CylinderGeometry(1.2, 1.4, 0.8, 16);
    const baseMesh = new THREE.Mesh(baseGeo, this.bulkheadMaterial);
    baseMesh.position.y = 0.4;
    termGroup.add(baseMesh);

    // Glowing Projector Lens Ring
    const lensGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.08, 16);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x00e5ff,
      emissiveIntensity: 2.5,
      roughness: 0.1,
    });
    const lensMesh = new THREE.Mesh(lensGeo, lensMat);
    lensMesh.position.y = 0.82;
    termGroup.add(lensMesh);

    // Translucent Hologram Projection Frustum Cone
    const coneGeo = new THREE.ConeGeometry(1.6, 2.2, 16, 1, true);
    coneGeo.rotateX(Math.PI);
    const coneMesh = new THREE.Mesh(coneGeo, this.holoBeamMaterial);
    coneMesh.position.y = 1.9;
    termGroup.add(coneMesh);

    // Floating Holographic Display Screen
    const screenGeo = new THREE.PlaneGeometry(2.4, 1.2);
    const screenMesh = new THREE.Mesh(screenGeo, this.hologramMaterial);
    screenMesh.position.set(0, 2.2, 0);
    termGroup.add(screenMesh);

    // Rotating 3D Holographic Wireframe (DNA Double-Helix / Specimen Cube)
    const wireGeo = new THREE.IcosahedronGeometry(0.48, 1);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00ffc4,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
    });
    const wireMesh = new THREE.Mesh(wireGeo, wireMat);
    wireMesh.position.set(0, 1.45, 0);
    termGroup.add(wireMesh);

    this.hologramMeshes.push({
      screen: screenMesh,
      wireframe: wireMesh,
      cone: coneMesh,
    });

    this.root.add(termGroup);
    this.colliders.push({ x: ox, z: oz - 8.5, radius: 1.35 });
  }

  // --- Electrical Pressure Plates & Power Conduit Nodes ----------------------

  _buildPowerCircuitPuzzle() {
    const ox = this.origin.x;
    const oz = this.origin.z;

    // Twin Pressure Plates: Alpha (left) and Beta (right)
    const plateConfigs = [
      { id: 'alpha', x: ox - 2.6, z: oz - 1.8, label: 'CIRCUIT α' },
      { id: 'beta',  x: ox + 2.6, z: oz - 1.8, label: 'CIRCUIT β' },
    ];

    for (const pc of plateConfigs) {
      const plateGroup = new THREE.Group();
      const y = getTerrainHeight(pc.x, pc.z);
      plateGroup.position.set(pc.x, y, pc.z);

      // 1. Outer Grooved Steel Ring Base
      const ringGeo = new THREE.CylinderGeometry(1.2, 1.25, 0.12, 24);
      const ringMesh = new THREE.Mesh(ringGeo, this.bulkheadMaterial);
      ringMesh.position.y = 0.06;
      plateGroup.add(ringMesh);

      // 2. Central Spring-Loaded Copper Induction Disc
      const discGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.08, 20);
      const discMat = new THREE.MeshStandardMaterial({
        color: 0xb86524,
        emissive: 0x552200,
        emissiveIntensity: 0.5,
        roughness: 0.35,
        metalness: 0.9,
      });
      const discMesh = new THREE.Mesh(discGeo, discMat);
      discMesh.position.y = 0.11;
      plateGroup.add(discMesh);

      // 3. Glowing Circuit Indicator Ring
      const indGeo = new THREE.RingGeometry(0.88, 1.05, 24);
      indGeo.rotateX(-Math.PI / 2);
      const indMat = new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      const indMesh = new THREE.Mesh(indGeo, indMat);
      indMesh.position.y = 0.13;
      plateGroup.add(indMesh);

      // 4. Power Conduit Cables leading to Blast Door (at Z = oz - 4.5)
      this._buildConduitWire(pc.x, pc.z, pc.x > ox ? ox + 0.8 : ox - 0.8, oz - 4.5);

      this.pressurePlates.push({
        id: pc.id,
        x: pc.x,
        z: pc.z,
        group: plateGroup,
        discMesh,
        discMat,
        indMesh,
        indMat,
        isActivated: false,
        activationTimer: 0,
      });

      this.root.add(plateGroup);
    }
  }

  _buildConduitWire(x1, z1, x2, z2) {
    const y1 = getTerrainHeight(x1, z1) + 0.08;
    const y2 = getTerrainHeight(x2, z2) + 0.08;

    const curve = new THREE.LineCurve3(
      new THREE.Vector3(x1, y1, z1),
      new THREE.Vector3(x2, y2, z2)
    );
    const pipeGeo = new THREE.TubeGeometry(curve, 12, 0.07, 8, false);
    const pipeMesh = new THREE.Mesh(pipeGeo, this.conduitMaterial.clone());
    this.conduitWires.push(pipeMesh);
    this.root.add(pipeMesh);
  }

  // --- Flickering Defense Laser Barriers --------------------------------------

  _buildLaserDefenseBarriers() {
    const ox = this.origin.x;
    const oz = this.origin.z;

    const laserConfigs = [
      { id: 'laser-1', z: oz + 3.5, width: 4.8, cycleOffset: 0.0 },
      { id: 'laser-2', z: oz - 0.5, width: 4.8, cycleOffset: 2.3 },
    ];

    for (const lc of laserConfigs) {
      const laserGroup = new THREE.Group();
      const y = getTerrainHeight(ox, lc.z);
      laserGroup.position.set(ox, y, lc.z);

      const halfW = lc.width / 2;

      // Emitter Post Left
      const emitterGeo = new THREE.CylinderGeometry(0.25, 0.32, 2.2, 12);
      const emitterLeft = new THREE.Mesh(emitterGeo, this.bulkheadMaterial);
      emitterLeft.position.set(-halfW, 1.1, 0);
      laserGroup.add(emitterLeft);

      // Emitter Post Right
      const emitterRight = new THREE.Mesh(emitterGeo, this.bulkheadMaterial);
      emitterRight.position.set(halfW, 1.1, 0);
      laserGroup.add(emitterRight);

      // Glowing Emitter Lenses
      const lensGeo = new THREE.SphereGeometry(0.14, 10, 10);
      const lensMat = new THREE.MeshBasicMaterial({ color: 0xff1133 });
      const lensL = new THREE.Mesh(lensGeo, lensMat);
      lensL.position.set(-halfW + 0.18, 1.1, 0);
      laserGroup.add(lensL);

      const lensR = new THREE.Mesh(lensGeo, lensMat);
      lensR.position.set(halfW - 0.18, 1.1, 0);
      laserGroup.add(lensR);

      // High-intensity Laser Beam Cylinder
      const beamGeo = new THREE.CylinderGeometry(0.065, 0.065, lc.width - 0.4, 12);
      beamGeo.rotateZ(Math.PI / 2);
      const beamMesh = new THREE.Mesh(beamGeo, this.laserBeamMaterial.clone());
      beamMesh.position.set(0, 1.1, 0);
      laserGroup.add(beamMesh);

      // Warning Floor Grid
      const warningGridGeo = new THREE.PlaneGeometry(lc.width - 0.2, 1.4);
      warningGridGeo.rotateX(-Math.PI / 2);
      const warningGrid = new THREE.Mesh(warningGridGeo, this.laserWarningMaterial.clone());
      warningGrid.position.set(0, 0.06, 0);
      laserGroup.add(warningGrid);

      this.laserBarriers.push({
        id: lc.id,
        z: lc.z,
        width: lc.width,
        group: laserGroup,
        beamMesh,
        warningGrid,
        lensL,
        lensR,
        state: 'ACTIVE', // WARNING -> ACTIVE -> SAFE
        stateTimer: lc.cycleOffset,
        warningDuration: 1.0,
        activeDuration: 1.8,
        safeDuration: 1.8,
      });

      this.root.add(laserGroup);
      this.colliders.push(
        { x: ox - halfW, z: lc.z, radius: 0.45 },
        { x: ox + halfW, z: lc.z, radius: 0.45 }
      );
    }
  }

  // --- Vault Rewards (Pre-Collapse Research Catalyst) -------------------------

  _buildVaultRewards() {
    const ox = this.origin.x;
    const oz = this.origin.z;

    // Research Catalyst Canister in the Vault (Z = oz - 8.5)
    this.vaultRewardPositions = [
      { x: ox - 1.8, z: oz - 7.5 },
      { x: ox + 1.8, z: oz - 7.5 },
    ];
  }

  // --- Register Colliders -----------------------------------------------------

  _registerColliders() {
    for (const c of this.colliders) {
      this.collisionSystem.addStatic(c.x, c.z, c.radius);
    }
  }

  // --- Frame Loop Update ------------------------------------------------------

  update(deltaTime, playerPosition, playerController) {
    this.time += deltaTime;
    if (!playerPosition) return;

    // 1. Sector 7 Proximity Discovery Toast
    const distToSector7 = this.origin.distanceTo(playerPosition);
    if (!this.hasDiscoveredSector7 && distToSector7 < 18.0) {
      this.hasDiscoveredSector7 = true;
      if (this.uiManager) {
        this.uiManager._showNotification(
          'DISCOVERED: SECTOR 7 RUINS — PRE-COLLAPSE LAB',
          'notification--hint',
          2400
        );
      }
    }

    // 2. Animate Fluorescent Tube Lights & Ballast Micro-Flicker
    this._updateFluorescentLights(deltaTime);

    // 3. Animate Holographic Telemetry & Rotating 3D Wireframes
    this._updateHolograms(deltaTime, playerPosition);

    // 4. Update Electrical Pressure Plates & Circuit Conductivity
    this._updatePressurePlates(deltaTime, playerPosition);

    // 5. Update Hydraulic Blast Door Animation
    this._updateBlastDoors(deltaTime);

    // 6. Update Cycling Defense Laser Barriers & Hazard Detection
    this._updateLaserBarriers(deltaTime, playerPosition, playerController);
  }

  _updateFluorescentLights(deltaTime) {
    for (const fl of this.fluorescentLights) {
      fl.flickerTimer -= deltaTime;
      if (fl.flickerTimer <= 0) {
        fl.flickerTimer = 3.0 + Math.random() * 5.0;
        fl.isFlickering = true;
        fl.flickerDuration = 0.15 + Math.random() * 0.25;
        playFluorescentFlickerSound();
      }

      if (fl.isFlickering) {
        fl.flickerDuration -= deltaTime;
        const drop = Math.random() > 0.45 ? 0.05 : 1.2;
        fl.light.intensity = fl.baseIntensity * drop;
        fl.tube1.material.emissiveIntensity = 2.4 * drop;
        fl.tube2.material.emissiveIntensity = 2.4 * drop;
        if (fl.flickerDuration <= 0) {
          fl.isFlickering = false;
          fl.light.intensity = fl.baseIntensity;
          fl.tube1.material.emissiveIntensity = 2.4;
          fl.tube2.material.emissiveIntensity = 2.4;
        }
      } else {
        // Subtle micro-hum variation
        const hum = 1.0 + Math.sin(this.time * 24.0) * 0.04;
        fl.light.intensity = fl.baseIntensity * hum;
      }
    }
  }

  _updateHolograms(deltaTime, playerPosition) {
    for (const h of this.hologramMeshes) {
      // Rotating 3D holographic wireframe
      h.wireframe.rotation.y += deltaTime * 0.9;
      h.wireframe.rotation.x += deltaTime * 0.45;

      // Subtle holographic scanline oscillation
      h.screen.material.opacity = 0.75 + Math.sin(this.time * 6.0) * 0.12;
      h.cone.material.opacity = 0.14 + Math.sin(this.time * 4.0) * 0.05;
    }

    // Proximity check to Master Hologram Terminal (Z = oz - 8.5)
    const distToTerminal = playerPosition.distanceTo(this.masterTerminalPos);
    if (distToTerminal < 2.4 && !this.hasReadMasterLog && this.isVaultUnlocked) {
      this.hasReadMasterLog = true;
      playTerminalInteractSound();
      if (this.uiManager) {
        this.uiManager._showNotification(
          'SECTOR 07 LOG 409: "Specimen Hollowdrop biological assimilation verified."',
          'notification--hint',
          3200
        );
      }
    }
  }

  _updatePressurePlates(deltaTime, playerPosition) {
    let allCircuitsClosed = true;

    for (const plate of this.pressurePlates) {
      const platePos = new THREE.Vector3(plate.x, getTerrainHeight(plate.x, plate.z), plate.z);
      const distToPlayer = playerPosition.distanceTo(platePos);

      // Check Conductivity: Player carrying iron OR dropped iron on plate
      const isPlayerOnPlate = distToPlayer < 1.35;
      const playerCarryingIron = Boolean(
        this.inventoryManager &&
        this.inventoryManager.items &&
        this.inventoryManager.items.some((i) => i.type === 'iron')
      );
      const nearbyIron = Boolean(
        this.resourceManager &&
        this.resourceManager.resources &&
        this.resourceManager.resources.some((r) => {
          if (r.type !== 'iron' || r.state === 'absorbing') return false;
          const rx = r.mesh ? r.mesh.position.x : 0;
          const rz = r.mesh ? r.mesh.position.z : 0;
          const dx = rx - platePos.x;
          const dz = rz - platePos.z;
          return (dx * dx + dz * dz) < (1.45 * 1.45);
        })
      );

      const isConductiveContact = (isPlayerOnPlate && playerCarryingIron) || nearbyIron;

      if (isConductiveContact) {
        if (!plate.isActivated) {
          plate.isActivated = true;
          playCircuitPowerSound();
          if (this.screenShake) this.screenShake.add(0.12);
        }
        plate.activationTimer = Math.min(1.0, plate.activationTimer + deltaTime * 3.0);
      } else {
        plate.isActivated = false;
        plate.activationTimer = Math.max(0, plate.activationTimer - deltaTime * 1.5);
        allCircuitsClosed = false;
      }

      // Visual plate reaction (spring compression + cyan electric illumination)
      plate.discMesh.position.y = 0.11 - plate.activationTimer * 0.05;
      if (plate.isActivated) {
        plate.indMat.color.setHex(0x00e5ff);
        plate.discMat.emissive.setHex(0x0088cc);
        plate.discMat.emissiveIntensity = 2.0;
      } else {
        plate.indMat.color.setHex(0xff6600);
        plate.discMat.emissive.setHex(0x552200);
        plate.discMat.emissiveIntensity = 0.5;
      }
    }

    // Energize conduit wires
    for (const wire of this.conduitWires) {
      if (allCircuitsClosed) {
        wire.material = this.activeConduitMaterial;
      } else {
        wire.material = this.conduitMaterial;
      }
    }

    // Trigger Blast Door Unlock
    if (allCircuitsClosed && !this.isVaultUnlocked) {
      this.isVaultUnlocked = true;
      playBlastDoorSound();
      if (this.screenShake) this.screenShake.add(0.35);
      if (this.uiManager) {
        this.uiManager._showNotification(
          'CIRCUITS ENERGIZED: SECTOR 7 BLAST DOOR OPENING',
          'notification--hint',
          2600
        );
      }
      if (this.lockLightMaterial) {
        this.lockLightMaterial.color.setHex(0x00ff66);
        this.lockLightMaterial.emissive.setHex(0x00ff88);
      }
      this._removeBlastDoorColliders();
    }
  }

  _removeBlastDoorColliders() {
    // Remove blast door colliders from collision system so player can freely walk into the vault
    if (this.doorColliderLeft) {
      const idxL = this.collisionSystem.staticColliders.indexOf(this.doorColliderLeft);
      if (idxL !== -1) this.collisionSystem.staticColliders.splice(idxL, 1);
    }
    if (this.doorColliderRight) {
      const idxR = this.collisionSystem.staticColliders.indexOf(this.doorColliderRight);
      if (idxR !== -1) this.collisionSystem.staticColliders.splice(idxR, 1);
    }
  }

  _updateBlastDoors(deltaTime) {
    if (this.isVaultUnlocked && this.blastDoorProgress < 1.0) {
      this.blastDoorProgress = Math.min(1.0, this.blastDoorProgress + deltaTime * 0.75);

      const slideDist = this.blastDoorProgress * 2.2;
      if (this.blastDoorLeft) this.blastDoorLeft.position.x = -1.2 - slideDist;
      if (this.blastDoorRight) this.blastDoorRight.position.x = 1.2 + slideDist;
    }
  }

  _updateLaserBarriers(deltaTime, playerPosition, playerController) {
    const ox = this.origin.x;

    for (const lb of this.laserBarriers) {
      lb.stateTimer += deltaTime;

      if (lb.state === 'WARNING') {
        if (lb.stateTimer >= lb.warningDuration) {
          lb.state = 'ACTIVE';
          lb.stateTimer = 0;
          playLaserHumSound();
        }
      } else if (lb.state === 'ACTIVE') {
        if (lb.stateTimer >= lb.activeDuration) {
          lb.state = 'SAFE';
          lb.stateTimer = 0;
        }
      } else if (lb.state === 'SAFE') {
        if (lb.stateTimer >= lb.safeDuration) {
          lb.state = 'WARNING';
          lb.stateTimer = 0;
          playLaserChargeSound();
        }
      }

      // Visuals by state
      if (lb.state === 'WARNING') {
        lb.beamMesh.visible = false;
        lb.warningGrid.visible = true;
        const pulse = 0.25 + Math.sin(lb.stateTimer * 16.0) * 0.2;
        lb.warningGrid.material.opacity = pulse;
        lb.lensL.material.color.setHex(0xffaa00);
        lb.lensR.material.color.setHex(0xffaa00);
      } else if (lb.state === 'ACTIVE') {
        lb.beamMesh.visible = true;
        lb.warningGrid.visible = false;
        lb.lensL.material.color.setHex(0xff0022);
        lb.lensR.material.color.setHex(0xff0022);
        lb.beamMesh.material.opacity = 0.85 + Math.sin(this.time * 28.0) * 0.15;
      } else {
        // SAFE
        lb.beamMesh.visible = false;
        lb.warningGrid.visible = false;
        lb.lensL.material.color.setHex(0x00ff66);
        lb.lensR.material.color.setHex(0x00ff66);
      }

      // Hazard Collision Check against Active Laser
      if (lb.state === 'ACTIVE') {
        const dx = Math.abs(playerPosition.x - ox);
        const dz = Math.abs(playerPosition.z - lb.z);

        if (dx <= lb.width / 2 && dz <= 0.65) {
          // If player is dashing, they slip through safely with i-frame evasion!
          if (playerController && playerController.isDashing) {
            // Dash rhythm success - pass through unharmed
          } else {
            // Player caught in defense laser
            if (this.playerHealth) {
              const { damage } = calculateAttackDamage(16, false);
              this.playerHealth.takeDamage(damage, { sourceType: 'laser_barrier', type: 'laser' });
            }
            playLaserBurnSound();
            if (this.screenShake) this.screenShake.add(0.3);

            // Knockback impulse away from laser plane
            const knockDirZ = playerPosition.z > lb.z ? 4.5 : -4.5;
            if (playerController) {
              playerController.applyImpulse(new THREE.Vector3(0, 0, knockDirZ));
            }
          }
        }
      }
    }
  }

  // --- Terrain Re-alignment ---------------------------------------------------

  realignToTerrain() {
    for (const pod of this.containmentPods) {
      pod.group.position.y = getTerrainHeight(pod.group.position.x, pod.group.position.z);
    }
    for (const fl of this.fluorescentLights) {
      fl.group.position.y = getTerrainHeight(fl.group.position.x, fl.group.position.z) + 3.5;
    }
  }

  // --- Run Reset (Play Again) -------------------------------------------------

  reset() {
    this.isVaultUnlocked = false;
    this.blastDoorProgress = 0;
    this.hasDiscoveredSector7 = false;
    this.hasReadMasterLog = false;
    this.time = 0;

    if (this.blastDoorLeft) this.blastDoorLeft.position.x = -1.2;
    if (this.blastDoorRight) this.blastDoorRight.position.x = 1.2;

    if (this.lockLightMaterial) {
      this.lockLightMaterial.color.setHex(0xff1122);
      this.lockLightMaterial.emissive.setHex(0xff0022);
    }

    for (const plate of this.pressurePlates) {
      plate.isActivated = false;
      plate.activationTimer = 0;
    }

    // Re-register door colliders
    this._registerColliders();
  }
}
