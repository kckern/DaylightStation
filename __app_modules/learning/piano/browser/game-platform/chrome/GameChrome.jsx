import './gameChrome.scss';

// The HUD pieces live in the shared gaming kit; piano maps its cabinet tokens
// onto --game-hud-* in gameChrome.scss.
export {
  CountdownOverlay,
  LifeMeter,
  ProgressMeter,
} from '../../../../../../__capabilities/gaming/browser/platform/ui/hud/index.js';
