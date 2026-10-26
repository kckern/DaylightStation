// Small, non-secret intent identity; heartbeat-only changes leave it unchanged.
const FIELDS = ['phase', 'roundIndex', 'cat', 'row', 'attempt', 'answeringTeamId', 'turnTeamId', 'finalWagerCount', 'finalJudgedCount'];
const ACTIONS = new Set(['START_ROUND','SELECT_AT','SELECT_TILE','MOVE_CURSOR','BUZZ','REVEAL','JUDGE','TIMEOUT','RETURN_TO_BOARD','SET_WAGER','SET_FINAL_WAGER','JUDGE_FINAL','CONTINUE_ROUND','FINISH_GAME']);
export function needsCommandContext(type) {
  return ACTIONS.has(String(type).replace(/^jeopardy\./,'').replaceAll('.','_').toUpperCase());
}
export function commandContext(state = {}) {
  return Object.freeze({
    phase: state.phase ?? null, roundIndex: state.roundIndex ?? 0,
    cat: state.active?.cat ?? null, row: state.active?.row ?? null,
    attempt: state.attempted?.length ?? 0,
    answeringTeamId: state.answeringTeamId ?? null, turnTeamId: state.turnTeamId ?? null,
    finalWagerCount: state.finalWagerCount ?? Object.values(state.finalWagers || {}).filter(value => value != null).length,
    finalJudgedCount: state.finalJudgedCount ?? Object.values(state.finalJudged || {}).filter(value => value != null).length,
  });
}
export function contextKey(context) { return JSON.stringify(FIELDS.map(key => context?.[key] ?? null)); }
export function matchesCommandContext(state, context) {
  return !!context && FIELDS.every(key => Object.hasOwn(context,key)) && contextKey(commandContext(state)) === contextKey(context);
}
