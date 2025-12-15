/**
 * Food Icons List
 * @module nutribot/application/constants/foodIcons
 * 
 * List of available food icons for the nutrition reports.
 * Icons are stored in backend/chatbots/_lib/icons/food/
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to icons/food directory
const ICONS_DIR = join(__dirname, '../../../_lib/icons/food');

/**
 * Load food icons from filesystem
 * @returns {string[]} Array of icon names (without .png extension)
 */
function loadFoodIcons() {
  try {
    const files = readdirSync(ICONS_DIR);
    return files
      .filter(f => f.endsWith('.png'))
      .map(f => f.replace('.png', ''))
      .sort();
  } catch (error) {
    console.warn('Failed to load food icons from directory:', error.message);
    return ['default'];
  }
}

export const FOOD_ICONS = loadFoodIcons();

export const FOOD_ICONS_STRING = FOOD_ICONS.join(' ');

export default FOOD_ICONS;
