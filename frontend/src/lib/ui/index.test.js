import { describe, it, expect } from 'vitest';
import * as ui from './index.js';

// Every public component or hook with an entry in
// __docs/reference/frontend/design-system.md must be reachable from the barrel.
const PUBLIC_EXPORTS = [
  'useViewScroll', 'COMPACT_VIEWPORT_QUERY', 'useCompactViewport',
  'AppFrame', 'AppView', 'PlaybackFrame', 'useAppMainRef',
  'AppThemeProvider', 'AppChrome', 'Sheet', 'ActionMenu', 'ConfirmModal', 'FormDialog',
  'useOverlayScrollLock', 'useSheetSubmission', 'useKeyedSubmission', 'usePressHoldOffer',
  'useFocusAfterRemoval', 'useFocusRegion', 'useRetryRegion',
  'DismissStackProvider', 'useDismissLayer',
  'LoadingState', 'ErrorState', 'EmptyState', 'StateMessage',
  'SectionCard', 'StatCard', 'Skeleton', 'DateStepper', 'createAppLogger',
  'TouchButton', 'ToastRegion', 'Toast', 'Button', 'SubmitButton', 'Select', 'UiIcon',
];

describe('lib/ui barrel', () => {
  it.each(PUBLIC_EXPORTS)('exports %s', (name) => {
    expect(ui[name]).toBeDefined();
  });

  it('has no undocumented exports', () => {
    expect(Object.keys(ui).sort()).toEqual([...PUBLIC_EXPORTS].sort());
  });
});
