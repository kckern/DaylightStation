import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DebriefsPanel from "./DebriefsPanel.jsx";

const api = vi.hoisted(() => ({ teacherDebriefs: vi.fn(), teacherDebriefAction: vi.fn() }));
const profile = vi.hoisted(() => ({ current: { currentTeacher: { id: 'parent' } } }));
vi.mock("../../schoolApi.js", () => ({ schoolApi: api }));
vi.mock("../TeacherProfileContext.jsx", () => ({ useTeacherProfileOptional: () => profile.current }));
vi.mock("../useTeacherWrite.js", () => ({
  useTeacherWrite: () => ({
    run: (_k, call, { onSuccess } = {}) => call({ actorId: 'parent' }).then((r) => { if (r?.ok) onSuccess?.(r.data); return !!r?.ok; }),
    busy: null, errors: {},
  }),
}));

const ok = (data) => ({ ok: true, status: 200, data });
const DAY = { studyDay: '2026-10-21', phase: 'completed', late: false, questioner: 'fallback', substance: null,
  entries: { learned: { text: 'fractions', audioRef: 'test-learner/2026-10-21-1.webm' } },
  questions: [{ id: 'q1', kind: 'choice', prompt: 'Which?', options: ['a', 'b'], answer: 'a' }], answers: { q1: { response: 'b', correct: false } },
  summary: { substance: null, substantive: false, quiz: { right: 0, graded: 1 } } };

describe('DebriefsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profile.current = { currentTeacher: { id: 'parent' } };
    api.teacherDebriefs.mockResolvedValue(ok({ days: [DAY] }));
    api.teacherDebriefAction.mockResolvedValue(ok({ phase: 'completed' }));
  });
  it('lists days with entry, answers and audio (teacher id on the request and audio src)', async () => {
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    expect(await screen.findByText('fractions')).toBeInTheDocument();
    expect(screen.getByText(/0 of 1/)).toBeInTheDocument();
    expect(api.teacherDebriefs).toHaveBeenCalledWith('test-learner', 'parent');
    expect(document.querySelector('audio').getAttribute('src'))
      .toBe('/api/v1/school/debrief/teacher/test-learner/audio/2026-10-21-1.webm?by=parent');
  });
  it('re-score is offered only on a fallback day; actions call the API with the actor', async () => {
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    fireEvent.click(await screen.findByRole('button', { name: /re-score/i }));
    await waitFor(() => expect(api.teacherDebriefAction).toHaveBeenCalledWith('test-learner', '2026-10-21', 'rescore', expect.objectContaining({ by: 'parent' })));
  });
  it('no re-score on a non-fallback day', async () => {
    api.teacherDebriefs.mockResolvedValue(ok({ days: [{ ...DAY, questioner: 'llm' }] }));
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    await screen.findByText('fractions');
    expect(screen.queryByRole('button', { name: /re-score/i })).toBeNull();
  });
  it('excuse sends the typed reason', async () => {
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: 'sick' } });
    fireEvent.click(screen.getByRole('button', { name: /excuse/i }));
    await waitFor(() => expect(api.teacherDebriefAction).toHaveBeenCalledWith('test-learner', '2026-10-21', 'excuse', { by: 'parent', reason: 'sick' }));
  });
  it('clears the reason after a successful action, and keeps it after a failed one', async () => {
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    const field = await screen.findByLabelText(/reason/i);
    api.teacherDebriefAction.mockResolvedValueOnce({ ok: false, status: 500, data: null });
    fireEvent.change(field, { target: { value: 'sick' } });
    fireEvent.click(screen.getByRole('button', { name: /excuse/i }));
    await waitFor(() => expect(api.teacherDebriefAction).toHaveBeenCalledTimes(1));
    expect(field).toHaveValue('sick');
    fireEvent.click(screen.getByRole('button', { name: /excuse/i }));
    await waitFor(() => expect(field).toHaveValue(''));
    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    await waitFor(() => expect(api.teacherDebriefAction).toHaveBeenLastCalledWith('test-learner', '2026-10-21', 'reject', { by: 'parent', reason: null }));
  });
  const RICH = { ...DAY, substance: undefined, level: 3, levelReason: 'named a cause', hook: 'Ask about the furnace workshop',
    probes: [{ prompt: 'Why hot?', text: 'the fire' }, { prompt: 'Who ran it?', text: null }], discussedAt: null };
  it('shows level/5 with its reason, the hook, and each probe with its reply', async () => {
    api.teacherDebriefs.mockResolvedValue(ok({ days: [RICH] }));
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    expect(await screen.findByText(/detail 3\/5/)).toBeInTheDocument();
    expect(screen.getByText(/named a cause/)).toBeInTheDocument();
    expect(screen.getByText('Talk about: Ask about the furnace workshop')).toBeInTheDocument();
    expect(screen.getByText(/Why hot\?/)).toBeInTheDocument();
    expect(screen.getByText('the fire')).toBeInTheDocument();
    expect(screen.getByText(/Who ran it\?/)).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
  it('a day the child has not finished offers no "We talked about it"', async () => {
    api.teacherDebriefs.mockResolvedValue(ok({ days: [{ ...RICH, studyDay: '2026-10-22', phase: 'not-started', entries: { learned: { text: 'fractions' } }, questions: null, answers: {}, summary: null }] }));
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    await screen.findByText('fractions');
    expect(screen.queryByRole('button', { name: /we talked about it/i })).toBeNull();
  });
  it('a completed day offers "We talked about it"', async () => {
    api.teacherDebriefs.mockResolvedValue(ok({ days: [RICH] }));
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    expect(await screen.findByRole('button', { name: /we talked about it/i })).toBeInTheDocument();
  });
  it('legacy day still shows detail substance/10', async () => {
    api.teacherDebriefs.mockResolvedValue(ok({ days: [{ ...DAY, substance: 7 }] }));
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    expect(await screen.findByText(/detail 7\/10/)).toBeInTheDocument();
  });
  it('We talked about it posts discussed without the typed reason', async () => {
    api.teacherDebriefs.mockResolvedValue(ok({ days: [RICH] }));
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: 'sick' } });
    fireEvent.click(screen.getByRole('button', { name: /we talked about it/i }));
    await waitFor(() => expect(api.teacherDebriefAction).toHaveBeenCalledWith('test-learner', '2026-10-21', 'discussed', { by: 'parent', reason: null }));
    await waitFor(() => expect(api.teacherDebriefs).toHaveBeenCalledTimes(2));
  });
  it('a discussed day shows Talked about and no button', async () => {
    api.teacherDebriefs.mockResolvedValue(ok({ days: [{ ...RICH, discussedAt: '2026-10-22T01:00:00Z' }] }));
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    expect(await screen.findByText('Talked about ✓')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /we talked about it/i })).toBeNull();
  });
  it('without a current teacher it asks for one and fires no request', () => {
    profile.current = { currentTeacher: null };
    render(<DebriefsPanel learnerId="test-learner" learnerName="Test" />);
    expect(screen.getByText(/pick a teacher/i)).toBeInTheDocument();
    expect(api.teacherDebriefs).not.toHaveBeenCalled();
  });
});
