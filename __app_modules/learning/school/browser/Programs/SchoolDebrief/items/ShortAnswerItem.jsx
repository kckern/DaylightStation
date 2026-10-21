import PromptItem from "./PromptItem.jsx";
import { TouchButton } from "../../../../../../../frontend/src/lib/ui/index.js";
import { useSchoolDebriefKeys } from "../useSchoolDebriefKeys.js";

/** The one short-answer follow-up: the prompt field, then its grade. Ungraded (null) reads as neither right nor wrong. */
export default function ShortAnswerItem({ question, result = null, onAnswer, onContinue, onTake, busy = false }) {
  useSchoolDebriefKeys(result ? { ' ': onContinue, enter: onContinue } : {}, { enabled: Boolean(result) });
  if (!result) {
    return <PromptItem prompt={{ id: question.id, text: question.prompt, required: true }} initial="" busy={busy} onTake={onTake} submitLabel="Answer" onSubmit={({ text }) => onAnswer(text)} />;
  }
  const words = result.correct === true ? 'Nice — you got it.' : result.correct === false ? `Here is one way to say it: ${result.expected}` : 'Thanks — we saved your answer.';
  return (
    <section className="sd-item sd-short" aria-label="Question">
      <h2 className="sd-prompt__text">{question.prompt}</h2>
      <p className="sd-result" role="status">{words}</p>
      <div className="sd-controls"><TouchButton variant="primary" keyHint="Space" onClick={onContinue}>Next</TouchButton></div>
    </section>
  );
}
