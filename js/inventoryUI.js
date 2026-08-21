import { RESOURCE_TYPES } from './resourceTypes.js';

function colorToCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * Toggleable "Collected Items" panel - the grid + detail view from the concept
 * art, adapted to a portrait mobile bottom sheet. The grid is only rebuilt on
 * open(); while open, updateMass() cheaply refreshes just the footer text.
 */
export class InventoryUI {
  constructor(inventoryManager, { onOpen, onClose } = {}) {
    this.inventoryManager = inventoryManager;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.isOpen = false;

    this.toggleButton = document.getElementById('inventory-toggle');
    this.closeButton = document.getElementById('inventory-close');
    this.overlay = document.getElementById('inventory-overlay');
    this.grid = document.getElementById('inventory-grid');
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
