import { useEffect, useRef } from 'react';
import './CardBattleView.scss';
import { CardIdenticon } from './CardIdenticon.jsx';
import { cardIdenticonHue } from './cardIdenticonModel.js';

function cardEffect(card) {
  if (card.type === 'guard') return { amount: card.block, label: 'block' };
  if (card.type === 'focus') return { amount: card.focus, label: 'focus' };
  return { amount: card.damage, label: 'damage' };
}

function Resolution({ result, enemyName }) {
  return (
    <div className="battle-resolution" role="status">
      <span className="battle-resolution__card">{result.cardTitle}</span>
      {result.resolving
        ? <strong className="battle-resolution__pending">Resolving…</strong>
        : result.kind === 'enemy'
          ? (
            <>
              {result.enemyAction === 'attack' && <strong><b>{result.damage}</b> damage taken</strong>}
              {result.enemyAction === 'defend' && <strong><b>{result.block}</b> enemy block</strong>}
              {result.enemyAction === 'charge' && <strong><b>+{result.focus}</b> enemy power</strong>}
              {result.blocked > 0 && <span className="battle-resolution__effect">You blocked {result.blocked}</span>}
            </>
          )
          : (
            <>
              {result.effectKind === 'attack' && <strong><b>{result.damage}</b> damage</strong>}
              {result.effectKind === 'guard' && <strong><b>{result.block}</b> block gained</strong>}
              {result.effectKind === 'focus' && <strong><b>{result.focus}</b> focus gained</strong>}
              <span className="battle-resolution__effect">{result.effectiveness}</span>
            </>
          )}
      {result.absorbed > 0 && <span className="battle-resolution__counter">Enemy block absorbed {result.absorbed}</span>}
      {result.focusSpent > 0 && <span className="battle-resolution__bonus">Focus added {result.focusSpent} power</span>}
      {result.retaliation > 0 && (
        <span className="battle-resolution__counter">{enemyName} struck back for {result.retaliation}</span>
      )}
    </div>
  );
}

function ChallengeDialog({ ChallengeSurface, onAbort }) {
  const panelRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const panel = panelRef.current;
    panel?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onAbort?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(panel?.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])];
      if (focusable.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus?.();
    };
  }, [onAbort]);
  return (
    <div className="gaming-challenge-overlay" role="dialog" aria-modal="true" aria-label="Piano challenge">
      <div className="gaming-challenge-overlay__panel" ref={panelRef} tabIndex={-1}>
        {ChallengeSurface
          ? <ChallengeSurface />
          : <div className="challenge-loading" role="status">Preparing piano challenge…</div>}
        <button type="button" className="challenge-abort" onClick={onAbort}>Cancel challenge</button>
      </div>
    </div>
  );
}

export function CardBattleView({
  session,
  providerRuntime,
  combatResult = null,
  error,
  onChoose,
  onEndTurn,
  onRestart,
  onAbort,
  onClose,
}) {
  const { state, definition, interaction } = session;
  const legalCommands = interaction?.legal_commands || [];
  const legalIds = new Set(
    legalCommands
      .filter((command) => command.type === 'choose_action')
      .map((command) => command.payload?.card_instance_id),
  );
  const canEndTurn = legalCommands.some((command) => command.type === 'end_turn');
  const ChallengeSurface = providerRuntime?.Surface || null;
  const noPlayableCards = state.status === 'active' && !state.pending_action && legalIds.size === 0;
  const blockedReason = state.zones.hand.length === 0
    ? 'No cards in hand.'
    : `No card is affordable with ${state.player.energy} energy.`;
  const intent = state.enemy.intent;
  const impactClass = combatResult?.resolving
    ? ''
    : combatResult?.kind === 'enemy' && combatResult.damage > 0
      ? ' card-battle--player-hit'
      : combatResult?.kind === 'card' && combatResult.effectKind === 'attack' && combatResult.damage > 0
        ? ' card-battle--enemy-hit'
        : '';

  return (
    <main className={`gaming-shell card-battle${impactClass}`} aria-label={definition.title || 'Card battle'}>
      <header className="card-battle__header">
        <div className="card-battle__identity">
          <span className="card-battle__eyebrow">Turn {state.turn}</span>
          <strong>{definition.title}</strong>
        </div>
        <div className="card-battle__player-status" aria-label="Player status">
          <span><b>{state.player.health}</b> health</span>
          <span><b>{state.player.energy}</b> energy</span>
          {state.player.block > 0 && <span><b>{state.player.block}</b> block</span>}
          {state.player.focus > 0 && <span><b>{state.player.focus}</b> focus</span>}
          {state.applied_upgrade && <span className="player-upgrade">{state.applied_upgrade.title}</span>}
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close game">×</button>}
      </header>

      <section className="combatant combatant--enemy">
        <div className="combatant__label">
          <span>Opponent</span>
          <strong>{state.enemy.name}</strong>
        </div>
        {intent && (
          <div className={`combatant__intent combatant__intent--${intent.kind}`}>
            <span>Next move</span>
            <strong>{intent.title}</strong>
            <em>
              {intent.kind === 'attack' && `${intent.amount + state.enemy.strength} damage`}
              {intent.kind === 'defend' && `${intent.amount} block`}
              {intent.kind === 'charge' && `+${intent.amount} next attack`}
            </em>
          </div>
        )}
        <div className="combatant__health">
          <progress aria-label={`${state.enemy.name} health`} max={state.enemy.max_health} value={state.enemy.health} />
          <span>
            {state.enemy.health} / {state.enemy.max_health}
            {state.enemy.block > 0 ? ` · ${state.enemy.block} block` : ''}
          </span>
        </div>
      </section>

      <section className="battle-stage" aria-live="polite">
        {state.status === 'complete'
          ? (
            <div className="battle-result">
              <strong>{state.winner === 'player' ? 'Victory' : 'Defeated'}</strong>
              <span>
                {state.winner === 'player'
                  ? `${state.score ?? 0} score · ${state.turn} turns · ${state.player.health} health left`
                  : `${state.enemy.health} enemy health remained`}
              </span>
              {onRestart && state.winner === 'player' && definition.card_battle.upgrades?.length > 0
                ? (
                  <div className="battle-rewards">
                    <small>Choose a reward for the next battle</small>
                    {definition.card_battle.upgrades.map((upgrade) => (
                      <button key={upgrade.id} type="button" onClick={() => onRestart(upgrade.id)}>
                        <strong>{upgrade.title}</strong>
                        <span>{upgrade.description}</span>
                      </button>
                    ))}
                  </div>
                )
                : onRestart && <button type="button" onClick={() => onRestart(null)}>Play again</button>}
            </div>
          )
          : combatResult
            ? <Resolution result={combatResult} enemyName={state.enemy.name} />
            : noPlayableCards
              ? (
                <div className="battle-prompt battle-prompt--blocked">
                  <strong>No playable card</strong>
                  <span>{blockedReason} End your turn.</span>
                </div>
              )
              : (
                <div className="battle-prompt">
                  <strong>Play your hand.</strong>
                  <span>Read the enemy&apos;s move, spend energy, then end your turn.</span>
                </div>
              )}
        {error && <div className="battle-warning">Recovered after: {error.message}</div>}
      </section>

      <section className="card-hand" aria-label="Your hand">
        <div className="card-hand__heading">
          <strong>Your hand</strong>
          <span>{noPlayableCards ? 'Nothing playable' : 'Tap a card'}</span>
          <small>{state.zones.deck.length} deck · {state.zones.discard.length} discard</small>
          {canEndTurn && (
            <button type="button" className="end-turn" onClick={onEndTurn}>End turn</button>
          )}
        </div>
        <div className="card-hand__cards">
          {state.zones.hand.map((instance) => {
            const card = definition.cards[instance.definition_id];
            const legal = legalIds.has(instance.instance_id);
            const identiconSeed = `${definition.game_id}:${instance.definition_id}`;
            const cardHue = cardIdenticonHue(identiconSeed);
            const effect = cardEffect(card);
            return (
              <button
                type="button"
                className={`battle-card battle-card--${card.type || 'attack'}`}
                key={instance.instance_id}
                style={{ '--card-hue': cardHue }}
                disabled={!legal}
                onClick={() => onChoose(instance.instance_id)}
                aria-label={`Play ${card.title}, ${effect.amount} ${effect.label}`}
              >
                <span className="battle-card__art" aria-hidden="true">
                  <CardIdenticon seed={identiconSeed} />
                </span>
                <span className="battle-card__body">
                  <span className="battle-card__stats">
                    <span><b>{card.cost}</b><small>energy</small></span>
                    <span><b>{effect.amount}</b><small>{effect.label}</small></span>
                  </span>
                  <strong>{card.title}</strong>
                  <span className="battle-card__description">{card.description}</span>
                  <span className="battle-card__footer">
                    <span>{card.type || 'attack'}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h13M13 7l5 5-5 5" />
                    </svg>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {state.pending_action && (
        <ChallengeDialog ChallengeSurface={ChallengeSurface} onAbort={onAbort} />
      )}
    </main>
  );
}

export default CardBattleView;
