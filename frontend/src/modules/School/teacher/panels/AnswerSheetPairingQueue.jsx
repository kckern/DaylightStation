import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { useTeacherWrite } from '../useTeacherWrite.js';

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

export default function AnswerSheetPairingQueue() {
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
      {items.map((held) => (
        <article key={held.heldScanId} className="answer-sheet-pairing__case">
          <header>
            <h3>{held.evidence.learnerId}</h3>
            <p>{held.evidence.reason} · scanned {held.createdAt}</p>
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
                    <p>Printed {candidate.renderedAt}</p>
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
          <button type="button" onClick={() => resolve(held, 'redo')}>Redo without a grade</button>
        </article>
      ))}
    </div>
  );
}
