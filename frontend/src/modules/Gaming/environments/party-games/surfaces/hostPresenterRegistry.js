import {
  ActivityHost,
  DiceHost,
  JeopardyHost,
  SelectorHost,
} from './hostPresenterRegistry.jsx';

// Command shape follows stable experience identity. Theme and presenter IDs
// are visual metadata and must never select host behavior.
export const PARTY_GAMES_HOST_REGISTRY = Object.freeze({
  jeopardy: JeopardyHost,
  'activity-party': ActivityHost,
  charades: ActivityHost,
  dice: DiceHost,
  selector: SelectorHost,
});
