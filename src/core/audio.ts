import { Storage } from './storage';

/**
 * Procedural audio: every sound effect and the music loop are synthesized with WebAudio,
 * so the game ships with no third-party audio assets.
 */
type SfxName =
  | 'click' | 'back' | 'swing' | 'hit' | 'homerun' | 'out' | 'bounce' | 'swish' | 'rim' | 'backboard'
  | 'pocket' | 'cueHit' | 'cushion' | 'ballClack' | 'whistle' | 'slap' | 'thud' | 'grab' | 'cheer' | 'groan'
  | 'dart' | 'bust' | 'win' | 'countBeep' | 'goalHorn' | 'catch' | 'tackle' | 'throw' | 'skate' | 'tick' | 'fanfare';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private musicStyle: 'outdoor' | 'basement' = 'outdoor';
  private musicPlaying = false;
  /** Set while a CPU turn is fast-forwarded: effects would just chatter. */
  quiet = false;

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.connect(this.master);
        this.applySettings();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.ctx && !this.musicPlaying && Storage.settings.musicOn) this.startMusic();
  }

  applySettings(): void {
    if (!this.ctx) return;
    const s = Storage.settings;
    this.sfxGain.gain.value = s.soundOn ? s.soundVolume * 0.9 : 0;
    this.musicGain.gain.value = s.musicOn ? s.musicVolume * 0.35 : 0;
    if (s.musicOn && !this.musicPlaying) this.startMusic();
    if (!s.musicOn && this.musicPlaying) this.stopMusic();
  }

  setMusicStyle(style: 'outdoor' | 'basement'): void {
    this.musicStyle = style;
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; attack?: number; decay?: number; slide?: number; dest?: GainNode; when?: number } = {}): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = opts.when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t0 + dur);
    const peak = opts.gain ?? 0.4;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + (opts.decay ?? 0));
    osc.connect(g);
    g.connect(opts.dest ?? this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + (opts.decay ?? 0) + 0.05);
  }

  private noise(dur: number, opts: { gain?: number; filter?: number; q?: number; type?: BiquadFilterType; when?: number } = {}): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = opts.when ?? ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.value = opts.filter ?? 1200;
    f.Q.value = opts.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  sfx(name: SfxName): void {
    if (!this.ctx || !Storage.settings.soundOn || this.quiet) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'click': this.tone(880, 0.05, { type: 'square', gain: 0.12 }); this.tone(1320, 0.06, { type: 'sine', gain: 0.1, when: t + 0.03 }); break;
      case 'back': this.tone(520, 0.08, { type: 'square', gain: 0.1, slide: 0.6 }); break;
      case 'tick': this.tone(1500, 0.03, { type: 'square', gain: 0.08 }); break;
      case 'swing': this.noise(0.18, { gain: 0.25, filter: 900, type: 'bandpass', q: 1.5 }); break;
      case 'hit': this.tone(220, 0.08, { type: 'square', gain: 0.35, slide: 0.4 }); this.noise(0.08, { gain: 0.3, filter: 2500 }); break;
      case 'homerun': this.tone(180, 0.1, { type: 'square', gain: 0.4, slide: 0.3 }); this.noise(0.1, { gain: 0.35, filter: 3000 }); [0, 0.1, 0.2, 0.3].forEach((d, i) => this.tone([523, 659, 784, 1047][i], 0.18, { type: 'triangle', gain: 0.25, when: t + 0.15 + d })); this.noise(1.2, { gain: 0.12, filter: 1800, when: t + 0.2 }); break;
      case 'out': this.tone(300, 0.2, { type: 'sawtooth', gain: 0.15, slide: 0.5 }); this.tone(200, 0.3, { type: 'triangle', gain: 0.15, slide: 0.6, when: t + 0.15 }); break;
      case 'bounce': this.tone(160, 0.1, { type: 'sine', gain: 0.35, slide: 0.5 }); break;
      case 'swish': this.noise(0.25, { gain: 0.3, filter: 4000, type: 'highpass' }); this.tone(1200, 0.12, { type: 'sine', gain: 0.08, slide: 0.5, when: t + 0.05 }); break;
      case 'rim': this.tone(900, 0.15, { type: 'triangle', gain: 0.25, slide: 0.9 }); this.tone(1350, 0.3, { type: 'sine', gain: 0.1, when: t + 0.01 }); break;
      case 'backboard': this.tone(240, 0.12, { type: 'square', gain: 0.22, slide: 0.7 }); this.noise(0.1, { gain: 0.15, filter: 1500 }); break;
      case 'pocket': this.tone(400, 0.08, { type: 'sine', gain: 0.3, slide: 0.4 }); this.noise(0.15, { gain: 0.2, filter: 800, when: t + 0.04 }); break;
      case 'cueHit': this.tone(1400, 0.04, { type: 'square', gain: 0.25, slide: 0.5 }); this.noise(0.04, { gain: 0.25, filter: 5000 }); break;
      case 'ballClack': this.tone(2200, 0.03, { type: 'square', gain: 0.18, slide: 0.6 }); this.noise(0.03, { gain: 0.15, filter: 6000 }); break;
      case 'cushion': this.tone(180, 0.06, { type: 'sine', gain: 0.18, slide: 0.6 }); break;
      case 'whistle': this.tone(2200, 0.35, { type: 'square', gain: 0.12 }); this.tone(2300, 0.35, { type: 'sine', gain: 0.1, when: t + 0.02 }); break;
      case 'slap': this.noise(0.08, { gain: 0.35, filter: 3000 }); this.tone(300, 0.08, { type: 'triangle', gain: 0.2, slide: 0.5 }); break;
      case 'thud': this.tone(90, 0.18, { type: 'sine', gain: 0.5, slide: 0.5 }); this.noise(0.12, { gain: 0.25, filter: 500 }); break;
      case 'grab': this.noise(0.12, { gain: 0.2, filter: 1200 }); this.tone(400, 0.1, { type: 'triangle', gain: 0.15, slide: 1.3 }); break;
      case 'tackle': this.tone(120, 0.15, { type: 'sine', gain: 0.4, slide: 0.5 }); this.noise(0.15, { gain: 0.3, filter: 900 }); break;
      case 'catch': this.noise(0.07, { gain: 0.25, filter: 2200 }); this.tone(500, 0.06, { type: 'triangle', gain: 0.15, slide: 0.8 }); break;
      case 'throw': this.noise(0.2, { gain: 0.18, filter: 1500, type: 'bandpass', q: 2 }); break;
      case 'skate': this.noise(0.15, { gain: 0.08, filter: 2500, type: 'highpass' }); break;
      case 'cheer': this.noise(0.9, { gain: 0.18, filter: 1600, type: 'bandpass', q: 0.6 }); [0, 0.12].forEach((d, i) => this.tone([660, 880][i], 0.25, { type: 'triangle', gain: 0.18, when: t + d })); break;
      case 'groan': this.tone(330, 0.5, { type: 'sawtooth', gain: 0.1, slide: 0.55 }); this.tone(247, 0.5, { type: 'triangle', gain: 0.1, slide: 0.6, when: t + 0.05 }); break;
      case 'dart': this.noise(0.08, { gain: 0.18, filter: 3500, type: 'highpass' }); this.tone(2000, 0.05, { type: 'square', gain: 0.18, slide: 0.3, when: t + 0.06 }); this.tone(140, 0.12, { type: 'sine', gain: 0.3, slide: 0.6, when: t + 0.06 }); break;
      case 'bust': [0, 0.15, 0.3].forEach((d, i) => this.tone([440, 370, 294][i], 0.18, { type: 'square', gain: 0.15, when: t + d })); break;
      case 'countBeep': this.tone(740, 0.12, { type: 'square', gain: 0.2 }); break;
      case 'goalHorn': this.tone(196, 0.8, { type: 'sawtooth', gain: 0.25 }); this.tone(247, 0.8, { type: 'sawtooth', gain: 0.2 }); this.tone(294, 0.8, { type: 'square', gain: 0.12 }); break;
      case 'win': [0, 0.12, 0.24, 0.36, 0.6].forEach((d, i) => this.tone([523, 659, 784, 1047, 1319][i], 0.3, { type: 'triangle', gain: 0.25, when: t + d })); this.noise(1.5, { gain: 0.15, filter: 1800, when: t + 0.3 }); break;
      case 'fanfare': [0, 0.15, 0.3, 0.45, 0.6, 0.9].forEach((d, i) => this.tone([392, 392, 392, 523, 659, 784][i], 0.22, { type: 'square', gain: 0.18, when: t + d })); [0, 0.15, 0.3, 0.45, 0.6, 0.9].forEach((d, i) => this.tone([196, 196, 196, 262, 330, 392][i], 0.22, { type: 'triangle', gain: 0.2, when: t + d })); break;
    }
  }

  // ---- Music: a gentle looping lo-fi backyard tune, scheduled ahead of time ----
  private startMusic(): void {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    this.musicStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 90);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicPlaying = false;
  }

  private scheduleMusic(): void {
    if (!this.ctx) return;
    const stepDur = this.musicStyle === 'outdoor' ? 0.22 : 0.26;
    while (this.nextNoteTime < this.ctx.currentTime + 0.3) {
      this.playMusicStep(this.musicStep, this.nextNoteTime, stepDur);
      this.musicStep = (this.musicStep + 1) % 64;
      this.nextNoteTime += stepDur;
    }
  }

  private playMusicStep(step: number, when: number, stepDur: number): void {
    // Chord progression: C - Am - F - G (16 steps each), arpeggiated.
    const chords = [
      [261.63, 329.63, 392.0, 523.25],
      [220.0, 261.63, 329.63, 440.0],
      [174.61, 220.0, 261.63, 349.23],
      [196.0, 246.94, 293.66, 392.0],
    ];
    const bass = [130.81, 110.0, 87.31, 98.0];
    const chord = chords[Math.floor(step / 16) % 4];
    const arp = [0, 2, 1, 3, 2, 1, 0, 2, 3, 1, 2, 0, 1, 3, 2, 1];
    const lead: OscillatorType = this.musicStyle === 'outdoor' ? 'triangle' : 'sine';
    if (step % 2 === 0) {
      this.tone(chord[arp[step % 16]], stepDur * 1.6, { type: lead, gain: 0.16, attack: 0.01, decay: 0.08, dest: this.musicGain, when });
    }
    if (step % 8 === 0) {
      this.tone(bass[Math.floor(step / 16) % 4], stepDur * 3.5, { type: 'sine', gain: 0.22, attack: 0.02, decay: 0.1, dest: this.musicGain, when });
    }
    if (step % 16 === 8 && this.musicStyle === 'outdoor') {
      this.tone(chord[3] * 1.5, stepDur * 1.2, { type: 'sine', gain: 0.08, attack: 0.02, dest: this.musicGain, when });
    }
  }
}

export const Audio = new AudioEngine();
