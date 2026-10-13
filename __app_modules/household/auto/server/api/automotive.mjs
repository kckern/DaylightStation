import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * Automotive API — the vehicle record system.
 *
 * Thin HTTP layer over semantic automotive queries and commands. No domain logic here:
 * journey stitching, place matching, mileage accumulation, and fuel economy all
 * live in `2_domains/automotive`.
 *
 * Read and write are deliberately asymmetric. Device history is READ-ONLY —
 * there is no route that edits a trip, because a recording is evidence of what
 * the car did and an endpoint that can rewrite it is an endpoint that can lose
 * it. Only hand-authored records (fuel, service, places) accept writes.
 *
 * Routes (mounted at /api/v1/automotive):
 *   GET  /vehicles                          → { vehicles: [{ id, label, ... }] }
 *   GET  /vehicles/:id                      → overview: odometer, last snapshot, fuel, reminders
 *   GET  /vehicles/:id/journeys             → { journeys, hidden }  ?from=&to=&shuffles=1
 *   GET  /vehicles/:id/trip?file=<relPath>  → full recording: meta, track, samples
 *   GET  /vehicles/:id/events               → { events }  ?event=harsh-motion
 *   GET  /vehicles/:id/fuel                 → { logs, summary, detected }
 *   POST /vehicles/:id/fuel                 → the created/updated fill-up
 *   GET  /service-types                     → { types } (config-driven vocabulary)
 *   GET  /vehicles/:id/service              → { records }
 *   POST /vehicles/:id/service              → the created/updated service record
 *   GET  /vehicles/:id/documents            → { documents }
 *   GET  /places                            → { places }
 *   POST /places                            → the created/updated place
 *
 * Domain errors (ValidationError → 400, EntityNotFoundError → 404) are shaped
 * by errorHandlerMiddleware({ shape: 'string' }).
 */
export function createAutomotiveRouter({ automotiveQuery, automotiveCommands, logger = console }) {
  if (!automotiveQuery) throw new Error('createAutomotiveRouter requires automotiveQuery');
  if (!automotiveCommands) throw new Error('createAutomotiveRouter requires automotiveCommands');
  const router = express.Router();

  router.get('/vehicles', asyncHandler(async (req, res) => {
    res.json({ vehicles: await automotiveQuery.listVehicles() });
  }));

  router.get('/vehicles/:id', asyncHandler(async (req, res) => {
    res.json(await automotiveQuery.overview(req.params.id));
  }));

  router.get('/vehicles/:id/journeys', asyncHandler(async (req, res) => {
    res.json(await automotiveQuery.journeys({
      vehicleId: req.params.id,
      from: parseDate(req.query.from),
      to: parseDate(req.query.to),
      // Garage shuffles and ignition blips are hidden unless asked for.
      includeShuffles: isTruthy(req.query.shuffles),
    }));
  }));

  router.get('/vehicles/:id/trip', asyncHandler(async (req, res) => {
    res.json(await automotiveQuery.tripDetail({
      vehicleId: req.params.id,
      file: String(req.query.file || ''),
    }));
  }));

  // Device events straight from the day logs — wifi-joined, trip-dropped, and
  // harsh-motion. These record what happened BETWEEN trips, which is where
  // refuelling, code-clearing and rough driving actually live.
  router.get('/vehicles/:id/events', asyncHandler(async (req, res) => {
    const events = await automotiveQuery.events(req.params.id, {
      from: parseDate(req.query.from),
      to: parseDate(req.query.to),
      events: req.query.event ? String(req.query.event).split(',') : null,
    });
    res.json({ events: events.map(({ at, ...rest }) => rest) });
  }));

  router.get('/vehicles/:id/fuel', asyncHandler(async (req, res) => {
    const fuel = await automotiveQuery.fuel(req.params.id);
    res.json({
      ...fuel,
      logs: fuel.logs.map(presentFuelLog),
    });
  }));

  router.post('/vehicles/:id/fuel', asyncHandler(async (req, res) => {
    const log = await automotiveCommands.logFuel({ vehicleId: req.params.id, ...(req.body || {}) });
    res.json(presentFuelLog(log));
  }));

  router.delete('/vehicles/:id/fuel/:logId', asyncHandler(async (req, res) => {
    res.json({ deleted: await automotiveCommands.deleteFuel(req.params.id, req.params.logId) });
  }));

  // The maintenance vocabulary, so the form's options come from config rather
  // than from a list hardcoded in the frontend.
  router.get('/service-types', asyncHandler(async (req, res) => {
    res.json({ types: automotiveQuery.serviceTypes() });
  }));

  router.get('/vehicles/:id/service', asyncHandler(async (req, res) => {
    const records = await automotiveQuery.serviceRecords(req.params.id);
    res.json({ records: records.map(presentServiceRecord) });
  }));

  router.post('/vehicles/:id/service', asyncHandler(async (req, res) => {
    const record = await automotiveCommands.logService({ vehicleId: req.params.id, ...(req.body || {}) });
    res.json(presentServiceRecord(record));
  }));

  router.delete('/vehicles/:id/service/:recordId', asyncHandler(async (req, res) => {
    res.json({ deleted: await automotiveCommands.deleteService(req.params.id, req.params.recordId) });
  }));

  router.get('/vehicles/:id/documents', asyncHandler(async (req, res) => {
    const documents = await automotiveQuery.documents(req.params.id);
    res.json({ documents: documents.map(presentDocument) });
  }));

  // Places are household-scoped, not per-vehicle: home and school do not change
  // when the car does.
  router.get('/places', asyncHandler(async (req, res) => {
    const places = await automotiveQuery.places();
    res.json({ places: places.map(presentPlace) });
  }));

  router.post('/places', asyncHandler(async (req, res) => {
    const place = await automotiveCommands.namePlace({ ...(req.body || {}) });
    res.json(presentPlace(place));
  }));

  router.delete('/places/:placeId', asyncHandler(async (req, res) => {
    res.json({ deleted: await automotiveCommands.deletePlace(req.params.placeId) });
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));

  logger.info?.('automotive.router.ready');
  return router;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

const isTruthy = (v) => v === '1' || v === 'true' || v === true;

function presentFuelLog(log) {
  return {
    id: log.id,
    date: log.date.toISOString().slice(0, 10),
    odometer_km: log.odometerKm,
    volume_l: log.volumeL,
    price_total: log.priceTotal,
    price_per_litre: log.pricePerLitre,
    place: log.placeId,
    partial: log.partial,
    notes: log.notes,
  };
}

function presentServiceRecord(record) {
  return {
    id: record.id,
    date: record.date.toISOString().slice(0, 10),
    type: record.type,
    vendor: record.vendor,
    cost: record.cost,
    odometer_km: record.odometerKm,
    interval_months: record.intervalMonths,
    interval_km: record.intervalKm,
    notes: record.notes,
    attachments: record.attachments,
  };
}

function presentDocument(document) {
  return {
    id: document.id,
    kind: document.kind,
    label: document.label,
    file: document.file,
    issued: document.issued?.toISOString().slice(0, 10) ?? null,
    expires: document.expires?.toISOString().slice(0, 10) ?? null,
    notes: document.notes,
  };
}

function presentPlace(place) {
  return {
    id: place.id,
    label: place.label,
    lat: place.fix.lat,
    lon: place.fix.lon,
    radius_m: place.radiusM,
    kind: place.kind,
  };
}

export default createAutomotiveRouter;
