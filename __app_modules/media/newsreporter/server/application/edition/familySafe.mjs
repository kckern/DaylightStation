/**
 * Family-safe screening for the printed paper (3_applications).
 *
 * The paper lies on a desk where a child can pick it up (KC, 2026-11-23:
 * "war okay, grok making csam, not okay"). Hard news stays: war, conflict,
 * crime reported plainly, politics, disasters. What goes: sexual content of
 * any kind, sexual abuse or exploitation, graphic gore or torture, and
 * suicide or self-harm methods.
 *
 * Two places use the same typed question (Jev, IDecisionGateway):
 *  - the pick, as a third question on every story unit (no extra calls);
 *    a unit over the threshold is never picked;
 *  - after writing, on each written story (headline + body), because the
 *    writer reads the full article and can carry in details a headline did
 *    not show. A flagged story is removed before layout.
 * A failed screening call keeps the story when it came from a headline that
 * already passed the pick, and is logged; with no decision gateway at all
 * the only guard is the write prompt's rule, and the edition says so.
 */
import { yesNo } from '#apps/common/ports/IDecisionGateway.mjs';
import { mapLimit, withTimeout } from './editionGather.mjs';

export const DEFAULT_THRESHOLD = 0.5;

export const MATURE_QUESTION = yesNo(
  'Is the story `title` (with `blurb` or `body`, if given) unsuitable to leave where a child might read it?',
  {
    yes: 'It involves sexual content of any kind, sexual abuse or exploitation (including child sexual abuse material or AI-generated sexual images), graphic gore or torture, or suicide or self-harm methods.',
    no: 'It is ordinary news a family paper prints: war and conflict, politics, crime or disasters reported without sexual or graphic detail, business, science, sport, culture.',
  });

/** True when an answer's probability of "unsuitable" is over the threshold. */
export function isMature(answer, threshold = DEFAULT_THRESHOLD) {
  return Number(answer?.probability) > threshold;
}

/**
 * Screen the written edition. Returns a copy without flagged stories and the
 * headlines removed. Lead, section stories and briefs are each screened.
 */
export async function screenWritten({ written, gateway, threshold = DEFAULT_THRESHOLD, timeoutMs = 20000, timing = null, logger = console, logContext = {} }) {
  if (!gateway?.evaluate || (typeof gateway.isConfigured === 'function' && !gateway.isConfigured())) {
    return { written, removed: [], checked: 0, failed: 0 };
  }
  const items = [];
  if (written.lead) items.push({ where: 'lead', story: written.lead });
  (written.sections || []).forEach((section, si) => (section.stories || []).forEach((story, i) => items.push({ where: 'section', si, i, story })));
  (written.briefs || []).forEach((brief, i) => items.push({ where: 'brief', i, story: { headline: brief.text, body: '' } }));

  let failed = 0;
  const verdicts = await mapLimit(items, 8, async (item) => {
    try {
      const state = { title: item.story.headline || '', body: item.story.body || '' };
      const result = await withTimeout(gateway.evaluate(state, { mature: MATURE_QUESTION }, { timeout: timeoutMs }), timeoutMs + 1000, 'decision', timing);
      return isMature(result?.answers?.mature, threshold);
    } catch (error) {
      failed += 1;
      logger.warn?.('newsreporter.edition.family_safe.check_failed', { ...logContext, headline: item.story.headline, error: error?.message || String(error) });
      return false;
    }
  });

  const flagged = items.filter((_, k) => verdicts[k]);
  if (!flagged.length) return { written, removed: [], checked: items.length, failed };
  const drop = new Set(flagged);
  const keep = (where, extra) => !flagged.some((f) => f.where === where && Object.entries(extra).every(([k, v]) => f[k] === v));
  const out = {
    ...written,
    lead: written.lead && !flagged.some((f) => f.where === 'lead') ? written.lead : null,
    sections: (written.sections || [])
      .map((section, si) => ({ ...section, stories: (section.stories || []).filter((_, i) => keep('section', { si, i })) }))
      .filter((section) => section.stories.length),
    briefs: (written.briefs || []).filter((_, i) => keep('brief', { i })),
  };
  const removed = [...drop].map((f) => f.story.headline);
  logger.info?.('newsreporter.edition.family_safe.removed', { ...logContext, stage: 'write', removed });
  return { written: out, removed, checked: items.length, failed };
}
