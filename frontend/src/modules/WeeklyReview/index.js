import { getWidgetRegistry } from "../../../../capabilities/screen-host/browser/public.mjs";
import WeeklyReview from './WeeklyReview.jsx';

const registry = getWidgetRegistry();
registry.register('weekly-review', WeeklyReview);
