import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../cardLadderAudio.js';
import CuePicture from './CuePicture.jsx';

/**
 * What an English-side cue has to show, from the item as the server sent it.
 * `english` is the bundle (ruling 2026-09-23: text + picture + gloss audio
 * together; the prompt is never the test). The old single kinds
 * (`image` | `text` | `audio`) are read too, so a stale item still renders.
 */
export function anchorCueParts(item) {
  const cue = item?.cue;
  if (!cue) return null;
  if (cue.type === 'english') return { text: cue.text ?? null, image: Boolean(cue.image), audio: Boolean(cue.audio) };
  return { text: cue.text ?? null, image: cue.type === 'image', audio: cue.type === 'audio' };
}

/**
 * The English-side prompt for 3.1 / 3.3 and the drill's tiles / say-from-cue /
 * type: the picture (when there is one) beside the English text, with a
 * Listen button (Tab) for the gloss clip. Never an audio-only prompt: the text
 * is always on screen. The Korean is never here — it is the answer.
 */
/** `keyHint={null}` once a result's own Listen owns Tab (one Tab hint on screen). */
export default function AnchorCue({ item, resolveAssetUrl, lang, keyHint = 'Tab' }) {
  const parts = anchorCueParts(item);
  if (!parts) return null;
  const src = parts.image && item.assets?.image ? resolveAssetUrl(item.assets.image) : null;
  const glossAudio = parts.audio && item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
  return (
    <div className={`wl-cue${src ? ' has-picture' : ''}`}>
      {src && <CuePicture item={item} src={src} lang={lang} textFallback={false} />}
      <div className="wl-cue__words">
        {parts.text && <div className="wl-cue__text"><FitText role="prompt" text={parts.text} lang={lang} /></div>}
        {glossAudio && (
          <TouchButton variant="secondary" keyHint={keyHint} onClick={() => playClip(glossAudio, 'gloss')}>
            <Icon name="volume" /> Listen
          </TouchButton>
        )}
      </div>
    </div>
  );
}

/** The gloss clip an English cue offers, for the item's Tab key (null when none). */
export function anchorCueAudio(item, resolveAssetUrl) {
  const parts = anchorCueParts(item);
  return parts?.audio && item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
}
