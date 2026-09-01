/**
 * Zero-dependency Procedural Web Audio Sound Synthesizer.
 * Generates rich, visceral SFX on the fly (bite crunches, toxic bursts, mutation pulses)
 * without requiring external audio asset files or network requests.
 */

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx && (typeof window !== 'undefined')) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Auto-unlock Web Audio on first user interaction
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    }
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
}

/**
 * Creates an audio noise buffer for crunches, whooshes, and hiss effects.
 */
function createNoiseBuffer(ctx, duration = 0.5) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Fast snappy bite sound (jaw snap / teeth meeting).
 */
export function playBiteSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Snap oscillator
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(380, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);

  oscGain.gain.setValueAtTime(0.3, t);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

  osc.connect(oscGain);
  oscGain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.08);

  // Quick bite click noise
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.06);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1800, t);
  filter.Q.setValueAtTime(3.0, t);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.25, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(t);
}

/**
 * Visceral bite hit impact sound (crunchy flesh tear + acid sizzle).
 */
export function playBiteHitSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Low punch thump
  const punch = ctx.createOscillator();
  const punchGain = ctx.createGain();
  punch.type = 'sine';
  punch.frequency.setValueAtTime(160, t);
  punch.frequency.exponentialRampToValueAtTime(45, t + 0.14);

  punchGain.gain.setValueAtTime(0.5, t);
  punchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

  punch.connect(punchGain);
  punchGain.connect(ctx.destination);
  punch.start(t);
  punch.stop(t + 0.14);

  // Wet crunch noise
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.18);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2400, t);
  filter.frequency.exponentialRampToValueAtTime(350, t + 0.15);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.45, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(t);

  // Toxic hiss layer
  const hiss = ctx.createBufferSource();
  hiss.buffer = createNoiseBuffer(ctx, 0.22);
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = 'highpass';
  hissFilter.frequency.setValueAtTime(3200, t);

  const hissGain = ctx.createGain();
  hissGain.gain.setValueAtTime(0.2, t);
  hissGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

  hiss.connect(hissFilter);
  hissFilter.connect(hissGain);
  hissGain.connect(ctx.destination);
  hiss.start(t + 0.02);
}

/**
 * Explosive Poison Expel (Toxic Burst) sound:
 * Sucking hiss buildup -> Massive explosive acid eruption & bubbling spray.
 */
export function playPoisonExpelSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // 1. Heavy bass boom
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(120, t);
  sub.frequency.exponentialRampToValueAtTime(30, t + 0.45);

  subGain.gain.setValueAtTime(0.7, t);
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

  sub.connect(subGain);
  subGain.connect(ctx.destination);
  sub.start(t);
  sub.stop(t + 0.45);

  // 2. Outward spraying caustic noise burst
  const burstNoise = ctx.createBufferSource();
  burstNoise.buffer = createNoiseBuffer(ctx, 0.6);

  const burstFilter = ctx.createBiquadFilter();
  burstFilter.type = 'bandpass';
  burstFilter.frequency.setValueAtTime(900, t);
  burstFilter.frequency.exponentialRampToValueAtTime(2600, t + 0.1);
  burstFilter.frequency.exponentialRampToValueAtTime(400, t + 0.55);
  burstFilter.Q.setValueAtTime(1.8, t);

  const burstGain = ctx.createGain();
  burstGain.gain.setValueAtTime(0.6, t);
  burstGain.gain.linearRampToValueAtTime(0.75, t + 0.05);
  burstGain.gain.exponentialRampToValueAtTime(0.001, t + 0.58);

  burstNoise.connect(burstFilter);
  burstFilter.connect(burstGain);
  burstGain.connect(ctx.destination);
  burstNoise.start(t);

  // 3. Resonant bubbling modulation tone
  const bubbleOsc = ctx.createOscillator();
  const bubbleGain = ctx.createGain();
  bubbleOsc.type = 'sawtooth';
  bubbleOsc.frequency.setValueAtTime(280, t);
  bubbleOsc.frequency.linearRampToValueAtTime(520, t + 0.15);
  bubbleOsc.frequency.exponentialRampToValueAtTime(90, t + 0.4);

  const bubbleFilter = ctx.createBiquadFilter();
  bubbleFilter.type = 'lowpass';
  bubbleFilter.frequency.setValueAtTime(700, t);

  bubbleGain.gain.setValueAtTime(0.25, t);
  bubbleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

  bubbleOsc.connect(bubbleFilter);
  bubbleFilter.connect(bubbleGain);
  bubbleGain.connect(ctx.destination);
  bubbleOsc.start(t);
  bubbleOsc.stop(t + 0.4);
}

/**
 * Mutation transformation sounds.
 */
export function playMutationStartSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(520, t + 0.3);

  gain.gain.setValueAtTime(0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.3);
}

export function playMutationCompleteSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.setValueAtTime(600, t + 0.08);
  osc.frequency.setValueAtTime(800, t + 0.16);

  gain.gain.setValueAtTime(0.35, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.4);
}

export function playMutationLowSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, t);
  gain.gain.setValueAtTime(0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.15);
}

export function playMutationCriticalSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(660, t);
  gain.gain.setValueAtTime(0.18, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

export function playMutationExpireSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.35);

  gain.gain.setValueAtTime(0.35, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.35);
}
