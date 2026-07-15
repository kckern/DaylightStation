export function initScores(teams = []) {
  return Object.fromEntries(teams.map((t) => [t.id, 0]));
}

export function scoreReducer(scores, action) {
  const has = (id) => Object.prototype.hasOwnProperty.call(scores, id);
  switch (action.type) {
    case 'AWARD':
      return has(action.teamId) ? { ...scores, [action.teamId]: scores[action.teamId] + action.points } : scores;
    case 'DEDUCT':
      return has(action.teamId) ? { ...scores, [action.teamId]: scores[action.teamId] - action.points } : scores;
    case 'SET_SCORE':
      return has(action.teamId) ? { ...scores, [action.teamId]: action.points } : scores;
    case 'RESTORE':
      return { ...action.scores };
    default:
      return scores;
  }
}
