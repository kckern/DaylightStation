/**
 * Calendar Widget (stub) — upcoming events list
 * @module 1_rendering/eink/widgets/CalendarWidget
 *
 * Skeleton renderable: when a real data source is wired (data.calendar.events:
 * [{ time, title }]) it lists those; otherwise it draws sample rows so a panel
 * author can place the widget and see its shape before the feed exists.
 */

import { drawCard, drawRows } from './lib/card.mjs';

const SAMPLE = [
  { time: '9:00a', title: 'Morning standup' },
  { time: '12:30p', title: 'Lunch with Dana' },
  { time: '3:00p', title: 'Dentist appointment' },
  { time: '6:30p', title: 'Soccer practice' },
];

export function draw(ctx, box, data, theme) {
  const events = Array.isArray(data?.calendar?.events) ? data.calendar.events : SAMPLE;
  const live = Array.isArray(data?.calendar?.events);

  const content = drawCard(ctx, box, theme, {
    title: 'Calendar',
    accent: theme.blue,
    note: live ? null : 'stub',
  });

  drawRows(ctx, content, theme, events.map((e) => ({
    lead: e.time,
    text: e.title,
    color: theme.blue,
  })));
}
