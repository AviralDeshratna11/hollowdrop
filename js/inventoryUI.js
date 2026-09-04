import { RESOURCE_TYPES } from './resourceTypes.js?v=5.3';
import { MUTATION_RECIPES, LOCKED_MUTATIONS } from './mutationSystem.js?v=5.3';
import { FRAGMENT_STATES } from './genomeFragmentController.js?v=5.3';
import { BURDEN_CONFIG } from './burdenSystem.js?v=5.3';

function colorToCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function hexToRgba(hex, alpha) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Display-only labels for RESOURCE_TYPES.category (spec section 29) - purely a
// presentation string, never read by gameplay logic.
const CATEGORY_LABELS = {
  organic: 'Organic / Food',
  mineral: 'Mineral',
  dna: 'DNA',
  material: 'Mutation Material',
};

// Real generated artwork (assets/ui/inventory/, resized/compressed from the ~1250px
// sources down to 256px - see the session's own optimize step, spec section 72) for
// every resource that has it. rat_dna/beetle_dna/predator_dna/apex_dna/toxic_gland/
// iron/mushroom map directly to their named art; spore (Glow Spore) borrows the
// nutrient-cluster art as the closest match among the supplied set, since this game has
// no separate "Organic Biomass" resource. rival_dna/stone/toxic_spore have no generated
// art yet and fall through to CATEGORY_ICONS below (spec section 2: never remove an
// item just because it lacks art).
const INVENTORY_ICON_MAP = {
  mushroom: 'assets/ui/inventory/bioluminescent_moonlight_mushroom_cluster.png',
  blue_mushroom: 'assets/ui/inventory/bioluminescent_moonlight_mushroom_cluster.png',
  spore: 'assets/ui/inventory/bioluminescent_alien_nutrient_cluster.png',
  iron: 'assets/ui/inventory/bioluminescent_cyan_ore_cluster.png',
  rat_dna: 'assets/ui/inventory/neon_toxic_rat_dna_vial.png',
  beetle_dna: 'assets/ui/inventory/bioluminescent_beetle_dna_vial.png',
  predator_dna: 'assets/ui/inventory/neon_biohazard_dna_vial.png',
  apex_dna: 'assets/ui/inventory/bioluminescent_apex_dna_vial.png',
  toxic_gland: 'assets/ui/inventory/toxic_bioluminescent_venom_sac.png',
};

const GENOME_ICON_URL = 'assets/ui/inventory/luminous_crystal_dna_shard.png';
// Same diamond-shard shape the radar's own genome blip uses - the Fragment's fallback
// if GENOME_ICON_URL ever fails to load (see wireIconFallbacks).
const GENOME_ICON_FALLBACK = '<svg viewBox="0 0 24 24"><path d="M12 2 21 12 12 22 3 12Z" fill="currentColor" /><path d="M12 6 17 12 12 18 7 12Z" fill="#050806" opacity="0.55" /></svg>';

// Category-shaped placeholders for the few resources with no generated art (rival_dna/
// stone/toxic_spore) - styled to match the rest of the HUD's inline-svg icon language
// (radarHUD.js does the same thing for its own blips).
// TODO: replace with generated per-item artwork if it's ever produced for these three.
const CATEGORY_ICONS = {
  organic: '<svg viewBox="0 0 24 24"><path d="M4 11c0-4 4-7 8-7s8 3 8 7H4Z" fill="currentColor" /><path d="M9 11v6a3 3 0 0 0 6 0v-6" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>',
  mineral: '<svg viewBox="0 0 24 24"><path d="M9 2 19 6 21 15 14 22 4 18 2 8Z" fill="currentColor" /><path d="M9 2 11 10 4 18 M19 6 11 10 14 22" fill="none" stroke="#050806" stroke-width="1" opacity="0.4" /></svg>',
  dna: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 3c0 6 10 6 10 12 0 3-3 5-3 5M17 3c0 6-10 6-10 12 0 3 3 5 3 5" /><path d="M8 7h8M7.5 12h9M8 17h8" stroke-width="1.4" /></svg>',
  material: '<svg viewBox="0 0 24 24"><path d="M9 2h6v4l3 5v7a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-7l3-5Z" fill="currentColor" /><path d="M9 2h6" stroke="#050806" stroke-width="1.4" opacity="0.5" /></svg>',
};

// Small icons for the detail card's 2-column stat rows (spec section 23) - purely
// decorative labels, matching the reference art's own icon-per-stat style.
const STAT_ICONS = {
  weight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v3M8 6h8l3 13H5L8 6Z" stroke-linejoin="round" /></svg>',
  mass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 8V6a3 3 0 0 1 6 0v2M5 8h14l-1.5 12h-11L5 8Z" stroke-linejoin="round" /></svg>',
  edible: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 3v7a2 2 0 0 0 4 0V3M9 10v11M17 3c-2 2-2 5-2 7 0 1 .5 2 2 2s2-1 2-2c0-2 0-5-2-7ZM17 12v9" /></svg>',
  energy: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" /></svg>',
  mutation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></svg>',
};

/** Real artwork when it exists, else the category-shaped svg fallback immediately (no
 *  <img> at all). A previous version returned an <img onerror="..."> with the fallback
 *  svg serialized into that inline HTML attribute - broken, since the svg's own double-
 *  quoted attributes (viewBox="...", fill="...") terminate the onerror="..." attribute
 *  value early the instant the browser's HTML parser hits the first one, leaving the
 *  rest of the svg markup to spill out as garbled literal text next to the image (this
 *  actually shipped and was visible in-game). wireIconFallback() below now attaches a
 *  real error listener after the element exists in the DOM instead - no string
 *  re-serialization, so nothing to escape. */
function getIconHtml(type) {
  const url = INVENTORY_ICON_MAP[type];
  if (!url) return CATEGORY_ICONS[RESOURCE_TYPES[type].category] ?? CATEGORY_ICONS.material;
  return `<img src="${url}" alt="" data-icon-fallback="${type}" />`;
}

/** Pairs with getIconHtml()/GENOME_ICON_URL - call once per <img data-icon-fallback>
 *  after it's actually in the DOM (spec section 74: never show a broken-image icon). */
export function wireIconFallbacks(root) {
  root.querySelectorAll('img[data-icon-fallback]').forEach((img) => {
    img.addEventListener('error', () => {
      const type = img.dataset.iconFallback;
      const fallback = type === 'genome_fragment' ? GENOME_ICON_FALLBACK : (CATEGORY_ICONS[RESOURCE_TYPES[type]?.category] ?? CATEGORY_ICONS.material);
      img.outerHTML = fallback;
    }, { once: true });
  });
}

/** Every RESOURCE_TYPES id -> which recipe(s) actually use it, computed once (the
 *  recipe table is static) rather than re-scanned on every render. */
const USED_IN_BY_TYPE = (() => {
  const map = new Map();
  for (const recipe of Object.values(MUTATION_RECIPES)) {
    for (const type of Object.keys(recipe.ingredients)) {
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(recipe.name);
    }
  }
  return map;
})();

/** Groups individual carried item instances into per-type stacks for display (spec
 *  section 17) - purely a view-model. The real gameplay inventory (inventoryManager.items)
 *  is never restructured; `items` here just holds references back into it. */
function buildInventoryStacks(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.type)) map.set(item.type, { type: item.type, items: [], count: 0 });
    const stack = map.get(item.type);
    stack.items.push(item);
    stack.count += 1;
  }
  return [...map.values()];
}

/** Combines a stack with its (authoritative, never duplicated) RESOURCE_TYPES metadata
 *  into everything the grid cell / detail panel need to render (spec section 28).
 *  Exported so ResourceInteractionController's world-resource Inspect panel can reuse
 *  the exact same icon/category/energy/mutation-ingredient/recipe-lookup logic rather
 *  than maintaining a second copy of it for resources still sitting in the world. */
export function getInventoryItemUIData(stack) {
  const meta = RESOURCE_TYPES[stack.type];
  return {
    type: stack.type,
    name: meta.name,
    count: stack.count,
    items: stack.items, // real gameplay item instances - Consume/Expel act on these, never a copy
    icon: getIconHtml(stack.type),
    hasArt: !!INVENTORY_ICON_MAP[stack.type], // false only for rival_dna/stone/toxic_spore - see getIconHtml
    color: meta.color,
    category: meta.category,
    categoryLabel: CATEGORY_LABELS[meta.category] ?? meta.category,
    weightEach: meta.weight,
    totalWeight: meta.weight * stack.count,
    edible: !!meta.edible,
    energyValue: meta.energyValue ?? 0,
    mutationIngredient: !!meta.mutationIngredient,
    usedIn: USED_IN_BY_TYPE.get(stack.type) ?? [],
    description: meta.description ?? '',
  };
}

function burdenLabel(load) {
  // Reuses uiManager's own existing mass-ui heavy/overburdened thresholds (0.5, 0.8)
  // rather than inventing a fourth tier or a different cutoff - this is a read of the
  // same curve, not a second competing definition of "heavy" (spec section 34).
  if (load >= 1) return 'OVERLOADED';
  if (load >= BURDEN_CONFIG.heavyThreshold) return 'HEAVY';
  if (load >= 0.5) return 'BURDENED';
  return 'LIGHT';
}

/**
 * The Bag/Inventory panel: exact quantities, item inspection, Consume/Expel, and the
 * mutation codex. Deliberately NOT a second inventory data store - every render reads
 * inventoryManager.items fresh (via buildInventoryStacks), and every action
 * (consumeItem/expelItemById) calls straight into the existing consume/expel systems
 * rather than reimplementing them (spec sections 37, 42, 94).
 *
 * Division of labour with the other two inventory surfaces: the Living Inventory
 * (visuals floating inside Hollowdrop) is the always-on ambient read; the WHEEL
 * (inventoryWheel.js) is the fast in-play action under pressure; this PANEL is what a
 * player opens when safe and wants exact numbers, descriptions, and deliberate
 * Consume/Expel choices. Opening it pauses gameplay (see main.js's canOpen/onOpen
 * wiring into GameFlowController.openInventory()) - it is a management screen, not a
 * HUD overlay meant to be read mid-chase.
 */
export class InventoryUI {
  constructor(inventoryManager, {
    onOpen, onClose, mutationSystem = null, inventoryInteraction = null,
    inventoryWheel = null, genomeFragmentController = null, burdenSystem = null, canOpen = null,
  } = {}) {
    this.inventoryManager = inventoryManager;
    this.mutationSystem = mutationSystem;
    this.inventoryInteraction = inventoryInteraction;
    this.inventoryWheel = inventoryWheel;
    this.genomeFragmentController = genomeFragmentController;
    this.burdenSystem = burdenSystem;
    // Optional guard: return false to refuse opening (spec section 66 - TITLE/MEMORY/
    // REVEAL/RUN_COMPLETE/RESETTING/dying/mutating all refuse). Without one, always allowed.
    this.canOpen = canOpen;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.isOpen = false;
    this.selectedType = null;

    this.toggleButton = document.getElementById('inventory-toggle');
    this.bagBadge = document.getElementById('inventory-bag-badge');
    this.closeButton = document.getElementById('inventory-close');
    this.overlay = document.getElementById('inventory-overlay');
    this.headerCount = document.getElementById('inventory-header-count');
    this.specialSection = document.getElementById('inventory-special');
    this.specialCell = document.getElementById('inventory-special-cell');
    this.grid = document.getElementById('inventory-grid');
    this.codexList = document.getElementById('codex-list');
    this.detailIcon = document.getElementById('inventory-detail-icon');
    this.detailName = document.getElementById('inventory-detail-name');
    this.detailCategory = document.getElementById('inventory-detail-category');
    this.detailCount = document.getElementById('inventory-detail-count');
    this.detailStats = document.getElementById('inventory-detail-stats');
    this.detailDescription = document.getElementById('inventory-detail-description');
    this.detailUsedIn = document.getElementById('inventory-detail-used-in');
    this.detailActions = document.getElementById('inventory-detail-actions');
    this.consumeButton = document.getElementById('inventory-consume-button');
    this.expelButton = document.getElementById('inventory-expel-button');
    this.massFill = document.getElementById('inventory-mass-fill');
    this.massText = document.getElementById('inventory-mass-text');
    this.burdenLabelEl = document.getElementById('inventory-burden-label');

    this.toggleButton?.addEventListener('click', () => this.toggle());
    this.closeButton?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close(); // tap the backdrop to dismiss
    });
    // Both handlers read this.selectedType fresh at click time rather than being
    // rebound per-render, so there is exactly one listener each for the panel's lifetime.
    this.consumeButton?.addEventListener('click', (e) => {
      e.preventDefault();
      this._consumeSelected();
    });
    this.expelButton?.addEventListener('click', (e) => {
      e.preventDefault();
      this._expelSelected();
    });
    this.specialCell?.addEventListener('click', (e) => {
      e.preventDefault();
      this._selectSpecial();
    });

    this._updateBagBadge();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.isOpen) return;
    if (this.canOpen && !this.canOpen()) return; // spec section 66 - not available right now
    this.isOpen = true;
    this._renderAll();
    this.overlay?.classList.add('inventory-overlay--open');
    this.toggleButton?.classList.add('inventory-toggle--active');
    this.onOpen?.();
  }

  close() {
    this.isOpen = false;
    this.selectedType = null;
    this.overlay?.classList.remove('inventory-overlay--open');
    this.toggleButton?.classList.remove('inventory-toggle--active');
    this.onClose?.();
  }

  /** Re-renders the grid/detail if the panel is currently open - used when the inventory
   *  changes underneath an open panel (e.g. a death drop empties it). No-op while closed,
   *  since the grid is rebuilt from scratch on the next open() anyway. */
  refresh() {
    if (this.isOpen) this._render();
  }

  /**
   * Event-driven refresh (spec sections 58-59) - the intended hook is
   * MutationSystem.onRecipeChecked, which already fires after every single
   * absorb/consume/expel/death-drop/mutation via onInventoryChanged() (main.js wraps it
   * once, alongside the existing debug-panel listener, the same way addDefeatShake
   * wraps onDefeated elsewhere in that file). The Bag badge updates unconditionally;
   * the heavier grid/detail/codex rebuild only happens while the panel is actually open -
   * this is never polled or rebuilt per render frame.
   */
  refresh() {
    this._updateBagBadge();
    if (this.isOpen) this._renderAll();
  }

  _renderAll() {
    this._renderSpecial();
    this._render();
    this._renderCodex();
    this._renderDetails();
    this._updateMassAndBurden();
  }

  // --- Bag button --------------------------------------------------------------

  _updateBagBadge() {
    if (!this.bagBadge) return;
    const count = this.inventoryManager.items.length; // total UNITS, not unique types (spec section 6)
    this.bagBadge.textContent = String(count);

    const ratio = this.inventoryManager.getInventoryWeightRatio();
    // Same 0.6/0.85 breakpoints the spec itself suggests for the button's own feedback -
    // distinct from (a little more granular than) the mass-ui/detail-panel burden labels,
    // since this is a glance-only badge rather than a read.
    this.toggleButton?.classList.toggle('inventory-toggle--warn', ratio >= 0.6 && ratio < 0.85);
    this.toggleButton?.classList.toggle('inventory-toggle--critical', ratio >= 0.85);
  }

  // --- Special slot: Human Genome Fragment --------------------------------------

  /** True only while the Fragment is actually on the player - not merely spawned/exposed
   *  elsewhere in the world, and not merely "collected" in a past run (spec section 53:
   *  only SECURED fragments are permanent progression; a currently-carried one is shown
   *  as exactly that, "Currently Carrying", never pretended to be already banked). */
  _isCarryingFragment() {
    const fragment = this.genomeFragmentController?.fragment;
    return !!fragment && fragment.state === FRAGMENT_STATES.CARRIED_BY_PLAYER;
  }

  _renderSpecial() {
    const carrying = this._isCarryingFragment();
    this.specialSection?.classList.toggle('inventory-special--visible', carrying);
    if (!carrying) {
      if (this.selectedType === 'genome_fragment') this.selectedType = null;
      return;
    }
    if (this.specialCell) {
      this.specialCell.innerHTML = `
        <span class="inventory-cell-icon inventory-cell-icon--special"><img src="${GENOME_ICON_URL}" alt="" data-icon-fallback="genome_fragment" /></span>
        <span class="inventory-cell-name">Human Genome Fragment</span>
        <span class="inventory-cell-tag">KEY ITEM</span>
      `;
      wireIconFallbacks(this.specialCell);
      this.specialCell.classList.toggle('inventory-cell--selected', this.selectedType === 'genome_fragment');
    }
  }

  _selectSpecial() {
    if (!this._isCarryingFragment()) return;
    this.selectedType = 'genome_fragment';
    this._render();
    this._renderSpecial();
    this._renderDetails();
  }

  // --- Grid ----------------------------------------------------------------------

  _buildStacks() {
    return buildInventoryStacks(this.inventoryManager.items).map(getInventoryItemUIData);
  }

  _render() {
    if (!this.grid) return;
    this.stacks = this._buildStacks();
    this.grid.innerHTML = '';

    if (this.stacks.length === 0 && !this._isCarryingFragment()) {
      const empty = document.createElement('div');
      empty.className = 'inventory-empty';
      empty.textContent = 'Your Living Inventory is empty.';
      this.grid.appendChild(empty);
    } else {
      for (const data of this.stacks) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `inventory-cell${data.type === this.selectedType ? ' inventory-cell--selected' : ''}`;
        cell.setAttribute('aria-label', `${data.name}, quantity ${data.count}`);
        // Real artwork already has its own glow/framing baked in and fills the icon
        // area edge-to-edge; only the svg fallback (no generated art for this type)
        // gets the colored glow-badge treatment, so real icons never look tinted.
        const iconStyle = data.hasArt ? '' : `style="background:${hexToRgba(data.color, 0.4)}; border-color:${hexToRgba(data.color, 0.6)}; color:${colorToCss(data.color)}"`;
        cell.innerHTML = `
          <span class="inventory-cell-icon${data.hasArt ? '' : ' inventory-cell-icon--badge'}" ${iconStyle}>${data.icon}</span>
          <span class="inventory-cell-name">${data.name}</span>
          <span class="inventory-count">${data.count}</span>
        `;
        cell.addEventListener('click', () => this.selectItem(data.type));
        this.grid.appendChild(cell);
      }
      wireIconFallbacks(this.grid);
    }

    if (this.headerCount) {
      const totalUnits = this.inventoryManager.items.length;
      this.headerCount.textContent = `${totalUnits} ITEM${totalUnits === 1 ? '' : 'S'}`;
    }

    // A count change can invalidate the current selection (consumed/expelled down to
    // zero) - clear it rather than leave the details panel pointing at a stack that no
    // longer exists (spec section 61).
    if (this.selectedType && this.selectedType !== 'genome_fragment' && !this.stacks.some((s) => s.type === this.selectedType)) {
      this.selectedType = null;
    }
  }

  selectItem(type) {
    this.selectedType = type;
    this._render();
    this._renderSpecial();
    this._renderDetails();
  }

  // --- Details / actions -----------------------------------------------------------

  _renderDetails() {
    if (!this.detailName) return;

    if (this.selectedType === 'genome_fragment' && this._isCarryingFragment()) {
      if (this.detailIcon) {
        this.detailIcon.innerHTML = `<img src="${GENOME_ICON_URL}" alt="" data-icon-fallback="genome_fragment" />`;
        wireIconFallbacks(this.detailIcon);
      }
      this.detailName.textContent = 'Human Genome Fragment';
      if (this.detailCategory) this.detailCategory.textContent = 'Key Progression Item';
      if (this.detailCount) this.detailCount.textContent = '';
      if (this.detailStats) {
        this.detailStats.innerHTML = [
          this._statRowHtml('weight', 'Weight', '0'),
          this._statRowHtml('mutation', 'Consumable', 'No'),
        ].join('');
      }
      if (this.detailDescription) this.detailDescription.textContent = 'Currently Carrying — cannot be Consumed or Expelled.';
      if (this.detailUsedIn) this.detailUsedIn.textContent = '';
      this._setActionsVisible(false, false);
      return;
    }

    const data = this.stacks?.find((s) => s.type === this.selectedType);
    if (!data) {
      if (this.detailIcon) this.detailIcon.innerHTML = '';
      this.detailName.textContent = 'Select a material to inspect.';
      if (this.detailCategory) this.detailCategory.textContent = '';
      if (this.detailCount) this.detailCount.textContent = '';
      if (this.detailStats) this.detailStats.innerHTML = '';
      if (this.detailDescription) this.detailDescription.textContent = '';
      if (this.detailUsedIn) this.detailUsedIn.textContent = '';
      this._setActionsVisible(false, false);
      return;
    }

    if (this.detailIcon) {
      this.detailIcon.innerHTML = data.icon;
      wireIconFallbacks(this.detailIcon);
    }
    this.detailName.textContent = data.name;
    if (this.detailCategory) this.detailCategory.textContent = data.categoryLabel;
    if (this.detailCount) this.detailCount.textContent = `×${data.count}`;

    if (this.detailStats) {
      const stats = [
        this._statRowHtml('weight', 'Weight (each)', data.weightEach),
        this._statRowHtml('mass', 'Stack Mass', data.totalWeight.toFixed(1)),
        this._statRowHtml('edible', 'Edible', data.edible ? 'Yes' : 'No'),
      ];
      if (data.edible) stats.push(this._statRowHtml('energy', 'Energy', `+${data.energyValue}`));
      if (data.mutationIngredient) stats.push(this._statRowHtml('mutation', 'Mutation Ingredient', 'Yes'));
      this.detailStats.innerHTML = stats.join('');
    }

    if (this.detailDescription) this.detailDescription.textContent = data.description;

    if (this.detailUsedIn) {
      this.detailUsedIn.textContent = data.usedIn.length > 0 ? `USED IN: ${data.usedIn.join(', ').toUpperCase()}` : '';
    }

    // Only offer an action that is actually valid for this resource (spec sections
    // 36-37, 45, 102) - never a disabled-looking button for something that can't happen.
    this._setActionsVisible(data.edible, true);
  }

  _statRowHtml(iconKey, label, value) {
    return `<span class="inventory-detail-stat">${STAT_ICONS[iconKey] ?? ''}${label}<b>${value}</b></span>`;
  }

  _setActionsVisible(showConsume, showExpel) {
    this.consumeButton?.classList.toggle('inventory-action-button--hidden', !showConsume);
    this.expelButton?.classList.toggle('inventory-action-button--hidden', !showExpel);
    this.detailActions?.classList.toggle('inventory-detail-actions--hidden', !showConsume && !showExpel);
  }

  /** Picks one real instance from the selected stack to act on - the most recently
   *  absorbed, matching the wheel's own "last in, first out" convention (inventoryWheel.js). */
  _getSelectedInstance() {
    const data = this.stacks?.find((s) => s.type === this.selectedType);
    if (!data || data.items.length === 0) return null;
    return data.items[data.items.length - 1];
  }

  /** Consume one real instance from the selected stack (spec sections 37-39) - routes
   *  through InventoryInteractionController.consumeItem(), the exact same digestion
   *  animation/energy/mutation-recheck path the world-tap Consume button uses. Does not
   *  close the panel (section 39) or splice the array itself (section 94) - refresh()
   *  will pick up the change once onInventoryChanged() fires at the end of digestion. */
  _consumeSelected() {
    const item = this._getSelectedInstance();
    if (!item || !this.inventoryInteraction) return;
    this.inventoryInteraction.consumeItem(item);
  }

  /** Expel one real instance from the selected stack (spec sections 41-44) - routes
   *  through InventoryWheelController.expelItemById(), the exact same physics/particle/
   *  mass bookkeeping the wheel's own segments use, launched behind the player since the
   *  panel has no on-screen throw angle to derive one from. */
  _expelSelected() {
    const item = this._getSelectedInstance();
    if (!item || !this.inventoryWheel) return;
    this.inventoryWheel.expelItemById(item.id);
  }

  // --- Mass / burden ---------------------------------------------------------------

  _updateMassAndBurden() {
    if (!this.massFill || !this.massText) return;
    const current = this.inventoryManager.getInventoryWeight();
    const max = this.inventoryManager.maxWeight;
    const ratio = Math.min(current / max, 1);
    this.massFill.style.width = `${ratio * 100}%`;
    this.massText.textContent = `${Math.round(current * 10) / 10} / ${max}`;

    if (this.burdenLabelEl) {
      const load = this.burdenSystem ? this.burdenSystem.load : ratio;
      const label = burdenLabel(load);
      this.burdenLabelEl.textContent = label;
      this.burdenLabelEl.className = `burden-pill burden-pill--${label.toLowerCase()}`;
    }
  }

  // --- Mutation codex (unchanged behaviour, see original header note) --------------

  /**
   * The mutation codex: every form, what it costs, and what it grants.
   *
   * Missing-ingredient counts come from MutationSystem.getMissingIngredients(), which
   * already exists and was already being computed for the debug recipe panel - this
   * surfaces it to the player rather than duplicating the logic.
   *
   * Locked entries are listed deliberately. The design doc names the Stage 3 hook as
   * "wanting to find the ingredients to mutate again"; with exactly one real recipe in
   * the game, an honest "there is more, you have not found it" is what gives that hook
   * something to point at.
   */
  _renderCodex() {
    if (!this.codexList) return;
    this.codexList.innerHTML = '';

    for (const recipe of Object.values(MUTATION_RECIPES)) {
      const missing = this.mutationSystem ? this.mutationSystem.getMissingIngredients(recipe) : [];
      const missingByType = new Map(missing.map((m) => [m.type, m.missing]));
      const available = missing.length === 0;

      const entry = document.createElement('div');
      entry.className = `codex-entry${available ? ' codex-entry--ready' : ''}`;

      const chips = Object.entries(recipe.ingredients).map(([type, qty]) => {
        const config = RESOURCE_TYPES[type];
        const short = missingByType.get(type) ?? 0;
        const have = qty - short;
        return `<span class="codex-chip${short ? '' : ' codex-chip--have'}"
          style="--chip-color:${colorToCss(config.color)}">
          <i></i>${config.name} ${have}/${qty}</span>`;
      }).join('');

      entry.innerHTML = `
        <div class="codex-entry-head">
          <span class="codex-entry-name">${recipe.name}</span>
          <span class="codex-entry-state">${available ? 'READY' : 'INCOMPLETE'}</span>
        </div>
        <div class="codex-chips">${chips}</div>
        <ul class="codex-grants">${(recipe.grants ?? []).map((g) => `<li>${g}</li>`).join('')}</ul>
        ${recipe.cost ? `<p class="codex-cost">${recipe.cost}</p>` : ''}
      `;
      this.codexList.appendChild(entry);
    }

    for (const locked of LOCKED_MUTATIONS) {
      const entry = document.createElement('div');
      entry.className = 'codex-entry codex-entry--locked';
      entry.innerHTML = `
        <div class="codex-entry-head">
          <span class="codex-entry-name">${locked.name}</span>
          <span class="codex-entry-state">LOCKED</span>
        </div>
        <p class="codex-locked-hint">${locked.hint}</p>
      `;
      this.codexList.appendChild(entry);
    }
  }
}
