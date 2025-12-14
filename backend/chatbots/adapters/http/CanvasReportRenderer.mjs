/**
 * Canvas Report Renderer
 * @module adapters/http/CanvasReportRenderer
 * 
 * Generates PNG images for nutrition reports using node-canvas.
 */

import { createCanvas, registerFont } from 'canvas';
import { IReportRenderer } from '../../nutribot/application/ports/IReportRenderer.mjs';

// Try to register fonts (may not be available in all environments)
try {
  const fontDir = process.env.FONT_DIR || '/Users/kckern/Documents/GitHub/DaylightStation/backend/journalist/fonts';
  registerFont(`${fontDir}/roboto-condensed/RobotoCondensed-Regular.ttf`, { family: 'Roboto Condensed' });
} catch (e) {
  // Fonts not available, will use system defaults
}

/**
 * Canvas-based report renderer
 */
export class CanvasReportRenderer extends IReportRenderer {
  #width;
  #height;
  #padding;
  #colors;

  constructor(options = {}) {
    super();
    this.#width = options.width || 800;
    this.#height = options.height || 600;
    this.#padding = options.padding || 20;
    this.#colors = {
      background: '#1a1a2e',
      text: '#eaeaea',
      textSecondary: '#a0a0a0',
      calories: '#ff6b6b',
      protein: '#4ecdc4',
      carbs: '#ffe66d',
      fat: '#95e1d3',
      progressBg: '#2d2d44',
      green: '#4ade80',
      yellow: '#fbbf24',
      red: '#f87171',
      ...options.colors,
    };
  }

  /**
   * Render daily nutrition report as PNG
   * @param {Object} report
   * @returns {Promise<Buffer>}
   */
  async renderDailyReport(report) {
    const canvas = createCanvas(this.#width, this.#height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = this.#colors.background;
    ctx.fillRect(0, 0, this.#width, this.#height);

    // Header
    this.#drawHeader(ctx, report);

    // Macro progress bars
    this.#drawMacroProgress(ctx, report);

    // Food list (if items provided)
    if (report.items?.length > 0) {
      this.#drawFoodList(ctx, report.items);
    }

    // History chart (if provided)
    if (report.history?.length > 0) {
      this.#drawHistoryChart(ctx, report.history);
    }

    return canvas.toBuffer('image/png');
  }

  /**
   * Render food card for UPC items
   * @param {Object} item
   * @param {string} [imageUrl]
   * @returns {Promise<Buffer>}
   */
  async renderFoodCard(item, imageUrl) {
    const canvas = createCanvas(400, 200);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = this.#colors.background;
    ctx.fillRect(0, 0, 400, 200);

    // Item name
    ctx.fillStyle = this.#colors.text;
    ctx.font = 'bold 18px "Roboto Condensed", sans-serif';
    ctx.fillText(item.name || 'Food Item', 20, 40);

    // Brand
    if (item.brand) {
      ctx.fillStyle = this.#colors.textSecondary;
      ctx.font = '14px "Roboto Condensed", sans-serif';
      ctx.fillText(item.brand, 20, 60);
    }

    // Macros
    const macros = [
      { label: 'Cal', value: item.calories || 0, color: this.#colors.calories },
      { label: 'P', value: `${item.protein || 0}g`, color: this.#colors.protein },
      { label: 'C', value: `${item.carbs || 0}g`, color: this.#colors.carbs },
      { label: 'F', value: `${item.fat || 0}g`, color: this.#colors.fat },
    ];

    let x = 20;
    const y = 120;
    macros.forEach(macro => {
      ctx.fillStyle = macro.color;
      ctx.font = 'bold 24px "Roboto Condensed", sans-serif';
      ctx.fillText(String(macro.value), x, y);
      
      ctx.fillStyle = this.#colors.textSecondary;
      ctx.font = '12px "Roboto Condensed", sans-serif';
      ctx.fillText(macro.label, x, y + 20);
      
      x += 90;
    });

    return canvas.toBuffer('image/png');
  }

  // ==================== Private Drawing Methods ====================

  /**
   * Draw header with date and total calories
   * @private
   */
  #drawHeader(ctx, report) {
    const { date, totals, goals } = report;
    const p = this.#padding;

    // Date
    ctx.fillStyle = this.#colors.text;
    ctx.font = 'bold 24px "Roboto Condensed", sans-serif';
    ctx.fillText(this.#formatDate(date), p, p + 30);

    // Calorie summary
    const calsText = `${totals?.calories || 0} / ${goals?.calories || 2000} cal`;
    ctx.font = '20px "Roboto Condensed", sans-serif';
    ctx.fillStyle = this.#getProgressColor(totals?.calories, goals?.calories);
    ctx.textAlign = 'right';
    ctx.fillText(calsText, this.#width - p, p + 30);
    ctx.textAlign = 'left';
  }

  /**
   * Draw macro progress bars
   * @private
   */
  #drawMacroProgress(ctx, report) {
    const { totals = {}, goals = {} } = report;
    const p = this.#padding;
    const barWidth = this.#width - p * 2;
    const barHeight = 30;
    let y = 80;

    const macros = [
      { label: 'Calories', value: totals.calories || 0, goal: goals.calories || 2000, color: this.#colors.calories },
      { label: 'Protein', value: totals.protein || 0, goal: goals.protein || 150, color: this.#colors.protein, unit: 'g' },
      { label: 'Carbs', value: totals.carbs || 0, goal: goals.carbs || 200, color: this.#colors.carbs, unit: 'g' },
      { label: 'Fat', value: totals.fat || 0, goal: goals.fat || 65, color: this.#colors.fat, unit: 'g' },
    ];

    macros.forEach(macro => {
      // Label
      ctx.fillStyle = this.#colors.text;
      ctx.font = '14px "Roboto Condensed", sans-serif';
      ctx.fillText(macro.label, p, y);

      // Value
      const valueText = `${macro.value}${macro.unit || ''} / ${macro.goal}${macro.unit || ''}`;
      ctx.textAlign = 'right';
      ctx.fillText(valueText, this.#width - p, y);
      ctx.textAlign = 'left';

      y += 5;

      // Background bar
      ctx.fillStyle = this.#colors.progressBg;
      ctx.fillRect(p, y, barWidth, barHeight);

      // Progress bar
      const progress = Math.min(macro.value / macro.goal, 1.5);
      ctx.fillStyle = macro.color;
      ctx.fillRect(p, y, barWidth * Math.min(progress, 1), barHeight);

      // Over-limit indicator
      if (progress > 1) {
        ctx.fillStyle = this.#colors.red;
        ctx.fillRect(p + barWidth - 5, y, 5, barHeight);
      }

      y += barHeight + 20;
    });
  }

  /**
   * Draw food list
   * @private
   */
  #drawFoodList(ctx, items) {
    const p = this.#padding;
    let y = 280;
    const maxItems = 8;

    ctx.fillStyle = this.#colors.textSecondary;
    ctx.font = '12px "Roboto Condensed", sans-serif';
    ctx.fillText('Today\'s Food:', p, y);
    y += 20;

    const displayItems = items.slice(0, maxItems);
    displayItems.forEach(item => {
      ctx.fillStyle = this.#colors.text;
      ctx.font = '14px "Roboto Condensed", sans-serif';
      
      const name = item.name || 'Unknown';
      const cals = item.calories || 0;
      const truncatedName = name.length > 35 ? name.substring(0, 35) + '...' : name;
      
      ctx.fillText(`• ${truncatedName}`, p, y);
      
      ctx.textAlign = 'right';
      ctx.fillStyle = this.#colors.textSecondary;
      ctx.fillText(`${cals} cal`, this.#width - p, y);
      ctx.textAlign = 'left';
      
      y += 22;
    });

    if (items.length > maxItems) {
      ctx.fillStyle = this.#colors.textSecondary;
      ctx.fillText(`... and ${items.length - maxItems} more`, p, y);
    }
  }

  /**
   * Draw history chart
   * @private
   */
  #drawHistoryChart(ctx, history) {
    const p = this.#padding;
    const chartHeight = 100;
    const chartY = this.#height - chartHeight - p;
    const chartWidth = this.#width - p * 2;
    const barWidth = (chartWidth / history.length) - 4;

    // Find max for scaling
    const maxCals = Math.max(...history.map(d => d.calories || 0), 1);

    history.forEach((day, i) => {
      const x = p + i * (barWidth + 4);
      const barHeight = (day.calories / maxCals) * (chartHeight - 20);
      const barY = chartY + chartHeight - barHeight - 15;

      // Bar
      ctx.fillStyle = this.#getProgressColor(day.calories, day.goal || 2000);
      ctx.fillRect(x, barY, barWidth, barHeight);

      // Day label
      ctx.fillStyle = this.#colors.textSecondary;
      ctx.font = '10px "Roboto Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.#formatDayLabel(day.date), x + barWidth / 2, chartY + chartHeight);
      ctx.textAlign = 'left';
    });
  }

  // ==================== Helpers ====================

  /**
   * Format date for display
   * @private
   */
  #formatDate(dateStr) {
    if (!dateStr) return 'Today';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateStr;
    }
  }

  /**
   * Format day label for chart
   * @private
   */
  #formatDayLabel(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { weekday: 'short' }).substring(0, 2);
    } catch {
      return '';
    }
  }

  /**
   * Get color based on progress
   * @private
   */
  #getProgressColor(value, goal) {
    if (!goal || !value) return this.#colors.text;
    const ratio = value / goal;
    if (ratio < 0.8) return this.#colors.green;
    if (ratio < 1.0) return this.#colors.yellow;
    return this.#colors.red;
  }
}

export default CanvasReportRenderer;
