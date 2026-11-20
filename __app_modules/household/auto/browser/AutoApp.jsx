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
// The auto theme pack carries its Roboto Condensed typography through the
// shared theme provider.

import { useEffect, useMemo, useRef, useState } from 'react';
import '@mantine/core/styles.css';
import { ActionIcon } from '@mantine/core';
import {
  AppThemeProvider, AppChrome, DismissStackProvider, LoadingState, ErrorState, EmptyState, UiIcon, useRetryRegion, useViewScroll,
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

const TABS = [
  { id: 'overview', label: 'Car', icon: <UiIcon name="car" size={20} /> },
  { id: 'drives', label: 'Drives', icon: <UiIcon name="pin" size={20} /> },
  { id: 'fuel', label: 'Fuel', icon: <UiIcon name="fuel" size={20} /> },
  { id: 'service', label: 'Service', icon: <UiIcon name="service" size={20} /> },
  { id: 'glove', label: 'Docs', icon: <UiIcon name="folder" size={20} /> },
];

function AutoAppShell() {
  const garageFocus = useRef(null);
  const mainRef = useRef(null);
  const [tab, setTab] = useState('overview');
  const [vehicleId, setVehicleId] = useState(null);
  const [includeShuffles, setIncludeShuffles] = useState(false);

  const vehicles = useVehicles();

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

  const garageOpen = vehicles.loading || Boolean(vehicles.error) || !vehicles.data?.vehicles?.length || !vehicleId;
  const activeTab = garageOpen ? null : tab;
  // The selected car header, Service and Docs all use the overview.
  const overview = useOverview(garageOpen ? null : vehicleId);
  const journeys = useJourneys(vehicleId, { includeShuffles, enabled: activeTab === 'drives' });
  const fuel = useFuel(vehicleId, { enabled: activeTab === 'drives' || activeTab === 'fuel' });
  const service = useService(vehicleId, { enabled: activeTab === 'service' });
  const serviceTypes = useServiceTypes({ enabled: activeTab === 'service' });
  const documents = useDocuments(vehicleId, { enabled: activeTab === 'glove' });
  const activeResource = { overview, drives: journeys, fuel, service, glove: documents }[tab];
  // Reads can start after the tab's first render. Wait for a cold result before
  // restoring its scroll, and keep accepted rows visible on a same-car refresh.
  const showLoading = !activeResource.hasResult && !activeResource.error;
  const activeReadBusy = showLoading || activeResource.loading || activeResource.revalidating;
  const shellResource = garageOpen ? vehicles : activeResource;
  const { regionProps: shellRegion, retry: retryShell } = useRetryRegion(
    shellResource.reload, garageOpen ? vehicles.loading || vehicles.revalidating : activeReadBusy,
  );
  useViewScroll({
    mainRef, viewKey: tab, owner: vehicleId,
    ready: !garageOpen && !showLoading && !activeResource.error,
  });

  const vehicleLabel = useMemo(() => {
    const found = vehicles.data?.vehicles?.find((v) => v.id === vehicleId);
    return found?.label || overview.data?.label || vehicleId || 'Vehicle';
  }, [vehicles.data, vehicleId, overview.data]);

  let shellContent;
  let shellLabel;
  if (garageOpen) {
    shellLabel = 'Garage';
    if (vehicles.loading) {
      shellContent = <LoadingState label="garage" />;
    } else if (vehicles.error) {
      shellContent = <ErrorState error={vehicles.error} onRetry={retryShell} label="Garage" />;
    } else if (!vehicles.data?.vehicles?.length) {
      shellContent = <EmptyState
        title="No vehicles yet"
        hint="A vehicle appears here once the in-car device uploads a trip, or once records are added under household/automotive/."
      />;
    } else {
      shellContent = <Garage vehicles={vehicles.data.vehicles} restoreFocus={garageFocus}
        onPick={(id) => { setVehicleId(id); autoLog.debug('garage.picked', { vehicleId: id }); }} />;
    }
  } else if (tab === 'overview') {
    shellLabel = 'Vehicle';
    shellContent = <OverviewPanel
      overview={overview.data}
      loading={showLoading}
      error={overview.error}
      onReload={retryShell}
      onGoTo={setTab}
      vehicleDescription={describeVehicle(overview.data?.vehicle)}
    />;
  } else if (tab === 'glove') {
    shellLabel = 'Documents';
    shellContent = <GlovePanel
      documents={documents.data}
      reminders={overview.data?.reminders}
      loading={showLoading}
      error={documents.error}
      onReload={retryShell}
    />;
  }

  const headerActions = !garageOpen && vehicles.data.vehicles.length > 1
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
      title={garageOpen ? 'Garage' : vehicleLabel}
      mainRef={mainRef}
      tabs={garageOpen ? undefined : TABS}
      activeTab={tab}
      onTabChange={(id) => { setTab(id); autoLog.debug('tab.changed', { tab: id }); }}
      headerActions={headerActions}
    >
      {shellContent && <section {...shellRegion} aria-label={shellLabel}>{shellContent}</section>}
      {!garageOpen && tab === 'drives' && (
        <DrivesPanel
          vehicleId={vehicleId}
          journeys={journeys.data?.journeys}
          hidden={journeys.data?.hidden || 0}
          fuelLogs={fuel.data?.logs}
          loading={showLoading}
          busy={activeReadBusy}
          error={journeys.error}
          onReload={journeys.reload}
          includeShuffles={includeShuffles}
          onToggleShuffles={() => setIncludeShuffles((v) => !v)}
        />
      )}
      {!garageOpen && tab === 'fuel' && (
        <FuelPanel
          vehicleId={vehicleId}
          fuel={fuel.data}
          loading={showLoading}
          busy={activeReadBusy}
          error={fuel.error}
          onReload={fuel.reload}
        />
      )}
      {!garageOpen && tab === 'service' && (
        <ServicePanel
          vehicleId={vehicleId}
          service={service.data}
          reminders={overview.data?.reminders}
          typeResource={serviceTypes}
          loading={showLoading}
          busy={activeReadBusy}
          error={service.error}
          onReload={service.reload}
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
