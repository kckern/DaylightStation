// How much of a segmented clue is showing on each step. Pure: the component
// asks for a frame by step number and writes it to the DOM.
//
// A HIDDEN CHARACTER IS NOT A BLANK CELL. Its cell stays fully lit in mask
// colors, so the clue's length and word gaps never show; only the letter's own
// warm segments switch on and off. The typing cursor is the cell's two bottom
// segments, lit warm, so it too shows only through the red card.

export const REVEAL_MODES = Object.freeze(['progressive', 'marquee', 'static']);
export const CURSOR_SEGMENTS = Object.freeze(['d1', 'd2']);

// Every key a game's rules file may set under `decoder:`, with its default.
// These are the ONLY defaults: the ruleset passes the block through as authored.
export const DECODER_DEFAULTS = Object.freeze({
  // The marquee by default: every character keeps changing cell as well as
  // color, so there is no fixed position to stare at.
  reveal: 'marquee',
  // One reveal/scroll step and one color shuffle. In static mode the colors
  // shuffle with the position jump instead, once per `motionMs`.
  stepMs: 100,
  motion: true,
  // Reassign colors within the signal/mask families on each decoder step.
  colorAnimation: true,
  // Equal to the step, so the card jumps on every scroll step, in sync.
  motionMs: 100,
  // Marquee: steps held fully visible, then steps of empty gap before the text
  // comes round again. Ten steps at 100ms is a one-second hold; four glyphs of gap.
  marqueeHoldSteps: 10,
  marqueeGapSteps: 4,
});

const positive = value => Number.isFinite(value) && value > 0;
const count = value => Number.isInteger(value) && value >= 0;

/** A `decoder:` block (snake_case from YAML, or camelCase) with defaults filled in. */
export function decoderSettings(raw = null) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pick = (snake, camel) => source[snake] ?? source[camel];
  const reveal = REVEAL_MODES.includes(source.reveal) ? source.reveal : DECODER_DEFAULTS.reveal;
  const motionMs = positive(pick('motion_ms', 'motionMs')) ? pick('motion_ms', 'motionMs') : DECODER_DEFAULTS.motionMs;
  const authoredStep = pick('step_ms', 'stepMs');
  return {
    reveal,
    stepMs: reveal === 'static' ? motionMs : (positive(authoredStep) ? authoredStep : DECODER_DEFAULTS.stepMs),
    motion: typeof source.motion === 'boolean' ? source.motion : DECODER_DEFAULTS.motion,
    colorAnimation: typeof pick('color_animation', 'colorAnimation') === 'boolean'
      ? pick('color_animation', 'colorAnimation') : DECODER_DEFAULTS.colorAnimation,
    motionMs,
    marqueeHoldSteps: count(pick('marquee_hold_steps', 'marqueeHoldSteps'))
      ? pick('marquee_hold_steps', 'marqueeHoldSteps') : DECODER_DEFAULTS.marqueeHoldSteps,
    marqueeGapSteps: count(pick('marquee_gap_steps', 'marqueeGapSteps'))
      ? pick('marquee_gap_steps', 'marqueeGapSteps') : DECODER_DEFAULTS.marqueeGapSteps,
  };
}

/** Steps in one full loop of the mode. */
export function revealCycleLength(lines, settings) {
  const lengths = lines.map(line => [...line].length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (settings.reveal === 'progressive') return 2 * total + 1;
  if (settings.reveal === 'marquee') {
    const longest = Math.max(0, ...lengths);
    return 2 * longest + settings.marqueeHoldSteps + settings.marqueeGapSteps + 1;
  }
  return 1;
}

/**
 * The frame for `step`: one array per line, one cell per character, each
 * `{ char, cursor }` where `char` is the character showing in that cell or
 * null when the cell shows no letter.
 *
 * progressive — a typewriter loop over the clue in reading order: step s shows
 *   the first s characters with the cursor on the next cell; once all are
 *   shown they hide first-to-last at the same pace; then it starts again.
 * marquee — each line scrolls right to left through its own cells: in from
 *   the right, held fully visible, out to the left, then an empty gap. Lines
 *   share one schedule sized to the longest.
 * static — everything showing, always.
 */
export function revealFrame(lines, step, settings) {
  const chars = lines.map(line => [...line]);
  const cycle = revealCycleLength(lines, settings);
  const s = ((step % cycle) + cycle) % cycle;

  if (settings.reveal === 'progressive') {
    const total = chars.reduce((sum, line) => sum + line.length, 0);
    let position = 0;
    return chars.map(line => line.map((char) => {
      const index = position;
      position += 1;
      if (s <= total) return { char: index < s ? char : null, cursor: index === s };
      const hidden = s - total;
      return { char: index >= hidden ? char : null, cursor: false };
    }));
  }

  if (settings.reveal === 'marquee') {
    const longest = Math.max(0, ...chars.map(line => line.length));
    const hold = settings.marqueeHoldSteps;
    return chars.map((line) => {
      const length = line.length;
      let shift;
      if (s <= longest) shift = length - Math.min(s, length);
      else if (s <= longest + hold) shift = 0;
      else if (s <= 2 * longest + hold) shift = -Math.min(s - longest - hold, length);
      else shift = -length;
      return line.map((_, cell) => {
        const index = cell - shift;
        return { char: index >= 0 && index < length ? line[index] : null, cursor: false };
      });
    });
  }

  return chars.map(line => line.map(char => ({ char, cursor: false })));
}
