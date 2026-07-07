/** Blank charts read as bugs — say why a block is empty (audit 5.5). */
export const EmptyState = ({ message = 'No transactions this period' }) => (
  <div className="budget-block-empty">{message}</div>
);
