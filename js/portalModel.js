import * as THREE from 'three';

/**
 * Creates a procedural spiral vortex texture for the active portal core.
 */
function createVortexTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Radial gradient base
  const grad = ctx.createRadialGradient(256, 256, 10, 256, 256, 256);
  grad.addColorStop(0.0, '#ffffff');
  grad.addColorStop(0.2, '#7df9ff');
  grad.addColorStop(0.5, '#1bc2d8');
  grad.addColorStop(0.8, '#0d5c75');
  grad.addColorStop(1.0, 'rgba(5, 20, 25, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Swirling spiral arms
  ctx.save();
  ctx.translate(256, 256);
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';

  for (let arm = 0; arm < 5; arm++) {
    const angleOffset = (arm / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(180, 255, 255, ${0.45 + (arm % 2) * 0.25})`;

    for (let r = 20; r < 240; r += 6) {
      const theta = angleOffset + (r / 25) * 0.9;
      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      if (r === 20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Creates a cracked stone texture for the dormant locked portal core.
 */
function createDormantCoreTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Dark obsidian stone base
  ctx.fillStyle = '#101715';
  ctx.fillRect(0, 0, 512, 512);

  // Mottled dark stone noise
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = 1 + Math.random() * 3;
    const brightness = 15 + Math.floor(Math.random() * 25);
    ctx.fillStyle = `rgb(${brightness}, ${brightness + 5}, ${brightness + 3})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Radiating fracture lines
  ctx.strokeStyle = '#27524e';
  ctx.lineWidth = 2.5;
  for (let f = 0; f < 8; f++) {
    const angle = (f / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    let cx = 256;
    let cy = 256;
    ctx.beginPath();
    ctx.moveTo(cx, cy);

    const steps = 6 + Math.floor(Math.random() * 4);
    for (let s = 0; s < steps; s++) {
      const segDist = 25 + Math.random() * 30;
      const segAngle = angle + (Math.random() - 0.5) * 0.6;
      cx += Math.cos(segAngle) * segDist;
      cy += Math.sin(segAngle) * segDist;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/**
 * Creates a circular rune glyph texture.
 */
function createRuneTexture(variant = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 128, 128);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';

  // Outer ring
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.stroke();

  // Inner glyphs
  ctx.lineWidth = 4;
  ctx.beginPath();
  if (variant === 0) {
    ctx.arc(64, 64, 28, 0, Math.PI * 1.5);
    ctx.moveTo(64, 36);
    ctx.lineTo(64, 92);
  } else if (variant === 1) {
    ctx.arc(64, 64, 26, 0.4, Math.PI * 2);
    ctx.moveTo(44, 44);
    ctx.lineTo(84, 84);
    ctx.moveTo(84, 44);
    ctx.lineTo(44, 84);
  } else {
    ctx.arc(64, 64, 22, 0, Math.PI * 2);
    ctx.moveTo(64, 20);
    ctx.lineTo(64, 40);
    ctx.moveTo(64, 88);
    ctx.lineTo(64, 108);
    ctx.moveTo(20, 64);
    ctx.lineTo(40, 64);
    ctx.moveTo(88, 64);
    ctx.lineTo(108, 64);
  }
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/**
 * Builds the complete 3D Biome Portal visual group.
 * Matches the ancient, organic, overgrown stone gateway shown in the concept art.
 *
 * @returns {THREE.Group} Root portal group with animation handles in userData.
 */
export function createBiomePortalVisual() {
  const portalRoot = new THREE.Group();
  portalRoot.name = 'BiomePortal';

  // --- Shared Materials ---
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x48524d,
    roughness: 0.92,
    metalness: 0.1,
    flatShading: true,
  });

  const mossyStoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d4a3b,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true,
  });

  const darkCragMaterial = new THREE.MeshStandardMaterial({
    color: 0x222a27,
    roughness: 0.88,
    flatShading: true,
  });

  const mushroomStemMat = new THREE.MeshStandardMaterial({
    color: 0xc8c3b0,
    roughness: 0.8,
  });

  const cyanMushroomCapMat = new THREE.MeshStandardMaterial({
    color: 0x1cd6e8,
    emissive: 0x14a6b5,
    emissiveIntensity: 0.75,
    roughness: 0.35,
  });

  const purpleMushroomCapMat = new THREE.MeshStandardMaterial({
    color: 0xb546d8,
    emissive: 0x782596,
    emissiveIntensity: 0.65,
    roughness: 0.4,
  });

  // --- 1. Ground Threshold / Stepped Dias ---
  const daisGroup = new THREE.Group();
  portalRoot.add(daisGroup);

  const stepGeom = new THREE.CylinderGeometry(3.6, 4.2, 0.4, 14);
  const stepMesh = new THREE.Mesh(stepGeom, mossyStoneMaterial);
  stepMesh.position.set(0, 0.15, 0);
  stepMesh.receiveShadow = true;
  daisGroup.add(stepMesh);

  // Irregular stone slabs leading up to the threshold
  const slabGeom = new THREE.BoxGeometry(1.2, 0.22, 1.4);
  const slabPositions = [
    [-1.3, 0.26, 1.1, 0.2],
    [0.1, 0.28, 1.5, -0.15],
    [1.4, 0.25, 1.0, 0.3],
    [-0.8, 0.28, 0.2, -0.08],
    [0.9, 0.29, 0.1, 0.12],
    [-0.2, 0.32, -0.6, 0.04],
  ];
  for (const [sx, sy, sz, sRot] of slabPositions) {
    const slab = new THREE.Mesh(slabGeom, stoneMaterial);
    slab.position.set(sx, sy, sz);
    slab.rotation.y = sRot;
    slab.scale.set(0.9 + Math.random() * 0.3, 1, 0.8 + Math.random() * 0.4);
    slab.receiveShadow = true;
    daisGroup.add(slab);
  }

  // --- 2. Asymmetrical Stone Archway Pillars ---
  const archGroup = new THREE.Group();
  portalRoot.add(archGroup);

  const rockGeom = new THREE.DodecahedronGeometry(1.0, 1);

  // Helper to build stacked craggy pillars
  function createPillarCluster(baseX, baseZ, isRight = false) {
    const pillar = new THREE.Group();
    pillar.position.set(baseX, 0, baseZ);

    const segments = isRight
      ? [
          { y: 0.8, scale: [1.6, 1.5, 1.5], rot: [0.1, 0.4, -0.05], mat: mossyStoneMaterial },
          { y: 2.2, scale: [1.4, 1.6, 1.3], rot: [-0.08, 1.1, -0.1], mat: stoneMaterial },
          { y: 3.8, scale: [1.2, 1.5, 1.2], rot: [0.12, 2.2, -0.2], mat: darkCragMaterial },
          { y: 5.2, scale: [0.95, 1.6, 0.9], rot: [0.2, 0.5, -0.35], mat: stoneMaterial },
          { y: 6.3, scale: [0.65, 1.4, 0.7], rot: [0.3, 1.4, -0.5], mat: darkCragMaterial },
        ]
      : [
          { y: 0.9, scale: [1.7, 1.6, 1.6], rot: [0.05, -0.3, 0.08], mat: mossyStoneMaterial },
          { y: 2.4, scale: [1.5, 1.7, 1.4], rot: [-0.1, 0.8, 0.12], mat: stoneMaterial },
          { y: 4.0, scale: [1.3, 1.6, 1.2], rot: [0.15, 1.7, 0.22], mat: darkCragMaterial },
          { y: 5.3, scale: [1.0, 1.5, 0.95], rot: [0.22, 2.6, 0.38], mat: stoneMaterial },
          { y: 6.2, scale: [0.7, 1.3, 0.65], rot: [0.28, 0.3, 0.52], mat: darkCragMaterial },
        ];

    for (const seg of segments) {
      const rock = new THREE.Mesh(rockGeom, seg.mat);
      rock.position.set(
        (Math.random() - 0.5) * 0.2,
        seg.y,
        (Math.random() - 0.5) * 0.2
      );
      rock.scale.set(...seg.scale);
      rock.rotation.set(...seg.rot);
      rock.castShadow = true;
      rock.receiveShadow = true;
      pillar.add(rock);
    }

    // Buttress boulder at base
    const buttress = new THREE.Mesh(rockGeom, darkCragMaterial);
    buttress.position.set(isRight ? 1.1 : -1.1, 0.6, 0.5);
    buttress.scale.set(1.1, 1.0, 1.2);
    buttress.rotation.set(0.2, isRight ? 0.7 : -0.7, 0);
    buttress.castShadow = true;
    buttress.receiveShadow = true;
    pillar.add(buttress);

    return pillar;
  }

  const leftPillar = createPillarCluster(-2.5, 0, false);
  const rightPillar = createPillarCluster(2.5, 0, true);
  archGroup.add(leftPillar);
  archGroup.add(rightPillar);

  // Arch Keystone / Overarching jagged horn crowns
  const keystoneGroup = new THREE.Group();
  keystoneGroup.position.set(0, 6.4, -0.1);

  const crownLeft = new THREE.Mesh(rockGeom, darkCragMaterial);
  crownLeft.position.set(-0.9, 0.4, 0);
  crownLeft.scale.set(0.7, 1.3, 0.7);
  crownLeft.rotation.set(0.1, 0.4, -0.7);
  crownLeft.castShadow = true;
  keystoneGroup.add(crownLeft);

  const crownRight = new THREE.Mesh(rockGeom, darkCragMaterial);
  crownRight.position.set(0.8, 0.6, 0);
  crownRight.scale.set(0.75, 1.5, 0.75);
  crownRight.rotation.set(-0.1, -0.5, 0.65);
  crownRight.castShadow = true;
  keystoneGroup.add(crownRight);

  const centerKeystone = new THREE.Mesh(rockGeom, stoneMaterial);
  centerKeystone.position.set(-0.05, 0.2, 0.1);
  centerKeystone.scale.set(0.9, 0.8, 0.9);
  centerKeystone.rotation.set(0.3, 0.2, 0);
  centerKeystone.castShadow = true;
  keystoneGroup.add(centerKeystone);

  archGroup.add(keystoneGroup);

  // --- 3. Runes Embedded in Pillars ---
  const runes = [];
  const runeTextures = [createRuneTexture(0), createRuneTexture(1), createRuneTexture(2)];
  const runeGeom = new THREE.PlaneGeometry(0.55, 0.55);

  const runeConfigs = [
    // Left pillar (bottom to top)
    { pos: [-2.1, 1.6, 0.82], rot: [0.1, 0.3, 0.1], variant: 0 },
    { pos: [-2.2, 2.9, 0.78], rot: [-0.05, 0.2, -0.15], variant: 1 },
    { pos: [-2.0, 4.3, 0.7], rot: [0.15, 0.25, 0.1], variant: 2 },
    { pos: [-1.4, 5.5, 0.55], rot: [0.2, 0.35, 0.3], variant: 0 },
    // Right pillar (bottom to top)
    { pos: [2.1, 1.5, 0.85], rot: [0.08, -0.3, -0.1], variant: 1 },
    { pos: [2.2, 2.8, 0.75], rot: [-0.1, -0.25, 0.15], variant: 2 },
    { pos: [2.0, 4.2, 0.68], rot: [0.12, -0.3, -0.12], variant: 0 },
    { pos: [1.3, 5.6, 0.52], rot: [0.22, -0.4, -0.28], variant: 1 },
  ];

  for (let i = 0; i < runeConfigs.length; i++) {
    const cfg = runeConfigs[i];
    const runeMat = new THREE.MeshStandardMaterial({
      map: runeTextures[cfg.variant],
      transparent: true,
      color: 0x38efdf,
      emissive: 0x38efdf,
      emissiveIntensity: 0.05, // Dormant initial glow
      roughness: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const runeMesh = new THREE.Mesh(runeGeom, runeMat);
    runeMesh.position.set(...cfg.pos);
    runeMesh.rotation.set(...cfg.rot);
    portalRoot.add(runeMesh);

    runes.push({
      mesh: runeMesh,
      material: runeMat,
      baseIntensity: 0.05,
      currentIntensity: 0.05,
      targetIntensity: 0.05,
      index: i,
    });
  }

  // --- 4. Bioluminescent Mushrooms around Pillars ---
  const mushroomGroup = new THREE.Group();
  portalRoot.add(mushroomGroup);

  const mushroomSpawnList = [
    [-3.2, 0.2, 0.8, 'cyan', 0.45],
    [-2.9, 0.2, 1.2, 'purple', 0.55],
    [-3.5, 0.15, -0.3, 'cyan', 0.35],
    [3.1, 0.2, 0.9, 'cyan', 0.5],
    [3.4, 0.18, 0.4, 'purple', 0.42],
    [2.8, 0.22, 1.4, 'cyan', 0.38],
  ];

  const capGeom = new THREE.SphereGeometry(0.35, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const stemGeom = new THREE.CylinderGeometry(0.08, 0.12, 0.5, 6);

  for (const [mx, my, mz, colorType, scale] of mushroomSpawnList) {
    const mShroom = new THREE.Group();
    mShroom.position.set(mx, my, mz);
    mShroom.scale.setScalar(scale);

    const stem = new THREE.Mesh(stemGeom, mushroomStemMat);
    stem.position.y = 0.25;
    mShroom.add(stem);

    const cap = new THREE.Mesh(capGeom, colorType === 'cyan' ? cyanMushroomCapMat : purpleMushroomCapMat);
    cap.position.y = 0.5;
    cap.castShadow = true;
    mShroom.add(cap);

    mushroomGroup.add(mShroom);
  }

  // --- 5. Portal Core (Threshold Center) ---
  const coreGroup = new THREE.Group();
  coreGroup.position.set(0, 3.4, 0);
  portalRoot.add(coreGroup);

  // A. Dormant Stone Seal (visible when locked)
  const dormantCoreTex = createDormantCoreTexture();
  const dormantCoreMat = new THREE.MeshStandardMaterial({
    map: dormantCoreTex,
    color: 0x22302c,
    emissive: 0x143b37,
    emissiveIntensity: 0.15,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const dormantCoreMesh = new THREE.Mesh(new THREE.CircleGeometry(2.35, 28), dormantCoreMat);
  dormantCoreMesh.scale.set(1.0, 1.35, 1.0); // oval doorway shape
  coreGroup.add(dormantCoreMesh);

  // B. Active Portal Vortex Layers
  const activeCoreGroup = new THREE.Group();
  activeCoreGroup.visible = false;
  coreGroup.add(activeCoreGroup);

  // Deep background horizon disc (gives illusion of deep descent into next realm)
  const vistaMat = new THREE.MeshBasicMaterial({
    color: 0x072228,
    side: THREE.DoubleSide,
  });
  const vistaMesh = new THREE.Mesh(new THREE.CircleGeometry(2.3, 24), vistaMat);
  vistaMesh.position.z = -0.15;
  vistaMesh.scale.set(1.0, 1.35, 1.0);
  activeCoreGroup.add(vistaMesh);

  // Swirling Vortex Layer 1 (primary dynamic swirl)
  const vortexTexture1 = createVortexTexture();
  const vortexMat1 = new THREE.MeshStandardMaterial({
    map: vortexTexture1,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    color: 0x3af4ff,
    emissive: 0x1cd6e8,
    emissiveIntensity: 1.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const vortexMesh1 = new THREE.Mesh(new THREE.CircleGeometry(2.35, 32), vortexMat1);
  vortexMesh1.scale.set(1.0, 1.35, 1.0);
  activeCoreGroup.add(vortexMesh1);

  // Swirling Vortex Layer 2 (counter-rotating inner layer for layered organic depth)
  const vortexTexture2 = createVortexTexture();
  const vortexMat2 = new THREE.MeshStandardMaterial({
    map: vortexTexture2,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    color: 0x82f9ff,
    emissive: 0x48e1ff,
    emissiveIntensity: 1.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const vortexMesh2 = new THREE.Mesh(new THREE.CircleGeometry(1.9, 28), vortexMat2);
  vortexMesh2.position.z = 0.05;
  vortexMesh2.scale.set(1.0, 1.35, 1.0);
  activeCoreGroup.add(vortexMesh2);

  // Luminous Energy Rim around opening
  const rimGeom = new THREE.TorusGeometry(2.35, 0.12, 12, 32);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x5bf8ff,
    emissive: 0x38efdf,
    emissiveIntensity: 2.2,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const rimMesh = new THREE.Mesh(rimGeom, rimMat);
  rimMesh.scale.set(1.0, 1.35, 1.0);
  rimMesh.position.z = 0.08;
  activeCoreGroup.add(rimMesh);

  // --- 6. Dynamic Point Light ---
  const portalLight = new THREE.PointLight(0x38efdf, 0.2, 14, 1.6);
  portalLight.position.set(0, 3.4, 0.6);
  portalRoot.add(portalLight);

  // --- 7. Floating Portal Particle Spores ---
  const particleCount = 50;
  const particleGeom = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleVelocities = [];

  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 0.5 + Math.random() * 2.2;
    const px = Math.cos(angle) * dist;
    const py = 1.0 + Math.random() * 4.5;
    const pz = (Math.random() - 0.5) * 1.8;

    particlePositions[i * 3 + 0] = px;
    particlePositions[i * 3 + 1] = py;
    particlePositions[i * 3 + 2] = pz;

    particleVelocities.push({
      angle,
      dist,
      baseY: py,
      speed: 0.4 + Math.random() * 0.8,
      wobbleSpeed: 1.0 + Math.random() * 2.0,
      phase: Math.random() * Math.PI * 2,
    });
  }

  particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

  // Canvas particle dot texture
  const pCanvas = document.createElement('canvas');
  pCanvas.width = 32;
  pCanvas.height = 32;
  const pCtx = pCanvas.getContext('2d');
  const pGrad = pCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
  pGrad.addColorStop(0, '#ffffff');
  pGrad.addColorStop(0.4, '#38efdf');
  pGrad.addColorStop(1, 'rgba(56, 239, 223, 0)');
  pCtx.fillStyle = pGrad;
  pCtx.fillRect(0, 0, 32, 32);
  const pTexture = new THREE.CanvasTexture(pCanvas);

  const particleMat = new THREE.PointsMaterial({
    size: 0.25,
    map: pTexture,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const particles = new THREE.Points(particleGeom, particleMat);
  portalRoot.add(particles);

  // Pack handles into userData for PortalController
  portalRoot.userData = {
    daisGroup,
    archGroup,
    runes,
    dormantCoreMesh,
    dormantCoreMat,
    activeCoreGroup,
    vortexMesh1,
    vortexMat1,
    vortexMesh2,
    vortexMat2,
    rimMesh,
    rimMat,
    portalLight,
    particles,
    particlePositions,
    particleVelocities,
    cyanMushroomCapMat,
    purpleMushroomCapMat,
    // Solid static collider coordinates for stone pillars and back wall
    colliderOffsets: [
      { x: -2.2, z: 0, radius: 1.7 },
      { x: 2.2, z: 0, radius: 1.7 },
      { x: 0, z: -0.9, radius: 1.6 },
    ],
  };

  return portalRoot;
}

