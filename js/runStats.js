/**
 * Plain-data run statistics - counters other systems report into via optional hooks
 * (onDefeated/onSpawned/onAbsorbed/onPlayerDeath, see main.js's wiring) rather than
 * this module ever reaching out and counting anything itself. Only tracks numbers
 * that are already trivial/reliable to derive from existing events (spec section 22-23) -
 * no separate analytics system.
 */
export function createRunStats() {
  return {
    runStartTime: 0,
    resourcesAbsorbed: 0,
    preyDefeated: 0,
    predatorsDefeated: 0,
    apexDefeated: 0,
    rivalEncountered: false,
    venomRatDiscovered: false,
    deaths: 0,
    genomeFragmentsSecured: 0,
  };
}

/** Resets every field on an existing stats object in place, so callers that hold a
 *  reference (RunCompleteController, debug hooks) keep seeing live values rather than
 *  a stale object a reassignment would silently orphan. */
export function resetRunStats(stats) {
  Object.assign(stats, createRunStats());
}

/** Formats whole seconds as mm:ss (e.g. "08:42") - never negative, always two digits
 *  per field regardless of run length. */
export function formatRunTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
