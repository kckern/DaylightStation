import { AgentTranscript } from './AgentTranscript.mjs';
import { applyDecorators } from './decorators/applyDecorators.mjs';
import { userIdInjector } from './decorators/UserIdInjector.mjs';
import { createCallLimiter, LIMIT_REACHED_MESSAGE_PREFIX } from './decorators/CallLimiter.mjs';
import { transcriptRecorder } from './decorators/TranscriptRecorder.mjs';

/** Application-owned transcript and tool-execution policy for an agent turn. */
export class AgentExecutionPolicy {
  #maxToolCalls;
  #logger;
  #transcriptStore;

  constructor({ maxToolCalls = 50, logger = console, transcriptStore = null } = {}) {
    this.#maxToolCalls = maxToolCalls;
    this.#logger = logger;
    this.#transcriptStore = transcriptStore;
  }

  createTranscript({ agentId, userId, turnId, input, context, systemPrompt, model }) {
    const transcript = new AgentTranscript({
      agentId,
      userId,
      turnId,
      input: { text: input, context: { ...context, turnId } },
      logger: this.#logger,
      transcriptStore: this.#transcriptStore,
    });
    transcript.setSystemPrompt(systemPrompt);
    transcript.setModel(model);
    return transcript;
  }

  decorateTools({ tools, context, transcript, agent }) {
    const agentDecorators = typeof agent?.buildToolDecorators === 'function'
      ? agent.buildToolDecorators()
      : [];
    return applyDecorators(
      tools,
      [...agentDecorators, userIdInjector, createCallLimiter({ maxToolCalls: Math.min(context.maxToolCalls ?? this.#maxToolCalls, this.#maxToolCalls) }), transcriptRecorder],
      { ...context, transcript },
    );
  }

  isLimitReached(result) {
    return typeof result?.error === 'string' && result.error.startsWith(LIMIT_REACHED_MESSAGE_PREFIX);
  }
}
