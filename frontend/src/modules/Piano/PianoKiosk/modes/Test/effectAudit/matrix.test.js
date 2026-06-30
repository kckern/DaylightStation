// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildAuditMatrix, buildStimulus, STIMULUS, recordTotalMs } from './matrix.js';

const effects = {
  reverb: { typeCC: 80, levelCC: 91, types: [{ value: 0, label: 'Room' }, { value: 4, label: 'Hall' }, { value: 8, label: 'Plate' }] },
  chorus: { typeCC: 81, levelCC: 93 },
};

describe('buildStimulus', () => {
  it('is a single staccato note (on then off)', () => {
    const ev = buildStimulus();
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ type: 'note_on', note: STIMULUS.note });
    expect(ev[1]).toMatchObject({ type: 'note_off', note: STIMULUS.note });
    expect(ev[1].t).toBeGreaterThan(ev[0].t);
  });
});

describe('recordTotalMs', () => {
  it('spans lead + note + tail', () => {
    expect(recordTotalMs()).toBe(STIMULUS.recordLeadMs + STIMULUS.offMs + STIMULUS.recordTailMs);
  });
});

describe('buildAuditMatrix', () => {
  const m = buildAuditMatrix(effects);
  it('starts with the all-off control', () => {
    expect(m[0].group).toBe('control');
    expect(m[0].cc).toEqual([{ controller: 91, value: 0 }, { controller: 93, value: 0 }]);
  });
  it('has unique, index-prefixed labels', () => {
    const labels = m.map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => /^\d\d-/.test(l))).toBe(true);
  });
  it('reverb depth clips set typeCC=Hall(4) and sweep levelCC 0..127', () => {
    const depth = m.filter((x) => x.group === 'reverb-depth');
    expect(depth).toHaveLength(5);
    expect(depth.every((x) => x.cc.some((c) => c.controller === 80 && c.value === 4))).toBe(true);
    expect(depth.map((x) => x.cc.find((c) => c.controller === 91).value)).toEqual([0, 32, 64, 100, 127]);
  });
  it('reverb type clips cover every device type at level 100', () => {
    const types = m.filter((x) => x.group === 'reverb-type');
    expect(types).toHaveLength(3);
    expect(types.every((x) => x.cc.some((c) => c.controller === 91 && c.value === 100))).toBe(true);
  });
  it('chorus depth clips sweep levelCC 0,64,127 with reverb off', () => {
    const ch = m.filter((x) => x.group === 'chorus-depth');
    expect(ch.map((x) => x.cc.find((c) => c.controller === 93).value)).toEqual([0, 64, 127]);
    expect(ch.every((x) => x.cc.some((c) => c.controller === 91 && c.value === 0))).toBe(true);
  });
  it('instrument clips change the voice (piano -> strings -> piano)', () => {
    const inst = m.filter((x) => x.group === 'instrument');
    expect(inst).toHaveLength(3);
    expect(inst.map((x) => x.voice.pc)).toEqual([0, 48, 0]);
  });
});
