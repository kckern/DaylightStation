import { getWidgetRegistry } from './registry.js';
import Time from '../../modules/Time/Time.jsx';
import Weather from '../../modules/Weather/Weather.jsx';
import WeatherForecast from '../../modules/Weather/WeatherForecast.jsx';
import Upcoming from '../../modules/Upcoming/Upcoming.jsx';
import { FinanceChart } from '../../modules/Finances/widgets/FinanceChart.jsx';
import Weight from '../../modules/Health/Weight.jsx';
import EntropyPanel from '../../modules/Entropy/EntropyPanel.jsx';
import { PianoVisualizer } from '../../modules/Piano/index.js';
import MenuWidget from './MenuWidget.jsx';
import ArtMode from './ArtMode.jsx';
import WeeklyReview from '../../modules/WeeklyReview/WeeklyReview.jsx';
import CameraOverlay from '../../modules/CameraFeed/CameraOverlay.jsx';
import GameShow from '../../modules/GameShow/GameShow.jsx';
import SchoolApp from '../../modules/School/SchoolApp.jsx';

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
  registry.register('art', ArtMode);
  registry.register('weekly-review', WeeklyReview);
  registry.register('camera', CameraOverlay);
  registry.register('gameshow', GameShow);
  // Mounted as a whole screen, not a panel among others: the Portal IS the
  // school device, the way living-room is the TV. Rendered without `clear`,
  // so its exit affordance is omitted (see SchoolApp.jsx).
  registry.register('school', SchoolApp);
  return registry;
}
