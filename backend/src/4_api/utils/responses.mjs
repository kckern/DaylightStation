/**
 * Send a success JSON response
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {number} [status=200] - HTTP status code
 */
export function sendSuccess(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

/**
 * Send an error JSON response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} [status=500] - HTTP status code
 */
export function sendError(res, message, status = 500) {
  res.status(status).json({ success: false, error: message });
}
