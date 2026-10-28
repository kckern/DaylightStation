import { describe, it, expect } from 'vitest';
import { IconPropeller, IconBolt, IconBulb, IconDoor, IconDroplet, IconPlug, IconPoint, IconTemperature, IconWindow } from '@tabler/icons-react';
import { squareTone, isLively, toneFlags } from './squareTone.js';
import { iconFor } from './mosaicIcons.js';

const flags = (o = {}) => ({ stuck: new Set(), lowBattery: new Set(), motion: new Set(), open: new Set(), ...o });
const e = (over) => ({ id: 'x.y', type: 'light', stateClass: 'off', state: 'off', deviceClass: null, unit: null, ...over });
describe('squareTone', () => {
  it('a lit lamp is on; an off one is quiet', () => {
    expect(squareTone(e({ stateClass: 'on' }), flags()).fill).toBe('on');
    expect(squareTone(e({}), flags())).toEqual({ fill: 'quiet', attention: false, tempPct: null });
  });
  it('an open door is open, someone there is motion', () => {
    expect(squareTone(e({ type: 'openings', stateClass: 'on' }), flags()).fill).toBe('open');
    expect(squareTone(e({ id: 'b.m', type: 'presence', stateClass: 'on' }), flags()).fill).toBe('motion');
  });
  it('a stuck sensor is attention ("stuck"), not motion', () => {
    const t = squareTone(e({ id: 'b.m', type: 'presence', stateClass: 'on' }), flags({ stuck: new Set(['b.m']) }));
    expect(t).toMatchObject({ fill: 'quiet', attention: 'stuck' });
  });
  it('attention is graded: a low battery is "battery", a device not answering is the quieter "silent"', () => {
    expect(squareTone(e({ stateClass: 'unavailable' }), flags()).attention).toBe('silent');
    expect(squareTone(e({ id: 's.b', type: 'battery', stateClass: 'reading', state: '9' }), flags({ lowBattery: new Set(['s.b']) })).attention).toBe('battery');
    // Stuck or a low battery outranks not answering: those are the loud ones.
    expect(squareTone(e({ id: 's.b', stateClass: 'unavailable' }), flags({ lowBattery: new Set(['s.b']) })).attention).toBe('battery');
  });
  it('temperature tints from cool to warm, °C converted', () => {
    expect(squareTone(e({ type: 'climate', stateClass: 'reading', state: '70', unit: '°F', deviceClass: 'temperature' }), flags())).toMatchObject({ fill: 'temp', tempPct: 50 });
    expect(squareTone(e({ type: 'climate', stateClass: 'reading', state: '35', unit: '°C', deviceClass: 'temperature' }), flags()).tempPct).toBe(100);
  });
  it('only on, motion and open count as lively', () => {
    expect(['on', 'motion', 'open', 'temp', 'quiet'].map((fill) => isLively({ fill }))).toEqual([true, true, true, false, false]);
  });
  // Beyond the brief's cases: the edges a live house actually produces.
  it('a temperature that is not a number is quiet, never a 0 % tint', () => {
    expect(squareTone(e({ type: 'climate', stateClass: 'reading', state: 'unknown', unit: '°F', deviceClass: 'temperature' }), flags())).toEqual({ fill: 'quiet', attention: false, tempPct: null });
    expect(squareTone(e({ type: 'climate', stateClass: 'reading', state: '', unit: '°F', deviceClass: 'temperature' }), flags()).fill).toBe('quiet');
  });
  it('only a Celsius unit is converted: a unit that merely contains a "c" is not', () => {
    const t = (unit) => squareTone(e({ type: 'climate', stateClass: 'reading', state: '35', unit, deviceClass: 'temperature' }), flags()).tempPct;
    expect(t('°C')).toBe(100);
    expect(t('C')).toBe(100);
    expect(t('℃')).toBe(100);
    const f = (unit) => squareTone(e({ type: 'climate', stateClass: 'reading', state: '70', unit, deviceClass: 'temperature' }), flags()).tempPct;
    expect(f('°F (calc)')).toBe(50);
    expect(f('°F')).toBe(50);
  });
  it('a cold reading clamps to 0 %, and a motion flag lights a sensor that reads clear', () => {
    expect(squareTone(e({ type: 'climate', stateClass: 'reading', state: '40', unit: '°F', deviceClass: 'temperature' }), flags()).tempPct).toBe(0);
    expect(squareTone(e({ id: 'b.m', type: 'presence', stateClass: 'off' }), flags({ motion: new Set(['b.m']) })).fill).toBe('motion');
    expect(squareTone(e({ id: 'c.o', type: 'openings', stateClass: 'off' }), flags({ open: new Set(['c.o']) })).fill).toBe('open');
  });
  it('a reading sensor (power draw) is never "on", even with a state class of on', () => {
    expect(squareTone(e({ type: 'sensor', stateClass: 'on' }), flags()).fill).toBe('quiet');
    expect(squareTone(e({ type: 'switch', stateClass: 'on' }), flags()).fill).toBe('on');
  });
});

describe('toneFlags', () => {
  it('reads the summary lists, whether they hold ids or {entityId}', () => {
    const f = toneFlags({ stuck: ['a.b'], lowBattery: [{ entityId: 'c.d', pct: 9 }], motion: ['e.f'], open: [{ entityId: 'g.h' }] });
    expect([...f.stuck]).toEqual(['a.b']);
    expect([...f.lowBattery]).toEqual(['c.d']);
    expect([...f.motion]).toEqual(['e.f']);
    expect([...f.open]).toEqual(['g.h']);
    expect(toneFlags(undefined).stuck.size).toBe(0);
  });
});

describe('iconFor', () => {
  it('picks the glyph by type, then by domain or device class', () => {
    expect(iconFor({ type: 'light', domain: 'light' })).toBe(IconBulb);
    expect(iconFor({ type: 'power', domain: 'switch' })).toBe(IconPlug);
    expect(iconFor({ type: 'power', domain: 'sensor' })).toBe(IconBolt);
    expect(iconFor({ type: 'openings', deviceClass: 'window' })).toBe(IconWindow);
    expect(iconFor({ type: 'openings', deviceClass: 'door' })).toBe(IconDoor);
    expect(iconFor({ type: 'climate', deviceClass: 'humidity' })).toBe(IconDroplet);
    expect(iconFor({ type: 'climate', deviceClass: 'temperature' })).toBe(IconTemperature);
    expect(iconFor({ type: 'other' })).toBe(IconPoint);
    // A ceiling fan is filed under climate; it is not a thermometer.
    expect(iconFor({ type: 'climate', domain: 'fan', deviceClass: null })).toBe(IconPropeller);
  });
});
