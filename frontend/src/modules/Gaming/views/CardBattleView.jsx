import './CardBattleView.scss';

export function CardBattleView({ session, providerRuntime, error, onChoose, onAbort, onClose }) {
  const { state, definition, interaction } = session;
  const legalIds = new Set(
    (interaction?.legal_commands || []).map((command) => command.payload?.card_instance_id),
  );
  const ChallengeSurface = providerRuntime?.Surface || null;

  return (
    <main className="gaming-shell card-battle" aria-label={definition.title || 'Card battle'}>
      <header className="card-battle__header">
        <div><span>Turn {state.turn}</span><strong>{definition.title}</strong></div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close game">×</button>}
      </header>

      <section className="combatant combatant--enemy">
        <h1>{state.enemy.name}</h1>
        <meter min="0" max={state.enemy.max_health} value={state.enemy.health} />
        <span>{state.enemy.health} / {state.enemy.max_health} HP</span>
      </section>

      <section className="battle-stage" aria-live="polite">
        {state.status === 'complete'
          ? <div className="battle-result">{state.winner === 'player' ? 'Victory!' : 'Defeated'}</div>
          : <div className="battle-prompt">Choose a card</div>}
        {error && <div className="battle-warning">Recovered after: {error.message}</div>}
      </section>

      <section className="combatant combatant--player">
        <div><strong>You</strong><span>⚡ {state.player.energy} / {state.player.max_energy}</span></div>
        <meter min="0" max={state.player.max_health} value={state.player.health} />
        <span>{state.player.health} / {state.player.max_health} HP</span>
      </section>

      <section className="card-hand" aria-label="Your hand">
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
            >
              <span className="battle-card__cost">{card.cost}⚡</span>
              <strong>{card.title}</strong>
              <span>Play {card.challenge.prompt.label}</span>
              <span>{card.damage} damage</span>
            </button>
          );
        })}
      </section>

      {state.pending_action && (
        <div className="challenge-overlay" role="dialog" aria-modal="true" aria-label="Piano challenge">
          {ChallengeSurface
            ? <ChallengeSurface />
            : <div className="challenge-loading">Preparing {state.pending_action.request.prompt.label}…</div>}
          <button type="button" className="challenge-abort" onClick={onAbort}>Return to battle</button>
        </div>
      )}
    </main>
  );
}

export default CardBattleView;
