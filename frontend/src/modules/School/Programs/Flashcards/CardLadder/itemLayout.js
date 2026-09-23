/**
 * `item.shown`'s `layout` and `media` fields (spec §8), derived from the item
 * itself rather than reported by each item component: every field either
 * function reads (`item.type`, `item.mode`/`item.step`, `item.front`,
 * `item.cue?.type`, `word.media`) is already on the item BEFORE it renders,
 * so `layout`/`media` need no callback threaded through the dozen item
 * components — they are exactly what the server's item shape says they will
 * be. `fontPx` IS reported by a component (the main FitText depends on the
 * stage's live measured box, which is not known until after it renders), so
 * `item.shown.fontPx` is always logged `null` and the real value follows as
 * a separate `item.layout {fontPx}` event once that FitText's first fit
 * completes — see `onLayout`/`onFit` wiring in `FitText.jsx` and the item
 * components, and `cardLadderLog.itemLayout`.
 *
 * Layout names are the closed set from spec §6 Layouts. Two are deliberate
 * reuses, not omissions: `listen` maps to `'look'` (it is the same
 * term-on-screen-while-audio-plays screen as the drill's look step) and
 * `drill-offer` maps to `'flashcard-front'` (the tricky-word offer card is
 * laid out identically to a flashcard's front face). `type-keypad` and
 * `quiz-result` are never returned here because they are not layouts of
 * their own — both are sub-states of an item ALREADY shown (the keypad
 * opening under a `type` field; a graded verdict held on a `choice`/`typed`
 * item until Next), so `item.shown` never fires again for them.
 */
const DRILL_LAYOUT = {
  look: 'look',
  copy: 'type',
  dictation: 'type',
  type: 'type',
  tiles: 'tiles',
  match: 'match',
  'say-after': 'say',
  'read-aloud': 'say',
  'say-from-cue': 'say',
};

export function layoutForItem(item) {
  if (!item) return null;
  switch (item.type) {
    case 'flashcard': {
      const glossFront = item.mode === 'practice' && item.front === 'gloss';
      if (!glossFront) return 'flashcard-front';
      return item.word?.media?.image ? 'flashcard-back-picture' : 'flashcard-back-text';
    }
    case 'choice': {
      const cueType = item.cue?.type;
      // The anchor bundle (ruling 2026-09-23) lays out by its picture.
      if (cueType === 'anchor') return item.cue.image ? 'choice-picture-cue' : 'choice-text-cue';
      if (cueType === 'image') return 'choice-picture-cue';
      if (cueType === 'audio') return 'choice-audio-cue';
      return 'choice-text-cue';
    }
    case 'copy': return 'type';
    case 'typed': return 'type';
    case 'say': return 'say';
    case 'match': return 'match';
    case 'listen': return 'look';
    case 'drill-offer': return 'flashcard-front';
    case 'menu': return 'menu';
    case 'words': return 'words';
    case 'summary': return 'summary';
    case 'drill': return DRILL_LAYOUT[item.step] ?? null;
    default: return null;
  }
}

/** The media the item's own prompt/cue is built from — not the sound effects a Hear-it button can also reach. */
export function mediaForItem(item) {
  if (!item) return null;
  // The anchor bundle names its richest visible part; legacy cues their one kind.
  if (item.cue?.type === 'anchor') return item.cue.image ? 'image' : 'text';
  if (item.cue?.type) return item.cue.type; // 'image' | 'text' | 'audio' (pre-2026-09-23 items)
  const media = item.word?.media ?? item.assets ?? {};
  if (media.image) return 'image';
  if (media.audio || media.glossAudio) return 'audio';
  return null;
}

export default layoutForItem;
