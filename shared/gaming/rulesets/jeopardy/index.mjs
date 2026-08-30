import { defineRuleModule } from '../../kernel/index.mjs';
import { initJeopardy, jeopardyReducer, scoreDelta } from './stateMachine.mjs';
import { adjustScore } from '../../mechanics/scoring.mjs';

export function validateJeopardyDefinition(definition) {
  const errors = [];
  if (!definition || typeof definition !== 'object') errors.push('definition is required');
  if (!Array.isArray(definition?.rounds) || definition.rounds.length === 0) errors.push('rounds are required');
  for (const [roundIndex, round] of (definition?.rounds || []).entries()) {
    if (!Array.isArray(round.categories) || round.categories.length === 0) errors.push(`round ${roundIndex + 1} requires categories`);
    for (const category of round.categories || []) if (!Array.isArray(category.clues) || category.clues.length === 0) errors.push(`category ${category.title || '?'} requires clues`);
  }
  return { valid: errors.length === 0, errors };
}

function participantProjection(state, viewer) {
  const projected = structuredClone(state);
  const viewerTeam = teamForActor(state, viewer?.participant_id);
  delete projected.team_actors;
  const showActiveAnswer = state.revealed === true || ['final-judging', 'done'].includes(state.phase);
  projected.set.rounds = projected.set.rounds.map((round) => ({
    ...round,
    categories: round.categories.map((category) => ({
      ...category,
      clues: category.clues.map((clue) => ({ value: clue.value })),
    })),
  }));
  if (projected.active?.clue) {
    const clue = state.active.clue;
    projected.active.clue = {
      value: clue.value,
      clue: clue.clue,
      ...(clue.media ? { media: structuredClone(clue.media) } : {}),
      ...(showActiveAnswer ? { answer: clue.answer } : {}),
    };
  }
  if (projected.set.final) {
    const final = state.set.final;
    const showFinalClue = ['final-clue', 'final-judging', 'done'].includes(state.phase);
    projected.set.final = {
      category: final.category,
      ...(showFinalClue ? { clue: final.clue, ...(final.media ? { media: structuredClone(final.media) } : {}) } : {}),
      ...(['final-judging', 'done'].includes(state.phase) ? { answer: final.answer } : {}),
    };
  }
  if (!['final-judging', 'done'].includes(state.phase)) {
    projected.finalWagers = Object.fromEntries(state.teamIds.map((teamId) => [teamId, teamId === viewerTeam ? state.finalWagers[teamId] ?? null : null]));
  }
  return projected;
}

const HOST_ACTIONS = new Set(['START_ROUND', 'SELECT_TILE', 'SELECT_AT', 'MOVE_CURSOR', 'TIMEOUT', 'REVEAL', 'JUDGE', 'JUDGE_FINAL']);
const actorIsHost = (actorId) => actorId === 'host' || actorId === 'system';

function teamForActor(state, actorId) {
  if (state.teamIds?.includes(String(actorId))) return String(actorId);
  return Object.entries(state.team_actors || {}).find(([, actorIds]) => actorIds.includes(String(actorId)))?.[0] || null;
}

function authorizeAction(state, action, actorId) {
  if (actorIsHost(actorId)) return null;
  if (HOST_ACTIONS.has(action.type)) return { code: 'authorization_denied', message: 'Only the host may issue this Jeopardy command' };
  const actorTeam = teamForActor(state, actorId);
  if (!actorTeam) return { code: 'authorization_denied', message: 'Actor is not bound to a Jeopardy team' };
  if (action.type === 'BUZZ' && action.teamId !== actorTeam) return { code: 'authorization_denied', message: 'A participant may buzz only for their own team' };
  if (action.type === 'SET_WAGER' && state.answeringTeamId !== actorTeam) return { code: 'authorization_denied', message: 'Only the answering team may set this wager' };
  if (action.type === 'SET_FINAL_WAGER' && action.teamId !== actorTeam) return { code: 'authorization_denied', message: 'A participant may set only their own final wager' };
  if (!['BUZZ', 'SET_WAGER', 'SET_FINAL_WAGER'].includes(action.type)) return { code: 'authorization_denied', message: 'Participant command is not authorized' };
  return null;
}

function maximumWager(state, teamId) {
  const round = state.set.rounds[state.roundIndex] || state.set.rounds.at(-1);
  const roundMaximum = Math.max(...(round?.categories || []).flatMap((category) => category.clues.map((clue) => Number(clue.value) || 0)), 0) * (Number(round?.multiplier) || 1);
  return Math.max(5, Number(state.scores?.[teamId]) || 0, roundMaximum);
}

function validateWager(state, action) {
  if (!['SET_WAGER', 'SET_FINAL_WAGER'].includes(action.type)) return null;
  const teamId = action.type === 'SET_WAGER' ? state.answeringTeamId : action.teamId;
  const amount = Number(action.amount);
  if (!teamId || !Number.isInteger(amount) || amount < 5 || amount > maximumWager(state, teamId)) {
    return { code: 'invalid_wager', message: 'Wager is outside the authoritative bounds' };
  }
  return null;
}

export const jeopardyRuleModule = defineRuleModule({
  id: 'jeopardy', version: 1, validateDefinition: validateJeopardyDefinition,
  createInitialState(definition, { seats = [], setup = {} }) {
    const teams = setup.teams || seats;
    const teamIds = teams.map((team) => team.id);
    const teamActors = Object.fromEntries(teams.map((team) => [team.id, (team.members || []).flatMap((member) => [member?.id, member?.user_id, member?.participant_id, member]).filter(Boolean).map(String)]));
    const normalizedDefinition = {
      ...definition,
      rounds: definition.rounds.map((round) => ({ ...round, multiplier: Number(round.multiplier) > 0 ? Number(round.multiplier) : 1 })),
    };
    return { ...initJeopardy(normalizedDefinition, teamIds), scores: Object.fromEntries(teamIds.map((id) => [id, 0])), team_actors: teamActors, status: 'active' };
  },
  handleCommand(state, command, _definition, context) {
    if (state.status !== 'active') return { error: { code: 'session_terminal', message: 'Jeopardy session is complete' } };
    const action = { ...command, type: command.type.replace(/^jeopardy\./, '').replaceAll('.', '_').toUpperCase() };
    const authorizationError = authorizeAction(state, action, context.actorId);
    if (authorizationError) return { error: authorizationError };
    const wagerError = validateWager(state, action);
    if (wagerError) return { error: wagerError };
    let delta = action.type === 'JUDGE' ? scoreDelta(state, action.correct) : null;
    if (action.type === 'JUDGE_FINAL' && state.finalWagers[action.teamId] != null) {
      const wager = Number(state.finalWagers[action.teamId]) || 0;
      delta = { teamId: action.teamId, delta: action.correct ? wager : -wager };
    }
    const reduced = jeopardyReducer(state, action);
    if (reduced === state) return { error: { code: 'illegal_command', message: `${command.type} is not legal during ${state.phase}` } };
    const next = { ...reduced, scores: delta ? adjustScore(state.scores, delta.teamId, delta.delta) : state.scores };
    if (next.phase === 'done') next.status = 'complete';
    return { state: next, status: next.status, events: [{ type: command.type, phase: next.phase, ...(delta ? { score_delta: delta } : {}) }] };
  },
  project(state, _definition, viewer) {
    return { state: viewer?.role === 'host' || viewer?.role === 'system' ? structuredClone(state) : participantProjection(state, viewer), interaction: { phase: state.phase } };
  },
});

export * from './stateMachine.mjs';
export * from './content.mjs';
