/**
 * Placeholder Widget — fallback for unknown widget names
 * @module 1_rendering/eink/widgets/PlaceholderWidget
 */

export function draw(ctx, box, data, theme) {
  const { x, y, w, h } = box;

  // Dashed border
  ctx.save();
  ctx.strokeStyle = theme.muted || '#999';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
  ctx.setLineDash([]);

  // Label
  ctx.fillStyle = theme.muted || '#999';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(data?._widgetName || '?', x + w / 2, y + h / 2);
  ctx.restore();
}
