import { defineRuleModule } from '../../kernel/index.mjs';
import { selectSeeded } from '../../mechanics/selection.mjs';

export const selectorRuleModule = defineRuleModule({
  id: 'selector', version: 1,
  validateDefinition: (definition) => ({ valid: Number.isInteger(definition?.maximum_candidates) && definition.maximum_candidates > 0, errors: Number.isInteger(definition?.maximum_candidates) && definition.maximum_candidates > 0 ? [] : ['maximum_candidates must be positive'] }),
  createInitialState(definition, { setup = {} }) {
    const candidates = (setup.candidates || []).slice(0, definition.maximum_candidates).map((candidate) => structuredClone(candidate));
    return { status: 'active', selection_count: 0, candidates, selected: null };
  },
  handleCommand(state, command, _definition, context) {
    if (command.type !== 'selector.pick') return { error: { code: 'illegal_command', message: `${command.type} cannot change a selector session` } };
    const available = command.candidate_ids?.length ? state.candidates.filter((candidate) => command.candidate_ids.includes(candidate.id)) : state.candidates;
    if (available.length === 0) return { error: { code: 'no_selection_candidates', message: 'At least one environment-provided candidate must be selected' } };
    const draw = selectSeeded(available, (context.seed ^ Math.imul(state.selection_count + 1, 0x85ebca6b)) >>> 0);
    return { state: { ...state, selection_count: state.selection_count + 1, selected: draw.selected }, events: [{ type: 'selector.outcome.committed', selected: draw.selected }] };
  },
  project: (state, definition) => ({ state: structuredClone(state), definition: { title: definition.title, maximum_candidates: definition.maximum_candidates }, interaction: { can_select: state.candidates.length > 0 } }),
});
