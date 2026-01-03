/**
 * Food Icons List
 * @module nutribot/application/constants/foodIcons
 * 
 * List of available food icons for the nutrition reports.
 * Icons are stored in media/img/icons/food/
 */

import { join } from 'path';
import { readdirSync } from 'fs';

// Path to icons/food directory - resolved at runtime
const getIconsDir = () => {
  const icons = process.env.path?.icons || process.env.ICON_DIR || './media/img/icons';
  return join(icons, 'food');
};

/**
 * Load food icons from filesystem
 * @returns {string[]} Array of icon names (without .png extension)
 */
function loadFoodIcons() {
  try {
    const files = readdirSync(getIconsDir());
    return files
      .filter(f => f.endsWith('.png'))
      .map(f => f.replace('.png', ''))
      .sort();
  } catch (error) {
    logger.warn('nutribot.icons.load_failed', { error: error.message });
    return ['default'];
  }
}

export const FOOD_ICONS = loadFoodIcons();

export const FOOD_ICONS_STRING = FOOD_ICONS.join(' ');

export default FOOD_ICONS;
