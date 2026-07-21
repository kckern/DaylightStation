import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MultipleChoiceItem from './MultipleChoiceItem.jsx';
import ShortAnswerItem from './ShortAnswerItem.jsx';
import ClozeItem from './ClozeItem.jsx';
import MatchingItem from './MatchingItem.jsx';

describe('MultipleChoiceItem', () => {
  const item = { id: 'q', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] };
  it('submits the tapped choice; inert after verdict', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<MultipleChoiceItem item={item} onSubmit={onSubmit} verdict={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Olympia' }));
    expect(onSubmit).toHaveBeenCalledWith('Olympia');
    rerender(<MultipleChoiceItem item={item} onSubmit={onSubmit} verdict={{ correct: false, expected: 'Olympia' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seattle' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Olympia/)).toBeInTheDocument(); // expected shown on wrong
  });
  it('double-tap on the same choice submits exactly once while verdict is still null', () => {
    const onSubmit = vi.fn();
    render(<MultipleChoiceItem item={item} onSubmit={onSubmit} verdict={null} />);
    const btn = screen.getByRole('button', { name: 'Olympia' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('ShortAnswerItem', () => {
  const item = { id: 'q', type: 'short_answer', prompt: 'OR?', answer: 'Salem' };
  it('submits typed text; ignores empty submit', () => {
    const onSubmit = vi.fn();
    render(<ShortAnswerItem item={item} onSubmit={onSubmit} verdict={null} />);
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Salem ' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith(' Salem ');
  });
  it('Enter then a Check tap submits exactly once while verdict is still null', () => {
    const onSubmit = vi.fn();
    render(<ShortAnswerItem item={item} onSubmit={onSubmit} verdict={null} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Salem' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('ClozeItem', () => {
  it('renders the prompt split around the blank and submits', () => {
    const onSubmit = vi.fn();
    render(<ClozeItem item={{ id: 'q', type: 'cloze', prompt: 'Capital of Idaho is ___.', answer: 'Boise' }} onSubmit={onSubmit} verdict={null} />);
    expect(screen.getByText(/Capital of Idaho is/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Boise' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith('Boise');
  });
  it('Enter then a Check tap submits exactly once while verdict is still null', () => {
    const onSubmit = vi.fn();
    render(<ClozeItem item={{ id: 'q', type: 'cloze', prompt: 'Capital of Idaho is ___.', answer: 'Boise' }} onSubmit={onSubmit} verdict={null} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Boise' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('MatchingItem', () => {
  const item = { id: 'm', type: 'matching', prompt: 'Match', pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] };
  it('tap-left-then-tap-right forms pairs; submits all pairs when complete', () => {
    const onSubmit = vi.fn();
    render(<MatchingItem item={item} onSubmit={onSubmit} verdict={null} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'WA' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'WA' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Olympia' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Olympia' }));
    expect(onSubmit).not.toHaveBeenCalled(); // one pair left
    fireEvent.pointerDown(screen.getByRole('button', { name: 'OR' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'OR' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Salem' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Salem' }));
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith([{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }]);
  });
  it('tapping a paired left unpairs it', () => {
    const onSubmit = vi.fn();
    render(<MatchingItem item={item} onSubmit={onSubmit} verdict={null} />);
    const pairUp = (l, r) => {
      fireEvent.pointerDown(screen.getByRole('button', { name: l })); fireEvent.pointerUp(screen.getByRole('button', { name: l }));
      fireEvent.pointerDown(screen.getByRole('button', { name: r })); fireEvent.pointerUp(screen.getByRole('button', { name: r }));
    };
    pairUp('WA', 'Olympia');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'WA' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'WA' }));
    pairUp('WA', 'Salem');
    pairUp('OR', 'Olympia');
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith([{ left: 'WA', right: 'Salem' }, { left: 'OR', right: 'Olympia' }]);
  });
  it('double-click Check after completing pairs submits exactly once while verdict is still null', () => {
    const onSubmit = vi.fn();
    render(<MatchingItem item={item} onSubmit={onSubmit} verdict={null} />);
    const pairUp = (l, r) => {
      fireEvent.pointerDown(screen.getByRole('button', { name: l })); fireEvent.pointerUp(screen.getByRole('button', { name: l }));
      fireEvent.pointerDown(screen.getByRole('button', { name: r })); fireEvent.pointerUp(screen.getByRole('button', { name: r }));
    };
    pairUp('WA', 'Olympia');
    pairUp('OR', 'Salem');
    const check = screen.getByRole('button', { name: /check/i });
    fireEvent.click(check);
    fireEvent.click(check);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
