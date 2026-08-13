import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * Automotive API — the vehicle record system.
 *
 * Thin HTTP layer over `AutomotiveContainer`'s use cases. No domain logic here:
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
export function createAutomotiveRouter({ automotiveContainer, logger = console }) {
  if (!automotiveContainer) throw new Error('createAutomotiveRouter requires automotiveContainer');
  const router = express.Router();
  const { useCases, recordRepository, placeRepository } = automotiveContainer;

  router.get('/vehicles', asyncHandler(async (req, res) => {
    const ids = await automotiveContainer.listVehicleIds();
    const vehicles = await Promise.all(ids.map(async (id) => {
      const record = await recordRepository.readVehicle(id);
      return { ...(record || {}), id, label: automotiveContainer.vehicleLabel(id, record) };
    }));
    res.json({ vehicles });
  }));

  router.get('/vehicles/:id', asyncHandler(async (req, res) => {
    const overview = await useCases.getVehicleOverview.execute({ vehicleId: req.params.id });
    res.json({ ...overview, label: automotiveContainer.vehicleLabel(req.params.id, overview.vehicle) });
  }));

  router.get('/vehicles/:id/journeys', asyncHandler(async (req, res) => {
    res.json(await useCases.listJourneys.execute({
      vehicleId: req.params.id,
      from: parseDate(req.query.from),
      to: parseDate(req.query.to),
      // Garage shuffles and ignition blips are hidden unless asked for.
      includeShuffles: isTruthy(req.query.shuffles),
    }));
  }));

  router.get('/vehicles/:id/trip', asyncHandler(async (req, res) => {
    res.json(await useCases.getTripDetail.execute({
      vehicleId: req.params.id,
      file: String(req.query.file || ''),
    }));
  }));

  router.get('/vehicles/:id/fuel', asyncHandler(async (req, res) => {
    const [logs, stops] = await Promise.all([
      recordRepository.listFuelLogs(req.params.id),
      // Fill-ups the CAR noticed — a rise in fuel level between trips — that
      // have no logged entry. Detection needs no place registry; a known place
      // only labels the result.
      useCases.getFuelStops.execute({
        vehicleId: req.params.id,
        tankCapacityL: automotiveContainer.tankCapacityL(req.params.id),
      }),
    ]);
    const { summarizeFuel } = await import('#domains/automotive/services/FuelEconomyService.mjs');
    res.json({
      logs: logs.map((l) => l.toJSON()),
      summary: summarizeFuel(logs),
      detected: stops.unlogged,
    });
  }));

  router.post('/vehicles/:id/fuel', asyncHandler(async (req, res) => {
    const log = await useCases.logFuel.execute({ vehicleId: req.params.id, ...(req.body || {}) });
    res.json(log.toJSON());
  }));

  router.delete('/vehicles/:id/fuel/:logId', asyncHandler(async (req, res) => {
    res.json({ deleted: await recordRepository.deleteFuelLog(req.params.id, req.params.logId) });
  }));

  // The maintenance vocabulary, so the form's options come from config rather
  // than from a list hardcoded in the frontend.
  router.get('/service-types', asyncHandler(async (req, res) => {
    res.json({ types: automotiveContainer.serviceTypes });
  }));

  router.get('/vehicles/:id/service', asyncHandler(async (req, res) => {
    const records = await recordRepository.listServiceRecords(req.params.id);
    res.json({ records: records.map((r) => r.toJSON()) });
  }));

  router.post('/vehicles/:id/service', asyncHandler(async (req, res) => {
    const record = await useCases.logServiceRecord.execute({ vehicleId: req.params.id, ...(req.body || {}) });
    res.json(record.toJSON());
  }));

  router.delete('/vehicles/:id/service/:recordId', asyncHandler(async (req, res) => {
    res.json({ deleted: await recordRepository.deleteServiceRecord(req.params.id, req.params.recordId) });
  }));

  router.get('/vehicles/:id/documents', asyncHandler(async (req, res) => {
    const documents = await recordRepository.listDocuments(req.params.id);
    res.json({ documents: documents.map((d) => d.toJSON()) });
  }));

  // Places are household-scoped, not per-vehicle: home and school do not change
  // when the car does.
  router.get('/places', asyncHandler(async (req, res) => {
    const places = await placeRepository.listPlaces();
    res.json({ places: places.map((p) => p.toJSON()) });
  }));

  router.post('/places', asyncHandler(async (req, res) => {
    const place = await useCases.namePlace.execute({ ...(req.body || {}) });
    res.json(place.toJSON());
  }));

  router.delete('/places/:placeId', asyncHandler(async (req, res) => {
    res.json({ deleted: await placeRepository.deletePlace(req.params.placeId) });
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

export default createAutomotiveRouter;
