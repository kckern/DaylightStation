import { describe, it, expect } from 'vitest';
import { keyFromCode } from "./physicalKey.js";
describe('keyFromCode', () => {
  it.each([['KeyA', 'a'], ['Digit3', '3'], ['Space', ' '], ['NumpadEnter', 'enter'], ['Tab', 'tab'], ['Backslash', '\\'], ['ArrowLeft', 'arrowleft'], ['F1', null], [undefined, null]])('%s → %s', (code, key) => {
    expect(keyFromCode(code)).toBe(key);
  });
});
