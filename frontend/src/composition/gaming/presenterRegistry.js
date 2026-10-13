import { CardBattleView } from "../../../../__app_modules/games/party-games/browser/presenter-card-battle.mjs";

// Composition registry for the generic Gaming runtime. It deliberately lives
// with experiences so the platform never imports a concrete game presenter.
export const GAMING_PRESENTERS = Object.freeze({
  'card-battle': CardBattleView,
});
