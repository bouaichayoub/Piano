/**
 * sound.js
 * --------
 * Web Audio API piano synthesis.
 * Uses additive synthesis with ADSR envelope.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    // Map of note -> { oscillators: [], gainNode, started }
    this._active = new Map();
    this._initialized = false;
  }

  /** Must be called on a user gesture to unlock AudioContext. */
  init() {
    if (this._initialized) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.55;
    this.masterGain.connect(this.ctx.destination);
    this._initialized = true;
  }

  /** Resume context if suspended (e.g. after page visibility change). */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Play a note by name, e.g. 'C4', 'F#5'.
   * No-ops if the note is already actively sounding.
   */
  play(note) {
    if (!this._initialized) return;
    if (this._active.has(note)) return; // already playing

    const freq = NOTE_FREQUENCIES[note];
    if (!freq) return;

    const now = this.ctx.currentTime;
    const ATTACK  = 0.010;  // 10 ms
    const DECAY   = 0.150;  // 150 ms
    const SUSTAIN = 0.28;

    // Harmonic partials: multiplier and relative amplitude
    const harmonics = [
      { mult: 1, gain: 1.00 },
      { mult: 2, gain: 0.50 },
      { mult: 3, gain: 0.25 },
      { mult: 4, gain: 0.12 },
      { mult: 5, gain: 0.06 },
    ];

    // One shared gain node for all harmonics of this note
    const noteGain = this.ctx.createGain();
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(1.0, now + ATTACK);
    noteGain.gain.linearRampToValueAtTime(SUSTAIN, now + ATTACK + DECAY);
    noteGain.connect(this.masterGain);

    const oscillators = harmonics.map(({ mult, gain }) => {
      const oscGain = this.ctx.createGain();
      oscGain.gain.value = gain;
      oscGain.connect(noteGain);

      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      osc.connect(oscGain);
      osc.start(now);

      return { osc, oscGain };
    });

    this._active.set(note, { oscillators, noteGain });
  }

  /**
   * Stop a note with an 800 ms release.
   */
  stop(note) {
    if (!this._initialized) return;
    const entry = this._active.get(note);
    if (!entry) return;

    const { oscillators, noteGain } = entry;
    const now = this.ctx.currentTime;
    const RELEASE = 0.800;

    noteGain.gain.cancelScheduledValues(now);
    noteGain.gain.setValueAtTime(noteGain.gain.value, now);
    noteGain.gain.linearRampToValueAtTime(0, now + RELEASE);

    oscillators.forEach(({ osc }) => {
      try { osc.stop(now + RELEASE + 0.05); } catch (_) {}
    });

    this._active.delete(note);

    // Clean up after release
    setTimeout(() => {
      try { noteGain.disconnect(); } catch (_) {}
    }, (RELEASE + 0.1) * 1000);
  }

  /** Stop all currently sounding notes. */
  stopAll() {
    for (const note of [...this._active.keys()]) {
      this.stop(note);
    }
  }

  get isInitialized() { return this._initialized; }
}
