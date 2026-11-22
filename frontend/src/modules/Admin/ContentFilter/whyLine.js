import { triedRefine } from './reviewScope.js';

/**
 * One plain sentence under a part's title saying why it gets the effect it gets, and whether a
 * refine would change that (owner, 2026-11-21: "a signal that it's skipping it because it's rough
 * and the refinement would clean that"). Pure: row in, { text, refine, tried } out. `refine` is true
 * when refining is the obvious next step for this part; it is never true for a part refine already
 * tried (`tried`): that one is fitted by hand (owner, 2026-11-22: never push Refine where it failed).
 */
const secs = (r) => Math.max(0, (Number(r?.out) || 0) - (Number(r?.in) || 0));
const fmt = (s) => (s >= 10 ? `${Math.round(s)} s` : `${(Math.round(s * 10) / 10).toFixed(1)} s`);
const BY_HAND = 'Refine couldn\'t pin this; drag the handles to fit it by eye.';

const EFFECT_WORDS = {
  mute: 'Muted', bleep: 'Bleeped', duck: 'Turned down', blur: 'Blurred where it is', 'full-blur': 'The whole picture is blurred',
  pixelate: 'Pixelated', 'censor-bar': 'Covered with a bar', blackout: 'The picture is hidden', skip: 'Skipped',
  'skip-card': 'Skipped',
};

export function whyLine(row) {
  if (!row) return { text: '', refine: false, tried: false };
  const rough = row.timing === 'rough';
  const tried = triedRefine(row);
  const unsure = new Set(row.unsure || []);
  const out = (text, refine = false) => ({ text, refine: refine && !tried, tried });
  // Only a part that has a card is skipped behind one (a bare skip said "behind a card": review 2026-11-22).
  const behindCard = row.card ? ' behind a card' : '';
  if (row.acts === false) {
    return row.why === 'removed'
      ? out('Plays: you let this part play.')
      : out('Plays: your settings let this kind of part play. Press an effect key to filter it anyway.');
  }
  if (unsure.has('exchange-by-length')) {
    // A word refine did not find keeps a wide window: say that, not that "the line runs" this long.
    if (unsure.has('refine-giveup')) return out(`Refine could not find this word, so a wider ${fmt(secs(row))} window is kept: too long to bleep, so it is skipped${behindCard}. Check it by ear and drag the handles.`);
    if (!rough) return out(`This line runs ${fmt(secs(row))}, too long to bleep, so it is skipped${behindCard}.`);
    return tried
      ? out(`Rough timing makes this a ${fmt(secs(row))} part, too long to bleep, so it is skipped${behindCard}. ${BY_HAND}`)
      : out(`Rough timing makes this a ${fmt(secs(row))} part, too long to bleep, so it is skipped for now. Refine pins the word so it becomes a short bleep.`, true);
  }
  if (unsure.has('refine-giveup')) return out('Refine could not find this word in the audio, so the rough time is kept. Check it by ear and drag the handles.');
  if (unsure.has('safe-window')) return out(`Muted over a wider ${fmt(secs(row))} window that is sure to cover the word. Drag the handles to narrow it.`);
  if (unsure.has('untracked-visual')) return out('The picture could not be tracked, so the effect covers the whole frame.', rough);
  if (unsure.has('subject-unsure')) return out('Not sure these tags are one thing on screen; check they all get the same effect.');
  if (unsure.has('check-levels')) return out('The scene\'s levels need a look: watch it and pick the effect.');
  // A spoken word whose tag is a picture tag gets a picture effect: say so, it looks wrong otherwise.
  if (row.modality === 'shown' && ['blackout', 'blur', 'full-blur', 'pixelate', 'censor-bar'].includes(row.effect) && String(row.category || '').startsWith('language/')) {
    return out(`The tag for this word is a picture tag, so the picture is ${row.effect === 'blackout' ? 'hidden' : 'blurred'} for ${fmt(secs(row))}.${rough && !tried ? ' Refining checks what it really is.' : ''}`, rough);
  }
  const base = `${EFFECT_WORDS[row.effect] || 'Filtered'}${row.effect === 'skip-card' ? behindCard : ''} for ${fmt(secs(row))}.`;
  if (rough && tried) return out(`${base} ${BY_HAND}`);
  return rough ? out(`${base} The timing is still rough; refining fits it to this film.`, true) : out(base);
}

export default whyLine;
