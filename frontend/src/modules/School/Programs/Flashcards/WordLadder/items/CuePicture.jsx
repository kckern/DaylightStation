import { useEffect, useState } from 'react';
import { FitText } from '../FitText.jsx';
import { wordLadderLog } from '../wordLadderLog.js';

/**
 * The cue for a 3.1 / 3.3 image item. The server always sends the gloss as
 * `cue.text` alongside an image cue — on these tasks the gloss IS the cue,
 * never the answer — so a missing or broken picture degrades to the word
 * rather than to a blank prompt the child cannot answer.
 */
export default function CuePicture({ item, src, lang }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [item.id, src]);
  if (src && !failed) {
    return (
      <img
        className="wl-cue-picture"
        src={src}
        alt=""
        onError={() => {
          wordLadderLog.mediaFailed({ kind: 'image', itemId: item.id, task: item.task, src });
          setFailed(true);
        }}
      />
    );
  }
  return item.cue?.text ? <FitText role="prompt" text={item.cue.text} lang={lang} /> : null;
}
