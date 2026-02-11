/**
 * Fitness Receipt Renderer
 *
 * Renders a thermal receipt-style fitness session summary as a PNG canvas.
 * Follows the same adapter pattern as GratitudeCardRenderer.mjs.
 *
 * Sections: Header, Treasure Box, Flame Chart, Leaderboard, Event Details.
 *
 * @module 1_adapters/fitness/rendering/FitnessReceiptRenderer
 */

import moment from 'moment-timezone';
import { decodeSingleSeries } from '#domains/fitness/services/TimelineService.mjs';
import { fitnessReceiptTheme as theme } from './fitnessReceiptTheme.mjs';

// ─── Helpers ──────────────────────────────────────────────

/**
 * Map zone symbol from data ('c','a','w','h','fire') to zone name
 */
function resolveZone(sym) {
  return theme.chart.zoneSymbolMap[sym] || null;
}

/**
 * Downsample an array by taking the max-intensity zone within each window.
 * Zone intensity order: null < cool < active < warm < hot < fire
 */
const ZONE_ORDER = ['cool', 'active', 'warm', 'hot', 'fire'];
function zoneIntensity(zone) {
  const idx = ZONE_ORDER.indexOf(zone);
  return idx === -1 ? -1 : idx;
}

function downsampleZones(zones, targetRows) {
  if (!zones || zones.length <= targetRows) return zones || [];
  const windowSize = Math.max(1, Math.ceil(zones.length / targetRows));
  const result = [];
  for (let i = 0; i < zones.length; i += windowSize) {
    const window = zones.slice(i, i + windowSize);
    let best = null;
    for (const z of window) {
      if (z != null && (best == null || zoneIntensity(z) > zoneIntensity(best))) {
        best = z;
      }
    }
    result.push(best);
  }
  return result;
}

function downsampleValues(arr, targetRows) {
  if (!arr || arr.length <= targetRows) return arr || [];
  const windowSize = Math.max(1, Math.ceil(arr.length / targetRows));
  const result = [];
  for (let i = 0; i < arr.length; i += windowSize) {
    const window = arr.slice(i, i + windowSize);
    const valid = window.filter(v => v != null);
    result.push(valid.length > 0 ? Math.max(...valid) : null);
  }
  return result;
}

/**
 * Format duration in seconds to "Xm Ys" or "Xh Ym"
 */
function formatDuration(seconds) {
  if (seconds == null) return '--';
  const s = Math.round(seconds);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}

/**
 * Wrap text into lines that fit within maxWidth.
 */
function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

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
  const { getSessionData, resolveDisplayName, fontDir } = config;

  /**
   * Render a fitness receipt canvas.
   *
   * @param {string} sessionId
   * @param {boolean} [upsidedown=false]
   * @returns {Promise<{canvas, width: number, height: number}>}
   */
  async function createCanvas(sessionId, upsidedown = false) {
    const data = await getSessionData(sessionId);
    if (!data) return null;

    const { createCanvas: createNodeCanvas, registerFont } = await import('canvas');

    // Register font
    const fontFamily = theme.fonts.family;
    const fontPath = fontDir
      ? `${fontDir}/${theme.fonts.fontPath}`
      : `./backend/journalist/fonts/roboto-condensed/${theme.fonts.fontPath}`;
    try {
      registerFont(fontPath, { family: fontFamily });
    } catch { /* fall back to system fonts */ }

    // ─── Parse session data ───────────────────────────────
    const sessionInfo = data.session || {};
    const participants = data.participants || {};
    const timeline = data.timeline || {};
    const treasureBox = data.treasureBox || data.totals || null;
    const rawEvents = data.events || [];
    const tz = data.timezone || sessionInfo.timezone || 'UTC';

    const intervalSeconds = timeline.interval_seconds || 5;
    const tickCount = timeline.tick_count || 0;

    // Series live in timeline.series (flat keys: 'slug:hr', 'slug:zone', etc.)
    // OR timeline.participants.slug.hr (v3 nested format)
    const series = timeline.series || {};
    const timelineParticipants = timeline.participants || {};

    // Discover participant slugs from series keys (slug:zone pattern)
    // Cross-reference with participants block for display names
    const seriesSlugs = new Set();
    for (const key of Object.keys(series)) {
      const match = key.match(/^([^:]+):zone$/);
      if (match) seriesSlugs.add(match[1]);
    }
    // Also include slugs from participants block
    for (const slug of Object.keys(participants)) {
      seriesSlugs.add(slug);
    }
    const participantSlugs = [...seriesSlugs].filter(s => s !== 'global' && !s.startsWith('device:') && !s.startsWith('bike:'));

    // ─── Decode RLE series per participant ─────────────────
    const decoded = {};
    for (const slug of participantSlugs) {
      // Try flat series keys first, then nested participants format
      const rawZone = series[`${slug}:zone`] || timelineParticipants[slug]?.zone;
      const rawHr = series[`${slug}:hr`] || timelineParticipants[slug]?.hr;
      const rawCoins = series[`${slug}:coins`] || timelineParticipants[slug]?.coins;

      // decodeSingleSeries handles both RLE strings and already-decoded arrays
      const zoneArr = decodeSingleSeries(rawZone) || (Array.isArray(rawZone) ? rawZone : []);
      const hrArr = decodeSingleSeries(rawHr) || (Array.isArray(rawHr) ? rawHr : []);
      const coinsArr = decodeSingleSeries(rawCoins) || (Array.isArray(rawCoins) ? rawCoins : []);

      // Map zone symbols to names
      const zones = zoneArr.map(z => z != null ? (resolveZone(z) || z) : null);

      decoded[slug] = { zones, hr: hrArr, coins: coinsArr };
    }

    // ─── Per-participant stats ─────────────────────────────
    const stats = {};
    for (const slug of participantSlugs) {
      const p = participants[slug] || {};
      const d = decoded[slug] || { zones: [], hr: [], coins: [] };
      const hrValid = d.hr.filter(v => v != null && v > 0);
      const peakHr = hrValid.length > 0 ? Math.max(...hrValid) : null;
      // Coin series is cumulative — last value is the total, not a sum
      const lastCoin = d.coins.length > 0 ? (d.coins[d.coins.length - 1] || 0) : 0;
      const totalCoins = p.coins_earned != null ? p.coins_earned : lastCoin;
      const activeTicks = d.zones.filter(z => z != null).length;
      const activeSeconds = p.active_seconds != null ? p.active_seconds : activeTicks * intervalSeconds;
      const joinTick = d.hr.findIndex(v => v != null && v > 0);
      const warmPlusTicks = d.zones.filter(z =>
        z === 'warm' || z === 'hot' || z === 'fire'
      ).length;
      const warmPlusRatio = activeTicks > 0 ? warmPlusTicks / activeTicks : 0;

      const avgHr = hrValid.length > 0 ? Math.round(hrValid.reduce((s, v) => s + v, 0) / hrValid.length) : null;
      const stdDevHr = hrValid.length > 1
        ? Math.round(Math.sqrt(hrValid.reduce((s, v) => s + (v - avgHr) ** 2, 0) / hrValid.length))
        : null;

      // Count ticks per zone for the histogram
      const zoneTicks = {};
      for (const z of d.zones) {
        if (z != null) zoneTicks[z] = (zoneTicks[z] || 0) + 1;
      }
      // Convert to seconds
      const zoneSeconds = {};
      for (const [z, count] of Object.entries(zoneTicks)) {
        zoneSeconds[z] = count * intervalSeconds;
      }

      // Build zone HR boundaries and per-zone coins from paired data
      const zoneBounds = {};
      const zoneCoins = {};
      for (let i = 0; i < d.hr.length && i < d.zones.length; i++) {
        const hr = d.hr[i];
        const z = d.zones[i];
        if (hr != null && hr > 0 && z != null) {
          if (!zoneBounds[z]) zoneBounds[z] = { min: hr, max: hr };
          else {
            if (hr < zoneBounds[z].min) zoneBounds[z].min = hr;
            if (hr > zoneBounds[z].max) zoneBounds[z].max = hr;
          }
        }
        // Coins per zone (delta from cumulative)
        if (z != null && i < d.coins.length) {
          const cur = d.coins[i] || 0;
          const prev = i > 0 ? (d.coins[i - 1] || 0) : 0;
          const delta = Math.max(0, cur - prev);
          if (delta > 0) {
            const zoneName = resolveZone(z) || z;
            zoneCoins[zoneName] = (zoneCoins[zoneName] || 0) + delta;
          }
        }
      }

      stats[slug] = {
        displayName: p.display_name || (resolveDisplayName ? resolveDisplayName(slug) : null) || slug,
        peakHr,
        avgHr,
        stdDevHr,
        totalCoins,
        activeSeconds,
        joinTick,
        warmPlusRatio,
        zoneSeconds,
        hrValues: hrValid,
        zoneBounds,
        zoneCoins,
      };
    }

    // ─── Downsample zone data for chart ───────────────────
    const targetRows = theme.chart.downsampleTarget;
    const dsZones = {};
    for (const slug of participantSlugs) {
      dsZones[slug] = downsampleZones(decoded[slug].zones, targetRows);
    }
    const chartRows = participantSlugs.length > 0
      ? Math.max(...participantSlugs.map(s => dsZones[s].length))
      : 0;

    // ─── Flatten events ──────────────────────────────────
    // Events can be: array of { at, type, data } OR dict { type: [...] }
    const sessionStart = sessionInfo.start
      ? moment.tz(sessionInfo.start, tz)
      : null;
    const allEvents = [];
    if (Array.isArray(rawEvents)) {
      for (const ev of rawEvents) {
        // Flatten: merge ev.data into top-level for uniform access
        allEvents.push({ ...ev.data, at: ev.at, timestamp: ev.timestamp, _type: ev.type });
      }
    } else if (rawEvents && typeof rawEvents === 'object') {
      for (const [type, evList] of Object.entries(rawEvents)) {
        if (!Array.isArray(evList)) continue;
        for (const ev of evList) {
          allEvents.push({ ...ev.data, ...ev, _type: type });
        }
      }
    }

    // Normalize event type names for symbol lookup
    // Real types: media_start, challenge_start, challenge_end, voice_memo, overlay.*
    // Skip challenge_start — only challenge_end has the final result
    const EVENT_TYPE_MAP = {
      media_start: 'media',
      challenge_end: 'challenge',
      voice_memo: 'voice_memo',
    };

    // Map events to chart row positions
    const ticksPerRow = tickCount > 0 && chartRows > 0 ? tickCount / chartRows : 1;
    const chartEvents = [];
    for (const ev of allEvents) {
      const evTime = ev.at || ev.timestamp;
      if (!evTime || !sessionStart) continue;
      const rawType = ev._type || 'unknown';
      const normalType = EVENT_TYPE_MAP[rawType];
      if (!normalType) continue; // skip overlay.* and other internal events
      const evMoment = moment.tz(evTime, tz);
      const offsetSec = evMoment.diff(sessionStart, 'seconds');
      const tickIndex = Math.max(0, Math.floor(offsetSec / intervalSeconds));
      const rowIndex = Math.min(chartRows - 1, Math.max(0, Math.floor(tickIndex / ticksPerRow)));
      const symbol = theme.chart.eventSymbols[normalType] || '\u25CF';
      const label = ev.title || ev.name || ev.challenge_name || normalType;
      chartEvents.push({ rowIndex, type: normalType, symbol, label, event: ev });
    }
    chartEvents.sort((a, b) => a.rowIndex - b.rowIndex);

    // ─── Treasure box data ────────────────────────────────
    const tbCoins = treasureBox?.totalCoins ?? treasureBox?.coins ?? 0;
    const tbBuckets = treasureBox?.buckets || {};
    const hasTreasureBox = tbCoins > 0;

    // ─── Leaderboard (sorted by coins desc) ───────────────
    const leaderboard = participantSlugs
      .map(slug => ({ slug, ...stats[slug] }))
      .sort((a, b) => b.totalCoins - a.totalCoins);

    // ─── Event details by type (use chart events which are already normalized) ──
    // Deduplicate challenges: keep only the LAST event per challengeId (final outcome)
    const challengeEndEvents = chartEvents.filter(e => e.type === 'challenge' && e.event._type === 'challenge_end');
    const challengeById = new Map();
    for (const chEv of challengeEndEvents) {
      const cid = chEv.event.challengeId;
      challengeById.set(cid, chEv); // last one wins (events are time-sorted)
    }
    const challenges = [...challengeById.values()];
    const media = chartEvents.filter(e => e.type === 'media');
    const voiceMemos = chartEvents.filter(e => e.type === 'voice_memo');

    // ─── Calculate canvas height ──────────────────────────
    const { width } = theme.canvas;
    const margin = theme.layout.margin;
    const sectionGap = theme.layout.sectionGap;

    // Use a scratch canvas for text measurement
    const scratch = createNodeCanvas(1, 1);
    const sctx = scratch.getContext('2d');

    let totalHeight = 0;

    // Header section
    const headerHeight = 10 + 55 + 30 + 30 + 30 + 10; // top pad + title + date + duration + names + gap
    totalHeight += headerHeight;

    // Treasure box
    let tbHeight = 0;
    if (hasTreasureBox) {
      tbHeight = sectionGap + 70 + theme.treasureBox.barHeight + 30 + 10; // header + coin + bar + labels + gap
      totalHeight += tbHeight;
    }

    // Flame chart
    const chartContentHeight = chartRows * theme.chart.rowHeight;
    const chartHeaderHeight = 25;
    const chartSectionHeight = sectionGap + 40 + chartHeaderHeight + chartContentHeight + 10;
    totalHeight += chartSectionHeight;

    // Leaderboard
    const lbHeaderHeight = 40;
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
    ctx.strokeStyle = theme.colors.border;
    ctx.lineWidth = theme.layout.borderWidth;
    ctx.strokeRect(
      theme.layout.borderOffset,
      theme.layout.borderOffset,
      width - theme.layout.borderOffset * 2,
      height - theme.layout.borderOffset * 2
    );

    let y = 10;

    // ─── Section A: Header ────────────────────────────────
    ctx.fillStyle = theme.colors.text;
    ctx.font = theme.fonts.title;
    const titleText = 'FITNESS REPORT';
    const titleW = ctx.measureText(titleText).width;
    ctx.fillText(titleText, (width - titleW) / 2, y);
    y += 55;

    // Date + time
    ctx.font = theme.fonts.subtitle;
    const dateStr = sessionInfo.start
      ? moment.tz(sessionInfo.start, tz).format('ddd, D MMM YYYY, h:mm A')
      : sessionInfo.date || '--';
    const dateW = ctx.measureText(dateStr).width;
    ctx.fillText(dateStr, (width - dateW) / 2, y);
    y += 30;

    // Duration
    const durationSec = sessionInfo.duration_seconds || null;
    const durStr = durationSec != null ? formatDuration(durationSec) : '--';
    ctx.font = theme.fonts.subtitle;
    const durText = `Duration: ${durStr}`;
    const durW = ctx.measureText(durText).width;
    ctx.fillText(durText, (width - durW) / 2, y);
    y += 30;

    // Participant names
    const nameStr = participantSlugs.map(s => stats[s].displayName).join('   ');
    ctx.font = theme.fonts.body;
    const nameW = ctx.measureText(nameStr).width;
    ctx.fillText(nameStr, (width - nameW) / 2, y);
    y += 30;

    // Divider
    drawDivider(ctx, y, width);
    y += theme.layout.dividerGapAfter;

    // ─── Section B: Treasure Box ──────────────────────────
    if (hasTreasureBox) {
      y += 5;
      // Coin total
      ctx.font = theme.fonts.coinTotal;
      const coinStr = `${tbCoins}`;
      const coinW = ctx.measureText(coinStr).width;
      ctx.fillText(coinStr, (width - coinW) / 2, y);
      y += 70;

      // Coin label
      ctx.font = theme.fonts.label;
      const coinLabel = 'COINS EARNED';
      const clW = ctx.measureText(coinLabel).width;
      ctx.fillText(coinLabel, (width - clW) / 2, y);
      y += 25;

      // Stacked bar
      const barX = theme.treasureBox.barMargin;
      const barW = width - theme.treasureBox.barMargin * 2;
      const barH = theme.treasureBox.barHeight;

      const bucketOrder = ['green', 'yellow', 'orange', 'red'];
      const bucketPatterns = { green: 0, yellow: 1, orange: 2, red: 3 };
      const totalBucketCoins = bucketOrder.reduce((s, k) => s + (tbBuckets[k] || 0), 0);

      if (totalBucketCoins > 0) {
        let bx = barX;
        for (const bucket of bucketOrder) {
          const val = tbBuckets[bucket] || 0;
          if (val <= 0) continue;
          const bw = (val / totalBucketCoins) * barW;

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

    const zoneOrder = ['cool', 'active', 'warm', 'hot', 'fire'];
    const zoneDensity = { cool: 6, active: 4, warm: 3, hot: 2, fire: 0 };
    const zoneLabelsMap = { cool: 'Cool', active: 'Active', warm: 'Warm', hot: 'Hot', fire: 'Fire' };
    const numBuckets = theme.leaderboard.histogramBuckets;
    const histH = theme.leaderboard.histogramHeight;
    const histLeft = margin + 10;
    const histWidth = width - margin * 2 - 20;

    for (let rank = 0; rank < leaderboard.length; rank++) {
      const p = leaderboard[rank];
      const rowY = y + rank * theme.leaderboard.rowHeight;
      let ly = rowY;

      // Line 1: Rank + Name (left) ... Coins (right)
      ctx.font = theme.fonts.value;
      ctx.fillStyle = theme.colors.text;
      ctx.fillText(`#${rank + 1}`, margin, ly);

      ctx.font = theme.fonts.label;
      ctx.fillText(p.displayName, margin + 40, ly + 4);

      ctx.font = theme.fonts.value;
      const coinStr = `${p.totalCoins} coins`;
      const coinW = ctx.measureText(coinStr).width;
      ctx.fillText(coinStr, width - margin - coinW, ly);
      ly += 28;

      // HR stats (left, 3 lines) ... Duration + coins/min (right)
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

      // Row 2: Avg HR ... coins/min
      ctx.fillText('Avg:', labelX, ly);
      if (p.avgHr) {
        const v = `${p.avgHr}`;
        ctx.fillText(v, numColRight - ctx.measureText(v).width, ly);
        ctx.fillText('\u2661', heartX, ly);
      }
      const activeMin = p.activeSeconds > 0 ? p.activeSeconds / 60 : 0;
      const cpm = activeMin > 0 ? (p.totalCoins / activeMin).toFixed(1) : '0.0';
      const cpmStr = `\u26C0${cpm}/min`;
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

      // HR Histogram (10 vertical bars grouped by HR zone)
      if (p.hrValues.length > 0) {
        const minHr = Math.min(...p.hrValues);
        const maxHr = Math.max(...p.hrValues);
        const hrRange = maxHr - minHr || 1;
        const bucketSize = hrRange / numBuckets;

        // Count HR values per bucket
        const buckets = new Array(numBuckets).fill(0);
        for (const hr of p.hrValues) {
          const idx = Math.min(numBuckets - 1, Math.floor((hr - minHr) / bucketSize));
          buckets[idx]++;
        }
        const maxCount = Math.max(...buckets, 1);

        // Determine which zone each bucket belongs to using actual data votes
        // (boundary-matching fails because zones overlap — HR 163 can be "cool" during cooldown)
        const d = decoded[p.slug] || { zones: [], hr: [] };
        const bucketZones = [];
        for (let b = 0; b < numBuckets; b++) {
          const bucketMin = minHr + b * bucketSize;
          const bucketMax = minHr + (b + 1) * bucketSize;
          // Count how many ticks at this HR range were classified into each zone
          const votes = {};
          for (let i = 0; i < d.hr.length && i < d.zones.length; i++) {
            const hr = d.hr[i];
            const z = d.zones[i];
            if (hr != null && hr > 0 && z != null) {
              const inBucket = b < numBuckets - 1
                ? (hr >= bucketMin && hr < bucketMax)
                : (hr >= bucketMin && hr <= bucketMax);
              if (inBucket) votes[z] = (votes[z] || 0) + 1;
            }
          }
          // Pick zone with most votes; on tie prefer higher intensity
          let bestZone = 'cool';
          let bestCount = 0;
          for (const zone of zoneOrder) {
            const count = votes[zone] || 0;
            if (count > bestCount || (count === bestCount && count > 0 && zoneIntensity(zone) > zoneIntensity(bestZone))) {
              bestZone = zone;
              bestCount = count;
            }
          }
          bucketZones.push(bestZone);
        }

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
        ctx.font = '11px "Roboto Condensed"';
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

        // Zone group brackets with zone name + coin count
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

            // Zone label + coin count (abbreviate if group is narrow)
            const coins = p.zoneCoins[zone] || 0;
            const fullLabel = coins > 0
              ? `${zoneLabelsMap[zone] || zone} (\u26C0${coins})`
              : `${zoneLabelsMap[zone] || zone}`;
            const shortLabel = coins > 0
              ? `${(zone[0] || '').toUpperCase()} \u26C0${coins}`
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
      const flipped = createNodeCanvas(width, height);
      const fctx = flipped.getContext('2d');
      fctx.translate(width, height);
      fctx.scale(-1, -1);
      fctx.drawImage(canvas, 0, 0);
      return { canvas: flipped, width, height };
    }

    return { canvas, width, height };
  }

  return { createCanvas };
}

// ─── Drawing Utilities ────────────────────────────────────

function drawDivider(ctx, y, width) {
  const offset = 10;
  ctx.fillStyle = '#000000';
  ctx.fillRect(offset, y, width - offset * 2, 2);
}
