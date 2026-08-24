import { useEffect, useRef } from 'react';
import './CardBattleView.scss';
import { CardIdenticon } from './CardIdenticon.jsx';
import { cardIdenticonHue } from './cardIdenticonModel.js';

function cardEffect(card) {
  if (card.type === 'guard') return { amount: card.block, label: 'block' };
  if (card.type === 'focus') return { amount: card.focus, label: 'focus' };
  return { amount: card.damage, label: 'damage' };
}

function contentAssetUrl(asset) {
  if (!asset) return null;
  if (/^(?:https?:)?\/\//.test(asset) || asset.startsWith('/')) return asset;
  return `/api/v1/proxy/media/stream/${encodeURIComponent(asset)}`;
}

function DisplayBadge({ badge = {} }) {
  const label = badge.label || 'Item';
  return (
    <span
      className="combatant-badge"
      style={{ '--combatant-type-color': badge.color || '#b7b7a8', '--combatant-type-ink': badge.ink || '#25251f' }}
    >
      {badge.symbol && <span aria-hidden="true">{badge.symbol}</span>}
      {label}
    </span>
  );
}

function resolveBadge(badge, catalog = {}) {
  if (typeof badge === 'string') return catalog[badge] || { label: badge };
  return badge && typeof badge === 'object' ? badge : null;
}

/**
 * One side of the mat. Whose card this is has to be answerable without reading
 * anything, so ownership rides on the frame (gold = yours, steel = theirs — the
 * same rule your hand cards follow) and on a full-width nameplate, not on a
 * caption. The badges live inside the art window so they track it at any size.
 */
function ThemedCombatant({ side, config, state, badgeCatalog }) {
  const display = config?.display || {};
  const mine = side === 'player';
  const healthPercent = Math.max(0, Math.min(100, (state.health / state.max_health) * 100));
  const attributes = Array.isArray(display.attributes) ? display.attributes : [];
  return (
    <article
      className={`combatant-combatant combatant-combatant--${side}`}
      data-side={side}
      aria-label={`${mine ? 'Your' : 'Opponent'} active Combatant: ${config.name}`}
    >
      <p className="combatant-combatant__side">{mine ? 'You' : 'Opponent'}</p>
      <header className="combatant-combatant__header">
        <strong>{config.name}</strong>
        <span className="combatant-combatant__hp"><b>{state.health}</b> HP</span>
      </header>
      <div className="combatant-combatant__art">
        {display.asset
          ? <img src={contentAssetUrl(display.asset)} alt={config.name} draggable="false" />
          : <CardIdenticon seed={`${display.identifier || side}:${config.name}`} />}
        {display.identifier && <span className="combatant-combatant__identifier">{display.identifier}</span>}
        {!mine && config.vulnerability && (
          <div className="combatant-combatant__vulnerability">
            {config.vulnerability.label || 'Vulnerability'} <DisplayBadge badge={resolveBadge(config.vulnerability.badge, badgeCatalog)} />
            {config.vulnerability.multiplier && <b>×{config.vulnerability.multiplier}</b>}
          </div>
        )}
        {mine && (
          <div className="combatant-combatant__energy" aria-label={`${state.energy} of ${state.max_energy} energy`}>
            <span>Energy</span>
            {Array.from({ length: state.max_energy }, (_, index) => (
              <i key={index} className={index < state.energy ? 'is-charged' : ''} aria-hidden="true">⚡</i>
            ))}
          </div>
        )}
      </div>
      <div className="combatant-combatant__health" style={{ '--health-percent': `${healthPercent}%` }}>
        <progress aria-label={`${config.name} health`} max={state.max_health} value={state.health} />
        <span aria-hidden="true" />
      </div>
      <footer className="combatant-combatant__footer">
        <span className="combatant-combatant__badges">
          {(display.badges || []).map((badge, index) => {
            const resolved = resolveBadge(badge, badgeCatalog);
            return <DisplayBadge key={`${resolved?.label || badge || 'badge'}:${index}`} badge={resolved} />;
          })}
        </span>
        <span>
          {[display.subtitle, ...attributes.map(({ label, value }) => `${label} ${value}`)].filter(Boolean).join(' · ') || 'Combatant'}
        </span>
      </footer>
    </article>
  );
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
              {result.passed === false && (result.failedCriteria?.length > 0 || result.failedGates?.length > 0) && (
                <small>Needs: {[...(result.failedCriteria || []), ...(result.failedGates || [])].join(', ')}</small>
              )}
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

function BattleStatus({ state, definition, combatResult, error, noPlayableCards, blockedReason, onRestart, themedMode = false }) {
  const enemyName = state.enemy.name;
  if (state.status === 'complete') {
    return (
      <div className="battle-result">
        <strong>{state.winner === 'player' ? (themedMode ? 'You win!' : 'Victory') : 'Defeated'}</strong>
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
    );
  }
  return (
    <>
      {combatResult
        ? <Resolution result={combatResult} enemyName={enemyName} />
        : noPlayableCards
          ? (
            <div className="battle-prompt battle-prompt--blocked">
              <strong>No playable card</strong>
              <span>{blockedReason} End your turn.</span>
            </div>
          )
          : (
            <div className="battle-prompt">
              <strong>{themedMode ? 'Choose a move.' : 'Play your hand.'}</strong>
              <span>
                {themedMode
                  ? (definition.presentation?.copy?.action_help || 'Complete the challenge to power the action.')
                  : 'Read the enemy\'s move, spend energy, then end your turn.'}
              </span>
            </div>
          )}
      {error && <div className="battle-warning">Recovered after: {error.message}</div>}
    </>
  );
}

function EnemyIntent({ intent, strength = 0, enemyName = null }) {
  if (!intent) return null;
  return (
    <div
      className={`combatant__intent combatant__intent--${intent.kind}`}
      data-intent-kind={intent.kind}
      data-intent-amount={intent.amount + (intent.kind === 'attack' ? strength : 0)}
    >
      {/* Ownerless "Next move" reads as if it could be yours — it is theirs. */}
      <span>{enemyName ? `${enemyName} will use` : 'Next move'}</span>
      <strong>{intent.title}</strong>
      <em>
        {intent.kind === 'attack' && `${intent.amount + strength} damage`}
        {intent.kind === 'defend' && `${intent.amount} block`}
        {intent.kind === 'charge' && `+${intent.amount} next attack`}
      </em>
    </div>
  );
}

function ChallengeDialog({ ChallengeSurface, onAbort, card = null, actorName = null, copy = {} }) {
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
    <div className="gaming-challenge-overlay" role="dialog" aria-modal="true" aria-label={copy.challenge_label || 'Action challenge'}>
      <div className="gaming-challenge-overlay__panel" ref={panelRef} tabIndex={-1}>
        {card && (
          <header className="combatant-challenge-heading">
            <span>{actorName || 'Your combatant'} used</span>
            <strong>{card.title}</strong>
            <small>{copy.challenge_help || 'Complete the challenge to power the action'}</small>
          </header>
        )}
        {ChallengeSurface
          ? <ChallengeSurface />
          : <div className="challenge-loading" role="status">Preparing challenge…</div>}
        <button type="button" className="challenge-abort" onClick={onAbort}>Cancel challenge</button>
      </div>
    </div>
  );
}

function MoveCard({ card, instance, legal, definition, actorDisplay, onChoose }) {
  const effect = cardEffect(card);
  const badge = resolveBadge(card.display?.badge, definition.presentation?.badges);
  const bestOutcome = card.outcomes?.[0];
  const recoveredOutcome = card.outcomes?.find((outcome) => outcome.min_score > 0 && outcome !== bestOutcome);
  return (
    <button
      type="button"
      className={`battle-card combatant-move-card battle-card--${card.type || 'attack'}`}
      key={instance.instance_id}
      style={{ '--card-hue': cardIdenticonHue(`${definition.game_id}:${instance.definition_id}`), '--move-type-color': badge?.color || '#b7b7a8' }}
      disabled={!legal}
      onClick={() => onChoose(instance.instance_id)}
      aria-label={`Play ${card.title}, ${effect.amount} ${effect.label}`}
      data-card-instance-id={instance.instance_id}
      data-card-definition-id={instance.definition_id}
      data-card-title={card.title}
      data-card-type={card.type || 'attack'}
      data-card-cost={card.cost}
      data-card-effect={effect.amount}
      data-challenge-kind={card.challenge?.kind || ''}
      data-display-badge={badge?.label || ''}
    >
      <span className="battle-card__art" aria-hidden="true">
        {actorDisplay?.asset
          ? <img src={contentAssetUrl(actorDisplay.asset)} alt="" draggable="false" />
          : <CardIdenticon seed={`${definition.game_id}:${instance.definition_id}`} />}
        {badge && <DisplayBadge badge={badge} />}
      </span>
      <span className="battle-card__body">
        <span className="battle-card__stats">
          <span><b>{card.cost}</b><small>energy</small></span>
          <span><b>{effect.amount}</b><small>{effect.label}</small></span>
        </span>
        <strong>{card.title}</strong>
        <span className="battle-card__description">{card.description}</span>
        <span className="combatant-move-card__power">
          <span>{bestOutcome?.power_label || `${Math.round((bestOutcome?.multiplier ?? 1) * 100)}% fluent`}</span>
          {recoveredOutcome && <span>{recoveredOutcome.power_label || `${Math.round(recoveredOutcome.multiplier * 100)}% recovered`}</span>}
        </span>
      </span>
    </button>
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
  const themedMode = Boolean(
    definition.card_battle?.player?.display
    || definition.card_battle?.enemy?.display,
  );
  const playerConfig = definition.card_battle.player;
  const enemyConfig = definition.card_battle.enemy;
  const badgeCatalog = definition.presentation?.badges || {};
  const pendingCard = state.pending_action
    ? definition.cards[state.pending_action.card_definition_id]
    : null;
  const impactClass = combatResult?.resolving
    ? ''
    : combatResult?.kind === 'enemy' && combatResult.damage > 0
      ? ' card-battle--player-hit'
      : combatResult?.kind === 'card' && combatResult.effectKind === 'attack' && combatResult.damage > 0
        ? ' card-battle--enemy-hit'
        : '';

  return (
    <main
      className={`gaming-shell card-battle${themedMode ? ' card-battle--combatant' : ''}${impactClass}`}
      aria-label={definition.title || 'Card battle'}
      data-game-id={definition.game_id}
      data-game-theme={definition.presentation?.theme || ''}
      data-turn={state.turn}
      data-battle-status={state.status}
      data-winner={state.winner || ''}
      data-player-health={state.player.health}
      data-player-energy={state.player.energy}
      data-enemy-health={state.enemy.health}
    >
      <header className="card-battle__header">
        <div className="card-battle__identity">
          <span className="card-battle__eyebrow">{themedMode ? (definition.presentation?.copy?.eyebrow || 'Battle') : `Turn ${state.turn}`}</span>
          <strong>{definition.title}</strong>
          {themedMode && <span className="card-battle__round">Turn {state.turn}</span>}
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

      {themedMode
        ? (
          <section className="combatant-battlefield" aria-live="polite">
            <ThemedCombatant side="enemy" config={enemyConfig} state={state.enemy} badgeCatalog={badgeCatalog} />
            <div className="combatant-battlefield__center">
              <EnemyIntent intent={intent} strength={state.enemy.strength} enemyName={state.enemy.name} />
              <div className="combatant-battlefield__versus" aria-hidden="true">VS</div>
              <BattleStatus
                state={state}
                definition={definition}
                combatResult={combatResult}
                error={error}
                noPlayableCards={noPlayableCards}
                blockedReason={blockedReason}
                onRestart={onRestart}
                themedMode
              />
            </div>
            <ThemedCombatant side="player" config={playerConfig} state={state.player} badgeCatalog={badgeCatalog} />
          </section>
        )
        : (
          <>
            <section className="combatant combatant--enemy">
              <div className="combatant__label">
                <span>Opponent</span>
                <strong>{state.enemy.name}</strong>
              </div>
              <EnemyIntent intent={intent} strength={state.enemy.strength} />
              <div className="combatant__health">
                <progress aria-label={`${state.enemy.name} health`} max={state.enemy.max_health} value={state.enemy.health} />
                <span>
                  {state.enemy.health} / {state.enemy.max_health}
                  {state.enemy.block > 0 ? ` · ${state.enemy.block} block` : ''}
                </span>
              </div>
            </section>

            <section className="battle-stage" aria-live="polite">
              <BattleStatus
                state={state}
                definition={definition}
                combatResult={combatResult}
                error={error}
                noPlayableCards={noPlayableCards}
                blockedReason={blockedReason}
                onRestart={onRestart}
              />
            </section>
          </>
        )}

      <section className="card-hand" aria-label="Your hand">
        <div className="card-hand__heading">
          <strong>{themedMode ? 'Move deck' : 'Your hand'}</strong>
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
            if (themedMode) {
              return (
                <MoveCard
                  key={instance.instance_id}
                  card={card}
                  instance={instance}
                  legal={legal}
                  definition={definition}
                  actorDisplay={playerConfig.display}
                  onChoose={onChoose}
                />
              );
            }
            return (
              <button
                type="button"
                className={`battle-card battle-card--${card.type || 'attack'}`}
                key={instance.instance_id}
                style={{ '--card-hue': cardHue }}
                disabled={!legal}
                onClick={() => onChoose(instance.instance_id)}
                aria-label={`Play ${card.title}, ${effect.amount} ${effect.label}`}
                data-card-instance-id={instance.instance_id}
                data-card-definition-id={instance.definition_id}
                data-card-title={card.title}
                data-card-type={card.type || 'attack'}
                data-card-cost={card.cost}
                data-card-effect={effect.amount}
                data-challenge-kind={card.challenge?.kind || ''}
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
        <ChallengeDialog
          ChallengeSurface={ChallengeSurface}
          onAbort={onAbort}
          card={themedMode ? pendingCard : null}
          actorName={themedMode ? playerConfig.name : null}
          copy={definition.presentation?.copy}
        />
      )}
    </main>
  );
}

export default CardBattleView;
