// vexflowRender — draws a Score (from parseMusicXml) as an engraved grand staff
// into a host element via VexFlow, and returns the on-screen position of every
// melody (treble) note so the cursor / play-along overlay can light it up.
//
// This is the ONLY file that imports VexFlow. Layout is measure-based (one
// treble+bass stave pair per measure → clean barlines). Two flows:
//   'wrapped'    — measures wrap to systems across the container width (scroll ↓)
//   'horizontal' — all measures in one long row (infinite scroll →)
import { Renderer, Stave, StaveNote, Voice, Formatter, StaveConnector, Accidental, Dot, Barline } from 'vexflow';

const TYPE_DUR = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32', '64th': '64' };
const STEP_ALTER_GLYPH = { 1: '#', 2: '##', '-1': 'b', '-2': 'bb' };

const keyOf = (n) => `${n.pitch.step.toLowerCase()}/${n.pitch.octave}`;
const durOf = (n) => (TYPE_DUR[n.type] || 'q') + (n.rest ? 'r' : '');

const PAD = 12, MEAS_W = 240, FIRST_EXTRA = 90, STAFF_GAP = 110, SYSTEM_H = STAFF_GAP + 90;

function buildStaveNotes(notes, clef) {
  const out = [];
  let cur = null, curKeys = null, curAlters = null;
  for (const n of notes) {
    if (n.chord && cur && !n.rest) { curKeys.push(keyOf(n)); curAlters.push(n.pitch.alter); continue; }
    if (cur) finalize(out, cur, curKeys, curAlters);
    curKeys = n.rest ? ['b/4'] : [keyOf(n)];
    curAlters = n.rest ? [0] : [n.pitch.alter];
    cur = new StaveNote({ keys: curKeys, duration: durOf(n), clef });
    cur._dots = n.dots || 0;
  }
  if (cur) finalize(out, cur, curKeys, curAlters);
  return out;
}
function finalize(out, note, keys, alters) {
  alters.forEach((a, i) => { const g = STEP_ALTER_GLYPH[a]; if (g) note.addModifier(new Accidental(g), i); });
  for (let d = 0; d < (note._dots || 0); d++) Dot.buildAndAttach([note], { all: true });
  out.push(note);
}

/** Precompute per-measure boxes {x,y,w,line,isFirst} for the chosen flow. */
function planLayout(count, flow, containerW) {
  const boxes = [];
  if (flow === 'horizontal') {
    let x = PAD;
    for (let m = 0; m < count; m++) {
      const isFirst = m === 0;
      const w = isFirst ? FIRST_EXTRA + MEAS_W : MEAS_W;
      boxes.push({ x, y: PAD, w, line: 0, isFirst });
      x += w;
    }
    return { boxes, svgWidth: x + PAD, lines: 1 };
  }
  const usable = containerW - PAD * 2;
  // Balance lines: use the fewest lines that fit, then split measures evenly
  // across them (8 measures in a 6-wide container → 4+4, not 6+2).
  const maxPerLine = Math.max(1, Math.floor((usable - FIRST_EXTRA) / MEAS_W) || 1);
  const lines = Math.max(1, Math.ceil(count / maxPerLine));
  const perLine = Math.ceil(count / lines);
  for (let m = 0; m < count; m++) {
    const line = Math.floor(m / perLine);
    const col = m % perLine;
    const lineCount = Math.min(perLine, count - line * perLine);
    const firstW = FIRST_EXTRA + (usable - FIRST_EXTRA) / lineCount;
    const restW = (usable - FIRST_EXTRA) / lineCount;
    let x = PAD;
    for (let c = 0; c < col; c++) x += (c === 0 ? firstW : restW);
    boxes.push({ x, y: PAD + line * SYSTEM_H, w: col === 0 ? firstW : restW, line, isFirst: col === 0 });
  }
  return { boxes, svgWidth: containerW, lines };
}

/**
 * @param {HTMLElement} host
 * @param {object} score
 * @param {{ width?:number, flow?:'wrapped'|'horizontal' }} [opts]
 * @returns {{ width:number, height:number, flow:string, events:Array }}
 */
export function vexflowRender(host, score, opts = {}) {
  host.innerHTML = '';
  const part = score.parts[0];
  if (!part) return { width: 0, height: 0, flow: 'wrapped', events: [] };

  const flow = opts.flow === 'horizontal' ? 'horizontal' : 'wrapped';
  const scale = Math.max(0.5, Math.min(2.5, opts.scale || 1));
  // For 'wrapped', the container width is in screen px; lay out in logical units.
  const logicalW = (opts.width || 1000) / scale;
  const { boxes, svgWidth, lines } = planLayout(part.measures.length, flow, logicalW);
  const height = PAD * 2 + lines * SYSTEM_H + 30;

  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(Math.round(svgWidth * scale), Math.round(height * scale));
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);

  const trebleClef = part.clefs[1]?.sign === 'F' ? 'bass' : 'treble';
  const bassClef = part.clefs[2]?.sign === 'G' ? 'treble' : 'bass';
  const timeSig = `${score.timeSig.beats}/${score.timeSig.beatType}`;
  const events = [];

  for (let m = 0; m < part.measures.length; m++) {
    const box = boxes[m];
    const isLast = m === part.measures.length - 1;
    try {
      const treble = new Stave(box.x, box.y, box.w);
      const bass = new Stave(box.x, box.y + STAFF_GAP, box.w);
      if (box.isFirst) {
        treble.addClef(trebleClef); bass.addClef(bassClef);
        if (m === 0) { treble.addTimeSignature(timeSig); bass.addTimeSignature(timeSig); }
      }
      // Standard practice: the final measure ends with a final (thin + thick) barline.
      if (isLast) { treble.setEndBarType(Barline.type.END); bass.setEndBarType(Barline.type.END); }
      treble.setContext(ctx).draw();
      bass.setContext(ctx).draw();
      if (box.isFirst) {
        new StaveConnector(treble, bass).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
        new StaveConnector(treble, bass).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
      }
      new StaveConnector(treble, bass)
        .setType(isLast ? StaveConnector.type.BOLD_DOUBLE_RIGHT : StaveConnector.type.SINGLE_RIGHT)
        .setContext(ctx).draw();

      const mn = part.measures[m].notes;
      const trebleSrc = mn.filter((n) => n.staff === 1);
      const bassSrc = mn.filter((n) => n.staff === 2);
      const mkVoice = (vnotes) => {
        const v = new Voice({ num_beats: score.timeSig.beats, beat_value: score.timeSig.beatType });
        v.setStrict(false); v.addTickables(vnotes); return v;
      };
      const tNotes = buildStaveNotes(trebleSrc, trebleClef);
      const bNotes = buildStaveNotes(bassSrc, bassClef);
      const voices = [];
      if (tNotes.length) voices.push(mkVoice(tNotes));
      if (bNotes.length) voices.push(mkVoice(bNotes));
      if (voices.length) {
        new Formatter().joinVoices(voices).format(voices, box.w - (box.isFirst ? FIRST_EXTRA : 24));
        if (tNotes.length) voices[0].draw(ctx, treble);
        if (bNotes.length) voices[voices.length === 2 ? 1 : 0].draw(ctx, bass);
      }

      const trebleMelody = trebleSrc.filter((n) => !n.rest && !n.chord);
      let ti = 0;
      for (const vn of tNotes) {
        if (vn.isRest && vn.isRest()) continue;
        const model = trebleMelody[ti++];
        if (!model) continue;
        let nx = box.x + box.w / 2;
        try { nx = vn.getAbsoluteX(); } catch { /* not drawn */ }
        // Positions are logical; the overlay lives in screen px, so scale them.
        events.push({
          midi: model.midi, onsetQuarter: model.onsetQuarter,
          x: nx * scale, top: box.y * scale, bottom: (box.y + STAFF_GAP + 80) * scale, system: box.line,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('vexflowRender: measure skipped', m, err?.message);
    }
  }

  events.sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  return { width: svgWidth, height, flow, events };
}

export default vexflowRender;
