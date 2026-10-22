import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock("../../schoolApi.js", () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn() },
}));
const { schoolApi } = await import("../../schoolApi.js");
const WeekGrid = (await import("./WeekGrid.jsx")).default;

const ok = (data) => ({ ok: true, status: 200, data });
const END = '2026-10-21';
const GRADED = '2026-10-20';

beforeEach(() => {
  schoolApi.agendaPreview.mockReset();
  schoolApi.teacherDay.mockReset();
  schoolApi.agendaPreview.mockImplementation(async (learnerId, studyDay) => ok({ sections: [
    { subject: 'math', next: { unitId: `m-${studyDay}`, title: 'Fractions' } },
  ] }));
  schoolApi.teacherDay.mockImplementation(async (studyDay) => ok({ learners: [
    { learnerId: 'learner-a', sessions: studyDay === GRADED
      ? [{ sessionId: 's1', subject: 'math', unitId: `m-${studyDay}`, effectiveScore: { correctCount: 9, totalCount: 10, percent: 90 } }]
      : [], processedToday: [] },
    { learnerId: 'learner-b', sessions: [], processedToday: [] },
  ] }));
});

const mount = (props = {}) => render(
  <WeekGrid learnerId="learner-a" endDay={END} selectedDay={END} onSelectDay={vi.fn()} {...props} />,
);

describe('WeekGrid', () => {
  it('reads each of the seven days once, with the Day record\'s own two reads', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByRole('button', { pressed: false }).length).toBeGreaterThan(0));
    expect(schoolApi.agendaPreview).toHaveBeenCalledTimes(7);
    expect(schoolApi.teacherDay).toHaveBeenCalledTimes(7);
    expect(schoolApi.agendaPreview).toHaveBeenCalledWith('learner-a', '2026-10-15');
  });

  it('waits for the Day record to go first: nothing is read in the mounting frame', () => {
    mount();
    expect(schoolApi.agendaPreview).not.toHaveBeenCalled();
    expect(schoolApi.teacherDay).not.toHaveBeenCalled();
  });

  it('reads at most three days at once (six GETs, the browser\'s per-host socket count)', async () => {
    let inFlight = 0;
    let peak = 0;
    const pending = [];
    schoolApi.agendaPreview.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => pending.push(() => { inFlight -= 1; resolve(ok({ sections: [] })); }));
    });
    mount();
    await waitFor(() => expect(schoolApi.agendaPreview).toHaveBeenCalledTimes(3));
    // Release one day at a time; a fourth never starts until one finishes.
    while (pending.length) {
      expect(inFlight).toBeLessThanOrEqual(3);
      pending.shift()();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(schoolApi.agendaPreview).toHaveBeenCalledTimes(7);
    expect(peak).toBe(3);
  });

  it('has a column button for each of the seven days, today pressed', async () => {
    mount();
    await screen.findByText('Wed 21');
    const days = screen.getAllByRole('columnheader').flatMap((th) => within(th).queryAllByRole('button'));
    expect(days).toHaveLength(7);
    expect(days[6]).toHaveAttribute('aria-pressed', 'true');
    expect(days[6]).toHaveAccessibleName(/Wednesday, Oct 21/);
  });

  it('opens a day when its column is chosen', async () => {
    const onSelectDay = vi.fn();
    mount({ onSelectDay });
    fireEvent.click(await screen.findByRole('button', { name: /^Tuesday, Oct 20/ }));
    expect(onSelectDay).toHaveBeenCalledWith(GRADED);
  });

  it('shows a graded day\'s percent, and names the subject in words', async () => {
    mount();
    expect(await screen.findByText('90%')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Math/ })).toBeInTheDocument();
    expect(screen.queryByText('math')).toBeNull();
  });

  it('marks a day it could not read instead of hiding it', async () => {
    schoolApi.teacherDay.mockImplementation(async (studyDay) => (studyDay === '2026-10-19'
      ? { ok: false, status: 500, data: null }
      : ok({ learners: [{ learnerId: 'learner-a', sessions: [], processedToday: [] }] })));
    mount();
    expect(await screen.findByRole('button', { name: /^Monday, Oct 19, couldn.t load/i })).toBeInTheDocument();
  });
});
