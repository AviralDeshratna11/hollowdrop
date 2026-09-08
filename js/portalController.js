import * as THREE from 'three';
import { createBiomePortalVisual } from './portalModel.js?v=8.1';
import { getTerrainHeight } from './terrain.js?v=5.4';
import {
  playPortalAwakenSound,
  playPortalRuneLightSound,
  playPortalEnterSound,
  playPortalDormantClickSound,
  playPortalDiscoveredSound,
} from './soundEffects.js?v=7.9';

export const PORTAL_STATES = {
  LOCKED: 'LOCKED',
  ACTIVATING: 'ACTIVATING',
  ACTIVE: 'ACTIVE',
  TRANSITIONING: 'TRANSITIONING',
};

export const DEFAULT_PORTAL_CONFIG = {
  currentBiomeId: 'subterranean_cavern',
  destinationBiomeId: 'sector7_ruins',
  // Placed against the natural eastern cave wall, embedded into the rocky terrain
  position: { x: 38.0, z: 1.0 },
  facingAngle: -Math.PI / 2, // Facing west toward the oncoming player
  destinationSpawnPosition: { x: 0, y: 0.6, z: 0 },
  interactionRadius: 5.0,
  discoveryRadius: 24.0,
  activationDuration: 3.5,
  transitionDuration: 1.8,
};

/**
 * Owns the Biome Portal lifecycle, 3D visualization, state machine,
 * proximity interaction, and the smooth transition into the next biome.
 */
export class PortalController {
  constructor({
    scene,
    playerController,
    playerHealth = null,
    uiManager,
    collisionSystem,
    resourceManager,
    config = {},
    onBiomeTransition = null,
  }) {
    this.scene = scene;
    this.playerController = playerController;
    this.playerHealth = playerHealth;
    this.player = playerController.mesh;
    this.uiManager = uiManager;
    this.collisionSystem = collisionSystem;
    this.resourceManager = resourceManager;
    this.config = { ...DEFAULT_PORTAL_CONFIG, ...config };
    this.onBiomeTransition = onBiomeTransition;
    this.onDiscovered = config.onDiscovered || null;

    this.state = PORTAL_STATES.LOCKED;
    this.stateTime = 0;
    this._isPlayerNear = false;
    this._hasUnlocked = false;
    this._discovered = false;
    this._collidersRegistered = false;
    this._transitionTimer = 0;
    this._playerInitialPos = new THREE.Vector3();
    this._lastRuneLightIndex = -1;
    this._bumpSoundCooldown = 0;

    // Build visual
    this.mesh = createBiomePortalVisual();
    this.mesh.position.set(
      this.config.position.x,
      getTerrainHeight(this.config.position.x, this.config.position.z),
      this.config.position.z
    );
    this.mesh.rotation.y = this.config.facingAngle;
    this.scene.add(this.mesh);

    // Link elevation support to player controller so slime stands supported on portal base
    if (this.playerController) {
      this.playerController.portalProvider = this;
    }

    this._registerColliders();
  }

  /**
   * Returns an array of { x, z, radius } in world coordinates for all solid
   * static portal obstacles (pillars, buttresses, and rear wall arc).
   */
  getColliders() {
    const offsets = this.mesh?.userData?.colliderOffsets ?? [];
    const rad = this.mesh ? this.mesh.rotation.y : (this.config.facingAngle ?? 0);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const px = this.mesh ? this.mesh.position.x : this.config.position.x;
    const pz = this.mesh ? this.mesh.position.z : this.config.position.z;

    return offsets.map((offset) => ({
      x: px + offset.x * cos + offset.z * sin,
      z: pz - offset.x * sin + offset.z * cos,
      radius: offset.radius,
    }));
  }

  /**
   * Registers solid physical obstacles for the stone portal arch pillars and sealed doorway.
   */
  _registerColliders() {
    if (!this.collisionSystem || this._collidersRegistered) return;

    // Static pillars, buttresses, rear wall, and portal base threshold collider
    for (const c of this.getColliders()) {
      if (!this.collisionSystem.staticColliders.some((sc) => Math.hypot(sc.x - c.x, sc.z - c.z) < 0.05)) {
        this.collisionSystem.addStatic(c.x, c.z, c.radius);
      }
    }

    // Dynamic closed-door collider: while the portal is LOCKED or ACTIVATING,
    // the central doorway / stone seal is 100% solid. Radius 1.2 matches
    // the arch doorway opening without protruding onto the approach stairs.
    this.collisionSystem.addDynamicProvider(() => {
      if (!this.mesh || !this.mesh.visible) return null;
      if (this.state === PORTAL_STATES.LOCKED || this.state === PORTAL_STATES.ACTIVATING) {
        return [
          { x: this.mesh.position.x, z: this.mesh.position.z, radius: 1.2 },
        ];
      }
      return null;
    });

    this._collidersRegistered = true;
  }

  /**
   * Computes the vertical elevation of the raised stone portal base/dais and approach stairs
   * at a given world (x, z) coordinate. Returns null if outside the portal platform.
   */
  getPlatformHeight(worldX, worldZ) {
    if (!this.mesh || !this.mesh.visible) return null;

    const rad = this.mesh.rotation.y;
    const dx = worldX - this.mesh.position.x;
    const dz = worldZ - this.mesh.position.z;
    const cos = Math.cos(-rad);
    const sin = Math.sin(-rad);
    const localX = dx * cos + dz * sin;
    const localZ = -dx * sin + dz * cos;

    const distToCenter = Math.hypot(localX, localZ);

    // 1. Approach stairs leading up onto the stone platform (localX within [-1.6, 1.6])
    if (Math.abs(localX) <= 1.6 && localZ >= 0.55 && localZ <= 3.7) {
      if (localZ <= 1.65) {
        // Tier 3: Upper threshold step
        return this.mesh.position.y + 0.41;
      } else if (localZ <= 2.65) {
        // Tier 2: Middle stone step
        return this.mesh.position.y + 0.23;
      } else {
        // Tier 1: Lowest broad entrance step
        const t = (3.7 - localZ) / (3.7 - 2.65);
        return this.mesh.position.y + 0.02 + t * 0.12;
      }
    }

    // 2. Upper dais stone landing (circular top where arch pillars stand)
    if (distToCenter <= 3.6) {
      if (distToCenter > 3.2) {
        const edgeT = (3.6 - distToCenter) / 0.4;
        return this.mesh.position.y + 0.405 * edgeT;
      }
      return this.mesh.position.y + 0.405;
    }

    return null;
  }

  /**
   * Re-aligns portal base and Dais elevation to terrain heightmap.
   */
  realignToTerrain() {
    if (!this.mesh) return;
    this.mesh.position.y = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
  }

  /**
   * Authoritative unlock trigger called downstream of Rival defeat.
   * Guaranteed to trigger activation sequence exactly once.
   */
  unlock() {
    if (this._hasUnlocked || this.state !== PORTAL_STATES.LOCKED) {
      return false;
    }
    this._hasUnlocked = true;
    if (!this._discovered) {
      this._discovered = true;
      this.onDiscovered?.();
    }
    this.state = PORTAL_STATES.ACTIVATING;
    this.stateTime = 0;
    this._lastRuneLightIndex = -1;

    // Immediate awakening shockwave
    playPortalAwakenSound();
    if (this.resourceManager?.particles) {
      const pulsePos = this.mesh.position.clone();
      pulsePos.y += 3.4;
      this.resourceManager.particles.spawnBurst(pulsePos, 0x38efdf, 18);
    }

    return true;
  }

  /**
   * Whether the portal is currently playing the absorption / transition sequence.
   */
  isTransitioning() {
    return this.state === PORTAL_STATES.TRANSITIONING;
  }

  /**
   * Intentional player entry interaction.
   */
  enterPortal() {
    if (this.state !== PORTAL_STATES.ACTIVE) return false;

    this.state = PORTAL_STATES.TRANSITIONING;
    this.stateTime = 0;
    this._transitionTimer = 0;
    this.uiManager.hidePortalPrompt?.();

    // Lock player movement
    // Lock player movement and grant invulnerability during absorption cutscene
    this.playerController.haltMovement();
    this.playerHealth?.grantInvulnerability?.(this.config.transitionDuration + 2.0);
    this._playerInitialPos.copy(this.player.position);

    playPortalEnterSound();

    if (this.resourceManager?.particles) {
      this.resourceManager.particles.spawnBurst(this.player.position, 0x7df9ff, 15);
    }

    return true;
  }

  /**
   * Main per-frame update loop.
   */
  update(deltaTime) {
    if (!this.mesh || !this.mesh.visible) return;

    this.stateTime += deltaTime;
    this._updateParticles(deltaTime);

    switch (this.state) {
      case PORTAL_STATES.LOCKED:
        this._updateLocked(deltaTime);
        break;
      case PORTAL_STATES.ACTIVATING:
        this._updateActivating(deltaTime);
        break;
      case PORTAL_STATES.ACTIVE:
        this._updateActive(deltaTime);
        break;
      case PORTAL_STATES.TRANSITIONING:
        this._updateTransitioning(deltaTime);
        break;
    }
  }

  // --- State Updates ---

  _updateLocked(deltaTime) {
    const distToPlayer = this._getHorizontalDistanceToPlayer();
    this._checkDiscovery(distToPlayer);
    const isNear = distToPlayer <= this.config.interactionRadius;

    if (isNear && !this._isPlayerNear) {
      this._isPlayerNear = true;
      this.uiManager.showPortalDormantHint?.('Ancient Gateway — Sealed by a fierce presence.');
    } else if (!isNear && this._isPlayerNear) {
      this._isPlayerNear = false;
      this.uiManager.hidePortalDormantHint?.();
    }

    if (this._bumpSoundCooldown > 0) {
      this._bumpSoundCooldown -= deltaTime;
    }

    // Audible feedback if the player tries to push against the sealed doorway
    if (distToPlayer <= 2.6 && this._bumpSoundCooldown <= 0) {
      const speedSq = this.playerController?.currentVelocity?.lengthSq?.() ?? 0;
      if (speedSq > 0.4) {
        this._bumpSoundCooldown = 1.0;
        playPortalDormantClickSound();
      }
    }

    // Keep dormant visuals static and calm
    const u = this.mesh.userData;
    if (u.portalLight) {
      u.portalLight.intensity = isNear ? 0.35 : 0.15;
    }
  }

  _updateActivating(deltaTime) {
    const u = this.mesh.userData;
    const progress = Math.min(this.stateTime / this.config.activationDuration, 1.0);

    // 1. Progressively light runes from bottom to top
    const runes = u.runes || [];
    const runeCount = runes.length;
    const runeProgress = Math.min(this.stateTime / (this.config.activationDuration * 0.65), 1.0);
    const activeRuneCount = Math.floor(runeProgress * runeCount);

    for (let i = 0; i < runeCount; i++) {
      const rune = runes[i];
      if (i < activeRuneCount) {
        rune.currentIntensity = THREE.MathUtils.lerp(rune.currentIntensity, 2.6, deltaTime * 8);
        if (i > this._lastRuneLightIndex) {
          this._lastRuneLightIndex = i;
          playPortalRuneLightSound(i);
          if (this.resourceManager?.particles) {
            this.resourceManager.particles.spawnBurst(rune.mesh.getWorldPosition(new THREE.Vector3()), 0x38efdf, 4);
          }
        }
      } else {
        rune.currentIntensity = THREE.MathUtils.lerp(rune.currentIntensity, 0.08, deltaTime * 4);
      }
      rune.material.emissiveIntensity = rune.currentIntensity;
    }

    // 2. Dormant stone core cracks glow and fade out
    if (u.dormantCoreMesh && u.dormantCoreMat) {
      if (progress > 0.35) {
        const fadeT = (progress - 0.35) / 0.45;
        u.dormantCoreMat.emissiveIntensity = 0.15 + (1.0 - fadeT) * 1.5;
        u.dormantCoreMesh.scale.setScalar(Math.max(1.0 - fadeT * fadeT, 0.001));
        if (fadeT >= 1.0) {
          u.dormantCoreMesh.visible = false;
        }
      }
    }

    // 3. Active swirling vortex fades in
    if (progress > 0.5) {
      if (u.activeCoreGroup && !u.activeCoreGroup.visible) {
        u.activeCoreGroup.visible = true;
      }
      const vortexT = Math.min((progress - 0.5) / 0.5, 1.0);
      if (u.vortexMat1) u.vortexMat1.opacity = vortexT * 0.88;
      if (u.vortexMat2) u.vortexMat2.opacity = vortexT * 0.65;
      if (u.rimMat) u.rimMat.opacity = vortexT * 0.9;
      if (u.portalLight) u.portalLight.intensity = THREE.MathUtils.lerp(0.2, 2.5, vortexT);
    }

    // Spin vortex during activation
    if (u.vortexMesh1) u.vortexMesh1.rotation.z += deltaTime * 1.2;
    if (u.vortexMesh2) u.vortexMesh2.rotation.z -= deltaTime * 0.9;

    // Sequence complete -> transition to ACTIVE
    if (progress >= 1.0) {
      this.state = PORTAL_STATES.ACTIVE;
      this.stateTime = 0;
      if (u.activeCoreGroup) u.activeCoreGroup.visible = true;
      if (u.dormantCoreMesh) u.dormantCoreMesh.visible = false;
      this.uiManager.showPortalAwakenedBanner?.('Ancient Gateway Awakened');
    }
  }

  _updateActive(deltaTime) {
    const u = this.mesh.userData;

    // 1. Organic dual-speed counter-rotating vortex
    if (u.vortexMesh1) u.vortexMesh1.rotation.z += deltaTime * 0.85;
    if (u.vortexMesh2) u.vortexMesh2.rotation.z -= deltaTime * 0.62;

    // 2. Soft pulsing of runes
    const pulse = Math.sin(this.stateTime * 2.8) * 0.4 + 2.0;
    for (const rune of u.runes || []) {
      rune.material.emissiveIntensity = pulse;
    }

    // 3. Ambient light flicker
    const distToPlayer = this._getHorizontalDistanceToPlayer();
    this._checkDiscovery(distToPlayer);
    const isNear = distToPlayer <= this.config.interactionRadius;

    if (u.portalLight) {
      const flicker = Math.sin(this.stateTime * 5.0) * 0.15 + (Math.random() - 0.5) * 0.05;
      const baseLight = isNear ? 3.0 : 2.2;
      u.portalLight.intensity = baseLight + flicker;
    }

    // 4. Player proximity detection and prompt
    if (isNear && !this._isPlayerNear) {
      this._isPlayerNear = true;
      this.uiManager.showPortalPrompt?.('Go to Next Biome', () => this.enterPortal());
    } else if (!isNear && this._isPlayerNear) {
      this._isPlayerNear = false;
      this.uiManager.hidePortalPrompt?.();
    }
  }

  _updateTransitioning(deltaTime) {
    const u = this.mesh.userData;
    this._transitionTimer += deltaTime;
    const totalDuration = this.config.transitionDuration;
    const t = Math.min(this._transitionTimer / totalDuration, 1.0);

    // Accelerate vortex spin
    if (u.vortexMesh1) u.vortexMesh1.rotation.z += deltaTime * (2.5 + t * 5.0);
    if (u.vortexMesh2) u.vortexMesh2.rotation.z -= deltaTime * (2.0 + t * 4.0);

    // Pull/absorb player toward portal center threshold
    const portalCenter = this.mesh.position.clone();
    portalCenter.y += 2.0;

    // Ease in toward portal center
    const pullT = Math.min(t * 1.5, 1.0);
    const easeT = pullT * pullT * (3.0 - 2.0 * pullT);
    this.player.position.lerpVectors(this._playerInitialPos, portalCenter, easeT);

    // Player scale reduction (absorbed into gateway)
    if (t > 0.3) {
      const shrinkT = (t - 0.3) / 0.7;
      const playerScale = Math.max(1.0 - shrinkT * 0.85, 0.05);
      this.player.scale.setScalar(playerScale);
    }

    // Screen fade progression: fade to white/cyan flash at mid-point, then deep black
    if (t < 0.6) {
      // Glow ramp
      if (u.portalLight) u.portalLight.intensity = 3.0 + t * 4.0;
    } else {
      const fadeProgress = (t - 0.6) / 0.4;
      this.uiManager.setScreenFade?.(Math.min(fadeProgress * 1.2, 1.0));
    }

    // Finish transition
    if (t >= 1.0) {
      this._completeBiomeTransition();
    }
  }

  _completeBiomeTransition() {
    this.state = PORTAL_STATES.ACTIVE; // Reset state for future
    this.player.scale.setScalar(1.0);

    // If external transition hook is registered (e.g. to end the prototype run), delegate entirely
    if (this.onBiomeTransition) {
      try {
        this.onBiomeTransition({
          fromBiomeId: this.config.currentBiomeId,
          toBiomeId: this.config.destinationBiomeId,
          spawnPosition: this.config.destinationSpawnPosition,
        });
      } catch (err) {
        console.error('[Portal] Error in onBiomeTransition callback:', err);
      }
      return;
    }

    // Default fallback: Spawn player at target location
    const spawn = this.config.destinationSpawnPosition;
    this.player.position.set(spawn.x, spawn.y, spawn.z);
    this.playerController.haltMovement();

    // Restore control & fade back in
    setTimeout(() => {
      this.uiManager.setScreenFade?.(0);
      this.uiManager.showBiomeArrivalBanner?.('Entered ' + this.config.destinationBiomeId.replace(/_/g, ' ').toUpperCase());
    }, 300);
  }

  _updateParticles(deltaTime) {
    const u = this.mesh.userData;
    if (!u.particles || !u.particlePositions || !u.particleVelocities) return;

    const positions = u.particlePositions;
    const velocities = u.particleVelocities;
    const isActive = this.state === PORTAL_STATES.ACTIVE || this.state === PORTAL_STATES.TRANSITIONING;

    for (let i = 0; i < velocities.length; i++) {
      const v = velocities[i];
      v.phase += deltaTime * v.wobbleSpeed;

      if (isActive) {
        // Swirling inwards towards the vortex center (0, 3.4, 0)
        v.angle += deltaTime * (v.speed * 1.8);
        v.dist -= deltaTime * 0.25;
        if (v.dist < 0.2) {
          v.dist = 2.4 + Math.random() * 0.6;
          v.baseY = 1.0 + Math.random() * 4.5;
        }
      } else {
        // Gentle ambient drift
        v.angle += deltaTime * (v.speed * 0.3);
      }

      const px = Math.cos(v.angle) * v.dist;
      const pz = Math.sin(v.angle) * (v.dist * 0.6);
      const py = v.baseY + Math.sin(v.phase) * 0.25;

      positions[i * 3 + 0] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;
    }

    u.particles.geometry.attributes.position.needsUpdate = true;
  }

  _getHorizontalDistanceToPlayer() {
    if (!this.player) return 9999;
    const dx = this.player.position.x - this.mesh.position.x;
    const dz = this.player.position.z - this.mesh.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  _checkDiscovery(distToPlayer) {
    if (this._discovered) return;
    if (distToPlayer <= this.config.discoveryRadius) {
      this._discovered = true;
      playPortalDiscoveredSound();
      const text = this.state === PORTAL_STATES.ACTIVE
        ? 'Active Gateway Located — Marked on Radar'
        : 'Ancient Gateway Discovered — Marked on Radar';
      this.uiManager.showPortalDiscovered?.(text);
      this.onDiscovered?.();
    }
  }

  isDiscovered() {
    return this._discovered;
  }

  getPosition() {
    return this.mesh ? this.mesh.position : this.config.position;
  }

  /**
   * Reset for Play Again without memory leaks.
   */
  reset() {
    this.state = PORTAL_STATES.LOCKED;
    this.stateTime = 0;
    this._isPlayerNear = false;
    this._hasUnlocked = false;
    this._discovered = false;
    this._transitionTimer = 0;
    this._lastRuneLightIndex = -1;
    this._bumpSoundCooldown = 0;

    const u = this.mesh.userData;
    if (u.activeCoreGroup) u.activeCoreGroup.visible = false;
    if (u.dormantCoreMesh) {
      u.dormantCoreMesh.visible = true;
      u.dormantCoreMesh.scale.set(1.0, 1.35, 1.0);
    }
    if (u.dormantCoreMat) u.dormantCoreMat.emissiveIntensity = 0.15;
    if (u.portalLight) u.portalLight.intensity = 0.2;

    for (const rune of u.runes || []) {
      rune.currentIntensity = 0.05;
      rune.material.emissiveIntensity = 0.05;
    }

    this.uiManager.hidePortalPrompt?.();
    this.uiManager.hidePortalDormantHint?.();
    if (this.player) this.player.scale.setScalar(1.0);
  }

  /**
   * Safe cleanup of Three.js objects and textures.
   */
  destroy() {
    if (this.playerController && this.playerController.portalProvider === this) {
      this.playerController.portalProvider = null;
    }
    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    this.mesh.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        } else {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      }
    });
  }
}

