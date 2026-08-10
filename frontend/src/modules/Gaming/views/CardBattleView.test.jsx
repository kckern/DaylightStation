import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createInitialState, deriveInteraction } from '@shared-gaming/index.mjs';
import { scaleClashDefinition } from '@shared-gaming/fixtures/scaleClash.mjs';
import { CardBattleView } from './CardBattleView.jsx';

function makeSession(definition = scaleClashDefinition) {
  const state = createInitialState(definition, { seed: 7, participants: [{ user_id: 'guest' }] });
  return {
    session_id: 'game_test', game_id: definition.game_id, status: state.status, revision: 0,
    definition, state, interaction: deriveInteraction(state, definition, 'guest'), events: [],
  };
}

describe('CardBattleView', () => {
  it('renders the hand as direct card actions without leaking challenge metadata', () => {
    const onChoose = vi.fn();
    const session = makeSession();
    render(<CardBattleView session={session} onChoose={onChoose} onAbort={vi.fn()} />);
    const cards = screen.getAllByRole('button', { name: /damage/i });
    expect(cards).toHaveLength(session.state.zones.hand.length);
    expect(cards.every((card) => !card.disabled)).toBe(true);
    fireEvent.click(cards[0]);
    expect(onChoose).toHaveBeenCalledWith(session.state.zones.hand[0].instance_id);
    expect(screen.getByText('Tap a card')).toBeTruthy();
    expect(screen.getByText('Choose a card.')).toBeTruthy();
    expect(screen.queryByText(/notes$/i)).toBeNull();
  });

  it('makes a no-playable-card state visible instead of silently disabling the hand', () => {
    const definition = structuredClone(scaleClashDefinition);
    for (const card of Object.values(definition.cards)) card.cost = 99;
    const session = makeSession(definition);
    render(<CardBattleView session={session} onChoose={vi.fn()} onAbort={vi.fn()} />);
    expect(screen.getByText('No card available')).toBeTruthy();
    expect(screen.getByText(/No card is affordable/)).toBeTruthy();
    expect(screen.getByText('Nothing playable')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /damage/i }).every((card) => card.disabled)).toBe(true);
  });
});
