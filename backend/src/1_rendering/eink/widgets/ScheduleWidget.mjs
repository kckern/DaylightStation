/**
 * Schedule Widget (stub) — time-blocked day plan
 * @module 1_rendering/eink/widgets/ScheduleWidget
 *
 * Skeleton renderable: real source is data.schedule.blocks: [{ time, title }];
 * absent that, it draws sample time blocks so the layout reads correctly before
 * the feed is wired.
 */

import { drawCard, drawRows } from './lib/card.mjs';

const SAMPLE = [
  { time: '6–7a', title: 'Workout' },
  { time: '7–9a', title: 'Deep work' },
  { time: '9–12p', title: 'Meetings' },
  { time: '1–5p', title: 'Project time' },
  { time: '6–8p', title: 'Family / dinner' },
];

export function draw(ctx, box, data, theme) {
  const blocks = Array.isArray(data?.schedule?.blocks) ? data.schedule.blocks : SAMPLE;
  const live = Array.isArray(data?.schedule?.blocks);

  const content = drawCard(ctx, box, theme, {
    title: 'Schedule',
    accent: theme.green,
    note: live ? null : 'stub',
  });

  drawRows(ctx, content, theme, blocks.map((b) => ({
    lead: b.time,
    text: b.title,
    color: theme.green,
  })), { leadW: 130 });
}
