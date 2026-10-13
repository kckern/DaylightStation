import { getWidgetRegistry } from "../../../../../__capabilities/screen-host/browser/public.mjs";
import Time from '../../../modules/Time/Time.jsx';
import Weather from '../../../modules/Weather/Weather.jsx';
import WeatherForecast from '../../../modules/Weather/WeatherForecast.jsx';
import Upcoming from "../../../../../__app_modules/home/browser/upcoming.mjs";
import { FinanceChart } from "../../../../../__app_modules/finance/browser/widget.mjs";
import Weight from "../../../../../__app_modules/health/browser/weight-widget.mjs";
import EntropyPanel from "../../../../../__app_modules/home/browser/entropy/EntropyPanel.jsx";
import { PianoVisualizer } from "../../../../../__app_modules/piano/browser/widget.mjs";
import MenuWidget from './MenuWidget.jsx';
import ArtMode from './ArtMode.jsx';
import WeeklyReview from "../../../../../__app_modules/weekly-review/browser/widget.mjs";
import CameraOverlay from "../../../../../__app_modules/camera/browser/overlay.mjs";
import PartyGamesApp from "../../../../../__app_modules/party-games/browser/widget.mjs";
import SchoolApp from "../../../../../__app_modules/school/browser/kiosk.mjs";
import ReadingSessionScreen from "../../../../../__app_modules/school/browser/reading.mjs";
import MediaLessonScreen from "../../../../../__app_modules/school/browser/lesson.mjs";

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
  registry.register('party-games', PartyGamesApp);
  // Mounted as a whole screen, not a panel among others: the Portal IS the
  // school device, the way living-room is the TV. Rendered without `clear`,
  // so its exit affordance is omitted (see SchoolApp.jsx).
  registry.register('school', SchoolApp);
  // The living-room reading session. A PANEL, not a whole screen: it renders
  // nothing at all unless a child has tapped their card at that room's reader,
  // so the screen's own menu and screensaver are untouched by its presence.
  registry.register('school-reading', ReadingSessionScreen);
  // The living-room hard-gated media lesson. Same shape as school-reading — a
  // PANEL that renders nothing until a lesson is dispatched to this room — but
  // it also mounts the Player, the surround frame and the checkpoint gate into
  // the overlay slot once one is.
  registry.register('school-lesson', MediaLessonScreen);
  return registry;
}
