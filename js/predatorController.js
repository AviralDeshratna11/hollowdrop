import * as THREE from 'three';
import { createPredatorMesh } from './predatorModel.js?v=5.3';
import { updateEntityHealthBar } from './entityHealthBar.js?v=5.3';
import { getTerrainHeight } from './terrain.js?v=5.3';

export const DEBUG_PREDATOR = false;
export const DEBUG_PREDATOR_COMBAT = false;

export const PREDATOR_RESPAWN_ENABLED = true;
export const PREDATOR_RESPAWN_TIME = 25; // seconds after death before it's eligible to return

// Tuned relative to PlayerController's PLAYER_MAX_SPEED (6.0) and BurdenSystem's
// curve: empty Hollowdrop ~6.0, heavy (80-100% load) ~3.6-2.7. chaseSpeed sits
// between the two - empty can outrun it, heavily-loaded cannot.
export const PREDATOR_CONFIG = {
  wanderSpeed: 1.0,
  chaseSpeed: 4.2,
  returnSpeedFactor: 0.8, // fraction of chaseSpeed used while walking home
  wanderRadius: 6,
  wanderPauseTime: 1.2,
  detectionRadius: 6,
  loseRadius: 10,
  maxChaseDistance: 12,
  attackRadius: 1.0,
  alertDuration: 0.45,
  attackCooldown: 1.0,
  attackDamage: 20, // ~5 hits to defeat a full-health player, matches HEALTH_CONFIG.maxHealth (100)
  turnSmoothing: 6.0,
  // Hard floor on pivot-to-pivot distance, sized for the two models' actual visual
  // reach (not just their pivots): player sphere radius 0.6, plus the predator's
  // head extending ~0.6 forward of its own pivot when facing the player. Below
  // this the two bodies visibly overlap, above it there's clean daylight between
  // them. Deliberately bigger than attackRadius: while CHASE is waiting out the
  // attack cooldown it holds here (no overlap); once the cooldown is ready it's
  // allowed to close past this floor specifically to reach attackRadius and strike.
  minApproachDistance: 1.2,

  // --- Combat (Venom Bite can now damage this creature) ---------------------
  maxHealth: 75, // ~5 successful Venom Bites (damage 15) to defeat
  hitStaggerDuration: 0.15, // brief AI pause on hit - long enough to read, short enough not to stunlock
  hitKnockbackForce: 0.45,
  knockbackSpeedScale: 4.0, // converts a hit's knockbackForce into an initial velocity (matches PreyManager's convention)
  knockbackDecayRate: 8.0,
  hitFlashDuration: 0.12,
  healthBarVisibleDuration: 2.5, // a bit longer than Glow Beetle's - reads as a more significant fight
  healthBarFadeStart: 0.4,
  deathDuration: 0.8,
  // Once hit, stays committed to the player for this long even if normal lose/chase
  // conditions would otherwise send it home - a recent attack establishes aggro.
  combatAggroDuration: 3.0,
};

export const PREDATOR_LOOT = [
  { type: 'predator_dna', count: 1 },
  { type: 'mushroom', count: 2 }, // reused as "Organic Biomass", same as Glow Beetle's drop
  { type: 'toxic_gland', count: 1 },
];

const DETECTION_RADIUS_SQ = PREDATOR_CONFIG.detectionRadius ** 2;
const LOSE_RADIUS_SQ = PREDATOR_CONFIG.loseRadius ** 2;
const ATTACK_RADIUS_SQ = PREDATOR_CONFIG.attackRadius ** 2;
const MAX_CHASE_DISTANCE_SQ = PREDATOR_CONFIG.maxChaseDistance ** 2;
const MIN_APPROACH_DISTANCE_SQ = PREDATOR_CONFIG.minApproachDistance ** 2;
const WANDER_ARRIVE_SQ = 0.25 * 0.25;
const RETURN_ARRIVE_SQ = 0.3 * 0.3;
const RESPAWN_SAFE_DISTANCE_SQ = 6 * 6; // don't pop back in within 6 units of the player

const ATTACK_ANTICIPATION = 0.15;
const ATTACK_LUNGE = 0.15;
const ATTACK_RECOVER = 0.15;
const ATTACK_TOTAL = ATTACK_ANTICIPATION + ATTACK_LUNGE + ATTACK_RECOVER;
const ATTACK_LUNGE_DISTANCE = 0.45;
const ATTACK_HIT_RADIUS_SQ = ATTACK_RADIUS_SQ * 1.3;
const SEPARATION_RECOVER_RATE = 6.0; // eases back to minApproachDistance over ~0.3-0.5s, not an instant snap

const STATES = {
  WANDER: 'WANDER',
  ALERT: 'ALERT',
  CHASE: 'CHASE',
  ATTACK: 'ATTACK',
  RETURN: 'RETURN',
  DEAD: 'DEAD',
};

// Reused scratch vectors - no per-frame allocation in the hot AI-update path.
const tempDirection = new THREE.Vector3();
const tempLootOffset = new THREE.Vector3();

// The predator's pivot sits at ground level; the player's sphere pivot sits at
// PLAYER_RADIUS (0.6) above ground. Every radius check (detection/attack/lose/etc.)
// must ignore that vertical offset, or a fixed height gap between two "ground
// plane" objects silently eats into small radii - see PredatorController usage.
function horizontalDistanceSq(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

// Optional, currently silent - hooks so audio can be added later without touching AI logic.
function playPredatorAlertSound() {}
function playPredatorAttackSound() {}
function playPlayerHitSound() {}
function playPredatorDeathSound() {}
function playLootDropSound() {}

function createDebugRing(radius, color) {
  const geometry = new THREE.RingGeometry(radius - 0.03, radius, 48);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  return ring;
}

/**
 * One predator: patrols a home territory, detects/chases/attacks Hollowdrop, and
 * disengages back home - AND is now itself a damageable, killable enemy for the
 * Venom Rat via the same entity.takeDamage(amount, info) interface PreyManager's
 * Glow Beetles implement (see PlayerCombatController.performHitCheck, which treats
 * both uniformly through getDamageableEntities()). Reads player position/health
 * only - never touches movement input, inventory, or burden calculations directly.
 */
export class PredatorController {
  constructor(scene, homePosition, playerController, playerHealth, uiManager, resourceManager, { onDefeated } = {}) {
    this.scene = scene;
    this.onDefeated = onDefeated; // optional - fires once per _die(), e.g. for run-stats tracking
    this.mesh = createPredatorMesh();
    this.mesh.position.copy(homePosition);
    scene.add(this.mesh);

    this.playerController = playerController;
    this.player = playerController.mesh;
    this.playerHealth = playerHealth;
    this.uiManager = uiManager;
    this.resourceManager = resourceManager;

    this.homePosition = homePosition.clone();
    this.state = STATES.WANDER;
    this.stateTime = 0;
    this.facingAngle = 0;
    this._elapsed = 0;

    this.wanderTarget = new THREE.Vector3();
    this.wanderPauseTimer = 0;
    this._pickNewWanderTarget();

    this.lastAttackTime = -Infinity;
    this._hasLunged = false;
    this._hasHitThisAttack = false;
    this.attackStartPosition = new THREE.Vector3();
    this.attackLungeTarget = new THREE.Vector3();

    // --- Combat state ------------------------------------------------------
    this.maxHealth = PREDATOR_CONFIG.maxHealth;
    this.currentHealth = this.maxHealth;
    this._staggerTimer = 0; // >0 pauses AI state-progression/movement, but not knockback/flash/health-bar
    this._combatAggroTimer = 0; // >0 suppresses CHASE -> RETURN even past normal lose/max-chase distance
    this._knockbackVelocity = new THREE.Vector3();
    this._hitFlashTimer = null;
    this._bodyBaseEmissiveIntensity = this.mesh.userData.bodyMaterial.emissiveIntensity;
    this._healthBarTimer = null;
    this._deathTime = null;
    this._respawnTimer = null; // seconds remaining until eligible to respawn, or null if not pending

    if (DEBUG_PREDATOR) {
      // Detection/lose rings ride along with the predator (child of mesh);
      // the home-territory ring is fixed at homePosition (added to the scene directly).
      this.mesh.add(createDebugRing(PREDATOR_CONFIG.detectionRadius, 0xffcc00));
      this.mesh.add(createDebugRing(PREDATOR_CONFIG.loseRadius, 0xff5555));

      const homeRing = createDebugRing(PREDATOR_CONFIG.wanderRadius, 0x66ccff);
      homeRing.position.copy(this.homePosition);
      homeRing.position.y = 0.02;
      scene.add(homeRing);

      console.log('Predator spawned at', homePosition);
    }
  }

  setState(next) {
    if (this.state === next) return;
    if (DEBUG_PREDATOR || DEBUG_PREDATOR_COMBAT) console.log(`${this.state} -> ${next}`);
    this.state = next;
    this.stateTime = 0;
  }

  update(deltaTime) {
    if (this.state === STATES.DEAD) {
      this._updateDeath(deltaTime);
      return;
    }

    this._applyKnockback(deltaTime);

    if (this._combatAggroTimer > 0) this._combatAggroTimer = Math.max(0, this._combatAggroTimer - deltaTime);

    // Stagger pauses AI state-progression only (this.state/this.stateTime are left
    // completely untouched, so whichever state - including mid-ATTACK - resumes
    // exactly where it left off once stagger ends, no desync of that state's own
    // internal sub-timers). Knockback/flash/health-bar above still run every frame.
    if (this._staggerTimer > 0) {
      this._staggerTimer = Math.max(0, this._staggerTimer - deltaTime);
      this._elapsed += deltaTime;
      this._applyAnimation(deltaTime);
      return;
    }

    this._elapsed += deltaTime;
    this.stateTime += deltaTime;

    // While the player is dead/respawning, back off instead of piling on.
    if (this.playerHealth.isDead && this.state !== STATES.RETURN && this.state !== STATES.WANDER) {
      this.setState(STATES.RETURN);
    }

    switch (this.state) {
      case STATES.WANDER:
        this._updateWander(deltaTime);
        break;
      case STATES.ALERT:
        this._updateAlert(deltaTime);
        break;
      case STATES.CHASE:
        this._updateChase(deltaTime);
        break;
      case STATES.ATTACK:
        this._updateAttack(deltaTime);
        break;
      case STATES.RETURN:
        this._updateReturn(deltaTime);
        break;
    }

    // ATTACK's lunge intentionally closes in past minApproachDistance for the strike,
    // and CHASE handles its own separation internally (it needs to allow closing in
    // once the cooldown is ready, which a blanket correction here would undo every
    // frame) - skip both. WANDER/ALERT/RETURN never intentionally approach the
    // player, so this is purely a safety net for the player walking into them.
    if (this.state === STATES.WANDER || this.state === STATES.ALERT || this.state === STATES.RETURN) {
      this._enforceMinSeparation(deltaTime);
    }

    if (this.state !== STATES.DEAD) {
      const targetY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
      const ySmooth = 1 - Math.exp(-12.0 * deltaTime);
      this.mesh.position.y += (targetY - this.mesh.position.y) * ySmooth;
    }

    this._applyAnimation(deltaTime);
  }

  // --- States --------------------------------------------------------------

  _updateWander(deltaTime) {
    const distToTargetSq = horizontalDistanceSq(this.mesh.position, this.wanderTarget);
    if (distToTargetSq < WANDER_ARRIVE_SQ) {
      this.wanderPauseTimer += deltaTime;
      if (this.wanderPauseTimer > PREDATOR_CONFIG.wanderPauseTime) {
        this._pickNewWanderTarget();
        this.wanderPauseTimer = 0;
      }
    } else {
      this._moveToward(this.wanderTarget, PREDATOR_CONFIG.wanderSpeed, deltaTime);
    }

    if (horizontalDistanceSq(this.mesh.position, this.player.position) < DETECTION_RADIUS_SQ) {
      this.setState(STATES.ALERT);
      playPredatorAlertSound();
    }
  }

  _updateAlert(deltaTime) {
    this._faceToward(this.player.position, deltaTime, PREDATOR_CONFIG.turnSmoothing * 1.5);

    // Player slipped back out before the reaction delay finished - stand down.
    if (horizontalDistanceSq(this.mesh.position, this.player.position) > LOSE_RADIUS_SQ) {
      this.setState(STATES.WANDER);
      return;
    }

    if (this.stateTime >= PREDATOR_CONFIG.alertDuration) {
      this.setState(STATES.CHASE);
    }
  }

  _updateChase(deltaTime) {
    const cooldownReady = performance.now() - this.lastAttackTime >= PREDATOR_CONFIG.attackCooldown * 1000;
    // While waiting out the cooldown, hold at minApproachDistance (no overlap - just
    // pressuring/pacing). Once ready, allow closing all the way in to actually strike.
    const standoff = cooldownReady ? 0 : PREDATOR_CONFIG.minApproachDistance;
    this._moveTowardPlayerWithStandoff(PREDATOR_CONFIG.chaseSpeed, deltaTime, standoff);

    // _moveTowardPlayerWithStandoff only ever stops closing the gap, it can't open one
    // back up - so while waiting out the cooldown, correct any leftover overshoot from
    // the attack lunge that just ended. Skipped once cooldownReady, or this would undo
    // the deliberate close-in above on every single frame.
    if (!cooldownReady) {
      this._enforceMinSeparation(deltaTime);
    }

    const distToPlayerSq = horizontalDistanceSq(this.mesh.position, this.player.position);
    const distToHomeSq = horizontalDistanceSq(this.mesh.position, this.homePosition);

    if (cooldownReady && distToPlayerSq < ATTACK_RADIUS_SQ) {
      this.setState(STATES.ATTACK);
      return;
    }

    // A recent hit keeps it committed even past the normal lose/max-chase distance
    // (spec: "a recent player attack should establish combat aggro") - it still
    // gives up eventually once the aggro window itself runs out.
    if (this._combatAggroTimer <= 0 && (distToPlayerSq > LOSE_RADIUS_SQ || distToHomeSq > MAX_CHASE_DISTANCE_SQ)) {
      this.setState(STATES.RETURN);
    }
  }

  _updateAttack(deltaTime) {
    if (this.stateTime < ATTACK_ANTICIPATION) {
      this._faceToward(this.player.position, deltaTime, PREDATOR_CONFIG.turnSmoothing * 2);
      return;
    }

    if (this.stateTime < ATTACK_ANTICIPATION + ATTACK_LUNGE) {
      if (!this._hasLunged) {
        this._hasLunged = true;
        playPredatorAttackSound();
        tempDirection.copy(this.player.position).sub(this.mesh.position);
        tempDirection.y = 0;
        if (tempDirection.lengthSq() > 1e-6) tempDirection.normalize();
        else tempDirection.set(0, 0, 1);

        this.attackStartPosition.copy(this.mesh.position);
        this.attackLungeTarget.copy(this.mesh.position).addScaledVector(tempDirection, ATTACK_LUNGE_DISTANCE);
      }

      const lungeT = Math.min((this.stateTime - ATTACK_ANTICIPATION) / ATTACK_LUNGE, 1);
      this.mesh.position.lerpVectors(this.attackStartPosition, this.attackLungeTarget, lungeT);

      if (!this._hasHitThisAttack && horizontalDistanceSq(this.mesh.position, this.player.position) < ATTACK_HIT_RADIUS_SQ) {
        this._hasHitThisAttack = true;
        this._performHit();
      }
      return;
    }

    if (this.stateTime >= ATTACK_TOTAL) {
      this._hasLunged = false;
      this._hasHitThisAttack = false;
      this.lastAttackTime = performance.now();
      this.setState(STATES.CHASE);
    }
    // else: brief recovery hold, no movement
  }

  _updateReturn(deltaTime) {
    this._moveToward(this.homePosition, PREDATOR_CONFIG.chaseSpeed * PREDATOR_CONFIG.returnSpeedFactor, deltaTime);

    if (horizontalDistanceSq(this.mesh.position, this.homePosition) < RETURN_ARRIVE_SQ) {
      this.setState(STATES.WANDER);
      this._pickNewWanderTarget();
      return;
    }

    // Re-engage if the player wanders back in range while heading home (unless dead).
    if (!this.playerHealth.isDead && horizontalDistanceSq(this.mesh.position, this.player.position) < DETECTION_RADIUS_SQ) {
      this.setState(STATES.ALERT);
    }
  }

  /** Forces disengagement (e.g. right after the player respawns) so it isn't camping
   *  a fresh spawn. No-ops while dead/respawn-pending - death owns the state machine
   *  entirely during that window. */
  disengage() {
    if (this.state === STATES.DEAD) return;
    if (this.state !== STATES.WANDER) this.setState(STATES.RETURN);
  }

  // --- Combat --------------------------------------------------------------

  /** Living (non-DEAD) predator only, as a one-element array - matches PreyManager's
   *  getDamageableEntities() shape so PlayerCombatController can treat every enemy
   *  source identically without knowing this one is a singleton. */
  getDamageableEntities() {
    return this.state === STATES.DEAD ? [] : [this];
  }

  /** Reusable damageable-entity interface: (amount, info) where info carries
   *  sourceEntity/sourceType/attackType/knockbackForce - the exact shape
   *  PreyManager's entities implement too, so PlayerCombatController never branches
   *  on which enemy this is. Returns true if the hit actually landed. */
  takeDamage(amount, info = {}) {
    if (this.state === STATES.DEAD) return false;

    this.currentHealth = Math.max(0, this.currentHealth - amount);
    this._hitFlashTimer = 0;
    this._healthBarTimer = PREDATOR_CONFIG.healthBarVisibleDuration;
    this._staggerTimer = PREDATOR_CONFIG.hitStaggerDuration;
    this._combatAggroTimer = PREDATOR_CONFIG.combatAggroDuration;

    const sourcePos = info.sourceEntity?.mesh?.position ?? info.sourceEntity?.position;
    if (sourcePos) {
      tempDirection.copy(this.mesh.position).sub(sourcePos);
      tempDirection.y = 0;
      if (tempDirection.lengthSq() < 1e-6) tempDirection.set(0, 0, 1);
      else tempDirection.normalize();
      const knockbackForce = info.knockbackForce ?? PREDATOR_CONFIG.hitKnockbackForce;
      this._knockbackVelocity.copy(tempDirection).multiplyScalar(knockbackForce * PREDATOR_CONFIG.knockbackSpeedScale);
    }

    // Being attacked while not already engaged is a much stronger signal than mere
    // proximity - it skips straight to CHASE rather than re-running the normal ALERT
    // reaction delay (spec: "immediately targets player", not "notices eventually").
    if (this.state !== STATES.CHASE && this.state !== STATES.ATTACK) {
      this.setState(STATES.CHASE);
    }

    this.resourceManager.particles.spawnBurst(this.mesh.position, 0xff3355, 5);

    if (DEBUG_PREDATOR_COMBAT) {
      console.log(`Venom Bite hit Cave Stalker\nDamage: ${amount}`);
      console.log(`Cave Stalker HP:\n${this.currentHealth} / ${this.maxHealth}`);
    }

    if (this.currentHealth <= 0) this._die();
    return true;
  }

  _die() {
    if (this.state === STATES.DEAD) return; // never process death twice
    this.setState(STATES.DEAD);
    this._deathTime = 0;
    this._healthBarTimer = null;
    updateEntityHealthBar(this.mesh.userData.healthBar, 0, null, PREDATOR_CONFIG.healthBarFadeStart);
    this.mesh.userData.warningSprite.material.opacity = 0;

    this.resourceManager.particles.spawnBurst(this.mesh.position, 0xff3355, 12);
    playPredatorDeathSound();
    this.onDefeated?.();
    if (DEBUG_PREDATOR_COMBAT) console.log('Cave Stalker died');
  }

  _updateDeath(deltaTime) {
    this._deathTime += deltaTime;
    const t = Math.min(this._deathTime / PREDATOR_CONFIG.deathDuration, 1);
    this.mesh.scale.setScalar(Math.max(1 - t, 0.001));
    this.mesh.position.y = Math.max(this.homePosition.y - t * 0.2, this.homePosition.y - 0.2);

    if (t >= 1 && this.mesh.visible) {
      this._dropLoot();
      this.mesh.visible = false;
      if (PREDATOR_RESPAWN_ENABLED) this._respawnTimer = PREDATOR_RESPAWN_TIME;
    }

    if (this._respawnTimer !== null) {
      this._respawnTimer -= deltaTime;
      if (this._respawnTimer <= 0 && this._isSafeToRespawn()) {
        this._respawn();
      }
    }
  }

  _isSafeToRespawn() {
    return horizontalDistanceSq(this.homePosition, this.player.position) > RESPAWN_SAFE_DISTANCE_SQ;
  }

  /** Resets every piece of combat/AI/animation state to a fresh baseline - a stale
   *  flag surviving a respawn would otherwise silently corrupt the next encounter. */
  _respawn() {
    this._respawnTimer = null;
    this.currentHealth = this.maxHealth;
    this.mesh.position.copy(this.homePosition);
    this.mesh.scale.setScalar(1);
    this.mesh.visible = true;
    this.mesh.rotation.set(0, 0, 0);
    this.facingAngle = 0;

    this._knockbackVelocity.set(0, 0, 0);
    this._staggerTimer = 0;
    this._combatAggroTimer = 0;
    this._hitFlashTimer = null;
    this._healthBarTimer = null;
    this._deathTime = null;
    this.mesh.userData.bodyMaterial.emissiveIntensity = this._bodyBaseEmissiveIntensity;
    this.mesh.userData.warningSprite.material.opacity = 0;
    updateEntityHealthBar(this.mesh.userData.healthBar, 1, null, PREDATOR_CONFIG.healthBarFadeStart);

    this.lastAttackTime = -Infinity;
    this._hasLunged = false;
    this._hasHitThisAttack = false;

    this._pickNewWanderTarget();
    this.wanderPauseTimer = 0;
    this.state = STATES.WANDER; // direct assignment (not setState) - no "X -> WANDER" log for a respawn
    this.stateTime = 0;

    if (DEBUG_PREDATOR_COMBAT) console.log('Cave Stalker respawned');
  }

  _dropLoot() {
    const center = this.mesh.position;
    const dropCount = PREDATOR_LOOT.reduce((sum, entry) => sum + entry.count, 0);
    let dropIndex = 0;

    for (const { type, count } of PREDATOR_LOOT) {
      for (let i = 0; i < count; i++) {
        const angle = (dropIndex / dropCount) * Math.PI * 2;
        tempLootOffset.set(Math.cos(angle) * 0.4, 0, Math.sin(angle) * 0.4);
        const dropX = center.x + tempLootOffset.x;
        const dropZ = center.z + tempLootOffset.z;
        this.resourceManager.spawnResource(type, new THREE.Vector3(dropX, getTerrainHeight(dropX, dropZ), dropZ));
        dropIndex++;
      }
    }

    playLootDropSound();
    if (DEBUG_PREDATOR_COMBAT) {
      for (const { type, count } of PREDATOR_LOOT) console.log(`Dropped ${count}x ${type}`);
    }
  }

  /** Debug-only (DEBUG_PREDATOR_COMBAT): restores full health without touching
   *  anything else - a dev convenience, never a gameplay mechanic (no regen). */
  debugHeal() {
    this.currentHealth = this.maxHealth;
  }

  /** Full reset for a brand-new run (Play Again) - reuses the exact same restore
   *  logic a natural respawn already uses, just callable regardless of current state
   *  (mid-chase, mid-death-animation, already-respawn-pending, etc). */
  reset() {
    this._respawn();
  }

  /** Debug-only: brings the (singleton) predator to a convenient test position near
   *  the player instead of requiring a walk to its home territory - revives it first
   *  if it's dead/respawn-pending, since there's only ever one of these. */
  debugTeleportNearPlayer() {
    if (this.state === STATES.DEAD) this._respawn();
    this.mesh.position.copy(this.player.position).add(new THREE.Vector3(2, 0, 2));
    this.setState(STATES.WANDER);
  }

  // --- Shared helpers --------------------------------------------------------

  _performHit() {
    // PlayerHealth centralizes validation, invulnerability, feedback, and knockback -
    // it derives the knockback direction itself from `this` (this.mesh.position).
    const hit = this.playerHealth.takeDamage(PREDATOR_CONFIG.attackDamage, this);
    if (hit) {
      playPlayerHitSound();
      if (DEBUG_PREDATOR) console.log(`Player hit! Health: ${this.playerHealth.currentHealth}`);
    }
  }

  _pickNewWanderTarget() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * PREDATOR_CONFIG.wanderRadius;
    this.wanderTarget.set(
      this.homePosition.x + Math.cos(angle) * radius,
      this.homePosition.y,
      this.homePosition.z + Math.sin(angle) * radius
    );
  }

  _moveToward(target, speed, deltaTime) {
    tempDirection.copy(target).sub(this.mesh.position);
    tempDirection.y = 0;
    if (tempDirection.lengthSq() > 1e-6) {
      tempDirection.normalize();
      this.mesh.position.addScaledVector(tempDirection, speed * deltaTime);
    }
    this._faceToward(target, deltaTime, PREDATOR_CONFIG.turnSmoothing);
  }

  /** Same as _moveToward, but stops closing the gap at `standoff` instead of running
   *  straight through the player. Pass 0 to allow closing all the way in (used once
   *  the attack cooldown is ready and it needs to reach attackRadius to strike). */
  _moveTowardPlayerWithStandoff(speed, deltaTime, standoff) {
    tempDirection.copy(this.player.position).sub(this.mesh.position);
    tempDirection.y = 0;
    const distance = tempDirection.length();

    if (distance > 1e-6) {
      const travel = Math.min(speed * deltaTime, Math.max(distance - standoff, 0));
      if (travel > 0) {
        tempDirection.normalize();
        this.mesh.position.addScaledVector(tempDirection, travel);
      }
    }
    this._faceToward(this.player.position, deltaTime, PREDATOR_CONFIG.turnSmoothing);
  }

  /** Safety net: if the predator ends up closer than minApproachDistance to the
   *  player for any reason (player walked into it, post-attack lunge overshoot),
   *  eases it back out along the away-from-player direction - smoothed like every
   *  other motion here, so recovering from an attack reads as a recoil, not a
   *  teleport/snap (which looked like bouncing off an invisible wall). */
  _enforceMinSeparation(deltaTime) {
    tempDirection.copy(this.mesh.position).sub(this.player.position);
    tempDirection.y = 0;
    const distSq = tempDirection.lengthSq();
    if (distSq >= MIN_APPROACH_DISTANCE_SQ) return;

    if (distSq < 1e-6) tempDirection.set(0, 0, 1);
    else tempDirection.normalize();

    const targetX = this.player.position.x + tempDirection.x * PREDATOR_CONFIG.minApproachDistance;
    const targetZ = this.player.position.z + tempDirection.z * PREDATOR_CONFIG.minApproachDistance;

    const smooth = 1 - Math.exp(-SEPARATION_RECOVER_RATE * deltaTime);
    this.mesh.position.x += (targetX - this.mesh.position.x) * smooth;
    this.mesh.position.z += (targetZ - this.mesh.position.z) * smooth;
  }

  /** Smoothly yaws the model to face `target`. Model faces -Z at rotation.y = 0. */
  _faceToward(target, deltaTime, turnRate) {
    tempDirection.copy(target).sub(this.mesh.position);
    tempDirection.y = 0;
    if (tempDirection.lengthSq() < 1e-6) return;
    tempDirection.normalize();

    const targetAngle = Math.atan2(-tempDirection.x, -tempDirection.z);
    let angleDiff = targetAngle - this.facingAngle;
    angleDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI; // shortest signed path

    const t = 1 - Math.exp(-turnRate * deltaTime);
    this.facingAngle += angleDiff * t;
    this.mesh.rotation.y = this.facingAngle;
  }

  _applyKnockback(deltaTime) {
    if (this._knockbackVelocity.lengthSq() < 1e-6) return;
    this.mesh.position.addScaledVector(this._knockbackVelocity, deltaTime);
    const decay = 1 - Math.exp(-PREDATOR_CONFIG.knockbackDecayRate * deltaTime);
    this._knockbackVelocity.multiplyScalar(1 - decay);
    if (this._knockbackVelocity.lengthSq() < 1e-4) this._knockbackVelocity.set(0, 0, 0);
  }

  _updateHealthBar(deltaTime) {
    if (this._healthBarTimer !== null) this._healthBarTimer -= deltaTime;
    const ratio = this.currentHealth / this.maxHealth;
    updateEntityHealthBar(this.mesh.userData.healthBar, ratio, this._healthBarTimer, PREDATOR_CONFIG.healthBarFadeStart);
    if (this._healthBarTimer !== null && this._healthBarTimer <= 0) this._healthBarTimer = null;
  }

  _applyAnimation(deltaTime) {
    const { body, legs, eyeMaterial, warningSprite, bodyMaterial } = this.mesh.userData;
    const isActive = this.state === STATES.CHASE || this.state === STATES.ATTACK;

    const bobSpeed = isActive ? 8 : 3;
    const bobAmount = isActive ? 0.05 : 0.02;
    body.position.y = 0.28 + Math.sin(this._elapsed * bobSpeed) * bobAmount;

    const legSwingAmount = isActive ? 0.25 : 0.12;
    const legSwing = Math.sin(this._elapsed * bobSpeed * 1.3) * legSwingAmount;
    for (let i = 0; i < legs.length; i++) {
      legs[i].rotation.x = 0.15 + legSwing * (i % 2 === 0 ? 1 : -1);
    }

    const smooth = 1 - Math.exp(-6 * deltaTime);
    const targetLean = this.state === STATES.CHASE ? 0.12 : 0;
    this.mesh.rotation.x += (targetLean - this.mesh.rotation.x) * smooth;

    const eyeSmooth = 1 - Math.exp(-8 * deltaTime);
    const targetEyeIntensity = this.state === STATES.WANDER || this.state === STATES.RETURN ? 0.6 : 1.6;
    eyeMaterial.emissiveIntensity += (targetEyeIntensity - eyeMaterial.emissiveIntensity) * eyeSmooth;

    const targetWarningOpacity = this.state === STATES.ALERT ? 1 : 0;
    warningSprite.material.opacity += (targetWarningOpacity - warningSprite.material.opacity) * (1 - Math.exp(-4 * deltaTime));

    // Hit-flash: a brief additive spike layered on top of the state-driven glow
    // above, decaying back to it exactly (never a permanent material change) -
    // applied last so it always has the final say for this frame.
    if (this._hitFlashTimer !== null) {
      this._hitFlashTimer += deltaTime;
      const t = Math.min(this._hitFlashTimer / PREDATOR_CONFIG.hitFlashDuration, 1);
      if (t >= 1) {
        this._hitFlashTimer = null;
        bodyMaterial.emissiveIntensity = this._bodyBaseEmissiveIntensity;
      } else {
        const flashAmount = 1 - t;
        bodyMaterial.emissiveIntensity = this._bodyBaseEmissiveIntensity + flashAmount * 1.8;
        eyeMaterial.emissiveIntensity += flashAmount * 1.5;
      }
    }

    this._updateHealthBar(deltaTime);
  }
}
