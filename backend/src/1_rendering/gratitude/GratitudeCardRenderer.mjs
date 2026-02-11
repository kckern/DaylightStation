/**
 * Gratitude Card Renderer
 *
 * Renders gratitude cards with gratitude and hopes items for thermal printing.
 * Extracted from legacy printer.mjs to support dependency injection.
 *
 * @module 1_rendering/gratitude/GratitudeCardRenderer
 */

import moment from 'moment-timezone';
import { selectItemsForPrint } from '#domains/gratitude/services/PrintSelectionService.mjs';
import { wrapText } from '#rendering/lib/TextRenderer.mjs';
import { flipCanvas } from '#rendering/lib/LayoutHelpers.mjs';
import { gratitudeCardTheme as theme } from './gratitudeCardTheme.mjs';

/**
 * Create a gratitude card renderer with dependency injection.
 *
 * @param {Object} config - Configuration object
 * @param {Function} config.getSelectionsForPrint - Async function that returns { gratitude: [], hopes: [] }
 * @param {string} [config.fontDir] - Font directory path (optional)
 * @param {Object} [config.canvasService] - Canvas service for rendering (optional, for future use)
 * @returns {Object} Renderer with createCanvas method
 */
export function createGratitudeCardRenderer(config) {
  const { getSelectionsForPrint, fontDir, canvasService } = config;

  /**
   * Render a gratitude card canvas.
   *
   * @param {boolean} [upsidedown=false] - Whether to rotate the canvas 180 degrees
   * @returns {Promise<{canvas: Canvas, width: number, height: number, selectedIds: {gratitude: string[], hopes: string[]}}>}
   */
  async function createCanvas(upsidedown = false) {
    const { width } = theme.canvas;
    const fontFamily = theme.fonts.family;
    const margin = theme.layout.margin;
    const lineHeight = theme.layout.lineHeight;
    const itemMaxWidth = width - margin * 2 - 40;
    const fontPath = fontDir
      ? `${fontDir}/${theme.fonts.fontPath}`
      : `./backend/journalist/fonts/roboto-condensed/${theme.fonts.fontPath}`;

    const selections = await getSelectionsForPrint();

    const selectedGratitude = selections.gratitude.length > 0
      ? selectItemsForPrint(selections.gratitude, theme.selection.gratitudeCount).map(s => ({
        id: s.id,
        text: s.item.text,
        displayName: s.displayName
      }))
      : [];

    const selectedHopes = selections.hopes.length > 0
      ? selectItemsForPrint(selections.hopes, theme.selection.hopesCount).map(s => ({
        id: s.id,
        text: s.item.text,
        displayName: s.displayName
      }))
      : [];

    const { createCanvas: createNodeCanvas, registerFont } = await import('canvas');

    try {
      registerFont(fontPath, { family: fontFamily });
    } catch (fontError) {
      // Font loading is optional - will fall back to system fonts
    }

    // Calculate height needed for an item (wrapped text + optional attribution)
    function calculateItemHeight(item) {
      const tempCanvas = createNodeCanvas(1, 1);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.font = theme.fonts.item;
      const lines = wrapText(tempCtx, item.text, itemMaxWidth);
      let h = lines.length * lineHeight;
      if (item.displayName && lines.length > 0) {
        tempCtx.font = theme.fonts.item;
        const lastLineWidth = tempCtx.measureText(lines[lines.length - 1]).width;
        tempCtx.font = theme.fonts.attribution;
        const attrWidth = tempCtx.measureText(`(${item.displayName})`).width;
        if (margin + 40 + lastLineWidth + 10 + attrWidth > width - margin) {
          h += lineHeight * 0.7;
        }
      }
      return h;
    }

    // Calculate dynamic canvas height
    const headerHeight = theme.layout.headerHeight + theme.layout.timestampHeight + theme.layout.sectionGap;
    const dividerHeight = theme.layout.dividerGapBefore + theme.layout.dividerHeight + theme.layout.dividerGapAfter;
    const bottomMargin = 30;

    let gratitudeContentHeight = theme.layout.sectionHeaderHeight;
    for (const item of selectedGratitude) gratitudeContentHeight += calculateItemHeight(item);
    if (selectedGratitude.length === 0) gratitudeContentHeight += lineHeight;

    let hopesContentHeight = theme.layout.sectionHeaderHeight;
    for (const item of selectedHopes) hopesContentHeight += calculateItemHeight(item);
    if (selectedHopes.length === 0) hopesContentHeight += lineHeight;

    const height = Math.max(450, headerHeight + gratitudeContentHeight + dividerHeight + hopesContentHeight + bottomMargin);

    const canvas = createNodeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';

    // White background
    ctx.fillStyle = theme.colors.background;
    ctx.fillRect(0, 0, width, height);

    // Black border
    ctx.strokeStyle = theme.colors.border;
    ctx.lineWidth = theme.layout.borderWidth;
    ctx.strokeRect(
      theme.layout.borderOffset,
      theme.layout.borderOffset,
      width - theme.layout.borderOffset * 2,
      height - theme.layout.borderOffset * 2
    );

    // Draw an item with text wrapping and contributor attribution
    function drawItem(item, startY, indent, maxWidth) {
      const textIndent = indent + 25;
      const attributionGap = 10;

      ctx.font = theme.fonts.item;
      ctx.fillText('\u2022', indent, startY);

      const lines = wrapText(ctx, item.text, maxWidth - 25);
      let currentY = startY;
      for (let i = 0; i < lines.length; i++) {
        ctx.font = theme.fonts.item;
        ctx.fillText(lines[i], textIndent, currentY);

        if (i === lines.length - 1 && item.displayName) {
          const textWidth = ctx.measureText(lines[i]).width;
          ctx.font = theme.fonts.attribution;
          const attrText = `(${item.displayName})`;
          const attrWidth = ctx.measureText(attrText).width;
          if (textIndent + textWidth + attributionGap + attrWidth < width - margin) {
            ctx.fillText(attrText, textIndent + textWidth + attributionGap, currentY + 8);
          } else {
            currentY += lineHeight * 0.7;
            ctx.fillText(attrText, textIndent, currentY + 8);
          }
        }

        if (i < lines.length - 1) currentY += lineHeight;
      }
      return currentY + lineHeight;
    }

    let yPos = theme.layout.headerYOffset;

    // Header: "Gratitude Card"
    ctx.fillStyle = theme.colors.text;
    ctx.font = theme.fonts.header;
    const headerText = 'Gratitude Card';
    const headerMetrics = ctx.measureText(headerText);
    ctx.fillText(headerText, (width - headerMetrics.width) / 2, yPos);
    yPos += theme.layout.headerHeight;

    // Timestamp
    ctx.font = theme.fonts.timestamp;
    const timestamp = moment().format('ddd, D MMM YYYY, h:mm A');
    const timestampMetrics = ctx.measureText(timestamp);
    ctx.fillText(timestamp, (width - timestampMetrics.width) / 2, yPos);
    yPos += theme.layout.timestampHeight;

    // Divider line
    ctx.fillRect(theme.layout.borderOffset, yPos, width - theme.layout.borderOffset * 2, theme.layout.dividerHeight);
    yPos += theme.layout.sectionGap;

    // Gratitude section
    ctx.font = theme.fonts.sectionHeader;
    ctx.fillText('Gratitude', margin, yPos + theme.layout.sectionTitlePadding);
    yPos += theme.layout.sectionHeaderHeight;

    for (const item of selectedGratitude) {
      yPos = drawItem(item, yPos, margin + theme.layout.bulletIndent, itemMaxWidth);
    }

    yPos += theme.layout.dividerGapBefore;
    ctx.fillRect(theme.layout.borderOffset, yPos, width - theme.layout.borderOffset * 2, theme.layout.dividerHeight);
    yPos += theme.layout.dividerGapAfter;

    // Hopes section
    ctx.font = theme.fonts.sectionHeader;
    ctx.fillText('Hopes', margin, yPos + theme.layout.sectionTitlePadding);
    yPos += theme.layout.sectionHeaderHeight;

    for (const item of selectedHopes) {
      yPos = drawItem(item, yPos, margin + theme.layout.bulletIndent, itemMaxWidth);
    }

    // Track which items were selected for printing
    const selectedIds = {
      gratitude: selectedGratitude.map(item => item.id),
      hopes: selectedHopes.map(item => item.id)
    };

    // Handle upside-down rotation for mounted printers
    if (upsidedown) {
      const flippedCanvas = flipCanvas(createNodeCanvas, canvas, width, height);
      return { canvas: flippedCanvas, width, height, selectedIds };
    }

    return { canvas, width, height, selectedIds };
  }

  return { createCanvas };
}
