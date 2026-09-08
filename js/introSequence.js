/** Video is started directly inside the Begin gesture for mobile playback. */
export class IntroSequence {
  constructor() {
    this.overlay = document.getElementById('cavern-intro');
    this.video = document.getElementById('intro-video');
    this.skip = document.getElementById('intro-skip');
    this.sound = document.getElementById('intro-sound');
    this.progress = document.getElementById('intro-progress');
    this.sound.addEventListener('click', () => {
      this.video.muted = !this.video.muted;
      this.sound.textContent = this.video.muted ? 'Sound off' : 'Sound on';
      this.sound.setAttribute('aria-pressed', String(!this.video.muted));
    });
  }

  play() {
    if (this.pending) return this.pending;
    this.overlay.hidden = false;
    document.body.classList.add('intro-playing');
    this.video.muted = true;
    this.video.currentTime = 0;
    this.skip.focus();
    this.pending = new Promise(resolve => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout); clearInterval(tick);
        this.video.pause();
        this.video.removeEventListener('ended', finish);
        this.video.removeEventListener('error', finish);
        this.skip.removeEventListener('click', finish);
        this.overlay.removeEventListener('keydown', onKey);
        this.overlay.classList.add('intro-leaving');
        setTimeout(() => {
          this.overlay.hidden = true;
          document.body.classList.remove('intro-playing');
          resolve();
        }, 700);
      };
      const onKey = e => {
        if (e.key === 'Escape') finish();
        if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === this.skip ? this.sound : this.skip).focus(); }
      };
      const tick = setInterval(() => {
        this.progress.style.transform = `scaleX(${this.video.duration ? Math.min(1, this.video.currentTime / this.video.duration) : 0})`;
      }, 100);
      // Playback rejection, missing media or a stalled connection never traps a run.
      const timeout = setTimeout(finish, 20000);
      this.skip.addEventListener('click', finish);
      this.overlay.addEventListener('keydown', onKey);
      this.video.addEventListener('ended', finish);
      this.video.addEventListener('error', finish);
      this.video.play().catch(finish);
    });
    return this.pending;
  }
}
