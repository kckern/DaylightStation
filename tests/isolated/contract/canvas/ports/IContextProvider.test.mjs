// tests/isolated/contract/canvas/ports/IContextProvider.test.mjs
import { describe, it, expect } from '@jest/globals';
import { validateContextProvider } from '../../../../../backend/src/3_applications/canvas/ports/IContextProvider.mjs';

describe('IContextProvider contract', () => {
  it('validates compliant implementation', () => {
    const validImpl = {
      getContext: async () => ({}),
      getTimeSlot: () => 'morning',
    };
    expect(() => validateContextProvider(validImpl)).not.toThrow();
  });

  it('rejects missing getContext', () => {
    const invalid = {
      getTimeSlot: () => 'morning',
    };
    expect(() => validateContextProvider(invalid)).toThrow(/getContext/);
  });

  it('rejects missing getTimeSlot', () => {
    const invalid = {
      getContext: async () => ({}),
    };
    expect(() => validateContextProvider(invalid)).toThrow(/getTimeSlot/);
  });

  it('rejects non-function methods', () => {
    const invalid = {
      getContext: { not: 'a function' },
      getTimeSlot: () => 'morning',
    };
    expect(() => validateContextProvider(invalid)).toThrow(/getContext.*function/);
  });
});
