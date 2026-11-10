import { useState } from 'react';
import { schoolApi } from "../../schoolApi.js";
import { useTeacherWrite } from "../useTeacherWrite.js";
import { humanDateTime } from "../teacherDates.js";

function Identicon({ icon }) {
  if (!Array.isArray(icon?.cells)) return null;
  return (
    <span className="answer-sheet-identicon" aria-label={`Answer-sheet symbol ${icon.version}`}>
      {icon.cells.map((filled, index) => (
        <span key={index} className={filled ? 'answer-sheet-identicon__cell answer-sheet-identicon__cell--on' : 'answer-sheet-identicon__cell'} />
      ))}
    </span>
  );
}

const marksText = (rows) => (rows ?? []).map((row) => (
  `${row.row}: ${row.marks?.length ? row.marks.join('+') : 'blank'}`
)).join(' · ');

// Why the scan was held, in words. The codes are `ResolveCardScan`'s
// (`multiple-delivered-live-answer-sheets` / `activity-on-historical-answer-sheet`).
const REASON_COPY = {
  'multiple-delivered-live-answer-sheets': 'Two answer sheets were out at once, so the scan could belong to either',
  'activity-on-historical-answer-sheet': 'This answer sheet had already been replaced by a newer one',
};
const reasonCopy = (reason) => REASON_COPY[reason] ?? 'The scan could not be matched to one worksheet';
const when = (value) => humanDateTime(value) ?? 'at an unknown time';

export default function AnswerSheetPairingQueue({ kids = [] }) {
  const nameFor = (id) => kids.find((kid) => kid.id === id)?.name ?? id ?? 'Unknown learner';
  const { run, busy, errors } = useTeacherWrite({ panel: 'answer-sheet-pairing' });
  const [items, setItems] = useState(null);

  const load = () => run('load', ({ actorId }) => schoolApi.answerSheetReviews({ reviewerId: actorId }), {
    onSuccess: (data) => setItems(data.items ?? []),
  });
  const resolve = (held, action, targetRecordId = null) => {
    const key = `${held.heldScanId}:${action}:${targetRecordId ?? 'none'}`;
    run(key, ({ actorId, pin }) => schoolApi.resolveAnswerSheetReview(held.heldScanId, {
      action,
      targetRecordId,
      reviewerId: actorId,
      pin,
      idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${key}`,
    }), { onSuccess: () => setItems((current) => current.filter((item) => item.heldScanId !== held.heldScanId)) });
  };

  if (items === null) {
    return (
      <section className="answer-sheet-pairing">
        <p>Answer-sheet mix-ups are kept apart from question-by-question grading.</p>
        <button type="button" disabled={busy === 'load'} onClick={load}>Open answer-sheet reviews</button>
        {errors.load && <p className="teacher-panel__error">{errors.load}</p>}
      </section>
    );
  }
  if (!items.length) return <p>There are no answer-sheet pairings to check.</p>;

  return (
    <div className="answer-sheet-pairing">
      {items.map((held) => {
        // `resolve` keys a redo as `${heldScanId}:redo:none`; its refusal and
        // its in-flight state belong under its own button like the others'.
        const redoKey = `${held.heldScanId}:redo:none`;
        return (
        <article key={held.heldScanId} className="answer-sheet-pairing__case">
          <header>
            <h3>{nameFor(held.evidence.learnerId)}</h3>
            <p>{reasonCopy(held.evidence.reason)} · scanned {when(held.createdAt)}</p>
            <p><strong>Original marks:</strong> {marksText(held.evidence.rawRows)}</p>
          </header>
          <div className="answer-sheet-pairing__candidates">
            {held.evidence.candidateWorksheets.map((candidate) => {
              const confirmKey = `${held.heldScanId}:confirm:${candidate.recordId}`;
              const reassignKey = `${held.heldScanId}:reassign:${candidate.recordId}`;
              return (
                <section key={candidate.recordId} className="answer-sheet-pairing__candidate">
                  <Identicon icon={candidate.identicon} />
                  <div>
                    <h4>{candidate.title}</h4>
                    <p>Student No. {candidate.cardId} · rows {candidate.rowRange.start}–{candidate.rowRange.end}</p>
                    <p>Printed {when(candidate.renderedAt)}</p>
                  </div>
                  <div className="answer-sheet-pairing__actions">
                    {candidate.cardId === held.evidence.rawCardId && (
                      <button type="button" disabled={busy === confirmKey} onClick={() => resolve(held, 'confirm', candidate.recordId)}>
                        Confirm this worksheet
                      </button>
                    )}
                    {candidate.cardId !== held.evidence.rawCardId && (
                      <button type="button" disabled={busy === reassignKey} onClick={() => resolve(held, 'reassign', candidate.recordId)}>
                        Reassign marks here
                      </button>
                    )}
                  </div>
                  {(errors[confirmKey] || errors[reassignKey]) && (
                    <p className="teacher-panel__error">{errors[confirmKey] || errors[reassignKey]}</p>
                  )}
                </section>
              );
            })}
          </div>
          <button type="button" disabled={busy === redoKey} onClick={() => resolve(held, 'redo')}>Redo without a grade</button>
          {errors[redoKey] && <p className="teacher-panel__error">{errors[redoKey]}</p>}
        </article>
        );
      })}
    </div>
  );
}
