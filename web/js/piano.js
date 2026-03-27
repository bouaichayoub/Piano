/**
 * piano.js — Glossy canvas piano keyboard (C4–B5).
 * Visual: gradient keys, glow on active/hint, press-inset animation, gloss sheen.
 */

class PianoKeyboard {
  constructor(canvas, { onNoteDown, onNoteUp }) {
    this.canvas     = canvas;
    this.ctx        = canvas.getContext('2d');
    this.onNoteDown = onNoteDown || (() => {});
    this.onNoteUp   = onNoteUp   || (() => {});

    this.WHITE_NOTES = [
      'C4','D4','E4','F4','G4','A4','B4',
      'C5','D5','E5','F5','G5','A5','B5',
    ];
    this.BLACK_NOTES = [
      'C#4','D#4', null,'F#4','G#4','A#4', null,
      'C#5','D#5', null,'F#5','G#5','A#5', null,
    ];

    this._keys      = [];
    this._active    = new Set();
    this._hint      = null;
    this._pointerMap = new Map();  // pointerId/mouse -> note
    this._grads     = {};          // cached gradients

    this._bindEvents();
  }

  // ── Geometry ─────────────────────────────────────────────────────────────

  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
    this._buildKeys(w, h);
    this._buildGradients(w, h);
    this.draw();
  }

  _buildKeys(w, h) {
    this._keys = [];
    const nWhite = this.WHITE_NOTES.length; // 14
    const ww     = w / nWhite;
    const bw     = ww * 0.58;
    const bh     = h * 0.60;

    this.WHITE_NOTES.forEach((note, i) => {
      this._keys.push({ note, isBlack: false, x: i * ww, y: 0, w: ww - 1, h });
    });

    const blackOffsets = [0.67, 1.67, null, 3.67, 4.67, 5.67, null];
    [0, 7].forEach((start) => {
      blackOffsets.forEach((off, i) => {
        if (off === null) return;
        const note = this.BLACK_NOTES[start + i];
        if (!note) return;
        this._keys.push({
          note, isBlack: true,
          x: (start + off) * ww - bw / 2,
          y: 0, w: bw, h: bh,
        });
      });
    });
  }

  _buildGradients(w, h) {
    const ctx = this.ctx;
    const g   = this._grads;

    // White key states
    const wn = ctx.createLinearGradient(0, 0, 0, h);
    wn.addColorStop(0,   '#fafaf5');
    wn.addColorStop(0.7, '#f0f0e6');
    wn.addColorStop(1,   '#ddddd2');
    g.whiteNormal = wn;

    const wa = ctx.createLinearGradient(0, 0, 0, h);
    wa.addColorStop(0,   '#b5e4ff');
    wa.addColorStop(0.4, '#50b4ff');
    wa.addColorStop(1,   '#2070cc');
    g.whiteActive = wa;

    const wh = ctx.createLinearGradient(0, 0, 0, h);
    wh.addColorStop(0,   '#b2f0c8');
    wh.addColorStop(0.4, '#5de08a');
    wh.addColorStop(1,   '#1e9040');
    g.whiteHint = wh;

    // Black key states
    const bn = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    bn.addColorStop(0,   '#2e2e2e');
    bn.addColorStop(0.6, '#181818');
    bn.addColorStop(1,   '#080808');
    g.blackNormal = bn;

    const ba = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    ba.addColorStop(0,   '#5aa8f0');
    ba.addColorStop(1,   '#1a50a0');
    g.blackActive = ba;

    const bh2 = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    bh2.addColorStop(0, '#3ec868');
    bh2.addColorStop(1, '#166030');
    g.blackHint = bh2;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  draw() {
    const ctx = this.ctx;
    const w   = this.canvas.width;
    const h   = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#111120');
    bg.addColorStop(1, '#070712');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // White keys first, then black on top
    this._keys.filter(k => !k.isBlack).forEach(k => this._drawKey(k));
    this._keys.filter(k =>  k.isBlack).forEach(k => this._drawKey(k));

    // Subtle octave divider (gold dashed)
    const midX = w / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(200,165,60,0.3)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawKey(k) {
    const ctx      = this.ctx;
    const isActive = this._active.has(k.note);
    const isHint   = this._hint === k.note;

    // Vertical press offset when active
    const pressY = isActive ? 3 : 0;
    const r      = k.isBlack ? 3 : 5;

    // Choose gradient fill
    let fill;
    if (k.isBlack) {
      fill = isActive ? this._grads.blackActive : (isHint ? this._grads.blackHint : this._grads.blackNormal);
    } else {
      fill = isActive ? this._grads.whiteActive : (isHint ? this._grads.whiteHint : this._grads.whiteNormal);
    }

    // Glow for active / hint
    ctx.save();
    if (isActive) {
      ctx.shadowBlur  = k.isBlack ? 18 : 26;
      ctx.shadowColor = '#50b4ff';
    } else if (isHint) {
      ctx.shadowBlur  = k.isBlack ? 18 : 26;
      ctx.shadowColor = '#5de08a';
    }

    // Key shape (rounded bottom)
    const x = k.x + 0.5;
    const y = k.y + pressY + 0.5;
    const kw = k.w - 1;
    const kh = k.h - pressY - 1;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + kw, y);
    ctx.lineTo(x + kw, y + kh - r);
    ctx.quadraticCurveTo(x + kw, y + kh, x + kw - r, y + kh);
    ctx.lineTo(x + r,  y + kh);
    ctx.quadraticCurveTo(x, y + kh, x, y + kh - r);
    ctx.closePath();

    ctx.fillStyle   = fill;
    ctx.fill();
    ctx.strokeStyle = k.isBlack ? 'rgba(0,0,0,0.9)' : 'rgba(160,160,148,0.55)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();

    // Gloss sheen — white keys
    if (!k.isBlack) {
      const sheen = ctx.createLinearGradient(k.x, pressY, k.x, k.h * 0.32);
      sheen.addColorStop(0, 'rgba(255,255,255,0.38)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(k.x + 1, pressY, k.w - 3, k.h * 0.32);
    }

    // Gloss sheen — black keys (left-edge highlight)
    if (k.isBlack && !isActive && !isHint) {
      const sheen = ctx.createLinearGradient(k.x, 0, k.x + k.w, 0);
      sheen.addColorStop(0,    'rgba(255,255,255,0.14)');
      sheen.addColorStop(0.35, 'rgba(255,255,255,0.04)');
      sheen.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(k.x + 1, 1, k.w - 2, k.h * 0.58);
    }

    // Note label on white keys
    if (!k.isBlack) {
      ctx.fillStyle    = isActive ? 'rgba(0,50,140,0.85)' : 'rgba(110,110,110,0.65)';
      const fs         = Math.min(11, k.w * 0.42);
      ctx.font         = `600 ${fs}px Poppins, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(k.note, k.x + k.w / 2, k.y + k.h - 5);
    }
  }

  // ── Hit testing ───────────────────────────────────────────────────────────

  noteAt(px, py) {
    for (const k of this._keys) {
      if (!k.isBlack) continue;
      if (px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h) return k.note;
    }
    for (const k of this._keys) {
      if (k.isBlack) continue;
      if (px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h) return k.note;
    }
    return null;
  }

  /** Fractional x center (0–1) for a note, used by floating label spawner. */
  getKeyFractionX(note) {
    const k = this._keys.find(k => k.note === note);
    if (!k || !this.canvas.width) return 0.5;
    return (k.x + k.w / 2) / this.canvas.width;
  }

  // ── State setters ─────────────────────────────────────────────────────────

  setActive(noteSet) { this._active = new Set(noteSet); this.draw(); }
  setHint(note)      { this._hint   = note || null;     this.draw(); }

  // ── Events ────────────────────────────────────────────────────────────────

  _bindEvents() {
    const cv = this.canvas;

    cv.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const { x, y } = this._canvasXY(e);
      const note = this.noteAt(x, y);
      if (note) { this._pointerMap.set('mouse', note); this.onNoteDown(note); }
    });

    cv.addEventListener('mousemove', (e) => {
      if (!(e.buttons & 1)) return;
      const { x, y } = this._canvasXY(e);
      const note = this.noteAt(x, y);
      const prev = this._pointerMap.get('mouse');
      if (prev !== note) {
        if (prev) this.onNoteUp(prev);
        if (note) { this._pointerMap.set('mouse', note); this.onNoteDown(note); }
        else this._pointerMap.delete('mouse');
      }
    });

    cv.addEventListener('mouseup', (e) => {
      const prev = this._pointerMap.get('mouse');
      if (prev) this.onNoteUp(prev);
      this._pointerMap.delete('mouse');
    });

    cv.addEventListener('mouseleave', () => {
      const prev = this._pointerMap.get('mouse');
      if (prev) this.onNoteUp(prev);
      this._pointerMap.delete('mouse');
    });

    cv.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const { x, y } = this._touchXY(t);
        const note = this.noteAt(x, y);
        if (note) { this._pointerMap.set(t.identifier, note); this.onNoteDown(note); }
      }
    }, { passive: false });

    cv.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const { x, y } = this._touchXY(t);
        const note = this.noteAt(x, y);
        const prev = this._pointerMap.get(t.identifier);
        if (prev !== note) {
          if (prev) this.onNoteUp(prev);
          if (note) { this._pointerMap.set(t.identifier, note); this.onNoteDown(note); }
          else this._pointerMap.delete(t.identifier);
        }
      }
    }, { passive: false });

    cv.addEventListener('touchend', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const prev = this._pointerMap.get(t.identifier);
        if (prev) this.onNoteUp(prev);
        this._pointerMap.delete(t.identifier);
      }
    }, { passive: false });

    cv.addEventListener('touchcancel', (e) => {
      for (const t of e.changedTouches) {
        const prev = this._pointerMap.get(t.identifier);
        if (prev) this.onNoteUp(prev);
        this._pointerMap.delete(t.identifier);
      }
    }, { passive: false });
  }

  _canvasXY(e) {
    const r  = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width  / r.width;
    const sy = this.canvas.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  _touchXY(t) {
    const r  = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width  / r.width;
    const sy = this.canvas.height / r.height;
    return { x: (t.clientX - r.left) * sx, y: (t.clientY - r.top) * sy };
  }
}
