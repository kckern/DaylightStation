import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PromptItem from "./PromptItem.jsx";
import ChoiceItem from "./ChoiceItem.jsx";
import ShortAnswerItem from "./ShortAnswerItem.jsx";
import SummaryItem from "./SummaryItem.jsx";

const recorder = vi.hoisted(() => ({ phase: 'idle', start: vi.fn(), stop: vi.fn(), unavailable: false }));
vi.mock("../../shared/useTakeRecorder.js", () => ({
  default: vi.fn(() => ({ ...recorder, verdict: null, stream: null, onLevel: vi.fn(), release: vi.fn() })),
}));
vi.mock("../schoolDebriefLog.js", () => ({ schoolDebriefLog: new Proxy({}, { get: () => vi.fn() }) }));
const key = (code, key) => fireEvent.keyDown(window, { code, key });

describe('every debrief action has a key', () => {
  it('prompt: Space records on an empty field, Enter submits typed text, ArrowLeft goes back', () => {
    const onSubmit = vi.fn(); const onBack = vi.fn();
    render(<PromptItem prompt={{ id: 'learned', text: 'Tell me one thing you learned.', required: true }} initial="" onSubmit={onSubmit} onBack={onBack} onTake={vi.fn()} />);
    key('Space', ' '); expect(recorder.start).toHaveBeenCalled();
    key('ArrowLeft', 'ArrowLeft'); expect(onBack).toHaveBeenCalled();
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'fractions' } });
    fireEvent.keyDown(field, { code: 'Enter', key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith({ text: 'fractions', via: 'typed', audioRef: null });
  });
  it('prompt: Enter on an empty required field does not submit', () => {
    const onSubmit = vi.fn();
    render(<PromptItem prompt={{ id: 'learned', text: 'x', required: true }} initial="" onSubmit={onSubmit} onBack={vi.fn()} onTake={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { code: 'Enter', key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('choice: digits and letters answer; Space continues after the result', () => {
    const onAnswer = vi.fn(); const onContinue = vi.fn();
    const q = { id: 'q1', kind: 'choice', prompt: 'P', options: ['Light', 'Sand', 'Salt'] };
    const { rerender } = render(<ChoiceItem question={q} result={null} onAnswer={onAnswer} onContinue={onContinue} />);
    key('Digit2', '2'); expect(onAnswer).toHaveBeenLastCalledWith('Sand');
    key('KeyC', 'c'); expect(onAnswer).toHaveBeenLastCalledWith('Salt');
    rerender(<ChoiceItem question={q} result={{ correct: false, answer: 'Light' }} onAnswer={onAnswer} onContinue={onContinue} />);
    key('Space', ' '); expect(onContinue).toHaveBeenCalled();
  });
  it('short answer: Enter submits; Space continues after the result', () => {
    const onAnswer = vi.fn(); const onContinue = vi.fn();
    const q = { id: 'q3', kind: 'short', prompt: 'Explain' };
    const { rerender } = render(<ShortAnswerItem question={q} result={null} onAnswer={onAnswer} onContinue={onContinue} onTake={vi.fn()} />);
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'light' } });
    fireEvent.keyDown(field, { code: 'Enter', key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith('light');
    rerender(<ShortAnswerItem question={q} result={{ correct: true, expected: 'x' }} onAnswer={onAnswer} onContinue={onContinue} onTake={vi.fn()} />);
    key('Space', ' '); expect(onContinue).toHaveBeenCalled();
  });
  it('summary: Enter finishes', () => {
    const onFinish = vi.fn();
    render(<SummaryItem view={{ late: false, summary: { substance: 7, substantive: true, quiz: { right: 2, graded: 3 } }, entries: {} }} earned={null} onFinish={onFinish} />);
    key('Enter', 'Enter'); expect(onFinish).toHaveBeenCalled();
  });
  it('no mic: the record control is absent', () => {
    recorder.unavailable = true;
    render(<PromptItem prompt={{ id: 'classes', text: 'x', required: false }} initial="" onSubmit={vi.fn()} onBack={vi.fn()} onTake={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
    recorder.unavailable = false;
  });
  it('prompt: Space on the focused empty textarea starts recording instead of typing a space', () => {
    recorder.start.mockClear();
    render(<PromptItem prompt={{ id: 'learned', text: 'x', required: true }} initial="" onSubmit={vi.fn()} onBack={vi.fn()} onTake={vi.fn()} />);
    const field = screen.getByRole('textbox');
    const notPrevented = fireEvent.keyDown(field, { code: 'Space', key: ' ' });
    expect(notPrevented).toBe(false);
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });
  it('prompt: busy parent blocks submit', () => {
    const onSubmit = vi.fn();
    render(<PromptItem prompt={{ id: 'learned', text: 'x', required: false }} initial="hi" busy onSubmit={onSubmit} onBack={vi.fn()} onTake={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { code: 'Enter', key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
