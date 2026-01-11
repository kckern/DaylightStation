/**
 * NutriBot Use Cases barrel export
 * @module nutribot/application/usecases
 */

// Core Food Logging
export { LogFoodFromImage } from './LogFoodFromImage.mjs';
export { LogFoodFromText } from './LogFoodFromText.mjs';
export { LogFoodFromVoice } from './LogFoodFromVoice.mjs';
export { LogFoodFromUPC } from './LogFoodFromUPC.mjs';

// Food Log Actions
export { AcceptFoodLog } from './AcceptFoodLog.mjs';
export { DiscardFoodLog } from './DiscardFoodLog.mjs';
export { ReviseFoodLog } from './ReviseFoodLog.mjs';
export { ProcessRevisionInput } from './ProcessRevisionInput.mjs';
export { SelectUPCPortion } from './SelectUPCPortion.mjs';

// Reporting
export { GenerateDailyReport } from './GenerateDailyReport.mjs';
export { GetReportAsJSON } from './GetReportAsJSON.mjs';

// Coaching
export { GenerateThresholdCoaching } from './GenerateThresholdCoaching.mjs';
export { GenerateOnDemandCoaching } from './GenerateOnDemandCoaching.mjs';
export { GenerateReportCoaching } from './GenerateReportCoaching.mjs';

// Adjustment Flow
export { StartAdjustmentFlow } from './StartAdjustmentFlow.mjs';
export { ShowDateSelection } from './ShowDateSelection.mjs';
export { SelectDateForAdjustment } from './SelectDateForAdjustment.mjs';
export { SelectItemForAdjustment } from './SelectItemForAdjustment.mjs';
export { ApplyPortionAdjustment } from './ApplyPortionAdjustment.mjs';
export { DeleteListItem } from './DeleteListItem.mjs';
export { MoveItemToDate } from './MoveItemToDate.mjs';

// Commands
export { HandleHelpCommand } from './HandleHelpCommand.mjs';
export { HandleReviewCommand } from './HandleReviewCommand.mjs';
export { ConfirmAllPending } from './ConfirmAllPending.mjs';
