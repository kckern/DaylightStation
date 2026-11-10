import { TouchButton } from "../../../../../../../frontend/src/lib/ui/index.js";
import { useSchoolDebriefKeys, speak } from "../useSchoolDebriefKeys.js";

const LETTERS = ['a', 'b', 'c', 'd'];
/** A frozen multiple-choice follow-up. 1–4 or A–D answer; result shows at once; Space/Enter continue. */
export default function ChoiceItem({ question, result = null, busy = false, onAnswer, onContinue }) {
  const choose = (opt) => { if (!busy && !result) onAnswer(opt); };
  useSchoolDebriefKeys(result
    ? { ' ': onContinue, enter: onContinue, tab: () => speak(question.prompt) }
    : { tab: () => speak(question.prompt), ...Object.fromEntries(question.options.flatMap((o, i) => [[String(i + 1), () => choose(o)], [LETTERS[i], () => choose(o)]])) });
  return (
    <section className="sd-item sd-choice" aria-label="Question">
      <h2 className="sd-prompt__text">{question.prompt}</h2>
      <div className="sd-choices" role="group" aria-label="Choices">
        {question.options.map((opt, i) => (
          <TouchButton key={opt} variant="choice" keyHint={`${i + 1}`} disabled={busy || Boolean(result)} onClick={() => choose(opt)}
            className={result && opt === result.answer ? 'is-answer' : undefined}>
            <span className="sd-choice__letter">{LETTERS[i].toUpperCase()}</span> {opt}
          </TouchButton>
        ))}
      </div>
      {result && (
        <p className={`sd-result ${result.correct ? 'is-right' : 'is-wrong'}`} role="status">
          {result.correct ? 'Yes!' : `The answer was: ${result.answer}`}
        </p>
      )}
      {result && <div className="sd-controls"><TouchButton variant="primary" keyHint="Space" onClick={onContinue}>Next</TouchButton></div>}
    </section>
  );
}
