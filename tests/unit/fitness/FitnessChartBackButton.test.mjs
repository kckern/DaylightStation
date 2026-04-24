import { describe, it, expect, beforeAll } from '@jest/globals';

let resolveBackButtonLabel;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/FitnessChartBackButton.js');
  resolveBackButtonLabel = mod.resolveBackButtonLabel;
});

describe('resolveBackButtonLabel', () => {
  it('returns default label when session is live', () => {
    expect(resolveBackButtonLabel({ historyMode: false })).toEqual({
      label: 'Return Home',
      title: 'Return Home',
      ariaLabel: 'Return Home',
    });
  });

  it('returns history-variant label when session has ended', () => {
    expect(resolveBackButtonLabel({ historyMode: true })).toEqual({
      label: 'Back to Home',
      title: 'Back to Home',
      ariaLabel: 'Back to Home (session ended)',
    });
  });

  it('defaults to live-session label when state is missing', () => {
    expect(resolveBackButtonLabel(undefined)).toEqual({
      label: 'Return Home',
      title: 'Return Home',
      ariaLabel: 'Return Home',
    });
    expect(resolveBackButtonLabel({})).toEqual({
      label: 'Return Home',
      title: 'Return Home',
      ariaLabel: 'Return Home',
    });
  });
});
