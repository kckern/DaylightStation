import { useEffect, useMemo, useRef, useState } from 'react';
import { TouchButton } from '../../../../../lib/ui/index.js';
import Icon from '../../../ui/icons/Icon.jsx';
import { TEMPO_STAGES } from './tempoStages.js';
import { buildCustomLaunch, buildRungLaunch, learnLaunchpadProjection } from './learnLaunch.js';

const iconForRung = (rung) => rung.effectiveParts?.length > 1 ? 'play-along'
  : rung.effectiveParts?.[0] === 'lh' ? 'hand-left' : 'hand-right';

function ActionCard({ icon, title, detail, state, onClick, className = '' }) {
  return <TouchButton variant="choice" className={`piano-learn-launchpad__card ${className}`.trim()}
    data-state={state} aria-label={[title, detail].filter(Boolean).join(', ')} onClick={onClick}>
    <Icon name={icon} /><span><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
  </TouchButton>;
}

function Result({ result, official, onAction }) {
  const diagnostics = result.diagnostics ?? {};
  const passed = result.passed ?? result.verdict?.passed ?? false;
  return <section className="piano-learn-result" role="dialog" aria-modal="true" aria-label="Practice result">
    <Icon name={passed ? 'star' : 'repeat'} />
    <h2>{passed ? 'Nice work!' : 'Keep going'}</h2>
    {Number.isFinite(result.score) && <p>{Math.round(result.score <= 1 ? result.score * 100 : result.score)}%</p>}
    <div className="piano-learn-result__tally" aria-label="Practice score">
      <span>✓ Right {diagnostics.matched_notes ?? result.right ?? 0}</span>
      <span>× Wrong {diagnostics.wrong_notes ?? result.wrong ?? 0}</span>
      {(diagnostics.early_notes != null || result.early != null) && <span>◀ Early {diagnostics.early_notes ?? result.early}</span>}
      {(diagnostics.late_notes != null || result.late != null) && <span>▶ Late {diagnostics.late_notes ?? result.late}</span>}
      {(diagnostics.missed_notes != null || result.missed != null) && <span>○ Missed {diagnostics.missed_notes ?? result.missed}</span>}
    </div>
    <div className="piano-learn-result__actions">
      {official
        ? <><TouchButton onClick={() => onAction?.('next')}>Next drill</TouchButton><TouchButton variant="secondary" onClick={() => onAction?.('repeat')}>Practice again</TouchButton></>
        : <><TouchButton onClick={() => onAction?.('repeat')}>Play again</TouchButton><TouchButton variant="secondary" onClick={() => onAction?.('change')}>Change setup</TouchButton></>}
      <TouchButton variant="secondary" onClick={() => onAction?.('back')}>Back to segment</TouchButton>
    </div>
  </section>;
}

export default function LearnLaunchpad({ segment, preview = null, result = null, initialView = 'home', initialChoice = null, onChoiceChange, onView, onLaunch, onBack, onResultAction }) {
  const [view, setView] = useState(initialView);
  const [parts, setParts] = useState(() => initialChoice?.parts ?? (segment.playableParts?.length > 1 ? ['rh', 'lh'] : [...(segment.playableParts ?? [])]));
  const [mode, setMode] = useState(initialChoice?.mode ?? 'free');
  const [stage, setStage] = useState(() => TEMPO_STAGES.find((item) => item.id === initialChoice?.tempoStage)
    ?? TEMPO_STAGES.find((item) => item.id === 'steady') ?? TEMPO_STAGES[0]);
  const projection = useMemo(() => learnLaunchpadProjection(segment), [segment]);
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  useEffect(() => { onViewRef.current?.(view); }, [view]);

  if (result) return <Result result={result} official={result.source === 'recommended'} onAction={onResultAction} />;

  const choice = { parts, mode, tempoPercent: stage.percent, tempoStage: stage.id };
  const updateChoice = (next) => onChoiceChange?.({ ...choice, ...next });
  const chooseParts = (next) => { setParts(next); updateChoice({ parts: next }); };
  const chooseMode = (next) => { setMode(next); updateChoice({ mode: next }); };
  const chooseStage = (next) => { setStage(next); updateChoice({ tempoPercent: next.percent, tempoStage: next.id }); };
  const launchCustom = () => { onChoiceChange?.(choice); onLaunch?.(buildCustomLaunch(segment, choice)); };
  return <section className="piano-learn-launchpad" role="dialog" aria-modal="true" aria-label={`${segment.label} practice`}>
    <header>
      <button type="button" className="piano-learn-launchpad__back" onClick={view === 'home' ? onBack : () => setView('home')}><Icon name="back" /> Back</button>
      <div><strong>{segment.label}</strong><span>{segment.barLabel}</span></div>
      {(segment.complete || segment.testedOut) && <span className="piano-learn-launchpad__earned"><Icon name="crown" /> Mastered</span>}
    </header>
    <div className="piano-learn-launchpad__body">
      <div className="piano-learn-launchpad__preview" aria-label={`${segment.label} music`}>{preview ?? <Icon name="sheet-music" />}</div>
      <div className="piano-learn-launchpad__actions">
        {view === 'home' && <>
          {projection.recommended ? <ActionCard icon={iconForRung(projection.recommended)} title={`Up next · ${projection.recommended.label}`}
            detail={`${projection.recommended.passCount}/${projection.recommended.required} reps`} state="recommended" className="is-primary"
            onClick={() => onLaunch?.(buildRungLaunch(segment, projection.recommended, 'recommended'))} />
            : <ActionCard icon="repeat" title="Play it again" detail="This segment is mastered" state="complete" className="is-primary" onClick={() => setView('review')} />}
          <div className="piano-learn-launchpad__secondary">
            <ActionCard icon="repeat" title="Practice again" detail="Choose any unlocked drill" onClick={() => setView('review')} />
            <ActionCard icon="settings" title="Make your own" detail="Choose hands, beat, and tempo" onClick={() => setView('custom')} />
          </div>
          {projection.testOut && <ActionCard icon="crown" title="Test out" detail="Three full-speed passes" className="is-challenge"
            onClick={() => onLaunch?.(buildRungLaunch(segment, projection.testOut, 'review'))} />}
        </>}
        {view === 'review' && <div className="piano-learn-launchpad__review" role="group" aria-label="Practice again">
          <h2>Practice again</h2>
          {projection.review.map((rung) => <ActionCard key={rung.id} icon={iconForRung(rung)} title={rung.label}
            detail={rung.state === 'complete' ? 'Complete' : `${rung.passCount}/${rung.required} reps`} state={rung.state}
            onClick={() => onLaunch?.(buildRungLaunch(segment, rung, 'review'))} />)}
        </div>}
        {view === 'custom' && <div className="piano-learn-builder">
          <h2>Make your own practice</h2>
          <div role="group" aria-label="Hands"><h3>Hands</h3>
            {segment.playableParts?.includes('rh') && <TouchButton variant="choice" aria-pressed={parts.length === 1 && parts[0] === 'rh'} onClick={() => chooseParts(['rh'])}><Icon name="hand-right" />Right hand</TouchButton>}
            {segment.playableParts?.includes('lh') && <TouchButton variant="choice" aria-pressed={parts.length === 1 && parts[0] === 'lh'} onClick={() => chooseParts(['lh'])}><Icon name="hand-left" />Left hand</TouchButton>}
            {(segment.playableParts?.length ?? 0) > 1 && <TouchButton variant="choice" aria-pressed={parts.length > 1} onClick={() => chooseParts(['rh', 'lh'])}><Icon name="play-along" />Together</TouchButton>}
          </div>
          <div role="group" aria-label="Beat"><h3>Beat</h3>
            <TouchButton variant="choice" aria-pressed={mode === 'free'} onClick={() => chooseMode('free')}><Icon name="quarter-note" />No beat</TouchButton>
            <TouchButton variant="choice" aria-pressed={mode === 'metronome'} onClick={() => chooseMode('metronome')}><Icon name="metronome" />Keep a beat</TouchButton>
            <TouchButton variant="choice" aria-pressed={mode === 'cued'} onClick={() => chooseMode('cued')}><Icon name="speed" />Play on time</TouchButton>
          </div>
          {mode !== 'free' && <div role="group" aria-label="Tempo"><h3>Tempo</h3>{TEMPO_STAGES.map((item) => <TouchButton key={item.id} variant="choice"
            aria-pressed={stage.id === item.id} aria-label={`${item.label} ${item.percent}%`} onClick={() => chooseStage(item)}>{item.label}<small>{item.percent}%</small></TouchButton>)}</div>}
          <TouchButton className="piano-learn-builder__start" onClick={launchCustom}><Icon name="play" />Start practice</TouchButton>
        </div>}
      </div>
    </div>
  </section>;
}
