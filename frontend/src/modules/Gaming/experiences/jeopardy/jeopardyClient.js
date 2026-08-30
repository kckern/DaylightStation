import { sendRuleCommand } from '@gaming/platform/api/sessionClient.js';

export function sendJeopardyCommand(sessionId, command, { actorId = 'host' } = {}) {
  const type = command.type.startsWith('jeopardy.')
    ? command.type
    : `jeopardy.${command.type.toLowerCase().replaceAll('_', '.')}`;
  return sendRuleCommand(sessionId, { ...command, type }, { actorId });
}
