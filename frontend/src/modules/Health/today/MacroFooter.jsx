import { UnstyledButton } from '@mantine/core';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';

// The SAME fold BudgetService uses for the equation and the macro bars, and the
// same one LogTable uses for per-meal subtotals. This summed `day.items`
// unfiltered until Task 6.3's review: harmless only while every live row is
// `accepted`, and a silent disagreement with the bars directly above it the
// moment one is not.
const sum = (items, key) => Math.round(sumCounted(items, key));

/**
 * Macro summary + coach one-liner for Today. Used to also host the
 * mic/camera/barcode footer icons — Task 4.3 retires those in favor of
 * QuickCaptureBar.jsx (the one always-reachable capture surface), so this
 * component is purely informational now: no `children`/actions slot.
 */
export function MacroFooter({ items = [], coachLine, onCoachTap }) {
  return (
    <div className="health-footer">
      {coachLine ? (
        <UnstyledButton className="health-footer__coach" onClick={() => onCoachTap()}>💬 {coachLine}</UnstyledButton>
      ) : null}
      <div className="health-footer__row">
        <span className="health-footer__macros">
          P {sum(items, 'protein')}g · C {sum(items, 'carbs')}g · F {sum(items, 'fat')}g
        </span>
      </div>
    </div>
  );
}
export default MacroFooter;
