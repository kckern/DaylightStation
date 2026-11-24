/**
 * One structured model call with a zod contract and exactly one corrective
 * retry, the pattern `Consolidator` uses: ask, validate; on a bad shape (or a
 * gateway parse failure) ask once more with a correction note naming what
 * was wrong; fail the step after that.
 */
import { ApplicationError } from '#apps/common/errors/ApplicationError.mjs';

function issuesText(error) {
  const issues = error?.issues || [];
  if (!issues.length) return error?.message || String(error);
  return issues.slice(0, 8).map((i) => `${(i.path || []).join('.') || '(root)'}: ${i.message}`).join('; ');
}

/**
 * @param {object} args
 * @param {{ chatStructured: Function }} args.gateway - IAIGateway (scoped)
 * @param {Array<{role, content}>} args.messages
 * @param {import('zod').ZodType} args.schema
 * @param {string} args.step - 'pick' | 'write', for errors and logs
 * @param {string|null} [args.model]
 * @param {number} [args.maxTokens]
 * @param {object} [args.logger]
 * @param {object} [args.logContext]
 * @returns {Promise<object>} the validated output
 */
export async function structuredCall({ gateway, messages, schema, step, model = null, maxTokens, logger = console, logContext = {} }) {
  const options = { ...(model ? { model } : {}), ...(maxTokens ? { maxTokens } : {}) };
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const sent = attempt === 1 ? messages : [
      ...messages,
      {
        role: 'user',
        content: `Your previous reply did not match the required JSON shape (${issuesText(lastError)}). `
          + 'Reply again with ONLY the JSON object in exactly the shape described. No prose, no code fences.',
      },
    ];
    let raw;
    try {
      // eslint-disable-next-line no-await-in-loop
      raw = await gateway.chatStructured(sent, options);
    } catch (error) {
      lastError = error;
      logger.warn?.(`newsreporter.edition.${step}.call_failed`, { ...logContext, attempt, error: error?.message || String(error) });
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    lastError = parsed.error;
    logger.warn?.(`newsreporter.edition.${step}.invalid`, { ...logContext, attempt, issues: issuesText(parsed.error) });
  }
  throw new ApplicationError(`edition ${step}: model output failed validation after one retry (${issuesText(lastError)})`, {
    code: `EDITION_${step.toUpperCase()}_FAILED`,
  });
}

export default structuredCall;
