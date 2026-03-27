"""
hand_tracker.py
---------------
Thin wrapper around MediaPipe Hands.

Provides:
  - HandTracker.process(bgr_frame) -> list[HandResult]
  - HandResult.fingertip_positions(frame_w, frame_h) -> list[(x, y)]
  - HandResult.draw_landmarks(bgr_frame)
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np

# ---------------------------------------------------------------------------
# MediaPipe landmark indices for fingertips
# ---------------------------------------------------------------------------
FINGERTIP_IDS = [
    4,   # THUMB_TIP
    8,   # INDEX_FINGER_TIP
    12,  # MIDDLE_FINGER_TIP
    16,  # RING_FINGER_TIP
    20,  # PINKY_TIP
]

# Colours for drawing
LANDMARK_COLOUR    = (0, 255, 0)      # green dots
CONNECTION_COLOUR  = (255, 200, 0)    # yellow connections
FINGERTIP_COLOUR   = (0, 80, 255)     # blue dots for fingertips
FINGERTIP_RADIUS   = 8


@dataclass
class HandResult:
    """Processed result for a single detected hand."""
    landmarks_px: list[tuple[int, int]] = field(default_factory=list)
    handedness:   str = "Unknown"       # "Left" or "Right"

    def fingertip_positions(self) -> list[tuple[int, int]]:
        """Return pixel coordinates of the 5 fingertips."""
        tips = []
        for idx in FINGERTIP_IDS:
            if idx < len(self.landmarks_px):
                tips.append(self.landmarks_px[idx])
        return tips

    def draw_landmarks(self, frame: np.ndarray) -> None:
        """Draw skeleton and fingertips onto *frame* in-place."""
        if not self.landmarks_px:
            return

        # Draw connections (MediaPipe HAND_CONNECTIONS)
        for start_idx, end_idx in mp.solutions.hands.HAND_CONNECTIONS:
            if start_idx < len(self.landmarks_px) and end_idx < len(self.landmarks_px):
                cv2.line(frame,
                         self.landmarks_px[start_idx],
                         self.landmarks_px[end_idx],
                         CONNECTION_COLOUR, 2, cv2.LINE_AA)

        # Draw all landmark dots
        for i, pt in enumerate(self.landmarks_px):
            radius  = FINGERTIP_RADIUS if i in FINGERTIP_IDS else 4
            colour  = FINGERTIP_COLOUR if i in FINGERTIP_IDS else LANDMARK_COLOUR
            cv2.circle(frame, pt, radius, colour, -1, cv2.LINE_AA)
            cv2.circle(frame, pt, radius, (255, 255, 255), 1, cv2.LINE_AA)

        # Label handedness near wrist (landmark 0)
        if self.landmarks_px:
            wrist = self.landmarks_px[0]
            cv2.putText(frame, self.handedness,
                        (wrist[0] + 10, wrist[1] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        (255, 255, 255), 2, cv2.LINE_AA)


class HandTracker:
    """
    Wraps MediaPipe Hands for multi-hand detection.

    Parameters
    ----------
    max_hands        : maximum number of hands to detect simultaneously
    min_detect_conf  : minimum detection confidence threshold
    min_track_conf   : minimum tracking confidence threshold
    """

    def __init__(self,
                 max_hands:       int   = 2,
                 min_detect_conf: float = 0.6,
                 min_track_conf:  float = 0.5):

        self._mp_hands = mp.solutions.hands
        self._hands = self._mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=max_hands,
            min_detection_confidence=min_detect_conf,
            min_tracking_confidence=min_track_conf,
        )

    # ------------------------------------------------------------------

    def process(self, bgr_frame: np.ndarray) -> list[HandResult]:
        """
        Detect hands in *bgr_frame* (as returned by cv2.VideoCapture.read).

        Returns a list of HandResult objects (one per detected hand).
        """
        h, w = bgr_frame.shape[:2]
        rgb  = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = self._hands.process(rgb)
        rgb.flags.writeable = True

        hand_results: list[HandResult] = []

        if not results.multi_hand_landmarks:
            return hand_results

        handedness_list = results.multi_handedness or []

        for i, hand_lm in enumerate(results.multi_hand_landmarks):
            # Pixel coordinates for every landmark
            lm_px = [
                (int(lm.x * w), int(lm.y * h))
                for lm in hand_lm.landmark
            ]

            # Handedness label
            hand_label = "Unknown"
            if i < len(handedness_list):
                hand_label = handedness_list[i].classification[0].label

            hand_results.append(HandResult(landmarks_px=lm_px,
                                           handedness=hand_label))

        return hand_results

    def release(self) -> None:
        """Free MediaPipe resources."""
        self._hands.close()
