import { sendRuleCommand } from '../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';

// One local lane includes hardware facts, gameplay and host commands. A remote
// phone may still win a revision race; retry only an explicit uncommitted conflict.
const lanes = new Map();
export function sendJeopardyCommand(sessionId, command, { actorId = 'host' } = {}) {
  const type = command.type.startsWith('jeopardy.')
    ? command.type
    : `jeopardy.${command.type.toLowerCase().replaceAll('_', '.')}`;
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await sendRuleCommand(sessionId, { ...command, type }, { actorId }); }
      catch (cause) {
        const conflict = cause?.code === 'revision_conflict' || (cause?.status === 409 && cause?.body?.error === 'revision_conflict');
        if (!conflict || attempt >= 3) throw cause;
      }
    }
  };
  const pending = (lanes.get(sessionId) || Promise.resolve()).then(run, run);
  lanes.set(sessionId, pending);
  const release = () => { if (lanes.get(sessionId) === pending) lanes.delete(sessionId); };
  pending.then(release, release);
  return pending;
}
