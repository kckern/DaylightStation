import EmulatorGameWidget from './EmulatorGameWidget.jsx';

export default EmulatorGameWidget;
// Widget registry pattern: default export + manifest, consumed via `import * as X`
// across 14+ widgets in Fitness/index.js - splitting out of scope for a lint pass.
// eslint-disable-next-line react-refresh/only-export-components
export const manifest = {
  id: 'emulator',
  name: 'Video Games',
  icon: '🎮',
  description: 'Retro consoles — pick a game and play.',
  // The SELECTION screen (console tabs + game grid) renders inside the fitness
  // frame WITH the nav sidebar, like the content menus. Only the running game
  // goes truly fullscreen — the widget portals the console to document.body.
  fullscreen: false,
};
