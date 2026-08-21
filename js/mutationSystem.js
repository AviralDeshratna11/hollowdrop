export const DEBUG_MUTATION = false;

export const MUTATION_RECIPES = {
  venomRat: {
    id: 'venomRat',
    name: 'Venom Rat',
    ingredients: {
      rat_dna: 1,
      toxic_spore: 1,
      mushroom: 1,
    },
  },
};

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
  }

  countInventoryType(type) {
    let count = 0;
    for (const item of this.inventoryManager.items) {
      if (item.type === type) count++;
    }
    return count;
  }

  hasIngredients(recipe) {
    return Object.entries(recipe.ingredients).every(([type, qty]) => this.countInventoryType(type) >= qty);
  }

  getMissingIngredients(recipe) {
    const missing = [];
    for (const [type, qty] of Object.entries(recipe.ingredients)) {
      const have = this.countInventoryType(type);
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
