// frontend/src/Apps/AutoApp.jsx
//
// The vehicle record system: trips from the OBD relay, plus maintenance, fuel,
// and glove-box records entered by hand.
//
// ## Mobile-first, and why this app in particular
//
// Every other DaylightStation app is a kiosk surface — a wall display, a TV, a
// tablet bolted to a piano. This one gets used in a driveway, at a shop
// counter, or in a parts aisle, one-handed, on a phone. So the base layout is a
// single column with a bottom tab bar (thumb reach), and the desktop layout is
// what widens out of it, rather than a TV layout squeezed down.
//
// Design: docs/_wip/plans/2026-08-12-auto-app-design.md

import { useEffect, useMemo, useState } from 'react';
import {
  useVehicles, useOverview, useJourneys, useFuel, useService, useDocuments, useServiceTypes,
} from '../modules/Auto/useAutoApi.js';
import { Loading, Failed, Empty } from '../modules/Auto/AutoStates.jsx';
import OverviewPanel from '../modules/Auto/OverviewPanel.jsx';
import DrivesPanel from '../modules/Auto/DrivesPanel.jsx';
import FuelPanel from '../modules/Auto/FuelPanel.jsx';
import ServicePanel from '../modules/Auto/ServicePanel.jsx';
import GlovePanel from '../modules/Auto/GlovePanel.jsx';
import autoLog from '../modules/Auto/autoLog.js';
import './AutoApp.scss';

const TABS = [
  { id: 'overview', label: 'Car' },
  { id: 'drives', label: 'Drives' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'service', label: 'Service' },
  { id: 'glove', label: 'Docs' },
];

export default function AutoApp() {
  const [tab, setTab] = useState('overview');
  const [vehicleId, setVehicleId] = useState(null);
  const [includeShuffles, setIncludeShuffles] = useState(false);

  const vehicles = useVehicles();
  const serviceTypes = useServiceTypes();

  // With exactly one vehicle the garage screen is a list of one, which is a
  // pointless tap — so it's skipped. With two or more it becomes the landing
  // screen. Same code path either way; nothing assumes a single car.
  useEffect(() => {
    const all = vehicles.data?.vehicles;
    if (!vehicleId && all?.length === 1) setVehicleId(all[0].id);
  }, [vehicles.data, vehicleId]);

  useEffect(() => {
    autoLog.info('app.mounted', {});
    return () => autoLog.info('app.unmounted', {});
  }, []);

  useEffect(() => {
    if (vehicleId) autoLog.debug('vehicle.selected', { vehicleId });
  }, [vehicleId]);

  const overview = useOverview(vehicleId);
  const journeys = useJourneys(vehicleId, { includeShuffles });
  const fuel = useFuel(vehicleId);
  const service = useService(vehicleId);
  const documents = useDocuments(vehicleId);

  const vehicleLabel = useMemo(() => {
    const found = vehicles.data?.vehicles?.find((v) => v.id === vehicleId);
    return found?.label || overview.data?.label || vehicleId || 'Vehicle';
  }, [vehicles.data, vehicleId, overview.data]);

  // A reload after a write must refresh the overview too — logging a fill-up
  // changes the odometer anchor and the economy summary, both of which live on
  // a different tab than the form that changed them.
  const reloadAll = () => {
    overview.reload();
    fuel.reload();
    service.reload();
  };

  if (vehicles.loading) return <Loading label="Loading garage" />;
  if (vehicles.error) return <Failed error={vehicles.error} onRetry={vehicles.reload} />;
  if (!vehicles.data?.vehicles?.length) {
    return (
      <div className="auto-app">
        <Empty
          title="No vehicles yet"
          detail="A vehicle appears here once the in-car device uploads a trip, or once records are added under household/automotive/."
        />
      </div>
    );
  }

  if (!vehicleId) {
    return (
      <Garage
        vehicles={vehicles.data.vehicles}
        onPick={(id) => { setVehicleId(id); autoLog.debug('garage.picked', { vehicleId: id }); }}
      />
    );
  }

  return (
    <div className="auto-app">
      <header className="auto-header">
        <div className="auto-header__identity">
          {vehicles.data.vehicles.length > 1 && (
            <button
              type="button"
              className="auto-header__back"
              onClick={() => setVehicleId(null)}
              aria-label="Back to garage"
            >
              ‹
            </button>
          )}
          <h1 className="auto-header__title">{vehicleLabel}</h1>
        </div>
      </header>

      <main className="auto-main">
        {tab === 'overview' && (
          <OverviewPanel
            overview={overview.data}
            loading={overview.loading}
            error={overview.error}
            onReload={overview.reload}
            onGoTo={setTab}
            vehicleDescription={describeVehicle(overview.data?.vehicle)}
          />
        )}
        {tab === 'drives' && (
          <DrivesPanel
            vehicleId={vehicleId}
            journeys={journeys.data?.journeys}
            hidden={journeys.data?.hidden || 0}
            fuelLogs={fuel.data?.logs}
            loading={journeys.loading}
            error={journeys.error}
            onReload={journeys.reload}
            onFuelLogged={() => { fuel.reload(); overview.reload(); }}
            includeShuffles={includeShuffles}
            onToggleShuffles={() => setIncludeShuffles((v) => !v)}
          />
        )}
        {tab === 'fuel' && (
          <FuelPanel
            vehicleId={vehicleId}
            fuel={fuel.data}
            loading={fuel.loading}
            error={fuel.error}
            onReload={() => { fuel.reload(); reloadAll(); }}
          />
        )}
        {tab === 'service' && (
          <ServicePanel
            vehicleId={vehicleId}
            service={service.data}
            reminders={overview.data?.reminders}
            serviceTypes={serviceTypes.data?.types}
            loading={service.loading}
            error={service.error}
            onReload={() => { service.reload(); reloadAll(); }}
          />
        )}
        {tab === 'glove' && (
          <GlovePanel
            documents={documents.data}
            reminders={overview.data?.reminders}
            loading={documents.loading}
            error={documents.error}
            onReload={documents.reload}
          />
        )}
      </main>

      <nav className="auto-tabs" aria-label="Sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`auto-tabs__tab${tab === entry.id ? ' auto-tabs__tab--active' : ''}`}
            aria-current={tab === entry.id ? 'page' : undefined}
            onClick={() => { setTab(entry.id); autoLog.debug('tab.changed', { tab: entry.id }); }}
          >
            {entry.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * `2021 Chrysler Pacifica Touring L`, from the vehicle record's identity block.
 * Returns null rather than an empty string so callers can skip the element.
 */
export function describeVehicle(vehicle) {
  const id = vehicle?.identity || vehicle || {};
  const text = [id.year, id.make, id.model, id.series].filter(Boolean).join(' ');
  return text || null;
}

/**
 * The garage: every vehicle the household has records or history for.
 *
 * Shown only when there is more than one, so a single-car household never taps
 * through a list of one. The structure exists regardless, which is what makes
 * adding a second car — or keeping a sold one — additive rather than a rewrite.
 */
function Garage({ vehicles, onPick }) {
  return (
    <div className="auto-app">
      <header className="auto-header">
        <div className="auto-header__identity">
          <h1 className="auto-header__title">Garage</h1>
        </div>
      </header>
      <main className="auto-main">
        <ul className="auto-list">
          {vehicles.map((vehicle) => (
            <li key={vehicle.id} className="auto-doc">
              <button type="button" className="auto-doc__link auto-garage__pick" onClick={() => onPick(vehicle.id)}>
                <span className="auto-doc__label">{vehicle.label || vehicle.id}</span>
                {describeVehicle(vehicle) && (
                  <span className="auto-doc__kind">{describeVehicle(vehicle)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
