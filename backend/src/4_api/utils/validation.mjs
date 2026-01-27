/**
 * Require a parameter from a source object
 * @param {Object} source - The source object (req.params, req.query, req.body)
 * @param {string} name - The parameter name
 * @returns {*} The parameter value
 * @throws {Error} 400 error if parameter is missing
 */
export function requireParam(source, name) {
  const value = source[name];
  if (value === undefined || value === null || value === '') {
    const error = new Error(`Missing required parameter: ${name}`);
    error.status = 400;
    throw error;
  }
  return value;
}

/**
 * Require multiple parameters from a source object
 * @param {Object} source - The source object
 * @param {string[]} names - Array of parameter names
 * @returns {Object} Object with parameter values keyed by name
 * @throws {Error} 400 error if any parameter is missing
 */
export function requireParams(source, names) {
  const result = {};
  for (const name of names) {
    result[name] = requireParam(source, name);
  }
  return result;
}
