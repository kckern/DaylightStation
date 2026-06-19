/**
 * Date Widget — large focal date (no time)
 * @module 1_rendering/eink/widgets/DateWidget
 *
 * A self-contained canned renderable: no data source needed, it reads the
 * server date at render time. Deliberately shows NO live clock — an e-ink panel
 * refreshes on a cadence, so a ticking time would be stale/misleading. The date
 * only changes once a day, which also keeps the panel's content hash stable
 * between refreshes (clean 304s for conditional-GET pulls).
 */

import { font } from './lib/fonts.mjs';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function draw(ctx, box, data, theme) {
  const { x, y, w, h } = box;
  const now = new Date();

  const cx = x + w / 2;
  const cy = y + h / 2;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Weekday (above)
  ctx.fillStyle = theme.muted;
  ctx.font = font(Math.min(Math.round(h * 0.15), 52));
  ctx.fillText(DAYS[now.getDay()], cx, cy - h * 0.32);

  // Big day-of-month number (focal)
  ctx.fillStyle = theme.fg;
  ctx.font = font(Math.min(Math.round(h * 0.5), 200), { bold: true });
  ctx.fillText(String(now.getDate()), cx, cy + h * 0.02);

  // Month + year (below)
  ctx.fillStyle = theme.fg;
  ctx.font = font(Math.min(Math.round(h * 0.13), 46));
  ctx.fillText(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`, cx, cy + h * 0.34);

  ctx.restore();
}
