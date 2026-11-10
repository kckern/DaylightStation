/**
 * SentenceLadderHistoryPanel — a grown-up's read of one learner's sentence
 * ladder: every course they have started, and for the chosen one, every day's
 * work — what they typed against what was expected (the character diff), the
 * accuracy, the answers they asked to be shown, and their own recordings.
 *
 * The rows are the child's own Review tab (`ReviewPanel`), handed a `source`
 * that reads through the teacher gate instead of a launch grant
 * (`GET /sentence-ladder/teacher/:learnerId/*`). One rendering of the record,
 * so the console can never show a child's history differently from how the
 * child reads it.
 */
import { useEffect, useMemo, useState } from 'react';
import ReviewPanel from "../../Programs/SentenceLadder/ReviewPanel.jsx";
import { languageApi } from "../../Programs/SentenceLadder/languageApi.js";
import { usePanelFetch } from "../usePanelFetch.js";
import { useTeacherProfileOptional } from "../TeacherProfileContext.jsx";
import { teacherLog } from "../teacherLog.js";
import PanelFrame from "./PanelFrame.jsx";

const PANEL = 'sentence-ladder-history';
const STATE_LABEL = { active: 'Active', satisfied: 'Done for today', idle: 'Idle', complete: 'Complete' };

function Loaded({ learnerId, learnerName, actorId }) {
  const courses = usePanelFetch(() => languageApi.teacherCourses(learnerId, actorId), {
    deps: [learnerId, actorId], panel: PANEL, notFoundAs: 'unavailable',
    // A course the learner never opened has no history to read.
    isEmpty: (d) => !(d?.courses ?? []).some((course) => course.state !== 'not-started'),
  });
  const started = useMemo(() => (courses.data?.courses ?? [])
    .filter((course) => course.state !== 'not-started')
    .sort((a, b) => String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? ''))), [courses.data]);
  const [corpusId, setCorpusId] = useState(null);
  const chosen = started.find((course) => course.id === corpusId) ?? started[0] ?? null;

  useEffect(() => {
    if (chosen) teacherLog.nav('sentence-ladder-course', { learnerId, corpusId: chosen.id });
  }, [learnerId, chosen?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- log on a course change only

  const source = useMemo(() => (chosen ? {
    history: () => languageApi.teacherHistory(learnerId, chosen.id, actorId),
    recording: (seq) => languageApi.teacherRecordingBlob(learnerId, chosen.id, seq, actorId),
  } : null), [learnerId, chosen?.id, actorId]); // eslint-disable-line react-hooks/exhaustive-deps -- chosen.id is the identity

  return (
    <PanelFrame title="Sentence ladder" state={courses.state} retry={courses.retry}
      emptyCopy={`${learnerName ?? learnerId} has not started a sentence-ladder course.`}
      unavailableCopy="Sentence ladder is not available on this install.">
      {started.length > 1 && (
        <div className="teacher-sentences__courses" role="tablist" aria-label="Courses">
          {started.map((course) => (
            <button key={course.id} type="button" role="tab" aria-selected={course.id === chosen?.id}
              onClick={() => setCorpusId(course.id)}>{course.label ?? course.id}</button>
          ))}
        </div>
      )}
      {chosen && (
        <div className="teacher-sentences">
          <p className="teacher-muted">
            {chosen.label ?? chosen.id} · {STATE_LABEL[chosen.state] ?? chosen.state}
            {chosen.headline ? ` · ${chosen.headline}` : ''}
          </p>
          <ReviewPanel key={chosen.id} corpusId={chosen.id} source={source} showDates />
        </div>
      )}
    </PanelFrame>
  );
}

export default function SentenceLadderHistoryPanel({ learnerId, learnerName }) {
  const profile = useTeacherProfileOptional();
  const actorId = profile?.currentTeacher?.id ?? null;
  if (!actorId) return <p className="teacher-muted">Pick a teacher to read {learnerName ?? learnerId}’s sentence ladder.</p>;
  return <Loaded learnerId={learnerId} learnerName={learnerName} actorId={actorId} />;
}
