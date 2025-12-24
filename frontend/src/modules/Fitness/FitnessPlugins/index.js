export * from './registry.js';
import { registerPlugin } from './registry.js';

// Auto-register plugins
import * as FitnessChartApp from './plugins/FitnessChartApp/index.jsx';
import * as CameraViewApp from './plugins/CameraViewApp/index.jsx';
import * as JumpingJackGame from './plugins/JumpingJackGame/index.jsx';

registerPlugin(FitnessChartApp);
registerPlugin(CameraViewApp);
registerPlugin(JumpingJackGame);


