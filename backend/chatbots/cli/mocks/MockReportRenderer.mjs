/**
 * Mock Report Renderer
 * @module cli/mocks/MockReportRenderer
 * 
 * Provides report rendering for CLI testing - generates placeholder images
 * or text-based reports instead of actual image rendering.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

/**
 * Mock Report Renderer
 */
export class MockReportRenderer {
  #logger;
  #textMode;

  /**
   * @param {Object} [options]
   * @param {boolean} [options.textMode=true] - Return text instead of images
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    this.#textMode = options.textMode !== false;
    this.#logger = options.logger || createLogger({ source: 'cli:report', app: 'cli' });
  }

  /**
   * Render daily nutrition report
   * @param {Object} report - Report data
   * @returns {Promise<Buffer|string>} PNG buffer or text report
   */
  async renderDailyReport(report) {
    this.#logger.debug('renderDailyReport', { 
      date: report.date,
      itemCount: report.items?.length 
    });

    if (this.#textMode) {
      return this.#renderTextReport(report);
    }

    // Return a placeholder 1x1 PNG for image mode
    return this.#createPlaceholderPNG();
  }

  /**
   * Render food card for UPC items
   * @param {Object} item - Food item
   * @param {string} [imageUrl] - Optional product image URL
   * @returns {Promise<Buffer|string>}
   */
  async renderFoodCard(item, imageUrl) {
    this.#logger.debug('renderFoodCard', { 
      name: item.name,
      hasImage: !!imageUrl 
    });

    if (this.#textMode) {
      return this.#renderTextFoodCard(item);
    }

    return this.#createPlaceholderPNG();
  }

  // ==================== Private Helpers ====================

  /**
   * Render text-based report
   * @private
   */
  #renderTextReport(report) {
    const { date, totals = {}, goals = {}, items = [] } = report;

    let output = [];
    
    output.push('═'.repeat(50));
    output.push(`  📊 DAILY NUTRITION REPORT - ${date || 'Today'}`);
    output.push('═'.repeat(50));
    output.push('');
    
    // Totals vs Goals
    output.push('  MACROS');
    output.push('  ' + '─'.repeat(46));
    
    const formatMacro = (label, value, goal, unit = '') => {
      const pct = goal > 0 ? Math.round((value / goal) * 100) : 0;
      const bar = this.#progressBar(pct);
      return `  ${label.padEnd(10)} ${String(value).padStart(5)}${unit} / ${String(goal).padStart(5)}${unit}  ${bar}`;
    };

    output.push(formatMacro('Calories', totals.calories || 0, goals.calories || 2000, ''));
    output.push(formatMacro('Protein', totals.protein || 0, goals.protein || 150, 'g'));
    output.push(formatMacro('Carbs', totals.carbs || 0, goals.carbs || 200, 'g'));
    output.push(formatMacro('Fat', totals.fat || 0, goals.fat || 65, 'g'));
    output.push('');

    // Food items
    if (items.length > 0) {
      output.push('  FOOD LOG');
      output.push('  ' + '─'.repeat(46));
      
      for (const item of items) {
        const color = item.color || 'yellow';
        const emoji = { green: '🟢', yellow: '🟡', orange: '🟠' }[color] || '⚪';
        const name = (item.name || 'Unknown').substring(0, 25).padEnd(25);
        const cals = String(item.calories || 0).padStart(4);
        output.push(`  ${emoji} ${name} ${cals} cal`);
      }
      output.push('');
    }

    output.push('═'.repeat(50));
    
    return output.join('\n');
  }

  /**
   * Render text-based food card
   * @private
   */
  #renderTextFoodCard(item) {
    let output = [];
    
    output.push('┌' + '─'.repeat(40) + '┐');
    output.push('│' + this.#centerText(item.name || 'Unknown Food', 40) + '│');
    output.push('├' + '─'.repeat(40) + '┤');
    
    if (item.brand) {
      output.push('│' + `  Brand: ${item.brand}`.padEnd(40) + '│');
    }
    
    output.push('│' + `  Calories: ${item.calories || 0}`.padEnd(40) + '│');
    output.push('│' + `  Protein:  ${item.protein || 0}g`.padEnd(40) + '│');
    output.push('│' + `  Carbs:    ${item.carbs || 0}g`.padEnd(40) + '│');
    output.push('│' + `  Fat:      ${item.fat || 0}g`.padEnd(40) + '│');
    
    if (item.servings && item.servings.length > 0) {
      output.push('├' + '─'.repeat(40) + '┤');
      output.push('│' + '  Servings:'.padEnd(40) + '│');
      for (const serving of item.servings.slice(0, 3)) {
        const text = `    • ${serving.name}`;
        output.push('│' + text.substring(0, 40).padEnd(40) + '│');
      }
    }
    
    output.push('└' + '─'.repeat(40) + '┘');
    
    return output.join('\n');
  }

  /**
   * Create a simple progress bar
   * @private
   */
  #progressBar(percent, width = 10) {
    const clamped = Math.min(100, Math.max(0, percent));
    const filled = Math.round((clamped / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${clamped}%`;
  }

  /**
   * Center text within a width
   * @private
   */
  #centerText(text, width) {
    const truncated = text.substring(0, width - 2);
    const padding = Math.max(0, Math.floor((width - truncated.length) / 2));
    return ' '.repeat(padding) + truncated + ' '.repeat(width - padding - truncated.length);
  }

  /**
   * Create a placeholder PNG (1x1 transparent)
   * @private
   */
  #createPlaceholderPNG() {
    // Minimal valid PNG (1x1 transparent pixel)
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, // IHDR length
      0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, // width = 1
      0x00, 0x00, 0x00, 0x01, // height = 1
      0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, etc.
      0x1F, 0x15, 0xC4, 0x89, // CRC
      0x00, 0x00, 0x00, 0x0A, // IDAT length
      0x49, 0x44, 0x41, 0x54, // IDAT
      0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, // compressed data
      0x0D, 0x0A, 0x2D, 0xB4, // CRC
      0x00, 0x00, 0x00, 0x00, // IEND length
      0x49, 0x45, 0x4E, 0x44, // IEND
      0xAE, 0x42, 0x60, 0x82, // CRC
    ]);
    return pngHeader;
  }
}

export default MockReportRenderer;
