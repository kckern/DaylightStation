export function buildHeadlineGrid(sources, rows, cols) {
  return rows.map((rowValue, rowIndex) => cols.map((colValue, colIndex) => {
    const entry = Object.entries(sources).find(([, source]) => source.row === rowIndex && source.col === colIndex);
    return entry ? { id: entry[0], ...entry[1], gridRow: rowValue, gridCol: colValue } : null;
  }));
}
