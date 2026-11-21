import React, { useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppThemeProvider } from '../lib/ui/AppThemeProvider.jsx';
import { ADMIN_PACK } from '../modules/Admin/adminTheme.js';
import AdminSessionBoundary from '../modules/Admin/shared/AdminSessionBoundary.jsx';
import getLogger from '../lib/logging/Logger.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import AdminLayout from '../modules/Admin/AdminLayout.jsx';
import ListsIndex from "../../../__capabilities/content-catalog/browser/admin-lists.mjs";
import ListsFolder from "../../../__capabilities/content-catalog/browser/admin-folder.mjs";
import { ArtLibrary } from "../../../__app_modules/media/art/browser/admin/index.js";
import { SheetMusicLibrary, SheetMusicScore } from "../../../__app_modules/learning/piano/browser/admin/index.js";
import AppConfigEditor from '../modules/Admin/Apps/AppConfigEditor.jsx';
import ConfigIndex from '../modules/Admin/Config/ConfigIndex.jsx';
import ConfigFileEditor from '../modules/Admin/Config/ConfigFileEditor.jsx';
import SchedulerIndex from '../modules/Admin/Scheduler/SchedulerIndex.jsx';
import JobDetail from '../modules/Admin/Scheduler/JobDetail.jsx';
import MembersIndex from '../modules/Admin/Household/MembersIndex.jsx';
import MemberEditor from '../modules/Admin/Household/MemberEditor.jsx';
import DevicesIndex from '../modules/Admin/Household/DevicesIndex.jsx';
import SessionsIndex, { SessionRevocationProvider } from '../modules/Admin/Household/SessionsIndex.jsx';
import DeviceEditor from '../modules/Admin/Household/DeviceEditor.jsx';
import FullyKioskConsole from '../modules/Admin/Household/FullyKioskConsole.jsx';
import IntegrationsIndex from '../modules/Admin/System/IntegrationsIndex.jsx';
import IntegrationDetail from '../modules/Admin/System/IntegrationDetail.jsx';
import NotificationsIndex from '../modules/Admin/Notifications/NotificationsIndex.jsx';
import { AgentsIndex, AgentDetail } from "../../../__capabilities/agent-runtime/browser/admin.mjs";
import { AgentDashboard, HealthCoachConfigTab } from "../../../__app_modules/wellness/health/browser/admin.mjs";
import { AgendasIndex, AgendaSeriesPage, AgendaPlanEditor, AgendaWeekRedirect } from "../../../__app_modules/household/agenda/browser/admin.mjs";
import { CharadesParticipantSettings, defaultParticipantSettings, remapParticipantKeys } from "../../../__app_modules/games/party-games/browser/participant-settings.mjs";
import GamesIndex from "../../../__app_modules/games/party-games/browser/admin-games.mjs";
import ConsoleDetail from "../../../__app_modules/games/party-games/browser/admin-console.mjs";
import { ContentFilterLibrary, ContentFilterReview } from "../modules/Admin/ContentFilter/ContentFilterAdmin.jsx";
import PlaybackHubPage from "../../../__app_modules/media/media/browser/admin/playback-hub/PlaybackHubPage.jsx";
import SchoolVirtualConsole from "../../../__app_modules/learning/school/browser/admin-console.mjs";
import SchoolReviewQueue from "../../../__app_modules/learning/school/browser/admin-review.mjs";
import SchoolSessionHistory from "../../../__app_modules/learning/school/browser/admin-history.mjs";
import SchoolCurriculumPlanner from "../../../__app_modules/learning/school/browser/admin-curriculum.mjs";
import ComboboxTestPage from '../modules/Admin/TestHarness/ComboboxTestPage.jsx';
import { Notifications } from '@mantine/notifications';
import './AdminApp.scss';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

const participantEditors = {
  'party-games': { consumer:{id:'party-games',version:1}, Panel:CharadesParticipantSettings, defaultSettings:defaultParticipantSettings, remapParticipantKeys },
};

function AdminApp() {
  useDocumentTitle('Admin');
  const logger = useMemo(() => getLogger().child({ app: 'admin', sessionLog: true }), []);

  React.useEffect(() => {
    logger.info('admin.app.mounted');
  }, [logger]);

  return (
    <AppThemeProvider pack={ADMIN_PACK} className="admin-theme" scopeId="admin-theme" forceColorScheme="dark">
      <div id="admin-portals" />
      <Notifications position="bottom-right" autoClose={3000} />
      <div className="App admin-app">
        <AdminSessionBoundary>
          <Routes>
            {/* Test routes - outside AdminLayout */}
            <Route path="test/combobox" element={<ComboboxTestPage />} />

            <Route element={<SessionRevocationProvider><AdminLayout /></SessionRevocationProvider>}>
              <Route index element={<Navigate to="content/lists/menus" replace />} />
              <Route path="content/lists/:type" element={<ListsIndex />} />
              <Route path="content/lists/:type/:name" element={<ListsFolder />} />
              <Route path="content/agendas" element={<AgendasIndex />} />
              <Route path="content/agendas/:seriesId" element={<AgendaSeriesPage editors={participantEditors} />} />
              <Route path="content/agendas/:seriesId/weeks/:weekOf" element={<AgendaWeekRedirect />} />
              <Route path="content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor editors={participantEditors} />} />
              <Route path="content/games" element={<GamesIndex />} />
              <Route path="content/games/:consoleId" element={<ConsoleDetail />} />
              <Route path="content/art" element={<ArtLibrary />} />
              <Route path="content/sheet-music" element={<SheetMusicLibrary />} />
              <Route path="content/sheet-music/view/*" element={<SheetMusicScore />} />
              <Route path="content/filter" element={<ContentFilterLibrary />} />
              <Route path="content/filter/:ratingKey/:rowId?" element={<ContentFilterReview />} />
              {/* Apps */}
              <Route path="apps/:appId" element={<AppConfigEditor />} />

              {/* Household */}
              <Route path="household/members" element={<MembersIndex />} />
              <Route path="household/members/:username" element={<MemberEditor />} />
              <Route path="household/sessions" element={<SessionsIndex />} />
              <Route path="household/devices" element={<DevicesIndex />} />
              <Route path="household/devices/:deviceId/fully-kiosk" element={<FullyKioskConsole />} />
              <Route path="household/devices/:deviceId" element={<DeviceEditor />} />

              {/* Agents */}
              <Route path="agents" element={<AgentsIndex />} />
              <Route
                path="agents/health-coach"
                element={(
                  <AgentDetail
                    agentId="health-coach"
                    ConfigView={HealthCoachConfigTab}
                    DashboardView={AgentDashboard}
                  />
                )}
              />
              <Route path="agents/:agentId" element={<AgentDetail />} />

              {/* Playback Hub */}
              <Route path="playback-hub" element={<PlaybackHubPage />} />

              {/* School — the virtual device console for the physical
                  learning console. Its API is mounted only when school.yml
                  sets virtualDevices: true, so the page reports "not wired"
                  rather than breaking on a real deployment. */}
              <Route path="school/virtual-console" element={<SchoolVirtualConsole />} />

              {/* The parent surfaces over the same lifecycle. Unlike the
                  virtual console these are for a real household: the review
                  queue is where a grown-up marks paper the machine would not
                  score, and until it existed that queue had no door. */}
              <Route path="school/review" element={<SchoolReviewQueue />} />
              <Route path="school/sessions" element={<SchoolSessionHistory />} />
              <Route path="school/planning" element={<SchoolCurriculumPlanner />} />

              {/* System */}
              <Route path="system/integrations" element={<IntegrationsIndex />} />
              <Route path="system/integrations/:provider" element={<IntegrationDetail />} />
              <Route path="system/scheduler" element={<SchedulerIndex />} />
              <Route path="system/scheduler/:jobId" element={<JobDetail />} />
              <Route path="system/config" element={<ConfigIndex />} />
              <Route path="system/config/*" element={<ConfigFileEditor />} />
              <Route path="system/notifications" element={<NotificationsIndex />} />
              <Route path="*" element={<Navigate to="content/lists/menus" replace />} />
            </Route>
          </Routes>
        </AdminSessionBoundary>
      </div>
    </AppThemeProvider>
  );
}

export default AdminApp;
