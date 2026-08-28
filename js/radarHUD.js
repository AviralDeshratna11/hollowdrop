import { RADAR_TARGET_TYPES } from './radarController.js';

// One simple, single-color line-art icon per target type (spec section 60 - "no emoji,
// stylistically consistent"). fill/stroke both use currentColor so each blip's own CSS
// class (see style.css's --radar-* variables) is the only thing that colors it.
// Badge-style icons (each sits inside the colored circular bloom set up in style.css's
// .radar-blip--<type> .radar-blip-inner rules) - redesigned to read closer to the
// reference concept art's skull / octopus / DNA-helix badges rather than bare shapes.
const BLIP_ICONS = {
  [RADAR_TARGET_TYPES.ENEMY]: '<svg viewBox="0 0 24 24"><path d="M12 3c-4 0-7 3-7 7 0 2.5 1.3 4 2 5v3h2v-2h1.5v2h3v-2H15v2h2v-3c.7-1 2-2.5 2-5 0-4-3-7-7-7Z" fill="currentColor"/><path d="M6.5 9 4 6.5 M17.5 9 20 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="9.3" cy="10" r="1.4" fill="#050806"/><circle cx="14.7" cy="10" r="1.4" fill="#050806"/></svg>',
  [RADAR_TARGET_TYPES.BOSS]: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="9.5" rx="7" ry="6" fill="currentColor"/><path d="M6.5 12 Q5.5 17 7.5 19.5 M8.5 13 Q8 18.5 10 20.5 M11.3 13.5 Q11.3 19.5 12.3 21.5 M13.7 13.5 Q14.2 19.5 12.8 21.5 M17.5 12 Q19 17 17 19.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="9.2" cy="8.5" r="1.3" fill="#050806"/><circle cx="14.8" cy="8.5" r="1.3" fill="#050806"/></svg>',
  [RADAR_TARGET_TYPES.DNA]: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 3c0 6 10 6 10 12 0 3-3 5-3 5M17 3c0 6-10 6-10 12 0 3 3 5 3 5" /><path d="M8 7h8M7.5 12h9M8 17h8" stroke-width="1.4" /></svg>',
  [RADAR_TARGET_TYPES.GENOME]: '<svg viewBox="0 0 24 24"><path d="M12 2 21 12 12 22 3 12Z" fill="currentColor"/><path d="M12 6 17 12 12 18 7 12Z" fill="#050806" opacity="0.55"/></svg>',
  [RADAR_TARGET_TYPES.RIVAL]: '<svg viewBox="0 0 24 24"><path d="M12 2c3 3 6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 3-8 6-11Z" fill="currentColor"/></svg>',
  // Same bag silhouette as the inventory-toggle button (index.html) - the dropped-cargo
  // marker reads as "your bag is over there".
  [RADAR_TARGET_TYPES.DEATH_DROP]: '<svg viewBox="0 0 24 24"><path d="M8.5 8 L9.5 4 A2.5 2.5 0 0 1 14.5 4 L15.5 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 8 H18 L16.7 18.5 A2.6 2.6 0 0 1 14.1 21 H9.9 A2.6 2.6 0 0 1 7.3 18.5 Z" fill="currentColor"/></svg>',
};

const NEAREST_LABELS = {
  [RADAR_TARGET_TYPES.ENEMY]: 'HOSTILE',
  [RADAR_TARGET_TYPES.BOSS]: 'APEX',
  [RADAR_TARGET_TYPES.DNA]: 'DNA',
  [RADAR_TARGET_TYPES.GENOME]: 'GENOME',
  [RADAR_TARGET_TYPES.RIVAL]: 'RIVAL',
  [RADAR_TARGET_TYPES.DEATH_DROP]: 'CARGO',
};

const BLIP_LERP_RATE = 12; // matches this project's usual 1 - exp(-rate * dt) smoothing idiom
const PING_ANIMATION_MS = 900; // fallback removal if 'animationend' is ever missed (backgrounded tab, etc.)

/**
 * Species-Seeker Radar - DOM/rendering half (see radarController.js for the target
 * collection/classification/priority logic this only ever reads, never duplicates).
 *
 * Owns the compact <-> expanded toggle, blip element pooling (spec section 35 - reused
 * by id across scans, created on first appearance, removed the moment a target is no
 * longer reported), the smooth per-frame interpolation between the controller's ~10Hz
 * scans, the decorative sweep/compass, and touch isolation (a tap here must never reach
 * player movement/Bite/inventory - see _attachInteraction).
 */
export class RadarHUD {
  constructor(radarController, { onApexSignal } = {}) {
    this.radarController = radarController;
    this.onApexSignal = onApexSignal;

    this.root = document.getElementById('species-radar');
    this.display = document.getElementById('radar-display');
    this.blipsContainer = document.getElementById('radar-blips');
    this.compass = document.getElementById('radar-compass');
    this.beam = document.getElementById('radar-beam');
    this.nearestEl = document.getElementById('radar-nearest');
    this.closeButton = document.getElementById('radar-close');

    this.visible = true;
    this.expanded = false;
    this._radiusPx = 1;
    this._blipPool = new Map(); // id -> { el, x, y, targetX, targetY, type }
    this._hasShownApexSignal = false;

    // One-time fill for the compact mini-legend's badges (index.html) - the SAME icon
    // svg each matching blip uses, so "what's that dot" and "what's in the legend"
    // never drift apart.
    this.root?.querySelectorAll('[data-radar-icon]').forEach((el) => {
      el.innerHTML = BLIP_ICONS[el.dataset.radarIcon] ?? '';
    });

    this._measureRadius();
    this._attachInteraction();
    window.addEventListener('resize', () => this._measureRadius());
  }

  /** Spec section 56 - TITLE/MEMORY/RUN_COMPLETE hide the whole radar; PLAYING shows it.
   *  Mirrors RadarController.setEnabled() (main.js drives both together) but this is the
   *  one that actually controls DOM visibility. */
  setVisible(visible) {
    this.visible = visible;
    this.root?.classList.toggle('species-radar--hidden', !visible);
  }

  /** Play Again (spec section 58) - collapses back to compact, clears every pooled blip
   *  element immediately rather than letting them fade out over the next few scans, and
   *  re-arms the one-shot Apex signal toast for the new run. */
  reset() {
    if (this.expanded) this._setExpanded(false);
    for (const entry of this._blipPool.values()) entry.el.remove();
    this._blipPool.clear();
    this._hasShownApexSignal = false;
    if (this.nearestEl) this.nearestEl.textContent = '';
    if (this.beam) this.beam.style.opacity = '0';
  }

  update(deltaTime) {
    if (!this.visible || !this.root) return;

    const blips = this.radarController.getBlips();
    this._reconcileBlips(blips);

    const lerp = 1 - Math.exp(-BLIP_LERP_RATE * deltaTime);
    for (const entry of this._blipPool.values()) {
      entry.x += (entry.targetX - entry.x) * lerp;
      entry.y += (entry.targetY - entry.y) * lerp;
      entry.el.style.transform = `translate(${entry.x * this._radiusPx}px, ${entry.y * this._radiusPx}px)`;
    }

    this._updateCompass();
    this._updateNearestLabel();
    this._updateBeam();
  }

  // --- Blip pooling --------------------------------------------------------------

  _reconcileBlips(blips) {
    const present = new Set();
    for (const blip of blips) {
      present.add(blip.id);
      let entry = this._blipPool.get(blip.id);
      if (!entry) {
        entry = this._createBlipEntry(blip);
        this._blipPool.set(blip.id, entry);
      }
      this._updateBlipEntry(entry, blip);

      if (blip.type === RADAR_TARGET_TYPES.BOSS && blip.firstDetection && !this._hasShownApexSignal) {
        this._hasShownApexSignal = true;
        this.onApexSignal?.();
      }
    }

    // Anything pooled but not reported this scan is gone (dead, absorbed, secured, out
    // of range) - remove immediately (spec section 59: "should happen automatically").
    for (const [id, entry] of this._blipPool) {
      if (!present.has(id)) {
        entry.el.remove();
        this._blipPool.delete(id);
      }
    }
  }

  _createBlipEntry(blip) {
    const el = document.createElement('div');
    el.className = `radar-blip radar-blip--${blip.type}`;
    // The icon/badge lives on a separate CHILD element (.radar-blip-inner), not on this
    // outer wrapper directly - see the comment on .radar-blip in style.css for why: this
    // element only ever receives a per-frame inline `transform` from JS (below), while
    // the pulse animation and badge background/border live entirely in CSS on the child.
    const inner = document.createElement('div');
    inner.className = 'radar-blip-inner';
    inner.innerHTML = BLIP_ICONS[blip.type] ?? '';
    el.appendChild(inner);
    this.blipsContainer.appendChild(el);
    return { el, x: blip.x, y: blip.y, targetX: blip.x, targetY: blip.y, type: blip.type };
  }

  _updateBlipEntry(entry, blip) {
    entry.targetX = blip.x;
    entry.targetY = blip.y;
    entry.el.classList.toggle('radar-blip--clamped', blip.clamped);
    entry.el.classList.toggle('radar-blip--close', blip.close);
    entry.el.classList.toggle('radar-blip--chasing', blip.chasing);
    entry.el.classList.toggle('radar-blip--carrying-genome', blip.carryingGenome);
    if (blip.firstDetection) this._triggerPing(entry.el);
  }

  /** A ring that expands and fades from the blip once, the moment it's first detected
   *  (spec section 34) - a transient child element rather than a class toggle, since
   *  several pings could conceivably need to overlap in flight (not really possible at
   *  this scan rate in practice, but avoids fighting a shared animation state either way). */
  _triggerPing(el) {
    const ping = document.createElement('span');
    ping.className = 'radar-ping';
    el.appendChild(ping);
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      ping.remove();
    };
    ping.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, PING_ANIMATION_MS); // safety net - a backgrounded tab can miss animationend entirely
  }

  /** Directional lock-on beam toward the current highest-priority signal (spec-inspired
   *  addition matching the reference art's beam toward its Boss blip). getNearestSignal()
   *  already returns that target's x/y in the SAME player-relative screen space a blip's
   *  own translate() uses, so - like a blip - this needs no separate heading correction,
   *  just the angle from center to that point. atan2(x, -y) rather than the more usual
   *  atan2(y, x): 0 rad must mean "pointing up" (screen -y) to match both the player
   *  marker's own resting orientation and rotate()'s clockwise-positive convention. */
  _updateBeam() {
    if (!this.beam) return;
    const nearest = this.radarController.getNearestSignal();
    if (!nearest) {
      this.beam.style.opacity = '0';
      return;
    }
    const angle = Math.atan2(nearest.x, -nearest.y);
    this.beam.style.transform = `rotate(${angle}rad)`;
    this.beam.style.opacity = '1';
  }

  // --- Compass / nearest-signal readout --------------------------------------------

  _updateCompass() {
    if (!this.compass) return;
    const heading = this.radarController.player.rotation.y;
    // #radar-compass is `inset: 0` (not left/top: 50% + a centering translate), so a
    // plain rotate() around its own center is all that's needed here.
    this.compass.style.transform = `rotate(${heading}rad)`;
  }

  _updateNearestLabel() {
    if (!this.nearestEl) return;
    const nearest = this.radarController.getNearestSignal();
    if (!nearest) {
      this.nearestEl.textContent = '';
      this.nearestEl.classList.remove('radar-nearest--visible');
      return;
    }
    const label = nearest.carryingGenome ? 'RIVAL + GENOME' : (NEAREST_LABELS[nearest.type] ?? nearest.label ?? '');
    this.nearestEl.textContent = `${label} • ${Math.round(nearest.distance)}m`;
    this.nearestEl.classList.add('radar-nearest--visible');
  }

  // --- Compact <-> expanded ---------------------------------------------------------

  _attachInteraction() {
    // Both the compact radar's own display AND the expanded view's close button toggle
    // it - spec section 52 explicitly allows either. stopPropagation/preventDefault on
    // every handler (spec section 50) so a tap here can never reach movement, Bite, or
    // an inventory gesture underneath.
    const toggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._setExpanded(!this.expanded);
    };
    this.display?.addEventListener('pointerdown', toggle);
    this.closeButton?.addEventListener('pointerdown', toggle);
    // The full-screen expanded backdrop itself (tapping outside the panel) also closes -
    // but only when the tap target IS the backdrop, not something inside the panel.
    this.root?.addEventListener('pointerdown', (e) => {
      if (this.expanded && e.target === this.root) toggle(e);
    });
  }

  _setExpanded(expanded) {
    this.expanded = expanded;
    this.root?.classList.toggle('species-radar--expanded', expanded);
    this._measureRadius();
  }

  /** Cached rather than measured every frame (getBoundingClientRect forces layout) -
   *  only actually changes on window resize or the compact/expanded transition, both
   *  already their own explicit call sites. */
  _measureRadius() {
    if (!this.display) return;
    const rect = this.display.getBoundingClientRect();
    this._radiusPx = Math.min(rect.width, rect.height) / 2;
  }
}
