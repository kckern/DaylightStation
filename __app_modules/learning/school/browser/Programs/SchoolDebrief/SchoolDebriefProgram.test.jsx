import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SchoolDebriefProgram from "./SchoolDebriefProgram.jsx";
const api = vi.hoisted(() => ({}));
vi.mock("./schoolDebriefApi.js", () => ({ createSchoolDebriefApi: () => api }));
vi.mock("./schoolDebriefLog.js", () => ({ schoolDebriefLog: new Proxy({}, { get: () => vi.fn() }) }));
vi.mock("../shared/useTakeRecorder.js", () => ({ default: () => ({ phase: 'idle', start: vi.fn(), stop: vi.fn(), unavailable: true, verdict: null, stream: null, onLevel: vi.fn() }) }));
const school = vi.hoisted(() => ({ earningsPreview: vi.fn(), economyBank: vi.fn() }));
vi.mock("../../schoolApi.js", () => ({ schoolApi: school }));
const ok = (data) => ({ ok: true, status: 200, data });

describe('SchoolDebriefProgram start card', () => {
  it('offers yesterday (late) first when lateDay is set', async () => {
    api.day = vi.fn(async (d) => ok({ studyDay: d, phase: 'not-started', next: { kind: 'prompt', id: 'classes' }, entries: {} }));
    render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay="2026-10-20" today="2026-10-21" onExit={vi.fn()} />);
    const buttons = await screen.findAllByRole('button', { name: /debrief|school/i });
    expect(buttons[0]).toHaveTextContent(/yesterday/i);
  });
  it('resumes at the first unanswered question with the frozen questions', async () => {
    api.day = vi.fn(async (d) => ok({ studyDay: d, phase: 'answering', next: { kind: 'question', id: 'q2' }, entries: {},
      questions: [{ id: 'q1', kind: 'choice', prompt: 'One', options: ['a', 'b', 'c'], answer: 'a' }, { id: 'q2', kind: 'choice', prompt: 'Two', options: ['a', 'b', 'c'] }], answers: { q1: { correct: true } } }));
    api.open = vi.fn(async (d) => api.day(d));
    render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay={null} today="2026-10-21" onExit={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /pick up/i }));
    expect(await screen.findByText('Two')).toBeInTheDocument();
  });
  it('without a grant it points to the agenda code', () => {
    render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant={null} today={null} lateDay={null} onExit={vi.fn()} />);
    expect(screen.getByText(/code on your agenda/i)).toBeInTheDocument();
  });
  it('a done day shows only the summary', async () => {
    api.day = vi.fn(async (d) => ok({ studyDay: d, phase: 'completed', next: null, entries: {}, late: false, summary: { substance: 7, substantive: true, quiz: { right: 2, graded: 2 } } }));
    render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay={null} today="2026-10-21" onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/2 of 2/)).toBeInTheDocument());
  });

  describe('coins on the summary', () => {
    const finishing = () => {
      let done = false;
      api.day = vi.fn(async (d) => ok(done
        ? { studyDay: d, phase: 'completed', next: null, entries: {}, late: false, summary: { substance: 7, substantive: true, quiz: { right: 2, graded: 2 } } }
        : { studyDay: d, phase: 'answering', next: { kind: 'complete' }, entries: {}, questions: [], answers: {} }));
      api.open = vi.fn(async (d) => api.day(d));
      api.complete = vi.fn(async (d) => { done = true; return api.day(d); });
    };
    const run = async () => {
      finishing();
      render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay={null} today="2026-10-21" onExit={vi.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: /pick up/i }));
    };
    it('dry-run bank: "Coins start soon" and no silver', async () => {
      school.economyBank.mockResolvedValue(ok({ mode: 'dry-run' }));
      await run();
      expect(await screen.findByText('Coins start soon')).toBeInTheDocument();
      expect(screen.queryByText(/silver/i)).toBeNull();
      expect(school.earningsPreview).not.toHaveBeenCalled();
    });
    it('live bank: shows the earned line', async () => {
      school.economyBank.mockResolvedValue(ok({ mode: 'live' }));
      let calls = 0;
      school.earningsPreview.mockImplementation(async () => ok({ totals: { silver: calls++ ? 3 : 0 }, lines: calls > 1 ? [{ ruleId: 'r1', label: 'Debrief', amount: { silver: 3, gems: 0 } }] : [] }));
      await run();
      expect(await screen.findByText(/\+3 silver/)).toBeInTheDocument();
      expect(screen.queryByText('Coins start soon')).toBeNull();
    });
  });

  describe('no dead ends', () => {
    const full = { classes: { text: 'a' }, learned: { text: 'b' }, notable: { text: 'c' } };
    const qs = [{ id: 'q1', kind: 'choice', prompt: 'One', options: ['a', 'b', 'c'] }, { id: 'q2', kind: 'choice', prompt: 'Two', options: ['a', 'b', 'c'] }];
    const enter = () => fireEvent.keyDown(window, { code: 'Enter', key: 'Enter' });
    const go = async (today) => {
      render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay={null} today="2026-10-21" onExit={vi.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: /pick up|tell me/i }));
    };
    it('a persistent submit failure does not loop; Try again retries exactly once per press', async () => {
      api.day = vi.fn(async (d) => ok({ studyDay: d, phase: 'entry', next: { kind: 'submit' }, entries: full }));
      api.open = api.day;
      const good = ok({ studyDay: '2026-10-21', phase: 'answering', next: { kind: 'question', id: 'q1' }, entries: full, questions: qs, answers: {} });
      api.submit = vi.fn(async () => ({ ok: false, status: 500, data: null }));
      await go();
      const btn = await screen.findByRole('button', { name: /try again/i });
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 20));
      expect(api.submit).toHaveBeenCalledTimes(1);
      fireEvent.click(btn);
      await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
      await screen.findByRole('button', { name: /try again/i });
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 20));
      expect(api.submit).toHaveBeenCalledTimes(2);
      api.submit.mockResolvedValueOnce(good);
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(await screen.findByText('One')).toBeInTheDocument();
      expect(api.submit).toHaveBeenCalledTimes(3);
    });
    it('submit failure then the Enter key retries', async () => {
      api.day = vi.fn(async (d) => ok({ studyDay: d, phase: 'entry', next: { kind: 'submit' }, entries: full }));
      api.open = api.day;
      api.submit = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, data: null })
        .mockResolvedValueOnce(ok({ studyDay: '2026-10-21', phase: 'answering', next: { kind: 'question', id: 'q1' }, entries: full, questions: qs, answers: {} }));
      await go();
      await screen.findByRole('button', { name: /try again/i });
      await new Promise((r) => setTimeout(r, 50));
      expect(api.submit).toHaveBeenCalledTimes(1);
      enter();
      expect(await screen.findByText('One')).toBeInTheDocument();
      expect(api.submit).toHaveBeenCalledTimes(2);
    });
    it('complete failure then Enter retries and reaches the summary', async () => {
      school.economyBank.mockResolvedValue(ok({ mode: 'dry-run' }));
      api.day = vi.fn(async (d) => ok({ studyDay: d, phase: 'answering', next: { kind: 'complete' }, entries: {}, questions: [], answers: {} }));
      api.open = api.day;
      api.complete = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, data: null })
        .mockResolvedValueOnce(ok({ studyDay: '2026-10-21', phase: 'completed', next: null, entries: {}, late: false, summary: { substance: 7, substantive: true, quiz: { right: 1, graded: 2 } } }));
      await go();
      await screen.findByRole('button', { name: /try again/i });
      enter();
      expect(await screen.findByText(/1 of 2/)).toBeInTheDocument();
    });
    it('a failed open shows the error and Enter retries it', async () => {
      api.day = vi.fn(async (d) => ok({ studyDay: d, phase: 'not-started', next: { kind: 'prompt', id: 'classes' }, entries: {} }));
      api.open = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, data: null })
        .mockResolvedValueOnce(ok({ studyDay: '2026-10-21', phase: 'entry', next: { kind: 'prompt', id: 'classes' }, entries: {} }));
      await go();
      await screen.findByRole('button', { name: /try again/i });
      enter();
      expect(await screen.findByText(/What classes or subjects/)).toBeInTheDocument();
      expect(api.open).toHaveBeenCalledTimes(2);
    });
    it('after answering, two rapid digits answer once and the next question is fresh', async () => {
      let answered = false;
      const view = () => ok({ studyDay: '2026-10-21', phase: 'answering', next: { kind: 'question', id: answered ? 'q2' : 'q1' }, entries: full, questions: qs, answers: answered ? { q1: {} } : {} });
      api.day = vi.fn(async () => view());
      api.open = api.day;
      let release;
      api.answer = vi.fn(() => new Promise((r) => { release = () => { answered = true; r(ok({ correct: true, grade: 1, answer: 'a' })); }; }));
      await go();
      await screen.findByText('One');
      fireEvent.keyDown(window, { code: 'Digit1', key: '1' });
      fireEvent.keyDown(window, { code: 'Digit2', key: '2' });
      expect(api.answer).toHaveBeenCalledTimes(1);
      release();
      fireEvent.keyDown(await screen.findByRole('button', { name: /^Next/ }), { code: 'Enter', key: 'Enter' });
      enter();
      expect(await screen.findByText('Two')).toBeInTheDocument();
      expect(screen.queryByText('One')).toBeNull();
      expect(api.answer).toHaveBeenCalledTimes(1);
    });
  });

  describe('a rejected day', () => {
    const rejected = (d) => ok({ studyDay: d, phase: 'rejected', next: null, entries: { learned: { text: 'x' } }, late: false,
      questions: [{ id: 'q1', kind: 'choice', prompt: 'One', options: ['a', 'b'] }], answers: {}, summary: { substance: 7, substantive: false, quiz: { right: 0, graded: 0 } } });
    it('shows the talk-to-a-grown-up notice and Enter exits', async () => {
      api.day = vi.fn(async (d) => rejected(d));
      const onExit = vi.fn();
      render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay={null} today="2026-10-21" onExit={onExit} />);
      expect(await screen.findByText('A grown-up wants to talk with you about this one.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /pick up/i })).toBeNull();
      expect(screen.queryByText(/Question \d of/)).toBeNull();
      fireEvent.keyDown(window, { code: 'Enter', key: 'Enter' });
      expect(onExit).toHaveBeenCalledTimes(1);
    });
    it('with a late day offered, the start card offers only yesterday, never a resume of the rejected day', async () => {
      api.day = vi.fn(async (d) => rejected(d));
      render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay="2026-10-20" today="2026-10-21" onExit={vi.fn()} />);
      const buttons = await screen.findAllByRole('button', { name: /debrief|school|pick up/i });
      expect(buttons.map((b) => b.textContent)).toEqual([expect.stringMatching(/yesterday/i)]);
    });
    it('a day rejected mid-flow shows the notice, not a stale question count', async () => {
      api.day = vi.fn(async (d) => ok({ studyDay: d, phase: 'answering', next: { kind: 'question', id: 'q1' }, entries: {}, questions: [{ id: 'q1', kind: 'choice', prompt: 'One', options: ['a', 'b'] }], answers: {} }));
      api.open = vi.fn(async (d) => rejected(d));
      render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay={null} today="2026-10-21" onExit={vi.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: /pick up/i }));
      expect(await screen.findByText('A grown-up wants to talk with you about this one.')).toBeInTheDocument();
      expect(screen.queryByText(/Question \d of/)).toBeNull();
    });
  });

  describe('today already done when opened', () => {
    const doneDay = (d) => ok({ studyDay: d, phase: 'completed', next: null, entries: {}, late: false, summary: { substance: 7, substantive: true, quiz: { right: 2, graded: 2 } } });
    it('dry-run bank: "Coins start soon", no silver', async () => {
      api.day = vi.fn(async (d) => doneDay(d));
      school.economyBank.mockReset(); school.earningsPreview.mockReset();
      school.economyBank.mockResolvedValue(ok({ mode: 'dry-run' }));
      render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay={null} today="2026-10-21" onExit={vi.fn()} />);
      expect(await screen.findByText('Coins start soon')).toBeInTheDocument();
      expect(screen.queryByText(/silver/i)).toBeNull();
      expect(school.economyBank).toHaveBeenCalledWith('test-learner');
      expect(school.earningsPreview).not.toHaveBeenCalled();
    });
    it('live bank: no "Coins start soon"', async () => {
      api.day = vi.fn(async (d) => doneDay(d));
      school.economyBank.mockReset(); school.earningsPreview.mockReset();
      school.economyBank.mockResolvedValue(ok({ mode: 'live' }));
      school.earningsPreview.mockResolvedValue(ok({ totals: { silver: 0 }, lines: [] }));
      render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay={null} today="2026-10-21" onExit={vi.fn()} />);
      await screen.findByText(/2 of 2/);
      await waitFor(() => expect(school.economyBank).toHaveBeenCalled());
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(screen.queryByText('Coins start soon')).toBeNull();
    });
  });

  describe('inactivity', () => {
    afterEach(() => { vi.useRealTimers(); });
    const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };
    const mount = async (onExit) => {
      vi.useFakeTimers();
      api.day = vi.fn(async (d) => ok({ studyDay: d, phase: 'not-started', next: { kind: 'prompt', id: 'classes' }, entries: {} }));
      render(<SchoolDebriefProgram learnerId="test-learner" debriefGrant="g" lateDay={null} today="2026-10-21" onExit={onExit} />);
      await settle();
      expect(screen.getByRole('button', { name: /tell me about school/i })).toBeInTheDocument();
    };
    const nudgeText = /Still there\?/;
    it('nudges at 45 s on the start card, not before', async () => {
      await mount(vi.fn());
      act(() => { vi.advanceTimersByTime(44_000); });
      expect(screen.queryByText(nudgeText)).toBeNull();
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(screen.getByText(nudgeText)).toBeInTheDocument();
    });
    it('any input clears the nudge and the exit timer', async () => {
      const onExit = vi.fn();
      await mount(onExit);
      act(() => { vi.advanceTimersByTime(45_000); });
      expect(screen.getByText(nudgeText)).toBeInTheDocument();
      act(() => { fireEvent.keyDown(window, { code: 'ShiftLeft', key: 'Shift' }); });
      expect(screen.queryByText(nudgeText)).toBeNull();
      act(() => { vi.advanceTimersByTime(5 * 60 * 1000 - 45_000); });
      expect(onExit).not.toHaveBeenCalled();
    });
    it('closes to the keypad 5 minutes after the last input', async () => {
      const onExit = vi.fn();
      await mount(onExit);
      act(() => { vi.advanceTimersByTime(45_000); }); // the nudge renders (its exit timer starts on commit)
      act(() => { vi.advanceTimersByTime(5 * 60 * 1000 - 45_000 - 1); });
      expect(onExit).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(onExit).toHaveBeenCalledTimes(1);
    });
  });
});
