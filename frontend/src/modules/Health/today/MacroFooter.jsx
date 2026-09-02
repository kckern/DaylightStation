import { UnstyledButton } from '@mantine/core';

const sum = (items, key) => Math.round(items.reduce((s, i) => s + (Number(i[key]) || 0), 0));

export function MacroFooter({ items = [], coachLine, onCoachTap, children }) {
  return (
    <div className="health-footer">
      {coachLine ? (
        <UnstyledButton className="health-footer__coach" onClick={onCoachTap}>💬 {coachLine}</UnstyledButton>
      ) : null}
      <div className="health-footer__row">
        <span className="health-footer__macros">
          P {sum(items, 'protein')}g · C {sum(items, 'carbs')}g · F {sum(items, 'fat')}g
        </span>
        <span className="health-footer__actions">{children}</span>
      </div>
    </div>
  );
}
export default MacroFooter;
