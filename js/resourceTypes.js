// Single source of truth for resource stats + visual identity.
// weight/value drive InventoryManager math; color/modelScale drive resourceModels.js;
// edible/energyValue drive MetabolismSystem's consume action. edible is explicit
// rather than inferred from energyValue > 0, since a future resource might have
// other digestion effects (or a nonzero value but not be food).
//
// category/description (added for the Bag/Inventory panel, inventoryUI.js) are
// DISPLAY-ONLY - nothing in gameplay logic reads either field. category backfills the
// entries that never needed one before now (spore/mushroom/stone/iron/toxic_spore -
// the DNA/organic ones already had it), rather than inferring it in the UI layer, so
// there's exactly one place "what kind of thing is this" lives.
export const RESOURCE_TYPES = {
  spore: {
    name: 'Glow Spore',
    category: 'organic',
    weight: 0.5,
    value: 1,
    color: 0x66e0ff,
    modelScale: 1.0,
    edible: true,
    energyValue: 8,
    description: 'A faintly glowing spore, easy to digest.',
  },
  mushroom: {
    name: 'Moon Mushroom',
    category: 'organic',
    weight: 1,
    value: 2,
    color: 0xb266ff,
    modelScale: 1.0,
    edible: true,
    energyValue: 20,
    description: 'A luminous colony fungus, rich in metabolic energy.',
  },
  blue_mushroom: {
    name: 'Azure Glowcap',
    category: 'organic',
    weight: 0.8,
    value: 3,
    color: 0x00d2ff,
    modelScale: 1.0,
    edible: true,
    energyValue: 24,
    description: 'A radiant bioluminescent blue mushroom pulsing with vital nutrients.',
  },
  stone: {
    name: 'Stone',
    category: 'mineral',
    weight: 2,
    value: 1,
    color: 0x8a8a8a,
    modelScale: 1.0,
    edible: false,
    energyValue: 0,
    description: 'Plain rock. Heavy, and not much else.',
  },
  iron: {
    name: 'Iron Ore',
    category: 'mineral',
    weight: 3,
    value: 3,
    color: 0x3a3a40,
    modelScale: 1.1,
    edible: false,
    energyValue: 0,
    description: 'Dense metallic ore. Worth carrying, if you can bear the weight.',
  },
  toxic_spore: {
    name: 'Toxic Spore',
    category: 'material',
    weight: 0.5,
    value: 1,
    color: 0x7cff4d,
    modelScale: 1.0,
    edible: false,
    energyValue: 0,
    mutationIngredient: true,
    description: 'A caustic spore, unsafe to eat - useful for mutation.',
  },
  rat_dna: {
    name: 'Rat DNA',
    category: 'dna',
    weight: 1,
    value: 5,
    color: 0xff2d9e,
    modelScale: 1.0,
    edible: false,
    energyValue: 0,
    mutationIngredient: true,
    description: 'Genetic material sampled from a rat-like scavenger.',
  },
  beetle_dna: {
    name: 'Beetle DNA',
    category: 'dna',
    weight: 1,
    value: 4,
    color: 0x5dffd6,
    modelScale: 0.9,
    edible: false,
    energyValue: 0,
    mutationIngredient: true,
    description: 'Genetic material sampled from an armored beetle.',
  },
  predator_dna: {
    name: 'Stalker DNA',
    category: 'dna',
    weight: 1.5,
    value: 8,
    color: 0x8a1a3d, // deep violet/crimson - reads as a "bigger, more dangerous" DNA than Rat/Beetle
    modelScale: 1.3,
    edible: false,
    energyValue: 0,
    mutationIngredient: true,
    description: 'Genetic material sampled from a cave predator.',
  },
  toxic_gland: {
    name: 'Toxic Gland',
    category: 'organic',
    weight: 2,
    value: 3,
    color: 0xb23fff,
    modelScale: 1.0,
    edible: false,
    energyValue: 0,
    mutationIngredient: true,
    description: 'An organic venom sac, harvested intact.',
  },
  apex_dna: {
    name: 'Murkmaw DNA',
    category: 'dna',
    weight: 2,
    value: 15,
    color: 0x4a0e6e, // deepest/darkest DNA color yet - reads as the most significant catch
    modelScale: 1.5,
    edible: false,
    energyValue: 0,
    mutationIngredient: true,
    description: 'Genetic material sampled from the apex predator itself.',
  },
  rival_dna: {
    name: 'Rival DNA',
    category: 'dna',
    weight: 1.5,
    value: 10,
    color: 0xff5522, // fiery orange-red, ties visually to the Rival's own palette
    modelScale: 1.2,
    edible: false,
    energyValue: 0,
    mutationIngredient: true,
    description: 'Genetic material sampled from the rival colony.',
  },
};

// Human Genome Fragment is deliberately NOT here - it's a progression item owned by
// GenomeFragmentController, never routed through ResourceManager/InventoryManager
// (no weight, no capacity gate, not edible, not expellable - see that file's header).
// The Bag/Inventory panel (inventoryUI.js) displays it as a separate special slot,
// reading GenomeFragmentController's own state directly rather than through this table.
