"""
Virtual piano keyboard: layout, hit-testing, and OpenCV rendering.

Two octaves: C3 → C5  (15 white keys, 10 black keys)
"""

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Note frequencies (Hz)
# ---------------------------------------------------------------------------
NOTE_FREQUENCIES: dict[str, float] = {
    # White keys
    "C3": 130.81, "D3": 146.83, "E3": 164.81, "F3": 174.61,
    "G3": 196.00, "A3": 220.00, "B3": 246.94,
    "C4": 261.63, "D4": 293.66, "E4": 329.63, "F4": 349.23,
    "G4": 392.00, "A4": 440.00, "B4": 493.88,
    "C5": 523.25,
    # Black keys
    "C#3": 138.59, "D#3": 155.56, "F#3": 185.00, "G#3": 207.65, "A#3": 233.08,
    "C#4": 277.18, "D#4": 311.13, "F#4": 369.99, "G#4": 415.30, "A#4": 466.16,
}

# Ordered white keys (left → right)
WHITE_KEYS = [
    "C3", "D3", "E3", "F3", "G3", "A3", "B3",
    "C4", "D4", "E4", "F4", "G4", "A4", "B4",
    "C5",
]

# Black key: value = white-key index to its LEFT
# (key sits between white_key[i] and white_key[i+1])
BLACK_KEY_POSITIONS: dict[int, str] = {
    0: "C#3", 1: "D#3",           3: "F#3", 4: "G#3", 5: "A#3",
    7: "C#4", 8: "D#4",          10: "F#4", 11: "G#4", 12: "A#4",
}

# Colours
_WHITE_NORMAL   = (255, 255, 255)
_WHITE_PRESSED  = (180, 230, 255)
_BLACK_NORMAL   = (25,  25,  25)
_BLACK_PRESSED  = ( 80, 160, 220)
_BORDER         = (  0,   0,   0)
_LABEL_WHITE    = (  0,   0,   0)
_LABEL_BLACK    = (220, 220, 220)


class PianoKeyboard:
    """Draws a piano keyboard and detects which key a pixel falls on."""

    def __init__(self, x: int, y: int, width: int, height: int):
        self.x = x
        self.y = y
        self.width  = width
        self.height = height

        self.num_white     = len(WHITE_KEYS)
        self.wkey_w        = width // self.num_white
        self.bkey_w        = max(8, int(self.wkey_w * 0.55))
        self.bkey_h        = int(height * 0.60)

        self.pressed: set[str] = set()
        self._build_rects()

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------

    def _build_rects(self) -> None:
        """Compute (x, y, w, h) bounding boxes for every key."""
        self._white: dict[str, tuple] = {}
        self._black: dict[str, tuple] = {}

        for i, note in enumerate(WHITE_KEYS):
            kx = self.x + i * self.wkey_w
            self._white[note] = (kx, self.y, self.wkey_w - 1, self.height)

        for white_idx, note in BLACK_KEY_POSITIONS.items():
            # Centre black key at boundary between adjacent white keys
            cx = self.x + (white_idx + 1) * self.wkey_w
            kx = cx - self.bkey_w // 2
            self._black[note] = (kx, self.y, self.bkey_w, self.bkey_h)

    # ------------------------------------------------------------------
    # Hit-testing
    # ------------------------------------------------------------------

    def key_at(self, px: int, py: int) -> str | None:
        """Return note name for a pixel, or None if outside keyboard."""
        # Black keys take priority (they overlay white keys)
        for note, (kx, ky, kw, kh) in self._black.items():
            if kx <= px < kx + kw and ky <= py < ky + kh:
                return note
        for note, (kx, ky, kw, kh) in self._white.items():
            if kx <= px < kx + kw and ky <= py < ky + kh:
                return note
        return None

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------

    def draw(self, frame: np.ndarray) -> None:
        """Draw the keyboard onto frame in-place."""
        # --- white keys ---
        for note, (kx, ky, kw, kh) in self._white.items():
            colour = _WHITE_PRESSED if note in self.pressed else _WHITE_NORMAL
            cv2.rectangle(frame, (kx, ky), (kx + kw, ky + kh), colour, -1)
            cv2.rectangle(frame, (kx, ky), (kx + kw, ky + kh), _BORDER,  1)
            # Short label at bottom
            label = note.replace("3", "").replace("4", "").replace("5", "")
            lx = kx + kw // 2 - 5
            ly = ky + kh - 6
            cv2.putText(frame, label, (lx, ly),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.28, _LABEL_WHITE, 1, cv2.LINE_AA)

        # --- black keys (drawn on top) ---
        for note, (kx, ky, kw, kh) in self._black.items():
            colour = _BLACK_PRESSED if note in self.pressed else _BLACK_NORMAL
            cv2.rectangle(frame, (kx, ky), (kx + kw, ky + kh), colour, -1)
            cv2.rectangle(frame, (kx, ky), (kx + kw, ky + kh), _BORDER,  1)

    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------

    def set_pressed(self, keys: set[str]) -> None:
        self.pressed = keys

    @staticmethod
    def all_notes() -> dict[str, float]:
        return dict(NOTE_FREQUENCIES)
