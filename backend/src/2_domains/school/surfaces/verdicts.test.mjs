import { describe, expect, it } from 'vitest';
import { capabilityReasons, moduleVerdict, rollUpLesson } from './verdicts.mjs';

const paper = { surfaceId: 'p', capabilities: ['quiz@1', 'response.choice@1', 'return.scan@1'] };

describe('verdicts (spec §7)', () => {
  it('reports each missing capability exactly once, by ID', () => {
    const reasons = capabilityReasons(
      { capabilities: ['quiz@1', 'response.text@1', 'image@1'], tracked: true }, paper,
    );
    expect(reasons).toEqual(['missing capability response.text@1', 'missing capability image@1']);
  });

  it('flags a tracked demand set on a surface with no return channel', () => {
    const reasons = capabilityReasons(
      { capabilities: ['quiz@1', 'response.choice@1'], tracked: true },
      { surfaceId: 's', capabilities: ['quiz@1', 'response.choice@1'] },
    );
    expect(reasons.join()).toMatch(/return channel/);
  });

  it('renders iff there are no reasons', () => {
    expect(moduleVerdict({ moduleId: 'm', reasons: [] }).verdict).toBe('render');
    expect(moduleVerdict({ moduleId: 'm', reasons: ['x'] }).verdict).toBe('incompatible');
  });

  it('rolls up full/partial/none, with fullOrNothing demoting partial', () => {
    const r = (v) => ({ moduleId: 'm', verdict: v, reasons: [], warnings: [] });
    expect(rollUpLesson([r('render'), r('render')])).toBe('full');
    expect(rollUpLesson([r('render'), r('incompatible')])).toBe('partial');
    expect(rollUpLesson([r('incompatible')])).toBe('none');
    expect(rollUpLesson([r('render'), r('incompatible')], { fullOrNothing: true })).toBe('none');
    expect(rollUpLesson([r('render')], { fullOrNothing: true })).toBe('full');
  });
});
