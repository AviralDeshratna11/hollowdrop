import * as THREE from 'three';
import { createApexMesh } from './apexModel.js';

export const DEBUG_APEX = false;

export const APEX_CONFIG = {
  // 180 = 12 Venom Bites at 15 damage each. Was temporarily 30 for testing, which made
  // the boss die in two hits and - worse - put the phase-2 transition (60% health) at
  // 18 HP, i.e. after a single bite, so the second phase was effectively unreachable.
  maxHealth: 180,
  moveSpeed: 1.8,
  phase2MoveSpeedMultiplier: 1.15,
  phase2RecoveryMultiplier: 0.85,
  phase2ToxicCooldownMultiplier: 0.7,
  phase2Threshold: 0.6,
  turnSmoothing: 5.0,

  arenaRadius: 9,
  disengageBuffer: 4, // extra distance past arenaRadius before it gives up and heads home

  introDuration: 1.0,
  phaseTransitionDuration: 0.8,
  deathDuration: 1.8,
  deathStaggerFraction: 0.18, // fraction of deathDuration spent on the scripted stagger-back beat before collapsing

  staggerDuration: 0.08, // far shorter than the normal Predator's - a boss must not be stun-lockable
  hitFlashDuration: 0.15,
  hitRecoilDuration: 0.12,

  // Attack range gating for chooseAttack() - not hard requirements, just weighting.
  attackRangeCloseSq: 2.5 ** 2,
  attackRangeFarSq: 5 ** 2,
  maxRepeatAttacks: 2, // avoid picking the same attack more than this many times in a row

  charge: { telegraph: 0.6, speed: 9.0, maxDistance: 8, damage: 20, hitRadius: 1.1, recovery: 0.85, cooldown: 3.0 },
  slam: { telegraph: 0.5, active: 0.15, damage: 25, range: 1.8, recovery: 0.7, cooldown: 2.0 },
  toxic: { telegraph: 0.8, damage: 15, radius: 2.5, recovery: 0.9, cooldown: 4.0 },
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
  RECOVERY: 'RECOVERY',
  PHASE_TRANSITION: 'PHASE_TRANSITION',
  DEAD: 'DEAD',
};

// Not damageable, and combat should visually ignore it, outside these states.
const DAMAGEABLE_STATES = new Set([
  STATES.COMBAT,
  STATES.CHARGE_TELEGRAPH,
  STATES.CHARGE,
  STATES.SLAM_TELEGRAPH,
  STATES.SLAM,
  STATES.TOXIC_TELEGRAPH,
  STATES.TOXIC_BURST,
  STATES.RECOVERY,
]);

const ARENA_RADIUS_SQ = APEX_CONFIG.arenaRadius ** 2;
const DISENGAGE_RADIUS_SQ = (APEX_CONFIG.arenaRadius + APEX_CONFIG.disengageBuffer) ** 2;
const CHARGE_HIT_RADIUS_SQ = APEX_CONFIG.charge.hitRadius ** 2;
const CHARGE_DURATION = APEX_CONFIG.charge.maxDistance / APEX_CONFIG.charge.speed;

// Reused scratch vectors - no per-frame allocation in the hot AI-update path.
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

// Optional, currently silent - hooks so audio can be added later without touching AI logic.
function playApexRoarSound() {}
function playApexAttackSound() {}
function playApexHitSound() {}
function playApexDeathSound() {}
function playPlayerHitSound() {}

/**
 * Murkmaw - the first Apex Predator boss. Owns arena-biased movement, a three-attack
 * telegraph/active/recovery combat loop, two health-gated phases, and death/loot -
 * all through the SAME damageable-entity interface (getDamageableEntities/takeDamage)
 * PreyManager and PredatorController already implement, so PlayerCombatController
 * needs zero Apex-specific code (see main.js's damageableSources array). Reads player
 * position/health only - never touches movement input, inventory, or burden directly.
 */
export class ApexController {
  constructor({ scene, arenaCenter, playerController, playerHealth, uiManager, resourceManager, genomeFragmentController, onDefeated }) {
    this.scene = scene;
    this.arenaCenter = arenaCenter.clone();
    this.playerController = playerController;
    this.player = playerController.mesh;
    this.playerHealth = playerHealth;
    this.uiManager = uiManager;
    this.resourceManager = resourceManager;
    this.genomeFragmentController = genomeFragmentController;
    this.onDefeated = onDefeated; // optional - fires once per _die(), e.g. for run-stats tracking

    this.mesh = createApexMesh();
    this.mesh.position.copy(this.arenaCenter);
    this.mesh.scale.setScalar(0.55); // resting/dormant size, before it "rises" in the intro
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
    this._hudVisible = false; // tracks the boss HUD independently of "has this ever started" - see _updateBossHudVisibility

    this._chargeCooldownTimer = 0;
    this._slamCooldownTimer = 0;
    this._toxicCooldownTimer = 0;
    this._lastAttack = null;
    this._lastAttackStreak = 0;
    this._hasHitThisAttack = false;
    this._recoveryDuration = 0;
    this._chargeDirection = new THREE.Vector3();
    this._chargeStartPosition = new THREE.Vector3();
    this._chargeTraveled = 0;
    this._toxicCenter = new THREE.Vector3();

    // Gameplay telegraph visuals (not debug-only) - created once, toggled via opacity.
    this._chargeStreak = this._createChargeStreak();
    this._slamRing = createGroundRing(APEX_CONFIG.slam.range, 0xff5c3d);
    this._toxicRing = createGroundRing(APEX_CONFIG.toxic.radius, 0xb23fff);
    scene.add(this._chargeStreak, this._slamRing, this._toxicRing);
  }

  _createChargeStreak() {
    const geometry = new THREE.PlaneGeometry(0.5, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xff8a2d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
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

  /** Called once by ApexEncounterManager when the player first crosses the trigger
   *  radius. No-ops if already engaged or already dead - never restarts the intro. */
  startEncounter() {
    if (this.state !== STATES.DORMANT) return;
    this.setState(STATES.INTRO);
    // HUD visibility itself is handled every frame by _updateBossHudVisibility() (it
    // naturally shows on the very next frame, since the player is definitionally in
    // range right after triggering) - this just seeds the bar's fill so it doesn't
    // flash from 0 the instant it does appear.
    this.uiManager.updateBossHealth(this.currentHealth / this.maxHealth);
    playApexRoarSound();
    if (DEBUG_APEX) console.log('Apex encounter started');
  }

  // --- Combat interface ------------------------------------------------------

  getDamageableEntities() {
    return DAMAGEABLE_STATES.has(this.state) ? [this] : [];
  }

  /** Reusable damageable-entity interface: (amount, info) - the exact shape
   *  PreyManager's entities and PredatorController implement too, so
   *  PlayerCombatController never branches on which enemy this is. */
  takeDamage(amount, info = {}) {
    if (!DAMAGEABLE_STATES.has(this.state)) return false;

    this.currentHealth = Math.max(0, this.currentHealth - amount);
    this.uiManager.updateBossHealth(this.currentHealth / this.maxHealth);
    this._hitFlashTimer = 0;
    this._hitRecoilTimer = 0;
    // Deliberately no knockback velocity (spec: "visual recoil only" - an Apex should
    // read as far too heavy to be physically shoved by a single bite).
    this._staggerTimer = APEX_CONFIG.staggerDuration;

    this.resourceManager.particles.spawnBurst(this.mesh.position, 0x4dffb2, 6);
    playApexHitSound();

    if (DEBUG_APEX) {
      console.log(`Venom Bite hit Murkmaw\nDamage: ${amount}`);
      console.log(`Murkmaw HP:\n${this.currentHealth} / ${this.maxHealth}`);
    }

    if (this.currentHealth <= 0) {
      this._die();
    } else if (this.phase === 1 && this.currentHealth / this.maxHealth <= APEX_CONFIG.phase2Threshold) {
      this._enterPhaseTransition();
    }
    return true;
  }

  // --- Debug-only ------------------------------------------------------------

  debugForceAttack(type) {
    if (!DEBUG_APEX || this.state !== STATES.COMBAT) return;
    if (type === 'charge') this._beginCharge();
    else if (type === 'slam') this._beginSlam();
    else if (type === 'toxic') this._beginToxic();
  }

  debugForcePhase2() {
    if (!DEBUG_APEX || this.phase !== 1) return;
    this.currentHealth = Math.min(this.currentHealth, this.maxHealth * APEX_CONFIG.phase2Threshold);
    this.uiManager.updateBossHealth(this.currentHealth / this.maxHealth);
    this._enterPhaseTransition();
  }

  debugSetHealth(amount) {
    if (!DEBUG_APEX) return;
    this.currentHealth = Math.max(0, Math.min(amount, this.maxHealth));
    this.uiManager.updateBossHealth(this.currentHealth / this.maxHealth);
    if (this.currentHealth <= 0) this._die();
  }

  // --- Main update -------------------------------------------------------------

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

    // Stagger pauses state-progression only (stateTime frozen, whichever state
    // resumes exactly where it left off) - same pattern as PredatorController,
    // just a much shorter window here.
    if (this._staggerTimer > 0) {
      this._staggerTimer = Math.max(0, this._staggerTimer - deltaTime);
      this._elapsed += deltaTime;
      this._applyIdleAnimation(deltaTime);
      return;
    }

    this._elapsed += deltaTime;
    this.stateTime += deltaTime;

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
      case STATES.RECOVERY:
        this._updateRecovery(deltaTime);
        break;
      case STATES.PHASE_TRANSITION:
        this._updatePhaseTransition(deltaTime);
        break;
    }

    this._applyIdleAnimation(deltaTime);
  }

  // --- States ------------------------------------------------------------------

  _updateIntro(deltaTime) {
    const t = Math.min(this.stateTime / APEX_CONFIG.introDuration, 1);
    this.mesh.scale.setScalar(THREE.MathUtils.lerp(0.55, 1, t));
    this._faceToward(this.player.position, deltaTime, APEX_CONFIG.turnSmoothing * 0.5);
    if (t >= 1) this.setState(STATES.COMBAT);
  }

  _isPlayerInRange() {
    return horizontalDistanceSq(this.mesh.position, this.player.position) < DISENGAGE_RADIUS_SQ;
  }

  /** The boss HUD should track "is the player actually near/engaged with the fight",
   *  not just "has this encounter ever started" - otherwise it stays stuck on screen
   *  after the player dies and respawns back at the map's spawn point, far from the
   *  arena. Reuses the same in-range check the AI itself uses to decide whether to
   *  chase or head home, so the two always agree. */
  _updateBossHudVisibility() {
    const shouldShow = this._isPlayerInRange() && !this.playerHealth.isDead;
    if (shouldShow === this._hudVisible) return;
    this._hudVisible = shouldShow;
    if (shouldShow) this.uiManager.showBossHealth('Murkmaw — Apex');
    else this.uiManager.hideBossHealth();
  }

  _updateCombat(deltaTime) {
    if (this.playerHealth.isDead || !this._isPlayerInRange()) {
      // Bias back toward the arena instead of chasing across the whole map - and
      // never attack while the player is out of range or dead/respawning.
      this._moveToward(this.arenaCenter, this._getMoveSpeed(), deltaTime);
      return;
    }

    const attack = this._chooseAttack();
    if (attack === 'charge') this._beginCharge();
    else if (attack === 'slam') this._beginSlam();
    else if (attack === 'toxic') this._beginToxic();
    else this._moveToward(this.player.position, this._getMoveSpeed(), deltaTime); // everything on cooldown - close the gap and wait
  }

  _chooseAttack() {
    const distSq = horizontalDistanceSq(this.mesh.position, this.player.position);
    const weighted = [];
    if (this._chargeCooldownTimer <= 0 && distSq > APEX_CONFIG.attackRangeFarSq) weighted.push('charge', 'charge');
    if (this._slamCooldownTimer <= 0 && distSq < APEX_CONFIG.attackRangeCloseSq) weighted.push('slam', 'slam');
    if (this._toxicCooldownTimer <= 0 && distSq >= APEX_CONFIG.attackRangeCloseSq) weighted.push('toxic');

    // Range gating produced nothing usable (e.g. mid-range with everything else on
    // cooldown) - fall back to any off-cooldown attack so it never stalls doing nothing.
    const pool = weighted.length > 0 ? weighted : ['charge', 'slam', 'toxic'].filter((a) => this._cooldownFor(a) <= 0);
    if (pool.length === 0) return null;

    const filtered = this._lastAttackStreak >= APEX_CONFIG.maxRepeatAttacks ? pool.filter((a) => a !== this._lastAttack) : pool;
    const finalPool = filtered.length > 0 ? filtered : pool;
    return finalPool[Math.floor(Math.random() * finalPool.length)];
  }

  _cooldownFor(attack) {
    if (attack === 'charge') return this._chargeCooldownTimer;
    if (attack === 'slam') return this._slamCooldownTimer;
    return this._toxicCooldownTimer;
  }

  _markAttackChosen(attack) {
    this._lastAttackStreak = attack === this._lastAttack ? this._lastAttackStreak + 1 : 1;
    this._lastAttack = attack;
  }

  // --- Charge --------------------------------------------------------------

  _beginCharge() {
    this._markAttackChosen('charge');
    this._hasHitThisAttack = false;
    this.setState(STATES.CHARGE_TELEGRAPH);
  }

  _updateChargeTelegraph(deltaTime) {
    this._faceToward(this.player.position, deltaTime, APEX_CONFIG.turnSmoothing * 1.5);
    if (this.stateTime >= APEX_CONFIG.charge.telegraph) {
      // Direction locks HERE, once, from the player's position at this exact moment -
      // never re-homed during the charge itself (spec: this is what allows dodging).
      tempDirection.copy(this.player.position).sub(this.mesh.position);
      tempDirection.y = 0;
      if (tempDirection.lengthSq() > 1e-6) tempDirection.normalize();
      else tempDirection.set(0, 0, 1);
      this._chargeDirection.copy(tempDirection);
      this._chargeStartPosition.copy(this.mesh.position);
      this._chargeTraveled = 0;

      this._chargeStreak.position.set(this.mesh.position.x, 0.03, this.mesh.position.z);
      this._chargeStreak.rotation.z = Math.atan2(tempDirection.x, tempDirection.z);
      this._chargeStreak.scale.set(1, APEX_CONFIG.charge.maxDistance, 1);
      this._chargeStreak.material.opacity = 0.35;

      playApexAttackSound();
      this.setState(STATES.CHARGE);
    }
  }

  _updateCharge(deltaTime) {
    const travel = APEX_CONFIG.charge.speed * deltaTime;
    this.mesh.position.addScaledVector(this._chargeDirection, travel);
    this._chargeTraveled += travel;
    this._chargeStreak.material.opacity = Math.max(0.35 * (1 - this.stateTime / CHARGE_DURATION), 0);

    if (!this._hasHitThisAttack && horizontalDistanceSq(this.mesh.position, this.player.position) < CHARGE_HIT_RADIUS_SQ) {
      this._hasHitThisAttack = true;
      this._hitPlayer(APEX_CONFIG.charge.damage, 'charge');
    }

    if (this._chargeTraveled >= APEX_CONFIG.charge.maxDistance || this.stateTime >= CHARGE_DURATION) {
      this._chargeStreak.material.opacity = 0;
      this._beginRecovery(APEX_CONFIG.charge.recovery);
      this._chargeCooldownTimer = APEX_CONFIG.charge.cooldown;
    }
  }

  // --- Slam ------------------------------------------------------------------

  _beginSlam() {
    this._markAttackChosen('slam');
    this._hasHitThisAttack = false;
    this.setState(STATES.SLAM_TELEGRAPH);
  }

  _updateSlamTelegraph(deltaTime) {
    this._faceToward(this.player.position, deltaTime, APEX_CONFIG.turnSmoothing * 1.5);
    this._slamRing.position.set(this.mesh.position.x, 0.03, this.mesh.position.z);
    this._slamRing.material.opacity = 0.5 * Math.min(this.stateTime / APEX_CONFIG.slam.telegraph, 1);

    if (this.stateTime >= APEX_CONFIG.slam.telegraph) {
      playApexAttackSound();
      this.setState(STATES.SLAM);
    }
  }

  _updateSlam(deltaTime) {
    this._slamRing.material.opacity = Math.max(0.5 * (1 - this.stateTime / APEX_CONFIG.slam.active), 0);

    if (!this._hasHitThisAttack && horizontalDistanceSq(this.mesh.position, this.player.position) < APEX_CONFIG.slam.range ** 2) {
      // Roughly-in-front check, same forgiving convention Venom Bite already uses -
      // this is a frontal slam, not an all-around AoE.
      tempA.copy(this.player.position).sub(this.mesh.position);
      tempA.y = 0;
      const facingForward = tempA.lengthSq() < 1e-6 || tempA.normalize().dot(this._getForward()) > 0.1;
      if (facingForward) {
        this._hasHitThisAttack = true;
        this._hitPlayer(APEX_CONFIG.slam.damage, 'slam');
      }
    }

    if (this.stateTime >= APEX_CONFIG.slam.active) {
      this._slamRing.material.opacity = 0;
      this._beginRecovery(APEX_CONFIG.slam.recovery);
      this._slamCooldownTimer = APEX_CONFIG.slam.cooldown;
    }
  }

  // --- Toxic Burst -----------------------------------------------------------

  _beginToxic() {
    this._markAttackChosen('toxic');
    this._hasHitThisAttack = false;
    this._toxicCenter.copy(this.mesh.position); // AoE centers on the boss, frozen at telegraph start
    this.setState(STATES.TOXIC_TELEGRAPH);
  }

  _updateToxicTelegraph(deltaTime) {
    const t = Math.min(this.stateTime / APEX_CONFIG.toxic.telegraph, 1);
    this._toxicRing.position.set(this._toxicCenter.x, 0.03, this._toxicCenter.z);
    // Pulses rather than a flat fade-in, to read clearly as "danger incoming".
    this._toxicRing.material.opacity = 0.15 + t * 0.35 + Math.sin(this.stateTime * 10) * 0.08;

    if (this.stateTime >= APEX_CONFIG.toxic.telegraph) {
      playApexAttackSound();
      this.setState(STATES.TOXIC_BURST);
    }
  }

  _updateToxicBurst(deltaTime) {
    if (!this._hasHitThisAttack) {
      this._hasHitThisAttack = true;
      if (horizontalDistanceSq(this._toxicCenter, this.player.position) < APEX_CONFIG.toxic.radius ** 2) {
        this._hitPlayer(APEX_CONFIG.toxic.damage, 'toxic_burst');
      }
      this.resourceManager.particles.spawnBurst(this._toxicCenter, 0xb23fff, 10);
      this._toxicRing.material.opacity = 0; // no persistent hazard - the ring clears the instant it resolves
    }

    if (this.stateTime >= 0.15) {
      this._beginRecovery(APEX_CONFIG.toxic.recovery);
      this._toxicCooldownTimer = this.phase === 2 ? APEX_CONFIG.toxic.cooldown * APEX_CONFIG.phase2ToxicCooldownMultiplier : APEX_CONFIG.toxic.cooldown;
    }
  }

  // --- Recovery / phase transition --------------------------------------------

  _beginRecovery(duration) {
    this._recoveryDuration = duration * this._getRecoveryMultiplier();
    this.setState(STATES.RECOVERY);
  }

  _updateRecovery(deltaTime) {
    // The deliberate Bite opening - no movement/attack pressure while it holds still.
    if (this.stateTime >= this._recoveryDuration) this.setState(STATES.COMBAT);
  }

  _enterPhaseTransition() {
    this.phase = 2;
    // Cancel whatever attack was mid-flight, the same way reversion cancels a Bite -
    // safely, without letting a stale telegraph/active-hit-window persist.
    this._chargeStreak.material.opacity = 0;
    this._slamRing.material.opacity = 0;
    this._toxicRing.material.opacity = 0;
    this.setState(STATES.PHASE_TRANSITION);
    this.resourceManager.particles.spawnBurst(this.mesh.position, 0x4dffb2, 10);
    if (DEBUG_APEX) console.log('Murkmaw entering Phase 2');
  }

  _updatePhaseTransition(deltaTime) {
    const t = Math.min(this.stateTime / APEX_CONFIG.phaseTransitionDuration, 1);
    const { coreGlandMaterial } = this.mesh.userData;
    coreGlandMaterial.emissiveIntensity = THREE.MathUtils.lerp(1.2, 2.6, t);
    this.mesh.userData.coreGland.scale.setScalar(THREE.MathUtils.lerp(1, 1.6, t));
    if (t >= 1) this.setState(STATES.COMBAT);
  }

  // --- Death -------------------------------------------------------------------

  _die() {
    if (this.state === STATES.DEAD) return; // never process death twice
    this.setState(STATES.DEAD);
    this._deathTime = 0;
    this._chargeStreak.material.opacity = 0;
    this._slamRing.material.opacity = 0;
    this._toxicRing.material.opacity = 0;

    this.resourceManager.particles.spawnBurst(this.mesh.position, 0x4dffb2, 12);
    playApexDeathSound();
    this.onDefeated?.();
    if (DEBUG_APEX) console.log('Murkmaw died');
  }

  _updateDeath(deltaTime) {
    this._deathTime += deltaTime;
    const t = Math.min(this._deathTime / APEX_CONFIG.deathDuration, 1);
    const { eyeMaterial, glandMaterial, coreGlandMaterial } = this.mesh.userData;

    const staggerFraction = APEX_CONFIG.deathStaggerFraction;
    if (t < staggerFraction) {
      // A scripted stagger-back beat (not knockback physics) before it collapses.
      const st = t / staggerFraction;
      this.mesh.rotation.z = Math.sin(st * Math.PI * 3) * 0.06 * (1 - st);
      eyeMaterial.emissiveIntensity = THREE.MathUtils.lerp(0.8, 0.1, st);
      glandMaterial.emissiveIntensity = THREE.MathUtils.lerp(1.0, 2.0, st) * (0.7 + Math.sin(st * 30) * 0.3);
    } else {
      const ct = (t - staggerFraction) / (1 - staggerFraction);
      const collapseT = ct * ct;
      this.mesh.scale.setScalar(Math.max(1 - collapseT, 0.001));
      this.mesh.position.y = Math.max(this.arenaCenter.y - collapseT * 0.3, this.arenaCenter.y - 0.3);
      eyeMaterial.emissiveIntensity = THREE.MathUtils.lerp(0.1, 0, collapseT);
      glandMaterial.emissiveIntensity = THREE.MathUtils.lerp(2.0, 0, collapseT);
      coreGlandMaterial.emissiveIntensity = THREE.MathUtils.lerp(2.6, 0, collapseT);
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
        const offset = new THREE.Vector3(Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5);
        this.resourceManager.spawnResource(type, new THREE.Vector3(this.mesh.position.x + offset.x, 0.2, this.mesh.position.z + offset.z));
      }
    }
    if (DEBUG_APEX) for (const { type, count } of APEX_LOOT) console.log(`Dropped ${count}x ${type}`);
  }

  /** Full reset for a brand-new run (Play Again) - back to DORMANT at full health,
   *  phase 1, arena position, with every telegraph/hit-flash/recoil visual cleared. */
  reset() {
    this.state = STATES.DORMANT; // direct assignment - no "X -> DORMANT" log for a reset
    this.stateTime = 0;
    this.facingAngle = 0;
    this.phase = 1;
    this.currentHealth = this.maxHealth;

    this.mesh.position.copy(this.arenaCenter);
    this.mesh.scale.setScalar(0.55); // resting/dormant size, matches the constructor
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.visible = true;

    this._staggerTimer = 0;
    this._hitFlashTimer = null;
    this._hitRecoilTimer = null;
    this._deathTime = null;
    this._chargeCooldownTimer = 0;
    this._slamCooldownTimer = 0;
    this._toxicCooldownTimer = 0;
    this._lastAttack = null;
    this._lastAttackStreak = 0;
    this._hasHitThisAttack = false;

    // Materials animated during PHASE_TRANSITION/death need their original baseline
    // restored explicitly - unlike bodyMaterial (hit-flash already restores it via
    // _bodyBaseEmissiveIntensity), nothing else ever resets these mid-game. Values
    // match apexModel.js's own initial construction.
    const { eyeMaterial, glandMaterial, coreGlandMaterial, coreGland, head, bodyMaterial } = this.mesh.userData;
    bodyMaterial.emissiveIntensity = this._bodyBaseEmissiveIntensity;
    eyeMaterial.emissiveIntensity = 0.8;
    glandMaterial.emissiveIntensity = 1.0;
    coreGlandMaterial.emissiveIntensity = 1.2;
    coreGland.scale.setScalar(1);
    head.rotation.x = 0;

    this._chargeStreak.material.opacity = 0;
    this._slamRing.material.opacity = 0;
    this._toxicRing.material.opacity = 0;

    this._hudVisible = false;
    this.uiManager.hideBossHealth();
  }

  // --- Shared helpers --------------------------------------------------------

  _getMoveSpeed() {
    return this.phase === 2 ? APEX_CONFIG.moveSpeed * APEX_CONFIG.phase2MoveSpeedMultiplier : APEX_CONFIG.moveSpeed;
  }

  _getRecoveryMultiplier() {
    return this.phase === 2 ? APEX_CONFIG.phase2RecoveryMultiplier : 1;
  }

  _getForward(target = tempA) {
    return target.set(-Math.sin(this.facingAngle), 0, -Math.cos(this.facingAngle));
  }

  _hitPlayer(amount, attackType) {
    const hit = this.playerHealth.takeDamage(amount, this);
    if (hit) {
      playPlayerHitSound();
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

  /** Smoothly yaws the model to face `target`. Model faces -Z at rotation.y = 0. */
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
        head.rotation.x = -0.12 * (1 - t); // a tiny head-jerk, no actual displacement
      }
    }
  }

  _applyIdleAnimation(deltaTime) {
    const { body, legs } = this.mesh.userData;
    const isActive = this.state !== STATES.COMBAT || horizontalDistanceSq(this.mesh.position, this.player.position) < APEX_CONFIG.attackRangeFarSq;

    const bobSpeed = isActive ? 5 : 2;
    const bobAmount = isActive ? 0.04 : 0.015;
    body.position.y = 0.62 + Math.sin(this._elapsed * bobSpeed) * bobAmount;

    const legSwingAmount = isActive ? 0.18 : 0.08;
    const legSwing = Math.sin(this._elapsed * bobSpeed * 1.2) * legSwingAmount;
    for (let i = 0; i < legs.length; i++) {
      legs[i].rotation.x = 0.1 + legSwing * (i % 2 === 0 ? 1 : -1);
    }
  }
}
