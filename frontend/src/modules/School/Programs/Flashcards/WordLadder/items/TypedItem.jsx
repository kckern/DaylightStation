import { useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';

/**
 * 1.1 copy-type (the Korean is on screen; must match to continue) and 3.3
 * type-from-cue (graded by the server's judge — meaning, not spelling).
 */
export default function TypedItem({ item, mode, langs, resolveAssetUrl, onRespond, result = null, onContinue, busy = false, stageRef = null }) {
  const [value, setValue] = useState('');
  const input = useRef(null);
  const word = item.word;
  const image = item.assets?.image ? resolveAssetUrl(item.assets.image) : null;
  const glossAudio = item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
  const termAudio = word?.media?.audio ? resolveAssetUrl(word.media.audio) : null;
  useEffect(() => {
    setValue('');
    input.current?.focus();
    if (mode === 'copy' && termAudio) playClip(termAudio);
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (result && mode === 'copy' && result.correct === false) input.current?.focus(); }, [result, mode]);
  const submit = () => {
    if (busy || !value.trim()) return;
    onRespond({ typed: value });
    if (mode === 'graded') { input.current?.blur(); stageRef?.current?.focus(); }
  };
  const graded = mode === 'graded';
  useWordLadderKeys(result && graded ? { ' ': onContinue, enter: onContinue } : {}, { enabled: Boolean(result) && graded });
  return (
    <section className="wl-item wl-typed" aria-label={graded ? 'Type the word' : 'Copy the word'}>
      <div className="wl-prompt">
        {!graded && <FitText role="term" text={word.term} lang={langs.term} />}
        {graded && item.cue?.type === 'image' && image && <img className="wl-cue-picture" src={image} alt="" />}
        {graded && item.cue?.type === 'text' && <FitText role="prompt" text={item.cue.text} lang={langs.gloss} />}
        {graded && item.cue?.type === 'audio' && <TouchButton variant="secondary" onClick={() => glossAudio && playClip(glossAudio)}><Icon name="volume" /> Listen</TouchButton>}
      </div>
      <input
        ref={input}
        className="wl-typed__field"
        type="text"
        lang={langs.term}
        data-ime-lang={langs.term}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        disabled={busy || (graded && Boolean(result))}
        aria-label="Your answer"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      <div className="wl-controls">
        {!graded && termAudio && <TouchButton variant="secondary" onClick={() => playClip(termAudio)}><Icon name="volume" /> Hear it</TouchButton>}
        {/* A copy mismatch is a retry, not a terminal result — only a GRADED
            result hides the submit button; copy mode keeps it for the retry. */}
        {(!result || (!graded && result?.correct === false)) && (
          <TouchButton variant="primary" keyHint="Enter" disabled={busy || !value.trim()} onClick={submit}>{busy && graded ? 'Checking…' : 'Enter'}</TouchButton>
        )}
        {!graded && result?.correct === false && <p className="wl-verdict" role="status">Try again — copy it exactly.</p>}
        {graded && result && (
          <p className="wl-verdict" role="status">
            {result.correct && result.score === 10 && 'Right!'}
            {result.correct && result.score < 10 && <>Got it! Here&apos;s the spelling: <span lang={langs.term}>{result.answer}</span></>}
            {!result.correct && <>It&apos;s <span lang={langs.term}>{result.answer}</span></>}
          </p>
        )}
        {graded && result && <TouchButton variant="primary" keyHint="Space" onClick={onContinue}>Next</TouchButton>}
      </div>
    </section>
  );
}
