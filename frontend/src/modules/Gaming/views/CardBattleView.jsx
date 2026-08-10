import './CardBattleView.scss';

export function CardBattleView({ session, providerRuntime, error, onChoose, onAbort, onClose }) {
  const { state, definition, interaction } = session;
  const legalIds = new Set(
    (interaction?.legal_commands || []).map((command) => command.payload?.card_instance_id),
  );
  const ChallengeSurface = providerRuntime?.Surface || null;
  const noPlayableCards = state.status === 'active' && !state.pending_action && legalIds.size === 0;
  const blockedReason = state.zones.hand.length === 0
    ? 'No cards in hand.'
    : `No card is affordable with ${state.player.energy} energy.`;

  return (
    <main className="gaming-shell card-battle" aria-label={definition.title || 'Card battle'}>
      <header className="card-battle__header">
        <div className="card-battle__identity">
          <span className="card-battle__eyebrow">Turn {state.turn}</span>
          <strong>{definition.title}</strong>
        </div>
        <div className="card-battle__player-status" aria-label="Player status">
          <span><b>{state.player.health}</b> health</span>
          <span><b>{state.player.energy}</b> energy</span>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close game">×</button>}
      </header>

      <section className="combatant combatant--enemy">
        <div className="combatant__label">
          <span>Opponent</span>
          <strong>{state.enemy.name}</strong>
        </div>
        <div className="combatant__health">
          <progress max={state.enemy.max_health} value={state.enemy.health} />
          <span>{state.enemy.health} / {state.enemy.max_health}</span>
        </div>
      </section>

      <section className="battle-stage" aria-live="polite">
        {state.status === 'complete'
          ? <div className="battle-result">{state.winner === 'player' ? 'Victory!' : 'Defeated'}</div>
          : noPlayableCards
            ? <div className="battle-prompt battle-prompt--blocked"><strong>No card available</strong><span>{blockedReason}</span></div>
            : <div className="battle-prompt"><strong>Choose a card.</strong><span>The piano challenge begins after you play it.</span></div>}
        {error && <div className="battle-warning">Recovered after: {error.message}</div>}
      </section>

      <section className="card-hand" aria-label="Your hand">
        <div className="card-hand__heading">
          <strong>Your hand</strong>
          <span>{noPlayableCards ? 'Nothing playable' : 'Tap a card'}</span>
        </div>
        <div className="card-hand__cards">
          {state.zones.hand.map((instance) => {
            const card = definition.cards[instance.definition_id];
            const legal = legalIds.has(instance.instance_id);
            return (
              <button
                type="button"
                className="battle-card"
                key={instance.instance_id}
                disabled={!legal}
                onClick={() => onChoose(instance.instance_id)}
                aria-label={`Play ${card.title}, ${card.damage} damage`}
              >
                <span className="battle-card__meta"><span>{card.cost} energy</span><span>{card.damage} damage</span></span>
                <strong>{card.title}</strong>
                <span className="battle-card__detail">Attack card</span>
                <span className="battle-card__action">Play card</span>
              </button>
            );
          })}
        </div>
      </section>

      {state.pending_action && (
        <div className="gaming-challenge-overlay" role="dialog" aria-modal="true" aria-label="Piano challenge">
          <div className="gaming-challenge-overlay__panel">
            {ChallengeSurface
              ? <ChallengeSurface />
              : <div className="challenge-loading">Preparing {state.pending_action.request.prompt.label}…</div>}
            <button type="button" className="challenge-abort" onClick={onAbort}>Cancel scale</button>
          </div>
        </div>
      )}
    </main>
  );
}

export default CardBattleView;
