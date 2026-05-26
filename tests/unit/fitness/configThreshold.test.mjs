// tests/unit/fitness/configThreshold.test.mjs
//
// W1.A — Configurable continuous-usage threshold (Phase 1 / Tasks 8-11).
//
// Verifies that `governance.usage_threshold_seconds` is surfaced via
// FitnessConfigService.getNormalizedConfig() and defaults to 300 seconds
// when not explicitly set in fitness.yml.
//
// Per audit Decision §7 / W1 spec: the configured threshold is what drives
// the continuous-usage attribution heuristic (segment merge vs. drop). The
// 300-second default lives at the YAML / service layer; the frontend service
// (GuestAssignmentService) retains its own 60s default for back-compat with
// existing unit tests.

import { describe, it, expect, jest } from '@jest/globals';
import { FitnessConfigService } from '../../../backend/src/3_applications/fitness/FitnessConfigService.mjs';

function buildService(rawConfig) {
  const configService = {
    getDefaultHouseholdId: () => 'test',
    getHouseholdAppConfig: jest.fn(() => rawConfig)
  };
  return new FitnessConfigService({ configService, userDataService: null, logger: { error: () => {} } });
}

describe('FitnessConfigService — governance.usage_threshold_seconds', () => {
  it('reads governance.usage_threshold_seconds from config', () => {
    const service = buildService({
      governance: { usage_threshold_seconds: 240 }
    });
    const cfg = service.getNormalizedConfig();
    expect(cfg.governance.usage_threshold_seconds).toBe(240);
  });

  it('defaults usage_threshold_seconds to 300 when absent from governance block', () => {
    const service = buildService({
      governance: {}
    });
    const cfg = service.getNormalizedConfig();
    expect(cfg.governance.usage_threshold_seconds).toBe(300);
  });

  it('defaults usage_threshold_seconds to 300 when governance block is missing entirely', () => {
    const service = buildService({});
    const cfg = service.getNormalizedConfig();
    expect(cfg.governance.usage_threshold_seconds).toBe(300);
  });
});
