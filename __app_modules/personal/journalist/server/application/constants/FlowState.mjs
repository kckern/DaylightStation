/**
 * Flow State Constants
 * Defines valid flow types and sub-flow transitions for Journalist bot
 */

export const FlowType = Object.freeze({
  FREE_WRITE: 'free_write',
  MORNING_DEBRIEF: 'morning_debrief',
  QUIZ: 'quiz',
  INTERVIEW: 'interview',
});

export const SubFlowType = Object.freeze({
  SOURCE_PICKER: 'source_picker',
  INTERVIEW: 'interview',
  CATEGORY_PICKER: 'category_picker',
});

/**
 * Valid sub-flows per flow type
 * null means "no sub-flow" (root flow state)
 */
const VALID_SUB_FLOWS = Object.freeze({
  [FlowType.FREE_WRITE]: [null],
  [FlowType.MORNING_DEBRIEF]: [null, SubFlowType.SOURCE_PICKER, SubFlowType.INTERVIEW, SubFlowType.CATEGORY_PICKER],
  [FlowType.QUIZ]: [null],
  [FlowType.INTERVIEW]: [null],
});

/**
 * Check if a flow type is valid
 * @param {string} flowType
 * @returns {boolean}
 */
export function isValidFlow(flowType) {
  return Object.values(FlowType).includes(flowType);
}

/**
 * Check if a sub-flow is valid for a given flow
 * @param {string} flowType
 * @param {string|null} subFlow
 * @returns {boolean}
 */
export function isValidSubFlow(flowType, subFlow) {
  const validSubFlows = VALID_SUB_FLOWS[flowType];
  if (!validSubFlows) return false;
  return validSubFlows.includes(subFlow);
}

/**
 * Get valid sub-flows for a flow type
 * @param {string} flowType
 * @returns {Array<string|null>}
 */
export function getValidSubFlows(flowType) {
  return VALID_SUB_FLOWS[flowType] || [null];
}
