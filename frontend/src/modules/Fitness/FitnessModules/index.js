export * from './registry.js';
import { registerModule } from './registry.js';

// Auto-register modules
import * as FitnessChartApp from './modules/FitnessChartApp/index.jsx';
import * as CameraViewApp from './modules/CameraViewApp/index.jsx';
import * as JumpingJackGame from './modules/JumpingJackGame/index.jsx';
import * as ComponentShowcase from './modules/ComponentShowcase/index.jsx';
import * as HomeApp from './modules/HomeApp/index.jsx';
import * as PoseDemo from './modules/PoseDemo/index.jsx';
import * as VibrationApp from './modules/VibrationApp/index.jsx';
import * as SessionBrowserApp from './modules/SessionBrowserApp/index.jsx';
import * as FitnessSessionApp from './modules/FitnessSessionApp/index.jsx';

registerModule(FitnessChartApp);
registerModule(CameraViewApp);
registerModule(JumpingJackGame);
registerModule(ComponentShowcase);
registerModule(HomeApp);
registerModule(PoseDemo);
registerModule(VibrationApp);
registerModule(SessionBrowserApp);
registerModule(FitnessSessionApp);
