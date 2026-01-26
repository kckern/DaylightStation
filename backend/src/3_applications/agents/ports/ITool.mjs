// backend/src/3_applications/agents/ports/ITool.mjs

/**
 * Port interface for agent tools (framework-agnostic)
 * @interface ITool
 *
 * Tools define capabilities that agents can use.
 * The parameters property uses JSON Schema format.
 */
export const ITool = {
  /** @type {string} Unique identifier for the tool */
  name: '',

  /** @type {string} Description of what the tool does (for AI to understand) */
  description: '',

  /** @type {Object} JSON Schema for input parameters */
  parameters: {},

  /**
   * Execute the tool
   * @param {Object} params - Validated parameters matching the schema
   * @param {Object} context - Execution context (userId, householdId, etc.)
   * @returns {Promise<any>} Tool result
   */
  async execute(params, context) {},
};

/**
 * Type guard for ITool
 * @param {any} obj
 * @returns {boolean}
 */
export function isTool(obj) {
  return (
    obj &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.execute === 'function'
  );
}

/**
 * Helper to create a tool definition
 * @param {Object} config
 * @param {string} config.name
 * @param {string} config.description
 * @param {Object} config.parameters - JSON Schema
 * @param {Function} config.execute
 * @returns {ITool}
 */
export function createTool({ name, description, parameters, execute }) {
  return {
    name,
    description,
    parameters: parameters || { type: 'object', properties: {} },
    execute,
  };
}
