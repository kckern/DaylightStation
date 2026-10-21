import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
