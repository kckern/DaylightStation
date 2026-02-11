import React, { useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MantineProvider, createTheme } from '@mantine/core';
import { getChildLogger } from '../lib/logging/singleton.js';
import AdminLayout from '../modules/Admin/AdminLayout.jsx';
import ListsIndex from '../modules/Admin/ContentLists/ListsIndex.jsx';
import ListsFolder from '../modules/Admin/ContentLists/ListsFolder.jsx';
import ComingSoon from '../modules/Admin/Placeholders/ComingSoon.jsx';
import ComboboxTestPage from '../modules/Admin/TestHarness/ComboboxTestPage.jsx';
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
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <div className="App admin-app">
        <Routes>
          {/* Test routes - outside AdminLayout */}
          <Route path="test/combobox" element={<ComboboxTestPage />} />

          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="content/lists/menus" replace />} />
            <Route path="content/lists/:type" element={<ListsIndex />} />
            <Route path="content/lists/:type/:name" element={<ListsFolder />} />
            {/* Apps */}
            <Route path="apps/:appId" element={<ComingSoon title="App Config" />} />

            {/* Household */}
            <Route path="household/members" element={<ComingSoon title="Members" />} />
            <Route path="household/members/:username" element={<ComingSoon title="Member Editor" />} />
            <Route path="household/devices" element={<ComingSoon title="Devices" />} />
            <Route path="household/devices/:deviceId" element={<ComingSoon title="Device Editor" />} />

            {/* System */}
            <Route path="system/integrations" element={<ComingSoon title="Integrations" />} />
            <Route path="system/integrations/:provider" element={<ComingSoon title="Integration Detail" />} />
            <Route path="system/scheduler" element={<ComingSoon title="Scheduler" />} />
            <Route path="system/scheduler/:jobId" element={<ComingSoon title="Job Detail" />} />
            <Route path="system/config" element={<ComingSoon title="Config Editor" />} />
            <Route path="*" element={<Navigate to="content/lists/menus" replace />} />
          </Route>
        </Routes>
      </div>
    </MantineProvider>
  );
}

export default AdminApp;
