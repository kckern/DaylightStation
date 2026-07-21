/** Fill-in-the-blank: the prompt is split around the single ___ marker
 *  (validation guarantees exactly one), with the input inline. */
import { useState } from 'react';

export default function ClozeItem({ item, onSubmit, verdict }) {
  const [text, setText] = useState('');
  const [before, after] = item.prompt.split('___');
  const submit = () => { if (text.trim()) onSubmit(text); };
  return (
    <div className="school-item school-item--cloze">
      <p className="school-item__prompt">
        {before}
        <input className="school-item__input school-item__input--inline" type="text" value={text}
          disabled={!!verdict} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        {after}
      </p>
      {!verdict && <button type="button" className="school-item__check" onClick={submit}>Check</button>}
      {verdict && !verdict.correct && (
        <p className="school-item__expected">Answer: <strong>{verdict.expected}</strong></p>
      )}
    </div>
  );
}
