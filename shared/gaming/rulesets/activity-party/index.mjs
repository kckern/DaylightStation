import { defineRuleModule } from '../../kernel/index.mjs';
import { adjustScore } from '../../mechanics/scoring.mjs';
import { nextSeat } from '../../mechanics/turnOrder.mjs';
import { orderSeeded } from '../../mechanics/selection.mjs';

export function validateActivityPartyDefinition(definition) {
  const errors = [];
  if (!Array.isArray(definition?.activities) || definition.activities.some((activity) => !['draw', 'charades'].includes(activity))) errors.push('activities must contain draw and/or charades');
  if (!Array.isArray(definition?.challenges) || definition.challenges.length === 0) errors.push('challenges are required');
  for (const [index, challenge] of (definition?.challenges || []).entries()) {
    if (!definition.activities?.includes(challenge?.activity)) errors.push(`challenge ${index + 1} uses an unavailable activity`);
    if (typeof challenge?.prompt !== 'string' || challenge.prompt.trim() === '') errors.push(`challenge ${index + 1} requires a prompt`);
    if (challenge?.hints != null && (!Array.isArray(challenge.hints) || challenge.hints.some((hint) => typeof hint !== 'string'))) errors.push(`challenge ${index + 1} hints must be strings`);
  }
  if (!Number.isInteger(definition?.rounds) || definition.rounds < 1) errors.push('rounds must be positive');
  if (!Number.isFinite(definition?.timer_ms) || definition.timer_ms <= 0) errors.push('timer_ms must be positive');
  if (definition?.challenge_selection != null && !['authored', 'seeded'].includes(definition.challenge_selection)) errors.push('challenge_selection must be authored or seeded');
  return { valid: errors.length === 0, errors };
}

const challengeFor = (definition, order, index) => structuredClone(definition.challenges[order[index % order.length]]);
const authoredChallengeOrder = (definition) => definition.challenges.map((_, index) => index);

const actorIsHost = (actorId) => actorId === 'host' || actorId === 'system';

function actorIsPerformer(state, actorId) {
  const performer = state.performers.find((entry) => String(entry.id) === String(state.performer_id));
  if (!performer) return false;
  const ids = [performer.id, performer.participant_id, ...(performer.members || []).flatMap((member) => [member?.id, member?.user_id, member?.participant_id, member])];
  return ids.filter(Boolean).some((id) => String(id) === String(actorId));
}

const denied = (message) => ({ error: { code: 'authorization_denied', message } });

export const activityPartyRuleModule = defineRuleModule({
  id: 'activity-party', version: 1, validateDefinition: validateActivityPartyDefinition,
  createInitialState(definition, { seed, participants = [], seats = [], setup = {} }) {
    const performers = seats.length ? seats : participants.map((participant) => ({ id: participant.id || participant.user_id, participant_id: participant.id || participant.user_id }));
    const authoredOrder = authoredChallengeOrder(definition);
    const challengeOrder = definition.challenge_selection === 'seeded'
      ? orderSeeded(authoredOrder, seed).ordered
      : authoredOrder;
    return {
      status: 'active', phase: 'performer-ready', round: 1, challenge_index: 0,
      challenge: challengeFor(definition, challengeOrder, 0), challenge_order: challengeOrder,
      performers, performer_id: performers[0]?.id || null,
      verifier_id: setup.verifier_id || null, pending_outcome: null, deadline: null,
      scores: Object.fromEntries(performers.map((performer) => [performer.team_id || performer.id, 0])),
      host: setup.host || { mode: 'human' }, revealed_hints: 0,
    };
  },
  handleCommand(state, command, definition, context) {
    const next = structuredClone(state); const events = [];
    const requirePhase = (...phases) => phases.includes(state.phase);
    if (command.type === 'performer.ready' && requirePhase('performer-ready')) {
      if (!actorIsHost(context.actorId) && !actorIsPerformer(state, context.actorId)) return denied('Only the active performer or host may confirm readiness');
      next.phase = 'challenge-ready'; events.push({ type: 'performer.ready', performer_id: state.performer_id });
    } else if (command.type === 'challenge.start' && requirePhase('challenge-ready')) {
      if (!actorIsHost(context.actorId)) return denied('Only the host may start the challenge timer');
      next.phase = 'performing'; next.deadline = context.logicalTime + definition.timer_ms; events.push({ type: 'challenge.started', deadline: next.deadline });
    } else if (command.type === 'host.reveal' && requirePhase('performing', 'adjudication')) {
      if (!actorIsHost(context.actorId)) return denied('Only the host may reveal an aid');
      const hints = state.challenge?.hints || [];
      next.revealed_hints = Math.min(hints.length, state.revealed_hints + 1); events.push({ type: 'host.reveal.advanced', revealed_hints: next.revealed_hints });
    } else if (['challenge.finish', 'timer.expire'].includes(command.type) && requirePhase('performing')) {
      if (command.type === 'timer.expire' && !actorIsHost(context.actorId)) return denied('Only the host may expire the timer');
      if (command.type === 'timer.expire' && context.logicalTime < state.deadline) return { error: { code: 'illegal_command', message: 'The challenge timer has not expired' } };
      if (command.type === 'challenge.finish' && !actorIsHost(context.actorId) && !actorIsPerformer(state, context.actorId)) return denied('Only the active performer or host may finish the challenge');
      next.phase = 'adjudication'; events.push({ type: 'challenge.finished' });
    } else if (['outcome.correct', 'outcome.incorrect', 'outcome.pass'].includes(command.type) && requirePhase('performing', 'adjudication')) {
      if (state.host.mode === 'human' && !actorIsHost(context.actorId)) return denied('Only the human host may adjudicate an outcome');
      if (state.host.mode !== 'human' && !actorIsHost(context.actorId) && !actorIsPerformer(state, context.actorId) && context.actorId !== state.verifier_id) return denied('Only the performer, host service, or configured verifier may propose an outcome');
      if (command.type === 'outcome.pass' && !actorIsHost(context.actorId) && !actorIsPerformer(state, context.actorId)) return denied('Only the performer or host may pass a challenge');
      if (state.host.mode !== 'human' && command.type !== 'outcome.pass' && !state.verifier_id) return { error: { code: 'verifier_required', message: 'Hostless subjective outcomes require a configured verifier' } };
      const subjective = state.host.mode !== 'human' && command.type !== 'outcome.pass';
      if (subjective && context.actorId !== state.verifier_id) {
        next.pending_outcome = { type: command.type, proposed_by: context.actorId }; next.phase = 'verification';
        events.push({ type: 'outcome.proposed', outcome: command.type });
      } else {
        const score = command.type === 'outcome.correct' ? Number(definition.correct_points ?? 1) : 0;
        const subject = state.performers.find((seat) => seat.id === state.performer_id)?.team_id || state.performer_id;
        next.scores = adjustScore(next.scores, subject, score); next.phase = 'challenge-complete';
        events.push({ type: 'outcome.committed', outcome: command.type, score });
      }
    } else if (command.type === 'outcome.confirm' && requirePhase('verification') && context.actorId === state.verifier_id) {
      const proposed = state.pending_outcome; const score = proposed?.type === 'outcome.correct' ? Number(definition.correct_points ?? 1) : 0;
      const subject = state.performers.find((seat) => seat.id === state.performer_id)?.team_id || state.performer_id;
      next.scores = adjustScore(next.scores, subject, command.accepted === false ? 0 : score); next.pending_outcome = null; next.phase = 'challenge-complete';
      events.push({ type: 'outcome.confirmed', accepted: command.accepted !== false, score: command.accepted === false ? 0 : score });
    } else if (command.type === 'outcome.confirm' && requirePhase('verification')) {
      return denied('Only the configured verifier may confirm an outcome');
    } else if (command.type === 'score.adjust' && state.host.mode === 'human') {
      if (!actorIsHost(context.actorId)) return denied('Only the human host may adjust scores');
      const delta = Number(command.delta);
      if (!Object.hasOwn(state.scores, command.subject_id) || !Number.isFinite(delta)) return { error: { code: 'invalid_score_adjustment', message: 'Score adjustment requires a known subject and finite delta' } };
      next.scores = adjustScore(next.scores, command.subject_id, delta); events.push({ type: 'score.adjusted', subject_id: command.subject_id, delta });
    } else if (command.type === 'challenge.next' && requirePhase('challenge-complete')) {
      if (!actorIsHost(context.actorId)) return denied('Only the host may advance the performer rotation');
      const nextPerformer = nextSeat(state.performers, state.performer_id);
      next.challenge_index += 1; next.performer_id = nextPerformer?.id || null; next.deadline = null; next.revealed_hints = 0;
      if (next.challenge_index >= state.performers.length * definition.rounds) { next.status = 'complete'; next.phase = 'complete'; events.push({ type: 'game.completed' }); }
      else { next.round = Math.floor(next.challenge_index / state.performers.length) + 1; next.challenge = challengeFor(definition, next.challenge_order || authoredChallengeOrder(definition), next.challenge_index); next.phase = 'performer-ready'; events.push({ type: 'challenge.selected', challenge_index: next.challenge_index }); }
    } else return { error: { code: 'illegal_command', message: `${command.type} is not legal during ${state.phase}` } };
    return { state: next, status: next.status, events };
  },
  project(state, definition, viewer) {
    const projected = structuredClone(state);
    const performer = state.performers.find((entry) => entry.id === state.performer_id);
    const performerMemberIds = new Set((performer?.members || []).map((member) => String(member.id || member.user_id || member.participant_id || member)));
    const maySeeSecret = viewer?.role === 'host'
      || viewer?.participant_id === state.performer_id
      || (state.phase === 'verification' && viewer?.participant_id === state.verifier_id)
      || performerMemberIds.has(String(viewer?.participant_id || ''));
    if (!maySeeSecret && projected.challenge) {
      projected.challenge = { id: projected.challenge.id, activity: projected.challenge.activity };
    }
    const viewerActorId = viewer?.participant_id || (viewer?.role === 'host' ? 'host' : null);
    return { state: projected, definition: { title: definition.title, rounds: definition.rounds, timer_ms: definition.timer_ms, correct_points: definition.correct_points }, interaction: { phase: state.phase, performer_id: state.performer_id, viewer_actor_id: viewerActorId, can_verify: state.phase === 'verification' && viewerActorId === state.verifier_id } };
  },
});
