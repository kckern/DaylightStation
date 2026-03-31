/**
 * AutoApproveStrategy - Default gatekeeper strategy that approves all scans.
 * @module domains/barcode/strategies/AutoApproveStrategy
 */

/**
 * Evaluate a scan context — always approves.
 * @param {Object} _scanContext - Scan context (unused)
 * @returns {Promise<{approved: boolean}>}
 */
export async function autoApprove(_scanContext) {
  return { approved: true };
}
