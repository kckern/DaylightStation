/**
 * Fitness Receipt Renderer
 *
 * Renders a thermal receipt-style fitness session summary as a PNG canvas.
 * Follows the same adapter pattern as GratitudeCardRenderer.mjs.
 *
 * Sections: Header, Treasure Box, Flame Chart, Leaderboard, Event Details.
 *
 * @module 1_rendering/fitness/FitnessReceiptRenderer
 */

import moment from 'moment-timezone';
import { wrapText } from '#rendering/lib/TextRenderer.mjs';
import { drawDivider, drawBorder, flipCanvas, formatDuration } from '#rendering/lib/LayoutHelpers.mjs';
import { initCanvas } from '#rendering/lib/CanvasFactory.mjs';
import { fitnessReceiptTheme as theme } from './fitnessReceiptTheme.mjs';

// ─── Renderer Factory ─────────────────────────────────────

/**
 * Create a fitness receipt renderer.
 *
 * @param {Object} config
 * @param {Function} config.getSessionData - async (sessionId) => parsed session object
 * @param {string} [config.fontDir] - Font directory path
 * @returns {{ createCanvas: Function }}
 */
export function createFitnessReceiptRenderer(config) {
  const { fontDir } = config;

  /**
   * Render a fitness receipt canvas.
   *
   * @param {Object} model - Complete precomputed receipt presentation model
   * @param {boolean} [upsidedown=false]
   * @returns {Promise<{canvas, width: number, height: number}>}
   */
  async function createCanvas(model, upsidedown = false) {
    if (!model) return null;

    // Register the receipt font and grab a 1x1 scratch context for text
    // measurement during the height pre-calculation below.
    const { ctx: sctx, createNodeCanvas } = await initCanvas({
      width: 1,
      height: 1,
      fontDir,
      fontFile: theme.fonts.fontPath,
      fontFamily: theme.fonts.family,
    });

    const {
      sessionInfo, tz, intervalSeconds, participantSlugs, stats, dsZones,
      chartRows, ticksPerRow, chartEvents, tbRings, tbBuckets, hasTreasureBox,
      leaderboard, challenges, media, voiceMemos,
    } = model;

    // ─── Calculate canvas height ──────────────────────────
    const { width } = theme.canvas;
    const margin = theme.layout.margin;
    const sectionGap = theme.layout.sectionGap;

    let totalHeight = 0;

    // Header section — same named advances the draw pass consumes below
    const hdr = theme.header;
    const headerHeight = hdr.topPad + hdr.titleAdvance + hdr.dateAdvance
      + hdr.durationAdvance + hdr.namesAdvance + hdr.gap;
    totalHeight += headerHeight;

    // Treasure box
    let tbHeight = 0;
    if (hasTreasureBox) {
      tbHeight = sectionGap + theme.treasureBox.ringAdvance + theme.treasureBox.barHeight + 30 + 10; // header + ring + bar + labels + gap
      totalHeight += tbHeight;
    }

    // Flame chart
    const chartContentHeight = chartRows * theme.chart.rowHeight;
    const chartHeaderHeight = theme.chart.headerHeight;
    const chartSectionHeight = sectionGap + 40 + chartHeaderHeight + chartContentHeight + 10;
    totalHeight += chartSectionHeight;

    // Leaderboard
    const lbHeaderHeight = theme.leaderboard.headerHeight;
    const lbContentHeight = leaderboard.length * theme.leaderboard.rowHeight;
    const lbSectionHeight = sectionGap + lbHeaderHeight + lbContentHeight + 10;
    totalHeight += lbSectionHeight;

    // Event detail sections
    let evDetailHeight = 0;
    if (challenges.length > 0) {
      evDetailHeight += sectionGap + 35; // section header
      evDetailHeight += challenges.length * 80; // per challenge block
    }
    if (media.length > 0) {
      evDetailHeight += sectionGap + 35;
      evDetailHeight += media.length * 50;
    }
    if (voiceMemos.length > 0) {
      evDetailHeight += sectionGap + 35;
      for (const vmEv of voiceMemos) {
        sctx.font = theme.fonts.memo;
        const transcript = vmEv.event.transcript || vmEv.event.text || '';
        const lines = wrapText(sctx, transcript, width - margin * 2 - 20);
        evDetailHeight += 30 + Math.max(1, lines.length) * 22;
      }
    }
    totalHeight += evDetailHeight;

    // Bottom padding
    totalHeight += 30;

    // ─── Create Canvas ────────────────────────────────────
    const height = Math.max(300, Math.ceil(totalHeight));
    const canvas = createNodeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';

    // White background
    ctx.fillStyle = theme.colors.background;
    ctx.fillRect(0, 0, width, height);

    // Border
    drawBorder(ctx, width, height, {
      offset: theme.layout.borderOffset,
      lineWidth: theme.layout.borderWidth,
      color: theme.colors.border,
    });

    let y = hdr.topPad;

    // ─── Section A: Header ────────────────────────────────
    ctx.fillStyle = theme.colors.text;
    ctx.font = theme.fonts.title;
    const titleText = 'FITNESS REPORT';
    const titleW = ctx.measureText(titleText).width;
    ctx.fillText(titleText, (width - titleW) / 2, y);
    y += hdr.titleAdvance;

    // Date + time
    ctx.font = theme.fonts.subtitle;
    const dateStr = sessionInfo.start
      ? moment.tz(sessionInfo.start, tz).format('ddd, D MMM YYYY, h:mm A')
      : sessionInfo.date || '--';
    const dateW = ctx.measureText(dateStr).width;
    ctx.fillText(dateStr, (width - dateW) / 2, y);
    y += hdr.dateAdvance;

    // Duration
    const durationSec = sessionInfo.duration_seconds || null;
    const durStr = durationSec != null ? formatDuration(durationSec) : '--';
    ctx.font = theme.fonts.subtitle;
    const durText = `Duration: ${durStr}`;
    const durW = ctx.measureText(durText).width;
    ctx.fillText(durText, (width - durW) / 2, y);
    y += hdr.durationAdvance;

    // Participant names
    const nameStr = participantSlugs.map(s => stats[s].displayName).join('   ');
    ctx.font = theme.fonts.body;
    const nameW = ctx.measureText(nameStr).width;
    ctx.fillText(nameStr, (width - nameW) / 2, y);
    y += hdr.namesAdvance;

    // Divider
    drawDivider(ctx, y, width);
    y += theme.layout.dividerGapAfter;

    // ─── Section B: Treasure Box ──────────────────────────
    if (hasTreasureBox) {
      y += 5;
      // Ring total
      ctx.font = theme.fonts.ringTotal;
      const ringStr = `${tbRings}`;
      const ringW = ctx.measureText(ringStr).width;
      ctx.fillText(ringStr, (width - ringW) / 2, y);
      y += theme.treasureBox.ringAdvance;

      // Ring label
      ctx.font = theme.fonts.label;
      const ringLabel = 'RINGS EARNED';
      const clW = ctx.measureText(ringLabel).width;
      ctx.fillText(ringLabel, (width - clW) / 2, y);
      y += 25;

      // Stacked bar
      const barX = theme.treasureBox.barMargin;
      const barW = width - theme.treasureBox.barMargin * 2;
      const barH = theme.treasureBox.barHeight;

      const bucketOrder = ['green', 'yellow', 'orange', 'red'];
      const bucketPatterns = { green: 0, yellow: 1, orange: 2, red: 3 };
      const totalBucketRings = bucketOrder.reduce((s, k) => s + (tbBuckets[k] || 0), 0);

      if (totalBucketRings > 0) {
        let bx = barX;
        for (const bucket of bucketOrder) {
          const val = tbBuckets[bucket] || 0;
          if (val <= 0) continue;
          const bw = (val / totalBucketRings) * barW;

          // Draw with pattern density to distinguish buckets on thermal
          ctx.fillStyle = theme.colors.text;
          const density = bucketPatterns[bucket];
          if (density === 0) {
            // Green: light fill (sparse horizontal lines)
            for (let ly = 0; ly < barH; ly += 4) {
              ctx.fillRect(bx, y + ly, bw, 1);
            }
          } else if (density === 1) {
            // Yellow: medium fill
            for (let ly = 0; ly < barH; ly += 3) {
              ctx.fillRect(bx, y + ly, bw, 1);
            }
          } else if (density === 2) {
            // Orange: dense fill
            for (let ly = 0; ly < barH; ly += 2) {
              ctx.fillRect(bx, y + ly, bw, 1);
            }
          } else {
            // Red: solid fill
            ctx.fillRect(bx, y, bw, barH);
          }

          // Bucket border
          ctx.strokeStyle = theme.colors.text;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, y, bw, barH);
          bx += bw;
        }
      }
      y += barH + 5;

      // Bucket labels
      ctx.font = theme.fonts.chartTime;
      const labelParts = bucketOrder
        .filter(k => (tbBuckets[k] || 0) > 0)
        .map(k => `${k}: ${tbBuckets[k]}`);
      const labelStr = labelParts.join('  |  ');
      const labelW = ctx.measureText(labelStr).width;
      ctx.fillText(labelStr, (width - labelW) / 2, y);
      y += 20;

      drawDivider(ctx, y, width);
      y += theme.layout.dividerGapAfter;
    }

    // ─── Section C: Flame Chart ───────────────────────────
    ctx.font = theme.fonts.sectionHeader;
    ctx.fillStyle = theme.colors.text;
    ctx.fillText('ACTIVITY CHART', margin, y);
    y += 40;

    const chartLeft = theme.chart.timeMarginWidth + margin;
    const chartRight = width - margin;
    const chartWidth = chartRight - chartLeft;
    const colCount = participantSlugs.length || 1;
    const colWidth = (chartWidth - (colCount - 1) * theme.chart.columnGap) / colCount;

    // Column headers
    ctx.font = theme.fonts.chartHeader;
    for (let i = 0; i < participantSlugs.length; i++) {
      const slug = participantSlugs[i];
      const cx = chartLeft + i * (colWidth + theme.chart.columnGap) + colWidth / 2;
      const name = stats[slug].displayName;
      const nw = ctx.measureText(name).width;
      ctx.fillText(name, cx - nw / 2, y);
    }
    y += chartHeaderHeight;

    const chartStartY = y;

    // Build event row lookup for horizontal lines
    const eventRowSet = new Set(chartEvents.map(e => e.rowIndex));

    // Draw chart rows
    for (let row = 0; row < chartRows; row++) {
      const ry = chartStartY + row * theme.chart.rowHeight;

      // Time label every N minutes
      const tickAtRow = row * ticksPerRow;
      const secondsAtRow = tickAtRow * intervalSeconds;
      const minutesAtRow = secondsAtRow / 60;
      if (row === 0 || (minutesAtRow % theme.chart.timeLabelIntervalMinutes < (ticksPerRow * intervalSeconds / 60))) {
        const mins = Math.floor(minutesAtRow);
        if (mins % theme.chart.timeLabelIntervalMinutes === 0 || row === 0) {
          ctx.font = theme.fonts.chartTime;
          ctx.fillStyle = theme.colors.gray;
          const timeLabel = `${mins}m`;
          ctx.fillText(timeLabel, margin, ry - 4);
          ctx.fillStyle = theme.colors.text;
        }
      }

      // Draw each participant column
      for (let i = 0; i < participantSlugs.length; i++) {
        const slug = participantSlugs[i];
        const zones = dsZones[slug];
        const zone = zones[row];
        const cx = chartLeft + i * (colWidth + theme.chart.columnGap) + colWidth / 2;

        if (zone == null) {
          // Pre-join: dotted line
          if (row % Math.ceil(theme.chart.dotSpacing / theme.chart.rowHeight) === 0) {
            ctx.fillStyle = theme.colors.gray;
            ctx.beginPath();
            ctx.arc(cx, ry + theme.chart.rowHeight / 2, theme.chart.dotRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = theme.colors.text;
          }
        } else {
          // Active: centered bar with zone-based width
          const zoneW = theme.chart.zoneWidths[zone] || 1;
          ctx.fillStyle = theme.colors.text;
          ctx.fillRect(cx - zoneW / 2, ry, zoneW, theme.chart.rowHeight);
        }
      }

      // Event marker horizontal line
      if (eventRowSet.has(row)) {
        ctx.strokeStyle = theme.colors.gray;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(chartLeft, ry + theme.chart.rowHeight / 2);
        ctx.lineTo(chartRight, ry + theme.chart.rowHeight / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw event symbols in left margin
        const rowEvents = chartEvents.filter(e => e.rowIndex === row);
        for (const ev of rowEvents) {
          ctx.font = theme.fonts.eventLabel;
          ctx.fillStyle = theme.colors.text;
          ctx.fillText(ev.symbol, margin + 35, ry - 2);
        }
      }
    }

    y = chartStartY + chartContentHeight + 10;
    drawDivider(ctx, y, width);
    y += theme.layout.dividerGapAfter;

    // ─── Section D: Leaderboard ───────────────────────────
    ctx.font = theme.fonts.sectionHeader;
    ctx.fillStyle = theme.colors.text;
    ctx.fillText('LEADERBOARD', margin, y);
    y += lbHeaderHeight;

    const zoneDensity = theme.leaderboard.zoneDensity;
    const zoneLabelsMap = theme.leaderboard.zoneLabels;
    const numBuckets = theme.leaderboard.histogramBuckets;
    const histH = theme.leaderboard.histogramHeight;
    const histLeft = margin + 10;
    const histWidth = width - margin * 2 - 20;

    for (let rank = 0; rank < leaderboard.length; rank++) {
      const p = leaderboard[rank];
      const rowY = y + rank * theme.leaderboard.rowHeight;
      let ly = rowY;

      // Line 1: Rank + Name (left) ... Rings (right)
      ctx.font = theme.fonts.value;
      ctx.fillStyle = theme.colors.text;
      ctx.fillText(`#${rank + 1}`, margin, ly);

      ctx.font = theme.fonts.label;
      ctx.fillText(p.displayName, margin + 40, ly + 4);

      ctx.font = theme.fonts.value;
      const ringStr = `${p.totalRings} rings`;
      const ringW = ctx.measureText(ringStr).width;
      ctx.fillText(ringStr, width - margin - ringW, ly);
      ly += 28;

      // HR stats (left, 3 lines) ... Duration + rings/min (right)
      // Fixed-width columns for alignment across participants
      ctx.font = theme.fonts.body;
      const lineH = 20;
      const labelX = margin + 10;
      const numColRight = margin + 95; // right-align HR numbers here
      const heartX = numColRight + 3;
      const rightColRight = width - margin; // right-align right-side values

      // Row 1: Max HR ... Duration
      ctx.fillText('Max:', labelX, ly);
      if (p.peakHr) {
        const v = `${p.peakHr}`;
        ctx.fillText(v, numColRight - ctx.measureText(v).width, ly);
        ctx.fillText('\u2661', heartX, ly);
      }
      const durStr = formatDuration(p.activeSeconds);
      ctx.fillText(durStr, rightColRight - ctx.measureText(durStr).width, ly);
      ly += lineH;

      // Row 2: Avg HR ... rings/min
      ctx.fillText('Avg:', labelX, ly);
      if (p.avgHr) {
        const v = `${p.avgHr}`;
        ctx.fillText(v, numColRight - ctx.measureText(v).width, ly);
        ctx.fillText('\u2661', heartX, ly);
      }
      const cpmStr = `\u26C0${p.ringsPerMinute}/min`;
      ctx.fillText(cpmStr, rightColRight - ctx.measureText(cpmStr).width, ly);
      ly += lineH;

      // Row 3: StDev HR
      ctx.fillText('StDev:', labelX, ly);
      if (p.stdDevHr != null) {
        const v = `${p.stdDevHr}`;
        ctx.fillText(v, numColRight - ctx.measureText(v).width, ly);
        ctx.fillText('\u2661', heartX, ly);
      }
      ly += lineH + 4;

      // HR Histogram (precomputed buckets; this section only draws them).
      const hist = p.hrHistogram;
      if (hist) {
        const { minHr, bucketSize, counts: buckets, maxCount, bucketZones } = hist;

        const barGap = 4;
        const barWidth = (histWidth - (numBuckets - 1) * barGap) / numBuckets;
        const histBottom = ly + histH;

        // Draw bars with zone-density fill patterns
        for (let b = 0; b < numBuckets; b++) {
          const bx = histLeft + b * (barWidth + barGap);
          const barH = Math.max(2, (buckets[b] / maxCount) * histH);
          const by = histBottom - barH;
          const density = zoneDensity[bucketZones[b]];

          ctx.fillStyle = theme.colors.text;
          if (density === 0) {
            ctx.fillRect(bx, by, barWidth, barH);
          } else {
            for (let lly = 0; lly < barH; lly += density) {
              ctx.fillRect(bx, by + lly, barWidth, 1);
            }
          }
          ctx.strokeStyle = theme.colors.text;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(bx, by, barWidth, barH);
        }

        // Baseline
        ctx.strokeStyle = theme.colors.text;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(histLeft, histBottom);
        ctx.lineTo(histLeft + histWidth, histBottom);
        ctx.stroke();

        // Per-bucket HR labels centered below each bar
        ly = histBottom + 3;
        ctx.font = theme.fonts.histLabel;
        ctx.fillStyle = theme.colors.gray;
        for (let b = 0; b < numBuckets; b++) {
          const bx = histLeft + b * (barWidth + barGap);
          const floorHr = Math.round(minHr + b * bucketSize);
          const hrLabel = `${floorHr}`;
          const lw = ctx.measureText(hrLabel).width;
          ctx.fillText(hrLabel, bx + (barWidth - lw) / 2, ly);
        }
        ctx.fillStyle = theme.colors.text;
        ly += 16;

        // Zone group brackets with zone name + ring count
        ctx.font = theme.fonts.chartTime;
        let groupStart = 0;
        for (let b = 0; b <= numBuckets; b++) {
          if (b === numBuckets || bucketZones[b] !== bucketZones[groupStart]) {
            const zone = bucketZones[groupStart];
            const gx1 = histLeft + groupStart * (barWidth + barGap);
            const gx2 = histLeft + (b - 1) * (barWidth + barGap) + barWidth;
            const gcx = (gx1 + gx2) / 2;
            const groupWidth = gx2 - gx1;

            // U-bracket: left tick, horizontal, right tick
            const tickH = 4;
            ctx.strokeStyle = theme.colors.text;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(gx1, ly);
            ctx.lineTo(gx1, ly + tickH);
            ctx.lineTo(gx2, ly + tickH);
            ctx.lineTo(gx2, ly);
            ctx.stroke();

            // Zone label + ring count (abbreviate if group is narrow)
            const rings = p.zoneRings[zone] || 0;
            const fullLabel = rings > 0
              ? `${zoneLabelsMap[zone] || zone} (\u26C0${rings})`
              : `${zoneLabelsMap[zone] || zone}`;
            const shortLabel = rings > 0
              ? `${(zone[0] || '').toUpperCase()} \u26C0${rings}`
              : `${(zone[0] || '').toUpperCase()}`;
            const label = ctx.measureText(fullLabel).width > groupWidth
              ? shortLabel : fullLabel;
            ctx.fillStyle = theme.colors.text;
            const lw = ctx.measureText(label).width;
            ctx.fillText(label, gcx - lw / 2, ly + tickH + 2);

            if (b < numBuckets) groupStart = b;
          }
        }
      }
    }

    y += lbContentHeight + 10;
    drawDivider(ctx, y, width);
    y += theme.layout.dividerGapAfter;

    // ─── Section E: Event Details ─────────────────────────

    // Challenges (use challenge_end events for final results)
    if (challenges.length > 0) {
      ctx.font = theme.fonts.sectionHeader;
      ctx.fillStyle = theme.colors.text;
      ctx.fillText(`${theme.chart.eventSymbols.challenge} CHALLENGES`, margin, y);
      y += 35;

      for (const chEv of challenges) {
        const ch = chEv.event;
        const evTime = ch.at || ch.timestamp;
        const timeStr = evTime && sessionStart
          ? moment.tz(evTime, tz).format('h:mm A')
          : '';
        const name = ch.title || ch.challenge_name || ch.name || 'Challenge';
        const goal = ch.selectionLabel || ch.goal || '';
        const status = ch.status || '';
        const resultStr = status === 'passed' ? 'PASSED' : status === 'failed' ? 'FAILED' : status.toUpperCase();
        const countStr = ch.requiredCount ? ` (${ch.actualCount || 0}/${ch.requiredCount})` : '';
        const pNames = (ch.participants_met || ch.qualifyingParticipants || []).join(', ');

        ctx.font = theme.fonts.label;
        ctx.fillText(`${timeStr}  ${name}`, margin + 10, y);
        y += 22;

        ctx.font = theme.fonts.body;
        if (goal) {
          ctx.fillText(`Goal: ${goal}`, margin + 20, y);
          y += 20;
        }
        ctx.font = theme.fonts.label;
        ctx.fillText(`${resultStr}${countStr}`, margin + 20, y);
        if (pNames) {
          ctx.font = theme.fonts.body;
          ctx.fillText(pNames, margin + 120, y);
        }
        y += 22;
        y += 16;
      }
    }

    // Media
    if (media.length > 0) {
      ctx.font = theme.fonts.sectionHeader;
      ctx.fillStyle = theme.colors.text;
      ctx.fillText(`${theme.chart.eventSymbols.media} MEDIA`, margin, y);
      y += 35;

      for (const mEv of media) {
        const m = mEv.event;
        const evTime = m.at || m.timestamp;
        const timeStr = evTime && sessionStart
          ? moment.tz(evTime, tz).format('h:mm A')
          : '';
        const title = m.title || 'Untitled';
        const context = [m.grandparentTitle, m.parentTitle, m.show, m.artist].filter(Boolean).join(' \u203A ');

        ctx.font = theme.fonts.label;
        ctx.fillText(`${timeStr}  ${title}`, margin + 10, y);
        y += 22;

        if (context) {
          ctx.font = theme.fonts.body;
          ctx.fillStyle = theme.colors.gray;
          ctx.fillText(context, margin + 20, y);
          ctx.fillStyle = theme.colors.text;
          y += 22;
        }
        y += 6;
      }
    }

    // Voice Memos
    if (voiceMemos.length > 0) {
      ctx.font = theme.fonts.sectionHeader;
      ctx.fillStyle = theme.colors.text;
      ctx.fillText(`${theme.chart.eventSymbols.voice_memo} VOICE MEMOS`, margin, y);
      y += 35;

      for (const vmEv of voiceMemos) {
        const vm = vmEv.event;
        const evTime = vm.at || vm.timestamp;
        const timeStr = evTime && sessionStart
          ? moment.tz(evTime, tz).format('h:mm A')
          : '';
        const dur = vm.duration_seconds ? formatDuration(vm.duration_seconds) : '';
        const transcript = vm.transcript || vm.text || '';

        ctx.font = theme.fonts.label;
        ctx.fillText(`${timeStr}  ${dur}`, margin + 10, y);
        y += 24;

        if (transcript) {
          ctx.font = theme.fonts.memo;
          const lines = wrapText(ctx, transcript, width - margin * 2 - 20);
          for (const line of lines) {
            ctx.fillText(line, margin + 20, y);
            y += 22;
          }
        }
        y += 6;
      }
    }

    // ─── Handle upside-down ───────────────────────────────
    if (upsidedown) {
      const flipped = flipCanvas(createNodeCanvas, canvas, width, height);
      return { canvas: flipped, width, height };
    }

    return { canvas, width, height };
  }

  return { createCanvas };
}
