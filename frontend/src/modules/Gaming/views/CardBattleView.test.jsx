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
    expect(document.querySelectorAll('[data-card-identicon]')).toHaveLength(cards.length);
    fireEvent.click(cards[0]);
    expect(onChoose).toHaveBeenCalledWith(session.state.zones.hand[0].instance_id);
    expect(screen.getByText('Tap a card')).toBeTruthy();
    expect(screen.getByText('Play your hand.')).toBeTruthy();
    expect(screen.queryByText(/notes$/i)).toBeNull();
  });

  it('makes a no-playable-card state visible instead of silently disabling the hand', () => {
    const definition = structuredClone(scaleClashDefinition);
    for (const card of Object.values(definition.cards)) card.cost = 99;
    const session = makeSession(definition);
    render(<CardBattleView session={session} onChoose={vi.fn()} onAbort={vi.fn()} />);
    expect(screen.getByText('No playable card')).toBeTruthy();
    expect(screen.getByText(/No card is affordable/)).toBeTruthy();
    expect(screen.getByText('Nothing playable')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /damage/i }).every((card) => card.disabled)).toBe(true);
  });

  it('shows attack effectiveness and retaliation before the next card choice', () => {
    const session = makeSession();
    render(
      <CardBattleView
        session={session}
        combatResult={{ kind: 'card', effectKind: 'attack', cardTitle: 'Heavy Strike', damage: 6, retaliation: 2, effectiveness: 'Full power' }}
        onChoose={vi.fn()}
        onAbort={vi.fn()}
      />,
    );
    expect(screen.getByText('Heavy Strike')).toBeTruthy();
    expect(screen.getByText('Full power')).toBeTruthy();
    expect(screen.getByText(/struck back for 2/)).toBeTruthy();
    expect(screen.queryByText('Choose a card.')).toBeNull();
  });

  it('does not flash the card prompt while an attack result is being persisted', () => {
    const session = makeSession();
    render(
      <CardBattleView
        session={session}
        combatResult={{ kind: 'card', cardTitle: 'Steady Strike', resolving: true }}
        onChoose={vi.fn()}
        onAbort={vi.fn()}
      />,
    );
    expect(screen.getByText('Resolving…')).toBeTruthy();
    expect(screen.queryByText('Choose a card.')).toBeNull();
  });

  it('shows enemy intent and exposes an explicit tactical end-turn action', () => {
    const definition = structuredClone(scaleClashDefinition);
    definition.card_battle.turn_mode = 'tactical';
    definition.card_battle.hand_size = 3;
    definition.card_battle.enemy.intents = [
      { id: 'swing', title: 'Heavy Swing', kind: 'attack', amount: 4 },
      { id: 'brace', title: 'Brace', kind: 'defend', amount: 3 },
    ];
    const onEndTurn = vi.fn();
    render(
      <CardBattleView
        session={makeSession(definition)}
        onChoose={vi.fn()}
        onEndTurn={onEndTurn}
        onAbort={vi.fn()}
      />,
    );
    expect(screen.getByText('Next move')).toBeTruthy();
    expect(screen.getByText('Heavy Swing')).toBeTruthy();
    expect(screen.getByText('4 damage')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    expect(onEndTurn).toHaveBeenCalledOnce();
  });

  it('ends with a battle summary and a rematch action', () => {
    const session = makeSession();
    session.status = 'complete';
    session.state.status = 'complete';
    session.state.winner = 'player';
    session.state.turn = 4;
    session.state.player.health = 6;
    const onRestart = vi.fn();
    render(
      <CardBattleView
        session={session}
        onChoose={vi.fn()}
        onRestart={onRestart}
        onAbort={vi.fn()}
      />,
    );
    expect(screen.getByText('Victory')).toBeTruthy();
    expect(screen.getByText('0 score · 4 turns · 6 health left')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it('lets a winner carry one authored reward into the next battle', () => {
    const definition = structuredClone(scaleClashDefinition);
    definition.card_battle.upgrades = [{
      id: 'second-wind', title: 'Second Wind', description: 'Start with extra health.', effect: { max_health: 2 },
    }];
    const session = makeSession(definition);
    session.status = 'complete';
    session.state.status = 'complete';
    session.state.winner = 'player';
    const onRestart = vi.fn();
    render(
      <CardBattleView session={session} onChoose={vi.fn()} onRestart={onRestart} onAbort={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Second Wind/ }));
    expect(onRestart).toHaveBeenCalledWith('second-wind');
  });
});
