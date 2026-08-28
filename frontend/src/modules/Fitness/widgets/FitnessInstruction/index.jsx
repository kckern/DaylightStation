import FitnessInstructionContainer from './FitnessInstructionContainer.jsx';

export default FitnessInstructionContainer;

// Widget registry pattern: default export + manifest, consumed via `import * as X`
// across 14+ widgets in Fitness/index.js - splitting out of scope for a lint pass.
// eslint-disable-next-line react-refresh/only-export-components
export const manifest = {
  id: 'fitness_instruction',
  name: 'Exercise Library',
  icon: '💪',
  description: 'Browse exercises, build a workout, run it.'
};
