import { getWidgetRegistry } from './registry.js';
import Time from '../../modules/Time/Time.jsx';
import Weather from '../../modules/Weather/Weather.jsx';
import WeatherForecast from '../../modules/Weather/WeatherForecast.jsx';
import Upcoming from '../../modules/Upcoming/Upcoming.jsx';
import { FinanceChart } from '../../modules/Finance/Finance.jsx';
import Weight from '../../modules/Health/Weight.jsx';
import EntropyPanel from '../../modules/Entropy/EntropyPanel.jsx';
import { PianoVisualizer } from '../../modules/Piano/index.js';
import MenuWidget from './MenuWidget.jsx';

export function registerBuiltinWidgets() {
  const registry = getWidgetRegistry();
  registry.register('clock', Time);
  registry.register('weather', Weather);
  registry.register('weather-forecast', WeatherForecast);
  registry.register('calendar', Upcoming);
  registry.register('finance', FinanceChart);
  registry.register('health', Weight);
  registry.register('entropy', EntropyPanel);
  registry.register('piano', PianoVisualizer);
  registry.register('menu', MenuWidget);
  return registry;
}
