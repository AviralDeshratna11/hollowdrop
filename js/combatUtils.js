/**
 * Combat damage utilities: handles damage variance (+/- 5 of base value)
 * and player critical strike chance (10% chance for 1.5x multiplier).
 */

export const COMBAT_CONFIG = {
  varianceRange: 5,        // Damage offset between -5 and +5 (inclusive)
  playerCritChance: 0.10,  // 10% critical hit chance for player attacks
  critMultiplier: 1.5,     // 1.5x damage on critical strike
};

/**
 * Calculates attack damage with random variance in range [-5, 5] and optional critical hit.
 *
 * @param {number} baseDamage - The base configured damage for the attack
 * @param {boolean} [isPlayerAttack=false] - Whether this attack originated from the player
 * @param {number} [critMultiplier=COMBAT_CONFIG.critMultiplier] - Multiplier if a critical strike occurs
 * @returns {{ damage: number, isCrit: boolean, rawDamage: number }}
 */
export function calculateAttackDamage(baseDamage, isPlayerAttack = false, critMultiplier = COMBAT_CONFIG.critMultiplier) {
  // Integer offset between -varianceRange and +varianceRange (e.g. -5 to +5, 11 possible integers)
  const offset = Math.floor(Math.random() * (COMBAT_CONFIG.varianceRange * 2 + 1)) - COMBAT_CONFIG.varianceRange;
  let damage = Math.max(1, Math.round(baseDamage + offset));

  const isCrit = Boolean(isPlayerAttack && Math.random() < COMBAT_CONFIG.playerCritChance);
  if (isCrit) {
    damage = Math.max(1, Math.round(damage * critMultiplier));
  }

  return { damage, isCrit, rawDamage: baseDamage + offset };
}
