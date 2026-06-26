import EmulatorGameWidget from './EmulatorGameWidget.jsx';

export default EmulatorGameWidget;
export const manifest = {
  id: 'emulator',
  name: 'Video Games',
  icon: '🎮',
  description: 'Retro consoles — pick a game and play.',
  // Renders as a full app-viewport overlay (like the player), not inside the frame.
  fullscreen: true,
};
