import { pianoLearningApi } from "../learning.mjs";
import "./PianoLessonSittingsPanel.scss";
import { usePanelFetch, PanelFrame } from "../../../school/browser/teacher-panel.mjs";

const OUTCOME = Object.freeze({
  credited: 'Counted',
  'credited-after-drills': 'Counted after warm-up',
  'drill-owed': 'Not counted yet',
  unenforced: 'Not checked',
  legacy: 'Not checked',
  'already-counted': 'Counted earlier',
  watching: 'Still watching',
});

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function rate(row) {
  const played = Math.max(1, (Number(row.playedSec) || 0) / 60);
  const actual = Math.round(((Number(row.practiceNotes) || 0) / played) * 10) / 10;
  return `${actual}/min`;
}

/** The good-faith score: the judge's 0–10, or "no judge" when the lenient rule decided. */
function scoreText(row) {
  const fallback = row.scoreSource === 'fallback';
  if (row.score == null) return fallback ? 'no judge' : '—';
  return `${row.score}/10${fallback ? ' · no judge' : ''}`;
}

/** The teacher's view of each piano lesson sitting: the silent good-faith score, check-ins, warm-up and outcome. */
export function lessonSittingRow(row) {
  const checkIns = `${row.checkIns ?? 0}${row.scaleCheckIns ? ` (${row.scaleCheckIns} scales)` : ''}`;
  const drill = row.drillReps ? `${row.drillReps} ${row.preschool ? 'games' : 'scales'}, passed ${row.drillsPassed ?? 0}` : '—';
  return {
    when: when(row.updatedAt || row.startedAt),
    lesson: row.title || row.plexId || '',
    watched: `${row.percent ?? 0}%`,
    score: scoreText(row),
    checkIns,
    rate: rate(row),
    drill,
    outcome: OUTCOME[row.outcome] ?? row.outcome ?? '',
  };
}

export default function PianoLessonSittingsPanel({ learnerId }) {
  const record = usePanelFetch(() => pianoLearningApi.lessonSittings(learnerId, 14), {
    deps: [learnerId], panel: 'piano-lesson-sittings', notFoundAs: 'unavailable',
    isEmpty: (data) => !(data?.sittings ?? []).length,
  });
  const rows = (record.data?.sittings ?? []).map((r) => ({ id: r.sittingId, ...lessonSittingRow(r) }));
  return (
    <PanelFrame title="Piano lesson sittings" state={record.state} retry={record.retry}
      unavailableCopy="Piano lessons are not installed on this station."
      emptyCopy="No piano lessons in the last two weeks.">
      {record.state === 'ok' && (
        <table className="piano-sittings">
          <thead>
            <tr><th>When</th><th>Lesson</th><th>Watched</th><th>Score</th><th>Check-ins</th><th>Playing</th><th>Warm-up</th><th>Outcome</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.when}</td><td>{r.lesson}</td><td>{r.watched}</td><td>{r.score}</td>
                <td>{r.checkIns}</td><td>{r.rate}</td><td>{r.drill}</td><td>{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PanelFrame>
  );
}
