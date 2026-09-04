import * as THREE from 'three';
import { RESOURCE_TYPES } from './resourceTypes.js?v=5.3';
import { createResourceMesh } from './resourceModels.js?v=5.3';
import { getTerrainHeight } from './terrain.js?v=5.4';

export const DEBUG_PROJECTILE = false;

export const PROJECTILE_CONFIG = {
  damage: 10,
  speed: 15,
  // Deliberately shorter than it looks: the camera sees roughly 14 units ahead, so a
  // rock that expires at 11 dies just inside the visible area rather than sailing off
  // into fog. Missing should be legible as a miss, not as the rock vanishing.
  maxRange: 11,
  cooldown: 0.45,
  // Collision radius of the rock itself. The enemy's own girth is added on top
  // (targetRadius) because entities expose position but not a hitbox - see _hitCheck.
  radius: 0.22,
  targetRadius: 0.55,
  // How far in front of the player the rock appears. Just outside PLAYER_RADIUS (0.6)
  // so it never spawns visually inside the body it was launched from.
  spawnOffset: 0.72,
  spawnHeight: 0.55, // ABOVE the terrain at that point, not an absolute world Y
  spinSpeed: 9,
  knockbackForce: 0.5,
  // Visual scale relative to the resource's own modelScale. Bigger than the inventory
  // copy (which is shrunk to fit inside the body) so it reads at throwing distance.
  visualScale: 0.85,
};

export const AUTO_AIM_CONFIG = {
  // "Close proximity, but not that close" - inside the projectile's own 11-unit range so
  // an acquired target is always actually reachable, but short enough that the reticle
  // does not chase things across the whole visible field.
  acquireRange: 9,
  // Normalised-device-coordinate bound for the on-screen test. Slightly over 1 so a
  // target hovering exactly at the screen edge doesn't unlock/relock every frame.
  screenBound: 1.08,
  // Lock is released if the player stops shooting for this long, so walking away from a
  // fight and turning to a new one doesn't require the old target to leave the screen.
  idleUnlockTime: 3.0,
  // Subtracted from a candidate's effective distance when its source declares itself
  // dangerous (see aimPriority in main.js). Large enough that the Apex 8 units away
  // outranks a Glow Beetle at 3 - during a boss fight, wandering prey must not steal
  // the lock - but not so large that prey becomes unselectable when nothing else is near.
  threatBonus: 6,
  // Exponential smoothing on estimated target velocity. Raw frame-to-frame deltas are
  // noisy enough (especially with hitstop scaling deltaTime) to swing the lead point
  // around visibly.
  velocitySmoothing: 8,
  reticleRadius: 0.62,
  reticleColor: 0xc8ccd4,
  reticleLockedColor: 0xff6b6b,
};

/**
 * Resource types that can be thrown. Deliberately NOT "everything in the inventory":
 *
 *   - spore / mushroom are food, and MetabolismSystem's consume action is the only
 *     way to recover energy - firing those away would let the player delete their own
 *     survival resource by pressing the attack button.
 *   - every *_dna, toxic_spore and toxic_gland is a mutation ingredient; throwing one
 *     would silently destroy progression toward a recipe the player is collecting for.
 *
 * What is left is exactly stone and iron: heavy, inedible, worth little, and useful for
 * nothing except weighing Hollowdrop down. Before this system they were pure penalty -
 * something you picked up by accident and then had to find the wheel to drop. Making
 * them the ammunition turns the burden into a resource, which is the whole point.
 */
export const AMMO_TYPES = ['stone', 'iron'];

const tempForward = new THREE.Vector3();
const tempToTarget = new THREE.Vector3();
const tempAim = new THREE.Vector3();
const tempProjected = new THREE.Vector3();
const tempDelta = new THREE.Vector3();

function playThrowSound() {}
function playImpactSound() {}

/**
 * Owns thrown-rock projectiles: target acquisition, firing (which spends an inventory
 * item), flight, the hit check, and impact.
 *
 * Knows nothing about any specific enemy. Like PlayerCombatController it damages
 * through the shared damageable-entity interface - each source in `damageableSources`
 * exposes getDamageableEntities(), and each entity exposes takeDamage(amount, info)
 * and a `.mesh`. Registering a new enemy means adding it to that array in main.js and
 * nothing here changes. The only extra thing this system reads is an optional
 * `aimPriority` on the source itself (see _score), which is how "prefer the boss over
 * a passing beetle" is expressed without branching on entity type.
 *
 * Projectiles live in world space, parented to the scene rather than the player, so
 * they keep flying independently once released.
 */
export class ProjectileSystem {
  constructor({ scene, camera, playerController, inventoryManager, damageableSources, uiManager }) {
    this.scene = scene;
    this.camera = camera;
    this.playerController = playerController;
    this.inventoryManager = inventoryManager;
    this.damageableSources = damageableSources;
    this.uiManager = uiManager;

    this.projectiles = [];
    this._cooldownTimer = 0;
    this._available = false;

    // --- Auto-aim state
    // The entity a shot would go to right now (shown by the reticle), versus the entity
    // shots are committed to. They are the same object once the player has fired: the
    // candidate is what acquisition proposes, the lock is what it confirmed.
    this._candidate = null;
    this._lockedTarget = null;
    this._timeSinceFire = 0;
    // entity -> { position, velocity }. Velocity is estimated here rather than read off
    // the entity because no enemy in this game exposes one, and adding that to four
    // separate AI classes to serve one feature is the wrong trade.
    this._tracks = new Map();

    this._reticle = this._createReticle();
    this.scene.add(this._reticle);

    // Optional feedback hooks, assigned post-construction in main.js - the same wiring
    // pattern PlayerCombatController uses, so this class never imports screen shake,
    // hitstop or damage numbers.
    this.onHit = null;     // (entity, damage, worldPosition)
    this.onFired = null;   // (item)
    this.onImpact = null;  // (worldPosition, hitSomething)
  }

  /** Flat ring on the ground under the target. World-space rather than a projected DOM
   *  element (the route damage numbers take) because in a fixed top-down view a ring on
   *  the floor sits naturally in the scene, needs no per-frame projection math, and is
   *  occluded correctly by nothing - there is nothing to occlude it. */
  _createReticle() {
    const geometry = new THREE.RingGeometry(
      AUTO_AIM_CONFIG.reticleRadius * 0.78,
      AUTO_AIM_CONFIG.reticleRadius,
      28
    );
    const material = new THREE.MeshBasicMaterial({
      color: AUTO_AIM_CONFIG.reticleColor,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 5;
    mesh.visible = false;
    return mesh;
  }

  /** Inventory items that are throwable, heaviest first - firing spends the heaviest
   *  rock available, which relieves the most burden per press. Iron (3) before
   *  Stone (2) is also the intuitive read: you throw the big one first. */
  getAmmo() {
    return this.inventoryManager.items
      .filter((item) => AMMO_TYPES.includes(item.type))
      .sort((a, b) => b.weight - a.weight);
  }

  getAmmoCount() {
    return this.getAmmo().length;
  }

  canFire() {
    return this._available && this._cooldownTimer <= 0 && this.getAmmoCount() > 0;
  }

  /** The entity shots currently go to: the confirmed lock if there is one, otherwise
   *  whatever acquisition is proposing. Exposed for tests/debug. */
  getTarget() {
    return this._lockedTarget || this._candidate;
  }

  /** Shows/hides the throw button and hard-cancels availability. Driven every frame
   *  from main.js by the same `canAct` authority that gates Bite and the wheel. */
  setAvailable(available) {
    if (available === this._available) return;
    this._available = available;
    if (available) {
      this.uiManager?.showThrowButton(() => this.fire());
    } else {
      this.uiManager?.hideThrowButton();
      // Nothing should stay locked while the player cannot act - a reticle left hanging
      // over a beetle through death, mutation or the title screen reads as a live aim.
      this._releaseLock();
      this._candidate = null;
      this._reticle.visible = false;
    }
  }

  // --- Targeting ------------------------------------------------------------------

  /** Every damageable entity, tagged with the aim priority its source declares. */
  *_candidates() {
    for (const source of this.damageableSources) {
      const priority = source.aimPriority ?? 0;
      for (const entity of source.getDamageableEntities()) yield { entity, priority };
    }
  }

  /** True while the entity is somewhere the player can actually see it. This is the rule
   *  that releases a lock, and it is deliberately screen-based rather than distance-based:
   *  "it left the screen" is a thing the player watches happen, so the lock breaking at
   *  that moment needs no explanation. */
  _isOnScreen(entity) {
    if (!entity.mesh?.parent || !entity.mesh.visible) return false;
    entity.mesh.getWorldPosition(tempProjected).project(this.camera);
    const bound = AUTO_AIM_CONFIG.screenBound;
    return Math.abs(tempProjected.x) <= bound && Math.abs(tempProjected.y) <= bound;
  }

  /** Per-frame velocity estimate for everything damageable, by differencing positions.
   *  Also garbage-collects tracks for entities that have died or despawned, which is
   *  what keeps this Map from growing across a long run. */
  _updateTracks(deltaTime) {
    if (deltaTime <= 0) return;
    const seen = new Set();

    for (const { entity } of this._candidates()) {
      seen.add(entity);
      const track = this._tracks.get(entity);
      if (!track) {
        this._tracks.set(entity, {
          position: entity.mesh.position.clone(),
          velocity: new THREE.Vector3(),
        });
        continue;
      }
      tempDelta.copy(entity.mesh.position).sub(track.position).divideScalar(deltaTime);
      const blend = 1 - Math.exp(-AUTO_AIM_CONFIG.velocitySmoothing * deltaTime);
      track.velocity.lerp(tempDelta, blend);
      track.position.copy(entity.mesh.position);
    }

    for (const entity of this._tracks.keys()) {
      if (!seen.has(entity)) this._tracks.delete(entity);
    }
  }

  /** Lower is better. Straight-line distance, minus a bonus for sources that declared
   *  themselves dangerous - so the thing that can kill you outranks the thing that
   *  happens to be nearer. */
  _score(entity, priority) {
    const distance = entity.mesh.position.distanceTo(this.playerController.mesh.position);
    if (distance > AUTO_AIM_CONFIG.acquireRange) return Infinity;
    if (!this._isOnScreen(entity)) return Infinity;
    return distance - priority * AUTO_AIM_CONFIG.threatBonus;
  }

  _releaseLock() {
    this._lockedTarget = null;
  }

  _updateTargeting(deltaTime) {
    this._timeSinceFire += deltaTime;

    // A lock survives everything except the target leaving (dying, despawning, or going
    // off screen) and the player losing interest. Notably it does NOT require the target
    // to stay damageable: the Apex drops out of its damageable states between attacks,
    // and releasing the lock every time it does would make it impossible to hold.
    if (this._lockedTarget) {
      const gone = !this._isOnScreen(this._lockedTarget);
      const stale = this._timeSinceFire > AUTO_AIM_CONFIG.idleUnlockTime;
      if (gone || stale) this._releaseLock();
    }

    let best = null;
    let bestScore = Infinity;
    for (const { entity, priority } of this._candidates()) {
      const score = this._score(entity, priority);
      if (score < bestScore) {
        bestScore = score;
        best = entity;
      }
    }
    this._candidate = best;

    const target = this.getTarget();
    if (target && this._available) {
      this._reticle.visible = true;
      // Lifted onto the terrain under the target - at a fixed low Y the ring vanished
      // inside any raised ground, which is exactly where a boss fight tends to happen.
      this._reticle.position.set(
        target.mesh.position.x,
        getTerrainHeight(target.mesh.position.x, target.mesh.position.z) + 0.08,
        target.mesh.position.z
      );
      const locked = target === this._lockedTarget;
      this._reticle.material.color.setHex(
        locked ? AUTO_AIM_CONFIG.reticleLockedColor : AUTO_AIM_CONFIG.reticleColor
      );
      this._reticle.material.opacity = locked ? 0.85 : 0.4;
      this._reticle.scale.setScalar(locked ? 1 : 0.88);
    } else {
      this._reticle.visible = false;
    }
  }

  /**
   * Where to throw so the rock and the target arrive at the same place at the same time.
   *
   * Without this, auto-aim would still miss nearly everything that moves: at the 9-unit
   * acquire range a rock is in the air for ~0.6s, during which a fleeing Glow Beetle
   * (6.3 u/s) travels almost 4 units and a charging Murkmaw (9.0 u/s) nearly 5.5 -
   * many times the hit radius. Aiming at the target's current position is aiming at
   * where it used to be.
   *
   * Solves |D + Vt| = st for t, where D is the offset to the target, V its velocity and
   * s the projectile speed. Expanded that is the quadratic
   * (V.V - s.s)t^2 + 2(D.V)t + D.D = 0. Falls back to the target's present position when
   * there is no positive solution, which happens when the target is outrunning the rock
   * directly away - in that case the shot cannot land and aiming straight at it is both
   * the closest miss and the most readable one.
   */
  _solveAimPoint(target, from, out) {
    const track = this._tracks.get(target);
    out.copy(target.mesh.position);
    if (!track) return out;

    const speed = PROJECTILE_CONFIG.speed;
    tempDelta.copy(target.mesh.position).sub(from);
    tempDelta.y = 0;
    const velocity = track.velocity;

    const a = velocity.lengthSq() - speed * speed;
    const b = 2 * tempDelta.dot(velocity);
    const c = tempDelta.lengthSq();

    let t = -1;
    if (Math.abs(a) < 1e-4) {
      // Target closing/receding at almost exactly projectile speed - the quadratic
      // degenerates to a linear equation.
      if (Math.abs(b) > 1e-6) t = -c / b;
    } else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        const t1 = (-b - root) / (2 * a);
        const t2 = (-b + root) / (2 * a);
        // Smallest positive root - the earliest interception.
        const positives = [t1, t2].filter((v) => v > 0);
        if (positives.length) t = Math.min(...positives);
      }
    }

    if (t > 0) out.addScaledVector(velocity, t);
    return out;
  }

  fire() {
    if (!this.canFire()) return false;

    const item = this.getAmmo()[0];
    const type = item.type;
    const config = RESOURCE_TYPES[type];

    // The press is what commits to a target: acquisition only ever proposes one (and
    // shows it under the reticle), so the first shot of an engagement confirms what the
    // player is already looking at rather than picking blind on their behalf.
    if (!this._lockedTarget && this._candidate) this._lockedTarget = this._candidate;
    this._timeSinceFire = 0;

    // Aim direction is independent of which way the body faces, so the player can
    // retreat and throw backwards - on a thumbstick, having to point the movement
    // control at a target in order to hit it is the same as not being able to dodge.
    const target = this._lockedTarget;
    if (target) {
      this._solveAimPoint(target, this.playerController.mesh.position, tempAim);
      tempForward.copy(tempAim).sub(this.playerController.mesh.position);
      tempForward.y = 0;
      if (tempForward.lengthSq() < 1e-6) this.playerController.getForwardDirection(tempForward);
      else tempForward.normalize();
    } else {
      // Nothing acquired - fall back to throwing where the body faces, so the button is
      // never dead just because the area happens to be empty.
      this.playerController.getForwardDirection(tempForward);
    }

    // Spend it FIRST. removeItem() subtracts the weight, so the burden lifts on the
    // press rather than on impact - the player feels lighter the instant they throw,
    // which is what makes this read as "dumping ballast" and not just "an attack".
    this.inventoryManager.removeItem(item.id);
    this._cooldownTimer = PROJECTILE_CONFIG.cooldown;

    const mesh = createResourceMesh(type, config.color);
    mesh.scale.setScalar(config.modelScale * PROJECTILE_CONFIG.visualScale);
    mesh.position
      .copy(this.playerController.mesh.position)
      .addScaledVector(tempForward, PROJECTILE_CONFIG.spawnOffset);
    // Height is relative to the ground beneath, not absolute: the cavern floor has real
    // elevation (see terrain.js), so a fixed world Y put rocks underground wherever the
    // player was standing on high ground - which is most of the map.
    mesh.position.y = getTerrainHeight(mesh.position.x, mesh.position.z) + PROJECTILE_CONFIG.spawnHeight;
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      velocity: tempForward.clone().multiplyScalar(PROJECTILE_CONFIG.speed),
      travelled: 0,
      // Random tumble axis so two rocks thrown back to back don't spin identically.
      spinAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
    });

    playThrowSound();
    this.onFired?.(item);
    if (DEBUG_PROJECTILE) console.log('Threw', type, '- ammo left', this.getAmmoCount());
    return true;
  }

  update(deltaTime) {
    if (this._cooldownTimer > 0) this._cooldownTimer -= deltaTime;

    this._updateTracks(deltaTime);
    this._updateTargeting(deltaTime);

    if (this._available) {
      this.uiManager?.updateThrowState(
        this.getAmmoCount(),
        Math.max(0, this._cooldownTimer),
        PROJECTILE_CONFIG.cooldown,
        this.canFire()
      );
    }

    // Reverse iteration: _destroy() splices, and walking backwards keeps the
    // remaining indices valid without a second pass.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = PROJECTILE_CONFIG.speed * deltaTime;

      p.mesh.position.addScaledVector(p.velocity, deltaTime);
      // Re-seat on the terrain every frame rather than flying a flat line, so a rock
      // thrown across a rise stays visible over it instead of disappearing into it. The
      // hit check below is XZ-only, so this is purely how the throw reads.
      p.mesh.position.y = getTerrainHeight(p.mesh.position.x, p.mesh.position.z) + PROJECTILE_CONFIG.spawnHeight;
      p.mesh.rotateOnAxis(p.spinAxis, PROJECTILE_CONFIG.spinSpeed * deltaTime);
      p.travelled += step;

      const hit = this._hitCheck(p);
      if (hit) {
        hit.takeDamage(PROJECTILE_CONFIG.damage, {
          sourceEntity: this.playerController,
          sourceType: 'player',
          attackType: 'thrown_rock',
          knockbackForce: PROJECTILE_CONFIG.knockbackForce,
        });
        playImpactSound();
        this.onHit?.(hit, PROJECTILE_CONFIG.damage, p.mesh.position);
        this.onImpact?.(p.mesh.position, true);
        this._destroy(i);
        continue;
      }

      if (p.travelled >= PROJECTILE_CONFIG.maxRange) {
        this.onImpact?.(p.mesh.position, false);
        this._destroy(i);
      }
    }
  }

  /** First damageable entity overlapping this projectile, or null. Distance is measured
   *  on XZ only: everything in this game walks on one ground plane, and the rock's
   *  fixed flight height would otherwise make it miss taller or shorter enemies for
   *  reasons the player cannot see. */
  _hitCheck(projectile) {
    const reach = PROJECTILE_CONFIG.radius + PROJECTILE_CONFIG.targetRadius;
    const reachSq = reach * reach;

    for (const source of this.damageableSources) {
      for (const entity of source.getDamageableEntities()) {
        tempToTarget.copy(entity.mesh.position).sub(projectile.mesh.position);
        tempToTarget.y = 0;
        if (tempToTarget.lengthSq() <= reachSq) return entity;
      }
    }
    return null;
  }

  _destroy(index) {
    const [p] = this.projectiles.splice(index, 1);
    this.scene.remove(p.mesh);
    p.mesh.traverse((child) => {
      if (!child.material) return;
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    });
  }

  /** Full reset for a brand-new run (Play Again) - clears rocks still in the air, which
   *  would otherwise survive into the next run and damage freshly spawned enemies, plus
   *  every scrap of targeting state (tracks key off entity objects that no longer exist
   *  after the world is rebuilt). */
  reset() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) this._destroy(i);
    this._cooldownTimer = 0;
    this._releaseLock();
    this._candidate = null;
    this._tracks.clear();
    this._timeSinceFire = 0;
    this._reticle.visible = false;
  }
}
