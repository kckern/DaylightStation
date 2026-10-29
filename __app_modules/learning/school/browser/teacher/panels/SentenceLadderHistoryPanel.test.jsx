import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SentenceLadderHistoryPanel from "./SentenceLadderHistoryPanel.jsx";

const api = vi.hoisted(() => ({ teacherCourses: vi.fn(), teacherHistory: vi.fn(), teacherRecordingBlob: vi.fn() }));
const profile = vi.hoisted(() => ({ current: { currentTeacher: { id: 'parent' } } }));
vi.mock("../../Programs/SentenceLadder/languageApi.js", () => ({ languageApi: api, default: api }));
vi.mock("../TeacherProfileContext.jsx", () => ({ useTeacherProfileOptional: () => profile.current }));

const ok = (data) => ({ ok: true, status: 200, data });
const HISTORY = {
  corpus: { id: 'korean', label: 'Korean', languages: { source: 'en', target: 'ko' } },
  days: [{ day: 4, items: [
    { seq: 7, rung: 'dictation', at: '2026-10-27T16:00:00-07:00', text: { en: 'It is cold today.', ko: '오늘 추워요.' }, expected: '오늘 추워요.', given: '오늘 추어요.', accuracy: 0.8 },
    { seq: 8, rung: 'interpretation', at: '2026-10-27T16:02:00-07:00', text: { en: 'I am hungry.', ko: '배고파요.' }, expected: 'I am hungry.', revealed: true },
  ] }],
};

describe('SentenceLadderHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profile.current = { currentTeacher: { id: 'parent' } };
    api.teacherCourses.mockResolvedValue(ok({ courses: [
      { id: 'korean', label: 'Korean', state: 'active', lastActivity: '2026-10-27T16:02:00-07:00' },
      { id: 'spanish', label: 'Spanish', state: 'not-started', lastActivity: null },
    ] }));
    api.teacherHistory.mockResolvedValue(ok(HISTORY));
  });

  it('reads the child\'s history through the teacher routes and renders it with dates', async () => {
    render(<SentenceLadderHistoryPanel learnerId="test-learner" learnerName="Test Learner" />);
    expect(await screen.findByText(/Day 4 · /)).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Answer shown: I am hungry.')).toBeInTheDocument();
    expect(api.teacherCourses).toHaveBeenCalledWith('test-learner', 'parent');
    expect(api.teacherHistory).toHaveBeenCalledWith('test-learner', 'korean', 'parent');
    // A course never started is not offered as a tab.
    expect(screen.queryByRole('tab', { name: 'Spanish' })).toBeNull();
  });

  it('switches course when the learner has started more than one', async () => {
    api.teacherCourses.mockResolvedValue(ok({ courses: [
      { id: 'korean', label: 'Korean', state: 'active', lastActivity: '2026-10-27' },
      { id: 'spanish', label: 'Spanish', state: 'idle', lastActivity: '2026-09-01' },
    ] }));
    render(<SentenceLadderHistoryPanel learnerId="test-learner" learnerName="Test Learner" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Spanish' }));
    await screen.findByText(/Spanish · Idle/);
    expect(api.teacherHistory).toHaveBeenLastCalledWith('test-learner', 'spanish', 'parent');
  });

  it('says so when no course was started, and asks for a teacher when none is picked', async () => {
    api.teacherCourses.mockResolvedValue(ok({ courses: [{ id: 'korean', state: 'not-started' }] }));
    const { unmount } = render(<SentenceLadderHistoryPanel learnerId="test-learner" learnerName="Test Learner" />);
    expect(await screen.findByText('Test Learner has not started a sentence-ladder course.')).toBeInTheDocument();
    unmount();
    profile.current = { currentTeacher: null };
    render(<SentenceLadderHistoryPanel learnerId="test-learner" learnerName="Test Learner" />);
    expect(screen.getByText('Pick a teacher to read Test Learner’s sentence ladder.')).toBeInTheDocument();
  });
});
