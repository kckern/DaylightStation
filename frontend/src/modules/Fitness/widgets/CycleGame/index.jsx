import CycleGameContainer from './CycleGameContainer.jsx';

export default CycleGameContainer;

// Widget registry pattern: default export + manifest, consumed via `import * as X`
// across 14+ widgets in Fitness/index.js - splitting out of scope for a lint pass.
// eslint-disable-next-line react-refresh/only-export-components
export const manifest = {
  id: 'cycle_game',
  name: 'Cycle Game',
  icon: '🚴',
  description: 'Cycling races — solo, ghost, or live.'
};
