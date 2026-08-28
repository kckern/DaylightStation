/**
 * The panel could only ever reach work a MACHINE had recorded answers for: it
 * listed `attempts-summary` rows and nothing else. A program-served lesson,
 * paper a grown-up marked by hand, a launch outcome — none of it appeared, so
 * none of it could be given back to the child who actually did it, and the day
 * it happened on was not even offerable in the picker.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ReassignPanel from './ReassignPanel.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    attemptDays: vi.fn(),
    attemptsSummary: vi.fn(),
    learnerSessions: vi.fn(),
    curriculumUnits: vi.fn(),
    reassign: vi.fn(),
    reassignSession: vi.fn(),
  },
}));
vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'kckern', name: 'KC' },
    pin: null,
    openPicker: vi.fn(),
    openPinPrompt: vi.fn(),
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
    pinPromptOpen: false,
    pickerOpen: false,
  }),
}));
import { schoolApi } from '../../schoolApi.js';

const KIDS = [{ id: 'learner-a', name: 'Learner A' }, { id: 'learner-b', name: 'Learner B' }];
const ok = (data) => ({ ok: true, status: 200, data });

/** A quiz with recorded answers, and a program lesson with none. */
const seed = ({ sessions = null } = {}) => {
  schoolApi.attemptDays.mockResolvedValue(ok({ days: ['2026-08-26'] }));
  // EVERY seeded unit is named. A catalog that knows only one of them makes the
  // other rows render 'Lesson title unavailable', and an assertion that the
  // quiz/other-day rows are absent then passes because their titles never
  // existed — not because the filters work.
  schoolApi.curriculumUnits.mockResolvedValue(ok({ units: [
    { unitId: 'korean.day-12', title: 'Korean — day 12', courseId: 'korean', courseTitle: 'Korean' },
    { unitId: 'korean.day-11', title: 'Korean — day 11', courseId: 'korean', courseTitle: 'Korean' },
    { unitId: 'creatures.01', title: 'Creatures — lesson 1', courseId: 'creatures', courseTitle: 'Creatures' },
  ] }));
  schoolApi.attemptsSummary.mockResolvedValue(ok({ assessments: [
    { assessmentId: 'ses_quiz', count: 8, title: 'Creature Quiz 1' },
  ] }));
  // `ses_program` is an EVENING lesson: opened 2026-08-26 after 17:00 PDT, so
  // its UTC `day` is the 27th while the household's study day is still the
  // 26th. Bucketing by `day` would file it under a date the child never worked.
  schoolApi.learnerSessions.mockResolvedValue(ok({ sessions: sessions ?? [
    { sessionId: 'ses_quiz', unitId: 'creatures.01', state: 'rewarded', day: '2026-08-26', studyDay: '2026-08-26' },
    { sessionId: 'ses_program', unitId: 'korean.day-12', state: 'rewarded', day: '2026-08-27', studyDay: '2026-08-26' },
    { sessionId: 'ses_other_day', unitId: 'korean.day-11', state: 'rewarded', day: '2026-08-25', studyDay: '2026-08-25' },
  ] }));
  schoolApi.reassignSession.mockResolvedValue(ok({ sessionId: 'ses_program', toLearnerId: 'learner-b' }));
};

const loadTheDay = async (d = '2026-08-26') => {
  await waitFor(() => expect(screen.getByText(d)).toBeTruthy());
  fireEvent.click(screen.getByText(d));
  fireEvent.click(screen.getByText('Load that day'));
};

describe('ReassignPanel — work with no machine attempts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists a lesson with no recorded answers and moves it, with a reason, to the sibling', async () => {
    seed();
    render(<ReassignPanel learnerId="learner-a" learnerName="Learner A" kids={KIDS} />);
    await loadTheDay();

    // The quiz stays in the attempts list; the program lesson appears in its
    // own list, named rather than shown as a raw unit id.
    await waitFor(() => expect(screen.getByText('Korean — day 12')).toBeTruthy());
    expect(screen.getByText('Creature Quiz 1')).toBeTruthy();
    // EXACTLY ONE movable session row. `ses_quiz` is covered by the attempts
    // list above and `ses_other_day` belongs to another day; both units are in
    // the catalog, so if either filter were dropped its title would render here
    // and this count would be 2 or 3.
    const sessionRows = screen.getAllByText('Re-credit').map((b) => b.closest('li'));
    expect(sessionRows).toHaveLength(1);
    expect(within(sessionRows[0]).getByText('Korean — day 12')).toBeTruthy();
    expect(screen.queryByText('Creatures — lesson 1')).toBeNull();
    expect(screen.queryByText('Korean — day 11')).toBeNull();

    const row = sessionRows[0];
    const recredit = within(row).getByText('Re-credit');
    // No target and no reason: the verb is not offerable yet.
    expect(recredit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Move to'), { target: { value: 'learner-b' } });
    expect(recredit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Learner B sat at the wrong station' } });
    expect(recredit.disabled).toBe(false);

    fireEvent.click(recredit);
    await waitFor(() => expect(schoolApi.reassignSession).toHaveBeenCalledWith({
      sessionId: 'ses_program',
      toLearnerId: 'learner-b',
      reason: 'Learner B sat at the wrong station',
      reassignedBy: 'kckern',
      pin: null,
    }));
    // The attempt-event repair is a different verb over different evidence and
    // must not be called by this one.
    expect(schoolApi.reassign).not.toHaveBeenCalled();
  });

  it('offers a day whose only work was program-served — no attempts, so `attempt-days` never names it', async () => {
    seed();
    schoolApi.attemptDays.mockResolvedValue(ok({ days: [] }));
    schoolApi.attemptsSummary.mockResolvedValue(ok({ assessments: [] }));
    schoolApi.learnerSessions.mockResolvedValue(ok({ sessions: [
      { sessionId: 'ses_program', unitId: 'korean.day-12', state: 'rewarded', day: '2026-08-26' },
    ] }));
    render(<ReassignPanel learnerId="learner-a" learnerName="Learner A" kids={KIDS} />);
    await loadTheDay();
    await waitFor(() => expect(screen.getByText('Korean — day 12')).toBeTruthy());
    expect(screen.queryByText('No recorded work that day.')).toBeNull();
  });

  it('says so when the day’s lessons could not be read, instead of showing an empty list', async () => {
    seed();
    schoolApi.learnerSessions.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<ReassignPanel learnerId="learner-a" learnerName="Learner A" kids={KIDS} />);
    await loadTheDay();
    await waitFor(() => expect(screen.getByText(/only recorded answers are listed/)).toBeTruthy());
    // The half that DID load is still usable.
    expect(screen.getByText('Creature Quiz 1')).toBeTruthy();
  });

  it('keeps the recent-days picker — typing dates blind was a fixed defect', async () => {
    seed();
    render(<ReassignPanel learnerId="learner-a" learnerName="Learner A" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('2026-08-26')).toBeTruthy());
    expect(schoolApi.attemptDays).toHaveBeenCalledWith('learner-a');
    expect(screen.getByText('2026-08-25')).toBeTruthy();
  });

  it('buckets an evening lesson by its study day, not by the UTC date it was opened', async () => {
    // `ses_program` carries day 2026-08-27 / studyDay 2026-08-26. Reading `day`
    // would offer a 27th button that no work belongs to and hide the lesson
    // from the 26th — the day the child actually did it, and the day the child
    // is told about in their own note.
    seed();
    render(<ReassignPanel learnerId="learner-a" learnerName="Learner A" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('2026-08-26')).toBeTruthy());
    expect(screen.queryByText('2026-08-27')).toBeNull();
    await loadTheDay('2026-08-26');
    await waitFor(() => expect(screen.getByText('Korean — day 12')).toBeTruthy());
  });

  it('falls back to ids and says so when lesson names could not be loaded', async () => {
    // Every row reading 'Lesson title unavailable' beside a live Re-credit
    // button is how a grown-up moves the wrong lesson.
    seed();
    schoolApi.curriculumUnits.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<ReassignPanel learnerId="learner-a" learnerName="Learner A" kids={KIDS} />);
    await loadTheDay();
    await waitFor(() => expect(screen.getByText('korean.day-12')).toBeTruthy());
    expect(screen.getByText(/Lesson names couldn’t be loaded/)).toBeTruthy();
    expect(screen.queryByText('Lesson title unavailable')).toBeNull();
  });
});
