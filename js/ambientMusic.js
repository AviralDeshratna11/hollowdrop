export const DEBUG_AMBIENT_MUSIC = false;

const AMBIENT_MUSIC_CONFIG = {
  src: 'assets/audio/ambient-theme.mp3',
  volume: 0.28,
};

/**
 * A single looping background track, played underneath the whole game (title through
 * gameplay through the results screen) rather than being tied to GAME_STATES - it's an
 * ambient bed, not a gameplay system, so it doesn't belong in the isPlayingState gate
 * animate() uses for AI/physics/timers.
 */
export class AmbientMusicController {
  constructor() {
    this.audio = new Audio(AMBIENT_MUSIC_CONFIG.src);
    this.audio.loop = true;
    this.audio.volume = AMBIENT_MUSIC_CONFIG.volume;
    this.audio.preload = 'auto';
    this._started = false;
  }

  /** Must be called synchronously from inside a user-gesture handler (the Title screen's
   *  Begin tap) - browsers reject audio-with-sound started any other way. Safe to call
   *  more than once; only the first call does anything. */
  start() {
    if (this._started) return;
    this._started = true;
    this.audio.play().catch((err) => {
      if (DEBUG_AMBIENT_MUSIC) console.warn('[ambientMusic] play() rejected', err);
    });
  }

  setMuted(muted) {
    this.audio.muted = muted;
  }
}
