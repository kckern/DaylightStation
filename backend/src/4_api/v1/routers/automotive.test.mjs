import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAutomotiveRouter } from './automotive.mjs';

const day = new Date('2026-08-20T00:00:00.000Z');
const fuel = { id: 'fuel-1', date: day, odometerKm: 123, volumeL: 40, priceTotal: 70,
  pricePerLitre: 1.75, placeId: 'home', partial: false, notes: 'full' };
const service = { id: 'svc-1', date: day, type: 'oil', vendor: 'Shop', cost: 80,
  odometerKm: 123, intervalMonths: 6, intervalKm: 8000, notes: null, attachments: [] };
const document = { id: 'doc-1', kind: 'registration', label: 'Registration', file: 'reg.pdf',
  issued: day, expires: null, notes: null };
const place = { id: 'home', label: 'Home', fix: { lat: 1, lon: 2 }, radiusM: 50, kind: 'home' };

function fixture() {
  const automotiveQuery = {
    listVehicles: vi.fn(async () => [{ id: 'car', label: 'Car' }]),
    overview: vi.fn(async () => ({ vehicle: { id: 'car' }, label: 'Car', odometerKm: 123 })),
    journeys: vi.fn(async () => ({ journeys: [{ id: 'j1' }], hidden: 1 })),
    tripDetail: vi.fn(async () => ({ meta: { id: 'trip' }, track: [] })),
    events: vi.fn(async () => [{ at: day, event: 'harsh-motion', severity: 2 }]),
    fuel: vi.fn(async () => ({ logs: [fuel], summary: { mpg: 30 }, detected: [{ at: 't' }] })),
    serviceTypes: vi.fn(() => ['oil']),
    serviceRecords: vi.fn(async () => [service]),
    documents: vi.fn(async () => [document]),
    places: vi.fn(async () => [place]),
  };
  const automotiveCommands = {
    logFuel: vi.fn(async () => fuel), deleteFuel: vi.fn(async () => true),
    logService: vi.fn(async () => service), deleteService: vi.fn(async () => true),
    namePlace: vi.fn(async () => place), deletePlace: vi.fn(async () => true),
  };
  const app = express();
  app.use(express.json());
  app.use('/automotive', createAutomotiveRouter({ automotiveQuery, automotiveCommands, logger: { info() {} } }));
  return { app, automotiveQuery, automotiveCommands };
}

describe('Automotive semantic API boundary', () => {
  it('preserves read envelopes, presenters, and query coercion', async () => {
    const { app, automotiveQuery } = fixture();
    expect((await request(app).get('/automotive/vehicles')).body).toEqual({ vehicles: [{ id: 'car', label: 'Car' }] });
    expect((await request(app).get('/automotive/vehicles/car')).body).toMatchObject({ label: 'Car', odometerKm: 123 });
    expect((await request(app).get('/automotive/vehicles/car/journeys?from=2026-08-01&to=nope&shuffles=1')).body)
      .toEqual({ journeys: [{ id: 'j1' }], hidden: 1 });
    expect(automotiveQuery.journeys).toHaveBeenCalledWith(expect.objectContaining({
      vehicleId: 'car', from: expect.any(Date), to: null, includeShuffles: true,
    }));
    expect((await request(app).get('/automotive/vehicles/car/trip?file=2026/day.yml')).body.meta.id).toBe('trip');
    expect((await request(app).get('/automotive/vehicles/car/events')).body).toEqual({
      events: [{ event: 'harsh-motion', severity: 2 }],
    });
    const fuelResponse = await request(app).get('/automotive/vehicles/car/fuel');
    expect(fuelResponse.body).toMatchObject({ logs: [{ id: 'fuel-1', date: '2026-08-20', odometer_km: 123 }],
      summary: { mpg: 30 }, detected: [{ at: 't' }] });
    expect((await request(app).get('/automotive/service-types')).body).toEqual({ types: ['oil'] });
    expect((await request(app).get('/automotive/vehicles/car/service')).body.records[0])
      .toMatchObject({ id: 'svc-1', date: '2026-08-20', odometer_km: 123 });
    expect((await request(app).get('/automotive/vehicles/car/documents')).body.documents[0])
      .toMatchObject({ id: 'doc-1', issued: '2026-08-20', expires: null });
    expect((await request(app).get('/automotive/places')).body.places[0])
      .toEqual({ id: 'home', label: 'Home', lat: 1, lon: 2, radius_m: 50, kind: 'home' });
  });

  it('preserves command bodies and deletion envelopes', async () => {
    const { app, automotiveCommands } = fixture();
    expect((await request(app).post('/automotive/vehicles/car/fuel').send({ volume_l: 40 })).body)
      .toMatchObject({ id: 'fuel-1', volume_l: 40 });
    expect(automotiveCommands.logFuel).toHaveBeenCalledWith({ vehicleId: 'car', volume_l: 40 });
    expect((await request(app).delete('/automotive/vehicles/car/fuel/fuel-1')).body).toEqual({ deleted: true });
    expect((await request(app).post('/automotive/vehicles/car/service').send({ type: 'oil' })).body)
      .toMatchObject({ id: 'svc-1', type: 'oil' });
    expect((await request(app).delete('/automotive/vehicles/car/service/svc-1')).body).toEqual({ deleted: true });
    expect((await request(app).post('/automotive/places').send({ label: 'Home' })).body)
      .toEqual({ id: 'home', label: 'Home', lat: 1, lon: 2, radius_m: 50, kind: 'home' });
    expect((await request(app).delete('/automotive/places/home')).body).toEqual({ deleted: true });
  });
});
