import { defineRuleModule } from '../../kernel/index.mjs';
import { validateDefinition } from './definition.mjs';
import { createInitialState, transition } from './reducer.mjs';
import { projectState } from './projection.mjs';

export const cardBattleRuleModule = defineRuleModule({
  id: 'card-battle',
  version: 1,
  validateDefinition,
  createInitialState,
  handleCommand(state, command, definition, context) {
    const reducerCommand = {
      command_id: context.commandId || `cmd:${context.revision + 1}`,
      session_revision: context.revision,
      type: command.type,
      payload: command.payload || Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'type')),
    };
    return transition(state, reducerCommand, definition);
  },
  project(state, definition, viewer) {
    return projectState(state, definition, viewer?.participant_id || null);
  },
});

export * from './contracts.mjs';
export * from './definition.mjs';
export * from './projection.mjs';
export * from './reducer.mjs';
