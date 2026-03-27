import numpy as np
import pygame
import pygame.sndarray

SAMPLE_RATE = 44100


class SoundEngine:
    """Generates and plays piano-like tones using additive synthesis."""

    def __init__(self):
        pygame.mixer.init(frequency=SAMPLE_RATE, size=-16, channels=2, buffer=512)
        pygame.mixer.set_num_channels(32)
        self.sounds: dict[str, pygame.mixer.Sound] = {}

    # ------------------------------------------------------------------
    # Sound generation
    # ------------------------------------------------------------------

    def _make_tone(self, frequency: float, duration: float = 2.5) -> np.ndarray:
        """Return a 16-bit stereo array for a piano-like note."""
        n = int(SAMPLE_RATE * duration)
        t = np.linspace(0, duration, n, endpoint=False)

        # Additive synthesis – fundamental + harmonics with decreasing amplitude
        harmonics = [(1, 1.0), (2, 0.45), (3, 0.25), (4, 0.12),
                     (5, 0.06), (6, 0.03), (7, 0.015)]
        wave = sum(amp * np.sin(2 * np.pi * freq * h * t)
                   for h, amp in harmonics
                   for freq in [frequency])

        # Normalise
        peak = np.max(np.abs(wave))
        if peak > 0:
            wave /= peak

        # ADSR envelope (attack / decay / sustain / release)
        attack  = int(0.008 * SAMPLE_RATE)   # 8 ms
        decay   = int(0.12  * SAMPLE_RATE)   # 120 ms
        sustain = int(1.5   * SAMPLE_RATE)   # 1.5 s
        release = n - attack - decay - sustain
        if release < 0:
            release = 0
            sustain = n - attack - decay

        sustain_level = 0.55
        env = np.concatenate([
            np.linspace(0, 1, attack),
            np.linspace(1, sustain_level, decay),
            np.full(sustain, sustain_level),
            np.linspace(sustain_level, 0, release),
        ])
        env = env[:n]   # safety trim

        wave = (wave * env * 32767).astype(np.int16)
        return np.column_stack([wave, wave])   # stereo

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def preload(self, notes: dict[str, float]) -> None:
        """Pre-generate pygame Sound objects for every note."""
        for name, freq in notes.items():
            arr = self._make_tone(freq)
            self.sounds[name] = pygame.sndarray.make_sound(arr)

    def play(self, note: str) -> None:
        """Play a note (fire-and-forget)."""
        snd = self.sounds.get(note)
        if snd:
            snd.play()

    def stop(self, note: str) -> None:
        snd = self.sounds.get(note)
        if snd:
            snd.stop()
