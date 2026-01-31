// tests/lib/testDataMatchers.mjs
/**
 * Matcher DSL for validating API responses against expected patterns
 *
 * Supported matchers:
 * - Exact string: "hello"
 * - Regex: /pattern/i
 * - Exists: "exists"
 * - Types: "string", "number", "boolean", "array", "object"
 * - Comparisons: ">10", ">=5", "<100", "<=50"
 * - Range: "10-100"
 * - Enum: "movie|episode|track"
 * - Contains: "contains:foo"
 * - Length: "length:>0", "length:5", "length:5-10"
 */

/**
 * Parse a matcher string into a structured matcher object
 * @param {string} matcherStr - The matcher string to parse
 * @returns {Object} Parsed matcher object
 */
export function parseMatcher(matcherStr) {
  const str = String(matcherStr);

  // Regex: /pattern/ or /pattern/flags
  const regexMatch = str.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      return {
        type: 'regex',
        pattern: new RegExp(regexMatch[1], regexMatch[2])
      };
    } catch (e) {
      return { type: 'error', message: `Invalid regex: ${e.message}` };
    }
  }

  // Exists
  if (str === 'exists') {
    return { type: 'exists' };
  }

  // Type matchers
  const types = ['string', 'number', 'boolean', 'array', 'object'];
  if (types.includes(str)) {
    return { type: 'type', expectedType: str };
  }

  // Length matcher: length:>0, length:5, length:5-10
  if (str.startsWith('length:')) {
    const lengthSpec = str.slice(7);
    const compMatch = lengthSpec.match(/^(>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
    if (compMatch) {
      return {
        type: 'length',
        comparison: {
          type: 'comparison',
          operator: compMatch[1],
          value: parseFloat(compMatch[2])
        }
      };
    }
    // Range length
    const rangeMatch = lengthSpec.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      return {
        type: 'length',
        comparison: {
          type: 'range',
          min: parseInt(rangeMatch[1], 10),
          max: parseInt(rangeMatch[2], 10)
        }
      };
    }
    // Exact length
    const exactMatch = lengthSpec.match(/^(\d+)$/);
    if (exactMatch) {
      return {
        type: 'length',
        comparison: {
          type: 'exact',
          value: parseInt(exactMatch[1], 10)
        }
      };
    }
  }

  // Contains matcher: contains:foo
  if (str.startsWith('contains:')) {
    return {
      type: 'contains',
      value: str.slice(9)
    };
  }

  // Numeric comparisons: >10, >=5, <100, <=50
  const comparisonMatch = str.match(/^(>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
  if (comparisonMatch) {
    return {
      type: 'comparison',
      operator: comparisonMatch[1],
      value: parseFloat(comparisonMatch[2])
    };
  }

  // Range: 10-100 (must have two numbers separated by dash)
  // Be careful not to match negative numbers like "-10"
  const rangeMatch = str.match(/^(-?\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (min > max) {
      return { type: 'error', message: `Invalid range: ${min} > ${max}` };
    }
    return {
      type: 'range',
      min,
      max
    };
  }

  // Enum: movie|episode|track (must have at least one pipe)
  if (str.includes('|')) {
    return {
      type: 'enum',
      values: str.split('|').map(v => v.trim()).filter(v => v !== '')
    };
  }

  // Default: exact string match
  return { type: 'exact', value: str };
}

/**
 * Check a value against a parsed matcher
 * @param {*} value - The value to check
 * @param {Object} matcher - The parsed matcher object
 * @param {string} fieldName - The field name (for error messages)
 * @returns {{ valid: boolean, error?: string }}
 */
export function checkMatcher(value, matcher, fieldName) {
  switch (matcher.type) {
    case 'error':
      return { valid: false, error: `${fieldName}: ${matcher.message}` };

    case 'exact':
      if (value === matcher.value) {
        return { valid: true };
      }
      return {
        valid: false,
        error: `${fieldName}: expected "${matcher.value}", got "${value}"`
      };

    case 'regex':
      if (typeof value === 'string' && matcher.pattern.test(value)) {
        return { valid: true };
      }
      return {
        valid: false,
        error: `${fieldName}: value "${value}" does not match pattern ${matcher.pattern}`
      };

    case 'exists':
      if (value !== null && value !== undefined) {
        return { valid: true };
      }
      return {
        valid: false,
        error: `${fieldName}: expected to exist, but was ${value}`
      };

    case 'type':
      const actualType = getType(value);
      if (actualType === matcher.expectedType) {
        return { valid: true };
      }
      return {
        valid: false,
        error: `${fieldName}: expected type "${matcher.expectedType}", got "${actualType}"`
      };

    case 'comparison':
      if (typeof value !== 'number') {
        return {
          valid: false,
          error: `${fieldName}: expected number for comparison, got ${typeof value}`
        };
      }
      const compValid = evaluateComparison(value, matcher.operator, matcher.value);
      if (compValid) {
        return { valid: true };
      }
      return {
        valid: false,
        error: `${fieldName}: ${value} is not ${matcher.operator} ${matcher.value}`
      };

    case 'range':
      if (typeof value !== 'number') {
        return {
          valid: false,
          error: `${fieldName}: expected number for range, got ${typeof value}`
        };
      }
      if (value >= matcher.min && value <= matcher.max) {
        return { valid: true };
      }
      return {
        valid: false,
        error: `${fieldName}: ${value} is not in range ${matcher.min}-${matcher.max}`
      };

    case 'enum':
      if (matcher.values.includes(value)) {
        return { valid: true };
      }
      return {
        valid: false,
        error: `${fieldName}: "${value}" is not one of: ${matcher.values.join('|')}`
      };

    case 'contains':
      if (typeof value === 'string' && value.includes(matcher.value)) {
        return { valid: true };
      }
      if (Array.isArray(value) && value.includes(matcher.value)) {
        return { valid: true };
      }
      return {
        valid: false,
        error: `${fieldName}: does not contain "${matcher.value}"`
      };

    case 'length':
      const length = getLength(value);
      if (length === null) {
        return {
          valid: false,
          error: `${fieldName}: cannot get length of ${typeof value}`
        };
      }

      if (matcher.comparison.type === 'exact') {
        if (length === matcher.comparison.value) {
          return { valid: true };
        }
        return {
          valid: false,
          error: `${fieldName}: expected length ${matcher.comparison.value}, got ${length}`
        };
      }

      if (matcher.comparison.type === 'comparison') {
        const lengthValid = evaluateComparison(length, matcher.comparison.operator, matcher.comparison.value);
        if (lengthValid) {
          return { valid: true };
        }
        return {
          valid: false,
          error: `${fieldName}: length ${length} is not ${matcher.comparison.operator} ${matcher.comparison.value}`
        };
      }

      if (matcher.comparison.type === 'range') {
        if (length >= matcher.comparison.min && length <= matcher.comparison.max) {
          return { valid: true };
        }
        return {
          valid: false,
          error: `${fieldName}: length ${length} is not in range ${matcher.comparison.min}-${matcher.comparison.max}`
        };
      }
      break;

    default:
      return {
        valid: false,
        error: `${fieldName}: unknown matcher type "${matcher.type}"`
      };
  }

  return { valid: false, error: `${fieldName}: unexpected error` };
}

/**
 * Validate an object against an expectation map
 * @param {Object} actual - The actual object to validate
 * @param {Object} expectations - Map of field paths to matcher strings
 * @returns {{ valid: boolean, errors: Array<{ field: string, error: string }> }}
 */
export function validateExpectations(actual, expectations) {
  const errors = [];

  for (const [fieldPath, matcherStr] of Object.entries(expectations)) {
    const value = getNestedValue(actual, fieldPath);
    const matcher = parseMatcher(matcherStr);
    const result = checkMatcher(value, matcher, fieldPath);

    if (!result.valid) {
      errors.push({
        field: fieldPath,
        error: result.error
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Helper functions

/**
 * Get the type of a value, distinguishing arrays from objects
 * @param {*} value
 * @returns {string}
 */
function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Evaluate a comparison operation
 * @param {number} value
 * @param {string} operator
 * @param {number} target
 * @returns {boolean}
 */
function evaluateComparison(value, operator, target) {
  switch (operator) {
    case '>': return value > target;
    case '>=': return value >= target;
    case '<': return value < target;
    case '<=': return value <= target;
    default: return false;
  }
}

/**
 * Get length of a value (string or array)
 * @param {*} value
 * @returns {number|null}
 */
function getLength(value) {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.length;
  return null;
}

/**
 * Get a nested value from an object using dot notation and array indices
 * Supports paths like: "data.items", "items[0].id", "data.items[2].name"
 * @param {Object} obj
 * @param {string} path
 * @returns {*}
 */
function getNestedValue(obj, path) {
  // Parse the path into segments
  // "data.items[0].name" -> ["data", "items", "0", "name"]
  const segments = path.split(/\.|\[|\]/).filter(s => s !== '');

  let current = obj;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Check if segment is a numeric index
    const index = parseInt(segment, 10);
    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index];
    } else {
      current = current[segment];
    }
  }

  return current;
}
