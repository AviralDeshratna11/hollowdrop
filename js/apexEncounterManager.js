import * as THREE from 'three';

const dressingRockGeometry = new THREE.DodecahedronGeometry(0.5, 0);
const dressingPlantBodyGeometry = new THREE.ConeGeometry(0.18, 0.6, 6);
const dressingPlantGlowGeometry = new THREE.SphereGeometry(0.08, 8, 6);

/** Scatters a handful of low-cost primitive props around the arena so the player
 *  reads "this area is dangerous" before anything actually happens - big dark rocks
 *  and glowing toxic-plant clusters, plus a tinted ground patch. Purely decorative,
 *  no interactivity, no per-frame update cost once built. */
function buildArenaDressing(scene, center, radius) {
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x140a1c, roughness: 1, transparent: true, opacity: 0.55 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.15, 32), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, 0.01, center.z);
  scene.add(ground);

  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1420, roughness: 0.9 });
  const rockCount = 6;
  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2 + Math.random() * 0.4;
    const dist = radius * (0.75 + Math.random() * 0.3);
    const rock = new THREE.Mesh(dressingRockGeometry, rockMaterial);
    rock.position.set(center.x + Math.cos(angle) * dist, 0.3, center.z + Math.sin(angle) * dist);
    rock.scale.setScalar(0.6 + Math.random() * 0.6);
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    scene.add(rock);
  }

  const plantBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x140a1e, roughness: 0.7 });
  const plantGlowMaterial = new THREE.MeshStandardMaterial({ color: 0xb23fff, emissive: 0xb23fff, emissiveIntensity: 1.1, roughness: 0.3 });
  const plantCount = 8;
  for (let i = 0; i < plantCount; i++) {
    const angle = (i / plantCount) * Math.PI * 2 + Math.random() * 0.5;
    const dist = radius * (0.4 + Math.random() * 0.55);
    const group = new THREE.Group();
    const body = new THREE.Mesh(dressingPlantBodyGeometry, plantBodyMaterial);
    body.position.y = 0.3;
    const glow = new THREE.Mesh(dressingPlantGlowGeometry, plantGlowMaterial);
    glow.position.y = 0.62;
    group.add(body, glow);
    group.position.set(center.x + Math.cos(angle) * dist, 0, center.z + Math.sin(angle) * dist);
    group.scale.setScalar(0.7 + Math.random() * 0.5);
    scene.add(group);
  }
}

/**
 * Owns the one-time "player entered Apex territory" trigger. Everything about the
 * encounter itself (intro, combat, phases, death) is ApexController's job - this
 * class only decides WHEN to call startEncounter(), plus the arena's decorative
 * dressing so the territory reads as dangerous even before it fires.
 */
export class ApexEncounterManager {
  constructor(scene, playerController, apexController, { arenaCenter, arenaRadius, triggerRadius }) {
    this.playerController = playerController;
    this.apexController = apexController;
    this.arenaCenter = arenaCenter.clone();
    this.triggerRadiusSq = triggerRadius ** 2;
    this.hasTriggered = false; // fires exactly once, ever - re-entering afterward never re-runs the intro

    buildArenaDressing(scene, this.arenaCenter, arenaRadius);
  }

  /** Full reset for a brand-new run (Play Again) - the one-time trigger fires again
   *  next run. Arena dressing is permanent decoration, never rebuilt. */
  reset() {
    this.hasTriggered = false;
  }

  update() {
    if (this.hasTriggered) return;
    const dx = this.playerController.mesh.position.x - this.arenaCenter.x;
    const dz = this.playerController.mesh.position.z - this.arenaCenter.z;
    if (dx * dx + dz * dz < this.triggerRadiusSq) {
      this.hasTriggered = true;
      this.apexController.startEncounter();
    }
  }
}
