"""
songs.py
--------
Simple songs for the LEARN mode.

Each song is a list of (note_name, duration_beats) tuples.
Note names must match the keys in sound_engine.NOTE_FREQUENCIES.

A Song object carries:
  - title      : display name
  - notes      : list of (note, beats) pairs
  - bpm        : beats per minute (for reference; timing is driven by key presses)
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass
class Song:
    title: str
    notes: list[tuple[str, float]]   # (note_name, duration_beats)
    bpm:   int = 120

    def note_sequence(self) -> list[str]:
        """Return just the note names in order (duplicated for repeated notes)."""
        return [note for note, _ in self.notes]


# ---------------------------------------------------------------------------
# Song definitions
# ---------------------------------------------------------------------------

TWINKLE_TWINKLE = Song(
    title="Twinkle Twinkle Little Star",
    bpm=100,
    notes=[
        ("C4", 1), ("C4", 1), ("G4", 1), ("G4", 1),
        ("A4", 1), ("A4", 1), ("G4", 2),
        ("F4", 1), ("F4", 1), ("E4", 1), ("E4", 1),
        ("D4", 1), ("D4", 1), ("C4", 2),
        ("G4", 1), ("G4", 1), ("F4", 1), ("F4", 1),
        ("E4", 1), ("E4", 1), ("D4", 2),
        ("G4", 1), ("G4", 1), ("F4", 1), ("F4", 1),
        ("E4", 1), ("E4", 1), ("D4", 2),
        ("C4", 1), ("C4", 1), ("G4", 1), ("G4", 1),
        ("A4", 1), ("A4", 1), ("G4", 2),
        ("F4", 1), ("F4", 1), ("E4", 1), ("E4", 1),
        ("D4", 1), ("D4", 1), ("C4", 2),
    ],
)

HAPPY_BIRTHDAY = Song(
    title="Happy Birthday",
    bpm=90,
    notes=[
        ("G4", 0.75), ("G4", 0.25), ("A4", 1), ("G4", 1), ("C5", 1), ("B4", 2),
        ("G4", 0.75), ("G4", 0.25), ("A4", 1), ("G4", 1), ("D5", 1), ("C5", 2),
        ("G4", 0.75), ("G4", 0.25), ("G5", 1), ("E5", 1), ("C5", 1), ("B4", 1), ("A4", 2),
        ("F5", 0.75), ("F5", 0.25), ("E5", 1), ("C5", 1), ("D5", 1), ("C5", 2),
    ],
)

ODE_TO_JOY = Song(
    title="Ode to Joy",
    bpm=110,
    notes=[
        ("E4", 1), ("E4", 1), ("F4", 1), ("G4", 1),
        ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
        ("C4", 1), ("C4", 1), ("D4", 1), ("E4", 1),
        ("E4", 1.5), ("D4", 0.5), ("D4", 2),
        ("E4", 1), ("E4", 1), ("F4", 1), ("G4", 1),
        ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
        ("C4", 1), ("C4", 1), ("D4", 1), ("E4", 1),
        ("D4", 1.5), ("C4", 0.5), ("C4", 2),
        ("D4", 1), ("D4", 1), ("E4", 1), ("C4", 1),
        ("D4", 1), ("E4", 0.5), ("F4", 0.5), ("E4", 1), ("C4", 1),
        ("D4", 1), ("E4", 0.5), ("F4", 0.5), ("E4", 1), ("D4", 1),
        ("C4", 1), ("D4", 1), ("G4", 2),
    ],
)

MARY_HAD_A_LITTLE_LAMB = Song(
    title="Mary Had a Little Lamb",
    bpm=100,
    notes=[
        ("E4", 1), ("D4", 1), ("C4", 1), ("D4", 1),
        ("E4", 1), ("E4", 1), ("E4", 2),
        ("D4", 1), ("D4", 1), ("D4", 2),
        ("E4", 1), ("G4", 1), ("G4", 2),
        ("E4", 1), ("D4", 1), ("C4", 1), ("D4", 1),
        ("E4", 1), ("E4", 1), ("E4", 1), ("E4", 1),
        ("D4", 1), ("D4", 1), ("E4", 1), ("D4", 1),
        ("C4", 4),
    ],
)

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

ALL_SONGS: list[Song] = [
    TWINKLE_TWINKLE,
    HAPPY_BIRTHDAY,
    ODE_TO_JOY,
    MARY_HAD_A_LITTLE_LAMB,
]


def get_song(index: int) -> Song:
    """Return a song by 0-based index (wraps around)."""
    return ALL_SONGS[index % len(ALL_SONGS)]
