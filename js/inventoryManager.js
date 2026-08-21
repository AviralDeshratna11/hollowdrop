import * as THREE from 'three';
import { RESOURCE_TYPES } from './resourceTypes.js';
import { createResourceMesh } from './resourceModels.js';

export const MAX_WEIGHT = 15;

const INVENTORY_SCALE = 0.28; // internal items render at 20-35% of world size
const FLOAT_AMPLITUDE = 0.03;
const FLOAT_SPEED = 1.2;
const ROTATE_SPEED = 0.3;
const BOB_WEIGHT_FACTOR = 0.35; // heavier items float less: bobAmount = FLOAT_AMPLITUDE / (1 + weight * factor)

// Preset internal "slots" so items don't stack at the origin. Sized for the
// 0.6-radius player sphere (local space, origin = sphere center).
const INVENTORY_SLOTS = [
  [-0.22, -0.05, 0.10],
  [0.20, 0.05, -0.12],
  [-0.10, 0.20, 0.15],
  [0.18, 0.18, -0.05],
  [-0.18, -0.20, -0.10],
  [0.05, -0.15, 0.20],
  [0.00, 0.30, -0.15],
  [-0.05, -0.30, 0.05],
];

let nextItemId = 1;

/** Owns the Living Inventory: collected-item data + the visuals parented inside Hollowdrop. */
export class InventoryManager {
  constructor(inventoryContainer, { maxWeight = MAX_WEIGHT } = {}) {
    this.inventoryContainer = inventoryContainer;
    this.maxWeight = maxWeight;
    this.items = [];
    this.totalWeight = 0;
    this._elapsed = 0;
  }

  canAddItem(type) {
    const config = RESOURCE_TYPES[type];
    return this.totalWeight + config.weight <= this.maxWeight;
  }

  /** Finalizes a collected resource: builds its internal visual and parents it to Hollowdrop. */
  addItem(resource) {
    const config = RESOURCE_TYPES[resource.type];
    const baseVisualScale = config.modelScale * INVENTORY_SCALE;
    const visualMesh = this.createInventoryVisual(resource.type);

    const slot = INVENTORY_SLOTS[this.items.length % INVENTORY_SLOTS.length];
    const jitter = () => (Math.random() - 0.5) * 0.04;
    const basePosition = new THREE.Vector3(slot[0] + jitter(), slot[1] + jitter(), slot[2] + jitter());
    visualMesh.position.copy(basePosition);
    visualMesh.rotation.y = Math.random() * Math.PI * 2;

    // Parented to inventoryContainer, which is a child of the player mesh -
    // it automatically follows Hollowdrop's position/rotation, no manual sync needed.
    this.inventoryContainer.add(visualMesh);

    const item = {
      id: nextItemId++,
      type: resource.type,
      name: config.name,
      weight: config.weight,
      value: config.value,
      visualMesh,
      basePosition,
      baseVisualScale,
      phase: Math.random() * Math.PI * 2,
    };

    this.items.push(item);
    this.totalWeight += config.weight;
    return item;
  }

  /** Expels an item: detaches its visual, disposes its per-instance materials, subtracts weight exactly once. */
  removeItem(id) {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return null;
    const [item] = this.items.splice(index, 1);

    this.inventoryContainer.remove(item.visualMesh);
    item.visualMesh.traverse((child) => {
      if (!child.material) return;
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    });

    this.totalWeight = Math.max(0, this.totalWeight - item.weight);
    return item;
  }

  /** Full reset for a brand-new run (Play Again) - reuses removeItem() per entry so
   *  visual disposal and weight bookkeeping stay exactly the same as normal expel. */
  reset() {
    for (const item of [...this.items]) this.removeItem(item.id);
  }

  createInventoryVisual(type) {
    const config = RESOURCE_TYPES[type];
    const mesh = createResourceMesh(type, config.color);
    mesh.scale.setScalar(config.modelScale * INVENTORY_SCALE);
    return mesh;
  }

  getInventoryWeight() {
    return this.totalWeight;
  }

  getInventoryWeightRatio() {
    return this.totalWeight / this.maxWeight;
  }

  /**
   * Subtle suspended-in-fluid motion for everything currently inside Hollowdrop.
   * excludeItemId skips the item currently being drag-previewed by
   * InventoryInteractionController, which owns that item's position for the gesture.
   * item.isFusing skips any items currently animating toward the core as part of a
   * mutation (PlayerFormController owns their position during that window) - unlike
   * the single drag-previewed item, several can be fusing at once.
   */
  update(deltaTime, excludeItemId = null) {
    this._elapsed += deltaTime;
    for (const item of this.items) {
      if (item.id === excludeItemId || item.isFusing) continue;
      const t = this._elapsed * FLOAT_SPEED + item.phase;
      const bobAmount = FLOAT_AMPLITUDE / (1 + item.weight * BOB_WEIGHT_FACTOR);
      item.visualMesh.position.set(
        item.basePosition.x + Math.sin(t * 0.7) * bobAmount * 0.5,
        item.basePosition.y + Math.sin(t) * bobAmount,
        item.basePosition.z + Math.cos(t * 0.8) * bobAmount * 0.5
      );
      item.visualMesh.rotation.y += deltaTime * ROTATE_SPEED;
    }
  }
}
