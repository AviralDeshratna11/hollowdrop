import * as THREE from 'three';

/**
 * Circle-based collision for the player against solid world objects.
 *
 * Everything here is 2D in the XZ plane. This game is played from a fixed top-down
 * camera on flat ground, and every solid thing in it is roughly round from above, so
 * circles are not an approximation worth apologising for - they are the actual shape.
 * A physics engine, or even swept AABBs, would be far more machinery than the problem
 * needs.
 *
 * Resolution is push-out plus slide: the player is pushed to the surface of whatever
 * they overlap, and only the component of their velocity pointing INTO the obstacle is
 * removed. That means you glance off a boulder and keep moving along it rather than
 * stopping dead, which matters a lot for something that controls like a slime.
 *
 * Static colliders (stones) are registered once. Dynamic ones (the Murkmaw's body) are
 * supplied by provider functions each frame, since those move constantly.
 *
 * NOTE ON WHO COLLIDES: the player only. Creatures still pass through everything. They
 * steer with simple seek/flee behaviour and no pathfinding, so making them solid would
 * mean they could wedge themselves against a rock and never recover.
 */

const tempWorld = new THREE.Vector3();

export class CollisionSystem {
  constructor() {
    this.staticColliders = [];
    this._providers = [];
    this._scratch = [];
  }

  /** @param radius the SOLID radius, which is usually smaller than the visual one -
   *  being able to brush past a rock feels better than catching on its silhouette. */
  addStatic(x, z, radius) {
    this.staticColliders.push({ x, z, radius });
  }

  /** Registers a function returning an array of { x, z, radius } in world space,
   *  re-queried every frame. Used for anything that moves. */
  addDynamicProvider(fn) {
    this._providers.push(fn);
  }

  clearStatic() {
    this.staticColliders.length = 0;
  }

  /** True if a circle at (x, z) with `radius` overlaps NO collider (static or dynamic) -
   *  a read-only query for placement validation (random respawn, dropped-item scatter),
   *  distinct from resolve() which mutates a position. Re-queries dynamic providers so it
   *  reflects moving colliders (e.g. the Murkmaw body) at call time. */
  isClear(x, z, radius) {
    for (const c of this.staticColliders) {
      const dx = x - c.x;
      const dz = z - c.z;
      const min = radius + c.radius;
      if (dx * dx + dz * dz < min * min) return false;
    }
    for (const provider of this._providers) {
      const list = provider();
      if (!list) continue;
      for (const c of list) {
        const dx = x - c.x;
        const dz = z - c.z;
        const min = radius + c.radius;
        if (dx * dx + dz * dz < min * min) return false;
      }
    }
    return true;
  }

  /**
   * Pushes `position` out of every overlapping collider and cancels the part of
   * `velocity` heading into them.
   *
   * Runs a few iterations because resolving one overlap can create another - the
   * classic case being a corner between two rocks, where pushing out of the first
   * shoves you into the second. Three passes settles essentially every real case, and
   * bailing out early when nothing moved makes the common case (no contact) nearly free.
   */
  resolve(position, radius, velocity) {
    this._scratch.length = 0;
    for (const provider of this._providers) {
      const list = provider();
      if (list) for (const c of list) this._scratch.push(c);
    }

    for (let pass = 0; pass < 3; pass++) {
      let moved = false;

      for (let i = 0; i < this.staticColliders.length + this._scratch.length; i++) {
        const c = i < this.staticColliders.length
          ? this.staticColliders[i]
          : this._scratch[i - this.staticColliders.length];

        const dx = position.x - c.x;
        const dz = position.z - c.z;
        const minDist = radius + c.radius;
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDist * minDist) continue;

        const dist = Math.sqrt(distSq);
        // Dead centre: no meaningful normal exists, so pick one arbitrarily rather than
        // dividing by zero. Only reachable if something spawns exactly on the player.
        let nx = 1;
        let nz = 0;
        if (dist > 1e-5) {
          nx = dx / dist;
          nz = dz / dist;
        }

        position.x = c.x + nx * minDist;
        position.z = c.z + nz * minDist;
        moved = true;

        if (velocity) {
          // Remove only the inward component - the tangential part survives, which is
          // what turns a head-on stop into a slide along the surface.
          const into = velocity.x * nx + velocity.z * nz;
          if (into < 0) {
            velocity.x -= into * nx;
            velocity.z -= into * nz;
          }
        }
      }

      if (!moved) break;
    }
  }
}

/** Reads live world positions off a list of Object3Ds. Shared by anything that wants to
 *  turn moving meshes into colliders without each caller rewriting the projection. */
export function collidersFromObjects(objects, radiusFor) {
  const out = [];
  for (let i = 0; i < objects.length; i++) {
    objects[i].getWorldPosition(tempWorld);
    out.push({ x: tempWorld.x, z: tempWorld.z, radius: radiusFor(i) });
  }
  return out;
}
