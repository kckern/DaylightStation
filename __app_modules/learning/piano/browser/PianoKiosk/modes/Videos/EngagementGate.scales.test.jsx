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
import { CHECKIN_NOTE, CHECKIN_ONE_SCALE, CHECKIN_TWO_SCALES } from './lessonCreditCopy.js';

describe('EngagementGate steps', () => {
  it('the note step shows the note copy', () => {
    render(<EngagementGate open step={{ kind: 'note' }} onDismiss={vi.fn()} />);
    expect(screen.getByText(CHECKIN_NOTE)).toBeTruthy();
  });

  it('one scale: exact copy, a 1-set check-in drill, dismiss only when every scale passed', () => {
    const onDismiss = vi.fn();
    render(<EngagementGate open step={{ kind: 'scales', count: 1 }} onDismiss={onDismiss} rotation={0} />);
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
    render(<EngagementGate open step={{ kind: 'scales', count: 2 }} onDismiss={vi.fn()} />);
    expect(screen.getByText(CHECKIN_TWO_SCALES)).toBeTruthy();
    expect(drillProps.last.drill.spec.sets).toBe(2);
    expect(drillProps.last.drill.reps).toBe(2);
  });

  it('rotates the given roots and logs which roots it asked for', () => {
    log.info.mockReset();
    render(<EngagementGate open step={{ kind: 'scales', count: 1, scaleIndex: 1 }} onDismiss={vi.fn()} roots={['C', 'G', 'F']} rotation={1} rootsSource="default" />);
    expect(drillProps.last.drill.spec.roots[0]).toBe('G');
    expect(log.info).toHaveBeenCalledWith('piano.engagement-gate.scale-roots', { roots: ['G', 'F', 'C'], source: 'default', count: 1, scaleIndex: 1 });
  });
});
