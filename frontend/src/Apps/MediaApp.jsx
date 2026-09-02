// frontend/src/Apps/MediaApp.jsx
// The household's universal content front door + universal remote.
// Design source-of-truth: docs/reference/media/media-app.md
import React, { useEffect } from 'react';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { AppThemeProvider } from '@/lib/ui';
import { configure as configureLogger } from '../lib/logging/Logger.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { MEDIA_PACK } from '../modules/Media/theme/mediaTheme.js';
import { MediaAppShell } from '../modules/Media/shell/MediaAppShell.jsx';
import { ClientIdentityProvider } from '../modules/Media/identity/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../modules/Media/session/LocalSessionProvider.jsx';
import { SearchProvider } from '../modules/Media/search/SearchProvider.jsx';
import { FleetProvider } from '../modules/Media/fleet/FleetProvider.jsx';
import { PeekProvider } from '../modules/Media/peek/PeekProvider.jsx';
import { CastTargetProvider } from '../modules/Media/cast/CastTargetProvider.jsx';
import { DispatchProvider } from '../modules/Media/cast/DispatchProvider.jsx';
import mediaLog from '../modules/Media/logging/mediaLog.js';
import { wsService } from '../services/WebSocketService.js';
import './MediaApp.scss';

export default function MediaApp() {
  useDocumentTitle('Media');

  useEffect(() => {
    // `sessionLog` on the root logger is what makes mediaLog's events DURABLE
    // (the backend session-file transport gates on context.app +
    // context.sessionLog — see mediaLog.js). Same pattern as the other
    // DS-migrated apps (LifeApp, FitnessApp, PianoApp).
    configureLogger({ context: { app: 'media', sessionLog: true } });
    // Device shape belongs on the FIRST event of the session. A 2026-08-16
    // report of "couldn't search on mobile, in portrait" had to be sized from a
    // viewport that only appeared incidentally inside an audio-shader warning —
    // nothing else in the stream said how big the screen was, or which way up.
    const s = typeof window !== 'undefined' ? window.screen : null;
    mediaLog.mounted({
      viewport: typeof window !== 'undefined'
        ? { width: window.innerWidth, height: window.innerHeight }
        : null,
      orientation: s?.orientation?.type
        ?? (typeof window !== 'undefined'
          ? (window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait')
          : null),
      devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : null,
    });
    // C9.4/C9.7: a backend outage must never reload this page out from
    // under local playback. Kiosk routes keep the default behavior.
    wsService.setAutoReloadEnabled(false);
    return () => {
      wsService.setAutoReloadEnabled(true);
      mediaLog.unmounted({});
      configureLogger({ context: { sessionLog: false } });
    };
  }, []);

  return (
    <AppThemeProvider pack={MEDIA_PACK} forceColorScheme="dark">
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
    </AppThemeProvider>
  );
}
