import React, { useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MantineProvider, createTheme } from '@mantine/core';
import { getChildLogger } from '../lib/logging/singleton.js';
import AdminLayout from '../modules/Admin/AdminLayout.jsx';
import ListsIndex from '../modules/Admin/ContentLists/ListsIndex.jsx';
import ListsFolder from '../modules/Admin/ContentLists/ListsFolder.jsx';
import ComingSoon from '../modules/Admin/Placeholders/ComingSoon.jsx';
import './AdminApp.scss';
import '@mantine/core/styles.css';

const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
});

function AdminApp() {
  const logger = useMemo(() => getChildLogger({ app: 'admin' }), []);

  React.useEffect(() => {
    logger.info('admin.app.mounted');
  }, [logger]);

  return (
    <MantineProvider theme={theme}>
      <div className="App admin-app">
        <Routes>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="content/lists" replace />} />
            <Route path="content/lists" element={<ListsIndex />} />
            <Route path="content/lists/:folder" element={<ListsFolder />} />
            <Route path="content/menus" element={<ComingSoon title="Menus" />} />
            <Route path="content/playlists" element={<ComingSoon title="Playlists" />} />
            <Route path="apps/*" element={<ComingSoon title="App Config" />} />
            <Route path="household/*" element={<ComingSoon title="Household" />} />
            <Route path="system/*" element={<ComingSoon title="System" />} />
            <Route path="*" element={<Navigate to="content/lists" replace />} />
          </Route>
        </Routes>
      </div>
    </MantineProvider>
  );
}

export default AdminApp;
