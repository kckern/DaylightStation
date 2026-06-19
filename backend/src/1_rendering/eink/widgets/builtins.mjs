/**
 * Register built-in eink widgets
 * @module 1_rendering/eink/widgets/builtins
 *
 * Canned renderables addressable by name from a panel's YAML layout. Real
 * data widgets (header, weather) and skeleton stubs (date, calendar, schedule,
 * todos) live side by side — stubs draw sample content until a data source is
 * wired, so a layout can be designed before the feeds exist.
 */

import { register } from './registry.mjs';
import { draw as drawHeader } from './HeaderWidget.mjs';
import { draw as drawWeather } from './WeatherWidget.mjs';
import { draw as drawPlaceholder } from './PlaceholderWidget.mjs';
import { draw as drawDate } from './DateWidget.mjs';
import { draw as drawCalendar } from './CalendarWidget.mjs';
import { draw as drawSchedule } from './ScheduleWidget.mjs';
import { draw as drawTodos } from './TodosWidget.mjs';
import { draw as drawPhoto } from './PhotoWidget.mjs';

export function registerBuiltins() {
  register('header', drawHeader);
  register('weather', drawWeather);
  register('placeholder', drawPlaceholder);
  register('date', drawDate);
  register('calendar', drawCalendar);
  register('schedule', drawSchedule);
  register('todos', drawTodos);
  register('photo', drawPhoto);
}
