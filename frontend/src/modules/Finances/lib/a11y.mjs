/**
 * Spread-props that make a non-semantic element behave like a button:
 * role, tab focus, and Enter/Space activation (audit 5.4).
 * Usage: <td {...pressable(() => open(month))}>…</td>
 */
export const pressable = (handler, extra = {}) => ({
  role: 'button',
  tabIndex: 0,
  onClick: handler,
  onKeyDown: (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler(e);
    }
  },
  ...extra
});
