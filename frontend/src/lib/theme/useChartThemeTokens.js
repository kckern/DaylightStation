import { useEffect, useState } from 'react';

/** Read the semantic color roles used by Highcharts consumers on the mounted theme surface. */
export function readChartThemeTokens(element) {
  if (!element) return null;
  const computed = getComputedStyle(element);
  const get = name => computed.getPropertyValue(name).trim();
  const info = get('--ds-info');
  return {
    textHigh: get('--ds-text-high'),
    textMid: get('--ds-text-mid'),
    textLow: get('--ds-text-low'),
    border: get('--ds-border'),
    surface: get('--ds-surface'),
    accent: get('--ds-accent') || info,
    warning: get('--ds-warning'),
    info,
  };
}

/** Read chart colors after the host is attached beneath its AppThemeProvider. */
export function useChartThemeTokens(elementRef) {
  const [tokens, setTokens] = useState(null);
  useEffect(() => {
    if (elementRef?.current) setTokens(readChartThemeTokens(elementRef.current));
  }, [elementRef]);
  return tokens;
}
