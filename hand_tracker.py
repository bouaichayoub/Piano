import cv2
import mediapipe as mp

# MediaPipe landmark indices for fingertips
FINGERTIP_IDS = [4, 8, 12, 16, 20]   # thumb, index, middle, ring, pinky
# One joint below each tip (used to detect "pressed-down" gesture)
FINGER_DIP_IDS = [3, 7, 11, 15, 19]


class HandTracker:
    """Wraps MediaPipe Hands to return fingertip pixel positions."""

    def __init__(self, max_hands: int = 2,
                 detect_conf: float = 0.7,
                 track_conf: float = 0.5):
        self._mp_hands = mp.solutions.hands
        self._mp_draw  = mp.solutions.drawing_utils
        self._mp_style = mp.solutions.drawing_styles
        self._hands = self._mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=max_hands,
            min_detection_confidence=detect_conf,
            min_tracking_confidence=track_conf,
        )

    # ------------------------------------------------------------------
    # Processing
    # ------------------------------------------------------------------

    def process(self, bgr_frame):
        """
        Process a BGR frame.

        Returns
        -------
        fingertips : list of (x, y) pixel tuples  – all visible fingertips
        results    : raw MediaPipe results object (for drawing)
        """
        h, w = bgr_frame.shape[:2]
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = self._hands.process(rgb)
        rgb.flags.writeable = True

        fingertips = []
        if results.multi_hand_landmarks:
            for hand_lm in results.multi_hand_landmarks:
                for tip_id in FINGERTIP_IDS:
                    lm = hand_lm.landmark[tip_id]
                    fingertips.append((int(lm.x * w), int(lm.y * h)))

        return fingertips, results

    # ------------------------------------------------------------------
    # Drawing
    # ------------------------------------------------------------------

    def draw(self, frame, results) -> None:
        """Draw skeleton + landmarks onto frame in-place."""
        if not results.multi_hand_landmarks:
            return
        for hand_lm in results.multi_hand_landmarks:
            self._mp_draw.draw_landmarks(
                frame,
                hand_lm,
                self._mp_hands.HAND_CONNECTIONS,
                self._mp_style.get_default_hand_landmarks_style(),
                self._mp_style.get_default_hand_connections_style(),
            )

    def close(self) -> None:
        self._hands.close()
