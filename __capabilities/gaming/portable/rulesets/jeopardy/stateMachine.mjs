// Pure Jeopardy phase machine. The RuleModule calls scoreDelta before reducing
// a judgment and commits the score beside this transition. All three modes:
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
  const base = state.isDailyDouble ? state.wager : state.active.clue.value * Number(currentRound(state)?.multiplier ?? 1);
  if (correct) return { teamId, delta: base };
  return { teamId, delta: currentRound(state).penalize_wrong ? -base : 0 };
}

export function assignKidsTeams(set, teamIds) {
  let assigned = 0;
  return {
    ...set,
    rounds: set.rounds.map(round => ({
      ...round,
      categories: round.categories.map(category => ({
        ...category,
        clues: category.clues.map(clue => {
          if (!clue.little_kids) return { ...clue };
          const teamId = teamIds[assigned++ % teamIds.length] || null;
          return { ...clue, assigned_team_id: teamId };
        }),
      })),
    })),
  };
}

export function migrateJeopardyState(state) {
  const missing = state.set.rounds.some(round => round.categories.some(category => category.clues.some(clue => clue.little_kids && !clue.assigned_team_id)));
  return missing ? { ...state, set: assignKidsTeams(state.set, state.teamIds) } : state;
}

export function initJeopardy(set, teamIds) {
  const assignedSet = assignKidsTeams(set, teamIds);
  return {
    set: assignedSet,
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
    ...(state.jeopardyFlowVersion === 2 ? { answerReview: null } : {}),
    wager: null, answeringTeamId: null, attempted: [], revealed: false,
  };
  if (currentRound(s).mode === 'turns') s = { ...s, turnTeamId: nextTurn(s) };
  if (!boardDone(s)) return { ...s, cursor: playableCursor(s) };
  if (s.roundIndex + 1 < s.set.rounds.length) {
    if (s.jeopardyFlowVersion === 2 && s.roundIndex === 0) return { ...s, phase: 'round-decision' };
    return { ...s, roundIndex: s.roundIndex + 1, phase: 'round-intro', cursor: { cat: 0, row: 0 } };
  }
  return s.set.final ? { ...s, phase: 'final-category' } : { ...s, phase: 'done' };
}

function boardCells(state) {
  const categories = currentRound(state)?.categories || [];
  const rows = Math.max(0, ...categories.map(category => category.clues.length));
  return Array.from({ length: rows }).flatMap((_, row) => categories.flatMap((category, cat) => category.clues[row] ? [{ cat, row }] : []));
}

// Also normalizes old saved games whose cursor still points at the used clue.
export function playableCursor(state) {
  const cells = boardCells(state);
  const start = Math.max(0, cells.findIndex(cell => cell.cat === state.cursor.cat && cell.row === state.cursor.row));
  for (let step = 0; step < cells.length; step += 1) {
    const cell = cells[(start + step) % cells.length];
    if (!isUsed(state, cell.cat, cell.row)) return cell;
  }
  return null;
}

function moveCursor(state, dir) {
  const origin = playableCursor(state);
  if (!origin) return state;
  const horizontal = dir === 'left' || dir === 'right';
  if (horizontal) {
    const cells = boardCells(state).filter(cell => !isUsed(state, cell.cat, cell.row));
    const index = cells.findIndex(cell => cell.cat === origin.cat && cell.row === origin.row);
    const offset = dir === 'left' ? -1 : 1;
    // Reading-order horizontal traversal keeps every sparse board connected;
    // spatial-only neighbor choices can trap a center tile behind its corners.
    return { ...state, cursor: cells[(index + offset + cells.length) % cells.length] };
  }
  const axis = horizontal ? 'cat' : 'row';
  const cross = horizontal ? 'row' : 'cat';
  const sign = dir === 'left' || dir === 'up' ? -1 : 1;
  const candidates = boardCells(state).filter(cell => !isUsed(state, cell.cat, cell.row) && (cell[axis] - origin[axis]) * sign > 0);
  // Vertical movement prefers the same column, then the nearest question
  // in the requested direction. Left/Right can always reach every question.
  candidates.sort((a, b) => Math.abs(a[cross] - origin[cross]) - Math.abs(b[cross] - origin[cross]) || Math.abs(a[axis] - origin[axis]) - Math.abs(b[axis] - origin[axis]));
  return { ...state, cursor: candidates[0] || origin };
}

export function jeopardyReducer(state, action) {
  const round = currentRound(state);
  const v2 = state.jeopardyFlowVersion === 2;
  switch (action.type) {
    case 'ENABLE_EXPERIENCE_V2': {
      if (v2 || state.phase !== 'round-intro' || state.active || state.wager != null || state.answeringTeamId) return state;
      const usedKeys = Object.keys(state.used || {}).filter(key => state.used[key]);
      const untouched = state.roundIndex === 0 && usedKeys.length === 0 && Object.values(state.scores || {}).every(score => Number(score) === 0);
      const firstComplete = state.set.rounds[0].categories.every((category, cat) => category.clues.every((_, row) => state.used[`0:${cat}:${row}`]));
      const paused = state.roundIndex === 1 && firstComplete && usedKeys.every(key => key.startsWith('0:'));
      if (!untouched && !paused) return state;
      return { ...state, jeopardyFlowVersion: 2, ...(paused ? { phase: 'round-decision', roundIndex: 0 } : {}) };
    }
    case 'CONTINUE_ROUND':
      return v2 && state.phase === 'round-decision' ? { ...state, roundIndex: state.roundIndex + 1, phase: 'round-intro', cursor: { cat: 0, row: 0 } } : state;
    case 'FINISH_GAME':
      return v2 && state.phase === 'round-decision' ? { ...state, phase: 'done', skippedFinal: true } : state;
    case 'START_ROUND':
      if (state.phase === 'round-intro') return { ...state, phase: 'board' };
      if (state.phase === 'final-category') return { ...state, phase: 'final-wager' };
      return state;

    case 'MOVE_CURSOR':
      return state.phase === 'board' ? moveCursor(state, action.dir) : state;

    case 'SELECT_TILE': {
      if (state.phase !== 'board') return state;
      const cursor = playableCursor(state);
      if (!cursor) return state;
      const { cat, row } = cursor;
      const clue = clueAt(state, cat, row);
      if (!clue || isUsed(state, cat, row)) return state;
      const active = { cat, row, clue };
      if (clue.daily_double && !clue.little_kids) {
        return { ...state, cursor, phase: 'wager', active, isDailyDouble: true, answeringTeamId: state.turnTeamId };
      }
      const answeringTeamId = clue.little_kids ? clue.assigned_team_id : round.mode === 'turns' ? state.turnTeamId : null;
      return { ...state, cursor, phase: 'clue', active, answeringTeamId, revealed: false, attempted: [] };
    }

    case 'SELECT_AT': {
      // Atomic "pick this exact tile" — used by the mobile host companion's
      // tile grid (a d-pad is poor UX on a phone). Jumps the cursor, then
      // runs the normal selection logic.
      if (state.phase !== 'board') return state;
      const { cat, row } = action;
      if (!clueAt(state, cat, row) || isUsed(state, cat, row)) return state;
      return jeopardyReducer({ ...state, cursor: { cat, row } }, { type: 'SELECT_TILE' });
    }

    case 'SET_WAGER':
      if (state.phase !== 'wager') return state;
      return { ...state, phase: 'clue', wager: action.amount, revealed: false };

    case 'BUZZ': {
      if (state.phase !== 'clue' || state.active?.clue.little_kids || state.isDailyDouble || round.mode === 'turns') return state;
      if (state.answeringTeamId || state.attempted.includes(action.teamId)) return state;
      const revealed = round.mode === 'self' ? true : state.revealed;
      return { ...state, phase: 'judging', answeringTeamId: action.teamId, revealed };
    }

    case 'REVEAL':
      if (v2 && state.phase === 'clue' && !state.revealed) return { ...state, revealed: true, phase: state.answeringTeamId ? 'judging' : 'answer-review', answerReview: { teamId: state.answeringTeamId, correct: null, scoreDelta: 0, judgmentPending: Boolean(state.answeringTeamId) } };
      if (state.phase === 'judging' && !state.revealed) return { ...state, revealed: true, ...(v2 ? { answerReview: { teamId: state.answeringTeamId, correct: null, scoreDelta: 0, judgmentPending: true } } : {}) };
      if (state.phase === 'clue') return { ...state, revealed: true, phase: state.answeringTeamId ? 'judging' : state.phase };
      if (state.phase === 'final-clue') return { ...state, phase: 'final-judging' };
      return state;

    case 'JUDGE': {
      if (v2) {
        if (!state.answeringTeamId || !['clue', 'judging'].includes(state.phase)) return state;
        const attempted = [...state.attempted, state.answeringTeamId];
        if (!action.correct && !state.revealed && !state.active?.clue.little_kids && !state.isDailyDouble && round.mode === 'hosted' && attempted.length < state.teamIds.length) {
          return { ...state, phase: 'clue', attempted, answeringTeamId: null };
        }
        return { ...state, phase: 'answer-review', revealed: true, attempted, answerReview: { teamId: state.answeringTeamId, correct: Boolean(action.correct), scoreDelta: scoreDelta(state, action.correct)?.delta ?? 0, judgmentPending: false }, ...(action.correct ? { turnTeamId: state.answeringTeamId } : {}) };
      }
      if (state.phase !== 'judging') return state;
      if (action.correct) return closeClue({ ...state, turnTeamId: state.answeringTeamId || state.turnTeamId });
      // wrong:
      if (state.active?.clue.little_kids || state.isDailyDouble || round.mode !== 'hosted') return closeClue(state);
      const attempted = [...state.attempted, state.answeringTeamId];
      if (attempted.length >= state.teamIds.length) {
        // everyone missed — show the answer, host returns to board
        return { ...state, phase: 'clue', attempted, answeringTeamId: null, revealed: true };
      }
      return { ...state, phase: 'clue', attempted, answeringTeamId: null };
    }

    case 'TIMEOUT':
      if (v2) return state.phase === 'clue' && !state.answeringTeamId && !state.revealed ? { ...state, phase: 'answer-review', revealed: true, answerReview: { teamId: null, correct: null, scoreDelta: 0, judgmentPending: false } } : state;
      if (state.phase !== 'clue' && state.phase !== 'judging') return state;
      return { ...state, phase: 'clue', revealed: true, answeringTeamId: null };

    case 'RETURN_TO_BOARD':
      if (v2) return state.phase === 'answer-review' ? closeClue(state) : state;
      if (state.phase !== 'clue' || !state.revealed) return state;
      return closeClue(state);

    case 'SET_FINAL_WAGER': {
      if (state.phase !== 'final-wager' || state.finalWagers[action.teamId] != null || !state.teamIds.includes(action.teamId)) return state;
      const finalWagers = { ...state.finalWagers, [action.teamId]: action.amount };
      const allIn = state.teamIds.every((id) => finalWagers[id] != null);
      return { ...state, finalWagers, phase: allIn ? 'final-clue' : 'final-wager' };
    }

    case 'JUDGE_FINAL': {
      if (state.phase !== 'final-judging' || state.finalJudged[action.teamId] != null || !state.teamIds.includes(action.teamId)) return state;
      const finalJudged = { ...state.finalJudged, [action.teamId]: action.correct };
      const allJudged = state.teamIds.every((id) => finalJudged[id] != null);
      return { ...state, finalJudged, phase: allJudged ? 'done' : 'final-judging' };
    }

    default:
      return state;
  }
}
