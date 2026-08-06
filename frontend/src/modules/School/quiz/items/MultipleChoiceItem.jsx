/** Tap-target multiple choice. Submits on tap; inert once a verdict exists.
 * After the verdict the child's OWN pick stays marked (advocacy wave 7): a
 * board that only highlights the right answer erases what they actually
 * chose, so the correction teaches nothing. A one-line text verdict says it
 * in words as well as color. */
import { useEffect, useRef, useState } from 'react';

export default function MultipleChoiceItem({ item, onSubmit, verdict }) {
  // Guards against a double-tap firing onSubmit twice before `verdict` arrives
  // from the network round-trip. A ref (not state) because it must block the
  // second call within the same tick/synchronous burst, before React would
  // ever re-render with updated state.
  const submittedRef = useRef(false);
  const [chosen, setChosen] = useState(null);
  useEffect(() => { submittedRef.current = false; setChosen(null); }, [item.id]);
  const submit = (choice) => {
    if (verdict || submittedRef.current) return;
    submittedRef.current = true;
    setChosen(choice);
    onSubmit(choice);
  };
  return (
    <div className="school-item school-item--mc">
      <p className="school-item__prompt">{item.prompt}</p>
      <div className="school-item__choices">
        {item.choices.map((choice) => {
          const cls = ['school-item__choice'];
          if (verdict) {
            if (choice === verdict.expected) cls.push('school-item__choice--right');
            else if (choice === chosen) cls.push('school-item__choice--chosen-wrong');
            else cls.push('school-item__choice--dim');
          }
          return (
            <button key={choice} type="button" className={cls.join(' ')} disabled={!!verdict}
              onClick={() => submit(choice)}>
              {choice}
              {verdict && choice === chosen && (
                <span className="school-item__you" aria-hidden="true"> — your pick</span>
              )}
            </button>
          );
        })}
      </div>
      {verdict && !verdict.unrecorded && (
        <p className="school-item__verdict" data-testid="mc-verdict">
          {verdict.correct ? 'Right!' : `Not quite — the answer is ${verdict.expected}.`}
        </p>
      )}
    </div>
  );
}
