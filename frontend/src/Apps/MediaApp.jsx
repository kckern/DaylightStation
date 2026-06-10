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
      <div className="media-app">
        <MediaAppShell />
      </div>
    </MantineProvider>
  );
}
