import { FoodLogReview } from './application/nutrition/FoodLogReview.mjs';
import { NearestIconChooser } from './application/nutrition/NearestIconChooser.mjs';
import { scopedGateway } from '#apps/common/ports/IAIGateway.mjs';

/** A capture scope keeps first-use construction and service identity local to one caller. */
export function createNutritionCaptureOperations({ getDecisionGateway, getFoodLogs, getItems, getLogger }) {
  let iconChooser;
  let foodLogReview;
  return {
    getIconChooser() {
      if (!iconChooser) {
        iconChooser = new NearestIconChooser({
          decisionGateway: scopedGateway(getDecisionGateway(), { feature: 'icon-pick' }),
          logger: getLogger(),
        });
      }
      return iconChooser;
    },
    getFoodLogReview() {
      return foodLogReview ||= new FoodLogReview({ foodLogs: getFoodLogs(), items: getItems(), logger: getLogger() });
    },
  };
}
