// InputController: turns a finger/mouse drag into a normalized direction + magnitude.
// Knows nothing about Three.js, the player, or movement speed — pure input state.
export class InputController {
  constructor(domElement, { deadZone = 12, maxDistance = 90, joystickElement = null } = {}) {
    this.domElement = domElement;
    this.deadZone = deadZone;
    this.maxDistance = maxDistance;

    // Purely-visual floating stick. Optional - movement works identically without it.
    // The container is centred on the touch point; its single child is the knob, moved
    // by a transform each pointermove. See index.html / style.css.
    this._joystickEl = joystickElement;
    this._joystickKnob = joystickElement ? joystickElement.querySelector('#move-joystick-knob') : null;

    this.activePointerId = null;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this._gestureGuard = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerEnd = this._onPointerEnd.bind(this);

    domElement.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    domElement.addEventListener('pointermove', this._onPointerMove, { passive: false });
    domElement.addEventListener('pointerup', this._onPointerEnd, { passive: false });
    domElement.addEventListener('pointercancel', this._onPointerEnd, { passive: false });
    domElement.addEventListener('pointerleave', this._onPointerEnd, { passive: false });
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Lets another system (item-expel gesture) claim a pointerdown before movement
   * does. Guard returns true if it claimed the pointer - movement then ignores it.
   */
  setGestureGuard(fn) {
    this._gestureGuard = fn;
  }

  _onPointerDown(e) {
    // Only one active pointer controls movement at a time.
    if (this.activePointerId !== null) return;
    if (this._gestureGuard && this._gestureGuard(e)) return;
    e.preventDefault();

    this.activePointerId = e.pointerId;
    this.isDragging = true;
    this.startX = this.currentX = e.clientX;
    this.startY = this.currentY = e.clientY;
    this._showJoystick(this.startX, this.startY);

    if (this.domElement.setPointerCapture) {
      try { this.domElement.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
    }
  }

  _onPointerMove(e) {
    if (!this.isDragging || e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    this.currentX = e.clientX;
    this.currentY = e.clientY;
    this._moveJoystick(this.currentX - this.startX, this.currentY - this.startY);
  }

  _onPointerEnd(e) {
    if (e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    this.isDragging = false;
    this.activePointerId = null;
    this._hideJoystick();
  }

  /** Clears any in-progress drag (e.g. when a UI overlay opens mid-swipe). */
  cancel() {
    this.isDragging = false;
    this.activePointerId = null;
    this._hideJoystick();
  }

  // --- Visual joystick ---------------------------------------------------------
  // No-ops when no joystickElement was passed. Coordinates are viewport-space
  // (clientX/clientY), which is exactly what the container's position:fixed expects.

  _showJoystick(x, y) {
    if (!this._joystickEl) return;
    this._joystickEl.style.left = `${x}px`;
    this._joystickEl.style.top = `${y}px`;
    if (this._joystickKnob) this._joystickKnob.style.transform = 'translate(0px, 0px)';
    this._joystickEl.classList.add('is-active');
  }

  _moveJoystick(dx, dy) {
    if (!this._joystickKnob) return;
    const distance = Math.sqrt(dx * dx + dy * dy);
    // Clamp the knob to the ring edge (ring radius === maxDistance, see style.css) so it
    // visually saturates at the same point the movement magnitude does.
    const scale = distance > this.maxDistance ? this.maxDistance / distance : 1;
    this._joystickKnob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
  }

  _hideJoystick() {
    if (!this._joystickEl) return;
    this._joystickEl.classList.remove('is-active');
  }

  /**
   * Returns the current swipe as a normalized direction + 0..1 magnitude.
   * Screen-space dx/dy map directly to world x/z (see main.js), so:
   *   swipe right -> x > 0, swipe down -> y > 0
   */
  getMovementInput() {
    if (!this.isDragging) {
      return { x: 0, y: 0, magnitude: 0 };
    }

    const dx = this.currentX - this.startX;
    const dy = this.currentY - this.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < this.deadZone) {
      return { x: 0, y: 0, magnitude: 0 };
    }

    const clampedDistance = Math.min(distance, this.maxDistance);
    const effectiveRange = Math.max(this.maxDistance - this.deadZone, 1e-6);
    const magnitude = Math.min(Math.max((clampedDistance - this.deadZone) / effectiveRange, 0), 1);

    return {
      x: dx / distance,
      y: dy / distance,
      magnitude,
    };
  }

  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerup', this._onPointerEnd);
    this.domElement.removeEventListener('pointercancel', this._onPointerEnd);
    this.domElement.removeEventListener('pointerleave', this._onPointerEnd);
  }
}
