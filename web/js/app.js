/**
 * app.js
 * ------
 * Main application logic.
 * - MediaPipe Hands integration for finger tracking
 * - Camera overlay rendering
 * - PLAY / LEARN mode handling
 * - Keyboard shortcuts
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIGGER_ZONE_Y = 0.65;   // normalised y threshold (top=0, bottom=1)

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let mode        = 'PLAY';   // 'PLAY' | 'LEARN'
let songIndex   = 0;
let learnStep   = 0;        // index into current song's note array
let learnDone   = false;

// Notes currently pressed by finger (camera) and by piano (touch/mouse)
const fingerNotes = new Set();   // notes triggered by hand tracking
const pianoNotes  = new Set();   // notes triggered via piano canvas

// Edge-detection: what was in the finger zone last frame
let prevFingerZone = new Set();  // set of notes in zone previous frame

// FPS tracking
let lastFrameTime = 0;
let fps = 0;

// ---------------------------------------------------------------------------
// DOM references (populated in init)
// ---------------------------------------------------------------------------

let videoEl, cameraCanvas, cameraCtx;
let pianoCanvas, keyboard;
let soundEngine;
let modeBtn, songSelect, fpsDisplay;
let learnBar, songTitleEl, nextNoteEl, progressEl;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentSong() {
  return SONGS[songIndex];
}

function currentHint() {
  if (mode !== 'LEARN' || learnDone) return null;
  const song = currentSong();
  return song.notes[learnStep] || null;
}

function updateLearnBar() {
  if (mode !== 'LEARN') {
    learnBar.style.display = 'none';
    return;
  }
  learnBar.style.display = 'flex';
  const song = currentSong();
  songTitleEl.textContent = song.title;
  if (learnDone) {
    nextNoteEl.textContent  = '🎉 Complete!';
    progressEl.textContent  = `${song.notes.length} / ${song.notes.length}`;
  } else {
    nextNoteEl.textContent  = `Next: ${song.notes[learnStep]}`;
    progressEl.textContent  = `${learnStep} / ${song.notes.length}`;
  }
}

function setMode(m) {
  mode = m;
  modeBtn.textContent = mode;
  modeBtn.classList.toggle('active', mode === 'LEARN');
  updateLearnBar();
  keyboard.setHint(currentHint());
}

function selectSong(idx) {
  songIndex = ((idx % SONGS.length) + SONGS.length) % SONGS.length;
  learnStep = 0;
  learnDone = false;
  songSelect.value = String(songIndex);
  updateLearnBar();
  keyboard.setHint(currentHint());
}

function restartSong() {
  learnStep = 0;
  learnDone = false;
  updateLearnBar();
  keyboard.setHint(currentHint());
}

// ---------------------------------------------------------------------------
// Note triggering (unified for finger + piano)
// ---------------------------------------------------------------------------

/**
 * Called whenever a note starts being pressed (from either source).
 * source: 'finger' | 'piano'
 */
function noteDown(note, source) {
  if (!soundEngine.isInitialized) {
    soundEngine.init();
  }
  soundEngine.resume();

  if (source === 'finger') fingerNotes.add(note);
  else                     pianoNotes.add(note);

  // Only play if not already sounding (piano or finger could double-trigger)
  const allNotes = new Set([...fingerNotes, ...pianoNotes]);
  soundEngine.play(note);

  keyboard.setActive(allNotes);
  keyboard.setHint(currentHint());

  // LEARN mode: advance on correct note
  if (mode === 'LEARN' && !learnDone) {
    const hint = currentHint();
    if (note === hint) {
      learnStep++;
      if (learnStep >= currentSong().notes.length) {
        learnDone = true;
      }
      updateLearnBar();
      keyboard.setHint(currentHint());
    }
  }
}

function noteUp(note, source) {
  if (source === 'finger') fingerNotes.delete(note);
  else                     pianoNotes.delete(note);

  // Only stop if neither source is pressing it
  if (!fingerNotes.has(note) && !pianoNotes.has(note)) {
    soundEngine.stop(note);
  }

  const allNotes = new Set([...fingerNotes, ...pianoNotes]);
  keyboard.setActive(allNotes);
  keyboard.setHint(currentHint());
}

// ---------------------------------------------------------------------------
// Camera overlay drawing
// ---------------------------------------------------------------------------

function drawCameraOverlay(results) {
  const w = cameraCanvas.width;
  const h = cameraCanvas.height;
  cameraCtx.clearRect(0, 0, w, h);

  // Draw flipped video frame
  cameraCtx.save();
  cameraCtx.scale(-1, 1);
  cameraCtx.drawImage(videoEl, -w, 0, w, h);
  cameraCtx.restore();

  // Trigger zone line
  const zoneY = TRIGGER_ZONE_Y * h;
  cameraCtx.save();
  cameraCtx.setLineDash([12, 8]);
  cameraCtx.strokeStyle = 'rgba(80, 180, 255, 0.85)';
  cameraCtx.lineWidth   = 2;
  cameraCtx.beginPath();
  cameraCtx.moveTo(0, zoneY);
  cameraCtx.lineTo(w, zoneY);
  cameraCtx.stroke();
  cameraCtx.setLineDash([]);
  // Label
  cameraCtx.fillStyle    = 'rgba(80, 180, 255, 0.95)';
  cameraCtx.font         = 'bold 13px sans-serif';
  cameraCtx.textBaseline = 'bottom';
  cameraCtx.textAlign    = 'left';
  cameraCtx.fillText('touch zone', 8, zoneY - 4);
  cameraCtx.restore();

  if (!results.multiHandLandmarks) return;

  for (const landmarks of results.multiHandLandmarks) {
    drawHandSkeleton(landmarks, w, h);
  }
}

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],         // thumb
  [0,5],[5,6],[6,7],[7,8],         // index
  [0,9],[9,10],[10,11],[11,12],    // middle
  [0,13],[13,14],[14,15],[15,16],  // ring
  [0,17],[17,18],[18,19],[19,20],  // pinky
  [5,9],[9,13],[13,17],            // palm
];

// Fingertip landmark indices
const FINGERTIP_IDS = [4, 8, 12, 16, 20];

function landmarkToCanvas(lm, w, h) {
  // MediaPipe coords: x and y are [0,1] where x=0 is left of mirrored image.
  // Since we flip the video, we mirror x too.
  return {
    x: (1 - lm.x) * w,
    y: lm.y * h,
  };
}

function drawHandSkeleton(landmarks, w, h) {
  cameraCtx.save();

  // Connections
  cameraCtx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  cameraCtx.lineWidth   = 1.5;
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = landmarkToCanvas(landmarks[a], w, h);
    const pb = landmarkToCanvas(landmarks[b], w, h);
    cameraCtx.beginPath();
    cameraCtx.moveTo(pa.x, pa.y);
    cameraCtx.lineTo(pb.x, pb.y);
    cameraCtx.stroke();
  }

  // Joints
  for (let i = 0; i < landmarks.length; i++) {
    const p     = landmarkToCanvas(landmarks[i], w, h);
    const isTip = FINGERTIP_IDS.includes(i);
    cameraCtx.beginPath();
    cameraCtx.arc(p.x, p.y, isTip ? 6 : 3.5, 0, Math.PI * 2);
    cameraCtx.fillStyle   = isTip ? '#50b4ff' : 'rgba(255,255,255,0.75)';
    cameraCtx.strokeStyle = '#000';
    cameraCtx.lineWidth   = 1;
    cameraCtx.fill();
    cameraCtx.stroke();
  }

  cameraCtx.restore();
}

// ---------------------------------------------------------------------------
// Finger → note mapping
// ---------------------------------------------------------------------------

function fingerNotesFromLandmarks(results) {
  const inZone = new Set();

  if (!results.multiHandLandmarks) return inZone;

  const cw = cameraCanvas.width;

  for (const landmarks of results.multiHandLandmarks) {
    for (const tipId of FINGERTIP_IDS) {
      const lm = landmarks[tipId];
      if (lm.y >= TRIGGER_ZONE_Y) {
        // Mirror x (same as drawing)
        const mirroredX = (1 - lm.x) * cw;
        const note = keyboard.noteAt(mirroredX, 0);  // y=0 → top of piano (white key area)
        if (note) inZone.add(note);
      }
    }
  }

  return inZone;
}

// ---------------------------------------------------------------------------
// MediaPipe result handler
// ---------------------------------------------------------------------------

function onResults(results) {
  // FPS
  const now = performance.now();
  fps = Math.round(1000 / Math.max(1, now - lastFrameTime));
  lastFrameTime = now;
  fpsDisplay.textContent = `${fps} fps`;

  drawCameraOverlay(results);

  // Compute which notes are currently in the finger zone
  const currentZone = fingerNotesFromLandmarks(results);

  // Edge: newly pressed
  for (const note of currentZone) {
    if (!prevFingerZone.has(note)) {
      noteDown(note, 'finger');
    }
  }

  // Edge: newly released
  for (const note of prevFingerZone) {
    if (!currentZone.has(note)) {
      noteUp(note, 'finger');
    }
  }

  prevFingerZone = currentZone;

  // Keep piano hint in sync every frame
  keyboard.setHint(currentHint());
}

// ---------------------------------------------------------------------------
// Camera setup
// ---------------------------------------------------------------------------

async function startCamera() {
  const noCameraMsg = document.getElementById('no-camera-msg');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width:  { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    noCameraMsg.style.display = 'none';
  } catch (err) {
    console.warn('Camera not available:', err);
    noCameraMsg.style.display = 'flex';
    return;
  }

  // Set up MediaPipe Hands
  const hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands:         2,
    modelComplexity:     1,
    minDetectionConfidence:  0.6,
    minTrackingConfidence:   0.5,
  });

  hands.onResults(onResults);

  const camera = new Camera(videoEl, {
    onFrame: async () => {
      await hands.send({ image: videoEl });
    },
    width:  640,
    height: 480,
  });

  camera.start();
}

// ---------------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------------

function resizeCameraCanvas() {
  const section = cameraCanvas.parentElement;
  const w = section.clientWidth;
  const h = section.clientHeight;
  cameraCanvas.width  = w;
  cameraCanvas.height = h;
}

function resizePianoCanvas() {
  const section = pianoCanvas.parentElement;
  const w = section.clientWidth;
  const h = section.clientHeight;
  keyboard.resize(w, h);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'm': case 'M':
      setMode(mode === 'PLAY' ? 'LEARN' : 'PLAY');
      break;
    case 'r': case 'R':
      restartSong();
      break;
    case '1': case '2': case '3': case '4': case '5':
      selectSong(Number(e.key) - 1);
      break;
    case 'ArrowUp':
      selectSong(songIndex - 1);
      break;
    case 'ArrowDown':
      selectSong(songIndex + 1);
      break;
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  // DOM refs
  videoEl       = document.getElementById('video');
  cameraCanvas  = document.getElementById('camera-canvas');
  cameraCtx     = cameraCanvas.getContext('2d');
  pianoCanvas   = document.getElementById('piano-canvas');
  modeBtn       = document.getElementById('mode-btn');
  songSelect    = document.getElementById('song-select');
  fpsDisplay    = document.getElementById('fps');
  learnBar      = document.getElementById('learn-bar');
  songTitleEl   = document.getElementById('song-title');
  nextNoteEl    = document.getElementById('next-note');
  progressEl    = document.getElementById('progress');

  // Sound engine
  soundEngine = new SoundEngine();

  // Piano keyboard
  keyboard = new PianoKeyboard(pianoCanvas, {
    onNoteDown: (note) => {
      soundEngine.init();
      soundEngine.resume();
      noteDown(note, 'piano');
    },
    onNoteUp: (note) => {
      noteUp(note, 'piano');
    },
  });

  // Populate song dropdown
  SONGS.forEach((song, i) => {
    const opt = document.createElement('option');
    opt.value       = String(i);
    opt.textContent = `${i + 1}. ${song.title}`;
    songSelect.appendChild(opt);
  });
  songSelect.value = '0';

  songSelect.addEventListener('change', () => {
    selectSong(Number(songSelect.value));
  });

  // Mode button
  modeBtn.addEventListener('click', () => {
    soundEngine.init();
    soundEngine.resume();
    setMode(mode === 'PLAY' ? 'LEARN' : 'PLAY');
  });

  // Init audio on first interaction
  const initAudio = () => {
    soundEngine.init();
    document.removeEventListener('touchstart', initAudio);
    document.removeEventListener('mousedown',  initAudio);
  };
  document.addEventListener('touchstart', initAudio, { once: true });
  document.addEventListener('mousedown',  initAudio, { once: true });

  // Initial layout
  setMode('PLAY');
  resizeCameraCanvas();
  resizePianoCanvas();

  // Resize observer
  const ro = new ResizeObserver(() => {
    resizeCameraCanvas();
    resizePianoCanvas();
  });
  ro.observe(cameraCanvas.parentElement);
  ro.observe(pianoCanvas.parentElement);

  // Start camera
  startCamera();
});
