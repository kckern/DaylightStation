/** Tap-target multiple choice. Submits on tap; inert once a verdict exists. */
export default function MultipleChoiceItem({ item, onSubmit, verdict }) {
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
              onClick={() => onSubmit(choice)}>
              {choice}
            </button>
          );
        })}
      </div>
    </div>
  );
}
