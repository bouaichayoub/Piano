"""
piano.py
--------
Renders a two-octave (C4–B5) piano keyboard onto a pygame Surface and
provides hit-testing so the app can ask "which note is at pixel (x, y)?".

Key layout
----------
White keys : C D E F G A B  (7 per octave × 2 = 14 white keys)
Black keys : C# D# F# G# A# (5 per octave × 2 = 10 black keys)

The keyboard spans the full width of the surface passed in.
"""

from __future__ import annotations
import pygame
from typing import NamedTuple

# ---------------------------------------------------------------------------
# Colour palette
# ---------------------------------------------------------------------------
CLR_WHITE_KEY        = (245, 245, 235)
CLR_WHITE_KEY_HOVER  = (200, 230, 255)
CLR_WHITE_KEY_ACTIVE = ( 80, 180, 255)
CLR_WHITE_KEY_HINT   = (120, 230, 120)   # "press me next" highlight
CLR_BLACK_KEY        = ( 30,  30,  30)
CLR_BLACK_KEY_HOVER  = ( 60,  90, 130)
CLR_BLACK_KEY_ACTIVE = ( 40, 130, 220)
CLR_BLACK_KEY_HINT   = ( 30, 160,  60)
CLR_KEY_BORDER       = ( 80,  80,  80)
CLR_LABEL            = ( 60,  60,  60)
CLR_LABEL_BLACK      = (200, 200, 200)
CLR_BG               = ( 20,  20,  20)

# ---------------------------------------------------------------------------
# Note ordering inside one octave
# ---------------------------------------------------------------------------
WHITE_NOTES_IN_OCTAVE = ["C", "D", "E", "F", "G", "A", "B"]
BLACK_NOTES_IN_OCTAVE = {
    0: "C#",   # between C and D
    1: "D#",   # between D and E
    3: "F#",   # between F and G
    4: "G#",   # between G and A
    5: "A#",   # between A and B
}

OCTAVES = [4, 5]   # two octaves


class KeyRect(NamedTuple):
    note:     str          # e.g. "C4", "F#5"
    rect:     pygame.Rect
    is_black: bool


class PianoKeyboard:
    """
    Draws a piano keyboard and reports which note (if any) is at a given
    pixel coordinate.

    Parameters
    ----------
    surface_width  : total pixel width available for the keyboard
    surface_height : total pixel height of the keyboard surface
    """

    def __init__(self, surface_width: int, surface_height: int):
        self.width  = surface_width
        self.height = surface_height

        # Count how many white keys we have
        num_white = len(WHITE_NOTES_IN_OCTAVE) * len(OCTAVES)   # 14

        self.white_key_w = self.width  // num_white
        self.white_key_h = self.height
        self.black_key_w = int(self.white_key_w * 0.58)
        self.black_key_h = int(self.white_key_h * 0.60)

        # Build key geometry
        self._white_keys: list[KeyRect] = []
        self._black_keys: list[KeyRect] = []
        self._build_keys()

        # Runtime state
        self.active_notes: set[str] = set()    # currently sounding
        self.hover_notes:  set[str] = set()    # fingertip hovering
        self.hint_note:    str | None = None   # "press me next" in LEARN mode

        # Font for labels
        pygame.font.init()
        self._font = pygame.font.SysFont("dejavusans", max(10, self.white_key_w // 3))

    # ------------------------------------------------------------------
    # Build geometry
    # ------------------------------------------------------------------

    def _build_keys(self) -> None:
        white_idx = 0
        for octave in OCTAVES:
            for note_idx, note_name in enumerate(WHITE_NOTES_IN_OCTAVE):
                full_name = f"{note_name}{octave}"
                x = white_idx * self.white_key_w
                rect = pygame.Rect(x, 0, self.white_key_w - 1, self.white_key_h - 1)
                self._white_keys.append(KeyRect(full_name, rect, False))

                # Black key to the right of this white key?
                if note_idx in BLACK_NOTES_IN_OCTAVE:
                    black_name = f"{BLACK_NOTES_IN_OCTAVE[note_idx]}{octave}"
                    bx = x + self.white_key_w - self.black_key_w // 2
                    brect = pygame.Rect(bx, 0, self.black_key_w, self.black_key_h)
                    self._black_keys.append(KeyRect(black_name, brect, True))

                white_idx += 1

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def note_at(self, px: int, py: int) -> str | None:
        """Return the note name whose key contains pixel (px, py), or None."""
        # Black keys take priority (drawn on top)
        for key in self._black_keys:
            if key.rect.collidepoint(px, py):
                return key.note
        for key in self._white_keys:
            if key.rect.collidepoint(px, py):
                return key.note
        return None

    def set_active(self, notes: set[str]) -> None:
        self.active_notes = set(notes)

    def set_hover(self, notes: set[str]) -> None:
        self.hover_notes = set(notes)

    def set_hint(self, note: str | None) -> None:
        self.hint_note = note

    def draw(self, surface: pygame.Surface, offset_y: int = 0) -> None:
        """
        Draw the keyboard onto *surface*.

        Parameters
        ----------
        surface  : destination pygame Surface
        offset_y : vertical offset (pixels) within that surface
        """
        # Background bar
        bg_rect = pygame.Rect(0, offset_y, self.width, self.height)
        pygame.draw.rect(surface, CLR_BG, bg_rect)

        self._draw_white_keys(surface, offset_y)
        self._draw_black_keys(surface, offset_y)

    def get_key_rects(self) -> list[KeyRect]:
        """Return all KeyRect objects (white + black)."""
        return self._white_keys + self._black_keys

    # ------------------------------------------------------------------
    # Private drawing helpers
    # ------------------------------------------------------------------

    def _key_colour(self, key: KeyRect) -> tuple[int, int, int]:
        note = key.note
        if key.is_black:
            if note == self.hint_note:
                return CLR_BLACK_KEY_HINT
            if note in self.active_notes:
                return CLR_BLACK_KEY_ACTIVE
            if note in self.hover_notes:
                return CLR_BLACK_KEY_HOVER
            return CLR_BLACK_KEY
        else:
            if note == self.hint_note:
                return CLR_WHITE_KEY_HINT
            if note in self.active_notes:
                return CLR_WHITE_KEY_ACTIVE
            if note in self.hover_notes:
                return CLR_WHITE_KEY_HOVER
            return CLR_WHITE_KEY

    def _draw_white_keys(self, surface: pygame.Surface, offset_y: int) -> None:
        for key in self._white_keys:
            r = key.rect.move(0, offset_y)
            colour = self._key_colour(key)

            # Gradient-like: lighter at top, slightly darker at bottom
            pygame.draw.rect(surface, colour, r, border_radius=3)
            pygame.draw.rect(surface, CLR_KEY_BORDER, r, width=1, border_radius=3)

            # Label (note name) near the bottom of the white key
            label_surf = self._font.render(key.note, True, CLR_LABEL)
            lx = r.centerx - label_surf.get_width() // 2
            ly = r.bottom - label_surf.get_height() - 4
            surface.blit(label_surf, (lx, ly))

    def _draw_black_keys(self, surface: pygame.Surface, offset_y: int) -> None:
        for key in self._black_keys:
            r = key.rect.move(0, offset_y)
            colour = self._key_colour(key)

            pygame.draw.rect(surface, colour, r, border_radius=2)
            pygame.draw.rect(surface, (0, 0, 0), r, width=1, border_radius=2)

            # Small label
            label_surf = self._font.render(key.note, True, CLR_LABEL_BLACK)
            lx = r.centerx - label_surf.get_width() // 2
            ly = r.bottom - label_surf.get_height() - 3
            surface.blit(label_surf, (lx, ly))
