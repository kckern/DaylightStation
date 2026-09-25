import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
vi.mock('../healthResources.js', () => ({ refreshHealthResources: () => {} }));

import { QuestionDeck } from './QuestionDeck.jsx';

const q = (id, over = {}) => ({
  id, version: 1, status: 'open', question: `Which icon fits ${id}?`,
  entryNames: { e1: `Dish ${id}` },
  choices: [
    { id: '0', label: '🍚 Rice bowl', repair: { reason: 'Picture suggests a rice bowl.' } },
    { id: '1', label: '🏮 Lantern', repair: { reason: 'Looks like a lantern.' } },
  ],
  ...over,
});
const mount = (props) => render(<MantineProvider><QuestionDeck questions={[q('A'), q('B'), q('C')]} onChanged={() => {}} {...props} /></MantineProvider>);

beforeEach(() => { api.mockReset(); api.mockResolvedValue({ status: 'resolved' }); });

describe('QuestionDeck', () => {
  it('shows ONE card: the food it is about, a short question, the count, and big choices', () => {
    mount();
    expect(screen.getByText('Dish A')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByText('Which icon fits A?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rice bowl/ })).toBeTruthy();
    expect(screen.queryByText('Which icon fits B?')).toBeNull();
    // The free-text box is hidden until asked for.
    expect(screen.queryByLabelText('Your answer')).toBeNull();
  });

  it('a choice posts the answer and moves to the next card', async () => {
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: /Rice bowl/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('api/v1/health/nutrition/cleanup/questions/A/answer',
      expect.objectContaining({ choiceId: '0', expectedVersion: 1 }), 'POST'));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText('Which icon fits B?')).toBeTruthy();
  });

  it('Skip and Back move without answering; arrow keys too', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    expect(screen.getByText('2 of 3')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('question-card'), { key: 'ArrowRight' });
    expect(screen.getByText('3 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('a swipe left goes to the next card', () => {
    mount();
    const card = screen.getByTestId('question-card');
    // jsdom has no PointerEvent: fireEvent would drop clientX, so build the
    // event and assign the coordinate (the GainStrip.test.jsx pattern).
    const pointer = (type, clientX) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { clientX, pointerId: 1 });
      act(() => { card.dispatchEvent(event); });
    };
    pointer('pointerdown', 300);
    pointer('pointerup', 150);
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  it('Leave as is dismisses; Other answer reveals the text box', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Other answer/ }));
    expect(screen.getByLabelText('Your answer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Leave as is/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('/questions/A/answer'),
      expect.objectContaining({ dismiss: true }), 'POST'));
  });

  it('names each food once, though entryNames keys it by both id and uuid', () => {
    render(<MantineProvider><QuestionDeck questions={[q('A', { entryNames: { 'row-1': 'White Rice', 'uuid-1': 'White Rice' } })]} onChanged={() => {}} /></MantineProvider>);
    expect(screen.getByText('White Rice')).toBeTruthy();
  });

  it('focuses the new card after moving, so the arrow keys keep working', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    expect(document.activeElement).toBe(screen.getByTestId('question-card'));
  });

  it('a drag that starts on a button is not a swipe', () => {
    mount();
    const button = screen.getByRole('button', { name: /Rice bowl/ });
    const pointer = (target, type, clientX) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { clientX, pointerId: 1 });
      act(() => { target.dispatchEvent(event); });
    };
    pointer(button, 'pointerdown', 300);
    pointer(screen.getByTestId('question-card'), 'pointerup', 100);
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('says so when every question is done', () => {
    render(<MantineProvider><QuestionDeck questions={[]} onChanged={() => {}} /></MantineProvider>);
    expect(screen.getByText(/All caught up/)).toBeTruthy();
  });
});
