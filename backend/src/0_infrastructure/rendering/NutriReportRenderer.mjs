/**
 * Nutrition Report Renderer
 * @module infrastructure/rendering/NutriReportRenderer
 * 
 * Generates PNG images for nutrition reports using node-canvas.
 * Design modeled after food_report.mjs
 */

import { createCanvas, registerFont, loadImage } from 'canvas';
import path from 'path';
import fs from 'fs';

// Icon path - resolved at runtime from media path
const getIconDir = () => {
  // Try global paths (set by ConfigService), then env vars, then fallback
  const mediaPath = global.__daylightPaths?.media
    || process.env.DAYLIGHT_MEDIA_PATH
    || process.env.MEDIA_PATH
    || './media';
  return path.join(mediaPath, 'img', 'icons', 'food');
};

// Deferred font registration (global paths aren't available at module load time)
let fontsRegistered = false;
let fontRegistrationError = null;
const ensureFontsRegistered = (logger) => {
  if (fontsRegistered) return true;
  const dataPath = global.__daylightPaths?.data
    || process.env.DAYLIGHT_DATA_PATH
    || process.env.DATA_PATH
    || './data';
  const fontDir = path.join(dataPath, 'content', 'fonts');
  const fontPath = path.join(fontDir, 'roboto-condensed', 'RobotoCondensed-Regular.ttf');
  
  if (!fs.existsSync(fontPath)) {
    fontRegistrationError = `Font file not found: ${fontPath}`;
    logger?.warn?.('nutribot.renderer.font_not_found', { error: fontRegistrationError });
    return false;
  }
  
  try {
    registerFont(fontPath, { family: 'Roboto Condensed' });
    fontsRegistered = true;
    logger?.info?.('nutribot.renderer.font_registered', { fontPath });
    return true;
  } catch (e) {
    fontRegistrationError = `Font registration failed: ${e.message}`;
    logger?.warn?.('nutribot.renderer.font_registration_failed', { error: fontRegistrationError });
    return false;
  }
};

// Debug helper to log renderer config
export const getRendererConfig = () => {
  const dataPath = global.__daylightPaths?.data
    || process.env.DAYLIGHT_DATA_PATH
    || process.env.DATA_PATH
    || './data';
  return {
    fontDir: path.join(dataPath, 'content', 'fonts'),
    iconDir: getIconDir(),
    fontsRegistered,
    fontRegistrationError,
  };
};

// Font definitions
const TITLE_FONT = '64px "Roboto Condensed"';
const SUBTITLE_FONT = '36px "Roboto Condensed"';
const PIE_LABEL_FONT = '48px "Roboto Condensed"';
const DEFAULT_FONT = '32px "Roboto Condensed"';
const SMALL_FONT = '20px "Roboto Condensed"';

// Color palette (matching food_report.mjs)
const COLORS = {
  background: '#ffffff',
  text: '#000000',
  protein: '#fe938c',  // Pink/salmon
  carbs: '#a3b18a',    // Sage green
  fat: '#f6bd60',      // Golden yellow
  chartBg: '#FAF3ED',  // Light cream
  barBase: '#CCC',     // Gray base for bars
  gridLine: '#AAA',    // Grid lines
};

/**
 * Canvas-based report renderer
 */
export class NutriReportRenderer {
  #logger;

  constructor(options = {}) {
    this.#logger = options.logger || console;
  }

  /**
   * Get text width
   * @private
   */
  _getTextWidth(ctx, text) {
    return ctx.measureText(text).width;
  }

  /**
   * Get text height
   * @private
   */
  _getTextHeight(ctx, text) {
    const metrics = ctx.measureText(text);
    return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  }

  /**
   * Draw a filled rectangle with optional label
   * @private
   */
  _drawRect(ctx, x, y, w, h, color, label, font, pos, textColor) {
    if (!w || !h) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);

    if (label) {
      ctx.font = font || DEFAULT_FONT;
      ctx.fillStyle = textColor || '#000000';

      const labelWidth = this._getTextWidth(ctx, label);
      const labelHeight = this._getTextHeight(ctx, label);

      let labelX = x + w / 2 - labelWidth / 2;
      let labelY = y + h / 2 + labelHeight / 4;

      if (pos) {
        if (/left/.test(pos)) labelX = x + 4;
        else if (/right/.test(pos)) labelX = x + w - labelWidth - 4;
        if (/top/.test(pos)) labelY = y + labelHeight;
        else if (/bottom/.test(pos)) labelY = y + h - 4;
      }
      ctx.fillText(label, labelX, labelY);
    }
    ctx.restore();
  }

  /**
   * Create a pie chart canvas
   * @private
   */
  _makePieChart(pieChartData, pieChartHeight) {
    const pieChartWidth = pieChartHeight;
    const pieCanvas = createCanvas(pieChartWidth, pieChartHeight);
    const ctx = pieCanvas.getContext('2d');

    const pieChartTotal = pieChartData.reduce((acc, slice) => acc + slice.value, 0);
    if (pieChartTotal === 0) return pieCanvas;

    pieChartData.forEach((slice) => {
      slice.percentage = slice.value / pieChartTotal;
    });

    let startAngle = -Math.PI / 2; // Start from top
    const radius = pieChartWidth / 2 - 10;
    const centerX = pieChartWidth / 2;
    const centerY = pieChartHeight / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const slice of pieChartData) {
      if (slice.percentage === 0) continue;
      
      const endAngle = startAngle + slice.percentage * 2 * Math.PI;

      // Draw the wedge
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();

      // Place label in the middle of the wedge
      const midAngle = startAngle + (endAngle - startAngle) / 2;
      const labelRadius = radius * 0.6;
      const wedgeCenterX = centerX + Math.cos(midAngle) * labelRadius;
      const wedgeCenterY = centerY + Math.sin(midAngle) * labelRadius;

      const label = slice.label || String(slice.value);
      const subLabel = slice.subLabel || '';

      // Draw the main label
      ctx.save();
      ctx.font = PIE_LABEL_FONT;
      ctx.fillStyle = '#000';
      ctx.fillText(label, wedgeCenterX, wedgeCenterY - 12);

      // Draw the sub-label under it
      if (subLabel) {
        ctx.font = SUBTITLE_FONT;
        ctx.fillText(subLabel, wedgeCenterX, wedgeCenterY + 24);
      }
      ctx.restore();

      startAngle = endAngle;
    }
    return pieCanvas;
  }

  /**
   * Create a food list canvas (async for icon loading)
   * @private
   */
  async _makeFoodList(food, width, height) {
    const listCanvas = createCanvas(width, height);
    const ctx = listCanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    if (!food || food.length === 0) return listCanvas;

    // Sort descending by calories
    food = [...food].sort((a, b) => (b.calories || 0) - (a.calories || 0));

    // Group by item name, summing calories and macros
    const grouped = [];
    for (const item of food) {
      const existing = grouped.find((i) => i.name === item.name);
      if (existing) {
        ['calories', 'carbs', 'protein', 'fat', 'grams'].forEach(key => {
          existing[key] = (existing[key] || 0) + (item[key] || 0);
        });
      } else {
        grouped.push({ ...item });
      }
    }
    food = grouped;

    const fontSize = 32;
    ctx.font = fontSize + 'px "Roboto Condensed"';

    const lineHeight = fontSize + 12;
    const iconSize = 32;
    let foodItemCount = food.length;
    let lineSpacing = Math.max(0, (height / Math.min(foodItemCount, 10)) - lineHeight);

    // Limit to what fits
    const maxItems = Math.floor(height / (lineHeight + 4));
    food = food.slice(0, Math.min(maxItems, 10));

    const maxCalories = food.reduce((acc, item) => Math.max(acc, item.calories || 0), 0);
    const calColumnWidth = ctx.measureText(String(Math.round(maxCalories))).width + 20;

    // Preload icons
    const iconCache = new Map();
    const iconDir = getIconDir();
    const iconLoadResults = [];
    for (const foodItem of food) {
      if (foodItem.icon && !iconCache.has(foodItem.icon)) {
        const iconPath = path.join(iconDir, foodItem.icon + '.png');
        try {
          if (fs.existsSync(iconPath)) {
            iconCache.set(foodItem.icon, await loadImage(iconPath));
            iconLoadResults.push({ icon: foodItem.icon, status: 'loaded' });
          } else {
            iconLoadResults.push({ icon: foodItem.icon, status: 'not_found', path: iconPath });
          }
        } catch (e) {
          iconLoadResults.push({ icon: foodItem.icon, status: 'error', error: e.message });
        }
      }
    }
    
    // Log icon loading summary
    const loaded = iconLoadResults.filter(r => r.status === 'loaded').length;
    const notFound = iconLoadResults.filter(r => r.status === 'not_found');
    if (notFound.length > 0) {
      this.#logger.warn?.('nutribot.renderer.icons_not_found', { count: notFound.length, total: iconLoadResults.length });
    } else if (loaded > 0) {
      this.#logger.debug?.('nutribot.renderer.icons_loaded', { count: loaded, iconDir });
    }

    // Draw each food item
    let y = lineHeight;
    for (const foodItem of food) {
      const name = foodItem.name;
      const calories = foodItem.calories;
      const carbs = foodItem.carbs;
      const protein = foodItem.protein;
      const fat = foodItem.fat;
      const icon = foodItem.icon;

      // Draw icon if available
      if (icon && iconCache.has(icon)) {
        const iconImg = iconCache.get(icon);
        ctx.drawImage(iconImg, 4, y - iconSize + 4, iconSize, iconSize);
      }

      // Print calories in left column (right-aligned)
      ctx.font = fontSize + 'px "Roboto Condensed"';
      const calStr = String(Math.round(calories || 0));
      const calStrWidth = this._getTextWidth(ctx, calStr);
      ctx.fillStyle = '#000';
      const calX = iconSize + 10 + calColumnWidth - calStrWidth;
      ctx.fillText(calStr, calX, y);

      // Print item name in Title Case
      const toTitleCase = (str) => str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
      const displayName = toTitleCase((name || 'Unknown').substring(0, 22));
      ctx.fillText(displayName, iconSize + 10 + calColumnWidth + 10, y);

      // Macro boxes on right side
      const rectWidth = 46;
      const rectHeight = 30;
      const macroColors = { protein: COLORS.protein, carbs: COLORS.carbs, fat: COLORS.fat };
      const macros = [
        { key: 'protein', value: protein },
        { key: 'carbs', value: carbs },
        { key: 'fat', value: fat },
      ];

      let macroX = width - 20;
      for (const macro of macros) {
        const val = Math.round(macro.value || 0);
        if (val > 0) {
          macroX -= rectWidth + 4;
          this._drawRect(
            ctx,
            macroX,
            y - rectHeight + 6,
            rectWidth,
            rectHeight,
            macroColors[macro.key],
            String(val),
            '18px "Roboto Condensed"',
            'center',
            '#000'
          );
        }
      }

      y += lineHeight + lineSpacing;
    }

    return listCanvas;
  }

  /**
   * Render daily nutrition report as PNG
   * @param {Object} report
   * @returns {Promise<Buffer>}
   */
  async renderDailyReport(report) {
    // Log current path configuration
    const config = getRendererConfig();
    this.#logger.debug?.('nutribot.renderer.start', {
      fontDir: config.fontDir,
      iconDir: config.iconDir
    });
    
    // Ensure fonts are registered before rendering
    const fontResult = ensureFontsRegistered(this.#logger);
    if (!fontResult) {
      this.#logger.warn?.('nutribot.renderer.font_registration_failed');
    }
    
    const date = report.date;
    const totals = report.totals || {};
    const goals = report.goals || {};
    const items = report.items || [];
    const history = report.history || [];

    // Canvas dimensions matching food_report.mjs
    const width = 1080;
    const newCanvasHeight = 1400;
    const topPageMargin = 100;
    const contentEffectiveHeight = newCanvasHeight - 2 * topPageMargin;

    const mainCanvas = createCanvas(width, newCanvasHeight);
    const ctx = mainCanvas.getContext('2d');

    // White background
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, newCanvasHeight);

    // Calculate macro grams from items or use totals
    let proteinGrams = 0;
    let carbsGrams = 0;
    let fatGrams = 0;
    
    for (const item of items) {
      proteinGrams += item.protein || 0;
      carbsGrams += item.carbs || 0;
      fatGrams += item.fat || 0;
    }

    // Use provided totals if available
    if (totals.protein) proteinGrams = totals.protein;
    if (totals.carbs) carbsGrams = totals.carbs;
    if (totals.fat) fatGrams = totals.fat;

    const foodListWidth = width * 0.6;
    const leftSideWidth = width - foodListWidth;
    const pieChartWidth = leftSideWidth * 0.85;
    const midPoint = leftSideWidth / 2;

    // === TITLE ===
    let totalCals = totals.calories || 0;
    if (!totalCals) {
      for (const item of items) {
        totalCals += item.calories || 0;
      }
    }
    totalCals = Math.round(totalCals);
    
    const dateFormatted = this._formatDate(date);
    const title = dateFormatted ;

    ctx.font = TITLE_FONT;
    ctx.fillStyle = COLORS.text;
    const titleWidth = this._getTextWidth(ctx, title);
    ctx.fillText(title, width / 2 - titleWidth / 2, topPageMargin);

    // === PIE CHART ===
    const pieData = [
      {
        color: COLORS.fat,
        value: Math.round(fatGrams * 9),
        subLabel: 'Fat',
        label: Math.round(fatGrams) + 'g',
      },
      {
        color: COLORS.carbs,
        value: Math.round(carbsGrams * 4),
        subLabel: 'Carbs',
        label: Math.round(carbsGrams) + 'g',
      },
      {
        color: COLORS.protein,
        value: Math.round(proteinGrams * 4),
        subLabel: 'Protein',
        label: Math.round(proteinGrams) + 'g',
      },
    ].sort((a, b) => b.value - a.value);

    const pieCanvas = this._makePieChart(pieData, pieChartWidth);
    const chartX = (leftSideWidth - pieChartWidth) / 2;
    ctx.drawImage(pieCanvas, chartX, topPageMargin + 40);

    // === FOOD LIST ===
    if (items.length > 0) {
      const foodListHeight = contentEffectiveHeight / 2 - 50;
      const foodListCanvas = await this._makeFoodList(items, foodListWidth - 20, foodListHeight);
      ctx.drawImage(foodListCanvas, leftSideWidth + 10, topPageMargin + 40);
    }

    // === MICRO STATS ===
    let sodiumTotal = 0;
    let fiberTotal = 0;
    let sugarTotal = 0;
    let cholesterolTotal = 0;
    
    for (const item of items) {
      sodiumTotal += item.sodium || 0;
      fiberTotal += item.fiber || 0;
      sugarTotal += item.sugar || 0;
      cholesterolTotal += item.cholesterol || 0;
    }
    
    const stats = [
      { label: 'Sodium', unit: 'mg', icon: 'salt', value: Math.round(sodiumTotal) },
      { label: 'Fiber', unit: 'g', icon: 'kale', value: Math.round(fiberTotal) },
      { label: 'Sugar', unit: 'g', icon: 'white_sugar', value: Math.round(sugarTotal) },
      { label: 'Cholesterol', unit: 'mg', icon: 'butter', value: Math.round(cholesterolTotal) },
    ];

    ctx.font = SUBTITLE_FONT;
    const statsY = topPageMargin + 40 + pieChartWidth + 30;
    for (let i = 0; i < stats.length; i++) {
      const stat = stats[i];
      const rowY = statsY + i * 45;

      const amount = stat.value + stat.unit;
      const labelW = this._getTextWidth(ctx, stat.label);

      // Label on left, value on right of midpoint
      ctx.fillStyle = COLORS.text;
      ctx.fillText(stat.label, midPoint - labelW - 24, rowY);
      ctx.fillText(amount, midPoint + 24, rowY);

      // Draw icon in center
      try {
        const iconPath = path.join(getIconDir(), stat.icon + '.png');
        if (fs.existsSync(iconPath)) {
          const iconImg = await loadImage(iconPath);
          ctx.drawImage(iconImg, midPoint - 12, rowY - 24, 24, 24);
        }
      } catch (e) {
        // Icon not found
      }
    }

    const goalCalories = goals.calories || 2000;
    const minRecommended = 1200; // dotted line

    // === CALORIE PROGRESS BAR (now above bar chart) ===
    const progressBarWidth = width * 0.9;
    const progressBarHeight = 48;
    const progressBarX = (width - progressBarWidth) / 2;
    const progressBarY = statsY + 200; // below micronutrients, above bar chart
    const overGoalColor = '#b00020';
    const underGoalColor = '#7da87a';
    const cautionColor = '#f6bd60';

    // Determine max scale: cap at current if over goal so bar fills horizontally
    const progressMax = Math.max(goalCalories, minRecommended, totalCals);

    // Background
    this._drawRect(ctx, progressBarX, progressBarY, progressBarWidth, progressBarHeight, COLORS.chartBg);

    // Filled portion with color states: green <=1200, yellow between 1200 and goal, red beyond goal
    const clampedCurrent = Math.min(totalCals, progressMax);
    const goalPortion = Math.min(goalCalories, clampedCurrent);
    const goalWidth = (goalPortion / progressMax) * progressBarWidth;
    const baseColor = totalCals > minRecommended ? cautionColor : underGoalColor;
    if (goalWidth > 0) {
      this._drawRect(ctx, progressBarX, progressBarY, goalWidth, progressBarHeight, baseColor);
    }

    if (totalCals > goalCalories) {
      const overWidth = ((totalCals - goalCalories) / progressMax) * progressBarWidth;
      this._drawRect(ctx, progressBarX + goalWidth, progressBarY, overWidth, progressBarHeight, overGoalColor);
    }

    // Tick at 1200
    const tick1200X = progressBarX + (minRecommended / progressMax) * progressBarWidth;
    ctx.save();
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tick1200X, progressBarY);
    ctx.lineTo(tick1200X, progressBarY + progressBarHeight);
    ctx.stroke();
    ctx.font = SMALL_FONT;
    ctx.fillStyle = COLORS.text;
    const tick1200Label = '1200';
    ctx.fillText(tick1200Label, tick1200X - this._getTextWidth(ctx, tick1200Label) / 2, progressBarY - 6);
    ctx.restore();

    // Goal marker
    const goalX = progressBarX + (goalCalories / progressMax) * progressBarWidth;
    ctx.save();
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(goalX, progressBarY - 4);
    ctx.lineTo(goalX, progressBarY + progressBarHeight + 4);
    ctx.stroke();
    ctx.font = SMALL_FONT;
    const goalLabel = `${goalCalories} goal`;
    ctx.fillText(goalLabel, goalX - this._getTextWidth(ctx, goalLabel) / 2, progressBarY + progressBarHeight + 26);
    ctx.restore();

    // Labels and percentages
    ctx.font = SUBTITLE_FONT;
    ctx.fillStyle = COLORS.text;
    const pctOfGoal = goalCalories ? Math.round((totalCals / goalCalories) * 100) : 0;
    const progressLabel = `${totalCals} cal (${pctOfGoal}% of goal)`;
    const progressLabelW = this._getTextWidth(ctx, progressLabel);
    ctx.fillText(progressLabel, width / 2 - progressLabelW / 2, progressBarY - 18);

    // === 7-DAY BAR CHART (moved below progress bar) ===
    const barChartWidth = width * 0.9;
    const barChartHeight = 460; // slightly shorter to leave bottom margin
    const barChartX = (width - barChartWidth) / 2;
    const barChartY = progressBarY + progressBarHeight + 80; // give gap below progress bar
    
    // Calculate max from all data (history + today) so no bars get cut off
    let historyMax = 0;
    if (history && history.length > 0) {
      for (const day of history) {
        if (day.calories > historyMax) historyMax = day.calories;
      }
    }
    const barMaxVal = Math.max(goalCalories, minRecommended, totalCals, historyMax, 2000) * 1.1; // 10% headroom

    this._drawDailyChart(ctx, history, items, barChartWidth, barChartHeight, barChartX, barChartY, goalCalories, minRecommended, barMaxVal, date);

    // Scale up 1.2x like food_report.mjs
    const scaledWidth = Math.round(width * 1.2);
    const scaledHeight = Math.round(newCanvasHeight * 1.2);
    const scaledCanvas = createCanvas(scaledWidth, scaledHeight);
    const scaledCtx = scaledCanvas.getContext('2d');
    scaledCtx.drawImage(mainCanvas, 0, 0, scaledWidth, scaledHeight);

    this.#logger.info?.('nutribot.renderer.complete', { width: scaledWidth, height: scaledHeight, itemCount: items.length });

    return scaledCanvas.toBuffer('image/png');
  }

  /**
   * Render daily nutrition report as PNG and save to temp file
   * @param {Object} report
   * @returns {Promise<string>} Path to temp PNG file
   */
  async renderDailyReportToFile(report) {
    const buffer = await this.renderDailyReport(report);

    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const tmpDir = path.default.join(os.default.tmpdir(), 'nutribot-reports');
    await fs.default.mkdir(tmpDir, { recursive: true });
    const pngPath = path.default.join(tmpDir, `report-${report.date}-${Date.now()}.png`);
    await fs.default.writeFile(pngPath, buffer);

    this.#logger.debug?.('nutribot.renderer.file_saved', { path: pngPath });
    return pngPath;
  }

  /**
   * Draw daily stacked bar chart
   * @private
   */
  _drawDailyChart(ctx, history, todayItems, barChartWidth, barChartHeight, barChartX, barChartY, goalCalories, minRecommended, barMaxVal, todayDate) {
    // Background
    this._drawRect(ctx, barChartX, barChartY, barChartWidth, barChartHeight, COLORS.chartBg);

    // Dotted minimum recommended line
    const minY = barChartY + barChartHeight - (minRecommended / barMaxVal) * barChartHeight;
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(barChartX, minY);
    ctx.lineTo(barChartX + barChartWidth, minY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Solid user goal line
    const goalY = barChartY + barChartHeight - (goalCalories / barMaxVal) * barChartHeight;
    ctx.beginPath();
    ctx.moveTo(barChartX, goalY);
    ctx.lineTo(barChartX + barChartWidth, goalY);
    ctx.stroke();

    const barCount = 7;
    const barAreaWidth = barChartWidth / barCount;
    const barWidth = barAreaWidth * 0.7;

    // Build 7-day data
    const days = [];
    // Parse todayDate without timezone issues (YYYY-MM-DD string)
    let baseDate;
    if (todayDate && /^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
      const [year, month, day] = todayDate.split('-').map(Number);
      baseDate = new Date(year, month - 1, day);
    } else {
      baseDate = new Date();
    }
    
    for (let i = barCount - 1; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() - i);
      // Format as YYYY-MM-DD using local date components
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      // Check history first
      let historyDay = null;
      if (history) {
        for (const h of history) {
          if (h.date === dateStr) {
            historyDay = h;
            break;
          }
        }
      }
      
      if (historyDay) {
        days.push({ calories: historyDay.calories, protein: historyDay.protein, carbs: historyDay.carbs, fat: historyDay.fat, date: dateStr });
      } else if (i === 0 && todayItems && todayItems.length > 0) {
        // Today's data from items
        let todayCals = 0;
        let todayProtein = 0;
        let todayCarbs = 0;
        let todayFat = 0;
        for (const item of todayItems) {
          todayCals += item.calories || 0;
          todayProtein += item.protein || 0;
          todayCarbs += item.carbs || 0;
          todayFat += item.fat || 0;
        }
        days.push({ calories: todayCals, protein: todayProtein, carbs: todayCarbs, fat: todayFat, date: dateStr });
      } else {
        days.push({ calories: 0, protein: 0, carbs: 0, fat: 0, date: dateStr });
      }
    }

    // Draw each bar
    for (let index = 0; index < days.length; index++) {
      const dayData = days[index];
      const barX = barChartX + index * barAreaWidth + (barAreaWidth - barWidth) / 2;
      const barBottom = barChartY + barChartHeight;

      // Day label
      const dayLabel = this._getDayLabel(dayData.date);
      ctx.save();
      ctx.font = SUBTITLE_FONT;
      ctx.fillStyle = COLORS.text;
      const dayLabelWidth = this._getTextWidth(ctx, dayLabel);
      ctx.fillText(dayLabel, barX + barWidth / 2 - dayLabelWidth / 2, barBottom + 35);
      ctx.restore();

      if (!dayData.calories) continue;

      const barH = Math.min((dayData.calories / barMaxVal) * barChartHeight, barChartHeight);

      // Calories label at top
      ctx.save();
      ctx.font = SUBTITLE_FONT;
      const calsLabel = String(Math.round(dayData.calories));
      const labelWidth = this._getTextWidth(ctx, calsLabel);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(calsLabel, barX + barWidth / 2 - labelWidth / 2, barBottom - barH - 10);
      ctx.restore();

      // Calculate macro ratios
      const totalMacroCals = (dayData.carbs || 0) * 4 + (dayData.protein || 0) * 4 + (dayData.fat || 0) * 9;
      const carbsRatio = totalMacroCals ? ((dayData.carbs || 0) * 4) / totalMacroCals : 0.33;
      const proteinRatio = totalMacroCals ? ((dayData.protein || 0) * 4) / totalMacroCals : 0.33;
      const fatRatio = totalMacroCals ? ((dayData.fat || 0) * 9) / totalMacroCals : 0.34;

      // Draw stacked bar segments (bottom to top: protein, carbs, fat)
      let currentY = barBottom;

      // Protein (bottom)
      const proteinH = barH * proteinRatio;
      if (proteinH > 0) {
        const proteinLabel = proteinH > 25 ? String(Math.round(dayData.protein || 0)) : '';
        this._drawRect(ctx, barX, currentY - proteinH, barWidth, proteinH, COLORS.protein,
          proteinLabel, SMALL_FONT, 'center', '#000');
        currentY -= proteinH;
      }

      // Carbs (middle)
      const carbsH = barH * carbsRatio;
      if (carbsH > 0) {
        const carbsLabel = carbsH > 25 ? String(Math.round(dayData.carbs || 0)) : '';
        this._drawRect(ctx, barX, currentY - carbsH, barWidth, carbsH, COLORS.carbs,
          carbsLabel, SMALL_FONT, 'center', '#000');
        currentY -= carbsH;
      }

      // Fat (top)
      const fatH = barH * fatRatio;
      if (fatH > 0) {
        const fatLabel = fatH > 25 ? String(Math.round(dayData.fat || 0)) : '';
        this._drawRect(ctx, barX, currentY - fatH, barWidth, fatH, COLORS.fat,
          fatLabel, SMALL_FONT, 'center', '#000');
      }
    }
  }

  /**
   * Render food card for UPC items
   * @param {Object} item
   * @param {string} [imageUrl]
   * @returns {Promise<Buffer>}
   */
  async renderFoodCard(item, imageUrl) {
    // Ensure fonts are registered before rendering
    ensureFontsRegistered(this.#logger);
    
    const canvas = createCanvas(400, 200);
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, 400, 200);

    // Item name
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 24px "Roboto Condensed"';
    ctx.fillText(item.name || 'Food Item', 20, 40);

    // Brand
    if (item.brand) {
      ctx.fillStyle = '#666';
      ctx.font = '16px "Roboto Condensed"';
      ctx.fillText(item.brand, 20, 65);
    }

    // Macros
    const macros = [
      { label: 'Cal', value: item.calories || 0, color: COLORS.text },
      { label: 'Protein', value: (item.protein || 0) + 'g', color: COLORS.protein },
      { label: 'Carbs', value: (item.carbs || 0) + 'g', color: COLORS.carbs },
      { label: 'Fat', value: (item.fat || 0) + 'g', color: COLORS.fat },
    ];

    let x = 20;
    const y = 130;
    for (const macro of macros) {
      ctx.fillStyle = macro.color;
      ctx.font = 'bold 28px "Roboto Condensed"';
      ctx.fillText(String(macro.value), x, y);

      ctx.fillStyle = '#666';
      ctx.font = '14px "Roboto Condensed"';
      ctx.fillText(macro.label, x, y + 25);

      x += 95;
    }

    return canvas.toBuffer('image/png');
  }

  // ==================== Helpers ====================

  /**
   * Format date for display
   * @private
   */
  _formatDate(dateStr) {
    if (!dateStr) {
      const now = new Date();
      return now.toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
    try {
      // Parse YYYY-MM-DD without timezone conversion issues
      // new Date('2025-12-16') parses as UTC midnight, which shifts the day in local time
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day); // Local date
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch (e) {
      return dateStr;
    }
  }

  /**
   * Get day label (Mon, Tue, etc.)
   * @private
   */
  _getDayLabel(dateStr) {
    try {
      // Parse YYYY-MM-DD without timezone conversion issues
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day); // Local date
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } catch (e) {
      return '';
    }
  }
}

export default NutriReportRenderer;
