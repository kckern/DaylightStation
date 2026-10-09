const DEFAULT_MODEL = 'gpt-5.6-luna';

/**
 * Provider adapter for short, fail-open opponent dialogue generation.
 * Application services provide semantic instructions and prompts; this adapter
 * owns the gateway protocol, model selection, token budget, and deadline API.
 */
export class OpponentDialogueGenerator {
  constructor({ aiGateway, deadline = { run: work => work }, model = DEFAULT_MODEL }) {
    this.aiGateway = aiGateway;
    this.deadline = deadline;
    this.model = model;
  }

  get available() {
    return typeof this.aiGateway?.chat === 'function';
  }

  generate({ instruction, prompt, timeoutMs, timeoutMessage }) {
    return this.deadline.run(this.aiGateway.chat([
      { role: 'system', content: instruction },
      { role: 'user', content: prompt },
    ], {
      model: this.model,
      reasoningEffort: 'none',
      maxTokens: 40,
      timeout: timeoutMs,
    }), { timeoutMs, message: timeoutMessage });
  }
}

export default OpponentDialogueGenerator;
