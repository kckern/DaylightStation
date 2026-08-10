import fs from 'node:fs';
import YAML from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createInitialState, deriveInteraction, transition } from '@shared-gaming/index.mjs';
import { PokemonJourneyLobby } from './PokemonJourneyLobby.jsx';
import { PokemonJourneyView } from './PokemonJourneyView.jsx';

vi.mock('./journeySfx.js', () => ({ playJourneySfx: vi.fn() }));

const definition = YAML.parse(fs.readFileSync('shared/gaming/definitions/card-game.yml', 'utf8'));

function makeSession(state = createInitialState(definition, {
  seed: 7, participants: [{ user_id: 'kid-1' }], setup: { partner_id: 'bulbasaur' },
})) {
  return {
    session_id: 'game_journey', game_id: 'card-game', status: state.status, revision: 0,
    definition, state, interaction: deriveInteraction(state, definition, 'kid-1'), events: [],
  };
}

const baseProps = {
  onChoose: vi.fn(), onContinue: vi.fn(), onRetry: vi.fn(), onRestart: vi.fn(),
  onChangePartner: vi.fn(), onAbort: vi.fn(), onClose: vi.fn(),
};

describe('Pokémon journey kiosk views', () => {
  it('starts with partner choice, persistent mastery, and household records', () => {
    const onSelect = vi.fn();
    render(
      <PokemonJourneyLobby
        definition={definition}
        userId="kid-1"
        progress={{
          persistent: true,
          partners: { bulbasaur: { journeys_completed: 2 } },
          skill_stars: { scale: { stars: 2 }, chord: { stars: 1 } },
        }}
        leaderboard={{
          standings: [{ user_id: 'kid-1', score: 8123 }],
          alltime: { display_name: 'Big Sis', score: 9234 },
        }}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('Choose your practice partner')).toBeTruthy();
    expect(screen.getByText('8,123')).toBeTruthy();
    expect(screen.getByText('9,234')).toBeTruthy();
    expect(screen.getByText('Big Sis')).toBeTruthy();
    expect(screen.getByLabelText('2 stars')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Bulbasaur/ }));
    expect(onSelect).toHaveBeenCalledWith('bulbasaur');
  });

  it('presents four piano skills and reports direct, partial, or missed hits', () => {
    const { rerender } = render(
      <PokemonJourneyView
        {...baseProps}
        session={makeSession()}
        combatResult={{
          hitResult: 'direct-hit', hitFeedback: 'Direct hit', damage: 44,
          block: 0, focus: 0, resolving: false,
        }}
      />,
    );
    expect(screen.getAllByRole('button').filter((button) => button.dataset.moveId)).toHaveLength(4);
    expect(screen.getByText('Direct hit!')).toBeTruthy();
    expect(screen.getByText('44 damage')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Razor Leaf/ }).disabled).toBe(true);
    expect(screen.queryByText(/super effective/i)).toBeNull();

    rerender(
      <PokemonJourneyView
        {...baseProps}
        session={makeSession()}
        combatResult={{
          hitResult: 'partial-hit', hitFeedback: 'Partial hit', damage: 29,
          block: 0, focus: 0, resolving: false,
        }}
      />,
    );
    expect(screen.getByText('Partial hit')).toBeTruthy();
  });

  it('keeps both combatants visible while the real piano challenge is active', () => {
    const initial = createInitialState(definition, {
      seed: 7, participants: [{ user_id: 'kid-1' }], setup: { partner_id: 'bulbasaur' },
    });
    const scale = initial.zones.hand.find((move) => move.definition_id === 'vine-whip');
    const pending = transition(initial, {
      command_id: 'choose-scale', session_revision: 0, type: 'choose_action',
      payload: { card_instance_id: scale.instance_id },
    }, definition).state;
    const Surface = () => <div>Live piano staff</div>;
    render(
      <PokemonJourneyView
        {...baseProps}
        session={makeSession(pending)}
        providerRuntime={{ Surface }}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Vine Whip piano challenge' })).toBeTruthy();
    expect(screen.getByText('Accuracy decides direct hit, partial hit, or miss.')).toBeTruthy();
    expect(screen.getByText('Live piano staff')).toBeTruthy();
    expect(screen.getByAltText('Bulbasaur')).toBeTruthy();
    expect(screen.getByAltText('Pidgey')).toBeTruthy();
  });
});
