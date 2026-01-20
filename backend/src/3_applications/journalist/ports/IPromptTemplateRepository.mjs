/**
 * IPromptTemplateRepository Port
 * @module journalist/application/ports/IPromptTemplateRepository
 *
 * Repository for managing prompt templates.
 */

/**
 * @typedef {Object} PromptSection
 * @property {string} role - 'system', 'user', or 'assistant'
 * @property {string} content - Template content with placeholders
 */

/**
 * @typedef {Object} PromptTemplate
 * @property {string} id - Template identifier
 * @property {string} type - Prompt type
 * @property {PromptSection[]} sections - Template sections
 * @property {string[]} placeholders - Required placeholder names
 */

/**
 * @interface IPromptTemplateRepository
 */

/**
 * Get template by prompt type
 * @function
 * @name IPromptTemplateRepository#getTemplate
 * @param {string} promptType
 * @returns {Promise<PromptTemplate|null>}
 */

/**
 * Fill template with parameters
 * @function
 * @name IPromptTemplateRepository#fillTemplate
 * @param {PromptTemplate} template
 * @param {object} params
 * @returns {Array<{role: string, content: string}>}
 */

/**
 * List available templates
 * @function
 * @name IPromptTemplateRepository#listTemplates
 * @returns {Promise<string[]>}
 */

// Export interface documentation only (implementation is in infrastructure)
export const IPromptTemplateRepository = {
  name: 'IPromptTemplateRepository',
  methods: ['getTemplate', 'fillTemplate', 'listTemplates'],
};

export default IPromptTemplateRepository;
