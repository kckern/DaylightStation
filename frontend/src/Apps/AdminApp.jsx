import React, { useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MantineProvider, createTheme } from '@mantine/core';
import { getChildLogger } from '../lib/logging/singleton.js';
import AdminLayout from '../modules/Admin/AdminLayout.jsx';
import ListsIndex from '../modules/Admin/ContentLists/ListsIndex.jsx';
import ListsFolder from '../modules/Admin/ContentLists/ListsFolder.jsx';
import ComingSoon from '../modules/Admin/Placeholders/ComingSoon.jsx';
import AppConfigEditor from '../modules/Admin/Apps/AppConfigEditor.jsx';
import ConfigIndex from '../modules/Admin/Config/ConfigIndex.jsx';
import ConfigFileEditor from '../modules/Admin/Config/ConfigFileEditor.jsx';
import SchedulerIndex from '../modules/Admin/Scheduler/SchedulerIndex.jsx';
import JobDetail from '../modules/Admin/Scheduler/JobDetail.jsx';
import MembersIndex from '../modules/Admin/Household/MembersIndex.jsx';
import MemberEditor from '../modules/Admin/Household/MemberEditor.jsx';
import DevicesIndex from '../modules/Admin/Household/DevicesIndex.jsx';
import DeviceEditor from '../modules/Admin/Household/DeviceEditor.jsx';
import IntegrationsIndex from '../modules/Admin/System/IntegrationsIndex.jsx';
import IntegrationDetail from '../modules/Admin/System/IntegrationDetail.jsx';
import ComboboxTestPage from '../modules/Admin/TestHarness/ComboboxTestPage.jsx';
import { Notifications } from '@mantine/notifications';
import AuthGate from '../modules/Auth/AuthGate.jsx';
import './AdminApp.scss';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

const DS_BLUE = [
  '#e8f0fe', '#c4d7fc', '#9ebcfa', '#789ff7', '#4A7BF7',
  '#3d6be0', '#3360cc', '#2952b3', '#1f4499', '#163680'
];

const theme = createTheme({
  primaryColor: 'ds-blue',
  fontFamily: '"IBM Plex Sans", -apple-system, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", monospace',
  headings: {
    fontFamily: '"JetBrains Mono", monospace',
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '24px', lineHeight: '1.3' },
      h2: { fontSize: '20px', lineHeight: '1.35' },
      h3: { fontSize: '16px', lineHeight: '1.4' },
    },
  },
  colors: {
    'ds-blue': DS_BLUE,
  },
  defaultRadius: 'sm',
  components: {
    Button: {
      defaultProps: { radius: 'sm' },
    },
    Paper: {
      defaultProps: { radius: 'md' },
      styles: {
        root: {
          backgroundColor: 'var(--ds-bg-elevated)',
          border: '1px solid var(--ds-border)',
        },
      },
    },
    TextInput: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-bg-base)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    NumberInput: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-bg-base)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    Select: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-bg-base)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    Badge: {
      defaultProps: { radius: 'sm', variant: 'light' },
    },
    Modal: {
      styles: {
        content: {
          backgroundColor: 'var(--ds-bg-elevated)',
          border: '1px solid var(--ds-border)',
        },
        header: {
          backgroundColor: 'var(--ds-bg-elevated)',
        },
      },
    },
    Table: {
      styles: {
        th: {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--ds-text-secondary)',
        },
      },
    },
  },
});

function AdminApp() {
  const logger = useMemo(() => getChildLogger({ app: 'admin' }), []);

  React.useEffect(() => {
    logger.info('admin.app.mounted');
  }, [logger]);

  return (
    <AuthGate app="admin">
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <Notifications position="bottom-right" autoClose={3000} />
        <div className="App admin-app">
          <Routes>
            {/* Test routes - outside AdminLayout */}
            <Route path="test/combobox" element={<ComboboxTestPage />} />

            <Route element={<AdminLayout />}>
              <Route index element={<Navigate to="content/lists/menus" replace />} />
              <Route path="content/lists/:type" element={<ListsIndex />} />
              <Route path="content/lists/:type/:name" element={<ListsFolder />} />
              {/* Apps */}
              <Route path="apps/:appId" element={<AppConfigEditor />} />

              {/* Household */}
              <Route path="household/members" element={<MembersIndex />} />
              <Route path="household/members/:username" element={<MemberEditor />} />
              <Route path="household/devices" element={<DevicesIndex />} />
              <Route path="household/devices/:deviceId" element={<DeviceEditor />} />

              {/* System */}
              <Route path="system/integrations" element={<IntegrationsIndex />} />
              <Route path="system/integrations/:provider" element={<IntegrationDetail />} />
              <Route path="system/scheduler" element={<SchedulerIndex />} />
              <Route path="system/scheduler/:jobId" element={<JobDetail />} />
              <Route path="system/config" element={<ConfigIndex />} />
              <Route path="system/config/*" element={<ConfigFileEditor />} />
              <Route path="*" element={<Navigate to="content/lists/menus" replace />} />
            </Route>
          </Routes>
        </div>
      </MantineProvider>
    </AuthGate>
  );
}

export default AdminApp;
