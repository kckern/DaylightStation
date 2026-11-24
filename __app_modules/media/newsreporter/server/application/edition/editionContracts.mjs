/**
 * The two model contracts of an edition (zod) and their code-side checks.
 *
 *   pick  → { lead: { ids }, categories: [{ id, stories: [{ ids, rank }] }] }
 *   write → { lead, sections, briefs, day } (spec §4 "write contract")
 *
 * zod checks the shape; `checkPick` / `checkWrite` then hold the model to the
 * candidates it was shown: an id that was never a candidate is dropped, a
 * group left with no ids is dropped, a category left empty is omitted.
 */
import { z } from 'zod';
import { ApplicationError } from '#apps/common/errors/ApplicationError.mjs';
import { candidatesFor } from './editionSelect.mjs';

const ids = z.array(z.coerce.string()).default([]);

export const pickSchema = z.object({
  lead: z.object({ ids }).nullable().optional(),
  categories: z.array(z.object({
    id: z.string(),
    stories: z.array(z.object({ ids, rank: z.coerce.number().optional() })).default([]),
  })).default([]),
});

const story = z.object({
  headline: z.string().min(1),
  body: z.string().min(1),
  sources: z.array(z.string()).default([]),
  ids,
  rank: z.coerce.number().optional(),
});

export const writeSchema = z.object({
  lead: z.object({ headline: z.string().min(1), body: z.string().min(1), sources: z.array(z.string()).default([]), ids }).nullable().optional(),
  sections: z.array(z.object({
    category: z.string(),
    label: z.string().optional(),
    stories: z.array(story).default([]),
  })).default([]),
  briefs: z.array(z.object({ text: z.string().min(1), source: z.string().optional().nullable(), ids })).default([]),
  day: z.object({
    weather_note: z.string().optional().nullable(),
    notes: z.array(z.object({ module: z.string(), label: z.string().optional(), text: z.string().min(1) })).default([]),
  }).default({ notes: [] }),
});

/**
 * Hold a pick to the candidates and the categories.
 * @returns {{ lead: string[]|null, categories: Array<{ id, stories: Array<{ ids, rank }> }>, unknownIds: string[], disallowed: string[] }}
 * @throws {ApplicationError} EDITION_PICK_EMPTY when nothing usable is left
 */
export function checkPick(pick, { candidates, categories, leadEnabled = true }) {
  const known = new Map(candidates.map((c) => [c.id, c]));
  const unknownIds = [];
  const disallowed = [];
  const used = new Set();
  const keep = (list, allowed = null) => {
    const out = [];
    for (const id of list || []) {
      if (!known.has(id)) { unknownIds.push(id); continue; }
      if (allowed && !allowed.has(id)) { disallowed.push(id); continue; }
      if (used.has(id) || out.includes(id)) continue;
      out.push(id);
    }
    out.forEach((id) => used.add(id));
    return out;
  };

  let lead = leadEnabled ? keep(pick?.lead?.ids) : [];
  const byId = new Map((pick?.categories || []).map((c) => [c.id, c]));
  const out = [];
  for (const category of categories) {
    const picked = byId.get(category.id);
    if (!picked) continue;
    const allowed = new Set(candidatesFor(candidates, category).map((c) => c.id));
    const stories = [...(picked.stories || [])]
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .map((s) => ({ ids: keep(s.ids, allowed), rank: s.rank }))
      .filter((s) => s.ids.length)
      .slice(0, category.stories)
      .map((s, i) => ({ ...s, rank: i + 1 }));
    if (stories.length) out.push({ id: category.id, stories });
  }
  for (const id of byId.keys()) {
    if (!categories.some((c) => c.id === id)) unknownIds.push(`category:${id}`);
  }

  // No usable lead: promote the top story of the first category with two.
  if (leadEnabled && !lead.length) {
    const donor = out.find((c) => c.stories.length > 1) || null;
    if (donor) lead = donor.stories.shift().ids;
  }
  if (!out.length) {
    throw new ApplicationError('edition pick left every category empty', { code: 'EDITION_PICK_EMPTY' });
  }
  return { lead: lead.length ? lead : null, categories: out, unknownIds, disallowed };
}

/**
 * Hold the written edition to the picked groups: stories keep only picked
 * ids; a story with none is dropped; sections are matched to picked
 * categories by id; notes only for modules that are on the page.
 */
export function checkWrite(written, { pick, candidates, modules }) {
  const known = new Set(candidates.map((c) => c.id));
  const pickedIds = new Set([...(pick.lead || []), ...pick.categories.flatMap((c) => c.stories.flatMap((s) => s.ids))]);
  const dropped = [];
  const cleanIds = (list) => (list || []).filter((id) => known.has(id));
  const lead = written.lead ? { ...written.lead, ids: cleanIds(written.lead.ids) } : null;
  const sections = [];
  for (const category of pick.categories) {
    const section = written.sections.find((s) => s.category === category.id);
    if (!section) continue;
    const stories = section.stories
      .map((s, i) => ({ ...s, ids: cleanIds(s.ids), rank: s.rank ?? i + 1 }))
      .filter((s) => {
        const ok = s.ids.length && s.ids.some((id) => pickedIds.has(id));
        if (!ok) dropped.push(s.headline);
        return ok;
      });
    if (stories.length) sections.push({ category: category.id, label: section.label, stories });
  }
  const briefs = written.briefs.map((b) => ({ ...b, ids: cleanIds(b.ids) })).filter((b) => b.ids.length);
  const onPage = new Set(modules);
  const notes = (written.day?.notes || []).filter((n) => onPage.has(n.module));
  return {
    lead: lead && lead.ids.length ? lead : null,
    sections,
    briefs,
    day: { weather_note: written.day?.weather_note || null, notes },
    dropped,
  };
}
