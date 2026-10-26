import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { coachFeedback, makeCoachTask } from '../../../../../../../shared/music/learnCoach.mjs';
import useLearnCoach from './useLearnCoach.js';
import LearnLab from './LearnLab.jsx';
import LearnLaunchpad from './LearnLaunchpad.jsx';
import ScorePassage from '../Exercises/ScorePassage.jsx';
import './LearnCoach.scss';

const EMPTY = {};
const criteriaCopy = (task) => task.mode === 'cued'
  ? 'Find every note, with few extra notes, and place them with the beat.'
  : task.mode === 'metronome' ? 'Find every note with few extra notes. The click is a guide; timing is not graded.'
    : 'Find every note with few extra notes. Take the time you need.';

// The key makes profile/passage transitions dispose the old lab and its resolve hold.
export default function LearnCoach(props) {
  if (!props.coach) return <OwnedCoach {...props} />;
  const coach = props.coach;
  return <CoachSession key={`${coach.profileId}:${props.plan.fingerprint}:${props.segment.id}`} {...props} coach={coach} />;
}

function OwnedCoach(props) {
  const coach = useLearnCoach({ plan: props.plan, legacy: props.legacy ?? EMPTY });
  return <LearnCoach {...props} coach={coach} />;
}

function CoachSession({ score, plan, segment, coach, tempo = EMPTY, feedback, onBack, onPassageChange, onListen }) {
  const [view, setView] = useState('prepare');
  const [choice, setChoice] = useState(null);
  const projected = coach.projection.segments.find((item) => item.id === segment.id);
  const recommended = coach.projection.recommended?.passageId === segment.id ? coach.projection.recommended : null;
  const next = recommended ?? projected?.skills.find((task) => !task.ready) ?? segment.tasks.at(-1);
  const [selected, setSelected] = useState(null);
  const task = selected ?? next;
  const [result, setResult] = useState(null);
  const [run, setRun] = useState(null);
  const [readyKey, setReadyKey] = useState(null);
  const [musicError, setMusicError] = useState(null);
  const [runNumber, setRunNumber] = useState(0);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const activeTask = run ?? task;
  const range = useMemo(() => activeTask?.range, [activeTask]);
  const parts = useMemo(() => activeTask?.parts, [activeTask]);
  const ready = useCallback(() => { setReadyKey(task?.key); setMusicError(null); }, [task?.key]);
  const unavailable = useCallback((reason) => setMusicError(reason), []);
  const preview = task && <ScorePassage key={task.key} musicXml={score.musicXml} sourceId={score.id}
    rangeIndices={range} activeParts={parts} keepWholePassage onExpectation={ready} onUnrunnable={unavailable} />;
  const start = (wanted = task) => {
    if (!wanted) return;
    setRun(wanted); setResult(null); setRunNumber((number) => number + 1); setView('run');
    coach.selectTask(wanted);
  };
  const finish = (raw) => {
    if (!live.current) return;
    setResult({ task: run, raw }); setView('result'); setSelected(null);
    coach.record(run, raw);
  };
  const operational = () => finish({ status: 'error', validity: 'invalid', error: 'music-unavailable', diagnostics: {} });
  const message = result ? coachFeedback(result.raw, result.task) : null;
  const earned = result && projected?.skills.find((skill) => skill.key === result.task.key)?.ready;
  const recovery = next?.depth > 0 && next.key !== result?.task.key;
  const nextPassage = coach.projection.segments.find((item) => !item.complete && item.id !== segment.id);
  const progress = <div className="piano-learn-coach__save" role="status">
    <span>{coach.profileId === 'guest' ? 'Choose your name to save. This practice counts for this visit.' : `Practicing as ${coach.profileId}`}</span>
    {coach.saveStatus === 'error' ? <><strong>Progress not saved</strong><button type="button" onClick={async () => {
      await coach.retry().catch(() => {});
      if (result && live.current) coach.record(result.task, result.raw);
    }}>Retry saving</button></> : coach.saveStatus === 'pending' ? <span>Saving progress…</span> : coach.saveStatus === 'saved' ? <span>Progress saved</span> : null}
    {coach.storageError && <span>Keep this page open until progress is saved.</span>}
  </div>;
  if (!task) return <section className="piano-learn-coach"><h2>No playable notes in this passage</h2><button onClick={onBack}>Back to score</button></section>;
  if (view === 'run') {
    const runSegment = { ...segment, inMeasure: run.range.start, outMeasure: run.range.end };
    const rung = { id: run.skill, label: run.label, effectiveParts: run.parts, mode: run.mode,
      tempoPercent: run.tempoPercent, criteria: run.criteria, sets: 1, reps: 1, required: 1, passCount: 0 };
    return <div className="piano-learn-coach piano-learn-coach--running">
      <LearnLab key={runNumber} score={score} revision={plan.fingerprint} segment={runSegment} rung={rung}
        coachingTask={run} onOutcome={finish} startOnReady tempo={{ ...tempo, tempoMap: plan.tempoMap, adjustable: false }} feedback={feedback}
        onClose={() => { setSelected(run); setView('prepare'); }} onChangePractice={() => setView('custom')} onUnavailable={operational} />
      {progress}
    </div>;
  }
  if (view === 'custom') return <div className="piano-learn-coach">
    <LearnLaunchpad segment={segment} initialView="custom" customOnly initialChoice={choice} onChoiceChange={setChoice}
      preview={preview} onBack={() => setView('prepare')} onLaunch={(launch) => {
        const custom = makeCoachTask(plan, { passageId: segment.id, skill: 'custom', label: 'Your practice',
          range: { start: segment.inMeasure, end: segment.outMeasure }, parts: launch.parts, mode: launch.mode,
          tempoPercent: launch.tempoPercent, criteria: { ...plan.criteria, ...launch.rung.criteria }, source: 'custom' });
        setSelected(custom); setView('prepare');
      }} />{progress}</div>;
  return <section className="piano-learn-coach" aria-label={`${segment.label} learning`}>
    <header className="piano-learn-coach__header"><button type="button" onClick={onBack}>‹ Back to score</button>
      <div><strong>{segment.label}</strong><span>{segment.barLabel}</span></div>
      {projected?.complete && <strong>{projected.mastered ? 'Played at score tempo' : 'Practice plan complete'}</strong>}
    </header>
    {progress}
    <div className="piano-learn-coach__body">
      <div className="piano-learn-coach__music" aria-label="Passage music">{preview}</div>
      <div className="piano-learn-coach__task" aria-live="polite">
        {view === 'result' ? <>
          <h2>{message.title}</h2><p>{message.detail}</p>
          {earned ? <p className="piano-learn-coach__earned">✓ Skill earned · {result.task.label}</p>
            : message.reason === 'passed' && <p>{result.task.required ? 'A successful take added to your practice plan.' : 'One more successful take will make this skill ready.'}</p>}
          {next?.reason && <p>{next.reason}</p>}
          {recovery ? <button className="is-primary" onClick={() => start(next)}>Try a smaller task</button>
            : next && next.key !== result.task.key && !projected?.complete
              ? <button className="is-primary" onClick={() => start(next)}>Next: {next.label}</button>
              : projected?.complete && nextPassage && onPassageChange
                ? <button className="is-primary" onClick={() => onPassageChange(nextPassage.id)}>Next passage: {nextPassage.label}</button> : null}
          <button className={recovery || earned ? '' : 'is-primary'} onClick={() => start(result.task)}>Play again</button>
          <button onClick={() => setView('custom')}>Change practice</button>
          <button onClick={onBack}>Finish for now</button>
        </> : <>
          <h2>{task.label}</h2>
          <p>{task.parts.length > 1 ? 'Both hands' : task.parts[0] === 'lh' ? 'Left hand' : 'Right hand'}{task.mode !== 'free' ? ` · ${task.tempoPercent}% of score tempo` : ''} · Bars {task.range.start + 1}–{task.range.end + 1}</p>
          <p>{criteriaCopy(task)}</p>
          <p>{task.required ? `${projected?.skills.find((item) => item.key === task.key)?.successes ?? 0} of ${task.required} successful takes` : 'Two successful takes out of your last three earn this skill.'}</p>
          {musicError && <p role="alert">The music could not be prepared. Return to the score or choose another passage.</p>}
          <button className="is-primary" disabled={readyKey !== task.key || Boolean(musicError)} onClick={() => start()}>Start practice</button>
          {onListen && <button onClick={() => onListen(task)}>Listen</button>}
          <button onClick={() => setView('custom')}>Change practice</button>
          {segment.tasks.some((item) => item.mastery) && <button onClick={() => {
            setSelected(segment.tasks.find((item) => item.mastery)); setMusicError(null);
          }}>Try the full passage</button>}
        </>}
        <ul className="piano-learn-coach__skills" aria-label="Earned skills">{projected?.skills.map((skill) => <li key={skill.key} data-earned={skill.ready}>
          <span aria-hidden="true">{skill.ready ? '✓' : '○'}</span> {skill.label}{skill.mode === 'cued' ? ` · ${skill.tempoPercent}%` : ''}{skill.provenance === 'legacy' ? ' · previously earned' : ''}
        </li>)}</ul>
      </div>
    </div>
  </section>;
}
