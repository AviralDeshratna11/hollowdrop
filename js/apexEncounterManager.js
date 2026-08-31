import { buildArenaDressing } from './worldDressing.js?v=5.3';

/**
 * Owns the one-time "player entered Apex territory" trigger. Everything about the
 * encounter itself (intro, combat, phases, death) is ApexController's job - this
 * class only decides WHEN to call startEncounter(), plus the arena's decorative
 * dressing so the territory reads as dangerous even before it fires.
 */
export class ApexEncounterManager {
  constructor(scene, playerController, apexController, { arenaCenter, arenaRadius, triggerRadius }) {
    this.playerController = playerController;
    this.apexController = apexController;
    this.arenaCenter = arenaCenter.clone();
    this.triggerRadiusSq = triggerRadius ** 2;
    this.hasTriggered = false; // fires exactly once, ever - re-entering afterward never re-runs the intro

    // Placements are kept so main.js can make the arena's boulders solid - the same
    // treatment the wider map's scatter gets.
    this.dressingRocks = buildArenaDressing(scene, this.arenaCenter, arenaRadius).rocks;
  }

  /** Full reset for a brand-new run (Play Again) - the one-time trigger fires again
   *  next run. Arena dressing is permanent decoration, never rebuilt. */
  reset() {
    this.hasTriggered = false;
  }

  update() {
    if (this.hasTriggered) return;
    const dx = this.playerController.mesh.position.x - this.arenaCenter.x;
    const dz = this.playerController.mesh.position.z - this.arenaCenter.z;
    if (dx * dx + dz * dz < this.triggerRadiusSq) {
      this.hasTriggered = true;
      this.apexController.startEncounter();
    }
  }
}
