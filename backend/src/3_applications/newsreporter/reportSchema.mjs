import { z } from 'zod';

/**
 * Published-language contract for consolidated reports.
 *
 * A report is an ordered list of typed sections. The LLM consolidator emits
 * this shape; the renderer (1_rendering) and sinks consume it. Keeping the
 * schema in 3_applications makes it the shared interchange format between the
 * consolidator, renderer, and any sink.
 */

const heading = z.object({ type: z.literal('heading'), text: z.string() });
const lines = z.object({ type: z.literal('lines'), lines: z.array(z.string()) });
const table = z.object({
  type: z.literal('table'),
  headers: z.array(z.string()).default([]),
  rows: z.array(z.array(z.string())),
});
const note = z.object({ type: z.literal('note'), text: z.string() });

export const reportSchema = z.object({
  sections: z.array(z.discriminatedUnion('type', [heading, lines, table, note])),
});

/**
 * Validate and normalise a report object.
 * @param {unknown} obj
 * @returns {{ sections: Array }} validated report
 * @throws {import('zod').ZodError} when the shape does not match
 */
export function parseReport(obj) {
  return reportSchema.parse(obj);
}
