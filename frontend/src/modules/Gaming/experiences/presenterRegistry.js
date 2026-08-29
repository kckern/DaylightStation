import { CardBattleView } from './card-battle/CardBattleView.jsx';

// Composition registry for the generic Gaming runtime. It deliberately lives
// with experiences so the platform never imports a concrete game presenter.
export const GAMING_PRESENTERS = Object.freeze({
  'card-battle': CardBattleView,
});
