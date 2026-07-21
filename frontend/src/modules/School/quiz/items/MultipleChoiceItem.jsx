/** Tap-target multiple choice. Submits on tap; inert once a verdict exists. */
import { useEffect, useRef } from 'react';

export default function MultipleChoiceItem({ item, onSubmit, verdict }) {
  // Guards against a double-tap firing onSubmit twice before `verdict` arrives
  // from the network round-trip. A ref (not state) because it must block the
  // second call within the same tick/synchronous burst, before React would
  // ever re-render with updated state.
  const submittedRef = useRef(false);
  useEffect(() => { submittedRef.current = false; }, [item.id]);
  const submit = (choice) => {
    if (verdict || submittedRef.current) return;
    submittedRef.current = true;
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
            else cls.push('school-item__choice--dim');
          }
          return (
            <button key={choice} type="button" className={cls.join(' ')} disabled={!!verdict}
              onClick={() => submit(choice)}>
              {choice}
            </button>
          );
        })}
      </div>
    </div>
  );
}
