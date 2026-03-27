/**
 * app.js — Main application logic.
 *
 * Enhancements over v1:
 *  - Per-finger colour coding (5 colours, thumb → pinky)
 *  - Note-name bubble drawn at each fingertip in the trigger zone
 *  - Animated (pulsing + gradient) trigger zone line
 *  - Audio spectrum visualiser drawn at the top of the camera view
 *  - Floating note labels that rise & fade when a note is played
 *  - Score + streak tracking in LEARN mode
 *  - Green/red flash feedback for correct/wrong notes
 *  - Confetti particle burst on song completion
 *  - Song-complete overlay with restart button
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIGGER_ZONE_Y = 0.65;   // normalised y threshold (0 = top, 1 = bottom)

// One colour per finger: thumb, index, middle, ring, pinky
const FINGER_COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff'];
const FINGERTIP_IDS  = [4, 8, 12, 16, 20];

// Float label colour per finger (same palette)
const FLOAT_COLORS = FINGER_COLORS;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let mode      = 'PLAY';   // 'PLAY' | 'LEARN'
let songIndex = 0;
let learnStep = 0;
let learnDone = false;
let score     = 0;
let streak    = 0;

const fingerNotes    = new Set();
const pianoNotes     = new Set();
let   prevFingerZone = new Set();

// FPS
let lastFrameTime = 0;
let fps = 0;

// Trigger zone pulse animation
let triggerPulse = 0;

// Spectrum data
let analyserData = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

let videoEl, cameraCanvas, cameraCtx;
let confettiCanvas, confettiCtx;
let pianoCanvas, keyboard;
let soundEngine;
let modeBtn, songSelect, fpsDisplay;
let learnBar, songTitleEl, nextNoteEl, progressEl, progressBarFill;
let scoreValEl, streakValEl;
let flashOverlay, completeOverlay, completeScoreMsg;
let noteFloatsContainer;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentSong() { return SONGS[songIndex]; }

function currentHint() {
  if (mode !== 'LEARN' || learnDone) return null;
  return currentSong().notes[learnStep] || null;
}

function updateLearnBar() {
  if (mode !== 'LEARN') {
    learnBar.classList.remove('visible');
    return;
  }
  learnBar.classList.add('visible');
  const song = currentSong();
  songTitleEl.textContent = song.title;

  if (learnDone) {
    nextNoteEl.textContent = '🎉 Complete!';
    progressEl.textContent = `${song.notes.length} / ${song.notes.length}`;
    progressBarFill.style.width = '100%';
  } else {
    nextNoteEl.textContent = `Next: ${song.notes[learnStep]}`;
    progressEl.textContent = `${learnStep} / ${song.notes.length}`;
    const pct = song.notes.length ? (learnStep / song.notes.length) * 100 : 0;
    progressBarFill.style.width = `${pct}%`;
  }
}

function updateScoreUI() {
  if (scoreValEl)  scoreValEl.textContent  = score;
  if (streakValEl) streakValEl.textContent = streak > 0 ? `${streak}🔥` : '0';
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
  hideCompleteOverlay();
  songSelect.value = String(songIndex);
  updateLearnBar();
  keyboard.setHint(currentHint());
}

function restartSong() {
  learnStep = 0;
  learnDone = false;
  score     = 0;
  streak    = 0;
  hideCompleteOverlay();
  updateLearnBar();
  updateScoreUI();
  keyboard.setHint(currentHint());
}

// ---------------------------------------------------------------------------
// Note triggering
// ---------------------------------------------------------------------------

function noteDown(note, source) {
  if (!soundEngine.isInitialized) soundEngine.init();
  soundEngine.resume();

  if (source === 'finger') fingerNotes.add(note);
  else                     pianoNotes.add(note);

  soundEngine.play(note);
  keyboard.setActive(new Set([...fingerNotes, ...pianoNotes]));
  keyboard.setHint(currentHint());

  // Spawn floating label
  spawnFloatNote(note);

  // LEARN mode: score on correct note
  if (mode === 'LEARN' && !learnDone) {
    if (note === currentHint()) {
      score  += 10 + streak;
      streak += 1;
      learnStep++;
      if (learnStep >= currentSong().notes.length) {
        learnDone = true;
        showCompleteOverlay();
        launchConfetti();
      }
      updateLearnBar();
      keyboard.setHint(currentHint());
      flashFeedback(true);
    } else {
      streak = 0;
      flashFeedback(false);
    }
    updateScoreUI();
  }

  // Setup analyser once audio is live
  if (soundEngine.analyser && !analyserData) {
    analyserData = new Uint8Array(soundEngine.analyser.frequencyBinCount);
  }
}

function noteUp(note, source) {
  if (source === 'finger') fingerNotes.delete(note);
  else                     pianoNotes.delete(note);

  if (!fingerNotes.has(note) && !pianoNotes.has(note)) {
    soundEngine.stop(note);
  }

  keyboard.setActive(new Set([...fingerNotes, ...pianoNotes]));
  keyboard.setHint(currentHint());
}

// ---------------------------------------------------------------------------
// Floating note labels
// ---------------------------------------------------------------------------

function spawnFloatNote(note) {
  if (!noteFloatsContainer) return;

  // Compute x from piano key geometry
  const frac      = keyboard.getKeyFractionX(note);
  const pianoRect = pianoCanvas.getBoundingClientRect();
  const camRect   = cameraCanvas.getBoundingClientRect();
  const x         = (pianoRect.left + frac * pianoRect.width) - camRect.left;

  const div       = document.createElement('div');
  div.className   = 'float-note';
  div.textContent = note;

  // Pick a colour from the finger palette
  const colorIdx  = Math.floor(Math.random() * FLOAT_COLORS.length);
  div.style.color = FLOAT_COLORS[colorIdx];
  div.style.left  = `${x - 16}px`;
  div.style.bottom = '18%';

  noteFloatsContainer.appendChild(div);
  setTimeout(() => div.remove(), 1200);
}

// ---------------------------------------------------------------------------
// Flash feedback (correct = green, wrong = red)
// ---------------------------------------------------------------------------

function flashFeedback(correct) {
  if (!flashOverlay) return;
  flashOverlay.style.background = correct
    ? 'rgba(80, 220, 120, 0.25)'
    : 'rgba(220, 60, 60, 0.22)';
  flashOverlay.style.opacity = '1';
  setTimeout(() => { flashOverlay.style.opacity = '0'; }, 180);
}

// ---------------------------------------------------------------------------
// Complete overlay
// ---------------------------------------------------------------------------

function showCompleteOverlay() {
  if (!completeOverlay) return;
  completeScoreMsg.textContent = `Score: ${score}  •  Best streak: ${streak}`;
  completeOverlay.classList.add('visible');
  confettiCanvas.style.display = 'block';
  confettiCanvas.width  = cameraCanvas.width;
  confettiCanvas.height = cameraCanvas.height;
}

function hideCompleteOverlay() {
  if (!completeOverlay) return;
  completeOverlay.classList.remove('visible');
  confettiCanvas.style.display = 'none';
  if (confettiCtx) confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

// ---------------------------------------------------------------------------
// Confetti
// ---------------------------------------------------------------------------

function launchConfetti() {
  confettiCanvas.width  = cameraCanvas.width;
  confettiCanvas.height = cameraCanvas.height;
  confettiCtx = confettiCanvas.getContext('2d');
  confettiCanvas.style.display = 'block';

  const COLORS = ['#ffd93d','#6bcb77','#4d96ff','#ff6b9d','#c77dff','#ff6b6b','#50b4ff'];
  const w = confettiCanvas.width;
  const h = confettiCanvas.height;

  const particles = Array.from({ length: 90 }, () => ({
    x:        Math.random() * w,
    y:        -20 - Math.random() * 80,
    vx:       (Math.random() - 0.5) * 5,
    vy:       Math.random() * 3.5 + 2,
    color:    COLORS[Math.floor(Math.random() * COLORS.length)],
    size:     Math.random() * 9 + 4,
    rot:      Math.random() * 360,
    rotSpeed: (Math.random() - 0.5) * 10,
    aspect:   0.45 + Math.random() * 0.3,
  }));

  let frame = 0;
  const MAX = 200;

  function step() {
    if (frame++ > MAX) {
      confettiCanvas.style.display = 'none';
      confettiCtx.clearRect(0, 0, w, h);
      return;
    }
    confettiCtx.clearRect(0, 0, w, h);
    const alpha = Math.max(0, 1 - frame / MAX);
    for (const p of particles) {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.12;
      p.rot += p.rotSpeed;
      confettiCtx.save();
      confettiCtx.globalAlpha = alpha;
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.rot * Math.PI / 180);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.size / 2, -p.size * p.aspect / 2, p.size, p.size * p.aspect);
      confettiCtx.restore();
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Camera overlay drawing
// ---------------------------------------------------------------------------

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

function drawCameraOverlay(results) {
  const w = cameraCanvas.width;
  const h = cameraCanvas.height;
  cameraCtx.clearRect(0, 0, w, h);

  // Mirrored video frame
  cameraCtx.save();
  cameraCtx.scale(-1, 1);
  cameraCtx.drawImage(videoEl, -w, 0, w, h);
  cameraCtx.restore();

  // Spectrum visualizer at top
  drawSpectrum(w, h);

  // Trigger zone — pulsing gradient line
  triggerPulse += 0.06;
  const zoneY     = TRIGGER_ZONE_Y * h;
  const pulseAlpha = 0.55 + 0.3 * Math.sin(triggerPulse);

  const zoneGrad = cameraCtx.createLinearGradient(0, 0, w, 0);
  zoneGrad.addColorStop(0,    `rgba(80,140,255,0)`);
  zoneGrad.addColorStop(0.2,  `rgba(80,180,255,${pulseAlpha})`);
  zoneGrad.addColorStop(0.5,  `rgba(160,100,255,${pulseAlpha})`);
  zoneGrad.addColorStop(0.8,  `rgba(80,180,255,${pulseAlpha})`);
  zoneGrad.addColorStop(1,    `rgba(80,140,255,0)`);

  cameraCtx.save();
  cameraCtx.setLineDash([14, 8]);
  cameraCtx.strokeStyle = zoneGrad;
  cameraCtx.lineWidth   = 2.5;
  cameraCtx.beginPath();
  cameraCtx.moveTo(0,  zoneY);
  cameraCtx.lineTo(w,  zoneY);
  cameraCtx.stroke();
  cameraCtx.setLineDash([]);

  // Label
  cameraCtx.fillStyle    = `rgba(140,180,255,${pulseAlpha})`;
  cameraCtx.font         = 'bold 12px Poppins, sans-serif';
  cameraCtx.textBaseline = 'bottom';
  cameraCtx.textAlign    = 'left';
  cameraCtx.fillText('✋ touch zone', 10, zoneY - 5);
  cameraCtx.restore();

  if (!results.multiHandLandmarks) return;

  for (const landmarks of results.multiHandLandmarks) {
    drawHandSkeleton(landmarks, w, h);
  }
}

function drawSpectrum(w, h) {
  if (!soundEngine.analyser || !analyserData) return;
  soundEngine.analyser.getByteFrequencyData(analyserData);

  const bars    = 28;
  const barW    = w / bars;
  const maxBarH = h * 0.12;

  cameraCtx.save();
  for (let i = 0; i < bars; i++) {
    const val    = analyserData[Math.floor(i * analyserData.length / bars)] / 255;
    const barH   = val * maxBarH;
    const hue    = 200 + i * 6;
    cameraCtx.fillStyle = `hsla(${hue}, 80%, 62%, ${0.55 + val * 0.45})`;
    cameraCtx.fillRect(i * barW + 1, maxBarH - barH, barW - 2, barH);
  }
  cameraCtx.restore();
}

function lmToCanvas(lm, w, h) {
  // Mirror x for front-camera flip
  return { x: (1 - lm.x) * w, y: lm.y * h };
}

function drawHandSkeleton(landmarks, w, h) {
  cameraCtx.save();

  // Connections — semi-transparent white lines
  cameraCtx.strokeStyle = 'rgba(255,255,255,0.45)';
  cameraCtx.lineWidth   = 2;
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = lmToCanvas(landmarks[a], w, h);
    const pb = lmToCanvas(landmarks[b], w, h);
    cameraCtx.beginPath();
    cameraCtx.moveTo(pa.x, pa.y);
    cameraCtx.lineTo(pb.x, pb.y);
    cameraCtx.stroke();
  }

  // Joints — small white dots
  for (let i = 0; i < landmarks.length; i++) {
    const isTip = FINGERTIP_IDS.includes(i);
    if (isTip) continue; // tips drawn separately below
    const p = lmToCanvas(landmarks[i], w, h);
    cameraCtx.beginPath();
    cameraCtx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    cameraCtx.fillStyle   = 'rgba(255,255,255,0.7)';
    cameraCtx.strokeStyle = 'rgba(0,0,0,0.5)';
    cameraCtx.lineWidth   = 0.8;
    cameraCtx.fill();
    cameraCtx.stroke();
  }

  // Fingertips — per-finger colour, larger circles with glow
  FINGERTIP_IDS.forEach((tipId, fingerIdx) => {
    const lm     = landmarks[tipId];
    const p      = lmToCanvas(lm, w, h);
    const color  = FINGER_COLORS[fingerIdx];
    const inZone = lm.y >= TRIGGER_ZONE_Y;

    cameraCtx.save();
    if (inZone) {
      cameraCtx.shadowBlur  = 18;
      cameraCtx.shadowColor = color;
    }
    cameraCtx.beginPath();
    cameraCtx.arc(p.x, p.y, inZone ? 9 : 6.5, 0, Math.PI * 2);
    cameraCtx.fillStyle   = color;
    cameraCtx.strokeStyle = '#fff';
    cameraCtx.lineWidth   = 1.5;
    cameraCtx.fill();
    cameraCtx.stroke();
    cameraCtx.restore();

    // Note label bubble near fingertip when in trigger zone
    if (inZone) {
      const mirroredX  = (1 - lm.x) * cameraCanvas.width;
      const note       = keyboard.noteAt(mirroredX, 0);
      if (note) {
        const bx = p.x;
        const by = p.y - 20;

        cameraCtx.save();
        cameraCtx.shadowBlur  = 10;
        cameraCtx.shadowColor = color;

        // Bubble background
        cameraCtx.font         = 'bold 13px Poppins, sans-serif';
        cameraCtx.textAlign    = 'center';
        cameraCtx.textBaseline = 'middle';
        const tw = cameraCtx.measureText(note).width;
        const bw = tw + 14;
        const bh = 20;

        cameraCtx.fillStyle = 'rgba(10,10,30,0.72)';
        _roundRect(cameraCtx, bx - bw / 2, by - bh / 2, bw, bh, 6);
        cameraCtx.fill();

        cameraCtx.strokeStyle = color;
        cameraCtx.lineWidth   = 1.2;
        _roundRect(cameraCtx, bx - bw / 2, by - bh / 2, bw, bh, 6);
        cameraCtx.stroke();

        cameraCtx.fillStyle = '#fff';
        cameraCtx.fillText(note, bx, by);
        cameraCtx.restore();
      }
    }
  });

  cameraCtx.restore();
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.closePath();
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
        const mirroredX = (1 - lm.x) * cw;
        const note      = keyboard.noteAt(mirroredX, 0);
        if (note) inZone.add(note);
      }
    }
  }

  return inZone;
}

// ---------------------------------------------------------------------------
// MediaPipe results handler
// ---------------------------------------------------------------------------

function onResults(results) {
  // FPS
  const now = performance.now();
  fps = Math.round(1000 / Math.max(1, now - lastFrameTime));
  lastFrameTime = now;
  fpsDisplay.textContent = `${fps} fps`;

  drawCameraOverlay(results);

  const currentZone = fingerNotesFromLandmarks(results);

  // Edge: newly pressed
  for (const note of currentZone) {
    if (!prevFingerZone.has(note)) noteDown(note, 'finger');
  }
  // Edge: newly released
  for (const note of prevFingerZone) {
    if (!currentZone.has(note)) noteUp(note, 'finger');
  }

  prevFingerZone = currentZone;
  keyboard.setHint(currentHint());
}

// ---------------------------------------------------------------------------
// Camera setup
// ---------------------------------------------------------------------------

async function startCamera() {
  const noCameraMsg = document.getElementById('no-camera-msg');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence:  0.5,
  });
  hands.onResults(onResults);

  const camera = new Camera(videoEl, {
    onFrame: async () => { await hands.send({ image: videoEl }); },
    width: 640, height: 480,
  });
  camera.start();
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function resizeCameraCanvas() {
  const s = cameraCanvas.parentElement;
  cameraCanvas.width  = s.clientWidth;
  cameraCanvas.height = s.clientHeight;
}

function resizePianoCanvas() {
  const s = pianoCanvas.parentElement;
  keyboard.resize(s.clientWidth, s.clientHeight);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'm': case 'M':
      soundEngine.init();
      soundEngine.resume();
      setMode(mode === 'PLAY' ? 'LEARN' : 'PLAY');
      break;
    case 'r': case 'R': restartSong(); break;
    case '1': case '2': case '3': case '4': case '5':
      selectSong(Number(e.key) - 1); break;
    case 'ArrowUp':   selectSong(songIndex - 1); break;
    case 'ArrowDown': selectSong(songIndex + 1); break;
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  // DOM refs
  videoEl           = document.getElementById('video');
  cameraCanvas      = document.getElementById('camera-canvas');
  cameraCtx         = cameraCanvas.getContext('2d');
  confettiCanvas    = document.getElementById('confetti-canvas');
  pianoCanvas       = document.getElementById('piano-canvas');
  modeBtn           = document.getElementById('mode-btn');
  songSelect        = document.getElementById('song-select');
  fpsDisplay        = document.getElementById('fps');
  learnBar          = document.getElementById('learn-bar');
  songTitleEl       = document.getElementById('song-title');
  nextNoteEl        = document.getElementById('next-note');
  progressEl        = document.getElementById('progress');
  progressBarFill   = document.getElementById('progress-bar-fill');
  scoreValEl        = document.getElementById('score-val');
  streakValEl       = document.getElementById('streak-val');
  flashOverlay      = document.getElementById('flash-overlay');
  completeOverlay   = document.getElementById('complete-overlay');
  completeScoreMsg  = document.getElementById('complete-score-msg');
  noteFloatsContainer = document.getElementById('note-floats');

  // Sound engine
  soundEngine = new SoundEngine();

  // Piano keyboard
  keyboard = new PianoKeyboard(pianoCanvas, {
    onNoteDown: (note) => {
      soundEngine.init();
      soundEngine.resume();
      noteDown(note, 'piano');
    },
    onNoteUp: (note) => noteUp(note, 'piano'),
  });

  // Song dropdown
  SONGS.forEach((song, i) => {
    const opt       = document.createElement('option');
    opt.value       = String(i);
    opt.textContent = `${i + 1}. ${song.title}`;
    songSelect.appendChild(opt);
  });
  songSelect.value = '0';
  songSelect.addEventListener('change', () => selectSong(Number(songSelect.value)));

  // Mode button
  modeBtn.addEventListener('click', () => {
    soundEngine.init();
    soundEngine.resume();
    setMode(mode === 'PLAY' ? 'LEARN' : 'PLAY');
  });

  // Restart button in complete overlay
  document.getElementById('restart-btn').addEventListener('click', () => {
    soundEngine.init();
    soundEngine.resume();
    restartSong();
  });

  // Unlock audio on first interaction
  const initAudio = () => {
    soundEngine.init();
    if (soundEngine.analyser && !analyserData) {
      analyserData = new Uint8Array(soundEngine.analyser.frequencyBinCount);
    }
  };
  document.addEventListener('touchstart', initAudio, { once: true });
  document.addEventListener('mousedown',  initAudio, { once: true });

  // Layout
  setMode('PLAY');
  updateScoreUI();
  resizeCameraCanvas();
  resizePianoCanvas();

  const ro = new ResizeObserver(() => {
    resizeCameraCanvas();
    resizePianoCanvas();
  });
  ro.observe(cameraCanvas.parentElement);
  ro.observe(pianoCanvas.parentElement);

  startCamera();
});
