/** Provider/runtime adapter for bounded gameplay AI proposals. */
export class AiProposalGenerator {
  constructor({ aiGateway, scheduler }) {
    this.aiGateway = aiGateway;
    this.scheduler = scheduler;
  }

  generate(request, { timeoutMs }) {
    const work = typeof this.aiGateway.complete === 'function'
      ? this.aiGateway.complete(request)
      : this.aiGateway.chat(request.messages || request, request.options || {});
    return this.scheduler.withDeadline(work, {
      milliseconds: timeoutMs,
      errorFactory: () => new Error('proposal_timeout'),
    });
  }
}

export default AiProposalGenerator;
