import EmulatorGameWidget from './EmulatorGameWidget.jsx';

export default EmulatorGameWidget;
export const manifest = {
  id: 'emulator',
  name: 'Game Boy',
  icon: '🎮',
  description: 'Retro games — keep moving to keep playing.',
  // Fill the whole app surface: the bezel/console wants the full screen, so the
  // host hides the left nav rail while this module is active.
  fullscreen: true,
};
