// tests/unit/domains/automotive/fuelAndReminders.test.mjs
//
// Fuel economy is only knowable between two FULL tanks — that is the one pair
// of moments where the tank state is identical at both ends, so everything
// pumped in between was burned in between. This suite pins that method, pins
// the refusal to report economy before two qualifying fill-ups exist, and pins
// the reminder list's merging of service intervals with document expiries.

import { describe, it, expect } from 'vitest';
import { FuelLog } from '#domains/automotive/entities/FuelLog.mjs';
import { ServiceRecord, addMonths } from '#domains/automotive/entities/ServiceRecord.mjs';
import { Document } from '#domains/automotive/entities/Document.mjs';
import { computeEconomyIntervals, summarizeFuel } from '#domains/automotive/services/FuelEconomyService.mjs';
import { buildReminders } from '#domains/automotive/services/ReminderService.mjs';

const at = (iso) => new Date(iso);

const fill = (overrides = {}) => new FuelLog({
  id: overrides.id || `fill-${overrides.odometerKm ?? 0}`,
  date: at(overrides.date || '2026-08-01T00:00:00Z'),
  odometerKm: overrides.odometerKm ?? null,
  volumeL: overrides.volumeL ?? 50,
  priceTotal: overrides.priceTotal ?? null,
  partial: overrides.partial ?? false,
});

describe('FuelLog', () => {
  it('derives price per litre rather than storing it', () => {
    const log = fill({ volumeL: 50, priceTotal: 60 });
    expect(log.pricePerLitre).toBe(1.2);
  });

  it('cannot close an interval without a full tank', () => {
    expect(fill({ odometerKm: 1000, partial: true }).canCloseInterval).toBe(false);
  });

  it('cannot close an interval without an odometer reading', () => {
    expect(fill({ odometerKm: null, partial: false }).canCloseInterval).toBe(false);
  });

  it('rejects a non-positive volume', () => {
    expect(() => fill({ volumeL: 0 })).toThrow(/volume/i);
  });
});

describe('computeEconomyIntervals', () => {
  it('reports nothing until two qualifying fill-ups exist', () => {
    expect(computeEconomyIntervals([])).toEqual([]);
    expect(computeEconomyIntervals([fill({ odometerKm: 1000 })])).toEqual([]);
  });

  it('measures distance and fuel between consecutive full tanks', () => {
    const intervals = computeEconomyIntervals([
      fill({ id: 'a', date: '2026-07-01T00:00:00Z', odometerKm: 1000, volumeL: 40 }),
      fill({ id: 'b', date: '2026-07-15T00:00:00Z', odometerKm: 1500, volumeL: 50 }),
    ]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].distanceKm).toBe(500);
    // Only the CLOSING fill's volume counts — the opening fill made the tank
    // full at the start, it was not burned after.
    expect(intervals[0].volumeL).toBe(50);
    expect(intervals[0].kmPerLitre).toBe(10);
  });

  it('rolls a partial fill into the enclosing interval', () => {
    const intervals = computeEconomyIntervals([
      fill({ id: 'a', date: '2026-07-01T00:00:00Z', odometerKm: 1000, volumeL: 40 }),
      fill({ id: 'p', date: '2026-07-08T00:00:00Z', odometerKm: 1200, volumeL: 20, partial: true }),
      fill({ id: 'b', date: '2026-07-15T00:00:00Z', odometerKm: 1600, volumeL: 40 }),
    ]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].distanceKm).toBe(600);
    // The partial's 20 L was still burned inside the interval.
    expect(intervals[0].volumeL).toBe(60);
  });

  it('skips an interval whose odometer did not advance', () => {
    // A mistyped reading must not produce a negative or infinite economy figure.
    const intervals = computeEconomyIntervals([
      fill({ id: 'a', date: '2026-07-01T00:00:00Z', odometerKm: 2000, volumeL: 40 }),
      fill({ id: 'b', date: '2026-07-15T00:00:00Z', odometerKm: 1500, volumeL: 50 }),
      fill({ id: 'c', date: '2026-07-29T00:00:00Z', odometerKm: 2000, volumeL: 45 }),
    ]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].distanceKm).toBe(500);
  });
});

describe('summarizeFuel', () => {
  it('flags needsMoreData and still reports spend with one fill-up', () => {
    const summary = summarizeFuel([fill({ odometerKm: 1000, volumeL: 40, priceTotal: 50 })]);
    expect(summary.needsMoreData).toBe(true);
    expect(summary.avgMpg).toBeNull();
    expect(summary.totalSpend).toBe(50);
    expect(summary.totalVolumeL).toBe(40);
  });

  it('weights the lifetime average by distance, not by interval count', () => {
    // A short thirsty tank and a long efficient one. A naive mean of the two
    // per-interval MPGs would overweight the short one.
    const summary = summarizeFuel([
      fill({ id: 'a', date: '2026-07-01T00:00:00Z', odometerKm: 0, volumeL: 10 }),
      fill({ id: 'b', date: '2026-07-05T00:00:00Z', odometerKm: 50, volumeL: 10 }),
      fill({ id: 'c', date: '2026-07-20T00:00:00Z', odometerKm: 1050, volumeL: 50 }),
    ]);
    expect(summary.needsMoreData).toBe(false);
    // Distance-weighted: 1050 km on 60 L total.
    const expected = (1050 / 1.609344) / (60 / 3.785411784);
    expect(summary.avgMpg).toBeCloseTo(expected, 1);
    // The naive mean of 5 km/L and 20 km/L would be far higher.
    expect(summary.avgMpg).toBeLessThan(summary.bestMpg);
  });
});

describe('addMonths', () => {
  it('clamps the day instead of rolling into the next month', () => {
    // Naive setMonth would turn 31 January into 3 March.
    expect(addMonths(new Date(2026, 0, 31), 1).getMonth()).toBe(1);
    expect(addMonths(new Date(2026, 0, 31), 1).getDate()).toBe(28);
  });

  it('handles a normal interval', () => {
    const due = addMonths(new Date(2026, 2, 14), 6);
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(8);
    expect(due.getDate()).toBe(14);
  });
});

describe('buildReminders', () => {
  const service = (props) => new ServiceRecord({ vendor: null, ...props });

  it('derives the next due date from the most recent record of each type', () => {
    const reminders = buildReminders({
      serviceRecords: [
        service({ id: 'old', date: new Date(2025, 0, 1), type: 'oil-change', intervalMonths: 6 }),
        service({ id: 'new', date: new Date(2026, 5, 1), type: 'oil-change', intervalMonths: 6 }),
      ],
      asOf: new Date(2026, 7, 12),
    });
    // One oil-change reminder, not two — and dated from the newer record.
    expect(reminders).toHaveLength(1);
    expect(reminders[0].sourceId).toBe('new');
    expect(reminders[0].dueDate.getMonth()).toBe(11); // June + 6 months
  });

  it('ignores one-off records with no interval', () => {
    const reminders = buildReminders({
      serviceRecords: [service({ id: 'x', date: new Date(2026, 5, 1), type: 'windshield' })],
      asOf: new Date(2026, 7, 12),
    });
    expect(reminders).toEqual([]);
  });

  it('ignores a km-only interval until mileage lands', () => {
    const reminders = buildReminders({
      serviceRecords: [service({ id: 'x', date: new Date(2026, 5, 1), type: 'tires', intervalKm: 10000, odometerKm: 41000 })],
      asOf: new Date(2026, 7, 12),
    });
    expect(reminders).toEqual([]);
  });

  it('merges document expiries into the same list as service intervals', () => {
    const reminders = buildReminders({
      serviceRecords: [service({ id: 's', date: new Date(2026, 5, 1), type: 'oil-change', intervalMonths: 6 })],
      documents: [new Document({ id: 'reg', kind: 'registration', label: 'Registration', expires: new Date(2026, 8, 30) })],
      asOf: new Date(2026, 7, 12),
    });
    expect(reminders).toHaveLength(2);
    expect(reminders.map((r) => r.kind).sort()).toEqual(['document', 'service']);
    // Soonest first: registration (Sept 30) before oil change (Dec 1).
    expect(reminders[0].kind).toBe('document');
  });

  it('classifies overdue, due-soon, and ok', () => {
    const asOf = new Date(2026, 7, 12);
    const reminders = buildReminders({
      documents: [
        new Document({ id: 'past', kind: 'registration', label: 'Expired', expires: new Date(2026, 6, 1) }),
        new Document({ id: 'soon', kind: 'insurance', label: 'Soon', expires: new Date(2026, 7, 20) }),
        new Document({ id: 'later', kind: 'inspection', label: 'Later', expires: new Date(2027, 0, 1) }),
      ],
      asOf,
      dueSoonDays: 30,
    });
    const byId = Object.fromEntries(reminders.map((r) => [r.sourceId, r]));
    expect(byId.past.status).toBe('overdue');
    expect(byId.past.daysUntilDue).toBeLessThan(0);
    expect(byId.soon.status).toBe('due-soon');
    expect(byId.later.status).toBe('ok');
  });

  it('reads a same-day due date as 0 days rather than overdue', () => {
    const reminders = buildReminders({
      documents: [new Document({ id: 'today', kind: 'registration', label: 'Today', expires: new Date(2026, 7, 12) })],
      asOf: new Date(2026, 7, 12, 23, 59),
    });
    expect(reminders[0].daysUntilDue).toBe(0);
    expect(reminders[0].status).toBe('due-soon');
  });
});
