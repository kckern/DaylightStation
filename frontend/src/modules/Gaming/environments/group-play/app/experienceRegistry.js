import Jeopardy from '../../../experiences/jeopardy/Jeopardy.jsx';
import ActivityParty from '../../../experiences/activity-party/ActivityParty.jsx';
import DiceExperience from '../../../experiences/dice/DiceExperience.jsx';
import SelectorExperience from '../../../experiences/selector/SelectorExperience.jsx';

// Executable presenter registration is code. Authored labels, themes, inputs,
// and renderer configuration come from the mounted experience manifests.
export const EXPERIENCE_REGISTRY = {
  'jeopardy-board': { component: Jeopardy },
  'activity-party-stage': { component: ActivityParty },
  'polyhedral-dice': { component: DiceExperience },
  'household-selector': { component: SelectorExperience },
};
