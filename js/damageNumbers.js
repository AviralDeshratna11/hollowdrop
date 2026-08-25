import * as THREE from 'three';

export const DAMAGE_NUMBER_CONFIG = {
  lifetime: 0.75,
  riseWorldUnits: 1.1, // how far it drifts up in WORLD space over its lifetime
  // Entity mesh origins sit on the ground, so a number spawned at the raw hit
  // position starts UNDER the creature it belongs to. This lifts it clear of the body.
  baseHeight: 0.55,
  spawnJitter: 0.22,   // small horizontal scatter so stacked hits don't overlap exactly
  poolSize: 24,
};

const tempWorld = new THREE.Vector3();
const tempProject = new THREE.Vector3();

/**
 * Floating damage numbers.
 *
 * Their position is tracked in WORLD space and re-projected to the screen every frame,
 * rather than being placed once at spawn and animated in pixels. That matters here
 * because the camera follows the player continuously - a number pinned to screen
 * coordinates would visibly slide away from the enemy it belongs to the moment you
 * move, which is exactly when you're hitting things.
 *
 * Elements are pooled. This spawns during combat, and allocating/discarding DOM nodes
 * per hit is the kind of per-frame garbage this project avoids everywhere else (see
 * the reused scratch vectors throughout the controllers).
 */
export class DamageNumberController {
  constructor(camera, canvas, { poolSize = DAMAGE_NUMBER_CONFIG.poolSize } = {}) {
    this.camera = camera;
    this.canvas = canvas;

    this.container = document.createElement('div');
    this.container.id = 'damage-numbers';
    document.body.appendChild(this.container);

    this._pool = [];
    this._active = [];
    for (let i = 0; i < poolSize; i++) {
      const el = document.createElement('span');
      el.className = 'damage-number';
      this.container.appendChild(el);
      this._pool.push(el);
    }
  }

  /**
   * @param worldPosition THREE.Vector3 the hit happened at
   * @param amount        number shown
   * @param variant       'player' (damage the player dealt) | 'incoming' (damage taken)
   */
  spawn(worldPosition, amount, variant = 'player') {
    const el = this._pool.pop();
    if (!el) return; // pool exhausted - drop the number rather than allocate mid-combat

    const jitter = DAMAGE_NUMBER_CONFIG.spawnJitter;
    const entry = {
      el,
      origin: worldPosition.clone(),
      offsetX: (Math.random() - 0.5) * jitter * 2,
      offsetZ: (Math.random() - 0.5) * jitter * 2,
      elapsed: 0,
    };

    el.textContent = String(Math.round(amount));
    el.className = `damage-number damage-number--${variant}`;
    this._active.push(entry);
    this._position(entry, 0);
    el.classList.add('damage-number--visible');
  }

  _position(entry, t) {
    tempWorld.copy(entry.origin);
    tempWorld.x += entry.offsetX;
    tempWorld.z += entry.offsetZ;
    tempWorld.y += DAMAGE_NUMBER_CONFIG.baseHeight + DAMAGE_NUMBER_CONFIG.riseWorldUnits * t;

    tempProject.copy(tempWorld).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    const x = (tempProject.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (1 - (tempProject.y * 0.5 + 0.5)) * rect.height + rect.top;

    entry.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    // Hold full opacity for the first half, then fade - the number needs to be
    // readable before it starts disappearing.
    entry.el.style.opacity = t < 0.5 ? '1' : String(1 - (t - 0.5) / 0.5);
  }

  update(deltaTime) {
    for (let i = this._active.length - 1; i >= 0; i--) {
      const entry = this._active[i];
      entry.elapsed += deltaTime;
      const t = entry.elapsed / DAMAGE_NUMBER_CONFIG.lifetime;
      if (t >= 1) {
        entry.el.classList.remove('damage-number--visible');
        entry.el.style.opacity = '0';
        this._active.splice(i, 1);
        this._pool.push(entry.el);
        continue;
      }
      this._position(entry, t);
    }
  }

  /** Clears everything instantly - used by the Play Again reset so numbers from the
   *  previous run can't linger into the new one. */
  clear() {
    for (const entry of this._active) {
      entry.el.classList.remove('damage-number--visible');
      entry.el.style.opacity = '0';
      this._pool.push(entry.el);
    }
    this._active.length = 0;
  }
}
