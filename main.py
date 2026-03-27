"""
main.py
-------
Piano Finger Recognition App
=============================

Split-screen layout:
  Top half    — webcam feed with MediaPipe hand skeleton overlay
  Bottom half — virtual piano keyboard (2 octaves, C4–B5)

Controls
--------
  M          : toggle PLAY / LEARN mode
  1 / 2 / 3 / 4 : select song in LEARN mode
  R          : restart current song
  Q / Esc    : quit
"""

from __future__ import annotations

import sys
import time
from collections import deque

import cv2
import numpy as np
import pygame

from hand_tracker import HandTracker
from piano import PianoKeyboard
from sound_engine import SoundEngine
from songs import ALL_SONGS, get_song

# ---------------------------------------------------------------------------
# Layout constants
# ---------------------------------------------------------------------------
WIN_W       = 1280
WIN_H       = 720
CAM_H       = WIN_H // 2          # top half for camera
PIANO_H     = WIN_H - CAM_H       # bottom half for piano

FPS_TARGET  = 30

# How many pixels above the piano the fingertip must be to count as a press
# (relative to the piano surface origin, so 0 means exactly touching the top)
TRIGGER_MARGIN = 20

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
CLR_BG        = (15,  15,  20)
CLR_TEXT      = (220, 220, 220)
CLR_ACCENT    = ( 80, 180, 255)
CLR_GREEN     = ( 80, 220, 100)
CLR_ORANGE    = (255, 160,  50)
CLR_OVERLAY   = ( 0,   0,   0, 160)   # semi-transparent black

FONT_LARGE  = None
FONT_MEDIUM = None
FONT_SMALL  = None


def init_fonts() -> None:
    global FONT_LARGE, FONT_MEDIUM, FONT_SMALL
    pygame.font.init()
    FONT_LARGE  = pygame.font.SysFont("dejavusans", 36, bold=True)
    FONT_MEDIUM = pygame.font.SysFont("dejavusans", 24)
    FONT_SMALL  = pygame.font.SysFont("dejavusans", 18)


# ---------------------------------------------------------------------------
# Helper: draw text with optional shadow
# ---------------------------------------------------------------------------
def draw_text(surface: pygame.Surface, text: str, font: pygame.font.Font,
              colour: tuple, pos: tuple, shadow: bool = True) -> None:
    if shadow:
        shadow_surf = font.render(text, True, (0, 0, 0))
        surface.blit(shadow_surf, (pos[0] + 1, pos[1] + 1))
    text_surf = font.render(text, True, colour)
    surface.blit(text_surf, pos)


# ---------------------------------------------------------------------------
# Helper: convert OpenCV BGR frame to pygame Surface
# ---------------------------------------------------------------------------
def bgr_to_pygame_surface(bgr: np.ndarray, target_size: tuple[int, int]) -> pygame.Surface:
    rgb      = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    resized  = cv2.resize(rgb, target_size, interpolation=cv2.INTER_LINEAR)
    # pygame expects (width, height, channels) with axes swapped
    return pygame.surfarray.make_surface(resized.swapaxes(0, 1))


# ---------------------------------------------------------------------------
# App state
# ---------------------------------------------------------------------------
class AppState:
    MODE_PLAY  = "PLAY"
    MODE_LEARN = "LEARN"

    def __init__(self):
        self.mode          = self.MODE_PLAY
        self.song_index    = 0
        self.song          = get_song(0)
        self.song_step     = 0            # index into song.note_sequence()
        self.song_complete = False

        # Notes currently pressed by fingertips (this frame)
        self.pressed_notes: set[str] = set()
        # Notes pressed in the previous frame (for edge detection)
        self.prev_pressed: set[str] = set()

        # FPS tracking
        self._frame_times: deque[float] = deque(maxlen=30)

    # ------------------------------------------------------------------

    def toggle_mode(self) -> None:
        self.mode = self.MODE_LEARN if self.mode == self.MODE_PLAY else self.MODE_PLAY
        self.restart_song()

    def select_song(self, index: int) -> None:
        self.song_index    = index % len(ALL_SONGS)
        self.song          = get_song(self.song_index)
        self.restart_song()

    def restart_song(self) -> None:
        self.song_step     = 0
        self.song_complete = False

    def current_hint(self) -> str | None:
        if self.mode != self.MODE_LEARN or self.song_complete:
            return None
        seq = self.song.note_sequence()
        if self.song_step < len(seq):
            return seq[self.song_step]
        return None

    def on_note_pressed(self, note: str, engine: SoundEngine) -> None:
        """Called when a new note is triggered this frame."""
        engine.play(note)

        if self.mode == self.MODE_LEARN and not self.song_complete:
            seq = self.song.note_sequence()
            if self.song_step < len(seq) and note == seq[self.song_step]:
                self.song_step += 1
                if self.song_step >= len(seq):
                    self.song_complete = True

    def record_frame_time(self) -> None:
        self._frame_times.append(time.monotonic())

    def fps(self) -> float:
        if len(self._frame_times) < 2:
            return 0.0
        span = self._frame_times[-1] - self._frame_times[0]
        return (len(self._frame_times) - 1) / span if span > 0 else 0.0


# ---------------------------------------------------------------------------
# HUD drawing
# ---------------------------------------------------------------------------
def draw_hud(surface: pygame.Surface, state: AppState, num_hands: int) -> None:
    # Top-left: FPS + hands detected
    fps_text = f"FPS: {state.fps():.0f}   Hands: {num_hands}"
    draw_text(surface, fps_text, FONT_SMALL, CLR_TEXT, (10, 8))

    # Mode badge (top-right)
    mode_colour = CLR_ACCENT if state.mode == AppState.MODE_PLAY else CLR_GREEN
    mode_text   = f"[{state.mode} MODE]"
    ms          = FONT_MEDIUM.size(mode_text)
    draw_text(surface, mode_text, FONT_MEDIUM, mode_colour,
              (WIN_W - ms[0] - 10, 8))

    # LEARN-mode info bar (below the camera view)
    if state.mode == AppState.MODE_LEARN:
        bar_y = CAM_H - 36
        pygame.draw.rect(surface, (20, 20, 40),
                         pygame.Rect(0, bar_y, WIN_W, 36))
        if state.song_complete:
            msg = f"Song complete!  Press R to restart."
            draw_text(surface, msg, FONT_MEDIUM, CLR_ORANGE, (10, bar_y + 6))
        else:
            seq  = state.song.note_sequence()
            step = state.song_step
            hint = state.current_hint() or ""
            progress = f"{step}/{len(seq)}"
            song_label = f"\u266b {state.song.title}"
            draw_text(surface, song_label,  FONT_MEDIUM, CLR_TEXT,   (10,       bar_y + 6))
            draw_text(surface, progress,    FONT_MEDIUM, CLR_ACCENT,  (WIN_W//2, bar_y + 6))
            next_lbl = f"Next: {hint}"
            nl_w = FONT_MEDIUM.size(next_lbl)[0]
            draw_text(surface, next_lbl, FONT_MEDIUM, CLR_GREEN,
                      (WIN_W - nl_w - 10, bar_y + 6))

    # Bottom hint strip
    hint_y = WIN_H - 20
    controls = "M: toggle mode   1-4: select song   R: restart   Q/Esc: quit"
    cw = FONT_SMALL.size(controls)[0]
    draw_text(surface, controls, FONT_SMALL, (120, 120, 120),
              ((WIN_W - cw) // 2, hint_y))


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def main() -> None:
    # --- pygame setup ---
    pygame.init()
    init_fonts()

    screen = pygame.display.set_mode((WIN_W, WIN_H))
    pygame.display.set_caption("Piano Finger Recognition")
    clock  = pygame.time.Clock()

    # --- subsystems ---
    print("Initialising sound engine (pre-rendering notes)…")
    engine  = SoundEngine()
    print("Sound engine ready.")

    tracker = HandTracker(max_hands=2)
    piano   = PianoKeyboard(WIN_W, PIANO_H)
    state   = AppState()

    # --- camera ---
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: Cannot open webcam (device 0).")
        print("Running in demo mode (no camera).")
        cap = None

    # Piano surface offset (in screen coordinates)
    piano_y = CAM_H   # piano starts where camera ends

    running = True
    while running:
        # ----------------------------------------------------------------
        # Events
        # ----------------------------------------------------------------
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            elif event.type == pygame.KEYDOWN:
                if event.key in (pygame.K_q, pygame.K_ESCAPE):
                    running = False
                elif event.key == pygame.K_m:
                    state.toggle_mode()
                    engine.stop_all()
                elif event.key == pygame.K_r:
                    state.restart_song()
                elif event.key == pygame.K_1:
                    state.select_song(0)
                elif event.key == pygame.K_2:
                    state.select_song(1)
                elif event.key == pygame.K_3:
                    state.select_song(2)
                elif event.key == pygame.K_4:
                    state.select_song(3)

        # ----------------------------------------------------------------
        # Camera frame
        # ----------------------------------------------------------------
        cam_frame: np.ndarray | None = None
        hand_results = []

        if cap is not None:
            ret, frame = cap.read()
            if ret:
                frame      = cv2.flip(frame, 1)   # mirror
                cam_frame  = frame.copy()
                hand_results = tracker.process(frame)
                # Draw skeletons onto cam_frame
                for hr in hand_results:
                    hr.draw_landmarks(cam_frame)

        # ----------------------------------------------------------------
        # Figure out which piano keys are being touched
        # ----------------------------------------------------------------
        current_pressed: set[str] = set()

        for hr in hand_results:
            for (fx, fy) in hr.fingertip_positions():
                # fy is relative to full camera frame height
                # Map camera pixel to piano surface coordinates:
                #   camera frame height → CAM_H (screen pixels)
                if cam_frame is not None:
                    cam_h_px, cam_w_px = cam_frame.shape[:2]
                    # Scale factor from original frame to displayed area
                    scale_x = WIN_W / cam_w_px
                    scale_y = CAM_H / cam_h_px
                    sx = int(fx * scale_x)
                    sy = int(fy * scale_y)
                else:
                    sx, sy = fx, fy

                # Check if fingertip is within or just above the piano area
                dist_from_piano_top = sy - piano_y
                if -TRIGGER_MARGIN <= dist_from_piano_top <= PIANO_H:
                    piano_local_y = max(0, dist_from_piano_top)
                    note = piano.note_at(sx, piano_local_y)
                    if note:
                        current_pressed.add(note)

        # ----------------------------------------------------------------
        # Note on / off logic (edge detection)
        # ----------------------------------------------------------------
        newly_pressed  = current_pressed - state.prev_pressed
        newly_released = state.prev_pressed - current_pressed

        for note in newly_pressed:
            state.on_note_pressed(note, engine)

        for note in newly_released:
            engine.stop(note)

        state.pressed_notes = current_pressed
        state.prev_pressed  = current_pressed

        # Update piano visual state
        piano.set_active(current_pressed)
        piano.set_hover(current_pressed)
        piano.set_hint(state.current_hint())

        # ----------------------------------------------------------------
        # Render
        # ----------------------------------------------------------------
        screen.fill(CLR_BG)

        # Camera area
        if cam_frame is not None:
            cam_surf = bgr_to_pygame_surface(cam_frame, (WIN_W, CAM_H))
            screen.blit(cam_surf, (0, 0))
        else:
            # No camera: draw placeholder
            pygame.draw.rect(screen, (30, 30, 40), pygame.Rect(0, 0, WIN_W, CAM_H))
            msg = "No camera detected — hand tracking unavailable"
            mw  = FONT_MEDIUM.size(msg)[0]
            draw_text(screen, msg, FONT_MEDIUM, (160, 80, 80),
                      ((WIN_W - mw) // 2, CAM_H // 2 - 12))

        # Piano keyboard
        piano.draw(screen, offset_y=piano_y)

        # HUD
        draw_hud(screen, state, len(hand_results))

        pygame.display.flip()

        state.record_frame_time()
        clock.tick(FPS_TARGET)

    # ----------------------------------------------------------------
    # Cleanup
    # ----------------------------------------------------------------
    engine.stop_all()
    tracker.release()
    if cap is not None:
        cap.release()
    pygame.quit()
    sys.exit(0)


if __name__ == "__main__":
    main()
