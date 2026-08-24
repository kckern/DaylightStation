/**
 * The vehicle's home screen: what it is, what it last reported, how far it has
 * gone, what it costs to feed, and what needs attention.
 *
 * This use case is where the mileage ladder is actually assembled — dash
 * anchors come from hand-entered records, the 0x31 counter series comes from
 * device history, and `OdometerService` reconciles them. Neither repository
 * knows about the other; that join is application work.
 *
 * @module automotive/usecases/GetVehicleOverview
 */

import { OdometerReading } from '#domains/automotive/value-objects/OdometerReading.mjs';
import { estimateOdometer } from '#domains/automotive/services/OdometerService.mjs';
import { summarizeFuel } from '#domains/automotive/services/FuelEconomyService.mjs';
import { buildReminders } from '#domains/automotive/services/ReminderService.mjs';

export class GetVehicleOverview {
  #historyRepository;
  #recordRepository;
  #logger;

  constructor({ historyRepository, recordRepository, logger = console }) {
    if (!historyRepository) throw new Error('GetVehicleOverview requires historyRepository');
    if (!recordRepository) throw new Error('GetVehicleOverview requires recordRepository');
    this.#historyRepository = historyRepository;
    this.#recordRepository = recordRepository;
    this.#logger = logger;
  }

  /**
   * @param {object} input
   * @param {string} input.vehicleId
   * @param {Date} [input.now]
   * @returns {Promise<object>}
   */
  async execute({ vehicleId, now = new Date() }) {
    const [vehicle, serviceRecords, fuelLogs, documents, snapshot, descriptors] = await Promise.all([
      this.#recordRepository.readVehicle(vehicleId),
      this.#recordRepository.listServiceRecords(vehicleId),
      this.#recordRepository.listFuelLogs(vehicleId),
      this.#recordRepository.listDocuments(vehicleId),
      this.#historyRepository.readLatestSnapshot(vehicleId),
      this.#historyRepository.listTripDescriptors(vehicleId, { withFixes: true }),
    ]);

    let odometer = estimateOdometer({
      anchors: collectAnchors({ fuelLogs, serviceRecords }),
      counterReadings: collectCounterReadings(descriptors),
      fallbackDistanceKm: null,
      at: now,
    });
    // PID A6 is an absolute odometer, but manufacturers vary in availability
    // and scaling. It becomes authoritative only after a one-time comparison
    // against the dashboard is recorded in vehicle.yml.
    if (vehicle?.odometer?.pid_a6_verified === true) {
      const direct = latestDirectOdometer(descriptors, now);
      if (direct) {
        odometer = {
          km: direct.km, source: 'pid_a6', confidence: 'exact', anchor: null,
          accumulatedKm: 0, unmeasuredSpans: [], observedAt: direct.at,
        };
      }
    }

    const fuel = summarizeFuel(fuelLogs);
    const reminders = buildReminders({ serviceRecords, documents, asOf: now });

    const lifetime = descriptors.reduce((sum, d) => sum + (d.distanceKm || 0), 0);

    this.#logger.debug?.('automotive.overview.built', {
      vehicleId,
      trips: descriptors.length,
      odometerConfidence: odometer.confidence,
      reminders: reminders.length,
    });

    return {
      vehicle_id: vehicleId,
      vehicle: vehicle || null,
      odometer: {
        km: odometer.km,
        source: odometer.source,
        confidence: odometer.confidence,
        anchored_at: odometer.anchor
          ? odometer.anchor.observedAt.toISOString()
          : (odometer.observedAt?.toISOString() || null),
        accumulated_km: odometer.accumulatedKm,
        unmeasured_spans: odometer.unmeasuredSpans.length,
      },
      // Distance the device actually recorded, which is NOT the odometer: it
      // starts when the device was installed and misses whatever the standby
      // interval slept through. Presented as its own figure rather than folded
      // into the odometer, so neither number pretends to be the other.
      recorded_distance_km: round(lifetime, 1),
      trip_count: descriptors.length,
      last_seen: snapshot?.ts || null,
      last_snapshot: snapshot ? {
        battery_v: snapshot.battery_v ?? null,
        fuel_pct: snapshot.fuel_pct ?? null,
        coolant_c: snapshot.coolant_c ?? null,
        dtc: Array.isArray(snapshot.dtc) ? snapshot.dtc : [],
        gps: snapshot.gps || null,
      } : null,
      fuel,
      reminders,
      counts: {
        service_records: serviceRecords.length,
        fuel_logs: fuelLogs.length,
        documents: documents.length,
      },
    };
  }
}

function latestDirectOdometer(descriptors, asOf) {
  const readings = [];
  for (const d of descriptors) {
    if (Number.isFinite(d.odometerStartKm) && d.startedAt instanceof Date) {
      readings.push({ km: d.odometerStartKm, at: d.startedAt });
    }
    if (Number.isFinite(d.odometerEndKm) && d.endedAt instanceof Date) {
      readings.push({ km: d.odometerEndKm, at: d.endedAt });
    }
  }
  return readings
    .filter((r) => !(asOf instanceof Date) || r.at <= asOf)
    .sort((a, b) => b.at - a.at)[0] || null;
}

/**
 * Every hand-entered dash reading, from whichever record carried it.
 *
 * Fill-ups are the main source — you are already at the car with the number in
 * front of you — but a service invoice records mileage too, and both are
 * equally authoritative, so both anchor.
 */
function collectAnchors({ fuelLogs, serviceRecords }) {
  const anchors = [];
  const add = (km, date) => {
    if (!Number.isFinite(km) || km === null) return;
    try {
      anchors.push(new OdometerReading({ km, source: 'dash', observedAt: date }));
    } catch { /* a malformed reading anchors nothing; the estimate degrades honestly */ }
  };
  for (const log of fuelLogs) add(log.odometerKm, log.date);
  for (const record of serviceRecords) add(record.odometerKm, record.date);
  return anchors;
}

/**
 * The 0x31 counter series, flattened from per-trip start/end readings.
 *
 * Absent until the firmware change ships — `collectCounterReadings` returning
 * an empty array is the expected state today, and `estimateOdometer` falls back
 * to reporting the latest dash anchor as exact.
 */
function collectCounterReadings(descriptors) {
  const readings = [];
  for (const descriptor of descriptors) {
    if (Number.isFinite(descriptor.counterStartKm) && descriptor.startedAt instanceof Date) {
      readings.push({ km: descriptor.counterStartKm, at: descriptor.startedAt });
    }
    if (Number.isFinite(descriptor.counterEndKm) && descriptor.endedAt instanceof Date) {
      readings.push({ km: descriptor.counterEndKm, at: descriptor.endedAt });
    }
  }
  return readings.sort((a, b) => a.at - b.at);
}

const round = (n, places) => Number(n.toFixed(places));
