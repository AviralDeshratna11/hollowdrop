import { RESOURCE_TYPES } from './resourceTypes.js';
import { MUTATION_RECIPES, LOCKED_MUTATIONS } from './mutationSystem.js';

function colorToCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * Toggleable "Collected Items" panel - the grid + detail view from the concept
 * art, adapted to a portrait mobile bottom sheet. The grid is only rebuilt on
 * open(); while open, updateMass() cheaply refreshes just the footer text.
 */
export class InventoryUI {
  constructor(inventoryManager, { onOpen, onClose, mutationSystem = null } = {}) {
    this.inventoryManager = inventoryManager;
    // Optional: without it the codex still lists recipes, just without live
    // missing-ingredient counts.
    this.mutationSystem = mutationSystem;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.isOpen = false;

    this.toggleButton = document.getElementById('inventory-toggle');
    this.closeButton = document.getElementById('inventory-close');
    this.overlay = document.getElementById('inventory-overlay');
    this.grid = document.getElementById('inventory-grid');
    this.codexList = document.getElementById('codex-list');
    this.detailName = document.getElementById('inventory-detail-name');
    this.detailMeta = document.getElementById('inventory-detail-meta');
    this.massFill = document.getElementById('inventory-mass-fill');
    this.massText = document.getElementById('inventory-mass-text');

    this.toggleButton?.addEventListener('click', () => this.toggle());
    this.closeButton?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close(); // tap the backdrop to dismiss
    });
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.isOpen = true;
    this._render();
    this._renderCodex();
    this.overlay?.classList.add('inventory-overlay--open');
    this.toggleButton?.classList.add('inventory-toggle--active');
    this.onOpen?.();
  }

  close() {
    this.isOpen = false;
    this.overlay?.classList.remove('inventory-overlay--open');
    this.toggleButton?.classList.remove('inventory-toggle--active');
    this.onClose?.();
  }

  /** Cheap per-frame call while open - keeps the mass footer live without rebuilding the grid. */
  updateMass() {
    if (!this.isOpen || !this.massFill || !this.massText) return;
    const current = this.inventoryManager.getInventoryWeight();
    const max = this.inventoryManager.maxWeight;
    const ratio = Math.min(current / max, 1);
    this.massFill.style.width = `${ratio * 100}%`;
    this.massText.textContent = `${Math.round(current * 10) / 10} / ${max}`;
  }

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

  _render() {
    if (!this.grid) return;
    this.grid.innerHTML = '';

    const counts = new Map();
    for (const item of this.inventoryManager.items) {
      const entry = counts.get(item.type) ?? { ...RESOURCE_TYPES[item.type], type: item.type, count: 0 };
      entry.count += 1;
      counts.set(item.type, entry);
    }

    if (counts.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'inventory-empty';
      empty.textContent = 'Nothing collected yet.';
      this.grid.appendChild(empty);
    } else {
      for (const entry of counts.values()) {
        const css = colorToCss(entry.color);
        const cell = document.createElement('button');
        cell.className = 'inventory-cell';
        cell.innerHTML = `
          <span class="inventory-swatch" style="background:${css}; color:${css}"></span>
          <span class="inventory-cell-name">${entry.name}</span>
          <span class="inventory-cell-count">x${entry.count}</span>
        `;
        cell.addEventListener('click', () => this._showDetail(entry));
        this.grid.appendChild(cell);
      }
    }

    this._showDetail(null);
    this.updateMass();
  }

  _showDetail(entry) {
    if (!this.detailName || !this.detailMeta) return;
    if (!entry) {
      this.detailName.textContent = 'Tap an item for details';
      this.detailMeta.textContent = '';
      return;
    }
    this.detailName.textContent = `${entry.name} x${entry.count}`;
    this.detailMeta.textContent =
      `Weight ${entry.weight} each - Value ${entry.value} each - Total weight ${(entry.weight * entry.count).toFixed(1)}`;
  }
}
