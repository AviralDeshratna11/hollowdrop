import * as THREE from 'three';
import { FRAGMENT_STATES } from './genomeFragmentController.js?v=5.3';
import { getTerrainHeight } from './terrain.js?v=5.4';

export const DEBUG_FRAGMENT_CONTEST = false;

export const FRAGMENT_CONTEST_CONFIG = {
  extractionRadius: 1.5,
  contestResetDelay: 1.5, // spec section 58-59: forgiving reset, never a permanent failure
};

function createExtractionZoneMesh() {
  const group = new THREE.Group();

  const pedestalMaterial = new THREE.MeshStandardMaterial({
    color: 0x66766b,
    roughness: 0.94,
    flatShading: true,
    emissive: 0xffcf6b,
    emissiveIntensity: 0.015,
  });
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.85, 0.18, 9), pedestalMaterial);
  pedestal.position.y = 0.09;
  pedestal.castShadow = pedestal.receiveShadow = true;
  group.add(pedestal);

  // Carved concentric stonework stays subdued until the fragment powers it.
  const carving = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.515, 36), new THREE.MeshBasicMaterial({ color: 0x283d35, side: THREE.DoubleSide }));
  carving.rotation.x = -Math.PI / 2;
  carving.position.y = 0.183;
  group.add(carving);
  const runeMaterial = new THREE.MeshBasicMaterial({ color: 0xb7c59b });
  const runeGeometry = new THREE.BoxGeometry(0.035, 0.008, 0.09);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const rune = new THREE.Mesh(runeGeometry, runeMaterial);
    rune.position.set(Math.sin(angle) * 0.60, 0.185, Math.cos(angle) * 0.60);
    rune.rotation.y = angle;
    group.add(rune);
  }

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffcf6b,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.5, 32), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);

  // A soft, mostly-transparent open cylinder standing in for a "beam" - cheap,
  // no real light source, reads fine against this game's dark background.
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe9b8,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 12, 1, true), beamMaterial);
  beam.position.y = 2.4;
  group.add(beam);

  group.userData = { pedestalMaterial, ringMaterial, beamMaterial, ring };
  return group;
}

/**
 * Orchestrates the parts of the Fragment contest that don't belong inside either
 * GenomeFragmentController (Fragment visuals/ownership state) or RivalController
 * (Rival AI): the extraction zone itself (visual, activation, secure-triggering)
 * and the forgiving reset that follows a successful Rival escape. Reads
 * genomeFragmentController.fragment.state directly - never duplicates it.
 */
export class FragmentContestManager {
  constructor({ scene, playerController, genomeFragmentController, rivalController, uiManager, extractionPosition, resetSpawnPosition }) {
    this.scene = scene;
    this.playerController = playerController;
    this.genomeFragmentController = genomeFragmentController;
    this.rivalController = rivalController;
    this.uiManager = uiManager;
    this.extractionPosition = extractionPosition.clone();
    this.resetSpawnPosition = resetSpawnPosition.clone();

    this.extractionZoneVisual = createExtractionZoneMesh();
    this.realignToTerrain();
    scene.add(this.extractionZoneVisual);

    this._extractionActive = false;
    this._resetTimer = null;

    // The one place RivalController needs to call back up into contest-level
    // orchestration (its own escape channel completing) - wired here rather than
    // through the constructor since RivalController exists first.
    rivalController.fragmentContestManager = this;
  }

  realignToTerrain() {
    const { x, z } = this.extractionPosition;
    this.extractionPosition.y = getTerrainHeight(x, z);
    this.extractionZoneVisual.position.copy(this.extractionPosition);
    const normal = new THREE.Vector3(
      getTerrainHeight(x - 0.7, z) - getTerrainHeight(x + 0.7, z), 1.4,
      getTerrainHeight(x, z - 0.7) - getTerrainHeight(x, z + 0.7)
    ).normalize();
    this.extractionZoneVisual.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  }

  update(deltaTime) {
    this._updateExtractionActivation();
    this._updateExtractionVisual(deltaTime);
    this._updateExtractionCheck();
    this._updateResetTimer(deltaTime);
  }

  _updateExtractionActivation() {
    const fragment = this.genomeFragmentController.fragment;
    const shouldBeActive = !!fragment && fragment.state === FRAGMENT_STATES.CARRIED_BY_PLAYER;
    if (shouldBeActive === this._extractionActive) return;
    this._extractionActive = shouldBeActive;
    if (shouldBeActive) this.uiManager.showExtractionActivated();
  }

  _updateExtractionVisual(deltaTime) {
    const { ringMaterial, beamMaterial, pedestalMaterial, ring } = this.extractionZoneVisual.userData;
    const targetRingOpacity = this._extractionActive ? 0.7 : 0.08;
    const targetBeamOpacity = this._extractionActive ? 0.35 : 0;
    const targetPedestalIntensity = this._extractionActive ? 0.7 : 0.015;
    const smooth = 1 - Math.exp(-4 * deltaTime);
    ringMaterial.opacity += (targetRingOpacity - ringMaterial.opacity) * smooth;
    beamMaterial.opacity += (targetBeamOpacity - beamMaterial.opacity) * smooth;
    pedestalMaterial.emissiveIntensity += (targetPedestalIntensity - pedestalMaterial.emissiveIntensity) * smooth;
    ring.rotation.z += deltaTime * (this._extractionActive ? 0.8 : 0.2);
  }

  _updateExtractionCheck() {
    if (!this._extractionActive) return;
    const fragment = this.genomeFragmentController.fragment;
    if (!fragment || fragment.state !== FRAGMENT_STATES.CARRIED_BY_PLAYER) return;

    const distSq = this.playerController.mesh.position.distanceToSquared(this.extractionPosition);
    if (distSq < FRAGMENT_CONTEST_CONFIG.extractionRadius ** 2) {
      this.genomeFragmentController.secure();
      this._extractionActive = false; // deactivate immediately, don't wait for next frame's poll
    }
  }

  /** Called by RivalController once its escape channel finishes (spec section 58) -
   *  forgiving prototype behavior: never a hard failure, just a short delay before
   *  the Fragment is re-exposed and the contest resumes. */
  onRivalEscapeSuccess() {
    this.uiManager.showFragmentLost();
    this._resetTimer = FRAGMENT_CONTEST_CONFIG.contestResetDelay;
  }

  _updateResetTimer(deltaTime) {
    if (this._resetTimer === null) return;
    this._resetTimer -= deltaTime;
    if (this._resetTimer <= 0) {
      this._resetTimer = null;
      this.genomeFragmentController.spawn(this.resetSpawnPosition.clone());
      this.rivalController.notifyFragmentExposed();
    }
  }

  /** Full reset for a brand-new run (Play Again) - the extraction visual itself is
   *  permanent (never removed/recreated, per section 52), just snapped back to its
   *  dim resting look instead of lerping there over the next few frames. */
  reset() {
    this._extractionActive = false;
    this._resetTimer = null;
    const { ringMaterial, beamMaterial, pedestalMaterial } = this.extractionZoneVisual.userData;
    ringMaterial.opacity = 0.08;
    beamMaterial.opacity = 0;
    pedestalMaterial.emissiveIntensity = 0.015;
  }

  /** What the objective indicator should currently point at - null while there's
   *  nothing to point at (no Fragment in play, or it was just secured). */
  getObjectiveTarget() {
    const fragment = this.genomeFragmentController.fragment;
    if (!fragment) return null;
    if (fragment.state === FRAGMENT_STATES.CARRIED_BY_PLAYER) return this.extractionPosition;
    if (fragment.state === FRAGMENT_STATES.CARRIED_BY_RIVAL) return this.rivalController.mesh.position;
    return fragment.mesh.position; // EXPOSED or DROPPED
  }
}
