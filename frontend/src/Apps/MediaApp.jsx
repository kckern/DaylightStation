// frontend/src/Apps/MediaApp.jsx
import React from 'react';
import { ClientIdentityProvider } from '../modules/Media/session/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../modules/Media/session/LocalSessionProvider.jsx';
import { FleetProvider } from '../modules/Media/fleet/FleetProvider.jsx';
import { CastTargetProvider } from '../modules/Media/cast/CastTargetProvider.jsx';
import { DispatchProvider } from '../modules/Media/cast/DispatchProvider.jsx';
import { SearchProvider } from '../modules/Media/search/SearchProvider.jsx';
import { MediaAppShell } from '../modules/Media/shell/MediaAppShell.jsx';

export default function MediaApp() {
  return (
    <ClientIdentityProvider>
      <LocalSessionProvider>
        <FleetProvider>
          <CastTargetProvider>
            <DispatchProvider>
              <SearchProvider>
                <MediaAppShell />
              </SearchProvider>
            </DispatchProvider>
          </CastTargetProvider>
        </FleetProvider>
      </LocalSessionProvider>
    </ClientIdentityProvider>
  );
}
