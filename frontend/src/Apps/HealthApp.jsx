import { useState } from 'react';
import '@mantine/core/styles.css';
import {
  AppThemeProvider, AppChrome, DismissStackProvider,
} from '@/lib/ui';
import { useHotkey } from '@/lib/hooks/useHotkey.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import CoachChat from '../modules/Health/CoachChat';
import { ChatOverlay } from '../modules/Health/ChatOverlay/index.jsx';
import { TodayView } from '../modules/Health/today/TodayView.jsx';
import { ProgressView } from '../modules/Health/progress/ProgressView.jsx';
import { MedicalView } from '../modules/Health/medical/MedicalView.jsx';
import '../modules/Health/health.scss';

const Icon = ({ d }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const TABS = [
  { id: 'today', label: 'Today', icon: <Icon d="M4 10h12M10 4v12" /> },
  { id: 'progress', label: 'Progress', icon: <Icon d="M3 15l4-6 4 3 6-8" /> },
  { id: 'health', label: 'Health', icon: <Icon d="M10 17s-6-3.5-6-8a3.5 3.5 0 016-2.4A3.5 3.5 0 0116 9c0 4.5-6 8-6 8z" /> },
  { id: 'coach', label: 'Coach', icon: <Icon d="M3 5h14v9H8l-4 3v-3H3z" /> },
];

const userId = (typeof window !== 'undefined' && window.DAYLIGHT_USER_ID) || 'default';

const HealthApp = () => {
  useDocumentTitle('Health');
  const [tab, setTab] = useState('today');
  const [overlayOpen, setOverlayOpen] = useState(false);
  useHotkey('mod+k', () => setOverlayOpen(true));

  return (
    <AppThemeProvider pack="health">
      <DismissStackProvider>
        <AppChrome title="Health" tabs={TABS} activeTab={tab} onTabChange={setTab}>
          {tab === 'today' && <TodayView onSetupGoals={() => setTab('progress')} onCoachTap={() => setOverlayOpen(true)} />}
          {tab === 'progress' && <ProgressView />}
          {tab === 'health' && <MedicalView />}
          {/* CoachChat only supports variant 'light'|'overlay' (see AgentChatSurface) —
              'full' isn't a real variant. The default 'light' variant is already the
              full-height flex-column layout (`.coach-chat { height: 100% }`), which is
              exactly what a tab-body mount needs, so we use it here unchanged. */}
          {tab === 'coach' && <CoachChat userId={userId} style={{ height: '100%' }} />}
        </AppChrome>
        <ChatOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} userId={userId}>
          <CoachChat userId={userId} variant="overlay" />
        </ChatOverlay>
      </DismissStackProvider>
    </AppThemeProvider>
  );
};

export default HealthApp;
