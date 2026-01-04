export * from './registry.js';
import { registerPlugin } from './registry.js';

// Auto-register plugins
import * as FitnessChartApp from './plugins/FitnessChartApp/index.jsx';
import * as CameraViewApp from './plugins/CameraViewApp/index.jsx';
import * as JumpingJackGame from './plugins/JumpingJackGame/index.jsx';
import * as ComponentShowcase from './plugins/ComponentShowcase/index.jsx';
import * as HomeApp from './plugins/HomeApp/index.jsx';
import * as PoseDemo from './plugins/PoseDemo/index.jsx';
import * as VibrationApp from './plugins/VibrationApp/index.jsx';
import * as SessionBrowserApp from './plugins/SessionBrowserApp/index.jsx';
import * as FitnessSessionApp from './plugins/FitnessSessionApp/index.jsx';

registerPlugin(FitnessChartApp);
registerPlugin(CameraViewApp);
registerPlugin(JumpingJackGame);
registerPlugin(ComponentShowcase);
registerPlugin(HomeApp);
registerPlugin(PoseDemo);
registerPlugin(VibrationApp);
registerPlugin(SessionBrowserApp);
registerPlugin(FitnessSessionApp);
