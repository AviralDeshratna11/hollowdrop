/**
 * EndingCutscene: Manages the cinematic gameplay preview cutscene that plays
 * immediately upon entering the Ancient Gateway at the end of the prototype run.
 */
export class EndingCutscene {
  constructor() {
    this.overlay = document.getElementById('portal-cutscene');
    this.video = document.getElementById('portal-cutscene-video');
    this.skip = document.getElementById('cutscene-skip');
    this.sound = document.getElementById('cutscene-sound');
    this.progress = document.getElementById('cutscene-progress');

    this._setupSoundToggle();
  }

  _setupSoundToggle() {
    if (!this.sound || !this.video) return;
    this.sound.addEventListener('click', () => {
      this.video.muted = !this.video.muted;
      this._updateSoundButton();
    });
  }

  _updateSoundButton() {
    if (!this.sound || !this.video) return;
    const isMuted = this.video.muted;
    this.sound.textContent = isMuted ? 'Sound off' : 'Sound on';
    this.sound.setAttribute('aria-pressed', String(!isMuted));
  }

  play() {
    if (!this.overlay || !this.video) return Promise.resolve();
    if (this.pending) return this.pending;

    this.overlay.hidden = false;
    this.overlay.classList.remove('cutscene-leaving');
    this.overlay.classList.add('cutscene-active');
    document.body.classList.add('cutscene-playing');

    // Attempt unmuted playback first; mobile policies will fall back to muted
    this.video.muted = false;
    this._updateSoundButton();
    this.video.currentTime = 0;

    if (this.skip) this.skip.focus();

    this.pending = new Promise((resolve) => {
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;

        clearTimeout(timeout);
        clearInterval(tick);

        try { this.video.pause(); } catch (_) { /* no-op */ }

        this.video.removeEventListener('ended', finish);
        this.video.removeEventListener('error', finish);
        this.skip?.removeEventListener('click', finish);
        window.removeEventListener('keydown', onKey);

        this.overlay.classList.remove('cutscene-active');
        this.overlay.classList.add('cutscene-leaving');

        setTimeout(() => {
          this.overlay.hidden = true;
          this.overlay.classList.remove('cutscene-leaving');
          document.body.classList.remove('cutscene-playing');
          this.pending = null;
          resolve();
        }, 650);
      };

      const onKey = (e) => {
        if (e.key === 'Escape' || e.code === 'Space') {
          e.preventDefault();
          finish();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          if (this.skip && this.sound) {
            (document.activeElement === this.skip ? this.sound : this.skip).focus();
          }
        }
      };

      const tick = setInterval(() => {
        if (this.progress && this.video.duration) {
          const ratio = Math.min(1, Math.max(0, this.video.currentTime / this.video.duration));
          this.progress.style.transform = `scaleX(${ratio})`;
        }
      }, 100);

      // Playback timeout guard (35s) so the player can never be trapped
      const timeout = setTimeout(finish, 35000);

      this.skip?.addEventListener('click', finish);
      window.addEventListener('keydown', onKey);
      this.video.addEventListener('ended', finish);
      this.video.addEventListener('error', finish);

      // Try playing with sound; if browser policy blocks autoplay with sound, fall back to muted
      const playPromise = this.video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          this.video.muted = true;
          this._updateSoundButton();
          this.video.play().catch(finish);
        });
      }
    });

    return this.pending;
  }
}

