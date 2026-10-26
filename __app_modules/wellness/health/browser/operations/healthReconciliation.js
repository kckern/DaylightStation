import { projectRowsBudget } from '../today/portionPreview.js';
const idOf = row => String(row.uuid ?? row.id);
/** Acknowledged writes stay above SWR snapshots until a causally newer read. */
export function createHealthReconciliation() {
  let epoch = 0;
  const overlays = new Map();
  return {
    beginRead: () => epoch,
    acknowledge(operation, result) {
      const stamp = ++epoch;
      for (const row of result.rows || []) {
        const id = idOf(row), old = overlays.get(id);
        if (old && !old.row && operation.submittedEpoch != null && old.stamp > operation.submittedEpoch) continue;
        if (!old?.row || (old.row.version ?? 0) <= (row.version ?? 0)) overlays.set(id, { row, sourceDate: operation.date, operationId: operation.id, stamp });
      }
      for (const id of result.removedIds || []) overlays.set(String(id), { row: null, sourceDate: operation.date, operationId: operation.id, stamp });
    },
    reconcile({ date, rows, budget, readToken = -1 }) {
      const replacements = new Map(rows.map(row => [idOf(row), row]));
      const reconciledOperationIds = [];
      for (const [id, overlay] of overlays) {
        if (overlay.sourceDate !== date && overlay.row?.date !== date) continue;
        const server = replacements.get(id);
        const newerRead = readToken >= overlay.stamp;
        const caughtUp = overlay.row ? server && (server.version ?? 0) >= overlay.row.version : !server && newerRead;
        if (caughtUp) {
          // Retire the operation, but retain its version floor against older
          // requests that were already in flight when this snapshot arrived.
          if (server && server.version > overlay.row.version) overlays.set(id, { ...overlay, row: server, stamp: ++epoch });
          reconciledOperationIds.push(overlay.operationId); continue;
        }
        if (newerRead && !server && overlay.row?.date === date) {
          overlays.set(id, { ...overlay, row: null, sourceDate: date, stamp: ++epoch });
          reconciledOperationIds.push(overlay.operationId); continue;
        }
        if (!overlay.row && newerRead && server) {
          overlays.set(id, { ...overlay, row: server, stamp: ++epoch });
          reconciledOperationIds.push(overlay.operationId); continue;
        }
        if (!overlay.row || overlay.row.date !== date) replacements.delete(id);
        else if (!server || (server.version ?? 0) < (overlay.row.version ?? 0)) replacements.set(id, overlay.row);
      }
      const projected = [...replacements.values()];
      return { rows: projected, budget: projectRowsBudget(rows, budget, projected), reconciledOperationIds };
    },
    dispose() { overlays.clear(); },
  };
}
