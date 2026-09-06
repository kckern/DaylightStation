import { getNoomColorEmoji } from '#domains/nutrition/entities/formatters.mjs';

const clean = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
const quantity = item => {
  if (Number.isFinite(item.grams)) return `${item.grams}g`;
  if (Number.isFinite(item.amount) && item.unit) return `${item.amount}${item.unit === 'serving' ? ' serving' + (item.amount === 1 ? '' : 's') : item.unit}`;
  return 'portion unknown';
};
const button = (text, cmd, id, extra = {}) => ({ text, callback_data: JSON.stringify({ cmd, id, ...extra }) });
const dateLabel = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '')
  ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`)) : 'Date unknown';

/** The sole final nutrition-receipt layout (text and photo captions). Pure: no
 * stores, transport, clocks, inferred quantities, or lifecycle mutations. */
export class NutritionReceiptRenderer {
  render(model, { limit = 4000 } = {}) {
    if (model.status === 'removed') return { text: '↩️ Removed from food log', choices: [] };
    const sections = model.sections.map(section => {
      const lines = [`${model.status === 'saved' ? '✅' : '📝'} ${dateLabel(section.date)} ${clean(section.mealTime || '')}`.trim(), ''];
      const emitted = new Set();
      const itemLine = (item, prefix = '') => `${prefix}${getNoomColorEmoji(item.color)} ${clean(item.name)} ${quantity(item)}`;
      for (const item of section.items) {
        if (emitted.has(item.id)) continue;
        const parent = item.kind === 'group' ? item : section.items.find(row => row.kind === 'group' && row.id === item.parentId);
        if (parent) {
          if (emitted.has(parent.id)) continue;
          lines.push(clean(parent.name)); emitted.add(parent.id);
          for (const child of section.items.filter(row => row.parentId === parent.id && row.kind !== 'group')) {
            lines.push(itemLine(child, '  ')); emitted.add(child.id);
          }
        } else { lines.push(itemLine(item)); emitted.add(item.id); }
      }
      return lines.join('\n');
    });
    // Saved is not confirmed. Review deadlines never appear in receipt copy or
    // controls, so stabilization alone cannot cause a Telegram edit/reminder.
    let choices = [[button('↩️ Undo', 'x', model.id), button('✏️ Edit', 'r', model.id)]];
    if (model.status === 'pending') choices = [[button('✅ Confirm', 'a', model.id), button('✏️ Edit', 'r', model.id), button('↩️ Discard', 'x', model.id)]];
    if (model.portionChoices) choices.unshift(
      [button('Confirm portion', 'p', model.id, { f: 1 })],
      [['¼', 0.25], ['⅓', 0.33], ['½', 0.5], ['⅔', 0.67], ['¾', 0.75]].map(([label, f]) => button(label, 'p', model.id, { f })),
      [['×1¼', 1.25], ['×1½', 1.5], ['×2', 2], ['×3', 3], ['×4', 4]].map(([label, f]) => button(label, 'p', model.id, { f })),
    );
    if (model.interaction === 'revision') {
      sections.push('Reply with what to change.');
      choices = [[button('Cancel edit', 'cr', model.id)]];
    }
    if (model.interaction === 'processing') {
      sections.push('Applying your edit…');
      choices = [[{ text: '⏳ Processing…', callback_data: 'noop' }]];
    }
    const full = sections.join('\n\n');
    const suffix = '\n… Full entry in Health';
    const lines = full.split('\n');
    while (lines.join('\n').length + suffix.length > limit && lines.length > 1) lines.pop();
    const text = full.length <= limit ? full : lines.join('\n').slice(0, limit - suffix.length) + suffix;
    return { text, choices };
  }
}
