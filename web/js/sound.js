/**
 * sound.js — Web Audio API piano synthesis.
 * Additive synthesis (5 harmonics) + ADSR envelope + ambient reverb.
 * Exposes `analyser` node for spectrum visualizer.
 */

class SoundEngine {
  constructor() {
    this.ctx          = null;
    this.masterGain   = null;
    this.analyser     = null;
    this._active      = new Map();   // note -> { oscillators, noteGain }
    this._initialized = false;
  }

  /** Call on first user gesture to unlock AudioContext. */
  init() {
    if (this._initialized) return;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master volume
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;

    // Analyser for spectrum visualizer
    this.analyser          = this.ctx.createAnalyser();
    this.analyser.fftSize  = 128;
    this.analyser.smoothingTimeConstant = 0.8;

    // Ambient reverb: three short delay taps (no feedback → no oscillation)
    const reverbTaps = [[0.05, 0.18], [0.10, 0.12], [0.19, 0.07]];
    reverbTaps.forEach(([time, gain]) => {
      const delay = this.ctx.createDelay(0.5);
      delay.delayTime.value = time;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      this.masterGain.connect(delay);
      delay.connect(g);
      g.connect(this.ctx.destination);
    });

    // Dry path + analyser tap
    this.masterGain.connect(this.ctx.destination);
    this.masterGain.connect(this.analyser);

    this._initialized = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(note) {
    if (!this._initialized) return;
    if (this._active.has(note)) return;

    const freq = NOTE_FREQUENCIES[note];
    if (!freq) return;

    const now     = this.ctx.currentTime;
    const ATTACK  = 0.010;
    const DECAY   = 0.160;
    const SUSTAIN = 0.26;

    const noteGain = this.ctx.createGain();
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(1.0,     now + ATTACK);
    noteGain.gain.linearRampToValueAtTime(SUSTAIN, now + ATTACK + DECAY);
    noteGain.connect(this.masterGain);

    // 5 harmonics: fundamental + overtones for a richer piano timbre
    const harmonics = [
      { mult: 1, gain: 1.00 },
      { mult: 2, gain: 0.48 },
      { mult: 3, gain: 0.22 },
      { mult: 4, gain: 0.10 },
      { mult: 5, gain: 0.05 },
    ];

    const oscillators = harmonics.map(({ mult, gain }) => {
      const oscGain       = this.ctx.createGain();
      oscGain.gain.value  = gain;
      oscGain.connect(noteGain);

      const osc           = this.ctx.createOscillator();
      osc.type            = 'sine';
      osc.frequency.value = freq * mult;
      // Tiny detune for warmth
      osc.detune.value    = (Math.random() - 0.5) * 3;
      osc.connect(oscGain);
      osc.start(now);

      return { osc, oscGain };
    });

    this._active.set(note, { oscillators, noteGain });
  }

  stop(note) {
    if (!this._initialized) return;
    const entry = this._active.get(note);
    if (!entry) return;

    const { oscillators, noteGain } = entry;
    const now     = this.ctx.currentTime;
    const RELEASE = 0.75;

    noteGain.gain.cancelScheduledValues(now);
    noteGain.gain.setValueAtTime(noteGain.gain.value, now);
    // Exponential-like release using two ramps for a more natural decay tail
    noteGain.gain.linearRampToValueAtTime(noteGain.gain.value * 0.4, now + RELEASE * 0.3);
    noteGain.gain.linearRampToValueAtTime(0, now + RELEASE);

    oscillators.forEach(({ osc }) => {
      try { osc.stop(now + RELEASE + 0.06); } catch (_) {}
    });

    this._active.delete(note);

    setTimeout(() => { try { noteGain.disconnect(); } catch (_) {} }, (RELEASE + 0.1) * 1000);
  }

  stopAll() {
    for (const note of [...this._active.keys()]) this.stop(note);
  }

  get isInitialized() { return this._initialized; }
}
