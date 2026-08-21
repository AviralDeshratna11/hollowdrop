import * as THREE from 'three';

/** A simple two-sprite health bar (dark background + colored fill), billboarded
 *  automatically since THREE.Sprite always faces the camera regardless of its
 *  parent's rotation - no manual camera-facing math needed. Hidden by default;
 *  the owning controller/manager drives visibility/fill/fade via updateEntityHealthBar().
 *  Shared by Glow Beetle and Cave Stalker (and any future damageable entity) so the
 *  sprite-construction logic exists in exactly one place. */
export function createEntityHealthBar({ width = 0.5, fillWidth = 0.46, yOffset = 0.5, fillColor = 0xff5c5c } = {}) {
  const group = new THREE.Group();

  const bgMaterial = new THREE.SpriteMaterial({ color: 0x140a0a, transparent: true, opacity: 0, depthTest: false });
  const bg = new THREE.Sprite(bgMaterial);
  bg.scale.set(width, 0.08, 1);
  bg.position.y = yOffset;
  bg.renderOrder = 10;
  group.add(bg);

  const fillMaterial = new THREE.SpriteMaterial({ color: fillColor, transparent: true, opacity: 0, depthTest: false });
  const fill = new THREE.Sprite(fillMaterial);
  fill.scale.set(fillWidth, 0.05, 1);
  fill.position.y = yOffset;
  fill.renderOrder = 11;
  group.add(fill);

  group.userData = { bg, bgMaterial, fill, fillMaterial, fillWidth };
  return group;
}

/** Drives fill width/position + fade-out opacity from a health ratio and a visible-
 *  timer (seconds remaining on screen, or null to hide immediately/stay hidden).
 *  `fadeStart` is the timer value below which it starts fading rather than snapping off. */
export function updateEntityHealthBar(barGroup, healthRatio, visibleTimer, fadeStart) {
  const { fill, fillMaterial, bgMaterial, fillWidth } = barGroup.userData;

  if (visibleTimer === null) {
    if (fillMaterial.opacity !== 0) {
      fillMaterial.opacity = 0;
      bgMaterial.opacity = 0;
    }
    return;
  }

  const ratio = Math.max(healthRatio, 0);
  fill.scale.x = fillWidth * ratio;
  fill.position.x = -(fillWidth - fill.scale.x) / 2; // shrinks from the right, left edge stays fixed

  const opacity = visibleTimer < fadeStart ? Math.max(visibleTimer / fadeStart, 0) : 1;
  fillMaterial.opacity = opacity;
  bgMaterial.opacity = opacity * 0.7;
}
