import type { EventBus } from '../core/events';

export type SfxName =
  | 'click' | 'build' | 'demolish' | 'kaching' | 'whistle'
  | 'horn' | 'error' | 'news' | 'achievement';

const KACHING_GAP_MS = 1500;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.6;
  private muted = false;
  private lastKaching = -Infinity;
  private ambienceWanted = false;
  private ambienceStarted = false;
  private noise: AudioBuffer | null = null;
  private broken = false;

  constructor(
    private ctxFactory: () => AudioContext = () => new AudioContext(),
    private now: () => number = () => performance.now(),
  ) {}

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGain();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
    if (!m && this.ambienceWanted) this.startAmbience();
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  private ensure(): AudioContext | null {
    if (this.broken) return null;
    if (!this.ctx) {
      try {
        const ctx = this.ctxFactory();
        const master = ctx.createGain();
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        this.applyGain();
      } catch {
        this.broken = true;
        this.ctx = null;
        this.master = null;
        return null;
      }
    }
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      /* ignore */
    }
    return this.ctx;
  }

  attach(bus: EventBus): () => void {
    const offs = [
      bus.on('buildingPlaced', () => this.play('build')),
      bus.on('buildingRemoved', () => this.play('demolish')),
      bus.on('sale', (e) => { if (e.ownerId === 'player') this.play('kaching'); }),
      bus.on('news', () => this.play('news')),
      bus.on('achievement', () => this.play('achievement')),
      bus.on('vehicleStuck', () => this.play('horn')),
      bus.on('toast', (e) => { if (e.tone === 'bad') this.play('error'); }),
    ];
    return () => { for (const off of offs) off(); };
  }

  play(name: SfxName): void {
    if (this.muted || this.volume <= 0) return;
    if (name === 'kaching') {
      const t = this.now();
      if (t - this.lastKaching < KACHING_GAP_MS) return;
      this.lastKaching = t;
    }
    const ctx = this.ensure();
    if (!ctx) return;
    try {
    const t = ctx.currentTime;
    switch (name) {
      case 'click':
        this.tone(t, 'square', 1200, 0.03, 0.12, 800);
        break;
      case 'build':
        this.tone(t, 'sine', 140, 0.18, 0.5, 50);
        this.noiseBurst(t, 0.06, 0.25, 'lowpass', 900);
        break;
      case 'demolish':
        this.noiseBurst(t, 0.5, 0.45, 'lowpass', 1400, 200);
        this.tone(t, 'sawtooth', 90, 0.3, 0.25, 40);
        break;
      case 'kaching':
        this.tone(t, 'square', 1318, 0.08, 0.15);
        this.tone(t + 0.09, 'square', 1760, 0.14, 0.15);
        this.tone(t + 0.09, 'sine', 3520, 0.6, 0.12);
        break;
      case 'whistle':
        this.tone(t, 'sine', 600, 0.7, 0.2, 900);
        this.tone(t, 'sine', 750, 0.7, 0.2, 1120);
        break;
      case 'horn':
        this.tone(t, 'sawtooth', 220, 0.18, 0.2);
        this.tone(t + 0.2, 'sawtooth', 277, 0.28, 0.2);
        break;
      case 'error':
        this.tone(t, 'sawtooth', 90, 0.25, 0.25);
        this.tone(t, 'square', 95, 0.25, 0.12);
        break;
      case 'news':
        this.tone(t, 'triangle', 660, 0.07, 0.2, 880);
        this.tone(t + 0.08, 'triangle', 880, 0.07, 0.2, 1175);
        this.tone(t + 0.16, 'triangle', 1175, 0.12, 0.2, 1480);
        break;
      case 'achievement':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this.tone(t + i * 0.11, 'triangle', f, i === 3 ? 0.5 : 0.18, 0.22);
          this.tone(t + i * 0.11, 'square', f, i === 3 ? 0.5 : 0.18, 0.05);
        });
        break;
    }
    } catch {
      /* never let audio crash the sim */
    }
  }

  /** Releases the AudioContext (browsers cap how many may exist). The Sfx stays silent afterwards. */
  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.broken = true;
    try {
      void ctx?.close();
    } catch {
      /* already closed */
    }
  }

  startAmbience(): void {
    this.ambienceWanted = true;
    if (this.muted || this.ambienceStarted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    try {
    this.ambienceStarted = true;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.08;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master!);
    src.start();
    // Slow throb on the cutoff for a chugging feel.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.4;
    const depth = ctx.createGain();
    depth.gain.value = 80;
    lfo.connect(depth);
    depth.connect(lp.frequency);
    lfo.start();
    } catch {
      this.ambienceStarted = false;
    }
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const len = Math.floor(ctx.sampleRate * 1.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
  }

  private tone(
    t: number, type: OscillatorType, freq: number, dur: number, vol: number, endFreq?: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(
    t: number, dur: number, vol: number, ftype: BiquadFilterType, f0: number, f1?: number,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const filt = ctx.createBiquadFilter();
    filt.type = ftype;
    filt.frequency.setValueAtTime(f0, t);
    if (f1) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
