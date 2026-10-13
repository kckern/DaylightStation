// frontend/src/Apps/MediaApp.jsx
// The household's universal content front door + universal remote.
// Design source-of-truth: __docs/reference/media/media-app.md
import React, { useEffect } from 'react';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { AppThemeProvider } from '@/lib/ui';
import { configure as configureLogger } from "../../../frontend/src/lib/logging/Logger.js";
import useDocumentTitle from "../../../frontend/src/hooks/useDocumentTitle.js";
import { MEDIA_PACK } from "./theme/mediaTheme.js";
import { MediaAppShell } from "./shell/MediaAppShell.jsx";
import { ClientIdentityProvider } from "./identity/ClientIdentityProvider.jsx";
import { LocalSessionProvider } from "./session/LocalSessionProvider.jsx";
import { SearchProvider } from "./search/SearchProvider.jsx";
import { FleetProvider } from "./fleet/FleetProvider.jsx";
import { PeekProvider } from "./peek/PeekProvider.jsx";
import { CastTargetProvider } from "./cast/CastTargetProvider.jsx";
import { DispatchProvider } from "./cast/DispatchProvider.jsx";
import mediaLog from "./logging/mediaLog.js";
import { wsService } from "../../../frontend/src/services/WebSocketService.js";
import "./MediaApp.scss";

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
    const releaseAutoReload = wsService.suppressAutoReload('media local playback');
    return () => {
      releaseAutoReload();
      mediaLog.unmounted({});
      configureLogger({ context: { sessionLog: false } });
    };
  }, []);

  return (
    <AppThemeProvider pack={MEDIA_PACK} forceColorScheme="dark">
      <Notifications
        position="top-center"
        autoClose={3000}
        style={{ pointerEvents: 'none' }}
        classNames={{ notification: 'media-app-notification' }}
        styles={{ notification: { pointerEvents: 'none' } }}
      />
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
