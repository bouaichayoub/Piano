"""
sound_engine.py
---------------
Synthetic piano sound generation using numpy + pygame mixer.

Each note is synthesized with:
  - Fundamental frequency
  - 2nd, 3rd, 4th harmonics (decreasing amplitude)
  - ADSR envelope (Attack, Decay, Sustain, Release)

No audio files required — everything is generated on the fly.
"""

import numpy as np
import pygame
import threading

# ---------------------------------------------------------------------------
# Tuning table: note name -> frequency (Hz)
# Two octaves: C4 … B5
# ---------------------------------------------------------------------------
NOTE_FREQUENCIES: dict[str, float] = {
    "C4":  261.63, "C#4": 277.18, "D4":  293.66, "D#4": 311.13,
    "E4":  329.63, "F4":  349.23, "F#4": 369.99, "G4":  392.00,
    "G#4": 415.30, "A4":  440.00, "A#4": 466.16, "B4":  493.88,
    "C5":  523.25, "C#5": 554.37, "D5":  587.33, "D#5": 622.25,
    "E5":  659.25, "F5":  698.46, "F#5": 739.99, "G5":  783.99,
    "G#5": 830.61, "A5":  880.00, "A#5": 932.33, "B5":  987.77,
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SAMPLE_RATE   = 44100   # samples / second
NOTE_DURATION = 2.0     # seconds of audio to pre-render per note
MAX_AMPLITUDE = 0.6     # master volume (0.0 – 1.0)

# ADSR timing (seconds)
ATTACK_TIME   = 0.01
DECAY_TIME    = 0.15
SUSTAIN_LEVEL = 0.55    # fraction of peak amplitude
RELEASE_TIME  = 0.8

# Harmonic series: (harmonic_number, relative_amplitude)
HARMONICS = [
    (1, 1.00),
    (2, 0.50),
    (3, 0.25),
    (4, 0.12),
    (5, 0.06),
]


def _build_adsr_envelope(num_samples: int, sample_rate: int) -> np.ndarray:
    """Return a numpy array of shape (num_samples,) with the ADSR envelope."""
    envelope = np.zeros(num_samples, dtype=np.float32)

    a = int(ATTACK_TIME  * sample_rate)
    d = int(DECAY_TIME   * sample_rate)
    r = int(RELEASE_TIME * sample_rate)

    # Clamp so total ADSR segments fit inside the buffer
    total_non_sustain = a + d + r
    if total_non_sustain > num_samples:
        scale = num_samples / total_non_sustain
        a = int(a * scale)
        d = int(d * scale)
        r = int(r * scale)

    s_start = a + d
    s_end   = num_samples - r
    if s_end < s_start:
        s_end = s_start

    # Attack: 0 → 1
    if a > 0:
        envelope[:a] = np.linspace(0.0, 1.0, a, dtype=np.float32)

    # Decay: 1 → SUSTAIN_LEVEL
    if d > 0:
        envelope[a:a + d] = np.linspace(1.0, SUSTAIN_LEVEL, d, dtype=np.float32)

    # Sustain: flat
    if s_end > s_start:
        envelope[s_start:s_end] = SUSTAIN_LEVEL

    # Release: SUSTAIN_LEVEL → 0
    if r > 0:
        envelope[s_end:s_end + r] = np.linspace(SUSTAIN_LEVEL, 0.0, r, dtype=np.float32)

    return envelope


def _synthesize_note(frequency: float, duration: float = NOTE_DURATION,
                     sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Synthesize a piano-like tone using additive synthesis + ADSR."""
    num_samples = int(duration * sample_rate)
    t = np.linspace(0.0, duration, num_samples, endpoint=False, dtype=np.float32)

    wave = np.zeros(num_samples, dtype=np.float32)
    for harmonic, amplitude in HARMONICS:
        wave += amplitude * np.sin(2.0 * np.pi * frequency * harmonic * t)

    # Normalize harmonic mix to [-1, 1]
    peak = np.max(np.abs(wave))
    if peak > 0:
        wave /= peak

    envelope = _build_adsr_envelope(num_samples, sample_rate)
    wave *= envelope * MAX_AMPLITUDE

    # Convert to 16-bit stereo PCM
    int_wave = (wave * 32767).astype(np.int16)
    stereo   = np.column_stack([int_wave, int_wave])   # shape: (N, 2)
    return stereo


def _array_to_sound(arr: np.ndarray) -> pygame.mixer.Sound:
    """Wrap a numpy int16 stereo array in a pygame Sound object."""
    # pygame expects a C-contiguous array
    buf = np.ascontiguousarray(arr)
    return pygame.sndarray.make_sound(buf)


class SoundEngine:
    """
    Pre-renders all piano notes at startup, then plays them on demand.

    Usage
    -----
    engine = SoundEngine()
    engine.play("C4")
    engine.stop("C4")
    """

    def __init__(self):
        # Initialize pygame mixer (stereo, 16-bit, 44100 Hz)
        if not pygame.mixer.get_init():
            pygame.mixer.init(frequency=SAMPLE_RATE, size=-16,
                              channels=2, buffer=512)

        # Reserve enough mixer channels so chords don't cut off
        pygame.mixer.set_num_channels(32)

        self._sounds: dict[str, pygame.mixer.Sound] = {}
        self._channels: dict[str, pygame.mixer.Channel | None] = {}
        self._lock = threading.Lock()

        self._prerender_all()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def play(self, note: str) -> None:
        """Play a note (non-blocking).  Re-triggers if already playing."""
        with self._lock:
            sound = self._sounds.get(note)
            if sound is None:
                return
            channel = sound.play()
            self._channels[note] = channel

    def stop(self, note: str) -> None:
        """Stop a specific note."""
        with self._lock:
            ch = self._channels.get(note)
            if ch is not None:
                ch.stop()
                self._channels[note] = None

    def stop_all(self) -> None:
        """Stop all currently playing notes."""
        pygame.mixer.stop()
        with self._lock:
            self._channels.clear()

    def note_names(self) -> list[str]:
        """Return the list of available note names."""
        return list(NOTE_FREQUENCIES.keys())

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _prerender_all(self) -> None:
        """Pre-synthesize every note so playback is instant."""
        for name, freq in NOTE_FREQUENCIES.items():
            arr   = _synthesize_note(freq)
            sound = _array_to_sound(arr)
            self._sounds[name]   = sound
            self._channels[name] = None
