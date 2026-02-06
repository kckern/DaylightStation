/**
 * Gratitude Card Renderer
 *
 * Renders gratitude cards with gratitude and hopes items for thermal printing.
 * Extracted from legacy printer.mjs to support dependency injection.
 *
 * @module 2_adapters/gratitude/rendering/GratitudeCardRenderer
 */

import moment from 'moment-timezone';
import { gratitudeCardTheme as theme } from './gratitudeCardTheme.mjs';

/**
 * Select items for print using weighted bucket selection based on age.
 * Items are bucketed by days old (0-7, 7-14, 14-30, 30+) with weights (50, 20, 15, 15).
 * Within each bucket, items with lowest printCount are prioritized.
 *
 * @param {Array} items - Items to select from, each with datetime and printCount properties
 * @param {number} count - Number of items to select
 * @returns {Array} Selected items
 */
export function selectItemsForPrint(items, count) {
  if (!items || items.length === 0) return [];
  if (items.length <= count) return [...items];

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const bucketDefs = [
    { maxDays: 7, weight: 50 },
    { maxDays: 14, weight: 20 },
    { maxDays: 30, weight: 15 },
    { maxDays: Infinity, weight: 15 }
  ];

  const buckets = bucketDefs.map(() => []);

  for (const item of items) {
    const itemDate = new Date(item.datetime).getTime();
    const ageMs = now - itemDate;
    const ageDays = ageMs / DAY_MS;

    let prevMax = 0;
    for (let i = 0; i < bucketDefs.length; i++) {
      if (ageDays >= prevMax && ageDays < bucketDefs[i].maxDays) {
        buckets[i].push(item);
        break;
      }
      prevMax = bucketDefs[i].maxDays;
    }
  }

  for (const bucket of buckets) {
    bucket.sort((a, b) => a.printCount - b.printCount);
  }

  function pickFromBucket(bucket) {
    if (bucket.length === 0) return null;
    const minPrintCount = bucket[0].printCount;
    const candidates = bucket.filter(i => i.printCount === minPrintCount);
    const idx = Math.floor(Math.random() * candidates.length);
    const picked = candidates[idx];
    const bucketIdx = bucket.findIndex(i => i.id === picked.id);
    if (bucketIdx !== -1) bucket.splice(bucketIdx, 1);
    return picked;
  }

  function getAvailableBuckets() {
    const available = [];
    const pendingWeights = [];

    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length > 0) {
        const totalWeight = bucketDefs[i].weight + pendingWeights.reduce((a, b) => a + b, 0);
        available.push({ bucketIndex: i, weight: totalWeight });
        pendingWeights.length = 0;
      } else {
        pendingWeights.push(bucketDefs[i].weight);
      }
    }

    if (pendingWeights.length > 0 && available.length > 0) {
      available[available.length - 1].weight += pendingWeights.reduce((a, b) => a + b, 0);
    }

    return available;
  }

  function selectBucketByWeight() {
    const available = getAvailableBuckets();
    if (available.length === 0) return -1;

    const totalWeight = available.reduce((sum, b) => sum + b.weight, 0);
    let random = Math.random() * totalWeight;

    for (const { bucketIndex, weight } of available) {
      random -= weight;
      if (random <= 0) return bucketIndex;
    }

    return available[available.length - 1].bucketIndex;
  }

  const selected = [];

  while (selected.length < count) {
    const bucketIndex = selectBucketByWeight();
    if (bucketIndex === -1) break;

    const picked = pickFromBucket(buckets[bucketIndex]);
    if (picked) {
      selected.push(picked);
    }
  }

  return selected;
}

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

    // Wrap text into lines that fit within maxWidth
    function wrapText(text, maxWidth, font) {
      const tempCanvas = createNodeCanvas(1, 1);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.font = font;
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (tempCtx.measureText(testLine).width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines;
    }

    // Calculate height needed for an item (wrapped text + optional attribution)
    function calculateItemHeight(item) {
      const lines = wrapText(item.text, itemMaxWidth, theme.fonts.item);
      let h = lines.length * lineHeight;
      if (item.displayName && lines.length > 0) {
        const tempCanvas = createNodeCanvas(1, 1);
        const tempCtx = tempCanvas.getContext('2d');
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

    // Wrap text using the main canvas context
    function wrapTextCtx(text, maxWidth) {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines;
    }

    // Draw an item with text wrapping and contributor attribution
    function drawItem(item, startY, indent, maxWidth) {
      const textIndent = indent + 25;
      const attributionGap = 10;

      ctx.font = theme.fonts.item;
      ctx.fillText('\u2022', indent, startY);

      const lines = wrapTextCtx(item.text, maxWidth - 25);
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
      const flippedCanvas = createNodeCanvas(width, height);
      const flippedCtx = flippedCanvas.getContext('2d');
      flippedCtx.translate(width, height);
      flippedCtx.scale(-1, -1);
      flippedCtx.drawImage(canvas, 0, 0);
      return { canvas: flippedCanvas, width, height, selectedIds };
    }

    return { canvas, width, height, selectedIds };
  }

  return { createCanvas };
}
