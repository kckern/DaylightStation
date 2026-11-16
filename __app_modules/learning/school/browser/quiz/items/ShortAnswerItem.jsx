import { SchoolButton } from '../../portal/SchoolButton.jsx';
/** Free-text answer via the device's soft keyboard. Empty submits are ignored. */
import { useEffect, useRef, useState } from 'react';

export default function ShortAnswerItem({ item, onSubmit, verdict }) {
  const [text, setText] = useState('');
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
    <div className="school-item school-item--short">
      <p className="school-item__prompt">{item.prompt}</p>
      <input className="school-item__input" type="text" value={text} disabled={!!verdict}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      {!verdict && <SchoolButton variant="plain" type="button" className="school-item__check" onClick={submit}>Check</SchoolButton>}
      {verdict && !verdict.correct && verdict.expected && (
        <p className="school-item__expected">Answer: <strong>{verdict.expected}</strong></p>
      )}
    </div>
  );
}
