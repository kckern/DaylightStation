import { useEffect, useMemo, useState } from 'react';
import { Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { isPersistentUser } from '../../pianoUser.js';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonGrid, SkeletonStage } from '../../Skeleton.jsx';
import AskSession from '../../../ask/AskSession.jsx';
import { ExercisePreview } from './ExerciseNotation.jsx';
import { describeInstance, matchesExerciseSearch } from './exerciseQuery.js';
import { FORM_OPTIONS, HAND_OPTIONS, LEVEL_BANDS, MODE_OPTIONS } from './filters.js';
import { pianoLearningApi } from './pianoLearningApi.js';
import { useExerciseWorkspace } from './useExerciseWorkspace.js';
import './Exercises.scss';

export function Exercises() {
  return (
    <Routes>
      <Route index element={<ExerciseDashboard />} />
      <Route path="browse" element={<ExerciseCatalog />} />
      <Route path="program/:programId" element={<ExerciseProgram />} />
      <Route path="item/*" element={<ExerciseDetail />} />
      <Route path="run/*" element={<ExerciseRunRoute />} />
    </Routes>
  );
}

function useExercisesBase() {
  const { pathname } = useLocation();
  const marker = '/exercises';
  const index = pathname.indexOf(marker);
  return index >= 0 ? pathname.slice(0, index + marker.length) : '/piano/exercises';
}

function PageHeader({ eyebrow = 'Practice room', title, subtitle, onBack, action = null }) {
  return (
    <header className="piano-exercises__page-head">
      <div>
        {onBack && <button type="button" className="piano-exercises__back" onClick={onBack}>Back</button>}
        <span className="piano-exercises__eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

function ExerciseDashboard() {
  const navigate = useNavigate();
  const base = useExercisesBase();
  const { currentUser, currentProfile } = usePianoUser();
  const { catalog, learning, loading, error, refresh } = useExerciseWorkspace(currentUser || 'guest');
  const [busy, setBusy] = useState(null);
  if (loading) return <SkeletonStage />;
  if (error || !catalog || !learning) return <PianoEmpty title="Exercises unavailable" hint={error} />;

  const active = learning.programs ?? [];
  const featured = (learning.available_programs ?? []).filter((program) => program.featured && !program.active);
  const next = learning.next_up;
  const continueNext = () => {
    if (next?.type === 'video-checkpoint') {
      const query = new URLSearchParams({
        intent: 'challenge',
        requirement: JSON.stringify(next.requirement),
        ...(next.return_to ? { return: next.return_to } : {}),
        // The lesson this checkpoint stands in front of. A checkpoint is not a
        // program step, so the run route has nothing to fetch its own framing
        // from — the label travels, and `framingFor` writes the sentence.
        ...(next.title ? { label: next.title } : {}),
      });
      navigate(`${base}/run/${encodeURIComponent(next.requirement.exercise_id)}?${query}`);
      return;
    }
    if (next) navigate(`${base}/program/${encodeURIComponent(next.program_id)}`);
  };
  const enroll = async (programId) => {
    if (!isPersistentUser(currentUser)) return;
    setBusy(programId);
    const result = await pianoLearningApi.enroll(currentUser, programId);
    setBusy(null);
    if (result.ok) refresh();
  };

  return (
    <section className="piano-exercises piano-exercises--home">
      <PageHeader
        title={`${currentProfile?.name ?? 'Guest'}’s practice`}
        subtitle="Continue a learning track or explore the exercise library."
        action={<button type="button" className="piano-exercises__quiet-action" onClick={() => navigate(`${base}/browse`)}>Browse library</button>}
      />

      {next ? (
        <section className="piano-exercises__next" aria-labelledby="exercise-next-title">
          <span className="piano-exercises__section-kicker">Next up</span>
          <div className="piano-exercises__next-copy">
            <h2 id="exercise-next-title">{next.type === 'video-checkpoint' ? next.title : next.step.title}</h2>
            <p>{next.type === 'video-checkpoint' ? `${next.course_title ?? 'Video lesson'} · Exercise checkpoint` : `${next.program_title} · Step ${next.step.order}`}</p>
          </div>
          <button type="button" onClick={continueNext}>Continue</button>
        </section>
      ) : (
        <section className="piano-exercises__next piano-exercises__next--empty">
          <span className="piano-exercises__section-kicker">Choose a program</span>
          <div className="piano-exercises__next-copy">
            <h2>Build a practice path</h2>
            <p>Programs remember where you are and put one useful task first.</p>
          </div>
          <button type="button" onClick={() => navigate(`${base}/browse`)}>Explore</button>
        </section>
      )}

      {active.length > 0 && (
        <section className="piano-exercises__section">
          <div className="piano-exercises__section-head"><div><span>In progress</span><h2>My programs</h2></div></div>
          <div className="piano-exercises__program-grid">
            {active.map((program) => (
              <button key={program.id} type="button" className="piano-exercises__program-card" onClick={() => navigate(`${base}/program/${encodeURIComponent(program.id)}`)}>
                <span className="piano-exercises__program-kind">{program.required ? 'Required' : 'My program'}</span>
                <strong>{program.title}</strong>
                <span>{program.current_step ? `Next: ${program.current_step.title}` : 'Program complete'}</span>
                <Progress value={program.percent} label={`${program.passed_steps} of ${program.total_steps}`} />
              </button>
            ))}
          </div>
        </section>
      )}

      {featured.map((program) => (
        <section className="piano-exercises__feature" key={program.id}>
          <div>
            <span className="piano-exercises__section-kicker">Featured program</span>
            <h2>{program.title}</h2>
            <p>{program.description}</p>
            <span>{program.steps} progressive exercises</span>
          </div>
          <div className="piano-exercises__feature-actions">
            <button type="button" className="piano-exercises__quiet-action" onClick={() => navigate(`${base}/program/${encodeURIComponent(program.id)}`)}>View program</button>
            {isPersistentUser(currentUser) ? (
              <button type="button" disabled={busy === program.id} onClick={() => enroll(program.id)}>{busy === program.id ? 'Starting…' : 'Start program'}</button>
            ) : <span>Choose a learner to save progress</span>}
          </div>
        </section>
      ))}

      <section className="piano-exercises__section piano-exercises__browse-callout">
        <div className="piano-exercises__section-head">
          <div><span>Reference library</span><h2>Browse exercises</h2></div>
          <button type="button" className="piano-exercises__text-action" onClick={() => navigate(`${base}/browse`)}>See all {catalog.totals.seeds}</button>
        </div>
        <p>{catalog.totals.seeds} authored exercises with {catalog.totals.variants} playable key, hand, and direction variants.</p>
        <div className="piano-exercises__category-row">
          {catalog.categories.filter((category) => !category.parent).map((category) => (
            <button key={category.id} type="button" onClick={() => navigate(`${base}/browse?collection=${encodeURIComponent(category.id)}`)}>
              <strong>{category.title}</strong><span>{category.subtitle}</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}

function ExerciseCatalog() {
  const navigate = useNavigate();
  const base = useExercisesBase();
  const { currentUser } = usePianoUser();
  const { catalog, learning, loading, error } = useExerciseWorkspace(currentUser || 'guest');
  const [params, setParams] = useSearchParams();
  const storageKey = `piano:exercise-filters:${currentUser || 'guest'}`;

  useEffect(() => {
    if ([...params.keys()].length) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setParams(new URLSearchParams(saved), { replace: true });
    } catch { /* private mode */ }
  }, [params, setParams, storageKey]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, params.toString()); } catch { /* private mode */ }
  }, [params, storageKey]);

  if (loading) return <SkeletonGrid />;
  if (error || !catalog) return <PianoEmpty title="Exercise library unavailable" hint={error} />;
  const set = (name, value) => {
    const next = new URLSearchParams(params);
    if (value == null || value === '') next.delete(name); else next.set(name, String(value));
    setParams(next);
  };
  const level = LEVEL_BANDS.find((band) => band.id === params.get('level')) ?? LEVEL_BANDS[0];
  const progress = learning?.catalog_progress ?? {};
  const programSteps = (learning?.programs ?? []).flatMap((program) => program.steps.map((step) => ({ program, step, seedId: step.seed_id ?? step.requirement.exercise_id.split('@')[0] })));
  const items = catalog.seeds.filter((seed) => {
    if (!matchesExerciseSearch(seed, params.get('q'))) return false;
    const collection = params.get('collection');
    if (collection && seed.category !== collection && !seed.category.startsWith(`${collection}/`)) return false;
    if (params.get('form') && seed.form !== params.get('form')) return false;
    if (params.get('mode') && !seed.supports.includes(params.get('mode'))) return false;
    if (params.get('hands') && !seed.hands.includes(params.get('hands'))) return false;
    if (seed.level_max < level.min || seed.level_min > level.max) return false;
    const state = params.get('progress');
    if (state === 'ready' && !programSteps.some((entry) => entry.seedId === seed.id && entry.step.state === 'current')) return false;
    if (state === 'my-programs' && !programSteps.some((entry) => entry.seedId === seed.id)) return false;
    if (state === 'assigned' && !programSteps.some((entry) => entry.seedId === seed.id && entry.program.required)) return false;
    if (state === 'not-tried' && progress[seed.id]) return false;
    if (state === 'needs-work' && (!progress[seed.id] || progress[seed.id].passed)) return false;
    if (state === 'passed' && !progress[seed.id]?.passed) return false;
    return true;
  });

  return (
    <section className="piano-exercises piano-exercises--catalog">
      <PageHeader eyebrow="Exercise library" title="Browse by musical idea" subtitle={`${catalog.totals.seeds} authored exercises · ${catalog.totals.variants} playable variants`} onBack={() => navigate(base)} />
      <div className="piano-exercises__catalog-layout">
        <aside className="piano-exercises__filter-panel">
          <label className="piano-exercises__select piano-exercises__search">
            <span>Find an exercise</span>
            <input type="search" value={params.get('q') ?? ''} placeholder="Hanon, triads, blues…" onChange={(event) => set('q', event.target.value)} />
          </label>
          <SelectFilter label="Collection" value={params.get('collection') ?? ''} onChange={(value) => set('collection', value)} options={[
            { id: '', label: 'All collections' }, ...catalog.categories.map((category) => ({ id: category.id, label: category.title })),
          ]} />
          <SelectFilter label="Kind" value={params.get('form') ?? ''} onChange={(value) => set('form', value)} options={FORM_OPTIONS.map((option) => ({ id: option.id ?? '', label: option.label }))} />
          <SelectFilter label="Level" value={level.id} onChange={(value) => set('level', value === 'any' ? null : value)} options={LEVEL_BANDS.map((band) => ({ id: band.id, label: band.label }))} />
          <SelectFilter label="Mode" value={params.get('mode') ?? ''} onChange={(value) => set('mode', value)} options={[{ id: '', label: 'Any mode' }, ...MODE_OPTIONS]} />
          <SelectFilter label="Hands" value={params.get('hands') ?? ''} onChange={(value) => set('hands', value)} options={HAND_OPTIONS.map((option) => ({ id: option.id ?? '', label: option.label }))} />
          <SelectFilter label="My progress" value={params.get('progress') ?? ''} onChange={(value) => set('progress', value)} options={[
            { id: '', label: 'All exercises' }, { id: 'ready', label: 'Ready now' }, { id: 'my-programs', label: 'My programs' }, { id: 'assigned', label: 'Assigned' }, { id: 'not-tried', label: 'Not tried' }, { id: 'needs-work', label: 'Needs work' }, { id: 'passed', label: 'Passed' },
          ]} />
          <button type="button" className="piano-exercises__reset" onClick={() => setParams({})}>Clear filters</button>
        </aside>
        <main>
          <p className="piano-exercises__result-count">{items.length} exercise{items.length === 1 ? '' : 's'}</p>
          {items.length ? (
            <ul className="piano-exercises__seed-grid">
              {items.map((seed) => (
                <li key={seed.id}>
                  <button type="button" className="piano-exercises__seed-card" onClick={() => navigate(`${base}/item/${seed.id}`)}>
                    <span className="piano-exercises__seed-kind">{seed.form ?? 'exercise'} · Level {seed.level_min === seed.level_max ? seed.level_min : `${seed.level_min}–${seed.level_max}`}</span>
                    <strong>{seed.title}</strong>
                    <span>{seed.subtitle ?? seed.focus ?? seed.category}</span>
                    <span className="piano-exercises__seed-meta">{seed.variants} variant{seed.variants === 1 ? '' : 's'} · {seed.hands.join(' / ')}</span>
                    {progress[seed.id] && <span className={`piano-exercises__status-tag${progress[seed.id].passed ? ' is-passed' : ''}`}>{progress[seed.id].passed ? 'Passed' : 'Practiced'}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : <PianoEmpty title="No authored exercises match" hint="Try a wider level or another collection." />}
        </main>
      </div>
    </section>
  );
}

function ExerciseProgram() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const base = useExercisesBase();
  const { currentUser } = usePianoUser();
  const { learning, loading, error, refresh } = useExerciseWorkspace(currentUser || 'guest');
  const [raw, setRaw] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    pianoLearningApi.program(programId).then((result) => { if (alive && result.ok) setRaw(result.data); });
    return () => { alive = false; };
  }, [programId]);
  if (loading || !raw) return <SkeletonStage />;
  if (error) return <PianoEmpty title="Program unavailable" hint={error} />;
  const active = learning.programs?.find((program) => program.id === programId);
  const program = active ?? {
    ...raw, passed_steps: 0, total_steps: raw.steps.length, percent: 0,
    steps: raw.steps.map((step, index) => ({ ...step, state: index === 0 ? 'current' : 'upcoming', unlocked: index === 0, passed: false })),
  };
  const changeEnrollment = async () => {
    if (!isPersistentUser(currentUser)) return;
    setBusy(true);
    const response = active ? await pianoLearningApi.unenroll(currentUser, programId) : await pianoLearningApi.enroll(currentUser, programId);
    setBusy(false);
    if (response.ok) refresh();
  };
  const currentStep = program.steps.find((step) => step.state === 'current')
    ?? program.steps.find((step) => step.unlocked && !step.passed)
    ?? program.steps.at(-1);
  const practiceStep = (step) => navigate(`${base}/run/${encodeURIComponent(step.requirement.exercise_id)}?intent=practice&program=${encodeURIComponent(program.id)}&step=${encodeURIComponent(step.id)}`);
  const challengeStep = (step) => navigate(`${base}/run/${encodeURIComponent(step.requirement.exercise_id)}?intent=challenge&program=${encodeURIComponent(program.id)}&step=${encodeURIComponent(step.id)}`);
  return (
    <section className="piano-exercises piano-exercises--program">
      <PageHeader
        eyebrow={active?.required ? 'Required program' : 'Learning program'}
        title={program.title}
        subtitle={program.description ?? program.subtitle}
        onBack={() => navigate(base)}
        action={isPersistentUser(currentUser) && !active?.required ? (
          <button type="button" className="piano-exercises__quiet-action" disabled={busy} onClick={changeEnrollment}>
            {active ? 'Leave program' : 'Start program'}
          </button>
        ) : null}
      />
      <div className="piano-exercises__program-summary">
        <Progress value={program.percent} label={`${program.passed_steps} of ${program.total_steps} passed`} />
        <p>Pass each exercise to open the next. Return to any completed step whenever you want to sharpen it.</p>
      </div>
      {currentStep && (
        <section className="piano-exercises__current-step" aria-labelledby="current-exercise-title">
          <span className="piano-exercises__current-number">{currentStep.order}</span>
          <div>
            <span className="piano-exercises__section-kicker">{currentStep.passed ? 'Program complete' : 'Up next'}</span>
            <h2 id="current-exercise-title">{currentStep.title}</h2>
            <p>{currentStep.subtitle}</p>
          </div>
          <div className="piano-exercises__current-actions">
            <button type="button" className="piano-exercises__quiet-action" onClick={() => practiceStep(currentStep)}>Practice</button>
            {currentStep.state === 'current' && active && isPersistentUser(currentUser) && (
              <button type="button" onClick={() => challengeStep(currentStep)}>Pass at {currentStep.requirement.gates?.pace?.target_bpm ?? 'your pace'} BPM</button>
            )}
          </div>
        </section>
      )}
      <div className="piano-exercises__roadmap-head">
        <div><span className="piano-exercises__section-kicker">Program roadmap</span><h2>Thirty exercises, one clear path</h2></div>
        <span>Tap any open step to practice</span>
      </div>
      <ol className="piano-exercises__roadmap">
        {program.steps.map((step) => (
          <li key={step.id} className={`piano-exercises__roadmap-step is-${step.state}${step.mastered ? ' is-mastered' : ''}`}>
            {step.unlocked ? (
              <button type="button" onClick={() => practiceStep(step)} aria-label={`Step ${step.order}: ${step.title}`}>
                <span>{step.passed ? '✓' : step.order}</span><strong>{step.title}</strong>
              </button>
            ) : (
              <div aria-label={`Step ${step.order}: ${step.title}, locked`}>
                <span>{step.order}</span><strong>{step.title}</strong>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ExerciseDetail() {
  const params = useParams();
  const seedId = params['*'] ? decodeURIComponent(params['*']) : null;
  const navigate = useNavigate();
  const base = useExercisesBase();
  const { currentUser } = usePianoUser();
  const { learning } = useExerciseWorkspace(currentUser || 'guest');
  const [state, setState] = useState({ seed: null, instances: null, error: null });
  const [selection, setSelection] = useState({});
  useEffect(() => {
    let alive = true;
    Promise.all([pianoLearningApi.seed(seedId), pianoLearningApi.instances(seedId)]).then(([seed, instances]) => {
      if (!alive) return;
      if (!seed.ok || !instances.ok) setState({ seed: null, instances: [], error: 'This exercise could not be loaded.' });
      else {
        setState({ seed: seed.data, instances: instances.data.instances, error: null });
        setSelection(instances.data.instances[0]?.axes ?? {});
      }
    });
    return () => { alive = false; };
  }, [seedId]);
  if (state.error) return <PianoEmpty title="Exercise unavailable" hint={state.error} />;
  if (!state.seed || !state.instances) return <SkeletonStage />;
  const axes = Object.keys(state.instances[0]?.axes ?? {});
  const selected = state.instances.find((instance) => axes.every((axis) => String(instance.axes[axis]) === String(selection[axis]))) ?? state.instances[0];
  const activeStep = learning?.programs?.flatMap((program) => program.steps.map((step) => ({ program, step })))
    .find(({ step }) => step.requirement.exercise_id === selected?.id && step.state === 'current');
  return (
    <section className="piano-exercises piano-exercises--detail">
      <PageHeader eyebrow={state.seed.derived?.form ?? 'Exercise'} title={state.seed.title} subtitle={state.seed.subtitle ?? state.seed.focus} onBack={() => navigate(-1)} />
      <div className="piano-exercises__detail-grid">
        <div className="piano-exercises__notation-card"><ExercisePreview instance={selected} /></div>
        <aside className="piano-exercises__variant-panel">
          <dl>
            <div><dt>Focus</dt><dd>{state.seed.focus ?? 'Technique and control'}</dd></div>
            <div><dt>Meter</dt><dd>{selected.meter ?? 'Free'}</dd></div>
            <div><dt>Staff</dt><dd>{selected.staff}</dd></div>
            {selected.tempo && <div><dt>Tempo</dt><dd>{selected.tempo.start_bpm}–{selected.tempo.target_bpm} BPM</dd></div>}
          </dl>
          {axes.map((axis) => {
            const values = [...new Set(state.instances.map((instance) => String(instance.axes[axis])))];
            return <SelectFilter key={axis} label={axis.replace(/_/g, ' ')} value={String(selection[axis])} onChange={(value) => setSelection((current) => ({ ...current, [axis]: value }))} options={values.map((value) => ({ id: value, label: value.replace(/-/g, ' ') }))} />;
          })}
          <p className="piano-exercises__variant-description">{describeInstance(selected)}</p>
          <div className="piano-exercises__detail-actions">
            {(selected.supports ?? state.seed.supports ?? ['free']).map((mode) => (
              <button key={mode} type="button" className="piano-exercises__quiet-action" onClick={() => navigate(`${base}/run/${encodeURIComponent(selected.id)}?intent=practice&mode=${encodeURIComponent(mode)}`)}>
                {mode === 'free' ? 'Practice free' : mode === 'metronome' ? 'With metronome' : 'Cued practice'}
              </button>
            ))}
            {activeStep && isPersistentUser(currentUser) && <button type="button" onClick={() => navigate(`${base}/run/${encodeURIComponent(selected.id)}?intent=challenge&program=${encodeURIComponent(activeStep.program.id)}&step=${encodeURIComponent(activeStep.step.id)}`)}>Pass challenge</button>}
          </div>
        </aside>
      </div>
    </section>
  );
}

/**
 * The one host that arrives through a QUERY STRING, serving three children who
 * need three different answers to "why is this on screen".
 *
 * All three reach the same seam (`AskSession`) with the same plumbing; what
 * differs is the FRAMING CONTEXT this route hands it, which it is uniquely
 * placed to know:
 *
 *  - **practice** says so explicitly, and `framingFor` answers with no line at
 *    all. Saying it is not the same as saying nothing: `null` would let the
 *    session compute a program step's own line, and "Pass this to finish
 *    Exercise 1" is a promise a practice screen does not make — the child
 *    pressed Practice, nothing is judged and nothing gets finished.
 *  - **a video checkpoint** carries its lesson's title in the query (`label`),
 *    because there is nothing for the session to fetch it from: a checkpoint is
 *    not a program step, and the requirement it travels with is authored JSON.
 *  - **a program step** hands down nothing, and the session writes the line
 *    from the step it already fetched for the requirement — one fetch, not two.
 *
 * The route never writes the sentence itself. A finished line arriving in a URL
 * would be a second place a child's words live, and the one place they live is
 * `framingFor`.
 */
function ExerciseRunRoute() {
  const navigate = useNavigate();
  const base = useExercisesBase();
  const params = useParams();
  const [query] = useSearchParams();
  const instanceId = params['*'] ? decodeURIComponent(params['*']) : null;
  const returnTo = query.get('return');
  const requirementText = query.get('requirement');
  const requirementOverride = useMemo(() => {
    try { return requirementText ? JSON.parse(requirementText) : null; } catch { return null; }
  }, [requirementText]);
  const requestedMode = ['free', 'metronome', 'cued'].includes(query.get('mode')) ? query.get('mode') : 'free';
  const intent = query.get('intent') === 'challenge' ? 'challenge' : 'practice';
  const label = query.get('label');
  const framing = useMemo(() => {
    if (intent !== 'challenge') return { kind: 'practice' };
    return label ? { kind: 'lesson', lessonLabel: label } : null;
  }, [intent, label]);
  return (
    <AskSession
      instanceId={instanceId}
      intent={intent}
      practiceMode={requestedMode}
      programId={query.get('program')}
      stepId={query.get('step')}
      requirementOverride={requirementOverride}
      framing={framing}
      onExit={() => navigate(-1)}
      onPassed={() => returnTo ? navigate(returnTo) : query.get('program') ? navigate(`${base}/program/${encodeURIComponent(query.get('program'))}`) : navigate(base)}
    />
  );
}

function Progress({ value, label }) {
  return <div className="piano-exercises__progress"><div><span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div><small>{label}</small></div>;
}

function SelectFilter({ label, value, onChange, options }) {
  return (
    <label className="piano-exercises__select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

export default Exercises;
