// frontend/src/Apps/MediaApp.jsx
import React from 'react';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { ClientIdentityProvider } from '../modules/Media/session/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../modules/Media/session/LocalSessionProvider.jsx';
import { FleetProvider } from '../modules/Media/fleet/FleetProvider.jsx';
import { PeekProvider } from '../modules/Media/peek/PeekProvider.jsx';
import { CastTargetProvider } from '../modules/Media/cast/CastTargetProvider.jsx';
import { DispatchProvider } from '../modules/Media/cast/DispatchProvider.jsx';
import { SearchProvider } from '../modules/Media/search/SearchProvider.jsx';
import { MediaAppShell } from '../modules/Media/shell/MediaAppShell.jsx';
import './MediaApp.scss';

export default function MediaApp() {
  useDocumentTitle('Media');
  return (
    <ClientIdentityProvider>
      <LocalSessionProvider>
        <FleetProvider>
          <PeekProvider>
            <CastTargetProvider>
              <DispatchProvider>
                <SearchProvider>
                  <div className="media-app">
                    <MediaAppShell />
                  </div>
                </SearchProvider>
              </DispatchProvider>
            </CastTargetProvider>
          </PeekProvider>
        </FleetProvider>
      </LocalSessionProvider>
    </ClientIdentityProvider>
  );
}
