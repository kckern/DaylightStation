/**
 * IHomeHistoryGateway
 *
 * Port for reading how entities changed over a window of time. Implementations
 * translate the platform's vocabulary into plain points; nothing
 * provider-specific (ISO strings, platform non-value states) crosses this port.
 *
 * readHistory(entityIds, {startMs, endMs}): Promise<Map<string, Array<{t: number, v: number|string|null}>>>
 *   `t` is epoch milliseconds; `v` is null when the platform had no value
 *   (unavailable, unknown). `endMs: null` means "until now". An unreachable
 *   platform yields an empty Map.
 */

export function isHomeHistoryGateway(obj) {
  return Boolean(obj) && typeof obj.readHistory === 'function';
}

export class IHomeHistoryGateway {
  async readHistory() { throw new Error('IHomeHistoryGateway.readHistory not implemented'); }
}

export default IHomeHistoryGateway;
