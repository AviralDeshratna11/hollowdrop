import { RESOURCE_TYPES } from './resourceTypes.js?v=5.3';

export const DEBUG_MUTATION = false;

/**
 * Every player transformation, its cost in absorbed material, and what it actually does.
 *
 * `grants` and `cost` exist so the codex and the post-transformation reveal can describe
 * a form without either of them hardcoding strings about game balance. The numbers they
 * describe live in playerFormController.js's FORM_CONFIG - if those change, these lines
 * must change with them; they are documentation of behaviour, not the source of it.
 */
export const MUTATION_RECIPES = {
  venomRat: {
    id: 'venomRat',
    name: 'Venom Rat',
    tagline: 'A hunter\u2019s body, borrowed.',
    ingredients: {
      rat_dna: 1,
      toxic_spore: 1,
      mushroom: 1,
    },
    grants: [
      '25% faster, and quicker to accelerate',
      'Venom Bite \u2014 the only way to kill',
      'Prey flees from you at a distance',
    ],
    cost: 'Burns energy 50% faster, and holds for only 45 seconds.',
  },
};

/**
 * Forms the player cannot become yet.
 *
 * These are shown in the codex as locked, deliberately. The design doc names the Stage 3
 * hook as "wanting to find the ingredients to mutate again" - an empty codex with one
 * entry gives that nothing to aim at, whereas a visible locked slot does exactly the job
 * the document asks for. They are NOT implemented: nothing here is craftable, and
 * FIRE_LIZARD in particular currently belongs to the Rival (see RIVAL_FORMS in
 * rivalController.js), not to the player.
 */
export const LOCKED_MUTATIONS = [
  { name: 'Ember Lizard', hint: 'Something the Rival knows and you do not.' },
  { name: 'Unknown Strain', hint: 'Undiscovered.' },
];

// Optional hooks, currently silent - lets audio be added later without touching this logic.
function playMutationReadySound() {}

/**
 * Pure recipe/data logic: no visuals, no transformation animation (that's
 * PlayerFormController's job). Recipe availability is recomputed only when
 * onInventoryChanged() is called - not scanned every frame - and callers should
 * call it after every absorb/consume/expel/death-drop.
 */
export class MutationSystem {
  constructor(inventoryManager, { onMutationAvailable, onRecipeChecked } = {}) {
    this.inventoryManager = inventoryManager;
    this.onMutationAvailable = onMutationAvailable;
    // Fires on every check regardless of whether availability changed - unlike
    // onMutationAvailable (transitions only), this exists purely so a debug
    // ingredient-progress panel can stay live without MutationSystem knowing about UI.
    this.onRecipeChecked = onRecipeChecked;

    this.recipes = MUTATION_RECIPES;
    this.discoveredMutations = new Set();
    this.availableRecipeId = null;
    // DNA the player has absorbed at least once this run. A DNA-category ingredient is a
    // permanent gene unlock: once sampled it keeps satisfying its recipe requirement for
    // the rest of the run even after the sample is consumed by a mutation or lost on death
    // (the one-and-only Rat DNA never respawns), so the player is never permanently locked
    // out of a form they've already unlocked - only the non-DNA materials must be
    // re-gathered each time. Session-scoped: cleared on Play Again (see reset()).
    this.unlockedGenes = new Set();
  }

  /** Records a DNA absorb as a permanent gene unlock. Non-DNA resources are ignored -
   *  materials like Toxic Spore / Moon Mushroom stay a per-mutation cost. Called by
   *  ResourceManager on every absorb. */
  notifyResourceAbsorbed(type) {
    if (RESOURCE_TYPES[type]?.category === 'dna') this.unlockedGenes.add(type);
  }

  isGeneUnlocked(type) {
    return this.unlockedGenes.has(type);
  }

  countInventoryType(type) {
    let count = 0;
    for (const item of this.inventoryManager.items) {
      if (item.type === type) count++;
    }
    return count;
  }

  /** How much of an ingredient counts as available: a permanently-unlocked gene always
   *  reads as satisfied, whether or not a physical sample is currently held. Everything
   *  else is the live inventory count. */
  _effectiveCount(type) {
    return this.unlockedGenes.has(type) ? Infinity : this.countInventoryType(type);
  }

  hasIngredients(recipe) {
    return Object.entries(recipe.ingredients).every(([type, qty]) => this._effectiveCount(type) >= qty);
  }

  getMissingIngredients(recipe) {
    const missing = [];
    for (const [type, qty] of Object.entries(recipe.ingredients)) {
      const have = this._effectiveCount(type);
      if (have < qty) missing.push({ type, missing: qty - have });
    }
    return missing;
  }

  isAvailable() {
    return this.availableRecipeId !== null;
  }

  getAvailableRecipe() {
    return this.availableRecipeId ? this.recipes[this.availableRecipeId] : null;
  }

  /** Call after any inventory-changing action (absorb/consume/expel/death-drop/mutation
   *  itself). Recomputes availability once; no-ops (and calls no callback) if nothing changed. */
  onInventoryChanged() {
    let readyRecipeId = null;
    for (const recipe of Object.values(this.recipes)) {
      if (this.hasIngredients(recipe)) {
        readyRecipeId = recipe.id;
        break;
      }
    }

    if (this.onRecipeChecked) {
      const recipe = Object.values(this.recipes)[0]; // only one recipe exists in this prototype
      this.onRecipeChecked(recipe, this.getMissingIngredients(recipe));
    }

    if (readyRecipeId === this.availableRecipeId) return;
    this.availableRecipeId = readyRecipeId;

    if (readyRecipeId) {
      const recipe = this.recipes[readyRecipeId];
      const firstDiscovery = !this.discoveredMutations.has(readyRecipeId);
      if (firstDiscovery) this.discoveredMutations.add(readyRecipeId);

      if (DEBUG_MUTATION) console.log(`Mutation available: ${recipe.name}`);
      playMutationReadySound();
      this.onMutationAvailable?.(recipe, firstDiscovery);
    } else {
      this.onMutationAvailable?.(null, false);
    }
  }

  /** Full reset for a brand-new run (Play Again) - "discovered" is otherwise permanent
   *  for the whole session, so without this a second run would never re-show the
   *  Mutation Discovered toast. Caller should follow with onInventoryChanged() once
   *  the inventory itself is actually empty, so availableRecipeId is recomputed (not
   *  just force-cleared here) and the MUTATE button hides through the normal path. */
  reset() {
    this.discoveredMutations.clear();
    this.availableRecipeId = null;
    this.unlockedGenes.clear(); // a fresh run re-locks every gene until its DNA is sampled again
  }

  /** Removes exactly the recipe's required ingredients via the existing InventoryManager
   *  removal path, so weight/visuals/Mass UI/burden all stay synchronized automatically.
   *  Returns the consumed item objects (already-removed) for logging/VFX purposes. */
  consumeIngredients(recipe) {
    const consumed = [];
    for (const [type, qty] of Object.entries(recipe.ingredients)) {
      let removedCount = 0;
      for (let i = this.inventoryManager.items.length - 1; i >= 0 && removedCount < qty; i--) {
        if (this.inventoryManager.items[i].type === type) {
          const item = this.inventoryManager.removeItem(this.inventoryManager.items[i].id);
          if (item) consumed.push(item);
          removedCount++;
        }
      }
    }
    return consumed;
  }
}
