/**
 * Canvas Drawing Utilities
 * @module 0_system/canvas/drawingUtils
 *
 * Pure functions for common canvas drawing operations.
 * No state, no side effects - just drawing primitives.
 */

/**
 * Measure text width
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @returns {number}
 */
export function measureTextWidth(ctx, text) {
  return ctx.measureText(text).width;
}

/**
 * Measure text height
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @returns {number}
 */
export function measureTextHeight(ctx, text) {
  const metrics = ctx.measureText(text);
  return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
}

/**
 * Draw a filled rectangle with optional centered label
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {number} options.x
 * @param {number} options.y
 * @param {number} options.width
 * @param {number} options.height
 * @param {string} options.fillColor
 * @param {string} [options.label]
 * @param {string} [options.labelFont]
 * @param {string} [options.labelColor]
 * @param {string} [options.labelPosition] - 'center' | 'left' | 'right' | 'top' | 'bottom'
 */
export function drawRect(ctx, { x, y, width, height, fillColor, label, labelFont, labelColor = '#000', labelPosition = 'center' }) {
  if (!width || !height) return;

  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.fillRect(x, y, width, height);

  if (label) {
    if (labelFont) ctx.font = labelFont;
    ctx.fillStyle = labelColor;

    const labelWidth = measureTextWidth(ctx, label);
    const labelHeight = measureTextHeight(ctx, label);

    let labelX = x + width / 2 - labelWidth / 2;
    let labelY = y + height / 2 + labelHeight / 4;

    if (/left/.test(labelPosition)) labelX = x + 4;
    else if (/right/.test(labelPosition)) labelX = x + width - labelWidth - 4;
    if (/top/.test(labelPosition)) labelY = y + labelHeight;
    else if (/bottom/.test(labelPosition)) labelY = y + height - 4;

    ctx.fillText(label, labelX, labelY);
  }
  ctx.restore();
}

/**
 * Draw a pie chart
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {number} options.centerX
 * @param {number} options.centerY
 * @param {number} options.radius
 * @param {Array<{value: number, color: string, label?: string, subLabel?: string}>} options.slices
 * @param {string} [options.labelFont]
 * @param {string} [options.subLabelFont]
 */
export function drawPieChart(ctx, { centerX, centerY, radius, slices, labelFont, subLabelFont }) {
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) return;

  let startAngle = -Math.PI / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const slice of slices) {
    const percentage = slice.value / total;
    if (percentage === 0) continue;

    const endAngle = startAngle + percentage * 2 * Math.PI;

    // Draw wedge
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();

    // Draw label in wedge center
    if (slice.label) {
      const midAngle = startAngle + (endAngle - startAngle) / 2;
      const labelRadius = radius * 0.6;
      const labelX = centerX + Math.cos(midAngle) * labelRadius;
      const labelY = centerY + Math.sin(midAngle) * labelRadius;

      ctx.save();
      if (labelFont) ctx.font = labelFont;
      ctx.fillStyle = '#000';
      ctx.fillText(slice.label, labelX, labelY - (slice.subLabel ? 12 : 0));

      if (slice.subLabel && subLabelFont) {
        ctx.font = subLabelFont;
        ctx.fillText(slice.subLabel, labelX, labelY + 24);
      }
      ctx.restore();
    }

    startAngle = endAngle;
  }
}

/**
 * Draw a horizontal progress bar
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {number} options.x
 * @param {number} options.y
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.progress - 0 to 1
 * @param {string} options.fillColor
 * @param {string} options.backgroundColor
 */
export function drawProgressBar(ctx, { x, y, width, height, progress, fillColor, backgroundColor }) {
  ctx.save();

  // Background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(x, y, width, height);

  // Fill
  const fillWidth = width * Math.min(Math.max(progress, 0), 1);
  if (fillWidth > 0) {
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, fillWidth, height);
  }

  ctx.restore();
}

/**
 * Draw a dashed horizontal line
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {number} options.x1
 * @param {number} options.y
 * @param {number} options.x2
 * @param {string} options.color
 * @param {number} [options.lineWidth]
 * @param {number[]} [options.dashPattern]
 */
export function drawDashedLine(ctx, { x1, y, x2, color, lineWidth = 2, dashPattern = [5, 5] }) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dashPattern);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Draw centered text
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {string} options.text
 * @param {number} options.x - Center X position
 * @param {number} options.y
 * @param {string} [options.font]
 * @param {string} [options.color]
 */
export function drawCenteredText(ctx, { text, x, y, font, color = '#000' }) {
  ctx.save();
  if (font) ctx.font = font;
  ctx.fillStyle = color;
  const width = measureTextWidth(ctx, text);
  ctx.fillText(text, x - width / 2, y);
  ctx.restore();
}
