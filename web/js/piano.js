/**
 * piano.js
 * --------
 * Canvas-based piano keyboard spanning C4–B5.
 * Handles touch/mouse input and visual states (active, hover, hint).
 */

class PianoKeyboard {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onNoteDown: (note:string)=>void, onNoteUp: (note:string)=>void }} callbacks
   */
  constructor(canvas, { onNoteDown, onNoteUp }) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.onNoteDown = onNoteDown || (() => {});
    this.onNoteUp   = onNoteUp   || (() => {});

    // Two octaves: C4-B4, C5-B5
    this.WHITE_NOTES = [
      'C4','D4','E4','F4','G4','A4','B4',
      'C5','D5','E5','F5','G5','A5','B5',
    ];
    this.BLACK_NOTES = [
      'C#4','D#4', null,'F#4','G#4','A#4', null,
      'C#5','D#5', null,'F#5','G#5','A#5', null,
    ];

    this._keys = [];       // computed geometry
    this._active = new Set();
    this._hover  = new Set();
    this._hint   = null;

    // Track pointer ids -> note for multi-touch on piano
    this._pointerMap = new Map();

    this._bindEvents();
  }

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------

  /** Recompute key layout and redraw. Call when canvas size changes. */
  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
    this._buildKeys(w, h);
    this.draw();
  }

  _buildKeys(w, h) {
    this._keys = [];
    const nWhite = this.WHITE_NOTES.length; // 14
    const ww = w / nWhite;
    const wh = h;
    const bw = ww * 0.58;
    const bh = h * 0.60;

    // White keys
    this.WHITE_NOTES.forEach((note, i) => {
      this._keys.push({
        note,
        isBlack: false,
        x: i * ww,
        y: 0,
        w: ww - 1,   // 1px gap
        h: wh,
      });
    });

    // Black key offsets within each octave (index into white keys)
    // C# is between C(0) and D(1), so offset = 0 + 0.67
    const blackOffsets = [0.67, 1.67, null, 3.67, 4.67, 5.67, null];

    [0, 7].forEach((octaveStart) => {
      blackOffsets.forEach((off, i) => {
        if (off === null) return;
        const note = this.BLACK_NOTES[octaveStart + i];
        if (!note) return;
        const x = (octaveStart + off) * ww - bw / 2;
        this._keys.push({
          note,
          isBlack: true,
          x,
          y: 0,
          w: bw,
          h: bh,
        });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  draw() {
    const ctx  = this.ctx;
    const w    = this.canvas.width;
    const h    = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Draw white keys first
    this._keys.filter(k => !k.isBlack).forEach(k => this._drawKey(k));
    // Then black keys on top
    this._keys.filter(k =>  k.isBlack).forEach(k => this._drawKey(k));
  }

  _drawKey(k) {
    const ctx = this.ctx;
    const isActive = this._active.has(k.note);
    const isHint   = this._hint === k.note;

    let fill;
    if (k.isBlack) {
      if (isActive)     fill = '#2882dc';
      else if (isHint)  fill = '#1ea040';
      else              fill = '#1e1e1e';
    } else {
      if (isActive)     fill = '#50b4ff';
      else if (isHint)  fill = '#5de08a';
      else              fill = '#f5f5eb';
    }

    // Key body
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (!k.isBlack) {
      // Rounded bottom corners for white keys
      const r = 5;
      ctx.moveTo(k.x, k.y);
      ctx.lineTo(k.x + k.w, k.y);
      ctx.lineTo(k.x + k.w, k.y + k.h - r);
      ctx.quadraticCurveTo(k.x + k.w, k.y + k.h, k.x + k.w - r, k.y + k.h);
      ctx.lineTo(k.x + r, k.y + k.h);
      ctx.quadraticCurveTo(k.x, k.y + k.h, k.x, k.y + k.h - r);
      ctx.closePath();
    } else {
      const r = 3;
      ctx.moveTo(k.x, k.y);
      ctx.lineTo(k.x + k.w, k.y);
      ctx.lineTo(k.x + k.w, k.y + k.h - r);
      ctx.quadraticCurveTo(k.x + k.w, k.y + k.h, k.x + k.w - r, k.y + k.h);
      ctx.lineTo(k.x + r, k.y + k.h);
      ctx.quadraticCurveTo(k.x, k.y + k.h, k.x, k.y + k.h - r);
      ctx.closePath();
    }
    ctx.fill();

    // Border
    ctx.strokeStyle = k.isBlack ? '#000' : '#999';
    ctx.lineWidth = k.isBlack ? 1 : 1;
    ctx.stroke();

    // Note label on white keys
    if (!k.isBlack) {
      ctx.fillStyle = isActive ? '#003' : '#888';
      ctx.font = `bold ${Math.min(11, k.w * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(k.note, k.x + k.w / 2, k.y + k.h - 4);
    }
  }

  // -------------------------------------------------------------------------
  // Hit testing
  // -------------------------------------------------------------------------

  /**
   * Returns the note at canvas coordinates (px, py), or null.
   * Black keys take priority (drawn on top).
   */
  noteAt(px, py) {
    // Check black keys first
    for (const k of this._keys) {
      if (!k.isBlack) continue;
      if (px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h) {
        return k.note;
      }
    }
    // Then white keys
    for (const k of this._keys) {
      if (k.isBlack) continue;
      if (px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h) {
        return k.note;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Visual state setters
  // -------------------------------------------------------------------------

  setActive(noteSet) {
    this._active = new Set(noteSet);
    this.draw();
  }

  setHover(noteSet) {
    this._hover = new Set(noteSet);
    this.draw();
  }

  setHint(note) {
    this._hint = note || null;
    this.draw();
  }

  // -------------------------------------------------------------------------
  // Input events
  // -------------------------------------------------------------------------

  _bindEvents() {
    const canvas = this.canvas;

    // Mouse events
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const { x, y } = this._canvasXY(e);
      const note = this.noteAt(x, y);
      if (note) {
        this._pointerMap.set('mouse', note);
        this.onNoteDown(note);
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const { x, y } = this._canvasXY(e);
      const note = this.noteAt(x, y);
      this._hover = note ? new Set([note]) : new Set();
      // If mouse is held, slide notes
      if (e.buttons & 1) {
        const prev = this._pointerMap.get('mouse');
        if (prev !== note) {
          if (prev) this.onNoteUp(prev);
          if (note) this.onNoteDown(note);
          this._pointerMap.set('mouse', note || undefined);
        }
      }
      this.draw();
    });

    canvas.addEventListener('mouseup', (e) => {
      e.preventDefault();
      const prev = this._pointerMap.get('mouse');
      if (prev) this.onNoteUp(prev);
      this._pointerMap.delete('mouse');
    });

    canvas.addEventListener('mouseleave', () => {
      const prev = this._pointerMap.get('mouse');
      if (prev) this.onNoteUp(prev);
      this._pointerMap.delete('mouse');
      this._hover = new Set();
      this.draw();
    });

    // Touch events
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const { x, y } = this._touchXY(t);
        const note = this.noteAt(x, y);
        if (note) {
          this._pointerMap.set(t.identifier, note);
          this.onNoteDown(note);
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const { x, y } = this._touchXY(t);
        const note = this.noteAt(x, y);
        const prev = this._pointerMap.get(t.identifier);
        if (prev !== note) {
          if (prev) this.onNoteUp(prev);
          if (note) {
            this._pointerMap.set(t.identifier, note);
            this.onNoteDown(note);
          } else {
            this._pointerMap.delete(t.identifier);
          }
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const prev = this._pointerMap.get(t.identifier);
        if (prev) this.onNoteUp(prev);
        this._pointerMap.delete(t.identifier);
      }
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
      for (const t of e.changedTouches) {
        const prev = this._pointerMap.get(t.identifier);
        if (prev) this.onNoteUp(prev);
        this._pointerMap.delete(t.identifier);
      }
    }, { passive: false });
  }

  _canvasXY(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  _touchXY(touch) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (touch.clientX - rect.left) * scaleX,
      y: (touch.clientY - rect.top)  * scaleY,
    };
  }
}
