/**
 * Every question the refiner asks the decision model, in one place.
 *
 * Each builder returns { state, questions, read } where `read(answers)` turns
 * the typed answers into the value the loop needs. Phrasing is versioned
 * (QUESTION_VERSION) and recorded in the decision log so calibration results
 * can be tied to the wording that produced them.
 */

import { image, yesNo, choice } from '#apps/common/ports/IDecisionGateway.mjs';

export const QUESTION_VERSION = 1;

/** Probability bands: >= yes, <= no, between = abstain (null). */
export const BANDS = Object.freeze({ yes: 0.65, no: 0.35 });
export function band(p) {
  if (p == null) return null;
  if (p >= BANDS.yes) return true;
  if (p <= BANDS.no) return false;
  return null;
}

/** Is this tag about something said, shown, or heard? (text only) */
export function routeQuestion(cue) {
  return {
    state: { tag: String(cue.label || '').trim(), category: cue.category },
    questions: {
      route: choice('A content tag from a family movie filter is described in `tag` (category `category`). What does the tag describe?', {
        said: 'Something a character says out loud (a word, a comment, a line of dialogue).',
        shown: 'Something seen on screen (an action, a sign, a picture, clothing, a body).',
        heard: 'A non-speech sound (gunfire, an explosion, a noise).',
      }),
    },
    read: (a) => ({ kind: { said: 'speech-line', shown: 'visual', heard: 'sound' }[a.route.choice], confidence: a.route.confidence }),
  };
}

/** Which transcript line holds the tagged word or remark? (text only) */
export function linePickQuestion(cue, lines) {
  const options = Object.fromEntries(lines.map((l, i) => [`L${i + 1}`, l.text]));
  options.none = 'None of these lines.';
  return {
    state: { tag: String(cue.label || '').trim() },
    questions: { line: choice('A filter tag `tag` marks a spoken word or remark. Which transcript line contains it?', options) },
    read: (a) => ({ index: a.line.choice === 'none' ? -1 : Number(a.line.choice.slice(1)) - 1, confidence: a.line.confidence }),
  };
}

/** One yes/no per frame tile: does it show the tagged content? */
export function tilesPresentQuestion(label, tiles) {
  const state = {}; const questions = {};
  tiles.forEach((t, i) => {
    state[`f${i}`] = image(t.png);
    questions[`p${i}`] = yesNo(`\`f${i}\` shows this: ${label}`);
  });
  return { state, questions, read: (a) => tiles.map((_, i) => ({ p: a[`p${i}`].probability, v: band(a[`p${i}`].probability) })) };
}

/** Does the content take up most of the picture? */
export function fillsFrameQuestion(label, png) {
  return {
    state: { frame: image(png) },
    questions: { fills: yesNo(`In \`frame\`, this takes up most of the picture (not just a small part of it): ${label}`) },
    read: (a) => ({ p: a.fills.probability, v: band(a.fills.probability) }),
  };
}

/** One yes/no per cell crop: is part of the content in it? */
export function cellsPresentQuestion(label, crops) {
  const state = {}; const questions = {};
  crops.forEach((c, i) => {
    state[`c${i}`] = image(c.png);
    questions[`p${i}`] = yesNo(`\`c${i}\` is a cropped part of a movie frame. It shows at least part of this: ${label}`);
  });
  return { state, questions, read: (a) => crops.map((c, i) => ({ cell: c.cell, p: a[`p${i}`].probability, v: band(a[`p${i}`].probability) })) };
}

/** Does the content extend past the drawn line? (bounding-box edge bisection) */
export function edgePastQuestion(label, png, side) {
  const where = { left: 'to the left of', right: 'to the right of', top: 'above', bottom: 'below' }[side];
  return {
    state: { frame: image(png) },
    questions: { past: yesNo(`In \`frame\`, part of this is ${where} the red line: ${label}`) },
    read: (a) => ({ p: a.past.probability, v: band(a.past.probability) }),
  };
}

/** Which lettered line marks where the word begins / ends? Moves: earlier, later. */
export function spectrogramPickQuestion({ png, letters, word, prev, next, edge }) {
  const what = edge === 'start' ? 'begins (its first sound starts)' : 'ends (its last sound stops)';
  const options = Object.fromEntries(letters.map((l) => [l, null]));
  return {
    state: { spec: image(png) },
    questions: {
      pick: choice(`\`spec\` is a spectrogram of speech (time runs left to right; bright = loud). The spoken words are "... ${prev} ${word} ${next} ...". The red vertical lines are lettered. Which line is closest to where the word "${word}" ${what}?`, options),
    },
    read: (a) => ({ letter: a.pick.choice, confidence: a.pick.confidence }),
  };
}

/** R6: do two shown tags describe the same thing on screen? (both labels + one frame from their overlap) */
export function sameSubjectQuestion(labelA, labelB, png) {
  return {
    state: { frame: image(png), a: String(labelA || '').trim(), b: String(labelB || '').trim() },
    questions: {
      same: yesNo('Two content tags from a family movie filter are described in `a` and `b`. In `frame`, do both tags describe the same single thing on screen (the same sign, billboard, object or action), not two different things?'),
    },
    read: (x) => ({ p: x.same.probability, v: band(x.same.probability) }),
  };
}
