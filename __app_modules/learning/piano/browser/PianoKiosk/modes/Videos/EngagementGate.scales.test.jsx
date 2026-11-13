import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidiNotes: () => ({ activeNotes: new Map() }) }));
const drillProps = vi.hoisted(() => ({ last: null }));
vi.mock('./LessonDrill.jsx', () => ({
  default: (props) => {
    drillProps.last = props;
    return (
      <div data-testid="checkin-drill">
        <button type="button" onClick={() => props.onRepPassed?.(1)}>rep</button>
        <button type="button" onClick={() => props.onComplete?.()}>all-scales</button>
      </div>
    );
  },
}));
const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => log }) }));

import EngagementGate from './EngagementGate.jsx';
import {
  CHECKIN_NOTE, CHECKIN_ONE_SCALE, CHECKIN_TWO_SCALES, CHECKIN_HANDS_TOGETHER, CHECKIN_TWO_HANDS_TOGETHER,
} from './lessonCreditCopy.js';
import { checkInStepFor, ladderConfig } from '../../../../portable/practice/presenceLadder.mjs';

const stepAt = (r, o = {}) => checkInStepFor(r, o, ladderConfig());

describe('EngagementGate steps', () => {
  it('the note step shows the note copy', () => {
    render(<EngagementGate open step={stepAt(0)} onDismiss={vi.fn()} />);
    expect(screen.getByText(CHECKIN_NOTE)).toBeTruthy();
  });

  it('one scale: exact copy, a 1-set check-in drill, dismiss only when every scale passed', () => {
    const onDismiss = vi.fn();
    render(<EngagementGate open step={stepAt(1)} onDismiss={onDismiss} rotation={0} />);
    expect(screen.getByText(CHECKIN_ONE_SCALE)).toBeTruthy();
    expect(drillProps.last.drill.spec).toMatchObject({ kind: 'exercise', collection: 'scales', sets: 1, reps: 1 });
    expect(drillProps.last.variant).toBe('checkin');
    fireEvent.click(screen.getByText('rep'));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('all-scales'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/\/10|score|%/i);
  });

  it('two scales: exact copy and a 2-set drill', () => {
    render(<EngagementGate open step={stepAt(2)} onDismiss={vi.fn()} />);
    expect(screen.getByText(CHECKIN_TWO_SCALES)).toBeTruthy();
    expect(drillProps.last.drill.spec.sets).toBe(2);
    expect(drillProps.last.drill.reps).toBe(2);
  });

  it('rotates the given roots and logs which roots it asked for', () => {
    log.info.mockReset();
    render(<EngagementGate open step={stepAt(1, { scaleIndex: 1 })} onDismiss={vi.fn()} roots={['C', 'G', 'F']} rotation={1} rootsSource="default" />);
    expect(drillProps.last.drill.spec.roots[0]).toBe('G');
    expect(log.info).toHaveBeenCalledWith('piano.engagement-gate.scale-roots', { roots: ['G', 'F', 'C'], source: 'default', count: 1, scaleIndex: 1, rung: 1 });
  });

  it.each([
    [1, CHECKIN_ONE_SCALE, ['R'], 1],
    [2, CHECKIN_TWO_SCALES, ['R', 'L'], 2],
    [3, CHECKIN_HANDS_TOGETHER, ['RL'], 1],
    [4, CHECKIN_TWO_HANDS_TOGETHER, ['RL', 'RL'], 2],
  ])('rung %i: its own heading, hands and reps', (rung, heading, hands, reps) => {
    log.info.mockReset();
    render(<EngagementGate open step={stepAt(rung)} onDismiss={vi.fn()} roots={['C', 'G', 'F']} />);
    expect(screen.getByText(heading)).toBeTruthy();
    expect(drillProps.last.drill.spec.hands).toEqual(hands);
    expect(drillProps.last.drill.reps).toBe(reps);
    expect(drillProps.last.drill.spec.direction).toBe('up-then-down');
    expect(log.info).toHaveBeenCalledWith('piano.engagement-gate.scale-roots', expect.objectContaining({ rung }));
  });

  it('the hands-together copy is exact (R10)', () => {
    expect(CHECKIN_HANDS_TOGETHER).toBe('Both hands together this time — one scale up and back down, then the lesson carries on.');
    expect(CHECKIN_TWO_HANDS_TOGETHER).toBe('Two scales with both hands together — then back to the lesson.');
  });
});
