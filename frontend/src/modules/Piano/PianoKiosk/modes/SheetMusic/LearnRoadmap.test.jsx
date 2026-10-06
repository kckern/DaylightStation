import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LearnRoadmap, { CustomLearnSession, LearnPassageSession, learnDrillProjection } from './LearnRoadmap.jsx';

const exercise = vi.hoisted(() => ({ props: null }));
vi.mock('../Exercises/ExerciseRun.jsx', () => ({
  default: (props) => {
    exercise.props = props;
    return <>
      <button type="button" onClick={() => props.onPassed({ verdict: { passed: true } })}>Finish take</button>
      <button type="button" onClick={() => props.onFailed({ verdict: { passed: false } })}>Miss take</button>
    </>;
  },
}));

const passage = {
  id: 'm0-3', order: 1, label: 'Bars 1–4', printedMeasures: [1, 4], playableParts: ['rh', 'lh'],
  complete: false,
  rungs: [
    { id: 'right', label: 'Right hand', effectiveParts: ['rh'], mode: 'free', sets: 2, reps: 3, passCount: 1, required: 6, state: 'current', criteria: { completeness: 1 } },
    { id: 'left', label: 'Left hand', effectiveParts: ['lh'], mode: 'free', sets: 2, reps: 3, passCount: 0, required: 6, state: 'locked', criteria: { completeness: 1 } },
    { id: 'test-out', label: 'Test out', effectiveParts: ['rh', 'lh'], mode: 'cued', sets: 1, reps: 3, passCount: 0, required: 3, state: 'available', consecutive: true, completes: 'passage', criteria: { completeness: 1, placement: 0.8 } },
  ],
};

describe('LearnRoadmap', () => {
  it('offers two-tap bar selection and a reviewable custom practice range', () => {
    const onStartSelection = vi.fn();
    const onPracticeCustom = vi.fn();
    render(<LearnRoadmap passages={[passage]} customRange={{ inMeasure: 2, outMeasure: 6 }}
      onStartSelection={onStartSelection} onPracticeCustom={onPracticeCustom} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select bars' }));
    expect(onStartSelection).toHaveBeenCalled();
    expect(screen.getByText('Bars 3–7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Practice selection' }));
    expect(onPracticeCustom).toHaveBeenCalled();
  });

  it('keeps every passage open while showing completion and recommendation', () => {
    const onSelectPassage = vi.fn();
    render(<LearnRoadmap passages={[passage, { ...passage, id: 'm4-7', order: 2, label: 'Bars 5–8', complete: true }]} recommendedId="m0-3" onSelectPassage={onSelectPassage} />);
    expect(screen.getByRole('button', { name: /Bars 1–4.*Recommended/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Bars 5–8.*Complete/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Bars 5–8/ }));
    expect(onSelectPassage).toHaveBeenCalledWith('m4-7');
  });

  it('locks later normal rungs but leaves Test Out selectable', () => {
    const onSelectRung = vi.fn();
    render(<LearnRoadmap passages={[passage]} selectedId="m0-3" onSelectPassage={() => {}} onSelectRung={onSelectRung} onClosePassage={() => {}} />);
    expect(screen.getByRole('button', { name: /Right hand/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Left hand/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Test out/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Test out/ }));
    expect(onSelectRung).toHaveBeenCalledWith('test-out');
  });
});

describe('CustomLearnSession', () => {
  it('runs the selected bars untimed without banking preset ladder credit', () => {
    const onResult = vi.fn();
    render(<CustomLearnSession score={{ id: 'score-1', musicXml: '<score />' }}
      range={{ inMeasure: 2, outMeasure: 6 }} measures={Array.from({ length: 8 }, (_, i) => ({ number: i + 1 }))}
      activeParts={['rh', 'lh']} onResult={onResult} onBack={() => {}} />);
    expect(exercise.props.score.rangeIndices).toEqual({ start: 2, end: 6 });
    expect(exercise.props.score.activeParts).toEqual(['rh', 'lh']);
    expect(exercise.props.practiceMode).toBe('free');
    expect(exercise.props).toMatchObject({ scoreCursorPolicy: 'always', keyboardHintPolicy: 'after-wrong', surface: 'learn-lab' });
    expect(document.querySelector('.piano-learn-lab__toolbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ verdict: { passed: true } }));
  });
});

describe('LearnPassageSession', () => {
  it('keeps the same score descriptor while its parent rerenders the lab', () => {
    const score = { id: 'score-1', musicXml: '<score />' };
    const props = { score, revision: 'rev', passage, rung: passage.rungs[0], onRecord: () => ({ rungComplete: false }), onBack: () => {} };
    const view = render(<LearnPassageSession {...props} />);
    const first = exercise.props.score;

    view.rerender(<LearnPassageSession {...props} />);

    expect(exercise.props.score).toBe(first);
  });

  it('runs the selected score passage with parts, rubric, and set/rep projection', () => {
    render(<LearnPassageSession score={{ id: 'score-1', musicXml: '<score />' }} revision="rev" passage={passage} rung={passage.rungs[0]} onRecord={() => ({ rungComplete: false })} onBack={() => {}} />);
    expect(exercise.props.score).toMatchObject({ id: 'score-1', measures: [1, 4], activeParts: ['rh'] });
    expect(exercise.props.practiceRequirement).toMatchObject({ mode: 'free', rubric: { criteria: { completeness: 1 } } });
    expect(exercise.props.drillProjection.steps).toHaveLength(2);
    expect(exercise.props.drillProjection.steps[0].pass_count).toBe(1);
  });

  it('runs timed practice at a named, adjustable stage of score tempo', () => {
    const timed = { ...passage.rungs[2], id: 'timed', label: 'With the beat', completion: 'standard', mastery: false, tempoPercent: 60 };
    render(<LearnPassageSession score={{ id: 'score-1', musicXml: '<score />' }} revision="rev" passage={passage} rung={timed}
      tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 100 }], tempoSource: 'musicxml', minimumPercent: 40, maximumPercent: 100, adjustable: true }}
      onRecord={() => ({ rungComplete: false })} onBack={() => {}} />);
    // 09e57927a: named stages replace the raw percentage; 60% reads "Steady".
    expect(screen.getByRole('button', { name: 'Choose tempo: Steady · 60 BPM' })).toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(60);
    fireEvent.click(screen.getByRole('button', { name: 'Choose tempo: Steady · 60 BPM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nearly there' }));
    expect(screen.getByRole('button', { name: 'Choose tempo: Nearly there · 80 BPM' })).toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(80);
  });

  it('locks mastery and Test Out to the MusicXML tempo', () => {
    const mastery = { ...passage.rungs[2], id: 'mastery', label: 'Mastery', mastery: true, tempoPercent: 60 };
    render(<LearnPassageSession score={{ id: 'score-1', musicXml: '<score />' }} revision="rev" passage={passage} rung={mastery}
      tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 92 }], tempoSource: 'musicxml', minimumPercent: 40, maximumPercent: 100, adjustable: true }}
      onRecord={() => ({ rungComplete: false })} onBack={() => {}} />);
    expect(screen.getByText('Full speed · 92 BPM')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose tempo/ })).not.toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(100);
  });

  it('banks a rep and returns to the roadmap when a rung completes', () => {
    vi.useFakeTimers();
    const onRecord = vi.fn(() => ({ rungComplete: true, passage: { complete: false } }));
    const onBack = vi.fn();
    render(<LearnPassageSession score={{ id: 'score-1', musicXml: '<score />' }} revision="rev" passage={passage} rung={passage.rungs[0]} onRecord={onRecord} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ passageId: 'm0-3', rungId: 'right', requiredPasses: 6 }));
    expect(onBack).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    expect(onBack).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('records a failed Test Out take for streak reset and retries in place', () => {
    const testOut = passage.rungs[2];
    const onRecord = vi.fn(() => ({ rungComplete: false, passage: { complete: false } }));
    const onBack = vi.fn();
    render(<LearnPassageSession score={{ id: 'score-1', musicXml: '<score />' }} revision="rev" passage={passage} rung={testOut} onRecord={onRecord} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Miss take' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ consecutive: true, completesPassage: true }));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Finish take' })).toBeInTheDocument();
  });

  it('projects reps across configured sets', () => {
    const projection = learnDrillProjection(passage, { ...passage.rungs[0], passCount: 4 });
    expect(projection.steps.map((step) => [step.pass_count, step.passed, step.state])).toEqual([
      [3, true, 'complete'], [1, false, 'current'],
    ]);
  });
});
