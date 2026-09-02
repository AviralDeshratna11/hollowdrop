import * as THREE from 'three';
import { createApexMesh } from './apexModel.js?v=5.3';
import { getTerrainHeight } from './terrain.js?v=5.3';
import {
  playApexRoarSound,
  playApexAttackSound,
  playApexChargeSound,
  playApexSlamSound,
  playApexToxicSound,
  playApexBurrowSound,
  playApexEmergeSound,
  playApexHitSound,
  playApexDeathSound,
  playBiteHitSound,
} from './soundEffects.js?v=5.3';

export const DEBUG_APEX = false;

export const APEX_CONFIG = {
  maxHealth: 180, // Balanced multi-phase boss HP
  moveSpeed: 1.9,
  phase2MoveSpeedMultiplier: 1.22,
  phase2RecoveryMultiplier: 0.8,
  phase2ToxicCooldownMultiplier: 0.7,
  phase3MoveSpeedMultiplier: 1.38,
  phase3RecoveryMultiplier: 0.65,
  phase2Threshold: 0.60,
  phase3Threshold: 0.30,
  turnSmoothing: 5.5,

  arenaRadius: 9.5,
  disengageBuffer: 4,

  introDuration: 1.2,
  phaseTransitionDuration: 0.9,
  deathDuration: 2.0,
  deathStaggerFraction: 0.2,

  staggerDuration: 0.06,
  hitFlashDuration: 0.15,
  hitRecoilDuration: 0.12,

  attackRangeCloseSq: 2.8 ** 2,
  attackRangeFarSq: 5.5 ** 2,
  maxRepeatAttacks: 2,

  charge: { telegraph: 0.55, speed: 10.5, maxDistance: 9.5, damage: 22, hitRadius: 1.25, recovery: 0.7, cooldown: 2.8 },
  slam: { telegraph: 0.5, active: 0.16, damage: 28, range: 2.3, recovery: 0.6, cooldown: 2.0 },
  toxic: { telegraph: 0.75, damage: 18, radius: 3.2, recovery: 0.75, cooldown: 3.5 },
  burrow: { telegraph: 0.5, travelSpeed: 7.5, maxDuration: 2.0, damage: 32, emergeRadius: 2.6, recovery: 0.75, cooldown: 5.0 },
};

export const APEX_LOOT = [{ type: 'apex_dna', count: 1 }];

const STATES = {
  DORMANT: 'DORMANT',
  INTRO: 'INTRO',
  COMBAT: 'COMBAT',
  CHARGE_TELEGRAPH: 'CHARGE_TELEGRAPH',
  CHARGE: 'CHARGE',
  SLAM_TELEGRAPH: 'SLAM_TELEGRAPH',
  SLAM: 'SLAM',
  TOXIC_TELEGRAPH: 'TOXIC_TELEGRAPH',
  TOXIC_BURST: 'TOXIC_BURST',
  BURROW_TELEGRAPH: 'BURROW_TELEGRAPH',
  BURROWED: 'BURROWED',
  EMERGE_ATTACK: 'EMERGE_ATTACK',
  RECOVERY: 'RECOVERY',
  PHASE_TRANSITION: 'PHASE_TRANSITION',
  DEAD: 'DEAD',
};

const DAMAGEABLE_STATES = new Set([
  STATES.COMBAT,
  STATES.CHARGE_TELEGRAPH,
  STATES.CHARGE,
  STATES.SLAM_TELEGRAPH,
  STATES.SLAM,
  STATES.TOXIC_TELEGRAPH,
  STATES.TOXIC_BURST,
  STATES.BURROW_TELEGRAPH,
  STATES.EMERGE_ATTACK,
  STATES.RECOVERY,
]);

const ARENA_RADIUS_SQ = APEX_CONFIG.arenaRadius ** 2;
const DISENGAGE_RADIUS_SQ = (APEX_CONFIG.arenaRadius + APEX_CONFIG.disengageBuffer) ** 2;
const CHARGE_HIT_RADIUS_SQ = APEX_CONFIG.charge.hitRadius ** 2;
const CHARGE_DURATION = APEX_CONFIG.charge.maxDistance / APEX_CONFIG.charge.speed;

const tempDirection = new THREE.Vector3();
const tempA = new THREE.Vector3();

function horizontalDistanceSq(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function createGroundRing(radius, color) {
  const geometry = new THREE.RingGeometry(radius * 0.94, radius, 48);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  return ring;
}

/**
 * Murkmaw — Overhauled Apex Boss Encounter.
 */
export class ApexController {
  constructor({
    scene,
    arenaCenter,
    playerController,
    playerHealth,
    uiManager,
    resourceManager,
    genomeFragmentController,
    combatVFX = null,
    screenShake = null,
    onDefeated,
  }) {
    this.scene = scene;
    this.arenaCenter = arenaCenter.clone();
    this.playerController = playerController;
    this.player = playerController.mesh;
    this.playerHealth = playerHealth;
    this.uiManager = uiManager;
    this.resourceManager = resourceManager;
    this.genomeFragmentController = genomeFragmentController;
    this.combatVFX = combatVFX;
    this.screenShake = screenShake;
    this.onDefeated = onDefeated;

    this.mesh = createApexMesh();
    this.mesh.position.copy(this.arenaCenter);
    this.mesh.scale.setScalar(0.55);
    scene.add(this.mesh);

    this.state = STATES.DORMANT;
    this.stateTime = 0;
    this.facingAngle = 0;
    this._elapsed = 0;
    this.phase = 1;

    this.maxHealth = APEX_CONFIG.maxHealth;
    this.currentHealth = this.maxHealth;

    this._staggerTimer = 0;
    this._hitFlashTimer = null;
    this._hitRecoilTimer = null;
    this._bodyBaseEmissiveIntensity = this.mesh.userData.bodyMaterial.emissiveIntensity;
    this._deathTime = null;
    this._hudVisible = false;

    this._chargeCooldownTimer = 0;
    this._slamCooldownTimer = 0;
    this._toxicCooldownTimer = 0;
    this._burrowCooldownTimer = 3.0; // small initial cooldown
    this._lastAttack = null;
    this._lastAttackStreak = 0;
    this._hasHitThisAttack = false;
    this._recoveryDuration = 0;
    this._chargeDirection = new THREE.Vector3();
    this._chargeStartPosition = new THREE.Vector3();
    this._chargeTraveled = 0;
    this._toxicCenter = new THREE.Vector3();
    this._burrowTarget = new THREE.Vector3();
    this._tremorTimer = 0;

    // Telegraph meshes
    this._chargeStreak = this._createChargeStreak();
    this._slamRing = createGroundRing(APEX_CONFIG.slam.range, 0xff3311);
    this._toxicRing = createGroundRing(APEX_CONFIG.toxic.radius, 0xb23fff);
    scene.add(this._chargeStreak, this._slamRing, this._toxicRing);
  }

  _createChargeStreak() {
    const geometry = new THREE.PlaneGeometry(0.6, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xff3311, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.03;
    return mesh;
  }

  setState(next) {
    if (this.state === next) return;
    if (DEBUG_APEX) console.log(`Murkmaw: ${this.state} -> ${next}`);
    this.state = next;
    this.stateTime = 0;
  }

  startEncounter() {
    if (this.state !== STATES.DORMANT) return;
    this.setState(STATES.INTRO);
    this.uiManager.updateBossHealth(this.currentHealth / this.maxHealth);
    playApexRoarSound();
    this.screenShake?.add(0.4);
    if (DEBUG_APEX) console.log('Apex encounter started');
  }

  // --- Combat interface ---

  getDamageableEntities() {
    return DAMAGEABLE_STATES.has(this.state) ? [this] : [];
  }

  takeDamage(amount, info = {}) {
    if (!DAMAGEABLE_STATES.has(this.state)) return false;

    this.currentHealth = Math.max(0, this.currentHealth - amount);
    this.uiManager.updateBossHealth(this.currentHealth / this.maxHealth);
    this._hitFlashTimer = 0;
    this._hitRecoilTimer = 0;
    this._staggerTimer = APEX_CONFIG.staggerDuration;

    this.resourceManager.particles.spawnBurst(this.mesh.position, 0x4dffb2, 6);
    playApexHitSound();

    if (DEBUG_APEX) {
      console.log(`Hit Murkmaw: ${amount} dmg. HP: ${this.currentHealth}/${this.maxHealth}`);
    }

    if (this.currentHealth <= 0) {
      this._die();
    } else if (this.phase === 1 && this.currentHealth / this.maxHealth <= APEX_CONFIG.phase2Threshold) {
      this._enterPhaseTransition(2);
    } else if (this.phase === 2 && this.currentHealth / this.maxHealth <= APEX_CONFIG.phase3Threshold) {
      this._enterPhaseTransition(3);
    }
    return true;
  }

  // --- Debug-only helpers ---

  debugForceAttack(type) {
    if (!DEBUG_APEX || this.state !== STATES.COMBAT) return;
    if (type === 'charge') this._beginCharge();
    else if (type === 'slam') this._beginSlam();
    else if (type === 'toxic') this._beginToxic();
    else if (type === 'burrow') this._beginBurrow();
  }

  debugForcePhase2() {
    if (!DEBUG_APEX || this.phase >= 2) return;
    this.currentHealth = Math.min(this.currentHealth, this.maxHealth * APEX_CONFIG.phase2Threshold);
    this.uiManager.updateBossHealth(this.currentHealth / this.maxHealth);
    this._enterPhaseTransition(2);
  }

  debugForcePhase3() {
    if (!DEBUG_APEX || this.phase >= 3) return;
    this.currentHealth = Math.min(this.currentHealth, this.maxHealth * APEX_CONFIG.phase3Threshold);
    this.uiManager.updateBossHealth(this.currentHealth / this.maxHealth);
    this._enterPhaseTransition(3);
  }

  debugSetHealth(amount) {
    if (!DEBUG_APEX) return;
    this.currentHealth = Math.max(0, Math.min(amount, this.maxHealth));
    this.uiManager.updateBossHealth(this.currentHealth / this.maxHealth);
    if (this.currentHealth <= 0) this._die();
  }

  // --- Main update loop ---

  update(deltaTime) {
    if (this.state === STATES.DORMANT) return;

    if (this.state === STATES.DEAD) {
      this._updateDeath(deltaTime);
      return;
    }

    this._updateBossHudVisibility();
    this._applyHitFlashAndRecoil(deltaTime);

    if (this._chargeCooldownTimer > 0) this._chargeCooldownTimer = Math.max(0, this._chargeCooldownTimer - deltaTime);
    if (this._slamCooldownTimer > 0) this._slamCooldownTimer = Math.max(0, this._slamCooldownTimer - deltaTime);
    if (this._toxicCooldownTimer > 0) this._toxicCooldownTimer = Math.max(0, this._toxicCooldownTimer - deltaTime);
    if (this._burrowCooldownTimer > 0) this._burrowCooldownTimer = Math.max(0, this._burrowCooldownTimer - deltaTime);

    if (this._staggerTimer > 0) {
      this._staggerTimer = Math.max(0, this._staggerTimer - deltaTime);
      this._elapsed += deltaTime;
      this._applyIdleAnimation(deltaTime);
      return;
    }

    this._elapsed += deltaTime;
    this.stateTime += deltaTime;

    if (this.state !== STATES.DEAD && this.state !== STATES.DORMANT && this.state !== STATES.BURROWED) {
      const targetY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
      const ySmooth = 1 - Math.exp(-12.0 * deltaTime);
      this.mesh.position.y += (targetY - this.mesh.position.y) * ySmooth;
    }

    switch (this.state) {
      case STATES.INTRO:
        this._updateIntro(deltaTime);
        break;
      case STATES.COMBAT:
        this._updateCombat(deltaTime);
        break;
      case STATES.CHARGE_TELEGRAPH:
        this._updateChargeTelegraph(deltaTime);
        break;
      case STATES.CHARGE:
        this._updateCharge(deltaTime);
        break;
      case STATES.SLAM_TELEGRAPH:
        this._updateSlamTelegraph(deltaTime);
        break;
      case STATES.SLAM:
        this._updateSlam(deltaTime);
        break;
      case STATES.TOXIC_TELEGRAPH:
        this._updateToxicTelegraph(deltaTime);
        break;
      case STATES.TOXIC_BURST:
        this._updateToxicBurst(deltaTime);
        break;
      case STATES.BURROW_TELEGRAPH:
        this._updateBurrowTelegraph(deltaTime);
        break;
      case STATES.BURROWED:
        this._updateBurrowed(deltaTime);
        break;
      case STATES.EMERGE_ATTACK:
        this._updateEmergeAttack(deltaTime);
        break;
      case STATES.RECOVERY:
        this._updateRecovery(deltaTime);
        break;
      case STATES.PHASE_TRANSITION:
        this._updatePhaseTransition(deltaTime);
        break;
    }

    this._applyIdleAnimation(deltaTime);
  }

  // --- States implementation ---

  _updateIntro(deltaTime) {
    const t = Math.min(this.stateTime / APEX_CONFIG.introDuration, 1);
    this.mesh.scale.setScalar(THREE.MathUtils.lerp(0.55, 1, t));
    this._faceToward(this.player.position, deltaTime, APEX_CONFIG.turnSmoothing * 0.5);
    if (t >= 1) {
      this.mesh.userData.setMandibleState?.(0.3);
      this.setState(STATES.COMBAT);
    }
  }

  _isPlayerInRange() {
    return horizontalDistanceSq(this.mesh.position, this.player.position) < DISENGAGE_RADIUS_SQ;
  }

  _updateBossHudVisibility() {
    const shouldShow = this._isPlayerInRange() && !this.playerHealth.isDead;
    if (shouldShow === this._hudVisible) return;
    this._hudVisible = shouldShow;
    if (shouldShow) {
      const title = this.phase === 3 ? 'MURKMAW — APEX FURY' : this.phase === 2 ? 'MURKMAW — ENRAGED APEX' : 'MURKMAW — APEX PREDATOR';
      this.uiManager.showBossHealth(title);
    } else {
      this.uiManager.hideBossHealth();
    }
  }

  _updateCombat(deltaTime) {
    if (this.playerHealth.isDead || !this._isPlayerInRange()) {
      this._moveToward(this.arenaCenter, this._getMoveSpeed(), deltaTime);
      return;
    }

    const attack = this._chooseAttack();
    if (attack === 'burrow') this._beginBurrow();
    else if (attack === 'charge') this._beginCharge();
    else if (attack === 'slam') this._beginSlam();
    else if (attack === 'toxic') this._beginToxic();
    else this._moveToward(this.player.position, this._getMoveSpeed(), deltaTime);
  }

  _chooseAttack() {
    const distSq = horizontalDistanceSq(this.mesh.position, this.player.position);
    const weighted = [];

    // Phase 3 gets Subterranean Burrow
    if (this.phase === 3 && this._burrowCooldownTimer <= 0) {
      weighted.push('burrow', 'burrow');
    }

    if (this._chargeCooldownTimer <= 0 && distSq > APEX_CONFIG.attackRangeFarSq) weighted.push('charge', 'charge');
    if (this._slamCooldownTimer <= 0 && distSq < APEX_CONFIG.attackRangeCloseSq) weighted.push('slam', 'slam');
    if (this._toxicCooldownTimer <= 0 && distSq >= APEX_CONFIG.attackRangeCloseSq) weighted.push('toxic');

    const pool = weighted.length > 0 ? weighted : ['charge', 'slam', 'toxic'].filter((a) => this._cooldownFor(a) <= 0);
    if (pool.length === 0) return null;

    const filtered = this._lastAttackStreak >= APEX_CONFIG.maxRepeatAttacks ? pool.filter((a) => a !== this._lastAttack) : pool;
    const finalPool = filtered.length > 0 ? filtered : pool;
    return finalPool[Math.floor(Math.random() * finalPool.length)];
  }

  _cooldownFor(attack) {
    if (attack === 'charge') return this._chargeCooldownTimer;
    if (attack === 'slam') return this._slamCooldownTimer;
    if (attack === 'burrow') return this._burrowCooldownTimer;
    return this._toxicCooldownTimer;
  }

  _markAttackChosen(attack) {
    this._lastAttackStreak = attack === this._lastAttack ? this._lastAttackStreak + 1 : 1;
    this._lastAttack = attack;
  }

  // --- Charge Attack ---

  _beginCharge() {
    this._markAttackChosen('charge');
    this._hasHitThisAttack = false;
    this.mesh.userData.setMandibleState?.(1.0); // Mandibles flare open
    this.setState(STATES.CHARGE_TELEGRAPH);
  }

  _updateChargeTelegraph(deltaTime) {
    this._faceToward(this.player.position, deltaTime, APEX_CONFIG.turnSmoothing * 1.5);
    const t = Math.min(this.stateTime / APEX_CONFIG.charge.telegraph, 1);
    this.mesh.userData.head.rotation.x = -0.2 * t; // crouch/rear back

    if (this.stateTime >= APEX_CONFIG.charge.telegraph) {
      tempDirection.copy(this.player.position).sub(this.mesh.position);
      tempDirection.y = 0;
      if (tempDirection.lengthSq() > 1e-6) tempDirection.normalize();
      else tempDirection.set(0, 0, 1);

      this._chargeDirection.copy(tempDirection);
      this._chargeStartPosition.copy(this.mesh.position);
      this._chargeTraveled = 0;

      this._chargeStreak.position.set(this.mesh.position.x, getTerrainHeight(this.mesh.position.x, this.mesh.position.z) + 0.04, this.mesh.position.z);
      this._chargeStreak.rotation.z = Math.atan2(tempDirection.x, tempDirection.z);
      this._chargeStreak.scale.set(1, APEX_CONFIG.charge.maxDistance, 1);
      this._chargeStreak.material.opacity = 0.45;

      playApexChargeSound();
      this.screenShake?.add(0.3);
      this.setState(STATES.CHARGE);
    }
  }

  _updateCharge(deltaTime) {
    const travel = APEX_CONFIG.charge.speed * deltaTime;
    this.mesh.position.addScaledVector(this._chargeDirection, travel);
    this._chargeTraveled += travel;
    this._chargeStreak.material.opacity = Math.max(0.45 * (1 - this.stateTime / CHARGE_DURATION), 0);

    if (!this._hasHitThisAttack && horizontalDistanceSq(this.mesh.position, this.player.position) < CHARGE_HIT_RADIUS_SQ) {
      this._hasHitThisAttack = true;
      this._hitPlayer(APEX_CONFIG.charge.damage, 'charge');
      this.screenShake?.add(0.45);
    }

    if (this._chargeTraveled >= APEX_CONFIG.charge.maxDistance || this.stateTime >= CHARGE_DURATION) {
      this._chargeStreak.material.opacity = 0;
      this.combatVFX?.spawnApexChargeFurrow(this._chargeStartPosition, this.mesh.position, this._chargeDirection);
      this.mesh.userData.setMandibleState?.(0.2);
      this._beginRecovery(APEX_CONFIG.charge.recovery);
      this._chargeCooldownTimer = APEX_CONFIG.charge.cooldown;
    }
  }

  // --- Seismic Ground Slam Attack ---

  _beginSlam() {
    this._markAttackChosen('slam');
    this._hasHitThisAttack = false;
    this.mesh.userData.setMandibleState?.(0.9);
    this.setState(STATES.SLAM_TELEGRAPH);
  }

  _updateSlamTelegraph(deltaTime) {
    this._faceToward(this.player.position, deltaTime, APEX_CONFIG.turnSmoothing * 1.5);
    const t = Math.min(this.stateTime / APEX_CONFIG.slam.telegraph, 1);
    this._slamRing.position.set(this.mesh.position.x, getTerrainHeight(this.mesh.position.x, this.mesh.position.z) + 0.04, this.mesh.position.z);
    this._slamRing.material.opacity = 0.6 * t;

    // Rears head up high
    this.mesh.userData.head.rotation.x = -0.55 * t;

    if (this.stateTime >= APEX_CONFIG.slam.telegraph) {
      playApexAttackSound();
      this.setState(STATES.SLAM);
    }
  }

  _updateSlam(deltaTime) {
    const t = Math.min(this.stateTime / APEX_CONFIG.slam.active, 1);
    this.mesh.userData.head.rotation.x = THREE.MathUtils.lerp(-0.55, 0.35, t); // slams down violently

    if (!this._hasHitThisAttack) {
      this._hasHitThisAttack = true;
      playApexSlamSound();
      this.screenShake?.add(0.55);
      this.combatVFX?.spawnApexSlamCrater(this.mesh.position, APEX_CONFIG.slam.range);

      if (horizontalDistanceSq(this.mesh.position, this.player.position) < APEX_CONFIG.slam.range ** 2) {
        tempA.copy(this.player.position).sub(this.mesh.position);
        tempA.y = 0;
        const facingForward = tempA.lengthSq() < 1e-6 || tempA.normalize().dot(this._getForward()) > 0.05;
        if (facingForward) {
          this._hitPlayer(APEX_CONFIG.slam.damage, 'slam');
        }
      }
    }

    if (this.stateTime >= APEX_CONFIG.slam.active) {
      this._slamRing.material.opacity = 0;
      this.mesh.userData.setMandibleState?.(0.2);
      this.mesh.userData.head.rotation.x = 0;
      this._beginRecovery(APEX_CONFIG.slam.recovery);
      this._slamCooldownTimer = APEX_CONFIG.slam.cooldown;
    }
  }

  // --- Toxic Miasma Nova Attack ---

  _beginToxic() {
    this._markAttackChosen('toxic');
    this._hasHitThisAttack = false;
    this._toxicCenter.copy(this.mesh.position);
    this.setState(STATES.TOXIC_TELEGRAPH);
  }

  _updateToxicTelegraph(deltaTime) {
    const t = Math.min(this.stateTime / APEX_CONFIG.toxic.telegraph, 1);
    this._toxicRing.position.set(this._toxicCenter.x, getTerrainHeight(this._toxicCenter.x, this._toxicCenter.z) + 0.04, this._toxicCenter.z);
    this._toxicRing.material.opacity = 0.2 + t * 0.45 + Math.sin(this.stateTime * 14) * 0.12;

    if (this.stateTime >= APEX_CONFIG.toxic.telegraph) {
      playApexAttackSound();
      this.setState(STATES.TOXIC_BURST);
    }
  }

  _updateToxicBurst(deltaTime) {
    if (!this._hasHitThisAttack) {
      this._hasHitThisAttack = true;
      playApexToxicSound();
      this.screenShake?.add(0.35);
      this.combatVFX?.spawnApexToxicNova(this._toxicCenter, APEX_CONFIG.toxic.radius);

      if (horizontalDistanceSq(this._toxicCenter, this.player.position) < APEX_CONFIG.toxic.radius ** 2) {
        this._hitPlayer(APEX_CONFIG.toxic.damage, 'toxic_burst');
      }
      this._toxicRing.material.opacity = 0;
    }

    if (this.stateTime >= 0.18) {
      this._beginRecovery(APEX_CONFIG.toxic.recovery);
      this._toxicCooldownTimer = this.phase >= 2 ? APEX_CONFIG.toxic.cooldown * APEX_CONFIG.phase2ToxicCooldownMultiplier : APEX_CONFIG.toxic.cooldown;
    }
  }

  // --- Subterranean Burrow & Eruption (Phase 3 Exclusive) ---

  _beginBurrow() {
    this._markAttackChosen('burrow');
    this._hasHitThisAttack = false;
    this._burrowTarget.copy(this.player.position);
    this._tremorTimer = 0;
    playApexBurrowSound();
    this.setState(STATES.BURROW_TELEGRAPH);
  }

  _updateBurrowTelegraph(deltaTime) {
    const t = Math.min(this.stateTime / APEX_CONFIG.burrow.telegraph, 1);
    // Sinks down into terrain
    this.mesh.scale.setScalar(THREE.MathUtils.lerp(1, 0.1, t));
    this.mesh.position.y -= deltaTime * 3.0;

    if (this.stateTime >= APEX_CONFIG.burrow.telegraph) {
      this.mesh.visible = false;
      this.setState(STATES.BURROWED);
    }
  }

  _updateBurrowed(deltaTime) {
    this._tremorTimer += deltaTime;
    // Rapidly stalks toward player underground
    this._burrowTarget.copy(this.player.position);
    tempDirection.copy(this._burrowTarget).sub(this.mesh.position);
    tempDirection.y = 0;
    const distSq = tempDirection.lengthSq();

    if (distSq > 0.3) {
      tempDirection.normalize();
      this.mesh.position.addScaledVector(tempDirection, APEX_CONFIG.burrow.travelSpeed * deltaTime);
    }

    // Spawn tracking surface tremor puff every 0.14s
    if (this._tremorTimer >= 0.14) {
      this._tremorTimer = 0;
      this.combatVFX?.spawnApexTremor(this.mesh.position);
      this.screenShake?.add(0.08);
    }

    if (distSq < 1.2 || this.stateTime >= APEX_CONFIG.burrow.maxDuration) {
      this.mesh.visible = true;
      this.mesh.scale.setScalar(0.4);
      this.mesh.userData.setMandibleState?.(1.0);
      playApexEmergeSound();
      this.screenShake?.add(0.65);
      this.combatVFX?.spawnApexSubterraneanEruption(this.mesh.position);
      this.setState(STATES.EMERGE_ATTACK);
    }
  }

  _updateEmergeAttack(deltaTime) {
    const t = Math.min(this.stateTime / 0.35, 1);
    this.mesh.scale.setScalar(THREE.MathUtils.lerp(0.4, 1.15, t));

    if (!this._hasHitThisAttack) {
      this._hasHitThisAttack = true;
      if (horizontalDistanceSq(this.mesh.position, this.player.position) < APEX_CONFIG.burrow.emergeRadius ** 2) {
        this._hitPlayer(APEX_CONFIG.burrow.damage, 'subterranean_eruption');
      }
    }

    if (this.stateTime >= 0.35) {
      this.mesh.scale.setScalar(1.0);
      this.mesh.userData.setMandibleState?.(0.2);
      this._beginRecovery(APEX_CONFIG.burrow.recovery);
      this._burrowCooldownTimer = APEX_CONFIG.burrow.cooldown;
    }
  }

  // --- Recovery / Phase transitions ---

  _beginRecovery(duration) {
    this._recoveryDuration = duration * this._getRecoveryMultiplier();
    this.setState(STATES.RECOVERY);
  }

  _updateRecovery(deltaTime) {
    if (this.stateTime >= this._recoveryDuration) this.setState(STATES.COMBAT);
  }

  _enterPhaseTransition(newPhase) {
    this.phase = newPhase;
    this._chargeStreak.material.opacity = 0;
    this._slamRing.material.opacity = 0;
    this._toxicRing.material.opacity = 0;
    this.setState(STATES.PHASE_TRANSITION);

    this.mesh.userData.setEnragedPhase?.(newPhase);
    this.resourceManager.particles.spawnBurst(this.mesh.position, newPhase === 3 ? 0xff4400 : 0xd92638, 16);
    playApexRoarSound();
    this.screenShake?.add(0.5);

    this._updateBossHudVisibility();
    if (DEBUG_APEX) console.log(`Murkmaw entering Phase ${newPhase}`);
  }

  _updatePhaseTransition(deltaTime) {
    const t = Math.min(this.stateTime / APEX_CONFIG.phaseTransitionDuration, 1);
    this.mesh.scale.setScalar(1.0 + Math.sin(t * Math.PI) * 0.18);
    this.mesh.userData.setMandibleState?.(Math.sin(t * Math.PI * 4) * 0.5 + 0.5);

    if (t >= 1) {
      this.mesh.scale.setScalar(1.0);
      this.mesh.userData.setMandibleState?.(0.2);
      this.setState(STATES.COMBAT);
    }
  }

  // --- Death sequence ---

  _die() {
    if (this.state === STATES.DEAD) return;
    this.setState(STATES.DEAD);
    this._deathTime = 0;
    this._chargeStreak.material.opacity = 0;
    this._slamRing.material.opacity = 0;
    this._toxicRing.material.opacity = 0;

    this.resourceManager.particles.spawnBurst(this.mesh.position, 0xff2200, 18);
    this.screenShake?.add(0.55);
    playApexDeathSound();
    this.onDefeated?.();
    if (DEBUG_APEX) console.log('Murkmaw defeated');
  }

  _updateDeath(deltaTime) {
    this._deathTime += deltaTime;
    const t = Math.min(this._deathTime / APEX_CONFIG.deathDuration, 1);
    const { eyeMaterial, glandMaterial, coreGlandMaterial, pustuleMaterial } = this.mesh.userData;

    const staggerFraction = APEX_CONFIG.deathStaggerFraction;
    if (t < staggerFraction) {
      const st = t / staggerFraction;
      this.mesh.rotation.z = Math.sin(st * Math.PI * 3) * 0.08 * (1 - st);
      eyeMaterial.emissiveIntensity = THREE.MathUtils.lerp(0.8, 0.1, st);
    } else {
      const ct = (t - staggerFraction) / (1 - staggerFraction);
      const collapseT = ct * ct;
      this.mesh.scale.setScalar(Math.max(1 - collapseT, 0.001));
      this.mesh.position.y = Math.max(this.arenaCenter.y - collapseT * 0.3, this.arenaCenter.y - 0.3);
      eyeMaterial.emissiveIntensity = THREE.MathUtils.lerp(0.1, 0, collapseT);
      if (pustuleMaterial) pustuleMaterial.emissiveIntensity = THREE.MathUtils.lerp(2.0, 0, collapseT);
    }

    if (t >= 1 && this.mesh.visible) {
      this._dropLoot();
      this.uiManager.hideBossHealth();
      this._hudVisible = false;
      this.genomeFragmentController.spawn(this.mesh.position.clone().setY(this.arenaCenter.y + 0.2));
      this.mesh.visible = false;
    }
  }

  _dropLoot() {
    for (const { type, count } of APEX_LOOT) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dropX = this.mesh.position.x + Math.cos(angle) * 0.5;
        const dropZ = this.mesh.position.z + Math.sin(angle) * 0.5;
        this.resourceManager.spawnResource(type, new THREE.Vector3(dropX, getTerrainHeight(dropX, dropZ), dropZ));
      }
    }
  }

  reset() {
    this.state = STATES.DORMANT;
    this.stateTime = 0;
    this.facingAngle = 0;
    this.phase = 1;
    this.currentHealth = this.maxHealth;

    this.mesh.position.copy(this.arenaCenter);
    this.mesh.scale.setScalar(0.55);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.visible = true;

    this._staggerTimer = 0;
    this._hitFlashTimer = null;
    this._hitRecoilTimer = null;
    this._deathTime = null;
    this._chargeCooldownTimer = 0;
    this._slamCooldownTimer = 0;
    this._toxicCooldownTimer = 0;
    this._burrowCooldownTimer = 3.0;
    this._lastAttack = null;
    this._lastAttackStreak = 0;
    this._hasHitThisAttack = false;

    const { eyeMaterial, head, bodyMaterial } = this.mesh.userData;
    bodyMaterial.emissiveIntensity = this._bodyBaseEmissiveIntensity;
    bodyMaterial.color.setHex(0xa855f7);
    bodyMaterial.emissive.setHex(0x4c1d95);
    eyeMaterial.emissiveIntensity = 0.8;
    head.rotation.x = 0;
    this.mesh.userData.setMandibleState?.(0.2);
    this.mesh.userData.resetChain?.();

    this._chargeStreak.material.opacity = 0;
    this._slamRing.material.opacity = 0;
    this._toxicRing.material.opacity = 0;

    this._hudVisible = false;
    this.uiManager.hideBossHealth();
  }

  // --- Shared helpers ---

  _getMoveSpeed() {
    if (this.phase === 3) return APEX_CONFIG.moveSpeed * APEX_CONFIG.phase3MoveSpeedMultiplier;
    if (this.phase === 2) return APEX_CONFIG.moveSpeed * APEX_CONFIG.phase2MoveSpeedMultiplier;
    return APEX_CONFIG.moveSpeed;
  }

  _getRecoveryMultiplier() {
    if (this.phase === 3) return APEX_CONFIG.phase3RecoveryMultiplier;
    if (this.phase === 2) return APEX_CONFIG.phase2RecoveryMultiplier;
    return 1;
  }

  _getForward(target = tempA) {
    return target.set(-Math.sin(this.facingAngle), 0, -Math.cos(this.facingAngle));
  }

  _hitPlayer(amount, attackType) {
    const hit = this.playerHealth.takeDamage(amount, this);
    if (hit) {
      playBiteHitSound();
      if (DEBUG_APEX) console.log(`Player hit by Murkmaw (${attackType})! Health: ${this.playerHealth.currentHealth}`);
    }
  }

  _moveToward(target, speed, deltaTime) {
    tempDirection.copy(target).sub(this.mesh.position);
    tempDirection.y = 0;
    if (tempDirection.lengthSq() > 1e-6) {
      tempDirection.normalize();
      this.mesh.position.addScaledVector(tempDirection, speed * deltaTime);
    }
    this._faceToward(target, deltaTime, APEX_CONFIG.turnSmoothing);
  }

  _faceToward(target, deltaTime, turnRate) {
    tempDirection.copy(target).sub(this.mesh.position);
    tempDirection.y = 0;
    if (tempDirection.lengthSq() < 1e-6) return;
    tempDirection.normalize();

    const targetAngle = Math.atan2(-tempDirection.x, -tempDirection.z);
    let angleDiff = targetAngle - this.facingAngle;
    angleDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI;

    const t = 1 - Math.exp(-turnRate * deltaTime);
    this.facingAngle += angleDiff * t;
    this.mesh.rotation.y = this.facingAngle;
  }

  _applyHitFlashAndRecoil(deltaTime) {
    const { bodyMaterial, head } = this.mesh.userData;

    if (this._hitFlashTimer !== null) {
      this._hitFlashTimer += deltaTime;
      const t = Math.min(this._hitFlashTimer / APEX_CONFIG.hitFlashDuration, 1);
      if (t >= 1) {
        this._hitFlashTimer = null;
        bodyMaterial.emissiveIntensity = this._bodyBaseEmissiveIntensity;
      } else {
        bodyMaterial.emissiveIntensity = this._bodyBaseEmissiveIntensity + (1 - t) * 1.6;
      }
    }

    if (this._hitRecoilTimer !== null) {
      this._hitRecoilTimer += deltaTime;
      const t = Math.min(this._hitRecoilTimer / APEX_CONFIG.hitRecoilDuration, 1);
      if (t >= 1) {
        this._hitRecoilTimer = null;
        head.rotation.x = 0;
      } else {
        head.rotation.x = -0.12 * (1 - t);
      }
    }
  }

  _applyIdleAnimation(deltaTime) {
    const { body } = this.mesh.userData;
    if (!body) return;
    const isActive = this.state !== STATES.COMBAT || horizontalDistanceSq(this.mesh.position, this.player.position) < APEX_CONFIG.attackRangeFarSq;
    const bobSpeed = isActive ? 5 : 2;
    const bobAmount = isActive ? 0.04 : 0.015;
    body.position.y = 0.62 + Math.sin(this._elapsed * bobSpeed) * bobAmount;
  }
}
