import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgendaStatusBoard from "./AgendaStatusBoard.jsx";
import { dayOffTitle, summarize } from "./agendaStatusModel.js";

vi.mock("../schoolApi.js", () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn(), stateGates: vi.fn(), earningsRoster: vi.fn(), wallet: vi.fn() },
}));
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", () => ({
  useWebSocketSubscription: () => {},
}));
import { schoolApi } from "../schoolApi.js";

const kids = [{ id: 'learner1', name: 'Learner One' }];
const excused = (subject, reason, next = { unitId: `${subject}.next` }) => ({
  subject, next, obligation: { state: 'excused', reason },
});
const digest = { ok: true, data: { studyDay: '2026-11-11', learners: [{ learnerId: 'learner1', sessions: [] }] } };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  schoolApi.stateGates.mockResolvedValue({ ok: false });
  schoolApi.teacherDay.mockResolvedValue(digest);
});

describe('naming the day off', () => {
  it('titles each tier, and nothing for a normal-tier day', () => {
    expect(dayOffTitle({ tier: 'stay-home', label: 'Veterans Day' })).toBe('Veterans Day — stay-home day');
    expect(dayOffTitle({ tier: 'enrichment', label: 'Veterans Day' })).toBe('Veterans Day — stay-home day');
    expect(dayOffTitle({ tier: 'major-holiday', label: 'Thanksgiving' })).toBe('Thanksgiving — holiday');
    expect(dayOffTitle({ tier: 'away', label: 'Christmas break' })).toBe('Christmas break — no school');
    expect(dayOffTitle({ tier: 'away', label: null })).toBe('No school today');
    expect(dayOffTitle({ tier: 'normal', label: 'Thanksgiving Eve' })).toBeNull();
    expect(dayOffTitle(null)).toBeNull();
  });

  it('a household day off is a rest day, not an empty plan', () => {
    const summary = summarize([excused('math', 'household_calendar')], [], [], null, null, { tier: 'away', label: 'Christmas break' });
    expect(summary.restDay).toEqual({ optionalCount: 1 });
    expect(summary.dayOff).toEqual({ tier: 'away', label: 'Christmas break' });
    expect(summarize([excused('math', 'day_off')], []).restDay).toEqual({ optionalCount: 1 });
  });

  it('an away day reads "<label> — no school", never "No plan to show"', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: {
      sections: [excused('math', 'household_calendar'), excused('language', 'household_calendar')], entries: [],
      dayOff: { tier: 'away', label: 'Christmas break' },
    } });
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByText('Christmas break — no school')).toBeInTheDocument();
    expect(screen.queryByText('No plan to show')).toBeNull();
  });

  it('a stay-home day shows the kept disc and names the day', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: {
      sections: [
        { subject: 'scripture', next: { unitId: 'cfm.1' }, obligation: { state: 'obligated', reason: null } },
        excused('math', 'day_off'),
      ],
      entries: [{ unitId: 'cfm.1', subject: 'scripture', title: 'Psalms' }],
      dayOff: { tier: 'stay-home', label: 'Veterans Day' },
    } });
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByText('Veterans Day — stay-home day')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '0 of 1 done');
  });

  it('a pinned past unlabelled away day says No school, not No school today', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: {
      sections: [excused('math', 'household_calendar')], entries: [], dayOff: { tier: 'away', label: null },
    } });
    render(<AgendaStatusBoard kids={kids} day="2026-11-04" />);
    expect(await screen.findByText('No school')).toBeInTheDocument();
  });

  it('a plain weekend still says No school today', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: {
      sections: [excused('math', 'not_a_school_day')], entries: [], dayOff: null,
    } });
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByText('No school today')).toBeInTheDocument();
  });
});
