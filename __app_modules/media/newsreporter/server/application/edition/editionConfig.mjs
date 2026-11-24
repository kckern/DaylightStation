/**
 * Edition reporter config (3_applications, pure).
 *
 * An `edition` reporter is the second NewsReporter kind: a one-page morning
 * paper composed by an LLM from the feed's headlines plus a "your day" box,
 * rendered to a PNG and printed on delivery (spec
 * ops:docs/superpowers/specs/2026-11-23-office-paper-design.md §3).
 *
 * `parseEditionConfig(raw)` checks the shape and fills defaults. It throws a
 * `ValidationError` whose `field` names the offending key, so a broken config
 * never composes. `checkEditionSources(cfg, { pages, sourceIds })` is the
 * second half: page and source ids are only knowable once the feed has been
 * read, so the compose pipeline calls it right after gathering headlines and
 * before any model call.
 */
import { z } from 'zod';
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

export const SHOW_POLICIES = Object.freeze(['always', 'weekdays', 'weekends', 'rotate', 'when_notable', 'never']);
export const DAY_MODULES = Object.freeze(['weather', 'calendar', 'todoist', 'yesterday', 'school', 'reflective']);
export const MODULE_PARTS = Object.freeze({
  yesterday: ['strava', 'health'],
  reflective: ['immich', 'journal', 'gratitude'],
});

const show = z.enum(SHOW_POLICIES);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

const moduleSchema = (name) => {
  const parts = MODULE_PARTS[name];
  return z.strictObject({
    show: show.default('always'),
    weight: z.number().positive().default(1),
    max: z.number().int().positive().optional(),
    ...(parts ? { parts: z.array(z.enum(parts)).min(1).default(parts) } : {}),
  });
};

const categorySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase id'),
  label: z.string().min(1),
  topic: z.string().optional(),
  sources: z.array(z.string().min(1)).min(1).optional(),
  exclude: z.array(z.string().min(1)).optional(),
  stories: z.number().int().min(1).max(8).default(2),
  balance: z.enum(['lean']).optional(),
  optional: z.boolean().default(false),
});

const daySchema = z.strictObject({
  ...Object.fromEntries(DAY_MODULES.map((name) => [name, moduleSchema(name).optional()])),
  rotation: z.strictObject({ slots: z.number().int().min(0).max(6).default(1) }).default({ slots: 1 }),
}).default({ rotation: { slots: 1 } });

export const editionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  kind: z.literal('edition'),
  title: z.string().min(1),
  tagline: z.string().optional(),
  purpose: z.string().optional(),
  schedule: z.string().min(1),
  deliver: z.strictObject({
    printer: z.string().min(1),
    fallback: z.boolean().default(false),
    once_per_day: z.boolean().default(true),
    expires_after: hhmm.default('12:00'),
  }),
  length: z.strictObject({
    target_cm: z.number().positive().default(50),
    max_cm: z.number().positive().default(60),
  }).default({ target_cm: 50, max_cm: 60 }),
  model: z.string().nullable().default(null),
  voice: z.string().default(''),
  news: z.strictObject({
    user: z.string().min(1),
    pages: z.array(z.string().min(1)).min(1).optional(),
    max_age_hours: z.number().positive().default(18),
    dedupe_editions: z.number().int().min(0).default(3),
    lead: z.strictObject({
      enabled: z.boolean().default(true),
      sentences: z.number().int().min(1).max(10).default(4),
    }).default({ enabled: true, sentences: 4 }),
    categories: z.array(categorySchema).min(1),
  }),
  day: daySchema,
}).superRefine((cfg, ctx) => {
  const seen = new Set();
  cfg.news.categories.forEach((category, i) => {
    if (seen.has(category.id)) {
      ctx.addIssue({ code: 'custom', path: ['news', 'categories', i, 'id'], message: `category id "${category.id}" repeats` });
    }
    seen.add(category.id);
  });
  if (cfg.length.max_cm < cfg.length.target_cm) {
    ctx.addIssue({ code: 'custom', path: ['length', 'max_cm'], message: 'max_cm is below target_cm' });
  }
});

/** zod path → `news.categories[2].id` */
function keyOf(path = []) {
  return path.reduce((key, part) => (typeof part === 'number' ? `${key}[${part}]` : key ? `${key}.${part}` : String(part)), '');
}

/** True when a raw reporter config is an edition reporter. */
export function isEditionReporter(raw) {
  return raw?.kind === 'edition';
}

/**
 * @param {object} raw - the reporter's block from newsreporter/config.yml
 * @param {string} [reporterId] - for the error message
 * @returns {object} the parsed config with defaults filled
 * @throws {ValidationError} naming the first offending key
 */
export function parseEditionConfig(raw, reporterId = 'edition') {
  const result = editionConfigSchema.safeParse(raw ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = keyOf(issue.path);
  const unknown = issue.code === 'unrecognized_keys' ? ` (${issue.keys.join(', ')})` : '';
  throw new ValidationError(`newsreporter ${reporterId}: ${field || '(root)'}: ${issue.message}${unknown}`, {
    code: 'EDITION_CONFIG_INVALID',
    field: field || null,
    details: result.error.issues.map((i) => ({ field: keyOf(i.path), message: i.message })),
  });
}

/**
 * Check the page and source ids a config names against what the feed has.
 * @param {object} cfg - parsed edition config
 * @param {{ pages: string[], sourceIds: Iterable<string> }} known
 * @throws {ValidationError} naming the key with the unknown id
 */
export function checkEditionSources(cfg, { pages = [], sourceIds = [] } = {}, reporterId = 'edition') {
  const pageSet = new Set(pages);
  const sourceSet = new Set(sourceIds);
  const fail = (field, message) => {
    throw new ValidationError(`newsreporter ${reporterId}: ${field}: ${message}`, { code: 'EDITION_CONFIG_INVALID', field });
  };
  (cfg.news.pages || []).forEach((page, i) => {
    if (!pageSet.has(page)) fail(`news.pages[${i}]`, `unknown headline page "${page}"`);
  });
  cfg.news.categories.forEach((category, i) => {
    for (const key of ['sources', 'exclude']) {
      (category[key] || []).forEach((id, j) => {
        if (!sourceSet.has(id)) fail(`news.categories[${i}].${key}[${j}]`, `unknown source id "${id}"`);
      });
    }
  });
}

export default { parseEditionConfig, checkEditionSources, isEditionReporter };
