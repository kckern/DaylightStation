/**
 * resolveBackButtonLabel — pure label/a11y helper for FitnessChartBackButton.
 *
 * @param {{ historyMode?: boolean }} [state]
 * @returns {{ label: string, title: string, ariaLabel: string }}
 */
export function resolveBackButtonLabel(state) {
  const historyMode = !!(state && state.historyMode);
  if (historyMode) {
    return {
      label: 'Back to Home',
      title: 'Back to Home',
      ariaLabel: 'Back to Home (session ended)',
    };
  }
  return {
    label: 'Return Home',
    title: 'Return Home',
    ariaLabel: 'Return Home',
  };
}
