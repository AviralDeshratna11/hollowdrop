import * as THREE from 'three';
import { createRivalSlimeMesh } from './rivalSlimeModel.js?v=5.3';
import { createFireLizardMesh } from './fireLizardModel.js?v=5.3';
import { updateEntityHealthBar } from './entityHealthBar.js?v=5.3';
import { FRAGMENT_STATES } from './genomeFragmentController.js?v=5.3';
import { getTerrainHeight } from './terrain.js?v=5.4';

export const DEBUG_RIVAL = false;

export const RIVAL_FORMS = { SLIME: 'slime', FIRE_LIZARD: 'fireLizard' };

export const RIVAL_CONFIG = {
  maxHealth: 100,
  spawnDelay: 1.2, // seconds after the Fragment is exposed before the Rival appears
  enterDuration: 0.35,
  slimeSpeed: 3.5, // "similar to Hollowdrop" - a comparable cruising pace, not the player's full sprint
  fireLizardSpeed: 5.5, // noticeably faster, post-mutation
  turnSmoothing: 6.0,

  // Mutation triggers once either the Fragment or the player is this close - whichever
  // happens first (spec offers both as valid triggers).
  mutationTriggerDistance: 5,
  mutationDuration: 1.0,

  fragmentReachedRadius: 0.9, // matches GENOME_FRAGMENT_CONFIG.pickupRadius - close enough to attempt pickup
  escapeArriveRadius: 1.2,
  escapeChannelDuration: 3.0,

  playerThreatRadius: 3.0, // SEEK_FRAGMENT -> COMBAT, and the defend-while-escaping trigger
  combatDisengageRadius: 4.5, // COMBAT -> re-evaluate objective

  staggerDuration: 0.1, // short - must not be stun-lockable
  hitFlashDuration: 0.15,
  knockbackForce: 0.3, // small - "cannot be stun-locked... no large knockback"
  knockbackSpeedScale: 3.0,
  knockbackDecayRate: 8.0,

  healthBarVisibleDuration: 2.0,
  healthBarFadeStart: 0.3,

  deathDuration: 1.0,

  fireBreath: {
    damage: 18,
    range: 6,
    coneDotThreshold: 0.7,
    telegraphDuration: 0.6,
    activeDuration: 0.4,
    recoveryDuration: 0.5,
    cooldown: 2.2,
  },
};

const STATES = {
  INACTIVE: 'INACTIVE',
  ENTER: 'ENTER',
  SEEK_FRAGMENT: 'SEEK_FRAGMENT',
  MUTATING: 'MUTATING',
  COMBAT: 'COMBAT',
  ATTACK_FIRE: 'ATTACK_FIRE',
  RECOVER: 'RECOVER',
  FRAGMENT_REACHED: 'FRAGMENT_REACHED', // "given up" - only reachable once the Fragment is SECURED
  PURSUE_PLAYER_CARRIER: 'PURSUE_PLAYER_CARRIER',
  ESCAPE_WITH_FRAGMENT: 'ESCAPE_WITH_FRAGMENT',
  ESCAPE_CHANNEL: 'ESCAPE_CHANNEL',
  DEAD: 'DEAD',
};

const DAMAGEABLE_STATES = new Set([
  STATES.SEEK_FRAGMENT,
  STATES.COMBAT,
  STATES.ATTACK_FIRE,
  STATES.RECOVER,
  STATES.FRAGMENT_REACHED,
  STATES.PURSUE_PLAYER_CARRIER,
  STATES.ESCAPE_WITH_FRAGMENT,
  STATES.ESCAPE_CHANNEL,
]);

const MUTATION_TRIGGER_SQ = RIVAL_CONFIG.mutationTriggerDistance ** 2;
const FRAGMENT_REACHED_SQ = RIVAL_CONFIG.fragmentReachedRadius ** 2;
const ESCAPE_ARRIVE_SQ = RIVAL_CONFIG.escapeArriveRadius ** 2;
const PLAYER_THREAT_SQ = RIVAL_CONFIG.playerThreatRadius ** 2;
const COMBAT_DISENGAGE_SQ = RIVAL_CONFIG.combatDisengageRadius ** 2;
const FIRE_RANGE_SQ = RIVAL_CONFIG.fireBreath.range ** 2;

// Reused scratch vectors - no per-frame allocation in the hot AI-update path.
const tempDirection = new THREE.Vector3();
const tempA = new THREE.Vector3();

function horizontalDistanceSq(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

// Optional, currently silent - hooks so audio can be added later without touching AI logic.
function playRivalEnterSound() {}
function playRivalMutationSound() {}
function playRivalFireSound() {}
function playRivalHitSound() {}
function playRivalDeathSound() {}
function playPlayerHitSound() {}
function playRivalEscapeWarning() {}

/**
 * The Rival: an intelligent competitor whose objective is the Human Genome Fragment,
 * not the player. Owns entrance, a Slime->Fire Lizard mutation (triggered by
 * proximity, once), objective-seeking movement, a single Fire Breath attack, and now
 * the full ownership contest - picking the Fragment up, escaping with it, defending
 * itself, pursuing the player if THEY carry it, and dropping it under enough combat
 * pressure - gated behind the SAME damageable-entity interface every enemy in this
 * game implements (getDamageableEntities/takeDamage). Every high-level decision reads
 * genomeFragmentController.fragment.state LIVE each frame (see _decideNextState())
 * rather than caching a stale local flag, so it always reacts correctly no matter who
 * currently holds the Fragment or how it got there.
 */
export class RivalController {
  constructor({ scene, arenaCenter, arenaRadius, escapeTarget, playerController, playerHealth, resourceManager, genomeFragmentController, uiManager, onSpawned }) {
    this.scene = scene;
    this.arenaCenter = arenaCenter.clone();
    this.arenaRadius = arenaRadius;
    this.escapeTarget = escapeTarget.clone();
    this.playerController = playerController;
    this.player = playerController.mesh;
    this.playerHealth = playerHealth;
    this.resourceManager = resourceManager;
    this.genomeFragmentController = genomeFragmentController;
    this.uiManager = uiManager;
    this.onSpawned = onSpawned; // optional - fires once per _spawn(), e.g. for run-stats tracking
    this.entityType = 'rival';
    this.fragmentContestManager = null; // set post-construction (main.js) - only used for onRivalEscapeSuccess()

    this.mesh = new THREE.Group();
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.slimeVisual = createRivalSlimeMesh();
    this.mesh.add(this.slimeVisual);

    this.fireLizardVisual = createFireLizardMesh();
    this.fireLizardVisual.visible = false;
    this.mesh.add(this.fireLizardVisual);

    // One health bar, owned by the root (not per-visual) so it survives the
    // mutation without needing to move or recreate it.
    this._healthBar = this.fireLizardVisual.userData.healthBar;
    this.fireLizardVisual.remove(this._healthBar);
    this.mesh.add(this._healthBar);

    // Where the Fragment visually attaches while this Rival carries it (spec
    // section 12) - floating above the Fire Lizard's back.
    this.fragmentCarryAnchor = new THREE.Group();
    this.fragmentCarryAnchor.position.set(0, 1.0, 0.15);
    this.mesh.add(this.fragmentCarryAnchor);

    this.currentForm = RIVAL_FORMS.SLIME;
    this.state = STATES.INACTIVE;
    this.stateTime = 0;
    this.facingAngle = 0;
    this._elapsed = 0;

    this.maxHealth = RIVAL_CONFIG.maxHealth;
    this.currentHealth = this.maxHealth;

    this._hasMutated = false;
    this._pendingSpawnDelay = null;

    this._staggerTimer = 0;
    this._hitFlashTimer = null;
    this._bodyBaseEmissiveIntensity = null; // set once the active form's material is known
    this._knockbackVelocity = new THREE.Vector3();
    this._healthBarTimer = null;
    this._deathTime = null;

    this._firePhase = null; // 'telegraph' | 'active' while state === ATTACK_FIRE
    this._fireDirection = new THREE.Vector3();
    this._fireCooldownTimer = 0;
    this._hasHitThisFireBreath = false;
    this._recoveryDuration = 0;
    this._escapeChannelTimer = 0;

    this._fireConeVisual = this._createFireConeVisual();
    scene.add(this._fireConeVisual);
  }

  _createFireConeVisual() {
    const geometry = new THREE.PlaneGeometry(0.9, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xff8a2d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.35;
    return mesh;
  }

  setState(next) {
    if (this.state === next) return;
    if (DEBUG_RIVAL) console.log(`Rival: ${this.state} -> ${next}`);
    this.state = next;
    this.stateTime = 0;
  }

  /** True while actively present in the world (not yet spawned, or dead, both
   *  return false) - GenomeFragmentController checks this before letting the Rival
   *  contest a pickup. */
  isAlive() {
    return this.state !== STATES.INACTIVE && this.state !== STATES.DEAD;
  }

  /** Called from GenomeFragmentController's onExposed hook - arms a delayed entrance
   *  (spec: "brief moment of relief" before the Rival appears), never twice. Safe to
   *  call again later too (e.g. a contest reset re-exposing the Fragment) - it simply
   *  no-ops once the Rival is already active, since _decideNextState() will notice
   *  the fresh Fragment on its own next frame with no extra wiring needed. */
  notifyFragmentExposed() {
    if (this.state !== STATES.INACTIVE || this._pendingSpawnDelay !== null) return;
    this._pendingSpawnDelay = RIVAL_CONFIG.spawnDelay;
  }

  // --- Combat interface --------------------------------------------------------

  getDamageableEntities() {
    return DAMAGEABLE_STATES.has(this.state) ? [this] : [];
  }

  /** Reusable damageable-entity interface: (amount, info) - the exact shape every
   *  other enemy in this game implements, so PlayerCombatController never branches
   *  on entity.type. Returns true if the hit actually landed. */
  takeDamage(amount, info = {}) {
    if (!DAMAGEABLE_STATES.has(this.state)) return false;

    this.currentHealth = Math.max(0, this.currentHealth - amount);
    this._hitFlashTimer = 0;
    this._healthBarTimer = RIVAL_CONFIG.healthBarVisibleDuration;
    this._staggerTimer = RIVAL_CONFIG.staggerDuration;

    const sourcePos = info.sourceEntity?.mesh?.position ?? info.sourceEntity?.position;
    if (sourcePos) {
      tempA.copy(this.mesh.position).sub(sourcePos);
      tempA.y = 0;
      if (tempA.lengthSq() < 1e-6) tempA.set(0, 0, 1);
      else tempA.normalize();
      const knockbackForce = info.knockbackForce ?? RIVAL_CONFIG.knockbackForce;
      this._knockbackVelocity.copy(tempA).multiplyScalar(knockbackForce * RIVAL_CONFIG.knockbackSpeedScale);
    }

    // Every successful Bite also damages carry stability while carrying (spec
    // section 26) - damageRivalStability() itself no-ops unless we're actually the
    // current carrier, so this is always safe to call.
    this.genomeFragmentController.damageRivalStability(amount);

    // Any successful hit during the escape channel cancels it (spec section 57).
    if (this.state === STATES.ESCAPE_CHANNEL) {
      this.uiManager.hideRivalEscapeChannel();
      this.setState(STATES.ESCAPE_WITH_FRAGMENT);
    }

    this.resourceManager.particles.spawnBurst(this._worldHitPoint(), 0xff6a3d, 5);
    playRivalHitSound();

    if (DEBUG_RIVAL) {
      console.log(`Venom Bite hit Rival\nDamage: ${amount}`);
      console.log(`Rival HP:\n${this.currentHealth} / ${this.maxHealth}`);
    }

    if (this.currentHealth <= 0) this._die();
    return true;
  }

  _worldHitPoint(target = tempA) {
    return target.copy(this.mesh.position).add(new THREE.Vector3(0, 0.4, 0));
  }

  getWorldPosition(target = new THREE.Vector3()) {
    return target.copy(this.mesh.position);
  }

  /** Full reset for a brand-new run (Play Again) - the Rival should not exist/activate
   *  again until the next Apex Fragment event (spec section 44), so this returns it
   *  all the way to its pre-first-encounter INACTIVE state. */
  reset() {
    this.state = STATES.INACTIVE; // direct assignment (not setState) - no "X -> INACTIVE" log for a reset
    this.stateTime = 0;
    this.facingAngle = 0;
    this._pendingSpawnDelay = null;

    this.currentForm = RIVAL_FORMS.SLIME;
    this._hasMutated = false;
    this.currentHealth = this.maxHealth;

    this.mesh.visible = false;
    this.mesh.position.copy(this.arenaCenter);
    this.mesh.scale.setScalar(1);
    this.mesh.rotation.set(0, 0, 0);
    this.slimeVisual.visible = true;
    this.slimeVisual.scale.setScalar(1);
    this.fireLizardVisual.visible = false;
    this.fireLizardVisual.scale.setScalar(1);

    this._staggerTimer = 0;
    this._hitFlashTimer = null;
    this._knockbackVelocity.set(0, 0, 0);
    this._healthBarTimer = null;
    this._deathTime = null;
    this._firePhase = null;
    this._fireCooldownTimer = 0;
    this._hasHitThisFireBreath = false;
    this._escapeChannelTimer = 0;

    this._fireConeVisual.material.opacity = 0;
    updateEntityHealthBar(this._healthBar, 1, null, RIVAL_CONFIG.healthBarFadeStart);
    this.uiManager.hideRivalEscapeChannel();
  }

  // --- Debug-only ----------------------------------------------------------------

  debugForceSpawn() {
    if (!DEBUG_RIVAL || this.state !== STATES.INACTIVE) return;
    this._pendingSpawnDelay = 0.05;
  }

  debugForceMutation() {
    if (!DEBUG_RIVAL || this.currentForm !== RIVAL_FORMS.SLIME || !this.isAlive()) return;
    this._beginMutation();
  }

  debugForceFireBreath() {
    if (!DEBUG_RIVAL || this.currentForm !== RIVAL_FORMS.FIRE_LIZARD) return;
    if (this.state !== STATES.COMBAT && this.state !== STATES.SEEK_FRAGMENT && this.state !== STATES.FRAGMENT_REACHED) return;
    this._fireCooldownTimer = 0;
    this._beginFireBreath();
  }

  debugForceSeekFragment() {
    if (!DEBUG_RIVAL) return;
    this.setState(STATES.SEEK_FRAGMENT);
  }

  // --- Main update -------------------------------------------------------------

  update(deltaTime) {
    if (this.state === STATES.INACTIVE) {
      if (this._pendingSpawnDelay !== null) {
        this._pendingSpawnDelay -= deltaTime;
        if (this._pendingSpawnDelay <= 0) {
          this._pendingSpawnDelay = null;
          this._spawn();
        }
      }
      return;
    }

    if (this.state === STATES.DEAD) {
      this._updateDeath(deltaTime);
      return;
    }

    this._applyKnockback(deltaTime);
    this._updateHitFlash(deltaTime);
    this._updateHealthBar(deltaTime);

    if (this._fireCooldownTimer > 0) this._fireCooldownTimer = Math.max(0, this._fireCooldownTimer - deltaTime);

    if (this._staggerTimer > 0) {
      this._staggerTimer = Math.max(0, this._staggerTimer - deltaTime);
      this._elapsed += deltaTime;
      this._applyIdleAnimation(deltaTime);
      return;
    }

    this._elapsed += deltaTime;
    this.stateTime += deltaTime;

    switch (this.state) {
      case STATES.ENTER:
        this._updateEnter(deltaTime);
        break;
      case STATES.SEEK_FRAGMENT:
        this._updateSeekFragment(deltaTime);
        break;
      case STATES.MUTATING:
        this._updateMutation(deltaTime);
        break;
      case STATES.COMBAT:
        this._updateCombat(deltaTime);
        break;
      case STATES.ATTACK_FIRE:
        this._updateFireBreath(deltaTime);
        break;
      case STATES.RECOVER:
        this._updateRecover(deltaTime);
        break;
      case STATES.FRAGMENT_REACHED:
        this._updateFragmentReached(deltaTime);
        break;
      case STATES.PURSUE_PLAYER_CARRIER:
        this._updatePursuePlayerCarrier(deltaTime);
        break;
      case STATES.ESCAPE_WITH_FRAGMENT:
        this._updateEscapeWithFragment(deltaTime);
        break;
      case STATES.ESCAPE_CHANNEL:
        this._updateEscapeChannel(deltaTime);
        break;
    }

    if (this.state !== STATES.DEAD && this.state !== STATES.INACTIVE) {
      const targetY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
      const ySmooth = 1 - Math.exp(-12.0 * deltaTime);
      this.mesh.position.y += (targetY - this.mesh.position.y) * ySmooth;
    }

    this._applyIdleAnimation(deltaTime);
  }

  // --- Entrance ------------------------------------------------------------------

  _spawn() {
    tempDirection.copy(this.player.position).sub(this.arenaCenter);
    tempDirection.y = 0;
    if (tempDirection.lengthSq() < 1e-6) tempDirection.set(0, 0, 1);
    else tempDirection.normalize();
    // Opposite side of the arena from the player, where practical (spec section 4/5).
    const spawnX = this.arenaCenter.x - tempDirection.x * (this.arenaRadius - 1);
    const spawnZ = this.arenaCenter.z - tempDirection.z * (this.arenaRadius - 1);

    this.mesh.position.set(spawnX, 0, spawnZ);
    this.mesh.visible = true;
    this.mesh.scale.setScalar(0.6);
    this.slimeVisual.visible = true;
    this.fireLizardVisual.visible = false;
    this.currentForm = RIVAL_FORMS.SLIME;
    this._hasMutated = false;
    this.currentHealth = this.maxHealth;
    this._bodyBaseEmissiveIntensity = this.slimeVisual.userData.membraneMaterial.emissiveIntensity;

    this.setState(STATES.ENTER);
    this.resourceManager.particles.spawnBurst(this.mesh.position, 0xff6a3d, 8);
    this.uiManager.showRivalAlert();
    playRivalEnterSound();
    this.onSpawned?.();
    if (DEBUG_RIVAL) console.log('Rival spawned at', this.mesh.position);
  }

  _updateEnter(deltaTime) {
    const t = Math.min(this.stateTime / RIVAL_CONFIG.enterDuration, 1);
    // Small impact bounce: overshoot past 1 then settle, reusing the same
    // easeOutBack curve the player's own mutation settle already uses.
    this.mesh.scale.setScalar(THREE.MathUtils.lerp(0.6, 1, easeOutBack(t)));
    if (t >= 1) {
      this.mesh.scale.setScalar(1);
      this.setState(STATES.SEEK_FRAGMENT);
    }
  }

  /** The single source of truth for "what should I be doing right now", re-derived
   *  fresh from the Fragment's live state every time it's needed (never a cached
   *  flag) - used after combat/recovery resolves, and whenever the current
   *  high-level activity turns out to no longer make sense. */
  _decideNextState() {
    const fragment = this.genomeFragmentController.fragment;
    if (!fragment || fragment.state === FRAGMENT_STATES.SECURED) return STATES.FRAGMENT_REACHED;
    if (fragment.state === FRAGMENT_STATES.CARRIED_BY_RIVAL) return STATES.ESCAPE_WITH_FRAGMENT;
    if (fragment.state === FRAGMENT_STATES.CARRIED_BY_PLAYER) return STATES.PURSUE_PLAYER_CARRIER;
    return STATES.SEEK_FRAGMENT; // EXPOSED or DROPPED
  }

  // --- Seek Fragment ---------------------------------------------------------

  _updateSeekFragment(deltaTime) {
    const fragment = this.genomeFragmentController.fragment;
    const next = this._decideNextState();
    if (next !== STATES.SEEK_FRAGMENT) {
      this.setState(next);
      return;
    }

    if (this._checkMutationTrigger()) return;

    const fragmentPos = fragment.mesh.position;
    this._moveToward(fragmentPos, this._getSpeed(), deltaTime);

    const distToFragmentSq = horizontalDistanceSq(this.mesh.position, fragmentPos);
    if (distToFragmentSq < FRAGMENT_REACHED_SQ) {
      if (this.genomeFragmentController.pickupByRival()) {
        this.setState(STATES.ESCAPE_WITH_FRAGMENT);
        return;
      }
      // Pickup failed (player grabbed it the same instant, spec section 9) -
      // _decideNextState() will correctly redirect next frame.
    }

    if (this.currentForm === RIVAL_FORMS.FIRE_LIZARD && this._isPlayerThreat()) {
      this.setState(STATES.COMBAT);
    }
  }

  _enterFragmentReached() {
    this.setState(STATES.FRAGMENT_REACHED);
  }

  /** Only reachable once the Fragment is SECURED (see _decideNextState()) - the
   *  Rival has given up for good and retreats toward the arena (spec section 54). */
  _updateFragmentReached(deltaTime) {
    this._moveToward(this.arenaCenter, this._getSpeed() * 0.6, deltaTime);
  }

  /** Shared by SEEK_FRAGMENT - the mutation trigger (player OR Fragment proximity,
   *  whichever fires first). Returns true if it fired. */
  _checkMutationTrigger() {
    if (this._hasMutated || this.currentForm !== RIVAL_FORMS.SLIME) return false;

    const distToPlayerSq = horizontalDistanceSq(this.mesh.position, this.player.position);
    const fragment = this.genomeFragmentController.fragment;
    const distToFragmentSq = fragment ? horizontalDistanceSq(this.mesh.position, fragment.mesh.position) : Infinity;

    if (distToFragmentSq < MUTATION_TRIGGER_SQ || distToPlayerSq < MUTATION_TRIGGER_SQ) {
      this._beginMutation();
      return true;
    }
    return false;
  }

  _isPlayerThreat() {
    return horizontalDistanceSq(this.mesh.position, this.player.position) < PLAYER_THREAT_SQ;
  }

  // --- Mutation ----------------------------------------------------------------

  _beginMutation() {
    this._hasMutated = true;
    this.setState(STATES.MUTATING);
    this.resourceManager.particles.spawnBurst(this.mesh.position, 0xff8a3d, 8);
    playRivalMutationSound();
    if (DEBUG_RIVAL) console.log('Rival mutation started');
  }

  _updateMutation(deltaTime) {
    const t = Math.min(this.stateTime / RIVAL_CONFIG.mutationDuration, 1);
    const { coreMaterial, membraneMaterial } = this.slimeVisual.userData;

    if (t < 0.4) {
      const ct = t / 0.4;
      this.slimeVisual.scale.setScalar(THREE.MathUtils.lerp(1, 0.45, ct));
      coreMaterial.emissiveIntensity = THREE.MathUtils.lerp(1.1, 3.2, ct);
      membraneMaterial.emissiveIntensity = THREE.MathUtils.lerp(0.35, 1.4, ct);
    } else if (this.slimeVisual.visible) {
      this.slimeVisual.visible = false;
      this.fireLizardVisual.visible = true;
      this.fireLizardVisual.scale.setScalar(0.35);
      this._bodyBaseEmissiveIntensity = this.fireLizardVisual.userData.bodyMaterial.emissiveIntensity;
      this.resourceManager.particles.spawnBurst(this.mesh.position, 0xff5522, 10);
    }

    if (t >= 0.4) {
      const ct = (t - 0.4) / 0.6;
      this.fireLizardVisual.scale.setScalar(THREE.MathUtils.lerp(0.35, 1, easeOutBack(Math.min(ct, 1))));
    }

    if (t >= 1) {
      this.fireLizardVisual.scale.setScalar(1);
      this.currentForm = RIVAL_FORMS.FIRE_LIZARD;
      // Reset the Slime visual's transient state so it's clean if ever seen again (it won't be, but no stale glow left behind).
      coreMaterial.emissiveIntensity = 1.1;
      membraneMaterial.emissiveIntensity = 0.35;
      this.slimeVisual.scale.setScalar(1);
      this.setState(this._decideNextState());
      if (DEBUG_RIVAL) console.log('Rival mutation complete -> Fire Lizard');
    }
  }

  // --- Combat / Fire Breath ----------------------------------------------------

  _updateCombat(deltaTime) {
    this._faceToward(this.player.position, deltaTime, RIVAL_CONFIG.turnSmoothing);

    const distToPlayerSq = horizontalDistanceSq(this.mesh.position, this.player.position);
    if (distToPlayerSq > COMBAT_DISENGAGE_SQ) {
      this.setState(this._decideNextState());
      return;
    }

    if (this._fireCooldownTimer <= 0) this._beginFireBreath();
  }

  _beginFireBreath() {
    this._hasHitThisFireBreath = false;
    this._firePhase = 'telegraph';
    this.setState(STATES.ATTACK_FIRE);
  }

  _updateFireBreath(deltaTime) {
    const cfg = RIVAL_CONFIG.fireBreath;
    const { glandMaterial } = this.fireLizardVisual.userData;

    if (this._firePhase === 'telegraph') {
      this._faceToward(this.player.position, deltaTime, RIVAL_CONFIG.turnSmoothing * 1.5);
      const t = Math.min(this.stateTime / cfg.telegraphDuration, 1);
      glandMaterial.emissiveIntensity = 0.9 + t * 2.2;

      if (this.stateTime >= cfg.telegraphDuration) {
        // Direction locks HERE, once - never re-homed during ACTIVE (spec: this is
        // what allows dodging, same rule as the Apex's Charge).
        this._fireDirection.set(-Math.sin(this.facingAngle), 0, -Math.cos(this.facingAngle));
        this._firePhase = 'active';
        this._fireActiveTime = 0;

        tempA.copy(this.mesh.position).addScaledVector(this._fireDirection, 0.5);
        tempA.y += 0.35;
        this.resourceManager.particles.spawnOutwardBurst(tempA, this._fireDirection, 0xff8a2d, 10);

        this._fireConeVisual.position.set(this.mesh.position.x, 0.35, this.mesh.position.z);
        this._fireConeVisual.rotation.z = Math.atan2(this._fireDirection.x, this._fireDirection.z);
        this._fireConeVisual.scale.set(1, cfg.range, 1);
        this._fireConeVisual.material.opacity = 0.3;

        playRivalFireSound();
      }
      return;
    }

    // active
    this._fireActiveTime += deltaTime;
    this._fireConeVisual.material.opacity = Math.max(0.3 * (1 - this._fireActiveTime / cfg.activeDuration), 0);
    glandMaterial.emissiveIntensity = Math.max(3.1 - this._fireActiveTime * 4, 0.9);

    if (!this._hasHitThisFireBreath) {
      tempA.copy(this.player.position).sub(this.mesh.position);
      tempA.y = 0;
      const distSq = tempA.lengthSq();
      if (distSq <= FIRE_RANGE_SQ) {
        const inCone = distSq < 1e-6 || tempA.normalize().dot(this._fireDirection) > cfg.coneDotThreshold;
        if (inCone) {
          this._hasHitThisFireBreath = true;
          this._hitPlayer(cfg.damage);
        }
      }
    }

    if (this._fireActiveTime >= cfg.activeDuration) {
      this._fireConeVisual.material.opacity = 0;
      this._firePhase = null;
      this._fireCooldownTimer = cfg.cooldown;
      this._recoveryDuration = cfg.recoveryDuration;
      this.setState(STATES.RECOVER);
    }
  }

  _updateRecover() {
    if (this.stateTime < this._recoveryDuration) return;
    if (this._isPlayerThreat() && this._decideNextState() !== STATES.ESCAPE_WITH_FRAGMENT) {
      // Still an immediate threat and not mid-escape - keep fighting.
      this.setState(STATES.COMBAT);
      return;
    }
    this.setState(this._decideNextState());
  }

  _hitPlayer(amount) {
    const hit = this.playerHealth.takeDamage(amount, this);
    if (hit) {
      // Same rule as the Rival's own carry stability (spec section 38): Fire Breath
      // always damages Health; it ALSO damages Fragment carry stability, only while
      // the Player is actually carrying (no-op otherwise).
      this.genomeFragmentController.damagePlayerStability(amount);
      playPlayerHitSound();
      if (DEBUG_RIVAL) console.log(`Player hit by Rival Fire Breath! Health: ${this.playerHealth.currentHealth}`);
    }
  }

  // --- Fragment ownership behaviour --------------------------------------------

  _updatePursuePlayerCarrier(deltaTime) {
    const next = this._decideNextState();
    if (next !== STATES.PURSUE_PLAYER_CARRIER) {
      this.setState(next);
      return;
    }

    // Aggressive - no disengage radius here, the objective is physically on the player.
    this._moveToward(this.player.position, this._getSpeed(), deltaTime);

    if (this._isPlayerThreat() && this._fireCooldownTimer <= 0) {
      this._beginFireBreath();
    }
  }

  _updateEscapeWithFragment(deltaTime) {
    const next = this._decideNextState();
    if (next !== STATES.ESCAPE_WITH_FRAGMENT) {
      this.setState(next);
      return;
    }

    // Defend if the player catches up, but don't abandon the escape for long -
    // Fire Breath still routes through RECOVER -> _decideNextState(), which sends
    // it right back here as long as it's still the carrier (spec section 19-21).
    if (this._isPlayerThreat() && this._fireCooldownTimer <= 0) {
      this._beginFireBreath();
      return;
    }

    this._moveToward(this.escapeTarget, this._getSpeed(), deltaTime);

    const distToEscapeSq = horizontalDistanceSq(this.mesh.position, this.escapeTarget);
    if (distToEscapeSq < ESCAPE_ARRIVE_SQ) {
      this._beginEscapeChannel();
    }
  }

  _beginEscapeChannel() {
    this.setState(STATES.ESCAPE_CHANNEL);
    this._escapeChannelTimer = 0;
    this.uiManager.showRivalEscapeChannel();
    playRivalEscapeWarning();
    if (DEBUG_RIVAL) console.log('Rival escape channel started');
  }

  _updateEscapeChannel(deltaTime) {
    const next = this._decideNextState();
    if (next !== STATES.ESCAPE_WITH_FRAGMENT && next !== STATES.ESCAPE_CHANNEL) {
      // Fragment stopped being ours mid-channel (dropped via stability hitting 0,
      // or some other resolution) - bail out cleanly.
      this.uiManager.hideRivalEscapeChannel();
      this.setState(next);
      return;
    }

    this._escapeChannelTimer += deltaTime;
    this.uiManager.updateRivalEscapeChannel(this._escapeChannelTimer / RIVAL_CONFIG.escapeChannelDuration);

    if (this._escapeChannelTimer >= RIVAL_CONFIG.escapeChannelDuration) {
      this.uiManager.hideRivalEscapeChannel();
      this.genomeFragmentController.releaseForReset();
      this.setState(STATES.FRAGMENT_REACHED);
      this.fragmentContestManager?.onRivalEscapeSuccess();
      if (DEBUG_RIVAL) console.log('Rival escape channel completed - Fragment lost');
    }
  }

  // --- Death -------------------------------------------------------------------

  _die() {
    if (this.state === STATES.DEAD) return;
    // Dying while carrying releases the Fragment immediately (spec section 64) -
    // dropFromRival() itself no-ops unless we're actually the current carrier.
    this.genomeFragmentController.dropFromRival();

    this.setState(STATES.DEAD);
    this._deathTime = 0;
    this._firePhase = null;
    this._fireConeVisual.material.opacity = 0;
    this.uiManager.hideRivalEscapeChannel();
    updateEntityHealthBar(this._healthBar, 0, null, RIVAL_CONFIG.healthBarFadeStart);

    this.resourceManager.particles.spawnBurst(this.mesh.position, 0xff6a3d, 10);
    playRivalDeathSound();
    if (DEBUG_RIVAL) console.log('Rival died');
  }

  _updateDeath(deltaTime) {
    this._deathTime += deltaTime;
    const t = Math.min(this._deathTime / RIVAL_CONFIG.deathDuration, 1);
    const activeVisual = this.currentForm === RIVAL_FORMS.FIRE_LIZARD ? this.fireLizardVisual : this.slimeVisual;
    activeVisual.scale.setScalar(Math.max(1 - t * t, 0.001));

    if (t >= 1 && this.mesh.visible) {
      this._dropLoot();
      this.mesh.visible = false;
    }
  }

  _dropLoot() {
    const angle = Math.random() * Math.PI * 2;
    const dropX = this.mesh.position.x + Math.cos(angle) * 0.3;
    const dropZ = this.mesh.position.z + Math.sin(angle) * 0.3;
    const dropY = getTerrainHeight(dropX, dropZ);
    this.resourceManager.spawnResource('rival_dna', new THREE.Vector3(dropX, dropY, dropZ));
    if (DEBUG_RIVAL) console.log('Dropped Rival DNA');
  }

  // --- Shared helpers --------------------------------------------------------

  _getSpeed() {
    return this.currentForm === RIVAL_FORMS.FIRE_LIZARD ? RIVAL_CONFIG.fireLizardSpeed : RIVAL_CONFIG.slimeSpeed;
  }

  /** Moves toward `target`. Fire Lizard smoothly yaws to face its heading (spec
   *  section 17); base Slime deliberately does not (section 18) - _applyIdleAnimation
   *  communicates its direction via lean/squash instead. */
  _moveToward(target, speed, deltaTime) {
    tempDirection.copy(target).sub(this.mesh.position);
    tempDirection.y = 0;
    if (tempDirection.lengthSq() > 1e-6) {
      tempDirection.normalize();
      this.mesh.position.addScaledVector(tempDirection, speed * deltaTime);
      this._lastMoveDir = tempDirection;
      if (this.currentForm === RIVAL_FORMS.FIRE_LIZARD) {
        this._faceToward(target, deltaTime, RIVAL_CONFIG.turnSmoothing);
      }
    }
  }

  /** Smoothly yaws the model to face `target`. Model faces -Z at rotation.y = 0
   *  (same convention as every other model in this project). */
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

  _applyKnockback(deltaTime) {
    if (this._knockbackVelocity.lengthSq() < 1e-6) return;
    this.mesh.position.addScaledVector(this._knockbackVelocity, deltaTime);
    const decay = 1 - Math.exp(-RIVAL_CONFIG.knockbackDecayRate * deltaTime);
    this._knockbackVelocity.multiplyScalar(1 - decay);
    if (this._knockbackVelocity.lengthSq() < 1e-4) this._knockbackVelocity.set(0, 0, 0);
  }

  _updateHitFlash(deltaTime) {
    if (this._hitFlashTimer === null) return;
    const material = this.currentForm === RIVAL_FORMS.FIRE_LIZARD ? this.fireLizardVisual.userData.bodyMaterial : this.slimeVisual.userData.membraneMaterial;

    this._hitFlashTimer += deltaTime;
    const t = Math.min(this._hitFlashTimer / RIVAL_CONFIG.hitFlashDuration, 1);
    if (t >= 1) {
      this._hitFlashTimer = null;
      material.emissiveIntensity = this._bodyBaseEmissiveIntensity;
      return;
    }
    material.emissiveIntensity = this._bodyBaseEmissiveIntensity + (1 - t) * 1.8;
  }

  _updateHealthBar(deltaTime) {
    if (this._healthBarTimer !== null) this._healthBarTimer -= deltaTime;
    const ratio = this.currentHealth / this.maxHealth;
    updateEntityHealthBar(this._healthBar, ratio, this._healthBarTimer, RIVAL_CONFIG.healthBarFadeStart);
    if (this._healthBarTimer !== null && this._healthBarTimer <= 0) this._healthBarTimer = null;
  }

  _applyIdleAnimation(deltaTime) {
    if (this.currentForm === RIVAL_FORMS.SLIME) {
      this._applySlimeIdle(deltaTime);
    } else {
      this._applyFireLizardIdle(deltaTime);
    }
  }

  /** No precise facing (spec section 18) - direction reads through a lean into the
   *  movement direction plus a soft squash/stretch pulse, same visual language the
   *  player's own Slime uses. */
  _applySlimeIdle(deltaTime) {
    const dir = this._lastMoveDir;
    const smooth = 1 - Math.exp(-6 * deltaTime);
    const targetTiltX = dir ? dir.z * 0.12 : 0;
    const targetTiltZ = dir ? -dir.x * 0.12 : 0;
    this.mesh.rotation.x += (targetTiltX - this.mesh.rotation.x) * smooth;
    this.mesh.rotation.z += (targetTiltZ - this.mesh.rotation.z) * smooth;

    const pulse = 1 + Math.sin(this._elapsed * 3) * 0.03;
    this.slimeVisual.scale.set(pulse, 1 / pulse, pulse);
  }

  _applyFireLizardIdle(deltaTime) {
    const { legs, tailPivot } = this.fireLizardVisual.userData;
    const isMoving =
      this.state === STATES.SEEK_FRAGMENT ||
      this.state === STATES.COMBAT ||
      this.state === STATES.PURSUE_PLAYER_CARRIER ||
      this.state === STATES.ESCAPE_WITH_FRAGMENT;
    const bobSpeed = isMoving ? 7 : 3;
    const legSwingAmount = isMoving ? 0.22 : 0.1;
    const legSwing = Math.sin(this._elapsed * bobSpeed) * legSwingAmount;
    for (let i = 0; i < legs.length; i++) {
      legs[i].rotation.x = 0.1 + legSwing * (i % 2 === 0 ? 1 : -1);
    }
    tailPivot.rotation.y = Math.sin(this._elapsed * 2) * 0.2;
  }
}
