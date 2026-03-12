import { Assignment } from '../../framework/Assignment.mjs';

export class CadenceCheck extends Assignment {
  static id = 'cadence-check';
  static description = 'Check ceremony schedule and send nudges for due/overdue items';
  static schedule = '0 7 * * *';

  async gather({ tools, userId, memory, logger }) {
    const call = (name, params) => {
      const tool = tools.find(t => t.name === name);
      if (!tool) return Promise.resolve(null);
      return tool.execute(params).catch(() => null);
    };

    const [ceremonyStatus, driftData, planData] = await Promise.all([
      call('check_ceremony_status', { username: userId }),
      call('get_value_allocation', { username: userId }),
      call('get_plan', { username: userId }),
    ]);

    const overdue = (ceremonyStatus?.ceremonies || []).filter(c => c.isOverdue);
    const due = (ceremonyStatus?.ceremonies || []).filter(c => c.isDue && !c.isCompleted && !c.isOverdue);
    const hasDrift = driftData?.status === 'drifting' || (driftData?.correlation != null && driftData.correlation < 0.6);

    if (overdue.length === 0 && due.length === 0 && !hasDrift) {
      logger?.info?.('cadence-check.nothing_actionable', { userId });
      return { nothing_actionable: true, ceremonyStatus, driftData, planData };
    }

    return { nothing_actionable: false, ceremonyStatus, driftData, planData, overdue, due, hasDrift };
  }

  buildPrompt(gathered, memory) {
    if (gathered.nothing_actionable) return null;

    const sections = ['## Cadence Check Context'];

    if (gathered.overdue?.length) {
      sections.push(`\n### Overdue Ceremonies\n${JSON.stringify(gathered.overdue, null, 2)}`);
    }
    if (gathered.due?.length) {
      sections.push(`\n### Due Ceremonies\n${JSON.stringify(gathered.due, null, 2)}`);
    }
    if (gathered.hasDrift) {
      sections.push(`\n### Value Drift Alert\n${JSON.stringify(gathered.driftData, null, 2)}`);
    }

    const trustLevel = memory?.get?.('trust_level') || 'new';
    const prefs = memory?.get?.('user_profile') || {};
    sections.push(`\n### User Context\nTrust level: ${trustLevel}\nPreferences: ${JSON.stringify(prefs)}`);

    sections.push(`\n### Instructions
Compose a single, concise notification message for the user.
- Prioritize overdue ceremonies first.
- Mention drift only if significant.
- Include action buttons as JSON array in your response.
- Tone: match user preferences and trust level.
- Format: { "message": "...", "actions": [{ "label": "...", "action": "...", "data": {...} }] }
- Return raw JSON only.`);

    return sections.join('\n');
  }

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        message: { type: 'string' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              action: { type: 'string' },
              data: { type: 'object' },
            },
            required: ['label', 'action'],
          },
        },
      },
      required: ['message', 'actions'],
    };
  }

  async validate(raw, gathered, logger) {
    if (gathered.nothing_actionable) return null;

    let parsed;
    try {
      parsed = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output;
    } catch {
      throw new Error('CadenceCheck output is not valid JSON');
    }

    if (!parsed.message || !Array.isArray(parsed.actions)) {
      throw new Error('CadenceCheck output missing message or actions');
    }

    return parsed;
  }

  async act(validated, { memory, userId, logger }) {
    if (!validated) {
      logger?.info?.('cadence-check.skipped', { userId, reason: 'nothing_actionable' });
      return;
    }

    memory.set('pending_nudge', validated, { ttl: 24 * 60 * 60 * 1000 });
  }
}
