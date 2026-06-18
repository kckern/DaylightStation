// frontend/src/modules/Fitness/widgets/FingerprintManager/manifest.test.js
import { describe, it, expect } from 'vitest';
import manifest from './manifest.js';

describe('FingerprintManager manifest', () => {
  it('declares an id, name and icon', () => {
    expect(manifest.id).toBe('fingerprint-manager');
    expect(manifest.name).toBeTruthy();
    expect(manifest.icon).toBeTruthy();
  });
});
