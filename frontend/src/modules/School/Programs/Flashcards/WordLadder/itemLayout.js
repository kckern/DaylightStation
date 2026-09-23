/**
 * `item.shown`'s `layout` and `media` fields (spec §8), derived from the item
 * itself rather than reported by each item component: every field either
 * function reads (`item.type`, `item.mode`/`item.step`, `item.front`,
 * `item.cue?.type`, `word.media`) is already on the item BEFORE it renders,
 * so no `onLayout` callback needs threading through the dozen item
 * components — the layout at `item.shown` time is exactly what the server's
 * item shape says it will be. `fontPx` is not derivable this way (it depends
 * on the stage's live measured box) and is logged `null` (spec §8 allows it:
 * "fontPx of the main FitText if easy, else null").
 *
 * Layout names are the closed set from spec §6 Layouts.
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
  if (item.cue?.type) return item.cue.type; // 'image' | 'text' | 'audio'
  const media = item.word?.media ?? item.assets ?? {};
  if (media.image) return 'image';
  if (media.audio || media.glossAudio) return 'audio';
  return null;
}

export default layoutForItem;
