import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js?v=5.3';
import { makeRng } from './worldDressing.js?v=5.3';
import { attachOcclusionOutline } from './occlusionOutline.js?v=5.3';

/**
 * Stone Cluster System
 *
 * Implements harvestable stone formations in 3 sizes:
 * - SMALL (2-3 stones): quick roadside pebble cluster
 * - MEDIUM (4-5 stones): rocky mound with multiple dense stones
 * - LARGE (6-8 stones): massive mineral outcrop
 *
 * Collection Mechanics:
 * - When Hollowdrop rolls within harvest proximity of a cluster, individual stones
 *   detach and absorb into Living Inventory with sound/pulse/particles.
 * - Respects inventory capacity (rejects / pauses harvesting when mass limit is reached).
 * - Depleted clusters crumble and disappear cleanly.
 * - Solid colliders while active; colliders dissolve upon depletion.
 */

const HARVEST_RADIUS = 2.0;
const HARVEST_INTERVAL = 0.18; // Seconds between successive stone absorbs from a cluster

const stoneGeometries = [
  new THREE.DodecahedronGeometry(0.24, 0),
  new THREE.IcosahedronGeometry(0.22, 0),
  new THREE.CylinderGeometry(0.18, 0.22, 0.12, 6),
  new THREE.DodecahedronGeometry(0.19, 0),
];

const stoneMaterials = [
  new THREE.MeshStandardMaterial({ color: 0x7a8086, roughness: 0.92, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x62686e, roughness: 0.95, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x8e949a, roughness: 0.90, flatShading: true }),
];

const CLUSTER_CONFIGS = {
  small: {
    stoneCount: [2, 3],
    colliderRadius: 0.45,
    spread: 0.35,
    stoneScale: [0.75, 1.05],
  },
  medium: {
    stoneCount: [4, 5],
    colliderRadius: 0.75,
    spread: 0.65,
    stoneScale: [0.85, 1.3],
  },
  large: {
    stoneCount: [6, 8],
    colliderRadius: 1.1,
    spread: 1.05,
    stoneScale: [0.95, 1.6],
  },
};

export class StoneClusterManager {
  constructor(scene, inventoryManager, resourceManager, uiManager, playerController, mutationSystem, collisionSystem) {
    this.scene = scene;
    this.inventoryManager = inventoryManager;
    this.resourceManager = resourceManager;
    this.uiManager = uiManager;
    this.playerController = playerController;
    this.mutationSystem = mutationSystem;
    this.collisionSystem = collisionSystem;

    this.clusters = [];
    this.rng = makeRng(0x53746f);

    // Register dynamic colliders for all active clusters
    if (this.collisionSystem) {
      this.collisionSystem.addDynamicProvider(() => {
        const out = [];
        for (const cluster of this.clusters) {
          if (!cluster.depleted && cluster.stoneMeshes.length > 0) {
            out.push({
              x: cluster.position.x,
              z: cluster.position.z,
              radius: cluster.colliderRadius,
            });
          }
        }
        return out;
      });
    }
  }

  spawnCluster(tier, x, z) {
    const cfg = CLUSTER_CONFIGS[tier] || CLUSTER_CONFIGS.small;
    const countMin = cfg.stoneCount[0];
    const countMax = cfg.stoneCount[1];
    const stoneCount = Math.floor(this.rng() * (countMax - countMin + 1)) + countMin;

    const groundY = getTerrainHeight(x, z);
    const clusterGroup = new THREE.Group();
    clusterGroup.position.set(x, groundY, z);

    const stoneMeshes = [];

    for (let i = 0; i < stoneCount; i++) {
      const geom = stoneGeometries[i % stoneGeometries.length];
      const mat = stoneMaterials[Math.floor(this.rng() * stoneMaterials.length)].clone();
      const mesh = new THREE.Mesh(geom, mat);

      attachOcclusionOutline(mesh, {
        color: 0x8a949e,
        rimColor: 0xeef4f8,
        opacity: 0.88,
        emissiveIntensity: 2.2,
        rimStrength: 3.0,
        rimPower: 1.8,
        innerAlpha: 0.18,
      });

      const angle = (i / stoneCount) * Math.PI * 2 + (this.rng() - 0.5) * 0.5;
      const dist = (i === 0 ? 0.05 : 0.18 + this.rng() * cfg.spread);
      const scale = cfg.stoneScale[0] + this.rng() * (cfg.stoneScale[1] - cfg.stoneScale[0]);

      const localX = Math.cos(angle) * dist;
      const localZ = Math.sin(angle) * dist;
      const stoneWorldX = x + localX;
      const stoneWorldZ = z + localZ;
      const stoneGroundY = getTerrainHeight(stoneWorldX, stoneWorldZ);

      mesh.position.set(
        localX,
        (stoneGroundY - groundY) + 0.14 * scale,
        localZ
      );
      mesh.rotation.set(
        this.rng() * Math.PI,
        this.rng() * Math.PI,
        this.rng() * Math.PI
      );
      mesh.scale.set(scale, scale * (0.8 + this.rng() * 0.4), scale);
      mesh.userData.localOffset = { localX, localZ, scale };

      clusterGroup.add(mesh);
      stoneMeshes.push(mesh);
    }

    this.scene.add(clusterGroup);

    const cluster = {
      tier,
      position: new THREE.Vector3(x, groundY, z),
      group: clusterGroup,
      stoneMeshes,
      totalStones: stoneCount,
      colliderRadius: cfg.colliderRadius,
      harvestCooldown: 0,
      depleted: false,
    };

    this.clusters.push(cluster);
    return cluster;
  }

  populateWorldClusters({ exclusions = [] } = {}) {
    const isClear = (x, z) => exclusions.every(({ x: ex, z: ez, radius }) => {
      const dx = x - ex;
      const dz = z - ez;
      return dx * dx + dz * dz > radius * radius;
    });

    const placements = [
      // Close to spawn / starter area
      { tier: 'small', x: 5.5, z: -3.5 },
      { tier: 'small', x: -4.5, z: 6.5 },
      { tier: 'medium', x: -8.0, z: -2.0 },
      { tier: 'small', x: 7.5, z: 7.0 },

      // Mid-distance exploration zones
      { tier: 'medium', x: 12.0, z: -6.5 },
      { tier: 'medium', x: -14.0, z: 5.0 },
      { tier: 'large', x: 16.0, z: 8.5 },
      { tier: 'large', x: -6.0, z: 14.0 },

      // Dangerous outer zones
      { tier: 'large', x: -18.0, z: -14.0 },
      { tier: 'medium', x: 22.0, z: -12.0 },
      { tier: 'large', x: 10.0, z: 20.0 },
      { tier: 'small', x: -20.0, z: 10.0 },
    ];

    for (const p of placements) {
      if (isClear(p.x, p.z)) {
        this.spawnCluster(p.tier, p.x, p.z);
      }
    }
  }

  /**
   * Re-aligns all active stone clusters and their individual stones to the true terrain height.
   * Called when texture elevation decoding completes.
   */
  realignToTerrain() {
    for (const cluster of this.clusters) {
      if (cluster.depleted) continue;
      const groundY = getTerrainHeight(cluster.position.x, cluster.position.z);
      cluster.position.y = groundY;
      cluster.group.position.y = groundY;

      for (const mesh of cluster.stoneMeshes) {
        const { localX, localZ, scale } = mesh.userData.localOffset || {
          localX: mesh.position.x,
          localZ: mesh.position.z,
          scale: mesh.scale.x || 1.0,
        };
        const stoneWorldX = cluster.position.x + localX;
        const stoneWorldZ = cluster.position.z + localZ;
        const stoneGroundY = getTerrainHeight(stoneWorldX, stoneWorldZ);
        mesh.position.y = (stoneGroundY - groundY) + 0.14 * scale;
      }
    }
  }

  clearAll() {
    for (const cluster of this.clusters) {
      this.scene.remove(cluster.group);
      cluster.group.traverse((child) => {
        if (!child.material) return;
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      });
    }
    this.clusters = [];
  }

  update(deltaTime, playerPosition) {
    for (let cIdx = this.clusters.length - 1; cIdx >= 0; cIdx--) {
      const cluster = this.clusters[cIdx];
      if (cluster.depleted) continue;

      if (cluster.harvestCooldown > 0) {
        cluster.harvestCooldown -= deltaTime;
      }

      const dx = playerPosition.x - cluster.position.x;
      const dz = playerPosition.z - cluster.position.z;
      const distSq = dx * dx + dz * dz;

      const triggerDist = HARVEST_RADIUS + cluster.colliderRadius;
      if (distSq < triggerDist * triggerDist) {
        if (cluster.harvestCooldown <= 0 && cluster.stoneMeshes.length > 0) {
          this._tryHarvestStone(cluster, playerPosition);
        }
      }
    }
  }

  _tryHarvestStone(cluster, playerPosition) {
    if (!this.inventoryManager.canAddItem('stone')) {
      this.uiManager.showInventoryFull();
      cluster.harvestCooldown = 0.6;
      return;
    }

    const stoneMesh = cluster.stoneMeshes.pop();
    if (!stoneMesh) return;

    // Get world position of the specific stone
    const stoneWorldPos = new THREE.Vector3();
    stoneMesh.getWorldPosition(stoneWorldPos);

    // Remove mesh from cluster group and dispose all child materials
    cluster.group.remove(stoneMesh);
    stoneMesh.traverse((child) => {
      if (!child.material) return;
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    });

    // Spawn absorption feedback & add to inventory
    this.resourceManager.particles.spawnBurst(stoneWorldPos, 0x8a8a8a);
    this.playerController.triggerAbsorbPulse?.();

    const dummyResource = {
      id: Math.floor(Math.random() * 1000000),
      type: 'stone',
      name: 'Stone',
      weight: 2,
      value: 1,
      color: 0x8a8a8a,
    };

    this.inventoryManager.addItem(dummyResource);
    this.uiManager.updateMassUI(this.inventoryManager.getInventoryWeight(), this.inventoryManager.maxWeight);
    this.uiManager.showPickupNotification('Stone');
    this.mutationSystem?.onInventoryChanged();
    this.resourceManager.onAbsorbed?.(dummyResource);

    cluster.harvestCooldown = HARVEST_INTERVAL;

    if (cluster.stoneMeshes.length === 0) {
      cluster.depleted = true;
      this.scene.remove(cluster.group);
      this.resourceManager.particles.spawnBurst(cluster.position, 0x5a5a5a);
    }
  }
}
