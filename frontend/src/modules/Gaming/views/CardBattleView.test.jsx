import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createInitialState, deriveInteraction, transition } from '@shared-gaming/index.mjs';
import { scaleClashDefinition } from '@shared-gaming/definitions/scaleClash.mjs';
import { CardBattleView } from './CardBattleView.jsx';

function makeSession(definition = scaleClashDefinition) {
  const state = createInitialState(definition, { seed: 7, participants: [{ user_id: 'guest' }] });
  return {
    session_id: 'game_test', game_id: definition.game_id, status: state.status, revision: 0,
    definition, state, interaction: deriveInteraction(state, definition, 'guest'), events: [],
  };
}

/** Scale Stadium's authored shape: two named Pokémon, one per side of the mat. */
function makePokemonDefinition() {
  const definition = structuredClone(scaleClashDefinition);
  definition.title = 'Scale Stadium';
  definition.presentation = { theme: 'pokemon-tcg', data_source: 'PokeAPI' };
  definition.card_battle.player = {
    ...definition.card_battle.player,
    name: 'Pikachu',
    pokemon: {
      dex: '0025', name: 'Pikachu', genus: 'Mouse Pokémon', types: ['electric'],
      stats: { hp: 35, speed: 90 }, assets: { svg: 'games/pokemon/svg/0025-pikachu-gen1.svg' },
    },
  };
  definition.card_battle.enemy = {
    ...definition.card_battle.enemy,
    name: 'Squirtle',
    weakness: { type: 'electric', multiplier: 1.5 },
    pokemon: {
      dex: '0007', name: 'Squirtle', genus: 'Tiny Turtle Pokémon', types: ['water'],
      stats: { hp: 44, defense: 65 }, assets: { svg: 'games/pokemon/svg/0007-squirtle-gen1.svg' },
    },
  };
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

  it('renders the Pokémon theme from authored Pokédex metadata and proxied SVGs', () => {
    const definition = structuredClone(scaleClashDefinition);
    definition.title = 'Card Game';
    definition.presentation = { theme: 'pokemon-tcg', data_source: 'PokeAPI' };
    definition.card_battle.player = {
      ...definition.card_battle.player,
      name: 'Pikachu',
      pokemon: {
        dex: '0025', name: 'Pikachu', genus: 'Mouse Pokémon', types: ['electric'],
        stats: { hp: 35, speed: 90 }, assets: { svg: 'games/pokemon/svg/0025-pikachu-gen1.svg' },
      },
    };
    definition.card_battle.enemy = {
      ...definition.card_battle.enemy,
      name: 'Squirtle',
      weakness: { type: 'electric', multiplier: 1.5 },
      pokemon: {
        dex: '0007', name: 'Squirtle', genus: 'Tiny Turtle Pokémon', types: ['water'],
        stats: { hp: 44, defense: 65 }, assets: { svg: 'games/pokemon/svg/0007-squirtle-gen1.svg' },
      },
    };
    for (const card of Object.values(definition.cards)) card.move_type = 'electric';

    const { container } = render(
      <CardBattleView session={makeSession(definition)} onChoose={vi.fn()} onEndTurn={vi.fn()} onAbort={vi.fn()} />,
    );

    const battle = container.querySelector('.card-battle--pokemon');
    expect(battle).toBeTruthy();
    expect(battle.dataset).toMatchObject({
      gameTheme: 'pokemon-tcg', battleStatus: 'active', turn: '1',
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
    expect(screen.getByLabelText('Your active Pokémon: Pikachu')).toBeTruthy();
    expect(screen.getByLabelText('Opponent active Pokémon: Squirtle')).toBeTruthy();
    expect(screen.getByText('Mouse Pokémon · Speed 90')).toBeTruthy();
    expect(screen.getByText('Tiny Turtle Pokémon · Defense 65')).toBeTruthy();
    expect(screen.getByAltText('Pikachu').getAttribute('src')).toBe(
      '/api/v1/proxy/media/stream/games%2Fpokemon%2Fsvg%2F0025-pikachu-gen1.svg',
    );
    expect(screen.getByAltText('Squirtle').getAttribute('src')).toBe(
      '/api/v1/proxy/media/stream/games%2Fpokemon%2Fsvg%2F0007-squirtle-gen1.svg',
    );
  });

  // Two identically framed cards side by side is the whole confusion this
  // guards against: whose card is whose must be answerable from the markup
  // (and therefore from the styling that hangs off it), not from a caption.
  it('marks each side of the mat as yours or the opponent\'s', () => {
    const session = makeSession(makePokemonDefinition());
    session.state.enemy.intent = { kind: 'attack', title: 'Water Gun', amount: 8 };
    const { container } = render(
      <CardBattleView session={session} onChoose={vi.fn()} onAbort={vi.fn()} />,
    );

    const combatants = [...container.querySelectorAll('.pokemon-combatant')];
    expect(combatants.map((el) => el.dataset.side)).toEqual(['enemy', 'player']);
    expect(combatants.map((el) => el.className.includes('pokemon-combatant--enemy'))).toEqual([true, false]);

    // A nameplate on each card, not a corner caption.
    const plates = [...container.querySelectorAll('.pokemon-combatant__side')].map((el) => el.textContent);
    expect(plates).toEqual(['Opponent', 'You']);

    // The energy meter belongs to you, the weakness to them — and both ride
    // inside their own card's art window.
    expect(container.querySelector('.pokemon-combatant--player .pokemon-combatant__art .pokemon-combatant__energy')).toBeTruthy();
    expect(container.querySelector('.pokemon-combatant--enemy .pokemon-combatant__art .pokemon-combatant__weakness')).toBeTruthy();
    expect(container.querySelector('.pokemon-combatant--player .pokemon-combatant__weakness')).toBeNull();
    expect(container.querySelector('.pokemon-combatant--enemy .pokemon-combatant__energy')).toBeNull();

    // The announced move is the opponent's, and says so.
    expect(screen.getByText('Squirtle will use')).toBeTruthy();
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

    const dialog = screen.getByRole('dialog', { name: 'Piano challenge' });
    expect(document.activeElement).toBe(dialog.firstElementChild);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onAbort).toHaveBeenCalledOnce();
  });
});
