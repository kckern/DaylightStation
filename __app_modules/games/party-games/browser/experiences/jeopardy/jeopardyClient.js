import { fetchSession, postRuleEnvelope, ruleCommandEnvelope } from '../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import { commandContext, contextKey, matchesCommandContext, needsCommandContext } from '../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';

const lanes = new Map();
const failure = (code, message, session) => Object.assign(new Error(message), { code, session });
export async function sendJeopardyCommand(sessionId, command, options = {}) {
  const type = command.type.startsWith('jeopardy.') ? command.type : `jeopardy.${command.type.toLowerCase().replaceAll('_', '.')}`;
  const scoped = needsCommandContext(type);
  let current;
  if (options.expectedRevision == null || options.expectedContext == null) current = await fetchSession(sessionId);
  const captured = structuredClone(options.expectedContext ?? command.expectedContext ?? commandContext(current?.state));
  let envelope = ruleCommandEnvelope(sessionId, { ...command, type, ...(scoped ? { expectedContext: captured } : {}) }, {
    ...options, expectedRevision: options.expectedRevision ?? current.header.revision,
  });
  const key = `${sessionId}:${contextKey(captured)}`;
  const run = async () => {
    let conflicts = 0, unknown = 0;
    for (;;) {
      try { return await postRuleEnvelope(sessionId, envelope, { signal: options.signal }); }
      catch (cause) {
        const code = cause?.code || cause?.body?.error;
        if (code === 'stale_command_context' || code === 'command_context_required') {
          const latest = await fetchSession(sessionId);
          throw failure(code, cause.message, latest);
        }
        const conflict = code === 'revision_conflict';
        if (conflict && conflicts++ < 3) {
          const latest = await fetchSession(sessionId);
          if (scoped && !matchesCommandContext(latest.state, captured)) throw failure('stale_command_context', 'The question or answering turn changed; use the current controls', latest);
          envelope = { ...envelope, expected_revision: latest.header.revision };
          continue;
        }
        // A lost response may have committed. Probe with the IDENTICAL envelope,
        // including command id, revision and logical time, before changing it.
        if (cause?.transient === true && cause.name !== 'AbortError' && unknown++ < 1) continue;
        throw cause;
      }
    }
  };
  const pending = (lanes.get(key) || Promise.resolve()).then(run, run);
  lanes.set(key, pending);
  try { return await pending; }
  finally { if (lanes.get(key) === pending) lanes.delete(key); }
}
