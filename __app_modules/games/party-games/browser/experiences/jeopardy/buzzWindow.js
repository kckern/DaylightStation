import {commandContext,contextKey} from '../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
export function buzzWindow(state,clueVisible) {
  const round=state?.set?.rounds?.[state.roundIndex];
  if(!clueVisible || state?.phase!=='clue' || !state.active || state.revealed || state.answeringTeamId || state.isDailyDouble || state.active.clue.little_kids || round?.mode==='turns') return null;
  const eligibleTeamIds=(state.teamIds || Object.keys(state.scores || {})).filter(id=>!state.attempted.includes(id));
  if(!eligibleTeamIds.length)return null;
  const context=commandContext(state);
  return {key:`${contextKey(context)}:${JSON.stringify(eligibleTeamIds)}`,context,eligibleTeamIds};
}
