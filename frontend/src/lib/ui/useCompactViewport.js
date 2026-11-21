import { useMediaQuery } from '@mantine/hooks';
import { DS_TOKENS } from '../theme/tokens.mjs';

export const COMPACT_VIEWPORT_QUERY = `(max-width: ${DS_TOKENS.breakpoints.md - 1}px)`;

export function useCompactViewport() {
  return useMediaQuery(COMPACT_VIEWPORT_QUERY, false, { getInitialValueInEffect: false });
}
