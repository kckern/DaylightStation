/**
 * Prompt Renderer
 * @module _lib/prompts/PromptRenderer
 * 
 * Handlebars-like template rendering for prompt content.
 * 
 * Supports:
 * - {{variable}} - Simple substitution
 * - {{#if condition}}...{{/if}} - Conditionals  
 * - {{#each array}}...{{/each}} - Iteration
 * - {{object.property}} - Nested access
 */

/**
 * Render template variables in content
 * @param {string} template - Template string with {{placeholders}}
 * @param {Object} variables - Variable values
 * @returns {string}
 */
export function render(template, variables = {}) {
  if (!template || typeof template !== 'string') {
    return template || '';
  }
  
  let result = template;
  
  // 1. Process {{#each array}}...{{/each}} blocks
  result = processEach(result, variables);
  
  // 2. Process {{#if condition}}...{{else}}...{{/if}} blocks
  result = processConditionals(result, variables);
  
  // 3. Process {{variable}} and {{object.property}} substitutions
  result = processVariables(result, variables);
  
  return result;
}

/**
 * Process {{#each array}}...{{/each}} blocks
 * @private
 */
function processEach(template, variables) {
  // Match {{#each arrayName}}...{{/each}}
  const eachRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  
  return template.replace(eachRegex, (match, arrayName, blockContent) => {
    const array = getNestedValue(variables, arrayName);
    
    if (!Array.isArray(array) || array.length === 0) {
      return '';
    }
    
    return array.map((item, index) => {
      // Create context with item properties and special variables
      const itemContext = typeof item === 'object' 
        ? { ...item, '@index': index, '@first': index === 0, '@last': index === array.length - 1 }
        : { '.': item, '@index': index };
      
      // Recursively render block content with item context
      return render(blockContent, { ...variables, ...itemContext });
    }).join('');
  });
}

/**
 * Process {{#if condition}}...{{else}}...{{/if}} blocks
 * @private
 */
function processConditionals(template, variables) {
  // Match {{#if condition}}...{{else}}...{{/if}} or {{#if condition}}...{{/if}}
  const ifRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
  
  return template.replace(ifRegex, (match, condition, ifBlock, elseBlock = '') => {
    const conditionValue = evaluateCondition(condition.trim(), variables);
    
    if (conditionValue) {
      return render(ifBlock, variables);
    } else {
      return render(elseBlock, variables);
    }
  });
}

/**
 * Process {{variable}} substitutions
 * @private
 */
function processVariables(template, variables) {
  // Match {{variableName}} or {{object.property}}
  return template.replace(/\{\{([^#/}][^}]*)\}\}/g, (match, path) => {
    const trimmedPath = path.trim();
    const value = getNestedValue(variables, trimmedPath);
    
    if (value === undefined || value === null) {
      return '';
    }
    
    // Handle arrays and objects
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    return String(value);
  });
}

/**
 * Get nested value from object using dot notation
 * @param {Object} obj - Source object
 * @param {string} path - Dot-notated path (e.g., "user.name")
 * @returns {*}
 */
function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  
  // Handle simple single-level access
  if (!path.includes('.')) {
    return obj[path];
  }
  
  // Handle nested paths
  return path.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

/**
 * Evaluate a condition expression
 * @param {string} condition - Condition string
 * @param {Object} variables - Variable context
 * @returns {boolean}
 */
function evaluateCondition(condition, variables) {
  // Simple truthy check
  const value = getNestedValue(variables, condition);
  
  // Check for existence and truthiness
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).length > 0;
  }
  
  return Boolean(value);
}

/**
 * Render an array of chat messages
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} variables
 * @returns {Array<{role: string, content: string}>}
 */
export function renderMessages(messages, variables = {}) {
  if (!Array.isArray(messages)) {
    return [];
  }
  
  return messages.map(msg => ({
    role: msg.role,
    content: render(msg.content, variables),
  }));
}

export default { render, renderMessages };
