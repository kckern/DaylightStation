import { ToolFactory } from "../../../../../../../../__capabilities/agent-runtime/server/application/framework/ToolFactory.mjs";
import { createTool } from "../../../../../../../../__capabilities/agent-runtime/server/application/ports/ITool.mjs";

export const TRIAGE_SESSION_PATH = '/life/now/triage';

export class TriageToolFactory extends ToolFactory {
  static domain = 'triage';

  createTools() {
    const { triage } = this.deps;
    if (!triage || typeof triage.run !== 'function') return [];

    return [
      createTool({
        name: 'start_inbox_triage',
        description: `Run an inbox triage pass now: it files the obvious mail and stale tasks and queues the rest as cards. `
          + `It never answers cards. Afterwards, tell the user how much was done and queued and send them to ${TRIAGE_SESSION_PATH} `
          + `to go through the rest. Do not triage individual items in chat. Link only to the sessionPath the tool returns, `
          + `exactly as given (a relative path); never invent or complete a URL.`,
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        execute: async ({ userId } = {}, context = {}) => {
          // The session's own user is authoritative; a model-supplied different user is refused.
          const own = context?.userId ?? null;
          if (own && userId && userId !== own) return { error: 'wrong_user' };
          const username = own ?? userId;
          if (!username) return { error: 'no_user' };
          const result = await triage.run({ username, trigger: 'manual' });
          if (result?.skipped === 'not_enrolled') return { error: 'not_enrolled' };
          if (result?.skipped) return { error: result.skipped };
          const queued = result?.queued ?? null;
          return {
            preDone: result?.preDone ?? null,
            queued,
            mailbox: result?.mailbox ?? null,
            sessionPath: TRIAGE_SESSION_PATH,
            // A ready link so the model copies it rather than making one up.
            link: `[Go through the cards](${TRIAGE_SESSION_PATH})`,
          };
        },
      }),
    ];
  }
}
