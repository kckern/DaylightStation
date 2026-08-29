import { describe, expect, it, vi } from 'vitest';
import { AutomotiveQueryService } from './AutomotiveQueryService.mjs';
import { AutomotiveCommandService } from './AutomotiveCommandService.mjs';

function fixture() {
  const recordRepository = {
    readVehicle: vi.fn(async (id) => (id === 'car' ? { make: 'Volvo' } : null)),
    listFuelLogs: vi.fn(async () => [{ id: 'fuel-1' }]),
    listServiceRecords: vi.fn(async () => [{ id: 'service-1' }]),
    listDocuments: vi.fn(async () => [{ id: 'document-1' }]),
    deleteFuelLog: vi.fn(async () => true),
    deleteServiceRecord: vi.fn(async () => false),
  };
  const historyRepository = {
    listEvents: vi.fn(async () => [{ event: 'wifi-joined' }]),
  };
  const placeRepository = {
    listPlaces: vi.fn(async () => [{ id: 'home' }]),
    deletePlace: vi.fn(async () => true),
  };
  const useCases = {
    getVehicleOverview: { execute: vi.fn(async () => ({ vehicle: { make: 'Volvo' }, odometerKm: 42 })) },
    listJourneys: { execute: vi.fn(async () => ({ journeys: [] })) },
    getTripDetail: { execute: vi.fn(async () => ({ meta: { id: 'trip-1' } })) },
    getFuelStops: { execute: vi.fn(async () => ({ unlogged: [{ id: 'stop-1' }] })) },
    logFuel: { execute: vi.fn(async (command) => ({ id: 'fuel-2', ...command })) },
    logServiceRecord: { execute: vi.fn(async (command) => ({ id: 'service-2', ...command })) },
    namePlace: { execute: vi.fn(async (command) => ({ id: 'work', ...command })) },
  };
  const container = {
    listVehicleIds: vi.fn(async () => ['car', 'bike']),
    vehicleLabel: vi.fn((id, record) => record?.make || id),
    tankCapacityL: vi.fn(() => 60),
    serviceTypes: ['oil', 'tires'],
    recordRepository,
    historyRepository,
    placeRepository,
    useCases,
  };
  const summarizeFuel = vi.fn(() => ({ mpg: 30 }));
  return {
    container,
    summarizeFuel,
    query: new AutomotiveQueryService({ container, summarizeFuel }),
    commands: new AutomotiveCommandService({ container }),
  };
}

describe('AutomotiveQueryService', () => {
  it('coordinates every automotive read behind semantic query operations', async () => {
    const { container, summarizeFuel, query } = fixture();

    await expect(query.listVehicles()).resolves.toEqual([
      { id: 'car', make: 'Volvo', label: 'Volvo' },
      { id: 'bike', label: 'bike' },
    ]);
    await expect(query.overview('car')).resolves.toEqual({
      vehicle: { make: 'Volvo' }, odometerKm: 42, label: 'Volvo',
    });
    await expect(query.journeys({ vehicleId: 'car' })).resolves.toEqual({ journeys: [] });
    await expect(query.tripDetail({ vehicleId: 'car', file: 'trip.yml' })).resolves.toEqual({
      meta: { id: 'trip-1' },
    });
    await expect(query.events('car', { events: ['wifi-joined'] })).resolves.toEqual([
      { event: 'wifi-joined' },
    ]);
    await expect(query.fuel('car')).resolves.toEqual({
      logs: [{ id: 'fuel-1' }], summary: { mpg: 30 }, detected: [{ id: 'stop-1' }],
    });
    expect(container.useCases.getFuelStops.execute).toHaveBeenCalledWith({
      vehicleId: 'car', tankCapacityL: 60,
    });
    expect(summarizeFuel).toHaveBeenCalledWith([{ id: 'fuel-1' }]);
    expect(query.serviceTypes()).toEqual(['oil', 'tires']);
    await expect(query.serviceRecords('car')).resolves.toEqual([{ id: 'service-1' }]);
    await expect(query.documents('car')).resolves.toEqual([{ id: 'document-1' }]);
    await expect(query.places()).resolves.toEqual([{ id: 'home' }]);
  });
});

describe('AutomotiveCommandService', () => {
  it('coordinates hand-authored mutations and explicit deletions', async () => {
    const { container, commands } = fixture();

    await expect(commands.logFuel({ vehicleId: 'car', volume_l: 40 })).resolves.toMatchObject({
      id: 'fuel-2', vehicleId: 'car', volume_l: 40,
    });
    await expect(commands.deleteFuel('car', 'fuel-1')).resolves.toBe(true);
    await expect(commands.logService({ vehicleId: 'car', type: 'oil' })).resolves.toMatchObject({
      id: 'service-2', vehicleId: 'car', type: 'oil',
    });
    await expect(commands.deleteService('car', 'service-1')).resolves.toBe(false);
    await expect(commands.namePlace({ label: 'Work' })).resolves.toEqual({ id: 'work', label: 'Work' });
    await expect(commands.deletePlace('work')).resolves.toBe(true);

    expect(container.recordRepository.deleteFuelLog).toHaveBeenCalledWith('car', 'fuel-1');
    expect(container.recordRepository.deleteServiceRecord).toHaveBeenCalledWith('car', 'service-1');
    expect(container.placeRepository.deletePlace).toHaveBeenCalledWith('work');
  });
});
