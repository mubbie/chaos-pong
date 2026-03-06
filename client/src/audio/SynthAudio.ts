/** Procedural sound engine using Web Audio API. No audio files needed. */
export class SynthAudio {
  private ctx: AudioContext | null = null;

  /** Global mute state — shared across all SynthAudio instances via static */
  private static globalMuted: boolean = false;

  /** Track all live instances so toggleMute can suspend/resume their contexts */
  private static instances: Set<SynthAudio> = new Set();

  constructor() {
    SynthAudio.instances.add(this);
  }

  /** Remove this instance from tracking (call when no longer needed) */
  destroy(): void {
    SynthAudio.instances.delete(this);
  }

  get muted(): boolean { return SynthAudio.globalMuted; }

  static setMuted(val: boolean): void {
    SynthAudio.globalMuted = val;
    SynthAudio.syncAllContexts();
  }
  static isMuted(): boolean { return SynthAudio.globalMuted; }
  static toggleMute(): boolean {
    SynthAudio.globalMuted = !SynthAudio.globalMuted;
    SynthAudio.syncAllContexts();
    return SynthAudio.globalMuted;
  }

  /** Suspend or resume all active AudioContexts immediately */
  private static syncAllContexts(): void {
    for (const inst of SynthAudio.instances) {
      if (inst.ctx) {
        if (SynthAudio.globalMuted) {
          inst.ctx.suspend().catch(() => {});
        } else {
          inst.ctx.resume().catch(() => {});
        }
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (SynthAudio.globalMuted) return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /** Short punchy "pock" for paddle hit — pitch rises with rally count */
  paddleHit(rallyCount: number = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';

    // Base frequency 220Hz, ramp up by 15Hz per rally hit, cap at 440Hz (one octave up)
    const pitchBoost = Math.min(rallyCount * 15, 220);
    const baseFreq = 220 + pitchBoost;
    const endFreq = Math.max(baseFreq / 2, 110);

    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + 0.1);

    // Slightly louder at higher rallies for more impact (0.3 base, up to 0.45)
    const vol = Math.min(0.3 + rallyCount * 0.01, 0.45);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Soft "tick" for wall bounce */
  wallBounce(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.05);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  /** Metallic "clang" for shield block */
  shieldBlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Metallic ping — high triangle wave with fast decay
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.12);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);

    // Sub-clang for body
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(300, t);
    osc2.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    gain2.gain.setValueAtTime(0.1, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.08);
  }

  /** Deep "womp" + overtone for goal scored */
  goalScored(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Bass
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(150, t);
    osc1.frequency.exponentialRampToValueAtTime(50, t + 0.4);
    gain1.gain.setValueAtTime(0.3, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.4);

    // Overtone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(300, t);
    osc2.frequency.exponentialRampToValueAtTime(100, t + 0.3);
    gain2.gain.setValueAtTime(0.15, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.3);
  }

  /** Ascending beep for countdown (3, 2, 1) */
  countdownBeep(number: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220 + (4 - number) * 110, t);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Dramatic alert for match point / deuce */
  matchPointAlert(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Two-tone alert
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'square';
    osc1.frequency.setValueAtTime(440, t);
    osc1.frequency.setValueAtTime(660, t + 0.15);
    gain1.gain.setValueAtTime(0.2, t);
    gain1.gain.setValueAtTime(0.2, t + 0.15);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.35);

    // Sub bass hit
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(100, t);
    gain2.gain.setValueAtTime(0.25, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.2);
  }

  /** Bright rising sweep for "GO!" */
  goSound(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.2);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  /** Rising chime for power-up collection */
  powerUpCollect(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Two-tone ascending chime
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523, t); // C5
    osc1.frequency.setValueAtTime(659, t + 0.08); // E5
    gain1.gain.setValueAtTime(0.2, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.25);

    // Higher sparkle
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(784, t + 0.06); // G5
    gain2.gain.setValueAtTime(0, t);
    gain2.gain.setValueAtTime(0.15, t + 0.06);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.3);
  }

  /** Icy crystallization sound for freeze */
  freezeSound(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // High descending shimmer
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2000, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.3);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.35);

    // Crackle noise
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(3000, t);
    osc2.frequency.exponentialRampToValueAtTime(800, t + 0.15);
    gain2.gain.setValueAtTime(0.05, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.15);
  }

  /** Deep boom for cannon shot firing */
  cannonFire(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Low boom
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);

    // High overtone crack
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(600, t);
    osc2.frequency.exponentialRampToValueAtTime(200, t + 0.1);
    gain2.gain.setValueAtTime(0.2, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.1);
  }

  /** Metallic clang for shield bounce */
  shieldBounce(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(440, t + 0.15);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Mystical shimmer for power-up materializing on field */
  powerUpSpawn(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Ascending sparkle sweep
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(400, t);
    osc1.frequency.exponentialRampToValueAtTime(1200, t + 0.25);
    gain1.gain.setValueAtTime(0.12, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.35);

    // Soft sub tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(200, t);
    gain2.gain.setValueAtTime(0.08, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.2);
  }

  /** Warbling eerie sound for ghost ball */
  ghostBallSound(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Main warble with LFO
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(8, t);
    lfoGain.gain.setValueAtTime(30, t);
    lfo.connect(lfoGain).connect(osc.frequency);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain).connect(ctx.destination);

    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.5);
    lfo.stop(t + 0.5);
  }

  /** Rapid 3-note descending sequence for multi-ball spawn */
  multiBallSplit(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [600, 450, 300];

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      const start = t + i * 0.05;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.08);
    });
  }

  /** White noise burst for crowd cheer */
  crowdCheer(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Create noise using buffer
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.3;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    // Bandpass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, t);
    filter.Q.setValueAtTime(0.5, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t);
    noise.stop(t + 0.2);
  }

  /** Short blip for taunt received */
  tauntBlip(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.08);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }
}
