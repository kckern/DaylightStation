import { defineRuleModule } from '@shared-gaming/kernel/index.mjs';

const safePhaseList = (value) => Array.isArray(value) && value.length > 0
  && value.every((phase) => typeof phase === 'string' && phase.length > 0);

export const pianoRunRuleModule = defineRuleModule({
  id: 'piano-native-run',
  version: 1,
  validateDefinition(definition) {
    const errors = [];
    if (typeof definition?.game_id !== 'string' || !definition.game_id) errors.push('game_id is required');
    if (typeof definition?.initial_phase !== 'string' || !definition.initial_phase) errors.push('initial_phase is required');
    if (!safePhaseList(definition?.active_phases)) errors.push('active_phases are required');
    if (!safePhaseList(definition?.terminal_phases)) errors.push('terminal_phases are required');
    return { valid: errors.length === 0, errors };
  },
  createInitialState(definition) {
    return {
      status: 'active', phase: definition.initial_phase, sequence: -1,
      score: null, metrics: {}, synchronized_at: null,
    };
  },
  handleCommand(state, command, definition, context) {
    if (command.type !== 'piano.run.sync') return { error: { code: 'illegal_command', message: `${command.type} cannot change a Piano run` } };
    if (!Number.isInteger(command.sequence) || command.sequence <= state.sequence) return { error: { code: 'stale_native_state', message: 'Native run sequence must increase' } };
    if (typeof command.phase !== 'string' || !command.phase) return { error: { code: 'invalid_native_state', message: 'Native run phase is required' } };
    const known = new Set([definition.initial_phase, ...definition.active_phases, ...definition.terminal_phases]);
    if (!known.has(command.phase)) return { error: { code: 'invalid_native_state', message: `Unknown native run phase: ${command.phase}` } };
    const status = definition.terminal_phases.includes(command.phase) ? 'complete' : 'active';
    const next = {
      status,
      phase: command.phase,
      sequence: command.sequence,
      score: structuredClone(command.score ?? null),
      metrics: structuredClone(command.metrics ?? {}),
      synchronized_at: context.logicalTime,
    };
    return {
      state: next,
      status,
      events: [{ type: status === 'complete' ? 'piano.run.completed' : 'piano.run.synchronized', phase: next.phase, sequence: next.sequence }],
    };
  },
  project(state) {
    return { state: structuredClone(state), interaction: { phase: state.phase, terminal: state.status === 'complete' } };
  },
});
