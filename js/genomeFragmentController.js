import * as THREE from 'three';
import { createGenomeFragmentMesh } from './genomeFragmentModel.js?v=5.3';
import { getTerrainHeight } from './terrain.js?v=5.4';

export const FRAGMENT_STATES = {
  EXPOSED: 'exposed',
  CARRIED_BY_PLAYER: 'carried_by_player',
  CARRIED_BY_RIVAL: 'carried_by_rival',
  DROPPED: 'dropped',
  SECURED: 'secured',
};

export const GENOME_FRAGMENT_CONFIG = {
  revealDuration: 0.8, // corpse-glow-contracts-and-rises beat, matches spec's "brief reveal delay"
  riseHeight: 0.35,
  pickupRadius: 0.9,
  repickupDelay: 0.35, // brief drop-invulnerability so it can't instantly ping-pong back to the same carrier
  dropArcDuration: 0.3,
  dropDistance: 0.6,
  dropHopHeight: 0.3,
  bobAmplitude: 0.05,
  bobSpeed: 1.4,
  spinSpeed: 0.6,
  playerStabilityMax: 30,
  rivalStabilityMax: 30,
  secureDuration: 1.0,
};

// Optional, currently silent - hooks so audio/haptics can be added later without touching state logic.
function playFragmentPickupSound() {}
function playFragmentDropSound() {}
function playFragmentSecureSound() {}
function triggerFragmentPickupHaptic() {}
function triggerFragmentDropHaptic() {}

const tempWorldPos = new THREE.Vector3();

/**
 * Owns the ONE Human Genome Fragment as a single authoritative object with an
 * explicit ownership state machine (spec section 2: never scattered booleans like
 * playerHasFragment/rivalHasFragment/fragmentDropped). Deliberately NOT built on
 * ResourceManager/InventoryManager - it's a progression item (no weight, no capacity
 * gate, not edible, not expellable), and forcing it through those systems would mean
 * special-casing weight/burden/consume/expel in several existing files rather than
 * writing one small self-contained controller. Genome progression (collectedCount)
 * increments exactly once, only on secure() - touching or carrying it is not the
 * same as owning it permanently.
 */
export class GenomeFragmentController {
  constructor(scene, playerController, playerHealth, uiManager, { onExposed, onPickup, onDrop, onSecured } = {}) {
    this.scene = scene;
    this.playerController = playerController;
    this.playerHealth = playerHealth;
    this.uiManager = uiManager;
    this.onExposed = onExposed;
    this.onPickup = onPickup;
    this.onDrop = onDrop;
    this.onSecured = onSecured;

    // Set post-construction (main.js) once it exists - only needed for pickup-
    // proximity/aliveness checks, never scene-searched.
    this.rivalController = null;
    this.playerCarryAnchor = null; // set post-construction too - see main.js

    this.fragment = null;
    this.collectedCount = 0;
  }

  /** Called once an Apex dies (or after a Rival successfully escapes, see
   *  FragmentContestManager's reset) - spawns the Fragment at `position` and begins
   *  its reveal animation. No-ops if one is already out (single-fragment prototype). */
  spawn(position) {
    if (this.fragment) return;

    const groundY = getTerrainHeight(position.x, position.z);
    const mesh = createGenomeFragmentMesh();
    mesh.position.set(position.x, groundY + 0.15, position.z);
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);

    this.fragment = {
      mesh,
      state: FRAGMENT_STATES.EXPOSED,
      carrier: null,
      baseY: mesh.position.y + GENOME_FRAGMENT_CONFIG.riseHeight,
      revealTimer: 0,
      collectible: false,
      elapsed: 0,
      playerStability: 0,
      rivalStability: 0,
      repickupCooldown: 0,
      dropAnim: null, // { start, target, time } while a drop-arc is playing, else null
      secureTime: 0,
    };

    this.onExposed?.(this.fragment);
  }

  /** True while a Fragment exists in the world and hasn't been permanently secured -
   *  the signal every other system (Rival AI, extraction) should read to know
   *  whether the contest is still live. */
  isActive() {
    return this.fragment !== null && this.fragment.state !== FRAGMENT_STATES.SECURED;
  }

  update(deltaTime) {
    if (!this.fragment) return;
    const f = this.fragment;
    f.elapsed += deltaTime;

    this._updateIdleVisuals(deltaTime);

    switch (f.state) {
      case FRAGMENT_STATES.EXPOSED:
        this._updateExposed(deltaTime);
        break;
      case FRAGMENT_STATES.DROPPED:
        this._updateDropped(deltaTime);
        break;
      case FRAGMENT_STATES.SECURED:
        this._updateSecuring(deltaTime);
        break;
      // CARRIED_BY_PLAYER / CARRIED_BY_RIVAL: position is automatic via anchor
      // parenting - nothing extra to drive here.
    }
  }

  _updateIdleVisuals(deltaTime) {
    const f = this.fragment;
    f.mesh.rotation.y += deltaTime * GENOME_FRAGMENT_CONFIG.spinSpeed;
    const { orbiters } = f.mesh.userData;
    for (let i = 0; i < orbiters.length; i++) {
      const orbitAngle = f.elapsed * 1.2 + (i / orbiters.length) * Math.PI * 2;
      orbiters[i].position.set(Math.cos(orbitAngle) * 0.24, Math.sin(orbitAngle * 1.4) * 0.1, Math.sin(orbitAngle) * 0.24);
    }
    const pulse = 1.4 + Math.sin(f.elapsed * 2.2) * 0.3;
    f.mesh.userData.coreMaterial.emissiveIntensity = pulse;
  }

  _updateExposed(deltaTime) {
    const f = this.fragment;
    if (!f.collectible) {
      f.revealTimer += deltaTime;
      const t = Math.min(f.revealTimer / GENOME_FRAGMENT_CONFIG.revealDuration, 1);
      const eased = t * (2 - t); // ease-out, no overshoot needed for a slow reveal
      f.mesh.scale.setScalar(Math.max(eased, 0.01));
      f.mesh.position.y = THREE.MathUtils.lerp(f.baseY - GENOME_FRAGMENT_CONFIG.riseHeight, f.baseY, eased);
      if (t >= 1) f.collectible = true;
      return;
    }
    f.mesh.position.y = f.baseY + Math.sin(f.elapsed * GENOME_FRAGMENT_CONFIG.bobSpeed) * GENOME_FRAGMENT_CONFIG.bobAmplitude;
    this._checkPickupProximity();
  }

  _updateDropped(deltaTime) {
    const f = this.fragment;
    if (f.repickupCooldown > 0) f.repickupCooldown = Math.max(0, f.repickupCooldown - deltaTime);

    if (f.dropAnim) {
      f.dropAnim.time += deltaTime;
      const t = Math.min(f.dropAnim.time / GENOME_FRAGMENT_CONFIG.dropArcDuration, 1);
      f.mesh.position.lerpVectors(f.dropAnim.start, f.dropAnim.target, t);
      f.mesh.position.y += Math.sin(t * Math.PI) * GENOME_FRAGMENT_CONFIG.dropHopHeight;
      if (t >= 1) {
        f.baseY = f.dropAnim.target.y;
        f.dropAnim = null;
      }
      return; // no pickup checks mid-arc - keeps the "short physical impact" readable
    }

    f.mesh.position.y = f.baseY + Math.sin(f.elapsed * GENOME_FRAGMENT_CONFIG.bobSpeed) * GENOME_FRAGMENT_CONFIG.bobAmplitude;
    this._checkPickupProximity();
  }

  /** Automatic, proximity-based (spec section 7-9) - no button required. If both
   *  Player and Rival are simultaneously in range, whichever is closer wins (a
   *  deterministic tie-break for the same-frame case); pickupByPlayer()/
   *  pickupByRival() each still independently guard the state transition, so only
   *  one can ever actually succeed regardless. */
  _checkPickupProximity() {
    const f = this.fragment;
    if (f.repickupCooldown > 0) return;

    const pickupRadiusSq = GENOME_FRAGMENT_CONFIG.pickupRadius ** 2;
    const playerAlive = !this.playerHealth.isDead;
    const playerDistSq = playerAlive ? this.playerController.mesh.position.distanceToSquared(f.mesh.position) : Infinity;

    const rival = this.rivalController;
    const rivalAlive = rival && rival.isAlive();
    const rivalDistSq = rivalAlive ? rival.mesh.position.distanceToSquared(f.mesh.position) : Infinity;

    const playerInRange = playerAlive && playerDistSq < pickupRadiusSq;
    const rivalInRange = rivalAlive && rivalDistSq < pickupRadiusSq;
    if (!playerInRange && !rivalInRange) return;

    if (playerInRange && (!rivalInRange || playerDistSq <= rivalDistSq)) this.pickupByPlayer();
    else this.pickupByRival();
  }

  // --- Pickup / carry ----------------------------------------------------------

  pickupByPlayer() {
    const f = this.fragment;
    if (!f || (f.state !== FRAGMENT_STATES.EXPOSED && f.state !== FRAGMENT_STATES.DROPPED)) return false;
    if (this.playerHealth.isDead) return false;

    f.state = FRAGMENT_STATES.CARRIED_BY_PLAYER;
    f.carrier = 'player';
    f.playerStability = GENOME_FRAGMENT_CONFIG.playerStabilityMax;
    this._attachToCarrier(this.playerCarryAnchor);

    this.uiManager.showFragmentAcquired();
    this.uiManager.triggerGenomeFlash?.();
    playFragmentPickupSound();
    triggerFragmentPickupHaptic();
    this.onPickup?.('player');
    return true;
  }

  pickupByRival() {
    const f = this.fragment;
    if (!f || (f.state !== FRAGMENT_STATES.EXPOSED && f.state !== FRAGMENT_STATES.DROPPED)) return false;
    if (!this.rivalController || !this.rivalController.isAlive()) return false;

    f.state = FRAGMENT_STATES.CARRIED_BY_RIVAL;
    f.carrier = 'rival';
    f.rivalStability = GENOME_FRAGMENT_CONFIG.rivalStabilityMax;
    this._attachToCarrier(this.rivalController.fragmentCarryAnchor);

    this.uiManager.showRivalStoleFragment();
    playFragmentPickupSound();
    this.onPickup?.('rival');
    return true;
  }

  _attachToCarrier(anchor) {
    const f = this.fragment;
    if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
    anchor.add(f.mesh);
    f.mesh.position.set(0, 0, 0);
    f.mesh.scale.setScalar(1);
    f.dropAnim = null;
  }

  // --- Damage-to-stability (called by combat hit paths) -------------------------

  /** Called by RivalController.takeDamage() - no-ops unless the Rival is actually
   *  the current carrier (spec section 26: Bite always damages Rival HP; it ONLY
   *  also damages carry stability while carrying). */
  damageRivalStability(amount) {
    const f = this.fragment;
    if (!f || f.state !== FRAGMENT_STATES.CARRIED_BY_RIVAL) return;
    f.rivalStability = Math.max(0, f.rivalStability - amount);
    if (f.rivalStability <= 0) this.dropFromRival();
  }

  /** Called by RivalController._hitPlayer() - same shape, for the Player's own
   *  carry stability against Fire Breath hits. */
  damagePlayerStability(amount) {
    const f = this.fragment;
    if (!f || f.state !== FRAGMENT_STATES.CARRIED_BY_PLAYER) return;
    f.playerStability = Math.max(0, f.playerStability - amount);
    if (f.playerStability <= 0) this.dropFromPlayer();
  }

  // --- Drop ----------------------------------------------------------------------

  dropFromPlayer() {
    this._drop('player');
  }

  dropFromRival() {
    this._drop('rival');
  }

  _drop(fromCarrier) {
    const f = this.fragment;
    if (!f) return;
    if (fromCarrier === 'player' && f.state !== FRAGMENT_STATES.CARRIED_BY_PLAYER) return;
    if (fromCarrier === 'rival' && f.state !== FRAGMENT_STATES.CARRIED_BY_RIVAL) return;

    const carrierMesh = fromCarrier === 'player' ? this.playerController.mesh : this.rivalController.mesh;

    f.mesh.getWorldPosition(tempWorldPos);
    if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
    this.scene.add(f.mesh);
    f.mesh.position.copy(tempWorldPos);

    const angle = Math.random() * Math.PI * 2;
    const targetX = carrierMesh.position.x + Math.cos(angle) * GENOME_FRAGMENT_CONFIG.dropDistance;
    const targetZ = carrierMesh.position.z + Math.sin(angle) * GENOME_FRAGMENT_CONFIG.dropDistance;
    const targetY = getTerrainHeight(targetX, targetZ) + 0.3;
    const target = new THREE.Vector3(targetX, targetY, targetZ);
    f.dropAnim = { start: tempWorldPos.clone(), target, time: 0 };

    f.state = FRAGMENT_STATES.DROPPED;
    f.carrier = null;
    f.collectible = true;
    f.repickupCooldown = GENOME_FRAGMENT_CONFIG.repickupDelay;

    this.uiManager.showFragmentDropped();
    playFragmentDropSound();
    triggerFragmentDropHaptic();
    this.onDrop?.(fromCarrier);
  }

  /** Used when the Rival completes its escape channel (spec section 58-59) - the
   *  Fragment "leaves with it" rather than a physical drop, immediately clearing
   *  the way for FragmentContestManager's forgiving contest reset. */
  releaseForReset() {
    const f = this.fragment;
    if (!f) return;
    // Detach from whatever actually parents it right now (scene while EXPOSED/DROPPED/
    // SECURED, a carry anchor while CARRIED_BY_PLAYER/CARRIED_BY_RIVAL) - assuming the
    // scene here would silently no-op for a carried Fragment, leaking the mesh as an
    // orphaned child of the carrier's anchor.
    if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
    f.mesh.traverse((child) => {
      if (!child.material) return;
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    });
    this.fragment = null;
  }

  /** Full reset for a brand-new run (Play Again) - clears any Fragment regardless of
   *  its current state/parent and zeroes progression. */
  reset() {
    if (this.fragment) this.releaseForReset();
    this.collectedCount = 0;
  }

  // --- Secure --------------------------------------------------------------------

  /** Only valid from CARRIED_BY_PLAYER (spec section 3: Rival can never reach
   *  SECURED in this prototype). Progression increments exactly once, here. */
  secure() {
    const f = this.fragment;
    if (!f || f.state !== FRAGMENT_STATES.CARRIED_BY_PLAYER) return false;

    if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
    this.scene.add(f.mesh);
    f.mesh.position.set(this.playerController.mesh.position.x, this.playerController.mesh.position.y + 0.5, this.playerController.mesh.position.z);

    f.state = FRAGMENT_STATES.SECURED;
    f.carrier = null;
    f.secureTime = 0;
    this.collectedCount += 1;

    playFragmentSecureSound();
    this.onSecured?.();
    return true;
  }

  _updateSecuring(deltaTime) {
    const f = this.fragment;
    f.secureTime += deltaTime;
    const t = Math.min(f.secureTime / GENOME_FRAGMENT_CONFIG.secureDuration, 1);
    f.mesh.scale.setScalar(Math.max(1 - t, 0.001));
    f.mesh.userData.coreMaterial.emissiveIntensity = THREE.MathUtils.lerp(1.4, 4, t);
    f.mesh.position.y += deltaTime * 0.6;

    if (t >= 1) {
      this.scene.remove(f.mesh);
      f.mesh.traverse((child) => {
        if (!child.material) return;
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      });
      this.uiManager.showGenomeFragmentSecured();
      this.uiManager.triggerGenomeFlash?.();
      this.fragment = null;
    }
  }
}
