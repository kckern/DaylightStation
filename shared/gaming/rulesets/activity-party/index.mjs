import { defineRuleModule } from '../../kernel/index.mjs';
import { adjustScore } from '../../mechanics/scoring.mjs';
import { nextSeat } from '../../mechanics/turnOrder.mjs';
import { orderSeeded } from '../../mechanics/selection.mjs';
import { createCharadesChallengeOrder, createSeededRoundOrder } from './charadesSelection.mjs';

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
  if (definition?.competition != null && typeof definition.competition !== 'boolean') errors.push('competition must be boolean');
  if (definition?.turn_selection != null && definition.turn_selection !== 'seeded-rounds') errors.push('turn_selection must be seeded-rounds');
  if (definition?.clues_per_turn != null && (!Number.isInteger(definition.clues_per_turn) || definition.clues_per_turn < 1)) errors.push('clues_per_turn must be positive');
  if (definition?.presentation != null && (typeof definition.presentation !== 'object' || Array.isArray(definition.presentation))) errors.push('presentation must be an object');
  const imageParticipants = definition?.presentation?.image_participants;
  if (imageParticipants != null && (!Array.isArray(imageParticipants) || imageParticipants.some((id) => !['string', 'number'].includes(typeof id) || String(id).trim() === ''))) errors.push('presentation.image_participants must contain participant ids');
  if (Array.isArray(imageParticipants) && new Set(imageParticipants.map(String)).size !== imageParticipants.length) errors.push('presentation.image_participants must be unique');
  if (definition?.guessing_music != null) {
    if (typeof definition.guessing_music !== 'object' || Array.isArray(definition.guessing_music)) errors.push('guessing_music must be an object');
    else {
      if (typeof definition.guessing_music.source !== 'string' || definition.guessing_music.source.trim() === '') errors.push('guessing_music.source is required');
      if (!Number.isFinite(definition.guessing_music.volume) || definition.guessing_music.volume < 0 || definition.guessing_music.volume > 1) errors.push('guessing_music.volume must be between 0 and 1');
    }
  }
  if (definition?.competition === false) {
    if (definition.turn_selection !== 'seeded-rounds') errors.push('casual play requires turn_selection seeded-rounds');
    if (!Number.isInteger(definition.clues_per_turn) || definition.clues_per_turn < 1) errors.push('casual play requires positive clues_per_turn');
    if (!Array.isArray(imageParticipants)) errors.push('casual play requires presentation.image_participants');
    if (typeof definition.guessing_music?.source !== 'string' || definition.guessing_music.source.trim() === '') errors.push('casual play requires guessing_music');
  }
  return { valid: errors.length === 0, errors };
}

const challengeFor = (definition, order, index) => structuredClone(definition.challenges[order[index % order.length]]);
const authoredChallengeOrder = (definition) => definition.challenges.map((_, index) => index);
const casualMode = (state, definition) => state?.competition === false || definition?.competition === false;

function casualChallengeFor(definition, state, challengeIndex = state.challenge_index, clueIndex = state.clue_index) {
  const offset = challengeIndex * definition.clues_per_turn + clueIndex;
  return structuredClone(definition.challenges[state.challenge_order[offset]]);
}

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
    if (definition.competition === false) {
      const turns = createSeededRoundOrder(performers, definition.rounds, seed);
      const challenges = createCharadesChallengeOrder({
        challenges: definition.challenges,
        turnOrder: turns.order,
        cluesPerTurn: definition.clues_per_turn,
        imageParticipantIds: definition.presentation.image_participants,
        seed: turns.rngState,
      });
      const firstChallenge = structuredClone(definition.challenges[challenges.order[0]]);
      return {
        status: 'active', phase: 'performer-ready', competition: false, round: 1,
        turn_order: turns.order, challenge_index: 0, clue_index: 0,
        clue_presentation: challenges.presentations[0], challenge: firstChallenge,
        challenge_order: challenges.order, clue_presentations: challenges.presentations,
        performers, performer_id: turns.order[0] || null,
        verifier_id: null, pending_outcome: null, deadline: null,
        remaining_ms: definition.timer_ms, scores: {},
        host: setup.host || { mode: 'human' }, revealed_hints: 0,
      };
    }
    const authoredOrder = authoredChallengeOrder(definition);
    const challengeOrder = definition.challenge_selection === 'seeded'
      ? orderSeeded(authoredOrder, seed).ordered
      : authoredOrder;
    return {
      status: 'active', phase: 'performer-ready', competition: true, round: 1, challenge_index: 0,
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
    const casual = casualMode(state, definition);
    if (command.type === 'performer.ready' && requirePhase('performer-ready')) {
      if (!actorIsHost(context.actorId) && !actorIsPerformer(state, context.actorId)) return denied('Only the active performer or host may confirm readiness');
      next.phase = 'challenge-ready'; events.push({ type: 'performer.ready', performer_id: state.performer_id });
    } else if (command.type === 'challenge.start' && requirePhase('challenge-ready')) {
      if (!actorIsHost(context.actorId)) return denied('Only the host may start the challenge timer');
      next.phase = 'performing'; next.deadline = context.logicalTime + (casual ? state.remaining_ms : definition.timer_ms); events.push({ type: 'challenge.started', deadline: next.deadline });
    } else if (command.type === 'host.reveal' && requirePhase('performing', 'adjudication')) {
      if (!actorIsHost(context.actorId)) return denied('Only the host may reveal an aid');
      const hints = state.challenge?.hints || [];
      next.revealed_hints = Math.min(hints.length, state.revealed_hints + 1); events.push({ type: 'host.reveal.advanced', revealed_hints: next.revealed_hints });
    } else if (['challenge.finish', 'timer.expire'].includes(command.type) && requirePhase('performing')) {
      if (command.type === 'timer.expire' && !actorIsHost(context.actorId)) return denied('Only the host may expire the timer');
      if (command.type === 'timer.expire' && context.logicalTime < state.deadline) return { error: { code: 'illegal_command', message: 'The challenge timer has not expired' } };
      if (command.type === 'challenge.finish' && !actorIsHost(context.actorId) && !actorIsPerformer(state, context.actorId)) return denied('Only the active performer or host may finish the challenge');
      if (casual) {
        next.remaining_ms = command.type === 'timer.expire'
          ? 0
          : Math.max(0, state.deadline - Number(context.logicalTime ?? state.deadline));
        next.phase = 'challenge-complete';
      } else next.phase = 'adjudication';
      events.push({ type: 'challenge.finished' });
    } else if (casual && ['outcome.correct', 'outcome.incorrect', 'outcome.pass', 'outcome.confirm', 'score.adjust'].includes(command.type)) {
      return { error: { code: 'illegal_command', message: `${command.type} is not available in casual play` } };
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
      if (casual) {
        const hasAnotherClue = state.remaining_ms > 0 && state.clue_index + 1 < definition.clues_per_turn;
        next.deadline = null; next.revealed_hints = 0;
        if (hasAnotherClue) {
          next.clue_index += 1;
          next.challenge = casualChallengeFor(definition, next);
          next.clue_presentation = next.clue_presentations[next.challenge_index * definition.clues_per_turn + next.clue_index];
          next.phase = 'challenge-ready';
          events.push({ type: 'challenge.selected', challenge_index: next.challenge_index, clue_index: next.clue_index });
        } else {
          next.challenge_index += 1; next.clue_index = 0; next.remaining_ms = definition.timer_ms;
          if (next.challenge_index >= state.turn_order.length) {
            next.status = 'complete'; next.phase = 'complete'; events.push({ type: 'game.completed' });
          } else {
            next.performer_id = next.turn_order[next.challenge_index];
            next.round = Math.floor(next.challenge_index / state.performers.length) + 1;
            next.challenge = casualChallengeFor(definition, next);
            next.clue_presentation = next.clue_presentations[next.challenge_index * definition.clues_per_turn];
            next.phase = 'performer-ready';
            events.push({ type: 'challenge.selected', challenge_index: next.challenge_index, clue_index: 0 });
          }
        }
      } else {
        const nextPerformer = nextSeat(state.performers, state.performer_id);
        next.challenge_index += 1; next.performer_id = nextPerformer?.id || null; next.deadline = null; next.revealed_hints = 0;
        if (next.challenge_index >= state.performers.length * definition.rounds) { next.status = 'complete'; next.phase = 'complete'; events.push({ type: 'game.completed' }); }
        else { next.round = Math.floor(next.challenge_index / state.performers.length) + 1; next.challenge = challengeFor(definition, next.challenge_order || authoredChallengeOrder(definition), next.challenge_index); next.phase = 'performer-ready'; events.push({ type: 'challenge.selected', challenge_index: next.challenge_index }); }
      }
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
    return {
      state: projected,
      definition: {
        title: definition.title, rounds: definition.rounds, timer_ms: definition.timer_ms,
        correct_points: definition.correct_points, competition: definition.competition ?? true,
        turn_selection: definition.turn_selection, clues_per_turn: definition.clues_per_turn ?? 1,
        presentation: structuredClone(definition.presentation || { image_participants: [] }),
        guessing_music: structuredClone(definition.guessing_music || null),
      },
      interaction: { phase: state.phase, performer_id: state.performer_id, viewer_actor_id: viewerActorId, can_verify: state.phase === 'verification' && viewerActorId === state.verifier_id },
    };
  },
});
