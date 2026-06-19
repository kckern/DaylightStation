/**
 * Todos Widget (stub) — checklist
 * @module 1_rendering/eink/widgets/TodosWidget
 *
 * Skeleton renderable: real source is data.todos.items: [{ text, done }];
 * absent that, it draws a sample checklist. Checkboxes use plain glyphs so they
 * render in the base font without depending on a symbol face.
 */

import { drawCard, drawRows } from './lib/card.mjs';

const SAMPLE = [
  { text: 'Take out recycling', done: true },
  { text: 'Email the contractor', done: false },
  { text: 'Order birthday gift', done: false },
  { text: 'Renew library books', done: false },
];

export function draw(ctx, box, data, theme) {
  const items = Array.isArray(data?.todos?.items) ? data.todos.items : SAMPLE;
  const live = Array.isArray(data?.todos?.items);

  const content = drawCard(ctx, box, theme, {
    title: 'To-Dos',
    accent: theme.red,
    note: live ? null : 'stub',
  });

  drawRows(ctx, content, theme, items.map((i) => ({
    lead: i.done ? '[x]' : '[ ]',
    text: i.text,
    color: i.done ? theme.green : theme.fg,
  })), { leadW: 70 });
}
