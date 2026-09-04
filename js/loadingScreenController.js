import { assetLoadingManager } from './loadingManager.js?v=5.3';

export const DEBUG_LOADING_SCREEN = false;

// Never blocks the player past this, even if the character FBX bundles are still
// streaming in - mirrors the reasoning behind GAME_FLOW_CONFIG.maxModelWaitSeconds in
// gameFlowController.js (a run that never starts is worse than an imperfect load), just
// with its own, slightly larger budget since this screen's assetLoadingManager tracks
// MORE items (ground texture + both character bundles) than that later, narrower wait
// (just the player's own model) does.
const MAX_LOADING_SCREEN_SECONDS = 5;

// Driven by setInterval, not requestAnimationFrame. This used to run every animation
// frame (up to 120/sec on a high-refresh phone) recomputing 6 CSS custom properties
// plus an SVG stroke-dashoffset, at the exact moment the browser is ALSO fetching and
// linking ~60 JS modules and decoding the ground texture - real, measured jank on a
// real device. A slow, 6-second-per-theme color cycle and a progress ring don't need
// 60+ updates/sec to read as smooth; 10/sec (every 100ms) is indistinguishable to the
// eye here and is an order of magnitude less work.
const TICK_MS = 100;
const TICK_SECONDS = TICK_MS / 1000;

// --- Ring motion ------------------------------------------------------------------
// The ring is deliberately NOT a direct readout of itemsLoaded/itemsTotal. Three
// things about the real numbers make that read as jitter rather than progress:
//   - There are only a handful of tracked items, so each one is a large jump. This
//     got MORE pronounced when the characters became single GLBs with embedded
//     textures: each one used to be five items (an FBX plus four PBR maps) and is
//     now one, so the item count dropped by roughly two thirds.
//   - Those character models are the overwhelming majority of the BYTES but only a
//     few of the items, so the ring would sit dead still for seconds at a time.
//   - itemsTotal can still GROW mid-load, since a loader only registers with the
//     manager once it actually calls for a file, so loaded/total can genuinely drop
//     - the ring would visibly run backwards.
// So: the real number only ever ratchets forward (_realProgress), a creep keeps the
// ring moving while nothing is reporting, and the displayed value eases toward
// whichever is further along. Combined with the CSS transition on stroke-dashoffset
// (see style.css), what you see is continuous motion that always ends at a true 100%.
const DISPLAY_SMOOTHING = 0.2; // per-tick lerp fraction toward the target
// Ceiling on one tick's movement. A single item landing can move the real number by a
// lot at once (~9% measured, and far more once itemsTotal is small); letting the ring
// chase that in one step is the "jumps rather than fills" look. Capped, the ring just
// takes an extra tick or two to catch up - it is always allowed to lag reality, and
// the completion sweep guarantees it still ends at a true 100% regardless.
const DISPLAY_MAX_STEP = 0.06;
const CREEP_CEILING = 0.9; // creep alone never implies "done" - only real completion does
const CREEP_RATE = 0.035; // per tick, asymptotic - fast at first, slower near the ceiling

// Completion: once loading is actually done, the ring finishes filling before the
// Begin button is allowed to appear. A minimum step keeps that final sweep brisk even
// when completion arrives while the ring is still low.
const COMPLETION_SMOOTHING = 0.3;
const COMPLETION_MIN_STEP = 0.03;
// Ceiling on how far the ring may travel in one tick while completing. Without it, a
// warm cache (everything already loaded, onLoad firing while the ring is still near
// zero) makes that first proportional step a ~30% lurch - measured, not theoretical.
// Capped, the final sweep always reads as a deliberate fill instead of a jump.
const COMPLETION_MAX_STEP = 0.08;
const COMPLETION_EPSILON = 0.995; // treat as full, then snap to exactly 1
// Beat between the ring reading 100% and the swap to the Begin button - long enough
// that the completed ring is actually seen (the CSS transition above needs 0.22s of
// it just to land), rather than the fill and the swap happening in the same instant.
const COMPLETE_HOLD_MS = 450;

const STATUS_MESSAGES = [
  'Calibrating membrane…',
  'Warming cave lighting…',
  'Loading terrain…',
  'Adapting form…',
  'Nearly there…',
];
const STATUS_INTERVAL_SECONDS = 1.8;

// Color stops the screen continuously cycles through (RGB triples) - same accent/bg/
// text channel families style.css already uses elsewhere (--accent-rgb etc.), just
// with three more moods added so the screen doesn't always look identical. Cave Mint
// matches the game's actual --accent-rgb/--bg/--text today; the other three are new,
// game-appropriate palettes (toxic bloom, ember rot, abyssal blue) rather than anything
// pulled from a real system color, so there's no single source of truth to point back
// to for them.
const THEMES = [
  { accent: [124, 255, 178], bright: [157, 255, 207], dim: [108, 242, 164], bg: [10, 20, 16], bgDeep: [5, 16, 12], text: [234, 255, 242] }, // Cave Mint
  { accent: [255, 45, 158], bright: [255, 142, 207], dim: [224, 64, 154], bg: [22, 8, 20], bgDeep: [13, 4, 12], text: [255, 231, 243] }, // Toxic Bloom
  { accent: [255, 138, 61], bright: [255, 207, 107], dim: [226, 145, 63], bg: [22, 14, 8], bgDeep: [13, 8, 5], text: [255, 241, 230] }, // Ember Rot
  { accent: [108, 217, 255], bright: [168, 235, 255], dim: [79, 184, 224], bg: [4, 18, 26], bgDeep: [2, 10, 16], text: [230, 251, 255] }, // Abyssal Blue
];
const SECONDS_PER_THEME = 6;

// Precomputed once at module load - the per-tick path shouldn't be doing RGB->HSL
// conversions for values that never change.
const THEMES_HSL = THEMES.map((t) => ({
  accent: rgbToHsl(t.accent),
  bright: rgbToHsl(t.bright),
  dim: rgbToHsl(t.dim),
}));

function lerp(a, b, u) {
  return a + (b - a) * u;
}
function lerpRgb(a, b, u) {
  return [Math.round(lerp(a[0], b[0], u)), Math.round(lerp(a[1], b[1], u)), Math.round(lerp(a[2], b[2], u))];
}

// --- Color interpolation ------------------------------------------------------------
// The saturated channels (accent/bright/dim) are crossfaded through HSL, not RGB.
// Straight RGB interpolation between two saturated colors on opposite sides of the
// wheel travels through the middle of the color cube - i.e. through grey. Mint ->
// toxic pink spent its entire crossfade as a dull mauve (measured: 183 160 169 at the
// midpoint, a flat grey) which is the opposite of the effect this screen is for.
// Rotating the hue instead keeps every in-between frame as saturated as its endpoints.
//
// The bg/bgDeep/text channels stay on plain RGB: they are near-black and near-white,
// where there is no meaningful hue to preserve and HSL's behaviour near the extremes
// is the fussier of the two.
function rgbToHsl([r, g, b]) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)];
}

/** Shortest signed arc from h0 to h1, in (-180, 180]. */
function hueDelta(h0, h1) {
  let d = h1 - h0;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Which way around the wheel this theme-to-theme step turns, decided ONCE from the
// accent channel and then forced on the others.
//
// Why it has to be forced: accent/bright/dim are three tints of a single identity
// color, so their hues sit within a few degrees of each other - but every step between
// these four themes happens to be almost exactly 180 degrees, which is precisely where
// "shortest arc" flips sign on a rounding difference. Resolved per channel, they
// split: the accent turned down through amber while bright turned up through blue, so
// on screen the blob went yellow-green while the title went periwinkle. One decision,
// applied to all three, keeps them the same color family the whole way across.
function rotationDirection(accentA, accentB) {
  return hueDelta(accentA[0], accentB[0]) >= 0 ? 1 : -1;
}

function lerpHslToRgb(a, b, u, dir) {
  let d = hueDelta(a[0], b[0]);
  // Same endpoint either way (they differ by a full turn) - this just picks the side.
  if (d !== 0 && Math.sign(d) !== dir) d += dir * 360;
  return hslToRgb([a[0] + d * u, lerp(a[1], b[1], u), lerp(a[2], b[2], u)]);
}

// Plain `%` keeps the sign of its LEFT operand in JS (unlike most languages), so a
// cycle clock that's ever even slightly negative produces a negative array index
// downstream. cycleT is only ever incremented by a fixed, positive TICK_SECONDS here
// (no wall-clock delta involved any more - see the setInterval note above), so this
// can't actually go negative in practice, but the guard is cheap insurance against
// this file's own next edit reintroducing that class of bug. Always returns [0, m).
function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * Drives the loading half of #title-screen (see that element's own long comment in
 * index.html for why this is folded into the title screen rather than a separate
 * overlay): the color-cycling background, the progress ring, and the cycling status
 * line, from first paint until the assets tracked by the shared assetLoadingManager
 * (loadingManager.js) finish or MAX_LOADING_SCREEN_SECONDS elapses - whichever comes
 * first.
 *
 * That moment starts the completion sequence rather than ending the screen: the ring
 * fills the rest of the way to a true 100%, holds there long enough to be seen, and
 * only THEN is #title-loading hidden and #title-begin-button revealed. The button
 * never appears beside a half-filled ring.
 *
 * After that it stops ticking entirely - there is no reason to keep recomputing
 * colors/progress for a screen that may now sit idle waiting for a tap.
 */
export class LoadingScreenController {
  constructor() {
    this._loadingEl = document.getElementById('title-loading');
    this._beginButton = document.getElementById('title-begin-button');
    this._ring = document.getElementById('title-loading-ring-progress');
    this._statusEl = document.getElementById('title-loading-status');

    // Read the ring's own radius from the DOM rather than hardcoding the circumference,
    // so a future tweak to the SVG's r= doesn't silently desync from this file. (The
    // dasharray itself is already set as a static attribute in index.html, matching
    // this same r=, so the ring reads as empty from the very first paint - before this
    // constructor has even run.)
    const radius = Number(this._ring.getAttribute('r'));
    this._ringCircumference = 2 * Math.PI * radius;

    this._display = 0; // what the ring actually shows, 0..1 - never decreases
    this._realProgress = 0; // high-water mark of what the manager has reported, 0..1
    this._creep = 0; // keeps the ring moving between (or without) real progress events
    this._completing = false; // loading is done; ring is filling to a true 100%
    this._finishScheduled = false;
    this._cycleT = 0;
    this._statusT = 0;
    this._statusIndex = 0;
    this._active = true;

    assetLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
      const reported = itemsTotal > 0 ? itemsLoaded / itemsTotal : 0;
      // Ratchet, never assign: itemsTotal grows as later loads register, so `reported`
      // can legitimately come back lower than last time (see the note above).
      if (reported > this._realProgress) this._realProgress = reported;
      if (DEBUG_LOADING_SCREEN) console.log('[loadingScreenController] progress', url, itemsLoaded, '/', itemsTotal);
    };
    assetLoadingManager.onLoad = () => {
      if (DEBUG_LOADING_SCREEN) console.log('[loadingScreenController] onLoad - all tracked assets settled');
      this._beginCompletion();
    };
    assetLoadingManager.onError = (url) => {
      // One failed texture/model shouldn't hang the loading screen forever - the
      // player/rat modules already tolerate a failed fetch (placeholder stays up,
      // see playerSlimeModel.js), so this screen should too.
      console.warn('[loadingScreenController] asset failed to load:', url);
    };

    this._timeoutId = setTimeout(() => {
      if (DEBUG_LOADING_SCREEN) console.log('[loadingScreenController] MAX_LOADING_SCREEN_SECONDS reached, completing anyway');
      this._beginCompletion();
    }, MAX_LOADING_SCREEN_SECONDS * 1000);

    this._intervalId = setInterval(() => this._tick(), TICK_MS);
  }

  /** Loading is done (really, or by timeout): stop creeping and drive the ring to a
   *  true 100%. The Begin button is NOT revealed here - that only happens in _finish(),
   *  once the ring has actually got there and been held long enough to be seen. */
  _beginCompletion() {
    if (!this._active || this._completing) return;
    this._completing = true;
    clearTimeout(this._timeoutId);
  }

  _finish() {
    if (!this._active) return;
    this._active = false;
    clearInterval(this._intervalId);
    this._loadingEl.hidden = true;
    this._beginButton.hidden = false;
  }

  _applyColorFrame() {
    const total = THEMES.length * SECONDS_PER_THEME;
    const t = mod(this._cycleT, total);
    const segF = t / SECONDS_PER_THEME;
    const i0 = Math.floor(segF) % THEMES.length;
    const i1 = (i0 + 1) % THEMES.length;
    const u = segF - Math.floor(segF);
    const a = THEMES[i0];
    const b = THEMES[i1];
    const aH = THEMES_HSL[i0];
    const bH = THEMES_HSL[i1];

    const root = document.documentElement.style;
    // Saturated channels rotate through hue, all three the same way around the wheel;
    // the near-black/near-white ones don't rotate at all (see lerpHslToRgb above).
    const dir = rotationDirection(aH.accent, bH.accent);
    root.setProperty('--loading-accent-rgb', lerpHslToRgb(aH.accent, bH.accent, u, dir).join(' '));
    root.setProperty('--loading-accent-bright-rgb', lerpHslToRgb(aH.bright, bH.bright, u, dir).join(' '));
    root.setProperty('--loading-accent-dim-rgb', lerpHslToRgb(aH.dim, bH.dim, u, dir).join(' '));
    root.setProperty('--loading-bg-rgb', lerpRgb(a.bg, b.bg, u).join(' '));
    root.setProperty('--loading-bg-deep-rgb', lerpRgb(a.bgDeep, b.bgDeep, u).join(' '));
    root.setProperty('--loading-text-rgb', lerpRgb(a.text, b.text, u).join(' '));
  }

  _tick() {
    this._cycleT += TICK_SECONDS;
    this._applyColorFrame();

    if (this._completing) {
      // Proportional easing plus a floor, so the last sweep to full is quick even when
      // completion lands while the ring is still low (a warm cache finishes almost
      // immediately, with the ring barely started).
      const remaining = 1 - this._display;
      const eased = Math.max(remaining * COMPLETION_SMOOTHING, Math.min(COMPLETION_MIN_STEP, remaining));
      this._display += Math.min(eased, COMPLETION_MAX_STEP);

      if (this._display >= COMPLETION_EPSILON) {
        this._display = 1;
        this._writeRing();
        if (!this._finishScheduled) {
          this._finishScheduled = true;
          setTimeout(() => this._finish(), COMPLETE_HOLD_MS);
        }
        return; // ring is full; nothing left to animate but the hold
      }
    } else {
      this._creep += (CREEP_CEILING - this._creep) * CREEP_RATE;
      // Both inputs only ever increase, so the target - and therefore the ring - can
      // never run backwards.
      const target = Math.max(this._realProgress, this._creep);
      this._display += Math.min((target - this._display) * DISPLAY_SMOOTHING, DISPLAY_MAX_STEP);
    }

    this._writeRing();

    this._statusT += TICK_SECONDS;
    if (this._statusT >= STATUS_INTERVAL_SECONDS) {
      this._statusT -= STATUS_INTERVAL_SECONDS;
      this._statusIndex = (this._statusIndex + 1) % STATUS_MESSAGES.length;
      this._statusEl.textContent = STATUS_MESSAGES[this._statusIndex];
    }
  }

  _writeRing() {
    this._ring.style.strokeDashoffset = String(this._ringCircumference * (1 - this._display));
  }
}
