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

/**
 * Procedural Apex Predator (Murkmaw) WebAudio Sound Effects
 */

export function playApexRoarSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // 1. Deep guttural sub-rumble
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sawtooth';
  sub.frequency.setValueAtTime(85, t);
  sub.frequency.linearRampToValueAtTime(140, t + 0.2);
  sub.frequency.exponentialRampToValueAtTime(38, t + 0.9);

  const subFilter = ctx.createBiquadFilter();
  subFilter.type = 'lowpass';
  subFilter.frequency.setValueAtTime(350, t);
  subFilter.frequency.linearRampToValueAtTime(800, t + 0.25);
  subFilter.frequency.exponentialRampToValueAtTime(120, t + 0.9);

  subGain.gain.setValueAtTime(0.7, t);
  subGain.gain.linearRampToValueAtTime(0.85, t + 0.15);
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);

  sub.connect(subFilter);
  subFilter.connect(subGain);
  subGain.connect(ctx.destination);
  sub.start(t);
  sub.stop(t + 0.9);

  // 2. Screeching beast throat formant
  const throat = ctx.createOscillator();
  const throatGain = ctx.createGain();
  throat.type = 'triangle';
  throat.frequency.setValueAtTime(260, t);
  throat.frequency.linearRampToValueAtTime(390, t + 0.18);
  throat.frequency.exponentialRampToValueAtTime(95, t + 0.75);

  const throatFilter = ctx.createBiquadFilter();
  throatFilter.type = 'bandpass';
  throatFilter.frequency.setValueAtTime(1200, t);
  throatFilter.Q.setValueAtTime(4.0, t);

  throatGain.gain.setValueAtTime(0.4, t);
  throatGain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);

  throat.connect(throatFilter);
  throatFilter.connect(throatGain);
  throatGain.connect(ctx.destination);
  throat.start(t);
  throat.stop(t + 0.75);

  // 3. Breath/gravel roar noise layer
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.85);

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(650, t);
  noiseFilter.frequency.linearRampToValueAtTime(1600, t + 0.2);
  noiseFilter.frequency.exponentialRampToValueAtTime(280, t + 0.85);
  noiseFilter.Q.setValueAtTime(2.2, t);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.5, t);
  noiseGain.gain.linearRampToValueAtTime(0.65, t + 0.15);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(t);
}

export function playApexAttackSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(480, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.18);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1800, t);
  filter.frequency.exponentialRampToValueAtTime(200, t + 0.18);

  gain.gain.setValueAtTime(0.45, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.18);
}

export function playApexChargeSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Rumbling locomotive freight rush
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(75, t);
  osc.frequency.linearRampToValueAtTime(130, t + 0.4);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.7);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(400, t);
  filter.frequency.linearRampToValueAtTime(900, t + 0.35);

  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.7);
}

export function playApexSlamSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // 1. Heavy seismic sub-bass boom
  const boom = ctx.createOscillator();
  const boomGain = ctx.createGain();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(140, t);
  boom.frequency.exponentialRampToValueAtTime(24, t + 0.65);

  boomGain.gain.setValueAtTime(0.9, t);
  boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);

  boom.connect(boomGain);
  boomGain.connect(ctx.destination);
  boom.start(t);
  boom.stop(t + 0.65);

  // 2. Earth shatter crunch
  const crunch = ctx.createBufferSource();
  crunch.buffer = createNoiseBuffer(ctx, 0.45);

  const crunchFilter = ctx.createBiquadFilter();
  crunchFilter.type = 'lowpass';
  crunchFilter.frequency.setValueAtTime(1800, t);
  crunchFilter.frequency.exponentialRampToValueAtTime(150, t + 0.4);

  const crunchGain = ctx.createGain();
  crunchGain.gain.setValueAtTime(0.7, t);
  crunchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

  crunch.connect(crunchFilter);
  crunchFilter.connect(crunchGain);
  crunchGain.connect(ctx.destination);
  crunch.start(t);
}

export function playApexToxicSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Caustic chemical eruption
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.6);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1100, t);
  filter.frequency.linearRampToValueAtTime(2800, t + 0.15);
  filter.frequency.exponentialRampToValueAtTime(350, t + 0.58);
  filter.Q.setValueAtTime(2.5, t);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.65, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(t);
}

export function playApexBurrowSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(95, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(500, t);
  filter.frequency.exponentialRampToValueAtTime(90, t + 0.5);

  gain.gain.setValueAtTime(0.6, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.5);
}

export function playApexEmergeSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Earth explosion + roar erupt
  const boom = ctx.createOscillator();
  const boomGain = ctx.createGain();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(60, t);
  boom.frequency.exponentialRampToValueAtTime(180, t + 0.1);
  boom.frequency.exponentialRampToValueAtTime(35, t + 0.6);

  boomGain.gain.setValueAtTime(0.85, t);
  boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

  boom.connect(boomGain);
  boomGain.connect(ctx.destination);
  boom.start(t);
  boom.stop(t + 0.6);

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.55);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(800, t);
  filter.frequency.linearRampToValueAtTime(2200, t + 0.15);
  filter.frequency.exponentialRampToValueAtTime(200, t + 0.55);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.7, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(t);
}

export function playApexHitSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.14);

  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.14);
}

export function playApexDeathSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Multi-stage death collapse
  const screech = ctx.createOscillator();
  const screechGain = ctx.createGain();
  screech.type = 'sawtooth';
  screech.frequency.setValueAtTime(380, t);
  screech.frequency.linearRampToValueAtTime(520, t + 0.25);
  screech.frequency.exponentialRampToValueAtTime(40, t + 1.6);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1400, t);
  filter.frequency.exponentialRampToValueAtTime(100, t + 1.6);

  screechGain.gain.setValueAtTime(0.65, t);
  screechGain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);

  screech.connect(filter);
  filter.connect(screechGain);
  screechGain.connect(ctx.destination);
  screech.start(t);
  screech.stop(t + 1.6);

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 1.6);
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.4, t);
  nGain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
  noise.connect(nGain);
  nGain.connect(ctx.destination);
  noise.start(t);
}
