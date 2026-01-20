/**
 * Nutribot Use Cases Index
 * @module nutribot/usecases
 *
 * Exports all use cases for the Nutribot application.
 */

// Food Logging
export { AcceptFoodLog } from './AcceptFoodLog.mjs';
export { DiscardFoodLog } from './DiscardFoodLog.mjs';
export { LogFoodFromText } from './LogFoodFromText.mjs';
export { LogFoodFromImage } from './LogFoodFromImage.mjs';
export { LogFoodFromVoice } from './LogFoodFromVoice.mjs';
export { LogFoodFromUPC } from './LogFoodFromUPC.mjs';
export { SelectUPCPortion } from './SelectUPCPortion.mjs';

// Revision Flow
export { ReviseFoodLog } from './ReviseFoodLog.mjs';
export { ProcessRevisionInput } from './ProcessRevisionInput.mjs';

// Adjustment Flow
export { StartAdjustmentFlow } from './StartAdjustmentFlow.mjs';
export { ShowDateSelection } from './ShowDateSelection.mjs';
export { SelectDateForAdjustment } from './SelectDateForAdjustment.mjs';
export { SelectItemForAdjustment } from './SelectItemForAdjustment.mjs';
export { ApplyPortionAdjustment } from './ApplyPortionAdjustment.mjs';
export { DeleteListItem } from './DeleteListItem.mjs';
export { MoveItemToDate } from './MoveItemToDate.mjs';

// Batch Operations
export { ConfirmAllPending } from './ConfirmAllPending.mjs';

// Commands
export { HandleHelpCommand } from './HandleHelpCommand.mjs';
export { HandleReviewCommand } from './HandleReviewCommand.mjs';

// Reports
export { GenerateDailyReport } from './GenerateDailyReport.mjs';
export { GetReportAsJSON } from './GetReportAsJSON.mjs';

// Coaching
export { GenerateThresholdCoaching } from './GenerateThresholdCoaching.mjs';
export { GenerateOnDemandCoaching } from './GenerateOnDemandCoaching.mjs';
export { GenerateReportCoaching } from './GenerateReportCoaching.mjs';
