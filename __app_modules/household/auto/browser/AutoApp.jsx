// frontend/src/Apps/AutoApp.jsx
//
// The vehicle record system: trips from the OBD relay, plus maintenance, fuel,
// and glove-box records entered by hand.
//
// ## Mobile-first, and why this app in particular
//
// Every other DaylightStation app is a kiosk surface — a wall display, a TV, a
// tablet bolted to a piano. This one gets used in a driveway, at a shop
// counter, or in a parts aisle, one-handed, on a phone. So AppChrome's bottom
// tab bar (thumb reach) IS the mobile layout, and the desktop rail is what it
// becomes CSS-side, rather than a TV layout squeezed down.
//
// Design: ops:docs/_wip/plans/2026-08-12-auto-app-design.md
// DS migration (Task M2): ops:docs/superpowers/... — pack 'auto' (teal), Roboto
// Condensed kept via an app-level font-family rule (no raw colors) rather
// than a pack `font` field, since AppThemeProvider/createAppTheme don't yet
// read one and a single scoped rule is the smaller, reversible change.

import { useEffect, useMemo, useRef, useState } from 'react';
import '@mantine/core/styles.css';
import { ActionIcon } from '@mantine/core';
import {
  AppThemeProvider, AppChrome, DismissStackProvider, LoadingState, ErrorState, EmptyState, UiIcon, useViewScroll,
} from '@/lib/ui';
import {
  useVehicles, useOverview, useJourneys, useFuel, useService, useDocuments, useServiceTypes,
} from "./useAutoApi.js";
import OverviewPanel from "./OverviewPanel.jsx";
import DrivesPanel from "./DrivesPanel.jsx";
import FuelPanel from "./FuelPanel.jsx";
import ServicePanel from "./ServicePanel.jsx";
import GlovePanel from "./GlovePanel.jsx";
import autoLog from "./autoLog.js";
import { describeVehicle } from "./autoAppVehicleLabel.js";
import "./AutoApp.scss";

const TabIcon = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const TABS = [
  {
    id: 'overview',
    label: 'Car',
    icon: (
      <TabIcon>
        <path d="M3 12l1.3-4.2a2 2 0 011.9-1.4h7.6a2 2 0 011.9 1.4L17 12" />
        <path d="M2.5 12h15v2.5a1 1 0 01-1 1h-1a1 1 0 01-1-1V14h-8v.5a1 1 0 01-1 1h-1a1 1 0 01-1-1V12z" />
        <circle cx="6" cy="14.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="14" cy="14.5" r="1" fill="currentColor" stroke="none" />
      </TabIcon>
    ),
  },
  {
    id: 'drives',
    label: 'Drives',
    icon: (
      <TabIcon>
        <path d="M10 17.5s5.2-5.7 5.2-9.5a5.2 5.2 0 10-10.4 0c0 3.8 5.2 9.5 5.2 9.5z" />
        <circle cx="10" cy="8" r="1.8" />
      </TabIcon>
    ),
  },
  {
    id: 'fuel',
    label: 'Fuel',
    icon: (
      <TabIcon>
        <path d="M4.5 17V4.5a1 1 0 011-1h4a1 1 0 011 1V17" />
        <path d="M3.5 17h8" />
        <path d="M10.5 8h1.3a1.5 1.5 0 011.5 1.5V14a1 1 0 001 1v0a1 1 0 001-1V8.8l-2-2" />
      </TabIcon>
    ),
  },
  {
    id: 'service',
    label: 'Service',
    icon: (
      <TabIcon>
        <path d="M13.4 6.6a2.7 2.7 0 10-3.8 3.8L4 16l1 1 5.6-5.6a2.7 2.7 0 003.8-3.8l-1.7 1.7-1.4-1.4z" />
      </TabIcon>
    ),
  },
  {
    id: 'glove',
    label: 'Docs',
    icon: (
      <TabIcon>
        <path d="M3 6.5a1 1 0 011-1h4l1.5 2H16a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9z" />
      </TabIcon>
    ),
  },
];

function AutoAppShell() {
  const garageFocus = useRef(null);
  const mainRef = useRef(null);
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
  const activeResource = { overview, drives: journeys, fuel, service, glove: documents }[tab];
  // These panels keep their records visible during a same-car refresh.
  const retainedContent = { drives: journeys.data?.journeys, fuel: fuel.data, service: service.data }[tab];
  const showLoading = activeResource.loading && !retainedContent;
  useViewScroll({
    mainRef, viewKey: tab, owner: vehicleId,
    ready: Boolean(vehicleId) && !showLoading && !activeResource.error,
  });

  const vehicleLabel = useMemo(() => {
    const found = vehicles.data?.vehicles?.find((v) => v.id === vehicleId);
    return found?.label || overview.data?.label || vehicleId || 'Vehicle';
  }, [vehicles.data, vehicleId, overview.data]);

  let garageContent;
  if (vehicles.loading) {
    garageContent = <LoadingState label="garage" />;
  } else if (vehicles.error) {
    garageContent = <ErrorState error={vehicles.error} onRetry={vehicles.reload} label="Garage" />;
  } else if (!vehicles.data?.vehicles?.length) {
    garageContent = <EmptyState
      title="No vehicles yet"
      hint="A vehicle appears here once the in-car device uploads a trip, or once records are added under household/automotive/."
    />;
  } else if (!vehicleId) {
    garageContent = <Garage vehicles={vehicles.data.vehicles} restoreFocus={garageFocus}
      onPick={(id) => { setVehicleId(id); autoLog.debug('garage.picked', { vehicleId: id }); }} />;
  }
  if (garageContent) return <AppChrome title="Garage">{garageContent}</AppChrome>;

  const headerActions = vehicles.data.vehicles.length > 1
    ? [(
      <ActionIcon key="back" className="ds-touch-target" aria-label="Back to garage" variant="subtle" autoFocus onClick={() => {
        garageFocus.current = vehicleId;
        setVehicleId(null);
      }}>
        <UiIcon name="back" />
      </ActionIcon>
    )]
    : undefined;

  return (
    <AppChrome
      title={vehicleLabel}
      mainRef={mainRef}
      tabs={TABS}
      activeTab={tab}
      onTabChange={(id) => { setTab(id); autoLog.debug('tab.changed', { tab: id }); }}
      headerActions={headerActions}
    >
      {tab === 'overview' && (
        <OverviewPanel
          overview={overview.data}
          loading={showLoading}
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
          loading={showLoading}
          error={journeys.error}
          onReload={journeys.reload}
          includeShuffles={includeShuffles}
          onToggleShuffles={() => setIncludeShuffles((v) => !v)}
        />
      )}
      {tab === 'fuel' && (
        <FuelPanel
          vehicleId={vehicleId}
          fuel={fuel.data}
          loading={showLoading}
          error={fuel.error}
          onReload={fuel.reload}
        />
      )}
      {tab === 'service' && (
        <ServicePanel
          vehicleId={vehicleId}
          service={service.data}
          reminders={overview.data?.reminders}
          typeResource={serviceTypes}
          loading={showLoading}
          error={service.error}
          onReload={service.reload}
        />
      )}
      {tab === 'glove' && (
        <GlovePanel
          documents={documents.data}
          reminders={overview.data?.reminders}
          loading={showLoading}
          error={documents.error}
          onReload={documents.reload}
        />
      )}
    </AppChrome>
  );
}

export default function AutoApp() {
  return (
    <AppThemeProvider pack="auto" className="auto-app">
      <DismissStackProvider>
        <AutoAppShell />
      </DismissStackProvider>
    </AppThemeProvider>
  );
}

/**
 * The garage: every vehicle the household has records or history for.
 *
 * Shown only when there is more than one, so a single-car household never taps
 * through a list of one. The structure exists regardless, which is what makes
 * adding a second car — or keeping a sold one — additive rather than a rewrite.
 */
function Garage({ vehicles, onPick, restoreFocus }) {
  return (
    <ul className="auto-list">
      {vehicles.map((vehicle) => (
        <li key={vehicle.id} className="auto-doc">
          <button type="button" className="auto-doc__link auto-garage__pick" onClick={() => onPick(vehicle.id)}
            ref={button => {
              if (button && restoreFocus.current === vehicle.id) {
                button.focus();
                restoreFocus.current = null;
              }
            }}>
            <span className="auto-doc__label">{vehicle.label || vehicle.id}</span>
            {describeVehicle(vehicle) && (
              <span className="auto-doc__kind">{describeVehicle(vehicle)}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
