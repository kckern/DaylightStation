import { describe, it, expect } from 'vitest';
import { getModule, getModuleManifest } from './index.js';

// Regression: a deep link such as /fitness/module/fingerprint-manager passes the
// bare hyphenated id through to getModule(). Config and LEGACY_ID_MAP use the
// underscore form (fingerprint_manager), so resolveKey must tolerate the variance
// or the route renders "Module not found".
describe('fitness module resolution', () => {
  it('resolves the underscore id used by config/menu', () => {
    expect(getModule('fingerprint_manager')).toBeTruthy();
    expect(getModuleManifest('fingerprint_manager')).toBeTruthy();
  });

  it('resolves the hyphenated id used by deep links', () => {
    expect(getModule('fingerprint-manager')).toBeTruthy();
    expect(getModuleManifest('fingerprint-manager')).toBeTruthy();
  });

  it('resolves the fully namespaced registry key', () => {
    expect(getModule('fitness:fingerprint-manager')).toBeTruthy();
  });

  it('returns null for an unknown id', () => {
    expect(getModule('definitely-not-a-module')).toBeNull();
  });
});
