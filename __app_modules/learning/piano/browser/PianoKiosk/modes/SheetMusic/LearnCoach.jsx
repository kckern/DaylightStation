import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { coachFeedback, makeCoachTask } from '../../../../../../../shared/music/learnCoach.mjs';
import useLearnCoach from './useLearnCoach.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import LearnLab from './LearnLab.jsx';
import LearnListen from './LearnListen.jsx';
import LearnLaunchpad from './LearnLaunchpad.jsx';
import ScorePassage from '../Exercises/ScorePassage.jsx';
import './LearnCoach.scss';

const EMPTY = {};
const earlierBars = (id) => { const match = /^m(\d+)-(\d+)$/.exec(id); return match ? `Bars ${Number(match[1]) + 1}–${Number(match[2]) + 1}` : 'Earlier passage'; };
const earlierSkill = (id) => ({ right: 'Right hand', left: 'Left hand', together: 'Hands together', timed: 'With the beat', 'test-out': 'Full passage' })[id] ?? 'Earlier skill';
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
  const { connected } = usePianoMidi();
  const [previewAttempt, setPreviewAttempt] = useState(0);
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
  // Save acknowledgements change the projection, never the material of a live take.
  const takeMaterial = useMemo(() => {
    if (!run) return null;
    const canonical = plan.segments.find((item) => item.id === run.passageId);
    return { segment: { ...canonical, inMeasure: run.range.start, outMeasure: run.range.end },
      rung: { id: run.skill, label: run.label, effectiveParts: run.parts, mode: run.mode,
        tempoPercent: run.tempoPercent, criteria: run.criteria, sets: 1, reps: 1, required: 1, passCount: 0 } };
  }, [plan, run]);
  const activeTask = view === 'result' ? (result?.task ?? task) : task;
  const range = useMemo(() => activeTask?.range, [activeTask]);
  const parts = useMemo(() => activeTask?.parts, [activeTask]);
  const ready = useCallback(() => { setReadyKey(task?.key); setMusicError(null); }, [task?.key]);
  const unavailable = useCallback((reason) => setMusicError(reason), []);
  const preview = task && <ScorePassage key={`${task.key}:${previewAttempt}`} musicXml={score.musicXml} sourceId={score.id}
    rangeIndices={range} activeParts={parts} keepWholePassage onExpectation={ready} onUnrunnable={unavailable} />;
  const start = (wanted = task) => {
    if (!wanted) return;
    setRun(wanted); setResult(null); setRunNumber((number) => number + 1); setView('run');
    coach.selectTask(wanted);
  };
  const finish = (raw) => {
    if (!live.current) return;
    raw = { ...raw, assessmentId: raw.assessmentId ?? `coach-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` };
    setResult({ task: run, raw }); setView('result'); setSelected(null);
    coach.record(run, raw);
  };
  const operational = () => finish({ status: 'error', validity: 'invalid', error: 'music-unavailable', diagnostics: {} });
  const message = result ? coachFeedback(result.raw, result.task) : null;
  const earned = result && (projected?.skills.find((skill) => skill.key === result.task.key)?.ready || (result.task.mastery && projected?.mastered));
  const recovery = next?.depth > 0 && next.key !== result?.task.key;
  const recoveryAction = next?.reason === 'slower-beat' ? `Try a little slower · ${next.tempoPercent}%`
    : next?.reason === 'one-hand' ? `Practice the ${next.parts[0] === 'lh' ? 'left' : 'right'} hand`
      : `Practice bars ${(next?.range.start ?? 0) + 1}–${(next?.range.end ?? 0) + 1}`;
  const recoveryDetail = next?.reason === 'slower-beat' ? 'Keep the same notes and give yourself more time between beats.'
    : next?.reason === 'one-hand' ? 'Work on this hand, then return to the hands together.'
      : 'Work on these bars, then return to the whole passage.';
  const openingQuarter = tempo.measureOnsets?.[task?.range.start] ?? 0;
  const baseBpm = plan.tempoMap.filter((entry) => entry.onsetQuarter <= openingQuarter).at(-1)?.bpm;
  const effectiveBpm = baseBpm > 0 ? Math.round(baseBpm * (task?.tempoPercent ?? 100) / 100) : null;
  const nextPassage = coach.projection.segments.find((item) => !item.complete && item.id !== segment.id);
  const progress = <div className="piano-learn-coach__save" role="status">
    <span>{coach.profileId === 'guest' ? 'Choose your name to save. This practice counts for this visit.' : `Practicing as ${coach.profileId}`}</span>
    {coach.saveStatus === 'error' ? <><strong>Progress not saved</strong><button type="button" onClick={async () => {
      await coach.retry().catch(() => {});
      if (result && live.current) coach.record(result.task, result.raw);
    }}>Retry saving</button></> : coach.saveStatus === 'pending' ? <span>Saving progress…</span> : coach.saveStatus === 'saved' ? <span>Progress saved</span> : null}
    {coach.recoveryError && <><span role="alert">{coach.recoveryError}</span><button type="button" onClick={() => {
      const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([coach.recoveryData()], { type: 'application/json' }));
      link.href = url; link.download = 'piano-earlier-practice.json'; link.click(); URL.revokeObjectURL(url);
    }}>Export earlier practice</button></>}
    {coach.storageError && <span>Keep this page open until progress is saved.</span>}
  </div>;
  if (!task) return <section className="piano-learn-coach"><h2>No playable notes in this passage</h2><button onClick={onBack}>Back to score</button></section>;
  if (view === 'listen') return <LearnListen score={score} task={task} tempoMap={plan.tempoMap} onDone={() => setView('prepare')} />;
  if (view === 'run') {
    return <div className="piano-learn-coach piano-learn-coach--running">
      <LearnLab key={runNumber} score={score} revision={plan.fingerprint} segment={takeMaterial.segment} rung={takeMaterial.rung}
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
      {(projected?.complete || projected?.mastered) && <strong>{projected.mastered ? (projected.masteredAt ? 'Played at score tempo' : 'Previously completed') : 'Practice plan complete'}</strong>}
    </header>
    {progress}
    <div className="piano-learn-coach__body">
      <div className="piano-learn-coach__music piano-exercise-run__score" aria-label="Passage music">{preview}</div>
      <div className="piano-learn-coach__task" aria-live="polite">
        {view === 'result' ? <>
          <h2>{message.title}</h2><p>{message.detail}</p>
          {earned ? <p className="piano-learn-coach__earned">✓ Skill earned · {result.task.label}</p>
            : message.reason === 'passed' && <p>{result.task.required ? 'A successful take added to your practice plan.' : 'One more successful take will make this skill ready.'}</p>}
          {recovery && <p>{recoveryDetail}</p>}
          {recovery ? <button className="is-primary" onClick={() => start(next)}>{recoveryAction}</button>
            : next && next.key !== result.task.key && !projected?.complete
              ? <button className="is-primary" onClick={() => start(next)}>Next: {next.label}</button>
              : projected?.complete && nextPassage && onPassageChange
                ? <button className="is-primary" onClick={() => onPassageChange(nextPassage.id)}>Next passage: {nextPassage.label}</button> : null}
          <button className={recovery || earned ? '' : 'is-primary'} onClick={() => start(result.task)}>Play again</button>
          <button onClick={() => setView('custom')}>Change practice</button>
          <button onClick={onBack}>Finish for now</button>
        </> : <>
          <h2>{task.label}</h2>
          <p>{task.parts.length > 1 ? 'Both hands' : task.parts[0] === 'lh' ? 'Left hand' : 'Right hand'}{task.mode !== 'free' ? ` · ${task.tempoPercent}% of score tempo${effectiveBpm ? ` · starts at ${effectiveBpm} BPM` : ''}` : ''} · Bars {task.range.start + 1}–{task.range.end + 1}</p>
          <p>{criteriaCopy(task)}</p>
          <p>{task.required ? `${projected?.skills.find((item) => item.key === task.key)?.successes ?? 0} of ${task.required} successful takes` : 'Two successful takes out of your last three earn this skill.'}</p>
          {musicError ? <><p role="alert">The music could not be prepared. Return to the score or try again.</p><button onClick={() => { setReadyKey(null); setMusicError(null); setPreviewAttempt((value) => value + 1); }}>Retry music</button></>
            : readyKey !== task.key && <p role="status">Preparing the music…</p>}
          {coach.loaded === false && <p role="status">Loading your practice…</p>}
          {connected === false && <p role="alert">Connect the piano before starting. Your progress is safe.</p>}
          <button className="is-primary" disabled={readyKey !== task.key || Boolean(musicError) || connected === false || coach.loaded === false} onClick={() => start()}>Start practice</button>
          <button onClick={() => { onListen?.(task); setView('listen'); }}>Listen</button>
          <button onClick={() => setView('custom')}>Change practice</button>
          {segment.demonstration && <button onClick={() => {
            setSelected(segment.demonstration); setMusicError(null);
          }}>Try the full passage</button>}
        </>}
        {Object.values(coach.projection.retainedLegacy?.passages ?? {}).some((passage) => passage.complete || Object.values(passage.rungs ?? {}).some((rung) => rung.passCount > 0)) && <details className="piano-learn-coach__earlier">
          <summary>Earlier practice retained</summary>
          {!coach.projection.retainedLegacy.compatible && <p>This score has changed. Your earlier achievements are kept separately.</p>}
          <ul>{Object.entries(coach.projection.retainedLegacy.passages).flatMap(([id, passage]) => Object.entries(passage.rungs ?? {}).filter(([, rung]) => rung.passCount > 0).map(([skill, rung]) => <li key={`${id}:${skill}`}>{earlierBars(id)} · {earlierSkill(skill)} · {rung.passCount} successful takes</li>))}</ul>
        </details>}
        <ul className="piano-learn-coach__skills" aria-label="Earned skills">{projected?.skills.map((skill) => <li key={skill.key} data-earned={skill.ready}>
          <span aria-hidden="true">{skill.ready ? '✓' : '○'}</span> {skill.label}{skill.mode === 'cued' ? ` · ${skill.tempoPercent}%` : ''}{skill.provenance === 'legacy' ? ' · previously earned' : ''}
        </li>)}</ul>
      </div>
    </div>
  </section>;
}
