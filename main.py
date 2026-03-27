"""
Piano Finger Recognition
========================
Move your fingers into the piano keyboard area at the bottom of the screen
to play notes.  Two hands and all ten fingers are supported.

Controls
--------
  Q / Esc   – quit
  H         – toggle hand-skeleton overlay
  F         – toggle fullscreen
"""

import sys
import cv2
import numpy as np

from hand_tracker   import HandTracker
from piano_keyboard import PianoKeyboard
from sound_engine   import SoundEngine

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
WIN_W, WIN_H   = 1280, 720
PIANO_H        = 160          # height of the keyboard strip at the bottom
CAMERA_INDEX   = 0
DEBOUNCE_FRAMES = 2           # frames a fingertip must stay on a key before playing


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def blend_overlay(frame: np.ndarray, overlay: np.ndarray, alpha: float) -> None:
    """Alpha-blend overlay onto frame in-place (same size, BGR)."""
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)


def draw_floating_labels(frame: np.ndarray, labels: list[tuple]) -> None:
    """Draw rising note labels. labels = [(note, x, y, age_frames), ...]"""
    for note, x, y, age in labels:
        alpha_val = max(0, 1.0 - age / 45)
        colour = (int(50 * alpha_val), int(220 * alpha_val), int(255 * alpha_val))
        y_pos  = y - age * 2          # float upward
        cv2.putText(frame, note, (x - 10, max(20, y_pos)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, colour, 2, cv2.LINE_AA)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Initialising camera…")
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print("ERROR: cannot open camera.", file=sys.stderr)
        sys.exit(1)

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  WIN_W)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, WIN_H)

    print("Loading sound engine…")
    sound  = SoundEngine()
    piano  = PianoKeyboard(0, WIN_H - PIANO_H, WIN_W, PIANO_H)
    sound.preload(piano.all_notes())
    print("Ready – show your hands!")

    tracker = HandTracker(max_hands=2)

    # Per-note frame counter: how many consecutive frames a tip is on the key
    dwell: dict[str, int] = {}
    prev_playing: set[str] = set()

    # Floating note labels  [(note_str, cx, cy, age_frames)]
    float_labels: list[list] = []

    show_skeleton  = True
    fullscreen     = False

    cv2.namedWindow("Piano – Finger Recognition", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Piano – Finger Recognition", WIN_W, WIN_H)

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Camera read failed – exiting.")
            break

        # Mirror so left hand = left on screen
        frame = cv2.flip(frame, 1)
        frame = cv2.resize(frame, (WIN_W, WIN_H))

        # ---- finger tracking ----
        fingertips, results = tracker.process(frame)

        if show_skeleton:
            tracker.draw(frame, results)

        # ---- determine which keys are touched ----
        touched_now: dict[str, tuple] = {}   # note → (cx, cy)
        for (fx, fy) in fingertips:
            note = piano.key_at(fx, fy)
            if note:
                touched_now[note] = (fx, fy)
                cv2.circle(frame, (fx, fy), 10, (0, 255, 120), -1)
                cv2.circle(frame, (fx, fy), 10, (0, 0, 0),      1)
            else:
                cv2.circle(frame, (fx, fy), 8, (0, 200, 255), -1)

        # Update dwell counters
        new_dwell: dict[str, int] = {}
        for note in touched_now:
            new_dwell[note] = dwell.get(note, 0) + 1
        dwell = new_dwell

        # A note "fires" when it reaches the dwell threshold
        firing: set[str] = {n for n, cnt in dwell.items()
                             if cnt == DEBOUNCE_FRAMES}

        for note in firing:
            sound.play(note)
            cx, cy = touched_now[note]
            float_labels.append([note, cx, WIN_H - PIANO_H - 10, 0])

        prev_playing = set(touched_now.keys())
        piano.set_pressed(prev_playing)

        # ---- draw piano ----
        piano.draw(frame)

        # ---- floating labels ----
        float_labels = [lbl for lbl in float_labels if lbl[3] < 50]
        draw_floating_labels(frame, [tuple(l) for l in float_labels])
        for lbl in float_labels:
            lbl[3] += 1

        # ---- HUD ----
        hud_lines = [
            "Piano Finger Recognition",
            "Move fingertips onto the keyboard to play",
            "H: toggle skeleton | F: fullscreen | Q/Esc: quit",
        ]
        for i, line in enumerate(hud_lines):
            y_pos = 28 + i * 22
            cv2.putText(frame, line, (10, y_pos),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                        (0, 0, 0), 3, cv2.LINE_AA)
            cv2.putText(frame, line, (10, y_pos),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                        (255, 255, 255), 1, cv2.LINE_AA)

        cv2.imshow("Piano – Finger Recognition", frame)

        # ---- keyboard input ----
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):    # Q or Esc
            break
        elif key == ord("h"):
            show_skeleton = not show_skeleton
        elif key == ord("f"):
            fullscreen = not fullscreen
            flag = cv2.WINDOW_FULLSCREEN if fullscreen else cv2.WINDOW_NORMAL
            cv2.setWindowProperty("Piano – Finger Recognition",
                                  cv2.WND_PROP_FULLSCREEN,
                                  cv2.WINDOW_FULLSCREEN if fullscreen else cv2.WINDOW_NORMAL)

    cap.release()
    cv2.destroyAllWindows()
    tracker.close()


if __name__ == "__main__":
    main()
