/**
 * One lesson's questions, answers and verdicts — as ONE list.
 *
 * The inspector used to print every question twice: "Worksheet and questions"
 * with the choices, then "Answers and result" with the same prompts again and
 * a different (bank-global) numbering. Same page, same questions, two
 * numberings, everything said twice (UX audit IA1/IA6). The worksheet's own
 * numbering wins; the bank index is an internal id and never appears.
 */
import { labelize } from '../labelize.js';

const fallbackLetter = (index) => String.fromCharCode(65 + index);
/** Choices carry `label`; `text` is only a legacy tail. */
const choiceText = (choice) => choice?.label ?? choice?.text ?? choice;
const choiceLetter = (choice, index) => choice?.letter ?? fallbackLetter(index);

/**
 * An answer arrives as either a bubbled LETTER ("B", "A,B") or as answer
 * text, depending on how it was captured. A letter is an internal
 * coordinate on a printed page — never something to show a parent (the
 * "Their answer: B,D" leak, audit IA6). Resolve it against the worksheet's
 * own choices; pass anything unrecognized through untouched.
 */
function readable(value, choices = []) {
  if (value == null || value === '') return null;
  const parts = String(value).split(',').map((part) => part.trim()).filter(Boolean);
  const resolved = parts.map((part) => {
    const byLetter = choices.find((choice, index) => choiceLetter(choice, index) === part);
    return byLetter ? String(choiceText(byLetter)) : part;
  });
  return resolved.join(', ');
}

/** Did the child pick this choice? Compare on letter AND on text. */
function isChosen(choice, index, given) {
  if (given == null) return false;
  const parts = String(given).split(',').map((part) => part.trim());
  return parts.includes(choiceLetter(choice, index)) || parts.includes(String(choiceText(choice)));
}

function rowsFor(assignment, assessment) {
  const questions = assignment?.questions ?? [];
  const items = assessment?.items ?? [];
  if (questions.length) {
    const byItemId = new Map(items.filter((item) => item.itemId != null).map((item) => [item.itemId, item]));
    return questions.map((question, index) => ({
      key: question.itemId ?? `q${index}`,
      number: question.number ?? index + 1,
      prompt: question.prompt ?? 'Question text unavailable',
      choices: question.choices ?? [],
      item: byItemId.get(question.itemId) ?? items[index] ?? null,
    }));
  }
  return items.map((item, index) => ({
    key: item.itemId ?? `a${index}`,
    number: index + 1,
    prompt: item.prompt ?? 'Recorded answer',
    choices: [],
    item,
  }));
}

export default function GradedWorksheet({ assignment, assessment }) {
  const rows = rowsFor(assignment, assessment);
  if (!rows.length) return null;
  // When nothing is graded the fact belongs to the worksheet, not to each of
  // its rows — repeating "Not graded" per question is the same duplication
  // this component exists to remove.
  const anyGraded = rows.some((row) => row.item);
  return (
    <>
    {!anyGraded && <p className="teacher-muted">Not graded yet — no answers have been recorded for this worksheet.</p>}
    <ol className="teacher-graded-worksheet">
      {rows.map((row) => {
        const item = row.item;
        const verdict = item?.verdict ?? null;
        const given = readable(item?.given, row.choices);
        const expected = item?.expected?.length ? readable(item.expected.join(','), row.choices) : null;
        const wrong = verdict && verdict !== 'correct';
        return (
          <li className={`teacher-graded-q${verdict ? ` teacher-graded-q--${verdict}` : ''}`} key={row.key}>
            <span className="teacher-graded-q__number">{`${row.number}.`}</span>
            <div className="teacher-graded-q__main">
              <p className="teacher-graded-q__prompt">{row.prompt}</p>
              {row.choices.length > 0 && (
                <ul className="teacher-graded-q__choices">
                  {row.choices.map((choice, index) => (
                    <li key={`${row.key}:${index}`} className={isChosen(choice, index, item?.given) ? 'is-chosen' : undefined}>
                      {`${choiceLetter(choice, index)}. ${choiceText(choice)}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="teacher-graded-q__result">
              {item ? <>
                <span className="teacher-graded-q__given">{given ?? 'No recorded answer'}</span>
                {verdict && <span className={`teacher-verdict teacher-verdict--${verdict}`}>{labelize(verdict)}</span>}
                {wrong && expected && (
                  <small className="teacher-graded-q__expected">Correct answer: {expected}</small>
                )}
              </> : anyGraded ? <span className="teacher-muted">Not graded</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
    </>
  );
}
