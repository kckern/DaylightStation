/** Free-text answer via the device's soft keyboard. Empty submits are ignored. */
import { useState } from 'react';

export default function ShortAnswerItem({ item, onSubmit, verdict }) {
  const [text, setText] = useState('');
  const submit = () => { if (text.trim()) onSubmit(text); };
  return (
    <div className="school-item school-item--short">
      <p className="school-item__prompt">{item.prompt}</p>
      <input className="school-item__input" type="text" value={text} disabled={!!verdict}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      {!verdict && <button type="button" className="school-item__check" onClick={submit}>Check</button>}
      {verdict && !verdict.correct && (
        <p className="school-item__expected">Answer: <strong>{verdict.expected}</strong></p>
      )}
    </div>
  );
}
