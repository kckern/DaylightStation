import { getWidgetRegistry } from '@/screen-framework/widgets/registry.js';
import WeeklyReview from './WeeklyReview.jsx';

const registry = getWidgetRegistry();
registry.register('weekly-review', WeeklyReview);
