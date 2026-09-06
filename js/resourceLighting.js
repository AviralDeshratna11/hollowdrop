import * as THREE from 'three';

/** Four shared local lights give nearby fungi a pool of light on the stone.
 * Pooling avoids compiling a light for every collectible in the entire world. */
export function createResourceLighting(scene, resourceManager, player) {
  const lights = Array.from({ length: 4 }, () => {
    const light = new THREE.PointLight(0x37cbec, 0, 2.2, 2);
    scene.add(light);
    return light;
  });
  let elapsed = 1;
  let sources = [];
  return {
    update(deltaTime) {
      elapsed += deltaTime;
      if (elapsed > 0.2) {
        elapsed = 0;
        sources = resourceManager.resources.filter(r =>
          ['blue_mushroom', 'mushroom', 'iron'].includes(r.type) &&
          r.state === 'idle' && r.mesh.position.distanceToSquared(player.position) < 64
        ).sort((a, b) => a.mesh.position.distanceToSquared(player.position) - b.mesh.position.distanceToSquared(player.position)).slice(0, 4);
      }
      lights.forEach((light, i) => {
        const source = sources[i];
        if (!source || !source.mesh.parent || source.state !== 'idle') { light.intensity = 0; return; }
        light.position.copy(source.mesh.position);
        light.position.y += 0.35;
        light.color.set(source.type === 'mushroom' ? 0xbc48ed : 0x21bddd);
        light.intensity = source.type === 'iron' ? 0.45 : 1.1;
      });
    },
  };
}
