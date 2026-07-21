/** Fill-in-the-blank: the prompt is split around the single ___ marker
 *  (validation guarantees exactly one), with the input inline. */
import { useEffect, useRef, useState } from 'react';

export default function ClozeItem({ item, onSubmit, verdict }) {
  const [text, setText] = useState('');
  const [before, after] = item.prompt.split('___');
  // Guards against Enter-then-Check (or a double-tap on Check) firing onSubmit
  // twice before `verdict` arrives. A ref (not state) so the second submit
  // path in the same synchronous burst sees the guard already set.
  const submittedRef = useRef(false);
  useEffect(() => { submittedRef.current = false; }, [item.id]);
  const submit = () => {
    if (verdict || submittedRef.current || !text.trim()) return;
    submittedRef.current = true;
    onSubmit(text);
  };
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
      {verdict && !verdict.correct && verdict.expected && (
        <p className="school-item__expected">Answer: <strong>{verdict.expected}</strong></p>
      )}
    </div>
  );
}
