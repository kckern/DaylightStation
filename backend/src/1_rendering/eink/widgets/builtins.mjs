/**
 * Register built-in eink widgets
 * @module 1_rendering/eink/widgets/builtins
 */

import { register } from './registry.mjs';
import { draw as drawHeader } from './HeaderWidget.mjs';
import { draw as drawWeather } from './WeatherWidget.mjs';
import { draw as drawPlaceholder } from './PlaceholderWidget.mjs';

export function registerBuiltins() {
  register('header', drawHeader);
  register('weather', drawWeather);
  register('placeholder', drawPlaceholder);
}
