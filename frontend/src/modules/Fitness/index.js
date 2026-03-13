import { getWidgetRegistry } from '@/screen-framework/widgets/registry.js';

// Auto-register modules into the unified widget registry
import * as FitnessChart from './widgets/FitnessChart/index.jsx';
import * as CameraViewApp from './widgets/CameraViewApp/index.jsx';
import * as JumpingJackGame from './widgets/JumpingJackGame/index.jsx';
import * as ComponentShowcase from './widgets/ComponentShowcase/index.jsx';
import * as PoseDemo from './widgets/PoseDemo/index.jsx';
import * as VibrationApp from './widgets/VibrationApp/index.jsx';
import * as SessionBrowserApp from './widgets/SessionBrowserApp/index.jsx';
import * as FitnessSessionApp from './widgets/FitnessSessionApp/index.jsx';

// Maps new fitness: registry keys to module definitions
const REGISTRY_KEYS = {
  'fitness:chart': FitnessChart,
  'fitness:camera': CameraViewApp,
  'fitness:jumping-jacks': JumpingJackGame,
  'fitness:showcase': ComponentShowcase,
  'fitness:pose-demo': PoseDemo,
  'fitness:vibration': VibrationApp,
  'fitness:session-browser': SessionBrowserApp,
  'fitness:session': FitnessSessionApp,
};

// Maps old manifest IDs to new registry keys
const LEGACY_ID_MAP = {
  'fitness_chart': 'fitness:chart',
  'camera_view': 'fitness:camera',
  'jumping_jack_game': 'fitness:jumping-jacks',
  'component_showcase': 'fitness:showcase',
  'pose_demo': 'fitness:pose-demo',
  'vibration_monitor': 'fitness:vibration',
  'session-browser': 'fitness:session-browser',
  'fitness_session': 'fitness:session',
};

// Register all modules into the unified widget registry
const registry = getWidgetRegistry();
for (const [key, mod] of Object.entries(REGISTRY_KEYS)) {
  registry.register(key, mod.default, mod.manifest);
}

// Dashboard widgets (screen-framework compatible, sibling modules)
import FitnessSessionsWidget from './widgets/FitnessSessionsWidget/index.jsx';
import FitnessWeightWidget from './widgets/FitnessWeightWidget/index.jsx';
import FitnessNutritionWidget from './widgets/FitnessNutritionWidget/index.jsx';
import FitnessUpNextWidget from './widgets/FitnessUpNextWidget/index.jsx';
import FitnessCoachWidget from './widgets/FitnessCoachWidget/index.jsx';
import FitnessSessionDetailWidget from './widgets/FitnessSessionDetailWidget/index.jsx';
import FitnessCalendarWidget from './widgets/FitnessCalendarWidget/index.jsx';

registry.register('fitness:sessions', FitnessSessionsWidget);
registry.register('fitness:weight', FitnessWeightWidget);
registry.register('fitness:nutrition', FitnessNutritionWidget);
registry.register('fitness:upnext', FitnessUpNextWidget);
registry.register('fitness:coach', FitnessCoachWidget);
registry.register('fitness:session-detail', FitnessSessionDetailWidget);
registry.register('fitness:calendar', FitnessCalendarWidget);

// --- Bridge functions for existing consumers ---
// These accept old manifest IDs (e.g. 'fitness_chart') and resolve
// through the unified widget registry via the legacy ID map.

function resolveKey(moduleId) {
  return LEGACY_ID_MAP[moduleId] || moduleId;
}

export const getModule = (moduleId) => registry.get(resolveKey(moduleId));

export const getModuleManifest = (moduleId) => registry.getMeta(resolveKey(moduleId));

export const listModules = () =>
  registry.list('fitness').map((key) => {
    const meta = registry.getMeta(key);
    return { id: meta?.id || key, ...meta };
  });
