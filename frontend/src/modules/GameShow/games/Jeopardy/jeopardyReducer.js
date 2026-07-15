// Pure Jeopardy state machine. Scores live in the shell's scoreReducer —
// components call scoreDelta(state, correct) BEFORE dispatching JUDGE and
// apply the delta to the scoreboard. All three per-round modes (spec §7):
//   hosted: buzz → host judges; wrong re-arms remaining teams
//   self:   buzz → answer auto-reveals → single confirm
//   turns:  active team answers; rotation advances every clue

export function currentRound(state) { return state.set.rounds[state.roundIndex]; }
export function clueAt(state, cat, row) { return currentRound(state)?.categories[cat]?.clues[row] || null; }
export function isUsed(state, cat, row) { return !!state.used[`${state.roundIndex}:${cat}:${row}`]; }

export function boardDone(state) {
  const round = currentRound(state);
  if (!round) return true;
  return round.categories.every((c, cat) => c.clues.every((_, row) => isUsed(state, cat, row)));
}

export function scoreDelta(state, correct) {
  const teamId = state.answeringTeamId;
  if (!teamId || !state.active) return null;
  const base = state.isDailyDouble ? state.wager : state.active.clue.value * currentRound(state).multiplier;
  if (correct) return { teamId, delta: base };
  return { teamId, delta: currentRound(state).penalize_wrong ? -base : 0 };
}

export function snapshot(state) {
  const { set, ...rest } = state;
  return { ...rest };
}

export function initJeopardy(set, teamIds) {
  return {
    set,
    teamIds,
    roundIndex: 0,
    phase: 'round-intro',
    cursor: { cat: 0, row: 0 },
    used: {},
    active: null,
    isDailyDouble: false,
    wager: null,
    answeringTeamId: null,
    attempted: [],
    turnTeamId: teamIds[0] || null,
    revealed: false,
    finalWagers: {},
    finalJudged: {},
  };
}

function nextTurn(state) {
  const i = state.teamIds.indexOf(state.turnTeamId);
  return state.teamIds[(i + 1) % state.teamIds.length] || null;
}

function closeClue(state) {
  // mark used, clear clue context, then advance round/final if board is done
  const used = { ...state.used, [`${state.roundIndex}:${state.active.cat}:${state.active.row}`]: true };
  let s = {
    ...state, used, phase: 'board', active: null, isDailyDouble: false,
    wager: null, answeringTeamId: null, attempted: [], revealed: false,
  };
  if (currentRound(s).mode === 'turns') s = { ...s, turnTeamId: nextTurn(s) };
  if (!boardDone(s)) return s;
  if (s.roundIndex + 1 < s.set.rounds.length) {
    return { ...s, roundIndex: s.roundIndex + 1, phase: 'round-intro', cursor: { cat: 0, row: 0 } };
  }
  return s.set.final ? { ...s, phase: 'final-category' } : { ...s, phase: 'done' };
}

function moveCursor(state, dir) {
  const round = currentRound(state);
  const cats = round.categories.length;
  let { cat, row } = state.cursor;
  if (dir === 'left') cat = Math.max(0, cat - 1);
  if (dir === 'right') cat = Math.min(cats - 1, cat + 1);
  if (dir === 'up') row = Math.max(0, row - 1);
  if (dir === 'down') row = row + 1;
  row = Math.min(row, round.categories[cat].clues.length - 1);
  return { ...state, cursor: { cat, row } };
}

export function jeopardyReducer(state, action) {
  const round = currentRound(state);
  switch (action.type) {
    case 'INIT_SET':
      return { ...initJeopardy(action.set, state.teamIds), ...(action.resume || {}), set: action.set };

    case 'RESTORE':
      return { ...state, ...action.snapshot, set: state.set };

    case 'START_ROUND':
      if (state.phase === 'round-intro') return { ...state, phase: 'board' };
      if (state.phase === 'final-category') return { ...state, phase: 'final-wager' };
      return state;

    case 'MOVE_CURSOR':
      return state.phase === 'board' ? moveCursor(state, action.dir) : state;

    case 'SELECT_TILE': {
      if (state.phase !== 'board') return state;
      const { cat, row } = state.cursor;
      const clue = clueAt(state, cat, row);
      if (!clue || isUsed(state, cat, row)) return state;
      const active = { cat, row, clue };
      if (clue.daily_double) {
        return { ...state, phase: 'wager', active, isDailyDouble: true, answeringTeamId: state.turnTeamId };
      }
      const answeringTeamId = round.mode === 'turns' ? state.turnTeamId : null;
      return { ...state, phase: 'clue', active, answeringTeamId, revealed: false, attempted: [] };
    }

    case 'SET_WAGER':
      if (state.phase !== 'wager') return state;
      return { ...state, phase: 'clue', wager: action.amount, revealed: false };

    case 'BUZZ': {
      if (state.phase !== 'clue' || state.isDailyDouble || round.mode === 'turns') return state;
      if (state.answeringTeamId || state.attempted.includes(action.teamId)) return state;
      const revealed = round.mode === 'self' ? true : state.revealed;
      return { ...state, phase: 'judging', answeringTeamId: action.teamId, revealed };
    }

    case 'REVEAL':
      if (state.phase === 'clue') return { ...state, revealed: true, phase: state.answeringTeamId ? 'judging' : state.phase };
      if (state.phase === 'final-clue') return { ...state, phase: 'final-judging' };
      return state;

    case 'JUDGE': {
      if (state.phase !== 'judging') return state;
      if (action.correct) return closeClue({ ...state, turnTeamId: state.answeringTeamId || state.turnTeamId });
      // wrong:
      if (state.isDailyDouble || round.mode !== 'hosted') return closeClue(state);
      const attempted = [...state.attempted, state.answeringTeamId];
      if (attempted.length >= state.teamIds.length) {
        // everyone missed — show the answer, host returns to board
        return { ...state, phase: 'clue', attempted, answeringTeamId: null, revealed: true };
      }
      return { ...state, phase: 'clue', attempted, answeringTeamId: null };
    }

    case 'TIMEOUT':
      if (state.phase !== 'clue' && state.phase !== 'judging') return state;
      return { ...state, phase: 'clue', revealed: true, answeringTeamId: null };

    case 'RETURN_TO_BOARD':
      if (state.phase !== 'clue' || !state.revealed) return state;
      return closeClue(state);

    case 'SET_FINAL_WAGER': {
      if (state.phase !== 'final-wager') return state;
      const finalWagers = { ...state.finalWagers, [action.teamId]: action.amount };
      const allIn = state.teamIds.every((id) => finalWagers[id] != null);
      return { ...state, finalWagers, phase: allIn ? 'final-clue' : 'final-wager' };
    }

    case 'JUDGE_FINAL': {
      if (state.phase !== 'final-judging') return state;
      const finalJudged = { ...state.finalJudged, [action.teamId]: action.correct };
      const allJudged = state.teamIds.every((id) => finalJudged[id] != null);
      return { ...state, finalJudged, phase: allJudged ? 'done' : 'final-judging' };
    }

    default:
      return state;
  }
}
