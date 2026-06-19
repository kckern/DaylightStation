/**
 * Calendar Widget (stub) — upcoming events list
 * @module 1_rendering/eink/widgets/CalendarWidget
 *
 * Skeleton renderable: when a real data source is wired (data.calendar.events:
 * [{ day, time, title }]) it lists those — day on the left, title in the middle,
 * time right-aligned; otherwise it draws sample rows so a panel author can place
 * the widget and see its shape before the feed exists.
 */

import { drawCard, drawRows } from './lib/card.mjs';

const SAMPLE = [
  { day: 'Today', time: '9a', title: 'Morning standup' },
  { day: 'Today', time: '12:30p', title: 'Lunch with Dana' },
  { day: 'Tmrw', time: '3p', title: 'Dentist appointment' },
  { day: 'Sat', time: '6:30p', title: 'Soccer practice' },
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
    lead: e.day ?? e.time ?? '',
    text: e.title,
    trail: e.day ? e.time : undefined,
    color: theme.blue,
  })), { leadW: 110 });
}
