/**
 * Generates AI-powered briefings from alignment data.
 * Sends structured prompt to AI gateway and returns narrative.
 */
export class BriefingService {
  #aiGateway;
  #alignmentService;

  constructor({ aiGateway, alignmentService }) {
    this.#aiGateway = aiGateway;
    this.#alignmentService = alignmentService;
  }

  async generateBriefing(username) {
    const alignment = this.#alignmentService.computeAlignment(username);
    if (!alignment?.briefingContext) return { text: 'No briefing data available.' };

    const prompt = this.#buildPrompt(alignment.briefingContext);

    if (!this.#aiGateway) {
      // Fallback: generate a simple text summary without AI
      return { text: this.#fallbackBriefing(alignment), generated: false };
    }

    try {
      const response = await this.#aiGateway.generate(prompt);
      return { text: response, generated: true, _meta: { username, computedAt: new Date().toISOString() } };
    } catch (err) {
      return { text: this.#fallbackBriefing(alignment), generated: false, error: err.message };
    }
  }

  #buildPrompt(ctx) {
    const parts = ['You are a personal alignment coach. Generate a concise daily briefing.'];

    if (ctx.plan?.purpose?.statement) {
      parts.push(`Purpose: ${ctx.plan.purpose.statement}`);
    }

    if (ctx.snapshot) {
      parts.push(`Value alignment: ${ctx.snapshot.status || 'unknown'} (correlation: ${ctx.snapshot.correlation?.toFixed(2) || 'N/A'})`);
    }

    if (ctx.priorities?.length > 0) {
      parts.push('Top priorities:');
      ctx.priorities.slice(0, 3).forEach(p => parts.push(`- ${p.title} (${p.type})`));
    }

    if (ctx.upcomingDeadlines?.length > 0) {
      parts.push('Upcoming deadlines:');
      ctx.upcomingDeadlines.forEach(d => parts.push(`- ${d.name}: ${d.deadline}`));
    }

    parts.push('Write a warm, motivating 2-3 paragraph briefing. Be specific and actionable.');
    return parts.join('\n');
  }

  #fallbackBriefing(alignment) {
    const lines = [];
    const priorities = alignment.priorities || [];

    if (priorities.length > 0) {
      lines.push(`Today's top priority: ${priorities[0].title}.`);
    }

    const dashboard = alignment.dashboard || {};
    if (dashboard.valueDrift) {
      lines.push(`Value alignment is ${dashboard.valueDrift.status || 'unknown'}.`);
    }

    const activeGoals = (dashboard.goalProgress || []).filter(g => g.state === 'committed');
    if (activeGoals.length > 0) {
      lines.push(`You have ${activeGoals.length} active goal${activeGoals.length > 1 ? 's' : ''} in progress.`);
    }

    return lines.join(' ') || 'No briefing data available.';
  }
}
