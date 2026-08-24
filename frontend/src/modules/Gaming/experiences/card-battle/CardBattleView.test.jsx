import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createInitialState, deriveInteraction, transition } from '@shared-gaming/index.mjs';
import { cardBattleFixture } from '@shared-gaming/testing/cardBattleFixture.mjs';
import { CardBattleView } from './CardBattleView.jsx';

function makeSession(definition = cardBattleFixture) {
  const state = createInitialState(definition, { seed: 7, participants: [{ user_id: 'guest' }] });
  return {
    session_id: 'game_test', game_id: definition.game_id, status: state.status, revision: 0,
    definition, state, interaction: deriveInteraction(state, definition, 'guest'), events: [],
  };
}

/** An authored visual skin using only the presenter's neutral display contract. */
function makeCombatantDefinition() {
  const definition = structuredClone(cardBattleFixture);
  definition.title = 'Combatant Arena';
  definition.presentation = { theme: 'combatant-tcg', data_source: 'mounted catalog' };
  definition.card_battle.player = {
    ...definition.card_battle.player,
    name: 'Echo',
    display: {
      identifier: 'ALPHA', subtitle: 'Swift striker', asset: 'content/actors/echo.svg',
      badges: [{ label: 'Arc', symbol: '◇', color: '#f2c438', ink: '#332900' }],
      attributes: [{ label: 'Agility', value: 8 }],
    },
  };
  definition.card_battle.enemy = {
    ...definition.card_battle.enemy,
    name: 'Rook',
    vulnerability: {
      label: 'Vulnerability', multiplier: 1.5,
      badge: { label: 'Arc', symbol: '◇', color: '#f2c438', ink: '#332900' },
    },
    display: {
      identifier: 'BETA', subtitle: 'Steady guardian', asset: 'content/actors/rook.svg',
      badges: [{ label: 'Tide', symbol: '●', color: '#5096e8', ink: '#071c35' }],
      attributes: [{ label: 'Guard', value: 7 }],
    },
  };
  for (const card of Object.values(definition.cards)) {
    card.display = { badge: { label: 'Arc', symbol: '◇', color: '#f2c438', ink: '#332900' } };
  }
  return definition;
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

  it('renders mounted combatant metadata and proxied assets', () => {
    const definition = makeCombatantDefinition();
    definition.title = 'Card Game';

    const { container } = render(
      <CardBattleView session={makeSession(definition)} onChoose={vi.fn()} onEndTurn={vi.fn()} onAbort={vi.fn()} />,
    );

    const battle = container.querySelector('.card-battle--combatant');
    expect(battle).toBeTruthy();
    expect(battle.dataset).toMatchObject({
      gameTheme: 'combatant-tcg', battleStatus: 'active', turn: '1',
    });
    // Read the attribute directly: jsdom's DOMStringMap does not enumerate
    // empty-valued entries, so an in-progress battle's `winner: ''` can never
    // be matched through `dataset`.
    expect(battle.getAttribute('data-winner')).toBe('');
    const moveCards = [...container.querySelectorAll('[data-card-instance-id]')];
    expect(moveCards).toHaveLength(definition.card_battle.opening_hand);
    expect(moveCards.every((card) => (
      card.dataset.cardTitle
      && card.dataset.cardType
      && Number.isFinite(Number(card.dataset.cardCost))
      && Number.isFinite(Number(card.dataset.cardEffect))
    ))).toBe(true);
    expect(screen.getByText('Move deck')).toBeTruthy();
    expect(screen.getByLabelText('Your active Combatant: Echo')).toBeTruthy();
    expect(screen.getByLabelText('Opponent active Combatant: Rook')).toBeTruthy();
    expect(screen.getByText('Swift striker · Agility 8')).toBeTruthy();
    expect(screen.getByText('Steady guardian · Guard 7')).toBeTruthy();
    expect(screen.getByAltText('Echo').getAttribute('src')).toBe(
      '/api/v1/proxy/media/stream/content%2Factors%2Fecho.svg',
    );
    expect(screen.getByAltText('Rook').getAttribute('src')).toBe(
      '/api/v1/proxy/media/stream/content%2Factors%2Frook.svg',
    );
  });

  // Two identically framed cards side by side is the whole confusion this
  // guards against: whose card is whose must be answerable from the markup
  // (and therefore from the styling that hangs off it), not from a caption.
  it('marks each side of the mat as yours or the opponent\'s', () => {
    const session = makeSession(makeCombatantDefinition());
    session.state.enemy.intent = { kind: 'attack', title: 'Pulse', amount: 8 };
    const { container } = render(
      <CardBattleView session={session} onChoose={vi.fn()} onAbort={vi.fn()} />,
    );

    const combatants = [...container.querySelectorAll('.combatant-combatant')];
    expect(combatants.map((el) => el.dataset.side)).toEqual(['enemy', 'player']);
    expect(combatants.map((el) => el.className.includes('combatant-combatant--enemy'))).toEqual([true, false]);

    // A nameplate on each card, not a corner caption.
    const plates = [...container.querySelectorAll('.combatant-combatant__side')].map((el) => el.textContent);
    expect(plates).toEqual(['Opponent', 'You']);

    // The energy meter belongs to you, the vulnerability to them — and both ride
    // inside their own card's art window.
    expect(container.querySelector('.combatant-combatant--player .combatant-combatant__art .combatant-combatant__energy')).toBeTruthy();
    expect(container.querySelector('.combatant-combatant--enemy .combatant-combatant__art .combatant-combatant__vulnerability')).toBeTruthy();
    expect(container.querySelector('.combatant-combatant--player .combatant-combatant__vulnerability')).toBeNull();
    expect(container.querySelector('.combatant-combatant--enemy .combatant-combatant__energy')).toBeNull();

    // The announced move is the opponent's, and says so.
    expect(screen.getByText('Rook will use')).toBeTruthy();
  });

  it('makes a no-playable-card state visible instead of silently disabling the hand', () => {
    const definition = structuredClone(cardBattleFixture);
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

  it('explains a consumed pass-gated card that produced no effect', () => {
    const session = makeSession();
    render(
      <CardBattleView
        session={session}
        combatResult={{
          kind: 'card', effectKind: 'attack', cardTitle: 'Timed Pattern', damage: 0, retaliation: 4,
          effectiveness: 'No effect — requirements not met', passed: false,
          failedCriteria: ['placement'], failedGates: ['pace'],
        }}
        onChoose={vi.fn()}
      />,
    );
    expect(screen.getByText('No effect — requirements not met')).toBeTruthy();
    expect(screen.getByText('Needs: placement, pace')).toBeTruthy();
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
    const definition = structuredClone(cardBattleFixture);
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
    const definition = structuredClone(cardBattleFixture);
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

  it('focuses the modal challenge and lets Escape cancel it', () => {
    const session = makeSession();
    const card = session.state.zones.hand[0];
    const outcome = transition(session.state, {
      command_id: 'open-challenge', session_revision: 0, type: 'choose_action',
      payload: { card_instance_id: card.instance_id },
    }, session.definition);
    session.state = outcome.state;
    session.revision = 1;
    session.interaction = deriveInteraction(session.state, session.definition, 'guest');
    const onAbort = vi.fn();
    render(<CardBattleView session={session} onChoose={vi.fn()} onAbort={onAbort} />);

    const dialog = screen.getByRole('dialog', { name: 'Action challenge' });
    expect(document.activeElement).toBe(dialog.firstElementChild);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onAbort).toHaveBeenCalledOnce();
  });
});
