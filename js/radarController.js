import { RESOURCE_TYPES } from './resourceTypes.js';
import { FRAGMENT_STATES } from './genomeFragmentController.js';

export const DEBUG_RADAR = false;

// Centralized so nothing below scatters its own magic numbers - every detection
// distance, cap, and threshold the radar uses lives here.
export const RADAR_CONFIG = {
  detectionRadius: 20, // DNA + normal enemies - also the normalization reference every blip's radar-space position is scaled against
  bossDetectionRadius: 35,
  genomeDetectionRadius: 35,
  rivalDetectionRadius: 30,
  updateInterval: 0.1, // ~10Hz target scan - gameplay runs at 60, the radar doesn't need to (spec section 36)
  maxBlips: 15,
  maxDnaBlips: 5, // nearest N only, even if many more are in range (spec section 26/72)
  closeEnemyDistance: 5, // "very close" hostile warning threshold (spec section 30)
};

export const RADAR_TARGET_TYPES = {
  ENEMY: 'enemy',
  BOSS: 'boss',
  DNA: 'dna',
  GENOME: 'genome',
  RIVAL: 'rival',
};

// Higher wins ties are broken by distance (closer first) - see _scan(). Rival gets a
// further boost while it's actually carrying the Fragment (spec section 71).
const BASE_PRIORITY = {
  [RADAR_TARGET_TYPES.GENOME]: 5,
  [RADAR_TARGET_TYPES.RIVAL]: 4,
  [RADAR_TARGET_TYPES.BOSS]: 3,
  [RADAR_TARGET_TYPES.ENEMY]: 2,
  [RADAR_TARGET_TYPES.DNA]: 1,
};

/** Squared XZ distance - every detection check in this file uses this, never a real
 *  sqrt, until the one point a display-facing number is actually needed (getBlips()). */
function horizontalDistanceSq(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/**
 * Species-Seeker Radar - pure logic/data half (see radarHUD.js for the DOM it feeds).
 *
 * Reads live state directly off the existing controllers every scan (predatorController,
 * apexController, rivalController, genomeFragmentController, resourceManager) rather
 * than duplicating any of it - this class owns no gameplay state of its own beyond its
 * own detection memory and the scan-rate timer. Scans at RADAR_CONFIG.updateInterval,
 * not every frame (spec section 36/80) - update() just counts down to the next one and
 * otherwise no-ops, so calling it every frame from the main loop is cheap.
 */
export class RadarController {
  constructor({ player, predatorController, apexController, rivalController, genomeFragmentController, resourceManager }) {
    this.player = player;
    this.predatorController = predatorController;
    this.apexController = apexController;
    this.rivalController = rivalController;
    this.genomeFragmentController = genomeFragmentController;
    this.resourceManager = resourceManager;

    this.enabled = true;
    this._scanTimer = 0;
    this._blips = []; // latest computed frame - see getBlips()
    // Entities detected on the PREVIOUS scan. Replaced (not merged) each scan, which is
    // what makes "leaves range, comes back" ping again naturally (spec section 33) - an
    // id absent from the new set is, by construction, either gone or was never seen.
    this._detectedIds = new Set();
  }

  /** Spec section 56/79 - skip scanning entirely outside PLAYING (also zeroes the blip
   *  list immediately, so the HUD can't keep drawing stale positions while hidden). */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this._blips = [];
  }

  update(deltaTime) {
    if (!this.enabled) return;
    this._scanTimer -= deltaTime;
    if (this._scanTimer > 0) return;
    this._scanTimer = RADAR_CONFIG.updateInterval;
    this._scan();
  }

  /** Last computed blip list (already sorted by priority/distance and capped at
   *  maxBlips) - RadarHUD reads this every frame and interpolates toward it smoothly,
   *  so the 10Hz scan never reads as blips visibly jumping. */
  getBlips() {
    return this._blips;
  }

  /** Highest-priority, nearest-if-tied blip, or null - the one thing the compact radar's
   *  single-line readout shows (spec sections 24-25/67-68). */
  getNearestSignal() {
    return this._blips.length > 0 ? this._blips[0] : null;
  }

  reset() {
    this._blips = [];
    this._detectedIds.clear();
    this._scanTimer = 0;
  }

  _scan() {
    const targets = this.collectTargets();

    targets.sort((a, b) => (a.priority !== b.priority ? b.priority - a.priority : a.distanceSq - b.distanceSq));
    const limited = targets.slice(0, RADAR_CONFIG.maxBlips);

    const nowDetected = new Set();
    const blips = [];
    for (const target of limited) {
      nowDetected.add(target.id);
      const radar = this.worldToRadar(target.position, target.clampToEdge);
      if (!radar) continue; // defensive - collectTargets() already range-filters
      blips.push({
        id: target.id,
        type: target.type,
        x: radar.x,
        y: radar.y,
        clamped: radar.clamped,
        distance: Math.sqrt(target.distanceSq),
        label: target.label,
        priority: target.priority,
        close: target.type === RADAR_TARGET_TYPES.ENEMY && target.distanceSq < RADAR_CONFIG.closeEnemyDistance ** 2,
        chasing: !!target.chasing,
        carryingGenome: !!target.carryingGenome,
        firstDetection: !this._detectedIds.has(target.id),
      });
    }
    this._detectedIds = nowDetected;
    this._blips = blips;

    if (DEBUG_RADAR) {
      console.log(
        `[radar] ${blips.length} target(s): ` +
          blips.map((b) => `${b.type}:${b.label ?? b.id}@${b.distance.toFixed(1)}m`).join(', ')
      );
    }
  }

  /** One flat array of raw targets (world position + squared distance + priority +
   *  edge-clamp preference), independent of the radar-space math - kept separate from
   *  _scan() so acceptance testing / DEBUG_RADAR can inspect it directly if needed. */
  collectTargets() {
    const targets = [];
    const px = this.player.position.x;
    const pz = this.player.position.z;

    // --- Predator (Cave Stalker) - a single instance in this prototype, not a managed
    // list, so this is a direct check rather than a loop over a collection. ---------
    const predator = this.predatorController;
    if (predator && predator.mesh && predator.mesh.visible && predator.state !== 'DEAD') {
      const distanceSq = horizontalDistanceSq(predator.mesh.position.x, predator.mesh.position.z, px, pz);
      if (distanceSq < RADAR_CONFIG.detectionRadius ** 2) {
        const chasing = predator.state === 'CHASE' || predator.state === 'ATTACK';
        targets.push({
          id: 'predator',
          type: RADAR_TARGET_TYPES.ENEMY,
          position: predator.mesh.position,
          distanceSq,
          clampToEdge: false,
          label: 'Cave Stalker',
          chasing,
          priority: BASE_PRIORITY[RADAR_TARGET_TYPES.ENEMY],
        });
      }
    }

    // --- Apex Boss (Murkmaw) ---------------------------------------------------------
    const apex = this.apexController;
    if (apex && apex.mesh && apex.mesh.visible && apex.state !== 'DORMANT' && apex.state !== 'DEAD') {
      const distanceSq = horizontalDistanceSq(apex.mesh.position.x, apex.mesh.position.z, px, pz);
      if (distanceSq < RADAR_CONFIG.bossDetectionRadius ** 2) {
        targets.push({
          id: 'apex',
          type: RADAR_TARGET_TYPES.BOSS,
          position: apex.mesh.position,
          distanceSq,
          clampToEdge: true, // spec section 22 - boss keeps an edge indicator even past range
          label: 'Murkmaw',
          priority: BASE_PRIORITY[RADAR_TARGET_TYPES.BOSS],
        });
      }
    }

    // --- Rival Slime / Fire Lizard ----------------------------------------------------
    const rival = this.rivalController;
    const fragment = this.genomeFragmentController.fragment;
    if (rival && rival.isAlive()) {
      const distanceSq = horizontalDistanceSq(rival.mesh.position.x, rival.mesh.position.z, px, pz);
      if (distanceSq < RADAR_CONFIG.rivalDetectionRadius ** 2) {
        const carryingGenome = fragment?.state === FRAGMENT_STATES.CARRIED_BY_RIVAL;
        targets.push({
          id: 'rival',
          type: RADAR_TARGET_TYPES.RIVAL,
          position: rival.mesh.position,
          distanceSq,
          clampToEdge: true,
          label: carryingGenome ? 'Rival + Genome' : 'Rival',
          carryingGenome,
          // Boosted priority while carrying the Fragment (spec section 71) - it becomes
          // the single most urgent thing to chase, above even a freshly-exposed Fragment
          // would be (there is no exposed Fragment blip in that state anyway - see below).
          priority: carryingGenome ? BASE_PRIORITY[RADAR_TARGET_TYPES.RIVAL] + 0.5 : BASE_PRIORITY[RADAR_TARGET_TYPES.RIVAL],
        });
      }
    }

    // --- Human Genome Fragment ---------------------------------------------------------
    // CARRIED_BY_PLAYER and SECURED are deliberately absent (spec section 13/45): a
    // carried-by-player Fragment isn't a remote target, and a secured one no longer
    // exists. CARRIED_BY_RIVAL is also absent here - it's already represented by the
    // Rival blip above, and showing both would put two blips on the exact same position
    // (spec section 14 explicitly rules this out).
    if (fragment && fragment.state !== FRAGMENT_STATES.CARRIED_BY_PLAYER && fragment.state !== FRAGMENT_STATES.SECURED
      && fragment.state !== FRAGMENT_STATES.CARRIED_BY_RIVAL) {
      const distanceSq = horizontalDistanceSq(fragment.mesh.position.x, fragment.mesh.position.z, px, pz);
      if (distanceSq < RADAR_CONFIG.genomeDetectionRadius ** 2) {
        targets.push({
          id: 'genome',
          type: RADAR_TARGET_TYPES.GENOME,
          position: fragment.mesh.position,
          distanceSq,
          clampToEdge: true,
          label: 'Genome Fragment',
          priority: BASE_PRIORITY[RADAR_TARGET_TYPES.GENOME],
        });
      }
    }

    // --- DNA resources ------------------------------------------------------------
    // Filters on the SAME metadata ResourceManager already carries (resourceTypes.js's
    // `category`) rather than a second hardcoded list - Stone/Iron/Moon Mushroom have no
    // category at all and are excluded by construction, not by name-checking them out.
    const dnaCandidates = [];
    for (const resource of this.resourceManager.resources) {
      const config = RESOURCE_TYPES[resource.type];
      if (config?.category !== 'dna') continue;
      if (resource.state === 'absorbing') continue; // already being consumed - about to vanish, not worth a blip
      const distanceSq = horizontalDistanceSq(resource.mesh.position.x, resource.mesh.position.z, px, pz);
      if (distanceSq < RADAR_CONFIG.detectionRadius ** 2) {
        dnaCandidates.push({
          id: `resource_${resource.id}`,
          type: RADAR_TARGET_TYPES.DNA,
          position: resource.mesh.position,
          distanceSq,
          clampToEdge: false,
          label: config.name,
          priority: BASE_PRIORITY[RADAR_TARGET_TYPES.DNA],
        });
      }
    }
    dnaCandidates.sort((a, b) => a.distanceSq - b.distanceSq);
    targets.push(...dnaCandidates.slice(0, RADAR_CONFIG.maxDnaBlips));

    return targets;
  }

  /**
   * World XZ offset -> radar-space position in NORTH-UP / world-locked orientation, and,
   * for edge-clamped target types, pinned just inside the rim rather than dropped once
   * they exceed `detectionRadius` (spec section 23).
   *
   * The dial itself never rotates: world +X is always radar-right and world +Z always
   * radar-down (CSS y grows downward), so (dx, dz) maps straight to (screenX, screenY)
   * with no heading rotation. A target dead north of the player lands at (0, -1), one
   * due east at (+1, 0). The player's own facing is conveyed by rotating the centre
   * marker instead (RadarHUD._updatePlayerMarker) rather than by counter-rotating the
   * whole world under a fixed marker.
   *
   * @returns {{x:number, y:number, clamped:boolean}} x/y in -1..1 (radar-radius units),
   *   or null if out of range and not eligible for edge-clamping.
   */
  worldToRadar(position, clampToEdge) {
    const dx = position.x - this.player.position.x;
    const dz = position.z - this.player.position.z;

    const range = RADAR_CONFIG.detectionRadius;
    let nx = dx / range;
    let ny = dz / range;
    const dist = Math.hypot(nx, ny);
    let clamped = false;
    if (dist > 1) {
      if (!clampToEdge) return null; // caller already range-filtered on its own radius; this only matters when that radius exceeds detectionRadius (boss/genome/rival)
      nx /= dist;
      ny /= dist;
      clamped = true;
    }
    return { x: nx, y: ny, clamped };
  }
}
