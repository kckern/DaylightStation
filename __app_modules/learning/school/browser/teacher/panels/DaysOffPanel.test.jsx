import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DaysOffPanel from "./DaysOffPanel.jsx";
import { schoolApi } from "../../schoolApi.js";

vi.mock("../../schoolApi.js", () => ({ schoolApi: { calendar: vi.fn(), putCalendar: vi.fn() } }));
vi.mock("../TeacherProfileContext.jsx", () => ({
  useTeacherProfileOptional: () => ({ currentTeacher: { id: 'teacher-a', name: 'Teacher A' } }),
  useTeacherProfile: () => ({
    currentTeacher: { id: 'teacher-a', name: 'Teacher A' },
    teachers: [{ id: 'teacher-a', name: 'Teacher A' }],
    openPicker: vi.fn(), pickerOpen: false,
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
  }),
}));

const ok = (data) => ({ ok: true, status: 200, data });
const MODEL = {
  revision: 'rev-1', today: '2026-11-11',
  except: [
    { from: '2026-09-07', to: '2026-09-07', label: 'Labor Day', tier: 'away' },
    { from: '2026-11-08', to: '2026-11-14', label: 'Family trip', tier: 'away' },
    { from: '2026-11-26', to: '2026-11-26', label: 'Thanksgiving', tier: 'major-holiday', assignment: 'holiday-thanksgiving' },
  ],
  also: [], dayOffTiers: null,
  effectivePolicy: { 'stay-home': { keep: [{ subject: 'scripture' }] }, enrichment: { keep: [] }, 'major-holiday': { keep: [{ subject: 'scripture' }] }, away: { keep: [] } },
  tiers: ['normal', 'stay-home', 'enrichment', 'major-holiday', 'away'],
  subjects: ['scripture', 'science', 'civilization'], programs: ['story-time'],
  activities: { 'holiday-thanksgiving': { unitId: 'holiday-thanksgiving', title: 'Thanksgiving activity', instructions: '', placeholder: true, editable: true } },
};
const KIDS = [{ id: 'kid1', name: 'Kid One' }];

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.calendar.mockResolvedValue(ok(MODEL));
  schoolApi.putCalendar.mockResolvedValue(ok({ revision: 'rev-2' }));
});

describe('DaysOffPanel', () => {
  it('lists upcoming breaks and folds the past away until asked', async () => {
    render(<DaysOffPanel kids={KIDS} />);
    expect(await screen.findByText('Thanksgiving')).toBeInTheDocument();
    expect(screen.getByText('Family trip')).toBeInTheDocument();
    expect(screen.getByText('Thanksgiving activity')).toBeInTheDocument();
    expect(screen.queryByText('Labor Day')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Past breaks (1)' }));
    expect(screen.getByText('Labor Day')).toBeInTheDocument();
  });

  it('saves a quick away trip with the loaded revision, past breaks untouched', async () => {
    render(<DaysOffPanel kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add an away trip' }));
    fireEvent.change(screen.getByLabelText('Trip starts'), { target: { value: '2026-12-28' } });
    fireEvent.change(screen.getByLabelText('Trip ends'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Trip name'), { target: { value: 'Grandparents' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save trip' }));
    await waitFor(() => expect(schoolApi.putCalendar).toHaveBeenCalledTimes(1));
    const body = schoolApi.putCalendar.mock.calls[0][0];
    expect(body.baseRevision).toBe('rev-1');
    expect(body.editedBy).toBe('teacher-a');
    expect(body.except).toContainEqual({ from: '2026-12-28', to: '2026-12-31', label: 'Grandparents', tier: 'away' });
    expect(body.except).toContainEqual(MODEL.except[0]);
  });

  it('a break under way can only move its end', async () => {
    render(<DaysOffPanel kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit days off' }));
    expect(screen.getByLabelText('Starts Family trip')).toBeDisabled();
    expect(screen.getByLabelText('Ends Family trip')).not.toBeDisabled();
    expect(screen.getByLabelText('Starts Thanksgiving')).not.toBeDisabled();
  });

  it('an enrichment day with no subject is caught before any write', async () => {
    render(<DaysOffPanel kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit days off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a break' }));
    fireEvent.change(screen.getByLabelText('Name of new break'), { target: { value: 'Science fair' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enrichment' }).at(-1));
    fireEvent.change(screen.getByLabelText('Activity title for Science fair'), { target: { value: 'Volcano' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/pick the subject it replaces/)).toBeInTheDocument();
    expect(schoolApi.putCalendar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Subject replaced on Science fair'), { target: { value: 'science' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(schoolApi.putCalendar).toHaveBeenCalledTimes(1));
    const body = schoolApi.putCalendar.mock.calls[0][0];
    expect(body.except).toContainEqual(expect.objectContaining({ label: 'Science fair', tier: 'enrichment', replaces: 'science', assignment: 'holiday-science-fair' }));
    expect(body.activities).toContainEqual({ unitId: 'holiday-science-fair', title: 'Volcano', instructions: '' });
    expect(body.assignTo).toEqual(['kid1']);
  });

  it('edits the holiday activity text', async () => {
    render(<DaysOffPanel kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit days off' }));
    fireEvent.change(screen.getByLabelText('Activity title for Thanksgiving'), { target: { value: 'Gratitude list' } });
    fireEvent.change(screen.getByLabelText('Activity instructions for Thanksgiving'), { target: { value: 'Write five things.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(schoolApi.putCalendar).toHaveBeenCalled());
    expect(schoolApi.putCalendar.mock.calls[0][0].activities).toEqual([
      { unitId: 'holiday-thanksgiving', title: 'Gratitude list', instructions: 'Write five things.' },
    ]);
  });

  it('a keep-list edit sends every tier list', async () => {
    render(<DaysOffPanel kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit days off' }));
    fireEvent.click(screen.getByRole('button', { name: 'What a day off keeps…' }));
    fireEvent.change(screen.getByLabelText('Keep on Stay home days'), { target: { value: 'program:story-time' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(schoolApi.putCalendar).toHaveBeenCalled());
    expect(schoolApi.putCalendar.mock.calls[0][0].dayOffTiers).toEqual({
      'stay-home': { keep: [{ subject: 'scripture' }, { program: 'story-time' }] },
      enrichment: { keep: [] }, 'major-holiday': { keep: [{ subject: 'scripture' }] }, away: { keep: [] },
    });
  });

  it('shows the server refusal', async () => {
    schoolApi.putCalendar.mockResolvedValue({ ok: false, status: 409, data: { error: 'Someone changed the calendar since you opened it — reload and try again.' } });
    render(<DaysOffPanel kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit days off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Someone changed the calendar/)).toBeInTheDocument();
  });
});
