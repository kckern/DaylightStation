/**
 * One plain sentence under a part's title saying why it gets the effect it gets, and whether a
 * refine would change that (owner, 2026-11-21: "a signal that it's skipping it because it's rough
 * and the refinement would clean that"). Pure: row in, { text, refine } out, where `refine` is
 * true when refining is the obvious next step for this part.
 */
const secs = (r) => Math.max(0, (Number(r?.out) || 0) - (Number(r?.in) || 0));
const fmt = (s) => (s >= 10 ? `${Math.round(s)} s` : `${(Math.round(s * 10) / 10).toFixed(1)} s`);

const EFFECT_WORDS = {
  mute: 'Muted', bleep: 'Bleeped', duck: 'Turned down', blur: 'Blurred where it is', 'full-blur': 'The whole picture is blurred',
  pixelate: 'Pixelated', 'censor-bar': 'Covered with a bar', blackout: 'The picture is hidden', skip: 'Skipped',
  'skip-card': 'Skipped behind a card',
};

export function whyLine(row) {
  if (!row) return { text: '', refine: false };
  const rough = row.timing === 'rough';
  const unsure = new Set(row.unsure || []);
  if (row.acts === false) {
    return row.why === 'removed'
      ? { text: 'Plays: you let this part play.', refine: false }
      : { text: 'Plays: your settings let this kind of part play. Press an effect key to filter it anyway.', refine: false };
  }
  if (unsure.has('exchange-by-length')) {
    return rough
      ? { text: `Rough timing makes this a ${fmt(secs(row))} part, too long to bleep, so it is skipped for now. Refine pins the word so it becomes a short bleep.`, refine: true }
      : { text: `This line runs ${fmt(secs(row))}, too long to bleep, so it is skipped behind a card.`, refine: false };
  }
  if (unsure.has('refine-giveup')) return { text: 'Refine could not find this word in the audio, so the rough time is kept. Check it by ear and nudge the edges.', refine: false };
  if (unsure.has('safe-window')) return { text: `Muted over a ${fmt(secs(row))} safe window that surely covers the word. Refine again or nudge the edges to narrow it.`, refine: true };
  if (unsure.has('untracked-visual')) return { text: 'The picture could not be tracked, so the effect covers the whole frame.', refine: rough };
  if (unsure.has('subject-unsure')) return { text: 'Not sure these tags are one thing on screen; check they all get the same effect.', refine: false };
  if (unsure.has('check-levels')) return { text: 'The scene\'s levels need a look: watch it and pick the effect.', refine: false };
  const base = `${EFFECT_WORDS[row.effect] || 'Filtered'} for ${fmt(secs(row))}.`;
  return rough
    ? { text: `${base} The timing is VidAngel's rough guess; refine to fit it to the film.`, refine: true }
    : { text: base, refine: false };
}

export default whyLine;
