// vexflowRender — draws a Score (from parseMusicXml) as an engraved grand staff
// into a host element via VexFlow, and returns the on-screen position of every
// melody (treble) note so the cursor / play-along overlay can light it up.
//
// This is the ONLY file that imports VexFlow. Layout is measure-based: each
// measure is a treble+bass stave pair, flowing left-to-right and wrapping to new
// systems — which gives clean barlines and a natural substrate for the future
// scroll/page-turn viewport.
import { Renderer, Stave, StaveNote, Voice, Formatter, StaveConnector, Accidental, Dot } from 'vexflow';

const TYPE_DUR = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32', '64th': '64' };
const STEP_ALTER_GLYPH = { 1: '#', 2: '##', '-1': 'b', '-2': 'bb' };

const keyOf = (n) => `${n.pitch.step.toLowerCase()}/${n.pitch.octave}`;
const durOf = (n) => (TYPE_DUR[n.type] || 'q') + (n.rest ? 'r' : '');

/** Build VexFlow StaveNotes for one staff of one measure (grouping chords). */
function buildStaveNotes(notes, clef, beats) {
  const out = [];
  let cur = null; // current StaveNote being assembled (for chords)
  let curKeys = null;
  let curAlters = null;
  for (const n of notes) {
    if (n.chord && cur && !n.rest) { curKeys.push(keyOf(n)); curAlters.push(n.pitch.alter); continue; }
    if (cur) finalize(out, cur, curKeys, curAlters);
    curKeys = n.rest ? ['b/4'] : [keyOf(n)];
    curAlters = n.rest ? [0] : [n.pitch.alter];
    cur = new StaveNote({ keys: curKeys, duration: durOf(n), clef });
    for (let d = 0; d < (n.dots || 0); d++) cur._dots = (cur._dots || 0) + 1;
  }
  if (cur) finalize(out, cur, curKeys, curAlters);
  return out;
}
function finalize(out, note, keys, alters) {
  alters.forEach((a, i) => { const g = STEP_ALTER_GLYPH[a]; if (g) note.addModifier(new Accidental(g), i); });
  for (let d = 0; d < (note._dots || 0); d++) Dot.buildAndAttach([note], { all: true });
  out.push(note);
}

/**
 * Draw the score and return melody-note positions.
 * @param {HTMLElement} host - element to render into (cleared first)
 * @param {object} score - from parseMusicXml
 * @param {{ width?:number, measuresPerLine?:number }} [opts]
 * @returns {{ width:number, height:number, events: Array<{midi:number,onsetQuarter:number,x:number,top:number,bottom:number,system:number}> }}
 */
export function vexflowRender(host, score, opts = {}) {
  host.innerHTML = '';
  const part = score.parts[0];
  if (!part) return { width: 0, height: 0, events: [] };

  const width = opts.width || 1000;
  const PAD = 12;
  const MEAS_W = 240;            // nominal measure width
  const FIRST_EXTRA = 90;        // extra width on a line's first measure (clef/key/time)
  const STAFF_GAP = 110;         // treble→bass vertical gap
  const SYSTEM_H = STAFF_GAP + 90;
  const usable = width - PAD * 2;
  const perLine = Math.max(1, opts.measuresPerLine || Math.floor((usable - FIRST_EXTRA) / MEAS_W) || 1);

  const measures = part.measures;
  const lines = Math.ceil(measures.length / perLine);
  const height = PAD * 2 + lines * SYSTEM_H + 30;

  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();

  const trebleClefName = (part.clefs[1]?.sign === 'F') ? 'bass' : 'treble';
  const bassClefName = (part.clefs[2]?.sign === 'G') ? 'treble' : 'bass';
  const events = [];

  for (let m = 0; m < measures.length; m++) {
    const line = Math.floor(m / perLine);
    const col = m % perLine;
    const isFirst = col === 0;
    const yTop = PAD + line * SYSTEM_H;

    // Compute x for this measure on its line.
    const lineCount = Math.min(perLine, measures.length - line * perLine);
    const firstW = FIRST_EXTRA + (usable - FIRST_EXTRA) / lineCount;
    const restW = (usable - FIRST_EXTRA) / lineCount;
    let x = PAD;
    for (let c = 0; c < col; c++) x += (c === 0 ? firstW : restW);
    const w = isFirst ? firstW : restW;

    try {
      const treble = new Stave(x, yTop, w);
      const bass = new Stave(x, yTop + STAFF_GAP, w);
      if (isFirst) {
        treble.addClef(trebleClefName); bass.addClef(bassClefName);
        if (line === 0 && m === 0) {
          treble.addTimeSignature(`${score.timeSig.beats}/${score.timeSig.beatType}`);
          bass.addTimeSignature(`${score.timeSig.beats}/${score.timeSig.beatType}`);
        }
      }
      treble.setContext(ctx).draw();
      bass.setContext(ctx).draw();
      if (isFirst) {
        new StaveConnector(treble, bass).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
        new StaveConnector(treble, bass).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
      }
      new StaveConnector(treble, bass).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();

      const mn = measures[m].notes;
      const trebleSrc = mn.filter((n) => n.staff === 1);
      const bassSrc = mn.filter((n) => n.staff === 2);
      const beats = score.timeSig.beats;
      const mkVoice = (vnotes) => {
        const v = new Voice({ num_beats: beats, beat_value: score.timeSig.beatType });
        v.setStrict(false); v.addTickables(vnotes); return v;
      };
      const tNotes = buildStaveNotes(trebleSrc, trebleClefName, beats);
      const bNotes = buildStaveNotes(bassSrc, bassClefName, beats);
      const voices = [];
      if (tNotes.length) voices.push(mkVoice(tNotes));
      if (bNotes.length) voices.push(mkVoice(bNotes));
      if (voices.length) {
        new Formatter().joinVoices(voices).format(voices, w - (isFirst ? FIRST_EXTRA : 24));
        if (tNotes.length) voices[0].draw(ctx, treble);
        if (bNotes.length) voices[voices.length === 2 ? 1 : 0].draw(ctx, bass);
      }

      // Record melody (treble, non-rest) note positions for the cursor/overlay.
      const trebleMelody = trebleSrc.filter((n) => !n.rest && !n.chord);
      let ti = 0;
      for (const vn of tNotes) {
        if (vn.isRest && vn.isRest()) continue;
        const model = trebleMelody[ti++];
        if (!model || model.rest) continue;
        let nx = x + w / 2;
        try { nx = vn.getAbsoluteX(); } catch { /* not drawn */ }
        events.push({
          midi: model.midi,
          onsetQuarter: model.onsetQuarter,
          x: nx,
          top: yTop,
          bottom: yTop + STAFF_GAP + 80,
          system: line,
        });
      }
    } catch (err) {
      // One bad measure shouldn't blank the score.
      // eslint-disable-next-line no-console
      console.warn('vexflowRender: measure skipped', m, err?.message);
    }
  }

  events.sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  return { width, height, events };
}

export default vexflowRender;
