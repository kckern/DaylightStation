/**
 * Teacher-facing guide rendered from validated course inventory.
 *
 * The guide prose is course content and lives with the course source, not in code:
 * `renderKoreanCourseGuide(manifest, template)` fills the placeholders
 *   {{cards}} {{questions}}  - totals
 *   {{rows}}                 - one table row per unit (manifest.baseRow first, then manifest.inventory)
 *   {{units}}                - one grammar-notes section per inventory unit
 */
export const GUIDE_PLACEHOLDERS = Object.freeze(['{{cards}}', '{{questions}}', '{{rows}}', '{{units}}']);

export function renderKoreanCourseGuide(manifest, template) {
  if (typeof template !== 'string' || !GUIDE_PLACEHOLDERS.every((token) => template.includes(token))) {
    throw new Error(`Teacher guide template must contain ${GUIDE_PLACEHOLDERS.join(' ')}`);
  }
  const rows = [...(manifest.baseRow ? [manifest.baseRow] : []), ...manifest.inventory];
  const table = rows.map((r) => `| ${r.lesson} | ${r.title} | ${r.kind} | ${r.cards} | ${r.questions} | ${r.textbookPages.join('–')} | ${r.workbookPages.join('–')} |`).join('\n');
  const units = manifest.inventory.map((row) => `### Unit ${row.lesson}: ${row.title}\n\n${row.patterns.map((p) => `- **${p.label}** — ${p.explanation} Source: ${p.source.book} p. ${p.source.page}.`).join('\n')}\n`).join('\n');
  // Function replacers: card text may contain "$" sequences that String.replace would interpret.
  return template
    .replace('{{cards}}', () => String(manifest.cards)).replace('{{questions}}', () => String(manifest.questions))
    .replace('{{rows}}', () => table).replace('{{units}}', () => units);
}

/** Lesson-1 row of the unit table, derived from the base unit's own data. */
export function baseUnitRow(baseUnit) {
  const pages = /Textbook pages (\d+)[–-](\d+); workbook pages (\d+)[–-](\d+)/u.exec(baseUnit.reading ?? '');
  if (!pages) throw new Error('Base unit reading must read "Textbook pages A–B; workbook pages C–D."');
  return {
    lesson: baseUnit.sequence, title: String(baseUnit.title).split(': ').slice(1).join(': '), kind: 'new',
    cards: baseUnit.practice.requiredCardIds.length, questions: Object.keys(baseUnit.practice.questionCards).length,
    textbookPages: [Number(pages[1]), Number(pages[2])], workbookPages: [Number(pages[3]), Number(pages[4])],
  };
}
