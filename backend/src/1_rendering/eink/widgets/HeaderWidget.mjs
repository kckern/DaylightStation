/**
 * Header Widget — date and title bar
 * @module 1_rendering/eink/widgets/HeaderWidget
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function draw(ctx, box, data, theme) {
  const { x, y, w, h } = box;

  // Background
  ctx.fillStyle = theme.headerBg || theme.fg;
  ctx.fillRect(x, y, w, h);

  const now = new Date();
  const day = DAYS[now.getDay()];
  const month = MONTHS[now.getMonth()];
  const date = now.getDate();

  // Title (left)
  ctx.save();
  ctx.fillStyle = theme.headerFg || theme.bg;
  ctx.font = 'bold 56px DejaVu Sans';
  ctx.textBaseline = 'middle';
  const titleY = y + h / 2;
  ctx.fillText(data?.title || 'DaylightStation', x + 40, titleY);

  // Date (right)
  const dateStr = `${day}, ${month} ${date}`;
  ctx.font = '40px DejaVu Sans';
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, x + w - dateW - 40, titleY);
  ctx.restore();
}
