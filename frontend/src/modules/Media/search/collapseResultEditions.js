// frontend/src/modules/Media/search/collapseResultEditions.js
// Search results list one film / book / album once, however many editions the
// library holds (same rule as Home's rows: episodes, videos and tracks never merge).
import { collapseEditions } from '../browse/tilePresentation.js';

export function collapseResultEditions(results) {
  const list = Array.isArray(results) ? results : [];
  return collapseEditions(list, { idOf: (row) => row?.id ?? row?.itemId }).map((group) => group.entry);
}

export default collapseResultEditions;
