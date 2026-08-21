// Single source of truth for resource stats + visual identity.
// weight/value drive InventoryManager math; color/modelScale drive resourceModels.js;
// edible/energyValue drive MetabolismSystem's consume action. edible is explicit
// rather than inferred from energyValue > 0, since a future resource might have
// other digestion effects (or a nonzero value but not be food).
export const RESOURCE_TYPES = {
  spore: {
    name: 'Glow Spore',
    weight: 0.5,
    value: 1,
    color: 0x66e0ff,
    modelScale: 1.0,
    edible: true,
    energyValue: 8,
  },
  mushroom: {
    name: 'Moon Mushroom',
    weight: 1,
    value: 2,
    color: 0xb266ff,
    modelScale: 1.0,
    edible: true,
    energyValue: 20,
  },
  stone: {
    name: 'Stone',
    weight: 2,
    value: 1,
    color: 0x8a8a8a,
    modelScale: 1.0,
    edible: false,
    energyValue: 0,
  },
  iron: {
    name: 'Iron Ore',
    weight: 3,
    value: 3,
    color: 0x3a3a40,
    modelScale: 1.1,
    edible: false,
    energyValue: 0,
  },
  toxic_spore: {
    name: 'Toxic Spore',
    weight: 0.5,
    value: 1,
    color: 0x7cff4d,
    modelScale: 1.0,
    edible: false,
    energyValue: 0,
    mutationIngredient: true,
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
  },
};

// Human Genome Fragment is deliberately NOT here - it's a progression item owned by
// GenomeFragmentController, never routed through ResourceManager/InventoryManager
// (no weight, no capacity gate, not edible, not expellable - see that file's header).
