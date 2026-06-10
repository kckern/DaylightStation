// frontend/src/Apps/MediaApp.jsx
// The household's universal content front door + universal remote.
// Design source-of-truth: docs/reference/media/media-app.md
import React, { useEffect } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { mediaTheme } from '../modules/Media/theme/mediaTheme.js';
import { MediaAppShell } from '../modules/Media/shell/MediaAppShell.jsx';
import { ClientIdentityProvider } from '../modules/Media/identity/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../modules/Media/session/LocalSessionProvider.jsx';
import { SearchProvider } from '../modules/Media/search/SearchProvider.jsx';
import { FleetProvider } from '../modules/Media/fleet/FleetProvider.jsx';
import { PeekProvider } from '../modules/Media/peek/PeekProvider.jsx';
import { CastTargetProvider } from '../modules/Media/cast/CastTargetProvider.jsx';
import { DispatchProvider } from '../modules/Media/cast/DispatchProvider.jsx';
import mediaLog from '../modules/Media/logging/mediaLog.js';
import './MediaApp.scss';

export default function MediaApp() {
  useDocumentTitle('Media');

  useEffect(() => {
    mediaLog.mounted({});
    return () => mediaLog.unmounted({});
  }, []);

  return (
    <MantineProvider theme={mediaTheme} defaultColorScheme="dark" forceColorScheme="dark">
      <Notifications position="bottom-center" autoClose={3000} />
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
    </MantineProvider>
  );
}
